import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const exec=promisify(execFile),require=createRequire(import.meta.url);
test('真实 CLI 创建与补齐同步到桌面，编辑保护、请求去重和重启持久化',async({browserName},info)=>{
  test.skip(process.platform!=='win32'||browserName!=='chromium','Windows 桌面 CLI 验证');
  test.setTimeout(90000);
  const profile=info.outputPath('profile'),connection=info.outputPath('cli.json');await mkdir(profile,{recursive:true});
  const env:Record<string,string>={...Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>e[1]!==undefined)),RW_CLI_CONNECTION_FILE:connection};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_START_URL;
  delete env.NO_COLOR;delete env.FORCE_COLOR;
  const options={executablePath:require('electron') as string,args:[process.cwd(),`--user-data-dir=${profile}`],env};
  let app:ElectronApplication|undefined,sequence=0;
  const cli=async(args:string[],data?:unknown)=>{
    if(data!==undefined){const file=info.outputPath(`payload-${sequence++}.json`);await writeFile(file,JSON.stringify(data));args=[...args,'--file',file];}
    try{const r=await exec(process.execPath,[resolve('electron/research-cli.cjs'),'--connection',connection,...args],{cwd:process.cwd(),env,windowsHide:true});return {code:0,body:JSON.parse(r.stdout)};}
    catch(e){const error=e as {code:number;stderr:string};return {code:error.code,body:JSON.parse(error.stderr)};}
  };
  try {
    app=await _electron.launch(options);let page=await app.firstWindow();
    await expect.poll(async()=>{try{await access(connection);return (await cli(['status'])).code;}catch{return -1;}}).toBe(0);
    const topic=(await cli(['topics','create','--request-id','desktop-topic'],{title:'CLI 自动记录验证',question:'验证命令直写与界面同步'})).body.result.topicId;
    const created=await cli(['nodes','create','--topic',topic,'--request-id','desktop-root'],{title:'下载探索数据',description:'核查跨中心泛化所需输入',nodeType:'数据下载',categoryIds:['data','download'],createdAt:'2026-10-27T10:05:01.234+08:00'});expect(created.code).toBe(0);const root=created.body.result.nodeId;
    const child=await cli(['nodes','create','--topic',topic,'--request-id','desktop-child'],{title:'开始分析',parentIds:[root],nextStep:'核查跨中心输入',expectedOutput:'可复核的分析结果'});expect(child.code).toBe(0);
    const event={title:'下载完成并通过检查',occurredAt:'2026-10-28T09:05:12.345+08:00',evidence:'download.log',status:'completed',fields:[{id:'path',label:'实际保存位置',type:'path',value:'/data/verified'}]};
    expect((await cli(['events','append','--topic',topic,'--node',root,'--request-id','desktop-complete'],event)).code).toBe(0);
    expect((await cli(['events','append','--topic',topic,'--node',root,'--request-id','desktop-complete'],event)).body.result.replayed).toBe(true);
    await page.getByRole('button',{name:'科研课题',exact:true}).click();await page.getByLabel('任务所属课题').selectOption(topic);const row=page.locator(`[data-node="${root}"]`);
    await expect(page.locator('.rtl-row')).toHaveCount(2);await expect(row.locator('.rt-status')).toHaveText('已完成');await row.locator('.rtl-title').click();await expect(row).toContainText('下载完成并通过检查');
    const before=(await cli(['nodes','get',root,'--topic',topic])).body.result;expect(before.events).toHaveLength(1);expect(before.events[0].occurredAt).toBe(Date.parse(event.occurredAt));expect(before.events[0].recordedAt).toBeGreaterThan(before.events[0].occurredAt);
    await row.locator('.rtl-title').dblclick();const editor=row.getByRole('group',{name:'编辑节点',exact:true});await expect(editor).toBeVisible();
    const blocked=await cli(['nodes','update',root,'--topic',topic],{description:'CLI 补齐说明'});expect(blocked.body.error.code).toBe('EDIT_IN_PROGRESS');await editor.getByRole('button',{name:'取消',exact:true}).click();
    const preview=await cli(['nodes','update',root,'--topic',topic,'--dry-run'],{description:'CLI 补齐说明'});expect(preview.body.result.dryRun).toBe(true);expect((await cli(['nodes','get',root,'--topic',topic])).body.result.description).toBe(before.description);
    const patched=await cli(['nodes','update',root,'--topic',topic,'--expect-updated-at',String(before.updatedAt)],{description:'CLI 补齐说明'});expect(patched.code).toBe(0);await expect(row.getByRole('button',{name:'编辑任务描述',exact:true})).toHaveText('CLI 补齐说明');
    const eventId=before.events[0].id;const corrected=await cli(['events','update',eventId,'--topic',topic,'--node',root],{fields:[{id:'count',label:'文件数量',type:'number',value:'2418'}]});expect(corrected.code).toBe(0);await expect(row).toContainText('2418');
    const followup=await cli(['nodes','update',child.body.result.nodeId,'--topic',topic,'--request-id','child-blocked'],{blocker:'访问权限待批准',waitingFor:'数据中心回复'});expect(followup.body.result).toMatchObject({changeCount:1,changes:[{resource:'node',kind:'updated',fields:expect.arrayContaining(['blocker','waitingFor'])}]});
    expect((await cli(['nodes','update',child.body.result.nodeId,'--topic',topic,'--request-id','child-blocked'],{blocker:'访问权限待批准',waitingFor:'数据中心回复'})).body.result.replayed).toBe(true);
    await page.getByLabel('跟进筛选').selectOption('blocked');await expect(page.locator('.rtl-row')).toHaveCount(1);await expect(page.locator('.rtl-row .rtl-title')).toContainText('开始分析');await expect(page.locator('.rtl-followup-flag')).toHaveText('受阻');await page.getByLabel('跟进筛选').selectOption('all');
    await page.getByRole('button',{name:'更多任务操作',exact:true}).click();await page.getByRole('menuitem',{name:'CLI 写入记录',exact:true}).click();const receipts=page.getByRole('dialog',{name:'CLI 写入记录'});await receipts.locator('details').first().locator('summary').click();await expect(receipts.locator('details').first()).toContainText('受阻原因');await expect(receipts.locator('details').first()).toContainText('child-blocked');await receipts.getByRole('button',{name:'关闭',exact:true}).last().click();
    await page.getByRole('button',{name:'更多任务操作',exact:true}).click();await page.getByRole('menuitem',{name:'CLI 接入',exact:true}).click();await expect(page.getByRole('dialog',{name:'CLI 接入'}).getByLabel('CLI Codex 指令')).toHaveValue(new RegExp(topic));
    await page.screenshot({path:info.outputPath('cli-dialog.png'),animations:'disabled'});await page.getByRole('dialog',{name:'CLI 接入'}).getByRole('button',{name:'关闭',exact:true}).last().click();
    await app.close();app=await _electron.launch(options);page=await app.firstWindow();await expect.poll(async()=>{try{return (await cli(['status'])).code;}catch{return -1;}}).toBe(0);
    const saved=(await cli(['nodes','get',root,'--topic',topic])).body.result;expect(saved.description).toBe('CLI 补齐说明');expect(saved.events).toHaveLength(1);expect(saved.events[0].fields).toHaveLength(2);expect(saved.createdAt).toBe(before.createdAt);expect(saved.events[0].recordedAt).toBe(before.events[0].recordedAt);
    expect((await cli(['events','append','--topic',topic,'--node',root,'--request-id','desktop-complete'],event)).body.result.replayed).toBe(true);
    expect((await cli(['nodes','get',root,'--topic',topic])).body.result.events).toHaveLength(1);
  } finally {await app?.close();}
});
