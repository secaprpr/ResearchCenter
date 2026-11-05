import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { ChartNoAxesColumn, X } from 'lucide-react';
import { pageActivity, formatReadingTime } from './reading-activity.js';
import './reading-activity.css';

export function useReadingActivity(activity) {
  const [version, setVersion] = useState(activity.revision);
  useEffect(() => activity.subscribe(() => setVersion(activity.revision)), [activity]);
  return version;
}

export function TitleHeatmap({ pages, mode }) {
  if (mode === 'off' || !pages.some(page => mode === 'notes' ? page.notes : page.seconds)) return null;
  // Sample heat at page centers, then blend continuously between neighboring pages.
  // Very large PDFs group adjacent pages; exact values remain in the page table.
  const step = Math.max(1, Math.ceil(pages.length / 240));
  const stops = [];
  for (let index = 0; index < pages.length; index += step) {
    const group = pages.slice(index, index + step);
    const value = Math.max(...group.map(page => mode === 'notes' ? page.notes : page.seconds));
    const strength = value ? .11 + .25 * Math.min(1, Math.log1p(value) / Math.log1p(mode === 'notes' ? 8 : 300)) : 0;
    const color = mode === 'notes' ? `rgba(213,137,53,${strength})` : `rgba(28,145,124,${strength})`;
    if (index === 0) stops.push(`${color} 0%`);
    stops.push(`${color} ${((index + group.length / 2) / pages.length * 100).toFixed(4)}%`);
    if (index + group.length === pages.length) stops.push(`${color} 100%`);
  }
  return <span className={`rw-title-heatmap mode-${mode}`} style={{ backgroundImage: `linear-gradient(to right, ${stops.join(', ')})` }} aria-hidden="true" />;
}

export function PageActivityTable({ pages, onPage }) {
  return <div className="rw-page-activity-scroll"><table className="rw-page-activity-table"><thead><tr><th>页码</th><th>有效阅读</th><th>笔记</th></tr></thead><tbody>{pages.map(page => <tr key={page.page}>
    <td><button disabled={!onPage} onClick={() => onPage?.(page.page)} aria-label={`阅读第 ${page.page + 1} 页`}>第 {page.page + 1} 页</button></td><td>{formatReadingTime(page.seconds)}</td><td>{page.notes} 条</td>
  </tr>)}</tbody></table></div>;
}

export function ReadingActivitySummary({ pages, detail = false }) {
  const time = formatReadingTime(pages.reduce((total, page) => total + page.seconds, 0));
  const readPages = pages.filter(page => page.seconds > 0).length;
  const notes = pages.reduce((total, page) => total + page.notes, 0);
  if (detail) return <dl className="rw-detail-reading-metrics"><div className="rw-detail-reading-time"><dt>有效阅读</dt><dd>{time}</dd></div><div><dt>有阅读记录</dt><dd>{readPages}<small> 页</small></dd></div><div><dt>笔记摘录</dt><dd>{notes}<small> 条笔记</small></dd></div></dl>;
  return <p className="rw-reading-summary"><span>有效阅读 {time}</span><span>{readPages} 页有记录</span><span>{notes} 条笔记</span></p>;
}

export function PaperReadingActivity({ pages, knownPageCount, onPage, title = '逐页阅读' }) {
  return <section className="rw-detail-section rw-paper-reading-activity"><div className="rw-section-heading"><h3>{title}</h3></div>
    <ReadingActivitySummary pages={pages} detail />
    {pages.length ? <details><summary>逐页统计 · {knownPageCount ? `${pages.length} 页` : '已知批注页'}</summary><PageActivityTable pages={pages} onPage={onPage} /></details> : <p className="rw-reading-explanation">打开 PDF 后开始记录阅读时长。</p>}
    <details className="rw-reading-help"><summary>统计说明</summary><p className="rw-reading-explanation">仅计前台阅读；无操作 2 分钟后暂停。笔记包含高亮、批注与截图摘录。</p></details>
  </section>;
}

function ReaderActivity({ activity, reader, plugin }) {
  const version = useReadingActivity(activity);
  const [annotationVersion, setAnnotationVersion] = useState(0);
  const [open, setOpen] = useState(false);
  const trigger = useRef(null), panel = useRef(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useEffect(() => plugin.subscribeAnnotations(path => { if (path === reader.file.path) setAnnotationVersion(value => value + 1); }), [plugin, reader]);
  const pages = useMemo(() => pageActivity(activity.get(reader.file.path), plugin.getAnnotationsForFile(reader.file.path)), [activity, reader, plugin, version, annotationVersion]);
  const current = pages[reader.currentPage] || { seconds: 0, notes: 0 };
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = trigger.current.getBoundingClientRect(), bounds = panel.current.getBoundingClientRect();
    const bottom = innerWidth <= 600 ? trigger.current.closest('.port-reader-bar').getBoundingClientRect().bottom : anchor.bottom;
    setPosition({ left: Math.max(8, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - 8)), top: Math.max(8, Math.min(bottom + 7, innerHeight - bounds.height - 8)) });
    panel.current.querySelector('button')?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const dismiss = event => { if (!panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <><button className="rw-reader-activity-button" ref={trigger} aria-label="查看逐页阅读统计" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)} title={`当前第 ${reader.currentPage + 1} 页 · ${formatReadingTime(current.seconds)} · ${current.notes} 条笔记`}><ChartNoAxesColumn size={15} /><span>逐页统计</span></button>
    {open && createPortal(<div ref={panel} className="rw-reader-activity-panel" role="dialog" aria-label="逐页阅读统计" style={position} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Tab') { const items = [...panel.current.querySelectorAll('button:not(:disabled)')]; const first = items[0], last = items.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
    }}><div className="rw-reader-activity-heading"><h2>逐页阅读</h2><button aria-label="关闭逐页阅读统计" onClick={close}><X size={16} /></button></div>
      <ReadingActivitySummary pages={pages} /><p className="rw-reading-current">当前第 {reader.currentPage + 1} 页 · {formatReadingTime(current.seconds)} · {current.notes} 条笔记</p>
      <p className="rw-reading-explanation">前台且未闲置时计时；连续 2 分钟无操作暂停。点击页码跳转。</p>
      <PageActivityTable pages={pages} onPage={page => reader.goToPage(page + 1, 'auto')} />
    </div>, document.body)}
  </>;
}

export function mountReaderActivity(host, props) {
  const root = createRoot(host); root.render(<ReaderActivity {...props} />);
  return () => root.unmount();
}
