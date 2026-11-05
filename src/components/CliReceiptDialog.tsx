import { useStore } from '../store';
import { taskTime } from '../research-tasks';
import { topicData } from '../topics';
import type { CliChange } from '../cli-changes';
import { FOLLOWUP_LABELS } from '../task-followup';
import { Modal } from './Modal';
const labels: Record<string,string> = { ...FOLLOWUP_LABELS,title:'名称',description:'描述',notes:'备注',content:'正文',parentIds:'前置节点',categoryIds:'标签',status:'状态',fields:'字段',occurredAt:'发生时间',evidence:'时间依据',nodeType:'节点类型',nodeStyle:'样式',version:'版本',branch:'分支',createdAt:'创建时间',source:'来源' };
export function CliReceiptDialog({ topicId, close }: { topicId?: string; close: () => void }) {
  const { cliReceipts, records } = useStore();
  const receipts = [...cliReceipts].reverse().filter(r=>!topicId || r.result.topicId===topicId).slice(0,30);
  const title = (id:string) => {
    for(const record of records){if(record.id===id)return record.title;for(const task of topicData(record).tasks||[]){if(task.id===id)return task.title;const event=task.events.find(e=>e.id===id);if(event)return event.title;}}
    return id;
  };
  return <Modal title="CLI 写入记录" onClose={close} footer={<button className="btn btn-ghost" onClick={close}>关闭</button>}><div className="rtl-cli-receipts">{!receipts.length && <div className="rt-empty">暂无写入记录</div>}{receipts.map(receipt=>{
    const changes=Array.isArray(receipt.result.changes)?receipt.result.changes as CliChange[]:[];
    return <details key={receipt.requestId}><summary><time>{receipt.recordedAt?taskTime(receipt.recordedAt):'—'}</time><span>{title(String(receipt.result.nodeId||receipt.result.topicId||''))}</span><small>{typeof receipt.result.changeCount==='number'?`${receipt.result.changeCount} 项变更`:'已保存'}</small></summary><div>{changes.map(change=><p key={`${change.resource}/${change.id}`}><span className="rtl-cli-change-kind">{change.kind==='created'?'新增':'修改'}{({topic:'课题',node:'节点',event:'进展'})[change.resource]}</span><strong>{title(change.id)}</strong><span>{change.fields.map(key=>labels[key]||key).join('、')}</span></p>)}{receipt.result.changesTruncated===true && <p>其余变更见命令回执</p>}<code>{receipt.requestId}</code></div></details>;
  })}</div></Modal>;
}
