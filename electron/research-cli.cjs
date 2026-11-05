#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const schema = require('./research-cli-schema.json');

function parseArgs(argv) {
  const options={},positionals=[],booleans=new Set(['dry-run','archived','help']);
  const allowed=new Set([...booleans,'connection','file','data','request-id','expect-updated-at','topic','node','search','workspace']);
  for(let i=0;i<argv.length;i++) {
    const arg=argv[i];if(!arg.startsWith('--')){positionals.push(arg);continue;}
    const key=arg.slice(2);if(!allowed.has(key))throw new Error(`未知选项 --${key}`);
    if(Object.hasOwn(options,key))throw new Error(`选项重复 --${key}`);
    if(booleans.has(key))options[key]=true;
    else{if(i+1>=argv.length||argv[i+1].startsWith('--'))throw new Error(`--${key} 缺少值`);options[key]=argv[++i];}
  }
  return {options,positionals};
}
function jsonFile(filename) {
  const buffer=fs.readFileSync(filename==='-'?0:filename);if(buffer.length>1024*1024)throw new Error('JSON 文件超过 1 MB');
  return JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/,''));
}
function commandFromArgs(argv) {
  const {options:o,positionals:p}=parseArgs(argv);
  if(o.help||!p.length||['help','schema'].includes(p[0]))return {local:schema};
  if(o.file&&o.data)throw new Error('--file 与 --data 只能选择一种');
  const data=o.file?jsonFile(o.file):o.data?JSON.parse(o.data):undefined;
  let command;
  if(p[0]==='request')command=data;
  else if(p[0]==='apply')command={op:'import.apply',data};
  else if(p[0]==='status'||p[0]==='catalog')command={op:p[0]==='status'?'status':'catalog.get'};
  else {
    const [resource,operation,id,...extra]=p;
    if(extra.length||!['topics','nodes','events'].includes(resource)||!['list','get','create','update','append'].includes(operation))throw new Error('命令无效，请运行 schema 查看格式');
    const ops={topics:['list','get','create','update'],nodes:['list','get','create','update'],events:['append','update']};
    if(!ops[resource].includes(operation))throw new Error('该资源不支持此操作');
    if(['get','update'].includes(operation)&&!id)throw new Error('缺少记录 ID');
    if(!['get','update'].includes(operation)&&id)throw new Error('存在多余的位置参数');
    command={op:`${resource}.${operation}`,...(data!==undefined?{data}:{})};
    if(resource==='topics'&&id)command.topicId=id;
    if(resource==='nodes'&&id)command.nodeId=id;
    if(resource==='events'&&id)command.eventId=id;
    if(o.topic)command.topicId=o.topic;if(o.node)command.nodeId=o.node;
    if(o.search)command.search=o.search;if(o.workspace)command.workspaceId=o.workspace;if(o.archived)command.archived=true;
  }
  if(!command||typeof command!=='object'||Array.isArray(command)||typeof command.op!=='string')throw new Error('缺少有效的命令对象');
  if(o['expect-updated-at']!==undefined){const revision=Number(o['expect-updated-at']);if(!Number.isFinite(revision))throw new Error('updatedAt 须为有效数值');command.expectUpdatedAt=revision;}
  return {command,requestId:o['request-id']||crypto.randomUUID(),dryRun:!!o['dry-run'],connectionFile:o.connection||process.env.RW_CLI_CONNECTION_FILE||path.join(os.homedir(),'.research-workbench','cli.json')};
}
async function run(argv) {
  let parsed;
  try {
    parsed=commandFromArgs(argv);if(parsed.local)return {exitCode:0,body:parsed.local};
    let connection;try{connection=jsonFile(parsed.connectionFile);}catch{throw new Error('未找到 CLI 连接。请先启动新版科研工作台，或使用 --connection 指定其连接文件。');}
    const endpoint=new URL(connection.endpoint);
    if(connection.protocol!=='research-workbench.cli.v1'||endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||endpoint.pathname!=='/'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||typeof connection.token!=='string'||!/^[a-f0-9]{64}$/.test(connection.token))throw new Error('CLI 连接文件无效，已拒绝连接');
    const body=JSON.stringify({requestId:parsed.requestId,command:parsed.command,dryRun:parsed.dryRun});if(Buffer.byteLength(body)>1024*1024)throw new Error('命令超过 1 MB');
    let response;try{response=await fetch(`${endpoint.origin}/v1/command`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${connection.token}`},body,signal:AbortSignal.timeout(15000)});}catch{ return {exitCode:1,body:{ok:false,requestId:parsed.requestId,error:{code:'CONNECTION_FAILED',message:'工作台未响应。若写入结果尚未确认，重试时使用同一 --request-id；请检查工作台是否已启动。'}}}; }
    const result=await response.json();return {exitCode:response.ok&&result.ok?0:1,body:{...result,requestId:parsed.requestId}};
  } catch(e) {return {exitCode:1,body:{ok:false,...(parsed?.requestId?{requestId:parsed.requestId}:{}),error:{code:'INVALID_INPUT',message:e.message}}};}
}
if(require.main===module)run(process.argv.slice(2)).then(({exitCode,body})=>{(exitCode?process.stderr:process.stdout).write(JSON.stringify(body,null,2)+'\n');process.exitCode=exitCode;});
module.exports={commandFromArgs,run};
