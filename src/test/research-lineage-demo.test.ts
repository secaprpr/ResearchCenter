import { expect, it } from 'vitest';
import { buildLineageDemo } from '../research-lineage-demo';
import { defaultCategories } from '../research-tasks';
import { checkTaskParents } from '../task-lineage';
import { isTopicData } from '../topics';

it('演示课题可以持久化，所有关系与时间有效，包含真实的展示状态而不引用用户论文文件', () => {
  const record = buildLineageDemo('project','workspace',defaultCategories()), tasks = record.topic!.tasks!;
  expect(isTopicData(record.topic)).toBe(true);
  expect(tasks).toHaveLength(12);
  for (const task of tasks) { expect(() => checkTaskParents(tasks,task.id,task.parentIds || [])).not.toThrow(); expect(Number.isFinite(task.createdAt)).toBe(true); expect(task.paperIds).toEqual([]); expect(task.assetIds).toEqual([]); }
  expect(new Set(tasks.map(t => t.status))).toEqual(new Set(['completed','paused','running','pending']));
  expect(tasks.flatMap(t => t.events)).toHaveLength(21);
  expect(buildLineageDemo('project','workspace',[]).topic!.tasks!.every(t => t.categoryIds.length === 0)).toBe(true);
});
