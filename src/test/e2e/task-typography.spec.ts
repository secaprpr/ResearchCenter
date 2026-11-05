import { expect, test } from '@playwright/test';
import { lineageFixture } from '../lineageFixture';
import { chooseResearchScope, chooseResearchTopic, revealResearchFilters } from './researchNavigation';

test('课题字号默认易读、即时调整并记忆，最大字号保持布局和连接线，设置不改研究记录',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**',r=>r.abort());
  await page.addInitScript(()=>localStorage.setItem('research-workbench-sidebar-collapsed','true'));
  await page.goto('/');await expect(page.frameLocator('.port-library-shell iframe').locator('#port-status')).toContainText('已就绪');
  await page.getByRole('button',{name:'科研课题',exact:true}).click();
  await page.evaluate(record=>{const saved=JSON.parse(localStorage.getItem('research-workbench-v1')!);record.typeId=saved.state.types.find((t:{kind:string})=>t.kind==='project').id;record.workspaceId=saved.state.workspaces[0].id;saved.state.records.unshift(record);localStorage.setItem('research-workbench-v1',JSON.stringify(saved));},lineageFixture());
  await page.reload();await page.getByRole('button',{name:'科研课题',exact:true}).click();await chooseResearchTopic(page,'多模态病理分析');await revealResearchFilters(page);
  const records=await page.evaluate(()=>JSON.parse(localStorage.getItem('research-workbench-v1')!).state.records);
  const size=page.getByLabel('课题字号',{exact:true}),row=page.locator('[data-node="download"]');
  const prefix=row.locator('.rtl-title .rt-tag');
  await expect(prefix).toHaveText(['数据']);await expect(prefix).toHaveCSS('font-size','15px');
  await expect(row.locator('.rtl-kind,.rtl-meta .rt-tags')).toHaveCount(0);
  await expect(page.locator('[data-node="baseline"] .rtl-title .rt-tag')).toHaveText(['实验']);
  await expect(size).toHaveValue('15');await expect(row.locator('.rtl-title')).toHaveCSS('font-size','15px');await expect(row.locator('> .rtl-date')).toHaveCSS('font-size','12px');
  const originalHeight=await row.evaluate(el=>el.getBoundingClientRect().height),sidebarSize=await page.getByRole('button',{name:'科研课题',exact:true}).evaluate(el=>getComputedStyle(el).fontSize),toolbarSize=await page.getByRole('button',{name:'研究脉络',exact:true}).evaluate(el=>getComputedStyle(el).fontSize),filterSize=await size.evaluate(el=>getComputedStyle(el).fontSize);
  for(const width of [1440,768,390]){
    await page.setViewportSize({width,height:900});await revealResearchFilters(page);await size.selectOption('20');await expect(row.locator('.rtl-title')).toHaveCSS('font-size','20px');await expect(row.locator('> .rtl-date')).toHaveCSS('font-size',width<600?'11px':'12px');await expect(page.getByRole('button',{name:'研究脉络',exact:true})).toHaveCSS('font-size',toolbarSize);await expect(size).toHaveCSS('font-size',filterSize);
    await expect(prefix).toHaveCSS('font-size','20px');
    expect(await row.locator('.rtl-title').evaluate(el=>{const tag=el.querySelector('.rt-tag')!.getBoundingClientRect(),text=el.querySelector('.rtl-title-text')!.getBoundingClientRect();return tag.right<=text.left&&Math.abs(tag.y+tag.height/2-text.y-text.height/2)<2;})).toBe(true);
    expect(await row.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThan(originalHeight);
    expect(await page.locator('.content').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await expect.poll(()=>page.locator('[data-lineage-edge="question/download"]').evaluate(el=>{const path=el as SVGPathElement,end=path.getPointAtLength(path.getTotalLength()),svg=path.ownerSVGElement!.getBoundingClientRect(),dot=document.querySelector('[data-node="download"] [data-lineage-dot]')!.getBoundingClientRect();return Math.hypot(end.x+svg.x-dot.x-dot.width/2,end.y+svg.y-dot.y-dot.height/2);})).toBeLessThan(2);
    await prefix.click();await expect(row.locator('.rtl-title')).toHaveAttribute('aria-expanded','true');await row.getByRole('button',{name:'跟进',exact:true}).click();const editor=row.getByRole('group',{name:'编辑节点跟进'});await expect(editor.getByLabel('下一步',{exact:true})).toHaveCSS('font-size','20px');await editor.getByRole('button',{name:'取消',exact:true}).click();await row.locator('.rtl-title').click();
  }
  await page.getByRole('button',{name:'更多任务操作',exact:true}).click();await expect(page.getByRole('menuitem',{name:'CLI 写入记录',exact:true})).toHaveCSS('font-size',toolbarSize);await page.getByRole('menuitem',{name:'CLI 写入记录',exact:true}).click();const modal=page.getByRole('dialog',{name:'CLI 写入记录'});await expect(modal).toBeVisible();await modal.getByRole('button',{name:'关闭',exact:true}).last().click();
  await page.setViewportSize({width:1440,height:900});await chooseResearchScope(page,'课题总览');await revealResearchFilters(page);await expect(size).toHaveValue('20');await chooseResearchScope(page,'全部任务');await expect(page.locator('.rt-task-title').first()).toHaveCSS('font-size','20px');
  expect(await page.locator('.rt-table tbody tr').first().locator('time').evaluateAll(nodes=>nodes.every(el=>el.getBoundingClientRect().right<=el.parentElement!.getBoundingClientRect().right))).toBe(true);
  await page.reload();await page.getByRole('button',{name:'科研课题',exact:true}).click();await revealResearchFilters(page);await expect(size).toHaveValue('20');
  await size.selectOption('12');await chooseResearchTopic(page,'多模态病理分析');await expect(row.locator('.rtl-title')).toHaveCSS('font-size','12px');await expect(row.locator('> .rtl-date')).toHaveCSS('font-size','12px');
  await expect(prefix).toHaveCSS('font-size','12px');
  expect(await page.getByRole('button',{name:'科研课题',exact:true}).evaluate(el=>getComputedStyle(el).fontSize)).toBe(sidebarSize);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('research-workbench-v1')!).state.records)).toEqual(records);
  await page.getByRole('button',{name:'文献库',exact:true}).click();expect(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--ui-size').trim())).toBe('13px');
  expect(errors).toEqual([]);
});
