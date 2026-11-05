import React, { useRef } from 'react';
import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import { collectionRows } from './collection-tree.js';

export function CollectionNavigation({ tree, counts, navItem, scope, drop, busy, toggle, startDrag, endDrag }) {
  const dragFromToggle = useRef(false);
  const rows = collectionRows(tree);
  return <div className="rw-collection-tree" role="tree" aria-label="文献集层级">{rows.map(node => <div
    role="treeitem" aria-level={node.depth + 1} aria-expanded={node.hasChildren ? !node.collapsed : undefined} aria-selected={scope.kind === 'collections' && scope.name === node.name}
    key={node.name} className={`rw-collection-node ${drop?.target === node.name ? `is-tree-drop-${drop.position}` : ''}`}
    data-collection-node={node.name} style={{ '--collection-depth': node.depth }} draggable={!busy}
    onPointerDownCapture={event => { dragFromToggle.current = Boolean(event.target.closest('.rw-collection-toggle')); }}
    onDragStart={event => { if (dragFromToggle.current || event.target.closest('.rw-collection-toggle')) { event.preventDefault(); return; } startDrag(event, node.name); }} onDragEnd={endDrag}
    onKeyDown={event => {
      if (!event.target.closest('.rw-nav-item') || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      if (node.hasChildren && ((event.key === 'ArrowRight' && node.collapsed) || (event.key === 'ArrowLeft' && !node.collapsed))) toggle(node.name);
      else if (event.key === 'ArrowLeft' && node.parent) event.currentTarget.parentElement.querySelector(`[data-collection-node="${CSS.escape(node.parent)}"] .rw-nav-item`)?.focus();
      else if (event.key === 'ArrowRight' && node.hasChildren) event.currentTarget.nextElementSibling?.querySelector('.rw-nav-item')?.focus();
    }}>
    {node.hasChildren ? <button className="rw-collection-toggle" draggable={false} aria-label={`${node.collapsed ? '展开' : '收起'}文献集：${node.name}`} aria-expanded={!node.collapsed} onClick={() => toggle(node.name)}>{node.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</button> : <span className="rw-collection-toggle-space" />}
    {navItem('collections', node.name, node.name, Folder, counts.get(node.name) || 0)}
  </div>)}</div>;
}
