import { test, expect } from '@playwright/test';
import { pdfFixture, multiPagePdfFixture } from './pdfFixture';

const first = { name: 'Supplementary Information.pdf', mimeType: 'application/pdf', buffer: multiPagePdfFixture('Supplementary evidence', 2) };
const second = { name: 'Supplementary Methods.pdf', mimeType: 'application/pdf', buffer: pdfFixture('Supplementary methods') };
const data = { name: 'Source Data.csv', mimeType: 'text/csv', buffer: Buffer.from('group,value\nA,0.81\nB,0.93\n') };
async function setup(page) {
  const errors = []; page.on('pageerror', error => errors.push(error.message)); await page.route('https://**', route => route.abort());
  await page.goto('/'); await page.getByRole('button', { name: '文献库', exact: true }).click();
  const ui = page.frameLocator('.port-library-shell iframe'); await expect(ui.locator('#port-status')).toContainText('已就绪');
  await ui.locator('#port-pdf-input').setInputFiles({ name: 'Journal Study.pdf', mimeType: 'application/pdf', buffer: pdfFixture('Primary evidence') }); await expect(ui.locator('.rw-paper-row')).toHaveCount(1);
  await ui.locator('.rw-paper-row').click(); await ui.getByRole('tab', { name: /^附录/ }).click();
  const frame = page.frames().find(f => f.url().includes('port.html'));
  return { ui, frame, errors, panel: ui.getByRole('region', { name: '论文附录', exact: true }) };
}
async function add(panel, files, count) { await panel.getByLabel('添加附录文件', { exact: true }).setInputFiles(files); await expect(panel.locator('.rw-supplement-item')).toHaveCount(count + 1); await expect(panel).toHaveAttribute('aria-busy', 'false'); }
async function menu(ui, panel, name, action) { await panel.getByRole('button', { name: '附件菜单：' + name, exact: true }).click(); await ui.getByRole('menuitem', { name: action, exact: true }).click(); }

test('一篇论文管理多份附录，去重、编辑、排序、下载、移除与重启持久化', async ({ page }) => {
  const { ui, frame, panel, errors } = await setup(page);
  await add(panel, [first, second, data, { ...first, name: 'Same Contents.pdf' }, { name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('invalid') }], 3);
  await expect(ui.locator('.rw-paper-row')).toHaveCount(1); await expect(ui.locator('#notices')).toContainText('1 份已存在'); await expect(ui.locator('#notices')).toContainText('不是有效的 PDF');
  await menu(ui, panel, second.name, '编辑名称与类型');
  const edit = ui.getByRole('dialog', { name: '编辑附录', exact: true }); await edit.getByLabel('附录名称').fill('统计模型与敏感性分析'); await edit.getByLabel('附录类型').selectOption('methods'); await edit.getByRole('button', { name: '保存', exact: true }).click(); await expect(edit).toHaveCount(0);
  await menu(ui, panel, '统计模型与敏感性分析', '上移');
  await expect(panel.locator('.rw-supplement-open strong')).toHaveText(['正文', '统计模型与敏感性分析', first.name, data.name]);
  const download = page.waitForEvent('download'); await panel.getByRole('button', { name: '下载附录：' + data.name, exact: true }).click(); const downloaded = await download; expect(downloaded.suggestedFilename()).toBe(data.name);
  const stream = await downloaded.createReadStream(), chunks = []; for await (const chunk of stream) chunks.push(chunk); expect(Buffer.concat(chunks)).toEqual(data.buffer);
  await ui.getByRole('button', { name: '展开附件：Journal Study', exact: true }).click(); await expect(ui.locator('.rw-attachment-row')).toHaveCount(4); await expect(ui.locator('.rw-attachment-row')).toContainText(['PDF 附件', '统计模型与敏感性分析', first.name, data.name]);
  const original = await frame.evaluate(() => { const x = window.__researchPort, paper = x.library.currentModal.papers[0]; return { primary: paper.pdf, dataPath: x.app.paperAttachments.list(paper.file).find(item => item.filename.endsWith('.csv')).path }; });
  await menu(ui, panel, data.name, '移除关联'); await expect(panel.locator('.rw-supplement-item')).toHaveCount(3);
  expect(await frame.evaluate(path => !!window.__researchPort.vault.getAbstractFileByPath(path), original.dataPath)).toBe(true);
  await add(panel, [{ ...first, name: 'Another duplicate.pdf' }], 2); await expect(panel.locator('.rw-supplement-open strong')).toHaveText(['正文', '统计模型与敏感性分析', first.name]);
  await page.reload(); await page.getByRole('button', { name: '文献库', exact: true }).click(); await ui.locator('.rw-paper-row').click(); await ui.getByRole('tab', { name: /^附录/ }).click();
  await expect(panel.locator('.rw-supplement-open strong')).toHaveText(['正文', '统计模型与敏感性分析', first.name]);
  expect(await page.frames().find(f => f.url().includes('port.html')).evaluate(() => window.__researchPort.library.currentModal.papers[0].pdf)).toBe(original.primary);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 }); await expect(panel.getByRole('button', { name: '添加附录', exact: true })).toBeInViewport();
    await page.screenshot({ path: `shots/attachments-${width}.png` });
  }
  expect(errors).toEqual([]);
});

test('附录沿用 PDF 阅读与标注，正文和附录记录分开，并关联同一研究笔记', async ({ page }) => {
  const { ui, frame, panel, errors } = await setup(page); await add(panel, [first, second], 2);
  await frame.evaluate(async () => { const x = window.__researchPort; await x.app.fileManager.processFrontMatter(x.library.currentModal.papers[0].file, fm => { fm.status = 'read'; }); });
  await panel.getByRole('button', { name: '阅读附录：' + first.name, exact: true }).click(); await expect(ui.locator('.mupdf-reader-status')).toContainText('2 页'); await expect(ui.locator('#reader-file-name')).toContainText(first.name);
  await expect(ui.getByRole('button', { name: '阅读器阅读状态', exact: true })).toContainText('已完成');
  const paths = await frame.evaluate(async () => {
    const x = window.__researchPort, paper = x.library.currentModal.papers[0], path = x.app.workspace.getActiveFile().path, engine = x.app.workspace.mainLeaf.view.reader;
    await x.reader.addAnnotation(path, { id: 'supplement-note', type: 'note', page: 1, text: '', comment: '附录中的统计模型', tags: ['补充方法'], quads: [], x: 80, y: 100, color: 'yellow', createdAt: Date.now(), updatedAt: Date.now() });
    const rect = [40, 20, 350, 90], preview = await engine.renderRegionPreview(0, rect);
    await x.reader.addAnnotation(path, { id: 'supplement-region', type: 'region', page: 0, rect, quads: [], text: '', comment: '附录方法图', tags: [], color: 'blue', previewDataUrl: preview.dataUrl, previewWidth: preview.width, previewHeight: preview.height, previewVersion: preview.previewVersion });
    await x.reader.addAnnotation(path, { id: 'supplement-highlight', type: 'highlight', page: 0, text: 'Supporting evidence', comment: '附录证据高亮', tags: [], quads: [[50, 20, 250, 20, 50, 38, 250, 38]], color: 'yellow', createdAt: Date.now(), updatedAt: Date.now() });
    return { primary: x.library.currentModal.resolveVaultFile(paper.pdf, paper.file.path).path, supplement: path };
  });
  await ui.getByRole('button', { name: '打开研究笔记', exact: true }).click(); const notes = ui.locator('#paper-notes-pane');
  await notes.getByRole('button', { name: 'Markdown 源码', exact: true }).click(); await notes.getByLabel('Markdown 正文').fill('# 论文研究笔记\n\n附录补充了敏感性分析。'); await notes.getByLabel('Markdown 正文').press('Control+s');
  await ui.locator('.mupdf-reader-page-input').fill('2'); await ui.locator('.mupdf-reader-page-input').press('Enter');
  await expect.poll(() => frame.evaluate(path => window.__researchPort.reader.getReadingPosition(path)?.page, paths.supplement)).toBe(1);
  await ui.getByRole('button', { name: '切换正文与附录', exact: true }).click(); await ui.getByRole('menuitemcheckbox', { name: '正文', exact: true }).click();
  await expect.poll(() => frame.evaluate(() => window.__researchPort.app.workspace.getActiveFile().path)).toBe(paths.primary); await expect(ui.locator('.mupdf-reader-status')).toContainText('1 页');
  expect(await frame.evaluate(path => window.__researchPort.reader.getAnnotationsForFile(path).length, paths.primary)).toBe(0);
  await expect(notes.getByLabel('Markdown 正文')).toHaveValue('# 论文研究笔记\n\n附录补充了敏感性分析。');
  await ui.getByRole('button', { name: '切换正文与附录', exact: true }).click(); await ui.getByRole('menuitemcheckbox', { name: first.name, exact: true }).click();
  await expect.poll(() => frame.evaluate(() => window.__researchPort.app.workspace.getActiveFile().path)).toBe(paths.supplement); await expect(ui.locator('.mupdf-reader-status')).toContainText('2 页');
  await expect(ui.locator('.mupdf-reader-page-input')).toHaveValue('2');
  expect(await frame.evaluate(path => window.__researchPort.reader.getAnnotationsForFile(path).length, paths.supplement)).toBe(3);
  const counts = await frame.evaluate(paths => { const x = window.__researchPort; return { primary: x.activity.get(paths.primary)?.pageCount, supplement: x.activity.get(paths.supplement)?.pageCount }; }, paths); expect(counts).toEqual({ primary: 1, supplement: 2 });
  await expect.poll(() => ui.locator('.mupdf-reader-canvas').first().evaluate(canvas => canvas.width)).toBeGreaterThan(8);
  await page.screenshot({ path: 'shots/attachments-reader.png' });
  await ui.locator('#reader-back').click(); await ui.getByRole('tab', { name: /^摘录/ }).click(); await expect(ui.locator('.rw-annotation')).toHaveCount(3); await expect(ui.locator('.rw-annotation')).toContainText(['附录中的统计模型', '附录方法图', '附录证据高亮']); await expect(ui.locator('.rw-annotation-page').first()).toContainText(first.name);
  await ui.getByRole('tab', { name: '图表摘录', exact: true }).click(); await expect(ui.locator('.rw-figure')).toHaveCount(1);
  await page.reload(); await page.getByRole('button', { name: '文献库', exact: true }).click();
  await expect(ui.locator('#port-status')).toContainText('已就绪');
  const persisted = await page.frames().find(f => f.url().includes('port.html')).evaluate(paths => { const x = window.__researchPort; return { main: x.reader.getAnnotationsForFile(paths.primary).length, supplement: x.reader.getAnnotationsForFile(paths.supplement).length, owner: x.app.paperAttachments.owner(paths.supplement)?.title }; }, paths);
  expect(persisted).toEqual({ main: 0, supplement: 3, owner: 'Journal Study' }); expect(errors).toEqual([]);
});

test('附录区域拖入文件归属当前论文，右键入口与阅读器管理保持一致', async ({ page }) => {
  const { ui, frame, panel, errors } = await setup(page);
  const transfer = await frame.evaluateHandle(bytes => { const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], 'Dropped Supplement.pdf', { type: 'application/pdf' })); return data; }, [...first.buffer]);
  await panel.dispatchEvent('dragenter', { dataTransfer: transfer }); await panel.dispatchEvent('dragover', { dataTransfer: transfer }); await panel.dispatchEvent('drop', { dataTransfer: transfer });
  await expect(panel.locator('.rw-supplement-item')).toHaveCount(2); await expect(panel).toHaveAttribute('aria-busy', 'false'); await expect(ui.locator('.rw-paper-row')).toHaveCount(1); await expect(ui.locator('.rw-drop-overlay')).toHaveCount(0);
  await ui.getByRole('tab', { name: '信息', exact: true }).click(); await ui.locator('.rw-paper-row').click({ button: 'right' }); await ui.getByRole('menuitem', { name: '管理附录', exact: true }).click(); await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: '阅读正文：Journal Study', exact: true }).click(); await expect(ui.locator('.mupdf-reader-status')).toContainText('1 页');
  await ui.getByRole('button', { name: '切换正文与附录', exact: true }).click(); await ui.getByRole('menuitem', { name: '管理附录', exact: true }).click();
  const manage = ui.getByRole('dialog', { name: '论文附录', exact: true }); await expect(manage).toBeVisible(); await expect(manage.locator('.rw-supplement-item')).toHaveCount(2);
  await manage.getByLabel('添加附录文件', { exact: true }).setInputFiles(second); await expect(manage.locator('.rw-supplement-item')).toHaveCount(3); await manage.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await ui.getByRole('button', { name: '切换正文与附录', exact: true }).click(); await expect(ui.getByRole('menuitemcheckbox', { name: second.name, exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
