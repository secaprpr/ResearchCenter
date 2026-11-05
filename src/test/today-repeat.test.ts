import { describe, expect, it } from 'vitest';
import { projectTodayData, type TodayData } from '../today-data';
import { toggleTodayTask } from '../today-repeat';

const localTime = (year: number, month: number, day: number) => new Date(year, month - 1, day, 12).getTime();
const fixture = (dueDate: string, repeat: unknown): TodayData => ({
  ...projectTodayData([], 'todo'),
  tasks: [{ id: 'root', title: '循环工作', content: '- [x] 已完成检查\n1. [X] 第二项\n\n普通正文', done: false, priority: 1, listId: 'inbox', groupId: null, parentTaskId: null, startDate: '', dueDate, dueTime: '09:00', endTime: '10:00', tags: ['研究'], repeat, workspaceId: 'research', createdAt: 10, updatedAt: 20 }],
});
const allocator = () => { let sequence = 0; return () => `next-${++sequence}`; };

describe('原生完成操作保留 Today 重复任务语义', () => {
  it('每月 31 日跳过没有该日期的月份，提前完成也从原定日期之后生成', () => {
    const source = fixture('2026-01-31', { type: 'monthly', days: [31] });
    const result = toggleTodayTask(source, 'root', localTime(2026, 1, 31), allocator());
    expect(result.tasks[0].dueDate).toBe('2026-03-31');
    expect(toggleTodayTask(fixture('2026-12-31', { type: 'daily' }), 'root', localTime(2026, 11, 3), allocator()).tasks[0].dueDate).toBe('2027-01-01');
  });

  it('逾期每周任务从真实完成日之后找下个所选星期，不生成积压实例', () => {
    const source = fixture('2026-10-19', { type: 'weekly', days: [1, 3] });
    const result = toggleTodayTask(source, 'root', localTime(2026, 11, 3), allocator());
    expect(result.tasks).toHaveLength(2); expect(result.tasks[0].dueDate).toBe('2026-11-04');
    expect(result.tasks.find(task => task.id === 'root')).toMatchObject({ done: true, completedAt: localTime(2026, 11, 3) });
  });

  it('克隆完整子树、重新映射关系、清空检查状态并等距移动所有日期与规划', () => {
    const source = fixture('2026-11-03', { type: 'daily' });
    Object.assign(source.tasks[0], { startDate: '2026-11-01', windowStart: '2026-11-02', windowEnd: '2026-11-05', attachments: ['data.csv'], relatedTaskIds: ['child', 'outside'], timelineItems: [{ id: 'phase', type: 'phase', title: '阶段', startDate: '2026-11-02', endDate: '2026-11-03' }, { id: 'milestone', type: 'milestone', title: '提交', date: '2026-11-05' }], customMetadata: { keep: [1] } });
    source.tasks.push({ ...structuredClone(source.tasks[0]), id: 'child', title: '子任务', parentTaskId: 'root', repeat: null, startDate: '', dueDate: '2026-11-04', done: true, relatedTaskIds: ['root'], timelineItems: [], checklist: [{ id: 'check', text: '旧检查项', done: true }] });
    source.tasks.push({ ...structuredClone(source.tasks[1]), id: 'grandchild', title: '孙任务', parentTaskId: 'child', dueDate: '', startDate: '', relatedTaskIds: [], checklist: [] });
    source.tasks.push({ ...structuredClone(source.tasks[1]), id: 'outside', title: '无关任务', parentTaskId: null, dueDate: '2026-11-03', relatedTaskIds: [], checklist: [] });
    const before = structuredClone(source), now = localTime(2026, 11, 3), result = toggleTodayTask(source, 'root', now, allocator());
    const copies = result.tasks.filter(task => task.id.startsWith('next-')), parent = copies.find(task => task.title === '循环工作')!, child = copies.find(task => task.title === '子任务')!, grandchild = copies.find(task => task.title === '孙任务')!;
    expect(copies).toHaveLength(3); expect(child.parentTaskId).toBe(parent.id); expect(grandchild.parentTaskId).toBe(child.id);
    expect(parent.relatedTaskIds).toEqual([child.id, 'outside']); expect(child.relatedTaskIds).toEqual([parent.id]);
    expect(parent).toMatchObject({ startDate: '2026-11-02', dueDate: '2026-11-04', windowStart: '2026-11-03', windowEnd: '2026-11-06', dueTime: '09:00', endTime: '10:00', repeatSeriesId: 'root', workspaceId: 'research', attachments: ['data.csv'], customMetadata: { keep: [1] }, done: false, completedAt: null, createdAt: now, updatedAt: now });
    expect(child.dueDate).toBe('2026-11-05'); expect(grandchild.dueDate).toBe('');
    expect(parent.content).toBe('- [ ] 已完成检查\n1. [ ] 第二项\n\n普通正文');
    expect((child.checklist as { id: string; done: boolean }[])[0]).toMatchObject({ done: false }); expect((child.checklist as { id: string }[])[0].id).not.toBe('check');
    expect(parent.timelineItems).toEqual([expect.objectContaining({ type: 'phase', startDate: '2026-11-03', endDate: '2026-11-04' }), expect.objectContaining({ type: 'milestone', date: '2026-11-06' })]);
    expect(result.tasks.find(task => task.id === 'outside')).toEqual(source.tasks.find(task => task.id === 'outside')); expect(source).toEqual(before);
  });

  it('恢复完成状态不会再创建实例，已有系列 ID 保持稳定，无日期不会生成重复', () => {
    const source = fixture('2026-11-03', { type: 'daily' }); source.tasks[0].repeatSeriesId = 'original-series';
    const completed = toggleTodayTask(source, 'root', localTime(2026, 11, 3), allocator());
    expect(completed.tasks[0].repeatSeriesId).toBe('original-series');
    const restored = toggleTodayTask(completed, 'root', localTime(2026, 11, 4), allocator());
    expect(restored.tasks).toHaveLength(2); expect(restored.tasks.find(task => task.id === 'root')).toMatchObject({ done: false, completedAt: null, updatedAt: localTime(2026, 11, 4) });
    expect(toggleTodayTask(fixture('', { type: 'daily' }), 'root', localTime(2026, 11, 3), allocator()).tasks).toHaveLength(1);
  });

  it('拒绝无效输入和重复 ID，不改变源任务', () => {
    const source = fixture('2026-11-03', { type: 'daily' }), before = structuredClone(source);
    expect(() => toggleTodayTask(source, 'missing', localTime(2026, 11, 3), allocator())).toThrow('不存在');
    expect(() => toggleTodayTask(source, 'root', NaN, allocator())).toThrow('时间无效');
    expect(() => toggleTodayTask(source, 'root', localTime(2026, 11, 3), () => 'root')).toThrow('唯一 ID');
    expect(source).toEqual(before);
  });
});
