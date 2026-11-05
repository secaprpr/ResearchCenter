import { useLayoutEffect, useState } from 'react';

const key = 'research-task-font-size';
export const TASK_FONT_SIZES = [12, 13, 14, 15, 16, 17, 18, 19, 20];
function readSize() {
  try { const size = Number(localStorage.getItem(key)); return TASK_FONT_SIZES.includes(size) ? size : 15; }
  catch { return 15; }
}

/** A view preference shared by topics; it never rewrites research records. */
export function useTaskTypography() {
  const [fontSize, setSize] = useState(readSize);
  useLayoutEffect(() => {
    const root = document.documentElement, previous = root.style.getPropertyValue('--rt-font-size');
    root.style.setProperty('--rt-font-size', `${fontSize}px`);
    return () => { if (previous) root.style.setProperty('--rt-font-size', previous); else root.style.removeProperty('--rt-font-size'); };
  }, [fontSize]);
  const setFontSize = (size: number) => {
    if (!TASK_FONT_SIZES.includes(size)) return;
    setSize(size);
    try { localStorage.setItem(key, String(size)); } catch { /* Keep the current session adjustable if preferences cannot be saved. */ }
  };
  return { fontSize, setFontSize };
}
