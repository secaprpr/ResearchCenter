import { frontmatter, normalizePath, processFrontMatter } from './vault.js';

export const ATTACHMENT_KINDS = { supplement: '附录', methods: '补充方法', figures: '补充图表', data: '数据', other: '其他' };
export const ATTACHMENT_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'tsv', 'txt', 'md', 'ppt', 'pptx', 'png', 'jpg', 'jpeg', 'webp', 'zip', 'json', 'bib', 'ris'];
export const ATTACHMENT_ACCEPT = ATTACHMENT_EXTENSIONS.map(ext => '.' + ext).join(',');
const linkPath = value => normalizePath(String(value || '').replace(/^!?\[\[|\]\]$/g, '').split('|')[0]);
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 24);
const cleanName = value => String(value || '').replace(/[\r\n\x00-\x1f]/g, ' ').trim().slice(0, 200);

export function createPaperAttachments({ vault, folder, papers, resolve }) {
  const cache = new Map(), queues = new Map();
  const list = file => {
    const raw = vault.texts.get(file.path) || '';
    if (cache.get(file.path)?.raw === raw) return cache.get(file.path).items;
    const fm = frontmatter(raw), stored = fm.supplementary_files, seen = new Set();
    const items = (Array.isArray(stored) ? stored : []).flatMap(item => {
      if (!item || typeof item !== 'object' || typeof item.path !== 'string') return [];
      const path = linkPath(item.path), id = String(item.id || path);
      if (!path || seen.has(id)) return []; seen.add(id);
      return [{ id, path, name: cleanName(item.name) || path.split('/').pop(), filename: cleanName(item.filename) || path.split('/').pop(), kind: Object.hasOwn(ATTACHMENT_KINDS, item.kind) ? item.kind : 'supplement', added: String(item.added || '') }];
    });
    cache.set(file.path, { raw, items, filename: cleanName(fm.metadata_original_filename) }); return items;
  };
  const documents = paper => {
    const supplementary = list(paper.file);
    const primary = resolve(paper.pdf, paper.file.path);
    return [...(paper.pdf ? [{ id: 'primary', path: primary?.path || linkPath(paper.pdf), name: '正文', filename: cache.get(paper.file.path)?.filename || primary?.name || linkPath(paper.pdf).split('/').pop(), kind: 'primary', primary: true }] : []), ...supplementary].map(item => ({ ...item, extension: item.path.split('.').pop().toLowerCase(), file: vault.getAbstractFileByPath(item.path) }));
  };
  const queue = (file, action) => {
    const task = (queues.get(file.path) || Promise.resolve()).catch(() => {}).then(action);
    queues.set(file.path, task);
    return task.finally(() => { if (queues.get(file.path) === task) queues.delete(file.path); });
  };
  const writeList = (file, transform) => processFrontMatter(vault, file, fm => {
    const next = transform(list(file)).map(item => ({ ...item, path: '[[' + item.path + ']]' }));
    if (next.length) fm.supplementary_files = next; else delete fm.supplementary_files;
  });
  return {
    list, documents,
    owner(path, preferred) {
      const candidates = papers().filter(paper => documents(paper).some(item => item.path === path));
      return candidates.find(paper => paper.file.path === preferred) || candidates[0];
    },
    add(file, files) { return queue(file, async () => {
      const existing = list(file), added = [], failures = []; let duplicates = 0;
      const parentId = await digest(new TextEncoder().encode(file.path));
      for (const incoming of files) {
        try {
          const ext = incoming.name.split('.').pop().toLowerCase();
          if (!ATTACHMENT_EXTENSIONS.includes(ext)) throw new Error('不支持此附件格式');
          if (incoming.size > 100 * 1024 * 1024) throw new Error('单个附件不能超过 100 MB');
          const bytes = await incoming.arrayBuffer();
          if (!bytes.byteLength) throw new Error('附件为空');
          if (ext === 'pdf' && !/%PDF-/.test(new TextDecoder().decode(bytes.slice(0, 1024)))) throw new Error('不是有效的 PDF');
          const id = await digest(bytes);
          if ([...existing, ...added].some(item => item.id === id)) { duplicates++; continue; }
          const path = `${normalizePath(folder())}/Supplements/${parentId}/${id}.${ext}`;
          if (!vault.getAbstractFileByPath(path)) await vault.createBinary(path, bytes);
          added.push({ id, path, name: cleanName(incoming.name), filename: cleanName(incoming.name), kind: ['csv', 'tsv', 'xls', 'xlsx', 'json'].includes(ext) ? 'data' : 'supplement', added: new Date().toISOString() });
        } catch (error) { failures.push({ name: incoming.name, message: error.message }); }
      }
      if (added.length) await writeList(file, current => [...current, ...added]);
      return { added, duplicates, failures };
    }); },
    update(file, id, patch) { return queue(file, () => {
      const name = cleanName(patch.name);
      if (!name) throw new Error('附件名称不能为空');
      return writeList(file, current => {
        if (!current.some(item => item.id === id)) throw new Error('附件关联已移除');
        return current.map(item => item.id === id ? { ...item, name, kind: Object.hasOwn(ATTACHMENT_KINDS, patch.kind) ? patch.kind : item.kind } : item);
      });
    }); },
    move(file, id, direction) { return queue(file, () => writeList(file, current => {
      const next = [...current], index = next.findIndex(item => item.id === id), target = index + (direction < 0 ? -1 : 1);
      if (index >= 0 && target >= 0 && target < next.length) [next[index], next[target]] = [next[target], next[index]];
      return next;
    })); },
    remove(file, id) { return queue(file, () => writeList(file, current => current.filter(item => item.id !== id))); },
  };
}
