import { expect, type Page } from '@playwright/test';

export async function openResearchDirectory(page: Page) {
  const directory = page.getByRole('complementary', { name: '课题目录', exact: true });
  if (!await directory.isVisible()) {
    await page.getByRole('button', { name: '展开课题目录', exact: true }).click();
  }
  await expect(directory).toBeVisible();
  return directory;
}

export async function chooseResearchTopic(page: Page, title: string) {
  const directory = await openResearchDirectory(page);
  await directory.getByRole('button', { name: title, exact: true }).click();
}

export async function chooseResearchScope(page: Page, scope: '课题总览' | '全部任务') {
  const directory = await openResearchDirectory(page);
  await directory.getByRole('button', { name: scope, exact: true }).click();
}

export async function revealResearchFilters(page: Page) {
  const toggle = page.getByRole('button', { name: '筛选与显示', exact: true });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}
