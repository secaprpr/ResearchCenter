export const NOTE_TONES = [
  { id: 'amber', name: '琥珀', ink: '#805c20', fill: '#fff5dc', line: '#bd9148' },
  { id: 'teal', name: '青绿', ink: '#2d6a60', fill: '#edf6f3', line: '#6a9d91' },
  { id: 'blue', name: '雾蓝', ink: '#3b6287', fill: '#eef4fb', line: '#7e9cbb' },
  { id: 'sage', name: '鼠尾草', ink: '#4e6d37', fill: '#f0f5e9', line: '#8aa36d' },
  { id: 'rose', name: '陶红', ink: '#9e5038', fill: '#fff0e9', line: '#c68870' },
  { id: 'plum', name: '烟紫', ink: '#735b87', fill: '#f5eff9', line: '#a18ab3' },
  { id: 'slate', name: '石蓝', ink: '#4f6178', fill: '#eff2f6', line: '#8999ac' },
  { id: 'stone', name: '暖灰', ink: '#685f51', fill: '#f5f2eb', line: '#aa9e89' },
];
export const NOTE_CALLOUTS = [
  { type: 'important', label: '重点', tone: 'amber' },
  { type: 'question', label: '疑问', tone: 'blue' },
  { type: 'method', label: '方法', tone: 'teal' },
  { type: 'conclusion', label: '结论', tone: 'sage' },
  { type: 'evidence', label: '证据', tone: 'slate' },
  { type: 'warning', label: '警告', tone: 'rose' },
  { type: 'idea', label: '灵感', tone: 'plum' },
  { type: 'summary', label: '总结', tone: 'stone' },
];
export function parseCalloutExample(text) {
  const lines = text.trim().split(/\r?\n/), heading = lines[0]?.match(/^>\s*\[!([a-z-]+)\]\s*(.*)$/i);
  if (!heading || !NOTE_CALLOUTS.some(item => heading[1].toLowerCase().replace(/-(outline|soft)$/, '') === item.type)) return null;
  if (lines.slice(1).some(line => line.trim() && (!/^>/.test(line) || /^>\s*\[!/.test(line)))) return null;
  return { type: heading[1].toLowerCase(), title: heading[2].trim(), body: lines.slice(1).map(line => line.replace(/^> ?/, '')).join('\n').trim() };
}
export const toneFor = id => NOTE_TONES.find(tone => tone.id === id) || NOTE_TONES[0];
export const calloutMarkdown = (type, variant, title, body) => {
  const name = type + (variant === 'line' ? '' : '-' + variant);
  return `> [!${name}] ${title.replace(/[\r\n]/g, ' ').trim()}\n>\n` + body.trim().split('\n').map(line => '> ' + line).join('\n') + '\n';
};
const escapeHTML = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function inlineStyleHTML(text, { mode, ink, fill, radius = 4 }, formattedMarkdown) {
  const style = [`color: ${ink}`];
  if (mode === 'highlight') style.push(`background-color: ${fill}`, 'padding: 0.08em 0.3em', `border-radius: ${radius}px`);
  if (mode === 'outline') style.push(`border: 1px solid ${ink}`, 'padding: 0.05em 0.3em', `border-radius: ${radius}px`);
  if (mode === 'underline') style.push('text-decoration-line: underline', `text-decoration-color: ${ink}`, 'text-decoration-thickness: 2px', 'text-underline-offset: 3px');
  return `<span class="rw-note-inline" style="${style.join('; ')};">${formattedMarkdown ?? escapeHTML(text)}</span>`;
}

const template = html => { const el = document.createElement('template'); el.innerHTML = html; return el; };
const cleanMarker = value => value.replaceAll('\u200b', '').trim();
const PROPERTIES = new Set(['color', 'background-color', 'border', 'border-color', 'border-width', 'border-style', 'border-radius', 'padding', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'text-decoration-color', 'text-decoration-thickness', 'text-underline-offset']);
const LONGHAND = /^(?:border-(?:top|right|bottom|left)-(?:width|style|color)|border-(?:top|bottom)-(?:left|right)-radius|padding-(?:top|right|bottom|left))$/;
function styledElement(opening) {
  const parsed = template(opening).content.firstElementChild;
  if (!parsed || !['SPAN', 'MARK'].includes(parsed.tagName)) return null;
  const result = document.createElement(parsed.tagName.toLowerCase());
  for (const name of parsed.classList) if (name === 'rw-note-inline' || /^(tone-(amber|teal|blue|sage|rose|plum|slate|stone)|mode-(highlight|text|outline|underline))$/.test(name)) result.classList.add(name);
  for (const property of Array.from(parsed.style)) {
    const value = parsed.style.getPropertyValue(property);
    if ((PROPERTIES.has(property) || LONGHAND.test(property)) && !/url\s*\(|expression|!important|[<>]/i.test(value)) result.style.setProperty(property, value);
  }
  // Vditor removes inline style attributes before normalizing typed text. Keep
  // the same accepted CSS on the editable node until the serializer runs.
  result.setAttribute('data-rw-note-style', result.style.cssText);
  return result;
}

// Lute normally exposes inline HTML as code chips. Translate only the styled
// span/mark subset into editable inline nodes, and back before serialization.
// This preserves real Markdown + inline HTML, rather than a private document DB.
export function renderNoteInlineStyles(html) {
  if (!html.includes('html-inline') || !/&lt;\/?(?:span|mark)(?:\s|&gt;)/i.test(html)) return html;
  const root = template(html);
  const codes = [...root.content.querySelectorAll('code[data-type="html-inline"]')];
  const stack = [], pairs = [];
  for (const code of codes) {
    const value = cleanMarker(code.textContent);
    const open = value.match(/^<(span|mark)\b[^>]*>$/i), close = value.match(/^<\/(span|mark)\s*>$/i);
    if (open) stack.push({ code, tag: open[1].toLowerCase(), opening: value });
    else if (close && stack.at(-1)?.tag === close[1].toLowerCase()) pairs.push([stack.pop(), code]);
  }
  // Inner pairs close first, so nested inline styles also round-trip.
  for (const [start, end] of pairs) {
    if (start.code.parentNode !== end.parentNode) continue;
    const node = styledElement(start.opening); if (!node) continue;
    const range = document.createRange(); range.setStartAfter(start.code); range.setEndBefore(end);
    node.append(range.extractContents()); start.code.replaceWith(node); end.remove();
  }
  return root.innerHTML;
}
export function protectNoteInlineStyles(html) {
  if (!html.includes('data-rw-note-style')) return html;
  const root = template(html);
  for (const node of [...root.content.querySelectorAll('[data-rw-note-style]')].reverse()) {
    const clone = node.cloneNode(false);
    if (!clone.style.cssText) clone.style.cssText = node.getAttribute('data-rw-note-style') || '';
    clone.removeAttribute('data-rw-note-style');
    const opening = clone.outerHTML.slice(0, clone.outerHTML.indexOf('>') + 1);
    const start = document.createElement('code'), end = document.createElement('code');
    start.dataset.type = end.dataset.type = 'html-inline'; start.textContent = opening; end.textContent = `</${node.tagName.toLowerCase()}>`;
    node.replaceWith(start, ...node.childNodes, end);
  }
  return root.innerHTML;
}
export function renderTitleOnlyCallouts(html) {
  // Lute recognises a callout only when it also has body content. Obsidian's
  // title-only form is valid too; give it the same native DOM without adding
  // invisible placeholder text to the user's portable Markdown.
  if (!html.includes('<blockquote') || !html.includes('[!')) return html;
  const root = template(html);
  for (const block of root.content.querySelectorAll('blockquote:not(.callout)')) {
    const p = block.firstElementChild;
    if (block.children.length !== 1 || p?.tagName !== 'P' || p.firstChild?.nodeType !== Node.TEXT_NODE) continue;
    const parsed = parseCalloutExample('> ' + p.textContent), prefix = p.firstChild.textContent.match(/^\[![a-z-]+\]\s*/i);
    if (!parsed || !prefix) continue;
    block.classList.add('callout'); block.dataset.type = 'callout'; block.dataset.subtype = parsed.type;
    p.classList.add('callout-info'); p.firstChild.textContent = p.firstChild.textContent.slice(prefix[0].length);
    const marker = document.createElement('span'); marker.className = 'vditor-wysiwyg__callout-marker'; marker.textContent = `[!${parsed.type}] `; p.prepend(marker);
  }
  return root.innerHTML;
}
export function installNoteMarkup(lute) {
  const methods = {};
  for (const name of ['Md2VditorDOM', 'SpinVditorDOM', 'HTML2VditorDOM', 'VditorDOM2Md', 'VditorDOM2HTML']) {
    if (typeof lute[name] !== 'function') continue;
    const original = lute[name]; methods[name] = original;
    lute[name] = (...args) => {
      if (name.startsWith('VditorDOM') || name === 'SpinVditorDOM') args[0] = protectNoteInlineStyles(args[0]);
      const result = original.apply(lute, args);
      return ['Md2VditorDOM', 'SpinVditorDOM', 'HTML2VditorDOM'].includes(name) ? renderTitleOnlyCallouts(renderNoteInlineStyles(result)) : result;
    };
  }
  return () => { for (const [name, method] of Object.entries(methods)) lute[name] = method; };
}
