import type { RecordItem } from './types';
import { topicData } from './topics';
import { appendTaskEvents, TASK_STATUS, type TaskStatus } from './research-tasks';

export interface TaskRef { topicId: string; taskId: string }
const keyOf = (ref: TaskRef) => JSON.stringify([ref.topicId,ref.taskId]);
const uniqueRefs = (refs: TaskRef[]) => [...new Map(refs.map(ref => [JSON.stringify([ref.topicId, ref.taskId]), ref])).values()];
function checkedRefs(records: RecordItem[], refs: TaskRef[]) {
  return uniqueRefs(refs).map(ref => {
    const topic = records.find(r => r.id === ref.topicId), task = topic?.topic?.tasks?.find(t => t.id === ref.taskId);
    if (!topic || !task) throw new Error('部分任务已改变，请重新选择');
    return { ...ref, topic, task };
  });
}

/** Return one immutable record update, so a bulk edit persists only once. */
export function changeTaskStatuses(records: RecordItem[], refs: TaskRef[], status: TaskStatus, now: number, newId: () => string): RecordItem[] {
  const selected = checkedRefs(records, refs), updates = new Map(selected.filter(p => p.task.status !== status).map(p => [keyOf(p), appendTaskEvents(p.task, [{ id: newId(), title: TASK_STATUS[status], description: '', occurredAt: now, recordedAt: now, source: '手动', evidence: '', templateId: '', templateVersion: 1, fields: [], status }], now)]));
  if (!updates.size) return records;
  return records.map(record => selected.some(p => p.topicId === record.id && updates.has(keyOf(p))) ? { ...record, updatedAt: now, topic: { ...topicData(record), tasks: (topicData(record).tasks || []).map(task => updates.get(keyOf({topicId:record.id,taskId:task.id})) || task) } } : record);
}

/** Move ownership and copy file indexes; original vault files and source assets stay in place. */
export function moveResearchTasks(records: RecordItem[], refs: TaskRef[], destinationId: string, now: number, newId: () => string): RecordItem[] {
  const destination = records.find(r => r.id === destinationId);
  if (!destination || destination.archived) throw new Error('目标课题不可用');
  const selected = checkedRefs(records, refs);
  if (selected.some(p => p.topic.archived || p.topic.typeId !== destination.typeId)) throw new Error('只能在同类型的未归档课题之间移动任务');
  const moving = selected.filter(p => p.topicId !== destinationId); if (!moving.length) return records;
  const data = topicData(destination), tasks = [...(data.tasks || [])], assets = [...data.assets];
  const reserved = new Set(records.flatMap(r => topicData(r).assets.map(a => a.id))), mappings = new Map<string, string>();
  const allocate = () => {
    for (let i = 0; i < 100; i++) { const id = newId(); if (!reserved.has(id)) { reserved.add(id); return id; } }
    throw new Error('无法分配文件 ID，请重试');
  };
  for (const { topic, task } of moving) {
    if (tasks.some(t => t.id === task.id)) throw new Error('目标课题已存在相同 ID 的任务');
    const assetIds = task.assetIds.map(id => {
      const key = JSON.stringify([topic.id, id]), cached = mappings.get(key); if (cached) return cached;
      const source = topicData(topic).assets.find(a => a.id === id), existing = assets.find(a => a.id === id);
      // An unresolved source reference must never silently attach to an unrelated destination file.
      const mapped = existing && (!source || JSON.stringify(source) !== JSON.stringify(existing)) ? allocate() : id;
      if (source && !assets.some(a => a.id === mapped)) assets.push({ ...source, id: mapped });
      mappings.set(key, mapped); return mapped;
    });
    const destinationIds = new Set([...(data.tasks || []).map(t => t.id), ...moving.map(p => p.taskId)]);
    tasks.push({ ...task, assetIds, ...(task.parentIds ? { parentIds: task.parentIds.filter(id => destinationIds.has(id)) } : {}), updatedAt: now });
  }
  return records.map(record => {
    if (record.id === destinationId) return { ...record, updatedAt: now, topic: { ...data, tasks, assets } };
    const moved = new Set(moving.filter(p => p.topicId === record.id).map(p => p.taskId));
    if (!moved.size) return record;
    return { ...record, updatedAt: now, topic: { ...topicData(record), tasks: (topicData(record).tasks || []).filter(t => !moved.has(t.id)).map(t => t.parentIds?.some(id => moved.has(id)) ? { ...t, parentIds: t.parentIds.filter(id => !moved.has(id)) } : t) } };
  });
}
