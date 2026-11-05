import { Archive, ArchiveRestore, Copy, Pencil, Star, Trash2, CheckCheck, Folder, Circle, Flag } from 'lucide-react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { RecordItem, Status } from '../types';
import { STATUS_LABEL } from '../types';
import { useStore } from '../store';
import { requestEditor } from '../editorBus';
import { useContextMenu } from './ContextMenu';

export function useRecordContextMenu(record: RecordItem) {
  const menu = useContextMenu();
  const store = useStore();
  const type = store.types.find(item => item.id === record.typeId);
  const open = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => menu.open(event, [
    { label: '编辑条目', icon: <Pencil />, action: () => requestEditor({ recordId: record.id }) },
    { label: '复制条目', icon: <Copy />, action: () => store.duplicateRecord(record.id) },
    ...(type?.kind === 'todo' ? [{ label: record.done ? '标记为未完成' : '标记为完成', icon: <CheckCheck />, action: () => store.toggleDone(record.id) }] : [{ label: '设置状态', icon: <Circle />, children: (Object.entries(STATUS_LABEL) as [Status, string][]).map(([value, label]) => ({ label, checked: record.status === value, action: () => store.updateRecord(record.id, { status: value }) })) }]),
    { label: record.starred ? '移出今日重点' : '设为今日重点', icon: <Star />, action: () => store.toggleStar(record.id) },
    ...(type?.kind === 'direction' ? [{ label: record.priority === 'high' ? '设为次要方向' : '设为主要方向', icon: <Flag />, action: () => store.updateRecord(record.id, { priority: record.priority === 'high' ? 'none' : 'high' }) }] : []),
    { label: '移动到工作区', icon: <Folder />, separator: true, children: store.workspaces.map(workspace => ({ label: workspace.name, checked: record.workspaceId === workspace.id, action: () => store.updateRecord(record.id, { workspaceId: workspace.id }) })) },
    { label: record.archived ? '取消归档' : '归档条目', icon: record.archived ? <ArchiveRestore /> : <Archive />, action: () => store.archiveRecord(record.id, !record.archived) },
    { label: '删除条目…', icon: <Trash2 />, separator: true, danger: true, action: () => { if (window.confirm(`确定删除「${record.title}」吗？此操作不可恢复。`)) store.deleteRecord(record.id); } },
  ], record.title);
  return { menu: menu.menu, handlers: { onContextMenu: open, onKeyDown: (event: KeyboardEvent<HTMLElement>) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) open(event); } } };
}
