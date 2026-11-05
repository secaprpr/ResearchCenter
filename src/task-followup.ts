import type { ResearchTask } from './research-tasks';
export const FOLLOWUP_LABELS = { expectedOutput: '预期产物', nextStep: '下一步', blocker: '受阻原因', waitingFor: '等待结果' } as const;
export const FOLLOWUP_FILTERS = { all: '全部跟进', blocked: '受阻', waiting: '等待结果', stale: '7 天未更新', next: '缺少下一步' } as const;
export type FollowupFilter = keyof typeof FOLLOWUP_FILTERS;
export const followupKeys = Object.keys(FOLLOWUP_LABELS) as Array<keyof typeof FOLLOWUP_LABELS>;
export const openTask = (task: ResearchTask) => task.status !== 'completed' && task.status !== 'cancelled';
export function matchesFollowup(task: ResearchTask, filter: FollowupFilter, now = Date.now()) {
  if (filter === 'all') return true;
  if (!openTask(task)) return false;
  if (filter === 'blocked') return !!task.blocker?.trim();
  if (filter === 'waiting') return !!task.waitingFor?.trim();
  if (filter === 'next') return !task.nextStep?.trim();
  return now - task.events.reduce((latest,event)=>Math.max(latest,event.recordedAt),Math.max(task.updatedAt,task.recordedAt)) >= 7 * 86400000;
}
