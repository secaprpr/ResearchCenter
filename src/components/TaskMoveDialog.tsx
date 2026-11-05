import { useState } from 'react';
import type { RecordItem, Workspace } from '../types';
import type { TaskRef } from '../task-operations';
import { Modal } from './Modal';

export function TaskMoveDialog({ tasks, topics, workspaces, close, move }: { tasks: TaskRef[]; topics: RecordItem[]; workspaces: Workspace[]; close: () => void; move: (id: string) => void }) {
  const [destination, setDestination] = useState(''), [error, setError] = useState('');
  const allowed = topics.filter(topic => !topic.archived && tasks.some(task => task.topicId !== topic.id));
  return <Modal title="移动到课题" onClose={close} footer={<><button className="btn btn-ghost" onClick={close}>取消</button><button className="btn btn-primary" disabled={!allowed.some(t => t.id === destination)} onClick={() => { try { move(destination); close(); } catch (e) { setError((e as Error).message); } }}>移动{tasks.length > 1 ? ` ${tasks.length} 项` : ''}</button></>}><div className="rt-form"><label>目标课题<select aria-label="目标课题" autoFocus value={destination} onChange={e => setDestination(e.target.value)}><option value="">选择课题…</option>{workspaces.map(workspace => <optgroup key={workspace.id} label={workspace.name}>{allowed.filter(t => t.workspaceId === workspace.id).map(topic => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</optgroup>)}</select></label>{error && <p role="alert" className="rt-error">{error}</p>}</div></Modal>;
}
