import { test, expect } from '@playwright/test';
import { pdfFixture } from './pdfFixture';

const article = String.raw`# WSI 组成向量

其中，\(n_i\) 表示第 \(i\) 个 HPC 对应的 tile 数量，共 \(47\) 类。

\[ p_i=\frac{n_i}{\sum_{j=1}^{47}n_j} \]

[ \mathbf{p}=(p_1,p_2,\ldots,p_{47}), \quad \sum_{i=1}^{47}p_i=1 ]

\[
\begin{pmatrix} a & b \\ c & d \end{pmatrix}
\]

原生公式 $E=mc^2$ 仍然有效。普通引用 [1] 和括号 (n_i) 保留。

Target.

After.

` + '```latex\n\\(literal_i\\)\n[ \\frac{a}{b} ]\n```\n';

async function setup(page, text = article) {
  const errors = []; page.on('pageerror', error => errors.push(error.message)); await page.route('https://**', route => route.abort());
  await page.goto('/'); await page.getByRole('button', { name: '文献库', exact: true }).click();
  const ui = page.frameLocator('.port-library-shell iframe'); await expect(ui.locator('#port-status')).toContainText('已就绪');
  await ui.locator('#port-pdf-input').setInputFiles({ name: 'Math Study.pdf', mimeType: 'application/pdf', buffer: pdfFixture('Math Study', 2) }); await expect(ui.locator('.rw-paper-row')).toHaveCount(1);
  const frame = page.frames().find(f => f.url().includes('port.html'));
  await frame.evaluate(async text => { const { app, library } = window.__researchPort; const file = library.currentModal.papers[0].file; app.paperNotes.update(file, text); await app.paperNotes.flush(file); }, text);
  await ui.locator('.rw-paper-row').click(); await ui.getByRole('tab', { name: '笔记', exact: true }).click(); await ui.getByRole('button', { name: '展开研究笔记', exact: true }).click();
  const modal = ui.locator('.rw-note-modal'), editor = modal.getByRole('textbox', { name: '研究笔记正文', exact: true }); await expect(editor).toBeVisible();
  const stored = () => frame.evaluate(() => { const { app, library } = window.__researchPort; return app.paperNotes.session(library.currentModal.papers[0].file).base; });
  return { ui, frame, modal, editor, stored, errors };
}

test('截图中的 LaTeX 分隔符、旧方括号公式和矩阵离线渲染，源码导出重载保留代码字面值', async ({ page }) => {
  const { ui, modal, editor, stored, errors } = await setup(page);
  await expect(editor.locator('.katex')).toHaveCount(7); await expect(editor.locator('.katex-display')).toHaveCount(3); await expect(editor.locator('.vditor-reset--error')).toHaveCount(0);
  await expect(editor).toContainText('普通引用 [1] 和括号 (n_i) 保留'); await expect(editor.locator('[data-type=code-block] code').first()).toContainText('\\(literal_i\\)');
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 }); await editor.locator('.katex').first().scrollIntoViewIfNeeded();
    expect(await modal.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true); await page.screenshot({ path: `shots/note-math-${width}.png` });
  }
  await editor.locator('p').filter({ hasText: /^Target\.$/ }).click(); await page.keyboard.press('End'); await page.keyboard.type(' Verified.');
  await editor.press('Control+s'); await expect.poll(stored).toContain('$n_i$');
  await modal.getByRole('button', { name: 'Markdown 源码', exact: true }).click(); const source = modal.getByLabel('Markdown 正文'); await expect(source).toHaveValue(/\$n_i\$/); await expect(source).toHaveValue(/```latex\n\\\(literal_i\\\)/);
  const download = page.waitForEvent('download'); await modal.getByRole('button', { name: '导出 Markdown', exact: true }).click(); const file = await download; const stream = await file.createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk); const exported = Buffer.concat(chunks).toString('utf8');
  expect(exported).toContain('\\sum_{j=1}^{47}'); expect(exported).toContain('\\begin{pmatrix}'); expect(exported).toContain('\\(literal_i\\)');
  await modal.getByRole('button', { name: '关闭弹窗', exact: true }).click(); await page.reload(); await page.getByRole('button', { name: '文献库', exact: true }).click(); await ui.locator('.rw-paper-row').click(); await ui.getByRole('tab', { name: '笔记', exact: true }).click();
  await expect(ui.locator('.rw-paper-detail .katex')).toHaveCount(7); expect(errors).toEqual([]);
});

test('富文本和纯文本粘贴及直接输入都转换 LaTeX，光标后的文字与原有格式保留', async ({ page }) => {
  const { editor, stored, errors } = await setup(page, 'Before.\n\nTarget.\n\nAfter.\n');
  await editor.locator('p').filter({ hasText: /^Target\.$/ }).click(); await page.keyboard.press('Home'); await page.keyboard.press('Shift+End');
  await editor.evaluate(el => { const data = new DataTransfer(); data.setData('text/html', '<p><strong>其中</strong>，\\(n_i\\) 表示数量。</p><p>\\[p_i=\\frac{n_i}{N}\\]</p>'); data.setData('text/plain', '其中，\\(n_i\\) 表示数量。\n\\[p_i=\\frac{n_i}{N}\\]'); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); });
  await expect(editor.locator('.katex')).toHaveCount(2); await expect(editor.locator('strong')).toHaveText('其中');
  await editor.locator('p').filter({ hasText: /^After\.$/ }).click(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('Live \\(x_i\\) continued.');
  await expect(editor.locator('.katex')).toHaveCount(3); await expect(editor).toContainText('continued.');
  await page.keyboard.press('Enter'); await editor.evaluate(el => { const data = new DataTransfer(); data.setData('text/plain', '\\[y=\\sum_{i=1}^{n}x_i\\]'); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); });
  await expect(editor.locator('.katex')).toHaveCount(4); await editor.press('Control+s'); await expect.poll(stored).toContain('$x_i$'); expect(await stored()).toContain('**其中**'); expect(await stored()).toContain('Before.'); expect(errors).toEqual([]);
});

test('公式弹窗接受完整分隔符并在选择位置插入，可编辑和撤销且不污染相邻正文', async ({ page }) => {
  const { ui, modal, editor, stored, errors } = await setup(page, 'Before.\n\nTarget.\n\nAfter.\n');
  await editor.locator('p').filter({ hasText: /^Target\.$/ }).click(); await page.keyboard.press('Home'); await page.keyboard.press('Shift+End');
  await modal.getByRole('button', { name: '插入数学公式', exact: true }).click(); const dialog = ui.locator('.modal').filter({ has: ui.getByLabel('LaTeX 公式', { exact: true }) }); await dialog.getByLabel('LaTeX 公式').fill('\\[ p_i=\\frac{n_i}{N} \\]'); await dialog.getByRole('button', { name: '插入公式', exact: true }).click();
  await expect(editor.locator('.katex')).toHaveCount(1); await expect(editor.locator('.vditor-reset--error')).toHaveCount(0); await editor.press('Control+s'); await expect.poll(stored).toContain('p_i=\\frac{n_i}{N}');
  expect((await stored()).indexOf('p_i=')).toBeLessThan((await stored()).indexOf('After.')); expect(await stored()).toContain('Before.'); expect(await stored()).not.toContain('\\['); expect(errors).toEqual([]);
  await editor.press('Control+z'); await expect(editor.locator('.katex')).toHaveCount(0); await expect(editor).toContainText('Target.');
  await editor.press('Control+y'); await expect(editor.locator('.katex')).toHaveCount(1);
  await editor.locator('.language-math').click(); const code = editor.locator('code[data-type=math-block]'); await expect(code).toBeVisible(); await code.fill('p_i=\\frac{2n_i}{N}');
  await editor.locator('p').filter({ hasText: /^After\.$/ }).click(); await editor.press('Control+s'); await expect.poll(stored).toContain('p_i=\\frac{2n_i}{N}'); await expect(editor.locator('.katex')).toHaveCount(1); expect(errors).toEqual([]);
});

test('含公式的窄详情侧栏自动滚动时，正斜杠菜单仍跟随光标并可插入', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 }); const { ui, modal, errors } = await setup(page);
  await modal.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  const editor = ui.locator('.rw-paper-detail').getByRole('textbox', { name: '研究笔记正文', exact: true });
  await editor.locator('p').filter({ hasText: /^Target\.$/ }).click(); await page.keyboard.press('Home'); await page.keyboard.press('Shift+End'); await page.keyboard.type('/method');
  const menu = ui.getByRole('listbox', { name: '插入内容', exact: true }); await expect(menu.getByRole('option', { name: '方法', exact: true })).toBeVisible();
  await editor.evaluate(el => el.closest('.vditor-wysiwyg').dispatchEvent(new Event('scroll', { bubbles: true }))); await expect(menu).toBeVisible();
  await page.keyboard.press('Enter'); await page.keyboard.type('Native sidebar evidence.'); await expect(editor.locator('.callout')).toContainText('Native sidebar evidence.'); expect(errors).toEqual([]);
});
