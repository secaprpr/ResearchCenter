import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { matchCcf, mergeMetricFields } from '../port/metrics.js';
const require = createRequire(import.meta.url);
const { parseEasyScholar, createMetricsService } = require('../../electron/journal-metrics.cjs');

describe('出版物自动匹配', () => {
  it('使用官方 2026 目录，识别别名、紧连年份与更新后的等级', () => {
    expect(matchCcf('NeurIPS2021')).toMatchObject({ rank: 'A', kind: 'conference' });
    expect(matchCcf('NIPS')).toMatchObject({ acronym: 'NeurIPS', rank: 'A' });
    expect(matchCcf('Advances in Neural Information Processing Systems')).toMatchObject({ acronym: 'NeurIPS' });
    expect(matchCcf('Advances in Neural Information Processing Systems 37')).toMatchObject({ acronym: 'NeurIPS' });
    expect(matchCcf('2024 IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR)')).toMatchObject({ acronym: 'CVPR', rank: 'A' });
    expect(matchCcf('IJCAI')).toMatchObject({ rank: 'B', edition: expect.stringContaining('2026') });
    expect(matchCcf('IEEE Transactions on Pattern Analysis and Machine Intelligence')).toMatchObject({ acronym: 'TPAMI', kind: 'journal' });
  });
  it('不将子串、伴随会议、预印本或歧义缩写误标为主会', () => {
    for (const venue of ['CVPR Workshops 2025', 'Findings of ACL', 'ICCV Companion', 'arXiv', 'NotNeurIPS', 'AAMAS', 'The Lancet Digital Health', 'Health']) expect(matchCcf(venue)).toBeNull();
    expect(matchCcf('NAACL-HLT')?.acronym).not.toBe('ACL');
  });
  it('只读取服务官方值，忽略自定义等级、无效 IF 和五年 IF', () => {
    expect(parseEasyScholar({ code: 200, data: { officialRank: { all: { sciif: '18.0', sci: 'Q1', sciUp: '医学1区', ccf: 'B' } } } })).toEqual({ impact_factor: 18, jcr_quartile: 'Q1', cas_zone: '医学1区', ccf_rank: 'B' });
    expect(parseEasyScholar({ code: 200, data: { officialRank: { all: { sciif: 'N/A', sciif5: '7.9', sci: 'Q9', ccf: 'T1' } }, customRank: { sciif: '100' } } })).toEqual({});
    expect(() => parseEasyScholar({ code: 40002, msg: 'private-token-do-not-forward' })).toThrow('密钥无效');
  });
  it('保护手动值；改变期刊时清除旧自动值，保留手动锁定字段', () => {
    const fm = { journal_if: 5, ccf_rank: 'C', cas_zone: '医学2区', metrics_manual_fields: ['ccf_rank'], metrics_auto: { cas_zone: { value: '医学2区', venue: 'Old Journal' } } };
    const result = mergeMetricFields(fm, { impact_factor: { value: 18 }, ccf_rank: { value: 'A' } }, { venue: 'New Journal', checkedAt: '2026-10-20' });
    expect(result.journal_if).toBe(5); expect(result.impact_factor).toBeUndefined(); expect(result.ccf_rank).toBe('C'); expect(result.cas_zone).toBeUndefined();
    const empty = mergeMetricFields({ impact_factor: 18, metrics_auto: { impact_factor: { value: 18, venue: 'Journal' } } }, {}, { venue: '', clearAutomatic: true });
    expect(empty.impact_factor).toBeUndefined();
  });
  it('缓存和并发去重，按期刊统一限速，并隔离密钥与查询结果', async () => {
    const base = path.resolve('.test-tmp'); await fs.mkdir(base, { recursive: true });
    const root = await fs.mkdtemp(path.join(base, 'metrics-'));
    let time = 10000; const calls = [], pauses = [];
    try {
      const service = createMetricsService({ root, now: () => time, pause: async ms => { pauses.push(ms); time += ms; }, encrypt: key => Buffer.from(key).toString('base64'), decrypt: value => Buffer.from(value, 'base64').toString(), request: async url => { calls.push({ time, venue: new URL(url).searchParams.get('publicationName') }); return { ok: true, json: async () => ({ code: 200, data: { officialRank: { all: { sciif: '7.1' } } } }) }; } });
      await service.configure({ key: 'synthetic-test-key-123', enabled: true });
      await Promise.all([service.lookup('Journal A'), service.lookup('journal a'), service.lookup('Journal B')]);
      expect(calls).toHaveLength(2); expect(calls[1].time - calls[0].time).toBeGreaterThanOrEqual(650);
      expect((await service.lookup('Journal A')).cached).toBe(true); expect(calls).toHaveLength(2);
      expect(await service.status()).toEqual({ configured: true, enabled: true });
      expect(await fs.readFile(path.join(root, 'journal-metrics-settings.json'), 'utf8')).not.toContain('synthetic-test-key-123');
      expect(await fs.readFile(path.join(root, 'journal-metrics-cache.json'), 'utf8')).not.toContain('synthetic-test-key-123');
      expect(pauses.length).toBe(1);
    } finally { if (!path.resolve(root).startsWith(base + path.sep)) throw new Error('Unexpected cleanup path'); await fs.rm(root, { recursive: true, force: true }); }
  });
});
