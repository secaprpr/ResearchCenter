import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';
import { Modal } from './obsidian.js';
import { topicTone } from './paper-badges.js';
import { parseTags, tagKey } from './paper-tags.js';
import './paper-tags.css';

export function PaperTags({ paper, disabled, edit, remove }) {
  const tags = parseTags(paper.keywords);
  return <div className="rw-detail-section rw-paper-tags"><div className="rw-section-heading"><h3>标签</h3><button className="rw-icon-button" aria-label="添加标签" title="添加标签" disabled={disabled} onClick={edit}><Plus size={16} /></button></div>
    <div className="rw-editable-tags">{tags.map(tag => <span className={`rw-paper-badge rw-editable-tag tone-${topicTone(tag)}`} key={tagKey(tag)}><span title={tag}>{tag}</span><button type="button" aria-label={`移除标签：${tag}`} title={`移除标签：${tag}`} disabled={disabled} onClick={() => remove(tag)}><X size={12} /></button></span>)}{!tags.length && <span className="rw-missing">—</span>}</div>
  </div>;
}

export function TagEditor({ app, papers, suggestions, save, close }) {
  const [modal] = useState(() => new Modal(app));
  const [initial] = useState(() => {
    const values = new Map();
    for (const paper of papers) for (const tag of parseTags(paper.keywords)) {
      const key = tagKey(tag), previous = values.get(key); values.set(key, { label: previous?.label || tag, count: (previous?.count || 0) + 1 });
    }
    return values;
  });
  const [added, setAdded] = useState(new Map()), [removed, setRemoved] = useState(new Set());
  const [input, setInput] = useState(''), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const inputRef = useRef(null), savingRef = useRef(false), closeRef = useRef(close); closeRef.current = close;
  useLayoutEffect(() => {
    const previous = document.activeElement;
    modal.setTitle(papers.length > 1 ? `标签 · ${papers.length} 篇文献` : '编辑标签');
    modal.modalEl.classList.add('rw-tags-modal'); modal.modalEl.setAttribute('role', 'dialog'); modal.modalEl.setAttribute('aria-modal', 'true');
    modal.onClose = () => { if (!savingRef.current) closeRef.current(); };
    modal.keyHandler = () => {};
    const keyboard = event => {
      if (event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!savingRef.current) closeRef.current(); }
      if (event.key !== 'Tab') return;
      const controls = [...modal.modalEl.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyboard, true);
    modal.open();
    modal.containerEl.onmousedown = event => { if (event.target === modal.containerEl && !savingRef.current) closeRef.current(); };
    modal.modalEl.querySelector('.modal-close-button').onclick = () => { if (!savingRef.current) closeRef.current(); };
    inputRef.current?.focus();
    return () => { document.removeEventListener('keydown', keyboard, true); modal.onClose = undefined; modal.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [modal, papers.length]);

  const visible = new Map([...initial].filter(([key]) => !removed.has(key)));
  for (const [key, label] of added) visible.set(key, { label, count: papers.length });
  const add = value => {
    const tags = parseTags(value); if (!tags.length) return;
    setAdded(previous => new Map([...previous, ...tags.map(tag => [tagKey(tag), initial.get(tagKey(tag))?.label || tag])]));
    setRemoved(previous => new Set([...previous].filter(key => !tags.some(tag => tagKey(tag) === key))));
    setInput(''); inputRef.current?.focus();
  };
  const remove = key => { setAdded(previous => { const next = new Map(previous); next.delete(key); return next; }); setRemoved(previous => new Set([...previous, key])); };
  const needle = tagKey(input.split(/[,，;；\n]/).at(-1));
  const options = parseTags(suggestions).filter(tag => !visible.has(tagKey(tag)) && tagKey(tag).includes(needle)).slice(0, 8);
  const submit = async event => {
    event.preventDefault(); if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setError('');
    try { await save({ add: [...added.values(), ...parseTags(input)], remove: [...removed] }); close(); }
    catch (failure) { setError(failure.message || String(failure)); }
    finally { savingRef.current = false; setSaving(false); }
  };
  return createPortal(<form className="rw-tag-editor" onSubmit={submit}>
    <div className="rw-tag-input-row"><input ref={inputRef} aria-label="标签名称" placeholder="输入标签…" value={input} disabled={saving} onChange={event => setInput(event.target.value)} onPaste={event => {
      const text = event.clipboardData.getData('text'); if (parseTags(text).length > 1) { event.preventDefault(); add(input + text); }
    }} onKeyDown={event => { if (!event.nativeEvent.isComposing && ['Enter', ',', '，', ';', '；'].includes(event.key)) { event.preventDefault(); add(input); } }} /><button className="rw-secondary" type="button" disabled={saving || !input.trim()} onClick={() => add(input)}><Plus size={14} />添加</button></div>
    <div className="rw-editable-tags rw-tag-editor-values" aria-label="当前标签">{[...visible].map(([key, { label, count }]) => <span className={`rw-paper-badge rw-editable-tag tone-${topicTone(label)}`} key={key}><button type="button" className="rw-tag-apply" disabled={saving} aria-label={`应用标签：${label}`} title={papers.length > 1 ? '应用到所选全部文献' : label} onClick={() => add(label)}><span>{label}</span>{papers.length > 1 && <small>{count}/{papers.length}</small>}</button><button type="button" disabled={saving} title={`移除标签：${label}`} aria-label={`移除标签：${label}`} onClick={() => remove(key)}><X size={12} /></button></span>)}</div>
    {options.length > 0 && <div className="rw-tag-suggestions" aria-label="已有标签"><span>已有标签</span><div>{options.map(tag => <button type="button" key={tagKey(tag)} className={`rw-paper-badge tone-${topicTone(tag)}`} disabled={saving} onClick={() => add(tag)}><Plus size={12} />{tag}</button>)}</div></div>}
    {error && <p role="alert" className="rw-tags-error">{error}</p>}
    <div className="rw-edit-actions"><button type="button" className="rw-secondary" disabled={saving} onClick={close}>取消</button><button type="submit" className="rw-primary" disabled={saving}>{saving ? '正在保存…' : '保存标签'}</button></div>
  </form>, modal.contentEl);
}
