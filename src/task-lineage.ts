import type { ResearchTask } from './research-tasks';

/** Reject invalid edits before persisting; rendering also tolerates old/dangling relationships. */
export function checkTaskParents(tasks: ResearchTask[], id: string, parents: string[]) {
  if (new Set(parents).size !== parents.length) throw new Error('前置节点重复');
  const byId = new Map(tasks.map(t => [t.id, t]));
  for (const parent of parents) {
    if (parent === id) throw new Error('节点不能接续自己');
    if (!byId.has(parent)) throw new Error('前置节点不在当前课题中');
    const seen = new Set<string>(), pending = [parent];
    while (pending.length) {
      const next = pending.pop()!;
      if (next === id) throw new Error('该关系会形成循环');
      if (seen.has(next)) continue;
      seen.add(next); pending.push(...(byId.get(next)?.parentIds || []));
    }
  }
}

export function lineageOrder(tasks: ResearchTask[]): ResearchTask[] {
  const sorted = [...tasks].sort((a, b) => (a.lineageRank ?? a.createdAt) - (b.lineageRank ?? b.createdAt) || a.id.localeCompare(b.id));
  const ids = new Set(sorted.map(t => t.id)), done = new Set<string>(), result: ResearchTask[] = [];
  while (result.length < sorted.length) {
    const next = sorted.find(t => !done.has(t.id) && (t.parentIds || []).every(p => !ids.has(p) || done.has(p)))
      || sorted.find(t => !done.has(t.id))!;
    result.push(next); done.add(next.id);
  }
  return result;
}

/** Fold only exclusive descendants; a merge supported by another visible branch remains visible. */
export function lineageRows(tasks: ResearchTask[], collapsed: Set<string>, mainOnly = false) {
  const ordered = lineageOrder(tasks), byId = new Map(tasks.map(t => [t.id, t]));
  const hidden = new Set<string>(), lanes = new Map<string, number>(), children = new Map<string, string[]>();
  for (const task of ordered) for (const parent of task.parentIds || []) {
    if (byId.has(parent)) children.set(parent, [...(children.get(parent) || []), task.id]);
  }
  // Allocate reusable lanes to active branches. A merge releases its incoming branch lanes.
  const ends = new Map<number, string>();
  for (const task of ordered) {
    const parents = (task.parentIds || []).filter(p => byId.has(p));
    if (parents.length && parents.every(p => collapsed.has(p) || hidden.has(p))) hidden.add(task.id);
    const first = parents[0], siblings = first ? children.get(first) || [] : [];
    let lane = first ? lanes.get(first) || 0 : 0;
    if (parents.length > 1) lane = 0;
    else if (task.branch || (first && task.id !== (siblings.find(id => !byId.get(id)?.branch) || siblings[0]))) {
      lane = 1; while (ends.has(lane)) lane++;
    }
    if (parents.length > 1) for (const parent of parents) {
      const incoming = lanes.get(parent); if (incoming && ends.get(incoming) === parent) ends.delete(incoming);
    }
    lanes.set(task.id, lane); if (lane) ends.set(lane, task.id);
  }
  const visible = ordered.filter(t => !hidden.has(t.id) && (!mainOnly || lanes.get(t.id) === 0));
  return { ordered, visible, lanes, children, hidden };
}

export function taskAncestors(tasks: ResearchTask[], selected: string): Set<string> {
  const byId = new Map(tasks.map(t => [t.id, t])), seen = new Set<string>(), pending = [selected];
  while (pending.length) { const id = pending.pop()!; if (seen.has(id)) continue; seen.add(id); pending.push(...(byId.get(id)?.parentIds || [])); }
  return seen;
}

export function cloneLineageTasks(tasks: ResearchTask[], newId: () => string) {
  const ids = new Map(tasks.map(t => [t.id, newId()]));
  return structuredClone(tasks).map(task => ({ ...task, id: ids.get(task.id)!, importKey: undefined,
    ...(task.parentIds ? { parentIds: task.parentIds.flatMap(id => ids.has(id) ? [ids.get(id)!] : []) } : {}),
    events: task.events.map(event => ({ ...event, id: newId() })) }));
}

export type LineagePlacement = { kind: 'root' } | { kind: 'after'; nodeId: string } | { kind: 'edge'; from: string; to: string };

function placeInOrder(before: ResearchTask[], after: ResearchTask[], id: string, placement: LineagePlacement) {
  const order = lineageOrder(before).map(t => t.id).filter(key => key !== id);
  const index = placement.kind === 'root' ? 0 : placement.kind === 'edge' ? order.indexOf(placement.to) : order.indexOf(placement.nodeId) + 1;
  order.splice(Math.max(0, index), 0, id);
  const ranks = new Map(order.map((key, rank) => [key, rank + 1]));
  return after.map(t => ({ ...t, lineageRank: ranks.get(t.id)! }));
}

export function appendLineageNode(tasks: ResearchTask[], node: ResearchTask) {
  if (tasks.some(t => t.id === node.id)) throw new Error('节点 ID 已存在');
  checkTaskParents(tasks, node.id, node.parentIds || []);
  const last = lineageOrder(tasks).filter(t => node.parentIds?.includes(t.id)).at(-1);
  return last ? placeInOrder(tasks, [...tasks, node], node.id, { kind: 'after', nodeId: last.id }) : [...tasks, node];
}

/** Remove only this node; its direct children inherit its incoming paths. */
export function removeLineageNode(tasks: ResearchTask[], id: string): ResearchTask[] {
  const node = tasks.find(t => t.id === id); if (!node) throw new Error('节点已不存在');
  const parents = (node.parentIds || []).filter(p => p !== id && tasks.some(t => t.id === p));
  return tasks.filter(t => t.id !== id).map(t => (t.parentIds || []).includes(id)
    ? { ...t, parentIds: [...new Set(t.parentIds!.flatMap(p => p === id ? parents : [p]))].filter(p => p !== t.id) }
    : t);
}

function placementParents(tasks: ResearchTask[], id: string, placement: LineagePlacement) {
  if (placement.kind === 'root') return [];
  const parent = placement.kind === 'after' ? placement.nodeId : placement.from;
  checkTaskParents(tasks, id, [parent]);
  if (placement.kind === 'edge') {
    if (placement.to === id || !tasks.find(t => t.id === placement.to)?.parentIds?.includes(placement.from)) throw new Error('连接线已改变');
  }
  return [parent];
}

/** Atomic single-node move: close its old position before attaching it at the new one. */
export function moveLineageNode(tasks: ResearchTask[], id: string, placement: LineagePlacement): ResearchTask[] {
  const node = tasks.find(t => t.id === id); if (!node) throw new Error('节点已不存在');
  const parents = placementParents(tasks, id, placement);
  // Keep a drop back on the same predecessor from silently changing its children.
  if (placement.kind === 'after' && node.parentIds?.length === 1 && node.parentIds[0] === placement.nodeId) return tasks;
  if (placement.kind === 'root' && !node.parentIds?.length) return tasks;
  const remaining = removeLineageNode(tasks, id);
  const branch = placement.kind === 'after' ? remaining.some(t => t.parentIds?.includes(placement.nodeId)) : placement.kind === 'edge' && !!tasks.find(t => t.id === placement.to)?.branch;
  const moved = { ...node, parentIds: parents, branch };
  const result = [...remaining.map(t => placement.kind === 'edge' && t.id === placement.to
    ? { ...t, parentIds: t.parentIds!.map(p => p === placement.from ? id : p), branch: false }
    : t), moved];
  for (const t of result) checkTaskParents(result, t.id, t.parentIds || []);
  return placeInOrder(tasks, result, id, placement);
}

export function insertLineageNode(tasks: ResearchTask[], node: ResearchTask, edge: { from: string; to: string }): ResearchTask[] {
  if (tasks.some(t => t.id === node.id)) throw new Error('节点 ID 已存在');
  placementParents(tasks, node.id, { kind: 'edge', ...edge });
  const target = tasks.find(t => t.id === edge.to)!;
  const result = [...tasks.map(t => t.id === edge.to ? { ...t, parentIds: t.parentIds!.map(p => p === edge.from ? node.id : p), branch: false } : t),
    { ...node, parentIds: [edge.from], branch: !!target.branch }];
  for (const t of result) checkTaskParents(result, t.id, t.parentIds || []);
  return placeInOrder(tasks, result, node.id, { kind: 'edge', ...edge });
}
