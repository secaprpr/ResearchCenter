import { test, expect } from '@playwright/test';
import { pdfFixture } from './pdfFixture';

test('来源缩写在列表和详情统一显示、支持原名搜索且保留原始元数据', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '文献库', exact: true }).click();
  const ui = page.frameLocator('.port-library-shell iframe');
  await expect(ui.locator('#port-status')).toContainText('已就绪');
  await ui.locator('#port-pdf-input').setInputFiles([
    { name: 'Conference Format.pdf', mimeType: 'application/pdf', buffer: pdfFixture('A conference formatting example') },
    { name: 'Preprint Format.pdf', mimeType: 'application/pdf', buffer: pdfFixture('A preprint formatting example') },
  ]);
  await expect(ui.locator('.rw-paper-row')).toHaveCount(2);
  const sources = [
    ['Conference Format', 'Advances in Neural Information Processing Systems 35', 'NeurIPS'],
    ['Preprint Format', 'arXiv (Cornell University)', 'arXiv'],
  ];
  for (const [title, raw, label] of sources) {
    await ui.locator('.rw-paper-row').filter({ hasText: title }).click();
    await ui.getByRole('button', { name: '编辑', exact: true }).click();
    await ui.getByLabel('会议 / 期刊', { exact: true }).fill(raw);
    await ui.getByRole('button', { name: '保存修改', exact: true }).click();
    const cell = ui.locator('.rw-paper-row').filter({ hasText: title }).locator('.rw-venue-cell');
    await expect(cell).toHaveText(label); await expect(cell).toHaveAttribute('title', raw);
    await expect(ui.locator('.rw-detail-venue')).toContainText(label);
  }
  const search = ui.getByRole('searchbox', { name: '搜索文献' });
  for (const term of ['NeurIPS', sources[0][1]]) {
    await search.fill(term);
    await expect(ui.locator('.rw-paper-row')).toHaveCount(1);
    await expect(ui.locator('.rw-paper-row')).toContainText('Conference Format');
  }
  await search.fill('arxiv');
  await expect(ui.locator('.rw-paper-row')).toHaveCount(1);
  await expect(ui.locator('.rw-paper-row .rw-venue-cell')).toHaveText('arXiv');
  await page.reload(); await page.getByRole('button', { name: '文献库', exact: true }).click();
  for (const [title, raw, label] of sources) {
    await expect(ui.locator('.rw-paper-row').filter({ hasText: title }).locator('.rw-venue-cell')).toHaveText(label);
    await ui.locator('.rw-paper-row').filter({ hasText: title }).click();
    await ui.getByRole('button', { name: '编辑', exact: true }).click();
    await expect(ui.getByLabel('会议 / 期刊', { exact: true })).toHaveValue(raw);
    await ui.getByRole('button', { name: '取消', exact: true }).click();
  }
});
