import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { emptyTopic, isTopicData, metricsFromText, parseDataPreview, removeAsset, removeIdea } from '../topics';
describe('research topics', () => {
  beforeEach(() => useStore.getState().resetSample());
  it('previews quoted CSV/TSV fields without evaluating formulas and bounds the row count', () => {
    expect(parseDataPreview('name,value\r\n"A,B","two\nlines"\r\n"quote ""here""",=SUM(A1:A3)\r\n')).toEqual([['name', 'value'], ['A,B', 'two\nlines'], ['quote "here"', '=SUM(A1:A3)']]);
    expect(parseDataPreview('a\tb\n1\t2', '\t')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseDataPreview(Array.from({ length: 100 }, (_, i) => `${i},x`).join('\n'))).toHaveLength(15);
    expect(parseDataPreview('x'.repeat(10000) + ',y')[0][0]).toHaveLength(500);
    expect(parseDataPreview(Array.from({ length: 10000 }, () => 'x').join(','))[0]).toHaveLength(30);
  });
  it('exports/imports the complete relationship graph and keeps old records unchanged', () => {
    const topic = emptyTopic();
    topic.ideas.push({ id: 'idea1', title: '方法假设', content: '# 假设\n\n内容', status: 'testing', paperIds: ['papers/p.md'], createdAt: 1, updatedAt: 1 });
    topic.papers.push({ paperId: 'papers/p.md', role: '方法参考', note: '对照', linkedAt: 1 });
    topic.assets.push({ id: 'data1', title: '训练集', version: 'v1', kind: 'dataset', location: 'E:/data', notes: '', createdAt: 1, updatedAt: 1 });
    topic.experiments.push({ id: 'exp1', title: '验证', purpose: '', content: '', status: 'running', ideaId: 'idea1', paperIds: ['papers/p.md'], dataIds: ['data1'], runs: [{ id: 'run1', title: '基线', parameters: '', codeVersion: 'abc123', result: '', status: 'completed', metrics: { AUROC: '0.88' }, datasets: [{ id: 'data1', title: '训练集', version: 'v1' }], assetIds: [], createdAt: 1, updatedAt: 1 }], createdAt: 1, updatedAt: 1 });
    expect(isTopicData(topic)).toBe(true);
    const record = useStore.getState().addRecord({ typeId: 'project', title: '课题', topic });
    const payload = JSON.parse(JSON.stringify(useStore.getState().exportData()));
    payload.types.find((t: { id: string }) => t.id === 'project').name = '科研项目';
    expect(useStore.getState().importData(payload).ok).toBe(true);
    expect(useStore.getState().types.find(t => t.id === 'project')?.name).toBe('科研课题');
    expect(useStore.getState().records.find(r => r.id === record.id)?.topic).toEqual(topic);
    const removed = removeAsset(removeIdea(topic, 'idea1'), 'data1');
    expect(removed.experiments[0].ideaId).toBe(''); expect(removed.experiments[0].dataIds).toEqual([]);
    expect(removed.experiments[0].runs[0].datasets[0].version).toBe('v1');
    useStore.getState().duplicateRecord(record.id);
    const copy = useStore.getState().records[0]; expect(copy.topic).toEqual(topic); expect(copy.topic).not.toBe(topic);
    const todo = useStore.getState().addRecord({ typeId: 'todo', title: '保留待办', topicId: record.id });
    useStore.getState().deleteType('project');
    expect(useStore.getState().records.find(r => r.id === todo.id)?.topicId).toBeUndefined();
    expect(useStore.getState().records.find(r => r.id === todo.id)?.title).toBe('保留待办');
  });
  it('rejects malformed nested backup data before replacing the current state', () => {
    const payload = structuredClone(useStore.getState().exportData()); payload.records[0] = { ...payload.records[0], topic: { ...emptyTopic(), ideas: [{ id: 'bad' }] } as never };
    expect(useStore.getState().importData(payload).ok).toBe(false);
    expect(useStore.getState().records[0].topic).toBeUndefined();
    expect(metricsFromText('AUROC=0.88\nF1：0.81\nN=0')).toEqual({ AUROC: '0.88', F1: '0.81', N: '0' });
  });
});
