import { expect, it } from 'vitest';
import { parseRemark, remarkPlainText } from '../port/remark-markup.js';

it('mixes plain remarks and named capsule colours while keeping displayed text searchable', () => {
  const text = '优先复现 [重点]{红} / [外部验证]{ BLUE } [疑问]{紫色}';
  const parts = parseRemark(text), pills = parts.filter(part => part.kind === 'pill');
  expect(pills.map(part => part.text)).toEqual(['重点', '外部验证', '疑问']);
  expect(new Set(pills.map(part => part.ink)).size).toBe(3);
  expect(remarkPlainText(text)).toBe('优先复现 重点 / 外部验证 疑问');
});

it('ordinary citations, wiki links, malformed syntax and escaped examples retain their text', () => {
  for (const text of ['普通备注 [1] [[论文链接]]', '[重点]{unknown}', '[重点]{url(javascript:x)}', '[重点]{#12345}', '[]{红}', '[ ]{蓝}', '[重点]{', '[跨\n行]{红}']) {
    expect(parseRemark(text).some(part => part.kind === 'pill')).toBe(false);
    expect(remarkPlainText(text)).toBe(text);
  }
  expect(parseRemark(String.raw`\[重点]{红} [复现]{青}`)).toMatchObject([{ kind: 'text', text: '[重点]{红} ' }, { kind: 'pill', text: '复现' }]);
  expect(remarkPlainText(null)).toBe('');
});

it('custom hex capsules generate readable, bounded colours and never accept arbitrary CSS', () => {
  for (const color of ['#fff', '#FFCC00', '#a5f', '#000000', '#00ffff']) {
    const [part] = parseRemark(`[标记]{${color}}`); expect(part.kind).toBe('pill');
    for (const value of [part.ink, part.fill, part.border]) expect(value).toMatch(/^#[\da-f]{6}$/);
    const light = hex => hex.slice(1).match(/../g).map(c => { const v = parseInt(c, 16) / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
    expect((light(part.fill) + .05) / (light(part.ink) + .05)).toBeGreaterThanOrEqual(4.5);
  }
  expect(parseRemark('[<img onerror=alert(1)>]{红}')[0]).toMatchObject({ kind: 'pill', text: '<img onerror=alert(1)>' });
  expect(parseRemark('[标记]{red;background:black}')[0].kind).toBe('text');
});
