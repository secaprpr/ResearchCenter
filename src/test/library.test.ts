import { describe, expect, it } from 'vitest';
import { filterPapers, splitTags, validatePdf, type Paper } from '../library/types';

const paper = (id: string, patch: Partial<Paper> = {}): Paper => ({
  id, fingerprint: id, title: `Paper ${id}`, authors: '', year: '', venue: '', tags: [], notes: '',
  status: 'unread', fileName: `${id}.pdf`, fileSize: 1000, createdAt: 1, updatedAt: 1, ...patch,
});

describe('文献检索与导入校验', () => {
  it('跨元数据与备注匹配全部关键词，不区分大小写', () => {
    const papers = [paper('a', { authors: 'Alice Chen', tags: ['LLM'], notes: '证据遗漏' }), paper('b')];
    expect(filterPapers(papers, ' ALICE llm 证据 ', 'all', 'all', 'newest').map(item => item.id)).toEqual(['a']);
    expect(filterPapers(papers, 'missing', 'all', 'all', 'newest')).toEqual([]);
  });
  it('组合状态与年份筛选，支持未填写年份且不修改源列表', () => {
    const papers = [paper('a', { year: '2025', status: 'read', createdAt: 2 }), paper('b', { status: 'reading' }), paper('c', { year: '2025' })];
    expect(filterPapers(papers, '', 'read', '2025', 'newest').map(item => item.id)).toEqual(['a']);
    expect(filterPapers(papers, '', 'all', 'unknown', 'newest').map(item => item.id)).toEqual(['b']);
    expect(filterPapers(papers, '', 'all', 'all', 'oldest').map(item => item.id)).toEqual(['b', 'c', 'a']);
    expect(papers.map(item => item.id)).toEqual(['a', 'b', 'c']);
  });
  it('规范化中英文分隔符并去重标签', () => {
    expect(splitTags(' LLM,检索；LLM，推理; ')).toEqual(['LLM', '检索', '推理']);
  });
  it('接受 PDF 扩展名大小写及前置标记，拒绝空文件、伪 PDF 和超大文件', () => {
    expect(() => validatePdf('study.PDF', 1024, 'prefix\n%PDF-1.7')).not.toThrow();
    expect(() => validatePdf('study.pdf', 0, '')).toThrow('文件为空');
    expect(() => validatePdf('study.pdf', 10, 'not a pdf')).toThrow('PDF 标识');
    expect(() => validatePdf('study.txt', 10, '%PDF-1.4')).toThrow('请选择 PDF');
    expect(() => validatePdf('study.pdf', 101 * 1024 * 1024, '%PDF-1.4')).toThrow('100 MB');
  });
});
