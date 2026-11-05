import { test, expect } from '@playwright/test';
import { pdfFixture } from './pdfFixture';

async function setup(page) {
  const errors = []; page.on('pageerror', error => errors.push(error.message)); await page.route('https://**', route => route.abort());
  await page.goto('/'); await page.getByRole('button', { name: '文献库', exact: true }).click();
  const ui = page.frameLocator('.port-library-shell iframe'); await expect(ui.locator('#port-status')).toContainText('已就绪');
  await ui.locator('#port-pdf-input').setInputFiles({ name: 'Style Study.pdf', mimeType: 'application/pdf', buffer: pdfFixture('A style study') }); await expect(ui.locator('.rw-paper-row')).toHaveCount(1);
  const frame = page.frames().find(f => f.url().includes('port.html'));
  await frame.evaluate(async () => { const { app, library } = window.__researchPort; const file = library.currentModal.papers[0].file; app.paperNotes.update(file, '# Study notes\n\nA strong baseline needs evidence.\n\n## Follow-up\n\nNext experiment.\n'); await app.paperNotes.flush(file); });
  await ui.locator('.rw-paper-row').dblclick(); await expect(ui.locator('.mupdf-reader-page')).toBeVisible(); await ui.getByRole('button', { name: '打开研究笔记', exact: true }).click();
  const pane = ui.locator('#paper-notes-pane'), editor = pane.getByRole('textbox', { name: '研究笔记正文', exact: true }); await expect(editor).toBeVisible();
  const stored = () => frame.evaluate(() => { const { app, library } = window.__researchPort; return app.paperNotes.session(library.currentModal.papers[0].file).base; });
  return { ui, frame, pane, editor, stored, errors };
}
async function selectParagraph(page, editor) { await editor.locator('p').first().click(); await page.keyboard.press('Home'); await page.keyboard.press('Shift+End'); }
async function palette(ui, pane) { await pane.getByRole('button', { name: '特殊标记', exact: true }).click(); const dialog = ui.getByRole('dialog', { name: '特殊标记', exact: true }); await expect(dialog).toBeVisible(); return dialog; }

test('科研标注块可应用、修改、导出为 Obsidian 语法并重启保存，窄屏面板可用', async ({ page }) => {
  const { ui, pane, editor, stored, errors } = await setup(page); await selectParagraph(page, editor);
  let dialog = await palette(ui, pane); await expect(dialog.getByLabel('标注块正文')).toHaveValue('A strong baseline needs evidence.');
  await dialog.getByRole('button', { name: '方法', exact: true }).click(); await dialog.getByRole('button', { name: '描边', exact: true }).click();
  await dialog.getByLabel('标注块标题').fill('复现路径'); await dialog.getByRole('button', { name: '应用标记', exact: true }).click();
  const block = editor.locator('blockquote.callout[data-subtype=method-outline]'); await expect(block).toContainText('复现路径'); await expect(block).toContainText('A strong baseline needs evidence.');
  await expect.poll(stored).toContain('> [!method-outline] 复现路径'); expect(await stored()).toContain('## Follow-up'); expect(await stored()).not.toContain('data-rw-note-style');
  await block.locator('p').last().click(); dialog = await palette(ui, pane); await expect(dialog.getByLabel('标注块标题')).toHaveValue('复现路径'); await expect(dialog.getByLabel('标注块正文')).toHaveValue('A strong baseline needs evidence.');
  await dialog.getByRole('button', { name: '结论', exact: true }).click(); await dialog.getByRole('button', { name: '淡底', exact: true }).click();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 }); await expect(dialog.getByRole('button', { name: '应用标记', exact: true })).toBeInViewport();
    expect(await dialog.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })).toBe(true);
    await page.screenshot({ path: `shots/note-styles-block-${width}.png` });
  }
  await dialog.getByRole('button', { name: '应用标记', exact: true }).click(); await expect(editor.locator('blockquote.callout')).toHaveCount(1); await expect.poll(stored).toContain('> [!conclusion-soft] 复现路径'); expect((await stored()).indexOf('[!conclusion-soft]')).toBeLessThan((await stored()).indexOf('## Follow-up'));
  await page.reload(); await page.getByRole('button', { name: '文献库', exact: true }).click(); await ui.locator('.rw-paper-row').click(); await ui.getByRole('tab', { name: '笔记', exact: true }).click();
  await expect(ui.locator('.rw-paper-detail .callout[data-subtype=conclusion-soft]')).toContainText('复现路径'); expect(errors).toEqual([]);
});

test('选中带粗体的段落添加和移除标记保留原格式，取消不改正文', async ({ page }) => {
  const { ui, pane, editor, stored, errors } = await setup(page);
  await pane.getByRole('button', { name: 'Markdown 源码', exact: true }).click(); await pane.getByLabel('Markdown 正文').fill('# Rich notes\n\n保留 **粗体** 和 *斜体*。\n'); await pane.getByRole('button', { name: '所见所得编辑', exact: true }).click(); await expect(editor.locator('strong')).toHaveText('粗体');
  await selectParagraph(page, editor); let dialog = await palette(ui, pane); await dialog.getByRole('tab', { name: '文字样式', exact: true }).click(); await dialog.getByRole('button', { name: '青绿', exact: true }).click(); await dialog.getByRole('button', { name: '描边', exact: true }).click(); await dialog.getByRole('button', { name: '应用标记', exact: true }).click();
  const mark = editor.locator('[data-rw-note-style]'); await expect(mark.locator('strong')).toHaveText('粗体'); await expect(mark.locator('em')).toHaveText('斜体'); await expect.poll(stored).toContain('**粗体**');
  await mark.click(); dialog = await palette(ui, pane); await dialog.getByRole('button', { name: '移除标记', exact: true }).click(); await expect(editor.locator('[data-rw-note-style]')).toHaveCount(0); await expect(editor.locator('strong')).toHaveText('粗体'); await expect(editor.locator('em')).toHaveText('斜体');
  await expect.poll(stored).not.toContain('<span'); const before = await stored(); dialog = await palette(ui, pane); await dialog.getByLabel('标注块正文').fill('Canceled'); await dialog.getByRole('button', { name: '取消', exact: true }).click(); expect(await stored()).toBe(before);
  expect(errors).toEqual([]);
});

test('自定义文字颜色底色和边框在所见所得、源码、撤销重做和移除之间保留正文', async ({ page }) => {
  const { ui, pane, editor, stored, errors } = await setup(page); await selectParagraph(page, editor);
  let dialog = await palette(ui, pane); await dialog.getByRole('tab', { name: '文字样式', exact: true }).click();
  await expect(dialog.getByLabel('标记文字', { exact: true })).toHaveValue('A strong baseline needs evidence.');
  await dialog.getByRole('button', { name: '雾蓝', exact: true }).click(); await dialog.getByLabel('文字色值').fill('#155e75'); await dialog.getByLabel('背景色值').fill('#e0f2fe'); await dialog.getByLabel('标记圆角').selectOption('6');
  await page.screenshot({ path: 'shots/note-styles-inline-1440.png' }); await dialog.getByRole('button', { name: '应用标记', exact: true }).click();
  let mark = editor.locator('[data-rw-note-style]'); await expect(mark).toHaveText('A strong baseline needs evidence.'); await expect(mark).toHaveCSS('color', 'rgb(21, 94, 117)'); await expect(mark).toHaveCSS('background-color', 'rgb(224, 242, 254)'); await expect(mark).toHaveCSS('border-top-left-radius', '6px');
  await expect.poll(stored).toContain('background-color:'); expect(await stored()).not.toContain('data-rw-note-style');
  await mark.click(); await page.keyboard.press('End'); await page.keyboard.type(' Updated.'); await expect.poll(stored).toContain('Updated.'); await expect(mark).toHaveCSS('color', 'rgb(21, 94, 117)');
  await page.keyboard.press('Control+z'); await expect(editor).not.toContainText('Updated.'); await page.keyboard.press('Control+y'); await expect(editor).toContainText('Updated.');
  await pane.getByRole('button', { name: 'Markdown 源码', exact: true }).click(); const source = pane.getByLabel('Markdown 正文'); const markdown = await source.inputValue(); expect(markdown).toContain('<span'); expect(markdown).toContain('color:');
  await source.fill(markdown + '\n\n<span style="color:#9e5038;border:1px dashed #9e5038;padding:0 3px;border-radius:3px;">HTML 标记</span>\n\n==原生高亮==\n');
  await pane.getByRole('button', { name: '所见所得编辑', exact: true }).click(); mark = editor.locator('[data-rw-note-style]').filter({ hasText: 'HTML 标记' }); await expect(mark).toHaveCSS('border-top-style', 'dashed'); await expect(editor.locator('mark[data-marker="=="]')).toHaveText('原生高亮');
  await expect(editor.locator('code[data-type=html-inline]')).toHaveCount(0); await mark.click(); dialog = await palette(ui, pane); await expect(dialog.getByLabel('标记文字', { exact: true })).toHaveValue('HTML 标记');
  await dialog.getByRole('button', { name: '移除标记', exact: true }).click(); await expect(editor.locator('[data-rw-note-style]').filter({ hasText: 'HTML 标记' })).toHaveCount(0); await expect(editor).toContainText('HTML 标记');
  await expect(editor).toContainText('Follow-up'); expect(errors).toEqual([]);
});

test('源码中的八种标注块、嵌套格式和 CSS 类可显示并无损编辑', async ({ page }) => {
  const { pane, editor, stored, errors } = await setup(page);
  const markdown = ['important', 'question', 'method', 'conclusion', 'evidence', 'warning', 'idea', 'summary'].map((type, i) => `> [!${type}] 标记 ${i + 1}\n>\n> 保留 **证据** 与研究判断。\n`).join('\n') + '\n<span class="rw-note-inline tone-teal mode-outline">CSS 类标记</span>\n\n```html\n<span style="color:red">字面代码</span>\n```\n';
  await pane.getByRole('button', { name: 'Markdown 源码', exact: true }).click(); await pane.getByLabel('Markdown 正文').fill(markdown); await pane.getByRole('button', { name: '所见所得编辑', exact: true }).click();
  await expect(editor.locator('.callout')).toHaveCount(8); await expect(editor.locator('.callout strong')).toHaveCount(8); await expect(editor.locator('[data-rw-note-style]')).toHaveCSS('border-top-style', 'solid');
  await expect(editor.locator('.callout[data-subtype=important]')).toHaveCSS('border-left-color', 'rgb(189, 145, 72)');
  await expect(editor.locator('.callout[data-subtype=method]')).toHaveCSS('border-left-color', 'rgb(106, 157, 145)');
  await expect(editor.locator('.callout[data-subtype=warning]')).toHaveCSS('border-left-color', 'rgb(198, 136, 112)');
  await expect(editor.locator('pre code').last()).toContainText('<span style="color:red">字面代码</span>');
  await editor.locator('.callout[data-subtype=method] p').last().click(); await page.keyboard.press('End'); await page.keyboard.type(' Added.'); await expect.poll(stored).toContain('Added.');
  await pane.getByRole('button', { name: 'Markdown 源码', exact: true }).click(); const value = await pane.getByLabel('Markdown 正文').inputValue(); expect(value).toContain('tone-teal mode-outline'); expect(value).toContain('**证据**'); expect(value).not.toContain('data-rw-note-style');
  expect(errors).toEqual([]);
});

test('误粘为代码的 Callout 可原位转为标注块，取消和撤销保留原文，支持只有标题', async ({ page }) => {
  const { ui, pane, editor, stored, errors } = await setup(page);
  const original = '# 摘要\n\n```md\n> [!important] 核心结论\n>\n> 保留 **研究依据**，核对模型的临床适用范围。\n```\n\n其余正文。\n\n```python\nprint("keep code")\n```\n';
  await pane.getByRole('button', { name: 'Markdown 源码', exact: true }).click(); await pane.getByLabel('Markdown 正文').fill(original); await pane.getByRole('button', { name: '所见所得编辑', exact: true }).click();
  const code = editor.locator('.vditor-wysiwyg__block[data-type="code-block"]').first(); await expect(code).toContainText('核心结论'); await code.locator('code:visible').first().click();
  let dialog = await palette(ui, pane); await expect(dialog.getByLabel('标注块标题')).toHaveValue('核心结论'); await expect(dialog.getByLabel('标注块正文')).toHaveValue('保留 **研究依据**，核对模型的临床适用范围。');
  await dialog.getByRole('button', { name: '取消', exact: true }).click(); await expect(editor.locator('.callout')).toHaveCount(0); await expect(code).toContainText('核心结论');
  await code.locator('code:visible').first().click(); dialog = await palette(ui, pane); await dialog.getByRole('button', { name: '转为标注块', exact: true }).click();
  const block = editor.locator('blockquote.callout'); await expect(block).toHaveCount(1); await expect(block.locator('strong')).toHaveText('研究依据');
  await expect(block.locator('.callout-info')).toHaveCSS('color', 'rgb(128, 92, 32)'); await expect(block).toHaveCSS('border-left-width', '2px');
  expect(await block.locator('.callout-info').evaluate(el => getComputedStyle(el, '::before').maskImage)).not.toBe('none');
  await expect.poll(stored).not.toContain('```md'); expect(await stored()).toContain('> [!important] 核心结论'); expect(await stored()).toContain('```python'); expect(await stored()).toContain('其余正文');
  await block.locator('p').last().click(); await page.keyboard.press('Control+z'); await expect(editor.locator('.callout')).toHaveCount(0); await expect(editor.locator('pre code').first()).toContainText('[!important]');
  await page.keyboard.press('Control+y'); await expect(editor.locator('.callout')).toHaveCount(1);
  await pane.getByRole('button', { name: 'Markdown 源码', exact: true }).click(); await pane.getByLabel('Markdown 正文').fill('# 摘要\n\n```md\n> [!important] 核心结论\n```\n\n其余正文。\n'); await pane.getByRole('button', { name: '所见所得编辑', exact: true }).click();
  await editor.locator('.vditor-wysiwyg__block[data-type="code-block"] code:visible').first().click(); dialog = await palette(ui, pane); await expect(dialog.getByLabel('标注块正文')).toHaveValue(''); await dialog.getByRole('button', { name: '转为标注块', exact: true }).click();
  await expect(editor.locator('.callout-info')).toHaveText('核心结论', { useInnerText: true }); await expect.poll(stored).toContain('> [!important] 核心结论');
  await pane.getByRole('button', { name: 'Markdown 源码', exact: true }).click(); expect(await pane.getByLabel('Markdown 正文').inputValue()).not.toContain('\u200b'); await pane.getByRole('button', { name: '所见所得编辑', exact: true }).click(); await expect(editor.locator('.callout-info')).toHaveText('核心结论', { useInnerText: true });
  await pane.getByRole('button', { name: 'Markdown 源码', exact: true }).click(); await pane.getByLabel('Markdown 正文').fill('# 阅读与思考\n\n> [!important] 核心结论\n>\n> 保留 **研究依据**，核对模型的临床适用范围。\n\n> [!method-outline] 复现方法\n>\n> 对齐训练设置，记录关键参数与对照实验。\n\n> [!question-soft] 待验证的问题\n>\n> 外部数据上的结果是否一致？\n'); await pane.getByRole('button', { name: '所见所得编辑', exact: true }).click();
  await expect(editor.locator('.callout')).toHaveCount(3);
  for (const width of [1440, 768, 390]) { await page.setViewportSize({ width, height: 1000 }); await page.screenshot({ path: `shots/callout-refined-${width}.png` }); }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const box = await editor.boundingBox(), last = await editor.locator('.callout').last().boundingBox();
  await page.screenshot({ path: 'shots/callout-refined-preview.png', clip: { x: box.x, y: box.y, width: box.width, height: last.y + last.height + 20 - box.y } });
  expect(errors).toEqual([]);
});
