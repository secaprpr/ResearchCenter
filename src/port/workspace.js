import { Events, processFrontMatter, createMetadata } from './vault.js';
import { Notice } from './obsidian.js';

export function makeApp(vault) {
  const app={vault,metadataCache:createMetadata(vault),settingTabs:[],commands:{commands:new Map(),executeCommandById(id){return this.commands.get(id)?.callback?.();}},plugins:{plugins:{}},nextRootModal:false};
  const workspace=new Events();app.workspace=workspace;
  workspace.factories=new Map();workspace.leaves=[];workspace.rootSplit={};workspace.rightSplit={};workspace.activeLeaf=null;
  workspace.getLeavesOfType=type=>workspace.leaves.filter(leaf=>leaf.view?.getViewType?.()===type);
  workspace.getActiveFile=()=>vault.getAbstractFileByPath(workspace.mainLeaf?.view?.filePath||'');
  workspace.getMostRecentLeaf=()=>workspace.mainLeaf;
  workspace.getActiveViewOfType=type=>workspace.mainLeaf?.view instanceof type?workspace.mainLeaf.view:null;
  workspace.getLeaf=()=>workspace.mainLeaf||(workspace.mainLeaf=createLeaf(false));
  workspace.createReaderLeaf=container=>createLeaf(false,container);
  workspace.getRightLeaf=()=>workspace.leaves.find(leaf=>leaf.right)||createLeaf(true);
  workspace.revealLeaf=leaf=>{workspace.activeLeaf=leaf;if(!leaf.right){workspace.mainLeaf=leaf;app.readingActivity?.activate(leaf.view?.reader);document.querySelector('#library-root').hidden=true;document.querySelector('#reader-workspace').hidden=false;}workspace.trigger('active-leaf-change',leaf);};
  workspace.detachLeavesOfType=type=>{for(const leaf of [...workspace.leaves])if(leaf.view?.getViewType?.()===type)leaf.detach();};
  workspace.onLayoutReady=callback=>queueMicrotask(callback);
  workspace.openLinkText=async(raw,source='')=>{const value=String(raw).replace(/^!?\[\[|\]\]$/g,'').split('|')[0];const file=app.metadataCache.getFirstLinkpathDest(value.split('#')[0],source);if(!file){new Notice('找不到文件：'+value);return;}if(file.extension==='md'&&app.openResearchNote)return app.openResearchNote(file);await workspace.getLeaf().openFile(file);};
  workspace.back=async()=>{for(const leaf of [...workspace.leaves])await leaf.detach();workspace.mainLeaf=null;document.querySelector('#reader-workspace').hidden=true;document.querySelector('#library-root').hidden=false;};
  function createLeaf(right,container){const element=document.createElement('div');element.className=right?'port-sidebar-leaf':'port-main-leaf';(container||document.querySelector(right?'#reader-sidebar':'#reader-main')).append(element);const leaf={app,element,right,parent:right?workspace.rightSplit:workspace.rootSplit,view:null,getRoot(){return this.parent;},getViewState(){return{type:this.view?.getViewType?.()};},async setViewState({type,state}){await this.view?.onClose?.();this.view?.unload?.();element.replaceChildren();const factory=workspace.factories.get(type);if(!factory)throw new Error('不支持的工作区：'+type);this.view=factory(this);await this.view.onOpen?.();await this.view.setState?.(state||{},{});workspace.revealLeaf(this);},async openFile(file){if(file.extension==='md'&&app.openResearchNote)return app.openResearchNote(file);if(file.extension==='pdf')return app.plugins.plugins['mupdf-reader-mvp'].openPdf(file,false);if(file.extension==='md'){await workspace.back();const {Modal}=await import('./obsidian.js');const modal=new Modal(app);modal.setTitle(file.basename);const editor=modal.contentEl.createEl('textarea',{cls:'port-note-editor'});editor.value=await vault.read(file);const save=modal.contentEl.createEl('button',{text:'保存笔记',cls:'mod-cta'});save.onclick=async()=>{await vault.modify(file,editor.value);modal.close();};modal.open();}else{const url=vault.getResourcePath(file);if(url){const {Modal}=await import('./obsidian.js');const modal=new Modal(app);modal.contentEl.createEl('img',{attr:{src:url},cls:'port-image'});modal.open();}}},async detach(){await this.view?.onClose?.();this.view?.unload?.();element.remove();workspace.leaves=workspace.leaves.filter(item=>item!==this);if(right)document.querySelector('#reader-sidebar').hidden=true;}};workspace.leaves.push(leaf);if(right)document.querySelector('#reader-sidebar').hidden=false;return leaf;}
  app.fileManager={processFrontMatter:(file,callback)=>processFrontMatter(vault,file,callback),renameFile:(file,path)=>vault.rename(file,path),trashFile:file=>vault.delete(file)};
  return app;
}
