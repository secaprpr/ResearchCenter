import React, { useEffect, useState } from 'react';
import { Plus, ArrowUpRight } from 'lucide-react';
export const postTopic = message => window.parent.postMessage(message, location.protocol === 'file:' ? '*' : location.origin);
export function useWorkbenchTopics(app) {
  const [topics, setTopics] = useState(app.workbenchTopics || []);
  useEffect(() => { const update = () => setTopics(app.workbenchTopics || []); window.addEventListener('workbench-topics-changed', update); return () => window.removeEventListener('workbench-topics-changed', update); }, [app]);
  return topics;
}
export function WorkbenchTopicMembership({ paper, topics, legacy, editLegacy }) {
  const linked = topics.filter(t => t.paperIds.includes(paper.file.path));
  return <div className="rw-organization-field rw-workbench-topic-field"><span>科研课题</span><div className="rw-workbench-topic-links">{linked.map(t => <button key={t.id} onClick={() => postTopic({ type: 'research-topic-open', id: t.id })}>{t.title}<ArrowUpRight size={12} /></button>)}<button aria-label="关联科研课题" onClick={() => postTopic({ type: 'research-topic-membership', paperId: paper.file.path })}>{linked.length ? <Plus size={14} /> : <>关联课题<Plus size={12} /></>}</button></div>{legacy.length > 0 && <button className="rw-workbench-topic-legacy" onClick={editLegacy}>{legacy.join('、')}</button>}</div>;
}
