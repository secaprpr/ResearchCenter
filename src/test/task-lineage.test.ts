import { describe, expect, it } from 'vitest';
import type { ResearchTask } from '../research-tasks';
import { checkTaskParents, cloneLineageTasks, insertLineageNode, lineageOrder, lineageRows, moveLineageNode, removeLineageNode } from '../task-lineage';
import { moveResearchTasks } from '../task-operations';
import { useStore } from '../store';
import { emptyTopic } from '../topics';
import { defaultCategories, defaultTemplates, isResearchTasks } from '../research-tasks';
import { planTaskImport, taskPrompt, TASK_PROTOCOL } from '../task-import';

const node = (id: string, time: number, parentIds: string[] = [], branch = false): ResearchTask => ({ id, title: id, description: '', createdAt: time, updatedAt: time, recordedAt: time, status:'running', categoryIds:[], source:'手动', notes:'', events:[], assetIds:[], paperIds:[], links:[], comments:[], parentIds, branch });
const nodes = () => [node('root',1), node('main',2,['root']), node('side',3,['root'],true), node('side2',4,['side']), node('merge',5,['main','side2']), node('next',6,['merge'])];
describe('研究脉络关系', () => {
  it('在线段上原子插入，保留合流的其他前置及原始记录时间', () => {
    const data = nodes(), before = structuredClone(data), added = node('insert', 99);
    const after = insertLineageNode(data, added, {from:'main',to:'merge'});
    expect(after.find(t=>t.id==='merge')!.parentIds).toEqual(['insert','side2']);
    expect(after.find(t=>t.id==='insert')!.parentIds).toEqual(['main']);
    expect(after.find(t=>t.id==='insert')!.createdAt).toBe(99);
    const order=lineageOrder(after).map(t=>t.id);expect(order.indexOf('insert')+1).toBe(order.indexOf('merge'));
    expect(data).toEqual(before);
    expect(()=>insertLineageNode(data, added, {from:'root',to:'merge'})).toThrow('连接线');
  });
  it('移动单节点接回原路径，插入目标线段并保留数据与时间', () => {
    const data=nodes(); data[2].notes='保留笔记';
    const after=moveLineageNode(data,'side',{kind:'edge',from:'main',to:'merge'});
    expect(after.find(t=>t.id==='side2')!.parentIds).toEqual(['root']);
    expect(after.find(t=>t.id==='merge')!.parentIds).toEqual(['side','side2']);
    expect(after.find(t=>t.id==='side')!).toMatchObject({parentIds:['main'],notes:'保留笔记',createdAt:3,updatedAt:3,recordedAt:3});
    const order=lineageOrder(after).map(t=>t.id);expect(order.indexOf('side')+1).toBe(order.indexOf('merge'));expect(order.indexOf('side')).toBeGreaterThan(order.indexOf('main'));
    const continued=lineageOrder(moveLineageNode(data,'side',{kind:'after',nodeId:'main'})).map(t=>t.id);expect(continued.indexOf('main')+1).toBe(continued.indexOf('side'));
    expect(()=>moveLineageNode(data,'root',{kind:'after',nodeId:'merge'})).toThrow('循环');
    expect(()=>moveLineageNode(data,'side',{kind:'edge',from:'root',to:'side'})).toThrow('连接线');
    expect(moveLineageNode(data,'side',{kind:'after',nodeId:'root'})).toBe(data);
  });
  it('删除仅连接到前置，合流去重，末端改独立节点而不丢失后续工作', () => {
    const data=nodes();
    const after=removeLineageNode(data,'merge');
    expect(after.find(t=>t.id==='next')!.parentIds).toEqual(['main','side2']);
    expect(removeLineageNode(data,'root').find(t=>t.id==='main')!.parentIds).toEqual([]);
    const root=moveLineageNode(data,'side',{kind:'root'});
    expect(root.find(t=>t.id==='side')!.parentIds).toEqual([]);
    expect(root.find(t=>t.id==='side2')!.parentIds).toEqual(['root']);
    const merge=[node('a',1),node('b',2,['a']),node('c',3,['a','b'])];
    expect(removeLineageNode(merge,'b').find(t=>t.id==='c')!.parentIds).toEqual(['a']);
  });
  it('保留独立旧节点，不凭时间推断依赖；拓扑排序不受数组和补录时间顺序影响', () => {
    const data=nodes(); data[1].createdAt=0;
    expect(lineageOrder([...data].reverse()).map(t=>t.id)).toEqual(['root','main','side','side2','merge','next']);
    expect(lineageRows([node('old',1),node('other',2)],new Set()).lanes.get('other')).toBe(0);
    expect(isResearchTasks([{...node('old',1), parentIds:undefined, branch:undefined}])).toBe(true);
  });
  it('拒绝自环、循环、失效和重复前置节点', () => {
    const data=nodes();
    expect(()=>checkTaskParents(data,'root',['root'])).toThrow('自己');
    expect(()=>checkTaskParents(data,'root',['merge'])).toThrow('循环');
    expect(()=>checkTaskParents(data,'next',['unknown'])).toThrow('当前课题');
    expect(()=>checkTaskParents(data,'next',['main','main'])).toThrow('重复');
    expect(()=>checkTaskParents(data,'new',['main','side'])).not.toThrow();
  });
  it('折叠分支仅隐藏独占后续，汇合及后续主线保留；主干筛选跳过并行节点', () => {
    const data=nodes();
    expect(lineageRows(data,new Set(['side'])).visible.map(t=>t.id)).toEqual(['root','main','side','merge','next']);
    expect(lineageRows(data,new Set(['root'])).visible.map(t=>t.id)).toEqual(['root']);
    expect(lineageRows(data,new Set(),true).visible.map(t=>t.id)).toEqual(['root','main','merge','next']);
  });
  it('复制课题重映射节点关系，批量移动保留同行关系并清除跨课题悬空关系', () => {
    let i=0; const copy=cloneLineageTasks(nodes(),()=>`copy-${++i}`);
    expect(copy[4].parentIds).toEqual([copy[1].id,copy[3].id]);
    const store=useStore.getState(), a=store.addRecord({typeId:'project',title:'A',topic:{...emptyTopic(),tasks:nodes()}}), b=store.addRecord({typeId:'project',title:'B',topic:emptyTopic()});
    const moved=moveResearchTasks([a,b],[{topicId:a.id,taskId:'side'},{topicId:a.id,taskId:'side2'}],b.id,10,()=>`new-${++i}`);
    expect(moved[1].topic!.tasks!.map(t=>t.parentIds)).toEqual([[],['side']]);
    expect(moved[0].topic!.tasks!.find(t=>t.id==='merge')!.parentIds).toEqual(['main']);
  });
  it('Prompt 和导入支持自定义节点、汇合和版本，拒绝外课题前置节点，事件追加保留关系', () => {
    const record=useStore.getState().addRecord({typeId:'project',title:'脉络',topic:{...emptyTopic(),tasks:nodes()}});
    const packet={ protocol:TASK_PROTOCOL,action:'create_task',requestId:'r',topicId:record.id,taskId:'snapshot',task:{title:'冻结快照',description:'',categoryIds:[],status:'completed',createdAt:'2026-10-29T10:00:00+08:00',nodeType:'复现版本',nodeStyle:'snapshot',version:'v0.2',parentIds:['main','side2'],branch:false},events:[] };
    const result=planTaskImport(JSON.stringify(packet),[record],defaultCategories(),defaultTemplates());
    expect(result.task.parentIds).toEqual(['main','side2']); expect(result.task.version).toBe('v0.2'); expect(isResearchTasks([result.task])).toBe(true);
    expect(()=>planTaskImport(JSON.stringify({...packet,task:{...packet.task,parentIds:['outside']}}),[record],[],[])).toThrow('当前课题');
    expect(taskPrompt(record,undefined,[],[],'r','new')).toContain('"parentIds"');
    record.topic!.tasks!.push(result.task);
    const appended=planTaskImport(JSON.stringify({protocol:TASK_PROTOCOL,action:'append_events',requestId:'r2',topicId:record.id,taskId:'snapshot',events:[{id:'event',title:'复现完成',occurredAt:null,fields:{}}]}),[record],[],[]);
    expect(appended.task.parentIds).toEqual(['main','side2']); expect(appended.task.version).toBe('v0.2');
  });
});
