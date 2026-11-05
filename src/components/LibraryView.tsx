import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BookOpen, Check, FileText, FolderOpen, LoaderCircle, Trash2, Upload, X } from 'lucide-react';
import { InlineNotes } from './MusicNotes';
import { Modal } from './Modal';
import { getPdf, storageError } from '../library/database';
import { LIBRARY_IMPORT_EVENT, useLibraryStore } from '../library/store';
import { fileSizeLabel, filterPapers, READING_STATUS, splitTags, type LibrarySort, type Paper, type PaperPatch, type ReadingStatus } from '../library/types';
import '../library/library.css';

const statuses = Object.entries(READING_STATUS) as [ReadingStatus, string][];

function StatusSelect({ paper, disabled, onChange }: { paper: Paper; disabled: boolean; onChange: (value: ReadingStatus) => void }) {
  return <select className={`library-status status-${paper.status}`} value={paper.status} disabled={disabled}
    aria-label={`${paper.title}的阅读状态`} onChange={event => onChange(event.target.value as ReadingStatus)}>
    {statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
  </select>;
}

function PaperDetails({ paper, busy, onSave, onOpen, onRemove, onClose }: {
  paper: Paper; busy: boolean; onSave: (patch: PaperPatch) => Promise<void>;
  onOpen: () => void; onRemove: () => void; onClose: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? '').trim();
    if (!value('title')) return;
    setSaved(false);
    try {
      await onSave({ title: value('title'), authors: value('authors'), year: value('year'), venue: value('venue'), tags: splitTags(value('tags')), notes: value('notes') });
      setSaved(true);
    } catch { /* The parent displays the actionable error. */ }
  };
  return <aside className="library-details" aria-label="文献信息">
    <div className="library-detail-heading"><h2>文献信息</h2><button type="button" className="icon-btn" aria-label="关闭文献信息" onClick={onClose}><X size={16} /></button></div>
    <div className="library-file-icon"><FileText size={28} strokeWidth={1.3} /><span>PDF</span></div>
    <p className="library-file-name">{paper.fileName}</p>
    <p className="library-muted">{fileSizeLabel(paper.fileSize)} · {new Date(paper.createdAt).toLocaleDateString('zh-CN')} 导入</p>
    <button type="button" className="btn btn-primary library-open" onClick={onOpen}><BookOpen size={15} />打开 PDF</button>
    <form onSubmit={submit} onChange={() => setSaved(false)}>
      <label className="form-label" htmlFor="paper-title">标题</label>
      <textarea id="paper-title" name="title" className="form-input" rows={3} required defaultValue={paper.title} />
      <label className="form-label" htmlFor="paper-authors">作者</label>
      <input id="paper-authors" name="authors" className="form-input" placeholder="添加作者" defaultValue={paper.authors} />
      <div className="library-metadata-row"><div><label className="form-label" htmlFor="paper-year">年份</label>
        <input id="paper-year" name="year" className="form-input" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="如 2025" defaultValue={paper.year} /></div>
        <div><label className="form-label" htmlFor="paper-venue">会议 / 期刊</label><input id="paper-venue" name="venue" className="form-input" placeholder="如 NeurIPS" defaultValue={paper.venue} /></div></div>
      <label className="form-label" htmlFor="paper-tags">标签</label>
      <input id="paper-tags" name="tags" className="form-input" placeholder="用逗号分隔，如 LLM, 检索" defaultValue={paper.tags.join(', ')} />
      <label className="form-label" htmlFor="paper-notes">一句话备注</label>
      <textarea id="paper-notes" name="notes" className="form-input" rows={3} placeholder="为什么收藏？与研究有什么关系？" defaultValue={paper.notes} />
      <div className="library-save"><button className="btn btn-primary btn-sm" type="submit" disabled={busy}>保存信息</button><span role="status">{saved && <><Check size={13} />已保存</>}</span></div>
    </form>
    <p className="library-muted library-metadata-hint">标题初始取自文件名，作者与出版信息可在此补全。</p>
    <button type="button" className="btn btn-ghost btn-sm library-delete" onClick={onRemove} disabled={busy}><Trash2 size={14} />移出文献库</button>
  </aside>;
}

function PdfPreview({ url, paper, onClose }: { url: string; paper: Paper; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    // Removing the dialog from the DOM closes it. Avoid dispatching a synthetic
    // close during StrictMode's effect replay, which would dismiss the preview.
    if (!element.open) element.showModal();
  }, []);
  return <dialog ref={dialog} className="library-preview" aria-label={`阅读 ${paper.title}`} onClose={onClose}>
    <header><div><span className="library-muted">PDF 阅读</span><h2>{paper.title}</h2></div>
      <a href={url} download={paper.fileName} className="btn btn-sm">下载 PDF</a>
      <button className="icon-btn" type="button" onClick={onClose} aria-label="关闭 PDF"><X size={20} /></button></header>
    <iframe src={url} title={`${paper.title} PDF 内容`} />
  </dialog>;
}

export function LibraryView() {
  const { papers, loading, loaded, error, query, status, year, sort, importing, progress, report, load, importFiles, update, remove } = useLibraryStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Paper | null>(null);
  const [preview, setPreview] = useState<{ paper: Paper; url: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const importLock = useRef(false);
  const visible = filterPapers(papers, query, status, year, sort);
  const selected = papers.find(paper => paper.id === selectedId);
  const visibleChecked = visible.filter(paper => checked.includes(paper.id)).map(paper => paper.id);
  const years = [...new Set(papers.map(paper => paper.year).filter(Boolean))].sort().reverse();
  const closePreview = useCallback(() => setPreview(null), []);

  useEffect(() => {
    const onImport = () => input.current?.click();
    window.addEventListener(LIBRARY_IMPORT_EVENT, onImport);
    return () => window.removeEventListener(LIBRARY_IMPORT_EVENT, onImport);
  }, []);
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview.url);
  }, [preview]);

  const runAction = async (action: () => Promise<void>) => {
    setBusy(true); setActionError('');
    try { await action(); }
    catch (error) { setActionError(storageError(error)); throw error; }
    finally { setBusy(false); }
  };
  const openPdf = async (paper: Paper) => {
    try { const blob = await getPdf(paper.id); setPreview({ paper, url: URL.createObjectURL(blob) }); }
    catch (error) { setActionError(storageError(error)); }
  };
  const importSelection = async (files: File[]) => {
    if (importLock.current) return;
    importLock.current = true;
    setActionError('');
    try { await importFiles(files); }
    catch (error) { setActionError(storageError(error)); }
    finally { importLock.current = false; }
  };
  const resetFilters = () => useLibraryStore.setState({ query: '', status: 'all', year: 'all' });

  return <section className="library-view" aria-label="文献库"
    onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = importing ? 'none' : 'copy'; } }}
    onDragLeave={event => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
    onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); void importSelection(Array.from(event.dataTransfer.files)); }}>
    <input ref={input} className="library-file-input" aria-label="选择 PDF 文件" type="file" accept=".pdf,application/pdf" multiple disabled={importing || !!error}
      onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void importSelection(files); }} />
    <div className="page-head library-page-head"><div><h1 className="page-title">文献库 <InlineNotes text="♩" /></h1>
      <p className="page-desc">让每一次阅读，都成为研究的积累。</p></div><span className="library-local"><span />本地保存</span></div>

    {error && <div className="library-error" role="alert"><span>文献库暂时无法读取：{error}</span><button className="btn btn-sm" onClick={() => void load()}>重试</button></div>}
    {actionError && <div className="library-error" role="alert">{actionError}<button className="icon-btn" aria-label="关闭错误提示" onClick={() => setActionError('')}><X size={15} /></button></div>}
    {importing && <div className="library-import-progress" role="status"><LoaderCircle size={16} className="library-spinner" />正在导入 {progress.current} / {progress.total}，请保持窗口打开…</div>}
    {report && <div className="library-import-report" role="status"><div><Check size={15} /><span>导入完成：新增 {report.added} 篇{report.duplicates.length > 0 && `，跳过 ${report.duplicates.length} 个重复文件`}{report.failures.length > 0 && `，${report.failures.length} 个文件失败`}</span>
      <button className="icon-btn" aria-label="关闭导入结果" onClick={() => useLibraryStore.setState({ report: null })}><X size={14} /></button></div>
      {(report.duplicates.length > 0 || report.failures.length > 0) && <details><summary>查看详情</summary><ul>{report.duplicates.map((name, index) => <li key={`duplicate-${index}`}>{name}：相同内容已在文献库中</li>)}{report.failures.map((failure, index) => <li key={`failure-${index}`}>{failure.name}：{failure.message}</li>)}</ul></details>}</div>}

    <div className="library-toolbar"><div className="library-filters" role="group" aria-label="按阅读状态筛选">
      <button className={`filter-pill ${status === 'all' ? 'active' : ''}`} aria-pressed={status === 'all'} onClick={() => useLibraryStore.setState({ status: 'all' })}>全部 <span>{papers.length}</span></button>
      {statuses.map(([value, label]) => <button key={value} className={`filter-pill ${status === value ? 'active' : ''}`} aria-pressed={status === value} onClick={() => useLibraryStore.setState({ status: value })}>{label} <span>{papers.filter(paper => paper.status === value).length}</span></button>)}
    </div><div className="library-selects"><select className="form-select" aria-label="按年份筛选" value={year} onChange={event => useLibraryStore.setState({ year: event.target.value })}><option value="all">全部年份</option>{years.map(year => <option key={year} value={year}>{year}</option>)}<option value="unknown">未填写年份</option></select>
      <select className="form-select" aria-label="文献排序" value={sort} onChange={event => useLibraryStore.setState({ sort: event.target.value as LibrarySort })}><option value="newest">最近导入</option><option value="oldest">最早导入</option><option value="title">标题排序</option></select></div></div>

    {loading && !loaded ? <div className="library-loading" role="status">正在读取本地文献…</div> : papers.length === 0 && !error ?
      <div className={`library-empty ${dragging ? 'drag-active' : ''}`}><div className="library-empty-symbol"><BookOpen size={37} strokeWidth={1.2} /></div><h2>从第一篇论文开始</h2><p>拖入 PDF，或从电脑中选择文件。<br />原文与阅读状态，一起保存在这里。</p>
        <button className="btn btn-primary" disabled={importing} onClick={() => input.current?.click()}><Upload size={15} />导入 PDF</button><span className="library-muted">支持批量导入 · 单个文件不超过 100 MB · 相同内容自动去重</span></div> : papers.length > 0 && <>
      <div className={`library-drop-hint ${dragging ? 'drag-active' : ''}`}><Upload size={15} /><span>将 PDF 拖到这里，继续添加文献</span><span className="library-muted">文件与阅读记录均保存在当前设备</span></div>
      <div className="library-result-line"><span>{query.trim() || status !== 'all' || year !== 'all' ? `找到 ${visible.length} 篇 / 共 ${papers.length} 篇` : `共 ${papers.length} 篇文献`}</span>
        {visibleChecked.length > 0 && <div className="library-bulk"><span>已选 {visibleChecked.length} 篇</span><select className="form-select" aria-label="批量设置阅读状态" value="" disabled={busy} onChange={event => { const next = event.target.value as ReadingStatus; if (next) void runAction(() => update(visibleChecked, { status: next })).catch(() => {}); }}><option value="" disabled>修改阅读状态</option>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className="btn btn-ghost btn-sm" onClick={() => setChecked([])}>取消选择</button></div>}
      </div>
      <div className={`library-layout ${selected ? 'has-details' : ''}`}><div className="library-list">
        {visible.length === 0 ? <div className="library-no-results"><FolderOpen size={30} strokeWidth={1.2} /><h2>没有找到匹配的文献</h2><p>试试其他关键词，或调整阅读状态与年份。</p><button className="btn btn-sm" onClick={resetFilters}>清除筛选</button></div> :
        <table className="library-table"><thead><tr><th className="library-checkbox-cell"><input type="checkbox" aria-label="选择当前结果中的全部文献" checked={visible.length > 0 && visibleChecked.length === visible.length} onChange={event => setChecked(event.target.checked ? visible.map(paper => paper.id) : [])} /></th><th>文献</th><th className="library-status-column">阅读状态</th><th className="library-action-column"><span className="library-sr-only">操作</span></th></tr></thead><tbody>
          {visible.map(paper => <tr key={paper.id} className={selectedId === paper.id ? 'selected' : ''}><td className="library-checkbox-cell"><input type="checkbox" aria-label={`选择 ${paper.title}`} checked={checked.includes(paper.id)} onChange={event => setChecked(current => event.target.checked ? [...current, paper.id] : current.filter(id => id !== paper.id))} /></td>
            <td><button className="library-paper-title" onClick={() => setSelectedId(paper.id)}><FileText size={18} strokeWidth={1.5} /><span>{paper.title}</span></button><div className="library-paper-meta">{[paper.authors || '作者待补充', paper.venue, paper.year, fileSizeLabel(paper.fileSize)].filter(Boolean).join(' · ')}</div>
              {paper.tags.length > 0 && <div className="library-tags">{paper.tags.map(tag => <button key={tag} onClick={() => useLibraryStore.setState({ query: tag })}>{tag}</button>)}</div>}
              {paper.notes && <p className="library-paper-note">{paper.notes}</p>}</td>
            <td><StatusSelect paper={paper} disabled={busy} onChange={next => void runAction(() => update([paper.id], { status: next })).catch(() => {})} /></td>
            <td><button type="button" className="icon-btn" aria-label={`打开 ${paper.title} PDF`} title="打开 PDF" onClick={() => void openPdf(paper)}><BookOpen size={17} /></button></td></tr>)}
        </tbody></table>}
      </div>{selected && <PaperDetails key={selected.id} paper={selected} busy={busy} onSave={patch => runAction(() => update([selected.id], patch))} onOpen={() => void openPdf(selected)} onRemove={() => setPendingDelete(selected)} onClose={() => setSelectedId(null)} />}</div>
    </>}
    {dragging && <div className="library-drag-overlay" aria-hidden="true"><Upload size={32} /><strong>松开以导入 PDF</strong></div>}
    {preview && <PdfPreview {...preview} onClose={closePreview} />}
    {pendingDelete && <Modal title="移出文献库" onClose={() => !busy && setPendingDelete(null)} footer={<><button className="btn" disabled={busy} onClick={() => setPendingDelete(null)}>取消</button><button className="btn btn-primary" disabled={busy} onClick={() => { void runAction(async () => { await remove(pendingDelete.id); setChecked(current => current.filter(id => id !== pendingDelete.id)); setSelectedId(null); setPendingDelete(null); }).catch(() => {}); }}>确认移出</button></>}>
      <p>确定移出「{pendingDelete.title}」？</p><p className="library-muted">此操作会删除文献库中的条目和 PDF 副本，原始文件不受影响。</p></Modal>}
  </section>;
}
