import { beforeEach, expect, it, vi } from 'vitest';
import { lineageFixture } from './lineageFixture';
import { lineageEdit, applyLineageEdit } from '../lineage-history';
import { moveLineageNode, removeLineageNode, appendLineageNode } from '../task-lineage';
import { commitLineageTasks, stepLineageHistory, useLineageSession, readLineageView, writeLineageView } from '../lineage-session';
import { readLineageDraft, writeLineageDraft, clearLineageDraft } from '../lineage-drafts';
import { lockCliNode, isCliNodeLocked } from '../research-cli-locks';
import { useStore } from '../store';

beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear(); useLineageSession.setState({ histories: {}, notice: null }); });
const tasks = () => lineageFixture().topic!.tasks!;
it('undo and redo restore merges, removals, ranks and creation without touching original time or evidence', () => {
  const before = tasks(), moved = moveLineageNode(before, 'external', { kind: 'after', nodeId: 'baseline' });
  const edit = lineageEdit(before, moved, '移动')!; expect(applyLineageEdit(moved, edit, 'undo')).toEqual(before);
  expect(applyLineageEdit(before, edit, 'redo')).toEqual(moved);
  const removed = removeLineageNode(before, 'download'), removal = lineageEdit(before, removed, '删除')!;
  expect(applyLineageEdit(removed, removal, 'undo')).toEqual(before);
  const created = appendLineageNode(before, { ...structuredClone(before[0]), id: 'new-node', parentIds: ['download'] });
  expect(applyLineageEdit(created, lineageEdit(before, created, '新增')!, 'undo')).toEqual(before);
});
it('graph undo preserves subsequent CLI progress and unrelated new nodes, but rejects edited graph fields', () => {
  const before = tasks(), moved = moveLineageNode(before, 'external', { kind: 'after', nodeId: 'baseline' }), edit = lineageEdit(before, moved, '移动')!;
  const current = structuredClone(moved), task = current.find(t => t.id === 'external')!;
  task.description = 'CLI 补齐的执行目的';task.events.push({...structuredClone(before[0].events[0]),id:'cli-result',title:'结果核查'});
  current.push({...structuredClone(before[0]),id:'unrelated',parentIds:[],title:'另一个独立任务'});
  const undone = applyLineageEdit(current, edit, 'undo'), restored = undone.find(t=>t.id==='external')!;
  expect(restored.parentIds).toEqual(before.find(t=>t.id==='external')!.parentIds);expect(restored.events).toEqual(task.events);expect(restored.description).toBe(task.description);expect(undone.at(-1)?.id).toBe('unrelated');
  task.parentIds=['question'];expect(()=>applyLineageEdit(current,edit,'undo')).toThrow('后续变更');
});
it('undo refuses to remove a newly created node with new progress or a new child', () => {
  const before=tasks(),created=appendLineageNode(before,{...structuredClone(before[0]),id:'new-node',parentIds:['download']}),edit=lineageEdit(before,created,'新增')!;
  const changed=structuredClone(created);changed.find(t=>t.id==='new-node')!.notes='补充内容';expect(()=>applyLineageEdit(changed,edit,'undo')).toThrow('后续变更');
  const child={...structuredClone(before[0]),id:'new-child',parentIds:['new-node']};expect(()=>applyLineageEdit([...created,child],edit,'undo')).toThrow('当前课题');
});
it('multiple undo/redo steps stay per topic; a new local edit clears redo and storage failure has no history', () => {
  const first=lineageFixture(),second={...structuredClone(first),id:'other'};useStore.setState({records:[first,second]});
  commitLineageTasks(first.id,t=>t.map(x=>x.id==='download'?{...x,description:'第一次'}:x),'编辑描述');
  commitLineageTasks(first.id,t=>t.map(x=>x.id==='download'?{...x,description:'第二次'}:x),'编辑描述');
  stepLineageHistory(first.id,'undo');stepLineageHistory(first.id,'undo');expect(useStore.getState().records[0].topic!.tasks).toEqual(first.topic!.tasks);
  stepLineageHistory(first.id,'redo');expect(useStore.getState().records[0].topic!.tasks!.find(t=>t.id==='download')!.description).toBe('第一次');
  commitLineageTasks(second.id,t=>removeLineageNode(t,'external'),'删除节点');expect(useLineageSession.getState().histories[first.id].redo).toHaveLength(1);
  commitLineageTasks(first.id,t=>t.map(x=>x.id==='download'?{...x,notes:'新修改'}:x));expect(useLineageSession.getState().histories[first.id].redo).toHaveLength(0);
  const snapshot=structuredClone(useStore.getState().records),history=useLineageSession.getState().histories;const original=Storage.prototype.setItem;let failed=false;
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){if(!failed){failed=true;throw new Error('quota');}return original.call(this,key,value);});
  expect(()=>commitLineageTasks(first.id,t=>removeLineageNode(t,'download'))).toThrow('quota');expect(useStore.getState().records).toEqual(snapshot);expect(useLineageSession.getState().histories).toEqual(history);
});
it('view settings and drafts tolerate corrupt storage; successful save/cancel clears the draft', () => {
  writeLineageView('a',{selected:'node',collapsed:['branch'],scrollTop:500,width:148,tabs:{node:'files'}});writeLineageView('b',{selected:'other'});
  expect(readLineageView('a')).toMatchObject({selected:'node',collapsed:['branch'],scrollTop:500,width:148,tabs:{node:'files'}});expect(readLineageView('b').selected).toBe('other');
  localStorage.setItem('research-lineage-view/a','invalid');expect(readLineageView('a').selected).toBe('');
  const baseline={title:'',time:'2026-10-31T10:05',fields:[]};clearLineageDraft('test-draft');
  writeLineageDraft('test-draft',{...baseline,title:'未完成输入'});expect(readLineageDraft('test-draft',baseline).title).toBe('未完成输入');clearLineageDraft('test-draft');expect(readLineageDraft('test-draft',baseline)).toEqual(baseline);
  sessionStorage.setItem('research-lineage-draft/bad',JSON.stringify({...baseline,fields:[{value:2}]}));expect(readLineageDraft('bad',baseline)).toEqual(baseline);
});
it('early editor unlock is idempotent and does not release another live editor', () => {
  const a=lockCliNode('locks','node'),b=lockCliNode('locks','node');a();a();expect(isCliNodeLocked('locks','node')).toBe(true);b();expect(isCliNodeLocked('locks','node')).toBe(false);
});
