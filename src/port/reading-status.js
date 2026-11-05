import { frontmatter, processFrontMatter } from './vault.js';

export const READING_STATES = { inbox: '待整理', queued: '待阅读', reading: '阅读中', read: '已完成', archived: '已归档' };

// Reading dates follow the user's calendar, not the previous day in UTC.
export const localReadingDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function applyReadingStatus(fm, status, today = localReadingDate()) {
  if (!Object.hasOwn(READING_STATES, status)) throw new Error('无效的阅读状态');
  fm.status = status;
  if ((status === 'reading' || status === 'read') && !fm.date_started) fm.date_started = today;
  if (status === 'read' && !fm.date_read) fm.date_read = today;
  // Queueing, rereading and archiving preserve the first reading/completion dates.
}

const pendingUpdates = new WeakMap();
function serializeReadingUpdate(vault, file, action) {
  if (!pendingUpdates.has(vault)) pendingUpdates.set(vault, new Map());
  const updates = pendingUpdates.get(vault);
  const current = (updates.get(file.path) || Promise.resolve()).catch(() => {}).then(action);
  updates.set(file.path, current);
  return current.finally(() => { if (updates.get(file.path) === current) updates.delete(file.path); });
}

export const saveReadingStatus = (vault, file, status) => serializeReadingUpdate(vault, file, () => processFrontMatter(vault, file, fm => applyReadingStatus(fm, status)));

const shouldStartReading = fm => ['inbox', 'queued'].includes(String(fm.status || 'inbox').trim().toLowerCase());
export const startReadingOnOpen = (vault, file) => serializeReadingUpdate(vault, file, async () => {
  if (!shouldStartReading(frontmatter(await vault.read(file)))) return;
  await processFrontMatter(vault, file, fm => { if (shouldStartReading(fm)) applyReadingStatus(fm, 'reading'); });
});
