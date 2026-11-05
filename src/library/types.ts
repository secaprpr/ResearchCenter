export const READING_STATUS = {
  unread: '待阅读',
  reading: '阅读中',
  skimmed: '已粗读',
  read: '已完成',
} as const;

export type ReadingStatus = keyof typeof READING_STATUS;
export type LibrarySort = 'newest' | 'oldest' | 'title';

export interface Paper {
  id: string;
  fingerprint: string;
  title: string;
  authors: string;
  year: string;
  venue: string;
  tags: string[];
  notes: string;
  status: ReadingStatus;
  fileName: string;
  fileSize: number;
  createdAt: number;
  updatedAt: number;
}

export type PaperPatch = Partial<Pick<Paper, 'title' | 'authors' | 'year' | 'venue' | 'tags' | 'notes' | 'status'>>;
export interface ImportReport {
  added: number;
  duplicates: string[];
  failures: { name: string; message: string }[];
}

export function splitTags(value: string): string[] {
  return [...new Set(value.split(/[,，;；]/).map(tag => tag.trim()).filter(Boolean))];
}

export function filterPapers(papers: Paper[], query: string, status: ReadingStatus | 'all', year: string, sort: LibrarySort): Paper[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return papers.filter(paper => {
    if (status !== 'all' && paper.status !== status) return false;
    if (year !== 'all' && (year === 'unknown' ? paper.year !== '' : paper.year !== year)) return false;
    const text = [paper.title, paper.authors, paper.year, paper.venue, paper.fileName, paper.notes, ...paper.tags].join(' ').toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  }).sort((a, b) => sort === 'title'
    ? a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id)
    : (sort === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt) || a.id.localeCompare(b.id));
}

export function validatePdf(name: string, size: number, header: string): void {
  if (!/\.pdf$/i.test(name)) throw new Error('请选择 PDF 文件');
  if (size === 0) throw new Error('文件为空');
  if (size > 100 * 1024 * 1024) throw new Error('单个 PDF 不能超过 100 MB');
  if (!/%PDF-\d\.\d/.test(header)) throw new Error('文件缺少有效的 PDF 标识');
}

export function fileSizeLabel(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
