import { test, expect } from '@playwright/test';
import { multiPagePdfFixture } from './pdfFixture';

async function setup(page) {
  const errors = []; page.on('pageerror', error => errors.push(error.message)); await page.route('https://**', route => route.abort());
  await page.goto('/'); await page.getByRole('button', { name: '文献库', exact: true }).click();
  const ui = page.frameLocator('.port-library-shell iframe'); await expect(ui.locator('#port-status')).toContainText('已就绪');
  await ui.locator('#port-pdf-input').setInputFiles({ name: 'Linked Notes.pdf', mimeType: 'application/pdf', buffer: multiPagePdfFixture('Linked paper', 5) });
  await expect(ui.locator('.rw-paper-row')).toHaveCount(1);
  const frame = page.frames().find(f => f.url().includes('port.html'));
  await frame.evaluate(async () => {
    const x = window.__researchPort, file = x.library.currentModal.papers[0].file;
    x.app.paperNotes.update(file, ['# 阅读笔记', '## 研究方法', ...Array(12).fill('方法段落。需要对照图表和原文，记录方法的适用范围。'), '## 实验结果', ...Array(12).fill('实验段落。核对外部验证与结果表格。'), '## 附录对照', ...Array(12).fill('附录中的补充证据。')].join('\n\n'));
    await x.app.paperNotes.flush(file);
  });
  await ui.locator('.rw-paper-row').dblclick(); await expect(ui.locator('.mupdf-reader-page')).toHaveCount(5);
  await ui.getByRole('button', { name: '打开研究笔记', exact: true }).click();
  const pane = ui.locator('#paper-notes-pane'), editor = pane.getByRole('textbox', { name: '研究笔记正文', exact: true }); await expect(editor).toContainText('研究方法');
  return { ui, pane, editor, frame, errors };
}
const body = frame => frame.evaluate(() => { const x = window.__researchPort; return x.app.paperNotes.session(x.library.currentModal.papers[0].file).base; });
async function bind(ui, editor, title) {
  const heading = editor.locator('h1,h2,h3,h4,h5,h6').filter({ hasText: title }); await heading.click({ button: 'right' });
  await ui.getByRole('menu', { name: '笔记与论文定位', exact: true }).getByRole('menuitem', { name: '关联当前 PDF 位置', exact: true }).click();
  await expect(heading.locator('a[href^="#rw-pdf="]')).toHaveCount(1);
}

test('标题关联、原文点击跳转、源码往返、解除与重启持久化', async ({ page }) => {
  const { ui, pane, editor, frame, errors } = await setup(page);
  await bind(ui, editor, '研究方法'); await expect.poll(() => body(frame)).toContain('#rw-pdf=');
  await frame.evaluate(() => window.__researchPort.app.workspace.mainLeaf.view.reader.goToPage(4, 'auto'));
  await bind(ui, editor, '实验结果');
  const resultLink = editor.getByRole('heading', { name: /实验结果/ }).locator('a[href^="#rw-pdf="]');
  await ui.getByRole('button', { name: '滚动联动', exact: true }).click();
  await expect(ui.getByRole('button', { name: '滚动联动', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await frame.evaluate(() => window.__researchPort.app.workspace.mainLeaf.view.reader.goToPage(1, 'auto'));
  await resultLink.click(); await expect.poll(() => frame.evaluate(() => window.__researchPort.app.workspace.mainLeaf.view.reader.currentPage)).toBe(3);
  await pane.getByRole('button', { name: 'Markdown 源码', exact: true }).click(); const source = pane.getByRole('textbox', { name: 'Markdown 正文', exact: true });
  expect(await source.inputValue()).toMatch(/## 实验结果\s*\[↗\]\(#rw-pdf=/);
  await pane.getByRole('button', { name: '所见所得编辑', exact: true }).click(); await expect(resultLink).toHaveCount(1);
  await resultLink.click({ button: 'right' }); await ui.getByRole('menuitem', { name: '解除关联', exact: true }).click(); await expect(resultLink).toHaveCount(0);
  await expect(editor.getByRole('heading', { name: '实验结果', exact: true })).toBeVisible(); await editor.press('Control+s');
  await page.reload(); await page.getByRole('button', { name: '文献库', exact: true }).click(); await ui.locator('.rw-paper-row').dblclick(); await ui.getByRole('button', { name: '打开研究笔记', exact: true }).click();
  await expect(editor.getByRole('heading', { name: /研究方法/ }).locator('a[href^="#rw-pdf="]')).toHaveCount(1);
  await expect(resultLink).toHaveCount(0); await expect(ui.getByRole('button', { name: '滚动联动', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('笔记与 PDF 按章节双向跟随且关闭联动后保持独立', async ({ page }) => {
  const { ui, pane, editor, frame, errors } = await setup(page);
  await bind(ui, editor, '研究方法');
  await frame.evaluate(() => window.__researchPort.app.workspace.mainLeaf.view.reader.goToPage(4, 'auto'));
  await bind(ui, editor, '实验结果');
  // PDF interaction owns the next movement, even when the editor retained focus.
  await frame.evaluate(() => { const r = window.__researchPort.app.workspace.mainLeaf.view.reader; r.root.dispatchEvent(new WheelEvent('wheel', { bubbles: true })); r.goToPage(1, 'auto'); });
  await expect(editor.locator('.rw-note-location-active')).toContainText('研究方法');
  await frame.evaluate(() => { const r = window.__researchPort.app.workspace.mainLeaf.view.reader; r.root.dispatchEvent(new WheelEvent('wheel', { bubbles: true })); r.goToPage(4, 'auto'); });
  await expect(editor.locator('.rw-note-location-active')).toContainText('实验结果');
  await expect.poll(() => editor.getByRole('heading', { name: /实验结果/ }).evaluate(el => Math.abs(el.getBoundingClientRect().top - el.closest('[contenteditable=true]').getBoundingClientRect().top - 32))).toBeLessThan(15);
  await editor.evaluate(scroll => { scroll.dispatchEvent(new WheelEvent('wheel', { bubbles: true })); scroll.scrollTop = 0; });
  await expect.poll(() => frame.evaluate(() => window.__researchPort.app.workspace.mainLeaf.view.reader.currentPage)).toBe(0);
  await ui.getByRole('button', { name: '滚动联动', exact: true }).click();
  const before = await editor.evaluate(el => el.scrollTop);
  await frame.evaluate(() => { const r = window.__researchPort.app.workspace.mainLeaf.view.reader; r.root.dispatchEvent(new WheelEvent('wheel', { bubbles: true })); r.goToPage(5, 'auto'); });
  await page.waitForTimeout(500); expect(await editor.evaluate(el => el.scrollTop)).toBe(before);
  expect(errors).toEqual([]);
});

test('框选图片带来源插入，保留原图与 Markdown，PDF 右键可关联标题', async ({ page }) => {
  const { ui, pane, editor, frame, errors } = await setup(page);
  await frame.evaluate(() => { const r = window.__researchPort.app.workspace.mainLeaf.view.reader; r.goToPage(2, 'auto'); });
  const pdf = ui.locator('.mupdf-reader-page').nth(1); await pdf.click({ button: 'right', position: { x: 130, y: 100 } });
  await ui.getByRole('menuitem', { name: '关联到研究笔记…', exact: true }).click();
  const modal = ui.locator('.rw-note-link-modal'); await expect(modal.getByRole('button', { name: '研究方法', exact: true })).toBeVisible();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await modal.evaluate(el => { const box = el.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; })).toBe(true);
    await page.screenshot({ path: `shots/note-pdf-link-picker-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await modal.getByRole('button', { name: '研究方法', exact: true }).click(); await expect(modal).toHaveCount(0); await expect(editor.getByRole('heading', { name: /研究方法/ }).locator('a[href^="#rw-pdf="]')).toHaveCount(1);
  await editor.getByRole('heading', { name: /研究方法/ }).click({ position: { x: 15, y: 10 } }); await editor.press('End');
  await ui.getByRole('button', { name: '框选图表插入研究笔记', exact: true }).click();
  const box = await pdf.boundingBox();
  await page.mouse.move(box.x + box.width * 45 / 612, box.y + box.height * 15 / 792); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 400 / 612, box.y + box.height * 110 / 792, { steps: 12 }); await page.mouse.up();
  const image = editor.locator('a[href^="#rw-pdf="] img'); await expect(image).toHaveCount(1); await expect(image).toBeVisible();
  await expect.poll(() => body(frame)).toContain('[![图表摘录](data:image/');
  await image.click(); await expect.poll(() => frame.evaluate(() => window.__researchPort.app.workspace.mainLeaf.view.reader.currentPage)).toBe(1);
  await expect(ui.locator('.rw-pdf-location-flash')).toHaveCount(1);
  await expect(ui.locator('#notices .notice')).toHaveCount(0, { timeout: 10000 });
  for (const width of [1440, 768, 390]) { await page.setViewportSize({ width, height: 900 }); await image.scrollIntoViewIfNeeded(); await page.screenshot({ path: `shots/note-pdf-links-${width}.png` }); }
  await page.setViewportSize({ width: 1440, height: 900 });
  await image.click({ button: 'right' }); await ui.getByRole('menuitem', { name: '解除关联', exact: true }).click(); await expect(editor.locator('img')).toHaveCount(1); await expect(editor.locator('a[href^="#rw-pdf="] img')).toHaveCount(0);
  await editor.press('Control+z'); await expect(editor.locator('a[href^="#rw-pdf="] img')).toHaveCount(1); await editor.press('Control+y'); await expect(editor.locator('a[href^="#rw-pdf="] img')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('附录定位保留独立来源，返回正文后点击笔记可打开对应附录', async ({ page }) => {
  const { ui, pane, editor, frame, errors } = await setup(page);
  await bind(ui, editor, '研究方法');
  const paths = await frame.evaluate(async bytes => {
    const x = window.__researchPort, paper = x.library.currentModal.papers[0], main = x.app.workspace.mainLeaf.view.reader.file.path;
    const result = await x.app.paperAttachments.add(paper.file, [new File([Uint8Array.from(bytes)], 'Linked Supplement.pdf', { type: 'application/pdf' })]);
    const supplement = result.added[0].path;
    await x.reader.openPdf(x.vault.getAbstractFileByPath(supplement), false); x.app.workspace.mainLeaf.view.reader.goToPage(2, 'auto');
    return { main, supplement };
  }, [...multiPagePdfFixture('Supplementary evidence', 3)]);
  await bind(ui, editor, '附录对照');
  const link = editor.getByRole('heading', { name: /附录对照/ }).locator('a[href^="#rw-pdf="]');
  expect(decodeURIComponent(await link.getAttribute('href'))).toContain(paths.supplement);
  await frame.evaluate(async path => { const x = window.__researchPort; await x.reader.openPdf(x.vault.getAbstractFileByPath(path), false); }, paths.main);
  await expect(pane).toBeVisible(); await link.click();
  await expect.poll(() => frame.evaluate(() => window.__researchPort.app.workspace.mainLeaf.view.reader.file.path)).toBe(paths.supplement);
  await expect.poll(() => frame.evaluate(() => window.__researchPort.app.workspace.mainLeaf.view.reader.currentPage)).toBe(1);
  await expect(editor).toContainText('研究方法');
  expect(errors).toEqual([]);
});
