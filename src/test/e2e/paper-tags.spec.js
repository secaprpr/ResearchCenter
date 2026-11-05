import { test, expect } from '@playwright/test';
import { pdfFixture } from './pdfFixture';

async function setup(page) {
  await page.goto('/'); await page.getByRole('button', { name: '文献库', exact: true }).click();
  const ui = page.frameLocator('.port-library-shell iframe');
  await expect(ui.locator('#port-status')).toContainText('已就绪');
  await ui.locator('#port-pdf-input').setInputFiles(['Alpha', 'Beta', 'Gamma'].map(name => ({ name: `Tag ${name}.pdf`, mimeType: 'application/pdf', buffer: pdfFixture(`Distinct tag workflow ${name}`) })));
  await expect(ui.locator('.rw-paper-row')).toHaveCount(3);
  const frame = page.frames().find(f => f.url().includes('port.html'));
  await frame.evaluate(async () => {
    const { library, app } = window.__researchPort;
    for (const paper of [...library.currentModal.papers]) await app.fileManager.processFrontMatter(paper.file, fm => {
      fm.keywords = paper.title.endsWith('Alpha') ? ['Alpha-only', 'Shared'] : paper.title.endsWith('Beta') ? ['Beta-only', 'Shared'] : ['Suggested'];
      fm.topics = ['[[Research/30 Topics/经典]]']; fm.ccf_rank = 'A'; fm.note = 'Keep existing notes'; fm.metadata_manual_fields = ['title'];
    });
  });
  await ui.getByLabel('文献排序', { exact: true }).selectOption('title');
  const row = name => ui.locator('.rw-paper-row').filter({ has: ui.locator('.rw-paper-title', { hasText: `Tag ${name}` }) });
  await expect(row('Alpha')).toContainText('Alpha-only');
  const stored = () => frame.evaluate(() => {
    const { library, vault } = window.__researchPort;
    return Object.fromEntries(library.currentModal.papers.map(paper => [paper.title, { tags: paper.keywords, topics: paper.topics, note: paper.note, pdf: paper.pdf, raw: vault.texts.get(paper.file.path) }]));
  });
  return { ui, frame, row, stored };
}
async function editor(ui, row) {
  await row.click({ button: 'right' });
  await ui.getByRole('menuitem', { name: '编辑标签', exact: true }).click();
  return ui.getByRole('dialog');
}

test('单篇标签可添加去重、移除、搜索与重启保存，取消不改数据且窄屏可用', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const { ui, row, stored } = await setup(page);
  let dialog = await editor(ui, row('Alpha'));
  const input = dialog.getByLabel('标签名称', { exact: true }); await expect(input).toBeFocused();
  await input.fill('新标签，AI/ML'); await input.press('Enter');
  await input.fill('新标签;Shared'); await input.press('Enter');
  await input.fill('未回车'); await dialog.getByRole('button', { name: '保存标签', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await stored())['Tag Alpha'].tags).toEqual(['Alpha-only', 'Shared', '新标签', 'AI/ML', '未回车']);
  const search = ui.getByRole('searchbox', { name: '搜索文献', exact: true });
  await search.fill('AI/ML'); await expect(ui.locator('.rw-paper-row')).toHaveCount(1); await search.fill('');
  await row('Alpha').click();
  await ui.locator('.rw-paper-tags').getByRole('button', { name: '移除标签：新标签', exact: true }).click();
  await expect.poll(async () => (await stored())['Tag Alpha'].tags).toEqual(['Alpha-only', 'Shared', 'AI/ML', '未回车']);
  await ui.locator('.rw-paper-tags .rw-section-heading button').click();
  dialog = ui.getByRole('dialog'); await dialog.getByLabel('标签名称').fill('草稿'); await dialog.getByLabel('标签名称').press('Enter');
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(ui.locator('.rw-paper-row[aria-selected=true]')).toHaveCount(1);
  expect((await stored())['Tag Alpha'].tags).not.toContain('草稿');
  await page.reload(); await page.getByRole('button', { name: '文献库', exact: true }).click();
  await row('Alpha').click();
  await expect(ui.locator('.rw-paper-tags')).toContainText('AI/ML');
  await row('Alpha').locator('td.rw-tags-cell').dblclick();
  await expect(ui.locator('#reader-workspace')).toBeHidden();
  await page.screenshot({ path: 'shots/paper-tags-1440.png' });
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(ui.getByRole('button', { name: '保存标签', exact: true })).toBeInViewport();
    expect(await ui.getByRole('dialog').evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })).toBe(true);
    await page.screenshot({ path: `shots/paper-tags-${width}.png` });
  }
  await ui.getByRole('button', { name: '关闭弹窗', exact: true }).click(); expect(errors).toEqual([]);
});

test('Ctrl 多选批量增删保留各篇独有标签和编辑期间的新数据，失败可安全重试', async ({ page }) => {
  const { ui, frame, row, stored } = await setup(page);
  const before = await stored();
  await row('Alpha').click(); await row('Beta').click({ modifiers: ['Control'] });
  const dialog = await editor(ui, row('Alpha'));
  await expect(dialog).toHaveAccessibleName('标签 · 2 篇文献');
  await dialog.getByRole('button', { name: '移除标签：Shared', exact: true }).click();
  await dialog.getByRole('button', { name: '应用标签：Alpha-only', exact: true }).click();
  await dialog.getByLabel('标签名称').fill('Batch'); await dialog.getByLabel('标签名称').press('Enter');
  await dialog.getByRole('button', { name: 'Suggested', exact: true }).click();
  await frame.evaluate(async () => {
    const { app, library, vault } = window.__researchPort;
    const alpha = library.currentModal.papers.find(paper => paper.title === 'Tag Alpha');
    await app.fileManager.processFrontMatter(alpha.file, fm => { fm.keywords.push('Concurrent'); fm.abstract = 'Preserve new abstract'; });
    const original = vault.modify.bind(vault); let failed = false;
    vault.modify = async (file, value) => {
      if (!failed && value.includes('title: Tag Beta') && value.includes('- Batch')) { failed = true; throw new Error('暂时不可写'); }
      return original(file, value);
    };
  });
  await dialog.getByRole('button', { name: '保存标签', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('暂时不可写');
  await dialog.getByRole('button', { name: '保存标签', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await stored())['Tag Beta'].tags).toEqual(['Beta-only', 'Alpha-only', 'Batch', 'Suggested']);
  const after = await stored();
  expect(after['Tag Alpha'].tags).toEqual(['Alpha-only', 'Concurrent', 'Batch', 'Suggested']);
  for (const field of ['tags', 'topics', 'note', 'pdf']) expect(after['Tag Gamma'][field]).toEqual(before['Tag Gamma'][field]);
  for (const name of ['Tag Alpha', 'Tag Beta']) {
    expect(after[name].note).toBe(before[name].note); expect(after[name].pdf).toBe(before[name].pdf); expect(after[name].topics).toEqual(before[name].topics);
    expect(after[name].raw).toContain('ccf_rank: A');
  }
  expect(after['Tag Alpha'].raw).toContain('Preserve new abstract');
});
