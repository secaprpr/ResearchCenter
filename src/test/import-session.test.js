import { expect, it } from 'vitest';
import { createImportSession, importTarget, IMPORT_MARK_TTL } from '../port/import-session.js';

it('仅继承组织类别，不把阅读 / 重点 / 归档筛选当成导入目标', () => {
  expect(importTarget({ kind: 'collections', name: '早期食管癌' })).toEqual({ kind: 'collections', name: '早期食管癌' });
  for (const kind of ['all', 'status', 'starred', 'recent', 'import']) expect(importTarget({ kind, name: 'read' })).toBeNull();
});

it('新标记与本次批次独立；重复项不标新；阅读后移除标记并持久化', () => {
  const map = new Map(); const storage = { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value) };
  const imports = createImportSession({ storage, now: () => 1000 });
  imports.record({ paths: ['new.md', 'existing.md'], newPaths: ['new.md'], target: { kind: 'collections', name: '早期食管癌' } });
  expect(imports.state.batch.paths).toEqual(['new.md', 'existing.md']);
  expect(imports.state.unread).toEqual({ 'new.md': 1000 });
  const reopened = createImportSession({ storage, now: () => 2000 });
  expect(reopened.state).toEqual(imports.state);
  reopened.markSeen('new.md'); expect(reopened.state.unread).toEqual({});
  expect(reopened.state.batch.paths).toHaveLength(2);
  reopened.dismiss(); expect(reopened.state.batch).toBeNull();
});

it('24 小时后自动清理临时入口和标记；空失败批次不覆盖成功批次', () => {
  let time = 1000; const storage = { getItem: () => null, setItem: () => {} };
  const imports = createImportSession({ storage, now: () => time });
  imports.record({ paths: ['new.md'], newPaths: ['new.md'] });
  imports.record({ paths: [], newPaths: [] }); expect(imports.state.batch.paths).toEqual(['new.md']);
  time += IMPORT_MARK_TTL; imports.expire(); expect(imports.state).toEqual({ batch: null, unread: {} });
});
