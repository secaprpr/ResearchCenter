import { parse, stringify } from 'yaml';

export class Events {
  listeners = new Map();
  on(name, handler) { const handlers = this.listeners.get(name) || new Set(); handlers.add(handler); this.listeners.set(name, handlers); return { off: () => handlers.delete(handler) }; }
  offref(ref) { ref?.off?.(); }
  trigger(name, ...args) { for (const handler of this.listeners.get(name) || []) { try { Promise.resolve(handler(...args)).catch(console.error); } catch (error) { console.error(error); } } }
}
export const normalizePath = value => String(value || '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/').replace(/\/$/, '');
export class TFile {
  constructor(path, stat = {}) { this.path = normalizePath(path); this.name = this.path.split('/').pop(); this.extension = this.name.includes('.') ? this.name.split('.').pop() : ''; this.basename = this.name.replace(/\.[^.]+$/, ''); this.stat = { size: stat.size || 0, ctime: stat.ctime || Date.now(), mtime: stat.mtime || Date.now() }; }
}

let db;
async function browserDb() {
  if (db) return db;
  db = await new Promise((resolve, reject) => { const request = indexedDB.open('research-workbench-port', 1); request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'path' }); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  return db;
}
async function fallback(action, payload = {}) {
  const database = await browserDb();
  if (action === 'rename') { const old = await fallback('read-record', payload); await fallback('write', { ...old, path: payload.destination }); await fallback('remove', payload); return; }
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('files', ['list', 'read', 'read-record'].includes(action) ? 'readonly' : 'readwrite');
    const store = transaction.objectStore('files');
    let result;
    if (action === 'list') { const request = store.getAll(); request.onsuccess = () => { result = request.result.map(({path,folder,mtime,ctime,content}) => ({path,folder,mtime,ctime,size:content?.size || 0})); }; }
    else if (action === 'read' || action === 'read-record') { const request = store.get(payload.path); request.onsuccess = () => { result = request.result; }; }
    else if (action === 'remove') store.delete(payload.path);
    else store[action === 'create' ? 'add' : 'put']({ ...payload, folder: action === 'mkdir', content: payload.content instanceof Blob ? payload.content : new Blob([payload.content || '']), mtime: Date.now(), ctime: Date.now() });
    transaction.oncomplete = async () => { try { if (action === 'read') { if (!result) throw new Error('文件不存在：' + payload.path); resolve(payload.binary ? new Uint8Array(await result.content.arrayBuffer()) : await result.content.text()); } else resolve(result); } catch(error) { reject(error); } };
    transaction.onabort = () => reject(transaction.error || new Error('本地存储失败'));
  });
}
export class Vault extends Events {
  files = new Map(); texts = new Map(); resources = new Map(); configDir = '.obsidian';
  constructor(bridge) { super(); this.bridge = bridge; this.adapter = {
    exists: async path => this.files.has(normalizePath(path)),
    read: path => this.read(this.getAbstractFileByPath(path) || {path}),
    readBinary: path => this.readBinary(this.getAbstractFileByPath(path) || {path}),
    write: (path, content) => this.write(path, content), writeBinary: (path, content) => this.write(path, content),
    mkdir: path => this.createFolder(path), remove: path => this.delete(this.getAbstractFileByPath(path)),
    rename: (path, destination) => this.rename(this.getAbstractFileByPath(path), destination),
    list: async prefix => { const children = [...this.files.values()].filter(file => file.path.startsWith(prefix + '/') && !file.path.slice(prefix.length + 1).includes('/')); return { files: children.filter(file => file instanceof TFile).map(file => file.path), folders: children.filter(file => !(file instanceof TFile)).map(file => file.path) }; },
    getResourcePath: path => this.getResourcePath(this.getAbstractFileByPath(path) || {path}),
    stat: async path => this.getAbstractFileByPath(path)?.stat || null,
  }; }
  async call(action, payload) { return this.bridge ? this.bridge.researchFiles(action, payload) : fallback(action, payload); }
  async init() {
    this.files.clear(); this.texts.clear();
    for (const entry of await this.call('list')) this.files.set(entry.path, entry.folder ? { path: entry.path, name: entry.path.split('/').pop(), children: [] } : new TFile(entry.path, entry));
    for (const file of this.getFiles()) {
      if (file.extension === 'md') await this.read(file);
      if (/^(png|jpe?g|webp|gif|svg)$/i.test(file.extension)) await this.cacheResource(file);
    }
    this.linkParents();
  }
  linkParents(){for(const file of this.files.values())if(!(file instanceof TFile))file.children=[];for(const file of this.files.values()){const parent=this.files.get(file.path.split('/').slice(0,-1).join('/'));if(parent?.children)parent.children.push(file);}}
  getName() { return 'Research Workbench'; }
  getFiles() { return [...this.files.values()].filter(file => file instanceof TFile); }
  getMarkdownFiles() { return this.getFiles().filter(file => file.extension === 'md'); }
  getAbstractFileByPath(path) { return this.files.get(normalizePath(path)) || null; }
  async read(file) { const content = await this.call('read', {path: file.path}); this.texts.set(file.path, content); return content; }
  cachedRead(file) { return this.texts.has(file.path) ? Promise.resolve(this.texts.get(file.path)) : this.read(file); }
  async readBinary(file) { const bytes = await this.call('read', {path:file.path,binary:true}); return new Uint8Array(bytes).buffer; }
  async createFolder(path) { path = normalizePath(path); if (!path || this.files.has(path)) return; await this.call('mkdir',{path}); const folder={path,name:path.split('/').pop(),children:[]};this.files.set(path,folder);return folder; }
  async write(path, content, create = false) {
    path = normalizePath(path);
    const parts=path.split('/');parts.pop();let parent='';for(const part of parts){parent=parent?parent+'/'+part:part;await this.createFolder(parent);}
    const existed=this.files.has(path);
    await this.call(create?'create':'write',{path,content:typeof content==='string'?content:new Uint8Array(content)});
    const file = this.files.get(path) || new TFile(path);file.stat.mtime=Date.now();file.stat.size=typeof content==='string'?new Blob([content]).size:content.byteLength;this.files.set(path,file);
    if(typeof content==='string')this.texts.set(path,content);
    if(/^(png|jpe?g|webp|gif|svg)$/i.test(file.extension))await this.cacheResource(file);
    this.linkParents();this.trigger(existed?'modify':'create',file);this.metadataCache?.trigger('changed',file);
    return file;
  }
  create(path, content) { return this.write(path,content,true); }
  createBinary(path, content) { return this.write(path,content,true); }
  modify(file, content) { return this.write(file.path,content); }
  modifyBinary(file, content) { return this.write(file.path,content); }
  async delete(file, recursive=false) { if(!file)throw new Error('文件不存在');await this.call('remove',{path:file.path,recursive});this.files.delete(file.path);this.texts.delete(file.path);this.trigger('delete',file); }
  async rename(file,destination) { if(!file)throw new Error('文件不存在');destination=normalizePath(destination);await this.call('rename',{path:file.path,destination});const old=file.path;this.files.delete(old);Object.assign(file,new TFile(destination,file.stat));this.files.set(destination,file);if(this.texts.has(old)){this.texts.set(destination,this.texts.get(old));this.texts.delete(old);}this.trigger('rename',file,old);this.metadataCache?.trigger('changed',file); }
  async process(file, callback) { return this.modify(file, callback(await this.read(file))); }
  getResourcePath(file) { return this.resources.get(file?.path) || ''; }
  async cacheResource(file) { const old=this.resources.get(file.path);if(old)URL.revokeObjectURL(old);const types={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',svg:'image/svg+xml'};this.resources.set(file.path,URL.createObjectURL(new Blob([await this.readBinary(file)],{type:types[file.extension]||'application/octet-stream'}))); }
}
export function frontmatter(text='') { const match=text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);if(!match)return {};try{return parse(match[1])||{};}catch{return {};} }
export function createMetadata(vault) {
  const cache=new Events();vault.metadataCache=cache;
  cache.getFileCache=file=>({frontmatter:frontmatter(vault.texts.get(file.path)||'')});
  cache.getFirstLinkpathDest=(value,source='')=>{value=normalizePath(String(value).replace(/^!?\[\[|\]\]$/g,'').split('|')[0].split('#')[0]);return vault.getAbstractFileByPath(value)||vault.getAbstractFileByPath(value+'.md')||vault.getFiles().find(file=>file.basename===value||file.name===value||file.path.endsWith('/'+value))||vault.getAbstractFileByPath(source.split('/').slice(0,-1).concat(value).join('/'));};
  cache.fileToLinktext=file=>file.path;
  return cache;
}
const frontMatterUpdates = new WeakMap();
export function processMarkdownFile(vault, file, transform) {
  if (!frontMatterUpdates.has(vault)) frontMatterUpdates.set(vault, new Map());
  const updates = frontMatterUpdates.get(vault);
  // Read inside the queue so background parsing cannot restore an older copy
  // over a user edit to tags, reading state or another frontmatter field.
  const task = (updates.get(file.path) || Promise.resolve()).catch(() => {}).then(async () => {
    const text = await vault.read(file);
    await vault.modify(file, transform(text));
  });
  updates.set(file.path, task);
  return task.finally(() => { if (updates.get(file.path) === task) updates.delete(file.path); });
}
export const markdownBody = text => text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
export function processFrontMatter(vault, file, callback) {
  return processMarkdownFile(vault, file, text => {
    const fm = frontmatter(text); callback(fm);
    return '---\n' + stringify(fm) + '---\n' + markdownBody(text);
  });
}
export function saveMarkdownBody(vault, file, body, expected) {
  return processMarkdownFile(vault, file, text => {
    if (expected !== undefined && markdownBody(text) !== expected && markdownBody(text) !== body) throw new Error('正文已在其他位置修改。当前草稿已保留，请导出后重新打开。');
    return (text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] || '') + body;
  });
}
