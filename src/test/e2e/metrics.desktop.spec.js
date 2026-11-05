import { _electron, expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pdfFixture } from './pdfFixture';

test('桌面指标自动匹配：密钥隔离、同刊缓存、手动值保护和来源变更', async ({ baseURL }, testInfo) => {
  test.skip(process.platform !== 'win32');
  const require = createRequire(import.meta.url);
  const env = { ...process.env, ELECTRON_START_URL: baseURL }; delete env.ELECTRON_RUN_AS_NODE;
  const profile = testInfo.outputPath('metrics-profile');
  let app;
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [process.cwd(), '--user-data-dir=' + profile], env });
    await app.evaluate(({ net }) => {
      globalThis.metricsTestRequests = [];
      const original = net.fetch;
      net.fetch = async (url, options) => {
        if (String(url).startsWith('https://www.easyscholar.cc/open/getPublicationRank')) {
          globalThis.metricsTestRequests.push(new URL(url).searchParams.get('publicationName'));
          return new Response(JSON.stringify({ code: 200, data: { officialRank: { all: { sciif: '18', sci: 'Q1', sciUp: '医学1区' } } } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return original(url, options);
      };
    });
    const page = await app.firstWindow();
    await page.getByRole('button', { name: '文献库', exact: true }).click();
    const ui = page.frameLocator('.port-library-shell iframe');
    await expect(ui.locator('#port-status')).toContainText('已就绪');
    await ui.getByRole('button', { name: '期刊指标自动匹配', exact: true }).click();
    await ui.getByLabel('easyScholar 密钥', { exact: true }).fill('synthetic-only-key-123');
    await ui.getByText('导入或修改发表来源后自动在线匹配', { exact: true }).check();
    await ui.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(ui.locator('.rw-metrics-sources')).toContainText('已配置');
    await expect(ui.getByLabel('easyScholar 密钥', { exact: true })).toHaveValue('');
    await ui.getByRole('button', { name: '关闭指标设置', exact: true }).click();
    await ui.locator('#port-pdf-input').setInputFiles([{ name: 'Metrics One.pdf', mimeType: 'application/pdf', buffer: pdfFixture('Metrics first distinct paper') }, { name: 'Metrics Two.pdf', mimeType: 'application/pdf', buffer: pdfFixture('Metrics second distinct paper') }]);
    await expect(ui.locator('.rw-paper-row')).toHaveCount(2);
    for (const title of ['Metrics One', 'Metrics Two']) {
      await ui.locator('.rw-paper-row').filter({ hasText: title }).click();
      await ui.getByRole('button', { name: '编辑', exact: true }).click();
      await ui.getByLabel('会议 / 期刊', { exact: true }).fill('Nature');
      await ui.getByRole('button', { name: '保存修改', exact: true }).click();
      await expect(ui.locator('.rw-paper-row').filter({ hasText: title }).locator('.rw-impact')).toHaveText('18.0');
    }
    expect(await app.evaluate(() => globalThis.metricsTestRequests)).toEqual(['Nature']);
    await expect(ui.locator('.rw-metric-provenance')).toContainText('未提供指标年份');
    await ui.getByRole('button', { name: '编辑', exact: true }).click();
    await ui.getByLabel('影响因子', { exact: true }).fill('7');
    await ui.getByLabel('会议 / 期刊', { exact: true }).fill('NeurIPS2021');
    await ui.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(ui.locator('.rw-detail-badges')).toContainText('CCF A');
    await expect(ui.locator('.rw-detail-badges')).not.toContainText('医学1区');
    await expect(ui.locator('.rw-paper-row').filter({ hasText: 'Metrics Two' }).locator('.rw-impact')).toHaveText('7.0');
    expect(await app.evaluate(() => globalThis.metricsTestRequests)).toEqual(['Nature']);
    const settings = await fs.readFile(path.join(profile, 'journal-metrics-settings.json'), 'utf8');
    expect(settings).not.toContain('synthetic-only-key-123');
    const cache = await fs.readFile(path.join(profile, 'journal-metrics-cache.json'), 'utf8');
    expect(cache).not.toContain('synthetic-only-key-123');
    await page.reload(); await page.getByRole('button', { name: '文献库', exact: true }).click();
    await expect(ui.locator('.rw-paper-row').filter({ hasText: 'Metrics Two' }).locator('.rw-impact')).toHaveText('7.0');
    await expect(ui.locator('.rw-paper-row').filter({ hasText: 'Metrics One' }).locator('.rw-impact')).toHaveText('18.0');
    expect(await app.evaluate(() => globalThis.metricsTestRequests)).toEqual(['Nature']);
    await ui.locator('.rw-paper-row').filter({ hasText: 'Metrics Two' }).click();
    await ui.getByRole('button', { name: '编辑', exact: true }).click();
    await ui.getByLabel('会议 / 期刊', { exact: true }).fill('');
    await ui.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(ui.locator('.rw-detail-badges')).not.toContainText('CCF A');
    await expect(ui.locator('.rw-paper-row').filter({ hasText: 'Metrics Two' }).locator('.rw-impact')).toHaveText('7.0');
    await ui.getByRole('button', { name: '期刊指标自动匹配', exact: true }).click();
    await page.screenshot({ path: 'shots/library-metrics-settings-test.png' });
  } finally { await app?.close(); }
});
