import { create } from 'zustand';
import { useStore } from './store';
import { topicData } from './topics';
import type { ResearchTask } from './research-tasks';
import { applyLineageEdit, lineageEdit, type LineageEdit } from './lineage-history';
import { isCliNodeLocked } from './research-cli-locks';

interface History { undo: LineageEdit[]; redo: LineageEdit[] }
interface Notice { topicId: string; id: number; message: string; error: boolean }
export const useLineageSession = create<{ histories: Record<string, History>; notice: Notice | null }>(() => ({ histories: {}, notice: null }));
let noticeId = 0;
export function lineageNotice(topicId: string, message = '已保存', error = false) {
  const notice = { topicId, message, error, id: ++noticeId }; useLineageSession.setState({ notice });
  if (!error) setTimeout(() => { if (useLineageSession.getState().notice?.id === notice.id) useLineageSession.setState({ notice: null }); }, 1800);
}
function persistTasks(topicId: string, tasks: ResearchTask[]) {
  const state = useStore.getState(), record = state.records.find(r => r.id === topicId && !r.archived);
  if (!record) throw new Error('课题已不可用');
  try { state.updateRecord(topicId, { topic: { ...topicData(record), tasks } }); }
  catch (error) {
    try { useStore.setState({ records: state.records }); } catch { /* Preserve the original storage failure. */ }
    throw error;
  }
}
export function commitLineageTasks(topicId: string, change: (tasks: ResearchTask[]) => ResearchTask[], label = '更新节点') {
  const record = useStore.getState().records.find(r => r.id === topicId && !r.archived); if (!record) throw new Error('课题已不可用');
  const before = topicData(record).tasks || [], after = change(before), edit = lineageEdit(before, after, label);
  if (!edit) return;
  try { persistTasks(topicId, after); }
  catch (error) { lineageNotice(topicId, '保存失败，请保留输入后重试', true); throw error; }
  const state = useLineageSession.getState(), history = state.histories[topicId] || { undo: [], redo: [] };
  useLineageSession.setState({ histories: { ...state.histories, [topicId]: { undo: [...history.undo, edit].slice(-30), redo: [] } } });
  lineageNotice(topicId);
}
export function stepLineageHistory(topicId: string, direction: 'undo' | 'redo') {
  try {
    if (isCliNodeLocked(topicId)) throw new Error('请先完成当前编辑');
    const state = useLineageSession.getState(), history = state.histories[topicId], edit = history?.[direction].at(-1); if (!edit) return;
    const record = useStore.getState().records.find(r => r.id === topicId && !r.archived); if (!record) throw new Error('课题已不可用');
    persistTasks(topicId, applyLineageEdit(topicData(record).tasks || [], edit, direction));
    const undo = direction === 'undo' ? history.undo.slice(0, -1) : [...history.undo, edit];
    const redo = direction === 'redo' ? history.redo.slice(0, -1) : [...history.redo, edit];
    useLineageSession.setState({ histories: { ...state.histories, [topicId]: { undo, redo } } });
    lineageNotice(topicId, `${direction === 'undo' ? '已撤销' : '已重做'} · ${edit.label}`);
  } catch (error) { lineageNotice(topicId, (error as Error).message, true); }
}

export interface LineageView { selected: string; collapsed: string[]; mainOnly: boolean; scrollTop: number; anchor?: { id: string; offset: number }; width?: number | null; tabs: Record<string, string> }
const emptyView = (): LineageView => ({ selected: '', collapsed: [], mainOnly: false, scrollTop: 0, tabs: {} });
export function readLineageView(topicId: string): LineageView {
  try {
    const value = JSON.parse(localStorage.getItem(`research-lineage-view/${topicId}`) || 'null');
    if (!value || typeof value !== 'object') return emptyView();
    return { ...emptyView(), selected: typeof value.selected === 'string' ? value.selected : '', collapsed: Array.isArray(value.collapsed) ? value.collapsed.filter((id: unknown) => typeof id === 'string') : [], mainOnly: value.mainOnly === true, scrollTop: Number.isFinite(value.scrollTop) ? Math.max(0, value.scrollTop) : 0,
      ...(value.anchor && typeof value.anchor.id === 'string' && Number.isFinite(value.anchor.offset) ? { anchor: value.anchor } : {}),
      ...(value.width === null || (Number.isFinite(value.width) && value.width >= 48 && value.width <= 400) ? { width: value.width } : {}), tabs: value.tabs && typeof value.tabs === 'object' && !Array.isArray(value.tabs) ? value.tabs : {} };
  } catch { return emptyView(); }
}
export function writeLineageView(topicId: string, patch: Partial<LineageView>) {
  try { localStorage.setItem(`research-lineage-view/${topicId}`, JSON.stringify({ ...readLineageView(topicId), ...patch })); } catch { /* View preferences must not interrupt research edits. */ }
}
