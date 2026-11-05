/** Audit the built UI in isolated browser storage. Never opens the user's vault.
 * Checks relationships between roles, not a snapshot of individual CSS rules. */
import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pdfFixture } from '../src/test/e2e/pdfFixture.ts';

const out = resolve('.taste-skill/ui-consistency');
await mkdir(out, { recursive: true });
const server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
const browser = await chromium.launch();
const report = { checks: [], issues: [], screenshots: [] };
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(12000);
await page.route('https://**', route => route.abort());
page.on('pageerror', error => report.issues.push(`Runtime: ${error.message}`));
const ui = page.frameLocator('.port-library-shell iframe');
let base, action;
const fields = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight'];
async function style(locator) {
  return locator.evaluate(el => {
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    return Object.fromEntries(['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'borderRadius', 'color', 'backgroundColor'].map(key => [key, s[key]]).concat([['height', r.height], ['width', r.width]]));
  });
}
async function sameRole(name, locator, reference, properties = fields) {
  await expect(locator).toBeVisible();
  const actual = await style(locator);
  report.checks.push({ name, actual });
  for (const key of properties) if (actual[key] !== reference[key]) report.issues.push(`${name}: ${key} ${actual[key]} != ${reference[key]}`);
}
async function shot(name) {
  const file = `${name}.png`; await page.screenshot({ path: resolve(out, file) }); report.screenshots.push(file);
}
async function bounds(name, locator) {
  const fits = await locator.evaluate(el => { const r = el.getBoundingClientRect(); return r.x >= -1 && r.y >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; });
  if (!fits) report.issues.push(`${name}: outside viewport`);
}
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.getByRole('button', { name: '文献库', exact: true }).click();
  await expect(ui.locator('#port-status')).toContainText('已就绪');
  await ui.locator('#port-pdf-input').setInputFiles(['A', 'B', 'C'].map(name => ({ name: `Research interface ${name}.pdf`, mimeType: 'application/pdf', buffer: pdfFixture(`Research evidence workflow ${name}`) })));
  await expect(ui.locator('.rw-paper-row')).toHaveCount(3);
  const fixtureFrame = page.frames().find(f => f.url().includes('port.html'));
  await fixtureFrame.evaluate(async () => {
    const { app, library } = window.__researchPort;
    for (const [index, paper] of [...library.currentModal.papers].entries()) {
      await app.fileManager.processFrontMatter(paper.file, fm => {
        fm.status = ['read', 'reading', 'inbox'][index];
        fm.year = [2026, 2019, ''][index];
        fm.jcr_quartile = 'Q1'; fm.cas_zone = '医学1区'; fm.ccf_rank = 'A';
        fm.keywords = ['早期食管癌', '基础模型', '预训练', '方法', '复现'];
        fm.note = ['核对外部验证结果 [重点]{红}', '精读模型解释部分', '补充对照实验'][index];
      });
    }
  });
  await expect(ui.locator('.rw-paper-row .state-read')).toHaveCount(1);
  await expect(ui.locator('.rw-paper-row .kind-rank')).toHaveCount(9);
  base = await style(ui.locator('body')); action = await style(ui.locator('.rw-library-header .rw-primary'));
  report.base = base; report.action = action;
  for (const state of ['read', 'reading', 'inbox']) await sameRole(`Row status ${state}`, ui.locator(`.rw-paper-row .state-${state} .rw-state`), base);
  await sameRole('Row journal ranking', ui.locator('.rw-paper-row .kind-rank').first(), base);
  await sameRole('Row research tag', ui.locator('.rw-paper-row .kind-topic').first(), base);
  await sameRole('Row extra tag count', ui.locator('.rw-paper-row .rw-badge-more').first(), base);
  const remark = ui.locator('.rw-paper-row .rw-remark').first();
  await sameRole('Row remark typography', remark, await style(ui.locator('.rw-paper-row .rw-author-cell').first()));
  await sameRole('Remark capsule typography', ui.locator('.rw-remark-pill > span').first(), base);
  await remark.click(); await sameRole('Inline remark editor typography', ui.locator('.rw-remark-input'), base); await ui.locator('.rw-remark-input').press('Escape');
  await ui.locator('.rw-table-scroll').evaluate(el => { el.scrollLeft = el.scrollWidth; });
  await shot('1440-row-labels');
  await ui.locator('.rw-table-scroll').evaluate(el => { el.scrollLeft = 0; });
  await ui.getByRole('button', { name: '按标题排序', exact: true }).click();
  await expect(ui.locator('th.rw-title-cell')).toHaveAttribute('aria-sort', 'ascending');
  await page.mouse.move(280, 90);
  const headerStyle = await style(ui.locator('th.rw-title-cell'));
  const headings = ui.locator('.rw-paper-table th > .rw-column-heading');
  for (let index = 0; index < await headings.count(); index++) {
    await sameRole(`Column heading ${index + 1}`, headings.nth(index), base);
    await sameRole(`Column header surface ${index + 1}`, ui.locator('.rw-paper-table th').nth(index), headerStyle, ['backgroundColor', 'color', 'height']);
  }
  const yearOffsets = await ui.locator('.rw-paper-table').evaluate(table => {
    const start = table.querySelector('th.rw-year-cell .rw-column-label').getBoundingClientRect().left;
    return [...table.querySelectorAll('tbody .rw-paper-row > .rw-year-cell')].map(cell => {
      const range = document.createRange(); range.selectNodeContents(cell);
      return { text: cell.textContent, offset: range.getBoundingClientRect().left - start };
    });
  });
  report.checks.push({ name: 'Year values and missing markers align with heading', actual: yearOffsets });
  if (yearOffsets.some(item => Math.abs(item.offset) > 1)) report.issues.push('Year text does not align with its column heading');
  await shot('1440-sorted-header');
  await sameRole('Library secondary action', ui.locator('.rw-library-header .rw-new-collection'), action, [...fields, 'height', 'borderRadius']);
  await sameRole('Library filter', ui.getByRole('button', { name: '筛选', exact: true }), action, [...fields, 'height', 'borderRadius']);
  await ui.locator('.rw-paper-title').first().click();
  const small = await style(ui.locator('.rw-detail-tabs > button').first());
  await sameRole('Read PDF action', ui.getByRole('button', { name: '阅读 PDF', exact: true }), action, [...fields, 'height', 'borderRadius']);
  const detailRemark = ui.locator('.rw-detail-remark .rw-remark');
  await sameRole('Detail remark text', detailRemark, base, ['fontFamily', 'fontSize', 'fontWeight']);
  await detailRemark.click();
  await sameRole('Detail remark editor', ui.locator('.rw-detail-remark-input'), base, ['fontFamily', 'fontSize', 'fontWeight']);
  await ui.locator('.rw-detail-remark-input').press('Escape');
  await sameRole('Status pill', ui.locator('.rw-paper-detail .rw-status-pill'), base);
  await sameRole('Library tab', ui.getByRole('tab', { name: '文献', exact: true }), small, ['fontFamily', 'fontSize']);
  await shot('1440-library');

  // A matching computed font alone misses filtered hover layers on Windows.
  // Check normal/selected/hovered rows and ensure feedback only changes the fill.
  for (const state of ['read', 'reading', 'inbox']) {
    const row = ui.locator('.rw-paper-row').filter({ has: ui.locator(`.rw-status-pill.state-${state}`) });
    await row.locator('.rw-year-cell').click();
    await expect(row).toHaveClass(/is-active/);
    const pill = row.locator('.rw-status-pill'), text = pill.locator('.rw-state');
    await pill.scrollIntoViewIfNeeded(); await page.mouse.move(10, 10);
    const normal = await style(pill);
    await sameRole(`Selected row status ${state}`, text, base);
    await pill.hover();
    await expect.poll(async () => (await style(pill)).backgroundColor).not.toBe(normal.backgroundColor);
    await sameRole(`Hovered selected row status ${state}`, text, base);
    const feedback = await pill.evaluate(el => {
      const s = getComputedStyle(el);
      return { filter: s.filter, color: s.color, textShadow: s.textShadow };
    });
    report.checks.push({ name: `Status ${state} hover preserves text rendering`, actual: feedback });
    if (feedback.filter !== 'none' || feedback.color !== normal.color || feedback.textShadow !== 'none') report.issues.push(`Status ${state}: hover changes text rendering`);
    await shot(`1440-status-${state}-hover`);
  }
  await page.mouse.move(10, 10);
  await ui.locator('.rw-table-scroll').evaluate(el => { el.scrollLeft = 0; });
  await ui.locator('.rw-paper-title').first().click();

  await ui.locator('.rw-new-collection').click();
  await sameRole('Create collection action', ui.getByRole('button', { name: '创建文献集', exact: true }), action, [...fields, 'height', 'borderRadius']);
  const dialogTitle = await style(ui.locator('.modal-title'));
  await sameRole('Collection input', ui.getByLabel('文献集名称', { exact: true }), base, ['fontFamily', 'fontSize', 'lineHeight']);
  await shot('1440-collection-dialog'); await ui.getByRole('button', { name: '关闭弹窗', exact: true }).click();

  await ui.locator('.rw-paper-tags .rw-section-heading button').click();
  await sameRole('Tag editor save action', ui.getByRole('button', { name: '保存标签', exact: true }), action, [...fields, 'height', 'borderRadius']);
  await sameRole('Tag editor title', ui.locator('.modal-title'), dialogTitle);
  await sameRole('Editable tag chip', ui.locator('.rw-tags-modal .rw-editable-tag').first(), base);
  await shot('1440-tags-dialog'); await page.keyboard.press('Escape');

  await ui.getByRole('tab', { name: '笔记', exact: true }).click();
  await expect(ui.getByRole('textbox', { name: '研究笔记正文', exact: true })).toBeVisible();
  await sameRole('Research note controls', ui.getByRole('button', { name: 'Markdown 源码', exact: true }), base, ['fontFamily', 'fontSize', 'lineHeight']);
  const noteControl = await style(ui.getByRole('button', { name: 'Markdown 源码', exact: true }));
  await sameRole('Note/PDF location action', ui.getByRole('button', { name: '笔记与论文定位', exact: true }), noteControl, [...fields, 'height', 'width', 'borderRadius']);
  await sameRole('Note/PDF follow toggle', ui.getByRole('button', { name: '滚动联动', exact: true }), noteControl, [...fields, 'height', 'width', 'borderRadius']);
  await sameRole('Research note body family', ui.getByRole('textbox', { name: '研究笔记正文', exact: true }), base, ['fontFamily']);
  await ui.getByRole('button', { name: '展开研究笔记', exact: true }).click();
  await sameRole('Research note modal title', ui.locator('.rw-note-modal > .modal-title'), dialogTitle);
  await sameRole('Research note modal controls', ui.locator('.rw-note-modal').getByRole('button', { name: '导出 Markdown', exact: true }), await style(ui.getByRole('button', { name: '展开研究笔记', exact: true })), [...fields, 'height', 'borderRadius']);
  await shot('1440-research-note-editor');
  const commandEditor = ui.locator('.rw-note-modal').getByRole('textbox', { name: '研究笔记正文', exact: true });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await commandEditor.click(); await commandEditor.press('Control+End'); await commandEditor.press('Enter'); await page.keyboard.type('\\');
    const menu = ui.getByRole('listbox', { name: '插入内容', exact: true });
    await sameRole(`Note command option ${width}`, menu.getByRole('option', { name: '正文', exact: true }), base);
    await bounds(`Note command menu ${width}`, menu); await shot(`${width}-note-command-menu`);
    await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0);
  }
  await page.setViewportSize({ width: 1440, height: 900 }); await ui.locator('.rw-note-modal .modal-close-button').click();

  await ui.getByRole('tab', { name: /^附录/ }).click();
  const attachmentPanel = ui.getByRole('region', { name: '论文附录', exact: true });
  await attachmentPanel.getByLabel('添加附录文件', { exact: true }).setInputFiles({ name: 'Supplementary Methods.pdf', mimeType: 'application/pdf', buffer: pdfFixture('Reproduction settings and supporting evidence') });
  await expect(attachmentPanel.locator('.rw-supplement-item')).toHaveCount(2);
  await sameRole('Attachment add action', attachmentPanel.getByRole('button', { name: '添加附录', exact: true }), action, [...fields, 'height', 'borderRadius']);
  await sameRole('Attachment title text', attachmentPanel.locator('.rw-supplement-open strong').last(), base, ['fontFamily', 'fontSize', 'lineHeight']);
  await shot('1440-supplementary-files');
  await attachmentPanel.getByRole('button', { name: '附件菜单：Supplementary Methods.pdf', exact: true }).click();
  await sameRole('Attachment menu option', ui.getByRole('menuitem', { name: '编辑名称与类型', exact: true }), base);
  await ui.getByRole('menuitem', { name: '编辑名称与类型', exact: true }).click();
  await sameRole('Attachment editor title', ui.locator('.rw-attachment-edit-modal .modal-title'), dialogTitle);
  await sameRole('Attachment name input', ui.getByLabel('附录名称', { exact: true }), base, ['fontFamily', 'fontSize', 'lineHeight']);
  await sameRole('Attachment save action', ui.locator('.rw-attachment-edit-modal').getByRole('button', { name: '保存', exact: true }), action, [...fields, 'height', 'borderRadius']);
  await shot('1440-supplementary-editor'); await ui.locator('.rw-attachment-edit-modal .modal-close-button').click();
  await ui.getByRole('tab', { name: '信息', exact: true }).click();

  await ui.locator('.rw-paper-title').first().click({ button: 'right' });
  await sameRole('Context menu option', ui.getByRole('menuitem', { name: '编辑文献信息', exact: true }), base);
  await ui.getByRole('menuitem', { name: '编辑文献信息', exact: true }).click();
  await sameRole('Metadata save action', ui.getByRole('button', { name: '保存修改', exact: true }), action, [...fields, 'height', 'borderRadius']);
  await sameRole('Metadata title', ui.locator('.rw-edit-title h2'), dialogTitle);
  await shot('1440-metadata-dialog'); await ui.getByRole('button', { name: '关闭编辑', exact: true }).click();

  await ui.getByRole('button', { name: '选择显示列', exact: true }).click();
  await sameRole('Column menu option', ui.locator('.rw-column-menu > button').first(), base);
  const columnMenu = await style(ui.locator('.rw-column-menu'));
  await shot('1440-column-menu'); await page.keyboard.press('Escape');
  await ui.locator('.rw-paper-detail .rw-status-pill').click();
  await sameRole('Status menu option', ui.getByRole('option', { name: '待阅读', exact: true }), base);
  for (const label of ['待整理', '阅读中', '已完成', '已归档']) await sameRole(`Status menu ${label}`, ui.getByRole('option', { name: label, exact: true }), base);
  await sameRole('Status popup shell', ui.locator('.rw-status-menu'), columnMenu, ['fontFamily', 'borderRadius', 'backgroundColor']);
  await shot('1440-status-menu'); await page.keyboard.press('Escape');

  await ui.getByRole('button', { name: '更多文献工具', exact: true }).click();
  await ui.getByRole('menuitem', { name: '阅读与外观设置', exact: true }).click();
  await sameRole('Settings title', ui.locator('.modal-title'), dialogTitle);
  await sameRole('Settings section', ui.locator('.port-settings-group h2').first(), await style(ui.locator('.rw-section-heading h3').first()));
  await sameRole('Settings input', ui.locator('.setting-item-control input[type=text]').first(), base, ['fontFamily', 'fontSize', 'lineHeight']);
  await shot('1440-settings'); await ui.getByRole('button', { name: '关闭弹窗', exact: true }).click();

  await ui.getByRole('button', { name: '阅读 PDF', exact: true }).click();
  await expect(ui.locator('.mupdf-reader-toolbar')).toHaveAttribute('data-workbench', 'true');
  await sameRole('Reader back action', ui.locator('#reader-back'), action, [...fields, 'height', 'borderRadius']);
  await sameRole('Reader activity action', ui.locator('.rw-reader-activity-button'), action, [...fields, 'height', 'borderRadius']);
  await sameRole('Reader documents action', ui.getByRole('button', { name: '切换正文与附录', exact: true }), action, [...fields, 'height', 'borderRadius']);
  await sameRole('Reader status pill', ui.locator('#reader-reading-status .rw-status-pill'), base);
  await ui.getByRole('button', { name: '查看逐页阅读统计', exact: true }).click();
  await sameRole('Activity popup shell', ui.locator('.rw-reader-activity-panel'), columnMenu, ['fontFamily', 'borderRadius', 'backgroundColor']);
  await shot('1440-activity-popup'); await ui.getByRole('button', { name: '关闭逐页阅读统计', exact: true }).click();
  await ui.locator('.mupdf-reader-color-btn').click();
  await sameRole('PDF palette menu option', ui.locator('.menu > button').first(), base);
  await page.keyboard.press('Escape');

  const frame = page.frames().find(f => f.url().includes('port.html'));
  await frame.evaluate(async () => {
    const { app, reader } = window.__researchPort, path = app.workspace.getActiveFile().path;
    await reader.addAnnotation(path, { id: 'ui-audit-note', type: 'note', page: 0, comment: 'Reproduction evidence and follow-up question', tags: ['方法'], quads: [], x: 80, y: 110, color: 'yellow', createdAt: Date.now(), updatedAt: Date.now() });
    await reader.openAnnotationEditor(path, 'ui-audit-note');
  });
  await sameRole('PDF comment save', ui.getByRole('button', { name: '保存', exact: true }), action, [...fields, 'height', 'borderRadius']);
  await sameRole('PDF comment title', ui.locator('.mupdf-comment-title'), dialogTitle);
  await shot('1440-comment-dialog'); await ui.getByRole('button', { name: '取消', exact: true }).click();
  await ui.getByRole('button', { name: '打开研究侧栏', exact: true }).click();
  await sameRole('Reader sidebar tab', ui.getByRole('button', { name: '批注', exact: true }), small, ['fontFamily', 'fontSize']);
  await shot('1440-reader'); await ui.getByRole('button', { name: '收起 PDF 批注', exact: true }).click();
  await ui.getByRole('button', { name: '打开悬浮划词翻译', exact: true }).click();
  await sameRole('Translation icon button', ui.getByRole('button', { name: '关闭翻译窗', exact: true }), await style(ui.locator('.mupdf-reader-sidebar-btn')), ['fontFamily', 'fontSize', 'height', 'width', 'borderRadius']);
  await shot('1440-translation'); await ui.getByRole('button', { name: '关闭翻译窗', exact: true }).click();

  const readerIcon = await style(ui.locator('.mupdf-reader-sidebar-btn'));
  await sameRole('PDF image-to-note action', ui.getByRole('button', { name: '框选图表插入研究笔记', exact: true }), readerIcon, [...fields, 'height', 'width', 'borderRadius']);
  await ui.locator('.mupdf-reader-page').first().click({ button: 'right', position: { x: 100, y: 100 } });
  await ui.getByRole('menuitem', { name: '关联到研究笔记…', exact: true }).click();
  await sameRole('Note location picker title', ui.locator('.rw-note-link-modal .modal-title'), dialogTitle);
  await sameRole('Note location picker input', ui.getByRole('searchbox', { name: '搜索笔记标题', exact: true }), base, ['fontFamily', 'fontSize', 'lineHeight']);
  await sameRole('Note location picker action', ui.getByRole('button', { name: '新建并关联', exact: true }), action, [...fields, 'height', 'borderRadius']);
  await shot('1440-note-location-picker'); await ui.locator('.rw-note-link-modal .modal-close-button').click();
  await ui.getByRole('button', { name: '切换正文与附录', exact: true }).click();
  await ui.getByRole('menuitem', { name: '正文与附录并排阅读', exact: true }).click();
  await expect(ui.locator('.rw-pdf-comparison')).toHaveAttribute('aria-busy', 'false');
  for (const [side, label] of [['left', '左侧'], ['right', '右侧']]) {
    await sameRole(`Comparison ${side} document selector`, ui.getByRole('combobox', { name: `选择${label} PDF`, exact: true }), base);
    await sameRole(`Comparison ${side} close action`, ui.getByRole('button', { name: `关闭${label}阅读栏`, exact: true }), readerIcon, ['fontFamily', 'fontSize', 'height', 'width', 'borderRadius']);
  }
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await bounds(`${width} comparison left`, ui.getByRole('region', { name: '左侧 PDF', exact: true }));
    await bounds(`${width} comparison right`, ui.getByRole('region', { name: '右侧 PDF', exact: true }));
    await shot(`${width}-pdf-comparison`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await ui.getByRole('button', { name: '关闭右侧阅读栏', exact: true }).click();
  await expect(ui.locator('.rw-pdf-comparison')).toHaveCount(0);

  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await bounds(`${width} reader status`, ui.locator('#reader-reading-status'));
    await shot(`${width}-reader`);
    await ui.getByRole('button', { name: '打开研究侧栏', exact: true }).click();
    await bounds(`${width} sidebar close`, ui.getByRole('button', { name: '收起 PDF 批注', exact: true }));
    await shot(`${width}-reader-sidebar`);
    await ui.getByRole('button', { name: '收起 PDF 批注', exact: true }).click();
    await ui.locator('#reader-back').click();
    await expect(ui.locator('#reader-workspace')).toBeHidden();
    if (await ui.getByRole('button', { name: '返回文献列表', exact: true }).isVisible()) await ui.getByRole('button', { name: '返回文献列表', exact: true }).click();
    await shot(`${width}-library`);
    // Compact rows hide secondary columns; open the same control in detail.
    await ui.locator('.rw-paper-title').first().click();
    await ui.locator('.rw-paper-detail .rw-status-pill').click();
    await bounds(`${width} status menu`, ui.locator('.rw-status-menu'));
    await sameRole(`${width} menu typography`, ui.getByRole('option', { name: '待阅读', exact: true }), base);
    await shot(`${width}-status-menu`); await page.keyboard.press('Escape');
    await ui.getByRole('button', { name: '阅读 PDF', exact: true }).click();
    await expect(ui.locator('.mupdf-reader-toolbar')).toHaveAttribute('data-workbench', 'true');
  }
} catch (error) { report.issues.push(error.message); }
finally {
  await writeFile(resolve(out, 'audit.json'), JSON.stringify(report, null, 2));
  await browser.close(); await new Promise(resolve => server.httpServer.close(resolve));
}
console.log(JSON.stringify({ checks: report.checks.length, screenshots: report.screenshots.length, issues: report.issues, report: resolve(out, 'audit.json') }, null, 2));
if (report.issues.length) process.exitCode = 1;
