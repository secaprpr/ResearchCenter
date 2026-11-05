const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const url = 'http://127.0.0.1:1430/';
const development = process.argv.includes('--dev');
async function ready() { try { return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } }
(async () => {
  let server;
  if (!development && !fs.existsSync(path.join(root, 'dist/index.html'))) {
    throw new Error('Local build missing. Run npm run build first.');
  }
  if (development && !await ready()) {
    server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'], { cwd: root, stdio: 'inherit', windowsHide: true });
    const deadline = Date.now() + 30000;
    while (!await ready()) { if (Date.now() > deadline) throw new Error('Dev server startup timed out'); await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_START_URL;
  if (development) env.ELECTRON_START_URL = url;
  // The desktop window must remain visible even when its launcher is hidden.
  const electron = spawn(require('electron'), [root, '--user-data-dir=' + path.join(root, '.local-profile')], { cwd: root, env, stdio: 'inherit', windowsHide: false });
  electron.on('exit', code => { server?.kill(); process.exitCode = code || 0; });
  electron.on('error', error => { console.error(error); server?.kill(); process.exitCode = 1; });
})().catch(error => { console.error(error); process.exitCode = 1; });
