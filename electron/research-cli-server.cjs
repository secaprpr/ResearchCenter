const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const LIMIT = 1024 * 1024;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function fingerprint(command) { return crypto.createHash('sha256').update(JSON.stringify(canonical(command))).digest('hex'); }
function atomicJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = filename + `.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(temporary, filename);
}
function createCliServer({ dispatch, connectionFiles = [], profile = '', onError = () => {} }) {
  const token = crypto.randomBytes(32).toString('hex'); let endpoint = '', closing = false;
  const respond = (res, status, body) => { if (!res.destroyed && !res.writableEnded) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body)); } };
  const error = (res, status, code, message) => respond(res,status,{ok:false,error:{code,message}});
  const server = http.createServer(async (req,res) => {
    if (req.headers.origin || req.headers.host !== new URL(endpoint).host) return error(res,403,'FORBIDDEN','只接受本机 CLI 请求');
    const provided=Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /,''));
    if (provided.length!==Buffer.byteLength(token) || !crypto.timingSafeEqual(provided,Buffer.from(token))) return error(res,401,'UNAUTHORIZED','CLI 连接已失效，请重新读取连接文件');
    if (req.method!=='POST' || req.url!=='/v1/command') return error(res,404,'NOT_FOUND','接口不存在');
    if (!String(req.headers['content-type']||'').startsWith('application/json')) return error(res,415,'INVALID_INPUT','请求须为 application/json');
    let size=0;const chunks=[];
    try {
      for await(const chunk of req) { size+=chunk.length;if(size>LIMIT){error(res,413,'TOO_LARGE','命令超过 1 MB');return;}chunks.push(chunk); }
      let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return error(res,400,'INVALID_INPUT','JSON 无效');}
      if (!input || typeof input!=='object' || Array.isArray(input) || !input.command || typeof input.command!=='object' || Array.isArray(input.command) || typeof input.requestId!=='string' || !/^[\w.:-]{1,160}$/.test(input.requestId) || (input.dryRun!==undefined && typeof input.dryRun!=='boolean')) return error(res,400,'INVALID_INPUT','命令格式无效');
      if(closing)return error(res,503,'UNAVAILABLE','工作台正在退出');
      const result=await dispatch({requestId:input.requestId,command:input.command,dryRun:!!input.dryRun,fingerprint:fingerprint(input.command)});
      const code=result?.error?.code;
      respond(res,result?.ok?200:['CONFLICT','EDIT_IN_PROGRESS'].includes(code)?409:code==='NOT_FOUND'?404:code==='UNAVAILABLE'||code==='OUTCOME_UNKNOWN'?503:400,{...result,requestId:input.requestId});
    } catch(e) { error(res,503,'OUTCOME_UNKNOWN',e.message || '工作台响应中断，请使用同一 requestId 重新读取或重试'); }
  });
  server.requestTimeout=10000;server.headersTimeout=10000;
  const start=()=>new Promise((resolve,reject)=>{
    server.once('error',reject);server.listen(0,'127.0.0.1',()=>{
      endpoint=`http://127.0.0.1:${server.address().port}`;
      try { for(const file of connectionFiles)atomicJson(file,{protocol:'research-workbench.cli.v1',endpoint,token,pid:process.pid,profile,startedAt:new Date().toISOString()});resolve(endpoint); }
      catch(e){server.close();reject(e);}
    });
  });
  const close=()=>{closing=true;server.close();for(const file of connectionFiles){try{if(JSON.parse(fs.readFileSync(file,'utf8')).token===token)fs.unlinkSync(file);}catch{ /* Another profile may own the active discovery file. */ }}};
  server.on('error',onError);
  return {start,close,get endpoint(){return endpoint;}};
}

function registerResearchCli(app, handleTrusted, onTrusted, getWindow) {
  const pending=new Map();let runtime=null,lastError='';
  const connectionFile=path.join(app.getPath('userData'),'research-cli.json');
  const activeFile=process.env.RW_CLI_CONNECTION_FILE || path.join(os.homedir(),'.research-workbench','cli.json');
  const dispatch=envelope=>new Promise((resolve,reject)=>{
    const win=getWindow();if(!win || win.isDestroyed() || win.webContents.isLoadingMainFrame())return resolve({ok:false,error:{code:'UNAVAILABLE',message:'工作台尚未准备好，请等待界面加载后重试'}});
    if(pending.size>=32)return resolve({ok:false,error:{code:'UNAVAILABLE',message:'待处理命令过多，请稍后重试'}});
    const id=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(new Error('命令响应超时，结果尚未确认；重试须保留原 requestId'));},10000);
    pending.set(id,{resolve,timer,senderId:win.webContents.id});win.webContents.send('research:cli-command',{id,envelope});
  });
  onTrusted('research:cli-result',(event,id,result)=>{
    const entry=pending.get(id);if(!entry || entry.senderId!==event.sender.id)return;
    clearTimeout(entry.timer);pending.delete(id);entry.resolve(result);
  });
  const cliFile=app.isPackaged?path.join(process.resourcesPath,'cli','research-cli.cjs'):path.join(__dirname,'research-cli.cjs');
  handleTrusted('research:cli-info',()=>({ready:!!runtime?.endpoint,connectionFile,command:`node "${cliFile}" --connection "${connectionFile}"`,error:lastError}));
  app.whenReady().then(async()=>{
    runtime=createCliServer({dispatch,connectionFiles:[...new Set([connectionFile,activeFile])],profile:app.getPath('userData'),onError:e=>{lastError=e.message;}});
    try{await runtime.start();}catch(e){lastError=e.message;console.error('Research CLI unavailable:',e.message);}
  });
  app.on('before-quit',()=>{runtime?.close();for(const {resolve,timer}of pending.values()){clearTimeout(timer);resolve({ok:false,error:{code:'OUTCOME_UNKNOWN',message:'工作台正在退出，使用同一 requestId 重试以确认结果'}});}pending.clear();});
}
module.exports={createCliServer,registerResearchCli,fingerprint};
