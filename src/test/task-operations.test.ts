import { describe, expect, it } from 'vitest';
import type { RecordItem } from '../types';
import type { ResearchTask } from '../research-tasks';
import { emptyTopic, type TopicAsset } from '../topics';
import { changeTaskStatuses, moveResearchTasks } from '../task-operations';

let sequence = 0;
const nextId = () => `fresh-${++sequence}`;
const task = (id: string): ResearchTask => ({ id, title: id, description: '执行目的', content: '## 原始证据', notes: '需要复核', categoryIds: ['data'], status: 'running', createdAt: 100, updatedAt: 200, recordedAt: 300, source: 'Codex', importKey: `request-${id}`, events: [{ id: `event-${id}`, title: '开始下载', description: '', occurredAt: 100, recordedAt: 300, source: 'Codex', evidence: 'download.log', templateId: '', templateVersion: 1, fields: [] }], assetIds: [], paperIds: ['Research/Papers/evidence.md'], links: [{ id: 'link', label: '来源', url: 'https://example.org/data' }], comments: [{ id: 'comment', body: '保留日志', author: '我', createdAt: 200 }] });
const asset = (id: string, path: string): TopicAsset => ({ id, title: 'manifest.csv', kind: 'dataset', version: 'v1', location: '', notes: '', vaultPath: path, filename: 'manifest.csv', size: 50, createdAt: 100, updatedAt: 200 });
const topic = (id: string, tasks: ResearchTask[] = [], assets: TopicAsset[] = []): RecordItem => ({ id, title: id, typeId: 'project', workspaceId: `workspace-${id}`, content: '课题笔记', status: 'active', starred: false, archived: false, fields: [], priority: 'none', dueDate: null, done: false, planDate: null, planStart: null, planEnd: null, createdAt: 1, updatedAt: 2, topic: { ...emptyTopic(), tasks, assets } });

describe('课题间任务操作', () => {
  it('移动保留稳定 ID、事件时间、笔记与关联，同时保留源文件索引和原路径', () => {
    const original = { ...task('download'), assetIds: ['manifest'] }, source = topic('A', [original], [asset('manifest', 'Research/Topic Assets/A/manifest.csv')]), target = topic('B');
    const records = [source, target], before = structuredClone(records), result = moveResearchTasks(records, [{ topicId: 'A', taskId: 'download' }], 'B', 1000, nextId);
    expect(records).toEqual(before); expect(result[0].topic!.tasks).toEqual([]); expect(result[0].topic!.assets).toEqual(source.topic!.assets);
    expect(result[1].topic!.tasks![0]).toEqual({ ...original, updatedAt: 1000 }); expect(result[1].topic!.assets[0].vaultPath).toBe(source.topic!.assets[0].vaultPath); expect(result[1].createdAt).toBe(1);
  });
  it('批量移动共享文件只复制一次索引，发生文件 ID 冲突时重映射而不覆盖目标', () => {
    const originalAsset = asset('shared', 'Research/Topic Assets/A/original.csv'), unrelated = asset('shared', 'Research/Topic Assets/B/other.csv');
    const records = [topic('A', [{ ...task('one'), assetIds: ['shared'] }, { ...task('two'), assetIds: ['shared'] }], [originalAsset]), topic('B', [{ ...task('existing'), assetIds: ['shared'] }], [unrelated])];
    const result = moveResearchTasks(records, [{ topicId: 'A', taskId: 'one' }, { topicId: 'A', taskId: 'two' }], 'B', 1000, nextId), target = result[1].topic!;
    expect(target.assets).toHaveLength(2); expect(target.assets[0]).toEqual(unrelated); expect(target.tasks![0].assetIds).toEqual(['shared']);
    expect(target.tasks![1].assetIds[0]).not.toBe('shared'); expect(target.tasks![2].assetIds).toEqual(target.tasks![1].assetIds); expect(target.assets[1].vaultPath).toBe(originalAsset.vaultPath);
  });
  it('多源移动不会把失效的源文件引用误连到目标的同名 ID', () => {
    const records = [topic('A', [{ ...task('one'), assetIds: ['missing'] }]), topic('B', [], [asset('missing', 'Research/Topic Assets/B/other.csv')])];
    const result = moveResearchTasks(records, [{ topicId: 'A', taskId: 'one' }], 'B', 1000, nextId), id = result[1].topic!.tasks![0].assetIds[0];
    expect(id).not.toBe('missing'); expect(result[1].topic!.assets).toHaveLength(1); expect(result[1].topic!.assets.some(a => a.id === id)).toBe(false);
  });
  it('全部验证后才提交；拒绝归档、错误类型、重复任务 ID 及已经失效的选择', () => {
    const records = [topic('A', [task('one')]), topic('B')], before = structuredClone(records);
    expect(() => moveResearchTasks(records, [{ topicId: 'A', taskId: 'one' }, { topicId: 'A', taskId: 'missing' }], 'B', 1000, nextId)).toThrow('重新选择');
    expect(() => moveResearchTasks([records[0], { ...records[1], archived: true }], [{ topicId: 'A', taskId: 'one' }], 'B', 1000, nextId)).toThrow('不可用');
    expect(() => moveResearchTasks([records[0], { ...records[1], typeId: 'todo' }], [{ topicId: 'A', taskId: 'one' }], 'B', 1000, nextId)).toThrow('同类型');
    expect(() => moveResearchTasks([records[0], topic('B', [task('one')])], [{ topicId: 'A', taskId: 'one' }], 'B', 1000, nextId)).toThrow('相同 ID'); expect(records).toEqual(before);
    expect(moveResearchTasks(records, [{ topicId: 'A', taskId: 'one' }], 'A', 1000, nextId)).toBe(records);
  });
  it('批量状态更新只记录真正变化的任务，不重写已完成任务的历史', () => {
    const completed = { ...task('done'), status: 'completed' as const }, records = [topic('A', [task('one'), completed]), topic('B', [task('two')])];
    const result = changeTaskStatuses(records, [{ topicId: 'A', taskId: 'one' }, { topicId: 'A', taskId: 'done' }, { topicId: 'B', taskId: 'two' }], 'completed', 1000, nextId);
    expect(result[0].topic!.tasks![0].events.at(-1)?.occurredAt).toBe(1000); expect(result[1].topic!.tasks![0].events).toHaveLength(2); expect(result[0].topic!.tasks![1]).toBe(completed); expect(records[0].topic!.tasks![0].status).toBe('running');
    expect(changeTaskStatuses(result, [{ topicId: 'A', taskId: 'done' }], 'completed', 2000, nextId)).toBe(result);
  });
  it('状态更新按课题和任务成对定位，失效选择不产生部分更新', () => {
    const records = [topic('A', [task('same')]), topic('B', [{ ...task('same'), title: '另一任务' }])];
    const result = changeTaskStatuses(records, [{ topicId: 'A', taskId: 'same' }], 'paused', 1000, nextId); expect(result[1]).toBe(records[1]); expect(result[0].topic!.tasks![0].status).toBe('paused');
    expect(() => changeTaskStatuses(records, [{ topicId: 'A', taskId: 'same' }, { topicId: 'B', taskId: 'missing' }], 'paused', 1000, nextId)).toThrow(); expect(records[0].topic!.tasks![0].status).toBe('running');
  });
});
