import { describe, it, expect } from 'vitest';
import { paperBadges, topicTone } from '../port/paper-badges.js';

describe('local literature badges', () => {
  it('does not infer journal metrics from venue names', () => {
    expect(paperBadges({ venue: 'Nature', topics: [], keywords: [] })).toEqual([]);
  });
  it('shows explicit local ranks and deduplicates readable research labels', () => {
    const badges = paperBadges({ topics: ['[[Research/Topics/病理]]', '经典'], keywords: ['病理', '多实例学习'] }, { impact_factor: 7.1, jcr_quartile: 'Q1', cas_zone: '医学2区', ccf_rank: 'A' });
    expect(badges.map(badge => badge.label)).toEqual(['IF 7.1', 'SCI Q1', '中科院 医学2区', 'CCF A', '病理', '经典', '多实例学习']);
    expect(badges.find(badge => badge.label === '病理')?.tone).toBe(topicTone('病理'));
  });
  it('ignores invalid metrics without discarding the paper tags', () => {
    expect(paperBadges({ topics: ['注意力'] }, { impact_factor: 'unknown', jcr: 'Q9', ccf: 'D', cas_zone: { invalid: true } }).map(badge => badge.label)).toEqual(['注意力']);
  });
  it('preserves free-form tag slashes and spaces while resolving explicit wiki links', () => {
    expect(paperBadges({ topics: [], keywords: ['AI/ML', 'Machine Learning', 'C++', '[[Research/Topics/经典|别名]]'] }).map(badge => badge.label)).toEqual(['AI/ML', 'Machine Learning', 'C++', '别名']);
  });
});
