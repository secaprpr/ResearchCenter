import { expect, test, type Page } from '@playwright/test';
import type { RecordItem } from '../../types';
import { lineageFixture } from '../lineageFixture';
import { chooseResearchTopic, openResearchDirectory, revealResearchFilters } from './researchNavigation';

const sourceTitle = '多模态病理分析';
const secondTitle = '医学智能体评估';

async function setup(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**', route => route.abort());
  await page.addInitScript(() => localStorage.setItem('research-workbench-sidebar-collapsed', 'true'));
  await page.goto('/');
  await expect(page.frameLocator('.port-library-shell iframe').locator('#port-status')).toContainText('已就绪');
  await page.getByRole('button', { name: '科研课题', exact: true }).click();
  await page.evaluate(record => {
    const saved = JSON.parse(localStorage.getItem('research-workbench-v1')!);
    record.typeId = saved.state.types.find((type: { kind: string }) => type.kind === 'project').id;
    record.workspaceId = saved.state.workspaces[0].id;
    const second = structuredClone(record);
    second.id = 'second-topic';
    second.title = '医学智能体评估';
    second.topic!.tasks = [];
    saved.state.records = [
      ...saved.state.records.filter((item: { typeId: string }) => item.typeId !== record.typeId),
      record,
      second,
    ];
    localStorage.setItem('research-workbench-v1', JSON.stringify(saved));
  }, lineageFixture());
  await page.reload();
  await page.getByRole('button', { name: '科研课题', exact: true }).click();
  return errors;
}

async function records(page: Page): Promise<RecordItem[]> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('research-workbench-v1')!).state.records);
}

async function openTopicMenu(page: Page, title: string) {
  const directory = await openResearchDirectory(page);
  await directory.getByRole('button', { name: `课题操作 ${title}`, exact: true }).click();
}

for (const width of [768, 390]) {
  test(`目录打开的新建、CLI、编辑和 Prompt 弹窗可操作 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = await setup(page);
    const directory = await openResearchDirectory(page);
    await directory.getByRole('button', { name: '创建课题', exact: true }).click();
    const create = page.getByRole('dialog', { name: '新建科研课题', exact: true });
    await expect(directory).toBeHidden();
    const createdTitle = `目录新建课题 ${width}`;
    await create.getByLabel('课题名称', { exact: true }).fill(createdTitle);
    await create.getByRole('button', { name: '创建课题', exact: true }).click();
    await expect(create).toHaveCount(0);
    await expect(page.getByRole('heading', { name: createdTitle, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '创建首个节点', exact: true })).toBeVisible();
    expect((await records(page)).filter(record => record.title === createdTitle)).toHaveLength(1);

    await (await openResearchDirectory(page)).getByRole('button', { name: 'CLI 接入', exact: true }).click();
    const cli = page.getByRole('dialog', { name: 'CLI 接入', exact: true });
    await expect(cli).toBeVisible();
    await expect(directory).toBeHidden();
    await cli.getByRole('button', { name: '关闭', exact: true }).last().click();
    await expect(cli).toHaveCount(0);

    await openTopicMenu(page, sourceTitle);
    await page.getByRole('menuitem', { name: '编辑课题', exact: true }).click();
    const edit = page.getByRole('dialog', { name: '编辑课题', exact: true });
    await expect(directory).toBeHidden();
    await expect(edit.getByLabel('课题名称', { exact: true })).toHaveValue(sourceTitle);
    const question = `从 ${width}px 目录修改研究问题`;
    await edit.getByLabel('研究问题', { exact: true }).fill(question);
    await edit.getByRole('button', { name: '保存', exact: true }).click();
    await expect(edit).toHaveCount(0);
    expect((await records(page)).find(record => record.id === 'lineage-topic')!.topic!.question).toBe(question);

    await openTopicMenu(page, sourceTitle);
    await page.getByRole('menuitem', { name: '生成新任务 Prompt', exact: true }).click();
    const prompt = page.getByRole('dialog', { name: '新建任务 · Codex', exact: true });
    await expect(directory).toBeHidden();
    await expect(prompt.getByLabel('任务 Prompt', { exact: true })).toHaveValue(new RegExp(sourceTitle));
    await prompt.getByRole('button', { name: '关闭', exact: true }).last().click();
    await expect(prompt).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('筛选隐藏被编辑节点后仍更新原节点', async ({ page }) => {
  const errors = await setup(page);
  await chooseResearchTopic(page, sourceTitle);
  const original = (await records(page)).find(record => record.id === 'lineage-topic')!.topic!.tasks!;
  const originalTask = original.find(task => task.id === 'download')!;
  await revealResearchFilters(page);
  await page.locator('[data-node="download"] .rtl-title').dblclick();
  const editor = page.getByRole('group', { name: '编辑节点', exact: true });
  await editor.getByLabel('节点名称', { exact: true }).fill('');
  // Invalid text keeps the editor open when the outside filter receives focus.
  await page.getByRole('navigation', { name: '任务状态筛选' }).getByRole('button', { name: /^进行中/ }).click();
  await expect(page.locator('[data-node="download"]')).toHaveCount(0);
  await expect(editor).toBeVisible();
  const title = '补全下载记录并保留原节点身份';
  await editor.getByLabel('节点名称', { exact: true }).fill(title);
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const tasks = (await records(page)).find(record => record.id === 'lineage-topic')!.topic!.tasks!;
  expect(tasks).toHaveLength(original.length);
  expect(tasks.find(task => task.id === 'download')).toMatchObject({
    id: originalTask.id,
    title,
    parentIds: originalTask.parentIds,
    events: originalTask.events,
  });
  expect(tasks.filter(task => task.title === title)).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('切换课题关闭新增编辑器并保留原课题草稿', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  const errors = await setup(page);
  await chooseResearchTopic(page, sourceTitle);
  const before = await records(page);
  await page.getByRole('button', { name: '新建节点', exact: true }).click();
  const editor = page.getByRole('group', { name: '新建节点', exact: true });
  const description = '尚未命名的节点草稿，留在原课题继续整理。';
  await editor.getByLabel('目的与描述', { exact: true }).fill(description);
  await chooseResearchTopic(page, secondTitle);
  await expect(page.getByRole('heading', { name: secondTitle, exact: true })).toBeVisible();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('button', { name: '创建首个节点', exact: true })).toBeVisible();
  expect(await records(page)).toEqual(before);

  await chooseResearchTopic(page, sourceTitle);
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: '新建节点', exact: true }).click();
  await expect(editor.getByLabel('节点名称', { exact: true })).toHaveValue('');
  await expect(editor.getByLabel('目的与描述', { exact: true })).toHaveValue(description);
  await editor.getByRole('button', { name: '取消', exact: true }).click();
  expect(await records(page)).toEqual(before);
  expect(errors).toEqual([]);
});
