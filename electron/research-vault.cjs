const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function relativePath(value) {
  const normalized = String(value || '').replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.split('/').some(segment => segment === '..') || normalized.includes('\0')) throw new Error('Invalid research file path');
  return normalized.replace(/\/{2,}/g, '/').replace(/\/$/, '');
}

async function inside(root, value) {
  const rel = relativePath(value);
  const target = path.resolve(root, rel);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('Path is outside research storage');
  let current = root;
  for (const segment of rel.split('/')) {
    current = path.join(current, segment);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Symbolic links are not supported in research storage'); }
    catch (error) { if (error.code === 'ENOENT') break; throw error; }
  }
  return target;
}

async function entries(root, prefix = '') {
  const output = [];
  for (const item of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    if (item.isSymbolicLink() || item.name.includes('.rw-tmp-')) continue;
    const relative = [prefix, item.name].filter(Boolean).join('/');
    const absolute = path.join(root, relative);
    const stat = await fs.stat(absolute);
    output.push({ path: relative, folder: item.isDirectory(), size: stat.size, mtime: stat.mtimeMs, ctime: stat.birthtimeMs });
    if (item.isDirectory()) output.push(...await entries(root, relative));
  }
  return output;
}

function registerResearchVault(app, handleTrusted) {
  require('./journal-metrics.cjs').registerJournalMetrics(app, handleTrusted);
  const root = () => path.join(app.getPath('userData'), 'research-vault');
  handleTrusted('research:choose-source', async event => {
    const { dialog, BrowserWindow } = require('electron');
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: '选择原 Obsidian Vault 文件夹', defaultPath: path.join(app.getPath('documents'), 'Obsidian'), properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handleTrusted('research:show-storage', async () => { await fs.mkdir(root(), { recursive: true }); await require('electron').shell.openPath(root()); });
  handleTrusted('research:runtime', async () => {
    const base = path.join(app.getAppPath(), app.isPackaged ? 'dist' : 'public', 'mupdf');
    return { moduleSource: await fs.readFile(path.join(base, 'mupdf.js'), 'utf8'), wasmLoaderSource: await fs.readFile(path.join(base, 'mupdf-wasm.js'), 'utf8'), wasmBinary: new Uint8Array(await fs.readFile(path.join(base, 'mupdf-wasm.wasm'))) };
  });
  handleTrusted('research:files', async (_event, action, payload = {}) => {
    const base = root();
    await fs.mkdir(base, { recursive: true });
    if (action === 'list') return entries(base);
    const target = await inside(base, payload.path);
    if (action === 'read') return payload.binary ? new Uint8Array(await fs.readFile(target)) : fs.readFile(target, 'utf8');
    if (action === 'mkdir') { await fs.mkdir(target, { recursive: true }); return; }
    if (action === 'remove') { await fs.rm(target, { recursive: payload.recursive === true, force: false }); return; }
    if (action === 'rename') { const destination = await inside(base, payload.destination); await fs.mkdir(path.dirname(destination), { recursive: true }); try { await fs.access(destination); throw new Error('Destination already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; } await fs.rename(target, destination); return; }
    if (action === 'write' || action === 'create') {
      const bytes = typeof payload.content === 'string' ? payload.content : Buffer.from(payload.content);
      if (Buffer.byteLength(bytes) > 120 * 1024 * 1024) throw new Error('Research file exceeds 120 MB');
      await fs.mkdir(path.dirname(target), { recursive: true });
      if (action === 'create') { await fs.writeFile(target, bytes, { flag: 'wx' }); return; }
      const temporary = target + '.rw-tmp-' + crypto.randomUUID();
      try { await fs.writeFile(temporary, bytes); await fs.rename(temporary, target); }
      finally { await fs.rm(temporary, { force: true }); }
      return;
    }
    throw new Error('Unknown research file operation');
  });

  handleTrusted('research:migrate', async (_event, sourceRoot) => {
    const source = path.resolve(String(sourceRoot || ''));
    const libPath = path.join(source, '.obsidian/plugins/research-library/data.json');
    const readerPath = path.join(source, '.obsidian/plugins/mupdf-reader-mvp');
    const lib = JSON.parse(await fs.readFile(libPath, 'utf8'));
    const candidates = new Set();
    const missing = [];
    const scan = async relative => {
      const absolute = await inside(source, relative);
      try {
        const stat = await fs.stat(absolute);
        if (stat.isDirectory()) for (const item of await entries(absolute)) { if (!item.folder) candidates.add(relativePath(relative + '/' + item.path)); }
        else candidates.add(relativePath(relative));
      } catch (error) { if (error.code === 'ENOENT') missing.push(relative); else throw error; }
    };
    // Only research folders and annotation assets are considered. Plugin settings
    // containing API keys are never copied from the original vault.
    for (const field of ['papersFolder', 'topicsFolder', 'projectsFolder', 'collectionsFolder', 'figuresFolder', 'pdfFolder', 'inboxFolder']) await scan(lib[field] || ({ papersFolder: 'Research/10 Papers', pdfFolder: 'Research/20 PDFs' }[field] || 'Research/' + field));
    const paperPaths = [...candidates].filter(value => /\.md$/i.test(value));
    for (const relative of paperPaths) {
      const text = await fs.readFile(await inside(source, relative), 'utf8');
      for (const match of text.matchAll(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g)) {
        const linked = match[1].replace(/^!/, '');
        if (/\.(pdf|png|jpe?g|webp|svg)$/i.test(linked)) await scan(linked);
      }
    }
    let readerIndex = null;
    try {
      readerIndex = JSON.parse(await fs.readFile(path.join(readerPath, 'storage/index.json'), 'utf8'));
      for (const document of Object.values(readerIndex.documents || {})) if (document.path) await scan(document.path);
      await scan('.obsidian/plugins/mupdf-reader-mvp/storage');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const destination = root();
    await fs.mkdir(destination, { recursive: true });
    let copied = 0, skipped = 0;
    const failures = [];
    for (const relative of candidates) {
      if (/\/backups\//.test(relative) || relative === '.obsidian/plugins/mupdf-reader-mvp/storage/index.json') continue;
      try {
        const target = await inside(destination, relative);
        const original = await inside(source, relative);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(original, target, require('node:fs').constants.COPYFILE_EXCL);
        copied++;
      } catch (error) { if (error.code === 'EEXIST') skipped++; else failures.push({ path: relative, message: error.message }); }
    }
    if (readerIndex) {
      const indexPath = await inside(destination, '.obsidian/plugins/mupdf-reader-mvp/storage/index.json');
      let current = { schemaVersion: 1, documents: {} };
      try { current = JSON.parse(await fs.readFile(indexPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      // The reader creates an empty index on its first launch. Merge that index
      // rather than letting COPYFILE_EXCL silently hide imported annotations.
      for (const [id, metadata] of Object.entries(readerIndex.documents || {})) {
        if (!current.documents[id]) current.documents[id] = metadata;
      }
      await fs.mkdir(path.dirname(indexPath), { recursive: true });
      await fs.writeFile(indexPath, JSON.stringify(current, null, 2));
    }
    const settings = {};
    for (const field of ['papersFolder', 'topicsFolder', 'projectsFolder', 'collectionsFolder', 'figuresFolder', 'pdfFolder', 'inboxFolder', 'columns', 'columnWidths', 'savedViews', 'density']) if (lib[field] !== undefined) settings[field] = lib[field];
    const settingsPath = await inside(destination, '.obsidian/plugins/research-library/data.json');
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    try { await fs.writeFile(settingsPath, JSON.stringify({ ...settings, autoSyncBibliography: false, llmRescueEnabled: false }), { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const report = { copied, skipped, missing: [...new Set(missing)], failures };
    const reportPath = await inside(destination, '.workbench/migration-report.json');
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    return report;
  });

  handleTrusted('research:request', async (_event, options) => {
    const url = new URL(options.url);
    const domains = ['crossref.org', 'openalex.org', 'semanticscholar.org', 'dblp.org', 'arxiv.org', 'openreview.net', 'mlr.press', 'neurips.cc', 'doi.org', 'googleapis.com', 'api.deepl.com', 'api-free.deepl.com'];
    const configuredOrigins = new Set();
    for (const [relative, fields] of [['.obsidian/plugins/mupdf-reader-mvp/data.json', ['openaiBaseUrl']], ['.obsidian/plugins/research-library/data.json', ['llmEndpoint']]]) {
      try { const data = JSON.parse(await fs.readFile(await inside(root(), relative), 'utf8')); const settings = data.settings || data; for (const field of fields) if(settings[field]) { const configured = new URL(settings[field]); if (['https:', 'http:'].includes(configured.protocol)) configuredOrigins.add(configured.origin); } } catch { /* Optional settings are absent until the user configures a provider. */ }
    }
    if (!(url.protocol === 'https:' && domains.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain))) && !configuredOrigins.has(url.origin)) throw new Error('请先在阅读与外观设置中配置此服务地址');
    const response = await fetch(url, { method: options.method || 'GET', headers: options.headers, body: options.body, signal: AbortSignal.timeout(30000), redirect: 'error' });
    const text = await response.text();
    return { status: response.status, headers: Object.fromEntries(response.headers), text };
  });
}
module.exports = { registerResearchVault, relativePath, inside };
