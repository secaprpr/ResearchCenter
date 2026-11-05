import { expect, it } from 'vitest';
import { frontmatter, processFrontMatter } from '../port/vault.js';
import { editPaperTags } from '../port/paper-tags.js';

it('concurrent parsing and tag edits retain both field updates and the Markdown body', async () => {
  let text = '---\ntitle: Original\nkeywords: [existing]\n---\n\nResearch notes stay intact.\n';
  const vault = {
    read: async () => text,
    modify: async (_file, value) => { await new Promise(resolve => setTimeout(resolve, 1)); text = value; },
  }, file = { path: 'paper.md' };
  await Promise.all([
    processFrontMatter(vault, file, fm => { fm.title = 'Parsed title'; fm.metadata_status = 'resolved'; }),
    editPaperTags(vault, [file], { add: ['AI/ML', 'existing', 'Machine Learning'] }),
    processFrontMatter(vault, file, fm => { fm.status = 'reading'; }),
  ]);
  expect(frontmatter(text)).toMatchObject({ title: 'Parsed title', metadata_status: 'resolved', status: 'reading', keywords: ['existing', 'AI/ML', 'Machine Learning'] });
  expect(text).toContain('\n\nResearch notes stay intact.\n');
});

it('a failed write does not block later tag edits or modify unrelated wiki links', async () => {
  let text = '---\nkeywords: ["[[Tags/Legacy|旧标签]]"]\n---\nNotes'; let fail = true;
  const vault = { read: async () => text, modify: async (_file, value) => { if (fail) { fail = false; throw new Error('write failed'); } text = value; } }, file = { path: 'paper.md' };
  await expect(editPaperTags(vault, [file], { add: ['new'] })).rejects.toThrow('write failed');
  await editPaperTags(vault, [file], { add: ['new', 'NEW'] });
  expect(frontmatter(text).keywords).toEqual(['[[Tags/Legacy|旧标签]]', 'new']);
});
