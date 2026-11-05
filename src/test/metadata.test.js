import { expect, it } from 'vitest';
import { identifiers, pdfBibliography, mergeBibliography, matchLibraryBibliography } from '../port/metadata.js';

it('识别 DOI、arXiv 新旧编号，清除尾部标点和版本号', () => {
  expect(identifiers('https://doi.org/10.1038/s41698-025-01186-z.')).toEqual({ doi: '10.1038/s41698-025-01186-z', arxiv: '' });
  expect(identifiers('arXiv: 2401.12345v2')).toEqual({ doi: '', arxiv: '2401.12345' });
  expect(identifiers('https://arxiv.org/abs/cs/0601001v3').arxiv).toBe('cs/0601001');
});

it('从内嵌信息读取标题作者和会议，避免把 PDF 创建年份当发表年份', () => {
  expect(pdfBibliography({ Title: 'A reliable study of long horizon memory', Author: 'Alice Researcher, Bob Engineer', Subject: 'Proceedings of the International Conference on Machine Learning 2026', CreationDate: 'D:20250101' }, '')).toMatchObject({ title: 'A reliable study of long horizon memory', authors: ['Alice Researcher', 'Bob Engineer'], venue: 'Proceedings of the International Conference on Machine Learning', year: '2026' });
  expect(pdfBibliography({ Title: 'A PDF without publication year', CreationDate: 'D:20250101' }, 'Reference author, 2022.')).toMatchObject({ year: '' });
  expect(pdfBibliography({ Subject: 'npj Precision Oncology, doi:10.1038/s41698-025-01186-z' }, 'npj Precision Oncology | (2025) 9:403')).toMatchObject({ venue: 'npj Precision Oncology', year: '2025', doi: '10.1038/s41698-025-01186-z' });
});

it('补全文件名条目，保留手工信息、阅读状态、笔记与并发编辑', () => {
  const initial = { title: 'zhao26bs', metadata_source: 'local-file', metadata_original_filename: 'zhao26bs.pdf', authors: [], venue: '', status: 'read', note: 'Do not change' };
  const proposal = { title: 'A benchmark of long horizon memory', authors: ['Researcher'], venue: 'ICML', year: '2026' };
  expect(mergeBibliography(initial, proposal, initial)).toMatchObject({ ...proposal, status: 'read', note: 'Do not change' });
  expect(mergeBibliography({ ...initial, title: 'Concurrent manual title', year: '2024' }, proposal, initial)).toMatchObject({ title: 'Concurrent manual title', year: '2024', authors: ['Researcher'] });
  const locked = { ...initial, title: 'My custom title', metadata_manual_fields: ['title', 'venue'] };
  expect(mergeBibliography(locked, proposal, locked)).toMatchObject({ title: 'My custom title', venue: '' });
});

it('相同 DOI 且标题一致时可复用本库书目，避免依赖在线连接', () => {
  const source = { file: { path: 'existing.md' }, title: 'A study of memory', doi: '10.1234/work', authors: ['A', 'B'], year: '2026', venue: 'ICML' };
  expect(matchLibraryBibliography([source], { title: source.title, doi: source.doi }, 'new.md')).toMatchObject({ authors: ['A', 'B'], source: 'local-library' });
  expect(matchLibraryBibliography([source], { title: 'Unrelated title', doi: source.doi }, 'new.md')).toBeNull();
  expect(matchLibraryBibliography([source], { title: source.title, doi: source.doi }, 'existing.md')).toBeNull();
});
