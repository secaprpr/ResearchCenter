import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { access, mkdir, writeFile } from 'node:fs/promises';
import type { RecordItem } from '../../types';
import type { TodayData } from '../../today-data';

const require = createRequire(import.meta.url);
const stored = (page: Page): Promise<{ records: RecordItem[]; todayData: Record<string, TodayData> }> => page.evaluate(() => JSON.parse(localStorage.getItem('research-workbench-v1')!).state);

test('file 桌面任务桥接真实创建、编辑、完成并在独立配置重启后保留', async ({ browserName }, info) => {
  test.skip(process.platform !== 'win32' || browserName !== 'chromium', 'Windows Electron file 协议验证');
  test.setTimeout(90_000);
  const profile = info.outputPath('isolated-profile'), connection = info.outputPath('isolated-cli.json');
  await mkdir(profile, { recursive: true });
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), RW_CLI_CONNECTION_FILE: connection };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_START_URL', 'NO_COLOR', 'FORCE_COLOR']) delete env[key];
  const options = { executablePath: require('electron') as string, args: [process.cwd(), `--user-data-dir=${profile}`], env };
  const errors: string[] = [], csp: string[] = [], cspWarnings: string[] = [];
  let app: ElectronApplication | undefined;
  async function launch() {
    app = await _electron.launch(options);
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(profile);
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      // Existing Workbench meta policy includes frame-ancestors, which Chromium
      // ignores in meta delivery. Record that known warning separately; actual
      // enforced CSP/resource failures and JavaScript errors must remain empty.
      if (message.text() === "The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.") cspWarnings.push(message.text());
      else if (message.type() === 'error' && /content security policy|refused to|unsafe-eval|\bcsp\b/i.test(message.text())) csp.push(message.text());
    });
    await expect(page).toHaveURL(/^file:/);
    await expect(page.getByRole('button', { name: '待办事项', exact: true })).toBeVisible();
    await expect.poll(async () => { try { await access(connection); return true; } catch { return false; } }).toBe(true);
    return page;
  }
  async function openToday(page: Page) {
    await page.getByRole('button', { name: '待办事项', exact: true }).click();
    const frame = page.frameLocator('iframe[title="任务中心"]');
    await expect(frame.locator('#today-status')).toContainText(/同步|已保存/);
    await expect(frame.locator('.today-center-workspace')).toBeVisible();
    return frame;
  }
  try {
    let page = await launch(), ui = await openToday(page);
    expect((await stored(page)).records.filter(record => record.typeId === 'todo').length).toBeGreaterThan(0);
    const legacy = await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('research-workbench-v1')!);
      const date = new Date(), day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const record = { id: 'desktop-legacy-todo', typeId: 'todo', workspaceId: saved.state.workspaces[0].id, title: '独立桌面原有待办', content: '原生旧记录的 **证据** 与最后正文。', status: 'active', starred: true, archived: false, fields: [{ id: 'origin', name: '来源', value: 'isolated-fixture' }], priority: 'high', dueDate: day, done: false, planDate: null, planStart: null, planEnd: null, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_100 };
      saved.state.records = [...saved.state.records.filter((item: { typeId: string }) => item.typeId !== 'todo'), record];
      saved.state.todayData = {};
      localStorage.setItem('research-workbench-v1', JSON.stringify(saved));
      return record;
    });
    await page.reload(); ui = await openToday(page);
    await expect(ui.locator('[data-today-task-id="desktop-legacy-todo"]')).toContainText(legacy.title);
    expect((await stored(page)).records.find(record => record.id === legacy.id)).toEqual(legacy);

    await ui.locator('.today-center-new-list').click();
    await ui.getByRole('menuitem', { name: '新建清单', exact: true }).click();
    const dialog = ui.getByRole('dialog', { name:'清单名称',exact:true });
    await dialog.getByRole('textbox',{name:'输入内容',exact:true}).fill('桌面研究清单');
    await dialog.getByRole('button',{name:'确定',exact:true}).click();
    await expect.poll(async () => (await stored(page)).todayData.todo.lists.some(list => list.name === '桌面研究清单')).toBe(true);
    await ui.locator('.today-center-folder-head').filter({ hasText: '默认' }).click();
    await ui.locator('.today-center-main-head').getByRole('button', { name: '更多', exact: true }).click();
    await ui.getByRole('button', { name: '看板视图', exact: true }).click();
    const column = ui.locator('.today-center-folder-board .today-center-board-col').filter({ has: ui.locator('.today-center-board-title').filter({ hasText: '桌面研究清单' }) });
    await column.getByRole('button', { name: '添加任务到 桌面研究清单', exact: true }).click();
    await expect(ui.getByRole('dialog')).toHaveCount(0);
    await expect(column.locator('.today-center-composer')).toBeVisible();
    await column.locator('.today-center-composer-input').fill('独立桌面新建任务'); await column.locator('.today-center-composer-input').press('Enter');
    await expect.poll(async () => (await stored(page)).records.some(record => record.title === '独立桌面新建任务')).toBe(true);
    const created = (await stored(page)).records.find(record => record.title === '独立桌面新建任务')!;
    await ui.locator('.today-center-composer-input').press('Escape');
    await ui.locator('.today-center-sidebar .today-center-side-item').filter({ hasText: '桌面研究清单' }).click();
    const row = ui.locator(`.today-center-task[data-today-task-id="${created.id}"]`);
    await row.click();
    const title = ui.locator('.today-center-detail-pane .today-task-detail-title');
    await title.fill('独立桌面已编辑任务'); await title.press('Tab');
    const body = ui.locator('.today-center-detail-pane .today-task-detail-visual-editor');
    await expect(body).toHaveAttribute('contenteditable', 'true'); await body.fill('独立桌面保留的最后一段正文与核查证据。'); await body.press('Tab');
    await expect.poll(async () => (await stored(page)).records.find(record => record.id === created.id)?.content).toContain('保留的最后一段正文');
    await ui.locator('.today-center-detail-pane .today-task-detail-complete').click();
    await expect.poll(async () => (await stored(page)).records.find(record => record.id === created.id)?.done).toBe(true);
    await ui.locator('.today-center-sidebar .today-center-side-item').filter({ hasText: '已完成' }).click();
    await expect(ui.locator('.today-completed-count')).toHaveText('1 项');
    await ui.locator(`.today-center-task[data-today-task-id="${created.id}"]`).click();
    await expect(ui.locator('.today-center-detail-pane .today-task-detail-title')).toHaveValue('独立桌面已编辑任务');
    await ui.getByRole('button', { name:'关闭任务详情', exact:true }).click();
    await expect(ui.locator('#today-status')).toContainText(/同步|已保存/);
    const before = await stored(page), taskBefore = before.todayData.todo.tasks.find(task => task.id === created.id)!;
    expect(before.todayData.todo.lists.find(list => list.id === taskBefore.listId)?.name).toBe('桌面研究清单');
    expect(taskBefore.done).toBe(true);
    await page.screenshot({ path: info.outputPath('today-file-before-restart.png'), animations: 'disabled' });
    await app!.close(); app = undefined;

    page = await launch(); ui = await openToday(page);
    await ui.locator('.today-center-sidebar .today-center-side-item').filter({ hasText: '桌面研究清单' }).click();
    await ui.locator(`.today-center-task[data-today-task-id="${created.id}"]`).click();
    await expect(ui.locator('.today-center-detail-pane .today-task-detail-title')).toHaveValue('独立桌面已编辑任务');
    await expect(ui.locator('.today-center-detail-pane .today-task-detail-visual-editor')).toContainText('独立桌面保留的最后一段正文与核查证据。');
    const after = await stored(page);
    expect(after.records.find(record => record.id === created.id)).toEqual(before.records.find(record => record.id === created.id));
    expect(after.todayData.todo.tasks.find(task => task.id === created.id)).toEqual(taskBefore);
    expect(after.todayData.todo.lists).toEqual(before.todayData.todo.lists);
    expect(after.records.find(record => record.id === legacy.id)).toEqual(legacy);
    expect(errors).toEqual([]); expect(csp).toEqual([]);
    await page.screenshot({ path: info.outputPath('today-file-after-restart.png'), animations: 'disabled' });
    await writeFile(info.outputPath('file-protocol-report.json'), JSON.stringify({ profile, connection, nativeTask: after.records.find(record => record.id === created.id), taskMetadata: after.todayData.todo.tasks.find(task => task.id === created.id), errors, csp, cspWarnings }, null, 2));
  } finally { await app?.close(); }
});
