const prefix = 'research-lineage-draft/';
const memory = new Map<string, unknown>();
function compatible<T>(value: unknown, baseline: T): value is T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>, original = baseline as Record<string, unknown>;
  if (Object.keys(obj).length !== Object.keys(original).length) return false;
  return Object.entries(original).every(([key, sample]) => {
    const candidate = obj[key];
    if (Array.isArray(sample)) return Array.isArray(candidate) && candidate.every(item => key === 'fields'
      ? item && typeof item === 'object' && ['id','label','value'].every(k => typeof item[k] === 'string') && typeof item.required === 'boolean' && ['text','number','url','path','date'].includes(item.type)
      : typeof item === 'string');
    return typeof candidate === typeof sample && (typeof candidate !== 'string' || candidate.length <= 50000);
  });
}
export function readLineageDraft<T>(key: string, baseline: T): T {
  const cached = memory.get(key); if (compatible(cached, baseline)) return cached;
  try {
    const raw = sessionStorage.getItem(prefix + key);
    if (raw && raw.length <= 1024 * 1024) { const value = JSON.parse(raw); if (compatible(value, baseline)) return value; }
  } catch { /* A malformed or unavailable draft does not replace saved content. */ }
  return baseline;
}
export function writeLineageDraft(key: string, draft: unknown) {
  memory.set(key, draft);
  try { sessionStorage.setItem(prefix + key, JSON.stringify(draft)); } catch { /* Keep the in-memory draft when storage is full. */ }
}
export function clearLineageDraft(key: string) {
  memory.delete(key);
  try { sessionStorage.removeItem(prefix + key); } catch { /* Saving the business record already succeeded. */ }
}
