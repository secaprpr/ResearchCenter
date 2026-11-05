import { expect, it } from 'vitest';
import { normalizeNoteMathMarkdown, normalizeNoteMathHTML } from '../port/note-math.js';

it('normalizes inline and display LaTeX delimiters, including multiline matrices and numeric inline formulas', () => {
  expect(normalizeNoteMathMarkdown(String.raw`其中，\(n_i\) 表示第 \(i\) 类，共 \(47\) 类。`)).toBe('其中，$n_i$ 表示第 $i$ 类，共 $47$ 类。');
  expect(normalizeNoteMathMarkdown(String.raw`\[ p_i=\frac{n_i}{\sum_{j=1}^{47}n_j} \]`)).toBe('$$\np_i=\\frac{n_i}{\\sum_{j=1}^{47}n_j}\n$$');
  const matrix = String.raw`\[
\begin{pmatrix} a & b \\ c & d \end{pmatrix}
\]`;
  expect(normalizeNoteMathMarkdown(matrix)).toBe('$$\n\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}\n$$');
  expect(normalizeNoteMathMarkdown(String.raw`\\(n_i\\)`)).toBe('$n_i$');
});
it('repairs only standalone bracketed TeX formulas, never references, links or ordinary prose', () => {
  expect(normalizeNoteMathMarkdown(String.raw`[ \mathbf{p}=(p_1,\ldots,p_{47}), \quad \sum_{i=1}^{47}p_i=1 ]`)).toBe('$$\n\\mathbf{p}=(p_1,\\ldots,p_{47}), \\quad \\sum_{i=1}^{47}p_i=1\n$$');
  for (const text of ['[1]', '[n_i]', '[普通备注]', '(n_i)', String.raw`行内 [ \sum_i p_i ] 描述`, String.raw`[文献](https://example.com/\(path\))`, String.raw`C:\(path\)`, String.raw`\(未闭合`, String.raw`\[未闭合`]) expect(normalizeNoteMathMarkdown(text)).toBe(text);
});
it('leaves fenced/inline/indented/HTML code and existing dollar formulas byte-for-byte unchanged', () => {
  for (const text of [
    '```latex\n\\(x_i\\)\n[ \\frac{a}{b} ]\n```', '~~~~md\n\\[x\\]\n~~~~',
    '`\\(x_i\\)`', '`` a ` \\(x_i\\) ``', '    \\(x_i\\)', '\t[ \\frac{a}{b} ]',
    '<pre>\\(x_i\\)</pre>', '<code>\\[x\\]</code>', '<span title="\\(literal\\)">Text</span>',
    '$\\text{\\(literal\\)}$', '$$\n\\text{\\[literal\\]}\n$$',
  ]) expect(normalizeNoteMathMarkdown(text)).toBe(text);
});
const render = (body, display) => { const node = document.createElement(display ? 'div' : 'span'); node.className = 'language-math'; node.textContent = body; return node.outerHTML; };
it('recognizes HTML clipboard formulas and native backslash tokens while preserving the caret and neighboring formatting', () => {
  const html = '<p><strong>其中</strong>，\\(n_i\\)<wbr> 对应数量。</p><p>\\[p_i=\\frac{n_i}{N}\\]</p><p>After.</p>';
  const result = normalizeNoteMathHTML(html, render), root = document.createElement('div'); root.innerHTML = result;
  expect(root.querySelector('strong').textContent).toBe('其中'); expect(root.querySelector('span.language-math').textContent).toBe('n_i'); expect(root.querySelector('div.language-math').textContent).toBe('p_i=\\frac{n_i}{N}'); expect(root.querySelectorAll('wbr')).toHaveLength(1); expect(root.lastElementChild.textContent).toBe('After.');
  const tokens = '<p><span data-type="backslash"><span>\\</span>\\</span>(n<span data-type="backslash"><span>\\</span>_</span>i<span data-type="backslash"><span>\\</span>\\</span>)<wbr></p>';
  root.innerHTML = normalizeNoteMathHTML(tokens, render); expect(root.querySelector('.language-math').textContent).toBe('n_i'); expect(root.querySelector('[data-type=backslash]')).toBeNull(); expect(root.querySelector('wbr')).not.toBeNull();
  expect(normalizeNoteMathHTML('Bare \\(x\\) text', render)).toContain('class="language-math"');
});
it('HTML code, existing rendered formulas and links are not reinterpreted', () => {
  const html = '<pre><code>\\(x\\)</code></pre><p><a href="#">\\(link\\)</a><span class="language-math">\\(existing\\)</span></p>';
  expect(normalizeNoteMathHTML(html, render)).toBe(html);
});
