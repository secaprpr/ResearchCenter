import { test, expect } from '@playwright/test';
import { pdfFixture } from './pdfFixture';

const nav = (ui, name) => ui.getByRole('navigation', { name: '快捷文献视图' }).getByRole('button', { name: new RegExp(`^${name}`) });
const row = (ui, name) => ui.locator('.rw-paper-row').filter({ has: ui.locator('.rw-paper-title', { hasText: `Drag ${name}` }) });
async function collection(ui, name) {
  await ui.locator('.rw-new-collection').click();
  await ui.getByLabel('文献集名称', { exact: true }).fill(name);
  await ui.getByRole('button', { name: '创建文献集', exact: true }).click();
  await expect(ui.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
}
async function setup(page) {
  await page.goto('/'); await page.getByRole('button', { name: '文献库', exact: true }).click();
  const ui = page.frameLocator('.port-library-shell iframe');
  await expect(ui.locator('#port-status')).toContainText('已就绪');
  await collection(ui, '原分类');
  await ui.locator('#port-pdf-input').setInputFiles(['A', 'B', 'C'].map(name => ({ name: `Drag ${name}.pdf`, mimeType: 'application/pdf', buffer: pdfFixture(`Distinct paper for dragging ${name}`) })));
  await expect(ui.locator('.rw-paper-row')).toHaveCount(3);
  await collection(ui, '早期食管癌'); await nav(ui, '全部文献').click();
  await expect(ui.locator('.rw-paper-row')).toHaveCount(3);
  return { ui, frame: page.frames().find(frame => frame.url().includes('port.html')) };
}
async function startDrag(page, source, target) {
  const from = await source.boundingBox(), to = await target.boundingBox();
  await page.mouse.move(from.x + 35, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 48, from.y + from.height / 2, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.move(to.x + to.width / 2 + 1, to.y + to.height / 2, { steps: 2 });
}
async function memberships(frame) {
  return frame.evaluate(() => Object.fromEntries(window.__researchPort.library.currentModal.papers.map(p => [p.title, p.collections])));
}

test('真实鼠标拖动 Ctrl 多选文献，保留原分类与笔记状态，重复添加不重复且刷新持久化', async ({ page }) => {
  const { ui, frame } = await setup(page);
  await frame.evaluate(async () => {
    const { app, library, vault } = window.__researchPort;
    const paper = library.currentModal.papers.find(p => p.title === 'Drag A');
    await app.fileManager.processFrontMatter(paper.file, fm => { fm.status = 'read'; fm.rating = 4; fm.note = 'Keep this note'; });
    await vault.modify(paper.file, (await vault.read(paper.file)) + '\n## Research notes\nKeep this body.\n');
  });
  await expect(row(ui, 'A').locator('.rw-state')).toHaveText('已完成');
  await row(ui, 'A').locator('.rw-paper-title').click();
  await row(ui, 'B').locator('.rw-paper-title').click({ modifiers: ['Control'] });
  await expect(ui.locator('.rw-paper-row[aria-selected=true]')).toHaveCount(2);
  const before = await frame.evaluate(() => ({ imports: JSON.stringify(window.__researchPort.imports.state), papers: window.__researchPort.library.currentModal.papers.map(p => ({ path: p.file.path, title: p.title, status: p.status, rating: p.rating, note: p.note, pdf: p.pdf, body: window.__researchPort.vault.texts.get(p.file.path).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '') })) }));
  const target = nav(ui, '早期食管癌');
  await startDrag(page, row(ui, 'A').locator('.rw-paper-title'), target);
  await expect(target).toHaveClass(/is-drop-target/);
  await expect(ui.locator('.rw-drop-overlay')).toHaveText('添加 2 篇至 早期食管癌');
  await expect(ui.locator('.rw-paper-row[aria-selected=true]')).toHaveCount(2);
  await page.screenshot({ path: 'shots/paper-drag-multiple.png' });
  await page.mouse.up();
  await expect.poll(() => memberships(frame)).toEqual({ 'Drag A': ['原分类', '早期食管癌'], 'Drag B': ['原分类', '早期食管癌'], 'Drag C': ['原分类'] });
  await expect(ui.locator('.rw-drop-overlay')).toHaveCount(0);
  await expect(ui.locator('.rw-paper-row')).toHaveCount(3);
  await expect(ui.locator('.rw-paper-row[aria-selected=true]')).toHaveCount(2);
  expect(await frame.evaluate(() => ({ imports: JSON.stringify(window.__researchPort.imports.state), papers: window.__researchPort.library.currentModal.papers.map(p => ({ path: p.file.path, title: p.title, status: p.status, rating: p.rating, note: p.note, pdf: p.pdf, body: window.__researchPort.vault.texts.get(p.file.path).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '') })) }))).toEqual(before);
  await row(ui, 'B').locator('.rw-paper-title').dragTo(target);
  await expect(target).not.toHaveClass(/is-drop-target/);
  expect(await memberships(frame)).toEqual({ 'Drag A': ['原分类', '早期食管癌'], 'Drag B': ['原分类', '早期食管癌'], 'Drag C': ['原分类'] });
  await nav(ui, '早期食管癌').click(); await expect(ui.locator('.rw-paper-row')).toHaveCount(2);
  await page.reload(); await page.getByRole('button', { name: '文献库', exact: true }).click();
  await expect(ui.locator('#port-status')).toContainText('已就绪');
  await nav(ui, '早期食管癌').click(); await expect(ui.locator('.rw-paper-row')).toHaveCount(2);
  await expect(row(ui, 'A').locator('.rw-state')).toHaveText('已完成');
});

test('拖动未选中的行只添加该篇，智能视图与空白不接收内部分类拖动', async ({ page }) => {
  const { ui, frame } = await setup(page);
  await row(ui, 'A').locator('.rw-paper-title').click(); await row(ui, 'B').locator('.rw-paper-title').click({ modifiers: ['Control'] });
  await row(ui, 'C').locator('.rw-paper-title').dragTo(nav(ui, '早期食管癌'));
  await expect.poll(() => memberships(frame)).toEqual({ 'Drag A': ['原分类'], 'Drag B': ['原分类'], 'Drag C': ['原分类', '早期食管癌'] });
  await expect(ui.locator('.rw-paper-row[aria-selected=true]')).toHaveCount(1);
  await expect(row(ui, 'C')).toHaveAttribute('aria-selected', 'true');
  const before = await memberships(frame);
  await row(ui, 'A').locator('.rw-paper-title').dragTo(nav(ui, '重点文献'));
  await expect(ui.locator('.rw-drop-overlay')).toHaveCount(0);
  await row(ui, 'B').locator('.rw-paper-title').dragTo(ui.locator('.rw-title-row'));
  expect(await memberships(frame)).toEqual(before);
  await expect(ui.locator('.rw-nav-item.is-drop-target')).toHaveCount(0);
});

test('Esc 取消与行内控件不产生分类修改，外部伪造数据不能移动文献', async ({ page }) => {
  const { ui, frame } = await setup(page);
  await row(ui, 'A').locator('.rw-paper-title').click(); await row(ui, 'B').locator('.rw-paper-title').click({ modifiers: ['Control'] });
  const target = nav(ui, '早期食管癌'), before = await memberships(frame);
  await startDrag(page, row(ui, 'A').locator('.rw-paper-title'), target);
  await expect(target).toHaveClass(/is-drop-target/);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(ui.locator('.rw-drop-overlay')).toHaveCount(0);
  await expect(target).not.toHaveClass(/is-drop-target/);
  await expect(ui.locator('.rw-paper-row[aria-selected=true]')).toHaveCount(2);
  expect(await memberships(frame)).toEqual(before);
  await row(ui, 'A').getByRole('button', { name: '设为重点：Drag A', exact: true }).dragTo(target);
  await expect(target).not.toHaveClass(/is-drop-target/);
  expect(await memberships(frame)).toEqual(before);
  const transfer = await frame.evaluateHandle(() => { const transfer = new DataTransfer(); transfer.setData('application/x-research-workbench-papers', JSON.stringify({ paths: ['Research/10 Papers/fake.md'] })); return transfer; });
  await target.dispatchEvent('dragover', { dataTransfer: transfer }); await target.dispatchEvent('drop', { dataTransfer: transfer });
  await transfer.dispose(); expect(await memberships(frame)).toEqual(before);
});

test('同样支持研究主题及项目，写入原有链接格式且不切换当前视图', async ({ page }) => {
  const { ui, frame } = await setup(page);
  await frame.evaluate(async () => {
    const model = window.__researchPort.library.currentModal;
    await model.createOrganizationEntity('topic', '病理');
    await model.createOrganizationEntity('project', 'AI 课题');
  });
  const topic = nav(ui, '病理'); await expect(topic).toBeVisible();
  await row(ui, 'A').locator('.rw-paper-title').dragTo(topic);
  await expect(topic).toContainText('1');
  await ui.getByRole('group', { name: '科研课题分类', exact: true }).getByRole('button', { name: /^科研课题/ }).click();
  const project = nav(ui, 'AI 课题');
  await row(ui, 'A').locator('.rw-paper-title').dragTo(project);
  await expect(project).toContainText('1');
  await expect(ui.getByRole('heading', { level: 2, name: '全部文献', exact: true })).toBeVisible();
  expect(await frame.evaluate(() => {
    const { library, app } = window.__researchPort;
    const paper = library.currentModal.papers.find(p => p.title === 'Drag A');
    const fm = app.metadataCache.getFileCache(paper.file).frontmatter;
    return { topics: paper.topics, projects: paper.projects, collections: paper.collections, storedTopics: fm.topics, storedProjects: fm.projects };
  })).toEqual({ topics: ['病理'], projects: ['AI 课题'], collections: ['原分类'], storedTopics: ['[[Research/30 Topics/病理]]'], storedProjects: ['AI 课题'] });
});
