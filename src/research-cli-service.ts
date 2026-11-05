import type { RecordItem, TypeDef, Workspace } from './types';
import { emptyTopic, topicData } from './topics';
import { appendLineageNode, checkTaskParents } from './task-lineage';
import { isResearchTasks, isTaskStatus, parseTaskTime, taskStatusFromEvents, type ResearchTask, type TaskCategory, type TaskEvent, type TaskTemplate } from './research-tasks';
import { planTaskImport, TASK_PROTOCOL } from './task-import';
import type { CliEnvelope, CliReceipt } from './research-cli-types';
import { followupKeys } from './task-followup';
import { describeCliChanges } from './cli-changes';

export class CliError extends Error { constructor(public code: string, message: string) { super(message); } }
interface State { records: RecordItem[]; types: TypeDef[]; workspaces: Workspace[]; taskCategories: TaskCategory[]; taskTemplates: TaskTemplate[]; cliReceipts?: CliReceipt[] }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const dataObject = (value: unknown) => { if (!object(value)) throw new CliError('INVALID_INPUT', 'data 须为 JSON 对象'); return value; };
function text(value: unknown, label: string, empty = false) {
  if (typeof value !== 'string' || value.length > 50000 || (!empty && !value.trim())) throw new CliError('INVALID_INPUT', `${label}无效`);
  return value;
}
function keys(data: Record<string, unknown>, allowed: string[]) { for (const key of Object.keys(data)) if (!allowed.includes(key)) throw new CliError('INVALID_INPUT', `不支持字段：${key}`); }
function revision(expected: number | undefined, actual: number) { if (expected !== undefined && expected !== actual) throw new CliError('CONFLICT', `记录已更新，当前 updatedAt=${actual}，请重新读取后重试`); }
const nodeKeys = ['title','description','notes','content','categoryIds','parentIds','nodeType','nodeStyle','version','branch','createdAt',...followupKeys];

/** CLI accepts labelled custom fields as well as the existing template protocol. */
function normalizeEvent(raw: unknown) {
  const event = dataObject(raw);
  if (!Array.isArray(event.fields)) return event;
  if (event.fields.length > 100) throw new CliError('INVALID_INPUT', '记录字段最多 100 个');
  if (event.templateId) throw new CliError('INVALID_INPUT', '使用模板时 fields 须为字段 ID 到值的对象');
  const fields = event.fields.map(value => {
    const f = dataObject(value); keys(f, ['id','label','type','value']);
    return { id: text(f.id, '字段 ID'), label: text(f.label, '字段名称'), type: f.type || 'text', required: false };
  });
  return { ...event, templateSnapshot: { version: 1, fields }, fields: Object.fromEntries(event.fields.map((v, i) => [fields[i].id, dataObject(v).value])) };
}
function updatedNode(task: ResearchTask, data: Record<string, unknown>, tasks: ResearchTask[], categories: TaskCategory[], now: number) {
  keys(data, nodeKeys);
  const patch: Partial<ResearchTask> = {};
  for (const key of ['title','description','notes','content','nodeType','version'] as const) if (data[key] !== undefined) patch[key] = text(data[key], key, key !== 'title');
  for (const key of followupKeys) if (data[key] !== undefined) patch[key] = text(data[key], key, true);
  if (data.createdAt !== undefined) patch.createdAt = parseTaskTime(text(data.createdAt, 'createdAt'));
  if (data.parentIds !== undefined) {
    if (!Array.isArray(data.parentIds) || !data.parentIds.every(id => typeof id === 'string')) throw new CliError('INVALID_INPUT', 'parentIds 须为节点 ID 数组');
    checkTaskParents(tasks, task.id, data.parentIds); patch.parentIds = data.parentIds;
  }
  if (data.categoryIds !== undefined) {
    if (!Array.isArray(data.categoryIds) || !data.categoryIds.every(id => typeof id === 'string' && categories.some(c => c.id === id && !c.archived))) throw new CliError('INVALID_INPUT', 'categoryIds 包含未知或已停用标签');
    patch.categoryIds = [...new Set(data.categoryIds)] as string[];
  }
  if (data.branch !== undefined) { if (typeof data.branch !== 'boolean') throw new CliError('INVALID_INPUT', 'branch 须为布尔值'); patch.branch = data.branch; }
  if (data.nodeStyle !== undefined) {
    if (!['standard','milestone','snapshot'].includes(String(data.nodeStyle))) throw new CliError('INVALID_INPUT', 'nodeStyle 无效');
    patch.nodeStyle = data.nodeStyle as ResearchTask['nodeStyle'];
  }
  const next = { ...task, ...patch };
  return JSON.stringify(next) === JSON.stringify(task) ? task : { ...next, updatedAt: now };
}
function correctedEvent(existing: TaskEvent, data: Record<string, unknown>, topic: RecordItem, task: ResearchTask, state: State, requestId: string, now: number) {
  keys(data, ['title','description','occurredAt','evidence','status','fields','templateId','templateVersion','templateSnapshot']);
  const snapshot = { version: existing.templateVersion, fields: existing.fields.map(f => ({ id: f.id, label: f.label, type: f.type, required: false })) };
  let raw: Record<string, unknown> = {
    ...existing, occurredAt: existing.occurredAt === null ? null : new Date(existing.occurredAt).toISOString(),
    templateSnapshot: snapshot, fields: Object.fromEntries(existing.fields.map(f => [f.id, f.value])), ...data,
  };
  if (Array.isArray(data.fields)) {
    if (existing.templateId && data.templateId !== '') throw new CliError('INVALID_INPUT','模板记录请用 fields 对象补齐；改为自定义字段时须显式传 templateId: ""');
    const merged = new Map(existing.fields.map(f => [f.id, f]));
    for (const value of data.fields) { const f = dataObject(value); merged.set(text(f.id, '字段 ID'), f as unknown as TaskEvent['fields'][number]); }
    // A custom-field correction keeps all unmentioned fields; definitions are explicit.
    raw = normalizeEvent({ ...raw, templateId: '', fields: [...merged.values()] });
    raw.templateVersion = existing.templateVersion;
    raw.templateSnapshot = { ...(raw.templateSnapshot as object), version: existing.templateVersion };
  } else if (data.fields !== undefined) {
    const values = dataObject(data.fields);
    const current = state.taskTemplates.find(t => t.id === existing.templateId && t.version === existing.templateVersion);
    raw.fields = { ...Object.fromEntries(existing.fields.map(f => [f.id, f.value])), ...values };
    if (!data.templateSnapshot && current) raw.templateSnapshot = { version: current.version, fields: current.fields };
  }
  if (data.templateId !== undefined && !data.templateSnapshot) delete raw.templateSnapshot;
  const probe: RecordItem = { ...topic, topic: { ...topicData(topic), tasks: [{ ...task, events: [] }] } };
  const nodeId = probe.topic!.tasks![0].id;
  const plan = planTaskImport(JSON.stringify({protocol:TASK_PROTOCOL,action:'append_events',requestId,topicId:topic.id,taskId:nodeId,events:[raw]}),[probe],state.taskCategories,state.taskTemplates,now);
  return { ...plan.task.events[0], source: existing.source, recordedAt: existing.recordedAt };
}

export function planCliCommand(envelope: CliEnvelope, state: State, now = Date.now()) {
  const { command: c, requestId, fingerprint, dryRun = false } = envelope;
  if (!object(c) || typeof c.op !== 'string' || typeof requestId !== 'string' || !/^[\w.:-]{1,160}$/.test(requestId) || typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)) throw new CliError('INVALID_INPUT', '命令或 requestId 无效');
  keys(c as unknown as Record<string,unknown>,['op','topicId','nodeId','eventId','data','search','archived','workspaceId','expectUpdatedAt']);
  for(const key of ['topicId','nodeId','eventId','search','workspaceId'] as const)if(c[key]!==undefined)text(c[key],key,key==='search');
  if(c.archived!==undefined&&typeof c.archived!=='boolean')throw new CliError('INVALID_INPUT','archived 须为布尔值');
  if(c.expectUpdatedAt!==undefined&&!Number.isFinite(c.expectUpdatedAt))throw new CliError('INVALID_INPUT','expectUpdatedAt 须为有效时间戳');
  const mutations = new Set(['topics.create','topics.update','nodes.create','nodes.update','events.append','events.update','import.apply']);
  const mutating = mutations.has(c.op);
  const receipt = !dryRun && mutating && state.cliReceipts?.find(r => r.requestId === requestId);
  if (receipt) {
    if (receipt.fingerprint !== fingerprint) throw new CliError('CONFLICT', 'requestId 已用于不同内容，请使用新的请求 ID');
    return { result: { ...receipt.result, replayed: true } };
  }
  const projectTypes = new Set(state.types.filter(t => t.kind === 'project').map(t => t.id));
  const projects = state.records.filter(r => projectTypes.has(r.typeId));
  const topic = projects.find(r => r.id === c.topicId);
  const requireTopic = () => {
    if (!topic) throw new CliError('NOT_FOUND', '课题不存在，请先列出课题并使用准确 ID');
    if (mutating && topic.archived) throw new CliError('ARCHIVED', '课题已归档，不能写入'); return topic;
  };
  const requireNode = () => { const p = requireTopic(), task = topicData(p).tasks?.find(t => t.id === c.nodeId); if (!task) throw new CliError('NOT_FOUND', '节点不在指定课题中'); return task; };
  let records = state.records, result: unknown;
  const writeTopic = (record: RecordItem) => { records = state.records.map(r => r.id === record.id ? record : r); };
  const writeTask = (p: RecordItem, task: ResearchTask, all = topicData(p).tasks || []) => {
    writeTopic({...p,updatedAt:now,topic:{...topicData(p),tasks:all.some(t=>t.id===task.id) ? all.map(t=>t.id===task.id?task:t) : appendLineageNode(all,task)}});
    return { topicId:p.id,nodeId:task.id,updatedAt:task.updatedAt };
  };
  if (c.op === 'status') result = { protocol:'research-workbench.cli.v1',ready:true,topics:projects.filter(r=>!r.archived).length };
  else if (c.op === 'catalog.get') result = { workspaces:state.workspaces,categories:state.taskCategories,templates:state.taskTemplates,nodeStatuses:['pending','running','completed','paused','cancelled'] };
  else if (c.op === 'topics.list') result = projects.filter(r=>(c.archived || !r.archived) && (!c.workspaceId || r.workspaceId===c.workspaceId) && (!c.search || [r.title,topicData(r).question].join(' ').toLowerCase().includes(c.search.toLowerCase()))).map(r=>({id:r.id,title:r.title,question:topicData(r).question,workspaceId:r.workspaceId,status:r.status,archived:r.archived,nodeCount:topicData(r).tasks?.length||0,updatedAt:r.updatedAt}));
  else if (c.op === 'topics.get') result = requireTopic();
  else if (c.op === 'nodes.list') result = (topicData(requireTopic()).tasks || []).filter(t=>!c.search || [t.title,t.description,t.nodeType,...followupKeys.map(key=>t[key])].join(' ').toLowerCase().includes(c.search.toLowerCase())).map(({id,title,description,parentIds,branch,nodeType,nodeStyle,status,categoryIds,createdAt,updatedAt,events,expectedOutput,nextStep,blocker,waitingFor})=>({expectedOutput,nextStep,blocker,waitingFor,id,title,description,parentIds:parentIds||[],branch:!!branch,nodeType,nodeStyle,status,categoryIds,createdAt,updatedAt,eventCount:events.length}));
  else if (c.op === 'nodes.get') result = requireNode();
  else if (c.op === 'topics.create') {
    const d = dataObject(c.data); keys(d,['id','title','workspaceId','question','hypothesis','conclusion','blocker','focus','nextStep','content']);
    const id = d.id === undefined ? `cli-topic-${requestId}` : text(d.id,'id');
    if (state.records.some(r=>r.id===id)) throw new CliError('CONFLICT','课题 ID 已存在');
    const typeId = state.types.find(t=>t.kind==='project')?.id, workspaceId = d.workspaceId ?? state.workspaces[0]?.id;
    if (!typeId || !state.workspaces.some(w=>w.id===workspaceId)) throw new CliError('INVALID_INPUT','课题类型或工作区不可用');
    const data = emptyTopic(); for(const key of ['question','hypothesis','conclusion','blocker','focus','nextStep'] as const) if(d[key]!==undefined)data[key]=text(d[key],key,true);
    const record: RecordItem = {id,typeId,workspaceId:workspaceId as string,title:text(d.title,'title'),content:d.content===undefined?'':text(d.content,'content',true),status:'active',starred:false,archived:false,fields:[],priority:'none',dueDate:null,done:false,planDate:null,planStart:null,planEnd:null,createdAt:now,updatedAt:now,topic:data};
    records = [record,...state.records]; result={topicId:id,updatedAt:now};
  } else if (c.op === 'topics.update') {
    const p = requireTopic(), d = dataObject(c.data); revision(c.expectUpdatedAt,p.updatedAt); keys(d,['title','content','question','hypothesis','conclusion','blocker','focus','nextStep']);
    const next={...p,topic:{...topicData(p)}};for(const key of ['title','content'] as const)if(d[key]!==undefined)next[key]=text(d[key],key,key!=='title');
    for(const key of ['question','hypothesis','conclusion','blocker','focus','nextStep'] as const)if(d[key]!==undefined)next.topic[key]=text(d[key],key,true);
    next.updatedAt=now;writeTopic(next);result={topicId:p.id,updatedAt:now};
  } else if (c.op === 'nodes.create') {
    const p=requireTopic(),d=dataObject(c.data);keys(d,[...nodeKeys,'id','status','source','events']);
    const id=d.id===undefined?`cli-node-${requestId}`:text(d.id,'id');
    if(d.events!==undefined&&!Array.isArray(d.events))throw new CliError('INVALID_INPUT','events 须为数组');
    const packet={protocol:TASK_PROTOCOL,action:'create_task',requestId,topicId:p.id,taskId:id,task:{...d,title:d.title,description:d.description===undefined?'':text(d.description,'description',true),categoryIds:d.categoryIds===undefined?[]:d.categoryIds,status:d.status===undefined?'running':d.status,createdAt:d.createdAt===undefined?new Date(now).toISOString():d.createdAt},events:Array.isArray(d.events)?d.events.map(normalizeEvent):[]};
    const plan=planTaskImport(JSON.stringify(packet),state.records,state.taskCategories,state.taskTemplates,now);
    if(!(topicData(p).tasks||[]).some(t=>t.id===id)){plan.task.notes=d.notes===undefined?'':text(d.notes,'notes',true);if(d.content!==undefined)plan.task.content=text(d.content,'content',true);}
    result=writeTask(p,plan.task);
  } else if (c.op === 'nodes.update') {
    const p=requireTopic(),task=requireNode();revision(c.expectUpdatedAt,task.updatedAt);
    const next=updatedNode(task,dataObject(c.data),topicData(p).tasks||[],state.taskCategories,now);
    result=next===task?{topicId:p.id,nodeId:task.id,updatedAt:task.updatedAt,unchanged:true}:writeTask(p,next);
  } else if (c.op === 'events.append') {
    const p=requireTopic(),task=requireNode();revision(c.expectUpdatedAt,task.updatedAt);const d=dataObject(c.data);
    const plan=planTaskImport(JSON.stringify({protocol:TASK_PROTOCOL,action:'append_events',requestId,topicId:p.id,taskId:task.id,events:Array.isArray(d.events)?d.events.map(normalizeEvent):[normalizeEvent(d)]}),state.records,state.taskCategories,state.taskTemplates,now);
    result={...writeTask(p,plan.task),added:plan.added,eventIds:plan.task.events.filter(e=>!task.events.some(old=>old.id===e.id)).map(e=>e.id)};
  } else if (c.op === 'events.update') {
    const p=requireTopic(),task=requireNode();revision(c.expectUpdatedAt,task.updatedAt);const event=task.events.find(e=>e.id===c.eventId);if(!event)throw new CliError('NOT_FOUND','记录不在指定节点中');
    const next=correctedEvent(event,dataObject(c.data),p,task,state,requestId,now),events=task.events.map(e=>e.id===event.id?next:e);
    const changed={...task,events,status:taskStatusFromEvents(events,task.status),updatedAt:now};
    if(!isResearchTasks([changed]) || !isTaskStatus(changed.status))throw new CliError('INVALID_INPUT','修正后的记录无效');
    result={...writeTask(p,changed),eventId:event.id};
  } else if (c.op === 'import.apply') {
    const packet=dataObject(c.data),p=projects.find(r=>r.id===packet.topicId);if(!p||p.archived)throw new CliError('NOT_FOUND','导入目标不是可用科研课题');
    const plan=planTaskImport(JSON.stringify(packet),state.records,state.taskCategories,state.taskTemplates,now);
    result={...writeTask(p,plan.task),added:plan.added,duplicate:plan.duplicate};
  } else throw new CliError('UNKNOWN_COMMAND',`不支持命令：${c.op}`);
  if (!mutating) return {result};
  const summary={...(result as Record<string,unknown>),requestId,dryRun,operation:c.op,...describeCliChanges(state.records,records)};
  if(dryRun)return {result:summary};
  return {result:summary,records,cliReceipts:[...(state.cliReceipts||[]).slice(-199),{requestId,fingerprint,result:summary,recordedAt:now}]};
}
