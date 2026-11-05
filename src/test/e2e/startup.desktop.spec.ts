import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';

test('offline desktop startup restores minimized and tray windows', async ({ browserName }) => {
  test.skip(process.platform !== 'win32' || browserName !== 'chromium', 'Windows 桌面启动入口');
  const require = createRequire(import.meta.url);
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_START_URL;
  const executablePath = require('electron') as string;
  const args = [process.cwd(), `--user-data-dir=${path.resolve('.tmp-e2e-profile', `startup-${process.pid}-${Date.now()}`)}`];
  let desktop: ElectronApplication | undefined;
  // Exercise the OS second-instance callback without launching another Electron
  // process outside Playwright's instrumented application identity.
  const reopen = () => desktop!.evaluate(({ app }) => { app.emit('second-instance', {}, [], process.cwd()); });
  try {
    desktop = await test.step('launch the local build', () => _electron.launch({ executablePath, args, env }));
    const page = await desktop.firstWindow();
    await expect(page).toHaveURL(/^file:/);
    await page.getByRole('button', { name: '文献库', exact: true }).click();
    const library = page.frameLocator('iframe[title="Research Library 与 MuPDF 工作台"]');
    await expect(library.locator('#library-root')).toBeVisible();
    await expect(library.locator('.rw-header-actions').getByRole('button', { name: '导入 PDF', exact: true })).toBeVisible();

    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    await expect.poll(() => desktop!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true);
    await test.step('reopen a minimized window', reopen);
    await expect.poll(() => desktop!.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return window.isVisible() && !window.isMinimized();
    })).toBe(true);

    // The app's close button hides to the tray. A second launch must reopen it.
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await expect.poll(() => desktop!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
    await test.step('reopen a tray window', reopen);
    await expect.poll(() => desktop!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
    await expect(library.locator('#library-root')).toBeVisible();
  } finally {
    await desktop?.close();
  }
});
