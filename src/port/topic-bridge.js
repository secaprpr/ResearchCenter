import { frontmatter } from './vault.js';
import { formatVenue } from './venue-display.js';

const post = message => window.parent.postMessage(message, location.protocol === 'file:' ? '*' : location.origin);
export function publishTopicPapers(vault, library) {
  if (!library) return;
  const prefix = library.settings.papersFolder.replace(/\/$/, '') + '/';
  const papers = vault.getMarkdownFiles().filter(file => file.path.startsWith(prefix)).flatMap(file => {
    const fm = frontmatter(vault.texts.get(file.path) || ''); if (String(fm.type).toLowerCase() !== 'paper') return [];
    return [{ id: file.path, title: String(fm.title || file.basename), authors: Array.isArray(fm.authors) ? fm.authors.map(String) : fm.authors ? [String(fm.authors)] : [], venue: formatVenue(fm.venue), year: String(fm.year || ''), pdf: typeof fm.pdf === 'string' ? fm.pdf : '', status: String(fm.status || 'inbox') }];
  }); post({ type: 'research-topic-catalog', papers });
}
export function installTopicBridge({ app, vault, library, reader }) {
  let ready = true;
  const receive = async event => {
    if (event.source !== window.parent || (location.protocol !== 'file:' && event.origin !== location.origin)) return;
    const message = event.data;
    if (message?.type === 'research-topic-index' && Array.isArray(message.topics)) {
      app.workbenchTopics = message.topics.filter(t => t && typeof t.id === 'string' && typeof t.title === 'string' && Array.isArray(t.paperIds) && t.paperIds.every(p => typeof p === 'string'));
      window.dispatchEvent(new Event('workbench-topics-changed')); return;
    }
    if (message?.type !== 'research-topic-command' || typeof message.id !== 'string') return;
    let value;
    try {
      const payload = message.payload || {};
      if (message.action === 'open-paper') {
        const paper = library.currentModal?.papers.find(p => p.file.path === payload.path); if (!paper) throw new Error('文献已移除或尚未载入');
        if (payload.pdf) {
          const pdf = app.metadataCache.getFirstLinkpathDest(paper.pdf, paper.file.path); if (!pdf) throw new Error('PDF 文件已缺失');
          app.workspace.readingPaperPath = paper.file.path; await reader.openPdf(pdf, false);
        } else { if (await app.workspace.back() === false) throw new Error('当前笔记尚未保存，请保存后重试'); window.dispatchEvent(new CustomEvent('workbench-open-topic-paper', { detail: { path: paper.file.path } })); }
        value = true;
      } else if (message.action === 'import-asset') {
        if (!(payload.file instanceof File) || payload.file.size > 50 * 1024 * 1024 || !/^[a-z0-9-]+$/i.test(payload.topicId || '')) throw new Error('文件无效或超过 50 MB');
        const file = payload.file, name = file.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(-150) || 'file';
        const path = `Research/Topic Assets/${payload.topicId}/${crypto.randomUUID()}/${name}`;
        await vault.createBinary(path, await file.arrayBuffer()); value = { path, filename: file.name, size: file.size };
      } else if (message.action === 'read-asset' || message.action === 'open-asset') {
        if (typeof payload.path !== 'string' || !payload.path.startsWith('Research/Topic Assets/') || payload.path.split('/').includes('..')) throw new Error('无效的课题文件');
        const file = vault.getAbstractFileByPath(payload.path); if (!file) throw new Error('文件已缺失');
        if (message.action === 'open-asset') { if (file.extension !== 'pdf') throw new Error('此文件请使用下载打开'); app.workspace.readingPaperPath = ''; await reader.openPdf(file, false); value = true; }
        else value = { bytes: new Uint8Array(await vault.readBinary(file)), filename: file.name };
      } else throw new Error('不支持的课题操作');
      if (ready) post({ type: 'research-topic-result', id: message.id, value });
    } catch (error) { post({ type: 'research-topic-result', id: message.id, error: error.message }); }
  };
  window.addEventListener('message', receive); publishTopicPapers(vault, library);
  return () => { ready = false; window.removeEventListener('message', receive); };
}
