// Ported from the user-provided reader plugin; see PROVENANCE.json.
import { ItemView, Menu, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, requestUrl, setIcon } from "../port/obsidian.js";

const VIEW_TYPE = 'mupdf-reader-view';
const SIDEBAR_VIEW_TYPE = 'mupdf-reader-research-sidebar';
const STORAGE_SCHEMA_VERSION = 1;
const DATA_SCHEMA_VERSION = 11;
const MUPDF_VERSION = '1.28.0';
const BASE_CSS_DPI = 96;
const PDF_DPI = 72;
const BASE_SCALE = BASE_CSS_DPI / PDF_DPI;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
const MAX_RENDER_PIXELS = 24_000_000;
const PAGE_RENDER_OVERSAMPLE = 1.12;
const DETAIL_TILE_CSS_SIZE = 512;
const DETAIL_TILE_MARGIN_CSS = 180;
const DETAIL_TILE_MAX_PIXELS = 6_000_000;
const MAX_RENDERED_PAGES = 10;
const ANNOTATION_COLORS = ['yellow', 'green', 'blue', 'pink'];
const ANNOTATION_COLOR_LABELS = { yellow: '黄色', green: '绿色', blue: '蓝色', pink: '粉色' };
const ANNOTATION_DISPLAY_MODES = { key: '关键展开', markers: '仅标记', all: '全部展开', hidden: '隐藏' };
const DEFAULT_FAVORITE_TAGS = ['核心结论', '创新点', '方法', '实验', '待验证', '待复现'];
const DEFAULT_SETTINGS = {
  translationProvider: 'google-web',
  translationTarget: 'zh-CN',
  deeplApiKey: '',
  deeplEndpointMode: 'auto',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiApiKey: '',
  openaiModel: '',
  openaiTranslationPrompt: 'Translate the selected academic text into {target}. Preserve equations, mathematical symbols, citations, abbreviations, model names, and technical terms when appropriate. Do not add explanations or commentary. Return only the translation.',
  openaiStreaming: true,
  openaiDeepSeekFastMode: true,
  translationAutoEnabled: true,
  translationGuardMinChars: 5,
  translationGuardMaxChars: 1200,
  translationPanelPinned: false,
  translationPanelX: null,
  translationPanelY: null,
  translationPanelWidth: 420,
  translationPanelHeight: 540,
  translationPanelFollowSelection: false,
  translationFontSize: 15,
  annotationDisplayMode: 'key',
  favoriteTags: DEFAULT_FAVORITE_TAGS.slice(),
  rememberReadingPosition: true,
  researchSidebarPinned: false
};
const TRANSLATION_TARGET_LABELS = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  'en': 'English',
  'ja': '日本語',
  'ko': '한국어',
  'de': 'Deutsch',
  'fr': 'Français'
};
const TRANSLATION_PROVIDER_LABELS = {
  'google-web': 'Google Web',
  'deepl': 'DeepL API',
  'openai-compatible': 'OpenAI-compatible'
};
const DEEPL_TARGET_CODES = {
  'zh-CN': 'ZH-HANS',
  'zh-TW': 'ZH-HANT',
  'en': 'EN',
  'ja': 'JA',
  'ko': 'KO',
  'de': 'DE',
  'fr': 'FR'
};
const MAX_TRANSLATION_CHARS = 12000;
const TRANSLATION_CHUNK_CHARS = 1800;
const TRANSLATION_MIN_REQUEST_INTERVAL_MS = 1400;
const TRANSLATION_RATE_LIMIT_COOLDOWN_MS = 60_000;
const TRANSLATION_RATE_LIMIT_RETRY_MS = 5_000;
const TRANSLATION_AUTO_DEBOUNCE_GOOGLE_MS = 420;
const TRANSLATION_AUTO_DEBOUNCE_DEEPL_MS = 240;
const TRANSLATION_AUTO_DEBOUNCE_LLM_MS = 180;

function translationAutoDebounceMs(provider) {
  if (provider === 'openai-compatible') return TRANSLATION_AUTO_DEBOUNCE_LLM_MS;
  if (provider === 'deepl') return TRANSLATION_AUTO_DEBOUNCE_DEEPL_MS;
  return TRANSLATION_AUTO_DEBOUNCE_GOOGLE_MS;
}

function normalizeTag(value) {
  return String(value || '').trim().replace(/^#+/, '').replace(/\s+/g, '-').replace(/[，,；;]+$/g, '').slice(0, 64);
}

function normalizeTags(values) {
  const source = Array.isArray(values) ? values : String(values || '').split(/[\n,，;；]+/);
  const out = [];
  const seen = new Set();
  for (const value of source) {
    const tag = normalizeTag(value);
    if (!tag) continue;
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 24) break;
  }
  return out;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function debounce(fn, delay) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

function createButton(parent, icon, label, handler) {
  const button = parent.createEl('button', { cls: 'mupdf-reader-btn', attr: { 'aria-label': label, title: label } });
  setIcon(button, icon);
  button.addEventListener('click', handler);
  return button;
}

class MuPdfWorkerClient {
  constructor(runtimeAssets) {
    this.seq = 1;
    this.pending = new Map();
    this.ready = false;
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    const workerSource = String.raw`
      let mupdf = null;
      let nextDocumentId = 1;
      const documents = new Map();
      const structuredTextCache = new Map();
      const textLayoutCache = new Map();
      const methods = {};
      let runtimeUrls = [];

      function serializeError(error) {
        return { name: error?.name || 'Error', message: error?.message || String(error), stack: error?.stack || '' };
      }

      function patchWasmLoaderSource(source) {
        const envNeedle = 'm="object"==typeof process&&"object"==typeof process.versions&&"string"==typeof process.versions.node&&"renderer"!=process.type;';
        if (!source.includes(envNeedle)) {
          throw new Error('Unexpected MuPDF WASM loader format: environment probe was not found');
        }
        // Force Emscripten's web/worker path. The WASM bytes are supplied directly,
        // so no Node fs/module access is needed or wanted inside Obsidian's worker.
        return source.replace(envNeedle, 'm=false;');
      }

      function patchMuPdfSource(source, wasmLoaderUrl) {
        const importNeedle = 'import libmupdf_wasm from "./mupdf-wasm.js";';
        if (!source.includes(importNeedle)) {
          throw new Error('Unexpected MuPDF runtime format: wasm loader import was not found');
        }
        source = source.replace(importNeedle, 'import libmupdf_wasm from ' + JSON.stringify(wasmLoaderUrl) + ';');

        // Obsidian/Electron exposes a Node-like process object in renderer contexts.
        // MuPDF 1.28.0 sees that object and tries importing node:fs, which a browser
        // module worker cannot resolve. We never use filename-based MuPDF APIs here,
        // so disable only that optional Node fs import while keeping upstream code intact.
        const fsImportNeedle = 'node_fs = await import("node:fs");';
        if (!source.includes(fsImportNeedle)) {
          throw new Error('Unexpected MuPDF runtime format: node:fs import was not found');
        }
        source = source.replace(fsImportNeedle, 'node_fs = null;');
        return source;
      }

      async function bootRuntime(payload) {
        if (!(payload.wasmBinary instanceof ArrayBuffer)) {
          throw new Error('MuPDF WASM binary was not supplied to the worker');
        }

        // Supply WASM bytes directly. This avoids file://, app:// and CSP/fetch path
        // differences between Obsidian desktop installations.
        globalThis.$libmupdf_wasm_Module = {
          wasmBinary: new Uint8Array(payload.wasmBinary),
          locateFile: () => 'mupdf-wasm.wasm'
        };

        const wasmLoaderSource = patchWasmLoaderSource(payload.wasmLoaderSource);
        const wasmLoaderUrl = URL.createObjectURL(new Blob([wasmLoaderSource], { type: 'text/javascript' }));
        runtimeUrls.push(wasmLoaderUrl);
        const moduleSource = patchMuPdfSource(payload.moduleSource, wasmLoaderUrl);
        const moduleUrl = URL.createObjectURL(new Blob([moduleSource], { type: 'text/javascript' }));
        runtimeUrls.push(moduleUrl);
        mupdf = await import(moduleUrl);
      }

      methods.openDocument = function(buffer, magic) {
        const id = nextDocumentId++;
        const doc = mupdf.Document.openDocument(buffer, magic || 'application/pdf');
        documents.set(id, doc);
        return id;
      };

      methods.closeDocument = function(docId) {
        const doc = documents.get(docId);
        for (const [key, stext] of structuredTextCache) {
          if (key.startsWith(docId + ':')) {
            try { stext.destroy(); } catch (_) {}
            structuredTextCache.delete(key);
          }
        }
        for (const key of textLayoutCache.keys()) {
          if (key.startsWith(docId + ':')) textLayoutCache.delete(key);
        }
        if (doc) {
          doc.destroy();
          documents.delete(docId);
        }
        return true;
      };

      function getStructuredText(docId, pageIndex) {
        const key = docId + ':' + pageIndex;
        let stext = structuredTextCache.get(key);
        if (stext) {
          structuredTextCache.delete(key);
          structuredTextCache.set(key, stext);
          return stext;
        }
        const doc = documents.get(docId);
        if (!doc) throw new Error('Document is not open');
        const page = doc.loadPage(pageIndex);
        try {
          stext = page.toStructuredText('preserve-whitespace');
          structuredTextCache.set(key, stext);
          while (structuredTextCache.size > 8) {
            const oldestKey = structuredTextCache.keys().next().value;
            if (!oldestKey || oldestKey === key) break;
            const oldest = structuredTextCache.get(oldestKey);
            structuredTextCache.delete(oldestKey);
            try { oldest?.destroy(); } catch (_) {}
          }
          return stext;
        } finally {
          page.destroy();
        }
      }

      function quadBounds(quad) {
        if (!Array.isArray(quad) || quad.length < 8) return [0, 0, 0, 0];
        const xs = [quad[0], quad[2], quad[4], quad[6]];
        const ys = [quad[1], quad[3], quad[5], quad[7]];
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      }

      function rectDistanceSq(point, rect) {
        const dx = point[0] < rect[0] ? rect[0] - point[0] : point[0] > rect[2] ? point[0] - rect[2] : 0;
        const dy = point[1] < rect[1] ? rect[1] - point[1] : point[1] > rect[3] ? point[1] - rect[3] : 0;
        return dx * dx + dy * dy;
      }

      function quantile(values, q) {
        if (!values.length) return 0;
        const sorted = values.slice().sort((a, b) => a - b);
        const pos = Math.max(0, Math.min(sorted.length - 1, (sorted.length - 1) * q));
        const lo = Math.floor(pos);
        const hi = Math.ceil(pos);
        if (lo === hi) return sorted[lo];
        const t = pos - lo;
        return sorted[lo] * (1 - t) + sorted[hi] * t;
      }

      function detectCharacterOccupancyGutter(lines, pageBounds) {
        const pageWidth = Math.max(1, pageBounds[2] - pageBounds[0]);
        const pageLeft = pageBounds[0];
        const midX = (pageBounds[0] + pageBounds[2]) / 2;
        const binCount = 192;
        const binWidth = pageWidth / binCount;
        const occupancy = new Float64Array(binCount);
        let relevantLines = 0;

        // Measure how many text rows actually contain a glyph at each x position.
        // This is intentionally character-based rather than bbox-based: some PDFs expose
        // an entire left+right newspaper row as ONE StructuredText line, whose bbox spans
        // both columns even though there is a real blank gutter between the characters.
        for (const line of lines) {
          const horizontal = Math.abs(line.direction?.[0] || 1) >= 0.72;
          const visible = line.chars.filter((ch) => !/\s/u.test(ch.c || ''));
          if (!horizontal || visible.length < 3) continue;
          const seen = new Uint8Array(binCount);
          let covered = 0;
          for (const ch of visible) {
            let x0 = Math.max(pageBounds[0], Math.min(pageBounds[2], ch.bbox[0]));
            let x1 = Math.max(pageBounds[0], Math.min(pageBounds[2], ch.bbox[2]));
            if (!(x1 > x0)) continue;
            let b0 = Math.max(0, Math.min(binCount - 1, Math.floor((x0 - pageLeft) / binWidth)));
            let b1 = Math.max(0, Math.min(binCount - 1, Math.floor((Math.max(x0, x1 - 0.001) - pageLeft) / binWidth)));
            for (let b = b0; b <= b1; b++) {
              if (!seen[b]) { seen[b] = 1; covered++; }
            }
          }
          if (covered < Math.max(3, binCount * 0.05)) continue;
          relevantLines++;
          for (let b = 0; b < binCount; b++) if (seen[b]) occupancy[b] += 1;
        }
        if (relevantLines < 6) return null;

        const rates = Array.from(occupancy, (v) => v / relevantLines);
        // Keep the raw per-bin occupancy for the valley itself. Averaging neighboring
        // bins smears glyph coverage into a genuinely narrow gutter (common in Nature/
        // medical-journal layouts) and was enough to hide 8-12pt column gaps.
        const smooth = rates.slice();
        const lo = Math.max(1, Math.floor(binCount * 0.29));
        const hi = Math.min(binCount - 2, Math.ceil(binCount * 0.71));
        const lowThreshold = 0.13;
        const minGutterPoints = Math.max(3.0, pageWidth * 0.005);
        const minBins = Math.max(1, Math.ceil(minGutterPoints / binWidth));
        const shoulderBins = Math.max(3, Math.round(binCount * 0.035));
        const candidates = [];

        let i = lo;
        while (i <= hi) {
          if (smooth[i] > lowThreshold) { i++; continue; }
          const runStart = i;
          while (i <= hi && smooth[i] <= lowThreshold) i++;
          const runEnd = i - 1;
          if (runEnd - runStart + 1 < minBins) continue;

          const avg = (a, b) => {
            if (b < a) return 0;
            let sum = 0;
            let n = 0;
            for (let k = a; k <= b; k++) { sum += smooth[k]; n++; }
            return n ? sum / n : 0;
          };
          const valley = avg(runStart, runEnd);
          const leftShoulder = avg(Math.max(0, runStart - shoulderBins), runStart - 1);
          const rightShoulder = avg(runEnd + 1, Math.min(binCount - 1, runEnd + shoulderBins));
          // A genuine two-column gutter is persistently emptier than the prose on BOTH
          // sides.  This rejects ordinary word spaces in a single-column paragraph.
          if (leftShoulder < valley + 0.09 || rightShoulder < valley + 0.09) continue;
          if (Math.max(leftShoulder, rightShoulder) < 0.23) continue;

          const x0 = pageLeft + runStart * binWidth;
          const x1 = pageLeft + (runEnd + 1) * binWidth;
          const center = (x0 + x1) / 2;
          if (Math.abs(center - midX) > pageWidth * 0.16) continue;
          const width = x1 - x0;
          const score = valley * 4 + Math.abs(center - midX) / pageWidth * 1.8 - Math.min(0.08, width / pageWidth);
          candidates.push({ gutter: [x0, x1], gutterMid: center, pageWidth, score, source: 'char-occupancy' });
        }
        if (!candidates.length) return null;
        candidates.sort((a, b) => a.score - b.score);
        return candidates[0];
      }

      function detectProvisionalColumnSplit(lines, pageBounds) {
        // First try the robust character-occupancy detector.  It works even when MuPDF
        // reports both newspaper columns as one raw StructuredText line.
        const charSplit = detectCharacterOccupancyGutter(lines, pageBounds);
        if (charSplit) return charSplit;

        // Fallback for documents whose character geometry is sparse but whose raw line
        // boxes are already separated by column.
        const pageWidth = Math.max(1, pageBounds[2] - pageBounds[0]);
        const midX = (pageBounds[0] + pageBounds[2]) / 2;
        const candidates = lines.filter((line) => {
          const width = line.bbox[2] - line.bbox[0];
          const height = line.bbox[3] - line.bbox[1];
          const horizontal = Math.abs(line.direction?.[0] || 1) >= 0.75;
          return horizontal && line.chars.length >= 4 && width > pageWidth * 0.10 && width < pageWidth * 0.64 && height < 72;
        });
        if (candidates.length < 6) return null;

        const left = candidates.filter((line) => ((line.bbox[0] + line.bbox[2]) / 2) < midX);
        const right = candidates.filter((line) => ((line.bbox[0] + line.bbox[2]) / 2) >= midX);
        if (left.length < 3 || right.length < 3) return null;

        const leftCenters = left.map((line) => (line.bbox[0] + line.bbox[2]) / 2);
        const rightCenters = right.map((line) => (line.bbox[0] + line.bbox[2]) / 2);
        const centerSeparation = median(rightCenters) - median(leftCenters);
        if (centerSeparation < pageWidth * 0.26) return null;

        const leftRight = quantile(left.map((line) => line.bbox[2]), 0.62);
        const rightLeft = quantile(right.map((line) => line.bbox[0]), 0.38);
        const gutterWidth = rightLeft - leftRight;
        const gutterCenter = (leftRight + rightLeft) / 2;
        if (gutterWidth < Math.max(2.5, pageWidth * 0.004)) return null;
        if (Math.abs(gutterCenter - midX) > pageWidth * 0.13) return null;
        return { gutter: [leftRight, rightLeft], gutterMid: gutterCenter, pageWidth, source: 'line-bbox' };
      }

      function splitRawLinesAtGutter(lines, provisional, pageBounds) {
        if (!provisional) return lines;
        const [g0, g1] = provisional.gutter;
        const mid = provisional.gutterMid;
        const gutterWidth = Math.max(0.01, g1 - g0);
        const pageWidth = Math.max(1, pageBounds[2] - pageBounds[0]);
        const out = [];

        const makeFragment = (line, chars, columnHint) => {
          if (!chars.length) return null;
          const xs0 = chars.map((ch) => ch.bbox[0]);
          const ys0 = chars.map((ch) => ch.bbox[1]);
          const xs1 = chars.map((ch) => ch.bbox[2]);
          const ys1 = chars.map((ch) => ch.bbox[3]);
          return {
            ...line,
            bbox: [Math.min(...xs0), Math.min(...ys0), Math.max(...xs1), Math.max(...ys1)],
            chars: chars.slice(),
            text: chars.map((ch) => ch.c).join(''),
            column: null,
            provisionalColumn: columnHint
          };
        };

        for (const line of lines) {
          const visible = line.chars.filter((ch) => !/\s/u.test(ch.c || ''));
          if (visible.length < 4) { out.push(line); continue; }
          const leftVisible = visible.filter((ch) => ((ch.bbox[0] + ch.bbox[2]) / 2) < mid);
          const rightVisible = visible.filter((ch) => ((ch.bbox[0] + ch.bbox[2]) / 2) >= mid);
          if (leftVisible.length < 2 || rightVisible.length < 2) { out.push(line); continue; }

          const leftMax = Math.max(...leftVisible.map((ch) => ch.bbox[2]));
          const rightMin = Math.min(...rightVisible.map((ch) => ch.bbox[0]));
          const actualGap = rightMin - leftMax;
          const crossesGutter = leftMax <= g1 + Math.max(1.2, gutterWidth * 0.22) &&
                                rightMin >= g0 - Math.max(1.2, gutterWidth * 0.22);
          const substantialSides = leftVisible.length >= Math.max(2, visible.length * 0.12) &&
                                   rightVisible.length >= Math.max(2, visible.length * 0.12);
          // Do not split a normal full-width heading merely because it has a word space
          // near page center.  A real two-column row has a persistent, sizable gap.
          if (!crossesGutter || !substantialSides || actualGap < Math.max(2.2, gutterWidth * 0.42, pageWidth * 0.0035)) {
            out.push(line);
            continue;
          }

          const leftChars = [];
          const rightChars = [];
          for (const ch of line.chars) {
            const center = (ch.bbox[0] + ch.bbox[2]) / 2;
            if (center < mid) leftChars.push(ch); else rightChars.push(ch);
          }
          const leftFrag = makeFragment(line, leftChars, 0);
          const rightFrag = makeFragment(line, rightChars, 1);
          if (leftFrag && rightFrag) {
            out.push(leftFrag, rightFrag);
          } else {
            out.push(line);
          }
        }
        return out;
      }

      function fallbackColumnInfo(lines, pageBounds, provisional) {
        if (!provisional) return null;
        const pageWidth = Math.max(1, pageBounds[2] - pageBounds[0]);
        const [g0, g1] = provisional.gutter;
        const gutterMid = (g0 + g1) / 2;
        const leftLines = [];
        const rightLines = [];
        for (const line of lines) {
          const width = line.bbox[2] - line.bbox[0];
          const center = (line.bbox[0] + line.bbox[2]) / 2;
          const trulySpanning = width > pageWidth * 0.76 || (line.bbox[0] < g0 - 2 && line.bbox[2] > g1 + 2 && width > pageWidth * 0.68);
          if (trulySpanning) {
            line.column = -1;
          } else if (center < gutterMid) {
            line.column = 0;
            leftLines.push(line);
          } else {
            line.column = 1;
            rightLines.push(line);
          }
        }
        if (leftLines.length < 2 || rightLines.length < 2) return null;
        const leftBounds = [
          quantile(leftLines.map((line) => line.bbox[0]), 0.10),
          g0
        ];
        const rightBounds = [
          g1,
          quantile(rightLines.map((line) => line.bbox[2]), 0.90)
        ];
        return { columns: [leftBounds, rightBounds], gutter: [g0, g1], gutterMid, pageWidth, provisional: true };
      }

      function detectColumns(lines, pageBounds) {
        const pageWidth = Math.max(1, pageBounds[2] - pageBounds[0]);
        const midX = (pageBounds[0] + pageBounds[2]) / 2;
        const candidates = lines.filter((line) => {
          const width = line.bbox[2] - line.bbox[0];
          const height = line.bbox[3] - line.bbox[1];
          const horizontal = Math.abs(line.direction?.[0] || 1) >= 0.75;
          return horizontal && line.chars.length >= 3 && width > pageWidth * 0.08 && width < pageWidth * 0.68 && height < 60;
        });
        if (candidates.length < 8) return null;

        const left = candidates.filter((line) => ((line.bbox[0] + line.bbox[2]) / 2) < midX);
        const right = candidates.filter((line) => ((line.bbox[0] + line.bbox[2]) / 2) >= midX);
        if (left.length < 4 || right.length < 4) return null;

        const leftRight = quantile(left.map((line) => line.bbox[2]), 0.55);
        const rightLeft = quantile(right.map((line) => line.bbox[0]), 0.45);
        const gutterWidth = rightLeft - leftRight;
        if (gutterWidth < Math.max(8, pageWidth * 0.012)) return null;

        const leftBounds = [
          quantile(left.map((line) => line.bbox[0]), 0.12),
          leftRight
        ];
        const rightBounds = [
          rightLeft,
          quantile(right.map((line) => line.bbox[2]), 0.88)
        ];
        if (leftBounds[1] >= rightBounds[0]) return null;

        const gutter = [leftBounds[1], rightBounds[0]];
        const gutterMid = (gutter[0] + gutter[1]) / 2;
        const columns = [leftBounds, rightBounds];
        for (const line of lines) {
          const width = line.bbox[2] - line.bbox[0];
          const center = (line.bbox[0] + line.bbox[2]) / 2;
          if (width > pageWidth * 0.76 || (line.bbox[0] < gutter[0] && line.bbox[2] > gutter[1])) {
            line.column = -1;
          } else {
            line.column = center < gutterMid ? 0 : 1;
          }
        }
        return { columns, gutter, gutterMid, pageWidth };
      }

      function buildTextLayout(docId, pageIndex) {
        const key = docId + ':' + pageIndex;
        let cached = textLayoutCache.get(key);
        if (cached) {
          textLayoutCache.delete(key);
          textLayoutCache.set(key, cached);
          return cached;
        }

        const doc = documents.get(docId);
        if (!doc) throw new Error('Document is not open');
        const page = doc.loadPage(pageIndex);
        let pageBounds;
        try { pageBounds = page.getBounds(); } finally { page.destroy(); }
        const stext = getStructuredText(docId, pageIndex);
        const lines = [];
        let currentLine = null;
        let blockIndex = -1;
        stext.walk({
          beginTextBlock() { blockIndex++; },
          beginLine(bbox, wmode, direction) {
            currentLine = { bbox: bbox.slice(), wmode, direction: direction?.slice?.() || direction, blockIndex, chars: [], column: null };
          },
          onChar(c, origin, font, size, quad) {
            if (!currentLine) return;
            currentLine.chars.push({ c, origin: origin?.slice?.() || origin, size: Number(size) || 0, quad: quad.slice(), bbox: quadBounds(quad) });
          },
          endLine() {
            if (!currentLine) return;
            currentLine.text = currentLine.chars.map((ch) => ch.c).join('');
            if (currentLine.chars.length && currentLine.text.trim()) lines.push(currentLine);
            currentLine = null;
          }
        });

        const provisionalColumnSplit = detectProvisionalColumnSplit(lines, pageBounds);
        // MuPDF can occasionally expose a whole newspaper row (left + right column) as
        // one StructuredText line. Split that raw line at the persistent character gutter
        // BEFORE formula-fragment merging, otherwise no later column lock can recover it.
        const gutterSplitLines = splitRawLinesAtGutter(lines, provisionalColumnSplit, pageBounds);
        const visualLines = mergeVisualLineFragments(gutterSplitLines, pageBounds, provisionalColumnSplit);
        lines.splice(0, lines.length, ...visualLines);
        lines.sort((a, b) => {
          const dy = a.bbox[1] - b.bbox[1];
          if (Math.abs(dy) > 2) return dy;
          return a.bbox[0] - b.bbox[0];
        });
        for (let i = 0; i < lines.length; i++) lines[i].visualIndex = i;
        const columnInfo = detectColumns(lines, pageBounds) || fallbackColumnInfo(lines, pageBounds, provisionalColumnSplit);
        finalizeSelectionBands(lines, !!columnInfo);
        cached = { pageBounds, lines, columnInfo };
        textLayoutCache.set(key, cached);
        while (textLayoutCache.size > 8) {
          const oldestKey = textLayoutCache.keys().next().value;
          if (!oldestKey || oldestKey === key) break;
          textLayoutCache.delete(oldestKey);
        }
        return cached;
      }

      function lineGeometryMetrics(line) {
        const visible = line.chars.filter((ch) => !/\s/u.test(ch.c || ''));
        if (!visible.length) {
          const center = (line.bbox[1] + line.bbox[3]) / 2;
          return { baseline: center, fontSize: Math.max(1, line.bbox[3] - line.bbox[1]), bodyHeight: Math.max(1, line.bbox[3] - line.bbox[1]) };
        }
        const sizes = visible.map((ch) => ch.size).filter((v) => Number.isFinite(v) && v > 0);
        const fontSize = sizes.length ? median(sizes) : median(visible.map((ch) => Math.max(0.01, ch.bbox[3] - ch.bbox[1])));
        const primary = visible.filter((ch) => {
          const size = Number(ch.size) || fontSize;
          return size >= fontSize * 0.78 && size <= fontSize * 1.28;
        });
        const core = primary.length >= Math.max(2, Math.floor(visible.length * 0.25)) ? primary : visible;
        const baselineCandidates = core
          .map((ch) => Number(ch.origin?.[1]))
          .filter(Number.isFinite);
        const baseline = baselineCandidates.length
          ? median(baselineCandidates)
          : median(core.map((ch) => (ch.bbox[1] + ch.bbox[3]) / 2));
        const bodyHeight = Math.max(0.01, quantile(core.map((ch) => Math.max(0.01, ch.bbox[3] - ch.bbox[1])), 0.58));
        return { baseline, fontSize: Math.max(0.01, fontSize), bodyHeight };
      }

      function mergeVisualLineFragments(lines, pageBounds, provisionalColumnSplit = null) {
        if (lines.length < 2) return lines;
        const pageWidth = Math.max(1, pageBounds[2] - pageBounds[0]);
        const provisionalGutter = provisionalColumnSplit?.gutter || null;
        const provisionalMid = provisionalColumnSplit?.gutterMid ?? ((pageBounds[0] + pageBounds[2]) / 2);
        const items = lines.slice().map((line) => ({ ...line, chars: line.chars.slice(), _metrics: lineGeometryMetrics(line) }));
        items.sort((a, b) => {
          const db = a._metrics.baseline - b._metrics.baseline;
          if (Math.abs(db) > 0.75) return db;
          return a.bbox[0] - b.bbox[0];
        });
        const merged = [];

        const horizontalGap = (a, b) => Math.max(0, Math.max(a.bbox[0], b.bbox[0]) - Math.min(a.bbox[2], b.bbox[2]));
        const verticalOverlapRatio = (a, b) => {
          const ah = Math.max(0.01, a.bbox[3] - a.bbox[1]);
          const bh = Math.max(0.01, b.bbox[3] - b.bbox[1]);
          const overlap = Math.max(0, Math.min(a.bbox[3], b.bbox[3]) - Math.max(a.bbox[1], b.bbox[1]));
          return overlap / Math.min(ah, bh);
        };

        for (const item of items) {
          let best = null;
          let bestScore = Infinity;
          for (const candidate of merged) {
            const cm = candidate._metrics || lineGeometryMetrics(candidate);
            const im = item._metrics;
            const gap = horizontalGap(candidate, item);
            const unionWidth = Math.max(candidate.bbox[2], item.bbox[2]) - Math.min(candidate.bbox[0], item.bbox[0]);
            const baseSize = Math.max(1, Math.min(cm.fontSize, im.fontSize));
            const baselineDelta = Math.abs(cm.baseline - im.baseline);
            const overlapRatio = verticalOverlapRatio(candidate, item);
            const adjacent = gap <= Math.max(5, baseSize * 1.15);
            const sameBlock = candidate.blockIndex === item.blockIndex;

            // Baseline is the strongest signal for prose interrupted by inline math.
            // A formula fragment may use a separate text block and a different bbox,
            // while its normal-sized glyphs still sit on the prose baseline.
            const baselineCompatible = baselineDelta <= Math.max(1.6, baseSize * 0.30);
            const geometryCompatible = overlapRatio >= 0.52 && baselineDelta <= Math.max(3.2, baseSize * 0.55);
            const candidateVisible = candidate.chars.filter((ch) => !/\s/u.test(ch.c || '')).length;
            const itemVisible = item.chars.filter((ch) => !/\s/u.test(ch.c || '')).length;
            const smallFormulaFragment = Math.min(candidateVisible, itemVisible) <= 8;
            const hostSize = Math.max(cm.fontSize, im.fontSize);
            const fragmentCompatible = smallFormulaFragment && adjacent && overlapRatio >= 0.18 && baselineDelta <= Math.max(6, hostSize * 0.82);
            if (!(baselineCompatible || geometryCompatible || fragmentCompatible)) continue;
            if (!adjacent && !sameBlock) continue;
            if (!adjacent && gap > Math.max(11, baseSize * 1.55)) continue;

            // Do not fuse opposite newspaper columns. Real inline fragments are close;
            // two columns create a very wide union even when they share a baseline.
            if (unionWidth > pageWidth * 0.70 && gap > Math.max(4, baseSize * 0.55)) continue;

            // A narrow two-column gutter can be smaller than the normal inline-fragment
            // merge threshold.  Once the raw layout shows a credible center gutter, never
            // merge two substantial fragments from opposite sides across that gutter.
            // This prevents one visual line from containing both newspaper columns.
            if (provisionalGutter) {
              const candidateCenter = (candidate.bbox[0] + candidate.bbox[2]) / 2;
              const itemCenter = (item.bbox[0] + item.bbox[2]) / 2;
              const oppositeSides = (candidateCenter < provisionalMid && itemCenter > provisionalMid) ||
                                    (itemCenter < provisionalMid && candidateCenter > provisionalMid);
              const candidateWidth = candidate.bbox[2] - candidate.bbox[0];
              const itemWidth = item.bbox[2] - item.bbox[0];
              const bothSubstantial = candidateWidth > pageWidth * 0.075 && itemWidth > pageWidth * 0.075;
              const centralGap = gap > Math.max(2.4, baseSize * 0.28);
              if (oppositeSides && bothSubstantial && centralGap) continue;
            }

            const score = gap + baselineDelta * 1.8 + (sameBlock ? 0 : 1.5);
            if (score < bestScore) {
              best = candidate;
              bestScore = score;
            }
          }

          if (!best) {
            merged.push(item);
            continue;
          }
          best.bbox = [
            Math.min(best.bbox[0], item.bbox[0]),
            Math.min(best.bbox[1], item.bbox[1]),
            Math.max(best.bbox[2], item.bbox[2]),
            Math.max(best.bbox[3], item.bbox[3])
          ];
          best.chars.push(...item.chars);
          best.chars.sort((a, b) => {
            const dx = a.bbox[0] - b.bbox[0];
            if (Math.abs(dx) > 0.12) return dx;
            const ao = Number(a.origin?.[1]);
            const bo = Number(b.origin?.[1]);
            if (Number.isFinite(ao) && Number.isFinite(bo) && Math.abs(ao - bo) > 0.2) return ao - bo;
            return a.bbox[1] - b.bbox[1];
          });
          best.text = best.chars.map((ch) => ch.c).join('');
          best._metrics = lineGeometryMetrics(best);
        }

        for (const line of merged) delete line._metrics;
        return merged;
      }

      function findNearestHit(layout, point, preferredColumn = null) {
        let bestLine = null;
        let bestLineDistance = Infinity;
        for (const line of layout.lines) {
          if (preferredColumn !== null && line.column !== preferredColumn) continue;
          const d = rectDistanceSq(point, line.bbox);
          if (d < bestLineDistance) {
            bestLineDistance = d;
            bestLine = line;
          }
        }
        if (!bestLine && preferredColumn !== null) return findNearestHit(layout, point, null);
        if (!bestLine) return null;

        let bestCharIndex = 0;
        let bestCharDistance = Infinity;
        for (let i = 0; i < bestLine.chars.length; i++) {
          const d = rectDistanceSq(point, bestLine.chars[i].bbox);
          if (d < bestCharDistance) {
            bestCharDistance = d;
            bestCharIndex = i;
          }
        }
        return { line: bestLine, charIndex: bestCharIndex };
      }

      function isTokenChar(c) {
        return !!c && /[\p{L}\p{N}\p{M}_]/u.test(c);
      }

      function normalizeCharIndex(line, index) {
        index = Math.max(0, Math.min(line.chars.length - 1, index));
        if (!/\s/u.test(line.chars[index]?.c || '')) return index;
        for (let radius = 1; radius < Math.min(12, line.chars.length); radius++) {
          const right = index + radius;
          if (right < line.chars.length && !/\s/u.test(line.chars[right].c)) return right;
          const left = index - radius;
          if (left >= 0 && !/\s/u.test(line.chars[left].c)) return left;
        }
        return index;
      }

      function expandWordStart(line, index) {
        index = normalizeCharIndex(line, index);
        const c = line.chars[index]?.c || '';
        if (!isTokenChar(c)) return index;
        while (index > 0) {
          const prev = line.chars[index - 1]?.c || '';
          const cur = line.chars[index]?.c || '';
          if (isTokenChar(prev)) { index--; continue; }
          if ((prev === '-' || prev === '‐' || prev === '‑') && index > 1 && isTokenChar(line.chars[index - 2]?.c || '') && isTokenChar(cur)) {
            index -= 2;
            continue;
          }
          break;
        }
        return index;
      }

      function expandWordEnd(line, index) {
        index = normalizeCharIndex(line, index);
        const c = line.chars[index]?.c || '';
        if (!isTokenChar(c)) return index;
        while (index + 1 < line.chars.length) {
          const next = line.chars[index + 1]?.c || '';
          const cur = line.chars[index]?.c || '';
          if (isTokenChar(next)) { index++; continue; }
          if ((next === '-' || next === '‐' || next === '‑') && index + 2 < line.chars.length && isTokenChar(line.chars[index + 2]?.c || '') && isTokenChar(cur)) {
            index += 2;
            continue;
          }
          break;
        }
        return index;
      }

      function orderedLinesForSelection(layout, columnMode, startColumn) {
        const byY = (a, b) => {
          const dy = a.bbox[1] - b.bbox[1];
          if (Math.abs(dy) > 2) return dy;
          return a.bbox[0] - b.bbox[0];
        };
        if (columnMode === 'locked' && startColumn !== null && startColumn >= 0) {
          return layout.lines.filter((line) => line.column === startColumn).slice().sort(byY);
        }
        if (columnMode === 'cross' && layout.columnInfo) {
          const left = layout.lines.filter((line) => line.column === 0).slice().sort(byY);
          const right = layout.lines.filter((line) => line.column === 1).slice().sort(byY);
          return left.concat(right);
        }
        return layout.lines.slice().sort(byY);
      }

      function compareHits(a, b, orderMap) {
        const ai = orderMap.get(a.line);
        const bi = orderMap.get(b.line);
        if (ai !== bi) return ai - bi;
        return a.charIndex - b.charIndex;
      }

      function median(values) {
        return quantile(values.filter(Number.isFinite), 0.5);
      }

      function naturalSelectionBand(line) {
        const chars = line.chars.filter((ch) => !/\s/u.test(ch.c || ''));
        if (!chars.length) {
          const center = (line.bbox[1] + line.bbox[3]) / 2;
          return { top: line.bbox[1], bottom: line.bbox[3], center, baseline: center };
        }

        const metrics = lineGeometryMetrics(line);
        const baseline = metrics.baseline;
        const medSize = metrics.fontSize;
        let core = chars.filter((ch) => {
          const size = Number(ch.size) || medSize;
          const originY = Number(ch.origin?.[1]);
          const baselineOk = !Number.isFinite(originY) || Math.abs(originY - baseline) <= Math.max(1.5, medSize * 0.24);
          return size >= medSize * 0.78 && size <= medSize * 1.28 && baselineOk;
        });
        if (core.length < Math.max(2, Math.floor(chars.length * 0.22))) {
          core = chars.filter((ch) => {
            const size = Number(ch.size) || medSize;
            return size >= medSize * 0.72 && size <= medSize * 1.38;
          });
        }
        if (!core.length) core = chars;

        // Use offsets from the dominant text baseline, not glyph bbox centers. This
        // makes superscripts, subscripts, sums, radicals and alternate math fonts
        // irrelevant to the height of the visual selection band.
        const ascents = core
          .map((ch) => baseline - ch.bbox[1])
          .filter((v) => Number.isFinite(v) && v > 0);
        const descents = core
          .map((ch) => ch.bbox[3] - baseline)
          .filter((v) => Number.isFinite(v) && v >= 0);
        let ascent = ascents.length ? quantile(ascents, 0.62) : metrics.bodyHeight * 0.76;
        let descent = descents.length ? quantile(descents, 0.62) : metrics.bodyHeight * 0.24;

        // Keep the row visually generous enough for normal capitals/descenders, but
        // bounded by the body font size rather than rare formula glyphs.
        ascent = Math.min(medSize * 0.93, Math.max(medSize * 0.62, ascent * 1.04));
        descent = Math.min(medSize * 0.38, Math.max(medSize * 0.15, descent * 1.10));
        const top = baseline - ascent;
        const bottom = baseline + descent;
        return { top, bottom, center: (top + bottom) / 2, baseline };
      }

      function finalizeSelectionBands(lines, hasColumns) {
        for (const line of lines) line.selectionBand = naturalSelectionBand(line);
        const groups = new Map();
        for (const line of lines) {
          const key = hasColumns ? (line.column >= 0 ? 'c' + line.column : 'span') : 'single';
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(line);
        }

        // A polished PDF selection looks like one continuous ribbon across adjacent
        // prose rows, not a stack of independent glyph-height rectangles.  We therefore
        // let neighboring normal text rows share their baseline midpoint as a seam.
        // Formula glyph geometry never controls these vertical edges.
        const SEAM_OVERLAP = 0.10; // PDF points; hides antialias hairlines at any zoom.
        for (const group of groups.values()) {
          group.sort((a, b) => (a.selectionBand.baseline ?? a.selectionBand.center) - (b.selectionBand.baseline ?? b.selectionBand.center));

          const seams = new Array(Math.max(0, group.length - 1)).fill(null);
          for (let i = 0; i + 1 < group.length; i++) {
            const a = group[i];
            const b = group[i + 1];
            const ab = a.selectionBand;
            const bb = b.selectionBand;
            // Baselines are still the most reliable signal for deciding whether two
            // rows belong to the same prose flow.  They are *not* the visual center of
            // a glyph row, though: a Latin baseline sits close to the bottom of the
            // letters.  Using baseline midpoints as painted seams therefore shifts the
            // whole selection ribbon downward.
            const baseA = ab.baseline ?? ab.center;
            const baseB = bb.baseline ?? bb.center;
            const baselineGap = baseB - baseA;
            if (!(baselineGap > 0.5)) continue;

            const heightA = Math.max(0.01, ab.bottom - ab.top);
            const heightB = Math.max(0.01, bb.bottom - bb.top);
            const body = Math.max(heightA, heightB);

            // Normal academic prose usually has baseline spacing around 1.1-1.4x its
            // painted text band.  Do not bridge large paragraph/title/display-math gaps.
            const maxJoinGap = Math.max(body * 1.72, 5.5);
            if (baselineGap > maxJoinGap) continue;

            // Guard against unrelated lines that merely happen to be vertically close.
            // In column mode each group is already column-isolated; for spanning/single
            // text we additionally require some horizontal affinity unless one row is wide.
            const overlapX = Math.max(0, Math.min(a.bbox[2], b.bbox[2]) - Math.max(a.bbox[0], b.bbox[0]));
            const minWidth = Math.max(1, Math.min(a.bbox[2] - a.bbox[0], b.bbox[2] - b.bbox[0]));
            const horizontallyRelated = overlapX / minWidth >= 0.12 || Math.max(a.bbox[2] - a.bbox[0], b.bbox[2] - b.bbox[0]) >= 80;
            if (!horizontallyRelated) continue;

            // Paint the seam halfway between the *visual text-band centers*, not
            // halfway between baselines.  This keeps the highlight optically centered
            // around the glyphs while remaining seamless across adjacent rows.
            const visualCenterA = Number.isFinite(ab.center) ? ab.center : baseA;
            const visualCenterB = Number.isFinite(bb.center) ? bb.center : baseB;
            seams[i] = (visualCenterA + visualCenterB) / 2;
          }

          for (let i = 0; i < group.length; i++) {
            const line = group[i];
            const band = line.selectionBand;
            let top = band.top;
            let bottom = band.bottom;
            const seamAbove = i > 0 ? seams[i - 1] : null;
            const seamBelow = i < seams.length ? seams[i] : null;

            const visualCenter = Number.isFinite(band.center)
              ? band.center
              : (band.baseline ?? ((band.top + band.bottom) / 2));
            if (Number.isFinite(seamAbove)) top = seamAbove - SEAM_OVERLAP;
            if (Number.isFinite(seamBelow)) bottom = seamBelow + SEAM_OVERLAP;

            // At the first/last row of a contiguous prose run, mirror the known half
            // visual-center spacing onto the open side.  Mirroring around the baseline
            // was the source of the visible downward bias in v0.3.5/v0.4.0.
            if (!Number.isFinite(seamAbove) && Number.isFinite(seamBelow)) {
              const half = Math.max(0.45, seamBelow - visualCenter);
              top = visualCenter - half - SEAM_OVERLAP;
            } else if (Number.isFinite(seamAbove) && !Number.isFinite(seamBelow)) {
              const half = Math.max(0.45, visualCenter - seamAbove);
              bottom = visualCenter + half + SEAM_OVERLAP;
            }

            // Isolated rows keep their robust natural band; connected rows become a
            // seamless ribbon while real paragraph/title whitespace remains untouched.
            if (!(bottom > top)) {
              const center = Number.isFinite(band.center) ? band.center : (band.baseline ?? 0);
              top = center - 0.45;
              bottom = center + 0.45;
            }
            line.selectionBand = {
              ...band,
              top,
              bottom,
              center: (top + bottom) / 2,
              seamAbove: Number.isFinite(seamAbove) ? seamAbove : null,
              seamBelow: Number.isFinite(seamBelow) ? seamBelow : null
            };
          }
        }
      }

      function rectQuad(x0, y0, x1, y1) {
        if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) return null;
        return [x0, y0, x1, y0, x0, y1, x1, y1];
      }

      function segmentQuads(chars, line) {
        const visible = chars.filter((ch) => !/\s/u.test(ch.c || '')).slice().sort((a, b) => a.bbox[0] - b.bbox[0]);
        if (!visible.length) return [];
        const band = line.selectionBand || naturalSelectionBand(line);
        const bandHeight = Math.max(0.01, band.bottom - band.top);
        const widths = visible.map((ch) => Math.max(0.01, ch.bbox[2] - ch.bbox[0]));
        const medWidth = Math.max(0.01, median(widths));

        // Render selection as smooth visual-line bands. Formula glyph boxes are used
        // for hit testing/text extraction only; they never create their own vertical
        // highlight patches. Split only at genuinely large horizontal discontinuities.
        const breakGap = Math.max(bandHeight * 1.75, medWidth * 4.5, 12);
        const quads = [];
        let runStart = visible[0].bbox[0];
        let runEnd = visible[0].bbox[2];
        for (let i = 1; i < visible.length; i++) {
          const ch = visible[i];
          const gap = ch.bbox[0] - runEnd;
          if (gap > breakGap) {
            const q = rectQuad(runStart, band.top, runEnd, band.bottom);
            if (q) quads.push(q);
            runStart = ch.bbox[0];
            runEnd = ch.bbox[2];
          } else {
            runEnd = Math.max(runEnd, ch.bbox[2]);
          }
        }
        const q = rectQuad(runStart, band.top, runEnd, band.bottom);
        if (q) quads.push(q);
        return quads;
      }

      function smartSelect(layout, start, end) {
        const hasColumns = !!layout.columnInfo;
        let pointerColumn = null;
        if (hasColumns) {
          const [g0, g1] = layout.columnInfo.gutter;
          if (start[0] < g0) pointerColumn = 0;
          else if (start[0] > g1) pointerColumn = 1;
        }
        // Prefer the column implied by the pointer itself. This is an extra guard for
        // PDFs that contain a rare spanning/raw line at the exact selection start.
        let startHit = findNearestHit(layout, start, pointerColumn);
        if (!startHit) startHit = findNearestHit(layout, start, null);
        if (!startHit) return { text: '', quads: [], mode: 'none', startColumn: null, detectedColumns: false };
        const startColumn = hasColumns
          ? (startHit.line.column >= 0 ? startHit.line.column : pointerColumn)
          : null;
        let mode = 'single';
        let preferredColumn = null;

        if (startColumn !== null && layout.columnInfo) {
          const otherColumn = startColumn === 0 ? 1 : 0;
          const other = layout.columnInfo.columns[otherColumn];
          const otherWidth = Math.max(1, other[1] - other[0]);
          const deepInset = Math.min(24, Math.max(10, otherWidth * 0.14));
          const deepInOther = otherColumn === 1
            ? end[0] > other[0] + deepInset
            : end[0] < other[1] - deepInset;
          const movedAcross = Math.abs(end[0] - start[0]) > layout.columnInfo.pageWidth * 0.24;
          if (deepInOther && movedAcross) {
            mode = 'cross';
          } else {
            mode = 'locked';
            preferredColumn = startColumn;
          }
        }

        const endHit = findNearestHit(layout, end, preferredColumn);
        if (!endHit) return { text: '', quads: [], mode, startColumn, detectedColumns: hasColumns };
        const orderedLines = orderedLinesForSelection(layout, mode, startColumn);
        const orderMap = new Map(orderedLines.map((line, i) => [line, i]));
        if (!orderMap.has(startHit.line) || !orderMap.has(endHit.line)) {
          return { text: '', quads: [], mode, startColumn, detectedColumns: hasColumns };
        }

        const cmp = compareHits(startHit, endHit, orderMap);
        const low = cmp <= 0 ? { ...startHit } : { ...endHit };
        const high = cmp <= 0 ? { ...endHit } : { ...startHit };
        low.charIndex = expandWordStart(low.line, low.charIndex);
        high.charIndex = expandWordEnd(high.line, high.charIndex);

        const lowLine = orderMap.get(low.line);
        const highLine = orderMap.get(high.line);
        const textParts = [];
        const quads = [];
        for (let lineOrder = lowLine; lineOrder <= highLine; lineOrder++) {
          const line = orderedLines[lineOrder];
          let from = 0;
          let to = line.chars.length - 1;
          if (lineOrder === lowLine) from = low.charIndex;
          if (lineOrder === highLine) to = high.charIndex;
          if (to < from) continue;
          const chars = line.chars.slice(from, to + 1);
          const text = chars.map((ch) => ch.c).join('');
          if (text) textParts.push(text.replace(/\s+$/u, ''));
          const lineQuads = segmentQuads(chars, line);
          if (lineQuads.length) quads.push(...lineQuads);
        }
        const text = textParts.filter((part) => part.length).join('\n');
        return {
          text,
          quads,
          mode,
          startColumn,
          detectedColumns: hasColumns,
          gutter: layout.columnInfo?.gutter || null
        };
      }

      methods.selectText = function(docId, pageIndex, start, end) {
        const layout = buildTextLayout(docId, pageIndex);
        const result = smartSelect(layout, start, end);
        // Fallback to MuPDF native selection on pages where geometry extraction is sparse.
        if (!result.text || !result.quads.length) {
          if (layout.columnInfo) return result;
          const stext = getStructuredText(docId, pageIndex);
          const text = stext.copy(start, end) || '';
          const quads = text ? stext.highlight(start, end, 1000) : [];
          return { text, quads, mode: 'native', startColumn: null, detectedColumns: !!layout.columnInfo };
        }
        return result;
      };

      methods.getOutline = function(docId) {
        const doc = documents.get(docId);
        if (!doc) throw new Error('Document is closed');
        return doc.loadOutline() || [];
      };

      methods.searchPage = function(docId, pageIndex, needle, maxHits) {
        const doc = documents.get(docId);
        if (!doc) throw new Error('Document is closed');
        const query = String(needle || '').trim();
        if (!query) return [];
        const stext = getStructuredText(docId, pageIndex);
        return stext.search(query, Math.max(1, Math.min(1000, Number(maxHits) || 240))) || [];
      };

      methods.getPageSizes = function(docId) {
        const doc = documents.get(docId);
        if (!doc) throw new Error('Document is not open');
        const count = doc.countPages();
        const sizes = new Array(count);
        for (let i = 0; i < count; i++) {
          const page = doc.loadPage(i);
          try {
            const b = page.getBounds();
            sizes[i] = { x: b[0], y: b[1], width: b[2] - b[0], height: b[3] - b[1] };
          } finally {
            page.destroy();
          }
        }
        return sizes;
      };

      methods.renderPage = function(docId, pageIndex, requestedPixelScale, maxPixels) {
        const doc = documents.get(docId);
        if (!doc) throw new Error('Document is not open');
        const page = doc.loadPage(pageIndex);
        try {
          const bounds = page.getBounds();
          const pointWidth = Math.max(1, bounds[2] - bounds[0]);
          const pointHeight = Math.max(1, bounds[3] - bounds[1]);
          const maxScale = Math.sqrt(maxPixels / (pointWidth * pointHeight));
          const pixelScale = Math.max(0.1, Math.min(requestedPixelScale, maxScale));
          const matrix = mupdf.Matrix.scale(pixelScale, pixelScale);
          const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, true, true);
          try {
            const pixels = pixmap.getPixels().slice();
            return {
              value: {
                width: pixmap.getWidth(),
                height: pixmap.getHeight(),
                pixels,
                pixelScale
              },
              transfer: [pixels.buffer]
            };
          } finally {
            pixmap.destroy();
          }
        } finally {
          page.destroy();
        }
      };


      // Render a PDF-space rectangle directly with MuPDF instead of cropping the
      // current screen canvas. This keeps Region Clips sharp regardless of reader zoom
      // and avoids a second generation of interpolation from an already downscaled page.
      methods.renderRegion = function(docId, pageIndex, rectPdf, options) {
        const doc = documents.get(docId);
        if (!doc) throw new Error('Document is not open');
        if (!Array.isArray(rectPdf) || rectPdf.length < 4) throw new Error('Invalid region rectangle');
        const page = doc.loadPage(pageIndex);
        try {
          const pageBounds = page.getBounds();
          const x0 = Math.max(pageBounds[0], Math.min(Number(rectPdf[0]), Number(rectPdf[2])));
          const y0 = Math.max(pageBounds[1], Math.min(Number(rectPdf[1]), Number(rectPdf[3])));
          const x1 = Math.min(pageBounds[2], Math.max(Number(rectPdf[0]), Number(rectPdf[2])));
          const y1 = Math.min(pageBounds[3], Math.max(Number(rectPdf[1]), Number(rectPdf[3])));
          const pointWidth = Math.max(0.5, x1 - x0);
          const pointHeight = Math.max(0.5, y1 - y0);
          if (!(x1 > x0 && y1 > y0)) throw new Error('Region is outside page bounds');

          const maxWidth = Math.max(320, Math.min(2600, Number(options?.maxWidth) || 1800));
          const maxHeight = Math.max(240, Math.min(2200, Number(options?.maxHeight) || 1500));
          const maxPixels = Math.max(300000, Math.min(8000000, Number(options?.maxPixels) || 3200000));
          const maxScale = Math.max(1, Math.min(24, Number(options?.maxScale) || 5));
          const fitScale = Math.min(maxWidth / pointWidth, maxHeight / pointHeight);
          const pixelCapScale = Math.sqrt(maxPixels / (pointWidth * pointHeight));
          // 1.75x gives a useful floor for unusually large clips; normal figures/tables
          // usually land between 3x and 5x (roughly 216–360 dpi for PDF points).
          const pixelScale = Math.max(1, Math.min(maxScale, pixelCapScale, Math.max(1.75, fitScale)));
          const matrix = mupdf.Matrix.scale(pixelScale, pixelScale);
          const deviceBounds = [
            Math.floor(x0 * pixelScale),
            Math.floor(y0 * pixelScale),
            Math.ceil(x1 * pixelScale),
            Math.ceil(y1 * pixelScale)
          ];
          const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, deviceBounds, true);
          let device = null;
          try {
            // clear(255) gives an opaque white backing for paper-like regions.
            pixmap.clear(255);
            device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap);
            page.run(device, matrix);
            device.close();
            const pixels = pixmap.getPixels().slice();
            return {
              value: {
                width: pixmap.getWidth(),
                height: pixmap.getHeight(),
                pixels,
                pixelScale,
                rect: [x0, y0, x1, y1]
              },
              transfer: [pixels.buffer]
            };
          } finally {
            try { device?.destroy?.(); } catch (_) {}
            pixmap.destroy();
          }
        } finally {
          page.destroy();
        }
      };

      self.onmessage = async (event) => {
        const [kind, id, payload] = event.data || [];
        if (kind === 'BOOT') {
          try {
            await bootRuntime(payload);
            self.postMessage(['READY', 0, { version: payload.version, local: true }]);
          } catch (error) {
            self.postMessage(['BOOT_ERROR', 0, serializeError(error)]);
          }
          return;
        }
        if (kind !== 'CALL') return;
        try {
          if (!mupdf) throw new Error('MuPDF runtime is not ready');
          const fn = methods[payload.method];
          if (!fn) throw new Error('Unknown worker method: ' + payload.method);
          const result = await fn(...(payload.args || []));
          if (result && result.transfer) {
            self.postMessage(['RESULT', id, result.value], result.transfer);
          } else {
            self.postMessage(['RESULT', id, result]);
          }
        } catch (error) {
          self.postMessage(['ERROR', id, serializeError(error)]);
        }
      };
    `;

    const blob = new Blob([workerSource], { type: 'text/javascript' });
    this.workerUrl = URL.createObjectURL(blob);
    this.worker = new Worker(this.workerUrl, { type: 'module', name: 'obsidian-mupdf-reader' });
    this.worker.addEventListener('message', (event) => this.onMessage(event));
    this.worker.addEventListener('error', (event) => {
      const error = new Error(event.message || 'MuPDF worker failed');
      if (!this.ready) this.rejectReady(error);
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear();
    });

    const wasmBinary = runtimeAssets.wasmBinary.slice(0);
    this.worker.postMessage(['BOOT', 0, {
      moduleSource: runtimeAssets.moduleSource,
      wasmLoaderSource: runtimeAssets.wasmLoaderSource,
      wasmBinary,
      version: MUPDF_VERSION
    }], [wasmBinary]);
  }

  onMessage(event) {
    const [kind, id, payload] = event.data || [];
    if (kind === 'READY') {
      this.ready = true;
      this.resolveReady(payload);
      return;
    }
    if (kind === 'BOOT_ERROR') {
      const error = new Error(payload?.message || 'Failed to load MuPDF runtime');
      error.stack = payload?.stack || error.stack;
      this.rejectReady(error);
      return;
    }
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (kind === 'RESULT') pending.resolve(payload);
    else {
      const error = new Error(payload?.message || 'MuPDF worker error');
      error.name = payload?.name || 'Error';
      error.stack = payload?.stack || error.stack;
      pending.reject(error);
    }
  }

  async call(method, args = [], transfer = []) {
    await this.readyPromise;
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(['CALL', id, { method, args }], transfer);
    });
  }

  terminate() {
    for (const { reject } of this.pending.values()) reject(new Error('Worker terminated'));
    this.pending.clear();
    this.worker.terminate();
    URL.revokeObjectURL(this.workerUrl);
  }
}

class AnnotationCommentModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.annotation = options.annotation || null;
    this.fileName = options.fileName || '';
    this.pageNumber = Number(options.pageNumber) || 1;
    this.favoriteTags = normalizeTags(options.favoriteTags || []);
    this.allTags = normalizeTags(options.allTags || []);
    this.onSave = typeof options.onSave === 'function' ? options.onSave : async () => {};
    this.onClear = typeof options.onClear === 'function' ? options.onClear : null;
    this.previewSrc = typeof options.previewSrc === 'string' ? options.previewSrc : '';
    this.selectedTags = normalizeTags(this.annotation?.tags || []);
  }

  renderTagChips() {
    if (!this.tagChipsEl) return;
    this.tagChipsEl.empty();
    if (!this.selectedTags.length) {
      this.tagChipsEl.createSpan({ cls: 'mupdf-comment-tags-empty', text: '暂未添加 Tag' });
      return;
    }
    for (const tag of this.selectedTags) {
      const chip = this.tagChipsEl.createEl('button', { cls: 'mupdf-comment-tag-chip', attr: { type: 'button', title: `移除 #${tag}` } });
      chip.createSpan({ text: `#${tag}` });
      const x = chip.createSpan({ cls: 'mupdf-comment-tag-x', text: '×' });
      x.setAttribute('aria-hidden', 'true');
      chip.addEventListener('click', () => {
        this.selectedTags = this.selectedTags.filter((value) => value !== tag);
        this.renderTagChips();
        this.renderFavoriteTags();
      });
    }
  }

  renderFavoriteTags() {
    if (!this.favoriteTagsEl) return;
    this.favoriteTagsEl.empty();
    for (const tag of this.favoriteTags) {
      const active = this.selectedTags.includes(tag);
      const button = this.favoriteTagsEl.createEl('button', { cls: `mupdf-comment-favorite-tag${active ? ' is-active' : ''}`, attr: { type: 'button' }, text: `#${tag}` });
      button.addEventListener('click', () => {
        if (this.selectedTags.includes(tag)) this.selectedTags = this.selectedTags.filter((value) => value !== tag);
        else this.selectedTags = normalizeTags([...this.selectedTags, tag]);
        this.renderTagChips();
        this.renderFavoriteTags();
      });
    }
  }

  commitTagInput() {
    const raw = String(this.tagInput?.value || '').trim();
    if (!raw) return;
    const parts = raw.includes('#') ? raw.split('#') : raw.split(/[\n,，;；]+/);
    this.selectedTags = normalizeTags([...this.selectedTags, ...parts]);
    if (this.tagInput) this.tagInput.value = '';
    this.renderTagChips();
    this.renderFavoriteTags();
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass('mupdf-comment-modal');
    contentEl.empty();
    const isFreeNote = this.annotation?.type === 'note';
    const isRegion = this.annotation?.type === 'region';
    const hasExisting = !!(this.annotation?.comment?.trim() || this.selectedTags.length);

    const header = contentEl.createDiv({ cls: 'mupdf-comment-header' });
    header.createDiv({ cls: 'mupdf-comment-title', text: isFreeNote ? (hasExisting ? '编辑便签' : '添加便签') : isRegion ? (hasExisting ? '编辑区域摘录' : '保存区域摘录') : (hasExisting ? '编辑批注' : '添加批注') });
    header.createDiv({ cls: 'mupdf-comment-meta', text: `${this.fileName || 'PDF'} · 第 ${this.pageNumber} 页` });

    const regionPreviewSrc = this.previewSrc || String(this.annotation?.previewDataUrl || '');
    if (isRegion && regionPreviewSrc) {
      const previewWrap = contentEl.createDiv({ cls: 'mupdf-comment-region-preview' });
      const image = previewWrap.createEl('img', { attr: { src: regionPreviewSrc, alt: '区域摘录预览' } });
      image.draggable = false;
      previewWrap.createDiv({ cls: 'mupdf-comment-region-preview-caption', text: '区域摘录预览 · 原 PDF 坐标会独立保存，可随时定位回来。' });
    }

    if (String(this.annotation?.text || '').trim()) {
      const quote = contentEl.createDiv({ cls: 'mupdf-comment-quote' });
      quote.createDiv({ cls: 'mupdf-comment-quote-label', text: '标注原文' });
      quote.createDiv({ cls: 'mupdf-comment-quote-text', text: String(this.annotation?.text || '').trim() });
    } else if (isFreeNote) {
      const hint = contentEl.createDiv({ cls: 'mupdf-comment-note-hint' });
      setIcon(hint.createSpan({ cls: 'mupdf-comment-note-hint-icon' }), 'map-pin');
      hint.createSpan({ text: '此便签固定在当前 PDF 空间位置，缩放时会跟随页面。' });
    }

    const field = contentEl.createDiv({ cls: 'mupdf-comment-field' });
    field.createDiv({ cls: 'mupdf-comment-field-label', text: isFreeNote ? '便签内容' : isRegion ? '说明' : '批注' });
    this.textarea = field.createEl('textarea', {
      cls: 'mupdf-comment-textarea',
      attr: { placeholder: isRegion ? '说明这张图、表格、公式或区域为什么重要…' : '记录你的想法、疑问或结论…', 'aria-label': isFreeNote ? '便签内容' : isRegion ? '区域摘录说明' : '批注内容' }
    });
    this.textarea.value = String(this.annotation?.comment || '');

    const tagsSection = contentEl.createDiv({ cls: 'mupdf-comment-tags-section' });
    tagsSection.createDiv({ cls: 'mupdf-comment-field-label', text: 'Tags' });
    this.tagChipsEl = tagsSection.createDiv({ cls: 'mupdf-comment-tags' });
    this.renderTagChips();

    const tagInputRow = tagsSection.createDiv({ cls: 'mupdf-comment-tag-input-row' });
    const datalistId = `mupdf-tags-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.tagInput = tagInputRow.createEl('input', { cls: 'mupdf-comment-tag-input', attr: { type: 'text', placeholder: '输入 Tag，Enter 添加', list: datalistId, 'aria-label': '添加 Tag' } });
    const datalist = tagInputRow.createEl('datalist', { attr: { id: datalistId } });
    for (const tag of normalizeTags([...this.favoriteTags, ...this.allTags])) datalist.createEl('option', { attr: { value: tag } });
    const addTagButton = tagInputRow.createEl('button', { text: '添加', attr: { type: 'button' } });
    addTagButton.addEventListener('click', () => this.commitTagInput());
    this.tagInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        this.commitTagInput();
      }
    });

    if (this.favoriteTags.length) {
      tagsSection.createDiv({ cls: 'mupdf-comment-tags-caption', text: '常用 Tag' });
      this.favoriteTagsEl = tagsSection.createDiv({ cls: 'mupdf-comment-favorite-tags' });
      this.renderFavoriteTags();
    }

    const presentation = contentEl.createDiv({ cls: 'mupdf-comment-presentation' });
    const pinLabel = presentation.createEl('label', { cls: 'mupdf-comment-pin-row' });
    this.pinCheckbox = pinLabel.createEl('input', { attr: { type: 'checkbox' } });
    this.pinCheckbox.checked = this.annotation?.presentation?.pinned === true;
    const pinIcon = pinLabel.createSpan({ cls: 'mupdf-comment-pin-icon' });
    setIcon(pinIcon, 'pin');
    const pinText = pinLabel.createSpan();
    pinText.createDiv({ cls: 'mupdf-comment-pin-title', text: '关键记录 · 固定展开' });
    pinText.createDiv({ cls: 'mupdf-comment-pin-desc', text: '二次打开论文时自动展开这条记录。普通批注默认只显示小色点。' });

    const footer = contentEl.createDiv({ cls: 'mupdf-comment-footer' });
    footer.createDiv({ cls: 'mupdf-comment-hint', text: 'Ctrl/Cmd + Enter 保存' });
    const actions = footer.createDiv({ cls: 'mupdf-comment-actions' });

    if (this.annotation?.comment?.trim() && this.onClear) {
      const clearButton = actions.createEl('button', { text: isFreeNote ? '删除便签' : isRegion ? '清空说明' : '删除批注内容', cls: 'mupdf-comment-clear' });
      clearButton.addEventListener('click', async () => {
        clearButton.disabled = true;
        try {
          await this.onClear({ tags: this.selectedTags.slice(), pinned: this.pinCheckbox?.checked === true });
          this.close();
        } catch (error) {
          console.error('[MuPDF Reader] failed to clear comment', error);
          new Notice('删除批注内容失败');
          clearButton.disabled = false;
        }
      });
    }

    const cancelButton = actions.createEl('button', { text: '取消' });
    cancelButton.addEventListener('click', () => this.close());
    const saveButton = actions.createEl('button', { text: '保存', cls: 'mod-cta' });

    const save = async () => {
      if (saveButton.disabled) return;
      this.commitTagInput();
      const comment = String(this.textarea.value || '').trim();
      const tags = normalizeTags(this.selectedTags);
      if (!comment && !tags.length && !isRegion) {
        new Notice(isFreeNote ? '请输入便签内容或添加 Tag' : '请输入批注内容或添加 Tag');
        this.textarea.focus();
        return;
      }
      saveButton.disabled = true;
      cancelButton.disabled = true;
      try {
        await this.onSave({ comment, tags, pinned: this.pinCheckbox?.checked === true });
        this.close();
      } catch (error) {
        console.error('[MuPDF Reader] failed to save comment', error);
        new Notice(isFreeNote ? '便签保存失败' : isRegion ? '区域摘录保存失败' : '批注保存失败');
        saveButton.disabled = false;
        cancelButton.disabled = false;
      }
    };

    saveButton.addEventListener('click', save);
    this.textarea.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        save();
      }
    });
    window.setTimeout(() => {
      this.textarea?.focus();
      const len = this.textarea?.value?.length || 0;
      try { this.textarea?.setSelectionRange(len, len); } catch (_) {}
    }, 0);
  }

  onClose() { this.contentEl.empty(); }
}

class PdfReader {
  constructor(view, root, file, initialZoom) {
    this.view = view;
    this.app = view.app;
    this.plugin = view.plugin;
    this.root = root;
    this.file = file;
    this.zoom = clamp(Number(initialZoom) || 1, MIN_ZOOM, MAX_ZOOM);
    this.pageSizes = [];
    this.pageNodes = [];
    this.pageState = [];
    this.currentPage = 0;
    this.docId = null;
    this.worker = null;
    this.observer = null;
    this.destroyed = false;
    this.renderEpoch = 0;
    this.scrollRaf = 0;
    this.renderQueue = [];
    this.rendering = false;
    this.detailRenderQueue = [];
    this.detailRendering = false;
    this.selection = null;
    this.selectionSeq = 0;
    this.selectionDrag = null;
    this.selectionRaf = 0;
    this.pendingSelectionPoint = null;
    this.annotations = [];
    this.annotationUnsubscribe = null;
    this.annotationColor = 'yellow';
    this.annotationStyle = 'highlight';
    this.notePlacementMode = false;
    this.regionCaptureMode = false;
    this.regionCaptureDrag = null;
    this.expandedNoteIds = new Set();
    this.temporarilyCollapsedNoteIds = new Set();
    this.noteUiRaf = 0;
    this.draggingNoteId = null;
    this.outlineCache = null;
    this.searchState = { query: '', results: [], activeIndex: -1, epoch: 0 };
    this.readingPositionSaveDebounced = debounce(() => this.persistReadingPosition(), 500);
    this.rerenderDebounced = debounce(() => this.rerenderVisible(), 180);
  }

  async init() {
    this.buildShell();
    this.setStatus('正在加载 MuPDF…');
    const runtimeAssets = await this.plugin.loadMuPdfRuntimeAssets();
    this.worker = new MuPdfWorkerClient(runtimeAssets);

    try {
      await this.worker.readyPromise;
      this.setStatus('正在读取 PDF…');
      const buffer = await this.app.vault.readBinary(this.file);
      this.docId = await this.worker.call('openDocument', [buffer, 'application/pdf'], [buffer]);
      this.pageSizes = await this.worker.call('getPageSizes', [this.docId]);
      if (!this.pageSizes.length) throw new Error('PDF 没有可显示的页面');
      this.annotations = this.plugin.getAnnotationsForFile(this.file.path);
      this.annotationUnsubscribe = this.plugin.subscribeAnnotations((filePath) => {
        if (filePath !== this.file.path || this.destroyed) return;
        this.annotations = this.plugin.getAnnotationsForFile(this.file.path);
        this.drawAllAnnotations();
      });
      this.createPages();
      this.updateZoomLayout(false);
      this.setupObservers();
      this.plugin.lastReaderFilePath = this.file.path;
      this.setStatus(`${this.pageSizes.length} 页 · MuPDF ${MUPDF_VERSION}`);
      window.setTimeout(() => {
        this.restoreReadingPosition();
        this.renderVisible(true);
        this.updateCurrentPage();
        this.plugin.refreshResearchSidebar?.();
        // Upgrade old screen-cropped Region previews in the background. Coordinates are
        // already stored in PDF space, so no user recapture is required.
        window.setTimeout(() => this.upgradeLegacyRegionPreviews(), 700);
      }, 0);
    } catch (error) {
      this.showFatalError(error);
      throw error;
    }
  }

  buildShell() {
    this.root.empty();
    this.root.addClass('mupdf-reader-root');
    this.root.tabIndex = 0;

    const toolbar = this.root.createDiv({ cls: 'mupdf-reader-toolbar' });
    createButton(toolbar, 'chevron-left', '上一页', () => this.goToPage(this.currentPage));
    createButton(toolbar, 'chevron-right', '下一页', () => this.goToPage(this.currentPage + 2));

    const pageBox = toolbar.createDiv({ cls: 'mupdf-reader-page-box' });
    this.pageInput = pageBox.createEl('input', {
      cls: 'mupdf-reader-page-input',
      attr: { type: 'number', min: '1', value: '1', 'aria-label': '页码' }
    });
    this.pageCountEl = pageBox.createSpan({ text: '/ —', cls: 'mupdf-reader-page-count' });
    this.pageInput.addEventListener('change', () => this.goToPage(Number(this.pageInput.value)));
    this.pageInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.goToPage(Number(this.pageInput.value));
        this.scrollEl.focus();
      }
    });

    const spacer = toolbar.createDiv({ cls: 'mupdf-reader-toolbar-spacer' });
    spacer.setAttribute('aria-hidden', 'true');

    const zoomControls = toolbar.createDiv({ cls: 'mupdf-reader-zoom-controls' });
    createButton(zoomControls, 'zoom-out', '缩小', () => this.setZoom(this.zoom / 1.15));

    const zoomBox = zoomControls.createDiv({ cls: 'mupdf-reader-zoom-box', attr: { title: '缩放比例（25–500%），Ctrl/Cmd+0 恢复 100%' } });
    this.zoomInput = zoomBox.createEl('input', {
      cls: 'mupdf-reader-zoom-input',
      attr: {
        type: 'text',
        inputmode: 'decimal',
        value: String(Math.round(this.zoom * 100)),
        'aria-label': '缩放比例'
      }
    });
    zoomBox.createSpan({ cls: 'mupdf-reader-zoom-percent', text: '%' });
    const commitZoomInput = () => {
      const value = Number.parseFloat(String(this.zoomInput.value).replace('%', '').trim());
      if (Number.isFinite(value)) this.setZoom(value / 100);
      this.zoomInput.value = String(Math.round(this.zoom * 100));
    };
    this.zoomInput.addEventListener('change', commitZoomInput);
    this.zoomInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitZoomInput();
        this.scrollEl?.focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.zoomInput.value = String(Math.round(this.zoom * 100));
        this.scrollEl?.focus();
      }
    });
    this.zoomInput.addEventListener('focus', () => this.zoomInput.select());

    createButton(zoomControls, 'zoom-in', '放大', () => this.setZoom(this.zoom * 1.15));
    createButton(toolbar, 'maximize-2', '适合宽度', () => this.fitWidth()).addClass('mupdf-reader-fit-btn');
    createButton(toolbar, 'panel-right', '打开研究侧栏', () => this.plugin.openResearchSidebar('annotations')).addClass('mupdf-reader-sidebar-btn');
    createButton(toolbar, 'languages', '打开悬浮划词翻译', () => this.plugin.openTranslationPanel()).addClass('mupdf-reader-translate-btn');
    this.notePlacementButton = createButton(toolbar, 'sticky-note', '在 PDF 空间添加便签', () => this.toggleNotePlacementMode());
    this.notePlacementButton.addClass('mupdf-reader-note-placement-btn');
    this.regionCaptureButton = createButton(toolbar, 'crop', '框选图、表或任意 PDF 区域', () => this.toggleRegionCaptureMode());
    this.regionCaptureButton.addClass('mupdf-reader-region-capture-btn');
    this.noteDisplayButton = createButton(toolbar, 'message-circle', '批注显示方式', (event) => this.showAnnotationDisplayMenu(event));
    this.noteDisplayButton.addClass('mupdf-reader-note-display-btn');
    this.updateNoteDisplayButton();

    this.selectionActions = toolbar.createDiv({ cls: 'mupdf-reader-selection-actions is-hidden' });
    this.highlightButton = createButton(this.selectionActions, 'highlighter', '高亮选区', () => this.addAnnotationFromSelection('highlight', this.annotationColor));
    this.colorButton = createButton(this.selectionActions, 'palette', '选择标注颜色', (event) => this.showAnnotationColorMenu(event));
    this.colorButton.addClass('mupdf-reader-color-btn');
    this.updateAnnotationColorButton();
    createButton(this.selectionActions, 'underline', '下划线选区', () => this.addAnnotationFromSelection('underline', this.annotationColor));
    createButton(this.selectionActions, 'message-square-plus', '添加批注（保存为高亮）', () => this.addCommentFromSelection());
    createButton(this.selectionActions, 'copy', '复制选区 (Ctrl/Cmd+C)', () => this.copySelection());
    createButton(this.selectionActions, 'x', '清除选区 (Esc)', () => this.clearSelection());

    this.statusEl = toolbar.createDiv({ cls: 'mupdf-reader-status', text: '' });
    this.scrollEl = this.root.createDiv({ cls: 'mupdf-reader-scroll' });
    this.pagesEl = this.scrollEl.createDiv({ cls: 'mupdf-reader-pages' });
    this.loadingEl = this.root.createDiv({ cls: 'mupdf-reader-loading', text: '正在准备阅读器…' });
    this.noteUiLayer = this.root.createDiv({ cls: 'mupdf-reader-note-ui-layer' });

    this.root.addEventListener('pointerdown', (event) => {
      // Visual-note interactions must win over the global "click blank space to
      // collapse transient cards" behavior. Annotation SVGs intentionally do not
      // own pointer events (so text selection remains possible), therefore the DOM
      // target can be the page shell even when the pointer is geometrically inside
      // a saved highlight/underline/region. Resolve the PDF-space hit explicitly
      // before deciding that this is a blank-space click.
      if (event.target?.closest?.('.mupdf-reader-note-card, .mupdf-reader-note-marker, .mupdf-comment-modal')) return;
      const pageEl = event.target?.closest?.('.mupdf-reader-page');
      if (pageEl) {
        const pageIndex = Number(pageEl.dataset.pageIndex);
        if (Number.isInteger(pageIndex)) {
          const point = this.pagePointFromEvent(event, pageIndex);
          if (point && this.findAnnotationAt(pageIndex, point)) return;
        }
      }
      this.collapseTransientNotes();
    }, true);
    this.scrollEl.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.scrollEl.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    this.root.addEventListener('keydown', (event) => this.onKeyDown(event));
  }

  createPages() {
    this.pagesEl.empty();
    this.pageNodes = [];
    this.pageState = [];
    this.pageCountEl.setText(`/ ${this.pageSizes.length}`);
    this.pageInput.max = String(this.pageSizes.length);

    this.pageSizes.forEach((size, index) => {
      const shell = this.pagesEl.createDiv({ cls: 'mupdf-reader-page', attr: { 'data-page-index': String(index) } });
      const canvas = shell.createEl('canvas', { cls: 'mupdf-reader-canvas' });
      canvas.width = 1;
      canvas.height = 1;
      const detailLayer = shell.createDiv({ cls: 'mupdf-reader-detail-layer' });
      const annotationSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      annotationSvg.classList.add('mupdf-reader-annotation-layer');
      annotationSvg.setAttribute('viewBox', `0 0 ${Math.max(1, size.width)} ${Math.max(1, size.height)}`);
      annotationSvg.setAttribute('preserveAspectRatio', 'none');
      annotationSvg.setAttribute('aria-hidden', 'true');
      shell.appendChild(annotationSvg);
      const searchSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      searchSvg.classList.add('mupdf-reader-search-layer');
      searchSvg.setAttribute('viewBox', `0 0 ${Math.max(1, size.width)} ${Math.max(1, size.height)}`);
      searchSvg.setAttribute('preserveAspectRatio', 'none');
      searchSvg.setAttribute('aria-hidden', 'true');
      shell.appendChild(searchSvg);
      const selectionSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      selectionSvg.classList.add('mupdf-reader-selection-layer');
      selectionSvg.setAttribute('viewBox', `0 0 ${Math.max(1, size.width)} ${Math.max(1, size.height)}`);
      selectionSvg.setAttribute('preserveAspectRatio', 'none');
      selectionSvg.setAttribute('aria-hidden', 'true');
      shell.appendChild(selectionSvg);
      shell.addEventListener('pointerdown', (event) => this.onPagePointerDown(event, index));
      shell.addEventListener('contextmenu', (event) => this.onPageContextMenu(event, index));
      const badge = shell.createDiv({ cls: 'mupdf-reader-page-badge', text: String(index + 1) });
      badge.setAttribute('aria-hidden', 'true');
      this.pageNodes.push({ shell, canvas, detailLayer, annotationSvg, searchSvg, selectionSvg });
      this.pageState.push({ renderKey: null, queuedKey: null, lastUsed: 0, pixelScale: 0, detailRequired: false, detailTiles: new Map() });
    });
    this.loadingEl.addClass('is-hidden');
    this.drawAllAnnotations();
    this.drawSearchHighlights();
  }

  setupObservers() {
    this.observer?.disconnect();
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const index = Number(entry.target.dataset.pageIndex);
        this.queueRender(index, false);
      }
    }, { root: this.scrollEl, rootMargin: '1200px 0px 1200px 0px', threshold: 0.01 });

    for (const { shell } of this.pageNodes) this.observer.observe(shell);
  }

  setStatus(text) {
    if (this.statusEl) this.statusEl.setText(text);
    if (this.loadingEl && !this.loadingEl.hasClass('is-hidden')) this.loadingEl.setText(text);
  }

  showFatalError(error) {
    const message = error?.message || String(error);
    this.loadingEl?.removeClass('is-hidden');
    if (this.loadingEl) {
      this.loadingEl.empty();
      this.loadingEl.createDiv({ cls: 'mupdf-reader-error-title', text: 'MuPDF Reader 无法打开此 PDF' });
      this.loadingEl.createDiv({ cls: 'mupdf-reader-error-message', text: message });
      this.loadingEl.createDiv({ cls: 'mupdf-reader-error-hint', text: 'MuPDF 运行时已内置在插件中，不需要联网。请确认插件 ZIP 完整解压，尤其是 vendor/mupdf/ 下的 JS 与 WASM 文件。' });
    }
  }

  updateZoomLayout(anchor = true, anchorY = null) {
    if (!this.pageSizes.length) return;
    const oldScrollHeight = Math.max(1, this.scrollEl.scrollHeight);
    const oldScrollTop = this.scrollEl.scrollTop;
    const viewportAnchor = anchorY == null ? this.scrollEl.clientHeight / 2 : anchorY;
    const relative = (oldScrollTop + viewportAnchor) / oldScrollHeight;

    this.pageSizes.forEach((size, index) => {
      const cssWidth = size.width * BASE_SCALE * this.zoom;
      const cssHeight = size.height * BASE_SCALE * this.zoom;
      const { shell, canvas } = this.pageNodes[index] || {};
      if (!shell) return;
      shell.style.width = `${cssWidth}px`;
      shell.style.height = `${cssHeight}px`;
      if (canvas) {
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
      }
    });
    if (this.zoomInput && document.activeElement !== this.zoomInput) this.zoomInput.value = String(Math.round(this.zoom * 100));
    this.requestNoteUiRender();

    if (anchor) {
      requestAnimationFrame(() => {
        const newScrollHeight = Math.max(1, this.scrollEl.scrollHeight);
        this.scrollEl.scrollTop = Math.max(0, relative * newScrollHeight - viewportAnchor);
      });
    }
  }

  setZoom(nextZoom, anchorY = null) {
    const next = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(next - this.zoom) < 0.001) return;
    this.zoom = next;
    this.renderEpoch++;
    this.clearAllDetailTiles();
    this.updateZoomLayout(true, anchorY);
    this.rerenderDebounced();
    this.readingPositionSaveDebounced();
  }

  fitWidth() {
    if (!this.pageSizes.length) return;
    const index = clamp(this.currentPage, 0, this.pageSizes.length - 1);
    const widthPt = this.pageSizes[index].width;
    const available = Math.max(200, this.scrollEl.clientWidth - 48);
    this.setZoom(available / (widthPt * BASE_SCALE));
  }

  onWheel(event) {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const rect = this.scrollEl.getBoundingClientRect();
    const anchorY = clamp(event.clientY - rect.top, 0, this.scrollEl.clientHeight);
    const factor = Math.exp(-event.deltaY * 0.0022);
    this.setZoom(this.zoom * factor, anchorY);
  }

  onKeyDown(event) {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    if (event.key === 'Escape' && this.regionCaptureMode) {
      event.preventDefault();
      this.setRegionCaptureMode(false);
      return;
    }
    if (event.key === 'Escape' && this.notePlacementMode) {
      event.preventDefault();
      this.setNotePlacementMode(false);
      return;
    }
    if (event.key === 'Escape' && this.selection) {
      event.preventDefault();
      this.clearSelection();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && this.selection?.text) {
      event.preventDefault();
      this.copySelection();
      return;
    }
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === 'f') {
      event.preventDefault();
      this.plugin.openResearchSidebar('search');
      return;
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      this.setZoom(this.zoom * 1.15);
    } else if (event.key === '-') {
      event.preventDefault();
      this.setZoom(this.zoom / 1.15);
    } else if (event.key === '0') {
      event.preventDefault();
      this.setZoom(1);
    }
  }

  pagePointFromEvent(event, pageIndex) {
    const node = this.pageNodes[pageIndex];
    const size = this.pageSizes[pageIndex];
    if (!node || !size) return null;
    const rect = node.shell.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const localX = clamp(event.clientX - rect.left, 0, rect.width);
    const localY = clamp(event.clientY - rect.top, 0, rect.height);
    return [
      (size.x || 0) + localX / rect.width * size.width,
      (size.y || 0) + localY / rect.height * size.height
    ];
  }

  selectionClientRect(pageIndex, quads) {
    const node = this.pageNodes?.[pageIndex];
    const size = this.pageSizes?.[pageIndex];
    if (!node?.shell || !size || !Array.isArray(quads) || !quads.length) return null;
    const rect = node.shell.getBoundingClientRect();
    if (!rect.width || !rect.height || !size.width || !size.height) return null;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    const toClient = (x, y) => ({
      x: rect.left + ((Number(x) - (size.x || 0)) / size.width) * rect.width,
      y: rect.top + ((Number(y) - (size.y || 0)) / size.height) * rect.height
    });
    for (const quad of quads) {
      if (!Array.isArray(quad) || quad.length < 8) continue;
      for (let i = 0; i < 8; i += 2) {
        const p = toClient(quad[i], quad[i + 1]);
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        left = Math.min(left, p.x);
        top = Math.min(top, p.y);
        right = Math.max(right, p.x);
        bottom = Math.max(bottom, p.y);
      }
    }
    if (![left, top, right, bottom].every(Number.isFinite)) return null;
    return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  }

  onPagePointerDown(event, pageIndex) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) return;
    const start = this.pagePointFromEvent(event, pageIndex);
    if (!start) return;
    event.preventDefault();
    if (this.regionCaptureMode) {
      this.startRegionCapture(event, pageIndex, start);
      return;
    }
    if (this.notePlacementMode) {
      this.setNotePlacementMode(false);
      this.createFreeNoteAt(pageIndex, start);
      return;
    }
    this.clearSelection(false);

    // Do not hand a zero-length click to MuPDF's word-snapping selection logic.
    // A normal click should simply place/focus the pointer area; text selection only
    // begins after a deliberate drag. Client-space pixels keep the gesture threshold
    // stable across PDF zoom levels and Retina/HiDPI displays.
    const dragThresholdPx = 5;
    this.selectionDrag = {
      pageIndex,
      pointerId: event.pointerId,
      start,
      last: start,
      clientStartX: event.clientX,
      clientStartY: event.clientY,
      active: false
    };
    const shell = this.pageNodes[pageIndex].shell;
    try { shell.setPointerCapture(event.pointerId); } catch (_) {}

    const crossedThreshold = (pointerEvent, drag) => {
      const dx = Number(pointerEvent.clientX) - Number(drag.clientStartX);
      const dy = Number(pointerEvent.clientY) - Number(drag.clientStartY);
      return Math.hypot(dx, dy) >= dragThresholdPx;
    };

    const move = (moveEvent) => {
      const drag = this.selectionDrag;
      if (!drag || moveEvent.pointerId !== drag.pointerId) return;
      const point = this.pagePointFromEvent(moveEvent, pageIndex);
      if (!point) return;
      drag.last = point;

      // Ignore small mouse jitter. This is the key distinction between a click and
      // a text-selection drag; before this point no MuPDF selection request is sent.
      if (!drag.active) {
        if (!crossedThreshold(moveEvent, drag)) return;
        drag.active = true;
      }

      this.pendingSelectionPoint = point;
      if (!this.selectionRaf) {
        this.selectionRaf = requestAnimationFrame(() => {
          this.selectionRaf = 0;
          const pending = this.pendingSelectionPoint;
          this.pendingSelectionPoint = null;
          if (pending && this.selectionDrag?.active) this.updateSelection(pageIndex, this.selectionDrag.start, pending, false);
        });
      }
    };

    const finish = (upEvent) => {
      const drag = this.selectionDrag;
      if (!drag || upEvent.pointerId !== drag.pointerId) return;
      shell.removeEventListener('pointermove', move);
      shell.removeEventListener('pointerup', finish);
      shell.removeEventListener('pointercancel', cancel);
      const point = this.pagePointFromEvent(upEvent, pageIndex) || drag.last;
      const shouldSelect = drag.active || crossedThreshold(upEvent, drag);
      this.selectionDrag = null;
      this.pendingSelectionPoint = null;
      if (this.selectionRaf) {
        cancelAnimationFrame(this.selectionRaf);
        this.selectionRaf = 0;
      }

      // Plain click: selection stays cleared and, importantly, auto-translation is
      // not triggered. If the click lands on a saved annotation that already has a
      // comment, open the comment editor directly; otherwise do nothing. A drag that
      // crossed the threshold still gets one final, precise MuPDF selection update.
      if (shouldSelect) {
        this.updateSelection(pageIndex, drag.start, point, true);
      } else {
        const annotationHit = this.findAnnotationAt(pageIndex, point);
        if (annotationHit && this.annotationHasNote(annotationHit)) {
          if (annotationHit.presentation?.pinned === true) {
            this.temporarilyCollapsedNoteIds.delete(annotationHit.id);
            this.expandedNoteIds.add(annotationHit.id);
            this.requestNoteUiRender();
          } else {
            this.toggleAnnotationNote(annotationHit);
          }
        }
      }
      try { shell.releasePointerCapture(upEvent.pointerId); } catch (_) {}
    };

    const cancel = (cancelEvent) => {
      shell.removeEventListener('pointermove', move);
      shell.removeEventListener('pointerup', finish);
      shell.removeEventListener('pointercancel', cancel);
      this.selectionDrag = null;
      this.pendingSelectionPoint = null;
      if (this.selectionRaf) {
        cancelAnimationFrame(this.selectionRaf);
        this.selectionRaf = 0;
      }
      try { shell.releasePointerCapture(cancelEvent.pointerId); } catch (_) {}
    };

    shell.addEventListener('pointermove', move);
    shell.addEventListener('pointerup', finish);
    shell.addEventListener('pointercancel', cancel);
  }

  async updateSelection(pageIndex, start, end, final) {
    if (!this.worker || !this.docId || this.destroyed) return;
    const seq = ++this.selectionSeq;
    try {
      const result = await this.worker.call('selectText', [this.docId, pageIndex, start, end]);
      if (this.destroyed || seq !== this.selectionSeq) return;
      const text = typeof result?.text === 'string' ? result.text : '';
      const quads = Array.isArray(result?.quads) ? result.quads : [];
      if (!text || !quads.length) {
        this.clearSelection(false);
        return;
      }
      const mode = typeof result?.mode === 'string' ? result.mode : 'native';
      const startColumn = Number.isInteger(result?.startColumn) ? result.startColumn : null;
      const detectedColumns = !!result?.detectedColumns;
      this.selection = { pageIndex, start, end, text, quads, mode, startColumn, detectedColumns };
      this.drawSelection(pageIndex, quads);
      this.selectionActions?.removeClass('is-hidden');
      if (final) {
        this.plugin.handleReaderSelection({
          text,
          filePath: this.file.path,
          fileName: this.file.name,
          pageIndex,
          pageNumber: pageIndex + 1,
          selectionRect: this.selectionClientRect(pageIndex, quads)
        });
      }
    } catch (error) {
      console.error('[MuPDF Reader] selection failed', error);
    }
  }

  isPointInsideSelection(pageIndex, point) {
    const selection = this.selection;
    if (!selection || selection.pageIndex !== pageIndex || !point) return false;
    const [x, y] = point;
    const padding = 2.5;
    for (const quad of selection.quads || []) {
      if (!Array.isArray(quad) || quad.length < 8) continue;
      const xs = [quad[0], quad[2], quad[4], quad[6]];
      const ys = [quad[1], quad[3], quad[5], quad[7]];
      const minX = Math.min(...xs) - padding;
      const maxX = Math.max(...xs) + padding;
      const minY = Math.min(...ys) - padding;
      const maxY = Math.max(...ys) + padding;
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) return true;
    }
    return false;
  }

  annotationTypeLabel(type) {
    if (type === 'note') return '便签';
    if (type === 'region') return '区域摘录';
    return type === 'underline' ? '下划线' : '高亮';
  }

  annotationColorLabel(color) {
    return ANNOTATION_COLOR_LABELS[color] || ANNOTATION_COLOR_LABELS.yellow;
  }

  updateAnnotationColorButton() {
    if (!this.colorButton) return;
    const color = ANNOTATION_COLORS.includes(this.annotationColor) ? this.annotationColor : 'yellow';
    this.colorButton.dataset.color = color;
    const label = this.annotationColorLabel(color);
    this.colorButton.setAttribute('aria-label', `标注颜色：${label}`);
    this.colorButton.setAttribute('title', `标注颜色：${label}`);
  }

  annotationHasNote(annotation) {
    return !!(annotation && (annotation.type === 'note' || annotation.type === 'region' || String(annotation.comment || '').trim() || (Array.isArray(annotation.tags) && annotation.tags.length)));
  }

  currentAnnotationDisplayMode() {
    const mode = this.plugin.settings?.annotationDisplayMode;
    return Object.prototype.hasOwnProperty.call(ANNOTATION_DISPLAY_MODES, mode) ? mode : 'key';
  }

  updateNoteDisplayButton() {
    if (!this.noteDisplayButton) return;
    const mode = this.currentAnnotationDisplayMode();
    this.noteDisplayButton.dataset.mode = mode;
    const label = ANNOTATION_DISPLAY_MODES[mode] || ANNOTATION_DISPLAY_MODES.key;
    this.noteDisplayButton.setAttribute('title', `批注显示：${label}`);
    this.noteDisplayButton.setAttribute('aria-label', `批注显示：${label}`);
  }

  refreshNoteSettings() {
    this.updateNoteDisplayButton();
    this.requestNoteUiRender();
  }

  showAnnotationDisplayMenu(event) {
    event?.preventDefault?.();
    const menu = new Menu();
    const current = this.currentAnnotationDisplayMode();
    for (const [mode, label] of Object.entries(ANNOTATION_DISPLAY_MODES)) {
      menu.addItem((item) => item
        .setTitle(`${mode === current ? '✓ ' : ''}${label}`)
        .setIcon(mode === 'hidden' ? 'eye-off' : mode === 'all' ? 'panels-top-left' : mode === 'markers' ? 'circle-dot' : 'pin')
        .onClick(async () => {
          await this.plugin.updateSettings({ annotationDisplayMode: mode });
          this.updateNoteDisplayButton();
          this.requestNoteUiRender();
        }));
    }
    if (event && typeof menu.showAtMouseEvent === 'function') menu.showAtMouseEvent(event);
  }

  setNotePlacementMode(enabled) {
    this.notePlacementMode = !!enabled;
    if (this.notePlacementMode && this.regionCaptureMode) this.setRegionCaptureMode(false);
    this.root?.toggleClass?.('is-note-placement-mode', this.notePlacementMode);
    this.notePlacementButton?.toggleClass?.('is-active', this.notePlacementMode);
    if (this.notePlacementButton) {
      this.notePlacementButton.setAttribute('title', this.notePlacementMode ? '便签模式已开启：点击 PDF 放置，Esc 取消' : '在 PDF 空间添加便签');
      this.notePlacementButton.setAttribute('aria-label', this.notePlacementButton.getAttribute('title'));
    }
    if (this.notePlacementMode) new Notice('便签模式：点击 PDF 任意位置放置便签，Esc 取消', 3500);
  }

  toggleNotePlacementMode() { this.setNotePlacementMode(!this.notePlacementMode); }


  setRegionCaptureMode(enabled) {
    this.regionCaptureMode = !!enabled;
    if (this.regionCaptureMode && this.notePlacementMode) this.setNotePlacementMode(false);
    this.root?.toggleClass?.('is-region-capture-mode', this.regionCaptureMode);
    this.regionCaptureButton?.toggleClass?.('is-active', this.regionCaptureMode);
    if (this.regionCaptureButton) {
      const title = this.regionCaptureMode ? '区域摘录模式：拖动框选图、表或任意区域，Esc 取消' : '框选图、表或任意 PDF 区域';
      this.regionCaptureButton.setAttribute('title', title);
      this.regionCaptureButton.setAttribute('aria-label', title);
    }
    if (this.regionCaptureMode) new Notice('区域摘录模式：拖动框选图、表或任意区域，Esc 取消', 3500);
  }

  toggleRegionCaptureMode() { this.setRegionCaptureMode(!this.regionCaptureMode); }

  regionRectFromPoints(start, end) {
    if (!Array.isArray(start) || !Array.isArray(end)) return null;
    const x0 = Math.min(Number(start[0]), Number(end[0]));
    const y0 = Math.min(Number(start[1]), Number(end[1]));
    const x1 = Math.max(Number(start[0]), Number(end[0]));
    const y1 = Math.max(Number(start[1]), Number(end[1]));
    if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
    return [x0, y0, x1, y1];
  }

  captureRegionPreviewFallback(pageIndex, rectPdf) {
    const node = this.pageNodes?.[pageIndex];
    const size = this.pageSizes?.[pageIndex];
    const canvas = node?.canvas;
    if (!canvas || !size || canvas.width < 8 || canvas.height < 8 || !Array.isArray(rectPdf) || rectPdf.length < 4) return null;
    try {
      const ox = size.x || 0;
      const oy = size.y || 0;
      let sx = ((rectPdf[0] - ox) / size.width) * canvas.width;
      let sy = ((rectPdf[1] - oy) / size.height) * canvas.height;
      let ex = ((rectPdf[2] - ox) / size.width) * canvas.width;
      let ey = ((rectPdf[3] - oy) / size.height) * canvas.height;
      sx = clamp(sx, 0, canvas.width);
      sy = clamp(sy, 0, canvas.height);
      ex = clamp(ex, 0, canvas.width);
      ey = clamp(ey, 0, canvas.height);
      const sw = Math.max(1, ex - sx);
      const sh = Math.max(1, ey - sy);
      const maxW = 1100;
      const maxH = 900;
      const scale = Math.min(1, maxW / sw, maxH / sh);
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(sw * scale));
      out.height = Math.max(1, Math.round(sh * scale));
      const ctx = out.getContext('2d', { alpha: false });
      if (!ctx) return null;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
      return { dataUrl: out.toDataURL('image/webp', 0.94), width: out.width, height: out.height, pixelScale: 0, previewVersion: 1 };
    } catch (error) {
      console.warn('[MuPDF Reader] region fallback preview capture failed', error);
      return null;
    }
  }

  async renderRegionPreview(pageIndex, rectPdf) {
    if (!this.worker || !this.docId || !Array.isArray(rectPdf) || rectPdf.length < 4) return this.captureRegionPreviewFallback(pageIndex, rectPdf);
    try {
      const result = await this.worker.call('renderRegion', [this.docId, pageIndex, rectPdf, {
        maxWidth: 1800,
        maxHeight: 1500,
        maxPixels: 3200000,
        maxScale: 5
      }]);
      if (!result || !result.width || !result.height || !result.pixels) throw new Error('MuPDF returned an empty region');
      const out = document.createElement('canvas');
      out.width = result.width;
      out.height = result.height;
      const ctx = out.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Canvas 2D context unavailable');
      const pixels = result.pixels instanceof Uint8ClampedArray ? result.pixels : new Uint8ClampedArray(result.pixels);
      ctx.putImageData(new ImageData(pixels, result.width, result.height), 0, 0);
      return {
        dataUrl: out.toDataURL('image/webp', 0.95),
        width: result.width,
        height: result.height,
        pixelScale: Number(result.pixelScale) || 0,
        previewVersion: 2
      };
    } catch (error) {
      console.warn('[MuPDF Reader] direct region render failed; using canvas fallback', error);
      return this.captureRegionPreviewFallback(pageIndex, rectPdf);
    }
  }

  async upgradeLegacyRegionPreviews() {
    const legacy = this.annotations.filter((annotation) => annotation?.type === 'region' && Array.isArray(annotation.rect) && Number(annotation.previewVersion || 0) < 2);
    if (!legacy.length || this.destroyed) return;
    for (const annotation of legacy) {
      if (this.destroyed) break;
      try {
        const preview = await this.renderRegionPreview(annotation.page, annotation.rect);
        if (!preview?.dataUrl || Number(preview.previewVersion || 0) < 2) continue;
        await this.plugin.updateAnnotation(this.file.path, annotation.id, {
          previewDataUrl: preview.dataUrl,
          previewVersion: 2,
          previewWidth: preview.width,
          previewHeight: preview.height,
          previewPixelScale: preview.pixelScale
        });
      } catch (error) {
        console.warn('[MuPDF Reader] legacy region preview upgrade failed', annotation?.id, error);
      }
      await new Promise((resolve) => window.setTimeout(resolve, 40));
    }
  }

  startRegionCapture(event, pageIndex, startPoint) {
    const node = this.pageNodes?.[pageIndex];
    const shell = node?.shell;
    if (!shell || !startPoint) return;
    this.clearSelection(false);
    const shellRect = shell.getBoundingClientRect();
    const startClient = { x: clamp(event.clientX - shellRect.left, 0, shellRect.width), y: clamp(event.clientY - shellRect.top, 0, shellRect.height) };
    const box = shell.createDiv({ cls: 'mupdf-reader-region-rubberband' });
    box.style.left = `${startClient.x}px`;
    box.style.top = `${startClient.y}px`;
    box.style.width = '0px';
    box.style.height = '0px';
    this.regionCaptureDrag = { pointerId: event.pointerId, pageIndex, startPoint, startClient, box, moved: false };
    try { shell.setPointerCapture(event.pointerId); } catch (_) {}

    const move = (moveEvent) => {
      const drag = this.regionCaptureDrag;
      if (!drag || moveEvent.pointerId !== drag.pointerId) return;
      const x = clamp(moveEvent.clientX - shellRect.left, 0, shellRect.width);
      const y = clamp(moveEvent.clientY - shellRect.top, 0, shellRect.height);
      const left = Math.min(drag.startClient.x, x);
      const top = Math.min(drag.startClient.y, y);
      const width = Math.abs(x - drag.startClient.x);
      const height = Math.abs(y - drag.startClient.y);
      drag.moved = drag.moved || Math.hypot(width, height) >= 7;
      drag.box.style.left = `${left}px`;
      drag.box.style.top = `${top}px`;
      drag.box.style.width = `${width}px`;
      drag.box.style.height = `${height}px`;
    };

    const cleanup = (pointerId) => {
      shell.removeEventListener('pointermove', move);
      shell.removeEventListener('pointerup', finish);
      shell.removeEventListener('pointercancel', cancel);
      try { shell.releasePointerCapture(pointerId); } catch (_) {}
      this.regionCaptureDrag?.box?.remove?.();
      this.regionCaptureDrag = null;
    };

    const finish = (upEvent) => {
      const drag = this.regionCaptureDrag;
      if (!drag || upEvent.pointerId !== drag.pointerId) return;
      const endPoint = this.pagePointFromEvent(upEvent, pageIndex);
      const rectPdf = this.regionRectFromPoints(drag.startPoint, endPoint || drag.startPoint);
      const moved = drag.moved;
      cleanup(upEvent.pointerId);
      if (!moved || !rectPdf) {
        new Notice('请拖动框选一个区域');
        return;
      }
      const size = this.pageSizes?.[pageIndex];
      const minPdf = size ? Math.max(3, Math.min(size.width, size.height) * 0.008) : 4;
      if ((rectPdf[2] - rectPdf[0]) < minPdf || (rectPdf[3] - rectPdf[1]) < minPdf) {
        new Notice('框选区域太小，请重新选择');
        return;
      }
      this.setRegionCaptureMode(false);
      this.createRegionClip(pageIndex, rectPdf);
    };

    const cancel = (cancelEvent) => cleanup(cancelEvent.pointerId);
    shell.addEventListener('pointermove', move);
    shell.addEventListener('pointerup', finish);
    shell.addEventListener('pointercancel', cancel);
  }

  async createRegionClip(pageIndex, rectPdf) {
    const preview = await this.renderRegionPreview(pageIndex, rectPdf);
    const previewDataUrl = preview?.dataUrl || '';
    const color = ANNOTATION_COLORS.includes(this.annotationColor) ? this.annotationColor : 'yellow';
    const draft = {
      id: null,
      type: 'region',
      page: pageIndex,
      rect: rectPdf.slice(0, 4),
      previewDataUrl,
      previewVersion: Number(preview?.previewVersion) || 0,
      previewWidth: Number(preview?.width) || 0,
      previewHeight: Number(preview?.height) || 0,
      previewPixelScale: Number(preview?.pixelScale) || 0,
      text: '',
      quads: [],
      color,
      fingerprint: `region:${pageIndex}:${rectPdf.map((v) => Number(v).toFixed(2)).join(':')}`,
      comment: '',
      tags: [],
      presentation: { pinned: false, side: 'auto' },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    const modal = new AnnotationCommentModal(this.app, {
      annotation: draft,
      previewSrc: draft.type === 'region' ? (draft.previewDataUrl || this.plugin.getRegionPreviewSrc(draft)) : '',
      fileName: this.file.name,
      pageNumber: pageIndex + 1,
      favoriteTags: this.plugin.settings?.favoriteTags || DEFAULT_FAVORITE_TAGS,
      allTags: this.plugin.getAllAnnotationTags(),
      onSave: async ({ comment, tags, pinned }) => {
        const annotation = { ...draft, id: this.plugin.createAnnotationId(), comment, tags, presentation: { ...draft.presentation, pinned } };
        await this.plugin.addAnnotation(this.file.path, annotation);
        this.annotations = this.plugin.getAnnotationsForFile(this.file.path);
        if (pinned) this.expandedNoteIds.add(annotation.id);
        this.drawAllAnnotations();
        this.plugin.refreshResearchSidebar?.();
        new Notice('已保存区域摘录');
      }
    });
    modal.open();
  }

  annotationBoundsPdf(annotation) {
    const size = this.pageSizes?.[annotation?.page];
    if (!annotation || !size) return null;
    if (annotation.type === 'note' && Number.isFinite(Number(annotation.x)) && Number.isFinite(Number(annotation.y))) {
      const x = Number(annotation.x);
      const y = Number(annotation.y);
      return { minX: x, maxX: x, minY: y, maxY: y, centerX: x, centerY: y };
    }
    if (annotation.type === 'region' && Array.isArray(annotation.rect) && annotation.rect.length >= 4) {
      const [x0, y0, x1, y1] = annotation.rect.slice(0, 4).map(Number);
      if ([x0, y0, x1, y1].every(Number.isFinite)) {
        const minX = Math.min(x0, x1), maxX = Math.max(x0, x1), minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
        return { minX, maxX, minY, maxY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
      }
    }
    const xs = [];
    const ys = [];
    for (const quad of annotation.quads || []) {
      if (!Array.isArray(quad) || quad.length < 8) continue;
      xs.push(Number(quad[0]), Number(quad[2]), Number(quad[4]), Number(quad[6]));
      ys.push(Number(quad[1]), Number(quad[3]), Number(quad[5]), Number(quad[7]));
    }
    const finiteXs = xs.filter(Number.isFinite);
    const finiteYs = ys.filter(Number.isFinite);
    if (!finiteXs.length || !finiteYs.length) return null;
    const minX = Math.min(...finiteXs);
    const maxX = Math.max(...finiteXs);
    const minY = Math.min(...finiteYs);
    const maxY = Math.max(...finiteYs);
    return { minX, maxX, minY, maxY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
  }

  annotationNaturalSide(annotation) {
    const size = this.pageSizes?.[annotation?.page];
    const bounds = this.annotationBoundsPdf(annotation);
    if (!size || !bounds) return 'right';
    const pageMid = (size.x || 0) + size.width / 2;
    return bounds.centerX < pageMid ? 'left' : 'right';
  }

  annotationAnchorPdf(annotation, side = 'auto') {
    const size = this.pageSizes?.[annotation?.page];
    const bounds = this.annotationBoundsPdf(annotation);
    if (!annotation || !size || !bounds) return null;
    if (annotation.type === 'note') return [bounds.centerX, bounds.centerY];
    const resolvedSide = side === 'left' || side === 'right' ? side : this.annotationNaturalSide(annotation);
    const gap = Math.min(5.5, Math.max(2.6, size.width * 0.005));
    const pageLeft = size.x || 0;
    const pageRight = pageLeft + size.width;
    const x = resolvedSide === 'left'
      ? clamp(bounds.minX - gap, pageLeft + 1.5, pageRight - 1.5)
      : clamp(bounds.maxX + gap, pageLeft + 1.5, pageRight - 1.5);
    return [x, bounds.centerY];
  }

  annotationReferenceClient(annotation) {
    const pageIndex = annotation?.page;
    const node = this.pageNodes?.[pageIndex];
    const size = this.pageSizes?.[pageIndex];
    const bounds = this.annotationBoundsPdf(annotation);
    if (!node?.shell || !size || !bounds) return null;
    const rect = node.shell.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: rect.left + (bounds.centerX - (size.x || 0)) / size.width * rect.width,
      y: rect.top + (bounds.centerY - (size.y || 0)) / size.height * rect.height
    };
  }

  annotationAnchorClient(annotation, side = 'auto') {
    const pageIndex = annotation?.page;
    const node = this.pageNodes?.[pageIndex];
    const size = this.pageSizes?.[pageIndex];
    const point = this.annotationAnchorPdf(annotation, side);
    if (!node?.shell || !size || !point) return null;
    const rect = node.shell.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: rect.left + (point[0] - (size.x || 0)) / size.width * rect.width,
      y: rect.top + (point[1] - (size.y || 0)) / size.height * rect.height
    };
  }

  annotationPreview(annotation) {
    const comment = String(annotation?.comment || '').trim().replace(/\s+/g, ' ');
    if (comment) return comment.length > 150 ? `${comment.slice(0, 147)}…` : comment;
    const tags = normalizeTags(annotation?.tags || []);
    return tags.length ? tags.map((tag) => `#${tag}`).join(' ') : this.annotationTypeLabel(annotation?.type);
  }

  requestNoteUiRender() {
    if (this.destroyed || !this.noteUiLayer || this.noteUiRaf || this.draggingNoteId) return;
    this.noteUiRaf = requestAnimationFrame(() => {
      this.noteUiRaf = 0;
      this.renderNoteUi();
    });
  }

  collapseTransientNotes() {
    if (!this.expandedNoteIds.size) return;

    // Pinned means persistent user intent: a blank-space click may dismiss a
    // transiently opened note, but it must never hide a pinned/key note. Keep all
    // pinned annotation ids in the expanded set. Also leave
    // temporarilyCollapsedNoteIds untouched: those ids represent an explicit user
    // choice to collapse a note in a display mode that would otherwise expand it.
    const pinnedIds = new Set(
      (this.annotations || [])
        .filter((annotation) => annotation?.presentation?.pinned === true)
        .map((annotation) => annotation.id)
        .filter(Boolean)
    );
    let changed = false;
    for (const id of Array.from(this.expandedNoteIds)) {
      if (pinnedIds.has(id)) continue;
      this.expandedNoteIds.delete(id);
      changed = true;
    }
    if (changed) this.requestNoteUiRender();
  }

  toggleAnnotationNote(annotation) {
    if (!this.annotationHasNote(annotation)) return;
    const mode = this.currentAnnotationDisplayMode();
    const pinnedByMode = mode === 'all' || (mode === 'key' && annotation.presentation?.pinned === true);
    const isExpanded = this.expandedNoteIds.has(annotation.id) || (pinnedByMode && !this.temporarilyCollapsedNoteIds.has(annotation.id));
    if (isExpanded) {
      this.expandedNoteIds.delete(annotation.id);
      if (pinnedByMode) this.temporarilyCollapsedNoteIds.add(annotation.id);
    } else {
      this.temporarilyCollapsedNoteIds.delete(annotation.id);
      this.expandedNoteIds.add(annotation.id);
    }
    this.requestNoteUiRender();
  }

  async setAnnotationPinned(annotation, pinned) {
    if (!annotation?.id) return;
    const presentation = { ...(annotation.presentation || {}), pinned: !!pinned };
    await this.plugin.updateAnnotation(this.file.path, annotation.id, { presentation });
    this.annotations = this.plugin.getAnnotationsForFile(this.file.path);
    this.temporarilyCollapsedNoteIds.delete(annotation.id);
    if (pinned) this.expandedNoteIds.add(annotation.id);
    this.drawAllAnnotations();
  }


  async resetAnnotationNoteLayout(annotation) {
    if (!annotation?.id) return;
    const presentation = { ...(annotation.presentation || {}), placementMode: 'auto', side: 'auto' };
    delete presentation.offsetX;
    delete presentation.offsetY;
    await this.plugin.updateAnnotation(this.file.path, annotation.id, { presentation });
    this.annotations = this.plugin.getAnnotationsForFile(this.file.path);
    this.requestNoteUiRender();
    new Notice('已恢复批注自动布局');
  }

  updateNoteCardGeometry(item, layerRect, cardLeft, cardTop, width, height) {
    if (!item?.card || !item?.marker || !item?.annotation) return;
    const refClient = this.annotationReferenceClient(item.annotation);
    if (!refClient) return;
    const refX = refClient.x - layerRect.left;
    const side = cardLeft + width / 2 < refX ? 'left' : 'right';
    item.side = side;
    item.card.dataset.side = side;
    item.marker.dataset.side = side;
    const anchorClient = this.annotationAnchorClient(item.annotation, side);
    if (!anchorClient) return;
    const anchorX = anchorClient.x - layerRect.left;
    const anchorY = anchorClient.y - layerRect.top;
    item.anchorX = anchorX;
    item.anchorY = anchorY;
    item.marker.style.left = `${anchorX}px`;
    item.marker.style.top = `${anchorY}px`;

    const cardEdgeX = side === 'left' ? cardLeft + width : cardLeft;
    const minCardY = cardTop + Math.min(22, Math.max(12, height * 0.2));
    const maxCardY = cardTop + Math.max(22, height - 18);
    const cardY = clamp(anchorY, minCardY, Math.max(minCardY, maxCardY));
    const dx = cardEdgeX - anchorX;
    const dy = cardY - anchorY;
    const length = Math.hypot(dx, dy);
    if (!item.connector) {
      item.connector = this.noteUiLayer.createDiv({ cls: 'mupdf-reader-note-connector' });
      item.connector.dataset.color = item.annotation.color || 'yellow';
      item.connector.dataset.annotationId = item.annotation.id;
    }
    item.connector.style.display = length > 7 ? '' : 'none';
    if (length > 7) {
      item.connector.style.left = `${anchorX}px`;
      item.connector.style.top = `${anchorY}px`;
      item.connector.style.width = `${length}px`;
      item.connector.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    }
  }

  bindNoteCardDrag(item, layerRect) {
    const { card, header, annotation } = item;
    if (!card || !header || !annotation) return;
    header.addClass('mupdf-reader-note-card-drag-handle');
    header.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target?.closest?.('button, input, textarea, a')) return;
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startY = event.clientY;
      const startLeft = Number.parseFloat(card.style.left) || 0;
      const startTop = Number.parseFloat(card.style.top) || 0;
      let currentLeft = startLeft;
      let currentTop = startTop;
      let moved = false;
      this.draggingNoteId = annotation.id;
      card.addClass('is-dragging');
      try { header.setPointerCapture?.(event.pointerId); } catch (_) {}

      const move = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        moved = true;
        const width = card.getBoundingClientRect().width || Number.parseFloat(card.style.width) || 260;
        const height = card.getBoundingClientRect().height || 120;
        currentLeft = clamp(startLeft + dx, 8, Math.max(8, layerRect.width - width - 8));
        currentTop = clamp(startTop + dy, 8, Math.max(8, layerRect.height - height - 8));
        card.style.left = `${currentLeft}px`;
        card.style.top = `${currentTop}px`;
        card.addClass('is-manual-layout');
        this.updateNoteCardGeometry(item, layerRect, currentLeft, currentTop, width, height);
      };

      const end = async (upEvent) => {
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', end, true);
        window.removeEventListener('pointercancel', end, true);
        try { header.releasePointerCapture?.(event.pointerId); } catch (_) {}
        card.removeClass('is-dragging');
        this.draggingNoteId = null;
        if (!moved) return;
        const refClient = this.annotationReferenceClient(annotation);
        if (!refClient) { this.requestNoteUiRender(); return; }
        const refX = refClient.x - layerRect.left;
        const refY = refClient.y - layerRect.top;
        const width = card.getBoundingClientRect().width || Number.parseFloat(card.style.width) || 260;
        const height = card.getBoundingClientRect().height || 120;
        const side = card.dataset.side === 'left' ? 'left' : 'right';
        const presentation = {
          ...(annotation.presentation || {}),
          placementMode: 'manual',
          side,
          offsetX: currentLeft - refX,
          offsetY: currentTop - refY,
          width: clamp(width, 180, 520),
          height: clamp(height, 80, 720)
        };
        await this.plugin.updateAnnotation(this.file.path, annotation.id, { presentation });
        this.annotations = this.plugin.getAnnotationsForFile(this.file.path);
        this.requestNoteUiRender();
      };

      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', end, true);
      window.addEventListener('pointercancel', end, true);
    });
  }

  renderNoteUi() {
    const layer = this.noteUiLayer;
    if (!layer || this.draggingNoteId) return;
    layer.empty();
    const mode = this.currentAnnotationDisplayMode();
    if (mode === 'hidden') return;
    const layerRect = layer.getBoundingClientRect();
    if (!layerRect.width || !layerRect.height) return;

    const visible = [];
    for (const annotation of this.annotations) {
      if (!this.annotationHasNote(annotation)) continue;
      const reference = this.annotationReferenceClient(annotation);
      if (!reference) continue;
      const refX = reference.x - layerRect.left;
      const refY = reference.y - layerRect.top;
      if (refY < -80 || refY > layerRect.height + 80) continue;
      visible.push({ annotation, reference, refX, refY });
    }

    const cards = [];
    for (const item of visible) {
      const { annotation, refX, refY } = item;
      const presentation = annotation.presentation || {};
      const marker = layer.createEl('button', { cls: `mupdf-reader-note-marker${annotation.type === 'note' ? ' is-free-note' : ''}${annotation.type === 'region' ? ' is-region-note' : ''}`, attr: { type: 'button', title: this.annotationPreview(annotation), 'aria-label': `批注：${this.annotationPreview(annotation)}` } });
      marker.dataset.color = annotation.color || 'yellow';
      if (annotation.presentation?.pinned) marker.addClass('is-pinned');
      marker.addEventListener('pointerdown', (event) => event.stopPropagation());
      marker.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); this.toggleAnnotationNote(annotation); });
      marker.addEventListener('dblclick', async (event) => { event.preventDefault(); event.stopPropagation(); await this.setAnnotationPinned(annotation, annotation.presentation?.pinned !== true); });

      const pinnedByMode = mode === 'all' || (mode === 'key' && annotation.presentation?.pinned === true);
      const shouldExpand = this.expandedNoteIds.has(annotation.id) || (pinnedByMode && !this.temporarilyCollapsedNoteIds.has(annotation.id));
      if (!shouldExpand) {
        const markerSide = presentation.side === 'left' || presentation.side === 'right' ? presentation.side : this.annotationNaturalSide(annotation);
        const anchor = this.annotationAnchorClient(annotation, markerSide);
        if (anchor) {
          marker.dataset.side = markerSide;
          marker.style.left = `${anchor.x - layerRect.left}px`;
          marker.style.top = `${anchor.y - layerRect.top}px`;
        }
        continue;
      }

      const card = layer.createDiv({ cls: 'mupdf-reader-note-card' });
      card.dataset.color = annotation.color || 'yellow';
      card.dataset.annotationId = annotation.id;
      card.addEventListener('pointerdown', (event) => event.stopPropagation());
      const header = card.createDiv({ cls: 'mupdf-reader-note-card-header' });
      const title = header.createDiv({ cls: 'mupdf-reader-note-card-title' });
      const dot = title.createSpan({ cls: 'mupdf-reader-note-card-dot' });
      dot.dataset.color = annotation.color || 'yellow';
      title.createSpan({ text: `${this.annotationTypeLabel(annotation.type)} · p.${annotation.page + 1}` });
      const controls = header.createDiv({ cls: 'mupdf-reader-note-card-controls' });
      if (presentation.placementMode === 'manual') {
        const resetBtn = createButton(controls, 'rotate-ccw', '恢复自动布局', async (event) => {
          event.stopPropagation();
          await this.resetAnnotationNoteLayout(annotation);
        });
        resetBtn.addClass('mupdf-reader-note-card-btn');
      }
      const pinBtn = createButton(controls, annotation.presentation?.pinned ? 'pin-off' : 'pin', annotation.presentation?.pinned ? '取消固定展开' : '固定展开', async (event) => {
        event.stopPropagation();
        await this.setAnnotationPinned(annotation, annotation.presentation?.pinned !== true);
      });
      pinBtn.addClass('mupdf-reader-note-card-btn');
      const editBtn = createButton(controls, 'pencil', annotation.type === 'region' ? '编辑区域摘录' : '编辑批注', (event) => { event.stopPropagation(); this.openAnnotationComment(annotation); });
      editBtn.addClass('mupdf-reader-note-card-btn');
      const closeBtn = createButton(controls, 'x', '收起', (event) => { event.stopPropagation(); this.toggleAnnotationNote(annotation); });
      closeBtn.addClass('mupdf-reader-note-card-btn');

      if (String(annotation.comment || '').trim()) card.createDiv({ cls: 'mupdf-reader-note-card-comment', text: annotation.comment.trim() });
      const tags = normalizeTags(annotation.tags || []);
      if (tags.length) {
        const tagsEl = card.createDiv({ cls: 'mupdf-reader-note-card-tags' });
        for (const tag of tags) tagsEl.createSpan({ cls: 'mupdf-reader-note-card-tag', text: `#${tag}` });
      }
      const requestedWidth = Number.isFinite(Number(presentation.width)) ? clamp(Number(presentation.width), 220, 420) : Math.min(286, Math.max(220, layerRect.width * 0.25));
      card.style.width = `${requestedWidth}px`;
      cards.push({ card, header, marker, annotation, refX, refY, requestedWidth, presentation, connector: null, side: 'right' });
    }

    const autoCards = cards.filter((item) => item.presentation?.placementMode !== 'manual' || !Number.isFinite(Number(item.presentation?.offsetX)) || !Number.isFinite(Number(item.presentation?.offsetY)));
    autoCards.sort((a, b) => a.refY - b.refY);
    const manualCards = cards.filter((item) => !autoCards.includes(item));
    const orderedCards = [...autoCards, ...manualCards];
    const lastBottom = { left: 8, right: 8 };

    for (const item of orderedCards) {
      const { card, annotation, presentation, refX, refY } = item;
      const width = card.getBoundingClientRect().width || item.requestedWidth || 260;
      const measuredHeight = Math.max(76, card.getBoundingClientRect().height || 120);
      let cardLeft;
      let top;
      let side;
      const isManual = presentation?.placementMode === 'manual' && Number.isFinite(Number(presentation.offsetX)) && Number.isFinite(Number(presentation.offsetY));
      if (isManual) {
        card.addClass('is-manual-layout');
        cardLeft = clamp(refX + Number(presentation.offsetX), 8, Math.max(8, layerRect.width - width - 8));
        top = clamp(refY + Number(presentation.offsetY), 8, Math.max(8, layerRect.height - measuredHeight - 8));
        side = cardLeft + width / 2 < refX ? 'left' : 'right';
      } else {
        side = presentation?.side === 'left' || presentation?.side === 'right' ? presentation.side : this.annotationNaturalSide(annotation);
        cardLeft = side === 'left' ? 12 : Math.max(12, layerRect.width - width - 12);
        top = Math.max(8, refY - 28);
        top = Math.max(top, lastBottom[side] + 8);
        if (top + measuredHeight > layerRect.height - 8) top = Math.max(8, layerRect.height - measuredHeight - 8);
        lastBottom[side] = top + measuredHeight;
      }
      card.style.left = `${cardLeft}px`;
      card.style.top = `${top}px`;
      item.side = side;
      item.connector = layer.createDiv({ cls: 'mupdf-reader-note-connector' });
      item.connector.dataset.color = annotation.color || 'yellow';
      item.connector.dataset.annotationId = annotation.id;
      this.updateNoteCardGeometry(item, layerRect, cardLeft, top, width, measuredHeight);

      const setActive = (active) => {
        item.connector?.toggleClass?.('is-active', active);
        item.marker?.toggleClass?.('is-linked-active', active);
        item.card?.toggleClass?.('is-linked-active', active);
      };
      card.addEventListener('mouseenter', () => setActive(true));
      card.addEventListener('mouseleave', () => setActive(false));
      item.marker.addEventListener('mouseenter', () => setActive(true));
      item.marker.addEventListener('mouseleave', () => setActive(false));
      this.bindNoteCardDrag(item, layerRect);
    }
  }

  async createFreeNoteAt(pageIndex, point) {
    const color = ANNOTATION_COLORS.includes(this.annotationColor) ? this.annotationColor : 'yellow';
    const draft = {
      id: null,
      type: 'note',
      page: pageIndex,
      x: Number(point[0]),
      y: Number(point[1]),
      text: '',
      quads: [],
      color,
      fingerprint: '',
      comment: '',
      tags: [],
      presentation: { pinned: false, side: 'auto' },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    const modal = new AnnotationCommentModal(this.app, {
      annotation: draft,
      previewSrc: draft.type === 'region' ? (draft.previewDataUrl || this.plugin.getRegionPreviewSrc(draft)) : '',
      fileName: this.file.name,
      pageNumber: pageIndex + 1,
      favoriteTags: this.plugin.settings?.favoriteTags || DEFAULT_FAVORITE_TAGS,
      allTags: this.plugin.getAllAnnotationTags(),
      onSave: async ({ comment, tags, pinned }) => {
        const annotation = { ...draft, id: this.plugin.createAnnotationId(), comment, tags, presentation: { ...draft.presentation, pinned } };
        await this.plugin.addAnnotation(this.file.path, annotation);
        this.annotations = this.plugin.getAnnotationsForFile(this.file.path);
        if (pinned) this.expandedNoteIds.add(annotation.id);
        this.drawAllAnnotations();
        new Notice('已添加 PDF 便签');
      }
    });
    modal.open();
  }

  showAnnotationColorMenu(event) {
    if (event?.preventDefault) event.preventDefault();
    const menu = new Menu();
    for (const color of ANNOTATION_COLORS) {
      const active = color === this.annotationColor;
      menu.addItem((item) => item
        .setTitle(`${active ? '✓ ' : ''}${this.annotationColorLabel(color)}`)
        .setIcon('circle')
        .onClick(() => {
          this.annotationColor = color;
          this.updateAnnotationColorButton();
        }));
    }
    if (event && typeof menu.showAtMouseEvent === 'function') menu.showAtMouseEvent(event);
  }

  onPageContextMenu(event, pageIndex) {
    const point = this.pagePointFromEvent(event, pageIndex);
    if (!point) return;

    const selectionHit = !!this.selection?.text && this.isPointInsideSelection(pageIndex, point);
    const annotationHit = this.findAnnotationAt(pageIndex, point);
    if (!selectionHit && !annotationHit) return;

    event.preventDefault();
    event.stopPropagation();
    const menu = new Menu();

    if (selectionHit) {
      const colorLabel = this.annotationColorLabel(this.annotationColor);
      menu.addItem((item) => item
        .setTitle(`高亮 · ${colorLabel}`)
        .setIcon('highlighter')
        .onClick(() => this.addAnnotationFromSelection('highlight', this.annotationColor)));
      menu.addItem((item) => item
        .setTitle(`下划线 · ${colorLabel}`)
        .setIcon('underline')
        .onClick(() => this.addAnnotationFromSelection('underline', this.annotationColor)));
      menu.addItem((item) => item
        .setTitle('添加批注（保存为高亮）')
        .setIcon('message-square-plus')
        .onClick(() => this.addCommentFromSelection()));
      menu.addItem((item) => item
        .setTitle(`翻译为${TRANSLATION_TARGET_LABELS[this.plugin.settings?.translationTarget] || '目标语言'}`)
        .setIcon('languages')
        .onClick(() => this.plugin.translatePayloadInPanel({ text: this.selection?.text || '', filePath: this.file.path, fileName: this.file.name, pageIndex, pageNumber: pageIndex + 1, selectionRect: this.selectionClientRect(pageIndex, this.selection?.quads || []) })));
      menu.addSeparator();
      menu.addItem((item) => item
        .setTitle('复制选中文字')
        .setIcon('copy')
        .onClick(() => this.copySelection()));
      menu.addItem((item) => item
        .setTitle('清除选区')
        .setIcon('x')
        .onClick(() => this.clearSelection()));
    } else if (annotationHit) {
      menu.addItem((item) => item
        .setTitle(annotationHit.type === 'note' ? '编辑便签' : annotationHit.type === 'region' ? '编辑区域摘录 / Tags' : (this.annotationHasNote(annotationHit) ? '编辑批注 / Tags' : '添加批注 / Tags'))
        .setIcon(annotationHit.type === 'note' ? 'sticky-note' : annotationHit.type === 'region' ? 'crop' : (this.annotationHasNote(annotationHit) ? 'message-square-text' : 'message-square-plus'))
        .onClick(() => this.openAnnotationComment(annotationHit)));
      if (this.annotationHasNote(annotationHit)) {
        menu.addItem((item) => item
          .setTitle(annotationHit.presentation?.pinned ? '取消关键记录固定展开' : '标记为关键记录并固定展开')
          .setIcon(annotationHit.presentation?.pinned ? 'pin-off' : 'pin')
          .onClick(() => this.setAnnotationPinned(annotationHit, annotationHit.presentation?.pinned !== true)));
      }
      if (annotationHit.presentation?.placementMode === 'manual') {
        menu.addItem((item) => item
          .setTitle('恢复批注自动布局')
          .setIcon('rotate-ccw')
          .onClick(() => this.resetAnnotationNoteLayout(annotationHit)));
      }
      if (annotationHit.text?.trim()) {
        menu.addItem((item) => item.setTitle('复制标注文字').setIcon('copy').onClick(() => this.copyAnnotationText(annotationHit)));
        menu.addItem((item) => item.setTitle('复制 Markdown 引用').setIcon('quote').onClick(() => this.plugin.copyAnnotationMarkdown(this.file.path, annotationHit)));
        menu.addItem((item) => item
          .setTitle(`翻译为${TRANSLATION_TARGET_LABELS[this.plugin.settings?.translationTarget] || '目标语言'}`)
          .setIcon('languages')
          .onClick(() => this.plugin.translatePayloadInPanel({ text: annotationHit.text || '', filePath: this.file.path, fileName: this.file.name, pageIndex, pageNumber: pageIndex + 1, selectionRect: this.selectionClientRect(pageIndex, annotationHit.quads || []) })));
      }
      if (annotationHit.type === 'region' && this.plugin.getRegionPreviewSrc(annotationHit)) {
        menu.addItem((item) => item.setTitle('复制区域图片').setIcon('image').onClick(() => this.copyRegionImage(annotationHit)));
        menu.addItem((item) => item.setTitle('复制 Markdown 引用').setIcon('quote').onClick(() => this.plugin.copyAnnotationMarkdown(this.file.path, annotationHit)));
      }

      if (!['note', 'region'].includes(annotationHit.type)) {
        menu.addSeparator();
        const otherType = annotationHit.type === 'underline' ? 'highlight' : 'underline';
        menu.addItem((item) => item
          .setTitle(`转换为${this.annotationTypeLabel(otherType)}`)
          .setIcon(otherType === 'underline' ? 'underline' : 'highlighter')
          .onClick(() => this.updateAnnotation(annotationHit, { type: otherType })));
      }

      for (const color of ANNOTATION_COLORS) {
        if (color === annotationHit.color) continue;
        menu.addItem((item) => item.setTitle(`改为${this.annotationColorLabel(color)}`).setIcon('circle').onClick(() => this.updateAnnotation(annotationHit, { color })));
      }

      menu.addSeparator();
      menu.addItem((item) => item
        .setTitle(annotationHit.type === 'note' ? '删除便签' : annotationHit.type === 'region' ? '删除区域摘录' : '删除标注')
        .setIcon('trash-2')
        .onClick(() => this.deleteAnnotation(annotationHit)));
    }
    menu.showAtMouseEvent(event);
  }

  annotationPathData(pageIndex, quads) {
    const size = this.pageSizes[pageIndex];
    if (!size) return '';
    const ox = size.x || 0;
    const oy = size.y || 0;
    const pathParts = [];
    for (const quad of quads || []) {
      if (!Array.isArray(quad) || quad.length < 8) continue;
      const p0 = [quad[0] - ox, quad[1] - oy];
      const p1 = [quad[2] - ox, quad[3] - oy];
      const p2 = [quad[6] - ox, quad[7] - oy];
      const p3 = [quad[4] - ox, quad[5] - oy];
      pathParts.push(`M ${p0[0]} ${p0[1]} L ${p1[0]} ${p1[1]} L ${p2[0]} ${p2[1]} L ${p3[0]} ${p3[1]} Z`);
    }
    return pathParts.join(' ');
  }

  underlinePathData(pageIndex, quads) {
    const size = this.pageSizes[pageIndex];
    if (!size) return '';
    const ox = size.x || 0;
    const oy = size.y || 0;
    const parts = [];
    for (const quad of quads || []) {
      if (!Array.isArray(quad) || quad.length < 8) continue;
      // Selection quads are seamless visual line bands, whose bottom edge sits near
      // the midpoint to the next text row.  An underline should hug the glyphs, not
      // that row boundary, so place it ~79% from the band's top edge toward bottom.
      const t = 0.79;
      const x1 = (quad[0] + (quad[4] - quad[0]) * t) - ox;
      const y1 = (quad[1] + (quad[5] - quad[1]) * t) - oy;
      const x2 = (quad[2] + (quad[6] - quad[2]) * t) - ox;
      const y2 = (quad[3] + (quad[7] - quad[3]) * t) - oy;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const inset = Math.min(0.8, len * 0.04);
      parts.push(`M ${x1 + dx / len * inset} ${y1 + dy / len * inset} L ${x2 - dx / len * inset} ${y2 - dy / len * inset}`);
    }
    return parts.join(' ');
  }

  drawAllAnnotations() {
    if (!this.pageNodes.length) return;
    for (let pageIndex = 0; pageIndex < this.pageNodes.length; pageIndex++) {
      const svg = this.pageNodes[pageIndex].annotationSvg;
      if (!svg) continue;
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const pageAnnotations = this.annotations.filter((annotation) => ['highlight', 'underline', 'region'].includes(annotation.type) && annotation.page === pageIndex);
      for (const annotation of pageAnnotations) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('data-annotation-id', annotation.id);
        path.setAttribute('data-color', annotation.color || 'yellow');
        if (annotation.type === 'region') {
          const bounds = this.annotationBoundsPdf(annotation);
          const size = this.pageSizes[pageIndex];
          if (!bounds || !size) continue;
          const ox = size.x || 0, oy = size.y || 0;
          const x = bounds.minX - ox, y = bounds.minY - oy;
          const w = Math.max(0.1, bounds.maxX - bounds.minX), h = Math.max(0.1, bounds.maxY - bounds.minY);
          path.setAttribute('d', `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`);
          path.setAttribute('class', 'mupdf-reader-annotation mupdf-reader-region-clip');
          path.setAttribute('fill', 'none');
          path.setAttribute('vector-effect', 'non-scaling-stroke');
        } else if (annotation.type === 'underline') {
          const d = this.underlinePathData(pageIndex, annotation.quads);
          if (!d) continue;
          path.setAttribute('d', d);
          path.setAttribute('class', 'mupdf-reader-annotation mupdf-reader-underline-path');
          path.setAttribute('fill', 'none');
          path.setAttribute('vector-effect', 'non-scaling-stroke');
        } else {
          const d = this.annotationPathData(pageIndex, annotation.quads);
          if (!d) continue;
          path.setAttribute('d', d);
          path.setAttribute('fill-rule', 'nonzero');
          path.setAttribute('class', 'mupdf-reader-annotation mupdf-reader-highlight-quad');
        }
        svg.appendChild(path);

      }
    }
    this.requestNoteUiRender();
  }

  findAnnotationAt(pageIndex, point) {
    if (!point) return null;
    const [x, y] = point;
    const padding = 1.8;
    const markerPadding = Math.max(4, 9 / Math.max(0.2, BASE_SCALE * this.zoom));
    for (let i = this.annotations.length - 1; i >= 0; i--) {
      const annotation = this.annotations[i];
      if (annotation.page !== pageIndex) continue;
      const anchor = this.annotationHasNote(annotation) ? this.annotationAnchorPdf(annotation) : null;
      if (anchor && Math.hypot(x - anchor[0], y - anchor[1]) <= markerPadding) return annotation;
      if (annotation.type === 'region') {
        const bounds = this.annotationBoundsPdf(annotation);
        if (bounds && x >= bounds.minX - padding && x <= bounds.maxX + padding && y >= bounds.minY - padding && y <= bounds.maxY + padding) return annotation;
        continue;
      }
      if (!['highlight', 'underline'].includes(annotation.type)) continue;
      for (const quad of annotation.quads || []) {
        if (!Array.isArray(quad) || quad.length < 8) continue;
        const xs = [quad[0], quad[2], quad[4], quad[6]];
        const ys = [quad[1], quad[3], quad[5], quad[7]];
        const minX = Math.min(...xs) - padding;
        const maxX = Math.max(...xs) + padding;
        const minY = Math.min(...ys) - padding;
        const maxY = Math.max(...ys) + padding;
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) return annotation;
      }
    }
    return null;
  }

  selectionFingerprint(selection) {
    const coords = (selection?.quads || []).flat().map((value) => Math.round(Number(value) * 10) / 10);
    return `${selection?.pageIndex ?? -1}|${String(selection?.text || '').trim()}|${coords.join(',')}`;
  }

  async addAnnotationFromSelection(type = 'highlight', color = 'yellow') {
    const selection = this.selection;
    if (!selection?.text || !selection.quads?.length) return;
    const cleanType = type === 'underline' ? 'underline' : 'highlight';
    const cleanColor = ANNOTATION_COLORS.includes(color) ? color : 'yellow';
    const fingerprint = this.selectionFingerprint(selection);
    const existing = this.annotations.find((annotation) => annotation.fingerprint === fingerprint);

    try {
      if (existing) {
        await this.plugin.updateAnnotation(this.file.path, existing.id, { type: cleanType, color: cleanColor, text: selection.text, quads: selection.quads.map((quad) => quad.slice()) });
        this.annotations = this.plugin.getAnnotationsForFile(this.file.path);
        this.drawAllAnnotations();
        this.clearSelection(false);
        new Notice(`已更新为${this.annotationColorLabel(cleanColor)}${this.annotationTypeLabel(cleanType)}`);
        return;
      }

      const annotation = {
        id: this.plugin.createAnnotationId(),
        type: cleanType,
        page: selection.pageIndex,
        text: selection.text,
        quads: selection.quads.map((quad) => quad.slice()),
        color: cleanColor,
        fingerprint,
        comment: '',
        tags: [],
        presentation: { pinned: false, side: 'auto' },
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await this.plugin.addAnnotation(this.file.path, annotation);
      this.annotations = this.plugin.getAnnotationsForFile(this.file.path);
      this.drawAllAnnotations();
      this.clearSelection(false);
      new Notice(`已添加${this.annotationColorLabel(cleanColor)}${this.annotationTypeLabel(cleanType)}`);
    } catch (error) {
      console.error('[MuPDF Reader] failed to save annotation', error);
      new Notice('标注保存失败');
    }
  }

  openAnnotationComment(annotation) {
    if (!annotation?.id) return;
    const modal = new AnnotationCommentModal(this.app, {
      annotation,
      previewSrc: annotation.type === 'region' ? this.plugin.getRegionPreviewSrc(annotation) : '',
      fileName: this.file.name,
      pageNumber: annotation.page + 1,
      favoriteTags: this.plugin.settings?.favoriteTags || DEFAULT_FAVORITE_TAGS,
      allTags: this.plugin.getAllAnnotationTags(),
      onSave: async ({ comment, tags, pinned }) => {
        await this.plugin.updateAnnotation(this.file.path, annotation.id, {
          comment,
          tags,
          presentation: { ...(annotation.presentation || {}), pinned }
        });
        this.annotations = this.plugin.getAnnotationsForFile(this.file.path);
        this.temporarilyCollapsedNoteIds.delete(annotation.id);
        if (pinned) this.expandedNoteIds.add(annotation.id);
        this.drawAllAnnotations();
        new Notice(annotation.type === 'note' ? '已更新便签' : annotation.type === 'region' ? '已更新区域摘录' : '已更新批注');
      },
      onClear: async ({ tags, pinned } = {}) => {
        if (annotation.type === 'note') {
          await this.plugin.removeAnnotation(this.file.path, annotation.id);
          this.expandedNoteIds.delete(annotation.id);
          this.temporarilyCollapsedNoteIds.delete(annotation.id);
          this.annotations = this.plugin.getAnnotationsForFile(this.file.path);
          this.drawAllAnnotations();
          new Notice('已删除便签');
          return;
        }
        await this.plugin.updateAnnotation(this.file.path, annotation.id, {
          comment: '',
          tags: normalizeTags(tags || annotation.tags || []),
          presentation: { ...(annotation.presentation || {}), pinned: !!pinned }
        });
        this.annotations = this.plugin.getAnnotationsForFile(this.file.path);
        this.drawAllAnnotations();
        new Notice(annotation.type === 'region' ? '已清空区域摘录说明' : '已删除批注内容');
      }
    });
    modal.open();
  }

  addCommentFromSelection() {
    const selection = this.selection;
    if (!selection?.text || !selection.quads?.length) return;
    const fingerprint = this.selectionFingerprint(selection);
    const existing = this.annotations.find((annotation) => annotation.fingerprint === fingerprint);
    if (existing) {
      this.openAnnotationComment(existing);
      return;
    }

    const draft = {
      id: null,
      type: 'highlight',
      page: selection.pageIndex,
      text: selection.text,
      quads: selection.quads.map((quad) => quad.slice()),
      color: ANNOTATION_COLORS.includes(this.annotationColor) ? this.annotationColor : 'yellow',
      fingerprint,
      comment: '',
      tags: [],
      presentation: { pinned: false, side: 'auto' },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const modal = new AnnotationCommentModal(this.app, {
      annotation: draft,
      previewSrc: draft.type === 'region' ? (draft.previewDataUrl || this.plugin.getRegionPreviewSrc(draft)) : '',
      fileName: this.file.name,
      pageNumber: selection.pageIndex + 1,
      favoriteTags: this.plugin.settings?.favoriteTags || DEFAULT_FAVORITE_TAGS,
      allTags: this.plugin.getAllAnnotationTags(),
      onSave: async ({ comment, tags, pinned }) => {
        const annotation = { ...draft, id: this.plugin.createAnnotationId(), comment, tags, presentation: { ...draft.presentation, pinned } };
        await this.plugin.addAnnotation(this.file.path, annotation);
        this.annotations = this.plugin.getAnnotationsForFile(this.file.path);
        if (pinned) this.expandedNoteIds.add(annotation.id);
        this.drawAllAnnotations();
        this.clearSelection(false);
        new Notice('已添加批注');
      }
    });
    modal.open();
  }

  async copyRegionImage(annotation) {
    try {
      const blob = await this.plugin.getRegionPreviewBlob(annotation);
      if (!blob) { new Notice('这条区域摘录没有可复制的预览图'); return; }
      if (navigator.clipboard?.write && globalThis.ClipboardItem) {
        const pngBlob = blob.type === 'image/png' ? blob : await (async () => {
          const url = URL.createObjectURL(blob);
          try {
            const img = new Image();
            img.src = url;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = img.naturalWidth; c.height = img.naturalHeight;
            c.getContext('2d').drawImage(img, 0, 0);
            return await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
          } finally { URL.revokeObjectURL(url); }
        })();
        if (pngBlob) {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
          new Notice('已复制区域图片');
          return;
        }
      }
      new Notice('当前系统不支持直接复制图片，可在研究侧栏查看区域摘录');
    } catch (error) {
      console.error('[MuPDF Reader] copy region image failed', error);
      new Notice('复制区域图片失败');
    }
  }

  async updateAnnotation(annotation, patch) {
    if (!annotation?.id) return;
    try {
      await this.plugin.updateAnnotation(this.file.path, annotation.id, patch);
      this.annotations = this.plugin.getAnnotationsForFile(this.file.path);
      this.drawAllAnnotations();
      new Notice('已更新标注');
    } catch (error) {
      console.error('[MuPDF Reader] failed to update annotation', error);
      new Notice('更新标注失败');
    }
  }

  async deleteAnnotation(annotation) {
    if (!annotation?.id) return;
    try {
      await this.plugin.removeAnnotation(this.file.path, annotation.id);
      this.expandedNoteIds.delete(annotation.id);
      this.temporarilyCollapsedNoteIds.delete(annotation.id);
      this.annotations = this.plugin.getAnnotationsForFile(this.file.path);
      this.drawAllAnnotations();
      new Notice('已删除标注');
    } catch (error) {
      console.error('[MuPDF Reader] failed to delete annotation', error);
      new Notice('删除标注失败');
    }
  }

  async copyAnnotationText(annotation) {
    const text = annotation?.text;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      new Notice('已复制标注文字');
    } catch (error) {
      console.error('[MuPDF Reader] clipboard write failed', error);
      new Notice('复制失败，请重试');
    }
  }

  drawSelection(pageIndex, quads) {
    for (let i = 0; i < this.pageNodes.length; i++) {
      const svg = this.pageNodes[i].selectionSvg;
      if (!svg) continue;
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      if (i !== pageIndex) continue;
      const d = this.annotationPathData(i, quads);
      if (!d) continue;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill-rule', 'nonzero');
      path.setAttribute('class', 'mupdf-reader-selection-quad');
      svg.appendChild(path);
    }
  }

  clearSelection(resetStatus = true) {
    this.selectionSeq++;
    this.plugin.translationPanel?.clearPendingSelection();
    this.selection = null;
    for (const node of this.pageNodes) {
      const svg = node.selectionSvg;
      if (!svg) continue;
      while (svg.firstChild) svg.removeChild(svg.firstChild);
    }
    this.selectionActions?.addClass('is-hidden');
    if (resetStatus && this.pageSizes.length) this.setStatus(`${this.pageSizes.length} 页 · MuPDF ${MUPDF_VERSION}`);
  }

  async copySelection() {
    const text = this.selection?.text;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      new Notice('已复制选中文字');
    } catch (error) {
      console.error('[MuPDF Reader] clipboard write failed', error);
      new Notice('复制失败，请重试');
    }
  }

  onScroll() {
    if (this.scrollRaf) return;
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = 0;
      this.updateCurrentPage();
      this.evictFarPages();
      this.queueVisibleDetailTiles();
      this.renderNoteUi();
      this.readingPositionSaveDebounced();
    });
  }

  updateCurrentPage() {
    if (!this.pageNodes.length) return;
    const rootRect = this.scrollEl.getBoundingClientRect();
    const targetY = rootRect.top + 48;
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < this.pageNodes.length; i++) {
      const rect = this.pageNodes[i].shell.getBoundingClientRect();
      if (rect.bottom < rootRect.top || rect.top > rootRect.bottom) continue;
      const distance = Math.abs(rect.top - targetY);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    if (bestIndex !== this.currentPage) this.currentPage = bestIndex;
    this.pageInput.value = String(this.currentPage + 1);
  }

  goToPage(pageNumber, behavior = 'smooth') {
    if (!this.pageNodes.length) return;
    const page = clamp(Math.round(Number(pageNumber) || 1), 1, this.pageNodes.length);
    this.currentPage = page - 1;
    this.pageInput.value = String(page);
    this.pageNodes[this.currentPage].shell.scrollIntoView({ behavior, block: 'start' });
    this.queueRender(this.currentPage, true);
    this.readingPositionSaveDebounced();
  }

  getReadingPosition() {
    if (!this.pageNodes.length || !this.scrollEl) return { page: this.currentPage || 0, ratio: 0, zoom: this.zoom };
    const page = clamp(this.currentPage, 0, this.pageNodes.length - 1);
    const shell = this.pageNodes[page]?.shell;
    if (!shell) return { page, ratio: 0, zoom: this.zoom };
    const top = shell.offsetTop;
    const height = Math.max(1, shell.offsetHeight);
    const ratio = clamp((this.scrollEl.scrollTop - top) / height, 0, 0.98);
    return { page, ratio, zoom: this.zoom, updatedAt: Date.now() };
  }

  persistReadingPosition() {
    if (this.destroyed || this.plugin.settings?.rememberReadingPosition === false) return;
    this.plugin.rememberReadingPosition(this.file.path, this.getReadingPosition());
  }

  restoreReadingPosition() {
    if (this.plugin.settings?.rememberReadingPosition === false) return;
    const saved = this.plugin.getReadingPosition(this.file.path);
    if (!saved || !this.pageNodes.length) return;
    const page = clamp(Math.round(Number(saved.page) || 0), 0, this.pageNodes.length - 1);
    requestAnimationFrame(() => {
      const shell = this.pageNodes[page]?.shell;
      if (!shell || !this.scrollEl) return;
      const ratio = clamp(Number(saved.ratio) || 0, 0, 0.98);
      this.scrollEl.scrollTop = shell.offsetTop + shell.offsetHeight * ratio;
      this.currentPage = page;
      this.pageInput.value = String(page + 1);
      this.queueRender(page, true);
    });
  }

  async getOutline() {
    if (this.outlineCache) return this.outlineCache;
    if (!this.worker || !this.docId) return [];
    try {
      this.outlineCache = await this.worker.call('getOutline', [this.docId]) || [];
    } catch (error) {
      console.error('[MuPDF Reader] outline load failed', error);
      this.outlineCache = [];
    }
    return this.outlineCache;
  }

  async searchDocument(query, onProgress = null) {
    const needle = String(query || '').trim();
    const epoch = (this.searchState?.epoch || 0) + 1;
    this.searchState = { query: needle, results: [], activeIndex: -1, epoch };
    this.drawSearchHighlights();
    if (!needle || !this.worker || !this.docId) return [];
    const results = [];
    for (let page = 0; page < this.pageSizes.length; page++) {
      if (this.destroyed || this.searchState.epoch !== epoch) break;
      let groups = [];
      try { groups = await this.worker.call('searchPage', [this.docId, page, needle, 320]); }
      catch (error) { console.error('[MuPDF Reader] page search failed', page, error); }
      for (const quads of groups || []) {
        if (Array.isArray(quads) && quads.length) results.push({ page, quads: quads.map((q) => Array.isArray(q) ? q.slice() : q) });
      }
      if (typeof onProgress === 'function') {
        try { onProgress(page + 1, this.pageSizes.length, results.length); } catch (_) {}
      }
      if (page % 8 === 7) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (this.searchState.epoch !== epoch) return [];
    this.searchState = { query: needle, results, activeIndex: results.length ? 0 : -1, epoch };
    this.drawSearchHighlights();
    if (results.length) this.focusSearchResult(0, 'auto');
    return results.map((item, index) => ({ ...item, index }));
  }

  clearSearch() {
    const epoch = (this.searchState?.epoch || 0) + 1;
    this.searchState = { query: '', results: [], activeIndex: -1, epoch };
    this.drawSearchHighlights();
  }

  drawSearchHighlights() {
    for (const node of this.pageNodes || []) {
      const svg = node.searchSvg;
      if (svg) while (svg.firstChild) svg.removeChild(svg.firstChild);
    }
    const results = this.searchState?.results || [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const svg = this.pageNodes?.[result.page]?.searchSvg;
      if (!svg) continue;
      const d = this.annotationPathData(result.page, result.quads);
      if (!d) continue;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill-rule', 'nonzero');
      path.setAttribute('class', `mupdf-reader-search-hit${i === this.searchState.activeIndex ? ' is-active' : ''}`);
      svg.appendChild(path);
    }
  }

  focusSearchResult(index, behavior = 'smooth') {
    const results = this.searchState?.results || [];
    if (!results.length) return;
    const next = ((Number(index) || 0) % results.length + results.length) % results.length;
    this.searchState.activeIndex = next;
    const result = results[next];
    this.goToPage(result.page + 1, behavior);
    this.drawSearchHighlights();
    const node = this.pageNodes[result.page];
    if (node?.shell) {
      window.setTimeout(() => {
        node.searchSvg?.querySelector('.is-active')?.classList.add('is-flash');
        window.setTimeout(() => node.searchSvg?.querySelector('.is-active')?.classList.remove('is-flash'), 700);
      }, behavior === 'smooth' ? 320 : 30);
    }
  }

  focusAnnotation(annotationId, behavior = 'smooth') {
    const annotation = this.annotations.find((item) => item.id === annotationId);
    if (!annotation) return false;
    this.goToPage(annotation.page + 1, behavior);
    if (this.annotationHasNote(annotation)) {
      this.expandedNoteIds.add(annotation.id);
      this.temporarilyCollapsedNoteIds.delete(annotation.id);
    }
    window.setTimeout(() => {
      this.drawAllAnnotations();
      const path = this.pageNodes?.[annotation.page]?.annotationSvg?.querySelector(`[data-annotation-id="${CSS.escape(annotation.id)}"]`);
      if (path) {
        path.classList.add('is-focus-flash');
        window.setTimeout(() => path.classList.remove('is-focus-flash'), 1100);
      }
      this.requestNoteUiRender();
    }, behavior === 'smooth' ? 340 : 40);
    return true;
  }

  renderVisible(force = false) {
    const rootRect = this.scrollEl.getBoundingClientRect();
    for (let i = 0; i < this.pageNodes.length; i++) {
      const rect = this.pageNodes[i].shell.getBoundingClientRect();
      if (rect.bottom >= rootRect.top - 900 && rect.top <= rootRect.bottom + 900) {
        this.queueRender(i, force);
      }
    }
  }

  rerenderVisible() {
    if (this.destroyed) return;
    this.renderVisible(true);
  }

  makeRenderKey(index) {
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    return `${index}:${this.zoom.toFixed(4)}:${dpr.toFixed(2)}`;
  }

  queueRender(index, force) {
    if (this.destroyed || !this.docId || !this.pageNodes[index]) return;
    const state = this.pageState[index];
    const key = this.makeRenderKey(index);
    if (!force && (state.renderKey === key || state.queuedKey === key)) {
      state.lastUsed = performance.now();
      return;
    }
    if (state.queuedKey === key) return;
    state.queuedKey = key;
    const epoch = this.renderEpoch;
    this.renderQueue.push({ index, key, epoch });
    this.pumpRenderQueue();
  }

  async pumpRenderQueue() {
    if (this.rendering || this.destroyed) return;
    this.rendering = true;
    try {
      while (this.renderQueue.length && !this.destroyed) {
        const job = this.renderQueue.shift();
        const { index, key, epoch } = job;
        const state = this.pageState[index];
        if (!state || state.queuedKey !== key) continue;
        if (epoch !== this.renderEpoch && key !== this.makeRenderKey(index)) {
          state.queuedKey = null;
          continue;
        }
        try {
          await this.renderPage(index, key);
        } catch (error) {
          console.error('[MuPDF Reader] render failed', error);
          state.queuedKey = null;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      this.rendering = false;
    }
  }

  async renderPage(index, key) {
    const size = this.pageSizes[index];
    const state = this.pageState[index];
    const node = this.pageNodes[index];
    if (!size || !state || !node) return;
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    // Render slightly above the physical display density. Fractional zoom levels can
    // otherwise land on awkward bitmap/CSS ratios and Chromium has to upscale or
    // resample text, which is visible as softness on Retina/HiDPI screens.
    const physicalPixelScale = BASE_SCALE * this.zoom * dpr;
    const requestedPixelScale = physicalPixelScale * PAGE_RENDER_OVERSAMPLE;
    node.shell.addClass('is-rendering');

    const result = await this.worker.call('renderPage', [this.docId, index, requestedPixelScale, MAX_RENDER_PIXELS]);
    if (this.destroyed) return;
    const currentKey = this.makeRenderKey(index);
    if (key !== currentKey) {
      state.queuedKey = null;
      return;
    }

    const canvas = node.canvas;
    canvas.width = result.width;
    canvas.height = result.height;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    const pixels = result.pixels instanceof Uint8ClampedArray ? result.pixels : new Uint8ClampedArray(result.pixels);
    const imageData = new ImageData(pixels, result.width, result.height);
    ctx.putImageData(imageData, 0, 0);
    state.renderKey = key;
    state.queuedKey = null;
    state.lastUsed = performance.now();
    state.pixelScale = Number(result.pixelScale) || 0;
    // The full-page renderer has a memory cap. At high zoom / large page sizes it
    // intentionally returns a lower-resolution backing bitmap. Detect that case and
    // overlay only the visible viewport with full-density MuPDF tiles.
    state.detailRequired = state.pixelScale + 1e-4 < physicalPixelScale * 1.01;
    node.shell.toggleClass('has-detail-tiles', state.detailRequired);
    node.shell.removeClass('is-rendering');
    if (state.detailRequired) this.queueDetailTilesForPage(index);
    else this.clearDetailTilesForPage(index);
  }

  clearDetailTilesForPage(index) {
    const state = this.pageState?.[index];
    const layer = this.pageNodes?.[index]?.detailLayer;
    if (layer) layer.empty();
    if (state?.detailTiles) state.detailTiles.clear();
  }

  clearAllDetailTiles() {
    this.detailRenderQueue.length = 0;
    for (let i = 0; i < (this.pageNodes?.length || 0); i++) this.clearDetailTilesForPage(i);
  }

  queueVisibleDetailTiles() {
    if (this.destroyed || !this.scrollEl) return;
    const rootRect = this.scrollEl.getBoundingClientRect();
    for (let i = 0; i < this.pageNodes.length; i++) {
      const state = this.pageState[i];
      if (!state?.detailRequired) continue;
      const rect = this.pageNodes[i].shell.getBoundingClientRect();
      if (rect.bottom < rootRect.top - DETAIL_TILE_MARGIN_CSS || rect.top > rootRect.bottom + DETAIL_TILE_MARGIN_CSS ||
          rect.right < rootRect.left - DETAIL_TILE_MARGIN_CSS || rect.left > rootRect.right + DETAIL_TILE_MARGIN_CSS) {
        this.clearDetailTilesForPage(i);
        continue;
      }
      this.queueDetailTilesForPage(i, rootRect);
    }
  }

  queueDetailTilesForPage(index, suppliedRootRect = null) {
    const state = this.pageState?.[index];
    const node = this.pageNodes?.[index];
    const size = this.pageSizes?.[index];
    if (!state?.detailRequired || !node?.detailLayer || !size || this.destroyed) return;
    const pageRect = node.shell.getBoundingClientRect();
    const rootRect = suppliedRootRect || this.scrollEl.getBoundingClientRect();
    if (pageRect.width < 1 || pageRect.height < 1) return;

    const left = Math.max(pageRect.left, rootRect.left - DETAIL_TILE_MARGIN_CSS);
    const right = Math.min(pageRect.right, rootRect.right + DETAIL_TILE_MARGIN_CSS);
    const top = Math.max(pageRect.top, rootRect.top - DETAIL_TILE_MARGIN_CSS);
    const bottom = Math.min(pageRect.bottom, rootRect.bottom + DETAIL_TILE_MARGIN_CSS);
    if (!(right > left && bottom > top)) return;

    const cssScale = Math.max(0.01, BASE_SCALE * this.zoom);
    const tilePt = DETAIL_TILE_CSS_SIZE / cssScale;
    const ox = Number(size.x) || 0;
    const oy = Number(size.y) || 0;
    const pdfX0 = ox + ((left - pageRect.left) / pageRect.width) * size.width;
    const pdfX1 = ox + ((right - pageRect.left) / pageRect.width) * size.width;
    const pdfY0 = oy + ((top - pageRect.top) / pageRect.height) * size.height;
    const pdfY1 = oy + ((bottom - pageRect.top) / pageRect.height) * size.height;
    const tx0 = Math.max(0, Math.floor((pdfX0 - ox) / tilePt));
    const ty0 = Math.max(0, Math.floor((pdfY0 - oy) / tilePt));
    const tx1 = Math.max(tx0, Math.floor(Math.max(0, pdfX1 - ox - 1e-6) / tilePt));
    const ty1 = Math.max(ty0, Math.floor(Math.max(0, pdfY1 - oy - 1e-6) / tilePt));
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    const targetPixelScale = BASE_SCALE * this.zoom * dpr * PAGE_RENDER_OVERSAMPLE;
    const wanted = new Set();
    const epoch = this.renderEpoch;

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const rawX0 = ox + tx * tilePt;
        const rawY0 = oy + ty * tilePt;
        const rawX1 = Math.min(ox + size.width, rawX0 + tilePt);
        const rawY1 = Math.min(oy + size.height, rawY0 + tilePt);
        if (!(rawX1 > rawX0 && rawY1 > rawY0)) continue;
        const key = `${epoch}:${this.zoom.toFixed(4)}:${dpr.toFixed(2)}:${tx}:${ty}`;
        wanted.add(key);
        if (state.detailTiles.has(key)) continue;
        const record = { key, status: 'queued', canvas: null, epoch, rect: [rawX0, rawY0, rawX1, rawY1] };
        state.detailTiles.set(key, record);
        this.detailRenderQueue.push({ index, key, epoch, rect: record.rect, targetPixelScale });
      }
    }

    for (const [key, record] of Array.from(state.detailTiles.entries())) {
      if (wanted.has(key)) continue;
      record.canvas?.remove?.();
      state.detailTiles.delete(key);
    }
    this.pumpDetailRenderQueue();
  }

  async pumpDetailRenderQueue() {
    if (this.detailRendering || this.destroyed) return;
    this.detailRendering = true;
    try {
      while (this.detailRenderQueue.length && !this.destroyed) {
        const job = this.detailRenderQueue.shift();
        const state = this.pageState?.[job.index];
        const node = this.pageNodes?.[job.index];
        const size = this.pageSizes?.[job.index];
        const record = state?.detailTiles?.get(job.key);
        if (!state?.detailRequired || !node?.detailLayer || !size || !record || record.epoch !== this.renderEpoch || job.epoch !== this.renderEpoch) continue;
        record.status = 'rendering';
        try {
          const pointWidth = Math.max(0.5, job.rect[2] - job.rect[0]);
          const pointHeight = Math.max(0.5, job.rect[3] - job.rect[1]);
          const result = await this.worker.call('renderRegion', [this.docId, job.index, job.rect, {
            maxWidth: Math.ceil(pointWidth * job.targetPixelScale) + 4,
            maxHeight: Math.ceil(pointHeight * job.targetPixelScale) + 4,
            maxPixels: DETAIL_TILE_MAX_PIXELS,
            maxScale: job.targetPixelScale
          }]);
          if (this.destroyed || record.epoch !== this.renderEpoch || !state.detailTiles.has(job.key)) continue;
          const canvas = document.createElement('canvas');
          canvas.className = 'mupdf-reader-detail-tile';
          canvas.width = result.width;
          canvas.height = result.height;
          const ctx = canvas.getContext('2d', { alpha: true });
          if (!ctx) continue;
          const pixels = result.pixels instanceof Uint8ClampedArray ? result.pixels : new Uint8ClampedArray(result.pixels);
          ctx.putImageData(new ImageData(pixels, result.width, result.height), 0, 0);
          const rect = Array.isArray(result.rect) ? result.rect : job.rect;
          canvas.style.left = `${((rect[0] - (Number(size.x) || 0)) / size.width) * 100}%`;
          canvas.style.top = `${((rect[1] - (Number(size.y) || 0)) / size.height) * 100}%`;
          canvas.style.width = `${((rect[2] - rect[0]) / size.width) * 100}%`;
          canvas.style.height = `${((rect[3] - rect[1]) / size.height) * 100}%`;
          record.canvas?.remove?.();
          record.canvas = canvas;
          record.status = 'ready';
          node.detailLayer.appendChild(canvas);
        } catch (error) {
          // Keep the capped full-page bitmap as a graceful fallback if a detail tile
          // fails. One tile failure must never make the page unreadable.
          console.warn('[MuPDF Reader] detail tile render failed', error);
          state.detailTiles.delete(job.key);
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      this.detailRendering = false;
    }
  }

  evictFarPages() {
    const rendered = [];
    const rootRect = this.scrollEl.getBoundingClientRect();
    for (let i = 0; i < this.pageState.length; i++) {
      const state = this.pageState[i];
      if (!state.renderKey) continue;
      const rect = this.pageNodes[i].shell.getBoundingClientRect();
      const distance = rect.bottom < rootRect.top ? rootRect.top - rect.bottom : rect.top > rootRect.bottom ? rect.top - rootRect.bottom : 0;
      rendered.push({ index: i, distance, lastUsed: state.lastUsed });
    }
    if (rendered.length <= MAX_RENDERED_PAGES) return;
    rendered.sort((a, b) => b.distance - a.distance || a.lastUsed - b.lastUsed);
    for (const item of rendered.slice(0, rendered.length - MAX_RENDERED_PAGES)) {
      if (item.distance < 1200) continue;
      const canvas = this.pageNodes[item.index].canvas;
      canvas.width = 1;
      canvas.height = 1;
      this.clearDetailTilesForPage(item.index);
      this.pageState[item.index].renderKey = null;
      this.pageState[item.index].detailRequired = false;
    }
  }

  async destroy() {
    this.persistReadingPosition();
    this.destroyed = true;
    this.observer?.disconnect();
    this.annotationUnsubscribe?.();
    this.annotationUnsubscribe = null;
    if (this.scrollRaf) cancelAnimationFrame(this.scrollRaf);
    if (this.selectionRaf) cancelAnimationFrame(this.selectionRaf);
    if (this.noteUiRaf) cancelAnimationFrame(this.noteUiRaf);
    if (this.worker && this.docId) {
      try { await this.worker.call('closeDocument', [this.docId]); } catch (_) {}
    }
    this.worker?.terminate();
    this.worker = null;
    this.docId = null;
    this.renderQueue.length = 0;
    this.detailRenderQueue.length = 0;
    this.clearAllDetailTiles();
  }
}

class MuPdfReaderView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.filePath = null;
    this.initialZoom = 1;
    this.reader = null;
    this.loadToken = 0;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() {
    if (!this.filePath) return 'MuPDF Reader';
    const name = this.filePath.split('/').pop() || this.filePath;
    return `MuPDF · ${name}`;
  }
  getIcon() { return 'file-text'; }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass('mupdf-reader-host');
    this.contentEl.createDiv({ cls: 'mupdf-reader-empty', text: '选择一个 PDF，然后使用命令 “Open active PDF in MuPDF Reader”。' });
    if (this.filePath) await this.loadFile();
  }

  async setState(state, result) {
    this.filePath = typeof state?.file === 'string' ? state.file : null;
    this.initialZoom = clamp(Number(state?.zoom) || 1, MIN_ZOOM, MAX_ZOOM);
    if (this.contentEl?.isConnected) await this.loadFile();
    return super.setState ? super.setState(state, result) : undefined;
  }

  getState() {
    return { file: this.filePath, zoom: this.reader?.zoom || this.initialZoom || 1 };
  }

  async loadFile() {
    const token = ++this.loadToken;
    if (this.reader) {
      await this.reader.destroy();
      this.reader = null;
    }
    this.contentEl.empty();
    if (!this.filePath) {
      this.contentEl.createDiv({ cls: 'mupdf-reader-empty', text: '没有选择 PDF。' });
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'pdf') {
      this.contentEl.createDiv({ cls: 'mupdf-reader-empty', text: `找不到 PDF：${this.filePath}` });
      return;
    }
    const reader = new PdfReader(this, this.contentEl, file, this.initialZoom);
    this.reader = reader;
    try {
      await reader.init();
      this.plugin.lastReaderFilePath = file.path;
      if (token !== this.loadToken) await reader.destroy();
    } catch (error) {
      console.error('[MuPDF Reader] Failed to load', error);
    }
  }

  async onClose() {
    ++this.loadToken;
    if (this.reader) await this.reader.destroy();
    this.reader = null;
  }
}


class MuPdfResearchSidebarView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    const saved = plugin.researchSidebarState || {};
    this.tab = ['annotations', 'outline', 'search'].includes(saved.tab) ? saved.tab : 'annotations';
    this.scope = saved.scope === 'all' ? 'all' : 'current';
    this.annotationQuery = String(saved.annotationQuery || '');
    this.tagFilter = String(saved.tagFilter || '');
    this.searchQuery = String(saved.searchQuery || '');
    this.searchResults = Array.isArray(saved.searchResults) ? saved.searchResults.slice() : [];
    this.searching = false;
    this.searchProgress = String(saved.searchProgress || '');
    this.unsubscribeAnnotations = null;
    this.workspaceRef = null;
    this.contextFilePath = '';
  }

  getViewType() { return SIDEBAR_VIEW_TYPE; }
  getDisplayText() { return 'MuPDF 研究'; }
  getIcon() { return 'panel-right'; }

  snapshotState() {
    return {
      tab: this.tab,
      scope: this.scope,
      annotationQuery: this.annotationQuery,
      tagFilter: this.tagFilter,
      searchQuery: this.searchQuery,
      searchResults: Array.isArray(this.searchResults) ? this.searchResults.slice() : [],
      searchProgress: this.searchProgress
    };
  }

  saveUiState() {
    this.plugin.researchSidebarState = this.snapshotState();
  }

  async onOpen() {
    this.contentEl.addClass('mupdf-research-sidebar');
    this.unsubscribeAnnotations = this.plugin.subscribeAnnotations(() => this.render());
    this.contextFilePath = this.currentFilePath();
    this.workspaceRef = this.app.workspace.on('active-leaf-change', (leaf) => {
      const type = leaf?.view?.getViewType?.();
      const directReaderPath = type === VIEW_TYPE && leaf?.view?.filePath ? leaf.view.filePath : '';
      if (directReaderPath) this.plugin.lastReaderFilePath = directReaderPath;
      const nextPath = directReaderPath || this.plugin.lastReaderFilePath || this.currentFilePath();

      // Do not rebuild the entire sidebar just because focus moved between the PDF
      // leaf and this sidebar. Recreating the DOM also recreates Region <img> nodes,
      // which makes separately stored previews visibly flash while the browser
      // decodes/repaints them again. Only a genuine PDF context change needs a rerender.
      if (nextPath && nextPath !== this.contextFilePath) {
        this.contextFilePath = nextPath;
        this.render();
      }
    });
    this.render();
  }

  async onClose() {
    this.saveUiState();
    this.unsubscribeAnnotations?.();
    this.unsubscribeAnnotations = null;
    if (this.workspaceRef) this.app.workspace.offref(this.workspaceRef);
    this.workspaceRef = null;
  }

  setTab(tab) {
    if (!['annotations', 'outline', 'search'].includes(tab)) tab = 'annotations';
    this.tab = tab;
    this.saveUiState();
    this.render();
  }

  currentFilePath() {
    return this.plugin.getCurrentReaderFilePath() || this.plugin.lastReaderFilePath || '';
  }

  render() {
    const root = this.contentEl;
    this.contextFilePath = this.currentFilePath();
    root.empty();
    const head = root.createDiv({ cls: 'mupdf-research-head' });
    const headRow = head.createDiv({ cls: 'mupdf-research-head-row' });
    const headText = headRow.createDiv({ cls: 'mupdf-research-head-text' });
    headText.createDiv({ cls: 'mupdf-research-title', text: 'MuPDF 研究' });
    const current = this.currentFilePath();
    headText.createDiv({ cls: 'mupdf-research-file', text: current ? (current.split('/').pop() || current) : '未关联 PDF' });
    const pin = headRow.createEl('button', { cls: `mupdf-research-pin-toggle${this.plugin.settings?.researchSidebarPinned ? ' is-active' : ''}`, attr: { type: 'button', title: this.plugin.settings?.researchSidebarPinned ? '取消侧栏常驻' : '常驻研究侧栏', 'aria-label': this.plugin.settings?.researchSidebarPinned ? '取消侧栏常驻' : '常驻研究侧栏' } });
    setIcon(pin, 'pin');
    pin.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const pinned = !this.plugin.settings?.researchSidebarPinned;
      await this.plugin.updateSettings({ researchSidebarPinned: pinned });

      // When this button is clicked the sidebar itself is usually the active leaf.
      // Unpinning must therefore re-evaluate the *main* workspace context instead
      // of treating the sidebar as the current document. If the underlying main
      // view is not a MuPDF Reader this may detach this view immediately.
      if (!pinned) await this.plugin.syncResearchSidebarVisibility?.();

      // If the sidebar remains visible (e.g. the main view is still a PDF), refresh
      // immediately so the Pin icon/title never looks stuck in the old state.
      const stillOpen = this.plugin.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE)
        .some((leaf) => leaf?.view === this);
      if (stillOpen) this.render();
    });

    const tabs = root.createDiv({ cls: 'mupdf-research-tabs' });
    for (const [id, label, icon] of [['annotations','批注','messages-square'], ['outline','目录','list-tree'], ['search','搜索','search']]) {
      const btn = tabs.createEl('button', { cls: `mupdf-research-tab${this.tab === id ? ' is-active' : ''}`, attr: { type: 'button', 'aria-label': label, title: label } });
      setIcon(btn, icon);
      btn.createSpan({ text: label });
      btn.addEventListener('click', () => this.setTab(id));
    }
    const body = root.createDiv({ cls: 'mupdf-research-body' });
    if (this.tab === 'outline') this.renderOutline(body);
    else if (this.tab === 'search') this.renderSearch(body);
    else this.renderAnnotations(body);
  }

  renderAnnotations(body) {
    const controls = body.createDiv({ cls: 'mupdf-research-controls' });
    const scope = controls.createDiv({ cls: 'mupdf-research-segmented' });
    for (const [value, label] of [['current','当前 PDF'], ['all','全部 PDF']]) {
      const btn = scope.createEl('button', { text: label, cls: this.scope === value ? 'is-active' : '', attr: { type: 'button' } });
      btn.addEventListener('click', () => { this.scope = value; this.tagFilter = ''; this.saveUiState(); this.render(); });
    }
    const search = controls.createEl('input', { cls: 'mupdf-research-filter', attr: { type: 'search', placeholder: '筛选批注、原文或 Tag…', value: this.annotationQuery } });
    search.value = this.annotationQuery;
    search.addEventListener('input', () => { this.annotationQuery = search.value; this.saveUiState(); this.renderAnnotationsList(body.querySelector('.mupdf-research-list-host')); });

    const tags = body.createDiv({ cls: 'mupdf-research-tags' });
    const allItems = this.getScopedAnnotations();
    const tagSet = new Set();
    for (const item of allItems) for (const tag of normalizeTags(item.annotation.tags || [])) tagSet.add(tag);
    if (tagSet.size) {
      const all = tags.createEl('button', { text: '全部', cls: `mupdf-research-tag${!this.tagFilter ? ' is-active' : ''}`, attr: { type: 'button' } });
      all.addEventListener('click', () => { this.tagFilter = ''; this.saveUiState(); this.render(); });
      for (const tag of Array.from(tagSet).sort((a,b) => a.localeCompare(b, 'zh-CN'))) {
        const btn = tags.createEl('button', { text: `#${tag}`, cls: `mupdf-research-tag${this.tagFilter === tag ? ' is-active' : ''}`, attr: { type: 'button' } });
        btn.addEventListener('click', () => { this.tagFilter = this.tagFilter === tag ? '' : tag; this.render(); });
      }
    }
    const host = body.createDiv({ cls: 'mupdf-research-list-host' });
    this.renderAnnotationsList(host);
  }

  getScopedAnnotations() {
    const rows = [];
    if (this.scope === 'all') {
      rows.push(...this.plugin.getAllAnnotations());
    } else {
      const filePath = this.currentFilePath();
      for (const annotation of this.plugin.getAnnotationsForFile(filePath)) rows.push({ filePath, annotation });
    }
    return rows;
  }

  renderAnnotationsList(host) {
    if (!host) return;
    host.empty();
    const q = this.annotationQuery.trim().toLocaleLowerCase();
    const rows = this.getScopedAnnotations().filter(({ filePath, annotation }) => {
      if (this.tagFilter && !normalizeTags(annotation.tags || []).includes(this.tagFilter)) return false;
      if (!q) return true;
      const hay = [filePath, annotation.text, annotation.comment, ...(annotation.tags || [])].join(' ').toLocaleLowerCase();
      return hay.includes(q);
    }).sort((a,b) => a.filePath.localeCompare(b.filePath, 'zh-CN') || a.annotation.page - b.annotation.page || a.annotation.createdAt - b.annotation.createdAt);
    if (!rows.length) {
      host.createDiv({ cls: 'mupdf-research-empty', text: '没有符合条件的批注。' });
      return;
    }
    let lastFile = null;
    let lastPageKey = null;
    for (const row of rows) {
      if (this.scope === 'all' && row.filePath !== lastFile) {
        lastFile = row.filePath;
        lastPageKey = null;
        host.createDiv({ cls: 'mupdf-research-file-group', text: row.filePath.split('/').pop() || row.filePath });
      }
      const pageKey = `${row.filePath}:${row.annotation.page}`;
      if (pageKey !== lastPageKey) {
        lastPageKey = pageKey;
        host.createDiv({ cls: 'mupdf-research-page-group', text: `第 ${row.annotation.page + 1} 页` });
      }
      this.renderAnnotationRow(host, row.filePath, row.annotation);
    }
  }

  renderAnnotationRow(host, filePath, annotation) {
    const row = host.createDiv({ cls: 'mupdf-research-annotation-row' });
    row.dataset.color = annotation.color || 'yellow';
    const top = row.createDiv({ cls: 'mupdf-research-annotation-top' });
    const kind = top.createDiv({ cls: 'mupdf-research-annotation-kind' });
    const dot = kind.createSpan({ cls: `mupdf-research-annotation-dot${annotation.type === 'note' ? ' is-note' : ''}${annotation.type === 'region' ? ' is-region' : ''}` });
    dot.dataset.color = annotation.color || 'yellow';
    kind.createSpan({ text: annotation.type === 'note' ? '便签' : annotation.type === 'region' ? '区域摘录' : annotation.type === 'underline' ? '下划线' : '高亮' });
    if (annotation.presentation?.pinned) {
      const star = kind.createSpan({ cls: 'mupdf-research-pin' });
      setIcon(star, 'star');
    }
    const actions = top.createDiv({ cls: 'mupdf-research-row-actions' });
    const copy = actions.createEl('button', { attr: { type: 'button', title: '复制 Markdown 引用', 'aria-label': '复制 Markdown 引用' } });
    setIcon(copy, 'copy');
    copy.addEventListener('click', async (event) => { event.stopPropagation(); await this.plugin.copyAnnotationMarkdown(filePath, annotation); });
    const edit = actions.createEl('button', { attr: { type: 'button', title: '编辑批注', 'aria-label': '编辑批注' } });
    setIcon(edit, 'pencil');
    edit.addEventListener('click', async (event) => { event.stopPropagation(); await this.plugin.openAnnotationEditor(filePath, annotation.id); });

    if (annotation.type === 'region') {
      const previewSrc = this.plugin.getRegionPreviewSrc(annotation);
      if (previewSrc) {
        const preview = row.createDiv({ cls: 'mupdf-research-region-preview' });
        const img = preview.createEl('img', { attr: { src: previewSrc, alt: `第 ${annotation.page + 1} 页区域摘录` } });
        img.draggable = false;
      }
    }
    if (annotation.comment?.trim()) row.createDiv({ cls: 'mupdf-research-comment', text: annotation.comment.trim() });
    if (annotation.text?.trim()) row.createDiv({ cls: 'mupdf-research-quote', text: annotation.text.trim().replace(/\s+/g, ' ') });
    const tags = normalizeTags(annotation.tags || []);
    if (tags.length) {
      const tagRow = row.createDiv({ cls: 'mupdf-research-row-tags' });
      for (const tag of tags) tagRow.createSpan({ text: `#${tag}` });
    }
    row.addEventListener('click', () => this.plugin.navigateToAnnotation(filePath, annotation.id));
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const menu = new Menu();
      menu.addItem((item) => item.setTitle('定位到标注').setIcon('locate-fixed').onClick(() => this.plugin.navigateToAnnotation(filePath, annotation.id)));
      menu.addItem((item) => item.setTitle('编辑批注').setIcon('pencil').onClick(() => this.plugin.openAnnotationEditor(filePath, annotation.id)));
      menu.addItem((item) => item.setTitle('复制 Markdown 引用').setIcon('copy').onClick(() => this.plugin.copyAnnotationMarkdown(filePath, annotation)));
      menu.showAtMouseEvent(event);
    });
  }

  async renderOutline(body) {
    const filePath = this.currentFilePath();
    if (!filePath) { body.createDiv({ cls: 'mupdf-research-empty', text: '请先打开一个 MuPDF Reader。' }); return; }
    const loading = body.createDiv({ cls: 'mupdf-research-empty', text: '正在读取 PDF 目录…' });
    const reader = await this.plugin.ensureReader(filePath, false);
    if (!reader) { loading.setText('当前 PDF Reader 尚未就绪。'); return; }
    const outline = await reader.getOutline();
    if (!loading.isConnected) return;
    body.empty();
    if (!outline?.length) { body.createDiv({ cls: 'mupdf-research-empty', text: '这份 PDF 没有可用目录。' }); return; }
    const tree = body.createDiv({ cls: 'mupdf-research-outline' });
    const renderNodes = (parent, items, depth = 0) => {
      for (const item of items || []) {
        const row = parent.createEl('button', { cls: 'mupdf-research-outline-row', attr: { type: 'button' } });
        row.style.setProperty('--outline-depth', String(depth));
        const icon = row.createSpan({ cls: 'mupdf-research-outline-icon' });
        setIcon(icon, item.down?.length ? 'chevron-right' : 'minus');
        row.createSpan({ cls: 'mupdf-research-outline-title', text: item.title || '未命名' });
        if (Number.isInteger(item.page) && item.page >= 0) row.createSpan({ cls: 'mupdf-research-outline-page', text: String(item.page + 1) });
        row.addEventListener('click', () => { if (Number.isInteger(item.page) && item.page >= 0) reader.goToPage(item.page + 1); });
        if (item.down?.length) renderNodes(parent, item.down, depth + 1);
      }
    };
    renderNodes(tree, outline, 0);
  }

  renderSearch(body) {
    const filePath = this.currentFilePath();
    if (!filePath) { body.createDiv({ cls: 'mupdf-research-empty', text: '请先打开一个 MuPDF Reader。' }); return; }
    const form = body.createDiv({ cls: 'mupdf-research-searchbar' });
    const input = form.createEl('input', { attr: { type: 'search', placeholder: '搜索当前 PDF…' } });
    input.value = this.searchQuery;
    const button = form.createEl('button', { attr: { type: 'button', title: '搜索' } });
    setIcon(button, 'search');
    const clear = form.createEl('button', { attr: { type: 'button', title: '清除搜索' } });
    setIcon(clear, 'x');
    const status = body.createDiv({ cls: 'mupdf-research-search-status', text: this.searchProgress || (this.searchResults.length ? `${this.searchResults.length} 个结果` : '') });
    const results = body.createDiv({ cls: 'mupdf-research-search-results' });
    const renderResults = () => {
      results.empty();
      if (!this.searchResults.length) {
        if (this.searchQuery && !this.searching) results.createDiv({ cls: 'mupdf-research-empty', text: '没有匹配结果。' });
        return;
      }
      this.searchResults.forEach((result, index) => {
        const row = results.createEl('button', { cls: 'mupdf-research-search-row', attr: { type: 'button' } });
        row.createSpan({ text: `第 ${result.page + 1} 页` });
        row.createSpan({ cls: 'mupdf-research-search-index', text: `#${index + 1}` });
        row.addEventListener('click', async () => {
          const reader = await this.plugin.ensureReader(filePath, false);
          reader?.focusSearchResult(index);
        });
      });
    };
    renderResults();
    const run = async () => {
      const query = input.value.trim();
      this.searchQuery = query;
      if (!query) { this.searchResults = []; this.searchProgress = ''; const reader = await this.plugin.ensureReader(filePath, false); reader?.clearSearch(); status.setText(''); renderResults(); return; }
      this.searching = true;
      this.searchProgress = '准备搜索…';
      status.setText(this.searchProgress);
      button.disabled = true;
      try {
        const reader = await this.plugin.ensureReader(filePath, false);
        if (!reader) throw new Error('Reader 尚未就绪');
        this.searchResults = await reader.searchDocument(query, (done, total, count) => {
          this.searchProgress = `${done}/${total} 页 · ${count} 个结果`;
          if (status.isConnected) status.setText(this.searchProgress);
        });
        this.searchProgress = `${this.searchResults.length} 个结果`;
        status.setText(this.searchProgress);
        renderResults();
      } catch (error) {
        this.searchProgress = `搜索失败：${error?.message || String(error)}`;
        status.setText(this.searchProgress);
      } finally {
        this.searching = false;
        button.disabled = false;
      }
    };
    button.addEventListener('click', run);
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); run(); } });
    clear.addEventListener('click', async () => { input.value = ''; this.searchQuery = ''; this.searchResults = []; this.searchProgress = ''; const reader = await this.plugin.ensureReader(filePath, false); reader?.clearSearch(); status.setText(''); renderResults(); });
    window.setTimeout(() => input.focus(), 0);
  }
}


class MuPdfTranslationFloatingPanel {
  constructor(plugin) {
    this.plugin = plugin;
    this.historyLimit = 50;
    this.entrySeq = 0;
    this.rootEl = null;
    this.bodyEl = null;
    this.latestEl = null;
    this.historyEl = null;
    this.historySectionEl = null;
    this.historyCountEl = null;
    this.emptyEl = null;
    this.currentCard = null;
    this.autoButton = null;
    this.followButton = null;
    this.pinButton = null;
    this.blockStatusEl = null;
    this.providerStatusEl = null;
    this.resizeObserver = null;
    this.pendingSelectionTimer = 0;
    this.pendingSelectionPayload = null;
    this.requestController = null;
    this.lastPayload = null;
    this.persistGeometryDebounced = debounce(() => this.persistGeometry(), 350);
    this.onViewportResize = () => this.clampToViewport(true);
  }

  isOpen() { return !!this.rootEl?.isConnected; }

  open() {
    if (this.isOpen()) {
      this.rootEl.classList.add('is-attention');
      window.setTimeout(() => this.rootEl?.classList.remove('is-attention'), 220);
      return this;
    }
    this.buildPanel();
    window.addEventListener('resize', this.onViewportResize);
    return this;
  }

  clearPendingSelection() {
    if (this.pendingSelectionTimer) window.clearTimeout(this.pendingSelectionTimer);
    this.pendingSelectionTimer = 0;
    this.pendingSelectionPayload = null;
  }

  async close(options = {}) {
    const preservePin = !!options.preservePin;
    this.clearPendingSelection();
    this.cancelTranslation();
    if (!preservePin && this.plugin.settings?.translationPanelPinned) {
      await this.plugin.updateSettings({ translationPanelPinned: false });
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener('resize', this.onViewportResize);
    this.rootEl?.remove();
    this.rootEl = null;
    this.bodyEl = null;
    this.latestEl = null;
    this.historyEl = null;
    this.historySectionEl = null;
    this.historyCountEl = null;
    this.emptyEl = null;
    this.currentCard = null;
    this.autoButton = null;
    this.followButton = null;
    this.pinButton = null;
    this.blockStatusEl = null;
    this.providerStatusEl = null;
    this.syncReaderButton();
    this.lastPayload = null;
  }

  destroy() {
    this.clearPendingSelection();
    this.cancelTranslation();
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.onViewportResize);
    this.rootEl?.remove();
    this.rootEl = null;
    this.syncReaderButton();
  }

  syncReaderButton() {
    for (const button of document.querySelectorAll('.mupdf-reader-translate-btn')) {
      button.setAttribute('aria-expanded', String(this.isOpen()));
      button.setAttribute('aria-controls', 'workbench-translation');
      button.classList.toggle('is-active', this.isOpen());
    }
  }

  cancelTranslation() {
    this.requestController?.abort(new DOMException('翻译已停止', 'AbortError'));
    this.requestController = null;
    if (this.currentCard?.classList.contains('mupdf-entry-state-loading')) {
      this.currentCard.remove(); this.currentCard = null;
    }
  }

  buildPanel() {
    const root = document.body.createDiv({ cls: 'mupdf-translate-float mupdf-translate-v070' });
    this.rootEl = root;
    root.id = 'workbench-translation';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'MuPDF 划词翻译');
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !event.target.closest('select, input, textarea')) {
        event.preventDefault(); event.stopPropagation(); void this.close();
      }
    });
    this.applySavedGeometry();
    this.applyVisualSettings();

    const header = root.createDiv({ cls: 'mupdf-translate-float-header' });
    const titleWrap = header.createDiv({ cls: 'mupdf-translate-float-title-wrap' });
    const titleIcon = titleWrap.createSpan({ cls: 'mupdf-translate-float-title-icon' });
    setIcon(titleIcon, 'languages');
    titleWrap.createSpan({ cls: 'mupdf-translate-float-title', text: '划词翻译' });

    const controls = header.createDiv({ cls: 'mupdf-translate-float-controls' });
    this.autoButton = createButton(controls, 'zap', '自动划词翻译', () => this.toggleAutoTranslate());
    this.autoButton.addClass('mupdf-translate-float-icon-btn');
    this.followButton = createButton(controls, 'move', '跟随选区', () => this.toggleFollowSelection());
    this.followButton.addClass('mupdf-translate-float-icon-btn');
    this.pinButton = createButton(controls, 'pin', 'Pin 常驻', () => this.togglePin());
    this.pinButton.addClass('mupdf-translate-float-icon-btn');
    createButton(controls, 'trash-2', '清空翻译记录', () => this.clearHistory()).addClass('mupdf-translate-float-icon-btn');
    createButton(controls, 'settings-2', '翻译设置', () => this.plugin.openTranslationSettings?.()).addClass('mupdf-translate-float-icon-btn');
    createButton(controls, 'x', '关闭翻译窗', () => this.close()).addClass('mupdf-translate-float-icon-btn');
    this.updateAutoButton();
    this.updateFollowButton();
    this.updatePinButton();
    this.bindDrag(header);

    const statusbar = root.createDiv({ cls: 'mupdf-translate-statusbar' });
    this.blockStatusEl = statusbar.createDiv({ cls: 'mupdf-tools-translation-status' });
    this.providerStatusEl = statusbar.createDiv({ cls: 'mupdf-translate-provider-pill' });
    this.targetSelect = this.blockStatusEl.createEl('select', { attr: { 'aria-label': '翻译目标语言', title: '翻译目标语言' } });
    for (const [value, text] of Object.entries(TRANSLATION_TARGET_LABELS)) this.targetSelect.createEl('option', { value, text });
    this.providerSelect = this.providerStatusEl.createEl('select', { attr: { 'aria-label': '翻译服务', title: '翻译服务' } });
    for (const [value, text] of Object.entries(TRANSLATION_PROVIDER_LABELS)) this.providerSelect.createEl('option', { value, text });
    const change = async (key, value) => {
      this.cancelTranslation(); this.clearPendingSelection();
      try {
        await this.plugin.updateSettings({ [key]: value });
        if (this.lastPayload) await this.handleSelection(this.lastPayload, { force: true });
      } catch (error) { new Notice(error.message || String(error)); }
    };
    this.targetSelect.onchange = () => change('translationTarget', this.targetSelect.value);
    this.providerSelect.onchange = () => change('translationProvider', this.providerSelect.value);
    this.updateBlockStatus();

    const body = root.createDiv({ cls: 'mupdf-translate-float-body' });
    this.bodyEl = body;

    const latestSection = body.createDiv({ cls: 'mupdf-translate-section mupdf-translate-latest-section' });
    const latestHeading = latestSection.createDiv({ cls: 'mupdf-translate-section-heading' });
    latestHeading.createSpan({ text: '当前译文' });
    this.latestEl = latestSection.createDiv({ cls: 'mupdf-translate-latest' });

    this.historySectionEl = body.createDiv({ cls: 'mupdf-translate-section mupdf-translate-history-section is-hidden' });
    const historyHeading = this.historySectionEl.createDiv({ cls: 'mupdf-translate-section-heading' });
    historyHeading.createSpan({ text: '历史' });
    this.historyCountEl = historyHeading.createSpan({ cls: 'mupdf-translate-history-count', text: '0' });
    this.historyEl = this.historySectionEl.createDiv({ cls: 'mupdf-translate-float-history mupdf-tools-translation-history' });
    this.renderEmpty();
    this.syncReaderButton();

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.persistGeometryDebounced());
      this.resizeObserver.observe(root);
    }
    requestAnimationFrame(() => this.clampToViewport(false));
  }

  applyVisualSettings() {
    if (!this.rootEl) return;
    const size = clamp(Math.round(Number(this.plugin.settings?.translationFontSize) || 15), 12, 24);
    this.rootEl.style.setProperty('--mupdf-translation-font-size', `${size}px`);
    this.rootEl.style.setProperty('--mupdf-translation-source-font-size', `${Math.max(11, size - 2)}px`);
  }

  applySavedGeometry() {
    if (!this.rootEl) return;
    const width = clamp(Number(this.plugin.settings?.translationPanelWidth) || 420, Math.min(300, window.innerWidth - 16), window.innerWidth - 16);
    const height = clamp(Number(this.plugin.settings?.translationPanelHeight) || 540, Math.min(220, window.innerHeight - 16), window.innerHeight - 16);
    const savedX = this.plugin.settings?.translationPanelX;
    const savedY = this.plugin.settings?.translationPanelY;
    const rawX = savedX == null ? NaN : Number(savedX);
    const rawY = savedY == null ? NaN : Number(savedY);
    const x = Number.isFinite(rawX) ? rawX : Math.max(8, window.innerWidth - width - 24);
    const toolBottom = document.querySelector('.mupdf-reader-toolbar')?.getBoundingClientRect().bottom || 80;
    const minY = Math.min(toolBottom + 8, Math.max(8, window.innerHeight - height - 8));
    const y = Number.isFinite(rawY) ? Math.max(rawY, minY) : minY;
    this.rootEl.style.width = `${width}px`;
    this.rootEl.style.height = `${height}px`;
    this.rootEl.style.left = `${clamp(x, 8, Math.max(8, window.innerWidth - width - 8))}px`;
    this.rootEl.style.top = `${clamp(y, 8, Math.max(8, window.innerHeight - height - 8))}px`;
  }

  clampToViewport(persist = false) {
    if (!this.rootEl) return;
    const rect = this.rootEl.getBoundingClientRect();
    const width = clamp(rect.width, Math.min(300, window.innerWidth - 16), window.innerWidth - 16);
    const height = clamp(rect.height, Math.min(220, window.innerHeight - 16), window.innerHeight - 16);
    const left = clamp(rect.left, 8, Math.max(8, window.innerWidth - width - 8));
    const top = clamp(rect.top, 8, Math.max(8, window.innerHeight - height - 8));
    this.rootEl.style.width = `${width}px`;
    this.rootEl.style.height = `${height}px`;
    this.rootEl.style.left = `${left}px`;
    this.rootEl.style.top = `${top}px`;
    if (persist) this.persistGeometryDebounced();
  }

  positionNearSelection(selectionRect) {
    if (!this.rootEl || !this.plugin.settings?.translationPanelFollowSelection || !selectionRect) return;
    const panel = this.rootEl.getBoundingClientRect();
    const sel = selectionRect;
    if (![sel.left, sel.top, sel.right, sel.bottom].every(Number.isFinite)) return;
    const gap = 14;
    const margin = 8;
    let left;
    if (sel.right + gap + panel.width <= window.innerWidth - margin) {
      left = sel.right + gap;
    } else if (sel.left - gap - panel.width >= margin) {
      left = sel.left - gap - panel.width;
    } else {
      left = clamp(window.innerWidth - panel.width - 20, margin, Math.max(margin, window.innerWidth - panel.width - margin));
    }
    let top = clamp(sel.top - 22, margin, Math.max(margin, window.innerHeight - panel.height - margin));
    const overlaps = !(left + panel.width < sel.left || left > sel.right || top + panel.height < sel.top || top > sel.bottom);
    if (overlaps) {
      if (sel.bottom + gap + panel.height <= window.innerHeight - margin) top = sel.bottom + gap;
      else if (sel.top - gap - panel.height >= margin) top = sel.top - gap - panel.height;
    }
    this.rootEl.style.left = `${clamp(left, margin, Math.max(margin, window.innerWidth - panel.width - margin))}px`;
    this.rootEl.style.top = `${clamp(top, margin, Math.max(margin, window.innerHeight - panel.height - margin))}px`;
  }

  bindDrag(handle) {
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button, input, select, a')) return;
      if (!this.rootEl) return;
      event.preventDefault();
      const rect = this.rootEl.getBoundingClientRect();
      const dx = event.clientX - rect.left;
      const dy = event.clientY - rect.top;
      this.rootEl.addClass('is-dragging');
      let moved = false;
      const move = (moveEvent) => {
        if (!this.rootEl) return;
        moved = true;
        const width = this.rootEl.getBoundingClientRect().width;
        const height = this.rootEl.getBoundingClientRect().height;
        const left = clamp(moveEvent.clientX - dx, 8, Math.max(8, window.innerWidth - width - 8));
        const top = clamp(moveEvent.clientY - dy, 8, Math.max(8, window.innerHeight - height - 8));
        this.rootEl.style.left = `${left}px`;
        this.rootEl.style.top = `${top}px`;
      };
      const finish = async () => {
        document.removeEventListener('pointermove', move, true);
        document.removeEventListener('pointerup', finish, true);
        document.removeEventListener('pointercancel', finish, true);
        this.rootEl?.removeClass('is-dragging');
        if (moved && this.plugin.settings?.translationPanelFollowSelection) {
          await this.plugin.updateSettings({ translationPanelFollowSelection: false });
          this.updateFollowButton();
        }
        this.persistGeometry();
      };
      document.addEventListener('pointermove', move, true);
      document.addEventListener('pointerup', finish, true);
      document.addEventListener('pointercancel', finish, true);
    });
  }

  persistGeometry() {
    if (!this.rootEl?.isConnected) return;
    const rect = this.rootEl.getBoundingClientRect();
    this.plugin.persistTranslationPanelGeometry({
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    });
  }

  updateAutoButton() {
    if (!this.autoButton) return;
    const enabled = !!this.plugin.settings?.translationAutoEnabled;
    this.autoButton.toggleClass('is-active', enabled);
    this.autoButton.setAttribute('aria-pressed', String(enabled));
    this.autoButton.setAttribute('aria-label', enabled ? '自动翻译已开启，点击暂停' : '自动翻译已暂停，点击开启');
    this.autoButton.setAttribute('title', enabled ? '自动翻译：已开启' : '自动翻译：已暂停');
    this.autoButton.empty();
    setIcon(this.autoButton, enabled ? 'zap' : 'zap-off');
  }

  updateFollowButton() {
    if (!this.followButton) return;
    const follow = !!this.plugin.settings?.translationPanelFollowSelection;
    this.followButton.toggleClass('is-active', follow);
    this.followButton.setAttribute('aria-pressed', String(follow));
    this.followButton.setAttribute('aria-label', follow ? '翻译窗跟随选区，点击固定位置' : '翻译窗固定位置，点击跟随选区');
    this.followButton.setAttribute('title', follow ? '跟随选区：已开启（拖动窗口会自动切回固定）' : '跟随选区：已关闭');
    this.followButton.empty();
    setIcon(this.followButton, follow ? 'locate-fixed' : 'move');
  }

  updatePinButton() {
    if (!this.pinButton) return;
    const pinned = !!this.plugin.settings?.translationPanelPinned;
    this.pinButton.toggleClass('is-active', pinned);
    this.pinButton.setAttribute('aria-pressed', String(pinned));
    this.pinButton.setAttribute('aria-label', pinned ? '已 Pin 常驻，点击取消' : 'Pin 常驻');
    this.pinButton.setAttribute('title', pinned ? '已 Pin：切换标签后仍保持，下次启动自动恢复' : 'Pin：保持常驻并在下次启动恢复');
    this.pinButton.empty();
    setIcon(this.pinButton, pinned ? 'pin-off' : 'pin');
    this.rootEl?.toggleClass('is-pinned', pinned);
  }

  updateBlockStatus() {
    if (!this.blockStatusEl) return;
    if (this.targetSelect) this.targetSelect.value = this.plugin.settings?.translationTarget || DEFAULT_SETTINGS.translationTarget;
    if (this.providerSelect) this.providerSelect.value = this.plugin.settings?.translationProvider || DEFAULT_SETTINGS.translationProvider;
  }

  async toggleAutoTranslate() {
    const enabled = !this.plugin.settings?.translationAutoEnabled;
    await this.plugin.updateSettings({ translationAutoEnabled: enabled });
    if (!enabled) { this.clearPendingSelection(); this.cancelTranslation(); this.renderEmpty(); }
    this.updateAutoButton();
    this.updateBlockStatus();
    if (enabled && this.lastPayload) this.queueSelection(this.lastPayload);
  }

  async toggleFollowSelection() {
    const follow = !this.plugin.settings?.translationPanelFollowSelection;
    await this.plugin.updateSettings({ translationPanelFollowSelection: follow });
    this.updateFollowButton();
    new Notice(follow ? '翻译窗将跟随新的选区' : '翻译窗已固定在当前位置');
  }

  async togglePin() {
    const pinned = !this.plugin.settings?.translationPanelPinned;
    await this.plugin.updateSettings({ translationPanelPinned: pinned });
    this.updatePinButton();
    if (pinned) this.persistGeometry();
    new Notice(pinned ? '翻译窗已 Pin 常驻' : '翻译窗已取消 Pin');
  }

  renderEmpty() {
    if (!this.latestEl || this.currentCard?.isConnected) return;
    this.emptyEl?.remove();
    this.emptyEl = this.latestEl.createDiv({ cls: 'mupdf-tools-empty mupdf-translate-empty' });
    const icon = this.emptyEl.createSpan({ cls: 'mupdf-tools-empty-icon' });
    setIcon(icon, 'text-select');
    this.emptyEl.createDiv({ cls: 'mupdf-translate-empty-title', text: '划选文字即可翻译' });
  }

  updateHistoryState() {
    const count = this.historyEl ? this.historyEl.querySelectorAll('.mupdf-tools-entry').length : 0;
    this.historySectionEl?.toggleClass('is-hidden', count === 0);
    if (this.historyCountEl) this.historyCountEl.setText(String(count));
  }

  clearHistory() {
    this.clearPendingSelection();
    this.cancelTranslation();
    this.lastPayload = null;
    this.currentCard = null;
    this.latestEl?.empty();
    this.historyEl?.empty();
    this.emptyEl = null;
    this.updateHistoryState();
    this.renderEmpty();
  }

  archiveCurrent() {
    if (!this.currentCard?.isConnected || !this.historyEl) return;
    const card = this.currentCard;
    card.removeClass('is-latest');
    card.addClass('is-history');
    this.historyEl.prepend(card);
    this.currentCard = null;
    this.updateHistoryState();
    this.trimHistory();
  }

  removeCard(card) {
    if (!card) return;
    const wasCurrent = card === this.currentCard;
    if (wasCurrent) this.cancelTranslation();
    card.remove();
    if (wasCurrent) {
      this.currentCard = null;
      this.renderEmpty();
    }
    this.updateHistoryState();
  }

  selectionCharCount(text) {
    return Array.from(String(text || '').trim()).length;
  }

  queueSelection(payload) {
    if (!this.isOpen()) return;
    this.clearPendingSelection();
    this.lastPayload = payload;
    if (!this.plugin.settings?.translationAutoEnabled) {
      void this.handleSelection(payload, { preview: true }); return;
    }
    this.pendingSelectionPayload = payload;
    if (this.plugin.settings?.translationPanelFollowSelection) this.positionNearSelection(payload?.selectionRect);
    this.pendingSelectionTimer = window.setTimeout(() => {
      const queued = this.pendingSelectionPayload;
      this.pendingSelectionTimer = 0;
      this.pendingSelectionPayload = null;
      if (queued && this.isOpen() && this.plugin.settings?.translationAutoEnabled) {
        this.handleSelection(queued).catch((error) => console.error('[MuPDF Reader] debounced auto translation failed', error));
      }
    }, translationAutoDebounceMs(this.plugin.settings?.translationProvider));
  }

  async handleSelection(payload, options = {}) {
    const force = !!options.force;
    if (!this.isOpen()) return;
    if (!force && !options.preview && !this.plugin.settings?.translationAutoEnabled) return;
    if (force) this.clearPendingSelection();
    if (this.plugin.settings?.translationPanelFollowSelection) this.positionNearSelection(payload?.selectionRect);
    const sourceText = this.plugin.normalizeTranslationText(payload?.text || '');
    if (!sourceText) return;
    this.lastPayload = payload;
    const key = JSON.stringify([payload?.filePath, payload?.pageIndex, sourceText, this.plugin.settings.translationProvider, this.plugin.settings.translationTarget]);
    if (this.currentCard?.dataset.selectionKey === key && (this.currentCard.classList.contains('mupdf-entry-state-done') || this.currentCard.classList.contains('mupdf-entry-state-loading') || (options.preview && this.currentCard.classList.contains('mupdf-entry-state-guard')))) return;
    this.cancelTranslation();
    const count = this.selectionCharCount(sourceText);
    const min = Math.max(0, Number(this.plugin.settings?.translationGuardMinChars) || 0);
    const max = Math.max(0, Number(this.plugin.settings?.translationGuardMaxChars) || 0);

    if (count > MAX_TRANSLATION_CHARS) {
      this.addBlockedEntry(payload, sourceText, count, `选区超过翻译硬上限 ${MAX_TRANSLATION_CHARS} 字符，请缩小选区。`, false);
      return;
    }
    if (options.preview) {
      this.addBlockedEntry(payload, sourceText, count, '', true, '翻译');
    } else if (!force && min > 0 && count < min && !(count >= 2 && /^[\p{L}\p{N}][\p{L}\p{N}'’_.+-]*$/u.test(sourceText))) {
      this.addBlockedEntry(payload, sourceText, count, `仅 ${count} 个字符，低于 ${min} 字符。是否仍要翻译？`, true);
    } else if (max > 0 && count > max) {
      this.addBlockedEntry(payload, sourceText, count, `共 ${count} 个字符，超过 ${max} 字符。是否仍要翻译？`, true);
    } else {
      const translating = this.startTranslation(payload, sourceText, count);
      if (this.currentCard) this.currentCard.dataset.selectionKey = key;
      await translating; return;
    }
    if (this.currentCard) this.currentCard.dataset.selectionKey = key;
  }

  addBlockedEntry(payload, sourceText, count, message, canConfirm, label = '仍然翻译') {
    const card = this.createEntryShell(payload, sourceText, count, 'guard');
    const result = card.querySelector('[data-role="result"]');
    result.empty();
    result.addClass('mupdf-result-state-guard');
    if (message) {
      const warning = result.createDiv({ cls: 'mupdf-tools-guard-message' });
      const icon = warning.createSpan(); setIcon(icon, 'triangle-alert');
      warning.createSpan({ text: message });
    } else {
      card.addClass('is-translation-preview');
      card.querySelector('details').open = true;
      card.querySelector('summary').hidden = true;
      result.before(card.querySelector('details'));
    }
    if (canConfirm) {
      const actions = result.createDiv({ cls: 'mupdf-tools-guard-actions' });
      const translateBtn = actions.createEl('button', { cls: 'mod-cta', text: label });
      const ignoreBtn = actions.createEl('button', { text: '忽略' });
      translateBtn.addEventListener('click', async () => {
        translateBtn.disabled = true;
        ignoreBtn.disabled = true;
        await this.startTranslation(payload, sourceText, count, card);
      });
      ignoreBtn.addEventListener('click', () => this.removeCard(card));
    }
  }

  createEntryShell(payload, sourceText, count, state) {
    this.emptyEl?.remove();
    this.emptyEl = null;
    this.archiveCurrent();
    const card = this.latestEl.createDiv({ cls: `mupdf-tools-entry is-latest mupdf-entry-state-${state}` });
    this.currentCard = card;
    card.dataset.entryId = String(++this.entrySeq);

    const header = card.createDiv({ cls: 'mupdf-tools-entry-header' });
    const metaParts = [];
    if (payload?.fileName) metaParts.push(payload.fileName.replace(/\.pdf$/i, ''));
    if (Number.isInteger(payload?.pageNumber)) metaParts.push(`第 ${payload.pageNumber} 页`);
    metaParts.push(`${count} 字`);
    header.createDiv({ cls: 'mupdf-tools-entry-meta', text: metaParts.join(' · ') });
    createButton(header, 'x', '移除此条', () => this.removeCard(card)).addClass('mupdf-tools-entry-close');

    const result = card.createDiv({ cls: 'mupdf-tools-entry-result', attr: { 'data-role': 'result', 'aria-live': 'polite' } });

    const sourceDetails = card.createEl('details', { cls: 'mupdf-tools-entry-source-details' });
    const summary = sourceDetails.createEl('summary', { cls: 'mupdf-tools-entry-source-summary' });
    const summaryIcon = summary.createSpan({ cls: 'mupdf-tools-entry-source-chevron' });
    setIcon(summaryIcon, 'chevron-right');
    summary.createSpan({ text: '查看原文' });
    const source = sourceDetails.createDiv({ cls: 'mupdf-tools-entry-source' });
    source.setText(sourceText);

    this.updateHistoryState();
    requestAnimationFrame(() => {
      try { this.bodyEl?.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { if (this.bodyEl) this.bodyEl.scrollTop = 0; }
    });
    return card;
  }

  renderLoadingResult(resultEl) {
    resultEl.empty();
    resultEl.removeClass('mupdf-result-state-error', 'mupdf-result-state-guard', 'mupdf-result-state-streaming');
    resultEl.addClass('mupdf-result-state-loading');
    const row = resultEl.createDiv({ cls: 'mupdf-translate-loading-row' });
    const icon = row.createSpan({ cls: 'mupdf-translate-loading-icon' });
    setIcon(icon, 'loader-circle');
    row.createSpan({ text: '正在翻译' });
    createButton(row, 'x', '停止翻译', () => { this.cancelTranslation(); this.renderEmpty(); }).addClass('mupdf-translate-float-icon-btn');
  }

  async startTranslation(payload, sourceText, count, existingCard = null) {
    if (!this.isOpen()) return;
    this.cancelTranslation();
    const controller = new AbortController(); this.requestController = controller;
    const timeout = window.setTimeout(() => controller.abort(new DOMException('翻译请求超时，请重试', 'TimeoutError')), 30000);
    const card = existingCard || this.createEntryShell(payload, sourceText, count, 'loading');
    card.classList.remove('mupdf-entry-state-guard', 'mupdf-entry-state-error', 'mupdf-entry-state-done');
    card.classList.remove('is-translation-preview');
    card.classList.add('mupdf-entry-state-loading');
    const sourceDetails = card.querySelector('details');
    if (sourceDetails) { sourceDetails.open = false; sourceDetails.querySelector('summary').hidden = false; card.append(sourceDetails); }
    const resultEl = card.querySelector('[data-role="result"]');
    if (!resultEl) { window.clearTimeout(timeout); return; }
    this.renderLoadingResult(resultEl);
    const oldFooter = card.querySelector('.mupdf-tools-entry-footer');
    if (oldFooter) oldFooter.remove();

    let streamTextEl = null;
    let streamFrame = 0;
    let pendingStreamText = '';
    const renderStreamText = (text) => {
      if (!card.isConnected || controller.signal.aborted) return;
      pendingStreamText = String(text || '');
      if (streamFrame) return;
      streamFrame = window.requestAnimationFrame(() => {
        streamFrame = 0;
        if (!card.isConnected || controller.signal.aborted) return;
        if (!streamTextEl) {
          resultEl.empty();
          resultEl.removeClass('mupdf-result-state-loading');
          resultEl.addClass('mupdf-result-state-streaming');
          streamTextEl = resultEl.createDiv({ cls: 'mupdf-tools-entry-translation mupdf-translate-streaming-text' });
        }
        streamTextEl.setText(pendingStreamText);
      });
    };

    try {
      const result = await this.plugin.translateText(sourceText, { onDelta: renderStreamText, signal: controller.signal });
      if (!card.isConnected || controller.signal.aborted) return;
      if (streamFrame) {
        window.cancelAnimationFrame(streamFrame);
        streamFrame = 0;
      }
      card.classList.remove('mupdf-entry-state-loading');
      card.classList.add('mupdf-entry-state-done');
      resultEl.removeClass('mupdf-result-state-loading', 'mupdf-result-state-streaming', 'mupdf-result-state-error', 'mupdf-result-state-guard');
      if (streamTextEl) {
        streamTextEl.removeClass('mupdf-translate-streaming-text');
        streamTextEl.setText(result.translatedText || pendingStreamText || '');
      } else {
        resultEl.empty();
        resultEl.createDiv({ cls: 'mupdf-tools-entry-translation', text: result.translatedText || '' });
      }
      const footer = card.createDiv({ cls: 'mupdf-tools-entry-footer' });
      const providerLabel = result.providerLabel || TRANSLATION_PROVIDER_LABELS[result.provider] || result.provider || '';
      const detected = result.detectedLanguage && result.detectedLanguage !== 'auto' ? `识别 ${result.detectedLanguage}` : '';
      const cached = result.cached ? '缓存' : '';
      const streamed = result.streamed ? '流式' : '';
      footer.createDiv({ cls: 'mupdf-tools-entry-provider', text: [providerLabel, detected, streamed, cached].filter(Boolean).join(' · ') });
      const copy = createButton(footer, 'copy', '复制译文', async () => {
        try {
          await navigator.clipboard.writeText(result.translatedText || '');
          new Notice('译文已复制');
        } catch (error) {
          console.error('[MuPDF Reader] floating translation clipboard failed', error);
          new Notice('复制译文失败');
        }
      });
      copy.addClass('mupdf-tools-entry-copy');
    } catch (error) {
      if (streamFrame) {
        window.cancelAnimationFrame(streamFrame);
        streamFrame = 0;
      }
      if (controller.signal.aborted && controller.signal.reason?.name !== 'TimeoutError') return;
      if (!card.isConnected) return;
      card.classList.remove('mupdf-entry-state-loading');
      card.classList.add('mupdf-entry-state-error');
      resultEl.removeClass('mupdf-result-state-loading', 'mupdf-result-state-streaming', 'mupdf-result-state-guard');
      resultEl.addClass('mupdf-result-state-error');
      resultEl.empty();
      const message = /failed to fetch|networkerror|load failed/i.test(error?.message || '') ? '无法连接翻译服务，请检查网络后重试' : error?.message || String(error);
      resultEl.createDiv({ cls: 'mupdf-tools-entry-error-text', text: `翻译失败：${message}` });
      {
        const actions = resultEl.createDiv({ cls: 'mupdf-tools-guard-actions' });
        const retryBtn = actions.createEl('button', { cls: 'mod-cta', text: '重试' });
        retryBtn.addEventListener('click', async () => {
          if (error?.code === 'TRANSLATION_RATE_LIMIT' || error?.code === 'TRANSLATION_RATE_LIMIT_COOLDOWN') {
            const remaining = this.plugin.translationCooldownRemainingMs?.() || 0;
            if (remaining > 0) {
              new Notice(`Google Web 仍在冷却，请约 ${Math.ceil(remaining / 1000)} 秒后重试`);
              return;
            }
          }
          retryBtn.disabled = true;
          await this.startTranslation(payload, sourceText, count, card);
        });
        const configure = actions.createEl('button', { text: '设置' });
        configure.onclick = () => this.plugin.openTranslationSettings?.();
      }
    } finally { window.clearTimeout(timeout); if (this.requestController === controller) this.requestController = null; }
  }

  trimHistory() {
    if (!this.historyEl) return;
    const entries = Array.from(this.historyEl.querySelectorAll('.mupdf-tools-entry'));
    for (const entry of entries.slice(this.historyLimit)) entry.remove();
    this.updateHistoryState();
  }

  refreshSettings() {
    this.updateAutoButton();
    this.updateFollowButton();
    this.updatePinButton();
    this.updateBlockStatus();
    this.applyVisualSettings();
  }
}

class MuPdfReaderSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'MuPDF Reader' });

    containerEl.createEl('h3', { text: '批注与 PDF 便签' });
    new Setting(containerEl)
      .setName('默认批注显示')
      .setDesc('关键展开：普通记录只显示小色点，标记为关键的记录自动展开；也可选择仅标记、全部展开或隐藏。')
      .addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(ANNOTATION_DISPLAY_MODES)) dropdown.addOption(value, label);
        dropdown.setValue(this.plugin.settings.annotationDisplayMode || 'key');
        dropdown.onChange(async (value) => this.plugin.updateSettings({ annotationDisplayMode: value }));
      });

    new Setting(containerEl)
      .setName('常用 Tags')
      .setDesc('用逗号分隔。编辑批注/便签时会作为快速 Tag 显示，也会参与自动补全。')
      .addText((text) => {
        text.setPlaceholder('核心结论, 创新点, 方法, 实验, 待验证');
        text.setValue(normalizeTags(this.plugin.settings.favoriteTags || DEFAULT_FAVORITE_TAGS).join(', '));
        text.onChange(async (value) => this.plugin.updateSettings({ favoriteTags: normalizeTags(value) }));
      });

    new Setting(containerEl)
      .setName('记住阅读位置')
      .setDesc('记住每份 PDF 的页码、页内位置和缩放比例，下次打开时继续阅读。')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.rememberReadingPosition !== false);
        toggle.onChange(async (value) => this.plugin.updateSettings({ rememberReadingPosition: value }));
      });

    new Setting(containerEl)
      .setName('研究侧栏常驻')
      .setDesc('默认关闭：离开 MuPDF Reader 主视图时自动收起，回到 PDF 时自动恢复。开启后研究侧栏会跨 Markdown 等视图保持显示。')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.researchSidebarPinned === true);
        toggle.onChange(async (value) => {
          await this.plugin.updateSettings({ researchSidebarPinned: value });
          if (!value) this.plugin.syncResearchSidebarVisibility?.();
          else this.plugin.refreshResearchSidebar?.();
        });
      });

    containerEl.createEl('h3', { text: '划词翻译' });
    new Setting(containerEl)
      .setName('悬浮划词翻译')
      .setDesc('翻译结果显示在可拖动、可缩放的悬浮窗中。浮窗打开且自动翻译开启时，每次完成文字选区都会自动处理；Pin 后切换标签仍常驻并在下次启动恢复。');

    new Setting(containerEl)
      .setName('目标语言')
      .setDesc('自动划词翻译的默认目标语言。')
      .addDropdown((dropdown) => {
        for (const [code, label] of Object.entries(TRANSLATION_TARGET_LABELS)) dropdown.addOption(code, label);
        dropdown.setValue(this.plugin.settings.translationTarget || DEFAULT_SETTINGS.translationTarget);
        dropdown.onChange(async (value) => {
          await this.plugin.updateSettings({ translationTarget: value });
        });
      });

    new Setting(containerEl)
      .setName('译文字号')
      .setDesc('调整悬浮翻译窗中译文的文字大小；原文会自动使用略小字号。')
      .addSlider((slider) => {
        slider.setLimits(12, 24, 1);
        slider.setValue(Number(this.plugin.settings.translationFontSize) || DEFAULT_SETTINGS.translationFontSize);
        slider.setDynamicTooltip();
        slider.onChange(async (value) => {
          await this.plugin.updateSettings({ translationFontSize: Math.round(value) });
        });
      });

    new Setting(containerEl)
      .setName('翻译窗跟随选区')
      .setDesc('开启后，新选区会把翻译窗移动到选区附近并尽量避免遮挡；手动拖动翻译窗会自动切回固定位置。')
      .addToggle((toggle) => {
        toggle.setValue(!!this.plugin.settings.translationPanelFollowSelection);
        toggle.onChange(async (value) => {
          await this.plugin.updateSettings({ translationPanelFollowSelection: value });
        });
      });

    new Setting(containerEl)
      .setName('过短确认阈值')
      .setDesc('少于此字符数的选区先在悬浮窗询问，再决定是否翻译。设为 0 可关闭过短确认。')
      .addText((text) => {
        text.setPlaceholder('5');
        text.setValue(String(this.plugin.settings.translationGuardMinChars ?? DEFAULT_SETTINGS.translationGuardMinChars));
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.max = '1000';
        text.onChange(async (value) => {
          const parsed = Math.max(0, Math.min(1000, Math.round(Number(value) || 0)));
          await this.plugin.updateSettings({ translationGuardMinChars: parsed });
        });
      });

    new Setting(containerEl)
      .setName('过长确认阈值')
      .setDesc(`超过此字符数的选区先询问，再决定是否翻译。设为 0 可关闭过长确认；单次硬上限仍为 ${MAX_TRANSLATION_CHARS} 字符。`)
      .addText((text) => {
        text.setPlaceholder('1200');
        text.setValue(String(this.plugin.settings.translationGuardMaxChars ?? DEFAULT_SETTINGS.translationGuardMaxChars));
        text.inputEl.type = 'number';
        text.inputEl.min = '0';
        text.inputEl.max = String(MAX_TRANSLATION_CHARS);
        text.onChange(async (value) => {
          const parsed = Math.max(0, Math.min(MAX_TRANSLATION_CHARS, Math.round(Number(value) || 0)));
          await this.plugin.updateSettings({ translationGuardMaxChars: parsed });
        });
      });

    new Setting(containerEl)
      .setName('翻译 Provider')
      .setDesc('Google Web 无需 Key，但可能触发 429；DeepL 与 OpenAI-compatible 使用你自己的 API 配置。切换 Provider 不影响 PDF、选区或标注。')
      .addDropdown((dropdown) => {
        dropdown.addOption('google-web', 'Google Web（试验，无 Key）');
        dropdown.addOption('deepl', 'DeepL API');
        dropdown.addOption('openai-compatible', 'OpenAI-compatible');
        dropdown.setValue(this.plugin.settings.translationProvider || DEFAULT_SETTINGS.translationProvider);
        dropdown.onChange(async (value) => {
          await this.plugin.updateSettings({ translationProvider: value });
          this.display();
        });
      });

    const provider = this.plugin.settings.translationProvider || DEFAULT_SETTINGS.translationProvider;
    if (provider === 'deepl') {
      new Setting(containerEl)
        .setName('DeepL API Key')
        .setDesc('保存在本插件 data.json 中。Free Key 通常以 :fx 结尾，可自动选择 Free endpoint。')
        .addText((text) => {
          text.setPlaceholder('DeepL API Key');
          text.setValue(this.plugin.settings.deeplApiKey || '');
          text.inputEl.type = 'password';
          text.onChange(async (value) => this.plugin.updateSettings({ deeplApiKey: value.trim() }));
        });

      new Setting(containerEl)
        .setName('DeepL Endpoint')
        .setDesc('Auto 会根据 Key 是否以 :fx 结尾选择 Free / Pro。')
        .addDropdown((dropdown) => {
          dropdown.addOption('auto', 'Auto');
          dropdown.addOption('free', 'Free');
          dropdown.addOption('pro', 'Pro');
          dropdown.setValue(this.plugin.settings.deeplEndpointMode || 'auto');
          dropdown.onChange(async (value) => this.plugin.updateSettings({ deeplEndpointMode: value }));
        });
    }

    if (provider === 'openai-compatible') {
      new Setting(containerEl)
        .setName('Base URL')
        .setDesc('例如 https://api.openai.com/v1。若填写完整 /chat/completions 地址也可以。')
        .addText((text) => {
          text.setPlaceholder('https://api.openai.com/v1');
          text.setValue(this.plugin.settings.openaiBaseUrl || DEFAULT_SETTINGS.openaiBaseUrl);
          text.onChange(async (value) => this.plugin.updateSettings({ openaiBaseUrl: value.trim() }));
        });

      new Setting(containerEl)
        .setName('API Key')
        .setDesc('可留空以支持不要求鉴权的本地 OpenAI-compatible 服务。Key 会保存在本插件 data.json 中。')
        .addText((text) => {
          text.setPlaceholder('sk-…');
          text.setValue(this.plugin.settings.openaiApiKey || '');
          text.inputEl.type = 'password';
          text.onChange(async (value) => this.plugin.updateSettings({ openaiApiKey: value.trim() }));
        });

      new Setting(containerEl)
        .setName('模型')
        .setDesc('填写你的 Provider 实际支持的模型 ID。')
        .addText((text) => {
          text.setPlaceholder('例如：你的模型 ID');
          text.setValue(this.plugin.settings.openaiModel || '');
          text.onChange(async (value) => this.plugin.updateSettings({ openaiModel: value.trim() }));
        });

      new Setting(containerEl)
        .setName('流式显示译文')
        .setDesc('开启后会边生成边显示译文。若当前 Endpoint / Obsidian 网络层不支持 SSE，会自动回退到普通请求。')
        .addToggle((toggle) => {
          toggle.setValue(this.plugin.settings.openaiStreaming !== false);
          toggle.onChange(async (value) => this.plugin.updateSettings({ openaiStreaming: value }));
        });

      new Setting(containerEl)
        .setName('DeepSeek 极速翻译')
        .setDesc('检测到 DeepSeek Endpoint / 模型时显式关闭 Thinking。DeepSeek V4 默认开启思考，翻译场景关闭后通常能显著降低首字延迟和输出 Token。')
        .addToggle((toggle) => {
          toggle.setValue(this.plugin.settings.openaiDeepSeekFastMode !== false);
          toggle.onChange(async (value) => this.plugin.updateSettings({ openaiDeepSeekFastMode: value }));
        });

      new Setting(containerEl)
        .setName('学术翻译 Prompt')
        .setDesc('可使用 {target} 占位符；翻译时会替换为目标语言。')
        .addTextArea((text) => {
          text.setValue(this.plugin.settings.openaiTranslationPrompt || DEFAULT_SETTINGS.openaiTranslationPrompt);
          text.inputEl.rows = 5;
          text.onChange(async (value) => this.plugin.updateSettings({ openaiTranslationPrompt: value }));
        });
    }

    new Setting(containerEl)
      .setName('测试 Provider')
      .setDesc('发送一小段测试文本，验证当前 Provider、Key、模型和网络配置。')
      .addButton((button) => {
        button.setButtonText('测试翻译');
        button.onClick(async () => {
          button.setDisabled(true);
          button.setButtonText('测试中…');
          try {
            const result = await this.plugin.translateText('This is a translation provider connectivity test.');
            const preview = String(result?.translatedText || '').replace(/\s+/g, ' ').slice(0, 80);
            new Notice(`Provider 可用：${preview || '已返回结果'}`, 7000);
          } catch (error) {
            console.error('[MuPDF Reader] provider test failed', error);
            new Notice(`Provider 测试失败：${error?.message || String(error)}`, 9000);
          } finally {
            button.setDisabled(false);
            button.setButtonText('测试翻译');
          }
        });
      });
  }
}

export default class MuPdfReaderPlugin extends Plugin {
  async onload() {
    this.annotationListeners = new Set();
    this.saveChain = Promise.resolve();
    this.translationCache = new Map();
    this.translationInflight = new Map();
    this.translationRequestTail = Promise.resolve();
    this.translationNextRequestAt = 0;
    this.translationRateLimitUntil = 0;
    this.researchSidebarState = { tab: 'annotations', scope: 'current', annotationQuery: '', tagFilter: '', searchQuery: '', searchResults: [], searchProgress: '' };
    this.researchSidebarAutoHidden = false;
    this.lastMainViewType = '';
    await this.loadAnnotationData();
    this.addSettingTab(new MuPdfReaderSettingTab(this.app, this));

    this.registerView(VIEW_TYPE, (leaf) => new MuPdfReaderView(leaf, this));
    this.registerView(SIDEBAR_VIEW_TYPE, (leaf) => new MuPdfResearchSidebarView(leaf, this));
    this.translationPanel = new MuPdfTranslationFloatingPanel(this);
    // Remove the v0.6.1 docked sidebar if it was persisted in the workspace layout.
    try { this.app.workspace.detachLeavesOfType('mupdf-reader-translation-sidebar'); } catch (_) {}

    this.addCommand({
      id: 'open-active-pdf-in-mupdf-reader',
      name: 'Open active PDF in MuPDF Reader',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const valid = file instanceof TFile && file.extension.toLowerCase() === 'pdf';
        if (!checking && valid) this.openPdf(file, false);
        return valid;
      }
    });

    this.addCommand({
      id: 'open-mupdf-translation-panel',
      name: 'Open MuPDF floating translation panel',
      callback: () => this.openTranslationPanel()
    });

    this.addCommand({
      id: 'open-mupdf-research-sidebar',
      name: 'Open MuPDF research sidebar',
      callback: () => this.openResearchSidebar('annotations')
    });

    this.addCommand({
      id: 'search-active-mupdf',
      name: 'Search active MuPDF',
      callback: () => this.openResearchSidebar('search')
    });

    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'pdf') return;
      menu.addItem((item) => {
        item.setTitle('在 MuPDF Reader 中打开')
          .setIcon('file-text')
          .onClick(() => this.openPdf(file, true));
      });
    }));

    this.addRibbonIcon('file-text', 'MuPDF Reader：打开当前 PDF', async () => {
      const file = this.app.workspace.getActiveFile();
      if (file instanceof TFile && file.extension.toLowerCase() === 'pdf') {
        await this.openPdf(file, true);
      } else {
        new Notice('请先打开或选中一个 PDF 文件');
      }
    });

    this.addRibbonIcon('languages', 'MuPDF：悬浮划词翻译', () => this.openTranslationPanel());
    this.addRibbonIcon('panel-right', 'MuPDF：研究侧栏', () => this.openResearchSidebar('annotations'));

    this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
      const type = leaf?.view?.getViewType?.();
      if (type === VIEW_TYPE && leaf?.view?.filePath) this.lastReaderFilePath = leaf.view.filePath;

      // Track only primary/root content leaves. Clicking our right sidebar must not
      // be mistaken for leaving the PDF reader.
      if (type === VIEW_TYPE || this.isPrimaryWorkspaceLeaf(leaf)) this.lastMainViewType = type || '';
      this.syncResearchSidebarVisibility(leaf).catch((error) => console.error('[MuPDF Reader] research sidebar visibility sync failed', error));

      // The sidebar view tracks genuine reader-context changes itself. Avoid a full
      // refresh on simple focus changes (PDF <-> sidebar), otherwise Region preview
      // image nodes are destroyed and recreated, causing visible flashing.

      if (!this.translationPanel?.isOpen() || this.settings?.translationPanelPinned) return;
      if (type !== VIEW_TYPE && type !== SIDEBAR_VIEW_TYPE && this.isPrimaryWorkspaceLeaf(leaf)) this.translationPanel.close({ preservePin: true });
    }));

    this.registerObsidianProtocolHandler('mupdf-reader', async (params) => {
      const filePath = String(params?.file || '');
      const annotationId = String(params?.annotation || '');
      const page = Math.max(0, Number(params?.page || 1) - 1);
      if (annotationId) await this.navigateToAnnotation(filePath, annotationId);
      else {
        const reader = await this.ensureReader(filePath, true);
        reader?.goToPage(page + 1, 'auto');
      }
    });

    if (this.settings?.translationPanelPinned) {
      if (typeof this.app.workspace.onLayoutReady === 'function') this.app.workspace.onLayoutReady(() => this.openTranslationPanel());
      else window.setTimeout(() => this.openTranslationPanel(), 0);
    }
  }

  storagePaths() {
    const configDir = this.app?.vault?.configDir || '.obsidian';
    const pluginBase = `${configDir}/plugins/${this.manifest.id}`;
    const storageBase = `${pluginBase}/storage`;
    return {
      pluginBase,
      storageBase,
      index: `${storageBase}/index.json`,
      documents: `${storageBase}/documents`,
      previews: `${storageBase}/previews`,
      backups: `${storageBase}/backups`
    };
  }

  async ensureStorageDirectory(path) {
    const adapter = this.app.vault.adapter;
    const parts = String(path || '').replace(/\\/g, '/').split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      try {
        if (typeof adapter.exists !== 'function' || !(await adapter.exists(current))) await adapter.mkdir(current);
      } catch (error) {
        if (typeof adapter.exists === 'function' && await adapter.exists(current)) continue;
        throw error;
      }
    }
  }

  async initializeStorageFolders() {
    const paths = this.storagePaths();
    await this.ensureStorageDirectory(paths.storageBase);
    await this.ensureStorageDirectory(paths.documents);
    await this.ensureStorageDirectory(paths.previews);
    await this.ensureStorageDirectory(paths.backups);
    return paths;
  }

  storageHash(text) {
    const input = new TextEncoder().encode(String(text || ''));
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    for (const byte of input) {
      hash ^= BigInt(byte);
      hash = BigInt.asUintN(64, hash * prime);
    }
    return hash.toString(16).padStart(16, '0');
  }

  rebuildStoragePathMap() {
    this.pathToDocumentId = new Map();
    for (const [documentId, meta] of Object.entries(this.storageIndex?.documents || {})) {
      if (meta?.path) this.pathToDocumentId.set(String(meta.path), documentId);
    }
  }

  ensureDocumentId(filePath) {
    const path = String(filePath || '');
    if (!path) throw new Error('Missing PDF path');
    const existing = this.pathToDocumentId?.get(path);
    if (existing) return existing;
    if (!this.storageIndex) this.storageIndex = { schemaVersion: STORAGE_SCHEMA_VERSION, documents: {} };
    if (!this.storageIndex.documents) this.storageIndex.documents = {};
    let documentId = `pdf-${this.storageHash(path)}`;
    let suffix = 1;
    while (this.storageIndex.documents[documentId] && this.storageIndex.documents[documentId].path !== path) {
      documentId = `pdf-${this.storageHash(`${path}:${suffix++}`)}`;
    }
    if (!this.storageIndex.documents[documentId]) {
      this.storageIndex.documents[documentId] = { path, annotationCount: 0, regionCount: 0, tags: [], updatedAt: Date.now() };
    }
    if (!this.pathToDocumentId) this.pathToDocumentId = new Map();
    this.pathToDocumentId.set(path, documentId);
    return documentId;
  }

  documentStoragePath(filePath) {
    const documentId = this.ensureDocumentId(filePath);
    return `${this.storagePaths().documents}/${documentId}.json`;
  }

  regionPreviewStoragePath(filePath, annotationId, mime = 'image/webp') {
    const documentId = this.ensureDocumentId(filePath);
    const ext = /png/i.test(mime) ? 'png' : /jpe?g/i.test(mime) ? 'jpg' : 'webp';
    return `${this.storagePaths().previews}/${documentId}/${annotationId}.${ext}`;
  }

  async readJsonFile(path, fallback = null) {
    try {
      const adapter = this.app.vault.adapter;
      if (typeof adapter.exists === 'function' && !(await adapter.exists(path))) return fallback;
      return JSON.parse(await adapter.read(path));
    } catch (error) {
      console.error(`[MuPDF Reader] failed to read JSON: ${path}`, error);
      return fallback;
    }
  }

  async writeJsonFile(path, value) {
    const adapter = this.app.vault.adapter;
    const parent = String(path).replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    if (parent) await this.ensureStorageDirectory(parent);
    await adapter.write(path, JSON.stringify(value, null, 2));
  }

  parseDataUrl(dataUrl) {
    const match = String(dataUrl || '').match(/^data:([^;,]+);base64,(.+)$/s);
    if (!match) return null;
    const mime = match[1] || 'application/octet-stream';
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { mime, buffer: bytes.buffer };
  }

  async persistRegionPreview(filePath, annotation) {
    if (annotation?.type !== 'region' || !annotation?.id) return annotation;
    if (!annotation.previewDataUrl) return annotation;
    const parsed = this.parseDataUrl(annotation.previewDataUrl);
    if (!parsed) return annotation;
    const previewPath = this.regionPreviewStoragePath(filePath, annotation.id, parsed.mime);
    const parent = previewPath.split('/').slice(0, -1).join('/');
    await this.ensureStorageDirectory(parent);
    await this.app.vault.adapter.writeBinary(previewPath, parsed.buffer);
    const next = { ...annotation, previewPath, previewMime: parsed.mime };
    delete next.previewDataUrl;
    return next;
  }

  getRegionPreviewSrc(annotation) {
    if (!annotation || annotation.type !== 'region') return '';
    if (typeof annotation.previewDataUrl === 'string' && annotation.previewDataUrl.startsWith('data:image/')) return annotation.previewDataUrl;
    const path = String(annotation.previewPath || '');
    if (!path) return '';
    try {
      const adapter = this.app.vault.adapter;
      if (typeof adapter.getResourcePath === 'function') return adapter.getResourcePath(path);
    } catch (_) {}
    return '';
  }

  async getRegionPreviewBlob(annotation) {
    if (!annotation || annotation.type !== 'region') return null;
    if (typeof annotation.previewDataUrl === 'string' && annotation.previewDataUrl.startsWith('data:image/')) {
      return await (await fetch(annotation.previewDataUrl)).blob();
    }
    const path = String(annotation.previewPath || '');
    if (!path) return null;
    const buffer = await this.app.vault.adapter.readBinary(path);
    return new Blob([buffer], { type: annotation.previewMime || 'image/webp' });
  }

  storageAnnotationCopy(annotation) {
    const clean = { ...annotation, tags: normalizeTags(annotation?.tags || []), presentation: { ...(annotation?.presentation || {}) } };
    delete clean.previewDataUrl;
    return clean;
  }

  updateStorageIndexForFile(filePath) {
    const documentId = this.ensureDocumentId(filePath);
    const items = Array.isArray(this.data?.annotations?.[filePath]) ? this.data.annotations[filePath] : [];
    const tags = normalizeTags(items.flatMap((item) => item?.tags || []));
    const current = this.storageIndex.documents[documentId] || {};
    this.storageIndex.documents[documentId] = {
      ...current,
      path: filePath,
      annotationCount: items.length,
      regionCount: items.filter((item) => item?.type === 'region').length,
      tags,
      updatedAt: Date.now()
    };
    this.pathToDocumentId.set(filePath, documentId);
    return documentId;
  }

  async writeStorageIndex() {
    if (!this.storageIndex) this.storageIndex = { schemaVersion: STORAGE_SCHEMA_VERSION, documents: {} };
    this.storageIndex.schemaVersion = STORAGE_SCHEMA_VERSION;
    await this.writeJsonFile(this.storagePaths().index, this.storageIndex);
  }

  async persistDocument(filePath) {
    if (!this.storageReady) return this.persistLegacyData();
    const path = String(filePath || '');
    if (!path) return;
    const documentId = this.updateStorageIndexForFile(path);
    const doc = {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      id: documentId,
      pdfPath: path,
      readingPosition: this.data?.readingPositions?.[path] || null,
      annotations: (this.data?.annotations?.[path] || []).map((item) => this.storageAnnotationCopy(item)),
      updatedAt: Date.now()
    };
    await this.writeJsonFile(`${this.storagePaths().documents}/${documentId}.json`, doc);
    await this.writeStorageIndex();
  }

  async persistPluginSettings() {
    this.data.settings = { ...this.settings };
    await this.saveData({ schemaVersion: DATA_SCHEMA_VERSION, storageVersion: STORAGE_SCHEMA_VERSION, settings: { ...this.settings } });
  }

  async persistLegacyData() {
    await this.saveData(this.data);
  }

  async backupLegacyData(raw) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const json = JSON.stringify(raw || {});
    if (typeof CompressionStream === 'function') {
      try {
        const path = `${this.storagePaths().backups}/${stamp}-before-storage-v1.json.gz`;
        const stream = new Blob([json], { type: 'application/json' }).stream().pipeThrough(new CompressionStream('gzip'));
        const buffer = await new Response(stream).arrayBuffer();
        await this.app.vault.adapter.writeBinary(path, buffer);
        return path;
      } catch (error) {
        console.warn('[MuPDF Reader] compressed migration backup failed; falling back to JSON', error);
      }
    }
    const path = `${this.storagePaths().backups}/${stamp}-before-storage-v1.json`;
    await this.writeJsonFile(path, raw || {});
    return path;
  }

  async migrateLegacyDataToStorage(raw) {
    await this.initializeStorageFolders();
    await this.backupLegacyData(raw);
    this.storageIndex = { schemaVersion: STORAGE_SCHEMA_VERSION, documents: {} };
    this.pathToDocumentId = new Map();
    // From this point, migration writes document files/index instead of touching the legacy data.json.
    // The outer caller flips storageReady back to false on any failure, preserving the legacy source.
    this.storageReady = true;

    const sourceAnnotations = raw && typeof raw.annotations === 'object' && raw.annotations ? raw.annotations : {};
    const sourcePositions = raw && typeof raw.readingPositions === 'object' && raw.readingPositions ? raw.readingPositions : {};
    const allPaths = new Set([...Object.keys(sourceAnnotations), ...Object.keys(sourcePositions)]);
    const migratedAnnotations = {};
    const migratedPositions = {};

    for (const filePath of allPaths) {
      const cleanItems = Array.isArray(sourceAnnotations[filePath])
        ? sourceAnnotations[filePath].map((item) => this.sanitizeAnnotation(item)).filter(Boolean)
        : [];
      const storedItems = [];
      for (const item of cleanItems) storedItems.push(await this.persistRegionPreview(filePath, item));
      if (storedItems.length) migratedAnnotations[filePath] = storedItems;
      const pos = sourcePositions[filePath];
      if (pos && typeof pos === 'object') {
        migratedPositions[filePath] = {
          page: Math.max(0, Math.round(Number(pos.page) || 0)),
          ratio: clamp(Number(pos.ratio) || 0, 0, 0.98),
          zoom: clamp(Number(pos.zoom) || 1, MIN_ZOOM, MAX_ZOOM),
          updatedAt: Number(pos.updatedAt) || Date.now()
        };
      }
      this.data.annotations[filePath] = storedItems;
      if (migratedPositions[filePath]) this.data.readingPositions[filePath] = migratedPositions[filePath];
      await this.persistDocument(filePath);
    }

    await this.writeStorageIndex();
    const expected = Object.values(sourceAnnotations).reduce((sum, items) => sum + (Array.isArray(items) ? items.map((item) => this.sanitizeAnnotation(item)).filter(Boolean).length : 0), 0);
    const actual = Object.values(migratedAnnotations).reduce((sum, items) => sum + items.length, 0);
    if (actual !== expected) throw new Error(`Migration verification failed: expected ${expected} annotations, got ${actual}`);
    await this.persistPluginSettings();
    return true;
  }

  async loadStorageDocuments() {
    const paths = await this.initializeStorageFolders();
    const index = await this.readJsonFile(paths.index, null);
    if (!index || typeof index.documents !== 'object' || !index.documents) return false;
    this.storageIndex = { schemaVersion: STORAGE_SCHEMA_VERSION, documents: index.documents || {} };
    this.rebuildStoragePathMap();
    for (const [documentId, meta] of Object.entries(this.storageIndex.documents || {})) {
      const filePath = String(meta?.path || '');
      if (!filePath) continue;
      const doc = await this.readJsonFile(`${paths.documents}/${documentId}.json`, null);
      if (!doc || typeof doc !== 'object') continue;
      const items = Array.isArray(doc.annotations) ? doc.annotations.map((item) => this.sanitizeAnnotation(item)).filter(Boolean) : [];
      if (items.length) this.data.annotations[filePath] = items;
      const pos = doc.readingPosition;
      if (pos && typeof pos === 'object') {
        this.data.readingPositions[filePath] = {
          page: Math.max(0, Math.round(Number(pos.page) || 0)),
          ratio: clamp(Number(pos.ratio) || 0, 0, 0.98),
          zoom: clamp(Number(pos.zoom) || 1, MIN_ZOOM, MAX_ZOOM),
          updatedAt: Number(pos.updatedAt) || Date.now()
        };
      }
    }
    this.storageReady = true;
    return true;
  }

  async loadAnnotationData() {
    let raw = null;
    try { raw = await this.loadData(); } catch (error) { console.error('[MuPDF Reader] loadData failed', error); }
    const storedSettings = raw && typeof raw.settings === 'object' && raw.settings ? raw.settings : {};
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...storedSettings,
      translationProvider: TRANSLATION_PROVIDER_LABELS[storedSettings.translationProvider] ? storedSettings.translationProvider : DEFAULT_SETTINGS.translationProvider,
      deeplApiKey: typeof storedSettings.deeplApiKey === 'string' ? storedSettings.deeplApiKey : '',
      deeplEndpointMode: ['auto', 'free', 'pro'].includes(storedSettings.deeplEndpointMode) ? storedSettings.deeplEndpointMode : DEFAULT_SETTINGS.deeplEndpointMode,
      openaiBaseUrl: typeof storedSettings.openaiBaseUrl === 'string' && storedSettings.openaiBaseUrl.trim() ? storedSettings.openaiBaseUrl.trim() : DEFAULT_SETTINGS.openaiBaseUrl,
      openaiApiKey: typeof storedSettings.openaiApiKey === 'string' ? storedSettings.openaiApiKey : '',
      openaiModel: typeof storedSettings.openaiModel === 'string' ? storedSettings.openaiModel : '',
      openaiTranslationPrompt: typeof storedSettings.openaiTranslationPrompt === 'string' && storedSettings.openaiTranslationPrompt.trim() ? storedSettings.openaiTranslationPrompt : DEFAULT_SETTINGS.openaiTranslationPrompt,
      openaiStreaming: storedSettings.openaiStreaming !== false,
      openaiDeepSeekFastMode: storedSettings.openaiDeepSeekFastMode !== false,
      translationTarget: TRANSLATION_TARGET_LABELS[storedSettings.translationTarget] ? storedSettings.translationTarget : DEFAULT_SETTINGS.translationTarget,
      translationAutoEnabled: storedSettings.translationAutoEnabled !== false,
      translationGuardMinChars: Number.isFinite(Number(storedSettings.translationGuardMinChars)) ? clamp(Math.round(Number(storedSettings.translationGuardMinChars)), 0, 1000) : DEFAULT_SETTINGS.translationGuardMinChars,
      translationGuardMaxChars: Number.isFinite(Number(storedSettings.translationGuardMaxChars)) ? clamp(Math.round(Number(storedSettings.translationGuardMaxChars)), 0, MAX_TRANSLATION_CHARS) : DEFAULT_SETTINGS.translationGuardMaxChars,
      translationPanelPinned: storedSettings.translationPanelPinned === true,
      translationPanelX: storedSettings.translationPanelX != null && Number.isFinite(Number(storedSettings.translationPanelX)) ? Number(storedSettings.translationPanelX) : null,
      translationPanelY: storedSettings.translationPanelY != null && Number.isFinite(Number(storedSettings.translationPanelY)) ? Number(storedSettings.translationPanelY) : null,
      translationPanelWidth: Number.isFinite(Number(storedSettings.translationPanelWidth)) ? clamp(Number(storedSettings.translationPanelWidth), 300, 1200) : DEFAULT_SETTINGS.translationPanelWidth,
      translationPanelHeight: Number.isFinite(Number(storedSettings.translationPanelHeight)) ? clamp(Number(storedSettings.translationPanelHeight), 220, 1200) : DEFAULT_SETTINGS.translationPanelHeight,
      translationPanelFollowSelection: storedSettings.translationPanelFollowSelection === true,
      translationFontSize: Number.isFinite(Number(storedSettings.translationFontSize)) ? clamp(Math.round(Number(storedSettings.translationFontSize)), 12, 24) : DEFAULT_SETTINGS.translationFontSize,
      annotationDisplayMode: Object.prototype.hasOwnProperty.call(ANNOTATION_DISPLAY_MODES, storedSettings.annotationDisplayMode) ? storedSettings.annotationDisplayMode : DEFAULT_SETTINGS.annotationDisplayMode,
      favoriteTags: normalizeTags(Array.isArray(storedSettings.favoriteTags) ? storedSettings.favoriteTags : DEFAULT_SETTINGS.favoriteTags),
      rememberReadingPosition: storedSettings.rememberReadingPosition !== false,
      researchSidebarPinned: storedSettings.researchSidebarPinned === true
    };
    if (this.settings.translationGuardMaxChars > 0 && this.settings.translationGuardMinChars > this.settings.translationGuardMaxChars) {
      this.settings.translationGuardMaxChars = this.settings.translationGuardMinChars;
    }

    this.data = { schemaVersion: DATA_SCHEMA_VERSION, annotations: {}, readingPositions: {}, settings: { ...this.settings } };
    this.storageReady = false;
    this.storageIndex = { schemaVersion: STORAGE_SCHEMA_VERSION, documents: {} };
    this.pathToDocumentId = new Map();

    try {
      const loaded = await this.loadStorageDocuments();
      if (!loaded) {
        const hasLegacy = !!(raw && ((raw.annotations && Object.keys(raw.annotations).length) || (raw.readingPositions && Object.keys(raw.readingPositions).length)));
        if (hasLegacy) {
          await this.migrateLegacyDataToStorage(raw);
          this.storageReady = true;
          new Notice('MuPDF Reader：笔记数据已迁移到分层存储', 5000);
        } else {
          this.storageReady = true;
          await this.writeStorageIndex();
          await this.persistPluginSettings();
        }
      }
    } catch (error) {
      console.error('[MuPDF Reader] storage initialization/migration failed; preserving legacy data.json', error);
      this.storageReady = false;
      const annotations = raw && typeof raw.annotations === 'object' && raw.annotations ? raw.annotations : {};
      const readingPositions = raw && typeof raw.readingPositions === 'object' && raw.readingPositions ? raw.readingPositions : {};
      for (const [filePath, items] of Object.entries(annotations)) {
        if (!Array.isArray(items)) continue;
        const clean = items.map((item) => this.sanitizeAnnotation(item)).filter(Boolean);
        if (clean.length) this.data.annotations[filePath] = clean;
      }
      for (const [filePath, pos] of Object.entries(readingPositions)) {
        if (!pos || typeof pos !== 'object') continue;
        this.data.readingPositions[filePath] = {
          page: Math.max(0, Math.round(Number(pos.page) || 0)),
          ratio: clamp(Number(pos.ratio) || 0, 0, 0.98),
          zoom: clamp(Number(pos.zoom) || 1, MIN_ZOOM, MAX_ZOOM),
          updatedAt: Number(pos.updatedAt) || Date.now()
        };
      }
      new Notice('MuPDF Reader：分层存储迁移失败，已保留并继续使用旧数据，请勿删除 data.json', 10000);
    }

    this.registerEvent(this.app.vault.on('rename', async (file, oldPath) => {
      if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'pdf') return;
      const hadAnnotations = Array.isArray(this.data.annotations?.[oldPath]);
      const hadPosition = !!this.data.readingPositions?.[oldPath];
      const oldDocumentId = this.pathToDocumentId?.get(oldPath) || null;
      if (hadAnnotations) {
        const incoming = this.data.annotations[file.path] || [];
        this.data.annotations[file.path] = incoming.concat(this.data.annotations[oldPath]);
        delete this.data.annotations[oldPath];
        this.emitAnnotationChange(oldPath);
        this.emitAnnotationChange(file.path);
      }
      if (hadPosition) {
        this.data.readingPositions[file.path] = this.data.readingPositions[oldPath];
        delete this.data.readingPositions[oldPath];
      }
      if (this.storageReady) {
        if (oldDocumentId && this.storageIndex?.documents?.[oldDocumentId]) {
          this.pathToDocumentId.delete(oldPath);
          this.pathToDocumentId.set(file.path, oldDocumentId);
          this.storageIndex.documents[oldDocumentId].path = file.path;
        }
        if (hadAnnotations || hadPosition || oldDocumentId) await this.persistDocument(file.path);
      } else {
        await this.persistLegacyData();
      }
    }));
  }

  async updateSettings(patch = {}) {
    this.settings = { ...this.settings, ...patch };
    if (!TRANSLATION_TARGET_LABELS[this.settings.translationTarget]) this.settings.translationTarget = DEFAULT_SETTINGS.translationTarget;
    if (!TRANSLATION_PROVIDER_LABELS[this.settings.translationProvider]) this.settings.translationProvider = DEFAULT_SETTINGS.translationProvider;
    this.settings.deeplApiKey = String(this.settings.deeplApiKey || '').trim();
    if (!['auto', 'free', 'pro'].includes(this.settings.deeplEndpointMode)) this.settings.deeplEndpointMode = DEFAULT_SETTINGS.deeplEndpointMode;
    this.settings.openaiBaseUrl = String(this.settings.openaiBaseUrl || DEFAULT_SETTINGS.openaiBaseUrl).trim() || DEFAULT_SETTINGS.openaiBaseUrl;
    this.settings.openaiApiKey = String(this.settings.openaiApiKey || '').trim();
    this.settings.openaiModel = String(this.settings.openaiModel || '').trim();
    this.settings.openaiTranslationPrompt = String(this.settings.openaiTranslationPrompt || DEFAULT_SETTINGS.openaiTranslationPrompt).trim() || DEFAULT_SETTINGS.openaiTranslationPrompt;
    this.settings.openaiStreaming = this.settings.openaiStreaming !== false;
    this.settings.openaiDeepSeekFastMode = this.settings.openaiDeepSeekFastMode !== false;
    this.settings.translationAutoEnabled = this.settings.translationAutoEnabled !== false;
    this.settings.translationGuardMinChars = clamp(Math.round(Number(this.settings.translationGuardMinChars) || 0), 0, 1000);
    this.settings.translationGuardMaxChars = clamp(Math.round(Number(this.settings.translationGuardMaxChars) || 0), 0, MAX_TRANSLATION_CHARS);
    if (this.settings.translationGuardMaxChars > 0 && this.settings.translationGuardMinChars > this.settings.translationGuardMaxChars) {
      this.settings.translationGuardMaxChars = this.settings.translationGuardMinChars;
    }
    this.settings.translationPanelPinned = this.settings.translationPanelPinned === true;
    this.settings.translationPanelX = this.settings.translationPanelX != null && Number.isFinite(Number(this.settings.translationPanelX)) ? Number(this.settings.translationPanelX) : null;
    this.settings.translationPanelY = this.settings.translationPanelY != null && Number.isFinite(Number(this.settings.translationPanelY)) ? Number(this.settings.translationPanelY) : null;
    this.settings.translationPanelWidth = clamp(Number(this.settings.translationPanelWidth) || DEFAULT_SETTINGS.translationPanelWidth, 300, 1200);
    this.settings.translationPanelHeight = clamp(Number(this.settings.translationPanelHeight) || DEFAULT_SETTINGS.translationPanelHeight, 220, 1200);
    this.settings.translationPanelFollowSelection = this.settings.translationPanelFollowSelection === true;
    this.settings.translationFontSize = clamp(Math.round(Number(this.settings.translationFontSize) || DEFAULT_SETTINGS.translationFontSize), 12, 24);
    this.settings.annotationDisplayMode = Object.prototype.hasOwnProperty.call(ANNOTATION_DISPLAY_MODES, this.settings.annotationDisplayMode) ? this.settings.annotationDisplayMode : DEFAULT_SETTINGS.annotationDisplayMode;
    this.settings.favoriteTags = normalizeTags(Array.isArray(this.settings.favoriteTags) ? this.settings.favoriteTags : DEFAULT_SETTINGS.favoriteTags);
    this.settings.rememberReadingPosition = this.settings.rememberReadingPosition !== false;
    this.settings.researchSidebarPinned = this.settings.researchSidebarPinned === true;
    this.data.settings = { ...this.settings };
    if (Object.keys(patch).some(key => /^(translationProvider|translationTarget|deepl|openai)/.test(key))) this.translationCache?.clear();
    if (Object.prototype.hasOwnProperty.call(patch, 'translationProvider')) {
      this.translationRateLimitUntil = 0;
      this.translationNextRequestAt = 0;
    }
    await (this.storageReady ? this.persistPluginSettings() : this.persistLegacyData());
    try { this.translationPanel?.refreshSettings?.(); } catch (error) { console.error('[MuPDF Reader] floating panel settings refresh failed', error); }
    if (Object.prototype.hasOwnProperty.call(patch, 'annotationDisplayMode') || Object.prototype.hasOwnProperty.call(patch, 'favoriteTags')) {
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
        try { leaf?.view?.reader?.refreshNoteSettings?.(); } catch (_) {}
      }
    }
  }


  isPrimaryWorkspaceLeaf(leaf) {
    if (!leaf?.containerEl) return true;
    try {
      return !!leaf.containerEl.closest?.('.workspace-split.mod-root');
    } catch (_) {
      return true;
    }
  }

  captureResearchSidebarState() {
    const leaf = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE)[0];
    const view = leaf?.view;
    if (view?.snapshotState) this.researchSidebarState = view.snapshotState();
    return this.researchSidebarState;
  }

  async syncResearchSidebarVisibility(triggerLeaf = null) {
    if (this.settings?.researchSidebarPinned) return;
    const leaf = triggerLeaf || this.app.workspace.activeLeaf;
    const type = leaf?.view?.getViewType?.();

    // Normal sidebar/auxiliary-pane interactions must not hide the research view.
    // However, an explicit no-argument sync (used right after the user unpins the
    // sidebar) must look through the sidebar and evaluate the most recent primary
    // content view. Otherwise the Pin appears impossible to turn off while the
    // sidebar itself owns focus.
    if (triggerLeaf && type === SIDEBAR_VIEW_TYPE) return;
    if (triggerLeaf && type !== VIEW_TYPE && !this.isPrimaryWorkspaceLeaf(triggerLeaf)) return;

    let contextType = type || '';
    if (!triggerLeaf && (type === SIDEBAR_VIEW_TYPE || (leaf && !this.isPrimaryWorkspaceLeaf(leaf)))) {
      contextType = this.lastMainViewType || '';
    }

    const inReader = contextType === VIEW_TYPE;
    const sideLeaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);

    if (!inReader) {
      if (!sideLeaves.length) return;
      this.captureResearchSidebarState();
      this.researchSidebarAutoHidden = true;
      try { this.app.workspace.detachLeavesOfType(SIDEBAR_VIEW_TYPE); } catch (error) { console.error('[MuPDF Reader] failed to auto-hide research sidebar', error); }
      return;
    }

    if (this.researchSidebarAutoHidden && !sideLeaves.length) {
      this.researchSidebarAutoHidden = false;
      const tab = this.researchSidebarState?.tab || 'annotations';
      await this.openResearchSidebar(tab, { autoRestore: true });
    }
  }

  getCurrentReaderFilePath() {
    const active = this.app.workspace.getMostRecentLeaf?.() || this.app.workspace.activeLeaf;
    if (active?.view?.getViewType?.() === VIEW_TYPE && active.view.filePath) return active.view.filePath;
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    const visible = leaves.find((leaf) => leaf?.view?.filePath && leaf?.view?.containerEl?.isConnected);
    return visible?.view?.filePath || this.lastReaderFilePath || '';
  }

  getReaderForFile(filePath) {
    const path = String(filePath || '');
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf?.view?.filePath === path && leaf.view.reader && !leaf.view.reader.destroyed) return leaf.view.reader;
    }
    return null;
  }

  async ensureReader(filePath, openIfMissing = true) {
    const path = String(filePath || '');
    let reader = this.getReaderForFile(path);
    if (reader) return reader;
    if (!openIfMissing) return null;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'pdf') return null;
    await this.openPdf(file, false);
    for (let i = 0; i < 30; i++) {
      reader = this.getReaderForFile(path);
      if (reader?.docId && reader.pageNodes?.length) return reader;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return this.getReaderForFile(path);
  }

  async openResearchSidebar(tab = 'annotations', options = {}) {
    let leaf = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf?.(false) || this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: SIDEBAR_VIEW_TYPE, active: false });
    }
    const view = leaf.view;
    const desiredTab = options.autoRestore ? (this.researchSidebarState?.tab || tab) : tab;
    if (view?.setTab) view.setTab(desiredTab);
    if (!options.autoRestore) this.researchSidebarAutoHidden = false;
    try { this.app.workspace.revealLeaf(leaf); } catch (_) {}
    return view;
  }

  refreshResearchSidebar() {
    for (const leaf of this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE)) {
      try { leaf?.view?.render?.(); } catch (_) {}
    }
  }

  getReadingPosition(filePath) {
    const pos = this.data?.readingPositions?.[filePath];
    return pos ? { ...pos } : null;
  }

  rememberReadingPosition(filePath, position) {
    if (!filePath || this.settings?.rememberReadingPosition === false || !position) return;
    if (!this.data.readingPositions) this.data.readingPositions = {};
    this.data.readingPositions[filePath] = {
      page: Math.max(0, Math.round(Number(position.page) || 0)),
      ratio: clamp(Number(position.ratio) || 0, 0, 0.98),
      zoom: clamp(Number(position.zoom) || 1, MIN_ZOOM, MAX_ZOOM),
      updatedAt: Date.now()
    };
    (this.storageReady ? this.persistDocument(filePath) : this.persistLegacyData()).catch((error) => console.error('[MuPDF Reader] failed to persist reading position', error));
  }

  getAllAnnotations() {
    const rows = [];
    for (const [filePath, items] of Object.entries(this.data?.annotations || {})) {
      for (const annotation of items || []) rows.push({ filePath, annotation: { ...annotation, quads: (annotation.quads || []).map((q) => q.slice()), ...(Array.isArray(annotation.rect) ? { rect: annotation.rect.slice() } : {}), tags: normalizeTags(annotation.tags || []), presentation: { ...(annotation.presentation || {}) } } });
    }
    return rows;
  }

  annotationMarkdown(filePath, annotation) {
    const pieces = [];
    const quote = String(annotation?.text || '').trim().replace(/\s+/g, ' ');
    if (quote) pieces.push(`> ${quote}`);
    else if (annotation?.type === 'region') pieces.push(`> [区域摘录 · 第 ${Math.max(1, Number(annotation?.page || 0) + 1)} 页]`);
    const comment = String(annotation?.comment || '').trim();
    if (comment) pieces.push(comment);
    const tags = normalizeTags(annotation?.tags || []);
    if (tags.length) pieces.push(tags.map((tag) => `#${tag}`).join(' '));
    const page = Math.max(1, Number(annotation?.page || 0) + 1);
    const wiki = `[[${filePath}#page=${page}]]`;
    const deep = `obsidian://mupdf-reader?file=${encodeURIComponent(filePath)}&page=${page}&annotation=${encodeURIComponent(annotation?.id || '')}`;
    pieces.push(`${wiki} · [在 MuPDF Reader 中定位](${deep})`);
    return pieces.join('\n\n');
  }

  async copyAnnotationMarkdown(filePath, annotation) {
    try {
      await navigator.clipboard.writeText(this.annotationMarkdown(filePath, annotation));
      new Notice('已复制 Markdown 引用');
    } catch (error) {
      console.error('[MuPDF Reader] copy markdown reference failed', error);
      new Notice('复制 Markdown 引用失败');
    }
  }

  async navigateToAnnotation(filePath, annotationId) {
    const annotation = this.getAnnotationsForFile(filePath).find((item) => item.id === annotationId);
    if (!annotation) { new Notice('找不到该标注'); return; }
    const reader = await this.ensureReader(filePath, true);
    if (!reader) { new Notice('无法打开对应 PDF'); return; }
    reader.focusAnnotation(annotationId, 'auto');
  }

  async openAnnotationEditor(filePath, annotationId) {
    const reader = await this.ensureReader(filePath, true);
    if (!reader) return;
    const annotation = reader.annotations.find((item) => item.id === annotationId);
    if (!annotation) return;
    reader.focusAnnotation(annotationId, 'auto');
    window.setTimeout(() => reader.openAnnotationComment(annotation), 80);
  }


  openTranslationPanel(options = {}) {
    if (!this.translationPanel) this.translationPanel = new MuPdfTranslationFloatingPanel(this);
    const panel = this.translationPanel.open();
    const active = this.app.workspace.mainLeaf?.view?.reader;
    const selection = active?.selection;
    if (!options.skipSelection && selection?.text) {
      void panel.handleSelection({ text: selection.text, filePath: active.file.path, fileName: active.file.name, pageIndex: selection.pageIndex, pageNumber: selection.pageIndex + 1, selectionRect: active.selectionClientRect(selection.pageIndex, selection.quads) }, { force: true });
    }
    return panel;
  }

  toggleTranslationPanel() {
    if (this.translationPanel?.isOpen()) return this.translationPanel.close();
    return this.openTranslationPanel();
  }

  async translatePayloadInPanel(payload) {
    const panel = this.openTranslationPanel({ skipSelection: true });
    await panel.handleSelection(payload, { force: true });
  }

  handleReaderSelection(payload) {
    if (!this.translationPanel?.isOpen()) return;
    try { this.translationPanel.queueSelection(payload); } catch (error) { console.error('[MuPDF Reader] auto translation dispatch failed', error); }
  }

  persistTranslationPanelGeometry(geometry = {}) {
    if (!this.settings || !this.data) return;
    this.settings.translationPanelX = Number.isFinite(Number(geometry.x)) ? Number(geometry.x) : this.settings.translationPanelX;
    this.settings.translationPanelY = Number.isFinite(Number(geometry.y)) ? Number(geometry.y) : this.settings.translationPanelY;
    this.settings.translationPanelWidth = Number.isFinite(Number(geometry.width)) ? clamp(Number(geometry.width), 300, 1200) : this.settings.translationPanelWidth;
    this.settings.translationPanelHeight = Number.isFinite(Number(geometry.height)) ? clamp(Number(geometry.height), 220, 1200) : this.settings.translationPanelHeight;
    this.data.settings = { ...this.settings };
    (this.storageReady ? this.persistPluginSettings() : this.persistLegacyData()).catch((error) => console.error('[MuPDF Reader] failed to persist translation panel geometry', error));
  }


  normalizeTranslationText(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00ad/g, '')
      .replace(/[\u200b\ufeff]/g, '')
      .replace(/[ﬀﬁﬂﬃﬄ]/g, value => ({ 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl' })[value])
      .replace(/([A-Za-z])-[ \t]*\n[ \t]*([a-z])/g, '$1$2')
      .replace(/[ \t]+/g, ' ')
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .trim();
  }

  splitTranslationText(text, maxChars = TRANSLATION_CHUNK_CHARS) {
    const source = String(text || '').trim();
    if (!source) return [];
    const chunks = [];
    let rest = source;
    while (rest.length > maxChars) {
      let cut = maxChars;
      const floor = Math.floor(maxChars * 0.62);
      const probe = rest.slice(0, maxChars + 1);
      const candidates = [probe.lastIndexOf('\n\n'), probe.lastIndexOf('. '), probe.lastIndexOf('? '), probe.lastIndexOf('! '), probe.lastIndexOf('; '), probe.lastIndexOf(', '), probe.lastIndexOf(' ')];
      const best = Math.max(...candidates.filter((n) => n >= floor));
      if (best >= floor) cut = best + (probe.slice(best, best + 2) === '\n\n' ? 2 : 1);
      chunks.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trimStart();
    }
    if (rest) chunks.push(rest);
    return chunks.filter(Boolean);
  }

  sleepTranslation(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));
  }

  isTranslationRateLimitError(error) {
    const status = Number(error?.status || error?.statusCode || error?.response?.status || 0);
    const message = String(error?.message || error || '');
    return status === 429 || /(?:status\s*429|http\s*429|429\s+too\s+many\s+requests|too\s+many\s+requests)/i.test(message);
  }

  translationCooldownRemainingMs() {
    return Math.max(0, Number(this.translationRateLimitUntil || 0) - Date.now());
  }

  async runTranslationRequest(task, minIntervalMs = TRANSLATION_MIN_REQUEST_INTERVAL_MS, signal) {
    const execute = async () => {
      signal?.throwIfAborted();
      const cooldown = this.translationCooldownRemainingMs();
      if (cooldown > 0) {
        const seconds = Math.max(1, Math.ceil(cooldown / 1000));
        const error = new Error(`翻译服务正在限流冷却，请约 ${seconds} 秒后重试`);
        error.code = 'TRANSLATION_RATE_LIMIT_COOLDOWN';
        error.retryAfterMs = cooldown;
        throw error;
      }

      const spacing = Math.max(0, Number(this.translationNextRequestAt || 0) - Date.now());
      if (spacing > 0) await this.sleepTranslation(spacing);
      signal?.throwIfAborted();
      // Reserve the next slot before issuing the request so queued calls stay serialized.
      this.translationNextRequestAt = Date.now() + Math.max(0, Number(minIntervalMs) || 0);
      return task();
    };

    const queued = this.translationRequestTail.then(execute, execute);
    this.translationRequestTail = queued.catch(() => undefined);
    return queued;
  }

  async requestGoogleWebChunk(text, target, signal) {
    const params = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: target, dt: 't', q: text });
    const response = await requestUrl({
      url: `https://translate.googleapis.com/translate_a/single?${params.toString()}`,
      method: 'GET',
      signal,
      headers: { Accept: 'application/json,text/plain,*/*' }
    });
    let payload = response?.json;
    if (!payload && response?.text) payload = JSON.parse(response.text);
    const rows = Array.isArray(payload?.[0]) ? payload[0] : [];
    const translatedText = rows.map((row) => Array.isArray(row) && typeof row[0] === 'string' ? row[0] : '').join('').trim();
    if (!translatedText) throw new Error('翻译服务返回了空结果');
    return { translatedText, detectedLanguage: typeof payload?.[2] === 'string' ? payload[2] : 'auto' };
  }

  async translateGoogleWebChunk(text, target, signal) {
    try {
      return await this.runTranslationRequest(() => this.requestGoogleWebChunk(text, target, signal), TRANSLATION_MIN_REQUEST_INTERVAL_MS, signal);
    } catch (error) {
      signal?.throwIfAborted();
      if (!this.isTranslationRateLimitError(error)) throw error;

      // Pause the whole provider immediately so selections that arrive while this
      // request is backing off do not create a burst of additional 429 responses.
      this.translationRateLimitUntil = Math.max(this.translationRateLimitUntil || 0, Date.now() + TRANSLATION_RATE_LIMIT_RETRY_MS);
      // A single conservative retry is useful for a transient burst, while a long
      // cooldown prevents auto-translation from hammering an undocumented web endpoint.
      await this.sleepTranslation(TRANSLATION_RATE_LIMIT_RETRY_MS + 80);
      signal?.throwIfAborted();
      this.translationRateLimitUntil = Math.min(this.translationRateLimitUntil || 0, Date.now());
      try {
        // Do not enter cooldown until the retry also fails.
        this.translationNextRequestAt = Math.max(this.translationNextRequestAt, Date.now() + TRANSLATION_MIN_REQUEST_INTERVAL_MS);
        return await this.runTranslationRequest(() => this.requestGoogleWebChunk(text, target, signal), TRANSLATION_MIN_REQUEST_INTERVAL_MS, signal);
      } catch (retryError) {
        if (!this.isTranslationRateLimitError(retryError)) throw retryError;
        this.translationRateLimitUntil = Date.now() + TRANSLATION_RATE_LIMIT_COOLDOWN_MS;
        const finalError = new Error('翻译服务触发 429 限流，已暂停自动请求 60 秒。稍后可点击“重试”；若频繁出现，建议改用带 API Key 的正式翻译 Provider。');
        finalError.code = 'TRANSLATION_RATE_LIMIT';
        finalError.retryAfterMs = TRANSLATION_RATE_LIMIT_COOLDOWN_MS;
        throw finalError;
      }
    }
  }

  getDeepLEndpoint() {
    const key = String(this.settings?.deeplApiKey || '').trim();
    const mode = this.settings?.deeplEndpointMode || 'auto';
    const useFree = mode === 'free' || (mode === 'auto' && key.endsWith(':fx'));
    return `${useFree ? 'https://api-free.deepl.com' : 'https://api.deepl.com'}/v2/translate`;
  }

  async requestDeepL(text, target, signal) {
    const apiKey = String(this.settings?.deeplApiKey || '').trim();
    if (!apiKey) throw new Error('请先在 MuPDF Reader 设置中填写 DeepL API Key');
    const targetLang = DEEPL_TARGET_CODES[target];
    if (!targetLang) throw new Error(`DeepL 暂不支持当前目标语言：${target}`);
    const response = await requestUrl({
      url: this.getDeepLEndpoint(),
      signal,
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ text: [text], target_lang: targetLang, preserve_formatting: true })
    });
    const payload = response?.json || (response?.text ? JSON.parse(response.text) : null);
    const translation = Array.isArray(payload?.translations) ? payload.translations[0] : null;
    const translatedText = typeof translation?.text === 'string' ? translation.text.trim() : '';
    if (!translatedText) throw new Error('DeepL 返回了空结果');
    return {
      translatedText,
      detectedLanguage: String(translation?.detected_source_language || 'auto').toLowerCase()
    };
  }

  openAIChatCompletionsUrl() {
    const base = String(this.settings?.openaiBaseUrl || DEFAULT_SETTINGS.openaiBaseUrl).trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) throw new Error('OpenAI-compatible Base URL 必须以 http:// 或 https:// 开头');
    return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
  }

  openAITranslationSystemPrompt(target) {
    const label = TRANSLATION_TARGET_LABELS[target] || target;
    return String(this.settings?.openaiTranslationPrompt || DEFAULT_SETTINGS.openaiTranslationPrompt)
      .replace(/\{target\}/g, label)
      .trim();
  }

  extractOpenAICompatibleText(payload) {
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
      return content.map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        return '';
      }).join('').trim();
    }
    return '';
  }

  isDeepSeekOpenAICompatible() {
    const base = String(this.settings?.openaiBaseUrl || '').toLowerCase();
    const model = String(this.settings?.openaiModel || '').toLowerCase();
    return base.includes('deepseek.com') || model.startsWith('deepseek-') || /deepseek|ds[-_ ]?flash/.test(model);
  }

  openAIRequestBody(text, target, stream = false) {
    const model = String(this.settings?.openaiModel || '').trim();
    if (!model) throw new Error('请先在 MuPDF Reader 设置中填写 OpenAI-compatible 模型 ID');
    const body = {
      model,
      messages: [
        { role: 'system', content: this.openAITranslationSystemPrompt(target) },
        { role: 'user', content: text }
      ],
      stream: !!stream
    };
    // DeepSeek V4 thinking is enabled by default. Translation does not benefit from
    // chain-of-thought, so the fast path explicitly disables it. We only add this
    // DeepSeek-specific field when the endpoint/model looks like DeepSeek.
    if (this.settings?.openaiDeepSeekFastMode !== false && this.isDeepSeekOpenAICompatible()) {
      body.thinking = { type: 'disabled' };
    }
    return body;
  }

  openAIHeaders() {
    const apiKey = String(this.settings?.openaiApiKey || '').trim();
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return headers;
  }

  async requestOpenAICompatibleNonStreaming(text, target, signal) {
    const response = await requestUrl({
      url: this.openAIChatCompletionsUrl(),
      signal,
      method: 'POST',
      headers: this.openAIHeaders(),
      body: JSON.stringify(this.openAIRequestBody(text, target, false))
    });
    const payload = response?.json || (response?.text ? JSON.parse(response.text) : null);
    const translatedText = this.extractOpenAICompatibleText(payload);
    if (!translatedText) {
      const message = payload?.error?.message ? `：${payload.error.message}` : '';
      throw new Error(`OpenAI-compatible Provider 返回了空结果${message}`);
    }
    return { translatedText, detectedLanguage: 'auto', streamed: false };
  }

  async requestOpenAICompatibleStreaming(text, target, onDelta, signal) {
    if (typeof globalThis.fetch !== 'function') {
      const error = new Error('当前环境不支持流式 fetch');
      error.code = 'TRANSLATION_STREAM_UNAVAILABLE';
      throw error;
    }
    let receivedContent = false;
    let translatedText = '';
    let response;
    try {
      response = await globalThis.fetch(this.openAIChatCompletionsUrl(), {
        method: 'POST',
        signal,
        headers: { ...this.openAIHeaders(), Accept: 'text/event-stream' },
        body: JSON.stringify(this.openAIRequestBody(text, target, true))
      });
    } catch (cause) {
      signal?.throwIfAborted();
      const error = new Error(`流式连接不可用：${cause?.message || String(cause)}`);
      error.code = 'TRANSLATION_STREAM_UNAVAILABLE';
      error.cause = cause;
      throw error;
    }

    if (!response.ok) {
      let detail = '';
      try { detail = (await response.text()).slice(0, 500); } catch (_) {}
      const error = new Error(`Request failed, status ${response.status}${detail ? `：${detail}` : ''}`);
      error.status = response.status;
      throw error;
    }
    if (!response.body?.getReader) {
      const error = new Error('Provider 未返回可读取的流');
      error.code = 'TRANSLATION_STREAM_UNAVAILABLE';
      throw error;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const consumeLine = (rawLine) => {
      const line = String(rawLine || '').trim();
      if (!line || line.startsWith(':')) return false;
      const data = line.startsWith('data:') ? line.slice(5).trim() : line;
      if (!data) return false;
      if (data === '[DONE]') return true;
      let payload;
      try { payload = JSON.parse(data); } catch (_) { return false; }
      const delta = payload?.choices?.[0]?.delta?.content;
      let piece = '';
      if (typeof delta === 'string') piece = delta;
      else if (Array.isArray(delta)) {
        piece = delta.map((part) => typeof part === 'string' ? part : (typeof part?.text === 'string' ? part.text : '')).join('');
      }
      if (piece) {
        receivedContent = true;
        translatedText += piece;
        try { onDelta?.(translatedText, piece); } catch (error) { console.error('[MuPDF Reader] translation onDelta failed', error); }
      }
      return false;
    };

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = done ? '' : (lines.pop() || '');
      let completed = false;
      for (const line of lines) {
        if (consumeLine(line)) {
          completed = true;
          break;
        }
      }
      if (completed || done) break;
    }
    if (buffer.trim()) consumeLine(buffer);
    translatedText = translatedText.trim();
    if (!translatedText) {
      const error = new Error('流式 Provider 未返回译文内容');
      error.code = receivedContent ? 'TRANSLATION_STREAM_EMPTY' : 'TRANSLATION_STREAM_UNAVAILABLE';
      error.receivedContent = receivedContent;
      throw error;
    }
    return { translatedText, detectedLanguage: 'auto', streamed: true };
  }

  async requestOpenAICompatible(text, target, options = {}) {
    const useStreaming = this.settings?.openaiStreaming !== false && typeof options.onDelta === 'function';
    if (useStreaming) {
      try {
        return await this.requestOpenAICompatibleStreaming(text, target, options.onDelta, options.signal);
      } catch (error) {
        options.signal?.throwIfAborted();
        // Obsidian requestUrl bypasses CORS but cannot stream. If renderer fetch/SSE is
        // unavailable, transparently fall back to requestUrl rather than breaking translation.
        if (error?.code !== 'TRANSLATION_STREAM_UNAVAILABLE' || error?.receivedContent) throw error;
        console.warn('[MuPDF Reader] streaming unavailable, falling back to non-streaming requestUrl', error);
      }
    }
    return this.requestOpenAICompatibleNonStreaming(text, target, options.signal);
  }

  async translateFormalProvider(provider, requestTask) {
    try {
      // Paid/API-key providers are intentionally NOT serialized behind Google Web's
      // 1.4 s queue and do not inherit Google's global cooldown. Let the provider
      // enforce its own quota and surface a real 429 only if one actually occurs.
      return await requestTask();
    } catch (error) {
      if (!this.isTranslationRateLimitError(error)) throw error;
      const finalError = new Error(`${TRANSLATION_PROVIDER_LABELS[provider] || provider} 返回 429。插件未施加额外限流，请稍后重试或检查账户/Provider 配额。`);
      finalError.code = 'TRANSLATION_PROVIDER_RATE_LIMIT';
      finalError.status = 429;
      throw finalError;
    }
  }

  async translateText(text, options = {}) {
    options.signal?.throwIfAborted();
    const sourceText = this.normalizeTranslationText(text);
    if (!sourceText) throw new Error('没有可翻译的文字');
    if (sourceText.length > MAX_TRANSLATION_CHARS) throw new Error(`选中文字过长，请控制在 ${MAX_TRANSLATION_CHARS} 个字符以内`);
    const target = this.settings?.translationTarget || DEFAULT_SETTINGS.translationTarget;
    const provider = this.settings?.translationProvider || DEFAULT_SETTINGS.translationProvider;
    if (!TRANSLATION_PROVIDER_LABELS[provider]) throw new Error(`不支持的翻译 Provider：${provider}`);
    const providerFingerprint = provider === 'openai-compatible'
      ? `${this.settings?.openaiBaseUrl || ''}|${this.settings?.openaiModel || ''}|${this.settings?.openaiTranslationPrompt || ''}`
      : provider === 'deepl' ? this.settings?.deeplEndpointMode || 'auto' : '';
    const cacheKey = `${provider}|${providerFingerprint}|${target}|${sourceText}`;
    const cached = this.translationCache?.get(cacheKey);
    if (cached) {
      try { options.onDelta?.(cached.translatedText || '', cached.translatedText || ''); } catch (_) {}
      return { ...cached, cached: true };
    }
    const inflight = this.translationInflight?.get(cacheKey);
    if (inflight) return inflight;

    const task = (async () => {
      let translatedText = '';
      let detectedLanguage = 'auto';
      let streamed = false;
      if (provider === 'google-web') {
        const chunks = this.splitTranslationText(sourceText);
        const translatedParts = [];
        for (const chunk of chunks) {
          options.signal?.throwIfAborted();
          const result = await this.translateGoogleWebChunk(chunk, target, options.signal);
          translatedParts.push(result.translatedText);
          if (detectedLanguage === 'auto' && result.detectedLanguage) detectedLanguage = result.detectedLanguage;
        }
        translatedText = translatedParts.join('\n');
      } else if (provider === 'deepl') {
        const result = await this.translateFormalProvider(provider, () => this.requestDeepL(sourceText, target, options.signal));
        translatedText = result.translatedText;
        detectedLanguage = result.detectedLanguage || 'auto';
      } else if (provider === 'openai-compatible') {
        const result = await this.translateFormalProvider(provider, () => this.requestOpenAICompatible(sourceText, target, options));
        translatedText = result.translatedText;
        detectedLanguage = result.detectedLanguage || 'auto';
        streamed = !!result.streamed;
      }

      const result = {
        sourceText,
        translatedText,
        detectedLanguage,
        targetLanguage: target,
        provider,
        providerLabel: TRANSLATION_PROVIDER_LABELS[provider] || provider,
        streamed: !!streamed,
        cached: false
      };
      options.signal?.throwIfAborted();
      if (this.translationCache) {
        this.translationCache.set(cacheKey, result);
        while (this.translationCache.size > 100) this.translationCache.delete(this.translationCache.keys().next().value);
      }
      return { ...result };
    })();

    this.translationInflight?.set(cacheKey, task);
    const removeAborted = () => { if (this.translationInflight?.get(cacheKey) === task) this.translationInflight.delete(cacheKey); };
    options.signal?.addEventListener('abort', removeAborted, { once: true });
    try {
      return await task;
    } finally {
      options.signal?.removeEventListener('abort', removeAborted);
      if (this.translationInflight?.get(cacheKey) === task) this.translationInflight.delete(cacheKey);
    }
  }

  sanitizeAnnotation(item) {
    if (!item || !['highlight', 'underline', 'note', 'region'].includes(item.type) || !Number.isInteger(item.page) || item.page < 0) return null;
    const type = item.type === 'note' ? 'note' : item.type === 'region' ? 'region' : item.type === 'underline' ? 'underline' : 'highlight';
    const quads = Array.isArray(item.quads)
      ? item.quads.filter((quad) => Array.isArray(quad) && quad.length >= 8 && quad.slice(0, 8).every((v) => Number.isFinite(Number(v))))
        .map((quad) => quad.slice(0, 8).map(Number))
      : [];
    if (!['note', 'region'].includes(type) && !quads.length) return null;
    const rect = Array.isArray(item.rect) && item.rect.length >= 4 ? item.rect.slice(0, 4).map(Number) : [];
    if (type === 'region' && (rect.length < 4 || !rect.every(Number.isFinite) || Math.abs(rect[2] - rect[0]) < 0.5 || Math.abs(rect[3] - rect[1]) < 0.5)) return null;
    const x = Number(item.x);
    const y = Number(item.y);
    if (type === 'note' && (!Number.isFinite(x) || !Number.isFinite(y))) return null;
    const color = ANNOTATION_COLORS.includes(item.color) ? item.color : 'yellow';
    const presentationRaw = item.presentation && typeof item.presentation === 'object' ? item.presentation : {};
    const hasManualOffset = Number.isFinite(Number(presentationRaw.offsetX)) && Number.isFinite(Number(presentationRaw.offsetY));
    const presentation = {
      pinned: presentationRaw.pinned === true,
      side: ['auto', 'left', 'right'].includes(presentationRaw.side) ? presentationRaw.side : 'auto',
      placementMode: ['auto', 'manual'].includes(presentationRaw.placementMode) ? presentationRaw.placementMode : (hasManualOffset ? 'manual' : 'auto')
    };
    if (Number.isFinite(Number(presentationRaw.offsetX))) presentation.offsetX = Number(presentationRaw.offsetX);
    if (Number.isFinite(Number(presentationRaw.offsetY))) presentation.offsetY = Number(presentationRaw.offsetY);
    if (Number.isFinite(Number(presentationRaw.width))) presentation.width = clamp(Number(presentationRaw.width), 180, 520);
    if (Number.isFinite(Number(presentationRaw.height))) presentation.height = clamp(Number(presentationRaw.height), 80, 720);
    return {
      id: typeof item.id === 'string' && item.id ? item.id : this.createAnnotationId(),
      type,
      page: item.page,
      text: typeof item.text === 'string' ? item.text : '',
      quads,
      ...(type === 'note' ? { x, y } : {}),
      ...(type === 'region' ? {
        rect,
        previewPath: typeof item.previewPath === 'string' ? item.previewPath : '',
        previewMime: typeof item.previewMime === 'string' ? item.previewMime : 'image/webp',
        previewVersion: Math.max(0, Math.min(20, Number(item.previewVersion) || 0)),
        previewWidth: Math.max(0, Math.min(10000, Number(item.previewWidth) || 0)),
        previewHeight: Math.max(0, Math.min(10000, Number(item.previewHeight) || 0)),
        previewPixelScale: Math.max(0, Math.min(20, Number(item.previewPixelScale) || 0)),
        // Transient only: v0.10 storage externalizes this immediately. Keep a generous
        // guard so a high-quality WebP is never truncated before persistRegionPreview().
        previewDataUrl: typeof item.previewDataUrl === 'string' && item.previewDataUrl.startsWith('data:image/') ? item.previewDataUrl.slice(0, 8_000_000) : ''
      } : {}),
      color,
      fingerprint: typeof item.fingerprint === 'string' ? item.fingerprint : '',
      comment: typeof item.comment === 'string' ? item.comment.slice(0, 50000) : '',
      tags: normalizeTags(item.tags || []),
      presentation,
      createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : Date.now(),
      updatedAt: Number.isFinite(Number(item.updatedAt)) ? Number(item.updatedAt) : Date.now()
    };
  }

  createAnnotationId() {
    try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch (_) {}
    return `ann-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  getAnnotationsForFile(filePath) {
    const items = this.data?.annotations?.[filePath];
    if (!Array.isArray(items)) return [];
    return items.map((item) => ({ ...item, quads: (item.quads || []).map((quad) => quad.slice()), ...(Array.isArray(item.rect) ? { rect: item.rect.slice() } : {}), tags: normalizeTags(item.tags || []), presentation: { ...(item.presentation || {}) } }));
  }

  getAllAnnotationTags() {
    const tags = [];
    for (const items of Object.values(this.data?.annotations || {})) {
      if (!Array.isArray(items)) continue;
      for (const item of items) tags.push(...normalizeTags(item?.tags || []));
    }
    return normalizeTags([...(this.settings?.favoriteTags || []), ...tags]).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }

  subscribeAnnotations(listener) {
    this.annotationListeners.add(listener);
    return () => this.annotationListeners?.delete(listener);
  }

  emitAnnotationChange(filePath) {
    for (const listener of this.annotationListeners || []) {
      try { listener(filePath); } catch (error) { console.error('[MuPDF Reader] annotation listener failed', error); }
    }
  }

  persistAnnotationData(filePath = null) {
    this.saveChain = this.saveChain.catch(() => {}).then(async () => {
      if (this.storageReady) {
        if (filePath) await this.persistDocument(filePath);
        else await this.persistPluginSettings();
      } else {
        await this.persistLegacyData();
      }
    });
    return this.saveChain;
  }

  async addAnnotation(filePath, annotation) {
    let clean = this.sanitizeAnnotation(annotation);
    if (!clean) throw new Error('Invalid annotation');
    if (this.storageReady && clean.type === 'region' && clean.previewDataUrl) clean = await this.persistRegionPreview(filePath, clean);
    if (!this.data.annotations[filePath]) this.data.annotations[filePath] = [];
    const items = this.data.annotations[filePath];
    const duplicate = clean.fingerprint && items.some((item) => item.fingerprint === clean.fingerprint);
    if (!duplicate) items.push(clean);
    await this.persistAnnotationData(filePath);
    this.emitAnnotationChange(filePath);
    return clean;
  }

  async updateAnnotation(filePath, annotationId, patch = {}) {
    const items = this.data.annotations[filePath];
    if (!Array.isArray(items)) return null;
    const index = items.findIndex((item) => item.id === annotationId);
    if (index < 0) return null;
    const current = items[index];
    const candidate = {
      ...current,
      ...patch,
      id: current.id,
      page: Number.isInteger(patch.page) ? patch.page : current.page,
      createdAt: current.createdAt,
      updatedAt: Date.now()
    };
    let clean = this.sanitizeAnnotation(candidate);
    if (!clean) throw new Error('Invalid annotation update');
    if (this.storageReady && clean.type === 'region' && clean.previewDataUrl) clean = await this.persistRegionPreview(filePath, clean);
    items[index] = clean;
    await this.persistAnnotationData(filePath);
    this.emitAnnotationChange(filePath);
    return { ...clean, quads: (clean.quads || []).map((quad) => quad.slice()), tags: normalizeTags(clean.tags || []), presentation: { ...(clean.presentation || {}) } };
  }

  async removeAnnotation(filePath, annotationId) {
    const items = this.data.annotations[filePath];
    if (!Array.isArray(items)) return false;
    const removed = items.find((item) => item.id === annotationId) || null;
    const next = items.filter((item) => item.id !== annotationId);
    if (next.length === items.length) return false;
    if (next.length) this.data.annotations[filePath] = next;
    else delete this.data.annotations[filePath];
    if (this.storageReady && removed?.type === 'region' && removed.previewPath) {
      try {
        const adapter = this.app.vault.adapter;
        if (typeof adapter.exists !== 'function' || await adapter.exists(removed.previewPath)) await adapter.remove(removed.previewPath);
      } catch (error) { console.warn('[MuPDF Reader] failed to delete region preview', error); }
    }
    await this.persistAnnotationData(filePath);
    this.emitAnnotationChange(filePath);
    return true;
  }

  async onunload() {
    this.annotationListeners?.clear();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(SIDEBAR_VIEW_TYPE);
    this.translationPanel?.destroy?.();
    this.translationPanel = null;
  }

  async openPdf(file, newLeaf) {
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'pdf') {
      new Notice('MuPDF Reader 只能打开 PDF 文件');
      return;
    }
    const leaf = this.app.workspace.getLeaf(Boolean(newLeaf));
    const savedZoom = this.settings?.rememberReadingPosition !== false ? this.getReadingPosition(file.path)?.zoom : null;
    await leaf.setViewState({ type: VIEW_TYPE, active: true, state: { file: file.path, zoom: clamp(Number(savedZoom) || 1, MIN_ZOOM, MAX_ZOOM) } });
    this.lastReaderFilePath = file.path;
    this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  async loadMuPdfRuntimeAssets() {
    if (!this.runtimeAssetsPromise) {
      this.runtimeAssetsPromise = (async () => {
        const configDir = this.app.vault.configDir || '.obsidian';
        const basePath = `${configDir}/plugins/${this.manifest.id}/vendor/mupdf`;
        const adapter = this.app.vault.adapter;
        const modulePath = `${basePath}/mupdf.js`;
        const wasmLoaderPath = `${basePath}/mupdf-wasm.js`;
        const wasmPath = `${basePath}/mupdf-wasm.wasm`;

        for (const path of [modulePath, wasmLoaderPath, wasmPath]) {
          if (typeof adapter.exists === 'function' && !(await adapter.exists(path))) {
            throw new Error(`缺少 MuPDF 本地运行时文件：${path}`);
          }
        }

        const [moduleSource, wasmLoaderSource, wasmBinary] = await Promise.all([
          adapter.read(modulePath),
          adapter.read(wasmLoaderPath),
          adapter.readBinary(wasmPath)
        ]);

        if (!moduleSource || !wasmLoaderSource || !(wasmBinary instanceof ArrayBuffer) || !wasmBinary.byteLength) {
          throw new Error('MuPDF 本地运行时读取失败或文件为空');
        }

        return { moduleSource, wasmLoaderSource, wasmBinary };
      })();
    }
    return this.runtimeAssetsPromise;
  }
};
