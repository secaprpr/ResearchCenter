const fs = require('node:fs/promises');
const path = require('node:path');

const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const clean = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

// Use the provider's official dataset, never the account's custom rankings.
function parseEasyScholar(body) {
  if (Number(body?.code) !== 200) {
    const code = Number(body?.code) || 0;
    throw new Error(code === 40002 ? 'easyScholar 密钥无效，请检查配置。' : `easyScholar 查询未成功（${code || '响应异常'}）。`);
  }
  const rank = body.data?.officialRank?.all;
  if (!rank || typeof rank !== 'object' || Array.isArray(rank)) return {};
  const fields = {};
  const impact = clean(rank.sciif);
  if (/^\d+(?:\.\d+)?$/.test(impact)) fields.impact_factor = Number(impact);
  const quartile = clean(rank.sci).toUpperCase();
  if (/^Q[1-4]$/.test(quartile)) fields.jcr_quartile = quartile;
  const cas = clean(rank.sciUp);
  if (/[1-4一二三四]区/.test(cas) && cas.length < 150) fields.cas_zone = cas;
  const ccf = clean(rank.ccf).toUpperCase().replace(/^CCF\s*/, '');
  if (/^[ABC]$/.test(ccf)) fields.ccf_rank = ccf;
  return fields;
}

function createMetricsService({ root, encrypt, decrypt, request, now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const settingsPath = path.join(root, 'journal-metrics-settings.json');
  const cachePath = path.join(root, 'journal-metrics-cache.json');
  let tail = Promise.resolve(), lastStart = 0;
  const pending = new Map();
  const read = async (file, fallback) => { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error('指标本地配置无法读取。'); } };
  const write = async (file, data) => { await fs.mkdir(root, { recursive: true }); const tmp = file + '.tmp'; await fs.writeFile(tmp, JSON.stringify(data, null, 2)); await fs.rename(tmp, file); };
  const serialize = action => { const result = tail.then(action); tail = result.catch(() => {}); return result; };
  async function status() { const s = await read(settingsPath, {}); return { configured: Boolean(s.encryptedKey), enabled: Boolean(s.enabled && s.encryptedKey) }; }
  async function configure({ key, enabled }) {
    return serialize(async () => {
      const settings = await read(settingsPath, {});
      if (key !== undefined) {
        const value = String(key).trim();
        if (value && !/^[a-zA-Z0-9_-]{12,256}$/.test(value)) throw new Error('密钥格式不正确。');
        settings.encryptedKey = value ? encrypt(value) : '';
      }
      if (typeof enabled === 'boolean') settings.enabled = enabled;
      await write(settingsPath, settings);
      return status();
    });
  }
  async function lookup(venue, { force = false } = {}) {
    const query = String(venue || '').trim();
    if (!query || query.length > 300) throw new Error('请先补全文献的期刊或会议名称。');
    const id = normalize(query);
    if (pending.has(id)) return pending.get(id);
    const job = serialize(async () => {
      const settings = await read(settingsPath, {});
      if (!settings.encryptedKey) throw new Error('请先配置 easyScholar 密钥。');
      const cache = await read(cachePath, {});
      const stored = cache[id];
      const ttl = stored && Object.keys(stored.fields || {}).length ? 30 * 86400000 : 86400000;
      if (!force && stored && now() - stored.fetchedAt < ttl) return { ...stored, cached: true };
      const key = decrypt(settings.encryptedKey);
      const wait = Math.max(0, 650 - (now() - lastStart));
      if (wait) await pause(wait);
      lastStart = now();
      const url = new URL('https://www.easyscholar.cc/open/getPublicationRank');
      url.searchParams.set('secretKey', key);
      url.searchParams.set('publicationName', query);
      let body;
      try {
        const response = await request(url.href, { signal: AbortSignal.timeout(20000), redirect: 'error' });
        if (!response.ok) throw new Error('HTTP');
        body = await response.json();
      } catch { throw new Error('easyScholar 连接失败或请求超时，请稍后重试。'); }
      const fields = parseEasyScholar(body);
      const result = { fields, venue: query, source: 'easyScholar', edition: '服务当前返回版本（未提供指标年份）', fetchedAt: now() };
      cache[id] = result;
      await write(cachePath, cache);
      return { ...result, cached: false };
    });
    pending.set(id, job);
    try { return await job; } finally { pending.delete(id); }
  }
  return { status, configure, lookup };
}

function registerJournalMetrics(app, handleTrusted) {
  const { safeStorage, net } = require('electron');
  const service = createMetricsService({ root: app.getPath('userData'), request: (url, options) => net.fetch(url, options),
    encrypt: key => { if (!safeStorage.isEncryptionAvailable()) throw new Error('系统密钥加密不可用，未保存密钥。'); return safeStorage.encryptString(key).toString('base64'); },
    decrypt: data => { try { return safeStorage.decryptString(Buffer.from(data, 'base64')); } catch { throw new Error('密钥无法解密，请在本机重新配置。'); } },
  });
  handleTrusted('research:metrics', async (_event, action, payload = {}) => {
    if (action === 'status') return service.status();
    if (action === 'configure') return service.configure(payload);
    if (action === 'lookup') return service.lookup(payload.venue, { force: payload.force === true });
    throw new Error('未知指标操作。');
  });
}
module.exports = { createMetricsService, parseEasyScholar, registerJournalMetrics };
