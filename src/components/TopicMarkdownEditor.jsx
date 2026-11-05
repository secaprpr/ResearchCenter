import React, { useEffect, useMemo, useRef } from 'react';
import { ResearchNotes } from '../port/ResearchNotes.jsx';
import { createPaperNotes } from '../port/paper-notes.js';
import { registerTopicEditor } from '../topic-editor-sessions';
import '../port/ui-primitives.css';

// Reuse the same WYSIWYG editor and adapters as paper notes. The backing store
// here is a topic's Markdown field, never a paper file or PDF annotation.
export function TopicMarkdownEditor({ id, value, onChange }) {
  const changed = useRef(onChange); changed.current = onChange;
  const state = useMemo(() => {
    const file = { path: `workbench-topics/${id}.md`, basename: id }, texts = new Map([[file.path, value]]), listeners = new Set();
    const vault = { texts, read: async () => texts.get(file.path) || '', modify: async (_file, text) => { texts.set(file.path, text); for (const listener of listeners) listener(file); }, on: (_name, fn) => { listeners.add(fn); return { off: () => listeners.delete(fn) }; } };
    const paperNotes = createPaperNotes(vault);
    return { file, texts, app: { paperNotes } };
  }, [id]);
  useEffect(() => {
    const session = state.app.paperNotes.session(state.file);
    if (value !== session.text && session.status === 'saved') state.app.paperNotes.update(state.file, value);
  }, [state, value]);
  useEffect(() => {
    const unsubscribe = state.app.paperNotes.subscribe(session => { if (session.text !== state.texts.get(state.file.path)) changed.current(session.text); });
    const capture = () => state.app.paperNotes.captureAll();
    const unregister = registerTopicEditor(capture);
    window.addEventListener('beforeunload', capture);
    return () => { capture(); unregister(); void state.app.paperNotes.flushAll().finally(unsubscribe); window.removeEventListener('beforeunload', capture); };
  }, [state]);
  return <ResearchNotes app={state.app} file={state.file} title="课题笔记" expand={false} />;
}
