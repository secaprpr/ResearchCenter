import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { RecordItem } from '../../types';
import type { TodayData, TodayTask } from '../../today-data';

test.setTimeout(60_000);

function day(offset = 0) {
  const value = new Date(); value.setDate(value.getDate() + offset);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
function legacy(overrides: Partial<RecordItem> = {}): RecordItem {
  return { id: 'today-legacy', typeId: 'todo', workspaceId: 'ws-default', title: '核对研究数据', content: '## 原始研究记录\n\n保留 **证据** 与路径。',
    status: 'active', starred: true, archived: false, fields: [{ id: 'origin', name: '原始位置', value: '/research/evidence.csv' }], priority: 'high', dueDate: day(), done: false,
    planDate: day(), planStart: '09:30', planEnd: '10:30', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_100, ...overrides };
}
function metadata(records: RecordItem[]): TodayData {
  const tasks: TodayTask[] = records.filter(record => !record.archived).map((record, index) => ({
    id: record.id, title: record.title, content: record.content, done: record.done, priority: record.priority === 'high' ? 1 : 0,
    listId: 'research-list', groupId: 'review-group', parentTaskId: null, startDate: '', dueDate: record.dueDate || '', dueTime: record.planStart || '', endTime: record.planEnd || '',
    tags: ['核查', '共享'], attachments: [], relatedTaskIds: [], relatedNotePaths: [], repeat: null, timelineItems: [], windowStart: '', windowEnd: '',
    createdAt: record.createdAt, updatedAt: record.updatedAt, completedAt: record.done ? Date.now() : null, sortOrder: index * 1000,
  }));
  return { version: 8, composerMode: 'compact', folders: [{ id: 'research-folder', name: '研究安排', pinned: true, order: 0 }],
    lists: [{ id: 'inbox', name: '收集箱', system: true, folderId: null, groups: [], viewMode: 'list', color: 'neutral' },
      { id: 'research-list', name: '研究清单', folderId: 'research-folder', groups: [{ id: 'review-group', name: '待核查', order: 0 }], viewMode: 'list', color: 'blue' }],
    tasks, settings: { centerScale: 1, taskCenterDisplayVersion: 2, taskCenterDisplay: { hideCompleted: false, showDetails: true, hideChecklist: false } } };
}
const uiFor = (page: Page) => page.frameLocator('iframe[title="任务中心"]');
const stored = (page: Page): Promise<{ records: RecordItem[]; todayData: Record<string, TodayData> }> => page.evaluate(() => JSON.parse(localStorage.getItem('research-workbench-v1')!).state);
const nativeTask = async (page: Page, id: string) => (await stored(page)).records.find(record => record.id === id)!;
const savedTask = async (page: Page, id: string) => (await stored(page)).todayData.todo?.tasks.find(task => task.id === id);
async function runtime(page: Page): Promise<TodayData> {
  const frame = page.frames().find(item => item.url().includes('/today.html'))!;
  return frame.evaluate(() => (window as unknown as { __researchToday: { plugin: { data: TodayData } } }).__researchToday.plugin.data);
}
async function openToday(page: Page) {
  await page.getByRole('button', { name: '待办事项', exact: true }).click();
  const ui = uiFor(page);
  await expect(ui.locator('#today-status')).toContainText(/同步|已保存/);
  await expect(ui.locator('.today-center-workspace')).toBeVisible();
  return ui;
}
async function setup(page: Page, records = [legacy()], data?: TodayData) {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**', route => route.abort());
  await page.addInitScript(() => localStorage.setItem('research-workbench-sidebar-collapsed', 'true'));
  await page.goto('/'); await expect(page.getByRole('button', { name: '待办事项', exact: true })).toBeVisible();
  await openToday(page);
  await page.evaluate(({ records, data }) => {
    const saved = JSON.parse(localStorage.getItem('research-workbench-v1')!);
    saved.state.records = [...saved.state.records.filter((record: { typeId: string }) => record.typeId !== 'todo'), ...records];
    if (!saved.state.workspaces.some((workspace: { id: string }) => workspace.id === 'ws-other')) saved.state.workspaces.push({ id: 'ws-other', name: '协作工作区', builtin: false });
    saved.state.todayData = data ? { todo: data } : {};
    localStorage.setItem('research-workbench-v1', JSON.stringify(saved));
  }, { records, data });
  await page.reload(); const ui = await openToday(page);
  return { ui, errors };
}
async function chooseList(ui: FrameLocator, name: string) {
  await ui.locator('.today-center-sidebar .today-center-side-item').filter({ hasText: name }).click();
  await expect(ui.locator('.today-center-list-title-text')).toHaveText(name);
}
const taskRow = (ui: FrameLocator, id: string) => ui.locator(`.today-center-task[data-today-task-id="${id}"]`);
async function addTask(page: Page, ui: FrameLocator, title: string) {
  await ui.locator('.today-center-quick-add').click();
  const input = ui.locator('.today-center-composer-input'); await input.fill(title); await input.press('Enter');
  await expect.poll(async () => (await stored(page)).records.some(record => record.typeId === 'todo' && record.title === title)).toBe(true);
  return (await stored(page)).records.find(record => record.typeId === 'todo' && record.title === title)!;
}
async function promptAction(ui: FrameLocator, label: string, value: string, action: () => Promise<unknown>) {
  await action(); const dialog = ui.getByRole('dialog', { name: label, exact: true });
  await dialog.getByRole('textbox', { name: '输入内容', exact: true }).fill(value);
  await dialog.getByRole('button', { name: '确定', exact: true }).click(); await expect(dialog).toBeHidden();
}
async function display(ui: FrameLocator, name: '列表' | '看板' | '时间线') {
  await ui.locator('.today-center-main-head').getByRole('button', { name: '更多', exact: true }).click();
  await ui.getByRole('button', { name: `${name}视图`, exact: true }).click();
  const panel = ui.locator('.today-center-list-view');
  if (name === '列表') await expect(panel).not.toHaveClass(/is-board|is-timeline/);
  else await expect(panel).toHaveClass(name === '看板' ? /is-board/ : /is-timeline/);
}

async function groupBy(ui: FrameLocator, name: '优先级' | '标签' | '时间') {
  await ui.locator('.today-center-main-head').getByRole('button', { name: '分组与排序', exact: true }).click();
  await ui.locator('.today-center-view-menu').getByRole('menuitem', { name: /^分组/ }).click();
  await ui.locator('.today-center-view-submenu').getByRole('menuitemradio', { name, exact: true }).click();
}

test('旧待办跨工作区迁移不丢正文属性，外部原生编辑重新进入后同步且保留插件元数据', async ({ page }) => {
  const records = [legacy(), legacy({ id: 'today-other', title: '协作中心核查', workspaceId: 'ws-other', done: true }), legacy({ id: 'today-archived', title: '已归档原记录', archived: true })];
  const { ui, errors } = await setup(page, records);
  await chooseList(ui, '收集箱');
  await expect(taskRow(ui, 'today-legacy')).toContainText('核对研究数据'); await expect(taskRow(ui, 'today-other')).toContainText('协作中心核查');
  await expect(taskRow(ui, 'today-archived')).toHaveCount(0);
  expect((await runtime(page)).tasks.find(task => task.id === 'today-legacy')).toMatchObject({ title: records[0].title, content: records[0].content, priority: 1, dueDate: day(), dueTime: '09:30', endTime: '10:30' });
  for (const record of records) expect(await nativeTask(page, record.id)).toEqual(record);
  await taskRow(ui, 'today-legacy').click(); await expect(ui.getByPlaceholder('任务标题', { exact: true })).toHaveValue('核对研究数据');
  await ui.getByPlaceholder('任务标题', { exact: true }).fill('任务中心修改后的标题'); await ui.getByPlaceholder('任务标题', { exact: true }).press('Tab');
  await expect.poll(async () => (await nativeTask(page, 'today-legacy')).title).toBe('任务中心修改后的标题');
  await page.getByRole('button', { name: '工作台总览', exact: true }).click();
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('research-workbench-v1')!);
    Object.assign(saved.state.records.find((record: { id: string }) => record.id === 'today-legacy'), { title: '原生记录外部更新', content: '## 外部保存的最后正文', done: true, priority: 'low', dueDate: '2030-01-15', updatedAt: Date.now() });
    Object.assign(saved.state.todayData.todo.tasks.find((task: { id: string }) => task.id === 'today-legacy'), { tags: ['保留标签'], attachments: ['workbench/evidence.md'] });
    localStorage.setItem('research-workbench-v1', JSON.stringify(saved));
  });
  await page.reload(); await openToday(page); await chooseList(ui, '收集箱');
  await expect(taskRow(ui, 'today-legacy')).toContainText('原生记录外部更新');
  expect((await runtime(page)).tasks.find(task => task.id === 'today-legacy')).toMatchObject({ content: '## 外部保存的最后正文', done: true, priority: 3, dueDate: '2030-01-15', tags: ['保留标签'], attachments: ['workbench/evidence.md'] });
  expect((await nativeTask(page, 'today-legacy')).fields).toEqual(records[0].fields); expect(await nativeTask(page, 'today-archived')).toEqual(records[2]); expect(errors).toEqual([]);
});

test('真实任务中心创建编辑正文和子任务，完成状态写回原生记录并在刷新后保留层级', async ({ page }) => {
  const { ui, errors } = await setup(page); await chooseList(ui, '收集箱');
  const created = await addTask(page, ui, '新增研究任务'); await taskRow(ui, created.id).click();
  const title = ui.locator('.today-center-detail-pane .today-task-detail-title'); await title.fill('已编辑研究任务'); await title.press('Tab');
  const content = ui.locator('.today-center-detail-pane .today-task-detail-visual-editor'); await expect(content).toHaveAttribute('contenteditable', 'true');
  await content.fill('保留这段研究记录与最后输入');
  await page.getByRole('button', { name: '工作台总览', exact: true }).click(); await openToday(page);
  await expect(content).toContainText('保留这段研究记录与最后输入');
  await expect.poll(async () => (await nativeTask(page, created.id)).content).toContain('保留这段研究记录与最后输入');
  await ui.locator('.today-task-detail-footer-actions').getByRole('button', { name: '更多', exact: true }).click(); await ui.locator('.today-task-detail-more-popover').getByRole('button', { name: '子任务', exact: true }).click();
  await ui.getByPlaceholder('添加子任务', { exact: true }).fill('核对样本编号'); await ui.getByPlaceholder('添加子任务', { exact: true }).press('Enter');
  await expect.poll(async () => (await stored(page)).todayData.todo?.tasks.some(task => task.title === '核对样本编号' && task.parentTaskId === created.id)).toBe(true);
  const child = (await stored(page)).todayData.todo.tasks.find(task => task.title === '核对样本编号')!;
  await ui.getByRole('button', { name: '完成 核对样本编号', exact: true }).click(); await expect.poll(async () => (await nativeTask(page, child.id)).done).toBe(true);
  await ui.locator('.today-center-detail-pane .today-task-detail-complete').click(); await expect.poll(async () => (await nativeTask(page, created.id)).done).toBe(true);
  await page.reload(); await openToday(page); await chooseList(ui, '收集箱'); await taskRow(ui, created.id).click();
  await expect(title).toHaveValue('已编辑研究任务'); await expect(content).toContainText('保留这段研究记录与最后输入');
  expect(await savedTask(page, child.id)).toMatchObject({ parentTaskId: created.id, done: true }); expect((await nativeTask(page, created.id)).typeId).toBe('todo'); expect(errors).toEqual([]);
});

test('列表看板时间线日历统计使用同一任务集，搜索和三种窗口宽度不改原生任务', async ({ page }) => {
  const records = [legacy(), legacy({ id: 'today-second', title: '记录已完成核查', done: true })];
  const { ui, errors } = await setup(page, records, metadata(records)); const before = (await stored(page)).records;
  await chooseList(ui, '研究清单'); await expect(taskRow(ui, 'today-legacy')).toBeVisible();
  await ui.getByPlaceholder('搜索任务、标签或清单').fill('核对研究数据'); await expect(taskRow(ui, 'today-legacy')).toBeVisible(); await expect(taskRow(ui, 'today-second')).toBeHidden(); await ui.getByPlaceholder('搜索任务、标签或清单').fill('');
  await display(ui, '看板'); await expect(ui.locator('.today-center-list-view.is-board')).toBeVisible(); await expect(ui.locator('.today-center-board-card-title').filter({ hasText: '核对研究数据' })).toBeVisible();
  await display(ui, '时间线'); await expect(ui.locator('.today-center-list-view.is-timeline')).toBeVisible(); await expect(ui.locator('.today-center-timeline-bar').filter({ hasText: '核对研究数据' })).toBeVisible();
  await display(ui, '列表'); await expect(taskRow(ui, 'today-legacy')).toBeVisible();
  await ui.locator('.today-center-tabs').getByRole('button', { name: '日历', exact: true }).click(); await expect(ui.locator('.today-center-calendar')).toBeVisible(); await expect(ui.locator('.today-center-calendar')).toContainText('核对研究数据');
  await ui.locator('.today-center-tabs').getByRole('button', { name: '统计', exact: true }).click(); await expect(ui.locator('.today-center-stats')).toBeVisible(); await expect(ui.locator('.today-center-stats')).toContainText('期间完成');
  for (const width of [1440, 768, 390]) { await page.setViewportSize({ width, height: 900 }); expect(await page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true); expect(await ui.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true); }
  expect((await stored(page)).records).toEqual(before); expect(errors).toEqual([]);
});

test('日期弹层设置明天与每天重复，完成生成唯一下期并保留原始内容时间和标签', async ({ page }) => {
  const records = [legacy()], data = metadata(records); data.tasks[0].listId = 'inbox'; data.tasks[0].groupId = null;
  const { ui, errors } = await setup(page, records, data); await chooseList(ui, '收集箱'); await taskRow(ui, 'today-legacy').click();
  await ui.locator('.today-center-detail-pane .today-task-detail-date').click(); const picker = ui.locator('.today-task-detail-date-popover');
  await picker.getByRole('button', { name: '明天', exact: true }).click(); await picker.locator('.today-date-option').filter({ hasText: '重复' }).click(); await picker.getByRole('button', { name: '每天', exact: true }).click(); await picker.getByRole('button', { name: '确定', exact: true }).click();
  await expect.poll(async () => (await savedTask(page, 'today-legacy'))?.repeat).toEqual({ type: 'daily' }); await expect.poll(async () => (await nativeTask(page, 'today-legacy')).dueDate).toBe(day(1));
  await ui.getByRole('button', { name: '完成 核对研究数据', exact: true }).click();
  await expect.poll(async () => (await stored(page)).todayData.todo.tasks.filter(task => task.title === records[0].title).length).toBe(2);
  const tasks = (await stored(page)).todayData.todo.tasks, original = tasks.find(task => task.id === 'today-legacy')!, next = tasks.find(task => task.id !== 'today-legacy')!;
  expect(original.done).toBe(true); expect(next).toMatchObject({ title: original.title, content: original.content, done: false, dueDate: day(2), dueTime: '09:30', endTime: '10:30', repeat: { type: 'daily' }, repeatSeriesId: original.id, tags: original.tags });
  expect((await nativeTask(page, next.id)).dueDate).toBe(day(2)); expect((await nativeTask(page, next.id)).content).toBe(records[0].content);
  await page.reload(); await openToday(page); expect((await runtime(page)).tasks.filter(task => task.title === records[0].title)).toHaveLength(2); expect(errors).toEqual([]);
});

test('清单和分组创建、标签批量重命名完整保存，标签操作不改变任务正文', async ({ page }) => {
  const records = [legacy(), legacy({ id: 'today-second', title: '核对外部中心' })], data = metadata(records);
  const { ui, errors } = await setup(page, records, data);
  await ui.locator('.today-center-new-list').click(); await promptAction(ui, '清单名称', '新研究清单', () => ui.getByRole('menuitem', { name: '新建清单', exact: true }).click());
  await expect.poll(async () => (await stored(page)).todayData.todo.lists.some(list => list.name === '新研究清单')).toBe(true);
  const list = ui.locator('.today-center-sidebar .today-center-side-item').filter({ hasText: '新研究清单' }); await list.click({ button: 'right' });
  await promptAction(ui, '分组名称', '结果核查组', () => ui.getByRole('menuitem', { name: '新建分组', exact: true }).click());
  await expect.poll(async () => (await stored(page)).todayData.todo.lists.find(item => item.name === '新研究清单')?.groups.some(group => group.name === '结果核查组')).toBe(true);
  await ui.locator('.today-center-tabs').getByRole('button', { name: '标签', exact: true }).click(); await ui.locator('.today-center-tag-item[data-tag="核查"]').click();
  await ui.getByRole('button', { name: '管理标签 核查', exact: true }).click(); await ui.getByRole('menuitem', { name: '重命名标签', exact: true }).click();
  await ui.getByRole('textbox', { name: '新标签名称', exact: true }).fill('数据核验'); await ui.getByRole('button', { name: '重命名标签', exact: true }).click();
  await expect.poll(async () => (await stored(page)).todayData.todo.tasks.every(task => task.tags.includes('数据核验') && task.tags.includes('共享') && !task.tags.includes('核查'))).toBe(true);
  for (const record of records) expect((await nativeTask(page, record.id)).content).toBe(record.content);
  await page.reload(); await openToday(page); await expect(ui.locator('.today-center-sidebar')).toContainText('新研究清单'); expect((await runtime(page)).tasks.every(task => task.tags.includes('数据核验'))).toBe(true); expect(errors).toEqual([]);
});

test('原生备份恢复保存所有任务中心元数据，插件导入碰撞重映射且重复导入不追加', async ({ page }) => {
  const records = [legacy(), legacy({ id: 'today-child', title: '已有子任务' })], data = metadata(records);
  data.tasks[0].repeat = { type: 'weekly', days: [1, 3] }; data.tasks[0].attachments = ['evidence.csv']; data.tasks[0].relatedNotePaths = ['workbench/research-note.md']; data.tasks[0].relatedTaskIds = ['today-child'];
  data.tasks[0].timelineRole = 'project'; data.tasks[0].windowStart = day(); data.tasks[0].windowEnd = day(7); data.tasks[0].timelineItems = [{ id: 'phase', type: 'phase', title: '验证阶段', startDate: day(), endDate: day(4), date: '' }]; data.tasks[1].parentTaskId = 'today-legacy';
  const { ui, errors } = await setup(page, records, data); await page.getByRole('button', { name: '设置与数据', exact: true }).click();
  const before = await stored(page), download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出 JSON 备份', exact: true }).click();
  const backup = JSON.parse(await readFile(await (await download).path() as string, 'utf8')); expect(backup.todayData.todo).toEqual(before.todayData.todo);
  const confirmed = page.waitForEvent('dialog').then(dialog => dialog.accept()); await page.getByRole('button', { name: '恢复示例数据', exact: true }).click(); await confirmed;
  await expect.poll(async () => (await stored(page)).todayData).toEqual({}); await page.getByRole('button', { name: '设置与数据', exact: true }).click();
  const restore = page.locator('.settings-section').filter({ has: page.getByRole('heading', { name: '数据管理', exact: true }) }).locator('input[type="file"]');
  await restore.setInputFiles({ name: 'isolated-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) }); await expect.poll(async () => (await stored(page)).todayData.todo).toEqual(backup.todayData.todo);
  await openToday(page);
  const imported = metadata([legacy({ title: '来自插件文件的独立任务' }), legacy({ id: 'today-child', title: '导入文件的子任务' })]); imported.tasks[1].parentTaskId = 'today-legacy'; imported.tasks[0].relatedTaskIds = ['today-child'];
  const file = { name: 'fake-today-export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) };
  await ui.locator('#today-host-input').setInputFiles(file); await expect(ui.locator('#today-status')).toContainText('任务已导入当前工作台');
  const after = (await stored(page)).todayData.todo, parent = after.tasks.find(task => task.title === '来自插件文件的独立任务')!, child = after.tasks.find(task => task.title === '导入文件的子任务')!;
  expect(parent.id).not.toBe('today-legacy'); expect(child.id).not.toBe('today-child'); expect(child.parentTaskId).toBe(parent.id); expect(parent.relatedTaskIds).toEqual([child.id]); expect(after.tasks.find(task => task.id === 'today-legacy')?.timelineItems).toEqual(data.tasks[0].timelineItems);
  await ui.locator('#today-host-input').setInputFiles(file); await expect(ui.locator('#today-status')).toContainText('任务已导入当前工作台'); expect((await stored(page)).todayData.todo.tasks).toHaveLength(after.tasks.length);
  expect((await nativeTask(page, 'today-legacy')).fields).toEqual(records[0].fields); expect(errors).toEqual([]);
});

test('清单夹卡片加号原位复用完整新增框，属性、连续添加和取消保持一致', async ({ page }) => {
  const records = [legacy()], data = metadata(records);
  data.folders[0].viewMode = 'board';
  data.lists.push({ id: 'follow-list', name: '跟进清单', folderId: 'research-folder', groups: [], viewMode: 'list', color: 'green' });
  const { ui, errors } = await setup(page, records, data);
  await ui.locator('.today-center-folder-head').filter({ hasText: '研究安排' }).click();
  const column = ui.locator('.today-center-folder-board [data-group-key="list-follow-list"]');
  await column.getByRole('button', { name: '添加任务到 跟进清单', exact: true }).click();
  await expect(ui.getByRole('dialog')).toHaveCount(0);
  const form = column.locator('.today-center-composer'), input = form.locator('.today-center-composer-input');
  await expect(form).toBeVisible(); await expect(ui.locator('.today-center-composer')).toHaveCount(1);
  await expect(input).toHaveAttribute('placeholder', /跟进清单/); await expect(input).toBeFocused();
  const tools = await form.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label') || button.textContent));
  expect(tools).toEqual(['日期与时间', '优先级', '清单', '标签', '附件', '更多', '添加']);
  await expect(form.getByRole('button', { name: '日期与时间', exact: true })).toContainText('今天');
  await expect(form.getByRole('button', { name: '清单', exact: true })).toContainText('跟进清单');
  await expect(form.getByRole('button', { name: '添加', exact: true })).toBeDisabled();
  await input.fill('安排跟进验证');
  await form.getByRole('button', { name: '优先级', exact: true }).click();
  await ui.locator('.today-popover').getByRole('button', { name: '高优先级', exact: true }).click();
  await expect(form.getByRole('button', { name: '优先级', exact: true })).toContainText('高');
  await form.getByRole('button', { name: '标签', exact: true }).click();
  await ui.getByPlaceholder('输入标签', { exact: true }).fill('待核查');
  await ui.locator('.today-popover').getByRole('button', { name: '确定', exact: true }).click();
  await form.getByRole('button', { name: '日期与时间', exact: true }).click();
  await ui.locator('.today-popover').getByRole('button', { name: '明天', exact: true }).click();
  await ui.locator('.today-popover').getByRole('button', { name: '确定', exact: true }).click();
  await expect(form.getByRole('button', { name: '日期与时间', exact: true })).toContainText('明天');
  await form.getByRole('button', { name: '更多', exact: true }).click();
  await ui.locator('.today-popover').getByRole('button', { name: '添加描述', exact: true }).click();
  await form.getByRole('textbox', { name: '任务描述', exact: true }).fill('核对样本编号，保留研究证据。');
  await form.getByRole('button', { name: '添加', exact: true }).click();
  await expect.poll(async () => (await stored(page)).todayData.todo.tasks.find(task => task.title === '安排跟进验证')).toMatchObject({ listId: 'follow-list', groupId: null, content: '核对样本编号，保留研究证据。', priority: 1, tags: ['待核查'], dueDate: day(1), dueTime: '23:59' });
  await expect(input).toHaveValue(''); await expect(input).toBeFocused();
  await input.fill('同一清单连续添加'); await input.press('Enter');
  await expect.poll(async () => (await stored(page)).todayData.todo.tasks.find(task => task.title === '同一清单连续添加')).toMatchObject({ listId: 'follow-list', groupId: null, priority: 0, tags: [], dueDate: day() });
  const beforeCancel = (await stored(page)).records;
  await input.fill('取消的草稿'); await input.press('Escape'); await expect(form).toHaveCount(0);
  expect((await stored(page)).records).toEqual(beforeCancel);
  await column.getByRole('button', { name: '添加任务到 跟进清单', exact: true }).click();
  await ui.locator('.today-center-list-title-text').click(); await expect(form).toHaveCount(0);
  expect((await stored(page)).records).toEqual(beforeCancel);
  await chooseList(ui, '收集箱'); await ui.locator('.today-center-quick-add').click();
  expect(await ui.locator('.today-center-composer').getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label') || button.textContent))).toEqual(tools);
  await page.reload(); await openToday(page);
  expect((await stored(page)).todayData.todo.tasks.filter(task => task.listId === 'follow-list')).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('分组和看板新增使用同一编辑流程并继承分组、优先级、标签或无日期', async ({ page }) => {
  const records = [legacy(), legacy({ id: 'undated', title: '未排期待办', dueDate: null, planDate: null, planStart: null, planEnd: null })], data = metadata(records);
  data.lists[1].viewMode = 'board'; data.lists[1].groups.push({ id: 'finish-group', name: '结果复核', order: 1 });
  const { ui, errors } = await setup(page, records, data);
  await chooseList(ui, '研究清单');
  const review = ui.locator('[data-group-key="group-review-group"]'), finish = ui.locator('[data-group-key="group-finish-group"]');
  await finish.getByRole('button', { name: '添加任务到 结果复核', exact: true }).click();
  const input = ui.locator('.today-center-composer-input');
  await input.fill('保留未提交的复核草稿');
  await review.getByRole('button', { name: '添加任务到 待核查', exact: true }).click();
  await expect(finish.locator('.today-center-composer-input')).toHaveValue('保留未提交的复核草稿');
  await expect(ui.locator('.today-center-composer')).toHaveCount(1);
  await display(ui, '列表');
  await expect(input).toHaveValue('保留未提交的复核草稿');
  await expect(ui.locator('.today-center-composer')).toHaveCount(1);
  await input.press('Escape');
  await display(ui, '看板');
  await finish.getByRole('button', { name: '添加任务到 结果复核', exact: true }).click();
  await input.fill('分组新增的复核任务'); await input.press('Enter');
  await expect.poll(async () => (await stored(page)).todayData.todo.tasks.find(task => task.title === '分组新增的复核任务')).toMatchObject({ listId: 'research-list', groupId: 'finish-group' });
  await input.press('Escape');
  await display(ui, '列表');
  const section = ui.locator('.today-center-list-group-block').filter({ has: ui.locator('.today-center-list-group-title').filter({ hasText: '结果复核' }) });
  await section.getByRole('button', { name: '添加任务到 结果复核', exact: true }).click();
  await expect(section.locator('.today-center-composer')).toBeVisible();
  await input.fill('列表分组也可原位新增'); await input.press('Enter');
  await expect.poll(async () => (await stored(page)).todayData.todo.tasks.find(task => task.title === '列表分组也可原位新增')).toMatchObject({ listId: 'research-list', groupId: 'finish-group' });
  await input.press('Escape'); await display(ui, '看板');
  for (const [mode, key, title, expected] of [
    ['优先级', 'priority-1', '高优先级新增', { priority: 1, groupId: null }],
    ['标签', 'tag-核查', '标签分栏新增', { tags: ['核查'], groupId: null }],
    ['时间', 'time-none', '尚未安排日期的新增', { dueDate: '', dueTime: '', groupId: null }],
  ] as const) {
    await groupBy(ui, mode);
    const column = ui.locator(`.today-center-board-col[data-group-key="${key}"]`);
    await column.locator('.today-center-board-add').click();
    await expect(column.locator('.today-center-composer')).toBeVisible(); await expect(ui.getByRole('dialog')).toHaveCount(0);
    await input.fill(title); await input.press('Enter');
    await expect.poll(async () => (await stored(page)).todayData.todo.tasks.find(task => task.title === title)).toMatchObject({ listId: 'research-list', ...expected });
    await input.fill(`${title}连续添加`); await input.press('Enter');
    await expect.poll(async () => (await stored(page)).todayData.todo.tasks.find(task => task.title === `${title}连续添加`)).toMatchObject({ listId: 'research-list', ...expected });
    await input.press('Escape');
  }
  expect(errors).toEqual([]);
});

test('已完成按实际完成时间汇总含子任务，支持筛选恢复且不推测旧任务时间', async ({ page }) => {
  const completedAt = (offset: number, time: string) => new Date(`${day(offset)}T${time}:00`).getTime();
  const records = [
    legacy({ id: 'done-today', title: '今天完成的逾期核查', done: true, completedAt: completedAt(0, '09:05'), dueDate: day(-20) }),
    legacy({ id: 'done-yesterday', title: '昨天完成的今日计划', done: true, completedAt: completedAt(-1, '16:20'), dueDate: day() }),
    legacy({ id: 'done-unknown', title: '旧数据未记录完成时间', done: true, completedAt: null }),
    legacy({ id: 'pending-parent', title: '尚未结束的研究任务', done: false }),
    legacy({ id: 'done-child', title: '独立完成的样本核查', done: true, completedAt: completedAt(0, '11:30') }),
    legacy({ id: 'archived-done', title: '已归档完成记录', done: true, completedAt: completedAt(0, '12:00'), archived: true }),
  ];
  const data = metadata(records);
  for (const task of data.tasks) task.completedAt = records.find(record => record.id === task.id)?.completedAt ?? null;
  data.tasks.find(task => task.id === 'done-child')!.parentTaskId = 'pending-parent';
  Object.assign(data.tasks.find(task => task.id === 'done-unknown')!, { listId: 'inbox', groupId: null });
  const { ui, errors } = await setup(page, records, data);
  const before = (await stored(page)).records;
  await chooseList(ui, '已完成');
  await expect(ui.locator('.today-center-main .today-center-task')).toHaveCount(4);
  expect(await ui.locator('.today-center-main .today-center-task').evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.todayTaskId))).toEqual(['done-child', 'done-today', 'done-yesterday', 'done-unknown']);
  await expect(taskRow(ui, 'done-child')).toContainText('尚未结束的研究任务');
  await expect(taskRow(ui, 'done-today')).toContainText('09:05');
  await expect(ui.locator('.today-center-main')).toContainText('未记录完成时间');
  await expect(ui.locator('.today-center-quick-add')).toHaveCount(0);
  await ui.getByRole('combobox', { name: '完成时间', exact: true }).selectOption('today');
  await expect(ui.locator('.today-center-main .today-center-task')).toHaveCount(2);
  await expect(taskRow(ui, 'done-yesterday')).toHaveCount(0); await expect(taskRow(ui, 'done-unknown')).toHaveCount(0);
  await ui.getByRole('combobox', { name: '完成任务所属清单', exact: true }).selectOption('inbox');
  await expect(ui.locator('.today-center-main')).toContainText('没有符合条件的已完成任务');
  await ui.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(ui.locator('.today-completed-count')).toHaveText('4 项');
  expect((await stored(page)).records).toEqual(before);
  await taskRow(ui, 'done-child').getByRole('button', { name: '取消完成 独立完成的样本核查', exact: true }).click();
  await expect(taskRow(ui, 'done-child')).toHaveCount(0);
  await expect.poll(async () => (await nativeTask(page, 'done-child')).done).toBe(false);
  expect((await nativeTask(page, 'pending-parent')).done).toBe(false);
  await expect(ui.locator('.today-completed-count')).toHaveText('3 项');
  await page.reload(); await openToday(page); await chooseList(ui, '已完成');
  await expect(ui.locator('.today-center-main .today-center-task')).toHaveCount(3);
  expect((await savedTask(page, 'done-unknown'))?.completedAt).toBeNull(); expect(errors).toEqual([]);
});

test('详情上一条下一条和关闭保存最后输入，搜索后不跳入隐藏任务', async ({ page }) => {
  const records = [legacy({ id: 'detail-a', title: '核对第一批样本' }), legacy({ id: 'detail-b', title: '核对第二批样本', planStart: '10:30', planEnd: '11:30' })], data = metadata(records);
  data.tasks.forEach(task => { task.listId = 'inbox'; task.groupId = null; });
  const { ui, errors } = await setup(page, records, data); await chooseList(ui, '收集箱');
  await taskRow(ui, 'detail-a').click();
  const pane = ui.locator('.today-center-detail-pane'), title = pane.getByPlaceholder('任务标题', { exact: true });
  const body = pane.locator('.today-task-detail-visual-editor');
  await expect(title).toHaveValue('核对第一批样本');
  await expect(pane.getByRole('button', { name: '上一条任务', exact: true })).toBeDisabled();
  await body.fill('未等待自动保存就切换的最后输入 A');
  await pane.getByRole('button', { name: '下一条任务', exact: true }).click();
  await expect(title).toHaveValue('核对第二批样本');
  await expect.poll(async () => (await nativeTask(page, 'detail-a')).content).toContain('最后输入 A');
  await expect(pane.getByRole('button', { name: '下一条任务', exact: true })).toBeDisabled();
  await body.fill('未等待自动保存就关闭的最后输入 B');
  await pane.getByRole('button', { name: '关闭任务详情', exact: true }).click();
  await expect(title).toHaveCount(0);
  await expect.poll(async () => (await nativeTask(page, 'detail-b')).content).toContain('最后输入 B');
  await expect(ui.locator('.today-task-detail-footer-floating')).toHaveCount(0);
  await taskRow(ui, 'detail-a').click(); await expect(body).toContainText('最后输入 A');
  await ui.getByPlaceholder('搜索任务、标签或清单').fill('核对第一批样本');
  await expect(pane.getByRole('button', { name: '下一条任务', exact: true })).toBeDisabled();
  await ui.getByPlaceholder('搜索任务、标签或清单').fill('');
  await expect(pane.getByRole('button', { name: '下一条任务', exact: true })).toBeEnabled();
  await pane.getByRole('button', { name: '下一条任务', exact: true }).click(); await expect(body).toContainText('最后输入 B');
  await page.reload(); await openToday(page); await chooseList(ui, '收集箱'); await taskRow(ui, 'detail-b').click();
  await expect(body).toContainText('最后输入 B'); expect(errors).toEqual([]);
});
