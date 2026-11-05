import { matchCcf } from './metrics.js';

// Presentation only: retain the source string in front matter, exports and metric queries.
export function formatVenue(value) {
  const raw = String(value || '').trim().replace(/\s+/g, ' ');
  if (!raw) return '';
  if (/^arxiv(?:$|[\s:.(\/-])/i.test(raw) || /^corr(?:$|\s+abs[/:])/i.test(raw)
    || /^(?:https?:\/\/(?:dx\.)?doi\.org\/)?10\.48550\/arxiv\.\d{4}\.\d{4,5}(?:v\d+)?$/i.test(raw)) return 'arXiv';
  if (/^https?:\/\//i.test(raw)) {
    try { if (['arxiv.org', 'www.arxiv.org', 'export.arxiv.org'].includes(new URL(raw).hostname.toLowerCase())) return 'arXiv'; } catch { /* Keep unrecognized source text. */ }
  }
  // A workshop, Findings volume or companion must not appear to be the main conference.
  if (/\b(?:workshops?|companion|findings|tutorials?|posters?|demonstrations?|short papers?)\b/i.test(raw)) return raw;
  // Retain the identity of joint proceedings and HLT rather than collapsing to ACL/EMNLP.
  const joint = raw.match(/\b(NAACL[-– ]HLT|EMNLP[-– ]IJCNLP|ACL[-– ]IJCNLP)\b/i);
  if (joint) return joint[1].toUpperCase().replace(/[-– ]/g, '-');
  const withoutEdition = raw.replace(/\b\d+(?:st|nd|rd|th)\b/gi, '').replace(/\s+/g, ' ');
  const conference = matchCcf(withoutEdition);
  return conference?.kind === 'conference' ? conference.acronym : raw;
}
