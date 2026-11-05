import { test, expect } from '@playwright/test';
import { pdfFixture } from './pdfFixture';

const article = '# 阅读与研究\n\n## 研究问题\n\n这是一份 **研究笔记**，记录 `attention` 与推理的联系。\n\n### 方法与证据\n\n- 比较不同的模型\n- 检查实验设置\n\n> 先观察证据，再形成判断。\n\n$$\nR(w) = \\frac{1}{N} \\sum_{i=1}^N x_i\n$$\n\n| 方法 | 结果 |\n| --- | --- |\n| Baseline | 0.82 |\n\n```python\nscore = model(x)\n```\n';
async function setup(page) {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**', route => route.abort());
  await page.goto('/'); await page.getByRole('button', { name: '文献库', exact: true }).click();
  const ui = page.frameLocator('.port-library-shell iframe');
  await expect(ui.locator('#port-status')).toContainText('已就绪');
  await ui.locator('#port-pdf-input').setInputFiles({ name: 'Research Notes.pdf', mimeType: 'application/pdf', buffer: pdfFixture('Research Notes', 2) });
  await expect(ui.locator('.rw-paper-row')).toHaveCount(1);
  const frame = page.frames().find(frame => frame.url().includes('port.html'));
  await frame.evaluate(async body => {
    const { app, library } = window.__researchPort;
    const file = library.currentModal.papers[0].file;
    app.paperNotes.update(file, body); await app.paperNotes.flush(file);
  }, article);
  return { ui, frame, errors };
}
const getBody = frame => frame.evaluate(() => { const { app, library } = window.__researchPort; return app.paperNotes.session(library.currentModal.papers[0].file).base; });

test('研究笔记所见所得、公式离线渲染、源码往返和重启保存', async ({ page }) => {
  const { ui, frame, errors } = await setup(page);
  await ui.locator('.rw-paper-row').click(); await ui.getByRole('tab', { name: '笔记', exact: true }).click();
  let editor = ui.getByRole('textbox', { name: '研究笔记正文', exact: true });
  await expect(editor.locator('h1')).toHaveText('阅读与研究');
  await expect(editor.locator('strong')).toContainText('研究笔记');
  await expect(editor.locator('.katex').first()).toBeVisible();
  await expect(editor.locator('table')).toBeVisible();
  expect(await editor.evaluate(el => getComputedStyle(el).fontFamily)).toBe(await ui.locator('.rw-note-actions h3').evaluate(el => getComputedStyle(el).fontFamily));
  await ui.getByRole('button', { name: '展开研究笔记', exact: true }).click();
  const modal = ui.locator('.rw-note-modal');
  editor = modal.getByRole('textbox', { name: '研究笔记正文', exact: true });
  await editor.click(); await editor.press('Control+End'); await editor.press('ArrowDown'); await editor.press('End'); await editor.press('Enter'); await page.keyboard.type('A useful observation.');
  await editor.press('Control+s');
  await expect.poll(() => getBody(frame)).toContain('A useful observation.');
  await modal.getByRole('button', { name: 'Markdown 源码', exact: true }).click();
  const source = modal.getByRole('textbox', { name: 'Markdown 正文', exact: true });
  const markdown = await source.inputValue();
  expect(markdown).toContain('**研究笔记**'); expect(markdown).toContain('$$'); expect(markdown).toContain('```python');
  await source.fill(markdown + '\n\n## 新的结论\n\n- [ ] 验证想法\n');
  await modal.getByRole('button', { name: '所见所得编辑', exact: true }).click();
  await expect(modal.locator('h2').filter({ hasText: '新的结论' })).toBeVisible();
  await page.screenshot({ path: 'shots/research-notes-1440.png' });
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(modal.getByRole('button', { name: '导出 Markdown', exact: true })).toBeInViewport();
    expect(await modal.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; })).toBe(true);
    await page.screenshot({ path: `shots/research-notes-${width}.png` });
  }
  await modal.getByRole('button', { name: '关闭弹窗', exact: true }).click(); await expect(modal).toHaveCount(0);
  await page.reload(); await page.getByRole('button', { name: '文献库', exact: true }).click();
  await ui.locator('.rw-paper-row').click(); await ui.getByRole('tab', { name: '笔记', exact: true }).click();
  await expect(ui.getByRole('textbox', { name: '研究笔记正文', exact: true })).toContainText('新的结论');
  expect(errors).toEqual([]);
});

test('快速编辑撤销重做、导入导出和立即关闭不丢失正文', async ({ page }) => {
  const { ui, frame, errors } = await setup(page);
  await ui.locator('.rw-paper-row').click(); await ui.getByRole('tab', { name: '笔记', exact: true }).click();
  await ui.getByRole('button', { name: '展开研究笔记', exact: true }).click();
  const modal = ui.locator('.rw-note-modal');
  await modal.getByRole('button', { name: 'Markdown 源码', exact: true }).click(); await modal.getByLabel('Markdown 正文').fill('A useful observation.\n');
  await modal.getByRole('button', { name: '所见所得编辑', exact: true }).click();
  const editor = modal.getByRole('textbox', { name: '研究笔记正文', exact: true });
  await expect(editor).toContainText('A useful observation.');
  await editor.click(); await editor.press('Control+a');
  await editor.press('Control+b');
  await expect(editor.locator('strong, b').filter({ hasText: 'A useful observation.' })).toHaveText('A useful observation.');
  await expect.poll(() => getBody(frame)).toContain('**A useful observation.**');
  await editor.press('Control+z'); await expect(editor.locator('strong, b')).toHaveCount(0);
  await editor.press('Control+y'); await expect(editor.locator('strong, b').filter({ hasText: 'A useful observation.' })).toHaveText('A useful observation.');
  await modal.locator('input[type=file]').setInputFiles({ name: 'extra.md', mimeType: 'text/markdown', buffer: Buffer.from('## 导入的实验\n\n保留原笔记') });
  await expect(editor.locator('h2')).toHaveText('导入的实验');
  await expect(editor).toContainText('A useful observation.');
  const downloaded = page.waitForEvent('download'); await modal.getByRole('button', { name: '导出 Markdown', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe('Research Notes.md');
  await editor.click(); await editor.press('Control+End'); await editor.press('Enter'); await page.keyboard.type('Immediate close retains this.');
  await modal.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await expect(modal).toHaveCount(0); await expect.poll(() => getBody(frame)).toContain('Immediate close retains this.');
  const search = ui.getByRole('searchbox', { name: '搜索文献', exact: true }); await search.fill('Immediate close retains'); await expect(ui.locator('.rw-paper-row')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('PDF 并排笔记自动保存、调宽、切回批注与失败重试', async ({ page }) => {
  const { ui, frame, errors } = await setup(page);
  await ui.locator('.rw-paper-row').dblclick(); await expect(ui.locator('.mupdf-reader-page')).toHaveCount(1);
  await ui.getByRole('button', { name: '打开研究笔记', exact: true }).click();
  const pane = ui.locator('#paper-notes-pane');
  await expect(pane.getByRole('textbox', { name: '研究笔记正文', exact: true })).toContainText('研究问题');
  const handle = pane.getByRole('separator', { name: '调整研究笔记宽度' });
  const before = await pane.evaluate(el => el.getBoundingClientRect().width); await handle.press('ArrowLeft');
  expect(await pane.evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(before);
  await pane.getByRole('button', { name: 'Markdown 源码', exact: true }).click();
  await frame.evaluate(() => {
    const { vault } = window.__researchPort; const modify = vault.modify.bind(vault); let fail = true;
    vault.modify = async (file, text) => { if (fail && text.includes('Sidebar research')) { fail = false; throw new Error('测试写入失败'); } return modify(file, text); };
  });
  const source = pane.getByRole('textbox', { name: 'Markdown 正文' }); await source.fill(article + '\nSidebar research');
  await source.press('Control+s'); await expect(pane.getByRole('alert')).toContainText('测试写入失败');
  await pane.getByRole('button', { name: '重试', exact: true }).click(); await expect(pane.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => getBody(frame)).toContain('Sidebar research');
  await pane.getByRole('button', { name: '所见所得编辑', exact: true }).click();
  await page.screenshot({ path: 'shots/research-notes-pdf-1440.png' });
  await ui.getByRole('button', { name: '打开研究侧栏', exact: true }).click();
  await expect(pane).toBeHidden(); await expect(ui.locator('#reader-sidebar')).toBeVisible();
  await ui.getByRole('button', { name: '打开研究笔记', exact: true }).click(); await expect(ui.locator('#reader-sidebar')).toBeHidden();
  await ui.locator('#reader-back').click(); await expect(ui.locator('#reader-workspace')).toBeHidden();
  await ui.getByRole('tab', { name: '笔记', exact: true }).click();
  await expect(ui.getByRole('textbox', { name: '研究笔记正文', exact: true })).toContainText('Sidebar research');
  expect(errors).toEqual([]);
});

test('宽屏拖宽 PDF 笔记后正文与滚动区跟随面板，不留下固定宽度空白', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1000 });
  const { ui, errors } = await setup(page);
  await ui.locator('.rw-paper-row').dblclick(); await expect(ui.locator('.mupdf-reader-page')).toBeVisible();
  await ui.getByRole('button', { name: '打开研究笔记', exact: true }).click();
  const pane = ui.locator('#paper-notes-pane');
  const editor = pane.getByRole('textbox', { name: '研究笔记正文', exact: true }); await expect(editor).toBeVisible();
  const handle = pane.getByRole('separator', { name: '调整研究笔记宽度' }); const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 30); await page.mouse.down();
  await page.mouse.move(box.x - 500, box.y + 30, { steps: 10 }); await page.mouse.up();
  expect(await pane.evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(1000);
  for (const width of [2560, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    const geometry = await editor.evaluate(el => { const r = el.getBoundingClientRect(), p = el.parentElement.getBoundingClientRect(); return { gap: p.right - r.right, width: r.width, surface: p.width }; });
    expect(geometry.gap).toBeLessThanOrEqual(2); expect(Math.abs(geometry.width - geometry.surface)).toBeLessThanOrEqual(2);
    await page.screenshot({ path: `shots/research-notes-fluid-${width}.png` });
  }
  expect(errors).toEqual([]);
});

test('合并工具栏保持单行，格式菜单不被裁切，窄屏横向操作和源码切换保持可用', async ({ page }) => {
  const { ui, errors } = await setup(page);
  await ui.locator('.rw-paper-row').dblclick(); await expect(ui.locator('.mupdf-reader-page')).toBeVisible();
  await ui.getByRole('button', { name: '打开研究笔记', exact: true }).click();
  const pane = ui.locator('#paper-notes-pane'), editor = pane.getByRole('textbox', { name: '研究笔记正文', exact: true });
  await expect(editor).toBeVisible();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const toolbar = pane.getByRole('toolbar', { name: '研究笔记工具', exact: true }); await expect(toolbar).toHaveCount(1);
    const geometry = await toolbar.evaluate(el => { const buttons = [...el.querySelectorAll('.rw-icon-button, .vditor-toolbar__item > button')], boxes = buttons.map(button => button.getBoundingClientRect()); return { height: el.getBoundingClientRect().height, centers: boxes.map(box => box.y + box.height / 2), styles: buttons.map(button => { const s = getComputedStyle(button), r = button.getBoundingClientRect(); return [s.fontFamily, s.fontSize, s.borderRadius, r.width, r.height]; }) }; });
    expect(geometry.height).toBeLessThanOrEqual(48); expect(Math.max(...geometry.centers) - Math.min(...geometry.centers)).toBeLessThanOrEqual(1);
    for (const style of geometry.styles) expect(style).toEqual(geometry.styles[0]);
    await toolbar.locator('button[data-type=redo]').focus();
    expect(await toolbar.locator('button[data-type=redo]').evaluate(el => { const r = el.getBoundingClientRect(), utility = el.closest('.vditor-toolbar').querySelector('.rw-note-utilities').getBoundingClientRect(); return r.left >= utility.right && r.right <= innerWidth; })).toBe(true);
    await expect(toolbar.getByRole('button', { name: '导出 Markdown', exact: true })).toBeInViewport();
    await toolbar.evaluate(el => { el.scrollLeft = 0; });
    await editor.locator('p').first().click();
    const heading = toolbar.locator('button[data-type=headings]'); await heading.click();
    const menu = toolbar.locator('.vditor-hint'); await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox(), toolbarBox = await toolbar.boundingBox(); expect(menuBox.y).toBeGreaterThanOrEqual(toolbarBox.y + toolbarBox.height - 1);
    expect(menuBox.x).toBeGreaterThanOrEqual(0); expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `shots/research-notes-toolbar-${width}.png` });
    await heading.press('Escape'); await expect(menu).toBeHidden(); await expect(pane).toBeVisible();
    const top = (await toolbar.boundingBox()).y;
    await toolbar.getByRole('button', { name: 'Markdown 源码', exact: true }).click(); await expect(pane.getByLabel('Markdown 正文')).toBeVisible();
    expect((await pane.getByRole('toolbar', { name: '研究笔记工具' }).boundingBox()).y).toBe(top);
    await pane.getByRole('button', { name: '所见所得编辑', exact: true }).click(); await expect(editor).toBeVisible();
  }
  const toolbar = pane.getByRole('toolbar', { name: '研究笔记工具', exact: true });
  await editor.locator('p').first().click(); await toolbar.locator('button[data-type=headings]').click(); await toolbar.locator('button[data-tag=h2]').click();
  await expect(editor.locator('h2').filter({ hasText: '这是一份' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('点击标题和正文不弹出锚点或空框，表格上下文编辑仍可用', async ({ page }) => {
  const { ui, errors } = await setup(page);
  await ui.locator('.rw-paper-row').dblclick(); await expect(ui.locator('.mupdf-reader-page')).toBeVisible();
  await ui.getByRole('button', { name: '打开研究笔记', exact: true }).click();
  const pane = ui.locator('#paper-notes-pane'), editor = pane.getByRole('textbox', { name: '研究笔记正文', exact: true }); await expect(editor).toBeVisible();
  const panel = pane.locator('.vditor-wysiwyg > .vditor-panel').first();
  await editor.locator('h2').first().click(); await expect(panel).toHaveAttribute('data-note-context', 'heading'); await expect(panel).toBeHidden();
  await page.keyboard.press('End'); await page.keyboard.type(' Heading edit');
  await expect(editor.locator('h2').first()).toContainText('Heading edit'); await expect(panel).toBeHidden();
  await editor.locator('p').first().click(); await expect(panel).toHaveAttribute('data-note-context', 'block'); await expect(panel).toBeHidden();
  await editor.locator('li').first().click(); await expect(panel).toHaveAttribute('data-note-context', 'li'); await expect(panel).toBeHidden();
  await editor.locator('blockquote p').click(); await expect(panel).toHaveAttribute('data-note-context', 'blockquote'); await expect(panel).toBeHidden();
  await editor.locator('td').first().click(); await expect(panel).toHaveAttribute('data-note-context', 'table'); await expect(panel).toBeVisible();
  await editor.locator('h2').first().click(); await expect(panel).toBeHidden();
  await page.screenshot({ path: 'shots/research-notes-no-heading-popover.png' });
  expect(errors).toEqual([]);
});
