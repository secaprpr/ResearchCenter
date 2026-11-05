import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const [library, reader] = process.argv.slice(2);
if (!library || !reader) throw new Error('Usage: node scripts/port-obsidian.mjs <research-library> <mupdf-reader-mvp>');
const destination = path.resolve('src/migrated');
fs.mkdirSync(destination, { recursive: true });
const provenance = [];
for (const [name, source] of [['library', library], ['reader', reader]]) {
  const original = fs.readFileSync(path.join(source, 'main.js'), 'utf8');
  const code = original.replace(/const\s*\{([\s\S]*?)\}\s*=\s*require\(['"]obsidian['"]\);/, 'import {$1} from "../port/obsidian.js";')
    .replace('module.exports = ResearchLibraryPlugin;', 'export default ResearchLibraryPlugin;')
    .replace('module.exports = class MuPdfReaderPlugin', 'export default class MuPdfReaderPlugin');
  fs.writeFileSync(path.join(destination, `${name}.js`), `// Ported from the user-provided ${name} plugin; see PROVENANCE.json.\n${code}`);
  fs.copyFileSync(path.join(source, 'styles.css'), path.join(destination, `${name}.css`));
  provenance.push({ name, manifest: JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8')), sha256: crypto.createHash('sha256').update(original).digest('hex'), changes: 'CommonJS Obsidian import and module export adapted to the local compatibility host; original algorithms retained.' });
}
fs.writeFileSync(path.join(destination, 'PROVENANCE.json'), JSON.stringify(provenance, null, 2));
fs.mkdirSync('public/mupdf', { recursive: true });
for (const file of ['mupdf.js', 'mupdf-wasm.js', 'mupdf-wasm.wasm', 'LICENSE']) fs.copyFileSync(path.join(reader, 'vendor/mupdf', file), path.join('public/mupdf', file));
fs.copyFileSync(path.join(reader, 'LICENSE-NOTICE.md'), path.join(destination, 'READER-LICENSE-NOTICE.md'));
console.log('Ported both plugins and the unmodified MuPDF runtime. No settings or user data copied.');
