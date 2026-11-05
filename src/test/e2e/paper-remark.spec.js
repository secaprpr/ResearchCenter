import { test, expect } from '@playwright/test';
import { pdfFixture } from './pdfFixture';

async function setup(page) {
  const errors = []; page.on('pageerror', error => errors.push(error.message)); await page.route('https://**', route => route.abort());
  await page.goto('/'); await page.getByRole('button', { name: '文献库', exact: true }).click();
  const ui = page.frameLocator('.port-library-shell iframe'); await expect(ui.locator('#port-status')).toContainText('已就绪');
  await ui.locator('#port-pdf-input').setInputFiles(['A', 'B'].map(name => ({ name: `Remark Study ${name}.pdf`, mimeType: 'application/pdf', buffer: pdfFixture('Remark study ' + name) })));
  await expect(ui.locator('.rw-paper-row')).toHaveCount(2); const frame = page.frames().find(f => f.url().includes('port.html'));
  await frame.evaluate(async () => { const x = window.__researchPort; for (const p of x.library.currentModal.papers) { await x.app.fileManager.processFrontMatter(p.file, fm => { fm.note = p.title.endsWith('A') ? '已有的短备注' : ''; }); x.app.paperNotes.update(p.file, '# 独立研究笔记\n\n正文不会被备注覆盖。\n'); await x.app.paperNotes.flush(p.file); } });
  const remark = name => ui.getByRole('button', { name: '编辑备注：Remark Study ' + name, exact: true });
  const input = name => ui.getByRole('textbox', { name: '备注：Remark Study ' + name, exact: true });
  const stored = name => frame.evaluate(name => { const x = window.__researchPort, p = x.library.currentModal.papers.find(p => p.title === 'Remark Study ' + name); return { note: p.note, text: x.vault.texts.get(p.file.path) }; }, name);
  return { ui, frame, remark, input, stored, errors };
}

test('备注列原位编辑、回车及失焦保存、取消、清空和重启保留，不覆盖研究笔记', async ({ page }) => {
  const { ui, frame, remark, input, stored, errors } = await setup(page);
  await expect(ui.locator('th.rw-remark-cell')).toHaveCount(1); await expect(remark('A')).toHaveText('已有的短备注');
  await remark('A').click(); await input('A').fill('可用于外部验证'); await input('A').press('Control+a'); await expect(ui.locator('.rw-paper-row[aria-selected=true]')).toHaveCount(0);
  await input('A').press('End'); await input('A').press('Enter'); await expect(remark('A')).toHaveText('可用于外部验证'); await expect(remark('A')).toBeFocused();
  await remark('A').click(); await input('A').fill('取消的内容'); await input('A').press('Escape'); await expect(remark('A')).toHaveText('可用于外部验证');
  await remark('B').click(); await input('B').fill('等待补充实验'); await ui.locator('.rw-scope-toolbar h2').click(); await expect(remark('B')).toHaveText('等待补充实验');
  await remark('A').click(); await input('A').fill('备注与标签并发保存');
  await frame.evaluate(async () => { const x = window.__researchPort, p = x.library.currentModal.papers.find(p => p.title.endsWith('A')); await x.app.fileManager.processFrontMatter(p.file, fm => { fm.keywords = ['新增标签']; }); });
  await input('A').press('Enter'); await expect(remark('A')).toHaveText('备注与标签并发保存');
  const a = await stored('A'); expect(a.text).toContain('新增标签'); expect(a.text).toContain('# 独立研究笔记'); expect(a.text).toContain('正文不会被备注覆盖。');
  const search = ui.getByRole('searchbox', { name: '搜索文献', exact: true }); await search.fill('等待补充实验'); await expect(ui.locator('.rw-paper-row')).toHaveCount(1); await search.fill('');
  await remark('B').click(); await input('B').fill(''); await input('B').press('Enter'); await expect(remark('B')).toHaveText('—');
  await page.reload(); await page.getByRole('button', { name: '文献库', exact: true }).click(); await expect(remark('A')).toHaveText('备注与标签并发保存'); await expect(remark('B')).toHaveText('—');
  expect(errors).toEqual([]);
});

test('备注列可调宽隐藏并记忆，保存失败保留输入，中文组词不误提交且窄屏不越界', async ({ page }) => {
  const { ui, frame, remark, input, errors } = await setup(page);
  const handle = ui.getByRole('separator', { name: '调整备注列宽', exact: true }); await handle.scrollIntoViewIfNeeded(); await handle.focus(); await handle.press('Shift+ArrowRight'); await expect(handle).toHaveAttribute('aria-valuenow', '300');
  await ui.locator('th.rw-remark-cell').click({ button: 'right' }); const menu = ui.getByRole('menu', { name: '文献显示列', exact: true });
  await menu.getByRole('menuitemcheckbox', { name: '备注', exact: true }).click(); await expect(ui.locator('.rw-remark-cell')).toHaveCount(0); await menu.press('Escape');
  await page.reload(); await page.getByRole('button', { name: '文献库', exact: true }).click(); await expect(ui.locator('th.rw-remark-cell')).toHaveCount(0);
  await ui.getByRole('button', { name: '选择显示列', exact: true }).click(); await menu.getByRole('menuitemcheckbox', { name: '备注', exact: true }).click(); await menu.press('Escape'); await expect(handle).toHaveAttribute('aria-valuenow', '300');
  await remark('A').click(); await input('A').fill('保存失败时仍保留草稿');
  await ui.locator('html').evaluate(() => { const x = window.__researchPort, modify = x.vault.modify.bind(x.vault); x.vault.modify = async (...args) => { x.vault.modify = modify; throw new Error('fixture write failed'); }; });
  await input('A').press('Enter'); await expect(ui.locator('#notices')).toContainText('备注保存失败'); await expect(input('A')).toHaveValue('保存失败时仍保留草稿'); await expect(input('A')).toHaveAttribute('aria-busy', 'false');
  await input('A').dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true }); await expect(input('A')).toBeVisible();
  await input('A').press('Enter'); await expect(remark('A')).toHaveText('保存失败时仍保留草稿');
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 }); await remark('A').scrollIntoViewIfNeeded();
    expect(await ui.locator('html').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: `shots/paper-remark-${width}.png` });
  }
  expect(errors).toEqual([]);
});

test('备注胶囊可混排、改色并按原语法保存，普通文本与选中行字体保持一致', async ({ page }) => {
  const { ui, remark, input, stored, errors } = await setup(page);
  const source = String.raw`先复现 [重点]{红} [待验证]{蓝色} [自定义]{#ffcc00} [普通引用] \[示例]{红} [错误]{url(x)}`;
  await remark('A').click(); await input('A').fill(source); await input('A').press('Enter');
  const pills = remark('A').locator('.rw-remark-pill'); await expect(pills).toHaveText(['重点', '待验证', '自定义']);
  await expect(remark('A')).toContainText('[普通引用] [示例]{红} [错误]{url(x)}');
  await expect.poll(async () => (await stored('A')).note).toBe(source);
  await remark('A').click(); await expect(input('A')).toHaveValue(source); await input('A').fill('[取消]{绿}'); await input('A').press('Escape'); await expect(pills).toHaveCount(3);
  const actual = await pills.first().evaluate(el => { const s = getComputedStyle(el); return [s.fontFamily, s.fontSize, s.fontWeight, s.lineHeight]; });
  const reference = await ui.locator('.rw-paper-row .rw-status-pill').first().evaluate(el => { const s = getComputedStyle(el); return [s.fontFamily, s.fontSize, s.fontWeight, s.lineHeight]; }); expect(actual).toEqual(reference);
  await remark('B').click(); await input('B').fill('[<img src=x onerror=alert(1)>]{红}'); await input('B').press('Enter'); await expect(remark('B').locator('img')).toHaveCount(0); await expect(remark('B')).toHaveText('<img src=x onerror=alert(1)>');
  await page.reload(); await page.getByRole('button', { name: '文献库', exact: true }).click(); await expect(pills).toHaveText(['重点', '待验证', '自定义']);
  await remark('A').click(); await expect(input('A')).toHaveValue(source); await input('A').fill('[已验证]{绿} [待复现]{蓝} [重点]{红}'); await input('A').press('Enter'); await expect(pills).toHaveText(['已验证', '待复现', '重点']);
  const search = ui.getByRole('searchbox', { name: '搜索文献', exact: true }); await search.fill('已验证 待复现'); await expect(ui.locator('.rw-paper-row')).toHaveCount(1); await search.fill('');
  await remark('B').click(); await input('B').fill('补充实验 [疑问]{紫}'); await input('B').press('Enter');
  const handle = ui.getByRole('separator', { name: '调整备注列宽', exact: true }); await handle.scrollIntoViewIfNeeded(); await handle.focus(); for (let i = 0; i < 3; i++) await handle.press('Shift+ArrowRight');
  await expect(ui.locator('#notices .notice')).toHaveCount(0, { timeout: 10000 });
  for (const width of [1440, 768, 390]) { await page.setViewportSize({ width, height: 900 }); await remark('A').scrollIntoViewIfNeeded(); expect(await ui.locator('html').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true); await page.screenshot({ path: `shots/remark-capsules-${width}.png` }); }
  expect(errors).toEqual([]);
});

test('详情标签下可编辑多行备注，与列表同步、切换论文不串稿且刷新保留', async ({ page }) => {
  const { ui, remark, input, stored, errors } = await setup(page);
  await ui.locator('.rw-paper-row').filter({ hasText: 'Remark Study A' }).locator('.rw-paper-title').click();
  const detail = ui.getByRole('complementary', { name: '论文详情', exact: true });
  const display = detail.getByRole('button', { name: '编辑详情备注：Remark Study A', exact: true });
  const editor = detail.getByRole('textbox', { name: '详情备注：Remark Study A', exact: true });
  await expect(display).toHaveText('已有的短备注');
  const positions = await detail.evaluate(el => ['.rw-detail-badges', '.rw-detail-remark', '.rw-read-button'].map(s => el.querySelector(s).getBoundingClientRect().top));
  expect(positions[1]).toBeGreaterThan(positions[0]); expect(positions[2]).toBeGreaterThan(positions[1]);
  await display.click(); await editor.fill('[重点]{红} 需要对照附录中的外部验证结果。');
  await editor.press('End'); await editor.press('Enter'); await editor.pressSequentially('保留独立的研究笔记正文。');
  const source = await editor.inputValue(); expect(source).toContain('\n');
  await editor.press('Control+Enter'); await expect(display.locator('.rw-remark-pill')).toHaveText('重点');
  await expect(remark('A')).toContainText('保留独立的研究笔记正文。');
  expect((await stored('A')).text).toContain('# 独立研究笔记');
  await remark('A').click(); await input('A').fill('[已核对]{绿} 列表编辑同步详情'); await input('A').press('Enter'); await expect(display).toContainText('列表编辑同步详情');
  await display.click(); await editor.fill('取消的修改'); await editor.press('Escape'); await expect(display).toContainText('列表编辑同步详情');
  await ui.locator('.rw-paper-row').filter({ hasText: 'Remark Study B' }).locator('.rw-paper-title').click();
  const empty = detail.getByRole('button', { name: '编辑详情备注：Remark Study B', exact: true }); await expect(empty).toHaveText('添加备注');
  await empty.click(); const b = detail.getByRole('textbox', { name: '详情备注：Remark Study B', exact: true }); await b.fill('B 的独立备注'); await detail.locator('h2').click(); await expect(remark('B')).toHaveText('B 的独立备注');
  await ui.locator('.rw-paper-row').filter({ hasText: 'Remark Study A' }).locator('.rw-paper-title').click();
  await expect(display).toContainText('列表编辑同步详情'); await display.click(); await editor.fill(source); await editor.press('Control+s');
  await expect(display).toContainText('需要对照附录');
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 }); await display.scrollIntoViewIfNeeded();
    const bounds = await display.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth })); expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1);
    await page.screenshot({ path: `shots/detail-remark-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload(); await page.getByRole('button', { name: '文献库', exact: true }).click(); await expect(remark('A')).toContainText('需要对照附录');
  await ui.locator('.rw-paper-row').filter({ hasText: 'Remark Study A' }).locator('.rw-paper-title').click(); await display.click(); await expect(editor).toHaveValue(source); await editor.fill(''); await editor.press('Control+Enter'); await expect(display).toHaveText('添加备注'); await expect(remark('A')).toHaveText('—');
  expect(errors).toEqual([]);
});

test('列表失焦写入尚未完成时打开详情编辑，使用最新草稿避免覆盖', async ({ page }) => {
  const { ui, frame, remark, input, stored } = await setup(page);
  await ui.locator('.rw-paper-row').filter({ hasText: 'Remark Study A' }).locator('.rw-paper-title').click();
  await frame.evaluate(() => {
    const x = window.__researchPort, modify = x.vault.modify.bind(x.vault);
    x.vault.modify = async (...args) => { x.vault.modify = modify; await new Promise(resolve => { window.releaseRemarkWrite = resolve; }); return modify(...args); };
  });
  await remark('A').click(); await input('A').fill('[最新]{蓝} 尚在写入的列表备注');
  await ui.getByRole('button', { name: '编辑详情备注：Remark Study A', exact: true }).click();
  const editor = ui.getByRole('textbox', { name: '详情备注：Remark Study A', exact: true }); await expect(editor).toHaveValue('[最新]{蓝} 尚在写入的列表备注');
  await expect.poll(() => frame.evaluate(() => typeof window.releaseRemarkWrite)).toBe('function');
  await frame.evaluate(() => window.releaseRemarkWrite()); await editor.fill('[最新]{蓝} 详情继续修改'); await editor.press('Control+Enter');
  await expect(remark('A')).toContainText('详情继续修改'); await expect.poll(async () => (await stored('A')).note).toBe('[最新]{蓝} 详情继续修改');
});
