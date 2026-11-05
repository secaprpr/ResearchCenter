import { expect, it } from 'vitest';
import { Events, frontmatter, markdownBody, processFrontMatter } from '../port/vault.js';
import { createPaperNotes } from '../port/paper-notes.js';

function fixture() {
  const vault = new Events(); const file = { path: 'Paper.md', basename: 'Paper' };
  let text = '---\ntitle: Paper\nstatus: inbox\nkeywords: [old]\n---\n\nOriginal research\n';
  vault.texts = new Map([[file.path, text]]);
  vault.read = async () => text;
  vault.modify = async (_file, next) => { await new Promise(resolve => setTimeout(resolve, 1)); text = next; vault.texts.set(file.path, next); vault.trigger('modify', file); };
  const drafts = new Map(), storage = { getItem: key => drafts.get(key), setItem: (key, value) => drafts.set(key, value), removeItem: key => drafts.delete(key) };
  return { vault, file, storage, drafts, text: () => text, notes: createPaperNotes(vault, storage) };
}
it('typing during an active save preserves newest text and concurrent metadata/tags', async () => {
  const f = fixture(); f.notes.update(f.file, '# First\n');
  const pending = f.notes.flush(f.file);
  f.notes.update(f.file, '# Newest\n\n**Evidence**\n');
  await Promise.all([pending, processFrontMatter(f.vault, f.file, fm => { fm.status = 'reading'; fm.keywords.push('AI/ML'); })]);
  expect(markdownBody(f.text())).toBe('# Newest\n\n**Evidence**\n');
  expect(frontmatter(f.text())).toMatchObject({ status: 'reading', keywords: ['old', 'AI/ML'] });
  expect(f.notes.session(f.file).status).toBe('saved'); expect(f.drafts.size).toBe(0);
});
it('failed writes keep recoverable drafts and can be retried after recreating the manager', async () => {
  const f = fixture(), modify = f.vault.modify;
  f.vault.modify = async () => { throw new Error('disk failure'); };
  f.notes.update(f.file, 'Unsaved draft'); await expect(f.notes.flush(f.file)).rejects.toThrow('disk failure');
  expect(markdownBody(f.text())).toContain('Original research'); expect(f.notes.session(f.file).status).toBe('error');
  const recovered = createPaperNotes(f.vault, f.storage); expect(recovered.session(f.file).text).toBe('Unsaved draft');
  f.vault.modify = modify; await recovered.flush(f.file); expect(markdownBody(f.text())).toBe('Unsaved draft');
});
it('external body edits are never silently replaced by a stale draft', async () => {
  const f = fixture(); f.notes.update(f.file, 'Local draft');
  await f.vault.modify(f.file, '---\ntitle: New title\n---\nExternal changes');
  await expect(f.notes.flush(f.file)).rejects.toThrow('正文已在其他位置修改');
  expect(f.text()).toContain('External changes'); expect(f.notes.session(f.file).text).toBe('Local draft');
});
it('duplicate editor callbacks do not rewrite drafts, notify views or postpone a save', async () => {
  const f = fixture(); let changes = 0, writes = 0;
  const write = f.storage.setItem; f.storage.setItem = (...args) => { writes++; write(...args); };
  f.notes.subscribe(() => changes++);
  f.notes.update(f.file, 'Same edit', 'writer'); const timer = f.notes.session(f.file).timer;
  f.notes.update(f.file, 'Same edit', 'writer');
  expect(changes).toBe(1); expect(writes).toBe(1); expect(f.notes.session(f.file).timer).toBe(timer);
  await f.notes.flush(f.file);
});
it('pending editor input is unsaved immediately and close captures its latest draft before persistence', async () => {
  const f = fixture(); let pending = true;
  const release = f.notes.registerEditor(f.file, () => { if (pending) { pending = false; f.notes.update(f.file, 'Last keystroke'); } }, () => pending);
  expect(f.notes.hasUnsaved()).toBe(true);
  f.notes.captureAll(); expect(JSON.parse([...f.drafts.values()][0]).text).toBe('Last keystroke');
  await f.notes.flush(f.file); expect(markdownBody(f.text())).toBe('Last keystroke'); expect(f.notes.hasUnsaved()).toBe(false);
  release();
});
