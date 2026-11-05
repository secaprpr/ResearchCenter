import { test, expect } from '@playwright/test';
import { pdfFixture } from './pdfFixture';

async function setup(page, markdown) {
  const errors = []; page.on('pageerror', error => errors.push(error.message)); await page.route('https://**', route => route.abort());
  await page.goto('/'); await page.getByRole('button', { name: '文献库', exact: true }).click();
  const ui = page.frameLocator('.port-library-shell iframe'); await expect(ui.locator('#port-status')).toContainText('已就绪');
  await ui.locator('#port-pdf-input').setInputFiles({ name: 'Input Study.pdf', mimeType: 'application/pdf', buffer: pdfFixture('Synthetic input study') });
  await expect(ui.locator('.rw-paper-row')).toHaveCount(1);
  const frame = page.frames().find(f => f.url().includes('port.html'));
  await frame.evaluate(async text => { const { app, library } = window.__researchPort; const file = library.currentModal.papers[0].file; app.paperNotes.update(file, text); await app.paperNotes.flush(file); }, markdown);
  await ui.locator('.rw-paper-row').click(); await ui.getByRole('tab', { name: '笔记', exact: true }).click();
  await expect(ui.getByRole('textbox', { name: '研究笔记正文', exact: true })).toBeVisible();
  await frame.evaluate(() => { const create = window.Lute.New; window.Lute.New = (...args) => { const lute = create(...args); window.__inputTestLute = lute; return lute; }; });
  await ui.getByRole('button', { name: '展开研究笔记', exact: true }).click();
  const modal = ui.locator('.rw-note-modal'), editor = modal.getByRole('textbox', { name: '研究笔记正文', exact: true }); await expect(editor).toBeVisible();
  const stored = () => frame.evaluate(() => { const { app, library } = window.__researchPort; return app.paperNotes.session(library.currentModal.papers[0].file).base; });
  return { ui, frame, modal, editor, stored, errors };
}

test('长笔记连续输入不逐键转换全文，关闭写作窗口立即保存并同步详情', async ({ page }) => {
  const markdown = '# Long note\n\n' + Array.from({ length: 70 }, (_, i) => `## Experiment ${i}\n\n` + '保留研究依据，比较 **实验结果** 与方法细节。 '.repeat(10) + '\n\n').join('') + 'Typing target.\n';
  const { ui, frame, modal, editor, stored, errors } = await setup(page, markdown);
  await editor.locator('p').last().click(); await page.keyboard.press('End');
  await frame.evaluate(() => { const lute = window.__inputTestLute, serialize = lute.VditorDOM2Md; window.__inputSerializations = 0; lute.VditorDOM2Md = (...args) => { window.__inputSerializations++; return serialize(...args); }; });
  const text = 'abcdefghijklmnopqrstuvwxyz'; await page.keyboard.type(text);
  const conversions = await frame.evaluate(() => window.__inputSerializations);
  expect(conversions).toBeLessThan(text.length / 2);
  await modal.getByRole('button', { name: '关闭弹窗', exact: true }).click(); await expect(modal).toHaveCount(0);
  await expect.poll(stored).toContain('Typing target.' + text);
  await expect(ui.locator('.rw-paper-detail').getByRole('textbox', { name: '研究笔记正文', exact: true })).toContainText(text);
  await page.reload(); await page.getByRole('button', { name: '文献库', exact: true }).click(); await ui.locator('.rw-paper-row').click(); await ui.getByRole('tab', { name: '笔记', exact: true }).click();
  await expect(ui.getByRole('textbox', { name: '研究笔记正文', exact: true })).toContainText(text); expect(errors).toEqual([]);
});

test('中文输入法候选期间不转换全文，提交后保留文字，退出检查捕获最后输入', async ({ page }) => {
  const { ui, frame, modal, editor, stored, errors } = await setup(page, '# IME note\n\n中文输入：\n');
  await editor.locator('p').last().click(); await page.keyboard.press('End');
  await frame.evaluate(() => { const lute = window.__inputTestLute, serialize = lute.VditorDOM2Md; window.__inputSerializations = 0; lute.VditorDOM2Md = (...args) => { window.__inputSerializations++; return serialize(...args); }; });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'yan', selectionStart: 3, selectionEnd: 3 });
  await cdp.send('Input.imeSetComposition', { text: '研究', selectionStart: 2, selectionEnd: 2 });
  await page.waitForTimeout(1100); // Crosses the draft maximum wait while the IME is composing.
  expect(await frame.evaluate(() => window.__inputSerializations)).toBe(0);
  await cdp.send('Input.insertText', { text: '研究' }); await expect(editor).toContainText('中文输入：研究');
  await expect.poll(stored).toContain('中文输入：研究');
  const draft = await frame.evaluate(() => {
    document.execCommand('insertText', false, '最终输入');
    const { app, library } = window.__researchPort, file = library.currentModal.papers[0].file;
    const pending = app.paperNotes.hasUnsaved();
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event);
    return { pending, prevented: event.defaultPrevented, text: JSON.parse(localStorage.getItem('research-note-draft:' + file.path)).text };
  });
  expect(draft.pending).toBe(true); expect(draft.prevented).toBe(true); expect(draft.text).toContain('研究最终输入');
  await modal.getByRole('button', { name: '关闭弹窗', exact: true }).click(); await expect.poll(stored).toContain('研究最终输入');
  await ui.getByRole('button', { name: 'Markdown 源码', exact: true }).click();
  await ui.getByLabel('Markdown 正文').fill('# Source\n\n最终源码。'); await ui.getByLabel('Markdown 正文').press('Control+s');
  await expect.poll(() => frame.evaluate(() => window.__researchPort.app.paperNotes.hasUnsaved())).toBe(false);
  expect(errors).toEqual([]);
});
