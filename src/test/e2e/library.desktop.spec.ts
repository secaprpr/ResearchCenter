import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { createRequire } from 'node:module';
import { pdfFixture } from './pdfFixture';

test('Windows 桌面重启后保留原文与状态，并真正渲染 PDF 页面', async ({ baseURL }, testInfo) => {
  test.skip(process.platform !== 'win32', '本分支文献库的原生桌面验证面向 Windows');
  const require = createRequire(import.meta.url);
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE;
  env.ELECTRON_START_URL = baseURL!;
  const options = {
    executablePath: require('electron') as string,
    args: [process.cwd(), `--user-data-dir=${testInfo.outputPath('desktop-profile')}`],
    env,
  };
  let app: ElectronApplication | undefined;
  try {
    app = await _electron.launch(options);
    let page = await app.firstWindow();
    await page.getByRole('button', { name: '文献库', exact: true }).click();
    await page.getByRole('button', { name: '基础库', exact: true }).click();
    await expect(page.getByRole('button', { name: '导入 PDF', exact: true }).first()).toBeEnabled();
    await page.getByLabel('选择 PDF 文件').setInputFiles([{ name: 'Desktop.pdf', mimeType: 'application/pdf', buffer: pdfFixture('Synthetic desktop persistence check') }]);
    await expect(page.getByLabel('Desktop的阅读状态')).toHaveValue('unread');
    await page.getByLabel('Desktop的阅读状态').selectOption('read');
    await expect(page.getByLabel('Desktop的阅读状态')).toHaveValue('read');
    await app.close();

    app = await _electron.launch(options);
    page = await app.firstWindow();
    await page.getByRole('button', { name: '文献库', exact: true }).click();
    await page.getByRole('button', { name: '基础库', exact: true }).click();
    await expect(page.getByLabel('Desktop的阅读状态')).toHaveValue('read');
    await page.getByRole('button', { name: '打开 Desktop PDF', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '阅读 Desktop' })).toBeVisible();
    // Browser headless-shell omits the PDF plugin. The native desktop viewer
    // must load a real page, rather than merely exposing an iframe blob URL.
    await expect.poll(() => page.frames().some(frame => frame.url().startsWith('chrome-extension:'))).toBe(true);
    const viewer = page.frames().find(frame => frame.url().startsWith('chrome-extension:'))!;
    await expect.poll(() => viewer.locator('viewer-toolbar').evaluate(toolbar => Reflect.get(toolbar, 'docLength'))).toBe(1);
    await page.screenshot({ path: 'shots/library-desktop-pdf.png' });
  } finally {
    await app?.close();
  }
});
