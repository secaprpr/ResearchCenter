import { chooseReadingState } from './statusFixture';
import { test, expect } from '@playwright/test';
import { pdfFixture } from './pdfFixture';

test('阅读状态贯通列表、批量、PDF 阅读器、归档恢复和重启持久化', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.getByRole('button', { name: '文献库', exact: true }).click();
  const ui = page.frameLocator('.port-library-shell iframe');
  await expect(ui.locator('#port-status')).toContainText('已就绪');
  await ui.locator('#port-pdf-input').setInputFiles([
    { name: 'Reading Alpha.pdf', mimeType: 'application/pdf', buffer: pdfFixture('Reading alpha state workflow') },
    { name: 'Reading Beta.pdf', mimeType: 'application/pdf', buffer: pdfFixture('Reading beta state workflow') },
  ]);
  await expect(ui.locator('.rw-paper-row')).toHaveCount(2);
  const inline = title => ui.getByRole('button', { name: `设置阅读状态：${title}`, exact: true });
  await inline('Reading Alpha').click();
  const statusMenu = ui.getByRole('listbox', { name: '阅读状态选项', exact: true });
  await expect(statusMenu.getByRole('option', { name: '待整理', exact: true })).toHaveAttribute('aria-selected', 'true');
  await statusMenu.press('ArrowDown'); await statusMenu.getByRole('option', { name: '待阅读', exact: true }).press('Enter');
  await expect(inline('Reading Alpha')).toHaveText('待阅读');
  await inline('Reading Alpha').click(); await statusMenu.press('Escape');
  await expect(statusMenu).toHaveCount(0); await expect(inline('Reading Alpha')).toBeFocused();
  await expect(ui.getByRole('complementary', { name: '论文详情', exact: true })).toHaveCount(0);
  await expect(ui.locator('.rw-paper-row .state-queued')).toHaveCount(1);
  await ui.locator('.rw-paper-row').first().focus();
  await ui.locator('.rw-paper-row').first().press('Control+a');
  await ui.getByLabel('批量设置阅读状态').selectOption('reading');
  await expect(ui.locator('.rw-paper-row .state-reading')).toHaveCount(2);
  const dates = () => ui.locator('html').evaluate(() => window.__researchPort.library.currentModal.papers.map(p => ({ title: p.title, status: p.status, start: p.dateStarted, end: p.dateRead })).sort((a, b) => a.title.localeCompare(b.title)));
  const today = await ui.locator('html').evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  await expect.poll(dates).toEqual([
    { title: 'Reading Alpha', status: 'reading', start: today, end: '' },
    { title: 'Reading Beta', status: 'reading', start: today, end: '' },
  ]);
  await ui.getByRole('button', { name: '阅读 Reading Alpha', exact: true }).click();
  await expect(ui.getByRole('button', { name: '阅读器阅读状态', exact: true })).toHaveText('阅读中');
  await chooseReadingState(ui, '阅读器阅读状态', 'read');
  await expect.poll(dates).toEqual([
    { title: 'Reading Alpha', status: 'read', start: today, end: today },
    { title: 'Reading Beta', status: 'reading', start: today, end: '' },
  ]);
  await page.screenshot({ path: 'shots/reading-status-reader-test.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(ui.getByRole('button', { name: '阅读器阅读状态', exact: true })).toBeVisible();
  expect(await ui.locator('html').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: 'shots/reading-status-reader-mobile-test.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await ui.getByRole('button', { name: '← 返回文献库', exact: true }).click();
  await expect(inline('Reading Alpha')).toHaveText('已完成');
  await ui.locator('.rw-paper-row').filter({ hasText: 'Reading Alpha' }).click();
  await expect(ui.locator('.rw-reading-date time')).toHaveText([today, today]);
  await page.screenshot({ path: 'shots/reading-status-library-test.png' });
  await chooseReadingState(ui, inline('Reading Alpha'), 'archived');
  await expect(ui.locator('.rw-paper-row')).toHaveCount(1);
  const nav = ui.getByRole('navigation', { name: '快捷文献视图', exact: true });
  await nav.getByRole('button', { name: /^已归档/ }).click();
  await expect(ui.locator('.rw-paper-row')).toHaveCount(1);
  await chooseReadingState(ui, inline('Reading Alpha'), 'queued');
  await expect(ui.locator('.rw-paper-row')).toHaveCount(0);
  await nav.getByRole('button', { name: /^待阅读/ }).click();
  await expect(inline('Reading Alpha')).toHaveText('待阅读');
  await page.reload(); await page.getByRole('button', { name: '文献库', exact: true }).click();
  await expect(inline('Reading Alpha')).toHaveText('待阅读');
  await expect.poll(dates).toEqual([
    { title: 'Reading Alpha', status: 'queued', start: today, end: today },
    { title: 'Reading Beta', status: 'reading', start: today, end: '' },
  ]);
  await ui.getByRole('button', { name: '筛选', exact: true }).click();
  await ui.getByRole('combobox', { name: '筛选阅读状态', exact: true }).selectOption('reading');
  await expect(ui.locator('.rw-paper-row')).toHaveCount(1);
  await expect(ui.locator('.rw-paper-row')).toContainText('Reading Beta');
  // Migrated notes can share a PDF. The reader must update the selected record.
  await ui.locator('html').evaluate(async () => {
    const { library, vault } = window.__researchPort;
    const alpha = library.currentModal.papers.find(p => p.title === 'Reading Alpha');
    const source = await vault.read(alpha.file);
    await vault.create(library.settings.papersFolder + '/shared-pdf-record.md', source.replace(/^title:.*$/m, 'title: Shared PDF Record').replace(/^status:.*$/m, 'status: queued'));
  });
  await ui.getByRole('combobox', { name: '筛选阅读状态', exact: true }).selectOption('all');
  await expect(ui.locator('.rw-paper-row')).toHaveCount(3);
  await ui.getByRole('button', { name: '阅读 Shared PDF Record', exact: true }).click();
  await expect(ui.getByRole('button', { name: '阅读器阅读状态', exact: true })).toHaveText('阅读中');
  await ui.getByRole('button', { name: '← 返回文献库', exact: true }).click();
  await expect(inline('Shared PDF Record')).toHaveText('阅读中');
  await expect(inline('Reading Alpha')).toHaveText('待阅读');
  expect(errors).toEqual([]);
});
