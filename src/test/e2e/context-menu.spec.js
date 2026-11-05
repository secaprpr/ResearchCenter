import { test, expect } from '@playwright/test';
import { pdfFixture } from './pdfFixture';

async function setup(page) {
  await page.goto('/'); await page.getByRole('button', { name: '文献库', exact: true }).click();
  const ui = page.frameLocator('.port-library-shell iframe');
  await expect(ui.locator('#port-status')).toContainText('已就绪');
  await ui.locator('#port-pdf-input').setInputFiles(['A', 'B', 'C'].map(name => ({ name: `Menu ${name}.pdf`, mimeType: 'application/pdf', buffer: pdfFixture(`Distinct menu document ${name}`) })));
  await expect(ui.locator('.rw-paper-row')).toHaveCount(3);
  await ui.getByLabel('文献排序', { exact: true }).selectOption('title');
  return { ui, frame: page.frames().find(frame => frame.url().includes('port.html')), row: name => ui.locator('.rw-paper-row').filter({ has: ui.locator('.rw-paper-title', { hasText: `Menu ${name}` }) }) };
}

test('右键保持多选并批量设置；右键未选项切换单篇；键盘和屏幕边缘', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const { ui, frame, row } = await setup(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await row('A').click(); await row('B').click({ modifiers: ['Control'] });
  await row('A').click({ button: 'right' });
  const menu = ui.getByRole('menu');
  await expect(menu).toHaveAccessibleName('已选 2 篇文献');
  await expect(ui.locator('.rw-paper-row[aria-selected=true]')).toHaveCount(2);
  await expect(menu.getByRole('menuitem', { name: '编辑文献信息', exact: true })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: '设置阅读状态', exact: true }).click();
  await menu.getByRole('menuitemcheckbox', { name: '待阅读', exact: true }).click();
  await expect(row('A').locator('.rw-state')).toHaveText('待阅读');
  await expect(row('B').locator('.rw-state')).toHaveText('待阅读');
  await expect(row('C').locator('.rw-state')).toHaveText('待整理');
  await row('A').click({ button: 'right' }); await menu.getByRole('menuitem', { name: '复制标题', exact: true }).click();
  await expect.poll(() => frame.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'))).toBe('Menu A\nMenu B');
  await row('A').click({ button: 'right' });
  const downloaded = page.waitForEvent('download'); await menu.getByRole('menuitem', { name: '导出 BibTeX', exact: true }).click();
  const download = await downloaded; expect(download.suggestedFilename()).toBe('references.bib');
  const stream = await download.createReadStream(); let bib = ''; for await (const chunk of stream) bib += chunk.toString();
  expect(bib).toContain('Menu A'); expect(bib).toContain('Menu B'); expect(bib).not.toContain('Menu C');
  await row('C').click({ button: 'right' });
  await expect(menu).toHaveAccessibleName('Menu C');
  await expect(ui.locator('.rw-paper-row[aria-selected=true]')).toHaveCount(1);
  await expect(row('C')).toHaveAttribute('aria-selected', 'true');
  await menu.getByRole('menuitem', { name: '编辑文献信息', exact: true }).click();
  await expect(ui.getByRole('dialog', { name: '编辑文献信息' })).toBeVisible();
  await ui.getByRole('button', { name: '关闭编辑', exact: true }).click();
  await row('C').focus(); await row('C').press('Shift+F10');
  await menu.getByRole('menuitem', { name: '设置重要程度', exact: true }).focus();
  await page.keyboard.press('ArrowRight'); await expect(menu).toHaveAccessibleName('设置重要程度');
  await row('B').click({ button: 'right' }); await expect(menu).toHaveAccessibleName('Menu B');
  await menu.getByRole('menuitem', { name: '设置重要程度', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft'); await expect(menu).toHaveAccessibleName('Menu B');
  await page.keyboard.press('Escape'); await row('C').click({ button: 'right' });
  await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0);
  await expect(row('C')).toBeFocused();
  await expect(row('C')).toHaveAttribute('aria-selected', 'true');
  await row('C').evaluate(el => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: innerWidth - 2, clientY: innerHeight - 2 })));
  const fits = await menu.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });
  expect(fits).toBe(true);
  await expect(menu).toHaveCSS('left', /px/);
  expect(await menu.evaluate(el => el.getBoundingClientRect().right > innerWidth - 12)).toBe(true);
  await page.screenshot({ path: 'shots/context-menu-library.png' });
  await ui.getByRole('searchbox', { name: '搜索文献', exact: true }).click(); await expect(menu).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('批量添加文献集，侧栏重命名、移除关联和删除分类保留论文 PDF', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const { ui, frame, row } = await setup(page);
  await row('A').click(); await row('B').click({ modifiers: ['Control'] });
  await row('A').click({ button: 'right' });
  await ui.getByRole('menuitem', { name: '添加到文献集', exact: true }).click();
  await ui.getByRole('menuitem', { name: '新建文献集…', exact: true }).click();
  await ui.getByRole('textbox', { name: '新建文献集', exact: true }).fill('精读集合');
  await ui.getByRole('button', { name: '保存', exact: true }).click();
  const nav = name => ui.getByRole('navigation', { name: '快捷文献视图' }).getByRole('button', { name: new RegExp(`^${name}`) });
  await nav('精读集合').click(); await expect(ui.locator('.rw-paper-row')).toHaveCount(2);
  await nav('精读集合').click({ button: 'right' }); await ui.getByRole('menuitem', { name: '重命名…', exact: true }).click();
  await ui.getByRole('textbox', { name: '重命名', exact: true }).fill('方法精读'); await ui.getByRole('button', { name: '保存', exact: true }).click();
  await expect(ui.getByRole('heading', { name: '方法精读', exact: true })).toBeVisible();
  await expect(ui.locator('.rw-paper-row')).toHaveCount(2);
  await row('A').click({ button: 'right' }); await ui.getByRole('menuitem', { name: '从当前文献集移除', exact: true }).click();
  await expect(ui.locator('.rw-paper-row')).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept());
  await nav('方法精读').click({ button: 'right' }); await ui.getByRole('menuitem', { name: '删除文献集…', exact: true }).click();
  await expect(ui.getByRole('heading', { name: '全部文献', exact: true })).toBeVisible();
  await expect(ui.locator('.rw-paper-row')).toHaveCount(3);
  expect(await frame.evaluate(() => window.__researchPort.library.currentModal.papers.every(p => !p.collections.length && window.__researchPort.vault.getAbstractFileByPath(p.pdf)))).toBe(true);
  expect(errors).toEqual([]);
});

test('阅读摘录右键复制与删除，读取原有渲染器菜单的键盘操作', async ({ page }) => {
  const { ui, frame, row } = await setup(page);
  await frame.evaluate(async () => { const x = window.__researchPort; const paper = x.library.currentModal.papers.find(p => p.title === 'Menu A'); await x.reader.addAnnotation(paper.pdf, { id: 'menu-note', type: 'note', page: 0, comment: 'Context menu note', text: 'Source passage', tags: [], quads: [], color: 'yellow', x: 40, y: 60, createdAt: Date.now(), updatedAt: Date.now() }); });
  await row('A').click(); await ui.getByRole('tab', { name: /^摘录/ }).click();
  await expect(ui.locator('.rw-annotation')).toHaveCount(1);
  await ui.locator('.rw-annotation').click({ button: 'right' });
  await expect(ui.getByRole('menuitem', { name: '定位到原文', exact: true })).toBeEnabled();
  await ui.getByRole('menuitem', { name: '定位到原文', exact: true }).click();
  await expect(ui.locator('.mupdf-reader-status')).toContainText('1 页');
  await ui.getByRole('button', { name: '打开研究侧栏', exact: true }).click();
  await ui.locator('.mupdf-research-annotation-row').first().click({ button: 'right' });
  await expect(ui.locator('.menu[role=menu]')).toBeVisible();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape');
  await expect(ui.locator('.menu[role=menu]')).toHaveCount(0);
  await ui.locator('#reader-back').click();
  await ui.getByRole('tab', { name: '阅读记录', exact: true }).click();
  await ui.locator('.rw-excerpt-row').click({ button: 'right' });
  page.once('dialog', dialog => dialog.dismiss());
  await ui.getByRole('menuitem', { name: '删除摘录…', exact: true }).click();
  await expect(ui.locator('.rw-excerpt-row')).toHaveCount(1);
  await ui.locator('.rw-excerpt-row').click({ button: 'right' });
  page.once('dialog', dialog => dialog.accept());
  await ui.getByRole('menuitem', { name: '删除摘录…', exact: true }).click();
  await expect(ui.locator('.rw-excerpt-row')).toHaveCount(0);
});

test('项目和待办右键操作、取消删除与刷新持久化', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '科研课题', exact: true }).click(); await page.getByRole('button', { name: '课题资料', exact: true }).click();
  const row = page.locator('.topic-directory-row').first(); const title = await row.locator('div > span:first-child').innerText();
  await row.click({ button: 'right' }); await page.getByRole('menuitem', { name: '设置状态', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: '已搁置', exact: true }).click();
  await expect(row.locator('.topic-status')).toHaveText('已搁置');
  await row.click({ button: 'right' });
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('menuitem', { name: '删除课题…', exact: true }).click();
  await expect(row).toContainText(title);
  await page.reload(); await page.getByRole('button', { name: '科研课题', exact: true }).click(); await page.getByRole('button', { name: '课题资料', exact: true }).click();
  await expect(page.locator('.topic-directory-row').filter({ hasText: title }).locator('.topic-status')).toHaveText('已搁置');
  await page.getByRole('button', { name: '待办事项', exact: true }).click();
  await page.getByPlaceholder(/添加.*回车创建/).fill('右键菜单验证'); await page.getByPlaceholder(/添加.*回车创建/).press('Enter');
  const todo = page.locator('.todo-item').filter({ hasText: '右键菜单验证' });
  await todo.click({ button: 'right' }); await page.getByRole('menuitem', { name: '标记为完成', exact: true }).click();
  await page.getByRole('button', { name: /已完成/ }).first().click();
  await expect(todo).toHaveClass(/done/);
  await todo.locator('.record-title').focus(); await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu')).toHaveAccessibleName('右键菜单验证');
  await page.screenshot({ path: 'shots/context-menu-todo.png' });
});

for (const width of [768, 390]) {
  test(`菜单在 ${width}px 视口内完整显示，取消后保持选中`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const { ui, row } = await setup(page);
    await row('A').click({ button: 'right' });
    const menu = ui.getByRole('menu');
    await expect(menu).toBeVisible();
    expect(await menu.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })).toBe(true);
    await menu.getByRole('menuitem', { name: '设置阅读状态', exact: true }).click();
    await expect(menu).toHaveAccessibleName('设置阅读状态');
    await page.screenshot({ path: `shots/context-menu-${width}.png` });
    await page.keyboard.press('Escape');
    await expect(row('A')).toHaveAttribute('aria-selected', 'true');
  });
}
