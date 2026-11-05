import { expect, test, type Page } from '@playwright/test';
import { lineageFixture } from '../lineageFixture';
import { chooseResearchScope, chooseResearchTopic, openResearchDirectory } from './researchNavigation';

async function setup(page: Page) {
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**',r=>r.abort());
  await page.addInitScript(()=>{localStorage.setItem('research-workbench-sidebar-collapsed','true');localStorage.setItem('research-task-font-size','20');});
  await page.goto('/');await expect(page.frameLocator('.port-library-shell iframe').locator('#port-status')).toContainText('已就绪');
  await page.getByRole('button',{name:'科研课题',exact:true}).click();
  const fixture=lineageFixture();
  fixture.content='# 原始课题笔记\n\n保留研究背景。';fixture.fields=[{id:'owner',name:'负责人',value:'研究者'}];
  fixture.topic!.hypothesis='分子信息可以改善泛化';
  fixture.topic!.papers=[{paperId:'paper-1.md',role:'方法参考',note:'关联备注',linkedAt:1}];
  fixture.topic!.assets=[{id:'cohort',title:'外部中心样本',kind:'dataset',version:'v2',location:'/data/external',notes:'保留原数据位置',createdAt:1,updatedAt:1}];
  fixture.topic!.ideas=[{id:'idea',title:'跨中心校验',content:'## 原始点子',status:'pending',paperIds:[],createdAt:1,updatedAt:1}];
  await page.evaluate(record=>{const saved=JSON.parse(localStorage.getItem('research-workbench-v1')!);record.typeId=saved.state.types.find((t:{kind:string})=>t.kind==='project').id;record.workspaceId=saved.state.workspaces[0].id;saved.state.records=[...saved.state.records.filter((r:{typeId:string})=>r.typeId!==record.typeId),record,{...structuredClone(record),id:'second-topic',title:'医学智能体评估',content:'第二课题笔记',topic:{...structuredClone(record.topic),question:'评估工具调用的可靠性',tasks:[],papers:[],assets:[],ideas:[]}}];localStorage.setItem('research-workbench-v1',JSON.stringify(saved));},fixture);
  await page.reload();await page.getByRole('button',{name:'科研课题',exact:true}).click();
  return errors;
}
const index=(page:Page)=>page.getByRole('navigation',{name:'课题总览列表'});
const open=(page:Page)=>chooseResearchTopic(page,'多模态病理分析');
const records=(page:Page)=>page.evaluate(()=>JSON.parse(localStorage.getItem('research-workbench-v1')!).state.records);

test('总览以课题为主体，就近新建，全部任务明确进入，三种宽度可用',async({page})=>{
  const errors=await setup(page),before=await records(page);
  for(const width of [1440,768,390]){
    await page.setViewportSize({width,height:900});await expect(index(page).locator('.rt-project-summary')).toHaveCount(2);
    await expect(page.getByRole('table',{name:'课题任务'})).toHaveCount(0);await expect(page.getByRole('button',{name:'课题资料',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'新建课题',exact:true})).toBeVisible();
    expect(await page.locator('.content').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    const directory=await openResearchDirectory(page);await expect(directory.getByRole('button',{name:'多模态病理分析',exact:true})).toBeVisible();await expect(directory.getByRole('button',{name:'医学智能体评估',exact:true})).toBeVisible();await chooseResearchScope(page,'课题总览');
  }
  await page.getByLabel('搜索任务').fill('医学智能体');await expect(index(page).locator('.rt-project-summary')).toHaveCount(1);await page.getByLabel('搜索任务').fill('');
  await chooseResearchScope(page,'全部任务');await expect(page.locator('.rt-table tbody tr')).toHaveCount(8);await expect(index(page)).toHaveCount(0);
  await chooseResearchScope(page,'课题总览');await open(page);await expect(page.getByRole('region',{name:'课题研究脉络'})).toBeVisible();
  await chooseResearchScope(page,'课题总览');expect(await records(page)).toEqual(before);
  await page.getByRole('button',{name:'新建课题',exact:true}).click();const form=page.getByRole('dialog',{name:'新建科研课题'});await form.getByLabel('课题名称',{exact:true}).fill('新的研究方向');await form.getByRole('button',{name:'创建课题',exact:true}).click();
  await expect(page.getByRole('heading',{name:'新的研究方向',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'创建首个节点',exact:true})).toBeVisible();
  await chooseResearchScope(page,'课题总览');await expect(index(page).locator('.rt-project-summary')).toHaveCount(3);expect(errors).toEqual([]);
});

test('资料保留在当前课题内，论文文件笔记与原有记录完整可达，切换不改数据',async({page})=>{
  const errors=await setup(page),before=await records(page);await open(page);
  for(const width of [1440,768,390]){
    await page.setViewportSize({width,height:900});await page.getByRole('button',{name:'课题资料',exact:true}).click();
    await expect(page.getByRole('heading',{name:'多模态病理分析',exact:true})).toBeVisible();await expect(page.locator('.topic-workspace,.topic-directory,.topic-page-head')).toHaveCount(0);
    await expect(page.locator('.topic-table')).toContainText('paper-1.md');await page.getByRole('tab',{name:'数据与文件',exact:false}).click();await expect(page.locator('.topic-table')).toContainText('外部中心样本');
    await page.getByRole('combobox',{name:'研究记录',exact:true}).selectOption('overview');await expect(page.getByLabel('核心假设',{exact:true})).toHaveValue('分子信息可以改善泛化');await expect(page.locator('.topic-legacy-fields')).toContainText('研究者');
    await page.getByRole('combobox',{name:'研究记录',exact:true}).selectOption('ideas');await expect(page.locator('.topic-entry-list')).toContainText('跨中心校验');
    await page.getByRole('tab',{name:'课题笔记',exact:true}).click();await expect(page.getByRole('textbox',{name:'研究笔记正文',exact:true})).toContainText('原始课题笔记');
    expect(await page.locator('.content').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await page.getByRole('button',{name:'研究脉络',exact:true}).click();await expect(page.locator('[data-node]')).toHaveCount(8);
  }
  expect(await records(page)).toEqual(before);
  await chooseResearchTopic(page,'医学智能体评估');await page.getByRole('button',{name:'课题资料',exact:true}).click();await expect(page.locator('.topic-table tbody tr')).toHaveCount(0);await expect(page.getByRole('heading',{name:'医学智能体评估',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});

test('归档课题仍通过同一总览浏览和恢复',async({page})=>{
  await setup(page);await index(page).locator('.rt-project-summary').filter({hasText:'医学智能体评估'}).getByRole('button',{name:'课题操作',exact:true}).click();await page.getByRole('menuitem',{name:'归档课题',exact:true}).click();await expect(index(page).locator('.rt-project-summary')).toHaveCount(1);
  await page.getByRole('button',{name:'课题总览操作',exact:true}).click();await page.getByRole('menuitem',{name:'已归档课题',exact:true}).click();await expect(page.getByRole('heading',{name:'已归档课题',exact:true})).toBeVisible();await expect(index(page)).toContainText('医学智能体评估');
  await index(page).getByRole('button',{name:'课题操作',exact:true}).click();await page.getByRole('menuitem',{name:'取消归档',exact:true}).click();await expect(index(page).locator('.rt-project-summary')).toHaveCount(0);
  await page.getByRole('button',{name:'课题总览操作',exact:true}).click();await page.getByRole('menuitem',{name:'返回全部课题',exact:true}).click();await expect(index(page).locator('.rt-project-summary')).toHaveCount(2);
});
