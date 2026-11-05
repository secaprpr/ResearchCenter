import '../components/context-menu.css';
import { createElement, icons } from 'lucide';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { normalizePath, TFile } from './vault.js';
export { normalizePath, TFile };

function makeElement(parent, tag, options={}, callback) {
  if(typeof options==='string')options={cls:options};
  const element=document.createElement(tag);
  if(options.cls)element.className=Array.isArray(options.cls)?options.cls.join(' '):options.cls;
  if(options.text!==undefined)element.textContent=options.text;
  for(const [key,value]of Object.entries(options.attr||{}))element.setAttribute(key,String(value));
  for(const key of ['type','value','placeholder','title','href'])if(options[key]!==undefined)element[key]=options[key];
  if(options.parent)options.parent.appendChild(element);else parent?.appendChild(element);
  callback?.(element);return element;
}
const helpers={
  createEl(tag,options,callback){return makeElement(this,tag,options,callback);},
  createDiv(options,callback){return makeElement(this,'div',options,callback);},
  createSpan(options,callback){return makeElement(this,'span',options,callback);},
  empty(){this.replaceChildren();return this;},setText(text){this.textContent=String(text??'');return this;},
  addClass(...names){for(const name of names.flat())if(name)this.classList.add(...String(name).split(/\s+/));return this;},
  addClasses(names){return this.addClass(...names);},removeClass(...names){this.classList.remove(...names);return this;},
  toggleClass(name,force){this.classList.toggle(name,force);return this;},hasClass(name){return this.classList.contains(name);},
  setAttr(key,value){this.setAttribute(key,String(value));return this;},getAttr(key){return this.getAttribute(key);},
  setAttrs(attrs){for(const[key,value]of Object.entries(attrs))this.setAttribute(key,String(value));return this;},
  setCssProps(props){for(const[key,value]of Object.entries(props))this.style.setProperty(key,value);return this;},
  setCssStyles(styles){Object.assign(this.style,styles);return this;},getText(){return this.textContent||'';},
  hide(){this.style.display='none';},show(){this.style.removeProperty('display');},
  find(selector){return this.querySelector(selector);},findAll(selector){return [...this.querySelectorAll(selector)];},
  onClickEvent(handler){this.addEventListener('click',handler);return this;},
  trigger(event){this.dispatchEvent(new Event(event,{bubbles:true}));},
};
for(const prototype of [HTMLElement.prototype,DocumentFragment.prototype])for(const[name,method]of Object.entries(helpers))if(!prototype[name])Object.defineProperty(prototype,name,{value:method,configurable:true});
if(!Array.prototype.first)Object.defineProperty(Array.prototype,'first',{value(){return this[0];},configurable:true});
if(!Array.prototype.last)Object.defineProperty(Array.prototype,'last',{value(){return this[this.length-1];},configurable:true});
export const createDiv=options=>makeElement(null,'div',options);
export function setIcon(element,name){const key=String(name).replace(/(^|-)([a-z0-9])/g,(_match,_dash,char)=>char.toUpperCase());const icon=icons[key]||icons.FileText;element.replaceChildren(createElement(icon,{width:16,height:16,'stroke-width':1.7}));}
export class Notice{constructor(message,duration=4500){const node=makeElement(document.querySelector('#notices'),'div',{cls:'notice',text:message});window.setTimeout(()=>node.remove(),duration||4500);this.noticeEl=node;}hide(){this.noticeEl.remove();}}
export class Component{
  cleanup=[];register(callback){this.cleanup.push(callback);}registerEvent(ref){this.register(()=>ref?.off?.());}registerDomEvent(element,name,callback,options){element.addEventListener(name,callback,options);this.register(()=>element.removeEventListener(name,callback,options));}registerInterval(id){this.register(()=>clearInterval(id));}load(){}unload(){for(const callback of this.cleanup.splice(0))callback();this.onunload?.();}
}
export class Plugin extends Component{
  constructor(app,manifest){super();this.app=app;this.manifest=manifest;}
  async loadData(){try{return JSON.parse(await this.app.vault.adapter.read(`.obsidian/plugins/${this.manifest.id}/data.json`));}catch{return null;}}
  async saveData(value){await this.app.vault.adapter.write(`.obsidian/plugins/${this.manifest.id}/data.json`,JSON.stringify(value,null,2));}
  addRibbonIcon(){}addCommand(command){this.app.commands.commands.set(command.id,command);}addSettingTab(tab){this.app.settingTabs.push(tab);}registerView(type,factory){this.app.workspace.factories.set(type,factory);}registerObsidianProtocolHandler(){}
}
export class Modal extends Component{
  constructor(app){super();this.app=app;this.containerEl=createDiv({cls:'modal-container'});this.modalEl=this.containerEl.createDiv({cls:'modal'});this.titleEl=this.modalEl.createDiv({cls:'modal-title'});this.contentEl=this.modalEl.createDiv({cls:'modal-content'});this.scope={register:()=>{}};this.keyHandler=event=>{if(event.key==='Escape'&&this.containerEl===document.querySelector('.modal-container:last-of-type'))this.close();};}
  setTitle(value){this.titleEl.setText(value);this.modalEl.setAttribute('aria-label',value);return this;}
  open(){this.root=Boolean(this.app.nextRootModal);this.app.nextRootModal=false;if(this.root){this.containerEl.addClass('embedded-library');document.querySelector('#engine-library-root').append(this.containerEl);}else{document.body.append(this.containerEl);const close=this.modalEl.createEl('button',{cls:'modal-close-button',attr:{'aria-label':'关闭弹窗'}});setIcon(close,'x');close.onclick=()=>this.close();this.containerEl.onmousedown=event=>{if(event.target===this.containerEl)this.close();};window.addEventListener('keydown',this.keyHandler);}this.ready=Promise.resolve(this.onOpen?.()).catch(error=>{console.error(error);new Notice(error.message||String(error),10000);});return this;}
  close(){this.onClose?.();this.unload();this.containerEl.remove();window.removeEventListener('keydown',this.keyHandler);}
}
class Control{
  constructor(element){this.element=element;this.inputEl=element;this.buttonEl=element;this.sliderEl=element;this.toggleEl=element;}
  setValue(value){if(this.element.type==='checkbox')this.element.checked=Boolean(value);else this.element.value=value??'';return this;}
  getValue(){return this.element.type==='checkbox'?this.element.checked:this.element.value;}
  onChange(callback){this.element.addEventListener(this.element.tagName==='INPUT'&&this.element.type!=='checkbox'?'input':'change',()=>callback(this.getValue()));return this;}
  onClick(callback){this.element.addEventListener('click',callback);return this;}
  setPlaceholder(value){this.element.placeholder=value;return this;}setButtonText(value){this.element.textContent=value;return this;}setIcon(name){setIcon(this.element,name);return this;}setTooltip(value){this.element.title=value;return this;}
  setDisabled(value){this.element.disabled=value;return this;}setCta(){this.element.classList.add('mod-cta');return this;}setWarning(){return this;}setDynamicTooltip(){return this;}setLimits(min,max,step){Object.assign(this.element,{min,max,step});return this;}
  addOption(value,label){makeElement(this.element,'option',{text:label,attr:{value}});return this;}addOptions(values){for(const[value,label]of Object.entries(values))this.addOption(value,label);return this;}
}
export class Setting{
  constructor(parent){this.settingEl=parent.createDiv({cls:'setting-item'});const info=this.settingEl.createDiv({cls:'setting-item-info'});this.nameEl=info.createDiv({cls:'setting-item-name'});this.descEl=info.createDiv({cls:'setting-item-description'});this.controlEl=this.settingEl.createDiv({cls:'setting-item-control'});}
  setName(value){this.nameEl.setText(value);return this;}setDesc(value){if(value instanceof Node)this.descEl.append(value);else this.descEl.setText(value);return this;}setHeading(){this.settingEl.addClass('is-heading');return this;}setClass(value){this.settingEl.addClass(value);return this;}
  addControl(tag,type,callback){const element=this.controlEl.createEl(tag,{attr:type?{type}:{}});callback(new Control(element));return this;}
  addText(callback){return this.addControl('input','text',callback);}addTextArea(callback){return this.addControl('textarea',null,callback);}addDropdown(callback){return this.addControl('select',null,callback);}addToggle(callback){return this.addControl('input','checkbox',callback);}addSlider(callback){return this.addControl('input','range',callback);}addButton(callback){return this.addControl('button','button',callback);}addExtraButton(callback){return this.addButton(callback);}
}
export class PluginSettingTab{constructor(app,plugin){this.app=app;this.plugin=plugin;this.containerEl=createDiv();}hide(){} }
export class ItemView extends Component{
  constructor(leaf){super();this.leaf=leaf;this.app=leaf.app;this.containerEl=leaf.element;this.contentEl=this.containerEl.createDiv({cls:'view-content'});}
  async setState(){}getViewType(){return 'view';}
}
export class Menu {
  static active = null;
  constructor({ ignoreScroll } = {}) {
    this.ignoreScroll = ignoreScroll;
    this.root = createDiv({ cls: 'menu workbench-context-menu', attr: { role: 'menu', 'aria-label': '阅读器操作' } });
    this.cleanup = null;
  }
  addItem(callback) {
    const button = this.root.createEl('button', { cls: 'menu-item', attr: { type: 'button', role: 'menuitem' } });
    const icon = button.createSpan({ cls: 'context-menu-icon' });
    const text = button.createSpan({ cls: 'context-menu-label' });
    const item = {
      setTitle(value) { text.setText(value); return item; },
      setIcon(value) { setIcon(icon, value); return item; },
      setDisabled(value) { button.disabled = value; return item; },
      setChecked(value) { button.classList.toggle('is-checked', value); button.setAttribute('role', 'menuitemcheckbox'); button.setAttribute('aria-checked', String(Boolean(value))); return item; },
      onClick: handler => { button.onclick = event => { this.hide(true); Promise.resolve().then(() => handler(event)).catch(error => new Notice(error.message || String(error))); }; return item; },
    };
    callback(item); return this;
  }
  addSeparator() { this.root.createDiv({ cls: 'context-menu-divider', attr: { role: 'separator' } }); return this; }
  showAtMouseEvent(event) {
    this.trigger = event.target.closest('button, [tabindex]') || document.activeElement;
    const rect = this.trigger?.getBoundingClientRect();
    this.showAtPosition({ x: event.clientX || rect?.left || 8, y: event.clientY || rect?.bottom || 8 });
  }
  showAtPosition({ x, y }) {
    Menu.active?.hide();
    document.dispatchEvent(new Event('workbench-close-context-menu'));
    Menu.active = this;
    this.trigger ||= document.activeElement;
    document.body.append(this.root);
    this.root.style.left = Math.max(8, Math.min(x, window.innerWidth - this.root.offsetWidth - 8)) + 'px';
    this.root.style.top = Math.max(8, Math.min(y, window.innerHeight - this.root.offsetHeight - 8)) + 'px';
    const outside = event => { if (!this.root.contains(event.target)) this.hide(); };
    const dismiss = () => this.hide();
    const scroll = event => { if (!this.root.contains(event.target) && !this.ignoreScroll?.(event)) this.hide(); };
    const keyboard = event => {
      event.stopPropagation();
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); this.hide(true); return; }
      const items = [...this.root.querySelectorAll('button:not(:disabled)')];
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const index = items.indexOf(document.activeElement);
        items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    this.root.addEventListener('keydown', keyboard);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', scroll, true);
    document.addEventListener('workbench-close-context-menu', dismiss);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    this.cleanup = () => {
      this.root.removeEventListener('keydown', keyboard);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', scroll, true);
      document.removeEventListener('workbench-close-context-menu', dismiss);
      window.removeEventListener('resize', dismiss); window.removeEventListener('blur', dismiss);
    };
    this.root.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }
  hide(restore = false) {
    this.cleanup?.(); this.cleanup = null; this.root.remove();
    if (Menu.active === this) Menu.active = null;
    if (restore && this.trigger?.isConnected) this.trigger.focus({ preventScroll: true });
  }
}
export const MarkdownRenderer={
  async render(app,markdown,element,source){const prepared=String(markdown||'').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,(_whole,path,label)=>`[${label||path}](research:${encodeURIComponent(path)})`);element.innerHTML=DOMPurify.sanitize(await marked.parse(prepared));element.querySelectorAll('a').forEach(link=>{link.onclick=event=>{event.preventDefault();const url=link.getAttribute('href')||'';if(url.startsWith('research:'))app.workspace.openLinkText(decodeURIComponent(url.slice(9)),source);else if(/^https:\/\//.test(url))window.open(url);};});},
  async renderMarkdown(markdown,element,source,component){return this.render(component.app,markdown,element,source);},
};
export async function requestUrl(options) {
  if (typeof options === 'string') options = { url: options };
  const { signal, ...request } = options;
  signal?.throwIfAborted();
  const bridge = window.parent.rwWindow;
  let onAbort;
  try {
    const pending = bridge?.researchRequest
      ? bridge.researchRequest(request)
      : fetch(request.url, { method: request.method || 'GET', headers: request.headers, body: request.body, signal }).then(async response => ({ status: response.status, text: await response.text(), headers: Object.fromEntries(response.headers) }));
    // AbortSignal cannot cross Electron IPC. Stop the UI wait immediately; the
    // main process retains its existing bounded network timeout.
    const result = signal ? await Promise.race([pending, new Promise((_, reject) => {
      onAbort = () => reject(signal.reason || new DOMException('请求已取消', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    })]) : await pending;
    signal?.throwIfAborted();
    let json; try { json = JSON.parse(result.text); } catch { /* Non-JSON responses are valid. */ }
    if (result.status >= 400 && request.throw !== false) {
      const error = new Error(`HTTP ${result.status}`); error.status = result.status; throw error;
    }
    return { ...result, json, arrayBuffer: new TextEncoder().encode(result.text).buffer };
  } finally { if (onAbort) signal.removeEventListener('abort', onAbort); }
}
export async function loadPdfJs(){const pdf=await import('pdfjs-dist');pdf.GlobalWorkerOptions.workerSrc=new URL('../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).href;return pdf;}
