import { Modal, Notice, setIcon } from './obsidian.js';
import { mountReaderActivity } from './ReadingActivityView.jsx';

// Adapt the host chrome while retaining the original reader's buttons, handlers
// and PDF coordinate layers. Do not change the imported rendering engine.
export function installReaderUI(app) {
  // The host uses leaf roots instead of Obsidian's .workspace-split DOM classes.
  const plugin = app.plugins.plugins['mupdf-reader-mvp'];
  if (plugin) plugin.isPrimaryWorkspaceLeaf = leaf => leaf?.getRoot?.() === app.workspace.rootSplit;
  if (plugin) plugin.openTranslationSettings = () => {
    const tab = app.settingTabs.find(item => item.plugin === plugin);
    if (!tab) return;
    const modal = new Modal(app); modal.setTitle('翻译设置');
    tab.containerEl = modal.contentEl.createDiv({ cls: 'port-settings-group' });
    tab.display(); modal.open();
    const heading = [...tab.containerEl.querySelectorAll('h3')].find(el => el.textContent === '划词翻译');
    heading?.scrollIntoView({ block: 'start' });
  };
  const back = app.workspace.back.bind(app.workspace);
  app.workspace.back = async (...args) => {
    if (!plugin?.settings?.translationPanelPinned) await plugin?.translationPanel?.close({ preservePin: true });
    return back(...args);
  };
  for (const type of ['mupdf-reader-view', 'mupdf-reader-research-sidebar']) {
    const factory = app.workspace.factories.get(type);
    if (!factory || factory.workbenchUI) continue;
    const wrapped = leaf => {
      const view = factory(leaf);
      if (type === 'mupdf-reader-research-sidebar') {
        const render = view.render.bind(view);
        view.render = () => {
          render();
          const head = view.contentEl.querySelector('.mupdf-research-head-row');
          view.contentEl.querySelector('.mupdf-research-title').textContent = 'PDF 批注';
          const file = head.querySelector('.mupdf-research-file');
          if (file) head.after(file);
          const actions = head.createDiv({ cls: 'rw-reader-panel-actions' });
          const pin = head.querySelector('.mupdf-research-pin-toggle');
          pin.setAttribute('aria-pressed', String(Boolean(view.plugin.settings?.researchSidebarPinned)));
          actions.append(pin);
          const close = actions.createEl('button', { cls: 'rw-reader-close', attr: { 'aria-label': '收起 PDF 批注', title: '收起 PDF 批注' } });
          setIcon(close, 'x');
          close.onclick = () => leaf.detach();
          view.contentEl.querySelector('.mupdf-research-filter')?.setAttribute('aria-label', '筛选阅读批注');
        };
      } else {
        const load = view.loadFile.bind(view);
        const close = view.onClose.bind(view);
        let cleanup;
        view.loadFile = async () => {
          await cleanup?.(); await load();
          const decorate = decorateReader(view.reader, app);
          const stop = app.readingActivity?.attach(view.reader);
          let unmount;
          if (stop) {
            const host = document.createElement('span'); host.className = 'rw-reader-activity-host';
            document.querySelector('.port-reader-reading-state').before(host);
            const syncActive = () => { host.hidden = app.workspace.mainLeaf !== leaf; };
            const activeRef = app.workspace.on('active-leaf-change', syncActive); syncActive();
            unmount = mountReaderActivity(host, { activity: app.readingActivity, reader: view.reader, plugin: view.plugin });
            const remove = unmount; unmount = () => { activeRef.off(); remove(); host.remove(); };
          }
          cleanup = async () => { decorate?.(); unmount?.(); await stop?.(); };
        };
        view.onClose = async () => { await cleanup?.(); await close(); };
      }
      return view;
    };
    wrapped.workbenchUI = true;
    app.workspace.factories.set(type, wrapped);
  }
}

function decorateReader(reader, app) {
  const toolbar = reader?.root?.querySelector('.mupdf-reader-toolbar');
  if (!toolbar || toolbar.dataset.workbench) return;
  toolbar.dataset.workbench = 'true';
  toolbar.setAttribute('aria-label', 'PDF 阅读工具');
  const find = label => toolbar.querySelector(`button[aria-label="${label}"]`);
  const navigation = document.createElement('div');
  navigation.className = 'rw-reader-navigation';
  navigation.setAttribute('role', 'group'); navigation.setAttribute('aria-label', '翻页与缩放');
  const controls = document.createElement('div'); controls.className = 'rw-reader-toolbar-scroll';
  const tools = document.createElement('div'); tools.className = 'rw-reader-view-tools';
  const markup = document.createElement('div'); markup.className = 'rw-reader-markup';
  markup.setAttribute('role', 'group'); markup.setAttribute('aria-label', '高亮、批注与截图摘录');
  const page = toolbar.querySelector('.mupdf-reader-page-box');
  const sidebarButton = find('打开研究侧栏');
  const sidebar = document.querySelector('#reader-sidebar');
  let togglingSidebar = false;
  const syncSidebar = () => {
    const expanded = !sidebar.hidden;
    sidebarButton.setAttribute('aria-expanded', String(expanded));
    sidebarButton.setAttribute('aria-controls', 'reader-sidebar');
    sidebarButton.setAttribute('aria-label', expanded ? '收起研究侧栏' : '打开研究侧栏');
    sidebarButton.title = expanded ? '收起 PDF 批注' : 'PDF 批注与目录';
    sidebarButton.classList.toggle('is-active', expanded);
    setIcon(sidebarButton, expanded ? 'panel-right-close' : 'panel-right-open');
  };
  const toggleSidebar = async event => {
    event.preventDefault(); event.stopImmediatePropagation();
    if (togglingSidebar) return;
    togglingSidebar = true; sidebarButton.disabled = true;
    try {
      if (app.workspace.mainLeaf !== reader.view?.leaf) app.workspace.revealLeaf(reader.view.leaf);
      if (!document.querySelector('#paper-notes-pane')?.hidden) {
        const closed = await app.togglePaperNotes?.(reader.file);
        if (closed === false) return;
      }
      const leaves = app.workspace.getLeavesOfType('mupdf-reader-research-sidebar');
      if (!sidebar.hidden && leaves.length) { for (const leaf of leaves) await leaf.detach(); }
      else {
        const plugin = app.plugins.plugins['mupdf-reader-mvp'];
        await plugin.openResearchSidebar(plugin.researchSidebarState?.tab || 'annotations');
      }
    } catch (error) { new Notice(error.message || String(error)); }
    finally { togglingSidebar = false; sidebarButton.disabled = false; syncSidebar(); }
  };
  sidebarButton.addEventListener('click', toggleSidebar, true);
  const sidebarObserver = new MutationObserver(syncSidebar);
  sidebarObserver.observe(sidebar, { attributes: true, attributeFilter: ['hidden'] });
  syncSidebar();
  setIcon(find('适合宽度'), 'maximize');
  navigation.append(find('上一页'), page, find('下一页'), toolbar.querySelector('.mupdf-reader-zoom-controls'), find('适合宽度'));
  const notesButton = document.createElement('button'); notesButton.className = 'mupdf-reader-btn'; notesButton.setAttribute('aria-label', '打开研究笔记'); notesButton.title = '研究笔记'; setIcon(notesButton, 'notebook-pen');
  notesButton.onclick = () => void app.togglePaperNotes?.(reader.file).catch(error => new Notice(error.message));
  const notesPane = document.querySelector('#paper-notes-pane');
  const syncNotes = () => { const open = notesPane && !notesPane.hidden; notesButton.setAttribute('aria-expanded', String(Boolean(open))); notesButton.setAttribute('aria-label', open ? '收起研究笔记' : '打开研究笔记'); notesButton.classList.toggle('is-active', Boolean(open)); };
  const notesObserver = new MutationObserver(syncNotes); if (notesPane) notesObserver.observe(notesPane, { attributes: true, attributeFilter: ['hidden'] }); syncNotes();
  tools.append(toolbar.querySelector('.mupdf-reader-note-display-btn'), toolbar.querySelector('.mupdf-reader-translate-btn'), notesButton, sidebarButton);
  markup.append(reader.selectionActions, reader.notePlacementButton, reader.regionCaptureButton);
  const stopNoteLinks = app.notePdfLinks?.attachReader(reader);
  toolbar.querySelector('.mupdf-reader-toolbar-spacer')?.remove();
  controls.append(navigation, markup);
  toolbar.append(controls, tools);
  markup.append(reader.statusEl);
  const sync = () => {
    const noSelection = reader.selectionActions.classList.contains('is-hidden');
    for (const button of reader.selectionActions.querySelectorAll('button')) {
      // Palette is useful before making a selection, too.
      button.disabled = noSelection && button !== reader.colorButton;
    }
    const note = reader.root.classList.contains('is-note-placement-mode');
    const region = reader.root.classList.contains('is-region-capture-mode');
    reader.notePlacementButton.setAttribute('aria-pressed', String(note));
    reader.regionCaptureButton.setAttribute('aria-pressed', String(region));
  };
  const observer = new MutationObserver(sync);
  observer.observe(reader.root, { attributes: true, attributeFilter: ['class'] });
  observer.observe(reader.selectionActions, { attributes: true, attributeFilter: ['class'] });
  sync();
  app.plugins.plugins['mupdf-reader-mvp']?.translationPanel?.syncReaderButton();
  return () => { stopNoteLinks?.(); observer.disconnect(); notesObserver.disconnect(); sidebarObserver.disconnect(); sidebarButton.removeEventListener('click', toggleSidebar, true); };
}
