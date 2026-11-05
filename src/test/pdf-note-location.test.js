import { describe, it, expect } from 'vitest';
import { pdfLocationHref, parsePdfLocation, noteHeadings, linkHeading, precedingLocation } from '../port/pdf-note-location.js';

describe('coarse PDF/note locations', () => {
  const a = { pdf: '文献/正文 (2026).pdf', page: 2, y: .35, rect: [.1, .35, .5, .2] };
  it('round trips local unicode paths and normalized page/region data without unsafe Markdown delimiters', () => {
    const href = pdfLocationHref(a); expect(href).not.toMatch(/[()\s]/); expect(parsePdfLocation(href)).toEqual(a);
    for (const value of [{ ...a, pdf: '../x.pdf' }, { ...a, pdf: 'https://x.pdf' }, { ...a, page: -1 }, { ...a, page: 1.2 }, { ...a, y: NaN }, { ...a, y: 2 }]) expect(() => pdfLocationHref(value)).toThrow();
    expect(parsePdfLocation('#rw-pdf=%no')).toBeNull(); expect(parsePdfLocation('https://x/#rw-pdf=a')).toBeNull();
  });
  it('locates real headings, skips fenced examples and replaces only the source marker without changing note content', () => {
    const text = '# 综述\n\n```md\n## 示例\n```\n\n## **方法**\n\n正文 [普通链接](#a)\n';
    const headings = noteHeadings(text); expect(headings.map(h => h.label)).toEqual(['综述', '方法']);
    const next = linkHeading(text, headings[1], a); expect(next).toContain('## **方法** [↗](#rw-pdf='); expect(next).toContain('正文 [普通链接](#a)');
    const replaced = linkHeading(next, noteHeadings(next)[1], { ...a, page: 3 }); expect(replaced.match(/#rw-pdf=/g)).toHaveLength(1); expect(noteHeadings(replaced)[1].label).toBe('方法');
    expect(() => linkHeading('changed', headings[1], a)).toThrow();
  });
  it('follows the last coarse anchor in the current document, retaining a section until the next anchor', () => {
    const items = [{ location: { ...a, page: 2, y: .2 } }, { location: { ...a, page: 4, y: .1 } }, { location: { ...a, pdf: '文献/附录.pdf', page: 1, y: 0 } }];
    expect(precedingLocation(items, { ...a, page: 0, y: 0 })).toBeNull();
    expect(precedingLocation(items, { ...a, page: 3, y: .9 })).toBe(items[0]);
    expect(precedingLocation(items, { ...a, page: 4, y: .2 })).toBe(items[1]);
  });
});
