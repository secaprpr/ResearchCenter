import { expect, it } from 'vitest';
import { applyReadingStatus, localReadingDate, saveReadingStatus, startReadingOnOpen } from '../port/reading-status.js';
import { frontmatter } from '../port/vault.js';

it('首次阅读与完成日期一致；直接标已完成也会记录开始日期', () => {
  const paper = { status: 'inbox' };
  applyReadingStatus(paper, 'queued', '2026-10-20'); expect(paper.date_started).toBeUndefined();
  applyReadingStatus(paper, 'reading', '2026-10-21');
  applyReadingStatus(paper, 'read', '2026-10-24');
  expect(paper).toEqual({ status: 'read', date_started: '2026-10-21', date_read: '2026-10-24' });
  const direct = {}; applyReadingStatus(direct, 'read', '2026-10-25');
  expect(direct).toEqual({ status: 'read', date_started: '2026-10-25', date_read: '2026-10-25' });
});

it('重读、重复标已完成、重新排队和归档保留原始阅读日期', () => {
  const paper = { date_started: '2025-09-01', date_read: '2025-09-03' };
  for (const status of ['reading', 'read', 'read', 'queued', 'archived', 'inbox']) {
    applyReadingStatus(paper, status, '2026-10-20');
    expect(paper.date_started).toBe('2025-09-01'); expect(paper.date_read).toBe('2025-09-03');
  }
  expect(() => applyReadingStatus(paper, 'unknown')).toThrow('无效的阅读状态');
  expect(paper.status).toBe('inbox');
});

it('午夜附近使用设备本地日历日期', () => {
  expect(localReadingDate(new Date(2026, 9, 21, 0, 5))).toBe('2026-10-21');
});

it('自动阅读只处理待整理与待阅读，已完成、归档和阅读中不重复写入', async () => {
  for (const status of ['inbox', 'queued', 'read', 'archived', 'reading']) {
    let text = `---\nstatus: ${status}\ndate_started: 2025-09-01\ndate_read: 2025-09-03\n---\nA preserved note.`;
    let writes = 0;
    const vault = { read: async () => text, modify: async (_, content) => { writes++; text = content; } };
    await startReadingOnOpen(vault, { path: 'paper.md' });
    const eligible = ['inbox', 'queued'].includes(status);
    expect(frontmatter(text)).toEqual({ status: eligible ? 'reading' : status, date_started: '2025-09-01', date_read: '2025-09-03' });
    expect(writes).toBe(eligible ? 1 : 0);
  }
});

it('自动打开与手动标记并发时不会覆盖已完成状态', async () => {
  let text = '---\nstatus: queued\n---\n';
  const vault = { read: async () => text, modify: async (_, content) => { text = content; } };
  const file = { path: 'paper.md' };
  await Promise.all([startReadingOnOpen(vault, file), saveReadingStatus(vault, file, 'read'), startReadingOnOpen(vault, file)]);
  expect(frontmatter(text).status).toBe('read');
  expect(frontmatter(text).date_started).toBeTruthy(); expect(frontmatter(text).date_read).toBeTruthy();
});
