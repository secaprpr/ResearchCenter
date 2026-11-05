import { Notice, setIcon } from './obsidian.js';
import { startReadingOnOpen } from './reading-status.js';
import './pdf-comparison.css';

const PREF = 'research-pdf-comparison-size';
const VIEW = 'mupdf-reader-view';
const loaded = leaf => leaf?.view?.reader?.docId && leaf.view.reader.pageSizes?.length && !leaf.view.reader.destroyed && !leaf.view.reader.root?.querySelector('.mupdf-reader-error-title');

function captureViewport(reader, anchorY = 0) {
  const shell = reader.pageNodes[reader.currentPage]?.shell, scroll = reader.scrollEl;
  if (!shell || !scroll) return null;
  const box = shell.getBoundingClientRect(), anchor = anchorY ?? 0;
  const fraction = (scroll.getBoundingClientRect().top + anchor - box.top) / Math.max(1, box.height);
  return { shell, scroll, fraction, anchor };
}

function preserveViewport(reader, action, anchorY = 0, snapshot = captureViewport(reader, anchorY)) {
  if (!snapshot) return action();
  const { shell, scroll, fraction, anchor } = snapshot;
  const update = reader.updateZoomLayout;
  // Native zoom anchors a delayed frame to the whole document. In a resizable
  // pane, anchor directly to the current page instead, without a later jump.
  reader.updateZoomLayout = function () { return update.call(this, false); };
  try { return action(); }
  finally {
    reader.updateZoomLayout = update;
    const next = shell.getBoundingClientRect();
    scroll.scrollTop += next.top + fraction * next.height - scroll.getBoundingClientRect().top - anchor;
  }
}

export function installPdfComparison(app) {
  const workspace = app.workspace, plugin = app.plugins.plugins['mupdf-reader-mvp'], host = document.querySelector('#reader-main');
  const originalOpen = plugin.openPdf.bind(plugin), originalBack = workspace.back.bind(workspace);
  const listeners = new Set();
  let layout, paper, panes = {}, separator, observer, resizeFrame, queued = 0, work = Promise.resolve(), drag, displayedRatio = .5;
  let ratios = { horizontal: .5, vertical: .5 };
  try { const saved = JSON.parse(localStorage.getItem(PREF) || '{}'); for (const key of Object.keys(ratios)) if (Number.isFinite(saved[key]) && saved[key] >= .1 && saved[key] <= .9) ratios[key] = saved[key]; } catch {}
  const state = () => ({ active: Boolean(layout), busy: queued > 0, paper, side: Object.keys(panes).find(side => panes[side].leaf === workspace.mainLeaf) || 'left' });
  const publish = () => { syncHeaders(); for (const listener of listeners) listener(state()); };
  const run = action => {
    queued++; publish();
    const next = work.catch(() => {}).then(action);
    work = next.finally(() => { queued--; publish(); });
    return work;
  };
  const documents = () => paper ? app.paperAttachments.documents(paper).filter(item => item.extension === 'pdf') : [];
  const focus = side => {
    const pane = panes[side]; if (!pane?.leaf?.view) return;
    if (workspace.mainLeaf !== pane.leaf) workspace.revealLeaf(pane.leaf);
    else app.readingActivity.activate(pane.leaf.view.reader);
  };
  function syncHeaders() {
    if (!layout) return;
    const choices = documents();
    for (const [side, pane] of Object.entries(panes)) {
      const opposite = panes[side === 'left' ? 'right' : 'left'];
      const key = JSON.stringify([pane.path, opposite?.path, choices.map(item => [item.path, item.name, Boolean(item.file)])]);
      if (key !== pane.optionsKey) {
        pane.optionsKey = key; pane.select.replaceChildren();
        for (const item of choices) {
          const option = document.createElement('option'); option.value = item.path; option.textContent = item.primary ? '正文' : item.name;
          option.disabled = !item.file || item.path === opposite?.path; pane.select.append(option);
        }
        if (!choices.some(item => item.path === pane.path)) {
          const option = document.createElement('option'); option.value = pane.path || ''; option.textContent = pane.path?.split('/').pop() || '当前 PDF'; pane.select.append(option);
        }
      }
      pane.select.value = pane.path; pane.select.disabled = queued > 0; pane.close.disabled = queued > 0;
      pane.select.title = choices.find(item => item.path === pane.path)?.filename || pane.path;
    }
    layout.setAttribute('aria-busy', String(queued > 0));
  }
  const bounds = () => {
    const vertical = host.clientWidth < 680, total = (vertical ? host.clientHeight : host.clientWidth) - 8;
    const minimum = Math.min(.45, (vertical ? 170 : 280) / Math.max(1, total));
    return { vertical, total, minimum };
  };
  const measure = () => {
    if (!layout) return;
    const { vertical, minimum } = bounds(), ratio = Math.max(minimum, Math.min(1 - minimum, ratios[vertical ? 'vertical' : 'horizontal']));
    displayedRatio = ratio;
    layout.classList.toggle('is-stacked', vertical);
    layout.style.setProperty('--compare-first', ratio + 'fr'); layout.style.setProperty('--compare-second', (1 - ratio) + 'fr');
    separator.setAttribute('aria-orientation', vertical ? 'horizontal' : 'vertical');
    separator.setAttribute('aria-label', vertical ? '调整上下阅读高度' : '调整并排阅读宽度');
    separator.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    separator.setAttribute('aria-valuemin', String(Math.ceil(minimum * 100))); separator.setAttribute('aria-valuemax', String(Math.floor((1 - minimum) * 100)));
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => { for (const pane of Object.values(panes)) pane.resize?.(); });
  };
  const resize = value => {
    const { vertical, minimum } = bounds(); ratios[vertical ? 'vertical' : 'horizontal'] = Math.max(minimum, Math.min(1 - minimum, value));
    try { localStorage.setItem(PREF, JSON.stringify(ratios)); } catch {}
    measure();
  };
  const watchReader = (pane, anchor = null) => {
    pane.unwatch?.();
    const reader = pane.leaf.view.reader, fit = reader.fitWidth, zoom = reader.setZoom, go = reader.goToPage;
    let autoFit = true;
    reader.setZoom = function (...args) { autoFit = false; return preserveViewport(this, () => zoom.apply(this, args), args[1]); };
    reader.fitWidth = function (...args) { const result = fit.apply(this, args); autoFit = true; return result; };
    // A native smooth jump can still be running when the other PDF is used or
    // this pane is resized. Finish page jumps immediately in the split view.
    reader.goToPage = function (page) { return go.call(this, page, 'auto'); };
    pane.isFit = () => autoFit;
    pane.resize = () => { if (reader.destroyed) return; if (autoFit) reader.fitWidth(); else reader.renderVisible(false); };
    pane.unwatch = () => { reader.fitWidth = fit; reader.setZoom = zoom; reader.goToPage = go; pane.resize = null; pane.unwatch = null; };
    if (anchor) preserveViewport(reader, () => pane.resize(), 0, anchor);
    else pane.resize();
  };
  const load = async (pane, item) => {
    pane.unwatch?.(); pane.path = item.path;
    const zoom = plugin.getReadingPosition(item.path)?.zoom || 1;
    await pane.leaf.setViewState({ type: VIEW, active: true, state: { file: item.path, zoom } });
    if (!loaded(pane.leaf)) throw new Error('无法打开 PDF：' + item.filename);
    watchReader(pane);
    try { await startReadingOnOpen(app.vault, paper.file); } catch (error) { new Notice('PDF 已打开，阅读状态保存失败：' + error.message); }
    return pane.leaf;
  };
  const close = async (keepSide = state().side) => {
    if (!layout) return workspace.mainLeaf;
    const keep = panes[keepSide] || panes.left, other = Object.values(panes).filter(pane => pane !== keep), fit = keep.isFit?.();
    observer?.disconnect(); cancelAnimationFrame(resizeFrame); drag = null;
    for (const pane of Object.values(panes)) pane.unwatch?.();
    // Native close reads PDF geometry to persist its position. Keep the closing
    // pane connected until that finishes; detached page rectangles become zero.
    for (const pane of other) await pane.leaf.detach();
    const anchor = captureViewport(keep.leaf.view.reader);
    // Reparent the live instance, preserving its page even if the browser resets
    // scroll offsets while moving the node into the full-width host.
    host.append(keep.leaf.element); layout.remove(); layout = null; separator = null;
    panes = {}; paper = null; host.classList.remove('is-comparing');
    workspace.revealLeaf(keep.leaf);
    preserveViewport(keep.leaf.view.reader, () => { if (fit) keep.leaf.view.reader.fitWidth(); }, 0, anchor);
    publish(); return keep.leaf;
  };
  const makePane = side => {
    const element = document.createElement('section'); element.className = 'rw-pdf-pane'; element.dataset.pdfPane = side;
    element.setAttribute('role', 'region'); element.setAttribute('aria-label', side === 'left' ? '左侧 PDF' : '右侧 PDF');
    const header = document.createElement('header'); header.className = 'rw-pdf-pane-heading';
    const icon = document.createElement('span'); setIcon(icon, 'file-text');
    const select = document.createElement('select'); select.setAttribute('aria-label', side === 'left' ? '选择左侧 PDF' : '选择右侧 PDF');
    select.onchange = () => void api.change(side, select.value).catch(error => { new Notice(error.message); publish(); });
    const chevron = document.createElement('span'); chevron.className = 'rw-pdf-pane-chevron'; chevron.setAttribute('aria-hidden', 'true'); setIcon(chevron, 'chevron-down');
    const button = document.createElement('button'); button.className = 'rw-icon-button'; button.setAttribute('aria-label', side === 'left' ? '关闭左侧阅读栏' : '关闭右侧阅读栏'); button.title = button.getAttribute('aria-label'); setIcon(button, 'x');
    button.onclick = () => void api.close(side === 'left' ? 'right' : 'left').catch(error => new Notice(error.message));
    header.append(icon, select, chevron, button);
    const slot = document.createElement('div'); slot.className = 'rw-pdf-pane-body'; element.append(header, slot);
    return { element, select, close: button, slot };
  };
  const build = () => {
    layout = document.createElement('div'); layout.className = 'rw-pdf-comparison'; layout.setAttribute('aria-label', '正文与附录对照');
    panes = { left: makePane('left'), right: makePane('right') };
    separator = document.createElement('div'); separator.className = 'rw-pdf-separator'; separator.tabIndex = 0; separator.setAttribute('role', 'separator'); separator.title = '调整阅读栏大小';
    separator.onpointerdown = event => { if (event.button) return; event.preventDefault(); drag = true; separator.setPointerCapture(event.pointerId); };
    separator.onpointermove = event => { if (!drag) return; const box = layout.getBoundingClientRect(), { vertical, total } = bounds(); resize(((vertical ? event.clientY - box.top : event.clientX - box.left) - 4) / Math.max(1, total)); };
    separator.onpointerup = separator.onpointercancel = separator.onlostpointercapture = () => { drag = null; };
    separator.ondblclick = () => resize(.5);
    separator.onkeydown = event => {
      const { vertical } = bounds(), negative = vertical ? 'ArrowUp' : 'ArrowLeft', positive = vertical ? 'ArrowDown' : 'ArrowRight';
      if (![negative, positive, 'Home'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      resize(event.key === 'Home' ? .5 : displayedRatio + (event.key === positive ? .025 : -.025));
    };
    layout.append(panes.left.element, separator, panes.right.element); host.classList.add('is-comparing'); host.append(layout);
    const activate = event => { const side = event.target.closest('[data-pdf-pane]')?.dataset.pdfPane; if (side) focus(side); };
    for (const event of ['pointerdown', 'focusin', 'wheel']) layout.addEventListener(event, activate, { capture: true, passive: true });
    observer = new ResizeObserver(measure); observer.observe(host);
  };
  const change = async (side, path) => {
    if (!layout) throw new Error('并排阅读已关闭');
    const pane = panes[side], item = documents().find(item => item.path === path && item.file);
    if (!pane || !item) throw new Error('找不到关联 PDF');
    const existingSide = Object.keys(panes).find(key => panes[key].path === path);
    if (existingSide) { focus(existingSide); return panes[existingSide].leaf; }
    await app.paperNotes.flushAll();
    try { return await load(pane, item); } finally { syncHeaders(); }
  };
  const api = {
    get state() { return state(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    open(target, requested) { return run(async () => {
      const docs = app.paperAttachments.documents(target), primary = docs.find(item => item.primary && item.extension === 'pdf' && item.file);
      const supplement = docs.find(item => !item.primary && item.extension === 'pdf' && item.file && (item.path === requested?.path || item.id === requested)) || (!requested && docs.find(item => !item.primary && item.extension === 'pdf' && item.file));
      if (!primary) throw new Error('请先关联可阅读的正文 PDF');
      if (!supplement) throw new Error('请先添加可阅读的附录 PDF');
      if (primary.path === supplement.path) throw new Error('正文与附录指向同一文件');
      await app.paperNotes.flushAll();
      workspace.readingPaperPath = target.file.path;
      if (layout && paper.file.path === target.file.path) return change('right', supplement.path);
      await close();
      let current = workspace.mainLeaf;
      if (![primary.path, supplement.path].includes(current?.view?.filePath) || !loaded(current)) current = await originalOpen(primary.file, false);
      if (!loaded(current)) throw new Error('无法打开正文 PDF');
      const anchor = captureViewport(current.view.reader);
      paper = target; build();
      const side = current.view.filePath === supplement.path ? 'right' : 'left';
      panes[side].leaf = current; panes[side].path = current.view.filePath; panes[side].slot.append(current.element); watchReader(panes[side], anchor);
      const other = side === 'left' ? 'right' : 'left'; panes[other].leaf = workspace.createReaderLeaf(panes[other].slot);
      try { measure(); await load(panes[other], other === 'left' ? primary : supplement); measure(); focus(side); return panes[other].leaf; }
      catch (error) { await close(side); throw error; }
    }); },
    change(side, path) { return run(() => change(side, path)); },
    close(side) { return run(async () => { await app.paperNotes.flushAll(); return close(side); }); },
  };
  app.pdfComparison = api;
  workspace.on('active-leaf-change', leaf => {
    if (!layout || leaf.right) return;
    for (const [side, pane] of Object.entries(panes)) pane.element.classList.toggle('is-active', pane.leaf === leaf);
    publish();
  });
  app.vault.on('modify', file => { if (layout && file.path === paper?.file.path) syncHeaders(); });
  plugin.openPdf = async (file, newLeaf) => {
    if (layout || queued) return run(async () => {
      if (layout && documents().some(item => item.path === file.path)) return change(state().side, file.path);
      await close(); return originalOpen(file, newLeaf);
    });
    return originalOpen(file, newLeaf);
  };
  workspace.back = async (...args) => {
    try { await api.close(); return originalBack(...args); }
    catch (error) { new Notice('尚未关闭阅读工作区：' + error.message); return false; }
  };
  return api;
}
