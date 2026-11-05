import { describe, expect, it, vi, afterEach } from 'vitest';
import type { RecordItem } from '../types';
import { applyTodayData, isTodayData, mergeTodayImport, projectTodayData, type TodayData, type TodayTask } from '../today-data';
import { toggleTodayTask } from '../today-repeat';

const record = (id: string, patch: Partial<RecordItem> = {}): RecordItem => ({
  id, typeId: 'todo', workspaceId: 'work', title: `任务 ${id}`, content: '# 任务正文', status: 'paused',
  starred: true, archived: false, fields: [{ id: 'field', name: '领域', value: '研究' }], priority: 'high',
  dueDate: '2026-11-03', done: false, planDate: null, planStart: null, planEnd: null,
  createdAt: 100, updatedAt: 200, topicId: 'research-topic', ...patch,
});
const data = (records: RecordItem[] = []) => projectTodayData(records, 'todo');
const copy = <T,>(value: T): T => structuredClone(value);
const edit = (baseline: TodayData, id: string, patch: Partial<TodayTask>) => {
  const next = copy(baseline); Object.assign(next.tasks.find(task => task.id === id)!, patch); return next;
};
afterEach(() => vi.useRealTimers());

describe('原生待办与任务中心的安全投影', () => {
  it('包含所有工作区的活动待办，稳定映射 ID、日期、优先级且不带演示数据', () => {
    const records = [record('one', { planDate: '2026-11-01', planStart: '09:30', planEnd: '11:00' }), record('two', { workspaceId: 'life', priority: 'low', dueDate: null }), record('archived', { archived: true }), record('foreign', { typeId: 'project' })];
    const before = copy(records), projected = data(records);
    expect(projected.tasks.map(task => task.id)).toEqual(['one', 'two']);
    expect(projected.tasks[0]).toMatchObject({ priority: 1, startDate: '2026-11-01', dueDate: '2026-11-03', dueTime: '09:30', endTime: '11:00', workspaceId: 'work' });
    expect(projected.tasks[1]).toMatchObject({ priority: 3, dueDate: '', workspaceId: 'life' });
    expect(projected.settings.centerScale).toBe(1); expect(data().tasks).toEqual([]); expect(records).toEqual(before);
    expect(isTodayData(projected)).toBe(true);
  });

  it('外部改动覆盖原生字段，同时完整保留正文附件、清单、子任务、重复与规划元数据', () => {
    const records = [record('parent'), record('child')], stored = data(records);
    stored.folders[0].customFolder = { keep: true };
    stored.lists.push({ id: 'research', name: '研究', folderId: 'folder-default', groups: [{ id: 'group', name: '阅读' }], customList: ['keep'] });
    Object.assign(stored.tasks[0], { listId: 'research', groupId: 'group', tags: ['论文'], repeat: { type: 'weekly', days: [1, 3] }, attachments: ['evidence.pdf'], timelineRole: 'project', timelineItems: [{ id: 'phase', type: 'phase', title: '评估', startDate: '2026-11-01', endDate: '2026-11-04' }], customMetadata: { nested: [1, 2] } });
    stored.tasks[1].parentTaskId = 'parent';
    const before = copy(stored), projected = projectTodayData([record('parent', { title: '外部改名', content: '外部正文', done: true, priority: 'medium', updatedAt: 999 }), records[1]], 'todo', stored);
    expect(projected.tasks[0]).toMatchObject({ title: '外部改名', content: '外部正文', done: true, priority: 2, completedAt: 999, listId: 'research', groupId: 'group', tags: ['论文'], customMetadata: { nested: [1, 2] } });
    expect(projected.tasks[0].timelineItems).toEqual(stored.tasks[0].timelineItems); expect(projected.tasks[1].parentTaskId).toBe('parent');
    expect(projected.folders).toEqual(stored.folders); expect(projected.lists).toEqual(stored.lists); expect(stored).toEqual(before);
  });

  it('无修改往返不重写原生状态、工作区、自定义字段、课题关系或相同计划日期', () => {
    const records = [record('one', { planDate: '2026-11-03', order: 19 })], baseline = data(records);
    const incoming = edit(baseline, 'one', { tags: ['新标签'], attachments: ['asset.png'], extraDocument: { keep: 'yes' } });
    const result = applyTodayData(records, 'todo', incoming, baseline, 'fallback');
    expect(result.records).toBe(records); expect(result.records[0].planDate).toBe('2026-11-03');
    expect(result.data.tasks[0]).toMatchObject({ tags: ['新标签'], attachments: ['asset.png'], extraDocument: { keep: 'yes' } });
  });

  it('修改任务中心映射字段时只更新对应原生属性，保留其他记录属性', () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const records = [record('one')], baseline = data(records);
    const incoming = edit(baseline, 'one', { title: '新标题', content: '- [x] 证据', done: true, priority: 3, dueDate: '2026-11-08', startDate: '2026-11-05', dueTime: '14:00', endTime: '15:30' });
    const result = applyTodayData(records, 'todo', incoming, baseline, 'fallback');
    expect(result.records[0]).toEqual({ ...records[0], title: '新标题', content: '- [x] 证据', done: true, completedAt: 1000, priority: 'low', dueDate: '2026-11-08', planDate: '2026-11-05', planStart: '14:00', planEnd: '15:30', updatedAt: 1000 });
    expect(records[0].title).toBe('任务 one');
  });

  it('按字段合并并发编辑，同时补入外部新建记录', () => {
    const original = [record('one')], baseline = data(original), incoming = edit(baseline, 'one', { title: '中心改名', tags: ['保留'] });
    const current = [record('one', { content: '外部新正文', workspaceId: 'other', starred: false, updatedAt: 500 }), record('external')];
    const result = applyTodayData(current, 'todo', incoming, baseline, 'fallback');
    expect(result.records[0]).toMatchObject({ title: '中心改名', content: '外部新正文', workspaceId: 'other', starred: false });
    expect(result.data.tasks.map(task => task.id)).toEqual(['one', 'external']);
    expect(result.data.tasks[0]).toMatchObject({ title: '中心改名', content: '外部新正文', tags: ['保留'], workspaceId: 'other' });
  });

  it('同字段并发冲突原子拒绝，双方收敛到同一值则接受', () => {
    const baseline = data([record('one'), record('two')]), incoming = edit(edit(baseline, 'two', { title: '第二项改变' }), 'one', { title: '中心标题' });
    const current = [record('one', { title: '外部标题' }), record('two')], before = copy(current);
    expect(() => applyTodayData(current, 'todo', incoming, baseline, 'fallback')).toThrow('其他修改'); expect(current).toEqual(before);
    expect(applyTodayData([record('one', { title: '中心标题' }), record('two')], 'todo', incoming, baseline, 'fallback').records[0].title).toBe('中心标题');
  });

  it('删除仅作用于基线中的未变活动待办，保留归档、外部新增、其他类型与工作区属性', () => {
    const removed = record('removed'), archived = record('archived', { archived: true }), foreign = record('foreign', { typeId: 'schedule' }), external = record('external', { workspaceId: 'life' });
    const baseline = data([removed, archived, foreign]), incoming = copy(baseline); incoming.tasks = [];
    const records = [removed, archived, foreign, external], result = applyTodayData(records, 'todo', incoming, baseline, 'fallback');
    expect(result.records).toEqual([archived, foreign, external]); expect(result.data.tasks.map(task => task.id)).toEqual(['external']);
    expect(applyTodayData(records, 'todo', data(), data(), 'fallback').records).toBe(records);
    expect(() => applyTodayData([record('removed', { content: '外部改变' })], 'todo', incoming, baseline, 'fallback')).toThrow('其他修改');
  });

  it('外部归档或删除不会因旧页面保存而复活，被删除任务的新编辑则报告冲突', () => {
    const baseline = data([record('one')]);
    expect(applyTodayData([], 'todo', baseline, baseline, 'fallback').records).toEqual([]);
    expect(applyTodayData([record('one', { archived: true })], 'todo', baseline, baseline, 'fallback').records[0].archived).toBe(true);
    expect(() => applyTodayData([], 'todo', edit(baseline, 'one', { content: '迟到的修改' }), baseline, 'fallback')).toThrow('其他修改');
  });

  it('新任务生成原生基础字段，拒绝抢占其他类型、归档或并发新增的同名 ID', () => {
    const incoming = data([record('new', { dueDate: null, priority: 'medium' })]);
    delete incoming.tasks[0].workspaceId;
    const created = applyTodayData([], 'todo', incoming, data(), 'default-workspace').records[0];
    expect(created).toMatchObject({ id: 'new', typeId: 'todo', workspaceId: 'default-workspace', archived: false, starred: false, fields: [], priority: 'medium', dueDate: null, planDate: null, planStart: null, planEnd: null });
    for (const existing of [record('new', { typeId: 'project' }), record('new', { archived: true }), record('new')]) {
      expect(() => applyTodayData([existing], 'todo', incoming, data(), 'fallback')).toThrow();
    }
  });

  it('外部删除父任务后保留仍存子任务并安全解除失效关联', () => {
    const records = [record('parent'), record('child')], stored = data(records);
    stored.tasks[1].parentTaskId = 'parent'; stored.tasks[1].relatedTaskIds = ['parent'];
    const result = projectTodayData([records[1]], 'todo', stored);
    expect(result.tasks[0]).toMatchObject({ id: 'child', parentTaskId: null, relatedTaskIds: [] });
  });

  it('归档期间隐藏文档而保留元数据，保存后取消归档恢复父子和关联', () => {
    const records = [record('parent'), record('child')], initial = data(records);
    Object.assign(initial.tasks[0], { tags: ['保留'], attachments: ['result.csv'], repeat: { type: 'daily' }, timelineItems: [{ id: 'm', type: 'milestone', title: '发布', date: '2026-11-08' }], privateExtension: { keep: [1] } });
    Object.assign(initial.tasks[1], { parentTaskId: 'parent', relatedTaskIds: ['parent'] });
    const before = copy(initial), archived = [record('parent', { archived: true }), records[1]], hidden = projectTodayData(archived, 'todo', initial);
    expect(hidden.tasks).toHaveLength(1); expect(hidden.tasks[0]).toMatchObject({ id: 'child', parentTaskId: null, relatedTaskIds: [] });
    expect(isTodayData(hidden)).toBe(true); expect((hidden.workbenchHiddenTasks as TodayTask[]).find(task => task.id === 'parent')).toMatchObject({ privateExtension: { keep: [1] }, tags: ['保留'] });
    const saved = applyTodayData(archived, 'todo', edit(hidden, 'child', { content: '归档期间继续工作' }), hidden, 'fallback');
    const restored = projectTodayData(saved.records.map(item => ({ ...item, archived: false })), 'todo', saved.data);
    expect(restored.tasks[0]).toMatchObject({ tags: ['保留'], attachments: ['result.csv'], repeat: { type: 'daily' }, privateExtension: { keep: [1] } });
    expect(restored.tasks[0].timelineItems).toEqual(initial.tasks[0].timelineItems);
    expect(restored.tasks[1]).toMatchObject({ parentTaskId: 'parent', relatedTaskIds: ['parent'], content: '归档期间继续工作' });
    expect(restored.workbenchHiddenTasks).toBeUndefined(); expect(initial).toEqual(before);
  });

  it('真实完成时间优先于更新时间，历史完成时间未知时不凭空补造', () => {
    const baseline = data([record('one')]);
    expect(projectTodayData([record('one', { done: true, completedAt: 700, updatedAt: 900 })], 'todo', baseline).tasks[0].completedAt).toBe(700);
    expect(projectTodayData([record('one', { done: true, updatedAt: 900 })], 'todo', baseline).tasks[0].completedAt).toBe(900);
    expect(data([record('legacy', { done: true })]).tasks[0].completedAt).toBeNull();
    const known = data([record('one', { done: true, completedAt: 700 })]);
    expect(projectTodayData([record('one', { done: true, updatedAt: 2000 })], 'todo', known).tasks[0].completedAt).toBe(700);
    expect(projectTodayData([record('one', { done: false, completedAt: null, updatedAt: 2000 })], 'todo', known).tasks[0].completedAt).toBeNull();
    const completed = edit(baseline, 'one', { done: true, completedAt: 750 });
    const saved = applyTodayData([record('one')], 'todo', completed, baseline, 'fallback');
    expect(saved.records[0].completedAt).toBe(750);
    const noOp = applyTodayData(saved.records, 'todo', saved.data, saved.data, 'fallback');
    expect(noOp.records).toBe(saved.records);
    expect(applyTodayData(saved.records, 'todo', edit(saved.data, 'one', { done: false, completedAt: null }), saved.data, 'fallback').records[0].completedAt).toBeNull();
  });

  it('旧页面保存保留原生并发生成重复子树的完整文档与关系', () => {
    const records = [record('root'), record('child')], baseline = data(records);
    Object.assign(baseline.tasks[0], { repeat: { type: 'daily' }, tags: ['长期研究'], attachments: ['data.csv'], privateExtension: { keep: true } });
    Object.assign(baseline.tasks[1], { parentTaskId: 'root', relatedTaskIds: ['root'], tags: ['子任务'], content: '- [x] 已完成检查' });
    let sequence = 0;
    const completed = toggleTodayTask(baseline, 'root', new Date(2026, 10, 3, 12).getTime(), () => `repeat-${++sequence}`);
    const current = applyTodayData(records, 'todo', completed, baseline, 'fallback');
    const before = copy(current.data), stale = edit(baseline, 'child', { title: '旧页面继续改名' });
    const saved = applyTodayData(current.records, 'todo', stale, baseline, 'fallback', current.data);
    const parent = saved.data.tasks.find(task => task.id === 'repeat-1')!, child = saved.data.tasks.find(task => task.id === 'repeat-2')!;
    expect(parent).toMatchObject({ repeatSeriesId: 'root', repeat: { type: 'daily' }, tags: ['长期研究'], attachments: ['data.csv'], privateExtension: { keep: true } });
    expect(child).toMatchObject({ parentTaskId: parent.id, repeatSeriesId: 'child', relatedTaskIds: [parent.id], tags: ['子任务'], content: '- [ ] 已完成检查' });
    expect(saved.data.tasks.find(task => task.id === 'child')?.title).toBe('旧页面继续改名');
    expect(saved.data.tasks.find(task => task.id === 'root')?.done).toBe(true); expect(current.data).toEqual(before);
  });

  it('旧页面省略新归档缓存时仍保留它和新清单，并解除已合法删除的父引用', () => {
    const records = [record('root')], baseline = data(records), currentRecords = [records[0], record('extra'), record('archived', { archived: true })];
    const metadata = data([records[0], currentRecords[1], { ...currentRecords[2], archived: false }]);
    metadata.folders.push({ id: 'concurrent-folder', name: '新文件夹' });
    metadata.lists.push({ id: 'concurrent-list', name: '新清单', folderId: 'concurrent-folder', groups: [{ id: 'g', name: '新分组' }] });
    Object.assign(metadata.tasks[1], { parentTaskId: 'root', relatedTaskIds: ['root'], tags: ['并发新增'] });
    Object.assign(metadata.tasks[2], { listId: 'concurrent-list', groupId: 'g', attachments: ['archived.pdf'], privateExtension: { retained: true } });
    const current = projectTodayData(currentRecords, 'todo', metadata), deleted = copy(baseline); deleted.tasks = [];
    const saved = applyTodayData(currentRecords, 'todo', deleted, baseline, 'fallback', current);
    expect(saved.records.map(item => item.id)).toEqual(['extra', 'archived']);
    expect(saved.data.tasks[0]).toMatchObject({ id: 'extra', parentTaskId: null, relatedTaskIds: [], tags: ['并发新增'] });
    const archived = (saved.data.workbenchHiddenTasks as TodayTask[]).find(task => task.id === 'archived')!;
    expect(archived).toMatchObject({ listId: 'concurrent-list', groupId: 'g', attachments: ['archived.pdf'], privateExtension: { retained: true } });
    expect(saved.data.lists.some(list => list.id === 'concurrent-list')).toBe(true); expect(saved.data.folders.some(folder => folder.id === 'concurrent-folder')).toBe(true);
    expect(isTodayData(saved.data)).toBe(true);
  });
});

describe('任务中心验证与非破坏性导入', () => {
  it('无效日期、时间、优先级、重复 ID、未知引用和父子循环均拒绝且不写入记录', () => {
    const records = [record('one'), record('two')], baseline = data(records), before = copy(records);
    const invalid: TodayData[] = [
      edit(baseline, 'one', { dueDate: '2026-02-30' }), edit(baseline, 'one', { dueTime: '24:00' }), edit(baseline, 'one', { priority: 9 }),
      edit(baseline, 'one', { listId: 'missing' }), edit(baseline, 'one', { groupId: 'missing' }), edit(baseline, 'one', { parentTaskId: 'missing' }),
      edit(edit(baseline, 'one', { parentTaskId: 'two' }), 'two', { parentTaskId: 'one' }), edit(baseline, 'one', { repeat: { type: 'weekly', days: [7] } }),
    ];
    const duplicate = copy(baseline); duplicate.tasks.push(copy(duplicate.tasks[0])); invalid.push(duplicate);
    for (const candidate of invalid) {
      expect(isTodayData(candidate)).toBe(false);
      expect(() => applyTodayData(records, 'todo', candidate, baseline, 'fallback')).toThrow();
    }
    expect(records).toEqual(before); expect(isTodayData({ tasks: [] })).toBe(false);
    expect(() => projectTodayData(records, 'todo', { ...baseline, tasks: null } as unknown as TodayData)).toThrow();
  });

  it('冲突导入重映射清单、父子、关联与重复系列，保留文档和规划并保持幂等', () => {
    const current = data([record('parent')]);
    current.lists.push({ id: 'list', name: '本地清单', folderId: 'folder-default', groups: [] });
    const source = data([record('parent'), record('child')]);
    source.lists.push({ id: 'list', name: '导入清单', folderId: 'folder-default', groups: [{ id: 'g', name: '阶段' }] });
    Object.assign(source.tasks[0], { listId: 'list', groupId: 'g', title: '导入父任务', tags: ['导入'], attachments: ['note.pdf'], repeat: { type: 'monthly', days: [31] }, timelineItems: [{ id: 'm', type: 'milestone', title: '提交', date: '2026-11-30' }] });
    Object.assign(source.tasks[1], { listId: 'list', groupId: 'g', parentTaskId: 'parent', relatedTaskIds: ['parent'], repeatSeriesId: 'parent' });
    const before = copy(current), merged = mergeTodayImport(current, source), parent = merged.tasks.find(task => task.title === '导入父任务')!, child = merged.tasks.find(task => task.id === 'child')!;
    expect(current).toEqual(before); expect(merged.tasks[0]).toEqual(current.tasks[0]); expect(parent.id).not.toBe('parent');
    expect(parent.listId).not.toBe('list'); expect(child.parentTaskId).toBe(parent.id); expect(child.relatedTaskIds).toEqual([parent.id]); expect(child.repeatSeriesId).toBe(parent.id);
    expect(parent).toMatchObject({ tags: ['导入'], attachments: ['note.pdf'], repeat: { type: 'monthly', days: [31] } });
    expect(parent.timelineItems).toEqual(source.tasks[0].timelineItems); expect(merged.lists.find(list => list.id === parent.listId)?.groups[0].id).toBe('g');
    expect(mergeTodayImport(merged, source)).toEqual(merged); expect(isTodayData(merged)).toBe(true);
  });

  it('导入只补齐缺省新任务字段，畸形数组或错误值不得默默清空数据', () => {
    const current = data([record('local')]), raw = { version: 8, folders: [], lists: [{ id: 'inbox', name: '收集箱', system: true }], tasks: [{ id: 'imported', title: '新任务' }], settings: {} };
    const merged = mergeTodayImport(current, raw);
    expect(merged.tasks.find(task => task.id === 'imported')).toMatchObject({ title: '新任务', content: '', done: false, dueDate: '', dueTime: '', parentTaskId: null });
    for (const invalid of [{ tasks: [] }, { ...raw, tasks: 'bad' }, { ...raw, tasks: [{ id: 'bad', dueDate: '2026-13-01' }] }]) expect(() => mergeTodayImport(current, invalid)).toThrow();
    expect(current.tasks).toHaveLength(1);
  });
});
