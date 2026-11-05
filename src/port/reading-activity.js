const STORAGE_PATH = '.workbench/reading-activity.json';
const CHECKPOINT_KEY = 'research-workbench-reading-activity-checkpoint';
export const READING_IDLE_MS = 120000;

// Monotonic, sampled time. Discard sleep/suspension gaps rather than counting them.
export function createPageTimer({ now, onTime, idleMs = READING_IDLE_MS, maxGapMs = 5000 }) {
  let last = now(), interaction = last, page = -1, foreground = false;
  const tick = () => {
    const time = now(), gap = time - last;
    if (page >= 0 && foreground && gap > 0 && gap <= maxGapMs) {
      const active = Math.max(0, Math.min(time, interaction + idleMs) - last);
      if (active) onTime(page, active / 1000);
    }
    last = time;
  };
  return {
    tick,
    visit(next) { tick(); page = next; },
    interact() { tick(); interaction = now(); },
    foreground(value) { tick(); if (value && !foreground) interaction = now(); foreground = value; },
    stop() { tick(); foreground = false; page = -1; },
  };
}

export function pageActivity(record, annotations = []) {
  const counts = new Map();
  for (const item of annotations) {
    const page = Number(item.page);
    if (Number.isInteger(page) && page >= 0 && page < 100000) counts.set(page, (counts.get(page) || 0) + 1);
  }
  const observed = Math.max(0, ...counts.keys()) + (counts.size ? 1 : 0);
  const count = record?.pageCount || observed;
  return Array.from({ length: count }, (_, page) => ({ page, seconds: Number(record?.pages?.[page]) || 0, notes: counts.get(page) || 0 }));
}

export function formatReadingTime(seconds) {
  const whole = Math.floor(Math.max(0, seconds || 0));
  if (!whole) return seconds > 0 ? '<1秒' : '0秒';
  if (whole < 60) return `${whole}秒`;
  if (whole < 3600) return `${Math.floor(whole / 60)}分${whole % 60 ? `${whole % 60}秒` : ''}`;
  return `${Math.floor(whole / 3600)}小时${Math.floor(whole % 3600 / 60)}分`;
}

export function createReadingActivity({ vault, onError = () => {} }) {
  let records = {}, revision = 0, dirty = 0, saved = 0, writes = Promise.resolve();
  let currentSession;
  const sessions = new Map();
  const listeners = new Set();
  const publish = () => { revision++; listeners.forEach(listener => listener()); };
  const flush = () => {
    if (dirty === saved) return writes;
    const version = dirty, snapshot = JSON.stringify({ version: 1, records });
    writes = writes.catch(() => {}).then(async () => {
      await vault.adapter.write(STORAGE_PATH, snapshot); saved = Math.max(saved, version);
      if (saved === dirty) { try { localStorage.removeItem(CHECKPOINT_KEY); } catch { /* Disk save still succeeded. */ } }
    });
    return writes;
  };
  const get = path => records[path];
  const api = {
    get, flush,
    get revision() { return revision; },
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    activate(reader) {
      const next = sessions.get(reader); if (!next || next === currentSession) return;
      currentSession?.sync(); currentSession = next;
      for (const session of sessions.values()) session.sync();
      publish();
    },
    async load() {
      if (await vault.adapter.exists(STORAGE_PATH)) {
        try {
          const parsed = JSON.parse(await vault.adapter.read(STORAGE_PATH));
          if (parsed.version !== 1 || !parsed.records || typeof parsed.records !== 'object') throw new Error('阅读统计格式不受支持');
          for (const [path, record] of Object.entries(parsed.records)) {
            if (!record || !Number.isInteger(record.pageCount) || record.pageCount < 1 || record.pageCount > 100000) continue;
            const pages = {};
            for (const [page, seconds] of Object.entries(record.pages || {})) if (/^\d+$/.test(page) && Number(page) < record.pageCount && Number.isFinite(seconds) && seconds > 0) pages[page] = seconds;
            records[path] = { pageCount: record.pageCount, pages };
          }
        } catch (error) { onError(error); }
      }
      // A synchronous checkpoint preserves the final seconds across window reloads.
      try {
        const checkpoint = JSON.parse(localStorage.getItem(CHECKPOINT_KEY) || 'null');
        if (checkpoint?.version === 1 && checkpoint.records) {
          for (const [path, pending] of Object.entries(checkpoint.records)) {
            if (!pending || !Number.isInteger(pending.pageCount) || pending.pageCount < 1 || pending.pageCount > 100000) continue;
            const record = records[path] ||= { pageCount: pending.pageCount, pages: {} };
            for (const [page, seconds] of Object.entries(pending.pages || {})) if (/^\d+$/.test(page) && Number(page) < record.pageCount && Number.isFinite(seconds) && seconds > 0) record.pages[page] = Math.max(record.pages[page] || 0, seconds);
          }
          dirty++; await flush();
        }
      } catch (error) { onError(error); }
      publish();
    },
    attach(reader) {
      if (!reader?.docId || !reader.pageSizes?.length || reader.destroyed || reader.root?.querySelector('.mupdf-reader-error-title')) return;
      sessions.get(reader)?.stop();
      const path = reader.file.path;
      const record = records[path] ||= { pageCount: reader.pageSizes.length, pages: {} };
      if (record.pageCount !== reader.pageSizes.length) record.pageCount = reader.pageSizes.length;
      dirty++; publish();
      let lastPublished = performance.now();
      const timer = createPageTimer({ now: () => performance.now(), onTime: (page, seconds) => {
        record.pages[page] = (record.pages[page] || 0) + seconds; dirty++;
        if (performance.now() - lastPublished >= 900) { lastPublished = performance.now(); publish(); }
      } });
      const readerWorkspace = document.querySelector('#reader-workspace');
      let focused = document.hasFocus();
      const visible = () => currentSession?.reader === reader && focused && !document.hidden && document.hasFocus() && !reader.destroyed && !readerWorkspace.hidden && reader.root.getClientRects().length > 0 && (!window.frameElement || window.frameElement.getClientRects().length > 0);
      const sync = () => { timer.foreground(visible()); timer.visit(Math.max(0, reader.currentPage || 0)); timer.tick(); };
      const interact = () => { if (!readerWorkspace.hidden) { sync(); timer.interact(); } };
      const focus = () => { focused = true; sync(); void flush().catch(onError); };
      const blur = () => { focused = false; sync(); void flush().catch(onError); };
      const visibility = () => { sync(); void flush().catch(onError); };
      const checkpoint = () => { sync(); try { if (dirty !== saved) localStorage.setItem(CHECKPOINT_KEY, JSON.stringify({ version: 1, records })); } catch { /* Periodic disk saves remain available. */ } };
      // Account the old page before the engine updates it, including direct page jumps.
      const originals = new Map();
      for (const method of ['updateCurrentPage', 'goToPage']) {
        const original = reader[method]; originals.set(method, original);
        reader[method] = function (...args) {
          timer.tick(); const previous = this.currentPage, result = original.apply(this, args);
          timer.visit(Math.max(0, this.currentPage || 0)); if (this.currentPage !== previous) publish(); return result;
        };
      }
      for (const event of ['pointerdown', 'pointermove', 'keydown', 'wheel']) document.addEventListener(event, interact, { capture: true, passive: true });
      window.addEventListener('blur', blur); window.addEventListener('focus', focus); document.addEventListener('visibilitychange', visibility);
      window.addEventListener('beforeunload', checkpoint); window.addEventListener('pagehide', checkpoint);
      const tick = setInterval(sync, 1000), save = setInterval(() => { sync(); void flush().catch(onError); }, 10000);
      let stopped = false;
      const stop = () => {
        if (stopped) return flush();
        stopped = true; timer.stop(); clearInterval(tick); clearInterval(save);
        for (const [method, original] of originals) reader[method] = original;
        for (const event of ['pointerdown', 'pointermove', 'keydown', 'wheel']) document.removeEventListener(event, interact, true);
        window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visibility);
        window.removeEventListener('beforeunload', checkpoint); window.removeEventListener('pagehide', checkpoint);
        sessions.delete(reader);
        if (currentSession?.reader === reader) currentSession = null;
        publish(); return flush().catch(onError);
      };
      currentSession?.sync();
      currentSession = { path, reader, stop, sync }; sessions.set(reader, currentSession);
      for (const session of sessions.values()) if (session !== currentSession) session.sync();
      timer.visit(Math.max(0, reader.currentPage || 0)); sync();
      return stop;
    },
    current() { return currentSession?.reader; },
  };
  return api;
}
