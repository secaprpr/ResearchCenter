import { beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { planCliCommand } from '../research-cli-service';
import { executeCliCommand } from '../research-cli';
import { lockCliNode } from '../research-cli-locks';
import { useStore } from '../store';
import { lineageFixture } from './lineageFixture';
import { defaultCategories, defaultTemplates } from '../research-tasks';
import type { CliCommand, CliReceipt } from '../research-cli-types';

const now=Date.parse('2026-10-30T20:00:00+08:00');
const state=()=>({...useStore.getState(),records:[lineageFixture()],taskCategories:defaultCategories(),taskTemplates:defaultTemplates(),cliReceipts:[] as CliReceipt[]});
const request=(command:CliCommand,requestId='request-1',dryRun=false)=>({command,requestId,dryRun,fingerprint:createHash('sha256').update(JSON.stringify(command)).digest('hex')});
const apply=(s:ReturnType<typeof state>,command:CliCommand,id='request-1')=>{const plan=planCliCommand(request(command,id),s,now);if(plan.records&&plan.cliReceipts){s.records=plan.records;s.cliReceipts=plan.cliReceipts;}return plan.result as Record<string,unknown>;};
beforeEach(()=>vi.restoreAllMocks());

it('creates a topic and linked node without using the current UI filter or replacing other records',()=>{
  const s=state(),original=structuredClone(s.records[0]);
  const created=apply(s,{op:'topics.create',data:{title:'跨中心复核',question:'核查下载与分子信息'}},'topic');
  const node=apply(s,{op:'nodes.create',topicId:created.topicId as string,data:{title:'下载外部中心',categoryIds:['data','download'],createdAt:'2026-10-27T10:05:12.345+08:00'}},'node');
  expect(s.records.find(r=>r.id===created.topicId)?.topic?.tasks?.[0].createdAt).toBe(Date.parse('2026-10-27T10:05:12.345+08:00'));
  expect(s.records.find(r=>r.id===original.id)).toEqual(original);
  expect(node.nodeId).toBe('cli-node-node');
});
it('dry run leaves state untouched, retries replay persisted receipts and conflicting IDs fail',()=>{
  const s=state(),command={op:'nodes.update',topicId:'lineage-topic',nodeId:'download',data:{notes:'复核下载范围'}};
  const before=structuredClone(s.records);const preview=planCliCommand(request(command,'stable',true),s,now);
  expect(preview.records).toBeUndefined();expect(s.records).toEqual(before);
  apply(s,command,'stable');const clone=structuredClone({records:s.records,cliReceipts:s.cliReceipts});
  expect(planCliCommand(request(command,'stable'),{...s,...clone},now+1000).result).toMatchObject({replayed:true});
  expect(()=>planCliCommand(request({...command,data:{notes:'不同内容'}},'stable'),s,now)).toThrow('不同内容');
});
it('node patches retain exact times, existing evidence, files and links, while validating graph relations',()=>{
  const s=state(),task=s.records[0].topic!.tasks!.find(t=>t.id==='download')!;task.paperIds=['paper'];task.assetIds=['asset'];const previous=structuredClone(task);
  apply(s,{op:'nodes.update',topicId:'lineage-topic',nodeId:task.id,data:{description:'为了跨中心验证',notes:'保留原始日志'}});
  const next=s.records[0].topic!.tasks!.find(t=>t.id===task.id)!;
  expect(next.events).toEqual(previous.events);expect(next.createdAt).toBe(previous.createdAt);expect(next.paperIds).toEqual(['paper']);expect(next.assetIds).toEqual(['asset']);
  expect(()=>apply(s,{op:'nodes.update',topicId:'lineage-topic',nodeId:'question',data:{parentIds:['decision']}},'cycle')).toThrow('循环');
  expect(()=>apply(s,{op:'nodes.create',topicId:'lineage-topic',data:{title:'错误前置',parentIds:['other-topic-node']}},'missing')).toThrow('当前课题');
});
it('completion timestamps and recorded timestamps stay separate; retry cannot duplicate an event',()=>{
  const s=state(),command={op:'events.append',topicId:'lineage-topic',nodeId:'download',data:{title:'下载完成',occurredAt:'2026-10-28T09:05:01.123+08:00',status:'completed',evidence:'download.log',fields:[{id:'path',label:'实际保存位置',type:'path',value:'/data/final'}]}};
  apply(s,command,'done');apply(s,command,'done');const task=s.records[0].topic!.tasks!.find(t=>t.id==='download')!,event=task.events.at(-1)!;
  expect(task.events).toHaveLength(2);expect(task.status).toBe('completed');expect(event.occurredAt).toBe(Date.parse('2026-10-28T09:05:01.123+08:00'));expect(event.recordedAt).toBe(now);
  expect(()=>apply(s,{...command,data:{title:'缺少发生时间'}},'invalid')).toThrow('发生时间');
});
it('event corrections merge fields and preserve original source, recording time and sub-minute precision',()=>{
  const s=state(),task=s.records[0].topic!.tasks!.find(t=>t.id==='download')!,before=structuredClone(task.events[0]);before.occurredAt!+=12345;task.events[0]=before;
  apply(s,{op:'events.update',topicId:'lineage-topic',nodeId:'download',eventId:before.id,data:{description:'补充核查结果',fields:[{id:'checksum',label:'完整性检查',type:'text',value:'通过'}]}});
  const event=s.records[0].topic!.tasks!.find(t=>t.id==='download')!.events[0];expect(event.fields.slice(0,2)).toEqual(before.fields);expect(event.fields.at(-1)?.value).toBe('通过');expect(event.recordedAt).toBe(before.recordedAt);expect(event.source).toBe(before.source);expect(event.occurredAt).toBe(before.occurredAt);
});
it('event IDs are resolved within the requested node, never another node with the same event ID',()=>{
  const s=state(),tasks=s.records[0].topic!.tasks!,first=tasks.find(t=>t.id==='download')!,second=tasks.find(t=>t.id==='baseline')!;second.events=[structuredClone(first.events[0])];
  apply(s,{op:'events.update',topicId:'lineage-topic',nodeId:'baseline',eventId:'start',data:{title:'基线的核查记录'}});
  expect(s.records[0].topic!.tasks!.find(t=>t.id==='baseline')!.events[0].title).toBe('基线的核查记录');expect(s.records[0].topic!.tasks!.find(t=>t.id==='download')!.events[0].title).toBe('开始下载');
});
it('templates enforce required fields; unknown actual time remains null',()=>{
  const s=state(),base={op:'events.append',topicId:'lineage-topic',nodeId:'download'};
  expect(()=>apply(s,{...base,data:{title:'完成',occurredAt:null,templateId:'download-complete',fields:{}}})).toThrow('实际保存位置');
  apply(s,{...base,data:{title:'已完成，时间待核查',occurredAt:null,templateId:'download-complete',fields:{location:'/data/brca'}}});
  expect(s.records[0].topic!.tasks!.find(t=>t.id==='download')!.events.at(-1)!.occurredAt).toBeNull();
});
it('archived topics, stale revisions and unknown patch keys are rejected without mutation',()=>{
  const s=state(),command={op:'nodes.update',topicId:'lineage-topic',nodeId:'download',data:{notes:'补齐'}};
  const before=structuredClone(s.records);expect(()=>apply(s,{...command,expectUpdatedAt:1})).toThrow('已更新');expect(s.records).toEqual(before);
  expect(()=>apply(s,{...command,data:{events:[]}})).toThrow('不支持字段');s.records[0].archived=true;expect(()=>apply(s,command)).toThrow('归档');
});
it('live edits block writes, while dry-run and read commands remain available',()=>{
  const s=state();useStore.setState({records:s.records,taskCategories:s.taskCategories,taskTemplates:s.taskTemplates,cliReceipts:[]});const release=lockCliNode('lineage-topic','download');
  const command={op:'nodes.update',topicId:'lineage-topic',nodeId:'download',data:{notes:'CLI 补齐'}};
  try{expect(()=>executeCliCommand(request(command))).toThrow('正在界面中编辑');expect(executeCliCommand(request(command,'preview',true))).toMatchObject({dryRun:true});expect(executeCliCommand(request({op:'nodes.get',topicId:'lineage-topic',nodeId:'download'}))).toMatchObject({id:'download'});}finally{release();}
  executeCliCommand(request(command));expect(JSON.parse(localStorage.getItem('research-workbench-v1')!).state.cliReceipts).toHaveLength(1);
});
it('failed persistence rolls records and receipts back instead of returning a false success',()=>{
  const s=state();useStore.setState({records:s.records,cliReceipts:[]});const saved=structuredClone(useStore.getState().records),original=Storage.prototype.setItem;
  let failed=false;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){if(!failed){failed=true;throw new Error('quota');}return original.call(this,key,value);});
  expect(()=>executeCliCommand(request({op:'nodes.update',topicId:'lineage-topic',nodeId:'download',data:{notes:'无法保存'}}))).toThrow('保存失败');expect(useStore.getState().records).toEqual(saved);expect(useStore.getState().cliReceipts).toEqual([]);
});
