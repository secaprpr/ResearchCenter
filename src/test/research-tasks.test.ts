import { describe, expect, it } from 'vitest';
import { appendTaskEvents, defaultCategories, defaultTemplates, fromTaskInput, isResearchTasks, parseTaskTime, taskTime } from '../research-tasks';
import { planTaskImport, TASK_PROTOCOL, taskPrompt } from '../task-import';
import { emptyTopic, isTopicData } from '../topics';
import { useStore } from '../store';

const time = '2026-10-27T10:05:00+08:00';
const categories = defaultCategories(), templates = defaultTemplates();
const topic = () => useStore.getState().addRecord({ typeId: 'project', title: '任务导入测试', topic: emptyTopic() });
const packet = (topicId: string) => ({ protocol: TASK_PROTOCOL, requestId: 'req-1', taskId: 'task-1', topicId, action: 'create_task', task: { title: '下载数据用于外部验证', description: '验证泛化能力', categoryIds: ['data', 'download'], status: 'running', createdAt: time, source: 'Codex' }, events: [{ id: 'start', templateId: 'download-start', templateVersion: 1, title: '开始下载', occurredAt: time as string | null, source: 'Codex', status: 'running', fields: { source: 'https://example.org/data', location: '/data/cohort' } }] });
describe('科研任务时间线与导入', () => {
  it('显示和输入固定为上海时间，不受系统时区影响，拒绝无效日期', () => {
    expect(taskTime(Date.parse(time))).toBe('2026-10-27 10:05'); expect(fromTaskInput('2026-10-27T10:05')).toBe(Date.parse(time));
    expect(() => parseTaskTime('2026-02-30T10:05:00+08:00')).toThrow(); expect(() => parseTaskTime('2026-10-27T10:05')).toThrow();
  });
  it('历史完成时间独立于导入时间，重复导入幂等，旧进度不会回退已完成任务', () => {
    const record = topic(), p = packet(record.id), first = planTaskImport(JSON.stringify(p), [record], categories, templates, 1900000000000);
    record.topic!.tasks = [first.task]; const done = { protocol: TASK_PROTOCOL, requestId: 'req-2', topicId: record.id, taskId: 'task-1', action: 'append_events', events: [{ id: 'done', title: '下载完成', occurredAt: '2026-10-27T16:18:00+08:00', status: 'completed', templateId: 'download-complete', fields: { location: '/data/cohort', count: 2418 } }] };
    const second = planTaskImport(JSON.stringify(done), [record], categories, templates, 1900000010000); record.topic!.tasks = [second.task];
    expect(second.task.status).toBe('completed'); expect(second.task.events[1].occurredAt).toBe(Date.parse('2026-10-27T16:18:00+08:00')); expect(second.task.events[1].recordedAt).toBe(1900000010000);
    expect(planTaskImport(JSON.stringify(done), [record], categories, templates, 1900000020000).duplicate).toBe(true);
    const late = { ...done, requestId: 'req-3', events: [{ ...done.events[0], id: 'progress', status: 'running', occurredAt: '2026-10-27T13:00:00+08:00' }] };
    expect(planTaskImport(JSON.stringify(late), [record], categories, templates).task.status).toBe('completed');
    expect(planTaskImport(JSON.stringify(p), [record], categories, templates).duplicate).toBe(true);
    const conflict = { ...done, events: [{ ...done.events[0], title: '冲突内容' }] }; expect(() => planTaskImport(JSON.stringify(conflict), [record], categories, templates)).toThrow('冲突');
  });
  it('模板版本变更要求快照，并保留历史字段名，未知时间不伪造', () => {
    const record = topic(), p = packet(record.id), old = templates[0]; p.events[0].occurredAt = null;
    const changed = templates.map(t => t.id === old.id ? { ...t, version: 2, fields: t.fields.map(f => ({ ...f, label: `新${f.label}` })) } : t);
    expect(() => planTaskImport(JSON.stringify(p), [record], categories, changed)).toThrow('快照');
    const withSnapshot = { ...p, events: [{ ...p.events[0], templateSnapshot: { version: old.version, fields: old.fields } }] };
    const result = planTaskImport('```json\n' + JSON.stringify(withSnapshot) + '\n```', [record], categories, changed);
    expect(result.task.events[0].fields[0].label).toBe('下载来源'); expect(result.task.events[0].occurredAt).toBeNull(); expect(taskTime(null)).toBe('时间待确认');
    const unknownCompletion = appendTaskEvents(result.task, [{ ...result.task.events[0], id: 'unknown-completion', title: '下载完成', status: 'completed', recordedAt: Date.now() + 1 }]);
    expect(unknownCompletion.status).toBe('completed'); expect(unknownCompletion.events.at(-1)?.occurredAt).toBeNull();
    expect(isResearchTasks([result.task])).toBe(true); expect(isTopicData({ ...emptyTopic(), tasks: [result.task] })).toBe(true);
    expect(isTopicData({ ...emptyTopic(), tasks: [{ ...result.task, events: 'bad' }] })).toBe(false);
  });
  it('拒绝错误目标、类别、字段、缺失必填项和危险网址', () => {
    const record = topic(), p = packet(record.id);
    expect(() => planTaskImport(JSON.stringify({ ...p, topicId: 'missing' }), [record], categories, templates)).toThrow('不存在');
    expect(() => planTaskImport(JSON.stringify({ ...p, task: { ...p.task, categoryIds: ['missing'] } }), [record], categories, templates)).toThrow('标签');
    expect(() => planTaskImport(JSON.stringify({ ...p, events: [{ ...p.events[0], fields: { invalid: 'x' } }] }), [record], categories, templates)).toThrow('未定义');
    expect(() => planTaskImport(JSON.stringify({ ...p, events: [{ ...p.events[0], fields: { source: 'javascript:alert(1)', location: '/tmp' } }] }), [record], categories, templates)).toThrow('http');
    expect(() => planTaskImport(JSON.stringify({ ...p, events: [{ ...p.events[0], fields: {} }] }), [record], categories, templates)).toThrow('下载来源');
  });
  it('任务备份包含模板和时间线，旧备份无模板时仍可恢复', () => {
    const record = topic(), first = planTaskImport(JSON.stringify(packet(record.id)), [record], categories, templates); record.topic!.tasks = [first.task];
    useStore.getState().updateRecord(record.id, { topic: record.topic }); const data = useStore.getState().exportData(); expect(data.taskTemplates).toEqual(templates);
    useStore.getState().duplicateRecord(record.id); const copy = useStore.getState().records.find(r => r.title === `${record.title}（副本）`)!;
    expect(copy.topic!.tasks![0].id).not.toBe(first.task.id); expect(copy.topic!.tasks![0].events[0].id).not.toBe(first.task.events[0].id); expect(copy.topic!.tasks![0].importKey).toBeUndefined();
    expect(useStore.getState().importData(data).ok).toBe(true); expect(useStore.getState().records.find(r => r.id === record.id)?.topic?.tasks).toEqual([first.task]);
    const old = { ...data, taskCategories: undefined, taskTemplates: undefined }; expect(useStore.getState().importData(old).ok).toBe(true); expect(useStore.getState().taskCategories).toEqual(categories);
    expect(useStore.getState().importData({ ...data, taskTemplates: [{}] }).ok).toBe(false);
  });
  it('Prompt 包含稳定的关联 ID、字段快照和实际时间规则', () => {
    const record = topic(), prompt = taskPrompt(record, undefined, categories, templates, 'req', 'task'); expect(prompt).toContain(record.id); expect(prompt).toContain('"taskId": "task"'); expect(prompt).toContain('templateSnapshot'); expect(prompt).toContain('禁止');
    const task = planTaskImport(JSON.stringify(packet(record.id)), [record], categories, templates).task; expect(taskPrompt(record, task, categories, templates, 'next', 'ignored')).toContain('"action": "append_events"');
    expect(appendTaskEvents(task, [])).toBe(task);
  });
});
