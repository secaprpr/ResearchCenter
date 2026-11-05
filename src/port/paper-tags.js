import { processFrontMatter } from './vault.js';

export const tagLabel = value => {
  if (typeof value !== 'string') return '';
  const text = value.trim(), link = text.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
  return (link ? (link[2] || link[1]).split('/').pop().replace(/\.md$/i, '') : text).replace(/^#+/, '').replace(/\s+/g, ' ').trim().normalize('NFC');
};
export const tagKey = value => tagLabel(value).toLowerCase();
export function parseTags(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : String(value || '').split(/[,，;；\n]+/)).map(tagLabel).filter(tag => {
    const key = tagKey(tag); if (!key || seen.has(key)) return false; seen.add(key); return true;
  });
}

// Apply only explicit additions/removals against the latest stored document.
// Never replace every selected paper's tags with the selection's union.
export async function editPaperTags(vault, files, { add = [], remove = [] }) {
  const additions = parseTags(add), removals = new Set(parseTags(remove).map(tagKey));
  if (!additions.length && !removals.size) return;
  for (const file of files) await processFrontMatter(vault, file, fm => {
    const original = Array.isArray(fm.keywords) ? fm.keywords : String(fm.keywords || '').split(/[,，;；\n]+/);
    const seen = new Set();
    const keywords = original.filter(value => {
      const key = tagKey(value);
      if (!key || removals.has(key) || seen.has(key)) return false;
      seen.add(key); return true;
    });
    for (const tag of additions) if (!seen.has(tagKey(tag))) { keywords.push(tag); seen.add(tagKey(tag)); }
    fm.keywords = keywords;
    fm.metadata_manual_fields = [...new Set([...(fm.metadata_manual_fields || []), 'keywords'])];
  });
}
