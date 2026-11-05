import React from 'react';
import { BookOpen, Pencil, Copy, Download, Star, Archive, Folder, Tag, FolderKanban, RefreshCw, Quote, FileText, Trash2, ArrowUpRight, Paperclip } from 'lucide-react';
import { useContextMenu } from '../components/ContextMenu';
import { Modal, Notice } from './obsidian.js';
import { saveReadingStatus, READING_STATES } from './reading-status.js';
import { processFrontMatter } from './vault.js';

const fields = [['collections', 'collection', '文献集', Folder], ['topics', 'topic', '研究主题', Tag], ['projects', 'project', '科研课题', FolderKanban]];

export function useLibraryContextMenu({ app, model, vault, reader, metrics, metadata, run, busy, selectedPapers, scope, changeScope, selectTargets, selectPaper, editPaper, editTags, openPdf, setDetailTab, organizations, closeOtherMenus, collectionTree, createCollection }) {
  const menu = useContextMenu();
  const copy = text => run(async () => { await navigator.clipboard.writeText(text); new Notice('已复制'); });
  const exportPapers = targets => {
    const blob = new Blob([targets.map(paper => model.bibtexForPaper(paper)).join('\n\n')], { type: 'application/x-bibtex;charset=utf-8' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'references.bib'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const promptName = (title, value, save) => {
    const modal = new Modal(app); modal.setTitle(title);
    const form = modal.contentEl.createEl('form');
    const input = form.createEl('input', { cls: 'port-source-path', attr: { 'aria-label': title, required: 'true' } }); input.value = value;
    const button = form.createEl('button', { cls: 'mod-cta', text: '保存', attr: { type: 'submit' } });
    form.onsubmit = event => { event.preventDefault(); if (!input.value.trim() || button.disabled) return; button.disabled = true; void run(async () => { try { await save(input.value.trim()); modal.close(); } finally { button.disabled = false; } }); };
    modal.open(); input.focus(); input.select();
  };
  const assign = (targets, field, type, name, remove = false) => run(async () => {
    for (const target of targets) await model.updatePaperOrganization(target, type, remove ? target[field].filter(value => value !== name) : [...new Set([...target[field], name])], { refresh: false });
  });
  const organizationActions = targets => fields.map(([field, type, label, Icon]) => ({ label: `添加到${label}`, icon: <Icon />, children: [
    ...organizations[field].map(([name]) => ({ label: name, checked: targets.every(paper => paper[field].includes(name)), action: () => assign(targets, field, type, name) })),
    { label: `新建${label}…`, separator: organizations[field].length > 0, action: () => promptName(`新建${label}`, '', async name => { const clean = await model.createOrganizationEntity(type, name); for (const target of targets) await model.updatePaperOrganization(target, type, [...new Set([...target[field], clean])], { refresh: false }); }) },
  ] }));
  const open = (event, items, label) => { closeOtherMenus(); menu.open(event, items, label); };
  const paper = (event, target) => {
    const targets = selectedPapers.some(paper => paper.file.path === target.file.path) ? [...selectedPapers] : [target];
    selectTargets(targets, target);
    const single = targets.length === 1;
    open(event, [
      ...(single ? [
        { label: '阅读 PDF', icon: <BookOpen />, disabled: !target.pdf, action: () => openPdf(target) },
        { label: '编辑文献信息', icon: <Pencil />, action: () => editPaper(target) },
        { label: '编辑研究笔记', icon: <FileText />, action: () => { selectPaper(target); setDetailTab('notes'); } },
        { label: '管理附录', icon: <Paperclip />, action: () => { selectPaper(target); setDetailTab('attachments'); } },
        ...(target.doi ? [{ label: '打开 DOI 网页', icon: <ArrowUpRight />, action: () => window.open(`https://doi.org/${target.doi}`, '_blank', 'noopener') }] : []),
      ] : []),
      { label: '设置阅读状态', icon: <BookOpen />, separator: single, children: Object.entries(READING_STATES).map(([status, label]) => ({ label, checked: targets.every(paper => paper.status === status), action: () => run(async () => { for (const target of targets) await saveReadingStatus(vault, target.file, status); }) })) },
      { label: '设置重要程度', icon: <Star />, children: [0, 1, 2, 3, 4, 5].map(rating => ({ label: rating ? `${rating} 星` : '取消评分', checked: targets.every(paper => paper.rating === rating), action: () => run(async () => { for (const target of targets) await processFrontMatter(vault, target.file, fm => { fm.rating = rating; }); }) })) },
      ...organizationActions(targets),
      { label: '编辑标签', icon: <Tag />, action: () => editTags(targets) },
      ...(['collections', 'topics', 'projects'].includes(scope.kind) ? [{ label: `从当前${fields.find(row => row[0] === scope.kind)[2]}移除`, icon: <Folder />, action: () => assign(targets, scope.kind, fields.find(row => row[0] === scope.kind)[1], scope.name, true) }] : []),
      { label: '复制 BibTeX', icon: <Quote />, separator: true, action: () => copy(targets.map(paper => model.bibtexForPaper(paper)).join('\n\n')) },
      { label: '导出 BibTeX', icon: <Download />, action: () => exportPapers(targets) },
      { label: '复制标题', icon: <Copy />, action: () => copy(targets.map(paper => paper.title).join('\n')) },
      { label: '重新解析文献信息', icon: <RefreshCw />, disabled: metadata.state.running || !targets.some(paper => paper.pdf), action: () => run(() => metadata.run(targets.filter(paper => paper.pdf).map(paper => paper.file))) },
      { label: '匹配期刊指标', icon: <RefreshCw />, disabled: metrics.state.running, action: () => run(() => metrics.run(targets.map(paper => paper.file), { remote: metrics.state.configured })) },
      { label: targets.every(paper => paper.status === 'archived') ? '恢复到待整理' : '归档文献', icon: <Archive />, separator: true, action: () => run(async () => { const status = targets.every(paper => paper.status === 'archived') ? 'inbox' : 'archived'; for (const target of targets) await saveReadingStatus(vault, target.file, status); }) },
    ].map(item => ({ ...item, disabled: busy || item.disabled })), single ? target.title : `已选 ${targets.length} 篇文献`);
  };
  const organization = (event, kind, name, label, source) => {
    if (kind === 'workbench-topic') {
      open(event, [
        { label: '查看文献', icon: <BookOpen />, action: () => changeScope({ kind, name }) },
        { label: '打开科研课题', icon: <FolderKanban />, action: () => window.parent.postMessage({ type: 'research-topic-open', id: name }, location.protocol === 'file:' ? '*' : location.origin) },
      ], label); return;
    }
    const config = fields.find(field => field[0] === kind);
    const tree = collectionTree.view(), node = tree.nodes.find(node => node.name === name);
    const siblings = tree.nodes.filter(item => item.parent === node?.parent), index = siblings.findIndex(item => item.name === name);
    const hasChildren = tree.nodes.some(item => item.parent === name);
    const targets = source.filter(paper => kind === 'all' ? paper.status !== 'archived' : kind === 'status' ? paper.status === name : kind === 'starred' ? paper.status !== 'archived' && paper.rating >= 4 : kind === 'recent' ? paper.status !== 'archived' && Date.now() - new Date(paper.dateAdded || paper.mtime).getTime() < 30 * 86400000 : kind === 'unfiled' ? paper.status !== 'archived' && !paper.collections.length && !paper.topics.length && !paper.projects.length && !(app.workbenchTopics || []).some(t => t.paperIds.includes(paper.file.path)) : paper.status !== 'archived' && paper[kind]?.includes(name));
    open(event, [
      { label: '查看文献', icon: <BookOpen />, action: () => changeScope({ kind, name }) },
      { label: '复制 BibTeX', icon: <Quote />, disabled: !targets.length, action: () => copy(targets.map(paper => model.bibtexForPaper(paper)).join('\n\n')) },
      { label: '导出 BibTeX', icon: <Download />, disabled: !targets.length, action: () => exportPapers(targets) },
      ...(config ? [
        ...(kind === 'collections' ? [
          { label: '新建子文献集…', icon: <Folder />, separator: true, action: () => createCollection(name) },
          { label: '上移', disabled: index <= 0, action: () => run(() => collectionTree.move(name, siblings[index - 1].name, 'before')) },
          { label: '下移', disabled: index < 0 || index === siblings.length - 1, action: () => run(() => collectionTree.move(name, siblings[index + 1].name, 'after')) },
          { label: '移至顶层', disabled: !node?.parent, action: () => run(() => collectionTree.move(name, null, 'root')) },
        ] : []),
        { label: `新建${config[2]}…`, icon: <Folder />, separator: true, action: () => promptName(`新建${config[2]}`, '', async value => { const clean = await model.createOrganizationEntity(config[1], value); changeScope({ kind, name: clean }); }) },
        { label: '重命名…', icon: <Pencil />, action: () => promptName('重命名', name, async value => { const clean = await model.renameOrganizationEntity(config[1], name, value); if (scope.kind === kind && scope.name === name) changeScope({ kind, name: clean }); }) },
        { label: `删除${config[2]}…`, icon: <Trash2 />, danger: true, separator: true, action: () => { if (window.confirm(`删除${config[2]}「${label}」并移除论文中的该关联？${kind === 'collections' && hasChildren ? '子文献集会上移一级。' : ''}论文、PDF 和阅读记录会保留。`)) void run(async () => { await model.deleteOrganizationEntity(config[1], name); if (scope.kind === kind && scope.name === name) changeScope({ kind: 'all', name: '' }); }); } },
      ] : []),
    ].map(item => ({ ...item, disabled: busy || item.disabled })), label);
  };
  const annotation = (event, row) => open(event, [
    { label: '定位到原文', icon: <BookOpen />, disabled: !vault.getAbstractFileByPath(row.filePath), action: () => run(() => reader.navigateToAnnotation(row.filePath, row.annotation.id)) },
    { label: '编辑批注', icon: <Pencil />, disabled: !vault.getAbstractFileByPath(row.filePath), action: () => run(() => reader.openAnnotationEditor(row.filePath, row.annotation.id)) },
    { label: '复制原文与批注', icon: <Copy />, disabled: !row.annotation.text && !row.annotation.comment, action: () => copy([row.annotation.text, row.annotation.comment].filter(Boolean).join('\n\n')) },
    { label: '复制 Markdown 引用', icon: <Quote />, action: () => run(() => reader.copyAnnotationMarkdown(row.filePath, row.annotation)) },
    { label: '删除摘录…', icon: <Trash2 />, danger: true, separator: true, action: () => { if (window.confirm('确定删除这条摘录？对应的高亮、批注或截图记录也会移除。')) void run(() => reader.removeAnnotation(row.filePath, row.annotation.id)); } },
  ].map(item => ({ ...item, disabled: busy || item.disabled })), `第 ${Number(row.annotation.page || 0) + 1} 页 · 阅读摘录`);
  return { paper, organization, annotation, menu: menu.menu, close: menu.close };
}
