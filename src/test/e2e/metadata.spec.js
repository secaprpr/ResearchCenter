import { test, expect } from '@playwright/test';

function pdf(info = {}, text = 'A document with searchable text') {
  const escape = value => value.replace(/[\\()]/g, '\\$&');
  const stream = `BT /F1 18 Tf 50 760 Td (${escape(text)}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`, `<< ${Object.entries(info).map(([key, value]) => `/${key} (${escape(value)})`).join(' ')} >>`];
  let source = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(source)); source += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(source);
  source += `xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source);
}
async function setup(page) {
  await page.goto('/'); await page.getByRole('button', { name: '文献库', exact: true }).click();
  const ui = page.frameLocator('.port-library-shell iframe'); await expect(ui.locator('#port-status')).toContainText('已就绪');
  return { ui, frame: page.frames().find(frame => frame.url().includes('port.html')) };
}
async function finished(frame) { await expect.poll(() => frame.evaluate(() => window.__researchPort.metadata.state.running)).toBe(false); }
const crossref = (doi, title) => ({ status: 'ok', message: { DOI: doi, title: [title], author: [{ given: 'Alice', family: 'Researcher' }, { given: 'Bob', family: 'Engineer' }], 'container-title': ['Nature Communications'], published: { 'date-parts': [[2025]] }, type: 'journal-article' } });

test('文件名导入后自动提取内嵌标题作者会议年份，并触发 CCF 匹配', async ({ page }) => {
  const { ui, frame } = await setup(page);
  const title = 'Evaluating Long Horizon Memory for Agentic Applications';
  await ui.locator('#port-pdf-input').setInputFiles({ name: 'zhao26bs.pdf', mimeType: 'application/pdf', buffer: pdf({ Title: title, Author: 'Alice Researcher, Bob Engineer', Subject: 'Proceedings of the International Conference on Machine Learning 2026' }) });
  await expect(ui.locator('.rw-paper-title')).toHaveText(title); await finished(frame);
  await expect(ui.locator('.rw-paper-row')).toContainText('ICML');
  await expect(ui.locator('.rw-paper-row')).toContainText('2026');
  await expect(ui.locator('.rw-paper-row .rw-ranks-cell')).toHaveText('CCF A');
  await ui.locator('.rw-paper-row').click();
  await expect(ui.locator('.rw-metadata-result')).toContainText('PDF 内嵌信息');
  await page.reload(); await page.getByRole('button', { name: '文献库', exact: true }).click();
  await expect(ui.locator('.rw-paper-title')).toHaveText(title);
});

test('DOI 自动补全；网络失败保留本地信息，重新解析保留手工值和阅读记录', async ({ page }) => {
  const doi = '10.1234/metadata.2025', title = 'A reliable study of computational pathology';
  let offline = true;
  await page.route('https://api.crossref.org/**', route => offline ? route.abort() : route.fulfill({ json: crossref(doi, title) }));
  const { ui, frame } = await setup(page);
  await ui.locator('#port-pdf-input').setInputFiles({ name: 'metadata.pdf', mimeType: 'application/pdf', buffer: pdf({ Title: title }, `DOI: ${doi}`) });
  await expect(ui.locator('.rw-paper-title')).toHaveText(title); await finished(frame);
  await ui.locator('.rw-paper-row').click();
  await expect(ui.locator('.rw-metadata-result')).toContainText('在线补全失败');
  await frame.evaluate(async () => { const x = window.__researchPort; const paper = x.library.currentModal.papers[0]; await x.app.fileManager.processFrontMatter(paper.file, fm => { fm.status = 'read'; fm.note = 'Keep my research notes'; fm.year = '2024'; fm.metadata_manual_fields = ['year']; }); });
  offline = false;
  await ui.locator('.rw-paper-row').click({ button: 'right' }); await ui.getByRole('menuitem', { name: '重新解析文献信息', exact: true }).click();
  await expect(ui.locator('.rw-paper-row')).toContainText('Nature Communications');
  await expect(ui.locator('.rw-paper-row')).toContainText('2024');
  await expect(ui.locator('.rw-paper-row .rw-state')).toHaveText('已完成');
  await expect(ui.locator('.rw-metadata-result')).toContainText('Crossref');
  const result = await frame.evaluate(() => { const x = window.__researchPort; return { authors: x.library.currentModal.papers[0].authors, note: x.library.currentModal.papers[0].note }; });
  expect(result).toEqual({ authors: ['Alice Researcher', 'Bob Engineer'], note: 'Keep my research notes' });
});

test('arXiv 精确识别；不接受标题近似搜索的无关论文', async ({ page }) => {
  await page.route('https://export.arxiv.org/**', route => route.fulfill({ contentType: 'application/atom+xml', body: '<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2401.12345v1</id><title>An exact preprint title for testing</title><published>2024-01-22T00:00:00Z</published><author><name>Test Researcher</name></author><summary>A preprint abstract</summary></entry></feed>' }));
  await page.route('https://api.crossref.org/**', route => route.fulfill({ json: { message: { items: [crossref('10.9999/unrelated', 'A completely unrelated paper').message] } } }));
  const { ui, frame } = await setup(page);
  await ui.locator('#port-pdf-input').setInputFiles([{ name: '2401.12345.pdf', mimeType: 'application/pdf', buffer: pdf({}, 'arXiv:2401.12345v1') }, { name: 'unmatched.pdf', mimeType: 'application/pdf', buffer: pdf({ Title: 'This local title has no exact match' }, 'No identifier') }]);
  await expect(ui.locator('.rw-paper-row')).toHaveCount(2); await finished(frame);
  await expect(ui.locator('.rw-paper-title').filter({ hasText: 'An exact preprint title for testing' })).toHaveCount(1);
  await expect(ui.locator('.rw-paper-title').filter({ hasText: 'This local title has no exact match' })).toHaveCount(1);
  expect(await ui.locator('.rw-paper-row').allTextContents()).not.toEqual(expect.arrayContaining([expect.stringContaining('completely unrelated')]));
  await expect(ui.locator('.rw-venue-cell').filter({ hasText: 'arXiv' })).toHaveCount(1);
});
