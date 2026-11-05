import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Paperclip, FileText, FileSpreadsheet, FileArchive, FileImage, Plus, MoreHorizontal, BookOpen, Download, Pencil, ArrowUp, ArrowDown, Unlink, ChevronDown, Columns2 } from 'lucide-react';
import { useContextMenu } from '../components/ContextMenu';
import { Modal, Notice } from './obsidian.js';
import { ATTACHMENT_ACCEPT, ATTACHMENT_KINDS } from './paper-attachments.js';
import { formatReadingTime, pageActivity } from './reading-activity.js';
import { useReadingActivity } from './ReadingActivityView.jsx';
import './paper-attachments.css';

const shortcut = (event, action) => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') action(event); };
const fileIcon = item => ['csv', 'tsv', 'xls', 'xlsx', 'json'].includes(item.extension) ? FileSpreadsheet : item.extension === 'zip' ? FileArchive : ['png', 'jpg', 'jpeg', 'webp'].includes(item.extension) ? FileImage : FileText;

export async function openPaperDocument(app, paper, item) {
  const file = app.vault.getAbstractFileByPath(item.path);
  if (!file) throw new Error('附件文件缺失：' + item.filename);
  if (item.extension === 'pdf') {
    await app.paperNotes.flush(paper.file);
    app.workspace.readingPaperPath = paper.file.path;
    return app.plugins.plugins['mupdf-reader-mvp'].openPdf(file, false);
  }
  return downloadAttachment(app, item);
}

async function downloadAttachment(app, item) {
  const file = app.vault.getAbstractFileByPath(item.path);
  if (!file) throw new Error('附件文件缺失：' + item.filename);
  const bytes = await app.vault.readBinary(file), url = URL.createObjectURL(new Blob([bytes]));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = item.filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function useAttachmentActions(app, paper, clearDrag) {
  const manager = app.paperAttachments, menu = useContextMenu(), input = useRef(null), lock = useRef(false);
  const [busy, setBusy] = useState(false), [dropping, setDropping] = useState(false);
  const run = async action => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await action(); } catch (error) { new Notice(error.message); }
    finally { lock.current = false; setBusy(false); }
  };
  const add = files => run(async () => {
    const result = await manager.add(paper.file, files);
    new Notice([result.added.length ? `已添加 ${result.added.length} 份附录` : '', result.duplicates ? `${result.duplicates} 份已存在` : '', ...result.failures.map(row => `${row.name}：${row.message}`)].filter(Boolean).join('\n'));
  });
  const rename = item => {
    const modal = new Modal(app); modal.setTitle('编辑附录'); modal.modalEl.classList.add('rw-attachment-edit-modal'); modal.modalEl.setAttribute('role', 'dialog'); modal.modalEl.setAttribute('aria-modal', 'true');
    const form = modal.contentEl.createEl('form', { cls: 'rw-attachment-form' });
    const label = form.createEl('label', { text: '名称' }), name = label.createEl('input', { attr: { 'aria-label': '附录名称', maxlength: '200', required: '' } }); name.value = item.name;
    const kindLabel = form.createEl('label', { text: '类型' }), kind = kindLabel.createEl('select', { attr: { 'aria-label': '附录类型' } });
    for (const [value, text] of Object.entries(ATTACHMENT_KINDS)) kind.createEl('option', { text, attr: { value } }); kind.value = item.kind;
    const actions = form.createDiv({ cls: 'rw-attachment-form-actions' });
    const cancel = actions.createEl('button', { text: '取消', cls: 'rw-secondary', attr: { type: 'button' } }); cancel.onclick = () => modal.close();
    const save = actions.createEl('button', { text: '保存', cls: 'rw-primary', attr: { type: 'submit' } });
    form.onsubmit = event => { event.preventDefault(); if (!name.value.trim()) return; void run(async () => { save.disabled = true; try { await manager.update(paper.file, item.id, { name: name.value, kind: kind.value }); modal.close(); } finally { save.disabled = false; } }); };
    modal.open(); name.focus(); name.select();
  };
  const contextMenu = (event, item) => {
    const items = manager.list(paper.file), index = items.findIndex(row => row.id === item.id);
    menu.open(event, [
      { label: item.extension === 'pdf' ? '阅读 PDF' : '下载附件', icon: item.extension === 'pdf' ? <BookOpen /> : <Download />, disabled: !item.file, action: () => void run(() => openPaperDocument(app, paper, item)) },
      ...(!item.primary && item.extension === 'pdf' ? [{ label: '与正文并排阅读', icon: <Columns2 />, disabled: !item.file || !manager.documents(paper).some(doc => doc.primary && doc.file), action: () => void run(() => app.pdfComparison.open(paper, item)) }] : []),
      ...(item.extension === 'pdf' ? [{ label: '下载附件', icon: <Download />, disabled: !item.file, action: () => void run(() => downloadAttachment(app, item)) }] : []),
      ...(!item.primary ? [
        { label: '编辑名称与类型', icon: <Pencil />, separator: true, action: () => rename(item) },
        { label: '上移', icon: <ArrowUp />, disabled: index <= 0, action: () => void run(() => manager.move(paper.file, item.id, -1)) },
        { label: '下移', icon: <ArrowDown />, disabled: index >= items.length - 1, action: () => void run(() => manager.move(paper.file, item.id, 1)) },
        { label: '移除关联', icon: <Unlink />, separator: true, action: () => void run(() => manager.remove(paper.file, item.id)) },
      ] : []),
    ].map(row => ({ ...row, disabled: busy || row.disabled })), item.name);
  };
  const drag = event => {
    if (!event.dataTransfer.types.includes('Files')) return false;
    event.preventDefault(); event.stopPropagation(); return true;
  };
  return { busy, dropping, contextMenu, menu: menu.menu, open: item => void run(() => openPaperDocument(app, paper, item)), compare: item => void run(() => app.pdfComparison.open(paper, item)), pick: () => input.current?.click(),
    input: <input ref={input} type="file" multiple accept={ATTACHMENT_ACCEPT} aria-label="添加附录文件" hidden onChange={event => { const files = [...event.target.files]; event.target.value = ''; if (files.length) void add(files); }} />,
    dropEvents: {
      onDragEnter: event => { if (drag(event)) { clearDrag?.(); setDropping(true); } },
      onDragOver: event => { if (drag(event)) event.dataTransfer.dropEffect = 'copy'; },
      onDragLeave: event => { if (event.dataTransfer.types.includes('Files')) { event.stopPropagation(); if (!event.currentTarget.contains(event.relatedTarget)) setDropping(false); } },
      onDrop: event => { if (drag(event)) { setDropping(false); const files = [...event.dataTransfer.files]; if (files.length) void add(files); } },
    },
  };
}

function usePaperFiles(app, paper) {
  const [, redraw] = useState(0);
  useEffect(() => {
    const refs = ['modify', 'delete', 'rename'].map(event => app.vault.on(event, () => redraw(value => value + 1)));
    return () => refs.forEach(ref => ref.off());
  }, [app]);
  return app.paperAttachments.documents(paper);
}

export function PaperAttachments({ app, paper, clearDrag }) {
  const documents = usePaperFiles(app, paper), actions = useAttachmentActions(app, paper, clearDrag), reader = app.plugins.plugins['mupdf-reader-mvp'];
  const [, redraw] = useState(0); useReadingActivity(app.readingActivity);
  useEffect(() => reader.subscribeAnnotations(() => redraw(value => value + 1)), [reader]);
  return <section className={`rw-supplements ${actions.dropping ? 'is-dropping' : ''}`} aria-label="论文附录" aria-busy={actions.busy} {...actions.dropEvents}>
    <div className="rw-section-heading rw-supplements-heading"><h3>正文与附录</h3><button className="rw-secondary" disabled={actions.busy} onClick={actions.pick}><Plus size={14} />{actions.busy ? '正在添加…' : '添加附录'}</button></div>
    {actions.input}
    <div className="rw-supplement-list">{documents.map(item => {
      const Icon = fileIcon(item), pages = pageActivity(app.readingActivity.get(item.path), reader.getAnnotationsForFile(item.path));
      const seconds = pages.reduce((sum, page) => sum + page.seconds, 0), notes = pages.reduce((sum, page) => sum + page.notes, 0);
      return <div key={item.id} className={`rw-supplement-item ${item.file ? '' : 'is-missing'}`} data-attachment-id={item.id} onContextMenu={event => actions.contextMenu(event, item)}>
        <Icon size={17} className="rw-supplement-icon" />
        <button className="rw-supplement-open" disabled={!item.file || actions.busy} aria-label={`${item.extension === 'pdf' ? '阅读' : '下载'}${item.primary ? '正文' : '附录'}：${item.primary ? paper.title : item.name}`} title={item.filename} onClick={() => actions.open(item)} onKeyDown={event => shortcut(event, e => actions.contextMenu(e, item))}><strong>{item.name}</strong><span>{item.primary ? item.filename : `${ATTACHMENT_KINDS[item.kind]} · ${item.extension.toUpperCase()}`}{!item.file ? ' · 文件缺失' : ''}</span>{(seconds > 0 || notes > 0) && <small>{formatReadingTime(seconds)} · {notes} 条摘录</small>}</button>
        {!item.primary && item.extension === 'pdf' && <button className="rw-icon-button rw-supplement-compare" aria-label={`与正文并排阅读：${item.name}`} title="与正文并排阅读" disabled={!item.file || actions.busy || !documents.some(doc => doc.primary && doc.file)} onClick={() => actions.compare(item)}><Columns2 size={16} /></button>}
        <button className="rw-icon-button" aria-label={`附件菜单：${item.name}`} disabled={actions.busy} onClick={event => actions.contextMenu(event, item)}><MoreHorizontal size={16} /></button>
      </div>;
    })}</div>
    {!documents.some(item => !item.primary) && <div className="rw-supplement-empty"><Paperclip size={22} strokeWidth={1.4} /><span>暂无附录</span></div>}
    {actions.menu}
  </section>;
}

export function PaperAttachmentRows({ app, paper, columns, clearDrag }) {
  const documents = app.paperAttachments.documents(paper), actions = useAttachmentActions(app, paper, clearDrag);
  return <>{documents.map(item => { const Icon = fileIcon(item); return <tr key={item.id} className="rw-attachment-row" {...actions.dropEvents}><td colSpan={columns}><button disabled={!item.file || actions.busy} onContextMenu={event => actions.contextMenu(event, item)} onKeyDown={event => shortcut(event, e => actions.contextMenu(e, item))} onClick={() => actions.open(item)}><Icon size={14} /><span>{item.primary ? item.filename : item.name}</span><span className="rw-attachment-type">{item.primary ? 'PDF 附件' : ATTACHMENT_KINDS[item.kind] + ' · ' + item.extension.toUpperCase()}{!item.file && ' · 文件缺失'}</span></button></td></tr>; })}
    <tr className={`rw-attachment-create-row rw-attachment-add ${actions.dropping ? 'is-dropping' : ''}`} {...actions.dropEvents}><td colSpan={columns}>{actions.input}<button disabled={actions.busy} onClick={actions.pick}><Plus size={13} />添加附录</button>{actions.menu}</td></tr>
  </>;
}

export function openPaperAttachments(app, paper) {
  const modal = new Modal(app); modal.setTitle('论文附录'); modal.modalEl.classList.add('rw-attachments-modal');
  modal.modalEl.setAttribute('role', 'dialog'); modal.modalEl.setAttribute('aria-modal', 'true');
  const root = createRoot(modal.contentEl), focus = document.activeElement;
  modal.onOpen = () => root.render(<><p className="rw-attachment-paper-title">{paper.title}</p><PaperAttachments app={app} paper={paper} /></>);
  modal.onClose = () => { root.unmount(); focus?.focus?.(); };
  modal.open();
}

function ReaderDocuments({ app }) {
  const [, redraw] = useState(0), menu = useContextMenu();
  const [busy, setBusy] = useState(false), switching = useRef(false);
  useEffect(() => {
    const refs = [app.workspace.on('active-leaf-change', () => { menu.close(); redraw(value => value + 1); }), app.vault.on('modify', () => redraw(value => value + 1))];
    const stop = app.pdfComparison.subscribe(() => redraw(value => value + 1));
    return () => { refs.forEach(ref => ref.off()); stop(); };
  }, [app, menu.close]);
  const path = app.workspace.mainLeaf?.view?.filePath, paper = app.paperAttachments.owner(path, app.workspace.readingPaperPath);
  if (!paper || !app.paperAttachments.list(paper.file).length) return null;
  const documents = app.paperAttachments.documents(paper);
  const comparison = app.pdfComparison.state, supplement = documents.find(item => !item.primary && item.path === path) || documents.find(item => !item.primary && item.extension === 'pdf' && item.file);
  const switchDocument = async item => {
    if (switching.current) return;
    switching.current = true; setBusy(true);
    try { await openPaperDocument(app, paper, item); } catch (error) { new Notice(error.message); }
    finally { switching.current = false; setBusy(false); }
  };
  return <><button className="rw-secondary rw-reader-documents-button" disabled={busy || comparison.busy} aria-label="切换正文与附录" title="切换正文与附录" aria-haspopup="menu" onClick={event => menu.open(event, [
    ...documents.filter(item => item.extension === 'pdf').map(item => ({ label: item.primary ? '正文' : item.name, icon: item.primary ? <BookOpen /> : <Paperclip />, checked: item.path === path, disabled: busy || !item.file, action: () => void switchDocument(item) })),
    { label: comparison.active ? '退出并排阅读' : '正文与附录并排阅读', icon: <Columns2 />, separator: true, disabled: !comparison.active && (!supplement || !documents.some(item => item.primary && item.file)), action: () => void (comparison.active ? app.pdfComparison.close() : app.pdfComparison.open(paper, supplement)).catch(error => new Notice(error.message)) },
    { label: '管理附录', icon: <Plus />, separator: true, action: () => openPaperAttachments(app, paper) },
  ], paper.title)}><Paperclip size={15} /><span>正文 / 附录</span><ChevronDown size={12} /></button>{menu.menu}</>;
}

export function installReaderDocuments(app) {
  const host = document.createElement('div'); host.className = 'rw-reader-documents';
  document.querySelector('.port-reader-bar').insertBefore(host, document.querySelector('.port-reader-reading-state'));
  createRoot(host).render(<ReaderDocuments app={app} />);
}
