/** Production build, isolated browser storage, synthetic data only. */
import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lineageFixture } from '../src/test/lineageFixture.ts';
const out=resolve('.taste-skill/research-lineage-ui');await mkdir(out,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:0},logLevel:'error'}),browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'}),issues=[],checks=[],screenshots=[],inspector=[];
const style=loc=>loc.evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return {fontFamily:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,lineHeight:s.lineHeight,height:r.height,borderRadius:s.borderRadius};});
page.on('pageerror',e=>issues.push(e.message));await page.route('https://**',r=>r.abort());await page.addInitScript(()=>localStorage.setItem('research-workbench-sidebar-collapsed','true'));
const match=async(name,loc,ref,keys=['fontFamily','fontSize','fontWeight','lineHeight'])=>{await expect(loc).toBeVisible();const actual=await style(loc);checks.push({name,actual});for(const k of keys)if(typeof actual[k]==='number'?Math.abs(actual[k]-ref[k])>0.01:actual[k]!==ref[k])issues.push(`${name}: ${k} ${actual[k]} != ${ref[k]}`);};
let probe,appProbe,judgeApp;const skill=resolve(process.env.USERPROFILE||'','.codex/skills/design-taste-frontend/scripts/lib');
if(existsSync(resolve(skill,'probe.mjs'))){({probe,app:appProbe}=await import(pathToFileURL(resolve(skill,'probe.mjs')).href));({judgeApp}=await import(pathToFileURL(resolve(skill,'rules.mjs')).href));}
const shot=async name=>{await expect.poll(()=>page.locator('.rtl-expanded').evaluateAll(nodes=>nodes.every(el=>el.style.height==='auto'))).toBe(true);if(!await page.locator('html').evaluate(el=>el.scrollWidth<=el.clientWidth))issues.push(name+': document overflow');await page.screenshot({path:resolve(out,name+'.png'),animations:'disabled'});screenshots.push(name);};
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);await page.getByRole('button',{name:'文献库',exact:true}).click();const ui=page.frameLocator('.port-library-shell iframe');await expect(ui.locator('#port-status')).toContainText('已就绪');
  const base=await style(ui.locator('body')),action=await style(ui.locator('.rw-library-header .rw-primary'));
  await page.getByRole('button',{name:'科研课题',exact:true}).click();
  const fixture=lineageFixture(),download=fixture.topic.tasks.find(t=>t.id==='download'),start=download.events[0];
  download.events.push({...start,id:'progress',title:'下载进度更新',occurredAt:start.occurredAt+4*3600000,fields:[{id:'progress',label:'进度',type:'text',value:'68%'},{id:'size',label:'已下载',type:'text',value:'816 GB'}]}, {...start,id:'complete',title:'下载完成并校验',occurredAt:start.occurredAt+23*3600000,status:'completed',fields:[{id:'files',label:'文件数量',type:'number',value:'2418'},{id:'size',label:'总大小',type:'text',value:'1.2 TB'},{id:'check',label:'完整性检查',type:'text',value:'通过'},{id:'path',label:'实际保存位置',type:'path',value:'/data/tcga/brca'}]});download.notes='这是保留的任务备注，不应默认展开为编辑区。';fixture.topic.tasks[0].events=Array.from({length:3},(_,i)=>({...start,id:`scope-${i}`,title:['确定第一轮研究范围','核查可用数据与研究假设','保留主要结局作为分析目标'][i],occurredAt:fixture.topic.tasks[0].createdAt+i*3600000,description:'',fields:[]}));
  await page.evaluate(record=>{const saved=JSON.parse(localStorage.getItem('research-workbench-v1'));record.typeId=saved.state.types.find(t=>t.kind==='project').id;record.workspaceId=saved.state.workspaces[0].id;saved.state.records.unshift(record);localStorage.setItem('research-workbench-v1',JSON.stringify(saved));},fixture);
  await page.reload();await page.getByRole('button',{name:'科研课题',exact:true}).click();await page.getByLabel('任务所属课题').selectOption('lineage-topic');
  await match('Node title',page.locator('[data-node="download"] .rtl-title'),base,['fontFamily','fontSize','lineHeight']);await match('Status capsule',page.locator('.rtl-heading .rt-status').first(),base);
  await match('New task action',page.getByRole('button',{name:'新建节点',exact:true}).first(),action,['fontFamily','fontSize','fontWeight','lineHeight','height','borderRadius']);
  for(const width of [1440,768,390]){
    await page.setViewportSize({width,height:900});await expect(page.locator('.rtl-wires path')).toHaveCount(8);await shot(`collapsed-${width}`);
    const pitch=await page.locator('.rtl-row').nth(1).evaluate(el=>el.getBoundingClientRect().height);checks.push({name:`Row pitch ${width}`,height:pitch});if(pitch>36)issues.push(`Node rows exceed single-line target at ${width}`);
    await page.locator('[data-node="download"] .rtl-title').click();await match('Append action typography',page.getByRole('button',{name:'追加记录',exact:true}),base,['fontFamily']);await expect.poll(()=>page.locator('.rtl-expanded').evaluate(el=>el.style.height)).toBe('auto');await shot(`expanded-${width}`);
    if(probe&&appProbe){const metrics=await page.evaluate(probe),app=await page.evaluate(appProbe);const findings=judgeApp(app,metrics,{width,allow:['dark-sidebar','zebra','numeric-align']});inspector.push({width,findings});for(const f of findings.filter(f=>f.level==='FAIL'))issues.push(`Inspector ${width} ${f.id}: ${f.message}`);}
    await page.locator('[data-node="download"] .rtl-title').click();
  }
  for(const width of [1440,768,390]){
    await page.setViewportSize({width,height:900});await page.locator('[data-node="question"] .rtl-title').click();
    const details=page.getByRole('region',{name:'节点内容 病理与分子信息能否改善跨中心预测？',exact:true});await expect(details.locator('.rt-event')).toHaveCount(3);await expect(details.locator('[data-lineage-event]')).toHaveCount(0);await shot(`parent-scope-${width}`);
    await page.locator('[data-node="question"] .rtl-title').click();
  }
  await page.getByRole('button',{name:'新建节点',exact:true}).first().click();for(const width of [1440,390]){await page.setViewportSize({width,height:900});await shot(`node-form-${width}`);}
  await page.getByRole('group',{name:'新建节点',exact:true}).getByRole('button',{name:'取消',exact:true}).click();await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button',{name:'节点操作 并行准备外部中心验证',exact:true}).click();await shot('node-actions-1440');await page.keyboard.press('Escape');
  const edge=page.locator('[data-edge-from="question"][data-edge-to="download"]');const point=await edge.evaluate(el=>{const p=el.getPointAtLength(el.getTotalLength()/2),r=el.ownerSVGElement.getBoundingClientRect();return {x:r.x+p.x,y:r.y+p.y};});
  await page.mouse.move(point.x,point.y);await expect(page.getByRole('button',{name:'在此连接线插入节点'})).toBeVisible();await shot('edge-insert-1440');
  const a=await page.locator('[data-drag-node="external"]').boundingBox(),b=await page.locator('[data-drag-node="baseline"]').boundingBox();
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(a.x+a.width/2+7,a.y+a.height/2,{steps:3});await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12});await expect(page.locator('.rtl-drag-label')).toContainText('接续');await shot('drag-preview-1440');await page.keyboard.press('Escape');await page.mouse.up();
  await page.getByRole('button',{name:'节点操作 并行准备外部中心验证',exact:true}).click();await page.getByRole('menuitem',{name:'移动节点…',exact:true}).click();await page.getByLabel('节点目标位置').selectOption('baseline');for(const width of [1440,390]){await page.setViewportSize({width,height:900});await shot(`move-dialog-${width}`);}
  await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button',{name:'添加子节点 建立可复现的病理基线',exact:true}).click();await shot('add-child-1440');
  await page.getByRole('menuitem',{name:'新增并行分支',exact:true}).click();await expect(page.getByLabel('节点接续关系')).toContainText('建立可复现的病理基线');
  for(const width of [1440,390]){await page.setViewportSize({width,height:900});await shot(`child-form-${width}`);}
  await page.getByRole('group',{name:'新建节点',exact:true}).getByRole('button',{name:'取消',exact:true}).click();
  await page.setViewportSize({width:1440,height:900});
  await page.locator('[data-node="download"] .rtl-title').click();await page.getByRole('button',{name:'开始下载',exact:true}).click();
  for(const width of [1440,768,390]){await page.setViewportSize({width,height:900});await expect(page.getByRole('group',{name:'编辑记录',exact:true})).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);await shot(`event-editor-${width}`);}
  await page.getByRole('group',{name:'编辑记录',exact:true}).getByRole('button',{name:'取消',exact:true}).click();
  await page.setViewportSize({width:1440,height:900});await page.locator('[data-node="download"] .rtl-title').dblclick();
  for(const width of [1440,390]){await page.setViewportSize({width,height:900});await shot(`node-editor-${width}`);}
  await page.getByRole('group',{name:'编辑节点',exact:true}).getByRole('button',{name:'取消',exact:true}).click();
  await page.evaluate(()=>{const saved=JSON.parse(localStorage.getItem('research-workbench-v1'));saved.state.records.find(r=>r.id==='lineage-topic').topic.tasks=[];localStorage.setItem('research-workbench-v1',JSON.stringify(saved));});
  await page.reload();await page.getByRole('button',{name:'科研课题',exact:true}).click();await page.getByLabel('任务所属课题').selectOption('lineage-topic');
  for(const width of [1440,768,390]){await page.setViewportSize({width,height:900});await expect(page.getByRole('button',{name:'创建首个节点',exact:true})).toBeVisible();await shot(`empty-${width}`);}
  await page.getByRole('button',{name:'创建首个节点',exact:true}).click();await page.getByLabel('节点名称',{exact:true}).fill('确定第一轮研究问题');await page.getByRole('group',{name:'新建节点',exact:true}).getByRole('button',{name:'保存',exact:true}).click();
  await expect(page.getByRole('button',{name:'追加记录',exact:true})).toBeVisible();await page.setViewportSize({width:1440,height:900});await shot('first-node-1440');
}catch(e){issues.push(e.stack||e.message);}finally{await writeFile(resolve(out,'audit.json'),JSON.stringify({checks,screenshots,inspector,issues,exceptions:['Retain the established library palette, serif milestone headings and application rail. Timestamps are identities, not numeric quantities. Synthetic nodes exist only in this disposable browser context.']},null,2));await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
console.log(JSON.stringify({checks:checks.length,screenshots:screenshots.length,issues,report:resolve(out,'audit.json')},null,2));if(issues.length)process.exitCode=1;
