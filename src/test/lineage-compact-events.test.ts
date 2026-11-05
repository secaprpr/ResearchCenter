import { expect, it } from 'vitest';
import { processEvents } from '../research-tasks';
import { lineageFixture } from './lineageFixture';

it('folds only empty manual creation bookkeeping, preserving substantive and imported records', () => {
  const task = lineageFixture().topic!.tasks![0];
  const creation = { id: 'created', title: '创建任务', source: '手动', occurredAt: task.createdAt, recordedAt: task.recordedAt, description: '', evidence: '', templateId: '', templateVersion: 1, fields: [] };
  const substantive = [
    { ...creation, id: 'body', description: '说明研究目的' },
    { ...creation, id: 'import', source: 'Codex' },
    { ...creation, id: 'status', status: 'running' as const },
    { ...creation, id: 'field', fields: [{ id: 'path', label: '位置', type: 'path' as const, value: '/data' }] },
    { ...creation, id: 'unknown', occurredAt: null },
    { ...creation, id: 'title', title: '创建任务队列' },
    { ...creation, id: 'template', templateId: 'custom' },
  ];
  task.events = [creation, ...substantive];
  expect(processEvents(task)).toEqual(substantive);
  expect(task.events).toHaveLength(8);
});
