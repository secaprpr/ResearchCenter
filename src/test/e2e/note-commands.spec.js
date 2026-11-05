import { test, expect } from '@playwright/test';
import { pdfFixture } from './pdfFixture';

async function setup(page) {
  const errors = []; page.on('pageerror', error => errors.push(error.message)); await page.route('https://**', route => route.abort());
  await page.goto('/'); await page.getByRole('button', { name: '文献库', exact: true }).click();
  const ui = page.frameLocator('.port-library-shell iframe'); await expect(ui.locator('#port-status')).toContainText('已就绪');
  await ui.locator('#port-pdf-input').setInputFiles({ name: 'Commands.pdf', mimeType: 'application/pdf', buffer: pdfFixture('Commands', 2) });
  await expect(ui.locator('.rw-paper-row')).toHaveCount(1);
  const frame = page.frames().find(f => f.url().includes('port.html'));
  await frame.evaluate(async () => { const { app, library } = window.__researchPort, file = library.currentModal.papers[0].file; app.paperNotes.update(file, '# Research\n\nBefore.\n\nTarget.\n\nAfter.\n'); await app.paperNotes.flush(file); });
  await ui.locator('.rw-paper-row').click(); await ui.getByRole('tab', { name: '笔记', exact: true }).click();
  await ui.getByRole('button', { name: '展开研究笔记', exact: true }).click();
  const modal = ui.locator('.rw-note-modal'), editor = modal.getByRole('textbox', { name: '研究笔记正文', exact: true }); await expect(editor).toBeVisible();
  const menu = ui.getByRole('listbox', { name: '插入内容', exact: true });
  const stored = () => frame.evaluate(() => { const { app, library } = window.__researchPort; return app.paperNotes.session(library.currentModal.papers[0].file).base; });
  return { ui, frame, modal, editor, menu, stored, errors };
}
async function invoke(page, editor, query) {
  await editor.locator('p').filter({ hasText: /^Target\.$/ }).click();
  await page.keyboard.press('Home'); await page.keyboard.press('Shift+End'); await page.keyboard.type('\\' + query);
}
test('反斜杠菜单搜索并插入标题，保留相邻正文且可撤销重做和保存', async ({ page }) => {
  const { editor, menu, stored, errors } = await setup(page); await invoke(page, editor, 'h2');
  await expect(menu).toBeVisible(); await expect(menu.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter'); await expect(menu).toHaveCount(0);
  await page.keyboard.type('New heading'); await expect(editor.locator('h2')).toHaveText('New heading');
  await editor.press('Control+s'); await expect.poll(stored).toContain('## New heading');
  expect(await stored()).toContain('Before.'); expect(await stored()).toContain('After.'); expect(await stored()).not.toContain('RWNOTECARET');
  await page.keyboard.press('Control+z'); await expect(editor.locator('h2')).toHaveText('');
  await page.keyboard.press('Control+z'); await expect(editor.locator('h2')).toHaveCount(0);
  await page.keyboard.press('Control+y'); await expect(editor.locator('h2')).toHaveText('');
  await page.keyboard.press('Control+y'); await expect(editor.locator('h2')).toHaveText('New heading');
  expect(errors).toEqual([]);
});
test('方向键选择、鼠标插入与 Esc 取消不关闭笔记窗口，普通路径不受影响', async ({ page }) => {
  const { editor, modal, menu, stored, errors } = await setup(page); await invoke(page, editor, '');
  await expect(menu).toBeVisible(); await page.keyboard.press('ArrowDown'); await expect(menu.getByRole('option', { name: '一级标题', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0); await expect(modal).toBeVisible(); await expect(editor).toContainText('\\');
  await page.keyboard.type('data\\file'); await expect(menu).toHaveCount(0); await expect(editor).toContainText('\\data\\file');
  await editor.locator('p').filter({ hasText: /^\\data\\file$/ }).click(); await page.keyboard.press('Home'); await page.keyboard.press('Shift+End'); await page.keyboard.type('\\method');
  await expect(menu).toBeVisible(); await menu.getByRole('option', { name: '方法', exact: true }).click();
  await page.keyboard.type('Evidence here'); await expect(editor.locator('blockquote.callout[data-subtype=method]')).toContainText('Evidence here');
  await editor.press('Control+s'); await expect.poll(stored).toContain('> [!method] 方法'); expect(await stored()).toContain('> Evidence here');
  expect(errors).toEqual([]);
});
test('表格代码与公式可连续输入，菜单在窄屏与底部保持可见，切换模式清理浮层', async ({ page }) => {
  const { ui, modal, editor, menu, errors } = await setup(page); await invoke(page, editor, 'table');
  await page.keyboard.press('Enter'); await page.keyboard.type('Column'); await expect(editor.locator('th').first()).toHaveText('Column');
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await editor.locator('p').filter({ hasText: /^After\.$/ }).click(); await page.keyboard.press('Home'); await page.keyboard.press('Shift+End'); await page.keyboard.type('\\');
    await expect(menu).toBeVisible(); expect(await menu.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.top >= 0; })).toBe(true);
    const roles = await menu.evaluate(el => {
      const actual = getComputedStyle(el), reference = getComputedStyle(document.querySelector('.rw-note-modal .rw-note-actions button'));
      return { actual: Object.fromEntries(['fontFamily', 'fontSize', 'fontWeight', 'lineHeight'].map(key => [key, actual[key]])), reference: Object.fromEntries(['fontFamily', 'fontSize', 'fontWeight', 'lineHeight'].map(key => [key, reference[key]])), height: el.querySelector('[role=option]').getBoundingClientRect().height };
    }); expect(roles.actual).toEqual(roles.reference); expect(Math.abs(roles.height - 32)).toBeLessThan(.01);
    await page.screenshot({ path: `shots/note-commands-${width}.png` });
    await page.keyboard.press('Escape'); await page.keyboard.press('Home'); await page.keyboard.press('Shift+End'); await page.keyboard.type('After.');
  }
  await editor.locator('p').filter({ hasText: /^After\.$/ }).click(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('\\code'); await page.keyboard.press('Enter'); await page.keyboard.type('const x = 1;');
  await expect(editor.locator('[data-type=code-block]')).toContainText('const x = 1;');
  await page.keyboard.press('Enter'); await page.keyboard.type('\\h2'); await expect(menu).toHaveCount(0);
  await modal.getByRole('button', { name: 'Markdown 源码', exact: true }).click(); await expect(menu).toHaveCount(0);
  await expect(ui.getByLabel('Markdown 正文').last()).toHaveValue(/const x = 1;/);
  expect(errors).toEqual([]);
});

test('中文输入法不抢候选回车，中文筛选后可插入，PDF 侧栏与保存重载共享命令', async ({ page }) => {
  const { ui, modal, editor, menu, stored, errors } = await setup(page); await invoke(page, editor, ''); await expect(menu).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'zhong', selectionStart: 5, selectionEnd: 5 }); await expect(menu).toHaveCount(0);
  await cdp.send('Input.imeSetComposition', { text: '重点', selectionStart: 2, selectionEnd: 2 }); await expect(menu).toHaveCount(0);
  await cdp.send('Input.insertText', { text: '重点' }); await expect(menu.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter'); await page.keyboard.insertText('需要复核的证据'); await expect(editor.locator('.callout[data-subtype=important]')).toContainText('需要复核的证据');
  await editor.press('Control+s'); await expect.poll(stored).toContain('> 需要复核的证据');
  await modal.getByRole('button', { name: '关闭弹窗', exact: true }).click(); await expect(menu).toHaveCount(0);
  await ui.locator('.rw-paper-row').dblclick(); await expect(ui.locator('.mupdf-reader-page')).toBeVisible(); await ui.getByRole('button', { name: '打开研究笔记', exact: true }).click();
  const pane = ui.locator('#paper-notes-pane'), pdfEditor = pane.getByRole('textbox', { name: '研究笔记正文', exact: true });
  await expect(pdfEditor.locator('.callout')).toContainText('需要复核的证据');
  await pdfEditor.locator('p').filter({ hasText: /^After\.$/ }).click(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('\\math'); await page.keyboard.press('Enter'); await page.keyboard.type('E=mc^2');
  await expect(pdfEditor.locator('.vditor-wysiwyg__block[data-type=math-block]')).toContainText('E=mc^2'); await pdfEditor.press('Control+s'); await expect.poll(stored).toContain('E=mc^2');
  await page.reload(); await page.getByRole('button', { name: '文献库', exact: true }).click(); await ui.locator('.rw-paper-row').click(); await ui.getByRole('tab', { name: '笔记', exact: true }).click();
  await expect(ui.locator('.rw-paper-detail .callout')).toContainText('需要复核的证据'); await ui.getByRole('button', { name: 'Markdown 源码', exact: true }).click(); await expect(ui.getByLabel('Markdown 正文')).not.toHaveValue(/RWNOTECARET/); await expect(ui.getByLabel('Markdown 正文')).toHaveValue(/E=mc\^2/); expect(errors).toEqual([]);
});

test('基础块保持可编辑且导出标准 Markdown，未知命令和普通文字的反斜杠不吞内容', async ({ page }) => {
  const { modal, editor, menu, stored, errors } = await setup(page);
  for (const [query, selector, expected] of [
    ['list', 'ul:not([data-type=task]) li', '- Item'], ['ordered', 'ol li', '1. Item'],
    ['todo', 'li:has(input[type=checkbox])', '- [ ] Item'], ['quote', 'blockquote p', '> Item'],
    ['divider', 'p', '---'], ['paragraph', 'p', 'Item'],
  ]) {
    await modal.getByRole('button', { name: 'Markdown 源码', exact: true }).click(); await modal.getByLabel('Markdown 正文').fill('Before.\n\nTarget.\n\nAfter.\n'); await modal.getByRole('button', { name: '所见所得编辑', exact: true }).click();
    await invoke(page, editor, query); await expect(menu).toBeVisible();
    // "list" also matches ordered/task lists; the first match is the bullet list.
    await page.keyboard.press('Enter'); await page.keyboard.type('Item'); await expect(editor.locator(selector).filter({ hasText: /Item/ }).first()).toBeVisible();
    await editor.press('Control+s'); await expect.poll(stored).toContain(expected); expect(await stored()).toContain('Before.'); expect(await stored()).toContain('After.'); expect(await stored()).not.toContain('RWNOTECARET');
  }
  await editor.locator('p').filter({ hasText: /^After\.$/ }).click(); await page.keyboard.press('End'); await page.keyboard.type(' C:\\data\\file'); await expect(menu).toHaveCount(0);
  await page.keyboard.press('Enter'); await page.keyboard.type('\\not-a-command'); await expect(menu.getByRole('status')).toHaveText('无匹配项'); await page.keyboard.press('Enter'); await expect(editor).toContainText('\\not-a-command');
  expect(errors).toEqual([]);
});

test('课题任务笔记复用命令菜单，退出任务后不遗留浮层或丢失正文', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message)); await page.route('https://**', route => route.abort());
  await page.goto('/'); await page.getByRole('button', { name: '科研课题', exact: true }).click(); await page.getByRole('button', { name: '新建课题', exact: true }).click();
  const topic = page.getByRole('dialog', { name: '新建科研课题' }); await topic.getByLabel('课题名称', { exact: true }).fill('Command study'); await topic.getByRole('button', { name: '创建课题', exact: true }).click();
  await page.getByRole('button', { name: '新建任务', exact: true }).first().click(); const task = page.getByRole('dialog', { name: '新建任务', exact: true }); await task.getByLabel('任务名称', { exact: true }).fill('Command test'); await task.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('tab', { name: /关联内容/ }).click(); const editor = page.getByRole('textbox', { name: '研究笔记正文', exact: true }); await expect(editor).toBeVisible();
  await editor.click(); await page.keyboard.type('\\h2'); const menu = page.getByRole('listbox', { name: '插入内容', exact: true }); await expect(menu.getByRole('option')).toHaveCount(1); await page.keyboard.press('Enter'); await page.keyboard.type('Experiment rationale'); await expect(editor.locator('h2')).toHaveText('Experiment rationale');
  await page.getByRole('button', { name: '文献库', exact: true }).click(); await expect(menu).toHaveCount(0); await page.getByRole('button', { name: '科研课题', exact: true }).click();
  await page.getByRole('button', { name: 'Command test', exact: true }).click(); await page.getByRole('tab', { name: /关联内容/ }).click(); await expect(editor.locator('h2')).toHaveText('Experiment rationale'); expect(errors).toEqual([]);
});
