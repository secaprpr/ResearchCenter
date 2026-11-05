import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Palette, Check, Copy, X } from 'lucide-react';
import { NOTE_CALLOUTS, NOTE_TONES, toneFor, calloutMarkdown, inlineStyleHTML, parseCalloutExample } from './note-markup.js';
import './note-styles.css';

export function noteSelection(editor) {
  const root = editor.vditor.wysiwyg.element, selection = window.getSelection();
  let range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  if (!range || !root.contains(range.commonAncestorContainer)) { range = document.createRange(); range.selectNodeContents(root); range.collapse(false); }
  const ancestor = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  const inline = ancestor.closest('[data-rw-note-style]');
  const callout = ancestor.closest('blockquote.callout');
  const code = ancestor.closest('.vditor-wysiwyg__block[data-type="code-block"]');
  const codeCallout = code && code.contains(range.endContainer) ? parseCalloutExample(code.querySelector('pre code')?.textContent || '') : null;
  const existing = inline && inline.contains(range.endContainer) ? inline : callout && callout.contains(range.endContainer) ? callout : codeCallout ? code : null;
  if (existing) range.selectNode(existing);
  const fragment = document.createElement('div'); fragment.append(range.cloneContents());
  const markdown = editor.vditor.lute.VditorDOM2Md(fragment.innerHTML).trim();
  const inlineMarkdown = inline && existing === inline ? editor.vditor.lute.VditorDOM2Md(inline.innerHTML).trim() : markdown;
  return { range, markdown, inlineMarkdown, text: range.toString(), existing, codeCallout, inline: existing === inline ? inline : null, callout: existing === callout ? callout : null, multipleBlocks: fragment.querySelectorAll('p, h1, h2, h3, h4, li').length > 1 };
}

function StylePopover({ editor, anchor, selection, close, changed }) {
  const currentType = selection.codeCallout?.type || selection.callout?.getAttribute('data-subtype')?.toLowerCase() || '';
  const match = NOTE_CALLOUTS.find(item => currentType === item.type || currentType.startsWith(item.type + '-'));
  const [tab, setTab] = useState(selection.inline ? 'inline' : 'block');
  const [preset, setPreset] = useState(match?.type || 'important');
  const [variant, setVariant] = useState(currentType.endsWith('-outline') ? 'outline' : currentType.endsWith('-soft') ? 'soft' : 'line');
  const initialTitle = selection.callout?.querySelector('.callout-info')?.cloneNode(true);
  initialTitle?.querySelector('.vditor-wysiwyg__callout-marker')?.remove();
  const [title, setTitle] = useState(selection.codeCallout?.title || initialTitle?.textContent?.trim() || match?.label || '重点');
  const [body, setBody] = useState(selection.codeCallout ? selection.codeCallout.body : selection.callout ? selection.markdown.split('\n').slice(1).map(line => line.replace(/^> ?/, '')).join('\n').trim() : selection.markdown);
  const [text, setText] = useState(selection.inline?.textContent || selection.text || '');
  const [mode, setMode] = useState(selection.inline?.style.border ? 'outline' : selection.inline?.style.textDecorationLine ? 'underline' : selection.inline?.style.backgroundColor ? 'highlight' : selection.inline ? 'text' : 'highlight');
  const toHex = (value, fallback) => { if (!value) return fallback; const values = value.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/); return values ? '#' + values.slice(1).map(n => Number(n).toString(16).padStart(2, '0')).join('') : /^#[\da-f]{6}$/i.test(value) ? value : fallback; };
  const [tone, setTone] = useState(selection.inline ? NOTE_TONES.find(item => item.ink === toHex(selection.inline.style.color, ''))?.id || '' : 'amber');
  const [ink, setInk] = useState(toHex(selection.inline?.style.color, NOTE_TONES[0].ink));
  const [fill, setFill] = useState(toHex(selection.inline?.style.backgroundColor, NOTE_TONES[0].fill));
  const [radius, setRadius] = useState(Number.isFinite(parseFloat(selection.inline?.style.borderRadius)) ? parseFloat(selection.inline.style.borderRadius) : 4);
  const [error, setError] = useState(''), [copied, setCopied] = useState(false), [position, setPosition] = useState({ left: 8, top: 60, height: 600 });
  const popup = useRef(null);
  useEffect(() => {
    const place = () => {
      const rect = anchor.getBoundingClientRect(), width = Math.min(376, innerWidth - 16);
      const top = rect.bottom + 8 < innerHeight - 260 ? rect.bottom + 8 : Math.max(8, rect.top - Math.min(600, innerHeight - 16));
      setPosition({ left: Math.max(8, Math.min(rect.left, innerWidth - width - 8)), top, height: innerHeight - top - 8 });
    };
    place(); window.addEventListener('resize', place);
    const outside = event => { if (!popup.current?.contains(event.target) && !anchor.contains(event.target)) close(); };
    document.addEventListener('pointerdown', outside);
    requestAnimationFrame(() => popup.current?.querySelector('[role=tab][aria-selected=true]')?.focus());
    return () => { window.removeEventListener('resize', place); document.removeEventListener('pointerdown', outside); };
  }, [anchor, close]);
  const picked = NOTE_CALLOUTS.find(item => item.type === preset), color = toneFor(picked.tone);
  const snippet = tab === 'block' ? calloutMarkdown(preset, variant, title || picked.label, body) : inlineStyleHTML(text, { mode, ink, fill, radius }, text === (selection.inline?.textContent || selection.text) ? selection.inlineMarkdown : undefined);
  const restore = (range = selection.range) => {
    const root = editor.vditor.wysiwyg.element;
    editor.focus();
    if (!root.contains(range.commonAncestorContainer)) { range = document.createRange(); range.selectNodeContents(root); range.collapse(false); }
    const target = window.getSelection(); target.removeAllRanges(); target.addRange(range);
  };
  const currentExisting = () => {
    const root = editor.vditor.wysiwyg.element;
    if (!selection.existing) return null;
    if (root.contains(selection.existing)) return selection.existing;
    return [...root.querySelectorAll(selection.callout ? 'blockquote.callout' : selection.codeCallout ? '.vditor-wysiwyg__block[data-type="code-block"]' : '[data-rw-note-style]')].find(node => editor.vditor.lute.VditorDOM2Md(node.outerHTML).trim() === selection.markdown);
  };
  const replace = markdown => {
    const node = currentExisting();
    if (selection.existing && !node) { setError('原内容已更新，请重新选择后应用。'); return false; }
    if (node?.matches('blockquote.callout') || (node && selection.codeCallout)) {
      // Block insertion follows a paragraph in Vditor. Keep an anchor at the
      // original location instead of letting a root-level range append a copy.
      const placeholder = document.createElement('p'); placeholder.dataset.block = '0'; placeholder.append(document.createElement('br'));
      node.replaceWith(placeholder);
      const range = document.createRange(); range.selectNodeContents(placeholder); range.collapse(true); restore(range);
      editor.insertMD(markdown); placeholder.remove();
    } else if (node) {
      const range = document.createRange(); range.selectNode(node); restore(range); editor.insertMD(markdown);
    } else { restore(); editor.insertMD(markdown); }
    changed(); close(); return true;
  };
  const apply = () => {
    if (tab === 'inline' && selection.multipleBlocks && !selection.existing) { setError('行内标记需要选择同一段落中的文字。'); return; }
    replace(tab === 'block' ? '\n\n' + snippet + '\n\n' : snippet);
  };
  const remove = () => {
    const node = currentExisting(); if (!node) { setError('原内容已更新，请重新选择后应用。'); return; }
    const content = document.createElement('div');
    for (const child of node.childNodes) if (!(child.nodeType === 1 && child.classList.contains('callout-info'))) content.append(child.cloneNode(true));
    if (selection.callout && !content.textContent.trim()) {
      const title = node.querySelector('.callout-info')?.cloneNode(true); title?.querySelector('.vditor-wysiwyg__callout-marker')?.remove();
      if (title) content.append(title);
    }
    const markdown = editor.vditor.lute.VditorDOM2Md(content.innerHTML);
    replace(markdown);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(snippet); setCopied(true); } catch { setError('复制失败'); } };
  return createPortal(<section ref={popup} className="rw-note-style-popover" role="dialog" aria-label="特殊标记" style={{ left: position.left, top: position.top, maxHeight: position.height }} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); anchor.focus(); }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && (tab === 'block' ? body.trim() : text.trim())) { event.preventDefault(); apply(); }
    if (event.key === 'Tab') {
      const nodes = [...popup.current.querySelectorAll('button:not([disabled]), input, select, textarea')].filter(el => el.getClientRects().length), first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }}>
    <header className="rw-note-style-header"><h3>特殊标记</h3><button className="rw-icon-button" aria-label="关闭特殊标记" onClick={close}><X size={16} /></button></header>
    <div className="rw-note-style-tabs" role="tablist" aria-label="标记类型">{[['block', '标注块'], ['inline', '文字样式']].map(([id, label]) => <button key={id} role="tab" disabled={Boolean(selection.codeCallout) && id === 'inline'} aria-selected={tab === id} onClick={() => { setTab(id); setError(''); }}>{label}</button>)}</div>
    <div className="rw-note-style-body">
      {tab === 'block' ? <>
        <div className="rw-callout-presets" role="group" aria-label="标注块类型">{NOTE_CALLOUTS.map(item => <button key={item.type} aria-pressed={preset === item.type} style={{ '--note-tone': toneFor(item.tone).line, '--note-fill': toneFor(item.tone).fill }} onClick={() => { setPreset(item.type); if (!title || NOTE_CALLOUTS.some(row => row.label === title)) setTitle(item.label); }}><span />{item.label}{preset === item.type && <Check size={13} />}</button>)}</div>
        <div className="rw-note-style-options" role="group" aria-label="标注块外观">{[['line', '侧线'], ['outline', '描边'], ['soft', '淡底']].map(([id, label]) => <button key={id} aria-pressed={variant === id} onClick={() => setVariant(id)}>{label}</button>)}</div>
        <label className="rw-note-style-field">标题<input aria-label="标注块标题" value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label className="rw-note-style-field">正文<textarea aria-label="标注块正文" value={body} onChange={event => setBody(event.target.value)} /></label>
        <div className={`rw-note-callout-preview callout-${preset} variant-${variant}`} style={{ '--note-tone': color.line, '--note-fill': color.fill, '--note-ink': color.ink }} aria-label="标注块预览"><strong>{title || picked.label}</strong>{body && <p>{body}</p>}</div>
      </> : <>
        <div className="rw-note-style-options" role="group" aria-label="文字样式">{[['highlight', '底色'], ['text', '文字'], ['outline', '描边'], ['underline', '下划线']].map(([id, label]) => <button key={id} aria-pressed={mode === id} onClick={() => setMode(id)}>{label}</button>)}</div>
        <div className="rw-note-tone-picker" role="group" aria-label="标记配色">{NOTE_TONES.map(item => <button key={item.id} aria-label={item.name} title={item.name} aria-pressed={tone === item.id} style={{ background: item.fill, color: item.ink, borderColor: item.line }} onClick={() => { setTone(item.id); setInk(item.ink); setFill(item.fill); }}>{tone === item.id && <Check size={14} />}</button>)}</div>
        <label className="rw-note-style-field">文字<input aria-label="标记文字" value={text} onChange={event => setText(event.target.value)} /></label>
        <div className="rw-note-custom-colors"><label><span>文字颜色</span><input type="color" aria-label="文字颜色" value={/^#[\da-f]{6}$/i.test(ink) ? ink : toneFor(tone).ink} onChange={event => { setInk(event.target.value); setTone(''); }} /><input aria-label="文字色值" value={ink} maxLength={7} onChange={event => { setInk(event.target.value); setTone(''); }} onBlur={() => { if (!/^#[\da-f]{6}$/i.test(ink)) setInk(toneFor(tone).ink); }} /></label><label><span>背景颜色</span><input type="color" aria-label="背景颜色" disabled={mode !== 'highlight'} value={/^#[\da-f]{6}$/i.test(fill) ? fill : toneFor(tone).fill} onChange={event => { setFill(event.target.value); setTone(''); }} /><input aria-label="背景色值" disabled={mode !== 'highlight'} value={fill} maxLength={7} onChange={event => { setFill(event.target.value); setTone(''); }} onBlur={() => { if (!/^#[\da-f]{6}$/i.test(fill)) setFill(toneFor(tone).fill); }} /></label></div>
        {['highlight', 'outline'].includes(mode) && <label className="rw-note-style-field rw-note-radius">圆角<select aria-label="标记圆角" value={radius} onChange={event => setRadius(Number(event.target.value))}>{[0, 3, 4, 6, 10].map(value => <option key={value} value={value}>{value} px</option>)}</select></label>}
        <div className="rw-note-inline-preview" aria-label="文字样式预览"><span>研究笔记中的 </span><span style={{ color: ink, backgroundColor: mode === 'highlight' ? fill : undefined, border: mode === 'outline' ? `1px solid ${ink}` : undefined, padding: mode === 'text' || mode === 'underline' ? undefined : '.08em .3em', borderRadius: radius, textDecorationLine: mode === 'underline' ? 'underline' : undefined, textDecorationColor: ink, textDecorationThickness: '2px', textUnderlineOffset: '3px' }}>{text || '关键内容'}</span></div>
      </>}
      {error && <p className="rw-note-style-error" role="alert">{error}</p>}
    </div>
    <footer className="rw-note-style-footer"><button className="rw-icon-button" aria-label="复制标记语法" title="复制标记语法" onClick={() => void copy()}>{copied ? <Check size={16} /> : <Copy size={16} />}</button>{selection.existing && !selection.codeCallout && <button className="rw-text-button" onClick={remove}>移除标记</button>}<div /><button className="rw-secondary" onClick={close}>取消</button><button className="rw-primary" disabled={tab === 'block' ? !body.trim() && !title.trim() : !text.trim() || !/^#[\da-f]{6}$/i.test(ink) || !/^#[\da-f]{6}$/i.test(fill)} onClick={apply}>{selection.codeCallout ? '转为标注块' : '应用标记'}</button></footer>
  </section>, document.body);
}

export function NoteStyleButton({ editor, changed, disabled }) {
  const button = useRef(null), selected = useRef(null);
  const [open, setOpen] = useState(false);
  const close = React.useCallback(() => { setOpen(false); selected.current = null; }, []);
  return <><button ref={button} className="rw-icon-button" aria-label="特殊标记" title="特殊标记" disabled={disabled} aria-expanded={open} onMouseDown={event => { if (editor) selected.current = noteSelection(editor); event.preventDefault(); }} onClick={() => { if (open) close(); else { selected.current = selected.current || noteSelection(editor); setOpen(true); } }}><Palette size={16} /></button>{open && <StylePopover editor={editor} anchor={button.current} selection={selected.current} close={close} changed={changed} />}</>;
}
