import type { RecordItem } from './types';
import { isResearchTasks, type ResearchTask } from './research-tasks';

export type IdeaStatus = 'pending' | 'testing' | 'supported' | 'rejected' | 'parked';
export type ExperimentStatus = 'planned' | 'running' | 'completed' | 'failed';
export type AssetKind = 'dataset' | 'script' | 'result' | 'figure' | 'document' | 'other';
export interface PaperLink { paperId: string; role: string; note: string; linkedAt: number }
export interface TopicIdea { id: string; title: string; content: string; status: IdeaStatus; paperIds: string[]; createdAt: number; updatedAt: number }
export interface DataSnapshot { id: string; title: string; version: string }
export interface ExperimentRun { id: string; title: string; parameters: string; codeVersion: string; result: string; status: ExperimentStatus; metrics: Record<string, string>; datasets: DataSnapshot[]; assetIds: string[]; createdAt: number; updatedAt: number }
export interface TopicExperiment { id: string; title: string; purpose: string; content: string; status: ExperimentStatus; ideaId: string; paperIds: string[]; dataIds: string[]; runs: ExperimentRun[]; createdAt: number; updatedAt: number }
export interface TopicAsset { id: string; title: string; kind: AssetKind; version: string; location: string; notes: string; vaultPath?: string; filename?: string; size?: number; createdAt: number; updatedAt: number }
export interface TopicMilestone { id: string; title: string; date: string; done: boolean }
export interface TopicEvent { id: string; title: string; content: string; date: string; kind: 'activity' | 'decision' | 'milestone'; sourceType?: 'idea' | 'experiment' | 'asset' | 'paper' | 'milestone'; sourceId?: string; createdAt: number }
export interface TopicData {
  tasks?: ResearchTask[];
  question: string; hypothesis: string; conclusion: string; blocker: string; focus: string; nextStep: string;
  papers: PaperLink[]; ideas: TopicIdea[]; experiments: TopicExperiment[]; assets: TopicAsset[]; milestones: TopicMilestone[]; events: TopicEvent[];
}
export const IDEA_LABELS: Record<IdeaStatus, string> = { pending: '待验证', testing: '验证中', supported: '有支持', rejected: '已否定', parked: '暂存' };
export const EXPERIMENT_LABELS: Record<ExperimentStatus, string> = { planned: '待开始', running: '运行中', completed: '已完成', failed: '未成功' };
export const ASSET_LABELS: Record<AssetKind, string> = { dataset: '数据集', script: '脚本', result: '结果', figure: '图表', document: '文档', other: '其他' };
export const PAPER_ROLES = ['相关工作', '理论依据', '方法参考', '对比方法', '证据'] as const;
export const emptyTopic = (): TopicData => ({ question: '', hypothesis: '', conclusion: '', blocker: '', focus: '', nextStep: '', papers: [], ideas: [], experiments: [], assets: [], milestones: [], events: [] });
export const topicData = (record: RecordItem): TopicData => record.topic ?? emptyTopic();
export const localDay = (time = Date.now()) => { const date = new Date(time); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
export function topicSearch(record: RecordItem): string {
  const data = topicData(record);
  return [record.title, record.content, data.question, data.hypothesis, data.conclusion, data.focus, data.nextStep, data.blocker, ...data.ideas.flatMap(i => [i.title, i.content]), ...data.experiments.flatMap(e => [e.title, e.purpose, e.content, ...e.runs.flatMap(r => [r.title, r.parameters, r.result, ...Object.keys(r.metrics), ...Object.values(r.metrics)])]), ...data.assets.flatMap(a => [a.title, a.location, a.notes]), ...data.events.flatMap(e => [e.title, e.content])].join('\n').toLowerCase();
}
export function metricsFromText(value: string): Record<string, string> {
  return Object.fromEntries(value.split(/\r?\n/).flatMap(line => { const match = line.match(/^\s*([^=:：]+?)\s*[=:：]\s*(.+?)\s*$/); return match ? [[match[1], match[2]]] : []; }));
}
export function parseDataPreview(text: string, separator = ','): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  const pushCell = () => { if (row.length < 30) row.push(cell); cell = ''; };
  for (let i = 0; i < Math.min(text.length, 128000) && rows.length < 15; i++) {
    const char = text[i];
    if (char === '"') { if (quoted && text[i + 1] === '"') { if (cell.length < 500) cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && char === separator) pushCell();
    else if (!quoted && (char === '\n' || char === '\r')) { if (char === '\r' && text[i + 1] === '\n') i++; pushCell(); rows.push(row); row = []; }
    else if (cell.length < 500) cell += char;
  }
  if (rows.length < 15 && (cell || row.length)) { pushCell(); rows.push(row); }
  return rows;
}
export function removeIdea(data: TopicData, id: string): TopicData { return { ...data, ideas: data.ideas.filter(i => i.id !== id), experiments: data.experiments.map(e => e.ideaId === id ? { ...e, ideaId: '' } : e) }; }
export function removeAsset(data: TopicData, id: string): TopicData {
  // Historical run snapshots retain the exact data version used at the time.
  return { ...data, assets: data.assets.filter(a => a.id !== id), experiments: data.experiments.map(e => ({ ...e, dataIds: e.dataIds.filter(x => x !== id) })) };
}
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
const textFields = (v: Record<string, unknown>, keys: string[]) => keys.every(k => typeof v[k] === 'string');
const timestamp = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const entries = (v: unknown, check: (item: Record<string, unknown>) => boolean) => Array.isArray(v) && v.every(x => object(x) && check(x)) && new Set(v.map(x => x.id)).size === v.length;
const dated = (v: Record<string, unknown>) => textFields(v, ['id', 'title']) && timestamp(v.createdAt) && timestamp(v.updatedAt);
export function isTopicData(v: unknown): v is TopicData {
  if (!object(v) || !textFields(v, ['question', 'hypothesis', 'conclusion', 'blocker', 'focus', 'nextStep']) || (v.tasks !== undefined && !isResearchTasks(v.tasks))) return false;
  return Array.isArray(v.papers) && v.papers.every(p => object(p) && textFields(p, ['paperId', 'role', 'note']) && timestamp(p.linkedAt)) && new Set(v.papers.map(p => p.paperId)).size === v.papers.length
    && entries(v.ideas, i => dated(i) && textFields(i, ['content', 'status']) && Object.hasOwn(IDEA_LABELS, String(i.status)) && strings(i.paperIds))
    && entries(v.assets, a => dated(a) && textFields(a, ['kind', 'version', 'location', 'notes']) && Object.hasOwn(ASSET_LABELS, String(a.kind)) && (a.vaultPath === undefined || typeof a.vaultPath === 'string') && (a.filename === undefined || typeof a.filename === 'string') && (a.size === undefined || timestamp(a.size)))
    && entries(v.experiments, e => dated(e) && textFields(e, ['purpose', 'content', 'status', 'ideaId']) && Object.hasOwn(EXPERIMENT_LABELS, String(e.status)) && strings(e.paperIds) && strings(e.dataIds) && entries(e.runs, r => dated(r) && textFields(r, ['parameters', 'codeVersion', 'result', 'status']) && Object.hasOwn(EXPERIMENT_LABELS, String(r.status)) && object(r.metrics) && Object.values(r.metrics).every(x => typeof x === 'string') && strings(r.assetIds) && entries(r.datasets, d => textFields(d, ['id', 'title', 'version']))))
    && entries(v.milestones, m => textFields(m, ['id', 'title', 'date']) && typeof m.done === 'boolean')
    && entries(v.events, e => textFields(e, ['id', 'title', 'content', 'date', 'kind']) && ['activity', 'decision', 'milestone'].includes(String(e.kind)) && timestamp(e.createdAt) && (e.sourceType === undefined || ['idea', 'experiment', 'asset', 'paper', 'milestone'].includes(String(e.sourceType))) && (e.sourceId === undefined || typeof e.sourceId === 'string'));
}
