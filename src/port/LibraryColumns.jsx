import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';

export const LIBRARY_COLUMNS = [
  { id: 'title', label: '标题', cell: 'title', width: 480, min: 180, required: true, sortable: true },
  { id: 'impact', label: '影响因子', cell: 'impact', width: 90, min: 80, sortable: true },
  { id: 'venue', label: '出版物', cell: 'venue', width: 200, min: 90, sortable: true },
  { id: 'authors', label: '创建者', cell: 'author', width: 140, min: 80, sortable: true },
  { id: 'year', label: '年份', cell: 'year', width: 60, min: 52, sortable: true },
  { id: 'state', label: '阅读状态', cell: 'state', width: 104, min: 94 },
  { id: 'ranks', label: '期刊评级', cell: 'ranks', width: 240, min: 90 },
  { id: 'tags', label: '标签', cell: 'tags', width: 280, min: 90 },
  { id: 'note', label: '备注', cell: 'remark', width: 260, min: 100 },
];
const MAX_WIDTH = 2400;
export const clampColumnWidth = (column, width) => Math.round(Math.max(column.min, Math.min(MAX_WIDTH, width)));
export function readColumnLayout(saved) {
  return {
    widths: Object.fromEntries(LIBRARY_COLUMNS.map(column => {
      const value = saved?.widths?.[column.id];
      return [column.id, typeof value === 'number' && Number.isFinite(value) ? clampColumnWidth(column, value) : column.width];
    })),
    hidden: LIBRARY_COLUMNS.filter(column => !column.required && Array.isArray(saved?.hidden) && saved.hidden.includes(column.id)).map(column => column.id),
  };
}

export function ColumnResizeHandle({ column, width, onResize, onStart }) {
  const drag = useRef(null);
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    if (!resizing) return;
    document.body.classList.add('rw-resizing-columns');
    return () => document.body.classList.remove('rw-resizing-columns');
  }, [resizing]);
  const finish = event => {
    if (!drag.current || event.pointerId !== drag.current.pointerId) return;
    drag.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <span className={`rw-column-resizer ${resizing ? 'is-resizing' : ''}`} role="separator" tabIndex={0}
    aria-label={`调整${column.label}列宽`} aria-orientation="vertical" aria-valuemin={column.min} aria-valuemax={MAX_WIDTH} aria-valuenow={width}
    title="拖动调整列宽；双击恢复默认宽度；方向键微调"
    onClick={event => event.stopPropagation()}
    onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); onResize(column.id, column.width); }}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation(); onStart();
      drag.current = { pointerId: event.pointerId, x: event.clientX, width };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.focus(); setResizing(true);
    }}
    onPointerMove={event => {
      if (drag.current?.pointerId === event.pointerId) onResize(column.id, clampColumnWidth(column, drag.current.width + event.clientX - drag.current.x));
    }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { drag.current = null; setResizing(false); }}
    onKeyDown={event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'Escape'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Escape' && drag.current) { onResize(column.id, drag.current.width); drag.current = null; setResizing(false); }
        else if (event.key === 'Home') onResize(column.id, column.width);
        else if (event.key.startsWith('Arrow')) onResize(column.id, clampColumnWidth(column, width + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 40 : 10)));
      }
    }} />;
}

export function ColumnMenu({ anchor, hidden, onToggle, onReset, onClose }) {
  const menu = useRef(null);
  const [position, setPosition] = useState({ x: anchor.x, y: anchor.y });
  useLayoutEffect(() => {
    const rect = menu.current.getBoundingClientRect();
    setPosition({ x: Math.max(8, Math.min(anchor.x, window.innerWidth - rect.width - 8)), y: Math.max(8, Math.min(anchor.y, window.innerHeight - rect.height - 8)) });
    menu.current.querySelector('button:not(:disabled)')?.focus();
  }, [anchor]);
  useEffect(() => {
    const dismiss = event => { if (!menu.current?.contains(event.target) && !anchor.trigger?.contains(event.target)) onClose(false); };
    const resize = () => onClose(false);
    document.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', dismiss, true); window.removeEventListener('resize', resize); };
  }, [anchor, onClose]);
  return <div ref={menu} className="rw-column-menu" role="menu" aria-label="文献显示列" style={{ left: position.x, top: position.y }}
    onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); onClose(true); return; }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const items = [...menu.current.querySelectorAll('button:not(:disabled)')];
        const index = items.indexOf(document.activeElement);
        items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }
    }}>
    <div className="rw-column-menu-heading">显示列</div>
    {LIBRARY_COLUMNS.map(column => <button key={column.id} role="menuitemcheckbox" aria-checked={!hidden.includes(column.id)} disabled={column.required}
      onClick={() => onToggle(column.id)}><span className="rw-column-check">{!hidden.includes(column.id) && <Check size={14} />}</span><span>{column.label}</span>{column.required && <small>固定</small>}</button>)}
    <div role="separator" className="rw-column-menu-divider" />
    <button role="menuitem" onClick={onReset}>恢复默认列布局</button>
  </div>;
}
