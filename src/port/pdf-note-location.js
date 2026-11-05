// Standard Markdown fragment links survive editor modes, undo, export and reload.
export const PDF_NOTE_PREFIX = '#rw-pdf=';
const clamp = value => Math.max(0, Math.min(1, value));
export function validPdfLocation(value) {
  if (!value || typeof value.pdf !== 'string' || !value.pdf.toLowerCase().endsWith('.pdf') || value.pdf.length > 4096 || /[\x00-\x1f]/.test(value.pdf) || /^(?:[/\\]|[a-z]+:)/i.test(value.pdf) || value.pdf.split(/[/\\]/).includes('..')) return null;
  if (!Number.isInteger(value.page) || value.page < 0 || value.page > 99999 || !Number.isFinite(value.y) || value.y < 0 || value.y > 1) return null;
  const result = { pdf: value.pdf, page: value.page, y: value.y };
  if (Array.isArray(value.rect) && value.rect.length === 4 && value.rect.every(n => Number.isFinite(n) && n >= 0 && n <= 1)) result.rect = value.rect;
  return result;
}
export function pdfLocationHref(location) {
  const value = validPdfLocation(location); if (!value) throw new Error('无效的 PDF 定位');
  return PDF_NOTE_PREFIX + encodeURIComponent(JSON.stringify(value)).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16));
}
export function parsePdfLocation(href) {
  if (typeof href !== 'string' || !href.startsWith(PDF_NOTE_PREFIX) || href.length > 16000) return null;
  try { return validPdfLocation(JSON.parse(decodeURIComponent(href.slice(PDF_NOTE_PREFIX.length)))); } catch { return null; }
}
export function readerLocation(reader, page = reader.currentPage, point, rect) {
  const shell = reader.pageNodes?.[page]?.shell, size = reader.pageSizes?.[page];
  if (!shell || !size) return null;
  const box = shell.getBoundingClientRect(), top = reader.scrollEl.getBoundingClientRect().top;
  const y = point ? (point[1] - (size.y || 0)) / size.height : (top + 32 - box.top) / Math.max(1, box.height);
  const value = { pdf: reader.file.path, page, y: clamp(y) };
  if (rect) value.rect = [clamp((rect[0] - (size.x || 0)) / size.width), clamp((rect[1] - (size.y || 0)) / size.height), clamp((rect[2] - rect[0]) / size.width), clamp((rect[3] - rect[1]) / size.height)];
  return value;
}
export function noteHeadings(text) {
  const headings = []; let offset = 0, fence = null;
  for (const line of text.split(/\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) { if (!fence) fence = marker[1]; else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && line.slice(marker[0].length).trim() === '') fence = null; }
    else if (!fence) {
      const match = line.match(/^(#{1,6})[ \t]+(.+?)\r?$/);
      if (match) headings.push({ offset, line, level: match[1].length, label: match[2].replace(/\[↗\]\(#rw-pdf=[^\s)]+\)/g, '').replace(/[*_`]/g, '').trim() });
    }
    offset += line.length + 1;
  }
  return headings;
}
export function linkHeading(text, heading, location) {
  if (text.slice(heading.offset, heading.offset + heading.line.length) !== heading.line) throw new Error('标题已更新，请重新选择');
  const line = heading.line.replace(/[ \t]*\[↗\]\(#rw-pdf=[^\s)]+\)/g, '').trimEnd();
  return text.slice(0, heading.offset) + line + ' [↗](' + pdfLocationHref(location) + ')' + text.slice(heading.offset + heading.line.length);
}
export function precedingLocation(items, position) {
  return items.filter(item => item.location.pdf === position.pdf && item.location.page + item.location.y <= position.page + position.y + .025)
    .sort((a, b) => a.location.page + a.location.y - b.location.page - b.location.y).at(-1) || null;
}
