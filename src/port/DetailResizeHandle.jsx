import React, { useEffect, useRef, useState } from 'react';

export const DETAIL_MIN_WIDTH = 260;
export const DETAIL_MAX_WIDTH = 560;
export function readDetailWidth(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.max(DETAIL_MIN_WIDTH, Math.min(DETAIL_MAX_WIDTH, value))) : null;
}

export function DetailResizeHandle({ width, onResize }) {
  const handle = useRef(null), drag = useRef(null);
  const [actual, setActual] = useState(width || 280);
  const [maximum, setMaximum] = useState(DETAIL_MAX_WIDTH);
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    const element = handle.current, pane = element.nextElementSibling;
    const update = () => {
      const measured = pane.getBoundingClientRect().width;
      if (measured > 0) setActual(Math.round(measured));
      setMaximum(Math.max(DETAIL_MIN_WIDTH, Math.min(DETAIL_MAX_WIDTH, element.parentElement.clientWidth - 320 - element.offsetWidth)));
    };
    const observer = new ResizeObserver(update);
    observer.observe(pane); observer.observe(element.parentElement); update();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!resizing) return;
    document.body.classList.add('rw-resizing-detail');
    return () => document.body.classList.remove('rw-resizing-detail');
  }, [resizing]);
  const clamp = value => Math.round(Math.max(DETAIL_MIN_WIDTH, Math.min(maximum, value)));
  const finish = (event, cancel = false) => {
    const start = drag.current;
    if (!start || event.pointerId !== start.pointerId) return;
    if (cancel) onResize(start.preference);
    drag.current = null; setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div ref={handle} className={`rw-detail-resizer ${resizing ? 'is-resizing' : ''}`} role="separator" tabIndex={0}
    aria-label="调整论文详情宽度" aria-orientation="vertical" aria-valuemin={DETAIL_MIN_WIDTH} aria-valuemax={maximum} aria-valuenow={actual}
    aria-valuetext={`${actual} 像素`} title="拖动调整详情宽度；双击恢复默认；方向键微调"
    onDoubleClick={event => { event.preventDefault(); onResize(null); }}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag.current = { pointerId: event.pointerId, x: event.clientX, width: actual, preference: width };
      event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus(); setResizing(true);
    }}
    onPointerMove={event => { if (drag.current?.pointerId === event.pointerId) onResize(clamp(drag.current.width + drag.current.x - event.clientX)); }}
    onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
    onLostPointerCapture={() => { drag.current = null; setResizing(false); }}
    onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape' && drag.current) {
        const start = drag.current; onResize(start.preference); drag.current = null; setResizing(false);
        if (event.currentTarget.hasPointerCapture(start.pointerId)) event.currentTarget.releasePointerCapture(start.pointerId);
      } else if (event.key === 'Home') onResize(null);
      else if (event.key === 'End') onResize(maximum);
      else if (event.key.startsWith('Arrow')) onResize(clamp(actual + (event.key === 'ArrowLeft' ? 1 : -1) * (event.shiftKey ? 40 : 10)));
    }} />;
}
