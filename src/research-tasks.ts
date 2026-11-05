export type TaskStatus = 'pending' | 'running' | 'completed' | 'paused' | 'cancelled';
export type TaskFieldType = 'text' | 'number' | 'url' | 'path' | 'date';
export interface TaskCategory { id: string; name: string; parentId: string; color: string; archived?: boolean }
export interface TaskField { id: string; label: string; type: TaskFieldType; required: boolean }
export interface TaskTemplate { id: string; name: string; categoryIds: string[]; fields: TaskField[]; version: number; archived?: boolean; status?: TaskStatus }
export interface TaskEvent { id: string; title: string; description: string; occurredAt: number | null; recordedAt: number; source: string; evidence: string; templateId: string; templateVersion: number; fields: Array<{ id: string; label: string; type: TaskFieldType; value: string }>; status?: TaskStatus }
export interface ResearchTask { id: string; title: string; description: string; categoryIds: string[]; status: TaskStatus; createdAt: number; updatedAt: number; recordedAt: number; source: string; notes: string; content?: string; events: TaskEvent[]; assetIds: string[]; paperIds: string[]; links: Array<{ id: string; label: string; url: string }>; comments: Array<{ id: string; body: string; author: string; createdAt: number }>; importKey?: string }
export const TASK_STATUS: Record<TaskStatus, string> = { pending: '待开始', running: '进行中', completed: '已完成', paused: '已暂停', cancelled: '已取消' };
export const FIELD_TYPES: Record<TaskFieldType, string> = { text: '文本', number: '数值', url: '链接', path: '路径', date: '日期' };
/** Optional metadata keeps existing task backups compatible. Relationships stay inside one topic. */
export interface ResearchTask {
  lineageRank?: number;
  nodeType?: string;
  parentIds?: string[];
  nodeStyle?: 'standard' | 'milestone' | 'snapshot';
  branch?: boolean;
  version?: string;
  expectedOutput?: string;
  nextStep?: string;
  blocker?: string;
  waitingFor?: string;
}
export const CATEGORY_COLORS = ['indigo', 'blue', 'green', 'amber', 'purple', 'rose'] as const;
export function defaultCategories(): TaskCategory[] {
  return [
    ['data', '数据', '', 'indigo'], ['download', '数据下载', 'data', 'blue'], ['processing', '数据整理', 'data', 'blue'],
    ['experiment', '实验', '', 'amber'], ['baseline', '基线实验', 'experiment', 'purple'], ['ablation', '消融实验', 'experiment', 'amber'], ['tuning', '模型优化', 'experiment', 'purple'],
    ['analysis', '分析', '', 'purple'], ['results', '结果分析', 'analysis', 'green'], ['visualization', '数据可视化', 'analysis', 'purple'],
    ['literature', '文献', '', 'blue'], ['review', '文献调研', 'literature', 'amber'],
  ].map(([id, name, parentId, color]) => ({ id, name, parentId, color }));
}
export function defaultTemplates(): TaskTemplate[] {
  const f = (id: string, label: string, type: TaskFieldType = 'text', required = false): TaskField => ({ id, label, type, required });
  return [
    { id: 'download-start', name: '开始下载', categoryIds: ['data', 'download'], version: 1, status: 'running', fields: [f('source', '下载来源', 'url', true), f('location', '保存位置', 'path', true), f('scope', '下载范围'), f('command', '执行方式')] },
    { id: 'download-progress', name: '下载进度更新', categoryIds: ['data', 'download'], version: 1, fields: [f('progress', '进度'), f('size', '已下载'), f('remaining', '预计剩余时间')] },
    { id: 'download-check', name: '完整性检查', categoryIds: ['data', 'download'], version: 1, fields: [f('count', '文件数量', 'number'), f('size', '总大小'), f('checksum', 'MD5 检查')] },
    { id: 'download-complete', name: '下载完成', categoryIds: ['data', 'download'], version: 1, status: 'completed', fields: [f('location', '实际保存位置', 'path', true), f('count', '文件数量', 'number'), f('size', '总大小'), f('checksum', 'MD5 检查')] },
    { id: 'experiment-record', name: '实验记录', categoryIds: ['experiment'], version: 1, fields: [f('code', '代码版本'), f('parameters', '实验参数'), f('data', '数据版本'), f('result', '结果位置', 'path'), f('metrics', '指标')] },
    { id: 'general-record', name: '进展记录', categoryIds: [], version: 1, fields: [f('action', '执行内容'), f('result', '结果'), f('next', '下一步')] },
  ];
}
export const taskTime = (value: number | null): string => {
  if (value === null) return '时间待确认';
  if (!Number.isFinite(new Date(value).getTime())) return '—';
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(value);
  const part = (name: string) => parts.find(p => p.type === name)?.value;
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
};
export const taskInputTime = (value = Date.now()) => taskTime(value).replace(' ', 'T');
export function parseTaskTime(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error('时间须为带时区的 ISO 格式');
  const [date, time] = value.split('T'), [y, m, d] = date.split('-').map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d || Number(time.slice(0, 2)) > 23 || Number(time.slice(3, 5)) > 59 || (time[5] === ':' && Number(time.slice(6, 8)) > 59)) throw new Error('日期或时间无效');
  const result = Date.parse(value); if (!Number.isFinite(result)) throw new Error('时间无效'); return result;
}
export const fromTaskInput = (value: string) => parseTaskTime(`${value}+08:00`);
export const orderedEvents = (events: TaskEvent[]) => [...events].sort((a, b) => (a.occurredAt ?? Infinity) - (b.occurredAt ?? Infinity) || a.recordedAt - b.recordedAt || a.id.localeCompare(b.id));
/** Fold only the empty bookkeeping generated by the manual creation form. */
export function processEvents(task: ResearchTask) {
  return task.events.filter(e => !(e.source === '手动' && ['创建任务', '创建节点'].includes(e.title) && e.occurredAt === task.createdAt && !e.description && !e.fields.length && !e.templateId && !e.evidence && !e.status));
}
export function taskStatusFromEvents(events: TaskEvent[], fallback: TaskStatus): TaskStatus {
  // Unknown occurrence time stays null. Its state is a report made at recordedAt,
  // while a dated event can supersede it only when it actually happened later.
  return [...events].filter(e => e.status).sort((a, b) => (a.occurredAt ?? a.recordedAt) - (b.occurredAt ?? b.recordedAt) || a.recordedAt - b.recordedAt).at(-1)?.status ?? fallback;
}
export function appendTaskEvents(task: ResearchTask, events: TaskEvent[], now = Date.now()): ResearchTask {
  const all = [...task.events];
  for (const event of events) {
    const old = all.find(e => e.id === event.id);
    if (old) { if (JSON.stringify({ ...old, recordedAt: 0 }) !== JSON.stringify({ ...event, recordedAt: 0 })) throw new Error(`记录 ID 冲突：${event.id}`); }
    else all.push(event);
  }
  if (all.length === task.events.length) return task;
  return { ...task, events: all, status: taskStatusFromEvents(all, task.status), updatedAt: now };
}
export const safeTaskUrl = (value: string) => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 8640000000000000;
const texts = (v: Record<string, unknown>, keys: string[]) => keys.every(k => typeof v[k] === 'string');
const entries = (v: unknown, check: (x: Record<string, unknown>) => boolean) => Array.isArray(v) && v.every(x => obj(x) && typeof x.id === 'string' && x.id && check(x)) && new Set(v.map(x => x.id)).size === v.length;
export const isTaskStatus = (v: unknown): v is TaskStatus => typeof v === 'string' && Object.hasOwn(TASK_STATUS, v);
export const isTaskField = (v: unknown): v is TaskField => obj(v) && texts(v, ['id', 'label']) && Object.hasOwn(FIELD_TYPES, String(v.type)) && typeof v.required === 'boolean';
export const isTaskCategories = (v: unknown): v is TaskCategory[] => entries(v, x => texts(x, ['name', 'parentId', 'color']) && CATEGORY_COLORS.includes(x.color as typeof CATEGORY_COLORS[number]) && (x.archived === undefined || typeof x.archived === 'boolean')) && (v as TaskCategory[]).every(x => !x.parentId || (v as TaskCategory[]).some(p => p.id === x.parentId && !p.parentId));
export const isTaskTemplates = (v: unknown): v is TaskTemplate[] => entries(v, x => texts(x, ['name']) && strings(x.categoryIds) && Number.isInteger(x.version) && Number(x.version) > 0 && entries(x.fields, f => isTaskField(f)) && (x.status === undefined || isTaskStatus(x.status)) && (x.archived === undefined || typeof x.archived === 'boolean'));
export const isResearchTasks = (v: unknown): v is ResearchTask[] => entries(v, x => texts(x, ['title', 'description', 'source', 'notes']) && (x.content === undefined || typeof x.content === 'string') && strings(x.categoryIds) && strings(x.assetIds) && strings(x.paperIds) && isTaskStatus(x.status) && ['createdAt', 'updatedAt', 'recordedAt'].every(k => number(x[k])) && (x.importKey === undefined || typeof x.importKey === 'string')
  && ['expectedOutput','nextStep','blocker','waitingFor'].every(key => x[key] === undefined || typeof x[key] === 'string')
  && entries(x.events, e => texts(e, ['title', 'description', 'source', 'evidence', 'templateId']) && (e.occurredAt === null || number(e.occurredAt)) && number(e.recordedAt) && Number.isInteger(e.templateVersion) && Number(e.templateVersion) > 0 && (e.status === undefined || isTaskStatus(e.status)) && entries(e.fields, f => texts(f, ['label', 'value']) && Object.hasOwn(FIELD_TYPES, String(f.type))))
  && (x.lineageRank === undefined || number(x.lineageRank)) && (x.nodeType === undefined || typeof x.nodeType === 'string') && (x.version === undefined || typeof x.version === 'string')
  && (x.nodeStyle === undefined || ['standard', 'milestone', 'snapshot'].includes(String(x.nodeStyle))) && (x.branch === undefined || typeof x.branch === 'boolean')
  && (x.parentIds === undefined || (strings(x.parentIds) && new Set(x.parentIds).size === x.parentIds.length && !x.parentIds.includes(String(x.id))))
  && entries(x.links, l => texts(l, ['label', 'url']) && safeTaskUrl(String(l.url))) && entries(x.comments, c => texts(c, ['body', 'author']) && number(c.createdAt)));
