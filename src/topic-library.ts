import { create } from 'zustand';
import { uid, useStore } from './store';
import { emptyTopic, localDay, topicData } from './topics';
export interface TopicPaper { id: string; title: string; authors: string[]; venue: string; year: string; pdf: string; status: string }
export const useTopicLibrary = create<{ papers: TopicPaper[]; ready: boolean; selectedTopic: string; taskScope: string; tab: string; error: string; workspaceMode: 'tasks' | 'materials' }>(() => ({ papers: [], ready: false, selectedTopic: '', taskScope: 'all', tab: 'overview', error: '', workspaceMode: 'tasks' }));
const target = () => document.querySelector<HTMLIFrameElement>('.port-library-shell iframe')?.contentWindow;
const origin = () => location.protocol === 'file:' ? '*' : location.origin;
let sequence = 0;
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
export function topicRequest<T = unknown>(action: string, payload: unknown = {}): Promise<T> {
  const frame = target(); if (!frame) return Promise.reject(new Error('文献库尚未准备好'));
  const id = `topic-${++sequence}-${Date.now()}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('文献库响应超时，请重试')); }, 20000);
    pending.set(id, { resolve: value => resolve(value as T), reject, timer });
    frame.postMessage({ type: 'research-topic-command', id, action, payload }, origin());
  });
}
export function topicIndex() {
  const state = useStore.getState(), types = new Set(state.types.filter(t => t.kind === 'project').map(t => t.id));
  return state.records.filter(r => types.has(r.typeId)).map(r => ({ id: r.id, title: r.title, archived: r.archived, paperIds: topicData(r).papers.map(p => p.paperId) }));
}
export function sendTopicIndex() { target()?.postMessage({ type: 'research-topic-index', topics: topicIndex() }, origin()); }
export function openTopic(id: string) {
  const state = useStore.getState(), record = state.records.find(r => r.id === id); if (!record) return;
  useTopicLibrary.setState({ selectedTopic: id, taskScope: id, tab: 'papers', workspaceMode: 'materials' }); state.setSearch(''); state.setView(record.typeId);
  if (record.archived) useStore.getState().setStatusFilter('archived');
  if (state.workspaceFilter !== 'all' && state.workspaceFilter !== record.workspaceId) state.setWorkspaceFilter(record.workspaceId);
}
export async function openTopicPaper(id: string, pdf = false) {
  await openLibraryResource('open-paper', { path: id, pdf });
}
export async function openTopicAsset(path: string) { await openLibraryResource('open-asset', { path }); }
async function openLibraryResource(action: string, payload: unknown) {
  useStore.getState().setView('library'); useTopicLibrary.setState({ error: '' });
  try { await topicRequest(action, payload); } catch (error) { useTopicLibrary.setState({ error: (error as Error).message }); }
}
export function setPaperMembership(topicId: string, paperId: string, linked: boolean) {
  const state = useStore.getState(), record = state.records.find(r => r.id === topicId); if (!record) return;
  const data = record.topic ?? emptyTopic(), exists = data.papers.some(p => p.paperId === paperId); if (exists === linked) return;
  state.updateRecord(topicId, { topic: { ...data, papers: linked ? [...data.papers, { paperId, role: '相关工作', note: '', linkedAt: Date.now() }] : data.papers.filter(p => p.paperId !== paperId), events: linked ? [...data.events, { id: uid(), title: `关联论文：${useTopicLibrary.getState().papers.find(p => p.id === paperId)?.title || paperId.split('/').pop()}`, content: '', date: localDay(), kind: 'activity', sourceType: 'paper', sourceId: paperId, createdAt: Date.now() }] : data.events } });
}
export function receiveTopicMessage(event: MessageEvent) {
  if (event.source !== target() || (location.protocol !== 'file:' && event.origin !== location.origin)) return false;
  const data = event.data;
  if (data?.type === 'research-topic-result' && typeof data.id === 'string') {
    const request = pending.get(data.id); if (request) { clearTimeout(request.timer); pending.delete(data.id); if (data.error) request.reject(new Error(String(data.error))); else request.resolve(data.value); }
    return true;
  }
  if (data?.type === 'research-topic-catalog' && Array.isArray(data.papers)) {
    useTopicLibrary.setState({ papers: data.papers.filter((p: TopicPaper) => p && typeof p.id === 'string' && typeof p.title === 'string' && Array.isArray(p.authors) && p.authors.every(a => typeof a === 'string')) });
    useTopicLibrary.setState({ ready: true }); sendTopicIndex(); return true;
  }
  if (data?.type === 'research-topic-open' && typeof data.id === 'string') { openTopic(data.id); return true; }
  return false;
}
