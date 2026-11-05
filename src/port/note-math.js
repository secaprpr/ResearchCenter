// Accept common LaTeX delimiters at the editor boundary. The stored document
// remains portable Markdown ($ / $$), with code and existing math untouched.
const strongMath = /\\(?:frac|dfrac|tfrac|sum|prod|int|mathbf|mathrm|mathbb|mathcal|boldsymbol|begin|sqrt|overline|underbrace)\b/;
const blockSelector = 'p,li,td,th,h1,h2,h3,h4,h5,h6,div';
const excluded = 'code,pre,a,script,style,textarea,.language-math,.vditor-wysiwyg__block,[data-type="math-inline"],[data-type="math-block"],[contenteditable=false]';

function mathMatches(text, markdown = true) {
  const matches = [];
  for (let i = 0; i < text.length;) {
    const lineStart = i === 0 || text[i - 1] === '\n';
    if (markdown && lineStart) {
      const lineEnd = text.indexOf('\n', i), end = lineEnd < 0 ? text.length : lineEnd;
      const line = text.slice(i, end), fence = line.match(/^ {0,3}(?:> ?)*(`{3,}|~{3,})/);
      if (fence) {
        const close = new RegExp('^ {0,3}(?:> ?)*' + fence[1][0] + '{' + fence[1].length + ',}[^\\S\\n]*$', 'gm');
        close.lastIndex = end + 1; const closing = close.exec(text); i = closing ? close.lastIndex : text.length; continue;
      }
      if (/^(?: {4}|\t)/.test(line)) { i = end + 1; continue; }
      // Earlier Markdown parsing may have consumed the slashes of \[...\].
      // Recover only an isolated bracketed expression with explicit TeX math.
      const bare = line.match(/^( {0,3}(?:> ?)*)(\[)([^\n]+)\]\s*$/);
      if (bare && strongMath.test(bare[3]) && !/\]\s*\(/.test(bare[3])) {
        matches.push({ start: i + bare[1].length, end: end - line.match(/\s*$/)[0].length, body: bare[3].trim(), display: true, prefix: bare[1] }); i = end + 1; continue;
      }
    }
    if (text[i] === '`') {
      const ticks = text.slice(i).match(/^`+/)[0], close = text.indexOf(ticks, i + ticks.length);
      i = close < 0 ? i + ticks.length : close + ticks.length; continue;
    }
    if (markdown && text[i] === '<') {
      const raw = text.slice(i).match(/^<(pre|code|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|^<!--[\s\S]*?-->|^<[^>\n]+>/i);
      if (raw) { i += raw[0].length; continue; }
    }
    if (markdown && (text[i] === '[' || (text[i] === '!' && text[i + 1] === '['))) {
      const link = text.slice(i).match(/^!?\[(?:\\.|[^\]\n])*\]\((?:\\.|[^()\n]|\([^()\n]*\))*\)/);
      if (link) { i += link[0].length; continue; }
    }
    if (text[i] === '$' && (i === 0 || text[i - 1] !== '\\')) {
      const marker = text[i + 1] === '$' ? '$$' : '$', close = text.indexOf(marker, i + marker.length);
      if (close >= 0) { i = close + marker.length; continue; }
    }
    if (text[i] === '\\') {
      const open = text.slice(i).match(/^(\\{1,2})([[(])/);
      if (open && (i === 0 || text[i - 1] !== '\\')) {
        const display = open[2] === '[', marker = open[1] + (display ? ']' : ')');
        const close = text.indexOf(marker, i + open[0].length);
        if (close >= 0) {
          const body = text.slice(i + open[0].length, close), end = close + marker.length;
          const prefix = text.slice(text.lastIndexOf('\n', i - 1) + 1, i), suffix = text.slice(end, text.indexOf('\n', end) < 0 ? text.length : text.indexOf('\n', end));
          const standalone = /^ {0,3}(?:> ?)*$/.test(prefix) && !suffix.trim();
          if (body.trim() && (display ? standalone : !body.includes('\n')) && !/[a-z]:$/i.test(prefix)) {
            const clean = display && prefix.includes('>') ? body.split('\n').map(line => line.startsWith(prefix) ? line.slice(prefix.length) : line).join('\n') : body;
            matches.push({ start: i, end, body: clean.trim(), display, prefix: display ? prefix : '' }); i = end; continue;
          }
        }
      }
      // Escaped punctuation must not become an inline-code/math opener.
      i += 2; continue;
    }
    i++;
  }
  return matches;
}

export function normalizeNoteMathMarkdown(text) {
  if (!/\\[[(]|\[[^\n]*\\/.test(text)) return text;
  let result = text;
  for (const match of mathMatches(text).reverse()) {
    const md = match.display ? '$$\n' + match.prefix + match.body.replaceAll('\n', '\n' + match.prefix) + '\n' + match.prefix + '$$' : '$' + match.body + '$';
    result = result.slice(0, match.start) + md + result.slice(match.end);
  }
  return result;
}

export function normalizeNoteMathHTML(html, renderMath) {
  if (!/\\[()[\]]|\[[^\n<]*\\/.test(html) && !(/data-type=["']backslash/.test(html) && /[)\]]/.test(html))) return html;
  const template = document.createElement('template'); template.innerHTML = html;
  let changed = false;
  for (const block of [...template.content.querySelectorAll(blockSelector), template.content]) {
    if (block.nodeType === 1 && block.closest(excluded)) continue;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT), pieces = [];
    let text = '', node;
    while ((node = walker.nextNode())) {
      const element = node.parentElement;
      if (element?.closest(excluded) || (element?.closest(blockSelector) || null) !== (block.nodeType === 1 ? block : null)) continue;
      // Vditor's backslash token has a hidden marker child followed by its
      // visible character. Do not count that hidden slash a second time.
      if (element?.parentElement?.matches('[data-type=backslash]')) continue;
      pieces.push({ node, start: text.length, end: text.length + node.data.length }); text += node.data;
    }
    const matches = mathMatches(text, true);
    for (const match of matches.reverse()) {
      const first = pieces.find(piece => piece.start <= match.start && piece.end > match.start);
      const last = pieces.find(piece => piece.start < match.end && piece.end >= match.end);
      if (!first || !last) continue;
      const range = document.createRange();
      const from = match.start - first.start, to = match.end - last.start;
      if (from === 0 && first.node.parentElement?.matches('[data-type=backslash]')) range.setStartBefore(first.node.parentElement);
      else range.setStart(first.node, from);
      if (to === last.node.data.length && last.node.parentElement?.matches('[data-type=backslash]')) range.setEndAfter(last.node.parentElement);
      else range.setEnd(last.node, to);
      const content = range.cloneContents(), caret = content.querySelector('wbr');
      const rendered = document.createElement('template'); rendered.innerHTML = renderMath(match.body, match.display);
      if (match.display && block.nodeType === 1 && block.tagName === 'P' && !text.slice(0, match.start).trim() && !text.slice(match.end).trim()) {
        if (block.querySelector('wbr')) { const p = document.createElement('p'); p.dataset.block = '0'; p.append(document.createElement('wbr')); rendered.content.append(p); }
        block.replaceWith(rendered.content);
      } else {
        if (caret) rendered.content.append(document.createElement('wbr'));
        range.deleteContents(); range.insertNode(rendered.content);
      }
      changed = true;
    }
  }
  return changed ? template.innerHTML : html;
}

export function installNoteMath(lute) {
  const methods = Object.fromEntries(['Md2VditorDOM', 'HTML2VditorDOM', 'SpinVditorDOM'].map(name => [name, lute[name]]));
  lute.Md2VditorDOM = (text, ...args) => methods.Md2VditorDOM.call(lute, normalizeNoteMathMarkdown(text), ...args);
  for (const name of ['HTML2VditorDOM', 'SpinVditorDOM']) lute[name] = (html, ...args) => {
    const prepared = normalizeNoteMathHTML(html, (body, display) => {
      if (name === 'HTML2VditorDOM') {
        const node = document.createElement(display ? 'div' : 'span'); node.className = 'language-math'; node.dataset.type = display ? 'math-block' : 'math-inline'; node.textContent = body; return node.outerHTML;
      }
      const parsed = document.createElement('template'); parsed.innerHTML = methods.Md2VditorDOM.call(lute, display ? '$$\n' + body + '\n$$' : '$' + body + '$');
      return display ? parsed.innerHTML : parsed.content.querySelector('p').innerHTML;
    });
    return methods[name].call(lute, prepared, ...args);
  };
  return () => { for (const [name, method] of Object.entries(methods)) lute[name] = method; };
}
