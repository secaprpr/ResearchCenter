import { useState } from 'react';
import { moveLineageNode, taskAncestors, type LineagePlacement } from '../task-lineage';
import type { ResearchTask } from '../research-tasks';
import { Modal } from './Modal';

export function LineageMoveDialog({ task, tasks, close, move }: {
  task: ResearchTask;
  tasks: ResearchTask[];
  close: () => void;
  move: (id: string, placement: LineagePlacement) => void;
}) {
  const [mode, setMode] = useState<'after' | 'edge' | 'root'>('after');
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');
  const candidates = tasks.filter(t => !taskAncestors(tasks, t.id).has(task.id));
  const edges = tasks.flatMap(t => (t.parentIds || []).filter(id => candidates.some(p => p.id === id) && t.id !== task.id).map(from => ({ from, to: t.id })));
  const placement: LineagePlacement | null = mode === 'root' ? { kind: 'root' }
    : mode === 'after' ? target ? { kind: 'after', nodeId: target } : null
    : edges[Number(target)] && target !== '' ? { kind: 'edge', ...edges[Number(target)] } : null;
  const name = (id: string) => tasks.find(t => t.id === id)?.title || '';
  const submit = () => { if (!placement) return; try { moveLineageNode(tasks, task.id, placement); move(task.id, placement); close(); } catch (e) { setError((e as Error).message); } };
  return <Modal title="移动节点" onClose={close} footer={<><button className="btn btn-ghost" onClick={close}>取消</button><button className="btn btn-primary" disabled={!placement} onClick={submit}>移动</button></>}>
    <div className="rt-form">
      <strong>{task.title}</strong>
      <label>放置方式<select aria-label="节点放置方式" value={mode} onChange={e => { setMode(e.target.value as typeof mode); setTarget(''); setError(''); }}><option value="after">接续到节点</option><option value="edge">插入连接线</option><option value="root">独立节点</option></select></label>
      {mode !== 'root' && <label>目标位置<select aria-label="节点目标位置" value={target} onChange={e => { setTarget(e.target.value); setError(''); }}><option value="">选择位置…</option>{mode === 'after'
        ? candidates.map(t => <option key={t.id} value={t.id}>{t.title}</option>)
        : edges.map((edge, index) => <option key={`${edge.from}/${edge.to}`} value={index}>{name(edge.from)} → {name(edge.to)}</option>)}</select></label>}
      {placement && <div className="rtl-placement-preview">{placement.kind === 'root' ? task.title : placement.kind === 'after' ? `${name(placement.nodeId)} → ${task.title}` : `${name(placement.from)} → ${task.title} → ${name(placement.to)}`}</div>}
      {error && <p className="rt-error" role="alert">{error}</p>}
    </div>
  </Modal>;
}
