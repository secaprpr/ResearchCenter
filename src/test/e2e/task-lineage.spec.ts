import { test, expect, type Page } from '@playwright/test';
import { lineageFixture } from '../lineageFixture';
import { chooseResearchScope, chooseResearchTopic, revealResearchFilters } from './researchNavigation';

async function chooseTopic(page: Page) {
  await chooseResearchTopic(page, '多模态病理分析');
}

async function openAddNodeMenu(page: Page, title: string) {
  const add = page.getByRole('button', { name: `添加子节点 ${title}`, exact: true });
  if (await add.isVisible()) await add.click();
  else await page.getByRole('button', { name: `节点操作 ${title}`, exact: true }).click();
}

async function foldNodeBranches(page: Page, title: string) {
  await page.getByRole('button', { name: `节点操作 ${title}`, exact: true }).click();
  await page.getByRole('menuitem', { name: '折叠后续分支', exact: true }).click();
}

async function setup(page: Page, fixture = lineageFixture()) {
  const errors: string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**',r=>r.abort());
  await page.addInitScript(()=>localStorage.setItem('research-workbench-sidebar-collapsed','true'));
  await page.goto('/'); await expect(page.frameLocator('.port-library-shell iframe').locator('#port-status')).toContainText('已就绪');
  await page.getByRole('button',{name:'科研课题',exact:true}).click();
  await page.evaluate(record=>{const saved=JSON.parse(localStorage.getItem('research-workbench-v1')!);record.typeId=saved.state.types.find((t:{kind:string})=>t.kind==='project').id;record.workspaceId=saved.state.workspaces[0].id;saved.state.records.unshift(record);localStorage.setItem('research-workbench-v1',JSON.stringify(saved));},fixture);
  await page.reload(); await page.getByRole('button',{name:'科研课题',exact:true}).click();await chooseTopic(page);
  await expect(page.getByRole('region',{name:'课题研究脉络'})).toBeVisible();
  return errors;
}

test('新课题从长卷起点创建节点，行内新增后续和分支，取消后独立创建不继承关系', async ({ page }) => {
  const fixture = lineageFixture(); fixture.topic!.tasks = [];
  const errors = await setup(page, fixture);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const start = page.getByRole('button', { name: '创建首个节点', exact: true });
    await expect(start).toBeVisible();
    expect((await start.boundingBox())!.y).toBeLessThan(500);
    expect(await page.locator('html').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await page.getByRole('button', { name: '创建首个节点', exact: true }).click();
  let modal = page.getByRole('group', { name: '新建节点', exact: true });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(modal.getByLabel('节点接续关系')).toHaveText('独立节点');
  await modal.getByLabel('节点名称', { exact: true }).fill('确定早期食管癌研究方向');
  await modal.getByRole('button', { name: '保存', exact: true }).click();
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('research-workbench-v1')!).state.records.find((r: {id: string}) => r.id === 'lineage-topic').topic.tasks);
  const root = (await read())[0]; expect(root.parentIds).toEqual([]);
  await expect(page.locator('.rtl-row.is-open')).toContainText(root.title);
  await expect(page.getByRole('button', { name: '追加记录', exact: true })).toBeVisible();
  await openAddNodeMenu(page, root.title);
  await page.getByRole('menuitem', { name: '接续节点', exact: true }).click();
  modal = page.getByRole('group', { name: '新建节点', exact: true });
  await expect(modal.getByLabel('节点接续关系')).toContainText(root.title);
  await modal.getByLabel('节点名称', { exact: true }).fill('下载探索数据');
  await modal.getByRole('button', { name: '保存', exact: true }).click();
  const child = (await read()).find((t: {title: string}) => t.title === '下载探索数据');
  expect(child.parentIds).toEqual([root.id]); expect(child.branch).toBe(false);
  await openAddNodeMenu(page, root.title);
  await page.getByRole('menuitem', { name: '新增并行分支', exact: true }).click();
  modal = page.getByRole('group', { name: '新建节点', exact: true });
  await expect(modal.getByLabel('节点接续关系')).toContainText('并行分支');
  await modal.getByLabel('节点名称', { exact: true }).fill('整理指南与对照文献');
  await modal.getByRole('button', { name: '保存', exact: true }).click();
  const parallel = (await read()).find((t: {title: string}) => t.title === '整理指南与对照文献');
  expect(parallel.parentIds).toEqual([root.id]); expect(parallel.branch).toBe(true);
  await openAddNodeMenu(page, root.title);
  await page.getByRole('menuitem', { name: '新增并行分支', exact: true }).click();
  await page.getByRole('group', { name: '新建节点', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '新建独立节点', exact: true }).click();
  modal = page.getByRole('group', { name: '新建节点', exact: true });
  await expect(modal.getByLabel('节点接续关系')).toHaveText('独立节点');
  await modal.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByLabel('搜索任务').fill('不存在的查询');
  await expect(page.getByText('没有匹配的节点', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '创建首个节点', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(page.locator('.rtl-row')).toHaveCount(3);
  await page.reload(); await page.getByRole('button', { name: '科研课题', exact: true }).click();
  await chooseTopic(page);
  await expect(page.locator('.rtl-row')).toHaveCount(3);
  expect((await read()).find((t: {id: string}) => t.id === child.id).parentIds).toEqual([root.id]);
  expect(errors).toEqual([]);
});

test('节点与进展原位编辑，模板、草稿和原始来源在精简后保留', async ({ page }) => {
  const fixture = lineageFixture(), task = fixture.topic!.tasks!.find(t => t.id === 'download')!;
  task.createdAt += 45678; task.events[0].occurredAt! += 12345;
  const original = structuredClone(task.events[0]);
  task.events.push({ ...original, id: 'creation', title: '创建任务', source: '手动', occurredAt: task.createdAt, description: '', evidence: '', fields: [] });
  const errors = await setup(page, fixture), row = page.locator('[data-node="download"]');
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('research-workbench-v1')!).state.records.find((r: {id: string}) => r.id === 'lineage-topic').topic.tasks.find((t: {id: string}) => t.id === 'download'));
  await row.locator('.rtl-title').click();
  await expect(row.locator('.rt-event')).toHaveCount(1); await expect(row.locator('.rt-event-body footer')).toHaveCount(0);
  await row.getByRole('button', {name: '编辑任务描述', exact: true}).click();
  await row.getByLabel('编辑目的与描述').fill('为了核查外部数据的可用性');
  await row.getByLabel('编辑目的与描述').press('Control+Enter');
  expect((await read()).description).toBe('为了核查外部数据的可用性');
  await row.getByRole('button', {name: '开始下载', exact: true}).click();
  let editor = row.getByRole('group', {name: '编辑记录', exact: true}); await expect(editor).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await editor.getByLabel('保存位置', {exact: true}).fill('/data/verified/brca');
  await editor.getByLabel('记录名称', {exact: true}).press('Control+Enter');
  let event = (await read()).events.find((e: {id: string}) => e.id === original.id);
  expect(event).toEqual({...original, fields: original.fields.map(f => f.id === 'path' ? {...f, value: '/data/verified/brca'} : f)});
  await row.getByRole('button', {name: '开始下载', exact: true}).click(); editor = row.getByRole('group', {name: '编辑记录', exact: true});
  await editor.getByLabel('记录名称', {exact: true}).fill('取消的修改'); await editor.getByLabel('记录名称', {exact: true}).press('Escape');
  expect((await read()).events.find((e: {id: string}) => e.id === original.id)).toEqual(event);
  await row.getByRole('button', {name: '追加记录', exact: true}).click(); editor = row.getByRole('group', {name: '追加记录', exact: true});
  await editor.getByLabel('记录名称', {exact: true}).fill('暂存的进展草稿');
  await row.locator('.rtl-title').click(); await expect(row.getByRole('group', {name: '追加记录', exact: true})).toHaveCount(0);
  expect((await read()).events.some((e: {title: string}) => e.title === '暂存的进展草稿')).toBe(true);
  await row.locator('.rtl-title').click(); await row.getByRole('button', {name: '暂存的进展草稿', exact: true}).click();
  editor = row.getByRole('group', {name: '编辑记录', exact: true}); await expect(editor.getByLabel('记录名称', {exact: true})).toHaveValue('暂存的进展草稿');
  await editor.getByText('属性与模板', {exact: true}).click(); await editor.getByLabel('字段模板').selectOption('download-complete');
  await editor.getByRole('button', {name: '保存', exact: true}).click(); await expect(editor.getByRole('alert')).toContainText('请填写实际保存位置');
  await editor.getByLabel('实际保存位置', {exact: true}).fill('/data/final/brca'); await editor.getByLabel('发生时间', {exact: true}).fill('2026-10-23T16:18');
  await editor.getByRole('button', {name: '保存', exact: true}).click();
  const after = await read(); expect(after.status).toBe('completed'); event = after.events.find((e: {title: string}) => e.title === '暂存的进展草稿');
  expect(event.occurredAt).toBe(Date.parse('2026-10-23T16:18:00+08:00')); expect(event.recordedAt).toBeGreaterThan(event.occurredAt);
  const beforeRename = await read(); await row.locator('.rtl-title').dblclick(); editor = row.getByRole('group', {name: '编辑节点', exact: true});
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(row.locator('.rtl-heading')).not.toBeVisible(); await editor.getByLabel('节点名称', {exact: true}).fill('核查后的数据下载'); await editor.getByLabel('节点名称', {exact: true}).press('Control+Enter');
  const renamed = await read(); expect(renamed.title).toBe('核查后的数据下载'); expect(renamed.events).toEqual(beforeRename.events); expect(renamed.source).toBe(beforeRename.source); expect(renamed.createdAt).toBe(beforeRename.createdAt);
  await page.reload(); await page.getByRole('button', {name: '科研课题', exact: true}).click(); await chooseTopic(page);
  expect((await read()).events).toEqual(renamed.events); expect(errors).toEqual([]);
});

test('离开整条编辑区域自动保存，字段切换不收起，未修改和取消不写入', async ({page}) => {
  const fixture=lineageFixture(),task=fixture.topic!.tasks!.find(t=>t.id==='download')!;
  task.events[0].occurredAt!+=12345;const original=structuredClone(task.events[0]);
  await setup(page,fixture);const row=page.locator('[data-node="download"]');
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('research-workbench-v1')!).state.records.find((r:{id:string})=>r.id==='lineage-topic').topic.tasks.find((t:{id:string})=>t.id==='download'));
  const outside=page.getByRole('heading',{name:fixture.title,exact:true});
  await row.locator('.rtl-title').click();await row.getByRole('button',{name:'开始下载',exact:true}).click();
  let editor=row.getByRole('group',{name:'编辑记录',exact:true});
  await editor.getByLabel('记录名称',{exact:true}).fill('核实数据下载');await editor.getByLabel('记录名称',{exact:true}).press('Tab');
  await expect(editor).toBeVisible();await editor.getByLabel('记录内容',{exact:true}).fill('确认保存位置与文件数量');
  await editor.getByText('属性与模板',{exact:true}).click();await editor.getByLabel('记录状态变更').selectOption('running');
  await expect(editor).toBeVisible();expect((await read()).events[0]).toEqual(original);
  await outside.click();await expect(editor).toHaveCount(0);
  const saved=await read();expect(saved.events).toHaveLength(1);expect(saved.events[0]).toEqual({...original,title:'核实数据下载',description:'确认保存位置与文件数量',status:'running'});
  await row.getByRole('button',{name:'核实数据下载',exact:true}).click();await outside.click();expect(await read()).toEqual(saved);
  await row.getByRole('button',{name:'核实数据下载',exact:true}).click();editor=row.getByRole('group',{name:'编辑记录',exact:true});
  await editor.getByLabel('记录名称',{exact:true}).fill('应取消');await editor.getByRole('button',{name:'取消',exact:true}).click();expect(await read()).toEqual(saved);
  await row.getByRole('button',{name:'核实数据下载',exact:true}).click();editor=row.getByRole('group',{name:'编辑记录',exact:true});
  await editor.getByLabel('记录内容',{exact:true}).fill('Esc 也应取消');await editor.getByLabel('记录内容',{exact:true}).press('Escape');expect(await read()).toEqual(saved);
  await row.locator('.rtl-title').dblclick();const node=row.getByRole('group',{name:'编辑节点',exact:true});
  await node.getByLabel('节点名称',{exact:true}).fill('已补齐的数据下载');await node.getByLabel('目的与描述',{exact:true}).click();await expect(node).toBeVisible();
  await node.getByLabel('目的与描述',{exact:true}).fill('用于核查跨中心输入');await outside.click();await expect(node).toHaveCount(0);
  const updated=await read();expect(updated.title).toBe('已补齐的数据下载');expect(updated.description).toBe('用于核查跨中心输入');expect(updated.events).toEqual(saved.events);expect(updated.createdAt).toBe(saved.createdAt);
  await page.reload();await page.getByRole('button',{name:'科研课题',exact:true}).click();await chooseTopic(page);expect(await read()).toEqual(updated);
});

test('失焦校验保留错误输入，补全后键盘离开保存；空白新建不会产生条目', async ({page}) => {
  const fixture=lineageFixture();await setup(page,fixture);const row=page.locator('[data-node="download"]'),outside=page.getByRole('heading',{name:fixture.title,exact:true});
  const count=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('research-workbench-v1')!).state.records.find((r:{id:string})=>r.id==='lineage-topic').topic.tasks.find((t:{id:string})=>t.id==='download').events.length);
  await row.locator('.rtl-title').click();await row.getByRole('button',{name:'追加记录',exact:true}).click();let editor=row.getByRole('group',{name:'追加记录',exact:true});
  await editor.getByLabel('记录名称',{exact:true}).fill('检查完成');await editor.getByText('属性与模板',{exact:true}).click();await editor.getByLabel('字段模板').selectOption('download-complete');
  await outside.click();await expect(editor).toBeVisible();await expect(editor.getByRole('alert')).toContainText('请填写实际保存位置');expect(await count()).toBe(1);
  await editor.getByLabel('实际保存位置',{exact:true}).fill('/data/verified');await editor.getByLabel('记录名称',{exact:true}).focus();await editor.getByLabel('记录名称',{exact:true}).press('Shift+Tab');
  await expect(editor).toHaveCount(0);expect(await count()).toBe(2);
  await row.getByRole('button',{name:'追加记录',exact:true}).click();editor=row.getByRole('group',{name:'追加记录',exact:true});await outside.click();await expect(editor).toHaveCount(0);expect(await count()).toBe(2);
  await page.getByRole('button',{name:'新建节点',exact:true}).click();const node=page.getByRole('group',{name:'新建节点',exact:true});await outside.click();await expect(node).toHaveCount(0);await expect(page.locator('.rtl-row')).toHaveCount(8);
});

test('一击切换其他记录不丢点击，中文组词期间不提交，结束后只追加一次', async ({page}) => {
  const fixture=lineageFixture(),task=fixture.topic!.tasks!.find(t=>t.id==='download')!;
  task.events.push({...structuredClone(task.events[0]),id:'check',title:'另一条核查',occurredAt:task.createdAt+3600000,fields:[]});
  await setup(page,fixture);const row=page.locator('[data-node="download"]'),outside=page.getByRole('heading',{name:fixture.title,exact:true});
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('research-workbench-v1')!).state.records.find((r:{id:string})=>r.id==='lineage-topic').topic.tasks.find((t:{id:string})=>t.id==='download').events);
  await row.locator('.rtl-title').click();await row.getByRole('button',{name:'开始下载',exact:true}).click();let editor=row.getByRole('group',{name:'编辑记录',exact:true});
  await editor.getByLabel('记录内容',{exact:true}).fill('第一条补充');await row.getByRole('button',{name:'另一条核查',exact:true}).click();
  editor=row.getByRole('group',{name:'编辑记录',exact:true});await expect(editor.getByLabel('记录名称',{exact:true})).toHaveValue('另一条核查');expect((await read())[0].description).toBe('第一条补充');
  await editor.getByRole('button',{name:'取消',exact:true}).click();await row.getByRole('button',{name:'追加记录',exact:true}).click();editor=row.getByRole('group',{name:'追加记录',exact:true});
  const title=editor.getByLabel('记录名称',{exact:true});await title.dispatchEvent('compositionstart');await title.fill('中文输入完成');
  await title.dispatchEvent('keydown',{key:'Escape',isComposing:true});await outside.click();await expect(editor).toBeVisible();expect(await read()).toHaveLength(2);
  await title.dispatchEvent('compositionend');await expect(editor).toHaveCount(0);await outside.dblclick();const saved=await read();expect(saved).toHaveLength(3);expect(saved.filter((e:{title:string})=>e.title==='中文输入完成')).toHaveLength(1);
});
test('紧凑长卷原位展开、接续自定义节点、合流与刷新持久化',async({page})=>{
  const errors=await setup(page); await expect(page.locator('.rtl-row')).toHaveCount(8); await expect(page.locator('.rt-detail')).toHaveCount(0);
  await page.locator('[data-node="download"] .rtl-title').click();await expect(page.locator('.rtl-expanded')).toContainText('开始下载');
  await foldNodeBranches(page,'下载 TCGA-BRCA，建立第一轮探索数据');
  await page.getByRole('button',{name:'任务菜单 下载 TCGA-BRCA，建立第一轮探索数据',exact:true}).click();await page.getByRole('menuitem',{name:'新增并行分支',exact:true}).click();let modal=page.getByRole('group',{name:'新建节点',exact:true});
  await expect(modal.getByLabel('接续 下载 TCGA-BRCA，建立第一轮探索数据',{exact:true})).toBeChecked();
  await modal.getByLabel('节点名称',{exact:true}).fill('核查新中心的数据格式');await modal.getByText('属性', { exact: true }).click();await modal.getByLabel('节点类型',{exact:true}).fill('数据复核');await modal.getByRole('button',{name:'保存',exact:true}).click();
  await expect(page.locator('.rtl-row')).toHaveCount(9);await expect(page.locator('.rtl-row.is-open')).toContainText('核查新中心的数据格式');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('research-workbench-v1')!).state.records.find((r:{id:string})=>r.id==='lineage-topic').topic.tasks.at(-1));
  expect(saved.parentIds).toEqual(['download']);expect(saved.branch).toBe(true);expect(saved.nodeType).toBe('数据复核');
  await page.getByRole('button',{name:'任务菜单 核查新中心的数据格式',exact:true}).click();await page.getByRole('menuitem',{name:'编辑节点',exact:true}).click();modal=page.getByRole('group',{name:'编辑节点',exact:true});
  await modal.getByText('属性', { exact: true }).click();await expect(modal.getByLabel('节点类型',{exact:true})).toHaveValue('数据复核');await modal.getByText('调整接续关系', { exact: true }).click();await modal.getByLabel('接续 阶段结论：保留多模态方案',{exact:true}).check();await modal.getByLabel('节点样式',{exact:true}).selectOption('snapshot');await modal.getByLabel('节点版本',{exact:true}).fill('v0.2');await modal.getByRole('button',{name:'保存',exact:true}).click();
  await expect(page.locator('.rtl-row.is-open')).toContainText('v0.2');
  await page.reload();await page.getByRole('button',{name:'科研课题',exact:true}).click();await chooseTopic(page);await expect(page.locator('.rtl-row')).toHaveCount(9);await expect(page.locator('.rtl-rows')).toContainText('v0.2');expect(errors).toEqual([]);
});

test('过程记录收进所属节点正文，时间按发生时间排序，分支缩放与编辑仍可用', async ({ page }) => {
  const fixture = lineageFixture(), tasks = fixture.topic!.tasks!, base = tasks.find(t => t.id === 'download')!.events[0];
  tasks.find(t => t.id === 'external')!.events = [
    { ...base, id: 'unknown', title: '核查未知完成时间', occurredAt: null, fields: [] },
    { ...base, id: 'done', title: '外部中心下载完成', occurredAt: base.occurredAt! + 3600000, status: 'completed' },
    { ...base, id: 'start', title: '开始准备外部中心' },
  ];
  tasks.find(t => t.id === 'maintenance')!.events = [{ ...base, id: 'leaf', title: '末端节点过程记录' }];
  const errors = await setup(page, fixture);
  const row = page.locator('[data-node="external"]'); await row.locator('.rtl-title').click();
  await expect(row.locator('.rt-event-body h3')).toHaveText(['开始准备外部中心', '外部中心下载完成', '核查未知完成时间']);
  await expect(row.locator('.rt-event-node')).toHaveCount(0);
  await expect(row.getByRole('tablist')).toHaveCount(0);
  await expect(row.locator('textarea')).toHaveCount(0);
  await expect(row.locator('.rt-event-body footer')).toHaveCount(0);
  await expect(row.locator('.rt-event time').last()).not.toHaveAttribute('datetime');
  await row.getByRole('button', { name: '记录菜单 开始准备外部中心', exact: true }).click();await page.getByRole('menuitem', { name: '查看记录来源', exact: true }).click();
  await expect(row.locator('.rt-event').first()).toContainText('2026-10-23 09:05');
  const checkAlignment = async () => {
    const positions = await row.evaluate(el => {
      const entry = el.querySelector('.rtl-entry')!.getBoundingClientRect(), panel = el.querySelector('.rtl-expanded')!.getBoundingClientRect();
      return { entry: entry.x, panel: panel.x, right: panel.right, dates: [...el.querySelectorAll('.rtl-event-date')].map(n => n.getBoundingClientRect().x), bodies: [...el.querySelectorAll('.rt-event-body')].map(n => ({left:n.getBoundingClientRect().x,right:n.getBoundingClientRect().right})) };
    });
    // Header and body share one sheet edge; the process stays inset inside that sheet.
    expect(Math.abs(positions.panel - positions.entry)).toBeLessThan(1);
    for (const x of positions.dates) expect(x).toBeGreaterThan(positions.panel);
    for (const box of positions.bodies) { expect(box.left).toBeGreaterThan(positions.panel); expect(box.right).toBeLessThanOrEqual(positions.right); }
    await expect(page.locator('[data-lineage-events]')).toHaveCount(0);
    await expect(row.locator('.rtl-event-dot')).toHaveCount(0);
  };
  await checkAlignment(); const handle = page.getByRole('separator', { name: '调整分支轨道宽度' }); await handle.focus(); await handle.press('End'); await checkAlignment();
  await row.getByRole('button', { name: '记录菜单 开始准备外部中心', exact: true }).click(); await page.getByRole('menuitem', { name: '编辑记录', exact: true }).click();
  const modal = page.getByRole('group', { name: '编辑记录', exact: true }); await modal.getByLabel('记录名称', { exact: true }).fill('校对后的开始记录'); await modal.getByRole('button', { name: '保存', exact: true }).click();
  await expect(row.locator('.rt-event-body h3').first()).toHaveText('校对后的开始记录');
  await row.getByLabel('节点内容', { exact: true }).selectOption('files'); await expect(row.getByRole('tabpanel', { name: '任务相关文件' })).toBeVisible();
  await expect(page.locator('[data-lineage-events="external"]')).toHaveCount(0);
  await row.getByLabel('节点内容', { exact: true }).selectOption('notes'); await row.getByLabel('任务备注', { exact: true }).fill('需要核查外部中心的样本映射');
  await row.getByLabel('节点内容', { exact: true }).selectOption('timeline'); await checkAlignment();
  await row.getByLabel('节点内容', { exact: true }).selectOption('notes'); await expect(row.getByLabel('任务备注', { exact: true })).toHaveValue('需要核查外部中心的样本映射');
  await row.getByLabel('节点内容', { exact: true }).selectOption('timeline');
  await row.locator('.rtl-title').click(); await expect(row.locator('.rt-event')).toHaveCount(0);
  await page.locator('[data-node="maintenance"] .rtl-title').click(); await expect(page.locator('[data-node="maintenance"] .rt-event')).toHaveCount(1);await expect(page.locator('[data-lineage-events]')).toHaveCount(0);
  for (const width of [1440, 768, 390]) { await page.setViewportSize({ width, height: 900 }); expect(await page.locator('html').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true); }
  expect(errors).toEqual([]);
});
test('折叠保留合流主干，过滤后连线重新定位，表格与总览继续可用',async({page})=>{
  const errors=await setup(page);
  await expect(page.locator('.rtl-fold')).toHaveCount(0);
  const external=page.locator('[data-node="external"]'),title=external.locator('.rtl-title');
  await title.click();await expect(title).toHaveAttribute('aria-expanded','true');await expect(page.locator('.rtl-row')).toHaveCount(8);
  await title.click();await expect(title).toHaveAttribute('aria-expanded','false');await expect(page.locator('.rtl-row')).toHaveCount(8);
  await page.getByRole('button',{name:'节点操作 修正中心 B 样本映射，重跑受影响实验',exact:true}).click();
  await expect(page.getByRole('menuitem',{name:'折叠后续分支',exact:true})).toHaveCount(0);await expect(page.getByRole('menuitem',{name:'展开后续分支',exact:true})).toHaveCount(0);await page.keyboard.press('Escape');
  await foldNodeBranches(page,'并行准备外部中心验证');await expect(page.locator('[data-node="ablation"]')).toHaveCount(0);await expect(page.locator('[data-node="decision"]')).toBeVisible();
  await page.getByRole('button',{name:'节点操作 并行准备外部中心验证',exact:true}).click();await page.getByRole('menuitem',{name:'展开后续分支',exact:true}).click();await expect(page.locator('.rtl-row')).toHaveCount(8);
  await page.getByRole('button',{name:'任务菜单 并行准备外部中心验证',exact:true}).click();await page.getByRole('menuitem',{name:'折叠后续分支',exact:true}).click();await expect(page.locator('[data-node="ablation"]')).toHaveCount(0);await expect(page.locator('[data-node="decision"]')).toBeVisible();
  await page.getByRole('button',{name:'任务菜单 并行准备外部中心验证',exact:true}).click();await page.getByRole('menuitem',{name:'展开后续分支',exact:true}).click();await expect(page.locator('.rtl-row')).toHaveCount(8);
  await external.locator('.rtl-entry').click({button:'right'});await expect(page.getByRole('menuitem',{name:'折叠后续分支',exact:true})).toBeVisible();await page.keyboard.press('Escape');
  await foldNodeBranches(page,'并行准备外部中心验证');
  await page.getByRole('button',{name:'展开分支',exact:true}).click();await expect(page.locator('[data-node="ablation"]')).toBeVisible();
  await page.getByRole('button',{name:'只看主干',exact:true}).click();await expect(page.locator('[data-node="external"]')).toHaveCount(0);await expect(page.locator('[data-node="decision"]')).toBeVisible();await expect(page.locator('[data-lineage-edge="baseline/decision"]')).toHaveCount(1);
  await page.getByRole('button',{name:'只看主干',exact:true}).click();await page.getByLabel('搜索任务').fill('快照');await expect(page.locator('.rtl-row')).toHaveCount(1);await page.getByLabel('搜索任务').fill('');
  await revealResearchFilters(page);await page.getByRole('button',{name:'任务表',exact:true}).click();await expect(page.locator('.rt-table tbody tr')).toHaveCount(8);await chooseResearchScope(page,'课题总览');await expect(page.locator('.rt-project-overview')).toBeVisible();await expect(page.locator('.rt-table tbody tr')).toHaveCount(0);await chooseResearchScope(page,'全部任务');await expect(page.locator('.rt-table tbody tr')).toHaveCount(8);expect(errors).toEqual([]);
});

test('父节点展开的记录局限于内容区，真实子节点与合流仍在主树上', async ({ page }) => {
  const fixture = lineageFixture(), root = fixture.topic!.tasks![0], sample = fixture.topic!.tasks![1].events[0];
  root.events = Array.from({length: 3}, (_, i) => ({...sample, id:`root-${i}`, title:`研究范围记录 ${i+1}`, occurredAt: root.createdAt + i * 3600000}));
  const errors = await setup(page, fixture), parent = page.locator('[data-node="question"]'), child = page.locator('[data-node="download"]');
  await parent.locator('.rtl-title').click();
  const details = parent.getByRole('region', {name:`节点内容 ${root.title}`, exact:true});
  await expect(details.locator('.rt-event')).toHaveCount(3);
  await expect(page.locator('.rtl-dot')).toHaveCount(8); await expect(page.locator('[data-lineage-event]')).toHaveCount(0);
  await expect(parent).toHaveClass(/has-children/); await expect(child).toHaveClass(/has-parents/);
  await expect(page.locator('[data-node="maintenance"]')).toHaveClass(/is-leaf/);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({width,height:900});
    await expect.poll(() => details.evaluate(el => el.style.height)).toBe('auto');
    const bounds = await parent.evaluate(el => {
      const body = el.querySelector('.rtl-expanded')!.getBoundingClientRect(), heading = el.querySelector('.rtl-entry')!.getBoundingClientRect();
      return {left:body.x, right:body.right, bottom:body.bottom, heading:heading.x, records:[...el.querySelectorAll('.rt-event')].map(n=>({x:n.getBoundingClientRect().x,right:n.getBoundingClientRect().right}))};
    });
    expect(Math.abs(bounds.left - bounds.heading)).toBeLessThan(1);
    for (const record of bounds.records) { expect(record.x).toBeGreaterThan(bounds.left); expect(record.right).toBeLessThanOrEqual(bounds.right); }
    expect((await child.boundingBox())!.y).toBeGreaterThanOrEqual(bounds.bottom);
    expect(await details.locator('[data-node]').count()).toBe(0);
    expect(await page.locator('html').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await expect.poll(() => page.locator('[data-lineage-edge="question/download"]').evaluate(el => {
      const path = el as SVGPathElement, svg = path.ownerSVGElement!.getBoundingClientRect(), end = path.getPointAtLength(path.getTotalLength()), dot = document.querySelector('[data-node="download"] [data-lineage-dot]')!.getBoundingClientRect();
      return Math.hypot(end.x+svg.x-dot.x-dot.width/2,end.y+svg.y-dot.y-dot.height/2);
    })).toBeLessThan(2);
  }
  await parent.getByLabel('节点内容', {exact:true}).selectOption('files');
  await expect(details.getByRole('tabpanel', {name:'任务相关文件'})).toBeVisible();
  await expect(child.locator('.rtl-title')).toBeVisible();
  expect(errors).toEqual([]);
});
test('长卷在桌面、平板与手机没有横向越界，窄屏原位编辑可操作',async({page})=>{
  const errors=await setup(page);
  for(const width of [1440,768,390]){
    await page.setViewportSize({width,height:900});
    await expect(page.locator('.rtl-rows')).toBeVisible();expect(await page.locator('html').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await page.screenshot({path:`shots/task-lineage-${width}.png`});
  }
  await page.locator('[data-node="download"] .rtl-title').click();await expect(page.getByRole('button',{name:'追加记录',exact:true})).toBeVisible();await page.getByRole('button',{name:'追加记录',exact:true}).click();await expect(page.getByRole('group',{name:'追加记录',exact:true})).toBeVisible();expect(await page.locator('html').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);expect(errors).toEqual([]);
});

test('添加演示课题不改变原记录，重复添加复用已有演示',async({page})=>{
  const errors=await setup(page);
  const original=await page.evaluate(()=>JSON.parse(localStorage.getItem('research-workbench-v1')!).state.records);
  await page.getByRole('button',{name:'更多任务操作',exact:true}).click();await page.getByRole('menuitem',{name:'添加演示课题',exact:true}).click();
  await expect(page.getByRole('heading',{name:'演示 · 多模态病理研究',exact:true})).toBeVisible();await expect(page.locator('.rtl-row')).toHaveCount(12);
  await page.getByRole('button',{name:'更多任务操作',exact:true}).click();await page.getByRole('menuitem',{name:'添加演示课题',exact:true}).click();
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('research-workbench-v1')!).state.records);
  expect(after.filter((r:{id:string})=>r.id==='demo-research-lineage-v1')).toHaveLength(1);
  expect(after.filter((r:{id:string})=>r.id!=='demo-research-lineage-v1')).toEqual(original);expect(errors).toEqual([]);
});

test('节点单行对齐，拖动左侧轨道只改变分支间距，刷新记忆且正文保持自适应',async({page})=>{
  await page.setViewportSize({width:1600,height:1000});const errors=await setup(page);
  const panel=page.getByRole('region',{name:'课题研究脉络'}), handle=page.getByRole('separator',{name:'调整分支轨道宽度'}), rail=page.locator('.rtl-rail').first();
  const panelWidth=await panel.evaluate(el=>Math.round(el.getBoundingClientRect().width)),availableWidth=await page.locator('.rt-task-list').evaluate(el=>el.getBoundingClientRect().width);expect(panelWidth).toBeGreaterThan(availableWidth*0.9);
  const original=await rail.evaluate(el=>Math.round(el.getBoundingClientRect().width));
  const path=page.locator('[data-lineage-edge="download/external"]'), beforePath=await path.getAttribute('d');
  for(const id of ['download','baseline','decision']){
    const row=page.locator(`[data-node="${id}"]`);
    await revealResearchFilters(page);const fontSize=Number(await page.getByLabel('课题字号',{exact:true}).inputValue());
    expect(await row.evaluate(el=>el.getBoundingClientRect().height)).toBeLessThanOrEqual(14+fontSize*2);
    expect(await row.locator('.rtl-heading').evaluate(el=>{const parts=[...el.children].map(n=>n.getBoundingClientRect());return Math.max(...parts.map(r=>r.y+r.height/2))-Math.min(...parts.map(r=>r.y+r.height/2));})).toBeLessThan(2);
  }
  const box=await handle.boundingBox();if(!box)throw new Error('没有宽度手柄');
  const entry=await page.locator('.rtl-entry').first().boundingBox();expect(Math.abs(box.x+box.width/2-entry!.x)).toBeLessThan(2);
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+105,box.y+box.height/2,{steps:8});await page.mouse.up();
  const width=await rail.evaluate(el=>Math.round(el.getBoundingClientRect().width));expect(width).toBe(original+100);
  expect(await panel.evaluate(el=>Math.round(el.getBoundingClientRect().width))).toBe(panelWidth);
  await expect.poll(()=>path.getAttribute('d')).not.toBe(beforePath);
  expect(await page.evaluate(()=>Number(localStorage.getItem('research-lineage-track-width')))).toBe(width);
  await page.reload();await page.getByRole('button',{name:'科研课题',exact:true}).click();await chooseTopic(page);
  await expect.poll(()=>rail.evaluate(el=>Math.round(el.getBoundingClientRect().width))).toBe(width);
  await handle.focus();await handle.press('ArrowRight');await expect.poll(()=>rail.evaluate(el=>Math.round(el.getBoundingClientRect().width))).toBe(width+8);
  await handle.press('Home');await expect.poll(()=>rail.evaluate(el=>Math.round(el.getBoundingClientRect().width))).toBe(48);
  await handle.dblclick();await expect.poll(()=>rail.evaluate(el=>Math.round(el.getBoundingClientRect().width))).toBe(original);
  await page.locator('[data-node="download"] .rtl-title').click();await expect(page.locator('.rtl-expanded')).toContainText('开始下载');
  expect(await page.locator('html').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);expect(errors).toEqual([]);
});

test('轨道节点菜单接续、线段插入、删除接回及撤销均原子保存', async ({page}) => {
  const errors=await setup(page);
  const tasks=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('research-workbench-v1')!).state.records.find((r:{id:string})=>r.id==='lineage-topic').topic.tasks);
  const before=await tasks();
  await page.getByRole('button',{name:'节点操作 建立可复现的病理基线',exact:true}).click();
  await page.getByRole('menuitem',{name:'接续节点',exact:true}).click();
  let modal=page.getByRole('group',{name:'新建节点',exact:true});
  await expect(modal.getByLabel('接续 建立可复现的病理基线',{exact:true})).toBeChecked();
  await expect(modal.getByLabel('作为并行分支')).not.toBeChecked();
  await modal.getByLabel('节点名称',{exact:true}).fill('轨道中新建后续');await modal.getByRole('button',{name:'保存',exact:true}).click();
  expect((await tasks()).find((t:{title:string})=>t.title==='轨道中新建后续').parentIds).toEqual(['baseline']);
  await page.getByRole('button',{name:'撤销上次脉络操作'}).click();expect(await tasks()).toEqual(before);
  const edge=page.getByRole('button',{name:'插入节点 建立可复现的病理基线 → 阶段结论：保留多模态方案',exact:true});
  await edge.focus();await edge.press('Enter');modal=page.getByRole('group',{name:'插入节点',exact:true});
  await modal.getByLabel('节点名称',{exact:true}).fill('插入复核');await modal.getByRole('button',{name:'保存',exact:true}).click();
  const inserted=(await tasks()).find((t:{title:string})=>t.title==='插入复核');expect(inserted.parentIds).toEqual(['baseline']);
  expect((await tasks()).find((t:{id:string})=>t.id==='decision').parentIds).toEqual([inserted.id,'ablation']);
  await page.getByRole('button',{name:'节点操作 插入复核',exact:true}).click();
  page.once('dialog',d=>d.accept());await page.getByRole('menuitem',{name:'删除节点…',exact:true}).click();
  await expect(page.locator(`[data-node="${inserted.id}"]`)).toHaveCount(0);
  expect((await tasks()).find((t:{id:string})=>t.id==='decision').parentIds).toEqual(['baseline','ablation']);
  await page.getByRole('button',{name:'撤销上次脉络操作'}).click();expect((await tasks()).some((t:{id:string})=>t.id===inserted.id)).toBe(true);
  expect(errors).toEqual([]);
});

test('拖动圆点预览接续，非法循环与 Esc 取消不写入，菜单移动和减少动态效果可用', async ({page}) => {
  const errors=await setup(page);
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('research-workbench-v1')!).state.records.find((r:{id:string})=>r.id==='lineage-topic').topic.tasks);
  const original=await read();
  const drag=async(from:string,to:string,cancel=false)=>{
    const a=await page.locator(`[data-drag-node="${from}"]`).boundingBox(),b=await page.locator(`[data-drag-node="${to}"]`).boundingBox();if(!a||!b)throw new Error('节点没有位置');
    await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(a.x+a.width/2+7,a.y+a.height/2,{steps:3});await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12});
    await expect(page.locator('.rtl-drag-label')).toBeVisible();
    if(cancel)await page.keyboard.press('Escape');await page.mouse.up();await expect(page.locator('.rtl-drag-label')).toHaveCount(0);await expect(page.getByRole('menu')).toHaveCount(0);
  };
  await drag('external','baseline');
  await expect.poll(async()=>(await read()).find((t:{id:string})=>t.id==='external').parentIds).toEqual(['baseline']);
  expect((await read()).find((t:{id:string})=>t.id==='ablation').parentIds).toEqual(['download']);
  expect((await read()).find((t:{id:string})=>t.id==='external').createdAt).toBe(original.find((t:{id:string})=>t.id==='external').createdAt);
  await expect.poll(()=>page.locator('[data-lineage-edge="baseline/external"]').evaluate(el=>{
    const path=el as SVGPathElement,svg=path.ownerSVGElement!.getBoundingClientRect(),end=path.getPointAtLength(path.getTotalLength()),dot=document.querySelector('[data-node="external"] [data-lineage-dot]')!.getBoundingClientRect();
    return Math.hypot(end.x+svg.x-dot.x-dot.width/2,end.y+svg.y-dot.y-dot.height/2);
  })).toBeLessThan(2);
  await page.getByRole('button',{name:'撤销上次脉络操作'}).click();expect(await read()).toEqual(original);
  await drag('question','decision');expect(await read()).toEqual(original);
  await drag('external','baseline',true);expect(await read()).toEqual(original);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.getByRole('button',{name:'节点操作 并行准备外部中心验证',exact:true}).click();await page.getByRole('menuitem',{name:'移动节点…',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'移动节点',exact:true});await modal.getByLabel('节点目标位置').selectOption('baseline');await modal.getByRole('button',{name:'移动',exact:true}).click();
  expect((await read()).find((t:{id:string})=>t.id==='external').parentIds).toEqual(['baseline']);
  await page.reload();await page.getByRole('button',{name:'科研课题',exact:true}).click();await chooseTopic(page);
  expect((await read()).find((t:{id:string})=>t.id==='external').parentIds).toEqual(['baseline']);expect(errors).toEqual([]);
});

test('圆点拖到实际连接线执行插入，独立落点和鼠标悬停加号可操作', async ({page}) => {
  await setup(page);
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('research-workbench-v1')!).state.records.find((r:{id:string})=>r.id==='lineage-topic').topic.tasks);
  const original=await read();
  const source=page.locator('[data-drag-node="maintenance"]'), a=await source.boundingBox();if(!a)throw new Error('节点无位置');
  const edge=page.locator('[data-edge-from="question"][data-edge-to="download"]');
  const middle=await edge.evaluate(el=>{const path=el as SVGPathElement,p=path.getPointAtLength(path.getTotalLength()/2),r=path.ownerSVGElement!.getBoundingClientRect();return {x:r.x+p.x,y:r.y+p.y};});
  await page.mouse.move(middle.x,middle.y);await expect(page.getByRole('button',{name:'在此连接线插入节点'})).toBeVisible();
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(a.x+a.width/2+7,a.y+a.height/2,{steps:3});await page.mouse.move(middle.x,middle.y,{steps:20});
  await expect(page.locator('.rtl-drag-label')).toContainText('插入：');await page.mouse.up();
  await expect.poll(async()=>(await read()).find((t:{id:string})=>t.id==='maintenance').parentIds).toEqual(['question']);
  expect((await read()).find((t:{id:string})=>t.id==='download').parentIds).toEqual(['maintenance']);
  await page.getByRole('button',{name:'撤销上次脉络操作'}).click();expect(await read()).toEqual(original);
  await expect.poll(async()=>Math.abs((await source.boundingBox())!.y-a.y)).toBeLessThan(1);await source.hover();
  const b=await source.boundingBox();if(!b)throw new Error('节点无位置');await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+7,b.y+b.height/2,{steps:3});
  const root=await page.locator('[data-lineage-root]').boundingBox();if(!root)throw new Error('独立落点无位置');await page.mouse.move(root.x+root.width/2,root.y+root.height/2,{steps:12});
  await expect(page.locator('.rtl-drag-label')).toContainText('独立节点');await page.mouse.up();
  await expect.poll(async()=>(await read()).find((t:{id:string})=>t.id==='maintenance').parentIds).toEqual([]);
});

test('节点入口追加进展、编辑、删除支持连续撤销重做，文本输入保留原生撤销', async ({page}) => {
  await setup(page);const row=page.locator('[data-node="download"]');
  const read=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('research-workbench-v1')!).state.records.find((r:{id:string})=>r.id==='lineage-topic').topic.tasks);
  const original=await read();
  await row.locator('.rtl-title').dblclick();let editor=row.getByRole('group',{name:'编辑节点',exact:true});
  await editor.getByLabel('目的与描述',{exact:true}).fill('用于核查跨中心输入');await expect(editor.getByRole('status',{name:'未保存'})).toBeVisible();
  await editor.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'已保存'})).toBeVisible();
  await row.getByRole('button',{name:/添加子节点/}).click();await page.getByRole('menuitem',{name:'追加进展',exact:true}).click();
  editor=row.getByRole('group',{name:'追加记录',exact:true});await expect(editor).toBeVisible();await editor.getByLabel('记录名称',{exact:true}).fill('完整性核查通过');await editor.getByRole('button',{name:'保存',exact:true}).click();
  expect((await read()).find((t:{id:string})=>t.id==='download').events).toHaveLength(2);
  await row.getByRole('button',{name:'记录菜单 完整性核查通过',exact:true}).click();page.once('dialog',d=>d.accept());await page.getByRole('menuitem',{name:'删除记录…',exact:true}).click();
  expect((await read()).find((t:{id:string})=>t.id==='download').events).toHaveLength(1);
  const undo=page.getByRole('button',{name:'撤销上次脉络操作',exact:true}),redo=page.getByRole('button',{name:'重做上次脉络操作',exact:true});
  await undo.click();expect((await read()).find((t:{id:string})=>t.id==='download').events).toHaveLength(2);
  await redo.click();expect((await read()).find((t:{id:string})=>t.id==='download').events).toHaveLength(1);
  await undo.click();await undo.click();expect((await read()).find((t:{id:string})=>t.id==='download').events).toEqual(original.find((t:{id:string})=>t.id==='download').events);
  await undo.click();expect((await read()).find((t:{id:string})=>t.id==='download').description).toBe(original.find((t:{id:string})=>t.id==='download').description);
  await row.locator('.rtl-title').focus();await page.keyboard.press('Control+Shift+z');expect((await read()).find((t:{id:string})=>t.id==='download').description).toBe('用于核查跨中心输入');
  await row.locator('.rtl-title').dblclick();editor=row.getByRole('group',{name:'编辑节点',exact:true});await editor.getByLabel('目的与描述',{exact:true}).fill('仅输入框撤销');await editor.getByLabel('目的与描述',{exact:true}).press('Control+z');await expect(editor).toBeVisible();expect((await read()).find((t:{id:string})=>t.id==='download').description).toBe('用于核查跨中心输入');await editor.getByRole('button',{name:'取消',exact:true}).click();
});

test('各课题恢复折叠、宽度、展开内容和阅读位置，刷新保留草稿且取消后清除', async ({page}) => {
  const fixture=lineageFixture(),tasks=fixture.topic!.tasks!,sample=tasks.at(-1)!;
  for(let i=0;i<185;i++)tasks.push({...structuredClone(sample),id:`checkpoint-${i}`,title:`第 ${i+1} 轮结果复核`,events:[],parentIds:[i?`checkpoint-${i-1}`:sample.id],lineageRank:100+i});
  await setup(page,fixture);
  const row=page.locator('[data-node="checkpoint-40"]');await row.locator('.rtl-title').click();await foldNodeBranches(page,'建立可复现的病理基线');await row.getByLabel('节点内容',{exact:true}).selectOption('files');
  const handle=page.getByRole('separator',{name:'调整分支轨道宽度'});await handle.focus();await handle.press('End');const width=await handle.getAttribute('aria-valuenow');
  const scroller=page.locator('.rtl-scroll');await scroller.evaluate(el=>{el.scrollTop=1200;});await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('research-lineage-view/lineage-topic')!).scrollTop)).toBeGreaterThan(1000);
  const scrollTop=await scroller.evaluate(el=>el.scrollTop);
  await chooseResearchTopic(page,'国家自然科学基金青年科学基金项目');await chooseTopic(page);
  await expect(row.locator('.rtl-title')).toHaveAttribute('aria-expanded','true');await expect(row.getByLabel('节点内容',{exact:true})).toHaveValue('files');
  const collapsed=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('research-lineage-view/lineage-topic')!).collapsed);
  await expect.poll(collapsed).toContain('baseline');
  await expect.poll(()=>scroller.evaluate(el=>el.scrollTop)).toBeCloseTo(scrollTop,0);await expect(handle).toHaveAttribute('aria-valuenow',width!);
  await page.reload();await page.getByRole('button',{name:'科研课题',exact:true}).click();await chooseTopic(page);
  await expect(row.locator('.rtl-title')).toHaveAttribute('aria-expanded','true');await expect.poll(collapsed).toContain('baseline');await expect.poll(()=>scroller.evaluate(el=>el.scrollTop)).toBeCloseTo(scrollTop,0);
  await row.locator('.rtl-title').dblclick();const editor=row.getByRole('group',{name:'编辑节点',exact:true});await editor.getByLabel('目的与描述',{exact:true}).fill('尚待确认的研究目的');
  await page.reload();await page.getByRole('button',{name:'科研课题',exact:true}).click();await chooseTopic(page);await row.locator('.rtl-title').dblclick();await expect(editor.getByLabel('目的与描述',{exact:true})).toHaveValue('尚待确认的研究目的');
  await editor.getByRole('button',{name:'取消',exact:true}).click();await row.locator('.rtl-title').dblclick();await expect(editor.getByLabel('目的与描述',{exact:true})).not.toHaveValue('尚待确认的研究目的');
});

test('跟进原位保存、撤销和筛选，完成节点不计入受阻与等待，刷新保留下一步', async ({page}) => {
  const fixture=lineageFixture(),task=fixture.topic!.tasks!.find(t=>t.id==='download')!;task.status='running';task.updatedAt=Date.now()-9*86400000;task.recordedAt=task.updatedAt;task.events=[];
  const done=fixture.topic!.tasks!.find(t=>t.id==='question')!;done.status='completed';done.blocker='历史问题';done.waitingFor='历史等待';
  await setup(page,fixture);const row=page.locator('[data-node="download"]');await row.locator('.rtl-title').click();await row.getByRole('button',{name:'跟进',exact:true}).click();
  let editor=row.getByRole('group',{name:'编辑节点跟进',exact:true});await editor.getByLabel('下一步',{exact:true}).fill('核查下载与临床信息对应');await editor.getByLabel('预期产物',{exact:true}).fill('可校验的数据清单');await editor.getByLabel('受阻原因',{exact:true}).fill('数据访问权限待批准');await editor.getByLabel('等待结果',{exact:true}).fill('外部中心回复');await editor.getByRole('button',{name:'保存',exact:true}).click();
  await expect(row.getByRole('button',{name:'编辑下一步',exact:true})).toContainText('核查下载与临床信息对应');await expect(row.locator('.rtl-heading .rtl-followup-flag')).toHaveText('受阻');
  await revealResearchFilters(page);const filter=page.getByLabel('跟进筛选');await filter.selectOption('blocked');await expect(page.locator('.rtl-row')).toHaveCount(1);await expect(page.getByRole('navigation',{name:'任务状态筛选'}).getByRole('button',{name:'全部 1',exact:true})).toBeVisible();
  await filter.selectOption('waiting');await expect(page.locator('.rtl-row')).toHaveCount(1);
  await filter.selectOption('stale');await expect(page.locator('.rtl-row[data-node="download"]')).toHaveCount(0);await page.getByRole('button',{name:'清除筛选',exact:true}).click();
  await expect(filter).toHaveValue('all');await row.getByRole('button',{name:'编辑受阻原因',exact:true}).click();editor=row.getByRole('group',{name:'编辑节点跟进',exact:true});await editor.getByLabel('受阻原因',{exact:true}).fill('');await editor.getByLabel('等待结果',{exact:true}).fill('');await editor.getByRole('button',{name:'保存',exact:true}).click();await expect(row.locator('.rtl-heading .rtl-followup-flag')).toHaveCount(0);
  await page.getByRole('button',{name:'撤销上次脉络操作',exact:true}).click();await expect(row.locator('.rtl-heading .rtl-followup-flag')).toHaveText('受阻');
  await page.reload();await page.getByRole('button',{name:'科研课题',exact:true}).click();await chooseTopic(page);await expect(row.getByRole('button',{name:'编辑下一步',exact:true})).toContainText('核查下载与临床信息对应');
});

test('展开收起由高度连续推动条目，收尾不残留间距且不叠加位移动画', async ({page}) => {
  await page.emulateMedia({reducedMotion:'no-preference'});
  const fixture=lineageFixture(),download=fixture.topic!.tasks!.find(task=>task.id==='download')!;
  download.events=[0,1,2].map(index=>({...structuredClone(download.events[0]),id:`progress-${index}`,title:`下载进展 ${index+1}`}));
  const errors=await setup(page,fixture);
  await page.evaluate(()=>document.fonts.ready);
  for(const action of ['expand','collapse']) {
    const frames=await page.evaluate(async()=>{
      const following=document.querySelector<HTMLElement>('[data-node="baseline"]')!;
      const frames:{y:number;mounted:boolean;transform:string;extras:number}[]=[];
      await new Promise<void>(resolve=>{
        let start=0;
        const tick=(now:number)=>{
          const expanded=document.querySelector<HTMLElement>('[data-node="download"] > .rtl-expanded');
          const css=expanded&&getComputedStyle(expanded);
          frames.push({y:following.getBoundingClientRect().y,mounted:!!expanded,transform:getComputedStyle(following).transform,
            extras:css?['paddingTop','paddingBottom','marginTop','marginBottom','borderTopWidth','borderBottomWidth'].reduce((sum,key)=>sum+parseFloat(css[key as keyof CSSStyleDeclaration] as string),0):0});
          if(!start){start=now;document.querySelector<HTMLButtonElement>('[data-node="download"] .rtl-title')!.click();}
          if(now-start>550)resolve();else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return frames;
    });
    expect(frames.every(frame=>frame.transform==='none')).toBe(true);
    expect(frames.every(frame=>frame.extras===0)).toBe(true);
    const direction=action==='expand'?1:-1;
    expect((frames.at(-1)!.y-frames[0].y)*direction).toBeGreaterThan(100);
    expect(frames.slice(1).every((frame,index)=>(frame.y-frames[index].y)*direction>=-1)).toBe(true);
    if(action==='collapse') {
      const removed=frames.findIndex((frame,index)=>index>0&&!frame.mounted&&frames[index-1].mounted);
      expect(removed).toBeGreaterThan(0);
      expect(Math.abs(frames[removed].y-frames[removed-1].y)).toBeLessThan(1);
    }
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('[data-node="download"] .rtl-title').click();
  await expect.poll(()=>page.locator('[data-node="download"] > .rtl-expanded').evaluate(el=>(el as HTMLElement).style.height)).toBe('auto');
  await page.locator('[data-node="download"] .rtl-title').click();
  await expect(page.locator('.rtl-expanded')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('节点状态直接修改保留当前内容，手动记录只追加一次并支持撤销键盘与手机', async ({page}) => {
  const fixture=lineageFixture(),baseline=fixture.topic!.tasks!.find(task=>task.id==='baseline')!;
  baseline.events=[{...structuredClone(fixture.topic!.tasks!.find(task=>task.id==='download')!.events[0]),id:'baseline-evidence',title:'保留基线输入记录'}];
  baseline.notes='保留数据核查备注';baseline.content='## 基线运行记录';
  const errors=await setup(page,fixture);
  const readTasks=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('research-workbench-v1')!).state.records.find((record:{id:string})=>record.id==='lineage-topic').topic.tasks);
  const readBaseline=async()=>(await readTasks()).find((task:{id:string})=>task.id==='baseline');
  const records=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('research-workbench-v1')!).state.records);
  const originalTasks=await readTasks(),original=await readBaseline();
  const download=page.locator('[data-node="download"]'),target=page.locator('[data-node="baseline"]');
  const status=target.getByRole('button',{name:`修改节点状态 ${baseline.title}`,exact:true});
  const selectionUnchanged=async()=>{
    await expect(download.locator('.rtl-title')).toHaveAttribute('aria-expanded','true');
    await expect(target.locator('.rtl-title')).toHaveAttribute('aria-expanded','false');
  };
  await download.locator('.rtl-title').click();await selectionUnchanged();
  await status.click();
  await expect(page.getByRole('menuitemcheckbox')).toHaveText(['待开始','进行中','已完成','已暂停','已取消']);
  await expect(page.getByRole('menuitemcheckbox',{name:'已完成',exact:true})).toHaveAttribute('aria-checked','true');
  await page.getByRole('menuitemcheckbox',{name:'进行中',exact:true}).click();
  await expect(status).toHaveText('进行中');await selectionUnchanged();
  const changed=await readBaseline(),event=changed.events.at(-1);
  expect(changed).toEqual({...original,status:'running',events:changed.events,updatedAt:changed.updatedAt});
  expect(changed.events).toHaveLength(original.events.length+1);expect(changed.events.slice(0,-1)).toEqual(original.events);
  expect(event).toMatchObject({title:'进行中',status:'running',source:'手动',description:'',evidence:'',fields:[]});
  expect(event.occurredAt).toBe(event.recordedAt);expect(event.recordedAt).toBeGreaterThan(original.updatedAt);
  expect((await readTasks()).filter((task:{id:string})=>task.id!=='baseline')).toEqual(originalTasks.filter((task:{id:string})=>task.id!=='baseline'));
  const saved=await records();await status.click();await expect(page.getByRole('menuitemcheckbox',{name:'进行中',exact:true})).toHaveAttribute('aria-checked','true');
  await page.getByRole('menuitemcheckbox',{name:'进行中',exact:true}).click();expect(await records()).toEqual(saved);
  await page.getByRole('button',{name:'撤销上次脉络操作',exact:true}).click();
  expect({...await readBaseline(),updatedAt:0}).toEqual({...original,updatedAt:0});await selectionUnchanged();
  await page.getByRole('button',{name:'重做上次脉络操作',exact:true}).click();
  expect({...await readBaseline(),updatedAt:0}).toEqual({...changed,updatedAt:0});await selectionUnchanged();
  const beforeEscape=await records();await status.focus();await status.press('Enter');
  await expect(page.getByRole('menuitemcheckbox',{name:'进行中',exact:true})).toHaveAttribute('aria-checked','true');
  await page.keyboard.press('Escape');await expect(page.getByRole('menu')).toHaveCount(0);await expect(status).toBeFocused();expect(await records()).toEqual(beforeEscape);
  await page.setViewportSize({width:390,height:900});await expect(status).toBeVisible();await status.click();
  await page.getByRole('menuitemcheckbox',{name:'已暂停',exact:true}).click();await expect(status).toHaveText('已暂停');await selectionUnchanged();
  const mobile=await readBaseline();expect(mobile.status).toBe('paused');expect(mobile.events).toHaveLength(original.events.length+2);expect(mobile.events.slice(0,-1)).toEqual(changed.events);expect(mobile.events.at(-1)).toMatchObject({status:'paused',source:'手动'});
  expect(await page.locator('html').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await page.reload();await page.getByRole('button',{name:'科研课题',exact:true}).click();await chooseTopic(page);
  await expect(status).toHaveText('已暂停');expect(await readBaseline()).toEqual(mobile);await selectionUnchanged();expect(errors).toEqual([]);
});
