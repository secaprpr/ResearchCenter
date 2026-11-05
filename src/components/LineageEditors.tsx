import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { uid, useStore } from '../store';
import { topicData } from '../topics';
import { checkTaskParents, taskAncestors } from '../task-lineage';
import { fromTaskInput, TASK_STATUS, taskInputTime, type ResearchTask, type TaskCategory, type TaskEvent, type TaskStatus, type TaskTemplate } from '../research-tasks';
import type { RecordItem } from '../types';
import { CategoryPicker } from './ResearchTaskForms';
import { lockCliNode } from '../research-cli-locks';
import { clearLineageDraft, readLineageDraft, writeLineageDraft } from '../lineage-drafts';
import { FOLLOWUP_LABELS, followupKeys } from '../task-followup';

function useEditingLock(topicId: string, nodeId: string) {
  const release = useRef<(() => void) | undefined>(undefined);
  useEffect(() => { const unlock = lockCliNode(topicId, nodeId); release.current = unlock; return unlock; }, [topicId, nodeId]);
  return () => release.current?.();
}

function useDraft<T,>(key: string, initial: () => T) {
  const [baseline] = useState<T>(initial);
  const [draft, setDraft] = useState<T>(() => readLineageDraft(key, baseline));
  const latest = useRef(draft), finished = useRef(false); latest.current = draft;
  useEffect(() => {
    const timer = setTimeout(() => { if (!finished.current) writeLineageDraft(key, latest.current); }, 200);
    return () => clearTimeout(timer);
  }, [key, draft]);
  useEffect(() => {
    const flush = () => { if (!finished.current) writeLineageDraft(key, latest.current); };
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, [key]);
  const finish = () => { finished.current = true; clearLineageDraft(key); };
  return [draft, setDraft, finish, JSON.stringify(draft) !== JSON.stringify(baseline)] as const;
}
function Actions({ disabled, close, dirty }: { disabled: boolean; close: () => void; dirty: boolean }) {
  return <div className="rtl-editor-actions">{dirty && <span className="rtl-unsaved" role="status" aria-label="未保存" title="未保存" />}<button type="submit" className="rt-icon" title="保存" aria-label="保存" disabled={disabled}><Check size={16} /></button><button type="button" className="rt-icon" title="取消" aria-label="取消" onClick={close}><X size={15} /></button></div>;
}
function InlineForm({ label, children, submit, cancel, dirty }: { label: string; children: ReactNode; submit: () => boolean; cancel: () => void; dirty: boolean }) {
  const form = useRef<HTMLFormElement>(null), completed = useRef(false), composing = useRef(false), pendingLeave = useRef(false);
  const latest = useRef({ submit, cancel, dirty }); latest.current = { submit, cancel, dirty };
  const complete = (leaving: boolean) => {
    if (!form.current || completed.current) return;
    if (composing.current) { pendingLeave.current ||= leaving; return; }
    if (leaving && !latest.current.dirty) { completed.current = true; latest.current.cancel(); }
    else completed.current = latest.current.submit();
  };
  const latestComplete = useRef(complete); latestComplete.current = complete;
  const pointer = useRef({ active: false, inside: false });
  useEffect(() => {
    const inside = (target: EventTarget | null) => target instanceof Node && !!form.current?.contains(target);
    const pointerDown = (e: PointerEvent) => { pointer.current = { active: true, inside: inside(e.target) }; };
    const click = (e: MouseEvent) => {
      const fromInside = pointer.current.active && pointer.current.inside;
      pointer.current.active = false;
      // Wait for click rather than pointerdown: collapsing a form must not move the target before it is clicked.
      if (!inside(e.target) && !fromInside) latestComplete.current(true);
    };
    const resetPointer = () => { pointer.current.active = false; };
    document.addEventListener('pointerdown', pointerDown, true);
    document.addEventListener('click', click, true);
    document.addEventListener('pointercancel', resetPointer, true);
    document.addEventListener('keydown', resetPointer, true);
    return () => {
      document.removeEventListener('pointerdown', pointerDown, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('pointercancel', resetPointer, true);
      document.removeEventListener('keydown', resetPointer, true);
    };
  }, []);
  const finishBlur = () => {
    if (document.hasFocus() && form.current && !form.current.contains(document.activeElement)) latestComplete.current(true);
  };
  return <form ref={form} className="rt-form rtl-editor" role="group" aria-label={label} onSubmit={e => { e.preventDefault(); complete(false); }} onBlur={e => {
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    if (!pointer.current.active) queueMicrotask(finishBlur);
  }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => {
    composing.current = false;
    if (pendingLeave.current) { pendingLeave.current = false; queueMicrotask(finishBlur); }
  }} onKeyDown={e => {
    if (e.nativeEvent.isComposing || composing.current) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); completed.current = true; cancel(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); complete(false); }
  }}>{children}</form>;
}

export function LineageNodeEditor({ topic, task, parents = [], parallel = false, insertion, categories, close, save }: {
  topic: RecordItem; task?: ResearchTask; parents?: string[]; parallel?: boolean; insertion?: {from: string; to: string}; categories: TaskCategory[];
  close: () => void; save: (task: ResearchTask, topicId: string) => void;
}) {
  const releaseLock = useEditingLock(topic.id, task?.id || '');
  const key = `${topic.id}/node/${task?.id || (insertion ? `edge/${insertion.from}/${insertion.to}` : `new/${parents.join(',')}/${parallel}`)}`;
  const [draft, set, finish, dirty] = useDraft(key, () => ({ title: task?.title || '', description: task?.description || '', categoryIds: task?.categoryIds || [], status: task?.status || 'running' as TaskStatus, time: taskInputTime(task?.createdAt), nodeType: task?.nodeType || '', nodeStyle: task?.nodeStyle || 'standard', version: task?.version || '', parentIds: task?.parentIds || parents, branch: task?.branch ?? parallel }));
  const [error, setError] = useState('');
  const tasks = topicData(topic).tasks || [], candidates = tasks.filter(t => t.id !== task?.id && (!task || !taskAncestors(tasks, t.id).has(task.id)));
  const cancel = () => { finish(); releaseLock(); close(); };
  const submit = () => { if (!draft.title.trim()) { setError('请填写节点名称'); return false; } try {
    const record = useStore.getState().records.find(r => r.id === topic.id); if (!record || record.archived) throw new Error('课题已不可用');
    const currentTasks = topicData(record).tasks || [], existing = task && currentTasks.find(t => t.id === task.id);
    if (task && !existing) throw new Error('节点已不存在');
    checkTaskParents(currentTasks, task?.id || '', draft.parentIds);
    const now = Date.now(), createdAt = existing && draft.time === taskInputTime(existing.createdAt) ? existing.createdAt : fromTaskInput(draft.time);
    let next: ResearchTask = { id: uid(), notes: '', events: [], assetIds: [], paperIds: [], links: [], comments: [], recordedAt: now, source: '手动', ...existing, ...draft, title: draft.title.trim(), nodeType: draft.nodeType.trim(), createdAt, updatedAt: now };
    if (existing && existing.status !== draft.status) next = { ...next, events: [...next.events, { id: uid(), title: TASK_STATUS[draft.status], description: '', occurredAt: now, recordedAt: now, source: '手动', evidence: '', templateId: '', templateVersion: 1, fields: [], status: draft.status }] };
    save(next, topic.id); finish(); releaseLock(); close(); return true;
  } catch (e) { setError((e as Error).message); return false; } };
  return <InlineForm label={task ? '编辑节点' : insertion ? '插入节点' : '新建节点'} submit={submit} cancel={cancel} dirty={dirty}>
    {!task && <div className="rtl-editor-context" aria-label="节点接续关系"><span>{insertion ? '插入连接线' : draft.parentIds.length ? draft.branch ? '并行分支' : '接续节点' : '独立节点'}</span>{draft.parentIds.map(id => <span key={id}>{tasks.find(t => t.id === id)?.title || id}</span>)}{insertion && <span>→ {tasks.find(t => t.id === insertion.to)?.title || insertion.to}</span>}</div>}
    <div className="rtl-editor-line"><input autoFocus aria-label="节点名称" placeholder="节点名称" value={draft.title} onChange={e => set({ ...draft, title: e.target.value })} /><Actions disabled={!draft.title.trim()} close={cancel} dirty={dirty} /></div>
    <textarea aria-label="目的与描述" placeholder="目的与描述…" rows={2} value={draft.description} onChange={e => set({ ...draft, description: e.target.value })} />
    <details className="rtl-editor-properties"><summary>属性</summary><div className="rtl-editor-property-grid">
      <label>节点类型<input aria-label="节点类型" placeholder="工作记录" value={draft.nodeType} onChange={e => set({ ...draft, nodeType: e.target.value })} /></label>
      <label>状态<select aria-label="任务状态" value={draft.status} onChange={e => set({ ...draft, status: e.target.value as TaskStatus })}>{Object.entries(TASK_STATUS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>样式<select aria-label="节点样式" value={draft.nodeStyle} onChange={e => set({ ...draft, nodeStyle: e.target.value as typeof draft.nodeStyle })}><option value="standard">普通记录</option><option value="milestone">关键节点</option><option value="snapshot">版本快照</option></select></label>
      <label>创建时间<input type="datetime-local" aria-label="任务创建时间" value={draft.time} onChange={e => set({ ...draft, time: e.target.value })} /></label>
      {draft.nodeStyle === 'snapshot' && <label>版本<input aria-label="节点版本" value={draft.version} onChange={e => set({ ...draft, version: e.target.value })} /></label>}
    </div><CategoryPicker value={draft.categoryIds} categories={categories} onChange={categoryIds => set({ ...draft, categoryIds })} />
      {candidates.length > 0 && <details className="rt-node-relations"><summary>调整接续关系</summary><fieldset disabled={!!insertion} className="rt-parent-picker"><legend>前置节点</legend><div>{candidates.map(t => <label key={t.id}><input type="checkbox" aria-label={`接续 ${t.title}`} checked={draft.parentIds.includes(t.id)} onChange={e => set({ ...draft, parentIds: e.target.checked ? [...draft.parentIds, t.id] : draft.parentIds.filter(id => id !== t.id) })} /><span>{t.title}</span></label>)}</div><label className="rt-parent-branch"><input type="checkbox" aria-label="作为并行分支" checked={draft.branch} onChange={e => set({ ...draft, branch: e.target.checked })} />并行分支</label></fieldset></details>}
    </details>{error && <p className="rt-error" role="alert">{error}</p>}
  </InlineForm>;
}

export function LineageEventEditor({ event, task, topicId, templates, close, save }: { event?: TaskEvent; task: ResearchTask; topicId: string; templates: TaskTemplate[]; close: () => void; save: (event: TaskEvent) => void }) {
  const releaseLock = useEditingLock(topicId, task.id);
  const [draft, set, finish, dirty] = useDraft(`${topicId}/${task.id}/event/${event?.id || 'new'}`, () => ({ title: event?.title || '', description: event?.description || '', templateId: event?.templateId || '', templateVersion: event?.templateVersion || 1, fields: event?.fields.map(f => ({ ...f, required: false })) || [], time: taskInputTime(event?.occurredAt ?? Date.now()), unknown: event?.occurredAt === null, status: event?.status || '', evidence: event?.evidence || '' }));
  const [error, setError] = useState('');
  const cancel = () => { finish(); releaseLock(); close(); };
  const submit = () => { if (!draft.title.trim()) { setError('请填写记录名称'); return false; } try {
    for (const f of draft.fields) {
      if (f.required && !f.value.trim()) throw new Error(`请填写${f.label}`);
      if (f.value && f.type === 'number' && !Number.isFinite(Number(f.value))) throw new Error(`${f.label}须为数值`);
      if (f.value && f.type === 'url' && !/^https?:\/\//i.test(f.value)) throw new Error(`${f.label}须为 http(s) 链接`);
    }
    const occurredAt = draft.unknown ? null : event?.occurredAt != null && draft.time === taskInputTime(event.occurredAt) ? event.occurredAt : fromTaskInput(draft.time);
    save({ id: event?.id || uid(), title: draft.title.trim(), description: draft.description, occurredAt, recordedAt: event?.recordedAt ?? Date.now(), source: event?.source || '手动', evidence: draft.evidence, templateId: draft.templateId, templateVersion: draft.templateVersion, fields: draft.fields.filter(f => f.value.trim()).map(({ id, label, type, value }) => ({ id, label, type, value })), ...(draft.status ? { status: draft.status as TaskStatus } : {}) }); finish(); releaseLock(); close(); return true;
  } catch (e) { setError((e as Error).message); return false; } };
  const stamp = draft.unknown ? '时间待确认' : draft.time.replace('T', ' ');
  return <article className="rt-event rtl-event-form" data-event-owner={task.id}><time className="rtl-date rtl-event-date" title={stamp}><span className="rtl-date-year">{draft.unknown ? '' : stamp.slice(0, 5)}</span><span>{draft.unknown ? stamp : stamp.slice(5, 10)}</span><span className="rtl-date-clock">{draft.unknown ? '' : stamp.slice(11)}</span></time>
    <InlineForm label={event ? '编辑记录' : '追加记录'} submit={submit} cancel={cancel} dirty={dirty}>
      <div className="rtl-editor-line"><input autoFocus aria-label="记录名称" placeholder="记录进展…" value={draft.title} onChange={e => set({ ...draft, title: e.target.value })} /><Actions disabled={!draft.title.trim()} close={cancel} dirty={dirty} /></div>
      <textarea rows={2} aria-label="记录内容" placeholder="补充内容…" value={draft.description} onChange={e => set({ ...draft, description: e.target.value })} />
      <div className="rtl-editor-fields">{draft.fields.map(f => <label key={f.id}><span>{f.label}{f.required ? ' *' : ''}</span><input aria-label={f.label} type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'url' ? 'url' : 'text'} value={f.value} onChange={e => set({ ...draft, fields: draft.fields.map(x => x.id === f.id ? { ...x, value: e.target.value } : x) })} /></label>)}</div>
      <details className="rtl-editor-properties"><summary>属性与模板</summary><div className="rtl-editor-property-grid">
        <label>字段模板<select aria-label="字段模板" value={draft.templateId} onChange={e => { const t = templates.find(t => t.id === e.target.value); set({ ...draft, templateId: t?.id || '', templateVersion: t?.version || 1, title: draft.title || t?.name || '', status: t?.status || '', fields: t?.fields.map(f => ({ ...f, value: draft.fields.find(x => x.id === f.id)?.value || '' })) || [] }); }}><option value="">自定义记录</option>{templates.filter(t => !t.archived).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}{event?.templateId && !templates.some(t => !t.archived && t.id === event.templateId) && <option value={event.templateId}>历史模板</option>}</select></label>
        <label>发生时间<input type="datetime-local" aria-label="发生时间" disabled={draft.unknown} value={draft.time} onChange={e => set({ ...draft, time: e.target.value })} /></label>
        <label>状态变更<select aria-label="记录状态变更" value={draft.status} onChange={e => set({ ...draft, status: e.target.value })}><option value="">不变更</option>{Object.entries(TASK_STATUS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>时间依据<input aria-label="时间依据" value={draft.evidence} onChange={e => set({ ...draft, evidence: e.target.value })} /></label>
      </div><label className="rt-checkbox"><input type="checkbox" checked={draft.unknown} onChange={e => set({ ...draft, unknown: e.target.checked })} />发生时间待确认</label></details>
      {error && <p className="rt-error" role="alert">{error}</p>}
    </InlineForm>
  </article>;
}

export function InlineDescription({ value, save, topicId, nodeId }: { value: string; save: (value: string) => void; topicId: string; nodeId: string }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(value);
  useEffect(() => editing ? lockCliNode(topicId, nodeId) : undefined, [editing,topicId,nodeId]);
  const cancelled = useRef(false);
  if (!editing) return <button className={`rtl-summary ${!value ? 'is-empty' : ''}`} aria-label="编辑任务描述" onClick={() => { setDraft(value); cancelled.current = false; setEditing(true); }}>{value || <><Plus size={12} />描述</>}</button>;
  return <textarea className="rtl-description-input" aria-label="编辑目的与描述" autoFocus rows={2} value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => { if (!cancelled.current && draft !== value) save(draft); setEditing(false); }} onKeyDown={e => {
    if (e.key === 'Escape') { e.preventDefault(); cancelled.current = true; setEditing(false); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) e.currentTarget.blur();
  }} />;
}

export function LineageFollowup({ task, topicId, save }: { task: ResearchTask; topicId: string; save: (patch: Pick<ResearchTask, 'expectedOutput' | 'nextStep' | 'blocker' | 'waitingFor'>) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <FollowupEditor task={task} topicId={topicId} save={save} close={() => setEditing(false)} />;
  const keys = followupKeys.filter(key => task[key]?.trim());
  return <div className="rtl-followup">{keys.length ? keys.map(key => <button key={key} className={`rtl-followup-value kind-${key}`} aria-label={`编辑${FOLLOWUP_LABELS[key]}`} title={`${FOLLOWUP_LABELS[key]}：${task[key]}`} onClick={() => setEditing(true)}><span>{FOLLOWUP_LABELS[key]}</span><span>{task[key]}</span></button>) : <button className="rt-text-button rtl-followup-add" onClick={() => setEditing(true)}><Plus size={12} />跟进</button>}</div>;
}

function FollowupEditor({ task, topicId, save, close }: { task: ResearchTask; topicId: string; save: (patch: Pick<ResearchTask, 'expectedOutput' | 'nextStep' | 'blocker' | 'waitingFor'>) => void; close: () => void }) {
  const releaseLock = useEditingLock(topicId, task.id);
  const [draft, set, finish, dirty] = useDraft(`${topicId}/${task.id}/followup`, () => ({ expectedOutput:task.expectedOutput || '',nextStep:task.nextStep || '',blocker:task.blocker || '',waitingFor:task.waitingFor || '' }));
  const [error, setError] = useState('');
  const cancel = () => { finish(); releaseLock(); close(); };
  const submit = () => { try { save(draft); finish(); releaseLock(); close(); return true; } catch(e) { setError((e as Error).message); return false; } };
  return <InlineForm label="编辑节点跟进" submit={submit} cancel={cancel} dirty={dirty}><div className="rtl-editor-line"><span className="rtl-followup-heading">跟进</span><Actions disabled={false} close={cancel} dirty={dirty} /></div><div className="rtl-followup-grid">{followupKeys.map(key => <label key={key}>{FOLLOWUP_LABELS[key]}<textarea autoFocus={key === 'nextStep'} rows={2} aria-label={FOLLOWUP_LABELS[key]} value={draft[key]} onChange={e=>set({...draft,[key]:e.target.value})} /></label>)}</div>{error && <p className="rt-error" role="alert">{error}</p>}</InlineForm>;
}
