import { useEffect, useRef, useState } from 'react';
import { useStore, uid } from '../store';
import { applyTodayData, isTodayData, mergeTodayImport, projectTodayData, type TodayData } from '../today-data';
import { requestEditor } from '../editorBus';
import { openTopic, useTopicLibrary } from '../topic-library';
import './today-workspace.css';

/** Native records remain authoritative; the isolated task UI owns its extra metadata. */
export function TodayWorkspace({ typeId, active = true }: { typeId: string; active?: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const token = useRef(uid());
  const baseline = useRef<TodayData | null>(null);
  const initialize = useRef(() => {});
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let committing = false, lastSent = '', scheduled = 0;
    const origin = location.protocol === 'file:' ? '*' : location.origin;
    const send = (type: string, detail: Record<string, unknown> = {}) => frame.current?.contentWindow?.postMessage({ type, token: token.current, ...detail }, origin);
    const snapshot = () => {
      const state = useStore.getState();
      return projectTodayData(state.records, typeId, state.todayData[typeId]);
    };
    const context = () => {
      const state = useStore.getState();
      const workspace = state.workspaces.find(item => item.id === state.workspaceFilter) || state.workspaces[0];
      return {
        typeId, title: state.types.find(type => type.id === typeId)?.name || '任务中心',
        defaultWorkspaceId: workspace?.id || 'ws-default', workspaces: state.workspaces,
        records: state.records.filter(record => !record.archived).map(record => ({ id: record.id, title: record.title, content: record.content, path: `workbench/${record.id}.md` })),
      };
    };
    const init = () => {
      try {
        const data = snapshot(), native = context();
        baseline.current = structuredClone(data);
        lastSent = JSON.stringify({ data, context: native });
        send('rw-today-init', { data, context: native });
      } catch (cause) { setError((cause as Error).message); }
    };
    initialize.current = init;
    const update = () => {
      scheduled = 0;
      if (!baseline.current) return;
      try {
        const data = snapshot(), native = context(), signature = JSON.stringify({ data, context: native });
        if (signature === lastSent) return;
        lastSent = signature;
        send('rw-today-update', { data, context: native });
      } catch (cause) { setError((cause as Error).message); }
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || (location.protocol !== 'file:' && event.origin !== location.origin)) return;
      const value = event.data;
      if (!value || typeof value !== 'object') return;
      if (value.type === 'rw-today-ready') { init(); return; }
      if (value.token !== token.current) return;
      if (value.type === 'rw-today-applied' && isTodayData(value.data)) {
        baseline.current = structuredClone(value.data);
        return;
      }
      if (value.type === 'rw-today-open-record' && typeof value.id === 'string') {
        const state = useStore.getState(), record = state.records.find(item => item.id === value.id);
        if (!record) return;
        if (state.types.find(type => type.id === record.typeId)?.kind === 'project') {
          openTopic(record.id); useTopicLibrary.setState({ tab: 'notes' });
        } else requestEditor({ recordId: record.id });
        return;
      }
      if (!['rw-today-save', 'rw-today-import'].includes(value.type) || typeof value.requestId !== 'string') return;
      try {
        if (!baseline.current) throw new Error('任务中心尚未完成连接，请重试。');
        const state = useStore.getState();
        if (!state.types.some(type => type.id === typeId && type.kind === 'todo')) throw new Error('当前待办类型已不可用。');
        const importing = value.type === 'rw-today-import';
        const current = snapshot();
        const data = importing ? mergeTodayImport(current, value.data) : value.data;
        const base = importing ? current : value.base !== undefined ? value.base : baseline.current;
        if (!isTodayData(data) || !isTodayData(base)) throw new Error('任务数据格式不正确，原有记录未修改。');
        const result = applyTodayData(state.records, typeId, data, base, context().defaultWorkspaceId, current);
        const workspaceIds = new Set(state.workspaces.map(workspace => workspace.id));
        if (result.records.some(record => record.typeId === typeId && !workspaceIds.has(record.workspaceId))) throw new Error('任务引用的工作区已不存在，请检查后重试。');
        committing = true;
        try {
          useStore.setState({ records: result.records, todayData: { ...state.todayData, [typeId]: result.data } });
        } finally { committing = false; }
        lastSent = JSON.stringify({ data: result.data, context: context() });
        setError('');
        send('rw-today-saved', { requestId: value.requestId, ok: true, data: result.data });
      } catch (cause) {
        send('rw-today-saved', { requestId: value.requestId, ok: false, error: (cause as Error).message });
      }
    };
    window.addEventListener('message', receive);
    const unsubscribe = useStore.subscribe((next, previous) => {
      if (committing || (next.records === previous.records && next.todayData === previous.todayData && next.workspaces === previous.workspaces && next.workspaceFilter === previous.workspaceFilter)) return;
      if (!scheduled) scheduled = requestAnimationFrame(update);
    });
    return () => { unsubscribe(); window.removeEventListener('message', receive); cancelAnimationFrame(scheduled); initialize.current = () => {}; };
  }, [typeId, attempt]);

  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: 'rw-today-visibility', token: token.current, active }, location.protocol === 'file:' ? '*' : location.origin);
  }, [active]);

  return <section className="today-native-workspace" aria-label="任务中心工作区">
    {error && <div className="today-native-error" role="alert"><span>{error}</span><button onClick={() => { setError(''); baseline.current = null; setAttempt(value => value + 1); }}>重新加载</button></div>}
    <iframe key={attempt} ref={frame} src="./today.html" title="任务中心" onLoad={() => initialize.current()} />
  </section>;
}
