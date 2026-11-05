import { test, expect, _electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pdfFixture } from './pdfFixture';

async function setup(page, navigate = true) {
  if (navigate) await page.goto('/');
  await page.getByRole('button', { name: '文献库', exact: true }).click();
  const ui = page.frameLocator('.port-library-shell iframe');
  await expect(ui.locator('#port-status')).toContainText('已就绪');
  await ui.locator('#port-pdf-input').setInputFiles({ name: 'Translation workflow.pdf', mimeType: 'application/pdf', buffer: pdfFixture('Reading notes keep evidence connected') });
  await ui.getByRole('button', { name: '阅读 Translation workflow', exact: true }).click();
  await expect.poll(() => ui.locator('.mupdf-reader-canvas').first().evaluate(el => el.width)).toBeGreaterThan(8);
  const frame = page.frames().find(f => f.url().includes('port.html'));
  const select = text => frame.evaluate(text => {
    const { reader, app } = window.__researchPort;
    reader.handleReaderSelection({ text, filePath: app.workspace.getActiveFile().path, fileName: 'Translation workflow.pdf', pageIndex: 0, pageNumber: 1 });
  }, text);
  return { ui, frame, select };
}
const google = (route, text) => route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify([[[text, '', null, null]], null, 'en']) });

test('已有 PDF 选区直接翻译，暂停时手动入口、短词、缓存和目标语言保持一致', async ({ page }) => {
  const calls = [];
  await page.route('https://translate.googleapis.com/**', route => {
    const params = new URL(route.request().url()).searchParams;
    calls.push([params.get('q'), params.get('tl')]); return google(route, `译文 ${params.get('q')} / ${params.get('tl')}`);
  });
  const { ui, frame, select } = await setup(page);
  const box = await ui.locator('.mupdf-reader-page').first().boundingBox(), scale = box.width / 612;
  await page.mouse.move(box.x + 51 * scale, box.y + 26 * scale); await page.mouse.down();
  await page.mouse.move(box.x + 350 * scale, box.y + 35 * scale, { steps: 12 }); await page.mouse.up();
  await expect(ui.getByRole('button', { name: '高亮选区', exact: true })).toBeEnabled();
  expect(calls).toHaveLength(0);
  await ui.getByRole('button', { name: '打开悬浮划词翻译', exact: true }).click();
  await expect(ui.locator('.is-latest .mupdf-tools-entry-translation')).toContainText('译文 Reading');
  expect(calls).toHaveLength(1);
  await expect(ui.locator('.mupdf-reader-translate-btn')).toHaveAttribute('aria-expanded', 'true');
  await ui.getByRole('button', { name: '打开悬浮划词翻译', exact: true }).click(); expect(calls).toHaveLength(1);
  await select('GPT');
  await expect(ui.locator('.is-latest').getByRole('button', { name: '翻译', exact: true })).toBeVisible();
  expect(calls).toHaveLength(1);
  await ui.locator('.is-latest').getByRole('button', { name: '翻译', exact: true }).click();
  await expect(ui.locator('.is-latest .mupdf-tools-entry-translation')).toContainText('译文 GPT');
  await ui.getByRole('button', { name: '自动翻译已暂停，点击开启', exact: true }).click();
  await select('AI'); await expect(ui.locator('.is-latest .mupdf-tools-entry-translation')).toContainText('译文 AI');
  await select('GPT'); await expect(ui.locator('.is-latest .mupdf-tools-entry-provider')).toContainText('缓存');
  expect(calls.filter(([text]) => text === 'GPT')).toHaveLength(1);
  await ui.getByLabel('翻译目标语言', { exact: true }).selectOption('ja');
  await expect(ui.locator('.is-latest .mupdf-tools-entry-translation')).toContainText('GPT / ja');
  expect(calls.at(-1)).toEqual(['GPT', 'ja']);
  expect(await frame.evaluate(() => window.__researchPort.reader.normalizeTranslationText('efﬁ-\r\ncient\u200b model'))).toBe('efficient model');
  await page.screenshot({ path: 'shots/translation-desktop.png' });
  await ui.getByRole('button', { name: '关闭翻译窗', exact: true }).click();
  await expect(ui.locator('.mupdf-reader-translate-btn')).toHaveAttribute('aria-expanded', 'false');
  await ui.getByRole('button', { name: '高亮选区', exact: true }).click();
  await expect(ui.locator('.mupdf-reader-highlight-quad').first()).toBeVisible();
  await ui.getByRole('button', { name: '打开悬浮划词翻译', exact: true }).click();
  await ui.locator('#reader-back').click();
  await expect(ui.locator('.mupdf-translate-float')).toHaveCount(0);
});

test('超时恢复与流式译文正常完成，取消请求不触发非流式回退', async ({ page }) => {
  await page.clock.install();
  const { ui, frame, select } = await setup(page);
  await ui.getByRole('button', { name: '打开悬浮划词翻译', exact: true }).click();
  await frame.evaluate(async () => {
    const { reader } = window.__researchPort;
    await reader.updateSettings({ translationProvider: 'openai-compatible', openaiBaseUrl: `${location.origin}/translation-test`, openaiModel: 'fixture-model', openaiStreaming: true });
  });
  let requests = 0;
  await page.route('**/translation-test/chat/completions', async route => {
    requests++;
    const text = route.request().postDataJSON().messages[1].content;
    if (text === 'Timeout evidence' || text === 'Stop evidence') return;
    await route.fulfill({ contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"流式"}}]}\n\ndata: {"choices":[{"delta":{"content":"译文"}}]}\n\ndata: [DONE]\n\n' });
  });
  await select('Timeout evidence'); await ui.locator('.is-latest').getByRole('button', { name: '翻译', exact: true }).click();
  await expect.poll(() => requests).toBe(1); await page.clock.fastForward(30_100);
  await expect(ui.locator('.is-latest .mupdf-tools-entry-error-text')).toContainText('超时');
  await select('Stream evidence'); await ui.locator('.is-latest').getByRole('button', { name: '翻译', exact: true }).click();
  await expect(ui.locator('.is-latest .mupdf-tools-entry-translation')).toHaveText('流式译文');
  await expect(ui.locator('.is-latest .mupdf-tools-entry-provider')).toContainText('流式');
  await select('Stop evidence'); await ui.locator('.is-latest').getByRole('button', { name: '翻译', exact: true }).click();
  await expect.poll(() => requests).toBe(3);
  await ui.getByRole('button', { name: '停止翻译', exact: true }).click();
  await expect(ui.locator('.mupdf-entry-state-loading')).toHaveCount(0);
  await page.clock.fastForward(1000); expect(requests).toBe(3);
});

test('桌面翻译请求经过 IPC，关闭慢请求后可立即处理新选区', async ({ baseURL }) => {
  test.skip(process.platform !== 'win32');
  const require = createRequire(import.meta.url);
  const env = { ...process.env, ELECTRON_START_URL: baseURL }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await test.step('启动独立桌面配置', () => _electron.launch({ executablePath: require('electron'), args: [process.cwd(), `--user-data-dir=${resolve('.taste-skill', `translation-desktop-${randomUUID()}`)}`], env, timeout: 10000 }));
    await app.evaluate(() => {
      const original = globalThis.fetch; globalThis.translationTestRequests = [];
      globalThis.fetch = async (url, options) => {
        if (String(url).startsWith('https://translate.googleapis.com/')) {
          const text = new URL(url).searchParams.get('q'); globalThis.translationTestRequests.push(text);
          if (text === 'Desktop slow') await new Promise(resolve => setTimeout(resolve, 2000));
          return new Response(JSON.stringify([[[`桌面译文 ${text}`, '', null, null]], null, 'en']), { status: 200 });
        }
        return original(url, options);
      };
    });
    const page = await test.step('打开桌面窗口', () => app.firstWindow({ timeout: 10000 }));
    const { ui, select } = await setup(page, false);
    await ui.getByRole('button', { name: '打开悬浮划词翻译', exact: true }).click();
    await select('Desktop slow'); await ui.locator('.is-latest').getByRole('button', { name: '翻译', exact: true }).click();
    await expect.poll(() => app.evaluate(() => globalThis.translationTestRequests.length)).toBe(1);
    await ui.getByRole('button', { name: '关闭翻译窗', exact: true }).click();
    await ui.getByRole('button', { name: '打开悬浮划词翻译', exact: true }).click();
    await select('Desktop latest'); await ui.locator('.is-latest').getByRole('button', { name: '翻译', exact: true }).click();
    await expect(ui.locator('.is-latest .mupdf-tools-entry-translation')).toHaveText('桌面译文 Desktop latest');
    await expect(ui.locator('.mupdf-entry-state-loading')).toHaveCount(0);
    expect(await app.evaluate(() => globalThis.translationTestRequests)).toEqual(['Desktop slow', 'Desktop latest']);
  } finally { await app?.close(); }
});

test('快速连续划词取消旧结果，撤销选区与关闭窗口不再发送待处理请求', async ({ page }) => {
  const calls = [], errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://translate.googleapis.com/**', async route => {
    const text = new URL(route.request().url()).searchParams.get('q'); calls.push(text);
    if (text === 'Old selection') await new Promise(resolve => setTimeout(resolve, 2400));
    await google(route, `译文 ${text}`).catch(() => {});
  });
  const { ui, frame, select } = await setup(page);
  await ui.getByRole('button', { name: '打开悬浮划词翻译', exact: true }).click();
  await ui.getByRole('button', { name: '自动翻译已暂停，点击开启', exact: true }).click();
  await select('Old selection'); await expect.poll(() => calls.length).toBe(1);
  await select('Intermediate selection'); await select('Latest selection');
  await expect(ui.locator('.is-latest .mupdf-tools-entry-translation')).toHaveText('译文 Latest selection');
  expect(calls).toEqual(['Old selection', 'Latest selection']);
  await expect(ui.locator('.mupdf-entry-state-loading')).toHaveCount(0);
  await select('Canceled selection');
  await frame.evaluate(() => window.__researchPort.app.workspace.mainLeaf.view.reader.clearSelection());
  await page.waitForTimeout(550); expect(calls).toHaveLength(2);
  await select('Closing selection'); await ui.getByRole('button', { name: '关闭翻译窗', exact: true }).click();
  await page.waitForTimeout(550); expect(calls).toHaveLength(2); expect(errors).toEqual([]);
});

test('网络失败可重试，服务配置可直达，窄屏翻译浮窗保持可操作', async ({ page }) => {
  let attempt = 0;
  await page.route('https://translate.googleapis.com/**', route => ++attempt === 1 ? route.fulfill({ status: 503, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'Unavailable' }) : google(route, '恢复后的译文'));
  const { ui, select } = await setup(page);
  await ui.getByRole('button', { name: '打开悬浮划词翻译', exact: true }).click();
  await select('Retry evidence'); await ui.locator('.is-latest').getByRole('button', { name: '翻译', exact: true }).click();
  await expect(ui.locator('.mupdf-tools-entry-error-text')).toContainText('503');
  await ui.getByRole('button', { name: '重试', exact: true }).click();
  await expect(ui.locator('.is-latest .mupdf-tools-entry-translation')).toHaveText('恢复后的译文');
  await ui.getByLabel('翻译服务', { exact: true }).selectOption('deepl');
  await expect(ui.locator('.mupdf-tools-entry-error-text')).toContainText('DeepL API Key');
  await ui.locator('.is-latest').getByRole('button', { name: '设置', exact: true }).click();
  await expect(ui.locator('.modal-title')).toHaveText('翻译设置');
  await ui.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await ui.getByLabel('翻译服务', { exact: true }).selectOption('google-web');
  await expect(ui.locator('.is-latest .mupdf-tools-entry-translation')).toHaveText('恢复后的译文');
  for (const width of [768, 390, 280]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(ui.getByRole('button', { name: '关闭翻译窗', exact: true })).toBeInViewport();
    expect(await ui.locator('.mupdf-translate-float').evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; })).toBe(true);
    await page.screenshot({ path: `shots/translation-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const head = await ui.locator('.mupdf-translate-float-header').boundingBox();
  await page.mouse.move(head.x + 30, head.y + head.height / 2); await page.mouse.down();
  await page.mouse.move(1180, head.y + head.height / 2, { steps: 8 }); await page.mouse.up();
  await ui.getByRole('button', { name: 'Pin 常驻', exact: true }).click();
  await ui.locator('#reader-back').click();
  await expect(ui.locator('.mupdf-translate-float')).toBeVisible();
  await ui.getByRole('button', { name: '阅读 Translation workflow', exact: true }).click();
  await expect(ui.locator('.mupdf-reader-translate-btn')).toHaveAttribute('aria-expanded', 'true');
  await ui.getByRole('button', { name: '关闭翻译窗', exact: true }).click();
  await expect(ui.locator('.mupdf-reader-translate-btn')).toHaveAttribute('aria-expanded', 'false');
});
