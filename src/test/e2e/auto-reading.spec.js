import { chooseReadingState } from './statusFixture';
import { test, expect } from '@playwright/test';
import { pdfFixture } from './pdfFixture';

test('成功打开自动开始阅读，已完成与归档保持状态，损坏 PDF 不触发', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '文献库', exact: true }).click();
  const ui = page.frameLocator('.port-library-shell iframe');
  await expect(ui.locator('#port-status')).toContainText('已就绪');
  await ui.locator('#port-pdf-input').setInputFiles([
    { name: 'Auto Reading.pdf', mimeType: 'application/pdf', buffer: pdfFixture('Automatic reading start') },
    { name: 'Broken Reading.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nInvalid document without pages\n') },
  ]);
  await expect(ui.locator('.rw-paper-row')).toHaveCount(2);
  const state = title => ui.getByRole('button', { name: `设置阅读状态：${title}`, exact: true });
  const open = title => ui.getByRole('button', { name: `阅读 ${title}`, exact: true }).click();
  const back = () => ui.getByRole('button', { name: '← 返回文献库', exact: true }).click();
  const readerState = ui.getByRole('button', { name: '阅读器阅读状态', exact: true });
  await open('Auto Reading');
  await expect(readerState).toHaveText('阅读中'); await back();
  await expect(state('Auto Reading')).toHaveText('阅读中');
  await chooseReadingState(ui, state('Auto Reading'), 'queued');
  await open('Auto Reading'); await expect(readerState).toHaveText('阅读中');
  await chooseReadingState(ui, readerState, 'read'); await back();
  await expect(state('Auto Reading')).toHaveText('已完成');
  const dates = () => ui.locator('html').evaluate(() => {
    const p = window.__researchPort.library.currentModal.papers.find(p => p.title === 'Auto Reading');
    return { start: p.dateStarted, end: p.dateRead };
  });
  const completedDates = await dates(); expect(completedDates.start).toBeTruthy(); expect(completedDates.end).toBeTruthy();
  await open('Auto Reading'); await expect(readerState).toHaveText('已完成'); await back();
  expect(await dates()).toEqual(completedDates);
  await open('Broken Reading');
  await expect(ui.locator('.mupdf-reader-error-title')).toBeVisible();
  await expect(readerState).toHaveText('待整理'); await back();
  await expect(state('Broken Reading')).toHaveText('待整理');
  await chooseReadingState(ui, state('Auto Reading'), 'archived');
  await expect(ui.locator('.rw-paper-row')).toHaveCount(1);
  await ui.getByRole('navigation', { name: '快捷文献视图', exact: true }).getByRole('button', { name: /^已归档/ }).click();
  await open('Auto Reading'); await expect(readerState).toHaveText('已归档'); await back();
  await expect(state('Auto Reading')).toHaveText('已归档');
  expect(await dates()).toEqual(completedDates);
});
