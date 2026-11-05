import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Type, Heading1, Heading2, Heading3, List, ListOrdered, ListTodo, Quote, SquareCode, Table, Minus, Sigma, Bookmark, HelpCircle, FlaskConical, CheckCircle2, FileCheck, AlertTriangle, Lightbulb, AlignLeft } from 'lucide-react';
import { NOTE_CALLOUTS, calloutMarkdown } from './note-markup.js';

const command = (id, label, icon, markdown, keywords, group = '基础') => ({ id, label, icon, markdown, keywords, group });
export const NOTE_COMMANDS = [
  command('paragraph', '正文', Type, text => text, 'text paragraph p duanluo'),
  command('h1', '一级标题', Heading1, text => '# ' + text, 'heading title h1 biaoti 1'),
  command('h2', '二级标题', Heading2, text => '## ' + text, 'heading title h2 biaoti 2'),
  command('h3', '三级标题', Heading3, text => '### ' + text, 'heading title h3 biaoti 3'),
  command('list', '无序列表', List, text => '- ' + text, 'bullet list ul wuxu'),
  command('ordered', '有序列表', ListOrdered, text => '1. ' + text, 'number list ol youxu'),
  command('todo', '待办列表', ListTodo, text => '- [ ] ' + text, 'todo task checklist daiban'),
  command('quote', '引用', Quote, text => '> ' + text, 'quote blockquote yinyong'),
  command('code', '代码块', SquareCode, text => '```\n' + text + '\n```', 'code daima'),
  command('table', '表格', Table, text => `| ${text} |  |\n| --- | --- |\n|  |  |`, 'table biaoge'),
  command('divider', '分隔线', Minus, text => '***\n\n' + text, 'divider hr fengexian'),
  command('math', '数学公式', Sigma, text => '$$\n' + text + '\n$$', 'math latex formula gongshi'),
  ...NOTE_CALLOUTS.map((item, index) => command('callout-' + item.type, item.label,
    [Bookmark, HelpCircle, FlaskConical, CheckCircle2, FileCheck, AlertTriangle, Lightbulb, AlignLeft][index],
    text => calloutMarkdown(item.type, 'line', item.label, text), 'callout ' + item.type + ' 标注块', '标注块')),
];

// A command occupies a new paragraph, never a word, file path or LaTeX escape.
export function commandQuery(prefix, suffix = '') {
  const match = prefix.replaceAll('\u200b', '').match(/^ {0,3}[\\/]([\p{L}\p{N} -]{0,40})$/u);
  return match && !suffix.replaceAll('\u200b', '').trim() ? match[1].trim().toLowerCase() : null;
}
export function filterNoteCommands(query) {
  const words = query.toLowerCase().trim().split(/\s+/);
  return NOTE_COMMANDS.filter(item => words.every(word => `${item.label} ${item.keywords} ${item.id}`.toLowerCase().includes(word)));
}

let sequence = 0;
const protectedNodes = 'code, pre, a, .vditor-wysiwyg__block, .callout-info, [contenteditable=false]';

export function commitNoteHistory(editor) {
  // KaTeX loads asynchronously. Vditor otherwise snapshots an empty preview
  // while data-render=1 but data-math has not been filled yet.
  const waiting = [...editor.vditor.wysiwyg.element.querySelectorAll('.vditor-wysiwyg__preview[data-render="1"]')].filter(node => node.firstElementChild?.matches('.language-math:not([data-math])'));
  for (const node of waiting) node.dataset.render = '2';
  try { editor.vditor.undo.addToUndoStack(editor.vditor); }
  finally { for (const node of waiting) node.dataset.render = '1'; }
  editor.vditor.wysiwyg.element.dispatchEvent(new Event('rw-note-history-boundary'));
}

/** Local caret inspection only: no Markdown conversion on input or selection. */
export function noteCommandContext(root) {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.isCollapsed || !selection.rangeCount) return null;
  const caret = selection.getRangeAt(0), node = caret.startContainer;
  const element = node.nodeType === 1 ? node : node.parentElement;
  const protectedNode = element.closest(protectedNodes);
  if (!root.contains(node) || (protectedNode && protectedNode !== root)) return null;
  const block = element.closest('p');
  if (!block || !root.contains(block) || block.closest('li, td, th') || block.querySelector('img, input, code, a, [data-rw-note-style]')) return null;
  const before = caret.cloneRange(); before.selectNodeContents(block); before.setEnd(caret.startContainer, caret.startOffset);
  const after = caret.cloneRange(); after.selectNodeContents(block); after.setStart(caret.endContainer, caret.endOffset);
  const prefix = before.toString(), query = commandQuery(prefix, after.toString());
  return query === null ? null : { block, query, prefix, caret: caret.cloneRange() };
}

export function installNoteCommands(editor, changed) {
  const root = editor.vditor.wysiwyg.element, doc = root.ownerDocument, win = doc.defaultView;
  const id = 'rw-note-commands-' + ++sequence;
  let popup, context, items = [], active = 0, composing = false, frame = 0, dismissed, destroyed = false, pendingHistory = false;
  const close = (dismiss = false) => {
    if (dismiss && context) dismissed = { block: context.block, prefix: context.prefix };
    popup?.remove(); popup = null; context = null;
    root.removeAttribute('data-note-commands-open'); root.removeAttribute('aria-controls'); root.removeAttribute('aria-activedescendant'); root.removeAttribute('aria-autocomplete');
  };
  const position = () => {
    if (!popup || !context) return;
    const rect = context.caret.getBoundingClientRect(), fallback = context.block.getBoundingClientRect();
    const anchor = rect.height ? rect : fallback, width = Math.min(284, win.innerWidth - 16);
    popup.style.width = width + 'px';
    const availableBelow = win.innerHeight - anchor.bottom - 14, availableAbove = anchor.top - 14;
    const above = availableBelow < Math.min(240, popup.scrollHeight) && availableAbove > availableBelow;
    const height = Math.max(48, Math.min(352, above ? availableAbove : availableBelow, win.innerHeight - 16));
    popup.style.maxHeight = height + 'px';
    popup.style.left = Math.max(8, Math.min(anchor.left, win.innerWidth - width - 8)) + 'px';
    popup.style.top = Math.max(8, Math.min(above ? anchor.top - Math.min(height, popup.scrollHeight) - 6 : anchor.bottom + 6, win.innerHeight - Math.min(height, popup.scrollHeight) - 8)) + 'px';
  };
  const highlight = () => {
    for (const row of popup?.querySelectorAll('[role=option]') || []) row.setAttribute('aria-selected', String(Number(row.dataset.index) === active));
    const row = popup?.querySelector(`[data-index="${active}"]`);
    if (row) { root.setAttribute('aria-activedescendant', row.id); row.scrollIntoView({ block: 'nearest' }); }
    else root.removeAttribute('aria-activedescendant');
  };
  const apply = item => {
    const current = noteCommandContext(root);
    if (!current || !context || current.block !== context.block || current.prefix !== context.prefix) { close(); return; }
    // Insert through Vditor's Markdown pipeline, not browser insertHTML: native
    // HTML replacement can split a callout/table and inherit surrounding CSS.
    // Keep a separate undo boundary for the command, independent of fast typing.
    const vditor = editor.vditor;
    vditor.undo.addToUndoStack(vditor);
    const marker = 'RWNOTECARET' + sequence + 'END';
    const range = doc.createRange(); range.selectNodeContents(current.block);
    root.focus(); const selection = doc.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    close(); editor.insertMD(item.markdown(marker));
    if (current.block.isConnected && !current.block.textContent.replaceAll('\u200b', '').trim()) current.block.remove();
    const walker = doc.createTreeWalker(root, win.NodeFilter.SHOW_TEXT);
    let node, target;
    while ((node = walker.nextNode())) {
      const offset = node.data.indexOf(marker); if (offset < 0) continue;
      node.deleteData(offset, marker.length);
      if (!target && !node.parentElement.closest('[contenteditable=false]')) target = { node, offset };
    }
    if (target) {
      const { node, offset } = target, caret = doc.createRange();
      const code = node.parentElement.closest('.vditor-wysiwyg__block > pre');
      if (code) code.style.display = 'block';
      if (!node.data && node.parentElement.childNodes.length === 1) {
        const parent = node.parentElement; parent.append(doc.createElement('br')); caret.setStart(parent, 0);
      } else caret.setStart(node, offset);
      caret.collapse(true); selection.removeAllRanges(); selection.addRange(caret);
      node.parentElement.scrollIntoView({ block: 'nearest' });
    }
    for (const heading of root.querySelectorAll('h1[id], h2[id], h3[id]')) if (heading.id.includes(marker)) heading.removeAttribute('id');
    commitNoteHistory(editor);
    changed();
  };
  const render = () => {
    if (!popup) {
      popup = doc.createElement('div'); popup.id = id; popup.className = 'rw-note-command-menu';
      popup.setAttribute('role', 'listbox'); popup.setAttribute('aria-label', '插入内容');
      // Keep the editing caret and IME inside the document while choosing.
      popup.addEventListener('pointerdown', event => event.preventDefault());
      popup.addEventListener('click', event => {
        const row = event.target.closest('[data-index]'); if (row) apply(items[Number(row.dataset.index)]);
      });
      popup.addEventListener('pointermove', event => {
        const row = event.target.closest('[data-index]'); if (row) { active = Number(row.dataset.index); highlight(); }
      });
      doc.body.append(popup);
    }
    popup.replaceChildren(); let group;
    for (const [index, item] of items.entries()) {
      if (group !== item.group) {
        group = item.group;
        const label = doc.createElement('div'); label.className = 'rw-note-command-group'; label.textContent = group; label.setAttribute('role', 'presentation'); popup.append(label);
      }
      const row = doc.createElement('div'); row.id = `${id}-${item.id}`; row.dataset.index = index; row.setAttribute('role', 'option');
      row.innerHTML = renderToStaticMarkup(createElement(item.icon, { size: 16, strokeWidth: 1.7, 'aria-hidden': true }));
      const label = doc.createElement('span'); label.textContent = item.label; row.append(label); popup.append(row);
    }
    if (!items.length) { const empty = doc.createElement('div'); empty.className = 'rw-note-command-empty'; empty.textContent = '无匹配项'; empty.setAttribute('role', 'status'); popup.append(empty); }
    root.setAttribute('data-note-commands-open', ''); root.setAttribute('aria-controls', id); root.setAttribute('aria-autocomplete', 'list');
    position(); highlight();
  };
  const refresh = () => {
    frame = 0; if (destroyed || composing) return;
    const next = noteCommandContext(root);
    if (!next || (dismissed?.block === next.block && dismissed.prefix === next.prefix)) { close(); return; }
    if (context?.block === next.block && context.prefix === next.prefix) { context = next; position(); return; }
    context = next; dismissed = null; items = filterNoteCommands(next.query); active = 0; render();
  };
  const schedule = () => { win.cancelAnimationFrame(frame); frame = win.requestAnimationFrame(refresh); };
  const keydown = event => {
    if (composing || event.isComposing || event.keyCode === 229) return;
    if (pendingHistory && (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
      // Vditor batches typing for 250ms. Capture it before an immediate undo so
      // redo can restore both the inserted block and its freshly typed text.
      editor.vditor.undo.addToUndoStack(editor.vditor);
      pendingHistory = false;
    }
    // Input may have landed in this frame before requestAnimationFrame.
    if (event.key !== 'Escape') refresh();
    if (!popup) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(true); return; }
    if (['ArrowDown', 'ArrowUp'].includes(event.key) && items.length) {
      event.preventDefault(); event.stopImmediatePropagation();
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; highlight();
    } else if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && items.length) {
      event.preventDefault(); event.stopImmediatePropagation(); apply(items[active]);
    } else if (['Tab', 'ArrowLeft', 'ArrowRight'].includes(event.key)) close(true);
  };
  const compositionStart = () => { composing = true; close(); };
  const compositionEnd = () => { composing = false; schedule(); };
  const outside = event => { if (!root.contains(event.target) && !popup?.contains(event.target)) close(true); };
  const scroll = event => {
    if (!popup || popup.contains(event.target) || !context) return;
    // The reader/detail panel also scrolls automatically to keep typing visible.
    // Follow that caret instead of dismissing the command the user just typed.
    const rect = context.caret.getBoundingClientRect();
    if (rect.height && (rect.bottom < 0 || rect.top > win.innerHeight || rect.right < 0 || rect.left > win.innerWidth)) close(true);
    else schedule();
  };
  const blur = () => close(true);
  const input = () => { pendingHistory = true; schedule(); };
  const boundary = () => { pendingHistory = false; };
  root.addEventListener('input', input); root.addEventListener('keydown', keydown, true);
  root.addEventListener('rw-note-history-boundary', boundary);
  root.addEventListener('compositionstart', compositionStart); root.addEventListener('compositionend', compositionEnd);
  root.addEventListener('blur', blur); doc.addEventListener('selectionchange', schedule);
  doc.addEventListener('pointerdown', outside); doc.addEventListener('scroll', scroll, true); win.addEventListener('resize', position);
  return () => {
    destroyed = true; win.cancelAnimationFrame(frame); close();
    root.removeEventListener('input', input); root.removeEventListener('keydown', keydown, true);
    root.removeEventListener('rw-note-history-boundary', boundary);
    root.removeEventListener('compositionstart', compositionStart); root.removeEventListener('compositionend', compositionEnd);
    root.removeEventListener('blur', blur); doc.removeEventListener('selectionchange', schedule);
    doc.removeEventListener('pointerdown', outside); doc.removeEventListener('scroll', scroll, true); win.removeEventListener('resize', position);
  };
}
