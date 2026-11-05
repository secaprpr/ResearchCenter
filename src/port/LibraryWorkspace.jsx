import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BookOpen, Library, Folder, FolderPlus, Search, Plus, SlidersHorizontal, MoreHorizontal, ChevronRight, ChevronDown, ArrowLeft, ArrowDown, ArrowUpDown, FileText, Star, Clock3, Inbox, Archive, Check, X, PanelsTopLeft, Image as ImageIcon, Quote, ArrowUpRight, PanelRightClose, PanelRightOpen, Settings2, Download, Copy, CheckCheck, Tag, FolderKanban, RefreshCw, KeyRound, Columns3, ChartNoAxesColumn } from 'lucide-react';
import { Notice, Modal } from './obsidian.js';
import { processFrontMatter, frontmatter, markdownBody } from './vault.js';
import { paperBadges } from './paper-badges.js';
import { metricFields } from './metrics.js';
import { formatVenue } from './venue-display.js';
import { READING_STATES as STATES, saveReadingStatus } from './reading-status.js';
import { StatusPicker } from './StatusPicker.jsx';
import { pageActivity, formatReadingTime } from './reading-activity.js';
import { useReadingActivity, TitleHeatmap, PaperReadingActivity } from './ReadingActivityView.jsx';
import { LIBRARY_COLUMNS, readColumnLayout, ColumnResizeHandle, ColumnMenu } from './LibraryColumns.jsx';
import { useLibraryContextMenu } from './LibraryContextMenu.jsx';
import { importTarget, IMPORT_ORGANIZATIONS } from './import-session.js';
import { DetailResizeHandle, readDetailWidth } from './DetailResizeHandle.jsx';
import { canMoveCollection } from './collection-tree.js';
import { CollectionNavigation } from './CollectionNavigation.jsx';
import { PaperTags, TagEditor } from './PaperTags.jsx';
import { editPaperTags } from './paper-tags.js';
import { ResearchNotes } from './ResearchNotes.jsx';
import { PaperRemark } from './PaperRemark.jsx';
import { remarkPlainText } from './remark-markup.js';
import { PaperAttachments, PaperAttachmentRows } from './PaperAttachments.jsx';
import { useWorkbenchTopics, WorkbenchTopicMembership } from './WorkbenchTopics.jsx';

const contextKey = (event, action) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { action(event); return true; } return false; };
const PREF_KEY = 'research-workbench-library-layout';
const PAPER_DRAG_TYPE = 'application/x-research-workbench-papers';
const COLLECTION_DRAG_TYPE = 'application/x-research-workbench-collection';
const readPreferences = () => { try { const saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); return saved && typeof saved === 'object' ? saved : {}; } catch { return {}; } };
const plainName = value => String(value || '').replace(/^\[\[|\]\]$/g, '').split('|').pop().split('/').pop().replace(/\.md$/, '');
const shortAuthors = paper => paper.authors.length ? paper.authors.slice(0, 2).join(', ') + (paper.authors.length > 2 ? ' 等' : '') : '作者待补充';
const formatDate = value => value ? String(value).slice(0, 10) : '—';
const matchesText = (paper, query, badges = [], venueLabel = paper.venue, note = '') => {
  const text = [paper.title, ...paper.authors, paper.venue, venueLabel, paper.year, ...paper.topics, ...paper.projects, ...paper.collections, ...paper.keywords, paper.note, remarkPlainText(paper.note), note, paper.doi, paper.citekey, ...badges.map(badge => badge.label)].join(' ').toLowerCase();
  return query.toLowerCase().trim().split(/\s+/).every(term => text.includes(term));
};

function PaperBadges({ badges, className = '', limit = 3 }) {
  return <span className={`rw-paper-badges ${className}`} title={badges.map(badge => badge.label).join(' · ')}>{badges.slice(0, limit).map(badge => <span className={`rw-paper-badge kind-${badge.kind} tone-${badge.tone}`} key={badge.label} title={badge.title}>{badge.label}</span>)}{badges.length > limit && <span className="rw-paper-badge rw-badge-more">+{badges.length - limit}</span>}</span>;
}

function LibraryWorkspace({ context }) {
  const { app, library, reader, vault, metrics, metadata, activity, imports, collectionTree } = context;
  const activityVersion = useReadingActivity(activity);
  const model = library.currentModal;
  const workbenchTopics = useWorkbenchTopics(app);
  const [papers, setPapers] = useState(() => [...model.papers]);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState({ kind: 'all', name: '' });
  const [importState, setImportState] = useState(imports.state);
  const [pinImports, setPinImports] = useState(false);
  const [dropTarget, setDropTarget] = useState(null);
  const latestPaths = useMemo(() => new Set(importState.batch?.paths || []), [importState]);
  const [activePath, setActivePath] = useState('');
  const [selected, setSelected] = useState(new Set());
  const selectionAnchor = useRef('');
  const [multiSelect, setMultiSelect] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [sort, setSort] = useState(readPreferences().sort || 'added');
  const [sortDirection, setSortDirection] = useState(readPreferences().sortDirection || 'default');
  const [heatmap, setHeatmap] = useState(() => ['time', 'notes', 'off'].includes(readPreferences().heatmap) ? readPreferences().heatmap : 'time');
  const [compact, setCompact] = useState(readPreferences().compact ?? false);
  const [detailOpen, setDetailOpen] = useState(readPreferences().layout === 'zotero' ? readPreferences().detailOpen ?? false : false);
  const [detailWidth, setDetailWidth] = useState(() => readDetailWidth(readPreferences().detailWidth));
  const [columnLayout, setColumnLayout] = useState(() => readColumnLayout(readPreferences().columns));
  const [columnMenu, setColumnMenu] = useState(null);
  const columnMenuTrigger = useRef(null);
  const closeColumnMenu = useCallback((restoreFocus = false) => {
    setColumnMenu(null);
    if (restoreFocus) columnMenuTrigger.current?.focus();
  }, []);
  const openColumnMenu = event => {
    event.preventDefault();
    const trigger = event.currentTarget.closest('thead') ? event.target.closest('th') : event.currentTarget;
    const rect = trigger.getBoundingClientRect();
    columnMenuTrigger.current = trigger;
    setToolsOpen(false);
    document.dispatchEvent(new Event('workbench-close-context-menu'));
    setColumnMenu({ x: event.type === 'contextmenu' && event.clientX ? event.clientX : rect.left, y: event.type === 'contextmenu' && event.clientY ? event.clientY : rect.bottom, trigger });
  };
  const shownColumns = LIBRARY_COLUMNS.filter(column => !columnLayout.hidden.includes(column.id));
  const columnVisible = id => !columnLayout.hidden.includes(id);
  const resizeColumn = (id, width) => setColumnLayout(previous => ({ ...previous, widths: { ...previous.widths, [id]: width } }));
  const [expandedPapers, setExpandedPapers] = useState(new Set());
  const [mobileDetail, setMobileDetail] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [detailTab, setDetailTab] = useState('info');
  const [view, setView] = useState('papers');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({ projects: false, collections: true, topics: true });
  const [editing, setEditing] = useState(null);
  const [tagEditing, setTagEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [metadataState, setMetadataState] = useState(metadata.state);
  useEffect(() => metadata.subscribe(setMetadataState), [metadata]);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [metricsState, setMetricsState] = useState(metrics.state);
  useEffect(() => { setMetricsState(metrics.state); return metrics.subscribe(setMetricsState); }, [metrics]);
  const [dragging, setDragging] = useState(false);
  const [dragCount, setDragCount] = useState(0);
  const paperDrag = useRef(null);
  const dragFromControl = useRef(false);
  const assigningPapers = useRef(false);
  const collectionDrag = useRef(null);
  const [collectionDrop, setCollectionDrop] = useState(null);
  const [, setCollectionRevision] = useState(0);
  useEffect(() => collectionTree.subscribe(() => setCollectionRevision(value => value + 1)), [collectionTree]);
  const collectionStructure = collectionTree.view();
  const [revision, setRevision] = useState(0);
  const searchRef = useRef(null);
  const dragDepth = useRef(0);
  const clearDrag = useCallback(() => {
    paperDrag.current = null; collectionDrag.current = null; dragDepth.current = 0;
    setCollectionDrop(null); setDragCount(0); setDragging(false); setDropTarget(null);
  }, []);
  const refresh = useCallback(async () => { await model.loadPapers(); setPapers([...model.papers]); setRevision(value => value + 1); }, [model]);

  useEffect(() => { imports.setScope(scope); }, [imports, scope]);
  useEffect(() => {
    const off = imports.subscribe((state, report) => {
      setImportState(state);
      if (!report) { if (!state.batch) { setPinImports(false); setScope(previous => previous.kind === 'import' ? { kind: 'all', name: '' } : previous); } return; }
      setPapers([...model.papers]);
      setScope(report.archived ? { kind: 'import', name: state.batch.id } : report.target || { kind: 'all', name: '' });
      setQuery(''); setStatusFilter('all'); setYearFilter('all'); setView('papers');
      setSelected(new Set()); selectionAnchor.current = ''; setActivePath(report.paths[0] || '');
      setMultiSelect(false); setMobileDetail(false); setNavigationOpen(false); setPinImports(true);
      requestAnimationFrame(() => { const scroll = document.querySelector('.rw-table-scroll'); if (scroll) { scroll.scrollTop = 0; scroll.scrollLeft = 0; } });
    });
    const timer = setInterval(() => imports.expire(), 60000);
    return () => { off(); clearInterval(timer); };
  }, [imports, model]);
  useEffect(() => {
    let timer;
    const update = () => { clearTimeout(timer); timer = setTimeout(() => { void refresh(); }, 90); };
    const refs = ['create', 'modify', 'delete', 'rename'].map(event => vault.on(event, update));
    return () => { clearTimeout(timer); refs.forEach(ref => ref.off()); };
  }, [vault, refresh]);
  useEffect(() => { try { localStorage.setItem(PREF_KEY, JSON.stringify({ layout: 'zotero', compact, sort, sortDirection, detailOpen, detailWidth, columns: columnLayout, heatmap })); } catch { /* Layout remains usable without persistence. */ } }, [compact, sort, sortDirection, detailOpen, detailWidth, columnLayout, heatmap]);
  useEffect(() => {
    const keyboard = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key === 'Escape') { if (paperDrag.current || collectionDrag.current) { clearDrag(); return; } setSelected(new Set()); selectionAnchor.current = ''; setMultiSelect(false); setColumnMenu(null); setToolsOpen(false); setFiltersOpen(false); setNavigationOpen(false); setMobileDetail(false); setEditing(null); setMetricsOpen(false); }
    };
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, [clearDrag]);
  useEffect(() => {
    const name = collectionDrop?.position === 'inside' ? collectionDrop.target : dropTarget?.kind === 'collections' ? dropTarget.name : null;
    if (!name || !collectionTree.view().collapsed.includes(name)) return;
    const timer = setTimeout(() => { void collectionTree.toggle(name).catch(error => new Notice(error.message)); }, 650);
    return () => clearTimeout(timer);
  }, [collectionDrop?.target, collectionDrop?.position, dropTarget?.kind, dropTarget?.name, collectionTree]);

  const activePapers = papers.filter(paper => paper.status !== 'archived');
  const badgesByPath = useMemo(() => new Map(papers.map(paper => [paper.file.path, paperBadges(paper, frontmatter(vault.texts.get(paper.file.path) || ''))])), [papers, vault]);
  const venueLabels = useMemo(() => { const labels = new Map(); for (const paper of papers) if (!labels.has(paper.venue)) labels.set(paper.venue, formatVenue(paper.venue)); return labels; }, [papers]);
  const venueLabel = paper => venueLabels.get(paper.venue) || '';
  const impactFactor = paper => { const metric = badgesByPath.get(paper.file.path)?.find(badge => badge.kind === 'metric'); return metric ? Number(metric.label.slice(3)) : null; };
  const impactMaximum = Math.max(10, ...papers.map(paper => impactFactor(paper) ?? 0));
  const organizations = useMemo(() => Object.fromEntries(['topics', 'collections', 'projects'].map(field => {
    const values = new Map();
    for (const paper of activePapers) for (const name of paper[field]) values.set(name, (values.get(name) || 0) + 1);
    const type = { topics: 'topic', collections: 'collection', projects: 'project' }[field];
    for (const name of model.allOrganizationNames(type)) if (!values.has(name)) values.set(name, 0);
    return [field, [...values].sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'))];
  })), [papers, model]);
  const scopePapers = papers.filter(paper => {
    if (scope.kind === 'import') return latestPaths.has(paper.file.path);
    if (scope.kind === 'status') return paper.status === scope.name;
    if (paper.status === 'archived') return false;
    if (scope.kind === 'starred') return paper.rating >= 4;
    if (scope.kind === 'workbench-topic') return workbenchTopics.find(t => t.id === scope.name)?.paperIds.includes(paper.file.path);
    if (scope.kind === 'unfiled') return !paper.collections.length && !paper.topics.length && !paper.projects.length && !workbenchTopics.some(t => t.paperIds.includes(paper.file.path));
    if (scope.kind === 'recent') return Date.now() - new Date(paper.dateAdded || paper.mtime).getTime() < 30 * 86400000;
    if (['topics', 'collections', 'projects'].includes(scope.kind)) return paper[scope.kind].includes(scope.name);
    return true;
  });
  const visiblePapers = scopePapers.filter(paper => matchesText(paper, query, badgesByPath.get(paper.file.path), venueLabel(paper), query ? markdownBody(vault.texts.get(paper.file.path) || '') : '') && (statusFilter === 'all' || paper.status === statusFilter) && (yearFilter === 'all' || String(paper.year) === yearFilter)).sort((a, b) => {
    if (pinImports && latestPaths.has(a.file.path) !== latestPaths.has(b.file.path)) return latestPaths.has(a.file.path) ? -1 : 1;
    if (sort === 'impact' && (impactFactor(a) === null || impactFactor(b) === null)) return (impactFactor(a) === null) - (impactFactor(b) === null);
    const ascending = sort === 'title' || sort === 'venue' || sort === 'authors';
    const direction = sortDirection === 'default' ? (ascending ? 1 : -1) : sortDirection === 'asc' ? 1 : -1;
    const value = sort === 'title' ? a.title.localeCompare(b.title) : sort === 'venue' ? venueLabel(a).localeCompare(venueLabel(b)) : sort === 'authors' ? shortAuthors(a).localeCompare(shortAuthors(b)) : sort === 'impact' ? impactFactor(a) - impactFactor(b) : sort === 'year' ? Number(a.year || 0) - Number(b.year || 0) : sort === 'rating' ? a.rating - b.rating : sort === 'edited' ? a.mtime - b.mtime : String(a.dateAdded || '').localeCompare(String(b.dateAdded || '')) || (a.file.stat.ctime || 0) - (b.file.stat.ctime || 0) || a.title.localeCompare(b.title);
    return value * direction;
  });
  const visiblePathsKey = visiblePapers.map(paper => paper.file.path).join('\0');
  useEffect(() => {
    const paths = new Set(visiblePathsKey ? visiblePathsKey.split('\0') : []);
    setSelected(previous => { const next = new Set([...previous].filter(path => paths.has(path))); return next.size === previous.size ? previous : next; });
    if (!paths.has(selectionAnchor.current)) selectionAnchor.current = '';
  }, [visiblePathsKey]);
  const selectedPapers = visiblePapers.filter(paper => selected.has(paper.file.path));
  // Keep selection-dependent layout stable until drop; reflow during dragstart can abort Chromium's native drag.
  const highlightedPaths = dragCount && paperDrag.current ? new Set(paperDrag.current.paths) : selected;
  const active = visiblePapers.find(paper => paper.file.path === activePath) || visiblePapers[0];
  const pdfPath = paper => model.resolveVaultFile(paper.pdf, paper.file.path)?.path || paper.pdf;
  const hasMainAnnotation = (row, paper) => row.filePath === pdfPath(paper) || (paper.pdf && !paper.pdf.includes('/') && row.filePath.endsWith('/' + paper.pdf));
  const hasAnnotation = (row, paper) => hasMainAnnotation(row, paper) || app.paperAttachments.list(paper.file).some(item => item.path === row.filePath);
  const annotations = useMemo(() => reader.getAllAnnotations(), [reader, revision]);
  const paperAnnotations = active ? annotations.filter(row => hasAnnotation(row, active)) : [];
  const readingPages = useMemo(() => new Map(papers.map(paper => [paper.file.path, pageActivity(activity.get(pdfPath(paper)), annotations.filter(row => hasMainAnnotation(row, paper)).map(row => row.annotation))])), [papers, activity, activityVersion, annotations]);

  const matchesExcerpt = row => query.toLowerCase().trim().split(/\s+/).every(term => [row.filePath, row.annotation.text, row.annotation.comment, ...(row.annotation.tags || [])].join(' ').toLowerCase().includes(term));
  const visibleAnnotations = annotations.filter(row => {
    const linked = visiblePapers.some(paper => hasAnnotation(row, paper));
    if (scope.kind !== 'all' || statusFilter !== 'all' || yearFilter !== 'all') return linked;
    return linked || matchesExcerpt(row);
  });
  const figures = useMemo(() => {
    const rows = [];
    for (const paper of visiblePapers) {
      const seen = new Set();
      for (const path of paper.figures) { const src = vault.getResourcePath(model.resolveVaultFile(path, paper.file.path) || { path }); if (src && !seen.has(path)) { seen.add(path); rows.push({ id: paper.file.path + path, paper, src, label: plainName(path) }); } }
      for (const row of annotations.filter(item => hasAnnotation(item, paper) && item.annotation.type === 'region')) { const src = reader.getRegionPreviewSrc(row.annotation); if (src) rows.push({ id: row.annotation.id, paper, src, label: row.annotation.comment || '区域摘录', annotation: row.annotation, filePath: row.filePath }); }
    }
    if (scope.kind === 'all' && statusFilter === 'all' && yearFilter === 'all') {
      for (const row of annotations.filter(item => item.annotation.type === 'region' && !papers.some(paper => hasAnnotation(item, paper)) && matchesExcerpt(item))) {
        const src = reader.getRegionPreviewSrc(row.annotation);
        if (src) rows.push({ id: row.annotation.id, paper: null, src, label: row.annotation.comment || '区域摘录', annotation: row.annotation, filePath: row.filePath });
      }
    }
    return rows;
  }, [visiblePapers, annotations, vault, reader]);
  const rowBadges = (paper, kind) => badgesByPath.get(paper.file.path).filter(badge => badge.kind === kind);
  const columnHeader = column => <th key={column.id} tabIndex={-1} aria-label={column.sortable ? undefined : column.label} className={`rw-${column.cell}-cell`} aria-sort={!column.sortable ? undefined : sort !== column.id ? 'none' : (sortDirection === 'asc' || (sortDirection === 'default' && ['title', 'venue', 'authors'].includes(column.id))) ? 'ascending' : 'descending'}>
    {column.sortable ? <button className="rw-column-heading" aria-label={`按${column.label}排序`} onClick={() => { setPinImports(false); setSort(column.id); setSortDirection(sort === column.id && (sortDirection === 'asc' || (sortDirection === 'default' && ['title', 'venue', 'authors'].includes(column.id))) ? 'desc' : 'asc'); }}><span className="rw-column-label">{column.label}</span>{sort === column.id ? <ArrowDown size={10} aria-hidden="true" className={`rw-column-sort ${sortDirection === 'asc' || (sortDirection === 'default' && ['title', 'venue', 'authors'].includes(column.id)) ? 'is-ascending' : ''}`} /> : <ArrowUpDown size={10} aria-hidden="true" className="rw-column-sort is-idle" />}</button> : <span className="rw-column-heading"><span className="rw-column-label">{column.label}</span></span>}
    <ColumnResizeHandle column={column} width={columnLayout.widths[column.id]} onResize={resizeColumn} onStart={() => closeColumnMenu()} />
  </th>;
  const scopeTitle = scope.kind === 'all' ? '全部文献' : scope.kind === 'import' ? '本次导入' : scope.kind === 'status' ? STATES[scope.name] : scope.kind === 'starred' ? '重点文献' : scope.kind === 'unfiled' ? '未分类文献' : scope.kind === 'recent' ? '最近加入' : scope.kind === 'workbench-topic' ? workbenchTopics.find(t => t.id === scope.name)?.title || '科研课题' : plainName(scope.name);
  const changeScope = next => { setScope(next); setSelected(new Set()); selectionAnchor.current = ''; setMultiSelect(false); setStatusFilter('all'); setYearFilter('all'); setMobileDetail(false); setNavigationOpen(false); };
  const selectPaper = paper => { imports.markSeen(paper.file.path); setSelected(new Set([paper.file.path])); selectionAnchor.current = paper.file.path; setActivePath(paper.file.path); setDetailOpen(true); setMobileDetail(true); setDetailTab('info'); };
  const run = async action => { setBusy(true); try { await action(); await refresh(); } catch (error) { new Notice(error.message || String(error)); } finally { setBusy(false); } };
  const saveTags = async patch => {
    setBusy(true);
    try { await editPaperTags(vault, tagEditing.map(paper => paper.file), patch); await refresh(); }
    finally { setBusy(false); }
  };
  const update = (paper, fields) => run(async () => { await processFrontMatter(vault, paper.file, fm => Object.assign(fm, fields)); });
  const changeStatus = (paper, status) => run(() => saveReadingStatus(vault, paper.file, status));
  const openPdf = (paper, page) => run(async () => {
    const file = model.resolveVaultFile(paper.pdf, paper.file.path);
    if (!file) throw new Error('未找到本地 PDF，请在论文信息中检查文件链接。');
    selectPaper(paper);
    app.workspace.readingPaperPath = paper.file.path;
    const leaf = await reader.openPdf(file, false);
    if (Number.isInteger(page)) leaf?.view?.reader?.goToPage(page + 1, 'auto');
  });
  useEffect(() => {
    const open = event => { const path = event.detail?.path, paper = model.papers.find(p => p.file.path === path); if (!paper) return; setQuery(''); setScope(paper.status === 'archived' ? { kind: 'status', name: 'archived' } : { kind: 'all', name: '' }); setStatusFilter('all'); setYearFilter('all'); setPinImports(false); setView('papers'); setNavigationOpen(false); selectPaper(paper); };
    window.addEventListener('workbench-open-topic-paper', open); return () => window.removeEventListener('workbench-open-topic-paper', open);
  }, [model]);
  const copyCitation = paper => run(async () => { await navigator.clipboard.writeText(model.bibtexForPaper(paper)); new Notice('已复制 BibTeX'); });
  const bulkStatus = status => run(async () => { for (const paper of selectedPapers) await saveReadingStatus(vault, paper.file, status); setSelected(new Set()); });
  const selectRows = (paper, modifiers = {}, openDetail = false) => {
    const path = paper.file.path;
    const additive = modifiers.ctrlKey || modifiers.metaKey || multiSelect;
    const anchorIndex = visiblePapers.findIndex(item => item.file.path === selectionAnchor.current);
    const index = visiblePapers.findIndex(item => item.file.path === path);
    if (modifiers.shiftKey && anchorIndex >= 0) {
      const range = visiblePapers.slice(Math.min(anchorIndex, index), Math.max(anchorIndex, index) + 1).map(item => item.file.path);
      setSelected(previous => new Set([...(additive ? previous : []), ...range]));
    } else if (additive) {
      setSelected(previous => { const next = new Set(previous); next.has(path) ? next.delete(path) : next.add(path); return next; });
      selectionAnchor.current = path;
    } else if (openDetail) { selectPaper(paper); return; }
    else { setSelected(new Set([path])); selectionAnchor.current = path; }
    setActivePath(path);
  };
  const selectAllVisible = () => { setSelected(new Set(visiblePapers.map(paper => paper.file.path))); if (!selectionAnchor.current) selectionAnchor.current = visiblePapers[0]?.file.path || ''; };
  const clearSelection = () => { setSelected(new Set()); selectionAnchor.current = ''; setMultiSelect(false); };
  const importPdf = () => context.chooseFiles(scope);
  const showExcerpt = row => {
    const modal = new Modal(app); modal.setTitle(`第 ${Number(row.annotation.page || 0) + 1} 页 · ${plainName(row.filePath)}`);
    const src = reader.getRegionPreviewSrc(row.annotation);
    if (src) modal.contentEl.createEl('img', { cls: 'port-image', attr: { src, alt: row.annotation.comment || 'PDF 区域摘录' } });
    if (row.annotation.text) modal.contentEl.createEl('blockquote', { text: row.annotation.text });
    if (row.annotation.comment) modal.contentEl.createEl('p', { text: row.annotation.comment });
    if (row.annotation.tags?.length) modal.contentEl.createEl('p', { text: row.annotation.tags.join(' · ') });
    const exists = Boolean(vault.getAbstractFileByPath(row.filePath));
    const open = modal.contentEl.createEl('button', { cls: exists ? 'mod-cta' : '', text: exists ? '打开原 PDF 与批注' : '原 PDF 缺失，摘录已保留' });
    open.disabled = !exists;
    open.onclick = () => { modal.close(); void run(() => reader.openAnnotationEditor(row.filePath, row.annotation.id)); };
    modal.open();
  };
  const navItem = (kind, name, label, Icon, count) => <button key={kind + name} data-import-kind={importTarget({ kind, name }) ? kind : undefined} data-import-name={name} className={`rw-nav-item ${scope.kind === kind && scope.name === name ? 'is-active' : ''} ${(dragging || dragCount) && dropTarget?.kind === kind && dropTarget.name === name ? 'is-drop-target' : ''}`} title={`${label} · ${count} 篇`} aria-current={scope.kind === kind && scope.name === name ? 'page' : undefined}
    onDrop={importTarget({ kind, name }) ? event => {
      if (isPaperDrag(event)) { event.preventDefault(); event.stopPropagation(); void finishPaperDrop(event, { kind, name }); }
      else if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.stopPropagation(); finishDrop([...event.dataTransfer.files], { kind, name }); }
    } : undefined}
    onContextMenu={event => contextMenu.organization(event, kind, name, label, papers)} onKeyDown={event => contextKey(event, e => contextMenu.organization(e, kind, name, label, papers))} onClick={() => changeScope({ kind, name })}><Icon size={16} /><span>{label}</span><span className={`rw-count ${count ? 'has-items' : 'is-zero'}`}>{count}</span></button>;
  const editPaper = paper => { const fm = frontmatter(vault.texts.get(paper.file.path) || ''); setEditing({ paper, title: paper.title, authors: paper.authors.join('; '), year: paper.year, venue: paper.venue, doi: paper.doi, pdf: paper.pdf, abstract: paper.abstract, note: paper.note, impact_factor: String(fm.impact_factor ?? fm.journal_if ?? fm.IF ?? ''), jcr_quartile: String(fm.jcr_quartile ?? fm.sci_quartile ?? fm.jcr ?? ''), cas_zone: String(fm.cas_zone ?? fm.cas_partition ?? fm.cas_quartile ?? ''), ccf_rank: String(fm.ccf_rank ?? fm.ccf_rating ?? fm.ccf ?? '') }); };
  const organizationEditor = (paper, field, type, label) => {
    const modal = new Modal(app); modal.setTitle(`编辑${label}`);
    modal.contentEl.createEl('p', { text: '用逗号分隔，可选择已有名称或填写新名称。' });
    const input = modal.contentEl.createEl('input', { cls: 'port-source-path', attr: { 'aria-label': label, list: 'rw-organization-options' } }); input.value = paper[field].join(', ');
    const options = modal.contentEl.createEl('datalist', { attr: { id: 'rw-organization-options' } });
    for (const [name] of organizations[field]) options.createEl('option', { attr: { value: name } });
    const save = modal.contentEl.createEl('button', { cls: 'mod-cta', text: '保存' });
    save.onclick = () => run(async () => { await model.updatePaperOrganization(paper, type, input.value.split(/[,，;]/).map(value => value.trim()).filter(Boolean), { refresh: false }); modal.close(); }); modal.open();
  };
  const createCollection = parentName => {
    const parent = typeof parentName === 'string' ? parentName : null;
    const modal = new Modal(app); modal.setTitle(parent ? '新建子文献集' : '新建文献集');
    const input = modal.contentEl.createEl('input', { cls: 'port-source-path', attr: { 'aria-label': '文献集名称', placeholder: '例如：组会精读' } });
    const save = modal.contentEl.createEl('button', { cls: 'mod-cta', text: '创建文献集' });
    save.onclick = () => { if (!input.value.trim() || save.disabled) { input.focus(); return; } save.disabled = true; void run(async () => { try {
      const value = model.cleanOrganizationName(input.value.trim());
      if (model.allOrganizationNames('collection').some(name => name.toLowerCase() === value.toLowerCase())) throw new Error('该文献集名称已存在。');
      const name = await model.createOrganizationEntity('collection', value);
      if (parent) await collectionTree.move(name, parent, 'inside');
      modal.close(); changeScope({ kind: 'collections', name });
    } finally { save.disabled = false; } }); }; modal.open(); input.focus();
  };
  const exportBibliography = () => run(async () => {
    const source = selectedPapers.length ? selectedPapers : visiblePapers;
    if (!source.length) throw new Error('当前没有可导出的文献。');
    const blob = new Blob([source.map(paper => model.bibtexForPaper(paper)).join('\n\n')], { type: 'application/x-bibtex;charset=utf-8' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'references.bib'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const contextMenu = useLibraryContextMenu({ app, model, vault, reader, metrics, metadata, run, busy, selectedPapers, scope, changeScope, selectPaper, editPaper, editTags: setTagEditing, openPdf, setDetailTab, organizations, collectionTree, createCollection,
    selectTargets: (targets, target) => { setSelected(new Set(targets.map(paper => paper.file.path))); setActivePath(target.file.path); selectionAnchor.current = target.file.path; },
    closeOtherMenus: () => { closeColumnMenu(); setToolsOpen(false); setFiltersOpen(false); },
  });
  const navigateRows = (event, index) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key) || event.target.closest('input, button, select, textarea, a, [contenteditable=true]')) return;
    event.preventDefault();
    if (event.key === 'Enter') { selectPaper(visiblePapers[index]); return; }
    if (event.key === ' ') { selectRows(visiblePapers[index], { ctrlKey: true }); return; }
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? visiblePapers.length - 1 : Math.max(0, Math.min(visiblePapers.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    const paper = visiblePapers[next];
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey) setActivePath(paper.file.path);
    else selectRows(paper, event);
    document.querySelector(`[data-paper-index="${next}"]`)?.focus();
  };

  const isPaperDrag = event => Boolean(paperDrag.current && event.dataTransfer.types.includes(PAPER_DRAG_TYPE));
  const isCollectionDrag = event => Boolean(collectionDrag.current && event.dataTransfer.types.includes(COLLECTION_DRAG_TYPE));
  const startCollectionDrag = (event, name) => {
    if (busy || assigningPapers.current) { event.preventDefault(); return; }
    const token = crypto.randomUUID(); collectionDrag.current = { name, token };
    event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData(COLLECTION_DRAG_TYPE, token);
    const preview = document.createElement('div'); preview.className = 'rw-paper-drag-preview'; preview.textContent = name;
    document.body.append(preview); event.dataTransfer.setDragImage(preview, 16, 16); setTimeout(() => preview.remove(), 0);
    document.dispatchEvent(new Event('workbench-close-context-menu')); closeColumnMenu(); setToolsOpen(false);
  };
  const collectionDestination = event => {
    if (!collectionDrag.current || busy) return null;
    const row = event.target.closest('[data-collection-node]');
    let target = null, position = 'root';
    if (row) {
      target = row.dataset.collectionNode;
      const rect = row.getBoundingClientRect(), ratio = (event.clientY - rect.top) / rect.height;
      position = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside';
    } else if (!event.target.closest('[data-collection-root]')) return null;
    return canMoveCollection(collectionTree.view(), collectionDrag.current.name, target, position) ? { target, position } : null;
  };
  const startPaperDrag = (event, paper) => {
    if (busy || assigningPapers.current || dragFromControl.current || event.target.closest('button, input, select, textarea, a, [contenteditable=true]')) { event.preventDefault(); return; }
    const paths = selected.has(paper.file.path) ? selectedPapers.map(item => item.file.path) : [paper.file.path];
    const token = crypto.randomUUID();
    paperDrag.current = { token, paths }; setDragCount(paths.length); setDropTarget(null);
    event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData(PAPER_DRAG_TYPE, token);
    const preview = document.createElement('div'); preview.className = 'rw-paper-drag-preview';
    preview.textContent = paths.length > 1 ? `${paths.length} 篇文献` : paper.title;
    document.body.append(preview); event.dataTransfer.setDragImage(preview, 16, 16);
    setTimeout(() => preview.remove(), 0);
    document.dispatchEvent(new Event('workbench-close-context-menu'));
    closeColumnMenu(); setToolsOpen(false);
  };
  const finishPaperDrop = async (event, destination) => {
    const snapshot = paperDrag.current;
    const valid = snapshot && event.dataTransfer.getData(PAPER_DRAG_TYPE) === snapshot.token;
    const target = importTarget(destination);
    clearDrag();
    if (!valid || !target || busy || assigningPapers.current || !organizations[target.kind].some(([name]) => name === target.name)) return;
    setSelected(new Set(snapshot.paths)); selectionAnchor.current = snapshot.paths[0]; setActivePath(snapshot.paths[0]);
    assigningPapers.current = true;
    try {
      await run(async () => {
        await model.loadPapers();
        let added = 0, failed = 0;
        for (const path of snapshot.paths) {
          const paper = model.papers.find(item => item.file.path === path);
          if (!paper || paper[target.kind].includes(target.name)) continue;
          try {
            await model.updatePaperOrganization(paper, IMPORT_ORGANIZATIONS[target.kind], [...paper[target.kind], target.name], { refresh: false });
            added++;
          } catch { failed++; }
        }
        new Notice(failed ? `已加入 ${added} 篇，${failed} 篇未能保存` : added ? `已加入 ${added} 篇至 ${plainName(target.name)}` : '所选文献已在该分类中');
      });
    } finally { assigningPapers.current = false; }
  };
  const finishDrop = (files, destination) => {
    clearDrag();
    if (files.length) void context.importFiles(files, { target: importTarget(destination) });
  };
  const batchCount = papers.filter(paper => latestPaths.has(paper.file.path)).length;
  const revealBatch = () => { setQuery(''); setView('papers'); changeScope({ kind: 'import', name: importState.batch.id }); };
  return <div style={{ '--rw-detail-width': detailWidth ? `${detailWidth}px` : undefined }} className={`rw-workbench ${dragging ? 'is-file-dragging' : ''} ${detailOpen ? '' : 'detail-closed'} ${compact ? 'is-compact' : ''} ${mobileDetail && view !== 'annotations' ? 'mobile-detail' : ''}`}
    onDragEnter={event => { if (isCollectionDrag(event) || isPaperDrag(event) || event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; if (!isPaperDrag(event) && !isCollectionDrag(event)) setDragging(true); } }}
    onDragLeave={event => { if ((isCollectionDrag(event) || isPaperDrag(event) || event.dataTransfer.types.includes('Files')) && --dragDepth.current <= 0) { setDragging(false); setDropTarget(null); setCollectionDrop(null); } }}
    onDragOver={event => {
      if (isCollectionDrag(event)) {
        event.preventDefault(); const destination = collectionDestination(event);
        event.dataTransfer.dropEffect = destination ? 'move' : 'none';
        setCollectionDrop(previous => previous?.target === destination?.target && previous?.position === destination?.position ? previous : destination); return;
      }
      const internal = isPaperDrag(event);
      if (!internal && !event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      const nav = event.target.closest('[data-import-kind]') || event.target.closest('[data-collection-node]')?.querySelector('[data-import-kind]');
      const target = nav ? { kind: nav.dataset.importKind, name: nav.dataset.importName } : internal ? null : importTarget(scope);
      event.dataTransfer.dropEffect = internal && (!target || busy || assigningPapers.current) ? 'none' : 'copy';
      setDropTarget(previous => previous?.kind === target?.kind && previous?.name === target?.name ? previous : target);
    }}
    onDrop={event => {
      if (isCollectionDrag(event)) {
        event.preventDefault(); const snapshot = collectionDrag.current, destination = collectionDestination(event);
        const valid = event.dataTransfer.getData(COLLECTION_DRAG_TYPE) === snapshot.token; clearDrag();
        if (valid && destination) void run(() => collectionTree.move(snapshot.name, destination.target, destination.position)); return;
      }
      const row = event.target.closest('[data-collection-node]');
      if (isPaperDrag(event)) { event.preventDefault(); if (row) void finishPaperDrop(event, { kind: 'collections', name: row.dataset.collectionNode }); else clearDrag(); return; }
      if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); finishDrop([...event.dataTransfer.files], row ? { kind: 'collections', name: row.dataset.collectionNode } : scope);
    }}>
      <div className="rw-page-header">
      <div className="rw-title-row"><div><h1>文献库{' '}<span className="rw-title-note" aria-hidden="true">♪</span></h1><p>{view === 'annotations' ? <>共 {visibleAnnotations.length} 条摘录<span className="rw-title-separator">·</span>{new Set(visibleAnnotations.map(row => row.filePath)).size} 份 PDF</> : <>共 <span className="rw-count">{visiblePapers.length}</span> 篇文献<span className="rw-title-separator">·</span>{visiblePapers.filter(paper => paper.status === 'reading').length} 篇阅读中</>}</p></div></div>
    <header className="rw-library-header">
        <label className="rw-search"><Search size={16} /><input ref={searchRef} type="search" aria-label="搜索文献" placeholder={view === 'annotations' ? '搜索原文、批注、标签…' : '搜索标题、作者、关键词…'} value={query} onChange={event => setQuery(event.target.value)} /><span>Ctrl F</span></label>
<button className="rw-secondary rw-nav-toggle" aria-label="打开文献分类" onClick={() => setNavigationOpen(true)}><PanelsTopLeft size={16} />分类</button>
        <button className={`rw-secondary ${filtersOpen || statusFilter !== 'all' || yearFilter !== 'all' ? 'is-set' : ''}`} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={15} />筛选{(statusFilter !== 'all' || yearFilter !== 'all') && <span className="rw-filter-dot" />}</button>

        <button className="rw-secondary rw-metrics-button" aria-label="期刊指标自动匹配" onClick={() => setMetricsOpen(true)}><RefreshCw size={15} className={metricsState.running ? 'rw-spinning' : ''} /><span>{metricsState.running ? `${metricsState.done}/${metricsState.total}` : '自动匹配'}</span></button>
        <div className="rw-header-actions"><button className="rw-secondary rw-new-collection" onClick={createCollection}><FolderPlus size={15} />新建文献集</button><button className="rw-primary" onClick={importPdf}><Plus size={16} />导入 PDF</button><div className="rw-popover-anchor"><button className="rw-icon-button" aria-label="更多文献工具" aria-expanded={toolsOpen} onClick={() => setToolsOpen(!toolsOpen)}><MoreHorizontal size={19} /></button>{toolsOpen && <><button className="rw-click-away" tabIndex={-1} aria-label="关闭工具菜单" onClick={() => setToolsOpen(false)} /><div className="rw-menu" role="menu">{[[RefreshCw, metadataState.running ? `正在解析 ${metadataState.done}/${metadataState.total} 篇` : '补全缺失文献信息', () => { if (!metadataState.running) void metadata.run((selectedPapers.length ? selectedPapers : visiblePapers).map(paper => paper.file)); }], [Download, '导出 BibTeX', exportBibliography], [Settings2, '阅读与外观设置', () => document.querySelector('#settings-button').click()], [Folder, '数据文件夹', context.openStorage], [Download, '迁移 Obsidian 数据', () => document.querySelector('#migration-button').click()], [SlidersHorizontal, '文献维护工具', () => model.openMaintenanceCenter()]].filter(row => row[2]).map(([Icon, text, action]) => <button role="menuitem" key={text} onClick={() => { setToolsOpen(false); action(); }}><Icon size={16} />{text}</button>)}</div></>}</div></div>
    </header>
    </div>
    {columnMenu && <ColumnMenu anchor={columnMenu} hidden={columnLayout.hidden} onClose={closeColumnMenu}
      onToggle={id => setColumnLayout(previous => ({ ...previous, hidden: previous.hidden.includes(id) ? previous.hidden.filter(value => value !== id) : [...previous.hidden, id] }))}
      onReset={() => { setColumnLayout(readColumnLayout()); closeColumnMenu(true); }} />}
    <div className="rw-workbench-content">

    <aside className={`rw-library-nav ${navigationOpen ? 'is-open' : ''}`} aria-label="文献分类">
      <div className="rw-nav-heading"><span>文献分类</span><button className="rw-icon-button rw-nav-close" aria-label="关闭文献分类" onClick={() => setNavigationOpen(false)}><X size={16} /></button></div>
      <nav aria-label="快捷文献视图">
        <div className="rw-nav-shortcuts" role="group" aria-label="文献视图">
        {navItem('all', '', '全部文献', Library, activePapers.length)}
        {navItem('recent', '', '最近加入', Clock3, activePapers.filter(paper => Date.now() - new Date(paper.dateAdded || paper.mtime).getTime() < 30 * 86400000).length)}
        {navItem('starred', '', '重点文献', Star, activePapers.filter(paper => paper.rating >= 4).length)}
        </div>
        <div className="rw-nav-queue" role="group" aria-label="阅读队列">
        <div className="rw-nav-group-label">阅读队列</div>
        {navItem('status', 'inbox', '待整理', Inbox, papers.filter(paper => paper.status === 'inbox').length)}
        {navItem('status', 'queued', STATES.queued, Clock3, papers.filter(paper => paper.status === 'queued').length)}
        {navItem('status', 'reading', '阅读中', BookOpen, papers.filter(paper => paper.status === 'reading').length)}
        {navItem('status', 'read', STATES.read, CheckCheck, papers.filter(paper => paper.status === 'read').length)}
        </div>
        {[['projects', '科研课题', FolderKanban], ['collections', '文献集', Folder], ['topics', '研究主题', Tag]].map(([field, label, Icon]) => <div className="rw-nav-group" role="group" aria-label={`${label}分类`} key={field}>
          <div data-collection-root={field === 'collections' ? 'true' : undefined} className={`rw-nav-group-label ${field === 'collections' && collectionDrop?.position === 'root' ? 'is-tree-drop-root' : ''}`}><button className="rw-nav-group-toggle" aria-expanded={expandedGroups[field]} onClick={() => setExpandedGroups(previous => ({ ...previous, [field]: !previous[field] }))}>{expandedGroups[field] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{label}<span>{organizations[field].length + (field === 'projects' ? workbenchTopics.filter(t => !t.archived).length : 0)}</span></button>{field === 'collections' && <button className="rw-icon-button" aria-label="新建文献集" onClick={createCollection}><Plus size={14} /></button>}</div>
          {expandedGroups[field] && <div className="rw-nav-children">{field === 'projects' && workbenchTopics.filter(t => !t.archived).map(t => navItem('workbench-topic', t.id, t.title, FolderKanban, papers.filter(p => t.paperIds.includes(p.file.path)).length))}{field === 'collections' ? <CollectionNavigation tree={collectionStructure} counts={new Map(organizations.collections)} navItem={navItem} scope={scope} drop={collectionDrop} busy={busy} toggle={name => { void collectionTree.toggle(name).catch(error => new Notice(error.message)); }} startDrag={startCollectionDrag} endDrag={clearDrag} /> : organizations[field].map(([name, count]) => navItem(field, name, plainName(name), Icon, count))}
          {!organizations[field].length && (field !== 'projects' || !workbenchTopics.some(t => !t.archived)) && <span className="rw-nav-empty">{field === 'collections' ? '还没有文献集' : field === 'projects' ? '尚未关联课题' : '尚未添加主题'}</span>}</div>}
        </div>)}
        <div className="rw-nav-utilities" role="group" aria-label="文献整理">
        {navItem('unfiled', '', '未分类文献', Inbox, activePapers.filter(paper => !paper.collections.length && !paper.topics.length && !paper.projects.length && !workbenchTopics.some(t => t.paperIds.includes(paper.file.path))).length)}
        {navItem('status', 'archived', '已归档', Archive, papers.filter(paper => paper.status === 'archived').length)}
        </div>
      </nav>
    </aside>
    {navigationOpen && <button className="rw-nav-scrim" aria-label="收起文献分类" onClick={() => setNavigationOpen(false)} />}
    <section className="rw-library-sheet" aria-label="文献工作区">
      <div className="rw-collection-toolbar"><div className="rw-scope-toolbar"><h2>{scopeTitle}</h2>{batchCount > 0 && <div className="rw-import-batch"><button className={scope.kind === 'import' ? 'is-active' : ''} aria-label={`查看本次导入的 ${batchCount} 篇文献`} aria-pressed={scope.kind === 'import'} onClick={revealBatch}><Download size={12} /><span>本次导入</span><span>{batchCount}</span></button><button className="rw-import-batch-close" aria-label="关闭本次导入入口" onClick={() => { imports.dismiss(); setPinImports(false); if (scope.kind === 'import') changeScope({ kind: 'all', name: '' }); }}><X size={12} /></button></div>}<div className="rw-view-tabs" role="tablist" aria-label="文献展示"><button role="tab" aria-selected={view === 'papers'} onClick={() => setView('papers')}><FileText size={15} />文献</button><button role="tab" aria-selected={view === 'figures'} onClick={() => setView('figures')}><ImageIcon size={15} />图表摘录</button><button role="tab" aria-selected={view === 'annotations'} onClick={() => setView('annotations')}><Quote size={15} />阅读记录</button></div></div>
      <div className="rw-filter-toolbar">
        {view === 'papers' && <label className="rw-heatmap-control" title="标题背景按页显示阅读分布：颜色越深，阅读时长或笔记越多；透明表示无记录"><ChartNoAxesColumn size={14} /><select aria-label="标题背景热图" value={heatmap} onChange={event => setHeatmap(event.target.value)}><option value="time">时长热图</option><option value="notes">笔记热图</option><option value="off">关闭热图</option></select></label>}
        {view === 'papers' && <button className="rw-icon-button rw-touch-select-toggle" aria-label={multiSelect ? '结束多选' : '多选文献'} aria-pressed={multiSelect} onClick={() => setMultiSelect(!multiSelect)}><CheckCheck size={16} /></button>}
        {view === 'papers' && <button className="rw-icon-button" aria-label="选择显示列" aria-haspopup="menu" aria-expanded={Boolean(columnMenu)} onClick={event => columnMenu ? closeColumnMenu(true) : openColumnMenu(event)}><Columns3 size={16} /></button>}
        <label className="rw-sort"><ArrowUpDown size={14} /><select aria-label="文献排序" value={sort} onChange={event => { setPinImports(false); setSort(event.target.value); setSortDirection("default"); }}><option value="added">最近加入</option><option value="edited">最近编辑</option><option value="year">发表年份</option><option value="title">标题排序</option><option value="rating">重要程度</option><option value="impact">影响因子</option><option value="venue">出版物</option><option value="authors">创建者</option></select></label>
        <button className="rw-icon-button rw-density-button" aria-label={compact ? '切换舒适行高' : '切换紧凑行高'} aria-pressed={compact} onClick={() => setCompact(!compact)}><SlidersHorizontal size={16} /></button>
        {view !== 'annotations' && <button className="rw-icon-button rw-detail-toggle" aria-label={detailOpen ? '收起论文详情' : '展开论文详情'} aria-pressed={detailOpen} onClick={() => setDetailOpen(!detailOpen)}>{detailOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}</button>}
      </div>
      </div>
      {filtersOpen && <div className="rw-filter-fields"><label>阅读状态<select aria-label="筛选阅读状态" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">全部状态</option>{Object.entries(STATES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>发表年份<select aria-label="筛选发表年份" value={yearFilter} onChange={event => setYearFilter(event.target.value)}><option value="all">全部年份</option>{[...new Set(scopePapers.map(paper => String(paper.year)).filter(Boolean))].sort().reverse().map(year => <option key={year}>{year}</option>)}</select></label><button className="rw-text-button" onClick={() => { setStatusFilter('all'); setYearFilter('all'); setQuery(''); }}>重置筛选</button></div>}
      {(selectedPapers.length > 1 || multiSelect) && <div className="rw-bulk-toolbar"><span>已选 {dragCount || selectedPapers.length} 篇</span><select aria-label="批量设置阅读状态" value="" disabled={busy || !selectedPapers.length} onChange={event => void bulkStatus(event.target.value)}><option value="" disabled>设置阅读状态</option>{Object.entries(STATES).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select><button onClick={exportBibliography} disabled={!selectedPapers.length}><Download size={14} />导出引用</button><button className="rw-text-button" onClick={selectAllVisible}>全选当前结果</button><button className="rw-text-button" onClick={clearSelection}>取消选择</button></div>}
      <div className="rw-library-body">
        <section className="rw-paper-list" aria-label={view === 'papers' ? '文献列表' : view === 'figures' ? '图表摘录列表' : '阅读记录列表'}>
          {view === 'papers' ? <div className="rw-table-scroll"><table className="rw-paper-table" role="grid" aria-label="文献列表，支持多选" aria-multiselectable="true" onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && !event.target.closest('input, select, textarea, [contenteditable=true]')) { event.preventDefault(); event.stopPropagation(); selectAllVisible(); } }} style={{ width: shownColumns.reduce((total, column) => total + columnLayout.widths[column.id], 0) }}><colgroup>{shownColumns.map(column => <col key={column.id} style={{ width: columnLayout.widths[column.id] }} />)}</colgroup><thead onContextMenu={openColumnMenu} onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openColumnMenu(event); }}><tr>{shownColumns.map(columnHeader)}</tr></thead><tbody>{visiblePapers.map((paper, index) => <React.Fragment key={paper.file.path}><tr tabIndex={active?.file.path === paper.file.path ? 0 : -1} data-paper-index={index} draggable={!busy} onPointerDownCapture={event => { dragFromControl.current = Boolean(event.target.closest('button, input, select, textarea, a, [contenteditable=true]')); }} onDragStart={event => startPaperDrag(event, paper)} onDragEnd={clearDrag} aria-selected={highlightedPaths.has(paper.file.path)} className={`rw-paper-row ${index % 2 ? 'is-alternate' : ''} ${highlightedPaths.has(paper.file.path) ? 'is-active' : ''}`} onContextMenu={event => contextMenu.paper(event, paper)} onKeyDown={event => { if (!contextKey(event, e => contextMenu.paper(e, paper))) navigateRows(event, index); }} onClick={event => { event.currentTarget.focus({ preventScroll: true }); selectRows(paper, event, true); }} onDoubleClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !multiSelect && paper.pdf) void openPdf(paper); }}>
            
            <td className="rw-title-cell" title={`${paper.title} · ${formatReadingTime((readingPages.get(paper.file.path) || []).reduce((sum, page) => sum + page.seconds, 0))}阅读 · ${(readingPages.get(paper.file.path) || []).reduce((sum, page) => sum + page.notes, 0)}条笔记`}><TitleHeatmap pages={readingPages.get(paper.file.path) || []} mode={heatmap} /><div className="rw-paper-identity"><button className="rw-disclosure" aria-label={`${expandedPapers.has(paper.file.path) ? '收起' : '展开'}附件：${paper.title}`} aria-expanded={expandedPapers.has(paper.file.path)} disabled={!paper.pdf && !app.paperAttachments.list(paper.file).length} onClick={event => { event.stopPropagation(); setExpandedPapers(previous => { const next = new Set(previous); next.has(paper.file.path) ? next.delete(paper.file.path) : next.add(paper.file.path); return next; }); }} onDoubleClick={event => event.stopPropagation()}><ChevronRight size={12} /></button><button className={`rw-paper-icon rw-row-open ${paper.pdf ? 'has-pdf' : ''}`} title={paper.pdf ? '阅读 PDF' : '未关联 PDF'} aria-label={`阅读 ${paper.title}`} disabled={!paper.pdf || busy} onClick={event => { event.stopPropagation(); void openPdf(paper); }} onDoubleClick={event => event.stopPropagation()}><FileText size={15} strokeWidth={1.5} /></button><button title={`重要程度 ${paper.rating}/5 · 点击${paper.rating >= 4 ? '取消重点' : '设为重点'}`} className={`rw-star-button ${paper.rating > 0 ? 'has-rating' : ''}`} aria-label={`${paper.rating >= 4 ? '取消重点' : '设为重点'}：${paper.title}`} aria-pressed={paper.rating >= 4} onClick={event => { event.stopPropagation(); void update(paper, { rating: paper.rating >= 4 ? 0 : 4 }); }} onDoubleClick={event => event.stopPropagation()}>{Array.from({ length: Math.max(1, Math.min(5, Math.round(paper.rating || 0))) }, (_, n) => <Star key={n} size={12} fill={paper.rating > 0 ? 'currentColor' : 'none'} />)}</button><span className="rw-paper-title" title={paper.title}>{paper.title}</span>{importState.unread[paper.file.path] && <span className="rw-new-import" title="新导入" aria-label="新导入">新</span>}</div><span className="rw-mobile-byline">{[columnVisible('authors') && shortAuthors(paper), columnVisible('year') && (paper.year || '—'), columnVisible('venue') && (venueLabel(paper) || '发表来源待补充')].filter(Boolean).join(' · ')}</span></td>
            {columnVisible('impact') && <td className="rw-impact-cell">{impactFactor(paper) === null ? <span className="rw-missing">—</span> : <span className="rw-impact" title={`影响因子 ${impactFactor(paper)} · 标记位置相对于本库最高值（标尺至少为 10）`}><span className="rw-impact-track"><i style={{ left: `${Math.min(100, impactFactor(paper) / impactMaximum * 100)}%` }} /></span><span>{impactFactor(paper).toFixed(1)}</span></span>}</td>}
            {columnVisible('venue') && <td className="rw-venue-cell" title={paper.venue}>{venueLabel(paper) || <span className="rw-missing">—</span>}</td>}
            {columnVisible('authors') && <td className="rw-author-cell" title={paper.authors.join(', ')}>{paper.authors.length ? paper.authors[0] + (paper.authors.length > 1 ? ' 等' : '') : <span className="rw-missing">—</span>}</td>}
            {columnVisible('year') && <td className="rw-year-cell">{paper.year || <span className="rw-missing">—</span>}</td>}
            {columnVisible('state') && <td className="rw-state-cell" onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}><StatusPicker label={`设置阅读状态：${paper.title}`} value={paper.status} disabled={busy} onChange={status => changeStatus(paper, status)} /></td>}
            {columnVisible('ranks') && <td className="rw-ranks-cell"><PaperBadges className="rw-inline-badges" badges={rowBadges(paper, 'rank')} limit={3} />{!rowBadges(paper, 'rank').length && <span className="rw-missing">—</span>}</td>}
            {columnVisible('tags') && <td className="rw-tags-cell" title="编辑标签" onDoubleClick={event => { event.stopPropagation(); if (!busy) setTagEditing([paper]); }}><PaperBadges className="rw-inline-badges" badges={rowBadges(paper, 'topic')} limit={4} />{!rowBadges(paper, 'topic').length && <span className="rw-missing">—</span>}</td>}
            {columnVisible('note') && <td className="rw-remark-cell"><PaperRemark paper={paper} vault={vault} onSaved={refresh} disabled={busy} /></td>}
          </tr>{expandedPapers.has(paper.file.path) && <PaperAttachmentRows app={app} paper={paper} columns={shownColumns.length} clearDrag={clearDrag} />}</React.Fragment>)}</tbody></table>{!visiblePapers.length && <div className="rw-list-empty"><BookOpen size={32} strokeWidth={1} /><h2>{papers.length ? '没有匹配的文献' : '把第一篇论文放进来'}</h2><p>{papers.length ? '试试其他关键词，或清除当前筛选。' : '导入 PDF，或从原 Obsidian 文献库迁移论文与阅读记录。'}</p><button className="rw-secondary" onClick={papers.length ? () => { setQuery(''); changeScope({ kind: 'all', name: '' }); } : importPdf}>{papers.length ? '查看全部文献' : '导入 PDF'}</button></div>}</div> : view === 'annotations' ? <div className="rw-excerpt-list">{visibleAnnotations.map(row => <button className="rw-excerpt-row" key={row.annotation.id} onContextMenu={event => contextMenu.annotation(event, row)} onKeyDown={event => contextKey(event, e => contextMenu.annotation(e, row))} onClick={() => showExcerpt(row)}><div className="rw-excerpt-source"><FileText size={15} /><span>{plainName(row.filePath)}</span><span>第 {Number(row.annotation.page || 0) + 1} 页</span></div>{row.annotation.type === 'region' && reader.getRegionPreviewSrc(row.annotation) && <img src={reader.getRegionPreviewSrc(row.annotation)} alt={row.annotation.comment || '区域摘录'} />}{row.annotation.text && <blockquote>{row.annotation.text}</blockquote>}{row.annotation.comment && <p>{row.annotation.comment}</p>}<small>{row.annotation.tags?.join(' · ') || (row.annotation.type === 'region' ? '图表摘录' : '阅读批注')}{!vault.getAbstractFileByPath(row.filePath) && ' · 原 PDF 缺失'}</small></button>)}{!visibleAnnotations.length && <div className="rw-list-empty"><Quote size={28} strokeWidth={1.2} /><h2>还没有阅读记录</h2><p>阅读 PDF 时添加高亮、批注或区域摘录，记录会保存在这里。</p></div>}</div> : <div className="rw-figure-grid">{figures.map(figure => <button key={figure.id} className="rw-figure" onContextMenu={event => figure.annotation ? contextMenu.annotation(event, figure) : figure.paper && contextMenu.paper(event, figure.paper)} onKeyDown={event => contextKey(event, e => figure.annotation ? contextMenu.annotation(e, figure) : figure.paper && contextMenu.paper(e, figure.paper))} onClick={() => { if (figure.paper) { selectPaper(figure.paper); setDetailTab('annotations'); } else showExcerpt(figure); }}><img src={figure.src} alt={figure.label} /><span>{figure.label}</span><small>{figure.paper?.title || plainName(figure.filePath)}</small></button>)}{!figures.length && <div className="rw-list-empty"><ImageIcon size={32} strokeWidth={1} /><h2>还没有图表摘录</h2><p>阅读 PDF 时框选方法图或实验结果，摘录会按论文保存在这里。</p>{active?.pdf && <button className="rw-secondary" onClick={() => openPdf(active)}>打开 PDF 摘录</button>}</div>}</div>}
          <footer className="rw-list-footer"><span>{view === 'annotations' ? `${visibleAnnotations.length} 条阅读记录` : visiblePapers.length ? `1–${visiblePapers.length} / ${scopePapers.length} 篇文献` : '0 篇文献'}</span><span>{busy ? '正在保存…' : view === 'annotations' ? '点击记录查看原文与批注' : view === 'figures' ? '点击图表查看摘录' : 'Ctrl 多选 · Shift 连选 · Ctrl+A 全选 · 双击阅读 PDF'}</span></footer>
        </section>
        {detailOpen && view !== 'annotations' && <><DetailResizeHandle width={detailWidth} onResize={setDetailWidth} /><aside className="rw-paper-detail" aria-label="论文详情"><div className="rw-detail-heading"><button className="rw-icon-button rw-back-list" aria-label="返回文献列表" onClick={() => setMobileDetail(false)}><ArrowLeft size={18} /></button><span>论文详情</span><button className="rw-icon-button" aria-label="关闭论文详情" onClick={() => { setMobileDetail(false); setDetailOpen(false); }}><X size={16} /></button></div>{active ? <><div className="rw-detail-intro"><span className="rw-paper-kind"><FileText size={14} />研究论文</span><h2>{active.title}</h2><p className="rw-detail-authors" title={active.authors.join(', ')}>{active.authors.join(', ') || '作者待补充'}</p><p className="rw-detail-venue" title={active.venue}>{[venueLabel(active), active.year].filter(Boolean).join(' · ') || '发表信息待补充'}</p><PaperBadges className="rw-detail-badges" badges={badgesByPath.get(active.file.path)} limit={12} /><div className="rw-detail-remark"><span className="rw-detail-remark-label">备注</span><PaperRemark key={active.file.path} paper={active} vault={vault} onSaved={refresh} disabled={busy} detail /></div><button className="rw-primary rw-read-button" disabled={!active.pdf || busy} title={!active.pdf ? '此文献尚未关联 PDF' : '打开本地 PDF'} onClick={() => openPdf(active)}><BookOpen size={16} />阅读 PDF<ArrowUpRight size={16} /></button></div>
          <div className="rw-detail-tabs" role="tablist" aria-label="论文详情内容">{[['info', '信息'], ['notes', '笔记'], ['annotations', '摘录'], ['attachments', '附录']].map(([key, text]) => <button key={key} role="tab" aria-selected={detailTab === key} onClick={() => setDetailTab(key)}>{text}{key === 'annotations' && paperAnnotations.length > 0 && <span>{paperAnnotations.length}</span>}{key === 'attachments' && app.paperAttachments.list(active.file).length > 0 && <span>{app.paperAttachments.list(active.file).length}</span>}</button>)}</div>
          <div className="rw-detail-content">
            {detailTab === 'info' && <><div className="rw-detail-section"><div className="rw-section-heading"><h3>阅读进度</h3></div><div className="rw-info-row"><span>状态</span><StatusPicker value={active.status} disabled={busy} onChange={status => changeStatus(active, status)} /></div><div className="rw-info-row rw-reading-date"><span>首次开始</span><time dateTime={active.dateStarted || undefined}>{formatDate(active.dateStarted)}</time></div><div className="rw-info-row rw-reading-date"><span>首次读完</span><time dateTime={active.dateRead || undefined}>{formatDate(active.dateRead)}</time></div><div className="rw-info-row"><span>重要程度</span><div className="rw-rating">{[1, 2, 3, 4, 5].map(rating => <button key={rating} aria-label={`评分 ${rating}/5`} aria-pressed={active.rating >= rating} onClick={() => update(active, { rating: active.rating === rating ? 0 : rating })}><Star size={17} fill={active.rating >= rating ? 'currentColor' : 'none'} /></button>)}</div></div></div>
              <PaperReadingActivity title={app.paperAttachments.list(active.file).length ? '正文逐页阅读' : '逐页阅读'} pages={readingPages.get(active.file.path) || []} knownPageCount={Boolean(activity.get(pdfPath(active))?.pageCount)} onPage={active.pdf ? page => openPdf(active, page) : null} />
              <PaperTags paper={active} disabled={busy} edit={() => setTagEditing([active])} remove={tag => void run(() => editPaperTags(vault, [active.file], { remove: [tag] }))} />
              <div className="rw-detail-section"><div className="rw-section-heading"><h3>归属与主题</h3></div>{[['projects', 'project', '科研课题'], ['collections', 'collection', '文献集'], ['topics', 'topic', '研究主题']].map(([field, type, text]) => field === 'projects' ? <WorkbenchTopicMembership key={field} paper={active} topics={workbenchTopics} legacy={active.projects.map(plainName)} editLegacy={() => organizationEditor(active, field, type, text)} /> : <div key={field} className="rw-organization-field"><span>{text}</span><button aria-label={`编辑${text}`} onClick={() => organizationEditor(active, field, type, text)}>{active[field].length ? active[field].map(plainName).join('、') : `添加${text}`}<Plus size={12} /></button></div>)}</div>
              <div className="rw-detail-section"><div className="rw-section-heading"><h3>文献信息</h3><button className="rw-text-button" onClick={() => editPaper(active)}>编辑</button></div><dl className="rw-metadata"><div><dt>引用键</dt><dd>{active.citekey || '—'}</dd></div><div><dt>DOI</dt><dd>{active.doi ? <a href={`https://doi.org/${active.doi}`} target="_blank" rel="noreferrer">{active.doi}<ArrowUpRight size={12} /></a> : '—'}</dd></div><div><dt>加入日期</dt><dd>{formatDate(active.dateAdded)}</dd></div><div><dt>本地原文</dt><dd title={active.pdf}>{active.pdf ? plainName(active.pdf) : '未关联 PDF'}</dd></div></dl><button className="rw-citation-button" onClick={() => copyCitation(active)}><Quote size={14} />复制 BibTeX<Copy size={13} /></button></div>
              <MetadataResult paper={active} vault={vault} metadata={metadata} state={metadataState} />
              <MetricSources fm={frontmatter(vault.texts.get(active.file.path) || '')} />
              <div className="rw-detail-section"><div className="rw-section-heading"><h3>摘要</h3></div><p className="rw-abstract">{active.abstract || '暂无摘要，可在文献信息中补充。'}</p></div></>}
            {detailTab === 'notes' && <ResearchNotes key={active.file.path} file={active.file} title={active.title} app={app} />}
            {detailTab === 'attachments' && <PaperAttachments key={active.file.path} app={app} paper={active} clearDrag={clearDrag} />}
            {detailTab === 'annotations' && <div className="rw-detail-section"><div className="rw-section-heading"><h3>阅读摘录</h3><span>{paperAnnotations.length} 条</span></div>{paperAnnotations.length ? paperAnnotations.map(({ annotation, filePath }) => <button className="rw-annotation" key={annotation.id} onContextMenu={event => contextMenu.annotation(event, { annotation, filePath })} onKeyDown={event => contextKey(event, e => contextMenu.annotation(e, { annotation, filePath }))} onClick={() => void run(() => reader.openAnnotationEditor(filePath, annotation.id))}><span className="rw-annotation-page">{!hasMainAnnotation({ filePath }, active) && `${app.paperAttachments.list(active.file).find(item => item.path === filePath)?.name || plainName(filePath)} · `}第 {Number(annotation.page || 0) + 1} 页 · {annotation.type === 'region' ? '图表摘录' : annotation.type === 'note' ? '便签' : '划线'}</span>{annotation.type === 'region' && reader.getRegionPreviewSrc(annotation) && <img src={reader.getRegionPreviewSrc(annotation)} alt={annotation.comment || 'PDF 区域摘录'} />}{annotation.text && <blockquote>{annotation.text}</blockquote>}{annotation.comment && <p>{annotation.comment}</p>}{annotation.tags?.length > 0 && <small>{annotation.tags.join(' · ')}</small>}</button>) : <div className="rw-detail-empty"><p>还没有阅读摘录。</p><p>PDF 中的高亮、批注和区域截图会出现在这里。</p></div>}</div>}
          </div></> : <div className="rw-detail-empty"><BookOpen size={26} strokeWidth={1.3} /><h3>选一篇论文，开始阅读</h3><p>文献信息、研究笔记和 PDF 摘录会聚在这里。</p></div>}</aside></>}
      </div>
    </section>
    </div>
    {contextMenu.menu}
    {tagEditing && <TagEditor app={app} papers={tagEditing} suggestions={papers.flatMap(paper => paper.keywords)} save={saveTags} close={() => setTagEditing(null)} />}
    {metricsOpen && <MetricsDialog metrics={metrics} state={metricsState} files={(selectedPapers.length ? selectedPapers : visiblePapers).map(paper => paper.file)} close={() => setMetricsOpen(false)} />}
    {(dragging || (dragCount > 0 && dropTarget)) && <div className="rw-drop-overlay">{dragCount ? <Folder size={16} /> : <Download size={16} />}<strong>{dragCount ? `添加 ${dragCount} 篇至 ${plainName(dropTarget.name)}` : dropTarget ? `导入至 ${plainName(dropTarget.name)}` : '导入文献库'}</strong></div>}
    {editing && <div className="rw-edit-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setEditing(null); }}><form className="rw-edit-dialog" role="dialog" aria-modal="true" aria-label="编辑文献信息" onSubmit={event => { event.preventDefault(); void run(async () => { await processFrontMatter(vault, editing.paper.file, fm => { const manualMetadata = new Set(fm.metadata_manual_fields || []); for (const field of ['title', 'authors', 'year', 'venue', 'doi', 'abstract']) { const previous = field === 'authors' ? editing.paper.authors.join('; ') : String(fm[field] ?? ''); if (String(previous).trim() !== String(editing[field]).trim()) manualMetadata.add(field); } if (manualMetadata.size) fm.metadata_manual_fields = [...manualMetadata]; const manual = new Set(fm.metrics_manual_fields || []); for (const [field, aliases] of Object.entries(metricFields)) { const previous = aliases.map(alias => fm[alias]).find(value => value !== undefined && value !== null && String(value).trim() !== '') ?? ''; if (String(previous).trim() !== String(editing[field]).trim()) { manual.add(field); if (fm.metrics_auto) delete fm.metrics_auto[field]; } } if (manual.size) fm.metrics_manual_fields = [...manual]; for (const key of ['title', 'year', 'venue', 'doi', 'pdf', 'abstract', 'note', 'impact_factor', 'jcr_quartile', 'cas_zone', 'ccf_rank']) fm[key] = editing[key]; for (const alias of ['journal_if', 'IF', 'sci_quartile', 'jcr', 'cas_partition', 'cas_quartile', 'ccf_rating', 'ccf']) delete fm[alias]; fm.authors = editing.authors.split(/[;；]/).map(value => value.trim()).filter(Boolean); }); setEditing(null); }); }}><div className="rw-edit-title"><h2>文献信息</h2><button type="button" className="rw-icon-button" aria-label="关闭编辑" onClick={() => setEditing(null)}><X size={18} /></button></div>{[['title', '论文标题'], ['authors', '作者（分号分隔）'], ['year', '发表年份'], ['venue', '会议 / 期刊'], ['doi', 'DOI'], ['pdf', 'PDF 文件路径'], ['impact_factor', '影响因子'], ['jcr_quartile', 'JCR 分区'], ['cas_zone', '中科院分区'], ['ccf_rank', 'CCF 等级'], ['abstract', '摘要'], ['note', '简短备注']].map(([field, label]) => <label key={field}>{label}{field === 'abstract' || field === 'note' ? <textarea value={editing[field]} onChange={event => setEditing({ ...editing, [field]: event.target.value })} /> : <input type={field === 'impact_factor' ? 'number' : 'text'} min={field === 'impact_factor' ? '0' : undefined} step={field === 'impact_factor' ? 'any' : undefined} required={field === 'title'} value={editing[field]} onChange={event => setEditing({ ...editing, [field]: event.target.value })} />}</label>)}<div className="rw-edit-actions"><button type="button" className="rw-secondary" onClick={() => setEditing(null)}>取消</button><button type="submit" className="rw-primary" disabled={busy}>{busy ? '正在保存…' : '保存修改'}</button></div></form></div>}
  </div>;
}

function MetricsDialog({ metrics, state, files, close }) {
  const [key, setKey] = useState('');
  const [enabled, setEnabled] = useState(state.enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const configure = async (remove = false) => {
    setSaving(true); setError('');
    try { await metrics.configure(remove ? { key: '', enabled: false } : { ...(key.trim() ? { key: key.trim() } : {}), enabled }); setKey(''); if (remove) setEnabled(false); }
    catch (error) { setError(error.message); }
    finally { setSaving(false); }
  };
  return <div className="rw-edit-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><section className="rw-edit-dialog rw-metrics-dialog" role="dialog" aria-modal="true" aria-label="期刊指标与自动匹配"><div className="rw-edit-title"><h2>期刊指标与自动匹配</h2><button className="rw-icon-button" aria-label="关闭指标设置" onClick={close}><X size={18} /></button></div>
    <div className="rw-metrics-sources"><span>CCF 2026 · 官方第七版</span><span>easyScholar · {state.configured ? '已配置' : '未配置'}</span></div>
    <p className="rw-metrics-description">按发表来源批量匹配 IF、SCI / JCR、中科院分区与 CCF。已有手动值优先保留；同一期刊去重查询，成功结果缓存 30 天。IF 与分区采用服务当前返回版本，并非论文发表年份的历史指标。</p>
    {state.available ? <form className="rw-metrics-config" onSubmit={event => { event.preventDefault(); void configure(); }}><label><KeyRound size={14} />easyScholar 密钥<input aria-label="easyScholar 密钥" type="password" autoComplete="off" spellCheck={false} value={key} placeholder={state.configured ? '已加密保存；留空保持原密钥' : '输入 Secret Key'} onChange={event => setKey(event.target.value)} /></label><label className="rw-metrics-check"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />导入或修改发表来源后自动在线匹配</label><div className="rw-metrics-config-actions"><button className="rw-secondary" disabled={saving} type="submit">{saving ? '正在保存…' : '保存设置'}</button>{state.configured && <button className="rw-text-button" disabled={saving} type="button" onClick={() => void configure(true)}>移除密钥</button>}</div></form> : <p className="rw-metrics-description">{state.message || '在线指标查询需要 Electron 桌面版；CCF 官方目录可离线自动匹配。'}</p>}
    <p className="rw-metrics-privacy">密钥使用系统加密保存在本机，页面不回显。在线查询只发送期刊 / 会议名称；需要补全来源时以 DOI 查询 Crossref，不上传 PDF 或笔记。</p>
    {error && <p className="rw-metrics-error" role="alert">{error}</p>}
    <div className="rw-metrics-run"><button className="rw-primary" disabled={state.running || saving || !files.length} onClick={() => void metrics.run(files, { remote: state.configured })}><RefreshCw size={15} />匹配当前 {files.length} 篇</button><button className="rw-secondary" disabled={state.running || saving} onClick={() => void metrics.run(undefined, { remote: state.configured })}>匹配全库</button><span role="status">{state.running ? `${state.done} / ${state.total}` : state.message}</span></div>
    {state.running && <progress max={Math.max(1, state.total)} value={state.done} aria-label="指标匹配进度" />}
    {state.reports.length > 0 && <div className="rw-metrics-report" aria-label="指标匹配结果">{state.reports.map((row, index) => <div key={index}><span className={row.status === '查询失败' ? 'rw-metrics-error' : ''}>{row.status}</span><div><strong title={row.title}>{row.title}</strong><small>{row.reason}</small></div></div>)}</div>}
  </section></div>;
}

function MetadataResult({ paper, vault, metadata, state }) {
  const fm = frontmatter(vault.texts.get(paper.file.path) || '');
  if (!fm.metadata_status) return null;
  return <div className="rw-detail-section"><div className="rw-section-heading"><h3>文献信息识别</h3><button className="rw-text-button" disabled={state.running} onClick={() => void metadata.run([paper.file])}>{fm.metadata_status === 'processing' ? '正在解析…' : '重新解析'}</button></div><p className="rw-metadata-result" role="status">{fm.metadata_message || '等待自动解析…'}{fm.metadata_source === 'pdf' && fm.doi && !fm.metadata_online_error && <span>；当前采用 PDF 信息，可重新解析以在线核对。</span>}</p></div>;
}

function MetricSources({ fm }) {
  const rows = Object.entries(fm.metrics_auto || {});
  if (!rows.length) return null;
  const labels = { impact_factor: '影响因子', jcr_quartile: 'SCI / JCR', cas_zone: '中科院', ccf_rank: 'CCF' };
  return <div className="rw-detail-section rw-metric-provenance"><div className="rw-section-heading"><h3>指标来源</h3></div>{rows.map(([field, record]) => <div key={field}><strong>{labels[field] || field} · {record.value}</strong><span>{record.source === 'easyScholar' ? 'easyScholar' : <a href={record.source} target="_blank" rel="noreferrer">CCF 官方目录<ArrowUpRight size={11} /></a>}</span><small>{record.edition}</small><small>匹配于 {(record.fetched_at || record.checked_at || '').slice(0, 10)}</small></div>)}</div>;
}

let root;
export function mountLibraryWorkspace(context) {
  root ||= createRoot(document.querySelector('#library-root'));
  root.render(<LibraryWorkspace key={context.library.currentModal ? context.generation : 0} context={context} />);
}
