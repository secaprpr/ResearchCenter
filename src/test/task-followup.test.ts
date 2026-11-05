import { expect, it } from 'vitest';
import { matchesFollowup } from '../task-followup';
import { lineageFixture } from './lineageFixture';
import { planCliCommand } from '../research-cli-service';
import { useStore } from '../store';
import { createHash } from 'node:crypto';
import type { CliCommand, CliReceipt } from '../research-cli-types';
import { isResearchTasks } from '../research-tasks';

const now=Date.parse('2026-10-31T20:00:00+08:00');
const request=(command:CliCommand,id='test-request',dryRun=false)=>({command,requestId:id,dryRun,fingerprint:createHash('sha256').update(JSON.stringify(command)).digest('hex')});
it('follow-up filters ignore finished work and use the most recent recorded update for staleness',()=>{
  const task=structuredClone(lineageFixture().topic!.tasks![0]);task.status='running';task.updatedAt=now-8*86400000;task.recordedAt=task.updatedAt;task.events=[];
  expect(matchesFollowup(task,'stale',now)).toBe(true);expect(matchesFollowup(task,'next',now)).toBe(true);
  task.blocker='等待权限';task.waitingFor='外部中心确认';expect(matchesFollowup(task,'blocked',now)).toBe(true);expect(matchesFollowup(task,'waiting',now)).toBe(true);
  task.events=[{...lineageFixture().topic!.tasks![0].events[0],recordedAt:now,occurredAt:now-30*86400000}];expect(matchesFollowup(task,'stale',now)).toBe(false);
  task.nextStep='核查输入';expect(matchesFollowup(task,'next',now)).toBe(false);task.status='completed';expect(matchesFollowup(task,'blocked',now)).toBe(false);expect(matchesFollowup(task,'waiting',now)).toBe(false);
});
it('CLI preview and commit return a bounded change receipt; retries do not create a new receipt',()=>{
  const state={...useStore.getState(),records:[lineageFixture()],cliReceipts:[] as CliReceipt[]};
  const command={op:'nodes.update',topicId:'lineage-topic',nodeId:'download',data:{nextStep:'核查临床信息',blocker:'权限待批准',expectedOutput:'清单与校验日志',waitingFor:''}};
  const preview=planCliCommand(request(command,'followup',true),state,now);expect(preview.records).toBeUndefined();expect(preview.result).toMatchObject({changeCount:1,changes:[{resource:'node',kind:'updated',id:'download',fields:expect.arrayContaining(['nextStep','blocker'])}]});
  const plan=planCliCommand(request(command,'followup'),state,now);const task=plan.records![0].topic!.tasks!.find(t=>t.id==='download')!;
  expect(task.nextStep).toBe('核查临床信息');expect(task.status).toBe(state.records[0].topic!.tasks!.find(t=>t.id==='download')!.status);expect(isResearchTasks([task])).toBe(true);expect(JSON.stringify(plan.result)).not.toContain('权限待批准');
  const saved={...state,records:plan.records!,cliReceipts:plan.cliReceipts!};expect(planCliCommand(request(command,'followup'),saved,now+1).result).toMatchObject({replayed:true,changeCount:1});expect(saved.cliReceipts).toHaveLength(1);
  const cleared=planCliCommand(request({...command,data:{blocker:''}},'clear'),saved,now+2);expect(cleared.records![0].topic!.tasks!.find(t=>t.id==='download')!.blocker).toBe('');expect(cleared.records![0].topic!.tasks!.find(t=>t.id==='download')!.nextStep).toBe(task.nextStep);
});
it('new-node follow-up fields survive import, list and backup validation; invalid values are rejected',()=>{
  const state={...useStore.getState(),records:[lineageFixture()],cliReceipts:[] as CliReceipt[]};
  const created=planCliCommand(request({op:'nodes.create',topicId:'lineage-topic',data:{title:'复核下载',nextStep:'下载后做校验',waitingFor:'下载日志'}}),state,now);
  const task=created.records![0].topic!.tasks!.find(t=>t.id==='cli-node-test-request')!;expect(task.waitingFor).toBe('下载日志');expect(isResearchTasks([task])).toBe(true);
  const listed=planCliCommand(request({op:'nodes.list',topicId:'lineage-topic',search:'下载后做校验'}),{...state,records:created.records!},now);expect(listed.result).toMatchObject([{id:task.id,nextStep:'下载后做校验'}]);
  expect(()=>planCliCommand(request({op:'nodes.update',topicId:'lineage-topic',nodeId:'download',data:{nextStep:3}}),state,now)).toThrow('nextStep');expect(isResearchTasks([{...task,blocker:3}])).toBe(false);
});
it('batch receipts limit details without hiding the total or copying event contents',()=>{
  const state={...useStore.getState(),records:[lineageFixture()],cliReceipts:[] as CliReceipt[]};
  const events=Array.from({length:20},(_,i)=>({title:`阶段 ${i}`,occurredAt:null,description:'长正文不会进入回执'}));
  const plan=planCliCommand(request({op:'events.append',topicId:'lineage-topic',nodeId:'download',data:{events}}),state,now);
  expect(plan.result).toMatchObject({changeCount:20,changesTruncated:true});expect((plan.result as {changes:unknown[]}).changes).toHaveLength(8);expect(JSON.stringify(plan.result)).not.toContain('长正文');
});
