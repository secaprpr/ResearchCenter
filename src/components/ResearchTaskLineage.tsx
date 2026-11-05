import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion, useMotionValue, useReducedMotion, type PanInfo } from 'motion/react';
import { Check, ChevronDown, ChevronRight, GitBranch, GripVertical, MoreHorizontal, Pencil, Plus, Move, Trash2, Undo2, Redo2 } from 'lucide-react';
import { TASK_STATUS, taskTime, processEvents, type ResearchTask, type TaskCategory, type TaskStatus } from '../research-tasks';
import { lineageRows, moveLineageNode, taskAncestors, type LineagePlacement } from '../task-lineage';
import { TaskTags } from './ResearchTaskForms';
import { useContextMenu, type MenuAction } from './ContextMenu';
import { LineageMoveDialog } from './LineageMoveDialog';
import './research-task-lineage.css';
import { openTask } from '../task-followup';
import { readLineageView, writeLineageView, stepLineageHistory, useLineageSession } from '../lineage-session';

type Point = { x: number; y: number };
interface Props {
  topicId: string;
  tasks: ResearchTask[];
  visibleIds: Set<string>;
  categories: TaskCategory[];
  selected: string;
  choose: (id: string) => void;
  status: (id: string, value: TaskStatus) => void;
  menu: (event: React.MouseEvent<HTMLElement>, task: ResearchTask, treeActions?: MenuAction[]) => void;
  branch: (task: ResearchTask) => void;
  renderDetail: (task: ResearchTask, actions: ReactNode) => ReactNode;
  append: (task: ResearchTask) => void;
  add: (task: ResearchTask, parallel: boolean) => void;
  create: () => void;
  clearFilters: () => void;
  insert: (from: string, to: string) => void;
  edit: (task: ResearchTask) => void;
  remove: (task: ResearchTask) => void;
  move: (id: string, placement: LineagePlacement) => void;
  composer?: { anchor?: string; replace?: boolean; content: ReactNode };
}

type Drop = { placement: LineagePlacement; key: string; label: string; valid: boolean };
export function ResearchTaskLineage({ topicId, tasks, visibleIds, categories, selected, choose, status, menu, branch, renderDetail, append, add, create, clearFilters, insert, edit, remove, move, composer }: Props) {
  const [saved] = useState(() => readLineageView(topicId));
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(saved.collapsed));
  const [mainOnly, setMainOnly] = useState(saved.mainOnly);
  const session = useLineageSession(), history = session.histories[topicId], notice = session.notice?.topicId === topicId ? session.notice : null;
  const undo = history?.undo.length ? () => stepLineageHistory(topicId, 'undo') : undefined;
  const redo = history?.redo.length ? () => stepLineageHistory(topicId, 'redo') : undefined;
  const scroller = useRef<HTMLDivElement>(null), scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scrollSnapshot = useRef({ scrollTop: saved.scrollTop, anchor: saved.anchor });
  const [restored, setRestored] = useState(false);
  const graph = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [width, setWidth] = useState<number | null>(() => { if (saved.width !== undefined) return saved.width; const width = Number(localStorage.getItem('research-lineage-track-width')); return width >= 48 && width <= 400 ? width : null; });
  const [available, setAvailable] = useState(1100);
  const lastOpened = useRef(saved.selected);
  const reduced = useReducedMotion(), actions = useContextMenu();
  const [movingTask, setMovingTask] = useState<ResearchTask | null>(null), [dragging, setDragging] = useState(''), [drop, setDrop] = useState<Drop | null>(null), [error, setError] = useState('');
  const [hoverEdge, setHoverEdge] = useState<{ from: string; to: string; x: number; y: number } | null>(null);
  const dragX = useMotionValue(0), dragY = useMotionValue(0), dragId = useRef(''), cancelled = useRef(false), suppressClick = useRef(0);
  const trackingUntil = useRef(0), scheduleMeasure = useRef(() => {});
  const trackMotion = () => { if (!reduced) trackingUntil.current = performance.now() + 450; scheduleMeasure.current(); };
  const [geometry, setGeometry] = useState<{ width: number; height: number; trackWidth: number; points: Record<string, Point> }>({ width: 0, height: 0, trackWidth: 0, points: {} });
  const model = useMemo(() => lineageRows(tasks, collapsed, mainOnly), [tasks, collapsed, mainOnly]);
  const rows = model.visible.filter(t => visibleIds.has(t.id));
  // Height changes already move later rows in normal flow; reserve FLIP for structural changes.
  const rowOrder = `${rows.map(task => task.id).join('|')}/${composer ? `${composer.anchor || 'root'}:${composer.replace ? 'edit' : 'insert'}` : ''}`;
  const ancestors = useMemo(() => taskAncestors(tasks, selected), [tasks, selected]);
  const maxLane = Math.max(0, ...rows.map(t => model.lanes.get(t.id) || 0));
  const maxTrack = Math.max(48, Math.min(200, Math.floor(available * .25)));
  useEffect(() => { writeLineageView(topicId, { collapsed: [...collapsed], mainOnly, width }); }, [topicId, collapsed, mainOnly, width]);
  useEffect(() => () => { clearTimeout(scrollTimer.current); writeLineageView(topicId, scrollSnapshot.current); }, [topicId]);
  useLayoutEffect(() => {
    if (restored || !geometry.height || !scroller.current) return;
    const el = scroller.current, anchor = saved.anchor && [...(graph.current?.querySelectorAll<HTMLElement>('[data-node]') || [])].find(row => row.dataset.node === saved.anchor!.id);
    el.scrollTop = anchor ? el.scrollTop + anchor.getBoundingClientRect().top - el.getBoundingClientRect().top - saved.anchor!.offset : saved.scrollTop;
    setRestored(true);
  }, [geometry.height, restored, saved]);
  const rememberScroll = () => {
    if (!restored || !scroller.current) return;
    const el = scroller.current, top = el.getBoundingClientRect().top;
    const row = [...(graph.current?.querySelectorAll<HTMLElement>('[data-node]') || [])].find(row => row.getBoundingClientRect().bottom > top + 1);
    scrollSnapshot.current = { scrollTop: el.scrollTop, anchor: row ? { id: row.dataset.node!, offset: row.getBoundingClientRect().top - top } : undefined };
    clearTimeout(scrollTimer.current); scrollTimer.current = setTimeout(() => writeLineageView(topicId, scrollSnapshot.current), 150);
  };
  useLayoutEffect(() => {
    const element = panel.current; if (!element) return;
    const measure = () => setAvailable(Math.max(0, element.clientWidth));
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    return () => observer.disconnect();
  }, []);
  const resizeWidth = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault(); const handle = event.currentTarget, start = event.clientX, original = geometry.trackWidth;
    const max = maxTrack, min = 48; let next = Math.round(original);
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => { next = Math.round(Math.max(min, Math.min(max, original + e.clientX - start))); setWidth(next); };
    const end = () => { localStorage.setItem('research-lineage-track-width', String(next)); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  };
  const saveWidth = (next: number | null) => { setWidth(next); if (next === null) localStorage.removeItem('research-lineage-track-width'); else localStorage.setItem('research-lineage-track-width', String(next)); };
  useLayoutEffect(() => {
    if (!selected) { lastOpened.current = ''; return; }
    if (lastOpened.current === selected) return;
    lastOpened.current = selected;
    const upstream = taskAncestors(tasks, selected);
    setCollapsed(old => {
      const next = new Set([...old].filter(id => id === selected || !upstream.has(id)));
      return next.size === old.size ? old : next;
    });
    if ((lineageRows(tasks, new Set()).lanes.get(selected) || 0) > 0) setMainOnly(false);
    const frame = requestAnimationFrame(() => {
      const node = [...(graph.current?.querySelectorAll<HTMLElement>('[data-node]') || [])].find(el => el.dataset.node === selected);
      // Revealing the whole row while its body grows moves the viewport mid-animation.
      node?.querySelector('.rtl-entry')?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [selected, tasks]);
  useLayoutEffect(() => {
    const el = graph.current; if (!el) return;
    let frame = 0;
    const measure = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const base = el.getBoundingClientRect(), points: Record<string, Point> = {};
        el.querySelectorAll<HTMLElement>('[data-lineage-dot]').forEach(dot => { const rect = dot.getBoundingClientRect(); points[dot.dataset.lineageDot!] = { x: rect.x + rect.width / 2 - base.x, y: rect.y + rect.height / 2 - base.y }; });
        const next = { width: base.width, height: el.offsetHeight, trackWidth: el.querySelector('.rtl-rail')?.getBoundingClientRect().width || 0, points };
        setGeometry(old => JSON.stringify(old) === JSON.stringify(next) ? old : next);
        if (performance.now() < trackingUntil.current) measure();
      });
    };
    scheduleMeasure.current = measure;
    const observer = new ResizeObserver(measure); observer.observe(el);
    const changes = new MutationObserver(records => { if (records.some(record => !(record.target instanceof Element && record.target.closest('.rtl-wires,.rtl-interactions')))) measure(); });
    changes.observe(el, { childList: true, subtree: true });
    el.querySelectorAll('.rtl-entry').forEach(row => observer.observe(row)); measure();
    return () => { observer.disconnect(); changes.disconnect(); cancelAnimationFrame(frame); scheduleMeasure.current = () => {}; };
  }, [model, selected, visibleIds]);
  const visible = new Set(rows.map(t => t.id));
  const axisPoints = Object.entries(geometry.points).filter(([id]) => visible.has(id) && id !== dragging).map(([, point]) => point);
  const byId = new Map(tasks.map(t => [t.id, t]));
  const edges: Array<{ from: string; to: string }> = [];
  for (const task of rows) {
    const pending = [...(task.parentIds || [])], seen = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!; if (seen.has(id) || id === task.id) continue; seen.add(id);
      if (visible.has(id)) edges.push({ from: id, to: task.id });
      else pending.push(...(byId.get(id)?.parentIds || []));
    }
  }
  const lastPointer = useRef<Point | null>(null);
  const dropAt = (point: Point, id: string): Drop | null => {
    const root = panel.current?.querySelector('[data-lineage-root]')?.getBoundingClientRect();
    let placement: LineagePlacement | null = root && point.x >= root.left && point.x <= root.right && point.y >= root.top && point.y <= root.bottom ? { kind: 'root' } : null;
    if (!placement) for (const button of graph.current?.querySelectorAll<HTMLElement>('[data-drag-node]') || []) {
      if (button.dataset.dragNode === id) continue;
      const rect = button.getBoundingClientRect();
      if (Math.hypot(point.x - rect.x - rect.width / 2, point.y - rect.y - rect.height / 2) < 14) { placement = { kind: 'after', nodeId: button.dataset.dragNode! }; break; }
    }
    if (!placement) {
      const edge = document.elementsFromPoint(point.x, point.y).find(el => el.hasAttribute('data-edge-from') && el.getAttribute('data-edge-from') !== id && el.getAttribute('data-edge-to') !== id);
      if (edge) placement = { kind: 'edge', from: edge.getAttribute('data-edge-from')!, to: edge.getAttribute('data-edge-to')! };
    }
    if (!placement) return null;
    const name = (node: string) => byId.get(node)?.title || '';
    const label = placement.kind === 'root' ? '独立节点' : placement.kind === 'after' ? `接续：${name(placement.nodeId)}` : `插入：${name(placement.from)} → ${name(placement.to)}`;
    try { moveLineageNode(tasks, id, placement); return { placement, key: JSON.stringify(placement), label, valid: true }; }
    catch (e) { return { placement, key: JSON.stringify(placement), label: (e as Error).message, valid: false }; }
  };
  const updateDrop = (point: Point) => { const next = dropAt(point, dragId.current); setDrop(old => old?.key === next?.key && old?.valid === next?.valid ? old : next); };
  const dragStart = (task: ResearchTask, info: PanInfo) => {
    cancelled.current = false; suppressClick.current = Infinity; dragId.current = task.id; setDragging(task.id); setHoverEdge(null); setError('');
    lastPointer.current = { x: info.point.x - window.scrollX, y: info.point.y - window.scrollY };
    dragX.set(lastPointer.current.x + 18); dragY.set(lastPointer.current.y + 16); trackMotion();
  };
  const dragMove = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (cancelled.current) return;
    const point = { x: info.point.x - window.scrollX, y: info.point.y - window.scrollY }; lastPointer.current = point;
    dragX.set(point.x + 18); dragY.set(point.y + 16); updateDrop(point); trackMotion();
  };
  const dragEnd = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const id = dragId.current, next = dropAt({ x: info.point.x - window.scrollX, y: info.point.y - window.scrollY }, id);
    suppressClick.current = performance.now() + 300; dragId.current = ''; lastPointer.current = null;
    setDragging(''); setDrop(null); trackMotion();
    if (!cancelled.current && event.type !== 'pointercancel' && next?.valid) {
      try { move(id, next.placement); } catch (e) { setError((e as Error).message); }
    }
  };
  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); cancelled.current = true; suppressClick.current = Infinity; setDragging(''); setDrop(null); } };
    const scroll = () => {
      const scroller = graph.current?.parentElement, point = lastPointer.current;
      if (scroller && point && !cancelled.current) {
        const rect = scroller.getBoundingClientRect();
        if (point.x >= rect.left && point.x <= rect.right) {
          const speed = point.y < rect.top + 36 ? -9 : point.y > rect.bottom - 36 ? 9 : 0;
          if (speed) { scroller.scrollTop += speed; updateDrop(point); trackMotion(); }
        }
      }
      frame = requestAnimationFrame(scroll);
    };
    window.addEventListener('keydown', cancel); frame = requestAnimationFrame(scroll);
    return () => { window.removeEventListener('keydown', cancel); cancelAnimationFrame(frame); };
    // The gesture uses a snapshot; the store validates against current tasks again on drop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);
  const toggle = (id: string) => setCollapsed(old => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const treeActions = (task: ResearchTask): MenuAction[] => model.children.get(task.id)?.length ? [{
    label: collapsed.has(task.id) ? '展开后续分支' : '折叠后续分支',
    icon: collapsed.has(task.id) ? <ChevronRight /> : <ChevronDown />,
    separator: true,
    action: () => toggle(task.id),
  }] : [];
  const nodeMenu = (event: React.MouseEvent<HTMLElement>, task: ResearchTask) => {
    if (performance.now() < suppressClick.current) return;
    actions.open(event, [
      { label: '接续节点', icon: <Plus />, action: () => add(task, false) },
      { label: '新增并行分支', icon: <GitBranch />, action: () => add(task, true) },
      { label: '追加进展', icon: <Plus />, action: () => append(task) },
      ...treeActions(task),
      { label: '编辑节点', icon: <Pencil />, separator: true, action: () => edit(task) },
      { label: '移动节点…', icon: <Move />, action: () => setMovingTask(task) },
      { label: '删除节点…', icon: <Trash2 />, danger: true, separator: true, action: () => remove(task) },
    ], task.title);
  };
  const addMenu = (event: React.MouseEvent<HTMLElement>, task: ResearchTask) => actions.open(event, [
    { label: '追加进展', icon: <Plus />, action: () => append(task), separator: true },
    { label: '接续节点', icon: <Plus />, action: () => add(task, false) },
    { label: '新增并行分支', icon: <GitBranch />, action: () => add(task, true) },
  ], task.title);
  const statusMenu = (event: React.MouseEvent<HTMLButtonElement>, task: ResearchTask) => actions.open(event,
    (Object.entries(TASK_STATUS) as [TaskStatus, string][]).map(([value,label]) => ({ label, checked: task.status === value, action: () => {
      try { setError(''); status(task.id, value); } catch (error) { setError((error as Error).message); }
    } })), '节点状态');
  const edgeFocus = (event: React.PointerEvent<SVGPathElement> | React.FocusEvent<SVGPathElement>, from: string, to: string) => {
    if (dragging) return;
    const point = event.currentTarget.getPointAtLength(event.currentTarget.getTotalLength() / 2);
    setHoverEdge({ from, to, x: point.x, y: point.y });
  };
  const titleTags = (task: ResearchTask) => {
    const ids = [...new Set(task.categoryIds.flatMap(id => {
      const category = categories.find(item => item.id === id);
      if (!category) return [];
      return [categories.find(item => item.id === category.parentId)?.id || category.id];
    }))];
    return ids.length ? <TaskTags ids={ids} categories={categories} /> : null;
  };
  const metadata = (task: ResearchTask) => <div className="rtl-meta"><small>{openTask(task) && (task.blocker?.trim() || task.waitingFor?.trim()) && <span className={`rtl-followup-flag ${task.blocker?.trim() ? 'is-blocked' : 'is-waiting'}`} title={task.blocker?.trim() || task.waitingFor}>{task.blocker?.trim()?'受阻':'等待'}</span>}{processEvents(task).length > 0 && `${processEvents(task).length} 条记录`}{collapsed.has(task.id) && ' · 后续已折叠'}</small></div>;
  const anchoredComposer = composer?.anchor && rows.some(t => t.id === composer.anchor);
  const composerRow = composer && <motion.li key="node-composer" layout={reduced ? false : 'position'} layoutDependency={rowOrder} initial={{opacity:0}} animate={{opacity:1}} className="rtl-composer-row"><div className="rtl-composer-content">{composer.content}</div></motion.li>;
  return <section ref={panel} className="rtl-view" aria-label="课题研究脉络" onKeyDown={event => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.defaultPrevented || (event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true],.rtl-editor')) return;
      if (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y') { event.preventDefault(); stepLineageHistory(topicId, event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo'); }
    }} style={{ ...(width !== null ? { '--rtl-user-track': `${width}px` } : {}) } as CSSProperties}>
    <header className="rtl-toolbar"><span><GitBranch size={15} />研究脉络 <small>{rows.length} / {tasks.length}</small></span>{notice && <span className={`rtl-save-state ${notice.error ? 'is-error' : ''}`} role={notice.error ? 'alert' : 'status'}>{!notice.error && <Check size={13} />}{notice.message}</span>}{undo && <button className="rt-text-button" aria-label="撤销上次脉络操作" title={`撤销：${history!.undo.at(-1)!.label}`} onClick={undo}><Undo2 size={14} />撤销</button>}{redo && <button className="rt-text-button" aria-label="重做上次脉络操作" title={`重做：${history!.redo.at(-1)!.label}`} onClick={redo}><Redo2 size={14} />重做</button>}{dragging && <span data-lineage-root className={`rtl-root-drop ${drop?.placement.kind === 'root' ? 'is-target' : ''}`}>独立节点</span>}{tasks.length > 0 && <button className="rt-text-button" aria-pressed={mainOnly} onClick={() => setMainOnly(!mainOnly)}>只看主干</button>}{collapsed.size > 0 && <button className="rt-text-button" onClick={() => setCollapsed(new Set())}>展开分支</button>}</header>
    <motion.div ref={scroller} layoutScroll className="rtl-scroll" onScroll={rememberScroll}><div ref={graph} className="rtl-graph" onPointerLeave={() => setHoverEdge(null)} onPointerMove={event => { if (!(event.target as Element).closest('.rtl-edge-hit,.rtl-edge-insert')) setHoverEdge(null); }} style={{ '--rtl-lanes': Math.max(1, maxLane) } as CSSProperties}>
      {geometry.width > 0 && <svg className="rtl-wires" width={geometry.width} height={geometry.height} viewBox={`0 0 ${geometry.width} ${geometry.height}`} aria-hidden="true">{axisPoints.length > 1 && <line className="rtl-time-axis" x1={Math.min(...axisPoints.map(p => p.x))} x2={Math.min(...axisPoints.map(p => p.x))} y1={Math.min(...axisPoints.map(p => p.y))} y2={Math.max(...axisPoints.map(p => p.y))} />}{edges.map(({ from, to }) => {
        const a = geometry.points[from], b = geometry.points[to]; if (!a || !b) return null;
        const bend = Math.min(22, Math.max(8, Math.abs(b.y - a.y) / 3));
        const path = a.x === b.x ? `M${a.x},${a.y}L${b.x},${b.y}` : `M${a.x},${a.y}L${a.x},${a.y + bend}C${a.x},${a.y + bend * 2} ${b.x},${a.y + bend} ${b.x},${a.y + bend * 2}L${b.x},${b.y}`;
        return <path key={`${from}/${to}`} data-lineage-edge={`${from}/${to}`} className={`${ancestors.has(from) && ancestors.has(to) ? 'is-related' : ''} ${drop?.placement.kind === 'edge' && drop.placement.from === from && drop.placement.to === to ? 'is-target' : ''}`} d={path} />;
      })}</svg>}
      <svg className="rtl-interactions" width={geometry.width} height={geometry.height} aria-label="连接线操作">{edges.filter(edge => byId.get(edge.to)?.parentIds?.includes(edge.from)).map(({from,to}) => {
        const a = geometry.points[from], b = geometry.points[to]; if (!a || !b) return null;
        const bend = Math.min(22, Math.max(8, Math.abs(b.y - a.y) / 3));
        const d = a.x === b.x ? `M${a.x},${a.y}L${b.x},${b.y}` : `M${a.x},${a.y}L${a.x},${a.y + bend}C${a.x},${a.y + bend * 2} ${b.x},${a.y + bend} ${b.x},${a.y + bend * 2}L${b.x},${b.y}`;
        return <path key={`${from}/${to}`} data-edge-from={from} data-edge-to={to} className="rtl-edge-hit" d={d} role="button" tabIndex={0} aria-label={`插入节点 ${byId.get(from)?.title} → ${byId.get(to)?.title}`} onPointerEnter={event => edgeFocus(event,from,to)} onFocus={event => edgeFocus(event,from,to)} onClick={() => { setHoverEdge(null); insert(from,to); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setHoverEdge(null); insert(from,to); } }} />;
      })}</svg>
      {hoverEdge && !dragging && <motion.button initial={{opacity:0,scale:.8}} animate={{opacity:1,scale:1}} transition={{duration:reduced ? 0 : .12}} className="rtl-edge-insert" style={{left:hoverEdge.x,top:hoverEdge.y}} aria-label="在此连接线插入节点" title="插入节点" onClick={() => { insert(hoverEdge.from,hoverEdge.to); setHoverEdge(null); }}><Plus size={13} /></motion.button>}
      <ol className="rtl-rows"><AnimatePresence initial={false} mode="popLayout">{rows.flatMap(task => {
        const stamp = taskTime(task.createdAt), lane = model.lanes.get(task.id) || 0, editing = composer?.replace && composer.anchor === task.id, open = selected === task.id || !!editing;
        const children = model.children.get(task.id) || [];
        return [<motion.li layout={reduced ? false : "position"} layoutDependency={rowOrder} initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{layout:{duration:reduced ? 0 : .24,ease:[.22,1,.36,1]},opacity:{duration:reduced ? 0 : .12}}} onLayoutAnimationStart={trackMotion} onLayoutAnimationComplete={() => scheduleMeasure.current()} key={task.id} data-node={task.id} className={`rtl-row ${children.length ? 'has-children' : 'is-leaf'} ${(task.parentIds || []).length ? 'has-parents' : 'is-root'} ${editing ? 'is-editing' : ''} ${open ? 'is-open' : ''} ${dragging === task.id ? 'is-dragging' : ''} ${drop?.placement.kind === 'after' && drop.placement.nodeId === task.id ? drop.valid ? 'is-drop-target' : 'is-drop-invalid' : ''} ${ancestors.has(task.id) ? 'is-related' : ''} style-${task.nodeStyle || 'standard'}`} style={{ '--rtl-lane': lane } as CSSProperties}>
          <time className="rtl-date" dateTime={new Date(task.createdAt).toISOString()} title={stamp}><span className="rtl-date-year">{stamp.slice(0, 5)}</span><span>{stamp.slice(5, 10)}</span><span className="rtl-date-clock">{stamp.slice(11)}</span></time>
          <div className="rtl-rail"><motion.button className="rtl-node-hit" onPointerDownCapture={() => { dragId.current = ''; cancelled.current = false; suppressClick.current = 0; }} onPointerUpCapture={() => { if (dragId.current || cancelled.current) suppressClick.current = performance.now() + 600; }} data-drag-node={task.id} aria-label={`节点操作 ${task.title}`} aria-haspopup="menu" title="节点操作 · 拖动调整接续关系" drag dragSnapToOrigin dragMomentum={false} dragElastic={0} dragTransition={{bounceStiffness:600,bounceDamping:40}} onDragStart={(_event,info) => dragStart(task,info)} onDrag={dragMove} onDragEnd={dragEnd} onAnimationComplete={() => scheduleMeasure.current()} onClick={event => nodeMenu(event,task)} onContextMenu={event => nodeMenu(event,task)}><span className="rtl-dot" data-lineage-dot={task.id} /></motion.button></div>
          <article className="rtl-entry" onContextMenu={event => menu(event, task, treeActions(task))}>
            <div className="rtl-heading"><button className="rtl-title" title={task.title} aria-label={task.title} aria-expanded={open} aria-controls={`lineage-content-${task.id}`} onClick={() => choose(open ? '' : task.id)} onDoubleClick={() => edit(task)}><ChevronRight size={14} />{titleTags(task)}<span className="rtl-title-text">{task.title}</span>{task.version && <small>{task.version}</small>}</button>{metadata(task)}<button type="button" className="rtl-status-button" aria-label={`修改节点状态 ${task.title}`} aria-haspopup="menu" title={`当前状态：${TASK_STATUS[task.status]} · 点击修改`} onClick={event => statusMenu(event, task)}><span className={`rt-status status-${task.status}`}>{TASK_STATUS[task.status]}</span><ChevronDown size={12} aria-hidden="true" /></button><button className="rt-icon rtl-add-child" aria-label={`添加子节点 ${task.title}`} title="添加子节点" aria-haspopup="menu" onClick={event => addMenu(event, task)}><Plus size={15} /></button><button className="rt-icon" aria-label={`任务菜单 ${task.title}`} onClick={event => menu(event, task, treeActions(task))}><MoreHorizontal size={16} /></button></div>
          </article>
          <AnimatePresence initial={false}>{open && <motion.div initial={restored && !reduced ? {height:0,opacity:0} : false} animate={{height:"auto",opacity:1}} exit={{height:0,opacity:0}} transition={{height:{duration:reduced ? 0 : .22,ease:[.2,0,.2,1]},opacity:{duration:reduced ? 0 : .14}}} onAnimationStart={trackMotion} onAnimationComplete={() => scheduleMeasure.current()} className="rtl-expanded" id={`lineage-content-${task.id}`} role="region" aria-label={`节点内容 ${task.title}`}><div className="rtl-expanded-body">{metadata(task)}{editing ? <div className="rtl-composer-content">{composer.content}</div> : renderDetail(task, <>{(task.parentIds || []).length > 0 && <details className="rtl-parents"><summary>前置节点 {task.parentIds!.length}</summary><div>{task.parentIds!.filter(id => byId.has(id)).map(id => <button className="rt-text-button" key={id} onClick={() => { setCollapsed(new Set()); choose(id); }}>{byId.get(id)!.title}</button>)}</div></details>}<button className="rt-text-button rtl-continue" onClick={() => branch(task)}><Plus size={14} />接续节点</button></>)}</div></motion.div>}</AnimatePresence>
        </motion.li>, anchoredComposer && !composer?.replace && composer?.anchor === task.id ? composerRow : null];
      })}{!anchoredComposer && composerRow}</AnimatePresence></ol>
      {!tasks.length && !composer && <button className="rtl-create-row rtl-first-node" onClick={create}><span className="rtl-create-mark"><Plus size={15} /></span><span>创建首个节点</span></button>}
      {rows.length > 0 && !composer && <button className="rtl-create-row" onClick={create}><span className="rtl-create-mark"><Plus size={14} /></span><span>新建独立节点</span></button>}
      {tasks.length > 0 && !rows.length && <div className="rt-empty"><span>没有匹配的节点</span><button className="rt-secondary" onClick={() => { setMainOnly(false); setCollapsed(new Set()); clearFilters(); }}>清除筛选</button></div>}
    {rows.length > 0 && <div className="rtl-width-handle" role="separator" tabIndex={0} aria-label="调整分支轨道宽度" title="调整分支轨道宽度 · 双击重置" aria-orientation="vertical" aria-valuemin={48} aria-valuemax={maxTrack} aria-valuenow={Math.round(geometry.trackWidth)} onPointerDown={resizeWidth} onDoubleClick={() => saveWidth(null)} onKeyDown={event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault(); const min = 48, current = Math.round(geometry.trackWidth);
      saveWidth(event.key === 'Home' ? min : event.key === 'End' ? maxTrack : Math.max(min, Math.min(maxTrack, current + (event.key === 'ArrowRight' ? 8 : -8))));
    }}><GripVertical size={12} aria-hidden="true" /></div>}
    </div></motion.div>
    <AnimatePresence>{dragging && <motion.div className={`rtl-drag-label ${drop && !drop.valid ? 'is-invalid' : ''}`} style={{x:dragX,y:dragY}} initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:.1}}><strong>{byId.get(dragging)?.title}</strong><span>{drop?.label || '松开取消'}</span></motion.div>}</AnimatePresence>
    <span className="sr-only" aria-live="polite">{drop?.label || ''}</span>
    {error && <p className="rt-error" role="alert">{error}</p>}
    {movingTask && <LineageMoveDialog task={movingTask} tasks={tasks} close={() => setMovingTask(null)} move={move} />}{actions.menu}
  </section>;
}
