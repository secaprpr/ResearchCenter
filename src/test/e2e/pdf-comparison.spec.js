import { test, expect } from '@playwright/test';
import { multiPagePdfFixture } from './pdfFixture';

const first = { name: 'Supplementary Information.pdf', mimeType: 'application/pdf', buffer: multiPagePdfFixture('Supporting evidence and methods', 4) };
const second = { name: 'Supplementary Methods.pdf', mimeType: 'application/pdf', buffer: multiPagePdfFixture('Sensitivity analysis details', 2) };
async function setup(page, clock = false) {
  const errors = []; page.on('pageerror', error => errors.push(error.message)); await page.route('https://**', route => route.abort());
  if (clock) await page.clock.install();
  await page.setViewportSize({ width: 1680, height: 1000 }); await page.goto('/'); await page.getByRole('button', { name: '文献库', exact: true }).click();
  const ui = page.frameLocator('.port-library-shell iframe'); await expect(ui.locator('#port-status')).toContainText('已就绪');
  await ui.locator('#port-pdf-input').setInputFiles({ name: 'Paired Journal Study.pdf', mimeType: 'application/pdf', buffer: multiPagePdfFixture('Primary findings and interpretation', 3) });
  await ui.locator('.rw-paper-row').click(); await ui.getByRole('tab', { name: /^附录/ }).click(); const panel = ui.getByRole('region', { name: '论文附录', exact: true });
  await panel.getByLabel('添加附录文件').setInputFiles([first, second]); await expect(panel.locator('.rw-supplement-item')).toHaveCount(3); await expect(panel).toHaveAttribute('aria-busy', 'false');
  await panel.getByRole('button', { name: '与正文并排阅读：' + first.name, exact: true }).click();
  const left = ui.getByRole('region', { name: '左侧 PDF', exact: true }), right = ui.getByRole('region', { name: '右侧 PDF', exact: true });
  await expect(left.locator('.mupdf-reader-status')).toContainText('3 页'); await expect(right.locator('.mupdf-reader-status')).toContainText('4 页'); await expect(ui.locator('.rw-pdf-comparison')).toHaveAttribute('aria-busy', 'false');
  const frame = page.frames().find(f => f.url().includes('port.html'));
  return { ui, frame, panel, left, right, errors };
}
async function dragPdf(page, pane, start, end) {
  const box = await pane.locator('.mupdf-reader-page').first().boundingBox(), scale = box.width / 612;
  await page.mouse.move(box.x + start[0] * scale, box.y + start[1] * scale); await page.mouse.down(); await page.mouse.move(box.x + end[0] * scale, box.y + end[1] * scale, { steps: 12 }); await page.mouse.up();
}

test('正文与附录独立翻页缩放，拖动分隔线记住宽度，替换右栏和退出保留左侧实例', async ({ page }) => {
  const { ui, frame, left, right, errors } = await setup(page);
  expect(await ui.locator('.rw-pdf-comparison').evaluate(el => el.classList.contains('is-stacked'))).toBe(false);
  await frame.evaluate(() => { window.__leftEngine = window.__researchPort.app.workspace.leaves.find(leaf => leaf.element.closest('[data-pdf-pane=left]'))?.view.reader; });
  await left.locator('.mupdf-reader-page-input').fill('2'); await left.locator('.mupdf-reader-page-input').press('Enter'); await right.locator('.mupdf-reader-page-input').fill('3'); await right.locator('.mupdf-reader-page-input').press('Enter');
  await expect(left.locator('.mupdf-reader-page-input')).toHaveValue('2'); await expect(right.locator('.mupdf-reader-page-input')).toHaveValue('3');
  await left.locator('.mupdf-reader-zoom-input').fill('125'); await left.locator('.mupdf-reader-zoom-input').press('Enter'); await right.locator('.mupdf-reader-zoom-input').fill('75'); await right.locator('.mupdf-reader-zoom-input').press('Enter');
  await expect(left.locator('.mupdf-reader-zoom-input')).toHaveValue('125'); await expect(right.locator('.mupdf-reader-zoom-input')).toHaveValue('75');
  const before = await left.boundingBox(), separator = ui.getByRole('separator', { name: '调整并排阅读宽度', exact: true }), box = await separator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x + 150, box.y + 100, { steps: 12 }); await page.mouse.up();
  expect((await left.boundingBox()).width).toBeGreaterThan(before.width + 100); await expect(left.locator('.mupdf-reader-zoom-input')).toHaveValue('125'); await expect(right.locator('.mupdf-reader-zoom-input')).toHaveValue('75');
  const saved = await separator.getAttribute('aria-valuenow');
  const secondPath = await frame.evaluate(() => { const x = window.__researchPort; return x.app.paperAttachments.list(x.library.currentModal.papers[0].file)[1].path; });
  await right.getByRole('combobox', { name: '选择右侧 PDF', exact: true }).selectOption(secondPath); await expect(right.locator('.mupdf-reader-status')).toContainText('2 页'); await expect(left.locator('.mupdf-reader-page-input')).toHaveValue('2');
  expect(await frame.evaluate(() => window.__leftEngine === window.__researchPort.app.workspace.leaves.find(leaf => leaf.element.closest('[data-pdf-pane=left]'))?.view.reader)).toBe(true);
  await left.getByRole('button', { name: '适合宽度', exact: true }).click();
  await left.locator('.mupdf-reader-page-input').fill('1'); await left.locator('.mupdf-reader-page-input').press('Enter'); await right.locator('.mupdf-reader-page-input').fill('1'); await right.locator('.mupdf-reader-page-input').press('Enter');
  await expect.poll(() => frame.evaluate(() => window.__researchPort.app.workspace.getLeavesOfType('mupdf-reader-view').every(leaf => leaf.view.reader.pageState[0]?.renderKey === leaf.view.reader.makeRenderKey(0)))).toBe(true);
  await page.screenshot({ path: 'shots/pdf-comparison-1680.png' });
  await left.locator('.mupdf-reader-page-input').fill('2'); await left.locator('.mupdf-reader-page-input').press('Enter');
  await right.getByRole('button', { name: '关闭右侧阅读栏', exact: true }).click(); await expect(ui.locator('.rw-pdf-comparison')).toHaveCount(0);
  expect(await frame.evaluate(() => window.__researchPort.app.workspace.mainLeaf.view.reader === window.__leftEngine)).toBe(true); await expect(ui.locator('.mupdf-reader-page-input')).toHaveValue('2');
  await ui.getByRole('button', { name: '切换正文与附录', exact: true }).click(); await ui.getByRole('menuitem', { name: '正文与附录并排阅读', exact: true }).click(); await expect(ui.locator('.rw-pdf-comparison')).toHaveAttribute('aria-busy', 'false'); await expect(separator).toHaveAttribute('aria-valuenow', saved);
  await separator.press('Home'); await expect(separator).toHaveAttribute('aria-valuenow', '50'); await separator.press('ArrowRight'); await expect(separator).toHaveAttribute('aria-valuenow', '53');
  await ui.locator('#reader-back').click(); await expect(ui.locator('.rw-pdf-comparison')).toHaveCount(0);
  await expect(ui.locator('#reader-workspace')).toBeHidden();
  await expect.poll(() => frame.evaluate(() => window.__researchPort.app.workspace.leaves.filter(leaf => !leaf.right).length)).toBe(0); expect(errors).toEqual([]);
});

test('活动栏独立计时，真实高亮批注截图归属正确，共享研究笔记和 PDF 侧栏随焦点切换', async ({ page }) => {
  const { ui, frame, left, right, errors } = await setup(page, true); await page.clock.runFor(400);
  const paths = await frame.evaluate(() => { const x = window.__researchPort, docs = x.app.paperAttachments.documents(x.library.currentModal.papers[0]); return { main: docs[0].path, supplement: docs[1].path }; });
  const times = () => frame.evaluate(paths => { const x = window.__researchPort, sum = path => Object.values(x.activity.get(path)?.pages || {}).reduce((a, b) => a + b, 0); return { main: sum(paths.main), supplement: sum(paths.supplement) }; }, paths);
  await left.locator('.mupdf-reader-page-input').click(); await page.clock.runFor(5000); const firstTime = await times(); expect(firstTime.main).toBeGreaterThanOrEqual(4); expect(firstTime.supplement).toBeLessThan(1);
  await right.locator('.mupdf-reader-page-input').click(); const switchedTime = await times(); await page.clock.runFor(5000); const secondTime = await times(); expect(secondTime.main - switchedTime.main).toBeLessThan(.05); expect(secondTime.supplement - switchedTime.supplement).toBeGreaterThanOrEqual(4);
  await expect(ui.locator('.rw-reader-activity-host')).toHaveCount(2); await expect(ui.getByRole('button', { name: '查看逐页阅读统计', exact: true })).toHaveCount(1);
  await dragPdf(page, left, [51, 26], [320, 35]); const leftHighlight = left.getByRole('button', { name: '高亮选区', exact: true }); await expect(leftHighlight).toBeEnabled(); await leftHighlight.click(); await expect(left.locator('.mupdf-reader-highlight-quad').first()).toBeVisible();
  await dragPdf(page, right, [51, 26], [320, 35]); await right.getByRole('button', { name: '添加批注（保存为高亮）', exact: true }).click(); await ui.getByRole('textbox', { name: '批注内容', exact: true }).fill('附录中的依据'); await ui.getByRole('button', { name: '保存', exact: true }).click();
  await right.getByRole('button', { name: '框选图、表或任意 PDF 区域', exact: true }).click(); await dragPdf(page, right, [50, 65], [300, 140]); await expect(ui.locator('.mupdf-comment-region-preview img')).toBeVisible(); await ui.getByRole('textbox', { name: '区域摘录说明', exact: true }).fill('附录中的方法图'); await ui.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => frame.evaluate(paths => { const x = window.__researchPort; return [x.reader.getAnnotationsForFile(paths.main).length, x.reader.getAnnotationsForFile(paths.supplement).length]; }, paths)).toEqual([1, 2]);
  await left.getByRole('button', { name: '打开研究笔记', exact: true }).click(); const notes = ui.locator('#paper-notes-pane'); await notes.getByRole('button', { name: 'Markdown 源码', exact: true }).click(); await notes.getByLabel('Markdown 正文').fill('# 对照笔记\n\n正文结论对应补充分析。');
  await right.locator('.mupdf-reader-page-input').click(); await expect(notes.getByLabel('Markdown 正文')).toHaveValue('# 对照笔记\n\n正文结论对应补充分析。');
  await right.getByRole('button', { name: '打开研究侧栏', exact: true }).click(); await expect(notes).toBeHidden(); await expect(ui.locator('#reader-sidebar')).toContainText('附录中的依据'); await expect(ui.locator('#reader-sidebar')).toContainText('附录中的方法图');
  await left.locator('.mupdf-reader-page-input').click(); await expect(ui.locator('#reader-sidebar')).not.toContainText('附录中的依据');
  await ui.locator('#reader-back').click(); await page.reload(); await page.getByRole('button', { name: '文献库', exact: true }).click(); await expect(ui.locator('#port-status')).toContainText('已就绪');
  const stored = await page.frames().find(f => f.url().includes('port.html')).evaluate(paths => { const x = window.__researchPort; return { counts: [x.reader.getAnnotationsForFile(paths.main).length, x.reader.getAnnotationsForFile(paths.supplement).length], text: x.app.paperNotes.session(x.library.currentModal.papers[0].file).text }; }, paths); expect(stored.counts).toEqual([1, 2]); expect(stored.text).toContain('正文结论对应补充分析'); expect(errors).toEqual([]);
});

test('窄屏自动上下对照，可调高度和退出，并排读取失败保留正文', async ({ page }) => {
  const { ui, frame, left, right, errors } = await setup(page);
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 1000 }); await expect(ui.locator('.rw-pdf-comparison')).toHaveClass(/is-stacked/);
    const separator = ui.getByRole('separator', { name: '调整上下阅读高度', exact: true }); await expect(separator).toBeVisible(); await separator.press('Home'); await separator.press('ArrowDown');
    for (const pane of [left, right]) expect(await pane.evaluate(el => { const box = el.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth + 1 && box.height >= 170; })).toBe(true);
    expect(await ui.locator('html').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true); await page.screenshot({ path: `shots/pdf-comparison-${width}.png` });
  }
  await ui.getByRole('button', { name: '切换正文与附录', exact: true }).click(); await ui.getByRole('menuitem', { name: '退出并排阅读', exact: true }).click(); await expect(ui.locator('.rw-pdf-comparison')).toHaveCount(0);
  await ui.locator('#reader-back').click(); await ui.getByRole('tab', { name: /^附录/ }).click(); const panel = ui.getByRole('region', { name: '论文附录', exact: true });
  await panel.getByLabel('添加附录文件').setInputFiles({ name: 'Broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nbroken document') }); await expect(panel.locator('.rw-supplement-item')).toHaveCount(4);
  await panel.getByRole('button', { name: '与正文并排阅读：Broken.pdf', exact: true }).click(); await expect(ui.locator('#notices')).toContainText('无法打开 PDF'); await expect(ui.locator('.rw-pdf-comparison')).toHaveCount(0); await expect(ui.locator('.mupdf-reader-status')).toContainText('3 页');
  expect(await frame.evaluate(() => window.__researchPort.app.workspace.getLeavesOfType('mupdf-reader-view').length)).toBe(1); expect(errors).toEqual([]);
});
