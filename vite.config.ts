import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
// Serve and package the Markdown engine/fonts locally, including offline math.
const noteAssets = (): Plugin => {
  const folder = join(root, 'node_modules/vditor/dist');
  const allowed = /^(js\/(lute|i18n|icons|katex|highlight\.js)\/|css\/content-theme\/)/;
  const files = readdirSync(folder, { recursive: true }).map(String).map(path => path.replaceAll('\\', '/')).filter(path => allowed.test(path) && /\.(js|css|woff2?|ttf)$/.test(path));
  return {
    name: 'local-note-assets',
    configureServer(server) {
      server.middlewares.use('/note-assets/dist/', (req, res, next) => {
        const path = (req.url || '').split('?')[0].replace(/^\//, '');
        if (!files.includes(path)) return next();
        res.setHeader('Content-Type', path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.woff2') ? 'font/woff2' : 'font/woff');
        res.end(readFileSync(join(folder, path)));
      });
    },
    generateBundle() {
      for (const path of files) this.emitFile({ type: 'asset', fileName: 'note-assets/dist/' + path, source: readFileSync(join(folder, path)) });
    },
  };
};

export default defineConfig({
  plugins: [react(), noteAssets()],
  root,
  base: './',
  clearScreen: false,
  build: { rollupOptions: { input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), port: fileURLToPath(new URL('./port.html', import.meta.url)), today: fileURLToPath(new URL('./today.html', import.meta.url)) } } },
  server: { port: 1430, strictPort: true, watch: { ignored: ['**/.tmp-e2e-profile/**', '**/.local-profile/**', '**/.taste-skill/**', '**/test-results/**', '**/shots/**', '**/research-vault/**'] } },
  test: { environment: 'jsdom', setupFiles: [fileURLToPath(new URL('./src/test/setup.ts', import.meta.url))], exclude: ['src/test/e2e/**','macos/**','node_modules/**','dist/**'], css: true },
});
