// Keep embedded image bytes out of Lute's parser, DOM attributes and undo diffs.
// Markdown on disk/export still contains the original data URI; these object
// URLs only live as long as this editor instance.
export function installNoteImages(lute) {
  const byData = new Map(), byURL = new Map(), methods = {};
  const embedded = /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi;
  const compact = text => String(text).replace(embedded, data => {
    if (byData.has(data)) return byData.get(data);
    try {
      const comma = data.indexOf(','), mime = data.slice(5, data.indexOf(';'));
      const binary = atob(data.slice(comma + 1));
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      byData.set(data, url); byURL.set(url, data); return url;
    } catch { return data; }
  });
  const expand = text => {
    if (!text.includes('blob:')) return text;
    for (const [url, data] of byURL) if (text.includes(url)) text = text.split(url).join(data);
    return text;
  };
  const restoreLiterals = html => {
    if (![...byURL.keys()].some(url => html.includes(url))) return html;
    const template = document.createElement('template'); template.innerHTML = html;
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode; if (node.data.includes('blob:')) node.data = expand(node.data);
    }
    for (const node of template.content.querySelectorAll('*')) for (const attr of [...node.attributes]) {
      // Actual image sources stay compact. Code examples, image alt/title text
      // and ordinary links must continue to display their original contents.
      if (!(node.tagName === 'IMG' && attr.name === 'src') && attr.value.includes('blob:')) node.setAttribute(attr.name, expand(attr.value));
    }
    return template.innerHTML;
  };
  for (const name of ['Md2VditorDOM', 'SpinVditorDOM', 'HTML2VditorDOM', 'VditorDOM2Md', 'VditorDOM2HTML']) {
    if (typeof lute[name] !== 'function') continue;
    const original = lute[name]; methods[name] = original;
    lute[name] = (text, ...args) => {
      const result = original.call(lute, compact(text), ...args);
      return name.startsWith('VditorDOM') ? expand(result) : restoreLiterals(result);
    };
  }
  return () => {
    for (const [name, method] of Object.entries(methods)) lute[name] = method;
    for (const url of byURL.keys()) URL.revokeObjectURL(url);
    byData.clear(); byURL.clear();
  };
}
