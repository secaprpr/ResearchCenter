import { expect, it, vi } from 'vitest';
import { createPageTimer, pageActivity, createReadingActivity, formatReadingTime } from '../port/reading-activity.js';

it('按页分配前台时间，失焦、闲置和休眠间隔不计时', () => {
  let time = 0; const pages = {};
  const timer = createPageTimer({ now: () => time, idleMs: 10000, onTime: (page, seconds) => { pages[page] = (pages[page] || 0) + seconds; } });
  timer.visit(0); timer.foreground(true);
  time = 3000; timer.visit(1); time = 7000; timer.foreground(false);
  expect(pages).toEqual({ 0: 3, 1: 4 });
  time = 9000; timer.tick(); expect(pages[1]).toBe(4);
  timer.foreground(true);
  time = 13000; timer.tick(); time = 17000; timer.tick(); time = 21000; timer.tick();
  expect(pages[1]).toBe(14); // Only ten seconds after regaining focus.
  time = 23000; timer.tick(); expect(pages[1]).toBe(14);
  timer.interact(); time = 25000; timer.tick(); expect(pages[1]).toBe(16);
  time = 125000; timer.tick(); expect(pages[1]).toBe(16); // Suspended timer gap.
  timer.stop(); time = 126000; timer.tick(); expect(pages[1]).toBe(16);
});

it('从现有批注按页统计数量，未知页数不伪造阅读时长', () => {
  const annotations = [{ page: 0, type: 'highlight' }, { page: 0, type: 'note' }, { page: 2, type: 'region' }, { page: -1 }];
  expect(pageActivity(null, annotations)).toEqual([
    { page: 0, seconds: 0, notes: 2 }, { page: 1, seconds: 0, notes: 0 }, { page: 2, seconds: 0, notes: 1 },
  ]);
  expect(pageActivity({ pageCount: 4, pages: { 1: 65 } }, annotations)[1]).toEqual({ page: 1, seconds: 65, notes: 0 });
  expect(formatReadingTime(65)).toBe('1分5秒'); expect(formatReadingTime(0)).toBe('0秒');
});

it('本地侧文件读取和边界校验，刷新后保留有效逐页数据', async () => {
  let saved = JSON.stringify({ version: 1, records: { 'paper.pdf': { pageCount: 3, pages: { 0: 30.5, 1: -3, 2: 125, 99: 99 } } } });
  const vault = { adapter: { exists: async () => true, read: async () => saved, write: async (_, text) => { saved = text; } } };
  const activity = createReadingActivity({ vault }); await activity.load();
  expect(activity.get('paper.pdf')).toEqual({ pageCount: 3, pages: { 0: 30.5, 2: 125 } });
  const again = createReadingActivity({ vault }); await again.load();
  expect(again.get('paper.pdf')).toEqual(activity.get('paper.pdf'));
});

it('两份 PDF 仅活动阅读器计时，关闭非活动栏不会停止当前栏且不遗留定时器', async () => {
  vi.useFakeTimers(); let time = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => time);
  vi.spyOn(document, 'hasFocus').mockReturnValue(true); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const workspace = document.createElement('section'); workspace.id = 'reader-workspace'; document.body.append(workspace);
  const create = path => {
    const root = document.createElement('div'); workspace.append(root); root.getClientRects = () => [{}];
    return { file: { path }, root, docId: 1, pageSizes: [{}], currentPage: 0, updateCurrentPage() {}, goToPage(page) { this.currentPage = page - 1; } };
  };
  const activity = createReadingActivity({ vault: { adapter: { write: async () => {} } } }), main = create('primary.pdf'), supplement = create('supplement.pdf');
  let stopMain, stopSupplement;
  try {
    stopMain = activity.attach(main); time = 1000; vi.advanceTimersByTime(1000);
    stopSupplement = activity.attach(supplement); time = 2000; vi.advanceTimersByTime(1000);
    activity.activate(main); time = 3000; vi.advanceTimersByTime(1000);
    expect(activity.get('primary.pdf').pages[0]).toBe(2); expect(activity.get('supplement.pdf').pages[0]).toBe(1);
    await stopSupplement(); time = 4000; vi.advanceTimersByTime(1000);
    expect(activity.current()).toBe(main); expect(activity.get('primary.pdf').pages[0]).toBe(3);
    await stopMain(); expect(activity.current()).toBeUndefined(); expect(vi.getTimerCount()).toBe(0);
  } finally { await stopMain?.(); await stopSupplement?.(); workspace.remove(); vi.restoreAllMocks(); vi.useRealTimers(); }
});
