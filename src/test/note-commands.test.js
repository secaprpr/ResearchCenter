import { afterEach, expect, it } from 'vitest';
import { commandQuery, filterNoteCommands, noteCommandContext, commitNoteHistory, NOTE_COMMANDS } from '../port/note-commands.js';

afterEach(() => { document.body.replaceChildren(); window.getSelection().removeAllRanges(); });
it('command queries only occupy the beginning of an otherwise empty paragraph', () => {
  expect(commandQuery('\\')).toBe(''); expect(commandQuery('  \\H2')).toBe('h2');
  expect(commandQuery('\\重点')).toBe('重点'); expect(commandQuery('\\heading 2')).toBe('heading 2');
  expect(commandQuery('/')).toBe(''); expect(commandQuery('/标题')).toBe('标题'); expect(commandQuery('  /H2')).toBe('h2');
  for (const text of ['ordinary \\h1', 'ordinary /h1', 'C:\\data', '\\\\server', '\\data\\file', '/data/file', '//server', 'https://example.com/path', '\\alpha{', '\\' + 'a'.repeat(41)]) expect(commandQuery(text)).toBeNull();
  expect(commandQuery('\\h2', 'untouched text')).toBeNull();
  expect(commandQuery('/h2', 'untouched text')).toBeNull();
});
it('Chinese labels, English aliases and combined terms find the same commands', () => {
  expect(filterNoteCommands('标题').map(row => row.id)).toEqual(['h1', 'h2', 'h3']);
  expect(filterNoteCommands('heading 2').map(row => row.id)).toEqual(['h2']);
  expect(filterNoteCommands('重点')[0].id).toBe('callout-important');
  expect(filterNoteCommands('latex')[0].id).toBe('math');
  expect(filterNoteCommands('no-such-command')).toEqual([]);
  expect(new Set(NOTE_COMMANDS.map(row => row.id)).size).toBe(NOTE_COMMANDS.length);
});
function context(html, selector = 'p', offset) {
  const root = document.createElement('pre'); root.contentEditable = 'true'; root.innerHTML = html; document.body.append(root);
  const node = root.querySelector(selector).firstChild, range = document.createRange(); range.setStart(node, offset ?? node.textContent.length); range.collapse(true);
  window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
  return { root, result: noteCommandContext(root) };
}
it('reads only the current paragraph and rejects code, links, math, existing rich marks and selected text', () => {
  expect(context('<p>Before</p><p>\\h2</p>', 'p:last-child').result.query).toBe('h2');
  for (const [html, selector] of [
    ['<p><code>\\h2</code></p>', 'code'], ['<p><a href="#">\\h2</a></p>', 'a'],
    ['<div class="vditor-wysiwyg__block"><pre><code>\\h2</code></pre></div>', 'code'],
    ['<p><span data-rw-note-style="color:red">\\h2</span></p>', 'span'],
    ['<ul><li><p>\\h2</p></li></ul>', 'p'], ['<table><tbody><tr><td><p>\\h2</p></td></tr></tbody></table>', 'p'],
    ['<p>\\h2 and more</p>', 'p'],
  ]) expect(context(html, selector, 3).result).toBeNull();
  const { root } = context('<p>\\h2</p>'); window.getSelection().selectAllChildren(root); expect(noteCommandContext(root)).toBeNull();
});
it('commands produce portable Markdown, including all eight existing callout types', () => {
  expect(NOTE_COMMANDS.find(row => row.id === 'table').markdown('X')).toContain('| X |');
  expect(NOTE_COMMANDS.find(row => row.id === 'divider').markdown('X')).toMatch(/^\*\*\*\n/); // Never a YAML front matter opener.
  for (const row of NOTE_COMMANDS.filter(row => row.id.startsWith('callout-'))) {
    expect(row.markdown('X')).toContain('> [!' + row.id.replace('callout-', '') + ']');
    expect(row.markdown('X')).toContain('> X');
  }
});
it('history keeps the source of math whose asynchronous KaTeX preview is not ready', () => {
  const root = document.createElement('div'); root.innerHTML = '<pre class="vditor-wysiwyg__preview" data-render="1"><div class="language-math">x_i</div></pre>'; document.body.append(root);
  let during, boundaries = 0; root.addEventListener('rw-note-history-boundary', () => boundaries++);
  const editor = { vditor: { wysiwyg: { element: root }, undo: { addToUndoStack() { during = root.firstElementChild.dataset.render; } } } };
  commitNoteHistory(editor); expect(during).toBe('2'); expect(root.firstElementChild.dataset.render).toBe('1'); expect(root.textContent).toBe('x_i'); expect(boundaries).toBe(1);
});
