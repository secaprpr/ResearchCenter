import type { RecordItem } from './types';
import { topicData } from './topics';
export interface CliChange { resource: 'topic' | 'node' | 'event'; kind: 'created' | 'updated'; id: string; fields: string[] }
const different = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
/** Compact receipts contain changed keys and IDs, never copies of notes, paths or event payloads. */
export function describeCliChanges(before: RecordItem[], after: RecordItem[]) {
  const changes: CliChange[] = [];
  for (const record of after) {
    const old = before.find(r => r.id === record.id);
    if (record === old) continue;
    const data = topicData(record), previous = old && topicData(old);
    const fields = ['title','content'].filter(key => different(old?.[key as 'title'], record[key as 'title']));
    fields.push(...['question','hypothesis','conclusion','blocker','focus','nextStep'].filter(key => different(previous?.[key as 'question'], data[key as 'question'])));
    if (!old || fields.length) changes.push({ resource:'topic',kind:old?'updated':'created',id:record.id,fields });
    for (const task of data.tasks || []) {
      const original = previous?.tasks?.find(t => t.id === task.id);
      if (task === original) continue;
      const keys = Object.keys(task).filter(key => !['id','events','updatedAt','recordedAt','lineageRank'].includes(key) && different(original?.[key as 'title'], task[key as 'title']));
      if (!original || keys.length) changes.push({ resource:'node',kind:original?'updated':'created',id:task.id,fields:keys });
      for (const event of task.events) {
        const prior = original?.events.find(e => e.id === event.id);
        const keys = Object.keys(event).filter(key => !['id','recordedAt'].includes(key) && different(prior?.[key as 'title'], event[key as 'title']));
        if (!prior || keys.length) changes.push({ resource:'event',kind:prior?'updated':'created',id:event.id,fields:keys });
      }
    }
  }
  return { changes:changes.slice(0,8),changeCount:changes.length,changesTruncated:changes.length>8 };
}
