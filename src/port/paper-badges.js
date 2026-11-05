const TOPIC_TONES = {
  '经典': 'amber', '基础模型': 'violet', '预训练': 'blue',
  '注意力': 'violet', '病理': 'teal', '早期食管癌': 'teal', '指南': 'blue',
};
const TONES = ['teal', 'blue', 'violet', 'amber', 'rose'];
const clean = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const name = value => {
  const text = clean(value), link = text.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
  return link ? (link[2] || link[1]).split('/').pop().replace(/\.md$/i, '') : text;
};
const first = (...values) => values.find(value => value !== undefined && value !== null && clean(value) !== '');

export function topicTone(value) {
  const text = name(value);
  if (TOPIC_TONES[text]) return TOPIC_TONES[text];
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return TONES[hash % TONES.length];
}

// Rankings are read only from explicit local metadata, never guessed from venue.
export function paperBadges(paper, fm = {}) {
  const badges = [];
  const impact = clean(first(fm.impact_factor, fm.journal_if, fm.IF));
  if (/^\d+(?:\.\d+)?$/.test(impact)) badges.push({ label: `IF ${impact}`, tone: 'teal', kind: 'metric', title: '影响因子 · 本地记录' });
  const quartile = clean(first(fm.jcr_quartile, fm.sci_quartile, fm.jcr)).toUpperCase();
  if (/^(?:SCI\s*)?Q[1-4]$/.test(quartile)) badges.push({ label: `SCI ${quartile.replace(/^SCI\s*/, '')}`, tone: 'rose', kind: 'rank', title: 'JCR 分区 · 本地记录' });
  const cas = clean(first(fm.cas_zone, fm.cas_partition, fm.cas_quartile));
  if (cas) badges.push({ label: cas.startsWith('中科院') ? cas : `中科院 ${cas}`, tone: 'violet', kind: 'rank', title: '中科院分区 · 本地记录' });
  const ccf = clean(first(fm.ccf_rank, fm.ccf_rating, fm.ccf)).toUpperCase().replace(/^CCF\s*/, '');
  if (/^[ABC]$/.test(ccf)) badges.push({ label: `CCF ${ccf}`, tone: ccf === 'A' ? 'rose' : ccf === 'B' ? 'violet' : 'blue', kind: 'rank', title: 'CCF 等级 · 本地记录' });
  const seen = new Set(badges.map(badge => badge.label));
  for (const value of [...(paper.topics || []), ...(paper.keywords || [])]) {
    const label = name(value);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    badges.push({ label, tone: topicTone(label), kind: 'topic', title: `研究标签：${label}` });
  }
  return badges;
}
