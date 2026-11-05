import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Notice } from './obsidian.js';
import { frontmatter, processFrontMatter } from './vault.js';
import { parseRemark } from './remark-markup.js';

// A second editor can be opened while the first one's blur save is in flight.
// Seed it from that write, rather than the still-stale paper model.
const remarkWrites = new WeakMap();

export function PaperRemark({ paper, vault, onSaved, disabled, detail = false }) {
  const value = String(paper.note || '');
  const parts = useMemo(() => parseRemark(value), [value]);
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(value), [saving, setSaving] = useState(false);
  const input = useRef(null), trigger = useRef(null), active = useRef(false), pending = useRef(false), initial = useRef(value);
  useLayoutEffect(() => { if (editing) { input.current?.focus(); input.current?.select(); } }, [editing]);
  const finish = () => { const focused = document.activeElement === input.current; active.current = false; setEditing(false); if (focused) requestAnimationFrame(() => trigger.current?.focus()); };
  const save = async () => {
    if (!active.current || pending.current) return;
    if (draft === initial.current) { finish(); return; }
    pending.current = true; setSaving(true);
    if (!remarkWrites.has(vault)) remarkWrites.set(vault, new Map());
    const writes = remarkWrites.get(vault), write = { value: draft };
    writes.set(paper.file.path, write);
    try {
      // Share the existing frontmatter/body queue with research notes and
      // metadata, so editing a short remark cannot overwrite either of them.
      await processFrontMatter(vault, paper.file, fm => { fm.note = draft; });
      await onSaved(); finish();
    } catch (error) { new Notice('备注保存失败：' + error.message); }
    finally { if (writes.get(paper.file.path) === write) writes.delete(paper.file.path); pending.current = false; setSaving(false); }
  };
  if (editing) return <textarea ref={input} className={`rw-remark-input${detail ? ' rw-detail-remark-input' : ''}`} rows={detail ? 3 : 1} aria-label={`${detail ? '详情备注' : '备注'}：${paper.title}`} aria-busy={saving} readOnly={saving} value={draft}
    onChange={event => setDraft(event.target.value)} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onBlur={() => void save()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape' && !pending.current) { event.preventDefault(); finish(); }
      else if ((event.key === 'Enter' && (detail ? event.ctrlKey || event.metaKey : !event.shiftKey)) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's')) { event.preventDefault(); void save(); }
    }} />;
  return <button ref={trigger} type="button" className={`rw-remark${detail ? ' rw-detail-remark-value' : ''} ${value ? '' : 'is-empty'}`} aria-label={`编辑${detail ? '详情' : ''}备注：${paper.title}`} title={value ? parts.map(part => part.text).join('') : '备注'} disabled={disabled}
    onClick={event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.stopPropagation();
      const latest = remarkWrites.get(vault)?.get(paper.file.path)?.value ?? (vault.texts.has(paper.file.path) ? String(frontmatter(vault.texts.get(paper.file.path)).note || '') : value);
      active.current = true; initial.current = latest; setDraft(latest); setEditing(true);
    }}
    onDoubleClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>{value ? parts.map((part, index) => part.kind === 'pill' ? <span key={index} className="rw-remark-pill" style={{ '--remark-ink': part.ink, '--remark-fill': part.fill, '--remark-border': part.border }}><span>{part.text}</span></span> : <React.Fragment key={index}>{part.text}</React.Fragment>) : detail ? '添加备注' : '—'}</button>;
}
