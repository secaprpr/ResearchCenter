import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import Vditor from 'vditor';
import { Bold, Italic, Strikethrough, Heading, List, ListOrdered, ListTodo, Quote, Code, SquareCode, Link, Table, Undo2, Redo2, Sigma, CodeXml, Download, Upload, Maximize2, Check, CloudUpload, AlertCircle, X, Link2, ArrowDownUp } from 'lucide-react';
import { Modal, Notice } from './obsidian.js';
import { createPaperNotes } from './paper-notes.js';
import { installNoteMarkup } from './note-markup.js';
import { installNoteImages } from './note-images.js';
import { installNoteMath } from './note-math.js';
import { NoteStyleButton } from './NoteStyles.jsx';
import { createNotePdfLinks } from './note-pdf-links.js';
import { installNoteCommands, commitNoteHistory } from './note-commands.js';
import './note-commands.css';
import 'vditor/dist/index.css';
import './research-notes.css';

const icons = { headings: Heading, bold: Bold, italic: Italic, strike: Strikethrough, list: List, 'ordered-list': ListOrdered, check: ListTodo, quote: Quote, 'inline-code': Code, code: SquareCode, link: Link, table: Table, undo: Undo2, redo: Redo2 };
const icon = Component => renderToStaticMarkup(<Component size={16} strokeWidth={1.7} />);
const download = (text, name) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name.replace(/[<>:"/\\|?*]/g, '-'); anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};

function compactToolbar(toolbar) {
  toolbar.classList.add('rw-note-compact-toolbar');
  toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', '研究笔记工具');
  const utilities = document.createElement('div'); utilities.className = 'rw-note-utilities'; toolbar.prepend(utilities);
  for (const button of toolbar.querySelectorAll('.vditor-toolbar__item > button')) button.title = button.getAttribute('aria-label') || '';
  const panels = [...toolbar.querySelectorAll('.vditor-toolbar__item > .vditor-hint')];
  // Fixed popovers escape the horizontal toolbar's clipping without changing
  // Vditor's ownership, selection handling or heading-menu event handlers.
  const place = () => {
    for (const panel of panels) {
      if (panel.style.display !== 'block') continue;
      const anchor = panel.parentElement.firstElementChild.getBoundingClientRect(), box = panel.getBoundingClientRect();
      const left = Math.max(8, Math.min(anchor.left, innerWidth - box.width - 8)) + 'px';
      const top = Math.max(8, Math.min(anchor.bottom + 6, innerHeight - box.height - 8)) + 'px';
      if (panel.style.left !== left) panel.style.left = left;
      if (panel.style.top !== top) panel.style.top = top;
    }
  };
  const hide = () => { for (const panel of panels) if (panel.style.display === 'block') panel.style.display = 'none'; };
  const outside = event => { if (!toolbar.contains(event.target)) hide(); };
  const reveal = event => {
    const button = event.target.closest('.vditor-toolbar__item > button'); if (!button) return;
    const box = button.getBoundingClientRect(), frame = toolbar.getBoundingClientRect();
    const left = frame.left + (toolbar.classList.contains('is-narrow') ? 8 : utilities.offsetWidth + 8), right = frame.right - 8;
    if (box.left < left) toolbar.scrollLeft += box.left - left;
    else if (box.right > right) toolbar.scrollLeft += box.right - right;
  };
  const observer = new MutationObserver(place); observer.observe(toolbar, { subtree: true, attributes: true, attributeFilter: ['style'] });
  const resize = new ResizeObserver(() => toolbar.classList.toggle('is-narrow', toolbar.clientWidth < Math.max(300, utilities.offsetWidth + 96))); resize.observe(toolbar);
  toolbar.addEventListener('scroll', hide); toolbar.addEventListener('focusin', reveal); window.addEventListener('resize', hide); document.addEventListener('pointerdown', outside);
  return { utilities, destroy() { observer.disconnect(); resize.disconnect(); toolbar.removeEventListener('scroll', hide); toolbar.removeEventListener('focusin', reveal); window.removeEventListener('resize', hide); document.removeEventListener('pointerdown', outside); } };
}

export function ResearchNotes({ app, file, title, expand = true }) {
  const manager = app.paperNotes, host = useRef(null), editorRef = useRef(null), importRef = useRef(null), origin = useRef(Symbol('note-editor'));
  const [version, redraw] = useState(0), [source, setSource] = useState(false), [ready, setReady] = useState(false);
  const [toolbarHost, setToolbarHost] = useState(null);
  const [following, setFollowing] = useState(app.notePdfLinks?.enabled ?? true);
  const snapshot = useRef(''), renderedText = useRef('');
  const pendingInput = useRef(false), composing = useRef(false), inputTimer = useRef(null), maxInputTimer = useRef(null);
  const session = manager.session(file);
  const cancelCapture = () => { clearTimeout(inputTimer.current); clearTimeout(maxInputTimer.current); inputTimer.current = maxInputTimer.current = null; };
  const accept = text => {
    cancelCapture(); pendingInput.current = false;
    if (text !== snapshot.current) { snapshot.current = renderedText.current = text; manager.update(file, text, origin.current); }
  };
  const capture = () => {
    const editor = editorRef.current; if (!editor) return;
    accept(editor.getValue());
  };
  const scheduleCapture = () => {
    pendingInput.current = true;
    if (composing.current) return;
    clearTimeout(inputTimer.current);
    // The editor normally supplies Markdown after its 250ms undo debounce.
    // This fallback handles edits without that callback; continuous typing
    // still records a draft at least once per second, outside the input event.
    inputTimer.current = setTimeout(capture, 350);
    if (maxInputTimer.current === null) maxInputTimer.current = setTimeout(capture, 1000);
  };
  useEffect(() => manager.subscribe(changed => { if (changed === session) redraw(value => value + 1); }), [manager, session]);
  useEffect(() => app.notePdfLinks?.subscribe(() => setFollowing(app.notePdfLinks.enabled)), [app]);
  useEffect(() => manager.registerEditor(file, capture, () => pendingInput.current), [manager, file]);
  const flush = () => manager.flush(file).catch(() => {});
  useEffect(() => {
    if (source) return;
    let live = true, initialized = false, toolbar, restoreMarkup, restoreMath, restoreImages, unlinkPdf, unlinkCommands;
    let editor;
    const initialize = () => {
    if (!live) return;
    editor = new Vditor(host.current, {
      // Install adapters before the first full document render. Passing the
      // body here also rendered it once before after(), doubling open latency.
      cdn: new URL('./note-assets', location.href).href, mode: 'wysiwyg', value: '',
      lang: 'zh_CN', cache: { enable: false }, height: '100%', minHeight: 250, undoDelay: 250,
      placeholder: '', toolbarConfig: { pin: false }, resize: { enable: false },
      toolbar: ['headings', '|', 'bold', 'italic', 'strike', '|', 'list', 'ordered-list', 'check', 'quote', '|', 'inline-code', 'code', 'link', 'table', '|', 'undo', 'redo'].map(name => icons[name] ? { name, icon: icon(icons[name]) } : name),
      preview: { delay: 180, maxWidth: 800, hljs: { enable: true, style: 'github' }, math: { engine: 'KaTeX', inlineDigit: true }, markdown: { toc: false, autoSpace: false, fixTermTypo: false, sanitize: true, callout: true, mark: true }, render: { media: { enable: false } } },
      link: { isOpen: false }, image: { isPreview: false },
      customWysiwygToolbar(type, panel) {
        // Heading IDs and block move/delete helpers are not part of the
        // workbench writing UI. Keep contextual table/link/code editors.
        panel.dataset.noteContext = type;
        const sourceLink = type === 'a' && [...panel.querySelectorAll('input')].some(input => input.value.startsWith('#rw-pdf='));
        panel.classList.toggle('rw-note-suppressed-popover', sourceLink || ['heading', 'block', 'li', 'blockquote', 'vditor-toc'].includes(type));
      },
      after() {
        if (!live) { editor.destroy(); return; }
        restoreMarkup = installNoteMarkup(editor.vditor.lute);
        restoreMath = installNoteMath(editor.vditor.lute);
        restoreImages = installNoteImages(editor.vditor.lute);
        // setValue(..., true) also seeds the first undo record. Do not clone and
        // serialise the whole document a second time with clearStack().
        editor.setValue(session.text, true);
        // Establish history before the first edit, even when typing immediately
        // after the asynchronously loaded Markdown engine becomes ready.
        initialized = true; editorRef.current = editor; snapshot.current = editor.getValue(); renderedText.current = session.text;
        const content = host.current.querySelector('.vditor-wysiwyg [contenteditable=true]');
        content?.setAttribute('aria-label', '研究笔记正文'); content?.setAttribute('role', 'textbox'); content?.setAttribute('aria-multiline', 'true');
        toolbar = compactToolbar(editor.vditor.toolbar.element); setToolbarHost(toolbar.utilities);
        unlinkPdf = app.notePdfLinks?.register(editor, file, capture);
        unlinkCommands = installNoteCommands(editor, capture);
        setReady(true);
        if (session.status === 'dirty') void flush();
      },
      input(text) { if (live && initialized && !composing.current) accept(text); },
      blur() { if (initialized) void flush(); },
    });
    };
    // React's development lifecycle can mount/clean up/mount before the async
    // Markdown engine loads. Start only the surviving effect so a late editor
    // cannot wipe the active editor's host.
    queueMicrotask(initialize);
    return () => {
      live = false;
      cancelCapture();
      // Loading Lute/i18n is asynchronous. destroy() requires a fully built
      // editor; if dismissed earlier, its after callback disposes it instead.
      if (initialized) { capture(); initialized = false; editorRef.current = null; unlinkCommands?.(); unlinkPdf?.(); toolbar?.destroy(); editor.destroy(); restoreImages?.(); restoreMath?.(); restoreMarkup?.(); }
    };
  }, [file, manager, session, source]);
  useEffect(() => {
    const editor = editorRef.current;
    if (!ready || !editor || session.origin === origin.current || renderedText.current === session.text) return;
    // Another view of the same note can stay mounted behind the writing window.
    // Coalesce its full-document redraws instead of doing one per keystroke.
    const timer = setTimeout(() => {
      if (pendingInput.current) capture();
      if (session.origin === origin.current || renderedText.current === session.text) return;
      // A second mounted view can canonicalize the same Markdown after saving.
      // Do not reset this view's undo history/caret when its body already agrees.
      if (editor.getValue() === session.text) { snapshot.current = renderedText.current = session.text; return; }
      editor.setValue(session.text, true); snapshot.current = renderedText.current = session.text;
    }, 300);
    return () => clearTimeout(timer);
  }, [version, ready, session]);
  const switchMode = () => { capture(); setToolbarHost(null); setReady(false); setSource(!source); };
  const insertMath = () => {
    const editor = editorRef.current, selection = window.getSelection();
    const selected = selection?.rangeCount && editor?.vditor.wysiwyg.element.contains(selection.getRangeAt(0).commonAncestorContainer) ? selection.getRangeAt(0).cloneRange() : null;
    const start = selected?.startContainer;
    const paragraph = (start?.nodeType === 1 ? start : start?.parentElement)?.closest('p');
    const modal = new Modal(app); modal.setTitle('数学公式');
    const input = modal.contentEl.createEl('textarea', { cls: 'rw-math-input', attr: { 'aria-label': 'LaTeX 公式', placeholder: 'LaTeX' } });
    const actions = modal.contentEl.createDiv({ cls: 'rw-note-math-actions' });
    const button = actions.createEl('button', { text: '插入公式', cls: 'rw-primary' });
    button.onclick = () => {
      if (!input.value.trim()) return;
      const value = input.value.trim().replace(/^\\\[\s*([\s\S]*?)\s*\\\]$|^\\\(\s*([\s\S]*?)\s*\\\)$|^\$\$\s*([\s\S]*?)\s*\$\$$|^\$([^$]*)\$$/, (_, ...parts) => parts.slice(0, 4).find(part => part !== undefined));
      const md = '\n\n$$\n' + value + '\n$$\n\n';
      modal.close(); editor?.focus();
      if (selected && editor.vditor.wysiwyg.element.contains(selected.commonAncestorContainer)) { const current = window.getSelection(); current.removeAllRanges(); current.addRange(selected); }
      if (editor) {
        editor.vditor.undo.addToUndoStack(editor.vditor);
        editor.insertMD(md);
        // Vditor inserts a block after the selected paragraph. Discard its
        // empty shell so a second view cannot collapse it and reset history.
        if (paragraph?.isConnected && !paragraph.textContent.replaceAll('\u200b', '').trim() && !paragraph.querySelector('img, input, [data-type=math-inline]')) paragraph.remove();
        editor.insertValue('', true);
        commitNoteHistory(editor);
      }
      capture();
    };
    modal.open(); input.focus();
  };
  const stateTitle = { saved: '已保存', saving: '正在保存', dirty: '待保存', error: '保存失败，重试' }[session.status];
  const actions = <header className="rw-note-actions" role={toolbarHost ? 'group' : 'toolbar'} aria-label={toolbarHost ? '保存与文档操作' : '研究笔记工具'}><h3>研究笔记</h3><div>
    <button className={`rw-icon-button rw-note-save state-${session.status}`} aria-label={stateTitle} title={stateTitle} onClick={() => void flush()}>{session.status === 'saved' ? <Check size={16} /> : session.status === 'error' ? <AlertCircle size={16} /> : <CloudUpload size={16} />}</button>
    <button className="rw-icon-button" aria-label="插入数学公式" title="数学公式" disabled={source || !ready} onClick={insertMath}><Sigma size={16} /></button>
    <NoteStyleButton editor={editorRef.current} changed={capture} disabled={source || !ready} />
    {app.notePdfLinks && <><button className="rw-icon-button" aria-label="笔记与论文定位" title="关联原文" disabled={source || !ready} onMouseDown={event => { app.notePdfLinks?.remember(editorRef.current); event.preventDefault(); }} onClick={event => app.notePdfLinks?.menu(editorRef.current, event)}><Link2 size={16} /></button>
    <button className="rw-icon-button" aria-label="滚动联动" title="滚动联动" aria-pressed={following} disabled={source || !ready} onClick={() => app.notePdfLinks?.setEnabled(!following)}><ArrowDownUp size={16} /></button></>}
    <button className="rw-icon-button" aria-label={source ? '所见所得编辑' : 'Markdown 源码'} title={source ? '所见所得编辑' : 'Markdown 源码'} aria-pressed={source} onClick={switchMode}><CodeXml size={16} /></button>
    <button className="rw-icon-button" aria-label="导入 Markdown" title="导入 Markdown" onClick={() => importRef.current.click()}><Upload size={16} /></button>
    <button className="rw-icon-button" aria-label="导出 Markdown" title="导出 Markdown" onClick={() => { capture(); download(session.text, (title || file.basename) + '.md'); }}><Download size={16} /></button>
    {expand && <button className="rw-icon-button" aria-label="展开研究笔记" title="展开研究笔记" onClick={() => openResearchNote(app, file, title)}><Maximize2 size={16} /></button>}
  </div></header>;
  return <section className={`rw-research-notes ${source ? 'is-source' : ''}`} aria-label="论文研究笔记" onInput={event => {
    if (event.target.closest('[contenteditable=true]')) scheduleCapture();
  }} onCompositionStart={event => { if (event.target.closest('[contenteditable=true]')) { composing.current = true; cancelCapture(); } }} onCompositionEnd={event => { if (event.target.closest('[contenteditable=true]')) { composing.current = false; scheduleCapture(); } }} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape') for (const panel of toolbarHost?.parentElement.querySelectorAll('.vditor-toolbar__item > .vditor-hint') || []) if (panel.style.display === 'block') { panel.style.display = 'none'; event.preventDefault(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void flush(); }
  }}>
    {toolbarHost ? createPortal(actions, toolbarHost) : actions}
    {session.error && <div className="rw-note-error" role="alert">{session.error}<button className="rw-text-button" onClick={() => void flush()}>重试</button></div>}
    <input type="file" ref={importRef} accept=".md,.markdown,text/markdown,text/plain" hidden onChange={async event => {
      const selected = event.target.files?.[0]; if (!selected) return;
      try { const text = await selected.text(); capture(); manager.update(file, session.text.trim() ? session.text + '\n\n---\n\n' + text : text); }
      catch (error) { new Notice('导入失败：' + error.message); }
      event.target.value = '';
    }} />
    {source ? <textarea className="rw-note-source" aria-label="Markdown 正文" spellCheck={false} value={session.text} onChange={event => manager.update(file, event.target.value, origin.current)} onBlur={() => void flush()} /> : <div className="rw-paper-note-editor" ref={host} />}
  </section>;
}

export function openResearchNote(app, file, title = file.basename) {
  const modal = new Modal(app); modal.setTitle(title); modal.modalEl.classList.add('rw-note-modal');
  const previousFocus = document.activeElement;
  const root = createRoot(modal.contentEl); let closed = false, closing = false;
  modal.onOpen = () => root.render(<ResearchNotes app={app} file={file} title={title} expand={false} />);
  modal.onClose = () => { closed = true; root.unmount(); previousFocus?.focus?.(); };
  const close = modal.close.bind(modal);
  modal.close = async () => {
    if (closed || closing) return; closing = true;
    try { await app.paperNotes.flush(file); close(); }
    catch (error) { new Notice('笔记尚未保存：' + error.message); }
    finally { closing = false; }
  };
  modal.modalEl.addEventListener('keydown', event => {
    // The caret menu consumes Escape/Enter itself before modal dismissal.
    if (event.target.closest('[data-note-commands-open]')) return;
    if (event.key === 'Escape') {
      const menu = [...modal.modalEl.querySelectorAll('.vditor-toolbar__item > .vditor-hint')].find(panel => panel.style.display === 'block');
      if (menu) { menu.style.display = 'none'; event.preventDefault(); event.stopPropagation(); return; }
    }
    if (event.key === 'Escape' && !event.target.closest('.vditor-panel, .vditor-hint')) { event.preventDefault(); event.stopPropagation(); void modal.close(); }
    if (event.key === 'Tab') {
      const nodes = [...modal.modalEl.querySelectorAll('button:not([disabled]), textarea, input:not([hidden]), [contenteditable=true], [tabindex="0"]')].filter(node => node.getClientRects().length);
      const first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }, true);
  modal.open();
}

export function installResearchNotes(app) {
  app.paperNotes = createPaperNotes(app.vault);
  app.notePdfLinks = createNotePdfLinks(app);
  app.openResearchNote = (file, title) => openResearchNote(app, file, title);
  const pane = document.createElement('aside'); pane.id = 'paper-notes-pane'; pane.hidden = true; pane.setAttribute('aria-label', 'PDF 研究笔记');
  document.querySelector('.port-reader-body').append(pane);
  let mounted, file, title, latestPdf;
  const closePane = async () => {
    try { if (file) await app.paperNotes.flush(file); }
    catch (error) { new Notice('笔记尚未保存：' + error.message); return false; }
    mounted?.unmount(); mounted = null; pane.replaceChildren(); pane.hidden = true; file = null; return true;
  };
  const open = async pdf => {
    const paper = app.paperAttachments.owner(pdf.path, app.workspace.readingPaperPath);
    if (!paper) { new Notice('当前 PDF 未关联论文笔记'); return; }
    if (mounted && !await closePane()) return;
    for (const leaf of app.workspace.getLeavesOfType('mupdf-reader-research-sidebar')) await leaf.detach();
    file = paper.file; title = paper.title; latestPdf = pdf;
    pane.hidden = false; pane.replaceChildren();
    const container = document.createElement('div'); pane.append(container); mounted = createRoot(container);
    mounted.render(<><header className="rw-note-pane-header"><div><h2>研究笔记</h2><span title={title}>{title}</span></div><button className="rw-icon-button" title="展开研究笔记" aria-label="展开研究笔记" onClick={() => openResearchNote(app, file, title)}><Maximize2 size={16} /></button><button className="rw-icon-button" title="收起研究笔记" aria-label="收起研究笔记" onClick={() => void closePane()}><X size={16} /></button></header><ResearchNotes app={app} file={file} title={title} expand={false} /></>);
    const handle = document.createElement('div'); handle.className = 'rw-note-pane-resize'; handle.tabIndex = 0; handle.setAttribute('role', 'separator'); handle.setAttribute('aria-label', '调整研究笔记宽度'); handle.setAttribute('aria-orientation', 'vertical'); handle.setAttribute('aria-valuemin', '320');
    const syncWidth = () => { handle.setAttribute('aria-valuenow', String(Math.round(pane.getBoundingClientRect().width))); handle.setAttribute('aria-valuemax', String(Math.max(320, innerWidth - 360))); };
    const resize = value => { const width = Math.max(320, Math.min(innerWidth - 360, value)); pane.style.width = width + 'px'; syncWidth(); try { localStorage.setItem('research-note-pane-width', String(width)); } catch {} };
    let start;
    handle.onpointerdown = event => { if (event.button) return; event.preventDefault(); start = { x: event.clientX, width: pane.getBoundingClientRect().width }; handle.setPointerCapture(event.pointerId); };
    handle.onpointermove = event => { if (start) resize(start.width + start.x - event.clientX); };
    handle.onpointerup = handle.onpointercancel = () => { start = null; };
    handle.onlostpointercapture = () => { start = null; };
    handle.ondblclick = () => { pane.style.width = ''; syncWidth(); try { localStorage.removeItem('research-note-pane-width'); } catch {} };
    handle.onkeydown = event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); resize(pane.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? 20 : -20)); } };
    pane.append(handle);
    try { const width = Number(localStorage.getItem('research-note-pane-width')); if (width) resize(width); } catch {}
    syncWidth();
  };
  app.togglePaperNotes = async pdf => { if (!pane.hidden && file) return closePane(); return open(pdf); };
  app.showPaperNotes = async pdf => { const paper = app.paperAttachments.owner(pdf.path, app.workspace.readingPaperPath); if (!pane.hidden && file?.path === paper?.file.path) return; return open(pdf); };
  const reader = app.plugins.plugins['mupdf-reader-mvp'];
  const openPdf = reader.openPdf.bind(reader);
  reader.openPdf = async (...args) => {
    if (!pane.hidden && file) await app.paperNotes.flush(file);
    return openPdf(...args);
  };
  const back = app.workspace.back.bind(app.workspace);
  app.workspace.back = async (...args) => {
    try { await app.paperNotes.flushAll(); }
    catch (error) { new Notice('笔记尚未保存：' + error.message); return false; }
    if (!await closePane()) return false;
    return back(...args);
  };
  app.workspace.on('active-leaf-change', leaf => {
    if (leaf.right || pane.hidden) return;
    const pdf = app.vault.getAbstractFileByPath(leaf.view?.filePath || '');
    if (pdf && app.paperAttachments.owner(pdf.path, app.workspace.readingPaperPath)?.file.path === file?.path) { latestPdf = pdf; return; }
    if (pdf && pdf.path !== latestPdf?.path) void open(pdf);
  });
  window.addEventListener('beforeunload', event => {
    // Capture any edit still inside the editor's debounce before checking or
    // closing. Normal back/close also captures synchronously through flush.
    app.paperNotes.captureAll();
    if (app.paperNotes.hasUnsaved()) { event.preventDefault(); event.returnValue = ''; }
  });
}
