import { Menu, Modal, Notice, setIcon } from './obsidian.js';
import { PDF_NOTE_PREFIX, pdfLocationHref, parsePdfLocation, readerLocation, noteHeadings, linkHeading, precedingLocation } from './pdf-note-location.js';

const blockFor = (root, node) => {
  let element = node?.nodeType === 1 ? node : node?.parentElement;
  if (!element || !root.contains(element)) return null;
  element = element.closest('a[href^="#rw-pdf="]:has(img),h1,h2,h3,h4,h5,h6,p,table,blockquote');
  return element && root.contains(element) ? element : null;
};
const visible = entry => entry.root.isConnected && entry.root.getClientRects().length && entry.root.closest('#paper-notes-pane') && !entry.root.closest('#paper-notes-pane').hidden;
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const blockLinks = block => [...(block.matches(`a[href^="${PDF_NOTE_PREFIX}"]`) ? [block] : []), ...block.querySelectorAll(`a[href^="${PDF_NOTE_PREFIX}"]`)];

export function createNotePdfLinks(app) {
  const entries = new Set(), readers = new Set(), subscribers = new Set();
  let enabled = true, guard = null, readerTimer, noteTimer, generation = 0;
  try { enabled = localStorage.getItem('research-note-pdf-follow') !== 'false'; } catch {}
  const plugin = () => app.plugins.plugins['mupdf-reader-mvp'];
  const owner = (path, file) => app.paperAttachments.owner(path, file?.path);
  const activeReader = () => app.workspace.mainLeaf?.view?.reader;
  const hasReader = file => {
    const reader = activeReader(); return reader && !reader.destroyed && reader.root.getClientRects().length && owner(reader.file.path, file)?.file.path === file.path ? reader : null;
  };
  const notify = () => { for (const fn of subscribers) fn(); };
  const cancel = () => { clearTimeout(readerTimer); clearTimeout(noteTimer); };
  const user = target => { guard = null; cancel(); return target; };
  const blocked = target => guard?.target === target && performance.now() < guard.until;
  const suppress = target => { guard = { target, until: performance.now() + 900 }; };
  const mark = (entry, block) => {
    entry.marked?.classList.remove('rw-note-location-active'); entry.marked = block;
    block?.classList.add('rw-note-location-active');
  };
  const links = entry => [...entry.root.querySelectorAll(`a[href^="${PDF_NOTE_PREFIX}"]`)].flatMap(link => {
    const location = parsePdfLocation(link.getAttribute('href')), block = blockFor(entry.root, link);
    if (location) { const label = `跳转原文 · 第 ${location.page + 1} 页`; link.title = label; link.setAttribute('aria-label', label); }
    return location && block ? [{ link, block, location }] : [];
  });
  const scrollNote = (entry, item) => {
    mark(entry, item.block); if (entry.lastFollowed === item.link && !blocked(entry.scroll)) return;
    entry.lastFollowed = item.link;
    const scroll = entry.scroll, frame = scroll.getBoundingClientRect(), box = item.block.getBoundingClientRect();
    if (Math.abs(box.top - frame.top - 32) < 12) return;
    suppress(scroll); scroll.scrollTo({ top: scroll.scrollTop + box.top - frame.top - 32, behavior: reduced() ? 'auto' : 'smooth' });
  };
  const focusPdf = (reader, location, flash = false) => {
    const shell = reader.pageNodes?.[location.page]?.shell; if (!shell) return false;
    const scroll = reader.scrollEl, box = shell.getBoundingClientRect();
    suppress(scroll);
    reader.currentPage = location.page; reader.pageInput.value = String(location.page + 1); reader.queueRender(location.page, true);
    scroll.scrollTo({ top: scroll.scrollTop + box.top - scroll.getBoundingClientRect().top + location.y * box.height - 32, behavior: reduced() ? 'auto' : 'smooth' });
    reader.readingPositionSaveDebounced?.();
    if (flash) {
      shell.querySelector('.rw-pdf-location-flash')?.remove();
      const marker = document.createElement('div'); marker.className = 'rw-pdf-location-flash';
      const rect = location.rect || [0, location.y, 1, .025];
      Object.assign(marker.style, { left: rect[0] * 100 + '%', top: rect[1] * 100 + '%', width: rect[2] * 100 + '%', height: Math.max(.012, rect[3]) * 100 + '%' });
      shell.append(marker); setTimeout(() => marker.remove(), 1500);
    }
    return true;
  };
  async function jump(file, location, explicit = true) {
    if (owner(location.pdf, file)?.file.path !== file.path) throw new Error('定位的 PDF 不属于当前论文');
    const pdf = app.vault.getAbstractFileByPath(location.pdf); if (!pdf) throw new Error('定位的 PDF 文件已缺失');
    let reader = [...readers].find(r => !r.destroyed && r.file.path === location.pdf && r.root.getClientRects().length);
    if (!reader && !explicit) return;
    if (!reader) {
      app.workspace.readingPaperPath = file.path;
      await plugin().openPdf(pdf, false); reader = activeReader();
      if (!reader || reader.file.path !== location.pdf) throw new Error('PDF 尚未准备好');
    }
    const leaf = app.workspace.getLeavesOfType('mupdf-reader-view').find(l => l.view.reader === reader);
    if (leaf && app.workspace.mainLeaf !== leaf) app.workspace.revealLeaf(leaf);
    if (explicit) {
      const modal = [...entries].find(e => e.file.path === file.path && e.root.closest('.rw-note-modal'))?.root.closest('.rw-note-modal');
      modal?.querySelector('button[aria-label="关闭弹窗"]')?.click();
      const pane = document.querySelector('#paper-notes-pane');
      if (pane?.hidden) await app.showPaperNotes?.(pdf);
    }
    focusPdf(reader, location, explicit);
  }
  const run = action => { void Promise.resolve().then(action).catch(error => new Notice(error.message)); };
  function selectBlock(entry) {
    const selection = getSelection();
    return blockFor(entry.root, selection?.anchorNode) || (entry.selected?.isConnected ? entry.selected : null);
  }
  function setBlockLink(entry, block, location) {
    if (!block?.isConnected || !entry.root.contains(block)) throw new Error('请先选择笔记中的标题、图片或段落');
    const engine = entry.editor.vditor;
    engine.undo.addToUndoStack(engine);
    const existing = blockLinks(block);
    if (existing[0]?.querySelector('img')) {
      // Linked images may be root blocks or inline children. Replacing either
      // with insertMD can duplicate its image. Change only the wrapper, then
      // normalize once using the editor's public API (which retains undo).
      const scrollTop = entry.scroll.scrollTop, target = existing[0];
      if (location) target.setAttribute('href', pdfLocationHref(location));
      else target.replaceWith(...target.childNodes);
      const markdown = entry.editor.getValue();
      entry.editor.setValue(markdown); entry.scroll.scrollTop = scrollTop;
      engine.undo.addToUndoStack(engine);
      entry.changed(); entry.lastFollowed = null; links(entry); return;
    }
    const range = document.createRange();
    if (existing.length) range.selectNode(existing[0]); else { range.selectNodeContents(block); range.collapse(false); }
    entry.editor.focus(); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    if (location) {
      entry.editor.insertMD(`${existing.length ? '' : ' '}[↗](${pdfLocationHref(location)})`);
    }
    else if (existing[0]) {
      // Keep the image/content when removing a linked image's source.
      const text = entry.editor.vditor.lute.VditorDOM2Md(existing[0].innerHTML);
      entry.editor.insertMD(existing[0].textContent === '↗' ? '' : text);
    }
    engine.undo.addToUndoStack(engine); entry.changed(); entry.lastFollowed = null; links(entry);
  }
  function editorMenu(entry, event) {
    cancel(); generation++;
    const block = blockFor(entry.root, event.target) || selectBlock(entry), current = block && blockLinks(block).find(a => parsePdfLocation(a.getAttribute('href')));
    const reader = hasReader(entry.file), location = reader && readerLocation(reader);
    const menu = new Menu({ ignoreScroll: event => [...readers].some(reader => reader.scrollEl === event.target) }); menu.root.setAttribute('aria-label', '笔记与论文定位');
    menu.addItem(item => item.setTitle('关联当前 PDF 位置').setIcon('link').setDisabled(!block || !location).onClick(() => setBlockLink(entry, block, location)));
    menu.addItem(item => item.setTitle('跳转到论文原文').setIcon('arrow-up-right').setDisabled(!current).onClick(() => jump(entry.file, parsePdfLocation(current.getAttribute('href')))));
    menu.addItem(item => item.setTitle('解除关联').setIcon('unlink').setDisabled(!current).onClick(() => setBlockLink(entry, block, null)));
    menu.addSeparator(); menu.addItem(item => item.setTitle('滚动联动').setIcon('arrow-down-up').setChecked(enabled).onClick(() => api.setEnabled(!enabled)));
    menu.showAtMouseEvent(event);
  }
  async function picker(reader, location) {
    const paper = owner(reader.file.path, app.workspace.readingPaperPath); if (!paper) throw new Error('当前 PDF 尚未关联论文');
    const file = paper.file; await app.paperNotes.flush(file);
    const text = app.paperNotes.session(file).text, headings = noteHeadings(text);
    const modal = new Modal(app); modal.setTitle('关联到笔记'); modal.modalEl.classList.add('rw-note-link-modal');
    const filter = modal.contentEl.createEl('input', { attr: { type: 'search', placeholder: '搜索标题', 'aria-label': '搜索笔记标题' } });
    const list = modal.contentEl.createDiv({ cls: 'rw-note-link-choices' });
    const save = async transform => {
      if (app.paperNotes.session(file).text !== text) throw new Error('笔记已更新，请重新选择标题');
      app.paperNotes.update(file, transform(text)); await app.paperNotes.flush(file); modal.close();
    };
    const render = () => {
      list.replaceChildren();
      for (const heading of headings.filter(h => h.label.toLowerCase().includes(filter.value.toLowerCase()))) {
        const button = list.createEl('button', { text: heading.label, attr: { type: 'button' } });
        button.style.setProperty('--heading-indent', Math.min(3, heading.level - 1) * 10 + 'px');
        button.onclick = () => run(() => save(value => linkHeading(value, heading, location)));
      }
    }; filter.oninput = render; render();
    const row = modal.contentEl.createDiv({ cls: 'rw-note-link-new' });
    const name = row.createEl('input', { attr: { placeholder: '新建标题', 'aria-label': '新建定位标题' } });
    const create = row.createEl('button', { text: '新建并关联', cls: 'rw-secondary' });
    create.onclick = () => { if (name.value.trim()) run(() => save(value => value.trimEnd() + '\n\n## ' + name.value.trim().replace(/[\r\n]/g, ' ') + ' [↗](' + pdfLocationHref(location) + ')\n')); };
    modal.open(); filter.focus();
  }
  async function insertImage(reader, page, rect, annotation) {
    const paper = owner(reader.file.path, app.workspace.readingPaperPath); if (!paper) throw new Error('当前 PDF 尚未关联论文');
    const location = readerLocation(reader, page, [rect[0], rect[1]], rect); if (!location) throw new Error('PDF 页面尚未准备好');
    const blob = annotation ? await plugin().getRegionPreviewBlob(annotation) : null;
    const data = blob ? await new Promise((resolve, reject) => { const loader = new FileReader(); loader.onload = () => resolve(loader.result); loader.onerror = reject; loader.readAsDataURL(blob); }) : (await reader.renderRegionPreview(page, rect))?.dataUrl;
    if (!data || !String(data).startsWith('data:image/')) throw new Error('无法读取图表截图');
    const markdown = `\n\n[![图表摘录](${data})](${pdfLocationHref(location)})\n\n`;
    // Capture pending typing first; never append to an outdated saved body.
    await app.paperNotes.flush(paper.file);
    const entry = [...entries].find(e => e.file.path === paper.file.path && visible(e));
    if (entry) {
      const range = entry.range;
      // Put screenshots after the current block. Inserting at a heading's
      // last caret can nest the image in its source link and inherit that URL.
      let block = range && entry.root.contains(range.startContainer) ? blockFor(entry.root, range.startContainer) : null;
      while (block?.parentElement && block.parentElement !== entry.root) block = block.parentElement;
      const placeholder = document.createElement('p'); placeholder.dataset.block = '0'; placeholder.append(document.createElement('br'));
      if (block && block !== entry.root) block.after(placeholder); else entry.root.append(placeholder);
      entry.editor.focus(); const selection = getSelection(); selection.removeAllRanges();
      const insertion = document.createRange(); insertion.selectNodeContents(placeholder); insertion.collapse(true); selection.addRange(insertion);
      entry.editor.insertMD(markdown);
      if (!placeholder.querySelector('img') && !placeholder.textContent.trim()) placeholder.remove();
      entry.changed(); links(entry);
    } else app.paperNotes.update(paper.file, app.paperNotes.session(paper.file).text.trimEnd() + markdown);
    await app.paperNotes.flush(paper.file);
    if (document.querySelector('#paper-notes-pane')?.hidden) await app.showPaperNotes?.(reader.file);
  }
  const api = {
    get enabled() { return enabled; },
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    setEnabled(value) { enabled = Boolean(value); cancel(); guard = null; for (const entry of entries) entry.lastFollowed = null; try { localStorage.setItem('research-note-pdf-follow', String(enabled)); } catch {} notify(); },
    hasReader, jump, picker, insertImage,
    menu(editor, event) { const entry = [...entries].find(e => e.editor === editor); if (entry) editorMenu(entry, event); },
    remember(editor) { const entry = [...entries].find(e => e.editor === editor); if (entry) entry.selected = selectBlock(entry); },
    register(editor, file, changed) {
      // Vditor scrolls its editable <pre>, not the .vditor-wysiwyg wrapper.
      const root = editor.vditor.wysiwyg.element, scroll = root, entry = { editor, file, root, scroll, changed };
      entries.add(entry); links(entry); notify();
      const remember = () => { const selection = getSelection(); if (selection?.rangeCount && root.contains(selection.anchorNode)) { entry.range = selection.getRangeAt(0).cloneRange(); entry.selected = selectBlock(entry); } };
      const writing = () => { entry.editingUntil = performance.now() + 1200; };
      const onScroll = () => {
        if (!enabled || !visible(entry) || blocked(scroll)) return;
        clearTimeout(noteTimer); const token = generation;
        noteTimer = setTimeout(() => {
          if (!enabled || token !== generation || !visible(entry) || blocked(scroll)) return;
          const frame = scroll.getBoundingClientRect(), top = frame.top + Math.min(160, frame.height * .25), items = links(entry);
          const item = items.filter(i => i.block.getBoundingClientRect().top <= top).at(-1);
          if (!item || entry.noteFollowed === item.link) return;
          entry.noteFollowed = item.link; mark(entry, item.block); run(() => jump(file, item.location, false));
        }, 200);
      };
      const gesture = event => { if (event.type !== 'keydown' || ['PageDown', 'PageUp', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' '].includes(event.key)) { user(scroll); entry.lastFollowed = null; } };
      const click = event => {
        const anchor = event.target.closest(`a[href^="${PDF_NOTE_PREFIX}"]`); if (!anchor) return;
        const location = parsePdfLocation(anchor.getAttribute('href')); if (!location) return;
        event.preventDefault(); event.stopImmediatePropagation(); cancel(); generation++; mark(entry, blockFor(root, anchor)); run(() => jump(file, location));
      };
      const context = event => { const block = blockFor(root, event.target); if (!block) return; event.preventDefault(); event.stopImmediatePropagation(); editorMenu(entry, event); };
      root.addEventListener('input', writing); root.addEventListener('click', click, true); root.addEventListener('contextmenu', context, true); root.addEventListener('keyup', remember); root.addEventListener('pointerup', remember);
      scroll.addEventListener('scroll', onScroll, { passive: true });
      for (const type of ['wheel', 'pointerdown', 'keydown']) scroll.addEventListener(type, gesture, { passive: true });
      return () => {
        entries.delete(entry); generation++; cancel(); mark(entry, null); notify();
        root.removeEventListener('input', writing); root.removeEventListener('click', click, true); root.removeEventListener('contextmenu', context, true); root.removeEventListener('keyup', remember); root.removeEventListener('pointerup', remember); scroll.removeEventListener('scroll', onScroll);
        for (const type of ['wheel', 'pointerdown', 'keydown']) scroll.removeEventListener(type, gesture);
      };
    },
    attachReader(reader) {
      readers.add(reader); notify(); const scroll = reader.scrollEl;
      const gesture = () => { user(scroll); for (const entry of entries) { entry.noteFollowed = null; entry.editingUntil = 0; } };
      const onScroll = () => {
        if (!enabled || blocked(scroll) || activeReader() !== reader || Menu.active?.root.getAttribute('aria-label') === '笔记与论文定位') return;
        clearTimeout(readerTimer); const token = generation;
        readerTimer = setTimeout(() => {
          if (!enabled || token !== generation || blocked(scroll) || activeReader() !== reader) return;
          const position = readerLocation(reader); if (!position) return;
          for (const entry of entries) {
            if (!visible(entry) || owner(reader.file.path, entry.file)?.file.path !== entry.file.path) continue;
            // Never move the writing surface while text is being entered/selected.
            if (entry.editingUntil > performance.now()) continue;
            const item = precedingLocation(links(entry), position); if (item) scrollNote(entry, item);
          }
        }, 200);
      };
      for (const type of ['wheel', 'pointerdown', 'keydown']) reader.root.addEventListener(type, gesture, { passive: true });
      scroll.addEventListener('scroll', onScroll, { passive: true });
      const originalMenu = reader.onPageContextMenu, originalCapture = reader.createRegionClip;
      let captureNote = false;
      const captureButton = document.createElement('button'); captureButton.className = 'mupdf-reader-btn'; captureButton.setAttribute('aria-label', '框选图表插入研究笔记'); captureButton.title = '图表插入研究笔记'; setIcon(captureButton, 'image-plus');
      captureButton.onclick = () => { captureNote = !captureNote; reader.setRegionCaptureMode(captureNote); captureButton.classList.toggle('is-active', captureNote); };
      reader.regionCaptureButton.after(captureButton);
      const escape = event => { if (event.key === 'Escape') { captureNote = false; captureButton.classList.remove('is-active'); } };
      reader.root.addEventListener('keydown', escape, true);
      const normalCapture = () => { captureNote = false; captureButton.classList.remove('is-active'); };
      reader.regionCaptureButton.addEventListener('click', normalCapture);
      reader.createRegionClip = function (page, rect) {
        if (!captureNote) return originalCapture.call(this, page, rect);
        captureNote = false; captureButton.classList.remove('is-active'); run(() => insertImage(reader, page, rect));
      };
      reader.onPageContextMenu = function (event, page) {
        const before = Menu.active; originalMenu.call(this, event, page);
        const point = reader.pagePointFromEvent(event, page); if (!point) return;
        const hit = reader.findAnnotationAt(page, point);
        const bounds = hit ? reader.annotationBoundsPdf(hit) : reader.selection?.text && reader.isPointInsideSelection(page, point) ? reader.annotationBoundsPdf({ page, quads: reader.selection.quads }) : null;
        const rect = bounds && [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY];
        const location = readerLocation(reader, page, rect ? [rect[0], rect[1]] : point, rect);
        if (!location || !owner(reader.file.path, app.workspace.readingPaperPath)) return;
        event.preventDefault();
        const menu = Menu.active && Menu.active !== before ? Menu.active : new Menu();
        if (menu === Menu.active) menu.addSeparator();
        menu.addItem(item => item.setTitle('关联到研究笔记…').setIcon('link').onClick(() => picker(reader, location)));
        if (hit?.type === 'region') menu.addItem(item => item.setTitle('插入图表到研究笔记').setIcon('image-plus').onClick(() => insertImage(reader, page, hit.rect, hit)));
        if (menu !== Menu.active) menu.showAtMouseEvent(event);
        else menu.root.style.top = Math.max(8, Math.min(event.clientY, innerHeight - menu.root.offsetHeight - 8)) + 'px';
      };
      return () => {
        readers.delete(reader); generation++; cancel(); notify();
        scroll.removeEventListener('scroll', onScroll);
        for (const type of ['wheel', 'pointerdown', 'keydown']) reader.root.removeEventListener(type, gesture);
        reader.root.removeEventListener('keydown', escape, true); reader.regionCaptureButton.removeEventListener('click', normalCapture); captureButton.remove();
        reader.onPageContextMenu = originalMenu; reader.createRegionClip = originalCapture;
      };
    },
  };
  return api;
}
