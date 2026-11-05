import type { ResearchTask } from './research-tasks';
import { checkTaskParents } from './task-lineage';

type TaskKey = keyof ResearchTask;
interface FieldPatch { key: TaskKey; before: unknown; after: unknown }
interface NodePatch { id: string; before?: ResearchTask; after?: ResearchTask; fields?: FieldPatch[] }
export interface LineageEdit { label: string; changes: NodePatch[]; beforeOrder: string[]; afterOrder: string[] }
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Field patches preserve CLI progress added after a local graph edit. */
export function lineageEdit(before: ResearchTask[], after: ResearchTask[], label: string): LineageEdit | null {
  const a = new Map(before.map(t => [t.id, t])), b = new Map(after.map(t => [t.id, t]));
  const changes: NodePatch[] = [];
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const old = a.get(id), next = b.get(id);
    if (!old || !next) changes.push({ id, before: old, after: next });
    else {
      const fields = [...new Set([...Object.keys(old), ...Object.keys(next)])].filter(key => key !== 'updatedAt' && !equal(old[key as TaskKey], next[key as TaskKey]))
        .map(key => ({ key: key as TaskKey, before: old[key as TaskKey], after: next[key as TaskKey] }));
      if (fields.length) changes.push({ id, fields });
    }
  }
  if (!changes.length) return null;
  return structuredClone({ label, changes, beforeOrder: before.map(t => t.id), afterOrder: after.map(t => t.id) });
}

export function applyLineageEdit(tasks: ResearchTask[], edit: LineageEdit, direction: 'undo' | 'redo') {
  const from = direction === 'undo' ? 'after' : 'before', to = direction === 'undo' ? 'before' : 'after';
  const next = new Map(tasks.map(t => [t.id, t]));
  const conflict = () => { throw new Error('相关内容已有后续变更，无法覆盖。请保留当前记录。'); };
  for (const change of edit.changes) {
    const current = next.get(change.id);
    if (change.fields) {
      if (!current) return conflict();
      const patched = { ...current };
      for (const field of change.fields) {
        if (!equal(current[field.key], field[from])) return conflict();
        if (field[to] === undefined) delete patched[field.key];
        else Object.assign(patched, { [field.key]: structuredClone(field[to]) });
      }
      next.set(change.id, patched);
    } else {
      const expected = change[from], replacement = change[to];
      if (expected ? !current || !equal({ ...current, updatedAt: 0 }, { ...expected, updatedAt: 0 }) : !!current) return conflict();
      if (replacement) next.set(change.id, structuredClone(replacement)); else next.delete(change.id);
    }
  }
  const order = direction === 'undo' ? edit.beforeOrder : edit.afterOrder;
  const result = [...order.flatMap(id => next.has(id) ? [next.get(id)!] : []), ...tasks.filter(t => !order.includes(t.id) && next.has(t.id)).map(t => next.get(t.id)!)];
  for (const task of result) checkTaskParents(result, task.id, task.parentIds || []);
  return result;
}
