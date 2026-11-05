import { it, expect, vi, afterEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createPaperAttachments } from '../port/paper-attachments.js';
import { Events, frontmatter, markdownBody, processFrontMatter, saveMarkdownBody } from '../port/vault.js';

afterEach(() => vi.unstubAllGlobals());
function fixture() {
  vi.stubGlobal('crypto', webcrypto);
  const vault = new Events(), file = { path: 'Papers/Study.md', basename: 'Study' }, primary = { path: 'PDFs/main.pdf', name: 'main.pdf' };
  const paper = { file, pdf: primary.path };
  vault.texts = new Map([[file.path, '---\ntitle: Study\ntype: paper\nstatus: read\npdf: "[[PDFs/main.pdf]]"\n---\nOriginal note\n']]);
  const files = new Map([[file.path, file], [primary.path, primary]]), binary = new Map([[primary.path, new TextEncoder().encode('%PDF-1.4 main')]]);
  vault.getAbstractFileByPath = path => files.get(path) || null;
  vault.read = async file => vault.texts.get(file.path);
  vault.modify = async (file, value) => { vault.texts.set(file.path, value); vault.trigger('modify', file); };
  vault.createBinary = async (path, value) => { if (files.has(path)) throw new Error('File exists'); binary.set(path, value); files.set(path, { path, name: path.split('/').pop() }); };
  const manager = createPaperAttachments({ vault, folder: () => 'PDFs', papers: () => [paper], resolve: path => files.get(path) });
  const pdf = (name, text = 'Supplement') => ({ name, size: text.length + 9, arrayBuffer: async () => new TextEncoder().encode('%PDF-1.4 ' + text).buffer });
  return { vault, file, paper, primary, files, binary, manager, pdf };
}
it('concurrent attachment imports deduplicate bytes and preserve note body and metadata edits', async () => {
  const f = fixture();
  await Promise.all([
    f.manager.add(f.file, [f.pdf('Supplement.pdf')]), f.manager.add(f.file, [f.pdf('renamed.pdf')]),
    processFrontMatter(f.vault, f.file, fm => { fm.keywords = ['pathology']; }), saveMarkdownBody(f.vault, f.file, '# Updated note\n', 'Original note\n'),
  ]);
  expect(f.manager.list(f.file)).toHaveLength(1);
  const stored = f.vault.texts.get(f.file.path), fm = frontmatter(stored);
  expect(fm.status).toBe('read'); expect(fm.pdf).toBe('[[PDFs/main.pdf]]'); expect(fm.keywords).toEqual(['pathology']); expect(markdownBody(stored)).toBe('# Updated note\n');
  expect(fm.supplementary_files[0].path).toMatch(/^\[\[PDFs\/Supplements\//); expect(f.binary.size).toBe(2);
  expect(f.manager.owner(f.manager.list(f.file)[0].path)).toBe(f.paper);
});
it('rename and order changes retain file identity; removing and readding retains annotation paths', async () => {
  const f = fixture(); await f.manager.add(f.file, [f.pdf('SI.pdf'), f.pdf('Methods.pdf', 'Methods')]);
  const [si, methods] = f.manager.list(f.file);
  await f.manager.update(f.file, methods.id, { name: '统计方法', kind: 'methods' }); await f.manager.move(f.file, methods.id, -1);
  expect(f.manager.list(f.file).map(item => item.name)).toEqual(['统计方法', 'SI.pdf']);
  expect(f.manager.list(f.file)[0].path).toBe(methods.path);
  await f.manager.remove(f.file, si.id); expect(f.files.has(si.path)).toBe(true); expect(f.manager.owner(si.path)).toBeUndefined();
  await f.manager.add(f.file, [f.pdf('SI.pdf')]); expect(f.manager.list(f.file).at(-1).path).toBe(si.path); expect(f.binary.size).toBe(3);
});
it('partial import failures do not block valid files or create unrelated paper records, missing files remain visible', async () => {
  const f = fixture();
  const result = await f.manager.add(f.file, [f.pdf('SI.pdf'), { name: 'fake.pdf', size: 8, arrayBuffer: async () => new TextEncoder().encode('not a PDF').buffer }, { name: 'run.exe', size: 8 }, { name: 'large.zip', size: 101 * 1024 * 1024 }]);
  expect(result.added).toHaveLength(1); expect(result.failures).toHaveLength(3); expect(f.files.size).toBe(3); expect(f.vault.texts.size).toBe(1);
  const path = result.added[0].path; f.files.delete(path);
  expect(f.manager.documents(f.paper).find(item => item.path === path).file).toBeNull();
  expect(f.manager.documents(f.paper)[0].primary).toBe(true);
});
