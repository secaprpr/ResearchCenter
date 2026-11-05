import catalog from './data/ccf-2026.json';
import { frontmatter, processFrontMatter } from './vault.js';

export const metricFields = {
  impact_factor: ['impact_factor', 'journal_if', 'IF'],
  jcr_quartile: ['jcr_quartile', 'sci_quartile', 'jcr'],
  cas_zone: ['cas_zone', 'cas_partition', 'cas_quartile'],
  ccf_rank: ['ccf_rank', 'ccf_rating', 'ccf'],
};
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
export const normalizeVenue = value => text(value).normalize('NFKC').toLowerCase().replace(/&/g, ' and ').replace(/\b(?:19|20)\d{2}\b/g, '').replace(/[^\p{L}\p{N}]/gu, '');
const venueOf = fm => text(fm.venue || fm.journal || fm.conference);
const valueOf = (fm, field) => metricFields[field].map(key => fm[key]).find(value => text(value) !== '');
const excluded = value => /\b(?:workshops?|companion|findings|posters?|demonstrations?|short papers?|arxiv|preprints?)\b/i.test(value);
const aliases = { nips: 'NeurIPS', 'advances in neural information processing systems': 'NeurIPS', 'neural information processing systems': 'NeurIPS', 'medical image computing and computer assisted intervention': 'MICCAI', 'ieee conference on computer vision and pattern recognition': 'CVPR', 'ieee cvf conference on computer vision and pattern recognition': 'CVPR', 'ieee international conference on computer vision': 'ICCV', 'ieee cvf international conference on computer vision': 'ICCV' };

export function matchCcf(venue) {
  if (!venue || excluded(venue)) return null;
  let normalized = normalizeVenue(venue).replace(/^proceedingsof(?:the)?/, '').replace(/^the/, '');
  if (/^advancesinneuralinformationprocessingsystems\d{1,3}$/.test(normalized)) normalized = normalized.replace(/\d+$/, '');
  for (const [alias, acronym] of Object.entries(aliases)) if (normalizeVenue(alias) === normalized) normalized = normalizeVenue(acronym);
  // Attached years such as NeurIPS2021 are common in migrated libraries.
  const compact = normalized.replace(/(?:19|20)\d{2}$/, '');
  const exact = catalog.entries.filter(row => normalizeVenue(row.title) === normalized || (row.acronym && normalizeVenue(row.acronym) === compact && (row.kind === 'conference' || text(venue) === row.acronym)));
  if (exact.length === 1) return { ...exact[0], source: catalog.source, edition: catalog.edition };
  if (exact.length > 1) return null;
  // An acronym is accepted only as a separate token, never a substring (ACL ≠ NAACL).
  const tokens = String(venue).toLowerCase().replace(/([a-z])((?:19|20)\d{2})\b/g, '$1 $2').split(/[^a-z0-9]+/);
  // Journal abbreviations such as HEALTH are ordinary words in other titles.
  // Only exact journal names / standalone abbreviations are safe matches.
  const candidates = catalog.entries.filter(row => row.kind === 'conference' && row.acronym.length >= 3 && tokens.includes(row.acronym.toLowerCase()));
  return candidates.length === 1 ? { ...candidates[0], source: catalog.source, edition: catalog.edition } : null;
}

export function mergeMetricFields(fm, proposal, context) {
  const next = { ...fm }, auto = { ...(fm.metrics_auto || {}) };
  const locked = new Set(Array.isArray(fm.metrics_manual_fields) ? fm.metrics_manual_fields : []);
  for (const field of Object.keys(metricFields)) {
    if (locked.has(field)) continue;
    const current = valueOf(fm, field), owned = auto[field] && String(current) === String(auto[field].value);
    if (text(current) && !owned) continue; // Preserve manually supplied values, including aliases.
    const entry = proposal[field];
    if (entry && text(entry.value) !== '') {
      next[field] = entry.value;
      auto[field] = { ...entry, venue: context.venue, checked_at: context.checkedAt };
    } else if (owned && (context.clearAutomatic || normalizeVenue(auto[field].venue) !== normalizeVenue(context.venue) || (field === 'ccf_rank' && auto[field].source === catalog.source))) {
      delete next[field]; delete auto[field];
    }
  }
  if (Object.keys(auto).length) next.metrics_auto = auto;
  else delete next.metrics_auto;
  return next;
}

const signature = fm => JSON.stringify([venueOf(fm), fm.doi, ...Object.keys(metricFields).map(field => valueOf(fm, field)), fm.metrics_manual_fields]);

export function createMetricsManager({ vault, bridge, request }) {
  let state = { available: Boolean(bridge?.researchMetrics), configured: false, enabled: false, running: false, done: 0, total: 0, matched: 0, failed: 0, reports: [], message: '' };
  let tail = Promise.resolve(), timer;
  const listeners = new Set(), seen = new Map(), changes = new Set(), doiCache = new Map();
  const publish = patch => { state = { ...state, ...patch }; for (const listener of listeners) listener(state); };
  const allFiles = () => vault.getMarkdownFiles().filter(file => text(frontmatter(vault.texts.get(file.path) || '').type).toLowerCase() === 'paper');
  async function configure(payload) {
    if (!bridge?.researchMetrics) throw new Error('请在桌面版配置 easyScholar。');
    const result = await bridge.researchMetrics('configure', payload);
    publish({ ...result, available: true, message: '' });
    return result;
  }
  async function resolveDoi(doi) {
    const id = text(doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
    if (!/^10\.\d{4,9}\/\S+$/i.test(id) || /^10\.48550\//i.test(id) || !request) return '';
    if (!doiCache.has(id)) doiCache.set(id, request({ url: 'https://api.crossref.org/works/' + encodeURIComponent(id) }).then(result => text(result.json?.message?.['container-title']?.[0])).catch(() => ''));
    return doiCache.get(id);
  }
  async function enrich(file, remote, force) {
    let initial = frontmatter(await vault.cachedRead(file));
    const originalVenue = venueOf(initial);
    let venue = originalVenue;
    if (!venue && remote) venue = await resolveDoi(initial.doi) || venue;
    const unavailable = !venue || excluded(venue);
    const ccf = matchCcf(venue);
    const proposal = {};
    const checkedAt = new Date().toISOString();
    if (ccf) proposal.ccf_rank = { value: ccf.rank, source: ccf.source, edition: ccf.edition, matched_name: ccf.title };
    let failure = '', cached = false;
    if (!unavailable && remote && state.configured && ccf?.kind !== 'conference') {
      try {
        let result = await bridge.researchMetrics('lookup', { venue, force });
        if (!Object.keys(result.fields).length && initial.doi) {
          const resolved = await resolveDoi(initial.doi);
          if (resolved && normalizeVenue(resolved) !== normalizeVenue(venue) && !excluded(resolved)) { venue = resolved; result = await bridge.researchMetrics('lookup', { venue, force }); }
        }
        cached = result.cached;
        for (const [field, value] of Object.entries(result.fields)) if (field in metricFields && !(field === 'ccf_rank' && ccf)) proposal[field] = { value, source: 'easyScholar', edition: result.edition, matched_name: result.venue, fetched_at: new Date(result.fetchedAt).toISOString() };
      } catch (error) { failure = (error.message || '在线查询失败').replace(/^Error invoking remote method 'research:metrics': Error: /, ''); }
    }
    const resolvedCcf = matchCcf(venue);
    if (resolvedCcf) proposal.ccf_rank = { value: resolvedCcf.rank, source: resolvedCcf.source, edition: resolvedCcf.edition, matched_name: resolvedCcf.title };
    const current = frontmatter(await vault.read(file));
    if (venueOf(current) !== originalVenue || text(current.doi) !== text(initial.doi)) return { title: text(current.title), status: '跳过', reason: '发表来源已更改，将按新来源重新匹配' };
    const next = mergeMetricFields(current, proposal, { venue, checkedAt, clearAutomatic: unavailable });
    if (!originalVenue && venue) next.venue = venue;
    seen.set(file.path, signature(next));
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(file.path)));
      const backup = '.workbench/metrics-backup/' + Array.from(digest.slice(0, 16), value => value.toString(16).padStart(2, '0')).join('') + '.json';
      if (!vault.getAbstractFileByPath(backup)) await vault.create(backup, JSON.stringify({ path: file.path, savedAt: checkedAt, text: await vault.read(file) }));
      await processFrontMatter(vault, file, fm => {
        // Recompute against the latest note so an edit made during the lookup wins.
        if (venueOf(fm) !== originalVenue || text(fm.doi) !== text(initial.doi)) return;
        const fresh = mergeMetricFields(fm, proposal, { venue, checkedAt, clearAutomatic: unavailable });
        if (!originalVenue && venue) fresh.venue = venue;
        for (const field of [...Object.keys(metricFields), 'metrics_auto', 'venue']) { if (field in fresh) fm[field] = fresh[field]; else if (field in fm && (field === 'metrics_auto' || current.metrics_auto?.[field])) delete fm[field]; }
        seen.set(file.path, signature(fm));
      });
    }
    const labels = Object.keys(proposal).map(field => ({ impact_factor: 'IF', jcr_quartile: 'SCI', cas_zone: '中科院', ccf_rank: 'CCF' })[field]);
    return { title: text(current.title) || file.basename, status: labels.length ? '已匹配' : failure ? '查询失败' : '未匹配', reason: labels.length ? labels.join('、') + (cached ? ' · 缓存' : '') + (failure ? ' · 在线查询失败' : '') : failure || (unavailable ? '缺少正式发表来源，或属于预印本 / 伴随会议' : '数据源未返回指标'), venue };
  }
  function run(files = allFiles(), { remote = state.enabled, force = false } = {}) {
    const job = tail.then(async () => {
      const reports = []; publish({ running: true, total: files.length, done: 0, matched: 0, failed: 0, reports, message: '正在匹配发表来源…' });
      for (const file of files) {
        try { reports.push(await enrich(file, remote, force)); } catch { reports.push({ title: file.basename, status: '查询失败', reason: '本地文献信息更新失败' }); }
        publish({ done: reports.length, matched: reports.filter(row => row.status === '已匹配').length, failed: reports.filter(row => row.status === '查询失败').length, reports: [...reports] });
      }
      publish({ running: false, message: `已检查 ${reports.length} 篇，匹配 ${reports.filter(row => row.status === '已匹配').length} 篇` });
      return reports;
    });
    tail = job.catch(() => publish({ running: false, message: '自动匹配未完成，请重试。' }));
    return job;
  }
  function changed(file) {
    if (!file?.path?.endsWith('.md')) return;
    const fm = frontmatter(vault.texts.get(file.path) || '');
    if (String(fm.type).toLowerCase() !== 'paper' || signature(fm) === seen.get(file.path)) return;
    changes.add(file.path); clearTimeout(timer);
    timer = setTimeout(() => { const files = [...changes].map(path => vault.getAbstractFileByPath(path)).filter(Boolean); changes.clear(); void run(files); }, 400);
  }
  async function start() {
    if (bridge?.researchMetrics) { try { publish({ ...await bridge.researchMetrics('status') }); } catch { publish({ available: false, message: '请重启桌面应用以启用在线指标匹配。' }); } }
    vault.on('create', changed); vault.on('modify', changed);
    void run();
  }
  return { get state() { return state; }, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }, start, run, configure, allFiles };
}
