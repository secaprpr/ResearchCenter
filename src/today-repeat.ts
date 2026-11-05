import { isTodayData, type TodayData, type TodayTask } from './today-data';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const dateKey = (date: Date) => `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const dateOnly = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0); date.setFullYear(year, month - 1, day); date.setHours(0, 0, 0, 0); return date;
};
const shiftDate = (value: string, days: number) => {
  const date = dateOnly(value); date.setDate(date.getDate() + days); return dateKey(date);
};
const dayNumber = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(0, 0, 0, 0); return date.getTime() / 86400000;
};

function nextDate(task: TodayTask, completedDay: string): string | null {
  if (!task.dueDate || !object(task.repeat)) return null;
  const repeat = task.repeat, base = task.dueDate > completedDay ? task.dueDate : completedDay;
  const selected = Array.isArray(repeat.days) ? repeat.days as number[] : [];
  if (repeat.type === 'daily') return shiftDate(base, 1);
  if (repeat.type === 'weekly') {
    const weekdays = new Set(selected.length ? selected : [dateOnly(task.dueDate).getDay()]);
    for (let offset = 1; offset <= 7; offset++) {
      const candidate = shiftDate(base, offset);
      if (weekdays.has(dateOnly(candidate).getDay())) return candidate;
    }
  }
  if (repeat.type === 'monthly') {
    const days = [...new Set(selected.length ? selected : [dateOnly(task.dueDate).getDate()])].sort((a, b) => a - b);
    const origin = dateOnly(base);
    for (let offset = 0; offset <= 12; offset++) {
      const month = new Date(origin); month.setDate(1); month.setMonth(origin.getMonth() + offset);
      const end = new Date(month); end.setMonth(end.getMonth() + 1); end.setDate(0);
      for (const day of days) {
        if (day > end.getDate()) continue;
        const candidate = new Date(month); candidate.setDate(day);
        const value = dateKey(candidate); if (value > base) return value;
      }
    }
  }
  return null;
}

/** Keep native completion and the embedded Today document's recurrence semantics identical. */
export function toggleTodayTask(data: TodayData, id: string, now: number, newId: () => string): TodayData {
  if (!isTodayData(data)) throw new Error('任务中心数据无效，无法切换完成状态');
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new Error('完成时间无效');
  const result = structuredClone(data), task = result.tasks.find(item => item.id === id);
  if (!task) throw new Error('任务已不存在或已归档');
  task.done = !task.done; task.completedAt = task.done ? now : null; task.updatedAt = now;
  const dueDate = task.done ? nextDate(task, dateKey(new Date(now))) : null;
  if (!dueDate) return result;

  const children = new Map<string, TodayTask[]>();
  for (const entry of data.tasks) {
    if (!entry.parentTaskId) continue;
    const siblings = children.get(entry.parentTaskId) || []; siblings.push(entry); children.set(entry.parentTaskId, siblings);
  }
  const tree: TodayTask[] = [];
  const visit = (entry: TodayTask) => { tree.push(entry); for (const child of children.get(entry.id) || []) visit(child); };
  visit(task);
  const reserved = new Set(data.tasks.map(entry => entry.id));
  if (Array.isArray(data.workbenchHiddenTasks)) for (const entry of data.workbenchHiddenTasks) if (object(entry) && typeof entry.id === 'string') reserved.add(entry.id);
  for (const entry of data.tasks) if (Array.isArray(entry.timelineItems)) for (const item of entry.timelineItems) if (object(item) && typeof item.id === 'string') reserved.add(item.id);
  const allocate = () => {
    const value = newId();
    if (typeof value !== 'string' || !value.trim() || reserved.has(value)) throw new Error('重复任务无法分配唯一 ID，请重试');
    reserved.add(value); return value;
  };
  const ids = new Map(tree.map(entry => [entry.id, allocate()]));
  const shift = dayNumber(dueDate) - dayNumber(task.dueDate);
  const copies = tree.map(entry => {
    const copy = structuredClone(entry);
    copy.id = ids.get(entry.id)!; copy.parentTaskId = ids.get(entry.parentTaskId || '') || entry.parentTaskId;
    copy.repeatSeriesId = entry.repeatSeriesId || entry.id;
    copy.done = false; copy.completedAt = null; copy.createdAt = now; copy.updatedAt = now;
    copy.content = copy.content.replace(/^(\s*(?:[-*+]|\d+\.)\s+\[)[xX](\])/gm, '$1 $2');
    if (Array.isArray(copy.checklist)) copy.checklist = copy.checklist.map(item => object(item) ? { ...item, id: allocate(), done: false } : item);
    if (Array.isArray(copy.relatedTaskIds)) copy.relatedTaskIds = copy.relatedTaskIds.map(related => ids.get(related as string) || related);
    for (const key of ['startDate', 'dueDate', 'windowStart', 'windowEnd']) if (typeof copy[key] === 'string' && copy[key]) copy[key] = shiftDate(copy[key] as string, shift);
    if (Array.isArray(copy.timelineItems)) copy.timelineItems = copy.timelineItems.map(item => {
      if (!object(item)) return item;
      const next: Record<string, unknown> = { ...item, id: allocate() };
      for (const key of ['date', 'startDate', 'endDate']) if (typeof next[key] === 'string' && next[key]) next[key] = shiftDate(next[key] as string, shift);
      return next;
    });
    return copy;
  });
  result.tasks.unshift(...copies);
  if (!isTodayData(result)) throw new Error('生成的重复任务数据无效，操作未保存');
  return result;
}
