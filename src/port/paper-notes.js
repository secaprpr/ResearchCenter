import { markdownBody, saveMarkdownBody } from './vault.js';

// One session per paper, shared by the detail editor, writing window and PDF pane.
export function createPaperNotes(vault, storage = globalThis.localStorage) {
  const sessions = new Map(), listeners = new Set();
  const notify = session => { for (const listener of listeners) listener(session); };
  const key = file => 'research-note-draft:' + file.path;
  const sessionFor = file => {
    if (sessions.has(file.path)) return sessions.get(file.path);
    const base = markdownBody(vault.texts.get(file.path) || '');
    const session = { file, text: base, base, status: 'saved', error: '', timer: null, pending: null, editors: new Set() };
    try {
      const draft = JSON.parse(storage.getItem(key(file)) || 'null');
      if (draft && typeof draft.text === 'string' && draft.text !== base) {
        session.text = draft.text; session.base = draft.base; session.status = draft.base === base ? 'dirty' : 'error';
        if (session.status === 'error') session.error = '文件正文已有更新，恢复的草稿已保留。';
      }
    } catch { /* Storage may be disabled; disk writes remain available. */ }
    sessions.set(file.path, session);
    return session;
  };
  const remember = session => {
    try { storage.setItem(key(session.file), JSON.stringify({ text: session.text, base: session.base })); }
    catch { /* A failed disk write is surfaced below; do not prevent editing. */ }
  };
  const flush = async file => {
    const session = sessionFor(file);
    for (const editor of session.editors) editor.capture();
    clearTimeout(session.timer);
    if (session.pending) { await session.pending; if (session.text !== session.base) return flush(file); return; }
    if (session.text === session.base) return;
    const text = session.text, base = session.base;
    session.status = 'saving'; session.error = ''; notify(session);
    session.pending = saveMarkdownBody(vault, file, text, base).then(() => {
      session.base = text; session.status = session.text === text ? 'saved' : 'dirty';
      if (session.status === 'saved') { try { storage.removeItem(key(file)); } catch {} }
      else remember(session);
    }).catch(error => { session.status = 'error'; session.error = error.message; remember(session); throw error; })
      .finally(() => { session.pending = null; notify(session); });
    await session.pending;
    if (session.text !== session.base) return flush(file);
  };
  const manager = {
    session: sessionFor,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    registerEditor(file, capture, hasPending = () => false) { const editors = sessionFor(file).editors, editor = { capture, hasPending }; editors.add(editor); return () => editors.delete(editor); },
    update(file, text, origin) {
      const session = sessionFor(file); if (text === session.text) return;
      session.text = text; session.origin = origin; session.error = ''; session.status = text === session.base ? 'saved' : 'dirty';
      remember(session); clearTimeout(session.timer); notify(session);
      session.timer = setTimeout(() => { void flush(file).catch(() => {}); }, 600);
    },
    flush,
    captureAll() { for (const session of sessions.values()) for (const editor of session.editors) editor.capture(); },
    hasUnsaved() { return [...sessions.values()].some(session => session.text !== session.base || [...session.editors].some(editor => editor.hasPending())); },
    async flushAll() { await Promise.all([...sessions.values()].map(session => flush(session.file))); },
  };
  vault.on('modify', file => {
    const session = sessions.get(file.path); if (!session || session.pending) return;
    const body = markdownBody(vault.texts.get(file.path) || '');
    if (session.text === session.base && body !== session.base) { session.text = session.base = body; session.origin = null; notify(session); }
  });
  return manager;
}
