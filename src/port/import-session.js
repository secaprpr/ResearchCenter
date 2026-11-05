const KEY = 'research-workbench-import-session';
export const IMPORT_MARK_TTL = 24 * 60 * 60 * 1000;
export const IMPORT_ORGANIZATIONS = { collections: 'collection', topics: 'topic', projects: 'project' };
export const importTarget = scope => scope && Object.hasOwn(IMPORT_ORGANIZATIONS, scope.kind) && typeof scope.name === 'string' && scope.name.trim() ? { kind: scope.kind, name: scope.name.trim() } : null;

export function createImportSession({ storage = localStorage, now = Date.now } = {}) {
  let state = { batch: null, unread: {} }, scope = null;
  const listeners = new Set();
  try {
    const saved = JSON.parse(storage.getItem(KEY) || '{}');
    state.unread = Object.fromEntries(Object.entries(saved.unread || {}).filter(([path, at]) => path.endsWith('.md') && typeof at === 'number' && at <= now() && now() - at < IMPORT_MARK_TTL));
    const batch = saved.batch;
    if (batch && typeof batch.at === 'number' && batch.at <= now() && now() - batch.at < IMPORT_MARK_TTL && Array.isArray(batch.paths)) state.batch = { ...batch, target: importTarget(batch.target), paths: [...new Set(batch.paths.filter(path => typeof path === 'string' && path.endsWith('.md')))] };
  } catch { /* An invalid preference must not block imports. */ }
  const publish = report => {
    try { storage.setItem(KEY, JSON.stringify(state)); } catch { /* The current session remains usable. */ }
    listeners.forEach(listener => listener(state, report));
  };
  return {
    get state() { return state; },
    setScope(value) { scope = importTarget(value); },
    get target() { return scope ? { ...scope } : null; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    record(report) {
      if (!report.paths.length) return;
      const at = now();
      state = { batch: { id: crypto.randomUUID(), paths: [...new Set(report.paths)], at, target: importTarget(report.target) }, unread: { ...state.unread, ...Object.fromEntries(report.newPaths.map(path => [path, at])) } };
      publish(report);
    },
    markSeen(path) {
      if (!Object.hasOwn(state.unread, path)) return;
      const unread = { ...state.unread }; delete unread[path]; state = { ...state, unread }; publish();
    },
    dismiss() { state = { ...state, batch: null }; publish(); },
    expire() {
      const unread = Object.fromEntries(Object.entries(state.unread).filter(([, at]) => now() - at < IMPORT_MARK_TTL));
      const batch = state.batch && now() - state.batch.at < IMPORT_MARK_TTL ? state.batch : null;
      if (Object.keys(unread).length !== Object.keys(state.unread).length || batch !== state.batch) { state = { batch, unread }; publish(); }
    },
  };
}
