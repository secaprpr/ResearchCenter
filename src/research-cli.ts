import { useStore } from './store';
import { captureTopicEditors } from './topic-editor-sessions';
import { CliError, planCliCommand } from './research-cli-service';
import { isCliNodeLocked } from './research-cli-locks';
import type { CliBridge, CliEnvelope } from './research-cli-types';
import { lineageNotice } from './lineage-session';

export function cliBridge() { return (window as unknown as {rwWindow?: Partial<CliBridge>}).rwWindow; }
export function executeCliCommand(envelope: CliEnvelope) {
  const c=envelope.command;
  const mutating=['topics.create','topics.update','nodes.create','nodes.update','events.append','events.update','import.apply'].includes(c?.op);
  if(mutating && !envelope.dryRun) {
    const target=c.op==='import.apply' ? c.data as {topicId?: string;taskId?: string} : undefined;
    const topicId=target?.topicId||c.topicId,nodeId=target?.taskId||c.nodeId;
    if(topicId && isCliNodeLocked(topicId,nodeId))throw new CliError('EDIT_IN_PROGRESS','目标正在界面中编辑，请先保存或取消该编辑再重试');
    captureTopicEditors();
  }
  const before=useStore.getState(),plan=planCliCommand(envelope,before);
  if(plan.records && plan.cliReceipts) {
    try { useStore.setState({records:plan.records,cliReceipts:plan.cliReceipts}); }
    catch {
      try { useStore.setState({records:before.records,cliReceipts:before.cliReceipts}); } catch { /* Retain the original persistence failure. */ }
      throw new CliError('PERSIST_FAILED','本地保存失败，命令未确认成功，请检查存储空间后重新读取');
    }
    const result=plan.result as Record<string,unknown>;
    if(typeof result.topicId==='string' && Number(result.changeCount)>0)lineageNotice(result.topicId,`CLI 已写入 · ${result.changeCount} 项变更`);
  }
  return plan.result;
}
export function initializeCliBridge() {
  const bridge=cliBridge();if(!bridge?.onCliRequest || !bridge.replyCliRequest)return () => {};
  return bridge.onCliRequest(({id,envelope}) => {
    try { bridge.replyCliRequest!(id,{ok:true,result:executeCliCommand(envelope)}); }
    catch(error) { bridge.replyCliRequest!(id,{ok:false,error:{code:error instanceof CliError?error.code:'INVALID_INPUT',message:(error as Error).message}}); }
  });
}
