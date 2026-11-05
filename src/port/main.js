import LibraryPlugin from '../migrated/library.js';
import ReaderPlugin from '../migrated/reader.js';
import { Vault, frontmatter } from './vault.js';
import { makeApp } from './workspace.js';
import { Modal, Notice } from './obsidian.js';
import { stringify } from 'yaml';
import { listPapers, getPdf } from '../library/database';
import { mountLibraryWorkspace } from './LibraryWorkspace.jsx';
import { installReaderUI } from './reader-ui.js';
import { installResearchNotes } from './ResearchNotes.jsx';
import { createMetricsManager } from './metrics.js';
import { createMetadataManager } from './metadata.js';
import { createImportSession, importTarget, IMPORT_ORGANIZATIONS } from './import-session.js';
import { createCollectionTree } from './collection-tree.js';
import { requestUrl } from './obsidian.js';
import { READING_STATES, saveReadingStatus, startReadingOnOpen } from './reading-status.js';
import { mountStatusPicker } from './StatusPicker.jsx';
import { createReadingActivity } from './reading-activity.js';
import { createPaperAttachments } from './paper-attachments.js';
import { installReaderDocuments } from './PaperAttachments.jsx';
import { installPdfComparison } from './pdf-comparison.js';
import { installTopicBridge, publishTopicPapers } from './topic-bridge.js';
import '../migrated/library.css';
import '../migrated/reader.css';
import './theme.css';
import './ui-primitives.css';
import './workspace.css';
import './reader.css';

const bridge=window.parent.rwWindow;
const vault=new Vault(bridge);
const app=makeApp(vault);window.app=app;
const imports=createImportSession();
const collectionTree=createCollectionTree({vault});
const status=document.querySelector('#port-status');
let library,reader, metrics, metadata, activity, generation=0, importing=false;
async function start(){
  await vault.init();
  try { await collectionTree.load(); } catch (error) { new Notice(error.message); }
  activity = createReadingActivity({ vault, onError: error => new Notice('阅读统计保存或加载失败：' + error.message) });
  await activity.load();
  app.readingActivity = activity;
  library=new LibraryPlugin(app,{id:'research-library'});reader=new ReaderPlugin(app,{id:'mupdf-reader-mvp'});
  app.plugins.plugins['research-library']=library;app.plugins.plugins['mupdf-reader-mvp']=reader;
  await library.onload();
  if(!await vault.adapter.exists('.obsidian/plugins/mupdf-reader-mvp/data.json'))await vault.adapter.write('.obsidian/plugins/mupdf-reader-mvp/data.json',JSON.stringify({settings:{translationAutoEnabled:false,openaiStreaming:false}}));
  await reader.onload();
  app.paperAttachments = createPaperAttachments({ vault, folder: () => library.settings.pdfFolder, papers: () => library.currentModal?.papers || [], resolve: (path, source) => app.metadataCache.getFirstLinkpathDest(path, source) });
  installAutomaticReadingStatus();
  installReaderUI(app);
  installResearchNotes(app);
  installPdfComparison(app);
  installReaderDocuments(app);
  // Existing keys and automatic network behavior are intentionally not migrated.
  reader.loadMuPdfRuntimeAssets=async()=>{if(bridge?.researchRuntime){const assets=await bridge.researchRuntime();return{...assets,wasmBinary:new Uint8Array(assets.wasmBinary).buffer};}const base=new URL('mupdf/',document.baseURI);const [moduleSource,wasmLoaderSource,wasmBinary]=await Promise.all([fetch(new URL('mupdf.js',base)).then(response=>response.text()),fetch(new URL('mupdf-wasm.js',base)).then(response=>response.text()),fetch(new URL('mupdf-wasm.wasm',base)).then(response=>response.arrayBuffer())]);return{moduleSource,wasmLoaderSource,wasmBinary};};
  reader.annotationMarkdown=(filePath,annotation)=>{const page=Math.max(1,Number(annotation.page||0)+1);return[annotation.text?'> '+annotation.text.replace(/\s+/g,' '):'',annotation.comment||'',(annotation.tags||[]).map(tag=>'#'+tag).join(' '),`[[${filePath}#page=${page}]] · 标注 ${annotation.id}`].filter(Boolean).join('\n\n');};
  // Bridge PDFs already imported by the first Workbench version; never remove
  // its records or overwrite an existing migrated note.
  for(const paper of await listPapers()){
    const note=`${library.settings.papersFolder}/workbench-${paper.id}.md`;
    if(vault.getAbstractFileByPath(note))continue;
    const pdf=`${library.settings.pdfFolder}/workbench-${paper.id}.pdf`;
    if(!vault.getAbstractFileByPath(pdf))await vault.createBinary(pdf,await(await getPdf(paper.id)).arrayBuffer());
    await vault.create(note,'---\n'+stringify({type:'paper',schema:'paper/v2',title:paper.title,authors:paper.authors?[paper.authors]:[],year:paper.year,venue:paper.venue,status:{unread:'inbox',reading:'reading',skimmed:'skimmed',read:'read'}[paper.status],rating:0,keywords:paper.tags,note:paper.notes,pdf:'[['+pdf+']]',date_added:new Date(paper.createdAt).toISOString().slice(0,10)})+'---\n\n## 阅读笔记\n');
  }
  metrics=createMetricsManager({vault,bridge,request:requestUrl});
  metadata=createMetadataManager({vault,model:()=>library.currentModal,request:requestUrl});
  await showLibrary();
  status.textContent='文献库已就绪 · 数据保存在当前设备';
  window.__researchPort={app,library,reader,vault,metrics,metadata,activity,imports,collectionTree};
  installTopicBridge({ app, vault, library, reader });
  void metrics.start();
  void metadata.resume();
}
function announceCount(){if(!library)return;publishTopicPapers(vault,library);const prefix=library.settings.papersFolder.replace(/\/$/,'')+'/';const count=vault.getMarkdownFiles().filter(file=>file.path.startsWith(prefix)&&String(frontmatter(vault.texts.get(file.path)||'').type).toLowerCase()==='paper').length;window.parent.postMessage({type:'research-port-count',count},window.location.protocol==='file:'?'*':window.location.origin);}
async function showLibrary(){app.nextRootModal=true;library.openLibrary();await library.currentModal.ready;collectionTree.attach(library.currentModal);library.currentModal.containerEl.remove();announceCount();mountLibraryWorkspace({app,library,reader,vault,metrics,metadata,activity,imports,collectionTree,generation:++generation,importFiles,chooseFiles,openStorage:bridge?.showResearchStorage?()=>bridge.showResearchStorage():null});}
for(const event of ['create','modify','delete'])vault.on(event,announceCount);
let readerPaperPath = '', savingReaderStatus = false;
const readerStatus = document.querySelector('#reader-reading-status');
const readerStatusPicker = mountStatusPicker(readerStatus, { value: 'inbox', label: '阅读器阅读状态', onChange: changeReaderStatus });
function syncReaderStatus() {
  const fm = frontmatter(vault.texts.get(readerPaperPath) || '');
  readerStatus.closest('.port-reader-reading-state').hidden = !readerPaperPath;
  readerStatusPicker.update({ value: Object.hasOwn(READING_STATES, fm.status) ? fm.status : 'inbox', disabled: savingReaderStatus, label: '阅读器阅读状态', onChange: changeReaderStatus });
}
function paperForPdf(path) {
  return app.paperAttachments?.owner(path, app.workspace.readingPaperPath);
}
function installAutomaticReadingStatus() {
  const open = reader.openPdf.bind(reader);
  reader.openPdf = async (...args) => {
    const leaf = await open(...args);
    const loaded = leaf?.view?.reader;
    // The original loader catches PDF errors. Verify it actually opened a document.
    if (loaded?.docId && loaded.pageSizes?.length && !loaded.destroyed && !loaded.root?.querySelector('.mupdf-reader-error-title') && loaded.file?.path === args[0]?.path) {
      const paper = paperForPdf(loaded.file.path);
      if (paper) {
        try { await startReadingOnOpen(vault, paper.file); }
        catch (error) { new Notice('PDF 已打开，但自动阅读状态保存失败：' + error.message); }
      }
    }
    return leaf;
  };
}
async function changeReaderStatus(nextStatus) {
  const file = vault.getAbstractFileByPath(readerPaperPath);
  if (!file || savingReaderStatus) return;
  savingReaderStatus = true; syncReaderStatus();
  try { await saveReadingStatus(vault, file, nextStatus); }
  catch (error) { new Notice('阅读状态保存失败：' + error.message); }
  finally { savingReaderStatus = false; syncReaderStatus(); }
}
vault.on('modify', file => { if (file.path === readerPaperPath) syncReaderStatus(); });
document.querySelector('#reader-back').onclick=()=>app.workspace.back();
app.workspace.on('active-leaf-change',leaf=>{if(leaf.right)return;const path=leaf.view?.filePath||'';const paper=paperForPdf(path);const item=paper&&app.paperAttachments.documents(paper).find(item=>item.path===path);const label=document.querySelector('#reader-file-name');label.textContent=paper ? paper.title+(item&&!item.primary?' · '+item.name:'') : path.split('/').pop()||'';label.title=label.textContent;readerPaperPath=paper?.file.path||'';syncReaderStatus();});
document.querySelector('#settings-button').onclick=()=>{const modal=new Modal(app);modal.setTitle('阅读与外观设置');modal.open();for(const tab of app.settingTabs){tab.containerEl=modal.contentEl.createDiv({cls:'port-settings-group'});tab.display();}};
document.querySelector('#migration-button').onclick=()=>{
  const modal=new Modal(app);modal.setTitle('迁移原 Obsidian 文献与阅读记录');modal.contentEl.createEl('p',{text:'选择原 Vault 文件夹。复制论文笔记、关联 PDF、图片及 MuPDF 标注到本应用；不修改源文件，不覆盖已有副本，不复制 API 密钥。'});
  const input=modal.contentEl.createEl('input',{cls:'port-source-path',attr:{placeholder:'例如 C:/Users/用户名/Documents/Obsidian/Vault','aria-label':'Obsidian Vault 路径'}});
  if(bridge?.chooseResearchSource){const choose=modal.contentEl.createEl('button',{text:'选择 Vault 文件夹'});choose.onclick=async()=>{const path=await bridge.chooseResearchSource();if(path)input.value=path;};}
  const run=modal.contentEl.createEl('button',{cls:'mod-cta',text:'复制并迁移'});
  const output=modal.contentEl.createEl('p',{attr:{role:'status'}});
  if(!bridge?.migrateResearch){run.disabled=true;output.textContent='请在 Electron 桌面版中迁移本机 Obsidian 数据。';}
  run.onclick=async()=>{run.disabled=true;output.textContent='正在复制原文与阅读记录，请保持窗口打开…';try{const report=await bridge.migrateResearch(input.value.trim());await reader.onunload();reader.unload();await vault.init();await reader.onload();installReaderUI(app);reader.settings.translationAutoEnabled=false;await library.loadSettings();await app.workspace.back();showLibrary();output.textContent=`复制 ${report.copied} 个文件，保留 ${report.skipped} 个已有文件；${report.missing.length} 个原链接缺失，${report.failures.length} 个复制失败。`;if(report.missing.length||report.failures.length){const details=modal.contentEl.createEl('details');details.createEl('summary',{text:'查看未迁移项'});details.createEl('pre',{text:JSON.stringify({missing:report.missing,failures:report.failures},null,2)});}status.textContent=output.textContent;}catch(error){output.textContent='迁移失败：'+error.message;}finally{run.disabled=false;}};
  modal.open();
};
const input=document.querySelector('#port-pdf-input');
let pickerTarget;
function chooseFiles(scope) { pickerTarget = importTarget(scope); input.click(); }
document.querySelector('#pdf-button').onclick=()=>chooseFiles(imports.target);
input.oncancel=()=>{pickerTarget=undefined;};
input.onchange=()=>{const files=[...input.files];input.value='';const target=pickerTarget === undefined ? imports.target : pickerTarget;pickerTarget=undefined;void importFiles(files,{target});};
async function importFiles(files, { target: requestedTarget = imports.target } = {}) {
  if (!files.length) return;
  if (importing) { new Notice('正在导入上一批 PDF，请稍候。'); return; }
  // Capture the destination before reading files or opening any asynchronous work.
  const target = importTarget(requestedTarget);
  const model = library.currentModal;
  const imported = [], accepted = [], failures = [];
  let duplicates = 0, associated = 0;
  importing = true;
  document.querySelector('#pdf-button').disabled = true;
  try {
    if (target) await model.ensureOrganizationEntity(IMPORT_ORGANIZATIONS[target.kind], target.name);
    for (const file of files) {
      try {
        if (file.size > 100 * 1024 * 1024) throw new Error('单个 PDF 不能超过 100 MB');
        const buffer = await file.arrayBuffer();
        if (!/\.pdf$/i.test(file.name) || !/%PDF-/.test(new TextDecoder().decode(buffer.slice(0, 1024)))) throw new Error('不是有效的 PDF');
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 24);
        const pdf = `${library.settings.pdfFolder}/local-${hash}.pdf`;
        const note = `${library.settings.papersFolder}/local-${hash}.md`;
        if (vault.getAbstractFileByPath(note)) {
          duplicates++;
          if (target) {
            await model.loadPapers();
            const paper = model.papers.find(paper => paper.file.path === note);
            if (!paper) throw new Error('已有记录无法读取');
            if (!paper[target.kind].includes(target.name)) {
              await model.updatePaperOrganization(paper, IMPORT_ORGANIZATIONS[target.kind], [...paper[target.kind], target.name], { refresh: false });
              associated++;
            }
          }
          accepted.push(note);
          continue;
        }
        if (!vault.getAbstractFileByPath(pdf)) await vault.createBinary(pdf, buffer);
        const fm = { type: 'paper', schema: 'paper/v2', title: file.name.replace(/\.pdf$/i, ''), citekey: 'local-' + hash, status: 'inbox', rating: 0, authors: [], topics: [], keywords: [], pdf: '[[' + pdf + ']]', date_added: new Date().toISOString().slice(0, 10), metadata_source: 'local-file', metadata_original_filename: file.name, metadata_status: 'pending' };
        if (target) fm[target.kind] = model.organizationStoredValues(IMPORT_ORGANIZATIONS[target.kind], [target.name]);
        await vault.create(note, '---\n' + stringify(fm) + '---\n\n## Abstract\n\n## TL;DR\n\n## 研究问题\n\n## 核心贡献\n\n## 阅读笔记\n');
        imported.push(vault.getAbstractFileByPath(note));
        accepted.push(note);
      } catch (error) { failures.push(file.name + '：' + error.message); }
    }
    await model.loadPapers(); model.render();
    const report = { paths: [...new Set(accepted)], newPaths: imported.map(file => file.path), target, failures, archived: model.papers.some(paper => accepted.includes(paper.file.path) && paper.status === 'archived') };
    imports.record(report);
    status.textContent = `新增 ${imported.length} 篇${associated ? `，归入 ${associated} 篇已有文献` : ''}${duplicates ? `，重复 ${duplicates} 篇` : ''}${failures.length ? `，失败 ${failures.length} 个` : ''}`;
    new Notice(status.textContent);
    if (imported.length) void metadata.run(imported);
    if (failures.length) new Notice(failures.join('\n'), 12000);
    return report;
  } catch (error) { new Notice('导入失败：' + error.message); }
  finally { document.querySelector('#pdf-button').disabled = false; importing = false; }
}
window.addEventListener('message',event=>{if(event.source===window.parent&&event.data?.type==='research-port-import')chooseFiles(imports.target);});
if(bridge?.showResearchStorage){const storage=document.querySelector('#port-actions').createEl('button',{text:'数据文件夹'});storage.onclick=()=>bridge.showResearchStorage();}
start().catch(error=>{console.error(error);status.textContent='工作台加载失败：'+error.message;status.classList.add('error');});
