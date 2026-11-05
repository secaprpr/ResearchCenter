import TodayPlugin, { normalizeData } from './vendor/runtime.js';
import { Modal, Notice, setIcon } from './obsidian.js';
import '../fonts.css';
import './vendor/styles.css';
import './theme.css';

const main = document.querySelector('#today-host-main');
const status = document.querySelector('#today-status');
const retry = document.querySelector('#today-host-retry');
const backButton = document.querySelector('#today-host-back');
const navigationButton = document.querySelector('#today-host-navigation');
const pending = new Map();
const workspaceLeaves = [];
const viewFactories = new Map();
const targetOrigin = location.protocol === 'file:' ? '*' : location.origin;
let token = '', plugin = null, context = {}, initializing = false, queuedUpdate = null;
let hostActive = true;
let saveTail = Promise.resolve(), localRevision = 0, acknowledgedRevision = 0;
let savedProjection = null;

const clone = value => structuredClone(value);
const post = (type, detail = {}) => parent.postMessage({ type, ...detail, ...(token ? { token } : {}) }, targetOrigin);
function message(text, error = false) {
  status.textContent = text;
  status.classList.toggle('is-error', error);
  retry.hidden = !error;
}
function request(type, data, detail = {}) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('任务保存未收到确认，请重试。'));
    }, 15000);
    pending.set(requestId, { resolve, reject, timeout });
    post(type, { data: clone(data), requestId, ...detail });
  });
}

function save(data) {
  const snapshot = clone(data), revision = ++localRevision;
  const operation = saveTail.catch(() => {}).then(async () => {
    message('正在保存…');
    try {
      const reply = await request('rw-today-save', snapshot, { base: clone(savedProjection || snapshot) });
      acknowledgedRevision = revision;
      savedProjection = clone(snapshot);
      if (revision === localRevision) {
        message('已保存到当前工作台');
        if (reply.data && JSON.stringify(snapshot) === JSON.stringify(plugin?.data)) {
          queuedUpdate = null;
          reconcile(reply.data);
        }
      }
    } catch (error) {
      message(error.message || '任务保存失败，修改保留在当前会话。', true);
      throw error;
    }
  });
  saveTail = operation;
  operation.finally(() => { if (acknowledgedRevision === localRevision) applyQueued(); }).catch(() => {});
  return operation;
}

function records() { return Array.isArray(context.records) ? context.records : []; }
function fileFor(raw) {
  const value = String(raw || '').replace(/^!?\[\[|\]\]$/g, '').split('|')[0].split('#')[0];
  const record = records().find(item => item.id === value || item.path === value || `workbench/${item.id}.md` === value || item.title === value || `${item.title}.md` === value);
  return record ? { ...record, path: record.path || `workbench/${record.id}.md`, basename: record.title, extension: 'md' } : null;
}
function openRecord(raw) {
  const file = typeof raw === 'object' ? raw : fileFor(raw);
  if (!file?.id) { new Notice('没有找到关联的工作台记录。'); return; }
  post('rw-today-open-record', { id: file.id });
}

function makeApp(initial) {
  const app = {
    settingTabs: [], commands: { commands: new Map() }, plugins: { plugins: {} },
    todayLoad: async () => clone(initial), todaySave: save,
    todayPrompt: (label, initialValue = '') => new Promise(resolve => {
      const modal = new Modal(app), previousFocus = document.activeElement;
      const promptLabel = String(label).includes('Obsidian') ? '工作台记录标题或路径' : label;
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        resolve(value);
        modal.close();
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll:true });
      };
      modal.setTitle(promptLabel);
      modal.modalEl.setAttribute('role','dialog');
      modal.modalEl.setAttribute('aria-modal','true');
      modal.modalEl.classList.add('today-host-prompt-dialog');
      modal.onOpen = () => {
        const form = modal.contentEl.createEl('form', { cls:'today-host-prompt-form' });
        const input = form.createEl('input', { attr:{ type:'text', 'aria-label':'输入内容' }, cls:'today-host-prompt-input' });
        input.value = String(initialValue ?? '');
        const actions = form.createDiv({cls:'today-host-prompt-actions'});
        const cancel = actions.createEl('button',{text:'取消',attr:{type:'button'}});
        const confirm = actions.createEl('button',{text:'确定',cls:'mod-cta',attr:{type:'submit'}});
        const update = () => { confirm.disabled = !input.value.trim(); };
        input.addEventListener('input',update); update();
        cancel.onclick = () => finish(null);
        form.onsubmit = event => { event.preventDefault(); if (input.value.trim()) finish(input.value); };
        modal.modalEl.addEventListener('keydown',event => {
          if (event.key !== 'Tab') return;
          const controls = [...modal.modalEl.querySelectorAll('input,button:not(:disabled)')];
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        });
        requestAnimationFrame(() => { input.focus(); input.select(); });
      };
      modal.onClose = () => { if (!settled) { settled = true; resolve(null); } };
      modal.open();
    }),
    vault: {
      getAbstractFileByPath: fileFor,
      getMarkdownFiles: () => records().map(record => fileFor(record.id)).filter(Boolean),
      read: async file => records().find(record => record.id === file.id)?.content || '',
    },
    metadataCache: { getFirstLinkpathDest: fileFor },
  };
  const listeners = new Map();
  const workspace = app.workspace = {
    rootSplit: {}, rightSplit: {}, activeLeaf: null,
    factories: viewFactories,
    getLeavesOfType: type => workspaceLeaves.filter(leaf => leaf.view?.getViewType() === type),
    getRightLeaf: () => workspaceLeaves.find(leaf => leaf.right) || createLeaf(true),
    getLeaf: () => workspaceLeaves.find(leaf => !leaf.right) || createLeaf(false),
    // The native host mounts one center leaf explicitly below. Obsidian's
    // automatic layout callback would concurrently mount a second center.
    onLayoutReady: () => {},
    revealLeaf: leaf => { workspace.activeLeaf = leaf; },
    openLinkText: openRecord,
    getActiveFile: () => null,
    on(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
      return { off: () => listeners.get(name)?.delete(callback) };
    },
    trigger: (name, ...args) => { for (const callback of listeners.get(name) || []) callback(...args); },
    async detachLeavesOfType(type) {
      for (const leaf of [...workspaceLeaves]) if (leaf.view?.getViewType() === type) await leaf.detach();
    },
  };
  function createLeaf(right) {
    const element = document.createElement('div');
    element.className = right ? 'today-host-right-leaf' : 'today-host-center-leaf';
    document.querySelector(right ? '#today-host-sidebar' : '#today-host-main').append(element);
    const leaf = {
      app, element, right, parent: right ? workspace.rightSplit : workspace.rootSplit, view: null,
      getRoot() { return this.parent; },
      getViewState() { return { type: this.view?.getViewType() }; },
      openFile: openRecord,
      async setViewState({ type, state }) {
        await this.view?.onClose?.();
        this.view?.unload?.();
        element.replaceChildren();
        const factory = viewFactories.get(type);
        if (!factory) throw new Error('无法打开任务视图：' + type);
        this.view = factory(this);
        await this.view.onOpen?.();
        await this.view.setState?.(state || {}, {});
        workspace.revealLeaf(this);
      },
      async detach() {
        await this.view?.onClose?.();
        this.view?.unload?.();
        element.remove();
        const index = workspaceLeaves.indexOf(this);
        if (index >= 0) workspaceLeaves.splice(index, 1);
      },
    };
    workspaceLeaves.push(leaf);
    return leaf;
  }
  return app;
}

function reconcile(raw) {
  if (!plugin || !raw || typeof raw !== 'object') return;
  const data = normalizeData(clone(raw));
  if (JSON.stringify(plugin.data) === JSON.stringify(data)) {
    savedProjection = clone(plugin.data);
    post('rw-today-applied', { data: clone(plugin.data) });
    return;
  }
  for (const key of ['tasks', 'lists', 'folders']) {
    const previous = new Map((plugin.data[key] || []).map(item => [item.id, item]));
    data[key] = data[key].map(item => {
      const old = previous.get(item.id);
      if (!old) return item;
      for (const property of Object.keys(old)) if (!(property in item)) delete old[property];
      return Object.assign(old, item);
    });
  }
  if (plugin.data.settings && data.settings) {
    if (plugin.data.settings.taskCenterDisplay && data.settings.taskCenterDisplay) {
      Object.assign(plugin.data.settings.taskCenterDisplay, data.settings.taskCenterDisplay);
      data.settings.taskCenterDisplay = plugin.data.settings.taskCenterDisplay;
    }
    for (const key of Object.keys(plugin.data.settings)) if (!(key in data.settings)) delete plugin.data.settings[key];
    Object.assign(plugin.data.settings, data.settings);
    data.settings = plugin.data.settings;
  }
  for (const key of Object.keys(plugin.data)) if (!(key in data)) delete plugin.data[key];
  Object.assign(plugin.data, data);
  if (plugin.store) plugin.store.data = plugin.data;
  savedProjection = clone(plugin.data);
  for (const listener of plugin.store?.listeners || []) listener();
  post('rw-today-applied', { data: clone(plugin.data) });
}
function editing() {
  return hostActive && document.hasFocus() && document.activeElement?.matches('input, textarea, [contenteditable="true"]');
}
function applyQueued() {
  if (!queuedUpdate || !plugin || initializing || acknowledgedRevision !== localRevision || editing()) return;
  const next = queuedUpdate;
  queuedUpdate = null;
  reconcile(next.data);
}

async function initialize(event) {
  if (initializing) return;
  if (plugin) { context = event.context || context; queuedUpdate = event; applyQueued(); return; }
  token = event.token;
  context = event.context || {};
  savedProjection = normalizeData(clone(event.data));
  initializing = true;
  try {
    const app = makeApp(event.data);
    plugin = new TodayPlugin(app, { id: 'obsidian-today' });
    app.plugins.plugins['obsidian-today'] = plugin;
    window.app = app;
    window.__researchToday = { app, plugin };
    await plugin.onload();
    await app.workspace.getLeaf().setViewState({ type: 'obsidian-today-center', active: true });
    plugin.centerModal = app.workspace.getLeaf().view;
    for (const button of document.querySelectorAll('.today-host-actions button')) button.disabled = false;
    if (acknowledgedRevision === localRevision) message('任务与当前工作台同步');
    post('rw-today-loaded');
  } catch (error) {
    console.error('[Today host]', error);
    plugin?.onunload?.();
    plugin = null;
    main.replaceChildren();
    workspaceLeaves.splice(0);
    message(error.message || '任务中心加载失败，请重试。', true);
  } finally { initializing = false; applyQueued(); }
}

window.addEventListener('message', event => {
  if (event.source !== parent || (location.protocol !== 'file:' && event.origin !== location.origin)) return;
  const value = event.data;
  if (!value || typeof value !== 'object') return;
  if (value.type === 'rw-today-init' && typeof value.token === 'string' && value.token && value.data && typeof value.data === 'object') {
    if (token && token !== value.token) return;
    void initialize(value);
  } else if (!token || value.token !== token) return;
  else if (value.type === 'rw-today-saved') {
    const entry = pending.get(value.requestId);
    if (!entry) return;
    pending.delete(value.requestId);
    clearTimeout(entry.timeout);
    if (value.ok) entry.resolve(value); else entry.reject(new Error(value.error || '任务保存失败，请重试。'));
  } else if (value.type === 'rw-today-update') {
    context = value.context || context;
    queuedUpdate = value;
    applyQueued();
  } else if (value.type === 'rw-today-visibility') {
    hostActive = !!value.active;
    if (!hostActive) {
      void plugin?.centerModal?.inlineTaskDetail?.flushLocalChanges?.(false);
      void plugin?.taskDetailModal?.flushLocalChanges?.(false);
      plugin?.taskContextMenuController?.close();
      plugin?.centerModal?.closeQuickTaskPropertyHelper?.();
      plugin?.centerModal?.closeDisplayMenu?.();
      plugin?.centerModal?.closeViewOptionsMenu?.();
    }
    applyQueued();
  } else if (value.type === 'rw-today-export') exportData();
});
document.addEventListener('focusout', () => setTimeout(applyQueued, 0));
window.addEventListener('blur', () => setTimeout(applyQueued, 0));

function exportData() {
  if (!plugin) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(plugin.data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `research-workbench-tasks-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.querySelector('#today-host-export').onclick = exportData;
document.querySelector('#today-host-import').onclick = () => document.querySelector('#today-host-input').click();
document.querySelector('#today-host-input').onchange = async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || !plugin) return;
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('任务文件超过 20 MB，请检查文件。');
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.tasks) || !Array.isArray(data.lists)) throw new Error('请选择 Today Sidebar 导出的任务 JSON 文件。');
    await plugin.centerModal?.inlineTaskDetail?.flushLocalChanges?.(false);
    await plugin.taskDetailModal?.flushLocalChanges?.(false);
    await saveTail;
    message('正在导入任务…');
    const reply = await request('rw-today-import', data);
    if (reply.data) { queuedUpdate = null; reconcile(reply.data); }
    message('任务已导入当前工作台');
  } catch (error) { message(error.message || '任务导入失败。', true); new Notice(error.message || '任务导入失败。'); }
};
document.querySelector('#today-host-settings').onclick = () => {
  if (!plugin?.app.settingTabs.length) return;
  const modal = new Modal(plugin.app);
  modal.setTitle('任务设置');
  modal.onOpen = () => {
    const tab = plugin.app.settingTabs[0];
    modal.contentEl.append(tab.containerEl);
    tab.display();
    tab.containerEl.querySelector('h2')?.remove();
    for (const item of tab.containerEl.querySelectorAll('.setting-item')) {
      const name = item.querySelector('.setting-item-name')?.textContent;
      if (['任务中心宽度','任务中心高度','恢复推荐尺寸'].includes(name)) item.remove();
      else if (name === '任务中心界面缩放') item.classList.add('today-host-desktop-setting');
    }
    for (const description of tab.containerEl.querySelectorAll('.setting-item-description')) description.textContent = description.textContent.replace('右侧 Content', '任务详情');
  };
  modal.open();
};
backButton.onclick = () => plugin?.centerModal?.clearCenterTask();
function toggleNavigation(open) {
  document.body.classList.toggle('today-host-nav-open', open);
  navigationButton.setAttribute('aria-expanded', String(open));
}
navigationButton.onclick = () => toggleNavigation(navigationButton.getAttribute('aria-expanded') !== 'true');
main.addEventListener('click', event => { if (event.target.closest('.today-center-side-item,.today-center-tag-item')) toggleNavigation(false); });
new MutationObserver(() => {
  backButton.hidden = !main.querySelector('.today-center-detail-pane:not(.is-empty)');
  for (const title of main.querySelectorAll('.today-center-list-title,.today-center-tag-title,.today-center-calendar-title,.today-center-stats-title')) {
    if (title.tagName === 'H1') continue;
    const heading = document.createElement('h1');
    for (const attribute of title.attributes) heading.setAttribute(attribute.name, attribute.value);
    heading.append(...title.childNodes);
    title.replaceWith(heading);
  }
  // These totals sum scheduled date/time ranges; no running timer is involved.
  for (const label of main.querySelectorAll('.today-center-summary-label')) if (label.textContent === '记录投入') label.textContent = '计划时长';
  for (const label of main.querySelectorAll('.today-center-stats-box-title')) if (label.textContent === '标签投入') label.textContent = '标签计划时长';
}).observe(main, { childList:true, subtree:true, attributes:true, attributeFilter:['class'] });
retry.onclick = () => {
  if (plugin && localRevision !== acknowledgedRevision) void plugin.saveData(plugin.data);
  else { message('正在重新连接…'); post('rw-today-ready'); }
};
for (const [id, icon] of [['today-host-import', 'upload'], ['today-host-export', 'download'], ['today-host-settings', 'settings'], ['today-host-back','arrow-left'], ['today-host-navigation','panel-left']]) {
  const button = document.getElementById(id), label = button.textContent;
  const element = document.createElement('span'); setIcon(element, icon);
  const text = document.createElement('span');
  text.className = 'today-host-action-label';
  text.textContent = label;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.replaceChildren(element, text);
}
window.addEventListener('error', event => { message('任务中心遇到问题，请重试。', true); console.error('[Today host]', event.error); });
window.addEventListener('unhandledrejection', event => { message(event.reason?.message || '任务操作失败，请重试。', true); });
post('rw-today-ready');
