import { test, expect, type Page } from '@playwright/test';
import { pdfFixture } from './pdfFixture';
import { readFile } from 'node:fs/promises';
import { chooseResearchScope, chooseResearchTopic } from './researchNavigation';

async function setup(page: Page) {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); await page.route('https://**', r => r.abort());
  await page.goto('/'); const ui = page.frameLocator('.port-library-shell iframe'); await expect(ui.locator('#port-status')).toContainText('已就绪');
  await page.getByRole('button', { name: '科研课题', exact: true }).click();
  await chooseResearchScope(page, '课题总览');
  await page.locator('.rt-workbench-header').getByRole('button', { name: '新建课题', exact: true }).click(); const modal = page.getByRole('dialog', { name: '新建科研课题' });
  await modal.getByLabel('课题名称', { exact: true }).fill('病理模型外部验证'); await modal.getByLabel('研究问题', { exact: true }).fill('跨中心数据是否影响模型可靠性？'); await modal.getByRole('button', { name: '创建课题', exact: true }).click(); await page.getByRole('button', { name: '课题资料', exact: true }).click();
  await researchRecord(page, 'overview');
  return { ui, errors };
}
const tab = (page: Page, label: string) => page.getByRole('tab', { name: new RegExp('^' + label) });
const researchRecord = (page: Page, view: 'overview' | 'ideas' | 'experiments' | 'timeline') => page.getByRole('combobox', { name: '研究记录', exact: true }).selectOption(view);
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('research-workbench-v1')!).state.records.find((r: { title: string }) => r.title === '病理模型外部验证'));

test('论文、点子、验证实验和决策互相关联，文献库可反向进入课题并持久化', async ({ page }) => {
  const { ui, errors } = await setup(page);
  await page.getByLabel('当前重点', { exact: true }).fill('先验证跨中心稳定性'); await page.getByLabel('下一步', { exact: true }).click();
  await page.getByRole('button', { name: '文献库', exact: true }).click();
  await ui.locator('#port-pdf-input').setInputFiles({ name: 'External Validation.pdf', mimeType: 'application/pdf', buffer: pdfFixture('External validation') }); await expect(ui.locator('.rw-paper-row')).toHaveCount(1);
  await page.getByRole('button', { name: '科研课题', exact: true }).click(); await tab(page, '关联论文').click(); await page.getByRole('button', { name: '关联论文', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '关联论文', exact: true }); await picker.getByLabel('External Validation', { exact: true }).check(); await picker.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.topic-table')).toContainText('External Validation'); await page.getByLabel('论文作用：External Validation').selectOption('方法参考');
  await researchRecord(page, 'ideas'); await page.getByRole('button', { name: '新建点子', exact: true }).click(); let modal = page.getByRole('dialog', { name: '新建点子', exact: true });
  await modal.getByLabel('点子名称', { exact: true }).fill('加入中心分层验证'); await modal.getByLabel('External Validation', { exact: true }).check(); await modal.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: 'Markdown 源码', exact: true }).click(); await page.getByRole('textbox', { name: 'Markdown 正文', exact: true }).fill('## 验证思路\n\n按 **中心** 分层，比较 AUROC。'); await page.getByRole('textbox', { name: 'Markdown 正文', exact: true }).press('Control+s'); await page.getByRole('button', { name: '所见所得编辑', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '研究笔记正文', exact: true })).toContainText('验证思路');
  await page.getByRole('button', { name: '创建验证实验', exact: true }).click(); modal = page.getByRole('dialog', { name: '新建实验', exact: true }); await modal.getByLabel('实验名称', { exact: true }).fill('跨中心基线'); await modal.getByLabel('实验目的', { exact: true }).fill('建立可复现的参考结果'); await modal.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '研究记录', exact: true })).toHaveValue('experiments'); await expect(page.locator('.topic-related')).toContainText('加入中心分层验证');
  await researchRecord(page, 'timeline'); await page.getByRole('button', { name: '记录决策', exact: true }).click(); modal = page.getByRole('dialog', { name: '记录决策', exact: true }); await modal.getByLabel('决策名称', { exact: true }).fill('冻结测试中心'); await modal.getByLabel('决策记录', { exact: true }).fill('避免选择偏差，后续实验保持同一测试集合。'); await modal.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.topic-timeline')).toContainText('创建实验：跨中心基线'); await expect(page.locator('.topic-timeline')).toContainText('冻结测试中心');
  await tab(page, '关联论文').click(); await page.getByRole('button', { name: 'External Validation', exact: true }).click(); await expect(ui.locator('.rw-paper-detail h2')).toHaveText('External Validation');
  await ui.getByRole('button', { name: /病理模型外部验证/ }).last().click(); await expect(page.getByRole('heading', { name: '病理模型外部验证', exact: true })).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: '科研课题', exact: true }).click(); await chooseResearchTopic(page, '病理模型外部验证');await page.getByRole('button',{name:'课题资料',exact:true}).click(); await researchRecord(page, 'ideas');
  await expect(page.getByRole('textbox', { name: '研究笔记正文', exact: true })).toContainText('按 中心 分层');
  const data = await stored(page); expect(data.topic.papers[0].role).toBe('方法参考'); expect(data.topic.experiments[0].ideaId).toBe(data.topic.ideas[0].id); expect(data.topic.ideas[0].content).toContain('**中心**');
  expect(errors).toEqual([]);
});

test('课题文件实际导入下载，运行指标对比保留历史数据版本，备份包含所有记录', async ({ page }) => {
  const { errors } = await setup(page);
  await tab(page, '数据与文件').click(); await page.getByRole('button', { name: '添加数据与文件', exact: true }).click(); let modal = page.getByRole('dialog', { name: '新建数据与文件', exact: true });
  await modal.getByLabel('数据与文件名称', { exact: true }).fill('外部测试集'); await modal.getByLabel('数据版本', { exact: true }).fill('v1'); await modal.getByLabel('数据存放位置').fill('E:/datasets/external');
  await modal.getByLabel('导入课题文件').setInputFiles({ name: 'cohort.csv', mimeType: 'text/csv', buffer: Buffer.from('centre,n\nA,40\nB,60\n') }); await modal.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.topic-table').first()).toContainText('外部测试集');
  await expect(page.getByRole('table', { name: '数据预览' })).toContainText('centre'); await expect(page.getByRole('table', { name: '数据预览' })).toContainText('60');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '下载课题文件', exact: true }).click(); const downloaded = await download; expect(await readFile(await downloaded.path() as string, 'utf8')).toContain('A,40');
  await researchRecord(page, 'experiments'); await page.getByRole('button', { name: '新建实验', exact: true }).click(); modal = page.getByRole('dialog', { name: '新建实验', exact: true }); await modal.getByLabel('实验名称', { exact: true }).fill('参数敏感性'); await modal.getByLabel('外部测试集 · v1', { exact: true }).check(); await modal.getByRole('button', { name: '保存', exact: true }).click();
  const run = async (name: string, metric: string) => { await page.getByRole('button', { name: '记录运行', exact: true }).click(); const form = page.getByRole('dialog', { name: '记录运行', exact: true }); await form.getByLabel('运行名称').fill(name); await form.getByLabel('代码版本').fill('abc123'); await form.getByLabel('运行指标').fill(metric); await form.getByLabel('参数与环境').fill('seed=42\nlr=0.001'); await form.getByRole('button', { name: '保存', exact: true }).click(); };
  await run('Baseline', 'AUROC=0.81\nF1=0.73');
  await tab(page, '数据与文件').click(); await page.getByRole('button', { name: '编辑数据与文件', exact: true }).click(); modal = page.getByRole('dialog', { name: '编辑数据与文件', exact: true }); await modal.getByLabel('数据版本').fill('v2'); await modal.getByRole('button', { name: '保存', exact: true }).click();
  await researchRecord(page, 'experiments'); await run('Stratified', 'AUROC=0.86\nF1=0.79'); await expect(page.locator('.topic-runs table')).toContainText('0.86'); await expect(page.locator('.topic-runs table')).toContainText('v1'); await expect(page.locator('.topic-runs table')).toContainText('v2');
  await page.getByRole('button', { name: 'Baseline', exact: true }).click(); modal = page.getByRole('dialog', { name: '编辑运行', exact: true }); await expect(modal.getByLabel('外部测试集 · v1', { exact: true })).toBeChecked(); await modal.getByLabel('运行指标').fill('AUROC=0.82\nF1=0.74'); await modal.getByRole('button', { name: '保存', exact: true }).click();
  const data = await stored(page); expect(data.topic.experiments[0].runs.map((r: { datasets: { version: string }[] }) => r.datasets[0].version)).toEqual(['v1', 'v2']);
  await page.getByRole('button', { name: '设置与数据', exact: true }).click(); const backup = page.waitForEvent('download'); await page.getByRole('button', { name: /导出.*备份|导出数据/ }).click(); const saved = JSON.parse(await readFile(await (await backup).path() as string, 'utf8')); expect(saved.records.find((r: { id: string }) => r.id === data.id).topic).toEqual(data.topic);
  expect(errors).toEqual([]);
});

test('旧科研项目迁移保留内容和属性，里程碑待办与三个宽度的布局可用', async ({ page }) => {
  await page.addInitScript(() => { if (!localStorage.getItem('research-workbench-v1')) localStorage.setItem('research-workbench-v1', JSON.stringify({ version: 6, state: { types: [{ id: 'project', name: '科研项目', kind: 'project', icon: 'flask', note: '♪', builtin: true }, { id: 'todo', name: '待办事项', kind: 'todo', icon: 'list-checks', note: '♬', builtin: true }], workspaces: [{ id: 'ws-default', name: '默认工作区', builtin: true }], records: [{ id: 'old-topic', typeId: 'project', workspaceId: 'ws-default', title: '旧课题材料', content: '# 原始内容\n\n保留这段研究记录。', fields: [{ id: 'f1', name: '负责人', value: '研究者' }], sub: 'horizontal', status: 'active', starred: false, archived: false, priority: 'none', dueDate: null, done: false, planDate: null, planStart: null, planEnd: null, createdAt: 1, updatedAt: 1 }] } })); });
  await page.goto('/'); await page.getByRole('button', { name: '科研课题', exact: true }).click();await chooseResearchTopic(page, '旧课题材料');await page.getByRole('button',{name:'课题资料',exact:true}).click();await researchRecord(page, 'overview');await expect(page.getByRole('heading', { name: '旧课题材料' })).toBeVisible(); await expect(page.locator('.topic-legacy-fields')).toContainText('研究者');
  await page.getByRole('tab',{name:'课题笔记',exact:true}).click(); await expect(page.getByRole('textbox', { name: '研究笔记正文', exact: true })).toContainText('保留这段研究记录');
  await researchRecord(page, 'overview');await page.getByRole('button', { name: '添加', exact: true }).click(); let modal = page.getByRole('dialog', { name: '新建里程碑', exact: true }); await modal.getByLabel('里程碑名称').fill('完成第一轮分析'); await modal.getByRole('button', { name: '保存', exact: true }).click(); await page.getByLabel('完成第一轮分析', { exact: true }).check();
  await page.getByRole('button', { name: '关联待办', exact: true }).click(); modal = page.getByRole('dialog', { name: '关联待办', exact: true }); await modal.getByLabel('新建课题待办').fill('整理外部数据'); await modal.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.getByLabel('整理外部数据', { exact: true })).toBeVisible();
  await page.getByRole('tab',{name:'课题笔记',exact:true}).click();
  for (const width of [1440, 768, 390]) { await page.setViewportSize({ width, height: 900 }); expect(await page.locator('html').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true); await page.screenshot({ path: `shots/topics-overview-${width}.png` }); await expect(page.getByRole('heading', { name: '旧课题材料' })).toBeVisible(); }
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('research-workbench-v1')!).state); expect(state.records.find((r: { id: string }) => r.id === 'old-topic').sub).toBe('horizontal'); expect(state.records.find((r: { id: string }) => r.id === 'old-topic').content).toContain('原始内容');
});

test('从文献详情关联课题和解关联，课题 PDF 可在阅读器打开，缺失文件有反馈', async ({ page }) => {
  const { ui, errors } = await setup(page);
  await page.getByRole('button', { name: '文献库', exact: true }).click();
  await ui.locator('#port-pdf-input').setInputFiles({ name: 'Topic Link.pdf', mimeType: 'application/pdf', buffer: pdfFixture('Topic link') }); await expect(ui.locator('.rw-paper-row')).toHaveCount(1); await ui.locator('.rw-paper-title').click();
  await ui.getByRole('button', { name: '关联科研课题', exact: true }).click(); let modal = page.getByRole('dialog', { name: '关联科研课题', exact: true }); await modal.getByLabel('病理模型外部验证', { exact: true }).check(); await modal.getByRole('button', { name: '完成', exact: true }).click();
  await ui.locator('.rw-workbench-topic-links').getByRole('button', { name: '病理模型外部验证' }).click(); await expect(page.locator('.topic-table')).toContainText('Topic Link');
  const frame = page.frames().find(f => f.url().includes('port.html'))!;
  await frame.evaluate(async () => { const x = (window as unknown as { __researchPort: { app: { fileManager: { processFrontMatter: (file: unknown, change: (fm: Record<string, unknown>) => void) => Promise<void> } }; library: { currentModal: { papers: Array<{ file: { path: string } }>; loadPapers: () => Promise<void> } } } }).__researchPort; await x.app.fileManager.processFrontMatter(x.library.currentModal.papers[0].file, (fm: Record<string, unknown>) => { fm.status = 'archived'; }); await x.library.currentModal.loadPapers(); });
  await page.setViewportSize({ width: 390, height: 900 });  await page.getByRole('button', { name: 'Topic Link', exact: true }).click(); await expect(ui.locator('.rw-paper-detail h2')).toHaveText('Topic Link');
  await ui.locator('.rw-workbench-topic-links').getByRole('button', { name: '病理模型外部验证' }).click(); await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '解除论文关联：Topic Link', exact: true }).click(); await expect(page.locator('.topic-table tbody tr')).toHaveCount(0);
  await tab(page, '数据与文件').click(); await page.getByRole('button', { name: '添加数据与文件', exact: true }).click(); modal = page.getByRole('dialog', { name: '新建数据与文件', exact: true });
  await modal.getByLabel('导入课题文件').setInputFiles({ name: 'Experiment Protocol.pdf', mimeType: 'application/pdf', buffer: pdfFixture('Experiment protocol') }); await modal.getByLabel('文件类型').selectOption('document'); await modal.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '预览课题 PDF', exact: true }).click(); await expect(ui.locator('#reader-workspace')).toBeVisible(); await expect(ui.locator('.mupdf-reader-page')).toBeVisible(); await ui.locator('#reader-back').click();
  const data = await stored(page); const path = data.topic.assets[0].vaultPath;
  await page.frames().find(f => f.url().includes('port.html'))!.evaluate(async path => { const { vault } = (window as unknown as { __researchPort: { vault: { delete: (file: unknown) => Promise<void>; getAbstractFileByPath: (path: string) => unknown } } }).__researchPort; await vault.delete(vault.getAbstractFileByPath(path)); }, path);
  await page.getByRole('button', { name: '科研课题', exact: true }).click(); await tab(page, '数据与文件').click(); await page.getByRole('button', { name: '预览课题 PDF', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '无法打开文件', exact: true })).toContainText('文件已缺失'); expect(errors).toEqual([]);
});
