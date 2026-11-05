import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { useLibraryStore } from '../library/store';
import { receiveTopicMessage, sendTopicIndex, topicIndex, setPaperMembership, useTopicLibrary } from '../topic-library';
import { topicData } from '../topics';
import { Modal } from './Modal';

export function PortLibraryView() {
  const frame = useRef<HTMLIFrameElement>(null);
  const setView = useStore(state => state.setView);
  const [membership, setMembership] = useState<string | null>(null);
  const topicError = useTopicLibrary(state => state.error);
  const records = useStore(state => state.records), types = useStore(state => state.types);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      if (window.location.protocol !== 'file:' && event.origin !== window.location.origin) return;
      if (receiveTopicMessage(event)) return;
      if (event.data?.type === 'research-topic-membership' && typeof event.data.paperId === 'string') setMembership(event.data.paperId);
      if (event.data?.type === 'research-port-count' && Number.isSafeInteger(event.data.count) && event.data.count >= 0) useLibraryStore.setState({ portedCount: event.data.count });
    };
    window.addEventListener('message', receive);
    let previous = JSON.stringify(topicIndex());
    const unsubscribe = useStore.subscribe(() => { const next = JSON.stringify(topicIndex()); if (next !== previous) { previous = next; sendTopicIndex(); } });
    return () => { window.removeEventListener('message', receive); unsubscribe(); };
  }, []);
  return <div className="port-library-shell">
    <iframe ref={frame} src="./port.html" title="Research Library 与 MuPDF 工作台" allow="clipboard-read; clipboard-write" onLoad={sendTopicIndex} />
    <div className="port-library-footer"><button type="button" onClick={() => setView('library-basic')}>基础库</button></div>
    {topicError && <Modal title="无法打开文件" onClose={() => useTopicLibrary.setState({ error: '' })} footer={<button className="btn btn-primary" onClick={() => useTopicLibrary.setState({ error: '' })}>关闭</button>}><div role="alert">{topicError}</div></Modal>}
    {membership && <Modal title="关联科研课题" onClose={() => setMembership(null)} footer={<button className="btn btn-primary" onClick={() => setMembership(null)}>完成</button>}><div className="topic-memberships">{records.filter(r => !r.archived && types.some(t => t.id === r.typeId && t.kind === 'project')).map(r => <label key={r.id}><input type="checkbox" checked={topicData(r).papers.some(p => p.paperId === membership)} onChange={e => setPaperMembership(r.id, membership, e.target.checked)} />{r.title}</label>)}</div></Modal>}
  </div>;
}
