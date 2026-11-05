// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require=createRequire(import.meta.url);
const {createCliServer,fingerprint}=require('../../electron/research-cli-server.cjs');
const {commandFromArgs,run}=require('../../electron/research-cli.cjs');
const cleanups:Array<()=>unknown>=[];
afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn();});
async function fixture(){const dir=await mkdtemp(join(tmpdir(),'rw-cli-'));cleanups.push(()=>rm(dir,{recursive:true,force:true}));return {dir,file:join(dir,'connection.json')};}

it('binds a random loopback port, authenticates requests and returns only the dispatch result',async()=>{
  const {file}=await fixture();let calls=0;
  const server=createCliServer({connectionFiles:[file],dispatch:async(envelope:unknown)=>{calls++;return {ok:true,result:envelope};}});cleanups.push(()=>server.close());await server.start();
  const c=JSON.parse(await readFile(file,'utf8')),command={op:'status'},body=JSON.stringify({requestId:'test-1',command});
  expect(new URL(c.endpoint).hostname).toBe('127.0.0.1');
  const rejectedHeaders:Record<string,string>[]=[{Authorization:'Bearer invalid'},{Authorization:`Bearer ${'á'.repeat(64)}`},{Authorization:`Bearer ${c.token}`,Origin:'https://untrusted.example'}];
  for(const headers of rejectedHeaders){
    const response=await fetch(c.endpoint+'/v1/command',{method:'POST',headers:{'Content-Type':'application/json',...headers},body});expect([401,403]).toContain(response.status);
  }
  expect(calls).toBe(0);
  const result=await run(['--connection',file,'status']);expect(result.exitCode).toBe(0);expect(result.body.result.command).toEqual(command);expect(result.body.result.fingerprint).toBe(fingerprint(command));expect(JSON.stringify(result)).not.toContain(c.token);
});
it('request fingerprints ignore JSON property order and discovery cleanup never removes a newer owner',async()=>{
  const {file}=await fixture();expect(fingerprint({op:'x',data:{a:1,b:2}})).toBe(fingerprint({data:{b:2,a:1},op:'x'}));
  const first=createCliServer({connectionFiles:[file],dispatch:async()=>({ok:true})});await first.start();cleanups.push(()=>first.close());
  const second=createCliServer({connectionFiles:[file],dispatch:async()=>({ok:true})});await second.start();cleanups.push(()=>second.close());
  const current=await readFile(file,'utf8');first.close();expect(await readFile(file,'utf8')).toBe(current);
});
it('an unknown write outcome retains the generated request ID so the caller can retry safely',async()=>{
  const {file}=await fixture();
  const server=createCliServer({connectionFiles:[file],dispatch:async()=>{throw new Error('响应中断');}});cleanups.push(()=>server.close());await server.start();
  const result=await run(['--connection',file,'nodes','update','node-1','--topic','topic-1','--data','{"notes":"补齐"}']);
  expect(result.exitCode).toBe(1);expect(result.body.error.code).toBe('OUTCOME_UNKNOWN');expect(result.body.requestId).toMatch(/^[a-f0-9-]{36}$/);
});
it('the CLI preserves paths, IDs, dry runs and optimistic revisions without shell interpolation',async()=>{
  const {dir,file}=await fixture(),input=join(dir,'补充记录.json');await writeFile(input,'\uFEFF'+JSON.stringify({description:'保留 $() 与 ` 引号内容'}));
  const result=commandFromArgs(['--connection',file,'nodes','update','node-1','--topic','topic-1','--file',input,'--dry-run','--request-id','stable','--expect-updated-at','123']);
  expect(result.command).toEqual({op:'nodes.update',topicId:'topic-1',nodeId:'node-1',data:{description:'保留 $() 与 ` 引号内容'},expectUpdatedAt:123});expect(result.requestId).toBe('stable');expect(result.dryRun).toBe(true);
  expect(()=>commandFromArgs(['nodes','update','id','--file',input,'--data','{}'])).toThrow('只能选择');expect(()=>commandFromArgs(['nodes','delete','id'])).toThrow();expect(()=>commandFromArgs(['nodes','update'])).toThrow('ID');
});
it('rejects remote connection files before any request and exposes schema without a running app',async()=>{
  const {file}=await fixture();await writeFile(file,JSON.stringify({protocol:'research-workbench.cli.v1',endpoint:'https://example.org/',token:'a'.repeat(64)}));
  expect((await run(['--connection',file,'status'])).body.error.message).toContain('拒绝连接');
  expect((await run(['schema'])).body.protocol).toBe('research-workbench.cli.v1');
  const unavailable=await run(['--connection',resolve(file,'missing'),'status']);expect(unavailable.exitCode).toBe(1);expect(unavailable.body.error.message).toContain('启动新版');
});
