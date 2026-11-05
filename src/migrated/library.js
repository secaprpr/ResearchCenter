// Ported from the user-provided library plugin; see PROVENANCE.json.
import {
  Plugin,
  Modal,
  Notice,
  PluginSettingTab,
  Setting,
  normalizePath,
  TFile,
  setIcon,
  Menu,
  MarkdownRenderer,
  loadPdfJs,
  requestUrl,
} from "../port/obsidian.js";

const DEFAULT_COLUMNS = {
  name: true,
  year: true,
  venue: true,
  authors: true,
  status: true,
  rating: true,
  topics: true,
  figures: true,
  note: true,
  collections: false,
  projects: false,
  citekey: false,
  doi: true,
  pdf: true,
  edited: true,
};

const DEFAULT_WIDTHS = {
  name: 430,
  year: 82,
  venue: 145,
  authors: 160,
  status: 132,
  rating: 132,
  topics: 190,
  figures: 92,
  note: 220,
  collections: 180,
  projects: 180,
  citekey: 160,
  doi: 108,
  pdf: 72,
  edited: 150,
};

const DEFAULT_SETTINGS = {
  papersFolder: "Research/10 Papers",
  topicsFolder: "Research/30 Topics",
  collectionsFolder: "Research/40 Collections",
  projectsFolder: "Research/50 Projects",
  figuresFolder: "Research/25 Figures",

  // Citation / generated bibliography.
  // `library.bib` is a generated artifact; Paper Markdown/YAML
  // remains the only bibliographic source of truth.
  bibFilePath: "Research/99 System/library.bib",
  autoSyncBibliography: true,

  // PDF-first import
  inboxFolder: "Research/00 Inbox",
  pdfFolder: "Research/20 PDFs",
  scanPages: 3,
  searchRows: 8,
  contactEmail: "",
  semanticScholarApiKey: "",
  openAlexApiKey: "",

  // LLM metadata rescue (OpenAI-compatible Chat Completions)
  llmRescueEnabled: false,
  llmEndpoint: "",
  llmApiKey: "",
  llmVisionModel: "",
  llmTimeoutSeconds: 30,

  defaultPriority: 3,

  columns: DEFAULT_COLUMNS,
  columnWidths: DEFAULT_WIDTHS,
  density: "comfortable",

  // Paper Detail is UI/controller state only.
  detailPanelWidth: 410,
  detailPanelOpen: false,
  detailLastPaperPath: "",

  savedViews: [],

  // Appearance
  fontFamily: "",
  fontSource: "obsidian-interface",
  systemFonts: [],
  fontSize: 13,
};

const STATUS_META = {
  // Legacy/internal key remains "inbox" for paper/v2
  // compatibility. In the UI this means a manually assigned
  // paper workflow state: newly imported / not yet organized.
  // It is NOT the physical PDF Inbox folder.
  inbox: {
    label: "待整理",
    className: "inbox",
    icon: "layers-2",
  },
  queued: {
    label: "待阅读",
    className: "queued",
    icon: "clock-3",
  },
  reading: {
    label: "进行中",
    className: "reading",
    icon: "circle-play",
  },
  read: {
    label: "已完成",
    className: "read",
    icon: "check",
  },
  archived: {
    label: "已归档",
    className: "archived",
    icon: "archive",
  },
};

const COLUMN_META = {
  name:    { label: "Name", icon: "file-text", cls: "rl-col-name" },
  year:    { label: "年份", icon: "calendar-days", cls: "rl-col-year" },
  venue:   { label: "发表单位", icon: "landmark", cls: "rl-col-venue" },
  authors: { label: "作者", icon: "users", cls: "rl-col-authors" },
  status:  { label: "状态", icon: "circle-dot", cls: "rl-col-status" },
  rating:  { label: "重要程度", icon: "star", cls: "rl-col-rating" },
  topics:  { label: "主题", icon: "tags", cls: "rl-col-topics" },
  figures: { label: "图", icon: "image", cls: "rl-col-figures" },
  note:    { label: "备注", icon: "sticky-note", cls: "rl-col-note" },
  collections: { label: "List", icon: "list", cls: "rl-col-collections" },
  projects: { label: "Project", icon: "folder-kanban", cls: "rl-col-projects" },
  citekey: { label: "Citekey", icon: "key-round", cls: "rl-col-citekey" },
  doi:     { label: "DOI", icon: "external-link", cls: "rl-col-doi" },
  pdf:     { label: "PDF", icon: "file-type-2", cls: "rl-col-pdf" },
  edited:  { label: "上次编辑", icon: "clock-3", cls: "rl-col-edited" },
};

class ResearchLibraryPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.addRibbonIcon("book-open", "Open Research Library", () => this.openLibrary());

    this.addCommand({
      id: "open-research-library",
      name: "Open Research Library",
      callback: () => this.openLibrary(),
    });

    this.addCommand({
      id: "import-paper-from-pdf",
      name: "Import paper from Inbox PDF",
      callback: async () => {
        if (!this.currentModal) {
          this.openLibrary();

          await new Promise((resolve) =>
            window.setTimeout(resolve, 120)
          );
        }

        await this.currentModal?.startPdfImport();
      },
    });

    this.addCommand({
      id: "sync-research-bibliography",
      name: "Sync generated library.bib",
      callback: async () => {
        if (!this.currentModal) {
          this.openLibrary();

          await new Promise((resolve) =>
            window.setTimeout(resolve, 160)
          );
        }

        await this.currentModal
          ?.syncBibliography({
            notice: true,
          });
      },
    });

    this.addCommand({
      id: "open-research-maintenance",
      name: "Open Maintenance Center",
      callback: async () => {
        if (!this.currentModal) {
          this.openLibrary();

          await new Promise((resolve) =>
            window.setTimeout(resolve, 160)
          );
        }

        this.currentModal
          ?.openMaintenanceCenter();
      },
    });

    this.addSettingTab(new ResearchLibrarySettingTab(this.app, this));

    this.registerEvent(
      this.app.metadataCache.on(
        "changed",
        (file) => {
          if (
            this.currentModal
            && file instanceof TFile
          ) {
            this.currentModal.scheduleRefresh(
              file
            );
          }
        }
      )
    );

    this.registerEvent(
      this.app.vault.on(
        "create",
        (file) => {
          if (
            this.currentModal
            && file instanceof TFile
          ) {
            this.currentModal.scheduleRefresh(
              file
            );
          }
        }
      )
    );

    this.registerEvent(
      this.app.vault.on(
        "delete",
        (file) => {
          if (
            this.currentModal
            && file instanceof TFile
          ) {
            this.currentModal.scheduleRefresh(
              file
            );
          }
        }
      )
    );

    this.registerEvent(
      this.app.vault.on(
        "rename",
        (
          file,
          oldPath
        ) => {
          if (
            this.currentModal
            && file instanceof TFile
          ) {
            this.currentModal.scheduleRefresh(
              file,
              {
                oldPath,
              }
            );
          }
        }
      )
    );
  }

  onunload() {
    if (this.currentModal) {
      this.currentModal.close();
      this.currentModal = null;
    }
  }

  openLibrary() {
    if (this.currentModal) this.currentModal.close();
    this.currentModal = new ResearchLibraryModal(this.app, this);
    this.currentModal.open();
  }

  async loadSettings() {
    const loaded = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded || {});
    this.settings.columns = Object.assign({}, DEFAULT_COLUMNS, loaded?.columns || {});
    this.settings.columnWidths = Object.assign({}, DEFAULT_WIDTHS, loaded?.columnWidths || {});
    this.settings.savedViews = Array.isArray(loaded?.savedViews)
      ? loaded.savedViews
      : [];
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  commonSystemFonts() {
    const platform =
      navigator.platform
      || "";

    const windows = [
      "Segoe UI",
      "Microsoft YaHei",
      "Microsoft JhengHei",
      "Arial",
      "Calibri",
      "Cambria",
      "Times New Roman",
      "Consolas",
      "Courier New",
    ];

    const mac = [
      "SF Pro Text",
      "SF Pro Display",
      "Helvetica Neue",
      "Helvetica",
      "Arial",
      "PingFang SC",
      "Hiragino Sans GB",
      "Menlo",
      "Monaco",
    ];

    const linux = [
      "Noto Sans",
      "Noto Sans CJK SC",
      "DejaVu Sans",
      "Liberation Sans",
      "Ubuntu",
      "Cantarell",
      "Noto Serif",
      "DejaVu Serif",
      "Noto Sans Mono",
    ];

    if (/Win/i.test(platform)) return windows;
    if (/Mac/i.test(platform)) return mac;

    return linux;
  }

  async querySystemFonts() {
    const collected =
      new Set(
        this.commonSystemFonts()
      );

    // Chromium Local Font Access API.
    // In environments where it is unavailable or denied,
    // the curated platform list remains usable.
    if (
      typeof window.queryLocalFonts === "function"
    ) {
      try {
        const fonts =
          await window.queryLocalFonts();

        for (const font of fonts || []) {
          const family =
            String(font.family || "").trim();

          if (family) {
            collected.add(family);
          }
        }
      }
      catch (error) {
        console.debug(
          "Research Library: local font enumeration unavailable or denied.",
          error
        );
      }
    }

    const result =
      [...collected]
        .filter(Boolean)
        .sort(
          (a, b) =>
            a.localeCompare(
              b,
              undefined,
              { sensitivity: "base" }
            )
        );

    this.settings.systemFonts =
      result;

    await this.saveSettings();

    return result;
  }

  resolveLlmChatCompletionsUrl(
    value = null
  ) {
    let url =
      String(
        value
        ?? this.settings
          ?.llmEndpoint
        ?? ""
      )
        .trim()
        .replace(/\/+$/g, "");

    if (!url) {
      return "";
    }

    // If the user supplied a full chat-completions endpoint,
    // preserve it exactly.
    if (
      /\/chat\/completions$/i.test(
        url
      )
    ) {
      return url;
    }

    // Common OpenAI-compatible base URL ending in /v1.
    if (/\/v1$/i.test(url)) {
      return `${url}/chat/completions`;
    }

    // Plain provider base URL.
    return `${url}/v1/chat/completions`;
  }

  describeLlmRequestError(
    error,
    endpoint = ""
  ) {
    const raw =
      String(
        error?.message
        || error
        || "Unknown error"
      );

    const statusMatch =
      raw.match(
        /\b(?:status|HTTP)\s*[: ]?\s*(\d{3})\b/i
      )
      || raw.match(
        /\b(4\d{2}|5\d{2})\b/
      );

    const status =
      statusMatch
        ? Number(statusMatch[1])
        : 0;

    let hint = "";

    if (status === 400) {
      hint =
        "请求格式或模型参数不被该服务接受。";
    }
    else if (status === 401) {
      hint =
        "API Key 无效、缺失或鉴权方式不正确。";
    }
    else if (status === 403) {
      hint =
        "当前 API Key 没有访问该模型或接口的权限。";
    }
    else if (status === 404) {
      hint =
        "接口路径或模型名称很可能不正确。请重点检查 Base URL / Endpoint。";
    }
    else if (status === 429) {
      hint =
        "请求过于频繁、额度不足或账户限流。";
    }
    else if (status >= 500) {
      hint =
        "服务端暂时异常，请稍后重试。";
    }

    return [
      status
        ? `HTTP ${status}`
        : raw,
      hint,
      endpoint
        ? `请求地址：${endpoint}`
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  extractLlmResponseText(json) {
    const content =
      json?.choices?.[0]
        ?.message?.content
      ?? json?.output_text
      ?? json?.text
      ?? "";

    if (
      Array.isArray(content)
    ) {
      return content
        .map(
          (part) =>
            typeof part
              === "string"
              ? part
              : part?.text
                || part?.content
                || ""
        )
        .filter(Boolean)
        .join("\n");
    }

    return String(
      content || ""
    );
  }

  async requestLlmChatCompletion(
    body,
    {
      timeoutMs = null,
      endpoint = null,
      apiKey = null,
    } = {}
  ) {
    const resolvedEndpoint =
      this.resolveLlmChatCompletionsUrl(
        endpoint
      );

    if (!resolvedEndpoint) {
      throw new Error(
        "未配置 LLM Base URL / Endpoint"
      );
    }

    const key =
      String(
        apiKey
        ?? this.settings
          ?.llmApiKey
        ?? ""
      ).trim();

    const headers = {
      Accept:
        "application/json",
      "Content-Type":
        "application/json",
    };

    if (key) {
      headers.Authorization =
        `Bearer ${key}`;
    }

    const waitMs =
      Math.max(
        5000,
        Math.min(
          120000,
          Number(
            timeoutMs
            ?? (
              Number(
                this.settings
                  ?.llmTimeoutSeconds
              ) || 30
            ) * 1000
          )
        )
      );

    const requestPromise =
      requestUrl({
        url:
          resolvedEndpoint,
        method: "POST",
        headers,
        body:
          JSON.stringify(
            body
          ),
      });

    let timeoutId = null;

    const timeoutPromise =
      new Promise(
        (
          _resolve,
          reject
        ) => {
          timeoutId =
            window.setTimeout(
              () => {
                reject(
                  new Error(
                    `LLM 请求超时（${Math.round(
                      waitMs / 1000
                    )}s）`
                  )
                );
              },
              waitMs
            );
        }
      );

    try {
      const response =
        await Promise.race([
          requestPromise,
          timeoutPromise,
        ]);

      if (
        !response
        || response.status < 200
        || response.status >= 300
      ) {
        throw new Error(
          `HTTP ${
            response?.status
            || "error"
          }`
        );
      }

      return {
        response,
        endpoint:
          resolvedEndpoint,
      };
    }
    catch (error) {
      throw new Error(
        this.describeLlmRequestError(
          error,
          resolvedEndpoint
        )
      );
    }
    finally {
      if (timeoutId) {
        window.clearTimeout(
          timeoutId
        );
      }
    }
  }

  async testLlmConnection() {
    const model =
      String(
        this.settings
          ?.llmVisionModel
        || ""
      ).trim();

    if (
      !String(
        this.settings
          ?.llmEndpoint
        || ""
      ).trim()
    ) {
      throw new Error(
        "请先填写 LLM Base URL / Endpoint。"
      );
    }

    if (!model) {
      throw new Error(
        "请先填写 Vision model。"
      );
    }

    const result =
      await this.requestLlmChatCompletion(
        {
          model,
          temperature: 0,
          max_tokens: 16,
          messages: [
            {
              role: "user",
              content:
                "Reply with exactly: OK",
            },
          ],
        },
        {
          timeoutMs:
            Math.min(
              30000,
              (
                Number(
                  this.settings
                    ?.llmTimeoutSeconds
                ) || 30
              ) * 1000
            ),
        }
      );

    return {
      endpoint:
        result.endpoint,
      model,
      responseText:
        this.extractLlmResponseText(
          result.response.json
        ).trim(),
    };
  }
}

class ResearchLibraryModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.papers = [];
    this.view = "all";
    this.query = "";
    this.sortField = "edited";
    this.sortDir = "desc";
    this.statusFilter = "all";
    this.ratingFilter = 0;
    this.topicFilter = "";
    this.collectionFilter = "";
    this.projectFilter = "";

    this.activeSavedViewId = null;

    this.selectedPaths = new Set();
    this.lastSelectedPath = null;

    this.refreshTimer = null;
    this.refreshRunning = false;
    this.refreshQueued = false;

    this.searchRenderTimer = null;

    this.rowRenderToken = 0;
    this.rowRenderFrame = null;

    this.rowElementsByPath =
      new Map();

    this.virtualTableActive =
      false;

    this.virtualPapers =
      [];

    this.virtualStart =
      0;

    this.virtualEnd =
      0;

    this.virtualRowHeight =
      0;

    this.virtualMetricKey =
      "";

    this.virtualMeasuredKey =
      "";

    this.virtualLastWindowKey =
      "";

    this.virtualScrollFrame =
      null;

    this.virtualViewportObserver =
      null;

    this.paperCache =
      new Map();

    this.paperRevision = 0;
    this.paperIndexReady = false;

    this.visiblePapersCache = {
      key:
        "",
      papers:
        [],
    };

    this.lastLoadStats = {
      total:
        0,
      parsed:
        0,
      reused:
        0,
      changed:
        false,
    };

    this.bibliographySyncPromise =
      null;

    this.bibliographySyncPending =
      false;

    this.writeOperation =
      null;

    this.writeOperationCounter =
      0;

    this.activePopover = null;

    this.topicResizeObserver = null;

    // v0.5 Paper Detail
    this.detailPaperPath =
      this.plugin.settings
        .detailPanelOpen
        ? (
            this.plugin.settings
              .detailLastPaperPath
            || null
          )
        : null;
    this.detailRenderToken = 0;
    this.boundDetailKeydown = null;
    this.detailEditingSectionKey = null;
    this.detailEditingPaperPath = null;
    this.detailStateSavePromise =
      Promise.resolve();

    this.detailFigureIndexByPath =
      new Map();

    this.visualAssetRefreshTimer =
      null;

    // Frontmatter edits trigger MetadataCache "changed".
    // For inline property edits we already update the UI locally,
    // so suppress the immediate full-table refresh.
    this.suppressRefreshUntil = 0;

    // Shared for the lifetime of the plugin session.
    // Successful metadata GETs are cached so batch import and
    // manual retries do not repeatedly hit the same public APIs.
    this.plugin._metadataHttpCache =
      this.plugin._metadataHttpCache
      || new Map();

    this.plugin._metadataCooldownUntil =
      this.plugin._metadataCooldownUntil
      || new Map();
  }

  async onOpen() {
    this.modalEl.addClass("research-library-modal");
    this.contentEl.empty();
    this.contentEl.addClass("research-library-content");

    this.buildShell();

    this.topicResizeObserver =
      new ResizeObserver((entries) => {
        for (const entry of entries) {
          this.updateTopicEditorLayout(
            entry.target
          );
        }
      });

    this.boundDetailKeydown =
      (event) =>
        this.handleDetailKeydown(
          event
        );

    this.modalEl.addEventListener(
      "keydown",
      this.boundDetailKeydown
    );

    await this.loadPapers();
    this.render();
  }

  onClose() {
    this.closePopover();

    if (this.boundDetailKeydown) {
      this.modalEl.removeEventListener(
        "keydown",
        this.boundDetailKeydown
      );

      this.boundDetailKeydown = null;
    }

    if (this.topicResizeObserver) {
      this.topicResizeObserver.disconnect();
      this.topicResizeObserver = null;
    }

    if (this.refreshTimer) {
      window.clearTimeout(
        this.refreshTimer
      );

      this.refreshTimer = null;
    }

    if (this.searchRenderTimer) {
      window.clearTimeout(
        this.searchRenderTimer
      );

      this.searchRenderTimer =
        null;
    }

    if (this.visualAssetRefreshTimer) {
      window.clearTimeout(
        this.visualAssetRefreshTimer
      );

      this.visualAssetRefreshTimer =
        null;
    }

    if (this.rowRenderFrame) {
      window.cancelAnimationFrame(
        this.rowRenderFrame
      );

      this.rowRenderFrame =
        null;
    }

    if (this.virtualScrollFrame) {
      window.cancelAnimationFrame(
        this.virtualScrollFrame
      );

      this.virtualScrollFrame =
        null;
    }

    if (this.virtualViewportObserver) {
      this.virtualViewportObserver
        .disconnect();

      this.virtualViewportObserver =
        null;
    }

    this.rowElementsByPath
      .clear();

    this.rowRenderToken += 1;

    this.contentEl.empty();

    if (this.plugin.currentModal === this) {
      this.plugin.currentModal = null;
    }
  }

  papersFolderPrefix() {
    const folder =
      normalizePath(
        this.plugin.settings
          .papersFolder
        || "Research/10 Papers"
      ).replace(
        /\/+$/,
        ""
      );

    return folder
      ? `${folder}/`
      : "";
  }

  isPaperPath(
    path
  ) {
    const value =
      normalizePath(
        path || ""
      );

    const prefix =
      this.papersFolderPrefix();

    return Boolean(
      value
      && /\.md$/i.test(value)
      && (
        !prefix
        || value.startsWith(
          prefix
        )
      )
    );
  }

  async withExclusiveWrite(
    label,
    action
  ) {
    if (
      this.writeOperation
    ) {
      const error =
        new Error(
          `另一个写操作正在进行：${this.writeOperation.label}`
        );

      error.code =
        "RL_WRITE_BUSY";

      error.activeOperation =
        this.writeOperation.label;

      throw error;
    }

    const token =
      ++this.writeOperationCounter;

    this.writeOperation = {
      token,
      label:
        String(
          label || "Library write"
        ),
      startedAt:
        Date.now(),
    };

    try {
      return await action(
        token
      );
    }
    finally {
      if (
        this.writeOperation
          ?.token === token
      ) {
        this.writeOperation =
          null;
      }
    }
  }

  liveTFile(
    fileOrPath,
    {
      extension = "",
      label = "File",
    } = {}
  ) {
    const path =
      normalizePath(
        typeof fileOrPath
        === "string"
          ? fileOrPath
          : fileOrPath?.path
            || ""
      );

    if (!path) {
      const error =
        new Error(
          `${label} 路径为空。`
        );

      error.code =
        "RL_STALE_FILE";

      throw error;
    }

    const live =
      this.app.vault
        .getAbstractFileByPath(
          path
        );

    if (
      !(live instanceof TFile)
    ) {
      const error =
        new Error(
          `${label} 已不存在或已移动：${path}`
        );

      error.code =
        "RL_STALE_FILE";

      throw error;
    }

    if (
      extension
      && live.extension
        ?.toLowerCase()
        !== String(extension)
          .toLowerCase()
    ) {
      const error =
        new Error(
          `${label} 类型已发生变化：${path}`
        );

      error.code =
        "RL_STALE_FILE";

      throw error;
    }

    return live;
  }

  async captureFileState(
    fileOrPath,
    label = "Paper Note"
  ) {
    const file =
      this.liveTFile(
        fileOrPath,
        {
          label,
        }
      );

    return {
      path:
        file.path,
      signature:
        this.paperFileSignature(
          file
        ),
      content:
        await this.app.vault
          .cachedRead(
            file
          ),
    };
  }

  async assertFileState(
    state,
    label = "Paper Note"
  ) {
    if (
      !state?.path
    ) {
      const error =
        new Error(
          `${label} 缺少封测快照。`
        );

      error.code =
        "RL_STALE_WRITE";

      throw error;
    }

    const file =
      this.liveTFile(
        state.path,
        {
          label,
        }
      );

    const content =
      await this.app.vault
        .cachedRead(
          file
        );

    if (
      content !== state.content
    ) {
      const error =
        new Error(
          `${label} 在 Review 后已被修改，请重新检查后再应用。`
        );

      error.code =
        "RL_STALE_WRITE";

      error.path =
        state.path;

      throw error;
    }

    return file;
  }

  invalidatePaperPaths(
    paths
  ) {
    for (
      const rawPath
      of paths || []
    ) {
      const path =
        normalizePath(
          rawPath || ""
        );

      if (path) {
        this.paperCache.delete(
          path
        );
      }
    }

    this.visiblePapersCache = {
      key:
        "",
      papers:
        [],
    };
  }

  isFigureAssetPath(
    path
  ) {
    return /\.(?:png|jpe?g|webp|gif|svg|bmp)$/i.test(
      normalizePath(
        path || ""
      )
    );
  }

  scheduleVisualAssetRefresh() {
    if (
      this.visualAssetRefreshTimer
    ) {
      window.clearTimeout(
        this.visualAssetRefreshTimer
      );
    }

    this.visualAssetRefreshTimer =
      window.setTimeout(
        () => {
          this.visualAssetRefreshTimer =
            null;

          if (
            this.view === "gallery"
          ) {
            this.renderGallery();
          }
          else if (
            this.plugin.settings
              .columns.figures
              !== false
          ) {
            this.renderRows();
          }

          void this.renderDetailIfOpen();
        },
        120
      );
  }

  scheduleRefresh(
    file = null,
    {
      oldPath = "",
    } = {}
  ) {
    if (
      Date.now()
      < this.suppressRefreshUntil
    ) {
      return;
    }

    const currentPath =
      file?.path || "";

    if (
      file
      && !this.isPaperPath(
        currentPath
      )
      && !this.isPaperPath(
        oldPath
      )
    ) {
      if (
        this.isFigureAssetPath(
          currentPath
        )
        || this.isFigureAssetPath(
          oldPath
        )
      ) {
        this.scheduleVisualAssetRefresh();
      }

      return;
    }

    if (currentPath) {
      this.paperCache.delete(
        currentPath
      );
    }

    if (oldPath) {
      this.paperCache.delete(
        normalizePath(
          oldPath
        )
      );
    }

    if (this.refreshTimer) {
      window.clearTimeout(
        this.refreshTimer
      );
    }

    this.refreshTimer =
      window.setTimeout(
        () => {
          this.refreshTimer =
            null;

          void this.runScheduledRefresh();
        },
        240
      );
  }

  async runScheduledRefresh() {
    if (
      this.refreshRunning
    ) {
      this.refreshQueued =
        true;

      return;
    }

    this.refreshRunning =
      true;

    try {
      do {
        this.refreshQueued =
          false;

        const result =
          await this.loadPapers();

        if (
          result.changed
        ) {
          this.renderCollectionSurface();

          await this
            .renderDetailIfOpen();
        }
      }
      while (
        this.refreshQueued
      );
    }
    finally {
      this.refreshRunning =
        false;
    }
  }

  buildShell() {
    const root = this.contentEl.createDiv({ cls: "rl-root" });
    root.dataset.density = this.plugin.settings.density || "comfortable";
    this.rootEl = root;

    this.applyAppearanceSettings();

    // ------------------------------------------------------
    // Tabs
    // ------------------------------------------------------
    const tabs = root.createDiv({ cls: "rl-tabs" });
    this.tabsEl = tabs;
    this.renderTabs();

    // ------------------------------------------------------
    // Toolbar
    // ------------------------------------------------------
    const toolbar = root.createDiv({ cls: "rl-toolbar" });

    const left = toolbar.createDiv({ cls: "rl-toolbar-left" });

    const searchWrap = left.createDiv({ cls: "rl-search" });
    this.createIcon(searchWrap, "search", "rl-search-icon");

    const input = searchWrap.createEl("input", {
      cls: "rl-search-input",
      attr: {
        type: "search",
        placeholder: "搜索论文…",
      },
    });

    this.searchInput = input;

    input.addEventListener(
      "input",
      () => {
        this.query =
          input.value
            .trim()
            .toLowerCase();

        if (
          this.searchRenderTimer
        ) {
          window.clearTimeout(
            this.searchRenderTimer
          );
        }

        this.searchRenderTimer =
          window.setTimeout(
            () => {
              this.searchRenderTimer =
                null;

              this.renderCollectionSurface();
            },
            90
          );
      }
    );

    this.filterButton = this.toolbarButton(left, "list-filter", "Filter", "筛选");
    this.filterButton.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openFilterPopover(this.filterButton);
    });

    this.sortButton = this.toolbarButton(left, "arrow-up-down", "Sort", "排序");
    this.sortButton.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openSortPopover(this.sortButton);
    });

    this.columnsButton = this.toolbarButton(left, "columns-3", "Columns", "列");
    this.columnsButton.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openColumnsPopover(this.columnsButton);
    });

    this.organizationButton = this.toolbarButton(
      left,
      "network",
      "组织",
      "管理 Topic / Project 与人工文献 List"
    );

    this.organizationButton.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        this.openOrganizationManager();
      }
    );

    this.citationButton =
      this.toolbarButton(
        left,
        "quote",
        "Citations",
        "引用与 library.bib"
      );

    this.citationButton.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        this.openCitationLibraryPopover(
          this.citationButton
        );
      }
    );

    this.maintenanceButton =
      this.toolbarButton(
        left,
        "wrench",
        "Maintenance",
        "Library maintenance"
      );

    this.maintenanceButton.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        this.openMaintenanceCenter();
      }
    );

    this.importButton = this.toolbarButton(
      left,
      "file-up",
      "Import",
      "从 PDF Inbox 导入已下载的 PDF"
    );

    this.importButton.addClass("rl-import-button");

    this.importButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      await this.startPdfImport();
    });

    const right = toolbar.createDiv({ cls: "rl-toolbar-right" });

    this.countEl = right.createSpan({ cls: "rl-count" });

    const density = right.createEl("button", {
      cls: "rl-toolbar-chip rl-density-button",
      attr: { type: "button", title: "切换行高" },
    });
    this.densityButton = density;

    density.addEventListener("click", async () => {
      const next =
        this.plugin.settings.density === "compact"
          ? "comfortable"
          : "compact";

      this.plugin.settings.density = next;
      this.rootEl.dataset.density = next;

      this.resetVirtualMetrics();

      if (
        this.virtualTableActive
      ) {
        this.renderRows();
      }

      await this.plugin.saveSettings();
      this.updateDensityButton();
    });

    const refresh = right.createEl("button", {
      cls: "rl-icon-button",
      attr: { type: "button", title: "刷新" },
    });

    this.createIcon(refresh, "rotate-ccw", "rl-action-icon");

    refresh.addEventListener(
      "click",
      async () => {
        await this.loadPapers({
          force:
            true,
        });

        this.render();
      }
    );

    // ------------------------------------------------------
    // Multi-selection action bar
    // ------------------------------------------------------
    const selectionBar = root.createDiv({
      cls: "rl-selection-bar is-hidden",
    });

    this.selectionBar = selectionBar;

    const selectionLeft = selectionBar.createDiv({
      cls: "rl-selection-left",
    });

    this.selectionCountEl = selectionLeft.createSpan({
      cls: "rl-selection-count",
      text: "0 selected",
    });

    const selectionRight = selectionBar.createDiv({
      cls: "rl-selection-actions",
    });

    this.bulkStatusButton = this.toolbarButton(
      selectionRight,
      "circle-dot",
      "Status",
      "批量修改状态"
    );

    this.bulkStatusButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      this.openBulkStatusPopover(this.bulkStatusButton);
    });

    this.bulkOrganizationButton = this.toolbarButton(
      selectionRight,
      "network",
      "组织",
      "批量添加或移除 Topic / Project / List"
    );

    this.bulkOrganizationButton.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        this.openBulkOrganizationPopover(
          this.bulkOrganizationButton
        );
      }
    );

    this.bulkCitationButton =
      this.toolbarButton(
        selectionRight,
        "quote",
        "Cite",
        "复制所选论文引用或 BibTeX"
      );

    this.bulkCitationButton
      .addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopPropagation();

          this.openBulkCitationPopover(
            this.bulkCitationButton
          );
        }
      );

    const archiveButton = this.toolbarButton(
      selectionRight,
      "archive",
      "Archive",
      "批量归档"
    );

    archiveButton.addEventListener("click", async () => {
      await this.bulkSetStatus("archived");
    });

    const deleteButton =
      this.toolbarButton(
        selectionRight,
        "trash-2",
        "Delete",
        "删除所选论文"
      );

    deleteButton.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        this.openPaperDeleteDialog(
          this.selectedPapers()
        );
      }
    );

    const clearButton = selectionRight.createEl("button", {
      cls: "rl-icon-button",
      attr: {
        type: "button",
        title: "清除选择",
      },
    });

    this.createIcon(clearButton, "x", "rl-action-icon");

    clearButton.addEventListener("click", () => {
      this.clearSelection();
    });

    // ------------------------------------------------------
    // Library workspace: table + v0.5 Paper Detail
    // ------------------------------------------------------
    const workspace =
      root.createDiv({
        cls:
          "rl-library-workspace",
      });

    this.workspaceEl =
      workspace;

    const tableWrap =
      workspace.createDiv({
        cls:
          "rl-table-wrap",
      });

    this.tableWrap =
      tableWrap;

    const table =
      tableWrap.createDiv({
        cls:
          "rl-table",
      });

    this.tableEl =
      table;

    this.headEl =
      table.createDiv({
        cls:
          "rl-row rl-head",
      });

    this.bodyEl =
      table.createDiv({
        cls:
          "rl-body",
      });

    tableWrap.addEventListener(
      "scroll",
      () => {
        if (
          this.virtualTableActive
        ) {
          this.scheduleVirtualWindowRender();
        }
      },
      {
        passive:
          true,
      }
    );

    this.virtualViewportObserver =
      new ResizeObserver(
        () => {
          if (
            !this.virtualTableActive
          ) {
            return;
          }

          this.virtualLastWindowKey =
            "";

          this.scheduleVirtualWindowRender();
        }
      );

    this.virtualViewportObserver
      .observe(
        tableWrap
      );

    this.galleryEl =
      workspace.createDiv({
        cls:
          "rl-gallery is-hidden",
      });

    const detail =
      workspace.createEl(
        "aside",
        {
          cls:
            "rl-detail-panel is-hidden",
          attr: {
            "aria-label":
              "Paper Detail",
          },
        }
      );

    this.detailEl =
      detail;

    const detailWidth =
      Math.max(
        340,
        Math.min(
          620,
          Number(
            this.plugin.settings
              .detailPanelWidth
          ) || 410
        )
      );

    detail.style.width =
      `${detailWidth}px`;

    const detailResize =
      detail.createDiv({
        cls:
          "rl-detail-resize-handle",
        attr: {
          title:
            "拖动调整详情面板宽度；双击恢复默认",
        },
      });

    this.bindDetailResize(
      detailResize
    );

    this.detailContentEl =
      detail.createDiv({
        cls:
          "rl-detail-scroll",
      });

    // Close popovers when clicking elsewhere
    root.addEventListener(
      "click",
      () =>
        this.closePopover()
    );
  }

  async startPdfImport() {
    if (this.batchImportActive) {
      new Notice(
        "已有批量导入任务正在运行，请等待当前任务完成或停止后再开始新的 Import。",
        6000
      );

      return;
    }

    if (
      typeof loadPdfJs !== "function"
      || typeof requestUrl !== "function"
    ) {
      new Notice(
        "当前 Obsidian 版本没有提供 PDF/HTTP API，无法运行 PDF-first Import。"
      );
      return;
    }

    const settings = this.plugin.settings;

    try {
      await this.ensureFolder(settings.inboxFolder);
      await this.ensureFolder(settings.papersFolder);
      await this.ensureFolder(settings.pdfFolder);

      const picked =
        await this.chooseInboxPdf();

      if (!picked) return;

      if (
        Array.isArray(picked)
        && picked.length > 1
      ) {
        await this.startBatchPdfImport(
          picked
        );

        return;
      }

      const sourcePdf =
        Array.isArray(picked)
          ? picked[0]
          : picked;

      if (!sourcePdf) return;

      this.setImportBusy(
        `正在读取 ${sourcePdf.name}…`
      );

      const signals =
        await this.extractPdfSignals(
          sourcePdf,
          Number(settings.scanPages) || 3
        );

      let meta = null;
      let matchMethod = "";

      if (signals.doi) {
        this.setImportBusy(
          `检测到 DOI，正在获取元数据…`
        );

        meta =
          await this.fetchCrossrefByDoi(
            signals.doi
          )
          ||
          await this.fetchDataCiteByDoi(
            signals.doi
          )
          ||
          await this.fetchSemanticScholarByDoi(
            signals.doi
          );

        if (meta) {
          matchMethod = "doi";
        }
      }

      if (!meta && signals.arxiv) {
        this.setImportBusy(
          `检测到 arXiv，正在获取元数据…`
        );

        const arxivId =
          String(signals.arxiv)
            .replace(/v\d+$/i, "");

        const arxivDoi =
          `10.48550/arXiv.${arxivId}`;

        meta =
          await this.fetchSemanticScholarByArxiv(
            arxivId
          )
          ||
          await this.fetchDataCiteByDoi(
            arxivDoi
          )
          ||
          await this.fetchCrossrefByDoi(
            arxivDoi
          );

        if (meta) {
          matchMethod = "arxiv";
        }
      }

      if (!meta) {
        const query =
          this.buildSearchQuery(
            signals,
            sourcePdf.basename
          );

        let searchTitle =
          signals.title
          || this.cleanCandidateTitle(
            sourcePdf.basename
          )
          || query
          || sourcePdf.basename;

        let searching = true;
        let searchOrigin = "pdf";
        let llmRescueAttempted = false;

        while (
          searching
          && !meta
        ) {
          this.setImportBusy(
            "正在启动分级元数据检索…"
          );

          const candidates =
            await this.searchMetadataSources(
              searchTitle,
              signals
            );

          this.setImportBusy(null);

          const reliable =
            candidates.filter(
              (candidate) =>
                this.isReliableMetadataCandidate(
                  candidate
                )
            );

          if (reliable.length) {
            const choice =
              await this.chooseMetadataCandidate(
                candidates,
                signals,
                sourcePdf,
                searchTitle
              );

            if (!choice) {
              return;
            }

            if (
              choice.kind
              === "candidate"
            ) {
              meta = choice.meta;
              matchMethod =
                searchOrigin
                === "llm"
                  ? "llm-rescue"
                  : searchOrigin
                    === "citation"
                    ? "citation-rescue"
                    : "title-search";
              searching = false;
            }
            else if (
              choice.kind
              === "citation-search"
            ) {
              signals.citationRescue =
                choice.meta;

              searchTitle =
                choice.meta?.title
                || searchTitle;

              searchOrigin =
                "citation";

              continue;
            }
            else if (
              choice.kind
              === "citation-meta"
            ) {
              signals.citationRescue =
                choice.meta;

              meta =
                choice.meta;

              matchMethod =
                "citation-text";

              searching =
                false;
            }
            else if (
              choice.kind
              === "pdf"
            ) {
              meta =
                this.makePdfOnlyMeta(
                  signals,
                  searchTitle
                );

              matchMethod =
                "pdf-only";
              searching = false;
            }

            continue;
          }

          // --------------------------------------------------
          // LLM metadata rescue
          // Only runs once, and only after conventional sources
          // have failed to produce a reliable candidate.
          // The LLM output is NOT imported as authoritative
          // metadata. Its title is used to retry the normal
          // scholarly-database search.
          // --------------------------------------------------
          if (
            !llmRescueAttempted
            && this.isLlmMetadataRescueReady()
          ) {
            llmRescueAttempted = true;
            signals.llmRescueAttempted =
              true;

            this.setImportBusy(
              "常规检索未找到可靠结果，正在让大模型识别 PDF 首页…"
            );

            try {
              const llmResult =
                await this.rescueMetadataWithLlm(
                  sourcePdf,
                  signals
                );

              this.setImportBusy(
                null
              );

              if (
                llmResult?.title
              ) {
                signals.llmRescue =
                  llmResult;

                const rescuedTitle =
                  this.cleanCandidateTitle(
                    llmResult.title
                  )
                  || llmResult.title;

                const currentKey =
                  this.normalizeTitleForMatch(
                    searchTitle
                  );

                const rescuedKey =
                  this.normalizeTitleForMatch(
                    rescuedTitle
                  );

                if (
                  rescuedKey
                  && rescuedKey
                    !== currentKey
                ) {
                  searchTitle =
                    rescuedTitle;

                  searchOrigin =
                    "llm";

                  new Notice(
                    `LLM 识别标题：${rescuedTitle}`,
                    5000
                  );

                  // Retry the existing Progressive Search
                  // with the recovered title. Database results
                  // remain the authoritative metadata source.
                  continue;
                }
              }
            }
            catch (llmError) {
              this.setImportBusy(
                null
              );

              signals.llmRescueError =
                llmError?.message
                || String(
                  llmError
                );

              console.warn(
                "Research Library LLM metadata rescue failed:",
                llmError
              );
            }
          }

          const recovery =
            await this.chooseMetadataSearchFailure(
              {
                sourcePdf,
                signals,
                searchTitle,
                candidates,
              }
            );

          if (!recovery) {
            return;
          }

          if (
            recovery.kind
            === "citation-search"
          ) {
            signals.citationRescue =
              recovery.meta;

            searchTitle =
              recovery.meta?.title
              || searchTitle;

            searchOrigin =
              "citation";

            candidates = [];

            continue;
          }

          if (
            recovery.kind
            === "citation-meta"
          ) {
            signals.citationRescue =
              recovery.meta;

            meta =
              recovery.meta;

            matchMethod =
              "citation-text";

            searching =
              false;

            continue;
          }

          if (
            recovery.kind
            === "retry"
          ) {
            searchTitle =
              this.cleanCandidateTitle(
                recovery.title
              )
              || recovery.title
              || searchTitle;

            searchOrigin =
              "manual";

            continue;
          }

          if (
            recovery.kind
            === "pdf"
          ) {
            const fallbackTitle =
              this.cleanCandidateTitle(
                recovery.title
              )
              || recovery.title
              || searchTitle;

            meta =
              this.makePdfOnlyMeta(
                signals,
                fallbackTitle
              );

            matchMethod =
              "pdf-only";
            searching = false;
          }
        }
      }

      if (!meta) {
        // Reaching this point now means the user cancelled or
        // no explicit fallback choice was made. Never silently
        // convert a failed online lookup into PDF metadata.
        return;
      }

      this.setImportBusy(null);

      const publicationResolution =
        [
          "pdf-only",
          "citation-text",
        ].includes(
          matchMethod
        )
          ? {
              meta,
              changed: false,
            }
          : await this.resolvePublicationMetadata(
              meta,
              signals,
              {
                interactive: true,
                sourcePdf,
              }
            );

      if (publicationResolution?.meta) {
        meta =
          publicationResolution.meta;

        if (
          publicationResolution.changed
        ) {
          signals.publicationResolution =
            meta._publicationResolution
            || {
              kind:
                "preprint-to-formal",
            };
        }
      }

      const existing =
        this.findExistingPaperForMeta(
          meta
        );

      if (existing) {
        new Notice(
          `论文已存在：${existing.title}`
        );

        return;
      }

      const edited =
        await this.previewPaperImport({
          sourcePdf,
          meta,
          matchMethod,
          signals,
        });

      if (!edited) return;

      meta = edited;

      this.setImportBusy(
        "正在验证、归档 PDF 并创建论文笔记…"
      );

      let committed = null;

      try {
        committed =
          await this.commitImportedPaper({
            sourcePdf,
            meta,
            matchMethod,
          });
      }
      catch (error) {
        if (
          error?.code
          === "RL_DUPLICATE"
        ) {
          this.setImportBusy(
            null
          );

          new Notice(
            error.message
          );

          return;
        }

        throw error;
      }

      this.setImportBusy(
        null
      );

      await this.loadPapers();

      this.view =
        "inbox";

      this.render();

      new Notice(
        `导入完成：${committed.meta.title}`
      );

      return committed.note;
    }
    catch (error) {
      this.setImportBusy(null);

      console.error(
        "Research Library PDF import failed:",
        error
      );

      new Notice(
        `PDF 导入失败：${error?.message || String(error)}`,
        10000
      );
    }
  }

  async withTimeout(
    promise,
    timeoutMs,
    label = "Operation"
  ) {
    const ms =
      Math.max(
        1000,
        Number(timeoutMs)
        || 1000
      );

    let timeoutId = null;

    const timeoutPromise =
      new Promise(
        (
          _resolve,
          reject
        ) => {
          timeoutId =
            window.setTimeout(
              () => {
                const error =
                  new Error(
                    `${label} timeout after ${Math.round(
                      ms / 1000
                    )}s`
                  );

                error.code =
                  "RL_TIMEOUT";

                reject(error);
              },
              ms
            );
        }
      );

    try {
      return await Promise.race([
        Promise.resolve(
          promise
        ),
        timeoutPromise,
      ]);
    }
    finally {
      if (timeoutId) {
        window.clearTimeout(
          timeoutId
        );
      }
    }
  }

  metadataCacheKey(
    url,
    extraHeaders = {},
    responseType = "json"
  ) {
    const headerKey =
      Object.entries(
        extraHeaders || {}
      )
        .sort(
          ([a], [b]) =>
            a.localeCompare(b)
        )
        .map(
          ([key, value]) =>
            `${key.toLowerCase()}:${value}`
        )
        .join("|");

    return `${responseType}|${url}|${headerKey}`;
  }

  async sleep(ms) {
    await new Promise(
      (resolve) =>
        window.setTimeout(
          resolve,
          Math.max(
            0,
            Number(ms) || 0
          )
        )
    );
  }

  retryAfterMs(headers) {
    const value =
      headers?.["retry-after"]
      ?? headers?.["Retry-After"]
      ?? "";

    if (!value) {
      return 0;
    }

    const seconds =
      Number(value);

    if (
      Number.isFinite(seconds)
    ) {
      return Math.max(
        0,
        seconds * 1000
      );
    }

    const date =
      Date.parse(value);

    return Number.isFinite(date)
      ? Math.max(
          0,
          date - Date.now()
        )
      : 0;
  }

  async requestMetadataResource(
    url,
    extraHeaders = {},
    {
      timeoutMs = 12000,
      strict = false,
      responseType = "json",
      cacheTtlMs = 60 * 60 * 1000,
      maxRetries = 2,
    } = {}
  ) {
    const cache =
      this.plugin
        ._metadataHttpCache;

    const cooldowns =
      this.plugin
        ._metadataCooldownUntil;

    const key =
      this.metadataCacheKey(
        url,
        extraHeaders,
        responseType
      );

    const cached =
      cache?.get(key);

    if (
      cached
      && cached.expiresAt
        > Date.now()
    ) {
      return cached.value;
    }

    let host = "";

    try {
      host =
        new URL(url).hostname;
    }
    catch (_) {}

    const fallbackWaits =
      [
        1400,
        2800,
        5200,
      ];

    let lastError = null;

    for (
      let attempt = 0;
      attempt <= maxRetries;
      attempt++
    ) {
      if (
        host
        && cooldowns
      ) {
        const until =
          Number(
            cooldowns.get(host)
            || 0
          );

        if (
          until > Date.now()
        ) {
          await this.sleep(
            until - Date.now()
          );
        }
      }

      try {
        const response =
          await this.withTimeout(
            requestUrl({
              url,
              method: "GET",
              headers: {
                Accept:
                  responseType === "json"
                    ? "application/json"
                    : "text/html, text/plain;q=0.9, */*;q=0.8",
                ...extraHeaders,
              },
            }),
            timeoutMs,
            "Metadata request"
          );

        if (
          response.status >= 200
          && response.status < 300
        ) {
          const value =
            responseType === "json"
              ? response.json
              : response.text;

          cache?.set(
            key,
            {
              value,
              expiresAt:
                Date.now()
                + cacheTtlMs,
            }
          );

          return value;
        }

        if (
          response.status === 429
        ) {
          const retryAfter =
            this.retryAfterMs(
              response.headers
            );

          const wait =
            Math.min(
              10000,
              Math.max(
                retryAfter,
                fallbackWaits[
                  Math.min(
                    attempt,
                    fallbackWaits.length - 1
                  )
                ]
              )
            );

          if (
            host
            && cooldowns
          ) {
            cooldowns.set(
              host,
              Date.now() + wait
            );
          }

          lastError =
            new Error(
              `HTTP 429 · retry ${
                Math.round(
                  wait / 100
                ) / 10
              }s`
            );

          if (
            attempt < maxRetries
          ) {
            await this.sleep(wait);
            continue;
          }
        }
        else {
          lastError =
            new Error(
              `HTTP ${response.status}`
            );
        }
      }
      catch (error) {
        lastError = error;

        const raw =
          String(
            error?.message
            || error
            || ""
          );

        // Some request layers throw directly for HTTP 429.
        if (
          /\b429\b/.test(raw)
          && attempt < maxRetries
        ) {
          const wait =
            fallbackWaits[
              Math.min(
                attempt,
                fallbackWaits.length - 1
              )
            ];

          if (
            host
            && cooldowns
          ) {
            cooldowns.set(
              host,
              Date.now() + wait
            );
          }

          await this.sleep(wait);
          continue;
        }
      }

      break;
    }

    if (strict) {
      throw (
        lastError
        || new Error(
          "Metadata request failed"
        )
      );
    }

    console.debug(
      "Research Library metadata request failed:",
      url,
      lastError
    );

    return null;
  }

  async requestJsonWithTimeout(
    url,
    extraHeaders = {},
    options = {}
  ) {
    return this.requestMetadataResource(
      url,
      extraHeaders,
      {
        ...options,
        responseType:
          "json",
      }
    );
  }

  async requestTextWithTimeout(
    url,
    extraHeaders = {},
    options = {}
  ) {
    return this.requestMetadataResource(
      url,
      extraHeaders,
      {
        ...options,
        responseType:
          "text",
      }
    );
  }

  isBatchAutoImportCandidate(
    candidate
  ) {
    if (!candidate) {
      return false;
    }

    const hasBibliographicEvidence =
      Boolean(
        candidate.doi
        || candidate.arxiv
        || candidate.year
        || candidate.venue
        || (
          Array.isArray(
            candidate.authors
          )
          && candidate.authors.length
        )
      );

    if (!hasBibliographicEvidence) {
      return false;
    }

    return Boolean(
      candidate._identifierExact
      || candidate._exactTitle
      || Number(
        candidate._matchPercent
      ) >= 92
    );
  }

  metadataIdentity(meta) {
    if (!meta) return "";

    const doi =
      this.normalizeDoi(
        meta.doi || ""
      );

    if (doi) {
      return `doi:${doi}`;
    }

    const arxiv =
      String(
        meta.arxiv || ""
      )
        .trim()
        .toLowerCase()
        .replace(
          /^arxiv:\s*/i,
          ""
        )
        .replace(
          /v\d+$/i,
          ""
        );

    if (arxiv) {
      return `arxiv:${arxiv}`;
    }

    const title =
      this.normalizeTitleForMatch(
        meta.title || ""
      );

    return title
      ? `title:${title}:${
          meta.year || ""
        }`
      : "";
  }

  metadataSourceLabel(meta) {
    const sources =
      (
        meta?._sources
        || (
          meta?.metadataSource
            ? [
                meta.metadataSource,
              ]
            : []
        )
      )
        .filter(Boolean)
        .map(
          (source) =>
            source === "semantic-scholar"
              ? "Semantic Scholar"
              : source === "openreview"
                ? "OpenReview"
                : source === "dblp"
                  ? "DBLP"
                  : source === "pmlr"
                    ? "PMLR"
                    : source === "citation-gb"
                      ? "GB/T 7714 citation"
                      : source === "citation-llm"
                        ? "LLM citation"
                        : source === "openalex"
                          ? "OpenAlex"
                    : source === "crossref"
                      ? "Crossref"
                      : source === "datacite"
                        ? "DataCite"
                        : source === "pdf"
                          ? "PDF"
                          : source
        );

    return [
      ...new Set(sources),
    ].join(" + ");
  }

  async resolveBatchPdfMetadata(
    sourcePdf
  ) {
    const settings =
      this.plugin.settings;

    const signals =
      await this.extractPdfSignals(
        sourcePdf,
        Number(
          settings.scanPages
        ) || 3
      );

    let meta = null;
    let matchMethod = "";

    if (signals.doi) {
      this.setImportBusy(
        "检测到 DOI，正在精确查询…"
      );

      meta =
        await this.fetchCrossrefByDoi(
          signals.doi
        )
        ||
        await this.fetchDataCiteByDoi(
          signals.doi
        )
        ||
        await this.fetchSemanticScholarByDoi(
          signals.doi
        );

      if (meta) {
        matchMethod = "doi";
      }
    }

    if (
      !meta
      && signals.arxiv
    ) {
      this.setImportBusy(
        "检测到 arXiv，正在精确查询…"
      );

      const arxivId =
        String(
          signals.arxiv
        )
          .replace(
            /v\d+$/i,
            ""
          );

      const arxivDoi =
        `10.48550/arXiv.${arxivId}`;

      meta =
        await this.fetchSemanticScholarByArxiv(
          arxivId
        )
        ||
        await this.fetchDataCiteByDoi(
          arxivDoi
        )
        ||
        await this.fetchCrossrefByDoi(
          arxivDoi
        );

      if (meta) {
        matchMethod =
          "arxiv";
      }
    }

    let searchTitle =
      signals.title
      || this.cleanCandidateTitle(
        sourcePdf.basename
      )
      || sourcePdf.basename;

    let candidates = [];

    if (!meta) {
      candidates =
        await this.searchMetadataSources(
          searchTitle,
          signals
        );

      const best =
        candidates[0];

      if (
        this.isBatchAutoImportCandidate(
          best
        )
      ) {
        meta = best;
        matchMethod =
          "title-search";
      }
    }

    // Batch mode never interrupts the queue with a manual modal.
    // If ordinary scholarly databases are still uncertain, try
    // the configured first-page LLM rescue once.
    if (
      !meta
      && this.isLlmMetadataRescueReady()
    ) {
      signals.llmRescueAttempted =
        true;

      this.setImportBusy(
        "匹配度不足，正在进行 LLM 首页标题救援…"
      );

      try {
        const llmResult =
          await this.rescueMetadataWithLlm(
            sourcePdf,
            signals
          );

        if (
          llmResult?.title
        ) {
          signals.llmRescue =
            llmResult;

          searchTitle =
            this.cleanCandidateTitle(
              llmResult.title
            )
            || llmResult.title;

          candidates =
            await this.searchMetadataSources(
              searchTitle,
              signals
            );

          const rescuedBest =
            candidates[0];

          if (
            this.isBatchAutoImportCandidate(
              rescuedBest
            )
          ) {
            meta =
              rescuedBest;

            matchMethod =
              "llm-rescue";
          }
        }
      }
      catch (error) {
        signals.llmRescueError =
          error?.message
          || String(error);

        console.warn(
          "Research Library batch LLM rescue failed:",
          error
        );
      }
    }

    if (meta) {
      const publicationResolution =
        await this.resolvePublicationMetadata(
          meta,
          signals,
          {
            interactive: false,
            sourcePdf,
          }
        );

      if (publicationResolution?.meta) {
        meta =
          publicationResolution.meta;

        if (
          publicationResolution.changed
        ) {
          signals.publicationResolution =
            meta._publicationResolution
            || {
              kind:
                "preprint-to-formal",
            };
        }
      }

      return {
        kind:
          "ready",
        meta,
        matchMethod,
        signals,
        searchTitle,
        diagnostics:
          this.lastMetadataDiagnostics
          || [],
      };
    }

    return {
      kind:
        "review",
      signals,
      searchTitle,
      candidates,
      best:
        candidates[0]
        || null,
      diagnostics:
        this.lastMetadataDiagnostics
        || [],
    };
  }

  async commitBatchPaper(
    sourcePdf,
    meta,
    matchMethod
  ) {
    return this.commitImportedPaper({
      sourcePdf,
      meta,
      matchMethod,
    });
  }

  async reviewBatchNeedsReview(
    sourcePdf,
    reviewContext,
    progress,
    summary
  ) {
    if (
      !(sourcePdf instanceof TFile)
    ) {
      new Notice(
        "无法找到待复查的 PDF。",
        5000
      );

      return;
    }

    const entry =
      progress?.rows
        ?.get(sourcePdf);

    if (
      entry?.actionBusy
    ) {
      return;
    }

    if (entry) {
      entry.actionBusy =
        true;

      progress.setActionBusy(
        sourcePdf,
        true,
        "Reviewing…"
      );
    }

    try {
      const signals =
        reviewContext
          ?.signals
        || await this.extractPdfSignals(
          sourcePdf,
          Number(
            this.plugin.settings
              .scanPages
          ) || 3
        );

      let searchTitle =
        reviewContext
          ?.searchTitle
        || signals.title
        || this.cleanCandidateTitle(
          sourcePdf.basename
        )
        || sourcePdf.basename;

      let candidates =
        Array.isArray(
          reviewContext
            ?.candidates
        )
          ? reviewContext
              .candidates
          : [];

      let meta = null;
      let matchMethod = "";

      let searching = true;

      while (
        searching
        && !meta
      ) {
        if (!candidates.length) {
          progress.updateFile(
            sourcePdf,
            "review",
            "正在重新检索候选…"
          );

          candidates =
            await this.searchMetadataSources(
              searchTitle,
              signals
            );
        }

        const reliable =
          candidates.filter(
            (candidate) =>
              this.isReliableMetadataCandidate(
                candidate
              )
          );

        if (reliable.length) {
          const choice =
            await this.chooseMetadataCandidate(
              candidates,
              signals,
              sourcePdf,
              searchTitle
            );

          if (!choice) {
            return;
          }

          if (
            choice.kind
            === "candidate"
          ) {
            meta =
              choice.meta;

            matchMethod =
              signals.citationRescue
                ? "citation-rescue"
                : signals.llmRescue
                  ? "llm-rescue"
                  : "title-search";

            searching =
              false;
          }
          else if (
            choice.kind
            === "citation-search"
          ) {
            signals.citationRescue =
              choice.meta;

            searchTitle =
              choice.meta?.title
              || searchTitle;

            candidates = [];

            continue;
          }
          else if (
            choice.kind
            === "citation-meta"
          ) {
            signals.citationRescue =
              choice.meta;

            meta =
              choice.meta;

            matchMethod =
              "citation-text";

            searching =
              false;
          }
          else if (
            choice.kind
            === "pdf"
          ) {
            meta =
              this.makePdfOnlyMeta(
                signals,
                searchTitle
              );

            matchMethod =
              "pdf-only";

            searching =
              false;
          }

          continue;
        }

        const recovery =
          await this.chooseMetadataSearchFailure(
            {
              sourcePdf,
              signals,
              searchTitle,
              candidates,
            }
          );

        if (!recovery) {
          return;
        }

        if (
          recovery.kind
          === "citation-search"
        ) {
          signals.citationRescue =
            recovery.meta;

          searchTitle =
            recovery.meta?.title
            || searchTitle;

          candidates = [];

          continue;
        }

        if (
          recovery.kind
          === "citation-meta"
        ) {
          signals.citationRescue =
            recovery.meta;

          meta =
            recovery.meta;

          matchMethod =
            "citation-text";

          searching =
            false;

          continue;
        }

        if (
          recovery.kind
          === "retry"
        ) {
          searchTitle =
            this.cleanCandidateTitle(
              recovery.title
            )
            || recovery.title
            || searchTitle;

          candidates = [];

          continue;
        }

        if (
          recovery.kind
          === "pdf"
        ) {
          const fallbackTitle =
            this.cleanCandidateTitle(
              recovery.title
            )
            || recovery.title
            || searchTitle;

          meta =
            this.makePdfOnlyMeta(
              signals,
              fallbackTitle
            );

          matchMethod =
            "pdf-only";

          searching =
            false;
        }
      }

      if (!meta) {
        return;
      }

      const publicationResolution =
        [
          "pdf-only",
          "citation-text",
        ].includes(
          matchMethod
        )
          ? {
              meta,
              changed: false,
            }
          : await this.resolvePublicationMetadata(
              meta,
              signals,
              {
                interactive: true,
                sourcePdf,
              }
            );

      if (publicationResolution?.meta) {
        meta =
          publicationResolution.meta;

        if (
          publicationResolution.changed
        ) {
          signals.publicationResolution =
            meta._publicationResolution
            || {
              kind:
                "preprint-to-formal",
            };
        }
      }

      const existingBeforePreview =
        this.findExistingPaperForMeta(
          meta
        );

      if (existingBeforePreview) {
        progress.updateFile(
          sourcePdf,
          "duplicate",
          `已存在：${existingBeforePreview.title}`
        );

        progress.setDuplicateActions(
          sourcePdf,
          {
            existing:
              existingBeforePreview,
            onOpenExisting:
              async () => {
                await this.app.workspace
                  .getLeaf("tab")
                  .openFile(
                    existingBeforePreview.file
                  );
              },
            onOpenPdf:
              async () => {
                await this.app.workspace
                  .getLeaf("tab")
                  .openFile(
                    sourcePdf
                  );
              },
          }
        );

        summary.review =
          Math.max(
            0,
            summary.review - 1
          );

        summary.duplicate += 1;

        progress.updateSummary(
          summary
        );

        return;
      }

      const edited =
        await this.previewPaperImport({
          sourcePdf,
          meta,
          matchMethod,
          signals,
        });

      if (!edited) {
        return;
      }

      meta = edited;

      meta.firstAuthorFamily =
        this.familyFromName(
          meta.authors?.[0]
        )
        || meta.firstAuthorFamily
        || "unknown";

      const duplicate =
        this.findExistingPaperForMeta(
          meta
        );

      if (duplicate) {
        progress.updateFile(
          sourcePdf,
          "duplicate",
          `已存在：${duplicate.title}`
        );

        progress.setDuplicateActions(
          sourcePdf,
          {
            existing:
              duplicate,
            onOpenExisting:
              async () => {
                await this.app.workspace
                  .getLeaf("tab")
                  .openFile(
                    duplicate.file
                  );
              },
            onOpenPdf:
              async () => {
                await this.app.workspace
                  .getLeaf("tab")
                  .openFile(
                    sourcePdf
                  );
              },
          }
        );

        summary.review =
          Math.max(
            0,
            summary.review - 1
          );

        summary.duplicate += 1;

        progress.updateSummary(
          summary
        );

        return;
      }

      progress.updateFile(
        sourcePdf,
        "importing",
        "复查通过，正在归档…"
      );

      const committed =
        await this.commitBatchPaper(
          sourcePdf,
          meta,
          matchMethod
        );

      progress.updateFile(
        sourcePdf,
        "imported",
        [
          "复查完成 · 已归档",
          meta.year || "",
          meta.venue || "",
          this.metadataSourceLabel(
            meta
          ),
        ]
          .filter(Boolean)
          .join(" · ")
      );

      progress.clearActions(
        sourcePdf
      );

      summary.review =
        Math.max(
          0,
          summary.review - 1
        );

      summary.imported += 1;

      progress.updateSummary(
        summary
      );

      await this.loadPapers();

      this.view =
        "inbox";

      this.render();

      new Notice(
        `复查导入完成：${meta.title}`,
        5000
      );

      return committed;
    }
    catch (error) {
      console.error(
        "Research Library batch review failed:",
        error
      );

      progress.updateFile(
        sourcePdf,
        "review",
        `复查失败：${
          error?.message
          || String(error)
        }`
      );

      new Notice(
        `复查失败：${
          error?.message
          || String(error)
        }`,
        8000
      );
    }
    finally {
      if (entry) {
        entry.actionBusy =
          false;

        progress.setActionBusy(
          sourcePdf,
          false
        );
      }
    }
  }

  async startBatchPdfImport(
    files
  ) {
    if (this.batchImportActive) {
      new Notice(
        "已有批量导入任务正在运行。",
        5000
      );

      return;
    }

    const queue =
      (
        Array.isArray(files)
          ? files
          : []
      )
        .filter(
          (file) =>
            file instanceof TFile
            && file.extension
              ?.toLowerCase()
              === "pdf"
        );

    if (!queue.length) {
      return;
    }

    const progress =
      new BatchImportProgressModal(
        this.app,
        {
          files:
            queue,
        }
      );

    progress.open();

    const summary = {
      imported: 0,
      review: 0,
      duplicate: 0,
      failed: 0,
      cancelled: 0,
    };

    const batchIdentities =
      new Set();

    const batchExistingTargets =
      new Map();

    this.batchImportActive =
      true;

    try {
      for (
        let index = 0;
        index < queue.length;
        index++
      ) {
        const file =
          queue[index];

        if (
          progress.cancelRequested
        ) {
          for (
            let rest = index;
            rest < queue.length;
            rest++
          ) {
            progress.updateFile(
              queue[rest],
              "cancelled",
              "未处理"
            );

            summary.cancelled += 1;
          }

          break;
        }

        this.batchProgressCallback =
          (message) => {
            if (!message) return;

            progress.updateFile(
              file,
              "searching",
              message
            );
          };

        progress.updateFile(
          file,
          "searching",
          "正在读取 PDF…"
        );

        try {
          let resolved = null;

          try {
            resolved =
              await this.withTimeout(
                this.resolveBatchPdfMetadata(
                  file
                ),
                120000,
                "Single-paper metadata workflow"
              );
          }
          catch (error) {
            if (
              error?.code === "RL_TIMEOUT"
            ) {
              progress.updateFile(
                file,
                "review",
                "单篇处理超过 120s，已跳过并保留在 PDF Inbox"
              );

              summary.review += 1;

              progress.setReviewActions(
                file,
                {
                  onReview:
                    async () => {
                      await this.reviewBatchNeedsReview(
                        file,
                        null,
                        progress,
                        summary
                      );
                    },
                  onOpenPdf:
                    async () => {
                      await this.app.workspace
                        .getLeaf("tab")
                        .openFile(
                          file
                        );
                    },
                }
              );

              continue;
            }

            throw error;
          }

          if (
            resolved.kind
            === "review"
          ) {
            const best =
              resolved.best;

            const detail =
              best
                ? `${
                    Number(
                      best._matchPercent
                    ) || 0
                  }% · ${
                    best.title
                    || "低置信候选"
                  }`
                : (
                    resolved.signals
                      ?.llmRescueError
                    || "没有可靠元数据候选"
                  );

            progress.updateFile(
              file,
              "review",
              detail
            );

            summary.review += 1;

            progress.setReviewActions(
              file,
              {
                onReview:
                  async () => {
                    await this.reviewBatchNeedsReview(
                      file,
                      resolved,
                      progress,
                      summary
                    );
                  },
                onOpenPdf:
                  async () => {
                    await this.app.workspace
                      .getLeaf("tab")
                      .openFile(
                        file
                      );
                  },
              }
            );

            continue;
          }

          const meta =
            resolved.meta;

          const identity =
            this.metadataIdentity(
              meta
            );

          const existing =
            this.findExistingPaperForMeta(
              meta
            );

          if (
            existing
            || (
              identity
              && batchIdentities.has(
                identity
              )
            )
          ) {
            const target =
              existing
              || (
                identity
                  ? batchExistingTargets
                      .get(identity)
                  : null
              );

            progress.updateFile(
              file,
              "duplicate",
              target
                ? `已存在：${target.title}`
                : "本批次中已导入同一论文"
            );

            progress.setDuplicateActions(
              file,
              {
                existing:
                  target,
                onOpenExisting:
                  target?.file
                    ? async () => {
                        await this.app.workspace
                          .getLeaf("tab")
                          .openFile(
                            target.file
                          );
                      }
                    : null,
                onOpenPdf:
                  async () => {
                    await this.app.workspace
                      .getLeaf("tab")
                      .openFile(
                        file
                      );
                  },
              }
            );

            summary.duplicate += 1;

            continue;
          }

          progress.updateFile(
            file,
            "importing",
            `正在归档 · ${
              this.metadataSourceLabel(
                meta
              )
              || "metadata"
            }`
          );

          const committed =
            await this.commitBatchPaper(
              file,
              meta,
              resolved.matchMethod
            );

          if (identity) {
            batchIdentities.add(
              identity
            );

            batchExistingTargets.set(
              identity,
              {
                file:
                  committed.note,
                title:
                  meta.title,
              }
            );
          }

          progress.updateFile(
            file,
            "imported",
            [
              "已归档",
              meta.year || "",
              meta.venue || "",
              this.metadataSourceLabel(
                meta
              ),
            ]
              .filter(Boolean)
              .join(" · ")
            || `已归档 · ${meta.title}`
          );

          summary.imported += 1;
        }
        catch (error) {
          console.error(
            "Research Library batch PDF import failed:",
            file.path,
            error
          );

          progress.updateFile(
            file,
            "failed",
            error?.message
            || String(error)
          );

          summary.failed += 1;
        }
        finally {
          this.batchProgressCallback =
            null;

          // Every processed item must leave the loop in a
          // terminal state. This catches future UI/state bugs
          // without leaving misleading permanent "Searching"
          // or "Importing" rows.
          progress.ensureTerminalState(
            file,
            "failed",
            "后台任务已结束，但 UI 未收到终态；请检查该论文实际文件状态"
          );
        }
      }
    }
    finally {
      this.batchImportActive =
        false;

      this.batchProgressCallback =
        null;
    }

    if (
      summary.imported > 0
    ) {
      await this.loadPapers();

      this.view =
        "inbox";

      this.render();
    }

    progress.finish(
      summary
    );

    new Notice(
      `批量导入完成：${summary.imported} 已导入 · ${summary.review} 待人工确认 · ${summary.duplicate} 重复 · ${summary.failed} 失败`,
      9000
    );
  }

  setImportBusy(message) {
    if (
      this.maintenanceRefreshProgressCallback
    ) {
      this.maintenanceRefreshProgressCallback(
        message || ""
      );

      return;
    }

    if (
      this.batchImportActive
      && this.batchProgressCallback
    ) {
      if (message) {
        this.batchProgressCallback(
          message
        );
      }

      return;
    }

    this.rootEl
      ?.querySelector(
        ".rl-import-overlay"
      )
      ?.remove();

    if (!message) return;

    const overlay =
      this.rootEl.createDiv({
        cls: "rl-import-overlay",
      });

    const card =
      overlay.createDiv({
        cls: "rl-import-progress",
      });

    const spinner =
      card.createSpan({
        cls: "rl-import-spinner",
      });

    this.createIcon(
      spinner,
      "loader-circle"
    );

    card.createSpan({
      cls: "rl-import-progress-text",
      text: message,
    });
  }

  async chooseInboxPdf() {
    const folder =
      this.plugin.settings
        .inboxFolder
        .replace(/\/+$/, "");

    const files =
      this.app.vault
        .getFiles()
        .filter(
          (file) =>
            file.extension
              ?.toLowerCase()
              === "pdf"
            &&
            file.path.startsWith(
              `${folder}/`
            )
        )
        .sort(
          (a, b) =>
            b.stat.mtime
            - a.stat.mtime
        );

    if (!files.length) {
      new Notice(
        `PDF Inbox 中没有 PDF：${folder}`
      );

      return null;
    }

    // Main Import must always be explicit and predictable.
    // Even when the active file is an Inbox PDF, or Inbox only
    // contains one PDF, show the picker and wait for the user to
    // choose a paper before parsing/searching starts.
    return new Promise((resolve) => {
      new PdfPickerModal(
        this.app,
        {
          files,
          onChoose:
            (selected) =>
              resolve(
                Array.isArray(selected)
                  ? selected
                  : selected
                    ? [selected]
                    : null
              ),
          onCancel:
            () => resolve(null),
        }
      ).open();
    });
  }

  chooseMetadataCandidate(
    candidates,
    signals,
    sourcePdf,
    detectedTitle = ""
  ) {
    return new Promise((resolve) => {
      new MetadataCandidateModal(
        this.app,
        {
          candidates,
          detectedTitle:
            detectedTitle
            || signals.title
            || sourcePdf.basename,
          diagnostics:
            this.lastMetadataDiagnostics
            || [],
          initialCitation:
            signals.citationRescue
            || null,
          parseCitation:
            async (
              text,
              mode
            ) =>
              mode === "llm"
                ? await this.parseCitationWithLlm(
                    text
                  )
                : this.parseGbCitationText(
                    text
                  ),
          onCitationSearch:
            (citationMeta) =>
              resolve({
                kind:
                  "citation-search",
                meta:
                  citationMeta,
              }),
          onUseCitation:
            (citationMeta) =>
              resolve({
                kind:
                  "citation-meta",
                meta:
                  citationMeta,
              }),
          onChoose:
            (meta) =>
              resolve({
                kind: "candidate",
                meta,
              }),
          onUsePdf:
            () =>
              resolve({
                kind: "pdf",
              }),
          onCancel:
            () => resolve(null),
        }
      ).open();
    });
  }

  isReliableMetadataCandidate(
    candidate
  ) {
    if (!candidate) {
      return false;
    }

    return Boolean(
      candidate._identifierExact
      || candidate._exactTitle
      || Number(
        candidate._matchPercent
      ) >= 70
    );
  }

  chooseMetadataSearchFailure({
    sourcePdf,
    signals,
    searchTitle,
    candidates,
  }) {
    return new Promise((resolve) => {
      new MetadataSearchFallbackModal(
        this.app,
        {
          sourcePdf,
          signals,
          searchTitle,
          candidates,
          diagnostics:
            this.lastMetadataDiagnostics
            || [],
          parseCitation:
            async (
              text,
              mode
            ) =>
              mode === "llm"
                ? await this.parseCitationWithLlm(
                    text
                  )
                : this.parseGbCitationText(
                    text
                  ),
          onCitationSearch:
            (citationMeta) =>
              resolve({
                kind:
                  "citation-search",
                meta:
                  citationMeta,
              }),
          onUseCitation:
            (citationMeta) =>
              resolve({
                kind:
                  "citation-meta",
                meta:
                  citationMeta,
              }),
          onRetry:
            (title) =>
              resolve({
                kind: "retry",
                title,
              }),
          onUsePdf:
            (title) =>
              resolve({
                kind: "pdf",
                title,
              }),
          onCancel:
            () => resolve(null),
        }
      ).open();
    });
  }


  previewPaperImport({
    sourcePdf,
    meta,
    matchMethod,
    signals,
  }) {
    const provenance =
      this.importProvenance(
        meta,
        matchMethod
      );

    const previewMeta =
      Object.assign(
        {},
        meta
      );

    previewMeta.firstAuthorFamily =
      this.familyFromName(
        previewMeta.authors?.[0]
      )
      || previewMeta.firstAuthorFamily
      || "unknown";

    const previewKey =
      this.makeUniqueCitekey(
        this.makeCitekey(
          previewMeta
        )
      );

    const previewPdfPath =
      `${this.plugin.settings.pdfFolder}/${previewKey}.pdf`;

    return new Promise((resolve) => {
      new PaperImportPreviewModal(
        this.app,
        {
          sourcePdf,
          meta,
          matchMethod,
          signals,
          provenance,
          previewPdfPath,
          onImport:
            (edited) =>
              resolve(edited),
          onCancel:
            () => resolve(null),
        }
      ).open();
    });
  }

  async extractPdfSignals(
    file,
    scanPages
  ) {
    const data =
      new Uint8Array(
        await this.app.vault
          .readBinary(file)
      );

    const pdfjsLib =
      await loadPdfJs();

    const pdf =
      await pdfjsLib
        .getDocument({
          data,
        })
        .promise;

    let info = {};
    let metadata = null;

    try {
      const md =
        await pdf.getMetadata();

      info =
        md?.info || {};

      metadata =
        md?.metadata || null;
    }
    catch (_) {}

    const pages = [];
    let firstPageLines = [];
    let firstPageText = "";

    const n =
      Math.min(
        Math.max(
          1,
          Number(scanPages) || 3
        ),
        pdf.numPages
      );

    for (
      let pageNumber = 1;
      pageNumber <= n;
      pageNumber++
    ) {
      const page =
        await pdf.getPage(
          pageNumber
        );

      const textContent =
        await page
          .getTextContent();

      const pageText =
        textContent.items
          .map(
            (item) =>
              String(
                item.str || ""
              ).trim()
          )
          .filter(Boolean)
          .join(" ");

      pages.push(
        pageText
      );

      if (pageNumber === 1) {
        firstPageText =
          pageText;

        firstPageLines =
          this.reconstructPdfLines(
            textContent.items
          );
      }
    }

    const text =
      pages.join("\n");

    const pdfTitle =
      this.cleanCandidateTitle(
        info?.Title
      )
      ||
      this.cleanCandidateTitle(
        metadata?.get?.(
          "dc:title"
        )
      )
      ||
      "";

    return {
      doi:
        this.extractDoi(text),
      arxiv:
        this.extractArxiv(text),
      title:
        pdfTitle
        ||
        this.guessTitleFromLines(
          firstPageLines
        )
        ||
        "",
      pdfAuthor:
        this.cleanMeta(
          info?.Author
        )
        ||
        this.cleanMeta(
          metadata?.get?.(
            "dc:creator"
          )
        )
        ||
        "",
      keywords:
        this.splitKeywords(
          info?.Keywords
        ),
      creationDate:
        this.cleanMeta(
          info?.CreationDate
        ),
      firstPageText:
        String(
          firstPageText || ""
        ).slice(
          0,
          14000
        ),
      sourceFilename:
        file?.name || "",
    };
  }

  citationMetaFromParsed(
    parsed,
    source =
      "citation-gb"
  ) {
    const title =
      this.cleanCandidateTitle(
        parsed?.title
      )
      || this.cleanText(
        parsed?.title
        || ""
      );

    const authors =
      (
        Array.isArray(
          parsed?.authors
        )
          ? parsed.authors
          : []
      )
        .map(
          (author) =>
            this.cleanText(
              author
            )
        )
        .filter(Boolean);

    const yearMatch =
      String(
        parsed?.year || ""
      ).match(
        /\b(19|20)\d{2}\b/
      );

    const doi =
      this.normalizeDoi(
        parsed?.doi || ""
      );

    const arxiv =
      String(
        parsed?.arxiv || ""
      )
        .replace(
          /^arxiv:\s*/i,
          ""
        )
        .replace(
          /^https?:\/\/arxiv\.org\/abs\//i,
          ""
        )
        .replace(
          /v\d+$/i,
          ""
        )
        .trim();

    return {
      title,
      authors,
      firstAuthorFamily:
        this.familyFromName(
          authors[0]
        )
        || "unknown",
      year:
        yearMatch
          ? yearMatch[0]
          : "",
      venue:
        this.cleanText(
          parsed?.venue || ""
        ),
      publisher:
        this.cleanText(
          parsed?.publisher || ""
        ),
      workType:
        this.cleanText(
          parsed?.workType || ""
        )
        || "conference-paper",
      volume:
        this.cleanText(
          parsed?.volume || ""
        ),
      issue:
        this.cleanText(
          parsed?.issue || ""
        ),
      pages:
        this.cleanText(
          parsed?.pages || ""
        ),
      doi,
      arxiv,
      url:
        this.cleanText(
          parsed?.url || ""
        ),
      keywords: [],
      citationCount: 0,
      metadataSource:
        source,
      _sources:
        [source],
      citationConfidence:
        Number(
          parsed?.confidence || 0
        ),
    };
  }

  parseGbCitationText(
    citationText
  ) {
    const raw =
      String(
        citationText || ""
      )
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    if (!raw) {
      throw new Error(
        "请先粘贴参考文献文本。"
      );
    }

    let authorPart = "";
    let title = "";
    let typeCode = "";
    let rest = "";

    // Preferred GB/T 7714 form:
    // Authors. Title[C]//Conference. Publisher, 2018: 1-10.
    const typed =
      raw.match(
        /^(.+?)\.\s+(.+?)\s*\[([A-Za-z])(?:\/[A-Za-z])?\]\s*(.*)$/u
      );

    if (typed) {
      authorPart =
        typed[1].trim();

      title =
        typed[2]
          .replace(
            /\s+/g,
            " "
          )
          .trim();

      typeCode =
        String(
          typed[3] || ""
        ).toUpperCase();

      rest =
        String(
          typed[4] || ""
        ).trim();
    }
    else {
      // Scholar / manually copied fallback without [C]//.
      // Identify the author/title boundary first, then use the
      // year as an anchor for the tail.
      const boundary =
        raw.match(
          /^(.+?\bet\s+al\.|.+?)\s+(.+)$/iu
        );

      const yearMatches =
        [
          ...raw.matchAll(
            /\b(19|20)\d{2}\b/g
          ),
        ];

      const lastYear =
        yearMatches.length
          ? yearMatches[
              yearMatches.length - 1
            ]
          : null;

      if (!lastYear) {
        throw new Error(
          "没有识别到年份，也没有识别到标准 GB/T 7714 的 [C]/[J] 类型标记。可尝试“Parse with LLM”。"
        );
      }

      // More reliable fallback: split at the first ". " that is
      // followed by a plausible paper title, while allowing
      // author initials and "et al." punctuation.
      const dotPositions = [];

      for (
        let i = 0;
        i < raw.length - 1;
        i++
      ) {
        if (
          raw[i] === "."
          && /\s/.test(
            raw[i + 1]
          )
        ) {
          dotPositions.push(i);
        }
      }

      let authorSplit = -1;

      for (
        const position
        of dotPositions
      ) {
        const before =
          raw.slice(
            0,
            position
          ).trim();

        const after =
          raw.slice(
            position + 1
          ).trim();

        if (
          before.length >= 3
          && after.length >= 12
          && (
            /,\s*/u.test(before)
            || /\bet\s+al$/iu.test(
              before
            )
          )
        ) {
          authorSplit =
            position;
          break;
        }
      }

      if (authorSplit < 0) {
        throw new Error(
          "无法可靠区分作者和标题。建议复制 Google Scholar 的 GB/T 7714 格式，或使用 LLM 解析。"
        );
      }

      authorPart =
        raw.slice(
          0,
          authorSplit
        ).trim();

      const remainder =
        raw.slice(
          authorSplit + 1
        ).trim();

      const yearIndex =
        remainder.lastIndexOf(
          lastYear[0]
        );

      const beforeYear =
        yearIndex >= 0
          ? remainder.slice(
              0,
              yearIndex
            ).trim()
          : remainder;

      // Try to split title from venue using the last ". " before
      // the year. This is intentionally conservative.
      const titleVenueMatch =
        beforeYear.match(
          /^(.+?)\.\s+([^.]*)[,，]?\s*$/u
        );

      if (titleVenueMatch) {
        title =
          titleVenueMatch[1]
            .trim();

        rest =
          `${titleVenueMatch[2].trim()}, ${lastYear[0]}${
            remainder.slice(
              yearIndex
              + lastYear[0].length
            )
          }`;
      }
      else {
        title =
          beforeYear
            .replace(
              /[,，]\s*$/,
              ""
            )
            .trim();

        rest =
          `${lastYear[0]}${
            remainder.slice(
              yearIndex
              + lastYear[0].length
            )
          }`;
      }
    }

    const authors =
      authorPart
        .replace(
          /,\s*et\s+al\.?$/iu,
          ""
        )
        .replace(
          /\bet\s+al\.?$/iu,
          ""
        )
        .split(
          /\s*[,，]\s*/u
        )
        .map(
          (author) =>
            author.trim()
        )
        .filter(Boolean);

    let venue = "";
    let publisher = "";

    if (
      rest.startsWith("//")
    ) {
      rest =
        rest
          .slice(2)
          .trim();

      const venueMatch =
        rest.match(
          /^(.+?)\.\s*(.*)$/u
        );

      if (venueMatch) {
        venue =
          venueMatch[1]
            .trim();

        rest =
          venueMatch[2]
            .trim();
      }
      else {
        venue =
          rest;
      }
    }
    else {
      rest =
        rest.replace(
          /^\.\s*/,
          ""
        );
    }

    const yearMatches =
      [
        ...String(rest || raw)
          .matchAll(
            /\b(19|20)\d{2}\b/g
          ),
      ];

    const year =
      yearMatches.length
        ? yearMatches[
            yearMatches.length - 1
          ][0]
        : "";

    if (!venue) {
      const beforeYear =
        year
          ? rest.split(
              year
            )[0]
          : rest;

      venue =
        beforeYear
          .replace(
            /[,，;；]\s*$/u,
            ""
          )
          .replace(
            /\.\s*$/u,
            ""
          )
          .trim();
    }

    if (year) {
      const escapedYear =
        String(year)
          .replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
          );

      const publisherMatch =
        rest.match(
          new RegExp(
            `(?:^|[.；;]\\s*)([^,，.;；]+)[,，]\\s*${escapedYear}`
          )
        );

      if (publisherMatch) {
        publisher =
          publisherMatch[1]
            .trim();
      }
    }

    const pagesMatch =
      year
        ? rest.match(
            new RegExp(
              `${year}\\s*[:：]\\s*([0-9]+(?:\\s*[-–—]\\s*[0-9]+)?)`
            )
          )
        : null;

    const volumeIssue =
      rest.match(
        /\b(\d+)\s*\(\s*(\d+)\s*\)/u
      );

    const doi =
      this.normalizeDoi(
        raw.match(
          /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i
        )?.[0]
        || ""
      );

    const arxiv =
      raw.match(
        /\barXiv\s*:\s*([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)/i
      )?.[1]
      || "";

    const workType =
      typeCode === "J"
        ? "journal-article"
        : typeCode === "C"
          ? "conference-paper"
          : typeCode === "D"
            ? "thesis"
            : (
                venue
                  ? "conference-paper"
                  : "paper"
              );

    if (
      !title
      || title.length < 5
    ) {
      throw new Error(
        "没有解析出可靠的论文标题。可尝试“Parse with LLM”。"
      );
    }

    const confidence =
      Math.min(
        0.99,
        (
          typeCode
            ? 0.72
            : 0.58
        )
        + (
          title
            ? 0.10
            : 0
        )
        + (
          authors.length
            ? 0.07
            : 0
        )
        + (
          year
            ? 0.06
            : 0
        )
        + (
          venue
            ? 0.04
            : 0
        )
      );

    return this.citationMetaFromParsed(
      {
        title,
        authors,
        year,
        venue,
        publisher,
        workType,
        volume:
          volumeIssue?.[1]
          || "",
        issue:
          volumeIssue?.[2]
          || "",
        pages:
          pagesMatch?.[1]
            ?.replace(
              /\s+/g,
              ""
            )
          || "",
        doi,
        arxiv,
        confidence,
      },
      "citation-gb"
    );
  }

  async parseCitationWithLlm(
    citationText
  ) {
    if (
      !this.isLlmMetadataRescueReady()
    ) {
      throw new Error(
        "LLM Metadata Rescue 尚未配置或启用。"
      );
    }

    const text =
      String(
        citationText || ""
      )
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    if (!text) {
      throw new Error(
        "请先粘贴参考文献文本。"
      );
    }

    const model =
      String(
        this.plugin.settings
          .llmVisionModel
        || ""
      ).trim();

    const prompt = [
      "Parse this bibliographic citation conservatively.",
      "Do not invent fields that are not supported by the citation.",
      "Return one JSON object only with this schema:",
      '{"title":"","authors":[],"year":null,"venue":"","publisher":"","workType":"","volume":"","issue":"","pages":"","doi":"","arxiv":"","confidence":0}',
      "confidence is 0 to 1.",
      "",
      "Citation:",
      text,
    ].join(
      "\n"
    );

    const result =
      await this.plugin
        .requestLlmChatCompletion(
          {
            model,
            temperature: 0,
            messages: [
              {
                role:
                  "system",
                content:
                  "You parse academic references into bibliographic JSON. Output valid JSON only.",
              },
              {
                role:
                  "user",
                content:
                  prompt,
              },
            ],
          },
          {
            timeoutMs:
              Math.min(
                45000,
                (
                  Number(
                    this.plugin.settings
                      .llmTimeoutSeconds
                  ) || 30
                ) * 1000
              ),
          }
        );

    const raw =
      this.plugin
        .extractLlmResponseText(
          result.response.json
        );

    const parsed =
      this.parseLlmMetadataJson(
        raw
      );

    const meta =
      this.citationMetaFromParsed(
        parsed,
        "citation-llm"
      );

    if (
      !meta.title
      || meta.title.length < 5
    ) {
      throw new Error(
        "LLM 没有从参考文献中识别出可用标题。"
      );
    }

    return meta;
  }

  isLlmMetadataRescueReady() {
    const settings =
      this.plugin.settings;

    return Boolean(
      settings.llmRescueEnabled
      && String(
        settings.llmEndpoint
        || ""
      ).trim()
      && String(
        settings.llmVisionModel
        || ""
      ).trim()
    );
  }

  async renderPdfFirstPageImage(
    file
  ) {
    const data =
      new Uint8Array(
        await this.app.vault
          .readBinary(file)
      );

    const pdfjsLib =
      await loadPdfJs();

    const pdf =
      await pdfjsLib
        .getDocument({
          data,
        })
        .promise;

    try {
      const page =
        await pdf.getPage(1);

      const baseViewport =
        page.getViewport({
          scale: 1,
        });

      const maxWidth = 1400;

      const scale =
        Math.min(
          2,
          Math.max(
            1.15,
            maxWidth
            / Math.max(
              1,
              baseViewport.width
            )
          )
        );

      const viewport =
        page.getViewport({
          scale,
        });

      const canvas =
        document.createElement(
          "canvas"
        );

      canvas.width =
        Math.ceil(
          viewport.width
        );

      canvas.height =
        Math.ceil(
          viewport.height
        );

      const context =
        canvas.getContext(
          "2d",
          {
            alpha: false,
          }
        );

      if (!context) {
        throw new Error(
          "无法创建 PDF 首页 Canvas"
        );
      }

      context.save();

      context.fillStyle =
        "#ffffff";

      context.fillRect(
        0,
        0,
        canvas.width,
        canvas.height
      );

      context.restore();

      await page.render({
        canvasContext:
          context,
        viewport,
      }).promise;

      return canvas.toDataURL(
        "image/jpeg",
        0.82
      );
    }
    finally {
      try {
        await pdf.destroy?.();
      }
      catch (_) {}
    }
  }

  async rescueMetadataWithLlm(
    sourcePdf,
    signals
  ) {
    if (
      !this.isLlmMetadataRescueReady()
    ) {
      throw new Error(
        "LLM Metadata Rescue 尚未配置"
      );
    }

    const settings =
      this.plugin.settings;

    const endpoint =
      this.plugin
        .resolveLlmChatCompletionsUrl(
          settings.llmEndpoint
        );

    const model =
      String(
        settings.llmVisionModel
        || ""
      ).trim();

    const apiKey =
      String(
        settings.llmApiKey
        || ""
      ).trim();

    const timeoutMs =
      Math.max(
        5000,
        Math.min(
          120000,
          (
            Number(
              settings.llmTimeoutSeconds
            ) || 30
          ) * 1000
        )
      );

    let firstPageImage = "";

    try {
      firstPageImage =
        await this.renderPdfFirstPageImage(
          sourcePdf
        );
    }
    catch (imageError) {
      console.warn(
        "Research Library: failed to render first PDF page for LLM rescue",
        imageError
      );
    }

    const firstPageText =
      String(
        signals?.firstPageText
        || ""
      )
        .replace(
          /\s+/g,
          " "
        )
        .trim()
        .slice(
          0,
          12000
        );

    if (
      !firstPageImage
      && !firstPageText
    ) {
      throw new Error(
        "PDF 首页既无法渲染，也没有可用文本"
      );
    }

    const prompt =
      [
        "You are extracting bibliographic metadata from the FIRST PAGE of an academic paper.",
        "Use only evidence visible on the page image or in the extracted first-page text.",
        "Do not infer the paper identity from the filename.",
        "Do not fabricate DOI, arXiv ID, authors, year, or venue.",
        "The most important field is the exact paper title as printed on the first page.",
        "Return ONE JSON object only, with this schema:",
        '{"title":"","authors":[],"year":null,"venue":"","doi":"","arxiv":"","confidence":0}',
        "confidence must be a number from 0 to 1.",
        "Use empty strings / empty arrays / null when uncertain.",
        "",
        "Extracted first-page text:",
        firstPageText
        || "(no text extracted)",
      ].join(
        "\n"
      );

    const userContent = [
      {
        type: "text",
        text: prompt,
      },
    ];

    if (firstPageImage) {
      userContent.push({
        type:
          "image_url",
        image_url: {
          url:
            firstPageImage,
        },
      });
    }

    const body = {
      model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "Extract bibliographic metadata conservatively. Return valid JSON only.",
        },
        {
          role: "user",
          content:
            userContent,
        },
      ],
    };

    const requestResult =
      await this.plugin
        .requestLlmChatCompletion(
          body,
          {
            timeoutMs,
            endpoint,
            apiKey,
          }
        );

    const json =
      requestResult
        .response
        .json;

    const rawContent =
      this.extractLlmTextContent(
        json
      );

    const parsed =
      this.parseLlmMetadataJson(
        rawContent
      );

    const title =
      this.cleanCandidateTitle(
        parsed.title
      )
      ||
      this.cleanText(
        parsed.title
      );

    if (
      !title
      || title.length < 6
    ) {
      throw new Error(
        "LLM 没有识别出可用的论文标题"
      );
    }

    const authors =
      Array.isArray(
        parsed.authors
      )
        ? parsed.authors
            .map(
              (author) =>
                this.cleanText(
                  author
                )
            )
            .filter(Boolean)
        : this.cleanText(
            parsed.authors
            || ""
          )
            .split(
              /\s*;\s*|\s*,\s*(?=[A-Z])/u
            )
            .map(
              (author) =>
                author.trim()
            )
            .filter(Boolean);

    const confidenceRaw =
      Number(
        parsed.confidence
      );

    const confidence =
      Number.isFinite(
        confidenceRaw
      )
        ? Math.max(
            0,
            Math.min(
              1,
              confidenceRaw
            )
          )
        : 0;

    return {
      title,
      authors,
      year:
        parsed.year
        ? Number(
            String(
              parsed.year
            ).match(
              /\b(19|20)\d{2}\b/
            )?.[0]
            || 0
          )
          || ""
        : "",
      venue:
        this.cleanText(
          parsed.venue
          || ""
        ),
      doi:
        this.normalizeDoi(
          parsed.doi
          || ""
        ),
      arxiv:
        String(
          parsed.arxiv
          || ""
        )
          .replace(
            /^arxiv:\s*/i,
            ""
          )
          .replace(
            /v\d+$/i,
            ""
          )
          .trim(),
      confidence,
      model,
    };
  }

  extractLlmTextContent(
    json
  ) {
    const content =
      json?.choices?.[0]
        ?.message?.content
      ?? json?.output_text
      ?? json?.text
      ?? "";

    if (
      Array.isArray(content)
    ) {
      return content
        .map(
          (part) =>
            typeof part
              === "string"
              ? part
              : part?.text
                || part?.content
                || ""
        )
        .filter(Boolean)
        .join("\n");
    }

    return String(
      content || ""
    );
  }

  parseLlmMetadataJson(
    raw
  ) {
    const text =
      String(raw || "")
        .trim();

    if (!text) {
      throw new Error(
        "LLM API 没有返回文本内容"
      );
    }

    const stripped =
      text
        .replace(
          /^```(?:json)?\s*/i,
          ""
        )
        .replace(
          /\s*```$/i,
          ""
        )
        .trim();

    try {
      return JSON.parse(
        stripped
      );
    }
    catch (_) {}

    const firstBrace =
      stripped.indexOf("{");

    const lastBrace =
      stripped.lastIndexOf("}");

    if (
      firstBrace >= 0
      && lastBrace > firstBrace
    ) {
      try {
        return JSON.parse(
          stripped.slice(
            firstBrace,
            lastBrace + 1
          )
        );
      }
      catch (_) {}
    }

    throw new Error(
      "LLM 返回内容不是有效 JSON"
    );
  }

  reconstructPdfLines(items) {
    const rows = [];

    for (const item of items || []) {
      if (
        !item?.str?.trim()
        || !Array.isArray(
          item.transform
        )
      ) {
        continue;
      }

      const x =
        Number(
          item.transform[4]
          || 0
        );

      const y =
        Number(
          item.transform[5]
          || 0
        );

      const size =
        Math.abs(
          Number(
            item.height
            || item.transform[3]
            || 1
          )
        );

      let row =
        rows.find(
          (candidate) =>
            Math.abs(
              candidate.y - y
            )
            <= 2.5
        );

      if (!row) {
        row = {
          y,
          size,
          items: [],
        };

        rows.push(row);
      }

      row.items.push({
        x,
        text:
          item.str.trim(),
      });

      row.size =
        Math.max(
          row.size,
          size
        );
    }

    return rows
      .sort(
        (a, b) =>
          b.y - a.y
      )
      .map((row) => {
        row.items.sort(
          (a, b) =>
            a.x - b.x
        );

        return {
          y: row.y,
          size: row.size,
          text:
            this.normalizeWhitespace(
              row.items
                .map(
                  (item) =>
                    item.text
                )
                .join(" ")
            ),
        };
      })
      .filter(
        (row) =>
          row.text
      );
  }

  guessTitleFromLines(lines) {
    let top =
      (lines || [])
        .slice(0, 35);

    const abstractIndex =
      top.findIndex(
        (line) =>
          /^abstract\b/i
            .test(line.text)
          ||
          /^摘要\b/
            .test(line.text)
      );

    if (abstractIndex > 1) {
      top =
        top.slice(
          0,
          abstractIndex
        );
    }

    const plausible =
      top.filter(
        (line) =>
          this.isTitleLine(
            line.text
          )
      );

    if (!plausible.length) {
      return "";
    }

    const max =
      Math.max(
        ...plausible
          .map(
            (line) =>
              line.size || 1
          )
      );

    const large =
      plausible.filter(
        (line) =>
          (line.size || 1)
          >= max * 0.84
      );

    if (!large.length) {
      return "";
    }

    const selected =
      [large[0]];

    for (
      let index = 1;
      index < large.length
      && selected.length < 4;
      index++
    ) {
      const previous =
        selected[
          selected.length - 1
        ];

      const current =
        large[index];

      if (
        Math.abs(
          previous.y
          - current.y
        )
        >
        Math.max(
          45,
          previous.size * 3.5
        )
      ) {
        break;
      }

      selected.push(
        current
      );
    }

    return this.cleanCandidateTitle(
      selected
        .map(
          (line) =>
            line.text
        )
        .join(" ")
    );
  }

  isTitleLine(text) {
    const value =
      this.normalizeWhitespace(
        text
      );

    if (
      value.length < 8
      || value.length > 260
    ) {
      return false;
    }

    return ![
      /^arxiv[:\s]/i,
      /^doi[:\s]/i,
      /^https?:\/\//i,
      /^www\./i,
      /^vol(?:ume)?[\s.]/i,
      /^no\.[\s]/i,
      /^pages?[\s:]/i,
      /^copyright\b/i,
      /^©/,
      /^received\b/i,
      /^accepted\b/i,
      /^published\b/i,
      /^\d{1,4}$/,
    ].some(
      (pattern) =>
        pattern.test(value)
    );
  }

  cleanCandidateTitle(value) {
    const text =
      this.cleanMeta(value)
        .replace(
          /^Microsoft Word\s*[-–—:]\s*/i,
          ""
        )
        .replace(
          /\.pdf$/i,
          ""
        )
        .trim();

    if (
      !text
      ||
      /^(untitled|document|arxiv)$/i
        .test(text)
      ||
      text.length < 8
    ) {
      return "";
    }

    return text;
  }

  extractDoi(text) {
    const matches =
      String(text || "")
        .replace(
          /\s+/g,
          " "
        )
        .match(
          /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/ig
        )
      ||
      [];

    for (let value of matches) {
      value =
        value
          .replace(
            /[)\]}>.,;:]+$/g,
            ""
          )
          .trim();

      if (
        /^10\.\d{4,9}\/\S+$/i
          .test(value)
      ) {
        return value
          .toLowerCase();
      }
    }

    return "";
  }

  extractArxiv(text) {
    const source =
      String(text || "");

    let match =
      source.match(
        /arxiv\s*:\s*(\d{4}\.\d{4,5}(?:v\d+)?)/i
      );

    if (match) {
      return match[1];
    }

    match =
      source.match(
        /arxiv\s*:\s*([a-z][a-z.-]+\/\d{7}(?:v\d+)?)/i
      );

    return match
      ? match[1]
      : "";
  }

  async fetchCrossrefByDoi(doi) {
    const normalized =
      this.normalizeDoi(doi);

    const encoded =
      this.encodeDoiPath(
        normalized
      );

    const mailto =
      this.plugin.settings
        .contactEmail
        ? `?mailto=${
            encodeURIComponent(
              this.plugin.settings
                .contactEmail
            )
          }`
        : "";

    const json =
      await this.getJson(
        `https://api.crossref.org/works/${encoded}${mailto}`
      );

    return json
      ?.message
      ?.title
      ?.length
        ? this.crossrefToMeta(
            json.message
          )
        : null;
  }

  async fetchDataCiteByDoi(doi) {
    const normalized =
      this.normalizeDoi(doi);

    const json =
      await this.getJson(
        `https://api.datacite.org/dois/${
          this.encodeDoiPath(
            normalized
          )
        }`
      );

    return json
      ?.data
      ?.attributes
      ?.titles
      ?.length
        ? this.dataciteToMeta(
            json.data.attributes,
            normalized
          )
        : null;
  }

  semanticScholarHeaders() {
    const key =
      String(
        this.plugin.settings
          .semanticScholarApiKey
        || ""
      ).trim();

    return key
      ? {
          "x-api-key": key,
        }
      : {};
  }

  async fetchSemanticScholarByDoi(doi) {
    const normalized =
      this.normalizeDoi(doi);

    if (!normalized) return null;

    const paperId =
      encodeURIComponent(
        `DOI:${normalized}`
      );

    const fields =
      [
        "paperId",
        "title",
        "authors",
        "year",
        "venue",
        "externalIds",
        "url",
        "publicationTypes",
        "citationCount",
      ].join(",");

    const json =
      await this.getJson(
        `https://api.semanticscholar.org/graph/v1/paper/${paperId}?fields=${encodeURIComponent(fields)}`,
        this.semanticScholarHeaders()
      );

    return json?.title
      ? this.semanticScholarToMeta(json)
      : null;
  }

  async fetchSemanticScholarByArxiv(arxiv) {
    const clean =
      String(arxiv || "")
        .trim()
        .replace(/v\d+$/i, "");

    if (!clean) return null;

    const paperId =
      encodeURIComponent(
        `ARXIV:${clean}`
      );

    const fields =
      [
        "paperId",
        "title",
        "authors",
        "year",
        "venue",
        "externalIds",
        "url",
        "publicationTypes",
        "citationCount",
      ].join(",");

    const json =
      await this.getJson(
        `https://api.semanticscholar.org/graph/v1/paper/${paperId}?fields=${encodeURIComponent(fields)}`,
        this.semanticScholarHeaders()
      );

    return json?.title
      ? this.semanticScholarToMeta(json)
      : null;
  }

  async searchSemanticScholar(title) {
    const query =
      this.normalizeWhitespace(title)
        .slice(0, 300);

    if (!query) return [];

    const limit =
      Math.min(
        20,
        Math.max(
          5,
          Number(
            this.plugin.settings
              .searchRows
          ) || 8
        )
      );

    const fields =
      [
        "paperId",
        "title",
        "authors",
        "year",
        "venue",
        "externalIds",
        "url",
        "publicationTypes",
        "citationCount",
      ].join(",");

    const params =
      new URLSearchParams({
        query,
        limit: String(limit),
        fields,
      });

    const json =
      await this.getJsonStrict(
        `https://api.semanticscholar.org/graph/v1/paper/search?${params}`,
        this.semanticScholarHeaders()
      );

    return (
      json?.data || []
    )
      .filter(
        (paper) => paper?.title
      )
      .map(
        (paper) =>
          this.semanticScholarToMeta(
            paper
          )
      );
  }

  async searchOpenAlex(title) {
    const query =
      this.normalizeWhitespace(title)
        .slice(0, 300);

    if (!query) return [];

    const limit =
      Math.min(
        20,
        Math.max(
          5,
          Number(
            this.plugin.settings
              .searchRows
          ) || 8
        )
      );

    const params =
      new URLSearchParams({
        search: query,
        "per-page": String(limit),
      });

    const apiKey =
      String(
        this.plugin.settings
          .openAlexApiKey
        || ""
      ).trim();

    if (apiKey) {
      params.set(
        "api_key",
        apiKey
      );
    }

    const json =
      await this.getJsonStrict(
        `https://api.openalex.org/works?${params}`
      );

    return (
      json?.results || []
    )
      .filter(
        (work) => work?.title
      )
      .map(
        (work) =>
          this.openAlexToMeta(work)
      );
  }

  async searchCrossref(query) {
    const title =
      this.normalizeWhitespace(query)
        .slice(0, 300);

    if (!title) return [];

    const params =
      new URLSearchParams({
        "query.title":
          title,
        rows:
          String(
            Math.min(
              20,
              Math.max(
                5,
                Number(
                  this.plugin.settings
                    .searchRows
                ) || 8
              )
            )
          ),
      });

    if (
      this.plugin.settings
        .contactEmail
    ) {
      params.set(
        "mailto",
        this.plugin.settings
          .contactEmail
      );
    }

    const json =
      await this.getJsonStrict(
        `https://api.crossref.org/works?${params}`
      );

    return (
      json
        ?.message
        ?.items
      ||
      []
    )
      .filter(
        (item) =>
          item?.title?.length
      )
      .map(
        (item) =>
          this.crossrefToMeta(
            item
          )
      );
  }

  openReviewContentValue(
    content,
    key
  ) {
    const raw =
      content?.[key];

    if (
      raw
      && typeof raw === "object"
      && !Array.isArray(raw)
      && Object.prototype
        .hasOwnProperty.call(
          raw,
          "value"
        )
    ) {
      return raw.value;
    }

    return raw;
  }

  async searchOpenReview(title) {
    const query =
      this.normalizeWhitespace(title)
        .replace(
          /\s*\.\s*$/u,
          ""
        )
        .slice(0, 500);

    if (!query) return [];

    const limit =
      Math.min(
        25,
        Math.max(
          8,
          Number(
            this.plugin.settings
              .searchRows
          ) || 8
        )
      );

    const target =
      this.normalizeTitleForMatch(
        query
      );

    const fetchPublicExact =
      async (baseUrl) => {
        const params =
          new URLSearchParams({
            "content.title":
              query,
            limit:
              String(limit),
          });

        const json =
          await this.getJsonStrict(
            `${baseUrl}/notes?${params}`
          );

        const notes =
          Array.isArray(
            json?.notes
          )
            ? json.notes
            : [];

        return notes.filter(
          (note) => {
            // Keep submission/forum notes; discard reviews/comments.
            if (
              note?.replyto
            ) {
              return false;
            }

            const noteTitle =
              this.openReviewContentValue(
                note?.content || {},
                "title"
              );

            return (
              this.normalizeTitleForMatch(
                noteTitle
              )
              === target
            );
          }
        );
      };

    const collected =
      new Map();

    // API v2 exact public note lookup. Unlike /notes/search,
    // /notes does not require the search access token for
    // public notes.
    try {
      const notes =
        await fetchPublicExact(
          "https://api2.openreview.net"
        );

      for (const note of notes) {
        collected.set(
          note.id
          || note.forum
          || JSON.stringify(
            note.content?.title
          ),
          note
        );
      }
    }
    catch (error) {
      console.debug(
        "Research Library: OpenReview API v2 exact lookup failed",
        error
      );
    }

    // Older conferences can still live on API v1. Query it too
    // if v2 did not return the exact public record.
    if (!collected.size) {
      try {
        const notes =
          await fetchPublicExact(
            "https://api.openreview.net"
          );

        for (const note of notes) {
          collected.set(
            note.id
            || note.forum
            || JSON.stringify(
              note.content?.title
            ),
            note
          );
        }
      }
      catch (error) {
        console.debug(
          "Research Library: OpenReview API v1 exact lookup failed",
          error
        );
      }
    }

    return [
      ...collected.values(),
    ]
      .map(
        (note) =>
          this.openReviewToMeta(
            note
          )
      )
      .filter(
        (meta) =>
          Boolean(meta?.title)
      );
  }

  openReviewToMeta(note) {
    const content =
      note?.content || {};

    const title =
      this.cleanText(
        this.openReviewContentValue(
          content,
          "title"
        )
        || ""
      );

    const rawAuthors =
      this.openReviewContentValue(
        content,
        "authors"
      );

    const authors =
      (
        Array.isArray(rawAuthors)
          ? rawAuthors
          : rawAuthors
            ? [rawAuthors]
            : []
      )
        .map(
          (author) =>
            this.cleanText(
              typeof author === "string"
                ? author
                : author?.name
                  || author?.value
                  || ""
            )
        )
        .filter(Boolean);

    const rawVenue =
      this.openReviewContentValue(
        content,
        "venue"
      )
      ||
      this.openReviewContentValue(
        content,
        "venueid"
      )
      ||
      note?.domain
      ||
      "";

    const venue =
      this.cleanText(
        String(rawVenue)
          .replace(
            /\.cc\//g,
            " "
          )
          .replace(
            /\/Conference.*$/i,
            ""
          )
          .replace(
            /\/-/g,
            " "
          )
      );

    const explicitYear =
      this.openReviewContentValue(
        content,
        "year"
      );

    const yearMatch =
      String(
        explicitYear
        || rawVenue
        || note?.domain
        || ""
      ).match(
        /\b(19|20)\d{2}\b/
      );

    const doi =
      this.normalizeDoi(
        this.openReviewContentValue(
          content,
          "doi"
        )
        || ""
      );

    const arxiv =
      String(
        this.openReviewContentValue(
          content,
          "arxiv"
        )
        ||
        this.openReviewContentValue(
          content,
          "arxiv_id"
        )
        || ""
      )
        .replace(
          /^arxiv:\s*/i,
          ""
        )
        .replace(
          /^https?:\/\/arxiv\.org\/abs\//i,
          ""
        )
        .replace(
          /v\d+$/i,
          ""
        )
        .trim();

    const forumId =
      note?.forum
      || note?.id
      || "";

    return {
      title,
      authors,
      firstAuthorFamily:
        this.familyFromName(
          authors[0]
        )
        || "unknown",
      year:
        explicitYear
        || (
          yearMatch
            ? yearMatch[0]
            : ""
        ),
      venue,
      publisher: "",
      workType:
        "conference-paper",
      volume: "",
      issue: "",
      pages: "",
      doi,
      arxiv,
      url:
        forumId
          ? `https://openreview.net/forum?id=${encodeURIComponent(
              forumId
            )}`
          : "",
      keywords:
        (
          Array.isArray(
            this.openReviewContentValue(
              content,
              "keywords"
            )
          )
            ? this.openReviewContentValue(
                content,
                "keywords"
              )
            : []
        )
          .map(
            (keyword) =>
              this.cleanText(
                keyword
              )
          )
          .filter(Boolean),
      citationCount: 0,
      openReviewId:
        note?.id || "",
      metadataSource:
        "openreview",
      _sources:
        ["openreview"],
    };
  }

  pmlrVenueAliases(
    signals = {}
  ) {
    const hint =
      [
        signals?.citationRescue
          ?.venue,
        signals?.llmRescue
          ?.venue,
        signals?.sourceFilename,
      ]
        .filter(Boolean)
        .join(" ");

    const normalized =
      this.normalizeTitleForMatch(
        hint
      );

    const aliases = [];

    const add =
      (...values) => {
        for (const value of values) {
          const clean =
            this.normalizeTitleForMatch(
              value
            );

          if (
            clean
            && !aliases.includes(clean)
          ) {
            aliases.push(clean);
          }
        }
      };

    const rules = [
      [
        /\bicml\b/,
        [
          "ICML",
          "International Conference on Machine Learning",
        ],
      ],
      [
        /\bmidl\b/,
        [
          "MIDL",
          "Medical Imaging with Deep Learning",
        ],
      ],
      [
        /\baistats\b/,
        [
          "AISTATS",
          "Artificial Intelligence and Statistics",
        ],
      ],
      [
        /\bcolt\b/,
        [
          "COLT",
          "Conference on Learning Theory",
        ],
      ],
      [
        /\buai\b/,
        [
          "UAI",
          "Uncertainty in Artificial Intelligence",
        ],
      ],
      [
        /\bcorl\b/,
        [
          "CoRL",
          "Conference on Robot Learning",
        ],
      ],
      [
        /\bacml\b/,
        [
          "ACML",
          "Asian Conference on Machine Learning",
        ],
      ],
      [
        /\bchil\b/,
        [
          "CHIL",
          "Conference on Health Inference and Learning",
        ],
      ],
      [
        /\balt\b/,
        [
          "ALT",
          "Algorithmic Learning Theory",
        ],
      ],
      [
        /\bmlhc\b/,
        [
          "MLHC",
          "Machine Learning for Healthcare",
        ],
      ],
    ];

    for (
      const [
        pattern,
        values,
      ]
      of rules
    ) {
      if (
        pattern.test(
          normalized
        )
      ) {
        add(...values);
      }
    }

    // Also preserve a long-form venue hint if LLM/citation gave one.
    const explicitVenue =
      signals?.citationRescue
        ?.venue
      || signals?.llmRescue
        ?.venue
      || "";

    if (
      String(explicitVenue)
        .trim()
        .length >= 4
    ) {
      add(explicitVenue);
    }

    return aliases;
  }

  pmlrYearHint(
    signals = {}
  ) {
    const explicit =
      Number(
        signals?.citationRescue
          ?.year
        || signals?.llmRescue
          ?.year
        || 0
      );

    if (
      explicit >= 1900
      && explicit <= 2100
    ) {
      return explicit;
    }

    const filenameYear =
      String(
        signals?.sourceFilename
        || ""
      ).match(
        /\b(19|20)\d{2}\b/
      )?.[0];

    if (filenameYear) {
      return Number(
        filenameYear
      );
    }

    return Number(
      this.yearFromPdfDate(
        signals?.creationDate
      )
      || 0
    );
  }

  parseHtmlDocument(html) {
    const parser =
      new DOMParser();

    return parser.parseFromString(
      String(html || ""),
      "text/html"
    );
  }

  async searchPmlrExact(
    title,
    signals = {}
  ) {
    const query =
      this.normalizeWhitespace(
        title
      )
        .replace(
          /\s*\.\s*$/u,
          ""
        );

    const target =
      this.normalizeTitleForMatch(
        query
      );

    if (!target) return [];

    const aliases =
      this.pmlrVenueAliases(
        signals
      );

    const year =
      this.pmlrYearHint(
        signals
      );

    // PMLR has no general public search API. Its proceedings
    // homepage is a compact volume index, so cache it and locate
    // only the most likely conference volumes before doing an
    // exact title comparison on those volume pages.
    const homeHtml =
      await this.getTextStrict(
        "https://proceedings.mlr.press/",
        {},
        {
          cacheTtlMs:
            12 * 60 * 60 * 1000,
        }
      );

    const home =
      this.parseHtmlDocument(
        homeHtml
      );

    const volumes = [];

    for (
      const anchor
      of home.querySelectorAll(
        'a[href*="/v"], a[href^="v"]'
      )
    ) {
      const href =
        anchor.getAttribute(
          "href"
        )
        || "";

      const volumeMatch =
        href.match(
          /(?:^|\/)v(\d+)\/?$/i
        );

      if (!volumeMatch) {
        continue;
      }

      const volume =
        volumeMatch[1];

      const context =
        this.cleanText(
          anchor.parentElement
            ?.textContent
          || anchor.textContent
          || ""
        );

      const normalizedContext =
        this.normalizeTitleForMatch(
          context
        );

      let score = 0;

      if (
        year
        && normalizedContext.includes(
          String(year)
        )
      ) {
        score += 4;
      }

      for (
        const alias
        of aliases
      ) {
        if (
          alias
          && normalizedContext.includes(
            alias
          )
        ) {
          score += 7;
        }
      }

      if (score > 0) {
        volumes.push({
          volume,
          score,
          context,
          url:
            `https://proceedings.mlr.press/v${volume}/`,
        });
      }
    }

    const candidates =
      volumes
        .sort(
          (a, b) =>
            b.score - a.score
        )
        .slice(
          0,
          8
        );

    if (!candidates.length) {
      return [];
    }

    for (
      const volume
      of candidates
    ) {
      const volumeHtml =
        await this.getTextStrict(
          volume.url,
          {},
          {
            cacheTtlMs:
              12 * 60 * 60 * 1000,
          }
        );

      const volumeDoc =
        this.parseHtmlDocument(
          volumeHtml
        );

      for (
        const anchor
        of volumeDoc.querySelectorAll(
          'a[href$=".html"]'
        )
      ) {
        const candidateTitle =
          this.cleanText(
            anchor.textContent
            || ""
          );

        if (
          this.normalizeTitleForMatch(
            candidateTitle
          )
          !== target
        ) {
          continue;
        }

        const paperUrl =
          new URL(
            anchor.getAttribute(
              "href"
            ),
            volume.url
          ).href;

        const meta =
          await this.fetchPmlrPaperMeta(
            paperUrl,
            {
              fallbackTitle:
                candidateTitle,
              volume:
                volume.volume,
              volumeContext:
                volume.context,
            }
          );

        return meta
          ? [meta]
          : [];
      }
    }

    return [];
  }

  async fetchPmlrPaperMeta(
    paperUrl,
    {
      fallbackTitle = "",
      volume = "",
      volumeContext = "",
    } = {}
  ) {
    const html =
      await this.getTextStrict(
        paperUrl,
        {},
        {
          cacheTtlMs:
            24 * 60 * 60 * 1000,
        }
      );

    const doc =
      this.parseHtmlDocument(
        html
      );

    const metaValue =
      (name) =>
        doc.querySelector(
          `meta[name="${name}"]`
        )
          ?.getAttribute(
            "content"
          )
        || "";

    const authors =
      [
        ...doc.querySelectorAll(
          'meta[name="citation_author"]'
        ),
      ]
        .map(
          (el) =>
            this.cleanText(
              el.getAttribute(
                "content"
              )
              || ""
            )
        )
        .filter(Boolean);

    const title =
      this.cleanText(
        metaValue(
          "citation_title"
        )
        || fallbackTitle
      );

    const date =
      metaValue(
        "citation_publication_date"
      )
      || metaValue(
        "citation_date"
      );

    const year =
      String(date)
        .match(
          /\b(19|20)\d{2}\b/
        )?.[0]
      ||
      String(volumeContext)
        .match(
          /\b(19|20)\d{2}\b/
        )?.[0]
      || "";

    const firstPage =
      metaValue(
        "citation_firstpage"
      );

    const lastPage =
      metaValue(
        "citation_lastpage"
      );

    const venue =
      this.cleanText(
        metaValue(
          "citation_conference_title"
        )
        || metaValue(
          "citation_journal_title"
        )
        || volumeContext
      );

    return {
      title,
      authors,
      firstAuthorFamily:
        this.familyFromName(
          authors[0]
        )
        || "unknown",
      year,
      venue,
      publisher:
        "PMLR",
      workType:
        "conference-paper",
      volume:
        String(
          volume || ""
        ),
      issue: "",
      pages:
        firstPage
          ? lastPage
            ? `${firstPage}-${lastPage}`
            : firstPage
          : "",
      doi:
        this.normalizeDoi(
          metaValue(
            "citation_doi"
          )
          || ""
        ),
      arxiv: "",
      url:
        paperUrl,
      pdf:
        metaValue(
          "citation_pdf_url"
        ),
      keywords: [],
      citationCount: 0,
      metadataSource:
        "pmlr",
      _sources:
        ["pmlr"],
    };
  }

  async searchDblp(title) {
    const query =
      this.normalizeWhitespace(title)
        .slice(0, 500);

    if (!query) return [];

    const limit =
      Math.min(
        30,
        Math.max(
          10,
          Number(
            this.plugin.settings
              .searchRows
          ) || 8
        )
      );

    const params =
      new URLSearchParams({
        q: query,
        format: "json",
        h: String(limit),
        c: "0",
      });

    const json =
      await this.getJsonStrict(
        `https://dblp.org/search/publ/api?${params}`
      );

    const rawHits =
      json?.result
        ?.hits
        ?.hit;

    const hits =
      Array.isArray(rawHits)
        ? rawHits
        : rawHits
          ? [rawHits]
          : [];

    return hits
      .map(
        (hit) =>
          this.dblpToMeta(
            hit
          )
      )
      .filter(
        (meta) =>
          Boolean(meta?.title)
      );
  }

  dblpToMeta(hit) {
    const info =
      hit?.info || {};

    const rawAuthors =
      info?.authors
        ?.author;

    const authorItems =
      Array.isArray(rawAuthors)
        ? rawAuthors
        : rawAuthors
          ? [rawAuthors]
          : [];

    const authors =
      authorItems
        .map(
          (author) =>
            this.cleanText(
              typeof author
                === "string"
                ? author
                : author?.text
                  || author?.name
                  || ""
            )
        )
        .filter(Boolean);

    const title =
      this.cleanText(
        String(
          info.title || ""
        )
          .replace(
            /<[^>]+>/g,
            " "
          )
          .replace(
            /\.$/,
            ""
          )
      );

    const doi =
      this.normalizeDoi(
        info.doi || ""
      );

    const rawEe =
      info.ee;

    const eeItems =
      Array.isArray(rawEe)
        ? rawEe
        : rawEe
          ? [rawEe]
          : [];

    const ee =
      eeItems
        .map(
          (value) =>
            typeof value === "string"
              ? value
              : value?.text
                || value?.url
                || ""
        )
        .find(Boolean)
      || "";

    const key =
      String(
        info.key || ""
      ).trim();

    return {
      title,
      authors,
      firstAuthorFamily:
        this.familyFromName(
          authors[0]
        )
        || "unknown",
      year:
        info.year || "",
      venue:
        this.cleanText(
          info.venue || ""
        ),
      publisher: "",
      workType:
        this.cleanText(
          info.type || ""
        )
        || "conference-paper",
      volume:
        info.volume || "",
      issue:
        info.number || "",
      pages:
        info.pages || "",
      doi,
      arxiv: "",
      url:
        ee
        || (
          key
            ? `https://dblp.org/rec/${key}`
            : ""
        ),
      keywords: [],
      citationCount: 0,
      dblpKey:
        key,
      metadataSource:
        "dblp",
      _sources:
        ["dblp"],
    };
  }

  async searchMetadataSources(
    title,
    signals = {}
  ) {
    const queryTitle =
      this.cleanText(title);

    if (!queryTitle) {
      this.lastMetadataDiagnostics =
        [];
      return [];
    }

    const limit =
      Math.max(
        3,
        Number(
          this.plugin.settings
            .searchRows
        ) || 8
      );

    const diagnostics =
      [
        {
          source:
            "semantic-scholar",
          label:
            "Semantic Scholar",
          status:
            "skipped",
          count: 0,
          ms: 0,
          error: "",
        },
        {
          source:
            "openreview",
          label:
            "OpenReview",
          status:
            "skipped",
          count: 0,
          ms: 0,
          error: "",
        },
        {
          source:
            "dblp",
          label:
            "DBLP",
          status:
            "skipped",
          count: 0,
          ms: 0,
          error: "",
        },
        {
          source:
            "pmlr",
          label:
            "PMLR",
          status:
            "skipped",
          count: 0,
          ms: 0,
          error: "",
        },
        {
          source:
            "openalex",
          label:
            "OpenAlex",
          status:
            "skipped",
          count: 0,
          ms: 0,
          error: "",
        },
        {
          source:
            "crossref",
          label:
            "Crossref",
          status:
            "skipped",
          count: 0,
          ms: 0,
          error: "",
        },
      ];

    const diagnosticFor =
      (source) =>
        diagnostics.find(
          (item) =>
            item.source === source
        );

    const syncDiagnostics =
      () => {
        this.lastMetadataDiagnostics =
          diagnostics.map(
            (item) => ({
              ...item,
            })
          );
      };

    const runSource =
      async (
        source,
        search
      ) => {
        const diagnostic =
          diagnosticFor(source);

        if (!diagnostic) {
          return [];
        }

        diagnostic.status =
          "running";
        diagnostic.error = "";
        syncDiagnostics();

        const started =
          Date.now();

        try {
          const results =
            await this.withTimeout(
              search(),
              32000,
              diagnostic.label
            );

          diagnostic.status =
            "ok";
          diagnostic.count =
            Array.isArray(results)
              ? results.length
              : 0;
          diagnostic.ms =
            Date.now() - started;

          syncDiagnostics();

          return Array.isArray(
            results
          )
            ? results
            : [];
        }
        catch (error) {
          diagnostic.status =
            "error";
          diagnostic.count = 0;
          diagnostic.ms =
            Date.now() - started;
          diagnostic.error =
            error?.code === "RL_TIMEOUT"
              ? "Timeout 32s"
              : this.metadataSearchErrorText(
                  error
                );

          console.debug(
            `Research Library: ${diagnostic.label} search failed`,
            error
          );

          syncDiagnostics();

          return [];
        }
      };

    const rank =
      (candidates) =>
        this.mergeMetadataCandidates(
          candidates
        )
          .map(
            (meta) =>
              this.scoreMetadataCandidate(
                meta,
                signals,
                queryTitle
              )
          )
          .filter(
            (meta) =>
              meta._titleSimilarity >= 0.30
              || meta._identifierExact
          )
          .sort(
            (a, b) =>
              b._matchScore
                - a._matchScore
              ||
              Number(
                b.citationCount || 0
              )
                - Number(
                  a.citationCount || 0
                )
          );

    const finish =
      (ranked) => {
        syncDiagnostics();

        return ranked.slice(
          0,
          limit
        );
      };

    syncDiagnostics();

    // --------------------------------------------------------
    // Stage 1 — Semantic Scholar first.
    // Good broad coverage and fast exact-title recovery.
    // --------------------------------------------------------
    this.setImportBusy(
      "正在通过 Semantic Scholar 检索…"
    );

    const semanticCandidates =
      await runSource(
        "semantic-scholar",
        () =>
          this.searchSemanticScholar(
            queryTitle
          )
      );

    let ranked =
      rank(
        semanticCandidates
      );

    let best =
      ranked[0];

    if (
      best
      && (
        best._identifierExact
        || best._exactTitle
        || Number(
          best._matchPercent
        ) >= 95
      )
    ) {
      this.setImportBusy(
        `Semantic Scholar 高置信匹配：${best._matchPercent}%`
      );

      return finish(ranked);
    }

    // --------------------------------------------------------
    // Stage 2 — CS conference sources.
    // OpenReview + DBLP are queried before generic DOI-heavy
    // aggregators, which is important for ICLR/NeurIPS/ICML/etc.
    // --------------------------------------------------------
    this.setImportBusy(
      best
        ? `Semantic Scholar 匹配度 ${best._matchPercent}%，正在补充 OpenReview + DBLP + PMLR…`
        : "Semantic Scholar 未找到可靠结果，正在检索 OpenReview + DBLP + PMLR…"
    );

    const [
      openReviewCandidates,
      dblpCandidates,
      pmlrCandidates,
    ] =
      await Promise.all([
        runSource(
          "openreview",
          () =>
            this.searchOpenReview(
              queryTitle
            )
        ),
        runSource(
          "dblp",
          () =>
            this.searchDblp(
              queryTitle
            )
        ),
        runSource(
          "pmlr",
          () =>
            this.searchPmlrExact(
              queryTitle,
              signals
            )
        ),
      ]);

    ranked =
      rank([
        ...semanticCandidates,
        ...openReviewCandidates,
        ...dblpCandidates,
        ...pmlrCandidates,
      ]);

    best =
      ranked[0];

    if (
      best
      && (
        best._identifierExact
        || best._exactTitle
        || Number(
          best._matchPercent
        ) >= 92
      )
    ) {
      this.setImportBusy(
        `计算机会议来源复核完成：${best._matchPercent}%`
      );

      return finish(ranked);
    }

    // --------------------------------------------------------
    // Stage 3 — Generic scholarly fallback.
    // OpenAlex now uses broad search; local scoring decides exactness.
    // --------------------------------------------------------
    this.setImportBusy(
      best
        ? `会议来源后最佳匹配 ${best._matchPercent}%，正在补充 OpenAlex + Crossref…`
        : "会议来源仍无可靠结果，正在补充 OpenAlex + Crossref…"
    );

    const [
      openAlexCandidates,
      crossrefCandidates,
    ] =
      await Promise.all([
        runSource(
          "openalex",
          () =>
            this.searchOpenAlex(
              queryTitle
            )
        ),
        runSource(
          "crossref",
          () =>
            this.searchCrossref(
              queryTitle
            )
        ),
      ]);

    ranked =
      rank([
        ...semanticCandidates,
        ...openReviewCandidates,
        ...dblpCandidates,
        ...pmlrCandidates,
        ...openAlexCandidates,
        ...crossrefCandidates,
      ]);

    best =
      ranked[0];

    if (best) {
      this.setImportBusy(
        `CS-first 多源检索完成：最佳匹配 ${best._matchPercent}%`
      );
    }

    return finish(ranked);
  }

  metadataSearchErrorText(
    error
  ) {
    const raw =
      String(
        error?.message
        || error
        || "Request failed"
      );

    const status =
      raw.match(
        /\b(4\d{2}|5\d{2})\b/
      )?.[1];

    if (status) {
      return `HTTP ${status}`;
    }

    return raw
      .replace(
        /^Error:\s*/i,
        ""
      )
      .slice(
        0,
        90
      );
  }

  mergeMetadataCandidates(
    candidates
  ) {
    const byKey =
      new Map();

    for (const raw of candidates) {
      if (!raw?.title) continue;

      const meta =
        Object.assign(
          {},
          raw
        );

      const sources =
        Array.isArray(meta._sources)
          ? meta._sources
          : [
              meta.metadataSource
              || "unknown",
            ];

      meta._sources =
        [...new Set(sources)];

      const doi =
        this.normalizeDoi(
          meta.doi || ""
        );

      const arxiv =
        String(meta.arxiv || "")
          .toLowerCase()
          .replace(/v\d+$/i, "");

      const titleKey =
        this.normalizeTitleForMatch(
          meta.title
        );

      const key =
        doi
          ? `doi:${doi}`
          : arxiv
            ? `arxiv:${arxiv}`
            : `title:${titleKey}:${
                meta.year || ""
              }`;

      if (!byKey.has(key)) {
        byKey.set(
          key,
          meta
        );
        continue;
      }

      const current =
        byKey.get(key);

      byKey.set(
        key,
        this.mergeMetadataRecord(
          current,
          meta
        )
      );
    }

    // Second pass: merge identical normalized title/year results
    // even if one source has a DOI and another does not.
    const byTitle =
      new Map();

    for (
      const meta
      of byKey.values()
    ) {
      const titleKey =
        this.normalizeTitleForMatch(
          meta.title
        );

      const key =
        `${titleKey}:${meta.year || ""}`;

      if (
        titleKey
        && byTitle.has(key)
      ) {
        byTitle.set(
          key,
          this.mergeMetadataRecord(
            byTitle.get(key),
            meta
          )
        );
      }
      else {
        byTitle.set(
          key,
          meta
        );
      }
    }

    return [
      ...byTitle.values(),
    ];
  }

  mergeMetadataRecord(
    first,
    second
  ) {
    const result =
      Object.assign(
        {},
        first
      );

    const fields = [
      "title",
      "year",
      "venue",
      "publisher",
      "workType",
      "volume",
      "issue",
      "pages",
      "doi",
      "arxiv",
      "url",
      "firstAuthorFamily",
      "semanticScholarId",
      "openAlexId",
    ];

    for (const field of fields) {
      if (
        !result[field]
        && second[field]
      ) {
        result[field] =
          second[field];
      }
    }

    if (
      (!result.authors?.length)
      || (
        second.authors?.length
        > result.authors.length
      )
    ) {
      result.authors =
        second.authors
        || result.authors
        || [];
    }

    result.keywords =
      [
        ...new Set([
          ...(result.keywords || []),
          ...(second.keywords || []),
        ]),
      ];

    result.citationCount =
      Math.max(
        Number(
          result.citationCount || 0
        ),
        Number(
          second.citationCount || 0
        )
      );

    result._sources =
      [
        ...new Set([
          ...(result._sources || [
            result.metadataSource,
          ]),
          ...(second._sources || [
            second.metadataSource,
          ]),
        ].filter(Boolean)),
      ];

    result.metadataSource =
      result._sources.join("+");

    return result;
  }

  scoreMetadataCandidate(
    meta,
    signals,
    detectedTitle
  ) {
    const candidateTitle =
      meta.title || "";

    const titleSimilarity =
      this.titleSimilarity(
        detectedTitle,
        candidateTitle
      );

    const exactTitle =
      Boolean(
        this.normalizeTitleForMatch(
          detectedTitle
        )
        &&
        this.normalizeTitleForMatch(
          detectedTitle
        )
        ===
        this.normalizeTitleForMatch(
          candidateTitle
        )
      );

    const signalDoi =
      this.normalizeDoi(
        signals?.doi || ""
      );

    const metaDoi =
      this.normalizeDoi(
        meta.doi || ""
      );

    const signalArxiv =
      String(
        signals?.arxiv || ""
      )
        .toLowerCase()
        .replace(/v\d+$/i, "");

    const metaArxiv =
      String(
        meta.arxiv || ""
      )
        .toLowerCase()
        .replace(/v\d+$/i, "");

    const doiExact =
      Boolean(
        signalDoi
        && metaDoi
        && signalDoi === metaDoi
      );

    const arxivExact =
      Boolean(
        signalArxiv
        && metaArxiv
        && signalArxiv === metaArxiv
      );

    const citationAuthors =
      Array.isArray(
        signals?.citationRescue
          ?.authors
      )
        ? signals.citationRescue
            .authors
            .join(" ")
        : "";

    const llmAuthors =
      Array.isArray(
        signals?.llmRescue
          ?.authors
      )
        ? signals.llmRescue
            .authors
            .join(" ")
        : "";

    const authorSimilarity =
      this.authorSimilarity(
        signals?.pdfAuthor
        || citationAuthors
        || llmAuthors
        || "",
        meta.authors || []
      );

    const pdfYear =
      Number(
        signals?.citationRescue
          ?.year
      )
      ||
      this.yearFromPdfDate(
        signals?.creationDate
      )
      ||
      (
        Number(
          signals?.llmRescue
            ?.year
        ) || ""
      );

    const yearMatch =
      Boolean(
        pdfYear
        && meta.year
        && Number(pdfYear)
          === Number(meta.year)
      );

    let score =
      titleSimilarity * 80
      + authorSimilarity * 20;

    if (exactTitle) {
      score += 90;
    }

    if (doiExact) {
      score += 220;
    }

    if (arxivExact) {
      score += 200;
    }

    if (yearMatch) {
      score += 6;
    }

    // Citation count is only a tiny tie-breaker.
    score +=
      Math.min(
        4,
        Math.log10(
          Number(
            meta.citationCount || 0
          ) + 1
        )
      );

    let percent;

    if (
      doiExact
      || arxivExact
    ) {
      percent = 100;
    }
    else if (exactTitle) {
      percent =
        Math.min(
          99,
          Math.round(
            95
            + authorSimilarity * 3
            + (yearMatch ? 1 : 0)
          )
        );
    }
    else {
      percent =
        Math.max(
          1,
          Math.min(
            94,
            Math.round(
              titleSimilarity * 84
              + authorSimilarity * 10
              + (yearMatch ? 3 : 0)
            )
          )
        );
    }

    let confidence =
      "low";

    if (percent >= 95) {
      confidence = "exact";
    }
    else if (percent >= 85) {
      confidence = "strong";
    }
    else if (percent >= 70) {
      confidence = "possible";
    }

    return Object.assign(
      {},
      meta,
      {
        _matchScore: score,
        _matchPercent: percent,
        _confidence: confidence,
        _titleSimilarity:
          titleSimilarity,
        _identifierExact:
          doiExact || arxivExact,
        _exactTitle:
          exactTitle,
      }
    );
  }

  normalizeTitleForMatch(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(
        /[^\p{L}\p{N}]+/gu,
        " "
      )
      .replace(/\s+/g, " ")
      .trim();
  }

  titleSimilarity(a, b) {
    const first =
      this.normalizeTitleForMatch(a);

    const second =
      this.normalizeTitleForMatch(b);

    if (!first || !second) {
      return 0;
    }

    if (first === second) {
      return 1;
    }

    const firstTokens =
      first.split(" ")
        .filter(Boolean);

    const secondTokens =
      second.split(" ")
        .filter(Boolean);

    const firstSet =
      new Set(firstTokens);

    const secondSet =
      new Set(secondTokens);

    let intersection = 0;

    for (const token of firstSet) {
      if (secondSet.has(token)) {
        intersection += 1;
      }
    }

    const dice =
      (2 * intersection)
      /
      Math.max(
        1,
        firstSet.size
          + secondSet.size
      );

    const charSimilarity =
      this.normalizedEditSimilarity(
        first,
        second
      );

    return (
      dice * 0.62
      + charSimilarity * 0.38
    );
  }

  normalizedEditSimilarity(
    first,
    second
  ) {
    const a =
      String(first || "");

    const b =
      String(second || "");

    if (a === b) return 1;

    if (!a.length || !b.length) {
      return 0;
    }

    let previous =
      Array.from(
        {
          length: b.length + 1,
        },
        (_, index) => index
      );

    for (
      let i = 1;
      i <= a.length;
      i++
    ) {
      const current =
        [i];

      for (
        let j = 1;
        j <= b.length;
        j++
      ) {
        current[j] =
          Math.min(
            current[j - 1] + 1,
            previous[j] + 1,
            previous[j - 1]
              + (
                a[i - 1]
                === b[j - 1]
                  ? 0
                  : 1
              )
          );
      }

      previous = current;
    }

    const distance =
      previous[b.length];

    return Math.max(
      0,
      1
      - distance
        / Math.max(
          a.length,
          b.length
        )
    );
  }

  authorSimilarity(
    pdfAuthor,
    candidateAuthors
  ) {
    const source =
      this.normalizeTitleForMatch(
        pdfAuthor
      );

    if (!source) return 0;

    const sourceTokens =
      new Set(
        source
          .split(" ")
          .filter(
            (token) =>
              token.length >= 2
          )
      );

    const candidate =
      this.normalizeTitleForMatch(
        (candidateAuthors || [])
          .join(" ")
      );

    const candidateTokens =
      new Set(
        candidate
          .split(" ")
          .filter(
            (token) =>
              token.length >= 2
          )
      );

    if (
      !sourceTokens.size
      || !candidateTokens.size
    ) {
      return 0;
    }

    let overlap = 0;

    for (
      const token
      of sourceTokens
    ) {
      if (
        candidateTokens.has(token)
      ) {
        overlap += 1;
      }
    }

    return Math.min(
      1,
      overlap
      /
      Math.max(
        1,
        Math.min(
          sourceTokens.size,
          candidateTokens.size
        )
      )
    );
  }

  semanticScholarToMeta(paper) {
    const authors =
      (paper.authors || [])
        .map(
          (author) =>
            this.cleanText(
              author?.name || ""
            )
        )
        .filter(Boolean);

    const external =
      paper.externalIds
      || {};

    const doi =
      this.normalizeDoi(
        external.DOI || ""
      );

    const arxiv =
      String(
        external.ArXiv || ""
      ).trim();

    return {
      title:
        this.cleanText(
          paper.title
          || "Untitled"
        ),
      authors,
      firstAuthorFamily:
        this.familyFromName(
          authors[0]
        )
        || "unknown",
      year:
        paper.year || "",
      venue:
        this.cleanText(
          paper.venue || ""
        ),
      publisher: "",
      workType:
        Array.isArray(
          paper.publicationTypes
        )
          ? paper.publicationTypes[0]
            || ""
          : "",
      volume: "",
      issue: "",
      pages: "",
      doi,
      arxiv,
      url:
        paper.url
        ||
        (
          doi
            ? `https://doi.org/${doi}`
            : arxiv
              ? `https://arxiv.org/abs/${arxiv}`
              : ""
        ),
      keywords: [],
      citationCount:
        Number(
          paper.citationCount || 0
        ),
      semanticScholarId:
        paper.paperId || "",
      metadataSource:
        "semantic-scholar",
      _sources:
        ["semantic-scholar"],
    };
  }

  openAlexToMeta(work) {
    const authors =
      (work.authorships || [])
        .map(
          (authorship) =>
            this.cleanText(
              authorship
                ?.author
                ?.display_name
              || ""
            )
        )
        .filter(Boolean);

    const doi =
      this.normalizeDoi(
        work.doi
        || work.ids?.doi
        || ""
      );

    const source =
      work.primary_location
        ?.source
        ?.display_name
      ||
      work.locations
        ?.find(
          (location) =>
            location?.source
              ?.display_name
        )
        ?.source
        ?.display_name
      ||
      "";

    const biblio =
      work.biblio || {};

    const keywords =
      (work.keywords || [])
        .map(
          (keyword) =>
            this.cleanText(
              keyword
                ?.display_name
              || ""
            )
        )
        .filter(Boolean);

    const arxiv =
      String(
        work.ids?.arxiv
        || ""
      )
        .replace(
          /^https?:\/\/arxiv\.org\/abs\//i,
          ""
        )
        .trim();

    return {
      title:
        this.cleanText(
          work.title
          || work.display_name
          || "Untitled"
        ),
      authors,
      firstAuthorFamily:
        this.familyFromName(
          authors[0]
        )
        || "unknown",
      year:
        work.publication_year
        || "",
      venue:
        this.cleanText(source),
      publisher: "",
      workType:
        work.type || "",
      volume:
        biblio.volume || "",
      issue:
        biblio.issue || "",
      pages:
        (
          biblio.first_page
          && biblio.last_page
        )
          ? `${biblio.first_page}-${biblio.last_page}`
          : biblio.first_page
            || "",
      doi,
      arxiv,
      url:
        work.primary_location
          ?.landing_page_url
        ||
        (
          doi
            ? `https://doi.org/${doi}`
            : work.id || ""
        ),
      keywords,
      citationCount:
        Number(
          work.cited_by_count || 0
        ),
      openAlexId:
        work.id || "",
      metadataSource:
        "openalex",
      _sources:
        ["openalex"],
    };
  }

  async getJson(
    url,
    extraHeaders = {}
  ) {
    return this.requestJsonWithTimeout(
      url,
      extraHeaders,
      {
        timeoutMs: 12000,
        strict: false,
        cacheTtlMs:
          60 * 60 * 1000,
        maxRetries: 2,
      }
    );
  }

  async getJsonStrict(
    url,
    extraHeaders = {}
  ) {
    try {
      return await this.requestJsonWithTimeout(
        url,
        extraHeaders,
        {
          timeoutMs: 12000,
          strict: true,
          cacheTtlMs:
            60 * 60 * 1000,
          maxRetries: 2,
        }
      );
    }
    catch (error) {
      const message =
        String(
          error?.message
          || error
          || "Request failed"
        );

      if (
        error?.code === "RL_TIMEOUT"
        || /timeout/i.test(
          message
        )
      ) {
        const timeoutError =
          new Error(
            "Timeout 12s"
          );

        timeoutError.code =
          "RL_TIMEOUT";

        throw timeoutError;
      }

      throw new Error(message);
    }
  }

  async getTextStrict(
    url,
    extraHeaders = {},
    {
      cacheTtlMs =
        6 * 60 * 60 * 1000,
    } = {}
  ) {
    return this.requestTextWithTimeout(
      url,
      extraHeaders,
      {
        timeoutMs: 12000,
        strict: true,
        cacheTtlMs,
        maxRetries: 2,
      }
    );
  }

  crossrefToMeta(message) {
    const people =
      (message.author || [])
        .map((author) => ({
          name:
            [
              author.given,
              author.family,
            ]
              .filter(Boolean)
              .join(" ")
            ||
            author.name
            ||
            "Unknown",
          family:
            author.family
            ||
            author.name
            ||
            "unknown",
        }));

    const doi =
      this.normalizeDoi(
        message.DOI || ""
      );

    return {
      title:
        this.cleanText(
          message
            .title
            ?.[0]
          || "Untitled"
        ),
      authors:
        people
          .map(
            (person) =>
              person.name
          ),
      firstAuthorFamily:
        people[0]
          ?.family
        || "unknown",
      year:
        this.crossrefYear(
          message
        ),
      venue:
        this.cleanText(
          message[
            "container-title"
          ]?.[0]
          ||
          message.event
            ?.name
          ||
          ""
        ),
      publisher:
        this.cleanText(
          message.publisher
          || ""
        ),
      workType:
        message.type || "",
      volume:
        message.volume || "",
      issue:
        message.issue || "",
      pages:
        message.page
        ||
        message[
          "article-number"
        ]
        ||
        "",
      doi,
      arxiv:
        this.arxivFromDoi(doi),
      url:
        message.URL
        ||
        (
          doi
            ? `https://doi.org/${doi}`
            : ""
        ),
      keywords:
        Array.isArray(
          message.subject
        )
          ? message.subject
              .map(
                (subject) =>
                  this.cleanText(
                    subject
                  )
              )
              .filter(Boolean)
          : [],
      citationCount:
        Number(
          message[
            "is-referenced-by-count"
          ] || 0
        ),
      metadataSource:
        "crossref",
      _sources:
        ["crossref"],
    };
  }

  dataciteToMeta(
    attributes,
    doi
  ) {
    const people =
      (
        attributes.creators
        || []
      )
        .map((creator) => ({
          name:
            [
              creator.givenName,
              creator.familyName,
            ]
              .filter(Boolean)
              .join(" ")
            ||
            creator.name
            ||
            "Unknown",
          family:
            creator.familyName
            ||
            this.familyFromName(
              creator.name
            )
            ||
            "unknown",
        }));

    const publisher =
      typeof attributes.publisher
        === "string"
        ? attributes.publisher
        : attributes.publisher
            ?.name
          || "";

    return {
      title:
        this.cleanText(
          attributes
            .titles
            ?.[0]
            ?.title
          || "Untitled"
        ),
      authors:
        people
          .map(
            (person) =>
              person.name
          ),
      firstAuthorFamily:
        people[0]
          ?.family
        || "unknown",
      year:
        attributes
          .publicationYear
        ||
        this.yearFromDate(
          attributes.published
        )
        ||
        "",
      venue:
        this.cleanText(
          attributes.container
            ?.title
          || ""
        ),
      publisher:
        this.cleanText(
          publisher
        ),
      workType:
        attributes.types
          ?.bibtex
        ||
        attributes.types
          ?.resourceTypeGeneral
        ||
        "",
      volume:
        attributes.container
          ?.volume
        || "",
      issue:
        attributes.container
          ?.issue
        || "",
      pages:
        attributes.container
          ?.firstPage
          ? [
              attributes
                .container
                .firstPage,
              attributes
                .container
                .lastPage,
            ]
              .filter(Boolean)
              .join("-")
          : "",
      doi,
      arxiv:
        this.arxivFromDoi(doi),
      url:
        attributes.url
        ||
        (
          doi
            ? `https://doi.org/${doi}`
            : ""
        ),
      keywords:
        (
          attributes.subjects
          || []
        )
          .map((subject) =>
            this.cleanText(
              typeof subject
                === "string"
                ? subject
                : subject.subject
            )
          )
          .filter(Boolean),
      citationCount: 0,
      metadataSource:
        "datacite",
      _sources:
        ["datacite"],
    };
  }

  buildSearchQuery(
    signals,
    basename
  ) {
    const parts =
      [
        signals.title
        ||
        this.cleanCandidateTitle(
          basename
        ),
      ];

    if (
      signals.pdfAuthor
      && signals.pdfAuthor.length < 180
    ) {
      parts.push(
        signals.pdfAuthor
      );
    }

    return this
      .normalizeWhitespace(
        parts
          .filter(Boolean)
          .join(" ")
      )
      .slice(0, 450);
  }

  makePdfOnlyMeta(
    signals,
    title
  ) {
    const authors =
      signals.pdfAuthor
        ? signals.pdfAuthor
            .split(
              /\s*(?:;|\band\b|&)\s*/i
            )
            .map(
              (value) =>
                value.trim()
            )
            .filter(Boolean)
        : [];

    return {
      title:
        this.cleanText(title),
      authors,
      firstAuthorFamily:
        this.familyFromName(
          authors[0]
        )
        || "unknown",
      year:
        this.yearFromPdfDate(
          signals.creationDate
        ),
      venue: "",
      publisher: "",
      workType: "paper",
      volume: "",
      issue: "",
      pages: "",
      doi:
        signals.doi || "",
      arxiv:
        signals.arxiv || "",
      url:
        signals.doi
          ? `https://doi.org/${signals.doi}`
          : "",
      keywords:
        signals.keywords
        || [],
      metadataSource:
        "pdf",
      _sources:
        ["pdf"],
      _matchPercent: 0,
      _confidence:
        "unverified",
    };
  }

  isArxivDoi(value) {
    return /^10\.48550\/arxiv\./i.test(
      this.normalizeDoi(
        value || ""
      )
    );
  }

  arxivIdFromMeta(meta) {
    const direct =
      String(
        meta?.arxiv || ""
      )
        .trim()
        .replace(/^arxiv:\s*/i, "")
        .replace(/v\d+$/i, "");

    if (direct) {
      return direct;
    }

    const doi =
      this.normalizeDoi(
        meta?.doi || ""
      );

    const match =
      doi.match(
        /^10\.48550\/arxiv\.(.+)$/i
      );

    return match?.[1]
      ? match[1]
          .replace(/v\d+$/i, "")
      : "";
  }

  preprintVenue(value) {
    const venue =
      this.normalizeWhitespace(
        value || ""
      ).toLowerCase();

    if (!venue) return false;

    return /\barxiv\b|cornell university|\bpre[- ]?print\b|biorxiv|medrxiv|ssrn|research square/.test(
      venue
    );
  }

  preprintPublisher(value) {
    const publisher =
      this.normalizeWhitespace(
        value || ""
      ).toLowerCase();

    if (!publisher) {
      return false;
    }

    return /\barxiv\b|cornell university|biorxiv|medrxiv|ssrn|research square|pre[- ]?print/.test(
      publisher
    );
  }

  formalWorkType(value) {
    return /journal|article|conference|proceedings|workshop|book.?chapter|incollection|thesis|dissertation/i.test(
      String(value || "")
    );
  }

  preprintWorkType(value) {
    return /preprint|posted.?content|manuscript|working.?paper/i.test(
      String(value || "")
    );
  }

  isFormalPublicationMeta(meta) {
    if (!meta) return false;

    const sources =
      this.metadataSources(
        meta
      );

    const venue =
      this.cleanText(
        meta.venue || ""
      );

    if (
      venue
      && !this.preprintVenue(
        venue
      )
      && this.formalWorkType(
        meta.workType
      )
    ) {
      return true;
    }

    if (
      venue
      && !this.preprintVenue(
        venue
      )
      && sources.some(
        (source) =>
          [
            "dblp",
            "pmlr",
            "openreview",
          ].includes(source)
      )
    ) {
      return true;
    }

    if (
      venue
      && !this.preprintVenue(
        venue
      )
      && !this.preprintWorkType(
        meta.workType
      )
    ) {
      // A concrete non-preprint venue is itself strong evidence
      // that the record describes a formal publication, even
      // when an older import omitted work_type / volume / pages.
      return true;
    }

    return false;
  }

  isPreprintLikeMeta(meta) {
    if (!meta) return false;

    if (
      this.isFormalPublicationMeta(
        meta
      )
    ) {
      return false;
    }

    const arxiv =
      this.arxivIdFromMeta(
        meta
      );

    return Boolean(
      arxiv
      || this.isArxivDoi(
        meta.doi
      )
      || this.preprintVenue(
        meta.venue
      )
      || this.preprintWorkType(
        meta.workType
      )
    );
  }

  publicationStatus(meta) {
    if (
      this.isFormalPublicationMeta(
        meta
      )
    ) {
      return "formal";
    }

    if (
      this.isPreprintLikeMeta(
        meta
      )
    ) {
      return "preprint";
    }

    return "unknown";
  }

  publicationVenueLooksConference(
    value
  ) {
    const venue =
      this.normalizeWhitespace(
        value || ""
      ).toLowerCase();

    if (!venue) {
      return false;
    }

    return Boolean(
      /\bconference\b|\bproceedings\b|\bworkshop\b|\bcvpr\b|\biccv\b|\beccv\b|\bneurips\b|\bnips\b|\bicml\b|\biclr\b|\baistats\b|\bcolt\b|\buai\b|\bcorl\b|\bmidl\b|\baaai\b|\bijcai\b|\bacl\b|\bemnlp\b|\bnaacl\b|computer vision and pattern recognition|neural information processing systems|international conference on machine learning|learning representations/.test(
        venue
      )
    );
  }

  publicationKind(meta) {
    if (!meta) {
      return "unknown";
    }

    const work =
      String(
        meta.workType || ""
      ).toLowerCase();

    const venue =
      String(
        meta.venue || ""
      );

    const sources =
      this.metadataSources(
        meta
      );

    if (
      /book.?chapter|chapter|incollection/.test(
        work
      )
    ) {
      return "incollection";
    }

    if (
      /thesis|dissertation/.test(
        work
      )
    ) {
      return "thesis";
    }

    // Strong conference evidence wins over a noisy source label
    // such as Semantic Scholar "JournalArticle".
    if (
      sources.includes(
        "pmlr"
      )
      || (
        sources.includes(
          "dblp"
        )
        && /conference|workshop|proceedings/i.test(
          work
        )
      )
      || /conference|proceedings|workshop|paper-conference|proceedings-article|conference and workshop papers/.test(
        work
      )
      || this.publicationVenueLooksConference(
        venue
      )
    ) {
      return "conference";
    }

    if (
      /journal|article-journal|journal-article/.test(
        work
      )
    ) {
      return "journal";
    }

    if (
      this.preprintVenue(
        venue
      )
      || this.preprintWorkType(
        work
      )
    ) {
      return "preprint";
    }

    return "unknown";
  }

  needsPublicationResolution(
    meta
  ) {
    if (
      !meta
      || !meta.title
    ) {
      return false;
    }

    if (
      this.isPreprintLikeMeta(
        meta
      )
    ) {
      return true;
    }

    // Canonicalized records carry a durable YAML marker and
    // should not be searched again on every Library open.
    if (
      String(
        meta.publicationResolution
        || ""
      ).trim()
      && String(
        meta.publicationStatus
        || ""
      ).toLowerCase()
        === "formal"
    ) {
      return false;
    }

    const arxiv =
      this.arxivIdFromMeta(
        meta
      );

    if (!arxiv) {
      return false;
    }

    const doi =
      this.normalizeDoi(
        meta.doi || ""
      );

    // Mixed arXiv + formal-looking metadata can still contain
    // preprint year/type. Resolve it once before citekey/commit.
    return Boolean(
      (
        doi
        && !this.isArxivDoi(
          doi
        )
      )
      || (
        meta.venue
        && !this.preprintVenue(
          meta.venue
        )
      )
      || this.formalWorkType(
        meta.workType
      )
    );
  }

  publicationSourceWeight(meta) {
    const sources =
      this.metadataSources(
        meta
      );

    let weight = 0;

    for (const source of sources) {
      weight = Math.max(
        weight,
        source === "pmlr"
          ? 14
          : source === "dblp"
            ? 13
            : source === "openreview"
              ? 11
              : source === "crossref"
                ? 9
                : source === "openalex"
                  ? 8
                  : source === "semantic-scholar"
                    ? 7
                    : 0
      );
    }

    return weight;
  }

  publicationAuthorInformationScore(
    authors
  ) {
    const list =
      (authors || [])
        .map(
          (author) =>
            this.cleanText(
              author || ""
            )
        )
        .filter(Boolean);

    if (!list.length) {
      return 0;
    }

    let score =
      list.length * 8;

    for (const name of list) {
      const tokens =
        name
          .replace(/,/g, " ")
          .split(/\s+/)
          .filter(Boolean);

      score +=
        Math.min(
          12,
          name.length / 3
        );

      const initialTokens =
        tokens.filter(
          (token) =>
            /^[A-Z]\.?$/i.test(
              token
            )
        ).length;

      score -=
        initialTokens * 2;
    }

    return score;
  }

  publicationFieldCandidateScore(
    candidate,
    field,
    value
  ) {
    let score =
      this.publicationSourceWeight(
        candidate
      ) * 10;

    const kind =
      this.publicationKind(
        candidate
      );

    if (
      kind !== "unknown"
      && kind !== "preprint"
    ) {
      score += 8;
    }

    if (
      candidate.doi
      && !this.isArxivDoi(
        candidate.doi
      )
    ) {
      score += 4;
    }

    if (field === "venue") {
      const text =
        this.cleanText(
          value || ""
        );

      score +=
        Math.min(
          70,
          text.length
        );

      if (
        /proceedings|conference/i.test(
          text
        )
      ) {
        score += 12;
      }
    }
    else if (
      field === "authors"
    ) {
      score +=
        this.publicationAuthorInformationScore(
          value
        );
    }
    else if (
      field === "pages"
      && this.metadataSources(
        candidate
      ).some(
        (source) =>
          [
            "dblp",
            "pmlr",
          ].includes(
            source
          )
      )
    ) {
      score += 12;
    }

    return score;
  }

  bestPublicationField(
    candidates,
    field,
    {
      predicate = null,
    } = {}
  ) {
    let bestValue =
      null;

    let bestScore =
      -Infinity;

    for (
      const candidate
      of candidates || []
    ) {
      const value =
        candidate?.[field];

      const present =
        Array.isArray(value)
          ? value.length > 0
          : Boolean(
              String(
                value ?? ""
              ).trim()
            );

      if (!present) {
        continue;
      }

      if (
        predicate
        && !predicate(
          value,
          candidate
        )
      ) {
        continue;
      }

      const score =
        this.publicationFieldCandidateScore(
          candidate,
          field,
          value
        );

      if (score > bestScore) {
        bestScore =
          score;

        bestValue =
          Array.isArray(value)
            ? [...value]
            : value;
      }
    }

    return bestValue;
  }

  weightedPublicationYear(
    candidates
  ) {
    const scores =
      new Map();

    for (
      const candidate
      of candidates || []
    ) {
      const year =
        String(
          candidate?.year || ""
        ).trim();

      if (!/^\d{4}$/.test(year)) {
        continue;
      }

      let score =
        this.publicationSourceWeight(
          candidate
        ) * 10;

      const kind =
        this.publicationKind(
          candidate
        );

      if (
        kind !== "unknown"
        && kind !== "preprint"
      ) {
        score += 8;
      }

      if (
        candidate.doi
        && !this.isArxivDoi(
          candidate.doi
        )
      ) {
        score += 4;
      }

      scores.set(
        year,
        (
          scores.get(year)
          || 0
        ) + score
      );
    }

    return [
      ...scores.entries(),
    ]
      .sort(
        (a, b) =>
          b[1] - a[1]
      )[0]?.[0]
      || "";
  }

  canonicalPublicationWorkType(
    candidates
  ) {
    const votes =
      new Map();

    for (
      const candidate
      of candidates || []
    ) {
      const kind =
        this.publicationKind(
          candidate
        );

      if (
        kind === "unknown"
        || kind === "preprint"
      ) {
        continue;
      }

      const score =
        this.publicationSourceWeight(
          candidate
        ) * 10
        + 8;

      votes.set(
        kind,
        (
          votes.get(kind)
          || 0
        ) + score
      );
    }

    const kind =
      [
        ...votes.entries(),
      ]
        .sort(
          (a, b) =>
            b[1] - a[1]
        )[0]?.[0]
      || "unknown";

    return kind === "conference"
      ? "conference"
      : kind === "journal"
        ? "journal"
        : kind === "incollection"
          ? "book-chapter"
          : kind === "thesis"
            ? "thesis"
            : "";
  }

  canonicalFormalPublicationMeta(
    baseMeta,
    candidates
  ) {
    const formal =
      (candidates || [])
        .filter(
          (candidate) =>
            this.isFormalPublicationMeta(
              candidate
            )
        );

    if (!formal.length) {
      return null;
    }

    const title =
      this.bestPublicationField(
        formal,
        "title"
      )
      || baseMeta?.title
      || "";

    const authors =
      this.bestPublicationField(
        formal,
        "authors"
      )
      || baseMeta?.authors
      || [];

    const year =
      this.weightedPublicationYear(
        formal
      )
      || this.bestPublicationField(
        formal,
        "year"
      )
      || baseMeta?.year
      || "";

    const venue =
      this.bestPublicationField(
        formal,
        "venue",
        {
          predicate:
            (value) =>
              !this.preprintVenue(
                value
              ),
        }
      )
      || "";

    const doi =
      this.bestPublicationField(
        formal,
        "doi",
        {
          predicate:
            (value) =>
              !this.isArxivDoi(
                value
              ),
        }
      )
      || "";

    const arxiv =
      this.arxivIdFromMeta(
        baseMeta
      )
      || formal
        .map(
          (candidate) =>
            this.arxivIdFromMeta(
              candidate
            )
        )
        .find(Boolean)
      || "";

    const sources =
      [
        ...new Set(
          formal.flatMap(
            (candidate) =>
              this.metadataSources(
                candidate
              )
          )
        ),
      ];

    const result = {
      ...formal[0],
      title,
      authors,
      firstAuthorFamily:
        this.familyFromName(
          authors?.[0]
        )
        || formal[0]
          ?.firstAuthorFamily
        || baseMeta
          ?.firstAuthorFamily
        || "unknown",
      year,
      venue,
      publisher:
        this.bestPublicationField(
          formal,
          "publisher",
          {
            predicate:
              (value) =>
                !this.preprintPublisher(
                  value
                ),
          }
        )
        || "",
      workType:
        this.canonicalPublicationWorkType(
          formal
        )
        || this.bestPublicationField(
          formal,
          "workType"
        )
        || "",
      volume:
        this.bestPublicationField(
          formal,
          "volume"
        )
        || "",
      issue:
        this.bestPublicationField(
          formal,
          "issue"
        )
        || "",
      pages:
        this.bestPublicationField(
          formal,
          "pages"
        )
        || "",
      doi:
        this.normalizeDoi(
          doi
        ),
      arxiv,
      url:
        doi
          ? `https://doi.org/${
              this.normalizeDoi(
                doi
              )
            }`
          : this.bestPublicationField(
              formal,
              "url",
              {
                predicate:
                  (value) =>
                    !/arxiv\.org/i.test(
                      String(value)
                    ),
              }
            )
            || baseMeta?.url
            || "",
      keywords:
        [
          ...new Set(
            formal.flatMap(
              (candidate) =>
                candidate.keywords
                || []
            )
          ),
        ],
      citationCount:
        Math.max(
          ...formal.map(
            (candidate) =>
              Number(
                candidate.citationCount
                || 0
              )
          ),
          Number(
            baseMeta
              ?.citationCount
            || 0
          )
        ),
      _sources:
        sources,
      metadataSource:
        sources.join("+"),
    };

    return this.scoreFormalPublicationCandidate(
      baseMeta,
      result
    );
  }

  scoreFormalPublicationCandidate(
    baseMeta,
    candidate
  ) {
    const titleSimilarity =
      this.titleSimilarity(
        baseMeta?.title || "",
        candidate?.title || ""
      );

    const exactTitle =
      Boolean(
        this.normalizeTitleForMatch(
          baseMeta?.title
        )
        && this.normalizeTitleForMatch(
          baseMeta?.title
        )
          === this.normalizeTitleForMatch(
            candidate?.title
          )
      );

    const authorSimilarity =
      this.authorSimilarity(
        (baseMeta?.authors || [])
          .join(" "),
        candidate?.authors || []
      );

    const baseYear =
      Number(
        baseMeta?.year || 0
      );

    const candidateYear =
      Number(
        candidate?.year || 0
      );

    const yearDiff =
      baseYear && candidateYear
        ? Math.abs(
            baseYear - candidateYear
          )
        : null;

    const yearScore =
      yearDiff == null
        ? 2
        : yearDiff === 0
          ? 8
          : yearDiff === 1
            ? 6
            : yearDiff === 2
              ? 3
              : -8;

    const completeness =
      [
        candidate?.venue,
        candidate?.volume,
        candidate?.pages,
        candidate?.publisher,
      ]
        .filter(Boolean)
        .length;

    let score =
      titleSimilarity * 62
      + authorSimilarity * 22
      + yearScore
      + this.publicationSourceWeight(
          candidate
        )
      + Math.min(
          5,
          completeness
        );

    if (exactTitle) {
      score += 8;
    }

    const candidateArxiv =
      this.arxivIdFromMeta(
        candidate
      );

    const baseArxiv =
      this.arxivIdFromMeta(
        baseMeta
      );

    if (
      baseArxiv
      && candidateArxiv
      && baseArxiv.toLowerCase()
        === candidateArxiv.toLowerCase()
    ) {
      score += 12;
    }

    const percent =
      Math.max(
        1,
        Math.min(
          99,
          Math.round(score)
        )
      );

    return Object.assign(
      {},
      candidate,
      {
        _publicationMatchScore:
          score,
        _publicationMatchPercent:
          percent,
        _publicationTitleSimilarity:
          titleSimilarity,
        _publicationAuthorSimilarity:
          authorSimilarity,
        _publicationYearDiff:
          yearDiff,
        _publicationExactTitle:
          exactTitle,
      }
    );
  }

  async searchFormalPublicationCandidates(
    baseMeta,
    signals = {}
  ) {
    const title =
      this.cleanText(
        baseMeta?.title || ""
      );

    if (!title) {
      return [];
    }

    const safe =
      async (label, fn) => {
        const started =
          Date.now();

        try {
          const result =
            await this.withTimeout(
              fn(),
              32000,
              label
            );

          return {
            label,
            status:
              "ok",
            ms:
              Date.now() - started,
            results:
              Array.isArray(result)
                ? result
                : [],
          };
        }
        catch (error) {
          return {
            label,
            status:
              "error",
            ms:
              Date.now() - started,
            error:
              this.metadataSearchErrorText(
                error
              ),
            results: [],
          };
        }
      };

    this.setImportBusy(
      "正在检查是否存在正式发表版本…"
    );

    const firstStage =
      await Promise.all([
        safe(
          "DBLP",
          () =>
            this.searchDblp(
              title
            )
        ),
        safe(
          "PMLR",
          () =>
            this.searchPmlrExact(
              title,
              {
                ...signals,
                citationRescue: {
                  title,
                  authors:
                    baseMeta.authors || [],
                  year:
                    baseMeta.year || "",
                  venue:
                    baseMeta.venue || "",
                },
              }
            )
        ),
        safe(
          "OpenReview",
          () =>
            this.searchOpenReview(
              title
            )
        ),
      ]);

    const scoreAndFilter =
      (records) => {
        const seen =
          new Set();

        return records
          .flatMap(
            (record) =>
              record.results || []
          )
          .filter(
            (candidate) =>
              this.isFormalPublicationMeta(
                candidate
              )
          )
          .map(
            (candidate) =>
              this.scoreFormalPublicationCandidate(
                baseMeta,
                candidate
              )
          )
          .filter(
            (candidate) =>
              candidate._publicationTitleSimilarity
                >= 0.82
          )
          .sort(
            (a, b) =>
              b._publicationMatchScore
              - a._publicationMatchScore
          )
          .filter(
            (candidate) => {
              const key =
                [
                  this.normalizeTitleForMatch(
                    candidate.title
                  ),
                  candidate.year || "",
                  this.normalizeTitleForMatch(
                    candidate.venue
                  ),
                ].join("|");

              if (seen.has(key)) {
                return false;
              }

              seen.add(key);
              return true;
            }
          );
      };

    let ranked =
      scoreAndFilter(
        firstStage
      );

    // Even when DBLP/PMLR/OpenReview already identifies the
    // formal paper, continue with generic scholarly sources.
    // They often contribute complementary bibliography fields
    // such as a full proceedings title or volume number.
    const secondStage =
      await Promise.all([
        safe(
          "Semantic Scholar",
          () =>
            this.searchSemanticScholar(
              title
            )
        ),
        safe(
          "OpenAlex",
          () =>
            this.searchOpenAlex(
              title
            )
        ),
        safe(
          "Crossref",
          () =>
            this.searchCrossref(
              title
            )
        ),
      ]);

    this.lastPublicationDiagnostics =
      [
        ...firstStage,
        ...secondStage,
      ];

    ranked =
      scoreAndFilter(
        this.lastPublicationDiagnostics
      );

    const enrich =
      (primary) => {
        const primaryTitle =
          this.normalizeTitleForMatch(
            primary.title
          );

        const equivalents =
          ranked.filter(
            (candidate) => {
              const candidateTitle =
                this.normalizeTitleForMatch(
                  candidate.title
                );

              const titleEquivalent =
                Boolean(
                  primaryTitle
                  && candidateTitle
                  && (
                    primaryTitle
                      === candidateTitle
                    || this.titleSimilarity(
                      primary.title,
                      candidate.title
                    ) >= 0.985
                  )
                );

              if (!titleEquivalent) {
                return false;
              }

              const primaryYear =
                Number(
                  primary.year || 0
                );

              const candidateYear =
                Number(
                  candidate.year || 0
                );

              const yearCompatible =
                !primaryYear
                || !candidateYear
                || Math.abs(
                  primaryYear
                  - candidateYear
                ) <= 2;

              const authorCompatible =
                !primary.authors?.length
                || !candidate.authors?.length
                || this.authorSimilarity(
                  primary.authors.join(
                    " "
                  ),
                  candidate.authors
                ) >= 0.62;

              return Boolean(
                yearCompatible
                && authorCompatible
              );
            }
          );

        const canonical =
          this.canonicalFormalPublicationMeta(
            baseMeta,
            equivalents.length
              ? equivalents
              : [primary]
          );

        return canonical
          || this.scoreFormalPublicationCandidate(
            baseMeta,
            primary
          );
      };

    ranked =
      ranked
        .map(enrich)
        .sort(
          (a, b) =>
            b._publicationMatchScore
            - a._publicationMatchScore
        )
        .filter(
          (candidate, index, items) => {
            const key =
              [
                this.normalizeTitleForMatch(
                  candidate.title
                ),
                candidate.year || "",
                this.normalizeTitleForMatch(
                  candidate.venue
                ),
                this.normalizeDoi(
                  candidate.doi || ""
                ),
              ].join("|");

            return items.findIndex(
              (item) =>
                [
                  this.normalizeTitleForMatch(
                    item.title
                  ),
                  item.year || "",
                  this.normalizeTitleForMatch(
                    item.venue
                  ),
                  this.normalizeDoi(
                    item.doi || ""
                  ),
                ].join("|")
                === key
            ) === index;
          }
        );

    this.setImportBusy(
      null
    );

    return ranked.slice(0, 8);
  }

  isHighConfidencePublicationResolution(
    best,
    second = null
  ) {
    if (!best) return false;

    const title =
      Number(
        best._publicationTitleSimilarity
        || 0
      );

    const authors =
      Number(
        best._publicationAuthorSimilarity
        || 0
      );

    const yearDiff =
      best._publicationYearDiff;

    const score =
      Number(
        best._publicationMatchPercent
        || 0
      );

    const margin =
      second
        ? score
          - Number(
              second._publicationMatchPercent
              || 0
            )
        : 99;

    return Boolean(
      (
        best._publicationExactTitle
        && authors >= 0.42
        && (
          yearDiff == null
          || yearDiff <= 2
        )
        && score >= 90
      )
      || (
        title >= 0.97
        && authors >= 0.62
        && (
          yearDiff == null
          || yearDiff <= 2
        )
        && score >= 88
        && margin >= 3
      )
    );
  }

  mergeFormalPublicationMeta(
    baseMeta,
    formalMeta
  ) {
    const base =
      Object.assign(
        {},
        baseMeta || {}
      );

    const formal =
      Object.assign(
        {},
        formalMeta || {}
      );

    const baseArxiv =
      this.arxivIdFromMeta(
        base
      );

    const formalArxiv =
      this.arxivIdFromMeta(
        formal
      );

    const formalDoi =
      this.normalizeDoi(
        formal.doi || ""
      );

    const baseDoi =
      this.normalizeDoi(
        base.doi || ""
      );

    const sources =
      [
        ...this.metadataSources(
          base
        ),
        ...this.metadataSources(
          formal
        ),
      ];

    const formalPublisher =
      formal.publisher
      && !this.preprintPublisher(
        formal.publisher
      )
        ? formal.publisher
        : "";

    const basePublisher =
      base.publisher
      && !this.preprintPublisher(
        base.publisher
      )
        ? base.publisher
        : "";

    const merged = {
      ...base,
      title:
        formal.title
        || base.title,
      authors:
        formal.authors?.length
          ? formal.authors
          : base.authors || [],
      firstAuthorFamily:
        formal.firstAuthorFamily
        || this.familyFromName(
          formal.authors?.[0]
        )
        || base.firstAuthorFamily,
      year:
        formal.year
        || base.year,
      venue:
        formal.venue
        || base.venue,
      publisher:
        formalPublisher
        || basePublisher,
      workType:
        formal.workType
        || base.workType,
      volume:
        formal.volume
        || base.volume,
      issue:
        formal.issue
        || base.issue,
      pages:
        formal.pages
        || base.pages,
      doi:
        formalDoi
        && !this.isArxivDoi(
          formalDoi
        )
          ? formalDoi
          : baseDoi,
      arxiv:
        baseArxiv
        || formalArxiv,
      url:
        formal.url
        || base.url,
      keywords:
        [
          ...new Set([
            ...(base.keywords || []),
            ...(formal.keywords || []),
          ]),
        ],
      citationCount:
        Math.max(
          Number(
            base.citationCount || 0
          ),
          Number(
            formal.citationCount || 0
          )
        ),
      _sources:
        [...new Set(sources)],
      metadataSource:
        [...new Set(sources)]
          .join("+"),
    };

    // If no formal DOI exists, retain the arXiv DOI in YAML as a
    // resolvable identifier; BibTeX generation will not mistake
    // it for the DOI of the formal proceedings/journal version.
    if (
      !merged.doi
      && baseDoi
    ) {
      merged.doi =
        baseDoi;
    }

    const originalVenue =
      base.venue || "";

    merged._publicationResolution = {
      kind:
        this.isPreprintLikeMeta(
          base
        )
          ? "preprint-to-formal"
          : "formal-canonicalization",
      originalVenue,
      formalVenue:
        merged.venue || "",
      formalSource:
        this.metadataSources(
          formal
        ).join("+")
        || formal.metadataSource
        || "",
      confidence:
        Number(
          formal._publicationMatchPercent
          || 0
        ),
    };

    return merged;
  }

  async choosePublicationResolutionCandidate({
    baseMeta,
    candidates,
    sourcePdf = null,
  }) {
    return new Promise(
      (resolve) => {
        new PublicationResolutionModal(
          this.app,
          {
            baseMeta,
            candidates,
            sourcePdf,
            onUseFormal:
              (candidate) =>
                resolve({
                  kind:
                    "formal",
                  candidate,
                }),
            onKeepPreprint:
              () =>
                resolve({
                  kind:
                    "keep",
                }),
            onCancel:
              () =>
                resolve({
                  kind:
                    "keep",
                }),
          }
        ).open();
      }
    );
  }

  async resolvePublicationMetadata(
    meta,
    signals = {},
    {
      interactive = false,
      sourcePdf = null,
    } = {}
  ) {
    if (
      !meta
      || !meta.title
      || !this.needsPublicationResolution(
        meta
      )
    ) {
      return {
        meta,
        changed:
          false,
        candidates: [],
      };
    }

    const candidates =
      await this.searchFormalPublicationCandidates(
        meta,
        signals
      );

    if (!candidates.length) {
      return {
        meta,
        changed:
          false,
        candidates: [],
      };
    }

    const best =
      candidates[0];

    if (
      this.isHighConfidencePublicationResolution(
        best,
        candidates[1]
      )
    ) {
      return {
        meta:
          this.mergeFormalPublicationMeta(
            meta,
            best
          ),
        changed:
          true,
        candidate:
          best,
        candidates,
        automatic:
          true,
      };
    }

    if (!interactive) {
      return {
        meta,
        changed:
          false,
        candidate:
          best,
        candidates,
        suggested:
          true,
      };
    }

    const choice =
      await this.choosePublicationResolutionCandidate({
        baseMeta:
          meta,
        candidates,
        sourcePdf,
      });

    if (
      choice?.kind
      === "formal"
      && choice.candidate
    ) {
      return {
        meta:
          this.mergeFormalPublicationMeta(
            meta,
            choice.candidate
          ),
        changed:
          true,
        candidate:
          choice.candidate,
        candidates,
        automatic:
          false,
      };
    }

    return {
      meta,
      changed:
        false,
      candidate:
        best,
      candidates,
      keptPreprint:
        true,
    };
  }

  paperAsMetadata(paper) {
    return {
      title:
        paper.title,
      authors:
        [...(
          paper.authors || []
        )],
      firstAuthorFamily:
        this.familyFromName(
          paper.authors?.[0]
        )
        || "unknown",
      year:
        paper.year,
      venue:
        paper.venue,
      publisher:
        paper.publisher,
      workType:
        paper.workType,
      volume:
        paper.volume,
      issue:
        paper.issue,
      pages:
        paper.pages,
      doi:
        paper.doi,
      arxiv:
        paper.arxiv,
      url:
        paper.url,
      keywords:
        [...(
          paper.keywords || []
        )],
      metadataSource:
        paper.metadataSource,
      publicationStatus:
        paper.publicationStatus,
      publicationResolution:
        paper.publicationResolution,
      publicationUpdated:
        paper.publicationUpdated,
      _sources:
        paper.metadataSources?.length
          ? [...paper.metadataSources]
          : paper.metadataSource
            ? String(
                paper.metadataSource
              ).split("+")
            : [],
    };
  }

  publicationAuditPapers() {
    return this.papers.filter(
      (paper) =>
        this.needsPublicationResolution(
          this.paperAsMetadata(
            paper
          )
        )
    );
  }

  async applyResolvedPublicationToPaper(
    paper,
    meta
  ) {
    const sources =
      this.metadataSources(
        meta
      );

    const resolution =
      meta?._publicationResolution
      || {};

    this.suppressRefreshUntil =
      Date.now() + 1800;

    await this.app.fileManager
      .processFrontMatter(
        paper.file,
        (fm) => {
          fm.title =
            meta.title || fm.title;

          fm.authors =
            meta.authors?.length
              ? [...meta.authors]
              : fm.authors || [];

          fm.year =
            meta.year || fm.year;

          fm.venue =
            meta.venue || "";

          fm.publisher =
            meta.publisher || "";

          fm.work_type =
            meta.workType || "";

          fm.volume =
            meta.volume || "";

          fm.issue =
            meta.issue || "";

          fm.pages =
            meta.pages || "";

          fm.doi =
            meta.doi || "";

          fm.arxiv =
            this.arxivIdFromMeta(
              meta
            ) || "";

          fm.url =
            meta.url || "";

          fm.metadata_source =
            sources.join("+");

          fm.metadata_sources =
            sources;

          fm.metadata_verified =
            true;

          fm.metadata_updated =
            this.today();

          fm.publication_status =
            "formal";

          fm.publication_resolution =
            resolution.kind
            || "preprint-to-formal";

          fm.publication_updated =
            this.today();
        }
      );

    Object.assign(
      paper,
      {
        title:
          meta.title || paper.title,
        authors:
          meta.authors?.length
            ? [...meta.authors]
            : paper.authors,
        year:
          meta.year || paper.year,
        venue:
          meta.venue || "",
        publisher:
          meta.publisher || "",
        workType:
          meta.workType || "",
        volume:
          meta.volume || "",
        issue:
          meta.issue || "",
        pages:
          meta.pages || "",
        doi:
          this.normalizeDoi(
            meta.doi || ""
          ),
        arxiv:
          this.arxivIdFromMeta(
            meta
          ),
        url:
          meta.url || "",
        metadataSource:
          sources.join("+"),
        metadataSources:
          sources,
        metadataVerified:
          true,
        metadataUpdated:
          this.today(),
        publicationStatus:
          "formal",
        publicationResolution:
          resolution.kind
          || "preprint-to-formal",
        publicationUpdated:
          this.today(),
      }
    );

    this.invalidatePaperPaths([
      originalPath,
      paper.file?.path,
    ]);

    this.renderCollectionSurface();

    await this.syncBibliographyIfEnabled();

    if (
      this.detailPaperPath
      === paper.file.path
    ) {
      await this.renderPaperDetail(
        paper
      );
    }

    return paper;
  }

  async repairPaperPublication(
    paper,
    {
      interactive = true,
    } = {}
  ) {
    const base =
      this.paperAsMetadata(
        paper
      );

    if (
      !this.needsPublicationResolution(
        base
      )
    ) {
      new Notice(
        "当前记录已经完成正式发表信息解析。"
      );

      return {
        changed:
          false,
      };
    }

    this.setImportBusy(
      `正在解析正式发表版本：${paper.title}`
    );

    try {
      const result =
        await this.resolvePublicationMetadata(
          base,
          {
            citationRescue: {
              title:
                paper.title,
              authors:
                paper.authors,
              year:
                paper.year,
              venue:
                paper.venue,
            },
          },
          {
            interactive,
          }
        );

      if (
        result.changed
      ) {
        const originalSuggestedKey =
          this.suggestedCitekey(
            paper
          );

        const originalKey =
          this.normalizeCitekey(
            paper.citekey
          );

        const canAutoUpdateCitekey =
          Boolean(
            originalKey
            && originalSuggestedKey
            && originalKey.toLowerCase()
              === originalSuggestedKey.toLowerCase()
          );

        await this.applyResolvedPublicationToPaper(
          paper,
          result.meta
        );

        let citekeyNotice =
          "";

        if (
          canAutoUpdateCitekey
        ) {
          const formalSuggestedKey =
            this.makeUniqueCitekeyForPaper(
              this.suggestedCitekey(
                paper
              ),
              paper
            );

          if (
            formalSuggestedKey
            && formalSuggestedKey.toLowerCase()
              !== originalKey.toLowerCase()
          ) {
            try {
              await this.renamePaperCitekey(
                paper,
                formalSuggestedKey
              );

              citekeyNotice =
                ` · Citekey ${originalKey} → ${formalSuggestedKey}`;
            }
            catch (citekeyError) {
              console.warn(
                "Research Library: formal metadata repaired but citekey auto-update failed",
                citekeyError
              );

              citekeyNotice =
                " · Citekey 未自动修改";
            }
          }
        }

        new Notice(
          `已更新正式发表信息：${result.meta.venue || result.meta.title}${citekeyNotice}`,
          6000
        );
      }
      else if (
        !result.candidates?.length
      ) {
        new Notice(
          "没有找到足够可靠的正式发表版本。",
          5000
        );
      }

      return result;
    }
    finally {
      this.setImportBusy(
        null
      );
    }
  }

  openPublicationAudit() {
    new PublicationAuditModal(
      this.app,
      {
        library:
          this,
      }
    ).open();
  }

  metadataSources(
    meta
  ) {
    const values =
      (
        Array.isArray(
          meta?._sources
        )
          ? meta._sources
          : meta?.metadataSource
            ? String(
                meta.metadataSource
              )
                .split("+")
            : []
      )
        .map(
          (source) =>
            String(
              source || ""
            ).trim()
        )
        .filter(Boolean);

    return [
      ...new Set(values),
    ];
  }

  importProvenance(
    meta,
    matchMethod
  ) {
    const sources =
      this.metadataSources(
        meta
      );

    const unverifiedMethods =
      new Set([
        "pdf-only",
        "citation-text",
      ]);

    const verified =
      !unverifiedMethods.has(
        matchMethod
      )
      &&
      sources.some(
        (source) =>
          ![
            "pdf",
            "citation-gb",
            "citation-llm",
          ].includes(source)
      );

    const methodLabels = {
      doi:
        "DOI exact",
      arxiv:
        "arXiv exact",
      "title-search":
        "Database title search",
      "llm-rescue":
        "LLM title rescue → database",
      "citation-rescue":
        "Citation repair → database",
      "citation-text":
        "Citation metadata only",
      "pdf-only":
        "PDF metadata only",
    };

    return {
      sources,
      source:
        sources.join("+")
        || meta?.metadataSource
        || (
          matchMethod
            === "pdf-only"
            ? "pdf"
            : ""
        ),
      importMethod:
        matchMethod
        || "unknown",
      methodLabel:
        methodLabels[
          matchMethod
        ]
        || matchMethod
        || "Unknown",
      verified,
      verificationLabel:
        verified
          ? "Database verified"
          : "Unverified",
    };
  }

  validateImportMeta(
    meta,
    sourcePdf
  ) {
    if (
      !(sourcePdf instanceof TFile)
      || sourcePdf.extension
        ?.toLowerCase()
        !== "pdf"
    ) {
      throw new Error(
        "导入源不是有效 PDF。"
      );
    }

    const title =
      this.cleanText(
        meta?.title || ""
      );

    if (!title) {
      throw new Error(
        "Title 不能为空。"
      );
    }

    if (
      meta?.year
      && (
        Number(meta.year) < 1800
        || Number(meta.year) > 2100
      )
    ) {
      throw new Error(
        `Year 不合理：${meta.year}`
      );
    }

    const doi =
      this.normalizeDoi(
        meta?.doi || ""
      );

    if (
      doi
      && !/^10\.\d{4,9}\/\S+$/i.test(
        doi
      )
    ) {
      throw new Error(
        `DOI 格式不合理：${doi}`
      );
    }
  }

  makeImportPlan(
    sourcePdf,
    meta
  ) {
    const settings =
      this.plugin.settings;

    const normalized =
      Object.assign(
        {},
        meta
      );

    normalized.firstAuthorFamily =
      this.familyFromName(
        normalized.authors?.[0]
      )
      || normalized.firstAuthorFamily
      || "unknown";

    let citekey =
      this.makeCitekey(
        normalized
      );

    citekey =
      this.makeUniqueCitekey(
        citekey
      );

    return {
      meta:
        normalized,
      citekey,
      date:
        this.today(),
      notePath:
        `${settings.papersFolder}/${citekey}.md`,
      pdfPath:
        `${settings.pdfFolder}/${citekey}.pdf`,
      originalFilename:
        sourcePdf.name,
      originalPdfPath:
        sourcePdf.path,
    };
  }

  async commitImportedPaper(...args) {
    return this.withExclusiveWrite(
      "Import commit",
      () =>
        this._commitImportedPaper(
          ...args
        )
    );
  }

  async _commitImportedPaper({
    sourcePdf,
    meta,
    matchMethod,
  }) {
    sourcePdf =
      this.liveTFile(
        sourcePdf,
        {
          extension:
            "pdf",
          label:
            "Source PDF",
        }
      );

    this.validateImportMeta(
      meta,
      sourcePdf
    );

    await this.ensureFolder(
      this.plugin.settings
        .papersFolder
    );

    await this.ensureFolder(
      this.plugin.settings
        .pdfFolder
    );

    const duplicate =
      this.findExistingPaperForMeta(
        meta
      );

    if (duplicate) {
      const error =
        new Error(
          `论文已存在：${duplicate.title}`
        );

      error.code =
        "RL_DUPLICATE";

      error.existing =
        duplicate;

      throw error;
    }

    const plan =
      this.makeImportPlan(
        sourcePdf,
        meta
      );

    const {
      citekey,
      date,
      notePath,
      pdfPath,
      originalFilename,
      originalPdfPath,
    } = plan;

    const normalizedMeta =
      plan.meta;

    let movedPdf = false;
    let createdNote = null;

    try {
      try {
        await this.withTimeout(
          this.app.fileManager
            .renameFile(
              sourcePdf,
              pdfPath
            ),
          20000,
          "PDF move"
        );
      }
      catch (error) {
        const movedAfterTimeout =
          this.app.vault
            .getAbstractFileByPath(
              pdfPath
            );

        if (
          error?.code
            === "RL_TIMEOUT"
          && movedAfterTimeout
            instanceof TFile
        ) {
          // Reconcile with actual Vault state.
        }
        else {
          throw error;
        }
      }

      const moved =
        this.app.vault
          .getAbstractFileByPath(
            pdfPath
          );

      if (
        !(moved instanceof TFile)
      ) {
        throw new Error(
          "PDF 移动后未在目标目录找到文件。"
        );
      }

      movedPdf = true;

      const content =
        this.renderImportedPaper({
          meta:
            normalizedMeta,
          citekey,
          pdfPath,
          date,
          originalFilename,
          matchMethod,
        });

      try {
        createdNote =
          await this.withTimeout(
            this.app.vault
              .create(
                notePath,
                content
              ),
            20000,
            "Paper Note create"
          );
      }
      catch (error) {
        const createdAfterTimeout =
          this.app.vault
            .getAbstractFileByPath(
              notePath
            );

        if (
          error?.code
            === "RL_TIMEOUT"
          && createdAfterTimeout
            instanceof TFile
        ) {
          createdNote =
            createdAfterTimeout;
        }
        else {
          throw error;
        }
      }

      const verifiedNote =
        this.app.vault
          .getAbstractFileByPath(
            notePath
          );

      if (
        !(verifiedNote instanceof TFile)
      ) {
        throw new Error(
          "Paper Note 创建后未在 Vault 中找到。"
        );
      }

      return {
        note:
          verifiedNote,
        citekey,
        pdfPath,
        notePath,
        meta:
          normalizedMeta,
        provenance:
          this.importProvenance(
            normalizedMeta,
            matchMethod
          ),
      };
    }
    catch (error) {
      // Remove a partially-created note before moving the PDF back.
      try {
        const partialNote =
          this.app.vault
            .getAbstractFileByPath(
              notePath
            );

        if (
          partialNote instanceof TFile
        ) {
          await this.withTimeout(
            this.app.vault.delete(
              partialNote
            ),
            15000,
            "Paper Note rollback"
          );
        }
      }
      catch (noteRollbackError) {
        console.error(
          "Research Library: Paper Note rollback failed",
          noteRollbackError
        );
      }

      if (movedPdf) {
        try {
          const moved =
            this.app.vault
              .getAbstractFileByPath(
                pdfPath
              );

          if (
            moved instanceof TFile
          ) {
            await this.withTimeout(
              this.app.fileManager
                .renameFile(
                  moved,
                  originalPdfPath
                ),
              15000,
              "PDF rollback"
            );
          }
        }
        catch (rollbackError) {
          console.error(
            "Research Library: PDF rollback failed",
            rollbackError
          );
        }
      }

      throw error;
    }
  }

  findExistingPaperForMeta(
    meta
  ) {
    const doi =
      this.normalizeDoi(
        meta.doi || ""
      );

    const title =
      this.normalizeTitle(
        meta.title || ""
      );

    return this.papers.find(
      (paper) => {
        if (
          doi
          && paper.doi
          && this.normalizeDoi(
            paper.doi
          ) === doi
        ) {
          return true;
        }

        return (
          title
          && this.normalizeTitle(
            paper.title
          ) === title
          &&
          (
            !meta.year
            || !paper.year
            || String(meta.year)
              === String(paper.year)
          )
        );
      }
    ) || null;
  }

  bibliographyPath() {
    return normalizePath(
      this.plugin.settings
        .bibFilePath
      || "Research/99 System/library.bib"
    ).replace(/^\/+/, "");
  }

  validCitekey(value) {
    return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(
      String(value || "")
        .trim()
    );
  }

  normalizeCitekey(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, "");
  }

  suggestedCitekey(paper) {
    const family =
      this.familyFromName(
        paper?.authors?.[0]
      )
      || "anon";

    return this.makeCitekey({
      firstAuthorFamily:
        family,
      year:
        paper?.year || "nd",
      title:
        paper?.title || "work",
    });
  }

  citationAudit(
    papers = this.papers
  ) {
    const issues = [];
    const seen =
      new Map();

    for (
      const paper
      of papers || []
    ) {
      const key =
        this.normalizeCitekey(
          paper.citekey
        );

      if (!key) {
        issues.push({
          type:
            "missing",
          paper,
          message:
            `缺少 Citekey：${paper.title}`,
        });

        continue;
      }

      if (
        !this.validCitekey(key)
      ) {
        issues.push({
          type:
            "invalid",
          paper,
          message:
            `Citekey 含不支持字符：${key}`,
        });

        continue;
      }

      const canonical =
        key.toLowerCase();

      if (
        seen.has(canonical)
      ) {
        const previous =
          seen.get(canonical);

        issues.push({
          type:
            "duplicate",
          paper,
          other:
            previous,
          message:
            `重复 Citekey：${key}`,
        });
      }
      else {
        seen.set(
          canonical,
          paper
        );
      }
    }

    return {
      issues,
      blocking:
        issues.filter(
          (issue) =>
            [
              "missing",
              "invalid",
              "duplicate",
            ].includes(
              issue.type
            )
        ),
      validCount:
        (papers || []).length
        - issues.filter(
            (issue) =>
              [
                "missing",
                "invalid",
              ].includes(
                issue.type
              )
          ).length,
    };
  }

  bibtexAuthorName(value) {
    const clean =
      this.cleanText(
        value || ""
      )
        .replace(
          /[‐‑‒–—−]/g,
          "-"
        )
        .replace(
          /\s*,\s*/g,
          ", "
        )
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    if (!clean) {
      return "";
    }

    // Metadata that is already in BibTeX's canonical
    // "Family, Given" / "Family, Suffix, Given" form should
    // remain authoritative rather than being guessed again.
    if (clean.includes(",")) {
      return clean;
    }

    const parts =
      clean.split(/\s+/)
        .filter(Boolean);

    if (parts.length < 2) {
      return clean;
    }

    const suffixes =
      new Set([
        "jr",
        "jr.",
        "sr",
        "sr.",
        "ii",
        "iii",
        "iv",
        "v",
      ]);

    let suffix = "";

    const finalPart =
      parts[
        parts.length - 1
      ];

    if (
      suffixes.has(
        finalPart.toLowerCase()
      )
    ) {
      suffix =
        parts.pop();
    }

    if (parts.length < 2) {
      return [
        parts.join(" "),
        suffix,
      ]
        .filter(Boolean)
        .join(", ");
    }

    // Lower-case surname particles are part of the family name.
    // This covers common academic names such as:
    // Marko van Treeck -> van Treeck, Marko
    // Juan de la Cruz  -> de la Cruz, Juan
    // Ludwig van der Waals -> van der Waals, Ludwig
    const particles =
      new Set([
        "a",
        "af",
        "al",
        "ap",
        "bin",
        "da",
        "dal",
        "de",
        "del",
        "della",
        "den",
        "der",
        "di",
        "do",
        "dos",
        "du",
        "el",
        "ibn",
        "la",
        "le",
        "st",
        "st.",
        "ten",
        "ter",
        "van",
        "von",
      ]);

    let familyStart =
      parts.length - 1;

    while (
      familyStart > 1
      && particles.has(
        parts[
          familyStart - 1
        ].toLowerCase()
      )
    ) {
      familyStart -= 1;
    }

    const given =
      parts.slice(
        0,
        familyStart
      ).join(" ");

    const family =
      parts.slice(
        familyStart
      ).join(" ");

    if (suffix) {
      return given
        ? `${family}, ${suffix}, ${given}`
        : `${family}, ${suffix}`;
    }

    return given
      ? `${family}, ${given}`
      : family;
  }

  bibtexAuthors(authors) {
    return (authors || [])
      .map(
        (author) =>
          this.bibtexAuthorName(
            author
          )
      )
      .filter(Boolean)
      .join(" and ");
  }

  bibtexNormalizePunctuation(
    value
  ) {
    return String(
      value ?? ""
    )
      .replace(
        /\u00a0/g,
        " "
      )
      // Hyphen / non-breaking hyphen / figure dash / minus.
      .replace(
        /[‐‑‒−]/g,
        "-"
      )
      // In bibliographic prose, normalize typographic long
      // dashes to portable ASCII rather than keeping Unicode.
      .replace(
        /[–—]/g,
        "-"
      )
      .replace(
        /[“”„‟]/g,
        '"'
      )
      .replace(
        /[‘’‚‛]/g,
        "'"
      )
      .replace(
        /…/g,
        "..."
      )
      .replace(
        /\r?\n/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();
  }

  bibtexLatexUnicode(
    value
  ) {
    const direct =
      new Map([
        ["ø", "{\\o}"],
        ["Ø", "{\\O}"],
        ["ł", "{\\l}"],
        ["Ł", "{\\L}"],
        ["ß", "{\\ss}"],
        ["æ", "{\\ae}"],
        ["Æ", "{\\AE}"],
        ["œ", "{\\oe}"],
        ["Œ", "{\\OE}"],
        ["ð", "{\\dh}"],
        ["Ð", "{\\DH}"],
        ["þ", "{\\th}"],
        ["Þ", "{\\TH}"],
        ["ı", "{\\i}"],
      ]);

    const combining =
      new Map([
        ["\u0300", {
          command:
            "`",
          braced:
            false,
        }],
        ["\u0301", {
          command:
            "'",
          braced:
            false,
        }],
        ["\u0302", {
          command:
            "^",
          braced:
            false,
        }],
        ["\u0303", {
          command:
            "~",
          braced:
            false,
        }],
        ["\u0304", {
          command:
            "=",
          braced:
            false,
        }],
        ["\u0306", {
          command:
            "u",
          braced:
            true,
        }],
        ["\u0307", {
          command:
            ".",
          braced:
            false,
        }],
        ["\u0308", {
          command:
            '"',
          braced:
            false,
        }],
        ["\u030a", {
          command:
            "r",
          braced:
            true,
        }],
        ["\u030b", {
          command:
            "H",
          braced:
            true,
        }],
        ["\u030c", {
          command:
            "v",
          braced:
            true,
        }],
        ["\u0327", {
          command:
            "c",
          braced:
            true,
        }],
        ["\u0328", {
          command:
            "k",
          braced:
            true,
        }],
      ]);

    let output =
      "";

    for (
      const character
      of String(value || "")
    ) {
      if (
        direct.has(
          character
        )
      ) {
        output +=
          direct.get(
            character
          );

        continue;
      }

      const decomposed =
        character.normalize(
          "NFD"
        );

      const pieces =
        [...decomposed];

      if (
        pieces.length > 1
        && /^[A-Za-z]$/.test(
          pieces[0]
        )
        && pieces
          .slice(1)
          .every(
            (mark) =>
              combining.has(
                mark
              )
          )
      ) {
        let accented =
          pieces[0];

        for (
          const mark
          of pieces.slice(1)
        ) {
          const spec =
            combining.get(
              mark
            );

          accented =
            spec.braced
              ? `{\\${spec.command}{${accented}}}`
              : `{\\${spec.command}${accented}}`;
        }

        output +=
          accented;

        continue;
      }

      // Keep scripts that do not have a safe generic LaTeX
      // transliteration. This is preferable to silently losing
      // Chinese/Japanese/Korean or other author/title text.
      output +=
        character;
    }

    return output;
  }

  bibtexEscape(value) {
    let clean =
      this.bibtexNormalizePunctuation(
        value
      );

    if (!clean) {
      return "";
    }

    // Escape user/source text first. LaTeX accent commands are
    // generated only afterwards, so the braces/backslashes we
    // intentionally create are not escaped a second time.
    clean =
      clean
        .replace(
          /\\/g,
          "\\textbackslash{}"
        )
        .replace(
          /([{}%#&_])/g,
          "\\$1"
        )
        .replace(
          /~/g,
          "\\textasciitilde{}"
        )
        .replace(
          /\^/g,
          "\\textasciicircum{}"
        );

    return this.bibtexLatexUnicode(
      clean
    );
  }

  bibtexPages(value) {
    let clean =
      this.bibtexNormalizePunctuation(
        value
      );

    if (!clean) {
      return "";
    }

    // BibTeX/LaTeX page ranges use a double hyphen.  Preserve
    // single numeric article identifiers such as Lancet's
    // `100891` exactly as supplied.
    clean =
      clean
        .replace(
          /-{2,}/g,
          "-"
        )
        .replace(
          /([A-Za-z]?\d+)\s*-\s*([A-Za-z]?\d+)/g,
          "$1--$2"
        );

    return clean;
  }

  bibtexEntryType(paper) {
    const kind =
      this.publicationKind(
        paper
      );

    if (kind === "journal") {
      return "article";
    }

    if (
      kind === "incollection"
    ) {
      return "incollection";
    }

    if (kind === "thesis") {
      return "phdthesis";
    }

    if (kind === "conference") {
      return "inproceedings";
    }

    if (
      this.arxivIdFromMeta(
        paper
      )
      || this.preprintVenue(
        paper?.venue
      )
      || this.preprintWorkType(
        paper?.workType
      )
    ) {
      return "misc";
    }

    return paper?.venue
      ? "inproceedings"
      : "misc";
  }

  bibtexField(
    name,
    value,
    {
      protectCase = false,
    } = {}
  ) {
    const clean =
      this.bibtexEscape(
        value
      );

    if (!clean) {
      return "";
    }

    return `  ${name} = {${
      protectCase
        ? `{${clean}}`
        : clean
    }}`;
  }

  bibtexForPaper(paper) {
    const citekey =
      this.normalizeCitekey(
        paper?.citekey
      );

    if (
      !citekey
      || !this.validCitekey(
        citekey
      )
    ) {
      throw new Error(
        `无法生成 BibTeX：无效 Citekey（${paper?.title || "Untitled"}）`
      );
    }

    const type =
      this.bibtexEntryType(
        paper
      );

    const fields = [];

    const push =
      (value) => {
        if (value) {
          fields.push(value);
        }
      };

    push(
      this.bibtexField(
        "title",
        paper.title,
        {
          protectCase:
            true,
        }
      )
    );

    if (
      paper.authors
        ?.length
    ) {
      push(
        this.bibtexField(
          "author",
          this.bibtexAuthors(
            paper.authors
          )
        )
      );
    }

    push(
      this.bibtexField(
        "year",
        paper.year
      )
    );

    if (paper.venue) {
      push(
        this.bibtexField(
          type === "article"
            ? "journal"
            : type === "incollection"
              ? "booktitle"
              : type === "inproceedings"
                ? "booktitle"
                : "howpublished",
          paper.venue
        )
      );
    }

    push(
      this.bibtexField(
        "publisher",
        paper.publisher
      )
    );

    push(
      this.bibtexField(
        "volume",
        paper.volume
      )
    );

    push(
      this.bibtexField(
        "number",
        paper.issue
      )
    );

    push(
      this.bibtexField(
        "pages",
        this.bibtexPages(
          paper.pages
        )
      )
    );

    const formalPublication =
      this.isFormalPublicationMeta(
        paper
      );

    const effectiveArxiv =
      this.arxivIdFromMeta(
        paper
      );

    const bibtexDoi =
      formalPublication
      && this.isArxivDoi(
        paper.doi
      )
        ? ""
        : paper.doi;

    push(
      this.bibtexField(
        "doi",
        bibtexDoi
      )
    );

    if (effectiveArxiv) {
      push(
        this.bibtexField(
          "eprint",
          effectiveArxiv
        )
      );

      push(
        this.bibtexField(
          "archivePrefix",
          "arXiv"
        )
      );
    }

    const url =
      paper.url
      || (
        paper.doi
          ? `https://doi.org/${paper.doi}`
          : effectiveArxiv
            ? `https://arxiv.org/abs/${effectiveArxiv}`
            : ""
      );

    push(
      this.bibtexField(
        "url",
        url
      )
    );

    return `@${type}{${citekey},\n${
      fields.join(",\n")
    }\n}`;
  }

  bibliographyContent(
    papers = this.papers
  ) {
    const audit =
      this.citationAudit(
        papers
      );

    if (
      audit.blocking.length
    ) {
      const first =
        audit.blocking[0];

      throw new Error(
        `library.bib 未同步：${first.message}${
          audit.blocking.length > 1
            ? `（另有 ${audit.blocking.length - 1} 项）`
            : ""
        }`
      );
    }

    const ordered =
      [...(papers || [])]
        .sort(
          (a, b) =>
            this.normalizeCitekey(
              a.citekey
            ).localeCompare(
              this.normalizeCitekey(
                b.citekey
              ),
              undefined,
              {
                sensitivity:
                  "base",
              }
            )
        );

    const body =
      ordered
        .map(
          (paper) =>
            this.bibtexForPaper(
              paper
            )
        )
        .join("\n\n");

    return [
      "% Generated by Research Library v0.7",
      "% Source of truth: Paper Markdown/YAML in the Obsidian Vault.",
      "% This file is generated and may be overwritten.",
      "",
      body,
      "",
    ].join("\n");
  }

  async syncBibliography({
    notice = true,
  } = {}) {
    if (this.bibliographySyncing) {
      return null;
    }

    this.bibliographySyncing =
      true;

    try {
      const path =
        this.bibliographyPath();

      if (
        !path
        || !/\.bib$/i.test(
          path
        )
      ) {
        throw new Error(
          "Bibliography path 必须以 .bib 结尾。"
        );
      }

      const content =
        this.bibliographyContent(
          this.papers
        );

      const slash =
        path.lastIndexOf("/");

      const folder =
        slash >= 0
          ? path.slice(0, slash)
          : "";

      if (folder) {
        await this.ensureFolder(
          folder
        );
      }

      const existing =
        this.app.vault
          .getAbstractFileByPath(
            path
          );

      if (
        existing
        && !(existing instanceof TFile)
      ) {
        throw new Error(
          `Bibliography 路径被文件夹占用：${path}`
        );
      }

      let file =
        existing;

      if (
        existing instanceof TFile
      ) {
        const current =
          await this.app.vault
            .cachedRead(
              existing
            );

        if (
          current !== content
        ) {
          await this.app.vault
            .modify(
              existing,
              content
            );
        }
      }
      else {
        file =
          await this.app.vault
            .create(
              path,
              content
            );
      }

      this.lastBibliographyError =
        "";

      this.lastBibliographySyncAt =
        Date.now();

      if (notice) {
        new Notice(
          `library.bib 已同步 · ${this.papers.length} 篇`
        );
      }

      return file;
    }
    finally {
      this.bibliographySyncing =
        false;
    }
  }

  async syncBibliographyIfEnabled() {
    if (
      !this.plugin.settings
        .autoSyncBibliography
    ) {
      return;
    }

    if (
      this.bibliographySyncPromise
    ) {
      this.bibliographySyncPending =
        true;

      return this
        .bibliographySyncPromise;
    }

    this.bibliographySyncPromise =
      (async () => {
        do {
          this.bibliographySyncPending =
            false;

          try {
            await this.syncBibliography({
              notice:
                false,
            });
          }
          catch (error) {
            this.lastBibliographyError =
              error?.message
              || String(error);

            console.debug(
              "Research Library: bibliography auto-sync failed",
              error
            );
          }
        }
        while (
          this.bibliographySyncPending
        );
      })();

    try {
      await this.bibliographySyncPromise;
    }
    finally {
      this.bibliographySyncPromise =
        null;
    }
  }

  plainCitation(paper) {
    const authors =
      paper.authors?.length
        ? paper.authors.join(", ")
        : "";

    const venueYear =
      [
        paper.venue || "",
        paper.year || "",
      ]
        .filter(Boolean)
        .join(", ");

    const doi =
      paper.doi
        ? `https://doi.org/${paper.doi}`
        : "";

    return [
      authors
        ? `${authors}.`
        : "",
      paper.title
        ? `${paper.title}.`
        : "",
      venueYear
        ? `${venueYear}.`
        : "",
      doi,
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  pandocCitation(
    papers
  ) {
    const list =
      Array.isArray(papers)
        ? papers
        : [papers];

    const keys =
      list
        .map(
          (paper) =>
            this.normalizeCitekey(
              paper?.citekey
            )
        )
        .filter(Boolean);

    if (!keys.length) {
      throw new Error(
        "没有可复制的 Citekey。"
      );
    }

    const invalid =
      keys.find(
        (key) =>
          !this.validCitekey(
            key
          )
      );

    if (invalid) {
      throw new Error(
        `无效 Citekey：${invalid}`
      );
    }

    return `[${
      keys.map(
        (key) => `@${key}`
      ).join("; ")
    }]`;
  }

  async copyCitationText(
    text,
    label
  ) {
    await navigator.clipboard
      .writeText(
        text
      );

    new Notice(
      `已复制 ${label}`
    );
  }

  async openBibliographyFile() {
    let file =
      this.app.vault
        .getAbstractFileByPath(
          this.bibliographyPath()
        );

    if (
      !(file instanceof TFile)
    ) {
      file =
        await this.syncBibliography({
          notice: false,
        });
    }

    if (
      !(file instanceof TFile)
    ) {
      throw new Error(
        "无法打开 library.bib。"
      );
    }

    await this.app.workspace
      .getLeaf("tab")
      .openFile(
        file
      );

    this.close();
  }

  citationMenuButton(
    parent,
    {
      icon,
      title,
      description = "",
      onClick,
      disabled = false,
    }
  ) {
    const button =
      parent.createEl(
        "button",
        {
          cls:
            "rl-citation-menu-item",
          attr: {
            type:
              "button",
          },
        }
      );

    button.disabled =
      Boolean(disabled);

    this.createIcon(
      button,
      icon,
      "rl-citation-menu-icon"
    );

    const text =
      button.createDiv({
        cls:
          "rl-citation-menu-text",
      });

    text.createDiv({
      cls:
        "rl-citation-menu-title",
      text:
        title,
    });

    if (description) {
      text.createDiv({
        cls:
          "rl-citation-menu-description",
        text:
          description,
      });
    }

    button.addEventListener(
      "click",
      async (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (button.disabled) {
          return;
        }

        try {
          await onClick?.();
        }
        catch (error) {
          new Notice(
            error?.message
            || "引用操作失败",
            6000
          );
        }
      }
    );

    return button;
  }

  renderCitationAudit(
    parent,
    papers = this.papers
  ) {
    const audit =
      this.citationAudit(
        papers
      );

    const summary =
      parent.createDiv({
        cls:
          `rl-citation-audit ${
            audit.blocking.length
              ? "has-issues"
              : "is-clean"
          }`,
      });

    const icon =
      summary.createSpan({
        cls:
          "rl-citation-audit-icon",
      });

    this.createIcon(
      icon,
      audit.blocking.length
        ? "triangle-alert"
        : "badge-check"
    );

    summary.createSpan({
      text:
        audit.blocking.length
          ? `${audit.blocking.length} 个 Citekey 问题`
          : `${papers.length} 篇 · Citekey 正常`,
    });

    return audit;
  }

  openCitationLibraryPopover(
    anchor
  ) {
    this.closePopover();

    const popover =
      this.createPopover(
        anchor,
        "rl-citation-popover"
      );

    this.activePopover =
      popover;

    const header =
      popover.createDiv({
        cls:
          "rl-citation-popover-header",
      });

    header.createDiv({
      cls:
        "rl-citation-popover-title",
      text:
        "Citations",
    });

    header.createDiv({
      cls:
        "rl-citation-popover-path",
      text:
        this.bibliographyPath(),
      attr: {
        title:
          this.bibliographyPath(),
      },
    });

    const audit =
      this.renderCitationAudit(
        popover,
        this.papers
      );

    const list =
      popover.createDiv({
        cls:
          "rl-citation-menu",
      });

    const publicationAudit =
      this.publicationAuditPapers();

    this.citationMenuButton(
      list,
      {
        icon:
          publicationAudit.length
            ? "scan-search"
            : "badge-check",
        title:
          "Publication audit",
        description:
          publicationAudit.length
            ? `${publicationAudit.length} 篇可能仍是 preprint/arXiv metadata`
            : "未发现明显的 preprint-only 记录",
        onClick:
          () => {
            this.closePopover();
            this.openPublicationAudit();
          },
      }
    );

    this.citationMenuButton(
      list,
      {
        icon:
          "refresh-cw",
        title:
          "Sync library.bib",
        description:
          "从 Paper YAML 重新生成完整 BibTeX",
        disabled:
          audit.blocking.length > 0,
        onClick:
          async () => {
            await this.syncBibliography({
              notice: true,
            });

            this.closePopover();
          },
      }
    );

    this.citationMenuButton(
      list,
      {
        icon:
          "file-code-2",
        title:
          "Open library.bib",
        description:
          "打开生成的 bibliography 文件",
        disabled:
          audit.blocking.length > 0,
        onClick:
          () =>
            this.openBibliographyFile(),
      }
    );

    this.citationMenuButton(
      list,
      {
        icon:
          "copy",
        title:
          "Copy all BibTeX",
        description:
          `${this.papers.length} 篇论文`,
        disabled:
          audit.blocking.length > 0,
        onClick:
          () =>
            this.copyCitationText(
              this.papers
                .map(
                  (paper) =>
                    this.bibtexForPaper(
                      paper
                    )
                )
                .join("\n\n"),
              "全部 BibTeX"
            ),
      }
    );

    if (
      audit.blocking.length
    ) {
      const issues =
        popover.createDiv({
          cls:
            "rl-citation-issues",
        });

      for (
        const issue
        of audit.blocking.slice(
          0,
          5
        )
      ) {
        issues.createDiv({
          cls:
            "rl-citation-issue",
          text:
            issue.message,
        });
      }

      if (
        audit.blocking.length > 5
      ) {
        issues.createDiv({
          cls:
            "rl-citation-issue-more",
          text:
            `另有 ${audit.blocking.length - 5} 项`,
        });
      }
    }
  }

  openPaperCitationPopover(
    anchor,
    paper
  ) {
    this.closePopover();

    const popover =
      this.createPopover(
        anchor,
        "rl-citation-popover"
      );

    this.activePopover =
      popover;

    const key =
      this.normalizeCitekey(
        paper.citekey
      );

    const header =
      popover.createDiv({
        cls:
          "rl-citation-popover-header",
      });

    header.createDiv({
      cls:
        "rl-citation-popover-title",
      text:
        "Cite paper",
    });

    header.createDiv({
      cls:
        "rl-citation-popover-path is-mono",
      text:
        key || "Missing citekey",
    });

    const list =
      popover.createDiv({
        cls:
          "rl-citation-menu",
      });

    this.citationMenuButton(
      list,
      {
        icon:
          "at-sign",
        title:
          "Copy Pandoc citation",
        description:
          key
            ? `[@${key}]`
            : "需要有效 Citekey",
        disabled:
          !this.validCitekey(
            key
          ),
        onClick:
          () =>
            this.copyCitationText(
              this.pandocCitation(
                paper
              ),
              "Pandoc citation"
            ),
      }
    );

    this.citationMenuButton(
      list,
      {
        icon:
          "key-round",
        title:
          "Copy @citekey",
        description:
          key
            ? `@${key}`
            : "需要有效 Citekey",
        disabled:
          !this.validCitekey(
            key
          ),
        onClick:
          () =>
            this.copyCitationText(
              `@${key}`,
              "@citekey"
            ),
      }
    );

    this.citationMenuButton(
      list,
      {
        icon:
          "text-quote",
        title:
          "Copy plain reference",
        description:
          this.plainCitation(
            paper
          ),
        onClick:
          () =>
            this.copyCitationText(
              this.plainCitation(
                paper
              ),
              "reference"
            ),
      }
    );

    if (
      this.isPreprintLikeMeta(
        this.paperAsMetadata(
          paper
        )
      )
    ) {
      this.citationMenuButton(
        list,
        {
          icon:
            "scan-search",
          title:
            "Resolve formal publication",
          description:
            "查找 conference / journal 正式发表版本",
          onClick:
            async () => {
              this.closePopover();
              await this.repairPaperPublication(
                paper,
                {
                  interactive: true,
                }
              );
            },
        }
      );
    }

    this.citationMenuButton(
      list,
      {
        icon:
          "braces",
        title:
          "Copy BibTeX",
        description:
          this.bibtexEntryType(
            paper
          ),
        disabled:
          !this.validCitekey(
            key
          ),
        onClick:
          () =>
            this.copyCitationText(
              this.bibtexForPaper(
                paper
              ),
              "BibTeX"
            ),
      }
    );
  }

  openBulkCitationPopover(
    anchor
  ) {
    this.closePopover();

    const papers =
      this.selectedPapers();

    const popover =
      this.createPopover(
        anchor,
        "rl-citation-popover rl-bulk-citation-popover"
      );

    this.activePopover =
      popover;

    const header =
      popover.createDiv({
        cls:
          "rl-bulk-citation-header",
      });

    header.createDiv({
      cls:
        "rl-citation-popover-title",
      text:
        `${papers.length} selected`,
    });

    const audit =
      this.renderCitationAudit(
        popover,
        papers
      );

    const list =
      popover.createDiv({
        cls:
          "rl-citation-menu rl-bulk-citation-menu",
      });

    this.citationMenuButton(
      list,
      {
        icon:
          "at-sign",
        title:
          "Copy citation",
        disabled:
          !papers.length
          || audit.blocking.length > 0,
        onClick:
          () =>
            this.copyCitationText(
              this.pandocCitation(
                papers
              ),
              "combined citation"
            ),
      }
    );

    this.citationMenuButton(
      list,
      {
        icon:
          "braces",
        title:
          "Copy BibTeX",
        disabled:
          !papers.length
          || audit.blocking.length > 0,
        onClick:
          () =>
            this.copyCitationText(
              papers.map(
                (paper) =>
                  this.bibtexForPaper(
                    paper
                  )
              ).join("\n\n"),
              "selected BibTeX"
            ),
      }
    );
  }

  openCitekeyEditor(
    anchor,
    paper
  ) {
    this.closePopover();

    const popover =
      this.createPopover(
        anchor,
        "rl-citekey-editor-popover"
      );

    this.activePopover =
      popover;

    popover.createDiv({
      cls:
        "rl-citation-popover-title",
      text:
        "Edit Citekey",
    });

    const input =
      popover.createEl(
        "input",
        {
          cls:
            "rl-citekey-editor-input",
          attr: {
            type:
              "text",
            spellcheck:
              "false",
            placeholder:
              "ilse2018attention",
          },
        }
      );

    input.value =
      paper.citekey || "";

    const hint =
      popover.createDiv({
        cls:
          "rl-citekey-editor-hint",
      });

    const updateHint =
      () => {
        const value =
          this.normalizeCitekey(
            input.value
          );

        if (!value) {
          hint.setText(
            "只能使用字母、数字、_、-"
          );

          hint.removeClass(
            "is-valid"
          );

          return;
        }

        if (
          !this.validCitekey(
            value
          )
        ) {
          hint.setText(
            "无效：只能使用字母、数字、_、-，并以字母或数字开头"
          );

          hint.removeClass(
            "is-valid"
          );

          return;
        }

        const collision =
          this.papers.find(
            (candidate) =>
              candidate !== paper
              && this.normalizeCitekey(
                candidate.citekey
              ).toLowerCase()
              === value.toLowerCase()
          );

        if (collision) {
          hint.setText(
            `已被使用：${collision.title}`
          );

          hint.removeClass(
            "is-valid"
          );

          return;
        }

        hint.setText(
          "Citekey 可用"
        );

        hint.addClass(
          "is-valid"
        );
      };

    input.addEventListener(
      "input",
      updateHint
    );

    updateHint();

    const footer =
      popover.createDiv({
        cls:
          "rl-citekey-editor-footer",
      });

    const generate =
      footer.createEl(
        "button",
        {
          text:
            "Generate",
          attr: {
            type:
              "button",
          },
        }
      );

    generate.addEventListener(
      "click",
      () => {
        input.value =
          this.makeUniqueCitekeyForPaper(
            this.suggestedCitekey(
              paper
            ),
            paper
          );

        updateHint();
        input.focus();
        input.select();
      }
    );

    const save =
      footer.createEl(
        "button",
        {
          cls:
            "mod-cta",
          text:
            "Save",
          attr: {
            type:
              "button",
          },
        }
      );

    const commit =
      async () => {
        const value =
          this.normalizeCitekey(
            input.value
          );

        save.disabled =
          true;

        generate.disabled =
          true;

        try {
          await this.renamePaperCitekey(
            paper,
            value
          );

          this.closePopover();

          new Notice(
            `Citekey 已更新：${value}`
          );
        }
        catch (error) {
          save.disabled =
            false;

          generate.disabled =
            false;

          new Notice(
            error?.message
            || "Citekey 更新失败",
            6000
          );

          input.focus();
        }
      };

    save.addEventListener(
      "click",
      () => {
        void commit();
      }
    );

    input.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "Escape"
        ) {
          event.preventDefault();
          this.closePopover();
          anchor.focus();
        }
        else if (
          event.key === "Enter"
        ) {
          event.preventDefault();
          void commit();
        }
      }
    );

    window.setTimeout(
      () => {
        input.focus();
        input.select();
      },
      0
    );
  }

  makeUniqueCitekeyForPaper(
    base,
    paper
  ) {
    const clean =
      this.normalizeCitekey(
        base
      );

    let key =
      clean || "paper";

    let index =
      0;

    const conflict =
      (candidate) =>
        this.papers.some(
          (item) =>
            item !== paper
            && this.normalizeCitekey(
              item.citekey
            ).toLowerCase()
              === candidate.toLowerCase()
        );

    while (
      conflict(key)
    ) {
      index += 1;

      key =
        `${clean || "paper"}${
          this.alphaSuffix(
            index
          )
        }`;
    }

    return key;
  }

  rewriteCitekeyInfoBlock(
    content,
    {
      citekey,
      pdfPath,
    }
  ) {
    let next =
      String(content || "");

    next =
      next.replace(
        /^> \*\*Citekey:\*\*.*$/m,
        `> **Citekey:** \`${citekey}\``
      );

    if (pdfPath) {
      next =
        next.replace(
          /^> \*\*PDF:\*\*.*$/m,
          `> **PDF:** [[${pdfPath}]]`
        );
    }

    return next;
  }

  async renamePaperCitekey(...args) {
    return this.withExclusiveWrite(
      "Citekey rename",
      () =>
        this._renamePaperCitekey(
          ...args
        )
    );
  }

  async _renamePaperCitekey(
    paper,
    requested
  ) {
    const next =
      this.normalizeCitekey(
        requested
      );

    if (!next) {
      throw new Error(
        "Citekey 不能为空。"
      );
    }

    if (
      !this.validCitekey(
        next
      )
    ) {
      throw new Error(
        "Citekey 只能使用字母、数字、_、-，并以字母或数字开头。"
      );
    }

    const oldKey =
      this.normalizeCitekey(
        paper.citekey
      );

    if (
      oldKey
      && oldKey.toLowerCase()
        === next.toLowerCase()
    ) {
      if (
        oldKey !== next
      ) {
        // Case-only changes still need an explicit YAML update.
      }
      else {
        return paper;
      }
    }

    const duplicate =
      this.papers.find(
        (candidate) =>
          candidate !== paper
          && this.normalizeCitekey(
            candidate.citekey
          ).toLowerCase()
            === next.toLowerCase()
      );

    if (duplicate) {
      throw new Error(
        `Citekey 已被使用：${duplicate.title}`
      );
    }

    const livePaperFile =
      this.liveTFile(
        paper?.file,
        {
          extension:
            "md",
          label:
            "Paper Note",
        }
      );

    paper.file =
      livePaperFile;

    const oldPaperPath =
      livePaperFile.path;

    const papersFolder =
      normalizePath(
        this.plugin.settings
          .papersFolder
      ).replace(/\/+$/, "");

    const shouldRenameNote =
      Boolean(oldKey)
      && paper.file.basename
        .toLowerCase()
        === oldKey.toLowerCase()
      && (
        !papersFolder
        || paper.file.parent?.path
          === papersFolder
      );

    const newPaperPath =
      shouldRenameNote
        ? `${papersFolder}/${next}.md`
        : oldPaperPath;

    if (
      shouldRenameNote
    ) {
      const collision =
        this.app.vault
          .getAbstractFileByPath(
            newPaperPath
          );

      if (
        collision
        && collision !== paper.file
      ) {
        throw new Error(
          `Paper Note 文件名已存在：${next}.md`
        );
      }
    }

    const oldPdfPath =
      paper.pdf || "";

    const pdfFile =
      oldPdfPath
        ? this.resolveVaultFile(
            oldPdfPath,
            paper.file.path
          )
        : null;

    const pdfFolder =
      normalizePath(
        this.plugin.settings
          .pdfFolder
      ).replace(/\/+$/, "");

    const shouldRenamePdf =
      Boolean(
        oldKey
        && pdfFile instanceof TFile
        && pdfFile.extension
          ?.toLowerCase()
          === "pdf"
        && pdfFile.basename
          .toLowerCase()
          === oldKey.toLowerCase()
        && (
          !pdfFolder
          || pdfFile.parent?.path
            === pdfFolder
        )
      );

    const newPdfPath =
      shouldRenamePdf
        ? `${pdfFolder}/${next}.pdf`
        : oldPdfPath;

    if (
      shouldRenamePdf
    ) {
      const collision =
        this.app.vault
          .getAbstractFileByPath(
            newPdfPath
          );

      if (
        collision
        && collision !== pdfFile
      ) {
        throw new Error(
          `PDF 文件名已存在：${next}.pdf`
        );
      }
    }

    const originalContent =
      await this.app.vault
        .cachedRead(
          paper.file
        );

    let pdfRenamed =
      false;

    let noteRenamed =
      false;

    const wasSelected =
      this.selectedPaths.has(
        oldPaperPath
      );

    this.suppressRefreshUntil =
      Date.now() + 5000;

    try {
      if (shouldRenamePdf) {
        await this.app.fileManager
          .renameFile(
            pdfFile,
            newPdfPath
          );

        pdfRenamed =
          true;
      }

      if (shouldRenameNote) {
        await this.app.fileManager
          .renameFile(
            paper.file,
            newPaperPath
          );

        noteRenamed =
          true;
      }

      await this.app.fileManager
        .processFrontMatter(
          paper.file,
          (fm) => {
            fm.citekey =
              next;

            if (
              shouldRenamePdf
            ) {
              fm.pdf =
                `[[${newPdfPath}]]`;
            }
          }
        );

      const afterFrontmatter =
        await this.app.vault
          .cachedRead(
            paper.file
          );

      const rewritten =
        this.rewriteCitekeyInfoBlock(
          afterFrontmatter,
          {
            citekey:
              next,
            pdfPath:
              shouldRenamePdf
                ? newPdfPath
                : oldPdfPath,
          }
        );

      if (
        rewritten !== afterFrontmatter
      ) {
        await this.app.vault
          .modify(
            paper.file,
            rewritten
          );
      }
    }
    catch (error) {
      const rollbackErrors =
        [];

      try {
        if (noteRenamed) {
          await this.app.fileManager
            .renameFile(
              paper.file,
              oldPaperPath
            );
        }
      }
      catch (rollbackError) {
        rollbackErrors.push(
          rollbackError
        );
      }

      try {
        await this.app.vault
          .modify(
            paper.file,
            originalContent
          );
      }
      catch (rollbackError) {
        rollbackErrors.push(
          rollbackError
        );
      }

      try {
        if (pdfRenamed) {
          const movedPdf =
            this.app.vault
              .getAbstractFileByPath(
                newPdfPath
              );

          if (
            movedPdf instanceof TFile
          ) {
            await this.app.fileManager
              .renameFile(
                movedPdf,
                oldPdfPath
              );
          }
        }
      }
      catch (rollbackError) {
        rollbackErrors.push(
          rollbackError
        );
      }

      console.error(
        "Research Library: citekey rename rolled back",
        {
          oldKey,
          newKey:
            next,
          cause:
            error,
          rollbackErrors,
        }
      );

      throw new Error(
        rollbackErrors.length
          ? `Citekey 更新失败；已尝试回滚，但有 ${rollbackErrors.length} 项需要检查。`
          : "Citekey 更新失败，已恢复原状态。"
      );
    }

    paper.citekey =
      next;

    if (
      shouldRenamePdf
    ) {
      paper.pdf =
        newPdfPath;
    }

    if (wasSelected) {
      this.selectedPaths.delete(
        oldPaperPath
      );

      this.selectedPaths.add(
        paper.file.path
      );
    }

    if (
      this.lastSelectedPath
      === oldPaperPath
    ) {
      this.lastSelectedPath =
        paper.file.path;
    }

    if (
      this.detailPaperPath
      === oldPaperPath
    ) {
      this.detailPaperPath =
        paper.file.path;
    }

    if (
      this.plugin.settings
        .detailLastPaperPath
      === oldPaperPath
    ) {
      this.plugin.settings
        .detailLastPaperPath =
        paper.file.path;

      await this.plugin
        .saveSettings();
    }

    this.renderCollectionSurface();

    await this.syncBibliographyIfEnabled();

    if (
      this.detailPaperPath
      === paper.file.path
    ) {
      await this.renderPaperDetail(
        paper
      );
    }

    return paper;
  }

  makeCitekey(meta) {
    return (
      `${
        this.slug(
          meta.firstAuthorFamily
        )
        || "anon"
      }${
        meta.year
        || "nd"
      }${
        this.firstTitleWord(
          meta.title
        )
        || "work"
      }`
    );
  }

  firstTitleWord(title) {
    const stop =
      new Set([
        "a",
        "an",
        "the",
        "of",
        "on",
        "in",
        "for",
        "to",
        "and",
        "or",
        "with",
        "from",
        "by",
        "via",
        "using",
        "toward",
        "towards",
        "through",
        "into",
        "is",
        "are",
        "be",
        "as",
        "at",
      ]);

    const words =
      String(title || "")
        .normalize("NFKD")
        .replace(
          /\p{M}/gu,
          ""
        )
        .toLowerCase()
        .match(
          /[\p{L}\p{N}]+/gu
        )
      ||
      [];

    const word =
      words.find(
        (value) =>
          value.length > 2
          && !stop.has(value)
      )
      ||
      words[0]
      ||
      "work";

    return this.slug(
      word
    );
  }

  slug(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(
        /[^\p{L}\p{N}]+/gu,
        ""
      );
  }

  makeUniqueCitekey(base) {
    let key = base;
    let index = 0;

    while (
      this.app.vault
        .getAbstractFileByPath(
          `${this.plugin.settings.papersFolder}/${key}.md`
        )
      ||
      this.app.vault
        .getAbstractFileByPath(
          `${this.plugin.settings.pdfFolder}/${key}.pdf`
        )
    ) {
      index += 1;

      key =
        `${base}${
          this.alphaSuffix(
            index
          )
        }`;
    }

    return key;
  }

  alphaSuffix(number) {
    let result = "";
    let value = number;

    while (value > 0) {
      value -= 1;

      result =
        String.fromCharCode(
          97 + (value % 26)
        )
        +
        result;

      value =
        Math.floor(
          value / 26
        );
    }

    return result;
  }

  renderImportedPaper({
    meta,
    citekey,
    pdfPath,
    date,
    originalFilename,
    matchMethod,
  }) {
    const provenance =
      this.importProvenance(
        meta,
        matchMethod
      );

    return `---
schema: "paper/v2"
type: paper
citekey: ${this.yaml(citekey)}
title: ${this.yaml(meta.title)}
${this.yamlList("authors", meta.authors)}
year: ${meta.year || ""}
venue: ${this.yaml(meta.venue)}
publisher: ${this.yaml(meta.publisher)}
work_type: ${this.yaml(meta.workType)}
volume: ${this.yaml(meta.volume)}
issue: ${this.yaml(meta.issue)}
pages: ${this.yaml(meta.pages)}
doi: ${this.yaml(meta.doi)}
arxiv: ${this.yaml(meta.arxiv)}
url: ${this.yaml(meta.url)}
pdf: ${this.yaml(`[[${pdfPath}]]`)}
status: inbox
priority: ${Number(this.plugin.settings.defaultPriority) || 3}
rating:
${this.yamlList("keywords", meta.keywords)}
topics: []
collections: []
projects: []
date_added: ${date}
date_started:
date_read:
metadata_source: ${this.yaml(provenance.source)}
${this.yamlList("metadata_sources", provenance.sources)}
import_method: ${this.yaml(provenance.importMethod)}
metadata_verified: ${provenance.verified ? "true" : "false"}
metadata_match: ${this.yaml(matchMethod)}
metadata_updated: ${date}
publication_status: ${this.yaml(this.publicationStatus(meta))}
publication_resolution: ${this.yaml(meta?._publicationResolution?.kind || "")}
publication_updated: ${meta?._publicationResolution ? date : ""}
original_pdf_filename: ${this.yaml(originalFilename)}
---

# ${meta.title}

> [!info]- 文献信息
> **Citekey:** \`${citekey}\`
> **PDF:** [[${pdfPath}]]
${meta.doi ? `> **DOI:** [${meta.doi}](https://doi.org/${meta.doi})` : ""}
${meta.arxiv ? `> **arXiv:** ${meta.arxiv}` : ""}

## TL;DR


## 研究问题


## 核心贡献


## 方法


## 实验与结果


## 局限


## 阅读笔记


## 关键摘录


## 关联


## 研究想法

`;
  }

  yamlList(
    key,
    values = []
  ) {
    const items =
      [...new Set(
        (values || [])
          .map(
            (value) =>
              this.cleanText(value)
          )
          .filter(Boolean)
      )];

    return items.length
      ? `${key}:\n${
          items
            .map(
              (value) =>
                `  - ${
                  this.yaml(value)
                }`
            )
            .join("\n")
        }`
      : `${key}: []`;
  }

  yaml(value) {
    return JSON.stringify(
      String(
        value ?? ""
      )
    );
  }

  cleanText(value) {
    return this
      .normalizeWhitespace(
        String(value ?? "")
          .replace(
            /<[^>]+>/g,
            " "
          )
          .replace(
            /&amp;/g,
            "&"
          )
          .replace(
            /&lt;/g,
            "<"
          )
          .replace(
            /&gt;/g,
            ">"
          )
      );
  }

  cleanMeta(value) {
    return this
      .normalizeWhitespace(
        Array.isArray(value)
          ? value.join(", ")
          : String(value || "")
      );
  }

  splitKeywords(value) {
    const source =
      this.cleanMeta(value);

    return source
      ? source
          .split(/[;,|]/)
          .map(
            (item) =>
              item.trim()
          )
          .filter(Boolean)
      : [];
  }

  normalizeWhitespace(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  normalizeTitle(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/\p{M}/gu, " ")
      .toLowerCase()
      .replace(
        /[^\p{L}\p{N}]+/gu,
        " "
      )
      .replace(/\s+/g, " ")
      .trim();
  }

  familyFromName(name) {
    if (!name) return "";

    if (
      String(name)
        .includes(",")
    ) {
      return String(name)
        .split(",")[0]
        .trim();
    }

    const parts =
      String(name)
        .trim()
        .split(/\s+/);

    return parts[
      parts.length - 1
    ] || "";
  }

  yearFromDate(value) {
    const match =
      String(value || "")
        .match(/^(\d{4})/);

    return match
      ? Number(match[1])
      : "";
  }

  yearFromPdfDate(value) {
    const match =
      String(value || "")
        .match(
          /(?:D:)?(\d{4})/
        );

    return match
      ? Number(match[1])
      : "";
  }

  crossrefYear(message) {
    for (
      const field
      of [
        "published-print",
        "published-online",
        "published",
        "issued",
        "created",
      ]
    ) {
      const year =
        message
          ?.[field]
          ?.["date-parts"]
          ?.[0]
          ?.[0];

      if (year) {
        return year;
      }
    }

    return "";
  }

  arxivFromDoi(doi) {
    const match =
      String(doi || "")
        .match(
          /^10\.48550\/arxiv\.(.+)$/i
        );

    return match
      ? match[1]
      : "";
  }

  encodeDoiPath(doi) {
    return String(doi || "")
      .split("/")
      .map(
        encodeURIComponent
      )
      .join("/");
  }

  async ensureFolder(path) {
    let current = "";

    for (
      const part
      of String(path || "")
        .split("/")
        .filter(Boolean)
    ) {
      current =
        current
          ? `${current}/${part}`
          : part;

      if (
        !this.app.vault
          .getAbstractFileByPath(
            current
          )
      ) {
        await this.app.vault
          .createFolder(
            current
          );
      }
    }
  }


  builtInViews() {
    return [
      ["all", "table-properties", "总表"],
      ["gallery", "images", "图集"],
      ["done", "square-check-big", "已完成"],
      ["recent", "calendar-range", "近三年论文"],
      ["doing", "pencil-line", "进行中"],
      // Internal id stays "inbox" so existing Saved Views
      // and persisted UI state continue to work.
      ["inbox", "layers-2", "待整理"],
    ];
  }

  renderTabs() {
    if (!this.tabsEl) return;

    this.tabsEl.empty();

    for (const [id, icon, label] of this.builtInViews()) {
      const button = this.tabsEl.createEl("button", {
        cls:
          "rl-tab" +
          (
            !this.activeSavedViewId && this.view === id
              ? " is-active"
              : ""
          ),
        attr: {
          type: "button",
          "data-view": id,
          title:
            id === "inbox"
              ? "待整理：论文工作流状态（status: inbox），不是 Research/00 Inbox PDF 文件夹"
              : label,
        },
      });

      this.createIcon(button, icon, "rl-tab-icon");
      button.createSpan({ text: label });

      button.addEventListener("click", () => {
        this.activeSavedViewId = null;
        this.view = id;
        this.render();
      });
    }

    for (const saved of this.plugin.settings.savedViews || []) {
      const button = this.tabsEl.createEl("button", {
        cls:
          "rl-tab rl-tab-custom" +
          (
            this.activeSavedViewId === saved.id
              ? " is-active"
              : ""
          ),
        attr: {
          type: "button",
          "data-saved-id": saved.id,
          title: "右键可更新或删除 View",
        },
      });

      this.createIcon(button, "bookmark", "rl-tab-icon");
      button.createSpan({
        cls: "rl-custom-view-label",
        text: saved.name,
      });

      button.addEventListener("click", async () => {
        await this.loadSavedView(saved);
      });

      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openSavedViewMenu(event, saved);
      });
    }

    const plus = this.tabsEl.createEl("button", {
      cls: "rl-tab rl-tab-plus",
      attr: {
        type: "button",
        "aria-label": "Save current view",
        title: "保存当前 View",
      },
    });

    this.createIcon(plus, "plus", "rl-tab-plus-icon");

    plus.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      this.openSaveViewPopover(plus);
    });
  }

  currentViewSnapshot(name, id = null) {
    return {
      id:
        id
        || `view-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,

      name,

      baseView: this.view,
      statusFilter: this.statusFilter,
      ratingFilter: this.ratingFilter,
      topicFilter: this.topicFilter,
      collectionFilter: this.collectionFilter,
      projectFilter: this.projectFilter,

      sortField: this.sortField,
      sortDir: this.sortDir,

      columns: Object.assign(
        {},
        this.plugin.settings.columns
      ),

      columnWidths: Object.assign(
        {},
        this.plugin.settings.columnWidths
      ),

      density:
        this.plugin.settings.density
        || "comfortable",
    };
  }

  async loadSavedView(saved) {
    this.activeSavedViewId = saved.id;

    this.view = saved.baseView || "all";
    this.statusFilter = saved.statusFilter || "all";
    this.ratingFilter = Number(saved.ratingFilter) || 0;
    this.topicFilter = saved.topicFilter || "";
    this.collectionFilter = saved.collectionFilter || "";
    this.projectFilter = saved.projectFilter || "";

    this.sortField = saved.sortField || "edited";
    this.sortDir = saved.sortDir || "desc";

    this.plugin.settings.columns =
      Object.assign(
        {},
        DEFAULT_COLUMNS,
        saved.columns || {}
      );

    this.plugin.settings.columnWidths =
      Object.assign(
        {},
        DEFAULT_WIDTHS,
        saved.columnWidths || {}
      );

    this.plugin.settings.density =
      saved.density || "comfortable";

    this.rootEl.dataset.density =
      this.plugin.settings.density;

    await this.plugin.saveSettings();

    this.render();
  }

  openSaveViewPopover(anchor) {
    this.closePopover();

    const popover =
      this.createPopover(
        anchor,
        "rl-save-view-popover"
      );

    this.activePopover = popover;

    popover.createDiv({
      cls: "rl-popover-title",
      text: "Save current view",
    });

    const input =
      popover.createEl("input", {
        cls: "rl-view-name-input",
        attr: {
          type: "text",
          placeholder: "例如：MIL / 高评分 / 2026",
        },
      });

    const actions =
      popover.createDiv({
        cls: "rl-view-save-actions",
      });

    const save =
      actions.createEl("button", {
        cls: "rl-view-save-button mod-cta",
        text: "Save",
        attr: {
          type: "button",
        },
      });

    const submit = async () => {
      const name =
        input.value.trim();

      if (!name) {
        input.focus();
        return;
      }

      const saved =
        this.currentViewSnapshot(name);

      this.plugin.settings.savedViews.push(saved);

      await this.plugin.saveSettings();

      this.closePopover();

      await this.loadSavedView(saved);
    };

    save.addEventListener("click", submit);

    input.addEventListener("keydown", async (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        await submit();
      }
      else if (event.key === "Escape") {
        event.preventDefault();
        this.closePopover();
      }
    });

    window.setTimeout(
      () => input.focus(),
      0
    );
  }

  openSavedViewMenu(event, saved) {
    const menu = new Menu();

    menu.addItem((item) => {
      item
        .setTitle("Update from current")
        .setIcon("save")
        .onClick(async () => {
          const index =
            this.plugin.settings.savedViews
              .findIndex((view) => view.id === saved.id);

          if (index < 0) return;

          this.plugin.settings.savedViews[index] =
            this.currentViewSnapshot(
              saved.name,
              saved.id
            );

          await this.plugin.saveSettings();

          this.activeSavedViewId =
            saved.id;

          this.renderTabs();
        });
    });

    menu.addItem((item) => {
      item
        .setTitle("Duplicate view")
        .setIcon("copy")
        .onClick(async () => {
          const copy =
            this.currentViewSnapshot(
              `${saved.name} copy`
            );

          copy.baseView =
            saved.baseView || "all";
          copy.statusFilter =
            saved.statusFilter || "all";
          copy.ratingFilter =
            Number(saved.ratingFilter) || 0;
          copy.topicFilter =
            saved.topicFilter || "";
          copy.collectionFilter =
            saved.collectionFilter || "";
          copy.projectFilter =
            saved.projectFilter || "";
          copy.sortField =
            saved.sortField || "edited";
          copy.sortDir =
            saved.sortDir || "desc";
          copy.columns =
            Object.assign({}, saved.columns || {});
          copy.columnWidths =
            Object.assign({}, saved.columnWidths || {});
          copy.density =
            saved.density || "comfortable";

          this.plugin.settings.savedViews.push(copy);

          await this.plugin.saveSettings();

          this.renderTabs();
        });
    });

    menu.addSeparator();

    menu.addItem((item) => {
      item
        .setTitle("Delete view")
        .setIcon("trash-2")
        .onClick(async () => {
          this.plugin.settings.savedViews =
            this.plugin.settings.savedViews
              .filter((view) => view.id !== saved.id);

          if (
            this.activeSavedViewId === saved.id
          ) {
            this.activeSavedViewId = null;
            this.view = "all";
          }

          await this.plugin.saveSettings();

          this.render();
        });
    });

    menu.showAtMouseEvent(event);
  }

  createIcon(parent, iconName, className = "") {
    const holder = parent.createSpan({
      cls: className,
    });

    setIcon(holder, iconName);

    return holder;
  }

  toolbarButton(parent, iconName, text, title) {
    const button = parent.createEl("button", {
      cls: "rl-toolbar-chip",
      attr: { type: "button", title },
    });

    this.createIcon(
      button,
      iconName,
      "rl-toolbar-chip-icon"
    );

    button.createSpan({
      cls: "rl-toolbar-chip-label",
      text,
    });

    return button;
  }

  applyAppearanceSettings() {
    if (!this.rootEl) return;

    const source =
      String(
        this.plugin.settings.fontSource
        || "obsidian-interface"
      );

    let family =
      "var(--font-interface)";

    if (source === "obsidian-text") {
      family = "var(--font-text)";
    }
    else if (source === "obsidian-monospace") {
      family = "var(--font-monospace)";
    }
    else if (source.startsWith("system:")) {
      const systemFamily =
        source.slice("system:".length).trim();

      if (systemFamily) {
        family =
          `"${systemFamily.replace(/"/g, '\\"')}", sans-serif`;
      }
    }

    const size = Math.max(
      10,
      Math.min(
        20,
        Number(this.plugin.settings.fontSize) || 13
      )
    );

    this.rootEl.style.setProperty(
      "--rl-font-family",
      family
    );

    this.rootEl.style.setProperty(
      "--rl-font-size",
      `${size}px`
    );
  }

  updateDensityButton() {
    if (!this.densityButton) return;

    const compact = this.plugin.settings.density === "compact";
    this.densityButton.setText(compact ? "Compact" : "Comfortable");
  }

  visibleColumnKeys() {
    return Object.keys(COLUMN_META).filter(
      (key) => this.plugin.settings.columns[key] !== false
    );
  }

  topicColorIndex(topic) {
    const value =
      String(topic || "");

    let hash = 2166136261;

    for (
      let index = 0;
      index < value.length;
      index++
    ) {
      hash ^= value.charCodeAt(index);

      hash =
        Math.imul(
          hash,
          16777619
        );
    }

    return Math.abs(hash) % 8;
  }

  applyTopicColor(element, topic) {
    if (!element) return;

    element.addClass(
      `rl-topic-color-${this.topicColorIndex(topic)}`
    );
  }

  createSelectionButton(
    parent,
    {
      checked = false,
      indeterminate = false,
      ariaLabel = "Select",
      onClick,
    } = {}
  ) {
    const button =
      parent.createEl("button", {
        cls:
          "rl-select-button"
          + (
            checked
              ? " is-checked"
              : ""
          )
          + (
            indeterminate
              ? " is-indeterminate"
              : ""
          ),
        attr: {
          type: "button",
          "aria-label": ariaLabel,
          "aria-pressed":
            checked
              ? "true"
              : "false",
        },
      });

    if (checked) {
      this.createIcon(
        button,
        "check",
        "rl-select-button-icon"
      );
    }
    else if (indeterminate) {
      this.createIcon(
        button,
        "minus",
        "rl-select-button-icon"
      );
    }

    button.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        onClick?.(event);
      }
    );

    return button;
  }

  gridTemplate() {
    const paperColumns =
      this.visibleColumnKeys()
        .map((key) => {
        const width =
          Number(this.plugin.settings.columnWidths[key])
          || DEFAULT_WIDTHS[key];

          return `${Math.round(width)}px`;
        })
        .join(" ");

    return `36px ${paperColumns}`;
  }

  totalVisibleWidth() {
    return 36 + this.visibleColumnKeys()
      .reduce((sum, key) => {
        const width =
          Number(this.plugin.settings.columnWidths[key])
          || DEFAULT_WIDTHS[key];

        return sum + Math.round(width);
      }, 0);
  }

  applyGridTemplate() {
    const template = this.gridTemplate();
    const total = this.totalVisibleWidth();

    this.tableEl?.style.setProperty("--rl-grid", template);
    this.tableEl?.style.setProperty("--rl-table-width", `${total}px`);
  }

  renderHeader() {
    this.headEl.empty();
    this.applyGridTemplate();

    const keys = this.visibleColumnKeys();

    const selectCell =
      this.headEl.createDiv({
        cls: "rl-col-select",
      });

    const visible =
      this.visiblePapers();

    const selectedVisible =
      visible.filter(
        (paper) =>
          this.selectedPaths.has(
            paper.file.path
          )
      ).length;

    const allSelected =
      visible.length > 0
      && selectedVisible === visible.length;

    const partiallySelected =
      selectedVisible > 0
      && selectedVisible < visible.length;

    this.createSelectionButton(
      selectCell,
      {
        checked: allSelected,
        indeterminate:
          partiallySelected,
        ariaLabel:
          "选择当前可见论文",
        onClick: () => {
          if (allSelected) {
            for (const paper of visible) {
              this.selectedPaths.delete(
                paper.file.path
              );
            }
          }
          else {
            for (const paper of visible) {
              this.selectedPaths.add(
                paper.file.path
              );
            }
          }

          this.refreshSelectionDom();
          this.renderHeader();
        },
      }
    );

    keys.forEach((key, index) => {
      const meta = COLUMN_META[key];

      const cell = this.headEl.createDiv({ cls: meta.cls });
      cell.dataset.column = key;

      this.createIcon(
        cell,
        meta.icon,
        "rl-header-icon"
      );

      cell.createSpan({
        cls: "rl-header-label",
        text: meta.label,
      });

      if (index < keys.length - 1) {
        const handle = cell.createDiv({ cls: "rl-resize-handle" });

        handle.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.beginResize(event, key, handle);
        });

        handle.addEventListener("dblclick", async (event) => {
          event.preventDefault();
          event.stopPropagation();

          this.plugin.settings.columnWidths[key] =
            DEFAULT_WIDTHS[key];

          this.applyGridTemplate();
          await this.plugin.saveSettings();
        });
      }
    });
  }

  beginResize(event, key, handle) {
    if (event.button !== 0) return;

    const pointerId = event.pointerId;
    const startX = event.clientX;

    const startWidth =
      Number(this.plugin.settings.columnWidths[key])
      || DEFAULT_WIDTHS[key];

    const limits = {
      name:    [220, 1000],
      year:    [60, 180],
      venue:   [90, 520],
      authors: [90, 520],
      status:  [105, 220],
      rating:  [105, 240],
      topics:  [100, 600],
      note:    [120, 720],
      collections: [100, 600],
      projects: [100, 600],
      doi:     [80, 360],
      pdf:     [58, 160],
      edited:  [110, 320],
    };

    const [minWidth, maxWidth] =
      limits[key] || [60, 500];

    let latestWidth = startWidth;
    let raf = 0;

    document.body.addClass("rl-is-resizing");
    handle.addClass("is-resizing");

    try {
      handle.setPointerCapture(pointerId);
    } catch (_) {}

    const apply = () => {
      raf = 0;

      this.plugin.settings.columnWidths[key] =
        Math.round(latestWidth);

      this.applyGridTemplate();
    };

    const onMove = (e) => {
      if (e.pointerId !== pointerId) return;

      const delta = e.clientX - startX;

      latestWidth = Math.max(
        minWidth,
        Math.min(
          maxWidth,
          startWidth + delta
        )
      );

      if (!raf) {
        raf = window.requestAnimationFrame(apply);
      }
    };

    const finish = async (e) => {
      if (e.pointerId !== pointerId) return;

      if (raf) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }

      this.plugin.settings.columnWidths[key] =
        Math.round(latestWidth);

      this.applyGridTemplate();

      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);

      try {
        if (handle.hasPointerCapture(pointerId)) {
          handle.releasePointerCapture(pointerId);
        }
      } catch (_) {}

      handle.removeClass("is-resizing");
      document.body.removeClass("rl-is-resizing");

      await this.plugin.saveSettings();
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }

  paperFileSignature(
    file
  ) {
    return [
      Number(
        file?.stat?.mtime
        || 0
      ),
      Number(
        file?.stat?.size
        || 0
      ),
    ].join(":");
  }

  scanPaperIndex({
    force = false,
  } = {}) {
    const prefix =
      this.papersFolderPrefix();

    const files =
      this.app.vault
        .getMarkdownFiles()
        .filter(
          (file) =>
            !prefix
            || file.path.startsWith(
              prefix
            )
        );

    const nextPapers =
      [];

    const livePaperPaths =
      new Set();

    let parsed =
      0;

    let reused =
      0;

    let changed =
      !this.paperIndexReady;

    for (
      const file
      of files
    ) {
      const cache =
        this.app.metadataCache
          .getFileCache(
            file
          );

      const fm =
        cache?.frontmatter;

      if (
        !fm
        || String(
          fm.type || ""
        ).toLowerCase()
          !== "paper"
      ) {
        if (
          this.paperCache.delete(
            file.path
          )
        ) {
          changed =
            true;
        }

        continue;
      }

      livePaperPaths.add(
        file.path
      );

      const signature =
        this.paperFileSignature(
          file
        );

      const cached =
        this.paperCache.get(
          file.path
        );

      if (
        !force
        && cached
        && cached.signature
          === signature
      ) {
        cached.paper.file =
          file;

        cached.paper.mtime =
          file.stat.mtime;

        nextPapers.push(
          cached.paper
        );

        reused += 1;

        continue;
      }

      const paper =
        this.paperFromFile(
          file,
          fm
        );

      this.paperCache.set(
        file.path,
        {
          signature,
          paper,
        }
      );

      nextPapers.push(
        paper
      );

      parsed += 1;
      changed =
        true;
    }

    for (
      const path
      of [
        ...this.paperCache.keys(),
      ]
    ) {
      if (
        !livePaperPaths.has(
          path
        )
      ) {
        this.paperCache.delete(
          path
        );

        changed =
          true;
      }
    }

    if (
      !changed
      && this.papers.length
        !== nextPapers.length
    ) {
      changed =
        true;
    }

    if (!changed) {
      for (
        let index = 0;
        index < nextPapers.length;
        index += 1
      ) {
        if (
          this.papers[index]
            ?.file?.path
          !== nextPapers[index]
            ?.file?.path
        ) {
          changed =
            true;

          break;
        }
      }
    }

    this.papers =
      nextPapers;

    this.paperIndexReady =
      true;

    if (changed) {
      this.paperRevision += 1;

      this.visiblePapersCache = {
        key:
          "",
        papers:
          [],
      };
    }

    this.lastLoadStats = {
      total:
        nextPapers.length,
      parsed,
      reused,
      changed,
    };

    return this.lastLoadStats;
  }

  async loadPapers({
    force = false,
    syncBibliography = true,
  } = {}) {
    const result =
      this.scanPaperIndex({
        force,
      });

    if (
      syncBibliography
      && (
        result.changed
        || force
      )
      && this.plugin.settings
        .autoSyncBibliography
    ) {
      try {
        await this.syncBibliography({
          notice: false,
        });
      }
      catch (error) {
        this.lastBibliographyError =
          error?.message
          || String(error);

        console.debug(
          "Research Library: automatic bibliography sync skipped",
          error
        );
      }
    }

    return result;
  }
  paperFromFile(file, fm) {
    return {
      file,
      schema: this.plain(fm.schema),
      rawStatus: this.plain(fm.status),
      citekey: this.plain(fm.citekey),
      title: this.plain(fm.title) || file.basename,
      alias: this.plain(fm.alias),
      note: this.plain(fm.note),
      authors: this.asArray(fm.authors).map((x) => this.displayValue(x)).filter(Boolean),
      year: this.plain(fm.year),
      venue: this.plain(fm.venue),
      status: this.normalizeStatus(fm.status),
      rating: Number(fm.rating) || 0,
      topics: this.asArray(fm.topics).map((x) => this.displayValue(x)).filter(Boolean),
      figures:
        this.asArray(
          fm.figures
          ?? fm.figure
        )
          .map(
            (value) =>
              this.linkPath(
                value
              )
          )
          .filter(Boolean),
      doi: this.normalizeDoi(fm.doi),
      arxiv: this.plain(fm.arxiv),
      url: this.plain(fm.url),
      pdf: this.linkPath(fm.pdf),
      publisher: this.plain(fm.publisher),
      workType: this.plain(fm.work_type),
      volume: this.plain(fm.volume),
      issue: this.plain(fm.issue),
      pages: this.plain(fm.pages),
      priority: Number(fm.priority) || 0,
      collections:
        this.asArray(fm.collections)
          .map((x) =>
            this.displayValue(x)
          )
          .filter(Boolean),
      projects:
        this.asArray(fm.projects)
          .map((x) =>
            this.displayValue(x)
          )
          .filter(Boolean),
      keywords:
        this.asArray(fm.keywords)
          .map((x) =>
            this.displayValue(x)
          )
          .filter(Boolean),
      abstract:
        this.plain(fm.abstract),
      dateAdded:
        this.plain(fm.date_added),
      dateStarted:
        this.plain(fm.date_started),
      dateRead:
        this.plain(fm.date_read),
      metadataSource:
        this.plain(fm.metadata_source),
      metadataSources:
        this.asArray(fm.metadata_sources)
          .map((x) =>
            this.displayValue(x)
          )
          .filter(Boolean),
      importMethod:
        this.plain(fm.import_method),
      metadataMatch:
        this.plain(fm.metadata_match),
      metadataUpdated:
        this.plain(fm.metadata_updated),
      publicationStatus:
        this.plain(fm.publication_status),
      publicationResolution:
        this.plain(fm.publication_resolution),
      publicationUpdated:
        this.plain(fm.publication_updated),
      metadataVerified:
        fm.metadata_verified === true
        || String(
          fm.metadata_verified
          || ""
        ).toLowerCase()
          === "true",
      mtime: file.stat.mtime,
    };
  }

  visiblePapers({
    fresh = false,
  } = {}) {
    const currentYear =
      new Date()
        .getFullYear();

    const query =
      this.query;

    const topicFilter =
      this.topicFilter
        .toLowerCase();

    const collectionFilter =
      this.collectionFilter
        .toLowerCase();

    const projectFilter =
      this.projectFilter
        .toLowerCase();

    const cacheKey =
      [
        this.paperRevision,
        this.view,
        query,
        this.sortField,
        this.sortDir,
        this.statusFilter,
        this.ratingFilter,
        topicFilter,
        collectionFilter,
        projectFilter,
        currentYear,
      ].join("|");

    if (
      !fresh
      && this.visiblePapersCache
        .key === cacheKey
    ) {
      return this.visiblePapersCache
        .papers;
    }

    let result =
      this.papers.filter(
        (paper) => {
          if (
            this.view === "done"
            && paper.status
              !== "read"
          ) {
            return false;
          }

          if (
            this.view === "doing"
            && paper.status
              !== "reading"
          ) {
            return false;
          }

          if (
            this.view === "inbox"
            && paper.status
              !== "inbox"
          ) {
            return false;
          }

          if (
            this.view === "recent"
          ) {
            const year =
              Number(
                paper.year
              ) || 0;

            if (
              year
              < currentYear - 2
            ) {
              return false;
            }
          }

          if (
            this.statusFilter
              !== "all"
            && paper.status
              !== this.statusFilter
          ) {
            return false;
          }

          if (
            paper.rating
            < this.ratingFilter
          ) {
            return false;
          }

          if (
            topicFilter
            && !paper.topics
              .some(
                (topic) =>
                  topic
                    .toLowerCase()
                    === topicFilter
              )
          ) {
            return false;
          }

          if (
            collectionFilter
            && !paper.collections
              .some(
                (collection) =>
                  collection
                    .toLowerCase()
                    === collectionFilter
              )
          ) {
            return false;
          }

          if (
            projectFilter
            && !paper.projects
              .some(
                (project) =>
                  project
                    .toLowerCase()
                    === projectFilter
              )
          ) {
            return false;
          }

          if (query) {
            const searchSignature =
              [
                paper.title,
                paper.alias,
                paper.note,
                paper.citekey,
                paper.authors.join(
                  "\u001f"
                ),
                paper.year,
                paper.venue,
                paper.topics.join(
                  "\u001f"
                ),
                paper.collections.join(
                  "\u001f"
                ),
                paper.projects.join(
                  "\u001f"
                ),
                paper.doi,
              ].join(
                "\u001e"
              );

            if (
              paper
                ._rlSearchSignature
              !== searchSignature
            ) {
              paper
                ._rlSearchSignature =
                searchSignature;

              paper._rlSearchText =
                searchSignature
                  .replace(
                    /[\u001e\u001f]/g,
                    " "
                  )
                  .toLowerCase();
            }

            if (
              !paper._rlSearchText
                .includes(
                  query
                )
            ) {
              return false;
            }
          }

          return true;
        }
      );

    result.sort(
      (a, b) => {
        let left;
        let right;

        switch (
          this.sortField
        ) {
          case "title":
            left =
              a._rlSortTitle
              || (
                a._rlSortTitle =
                  a.title
                    .toLowerCase()
              );

            right =
              b._rlSortTitle
              || (
                b._rlSortTitle =
                  b.title
                    .toLowerCase()
              );

            break;

          case "year":
            left =
              Number(
                a.year
              ) || 0;

            right =
              Number(
                b.year
              ) || 0;

            break;

          case "rating":
            left =
              a.rating;

            right =
              b.rating;

            break;

          case "status":
            left =
              a.status;

            right =
              b.status;

            break;

          case "edited":
          default:
            left =
              a.mtime;

            right =
              b.mtime;
        }

        if (
          left < right
        ) {
          return this.sortDir
            === "asc"
              ? -1
              : 1;
        }

        if (
          left > right
        ) {
          return this.sortDir
            === "asc"
              ? 1
              : -1;
        }

        return 0;
      }
    );

    this.visiblePapersCache = {
      key:
        cacheKey,
      papers:
        result,
    };

    return result;
  }
  render() {
    this.applyAppearanceSettings();

    if (this.searchInput) {
      this.searchInput.value =
        this.query;
    }

    this.renderTabs();

    this.updateDensityButton();

    const galleryMode =
      this.view === "gallery";

    this.tableWrap
      ?.toggleClass(
        "is-hidden",
        galleryMode
      );

    this.galleryEl
      ?.toggleClass(
        "is-hidden",
        !galleryMode
      );

    this.columnsButton
      ?.toggleClass(
        "is-hidden",
        galleryMode
      );

    if (galleryMode) {
      this.deactivateVirtualTable();

      this.renderGallery();

      this.renderHeader();
    }
    else {
      this.renderHeader();
      this.renderRows();
    }

    void this.renderDetailIfOpen();
  }

  renderCollectionSurface({
    header = true,
  } = {}) {
    if (
      this.view === "gallery"
    ) {
      this.renderGallery();
    }
    else {
      this.renderRows();
    }

    if (header) {
      this.renderHeader();
    }
  }

  figurePaths(
    paper
  ) {
    return (
      Array.isArray(
        paper?.figures
      )
        ? paper.figures
        : []
    )
      .map(
        (path) =>
          normalizePath(
            this.linkPath(
              path
            )
          )
      )
      .filter(Boolean);
  }

  figureFile(
    paper,
    index = 0
  ) {
    const path =
      this.figurePaths(
        paper
      )[index];

    if (!path) {
      return null;
    }

    const file =
      this.resolveVaultFile(
        path,
        paper.file?.path || ""
      );

    return this.isFigureFile(
      file
    )
      ? file
      : null;
  }

  isFigureFile(
    file
  ) {
    return Boolean(
      file instanceof TFile
      && this.isFigureAssetPath(
        file.path
      )
    );
  }

  figureResourcePath(
    file
  ) {
    if (
      !this.isFigureFile(
        file
      )
    ) {
      return "";
    }

    try {
      return this.app.vault
        .getResourcePath(
          file
        );
    }
    catch (_) {
      return "";
    }
  }

  figureEntriesForPaper(
    paper
  ) {
    return this.figurePaths(
      paper
    ).map(
      (
        path,
        index
      ) => {
        const file =
          this.resolveVaultFile(
            path,
            paper.file?.path || ""
          );

        return {
          paper,
          path,
          index,
          file:
            this.isFigureFile(
              file
            )
              ? file
              : null,
        };
      }
    );
  }

  safeFigureFilename(
    value
  ) {
    const raw =
      String(
        value || "figure.png"
      )
        .replace(
          /[\\/:*?"<>|]+/g,
          "-"
        )
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    return raw || "figure.png";
  }

  availableFigurePath(
    paper,
    originalName
  ) {
    const folder =
      normalizePath(
        this.plugin.settings
          .figuresFolder
        || "Research/25 Figures"
      ).replace(
        /\/+$/,
        ""
      );

    const safe =
      this.safeFigureFilename(
        originalName
      );

    const extensionMatch =
      safe.match(
        /\.([A-Za-z0-9]+)$/
      );

    const extension =
      extensionMatch
        ? extensionMatch[1]
            .toLowerCase()
        : "png";

    const rawBase =
      safe.replace(
        /\.[^.]+$/,
        ""
      )
      || "figure";

    const prefix =
      this.safeFigureFilename(
        paper.citekey
        || paper.file?.basename
        || "paper"
      )
        .replace(
          /\.[^.]+$/,
          ""
        );

    let base =
      rawBase;

    if (
      prefix
      && !rawBase
        .toLowerCase()
        .startsWith(
          `${prefix.toLowerCase()}-`
        )
    ) {
      base =
        `${prefix}-${rawBase}`;
    }

    const direct =
      normalizePath(
        `${folder}/${base}.${extension}`
      );

    if (
      !this.app.vault
        .getAbstractFileByPath(
          direct
        )
    ) {
      return direct;
    }

    for (
      let index = 2;
      index < 10000;
      index += 1
    ) {
      const candidate =
        normalizePath(
          `${folder}/${base}-${index}.${extension}`
        );

      if (
        !this.app.vault
          .getAbstractFileByPath(
            candidate
          )
      ) {
        return candidate;
      }
    }

    throw new Error(
      "无法生成可用的图片文件名。"
    );
  }

  async writePaperFigures(
    paper,
    paths
  ) {
    const unique =
      [];

    const seen =
      new Set();

    for (
      const rawPath
      of paths || []
    ) {
      const path =
        normalizePath(
          this.linkPath(
            rawPath
          )
        );

      if (
        !path
        || seen.has(
          path.toLowerCase()
        )
      ) {
        continue;
      }

      seen.add(
        path.toLowerCase()
      );

      unique.push(
        path
      );
    }

    const livePaperFile =
      this.liveTFile(
        paper?.file,
        {
          extension:
            "md",
          label:
            "Paper Note",
        }
      );

    paper.file =
      livePaperFile;

    this.suppressRefreshUntil =
      Date.now() + 1200;

    await this.app.fileManager
      .processFrontMatter(
        livePaperFile,
        (fm) => {
          if (unique.length) {
            fm.figures =
              unique.map(
                (path) =>
                  `[[${path}]]`
              );

            delete fm.figure;
          }
          else {
            delete fm.figures;
            delete fm.figure;
          }
        }
      );

    paper.figures =
      unique;

    this.markPaperRuntimeChanged(
      paper
    );

    if (
      this.view === "gallery"
    ) {
      this.renderGallery();

      if (
        this.detailPaperPath
        === paper.file.path
      ) {
        await this.renderPaperDetail(
          paper
        );
      }
    }
    else {
      await this.refreshPaperRow(
        paper,
        {
          renderDetail:
            true,
        }
      );
    }

    return unique;
  }

  async updatePaperFigures(
    paper,
    paths
  ) {
    return this.withExclusiveWrite(
      "Figure update",
      () =>
        this.writePaperFigures(
          paper,
          paths
        )
    );
  }

  async importLocalFigureFiles(
    paper,
    files
  ) {
    const selected =
      [...(
        files || []
      )]
        .filter(
          (file) => {
            const type =
              String(
                file?.type || ""
              ).toLowerCase();

            const name =
              String(
                file?.name || ""
              );

            return (
              type.startsWith(
                "image/"
              )
              || this.isFigureAssetPath(
                name
              )
            );
          }
        );

    if (!selected.length) {
      throw new Error(
        "没有可导入的图片。"
      );
    }

    return this.withExclusiveWrite(
      "Figure import",
      async () => {
        const created =
          [];

        try {
          await this.ensureFolder(
            this.plugin.settings
              .figuresFolder
            || "Research/25 Figures"
          );

          for (
            const file
            of selected
          ) {
            const path =
              this.availableFigurePath(
                paper,
                file.name
              );

            const buffer =
              await file.arrayBuffer();

            const createdFile =
              await this.app.vault
                .createBinary(
                  path,
                  buffer
                );

            created.push(
              createdFile
            );
          }

          const next =
            [
              ...this.figurePaths(
                paper
              ),
              ...created.map(
                (file) =>
                  file.path
              ),
            ];

          await this.writePaperFigures(
            paper,
            next
          );

          return created;
        }
        catch (error) {
          for (
            const file
            of [...created]
              .reverse()
          ) {
            try {
              const live =
                this.app.vault
                  .getAbstractFileByPath(
                    file.path
                  );

              if (
                live instanceof TFile
              ) {
                await this.app.fileManager
                  .trashFile(
                    live
                  );
              }
            }
            catch (_) {}
          }

          throw error;
        }
      }
    );
  }

  async setPrimaryFigure(
    paper,
    index
  ) {
    const paths =
      this.figurePaths(
        paper
      );

    if (
      index <= 0
      || index >= paths.length
    ) {
      return;
    }

    const next =
      [
        paths[index],
        ...paths.filter(
          (
            _,
            currentIndex
          ) =>
            currentIndex !== index
        ),
      ];

    await this.updatePaperFigures(
      paper,
      next
    );

    this.detailFigureIndexByPath
      .set(
        paper.file.path,
        0
      );
  }

  async removeFigureLink(
    paper,
    index
  ) {
    const paths =
      this.figurePaths(
        paper
      );

    if (
      index < 0
      || index >= paths.length
    ) {
      return;
    }

    paths.splice(
      index,
      1
    );

    await this.updatePaperFigures(
      paper,
      paths
    );

    const current =
      this.detailFigureIndexByPath
        .get(
          paper.file.path
        ) || 0;

    this.detailFigureIndexByPath
      .set(
        paper.file.path,
        Math.max(
          0,
          Math.min(
            current,
            paths.length - 1
          )
        )
      );
  }

  openFigureManager(
    paper
  ) {
    this.closePopover();

    new PaperFigureManagerModal(
      this.app,
      {
        library:
          this,
        paper,
      }
    ).open();
  }

  openFigureViewer(
    paper,
    index = 0
  ) {
    new PaperFigureViewerModal(
      this.app,
      {
        library:
          this,
        paper,
        index,
      }
    ).open();
  }

  renderGallery() {
    if (!this.galleryEl) {
      return;
    }

    this.galleryEl.empty();

    const papers =
      this.visiblePapers({
        fresh:
          true,
      });

    const entries =
      papers.flatMap(
        (paper) =>
          this.figureEntriesForPaper(
            paper
          )
      );

    this.countEl?.setText(
      `${entries.length} 张图`
    );

    if (!entries.length) {
      const empty =
        this.galleryEl.createDiv({
          cls:
            "rl-gallery-empty",
        });

      const icon =
        empty.createSpan({
          cls:
            "rl-gallery-empty-icon",
        });

      this.createIcon(
        icon,
        "images"
      );

      empty.createDiv({
        cls:
          "rl-gallery-empty-title",
        text:
          "暂无图片",
      });

      return;
    }

    const grid =
      this.galleryEl.createDiv({
        cls:
          "rl-gallery-grid",
      });

    for (
      const entry
      of entries
    ) {
      const card =
        grid.createEl(
          "article",
          {
            cls:
              "rl-gallery-card",
          }
        );

      const media =
        card.createEl(
          "button",
          {
            cls:
              "rl-gallery-media",
            attr: {
              type:
                "button",
              title:
                entry.file
                  ? "查看大图"
                  : "管理图片",
            },
          }
        );

      if (entry.file) {
        media.createEl(
          "img",
          {
            cls:
              "rl-gallery-image",
            attr: {
              src:
                this.figureResourcePath(
                  entry.file
                ),
              alt:
                `${entry.paper.title} · ${
                  entry.file.name
                }`,
              loading:
                "lazy",
              decoding:
                "async",
            },
          }
        );

        media.addEventListener(
          "click",
          () => {
            this.openFigureViewer(
              entry.paper,
              entry.index
            );
          }
        );
      }
      else {
        const missing =
          media.createDiv({
            cls:
              "rl-gallery-missing",
          });

        this.createIcon(
          missing,
          "image-off"
        );

        media.addEventListener(
          "click",
          () => {
            this.openFigureManager(
              entry.paper
            );
          }
        );
      }

      if (
        this.figurePaths(
          entry.paper
        ).length > 1
      ) {
        media.createSpan({
          cls:
            "rl-gallery-index",
          text:
            `${entry.index + 1}/${
              entry.paper.figures.length
            }`,
        });
      }

      const body =
        card.createDiv({
          cls:
            "rl-gallery-card-body",
        });

      const titleRow =
        body.createDiv({
          cls:
            "rl-gallery-card-title-row",
        });

      if (
        entry.paper.alias
      ) {
        titleRow.createSpan({
          cls:
            `rl-gallery-alias is-rating-${
              Math.max(
                0,
                Math.min(
                  5,
                  Number(
                    entry.paper.rating
                  ) || 0
                )
              )
            }`,
          text:
            entry.paper.alias,
        });
      }

      titleRow.createDiv({
        cls:
          "rl-gallery-card-title",
        text:
          entry.paper.title,
        attr: {
          title:
            entry.paper.title,
        },
      });

      const footer =
        body.createDiv({
          cls:
            "rl-gallery-card-footer",
        });

      footer.createSpan({
        cls:
          "rl-gallery-card-meta",
        text:
          [
            entry.paper.year,
            this.shortVenue(
              entry.paper.venue
            ),
          ]
            .filter(Boolean)
            .join(" · ")
          || "—",
      });

      const detailButton =
        footer.createEl(
          "button",
          {
            cls:
              "rl-gallery-detail-button",
            attr: {
              type:
                "button",
              title:
                "Paper Detail",
            },
          }
        );

      this.createIcon(
        detailButton,
        "panel-right-open"
      );

      detailButton.addEventListener(
        "click",
        async (event) => {
          event.preventDefault();
          event.stopPropagation();

          await this.openPaperDetail(
            entry.paper,
            {
              scrollRow:
                false,
            }
          );
        }
      );
    }
  }

  markPaperRuntimeChanged(
    paper,
    {
      search = false,
      title = false,
    } = {}
  ) {
    if (!paper?.file) {
      return;
    }

    paper.mtime =
      paper.file?.stat?.mtime
      || Date.now();

    if (search) {
      delete paper
        ._rlSearchSignature;

      delete paper
        ._rlSearchText;
    }

    if (title) {
      delete paper
        ._rlSortTitle;
    }

    this.paperRevision += 1;

    this.visiblePapersCache = {
      key:
        "",
      papers:
        [],
    };

    this.paperCache.set(
      paper.file.path,
      {
        signature:
          this.paperFileSignature(
            paper.file
          ),
        paper,
      }
    );
  }

  resetVirtualMetrics() {
    this.virtualRowHeight =
      0;

    this.virtualMetricKey =
      "";

    this.virtualMeasuredKey =
      "";

    this.virtualLastWindowKey =
      "";
  }

  virtualGeometryKey() {
    return [
      this.plugin.settings
        .density
      || "comfortable",
      Number(
        this.plugin.settings
          .fontSize
      ) || 13,
    ].join(":");
  }

  estimatedVirtualRowHeight() {
    const key =
      this.virtualGeometryKey();

    if (
      this.virtualMetricKey
        === key
      && this.virtualRowHeight > 0
    ) {
      return this.virtualRowHeight;
    }

    const fontSize =
      Math.max(
        10,
        Math.min(
          20,
          Number(
            this.plugin.settings
              .fontSize
          ) || 13
        )
      );

    const compact =
      this.plugin.settings
        .density
      === "compact";

    this.virtualRowHeight =
      compact
        ? Math.max(
            35,
            fontSize * 2.7
          )
        : Math.max(
            45,
            fontSize * 3.45
          );

    this.virtualMetricKey =
      key;

    return this.virtualRowHeight;
  }

  shouldVirtualizePapers(
    papers
  ) {
    return (
      (papers?.length || 0)
      >= 900
    );
  }

  virtualWindowFor(
    total,
    scrollTop,
    viewportHeight,
    rowHeight,
    {
      overscan = 12,
      headHeight = 38,
    } = {}
  ) {
    if (
      total <= 0
      || rowHeight <= 0
    ) {
      return {
        start:
          0,
        end:
          0,
        top:
          0,
        bottom:
          0,
      };
    }

    const bodyViewportHeight =
      Math.max(
        rowHeight,
        Number(
          viewportHeight
        )
        - Number(
            headHeight
          )
      );

    const rawBodyScrollTop =
      Math.max(
        0,
        Number(
          scrollTop
        )
        - Number(
            headHeight
          )
      );

    const maxBodyScrollTop =
      Math.max(
        0,
        total * rowHeight
        - bodyViewportHeight
      );

    const bodyScrollTop =
      Math.min(
        rawBodyScrollTop,
        maxBodyScrollTop
      );

    const start =
      Math.max(
        0,
        Math.floor(
          bodyScrollTop
          / rowHeight
        )
        - overscan
      );

    const end =
      Math.min(
        total,
        Math.max(
          start + 1,
          Math.ceil(
            (
              bodyScrollTop
              + bodyViewportHeight
            )
            / rowHeight
          )
          + overscan
        )
      );

    return {
      start,
      end,
      top:
        start * rowHeight,
      bottom:
        Math.max(
          0,
          (
            total - end
          )
          * rowHeight
        ),
    };
  }

  deactivateVirtualTable() {
    this.virtualTableActive =
      false;

    this.virtualPapers =
      [];

    this.virtualStart =
      0;

    this.virtualEnd =
      0;

    this.virtualLastWindowKey =
      "";

    if (
      this.virtualScrollFrame
    ) {
      window.cancelAnimationFrame(
        this.virtualScrollFrame
      );

      this.virtualScrollFrame =
        null;
    }
  }

  scheduleVirtualWindowRender() {
    if (
      !this.virtualTableActive
      || this.virtualScrollFrame
    ) {
      return;
    }

    this.virtualScrollFrame =
      window.requestAnimationFrame(
        () => {
          this.virtualScrollFrame =
            null;

          if (
            !this.virtualTableActive
          ) {
            return;
          }

          this.renderVirtualRows(
            this.virtualPapers
          );
        }
      );
  }

  measureVirtualRowHeight() {
    if (
      !this.virtualTableActive
      || !this.bodyEl
    ) {
      return;
    }

    const key =
      this.virtualGeometryKey();

    if (
      this.virtualMeasuredKey
      === key
    ) {
      return;
    }

    const row =
      this.bodyEl.querySelector(
        ".rl-data-row"
      );

    if (!row) {
      return;
    }

    const height =
      row.getBoundingClientRect()
        .height;

    if (
      !Number.isFinite(height)
      || height <= 0
    ) {
      return;
    }

    this.virtualMeasuredKey =
      key;

    if (
      Math.abs(
        height
        - this.virtualRowHeight
      ) > 0.5
    ) {
      this.virtualRowHeight =
        height;

      this.virtualMetricKey =
        key;

      this.virtualLastWindowKey =
        "";

      this.scheduleVirtualWindowRender();
    }
  }

  renderVirtualRows(
    papers,
    {
      force = false,
    } = {}
  ) {
    if (
      !this.bodyEl
      || !this.tableWrap
      || !papers?.length
    ) {
      return;
    }

    this.virtualTableActive =
      true;

    this.virtualPapers =
      papers;

    const rowHeight =
      this.estimatedVirtualRowHeight();

    const headHeight =
      this.headEl
        ?.getBoundingClientRect()
        ?.height
      || 38;

    const windowState =
      this.virtualWindowFor(
        papers.length,
        this.tableWrap.scrollTop,
        this.tableWrap.clientHeight,
        rowHeight,
        {
          overscan:
            12,
          headHeight,
        }
      );

    const key =
      [
        this.paperRevision,
        this.visiblePapersCache
          .key,
        windowState.start,
        windowState.end,
        this.virtualGeometryKey(),
      ].join("|");

    if (
      !force
      && this.virtualLastWindowKey
        === key
    ) {
      return;
    }

    this.virtualLastWindowKey =
      key;

    this.virtualStart =
      windowState.start;

    this.virtualEnd =
      windowState.end;

    this.topicResizeObserver
      ?.disconnect();

    this.rowElementsByPath
      .clear();

    this.bodyEl.empty();

    if (
      windowState.top > 0
    ) {
      const topSpacer =
        this.bodyEl.createDiv({
          cls:
            "rl-virtual-spacer rl-virtual-spacer-top",
        });

      topSpacer.style.height =
        `${
          windowState.top
        }px`;
    }

    for (
      let index =
        windowState.start;
      index < windowState.end;
      index += 1
    ) {
      this.renderPaperRow(
        papers[index]
      );
    }

    if (
      windowState.bottom > 0
    ) {
      const bottomSpacer =
        this.bodyEl.createDiv({
          cls:
            "rl-virtual-spacer rl-virtual-spacer-bottom",
        });

      bottomSpacer.style.height =
        `${
          windowState.bottom
        }px`;
    }

    if (
      this.virtualMeasuredKey
      !== this.virtualGeometryKey()
    ) {
      window.requestAnimationFrame(
        () =>
          this.measureVirtualRowHeight()
      );
    }
  }

  paperRowElement(
    path
  ) {
    if (
      !path
      || !this.bodyEl
    ) {
      return null;
    }

    return (
      this.rowElementsByPath
        .get(
          path
        )
      || null
    );
  }
  disposePaperRow(
    row
  ) {
    if (!row) {
      return;
    }

    const path =
      row.dataset?.path;

    if (
      path
      && this.rowElementsByPath
        .get(
          path
        ) === row
    ) {
      this.rowElementsByPath
        .delete(
          path
        );
    }

    if (
      !this.topicResizeObserver
    ) {
      return;
    }

    for (
      const editor
      of row.querySelectorAll(
        ".rl-topics-editor"
      )
    ) {
      try {
        this.topicResizeObserver
          .unobserve(
            editor
          );
      }
      catch (_) {}
    }
  }

  paintSelectionStateForRow(
    row,
    path
  ) {
    if (!row) {
      return;
    }

    const selected =
      this.selectedPaths.has(
        path
      );

    row.toggleClass(
      "is-selected",
      selected
    );

    const button =
      row.querySelector(
        ".rl-select-button"
      );

    if (!button) {
      return;
    }

    button.toggleClass(
      "is-checked",
      selected
    );

    button.removeClass(
      "is-indeterminate"
    );

    button.setAttribute(
      "aria-pressed",
      selected
        ? "true"
        : "false"
    );

    button.empty();

    if (selected) {
      this.createIcon(
        button,
        "check",
        "rl-select-button-icon"
      );
    }
  }

  refreshSelectionDom() {
    if (!this.bodyEl) {
      return;
    }

    for (
      const [
        path,
        row,
      ]
      of this.rowElementsByPath
    ) {
      this.paintSelectionStateForRow(
        row,
        path
      );
    }

    this.updateSelectionBar();
  }

  updateDetailActiveRowState(
    previousPath,
    nextPath
  ) {
    if (
      previousPath
      && previousPath !== nextPath
    ) {
      this.paperRowElement(
        previousPath
      )?.removeClass(
        "is-detail-active"
      );
    }

    if (nextPath) {
      this.paperRowElement(
        nextPath
      )?.addClass(
        "is-detail-active"
      );
    }
  }

  async refreshPaperRow(
    paper,
    {
      renderDetail = true,
    } = {}
  ) {
    if (
      !paper?.file
      || !this.bodyEl
    ) {
      return "none";
    }

    if (
      this.virtualTableActive
    ) {
      const visible =
        this.visiblePapers({
          fresh:
            true,
        });

      this.renderVirtualRows(
        visible,
        {
          force:
            true,
        }
      );

      this.renderHeader();

      if (
        renderDetail
        && this.detailPaperPath
          === paper.file.path
      ) {
        await this.renderPaperDetail(
          paper
        );
      }

      return "virtual";
    }

    // A partially-rendered large table has incomplete row indexes.
    // Restart that render rather than patching an unstable DOM.
    if (
      this.rowRenderFrame
    ) {
      this.renderRows();
      this.renderHeader();

      if (
        renderDetail
        && this.detailPaperPath
          === paper.file.path
      ) {
        await this.renderPaperDetail(
          paper
        );
      }

      return "full";
    }

    const visible =
      this.visiblePapers({
        fresh:
          true,
      });

    const path =
      paper.file.path;

    const desiredIndex =
      visible.findIndex(
        (candidate) =>
          candidate.file.path
          === path
      );

    const existing =
      this.paperRowElement(
        path
      );

    this.countEl?.setText(
      `${visible.length} 篇论文`
    );

    if (desiredIndex < 0) {
      if (existing) {
        this.disposePaperRow(
          existing
        );

        existing.remove();
      }

      this.renderHeader();
      this.updateSelectionBar();

      if (
        renderDetail
        && this.detailPaperPath
          === path
      ) {
        await this.renderPaperDetail(
          paper
        );
      }

      return "removed";
    }

    if (!existing) {
      this.renderRows();
      this.renderHeader();

      if (
        renderDetail
        && this.detailPaperPath
          === path
      ) {
        await this.renderPaperDetail(
          paper
        );
      }

      return "full";
    }

    const rows =
      [
        ...this.bodyEl
          .querySelectorAll(
            ".rl-data-row"
          ),
      ];

    const currentIndex =
      rows.indexOf(
        existing
      );

    // Sorting may move the row. In that case a full row-order render
    // is required, but the Paper index itself is still local/cached.
    if (
      currentIndex
      !== desiredIndex
    ) {
      this.renderRows();
      this.renderHeader();

      if (
        renderDetail
        && this.detailPaperPath
          === path
      ) {
        await this.renderPaperDetail(
          paper
        );
      }

      return "full";
    }

    this.disposePaperRow(
      existing
    );

    const replacement =
      this.renderPaperRow(
        paper
      );

    existing.replaceWith(
      replacement
    );

    this.updateSelectionBar();

    if (
      renderDetail
      && this.detailPaperPath
        === path
    ) {
      await this.renderPaperDetail(
        paper
      );
    }

    return "row";
  }

  renderRows() {
    if (!this.bodyEl) {
      return;
    }

    this.rowRenderToken += 1;

    const token =
      this.rowRenderToken;

    if (
      this.rowRenderFrame
    ) {
      window.cancelAnimationFrame(
        this.rowRenderFrame
      );

      this.rowRenderFrame =
        null;
    }

    if (
      this.virtualScrollFrame
    ) {
      window.cancelAnimationFrame(
        this.virtualScrollFrame
      );

      this.virtualScrollFrame =
        null;
    }

    this.topicResizeObserver
      ?.disconnect();

    this.rowElementsByPath
      .clear();

    this.bodyEl.empty();

    const papers =
      this.visiblePapers({
        fresh:
          true,
      });

    this.countEl.setText(
      `${papers.length} 篇论文`
    );

    this.filterButton.classList.toggle(
      "is-active",
      this.statusFilter !== "all"
      || this.ratingFilter > 0
      || Boolean(this.topicFilter)
      || Boolean(this.collectionFilter)
      || Boolean(this.projectFilter)
    );

    this.sortButton.classList.toggle(
      "is-active",
      this.sortField !== "edited"
      || this.sortDir !== "desc"
    );

    if (!papers.length) {
      this.deactivateVirtualTable();

      const empty =
        this.bodyEl.createDiv({
          cls:
            "rl-empty",
        });

      empty.createDiv({
        cls:
          "rl-empty-title",
        text:
          "没有符合条件的论文",
      });

      empty.createDiv({
        cls:
          "rl-empty-subtitle",
        text:
          "可以调整筛选条件或换一个搜索词。",
      });

      this.updateSelectionBar();

      return;
    }

    if (
      this.shouldVirtualizePapers(
        papers
      )
    ) {
      this.virtualTableActive =
        true;

      this.virtualPapers =
        papers;

      this.virtualLastWindowKey =
        "";

      this.renderVirtualRows(
        papers,
        {
          force:
            true,
        }
      );

      this.updateSelectionBar();

      return;
    }

    this.deactivateVirtualTable();

    const chunkSize =
      papers.length > 700
        ? 70
        : papers.length > 250
          ? 100
          : papers.length;

    let index =
      0;

    const renderChunk =
      () => {
        if (
          token
          !== this.rowRenderToken
          || !this.bodyEl
        ) {
          return;
        }

        const end =
          Math.min(
            papers.length,
            index + chunkSize
          );

        for (
          ;
          index < end;
          index += 1
        ) {
          this.renderPaperRow(
            papers[index]
          );
        }

        if (
          index < papers.length
        ) {
          this.rowRenderFrame =
            window.requestAnimationFrame(
              renderChunk
            );
        }
        else {
          this.rowRenderFrame =
            null;
        }
      };

    renderChunk();

    this.updateSelectionBar();
  }
  renderPaperRow(paper) {
    const selected =
      this.selectedPaths.has(
        paper.file.path
      );

    const row =
      this.bodyEl.createDiv({
        cls:
          "rl-row rl-data-row"
          + (
            selected
              ? " is-selected"
              : ""
          )
          + (
            this.detailPaperPath
              === paper.file.path
              ? " is-detail-active"
              : ""
          ),
      });

    row.dataset.path =
      paper.file.path;

    this.rowElementsByPath.set(
      paper.file.path,
      row
    );

    const selectCell =
      row.createDiv({
        cls: "rl-col-select",
      });

    this.createSelectionButton(
      selectCell,
      {
        checked: selected,
        ariaLabel:
          `选择 ${paper.title}`,
        onClick: (event) => {
          this.setPaperSelected(
            paper,
            !this.selectedPaths.has(
              paper.file.path
            ),
            event.shiftKey
          );
        },
      }
    );

    row.addEventListener(
      "contextmenu",
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        this.openRowContextMenu(
          event,
          paper
        );
      }
    );

    row.addEventListener(
      "click",
      (event) => {
        if (
          event.target.closest(
            "button, a, input, textarea, select"
          )
        ) {
          return;
        }

        void this.openPaperDetail(
          paper
        );
      }
    );

    for (
      const key
      of this.visibleColumnKeys()
    ) {
      this.renderCell(
        row,
        paper,
        key
      );
    }

    return row;
  }

  bindDetailResize(handle) {
    handle.addEventListener(
      "dblclick",
      async () => {
        this.plugin.settings
          .detailPanelWidth =
          410;

        if (this.detailEl) {
          this.detailEl.style.width =
            "410px";
        }

        await this.plugin
          .saveSettings();
      }
    );

    handle.addEventListener(
      "pointerdown",
      (event) => {
        if (!this.detailEl) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        const pointerId =
          event.pointerId;

        const startX =
          event.clientX;

        const startWidth =
          this.detailEl
            .getBoundingClientRect()
            .width;

        let latestWidth =
          startWidth;

        handle.addClass(
          "is-resizing"
        );

        document.body.addClass(
          "rl-is-resizing"
        );

        try {
          handle.setPointerCapture(
            pointerId
          );
        }
        catch (_) {}

        const onMove =
          (moveEvent) => {
            latestWidth =
              Math.max(
                340,
                Math.min(
                  620,
                  startWidth
                  + startX
                  - moveEvent.clientX
                )
              );

            this.detailEl.style.width =
              `${Math.round(
                latestWidth
              )}px`;
          };

        const finish =
          async () => {
            handle.removeEventListener(
              "pointermove",
              onMove
            );

            handle.removeEventListener(
              "pointerup",
              finish
            );

            handle.removeEventListener(
              "pointercancel",
              finish
            );

            try {
              if (
                handle.hasPointerCapture(
                  pointerId
                )
              ) {
                handle.releasePointerCapture(
                  pointerId
                );
              }
            }
            catch (_) {}

            handle.removeClass(
              "is-resizing"
            );

            document.body.removeClass(
              "rl-is-resizing"
            );

            this.plugin.settings
              .detailPanelWidth =
              Math.round(
                latestWidth
              );

            await this.plugin
              .saveSettings();
          };

        handle.addEventListener(
          "pointermove",
          onMove
        );

        handle.addEventListener(
          "pointerup",
          finish
        );

        handle.addEventListener(
          "pointercancel",
          finish
        );
      }
    );
  }

  persistDetailUiState(
    isOpen,
    path =
      this.detailPaperPath
  ) {
    this.plugin.settings
      .detailPanelOpen =
      Boolean(isOpen);

    if (path) {
      this.plugin.settings
        .detailLastPaperPath =
        path;
    }

    this.detailStateSavePromise =
      this.detailStateSavePromise
        .then(
          () =>
            this.plugin
              .saveSettings()
        )
        .catch(
          (error) => {
            console.debug(
              "Research Library: failed to persist Paper Detail UI state",
              error
            );
          }
        );
  }

  detailNavigationState(
    paper
  ) {
    const visible =
      this.visiblePapers();

    const index =
      visible.findIndex(
        (item) =>
          item.file.path
          === paper?.file?.path
      );

    return {
      visible,
      index,
      hasPrevious:
        index > 0,
      hasNext:
        index >= 0
        && index
          < visible.length - 1,
      label:
        index >= 0
          ? `${index + 1} / ${visible.length}`
          : `— / ${visible.length}`,
    };
  }

  scrollPaperRowIntoView(
    path
  ) {
    if (
      !path
      || !this.bodyEl
    ) {
      return;
    }

    let row =
      this.paperRowElement(
        path
      );

    if (
      !row
      && this.virtualTableActive
      && this.tableWrap
    ) {
      const index =
        this.virtualPapers
          .findIndex(
            (paper) =>
              paper.file.path
              === path
          );

      if (index >= 0) {
        const rowHeight =
          this.estimatedVirtualRowHeight();

        const headHeight =
          this.headEl
            ?.getBoundingClientRect()
            ?.height
          || 38;

        const viewportHeight =
          this.tableWrap
            .clientHeight
          || 600;

        const targetTop =
          Math.max(
            0,
            headHeight
            + index
              * rowHeight
            - Math.max(
                0,
                (
                  viewportHeight
                  - rowHeight
                )
                / 2
              )
          );

        this.tableWrap.scrollTop =
          targetTop;

        this.virtualLastWindowKey =
          "";

        this.renderVirtualRows(
          this.virtualPapers,
          {
            force:
              true,
          }
        );

        row =
          this.paperRowElement(
            path
          );
      }
    }

    row?.scrollIntoView({
      block:
        "nearest",
      inline:
        "nearest",
      behavior:
        "smooth",
    });
  }
  async openPaperDetail(
    paper,
    {
      focus = true,
      scrollRow = false,
    } = {}
  ) {
    if (!paper?.file) return;

    if (
      this.detailEditingSectionKey
      && this.detailEditingPaperPath
        !== paper.file.path
    ) {
      new Notice(
        "请先保存或取消当前 Paper Detail 的 Markdown 编辑。"
      );

      return;
    }

    const previousDetailPath =
      this.detailPaperPath;

    this.detailPaperPath =
      paper.file.path;

    this.persistDetailUiState(
      true,
      paper.file.path
    );

    this.rootEl?.addClass(
      "has-detail"
    );

    this.detailEl?.removeClass(
      "is-hidden"
    );

    this.updateDetailActiveRowState(
      previousDetailPath,
      paper.file.path
    );

    if (scrollRow) {
      this.scrollPaperRowIntoView(
        paper.file.path
      );
    }

    await this.renderPaperDetail(
      paper
    );

    if (focus) {
      this.modalEl.setAttribute(
        "tabindex",
        "-1"
      );

      window.setTimeout(
        () => {
          try {
            this.modalEl.focus({
              preventScroll:
                true,
            });
          }
          catch (_) {
            this.modalEl.focus();
          }
        },
        0
      );
    }
  }

  closePaperDetail() {
    if (
      this.detailEditingSectionKey
    ) {
      new Notice(
        "请先保存或取消当前 Markdown 编辑。"
      );

      return;
    }

    const previousPath =
      this.detailPaperPath;

    this.detailPaperPath =
      null;

    this.detailRenderToken += 1;

    this.persistDetailUiState(
      false,
      previousPath
    );

    this.rootEl?.removeClass(
      "has-detail"
    );

    this.detailEl?.addClass(
      "is-hidden"
    );

    this.detailContentEl
      ?.empty();

    this.updateDetailActiveRowState(
      previousPath,
      null
    );
  }

  async navigatePaperDetail(
    direction
  ) {
    const current =
      this.papers.find(
        (item) =>
          item.file.path
          === this.detailPaperPath
      );

    const visible =
      this.visiblePapers();

    if (!visible.length) {
      return;
    }

    let index =
      current
        ? visible.findIndex(
            (item) =>
              item.file.path
              === current.file.path
          )
        : -1;

    if (index < 0) {
      index =
        direction < 0
          ? visible.length
          : -1;
    }

    const nextIndex =
      Math.max(
        0,
        Math.min(
          visible.length - 1,
          index
          + (
            direction < 0
              ? -1
              : 1
          )
        )
      );

    if (
      current
      && visible[nextIndex]
        ?.file.path
        === current.file.path
    ) {
      return;
    }

    await this.openPaperDetail(
      visible[nextIndex],
      {
        focus:
          true,
        scrollRow:
          true,
      }
    );
  }

  detailKeyboardTargetIsEditing(
    target
  ) {
    if (
      !(target instanceof Element)
    ) {
      return false;
    }

    return Boolean(
      target.closest(
        'input, textarea, select, [contenteditable="true"], .rl-detail-section-editor'
      )
    );
  }

  async handleDetailKeydown(
    event
  ) {
    if (
      event.defaultPrevented
      || event.isComposing
    ) {
      return;
    }

    if (
      this.detailKeyboardTargetIsEditing(
        event.target
      )
    ) {
      return;
    }

    if (this.activePopover) {
      return;
    }

    const interactive =
      event.target
        instanceof Element
      && event.target.closest(
        "button, a"
      );

    if (
      !this.detailPaperPath
    ) {
      if (
        event.key === "Enter"
        && !interactive
      ) {
        const lastPath =
          this.plugin.settings
            .detailLastPaperPath;

        const paper =
          this.papers.find(
            (item) =>
              item.file.path
              === lastPath
          );

        if (paper) {
          event.preventDefault();

          await this.openPaperDetail(
            paper
          );
        }
      }

      return;
    }

    const paper =
      this.papers.find(
        (item) =>
          item.file.path
          === this.detailPaperPath
      );

    if (!paper) {
      return;
    }

    if (
      event.key === "Escape"
    ) {
      event.preventDefault();

      this.closePaperDetail();

      return;
    }

    if (
      event.key === "ArrowUp"
    ) {
      event.preventDefault();

      await this.navigatePaperDetail(
        -1
      );

      return;
    }

    if (
      event.key === "ArrowDown"
    ) {
      event.preventDefault();

      await this.navigatePaperDetail(
        1
      );

      return;
    }

    if (interactive) {
      return;
    }

    if (
      event.key === "Enter"
      && (
        event.ctrlKey
        || event.metaKey
      )
    ) {
      event.preventDefault();

      await this.openDetailNote(
        paper
      );

      return;
    }

    if (
      event.key === "Enter"
      && event.shiftKey
    ) {
      event.preventDefault();

      await this.openDetailPdf(
        paper
      );
    }
  }

  async copyDetailText(
    value,
    label =
      "内容"
  ) {
    const text =
      String(
        value || ""
      ).trim();

    if (!text) {
      new Notice(
        `${label} 为空`
      );

      return;
    }

    await navigator.clipboard
      .writeText(text);

    new Notice(
      `已复制 ${label}`
    );
  }

  async openExternalDetailUrl(
    url,
    paper
  ) {
    const target =
      String(
        url || ""
      ).trim();

    if (!target) {
      return;
    }

    try {
      await this.app.workspace
        .openLinkText(
          target,
          paper?.file?.path
          || "",
          true
        );
    }
    catch (error) {
      console.debug(
        "Research Library: workspace.openLinkText failed, falling back to window.open",
        error
      );

      window.open(
        target,
        "_blank",
        "noopener,noreferrer"
      );
    }
  }

  async openDetailNote(
    paper
  ) {
    if (!paper?.file) {
      return;
    }

    await this.app.workspace
      .getLeaf("tab")
      .openFile(
        paper.file
      );

    this.close();
  }

  detailPdfFile(
    paper
  ) {
    if (!paper?.pdf) {
      return null;
    }

    return this.resolveVaultFile(
      paper.pdf,
      paper.file.path
    );
  }

  async openDetailPdf(
    paper
  ) {
    const pdfFile =
      this.detailPdfFile(
        paper
      );

    if (!pdfFile) {
      new Notice(
        paper?.pdf
          ? `找不到 PDF：${paper.pdf}`
          : "该论文没有关联 PDF"
      );

      return;
    }

    await this.app.workspace
      .getLeaf("tab")
      .openFile(
        pdfFile
      );

    this.close();
  }

  async revealDetailPdf(
    paper
  ) {
    const pdfFile =
      this.detailPdfFile(
        paper
      );

    if (!pdfFile) {
      new Notice(
        paper?.pdf
          ? `找不到 PDF：${paper.pdf}`
          : "该论文没有关联 PDF"
      );

      return;
    }

    await this.app.workspace
      .getLeaf("tab")
      .openFile(
        pdfFile
      );

    try {
      this.app.commands
        .executeCommandById(
          "file-explorer:reveal-active-file"
        );
    }
    catch (_) {}

    this.close();
  }

  async renderDetailIfOpen() {
    if (
      this.detailEditingSectionKey
    ) {
      return;
    }

    if (
      !this.detailPaperPath
      || !this.detailContentEl
    ) {
      return;
    }

    const paper =
      this.papers.find(
        (item) =>
          item.file.path
          === this.detailPaperPath
      );

    if (!paper) {
      this.closePaperDetail();
      return;
    }

    this.rootEl?.addClass(
      "has-detail"
    );

    this.detailEl?.removeClass(
      "is-hidden"
    );

    await this.renderPaperDetail(
      paper
    );
  }

  async readPaperDetailSections(
    paper
  ) {
    let content = "";

    try {
      content =
        await this.app.vault
          .cachedRead(
            paper.file
          );
    }
    catch (error) {
      console.debug(
        "Research Library: failed to read Paper Note for detail",
        error
      );
    }

    const extract =
      (headings) =>
        this.extractMarkdownSection(
          content,
          headings
        );

    const abstractHeadings = [
      "abstract",
      "摘要",
    ];

    return {
      abstract:
        this.hasMarkdownSection(
          content,
          abstractHeadings
        )
          ? extract(
              abstractHeadings
            )
          : paper.abstract,
      tldr:
        extract([
          "tl;dr",
          "tldr",
        ]),
      question:
        extract([
          "研究问题",
          "research question",
        ]),
      contribution:
        extract([
          "核心贡献",
          "core contribution",
          "contributions",
        ]),
      notes:
        extract([
          "阅读笔记",
          "reading notes",
          "notes",
        ]),
    };
  }

  hasMarkdownSection(
    content,
    headingNames
  ) {
    if (!content) {
      return false;
    }

    const wanted =
      new Set(
        headingNames.map(
          (value) =>
            String(value)
              .trim()
              .toLowerCase()
        )
      );

    const lines =
      String(content)
        .split(/\r?\n/);

    let inFence = false;
    let fenceToken = "";

    for (
      const line
      of lines
    ) {
      const fence =
        line.match(
          /^\s*(```+|~~~+)/
        );

      if (fence) {
        const token =
          fence[1][0];

        if (!inFence) {
          inFence = true;
          fenceToken = token;
        }
        else if (
          token === fenceToken
        ) {
          inFence = false;
          fenceToken = "";
        }

        continue;
      }

      if (inFence) {
        continue;
      }

      const match =
        line.match(
          /^(#{1,6})\s+(.+?)\s*#*\s*$/
        );

      if (
        match
        && wanted.has(
          match[2]
            .trim()
            .toLowerCase()
        )
      ) {
        return true;
      }
    }

    return false;
  }

  extractMarkdownSection(
    content,
    headingNames
  ) {
    if (!content) return "";

    const wanted =
      new Set(
        headingNames.map(
          (value) =>
            String(value)
              .trim()
              .toLowerCase()
        )
      );

    const lines =
      String(content)
        .split(/\r?\n/);

    let start = -1;
    let level = 0;
    let inFence = false;
    let fenceToken = "";

    for (
      let index = 0;
      index < lines.length;
      index++
    ) {
      const line =
        lines[index];

      const fence =
        line.match(
          /^\s*(```+|~~~+)/
        );

      if (fence) {
        const token =
          fence[1][0];

        if (!inFence) {
          inFence = true;
          fenceToken = token;
        }
        else if (
          token === fenceToken
        ) {
          inFence = false;
          fenceToken = "";
        }

        continue;
      }

      if (inFence) {
        continue;
      }

      const match =
        line.match(
          /^(#{1,6})\s+(.+?)\s*#*\s*$/
        );

      if (!match) continue;

      const name =
        match[2]
          .trim()
          .toLowerCase();

      if (
        wanted.has(name)
      ) {
        start =
          index + 1;

        level =
          match[1].length;

        break;
      }
    }

    if (start < 0) {
      return "";
    }

    inFence = false;
    fenceToken = "";

    let end =
      lines.length;

    for (
      let index = start;
      index < lines.length;
      index++
    ) {
      const line =
        lines[index];

      const fence =
        line.match(
          /^\s*(```+|~~~+)/
        );

      if (fence) {
        const token =
          fence[1][0];

        if (!inFence) {
          inFence = true;
          fenceToken = token;
        }
        else if (
          token === fenceToken
        ) {
          inFence = false;
          fenceToken = "";
        }

        continue;
      }

      if (inFence) {
        continue;
      }

      const match =
        line.match(
          /^(#{1,6})\s+/
        );

      if (
        match
        && match[1].length
          <= level
      ) {
        end = index;
        break;
      }
    }

    return lines
      .slice(
        start,
        end
      )
      .join("\n")
      .trim();
  }

  replaceMarkdownSection(
    content,
    {
      heading,
      aliases = [],
    },
    body
  ) {
    const source =
      String(content || "");

    const newline =
      source.includes("\r\n")
        ? "\r\n"
        : "\n";

    const lines =
      source.split(/\r?\n/);

    const wanted =
      new Set(
        [
          heading,
          ...aliases,
        ]
          .map(
            (value) =>
              String(
                value || ""
              )
                .trim()
                .toLowerCase()
          )
          .filter(Boolean)
      );

    let inFence = false;
    let fenceToken = "";
    let headingIndex = -1;
    let headingLevel = 2;
    let sectionEnd =
      lines.length;

    for (
      let index = 0;
      index < lines.length;
      index++
    ) {
      const line =
        lines[index];

      const fence =
        line.match(
          /^\s*(```+|~~~+)/
        );

      if (fence) {
        const token =
          fence[1][0];

        if (!inFence) {
          inFence = true;
          fenceToken = token;
        }
        else if (
          token === fenceToken
        ) {
          inFence = false;
          fenceToken = "";
        }

        continue;
      }

      if (inFence) {
        continue;
      }

      const match =
        line.match(
          /^(#{1,6})\s+(.+?)\s*#*\s*$/
        );

      if (!match) {
        continue;
      }

      const name =
        match[2]
          .trim()
          .toLowerCase();

      if (
        headingIndex < 0
        && wanted.has(name)
      ) {
        headingIndex =
          index;

        headingLevel =
          match[1].length;

        continue;
      }

      if (
        headingIndex >= 0
        && match[1].length
          <= headingLevel
      ) {
        sectionEnd =
          index;

        break;
      }
    }

    const normalizedBody =
      String(body || "")
        .replace(
          /\r\n/g,
          "\n"
        )
        .trim();

    const bodyLines =
      normalizedBody
        ? normalizedBody.split("\n")
        : [];

    if (
      headingIndex >= 0
    ) {
      const before =
        lines.slice(
          0,
          headingIndex + 1
        );

      const after =
        lines.slice(
          sectionEnd
        );

      const next = [
        ...before,
        "",
        ...bodyLines,
      ];

      if (after.length) {
        next.push(
          "",
          ...after
        );
      }

      return next
        .join(newline)
        .replace(
          /\s+$/,
          ""
        )
        + newline;
    }

    const trimmed =
      source.replace(
        /\s+$/,
        ""
      );

    const prefix =
      trimmed
        ? `${trimmed}${newline}${newline}`
        : "";

    return (
      `${prefix}## ${heading}`
      + `${newline}${newline}`
      + normalizedBody
      + newline
    );
  }

  async updatePaperMarkdownSection(
    paper,
    spec,
    body
  ) {
    if (!paper?.file) {
      return;
    }

    const original =
      await this.app.vault
        .cachedRead(
          paper.file
        );

    const next =
      this.replaceMarkdownSection(
        original,
        spec,
        body
      );

    if (next === original) {
      return;
    }

    this.suppressRefreshUntil =
      Date.now() + 1200;

    await this.app.vault
      .modify(
        paper.file,
        next
      );

    if (
      spec.key === "abstract"
    ) {
      // The Markdown section now intentionally takes precedence
      // over legacy frontmatter abstract.
      paper.abstract =
        paper.abstract || "";
    }

    paper.mtime =
      Date.now();

    this.renderCollectionSurface();

    await this.renderPaperDetail(
      paper
    );
  }

  detailSectionSpec(
    key
  ) {
    const specs = {
      abstract: {
        key:
          "abstract",
        heading:
          "Abstract",
        aliases:
          [
            "abstract",
            "摘要",
          ],
        label:
          "Abstract",
        icon:
          "align-left",
      },
      tldr: {
        key:
          "tldr",
        heading:
          "TL;DR",
        aliases:
          [
            "tl;dr",
            "tldr",
          ],
        label:
          "TL;DR",
        icon:
          "zap",
      },
      question: {
        key:
          "question",
        heading:
          "研究问题",
        aliases:
          [
            "研究问题",
            "research question",
          ],
        label:
          "研究问题",
        icon:
          "circle-help",
      },
      contribution: {
        key:
          "contribution",
        heading:
          "核心贡献",
        aliases:
          [
            "核心贡献",
            "core contribution",
            "contributions",
          ],
        label:
          "核心贡献",
        icon:
          "sparkles",
      },
      notes: {
        key:
          "notes",
        heading:
          "阅读笔记",
        aliases:
          [
            "阅读笔记",
            "reading notes",
            "notes",
          ],
        label:
          "阅读笔记",
        icon:
          "notebook-pen",
      },
    };

    return specs[key]
      || null;
  }

  async renderMarkdownDetail(
    container,
    markdown,
    paper
  ) {
    container.empty();

    if (!markdown) {
      container.createDiv({
        cls:
          "rl-detail-empty-text",
        text:
          "暂无内容",
      });

      return;
    }

    try {
      await MarkdownRenderer.render(
        this.app,
        markdown,
        container,
        paper.file.path,
        this.plugin
      );
    }
    catch (error) {
      console.debug(
        "Research Library: detail Markdown render failed",
        error
      );

      container.createDiv({
        cls:
          "rl-detail-plain-text",
        text:
          markdown,
      });
    }
  }

  detailIconButton(
    parent,
    icon,
    label,
    title = label
  ) {
    const button =
      parent.createEl(
        "button",
        {
          cls:
            "rl-detail-action",
          attr: {
            type:
              "button",
            title,
          },
        }
      );

    this.createIcon(
      button,
      icon,
      "rl-detail-action-icon"
    );

    button.createSpan({
      text:
        label,
    });

    return button;
  }

  detailPropertyRow(
    parent,
    label,
    icon
  ) {
    const row =
      parent.createDiv({
        cls:
          "rl-detail-property",
      });

    const key =
      row.createDiv({
        cls:
          "rl-detail-property-key",
      });

    this.createIcon(
      key,
      icon,
      "rl-detail-property-icon"
    );

    key.createSpan({
      text:
        label,
    });

    const value =
      row.createDiv({
        cls:
          "rl-detail-property-value",
      });

    return {
      row,
      value,
    };
  }

  detailStaticProperty(
    parent,
    label,
    icon,
    value,
    {
      title = "",
      mono = false,
    } = {}
  ) {
    const property =
      this.detailPropertyRow(
        parent,
        label,
        icon
      );

    property.value.createDiv({
      cls:
        `rl-detail-static-value${
          mono
            ? " is-mono"
            : ""
        }`,
      text:
        value || "—",
      attr: {
        title:
          title
          || value
          || "",
      },
    });

    return property;
  }

  detailQuickIconButton(
    parent,
    {
      icon,
      title,
      onClick,
      disabled = false,
    }
  ) {
    const button =
      parent.createEl(
        "button",
        {
          cls:
            "rl-detail-quick-action",
          attr: {
            type:
              "button",
            title:
              title || "",
          },
        }
      );

    this.createIcon(
      button,
      icon,
      "rl-detail-quick-action-icon"
    );

    button.disabled =
      Boolean(disabled);

    button.addEventListener(
      "click",
      async (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (button.disabled) {
          return;
        }

        try {
          await onClick?.();
        }
        catch (error) {
          console.debug(
            "Research Library: detail quick action failed",
            error
          );

          new Notice(
            error?.message
            || "操作失败"
          );
        }
      }
    );

    return button;
  }

  detailStaticActionProperty(
    parent,
    label,
    icon,
    value,
    {
      title = "",
      mono = false,
      actions = [],
    } = {}
  ) {
    const property =
      this.detailPropertyRow(
        parent,
        label,
        icon
      );

    const control =
      property.value.createDiv({
        cls:
          "rl-detail-value-control",
      });

    control.createDiv({
      cls:
        `rl-detail-static-value${
          mono
            ? " is-mono"
            : ""
        }`,
      text:
        value || "—",
      attr: {
        title:
          title
          || value
          || "",
      },
    });

    if (
      actions.length
    ) {
      const actionWrap =
        control.createDiv({
          cls:
            "rl-detail-quick-actions",
        });

      for (
        const action
        of actions
      ) {
        if (
          action.when
          && !action.when()
        ) {
          continue;
        }

        this.detailQuickIconButton(
          actionWrap,
          action
        );
      }
    }

    return property;
  }

  metadataSourceDisplayName(
    source
  ) {
    const key =
      String(
        source || ""
      ).trim();

    const labels = {
      "semantic-scholar":
        "Semantic Scholar",
      openreview:
        "OpenReview",
      dblp:
        "DBLP",
      pmlr:
        "PMLR",
      openalex:
        "OpenAlex",
      crossref:
        "Crossref",
      datacite:
        "DataCite",
      "citation-gb":
        "GB/T 7714",
      "citation-llm":
        "LLM Citation",
      pdf:
        "PDF metadata",
    };

    return labels[key]
      || key;
  }

  importMethodDisplayName(
    method
  ) {
    const labels = {
      doi:
        "DOI 精确匹配",
      arxiv:
        "arXiv 精确匹配",
      "title-search":
        "数据库标题检索",
      "llm-rescue":
        "LLM 标题救援 → 数据库",
      "citation-rescue":
        "参考文献修复 → 数据库",
      "citation-text":
        "直接使用参考文献元数据",
      "pdf-only":
        "直接使用 PDF metadata",
    };

    return labels[
      String(
        method || ""
      )
    ]
      || method
      || "未知";
  }

  detailEditableProperty(
    parent,
    paper,
    {
      label,
      icon,
      field,
      frontmatterKey,
      value,
      kind = "text",
      placeholder = "—",
      normalize = null,
      quickActions = [],
    }
  ) {
    const property =
      this.detailPropertyRow(
        parent,
        label,
        icon
      );

    const renderValue =
      () => {
        property.value.empty();

        const current =
          field === "authors"
            ? (
                paper.authors
                  ?.join("; ")
                || ""
              )
            : String(
                paper[field]
                ?? value
                ?? ""
              );

        const control =
          property.value.createDiv({
            cls:
              "rl-detail-value-control",
          });

        const button =
          control.createEl(
            "button",
            {
              cls:
                "rl-detail-value-button",
              text:
                current
                || placeholder,
              attr: {
                type:
                  "button",
                title:
                  `点击编辑 ${label}`,
              },
            }
          );

        if (!current) {
          button.addClass(
            "is-empty"
          );
        }

        if (
          quickActions.length
        ) {
          const actionWrap =
            control.createDiv({
              cls:
                "rl-detail-quick-actions",
            });

          for (
            const action
            of quickActions
          ) {
            if (
              action.when
              && !action.when(
                current
              )
            ) {
              continue;
            }

            this.detailQuickIconButton(
              actionWrap,
              {
                ...action,
                onClick:
                  () =>
                    action.onClick?.(
                      current
                    ),
              }
            );
          }
        }

        button.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            event.stopPropagation();

            property.value.empty();

            const input =
              property.value.createEl(
                kind === "textarea"
                  ? "textarea"
                  : "input",
                {
                  cls:
                    "rl-detail-inline-input",
                  attr:
                    kind === "textarea"
                      ? {
                          rows:
                            "3",
                        }
                      : {
                          type:
                            kind === "number"
                              ? "number"
                              : "text",
                        },
                }
              );

            input.value =
              current;

            const cancel =
              () => {
                renderValue();
              };

            let saving = false;

            const save =
              async () => {
                if (saving) return;

                saving = true;

                try {
                  let next =
                    input.value.trim();

                  if (normalize) {
                    next =
                      normalize(next);
                  }

                  if (
                    kind === "number"
                    && next
                  ) {
                    const numeric =
                      Number(next);

                    if (
                      !Number.isFinite(
                        numeric
                      )
                      || numeric < 1800
                      || numeric > 2100
                    ) {
                      throw new Error(
                        "年份必须在 1800–2100 之间"
                      );
                    }

                    next =
                      String(
                        Math.round(
                          numeric
                        )
                      );
                  }

                  let fmValue =
                    next;

                  if (
                    field === "authors"
                  ) {
                    fmValue =
                      next
                        .split(
                          /\s*;\s*|\n+/u
                        )
                        .map(
                          (author) =>
                            author.trim()
                        )
                        .filter(Boolean);
                  }

                  await this.updatePaperDetailField(
                    paper,
                    frontmatterKey,
                    fmValue,
                    field
                  );
                }
                catch (error) {
                  saving =
                    false;

                  new Notice(
                    error?.message
                    || `更新 ${label} 失败`
                  );

                  input.focus();

                  return;
                }
              };

            input.addEventListener(
              "keydown",
              (event) => {
                if (
                  event.key
                    === "Escape"
                ) {
                  event.preventDefault();
                  cancel();
                  return;
                }

                if (
                  event.key
                    === "Enter"
                  && (
                    kind
                    !== "textarea"
                    || (
                      event.ctrlKey
                      || event.metaKey
                    )
                  )
                ) {
                  event.preventDefault();
                  void save();
                }
              }
            );

            input.addEventListener(
              "blur",
              () => {
                void save();
              },
              {
                once:
                  true,
              }
            );

            window.setTimeout(
              () => {
                input.focus();
                input.select?.();
              },
              0
            );
          }
        );
      };

    renderValue();

    return property;
  }

  async updatePaperDetailField(
    paper,
    frontmatterKey,
    value,
    paperField
  ) {
    this.suppressRefreshUntil =
      Date.now() + 850;

    await this.app.fileManager
      .processFrontMatter(
        paper.file,
        (fm) => {
          if (
            value === ""
            || (
              Array.isArray(value)
              && !value.length
            )
          ) {
            fm[frontmatterKey] =
              Array.isArray(value)
                ? []
                : "";
          }
          else {
            fm[frontmatterKey] =
              value;
          }
        }
      );

    if (
      paperField === "authors"
    ) {
      paper.authors =
        Array.isArray(value)
          ? value
          : [];
    }
    else if (
      paperField === "doi"
    ) {
      paper.doi =
        this.normalizeDoi(
          value
        );
    }
    else {
      paper[paperField] =
        value;
    }

    this.renderCollectionSurface();

    await this.syncBibliographyIfEnabled();

    await this.renderPaperDetail(
      paper
    );
  }

  detailChipList(
    container,
    values,
    {
      empty =
        "—",
      topicColors =
        false,
    } = {}
  ) {
    const list =
      (
        Array.isArray(values)
          ? values
          : []
      )
        .filter(Boolean);

    if (!list.length) {
      container.createSpan({
        cls:
          "rl-detail-empty-value",
        text:
          empty,
      });

      return;
    }

    const wrap =
      container.createDiv({
        cls:
          "rl-detail-chip-list",
      });

    for (
      const value
      of list
    ) {
      const chip =
        wrap.createSpan({
          cls:
            "rl-detail-chip",
          text:
            value,
          attr: {
            title:
              value,
          },
        });

      if (topicColors) {
        this.applyTopicColor(
          chip,
          value
        );
      }
    }
  }

  renderDetailOrganizationEditor(
    parent,
    paper,
    type
  ) {
    const config =
      this.organizationConfig(type);

    const property =
      this.detailPropertyRow(
        parent,
        config.plural,
        config.icon
      );

    const values =
      paper[config.field]
      || [];

    const button =
      property.value.createEl(
        "button",
        {
          cls:
            "rl-detail-organization-editor",
          attr: {
            type: "button",
            title:
              `编辑 ${config.plural}`,
          },
        }
      );

    if (values.length) {
      const wrap =
        button.createSpan({
          cls:
            "rl-detail-chip-list",
        });

      for (
        const value
        of values.slice(0, 4)
      ) {
        const chip =
          wrap.createSpan({
            cls:
              "rl-detail-chip",
            text: value,
            attr: {
              title: value,
            },
          });

        if (type === "topic") {
          this.applyTopicColor(
            chip,
            value
          );
        }
      }

      if (values.length > 4) {
        wrap.createSpan({
          cls:
            "rl-detail-topic-more",
          text:
            `+${values.length - 4}`,
        });
      }
    }
    else {
      this.createIcon(
        button,
        "plus",
        "rl-detail-topic-add-icon"
      );

      button.createSpan({
        text:
          `添加 ${config.label}`,
      });
    }

    button.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        this.openOrganizationPopover({
          anchor: button,
          paper,
          type,
        });
      }
    );

    return property;
  }

  async renderEditableNarrativeSection(
    parent,
    paper,
    spec,
    content
  ) {
    const section =
      parent.createDiv({
        cls:
          "rl-detail-narrative",
      });

    const header =
      section.createDiv({
        cls:
          "rl-detail-section-title",
      });

    const heading =
      header.createDiv({
        cls:
          "rl-detail-section-heading",
      });

    this.createIcon(
      heading,
      spec.icon,
      "rl-detail-section-icon"
    );

    heading.createSpan({
      text:
        spec.label,
    });

    const edit =
      header.createEl(
        "button",
        {
          cls:
            "rl-detail-section-edit",
          attr: {
            type:
              "button",
            title:
              `${content ? "编辑" : "添加"} ${spec.label}`,
          },
        }
      );

    this.createIcon(
      edit,
      content
        ? "pencil-line"
        : "plus",
      "rl-detail-section-edit-icon"
    );

    edit.createSpan({
      text:
        content
          ? "编辑"
          : "添加",
    });

    const body =
      section.createDiv({
        cls:
          "rl-detail-markdown",
      });

    await this.renderMarkdownDetail(
      body,
      content,
      paper
    );

    const startEditing =
      () => {
        if (
          this.detailEditingSectionKey
          && this.detailEditingSectionKey
            !== spec.key
        ) {
          new Notice(
            "请先保存或取消当前 Markdown 编辑。"
          );

          return;
        }

        this.detailEditingSectionKey =
          spec.key;

        this.detailEditingPaperPath =
          paper.file.path;

        this.detailEl?.addClass(
          "is-section-editing"
        );

        this.rootEl?.addClass(
          "is-detail-section-editing"
        );

        section.addClass(
          "is-editing"
        );

        body.empty();

        const editor =
          body.createDiv({
            cls:
              "rl-detail-section-editor",
          });

        const textarea =
          editor.createEl(
            "textarea",
            {
              cls:
                "rl-detail-section-textarea",
              attr: {
                spellcheck:
                  "false",
                placeholder:
                  `在 Markdown 中编辑 ${spec.label}…`,
              },
            }
          );

        textarea.value =
          content || "";

        const footer =
          editor.createDiv({
            cls:
              "rl-detail-section-editor-actions",
          });

        footer.createDiv({
          cls:
            "rl-detail-section-shortcut",
          text:
            "Ctrl/Cmd + Enter 保存 · Esc 取消",
        });

        const buttons =
          footer.createDiv({
            cls:
              "rl-detail-section-editor-buttons",
          });

        const cancel =
          buttons.createEl(
            "button",
            {
              cls:
                "rl-detail-section-cancel",
              text:
                "取消",
              attr: {
                type:
                  "button",
              },
            }
          );

        const save =
          buttons.createEl(
            "button",
            {
              cls:
                "mod-cta rl-detail-section-save",
              text:
                "保存",
              attr: {
                type:
                  "button",
              },
            }
          );

        let saving =
          false;

        const restore =
          async () => {
            this.detailEditingSectionKey =
              null;

            this.detailEditingPaperPath =
              null;

            this.detailEl?.removeClass(
              "is-section-editing"
            );

            this.rootEl?.removeClass(
              "is-detail-section-editing"
            );

            section.removeClass(
              "is-editing"
            );

            await this.renderMarkdownDetail(
              body,
              content,
              paper
            );
          };

        const saveValue =
          async () => {
            if (saving) {
              return;
            }

            saving = true;

            save.disabled =
              true;

            cancel.disabled =
              true;

            save.setText(
              "保存中…"
            );

            try {
              this.detailEditingSectionKey =
                null;

              this.detailEditingPaperPath =
                null;

              this.detailEl?.removeClass(
                "is-section-editing"
              );

              this.rootEl?.removeClass(
                "is-detail-section-editing"
              );

              await this.updatePaperMarkdownSection(
                paper,
                spec,
                textarea.value
              );
            }
            catch (error) {
              this.detailEditingSectionKey =
                spec.key;

              this.detailEditingPaperPath =
                paper.file.path;

              this.detailEl?.addClass(
                "is-section-editing"
              );

              this.rootEl?.addClass(
                "is-detail-section-editing"
              );

              saving =
                false;

              save.disabled =
                false;

              cancel.disabled =
                false;

              save.setText(
                "保存"
              );

              new Notice(
                `保存 ${spec.label} 失败：${
                  error?.message
                  || String(error)
                }`,
                7000
              );

              textarea.focus();
            }
          };

        cancel.addEventListener(
          "click",
          () => {
            void restore();
          }
        );

        save.addEventListener(
          "click",
          () => {
            void saveValue();
          }
        );

        textarea.addEventListener(
          "keydown",
          (event) => {
            if (
              event.key === "Escape"
            ) {
              event.preventDefault();

              void restore();

              return;
            }

            if (
              event.key === "Enter"
              && (
                event.ctrlKey
                || event.metaKey
              )
            ) {
              event.preventDefault();

              void saveValue();
            }
          }
        );

        window.setTimeout(
          () => {
            textarea.focus();

            textarea.setSelectionRange(
              textarea.value.length,
              textarea.value.length
            );
          },
          0
        );
      };

    edit.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        startEditing();
      }
    );
  }

  renderDetailFigureHero(
    detail,
    paper
  ) {
    const paths =
      this.figurePaths(
        paper
      );

    const section =
      detail.createDiv({
        cls:
          `rl-detail-figure-section${
            paths.length
              ? " has-figure"
              : " is-empty"
          }`,
      });

    if (!paths.length) {
      const add =
        section.createEl(
          "button",
          {
            cls:
              "rl-detail-figure-empty",
            attr: {
              type:
                "button",
              title:
                "添加模型图 / 论文图片",
            },
          }
        );

      this.createIcon(
        add,
        "image-plus"
      );

      add.createSpan({
        text:
          "Add figure",
      });

      add.addEventListener(
        "click",
        () => {
          this.openFigureManager(
            paper
          );
        }
      );

      return;
    }

    let index =
      Number(
        this.detailFigureIndexByPath
          .get(
            paper.file.path
          )
        || 0
      );

    index =
      Math.max(
        0,
        Math.min(
          index,
          paths.length - 1
        )
      );

    this.detailFigureIndexByPath
      .set(
        paper.file.path,
        index
      );

    const entry =
      this.figureEntriesForPaper(
        paper
      )[index];

    const toolbar =
      section.createDiv({
        cls:
          "rl-detail-figure-toolbar",
      });

    if (
      paths.length > 1
    ) {
      toolbar.createSpan({
        cls:
          "rl-detail-figure-count",
        text:
          `${index + 1} / ${paths.length}`,
      });
    }

    const toolActions =
      toolbar.createDiv({
        cls:
          "rl-detail-figure-actions",
      });

    if (entry?.file) {
      const view =
        toolActions.createEl(
          "button",
          {
            cls:
              "rl-detail-figure-action",
            attr: {
              type:
                "button",
              title:
                "查看大图",
            },
          }
        );

      this.createIcon(
        view,
        "maximize-2"
      );

      view.addEventListener(
        "click",
        () => {
          this.openFigureViewer(
            paper,
            index
          );
        }
      );
    }

    const manage =
      toolActions.createEl(
        "button",
        {
          cls:
            "rl-detail-figure-action",
          attr: {
            type:
              "button",
            title:
              "管理图片",
          },
        }
      );

    this.createIcon(
      manage,
      "images"
    );

    manage.addEventListener(
      "click",
      () => {
        this.openFigureManager(
          paper
        );
      }
    );

    const stage =
      section.createEl(
        "button",
        {
          cls:
            "rl-detail-figure-stage",
          attr: {
            type:
              "button",
            title:
              entry?.file
                ? "查看大图"
                : "图片文件不存在",
          },
        }
      );

    if (entry?.file) {
      stage.createEl(
        "img",
        {
          cls:
            "rl-detail-figure-image",
          attr: {
            src:
              this.figureResourcePath(
                entry.file
              ),
            alt:
              `${paper.title} figure ${
                index + 1
              }`,
            decoding:
              "async",
          },
        }
      );

      stage.addEventListener(
        "click",
        () => {
          this.openFigureViewer(
            paper,
            index
          );
        }
      );
    }
    else {
      const missing =
        stage.createDiv({
          cls:
            "rl-detail-figure-missing",
        });

      this.createIcon(
        missing,
        "image-off"
      );

      missing.createSpan({
        text:
          "Missing image",
      });
    }

    if (
      paths.length > 1
    ) {
      const strip =
        section.createDiv({
          cls:
            "rl-detail-figure-strip",
        });

      const entries =
        this.figureEntriesForPaper(
          paper
        );

      entries.forEach(
        (
          item,
          itemIndex
        ) => {
          const thumb =
            strip.createEl(
              "button",
              {
                cls:
                  `rl-detail-figure-thumb${
                    itemIndex === index
                      ? " is-active"
                      : ""
                  }`,
                attr: {
                  type:
                    "button",
                  title:
                    `Figure ${
                      itemIndex + 1
                    }`,
                },
              }
            );

          if (item.file) {
            thumb.createEl(
              "img",
              {
                attr: {
                  src:
                    this.figureResourcePath(
                      item.file
                    ),
                  alt:
                    "",
                  loading:
                    "lazy",
                },
              }
            );
          }
          else {
            this.createIcon(
              thumb,
              "image-off"
            );
          }

          thumb.addEventListener(
            "click",
            () => {
              this.detailFigureIndexByPath
                .set(
                  paper.file.path,
                  itemIndex
                );

              void this.renderPaperDetail(
                paper
              );
            }
          );
        }
      );
    }
  }

  async renderPaperDetail(paper) {
    if (
      !this.detailContentEl
      || !paper?.file
    ) {
      return;
    }

    const token =
      ++this.detailRenderToken;

    const detail =
      this.detailContentEl;

    detail.empty();

    const header =
      detail.createDiv({
        cls:
          "rl-detail-header",
      });

    const headerTop =
      header.createDiv({
        cls:
          "rl-detail-header-top",
      });

    headerTop.createDiv({
      cls:
        "rl-detail-eyebrow",
      text:
        "Paper Detail",
    });

    const navigation =
      this.detailNavigationState(
        paper
      );

    const headerControls =
      headerTop.createDiv({
        cls:
          "rl-detail-header-controls",
      });

    const nav =
      headerControls.createDiv({
        cls:
          "rl-detail-nav",
      });

    const previous =
      nav.createEl(
        "button",
        {
          cls:
            "rl-detail-nav-button",
          attr: {
            type:
              "button",
            title:
              "上一篇论文 · ↑",
            "aria-label":
              "上一篇论文",
          },
        }
      );

    this.createIcon(
      previous,
      "chevron-up",
      "rl-detail-nav-icon"
    );

    previous.disabled =
      !navigation.hasPrevious;

    previous.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        void this.navigatePaperDetail(
          -1
        );
      }
    );

    nav.createSpan({
      cls:
        "rl-detail-nav-count",
      text:
        navigation.label,
    });

    const next =
      nav.createEl(
        "button",
        {
          cls:
            "rl-detail-nav-button",
          attr: {
            type:
              "button",
            title:
              "下一篇论文 · ↓",
            "aria-label":
              "下一篇论文",
          },
        }
      );

    this.createIcon(
      next,
      "chevron-down",
      "rl-detail-nav-icon"
    );

    next.disabled =
      !navigation.hasNext;

    next.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        void this.navigatePaperDetail(
          1
        );
      }
    );

    const close =
      headerControls.createEl(
        "button",
        {
          cls:
            "rl-detail-close",
          attr: {
            type:
              "button",
            title:
              "关闭详情 · Esc",
          },
        }
      );

    this.createIcon(
      close,
      "x",
      "rl-detail-close-icon"
    );

    close.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        this.closePaperDetail();
      }
    );

    header.createEl(
      "h2",
      {
        cls:
          "rl-detail-title",
        text:
          paper.title,
      }
    );

    header.createDiv({
      cls:
        "rl-detail-byline",
      text:
        [
          this.shortAuthors(
            paper.authors
          ),
          paper.venue || "",
          paper.year || "",
        ]
          .filter(Boolean)
          .join(" · ")
        || "Bibliographic metadata incomplete",
    });

    const actions =
      header.createDiv({
        cls:
          "rl-detail-actions",
      });

    if (paper.pdf) {
      const openPdf =
        this.detailIconButton(
          actions,
          "file-type-2",
          "Open PDF",
          "打开本地 PDF · Shift+Enter"
        );

      openPdf.addEventListener(
        "click",
        () => {
          void this.openDetailPdf(
            paper
          );
        }
      );
    }

    const openNote =
      this.detailIconButton(
        actions,
        "file-text",
        "Open Note",
        "打开 Paper Note · Ctrl/Cmd+Enter"
      );

    openNote.addEventListener(
      "click",
      () => {
        void this.openDetailNote(
          paper
        );
      }
    );

    const cite =
      this.detailIconButton(
        actions,
        "quote",
        "Cite",
        "复制引用 / BibTeX"
      );

    cite.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        this.openPaperCitationPopover(
          cite,
          paper
        );
      }
    );

    const shortcutHint =
      actions.createDiv({
        cls:
          "rl-detail-shortcuts",
        text:
          "↑/↓ 浏览 · Esc 关闭",
      });

    this.renderDetailFigureHero(
      detail,
      paper
    );

    const propertySection =
      detail.createDiv({
        cls:
          "rl-detail-properties",
      });

    propertySection.createDiv({
      cls:
        "rl-detail-section-label",
      text:
        "Properties",
    });

    // Status
    {
      const property =
        this.detailPropertyRow(
          propertySection,
          "状态",
          "circle-dot"
        );

      const button =
        property.value.createEl(
          "button",
          {
            cls:
              `rl-status-pill rl-status-${paper.status}`,
            attr: {
              type:
                "button",
              "aria-haspopup":
                "menu",
              title:
                "修改状态",
            },
          }
        );

      this.renderStatusPill(
        button,
        paper.status
      );

      button.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopPropagation();

          this.openStatusPopover({
            anchor:
              button,
            paper,
            row:
              property.row,
          });
        }
      );
    }

    // Rating
    {
      const property =
        this.detailPropertyRow(
          propertySection,
          "重要程度",
          "star"
        );

      this.renderRatingEditor({
        cell:
          property.value,
        paper,
        row:
          property.row,
      });
    }

    // Topics
    {
      const property =
        this.detailPropertyRow(
          propertySection,
          "主题",
          "tags"
        );

      const topicButton =
        property.value.createEl(
          "button",
          {
            cls:
              "rl-detail-topic-editor",
            attr: {
              type:
                "button",
              title:
                "编辑 Topics",
            },
          }
        );

      if (
        paper.topics.length
      ) {
        const wrap =
          topicButton.createSpan({
            cls:
              "rl-detail-topic-chips",
          });

        for (
          const topic
          of paper.topics.slice(
            0,
            4
          )
        ) {
          const chip =
            wrap.createSpan({
              cls:
                "rl-detail-topic-chip",
              text:
                topic,
            });

          this.applyTopicColor(
            chip,
            topic
          );
        }

        if (
          paper.topics.length > 4
        ) {
          wrap.createSpan({
            cls:
              "rl-detail-topic-more",
            text:
              `+${paper.topics.length - 4}`,
          });
        }
      }
      else {
        this.createIcon(
          topicButton,
          "plus",
          "rl-detail-topic-add-icon"
        );

        topicButton.createSpan({
          text:
            "添加 Topic",
        });
      }

      topicButton.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopPropagation();

          this.openTopicPopover({
            anchor:
              topicButton,
            paper,
            row:
              property.row,
          });
        }
      );
    }

    this.detailEditableProperty(
      propertySection,
      paper,
      {
        label:
          "作者",
        icon:
          "users",
        field:
          "authors",
        frontmatterKey:
          "authors",
        value:
          paper.authors.join("; "),
        kind:
          "textarea",
        placeholder:
          "添加作者",
      }
    );

    this.detailEditableProperty(
      propertySection,
      paper,
      {
        label:
          "年份",
        icon:
          "calendar-days",
        field:
          "year",
        frontmatterKey:
          "year",
        value:
          paper.year,
        kind:
          "number",
        placeholder:
          "添加年份",
      }
    );

    this.detailEditableProperty(
      propertySection,
      paper,
      {
        label:
          "发表单位",
        icon:
          "landmark",
        field:
          "venue",
        frontmatterKey:
          "venue",
        value:
          paper.venue,
        placeholder:
          "添加 Venue",
      }
    );

    this.detailEditableProperty(
      propertySection,
      paper,
      {
        label:
          "DOI",
        icon:
          "external-link",
        field:
          "doi",
        frontmatterKey:
          "doi",
        value:
          paper.doi,
        placeholder:
          "添加 DOI",
        normalize:
          (value) =>
            this.normalizeDoi(
              value
            ),
        quickActions: [
          {
            icon:
              "copy",
            title:
              "复制 DOI",
            when:
              (value) =>
                Boolean(value),
            onClick:
              (value) =>
                this.copyDetailText(
                  value,
                  "DOI"
                ),
          },
          {
            icon:
              "external-link",
            title:
              "打开 DOI",
            when:
              (value) =>
                Boolean(value),
            onClick:
              (value) =>
                this.openExternalDetailUrl(
                  `https://doi.org/${encodeURI(
                    value
                  )}`,
                  paper
                ),
          },
        ],
      }
    );

    this.detailEditableProperty(
      propertySection,
      paper,
      {
        label:
          "arXiv",
        icon:
          "file-search",
        field:
          "arxiv",
        frontmatterKey:
          "arxiv",
        value:
          paper.arxiv,
        placeholder:
          "添加 arXiv ID",
        normalize:
          (value) =>
            String(value || "")
              .replace(
                /^arxiv:\s*/i,
                ""
              )
              .replace(
                /v\d+$/i,
                ""
              )
              .trim(),
        quickActions: [
          {
            icon:
              "copy",
            title:
              "复制 arXiv ID",
            when:
              (value) =>
                Boolean(value),
            onClick:
              (value) =>
                this.copyDetailText(
                  value,
                  "arXiv ID"
                ),
          },
          {
            icon:
              "external-link",
            title:
              "打开 arXiv",
            when:
              (value) =>
                Boolean(value),
            onClick:
              (value) =>
                this.openExternalDetailUrl(
                  `https://arxiv.org/abs/${encodeURI(
                    value
                  )}`,
                  paper
                ),
          },
        ],
      }
    );

    {
      const property =
        this.detailPropertyRow(
          propertySection,
          "Citekey",
          "key-round"
        );

      const control =
        property.value.createDiv({
          cls:
            "rl-detail-value-control",
        });

      control.createDiv({
        cls:
          "rl-detail-static-value is-mono",
        text:
          paper.citekey
          || "添加 Citekey",
        attr: {
          title:
            paper.citekey
            || "添加 Citekey",
        },
      });

      const actionWrap =
        control.createDiv({
          cls:
            "rl-detail-quick-actions",
        });

      if (paper.citekey) {
        this.detailQuickIconButton(
          actionWrap,
          {
            icon:
              "copy",
            title:
              "复制 Citekey",
            onClick:
              () =>
                this.copyDetailText(
                  paper.citekey,
                  "Citekey"
                ),
          }
        );
      }

      this.detailQuickIconButton(
        actionWrap,
        {
          icon:
            "pencil-line",
          title:
            paper.citekey
              ? "修改 Citekey"
              : "添加 Citekey",
          onClick:
            () =>
              this.openCitekeyEditor(
                actionWrap,
                paper
              ),
        }
      );
    }

    this.detailStaticActionProperty(
      propertySection,
      "PDF",
      "file-type-2",
      paper.pdf
        || "—",
      {
        title:
          paper.pdf,
        actions: [
          {
            icon:
              "play",
            title:
              "打开 PDF",
            when:
              () =>
                Boolean(
                  paper.pdf
                ),
            onClick:
              () =>
                this.openDetailPdf(
                  paper
                ),
          },
          {
            icon:
              "copy",
            title:
              "复制 PDF 路径",
            when:
              () =>
                Boolean(
                  paper.pdf
                ),
            onClick:
              () =>
                this.copyDetailText(
                  paper.pdf,
                  "PDF 路径"
                ),
          },
          {
            icon:
              "folder-open",
            title:
              "在文件列表中定位 PDF",
            when:
              () =>
                Boolean(
                  paper.pdf
                ),
            onClick:
              () =>
                this.revealDetailPdf(
                  paper
                ),
          },
        ],
      }
    );

    const organization =
      detail.createDiv({
        cls:
          "rl-detail-properties rl-detail-organization",
      });

    const organizationHeader =
      organization.createDiv({
        cls:
          "rl-detail-section-label rl-detail-organization-label",
      });

    organizationHeader.createSpan({
      text: "Research Context",
    });

    const manageOrganization =
      organizationHeader.createEl(
        "button",
        {
          cls:
            "rl-detail-organization-manage",
          attr: {
            type: "button",
            title:
              "管理 Topic / Project",
          },
        }
      );

    this.createIcon(
      manageOrganization,
      "settings-2",
      "rl-detail-organization-manage-icon"
    );

    manageOrganization.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openOrganizationManager(
          "project"
        );
      }
    );

    this.renderDetailOrganizationEditor(
      organization,
      paper,
      "project"
    );

    // Lists are intentionally secondary: they represent explicit,
    // manual paper membership, not knowledge classification.
    const lists =
      detail.createDiv({
        cls:
          "rl-detail-properties rl-detail-lists",
      });

    const listsHeader =
      lists.createDiv({
        cls:
          "rl-detail-section-label rl-detail-organization-label",
      });

    const listsTitle =
      listsHeader.createDiv({
        cls:
          "rl-detail-list-title-wrap",
      });

    listsTitle.createSpan({
      text: "Lists",
    });

    listsTitle.createSpan({
      cls:
        "rl-detail-list-hint",
      text:
        "手工文献列表",
    });

    const manageLists =
      listsHeader.createEl(
        "button",
        {
          cls:
            "rl-detail-organization-manage",
          attr: {
            type: "button",
            title:
              "管理人工文献列表",
          },
        }
      );

    this.createIcon(
      manageLists,
      "settings-2",
      "rl-detail-organization-manage-icon"
    );

    manageLists.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openOrganizationManager(
          "collection"
        );
      }
    );

    this.renderDetailOrganizationEditor(
      lists,
      paper,
      "collection"
    );

    // Reading dates
    const reading =
      detail.createDiv({
        cls:
          "rl-detail-properties",
      });

    reading.createDiv({
      cls:
        "rl-detail-section-label",
      text:
        "Reading",
    });

    this.detailStaticProperty(
      reading,
      "添加日期",
      "calendar-plus",
      paper.dateAdded
    );

    this.detailStaticProperty(
      reading,
      "开始阅读",
      "play",
      paper.dateStarted,
      {
        title:
          paper.dateStarted
          || "首次切换到“进行中”时自动记录；若直接标记“已完成”，会自动补齐",
      }
    );

    this.detailStaticProperty(
      reading,
      "完成阅读",
      "check-check",
      paper.dateRead,
      {
        title:
          paper.dateRead
          || "首次切换到“已完成”时自动记录",
      }
    );

    // Metadata provenance
    const provenance =
      detail.createDiv({
        cls:
          `rl-detail-provenance-card ${
            paper.metadataVerified
              ? "is-verified"
              : "is-unverified"
          }`,
      });

    const provenanceHeader =
      provenance.createDiv({
        cls:
          "rl-detail-provenance-header",
      });

    const provenanceStatus =
      provenanceHeader.createDiv({
        cls:
          "rl-detail-provenance-status",
      });

    const provenanceIcon =
      provenanceStatus.createSpan({
        cls:
          "rl-detail-provenance-icon",
      });

    this.createIcon(
      provenanceIcon,
      paper.metadataVerified
        ? "badge-check"
        : "circle-help"
    );

    provenanceStatus.createSpan({
      text:
        paper.metadataVerified
          ? "Metadata verified"
          : "Metadata unverified",
    });

    if (paper.metadataUpdated) {
      provenanceHeader.createSpan({
        cls:
          "rl-detail-provenance-updated",
        text:
          paper.metadataUpdated,
        attr: {
          title:
            "metadata_updated",
        },
      });
    }

    const provenanceGrid =
      provenance.createDiv({
        cls:
          "rl-detail-provenance-grid",
      });

    const sourceRow =
      provenanceGrid.createDiv({
        cls:
          "rl-detail-provenance-row",
      });

    sourceRow.createSpan({
      cls:
        "rl-detail-provenance-key",
      text:
        "来源",
    });

    const sourceValues =
      sourceRow.createDiv({
        cls:
          "rl-detail-provenance-sources",
      });

    const provenanceSources =
      (
        paper.metadataSources
          ?.length
          ? paper.metadataSources
          : paper.metadataSource
            ? [
                paper.metadataSource,
              ]
            : []
      );

    if (
      provenanceSources.length
    ) {
      for (
        const source
        of provenanceSources
      ) {
        sourceValues.createSpan({
          cls:
            "rl-detail-provenance-chip",
          text:
            this.metadataSourceDisplayName(
              source
            ),
        });
      }
    }
    else {
      sourceValues.createSpan({
        cls:
          "rl-detail-provenance-empty",
        text:
          "—",
      });
    }

    const methodRow =
      provenanceGrid.createDiv({
        cls:
          "rl-detail-provenance-row",
      });

    methodRow.createSpan({
      cls:
        "rl-detail-provenance-key",
      text:
        "方式",
    });

    methodRow.createSpan({
      cls:
        "rl-detail-provenance-method",
      text:
        this.importMethodDisplayName(
          paper.importMethod
        ),
    });

    const publicationState =
      this.publicationStatus(
        this.paperAsMetadata(
          paper
        )
      );

    const publicationRow =
      provenanceGrid.createDiv({
        cls:
          "rl-detail-provenance-row",
      });

    publicationRow.createSpan({
      cls:
        "rl-detail-provenance-key",
      text:
        "出版",
    });

    publicationRow.createSpan({
      cls:
        `rl-detail-publication-status is-${publicationState}`,
      text:
        publicationState === "formal"
          ? "Formal publication"
          : publicationState === "preprint"
            ? "Preprint / arXiv"
            : "Unknown",
      attr: {
        title:
          paper.publicationResolution
          || paper.publicationStatus
          || publicationState,
      },
    });

    if (paper.metadataMatch) {
      const matchRow =
        provenanceGrid.createDiv({
          cls:
            "rl-detail-provenance-row",
        });

      matchRow.createSpan({
        cls:
          "rl-detail-provenance-key",
        text:
          "匹配",
      });

      matchRow.createSpan({
        cls:
          "rl-detail-provenance-method",
        text:
          paper.metadataMatch,
      });
    }

    const narrative =
      detail.createDiv({
        cls:
          "rl-detail-narrative-wrap",
      });

    const loading =
      narrative.createDiv({
        cls:
          "rl-detail-loading",
      });

    this.createIcon(
      loading,
      "loader-circle",
      "rl-detail-loading-icon"
    );

    loading.createSpan({
      text:
        "正在读取笔记内容…",
    });

    const sections =
      await this.readPaperDetailSections(
        paper
      );

    if (
      token
      !== this.detailRenderToken
      || this.detailPaperPath
        !== paper.file.path
    ) {
      return;
    }

    narrative.empty();

    for (
      const key
      of [
        "abstract",
        "tldr",
        "question",
        "contribution",
        "notes",
      ]
    ) {
      const spec =
        this.detailSectionSpec(
          key
        );

      if (!spec) continue;

      await this.renderEditableNarrativeSection(
        narrative,
        paper,
        spec,
        sections[key]
        || ""
      );
    }

  }

  observeTopicEditor(editor) {
    if (!editor) return;

    this.topicResizeObserver?.observe(
      editor
    );

    // Layout after insertion into the DOM.
    window.requestAnimationFrame(() => {
      this.updateTopicEditorLayout(
        editor
      );
    });
  }

  topicElementWidth(element) {
    if (!element) return 0;

    // Elements stay measurable even when the current layout hides them
    // because v0.3.4 uses visibility/positioning classes instead of
    // display:none for measurement candidates.
    return Math.ceil(
      element.getBoundingClientRect().width
    );
  }

  updateTopicEditorLayout(editor) {
    if (
      !editor
      || !editor.isConnected
    ) {
      return;
    }

    const available =
      Math.floor(editor.clientWidth);

    if (available <= 0) return;

    const primary =
      editor.querySelector(
        ".rl-topic-primary"
      );

    const secondary =
      editor.querySelector(
        ".rl-topic-secondary"
      );

    const wideMore =
      editor.querySelector(
        ".rl-topic-more-wide"
      );

    const compactMore =
      editor.querySelector(
        ".rl-topic-more-compact"
      );

    const mini =
      editor.querySelector(
        ".rl-topic-mini"
      );

    // Reset only the state attribute.
    // Candidate nodes remain intrinsically sized/measurable.
    editor.removeAttribute(
      "data-topic-layout"
    );

    const gap = 5;

    const primaryWidth =
      this.topicElementWidth(primary);

    const secondaryWidth =
      this.topicElementWidth(secondary);

    const wideMoreWidth =
      this.topicElementWidth(wideMore);

    const compactMoreWidth =
      this.topicElementWidth(compactMore);

    // 1. Use full representation whenever the REAL content fits.
    let wideRequired =
      primaryWidth;

    if (secondary) {
      wideRequired +=
        gap + secondaryWidth;
    }

    if (wideMore) {
      wideRequired +=
        gap + wideMoreWidth;
    }

    if (
      secondary
      && wideRequired <= available
    ) {
      editor.dataset.topicLayout =
        "wide";
      return;
    }

    // 2. First topic + one compact "+N" badge.
    if (compactMore) {
      const compactRequired =
        primaryWidth
        + gap
        + compactMoreWidth;

      if (
        compactRequired <= available
      ) {
        editor.dataset.topicLayout =
          "compact";
        return;
      }
    }

    // 3. Keep the first Topic at its intrinsic width if it fits.
    // Never stretch it to consume the rest of the cell.
    if (
      primary
      && primaryWidth <= available
    ) {
      editor.dataset.topicLayout =
        "single";
      return;
    }

    // 4. If the topic text itself is longer than the column,
    // allow a single ellipsized chip as long as there is useful room.
    if (
      primary
      && available >= 46
    ) {
      editor.dataset.topicLayout =
        "single-ellipsis";
      return;
    }

    // 5. Only extremely narrow cells fall back to icon/count.
    editor.dataset.topicLayout =
      "mini";

    if (mini) {
      mini.title =
        editor.dataset.topicTooltip
        || mini.title;
    }
  }

  async updatePaperTableTextField(
    paper,
    {
      frontmatterKey,
      paperField,
      value,
    }
  ) {
    const next =
      String(value || "")
        .replace(
          /\r?\n+/g,
          " "
        )
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    const livePaperFile =
      this.liveTFile(
        paper?.file,
        {
          extension:
            "md",
          label:
            "Paper Note",
        }
      );

    paper.file =
      livePaperFile;

    this.suppressRefreshUntil =
      Date.now() + 900;

    await this.app.fileManager
      .processFrontMatter(
        livePaperFile,
        (fm) => {
          if (next) {
            fm[frontmatterKey] =
              next;
          }
          else {
            delete fm[
              frontmatterKey
            ];
          }
        }
      );

    paper[paperField] =
      next;

    this.markPaperRuntimeChanged(
      paper,
      {
        search:
          true,
      }
    );

    await this.refreshPaperRow(
      paper,
      {
        renderDetail:
          false,
      }
    );
  }

  beginPaperTableTextEdit(
    {
      container,
      paper,
      frontmatterKey,
      paperField,
      placeholder = "",
      inputClass = "",
      selectAll = true,
    }
  ) {
    if (
      !container
      || !paper?.file
    ) {
      return;
    }

    const current =
      String(
        paper[paperField]
        || ""
      );

    container.empty();

    const input =
      container.createEl(
        "input",
        {
          cls:
            `rl-table-inline-input ${inputClass}`
              .trim(),
          attr: {
            type:
              "text",
            spellcheck:
              "false",
            placeholder,
          },
        }
      );

    input.value =
      current;

    let finished =
      false;

    const cancel =
      () => {
        if (finished) {
          return;
        }

        finished =
          true;

        this.renderRows();
      };

    const save =
      async () => {
        if (finished) {
          return;
        }

        finished =
          true;

        try {
          await this.updatePaperTableTextField(
            paper,
            {
              frontmatterKey,
              paperField,
              value:
                input.value,
            }
          );
        }
        catch (error) {
          finished =
            false;

          new Notice(
            error?.message
            || "更新失败",
            5000
          );

          input.focus();
        }
      };

    input.addEventListener(
      "click",
      (event) => {
        event.stopPropagation();
      }
    );

    input.addEventListener(
      "keydown",
      (event) => {
        event.stopPropagation();

        if (
          event.key === "Escape"
        ) {
          event.preventDefault();
          cancel();
          return;
        }

        if (
          event.key === "Enter"
        ) {
          event.preventDefault();
          void save();
        }
      }
    );

    input.addEventListener(
      "blur",
      () => {
        void save();
      },
      {
        once:
          true,
      }
    );

    window.setTimeout(
      () => {
        input.focus();

        if (selectAll) {
          input.select();
        }
      },
      0
    );
  }

  renderPaperAlias(
    parent,
    paper
  ) {
    const wrap =
      parent.createSpan({
        cls:
          "rl-paper-alias-wrap",
      });

    const alias =
      String(
        paper.alias || ""
      ).trim();

    const ratingLevel =
      Math.max(
        0,
        Math.min(
          5,
          Number(
            paper.rating
          ) || 0
        )
      );

    const button =
      wrap.createEl(
        "button",
        {
          cls:
            `rl-paper-alias${
              alias
                ? ` is-rating-${ratingLevel}`
                : " is-empty"
            }`,
          attr: {
            type:
              "button",
            title:
              alias
                ? `编辑别名：${alias}`
                : "添加别名",
          },
        }
      );

    if (alias) {
      button.createSpan({
        cls:
          "rl-paper-alias-text",
        text:
          alias,
      });
    }
    else {
      this.createIcon(
        button,
        "plus",
        "rl-paper-alias-plus"
      );
    }

    button.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        this.beginPaperTableTextEdit({
          container:
            wrap,
          paper,
          frontmatterKey:
            "alias",
          paperField:
            "alias",
          placeholder:
            "Alias",
          inputClass:
            "rl-alias-inline-input",
        });
      }
    );

    return wrap;
  }

  renderPaperNoteCell(
    row,
    paper
  ) {
    const cell =
      row.createDiv({
        cls:
          "rl-col-note rl-property-cell",
      });

    const button =
      cell.createEl(
        "button",
        {
          cls:
            `rl-note-cell${
              paper.note
                ? ""
                : " is-empty"
            }`,
          attr: {
            type:
              "button",
            title:
              paper.note
                ? `编辑备注：${paper.note}`
                : "添加备注",
          },
        }
      );

    button.createSpan({
      cls:
        "rl-note-cell-text",
      text:
        paper.note
        || "—",
    });

    button.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        this.beginPaperTableTextEdit({
          container:
            cell,
          paper,
          frontmatterKey:
            "note",
          paperField:
            "note",
          placeholder:
            "备注",
          inputClass:
            "rl-note-inline-input",
        });
      }
    );

    return cell;
  }

  renderCell(row, paper, key) {
    switch (key) {
      case "name": {
        const cell = row.createDiv({ cls: "rl-col-name" });

        this.createIcon(
          cell,
          "file-text",
          "rl-page-icon"
        );

        this.renderPaperAlias(
          cell,
          paper
        );

        const title = cell.createEl("button", {
          cls: "rl-name",
          text: paper.title,
          attr: { type: "button", title: paper.title },
        });

        title.addEventListener(
          "click",
          async (event) => {
            event.preventDefault();
            event.stopPropagation();

            await this.openPaperDetail(
              paper
            );
          }
        );
        break;
      }

      case "year":
        this.textCell(row, "rl-col-year", paper.year || "—");
        break;

      case "venue": {
        const cell = this.textCell(row, "rl-col-venue", this.shortVenue(paper.venue));
        cell.title = paper.venue || "";
        break;
      }

      case "authors": {
        const cell = this.textCell(row, "rl-col-authors", this.shortAuthors(paper.authors));
        cell.title = paper.authors.join("; ");
        break;
      }

      case "status": {
        const cell = row.createDiv({
          cls: "rl-col-status rl-property-cell",
        });

        const button = cell.createEl("button", {
          cls:
            `rl-status-pill rl-status-${paper.status}`,
          attr: {
            type: "button",
            "aria-label": "修改阅读状态",
            "aria-haspopup": "menu",
          },
        });

        this.renderStatusPill(
          button,
          paper.status
        );

        button.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            event.stopPropagation();

            this.openStatusPopover({
              anchor: button,
              paper,
              row,
            });
          }
        );

        break;
      }

      case "rating": {
        const cell = row.createDiv({
          cls: "rl-col-rating rl-property-cell",
        });

        this.renderRatingEditor({
          cell,
          paper,
          row,
        });

        break;
      }

      case "topics": {
        const cell = row.createDiv({
          cls:
            "rl-col-topics " +
            "rl-property-cell",
        });

        const editor =
          cell.createEl("button", {
            cls: "rl-topics-editor",
            attr: {
              type: "button",
              title: "编辑 Topics",
            },
          });

        editor.dataset.topicTooltip =
          paper.topics.join(", ");

        if (!paper.topics.length) {
          this.createIcon(
            editor,
            "plus",
            "rl-topics-empty-icon"
          );

          editor.createSpan({
            cls: "rl-topics-empty",
            text: "Add topic",
          });
        }
        else {
          const firstTopic =
            paper.topics[0];

          const firstChip =
            editor.createSpan({
              cls:
                "rl-topic " +
                "rl-topic-primary",
              text: firstTopic,
              attr: {
                title: firstTopic,
              },
            });

          this.applyTopicColor(
            firstChip,
            firstTopic
          );

          if (
            paper.topics.length > 1
          ) {
            const secondTopic =
              paper.topics[1];

            const secondChip =
              editor.createSpan({
                cls:
                  "rl-topic " +
                  "rl-topic-secondary",
                text: secondTopic,
                attr: {
                  title: secondTopic,
                },
              });

            this.applyTopicColor(
              secondChip,
              secondTopic
            );

            // Wide layout:
            // first + second + optional remaining count.
            if (
              paper.topics.length > 2
            ) {
              editor.createSpan({
                cls:
                  "rl-topic-more " +
                  "rl-topic-more-wide",
                text:
                  `+${paper.topics.length - 2}`,
                attr: {
                  title:
                    paper.topics
                      .slice(2)
                      .join(", "),
                },
              });
            }

            // Narrow layout:
            // keep first topic readable and collapse every other topic.
            editor.createSpan({
              cls:
                "rl-topic-more " +
                "rl-topic-more-compact",
              text:
                `+${paper.topics.length - 1}`,
              attr: {
                title:
                  paper.topics
                    .slice(1)
                    .join(", "),
              },
            });
          }

          // Extremely narrow layout:
          // use a consistent tag icon + count instead of switching
          // to a colored dot or centering a lone chip.
          const mini =
            editor.createSpan({
              cls: "rl-topic-mini",
              attr: {
                title:
                  paper.topics.join(", "),
              },
            });

          this.createIcon(
            mini,
            "tag",
            "rl-topic-mini-icon"
          );

          mini.createSpan({
            cls: "rl-topic-mini-count",
            text:
              paper.topics.length > 1
                ? String(paper.topics.length)
                : "",
          });
        }

        editor.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            event.stopPropagation();

            this.openTopicPopover({
              anchor: editor,
              paper,
              row,
            });
          }
        );

        this.observeTopicEditor(
          editor
        );

        break;
      }

      case "figures": {
        const cell =
          row.createDiv({
            cls:
              "rl-col-figures rl-property-cell",
          });

        const paths =
          this.figurePaths(
            paper
          );

        const file =
          this.figureFile(
            paper,
            0
          );

        const button =
          cell.createEl(
            "button",
            {
              cls:
                `rl-figure-cell-button${
                  paths.length
                    ? " has-figure"
                    : " is-empty"
                }`,
              attr: {
                type:
                  "button",
                title:
                  paths.length
                    ? "管理图片"
                    : "添加图片",
              },
            }
          );

        if (file) {
          button.createEl(
            "img",
            {
              cls:
                "rl-figure-cell-image",
              attr: {
                src:
                  this.figureResourcePath(
                    file
                  ),
                alt:
                  `${paper.title} figure`,
                loading:
                  "lazy",
                decoding:
                  "async",
              },
            }
          );

          if (
            paths.length > 1
          ) {
            button.createSpan({
              cls:
                "rl-figure-cell-count",
              text:
                `+${paths.length - 1}`,
            });
          }
        }
        else if (
          paths.length
        ) {
          this.createIcon(
            button,
            "image-off",
            "rl-figure-cell-empty-icon"
          );
        }
        else {
          this.createIcon(
            button,
            "plus",
            "rl-figure-cell-empty-icon"
          );
        }

        button.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            event.stopPropagation();

            this.openFigureManager(
              paper
            );
          }
        );

        break;
      }

      case "note": {
        this.renderPaperNoteCell(
          row,
          paper
        );

        break;
      }

      case "collections":
      case "projects": {
        const type =
          key === "collections"
            ? "collection"
            : "project";

        const config =
          this.organizationConfig(type);

        const values =
          paper[config.field]
          || [];

        const cell =
          row.createDiv({
            cls:
              `${config.type === "collection" ? "rl-col-collections" : "rl-col-projects"} rl-property-cell`,
          });

        const editor =
          cell.createEl(
            "button",
            {
              cls:
                "rl-organization-cell-editor",
              attr: {
                type: "button",
                title:
                  values.length
                    ? values.join(", ")
                    : `添加 ${config.label}`,
              },
            }
          );

        if (!values.length) {
          this.createIcon(
            editor,
            "plus",
            "rl-organization-cell-empty-icon"
          );

          editor.createSpan({
            cls:
              "rl-organization-cell-empty",
            text:
              `Add ${config.label}`,
          });
        }
        else {
          const first =
            editor.createSpan({
              cls:
                "rl-organization-cell-chip",
              text:
                values[0],
              attr: {
                title:
                  values[0],
              },
            });

          this.createIcon(
            first,
            config.icon,
            "rl-organization-cell-chip-icon"
          );

          if (values.length > 1) {
            editor.createSpan({
              cls:
                "rl-organization-cell-more",
              text:
                `+${values.length - 1}`,
              attr: {
                title:
                  values.slice(1)
                    .join(", "),
              },
            });
          }
        }

        editor.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            event.stopPropagation();

            this.openOrganizationPopover({
              anchor: editor,
              paper,
              type,
            });
          }
        );

        break;
      }

      case "citekey": {
        const cell =
          row.createDiv({
            cls:
              "rl-col-citekey",
          });

        if (paper.citekey) {
          const button =
            cell.createEl(
              "button",
              {
                cls:
                  "rl-citekey-cell",
                text:
                  paper.citekey,
                attr: {
                  type:
                    "button",
                  title:
                    `复制 ${paper.citekey}`,
                },
              }
            );

          button.addEventListener(
            "click",
            (event) => {
              event.preventDefault();
              event.stopPropagation();

              void this.copyCitationText(
                paper.citekey,
                "Citekey"
              );
            }
          );
        }
        else {
          cell.createSpan({
            cls:
              "rl-muted",
            text:
              "—",
          });
        }

        break;
      }

      case "doi": {
        const cell = row.createDiv({ cls: "rl-col-doi" });

        if (paper.doi) {
          const link = cell.createEl("a", {
            cls: "rl-link",
            text: "doi.org",
            href: `https://doi.org/${paper.doi}`,
            attr: {
              target: "_blank",
              rel: "noopener",
              title: paper.doi,
            },
          });

          link.addEventListener("click", (event) => event.stopPropagation());
        } else {
          cell.createSpan({ cls: "rl-muted", text: "—" });
        }
        break;
      }

      case "pdf": {
        const cell = row.createDiv({ cls: "rl-col-pdf" });

        if (paper.pdf) {
          const button = cell.createEl("button", {
            cls: "rl-pdf-button",
            attr: { type: "button", title: "打开本地 PDF" },
          });

          this.createIcon(
            button,
            "file-text",
            "rl-pdf-icon"
          );

          button.createSpan({
            cls: "rl-pdf-label",
            text: "PDF",
          });

          button.addEventListener("click", async () => {
            const pdfFile = this.resolveVaultFile(paper.pdf, paper.file.path);

            if (!pdfFile) {
              new Notice(`找不到 PDF：${paper.pdf}`);
              return;
            }

            await this.app.workspace.getLeaf("tab").openFile(pdfFile);
            this.close();
          });
        } else {
          cell.createSpan({ cls: "rl-muted", text: "—" });
        }
        break;
      }

      case "edited":
        this.textCell(
          row,
          "rl-col-edited rl-edited",
          this.formatMtime(paper.mtime)
        );
        break;
    }
  }

  setPaperSelected(
    paper,
    selected,
    shiftKey = false
  ) {
    const visible =
      this.visiblePapers();

    if (
      shiftKey
      && this.lastSelectedPath
    ) {
      const from =
        visible.findIndex(
          (item) =>
            item.file.path
            === this.lastSelectedPath
        );

      const to =
        visible.findIndex(
          (item) =>
            item.file.path
            === paper.file.path
        );

      if (
        from >= 0
        && to >= 0
      ) {
        const start =
          Math.min(from, to);
        const end =
          Math.max(from, to);

        for (
          let index = start;
          index <= end;
          index++
        ) {
          this.selectedPaths.add(
            visible[index].file.path
          );
        }
      }
    }
    else if (selected) {
      this.selectedPaths.add(
        paper.file.path
      );
    }
    else {
      this.selectedPaths.delete(
        paper.file.path
      );
    }

    this.lastSelectedPath =
      paper.file.path;

    this.refreshSelectionDom();
    this.renderHeader();
  }

  clearSelection() {
    this.selectedPaths.clear();
    this.lastSelectedPath = null;

    this.refreshSelectionDom();
    this.renderHeader();
  }

  selectedPapers() {
    return this.papers.filter(
      (paper) =>
        this.selectedPaths.has(
          paper.file.path
        )
    );
  }

  updateSelectionBar() {
    if (!this.selectionBar) return;

    const count =
      this.selectedPaths.size;

    this.selectionBar.toggleClass(
      "is-hidden",
      count === 0
    );

    this.selectionCountEl?.setText(
      `${count} selected`
    );
  }

  organizationConfig(type) {
    const configs = {
      topic: {
        type: "topic",
        field: "topics",
        frontmatterKey: "topics",
        label: "Topic",
        plural: "Topics",
        icon: "tags",
        folder:
          this.plugin.settings
            .topicsFolder
          || "Research/30 Topics",
        linked: true,
      },
      collection: {
        // UI concept: List = explicit/manual membership.
        // Keep the historical "collection" type and `collections`
        // YAML field to avoid any Vault migration.
        type: "collection",
        field: "collections",
        frontmatterKey: "collections",
        label: "List",
        plural: "Lists",
        icon: "list",
        folder:
          this.plugin.settings
            .collectionsFolder
          || "Research/40 Collections",
        linked: false,
      },
      project: {
        type: "project",
        field: "projects",
        frontmatterKey: "projects",
        label: "Project",
        plural: "Projects",
        icon: "folder-kanban",
        folder:
          this.plugin.settings
            .projectsFolder
          || "Research/50 Projects",
        linked: false,
      },
    };

    return configs[type]
      || configs.topic;
  }

  cleanOrganizationName(value) {
    const clean =
      String(value || "")
        .replace(/\s+/g, " ")
        .trim();

    if (!clean) {
      throw new Error(
        "名称不能为空。"
      );
    }

    if (
      /[\\/:*?"<>|#\[\]]/.test(
        clean
      )
    ) {
      throw new Error(
        "名称不能包含 \\ / : * ? \" < > | # [ ]。"
      );
    }

    return clean;
  }

  organizationFolder(type) {
    return normalizePath(
      this.organizationConfig(type)
        .folder
    ).replace(/\/+$/, "");
  }

  organizationEntityFile(
    type,
    name
  ) {
    const clean =
      String(name || "")
        .trim()
        .toLowerCase();

    if (!clean) return null;

    const folder =
      this.organizationFolder(type);

    const prefix =
      folder
        ? `${folder}/`
        : "";

    return (
      this.app.vault
        .getMarkdownFiles()
        .find(
          (file) =>
            (!prefix
              || file.path.startsWith(
                prefix
              ))
            && file.basename
              .toLowerCase()
              === clean
        )
      || null
    );
  }

  organizationEntityPath(
    type,
    name
  ) {
    const clean =
      this.cleanOrganizationName(
        name
      );

    return `${this.organizationFolder(type)}/${clean}.md`;
  }

  organizationEntityContent(
    type,
    name
  ) {
    const config =
      this.organizationConfig(type);

    const clean =
      this.cleanOrganizationName(
        name
      );

    return `---\ntype: ${config.type}\ntitle: ${JSON.stringify(clean)}\ndate_created: ${this.today()}\n---\n\n# ${clean}\n`;
  }

  async ensureOrganizationEntity(
    type,
    name
  ) {
    const clean =
      this.cleanOrganizationName(
        name
      );

    const existing =
      this.organizationEntityFile(
        type,
        clean
      );

    if (existing) {
      return existing;
    }

    const folder =
      this.organizationFolder(type);

    await this.ensureFolder(
      folder
    );

    const path =
      this.organizationEntityPath(
        type,
        clean
      );

    const direct =
      this.app.vault
        .getAbstractFileByPath(
          path
        );

    if (
      direct instanceof TFile
    ) {
      return direct;
    }

    return await this.app.vault
      .create(
        path,
        this.organizationEntityContent(
          type,
          clean
        )
      );
  }

  organizationStoredValues(
    type,
    names
  ) {
    const config =
      this.organizationConfig(type);

    const unique =
      [
        ...new Set(
          (names || [])
            .map(
              (name) =>
                String(name || "")
                  .trim()
            )
            .filter(Boolean)
        ),
      ];

    if (config.linked) {
      return unique.map(
        (name) => {
          const file =
            this.organizationEntityFile(
              type,
              name
            );

          const target =
            file
              ? file.path.replace(
                  /\.md$/i,
                  ""
                )
              : `${this.organizationFolder(type)}/${name}`;

          return `[[${target}]]`;
        }
      );
    }

    return unique;
  }

  allOrganizationNames(type) {
    const config =
      this.organizationConfig(type);

    const fromPapers =
      this.papers.flatMap(
        (paper) =>
          paper[config.field]
          || []
      );

    const folder =
      this.organizationFolder(type);

    const prefix =
      folder
        ? `${folder}/`
        : "";

    const fromNotes =
      this.app.vault
        .getMarkdownFiles()
        .filter(
          (file) =>
            !prefix
            || file.path.startsWith(
              prefix
            )
        )
        .map(
          (file) =>
            file.basename
        );

    return [
      ...new Set(
        [
          ...fromPapers,
          ...fromNotes,
        ]
          .map(
            (name) =>
              String(name || "")
                .trim()
          )
          .filter(Boolean)
      ),
    ].sort(
      (a, b) =>
        a.localeCompare(
          b,
          undefined,
          {
            sensitivity: "base",
          }
        )
    );
  }

  allTopicNames() {
    return this.allOrganizationNames(
      "topic"
    );
  }

  topicLink(topic) {
    const clean =
      String(topic || "")
        .trim();

    if (!clean) return "";

    return `[[${this.organizationFolder("topic")}/${clean}]]`;
  }

  organizationItems(type) {
    const config =
      this.organizationConfig(type);

    return this.allOrganizationNames(
      type
    ).map(
      (name) => {
        const papers =
          this.papers.filter(
            (paper) =>
              (paper[config.field]
                || [])
                .some(
                  (value) =>
                    String(value)
                      .toLowerCase()
                    === String(name)
                      .toLowerCase()
                )
          );

        const dates =
          papers
            .map(
              (paper) =>
                paper.dateAdded || ""
            )
            .filter(Boolean)
            .sort();

        const file =
          this.organizationEntityFile(
            type,
            name
          );

        return {
          type,
          name,
          count:
            papers.length,
          unread:
            papers.filter(
              (paper) =>
                paper.status !== "read"
            ).length,
          highRated:
            papers.filter(
              (paper) =>
                paper.rating >= 4
            ).length,
          latestAdded:
            dates.length
              ? dates[dates.length - 1]
              : "",
          file,
          missingDefinition:
            !file
            && papers.length > 0,
        };
      }
    );
  }

  async createOrganizationEntity(
    type,
    name
  ) {
    const clean =
      this.cleanOrganizationName(
        name
      );

    const existing =
      this.allOrganizationNames(type)
        .find(
          (value) =>
            value.toLowerCase()
            === clean.toLowerCase()
        );

    if (existing) {
      await this.ensureOrganizationEntity(
        type,
        existing
      );

      return existing;
    }

    await this.ensureOrganizationEntity(
      type,
      clean
    );

    return clean;
  }

  async updatePaperOrganization(
    paper,
    type,
    names,
    {
      refresh = true,
      ensureEntities = true,
    } = {}
  ) {
    const config =
      this.organizationConfig(type);

    const unique =
      [
        ...new Set(
          (names || [])
            .map(
              (name) =>
                String(name || "")
                  .trim()
            )
            .filter(Boolean)
        ),
      ];

    if (ensureEntities) {
      for (const name of unique) {
        await this.ensureOrganizationEntity(
          type,
          name
        );
      }
    }

    this.suppressRefreshUntil =
      Date.now() + 900;

    await this.app.fileManager
      .processFrontMatter(
        paper.file,
        (fm) => {
          fm[config.frontmatterKey] =
            this.organizationStoredValues(
              type,
              unique
            );
        }
      );

    paper[config.field] =
      unique;

    this.markPaperRuntimeChanged(
      paper,
      {
        search:
          true,
      }
    );

    if (refresh) {
      await this.refreshPaperRow(
        paper,
        {
          renderDetail:
            true,
        }
      );
    }
  }

  async updatePaperTopics(
    paper,
    topics,
    { refresh = true } = {}
  ) {
    await this.updatePaperOrganization(
      paper,
      "topic",
      topics,
      {
        refresh,
      }
    );
  }

  applyOrganizationFilter(
    type,
    name
  ) {
    this.activeSavedViewId =
      null;

    this.view = "all";

    if (type === "topic") {
      this.topicFilter = name;
    }
    else if (
      type === "collection"
    ) {
      this.collectionFilter = name;
    }
    else if (
      type === "project"
    ) {
      this.projectFilter = name;
    }

    this.render();
  }

  openOrganizationManager(
    initialType = "topic"
  ) {
    this.closePopover();

    new OrganizationManagerModal(
      this.app,
      {
        library: this,
        initialType,
      }
    ).open();
  }

  organizationFilterValue(
    type
  ) {
    if (type === "topic") {
      return this.topicFilter || "";
    }

    if (type === "collection") {
      return this.collectionFilter || "";
    }

    return this.projectFilter || "";
  }

  setOrganizationFilterValue(
    type,
    value
  ) {
    if (type === "topic") {
      this.topicFilter =
        value || "";
    }
    else if (
      type === "collection"
    ) {
      this.collectionFilter =
        value || "";
    }
    else {
      this.projectFilter =
        value || "";
    }
  }

  cloneSavedViews() {
    return JSON.parse(
      JSON.stringify(
        this.plugin.settings
          .savedViews
        || []
      )
    );
  }

  organizationPaperSnapshots(
    type,
    name
  ) {
    const config =
      this.organizationConfig(type);

    const needle =
      String(name || "")
        .trim()
        .toLowerCase();

    return this.papers
      .filter(
        (paper) =>
          (paper[config.field]
            || [])
            .some(
              (value) =>
                String(value)
                  .toLowerCase()
                === needle
            )
      )
      .map(
        (paper) => ({
          paper,
          values:
            [
              ...(
                paper[config.field]
                || []
              ),
            ],
        })
      );
  }

  async restoreOrganizationPaperSnapshots(
    type,
    snapshots
  ) {
    const errors = [];

    for (
      const snapshot
      of [...snapshots].reverse()
    ) {
      try {
        await this.updatePaperOrganization(
          snapshot.paper,
          type,
          snapshot.values,
          {
            refresh: false,
            ensureEntities: false,
          }
        );
      }
      catch (error) {
        errors.push({
          path:
            snapshot.paper?.file?.path
            || "unknown",
          error,
        });
      }
    }

    return errors;
  }

  async renameOrganizationEntity(...args) {
    return this.withExclusiveWrite(
      "Organization rename",
      () =>
        this._renameOrganizationEntity(
          ...args
        )
    );
  }

  async _renameOrganizationEntity(
    type,
    oldName,
    newName
  ) {
    const config =
      this.organizationConfig(type);

    const oldClean =
      String(oldName || "")
        .trim();

    const next =
      this.cleanOrganizationName(
        newName
      );

    if (
      oldClean.toLowerCase()
      === next.toLowerCase()
    ) {
      return next;
    }

    const collision =
      this.allOrganizationNames(type)
        .find(
          (name) =>
            name.toLowerCase()
              === next.toLowerCase()
            && name.toLowerCase()
              !== oldClean.toLowerCase()
        );

    if (collision) {
      throw new Error(
        `${config.label} 已存在：${collision}`
      );
    }

    const snapshots =
      this.organizationPaperSnapshots(
        type,
        oldClean
      );

    const savedViewsBefore =
      this.cloneSavedViews();

    const activeFilterBefore =
      this.organizationFilterValue(
        type
      );

    const oldFile =
      this.organizationEntityFile(
        type,
        oldClean
      );

    const oldPath =
      oldFile?.path || "";

    const nextPath =
      this.organizationEntityPath(
        type,
        next
      );

    let renamedExistingNote =
      false;

    let createdNewNote =
      false;

    let savedViewsChanged =
      false;

    this.suppressRefreshUntil =
      Date.now() + 5000;

    try {
      await this.ensureFolder(
        this.organizationFolder(type)
      );

      if (oldFile) {
        await this.app.fileManager
          .renameFile(
            oldFile,
            nextPath
          );

        renamedExistingNote =
          true;

        const renamed =
          this.organizationEntityFile(
            type,
            next
          );

        if (!renamed) {
          throw new Error(
            "组织定义笔记重命名后未找到。"
          );
        }

        await this.app.fileManager
          .processFrontMatter(
            renamed,
            (fm) => {
              fm.type =
                config.type;

              fm.title =
                next;
            }
          );
      }
      else {
        await this.ensureOrganizationEntity(
          type,
          next
        );

        createdNewNote =
          true;
      }

      for (
        const snapshot
        of snapshots
      ) {
        const updated =
          snapshot.values.map(
            (value) =>
              String(value)
                .toLowerCase()
              === oldClean.toLowerCase()
                ? next
                : value
          );

        await this.updatePaperOrganization(
          snapshot.paper,
          type,
          updated,
          {
            refresh: false,
            ensureEntities: false,
          }
        );
      }

      const savedFilterKey =
        type === "topic"
          ? "topicFilter"
          : type === "collection"
            ? "collectionFilter"
            : "projectFilter";

      for (
        const saved
        of this.plugin.settings
          .savedViews
        || []
      ) {
        if (
          String(
            saved[savedFilterKey]
            || ""
          ).toLowerCase()
          === oldClean.toLowerCase()
        ) {
          saved[savedFilterKey] =
            next;

          savedViewsChanged =
            true;
        }
      }

      if (savedViewsChanged) {
        await this.plugin
          .saveSettings();
      }
    }
    catch (error) {
      const rollbackErrors =
        [];

      // Restore the definition note first, so Topic wiki links
      // point back to a real target while Paper YAML is restored.
      try {
        if (renamedExistingNote) {
          const renamed =
            this.organizationEntityFile(
              type,
              next
            );

          if (renamed) {
            await this.app.fileManager
              .renameFile(
                renamed,
                oldPath
              );

            const restored =
              this.organizationEntityFile(
                type,
                oldClean
              );

            if (restored) {
              await this.app.fileManager
                .processFrontMatter(
                  restored,
                  (fm) => {
                    fm.type =
                      config.type;

                    fm.title =
                      oldClean;
                  }
                );
            }
          }
        }
        else if (
          createdNewNote
        ) {
          const created =
            this.organizationEntityFile(
              type,
              next
            );

          if (created) {
            await this.app.vault
              .delete(
                created
              );
          }
        }
      }
      catch (rollbackError) {
        rollbackErrors.push(
          rollbackError
        );
      }

      rollbackErrors.push(
        ...await this.restoreOrganizationPaperSnapshots(
          type,
          snapshots
        ).then(
          (items) =>
            items.map(
              (item) =>
                item.error
            )
        )
      );

      this.plugin.settings.savedViews =
        savedViewsBefore;

      try {
        await this.plugin
          .saveSettings();
      }
      catch (rollbackError) {
        rollbackErrors.push(
          rollbackError
        );
      }

      this.setOrganizationFilterValue(
        type,
        activeFilterBefore
      );

      this.renderCollectionSurface();

      try {
        await this.renderDetailIfOpen();
      }
      catch (_) {}

      console.error(
        "Research Library: organization rename rolled back",
        {
          type,
          oldName:
            oldClean,
          newName:
            next,
          cause:
            error,
          rollbackErrors,
        }
      );

      throw new Error(
        rollbackErrors.length
          ? `${config.label} 重命名失败；已尝试回滚，但有 ${rollbackErrors.length} 项需要检查。`
          : `${config.label} 重命名失败，已恢复原状态。`
      );
    }

    if (
      activeFilterBefore
        .toLowerCase()
      === oldClean.toLowerCase()
    ) {
      this.setOrganizationFilterValue(
        type,
        next
      );
    }

    this.renderCollectionSurface();
    await this.renderDetailIfOpen();

    return next;
  }

  async deleteOrganizationEntity(...args) {
    return this.withExclusiveWrite(
      "Organization delete",
      () =>
        this._deleteOrganizationEntity(
          ...args
        )
    );
  }

  async _deleteOrganizationEntity(
    type,
    name
  ) {
    const config =
      this.organizationConfig(type);

    const clean =
      String(name || "")
        .trim();

    const snapshots =
      this.organizationPaperSnapshots(
        type,
        clean
      );

    const savedViewsBefore =
      this.cloneSavedViews();

    const activeFilterBefore =
      this.organizationFilterValue(
        type
      );

    const entityFile =
      this.organizationEntityFile(
        type,
        clean
      );

    const entityPath =
      entityFile?.path || "";

    let entityContent =
      "";

    if (entityFile) {
      try {
        entityContent =
          await this.app.vault
            .cachedRead(
              entityFile
            );
      }
      catch (_) {
        entityContent =
          "";
      }
    }

    let savedViewsChanged =
      false;

    this.suppressRefreshUntil =
      Date.now() + 5000;

    try {
      for (
        const snapshot
        of snapshots
      ) {
        const next =
          snapshot.values.filter(
            (value) =>
              String(value)
                .toLowerCase()
              !== clean.toLowerCase()
          );

        await this.updatePaperOrganization(
          snapshot.paper,
          type,
          next,
          {
            refresh: false,
            ensureEntities: false,
          }
        );
      }

      const savedFilterKey =
        type === "topic"
          ? "topicFilter"
          : type === "collection"
            ? "collectionFilter"
            : "projectFilter";

      for (
        const saved
        of this.plugin.settings
          .savedViews
        || []
      ) {
        if (
          String(
            saved[savedFilterKey]
            || ""
          ).toLowerCase()
          === clean.toLowerCase()
        ) {
          saved[savedFilterKey] =
            "";

          savedViewsChanged =
            true;
        }
      }

      if (savedViewsChanged) {
        await this.plugin
          .saveSettings();
      }

      // Delete the definition note only after every Paper YAML
      // and Saved View update has succeeded.
      if (entityFile) {
        await this.app.fileManager
          .trashFile(
            entityFile
          );
      }
    }
    catch (error) {
      const rollbackErrors =
        [];

      // Extremely defensive: if trashFile succeeded but a later
      // adapter error was reported, recreate the definition note.
      if (
        entityPath
        && !this.app.vault
          .getAbstractFileByPath(
            entityPath
          )
      ) {
        try {
          await this.ensureFolder(
            this.organizationFolder(type)
          );

          await this.app.vault
            .create(
              entityPath,
              entityContent
              || this.organizationEntityContent(
                type,
                clean
              )
            );
        }
        catch (rollbackError) {
          rollbackErrors.push(
            rollbackError
          );
        }
      }

      rollbackErrors.push(
        ...await this.restoreOrganizationPaperSnapshots(
          type,
          snapshots
        ).then(
          (items) =>
            items.map(
              (item) =>
                item.error
            )
        )
      );

      this.plugin.settings.savedViews =
        savedViewsBefore;

      try {
        await this.plugin
          .saveSettings();
      }
      catch (rollbackError) {
        rollbackErrors.push(
          rollbackError
        );
      }

      this.setOrganizationFilterValue(
        type,
        activeFilterBefore
      );

      this.renderCollectionSurface();

      try {
        await this.renderDetailIfOpen();
      }
      catch (_) {}

      console.error(
        "Research Library: organization delete rolled back",
        {
          type,
          name:
            clean,
          cause:
            error,
          rollbackErrors,
        }
      );

      throw new Error(
        rollbackErrors.length
          ? `${config.label} 删除失败；已尝试回滚，但有 ${rollbackErrors.length} 项需要检查。`
          : `${config.label} 删除失败，已恢复原状态。`
      );
    }

    if (
      activeFilterBefore
        .toLowerCase()
      === clean.toLowerCase()
    ) {
      this.setOrganizationFilterValue(
        type,
        ""
      );
    }

    this.renderCollectionSurface();
    await this.renderDetailIfOpen();
  }

  openTopicPopover({
    anchor,
    paper,
    row,
  }) {
    this.closePopover();

    const popover =
      this.createPopover(
        anchor,
        "rl-topic-popover"
      );

    this.activePopover =
      popover;

    popover.createDiv({
      cls: "rl-popover-title",
      text: "Topics",
    });

    if (paper.topics.length) {
      const current =
        popover.createDiv({
          cls: "rl-topic-current",
        });

      for (
        const topic
        of paper.topics
      ) {
        const chip =
          current.createDiv({
            cls: "rl-topic-current-chip",
          });

        this.applyTopicColor(
          chip,
          topic
        );

        chip.createSpan({
          text: topic,
        });

        const remove =
          chip.createEl("button", {
            cls: "rl-topic-remove",
            attr: {
              type: "button",
              title: `移除 ${topic}`,
            },
          });

        this.createIcon(
          remove,
          "x",
          "rl-topic-remove-icon"
        );

        remove.addEventListener(
          "click",
          async (event) => {
            event.preventDefault();
            event.stopPropagation();

            const next =
              paper.topics.filter(
                (value) =>
                  value !== topic
              );

            this.closePopover();

            await this.updatePaperTopics(
              paper,
              next
            );
          }
        );
      }
    }

    const search =
      popover.createEl("input", {
        cls: "rl-topic-search",
        attr: {
          type: "text",
          placeholder:
            "搜索或创建 Topic…",
        },
      });

    const list =
      popover.createDiv({
        cls: "rl-topic-option-list",
      });

    const renderOptions = () => {
      list.empty();

      const query =
        search.value
          .trim()
          .toLowerCase();

      const existing =
        new Set(
          paper.topics.map(
            (topic) =>
              topic.toLowerCase()
          )
        );

      const candidates =
        this.allTopicNames()
          .filter(
            (topic) =>
              !existing.has(
                topic.toLowerCase()
              )
          )
          .filter(
            (topic) =>
              !query
              || topic
                .toLowerCase()
                .includes(query)
          )
          .slice(0, 12);

      const exact =
        query
        && this.allTopicNames()
          .some(
            (topic) =>
              topic.toLowerCase()
              === query
          );

      if (
        query
        && !exact
        && !existing.has(query)
      ) {
        const create =
          list.createEl("button", {
            cls:
              "rl-topic-option " +
              "rl-topic-create-option",
            attr: {
              type: "button",
            },
          });

        this.createIcon(
          create,
          "plus",
          "rl-topic-option-icon"
        );

        create.createSpan({
          text:
            `Create "${search.value.trim()}"`,
        });

        create.addEventListener(
          "click",
          async () => {
            const topic =
              search.value.trim();

            if (!topic) return;

            this.closePopover();

            await this.updatePaperTopics(
              paper,
              [
                ...paper.topics,
                topic,
              ]
            );
          }
        );
      }

      for (
        const topic
        of candidates
      ) {
        const option =
          list.createEl("button", {
            cls: "rl-topic-option",
            attr: {
              type: "button",
            },
          });

        const swatch =
          option.createSpan({
            cls: "rl-topic-option-swatch",
          });

        this.applyTopicColor(
          swatch,
          topic
        );

        option.createSpan({
          text: topic,
        });

        option.addEventListener(
          "click",
          async () => {
            this.closePopover();

            await this.updatePaperTopics(
              paper,
              [
                ...paper.topics,
                topic,
              ]
            );
          }
        );
      }

      if (
        !candidates.length
        && !query
      ) {
        list.createDiv({
          cls: "rl-topic-no-options",
          text:
            "输入名称创建第一个 Topic",
        });
      }
    };

    search.addEventListener(
      "input",
      renderOptions
    );

    search.addEventListener(
      "keydown",
      async (event) => {
        if (
          event.key === "Enter"
        ) {
          event.preventDefault();

          const topic =
            search.value.trim();

          if (!topic) return;

          this.closePopover();

          await this.updatePaperTopics(
            paper,
            [
              ...paper.topics,
              topic,
            ]
          );
        }
        else if (
          event.key === "Escape"
        ) {
          event.preventDefault();
          this.closePopover();
          anchor.focus();
        }
      }
    );

    renderOptions();

    window.setTimeout(
      () => search.focus(),
      0
    );
  }

  openOrganizationPopover({
    anchor,
    paper,
    type,
  }) {
    const config =
      this.organizationConfig(type);

    const values =
      paper[config.field]
      || [];

    this.closePopover();

    const popover =
      this.createPopover(
        anchor,
        "rl-organization-popover"
      );

    this.activePopover =
      popover;

    popover.createDiv({
      cls: "rl-popover-title",
      text: config.plural,
    });

    if (values.length) {
      const current =
        popover.createDiv({
          cls:
            "rl-organization-current",
        });

      for (const value of values) {
        const chip =
          current.createDiv({
            cls:
              "rl-organization-current-chip",
          });

        if (type === "topic") {
          this.applyTopicColor(
            chip,
            value
          );
        }

        chip.createSpan({
          text: value,
        });

        const remove =
          chip.createEl(
            "button",
            {
              cls:
                "rl-organization-remove",
              attr: {
                type: "button",
                title:
                  `移除 ${value}`,
              },
            }
          );

        this.createIcon(
          remove,
          "x",
          "rl-organization-remove-icon"
        );

        remove.addEventListener(
          "click",
          async (event) => {
            event.preventDefault();
            event.stopPropagation();

            this.closePopover();

            await this.updatePaperOrganization(
              paper,
              type,
              values.filter(
                (item) =>
                  item !== value
              )
            );
          }
        );
      }
    }

    const search =
      popover.createEl(
        "input",
        {
          cls:
            "rl-topic-search",
          attr: {
            type: "text",
            placeholder:
              `搜索或创建 ${config.label}…`,
          },
        }
      );

    const list =
      popover.createDiv({
        cls:
          "rl-topic-option-list",
      });

    const renderOptions = () => {
      list.empty();

      const query =
        search.value
          .trim()
          .toLowerCase();

      const existing =
        new Set(
          values.map(
            (value) =>
              value.toLowerCase()
          )
        );

      const all =
        this.allOrganizationNames(
          type
        );

      const candidates =
        all
          .filter(
            (value) =>
              !existing.has(
                value.toLowerCase()
              )
          )
          .filter(
            (value) =>
              !query
              || value
                .toLowerCase()
                .includes(query)
          )
          .slice(0, 14);

      const exact =
        query
        && all.some(
          (value) =>
            value.toLowerCase()
            === query
        );

      if (
        query
        && !exact
        && !existing.has(query)
      ) {
        const create =
          list.createEl(
            "button",
            {
              cls:
                "rl-topic-option rl-topic-create-option",
              attr: {
                type: "button",
              },
            }
          );

        this.createIcon(
          create,
          "plus",
          "rl-topic-option-icon"
        );

        create.createSpan({
          text:
            `Create "${search.value.trim()}"`,
        });

        create.addEventListener(
          "click",
          async () => {
            const name =
              search.value.trim();

            if (!name) return;

            try {
              const clean =
                await this.createOrganizationEntity(
                  type,
                  name
                );

              this.closePopover();

              await this.updatePaperOrganization(
                paper,
                type,
                [
                  ...values,
                  clean,
                ]
              );
            }
            catch (error) {
              new Notice(
                error?.message
                || `创建 ${config.label} 失败`
              );
            }
          }
        );
      }

      for (
        const value
        of candidates
      ) {
        const option =
          list.createEl(
            "button",
            {
              cls:
                "rl-topic-option",
              attr: {
                type: "button",
              },
            }
          );

        if (type === "topic") {
          const swatch =
            option.createSpan({
              cls:
                "rl-topic-option-swatch",
            });

          this.applyTopicColor(
            swatch,
            value
          );
        }
        else {
          this.createIcon(
            option,
            config.icon,
            "rl-organization-option-icon"
          );
        }

        option.createSpan({
          text: value,
        });

        option.addEventListener(
          "click",
          async () => {
            this.closePopover();

            await this.updatePaperOrganization(
              paper,
              type,
              [
                ...values,
                value,
              ]
            );
          }
        );
      }

      if (
        !candidates.length
        && !query
      ) {
        list.createDiv({
          cls:
            "rl-topic-no-options",
          text:
            `输入名称创建第一个 ${config.label}`,
        });
      }
    };

    search.addEventListener(
      "input",
      renderOptions
    );

    search.addEventListener(
      "keydown",
      async (event) => {
        if (
          event.key === "Enter"
        ) {
          event.preventDefault();

          const name =
            search.value.trim();

          if (!name) return;

          try {
            const clean =
              await this.createOrganizationEntity(
                type,
                name
              );

            this.closePopover();

            await this.updatePaperOrganization(
              paper,
              type,
              [
                ...values,
                clean,
              ]
            );
          }
          catch (error) {
            new Notice(
              error?.message
              || `创建 ${config.label} 失败`
            );
          }
        }
        else if (
          event.key === "Escape"
        ) {
          event.preventDefault();
          this.closePopover();
          anchor.focus();
        }
      }
    );

    renderOptions();

    window.setTimeout(
      () => search.focus(),
      0
    );
  }

  openBulkOrganizationPopover(
    anchor
  ) {
    if (!this.selectedPaths.size) {
      return;
    }

    this.closePopover();

    const popover =
      this.createPopover(
        anchor,
        "rl-bulk-organization-popover"
      );

    this.activePopover =
      popover;

    popover.createDiv({
      cls: "rl-popover-title",
      text:
        `组织 · ${this.selectedPaths.size} selected`,
    });

    let type = "topic";
    let mode = "add";

    const tabs =
      popover.createDiv({
        cls:
          "rl-organization-type-tabs",
      });

    const typeButtons =
      new Map();

    const search =
      popover.createEl(
        "input",
        {
          cls:
            "rl-topic-search",
          attr: {
            type: "text",
            placeholder:
              "搜索或创建 Topic…",
          },
        }
      );

    const modeRow =
      popover.createDiv({
        cls:
          "rl-organization-mode-row",
      });

    const addMode =
      modeRow.createEl(
        "button",
        {
          cls:
            "rl-organization-mode is-active",
          text: "添加",
          attr: {
            type: "button",
          },
        }
      );

    const removeMode =
      modeRow.createEl(
        "button",
        {
          cls:
            "rl-organization-mode",
          text: "移除",
          attr: {
            type: "button",
          },
        }
      );

    const list =
      popover.createDiv({
        cls:
          "rl-topic-option-list",
      });

    const setType =
      (next) => {
        type = next;

        for (
          const [key, button]
          of typeButtons
        ) {
          button.toggleClass(
            "is-active",
            key === type
          );
        }

        const config =
          this.organizationConfig(type);

        search.placeholder =
          mode === "add"
            ? `搜索或创建 ${config.label}…`
            : `搜索要移除的 ${config.label}…`;

        search.value = "";
        renderOptions();
      };

    for (
      const key
      of [
        "topic",
        "project",
        "collection",
      ]
    ) {
      const config =
        this.organizationConfig(key);

      const button =
        tabs.createEl(
          "button",
          {
            cls:
              `rl-organization-type-tab${
                key === type
                  ? " is-active"
                  : ""
              }${
                key === "collection"
                  ? " is-list-type"
                  : ""
              }`,
            attr: {
              type: "button",
            },
          }
        );

      this.createIcon(
        button,
        config.icon,
        "rl-organization-type-icon"
      );

      button.createSpan({
        text:
          config.label,
      });

      typeButtons.set(
        key,
        button
      );

      button.addEventListener(
        "click",
        () => setType(key)
      );
    }

    const setMode =
      (next) => {
        mode = next;

        addMode.toggleClass(
          "is-active",
          mode === "add"
        );

        removeMode.toggleClass(
          "is-active",
          mode === "remove"
        );

        const config =
          this.organizationConfig(type);

        search.placeholder =
          mode === "add"
            ? `搜索或创建 ${config.label}…`
            : `搜索要移除的 ${config.label}…`;

        search.value = "";
        renderOptions();
      };

    addMode.addEventListener(
      "click",
      () => setMode("add")
    );

    removeMode.addEventListener(
      "click",
      () => setMode("remove")
    );

    const renderOptions = () => {
      list.empty();

      const config =
        this.organizationConfig(type);

      const selected =
        this.selectedPapers();

      const query =
        search.value
          .trim()
          .toLowerCase();

      let names = [];

      if (mode === "add") {
        names =
          this.allOrganizationNames(
            type
          );
      }
      else {
        names = [
          ...new Set(
            selected.flatMap(
              (paper) =>
                paper[config.field]
                || []
            )
          ),
        ];
      }

      names = names
        .filter(
          (name) =>
            !query
            || name
              .toLowerCase()
              .includes(query)
        )
        .sort((a, b) =>
          a.localeCompare(b)
        )
        .slice(0, 16);

      if (
        mode === "add"
        && query
        && !this.allOrganizationNames(type)
          .some(
            (name) =>
              name.toLowerCase()
              === query
          )
      ) {
        const create =
          list.createEl(
            "button",
            {
              cls:
                "rl-topic-option rl-topic-create-option",
              attr: {
                type: "button",
              },
            }
          );

        this.createIcon(
          create,
          "plus",
          "rl-topic-option-icon"
        );

        create.createSpan({
          text:
            `Create & add "${search.value.trim()}"`,
        });

        create.addEventListener(
          "click",
          async () => {
            try {
              const clean =
                await this.createOrganizationEntity(
                  type,
                  search.value.trim()
                );

              this.closePopover();

              await this.bulkUpdateOrganization(
                type,
                clean,
                "add"
              );
            }
            catch (error) {
              new Notice(
                error?.message
                || `创建 ${config.label} 失败`
              );
            }
          }
        );
      }

      for (const name of names) {
        const option =
          list.createEl(
            "button",
            {
              cls:
                "rl-topic-option",
              attr: {
                type: "button",
              },
            }
          );

        if (type === "topic") {
          const swatch =
            option.createSpan({
              cls:
                "rl-topic-option-swatch",
            });

          this.applyTopicColor(
            swatch,
            name
          );
        }
        else {
          this.createIcon(
            option,
            config.icon,
            "rl-organization-option-icon"
          );
        }

        option.createSpan({
          text: name,
        });

        if (mode === "add") {
          const count =
            selected.filter(
              (paper) =>
                (paper[config.field]
                  || [])
                  .some(
                    (value) =>
                      value.toLowerCase()
                      === name.toLowerCase()
                  )
            ).length;

          if (count) {
            option.createSpan({
              cls:
                "rl-organization-option-count",
              text:
                `${count}/${selected.length}`,
            });
          }
        }

        option.addEventListener(
          "click",
          async () => {
            this.closePopover();

            await this.bulkUpdateOrganization(
              type,
              name,
              mode
            );
          }
        );
      }

      if (!names.length && !query) {
        list.createDiv({
          cls:
            "rl-topic-no-options",
          text:
            mode === "add"
              ? `暂无 ${config.label}，输入名称创建`
              : `所选论文没有 ${config.label}`,
        });
      }
    };

    search.addEventListener(
      "input",
      renderOptions
    );

    renderOptions();

    window.setTimeout(
      () => search.focus(),
      0
    );
  }

  async bulkUpdateOrganization(
    type,
    name,
    mode = "add"
  ) {
    const selected =
      this.selectedPapers();

    if (!selected.length) return;

    const config =
      this.organizationConfig(type);

    const clean =
      this.cleanOrganizationName(
        name
      );

    if (mode === "add") {
      await this.ensureOrganizationEntity(
        type,
        clean
      );
    }

    this.suppressRefreshUntil =
      Date.now() + 1800;

    for (const paper of selected) {
      const current =
        paper[config.field]
        || [];

      let next = current;

      if (mode === "add") {
        if (
          !current.some(
            (value) =>
              value.toLowerCase()
              === clean.toLowerCase()
          )
        ) {
          next = [
            ...current,
            clean,
          ];
        }
      }
      else {
        next = current.filter(
          (value) =>
            value.toLowerCase()
            !== clean.toLowerCase()
        );
      }

      if (
        next.length === current.length
        && next.every(
          (value, index) =>
            value === current[index]
        )
      ) {
        continue;
      }

      await this.updatePaperOrganization(
        paper,
        type,
        next,
        {
          refresh: false,
          ensureEntities: false,
        }
      );
    }

    this.renderCollectionSurface();
    await this.renderDetailIfOpen();
  }

  openBulkStatusPopover(anchor) {
    if (!this.selectedPaths.size) return;

    this.closePopover();

    const popover =
      this.createPopover(
        anchor,
        "rl-status-popover"
      );

    this.activePopover =
      popover;

    popover.createDiv({
      cls: "rl-status-menu-title",
      text:
        `Set status · ${this.selectedPaths.size}`,
    });

    const list =
      popover.createDiv({
        cls: "rl-status-menu-list",
      });

    for (
      const [status, meta]
      of Object.entries(STATUS_META)
    ) {
      const option =
        list.createEl("button", {
          cls:
            `rl-status-option ` +
            `rl-status-option-${status}`,
          attr: {
            type: "button",
          },
        });

      const icon =
        option.createSpan({
          cls:
            `rl-status-option-icon ` +
            `rl-status-option-icon-${status}`,
        });

      this.createIcon(
        icon,
        meta.icon
      );

      option.createSpan({
        cls:
          "rl-status-option-label",
        text:
          meta.label,
      });

      option.addEventListener(
        "click",
        async () => {
          this.closePopover();
          await this.bulkSetStatus(status);
        }
      );
    }
  }

  async bulkSetStatus(status) {
    const selected =
      this.selectedPapers();

    if (!selected.length) return;

    this.suppressRefreshUntil =
      Date.now() + 1200;

    const today =
      this.today();

    for (const paper of selected) {
      let readingDates = {
        dateStarted:
          paper.dateStarted || "",
        dateRead:
          paper.dateRead || "",
      };

      await this.app.fileManager
        .processFrontMatter(
          paper.file,
          (fm) => {
            fm.status =
              status;

            readingDates =
              this.applyReadingStatusDates(
                fm,
                status,
                today
              );
          }
        );

      paper.status =
        status;

      paper.dateStarted =
        readingDates.dateStarted
        || "";

      paper.dateRead =
        readingDates.dateRead
        || "";

      this.markPaperRuntimeChanged(
        paper
      );
    }

    this.selectedPaths.clear();
    this.lastSelectedPath = null;

    this.renderCollectionSurface();

    await this.renderDetailIfOpen();
  }

  openBulkTopicPopover(anchor) {
    if (!this.selectedPaths.size) return;

    this.closePopover();

    const popover =
      this.createPopover(
        anchor,
        "rl-topic-popover"
      );

    this.activePopover =
      popover;

    popover.createDiv({
      cls: "rl-popover-title",
      text:
        `Add topic · ${this.selectedPaths.size}`,
    });

    const search =
      popover.createEl("input", {
        cls: "rl-topic-search",
        attr: {
          type: "text",
          placeholder:
            "搜索或创建 Topic…",
        },
      });

    const list =
      popover.createDiv({
        cls: "rl-topic-option-list",
      });

    const renderOptions = () => {
      list.empty();

      const query =
        search.value
          .trim()
          .toLowerCase();

      const topics =
        this.allTopicNames()
          .filter(
            (topic) =>
              !query
              || topic
                .toLowerCase()
                .includes(query)
          )
          .slice(0, 14);

      if (query) {
        const exact =
          topics.some(
            (topic) =>
              topic.toLowerCase()
              === query
          );

        if (!exact) {
          const create =
            list.createEl("button", {
              cls:
                "rl-topic-option " +
                "rl-topic-create-option",
              attr: {
                type: "button",
              },
            });

          this.createIcon(
            create,
            "plus",
            "rl-topic-option-icon"
          );

          create.createSpan({
            text:
              `Add "${search.value.trim()}"`,
          });

          create.addEventListener(
            "click",
            async () => {
              const topic =
                search.value.trim();

              this.closePopover();

              await this.bulkAddTopic(
                topic
              );
            }
          );
        }
      }

      for (const topic of topics) {
        const option =
          list.createEl("button", {
            cls: "rl-topic-option",
            attr: {
              type: "button",
            },
          });

        const swatch =
          option.createSpan({
            cls: "rl-topic-option-swatch",
          });

        this.applyTopicColor(
          swatch,
          topic
        );

        option.createSpan({
          text: topic,
        });

        option.addEventListener(
          "click",
          async () => {
            this.closePopover();

            await this.bulkAddTopic(
              topic
            );
          }
        );
      }
    };

    search.addEventListener(
      "input",
      renderOptions
    );

    search.addEventListener(
      "keydown",
      async (event) => {
        if (
          event.key === "Enter"
        ) {
          event.preventDefault();

          const topic =
            search.value.trim();

          if (!topic) return;

          this.closePopover();

          await this.bulkAddTopic(
            topic
          );
        }
      }
    );

    renderOptions();

    window.setTimeout(
      () => search.focus(),
      0
    );
  }

  async bulkAddTopic(topic) {
    return this.bulkUpdateOrganization(
      "topic",
      topic,
      "add"
    );
  }

  maintenancePaperSnapshot() {
    return [
      ...this.papers,
    ];
  }
  maintenancePdfSnapshot() {
    const folder =
      normalizePath(
        this.plugin.settings
          .pdfFolder
        || "Research/20 PDFs"
      ).replace(/\/+$/, "");

    const prefix =
      folder
        ? `${folder}/`
        : "";

    return this.app.vault
      .getFiles()
      .filter(
        (file) =>
          file instanceof TFile
          && file.extension
            ?.toLowerCase()
            === "pdf"
          && (
            !prefix
            || file.path.startsWith(
              prefix
            )
          )
      );
  }

  maintenancePaperPdfFile(
    paper
  ) {
    if (!paper?.pdf) {
      return null;
    }

    const file =
      this.resolveVaultFile(
        paper.pdf,
        paper.file?.path || ""
      );

    return (
      file instanceof TFile
      && file.extension
        ?.toLowerCase()
        === "pdf"
    )
      ? file
      : null;
  }

  maintenanceIssue(
    {
      id,
      category,
      label,
      icon,
      items,
      severity = "normal",
    }
  ) {
    const cleanItems =
      (items || [])
        .filter(Boolean);

    return {
      id,
      category,
      label,
      icon,
      severity,
      items:
        cleanItems,
      count:
        cleanItems.length,
    };
  }

  maintenanceExactDuplicateGroups(
    papers
  ) {
    const parent =
      papers.map(
        (_, index) =>
          index
      );

    const find =
      (index) => {
        let value =
          index;

        while (
          parent[value] !== value
        ) {
          parent[value] =
            parent[
              parent[value]
            ];

          value =
            parent[value];
        }

        return value;
      };

    const union =
      (left, right) => {
        const a =
          find(left);

        const b =
          find(right);

        if (a !== b) {
          parent[b] =
            a;
        }
      };

    const maps = [
      {
        label:
          "DOI",
        value:
          (paper) =>
            this.normalizeDoi(
              paper.doi || ""
            ).toLowerCase(),
      },
      {
        label:
          "arXiv",
        value:
          (paper) =>
            String(
              paper.arxiv || ""
            )
              .trim()
              .toLowerCase()
              .replace(
                /v\d+$/i,
                ""
              ),
      },
    ];

    const reasons =
      new Map();

    for (
      const config
      of maps
    ) {
      const seen =
        new Map();

      papers.forEach(
        (paper, index) => {
          const key =
            config.value(
              paper
            );

          if (!key) {
            return;
          }

          if (
            seen.has(key)
          ) {
            const first =
              seen.get(key);

            union(
              first,
              index
            );

            const pair =
              [
                Math.min(
                  first,
                  index
                ),
                Math.max(
                  first,
                  index
                ),
              ].join(":");

            if (
              !reasons.has(pair)
            ) {
              reasons.set(
                pair,
                new Set()
              );
            }

            reasons.get(pair)
              .add(
                config.label
              );
          }
          else {
            seen.set(
              key,
              index
            );
          }
        }
      );
    }

    const groups =
      new Map();

    papers.forEach(
      (paper, index) => {
        const root =
          find(index);

        if (
          !groups.has(root)
        ) {
          groups.set(
            root,
            []
          );
        }

        groups.get(root)
          .push({
            paper,
            index,
          });
      }
    );

    return [
      ...groups.values(),
    ]
      .filter(
        (members) =>
          members.length > 1
      )
      .map(
        (members) => {
          const reasonSet =
            new Set();

          for (
            let i = 0;
            i < members.length;
            i += 1
          ) {
            for (
              let j = i + 1;
              j < members.length;
              j += 1
            ) {
              const pair =
                [
                  Math.min(
                    members[i].index,
                    members[j].index
                  ),
                  Math.max(
                    members[i].index,
                    members[j].index
                  ),
                ].join(":");

              for (
                const reason
                of reasons.get(pair)
                || []
              ) {
                reasonSet.add(
                  reason
                );
              }
            }
          }

          return {
            kind:
              "duplicate-group",
            title:
              members[0]
                .paper.title,
            detail:
              [
                ...reasonSet,
              ].join(" + ")
              || "Exact identifier",
            papers:
              members.map(
                (member) =>
                  member.paper
              ),
          };
        }
      );
  }

  maintenancePossibleDuplicates(
    papers,
    exactGroups
  ) {
    const exactPairs =
      new Set();

    for (
      const group
      of exactGroups
    ) {
      const paths =
        group.papers.map(
          (paper) =>
            paper.file.path
        );

      for (
        let i = 0;
        i < paths.length;
        i += 1
      ) {
        for (
          let j = i + 1;
          j < paths.length;
          j += 1
        ) {
          exactPairs.add(
            [
              paths[i],
              paths[j],
            ]
              .sort()
              .join("|")
          );
        }
      }
    }

    const buckets =
      new Map();

    for (
      const paper
      of papers
    ) {
      const normalized =
        this.normalizeTitleForMatch(
          paper.title
        );

      const bucket =
        normalized
          .split(" ")
          .filter(Boolean)
          .slice(0, 2)
          .join(" ");

      if (!bucket) {
        continue;
      }

      if (
        !buckets.has(bucket)
      ) {
        buckets.set(
          bucket,
          []
        );
      }

      buckets.get(bucket)
        .push(paper);
    }

    const pairs =
      [];

    for (
      const candidates
      of buckets.values()
    ) {
      if (
        candidates.length < 2
      ) {
        continue;
      }

      for (
        let i = 0;
        i < candidates.length;
        i += 1
      ) {
        for (
          let j = i + 1;
          j < candidates.length;
          j += 1
        ) {
          const left =
            candidates[i];

          const right =
            candidates[j];

          const pairKey =
            [
              left.file.path,
              right.file.path,
            ]
              .sort()
              .join("|");

          if (
            exactPairs.has(
              pairKey
            )
          ) {
            continue;
          }

          const leftYear =
            Number(
              left.year || 0
            );

          const rightYear =
            Number(
              right.year || 0
            );

          if (
            leftYear
            && rightYear
            && Math.abs(
              leftYear
              - rightYear
            ) > 1
          ) {
            continue;
          }

          const titleScore =
            this.titleSimilarity(
              left.title,
              right.title
            );

          if (
            titleScore < 0.965
          ) {
            continue;
          }

          const authorScore =
            this.authorSimilarity(
              (left.authors || [])
                .join(" "),
              right.authors || []
            );

          if (
            authorScore < 0.72
          ) {
            continue;
          }

          pairs.push({
            kind:
              "duplicate-group",
            title:
              left.title,
            detail:
              `Title ${
                Math.round(
                  titleScore * 100
                )
              }% · Authors ${
                Math.round(
                  authorScore * 100
                )
              }%`,
            papers: [
              left,
              right,
            ],
          });
        }
      }
    }

    return pairs;
  }

  maintenanceMissingOrganizationDefinitions(
    papers
  ) {
    const missing =
      new Map();

    const types = [
      "topic",
      "project",
      "collection",
    ];

    for (
      const type
      of types
    ) {
      const config =
        this.organizationConfig(
          type
        );

      for (
        const paper
        of papers
      ) {
        for (
          const rawName
          of paper[
            config.field
          ] || []
        ) {
          const name =
            String(
              rawName || ""
            ).trim();

          if (
            !name
            || this.organizationEntityFile(
              type,
              name
            )
          ) {
            continue;
          }

          const key =
            `${type}:${name.toLowerCase()}`;

          if (
            !missing.has(
              key
            )
          ) {
            missing.set(
              key,
              {
                kind:
                  "relation",
                title:
                  `${config.label} · ${name}`,
                detail:
                  "",
                type,
                name,
                papers: [],
              }
            );
          }

          missing.get(key)
            .papers.push(
              paper
            );
        }
      }
    }

    return [
      ...missing.values(),
    ]
      .map(
        (item) => ({
          ...item,
          detail:
            `${item.papers.length} ${
              item.papers.length === 1
                ? "paper"
                : "papers"
            }`,
        })
      );
  }

  maintenanceBuildReport(
    papers,
    pdfFiles
  ) {
    const metadata = [];
    const duplicates = [];
    const files = [];
    const schema = [];

    const publicationItems =
      papers
        .filter(
          (paper) =>
            this.needsPublicationResolution(
              this.paperAsMetadata(
                paper
              )
            )
        )
        .map(
          (paper) => ({
            kind:
              "paper",
            paper,
            title:
              paper.title,
            detail:
              [
                paper.venue,
                paper.year,
              ]
                .filter(Boolean)
                .join(" · "),
          })
        );

    metadata.push(
      this.maintenanceIssue({
        id:
          "publication-resolution",
        category:
          "metadata",
        label:
          "Publication resolution",
        icon:
          "refresh-cw",
        items:
          publicationItems,
      })
    );

    const missingDoi =
      papers
        .filter(
          (paper) => {
            const meta =
              this.paperAsMetadata(
                paper
              );

            const kind =
              this.publicationKind(
                meta
              );

            return (
              (
                kind === "conference"
                || kind === "journal"
              )
              && !paper.doi
            );
          }
        )
        .map(
          (paper) => ({
            kind:
              "paper",
            paper,
            title:
              paper.title,
            detail:
              [
                paper.venue,
                paper.year,
              ]
                .filter(Boolean)
                .join(" · "),
          })
        );

    metadata.push(
      this.maintenanceIssue({
        id:
          "missing-doi",
        category:
          "metadata",
        label:
          "Missing DOI",
        icon:
          "link-2-off",
        items:
          missingDoi,
      })
    );

    const incompleteMetadata =
      papers
        .filter(
          (paper) =>
            !paper.authors?.length
            || !paper.year
        )
        .map(
          (paper) => {
            const missing = [];

            if (
              !paper.authors?.length
            ) {
              missing.push(
                "Authors"
              );
            }

            if (!paper.year) {
              missing.push(
                "Year"
              );
            }

            return {
              kind:
                "paper",
              paper,
              title:
                paper.title,
              detail:
                missing.join(" + "),
            };
          }
        );

    metadata.push(
      this.maintenanceIssue({
        id:
          "incomplete-metadata",
        category:
          "metadata",
        label:
          "Incomplete metadata",
        icon:
          "circle-dashed",
        items:
          incompleteMetadata,
      })
    );

    const unverified =
      papers
        .filter(
          (paper) =>
            !paper.metadataVerified
        )
        .map(
          (paper) => ({
            kind:
              "paper",
            paper,
            title:
              paper.title,
            detail:
              paper.metadataSource
              || "Unverified",
          })
        );

    metadata.push(
      this.maintenanceIssue({
        id:
          "unverified-metadata",
        category:
          "metadata",
        label:
          "Unverified metadata",
        icon:
          "badge-question-mark",
        items:
          unverified,
      })
    );

    const exactGroups =
      this.maintenanceExactDuplicateGroups(
        papers
      );

    duplicates.push(
      this.maintenanceIssue({
        id:
          "exact-duplicates",
        category:
          "duplicates",
        label:
          "Exact duplicates",
        icon:
          "copy-check",
        severity:
          exactGroups.length
            ? "warning"
            : "normal",
        items:
          exactGroups,
      })
    );

    const possiblePairs =
      this.maintenancePossibleDuplicates(
        papers,
        exactGroups
      );

    duplicates.push(
      this.maintenanceIssue({
        id:
          "possible-duplicates",
        category:
          "duplicates",
        label:
          "Possible duplicates",
        icon:
          "copy",
        items:
          possiblePairs,
      })
    );

    const referencedPdfPaths =
      new Set();

    const missingPdf =
      [];

    for (
      const paper
      of papers
    ) {
      const pdf =
        this.maintenancePaperPdfFile(
          paper
        );

      if (
        pdf instanceof TFile
      ) {
        referencedPdfPaths.add(
          pdf.path
        );
      }
      else {
        missingPdf.push({
          kind:
            "paper",
          paper,
          title:
            paper.title,
          detail:
            paper.pdf
            || "No PDF link",
        });
      }
    }

    files.push(
      this.maintenanceIssue({
        id:
          "missing-pdf",
        category:
          "files",
        label:
          "Missing PDF",
        icon:
          "file-x-2",
        severity:
          missingPdf.length
            ? "warning"
            : "normal",
        items:
          missingPdf,
      })
    );

    const orphanPdfs =
      (pdfFiles || [])
        .filter(
          (file) =>
            !referencedPdfPaths.has(
              file.path
            )
        )
        .map(
          (file) => ({
            kind:
              "file",
            file,
            title:
              file.name,
            detail:
              file.path,
          })
        );

    files.push(
      this.maintenanceIssue({
        id:
          "orphan-pdf",
        category:
          "files",
        label:
          "Orphan PDF",
        icon:
          "file-question",
        items:
          orphanPdfs,
      })
    );

    const invalidSchema =
      papers
        .filter(
          (paper) =>
            String(
              paper.schema || ""
            ).trim()
            !== "paper/v2"
        )
        .map(
          (paper) => ({
            kind:
              "paper",
            paper,
            title:
              paper.title,
            detail:
              paper.schema
              ? `schema: ${paper.schema}`
              : "schema missing",
          })
        );

    schema.push(
      this.maintenanceIssue({
        id:
          "invalid-schema",
        category:
          "schema",
        label:
          "Schema mismatch",
        icon:
          "file-warning",
        severity:
          invalidSchema.length
            ? "warning"
            : "normal",
        items:
          invalidSchema,
      })
    );

    const citekeyAudit =
      this.citationAudit(
        papers
      );

    const citekeyIssues =
      citekeyAudit.blocking
        .map(
          (issue) => ({
            kind:
              "paper",
            paper:
              issue.paper,
            title:
              issue.paper
                ?.title
              || "Paper",
            detail:
              issue.message,
            issueType:
              issue.type,
          })
        );

    schema.push(
      this.maintenanceIssue({
        id:
          "citekey-issues",
        category:
          "schema",
        label:
          "Citekey issues",
        icon:
          "key-round",
        severity:
          citekeyIssues.length
            ? "warning"
            : "normal",
        items:
          citekeyIssues,
      })
    );

    const validStatuses =
      new Set([
        "inbox",
        "queued",
        "reading",
        "read",
        "archived",
      ]);

    const invalidStatuses =
      papers
        .filter(
          (paper) =>
            !validStatuses.has(
              String(
                paper.rawStatus || ""
              ).trim()
            )
        )
        .map(
          (paper) => ({
            kind:
              "paper",
            paper,
            title:
              paper.title,
            detail:
              paper.rawStatus
              ? `status: ${paper.rawStatus}`
              : "status missing",
          })
        );

    schema.push(
      this.maintenanceIssue({
        id:
          "invalid-status",
        category:
          "schema",
        label:
          "Status issues",
        icon:
          "circle-alert",
        items:
          invalidStatuses,
      })
    );

    const missingRelations =
      this.maintenanceMissingOrganizationDefinitions(
        papers
      );

    schema.push(
      this.maintenanceIssue({
        id:
          "missing-organization-definition",
        category:
          "schema",
        label:
          "Missing organization definition",
        icon:
          "file-symlink",
        items:
          missingRelations,
      })
    );

    const categoryMap = {
      metadata: {
        id:
          "metadata",
        label:
          "Metadata",
        icon:
          "database",
        issues:
          metadata,
      },
      duplicates: {
        id:
          "duplicates",
        label:
          "Duplicates",
        icon:
          "copy",
        issues:
          duplicates,
      },
      files: {
        id:
          "files",
        label:
          "Files",
        icon:
          "folder-search-2",
        issues:
          files,
      },
      schema: {
        id:
          "schema",
        label:
          "Schema",
        icon:
          "braces",
        issues:
          schema,
      },
    };

    for (
      const category
      of Object.values(
        categoryMap
      )
    ) {
      category.count =
        category.issues.reduce(
          (
            total,
            issue
          ) =>
            total
            + issue.count,
          0
        );
    }

    return {
      papers,
      pdfFiles:
        pdfFiles || [],
      categories:
        categoryMap,
      categoryList:
        [
          categoryMap.metadata,
          categoryMap.duplicates,
          categoryMap.files,
          categoryMap.schema,
        ],
      totalFindings:
        Object.values(
          categoryMap
        ).reduce(
          (
            total,
            category
          ) =>
            total
            + category.count,
          0
        ),
      scannedAt:
        Date.now(),
    };
  }

  maintenanceScan() {
    const papers =
      this.maintenancePaperSnapshot();

    const pdfFiles =
      this.maintenancePdfSnapshot();

    return this.maintenanceBuildReport(
      papers,
      pdfFiles
    );
  }

  maintenanceSafeFixPlan(
    report = null
  ) {
    const source =
      report
      || this.maintenanceScan();

    const tasks =
      [];

    const schemaIssue =
      source.categories
        ?.schema?.issues
        ?.find(
          (issue) =>
            issue.id
            === "invalid-schema"
        );

    for (
      const item
      of schemaIssue?.items
      || []
    ) {
      const paper =
        item.paper;

      // Explicit old/unknown schema versions may require an actual
      // migration. Only a missing schema marker is deterministic.
      if (
        !paper
        || String(
          paper.schema || ""
        ).trim()
      ) {
        continue;
      }

      tasks.push({
        id:
          `schema:${
            paper.file.path
          }`,
        kind:
          "schema",
        icon:
          "file-check-2",
        label:
          "Schema",
        target:
          paper.title,
        detail:
          "paper/v2",
        paper,
        signature:
          this.paperFileSignature(
            paper.file
          ),
        value:
          "paper/v2",
      });
    }

    const citekeyIssue =
      source.categories
        ?.schema?.issues
        ?.find(
          (issue) =>
            issue.id
            === "citekey-issues"
        );

    const usedCitekeys =
      new Set(
        source.papers
          .map(
            (paper) =>
              this.normalizeCitekey(
                paper.citekey
              ).toLowerCase()
          )
          .filter(Boolean)
      );

    const missingCitekeyItems =
      (
        citekeyIssue?.items
        || []
      )
        .filter(
          (item) =>
            item.issueType
            === "missing"
        )
        .sort(
          (a, b) =>
            String(
              a.paper?.file?.path
              || ""
            ).localeCompare(
              String(
                b.paper?.file?.path
                || ""
              )
            )
        );

    for (
      const item
      of missingCitekeyItems
    ) {
      const paper =
        item.paper;

      if (
        !paper?.authors?.length
        || !paper.year
        || !paper.title
      ) {
        continue;
      }

      const base =
        this.normalizeCitekey(
          this.suggestedCitekey(
            paper
          )
        );

      if (
        !base
        || !this.validCitekey(
          base
        )
      ) {
        continue;
      }

      let candidate =
        base;

      let index =
        0;

      while (
        usedCitekeys.has(
          candidate.toLowerCase()
        )
      ) {
        index += 1;

        candidate =
          `${base}${
            this.alphaSuffix(
              index
            )
          }`;
      }

      usedCitekeys.add(
        candidate.toLowerCase()
      );

      tasks.push({
        id:
          `citekey:${
            paper.file.path
          }`,
        kind:
          "citekey",
        icon:
          "key-round",
        label:
          "Citekey",
        target:
          paper.title,
        detail:
          candidate,
        paper,
        signature:
          this.paperFileSignature(
            paper.file
          ),
        value:
          candidate,
      });
    }

    const relationIssue =
      source.categories
        ?.schema?.issues
        ?.find(
          (issue) =>
            issue.id
            === "missing-organization-definition"
        );

    for (
      const item
      of relationIssue?.items
      || []
    ) {
      try {
        const clean =
          this.cleanOrganizationName(
            item.name
          );

        tasks.push({
          id:
            `organization:${
              item.type
            }:${
              clean.toLowerCase()
            }`,
          kind:
            "organization",
          icon:
            item.type
            === "topic"
              ? "tags"
              : item.type
              === "project"
                ? "folder-kanban"
                : "list",
          label:
            `Create ${
              this.organizationConfig(
                item.type
              ).label
            }`,
          target:
            clean,
          detail:
            `${item.papers?.length || 0} ${
              item.papers?.length === 1
                ? "paper"
                : "papers"
            }`,
          organizationType:
            item.type,
          name:
            clean,
        });
      }
      catch (_) {
        // Invalid names remain Review-only.
      }
    }

    return tasks;
  }

  async maintenanceApplySafeFixes(...args) {
    return this.withExclusiveWrite(
      "Maintenance safe fixes",
      () =>
        this._maintenanceApplySafeFixes(
          ...args
        )
    );
  }

  async _maintenanceApplySafeFixes(
    tasks
  ) {
    const unique =
      [];

    const seen =
      new Set();

    for (
      const task
      of tasks || []
    ) {
      if (
        !task?.id
        || seen.has(
          task.id
        )
      ) {
        continue;
      }

      seen.add(
        task.id
      );

      unique.push(
        task
      );
    }

    if (!unique.length) {
      return {
        applied:
          0,
      };
    }

    const paperPatches =
      new Map();

    const organizationTasks =
      [];

    for (
      const task
      of unique
    ) {
      if (
        task.kind
        === "organization"
      ) {
        if (
          this.organizationEntityFile(
            task.organizationType,
            task.name
          )
        ) {
          continue;
        }

        this.cleanOrganizationName(
          task.name
        );

        organizationTasks.push(
          task
        );

        continue;
      }

      const paperPath =
        task.paper?.file?.path;

      if (!paperPath) {
        throw new Error(
          "Safe fix 缺少 Paper 路径。"
        );
      }

      const file =
        this.app.vault
          .getAbstractFileByPath(
            paperPath
          );

      if (
        !(file instanceof TFile)
      ) {
        throw new Error(
          `Paper Note 不存在：${paperPath}`
        );
      }

      if (
        task.signature
        && this.paperFileSignature(
          file
        ) !== task.signature
      ) {
        const error =
          new Error(
            `Safe fix Review 后 Paper 已发生变化：${paperPath}`
          );

        error.code =
          "RL_STALE_WRITE";

        throw error;
      }

      if (
        !paperPatches.has(
          paperPath
        )
      ) {
        paperPatches.set(
          paperPath,
          {
            file,
            schema:
              null,
            citekey:
              null,
          }
        );
      }

      const patch =
        paperPatches.get(
          paperPath
        );

      if (
        task.kind
        === "schema"
      ) {
        patch.schema =
          "paper/v2";
      }
      else if (
        task.kind
        === "citekey"
      ) {
        const value =
          this.normalizeCitekey(
            task.value
          );

        if (
          !this.validCitekey(
            value
          )
        ) {
          throw new Error(
            `生成的 Citekey 无效：${value}`
          );
        }

        const collision =
          this.papers.find(
            (paper) =>
              paper.file.path
                !== paperPath
              && this.normalizeCitekey(
                paper.citekey
              ).toLowerCase()
                === value.toLowerCase()
          );

        if (collision) {
          throw new Error(
            `Citekey 已被使用：${value}`
          );
        }

        patch.citekey =
          value;
      }
    }

    const snapshots =
      new Map();

    for (
      const [
        path,
        patch,
      ]
      of paperPatches
    ) {
      snapshots.set(
        path,
        await this.app.vault
          .cachedRead(
            patch.file
          )
      );
    }

    const createdOrganizationPaths =
      [];

    let appliedTasks =
      0;

    this.suppressRefreshUntil =
      Date.now() + 5000;

    try {
      for (
        const patch
        of paperPatches.values()
      ) {
        await this.app.fileManager
          .processFrontMatter(
            patch.file,
            (fm) => {
              if (
                patch.schema
              ) {
                // If the file changed after scan, do not overwrite
                // an explicit schema the user just authored.
                if (
                  String(
                    fm.schema || ""
                  ).trim()
                ) {
                  throw new Error(
                    `Schema 已发生变化：${patch.file.basename}`
                  );
                }

                fm.schema =
                  patch.schema;

                appliedTasks += 1;
              }

              if (
                patch.citekey
              ) {
                const existing =
                  this.normalizeCitekey(
                    fm.citekey
                  );

                if (existing) {
                  throw new Error(
                    `Citekey 已发生变化：${patch.file.basename}`
                  );
                }

                fm.citekey =
                  patch.citekey;

                appliedTasks += 1;
              }
            }
          );
      }

      for (
        const task
        of organizationTasks
      ) {
        const before =
          this.organizationEntityFile(
            task.organizationType,
            task.name
          );

        if (before) {
          continue;
        }

        const file =
          await this.ensureOrganizationEntity(
            task.organizationType,
            task.name
          );

        if (
          file instanceof TFile
        ) {
          createdOrganizationPaths.push(
            file.path
          );

          appliedTasks += 1;
        }
      }
    }
    catch (error) {
      const rollbackErrors =
        [];

      for (
        const [
          path,
          content,
        ]
        of snapshots
      ) {
        try {
          const file =
            this.app.vault
              .getAbstractFileByPath(
                path
              );

          if (
            file instanceof TFile
          ) {
            await this.app.vault
              .modify(
                file,
                content
              );
          }
        }
        catch (rollbackError) {
          rollbackErrors.push(
            rollbackError
          );
        }
      }

      for (
        const path
        of [...createdOrganizationPaths]
          .reverse()
      ) {
        try {
          const file =
            this.app.vault
              .getAbstractFileByPath(
                path
              );

          if (
            file instanceof TFile
          ) {
            await this.app.fileManager
              .trashFile(
                file
              );
          }
        }
        catch (rollbackError) {
          rollbackErrors.push(
            rollbackError
          );
        }
      }

      console.error(
        "Research Library: Maintenance safe fixes rolled back",
        {
          cause:
            error,
          rollbackErrors,
        }
      );

      throw new Error(
        rollbackErrors.length
          ? `Safe fixes 失败；已尝试回滚，但有 ${rollbackErrors.length} 项需要检查。`
          : "Safe fixes 失败，已恢复原状态。"
      );
    }

    this.invalidatePaperPaths([
      ...paperPatches.keys(),
    ]);

    await this.loadPapers();

    this.render();

    await this.syncBibliographyIfEnabled();

    return {
      applied:
        appliedTasks,
      paperPatches:
        paperPatches.size,
      organizationDefinitions:
        createdOrganizationPaths.length,
    };
  }

  duplicateMergeMasterScore(
    paper
  ) {
    const meta =
      this.paperAsMetadata(
        paper
      );

    const kind =
      this.publicationKind(
        meta
      );

    let score =
      0;

    if (
      kind !== "preprint"
      && kind !== "unknown"
    ) {
      score += 28;
    }

    if (
      paper.metadataVerified
    ) {
      score += 14;
    }

    if (
      paper.doi
      && !this.isArxivDoi(
        paper.doi
      )
    ) {
      score += 10;
    }

    if (paper.venue) {
      score += 5;
    }

    if (paper.pages) {
      score += 3;
    }

    if (
      paper.authors?.length
    ) {
      score +=
        Math.min(
          7,
          paper.authors.length
        );
    }

    if (paper.alias) {
      score += 2;
    }

    if (paper.note) {
      score += 2;
    }

    if (paper.rating) {
      score += 1;
    }

    return score;
  }

  duplicateMergeDefaultMaster(
    papers
  ) {
    return [...(papers || [])]
      .sort(
        (a, b) =>
          this.duplicateMergeMasterScore(
            b
          )
          - this.duplicateMergeMasterScore(
              a
            )
          || String(
            a.file?.path || ""
          ).localeCompare(
            String(
              b.file?.path || ""
            )
          )
      )[0]
      || null;
  }

  duplicateMergeValueKey(
    value
  ) {
    if (
      Array.isArray(value)
    ) {
      return JSON.stringify(
        value
          .map(
            (item) =>
              String(
                item ?? ""
              ).trim()
          )
      );
    }

    if (
      typeof value
      === "number"
    ) {
      return `n:${value}`;
    }

    if (
      typeof value
      === "boolean"
    ) {
      return `b:${value}`;
    }

    return `s:${
      String(
        value ?? ""
      )
        .replace(
          /\r\n/g,
          "\n"
        )
        .trim()
    }`;
  }

  duplicateMergeValuesEqual(
    left,
    right
  ) {
    return (
      this.duplicateMergeValueKey(
        left
      )
      === this.duplicateMergeValueKey(
        right
      )
    );
  }

  duplicateMergeEmptyValue(
    value,
    {
      zeroIsEmpty = false,
    } = {}
  ) {
    if (
      value === null
      || value === undefined
    ) {
      return true;
    }

    if (
      Array.isArray(value)
    ) {
      return !value.length;
    }

    if (
      zeroIsEmpty
      && Number(value) === 0
    ) {
      return true;
    }

    return !String(value)
      .trim();
  }

  duplicateMergeUnionValues(
    values
  ) {
    const result =
      [];

    const seen =
      new Set();

    for (
      const value
      of values || []
    ) {
      const clean =
        String(
          value ?? ""
        ).trim();

      if (!clean) {
        continue;
      }

      const key =
        clean.toLowerCase();

      if (
        seen.has(key)
      ) {
        continue;
      }

      seen.add(key);
      result.push(clean);
    }

    return result;
  }

  duplicateMergeMetadataDefinitions() {
    return [
      {
        key:
          "title",
        label:
          "Title",
        frontmatterKey:
          "title",
      },
      {
        key:
          "authors",
        label:
          "Authors",
        frontmatterKey:
          "authors",
      },
      {
        key:
          "year",
        label:
          "Year",
        frontmatterKey:
          "year",
      },
      {
        key:
          "venue",
        label:
          "Venue",
        frontmatterKey:
          "venue",
      },
      {
        key:
          "workType",
        label:
          "Work type",
        frontmatterKey:
          "work_type",
      },
      {
        key:
          "publisher",
        label:
          "Publisher",
        frontmatterKey:
          "publisher",
        allowClear:
          true,
      },
      {
        key:
          "volume",
        label:
          "Volume",
        frontmatterKey:
          "volume",
      },
      {
        key:
          "issue",
        label:
          "Issue",
        frontmatterKey:
          "issue",
      },
      {
        key:
          "pages",
        label:
          "Pages",
        frontmatterKey:
          "pages",
      },
      {
        key:
          "doi",
        label:
          "DOI",
        frontmatterKey:
          "doi",
      },
      {
        key:
          "arxiv",
        label:
          "arXiv",
        frontmatterKey:
          "arxiv",
      },
      {
        key:
          "url",
        label:
          "URL",
        frontmatterKey:
          "url",
      },
    ];
  }

  duplicateMergePersonalDefinitions() {
    return [
      {
        key:
          "alias",
        label:
          "Alias",
        frontmatterKey:
          "alias",
      },
      {
        key:
          "note",
        label:
          "Note",
        frontmatterKey:
          "note",
      },
      {
        key:
          "rating",
        label:
          "Rating",
        frontmatterKey:
          "rating",
        zeroIsEmpty:
          true,
      },
      {
        key:
          "status",
        label:
          "Status",
        frontmatterKey:
          "status",
        alwaysReviewDifference:
          true,
      },
      {
        key:
          "priority",
        label:
          "Priority",
        frontmatterKey:
          "priority",
        zeroIsEmpty:
          true,
      },
      {
        key:
          "dateStarted",
        label:
          "Date started",
        frontmatterKey:
          "date_started",
      },
      {
        key:
          "dateRead",
        label:
          "Date read",
        frontmatterKey:
          "date_read",
      },
    ];
  }

  duplicateMergeRecommendedMetadata(
    papers,
    master
  ) {
    const base =
      this.paperAsMetadata(
        master
      );

    const metas =
      papers.map(
        (paper) =>
          this.paperAsMetadata(
            paper
          )
      );

    let recommended = {
      ...base,
      authors:
        [...(
          base.authors || []
        )],
      keywords:
        [...(
          base.keywords || []
        )],
    };

    const formal =
      this.canonicalFormalPublicationMeta(
        base,
        metas
      );

    if (formal) {
      recommended =
        this.mergeFormalPublicationMeta(
          base,
          formal
        );
    }

    for (
      const definition
      of this.duplicateMergeMetadataDefinitions()
    ) {
      const key =
        definition.key;

      const current =
        recommended[key];

      const isEmpty =
        this.duplicateMergeEmptyValue(
          current
        );

      if (!isEmpty) {
        continue;
      }

      let best =
        null;

      if (
        key === "doi"
      ) {
        best =
          metas
            .map(
              (meta) =>
                this.normalizeDoi(
                  meta.doi || ""
                )
            )
            .find(
              (value) =>
                value
                && !this.isArxivDoi(
                  value
                )
            )
          || metas
            .map(
              (meta) =>
                this.normalizeDoi(
                  meta.doi || ""
                )
            )
            .find(Boolean)
          || "";
      }
      else if (
        key === "arxiv"
      ) {
        best =
          metas
            .map(
              (meta) =>
                this.arxivIdFromMeta(
                  meta
                )
            )
            .find(Boolean)
          || "";
      }
      else {
        best =
          this.bestPublicationField(
            metas,
            key
          );
      }

      if (
        best !== null
        && best !== undefined
        && !this.duplicateMergeEmptyValue(
          best
        )
      ) {
        recommended[key] =
          Array.isArray(best)
            ? [...best]
            : best;
      }
    }

    // If no formal resolution was needed, keep an existing
    // non-empty Master field rather than replacing it merely
    // because another duplicate uses different capitalization.
    if (!formal) {
      for (
        const definition
        of this.duplicateMergeMetadataDefinitions()
      ) {
        const key =
          definition.key;

        if (
          !this.duplicateMergeEmptyValue(
            base[key]
          )
        ) {
          recommended[key] =
            Array.isArray(
              base[key]
            )
              ? [...base[key]]
              : base[key];
        }
      }
    }

    recommended.keywords =
      this.duplicateMergeUnionValues(
        papers.flatMap(
          (paper) =>
            paper.keywords || []
        )
      );

    recommended.metadataSources =
      this.duplicateMergeUnionValues(
        papers.flatMap(
          (paper) =>
            paper.metadataSources?.length
              ? paper.metadataSources
              : paper.metadataSource
                ? String(
                    paper.metadataSource
                  ).split("+")
                : []
        )
      );

    recommended.metadataVerified =
      papers.some(
        (paper) =>
          Boolean(
            paper.metadataVerified
          )
      );

    return {
      recommended,
      formal:
        Boolean(formal),
    };
  }

  duplicateMergeChoice(
    papers,
    master,
    definition,
    getter
  ) {
    const masterValue =
      getter(master);

    const entries =
      papers.map(
        (paper) => ({
          paper,
          value:
            getter(paper),
        })
      );

    const unique =
      [];

    const seen =
      new Set();

    for (
      const entry
      of entries
    ) {
      const key =
        this.duplicateMergeValueKey(
          entry.value
        );

      if (
        seen.has(key)
      ) {
        continue;
      }

      seen.add(key);
      unique.push(entry);
    }

    if (
      unique.length <= 1
    ) {
      return {
        kind:
          "same",
        value:
          masterValue,
      };
    }

    const nonEmpty =
      unique.filter(
        (entry) =>
          !this.duplicateMergeEmptyValue(
            entry.value,
            {
              zeroIsEmpty:
                Boolean(
                  definition
                    .zeroIsEmpty
                ),
            }
          )
      );

    const masterEmpty =
      this.duplicateMergeEmptyValue(
        masterValue,
        {
          zeroIsEmpty:
            Boolean(
              definition
                .zeroIsEmpty
            ),
        }
      );

    if (
      !definition
        .alwaysReviewDifference
      && masterEmpty
      && nonEmpty.length === 1
    ) {
      return {
        kind:
          "auto",
        value:
          nonEmpty[0].value,
        source:
          nonEmpty[0].paper,
      };
    }

    const options =
      [];

    const masterEntry =
      entries.find(
        (entry) =>
          entry.paper.file.path
          === master.file.path
      );

    if (masterEntry) {
      options.push(
        masterEntry
      );
    }

    for (
      const entry
      of unique
    ) {
      if (
        entry.paper.file.path
        === master.file.path
      ) {
        continue;
      }

      // Empty source values never need to erase an existing
      // Master value. An empty Master remains a valid explicit
      // choice when sources disagree.
      if (
        this.duplicateMergeEmptyValue(
          entry.value,
          {
            zeroIsEmpty:
              Boolean(
                definition
                  .zeroIsEmpty
              ),
          }
        )
        && !masterEmpty
      ) {
        continue;
      }

      options.push(
        entry
      );
    }

    return {
      kind:
        "conflict",
      masterValue,
      options,
    };
  }

  duplicateMergeSectionDefinitions() {
    return [
      this.detailSectionSpec(
        "abstract"
      ),
      this.detailSectionSpec(
        "tldr"
      ),
      this.detailSectionSpec(
        "question"
      ),
      this.detailSectionSpec(
        "contribution"
      ),
      this.detailSectionSpec(
        "notes"
      ),
    ]
      .filter(Boolean);
  }

  duplicateMergePdfExternalReferences(
    pdfFile,
    groupPapers
  ) {
    if (
      !(pdfFile instanceof TFile)
    ) {
      return 0;
    }

    const groupPaths =
      new Set(
        (groupPapers || [])
          .map(
            (paper) =>
              paper.file?.path
          )
          .filter(Boolean)
      );

    let count =
      0;

    for (
      const paper
      of this.papers
    ) {
      if (
        groupPaths.has(
          paper.file.path
        )
      ) {
        continue;
      }

      const other =
        this.maintenancePaperPdfFile(
          paper
        );

      if (
        other instanceof TFile
        && other.path
          === pdfFile.path
      ) {
        count += 1;
      }
    }

    return count;
  }

  duplicateMergeArchiveFolder() {
    return normalizePath(
      "Research/99 System/Merged Duplicates"
    );
  }

  duplicateMergeAvailableArchivePath(
    file
  ) {
    const folder =
      this.duplicateMergeArchiveFolder();

    const direct =
      normalizePath(
        `${folder}/${file.name}`
      );

    if (
      !this.app.vault
        .getAbstractFileByPath(
          direct
        )
    ) {
      return direct;
    }

    const extension =
      file.extension
      || "md";

    const basename =
      file.basename
      || "paper";

    for (
      let index = 2;
      index < 10000;
      index += 1
    ) {
      const path =
        normalizePath(
          `${folder}/${basename}-${index}.${extension}`
        );

      if (
        !this.app.vault
          .getAbstractFileByPath(
            path
          )
      ) {
        return path;
      }
    }

    throw new Error(
      "Merged Duplicates 中无法生成安全文件名。"
    );
  }

  async duplicateMergeBuildContext(
    inputPapers,
    masterPath = ""
  ) {
    const papers =
      (inputPapers || [])
        .map(
          (paper) =>
            this.papers.find(
              (candidate) =>
                candidate.file.path
                === paper.file.path
            )
            || paper
        )
        .filter(
          (paper) =>
            paper?.file
        );

    if (
      papers.length < 2
    ) {
      throw new Error(
        "至少需要两篇论文才能合并。"
      );
    }

    const paperStates =
      new Map();

    for (
      const paper
      of papers
    ) {
      paperStates.set(
        paper.file.path,
        await this.captureFileState(
          paper.file,
          "Duplicate review Paper"
        )
      );
    }

    let master =
      papers.find(
        (paper) =>
          paper.file.path
          === masterPath
      );

    if (!master) {
      master =
        this.duplicateMergeDefaultMaster(
          papers
        );
    }

    const sources =
      papers.filter(
        (paper) =>
          paper.file.path
          !== master.file.path
      );

    const metadata =
      this.duplicateMergeRecommendedMetadata(
        papers,
        master
      );

    const metadataChanges =
      [];

    for (
      const definition
      of this.duplicateMergeMetadataDefinitions()
    ) {
      const current =
        master[
          definition.key
        ];

      const found =
        metadata.recommended[
          definition.key
        ];

      if (
        this.duplicateMergeValuesEqual(
          current,
          found
        )
      ) {
        continue;
      }

      if (
        this.duplicateMergeEmptyValue(
          found
        )
        && !definition.allowClear
      ) {
        continue;
      }

      metadataChanges.push({
        ...definition,
        current,
        found,
      });
    }

    const unions = {
      topics:
        this.duplicateMergeUnionValues(
          papers.flatMap(
            (paper) =>
              paper.topics || []
          )
        ),
      projects:
        this.duplicateMergeUnionValues(
          papers.flatMap(
            (paper) =>
              paper.projects || []
          )
        ),
      collections:
        this.duplicateMergeUnionValues(
          papers.flatMap(
            (paper) =>
              paper.collections
              || []
          )
        ),
      keywords:
        this.duplicateMergeUnionValues(
          papers.flatMap(
            (paper) =>
              paper.keywords || []
          )
        ),
      figures:
        this.duplicateMergeUnionValues(
          papers.flatMap(
            (paper) =>
              paper.figures || []
          )
        ),
    };

    const personalAuto =
      {};

    const conflicts =
      [];

    for (
      const definition
      of this.duplicateMergePersonalDefinitions()
    ) {
      const choice =
        this.duplicateMergeChoice(
          papers,
          master,
          definition,
          (paper) =>
            paper[
              definition.key
            ]
        );

      if (
        choice.kind
        === "auto"
      ) {
        personalAuto[
          definition.key
        ] =
          choice.value;
      }
      else if (
        choice.kind
        === "conflict"
      ) {
        conflicts.push({
          id:
            `personal:${
              definition.key
            }`,
          type:
            "personal",
          label:
            definition.label,
          definition,
          options:
            choice.options,
        });
      }
    }

    const sectionsByPath =
      new Map();

    for (
      const paper
      of papers
    ) {
      sectionsByPath.set(
        paper.file.path,
        await this.readPaperDetailSections(
          paper
        )
      );
    }

    for (
      const state
      of paperStates.values()
    ) {
      await this.assertFileState(
        state,
        "Duplicate review Paper"
      );
    }

    const sectionAuto =
      {};

    for (
      const spec
      of this.duplicateMergeSectionDefinitions()
    ) {
      const choice =
        this.duplicateMergeChoice(
          papers,
          master,
          {
            key:
              spec.key,
            label:
              spec.label,
          },
          (paper) =>
            sectionsByPath.get(
              paper.file.path
            )?.[
              spec.key
            ]
            || ""
        );

      if (
        choice.kind
        === "auto"
      ) {
        sectionAuto[
          spec.key
        ] =
          choice.value;
      }
      else if (
        choice.kind
        === "conflict"
      ) {
        conflicts.push({
          id:
            `section:${spec.key}`,
          type:
            "section",
          label:
            spec.label,
          spec,
          options:
            choice.options,
        });
      }
    }

    const pdfMap =
      new Map();

    for (
      const paper
      of papers
    ) {
      const file =
        this.maintenancePaperPdfFile(
          paper
        );

      if (
        !(file instanceof TFile)
      ) {
        continue;
      }

      if (
        !pdfMap.has(
          file.path
        )
      ) {
        pdfMap.set(
          file.path,
          {
            file,
            path:
              file.path,
            owners: [],
          }
        );
      }

      pdfMap.get(
        file.path
      ).owners.push(
        paper
      );
    }

    const pdfOptions =
      [...pdfMap.values()]
        .map(
          (option) => ({
            ...option,
            externalReferences:
              this.duplicateMergePdfExternalReferences(
                option.file,
                papers
              ),
          })
        );

    const masterPdf =
      this.maintenancePaperPdfFile(
        master
      );

    const selectedPdfPath =
      masterPdf instanceof TFile
        ? masterPdf.path
        : pdfOptions[0]?.path
          || "";

    const dateAdded =
      papers
        .map(
          (paper) =>
            String(
              paper.dateAdded || ""
            ).trim()
        )
        .filter(Boolean)
        .sort()[0]
      || master.dateAdded
      || "";

    return {
      papers,
      master,
      sources,
      paperStates,
      metadata:
        metadata.recommended,
      metadataWasFormal:
        metadata.formal,
      metadataChanges,
      unions,
      personalAuto,
      sectionAuto,
      sectionsByPath,
      conflicts,
      pdfOptions,
      selectedPdfPath,
      dateAdded,
    };
  }

  duplicateMergeResolvedValue(
    context,
    conflict,
    resolutions
  ) {
    const selectedPath =
      resolutions instanceof Map
        ? resolutions.get(
            conflict.id
          )
        : resolutions?.[
            conflict.id
          ];

    if (!selectedPath) {
      return {
        resolved:
          false,
      };
    }

    const option =
      conflict.options.find(
        (entry) =>
          entry.paper.file.path
          === selectedPath
      );

    if (!option) {
      return {
        resolved:
          false,
      };
    }

    return {
      resolved:
        true,
      value:
        option.value,
      paper:
        option.paper,
    };
  }

  async duplicateMergeApply(...args) {
    return this.withExclusiveWrite(
      "Duplicate merge",
      () =>
        this._duplicateMergeApply(
          ...args
        )
    );
  }

  async _duplicateMergeApply(
    context,
    {
      resolutions = new Map(),
      selectedPdfPath = "",
    } = {}
  ) {
    const masterPath =
      context.master.file.path;

    const sourcePaths =
      context.sources.map(
        (paper) =>
          paper.file.path
      );

    for (
      const state
      of context.paperStates?.values?.()
      || []
    ) {
      await this.assertFileState(
        state,
        "Duplicate merge Paper"
      );
    }

    for (
      const conflict
      of context.conflicts
    ) {
      const resolved =
        this.duplicateMergeResolvedValue(
          context,
          conflict,
          resolutions
        );

      if (!resolved.resolved) {
        throw new Error(
          `请先处理冲突：${conflict.label}`
        );
      }
    }

    const masterFile =
      this.app.vault
        .getAbstractFileByPath(
          masterPath
        );

    if (
      !(masterFile instanceof TFile)
    ) {
      throw new Error(
        "Master Paper Note 不存在。"
      );
    }

    const sourceFiles =
      sourcePaths.map(
        (path) =>
          this.app.vault
            .getAbstractFileByPath(
              path
            )
      );

    if (
      sourceFiles.some(
        (file) =>
          !(file instanceof TFile)
      )
    ) {
      throw new Error(
        "待合并的 Paper Note 已发生变化，请重新扫描。"
      );
    }

    const originalMasterContent =
      await this.app.vault
        .cachedRead(
          masterFile
        );

    const pdfMoves =
      [];

    const noteMoves =
      [];

    const actualSelectedPdf =
      selectedPdfPath
      && context.pdfOptions.some(
        (option) =>
          option.path
          === selectedPdfPath
      )
        ? selectedPdfPath
        : context.selectedPdfPath;

    const personalValues = {
      ...context.personalAuto,
    };

    const sectionValues = {
      ...context.sectionAuto,
    };

    for (
      const conflict
      of context.conflicts
    ) {
      const resolved =
        this.duplicateMergeResolvedValue(
          context,
          conflict,
          resolutions
        );

      if (
        conflict.type
        === "personal"
      ) {
        personalValues[
          conflict.definition.key
        ] =
          resolved.value;
      }
      else if (
        conflict.type
        === "section"
      ) {
        sectionValues[
          conflict.spec.key
        ] =
          resolved.value;
      }
    }

    const sources =
      this.duplicateMergeUnionValues(
        context.papers.flatMap(
          (paper) =>
            paper.metadataSources
              ?.length
              ? paper.metadataSources
              : paper.metadataSource
                ? String(
                    paper.metadataSource
                  ).split("+")
                : []
        )
      );

    this.suppressRefreshUntil =
      Date.now() + 5000;

    try {
      await this.app.fileManager
        .processFrontMatter(
          masterFile,
          (fm) => {
            for (
              const change
              of context.metadataChanges
            ) {
              if (
                change.key
                === "authors"
              ) {
                fm.authors =
                  [...(
                    change.found
                    || []
                  )];
              }
              else {
                fm[
                  change.frontmatterKey
                ] =
                  change.found;
              }
            }

            fm.topics =
              this.organizationStoredValues(
                "topic",
                context.unions.topics
              );

            fm.projects =
              this.organizationStoredValues(
                "project",
                context.unions.projects
              );

            fm.collections =
              this.organizationStoredValues(
                "collection",
                context.unions.collections
              );

            fm.keywords =
              [...context.unions.keywords];

            if (
              context.unions.figures
                ?.length
            ) {
              fm.figures =
                context.unions.figures
                  .map(
                    (path) =>
                      `[[${path}]]`
                  );

              delete fm.figure;
            }
            else {
              delete fm.figures;
              delete fm.figure;
            }

            if (
              context.dateAdded
            ) {
              fm.date_added =
                context.dateAdded;
            }

            for (
              const definition
              of this.duplicateMergePersonalDefinitions()
            ) {
              if (
                !Object.prototype
                  .hasOwnProperty.call(
                    personalValues,
                    definition.key
                  )
              ) {
                continue;
              }

              const value =
                personalValues[
                  definition.key
                ];

              if (
                (
                  definition.key
                  === "alias"
                  || definition.key
                  === "note"
                )
                && !String(
                  value || ""
                ).trim()
              ) {
                delete fm[
                  definition
                    .frontmatterKey
                ];

                continue;
              }

              fm[
                definition.frontmatterKey
              ] =
                value;
            }

            if (
              actualSelectedPdf
            ) {
              fm.pdf =
                `[[${actualSelectedPdf}]]`;
            }

            if (sources.length) {
              fm.metadata_sources =
                [...sources];

              fm.metadata_source =
                sources.join("+");
            }

            if (
              context.papers.some(
                (paper) =>
                  paper.metadataVerified
              )
            ) {
              fm.metadata_verified =
                true;
            }

            if (
              context.metadataWasFormal
            ) {
              fm.publication_status =
                "formal";

              fm.publication_resolution =
                "duplicate-merge";

              fm.publication_updated =
                this.today();
            }
          }
        );

      let mergedContent =
        await this.app.vault
          .cachedRead(
            masterFile
          );

      const masterSections =
        context.sectionsByPath.get(
          masterPath
        )
        || {};

      for (
        const spec
        of this.duplicateMergeSectionDefinitions()
      ) {
        if (
          !Object.prototype
            .hasOwnProperty.call(
              sectionValues,
              spec.key
            )
        ) {
          continue;
        }

        const nextValue =
          String(
            sectionValues[
              spec.key
            ]
            || ""
          ).trim();

        const currentValue =
          String(
            masterSections[
              spec.key
            ]
            || ""
          ).trim();

        if (
          nextValue === currentValue
        ) {
          continue;
        }

        mergedContent =
          this.replaceMarkdownSection(
            mergedContent,
            spec,
            nextValue
          );
      }

      if (
        actualSelectedPdf
      ) {
        mergedContent =
          this.rewriteCitekeyInfoBlock(
            mergedContent,
            {
              citekey:
                context.master.citekey,
              pdfPath:
                actualSelectedPdf,
            }
          );
      }

      const afterFrontmatter =
        await this.app.vault
          .cachedRead(
            masterFile
          );

      if (
        mergedContent
        !== afterFrontmatter
      ) {
        await this.app.vault
          .modify(
            masterFile,
            mergedContent
          );
      }

      // Redundant PDFs are returned to Inbox, never destroyed by
      // Duplicate Merge. PDFs referenced by Papers outside this
      // duplicate group remain where they are.
      for (
        const option
        of context.pdfOptions
      ) {
        if (
          option.path
          === actualSelectedPdf
          || option.externalReferences > 0
        ) {
          continue;
        }

        const livePdf =
          this.app.vault
            .getAbstractFileByPath(
              option.path
            );

        if (
          !(livePdf instanceof TFile)
        ) {
          continue;
        }

        await this.ensureFolder(
          this.plugin.settings
            .inboxFolder
          || "Research/00 Inbox"
        );

        const target =
          this.availableInboxPdfPath(
            livePdf
          );

        if (
          target
          === livePdf.path
        ) {
          continue;
        }

        const originalPath =
          livePdf.path;

        await this.app.fileManager
          .renameFile(
            livePdf,
            target
          );

        pdfMoves.push({
          file:
            livePdf,
          originalPath,
          target,
        });
      }

      const archiveFolder =
        this.duplicateMergeArchiveFolder();

      await this.ensureFolder(
        archiveFolder
      );

      for (
        const originalPath
        of sourcePaths
      ) {
        const sourceFile =
          this.app.vault
            .getAbstractFileByPath(
              originalPath
            );

        if (
          !(sourceFile instanceof TFile)
        ) {
          throw new Error(
            `Source Note 不存在：${originalPath}`
          );
        }

        const target =
          this.duplicateMergeAvailableArchivePath(
            sourceFile
          );

        await this.app.fileManager
          .renameFile(
            sourceFile,
            target
          );

        noteMoves.push({
          file:
            sourceFile,
          originalPath,
          target,
        });
      }
    }
    catch (error) {
      const rollbackErrors =
        [];

      for (
        const move
        of [...noteMoves].reverse()
      ) {
        try {
          const live =
            this.app.vault
              .getAbstractFileByPath(
                move.target
              );

          if (
            live instanceof TFile
          ) {
            await this.app.fileManager
              .renameFile(
                live,
                move.originalPath
              );
          }
        }
        catch (rollbackError) {
          rollbackErrors.push(
            rollbackError
          );
        }
      }

      for (
        const move
        of [...pdfMoves].reverse()
      ) {
        try {
          const live =
            this.app.vault
              .getAbstractFileByPath(
                move.target
              );

          if (
            live instanceof TFile
          ) {
            await this.app.fileManager
              .renameFile(
                live,
                move.originalPath
              );
          }
        }
        catch (rollbackError) {
          rollbackErrors.push(
            rollbackError
          );
        }
      }

      try {
        const liveMaster =
          this.app.vault
            .getAbstractFileByPath(
              masterPath
            );

        if (
          liveMaster instanceof TFile
        ) {
          await this.app.vault
            .modify(
              liveMaster,
              originalMasterContent
            );
        }
      }
      catch (rollbackError) {
        rollbackErrors.push(
          rollbackError
        );
      }

      console.error(
        "Research Library: duplicate merge rolled back",
        {
          master:
            masterPath,
          sources:
            sourcePaths,
          cause:
            error,
          rollbackErrors,
        }
      );

      throw new Error(
        rollbackErrors.length
          ? `Merge 失败；已尝试回滚，但有 ${rollbackErrors.length} 项需要检查。`
          : "Merge 失败，已恢复原状态。"
      );
    }

    const anySelected =
      sourcePaths.some(
        (path) =>
          this.selectedPaths.has(
            path
          )
      )
      || this.selectedPaths.has(
        masterPath
      );

    for (
      const path
      of sourcePaths
    ) {
      this.selectedPaths.delete(
        path
      );
    }

    if (anySelected) {
      this.selectedPaths.add(
        masterPath
      );
    }

    if (
      this.lastSelectedPath
      && sourcePaths.includes(
        this.lastSelectedPath
      )
    ) {
      this.lastSelectedPath =
        masterPath;
    }

    if (
      this.detailPaperPath
      && sourcePaths.includes(
        this.detailPaperPath
      )
    ) {
      this.detailPaperPath =
        masterPath;

      this.plugin.settings
        .detailLastPaperPath =
        masterPath;

      await this.plugin
        .saveSettings();
    }

    this.invalidatePaperPaths([
      masterPath,
      ...sourcePaths,
      ...noteMoves.map(
        (move) =>
          move.target
      ),
    ]);

    await this.loadPapers();

    this.render();

    await this.syncBibliographyIfEnabled();

    return {
      masterPath,
      archivedNotes:
        noteMoves.map(
          (move) =>
            move.target
        ),
      returnedPdfs:
        pdfMoves.map(
          (move) =>
            move.target
        ),
    };
  }

  openMaintenanceCenter() {
    this.closePopover();

    new MaintenanceCenterModal(
      this.app,
      {
        library:
          this,
      }
    ).open();
  }

  maintenanceRefreshSignals(
    paper
  ) {
    return {
      doi:
        paper.doi || "",
      arxiv:
        paper.arxiv || "",
      pdfAuthor:
        (paper.authors || [])
          .join(" "),
      citationRescue: {
        title:
          paper.title || "",
        authors:
          [...(
            paper.authors || []
          )],
        year:
          paper.year || "",
        venue:
          paper.venue || "",
      },
    };
  }

  maintenanceRefreshFieldDefinitions() {
    return [
      {
        key: "title",
        label: "Title",
        frontmatterKey: "title",
      },
      {
        key: "authors",
        label: "Authors",
        frontmatterKey: "authors",
        array: true,
      },
      {
        key: "year",
        label: "Year",
        frontmatterKey: "year",
      },
      {
        key: "venue",
        label: "Venue",
        frontmatterKey: "venue",
      },
      {
        key: "workType",
        label: "Work type",
        frontmatterKey: "work_type",
      },
      {
        key: "publisher",
        label: "Publisher",
        frontmatterKey: "publisher",
      },
      {
        key: "volume",
        label: "Volume",
        frontmatterKey: "volume",
      },
      {
        key: "issue",
        label: "Issue",
        frontmatterKey: "issue",
      },
      {
        key: "pages",
        label: "Pages",
        frontmatterKey: "pages",
      },
      {
        key: "doi",
        label: "DOI",
        frontmatterKey: "doi",
      },
      {
        key: "arxiv",
        label: "arXiv",
        frontmatterKey: "arxiv",
      },
      {
        key: "url",
        label: "URL",
        frontmatterKey: "url",
      },
    ];
  }

  maintenanceRefreshDisplayValue(
    key,
    value
  ) {
    if (
      key === "authors"
      && Array.isArray(value)
    ) {
      return value.join(" · ");
    }

    if (
      key === "metadataVerified"
    ) {
      return value
        ? "Verified"
        : "Unverified";
    }

    return String(
      value ?? ""
    ).trim();
  }

  maintenanceRefreshValuesEqual(
    key,
    current,
    found
  ) {
    if (key === "title") {
      return Boolean(
        this.normalizeTitleForMatch(
          current
        )
        && this.normalizeTitleForMatch(
          current
        )
          === this.normalizeTitleForMatch(
            found
          )
      );
    }

    if (key === "authors") {
      const left =
        (current || [])
          .map(
            (value) =>
              this.normalizeTitleForMatch(
                value
              )
          )
          .filter(Boolean);

      const right =
        (found || [])
          .map(
            (value) =>
              this.normalizeTitleForMatch(
                value
              )
          )
          .filter(Boolean);

      return (
        left.length
          === right.length
        && left.every(
          (value, index) =>
            value === right[index]
        )
      );
    }

    if (key === "doi") {
      return this.normalizeDoi(
        current || ""
      ).toLowerCase()
        === this.normalizeDoi(
          found || ""
        ).toLowerCase();
    }

    if (key === "arxiv") {
      const normalize =
        (value) =>
          String(value || "")
            .trim()
            .toLowerCase()
            .replace(/v\d+$/i, "");

      return normalize(current)
        === normalize(found);
    }

    if (key === "pages") {
      return this.bibtexPages(
        current || ""
      ) === this.bibtexPages(
        found || ""
      );
    }

    if (key === "url") {
      const normalize =
        (value) =>
          String(value || "")
            .trim()
            .replace(/\/$/, "")
            .toLowerCase();

      return normalize(current)
        === normalize(found);
    }

    return this.normalizeWhitespace(
      current || ""
    ).toLowerCase()
      === this.normalizeWhitespace(
        found || ""
      ).toLowerCase();
  }

  maintenanceCandidateHighConfidence(
    candidate
  ) {
    if (!candidate) {
      return false;
    }

    const percent =
      Number(
        candidate._matchPercent
        || 0
      );

    return Boolean(
      candidate._identifierExact
      || (
        candidate._exactTitle
        && percent >= 95
      )
      || percent >= 96
    );
  }

  async maintenanceSearchMetadataCandidates(
    paper,
    {
      onProgress = null,
    } = {}
  ) {
    const title =
      this.cleanText(
        paper?.title || ""
      );

    if (!title) {
      return {
        candidates: [],
        diagnostics: [],
      };
    }

    const signals =
      this.maintenanceRefreshSignals(
        paper
      );

    const diagnostics = [];
    const records = [];

    const progress =
      (message) => {
        onProgress?.(
          message || ""
        );
      };

    const run =
      async (
        label,
        fn
      ) => {
        progress(label);

        const started =
          Date.now();

        try {
          const value =
            await this.withTimeout(
              fn(),
              32000,
              label
            );

          const values =
            Array.isArray(value)
              ? value
              : value
                ? [value]
                : [];

          records.push(
            ...values
          );

          diagnostics.push({
            label,
            status: "ok",
            count: values.length,
            ms:
              Date.now()
              - started,
          });
        }
        catch (error) {
          diagnostics.push({
            label,
            status: "error",
            count: 0,
            ms:
              Date.now()
              - started,
            error:
              this.metadataSearchErrorText(
                error
              ),
          });

          console.debug(
            `Research Library: maintenance metadata refresh ${label} failed`,
            error
          );
        }
      };

    this.maintenanceRefreshProgressCallback =
      progress;

    try {
      const doi =
        this.normalizeDoi(
          paper.doi || ""
        );

      if (doi) {
        await Promise.all([
          run(
            "Crossref DOI",
            () =>
              this.fetchCrossrefByDoi(
                doi
              )
          ),
          run(
            "DataCite DOI",
            () =>
              this.fetchDataCiteByDoi(
                doi
              )
          ),
          run(
            "Semantic Scholar DOI",
            () =>
              this.fetchSemanticScholarByDoi(
                doi
              )
          ),
        ]);
      }

      if (paper.arxiv) {
        await run(
          "Semantic Scholar arXiv",
          () =>
            this.fetchSemanticScholarByArxiv(
              paper.arxiv
            )
        );
      }

      progress(
        "Searching scholarly sources"
      );

      await Promise.all([
        run(
          "Semantic Scholar",
          () =>
            this.searchSemanticScholar(
              title
            )
        ),
        run(
          "OpenReview",
          () =>
            this.searchOpenReview(
              title
            )
        ),
        run(
          "DBLP",
          () =>
            this.searchDblp(
              title
            )
        ),
        run(
          "PMLR",
          () =>
            this.searchPmlrExact(
              title,
              signals
            )
        ),
        run(
          "OpenAlex",
          () =>
            this.searchOpenAlex(
              title
            )
        ),
        run(
          "Crossref",
          () =>
            this.searchCrossref(
              title
            )
        ),
      ]);
    }
    finally {
      this.maintenanceRefreshProgressCallback =
        null;

      progress("");
    }

    const candidates =
      this.mergeMetadataCandidates(
        records
      )
        .map(
          (candidate) =>
            this.scoreMetadataCandidate(
              candidate,
              signals,
              title
            )
        )
        .filter(
          (candidate) =>
            candidate._identifierExact
            || candidate._titleSimilarity
              >= 0.55
        )
        .sort(
          (left, right) =>
            right._matchScore
              - left._matchScore
            || Number(
              right.citationCount
              || 0
            )
              - Number(
                left.citationCount
                || 0
              )
        );

    return {
      candidates,
      diagnostics,
    };
  }

  maintenanceCanonicalFormalCandidate(
    baseMeta,
    candidates
  ) {
    const formal =
      (candidates || [])
        .filter(
          (candidate) =>
            this.isFormalPublicationMeta(
              candidate
            )
        )
        .map(
          (candidate) =>
            this.scoreFormalPublicationCandidate(
              baseMeta,
              candidate
            )
        )
        .filter(
          (candidate) =>
            candidate._publicationTitleSimilarity
              >= 0.82
        )
        .sort(
          (left, right) =>
            right._publicationMatchScore
              - left._publicationMatchScore
        );

    if (!formal.length) {
      return {
        candidate: null,
        highConfidence: false,
        candidates: [],
      };
    }

    const primary =
      formal[0];

    const equivalents =
      formal.filter(
        (candidate) => {
          const titleEquivalent =
            this.titleSimilarity(
              primary.title,
              candidate.title
            ) >= 0.985;

          const firstYear =
            Number(
              primary.year || 0
            );

          const nextYear =
            Number(
              candidate.year || 0
            );

          const yearCompatible =
            !firstYear
            || !nextYear
            || Math.abs(
              firstYear
              - nextYear
            ) <= 2;

          const authorsCompatible =
            !primary.authors?.length
            || !candidate.authors?.length
            || this.authorSimilarity(
              primary.authors.join(" "),
              candidate.authors
            ) >= 0.62;

          return Boolean(
            titleEquivalent
            && yearCompatible
            && authorsCompatible
          );
        }
      );

    const canonical =
      this.canonicalFormalPublicationMeta(
        baseMeta,
        equivalents.length
          ? equivalents
          : [primary]
      )
      || primary;

    const scored =
      this.scoreFormalPublicationCandidate(
        baseMeta,
        canonical
      );

    return {
      candidate: scored,
      highConfidence:
        this.isHighConfidencePublicationResolution(
          scored,
          formal[1] || null
        ),
      candidates: formal,
    };
  }

  maintenanceBuildMetadataDiff(
    paper,
    foundMeta,
    {
      highConfidence = false,
      formalResolved = false,
      matchPercent = 0,
      sources = [],
    } = {}
  ) {
    const fields =
      this.maintenanceRefreshFieldDefinitions();

    const diffs = [];

    const baseMeta =
      this.paperAsMetadata(
        paper
      );

    const yearConflict =
      Boolean(
        baseMeta.year
        && foundMeta?.year
        && String(baseMeta.year)
          !== String(foundMeta.year)
      );

    for (
      const field
      of fields
    ) {
      const current =
        paper[field.key];

      const found =
        foundMeta?.[field.key];

      const foundPresent =
        field.array
          ? Array.isArray(found)
            && found.length > 0
          : Boolean(
              String(
                found ?? ""
              ).trim()
            );

      if (!foundPresent) {
        diffs.push({
          ...field,
          current,
          found: current,
          state: "same",
          safe: false,
        });

        continue;
      }

      if (
        this.maintenanceRefreshValuesEqual(
          field.key,
          current,
          found
        )
      ) {
        diffs.push({
          ...field,
          current,
          found,
          state: "same",
          safe: false,
        });

        continue;
      }

      const currentPresent =
        field.array
          ? Array.isArray(current)
            && current.length > 0
          : Boolean(
              String(
                current ?? ""
              ).trim()
            );

      let safe =
        Boolean(
          highConfidence
          && !currentPresent
        );

      if (
        highConfidence
        && formalResolved
        && !yearConflict
      ) {
        if (
          [
            "venue",
            "workType",
            "doi",
            "url",
          ].includes(
            field.key
          )
        ) {
          const currentPreprint =
            field.key === "venue"
              ? this.preprintVenue(
                  current
                )
              : field.key === "workType"
                ? this.preprintWorkType(
                    current
                  )
                : field.key === "doi"
                  ? this.isArxivDoi(
                      current
                    )
                  : field.key === "url"
                    ? /arxiv\.org/i.test(
                        String(current || "")
                      )
                    : false;

          if (
            !currentPresent
            || currentPreprint
          ) {
            safe = true;
          }
        }
      }

      // Existing bibliographic values that disagree are review
      // items by default. This avoids trading good hand-checked
      // metadata for a merely different database convention.
      if (
        currentPresent
        && !(
          formalResolved
          && !yearConflict
          && safe
        )
      ) {
        safe = false;
      }

      diffs.push({
        ...field,
        current,
        found,
        state: "changed",
        safe,
      });
    }

    const currentSuggested =
      this.suggestedCitekey(
        paper
      );

    const foundPaper = {
      ...paper,
      title:
        foundMeta?.title
        || paper.title,
      authors:
        foundMeta?.authors?.length
          ? [...foundMeta.authors]
          : [...(
            paper.authors || []
          )],
      year:
        foundMeta?.year
        || paper.year,
    };

    const foundSuggested =
      this.suggestedCitekey(
        foundPaper
      );

    const currentKey =
      this.normalizeCitekey(
        paper.citekey
      );

    const autoCitekey =
      Boolean(
        currentKey
        && currentSuggested
        && currentKey.toLowerCase()
          === currentSuggested.toLowerCase()
      );

    if (
      autoCitekey
      && foundSuggested
      && currentKey.toLowerCase()
        !== foundSuggested.toLowerCase()
    ) {
      diffs.push({
        key: "citekey",
        label: "Citekey",
        frontmatterKey: "citekey",
        current:
          currentKey,
        found:
          this.makeUniqueCitekeyForPaper(
            foundSuggested,
            paper
          ),
        state: "changed",
        safe: false,
        special: true,
      });

      // Any field that drives an automatic citekey change must
      // be reviewed together with that key rather than applied
      // silently in the batch-safe path.
      for (
        const diff
        of diffs
      ) {
        if (
          [
            "title",
            "authors",
            "year",
          ].includes(
            diff.key
          )
          && diff.state === "changed"
        ) {
          diff.safe = false;
        }
      }
    }

    const canVerify =
      Boolean(
        highConfidence
        && !paper.metadataVerified
      );

    diffs.push({
      key: "metadataVerified",
      label: "Verification",
      current:
        Boolean(
          paper.metadataVerified
        ),
      found:
        highConfidence
          ? true
          : Boolean(
              paper.metadataVerified
            ),
      state:
        canVerify
          ? "changed"
          : "same",
      safe:
        canVerify,
      virtual: true,
    });

    const changed =
      diffs.filter(
        (diff) =>
          diff.state === "changed"
      );

    return {
      diffs,
      changedCount:
        changed.length,
      safeCount:
        changed.filter(
          (diff) =>
            diff.safe
        ).length,
      reviewCount:
        changed.filter(
          (diff) =>
            !diff.safe
        ).length,
      highConfidence,
      formalResolved,
      matchPercent:
        Number(matchPercent || 0),
      sources:
        [...new Set(
          (sources || [])
            .filter(Boolean)
        )],
    };
  }

  async maintenanceQueryPaperMetadata(
    paper,
    {
      onProgress = null,
    } = {}
  ) {
    const sourceState =
      await this.captureFileState(
        paper?.file,
        "Metadata refresh Paper"
      );

    const baseMeta =
      this.paperAsMetadata(
        paper
      );

    const search =
      await this.maintenanceSearchMetadataCandidates(
        paper,
        {
          onProgress,
        }
      );

    const candidates =
      search.candidates || [];

    // A scholarly lookup may take seconds. If the user edited the
    // Paper while it was running, discard this result rather than
    // building a Diff against stale local metadata.
    await this.assertFileState(
      sourceState,
      "Metadata refresh Paper"
    );

    if (!candidates.length) {
      return {
        paper,
        sourceState,
        status: "no-match",
        candidates: [],
        diagnostics:
          search.diagnostics || [],
        diffs: [],
        safeCount: 0,
        reviewCount: 0,
        changedCount: 0,
      };
    }

    const best =
      candidates[0];

    const genericHigh =
      this.maintenanceCandidateHighConfidence(
        best
      );

    const formal =
      this.maintenanceCanonicalFormalCandidate(
        baseMeta,
        candidates
      );

    const needsResolution =
      this.needsPublicationResolution(
        baseMeta
      );

    let foundMeta =
      best;

    let highConfidence =
      genericHigh;

    let formalResolved =
      false;

    let matchPercent =
      Number(
        best._matchPercent
        || 0
      );

    if (
      formal.candidate
      && formal.highConfidence
      && (
        needsResolution
        || genericHigh
      )
    ) {
      foundMeta =
        this.mergeFormalPublicationMeta(
          baseMeta,
          formal.candidate
        );

      highConfidence =
        true;

      formalResolved =
        true;

      matchPercent =
        Number(
          formal.candidate
            ._publicationMatchPercent
          || matchPercent
        );
    }

    if (
      !highConfidence
      && Number(
        best._matchPercent
        || 0
      ) < 85
    ) {
      return {
        paper,
        sourceState,
        status: "no-match",
        candidate: best,
        candidates,
        diagnostics:
          search.diagnostics || [],
        matchPercent:
          Number(
            best._matchPercent
            || 0
          ),
        diffs: [],
        safeCount: 0,
        reviewCount: 0,
        changedCount: 0,
      };
    }

    const sources =
      this.metadataSources(
        foundMeta
      );

    const diff =
      this.maintenanceBuildMetadataDiff(
        paper,
        foundMeta,
        {
          highConfidence,
          formalResolved,
          matchPercent,
          sources,
        }
      );

    return {
      paper,
      sourceState,
      status: "ready",
      candidate:
        foundMeta,
      baseMeta,
      candidates,
      diagnostics:
        search.diagnostics || [],
      ...diff,
      selection:
        new Set(
          diff.diffs
            .filter(
              (item) =>
                item.state === "changed"
                && item.safe
            )
            .map(
              (item) =>
                item.key
            )
        ),
    };
  }

  async maintenanceApplyMetadataRefresh(...args) {
    return this.withExclusiveWrite(
      "Metadata refresh",
      () =>
        this._maintenanceApplyMetadataRefresh(
          ...args
        )
    );
  }

  async _maintenanceApplyMetadataRefresh(
    paper,
    refresh,
    selectedKeys
  ) {
    const selected =
      selectedKeys instanceof Set
        ? new Set(
            selectedKeys
          )
        : new Set(
            selectedKeys || []
          );

    const selectedDiffs =
      (refresh?.diffs || [])
        .filter(
          (diff) =>
            diff.state === "changed"
            && selected.has(
              diff.key
            )
        );

    if (!selectedDiffs.length) {
      return {
        changed: false,
      };
    }

    const note =
      refresh?.sourceState
        ? await this.assertFileState(
            refresh.sourceState,
            "Metadata refresh Paper"
          )
        : this.liveTFile(
            paper?.file,
            {
              extension:
                "md",
              label:
                "Paper Note",
            }
          );

    paper.file =
      note;

    const originalContent =
      await this.app.vault
        .cachedRead(
          note
        );

    const originalPath =
      note.path;

    const bibliographyDiffs =
      selectedDiffs.filter(
        (diff) =>
          !diff.virtual
          && diff.key !== "citekey"
      );

    const citekeyDiff =
      selectedDiffs.find(
        (diff) =>
          diff.key === "citekey"
      );

    const verifySelected =
      selected.has(
        "metadataVerified"
      )
      || (
        refresh.highConfidence
        && bibliographyDiffs.length > 0
      );

    const foundMeta =
      refresh.candidate || {};

    const sources =
      refresh.sources?.length
        ? [...refresh.sources]
        : this.metadataSources(
            foundMeta
          );

    const publicationFields =
      new Set([
        "year",
        "venue",
        "workType",
        "publisher",
        "volume",
        "issue",
        "pages",
        "doi",
        "url",
      ]);

    const appliesPublication =
      Boolean(
        refresh.formalResolved
        && bibliographyDiffs.some(
          (diff) =>
            publicationFields.has(
              diff.key
            )
        )
      );

    this.suppressRefreshUntil =
      Date.now() + 2600;

    try {
      if (
        bibliographyDiffs.length
        || verifySelected
      ) {
        await this.app.fileManager
          .processFrontMatter(
            note,
            (fm) => {
              for (
                const diff
                of bibliographyDiffs
              ) {
                if (
                  diff.key === "authors"
                ) {
                  fm.authors =
                    [...(
                      diff.found || []
                    )];
                }
                else {
                  fm[
                    diff.frontmatterKey
                  ] = diff.found;
                }
              }

              if (verifySelected) {
                fm.metadata_verified =
                  true;

                fm.metadata_updated =
                  this.today();

                if (sources.length) {
                  fm.metadata_source =
                    sources.join("+");

                  fm.metadata_sources =
                    [...sources];
                }

                if (
                  refresh.matchPercent
                ) {
                  fm.metadata_match =
                    `${Math.round(
                      refresh.matchPercent
                    )}%`;
                }
              }

              if (appliesPublication) {
                fm.publication_status =
                  "formal";

                fm.publication_resolution =
                  foundMeta
                    ?._publicationResolution
                    ?.kind
                  || "maintenance-refresh";

                fm.publication_updated =
                  this.today();
              }
            }
          );

        for (
          const diff
          of bibliographyDiffs
        ) {
          if (
            diff.key === "authors"
          ) {
            paper.authors =
              [...(
                diff.found || []
              )];
          }
          else if (
            diff.key === "doi"
          ) {
            paper.doi =
              this.normalizeDoi(
                diff.found || ""
              );
          }
          else {
            paper[diff.key] =
              diff.found;
          }
        }

        if (verifySelected) {
          paper.metadataVerified =
            true;

          paper.metadataUpdated =
            this.today();

          if (sources.length) {
            paper.metadataSource =
              sources.join("+");

            paper.metadataSources =
              [...sources];
          }
        }

        if (appliesPublication) {
          paper.publicationStatus =
            "formal";

          paper.publicationResolution =
            foundMeta
              ?._publicationResolution
              ?.kind
            || "maintenance-refresh";

          paper.publicationUpdated =
            this.today();
        }
      }

      if (citekeyDiff) {
        await this._renamePaperCitekey(
          paper,
          citekeyDiff.found
        );
      }
    }
    catch (error) {
      const rollbackErrors = [];

      try {
        let restored =
          this.app.vault
            .getAbstractFileByPath(
              originalPath
            );

        if (
          !(restored instanceof TFile)
          && paper.file instanceof TFile
        ) {
          restored =
            paper.file;
        }

        if (
          restored instanceof TFile
        ) {
          await this.app.vault
            .modify(
              restored,
              originalContent
            );
        }
      }
      catch (rollbackError) {
        rollbackErrors.push(
          rollbackError
        );
      }

      console.error(
        "Research Library: maintenance metadata refresh rolled back",
        {
          paper:
            originalPath,
          cause:
            error,
          rollbackErrors,
        }
      );

      throw new Error(
        rollbackErrors.length
          ? `Metadata refresh 失败；回滚有 ${rollbackErrors.length} 项需要检查。`
          : "Metadata refresh 失败，Paper Note 已恢复。"
      );
    }

    this.renderCollectionSurface();

    await this.syncBibliographyIfEnabled();

    if (
      this.detailPaperPath
      === paper.file.path
    ) {
      await this.renderPaperDetail(
        paper
      );
    }

    return {
      changed: true,
      selected:
        [...selected],
    };
  }

  paperDeletePdfFile(
    paper
  ) {
    if (!paper?.pdf) {
      return null;
    }

    const file =
      this.resolveVaultFile(
        paper.pdf,
        paper.file?.path || ""
      );

    return (
      file instanceof TFile
      && file.extension
        ?.toLowerCase()
        === "pdf"
    )
      ? file
      : null;
  }

  paperPdfReferenceCount(
    pdfFile,
    excludingPaper = null
  ) {
    if (
      !(pdfFile instanceof TFile)
    ) {
      return 0;
    }

    let count =
      0;

    for (
      const paper
      of this.papers
    ) {
      if (
        excludingPaper
        && paper === excludingPaper
      ) {
        continue;
      }

      const other =
        this.paperDeletePdfFile(
          paper
        );

      if (
        other instanceof TFile
        && other.path
          === pdfFile.path
      ) {
        count += 1;
      }
    }

    return count;
  }

  availableInboxPdfPath(
    pdfFile
  ) {
    const inbox =
      normalizePath(
        this.plugin.settings
          .inboxFolder
        || "Research/00 Inbox"
      ).replace(/\/+$/, "");

    const filename =
      pdfFile.name
      || `${
        pdfFile.basename
        || "paper"
      }.${
        pdfFile.extension
        || "pdf"
      }`;

    const direct =
      normalizePath(
        `${inbox}/${filename}`
      );

    if (
      pdfFile.path
      === direct
    ) {
      return direct;
    }

    const occupied =
      this.app.vault
        .getAbstractFileByPath(
          direct
        );

    if (!occupied) {
      return direct;
    }

    const extension =
      pdfFile.extension
      || "pdf";

    const basename =
      pdfFile.basename
      || filename.replace(
        /\.[^.]+$/,
        ""
      )
      || "paper";

    for (
      let index = 2;
      index < 10000;
      index += 1
    ) {
      const candidate =
        normalizePath(
          `${inbox}/${basename}-${index}.${extension}`
        );

      if (
        !this.app.vault
          .getAbstractFileByPath(
            candidate
          )
      ) {
        return candidate;
      }
    }

    throw new Error(
      "PDF Inbox 中无法生成安全的不重复文件名。"
    );
  }

  async deletePaperMetadataOnly(
    paper
  ) {
    const note =
      this.app.vault
        .getAbstractFileByPath(
          paper.file.path
        );

    if (
      !(note instanceof TFile)
    ) {
      throw new Error(
        `Paper Note 不存在：${paper.file.path}`
      );
    }

    const pdfFile =
      this.paperDeletePdfFile(
        paper
      );

    const sharedPdf =
      pdfFile instanceof TFile
      && this.paperPdfReferenceCount(
        pdfFile,
        paper
      ) > 0;

    let movedPdf =
      false;

    let originalPdfPath =
      "";

    let inboxPdfPath =
      "";

    try {
      if (
        pdfFile instanceof TFile
        && !sharedPdf
      ) {
        await this.ensureFolder(
          this.plugin.settings
            .inboxFolder
          || "Research/00 Inbox"
        );

        originalPdfPath =
          pdfFile.path;

        inboxPdfPath =
          this.availableInboxPdfPath(
            pdfFile
          );

        if (
          originalPdfPath
          !== inboxPdfPath
        ) {
          await this.app.fileManager
            .renameFile(
              pdfFile,
              inboxPdfPath
            );

          movedPdf =
            true;
        }
      }

      await this.app.fileManager
        .trashFile(
          note
        );
    }
    catch (error) {
      const rollbackErrors =
        [];

      if (
        movedPdf
        && originalPdfPath
      ) {
        try {
          const moved =
            this.app.vault
              .getAbstractFileByPath(
                inboxPdfPath
              );

          if (
            moved instanceof TFile
          ) {
            await this.app.fileManager
              .renameFile(
                moved,
                originalPdfPath
              );
          }
        }
        catch (rollbackError) {
          rollbackErrors.push(
            rollbackError
          );
        }
      }

      console.error(
        "Research Library: metadata-only paper deletion rolled back",
        {
          paper:
            paper.file.path,
          cause:
            error,
          rollbackErrors,
        }
      );

      throw new Error(
        rollbackErrors.length
          ? `删除元数据失败；PDF 回滚有 ${rollbackErrors.length} 项需要检查。`
          : "删除元数据失败，PDF 已恢复原位置。"
      );
    }

    return {
      paper,
      mode:
        "metadata",
      pdfFound:
        pdfFile instanceof TFile,
      sharedPdf,
      pdfPath:
        sharedPdf
          ? pdfFile?.path || ""
          : inboxPdfPath
            || pdfFile?.path
            || "",
    };
  }

  async deletePaperCompletely(
    paper
  ) {
    const note =
      this.app.vault
        .getAbstractFileByPath(
          paper.file.path
        );

    if (
      !(note instanceof TFile)
    ) {
      throw new Error(
        `Paper Note 不存在：${paper.file.path}`
      );
    }

    const notePath =
      note.path;

    const noteContent =
      await this.app.vault
        .cachedRead(
          note
        );

    const pdfFile =
      this.paperDeletePdfFile(
        paper
      );

    const sharedPdf =
      pdfFile instanceof TFile
      && this.paperPdfReferenceCount(
        pdfFile,
        paper
      ) > 0;

    let noteTrashed =
      false;

    try {
      // Trash the metadata first. If PDF deletion then fails,
      // the Note can be recreated from the snapshot.
      await this.app.fileManager
        .trashFile(
          note
        );

      noteTrashed =
        true;

      if (
        pdfFile instanceof TFile
        && !sharedPdf
      ) {
        await this.app.fileManager
          .trashFile(
            pdfFile
          );
      }
    }
    catch (error) {
      const rollbackErrors =
        [];

      if (
        noteTrashed
        && !this.app.vault
          .getAbstractFileByPath(
            notePath
          )
      ) {
        try {
          const slash =
            notePath
              .lastIndexOf("/");

          if (slash > 0) {
            await this.ensureFolder(
              notePath.slice(
                0,
                slash
              )
            );
          }

          await this.app.vault
            .create(
              notePath,
              noteContent
            );
        }
        catch (rollbackError) {
          rollbackErrors.push(
            rollbackError
          );
        }
      }

      console.error(
        "Research Library: full paper deletion rolled back",
        {
          paper:
            notePath,
          cause:
            error,
          rollbackErrors,
        }
      );

      throw new Error(
        rollbackErrors.length
          ? `全部删除失败；Paper Note 回滚有 ${rollbackErrors.length} 项需要检查。`
          : "全部删除失败，Paper Note 已恢复。"
      );
    }

    return {
      paper,
      mode:
        "all",
      pdfFound:
        pdfFile instanceof TFile,
      sharedPdf,
      pdfPath:
        pdfFile?.path || "",
    };
  }

  async finalizePaperDeletion(
    successfulPapers
  ) {
    const removedPaths =
      new Set(
        successfulPapers
          .map(
            (paper) =>
              paper?.file?.path
          )
          .filter(Boolean)
      );

    for (
      const path
      of removedPaths
    ) {
      this.selectedPaths.delete(
        path
      );
    }

    if (
      this.detailPaperPath
      && removedPaths.has(
        this.detailPaperPath
      )
    ) {
      this.detailPaperPath =
        null;

      this.detailRenderToken += 1;

      this.rootEl?.removeClass(
        "has-detail"
      );

      this.detailEl?.addClass(
        "is-hidden"
      );

      this.detailContentEl
        ?.empty();

      this.plugin.settings
        .detailPanelOpen =
        false;

      this.plugin.settings
        .detailLastPaperPath =
        "";

      await this.plugin
        .saveSettings();
    }

    if (
      this.lastSelectedPath
      && removedPaths.has(
        this.lastSelectedPath
      )
    ) {
      this.lastSelectedPath =
        null;
    }

    // Deletions generate MetadataCache events. We refresh once,
    // deliberately, after the transaction rather than repeatedly.
    this.suppressRefreshUntil =
      Date.now() + 1800;

    await this.loadPapers();

    const livePaths =
      new Set(
        this.papers.map(
          (paper) =>
            paper.file.path
        )
      );

    this.selectedPaths =
      new Set(
        [
          ...this.selectedPaths,
        ].filter(
          (path) =>
            livePaths.has(path)
        )
      );

    this.render();
    this.updateSelectionBar();
  }

  async deletePapers(...args) {
    return this.withExclusiveWrite(
      "Paper delete",
      () =>
        this._deletePapers(
          ...args
        )
    );
  }

  async _deletePapers(
    papers,
    mode
  ) {
    const unique =
      [];

    const seen =
      new Set();

    for (
      const paper
      of papers || []
    ) {
      const path =
        paper?.file?.path;

      if (
        !path
        || seen.has(path)
      ) {
        continue;
      }

      seen.add(path);
      unique.push(paper);
    }

    if (!unique.length) {
      return {
        successes: [],
        errors: [],
      };
    }

    if (
      ![
        "metadata",
        "all",
      ].includes(mode)
    ) {
      throw new Error(
        "未知删除模式。"
      );
    }

    const successes =
      [];

    const errors =
      [];

    for (
      const paper
      of unique
    ) {
      try {
        const result =
          mode === "metadata"
            ? await this
                .deletePaperMetadataOnly(
                  paper
                )
            : await this
                .deletePaperCompletely(
                  paper
                );

        successes.push(
          result
        );
      }
      catch (error) {
        errors.push({
          paper,
          error,
        });
      }
    }

    if (successes.length) {
      await this.finalizePaperDeletion(
        successes.map(
          (result) =>
            result.paper
        )
      );
    }
    else {
      // A failed delete may have recreated a Note. Reload so
      // stale TFile handles are never kept in the table.
      await this.loadPapers();
      this.render();
    }

    return {
      successes,
      errors,
    };
  }

  openPaperDeleteDialog(
    papers
  ) {
    if (
      this.detailEditingSectionKey
    ) {
      new Notice(
        "请先保存或取消当前 Markdown 编辑，再删除论文。"
      );

      return;
    }

    const selected =
      (papers || [])
        .filter(
          (paper) =>
            paper?.file instanceof TFile
        );

    if (!selected.length) {
      return;
    }

    new PaperDeleteModal(
      this.app,
      {
        library:
          this,
        papers:
          selected,
      }
    ).open();
  }

  openRowContextMenu(
    event,
    paper
  ) {
    const menu =
      new Menu();

    menu.addItem((item) => {
      item
        .setTitle("Open note")
        .setIcon("file-text")
        .onClick(async () => {
          await this.app.workspace
            .getLeaf("tab")
            .openFile(
              paper.file
            );

          this.close();
        });
    });

    if (paper.pdf) {
      menu.addItem((item) => {
        item
          .setTitle("Open PDF")
          .setIcon("file-type-2")
          .onClick(async () => {
            const pdfFile =
              this.resolveVaultFile(
                paper.pdf,
                paper.file.path
              );

            if (!pdfFile) {
              new Notice(
                `找不到 PDF：${paper.pdf}`
              );
              return;
            }

            await this.app.workspace
              .getLeaf("tab")
              .openFile(pdfFile);

            this.close();
          });
      });
    }

    menu.addSeparator();

    if (
      this.validCitekey(
        paper.citekey
      )
    ) {
      menu.addItem((item) => {
        item
          .setTitle("Copy citation")
          .setIcon("quote")
          .onClick(async () => {
            await this.copyCitationText(
              this.pandocCitation(
                paper
              ),
              "citation"
            );
          });
      });

      menu.addItem((item) => {
        item
          .setTitle("Copy BibTeX")
          .setIcon("braces")
          .onClick(async () => {
            await this.copyCitationText(
              this.bibtexForPaper(
                paper
              ),
              "BibTeX"
            );
          });
      });

      menu.addItem((item) => {
        item
          .setTitle("Copy citekey")
          .setIcon("key-round")
          .onClick(async () => {
            await this.copyCitationText(
              paper.citekey,
              "Citekey"
            );
          });
      });
    }

    if (paper.doi) {
      menu.addItem((item) => {
        item
          .setTitle("Copy DOI")
          .setIcon("link")
          .onClick(async () => {
            await navigator.clipboard
              .writeText(
                paper.doi
              );
          });
      });
    }

    menu.addSeparator();

    if (
      paper.status !== "read"
    ) {
      menu.addItem((item) => {
        item
          .setTitle("Mark as done")
          .setIcon("check")
          .onClick(async () => {
            await this.updateStatus(
              paper.file,
              "read",
              {
                refresh: false,
              }
            );
          });
      });
    }

    menu.addItem((item) => {
      item
        .setTitle("Archive")
        .setIcon("archive")
        .onClick(async () => {
          await this.updateStatus(
            paper.file,
            "archived",
            {
              refresh: false,
            }
          );
        });
    });

    menu.addSeparator();

    menu.addItem((item) => {
      item
        .setTitle("Delete…")
        .setIcon("trash-2")
        .onClick(() => {
          this.openPaperDeleteDialog(
            [paper]
          );
        });
    });

    menu.showAtMouseEvent(
      event
    );
  }

  renderStatusPill(button, status) {
    const meta =
      STATUS_META[status]
      || STATUS_META.inbox;

    button.empty();

    button.className =
      `rl-status-pill rl-status-${status}`;

    this.createIcon(
      button,
      meta.icon,
      "rl-status-pill-icon"
    );

    button.createSpan({
      cls: "rl-status-pill-label",
      text: meta.label,
    });

    this.createIcon(
      button,
      "chevron-down",
      "rl-status-pill-chevron"
    );
  }

  openStatusPopover({
    anchor,
    paper,
    row,
  }) {
    this.closePopover();

    const popover =
      this.createPopover(
        anchor,
        "rl-status-popover"
      );

    popover.setAttribute(
      "role",
      "menu"
    );

    this.activePopover =
      popover;

    popover.createDiv({
      cls: "rl-status-menu-title",
      text: "Status",
    });

    const list =
      popover.createDiv({
        cls: "rl-status-menu-list",
      });

    for (
      const [status, meta]
      of Object.entries(STATUS_META)
    ) {
      const option =
        list.createEl(
          "button",
          {
            cls:
              `rl-status-option ` +
              `rl-status-option-${status}` +
              (
                status === paper.status
                  ? " is-selected"
                  : ""
              ),
            attr: {
              type: "button",
              role: "menuitem",
            },
          }
        );

      const iconWrap =
        option.createSpan({
          cls:
            `rl-status-option-icon ` +
            `rl-status-option-icon-${status}`,
        });

      this.createIcon(
        iconWrap,
        meta.icon
      );

      option.createSpan({
        cls: "rl-status-option-label",
        text: meta.label,
      });

      if (
        status === paper.status
      ) {
        this.createIcon(
          option,
          "check",
          "rl-status-option-check"
        );
      }

      option.addEventListener(
        "click",
        async (event) => {
          event.preventDefault();
          event.stopPropagation();

          if (
            status === paper.status
          ) {
            this.closePopover();
            return;
          }

          this.closePopover();

          row.addClass(
            "is-property-editing"
          );

          const previous =
            paper.status;

          this.renderStatusPill(
            anchor,
            status
          );

          try {
            await this.updateStatus(
              paper.file,
              status,
              {
                refresh: false,
              }
            );
          }
          catch (error) {
            paper.status =
              previous;

            this.renderStatusPill(
              anchor,
              previous
            );

            console.error(
              "Research Library: failed to update status",
              error
            );

            new Notice(
              "状态更新失败"
            );
          }
          finally {
            window.setTimeout(
              () => {
                row.removeClass(
                  "is-property-editing"
                );
              },
              220
            );
          }
        }
      );
    }

    const first =
      list.querySelector(
        ".rl-status-option"
      );

    window.setTimeout(
      () => first?.focus(),
      0
    );

    popover.addEventListener(
      "keydown",
      (event) => {
        const options =
          [
            ...popover.querySelectorAll(
              ".rl-status-option"
            ),
          ];

        const current =
          options.indexOf(
            document.activeElement
          );

        if (
          event.key === "Escape"
        ) {
          event.preventDefault();
          this.closePopover();
          anchor.focus();
        }
        else if (
          event.key === "ArrowDown"
        ) {
          event.preventDefault();

          options[
            (current + 1)
            % options.length
          ]?.focus();
        }
        else if (
          event.key === "ArrowUp"
        ) {
          event.preventDefault();

          options[
            (
              current - 1
              + options.length
            )
            % options.length
          ]?.focus();
        }
      }
    );
  }

  renderRatingEditor({
    cell,
    paper,
    row,
  }) {
    const group =
      cell.createDiv({
        cls: "rl-rating-editor",
        attr: {
          "aria-label": "修改重要程度",
        },
      });

    const buttons = [];

    const paint =
      (value, preview = false) => {
        for (
          let index = 0;
          index < buttons.length;
          index++
        ) {
          const button =
            buttons[index];

          const on =
            index < value;

          button.toggleClass(
            "is-on",
            on
          );

          button.toggleClass(
            "is-preview",
            preview && on
          );

          button.setAttribute(
            "aria-pressed",
            index + 1 === paper.rating
              ? "true"
              : "false"
          );
        }
      };

    for (
      let value = 1;
      value <= 5;
      value++
    ) {
      const star =
        group.createEl(
          "button",
          {
            cls: "rl-rating-star",
            attr: {
              type: "button",
              title:
                paper.rating === value
                  ? `清除 ${value}/5 评分`
                  : `设为 ${value}/5`,
              "aria-label":
                `评分 ${value}/5`,
            },
          }
        );

      this.createIcon(
        star,
        "star",
        "rl-rating-star-icon"
      );

      buttons.push(star);

      star.addEventListener(
        "mouseenter",
        () => {
          paint(
            value,
            true
          );
        }
      );

      star.addEventListener(
        "focus",
        () => {
          paint(
            value,
            true
          );
        }
      );

      star.addEventListener(
        "click",
        async (event) => {
          event.preventDefault();
          event.stopPropagation();

          const previous =
            paper.rating;

          const next =
            paper.rating === value
              ? 0
              : value;

          paper.rating =
            next;

          paint(
            next,
            false
          );

          row.addClass(
            "is-property-editing"
          );

          try {
            await this.updateRating(
              paper.file,
              next,
              {
                refresh: false,
              }
            );
          }
          catch (error) {
            paper.rating =
              previous;

            paint(
              previous,
              false
            );

            console.error(
              "Research Library: failed to update rating",
              error
            );

            new Notice(
              "评分更新失败"
            );
          }
          finally {
            window.setTimeout(
              () => {
                row.removeClass(
                  "is-property-editing"
                );
              },
              220
            );
          }
        }
      );
    }

    group.addEventListener(
      "mouseleave",
      () => {
        paint(
          paper.rating,
          false
        );
      }
    );

    group.addEventListener(
      "focusout",
      (event) => {
        if (
          !group.contains(
            event.relatedTarget
          )
        ) {
          paint(
            paper.rating,
            false
          );
        }
      }
    );

    paint(
      paper.rating,
      false
    );
  }

  openFilterPopover(anchor) {
    this.closePopover();

    const popover = this.createPopover(anchor, "rl-popover-filter");
    this.activePopover = popover;

    popover.createDiv({ cls: "rl-popover-title", text: "Filter" });

    const group1 = popover.createDiv({ cls: "rl-popover-section" });
    group1.createDiv({ cls: "rl-popover-label", text: "状态" });

    const status = group1.createEl("select", { cls: "rl-popover-select" });

    const statusOptions = [
      ["all", "All status"],
      ...Object.entries(STATUS_META).map(([key, meta]) => [key, meta.label]),
    ];

    for (const [value, label] of statusOptions) {
      const option = status.createEl("option", { value, text: label });
      option.selected = value === this.statusFilter;
    }

    status.addEventListener("change", () => {
      this.statusFilter = status.value;
      this.renderCollectionSurface();
    });

    const group2 = popover.createDiv({ cls: "rl-popover-section" });
    group2.createDiv({ cls: "rl-popover-label", text: "最低评分" });

    const rating = group2.createEl("select", { cls: "rl-popover-select" });

    for (let i = 0; i <= 5; i++) {
      const label = i === 0 ? "Any rating" : `${"★".repeat(i)} 及以上`;
      const option = rating.createEl("option", { value: String(i), text: label });
      option.selected = i === this.ratingFilter;
    }

    rating.addEventListener("change", () => {
      this.ratingFilter = Number(rating.value) || 0;
      this.renderCollectionSurface();
    });

    const group3 = popover.createDiv({
      cls: "rl-popover-section",
    });

    group3.createDiv({
      cls: "rl-popover-label",
      text: "Topic",
    });

    const topic =
      group3.createEl("select", {
        cls: "rl-popover-select",
      });

    const anyTopic =
      topic.createEl("option", {
        value: "",
        text: "Any topic",
      });

    anyTopic.selected =
      !this.topicFilter;

    for (
      const name
      of this.allTopicNames()
    ) {
      const option =
        topic.createEl("option", {
          value: name,
          text: name,
        });

      option.selected =
        name === this.topicFilter;
    }

    topic.addEventListener(
      "change",
      () => {
        this.topicFilter =
          topic.value;

        this.renderCollectionSurface();
      }
    );

    const projectGroup =
      popover.createDiv({
        cls: "rl-popover-section",
      });

    projectGroup.createDiv({
      cls: "rl-popover-label",
      text: "Project",
    });

    const project =
      projectGroup.createEl(
        "select",
        {
          cls: "rl-popover-select",
        }
      );

    const anyProject =
      project.createEl(
        "option",
        {
          value: "",
          text: "Any project",
        }
      );

    anyProject.selected =
      !this.projectFilter;

    for (
      const name
      of this.allOrganizationNames(
        "project"
      )
    ) {
      const option =
        project.createEl(
          "option",
          {
            value: name,
            text: name,
          }
        );

      option.selected =
        name === this.projectFilter;
    }

    project.addEventListener(
      "change",
      () => {
        this.projectFilter =
          project.value;

        this.renderCollectionSurface();
      }
    );

    const collectionGroup =
      popover.createDiv({
        cls:
          "rl-popover-section rl-filter-list-section",
      });

    collectionGroup.createDiv({
      cls: "rl-popover-label",
      text: "List",
    });

    collectionGroup.createDiv({
      cls:
        "rl-filter-list-hint",
      text:
        "manual membership",
    });

    const collection =
      collectionGroup.createEl(
        "select",
        {
          cls: "rl-popover-select",
        }
      );

    const anyCollection =
      collection.createEl(
        "option",
        {
          value: "",
          text: "Any list",
        }
      );

    anyCollection.selected =
      !this.collectionFilter;

    for (
      const name
      of this.allOrganizationNames(
        "collection"
      )
    ) {
      const option =
        collection.createEl(
          "option",
          {
            value: name,
            text: name,
          }
        );

      option.selected =
        name === this.collectionFilter;
    }

    collection.addEventListener(
      "change",
      () => {
        this.collectionFilter =
          collection.value;

        this.renderCollectionSurface();
      }
    );

    const reset = popover.createEl("button", {
      cls: "rl-popover-reset",
      text: "Reset filters",
      attr: { type: "button" },
    });

    reset.addEventListener("click", () => {
      this.statusFilter = "all";
      this.ratingFilter = 0;
      this.topicFilter = "";
      this.collectionFilter = "";
      this.projectFilter = "";
      this.closePopover();
      this.renderCollectionSurface();
    });
  }

  openSortPopover(anchor) {
    this.closePopover();

    const popover = this.createPopover(anchor, "rl-popover-sort");
    this.activePopover = popover;

    popover.createDiv({ cls: "rl-popover-title", text: "Sort" });

    const field = popover.createEl("select", { cls: "rl-popover-select" });

    for (const [value, label] of [
      ["edited", "上次编辑"],
      ["title", "标题"],
      ["year", "年份"],
      ["rating", "重要程度"],
      ["status", "状态"],
    ]) {
      const option = field.createEl("option", { value, text: label });
      option.selected = value === this.sortField;
    }

    field.addEventListener("change", () => {
      this.sortField = field.value;
      this.renderCollectionSurface();
    });

    const direction = popover.createEl("select", { cls: "rl-popover-select" });

    for (const [value, label] of [
      ["desc", "Descending ↓"],
      ["asc", "Ascending ↑"],
    ]) {
      const option = direction.createEl("option", { value, text: label });
      option.selected = value === this.sortDir;
    }

    direction.addEventListener("change", () => {
      this.sortDir = direction.value;
      this.renderCollectionSurface();
    });
  }

  openColumnsPopover(anchor) {
    this.closePopover();

    const popover = this.createPopover(anchor, "rl-popover-columns");
    this.activePopover = popover;

    popover.createDiv({ cls: "rl-popover-title", text: "Columns" });

    const list = popover.createDiv({ cls: "rl-column-list" });

    for (const key of Object.keys(COLUMN_META)) {
      const item = list.createEl("label", { cls: "rl-column-item" });

      const checkbox = item.createEl("input", {
        attr: { type: "checkbox" },
      });

      checkbox.checked = this.plugin.settings.columns[key] !== false;

      item.createSpan({ text: COLUMN_META[key].label });

      checkbox.addEventListener("change", async () => {
        if (key === "name" && !checkbox.checked) {
          checkbox.checked = true;
          new Notice("Name 列不能隐藏。");
          return;
        }

        this.plugin.settings.columns[key] = checkbox.checked;
        await this.plugin.saveSettings();
        this.renderHeader();
        this.renderRows();
      });
    }

    const reset = popover.createEl("button", {
      cls: "rl-popover-reset",
      text: "Reset columns",
      attr: { type: "button" },
    });

    reset.addEventListener("click", async () => {
      this.plugin.settings.columns = Object.assign({}, DEFAULT_COLUMNS);
      this.plugin.settings.columnWidths = Object.assign({}, DEFAULT_WIDTHS);
      await this.plugin.saveSettings();
      this.closePopover();
      this.renderHeader();
      this.renderRows();
    });
  }

  createPopover(anchor, extraClass) {
    const popover = this.rootEl.createDiv({
      cls: `rl-popover ${extraClass}`,
    });

    const rootRect = this.rootEl.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();

    popover.style.left = `${Math.max(10, rect.left - rootRect.left)}px`;
    popover.style.top = `${rect.bottom - rootRect.top + 7}px`;

    popover.addEventListener("click", (e) => e.stopPropagation());

    return popover;
  }

  closePopover() {
    if (this.activePopover) {
      this.activePopover.remove();
      this.activePopover = null;
    }
  }

  applyReadingStatusDates(
    fm,
    status,
    today
  ) {
    if (
      status === "reading"
      && !fm.date_started
    ) {
      fm.date_started =
        today;
    }

    if (
      status === "read"
    ) {
      // If a paper is marked complete without ever entering
      // "进行中", completion still implies that reading started.
      if (!fm.date_started) {
        fm.date_started =
          today;
      }

      if (!fm.date_read) {
        fm.date_read =
          today;
      }
    }

    return {
      dateStarted:
        this.plain(
          fm.date_started
        ),
      dateRead:
        this.plain(
          fm.date_read
        ),
    };
  }

  syncPaperReadingState(
    file,
    status,
    {
      dateStarted = "",
      dateRead = "",
    } = {}
  ) {
    const paper =
      this.papers.find(
        (item) =>
          item.file.path
          === file.path
      );

    if (!paper) {
      return null;
    }

    paper.status =
      status;

    paper.dateStarted =
      dateStarted || "";

    paper.dateRead =
      dateRead || "";

    return paper;
  }

  async updateStatus(
    file,
    status,
    { refresh = true } = {}
  ) {
    const today =
      this.today();

    this.suppressRefreshUntil =
      Date.now() + 650;

    let readingDates = {
      dateStarted: "",
      dateRead: "",
    };

    await this.app.fileManager
      .processFrontMatter(
        file,
        (fm) => {
          fm.status =
            status;

          readingDates =
            this.applyReadingStatusDates(
              fm,
              status,
              today
            );
        }
      );

    const paper =
      this.syncPaperReadingState(
        file,
        status,
        readingDates
      );

    if (paper) {
      this.markPaperRuntimeChanged(
        paper
      );
    }

    if (refresh) {
      await this.reloadSoon();
    }
    else if (paper) {
      await this.refreshPaperRow(
        paper,
        {
          renderDetail:
            true,
        }
      );
    }

    return readingDates;
  }

  async updateRating(
    file,
    rating,
    { refresh = true } = {}
  ) {
    this.suppressRefreshUntil =
      Date.now() + 650;

    await this.app.fileManager
      .processFrontMatter(
        file,
        (fm) => {
          fm.rating =
            rating || null;
        }
      );

    const paper =
      this.papers.find(
        (item) =>
          item.file.path
          === file.path
      );

    if (paper) {
      paper.rating =
        rating || 0;

      this.markPaperRuntimeChanged(
        paper
      );
    }

    if (refresh) {
      await this.reloadSoon();
    }
    else if (paper) {
      await this.refreshPaperRow(
        paper,
        {
          renderDetail:
            true,
        }
      );
    }
  }

  async reloadSoon() {
    await new Promise(
      (resolve) =>
        window.setTimeout(
          resolve,
          90
        )
    );

    const result =
      await this.loadPapers();

    if (
      result.changed
    ) {
      this.renderRows();

      await this.renderDetailIfOpen();
    }
  }

  textCell(parent, className, text) {
    return parent.createDiv({
      cls: `${className} rl-cell-text`,
      text,
    });
  }

  resolveVaultFile(linkPath, sourcePath) {
    const raw = this.linkPath(linkPath);
    if (!raw) return null;

    const resolved = this.app.metadataCache.getFirstLinkpathDest(raw, sourcePath);

    if (resolved instanceof TFile) return resolved;

    const direct = this.app.vault.getAbstractFileByPath(normalizePath(raw));

    return direct instanceof TFile ? direct : null;
  }

  asArray(value) {
    if (value === null || value === undefined || value === "") return [];
    return Array.isArray(value) ? value : [value];
  }

  plain(value) {
    if (value === null || value === undefined) return "";

    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }

    if (typeof value === "object") {
      if (value.path) return String(value.path);
      if (value.display) return String(value.display);
    }

    return String(value);
  }

  displayValue(value) {
    const raw = this.plain(value).trim();
    if (!raw) return "";

    const match = raw.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);

    if (match) {
      const target = match[2] || match[1];
      return target.split("/").pop().replace(/\.md$/i, "");
    }

    return raw;
  }

  linkPath(value) {
    const raw = this.plain(value).trim();
    if (!raw) return "";

    const match = raw.match(
      /^\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]$/
    );

    return match ? match[1] : raw;
  }

  normalizeDoi(value) {
    return this.plain(value)
      .trim()
      .replace(/^doi:\s*/i, "")
      .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
      .replace(/[.,;]+$/, "")
      .toLowerCase();
  }

  normalizeStatus(value) {
    const status = this.plain(value).trim().toLowerCase();
    return STATUS_META[status] ? status : "inbox";
  }

  shortAuthors(authors) {
    const names = this.asArray(authors)
      .map((x) => this.displayValue(x))
      .filter(Boolean);

    if (!names.length) return "—";

    const family = (name) => {
      if (name.includes(",")) return name.split(",")[0].trim();
      const parts = name.trim().split(/\s+/);
      return parts[parts.length - 1];
    };

    if (names.length === 1) return family(names[0]);

    if (names.length === 2) {
      return `${family(names[0])} & ${family(names[1])}`;
    }

    return `${family(names[0])} et al.`;
  }

  shortVenue(value) {
    const venue = this.plain(value).trim();
    if (!venue) return "—";

    const rules = [
      [/advances in neural information processing systems/i, "NeurIPS"],
      [/\bneurips\b/i, "NeurIPS"],
      [/\bnips\b/i, "NeurIPS"],
      [/international conference on machine learning/i, "ICML"],
      [/\bicml\b/i, "ICML"],
      [/conference on computer vision and pattern recognition/i, "CVPR"],
      [/\bcvpr\b/i, "CVPR"],
      [/international conference on computer vision/i, "ICCV"],
      [/\biccv\b/i, "ICCV"],
      [/european conference on computer vision/i, "ECCV"],
      [/\beccv\b/i, "ECCV"],
      [/international conference on learning representations/i, "ICLR"],
      [/\biclr\b/i, "ICLR"],
      [/empirical methods in natural language processing/i, "EMNLP"],
      [/\bemnlp\b/i, "EMNLP"],
      [/\bnaacl\b/i, "NAACL"],
      [/association for computational linguistics/i, "ACL"],
    ];

    for (const [pattern, short] of rules) {
      if (pattern.test(venue)) return short;
    }

    return venue;
  }

  formatMtime(ms) {
    try {
      const date = new Date(ms);
      const pad = (n) => String(n).padStart(2, "0");

      return (
        `${date.getFullYear()}-` +
        `${pad(date.getMonth() + 1)}-` +
        `${pad(date.getDate())} ` +
        `${pad(date.getHours())}:` +
        `${pad(date.getMinutes())}`
      );
    } catch (_) {
      return "—";
    }
  }

  today() {
    const date = new Date();
    const pad = (n) => String(n).padStart(2, "0");

    return (
      `${date.getFullYear()}-` +
      `${pad(date.getMonth() + 1)}-` +
      `${pad(date.getDate())}`
    );
  }
}

class OrganizationManagerModal extends Modal {
  constructor(
    app,
    {
      library,
      initialType = "topic",
    }
  ) {
    super(app);

    this.library =
      library;

    this.type =
      [
        "topic",
        "collection",
        "project",
      ].includes(initialType)
        ? initialType
        : "topic";

    this.query = "";
    this.deleteConfirmName = null;
    this.deleteConfirmTimer = null;
  }

  onOpen() {
    this.modalEl.addClass(
      "rl-organization-manager-modal"
    );

    this.applyAppearanceSettings();
    this.render();
  }

  applyAppearanceSettings() {
    const settings =
      this.library?.plugin
        ?.settings || {};

    const source =
      String(
        settings.fontSource
        || "obsidian-interface"
      );

    let family =
      "var(--font-interface)";

    if (
      source
      === "obsidian-text"
    ) {
      family =
        "var(--font-text)";
    }
    else if (
      source
      === "obsidian-monospace"
    ) {
      family =
        "var(--font-monospace)";
    }
    else if (
      source.startsWith(
        "system:"
      )
    ) {
      const systemFamily =
        source
          .slice(
            "system:".length
          )
          .trim();

      if (systemFamily) {
        family =
          `"${systemFamily.replace(
            /"/g,
            '\\"'
          )}", sans-serif`;
      }
    }

    const size =
      Math.max(
        10,
        Math.min(
          20,
          Number(
            settings.fontSize
          ) || 13
        )
      );

    this.modalEl.style
      .setProperty(
        "--rl-font-family",
        family
      );

    this.modalEl.style
      .setProperty(
        "--rl-font-size",
        `${size}px`
      );
  }

  onClose() {
    if (this.deleteConfirmTimer) {
      window.clearTimeout(
        this.deleteConfirmTimer
      );

      this.deleteConfirmTimer = null;
    }

    this.contentEl.empty();
  }

  config() {
    return this.library
      .organizationConfig(
        this.type
      );
  }

  render() {
    this.contentEl.empty();

    const header =
      this.contentEl.createDiv({
        cls:
          "rl-organization-manager-header",
      });

    const heading =
      header.createDiv();

    heading.createEl(
      "h2",
      {
        text:
          "Research Organization",
      }
    );

    const tabs =
      this.contentEl.createDiv({
        cls:
          "rl-organization-manager-tabs",
      });

    for (
      const type
      of [
        "topic",
        "project",
        "collection",
      ]
    ) {
      const config =
        this.library
          .organizationConfig(
            type
          );

      const button =
        tabs.createEl(
          "button",
          {
            cls:
              `rl-organization-manager-tab${
                type === this.type
                  ? " is-active"
                  : ""
              }`,
            attr: {
              type:
                "button",
            },
          }
        );

      this.library.createIcon(
        button,
        config.icon,
        "rl-organization-manager-tab-icon"
      );

      button.createSpan({
        text:
          config.plural,
      });

      button.addEventListener(
        "click",
        () => {
          if (
            type
            === this.type
          ) {
            return;
          }

          this.type =
            type;

          this.query =
            "";

          this.deleteConfirmName =
            null;

          this.render();
        }
      );
    }

    const config =
      this.config();

    const items =
      this.library
        .organizationItems(
          this.type
        );

    const assigned =
      items.reduce(
        (sum, item) =>
          sum + item.count,
        0
      );

    const field =
      config.field;

    const unassigned =
      this.library.papers
        .filter(
          (paper) =>
            !(paper[field]
              || []).length
        ).length;

    const summary =
      this.contentEl.createDiv({
        cls:
          "rl-organization-manager-summary",
      });

    const addStat =
      (
        label,
        value,
        icon
      ) => {
        const card =
          summary.createDiv({
            cls:
              "rl-organization-stat",
          });

        this.library.createIcon(
          card,
          icon,
          "rl-organization-stat-icon"
        );

        const text =
          card.createDiv();

        text.createDiv({
          cls:
            "rl-organization-stat-value",
          text:
            String(value),
        });

        text.createDiv({
          cls:
            "rl-organization-stat-label",
          text:
            label,
        });
      };

    addStat(
      config.plural,
      items.length,
      config.icon
    );

    addStat(
      "Assignments",
      assigned,
      "link-2"
    );

    addStat(
      "Unassigned papers",
      unassigned,
      "circle-dashed"
    );

    const tools =
      this.contentEl.createDiv({
        cls:
          "rl-organization-manager-tools",
      });

    const searchWrap =
      tools.createDiv({
        cls:
          "rl-search rl-organization-manager-search",
      });

    this.library.createIcon(
      searchWrap,
      "search",
      "rl-search-icon"
    );

    const search =
      searchWrap.createEl(
        "input",
        {
          cls:
            "rl-search-input",
          attr: {
            type: "search",
            placeholder:
              `搜索 ${config.plural}…`,
          },
        }
      );

    search.value =
      this.query;

    const createWrap =
      tools.createDiv({
        cls:
          "rl-organization-create",
      });

    const createInput =
      createWrap.createEl(
        "input",
        {
          cls:
            "rl-organization-create-input",
          attr: {
            type: "text",
            placeholder:
              `新建 ${config.label}…`,
          },
        }
      );

    const createButton =
      createWrap.createEl(
        "button",
        {
          cls:
            "mod-cta rl-organization-create-button",
          text: "Create",
          attr: {
            type: "button",
          },
        }
      );

    const createEntity =
      async () => {
        const name =
          createInput.value.trim();

        if (!name) {
          createInput.focus();
          return;
        }

        createButton.disabled =
          true;

        try {
          const clean =
            await this.library
              .createOrganizationEntity(
                this.type,
                name
              );

          new Notice(
            `已创建 ${config.label}：${clean}`
          );

          this.render();
        }
        catch (error) {
          new Notice(
            error?.message
            || `创建 ${config.label} 失败`,
            6000
          );

          createButton.disabled =
            false;
        }
      };

    createButton.addEventListener(
      "click",
      createEntity
    );

    createInput.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void createEntity();
        }
      }
    );

    const list =
      this.contentEl.createDiv({
        cls:
          "rl-organization-manager-list",
      });

    const renderList = () => {
      list.empty();

      const query =
        this.query
          .trim()
          .toLowerCase();

      const filtered =
        this.library
          .organizationItems(
            this.type
          )
          .filter(
            (item) =>
              !query
              || item.name
                .toLowerCase()
                .includes(query)
          );

      if (!filtered.length) {
        const empty =
          list.createDiv({
            cls:
              "rl-organization-manager-empty",
          });

        this.library.createIcon(
          empty,
          config.icon,
          "rl-organization-manager-empty-icon"
        );

        empty.createDiv({
          text:
            query
              ? `没有匹配的 ${config.label}`
              : `还没有 ${config.label}`,
        });

        return;
      }

      for (const item of filtered) {
        const row =
          list.createDiv({
            cls:
              "rl-organization-manager-row",
          });

        const icon =
          row.createDiv({
            cls:
              "rl-organization-manager-icon",
          });

        this.library.createIcon(
          icon,
          config.icon
        );

        if (
          this.type === "topic"
        ) {
          this.library.applyTopicColor(
            icon,
            item.name
          );
        }

        const body =
          row.createDiv({
            cls:
              "rl-organization-manager-body",
          });

        const nameButton =
          body.createEl(
            "button",
            {
              cls:
                "rl-organization-manager-name",
              text:
                item.name,
              attr: {
                type: "button",
                title:
                  `在 Library 中筛选 ${item.name}`,
              },
            }
          );

        nameButton.addEventListener(
          "click",
          () => {
            this.library
              .applyOrganizationFilter(
                this.type,
                item.name
              );

            this.close();
          }
        );

        const meta =
          body.createDiv({
            cls:
              "rl-organization-manager-meta",
          });

        meta.createSpan({
          text:
            [
              `${item.count} 篇论文`,
              `${item.unread} 未完成`,
              `${item.highRated} 篇 ★4+`,
              item.latestAdded
                ? `最近 ${item.latestAdded}`
                : "",
            ]
              .filter(Boolean)
              .join(" · "),
        });

        if (
          item.missingDefinition
        ) {
          const missing =
            meta.createSpan({
              cls:
                "rl-organization-missing-definition",
              text:
                "缺定义笔记",
              attr: {
                title:
                  "Paper YAML 中已有该名称，但对应组织定义 Markdown Note 不存在。",
              },
            });

          this.library.createIcon(
            missing,
            "file-warning",
            "rl-organization-missing-definition-icon"
          );
        }

        const actions =
          row.createDiv({
            cls:
              "rl-organization-manager-actions",
          });

        if (
          item.missingDefinition
        ) {
          const repair =
            actions.createEl(
              "button",
              {
                cls:
                  "rl-organization-manager-action",
                attr: {
                  type:
                    "button",
                  title:
                    "补建定义笔记",
                },
              }
            );

          this.library.createIcon(
            repair,
            "file-plus-2"
          );

          repair.addEventListener(
            "click",
            async () => {
              repair.disabled =
                true;

              try {
                await this.library
                  .ensureOrganizationEntity(
                    this.type,
                    item.name
                  );

                new Notice(
                  `已补建 ${config.label} 定义笔记：${item.name}`
                );

                this.render();
              }
              catch (error) {
                repair.disabled =
                  false;

                new Notice(
                  error?.message
                  || `补建 ${config.label} 定义笔记失败`,
                  6000
                );
              }
            }
          );
        }

        const filter =
          actions.createEl(
            "button",
            {
              cls:
                "rl-organization-manager-action",
              attr: {
                type: "button",
                title:
                  "筛选 Library",
              },
            }
          );

        this.library.createIcon(
          filter,
          "list-filter"
        );

        filter.addEventListener(
          "click",
          () => {
            this.library
              .applyOrganizationFilter(
                this.type,
                item.name
              );

            this.close();
          }
        );

        const rename =
          actions.createEl(
            "button",
            {
              cls:
                "rl-organization-manager-action",
              attr: {
                type: "button",
                title:
                  `重命名 ${config.label}`,
              },
            }
          );

        this.library.createIcon(
          rename,
          "pencil"
        );

        rename.addEventListener(
          "click",
          () => {
            this.beginRename(
              row,
              item
            );
          }
        );

        const remove =
          actions.createEl(
            "button",
            {
              cls:
                `rl-organization-manager-action rl-organization-delete${
                  this.deleteConfirmName
                    === item.name
                    ? " is-confirming"
                    : ""
                }`,
              attr: {
                type: "button",
                title:
                  this.deleteConfirmName
                    === item.name
                    ? "再次点击确认删除"
                    : `删除 ${config.label}`,
              },
            }
          );

        this.library.createIcon(
          remove,
          this.deleteConfirmName
            === item.name
            ? "triangle-alert"
            : "trash-2"
        );

        if (
          this.deleteConfirmName
          === item.name
        ) {
          remove.createSpan({
            text: "确认",
          });
        }

        remove.addEventListener(
          "click",
          async () => {
            if (
              this.deleteConfirmName
              !== item.name
            ) {
              this.deleteConfirmName =
                item.name;

              if (
                this.deleteConfirmTimer
              ) {
                window.clearTimeout(
                  this.deleteConfirmTimer
                );
              }

              this.deleteConfirmTimer =
                window.setTimeout(
                  () => {
                    this.deleteConfirmName =
                      null;
                    this.render();
                  },
                  5000
                );

              this.render();
              return;
            }

            try {
              await this.library
                .deleteOrganizationEntity(
                  this.type,
                  item.name
                );

              this.deleteConfirmName =
                null;

              new Notice(
                `已删除 ${config.label}：${item.name}`
              );

              this.render();
            }
            catch (error) {
              new Notice(
                error?.message
                || `删除 ${config.label} 失败`,
                7000
              );
            }
          }
        );
      }
    };

    search.addEventListener(
      "input",
      () => {
        this.query =
          search.value;
        renderList();
      }
    );

    renderList();
  }

  beginRename(
    row,
    item
  ) {
    const config =
      this.config();

    const body =
      row.querySelector(
        ".rl-organization-manager-body"
      );

    const actions =
      row.querySelector(
        ".rl-organization-manager-actions"
      );

    if (!body || !actions) {
      return;
    }

    row.addClass(
      "is-renaming"
    );

    body.empty();
    actions.empty();

    const input =
      body.createEl(
        "input",
        {
          cls:
            "rl-organization-rename-input",
          attr: {
            type: "text",
          },
        }
      );

    input.value =
      item.name;

    const save =
      actions.createEl(
        "button",
        {
          cls:
            "rl-organization-manager-action is-primary",
          attr: {
            type: "button",
            title: "保存",
          },
        }
      );

    this.library.createIcon(
      save,
      "check"
    );

    const cancel =
      actions.createEl(
        "button",
        {
          cls:
            "rl-organization-manager-action",
          attr: {
            type: "button",
            title: "取消",
          },
        }
      );

    this.library.createIcon(
      cancel,
      "x"
    );

    let saving = false;

    const submit =
      async () => {
        if (saving) return;

        saving = true;
        save.disabled = true;
        cancel.disabled = true;

        try {
          const next =
            await this.library
              .renameOrganizationEntity(
                this.type,
                item.name,
                input.value
              );

          new Notice(
            `${config.label} 已重命名为 ${next}`
          );

          this.render();
        }
        catch (error) {
          saving = false;
          save.disabled = false;
          cancel.disabled = false;

          new Notice(
            error?.message
            || `重命名 ${config.label} 失败`,
            7000
          );

          input.focus();
        }
      };

    save.addEventListener(
      "click",
      submit
    );

    cancel.addEventListener(
      "click",
      () => this.render()
    );

    input.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void submit();
        }
        else if (
          event.key === "Escape"
        ) {
          event.preventDefault();
          this.render();
        }
      }
    );

    window.setTimeout(
      () => {
        input.focus();
        input.select();
      },
      0
    );
  }
}


class PdfPickerModal extends Modal {
  constructor(
    app,
    {
      files,
      onChoose,
      onCancel,
    }
  ) {
    super(app);

    this.files = files;
    this.onChoose = onChoose;
    this.onCancel = onCancel;
    this.completed = false;

    this.selectedPaths =
      new Set();

    this.rowEls =
      new Map();
  }

  onOpen() {
    this.modalEl.addClass(
      "rl-import-modal"
    );

    this.modalEl.addClass(
      "rl-pdf-picker-modal"
    );

    this.contentEl.empty();

    this.contentEl.createEl(
      "h2",
      {
        text: "Import PDF",
      }
    );

    this.subtitleEl =
      this.contentEl.createDiv({
        cls:
          "rl-import-modal-subtitle",
        text:
          `选择 PDF Inbox 中要导入的论文 PDF · 共 ${this.files.length} 个文件`,
      });

    const actions =
      this.contentEl.createDiv({
        cls:
          "rl-pdf-picker-actions",
      });

    this.selectAllButton =
      actions.createEl(
        "button",
        {
          cls:
            "rl-pdf-picker-select-all",
          attr: {
            type: "button",
          },
        }
      );

    const selectIcon =
      this.selectAllButton
        .createSpan({
          cls:
            "rl-pdf-picker-select-icon",
        });

    setIcon(
      selectIcon,
      "list-checks"
    );

    this.selectAllText =
      this.selectAllButton
        .createSpan({
          text:
            "Select all",
        });

    this.selectedCountEl =
      actions.createSpan({
        cls:
          "rl-pdf-picker-selected-count",
        text:
          "0 selected",
      });

    this.selectAllButton
      .addEventListener(
        "click",
        () => {
          if (
            this.selectedPaths.size
            === this.files.length
          ) {
            this.selectedPaths
              .clear();
          }
          else {
            this.selectedPaths =
              new Set(
                this.files.map(
                  (file) =>
                    file.path
                )
              );
          }

          this.refreshSelectionUi();
        }
      );

    const listWrap =
      this.contentEl.createDiv({
        cls:
          "rl-pdf-picker-wrap",
      });

    const list =
      listWrap.createDiv({
        cls:
          "rl-pdf-picker-list",
      });

    for (
      const file
      of this.files
    ) {
      const item =
        list.createDiv({
          cls:
            "rl-pdf-picker-item",
          attr: {
            role: "button",
            tabindex: "0",
            title: file.path,
          },
        });

      const checkbox =
        item.createSpan({
          cls:
            "rl-pdf-picker-checkbox",
        });

      const icon =
        item.createSpan({
          cls:
            "rl-pdf-picker-icon",
        });

      setIcon(
        icon,
        "file-text"
      );

      const text =
        item.createDiv({
          cls:
            "rl-pdf-picker-text",
        });

      const top =
        text.createDiv({
          cls:
            "rl-pdf-picker-top",
        });

      top.createDiv({
        cls:
          "rl-pdf-picker-name",
        text: file.name,
      });

      top.createDiv({
        cls:
          "rl-pdf-picker-size",
        text:
          this.formatSize(
            file.stat.size
          ),
      });

      text.createDiv({
        cls:
          "rl-pdf-picker-path",
        text: file.path,
      });

      this.rowEls.set(
        file.path,
        {
          item,
          checkbox,
        }
      );

      const toggle =
        () => {
          if (
            this.selectedPaths.has(
              file.path
            )
          ) {
            this.selectedPaths.delete(
              file.path
            );
          }
          else {
            this.selectedPaths.add(
              file.path
            );
          }

          this.refreshSelectionUi();
        };

      item.addEventListener(
        "click",
        toggle
      );

      item.addEventListener(
        "keydown",
        (event) => {
          if (
            event.key === " "
            || event.key === "Enter"
          ) {
            event.preventDefault();
            toggle();
          }
        }
      );
    }

    const footer =
      this.contentEl.createDiv({
        cls:
          "rl-import-modal-footer rl-pdf-picker-footer",
      });

    const cancel =
      footer.createEl(
        "button",
        {
          cls:
            "rl-import-ghost-button",
          text:
            "Cancel",
          attr: {
            type: "button",
          },
        }
      );

    cancel.addEventListener(
      "click",
      () => {
        this.close();
      }
    );

    this.importButton =
      footer.createEl(
        "button",
        {
          cls:
            "mod-cta rl-pdf-picker-import",
          text:
            "Import selected",
          attr: {
            type: "button",
            disabled: "disabled",
          },
        }
      );

    this.importButton
      .addEventListener(
        "click",
        () => {
          const selected =
            this.files.filter(
              (file) =>
                this.selectedPaths.has(
                  file.path
                )
            );

          if (!selected.length) {
            return;
          }

          this.completed = true;

          this.onChoose?.(
            selected
          );

          this.close();
        }
      );

    this.refreshSelectionUi();
  }

  refreshSelectionUi() {
    const count =
      this.selectedPaths.size;

    this.selectedCountEl
      ?.setText(
        `${count} selected`
      );

    this.subtitleEl
      ?.setText(
        `选择 PDF Inbox 中要导入的论文 PDF · 共 ${this.files.length} 个文件${
          count
            ? ` · 已选 ${count}`
            : ""
        }`
      );

    if (
      this.selectAllText
    ) {
      this.selectAllText.setText(
        count === this.files.length
          ? "Clear all"
          : "Select all"
      );
    }

    if (this.importButton) {
      this.importButton.setText(
        count > 1
          ? `Import selected (${count})`
          : count === 1
            ? "Import paper"
            : "Import selected"
      );

      if (count) {
        this.importButton
          .removeAttribute(
            "disabled"
          );
      }
      else {
        this.importButton
          .setAttribute(
            "disabled",
            "disabled"
          );
      }
    }

    for (
      const [
        path,
        row,
      ]
      of this.rowEls
    ) {
      const selected =
        this.selectedPaths.has(
          path
        );

      row.item.toggleClass(
        "is-selected",
        selected
      );

      row.checkbox.empty();

      if (selected) {
        setIcon(
          row.checkbox,
          "check"
        );
      }
    }
  }

  formatSize(bytes) {
    if (bytes < 1024) {
      return `${bytes} B`;
    }

    if (
      bytes < 1024 ** 2
    ) {
      return `${
        (bytes / 1024)
          .toFixed(1)
      } KB`;
    }

    return `${
      (
        bytes
        / 1024 ** 2
      )
        .toFixed(1)
    } MB`;
  }

  onClose() {
    if (!this.completed) {
      this.onCancel?.();
    }

    this.contentEl.empty();
  }
}


class BatchImportProgressModal extends Modal {
  constructor(
    app,
    {
      files,
    }
  ) {
    super(app);

    this.files =
      Array.isArray(files)
        ? files
        : [];

    this.rows =
      new Map();

    this.cancelRequested =
      false;

    this.running =
      true;

    this.closed =
      false;
  }

  onOpen() {
    this.modalEl.addClass(
      "rl-import-modal"
    );

    this.modalEl.addClass(
      "rl-batch-import-modal"
    );

    this.contentEl.empty();

    const header =
      this.contentEl.createDiv({
        cls:
          "rl-batch-import-header",
      });

    const heading =
      header.createDiv();

    heading.createEl(
      "h2",
      {
        text:
          "Batch import",
      }
    );

    this.subtitleEl =
      heading.createDiv({
        cls:
          "rl-import-modal-subtitle",
        text:
          `0 / ${this.files.length} completed · sequential · watchdog enabled`,
      });

    this.summaryBadge =
      header.createDiv({
        cls:
          "rl-batch-summary-badge",
        text:
          `${this.files.length} papers`,
      });

    const progressTrack =
      this.contentEl.createDiv({
        cls:
          "rl-batch-progress-track",
      });

    this.progressBar =
      progressTrack.createDiv({
        cls:
          "rl-batch-progress-bar",
      });

    const list =
      this.contentEl.createDiv({
        cls:
          "rl-batch-import-list",
      });

    for (
      const file
      of this.files
    ) {
      const row =
        list.createDiv({
          cls:
            "rl-batch-import-row is-pending",
        });

      const icon =
        row.createDiv({
          cls:
            "rl-batch-import-status-icon",
        });

      setIcon(
        icon,
        "clock-3"
      );

      const body =
        row.createDiv({
          cls:
            "rl-batch-import-body",
        });

      body.createDiv({
        cls:
          "rl-batch-import-name",
        text:
          file.name,
      });

      const detail =
        body.createDiv({
          cls:
            "rl-batch-import-detail",
        text:
          "Pending",
        });

      const state =
        row.createDiv({
          cls:
            "rl-batch-import-state",
        text:
          "Pending",
        });

      const actions =
        row.createDiv({
          cls:
            "rl-batch-import-actions",
        });

      this.rows.set(
        file,
        {
          row,
          icon,
          detail,
          state,
          actions,
          actionButtons: [],
          actionBusy:
            false,
          status:
            "pending",
          originalPath:
            file.path,
        }
      );
    }

    const footer =
      this.contentEl.createDiv({
        cls:
          "rl-import-modal-footer rl-batch-import-footer",
      });

    this.stopButton =
      footer.createEl(
        "button",
        {
          cls:
            "rl-import-secondary-button",
          text:
            "Stop after current",
          attr: {
            type: "button",
          },
        }
      );

    this.stopButton
      .addEventListener(
        "click",
        () => {
          this.cancelRequested =
            true;

          this.stopButton
            .setDisabled(true);

          this.stopButton
            .setText(
              "Stopping…"
            );

          this.subtitleEl
            ?.setText(
              "将在当前论文处理完成后停止"
            );
        }
      );

    this.closeButton =
      footer.createEl(
        "button",
        {
          cls:
            "mod-cta",
          text:
            "Running…",
          attr: {
            type:
              "button",
            disabled:
              "disabled",
          },
        }
      );

    this.closeButton
      .addEventListener(
        "click",
        () => {
          this.close();
        }
      );
  }

  clearActions(file) {
    const entry =
      this.rows.get(file);

    if (!entry) return;

    entry.actions?.empty();

    entry.actionButtons = [];
  }

  createRowAction(
    file,
    {
      label,
      icon,
      title = "",
      primary = false,
      onClick,
    }
  ) {
    const entry =
      this.rows.get(file);

    if (!entry) return null;

    const button =
      entry.actions.createEl(
        "button",
        {
          cls:
            `rl-batch-row-action${
              primary
                ? " is-primary"
                : ""
            }`,
          attr: {
            type:
              "button",
            title:
              title || label,
          },
        }
      );

    if (icon) {
      const iconEl =
        button.createSpan({
          cls:
            "rl-batch-row-action-icon",
        });

      setIcon(
        iconEl,
        icon
      );
    }

    button.createSpan({
      cls:
        "rl-batch-row-action-label",
      text:
        label,
    });

    button.disabled =
      this.running
      || entry.actionBusy;

    button.addEventListener(
      "click",
      async (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (
          button.disabled
          || entry.actionBusy
        ) {
          return;
        }

        try {
          await onClick?.();
        }
        catch (error) {
          console.error(
            "Research Library batch row action failed:",
            error
          );
        }
      }
    );

    entry.actionButtons.push(
      button
    );

    return button;
  }

  setReviewActions(
    file,
    {
      onReview,
      onOpenPdf,
    }
  ) {
    this.clearActions(
      file
    );

    this.createRowAction(
      file,
      {
        label:
          "Review",
        icon:
          "pencil-line",
        title:
          "人工复查这篇论文",
        primary:
          true,
        onClick:
          onReview,
      }
    );

    this.createRowAction(
      file,
      {
        label:
          "Open PDF",
        icon:
          "file-type-2",
        title:
          "打开 PDF Inbox 中的 PDF",
        onClick:
          onOpenPdf,
      }
    );
  }

  setDuplicateActions(
    file,
    {
      existing,
      onOpenExisting,
      onOpenPdf,
    }
  ) {
    this.clearActions(
      file
    );

    if (
      existing
      && onOpenExisting
    ) {
      this.createRowAction(
        file,
        {
          label:
            "Open existing",
          icon:
            "external-link",
          title:
            "打开已存在的 Paper Note",
          primary:
            true,
          onClick:
            onOpenExisting,
        }
      );
    }

    if (onOpenPdf) {
      this.createRowAction(
        file,
        {
          label:
            "Open PDF",
          icon:
            "file-type-2",
          title:
            "打开 PDF Inbox 中的重复 PDF",
          onClick:
            onOpenPdf,
        }
      );
    }
  }

  setActionBusy(
    file,
    busy,
    label = ""
  ) {
    const entry =
      this.rows.get(file);

    if (!entry) return;

    entry.actionBusy =
      Boolean(busy);

    for (
      const button
      of entry.actionButtons
      || []
    ) {
      button.disabled =
        this.running
        || entry.actionBusy;
    }

    if (
      busy
      && label
    ) {
      entry.state.setText(
        label
      );
    }
    else if (!busy) {
      const info =
        this.statusInfo(
          entry.status
        );

      entry.state.setText(
        info.label
      );
    }
  }

  enableRowActions() {
    for (
      const entry
      of this.rows.values()
    ) {
      for (
        const button
        of entry.actionButtons
        || []
      ) {
        button.disabled =
          Boolean(
            entry.actionBusy
          );
      }
    }
  }

  updateSummary(summary) {
    if (
      this.closed
      || !summary
    ) {
      return;
    }

    this.subtitleEl
      ?.setText(
        `${summary.imported} imported · ${summary.review} needs review · ${summary.duplicate} duplicate · ${summary.failed} failed${
          summary.cancelled
            ? ` · ${summary.cancelled} cancelled`
            : ""
        }`
      );

    this.summaryBadge
      ?.setText(
        `${summary.imported}/${this.files.length} imported`
      );
  }

  getFileStatus(file) {
    return (
      this.rows.get(file)
        ?.status
      || ""
    );
  }

  isTerminalStatus(status) {
    return new Set([
      "imported",
      "review",
      "duplicate",
      "failed",
      "cancelled",
    ]).has(status);
  }

  ensureTerminalState(
    file,
    fallbackStatus = "failed",
    detail =
      "任务已结束，但进度状态未正常收敛"
  ) {
    if (
      this.closed
      || !file
    ) {
      return;
    }

    const current =
      this.getFileStatus(
        file
      );

    if (
      this.isTerminalStatus(
        current
      )
    ) {
      return;
    }

    this.updateFile(
      file,
      fallbackStatus,
      detail
    );
  }

  statusInfo(status) {
    const map = {
      pending: {
        label:
          "Pending",
        icon:
          "clock-3",
      },
      searching: {
        label:
          "Searching",
        icon:
          "loader-circle",
      },
      importing: {
        label:
          "Importing",
        icon:
          "loader-circle",
      },
      imported: {
        label:
          "Imported",
        icon:
          "check",
      },
      review: {
        label:
          "Needs review",
        icon:
          "triangle-alert",
      },
      duplicate: {
        label:
          "Duplicate",
        icon:
          "copy-check",
      },
      failed: {
        label:
          "Failed",
        icon:
          "circle-x",
      },
      cancelled: {
        label:
          "Cancelled",
        icon:
          "ban",
      },
    };

    return map[status]
      || map.pending;
  }

  updateFile(
    file,
    status,
    detail = ""
  ) {
    if (
      this.closed
      || !file
    ) {
      return;
    }

    // TFile.path changes when fileManager.renameFile()
    // moves an Inbox PDF into the PDF library. Therefore the
    // stable TFile object reference — not file.path — is the
    // identity of a batch progress row.
    const entry =
      this.rows.get(
        file
      );

    if (!entry) {
      console.warn(
        "Research Library: batch progress row not found",
        {
          currentPath:
            file.path,
        }
      );

      return;
    }

    const info =
      this.statusInfo(
        status
      );

    entry.status =
      status;

    entry.row.className =
      `rl-batch-import-row is-${status}`;

    entry.icon.empty();

    setIcon(
      entry.icon,
      info.icon
    );

    entry.detail.setText(
      String(
        detail
        || info.label
      )
    );

    entry.state.setText(
      info.label
    );

    this.refreshProgress();
  }

  refreshProgress() {
    if (this.closed) return;

    const doneStatuses =
      new Set([
        "imported",
        "review",
        "duplicate",
        "failed",
        "cancelled",
      ]);

    let done = 0;

    for (
      const entry
      of this.rows.values()
    ) {
      if (
        doneStatuses.has(
          entry.status
        )
      ) {
        done += 1;
      }
    }

    const percent =
      this.files.length
        ? (
            done
            / this.files.length
          ) * 100
        : 0;

    if (this.progressBar) {
      this.progressBar.style.width =
        `${percent}%`;
    }

    if (
      this.running
      && this.subtitleEl
    ) {
      this.subtitleEl.setText(
        `${done} / ${this.files.length} completed · sequential · watchdog enabled`
      );
    }
  }

  finish(summary) {
    this.running =
      false;

    if (this.closed) {
      return;
    }

    // Final defensive sweep. A completed batch must never show
    // a permanent Searching / Importing state.
    for (
      const [
        file,
        entry,
      ]
      of this.rows
    ) {
      if (
        !this.isTerminalStatus(
          entry.status
        )
      ) {
        this.updateFile(
          file,
          "failed",
          "批次已结束，但该项未返回终态；请核对 Vault 中的实际导入结果"
        );

        summary.failed += 1;
      }
    }

    this.refreshProgress();

    this.updateSummary(
      summary
    );

    this.stopButton
      ?.hide();

    this.enableRowActions();

    if (this.closeButton) {
      this.closeButton
        .removeAttribute(
          "disabled"
        );

      this.closeButton
        .setText(
          "Done"
        );
    }
  }

  onClose() {
    this.closed =
      true;

    if (this.running) {
      this.cancelRequested =
        true;
    }

    this.contentEl.empty();
  }
}


function renderMetadataDiagnostics(
  container,
  diagnostics
) {
  const items =
    Array.isArray(diagnostics)
      ? diagnostics
      : [];

  if (!items.length) {
    return;
  }

  const wrap =
    container.createDiv({
      cls:
        "rl-source-diagnostics",
    });

  wrap.createDiv({
    cls:
      "rl-source-diagnostics-label",
    text:
      "Source diagnostics",
  });

  const row =
    wrap.createDiv({
      cls:
        "rl-source-diagnostics-row",
    });

  for (const item of items) {
    const status =
      item?.status
      || "skipped";

    const hasResults =
      status === "ok"
      && Number(
        item.count || 0
      ) > 0;

    const chip =
      row.createDiv({
        cls:
          `rl-source-diagnostic is-${
            status === "ok"
              ? hasResults
                ? "hit"
                : "empty"
              : status
          }`,
        attr: {
          title:
            item?.error
            || "",
        },
      });

    const icon =
      chip.createSpan({
        cls:
          "rl-source-diagnostic-icon",
      });

    setIcon(
      icon,
      status === "error"
        ? "triangle-alert"
        : status === "running"
          ? "loader-circle"
          : status === "skipped"
            ? "circle-dashed"
            : hasResults
              ? "check"
              : "minus"
    );

    chip.createSpan({
      cls:
        "rl-source-diagnostic-name",
      text:
        item?.label
        || item?.source
        || "Source",
    });

    chip.createSpan({
      cls:
        "rl-source-diagnostic-value",
      text:
        status === "error"
          ? item.error
            || "Error"
          : status === "skipped"
            ? "not needed"
            : status === "running"
              ? "searching"
              : `${Number(
                  item.count || 0
                )} result${
                  Number(
                    item.count || 0
                  ) === 1
                    ? ""
                    : "s"
                }`,
    });
  }
}

class MaintenanceCenterModal extends Modal {
  constructor(
    app,
    {
      library,
    }
  ) {
    super(app);

    this.library =
      library;

    this.report =
      null;

    this.activeIssue =
      null;

    this.busy =
      false;

    this.refreshResults =
      new Map();

    this.refreshBatchBusy =
      false;

    this.refreshBatchLabel =
      "";

    this.safeFixSelection =
      new Set();
  }

  applyAppearanceSettings() {
    const settings =
      this.library?.plugin
        ?.settings || {};

    const source =
      String(
        settings.fontSource
        || "obsidian-interface"
      );

    let family =
      "var(--font-interface)";

    if (
      source
      === "obsidian-text"
    ) {
      family =
        "var(--font-text)";
    }
    else if (
      source
      === "obsidian-monospace"
    ) {
      family =
        "var(--font-monospace)";
    }
    else if (
      source.startsWith(
        "system:"
      )
    ) {
      const systemFamily =
        source
          .slice(
            "system:".length
          )
          .trim();

      if (systemFamily) {
        family =
          `"${systemFamily.replace(
            /"/g,
            '\\"'
          )}", sans-serif`;
      }
    }

    const size =
      Math.max(
        10,
        Math.min(
          20,
          Number(
            settings.fontSize
          ) || 13
        )
      );

    this.modalEl.style
      .setProperty(
        "--rl-font-family",
        family
      );

    this.modalEl.style
      .setProperty(
        "--rl-font-size",
        `${size}px`
      );
  }

  onOpen() {
    this.modalEl.addClass(
      "rl-maintenance-modal"
    );

    this.applyAppearanceSettings();

    void this.scan();
  }

  onClose() {
    this.contentEl.empty();
  }

  async scan() {
    if (this.busy) {
      return;
    }

    this.busy =
      true;

    this.activeIssue =
      null;

    this.renderLoading();

    try {
      // Yield once so the loading state paints before a large
      // Vault scan. v0.8.0 intentionally performs no writes.
      await new Promise(
        (resolve) =>
          window.setTimeout(
            resolve,
            0
          )
      );

      await this.library
        .loadPapers({
          syncBibliography:
            false,
        });

      this.report =
        this.library
          .maintenanceScan();

      this.renderOverview();
    }
    catch (error) {
      this.renderError(
        error
      );
    }
    finally {
      this.busy =
        false;
    }
  }

  renderHeader(
    {
      back = false,
      title = "Maintenance",
      subtitle = "",
      backAction = null,
    } = {}
  ) {
    const header =
      this.contentEl.createDiv({
        cls:
          "rl-maintenance-header",
      });

    const leading =
      header.createDiv({
        cls:
          "rl-maintenance-header-leading",
      });

    if (back) {
      const backButton =
        leading.createEl(
          "button",
          {
            cls:
              "rl-maintenance-icon-button",
            attr: {
              type:
                "button",
              title:
                "Back",
            },
          }
        );

      this.library.createIcon(
        backButton,
        "arrow-left"
      );

      backButton.addEventListener(
        "click",
        () => {
          if (backAction) {
            backAction();
            return;
          }

          this.activeIssue =
            null;

          this.renderOverview();
        }
      );
    }
    else {
      const icon =
        leading.createSpan({
          cls:
            "rl-maintenance-heading-icon",
        });

      this.library.createIcon(
        icon,
        "wrench"
      );
    }

    const text =
      leading.createDiv({
        cls:
          "rl-maintenance-heading-text",
      });

    text.createDiv({
      cls:
        "rl-maintenance-title",
      text:
        title,
    });

    if (subtitle) {
      text.createDiv({
        cls:
          "rl-maintenance-subtitle",
        text:
          subtitle,
      });
    }

    const actions =
      header.createDiv({
        cls:
          "rl-maintenance-header-actions",
      });

    if (!back) {
      const rescan =
        actions.createEl(
          "button",
          {
            cls:
              "rl-maintenance-rescan",
            attr: {
              type:
                "button",
              title:
                "Rescan",
            },
          }
        );

      this.library.createIcon(
        rescan,
        "rotate-ccw"
      );

      rescan.createSpan({
        text:
          "Rescan",
      });

      rescan.addEventListener(
        "click",
        () => {
          void this.scan();
        }
      );
    }

    return header;
  }

  renderLoading() {
    this.contentEl.empty();

    this.renderHeader();

    const loading =
      this.contentEl.createDiv({
        cls:
          "rl-maintenance-loading",
      });

    const icon =
      loading.createSpan({
        cls:
          "rl-maintenance-loading-icon",
      });

    this.library.createIcon(
      icon,
      "loader-circle"
    );

    loading.createSpan({
      text:
        "Scanning…",
    });
  }

  renderError(error) {
    this.contentEl.empty();

    this.renderHeader();

    const state =
      this.contentEl.createDiv({
        cls:
          "rl-maintenance-empty is-error",
      });

    const icon =
      state.createSpan();

    this.library.createIcon(
      icon,
      "triangle-alert"
    );

    state.createDiv({
      text:
        error?.message
        || "Scan failed",
    });
  }

  categoryCount(
    category
  ) {
    return Number(
      category?.count
      || 0
    );
  }

  renderOverview() {
    if (!this.report) {
      this.renderLoading();
      return;
    }

    this.contentEl.empty();

    this.renderHeader({
      subtitle:
        `${this.report.papers.length} Papers · ${this.report.pdfFiles.length} PDFs`,
    });

    const summary =
      this.contentEl.createDiv({
        cls:
          "rl-maintenance-summary",
      });

    const summaryItems = [
      {
        label:
          "Papers",
        value:
          this.report.papers
            .length,
      },
      {
        label:
          "PDFs",
        value:
          this.report.pdfFiles
            .length,
      },
      {
        label:
          "Findings",
        value:
          this.report
            .totalFindings,
      },
    ];

    for (
      const item
      of summaryItems
    ) {
      const card =
        summary.createDiv({
          cls:
            "rl-maintenance-summary-item",
        });

      card.createDiv({
        cls:
          "rl-maintenance-summary-value",
        text:
          String(
            item.value
          ),
      });

      card.createDiv({
        cls:
          "rl-maintenance-summary-label",
        text:
          item.label,
      });
    }

    const safeFixes =
      this.library
        .maintenanceSafeFixPlan(
          this.report
        );

    if (safeFixes.length) {
      const strip =
        this.contentEl.createDiv({
          cls:
            "rl-maintenance-safe-strip",
        });

      const identity =
        strip.createDiv({
          cls:
            "rl-maintenance-safe-strip-identity",
        });

      const icon =
        identity.createSpan({
          cls:
            "rl-maintenance-safe-strip-icon",
        });

      this.library.createIcon(
        icon,
        "badge-check"
      );

      identity.createSpan({
        cls:
          "rl-maintenance-safe-strip-title",
        text:
          "Safe fixes",
      });

      identity.createSpan({
        cls:
          "rl-maintenance-safe-strip-count",
        text:
          String(
            safeFixes.length
          ),
      });

      const review =
        strip.createEl(
          "button",
          {
            cls:
              "rl-maintenance-safe-review",
            attr: {
              type:
                "button",
            },
          }
        );

      review.createSpan({
        text:
          "Review",
      });

      this.library.createIcon(
        review,
        "chevron-right"
      );

      review.addEventListener(
        "click",
        () => {
          this.safeFixSelection =
            new Set(
              safeFixes.map(
                (task) =>
                  task.id
              )
            );

          this.renderSafeFixes(
            safeFixes
          );
        }
      );
    }

    const grid =
      this.contentEl.createDiv({
        cls:
          "rl-maintenance-grid",
      });

    for (
      const category
      of this.report
        .categoryList
    ) {
      this.renderCategoryCard(
        grid,
        category
      );
    }
  }

  renderSafeFixes(
    tasks = null
  ) {
    const plan =
      tasks
      || this.library
        .maintenanceSafeFixPlan(
          this.report
        );

    this.contentEl.empty();

    this.renderHeader({
      back:
        true,
      title:
        "Safe fixes",
      subtitle:
        `${plan.length} ${
          plan.length === 1
            ? "fix"
            : "fixes"
        }`,
    });

    if (!plan.length) {
      const empty =
        this.contentEl.createDiv({
          cls:
            "rl-maintenance-empty",
        });

      const icon =
        empty.createSpan();

      this.library.createIcon(
        icon,
        "circle-check"
      );

      empty.createDiv({
        text:
          "Clean",
      });

      return;
    }

    const list =
      this.contentEl.createDiv({
        cls:
          "rl-maintenance-safe-list",
      });

    for (
      const task
      of plan
    ) {
      const selected =
        this.safeFixSelection
          .has(
            task.id
          );

      const row =
        list.createEl(
          "button",
          {
            cls:
              `rl-maintenance-safe-row${
                selected
                  ? " is-selected"
                  : ""
              }`,
            attr: {
              type:
                "button",
            },
          }
        );

      const check =
        row.createSpan({
          cls:
            "rl-maintenance-safe-check",
        });

      this.library.createIcon(
        check,
        selected
          ? "square-check-big"
          : "square"
      );

      const icon =
        row.createSpan({
          cls:
            "rl-maintenance-safe-icon",
        });

      this.library.createIcon(
        icon,
        task.icon
        || "wrench"
      );

      const body =
        row.createDiv({
          cls:
            "rl-maintenance-safe-body",
        });

      body.createDiv({
        cls:
          "rl-maintenance-safe-title",
        text:
          task.target,
      });

      body.createDiv({
        cls:
          "rl-maintenance-safe-meta",
        text:
          `${task.label} · ${task.detail}`,
      });

      row.addEventListener(
        "click",
        () => {
          if (
            this.safeFixSelection
              .has(
                task.id
              )
          ) {
            this.safeFixSelection
              .delete(
                task.id
              );
          }
          else {
            this.safeFixSelection
              .add(
                task.id
              );
          }

          this.renderSafeFixes(
            plan
          );
        }
      );
    }

    const footer =
      this.contentEl.createDiv({
        cls:
          "rl-maintenance-safe-footer",
      });

    footer.createDiv({
      cls:
        "rl-maintenance-safe-footer-state",
      text:
        `${this.safeFixSelection.size} selected`,
    });

    const actions =
      footer.createDiv({
        cls:
          "rl-maintenance-safe-footer-actions",
      });

    const selectAll =
      actions.createEl(
        "button",
        {
          text:
            this.safeFixSelection
              .size === plan.length
              ? "Clear"
              : "Select all",
          attr: {
            type:
              "button",
          },
        }
      );

    selectAll.addEventListener(
      "click",
      () => {
        if (
          this.safeFixSelection
            .size === plan.length
        ) {
          this.safeFixSelection
            .clear();
        }
        else {
          this.safeFixSelection =
            new Set(
              plan.map(
                (task) =>
                  task.id
              )
            );
        }

        this.renderSafeFixes(
          plan
        );
      }
    );

    const apply =
      actions.createEl(
        "button",
        {
          cls:
            "mod-cta",
          text:
            "Apply",
          attr: {
            type:
              "button",
          },
        }
      );

    apply.disabled =
      !this.safeFixSelection
        .size;

    apply.addEventListener(
      "click",
      async () => {
        if (
          !this.safeFixSelection
            .size
        ) {
          return;
        }

        const selected =
          plan.filter(
            (task) =>
              this.safeFixSelection
                .has(
                  task.id
                )
          );

        apply.disabled =
          true;

        selectAll.disabled =
          true;

        try {
          const result =
            await this.library
              .maintenanceApplySafeFixes(
                selected
              );

          new Notice(
            `Safe fixes 已应用 · ${result.applied}`,
            4500
          );

          this.safeFixSelection
            .clear();

          await this.scan();
        }
        catch (error) {
          new Notice(
            error?.message
            || "Safe fixes failed",
            8000
          );

          this.renderSafeFixes(
            plan
          );
        }
      }
    );
  }

  renderCategoryCard(
    parent,
    category
  ) {
    const card =
      parent.createDiv({
        cls:
          `rl-maintenance-card${
            category.count
              ? ""
              : " is-clean"
          }`,
      });

    const head =
      card.createDiv({
        cls:
          "rl-maintenance-card-head",
      });

    const identity =
      head.createDiv({
        cls:
          "rl-maintenance-card-identity",
      });

    const icon =
      identity.createSpan({
        cls:
          "rl-maintenance-card-icon",
      });

    this.library.createIcon(
      icon,
      category.icon
    );

    identity.createSpan({
      cls:
        "rl-maintenance-card-title",
      text:
        category.label,
    });

    const count =
      head.createSpan({
        cls:
          `rl-maintenance-card-count${
            category.count
              ? ""
              : " is-zero"
          }`,
        text:
          String(
            category.count
          ),
      });

    if (!category.count) {
      count.setAttribute(
        "title",
        "Clean"
      );
    }

    const rows =
      card.createDiv({
        cls:
          "rl-maintenance-card-rows",
      });

    for (
      const issue
      of category.issues
    ) {
      const button =
        rows.createEl(
          "button",
          {
            cls:
              `rl-maintenance-issue-row${
                issue.count
                  ? ""
                  : " is-zero"
              }`,
            attr: {
              type:
                "button",
            },
          }
        );

      const issueIcon =
        button.createSpan({
          cls:
            "rl-maintenance-issue-icon",
        });

      this.library.createIcon(
        issueIcon,
        issue.icon
      );

      button.createSpan({
        cls:
          "rl-maintenance-issue-label",
        text:
          issue.label,
      });

      button.createSpan({
        cls:
          "rl-maintenance-issue-count",
        text:
          String(
            issue.count
          ),
      });

      if (issue.count) {
        this.library.createIcon(
          button,
          "chevron-right",
          "rl-maintenance-issue-chevron"
        );

        button.addEventListener(
          "click",
          () => {
            this.activeIssue =
              issue;

            this.renderIssue(
              issue
            );
          }
        );
      }
      else {
        button.disabled =
          true;
      }
    }
  }

  renderIssue(
    issue
  ) {
    if (
      issue.category === "metadata"
    ) {
      this.renderMetadataIssue(
        issue
      );

      return;
    }

    this.contentEl.empty();

    this.renderHeader({
      back:
        true,
      title:
        issue.label,
      subtitle:
        `${issue.count} ${
          issue.count === 1
            ? "finding"
            : "findings"
        }`,
    });

    const list =
      this.contentEl.createDiv({
        cls:
          "rl-maintenance-detail-list",
      });

    if (!issue.count) {
      const empty =
        list.createDiv({
          cls:
            "rl-maintenance-empty",
        });

      const icon =
        empty.createSpan();

      this.library.createIcon(
        icon,
        "circle-check"
      );

      empty.createDiv({
        text:
          "Clean",
      });

      return;
    }

    for (
      const item
      of issue.items
    ) {
      if (
        item.kind
        === "duplicate-group"
      ) {
        this.renderDuplicateGroup(
          list,
          item
        );
      }
      else if (
        item.kind
        === "relation"
      ) {
        this.renderRelationItem(
          list,
          item
        );
      }
      else {
        this.renderMaintenanceItem(
          list,
          item
        );
      }
    }
  }

  metadataIssuePapers(
    issue
  ) {
    const papers = [];
    const seen = new Set();

    for (
      const item
      of issue?.items || []
    ) {
      const candidates =
        item.kind === "duplicate-group"
          ? item.papers || []
          : item.papers?.length
            ? item.papers
            : item.paper
              ? [item.paper]
              : [];

      for (
        const paper
        of candidates
      ) {
        const path =
          paper?.file?.path;

        if (
          !path
          || seen.has(path)
        ) {
          continue;
        }

        seen.add(path);
        papers.push(paper);
      }
    }

    return papers;
  }

  refreshResultForPaper(
    paper
  ) {
    return this.refreshResults.get(
      paper?.file?.path || ""
    ) || null;
  }

  async queryMetadataPaper(
    paper,
    issue,
    {
      force = false,
    } = {}
  ) {
    const path =
      paper?.file?.path;

    if (!path) {
      return null;
    }

    const existing =
      this.refreshResults.get(
        path
      );

    if (
      !force
      && existing
      && existing.status === "ready"
    ) {
      return existing;
    }

    const state = {
      paper,
      status: "querying",
      progress: "Checking…",
      diffs: [],
      safeCount: 0,
      reviewCount: 0,
      changedCount: 0,
    };

    this.refreshResults.set(
      path,
      state
    );

    this.renderMetadataIssue(
      issue
    );

    try {
      const result =
        await this.library
          .maintenanceQueryPaperMetadata(
            paper,
            {
              onProgress:
                (message) => {
                  state.progress =
                    message
                    || "Checking…";

                  if (
                    this.activeIssue?.id
                    === issue.id
                  ) {
                    this.renderMetadataIssue(
                      issue
                    );
                  }
                },
            }
          );

      result.selection =
        result.selection
        || new Set(
          (result.diffs || [])
            .filter(
              (diff) =>
                diff.state === "changed"
                && diff.safe
            )
            .map(
              (diff) =>
                diff.key
            )
        );

      this.refreshResults.set(
        path,
        result
      );

      if (
        this.activeIssue?.id
        === issue.id
      ) {
        this.renderMetadataIssue(
          issue
        );
      }

      return result;
    }
    catch (error) {
      const failed = {
        paper,
        status: "error",
        error:
          error?.message
          || "Refresh failed",
        diffs: [],
        safeCount: 0,
        reviewCount: 0,
        changedCount: 0,
      };

      this.refreshResults.set(
        path,
        failed
      );

      if (
        this.activeIssue?.id
        === issue.id
      ) {
        this.renderMetadataIssue(
          issue
        );
      }

      return failed;
    }
  }

  async queryMetadataIssue(
    issue
  ) {
    if (this.refreshBatchBusy) {
      return;
    }

    const papers =
      this.metadataIssuePapers(
        issue
      );

    if (!papers.length) {
      return;
    }

    this.refreshBatchBusy =
      true;

    try {
      for (
        let index = 0;
        index < papers.length;
        index += 1
      ) {
        this.refreshBatchLabel =
          `${index + 1}/${papers.length}`;

        this.renderMetadataIssue(
          issue
        );

        await this.queryMetadataPaper(
          papers[index],
          issue
        );
      }
    }
    finally {
      this.refreshBatchBusy =
        false;

      this.refreshBatchLabel =
        "";

      this.renderMetadataIssue(
        issue
      );
    }
  }

  async applySafeMetadataIssue(
    issue
  ) {
    if (this.refreshBatchBusy) {
      return;
    }

    const papers =
      this.metadataIssuePapers(
        issue
      );

    const work =
      papers
        .map(
          (paper) => ({
            paper,
            result:
              this.refreshResultForPaper(
                paper
              ),
          })
        )
        .filter(
          ({ result }) =>
            result?.status === "ready"
            && result.safeCount > 0
        );

    if (!work.length) {
      return;
    }

    this.refreshBatchBusy =
      true;

    let applied = 0;
    const errors = [];

    try {
      for (
        let index = 0;
        index < work.length;
        index += 1
      ) {
        const {
          paper,
          result,
        } = work[index];

        this.refreshBatchLabel =
          `${index + 1}/${work.length}`;

        this.renderMetadataIssue(
          issue
        );

        const safeKeys =
          new Set(
            (result.diffs || [])
              .filter(
                (diff) =>
                  diff.state === "changed"
                  && diff.safe
              )
              .map(
                (diff) =>
                  diff.key
              )
          );

        try {
          await this.library
            .maintenanceApplyMetadataRefresh(
              paper,
              result,
              safeKeys
            );

          applied += 1;
        }
        catch (error) {
          errors.push({
            paper,
            error,
          });
        }
      }
    }
    finally {
      this.refreshBatchBusy =
        false;

      this.refreshBatchLabel =
        "";
    }

    if (errors.length) {
      console.error(
        "Research Library: maintenance safe refresh failures",
        errors
      );
    }

    new Notice(
      errors.length
        ? `${applied} 篇已更新 · ${errors.length} 篇失败`
        : `${applied} 篇已更新`,
      errors.length
        ? 7000
        : 4000
    );

    await this.refreshAfterMetadataApply();
  }

  async refreshAfterMetadataApply() {
    this.refreshResults.clear();

    try {
      await new Promise(
        (resolve) =>
          window.setTimeout(
            resolve,
            180
          )
      );

      await this.library
        .loadPapers();
    }
    catch (error) {
      console.debug(
        "Research Library: post-refresh Paper reload skipped",
        error
      );
    }

    this.report =
      this.library
        .maintenanceBuildReport(
          this.library.papers,
          this.library
            .maintenancePdfSnapshot()
        );

    this.activeIssue =
      null;

    this.renderOverview();
  }

  metadataResultStatus(
    result
  ) {
    if (!result) {
      return {
        label: "Check",
        cls: "",
      };
    }

    if (
      result.status === "querying"
    ) {
      return {
        label:
          result.progress
          || "Checking…",
        cls: "is-querying",
      };
    }

    if (
      result.status === "error"
    ) {
      return {
        label: "Failed",
        cls: "is-error",
      };
    }

    if (
      result.status === "no-match"
    ) {
      return {
        label: "No match",
        cls: "is-review",
      };
    }

    if (
      result.safeCount > 0
    ) {
      return {
        label:
          `${result.safeCount} safe`,
        cls: "is-safe",
      };
    }

    if (
      result.reviewCount > 0
    ) {
      return {
        label:
          `${result.reviewCount} review`,
        cls: "is-review",
      };
    }

    return {
      label: "Same",
      cls: "is-same",
    };
  }

  renderMetadataIssue(
    issue
  ) {
    this.activeIssue =
      issue;

    this.contentEl.empty();

    const papers =
      this.metadataIssuePapers(
        issue
      );

    this.renderHeader({
      back: true,
      title:
        issue.label,
      subtitle:
        `${papers.length} ${
          papers.length === 1
            ? "paper"
            : "papers"
        }`,
    });

    const toolbar =
      this.contentEl.createDiv({
        cls:
          "rl-maintenance-refresh-toolbar",
      });

    const progress =
      toolbar.createDiv({
        cls:
          "rl-maintenance-refresh-progress",
        text:
          this.refreshBatchBusy
            ? this.refreshBatchLabel
            : "",
      });

    const actions =
      toolbar.createDiv({
        cls:
          "rl-maintenance-refresh-actions",
      });

    const checked =
      papers.filter(
        (paper) => {
          const result =
            this.refreshResultForPaper(
              paper
            );

          return result
            && [
              "ready",
              "no-match",
              "error",
            ].includes(
              result.status
            );
        }
      ).length;

    const safeTotal =
      papers.reduce(
        (total, paper) =>
          total
          + Number(
              this.refreshResultForPaper(
                paper
              )?.safeCount
              || 0
            ),
        0
      );

    if (
      checked
      && !this.refreshBatchBusy
    ) {
      progress.setText(
        `${checked}/${papers.length} checked`
      );
    }

    const checkAll =
      actions.createEl(
        "button",
        {
          cls:
            "rl-maintenance-refresh-button",
          attr: {
            type: "button",
          },
        }
      );

    this.library.createIcon(
      checkAll,
      "search"
    );

    checkAll.createSpan({
      text:
        checked === papers.length
          ? "Recheck all"
          : "Check all",
    });

    checkAll.disabled =
      this.refreshBatchBusy;

    checkAll.addEventListener(
      "click",
      () => {
        if (
          checked === papers.length
        ) {
          for (
            const paper
            of papers
          ) {
            this.refreshResults.delete(
              paper.file.path
            );
          }
        }

        void this.queryMetadataIssue(
          issue
        );
      }
    );

    const applySafe =
      actions.createEl(
        "button",
        {
          cls:
            "rl-maintenance-refresh-button mod-cta",
          attr: {
            type: "button",
          },
        }
      );

    this.library.createIcon(
      applySafe,
      "check-check"
    );

    applySafe.createSpan({
      text:
        safeTotal
          ? `Apply safe · ${safeTotal}`
          : "Apply safe",
    });

    applySafe.disabled =
      this.refreshBatchBusy
      || !safeTotal;

    applySafe.addEventListener(
      "click",
      () => {
        void this.applySafeMetadataIssue(
          issue
        );
      }
    );

    const list =
      this.contentEl.createDiv({
        cls:
          "rl-maintenance-refresh-list",
      });

    for (
      const paper
      of papers
    ) {
      const result =
        this.refreshResultForPaper(
          paper
        );

      const row =
        list.createDiv({
          cls:
            `rl-maintenance-refresh-row${
              result?.status === "ready"
                ? " is-ready"
                : result?.status === "querying"
                  ? " is-querying"
                  : ""
            }`,
        });

      const main =
        row.createEl(
          "button",
          {
            cls:
              "rl-maintenance-refresh-main",
            attr: {
              type: "button",
            },
          }
        );

      const body =
        main.createDiv({
          cls:
            "rl-maintenance-refresh-body",
        });

      body.createDiv({
        cls:
          "rl-maintenance-refresh-title",
        text:
          paper.title,
      });

      body.createDiv({
        cls:
          "rl-maintenance-refresh-meta",
        text:
          this.paperMetaLine(
            paper
          ),
      });

      const status =
        this.metadataResultStatus(
          result
        );

      main.createSpan({
        cls:
          `rl-maintenance-refresh-status ${status.cls}`,
        text:
          status.label,
      });

      const affordance =
        main.createSpan({
          cls:
            "rl-maintenance-refresh-affordance",
        });

      this.library.createIcon(
        affordance,
        result?.status === "ready"
          ? "chevron-right"
          : result?.status === "querying"
            ? "loader-circle"
            : "refresh-cw"
      );

      if (
        result?.status === "querying"
      ) {
        affordance.addClass(
          "is-spinning"
        );
      }

      main.disabled =
        this.refreshBatchBusy
        || result?.status === "querying";

      main.addEventListener(
        "click",
        () => {
          if (
            result?.status === "ready"
          ) {
            this.renderMetadataDiff(
              paper,
              result,
              issue
            );

            return;
          }

          void this.queryMetadataPaper(
            paper,
            issue,
            {
              force: true,
            }
          );
        }
      );
    }
  }

  renderMetadataDiff(
    paper,
    result,
    issue
  ) {
    this.contentEl.empty();

    const source =
      result.sources?.length
        ? result.sources.join(" + ")
        : result.candidate
            ?.metadataSource
          || "Scholarly sources";

    const subtitle =
      [
        source,
        result.matchPercent
          ? `${Math.round(
              result.matchPercent
            )}%`
          : "",
      ]
        .filter(Boolean)
        .join(" · ");

    this.renderHeader({
      back: true,
      backAction:
        () =>
          this.renderMetadataIssue(
            issue
          ),
      title:
        paper.alias
        || paper.title,
      subtitle,
    });

    const columns =
      this.contentEl.createDiv({
        cls:
          "rl-maintenance-diff-columns",
      });

    columns.createDiv({
      cls:
        "rl-maintenance-diff-columns-field",
      text:
        "Field",
    });

    const valueColumns =
      columns.createDiv({
        cls:
          "rl-maintenance-diff-columns-values",
      });

    valueColumns.createSpan({
      text:
        "Current",
    });

    valueColumns.createSpan({
      text:
        "Found",
    });

    columns.createSpan({
      cls:
        "rl-maintenance-diff-columns-action",
      text:
        "Action",
    });

    const list =
      this.contentEl.createDiv({
        cls:
          "rl-maintenance-diff-list",
      });

    for (
      const diff
      of result.diffs || []
    ) {
      this.renderMetadataDiffRow(
        list,
        diff,
        result
      );
    }

    const footer =
      this.contentEl.createDiv({
        cls:
          "rl-maintenance-diff-footer",
      });

    const left =
      footer.createDiv({
        cls:
          "rl-maintenance-diff-footer-left",
      });

    const open =
      left.createEl(
        "button",
        {
          cls:
            "rl-maintenance-refresh-button",
          attr: {
            type: "button",
          },
        }
      );

    this.library.createIcon(
      open,
      "external-link"
    );

    open.createSpan({
      text: "Open Note",
    });

    open.addEventListener(
      "click",
      async () => {
        await this.app.workspace
          .getLeaf("tab")
          .openFile(
            paper.file
          );
      }
    );

    const right =
      footer.createDiv({
        cls:
          "rl-maintenance-diff-footer-right",
      });

    const selectedCount =
      (result.diffs || [])
        .filter(
          (diff) =>
            diff.state === "changed"
            && result.selection?.has(
              diff.key
            )
        ).length;

    const apply =
      right.createEl(
        "button",
        {
          cls:
            "rl-maintenance-refresh-button mod-cta",
          attr: {
            type: "button",
          },
        }
      );

    this.library.createIcon(
      apply,
      "check"
    );

    apply.createSpan({
      text:
        selectedCount
          ? `Apply · ${selectedCount}`
          : "Apply",
    });

    apply.disabled =
      !selectedCount;

    apply.addEventListener(
      "click",
      async () => {
        apply.disabled =
          true;

        try {
          await this.library
            .maintenanceApplyMetadataRefresh(
              paper,
              result,
              result.selection
                || new Set()
            );

          new Notice(
            "Metadata 已更新",
            3500
          );

          await this.refreshAfterMetadataApply();
        }
        catch (error) {
          apply.disabled =
            false;

          new Notice(
            error?.message
            || "Metadata refresh failed",
            7000
          );
        }
      }
    );
  }

  renderMetadataDiffRow(
    parent,
    diff,
    result
  ) {
    const changed =
      diff.state === "changed";

    const selected =
      changed
      && result.selection?.has(
        diff.key
      );

    const row =
      parent.createDiv({
        cls:
          `rl-maintenance-diff-row${
            changed
              ? " is-changed"
              : " is-same"
          }${
            diff.safe
              ? " is-safe"
              : ""
          }`,
      });

    row.createDiv({
      cls:
        "rl-maintenance-diff-label",
      text:
        diff.label,
    });

    const values =
      row.createDiv({
        cls:
          "rl-maintenance-diff-values",
      });

    values.createDiv({
      cls:
        "rl-maintenance-diff-current",
      text:
        this.library
          .maintenanceRefreshDisplayValue(
            diff.key,
            diff.current
          )
        || "—",
    });

    const arrow =
      values.createSpan({
        cls:
          "rl-maintenance-diff-arrow",
      });

    this.library.createIcon(
      arrow,
      "arrow-right"
    );

    values.createDiv({
      cls:
        "rl-maintenance-diff-found",
      text:
        this.library
          .maintenanceRefreshDisplayValue(
            diff.key,
            diff.found
          )
        || "—",
    });

    const state =
      row.createEl(
        "button",
        {
          cls:
            `rl-maintenance-diff-state${
              changed
                ? selected
                  ? " is-update"
                  : " is-keep"
                : " is-same"
            }${
              diff.safe
                ? " is-safe"
                : ""
            }`,
          text:
            changed
              ? selected
                ? "Update"
                : "Keep"
              : "Same",
          attr: {
            type: "button",
          },
        }
      );

    state.disabled =
      !changed;

    if (changed) {
      state.addEventListener(
        "click",
        () => {
          result.selection =
            result.selection
            || new Set();

          if (
            result.selection.has(
              diff.key
            )
          ) {
            result.selection.delete(
              diff.key
            );
          }
          else {
            result.selection.add(
              diff.key
            );
          }

          this.renderMetadataDiff(
            result.paper,
            result,
            this.activeIssue
          );
        }
      );
    }
  }

  paperMetaLine(
    paper
  ) {
    return [
      paper.alias
        || "",
      paper.year
        || "",
      paper.venue
        || "",
      paper.citekey
        || "",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  renderMaintenanceItem(
    parent,
    item
  ) {
    const row =
      parent.createDiv({
        cls:
          "rl-maintenance-detail-row",
      });

    const main =
      row.createDiv({
        cls:
          "rl-maintenance-detail-main",
      });

    const icon =
      main.createSpan({
        cls:
          "rl-maintenance-detail-icon",
      });

    this.library.createIcon(
      icon,
      item.kind === "file"
        ? "file"
        : "file-text"
    );

    const body =
      main.createDiv({
        cls:
          "rl-maintenance-detail-body",
      });

    body.createDiv({
      cls:
        "rl-maintenance-detail-title",
      text:
        item.title || "Item",
    });

    const detail =
      item.detail
      || (
        item.paper
          ? this.paperMetaLine(
              item.paper
            )
          : ""
      );

    if (detail) {
      body.createDiv({
        cls:
          "rl-maintenance-detail-meta",
        text:
          detail,
      });
    }

    const actions =
      row.createDiv({
        cls:
          "rl-maintenance-detail-actions",
      });

    const target =
      item.kind === "file"
        ? item.file
        : item.paper?.file;

    if (
      target instanceof TFile
    ) {
      const open =
        actions.createEl(
          "button",
          {
            cls:
              "rl-maintenance-icon-button",
            attr: {
              type:
                "button",
              title:
                item.kind === "file"
                  ? "Open PDF"
                  : "Open Note",
            },
          }
        );

      this.library.createIcon(
        open,
        item.kind === "file"
          ? "file-up"
          : "external-link"
      );

      open.addEventListener(
        "click",
        async () => {
          await this.app.workspace
            .getLeaf("tab")
            .openFile(
              target
            );
        }
      );
    }

    if (
      item.paper
    ) {
      const pdf =
        this.library
          .maintenancePaperPdfFile(
            item.paper
          );

      if (
        pdf instanceof TFile
      ) {
        const pdfButton =
          actions.createEl(
            "button",
            {
              cls:
                "rl-maintenance-icon-button",
              attr: {
                type:
                  "button",
                title:
                  "Open PDF",
              },
            }
          );

        this.library.createIcon(
          pdfButton,
          "file-text"
        );

        pdfButton.addEventListener(
          "click",
          async () => {
            await this.app.workspace
              .getLeaf("tab")
              .openFile(
                pdf
              );
          }
        );
      }
    }
  }

  renderDuplicateGroup(
    parent,
    group
  ) {
    const card =
      parent.createDiv({
        cls:
          "rl-maintenance-duplicate-group",
      });

    const head =
      card.createDiv({
        cls:
          "rl-maintenance-duplicate-head",
      });

    const identity =
      head.createDiv({
        cls:
          "rl-maintenance-duplicate-identity",
      });

    const icon =
      identity.createSpan();

    this.library.createIcon(
      icon,
      "copy"
    );

    identity.createSpan({
      text:
        `${group.papers.length} papers`,
    });

    const headRight =
      head.createDiv({
        cls:
          "rl-maintenance-duplicate-head-right",
      });

    if (group.detail) {
      headRight.createSpan({
        cls:
          "rl-maintenance-duplicate-reason",
        text:
          group.detail,
      });
    }

    const review =
      headRight.createEl(
        "button",
        {
          cls:
            "rl-maintenance-duplicate-review",
          attr: {
            type:
              "button",
          },
        }
      );

    this.library.createIcon(
      review,
      "git-merge"
    );

    review.createSpan({
      text:
        "Review merge",
    });

    review.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        new DuplicateMergeModal(
          this.app,
          {
            library:
              this.library,
            papers:
              group.papers,
            reason:
              group.detail || "",
            onMerged:
              async () => {
                await this.scan();
              },
          }
        ).open();
      }
    );

    const papers =
      card.createDiv({
        cls:
          "rl-maintenance-duplicate-papers",
      });

    for (
      const paper
      of group.papers
    ) {
      this.renderMaintenanceItem(
        papers,
        {
          kind:
            "paper",
          paper,
          title:
            paper.title,
          detail:
            this.paperMetaLine(
              paper
            ),
        }
      );
    }
  }

  renderRelationItem(
    parent,
    item
  ) {
    const card =
      parent.createDiv({
        cls:
          "rl-maintenance-relation",
      });

    const head =
      card.createDiv({
        cls:
          "rl-maintenance-relation-head",
      });

    const icon =
      head.createSpan();

    this.library.createIcon(
      icon,
      item.type === "topic"
        ? "tags"
        : item.type === "project"
          ? "folder-kanban"
          : "list"
    );

    head.createSpan({
      cls:
        "rl-maintenance-relation-title",
      text:
        item.title,
    });

    head.createSpan({
      cls:
        "rl-maintenance-relation-count",
      text:
        String(
          item.papers.length
        ),
    });

    const papers =
      card.createDiv({
        cls:
          "rl-maintenance-relation-papers",
      });

    for (
      const paper
      of item.papers.slice(
        0,
        6
      )
    ) {
      const row =
        papers.createEl(
          "button",
          {
            cls:
              "rl-maintenance-relation-paper",
            text:
              paper.title,
            attr: {
              type:
                "button",
            },
          }
        );

      row.addEventListener(
        "click",
        async () => {
          await this.app.workspace
            .getLeaf("tab")
            .openFile(
              paper.file
            );
        }
      );
    }

    if (
      item.papers.length > 6
    ) {
      papers.createDiv({
        cls:
          "rl-maintenance-relation-more",
        text:
          `+${item.papers.length - 6}`,
      });
    }
  }
}


class DuplicateMergeModal extends Modal {
  constructor(
    app,
    {
      library,
      papers,
      reason = "",
      onMerged = null,
    }
  ) {
    super(app);

    this.library =
      library;

    this.papers =
      papers || [];

    this.reason =
      reason;

    this.onMerged =
      onMerged;

    this.masterPath =
      "";

    this.context =
      null;

    this.resolutions =
      new Map();

    this.selectedPdfPath =
      "";

    this.loading =
      false;

    this.merging =
      false;
  }

  applyAppearanceSettings() {
    const settings =
      this.library?.plugin
        ?.settings || {};

    const source =
      String(
        settings.fontSource
        || "obsidian-interface"
      );

    let family =
      "var(--font-interface)";

    if (
      source
      === "obsidian-text"
    ) {
      family =
        "var(--font-text)";
    }
    else if (
      source
      === "obsidian-monospace"
    ) {
      family =
        "var(--font-monospace)";
    }
    else if (
      source.startsWith(
        "system:"
      )
    ) {
      const systemFamily =
        source
          .slice(
            "system:".length
          )
          .trim();

      if (systemFamily) {
        family =
          `"${systemFamily.replace(
            /"/g,
            '\\"'
          )}", sans-serif`;
      }
    }

    const size =
      Math.max(
        10,
        Math.min(
          20,
          Number(
            settings.fontSize
          ) || 13
        )
      );

    this.modalEl.style
      .setProperty(
        "--rl-font-family",
        family
      );

    this.modalEl.style
      .setProperty(
        "--rl-font-size",
        `${size}px`
      );
  }

  onOpen() {
    this.modalEl.addClass(
      "rl-duplicate-merge-modal"
    );

    this.applyAppearanceSettings();

    const master =
      this.library
        .duplicateMergeDefaultMaster(
          this.papers
        );

    this.masterPath =
      master?.file?.path
      || "";

    void this.loadContext();
  }

  onClose() {
    this.contentEl.empty();
  }

  async loadContext() {
    if (this.loading) {
      return;
    }

    this.loading =
      true;

    this.renderLoading();

    try {
      this.context =
        await this.library
          .duplicateMergeBuildContext(
            this.papers,
            this.masterPath
          );

      this.masterPath =
        this.context
          .master.file.path;

      this.selectedPdfPath =
        this.context
          .selectedPdfPath;

      this.resolutions =
        new Map();

      this.render();
    }
    catch (error) {
      this.renderError(
        error
      );
    }
    finally {
      this.loading =
        false;
    }
  }

  renderLoading() {
    this.contentEl.empty();

    const state =
      this.contentEl.createDiv({
        cls:
          "rl-duplicate-merge-state",
      });

    const icon =
      state.createSpan({
        cls:
          "rl-duplicate-merge-spinner",
      });

    this.library.createIcon(
      icon,
      "loader-circle"
    );

    state.createSpan({
      text:
        "Preparing merge…",
    });
  }

  renderError(error) {
    this.contentEl.empty();

    const state =
      this.contentEl.createDiv({
        cls:
          "rl-duplicate-merge-state is-error",
      });

    const icon =
      state.createSpan();

    this.library.createIcon(
      icon,
      "triangle-alert"
    );

    state.createSpan({
      text:
        error?.message
        || "Merge review failed",
    });
  }

  displayValue(
    value,
    {
      limit = 160,
    } = {}
  ) {
    if (
      Array.isArray(value)
    ) {
      return value
        .join(" · ");
    }

    if (
      value === null
      || value === undefined
      || value === ""
    ) {
      return "—";
    }

    const text =
      String(value)
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    return text.length > limit
      ? `${text.slice(
          0,
          limit
        )}…`
      : text;
  }

  paperLabel(
    paper
  ) {
    return (
      paper.alias
      || paper.citekey
      || paper.file.basename
    );
  }

  renderHeader() {
    const header =
      this.contentEl.createDiv({
        cls:
          "rl-duplicate-merge-header",
      });

    const icon =
      header.createSpan({
        cls:
          "rl-duplicate-merge-heading-icon",
      });

    this.library.createIcon(
      icon,
      "git-merge"
    );

    const text =
      header.createDiv({
        cls:
          "rl-duplicate-merge-heading",
      });

    text.createDiv({
      cls:
        "rl-duplicate-merge-title",
      text:
        "Merge duplicates",
    });

    text.createDiv({
      cls:
        "rl-duplicate-merge-subtitle",
      text:
        this.reason
        || `${this.papers.length} papers`,
    });
  }

  renderMasterSection(
    parent
  ) {
    const section =
      parent.createDiv({
        cls:
          "rl-duplicate-merge-section",
      });

    section.createDiv({
      cls:
        "rl-duplicate-merge-section-title",
      text:
        "Master",
    });

    const list =
      section.createDiv({
        cls:
          "rl-duplicate-master-list",
      });

    for (
      const paper
      of this.context.papers
    ) {
      const selected =
        paper.file.path
        === this.masterPath;

      const button =
        list.createEl(
          "button",
          {
            cls:
              `rl-duplicate-master-card${
                selected
                  ? " is-selected"
                  : ""
              }`,
            attr: {
              type:
                "button",
            },
          }
        );

      const mark =
        button.createSpan({
          cls:
            "rl-duplicate-master-mark",
        });

      this.library.createIcon(
        mark,
        selected
          ? "circle-dot"
          : "circle"
      );

      const body =
        button.createDiv({
          cls:
            "rl-duplicate-master-body",
        });

      body.createDiv({
        cls:
          "rl-duplicate-master-title",
        text:
          paper.title,
      });

      body.createDiv({
        cls:
          "rl-duplicate-master-meta",
        text:
          [
            paper.alias,
            paper.year,
            paper.venue,
            paper.citekey,
          ]
            .filter(Boolean)
            .join(" · "),
      });

      if (
        paper.metadataVerified
      ) {
        const badge =
          button.createSpan({
            cls:
              "rl-duplicate-master-badge",
          });

        this.library.createIcon(
          badge,
          "badge-check"
        );
      }

      button.addEventListener(
        "click",
        () => {
          if (
            selected
            || this.merging
          ) {
            return;
          }

          this.masterPath =
            paper.file.path;

          void this.loadContext();
        }
      );
    }
  }

  renderMetadataSection(
    parent
  ) {
    const section =
      parent.createDiv({
        cls:
          "rl-duplicate-merge-section",
      });

    const head =
      section.createDiv({
        cls:
          "rl-duplicate-merge-section-head",
      });

    head.createDiv({
      cls:
        "rl-duplicate-merge-section-title",
      text:
        "Metadata",
    });

    head.createSpan({
      cls:
        "rl-duplicate-merge-count",
      text:
        String(
          this.context
            .metadataChanges
            .length
        ),
    });

    if (
      !this.context
        .metadataChanges.length
    ) {
      section.createDiv({
        cls:
          "rl-duplicate-merge-empty",
        text:
          "No changes",
      });

      return;
    }

    const rows =
      section.createDiv({
        cls:
          "rl-duplicate-metadata-rows",
      });

    for (
      const change
      of this.context
        .metadataChanges
    ) {
      const row =
        rows.createDiv({
          cls:
            "rl-duplicate-metadata-row",
        });

      row.createDiv({
        cls:
          "rl-duplicate-metadata-label",
        text:
          change.label,
      });

      row.createDiv({
        cls:
          "rl-duplicate-metadata-current",
        text:
          this.displayValue(
            change.current
          ),
        attr: {
          title:
            this.displayValue(
              change.current,
              {
                limit:
                  1000,
              }
            ),
        },
      });

      const arrow =
        row.createSpan({
          cls:
            "rl-duplicate-metadata-arrow",
        });

      this.library.createIcon(
        arrow,
        "arrow-right"
      );

      row.createDiv({
        cls:
          "rl-duplicate-metadata-found",
        text:
          this.displayValue(
            change.found
          ),
        attr: {
          title:
            this.displayValue(
              change.found,
              {
                limit:
                  1000,
              }
            ),
        },
      });
    }
  }

  renderUnionSection(
    parent
  ) {
    const values = [
      {
        label:
          "Topics",
        values:
          this.context.unions
            .topics,
        current:
          this.context.master
            .topics || [],
      },
      {
        label:
          "Projects",
        values:
          this.context.unions
            .projects,
        current:
          this.context.master
            .projects || [],
      },
      {
        label:
          "Lists",
        values:
          this.context.unions
            .collections,
        current:
          this.context.master
            .collections || [],
      },
      {
        label:
          "Keywords",
        values:
          this.context.unions
            .keywords,
        current:
          this.context.master
            .keywords || [],
      },
      {
        label:
          "Figures",
        values:
          this.context.unions
            .figures,
        current:
          this.context.master
            .figures || [],
      },
    ];

    const changed =
      values.filter(
        (item) =>
          !this.library
            .duplicateMergeValuesEqual(
              item.values,
              item.current
            )
      );

    if (!changed.length) {
      return;
    }

    const section =
      parent.createDiv({
        cls:
          "rl-duplicate-merge-section",
      });

    section.createDiv({
      cls:
        "rl-duplicate-merge-section-title",
      text:
        "Combine",
    });

    const chips =
      section.createDiv({
        cls:
          "rl-duplicate-union-chips",
      });

    for (
      const item
      of changed
    ) {
      const added =
        Math.max(
          0,
          item.values.length
          - item.current.length
        );

      chips.createSpan({
        cls:
          "rl-duplicate-union-chip",
        text:
          `${item.label} +${added}`,
      });
    }
  }

  conflictSelected(
    conflict
  ) {
    return this.resolutions
      .get(
        conflict.id
      )
      || "";
  }

  renderConflictSection(
    parent
  ) {
    const section =
      parent.createDiv({
        cls:
          "rl-duplicate-merge-section",
      });

    const head =
      section.createDiv({
        cls:
          "rl-duplicate-merge-section-head",
      });

    head.createDiv({
      cls:
        "rl-duplicate-merge-section-title",
      text:
        "Conflicts",
    });

    const unresolved =
      this.context.conflicts
        .filter(
          (conflict) =>
            !this.conflictSelected(
              conflict
            )
        )
        .length;

    head.createSpan({
      cls:
        `rl-duplicate-merge-count${
          unresolved
            ? " is-warning"
            : " is-clean"
        }`,
      text:
        String(
          unresolved
        ),
    });

    if (
      !this.context
        .conflicts.length
    ) {
      section.createDiv({
        cls:
          "rl-duplicate-merge-empty",
        text:
          "None",
      });

      return;
    }

    const list =
      section.createDiv({
        cls:
          "rl-duplicate-conflict-list",
      });

    for (
      const conflict
      of this.context.conflicts
    ) {
      const row =
        list.createDiv({
          cls:
            `rl-duplicate-conflict${
              this.conflictSelected(
                conflict
              )
                ? " is-resolved"
                : ""
            }`,
        });

      row.createDiv({
        cls:
          "rl-duplicate-conflict-label",
        text:
          conflict.label,
      });

      const options =
        row.createDiv({
          cls:
            "rl-duplicate-conflict-options",
      });

      for (
        const option
        of conflict.options
      ) {
        const selected =
          this.conflictSelected(
            conflict
          )
          === option.paper.file.path;

        const button =
          options.createEl(
            "button",
            {
              cls:
                `rl-duplicate-conflict-option${
                  selected
                    ? " is-selected"
                    : ""
                }`,
              attr: {
                type:
                  "button",
                title:
                  this.displayValue(
                    option.value,
                    {
                      limit:
                        1000,
                    }
                  ),
              },
            }
          );

        button.createSpan({
          cls:
            "rl-duplicate-conflict-source",
          text:
            this.paperLabel(
              option.paper
            ),
        });

        button.createSpan({
          cls:
            "rl-duplicate-conflict-preview",
          text:
            this.displayValue(
              option.value,
              {
                limit:
                  conflict.type
                  === "section"
                    ? 90
                    : 64,
              }
            ),
        });

        button.addEventListener(
          "click",
          () => {
            this.resolutions.set(
              conflict.id,
              option.paper.file.path
            );

            this.render();
          }
        );
      }
    }
  }

  renderPdfSection(
    parent
  ) {
    if (
      !this.context
        .pdfOptions.length
    ) {
      return;
    }

    const section =
      parent.createDiv({
        cls:
          "rl-duplicate-merge-section",
      });

    section.createDiv({
      cls:
        "rl-duplicate-merge-section-title",
      text:
        "PDF",
    });

    const list =
      section.createDiv({
        cls:
          "rl-duplicate-pdf-list",
      });

    for (
      const option
      of this.context
        .pdfOptions
    ) {
      const selected =
        option.path
        === this.selectedPdfPath;

      const button =
        list.createEl(
          "button",
          {
            cls:
              `rl-duplicate-pdf-option${
                selected
                  ? " is-selected"
                  : ""
              }`,
            attr: {
              type:
                "button",
            },
          }
        );

      const mark =
        button.createSpan({
          cls:
            "rl-duplicate-pdf-mark",
        });

      this.library.createIcon(
        mark,
        selected
          ? "circle-dot"
          : "circle"
      );

      const body =
        button.createDiv({
          cls:
            "rl-duplicate-pdf-body",
      });

      body.createDiv({
        cls:
          "rl-duplicate-pdf-name",
        text:
          option.file.name,
      });

      body.createDiv({
        cls:
          "rl-duplicate-pdf-meta",
        text:
          [
            ...option.owners.map(
              (paper) =>
                this.paperLabel(
                  paper
                )
            ),
            option.externalReferences
              ? `${option.externalReferences} external`
              : "",
          ]
            .filter(Boolean)
            .join(" · "),
      });

      button.addEventListener(
        "click",
        () => {
          if (
            this.merging
          ) {
            return;
          }

          this.selectedPdfPath =
            option.path;

          this.render();
        }
      );
    }
  }

  renderFooter(
    parent
  ) {
    const footer =
      parent.createDiv({
        cls:
          "rl-duplicate-merge-footer",
      });

    const state =
      footer.createDiv({
        cls:
          "rl-duplicate-merge-footer-state",
      });

    const unresolved =
      this.context.conflicts
        .filter(
          (conflict) =>
            !this.conflictSelected(
              conflict
            )
        )
        .length;

    state.createSpan({
      text:
        unresolved
          ? `${unresolved} unresolved`
          : `${this.context.sources.length} source ${
              this.context.sources.length === 1
                ? "note"
                : "notes"
            }`,
    });

    const actions =
      footer.createDiv({
        cls:
          "rl-duplicate-merge-footer-actions",
      });

    const cancel =
      actions.createEl(
        "button",
        {
          text:
            "Cancel",
          attr: {
            type:
              "button",
          },
        }
      );

    cancel.disabled =
      this.merging;

    cancel.addEventListener(
      "click",
      () =>
        this.close()
    );

    const merge =
      actions.createEl(
        "button",
        {
          cls:
            "mod-cta",
          text:
            this.merging
              ? "Merging…"
              : "Merge",
          attr: {
            type:
              "button",
          },
        }
      );

    merge.disabled =
      this.merging
      || unresolved > 0;

    merge.addEventListener(
      "click",
      () => {
        void this.commit();
      }
    );
  }

  render() {
    if (
      !this.context
    ) {
      this.renderLoading();
      return;
    }

    this.contentEl.empty();

    this.renderHeader();

    const body =
      this.contentEl.createDiv({
        cls:
          "rl-duplicate-merge-body",
      });

    this.renderMasterSection(
      body
    );

    this.renderMetadataSection(
      body
    );

    this.renderUnionSection(
      body
    );

    this.renderConflictSection(
      body
    );

    this.renderPdfSection(
      body
    );

    this.renderFooter(
      this.contentEl
    );
  }

  async commit() {
    if (
      this.merging
      || !this.context
    ) {
      return;
    }

    const unresolved =
      this.context.conflicts
        .filter(
          (conflict) =>
            !this.conflictSelected(
              conflict
            )
        );

    if (unresolved.length) {
      new Notice(
        "请先处理所有冲突。"
      );

      return;
    }

    this.merging =
      true;

    this.render();

    try {
      const result =
        await this.library
          .duplicateMergeApply(
            this.context,
            {
              resolutions:
                this.resolutions,
              selectedPdfPath:
                this.selectedPdfPath,
            }
          );

      this.close();

      new Notice(
        `Merge 完成 · ${result.archivedNotes.length} 个 Source Note 已归档${
          result.returnedPdfs.length
            ? ` · ${result.returnedPdfs.length} 个 PDF 已退回 Inbox`
            : ""
        }`,
        6500
      );

      if (this.onMerged) {
        await this.onMerged(
          result
        );
      }
    }
    catch (error) {
      this.merging =
        false;

      new Notice(
        error?.message
        || "Merge failed",
        8000
      );

      this.render();
    }
  }
}


class FigureVaultPickerModal extends Modal {
  constructor(
    app,
    {
      library,
      paper,
      onChoose,
    }
  ) {
    super(app);

    this.library =
      library;

    this.paper =
      paper;

    this.onChoose =
      onChoose;

    this.query =
      "";
  }

  onOpen() {
    this.modalEl.addClass(
      "rl-figure-picker-modal"
    );

    this.render();
  }

  onClose() {
    this.contentEl.empty();
  }

  imageFiles() {
    const current =
      new Set(
        this.library
          .figurePaths(
            this.paper
          )
          .map(
            (path) =>
              path.toLowerCase()
          )
      );

    const query =
      this.query
        .trim()
        .toLowerCase();

    return this.app.vault
      .getFiles()
      .filter(
        (file) =>
          this.library
            .isFigureFile(
              file
            )
      )
      .filter(
        (file) =>
          !current.has(
            file.path
              .toLowerCase()
          )
      )
      .filter(
        (file) =>
          !query
          || file.path
            .toLowerCase()
            .includes(
              query
            )
      )
      .slice(
        0,
        180
      );
  }

  render() {
    this.contentEl.empty();

    const header =
      this.contentEl.createDiv({
        cls:
          "rl-figure-picker-header",
      });

    header.createEl(
      "h2",
      {
        text:
          "Add from Vault",
      }
    );

    const search =
      this.contentEl.createEl(
        "input",
        {
          cls:
            "rl-figure-picker-search",
          attr: {
            type:
              "search",
            placeholder:
              "搜索图片…",
          },
        }
      );

    search.value =
      this.query;

    let timer =
      null;

    search.addEventListener(
      "input",
      () => {
        this.query =
          search.value;

        if (timer) {
          window.clearTimeout(
            timer
          );
        }

        timer =
          window.setTimeout(
            () => {
              timer =
                null;

              this.render();
            },
            90
          );
      }
    );

    const files =
      this.imageFiles();

    const list =
      this.contentEl.createDiv({
        cls:
          "rl-figure-picker-list",
      });

    if (!files.length) {
      list.createDiv({
        cls:
          "rl-figure-picker-empty",
        text:
          "没有可用图片",
      });

      window.setTimeout(
        () => {
          search.focus();
        },
        0
      );

      return;
    }

    for (
      const file
      of files
    ) {
      const button =
        list.createEl(
          "button",
          {
            cls:
              "rl-figure-picker-item",
            attr: {
              type:
                "button",
              title:
                file.path,
            },
          }
        );

      button.createEl(
        "img",
        {
          cls:
            "rl-figure-picker-thumb",
          attr: {
            src:
              this.library
                .figureResourcePath(
                  file
                ),
            alt:
              "",
            loading:
              "lazy",
          },
        }
      );

      const body =
        button.createDiv({
          cls:
            "rl-figure-picker-item-body",
        });

      body.createDiv({
        cls:
          "rl-figure-picker-name",
        text:
          file.name,
      });

      body.createDiv({
        cls:
          "rl-figure-picker-path",
        text:
          file.path,
      });

      button.addEventListener(
        "click",
        async () => {
          try {
            await this.onChoose?.(
              file
            );

            this.close();
          }
          catch (error) {
            new Notice(
              error?.message
              || "添加图片失败",
              6000
            );
          }
        }
      );
    }

    window.setTimeout(
      () => {
        search.focus();

        search.setSelectionRange(
          search.value.length,
          search.value.length
        );
      },
      0
    );
  }
}


class PaperFigureManagerModal extends Modal {
  constructor(
    app,
    {
      library,
      paper,
    }
  ) {
    super(app);

    this.library =
      library;

    this.paper =
      paper;

    this.busy =
      false;
  }

  onOpen() {
    this.modalEl.addClass(
      "rl-figure-manager-modal"
    );

    this.render();
  }

  onClose() {
    this.contentEl.empty();
  }

  render() {
    this.contentEl.empty();

    const header =
      this.contentEl.createDiv({
        cls:
          "rl-figure-manager-header",
      });

    const title =
      header.createDiv({
        cls:
          "rl-figure-manager-heading",
      });

    title.createEl(
      "h2",
      {
        text:
          "Figures",
      }
    );

    title.createDiv({
      cls:
        "rl-figure-manager-subtitle",
      text:
        this.paper.title,
    });

    const actions =
      header.createDiv({
        cls:
          "rl-figure-manager-actions",
      });

    const input =
      actions.createEl(
        "input",
        {
          cls:
            "rl-figure-file-input",
          attr: {
            type:
              "file",
            accept:
              "image/*,.svg,.webp,.bmp",
            multiple:
              "multiple",
          },
        }
      );

    const upload =
      actions.createEl(
        "button",
        {
          cls:
            "mod-cta",
          attr: {
            type:
              "button",
          },
        }
      );

    this.library.createIcon(
      upload,
      "image-plus"
    );

    upload.createSpan({
      text:
        "Add",
    });

    upload.addEventListener(
      "click",
      () => {
        input.click();
      }
    );

    input.addEventListener(
      "change",
      async () => {
        const files =
          [...(
            input.files || []
          )];

        input.value =
          "";

        if (!files.length) {
          return;
        }

        this.busy =
          true;

        this.render();

        try {
          await this.library
            .importLocalFigureFiles(
              this.paper,
              files
            );

          new Notice(
            `已添加 ${files.length} 张图`
          );
        }
        catch (error) {
          new Notice(
            error?.message
            || "导入图片失败",
            7000
          );
        }
        finally {
          this.busy =
            false;

          this.render();
        }
      }
    );

    const vault =
      actions.createEl(
        "button",
        {
          attr: {
            type:
              "button",
          },
        }
      );

    this.library.createIcon(
      vault,
      "folder-search"
    );

    vault.createSpan({
      text:
        "Vault",
    });

    vault.disabled =
      this.busy;

    vault.addEventListener(
      "click",
      () => {
        new FigureVaultPickerModal(
          this.app,
          {
            library:
              this.library,
            paper:
              this.paper,
            onChoose:
              async (file) => {
                await this.library
                  .updatePaperFigures(
                    this.paper,
                    [
                      ...this.library
                        .figurePaths(
                          this.paper
                        ),
                      file.path,
                    ]
                  );

                this.render();
              },
          }
        ).open();
      }
    );

    upload.disabled =
      this.busy;

    const entries =
      this.library
        .figureEntriesForPaper(
          this.paper
        );

    const list =
      this.contentEl.createDiv({
        cls:
          "rl-figure-manager-list",
      });

    if (!entries.length) {
      const empty =
        list.createDiv({
          cls:
            "rl-figure-manager-empty",
        });

      const icon =
        empty.createSpan();

      this.library.createIcon(
        icon,
        "image"
      );

      empty.createSpan({
        text:
          "No figures",
      });

      return;
    }

    for (
      const entry
      of entries
    ) {
      const row =
        list.createDiv({
          cls:
            "rl-figure-manager-row",
        });

      const thumb =
        row.createDiv({
          cls:
            "rl-figure-manager-thumb",
        });

      if (entry.file) {
        thumb.createEl(
          "img",
          {
            attr: {
              src:
                this.library
                  .figureResourcePath(
                    entry.file
                  ),
              alt:
                "",
              loading:
                "lazy",
            },
          }
        );
      }
      else {
        this.library.createIcon(
          thumb,
          "image-off"
        );
      }

      const body =
        row.createDiv({
          cls:
            "rl-figure-manager-row-body",
        });

      const head =
        body.createDiv({
          cls:
            "rl-figure-manager-row-head",
        });

      head.createDiv({
        cls:
          "rl-figure-manager-name",
        text:
          entry.file?.name
          || entry.path
            .split("/")
            .pop(),
      });

      if (
        entry.index === 0
      ) {
        head.createSpan({
          cls:
            "rl-figure-primary-badge",
          text:
            "Primary",
        });
      }

      body.createDiv({
        cls:
          "rl-figure-manager-path",
        text:
          entry.path,
      });

      const rowActions =
        row.createDiv({
          cls:
            "rl-figure-manager-row-actions",
        });

      if (
        entry.index > 0
      ) {
        const primary =
          rowActions.createEl(
            "button",
            {
              attr: {
                type:
                  "button",
                title:
                  "设为主图",
              },
            }
          );

        this.library.createIcon(
          primary,
          "pin"
        );

        primary.disabled =
          this.busy;

        primary.addEventListener(
          "click",
          async () => {
            this.busy =
              true;

            this.render();

            try {
              await this.library
                .setPrimaryFigure(
                  this.paper,
                  entry.index
                );
            }
            catch (error) {
              new Notice(
                error?.message
                || "设置主图失败",
                6000
              );
            }
            finally {
              this.busy =
                false;

              this.render();
            }
          }
        );
      }

      if (entry.file) {
        const open =
          rowActions.createEl(
            "button",
            {
              attr: {
                type:
                  "button",
                title:
                  "打开图片",
              },
            }
          );

        this.library.createIcon(
          open,
          "external-link"
        );

        open.addEventListener(
          "click",
          async () => {
            await this.app.workspace
              .getLeaf("tab")
              .openFile(
                entry.file
              );
          }
        );
      }

      const unlink =
        rowActions.createEl(
          "button",
          {
            attr: {
              type:
                "button",
              title:
                "从 Paper 移除",
            },
          }
        );

      this.library.createIcon(
        unlink,
        "x"
      );

      unlink.disabled =
        this.busy;

      unlink.addEventListener(
        "click",
        async () => {
          this.busy =
            true;

          this.render();

          try {
            await this.library
              .removeFigureLink(
                this.paper,
                entry.index
              );
          }
          catch (error) {
            new Notice(
              error?.message
              || "移除图片失败",
              6000
            );
          }
          finally {
            this.busy =
              false;

            this.render();
          }
        }
      );
    }
  }
}


class PaperFigureViewerModal extends Modal {
  constructor(
    app,
    {
      library,
      paper,
      index = 0,
    }
  ) {
    super(app);

    this.library =
      library;

    this.paper =
      paper;

    this.index =
      Number(index) || 0;

    this.keydown =
      null;
  }

  onOpen() {
    this.modalEl.addClass(
      "rl-figure-viewer-modal"
    );

    this.keydown =
      (event) => {
        if (
          event.key === "ArrowLeft"
        ) {
          event.preventDefault();

          this.move(
            -1
          );
        }
        else if (
          event.key === "ArrowRight"
        ) {
          event.preventDefault();

          this.move(
            1
          );
        }
      };

    this.modalEl.addEventListener(
      "keydown",
      this.keydown
    );

    this.render();
  }

  onClose() {
    if (this.keydown) {
      this.modalEl.removeEventListener(
        "keydown",
        this.keydown
      );
    }

    this.contentEl.empty();
  }

  move(
    delta
  ) {
    const total =
      this.library
        .figurePaths(
          this.paper
        ).length;

    if (!total) {
      return;
    }

    this.index =
      (
        this.index
        + delta
        + total
      ) % total;

    this.render();
  }

  render() {
    this.contentEl.empty();

    const entries =
      this.library
        .figureEntriesForPaper(
          this.paper
        );

    if (!entries.length) {
      this.close();
      return;
    }

    this.index =
      Math.max(
        0,
        Math.min(
          this.index,
          entries.length - 1
        )
      );

    const entry =
      entries[
        this.index
      ];

    const header =
      this.contentEl.createDiv({
        cls:
          "rl-figure-viewer-header",
      });

    const heading =
      header.createDiv({
        cls:
          "rl-figure-viewer-heading",
      });

    heading.createDiv({
      cls:
        "rl-figure-viewer-title",
      text:
        this.paper.title,
    });

    heading.createDiv({
      cls:
        "rl-figure-viewer-meta",
      text:
        `${this.index + 1} / ${entries.length}`,
    });

    const headerActions =
      header.createDiv({
        cls:
          "rl-figure-viewer-header-actions",
      });

    const manage =
      headerActions.createEl(
        "button",
        {
          attr: {
            type:
              "button",
            title:
              "管理图片",
          },
        }
      );

    this.library.createIcon(
      manage,
      "images"
    );

    manage.addEventListener(
      "click",
      () => {
        this.close();

        this.library
          .openFigureManager(
            this.paper
          );
      }
    );

    const stage =
      this.contentEl.createDiv({
        cls:
          "rl-figure-viewer-stage",
      });

    if (entry.file) {
      stage.createEl(
        "img",
        {
          cls:
            "rl-figure-viewer-image",
          attr: {
            src:
              this.library
                .figureResourcePath(
                  entry.file
                ),
            alt:
              `${this.paper.title} · ${
                entry.file.name
              }`,
          },
        }
      );
    }
    else {
      const missing =
        stage.createDiv({
          cls:
            "rl-figure-viewer-missing",
        });

      this.library.createIcon(
        missing,
        "image-off"
      );

      missing.createSpan({
        text:
          "Missing image",
      });
    }

    if (
      entries.length > 1
    ) {
      const previous =
        stage.createEl(
          "button",
          {
            cls:
              "rl-figure-viewer-nav is-prev",
            attr: {
              type:
                "button",
              title:
                "上一张",
            },
          }
        );

      this.library.createIcon(
        previous,
        "chevron-left"
      );

      previous.addEventListener(
        "click",
        () => {
          this.move(
            -1
          );
        }
      );

      const next =
        stage.createEl(
          "button",
          {
            cls:
              "rl-figure-viewer-nav is-next",
            attr: {
              type:
                "button",
              title:
                "下一张",
            },
          }
        );

      this.library.createIcon(
        next,
        "chevron-right"
      );

      next.addEventListener(
        "click",
        () => {
          this.move(
            1
          );
        }
      );
    }

    const footer =
      this.contentEl.createDiv({
        cls:
          "rl-figure-viewer-footer",
      });

    footer.createDiv({
      cls:
        "rl-figure-viewer-filename",
      text:
        entry.file?.name
        || entry.path,
    });

    if (entry.file) {
      const open =
        footer.createEl(
          "button",
          {
            attr: {
              type:
                "button",
            },
          }
        );

      this.library.createIcon(
        open,
        "external-link"
      );

      open.createSpan({
        text:
          "Open",
      });

      open.addEventListener(
        "click",
        async () => {
          await this.app.workspace
            .getLeaf("tab")
            .openFile(
              entry.file
            );
        }
      );
    }
  }
}


class PaperDeleteModal extends Modal {
  constructor(
    app,
    {
      library,
      papers,
    }
  ) {
    super(app);

    this.library =
      library;

    this.papers =
      papers || [];

    this.busy =
      false;
  }

  applyAppearanceSettings() {
    const settings =
      this.library?.plugin
        ?.settings || {};

    const source =
      String(
        settings.fontSource
        || "obsidian-interface"
      );

    let family =
      "var(--font-interface)";

    if (
      source
      === "obsidian-text"
    ) {
      family =
        "var(--font-text)";
    }
    else if (
      source
      === "obsidian-monospace"
    ) {
      family =
        "var(--font-monospace)";
    }
    else if (
      source.startsWith(
        "system:"
      )
    ) {
      const systemFamily =
        source
          .slice(
            "system:".length
          )
          .trim();

      if (systemFamily) {
        family =
          `"${systemFamily.replace(
            /"/g,
            '\\"'
          )}", sans-serif`;
      }
    }

    const size =
      Math.max(
        10,
        Math.min(
          20,
          Number(
            settings.fontSize
          ) || 13
        )
      );

    this.modalEl.style
      .setProperty(
        "--rl-font-family",
        family
      );

    this.modalEl.style
      .setProperty(
        "--rl-font-size",
        `${size}px`
      );
  }

  onOpen() {
    this.modalEl.addClass(
      "rl-paper-delete-modal"
    );

    this.applyAppearanceSettings();
    this.render();
  }

  onClose() {
    this.contentEl.empty();
  }

  paperSummary() {
    const count =
      this.papers.length;

    if (count === 1) {
      return (
        this.papers[0]
          ?.title
        || this.papers[0]
          ?.file?.basename
        || "1 篇论文"
      );
    }

    return `${count} 篇论文`;
  }

  pdfState() {
    let found =
      0;

    let missing =
      0;

    let shared =
      0;

    for (
      const paper
      of this.papers
    ) {
      const pdf =
        this.library
          .paperDeletePdfFile(
            paper
          );

      if (
        pdf instanceof TFile
      ) {
        found += 1;

        if (
          this.library
            .paperPdfReferenceCount(
              pdf,
              paper
            ) > 0
        ) {
          shared += 1;
        }
      }
      else {
        missing += 1;
      }
    }

    return {
      found,
      missing,
      shared,
    };
  }

  renderOption(
    parent,
    {
      icon,
      title,
      destructive = false,
      onClick,
    }
  ) {
    const button =
      parent.createEl(
        "button",
        {
          cls:
            `rl-paper-delete-option${
              destructive
                ? " is-destructive"
                : ""
            }`,
          attr: {
            type:
              "button",
          },
        }
      );

    const iconWrap =
      button.createSpan({
        cls:
          "rl-paper-delete-option-icon",
      });

    this.library.createIcon(
      iconWrap,
      icon
    );

    const body =
      button.createDiv({
        cls:
          "rl-paper-delete-option-body",
      });

    body.createDiv({
      cls:
        "rl-paper-delete-option-title",
      text:
        title,
    });

    this.library.createIcon(
      button,
      "chevron-right",
      "rl-paper-delete-option-chevron"
    );

    button.addEventListener(
      "click",
      async () => {
        if (this.busy) {
          return;
        }

        this.busy =
          true;

        this.modalEl.addClass(
          "is-busy"
        );

        for (
          const option
          of this.contentEl.querySelectorAll(
            "button"
          )
        ) {
          option.disabled =
            true;
        }

        try {
          const result =
            await onClick();

          this.close();

          const successes =
            result?.successes
            || [];

          const errors =
            result?.errors
            || [];

          const missing =
            successes.filter(
              (item) =>
                !item.pdfFound
            ).length;

          const shared =
            successes.filter(
              (item) =>
                item.sharedPdf
            ).length;

          const pieces = [
            `${successes.length} 篇已处理`,
          ];

          if (missing) {
            pieces.push(
              `${missing} 篇未找到 PDF`
            );
          }

          if (shared) {
            pieces.push(
              `${shared} 个共享 PDF 已保留`
            );
          }

          if (errors.length) {
            pieces.push(
              `${errors.length} 篇失败`
            );
          }

          new Notice(
            pieces.join(" · "),
            errors.length
              ? 8000
              : 4500
          );

          if (errors.length) {
            console.error(
              "Research Library: paper delete failures",
              errors
            );
          }
        }
        catch (error) {
          this.busy =
            false;

          this.modalEl.removeClass(
            "is-busy"
          );

          for (
            const option
            of this.contentEl.querySelectorAll(
              "button"
            )
          ) {
            option.disabled =
              false;
          }

          new Notice(
            error?.message
            || "删除失败",
            7000
          );
        }
      }
    );

    return button;
  }

  render() {
    this.contentEl.empty();

    const heading =
      this.contentEl.createDiv({
        cls:
          "rl-paper-delete-heading",
      });

    const icon =
      heading.createSpan({
        cls:
          "rl-paper-delete-heading-icon",
      });

    this.library.createIcon(
      icon,
      "trash-2"
    );

    const headingText =
      heading.createDiv();

    headingText.createEl(
      "h2",
      {
        text:
          "删除论文",
      }
    );

    headingText.createDiv({
      cls:
        "rl-paper-delete-subtitle",
      text:
        this.paperSummary(),
    });

    const options =
      this.contentEl.createDiv({
        cls:
          "rl-paper-delete-options",
      });

    this.renderOption(
      options,
      {
        icon:
          "archive-x",
        title:
          "只删元数据",
        onClick:
          () =>
            this.library
              .deletePapers(
                this.papers,
                "metadata"
              ),
      }
    );

    this.renderOption(
      options,
      {
        icon:
          "trash-2",
        title:
          "相关全删除",
        destructive:
          true,
        onClick:
          () =>
            this.library
              .deletePapers(
                this.papers,
                "all"
              ),
      }
    );

    const footer =
      this.contentEl.createDiv({
        cls:
          "rl-paper-delete-footer",
      });

    const cancel =
      footer.createEl(
        "button",
        {
          text:
            "取消",
          attr: {
            type:
              "button",
          },
        }
      );

    cancel.addEventListener(
      "click",
      () =>
        this.close()
    );
  }
}


class PublicationResolutionModal extends Modal {
  constructor(
    app,
    {
      baseMeta,
      candidates,
      sourcePdf,
      onUseFormal,
      onKeepPreprint,
      onCancel,
    }
  ) {
    super(app);

    this.baseMeta =
      baseMeta || {};

    this.candidates =
      candidates || [];

    this.sourcePdf =
      sourcePdf || null;

    this.onUseFormal =
      onUseFormal;

    this.onKeepPreprint =
      onKeepPreprint;

    this.onCancel =
      onCancel;

    this.completed =
      false;
  }

  onOpen() {
    this.modalEl.addClass(
      "rl-import-modal"
    );

    this.modalEl.addClass(
      "rl-publication-resolution-modal"
    );

    this.contentEl.empty();

    this.contentEl.createEl(
      "h2",
      {
        text:
          "Formal publication found",
      }
    );

    this.contentEl.createDiv({
      cls:
        "rl-import-modal-subtitle",
      text:
        this.baseMeta.title
        || this.sourcePdf?.name
        || "Paper",
    });

    const current =
      this.contentEl.createDiv({
        cls:
          "rl-publication-current",
      });

    current.createDiv({
      cls:
        "rl-publication-current-label",
      text:
        "Current preprint metadata",
    });

    current.createDiv({
      cls:
        "rl-publication-current-value",
      text:
        [
          this.baseMeta.venue
            || "Preprint",
          this.baseMeta.year
            || "",
          this.baseMeta.arxiv
            ? `arXiv:${this.baseMeta.arxiv}`
            : "",
        ]
          .filter(Boolean)
          .join(" · "),
    });

    const list =
      this.contentEl.createDiv({
        cls:
          "rl-publication-candidates",
      });

    for (
      const candidate
      of this.candidates.slice(0, 5)
    ) {
      const button =
        list.createEl(
          "button",
          {
            cls:
              "rl-publication-candidate",
            attr: {
              type:
                "button",
            },
          }
        );

      const head =
        button.createDiv({
          cls:
            "rl-publication-candidate-head",
        });

      head.createDiv({
        cls:
          "rl-publication-candidate-venue",
        text:
          candidate.venue
          || "Formal publication",
      });

      head.createSpan({
        cls:
          "rl-publication-candidate-score",
        text:
          `${candidate._publicationMatchPercent || 0}%`,
      });

      button.createDiv({
        cls:
          "rl-publication-candidate-title",
        text:
          candidate.title || "",
      });

      button.createDiv({
        cls:
          "rl-publication-candidate-meta",
        text:
          [
            candidate.year || "",
            candidate.authors?.[0]
              || "",
            candidate.volume
              ? `vol. ${candidate.volume}`
              : "",
            candidate.pages
              ? `pp. ${candidate.pages}`
              : "",
            (candidate._sources || [
              candidate.metadataSource,
            ])
              .filter(Boolean)
              .join(" + "),
          ]
            .filter(Boolean)
            .join(" · "),
      });

      button.addEventListener(
        "click",
        () => {
          this.completed =
            true;

          this.onUseFormal?.(
            candidate
          );

          this.close();
        }
      );
    }

    const footer =
      this.contentEl.createDiv({
        cls:
          "rl-import-modal-footer",
      });

    const keep =
      footer.createEl(
        "button",
        {
          cls:
            "rl-import-secondary-button",
          text:
            "Keep preprint metadata",
          attr: {
            type:
              "button",
          },
        }
      );

    keep.addEventListener(
      "click",
      () => {
        this.completed =
          true;

        this.onKeepPreprint?.();
        this.close();
      }
    );
  }

  onClose() {
    if (!this.completed) {
      this.onCancel?.();
    }

    this.contentEl.empty();
  }
}

class PublicationAuditModal extends Modal {
  constructor(
    app,
    {
      library,
    }
  ) {
    super(app);

    this.library =
      library;

    this.busyPath =
      "";
  }

  applyAppearanceSettings() {
    const settings =
      this.library?.plugin
        ?.settings || {};

    const source =
      String(
        settings.fontSource
        || "obsidian-interface"
      );

    let family =
      "var(--font-interface)";

    if (
      source
      === "obsidian-text"
    ) {
      family =
        "var(--font-text)";
    }
    else if (
      source
      === "obsidian-monospace"
    ) {
      family =
        "var(--font-monospace)";
    }
    else if (
      source.startsWith(
        "system:"
      )
    ) {
      const systemFamily =
        source.slice(
          "system:".length
        ).trim();

      if (systemFamily) {
        family =
          `"${systemFamily.replace(/"/g, '\\"')}", sans-serif`;
      }
    }

    const size =
      Math.max(
        10,
        Math.min(
          20,
          Number(
            settings.fontSize
          ) || 13
        )
      );

    this.modalEl.style
      .setProperty(
        "--rl-font-family",
        family
      );

    this.modalEl.style
      .setProperty(
        "--rl-font-size",
        `${size}px`
      );
  }

  onOpen() {
    this.modalEl.addClass(
      "rl-publication-audit-modal"
    );

    this.applyAppearanceSettings();
    this.render();
  }

  render() {
    this.contentEl.empty();

    const papers =
      this.library
        .publicationAuditPapers();

    const header =
      this.contentEl.createDiv({
        cls:
          "rl-publication-audit-header",
      });

    header.createEl(
      "h2",
      {
        text:
          "Publication Audit",
      }
    );

    header.createDiv({
      cls:
        "rl-publication-audit-count",
      text:
        papers.length
          ? `${papers.length} 篇可能仍使用 preprint / arXiv 作为主出版记录`
          : "未发现明显的 preprint-only 记录",
    });

    if (!papers.length) {
      const clean =
        this.contentEl.createDiv({
          cls:
            "rl-publication-audit-clean",
        });

      const icon =
        clean.createSpan();

      setIcon(
        icon,
        "badge-check"
      );

      clean.createSpan({
        text:
          "当前论文库无需 publication repair。",
      });

      return;
    }

    const list =
      this.contentEl.createDiv({
        cls:
          "rl-publication-audit-list",
      });

    for (const paper of papers) {
      const row =
        list.createDiv({
          cls:
            "rl-publication-audit-row",
      });

      const body =
        row.createDiv({
          cls:
            "rl-publication-audit-body",
        });

      body.createDiv({
        cls:
          "rl-publication-audit-title",
        text:
          paper.title,
      });

      body.createDiv({
        cls:
          "rl-publication-audit-meta",
        text:
          [
            paper.venue
              || "Preprint",
            paper.year || "",
            paper.arxiv
              ? `arXiv:${paper.arxiv}`
              : "",
            paper.doi || "",
          ]
            .filter(Boolean)
            .join(" · "),
      });

      const repair =
        row.createEl(
          "button",
          {
            cls:
              "rl-publication-audit-repair",
            text:
              this.busyPath
              === paper.file.path
                ? "Searching…"
                : "Resolve",
            attr: {
              type:
                "button",
            },
          }
        );

      repair.disabled =
        Boolean(
          this.busyPath
        );

      repair.addEventListener(
        "click",
        async () => {
          if (this.busyPath) {
            return;
          }

          this.busyPath =
            paper.file.path;

          this.render();

          try {
            await this.library
              .repairPaperPublication(
                paper,
                {
                  interactive:
                    true,
                }
              );
          }
          finally {
            this.busyPath =
              "";

            this.render();
          }
        }
      );
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

class MetadataCandidateModal extends Modal {
  constructor(
    app,
    {
      candidates,
      detectedTitle,
      diagnostics,
      initialCitation,
      parseCitation,
      onCitationSearch,
      onUseCitation,
      onChoose,
      onUsePdf,
      onCancel,
    }
  ) {
    super(app);

    this.candidates = candidates;
    this.detectedTitle = detectedTitle;
    this.diagnostics =
      Array.isArray(diagnostics)
        ? diagnostics
        : [];
    this.parseCitation =
      parseCitation;
    this.onCitationSearch =
      onCitationSearch;
    this.onUseCitation =
      onUseCitation;
    this.parsedCitation =
      initialCitation
      || null;
    this.onChoose = onChoose;
    this.onUsePdf = onUsePdf;
    this.onCancel = onCancel;
    this.completed = false;
  }

  onOpen() {
    this.modalEl.addClass(
      "rl-import-modal"
    );

    this.modalEl.addClass(
      "rl-metadata-modal"
    );

    this.contentEl.empty();

    this.contentEl.createEl(
      "h2",
      {
        text: "Confirm metadata",
      }
    );

    this.contentEl.createDiv({
      cls: "rl-import-modal-subtitle",
      text:
        `PDF 标题：${this.detectedTitle}`,
    });

    this.contentEl.createDiv({
      cls: "rl-metadata-helper",
      text:
        `CS-first 分级检索：Semantic Scholar → OpenReview + DBLP + PMLR → OpenAlex + Crossref。共 ${this.candidates.length} 条候选，已按标题、作者和标识符重新排序。`,
    });

    renderMetadataDiagnostics(
      this.contentEl,
      this.diagnostics
    );

    const bestMatch =
      Number(
        this.candidates?.[0]
          ?._matchPercent
        || 0
      );

    if (
      bestMatch > 0
      && bestMatch < 85
    ) {
      const warning =
        this.contentEl.createDiv({
          cls:
            "rl-metadata-low-confidence",
        });

      const warningIcon =
        warning.createSpan({
          cls:
            "rl-metadata-low-confidence-icon",
        });

      setIcon(
        warningIcon,
        "triangle-alert"
      );

      warning.createSpan({
        text:
          `最高候选仅 ${bestMatch}%：建议不要勉强选择。可以展开下方 Citation repair，从 Google Scholar 粘贴参考文献后重新检索。`,
      });
    }

    const listWrap =
      this.contentEl.createDiv({
        cls: "rl-metadata-candidates-wrap",
      });

    const list =
      listWrap.createDiv({
        cls: "rl-metadata-candidates",
      });

    for (
      const [index, meta]
      of this.candidates.entries()
    ) {
      const item =
        list.createEl(
          "button",
          {
            cls: "rl-metadata-candidate",
            attr: {
              type: "button",
            },
          }
        );

      const rank =
        item.createDiv({
          cls: "rl-metadata-rank",
          text:
            index === 0
              ? "1"
              : String(index + 1),
        });

      if (
        index === 0
        && Number(meta._matchPercent) >= 85
      ) {
        rank.addClass("is-best");
      }

      const body =
        item.createDiv({
          cls: "rl-metadata-body",
        });

      const header =
        body.createDiv({
          cls: "rl-metadata-header",
        });

      header.createDiv({
        cls: "rl-metadata-title",
        text: meta.title,
      });

      if (
        Number(meta._matchPercent) > 0
      ) {
        header.createDiv({
          cls:
            `rl-metadata-match-badge ` +
            `is-${meta._confidence || "low"}`,
          text:
            `${meta._matchPercent}% match`,
        });
      }

      body.createDiv({
        cls: "rl-metadata-meta-line",
        text:
          [
            meta.year || "????",
            meta.authors?.[0]
              || "Unknown author",
            meta.venue || "",
          ]
            .filter(Boolean)
            .join(" · "),
      });

      const sourceNames =
        (meta._sources || [
          meta.metadataSource,
        ])
          .filter(Boolean)
          .map(
            (source) =>
              source === "semantic-scholar"
                ? "Semantic Scholar"
                : source === "openreview"
                  ? "OpenReview"
                  : source === "dblp"
                    ? "DBLP"
                    : source === "pmlr"
                      ? "PMLR"
                      : source === "citation-gb"
                        ? "GB/T 7714 citation"
                        : source === "citation-llm"
                          ? "LLM citation"
                          : source === "openalex"
                            ? "OpenAlex"
                      : source === "crossref"
                        ? "Crossref"
                        : source === "datacite"
                          ? "DataCite"
                          : source
          );

      body.createDiv({
        cls: "rl-metadata-source-line",
        text:
          `Sources: ${sourceNames.join(" · ")}`,
      });

      if (meta.doi || meta.arxiv) {
        body.createDiv({
          cls: "rl-metadata-doi",
          text:
            [
              meta.doi
                ? `DOI: ${meta.doi}`
                : "",
              meta.arxiv
                ? `arXiv: ${meta.arxiv}`
                : "",
            ]
              .filter(Boolean)
              .join(" · "),
          attr: {
            title:
              meta.doi
              || meta.arxiv
              || "",
          },
        });
      }

      item.addEventListener(
        "click",
        () => {
          this.completed = true;
          this.onChoose?.(meta);
          this.close();
        }
      );
    }

    const citationDetails =
      this.contentEl.createEl(
        "details",
        {
          cls:
            "rl-citation-repair-details",
        }
      );

    if (this.parsedCitation) {
      citationDetails.open =
        true;
    }

    const citationSummary =
      citationDetails.createEl(
        "summary",
        {
          cls:
            "rl-citation-repair-summary",
        }
      );

    const summaryIcon =
      citationSummary.createSpan({
        cls:
          "rl-citation-repair-summary-icon",
      });

    setIcon(
      summaryIcon,
      "quote"
    );

    citationSummary.createSpan({
      text:
        "Citation repair",
    });

    citationSummary.createSpan({
      cls:
        "rl-citation-repair-summary-hint",
      text:
        "Google Scholar / GB/T 7714 / LLM",
    });

    const citationSection =
      citationDetails.createDiv({
        cls:
          "rl-citation-repair is-compact",
      });

    citationSection.createDiv({
      cls:
        "rl-citation-repair-hint",
      text:
        "候选不可靠时，可从 Google Scholar 复制参考文献。解析后可重新检索，或直接用引用元数据进入最终确认。",
    });

    const citationTextarea =
      citationSection.createEl(
        "textarea",
        {
          cls:
            "rl-citation-repair-textarea",
          attr: {
            rows:
              "3",
            spellcheck:
              "false",
            placeholder:
              "Ilse M, Tomczak J, Welling M. Attention-based deep multiple instance learning[C]//International conference on machine learning. Pmlr, 2018: 2127-2136.",
          },
        }
      );

    const citationTools =
      citationSection.createDiv({
        cls:
          "rl-citation-repair-tools",
      });

    const citationStatus =
      citationTools.createDiv({
        cls:
          "rl-citation-repair-status",
        text:
          this.parsedCitation
            ? "已有已解析参考文献信息"
            : "Paste a citation, then parse it.",
      });

    const citationButtons =
      citationTools.createDiv({
        cls:
          "rl-citation-repair-buttons",
      });

    const parseGb =
      citationButtons.createEl(
        "button",
        {
          cls:
            "rl-import-secondary-button",
          text:
            "Parse GB/T 7714",
          attr: {
            type:
              "button",
          },
        }
      );

    const parseLlm =
      citationButtons.createEl(
        "button",
        {
          cls:
            "rl-import-secondary-button",
          text:
            "Parse with LLM",
          attr: {
            type:
              "button",
          },
        }
      );

    const citationPreview =
      citationSection.createDiv({
        cls:
          "rl-citation-preview",
      });

    const renderCitationPreview =
      () => {
        citationPreview.empty();

        const meta =
          this.parsedCitation;

        if (!meta) {
          citationPreview.hide();
          return;
        }

        citationPreview.show();

        citationPreview.createDiv({
          cls:
            "rl-citation-preview-title",
          text:
            meta.title
            || "No title",
        });

        citationPreview.createDiv({
          cls:
            "rl-citation-preview-meta",
          text:
            [
              meta.authors
                ?.join(", ")
                || "",
              meta.venue || "",
              meta.publisher || "",
              meta.year || "",
              meta.pages
                ? `pp. ${meta.pages}`
                : "",
            ]
              .filter(Boolean)
              .join(" · "),
        });

        const actions =
          citationPreview.createDiv({
            cls:
              "rl-citation-preview-actions",
          });

        const searchCitation =
          actions.createEl(
            "button",
            {
              cls:
                "mod-cta",
              text:
                "Search with parsed title",
              attr: {
                type:
                  "button",
              },
            }
          );

        searchCitation.addEventListener(
          "click",
          () => {
            this.completed =
              true;

            this.onCitationSearch?.(
              this.parsedCitation
            );

            this.close();
          }
        );

        const useCitation =
          actions.createEl(
            "button",
            {
              cls:
                "rl-import-secondary-button",
              text:
                "Use citation metadata",
              attr: {
                type:
                  "button",
              },
            }
          );

        useCitation.addEventListener(
          "click",
          () => {
            this.completed =
              true;

            this.onUseCitation?.(
              this.parsedCitation
            );

            this.close();
          }
        );
      };

    const runCitationParser =
      async (mode) => {
        const text =
          citationTextarea.value
            .trim();

        if (!text) {
          new Notice(
            "请先粘贴参考文献。"
          );

          citationTextarea.focus();
          return;
        }

        parseGb.disabled =
          true;

        parseLlm.disabled =
          true;

        citationStatus
          .removeClass(
            "is-success",
            "is-error"
          );

        citationStatus
          .addClass(
            "is-working"
          );

        citationStatus.setText(
          mode === "llm"
            ? "正在让 LLM 解析参考文献…"
            : "正在按 GB/T 7714 解析…"
        );

        try {
          const parsed =
            await this.parseCitation?.(
              text,
              mode
            );

          if (
            !parsed?.title
          ) {
            throw new Error(
              "没有解析出可用标题。"
            );
          }

          this.parsedCitation =
            parsed;

          citationStatus
            .addClass(
              "is-success"
            );

          citationStatus.setText(
            `${
              mode === "llm"
                ? "LLM"
                : "GB/T 7714"
            } parsed · ${parsed.title}`
          );

          renderCitationPreview();
        }
        catch (error) {
          citationStatus
            .addClass(
              "is-error"
            );

          citationStatus.setText(
            error?.message
            || String(error)
          );
        }
        finally {
          citationStatus
            .removeClass(
              "is-working"
            );

          parseGb.disabled =
            false;

          parseLlm.disabled =
            false;
        }
      };

    parseGb.addEventListener(
      "click",
      () =>
        runCitationParser(
          "gb"
        )
    );

    parseLlm.addEventListener(
      "click",
      () =>
        runCitationParser(
          "llm"
        )
    );

    renderCitationPreview();

    const footer =
      this.contentEl.createDiv({
        cls:
          "rl-import-modal-footer",
      });

    const scholar =
      footer.createEl(
        "a",
        {
          cls:
            "rl-import-scholar-link",
          text:
            "Search Google Scholar ↗",
          href:
            `https://scholar.google.com/scholar?q=${
              encodeURIComponent(
                `"${this.detectedTitle}"`
              )
            }`,
          attr: {
            target: "_blank",
            rel: "noopener",
          },
        }
      );

    scholar.addEventListener(
      "click",
      (event) => {
        event.stopPropagation();
      }
    );

    const pdfOnly =
      footer.createEl(
        "button",
        {
          cls: "rl-import-secondary-button",
          text: "Use PDF metadata anyway",
          attr: {
            type: "button",
          },
        }
      );

    pdfOnly.addEventListener(
      "click",
      () => {
        this.completed = true;
        this.onUsePdf?.();
        this.close();
      }
    );

    const cancel =
      footer.createEl(
        "button",
        {
          cls: "rl-import-ghost-button",
          text: "Cancel",
          attr: {
            type: "button",
          },
        }
      );

    cancel.addEventListener(
      "click",
      () => {
        this.completed = true;
        this.onCancel?.();
        this.close();
      }
    );
  }

  onClose() {
    if (!this.completed) {
      this.onCancel?.();
    }

    this.contentEl.empty();
  }
}



class MetadataSearchFallbackModal extends Modal {
  constructor(
    app,
    {
      sourcePdf,
      signals,
      searchTitle,
      candidates,
      diagnostics,
      parseCitation,
      onCitationSearch,
      onUseCitation,
      onRetry,
      onUsePdf,
      onCancel,
    }
  ) {
    super(app);

    this.sourcePdf = sourcePdf;
    this.signals = signals || {};
    this.searchTitle =
      searchTitle || "";
    this.candidates =
      Array.isArray(candidates)
        ? candidates
        : [];
    this.diagnostics =
      Array.isArray(diagnostics)
        ? diagnostics
        : [];
    this.parseCitation =
      parseCitation;
    this.onCitationSearch =
      onCitationSearch;
    this.onUseCitation =
      onUseCitation;
    this.onRetry = onRetry;
    this.onUsePdf = onUsePdf;
    this.onCancel = onCancel;
    this.parsedCitation =
      this.signals
        .citationRescue
      || null;
    this.completed = false;
  }

  onOpen() {
    this.modalEl.addClass(
      "rl-import-modal"
    );

    this.modalEl.addClass(
      "rl-no-match-modal"
    );

    this.contentEl.empty();

    const hero =
      this.contentEl.createDiv({
        cls: "rl-no-match-hero",
      });

    const icon =
      hero.createDiv({
        cls: "rl-no-match-icon",
      });

    setIcon(
      icon,
      "search-x"
    );

    const heroText =
      hero.createDiv({
        cls: "rl-no-match-hero-text",
      });

    heroText.createEl(
      "h2",
      {
        text:
          "No reliable metadata match",
      }
    );

    heroText.createDiv({
      cls:
        "rl-import-modal-subtitle rl-no-match-subtitle",
      text:
        this.sourcePdf?.name
        || "PDF",
    });

    hero.createDiv({
      cls: "rl-no-match-state",
      text: "Not imported",
    });

    const explanation =
      this.contentEl.createDiv({
        cls: "rl-no-match-message",
      });

    explanation.createDiv({
      cls: "rl-no-match-message-title",
      text:
        "自动检索没有找到足够可靠的论文记录。",
    });

    explanation.createDiv({
      cls: "rl-no-match-message-body",
      text:
        this.signals.llmRescueAttempted
          ? "常规数据库检索和 LLM 首页标题救援都没有得到足够可靠的在线论文记录。你仍可以修正标题后重试，或明确选择继续使用 PDF metadata。"
          : "插件已停止自动回退，不会把未经验证的 PDF metadata 直接当成在线元数据。你可以修正标题后重试，或明确选择继续使用 PDF metadata。",
    });

    renderMetadataDiagnostics(
      this.contentEl,
      this.diagnostics
    );

    const searchBox =
      this.contentEl.createDiv({
        cls: "rl-no-match-search-box",
      });

    searchBox.createEl(
      "label",
      {
        text: "Search title",
      }
    );

    const inputWrap =
      searchBox.createDiv({
        cls: "rl-no-match-input-wrap",
      });

    const searchIcon =
      inputWrap.createSpan({
        cls: "rl-no-match-search-icon",
      });

    setIcon(
      searchIcon,
      "search"
    );

    const input =
      inputWrap.createEl(
        "input",
        {
          value:
            this.searchTitle,
          attr: {
            type: "text",
            spellcheck: "false",
          },
        }
      );

    this.titleInput = input;

    const hint =
      searchBox.createDiv({
        cls: "rl-no-match-hint",
        text:
          "建议保留论文完整标题，去掉页眉、断行、期刊信息或异常空格。",
      });

    const detected =
      this.contentEl.createDiv({
        cls: "rl-no-match-detected",
      });

    detected.createDiv({
      cls:
        "rl-no-match-detected-label",
      text: "Detected from PDF",
    });

    detected.createDiv({
      cls:
        "rl-no-match-detected-value",
      text:
        this.signals.title
        || "No usable embedded title",
    });

    const details =
      detected.createDiv({
        cls:
          "rl-no-match-detected-meta",
      });

    details.createSpan({
      text:
        `Author: ${
          this.signals.pdfAuthor
          || "—"
        }`,
    });

    details.createSpan({
      text:
        `DOI: ${
          this.signals.doi
          || "—"
        }`,
    });

    details.createSpan({
      text:
        `arXiv: ${
          this.signals.arxiv
          || "—"
        }`,
    });

    if (
      this.signals
        .llmRescueAttempted
    ) {
      const llm =
        this.signals
          .llmRescue;

      const llmCard =
        this.contentEl.createDiv({
          cls:
            "rl-llm-rescue-card",
        });

      const llmIcon =
        llmCard.createDiv({
          cls:
            "rl-llm-rescue-icon",
        });

      setIcon(
        llmIcon,
        llm
          ? "sparkles"
          : "triangle-alert"
      );

      const llmBody =
        llmCard.createDiv({
          cls:
            "rl-llm-rescue-body",
        });

      llmBody.createDiv({
        cls:
          "rl-llm-rescue-label",
        text:
          llm
            ? "LLM title rescue attempted"
            : "LLM rescue failed",
      });

      if (llm) {
        llmBody.createDiv({
          cls:
            "rl-llm-rescue-title",
          text:
            llm.title
            || "No title",
        });

        llmBody.createDiv({
          cls:
            "rl-llm-rescue-meta",
          text:
            [
              llm.model
                ? `Model: ${llm.model}`
                : "",
              Number(
                llm.confidence
              ) > 0
                ? `Confidence: ${Math.round(
                    Number(
                      llm.confidence
                    ) * 100
                  )}%`
                : "",
            ]
              .filter(Boolean)
              .join(" · ")
            || "The recovered title still did not produce a reliable scholarly-database match.",
        });
      }
      else {
        llmBody.createDiv({
          cls:
            "rl-llm-rescue-meta",
          text:
            this.signals
              .llmRescueError
            || "The configured LLM endpoint did not return usable metadata.",
        });
      }
    }

    const best =
      this.candidates[0];

    if (best) {
      const low =
        this.contentEl.createDiv({
          cls:
            "rl-no-match-best-low",
        });

      const lowTop =
        low.createDiv({
          cls:
            "rl-no-match-best-low-top",
        });

      lowTop.createSpan({
        text:
          "Best low-confidence result",
      });

      lowTop.createSpan({
        cls:
          "rl-no-match-low-score",
        text:
          `${Number(
            best._matchPercent || 0
          )}% match`,
      });

      low.createDiv({
        cls:
          "rl-no-match-best-low-title",
        text:
          best.title
          || "Untitled",
      });

      low.createDiv({
        cls:
          "rl-no-match-best-low-meta",
        text:
          [
            best.year || "",
            best.authors?.[0]
              || "",
            best.venue || "",
          ]
            .filter(Boolean)
            .join(" · ")
          || "No additional metadata",
      });
    }

    const citationSection =
      this.contentEl.createDiv({
        cls:
          "rl-citation-repair",
      });

    const citationHeader =
      citationSection.createDiv({
        cls:
          "rl-citation-repair-header",
      });

    const citationHeading =
      citationHeader.createDiv();

    citationHeading.createDiv({
      cls:
        "rl-citation-repair-title",
      text:
        "Paste citation to repair metadata",
    });

    citationHeading.createDiv({
      cls:
        "rl-citation-repair-hint",
      text:
        "可从 Google Scholar 复制参考文献；支持 GB/T 7714 规则解析或 LLM 解析。",
    });

    const citationTextarea =
      citationSection.createEl(
        "textarea",
        {
          cls:
            "rl-citation-repair-textarea",
          attr: {
            rows: "3",
            spellcheck:
              "false",
            placeholder:
              "例如：Ilse M, Tomczak J, Welling M. Attention-based deep multiple instance learning[C]//International conference on machine learning. Pmlr, 2018: 2127-2136.",
          },
        }
      );

    const citationTools =
      citationSection.createDiv({
        cls:
          "rl-citation-repair-tools",
      });

    const citationStatus =
      citationTools.createDiv({
        cls:
          "rl-citation-repair-status",
        text:
          this.parsedCitation
            ? "已有已解析参考文献信息"
            : "Paste a citation, then parse it.",
      });

    const citationButtons =
      citationTools.createDiv({
        cls:
          "rl-citation-repair-buttons",
      });

    const parseGb =
      citationButtons.createEl(
        "button",
        {
          cls:
            "rl-import-secondary-button",
          text:
            "Parse GB/T 7714",
          attr: {
            type:
              "button",
          },
        }
      );

    const parseLlm =
      citationButtons.createEl(
        "button",
        {
          cls:
            "rl-import-secondary-button",
          text:
            "Parse with LLM",
          attr: {
            type:
              "button",
          },
        }
      );

    const citationPreview =
      citationSection.createDiv({
        cls:
          "rl-citation-preview",
      });

    const renderCitationPreview =
      () => {
        citationPreview.empty();

        const meta =
          this.parsedCitation;

        if (!meta) {
          citationPreview.hide();
          return;
        }

        citationPreview.show();

        citationPreview.createDiv({
          cls:
            "rl-citation-preview-title",
          text:
            meta.title
            || "No title",
        });

        citationPreview.createDiv({
          cls:
            "rl-citation-preview-meta",
          text:
            [
              meta.authors
                ?.join(", ")
                || "",
              meta.venue || "",
              meta.publisher || "",
              meta.year || "",
              meta.pages
                ? `pp. ${meta.pages}`
                : "",
            ]
              .filter(Boolean)
              .join(" · "),
        });

        const actions =
          citationPreview.createDiv({
            cls:
              "rl-citation-preview-actions",
          });

        const searchCitation =
          actions.createEl(
            "button",
            {
              cls:
                "mod-cta",
              text:
                "Search with parsed title",
              attr: {
                type:
                  "button",
              },
            }
          );

        searchCitation.addEventListener(
          "click",
          () => {
            this.completed =
              true;

            this.onCitationSearch?.(
              this.parsedCitation
            );

            this.close();
          }
        );

        const useCitation =
          actions.createEl(
            "button",
            {
              cls:
                "rl-import-secondary-button",
              text:
                "Use citation metadata",
              attr: {
                type:
                  "button",
              },
            }
          );

        useCitation.addEventListener(
          "click",
          () => {
            this.completed =
              true;

            this.onUseCitation?.(
              this.parsedCitation
            );

            this.close();
          }
        );
      };

    const runCitationParser =
      async (mode) => {
        const text =
          citationTextarea.value
            .trim();

        if (!text) {
          new Notice(
            "请先粘贴参考文献。"
          );

          citationTextarea.focus();
          return;
        }

        parseGb.disabled =
          true;

        parseLlm.disabled =
          true;

        citationStatus
          .removeClass(
            "is-success",
            "is-error"
          );

        citationStatus
          .addClass(
            "is-working"
          );

        citationStatus.setText(
          mode === "llm"
            ? "正在让 LLM 解析参考文献…"
            : "正在按 GB/T 7714 解析…"
        );

        try {
          const parsed =
            await this.parseCitation?.(
              text,
              mode
            );

          if (
            !parsed?.title
          ) {
            throw new Error(
              "没有解析出可用标题。"
            );
          }

          this.parsedCitation =
            parsed;

          this.titleInput.value =
            parsed.title;

          updateScholarHref();

          citationStatus.addClass(
            "is-success"
          );

          citationStatus.setText(
            `${mode === "llm" ? "LLM" : "GB/T 7714"} parsed · ${parsed.title}`
          );

          renderCitationPreview();
        }
        catch (error) {
          citationStatus.addClass(
            "is-error"
          );

          citationStatus.setText(
            error?.message
            || String(error)
          );
        }
        finally {
          citationStatus
            .removeClass(
              "is-working"
            );

          parseGb.disabled =
            false;

          parseLlm.disabled =
            false;
        }
      };

    parseGb.addEventListener(
      "click",
      () =>
        runCitationParser(
          "gb"
        )
    );

    parseLlm.addEventListener(
      "click",
      () =>
        runCitationParser(
          "llm"
        )
    );

    renderCitationPreview();

    const footer =
      this.contentEl.createDiv({
        cls:
          "rl-import-modal-footer rl-no-match-footer",
      });

    const scholar =
      footer.createEl(
        "a",
        {
          cls:
            "rl-import-scholar-link",
          text:
            "Search Google Scholar ↗",
          attr: {
            target: "_blank",
            rel: "noopener",
          },
        }
      );

    const updateScholarHref =
      () => {
        const title =
          input.value.trim()
          || this.searchTitle;

        scholar.href =
          `https://scholar.google.com/scholar?q=${
            encodeURIComponent(
              `"${title}"`
            )
          }`;
      };

    updateScholarHref();

    input.addEventListener(
      "input",
      updateScholarHref
    );

    scholar.addEventListener(
      "click",
      (event) => {
        event.stopPropagation();
      }
    );

    const actions =
      footer.createDiv({
        cls:
          "rl-no-match-actions",
      });

    const cancel =
      actions.createEl(
        "button",
        {
          cls:
            "rl-import-ghost-button",
          text: "Cancel",
          attr: {
            type: "button",
          },
        }
      );

    cancel.addEventListener(
      "click",
      () => {
        this.completed = true;
        this.onCancel?.();
        this.close();
      }
    );

    const usePdf =
      actions.createEl(
        "button",
        {
          cls:
            "rl-import-secondary-button rl-use-pdf-anyway",
          text:
            "Use PDF metadata anyway",
          attr: {
            type: "button",
          },
        }
      );

    usePdf.addEventListener(
      "click",
      () => {
        const title =
          input.value.trim()
          || this.searchTitle;

        this.completed = true;
        this.onUsePdf?.(
          title
        );
        this.close();
      }
    );

    const retry =
      actions.createEl(
        "button",
        {
          cls: "mod-cta",
          text: "Retry search",
          attr: {
            type: "button",
          },
        }
      );

    const retrySearch =
      () => {
        const title =
          input.value.trim();

        if (!title) {
          new Notice(
            "Search title 不能为空"
          );

          input.focus();
          return;
        }

        this.completed = true;
        this.onRetry?.(
          title
        );
        this.close();
      };

    retry.addEventListener(
      "click",
      retrySearch
    );

    input.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "Enter"
          && !event.shiftKey
        ) {
          event.preventDefault();
          retrySearch();
        }
      }
    );

    window.setTimeout(
      () => {
        input.focus();
        input.select();
      },
      0
    );
  }

  onClose() {
    if (!this.completed) {
      this.onCancel?.();
    }

    this.contentEl.empty();
  }
}


class PaperImportPreviewModal extends Modal {
  constructor(
    app,
    {
      sourcePdf,
      meta,
      matchMethod,
      signals,
      provenance,
      previewPdfPath,
      onImport,
      onCancel,
    }
  ) {
    super(app);

    this.sourcePdf = sourcePdf;
    this.meta = JSON.parse(
      JSON.stringify(meta)
    );
    this.matchMethod = matchMethod;
    this.signals = signals;
    this.provenance =
      provenance || {
        sources: [],
        methodLabel:
          matchMethod || "Unknown",
        verified:
          false,
        verificationLabel:
          "Unverified",
      };
    this.previewPdfPath =
      previewPdfPath || "";
    this.onImport = onImport;
    this.onCancel = onCancel;
    this.completed = false;
  }

  onOpen() {
    this.modalEl.addClass(
      "rl-import-modal"
    );

    this.modalEl.addClass(
      "rl-preview-modal"
    );

    this.contentEl.empty();

    const header =
      this.contentEl.createDiv({
        cls: "rl-import-preview-header",
      });

    const titleWrap =
      header.createDiv();

    titleWrap.createEl(
      "h2",
      {
        text: "Import paper",
      }
    );

    titleWrap.createDiv({
      cls: "rl-import-modal-subtitle",
      text:
        this.sourcePdf.name,
    });

    const sourceNames =
      (
        this.meta._sources
        || [
          this.meta.metadataSource,
        ]
      )
        .filter(Boolean)
        .map(
          (source) =>
            source
              === "semantic-scholar"
              ? "Semantic Scholar"
              : source
                === "openreview"
                ? "OpenReview"
                : source
                  === "dblp"
                  ? "DBLP"
                  : source
                    === "pmlr"
                    ? "PMLR"
                    : source
                      === "citation-gb"
                      ? "GB/T 7714 citation"
                      : source
                        === "citation-llm"
                        ? "LLM citation"
                        : source
                          === "openalex"
                          ? "OpenAlex"
                    : source
                      === "crossref"
                      ? "Crossref"
                      : source
                        === "datacite"
                        ? "DataCite"
                        : source
        );

    const sourceLabel =
      sourceNames.length
        ? sourceNames.join(" + ")
        : this.matchMethod
          === "pdf-only"
          ? "PDF metadata"
          : "Metadata";

    const matchPercent =
      Number(
        this.meta._matchPercent
        || 0
      );

    const badgeText =
      this.matchMethod === "doi"
        ? `${sourceLabel} · DOI exact`
        : this.matchMethod === "arxiv"
          ? `${sourceLabel} · arXiv exact`
          : this.matchMethod
            === "title-search"
            ? `${sourceLabel}${
                matchPercent
                  ? ` · ${matchPercent}%`
                  : ""
              }`
            : this.matchMethod
              === "llm-rescue"
              ? `${sourceLabel}${
                  matchPercent
                    ? ` · ${matchPercent}%`
                    : ""
                } · LLM title rescue`
              : this.matchMethod
                === "citation-rescue"
                ? `${sourceLabel}${
                    matchPercent
                      ? ` · ${matchPercent}%`
                      : ""
                  } · citation repair`
                : this.matchMethod
                  === "citation-text"
                  ? `${sourceLabel || "Citation metadata"} · Unverified`
                  : "PDF metadata · Unverified";

    header.createSpan({
      cls:
        `rl-match-badge rl-match-${this.matchMethod}`,
      text: badgeText,
    });

    if (
      this.matchMethod
        === "pdf-only"
      || this.matchMethod
        === "citation-text"
    ) {
      const warning =
        this.contentEl.createDiv({
          cls:
            "rl-import-unverified-warning",
        });

      const warningIcon =
        warning.createSpan({
          cls:
            "rl-import-unverified-icon",
        });

      setIcon(
        warningIcon,
        "triangle-alert"
      );

      const warningText =
        warning.createDiv({
          cls:
            "rl-import-unverified-text",
        });

      warningText.createDiv({
        cls:
          "rl-import-unverified-title",
        text:
          this.matchMethod
            === "citation-text"
            ? "Unverified citation metadata"
            : "Unverified PDF metadata",
      });

      warningText.createDiv({
        cls:
          "rl-import-unverified-body",
        text:
          this.matchMethod
            === "citation-text"
            ? "这些字段直接来自粘贴的参考文献，没有通过论文数据库再次确认。请在导入前重点检查作者、年份、Venue、页码和 DOI。"
            : "这些字段没有通过在线论文数据库验证。请在导入前重点检查标题、作者、年份、Venue 和 DOI。",
      });
    }

    const provenanceCard =
      this.contentEl.createDiv({
        cls:
          `rl-import-provenance ${
            this.provenance.verified
              ? "is-verified"
              : "is-unverified"
          }`,
      });

    const provenanceHeader =
      provenanceCard.createDiv({
        cls:
          "rl-import-provenance-header",
      });

    const provenanceIcon =
      provenanceHeader.createSpan({
        cls:
          "rl-import-provenance-icon",
      });

    setIcon(
      provenanceIcon,
      this.provenance.verified
        ? "badge-check"
        : "triangle-alert"
    );

    provenanceHeader.createSpan({
      cls:
        "rl-import-provenance-title",
      text:
        this.provenance.verified
          ? "Verified metadata path"
          : "Manual / unverified metadata path",
    });

    const provenanceGrid =
      provenanceCard.createDiv({
        cls:
          "rl-import-provenance-grid",
      });

    const addProvenanceRow =
      (
        label,
        value
      ) => {
        provenanceGrid.createDiv({
          cls:
            "rl-import-provenance-label",
          text:
            label,
        });

        provenanceGrid.createDiv({
          cls:
            "rl-import-provenance-value",
          text:
            value || "—",
          attr: {
            title:
              value || "",
          },
        });
      };

    addProvenanceRow(
      "来源",
      this.provenance.sources
        ?.length
        ? this.provenance.sources
            .join(" + ")
        : sourceLabel
    );

    addProvenanceRow(
      "方式",
      this.provenance.methodLabel
      || this.matchMethod
    );

    addProvenanceRow(
      "验证",
      this.provenance.verificationLabel
      || (
        this.provenance.verified
          ? "Database verified"
          : "Unverified"
      )
    );

    addProvenanceRow(
      "PDF",
      this.previewPdfPath
        ? `${this.sourcePdf.name} → ${this.previewPdfPath}`
        : this.sourcePdf.name
    );

    const publicationResolution =
      this.meta?._publicationResolution
      || this.signals?.publicationResolution
      || null;

    if (publicationResolution) {
      const publicationCard =
        this.contentEl.createDiv({
          cls:
            "rl-publication-resolution-card",
        });

      const publicationIcon =
        publicationCard.createSpan({
          cls:
            "rl-publication-resolution-icon",
        });

      setIcon(
        publicationIcon,
        "git-merge"
      );

      const publicationText =
        publicationCard.createDiv({
          cls:
            "rl-publication-resolution-text",
        });

      publicationText.createDiv({
        cls:
          "rl-publication-resolution-title",
        text:
          "Formal publication resolved",
      });

      publicationText.createDiv({
        cls:
          "rl-publication-resolution-body",
        text:
          [
            publicationResolution.originalVenue
              ? `${publicationResolution.originalVenue} →`
              : "Preprint →",
            publicationResolution.formalVenue
              || this.meta.venue
              || "Formal publication",
            publicationResolution.confidence
              ? `${publicationResolution.confidence}%`
              : "",
          ]
            .filter(Boolean)
            .join(" "),
      });
    }

    const form =
      this.contentEl.createDiv({
        cls: "rl-import-form",
      });

    const field =
      (
        label,
        value,
        type = "text"
      ) => {
        const wrap =
          form.createDiv({
            cls: "rl-import-field",
          });

        wrap.createEl(
          "label",
          {
            text: label,
          }
        );

        const input =
          wrap.createEl(
            "input",
            {
              value:
                value == null
                  ? ""
                  : String(value),
              attr: {
                type,
              },
            }
          );

        return input;
      };

    this.titleInput =
      field(
        "Title",
        this.meta.title
      );

    this.authorsInput =
      field(
        "Authors",
        (this.meta.authors || [])
          .join("; ")
      );

    this.yearInput =
      field(
        "Year",
        this.meta.year,
        "number"
      );

    this.venueInput =
      field(
        "Venue",
        this.meta.venue
      );

    this.doiInput =
      field(
        "DOI",
        this.meta.doi
      );

    const details =
      form.createDiv({
        cls: "rl-import-detected",
      });

    details.createDiv({
      cls: "rl-import-detected-title",
      text: "Detected from PDF",
    });

    details.createDiv({
      text:
        `DOI: ${this.signals.doi || "—"}`,
    });

    details.createDiv({
      text:
        `arXiv: ${this.signals.arxiv || "—"}`,
    });

    const footer =
      this.contentEl.createDiv({
        cls: "rl-import-modal-footer",
      });

    const cancel =
      footer.createEl(
        "button",
        {
          text: "Cancel",
          attr: {
            type: "button",
          },
        }
      );

    cancel.addEventListener(
      "click",
      () => {
        this.completed = true;
        this.onCancel?.();
        this.close();
      }
    );

    const confirm =
      footer.createEl(
        "button",
        {
          cls: "mod-cta",
          text: "Import",
          attr: {
            type: "button",
          },
        }
      );

    confirm.addEventListener(
      "click",
      () => {
        const title =
          this.titleInput
            .value
            .trim();

        if (!title) {
          new Notice(
            "Title 不能为空"
          );

          return;
        }

        const yearRaw =
          this.yearInput
            .value
            .trim();

        const authors =
          this.authorsInput
            .value
            .split(
              /\s*;\s*|\s*\n\s*/
            )
            .map(
              (value) =>
                value.trim()
            )
            .filter(Boolean);

        this.meta.title =
          title;

        this.meta.authors =
          authors;

        this.meta.year =
          yearRaw
            ? Number(yearRaw)
            : "";

        this.meta.venue =
          this.venueInput
            .value
            .trim();

        this.meta.doi =
          this.doiInput
            .value
            .trim()
            .replace(
              /^https?:\/\/(dx\.)?doi\.org\//i,
              ""
            )
            .toLowerCase();

        if (
          this.meta.doi
        ) {
          this.meta.url =
            `https://doi.org/${this.meta.doi}`;
        }

        this.completed = true;
        this.onImport?.(
          this.meta
        );

        this.close();
      }
    );
  }

  onClose() {
    if (!this.completed) {
      this.onCancel?.();
    }

    this.contentEl.empty();
  }
}




class ResearchLibrarySettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Research Library" });

    new Setting(containerEl)
      .setName("Papers folder")
      .setDesc("相对于 Vault 根目录的论文 Markdown 文件夹。")
      .addText((text) =>
        text
          .setPlaceholder("Research/10 Papers")
          .setValue(this.plugin.settings.papersFolder)
          .onChange(async (value) => {
            this.plugin.settings.papersFolder = normalizePath(value.trim());
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Topics folder")
      .setDesc("新增 Topic 时使用的 Obsidian 链接目录。")
      .addText((text) =>
        text
          .setPlaceholder("Research/30 Topics")
          .setValue(
            this.plugin.settings.topicsFolder
            || "Research/30 Topics"
          )
          .onChange(async (value) => {
            this.plugin.settings.topicsFolder =
              normalizePath(
                value.trim()
              );

            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Lists folder")
      .setDesc("人工文献 List 的定义笔记目录；已有 Vault 无需迁移。")
      .addText((text) =>
        text
          .setPlaceholder("Research/40 Collections")
          .setValue(
            this.plugin.settings.collectionsFolder
            || "Research/40 Collections"
          )
          .onChange(async (value) => {
            this.plugin.settings.collectionsFolder =
              normalizePath(
                value.trim()
              );

            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Projects folder")
      .setDesc("Project 定义笔记目录；论文 YAML 仍只保存 Project 名称。")
      .addText((text) =>
        text
          .setPlaceholder("Research/50 Projects")
          .setValue(
            this.plugin.settings.projectsFolder
            || "Research/50 Projects"
          )
          .onChange(async (value) => {
            this.plugin.settings.projectsFolder =
              normalizePath(
                value.trim()
              );

            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Figures folder")
      .setDesc("从 Library 添加的模型图 / 论文图片保存目录。")
      .addText((text) =>
        text
          .setPlaceholder("Research/25 Figures")
          .setValue(
            this.plugin.settings.figuresFolder
            || "Research/25 Figures"
          )
          .onChange(async (value) => {
            this.plugin.settings.figuresFolder =
              normalizePath(
                value.trim()
              );

            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", {
      text:
        "Citation",
    });

    new Setting(containerEl)
      .setName(
        "Bibliography file"
      )
      .setDesc(
        "由 Paper Markdown/YAML 自动生成的 BibTeX 文件。默认 Research/99 System/library.bib；该文件不是 Paper 数据源。"
      )
      .addText((text) =>
        text
          .setPlaceholder(
            "Research/99 System/library.bib"
          )
          .setValue(
            this.plugin.settings
              .bibFilePath
            || "Research/99 System/library.bib"
          )
          .onChange(async (value) => {
            const normalized =
              normalizePath(
                value.trim()
              );

            this.plugin.settings
              .bibFilePath =
              normalized;

            await this.plugin
              .saveSettings();

            if (
              this.plugin.currentModal
              && this.plugin.settings
                .autoSyncBibliography
            ) {
              await this.plugin
                .currentModal
                .syncBibliographyIfEnabled();
            }
          })
      );

    new Setting(containerEl)
      .setName(
        "Auto-sync library.bib"
      )
      .setDesc(
        "打开 Library、手工修改 Paper YAML 或在 Detail 编辑引用元数据后自动重建 library.bib。"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(
            Boolean(
              this.plugin.settings
                .autoSyncBibliography
            )
          )
          .onChange(async (value) => {
            this.plugin.settings
              .autoSyncBibliography =
              value;

            await this.plugin
              .saveSettings();

            if (
              value
              && this.plugin.currentModal
            ) {
              await this.plugin
                .currentModal
                .syncBibliography({
                  notice:
                    true,
                });
            }
          })
      );

    const bibSyncSetting =
      new Setting(containerEl)
        .setName(
          "Sync bibliography now"
        )
        .setDesc(
          "检查 Citekey 后，从当前 Paper YAML 重建完整 library.bib。"
        );

    bibSyncSetting
      .addButton((button) =>
        button
          .setButtonText(
            "Sync library.bib"
          )
          .onClick(async () => {
            button
              .setDisabled(
                true
              );

            try {
              if (
                !this.plugin
                  .currentModal
              ) {
                this.plugin
                  .openLibrary();

                await new Promise(
                  (resolve) =>
                    window.setTimeout(
                      resolve,
                      180
                    )
                );
              }

              await this.plugin
                .currentModal
                ?.syncBibliography({
                  notice:
                    true,
                });
            }
            catch (error) {
              new Notice(
                error?.message
                || "Bibliography sync failed",
                7000
              );
            }
            finally {
              button
                .setDisabled(
                  false
                );
            }
          })
      );

    containerEl.createEl("h3", {
      text: "PDF-first Import",
    });

    new Setting(containerEl)
      .setName("PDF Inbox folder")
      .setDesc("物理 PDF 收件箱，仅用于尚未导入的 PDF；与论文的 Unsorted/待整理 状态无关。")
      .addText((text) =>
        text
          .setPlaceholder("Research/00 Inbox")
          .setValue(
            this.plugin.settings.inboxFolder
            || "Research/00 Inbox"
          )
          .onChange(async (value) => {
            this.plugin.settings.inboxFolder =
              normalizePath(value.trim());

            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("PDF library folder")
      .setDesc("确认导入后 PDF 自动改名并归档到这里。")
      .addText((text) =>
        text
          .setPlaceholder("Research/20 PDFs")
          .setValue(
            this.plugin.settings.pdfFolder
            || "Research/20 PDFs"
          )
          .onChange(async (value) => {
            this.plugin.settings.pdfFolder =
              normalizePath(value.trim());

            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("PDF scan pages")
      .setDesc("读取 PDF 前多少页寻找 DOI、arXiv ID 与标题。")
      .addSlider((slider) =>
        slider
          .setLimits(1, 8, 1)
          .setValue(
            Number(this.plugin.settings.scanPages)
            || 3
          )
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.scanPages =
              value;

            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Metadata candidates")
      .setDesc("多源检索并重新排序后，最多展示多少条候选。")
      .addSlider((slider) =>
        slider
          .setLimits(3, 15, 1)
          .setValue(
            Number(this.plugin.settings.searchRows)
            || 8
          )
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.searchRows =
              value;

            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Crossref contact email")
      .setDesc("可选。用于 Crossref polite pool，不会写入论文 Markdown。")
      .addText((text) =>
        text
          .setPlaceholder("name@example.com")
          .setValue(
            this.plugin.settings.contactEmail
            || ""
          )
          .onChange(async (value) => {
            this.plugin.settings.contactEmail =
              value.trim();

            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Progressive search thresholds")
      .setDesc(
        "CS-first 策略：Semantic Scholar 高置信时直接采用；否则优先补 OpenReview + DBLP + PMLR 精确标题；仍不可靠时再补 OpenAlex + Crossref。429 会自动退避重试并缓存成功结果。"
      );

    new Setting(containerEl)
      .setName("Semantic Scholar API key")
      .setDesc("可选。留空也可使用公共接口；填写个人免费 API key 可获得独立限流。密钥保存在本机插件 data.json。")
      .addText((text) =>
        text
          .setPlaceholder("Optional")
          .setValue(
            this.plugin.settings.semanticScholarApiKey
            || ""
          )
          .onChange(async (value) => {
            this.plugin.settings.semanticScholarApiKey =
              value.trim();

            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("OpenAlex API key")
      .setDesc("可选。留空时尝试公共访问；如果你有 OpenAlex key，可在这里填写。密钥保存在本机插件 data.json。")
      .addText((text) =>
        text
          .setPlaceholder("Optional")
          .setValue(
            this.plugin.settings.openAlexApiKey
            || ""
          )
          .onChange(async (value) => {
            this.plugin.settings.openAlexApiKey =
              value.trim();

            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", {
      text: "LLM Metadata Rescue",
    });

    new Setting(containerEl)
      .setName("Enable LLM rescue")
      .setDesc(
        "仅当 DOI / arXiv / Semantic Scholar / OpenAlex / Crossref 都没有可靠匹配时调用。只发送 PDF 第 1 页截图和第 1 页提取文本，不发送整篇 PDF。"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(
            Boolean(
              this.plugin.settings
                .llmRescueEnabled
            )
          )
          .onChange(async (value) => {
            this.plugin.settings
              .llmRescueEnabled =
              value;

            await this.plugin
              .saveSettings();
          })
      );

    const llmEndpointSetting =
      new Setting(containerEl)
        .setName(
          "LLM Base URL / Endpoint"
        )
        .setDesc(
          "可填写 Base URL（例如 https://provider.example 或 https://provider.example/v1），插件会自动补全 /v1/chat/completions；也可以直接填写完整的 /chat/completions 地址。"
        );

    const llmEndpointPreview =
      llmEndpointSetting
        .settingEl
        .createDiv({
          cls:
            "rl-setting-endpoint-preview",
          text:
            this.plugin
              .resolveLlmChatCompletionsUrl()
              ? `实际请求：${this.plugin.resolveLlmChatCompletionsUrl()}`
              : "实际请求：—",
        });

    llmEndpointSetting
      .addText((text) =>
        text
          .setPlaceholder(
            "https://provider.example"
          )
          .setValue(
            this.plugin.settings
              .llmEndpoint
            || ""
          )
          .onChange(async (value) => {
            this.plugin.settings
              .llmEndpoint =
              value.trim();

            await this.plugin
              .saveSettings();

            const resolved =
              this.plugin
                .resolveLlmChatCompletionsUrl(
                  value
                );

            llmEndpointPreview
              .setText(
                resolved
                  ? `实际请求：${resolved}`
                  : "实际请求：—"
              );
          })
      );

    new Setting(containerEl)
      .setName("LLM API key")
      .setDesc(
        "可选；本地无需鉴权的兼容服务可留空。密钥仅保存在本机插件 data.json，不写入论文 Markdown。"
      )
      .addText((text) => {
        text.inputEl.type =
          "password";

        text
          .setPlaceholder(
            "Optional"
          )
          .setValue(
            this.plugin.settings
              .llmApiKey
            || ""
          )
          .onChange(async (value) => {
            this.plugin.settings
              .llmApiKey =
              value.trim();

            await this.plugin
              .saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Vision model")
      .setDesc(
        "填写你的 API 服务中支持图片输入的模型名称。插件不预设供应商模型。"
      )
      .addText((text) =>
        text
          .setPlaceholder(
            "vision-capable-model"
          )
          .setValue(
            this.plugin.settings
              .llmVisionModel
            || ""
          )
          .onChange(async (value) => {
            this.plugin.settings
              .llmVisionModel =
              value.trim();

            await this.plugin
              .saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("LLM timeout")
      .setDesc(
        "LLM 首页识别请求的最长等待时间（秒）。"
      )
      .addSlider((slider) =>
        slider
          .setLimits(
            10,
            90,
            5
          )
          .setValue(
            Number(
              this.plugin.settings
                .llmTimeoutSeconds
            ) || 30
          )
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings
              .llmTimeoutSeconds =
              value;

            await this.plugin
              .saveSettings();
          })
      );

    const llmTestSetting =
      new Setting(containerEl)
        .setName(
          "Test LLM connection"
        )
        .setDesc(
          "发送一个极小的纯文本请求，验证 Endpoint、API Key 与模型名称。测试不会上传 PDF 或图片。"
        );

    const llmTestStatus =
      llmTestSetting
        .settingEl
        .createDiv({
          cls:
            "rl-setting-test-status",
          text:
            "尚未测试",
        });

    llmTestSetting
      .addButton((button) =>
        button
          .setButtonText(
            "Test connection"
          )
          .setCta()
          .onClick(async () => {
            button
              .setDisabled(true);

            button
              .setButtonText(
                "Testing…"
              );

            llmTestStatus
              .removeClass(
                "is-success",
                "is-error"
              );

            llmTestStatus
              .setText(
                "正在连接…"
              );

            try {
              const result =
                await this.plugin
                  .testLlmConnection();

              llmTestStatus
                .addClass(
                  "is-success"
                );

              llmTestStatus
                .setText(
                  `连接成功 · ${result.model} · ${result.endpoint}`
                );

              new Notice(
                "LLM connection test passed."
              );
            }
            catch (error) {
              const message =
                error?.message
                || String(error);

              llmTestStatus
                .addClass(
                  "is-error"
                );

              llmTestStatus
                .setText(
                  message
                );

              new Notice(
                `LLM test failed: ${message}`,
                8000
              );
            }
            finally {
              button
                .setDisabled(false);

              button
                .setButtonText(
                  "Test connection"
                );
            }
          })
      );

    new Setting(containerEl)
      .setName("Default priority")
      .setDesc("新导入论文写入 frontmatter 的默认 priority。")
      .addSlider((slider) =>
        slider
          .setLimits(1, 5, 1)
          .setValue(
            Number(this.plugin.settings.defaultPriority)
            || 3
          )
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.defaultPriority =
              value;

            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Row density")
      .setDesc("控制论文表格的行高。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("comfortable", "Comfortable")
          .addOption("compact", "Compact")
          .setValue(this.plugin.settings.density)
          .onChange(async (value) => {
            this.plugin.settings.density = value;

            if (this.plugin.currentModal?.rootEl) {
              this.plugin.currentModal.rootEl.dataset.density = value;

              this.plugin.currentModal
                .resetVirtualMetrics();

              if (
                this.plugin.currentModal
                  .virtualTableActive
              ) {
                this.plugin.currentModal
                  .renderRows();
              }
            }

            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", {
      text: "Appearance",
    });

    const fontSetting =
      new Setting(containerEl)
        .setName("Font")
        .setDesc(
          "选择 Obsidian 已加载字体或本机系统字体。"
        );

    const fontDropdown =
      fontSetting
        .addDropdown((dropdown) => {
          dropdown
            .addOption(
              "obsidian-interface",
              "Obsidian · Interface"
            )
            .addOption(
              "obsidian-text",
              "Obsidian · Text"
            )
            .addOption(
              "obsidian-monospace",
              "Obsidian · Monospace"
            );

          const cached =
            Array.isArray(
              this.plugin.settings.systemFonts
            )
              ? this.plugin.settings.systemFonts
              : [];

          for (const family of cached) {
            dropdown.addOption(
              `system:${family}`,
              `System · ${family}`
            );
          }

          dropdown
            .setValue(
              this.plugin.settings.fontSource
              || "obsidian-interface"
            )
            .onChange(async (value) => {
              this.plugin.settings.fontSource =
                value;

              this.plugin.currentModal
                ?.applyAppearanceSettings();

              this.plugin.currentModal
                ?.resetVirtualMetrics();

              if (
                this.plugin.currentModal
                  ?.virtualTableActive
              ) {
                this.plugin.currentModal
                  .renderRows();
              }

              await this.plugin.saveSettings();
            });

          return dropdown;
        });

    fontSetting.addButton((button) =>
      button
        .setButtonText("Load system fonts")
        .setTooltip(
          "读取系统字体列表。若当前 Obsidian/Electron 支持，会使用本地字体访问 API；否则加载常见系统字体预设。"
        )
        .onClick(async () => {
          button
            .setButtonText("Loading…")
            .setDisabled(true);

          const fonts =
            await this.plugin
              .querySystemFonts();

          button
            .setButtonText("Load system fonts")
            .setDisabled(false);

          new Notice(
            `已加载 ${fonts.length} 个可选系统字体`
          );

          // Rebuild settings so the dropdown receives new options.
          this.display();
        })
    );

    new Setting(containerEl)
      .setName("Font size")
      .setDesc("调整论文库整体字号。范围 10–20 px。")
      .addSlider((slider) =>
        slider
          .setLimits(10, 20, 0.5)
          .setValue(
            Number(
              this.plugin.settings.fontSize
            ) || 13
          )
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.fontSize =
              value;

            this.plugin.currentModal
              ?.applyAppearanceSettings();

            this.plugin.currentModal
              ?.resetVirtualMetrics();

            if (
              this.plugin.currentModal
                ?.virtualTableActive
            ) {
              this.plugin.currentModal
                .renderRows();
            }

            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Reset appearance")
      .setDesc("恢复字体与字号默认值。")
      .addButton((button) =>
        button
          .setButtonText("Reset")
          .onClick(async () => {
            this.plugin.settings.fontSource =
              "obsidian-interface";

            this.plugin.settings.fontSize =
              13;

            this.plugin.currentModal
              ?.applyAppearanceSettings();

            this.plugin.currentModal
              ?.resetVirtualMetrics();

            if (
              this.plugin.currentModal
                ?.virtualTableActive
            ) {
              this.plugin.currentModal
                .renderRows();
            }

            await this.plugin.saveSettings();

            this.display();
          })
      );
  }
}

export default ResearchLibraryPlugin;

