import { test, expect } from '@playwright/test';
import { pdfFixture } from './pdfFixture';
const nav = (ui, name) => ui.getByRole('navigation', { name: '快捷文献视图' }).getByRole('button', { name: new RegExp(`^${name}`) });
const node = (ui, name) => ui.locator(`[data-collection-node="${name}"]`);
async function setup(page) {
  await page.goto('/'); await page.getByRole('button', { name: '文献库', exact: true }).click();
  const ui = page.frameLocator('.port-library-shell iframe'); await expect(ui.locator('#port-status')).toContainText('已就绪');
  return { ui, frame: page.frames().find(frame => frame.url().includes('port.html')) };
}
async function create(ui, name, parent) {
  if (parent) { await nav(ui, parent).click({ button: 'right' }); await ui.getByRole('menuitem', { name: '新建子文献集…', exact: true }).click(); }
  else await ui.locator('.rw-new-collection').click();
  await ui.getByLabel('文献集名称', { exact: true }).fill(name); await ui.getByRole('button', { name: '创建文献集', exact: true }).click();
  await expect(ui.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
}
async function drag(page, ui, fromName, toName, ratio = 0.5, inspect) {
  const from = await node(ui, fromName).locator('.rw-nav-item').boundingBox();
  const target = toName ? node(ui, toName) : ui.locator('[data-collection-root]');
  await target.scrollIntoViewIfNeeded(); const to = await target.boundingBox();
  await page.mouse.move(from.x + 35, from.y + from.height / 2); await page.mouse.down();
  await page.mouse.move(from.x + 48, from.y + from.height / 2, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height * ratio, { steps: 10 });
  await page.mouse.move(to.x + to.width / 2 + 1, to.y + to.height * ratio);
  if (inspect) await inspect(target);
  await page.mouse.up();
}
const rows = frame => frame.evaluate(() => window.__researchPort.collectionTree.view().nodes);

test('新建子集和多层折叠；导入准确归属，重命名及删除父级保留子集和论文', async ({ page }) => {
  const { ui, frame } = await setup(page);
  await create(ui, '病理'); await create(ui, '食管癌', '病理'); await create(ui, '精读', '食管癌');
  await expect(node(ui, '精读')).toHaveAttribute('aria-level', '3');
  await ui.locator('#port-pdf-input').setInputFiles({ name: 'Nested paper.pdf', mimeType: 'application/pdf', buffer: pdfFixture('Nested collection paper content') });
  await expect(ui.locator('.rw-paper-row')).toHaveCount(1);
  expect(await frame.evaluate(() => window.__researchPort.library.currentModal.papers[0].collections)).toEqual(['精读']);
  await page.screenshot({ path: 'shots/collection-tree-desktop.png' });
  await ui.getByRole('button', { name: '收起文献集：病理', exact: true }).click(); await expect(node(ui, '精读')).toHaveCount(0);
  await page.reload(); await page.getByRole('button', { name: '文献库', exact: true }).click(); await expect(ui.locator('#port-status')).toContainText('已就绪');
  await expect(node(ui, '食管癌')).toHaveCount(0);
  await nav(ui, '病理').focus(); await nav(ui, '病理').press('ArrowRight'); await expect(node(ui, '精读')).toBeVisible();
  await nav(ui, '病理').click({ button: 'right' }); await ui.getByRole('menuitem', { name: '重命名…', exact: true }).click();
  await ui.getByRole('textbox', { name: '重命名', exact: true }).fill('计算病理'); await ui.getByRole('button', { name: '保存', exact: true }).click();
  await expect(node(ui, '计算病理')).toBeVisible();
  expect((await rows(page.frames().find(frame => frame.url().includes('port.html')))).find(n => n.name === '食管癌').parent).toBe('计算病理');
  page.once('dialog', dialog => dialog.accept()); await nav(ui, '计算病理').click({ button: 'right' }); await ui.getByRole('menuitem', { name: '删除文献集…', exact: true }).click();
  await expect(node(ui, '食管癌')).toHaveAttribute('aria-level', '1'); await expect(node(ui, '精读')).toHaveAttribute('aria-level', '2');
  await nav(ui, '精读').click(); await expect(ui.locator('.rw-paper-row')).toHaveCount(1);
});

test('真实拖动改变层级与同级顺序，移动整棵子树，拒绝循环和取消操作并持久化', async ({ page }) => {
  const { ui, frame } = await setup(page);
  for (const name of ['Alpha', 'Beta', 'Gamma']) await create(ui, name);
  await drag(page, ui, 'Beta', 'Alpha', 0.5, async target => { await expect(target).toHaveClass(/is-tree-drop-inside/); await page.screenshot({ path: 'shots/collection-tree-drop.png' }); });
  await expect(node(ui, 'Beta')).toHaveAttribute('aria-level', '2');
  await drag(page, ui, 'Gamma', 'Alpha', 0.1, async target => { await expect(target).toHaveClass(/is-tree-drop-before/); });
  await expect.poll(() => ui.locator('.rw-collection-node').evaluateAll(nodes => nodes.map(n => n.dataset.collectionNode))).toEqual(['Gamma', 'Alpha', 'Beta']);
  await drag(page, ui, 'Gamma', 'Alpha', 0.9); await expect.poll(() => ui.locator('.rw-collection-node').evaluateAll(nodes => nodes.map(n => n.dataset.collectionNode))).toEqual(['Alpha', 'Beta', 'Gamma']);
  await drag(page, ui, 'Alpha', 'Gamma'); await expect(node(ui, 'Beta')).toHaveAttribute('aria-level', '3');
  const before = await rows(frame);
  await drag(page, ui, 'Gamma', 'Beta'); expect(await rows(frame)).toEqual(before);
  await drag(page, ui, 'Alpha', null); await expect(node(ui, 'Alpha')).toHaveAttribute('aria-level', '1'); await expect(node(ui, 'Beta')).toHaveAttribute('aria-level', '2');
  await drag(page, ui, 'Alpha', 'Gamma', 0.5, async target => { await expect(target).toHaveClass(/is-tree-drop-inside/); await page.keyboard.press('Escape'); });
  await expect(node(ui, 'Alpha')).toHaveAttribute('aria-level', '1');
  await expect(ui.locator('[class*=is-tree-drop-]')).toHaveCount(0);
  await page.reload(); await page.getByRole('button', { name: '文献库', exact: true }).click(); await expect(ui.locator('#port-status')).toContainText('已就绪');
  await expect.poll(() => ui.locator('.rw-collection-node').evaluateAll(nodes => nodes.map(n => n.dataset.collectionNode))).toEqual(['Gamma', 'Alpha', 'Beta']);
  await expect(node(ui, 'Beta')).toHaveAttribute('aria-level', '2');
});

test('Ctrl 多选论文仍可拖进子文献集，论文归属和文献集层级分别保存', async ({ page }) => {
  const { ui, frame } = await setup(page);
  await create(ui, '原分类');
  await ui.locator('#port-pdf-input').setInputFiles(['A', 'B', 'C'].map(name => ({ name: `Nested ${name}.pdf`, mimeType: 'application/pdf', buffer: pdfFixture('Nested paper ' + name) })));
  await expect(ui.locator('.rw-paper-row')).toHaveCount(3);
  await create(ui, '食管癌'); await create(ui, '精读', '食管癌'); await nav(ui, '全部文献').click();
  const paper = name => ui.locator('.rw-paper-row').filter({ hasText: `Nested ${name}` });
  await paper('A').locator('.rw-paper-title').click(); await paper('B').locator('.rw-paper-title').click({ modifiers: ['Control'] });
  await paper('A').locator('.rw-paper-title').dragTo(nav(ui, '精读'));
  await expect(nav(ui, '精读')).toContainText('2');
  expect(await frame.evaluate(() => Object.fromEntries(window.__researchPort.library.currentModal.papers.map(p => [p.title, p.collections])))).toEqual({ 'Nested A': ['原分类', '精读'], 'Nested B': ['原分类', '精读'], 'Nested C': ['原分类'] });
  await nav(ui, '精读').click(); await expect(ui.locator('.rw-paper-row')).toHaveCount(2);
  await expect(node(ui, '精读')).toHaveAttribute('aria-level', '2');
  await drag(page, ui, '食管癌', '原分类');
  await expect(node(ui, '精读')).toHaveAttribute('aria-level', '3');
  await expect(ui.locator('.rw-paper-row')).toHaveCount(2);
  expect(await frame.evaluate(() => window.__researchPort.library.currentModal.papers.filter(p => p.collections.includes('精读')).length)).toBe(2);
});

for (const width of [768, 390]) {
  test(`层级在 ${width}px 分类抽屉内显示，右键顺序操作仍可用`, async ({ page }) => {
    const { ui } = await setup(page);
    await create(ui, '计算病理'); await create(ui, '早期食管癌', '计算病理'); await create(ui, '方法精读', '早期食管癌'); await create(ui, '实验复现', '早期食管癌');
    await nav(ui, '实验复现').click({ button: 'right' }); await ui.getByRole('menuitem', { name: '上移', exact: true }).click();
    await expect.poll(() => ui.locator('.rw-collection-node').evaluateAll(nodes => nodes.map(n => n.dataset.collectionNode))).toEqual(['计算病理', '早期食管癌', '实验复现', '方法精读']);
    await page.setViewportSize({ width, height: 844 });
    await ui.getByRole('button', { name: '打开文献分类', exact: true }).click();
    await expect(node(ui, '方法精读')).toBeVisible();
    expect(await ui.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: `shots/collection-tree-${width}.png` });
    await nav(ui, '方法精读').click();
    await expect(ui.getByRole('heading', { level: 2, name: '方法精读', exact: true })).toBeVisible();
    await expect(ui.getByRole('button', { name: '收起文献分类', exact: true })).toHaveCount(0);
  });
}
