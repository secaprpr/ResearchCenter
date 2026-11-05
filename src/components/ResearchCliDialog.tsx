import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { cliBridge } from '../research-cli';
import type { RecordItem } from '../types';
import type { ResearchTask } from '../research-tasks';
import { Modal } from './Modal';

export function ResearchCliDialog({ topic, task, close }: {topic?: RecordItem;task?: ResearchTask;close:()=>void}) {
  const [command,setCommand]=useState(''),[error,setError]=useState(''),[copied,setCopied]=useState(false);
  useEffect(()=>{
    let alive=true;
    const bridge=cliBridge();
    if(!bridge?.researchCliInfo){setError('请重启桌面工作台后启用 CLI');return;}
    bridge.researchCliInfo().then(info=>{if(alive){if(info.ready)setCommand(info.command);else setError('CLI 尚未就绪，请重启工作台后重试');}}).catch(e=>{if(alive)setError(e.message);});
    return()=>{alive=false;};
  },[]);
  const prompt=command?`请使用本机科研工作台 CLI 整理并补齐当前工作的记录，直接写入软件。
CLI 命令前缀：${command}
${topic?`目标课题：${topic.title}\n课题 ID：${topic.id}`:'先列出课题，确认本次工作的正确归属。'}
${task?`目标节点：${task.title}\n节点 ID：${task.id}`:''}

先运行 status、schema 和 catalog，按准确 ID 读取现有课题、节点及记录，再决定追加或修正。所有输入均用 UTF-8 JSON 文件通过 --file 提交；先用 --dry-run 验证，再用同一 --request-id 和相同输入写入。更新已有节点或事件时，使用读取到的节点 updatedAt 作为 --expect-updated-at；更新课题时使用课题 updatedAt，防止覆盖后续修改。
先用 nodes list 搜索并读取已有节点，优先延续同一项工作；只有没有对应节点时才创建，不能每次询问进度都新建任务。
补充目的、输入输出位置、来源、参数、结果等有依据的信息。节点 expectedOutput 记录预期产物，nextStep 记录下一步，blocker 记录受阻原因，waitingFor 记录正在等待的外部结果；已解除的受阻或等待要明确清空对应字段。它们不会自动把节点改成已完成。保留未提供字段和已有关系。类别是标签，节点类型可以自由命名。没有依据时不推断父子关系，不删除或重写整棵树。
事件 occurredAt 使用日志或输出文件核实的真实发生时间，带时区；无法确认就填 null，evidence 写明依据。禁止用本次补录时间冒充完成时间；recordedAt 由软件生成。只有验证完成时才记录 completed。
保存每条写入的 requestId；遇到超时必须复用同一 ID 重试，不能换 ID 重复追加。目标正在界面编辑时先停止对该节点写入，保留待补充内容。
完成后根据返回的 changes、changeCount 报告新增或修正了哪些记录，并报告课题、节点、事件 ID 和 requestId。重复请求返回 replayed 时不得声称再次新增。`:'';
  return <Modal title="CLI 接入" onClose={close} footer={<><button className="btn btn-ghost" onClick={close}>关闭</button><button className="btn btn-primary" disabled={!prompt} onClick={()=>{void navigator.clipboard.writeText(prompt).then(()=>setCopied(true)).catch(e=>setError(e.message));}}><Copy size={14}/>{copied?'已复制':'复制给 Codex'}</button></>}><div className="rt-form rt-prompt-dialog">{error?<p className="rt-error" role="alert">{error}</p>:<textarea className="rt-code" aria-label="CLI Codex 指令" value={prompt} readOnly rows={15}/>}</div></Modal>;
}
