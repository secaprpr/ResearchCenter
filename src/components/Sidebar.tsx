import { useState } from 'react';
import { LayoutGrid, Settings, Plus, Archive, PanelLeftClose, PanelLeftOpen, BookOpen } from 'lucide-react';
import { useStore, countForType } from '../store';
import { typeIcon } from '../icons';
import { FloatingNotes } from './MusicNotes';
import { requestEditor } from '../editorBus';
import clsx from 'clsx';
import { useLibraryStore } from '../library/store';

const SIDEBAR_COLLAPSED_KEY = 'research-workbench-sidebar-collapsed';

export function Sidebar() {
  const { types, records, view, setView, setStatusFilter, reorderType } = useStore();
  const paperCount = useLibraryStore(state => state.portedCount ?? state.papers.length);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [dragId, setDragId] = useState<string | null>(null);
  const isCollapsed = collapsed;
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);

  const countOf = (t: (typeof types)[number]) => countForType(records, t);

  const archivedCount = records.filter((r) => r.archived).length;

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
    } catch {
      // 存储不可用时仍允许在当前窗口收起和展开。
    }
  };

  const go = (v: string) => {
    setStatusFilter('all');
    setView(v);
  };

  const endDrag = () => {
    setDragId(null);
    setOver(null);
  };

  return (
    <aside className={clsx('sidebar', isCollapsed && 'sidebar-collapsed')} aria-label="侧边栏">
      <div className="sidebar-toolbar">
        <span className="sidebar-heading" aria-hidden="true">概览</span>
        <button
          type="button"
          className="sidebar-toggle"
          onClick={toggleCollapsed}
          aria-label={isCollapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-expanded={!isCollapsed}
          aria-controls="sidebar-navigation"
          title={isCollapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          {isCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
      <nav className="nav" id="sidebar-navigation" aria-label="主导航">
        <button className={`nav-item ${view === 'dashboard' ? 'active' : ''}`} onClick={() => go('dashboard')} aria-label="工作台总览" title="工作台总览">
          <LayoutGrid size={16} />
          <span className="nav-label">工作台总览</span>
        </button>

        <div className="nav-section">内容类型</div>
        <button className={`nav-item ${view.startsWith('library') ? 'active' : ''}`} onClick={() => go('library')} aria-label="文献库" title={`文献库 · ${paperCount} 篇`}>
          <BookOpen size={16} />
          <span className="nav-label">文献库</span>
          <span className="nav-note" aria-hidden>♩</span>
          <span className="count">{paperCount}</span>
        </button>
        {types
          .filter((t) => t.kind !== 'schedule')
          .map((t) => {
          const Icon = typeIcon(t.icon);
          return (
            <button
              key={t.id}
              className={clsx(
                'nav-item',
                view === t.id && 'active',
                dragId === t.id && 'dragging',
                over?.id === t.id && (over.after ? 'drop-after' : 'drop-before'),
              )}
              onClick={() => go(t.id)}
              aria-label={t.name}
              draggable
              onDragStart={(e) => {
                setDragId(t.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={endDrag}
              onDragOver={(e) => {
                if (!dragId || dragId === t.id) return;
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                setOver({ id: t.id, after: e.clientY > rect.top + rect.height / 2 });
              }}
              onDragLeave={() => setOver((o) => (o?.id === t.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId && dragId !== t.id) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  reorderType(dragId, t.id, e.clientY > rect.top + rect.height / 2);
                }
                endDrag();
              }}
              title={`${t.name} · ${countOf(t)} 条（拖动可调整顺序）`}
            >
              <Icon size={16} />
              <span className="nav-label">{t.name}</span>
              <span className="nav-note" aria-hidden>
                {t.note}
              </span>
              <span className="count">{countOf(t)}</span>
            </button>
          );
        })}

        <div className="nav-section nav-other">其他</div>
        <button
          className={`nav-item ${view === 'archive' ? 'active' : ''}`}
          aria-label="已归档"
          title={`已归档 · ${archivedCount} 条`}
          onClick={() => {
            setView('dashboard');
            setStatusFilter('archived');
          }}
        >
          <Archive size={16} />
          <span className="nav-label">已归档</span>
          <span className="count">{archivedCount}</span>
        </button>
        <button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => go('settings')} aria-label="设置与数据" title="设置与数据">
          <Settings size={16} />
          <span className="nav-label">设置与数据</span>
        </button>
      </nav>

      <div className="sidebar-footer">
        {!isCollapsed && <FloatingNotes count={6} />}
        <button className="nav-item" onClick={() => requestEditor({})} aria-label="新建记录" title="新建记录">
          <Plus size={16} />
          <span className="nav-label">新建记录</span>
        </button>
      </div>
    </aside>
  );
}
