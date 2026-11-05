import { test, expect } from '@playwright/test';

test('应用启动并展示工作台总览', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '工作台总览' })).toBeVisible();
  await expect(page.getByRole('button', { name: /科研课题/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /待办事项/ })).toBeVisible();
  await expect(page.getByText('月相 · 记录分布')).toBeVisible();
  await expect(page.getByText('声浪 · 近 14 天活跃')).toBeVisible();
});

test('文献库沿用工作台外壳并保持侧栏收纳状态', async ({ page }) => {
  await page.goto('/');
  const shellStyle = () => page.evaluate(() => ['.titlebar', '.sidebar'].map(selector => {
    const style = getComputedStyle(document.querySelector(selector)!);
    return [style.backgroundColor, style.backgroundImage, style.color];
  }));
  const original = await shellStyle();
  await page.getByRole('button', { name: '收起侧边栏', exact: true }).click();
  await page.getByRole('button', { name: '文献库', exact: true }).click();
  const sidebar = page.getByRole('complementary', { name: '侧边栏' });
  await expect(sidebar).toHaveCSS('width', '72px');
  expect(await shellStyle()).toEqual(original);
  const library = page.frameLocator('.port-library-shell iframe');
  await expect(library.getByRole('heading', { level: 1, name: '文献库', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '展开侧边栏', exact: true }).click();
  await expect(sidebar).toHaveCSS('width', '244px');
  await page.getByRole('button', { name: '工作台总览', exact: true }).click();
  await expect(sidebar).toHaveCSS('width', '244px');
});

test('待办视图可以快速添加事项', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /待办事项/ }).click();
  const ui = page.frameLocator('iframe[title="任务中心"]');
  await expect(ui.locator('#today-status')).toContainText(/同步|已保存/);
  await ui.locator('.today-center-quick-add').click();
  const input = ui.locator('.today-center-composer-input');
  await input.fill('端到端测试待办');
  await input.press('Enter');
  await expect(ui.getByText('端到端测试待办', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('research-workbench-v1')!).state.records.some((record: { title: string; typeId: string }) => record.typeId === 'todo' && record.title === '端到端测试待办'))).toBe(true);
});

test('侧边栏收起后仍可导航，并记住展开状态', async ({ page }) => {
  await page.goto('/');
  const sidebar = page.getByRole('complementary', { name: '侧边栏' });
  await expect(sidebar).toHaveCSS('width', '244px');
  await page.screenshot({ path: 'shots/sidebar-expanded.png' });

  const collapse = page.getByRole('button', { name: '收起侧边栏', exact: true });
  await collapse.focus();
  await page.keyboard.press('Enter');
  await expect(sidebar).toHaveCSS('width', '72px');
  await expect(page.getByRole('button', { name: '展开侧边栏' })).toHaveAttribute('aria-expanded', 'false');
  await page.screenshot({ path: 'shots/sidebar-collapsed.png' });

  await page.getByRole('button', { name: '待办事项', exact: true }).click();
  const tasks = page.frameLocator('iframe[title="任务中心"]');
  await expect(tasks.locator('#today-status')).toContainText(/同步|已保存/);
  await expect(tasks.locator('.today-center-quick-add')).toBeVisible();
  await page.reload();
  await expect(sidebar).toHaveCSS('width', '72px');

  await page.setViewportSize({ width: 880, height: 900 });
  await expect(sidebar).toHaveCSS('width', '72px');
  await page.getByRole('button', { name: '展开侧边栏', exact: true }).click();
  await expect(sidebar).toHaveCSS('width', '200px');
  await page.reload();
  await expect(sidebar).toHaveCSS('width', '200px');
  await expect(page.getByRole('button', { name: '收起侧边栏' })).toHaveAttribute('aria-expanded', 'true');
});
