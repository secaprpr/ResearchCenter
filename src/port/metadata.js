import { frontmatter, processFrontMatter } from './vault.js';
import { loadPdfJs } from './obsidian.js';

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const normalize = value => clean(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const fields = ['title', 'authors', 'year', 'venue', 'doi', 'arxiv', 'abstract'];
const present = value => Array.isArray(value) ? value.length > 0 : Boolean(clean(value));
const basename = value => String(value || '').split('/').pop().replace(/\.pdf$/i, '');

export function identifiers(text) {
  const source = String(text || '');
  const doi = source.match(/10\.\d{4,9}\/[-._;()/:a-z\d]+/i)?.[0].replace(/[)\]}>.,;:]+$/g, '').toLowerCase() || '';
  const arxiv = source.match(/(?:arxiv\s*[:.]\s*|arxiv\.org\/(?:abs|pdf)\/)(\d{4}\.\d{4,5}(?:v\d+)?|[a-z][a-z.-]+\/\d{7}(?:v\d+)?)/i)?.[1]?.replace(/v\d+$/i, '') || '';
  return { doi, arxiv };
}

export function pdfBibliography(info, firstPage, guessedTitle = '') {
  const rawTitle = clean(info.Title);
  const title = rawTitle.length >= 8 && !/^(untitled|document|microsoft word|[\w-]+\.pdf)/i.test(rawTitle) && !/[/\\]/.test(rawTitle) ? rawTitle : guessedTitle;
  const subject = clean(info.Subject);
  let venue = '';
  const journal = subject.match(/^(.{3,150}?)[,;]\s*(?:doi\s*:?|https?:\/\/doi\.org)/i);
  if (journal) venue = journal[1];
  else if (/^(?:Proceedings of|International (?:Conference|Symposium)|IEEE\/CVF)/i.test(subject)) venue = subject.replace(/\s*[,(]?\b(?:19|20)\d{2}\b.*$/, '').trim();
  const publication = firstPage.match(/(?:Proceedings of[^\n]{0,180}|\bPMLR\s+\d+[^\n]{0,35}|\|\s*\((?:19|20)\d{2}\))[^\n]{0,60}/i)?.[0] || '';
  const year = (/proceedings|conference|journal|published/i.test(subject) ? subject.match(/\b(?:19|20)\d{2}\b/)?.[0] : '') || publication.match(/\b(?:19|20)\d{2}\b/)?.[0] || '';
  return { title, authors: clean(info.Author).split(/\s*[;,；]\s*|\s+and\s+/).filter(Boolean).filter(value => !/^(anonymous|unknown|author)$/i.test(value)), year, venue, ...identifiers(subject + '\n' + firstPage) };
}

export function mergeBibliography(current, proposal, initial) {
  const result = { ...current }, owned = { ...(current.metadata_auto_fields || {}) };
  const locked = new Set(current.metadata_manual_fields || []);
  for (const field of fields) {
    if (!present(proposal[field]) || locked.has(field)) continue;
    // A local edit made while PDF/network extraction was running always wins.
    if (JSON.stringify(current[field]) !== JSON.stringify(initial[field])) continue;
    const filenameTitle = field === 'title' && current.metadata_source === 'local-file' && (!current.metadata_original_filename || normalize(current.title) === normalize(basename(current.metadata_original_filename)));
    if (present(current[field]) && !filenameTitle && JSON.stringify(current[field]) !== JSON.stringify(owned[field])) continue;
    result[field] = proposal[field]; owned[field] = proposal[field];
  }
  result.metadata_auto_fields = owned;
  return result;
}

export function matchLibraryBibliography(papers, local, path) {
  if (!local.doi) return null;
  const candidates = papers.filter(paper => paper.file.path !== path && identifiers(paper.doi).doi === local.doi && (!local.title || normalize(paper.title) === normalize(local.title)) && paper.authors?.length && paper.venue && paper.year);
  const match = candidates.sort((a, b) => b.authors.length - a.authors.length)[0];
  if (!match) return null;
  return { title: match.title, authors: [...match.authors], venue: match.venue, year: match.year, doi: local.doi, abstract: match.abstract || '', source: 'local-library' };
}

async function readPdf(vault, file, model) {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await vault.readBinary(file)), useSystemFonts: true, isEvalSupported: false });
  try {
    const pdf = await task.promise;
    const { info = {}, metadata } = await pdf.getMetadata();
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const lines = model.reconstructPdfLines(content.items);
    const text = lines.map(line => line.text).join('\n');
    const bibliography = pdfBibliography({ ...info, Title: info.Title || metadata?.get('dc:title'), Author: info.Author || metadata?.get('dc:creator') }, text, lines.length >= 3 ? model.guessTitleFromLines(lines) : '');
    return { ...bibliography, hasText: Boolean(text.trim()) };
  } finally { await task.destroy(); }
}

export function createMetadataManager({ vault, model: getModel, request, onReport = () => {} }) {
  const pending = new Map(), listeners = new Set();
  let tail = Promise.resolve(), state = { running: false, done: 0, total: 0, message: '' };
  const publish = patch => { state = { ...state, ...patch }; listeners.forEach(listener => listener(state)); };
  const get = async url => {
    let timer;
    let response;
    try { response = await Promise.race([request({ url, throw: false }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('在线查询超时')), 12000); })]); }
    finally { clearTimeout(timer); }
    if (response.status === 404) return null;
    if (response.status < 200 || response.status >= 300) throw new Error(`元数据服务返回 ${response.status}`);
    return response;
  };
  async function remoteMetadata(local, model) {
    if (local.doi && !/^10\.48550\//i.test(local.doi)) {
      const response = await get('https://api.crossref.org/works/' + encodeURIComponent(local.doi));
      const message = response?.json?.message;
      if (message?.title?.length && clean(message.DOI).toLowerCase() === local.doi.toLowerCase()) {
        const meta = model.crossrefToMeta(message);
        if (!local.title || normalize(meta.title) === normalize(local.title) || model.titleSimilarity(local.title, meta.title) >= 0.75) return { ...meta, abstract: clean(message.abstract?.replace(/<[^>]*>/g, ' ')), source: 'crossref' };
      }
    }
    if (local.arxiv) {
      const response = await get('https://export.arxiv.org/api/query?id_list=' + encodeURIComponent(local.arxiv));
      if (response) {
        const xml = new DOMParser().parseFromString(response.text, 'application/xml');
        const entry = xml.querySelector('entry');
        if (entry && entry.querySelector('id')?.textContent?.includes(local.arxiv)) return { title: clean(entry.querySelector('title')?.textContent), authors: [...entry.querySelectorAll('author > name')].map(node => clean(node.textContent)), year: clean(entry.querySelector('published')?.textContent).slice(0, 4), venue: 'arXiv', arxiv: local.arxiv, doi: '10.48550/arXiv.' + local.arxiv, abstract: clean(entry.querySelector('summary')?.textContent), source: 'arxiv' };
      }
    }
    // Never search a filename or silently accept the first loosely related result.
    if (local.title?.split(/\s+/).length >= 4 && (!local.authors?.length || !local.venue || !local.year)) {
      const response = await get('https://api.crossref.org/works?rows=3&query.title=' + encodeURIComponent(local.title));
      const candidates = (response?.json?.message?.items || []).map(item => model.crossrefToMeta(item)).filter(meta => normalize(meta.title) === normalize(local.title));
      const unique = [...new Map(candidates.map(meta => [meta.doi || normalize(meta.title), meta])).values()];
      if (unique.length === 1) return { ...unique[0], source: 'crossref' };
    }
    return null;
  }
  async function enrich(file) {
    const model = getModel();
    const original = await vault.read(file);
    const initial = frontmatter(original);
    const pdf = model.resolveVaultFile(initial.pdf, file.path);
    if (!pdf) throw new Error('未找到关联 PDF，请检查文件路径。');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(file.path)));
    const backup = '.workbench/metadata-backup/' + [...digest.slice(0, 16)].map(byte => byte.toString(16).padStart(2, '0')).join('') + '.json';
    if (!vault.getAbstractFileByPath(backup)) await vault.create(backup, JSON.stringify({ path: file.path, savedAt: new Date().toISOString(), text: original }));
    await processFrontMatter(vault, file, fm => { fm.metadata_status = 'processing'; fm.metadata_message = '正在读取 PDF 首页与内嵌信息…'; });
    let local;
    try { local = await readPdf(vault, pdf, model); }
    catch { throw new Error('PDF 无法读取，可能已损坏或需要密码。'); }
    // A stored identifier is also useful for older manually created records.
    local.doi ||= identifiers(initial.doi || '').doi;
    local.arxiv ||= identifiers('arXiv:' + (initial.arxiv || '')).arxiv;
    let baseline = initial;
    await processFrontMatter(vault, file, fm => {
      const next = mergeBibliography(fm, local, initial);
      for (const field of fields) if (field in next) fm[field] = next[field];
      fm.metadata_auto_fields = next.metadata_auto_fields;
      fm.metadata_message = '已读取 PDF，正在核对文献信息…';
      baseline = structuredClone(fm);
    });
    let remote = null, networkError = '';
    try { remote = matchLibraryBibliography(model.papers, local, file.path) || await remoteMetadata(local, model); } catch (error) { networkError = error.message || '网络查询失败'; }
    const proposal = { ...local, ...(remote || {}) };
    const complete = Boolean(proposal.title && proposal.authors?.length && proposal.venue && proposal.year);
    const identified = Boolean(remote);
    const status = networkError ? 'partial' : identified || complete ? 'identified' : proposal.title ? 'partial' : 'needs-review';
    const message = networkError ? `已读取 PDF 信息；在线补全失败：${networkError}，可右键重新解析。` : identified ? remote.source === 'local-library' ? '已从文献库中相同 DOI 的记录补全文献信息' : `已通过 ${remote.source === 'arxiv' ? 'arXiv' : 'Crossref'} 识别文献信息` : complete ? '已从 PDF 内嵌信息识别标题、作者和发表信息' : !local.hasText && !local.title ? '未找到可识别文字；扫描版 PDF 需要 OCR，当前未启用 OCR。' : '已读取 PDF；部分字段缺失，未找到可靠的在线匹配，可右键重新解析或手动补充。';
    await processFrontMatter(vault, file, fm => {
      const next = mergeBibliography(fm, proposal, baseline);
      for (const field of fields) if (field in next) fm[field] = next[field];
      fm.metadata_auto_fields = next.metadata_auto_fields;
      fm.metadata_status = status; fm.metadata_message = message;
      if (networkError) fm.metadata_online_error = networkError; else delete fm.metadata_online_error;
      fm.metadata_source = remote?.source || (proposal.title ? 'pdf' : fm.metadata_source || 'local-file');
      fm.metadata_checked_at = new Date().toISOString();
    });
    return { path: file.path, status, message };
  }
  function run(files) {
    const jobs = [];
    for (const file of files) {
      if (!file || pending.has(file.path)) { if (file && pending.has(file.path)) jobs.push(pending.get(file.path)); continue; }
      publish({ running: true, total: state.running ? state.total + 1 : 1, done: state.running ? state.done : 0 });
      const job = tail.then(async () => {
        try { const result = await enrich(file); onReport(result); return result; }
        catch (error) {
          const message = error.message || '解析失败，请重新解析。';
          if (vault.getAbstractFileByPath(file.path)) await processFrontMatter(vault, file, fm => { fm.metadata_status = 'error'; fm.metadata_message = message; });
          const result = { path: file.path, status: 'error', message }; onReport(result); return result;
        } finally { pending.delete(file.path); publish({ done: state.done + 1, running: pending.size > 0, message: pending.size > 0 ? '正在解析文献信息…' : '文献信息解析完成' }); }
      });
      pending.set(file.path, job); tail = job.catch(() => {}); jobs.push(job);
    }
    return Promise.all(jobs);
  }
  function resume() {
    const files = vault.getMarkdownFiles().filter(file => { const fm = frontmatter(vault.texts.get(file.path) || ''); return fm.type === 'paper' && (['pending', 'processing'].includes(fm.metadata_status) || fm.metadata_source === 'local-file' && !fm.metadata_checked_at); });
    return run(files);
  }
  return { run, resume, get state() { return state; }, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}
