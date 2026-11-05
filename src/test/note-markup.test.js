import { expect, it } from 'vitest';
import { calloutMarkdown, inlineStyleHTML, renderNoteInlineStyles, protectNoteInlineStyles, renderTitleOnlyCallouts, parseCalloutExample } from '../port/note-markup.js';

function codes(open, body, close = '</span>') {
  const div = document.createElement('div'); const p = document.createElement('p'); div.append(p);
  for (const text of [open, body, close]) { const node = document.createElement(text === body ? 'strong' : 'code'); if (node.tagName === 'CODE') node.dataset.type = 'html-inline'; node.textContent = text; p.append(node); }
  return div.innerHTML;
}
it('editable inline HTML retains accepted CSS and rich children through conversion in both directions', () => {
  const original = codes('<span class="rw-note-inline tone-teal mode-outline" style="color:#155e75; border:1px dashed #155e75">', 'Evidence');
  const rendered = renderNoteInlineStyles(original), div = document.createElement('div'); div.innerHTML = rendered;
  const span = div.querySelector('[data-rw-note-style]'); expect(span.style.color).toBe('rgb(21, 94, 117)'); expect(span.querySelector('strong').textContent).toBe('Evidence');
  const protectedHTML = protectNoteInlineStyles(rendered); expect(protectedHTML).not.toContain('data-rw-note-style'); expect(protectedHTML).toContain('html-inline');
  div.innerHTML = renderNoteInlineStyles(protectedHTML); expect(div.querySelector('span').style.borderStyle).toBe('dashed'); expect(div.querySelector('strong').textContent).toBe('Evidence');
});
it('inline styles do not introduce document-wide layout, event attributes or executable CSS', () => {
  const rendered = renderNoteInlineStyles(codes('<span class="modal-container rw-note-inline" onclick="alert(1)" style="position:fixed;z-index:9000;background-image:url(https://example.com/a);color:#805c20">', 'Safe text'));
  const div = document.createElement('div'); div.innerHTML = rendered; const span = div.querySelector('span');
  expect(span.className).toBe('rw-note-inline'); expect(span.hasAttribute('onclick')).toBe(false); expect(span.style.position).toBe(''); expect(span.style.backgroundImage).toBe(''); expect(span.style.color).toBe('rgb(128, 92, 32)');
});
it('nested marks round-trip and code snippets containing HTML stay literal', () => {
  const inner = codes('<mark style="background-color:#fff5dc">', 'Nested', '</mark>');
  const html = codes('<span style="color:#155e75">', 'Text').replace('<strong>Text</strong>', inner.replace(/^<p>|<\/p>$/g, ''));
  const result = renderNoteInlineStyles(html); const div = document.createElement('div'); div.innerHTML = result;
  expect(div.querySelector('span mark').textContent).toBe('Nested'); expect(protectNoteInlineStyles(result)).not.toContain('data-rw-note-style');
  const literal = '<pre><code>&lt;span style="color:red"&gt;literal&lt;/span&gt;</code></pre>';
  expect(renderNoteInlineStyles(literal)).toBe(literal);
});
it('portable markup keeps quoted paragraphs and escapes authored inline text', () => {
  expect(calloutMarkdown('method', 'outline', ' Reproduce ', 'First\n\n- One\n- Two')).toBe('> [!method-outline] Reproduce\n>\n> First\n> \n> - One\n> - Two\n');
  expect(inlineStyleHTML('<model> & evidence', { mode: 'highlight', ink: '#155e75', fill: '#e0f2fe', radius: 6 })).toContain('&lt;model&gt; &amp; evidence');
});
it('title-only callouts keep rich title content, while code examples and unknown syntax stay literal', () => {
  const root = document.createElement('div');
  root.innerHTML = renderTitleOnlyCallouts('<blockquote data-block="0"><p data-block="0">[!important] 核心 <strong>结论</strong></p></blockquote><pre><code>&gt; [!important] literal</code></pre><blockquote><p>[!unknown] 留在原处</p></blockquote>');
  expect(root.querySelectorAll('blockquote.callout')).toHaveLength(1);
  expect(root.querySelector('.callout-info strong').textContent).toBe('结论');
  expect(root.querySelector('pre code').textContent).toBe('> [!important] literal');
  expect(root.innerHTML).not.toContain('\u200b');
  expect(parseCalloutExample('> [!method-outline] 复现\n>\n> 保留 **参数**')).toEqual({ type: 'method-outline', title: '复现', body: '保留 **参数**' });
  expect(parseCalloutExample('> [!important] 标题\n未引用的代码')).toBeNull();
  expect(parseCalloutExample('> [!important] 标题\n> [!question] 另一块')).toBeNull();
});
