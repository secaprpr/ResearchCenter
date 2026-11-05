import { test, expect } from '@playwright/test';
import { multiPagePdfFixture } from './pdfFixture';

test('逐页时长、既有笔记、跳页热图和重启保存；后台及闲置暂停', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  await page.goto('/'); await page.getByRole('button', { name: '文献库', exact: true }).click();
  const ui = page.frameLocator('.port-library-shell iframe');
  await expect(ui.locator('#port-status')).toContainText('已就绪');
  await ui.locator('#port-pdf-input').setInputFiles([{ name: 'Page Activity.pdf', mimeType: 'application/pdf', buffer: multiPagePdfFixture('Reading activity test', 3) }]);
  await expect(ui.locator('.rw-paper-row')).toHaveCount(1);
  await ui.getByRole('button', { name: '阅读 Page Activity', exact: true }).click();
  await expect(ui.locator('.mupdf-reader-status')).toContainText('3 页');
  const record = () => ui.locator('html').evaluate(() => { const x = window.__researchPort; return x.activity.get(x.app.workspace.getActiveFile().path); });
  await page.clock.runFor(5000);
  expect((await record()).pages[0]).toBeGreaterThanOrEqual(2);
  await ui.locator('html').evaluate(async () => {
    const x = window.__researchPort, file = x.app.workspace.getActiveFile().path;
    for (const [id, page, type] of [['page-note-1', 0, 'note'], ['page-highlight-1', 0, 'highlight'], ['page-note-2', 1, 'note']]) {
      await x.reader.addAnnotation(file, { id, page, type, text: type === 'highlight' ? 'Highlight' : '', comment: 'Page note', tags: [], quads: type === 'highlight' ? [[50, 50, 150, 50, 50, 65, 150, 65]] : [], x: 50, y: 50, color: 'yellow', createdAt: Date.now(), updatedAt: Date.now() });
    }
  });
  await ui.getByRole('button', { name: '查看逐页阅读统计', exact: true }).click();
  const panel = ui.getByRole('dialog', { name: '逐页阅读统计', exact: true });
  await expect(panel.locator('tbody tr').nth(0)).toContainText('2 条');
  await expect(panel.locator('tbody tr').nth(1)).toContainText('1 条');
  await expect(panel.locator('tbody tr').nth(2)).toContainText('0 条');
  await panel.getByRole('button', { name: '阅读第 2 页', exact: true }).click();
  await page.clock.runFor(5000);
  expect((await record()).pages[1]).toBeGreaterThanOrEqual(3);
  const other = await page.context().newPage(); await other.bringToFront();
  // Headless Chromium keeps tabs foregrounded; deliver the browser blur event explicitly.
  await ui.locator('html').evaluate(() => window.dispatchEvent(new Event('blur')));
  const beforeBackground = (await record()).pages[1]; await page.clock.runFor(10000);
  expect((await record()).pages[1]).toBe(beforeBackground);
  await other.close(); await page.bringToFront();
  await ui.locator('html').evaluate(() => window.dispatchEvent(new Event('focus')));
  await panel.getByRole('button', { name: '阅读第 2 页', exact: true }).click();
  await page.clock.runFor(125000);
  const beforeIdle = (await record()).pages[1]; await page.clock.runFor(15000);
  expect((await record()).pages[1]).toBe(beforeIdle);
  await page.screenshot({ path: 'shots/reading-page-activity-panel.png' });
  await panel.getByRole('button', { name: '关闭逐页阅读统计', exact: true }).click();
  await ui.getByRole('button', { name: '← 返回文献库', exact: true }).click();
  await ui.locator('.rw-paper-row').focus(); await ui.locator('.rw-paper-row').press('Escape');
  await expect(ui.locator('.rw-title-heatmap.mode-time')).toBeVisible();
  await ui.getByLabel('标题背景热图').selectOption('notes');
  await expect(ui.locator('.rw-title-heatmap.mode-notes')).toBeVisible();
  await page.screenshot({ path: 'shots/reading-page-activity-heatmap.png' });
  await page.reload(); await page.getByRole('button', { name: '文献库', exact: true }).click();
  await expect(ui.getByLabel('标题背景热图')).toHaveValue('notes');
  await expect(ui.locator('.rw-title-heatmap.mode-notes')).toBeVisible();
  await ui.locator('.rw-paper-title').click();
  await expect(ui.locator('.rw-paper-reading-activity')).toContainText('3 条笔记');
  await ui.locator('.rw-paper-reading-activity details:not(.rw-reading-help) > summary').click();
  await expect(ui.locator('.rw-paper-reading-activity tbody tr')).toHaveCount(3);
  // Detail navigation remains available when reading lower sections of a long dossier.
  await ui.locator('.rw-paper-detail').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(ui.getByRole('tablist', { name: '论文详情内容', exact: true })).toBeInViewport();
  await expect(ui.getByRole('button', { name: '关闭论文详情', exact: true })).toBeInViewport();
  await ui.getByRole('tab', { name: '笔记', exact: true }).click();
  await expect(ui.getByRole('textbox', { name: '研究笔记正文', exact: true })).toBeVisible();
  await ui.getByRole('tab', { name: '信息', exact: true }).click();
  await ui.locator('.rw-paper-reading-activity details:not(.rw-reading-help) > summary').click();
  await ui.getByLabel('标题背景热图').selectOption('off');
  await expect(ui.locator('.rw-title-heatmap')).toHaveCount(0);
  // A reload while the PDF is still open retains its final, not-yet-flushed seconds.
  await ui.locator('.rw-paper-reading-activity').getByRole('button', { name: '阅读第 3 页', exact: true }).click();
  await expect(ui.getByRole('button', { name: '查看逐页阅读统计', exact: true })).toBeVisible();
  await page.clock.runFor(4000);
  const lastPageTime = (await record()).pages[2]; expect(lastPageTime).toBeGreaterThan(0);
  await page.reload(); await page.getByRole('button', { name: '文献库', exact: true }).click();
  await expect(ui.locator('#port-status')).toContainText('已就绪');
  expect(await ui.locator('html').evaluate(() => { const x = window.__researchPort; const paper = x.library.currentModal.papers[0]; const pdf = x.library.currentModal.resolveVaultFile(paper.pdf, paper.file.path); return x.activity.get(pdf.path)?.pages[2]; })).toBeGreaterThanOrEqual(lastPageTime);
  await page.setViewportSize({ width: 390, height: 844 });
  await ui.getByRole('button', { name: '阅读 Page Activity', exact: true }).click();
  await ui.getByRole('button', { name: '查看逐页阅读统计', exact: true }).click();
  await expect(panel.locator('tbody tr')).toHaveCount(3);
  expect(await panel.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })).toBe(true);
  expect(await ui.locator('html').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: 'shots/reading-page-activity-mobile.png' });
  expect(errors).toEqual([]);
});
