import type { Priority, RecordItem } from './types';

export interface TodayGroup { id: string; name: string; [key: string]: unknown }
export interface TodayFolder { id: string; name: string; [key: string]: unknown }
export interface TodayList {
  id: string; name: string; groups: TodayGroup[]; folderId?: string | null; system?: boolean;
  [key: string]: unknown;
}
export interface TodayTask {
  id: string; title: string; content: string; done: boolean; priority: number;
  listId: string; groupId: string | null; parentTaskId: string | null;
  startDate: string; dueDate: string; dueTime: string; endTime: string; tags: string[];
  [key: string]: unknown;
}
export interface TodayData {
  version: number; folders: TodayFolder[]; lists: TodayList[]; tasks: TodayTask[];
  settings: Record<string, unknown>; [key: string]: unknown;
}

const nativePriority: Record<Priority, number> = { none: 0, high: 1, medium: 2, low: 3 };
const priorities: Priority[] = ['none', 'high', 'medium', 'low'];
const mappedKeys = ['title', 'content', 'done', 'priority', 'dueDate', 'startDate', 'dueTime', 'endTime'] as const;
type MappedKey = typeof mappedKeys[number];
const own = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const clone = <T,>(value: T): T => structuredClone(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(nonempty) && new Set(value).size === value.length;

function validDate(value: unknown): value is string {
  if (value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
const validTime = (value: unknown) => value === '' || (typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value));

function assertTodayData(value: unknown): asserts value is TodayData {
  const fail: (message: string) => never = message => { throw new Error(`任务中心数据无效：${message}`); };
  if (!object(value) || !Number.isInteger(value.version) || Number(value.version) < 1 || !object(value.settings)) fail('缺少版本或设置');
  if (!Array.isArray(value.folders) || !Array.isArray(value.lists) || !Array.isArray(value.tasks)) fail('缺少文件夹、清单或任务数组');
  const entries = (items: unknown[], label: string) => {
    const result = new Map<string, Record<string, unknown>>();
    for (const item of items) {
      if (!object(item) || !nonempty(item.id) || result.has(item.id)) fail(`${label} ID 为空或重复`);
      result.set(item.id, item);
    }
    return result;
  };
  const visibleTasks = entries(value.tasks, '任务');
  if (value.workbenchHiddenTasks !== undefined && !Array.isArray(value.workbenchHiddenTasks)) fail('隐藏任务缓存无效');
  const cachedTasks = entries((value.workbenchHiddenTasks || []) as unknown[], '隐藏任务');
  const folders = entries(value.folders, '文件夹'), lists = entries(value.lists, '清单');
  const tasks = new Map([...cachedTasks, ...visibleTasks]);
  for (const item of folders.values()) if (!nonempty(item.name)) fail('文件夹名称为空');
  const groups = new Map<string, Map<string, Record<string, unknown>>>();
  for (const list of lists.values()) {
    if (!nonempty(list.name) || !Array.isArray(list.groups)) fail('清单名称或分组无效');
    if (list.folderId != null && (!nonempty(list.folderId) || !folders.has(list.folderId))) fail('清单引用未知文件夹');
    if (list.system !== undefined && typeof list.system !== 'boolean') fail('系统清单标记无效');
    const children = entries(list.groups, '分组');
    for (const group of children.values()) if (!nonempty(group.name)) fail('分组名称为空');
    groups.set(list.id as string, children);
  }
  if (!lists.size) fail('至少需要一个清单');
  for (const task of [...cachedTasks.values(), ...visibleTasks.values()]) {
    if (typeof task.title !== 'string' || typeof task.content !== 'string' || typeof task.done !== 'boolean') fail('任务标题、正文或完成状态无效');
    if (!Number.isInteger(task.priority) || Number(task.priority) < 0 || Number(task.priority) > 3) fail('任务优先级无效');
    if (!nonempty(task.listId) || !lists.has(task.listId)) fail('任务引用未知清单');
    if (task.groupId !== null && (!nonempty(task.groupId) || !groups.get(task.listId)?.has(task.groupId))) fail('任务引用未知分组');
    if (task.parentTaskId !== null && (!nonempty(task.parentTaskId) || !tasks.has(task.parentTaskId))) fail('任务引用未知父任务');
    if (!strings(task.tags)) fail('任务标签无效');
    for (const key of ['startDate', 'dueDate', 'windowStart', 'windowEnd']) {
      if ((key === 'startDate' || key === 'dueDate' || own(task, key)) && !validDate(task[key])) fail('任务日期无效');
    }
    if (!validTime(task.dueTime) || !validTime(task.endTime)) fail('任务时间无效');
    for (const key of ['createdAt', 'updatedAt', 'sortOrder']) if (own(task, key) && !finite(task[key])) fail('任务时间戳或排序无效');
    if (task.completedAt != null && !finite(task.completedAt)) fail('任务完成时间无效');
    for (const key of ['attachments', 'relatedNotePaths', 'relatedTaskIds']) if (own(task, key) && !strings(task[key])) fail('任务附件或关联无效');
    if (Array.isArray(task.relatedTaskIds) && task.relatedTaskIds.some(id => id === task.id || !tasks.has(id as string))) fail('任务引用未知关联任务');
    if (task.repeat != null) {
      if (!object(task.repeat) || !['daily', 'weekly', 'monthly'].includes(String(task.repeat.type))) fail('重复规则无效');
      const repeat = task.repeat;
      if (repeat.days !== undefined) {
        if (!Array.isArray(repeat.days)) fail('重复日期无效');
        const minimum = repeat.type === 'monthly' ? 1 : 0, maximum = repeat.type === 'monthly' ? 31 : 6;
        if (repeat.days.some(day => !Number.isInteger(day) || Number(day) < minimum || Number(day) > maximum) || new Set(repeat.days).size !== repeat.days.length) fail('重复日期无效');
      }
    }
    if (task.timelineItems !== undefined) {
      if (!Array.isArray(task.timelineItems)) fail('规划项无效');
      for (const item of entries(task.timelineItems, '规划项').values()) {
        if (!nonempty(item.title)) fail('规划项标题无效');
        if (item.type === 'milestone') { if (!validDate(item.date) || !item.date) fail('里程碑日期无效'); }
        else if (item.type === 'phase') {
          if (!validDate(item.startDate) || !validDate(item.endDate) || !item.startDate || !item.endDate || String(item.startDate) > String(item.endDate)) fail('阶段日期无效');
        } else fail('规划项类型无效');
      }
    }
  }
  for (const task of tasks.values()) {
    const seen = new Set<string>(); let node: Record<string, unknown> | undefined = task;
    while (node) {
      const id = node.id as string;
      if (seen.has(id)) fail('父子任务存在循环');
      seen.add(id); node = node.parentTaskId ? tasks.get(node.parentTaskId as string) : undefined;
    }
  }
}

export function isTodayData(value: unknown): value is TodayData {
  try { assertTodayData(value); return true; } catch { return false; }
}

function emptyData(): TodayData {
  return {
    version: 8, composerMode: 'compact',
    folders: [{ id: 'folder-default', name: '默认', pinned: false, order: 0, viewMode: 'list', timelineCollapsedLists: [] }],
    lists: [{ id: 'inbox', name: '收集箱', system: true, color: 'neutral', folderId: null, viewMode: 'list', groups: [] }],
    tasks: [], settings: { centerScale: 1 },
  };
}

function assertRecordIds(records: RecordItem[]) {
  const ids = new Set<string>();
  for (const record of records) {
    if (!nonempty(record.id) || ids.has(record.id)) throw new Error('记录 ID 为空或重复');
    ids.add(record.id);
  }
}

function nativeFields(record: RecordItem): Pick<TodayTask, MappedKey> {
  return {
    title: record.title, content: record.content, done: record.done, priority: nativePriority[record.priority],
    dueDate: record.dueDate || '', startDate: record.planDate && record.planDate !== record.dueDate ? record.planDate : '',
    dueTime: record.planStart || '', endTime: record.planEnd || '',
  };
}

/** All active records of this todo type are visible, independent of the sidebar workspace filter. */
export function projectTodayData(records: RecordItem[], typeId: string, stored?: TodayData): TodayData {
  assertRecordIds(records);
  if (stored !== undefined) assertTodayData(stored);
  const data = stored === undefined ? emptyData() : clone(stored);
  const cached = new Map(((data.workbenchHiddenTasks || []) as TodayTask[]).map(task => [task.id, task]));
  const byId = new Map([...cached, ...data.tasks.map(task => [task.id, task] as const)]);
  const owned = records.filter(record => record.typeId === typeId);
  const ownedIds = new Set(owned.map(record => record.id));
  const activeIds = new Set(owned.filter(record => !record.archived).map(record => record.id));
  const defaultList = data.lists.find(list => list.id === 'inbox') || data.lists[0];
  const hidden: TodayTask[] = [], projected: TodayTask[] = [];
  for (const record of owned) {
    const previous = byId.get(record.id), preserved = cached.get(record.id);
    if (record.archived && !previous) continue;
    const metadata = previous ? clone(previous) : undefined;
    // Mask inactive references in the UI while preserving them for unarchive.
    if (metadata && preserved) {
      if (!metadata.parentTaskId && preserved.parentTaskId && ownedIds.has(preserved.parentTaskId)) metadata.parentTaskId = preserved.parentTaskId;
      const hiddenRelated = Array.isArray(preserved.relatedTaskIds) ? preserved.relatedTaskIds.filter(id => ownedIds.has(id as string)) : [];
      if (hiddenRelated.length) metadata.relatedTaskIds = [...new Set([...(Array.isArray(metadata.relatedTaskIds) ? metadata.relatedTaskIds : []), ...hiddenRelated])];
    }
    const completedAt = !record.done ? null : previous?.done
      ? (finite(previous.completedAt) ? previous.completedAt : (finite(record.completedAt) ? record.completedAt : null))
      : finite(record.completedAt) ? record.completedAt : previous ? record.updatedAt : null;
    const task: TodayTask = {
      listId: defaultList.id, groupId: null, parentTaskId: null, tags: [], attachments: [], relatedTaskIds: [], relatedNotePaths: [],
      repeat: null, timelineItems: [], windowStart: '', windowEnd: '', sortOrder: record.order ?? 0,
      ...metadata, ...nativeFields(record), id: record.id, workspaceId: record.workspaceId,
      createdAt: record.createdAt, updatedAt: Math.max(record.updatedAt, typeof previous?.updatedAt === 'number' ? previous.updatedAt : 0),
      completedAt,
    };
    if (task.parentTaskId && !ownedIds.has(task.parentTaskId)) task.parentTaskId = null;
    if (Array.isArray(task.relatedTaskIds)) task.relatedTaskIds = task.relatedTaskIds.filter(id => ownedIds.has(id as string));
    if (record.archived) { hidden.push(task); continue; }
    const maskParent = task.parentTaskId && !activeIds.has(task.parentTaskId);
    const maskResources = Array.isArray(task.relatedTaskIds) && task.relatedTaskIds.some(id => !activeIds.has(id as string));
    if (maskParent || maskResources) hidden.push(clone(task));
    if (maskParent) task.parentTaskId = null;
    if (Array.isArray(task.relatedTaskIds)) task.relatedTaskIds = task.relatedTaskIds.filter(id => activeIds.has(id as string));
    projected.push(task);
  }
  data.tasks = projected;
  if (hidden.length) data.workbenchHiddenTasks = hidden; else delete data.workbenchHiddenTasks;
  assertTodayData(data);
  return data;
}

const sameMapped = (left: Pick<TodayTask, MappedKey>, right: Pick<TodayTask, MappedKey>) => mappedKeys.every(key => left[key] === right[key]);

/** Merge only fields edited in Today; native edits made since its snapshot are never silently overwritten. */
export function applyTodayData(records: RecordItem[], typeId: string, incoming: TodayData, baseline: TodayData, defaultWorkspaceId: string, currentMetadata?: TodayData): { records: RecordItem[]; data: TodayData } {
  assertRecordIds(records); assertTodayData(incoming); assertTodayData(baseline);
  const concurrent = currentMetadata === undefined ? undefined : projectTodayData(records, typeId, currentMetadata);
  if (!nonempty(typeId) || !nonempty(defaultWorkspaceId)) throw new Error('待办类型或默认工作区无效');
  const current = new Map(records.map(record => [record.id, record]));
  const before = new Map(baseline.tasks.map(task => [task.id, task]));
  const after = new Map(incoming.tasks.map(task => [task.id, task]));
  const updates = new Map<string, RecordItem>(), deleted = new Set<string>();
  const conflict = (id: string): never => { throw new Error(`任务「${current.get(id)?.title || id}」已有其他修改，请刷新后重试`); };
  const now = Date.now();
  for (const task of incoming.tasks) {
    const record = current.get(task.id), original = before.get(task.id);
    if (record && record.typeId !== typeId) throw new Error('任务 ID 与其他类型的记录冲突');
    if (record?.archived) { if (!original || !sameMapped(task, original)) conflict(task.id); continue; }
    if (!record) {
      if (original) { if (!sameMapped(task, original)) conflict(task.id); continue; }
      const createdAt = finite(task.createdAt) ? task.createdAt as number : now;
      updates.set(task.id, {
        id: task.id, typeId, workspaceId: nonempty(task.workspaceId) ? task.workspaceId : defaultWorkspaceId,
        title: task.title, content: task.content, status: 'active', starred: false, archived: false, fields: [],
        priority: priorities[task.priority], done: task.done, dueDate: task.dueDate || null,
        planDate: task.startDate || null, planStart: task.dueTime || null, planEnd: task.endTime || null,
        completedAt: task.done && finite(task.completedAt) ? task.completedAt as number : null,
        createdAt, updatedAt: finite(task.updatedAt) ? task.updatedAt as number : now,
      });
      continue;
    }
    if (!original) throw new Error('新增任务 ID 已存在，请刷新后重试');
    const projected = nativeFields(record), merged = { ...projected };
    for (const key of mappedKeys) {
      if (task[key] === original[key]) continue;
      if (projected[key] !== original[key] && projected[key] !== task[key]) conflict(task.id);
      Object.assign(merged, { [key]: task[key] });
    }
    if (sameMapped(merged, projected)) continue;
    const patch: Partial<RecordItem> = {
      title: merged.title, content: merged.content, done: merged.done, priority: priorities[merged.priority],
      dueDate: merged.dueDate || null, planStart: merged.dueTime || null, planEnd: merged.endTime || null, updatedAt: now,
    };
    if (merged.startDate !== projected.startDate) patch.planDate = merged.startDate || null;
    else if (record.planDate && record.planDate === record.dueDate && merged.dueDate !== projected.dueDate) patch.planDate = merged.dueDate || null;
    if (merged.done !== projected.done) patch.completedAt = merged.done ? (finite(task.completedAt) ? task.completedAt as number : now) : null;
    updates.set(task.id, { ...record, ...patch });
  }
  for (const original of baseline.tasks) {
    if (after.has(original.id)) continue;
    const record = current.get(original.id);
    if (!record || record.archived) continue;
    if (record.typeId !== typeId) throw new Error('删除目标 ID 与其他类型的记录冲突');
    if (!sameMapped(nativeFields(record), original)) conflict(original.id);
    deleted.add(original.id);
  }
  const appended = [...updates.values()].filter(record => !current.has(record.id));
  const result = updates.size || deleted.size ? records.filter(record => !deleted.has(record.id)).map(record => updates.get(record.id) || record).concat(appended) : records;
  const incomingMetadata = clone(incoming);
  // A native action can create a repeat tree after the browser's baseline.
  // Keep those documents alongside their records instead of reducing them to
  // the small set of fields projected by native records.
  const additions = concurrent?.tasks.filter(task => !before.has(task.id) && !after.has(task.id)) || [];
  incomingMetadata.tasks.push(...clone(additions));
  const hidden = new Map<string, TodayTask>();
  for (const snapshot of [baseline, concurrent, incoming]) {
    if (Array.isArray(snapshot?.workbenchHiddenTasks)) for (const task of snapshot.workbenchHiddenTasks as TodayTask[]) hidden.set(task.id, clone(task));
  }
  if (hidden.size) incomingMetadata.workbenchHiddenTasks = [...hidden.values()];
  else delete incomingMetadata.workbenchHiddenTasks;
  if (concurrent) {
    const neededLists = new Set([...additions, ...hidden.values()].map(task => task.listId));
    const baselineLists = new Map(baseline.lists.map(list => [list.id, list]));
    for (const list of concurrent.lists) {
      const existing = incomingMetadata.lists.find(item => item.id === list.id);
      if (!existing) {
        if (!baselineLists.has(list.id) || neededLists.has(list.id)) incomingMetadata.lists.push(clone(list));
        continue;
      }
      const oldGroups = new Set(baselineLists.get(list.id)?.groups.map(group => group.id) || []);
      for (const group of list.groups) {
        const needed = [...additions, ...hidden.values()].some(task => task.listId === list.id && task.groupId === group.id);
        if (!existing.groups.some(item => item.id === group.id) && (!oldGroups.has(group.id) || needed)) existing.groups.push(clone(group));
      }
    }
    const baselineFolders = new Set(baseline.folders.map(folder => folder.id));
    const neededFolders = new Set(incomingMetadata.lists.map(list => list.folderId).filter(Boolean));
    for (const folder of concurrent.folders) {
      if (!incomingMetadata.folders.some(item => item.id === folder.id) && (!baselineFolders.has(folder.id) || neededFolders.has(folder.id))) incomingMetadata.folders.push(clone(folder));
    }
  }
  const metadataIds = new Set([...incomingMetadata.tasks, ...hidden.values()].map(task => task.id));
  for (const task of [...incomingMetadata.tasks, ...hidden.values()]) {
    if (task.parentTaskId && !metadataIds.has(task.parentTaskId)) task.parentTaskId = null;
    if (Array.isArray(task.relatedTaskIds)) task.relatedTaskIds = task.relatedTaskIds.filter(id => metadataIds.has(id as string));
  }
  return { records: result, data: projectTodayData(result, typeId, incomingMetadata) };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function fingerprint(value: unknown): string {
  let hash = 2166136261;
  for (const character of canonical(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

/** Add a validated plugin snapshot without overwriting local entities; repeated imports are a no-op. */
export function mergeTodayImport(current: TodayData, raw: unknown): TodayData {
  assertTodayData(current);
  if (!object(raw) || !Array.isArray(raw.folders) || !Array.isArray(raw.lists) || !Array.isArray(raw.tasks)) throw new Error('导入文件缺少任务中心数组');
  const imported = clone(raw);
  imported.version ??= 8; imported.settings ??= {};
  imported.lists = raw.lists.map(list => object(list) ? { groups: [], ...clone(list) } : list);
  imported.tasks = raw.tasks.map(task => object(task) ? {
    title: '', content: '', done: false, priority: 0, listId: 'inbox', groupId: null, parentTaskId: null,
    startDate: '', dueDate: '', dueTime: '', endTime: '', tags: [], ...clone(task),
  } : task);
  assertTodayData(imported);
  const signature = canonical(imported), previousImports = object(current.workbenchImports) ? current.workbenchImports : {};
  const prefix = fingerprint(imported); let source = prefix, sourceIndex = 1;
  while (own(previousImports, source)) {
    if (previousImports[source] === signature) return clone(current);
    source = `${prefix}-${sourceIndex++}`;
  }
  const result = clone(current);
  const allocate = (id: string, used: Set<string>, kind: string) => {
    let next = id;
    if (used.has(next)) next = `${id}~${kind}-${source}`;
    let index = 1; const base = next;
    while (used.has(next)) next = `${base}-${index++}`;
    used.add(next); return next;
  };
  const folderIds = new Map<string, string>(), listIds = new Map<string, string>(), taskIds = new Map<string, string>();
  const foldersUsed = new Set(result.folders.map(folder => folder.id)), listsUsed = new Set(result.lists.map(list => list.id)), tasksUsed = new Set(result.tasks.map(task => task.id));
  for (const folder of imported.folders) folderIds.set(folder.id, allocate(folder.id, foldersUsed, 'folder'));
  for (const list of imported.lists) listIds.set(list.id, list.id === 'inbox' && result.lists.some(item => item.id === 'inbox') ? 'inbox' : allocate(list.id, listsUsed, 'list'));
  for (const task of imported.tasks) taskIds.set(task.id, allocate(task.id, tasksUsed, 'task'));
  result.folders.push(...imported.folders.map(folder => ({ ...folder, id: folderIds.get(folder.id)! })));
  for (const list of imported.lists) {
    const mapped = { ...list, id: listIds.get(list.id)!, folderId: list.folderId ? folderIds.get(list.folderId) : null };
    if (mapped.id === 'inbox' && result.lists.some(item => item.id === 'inbox')) {
      if (list.groups.length) throw new Error('系统收集箱不能导入分组');
    } else result.lists.push(mapped);
  }
  result.tasks.push(...imported.tasks.map(task => ({
    ...task, id: taskIds.get(task.id)!, listId: listIds.get(task.listId)!,
    parentTaskId: task.parentTaskId ? taskIds.get(task.parentTaskId)! : null,
    ...(Array.isArray(task.relatedTaskIds) ? { relatedTaskIds: task.relatedTaskIds.map(id => taskIds.get(id as string)!) } : {}),
    ...(typeof task.repeatSeriesId === 'string' && taskIds.has(task.repeatSeriesId) ? { repeatSeriesId: taskIds.get(task.repeatSeriesId) } : {}),
  })));
  result.workbenchImports = { ...clone(previousImports), [source]: signature };
  assertTodayData(result); return result;
}
