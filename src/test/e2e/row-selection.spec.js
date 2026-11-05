import { test, expect } from '@playwright/test';
import { pdfFixture } from './pdfFixture';

async function setup(page) {
  await page.goto('/'); await page.getByRole('button', { name: '文献库', exact: true }).click();
  const ui = page.frameLocator('.port-library-shell iframe');
  await expect(ui.locator('#port-status')).toContainText('已就绪');
  await ui.locator('#port-pdf-input').setInputFiles(['A', 'B', 'C', 'D'].map(name => ({ name: `Selection ${name}.pdf`, mimeType: 'application/pdf', buffer: pdfFixture(`Distinct selection document ${name}`) })));
  await expect(ui.locator('.rw-paper-row')).toHaveCount(4);
  return ui;
}

test('去掉复选框，Ctrl 增减、Shift 范围、批量状态和按筛选结果全选', async ({ page }) => {
  const ui = await setup(page);
  await ui.getByRole('button', { name: '按标题排序', exact: true }).click();
  const row = name => ui.locator('.rw-paper-row').filter({ has: ui.locator('.rw-paper-title', { hasText: `Selection ${name}` }) });
  const title = name => row(name).locator('.rw-paper-title');
  const selected = ui.locator('.rw-paper-row[aria-selected=true]');
  await expect(ui.locator('.rw-paper-table input[type=checkbox]')).toHaveCount(0);
  await expect(ui.locator('.rw-paper-table thead th')).toHaveCount(9);
  await expect(selected).toHaveCount(0);
  await title('A').click(); await expect(selected).toHaveCount(1);
  await title('C').click({ modifiers: ['Control'] }); await expect(selected).toHaveCount(2);
  await title('C').click({ modifiers: ['Control'] }); await expect(selected).toHaveCount(1);
  await title('A').click();
  await title('D').click({ modifiers: ['Shift'] }); await expect(selected).toHaveCount(4);
  await title('A').click(); await title('D').click({ modifiers: ['Control'] });
  await title('B').click({ modifiers: ['Control', 'Shift'] }); await expect(selected).toHaveCount(4);
  await row('B').press('Escape'); await expect(selected).toHaveCount(0);
  await title('A').click(); await title('C').click({ modifiers: ['Control'] });
  // Interactive row controls do not replace the current multi-selection.
  await row('A').getByRole('button', { name: '设为重点：Selection A', exact: true }).click();
  await expect(selected).toHaveCount(2);
  await ui.getByLabel('批量设置阅读状态').selectOption('queued');
  await expect(selected).toHaveCount(0);
  for (const name of ['A', 'C']) await expect(row(name).locator('.rw-state')).toHaveText('待阅读');
  for (const name of ['B', 'D']) await expect(row(name).locator('.rw-state')).toHaveText('待整理');
  await row('A').focus(); await row('A').press('Control+a'); await expect(selected).toHaveCount(4);
  await ui.getByRole('button', { name: '筛选', exact: true }).click();
  await ui.getByLabel('筛选阅读状态').selectOption('queued');
  await expect(ui.locator('.rw-paper-row')).toHaveCount(2); await expect(selected).toHaveCount(2);
  const search = ui.getByRole('searchbox', { name: '搜索文献', exact: true });
  await search.fill('Selection');
  await search.press('Control+a');
  expect(await search.evaluate(el => el.selectionStart === 0 && el.selectionEnd === el.value.length)).toBe(true);
  await row('A').focus(); await row('A').press('Control+a'); await expect(selected).toHaveCount(2);
  await search.fill('no-selection-match'); await expect(ui.locator('.rw-paper-row')).toHaveCount(0); await expect(selected).toHaveCount(0);
  await search.fill(''); await ui.getByLabel('筛选阅读状态').selectOption('all'); await expect(ui.locator('.rw-paper-row')).toHaveCount(4);
  await title('A').click(); await row('A').press('Shift+ArrowDown'); await expect(selected).toHaveCount(2);
  await expect(row('B')).toBeFocused();
  await row('B').press('ArrowDown'); await expect(selected).toHaveCount(1); await expect(row('C')).toHaveAttribute('aria-selected', 'true');
  await row('C').press('Control+ArrowDown'); await expect(row('D')).toBeFocused(); await expect(row('C')).toHaveAttribute('aria-selected', 'true');
  await row('D').press('Space'); await expect(selected).toHaveCount(2);
  await page.screenshot({ path: 'shots/library-row-multiselect.png' });
});

test('手机多选入口可代替 Ctrl，不显示复选框也能批量设置', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const ui = await setup(page);
  await ui.getByRole('button', { name: '多选文献', exact: true }).click();
  await ui.locator('.rw-paper-title').nth(0).click(); await ui.locator('.rw-paper-title').nth(1).click();
  await expect(ui.locator('.rw-paper-row[aria-selected=true]')).toHaveCount(2);
  await expect(ui.getByRole('complementary', { name: '论文详情', exact: true })).toHaveCount(0);
  await expect(ui.getByLabel('批量设置阅读状态')).toBeVisible();
  await ui.getByLabel('批量设置阅读状态').selectOption('read');
  await expect(ui.locator('.rw-paper-row .rw-status-pill.state-read')).toHaveCount(2);
  await expect(ui.locator('.rw-paper-table input[type=checkbox]')).toHaveCount(0);
  expect(await ui.locator('html').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: 'shots/library-row-multiselect-mobile.png' });
});
