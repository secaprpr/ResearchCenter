import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { pdfFixture } from './pdfFixture';

async function openLibrary(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '文献库', exact: true }).click();
  await page.getByRole('button', { name: '基础库', exact: true }).click();
  await expect(page.getByRole('heading', { name: /文献库/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '导入 PDF', exact: true }).first()).toBeEnabled();
}

test('导入、补全、搜索筛选和批量状态持久化，刷新后可下载完整 PDF', async ({ page }) => {
  const bytes = pdfFixture('Synthetic retrieval paper');
  await openLibrary(page);
  await page.screenshot({ path: 'shots/library-empty.png' });
  await page.getByLabel('选择 PDF 文件').setInputFiles([
    { name: 'Retrieval_Study.pdf', mimeType: 'application/pdf', buffer: bytes },
    { name: 'Inference Notes.PDF', mimeType: 'application/pdf', buffer: pdfFixture('Synthetic inference paper') },
  ]);
  await expect(page.getByText('导入完成：新增 2 篇')).toBeVisible();
  await expect(page.locator('.library-table tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: 'Retrieval Study', exact: true }).click();
  await page.getByLabel('作者', { exact: true }).fill('Alice Chen');
  await page.getByLabel('年份', { exact: true }).fill('2025');
  await page.getByLabel('会议 / 期刊', { exact: true }).fill('NeurIPS');
  await page.getByLabel('标签', { exact: true }).fill('LLM，检索,LLM');
  await page.getByLabel('一句话备注').fill('核对证据遗漏的评测设置');
  await page.getByRole('button', { name: '保存信息' }).click();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.getByLabel('Retrieval Study的阅读状态').selectOption('reading');
  await page.getByRole('textbox', { name: '搜索文献' }).fill('alice 检索');
  await expect(page.locator('.library-table tbody tr')).toHaveCount(1);
  await page.getByRole('group', { name: '按阅读状态筛选' }).getByRole('button', { name: /^阅读中/ }).click();
  await page.getByLabel('按年份筛选').selectOption('2025');
  await expect(page.locator('.library-table tbody tr')).toHaveCount(1);
  await page.screenshot({ path: 'shots/library-details.png' });

  await openLibrary(page);
  await expect(page.getByLabel('Retrieval Study的阅读状态')).toHaveValue('reading');
  await page.getByRole('button', { name: '打开 Retrieval Study PDF', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '阅读 Retrieval Study' });
  await expect(preview).toBeVisible();
  await expect(preview.locator('iframe')).toHaveAttribute('src', /^blob:/);
  const downloadEvent = page.waitForEvent('download');
  await preview.getByRole('link', { name: '下载 PDF' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('Retrieval_Study.pdf');
  expect(await readFile((await download.path())!)).toEqual(bytes);
  await page.getByRole('button', { name: '关闭 PDF', exact: true }).click();

  await page.getByLabel('选择当前结果中的全部文献').check();
  await page.getByLabel('批量设置阅读状态').selectOption('skimmed');
  await expect(page.getByLabel('Retrieval Study的阅读状态')).toHaveValue('skimmed');
  await expect(page.getByLabel('Inference Notes的阅读状态')).toHaveValue('skimmed');
  await page.getByRole('textbox', { name: '搜索文献' }).fill('no-such-paper');
  await expect(page.getByText('没有找到匹配的文献', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除筛选' }).click();
  await expect(page.locator('.library-table tbody tr')).toHaveCount(2);
});

test('按内容去重，失败文件不产生条目，移出副本不会留下附件', async ({ page }) => {
  const bytes = pdfFixture('Synthetic duplicate test');
  await openLibrary(page);
  await page.getByLabel('选择 PDF 文件').setInputFiles([{ name: 'Original.pdf', mimeType: 'application/pdf', buffer: bytes }]);
  await expect(page.getByText('导入完成：新增 1 篇')).toBeVisible();
  await openLibrary(page);
  await page.getByLabel('选择 PDF 文件').setInputFiles([
    { name: 'Renamed.pdf', mimeType: 'application/pdf', buffer: bytes },
    { name: 'Broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') },
    { name: 'Empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) },
  ]);
  await expect(page.getByText('导入完成：新增 0 篇，跳过 1 个重复文件，2 个文件失败')).toBeVisible();
  await expect(page.locator('.library-table tbody tr')).toHaveCount(1);
  await page.getByText('查看详情', { exact: true }).click();
  await expect(page.getByText(/Broken.pdf：文件缺少有效的 PDF 标识/)).toBeVisible();
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await page.getByRole('button', { name: '移出文献库', exact: true }).click();
  await page.getByRole('button', { name: '确认移出' }).click();
  await expect(page.getByText('从第一篇论文开始', { exact: true })).toBeVisible();
  const counts = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('research-workbench-library', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const count = (name: string) => new Promise<number>((resolve, reject) => { const request = db.transaction(name).objectStore(name).count(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try { return await Promise.all([count('papers'), count('files')]); } finally { db.close(); }
  });
  expect(counts).toEqual([0, 0]);
});

test('拖入 PDF 导入后，可通过标签和未知年份筛选', async ({ page }) => {
  await openLibrary(page);
  const bytes = Array.from(pdfFixture('Synthetic drag drop'));
  const data = await page.evaluateHandle(payload => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(payload)], 'Dropped.pdf', { type: 'application/pdf' }));
    return transfer;
  }, bytes);
  await page.getByRole('region', { name: '文献库', exact: true }).dispatchEvent('drop', { dataTransfer: data });
  await expect(page.getByText('导入完成：新增 1 篇')).toBeVisible();
  await page.getByLabel('按年份筛选').selectOption('unknown');
  await expect(page.locator('.library-table tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Dropped', exact: true }).click();
  await page.getByLabel('标签', { exact: true }).fill('Systems');
  await page.getByRole('button', { name: '保存信息' }).click();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Systems', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '搜索文献' })).toHaveValue('Systems');
});
