import { test, expect } from '@playwright/test';
import { pdfFixture } from './pdfFixture';

async function setup(page) {
  await page.goto('/'); await page.getByRole('button', { name: '文献库', exact: true }).click();
  const ui = page.frameLocator('.port-library-shell iframe'); await expect(ui.locator('#port-status')).toContainText('已就绪');
  return { ui, frame: page.frames().find(frame => frame.url().includes('port.html')) };
}
const file = name => ({ name: name + '.pdf', mimeType: 'application/pdf', buffer: pdfFixture('Unique import content for ' + name) });
async function collection(ui, name) {
  await ui.locator('.rw-new-collection').click();
  await ui.getByLabel('文献集名称', { exact: true }).fill(name);
  await ui.getByRole('button', { name: '创建文献集', exact: true }).click();
  await expect(ui.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
}
function nav(ui, name) { return ui.getByRole('navigation', { name: '快捷文献视图' }).getByRole('button', { name: new RegExp(`^${name}`) }); }
async function drag(frame, locator, files, beforeDrop) {
  const dataTransfer = await frame.evaluateHandle(files => {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(new File([Uint8Array.from(atob(file.base64), c => c.charCodeAt(0))], file.name, { type: 'application/pdf' }));
    return transfer;
  }, files.map(file => ({ name: file.name, base64: file.buffer.toString('base64') })));
  await locator.dispatchEvent('dragenter', { dataTransfer });
  await locator.dispatchEvent('dragover', { dataTransfer });
  if (beforeDrop) await beforeDrop();
  await locator.dispatchEvent('drop', { dataTransfer });
  await dataTransfer.dispose();
}

test('拖入当前文献集，清理阻挡筛选并置顶；标新、批次找回与刷新持久化', async ({ page }) => {
  const { ui, frame } = await setup(page);
  await collection(ui, '早期食管癌');
  await ui.locator('#port-pdf-input').setInputFiles(file('Z old item'));
  await expect(ui.locator('.rw-paper-row')).toHaveCount(1);
  await ui.getByLabel('文献排序', { exact: true }).selectOption('title');
  await ui.getByRole('searchbox', { name: '搜索文献' }).fill('hidden-by-search');
  await ui.getByRole('button', { name: '筛选', exact: true }).click();
  await ui.getByLabel('筛选阅读状态').selectOption('read');
  await expect(ui.locator('.rw-paper-row')).toHaveCount(0);
  await drag(frame, ui.locator('.rw-table-scroll'), [file('A new study'), file('B new study')]);
  await expect(ui.getByRole('heading', { level: 2, name: '早期食管癌', exact: true })).toBeVisible();
  await expect(ui.locator('.rw-paper-row')).toHaveCount(3);
  await expect(ui.getByRole('searchbox', { name: '搜索文献' })).toHaveValue('');
  await expect(ui.getByLabel('筛选阅读状态')).toHaveValue('all');
  await expect(ui.locator('.rw-paper-row').first()).toContainText('A new study');
  await expect(ui.locator('.rw-paper-row').filter({ hasText: 'A new study' }).locator('.rw-new-import')).toHaveCount(1);
  expect(await frame.evaluate(() => window.__researchPort.library.currentModal.papers.every(paper => paper.collections.includes('早期食管癌')))).toBe(true);
  await ui.getByRole('button', { name: '查看本次导入的 2 篇文献', exact: true }).click();
  await expect(ui.locator('.rw-paper-row')).toHaveCount(2);
  await page.screenshot({ path: 'shots/import-batch-desktop.png' });
  await page.reload(); await page.getByRole('button', { name: '文献库', exact: true }).click();
  await expect(ui.getByRole('button', { name: '查看本次导入的 2 篇文献', exact: true })).toBeVisible();
  await ui.getByRole('button', { name: '查看本次导入的 2 篇文献', exact: true }).click();
  await expect(ui.locator('.rw-paper-row .rw-new-import')).toHaveCount(2);
  await ui.locator('.rw-paper-row').filter({ hasText: 'A new study' }).locator('.rw-paper-title').click();
  await expect(ui.locator('.rw-paper-row .rw-new-import')).toHaveCount(1);
  await ui.getByRole('button', { name: '关闭本次导入入口', exact: true }).click();
  await expect(ui.getByRole('heading', { level: 2, name: '全部文献', exact: true })).toBeVisible();
  await expect(ui.locator('.rw-paper-row')).toHaveCount(3);
});

test('从全集直接拖到侧栏目标；重复 PDF 添加关联、保持已有分类且不误标新', async ({ page }) => {
  const { ui, frame } = await setup(page);
  await collection(ui, '原分类');
  await ui.locator('#port-pdf-input').setInputFiles(file('Existing paper'));
  await expect(ui.locator('.rw-paper-row')).toHaveCount(1);
  await ui.locator('.rw-paper-title').click();
  await collection(ui, '早期食管癌');
  await nav(ui, '全部文献').click();
  const target = nav(ui, '早期食管癌');
  await drag(frame, target, [file('Existing paper')], async () => {
    await expect(target).toHaveClass(/is-drop-target/);
    await expect(ui.locator('.rw-drop-overlay')).toContainText('早期食管癌');
  });
  await expect(ui.getByRole('heading', { level: 2, name: '早期食管癌', exact: true })).toBeVisible();
  await expect(ui.locator('.rw-paper-row')).toHaveCount(1);
  await expect(ui.locator('.rw-new-import')).toHaveCount(0);
  expect(await frame.evaluate(() => window.__researchPort.library.currentModal.papers[0].collections)).toEqual(['原分类', '早期食管癌']);
  await nav(ui, '全部文献').click(); await expect(ui.locator('.rw-paper-row')).toHaveCount(1);
});

test('文件选择器继承打开时的分类；失败文件不产生空批次或虚假新标记', async ({ page }) => {
  const { ui } = await setup(page);
  await collection(ui, '早期食管癌');
  const chooser = page.waitForEvent('filechooser'); await ui.locator('.rw-library-header').getByRole('button', { name: '导入 PDF', exact: true }).click();
  const picker = await chooser;
  await picker.setFiles([file('Picked paper'), { name: 'invalid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('Not a PDF') }]);
  await expect(ui.locator('.rw-paper-row')).toHaveCount(1);
  await expect(ui.getByRole('heading', { level: 2, name: '早期食管癌', exact: true })).toBeVisible();
  await expect(ui.locator('.rw-new-import')).toHaveCount(1);
  await expect(ui.getByRole('button', { name: '查看本次导入的 1 篇文献', exact: true })).toBeVisible();
  await ui.locator('#port-pdf-input').setInputFiles({ name: 'invalid2.pdf', mimeType: 'application/pdf', buffer: Buffer.from('Invalid') });
  await expect(ui.locator('#port-status')).toContainText('失败 1');
  await expect(ui.getByRole('button', { name: '查看本次导入的 1 篇文献', exact: true })).toBeVisible();
});

for (const width of [768, 390]) {
  test(`本次导入入口和标记在 ${width}px 不溢出，切换原有 tab 可用`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const { ui } = await setup(page);
    await ui.locator('#port-pdf-input').setInputFiles([file('Mobile first'), file('Mobile second')]);
    await expect(ui.locator('.rw-paper-row')).toHaveCount(2);
    await expect(ui.getByRole('button', { name: '查看本次导入的 2 篇文献', exact: true })).toBeVisible();
    await expect(ui.locator('.rw-new-import')).toHaveCount(2);
    expect(await ui.locator('html').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await ui.getByRole('tab', { name: '图表摘录', exact: true }).click();
    await ui.getByRole('button', { name: '查看本次导入的 2 篇文献', exact: true }).click();
    await expect(ui.getByRole('tab', { name: '文献', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.screenshot({ path: `shots/import-batch-${width}.png` });
  });
}
