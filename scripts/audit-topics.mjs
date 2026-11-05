/** Built UI, synthetic topic graph and isolated library storage only. */
import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pdfFixture } from '../src/test/e2e/pdfFixture.ts';
const out = resolve('.taste-skill/topics-ui'); await mkdir(out, { recursive: true });
const server = await preview({ preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' }), browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), ui = page.frameLocator('.port-library-shell iframe');
const report = { checks: [], screenshots: [], issues: [] };
page.on('pageerror', e => report.issues.push(e.message)); await page.route('https://**', r => r.abort());
const style = locator => locator.evaluate(el => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return { fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight, height: r.height, borderRadius: s.borderRadius }; });
const match = async (name, locator, ref, keys = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight']) => { await expect(locator).toBeVisible(); const actual = await style(locator); report.checks.push({ name, actual }); for (const k of keys) if (actual[k] !== ref[k]) report.issues.push(`${name}: ${k} ${actual[k]} != ${ref[k]}`); };
const shot = async name => { await page.screenshot({ path: resolve(out, `${name}.png`) }); report.screenshots.push(name); };
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`); await page.getByRole('button', { name: '文献库', exact: true }).click(); await expect(ui.locator('#port-status')).toContainText('已就绪');
  await ui.locator('#port-pdf-input').setInputFiles(['External Validation', 'Whole Slide Learning'].map(name => ({ name: `${name}.pdf`, mimeType: 'application/pdf', buffer: pdfFixture(name) }))); await expect(ui.locator('.rw-paper-row')).toHaveCount(2);
  const frame = page.frames().find(f => f.url().includes('port.html'));
  await frame.evaluate(async () => { const x = window.__researchPort; for (const [i, paper] of x.library.currentModal.papers.entries()) await x.app.fileManager.processFrontMatter(paper.file, fm => { fm.authors = [['L. Zhang', 'K. Wang'], ['A. Chen', 'M. Li']][i]; fm.venue = ['Nature Medicine', 'NeurIPS'][i]; fm.year = [2025, 2024][i]; }); });
  const paperIds = await frame.evaluate(() => window.__researchPort.library.currentModal.papers.map(p => p.file.path));
  const base = await style(ui.locator('body')), action = await style(ui.locator('.rw-library-header .rw-primary')), table = await style(ui.locator('.rw-paper-row .rw-author-cell').first());
  report.references = { base, action, table };
  await page.evaluate(ids => {
    const saved = JSON.parse(localStorage.getItem('research-workbench-v1')), now = Date.now();
    const common = { createdAt: now, updatedAt: now }, record = { id: 'audit-topic', typeId: 'project', workspaceId: saved.state.workspaces[0].id, title: '病理基础模型的跨中心验证', content: '## 研究思路\n\n按中心分层，先锁定外部测试集合，再分析差异来源。', fields: [], sub: 'vertical', status: 'active', starred: true, archived: false, priority: 'none', dueDate: null, done: false, planDate: null, planStart: null, planEnd: null, ...common };
    record.topic = {
      question: '跨中心染色差异如何影响病理模型的泛化能力？', hypothesis: '中心分层训练可提高外部数据上的稳定性。', focus: '完成外部测试与失败病例归因', nextStep: '补齐中心 C 的独立验证', conclusion: '初步观察到中心间性能差异，待进一步验证。', blocker: '中心 C 的切片标注尚未齐备。',
      papers: ids.map((id, i) => ({ paperId: id, role: ['理论依据', '方法参考'][i], note: ['核对外部验证指标', '比较特征聚合方式'][i], linkedAt: now })),
      ideas: [{ id: 'idea1', title: '加入中心分层训练', status: 'testing', paperIds: ids, content: '## 核心想法\n\n保持 **测试集合固定**，比较全量训练与中心分层训练。\n\n> [!important] 验证重点\n> 关注外部中心的表现与置信区间。\n\n### 实验安排\n\n- 运行统一基线\n- 增加分层采样\n- 复核失败病例\n', ...common }, { id: 'idea2', title: '评估染色归一化的影响', status: 'pending', paperIds: [], content: '', ...common }],
      assets: [{ id: 'data1', title: '外部验证队列', kind: 'dataset', version: 'v2', location: 'E:/Research/External Cohort', notes: '中心 A / B / C，按患者划分。', ...common }, { id: 'figure1', title: '各中心 AUROC 对照图', kind: 'figure', version: 'v1', location: 'results/centre-auroc.svg', notes: '', ...common }],
      experiments: [{ id: 'exp1', title: '分层训练与基线对比', purpose: '比较相同测试集上的泛化表现，记录随机种子和代码版本。', content: '## 运行记录\n\n统一划分，使用同一测试集合与评价脚本。\n\n### 观察\n\n分层采样后，外部中心的 AUROC 有所提高；仍需重复运行。', status: 'running', ideaId: 'idea1', paperIds: ids.slice(0, 1), dataIds: ['data1'], runs: [{ id: 'run1', title: 'Baseline', status: 'completed', codeVersion: 'a13f2c', parameters: 'seed=42\nlr=0.001', result: '外部中心存在差异', metrics: { AUROC: '0.813', F1: '0.735' }, datasets: [{ id: 'data1', title: '外部验证队列', version: 'v1' }], assetIds: [], ...common }, { id: 'run2', title: 'Centre-stratified', status: 'completed', codeVersion: 'b47e01', parameters: 'seed=42\nlr=0.001', result: '进一步重复验证', metrics: { AUROC: '0.861', F1: '0.792' }, datasets: [{ id: 'data1', title: '外部验证队列', version: 'v2' }], assetIds: ['figure1'], ...common }], ...common }],
      milestones: [{ id: 'ms1', title: '冻结外部测试队列', date: '2026-10-25', done: true }, { id: 'ms2', title: '完成跨中心验证', date: '2026-11-07', done: false }],
      events: [{ id: 'event1', title: '冻结测试集合', content: '按患者划分，不再根据模型结果调整测试队列。', kind: 'decision', date: '2026-10-25', createdAt: now }, { id: 'event2', title: '创建实验：分层训练与基线对比', content: '', kind: 'activity', sourceType: 'experiment', sourceId: 'exp1', date: '2026-10-26', createdAt: now + 1 }, { id: 'event3', title: '完成里程碑：冻结外部测试队列', content: '', kind: 'milestone', sourceType: 'milestone', sourceId: 'ms1', date: '2026-10-25', createdAt: now + 2 }],
    };
    saved.state.records.unshift(record, { ...record, id: 'audit-topic2', title: '弱监督模型的解释性分析', starred: false, topic: undefined, updatedAt: now - 1 }, { ...record, id: 'audit-todo', typeId: 'todo', title: '复核中心 C 的切片标注', topicId: record.id, topic: undefined, dueDate: '2026-11-02' });
    localStorage.setItem('research-workbench-v1', JSON.stringify(saved));
  }, paperIds);
  await page.reload(); await expect(ui.locator('#port-status')).toContainText('已就绪'); await page.getByRole('button', { name: '科研课题', exact: true }).click(); await page.getByRole('button', { name: '课题资料', exact: true }).click(); await expect(page.getByRole('heading', { name: '病理基础模型的跨中心验证', exact: true })).toBeVisible();
  await match('Topic create action', page.getByRole('button', { name: '新建课题', exact: true }), action, ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'height', 'borderRadius']);
  // Native select line-height is platform-owned; compare text roles and audit rendered capsules separately.
  await match('Topic status selector', page.getByLabel('课题进度'), base, ['fontFamily', 'fontSize', 'fontWeight']); await match('Topic status capsule', page.locator('.topic-directory-row .topic-status').first(), base); await match('Topic tab', page.getByRole('tab', { name: '概览', exact: true }), base);
  for (const [label, prefix] of [['概览', 'overview'], ['关联论文', 'papers'], ['点子', 'ideas'], ['实验', 'experiments'], ['数据与文件', 'assets'], ['时间线', 'timeline']]) {
    await page.setViewportSize({ width: 1440, height: 900 }); await page.getByRole('tab', { name: new RegExp('^' + label) }).click();
    if (label === '点子' || label === '实验') await expect(page.getByRole('textbox', { name: '研究笔记正文', exact: true })).toBeVisible();
    if (label === '关联论文') { await match('Topic paper text', page.locator('.topic-paper-title').first(), table); await match('Topic paper header', page.locator('.topic-table th').first(), base); }
    if (label === '实验') { await match('Run status', page.locator('.topic-runs .topic-status').first(), base); await match('Record run action', page.getByRole('button', { name: '记录运行', exact: true }), action, ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'height', 'borderRadius']); }
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      if (width < 850 && !await page.getByRole('button', { name: '返回课题列表', exact: true }).isVisible()) await page.locator('.topic-directory-row').first().click();
      if (!await page.locator('html').evaluate(el => el.scrollWidth <= el.clientWidth)) report.issues.push(`${prefix}-${width}: document overflow`);
      await shot(`${prefix}-${width}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 }); await page.getByRole('tab', { name: /^实验/ }).click(); await page.getByRole('button', { name: '记录运行', exact: true }).click();
  await match('Run form save action', page.getByRole('dialog', { name: '记录运行', exact: true }).getByRole('button', { name: '保存', exact: true }), action, ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'height', 'borderRadius']);
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 900 }); await shot(`run-dialog-${width}`); }
} catch (error) { report.issues.push(error.message); }
finally { await writeFile(resolve(out, 'audit.json'), JSON.stringify(report, null, 2)); await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
console.log(JSON.stringify({ checks: report.checks.length, screenshots: report.screenshots.length, issues: report.issues, report: resolve(out, 'audit.json') }, null, 2)); if (report.issues.length) process.exitCode = 1;
