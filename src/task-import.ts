import type { RecordItem } from './types';
import { topicData } from './topics';
import { checkTaskParents } from './task-lineage';
import { appendTaskEvents, isTaskField, isTaskStatus, parseTaskTime, safeTaskUrl, type ResearchTask, type TaskCategory, type TaskEvent, type TaskTemplate } from './research-tasks';

export const TASK_PROTOCOL = 'research-workbench.task.v1';
export interface TaskImportPlan { topicId: string; task: ResearchTask; action: 'create_task' | 'append_events'; added: number; duplicate: boolean }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, label: string, optional = false) => { if ((v === undefined || v === '') && optional) return ''; if (typeof v !== 'string' || !v.trim() || v.length > 50000) throw new Error(`${label}无效`); return v.trim(); };
export function planTaskImport(input: string, records: RecordItem[], categories: TaskCategory[], templates: TaskTemplate[], now = Date.now()): TaskImportPlan {
  if (input.length > 1000000) throw new Error('记录超过 1 MB');
  const fenced = input.trim().match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  let p: unknown; try { p = JSON.parse(fenced ? fenced[1] : input); } catch { throw new Error('无法读取 JSON 记录'); }
  if (!object(p) || p.protocol !== TASK_PROTOCOL || !['create_task', 'append_events'].includes(String(p.action))) throw new Error('记录协议或操作类型不正确');
  const topicId = str(p.topicId, '课题 ID'), taskId = str(p.taskId, '任务 ID'), requestId = str(p.requestId, '请求 ID');
  const record = records.find(r => r.id === topicId); if (!record) throw new Error('目标课题不存在');
  if (!Array.isArray(p.events) || p.events.length > 500) throw new Error('时间线记录须为数组，最多 500 条');
  const events: TaskEvent[] = p.events.map((raw, index) => {
    if (!object(raw)) throw new Error(`第 ${index + 1} 条记录无效`);
    const templateId = str(raw.templateId, '模板 ID', true), current = templates.find(t => t.id === templateId);
    const snapshot = raw.templateSnapshot;
    const fields = object(snapshot) && Array.isArray(snapshot.fields) ? snapshot.fields : current?.fields;
    if (templateId && !fields) throw new Error(`模板不存在：${templateId}`);
    if (fields && (!fields.every(isTaskField) || new Set(fields.map(f => f.id)).size !== fields.length)) throw new Error('模板字段快照无效');
    const version = object(snapshot) ? snapshot.version : raw.templateVersion ?? current?.version ?? 1;
    if (!Number.isInteger(version) || Number(version) < 1 || (!snapshot && current && version !== current.version)) throw new Error('模板已变更，请附上原模板快照');
    if (raw.occurredAt !== null && typeof raw.occurredAt !== 'string') throw new Error('缺少事件发生时间；无法确认时请填写 null');
    if (raw.status !== undefined && !isTaskStatus(raw.status)) throw new Error('事件状态无效');
    if (!object(raw.fields ?? {})) throw new Error('记录字段须为对象');
    const values = (raw.fields ?? {}) as Record<string, unknown>;
    if (Object.keys(values).some(id => !fields?.some(f => f.id === id))) throw new Error('存在未定义的字段');
    return { id: raw.id ? str(raw.id, '事件 ID') : `${requestId}:${index}`, title: str(raw.title, '事件标题'), description: str(raw.description, '事件描述', true), occurredAt: raw.occurredAt === null ? null : parseTaskTime(raw.occurredAt as string), recordedAt: now, source: str(raw.source ?? 'Codex', '记录来源'), evidence: str(raw.evidence, '时间依据', true), templateId, templateVersion: Number(version), ...(isTaskStatus(raw.status) ? { status: raw.status } : {}), fields: (fields || []).flatMap(f => {
      const value = values[f.id]; if ((value === undefined || value === '') && !f.required) return [];
      if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`请填写${f.label}`);
      const text = String(value); if (!text.trim() || text.length > 50000) throw new Error(`${f.label}无效`);
      if (f.type === 'number' && !Number.isFinite(Number(text))) throw new Error(`${f.label}须为数值`);
      if (f.type === 'url' && !safeTaskUrl(text)) throw new Error(`${f.label}须为 http(s) 链接`);
      if (f.type === 'date') { try { parseTaskTime(`${text}T00:00:00+08:00`); } catch { throw new Error(`${f.label}须为有效日期`); } }
      return [{ id: f.id, label: f.label, type: f.type, value: text }];
    }) };
  });
  if (new Set(events.map(e => e.id)).size !== events.length) throw new Error('事件 ID 重复');
  if (records.some(r => r.id !== topicId && topicData(r).tasks?.some(t => t.id === taskId))) throw new Error('任务 ID 已被其他课题使用');
  const existing = topicData(record).tasks?.find(t => t.id === taskId);
  if (p.action === 'append_events') {
    if (!existing) throw new Error('任务不存在，无法追加记录');
    if (!events.length) throw new Error('没有可追加的记录');
    const next = appendTaskEvents(existing, events, now);
    return { topicId, task: next, action: 'append_events', added: next.events.length - existing.events.length, duplicate: next === existing };
  }
  if (existing) {
    if (existing.importKey !== requestId) throw new Error('任务 ID 已存在，请使用追加记录');
    const next = appendTaskEvents(existing, events, now);
    return { topicId, task: next, action: 'create_task', added: next.events.length - existing.events.length, duplicate: next === existing };
  }
  if (!object(p.task)) throw new Error('缺少任务信息');
  const t = p.task;
  if (t.parentIds !== undefined && (!Array.isArray(t.parentIds) || !t.parentIds.every(id => typeof id === 'string'))) throw new Error('前置节点须为 ID 数组');
  const parentIds = (t.parentIds || []) as string[];
  checkTaskParents(topicData(record).tasks || [], taskId, parentIds);
  if (t.nodeType !== undefined && (typeof t.nodeType !== 'string' || t.nodeType.length > 100)) throw new Error('节点类型无效');
  if (t.version !== undefined && (typeof t.version !== 'string' || t.version.length > 100)) throw new Error('节点版本无效');
  if (t.nodeStyle !== undefined && !['standard', 'milestone', 'snapshot'].includes(String(t.nodeStyle))) throw new Error('节点样式无效');
  if (t.branch !== undefined && typeof t.branch !== 'boolean') throw new Error('节点轨道无效');
  if (!Array.isArray(t.categoryIds) || !t.categoryIds.every(id => typeof id === 'string' && categories.some(c => c.id === id))) throw new Error('任务标签无效');
  if (!isTaskStatus(t.status)) throw new Error('任务状态无效');
  const task: ResearchTask = { id: taskId, title: str(t.title, '任务名称'), description: str(t.description, '任务描述', true), categoryIds: [...new Set(t.categoryIds as string[])], status: t.status, createdAt: parseTaskTime(str(t.createdAt, '创建时间')), recordedAt: now, updatedAt: now, source: str(t.source ?? 'Codex', '创建来源'), notes: '', events: [], assetIds: [], paperIds: [], links: [], comments: [], importKey: requestId };
  Object.assign(task, { parentIds, ...(t.nodeType !== undefined ? { nodeType: t.nodeType } : {}), ...(t.nodeStyle !== undefined ? { nodeStyle: t.nodeStyle } : {}), ...(t.branch !== undefined ? { branch: t.branch } : {}), ...(t.version !== undefined ? { version: t.version } : {}) });
  for (const key of ['expectedOutput','nextStep','blocker','waitingFor'] as const) if (t[key] !== undefined) task[key] = str(t[key], key, true);
  return { topicId, task: appendTaskEvents(task, events, now), action: 'create_task', added: events.length, duplicate: false };
}
export function taskPrompt(topic: RecordItem, task: ResearchTask | undefined, categories: TaskCategory[], templates: TaskTemplate[], requestId: string, taskId: string): string {
  const usable = templates.filter(t => !t.archived), sample = usable.find(t => !t.categoryIds.length) || usable[0];
  const example = { protocol: TASK_PROTOCOL, requestId, action: task ? 'append_events' : 'create_task', topicId: topic.id, taskId: task?.id || taskId,
    ...(!task ? { task: { title: '填写本任务名称', description: '执行目的', categoryIds: [], createdAt: '实际创建时间，ISO 8601 +08:00', status: 'running', source: 'Codex', nodeType: '工作记录', nodeStyle: 'standard', parentIds: [], branch: false, version: '' } } : {}),
    events: [{ id: `${requestId}:1`, title: '填写实际进展', occurredAt: null, source: 'Codex', evidence: '', description: '', templateId: sample?.id || '', templateVersion: sample?.version || 1, ...(sample ? { templateSnapshot: { version: sample.version, fields: sample.fields } } : {}), fields: {} }] };
  return `请整理当前工作，并仅输出一个 JSON 代码块，供科研工作台导入。\n课题：${topic.title}\n${task ? `目标任务：${task.title}\n目的：${task.description}\n现有记录：${task.events.map(e => `${e.id} ${e.title} ${e.occurredAt === null ? '时间未知' : new Date(e.occurredAt).toISOString()}`).join('\n')}\n只追加新事件，保留目标 taskId。` : '创建一个任务，将开始、进展、检查、完成等过程记录为独立事件。'}\n\n时间使用实际发生时间，带时区；优先核查日志、输出文件或任务记录。无法确认时 occurredAt 填 null，禁止用本次询问时间冒充完成时间。evidence 填写时间依据。recordedAt 由软件写入，无需提供。\n标签是可组合的类别，不是分组；categoryIds 可同时包含大类和小类 ID。\n节点类型 nodeType 可自由命名；nodeStyle 使用 standard / milestone / snapshot，version 可记录版本。parentIds 是本课题前置节点 ID 数组，多个 ID 表示汇合；branch=true 表示并行分支。没有依据时留空，禁止自行推断依赖。已有任务的 append_events 仅追加事件，不更改关系。\n可接续节点：${JSON.stringify((topicData(topic).tasks || []).map(t => ({ id: t.id, title: t.title, parentIds: t.parentIds || [] })))}\n状态值：pending / running / completed / paused / cancelled。事件可附 status 表示该时刻的状态改变。不要将进度推测为完成。\n字段使用模板中的字段 ID，保留 templateSnapshot（version 和 fields），未填写的非必填字段可省略。同一事件 ID 不可复用为不同内容。不要更改 protocol、requestId、topicId、taskId。\n\n可用标签：\n${JSON.stringify(categories.filter(c => !c.archived))}\n\n可用事件模板：\n${JSON.stringify(usable)}\n\n输出结构：\n${JSON.stringify(example, null, 2)}`;
}
