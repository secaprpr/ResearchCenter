// User-provided Today Sidebar runtime; adaptations are recorded in PROVENANCE.json.

import {
  Plugin,
  ItemView,
  Modal,
  Notice,
  setIcon,
  PluginSettingTab,
  Setting,
  Menu,
  MarkdownRenderer,
} from "../obsidian.js";

const SIDEBAR_VIEW = "obsidian-today-sidebar";
const CENTER_VIEW = "obsidian-today-center";

function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clonePlain(value) {
  if (value == null) return value;
  if (typeof structuredClone === "function") {
    try { return structuredClone(value); } catch (_) {}
  }
  return JSON.parse(JSON.stringify(value));
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDateOnly(value) {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(value, amount) {
  const d = parseDateOnly(value);
  d.setDate(d.getDate() + amount);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Repeat dates are concrete calendar dates, not a floating "today" marker.
// Advance past the later of the scheduled day and the completion day so
// overdue repeats don't create a backlog of stale occurrences.
function nextRepeatDate(task, completedDay = todayISO()) {
  if (!task?.dueDate || !task.repeat?.type) return null;
  const base = task.dueDate > completedDay ? task.dueDate : completedDay;
  const { type } = task.repeat;
  if (type === "daily") return addDays(base, 1);
  if (type === "weekly") {
    const selected = (task.repeat.days || []).map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
    const weekdays = new Set(selected.length ? selected : [parseDateOnly(task.dueDate).getDay()]);
    for (let i = 1; i <= 7; i += 1) {
      const candidate = addDays(base, i);
      if (weekdays.has(parseDateOnly(candidate).getDay())) return candidate;
    }
  }
  if (type === "monthly") {
    const selected = (task.repeat.days || []).map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 31);
    const monthDays = [...new Set(selected.length ? selected : [parseDateOnly(task.dueDate).getDate()])].sort((a, b) => a - b);
    const origin = parseDateOnly(base);
    for (let offset = 0; offset <= 12; offset += 1) {
      const year = origin.getFullYear();
      const month = origin.getMonth() + offset;
      const maxDay = daysInMonth(year, month);
      for (const day of monthDays) {
        if (day > maxDay) continue; // E.g. the 31st skips February.
        const candidate = dateToISO(new Date(year, month, day));
        if (candidate > base) return candidate;
      }
    }
  }
  return null;
}

function completionDay(task) {
  const date = Number(task?.completedAt);
  if (!task?.done || !Number.isFinite(date) || date <= 0) return "";
  const completed = new Date(date);
  return Number.isFinite(completed.getTime()) ? dateToISO(completed) : "";
}

function dateToISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysBetween(a, b) {
  const start = typeof a === "string" ? parseDateOnly(a) : new Date(a);
  const end = typeof b === "string" ? parseDateOnly(b) : new Date(b);
  if (!start || !end) return 0;
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function dayDiff(value, base = todayISO()) {
  const a = parseDateOnly(value);
  const b = parseDateOnly(base);
  if (!a || !b) return 0;
  return Math.round((a.setHours(0, 0, 0, 0) - b.setHours(0, 0, 0, 0)) / 86400000);
}

function dateLabel(task) {
  if (!task.dueDate) return "无日期";
  const hasRange = task.startDate && task.startDate !== task.dueDate;
  let label;
  if (hasRange) {
    label = `${task.startDate.slice(5).replace("-", "/")}–${task.dueDate.slice(5).replace("-", "/")}`;
  } else {
    const diff = dayDiff(task.dueDate);
    label = task.dueDate.slice(5).replace("-", "/");
    if (diff === 0) label = "今天";
    else if (diff === 1) label = "明天";
    else if (diff === -1) label = "昨天";
    else if (diff < -1) label = `${Math.abs(diff)}天前`;
  }
  if (task.dueTime) {
    label += task.endTime ? ` ${task.dueTime}–${task.endTime}` : ` ${task.dueTime}`;
  }
  return label;
}

function compactTaskDateLabel(task) {
  if (!task?.dueDate) return "无日期";

  // In dense task surfaces, time is actionable only for today's tasks.
  // Past/future tasks stay scannable by showing their concrete date only.
  const diff = dayDiff(task.dueDate);
  if (diff === 0) {
    let label = "今天";
    if (task.dueTime) {
      label += task.endTime ? ` ${task.dueTime}–${task.endTime}` : ` ${task.dueTime}`;
    }
    return label;
  }

  const formatDate = (value) => {
    if (!value) return "";
    const [year, month, day] = value.split("-");
    const currentYear = todayISO().slice(0, 4);
    return year && year !== currentYear ? `${year}/${month}/${day}` : `${month}/${day}`;
  };

  if (task.startDate && task.startDate !== task.dueDate) {
    return `${formatDate(task.startDate)}–${formatDate(task.dueDate)}`;
  }
  return formatDate(task.dueDate);
}

function repeatLabel(task) {
  if (task.repeat?.type === "daily") return "每天";
  if (task.repeat?.type === "weekly") {
    const names = ["日", "一", "二", "三", "四", "五", "六"];
    const days = task.repeat.days || [];
    return days.length ? `每周 ${days.map((d) => names[d]).join("/")}` : "每周";
  }
  if (task.repeat?.type === "monthly") {
    const days = task.repeat.days || [];
    return days.length ? `每月 ${days.join("/")}日` : "每月";
  }
  return "";
}

const TODAY_POINTER_DRAG_THRESHOLD = 6;

function installPopoverDismiss(popover, anchor, onClose) {
  if (!popover) return () => {};
  const doc = popover.ownerDocument || document;
  const win = doc.defaultView || window;
  const inside = (target) => {
    if (!(target instanceof Node)) return false;
    return popover.contains(target) || !!anchor?.contains?.(target);
  };
  const closeIfOutside = (event) => {
    if (!inside(event.target)) onClose?.();
  };
  const onWindowBlur = () => onClose?.();
  const onVisibilityChange = () => { if (doc.hidden) onClose?.(); };

  doc.addEventListener("pointerdown", closeIfOutside, true);
  doc.addEventListener("focusin", closeIfOutside, true);
  win.addEventListener("blur", onWindowBlur);
  doc.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    doc.removeEventListener("pointerdown", closeIfOutside, true);
    doc.removeEventListener("focusin", closeIfOutside, true);
    win.removeEventListener("blur", onWindowBlur);
    doc.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

function installPopoverKeyboard(popover, anchor, onClose, options = {}) {
  if (!popover) return () => {};
  const itemSelector = options.itemSelector || ".today-menu-row:not(:disabled), [role='menuitem']:not([aria-disabled='true']), [role='menuitemcheckbox']:not([aria-disabled='true']), [role='menuitemradio']:not([aria-disabled='true'])";
  if (anchor?.setAttribute) {
    anchor.setAttribute("aria-haspopup", options.ariaHasPopup || "dialog");
    anchor.setAttribute("aria-expanded", "true");
  }

  const items = () => [...new Set([...popover.querySelectorAll(itemSelector)])]
    .filter((el) => !el.disabled && el.getAttribute("aria-disabled") !== "true" && el.offsetParent !== null);
  const isTextEntry = (el) => el?.matches?.("input, textarea, [contenteditable='true']");
  const focusAt = (index) => {
    const list = items();
    if (!list.length) return;
    const next = list[(index + list.length) % list.length];
    next?.focus?.({ preventScroll: true });
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose?.();
      if (anchor?.isConnected) requestAnimationFrame(() => anchor.focus?.({ preventScroll: true }));
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const list = items();
    if (!list.length) return;
    const active = popover.ownerDocument?.activeElement;
    const current = list.indexOf(active);
    if (isTextEntry(active)) {
      if (event.key === "ArrowDown") { event.preventDefault(); focusAt(0); }
      else if (event.key === "ArrowUp") { event.preventDefault(); focusAt(list.length - 1); }
      return;
    }
    event.preventDefault();
    if (event.key === "Home") return focusAt(0);
    if (event.key === "End") return focusAt(list.length - 1);
    if (current < 0) return focusAt(event.key === "ArrowDown" ? 0 : list.length - 1);
    focusAt(current + (event.key === "ArrowDown" ? 1 : -1));
  };

  popover.addEventListener("keydown", onKeyDown);
  return () => {
    popover.removeEventListener("keydown", onKeyDown);
    if (anchor?.getAttribute?.("aria-expanded") === "true") anchor.setAttribute("aria-expanded", "false");
  };
}


function withDemoData(data) { return data; }

function normalizeData(raw) {
  const defaultFolder = { id: "folder-default", name: "默认", pinned: false, order: 0, viewMode: "list", timelineCollapsedLists: [] };
  const seed = {
    version: 8,
    composerMode: "compact",
    folders: [defaultFolder],
    lists: [
      { id: "inbox", name: "收集箱", color: "neutral", system: true, folderId: null, viewMode: "list", groups: [] },
      { id: "work", name: "工作", color: "blue", folderId: defaultFolder.id, viewMode: "list", groups: [] },
      { id: "study", name: "学习", color: "violet", folderId: defaultFolder.id, viewMode: "list", groups: [] },
      { id: "life", name: "生活", color: "green", folderId: defaultFolder.id, viewMode: "list", groups: [] },
      { id: "fitness", name: "健身", color: "orange", folderId: defaultFolder.id, viewMode: "list", groups: [] },
    ],
    tasks: [],
    settings: {
      centerScale: 1.30,
      centerWidth: 1480,
      centerHeight: 920,
      centerSidebarWidth: 250,
      centerDetailWidth: 360,
      taskContentFontSize: 15,
      sizingVersion: 3,
      taskCenterDisplayVersion: 2,
      taskCenterDisplay: {
        hideCompleted: false,
        showDetails: false,
        hideChecklist: false,
        smartTodayView: "list",
        smartWeekView: "list",
      },
    },
  };
  if (!raw) return withDemoData(seed);

  const incomingFolders = Array.isArray(raw.folders) && raw.folders.length
    ? raw.folders
    : seed.folders;
  const allowedViews = new Set(["list", "board", "timeline"]);
  const folders = incomingFolders.map((folder, index) => ({
    id: folder.id || uid(),
    name: folder.name || `文件夹 ${index + 1}`,
    pinned: !!folder.pinned,
    order: Number.isFinite(folder.order) ? folder.order : index,
    viewMode: allowedViews.has(folder.viewMode) ? folder.viewMode : "list",
    timelineCollapsedLists: Array.isArray(folder.timelineCollapsedLists) ? [...new Set(folder.timelineCollapsedLists.filter(Boolean))] : [],
  }));
  if (!folders.length) folders.push({ ...defaultFolder });
  const folderIds = new Set(folders.map((folder) => folder.id));
  const fallbackFolderId = folders[0].id;
  const rawLists = Array.isArray(raw.lists) && raw.lists.length ? raw.lists : seed.lists;
  const lists = rawLists.map((list) => ({
    ...list,
    id: list.id || uid(),
    name: list.name || "未命名清单",
    color: list.color || "neutral",
    system: !!list.system || list.id === "inbox",
    folderId: (list.system || list.id === "inbox") ? null : (folderIds.has(list.folderId) ? list.folderId : fallbackFolderId),
    viewMode: allowedViews.has(list.viewMode) ? list.viewMode : "list",
    timelineCollapsedGroups: Array.isArray(list.timelineCollapsedGroups) ? [...new Set(list.timelineCollapsedGroups.filter(Boolean))] : [],
    groups: Array.isArray(list.groups)
      ? list.groups.map((group, index) => ({
          id: group.id || uid(),
          name: group.name || `分组 ${index + 1}`,
          order: Number.isFinite(group.order) ? group.order : index,
        }))
      : [],
  }));
  if (!lists.some((list) => list.id === "inbox")) lists.unshift({ ...seed.lists[0] });

  const listById = new Map(lists.map((list) => [list.id, list]));
  const tasks = (Array.isArray(raw.tasks) ? raw.tasks : []).map((task, taskIndex) => {
    const list = listById.get(task.listId) || listById.get("inbox") || lists[0];
    const validGroups = new Set((list?.groups || []).map((group) => group.id));
    return {
      ...task,
      title: typeof task.title === "string" && task.title.trim() ? task.title : "未命名任务",
      content: typeof task.content === "string" ? task.content : "",
      checklist: Array.isArray(task.checklist)
        ? task.checklist.map((item, index) => ({
            id: item?.id || `check-${task.id || "task"}-${index}-${uid()}`,
            text: typeof item === "string" ? item : String(item?.text || item?.title || "").trim(),
            done: !!(typeof item === "object" && item?.done),
          })).filter((item) => item.text)
        : [],
      attachments: Array.isArray(task.attachments)
        ? task.attachments.filter(Boolean)
        : (task.attachment ? [task.attachment] : []),
      attachment: task.attachment || "",
      parentTaskId: task.parentTaskId || null,
      relatedTaskIds: Array.isArray(task.relatedTaskIds) ? [...new Set(task.relatedTaskIds.filter(Boolean))] : [],
      relatedNotePaths: Array.isArray(task.relatedNotePaths) ? [...new Set(task.relatedNotePaths.filter(Boolean))] : [],
      startDate: task.startDate || "",
      dueDate: task.dueDate || "",
      dueTime: task.dueTime || "",
      endTime: task.endTime || "",
      priority: Number(task.priority || 0),
      tags: Array.isArray(task.tags) ? [...new Set(task.tags.filter(Boolean))] : [],
      repeat: task.repeat || null,
      timelineRole: task.timelineRole === "project" ? "project" : "",
      timelineItems: Array.isArray(task.timelineItems)
        ? task.timelineItems.map((item) => ({
            id: item?.id || uid(),
            type: item?.type === "milestone" ? "milestone" : "phase",
            title: String(item?.title || "").trim() || (item?.type === "milestone" ? "节点" : "阶段"),
            startDate: item?.startDate || "",
            endDate: item?.endDate || "",
            date: item?.date || "",
          })).filter((item) => item.type === "milestone" ? !!item.date : !!(item.startDate && item.endDate))
        : [],
      windowStart: task.windowStart || "",
      windowEnd: task.windowEnd || "",
      createdAt: Number(task.createdAt || Date.now()),
      updatedAt: Number(task.updatedAt || task.createdAt || Date.now()),
      sortOrder: Number.isFinite(Number(task.sortOrder)) ? Number(task.sortOrder) : taskIndex * 1000,
      listId: list?.id || "inbox",
      groupId: validGroups.has(task.groupId) ? task.groupId : null,
    };
  });
  // v8 keeps subtasks as first-class Task records. Older builds briefly
  // flattened parentTaskId relationships into Markdown checklists; from this
  // version forward we preserve the relationship and only repair invalid or
  // cyclic parent references.
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const taskIds = new Set(tasks.map((task) => task.id));
  const appendLegacyChecklist = (task) => {
    const items = Array.isArray(task.checklist) ? task.checklist : [];
    const lines = items
      .filter((item) => item && String(item.text || item.title || "").trim())
      .map((item) => `- [${item.done ? "x" : " "}] ${String(item.text || item.title || "").trim()}`);
    if (!lines.length) return;
    const block = lines.join("\n");
    const existing = String(task.content || "").trimEnd();
    if (!existing.includes(block)) task.content = existing ? `${existing}\n\n${block}` : block;
  };
  for (const task of tasks) {
    appendLegacyChecklist(task);
    delete task.checklist;
    if (!task.parentTaskId || task.parentTaskId === task.id || !taskIds.has(task.parentTaskId)) {
      task.parentTaskId = null;
    }
    task.relatedTaskIds = (task.relatedTaskIds || []).filter((id) => id !== task.id && taskIds.has(id));
  }
  // Break parent cycles defensively. A task may have at most one parent, so a
  // simple ancestor walk is enough and avoids corrupting the detail breadcrumb.
  for (const task of tasks) {
    const seen = new Set([task.id]);
    let current = task;
    while (current?.parentTaskId) {
      if (seen.has(current.parentTaskId)) {
        task.parentTaskId = null;
        break;
      }
      seen.add(current.parentTaskId);
      current = taskById.get(current.parentTaskId);
      if (!current) break;
    }
  }

  return withDemoData({
    ...seed,
    ...raw,
    version: 8,
    folders,
    lists,
    tasks,
    settings: (() => {
      const incoming = { ...seed.settings, ...(raw.settings || {}) };
      const sizingVersion = Number((raw.settings || {}).sizingVersion || 0);
      if (sizingVersion < 2) {
        const oldScale = Number((raw.settings || {}).centerScale ?? 1.15);
        const oldWidth = Number((raw.settings || {}).centerWidth ?? 1120);
        const oldHeight = Number((raw.settings || {}).centerHeight ?? 780);
        if (Math.abs(oldScale - 1.15) < 0.001 && oldWidth === 1120 && oldHeight === 780) {
          incoming.centerScale = 1.25;
          incoming.centerWidth = 1380;
          incoming.centerHeight = 880;
        }
      }
      if (sizingVersion < 3) {
        const currentScale = Number(incoming.centerScale ?? 1.25);
        const currentWidth = Number(incoming.centerWidth ?? 1380);
        const currentHeight = Number(incoming.centerHeight ?? 880);
        if (Math.abs(currentScale - 1.25) < 0.001 && currentWidth === 1380 && currentHeight === 880) {
          incoming.centerScale = 1.30;
          incoming.centerWidth = 1480;
          incoming.centerHeight = 920;
        }
      }
      incoming.sizingVersion = 3;
      const displayRaw = incoming.taskCenterDisplay || {};
      const displayVersion = Number((raw.settings || {}).taskCenterDisplayVersion || 0);
      incoming.taskCenterDisplay = {
        hideCompleted: !!displayRaw.hideCompleted,
        // v2 corrects the 0.10.6 misunderstanding: the persistent Content pane
        // is always present, while per-row "显示详细" returns to opt-in.
        showDetails: displayVersion < 2 ? false : !!displayRaw.showDetails,
        hideChecklist: !!displayRaw.hideChecklist,
        smartTodayView: ["list", "board"].includes(displayRaw.smartTodayView) ? displayRaw.smartTodayView : "list",
        smartWeekView: allowedViews.has(displayRaw.smartWeekView) ? displayRaw.smartWeekView : "list",
      };
      incoming.taskCenterDisplayVersion = 2;
      return incoming;
    })(),
  });
}


// ---------- v0.18.38 — P1 motion + action feedback ----------
// Centralized motion layer for task feedback, detail/view transitions and
// transient surfaces. Keep the amplitudes restrained; timing/continuity carry
// the feedback rather than decorative motion.
class TodayMotionController {
  constructor(plugin) {
    this.plugin = plugin;
    this.pendingTasks = new Map();
    this.pendingDetail = null;
    this.pendingViewEntry = null;
    this.pendingLayout = null;
    // Selection transitions belong to a persistent docked pane, not to the
    // MutationObserver that animates newly mounted spatial detail modals.
    this.dockedDetailAnimations = new WeakMap();
    this.observer = null;
    this.reducedQuery = typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    this.duration = {
      instant: 90,
      hover: 130,
      surface: 190,
      detail: 235,
      feedback: 255,
      layout: 290,
      exit: 215,
    };
    this.easeOut = "cubic-bezier(.2,.8,.2,1)";
    this.easeStandard = "cubic-bezier(.4,0,.2,1)";
  }

  get reduced() {
    return !!this.reducedQuery?.matches;
  }

  animate(el, keyframes, options = {}) {
    if (!el || !el.animate || this.reduced) return null;
    try {
      return el.animate(keyframes, {
        duration: options.duration ?? this.duration.surface,
        easing: options.easing ?? this.easeOut,
        fill: options.fill ?? "both",
        delay: options.delay ?? 0,
      });
    } catch (_) {
      return null;
    }
  }

  start() {
    if (typeof document === "undefined" || !document.body || typeof MutationObserver === "undefined") return;
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes || []) {
          if (!(node instanceof HTMLElement)) continue;
          this.handleAdded(node);
        }
      }
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  dispose() {
    this.observer?.disconnect();
    this.observer = null;
    this.pendingTasks.clear();
    this.pendingDetail = null;
    this.pendingViewEntry = null;
    this.pendingLayout = null;
    this.dockedDetailAnimations = new WeakMap();
  }

  cancelDockedDetailTransition(pane) {
    if (!pane) return;
    for (const animation of this.dockedDetailAnimations.get(pane) || []) {
      try { animation.cancel(); } catch (_) {}
    }
    this.dockedDetailAnimations.delete(pane);
  }

  animateDockedDetailContent(pane) {
    if (!pane) return;
    this.cancelDockedDetailTransition(pane);
    if (this.reduced || !pane.classList?.contains("today-task-detail")) return;
    // The pane itself never moves: only the freshly rendered document content
    // gets a very small, non-blocking transition. No await / queued exit phase.
    const animations = [];
    const title = pane.querySelector?.(".today-task-detail-title");
    const body = pane.querySelector?.(".today-task-detail-content-wrap");
    const titleAnim = this.animate(title, [
      { opacity: .84 }, { opacity: 1 },
    ], { duration: 100, fill: "none" });
    const bodyAnim = this.animate(body, [
      { opacity: .9, transform: "translateY(2px)" },
      { opacity: 1, transform: "translateY(0)" },
    ], { duration: 120, fill: "none" });
    if (titleAnim) animations.push(titleAnim);
    if (bodyAnim) animations.push(bodyAnim);
    if (animations.length) this.dockedDetailAnimations.set(pane, animations);
  }

  taskSelector(taskId, detail = false) {
    if (!taskId) return "";
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(taskId) : String(taskId).replace(/["\\]/g, "\\$&");
    return detail
      ? `[data-today-detail-task-id="${escaped}"]`
      : `[data-today-task-id="${escaped}"]`;
  }

  visibleNodes(selector) {
    if (!selector || typeof document === "undefined") return [];
    return [...document.querySelectorAll(selector)].filter((el) => el instanceof HTMLElement && el.offsetParent !== null);
  }

  captureTaskLayout(scope = document) {
    const positions = new Map();
    if (this.reduced || !scope?.querySelectorAll) return positions;
    for (const el of scope.querySelectorAll("[data-today-task-id]")) {
      if (!(el instanceof HTMLElement) || el.offsetParent === null) continue;
      const taskId = el.dataset.todayTaskId;
      if (!taskId || positions.has(taskId)) continue;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      positions.set(taskId, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    }
    return positions;
  }

  captureTaskLayoutByIds(taskIds, scope = document) {
    const ids = taskIds instanceof Set ? taskIds : new Set(taskIds || []);
    const positions = new Map();
    if (this.reduced || !ids.size || !scope?.querySelectorAll) return positions;
    for (const el of scope.querySelectorAll("[data-today-task-id]")) {
      if (!(el instanceof HTMLElement) || el.offsetParent === null) continue;
      const taskId = el.dataset.todayTaskId;
      if (!taskId || !ids.has(taskId) || positions.has(taskId)) continue;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      positions.set(taskId, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    }
    return positions;
  }

  prepareTaskLayoutTransition(positions, draggedTaskId = "") {
    if (this.reduced || !positions?.size) { this.pendingLayout = null; return; }
    const entry = { positions, draggedTaskId, expiresAt: Date.now() + 1100, seen: new WeakSet() };
    this.pendingLayout = entry;
    window.setTimeout(() => {
      if (this.pendingLayout === entry) this.pendingLayout = null;
    }, 1150);
  }

  primaryTaskLayoutScope() {
    if (typeof document === "undefined") return null;
    return document.querySelector(".today-center-workspace .today-center-main")
      || document.querySelector(".today-plugin-center .today-center-main")
      || null;
  }

  prepareVisibleTaskLayoutTransition(draggedTaskId = "", taskIds = null) {
    if (this.reduced) return;
    const scope = this.primaryTaskLayoutScope();
    if (!scope) return;
    const positions = taskIds
      ? this.captureTaskLayoutByIds(taskIds, scope)
      : this.captureTaskLayout(scope);
    this.prepareTaskLayoutTransition(positions, draggedTaskId);
  }

  animatePendingLayout(el) {
    const pending = this.pendingLayout;
    if (!pending || pending.expiresAt < Date.now() || !el?.dataset?.todayTaskId || pending.seen.has(el)) return;
    pending.seen.add(el);
    const taskId = el.dataset.todayTaskId;
    if (taskId === pending.draggedTaskId) return;
    const previous = pending.positions.get(taskId);
    if (!previous || el.offsetParent === null) return;
    const current = el.getBoundingClientRect();
    const dx = previous.left - current.left;
    const dy = previous.top - current.top;
    if ((Math.abs(dx) < 1 && Math.abs(dy) < 1) || Math.abs(dx) > 1400 || Math.abs(dy) > 1400) return;
    this.animate(el, [
      { transform: `translate(${dx}px, ${dy}px)` },
      { transform: "translate(0, 0)" },
    ], { duration: this.duration.layout, easing: this.easeOut, fill: "none" });
  }

  markTaskChange(taskId, type = "update") {
    if (!taskId) return;
    const entry = { type, expiresAt: Date.now() + 1200, seen: new WeakSet() };
    this.pendingTasks.set(taskId, entry);
    window.setTimeout(() => {
      if (this.pendingTasks.get(taskId) === entry) this.pendingTasks.delete(taskId);
    }, 1250);
  }

  markDetailSwitch(taskId, source = "detail") {
    if (!taskId) return;
    this.pendingDetail = { taskId, source, expiresAt: Date.now() + 1000 };
  }

  markViewSwitch(kind = "view") {
    this.pendingViewEntry = { kind, expiresAt: Date.now() + 1100 };
  }

  handleAdded(root) {
    const surfaceSelectors = [
      ".today-task-detail-footer-floating",
      ".today-task-detail-footer-popover",
      ".today-task-detail-priority-popover",
      ".today-task-detail-date-popover",
    ];
    for (const selector of surfaceSelectors) {
      const nodes = root.matches?.(selector) ? [root] : [...(root.querySelectorAll?.(selector) || [])];
      for (const el of nodes) this.enterSurface(el, selector.includes("footer-floating") ? "toolbar" : "popover");
    }

    const viewPending = this.pendingViewEntry && this.pendingViewEntry.expiresAt >= Date.now();
    if (viewPending) {
      const viewNodes = root.matches?.(".today-center-main, .today-center-tag-view, .today-center-calendar, .today-center-stats") ? [root] : [...(root.querySelectorAll?.(".today-center-main, .today-center-tag-view, .today-center-calendar, .today-center-stats") || [])];
      for (const el of viewNodes) this.enterView(el);
      if (viewNodes.length) this.pendingViewEntry = null;
    }

    const detailNodes = root.matches?.(".today-task-detail") ? [root] : [...(root.querySelectorAll?.(".today-task-detail") || [])];
    for (const el of detailNodes) this.enterDetailIfNeeded(el);

    const taskNodes = [];
    if (root.matches?.("[data-today-task-id]")) taskNodes.push(root);
    taskNodes.push(...(root.querySelectorAll?.("[data-today-task-id]") || []));
    for (const el of taskNodes) {
      this.animatePendingLayout(el);
      this.animatePendingTask(el);
      this.animateSelectionArrival(el);
    }
  }

  enterSurface(el, kind = "popover") {
    if (!el || el.dataset.todayMotionEntered === "1") return;
    el.dataset.todayMotionEntered = "1";
    const isToolbar = kind === "toolbar";
    this.animate(el, [
      { opacity: 0, transform: `translateY(${isToolbar ? 6 : 4}px) scale(${isToolbar ? .995 : .985})` },
      { opacity: 1, transform: "translateY(0) scale(1)" },
    ], { duration: isToolbar ? 225 : this.duration.surface });
  }

  enterView(el) {
    if (!el || el.dataset.todayViewMotionEntered === "1") return;
    el.dataset.todayViewMotionEntered = "1";
    this.animate(el, [
      { opacity: .62, transform: "translateY(3px)" },
      { opacity: 1, transform: "translateY(0)" },
    ], { duration: this.duration.detail });
  }

  enterDetailIfNeeded(el) {
    if (!el || el.dataset.todayMotionEntered === "1") return;
    const taskId = el.dataset.todayDetailTaskId || "";
    const pending = this.pendingDetail;
    const isPending = !!pending && pending.expiresAt >= Date.now() && (!taskId || pending.taskId === taskId);
    const isAnchoredModal = !!el.closest?.(".today-task-detail-modal");
    if (!isPending && !isAnchoredModal) return;
    el.dataset.todayMotionEntered = "1";
    this.animate(el, [
      { opacity: .48, transform: "translateY(5px) scale(.996)" },
      { opacity: 1, transform: "translateY(0) scale(1)" },
    ], { duration: this.duration.detail });
    if (isPending) this.pendingDetail = null;
  }

  animateSelectionArrival(el) {
    const pending = this.pendingDetail;
    if (!pending || pending.expiresAt < Date.now()) return;
    if (el?.dataset?.todayTaskId !== pending.taskId || !el.classList.contains("is-selected")) return;
    if (el.dataset.todaySelectionMotion === "1") return;
    el.dataset.todaySelectionMotion = "1";
    this.animate(el, [
      { opacity: .82 },
      { opacity: 1 },
    ], { duration: this.duration.surface });
  }

  animatePendingTask(el) {
    const taskId = el?.dataset?.todayTaskId;
    if (!taskId) return;
    const entry = this.pendingTasks.get(taskId);
    if (!entry || entry.expiresAt < Date.now() || entry.seen.has(el)) return;
    entry.seen.add(el);
    const type = entry.type;

    if (type === "select") {
      this.animate(el, [
        { opacity: .78 },
        { opacity: 1 },
      ], { duration: this.duration.surface });
    } else if (type === "complete" || type === "restore") {
      this.animate(el, [
        { opacity: .62 },
        { opacity: 1 },
      ], { duration: this.duration.feedback });
      const check = el.querySelector?.(".today-check.is-done, .today-center-check.is-done, .today-center-board-card-check.is-done");
      if (check) this.animate(check, [
        { transform: "scale(.76)", opacity: .55 },
        { transform: "scale(1.075)", opacity: 1, offset: .68 },
        { transform: "scale(1)", opacity: 1 },
      ], { duration: 285, easing: "cubic-bezier(.2,.9,.25,1)" });
    } else if (type === "move") {
      this.animate(el, [
        { opacity: .32, transform: "translateY(-6px) scale(.996)" },
        { opacity: 1, transform: "translateY(0) scale(1)" },
      ], { duration: this.duration.feedback });
    } else if (type === "add") {
      this.animate(el, [
        { opacity: 0, transform: "translateY(-6px) scale(.994)" },
        { opacity: 1, transform: "translateY(0) scale(1)" },
      ], { duration: this.duration.feedback });
    } else if (type === "priority" || type === "date" || type === "update") {
      this.animate(el, [
        { opacity: .7 },
        { opacity: 1 },
      ], { duration: 230 });
      const meta = type === "priority"
        ? el.querySelector?.("[class*='priority-'], .today-center-task-title")
        : el.querySelector?.(".today-center-task-side-end, .today-center-board-card-meta, .today-pill.is-due");
      if (meta) this.animate(meta, [
        { opacity: .35, transform: "translateY(1px)" },
        { opacity: 1, transform: "translateY(0)" },
      ], { duration: 245 });
    }
  }

  async previewTaskToggle(taskId, completing) {
    if (this.reduced) return;
    const nodes = [
      ...this.visibleNodes(this.taskSelector(taskId)),
      ...this.visibleNodes(this.taskSelector(taskId, true)),
    ];
    if (!nodes.length) return;
    for (const node of nodes) {
      const check = node.matches?.(".today-task-detail")
        ? node.querySelector?.(".today-task-detail-complete")
        : node.querySelector?.(".today-check, .today-center-check, .today-center-board-card-check");
      const title = node.querySelector?.(".today-task-title, .today-center-task-title, .today-center-board-card-title, .today-task-detail-title");
      if (check) this.animate(check, [
        { transform: "scale(1)" },
        { transform: "scale(.78)", offset: .44 },
        { transform: "scale(1.06)", offset: .78 },
        { transform: "scale(1)" },
      ], { duration: 245 });
      if (title) this.animate(title, completing ? [
        { opacity: 1 },
        { opacity: .54 },
      ] : [
        { opacity: .58 },
        { opacity: 1 },
      ], { duration: 190, fill: "forwards" });
    }
    await new Promise((resolve) => window.setTimeout(resolve, 125));
  }

  async previewTaskMove(taskId) {
    if (this.reduced) return;
    const nodes = this.visibleNodes(this.taskSelector(taskId));
    if (!nodes.length) return;
    for (const el of nodes) {
      const isSpatial = el.matches?.(".today-center-timeline-bar, .today-center-timeline-project-plan, .today-center-timeline-context-item");
      this.animate(el, isSpatial ? [
        { opacity: 1 },
        { opacity: .58 },
      ] : [
        { opacity: 1, transform: "translateX(0)" },
        { opacity: .58, transform: "translateX(3px)" },
      ], { duration: 175, easing: this.easeStandard });
    }
    await new Promise((resolve) => window.setTimeout(resolve, 90));
  }

  async exitTask(taskId, type = "delete") {
    if (this.reduced || typeof document === "undefined") return;
    const nodes = this.visibleNodes(this.taskSelector(taskId));
    if (!nodes.length) return;
    const animations = nodes.map((el) => {
      const isSpatial = el.matches?.(".today-center-timeline-bar, .today-center-timeline-project-plan, .today-center-timeline-context-item");
      return this.animate(el, isSpatial ? [
        { opacity: 1 },
        { opacity: .05 },
      ] : [
        { opacity: 1, transform: "translateX(0) scale(1)" },
        { opacity: .05, transform: `translateX(${type === "delete" ? 8 : 4}px) scale(.99)` },
      ], { duration: this.duration.exit, easing: this.easeStandard });
    }).filter(Boolean);
    await Promise.allSettled(animations.map((animation) => animation.finished));
  }

  async exitDetail(el) {
    if (!el?.isConnected || this.reduced) return;
    const animation = this.animate(el, [
      { opacity: 1, transform: "translateY(0)" },
      { opacity: .25, transform: "translateY(2px)" },
    ], { duration: 115, easing: this.easeStandard });
    if (animation) await animation.finished.catch(() => {});
  }

  async exitView(el) {
    if (!el?.isConnected || this.reduced) return;
    const animation = this.animate(el, [
      { opacity: 1, transform: "translateY(0)" },
      { opacity: .5, transform: "translateY(-2px)" },
    ], { duration: 125, easing: this.easeStandard });
    if (animation) await animation.finished.catch(() => {});
  }

  removeWithExit(el, kind = "surface") {
    if (!el?.isConnected) return;
    if (this.reduced || !el.animate) { el.remove(); return; }
    const animation = this.animate(el, [
      { opacity: 1, transform: kind === "toast" ? "translate(-50%, 0)" : "translateY(0) scale(1)" },
      { opacity: 0, transform: kind === "toast" ? "translate(-50%, 6px)" : "translateY(3px) scale(.99)" },
    ], { duration: 185, easing: this.easeStandard });
    if (!animation) { el.remove(); return; }
    animation.finished.catch(() => {}).finally(() => el.remove());
  }
}


// ---------- v0.18.43 — unified floating placement infrastructure ----------
// A small placement layer inspired by Floating UI's flip + shift model.  It
// keeps positioning separate from surface animation so popovers can share one
// collision policy without coupling their lifecycle or visual treatment.
class TodayFloatingController {
  constructor() {
    this.cleanups = new Set();
  }

  rectOf(anchorOrRect) {
    if (!anchorOrRect) return null;
    if (typeof anchorOrRect.getBoundingClientRect === "function") return anchorOrRect.getBoundingClientRect();
    if (["left", "top", "right", "bottom"].every((key) => Number.isFinite(anchorOrRect[key]))) return anchorOrRect;
    return null;
  }

  oppositeSide(side) {
    return ({ top: "bottom", bottom: "top", left: "right", right: "left" })[side] || side;
  }

  parsePlacement(placement = "bottom-start") {
    const [rawSide, rawAlign] = String(placement || "bottom-start").split("-");
    const side = ["top", "bottom", "left", "right"].includes(rawSide) ? rawSide : "bottom";
    const align = ["start", "end", "center"].includes(rawAlign) ? rawAlign : "start";
    return { side, align };
  }

  coords(anchorRect, floatingRect, side, align, gap = 8, crossOffset = 0) {
    let left = anchorRect.left;
    let top = anchorRect.bottom + gap;
    if (side === "top") top = anchorRect.top - floatingRect.height - gap;
    if (side === "left") left = anchorRect.left - floatingRect.width - gap;
    if (side === "right") left = anchorRect.right + gap;

    if (side === "top" || side === "bottom") {
      if (align === "end") left = anchorRect.right - floatingRect.width;
      else if (align === "center") left = anchorRect.left + (anchorRect.width - floatingRect.width) / 2;
      left += crossOffset;
    } else {
      if (align === "end") top = anchorRect.bottom - floatingRect.height;
      else if (align === "center") top = anchorRect.top + (anchorRect.height - floatingRect.height) / 2;
      top += crossOffset;
    }
    return { left, top };
  }

  mainAxisFits(coords, floatingRect, side, pad) {
    if (side === "top") return coords.top >= pad;
    if (side === "bottom") return coords.top + floatingRect.height <= window.innerHeight - pad;
    if (side === "left") return coords.left >= pad;
    return coords.left + floatingRect.width <= window.innerWidth - pad;
  }

  place(floating, anchorOrRect, options = {}) {
    if (!floating?.getBoundingClientRect) return null;
    const anchorRect = this.rectOf(anchorOrRect);
    if (!anchorRect) return null;
    const measuredRect = floating.getBoundingClientRect();
    // offsetWidth/offsetHeight are not affected by the small enter scale used by
    // popover motion, so collision math stays stable while a surface animates.
    const floatingRect = {
      ...measuredRect,
      width: floating.offsetWidth || measuredRect.width,
      height: floating.offsetHeight || measuredRect.height,
    };
    const pad = Number(options.padding ?? 10);
    const gap = Number(options.gap ?? 8);
    const crossOffset = Number(options.crossOffset ?? 0);
    const preferred = this.parsePlacement(options.placement || "bottom-start");
    let actual = { ...preferred };
    let coords = this.coords(anchorRect, floatingRect, actual.side, actual.align, gap, crossOffset);

    if (options.flip !== false && !this.mainAxisFits(coords, floatingRect, actual.side, pad)) {
      const flippedSide = this.oppositeSide(actual.side);
      const flipped = this.coords(anchorRect, floatingRect, flippedSide, actual.align, gap, crossOffset);
      if (this.mainAxisFits(flipped, floatingRect, flippedSide, pad)) {
        actual.side = flippedSide;
        coords = flipped;
      }
    }

    if (options.shift !== false) {
      coords.left = Math.max(pad, Math.min(coords.left, window.innerWidth - floatingRect.width - pad));
      coords.top = Math.max(pad, Math.min(coords.top, window.innerHeight - floatingRect.height - pad));
    }

    floating.style.left = `${Math.round(coords.left)}px`;
    floating.style.top = `${Math.round(coords.top)}px`;
    if (options.strategy) floating.style.position = options.strategy;
    floating.dataset.side = actual.side;
    floating.dataset.align = actual.align;
    floating.dataset.placement = `${actual.side}-${actual.align}`;
    return { ...coords, ...actual };
  }

  autoUpdate(floating, anchor, options = {}) {
    if (!floating || !anchor?.getBoundingClientRect) return () => {};
    let frame = 0;
    const update = () => {
      if (!floating.isConnected || !anchor.isConnected) return;
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        this.place(floating, anchor, options);
      });
    };
    const onScroll = () => update();
    const onResize = () => update();
    window.addEventListener("resize", onResize);
    document.addEventListener("scroll", onScroll, true);
    let observer = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(update);
      try { observer.observe(anchor); observer.observe(floating); } catch (_) {}
    }
    const cleanup = () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("scroll", onScroll, true);
      observer?.disconnect?.();
      this.cleanups.delete(cleanup);
    };
    this.cleanups.add(cleanup);
    update();
    return cleanup;
  }

  dispose() {
    for (const cleanup of [...this.cleanups]) {
      try { cleanup(); } catch (_) {}
    }
    this.cleanups.clear();
  }
}


class TodayUndoController {
  constructor(plugin) {
    this.plugin = plugin;
    this.current = null;
    this.toastEl = null;
    this.timer = null;
    this.isRestoring = false;
  }

  clear({ removeToast = true } = {}) {
    if (this.timer) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.current = null;
    if (removeToast && this.toastEl?.isConnected) {
      const toast = this.toastEl;
      if (this.plugin.motionController) this.plugin.motionController.removeWithExit(toast, "toast");
      else toast.remove();
    }
    this.toastEl = null;
  }

  push(label, undo, { duration = 5200 } = {}) {
    if (this.isRestoring || typeof undo !== "function") return;
    this.clear();
    const entry = { id: uid(), label: String(label || "操作已完成"), undo };
    this.current = entry;
    this.render(entry);
    this.timer = window.setTimeout(() => {
      if (this.current?.id === entry.id) this.clear();
    }, duration);
  }

  render(entry) {
    if (typeof document === "undefined") return;
    const toast = document.createElement("div");
    toast.className = "today-plugin-root today-undo-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");

    const message = document.createElement("span");
    message.className = "today-undo-toast-message";
    message.textContent = entry.label;

    const action = document.createElement("button");
    action.type = "button";
    action.className = "today-undo-toast-action";
    action.textContent = "撤销";
    action.addEventListener("click", async () => {
      if (this.current?.id !== entry.id || this.isRestoring) return;
      if (this.timer) {
        window.clearTimeout(this.timer);
        this.timer = null;
      }
      this.isRestoring = true;
      action.disabled = true;
      try {
        await entry.undo();
        message.textContent = "已撤销";
        action.remove();
        toast.classList.add("is-undone");
        this.current = null;
        this.timer = window.setTimeout(() => this.clear(), 1400);
      } catch (error) {
        console.error("[Today] Undo failed", error);
        message.textContent = "撤销失败";
        action.remove();
        this.current = null;
        this.timer = window.setTimeout(() => this.clear(), 1800);
      } finally {
        this.isRestoring = false;
      }
    });

    toast.append(message, action);
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    this.toastEl = toast;
  }

  showError(label, retry = null, { duration = 7000 } = {}) {
    if (typeof document === "undefined") return;
    this.clear();
    const toast = document.createElement("div");
    toast.className = "today-plugin-root today-undo-toast is-error";
    toast.setAttribute("role", "alert");
    toast.setAttribute("aria-live", "assertive");

    const message = document.createElement("span");
    message.className = "today-undo-toast-message";
    message.textContent = String(label || "操作失败");
    toast.appendChild(message);

    if (typeof retry === "function") {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "today-undo-toast-action";
      action.textContent = "重试";
      action.addEventListener("click", async () => {
        if (this.timer) { window.clearTimeout(this.timer); this.timer = null; }
        action.disabled = true;
        try {
          const result = await retry();
          if (result === false) {
            message.textContent = "仍然无法保存";
            action.disabled = false;
            this.timer = window.setTimeout(() => this.clear(), 5200);
            return;
          }
          message.textContent = "已保存";
          action.remove();
          toast.classList.remove("is-error");
          toast.classList.add("is-undone");
          this.timer = window.setTimeout(() => this.clear(), 1400);
        } catch (error) {
          console.error("[Today] Retry failed", error);
          message.textContent = "仍然无法保存";
          action.disabled = false;
        }
      });
      toast.appendChild(action);
    }

    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    this.toastEl = toast;
    this.timer = window.setTimeout(() => this.clear(), duration);
  }

  dispose() {
    this.clear();
  }
}

class TaskStore {
  constructor(plugin) {
    this.plugin = plugin;
    this.data = plugin.data;
    this.listeners = new Set();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async changed() {
    const saved = await this.plugin.saveData(this.data);
    for (const fn of this.listeners) fn();
    return saved !== false;
  }

  priorityChangeAffectsVisibleLayout() {
    try {
      const leaves = this.plugin.app?.workspace?.getLeavesOfType?.(CENTER_VIEW) || [];
      return leaves.some((leaf) => {
        const view = leaf?.view;
        if (!view || view.tab !== "lists") return false;
        const groupedByPriority = typeof view.currentGroupMode === "function" && view.currentGroupMode() === "priority";
        const sortedByPriority = view.listViewOptions?.sort === "priority";
        return groupedByPriority || sortedByPriority;
      });
    } catch (error) {
      console.warn("[Today] Could not resolve priority layout context", error);
      return false;
    }
  }

  getList(id) {
    return this.data.lists.find((l) => l.id === id) || this.data.lists[0];
  }

  getFolder(id) {
    return this.data.folders.find((folder) => folder.id === id) || null;
  }

  getGroups(listId) {
    const list = this.getList(listId);
    return [...(list?.groups || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  getGroup(listId, groupId) {
    if (!groupId) return null;
    return this.getGroups(listId).find((group) => group.id === groupId) || null;
  }

  getTask(id) {
    return this.data.tasks.find((task) => task.id === id) || null;
  }


  topLevelTasks() {
    return this.data.tasks.filter((task) => !task.parentTaskId);
  }

  // One source of truth for every tag picker and the tag management view.
  // Subtasks have independent tags and must be included here.
  getAllTags() {
    return [...new Set(this.data.tasks.flatMap((task) => task.tags || []).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "zh-CN"));
  }

  normalizedTag(value) {
    return String(value || "").trim().replace(/^#+/, "").trim();
  }

  async changeTag(source, target, { mode = "rename", undo = true } = {}) {
    const from = this.normalizedTag(source);
    const to = this.normalizedTag(target);
    const all = this.getAllTags();
    if (!from || !all.includes(from)) throw new Error("原标签已不存在");
    if (!["rename", "merge", "delete"].includes(mode)) throw new Error("不支持的标签操作");
    if (mode !== "delete") {
      if (!to) throw new Error("标签名称不能为空");
      if (to === from) throw new Error("目标标签不能与原标签相同");
      if (mode === "rename" && all.some((name) => name !== from && name.toLocaleLowerCase() === to.toLocaleLowerCase())) {
        throw new Error("目标标签已存在，请使用合并标签");
      }
      if (mode === "merge" && !all.includes(to)) throw new Error("请选择一个已有的目标标签");
    }
    const affected = this.data.tasks.filter((task) => (task.tags || []).includes(from));
    if (!affected.length) throw new Error("没有使用此标签的任务");
    const before = affected.map((task) => ({ id: task.id, tags: [...task.tags], updatedAt: task.updatedAt }));
    const now = Date.now();
    for (const task of affected) {
      task.tags = [...new Set((task.tags || []).flatMap((tag) => tag === from ? (mode === "delete" ? [] : [to]) : [tag]))];
      task.updatedAt = now;
    }
    const saved = await this.changed();
    // TodayPlugin.saveData shows an actionable retry toast on disk failure.
    // Do not overwrite that error with an Undo toast while data is only in memory.
    if (saved && undo && !this.plugin.undoController?.isRestoring) {
      const label = mode === "delete" ? `已移除标签 #${from}` :
        mode === "merge" ? `已将 #${from} 合并到 #${to}` : `已重命名为 #${to}`;
      this.plugin.undoController?.push(label, async () => {
        for (const previous of before) {
          const task = this.getTask(previous.id);
          if (task) {
            task.tags = [...previous.tags];
            task.updatedAt = previous.updatedAt;
          }
        }
        await this.changed();
      });
    }
    return { source: from, target: mode === "delete" ? "" : to, count: affected.length };
  }

  renameTag(from, to, options = {}) { return this.changeTag(from, to, { ...options, mode: "rename" }); }
  mergeTag(from, to, options = {}) { return this.changeTag(from, to, { ...options, mode: "merge" }); }
  deleteTag(from, options = {}) { return this.changeTag(from, "", { ...options, mode: "delete" }); }

  childTasks(parentTaskId) {
    if (!parentTaskId) return [];
    return this.data.tasks
      .filter((task) => task.parentTaskId === parentTaskId)
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || Number(a.createdAt || 0) - Number(b.createdAt || 0));
  }

  subtaskProgress(parentTaskId) {
    const children = this.childTasks(parentTaskId);
    return { total: children.length, done: children.filter((task) => task.done).length };
  }

  taskAncestors(taskOrId) {
    const task = typeof taskOrId === "string" ? this.getTask(taskOrId) : taskOrId;
    if (!task) return [];
    const ancestors = [];
    const seen = new Set([task.id]);
    let parentId = task.parentTaskId;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = this.getTask(parentId);
      if (!parent) break;
      ancestors.unshift(parent);
      parentId = parent.parentTaskId;
    }
    return ancestors;
  }

  descendantTaskIds(parentTaskId) {
    const ids = [];
    const visit = (id) => {
      for (const child of this.childTasks(id)) {
        ids.push(child.id);
        visit(child.id);
      }
    };
    visit(parentTaskId);
    return ids;
  }

  taskTree(id) {
    return [id, ...this.descendantTaskIds(id)].map((taskId) => this.getTask(taskId)).filter(Boolean);
  }

  captureContainers(tasks) {
    return tasks.map(({ id, listId, groupId, updatedAt }) => ({ id, listId, groupId, updatedAt }));
  }

  moveTreeContainer(tasks, listId, groupId, time = Date.now()) {
    for (const task of tasks) {
      task.listId = listId;
      task.groupId = groupId;
      task.updatedAt = time;
    }
  }

  restoreContainers(snapshots) {
    for (const snapshot of snapshots) {
      const task = this.getTask(snapshot.id);
      if (task) Object.assign(task, snapshot);
    }
  }

  createRepeatOccurrence(task) {
    const nextDate = nextRepeatDate(task);
    if (!nextDate) return [];
    const shiftDays = daysBetween(task.dueDate, nextDate);
    const originalTree = this.taskTree(task.id);
    const ids = new Map(originalTree.map((entry) => [entry.id, uid()]));
    const now = Date.now();
    return originalTree.map((entry) => {
      const copy = clonePlain(entry);
      copy.id = ids.get(entry.id);
      copy.parentTaskId = ids.get(entry.parentTaskId) || entry.parentTaskId || null;
      copy.repeatSeriesId = entry.repeatSeriesId || entry.id;
      copy.done = false;
      copy.completedAt = null;
      copy.createdAt = now;
      copy.updatedAt = now;
      copy.checklist = (copy.checklist || []).map((item) => ({ ...item, id: uid(), done: false }));
      // Task content may contain Markdown checkboxes rather than `checklist`
      // records. Reset those too without altering other Markdown content.
      if (typeof copy.content === "string") {
        copy.content = copy.content.replace(/^(\s*(?:[-*+]|\d+\.)\s+\[)[xX](\])/gm, "$1 $2");
      }
      // Preserve durations and explicitly scheduled child offsets.
      for (const key of ["startDate", "dueDate", "windowStart", "windowEnd"]) {
        if (copy[key]) copy[key] = addDays(copy[key], shiftDays);
      }
      if (Array.isArray(copy.timelineItems)) {
        copy.timelineItems = copy.timelineItems.map((item) => {
          const next = { ...item, id: uid() };
          for (const key of ["date", "startDate", "endDate"]) {
            if (next[key]) next[key] = addDays(next[key], shiftDays);
          }
          return next;
        });
      }
      return copy;
    });
  }

  async addSubtask(parentTaskId, input = {}) {
    const parent = this.getTask(parentTaskId);
    if (!parent) return null;
    return this.addTask({
      ...input,
      parentTaskId: parent.id,
      listId: input.listId || parent.listId,
      groupId: Object.prototype.hasOwnProperty.call(input, "groupId") ? input.groupId : parent.groupId,
      dueDate: Object.prototype.hasOwnProperty.call(input, "dueDate") ? input.dueDate : "",
      dueTime: Object.prototype.hasOwnProperty.call(input, "dueTime") ? input.dueTime : "",
      endTime: Object.prototype.hasOwnProperty.call(input, "endTime") ? input.endTime : "",
    });
  }

  async updateTaskParent(id, parentTaskId = null, { undo = true } = {}) {
    const task = this.getTask(id);
    if (!task) return false;
    const nextParent = parentTaskId ? this.getTask(parentTaskId) : null;
    if (parentTaskId && (!nextParent || nextParent.id === task.id)) return false;
    if (nextParent && this.descendantTaskIds(task.id).includes(nextParent.id)) return false;
    const previousParent = task.parentTaskId ? this.getTask(task.parentTaskId) : null;
    const before = { parentTaskId: task.parentTaskId || null, listId: task.listId, groupId: task.groupId || null, sortOrder: task.sortOrder, updatedAt: task.updatedAt };
    const descendants = this.taskTree(task.id).slice(1);
    const descendantBefore = this.captureContainers(descendants);
    task.parentTaskId = nextParent?.id || null;
    if (nextParent) {
      task.listId = nextParent.listId;
      task.groupId = nextParent.groupId || null;
      this.moveTreeContainer(descendants, task.listId, task.groupId);
      const siblings = this.childTasks(nextParent.id).filter((item) => item.id !== task.id);
      const maxOrder = siblings.map((item) => Number(item.sortOrder)).filter(Number.isFinite);
      task.sortOrder = maxOrder.length ? Math.max(...maxOrder) + 1000 : 0;
    } else if (previousParent) {
      // Detaching a subtask should place it close to its former parent instead
      // of inheriting a child-only order that may send it to an arbitrary end
      // of the top-level list.
      task.sortOrder = Number(previousParent.sortOrder || 0) + 0.5;
    }
    task.updatedAt = Date.now();
    await this.changed();
    if (undo && !this.plugin.undoController?.isRestoring) {
      this.plugin.undoController?.push(nextParent ? `已设为「${nextParent.title}」的子任务` : "已移出父任务", async () => {
        const current = this.getTask(id);
        if (!current) return;
        Object.assign(current, clonePlain(before));
        this.restoreContainers(descendantBefore);
        await this.changed();
      });
    }
    return true;
  }

  async reorderSubtask(id, beforeTaskId = null, { undo = true } = {}) {
    const task = this.getTask(id);
    if (!task?.parentTaskId) return false;
    const siblings = this.childTasks(task.parentTaskId).filter((item) => item.id !== id);
    const beforeSnapshot = siblings.concat(task).map((item) => ({ id: item.id, sortOrder: Number(item.sortOrder || 0), updatedAt: item.updatedAt }));
    const targetIndex = beforeTaskId ? Math.max(0, siblings.findIndex((item) => item.id === beforeTaskId)) : siblings.length;
    siblings.splice(targetIndex < 0 ? siblings.length : targetIndex, 0, task);
    siblings.forEach((item, index) => { item.sortOrder = index * 1000; item.updatedAt = Date.now(); });
    await this.changed();
    if (undo && !this.plugin.undoController?.isRestoring) {
      this.plugin.undoController?.push("已调整子任务顺序", async () => {
        for (const snapshot of beforeSnapshot) {
          const current = this.getTask(snapshot.id);
          if (!current) continue;
          current.sortOrder = snapshot.sortOrder;
          current.updatedAt = snapshot.updatedAt;
        }
        await this.changed();
      });
    }
    return true;
  }

  async addTask(input) {
    const list = this.getList(input.listId || "inbox");
    const validGroups = new Set((list?.groups || []).map((group) => group.id));
    const now = Date.now();
    const task = {
      id: uid(),
      title: (input.title || "").trim() || "未命名任务",
      content: typeof input.content === "string" ? input.content : "",
      done: !!input.done,
      createdAt: now,
      updatedAt: now,
      completedAt: input.done ? now : null,
      sortOrder: (() => {
        if (input.parentTaskId) {
          const siblingOrders = this.data.tasks
            .filter((item) => item.parentTaskId === input.parentTaskId)
            .map((item) => Number(item.sortOrder))
            .filter(Number.isFinite);
          return siblingOrders.length ? Math.max(...siblingOrders) + 1000 : 0;
        }
        const orders = this.data.tasks.filter((item) => !item.parentTaskId).map((item) => Number(item.sortOrder)).filter(Number.isFinite);
        return orders.length ? Math.min(...orders) - 1000 : 0;
      })(),
      priority: input.priority || 0,
      listId: list?.id || "inbox",
      groupId: validGroups.has(input.groupId) ? input.groupId : null,
      tags: [...new Set((input.tags || []).map((t) => t.trim()).filter(Boolean))],
      attachment: input.attachment || "",
      attachments: [...new Set((input.attachments || (input.attachment ? [input.attachment] : [])).filter(Boolean))],
      relatedTaskIds: [...new Set((input.relatedTaskIds || []).filter(Boolean))],
      relatedNotePaths: [...new Set((input.relatedNotePaths || []).filter(Boolean))],
      parentTaskId: input.parentTaskId || null,
      startDate: input.startDate || "",
      dueDate: Object.prototype.hasOwnProperty.call(input, "dueDate") ? (input.dueDate || "") : (input.parentTaskId ? "" : todayISO()),
      dueTime: (input.dueDate === "" || (input.parentTaskId && !Object.prototype.hasOwnProperty.call(input, "dueDate"))) ? "" : (input.dueTime || "23:59"),
      endTime: input.dueDate === "" ? "" : (input.endTime || ""),
      repeat: input.repeat || null,
      timelineRole: input.timelineRole === "project" ? "project" : "",
      timelineItems: Array.isArray(input.timelineItems) ? input.timelineItems.map((item) => ({ ...item, id: item.id || uid() })) : [],
      windowStart: input.windowStart || "",
      windowEnd: input.windowEnd || "",
    };
    // A child task does not participate in the top-level Task Center layout.
    // Capturing the whole visible task layout here caused the subsequent store
    // render to treat every rebuilt top-level row as a layout-transition
    // candidate, so adding one subtask made the whole list appear to enter
    // again. Keep the generic add animation for the newly created child, but
    // only prepare top-level FLIP layout when the new task is itself top-level.
    if (!task.parentTaskId) this.plugin.motionController?.prepareVisibleTaskLayoutTransition(task.id);
    this.data.tasks.unshift(task);
    this.plugin.motionController?.markTaskChange(task.id, "add");
    await this.changed();
    return task;
  }


  async toggleTask(id, { undo = true } = {}) {
    const task = this.data.tasks.find((t) => t.id === id);
    if (!task) return;
    const before = {
      done: !!task.done,
      completedAt: task.completedAt ?? null,
      updatedAt: task.updatedAt,
    };
    const title = task.title || "任务";
    await this.plugin.motionController?.previewTaskToggle(id, !task.done);
    // Child tasks are rendered inside the parent detail tree and are not part of
    // the top-level Task Center layout. Capturing the whole visible layout here
    // causes every rebuilt row to participate in FLIP after a subtask is
    // completed/restored, which looks like the entire list re-entering. Only
    // top-level task toggles prepare a global layout transition.
    if (!task.parentTaskId) this.plugin.motionController?.prepareVisibleTaskLayoutTransition(id);
    task.done = !task.done;
    task.completedAt = task.done ? Date.now() : null;
    task.updatedAt = Date.now();
    const nowDone = task.done;
    const nextOccurrence = nowDone ? this.createRepeatOccurrence(task) : [];
    if (nextOccurrence.length) {
      this.data.tasks.unshift(...nextOccurrence);
      this.plugin.motionController?.markTaskChange(nextOccurrence[0].id, "add");
    }
    this.plugin.motionController?.markTaskChange(id, nowDone ? "complete" : "restore");
    await this.changed();

    if (undo && !this.plugin.undoController?.isRestoring) {
      this.plugin.undoController?.push(nowDone ? `已完成「${title}」` : `已恢复「${title}」`, async () => {
        const current = this.getTask(id);
        if (!current) return;
        current.done = before.done;
        current.completedAt = before.completedAt;
        current.updatedAt = before.updatedAt;
        if (nextOccurrence.length) {
          const createdIds = new Set(nextOccurrence.map((item) => item.id));
          this.data.tasks = this.data.tasks.filter((item) => !createdIds.has(item.id));
        }
        this.plugin.motionController?.markTaskChange(id, before.done ? "complete" : "restore");
        await this.changed();
      });
    }
  }

  async updateTask(id, patch, { undoLabel = "", undo = true } = {}) {
    const task = this.data.tasks.find((t) => t.id === id);
    if (!task) return;
    const keys = Object.keys(patch || {});
    const before = {};
    for (const key of keys) before[key] = clonePlain(task[key]);
    const beforeUpdatedAt = task.updatedAt;
    const descendants = this.taskTree(id).slice(1);
    const descendantBefore = this.captureContainers(descendants);
    const layoutKeys = new Set(["done", "completedAt", "listId", "groupId", "dueDate", "startDate", "sortOrder"]);
    const priorityAffectsLayout = keys.includes("priority") && this.priorityChangeAffectsVisibleLayout();
    if (priorityAffectsLayout || keys.some((key) => layoutKeys.has(key))) {
      this.plugin.motionController?.prepareVisibleTaskLayoutTransition(id);
    }

    Object.assign(task, patch);
    task.updatedAt = Date.now();
    if (keys.includes("listId") || keys.includes("groupId")) {
      const list = this.data.lists.find((item) => item.id === task.listId);
      if (!list) task.listId = this.getList(before.listId)?.id || "inbox";
      const target = this.getList(task.listId);
      if (!target?.groups?.some((group) => group.id === task.groupId)) task.groupId = null;
      this.moveTreeContainer(descendants, task.listId, task.groupId, task.updatedAt);
    }
    if (Array.isArray(task.attachments)) task.attachments = [...new Set(task.attachments.filter(Boolean))];
    if (Array.isArray(task.tags)) task.tags = [...new Set(task.tags.filter(Boolean))];
    const dateKeys = new Set(["startDate", "dueDate", "dueTime", "endTime", "repeat"]);
    if (keys.length === 1 && keys[0] === "priority") this.plugin.motionController?.markTaskChange(id, "priority");
    else if (keys.some((key) => dateKeys.has(key))) this.plugin.motionController?.markTaskChange(id, "date");
    await this.changed();

    if (undo && undoLabel && !this.plugin.undoController?.isRestoring) {
      this.plugin.undoController?.push(undoLabel, async () => {
        const current = this.getTask(id);
        if (!current) return;
        for (const key of keys) current[key] = clonePlain(before[key]);
        current.updatedAt = beforeUpdatedAt;
        this.restoreContainers(descendantBefore);
        await this.changed();
      });
    }
  }

  async applyTaskDrag(id, { listId = null, groupId = undefined, patch = {}, previousTaskId = null, beforeTaskId = null, undoLabel = "", undo = true } = {}) {
    const task = this.getTask(id);
    if (!task) return false;
    const targetList = this.data.lists.find((item) => item.id === (listId || task.listId));
    if (!targetList) return false;
    const requestedGroup = groupId === undefined ? task.groupId : groupId;
    const validGroup = requestedGroup && (targetList.groups || []).some((group) => group.id === requestedGroup) ? requestedGroup : null;
    // Drag targets can carry task-state semantics in addition to container/date
    // changes. Keep completedAt in sync whenever a drop explicitly changes
    // `done`, so moving between time buckets behaves exactly like toggling the
    // task's completion state and Undo can restore both fields together.
    const normalizedPatch = { ...(patch || {}) };
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, "done") && !Object.prototype.hasOwnProperty.call(normalizedPatch, "completedAt")) {
      normalizedPatch.completedAt = normalizedPatch.done
        ? (task.done && task.completedAt ? task.completedAt : Date.now())
        : null;
    }
    const patchKeys = Object.keys(normalizedPatch).filter((key) => !["id", "listId", "groupId", "sortOrder"].includes(key));
    const before = {
      listId: task.listId,
      groupId: task.groupId || null,
      sortOrder: Number.isFinite(Number(task.sortOrder)) ? Number(task.sortOrder) : 0,
      updatedAt: task.updatedAt,
      patch: Object.fromEntries(patchKeys.map((key) => [key, clonePlain(task[key])])),
    };
    const descendants = this.taskTree(id).slice(1);
    const descendantBefore = this.captureContainers(descendants);
    const wasDone = !!task.done;

    const prev = previousTaskId && previousTaskId !== id ? this.getTask(previousTaskId) : null;
    const next = beforeTaskId && beforeTaskId !== id ? this.getTask(beforeTaskId) : null;
    const prevOrder = prev && Number.isFinite(Number(prev.sortOrder)) ? Number(prev.sortOrder) : null;
    const nextOrder = next && Number.isFinite(Number(next.sortOrder)) ? Number(next.sortOrder) : null;
    let sortOrder = before.sortOrder;
    if (prevOrder != null && nextOrder != null) {
      sortOrder = prevOrder < nextOrder ? (prevOrder + nextOrder) / 2 : prevOrder + 0.5;
    } else if (prevOrder != null) sortOrder = prevOrder + 1;
    else if (nextOrder != null) sortOrder = nextOrder - 1;
    else {
      const orders = this.data.tasks.filter((item) => item.id !== id).map((item) => Number(item.sortOrder)).filter(Number.isFinite);
      sortOrder = orders.length ? Math.max(...orders) + 1 : 0;
    }

    task.listId = targetList.id;
    task.groupId = validGroup;
    if (before.listId !== targetList.id || before.groupId !== validGroup) {
      this.moveTreeContainer(descendants, targetList.id, validGroup);
    }
    for (const key of patchKeys) task[key] = clonePlain(normalizedPatch[key]);
    task.sortOrder = sortOrder;
    task.updatedAt = Date.now();
    const nextOccurrence = !wasDone && task.done ? this.createRepeatOccurrence(task) : [];
    if (nextOccurrence.length) this.data.tasks.unshift(...nextOccurrence);
    this.plugin.motionController?.markTaskChange(id, "move");
    await this.changed();

    const semanticChanged = before.listId !== task.listId || before.groupId !== (task.groupId || null) || patchKeys.some((key) => JSON.stringify(before.patch[key]) !== JSON.stringify(task[key]));
    const orderChanged = Math.abs(before.sortOrder - Number(task.sortOrder || 0)) > 1e-7;
    if (undo && !this.plugin.undoController?.isRestoring && (semanticChanged || orderChanged)) {
      this.plugin.undoController?.push(undoLabel || (semanticChanged ? "已移动任务" : "已调整任务顺序"), async () => {
        const current = this.getTask(id);
        if (!current) return;
        current.listId = before.listId;
        current.groupId = before.groupId;
        current.sortOrder = before.sortOrder;
        for (const key of patchKeys) current[key] = clonePlain(before.patch[key]);
        current.updatedAt = before.updatedAt;
        if (nextOccurrence.length) {
          const createdIds = new Set(nextOccurrence.map((item) => item.id));
          this.data.tasks = this.data.tasks.filter((item) => !createdIds.has(item.id));
        }
        this.restoreContainers(descendantBefore);
        this.plugin.motionController?.markTaskChange(id, "move");
        await this.changed();
      });
    }
    return true;
  }

  async updateTaskContainer(id, listId, groupId = null, { undo = true } = {}) {
    const task = this.getTask(id);
    const list = this.data.lists.find((item) => item.id === listId);
    if (!task || !list) return;
    const before = { listId: task.listId, groupId: task.groupId || null, updatedAt: task.updatedAt };
    const descendants = this.taskTree(id).slice(1);
    const descendantBefore = this.captureContainers(descendants);
    const validGroup = groupId && (list.groups || []).some((group) => group.id === groupId) ? groupId : null;
    if (before.listId !== list.id || before.groupId !== validGroup) {
      await this.plugin.motionController?.previewTaskMove(id);
      this.plugin.motionController?.prepareVisibleTaskLayoutTransition(id);
    }
    task.listId = list.id;
    task.groupId = validGroup;
    task.updatedAt = Date.now();
    if (before.listId !== list.id || before.groupId !== validGroup) {
      this.moveTreeContainer(descendants, list.id, validGroup, task.updatedAt);
    }
    this.plugin.motionController?.markTaskChange(id, "move");
    await this.changed();

    if (undo && !this.plugin.undoController?.isRestoring &&
        (before.listId !== task.listId || before.groupId !== (task.groupId || null))) {
      const group = validGroup ? (list.groups || []).find((item) => item.id === validGroup) : null;
      const targetLabel = group ? `${list.name} / ${group.name}` : list.name;
      this.plugin.undoController?.push(`已移动到「${targetLabel}」`, async () => {
        const current = this.getTask(id);
        if (!current) return;
        current.listId = before.listId;
        current.groupId = before.groupId;
        current.updatedAt = before.updatedAt;
        this.restoreContainers(descendantBefore);
        this.plugin.motionController?.markTaskChange(id, "move");
        await this.changed();
      });
    }
  }

  async deleteTask(id, { undo = true } = {}) {
    const task = this.getTask(id);
    if (!task) return;
    const title = task.title || "任务";
    const subtreeIds = [id, ...this.descendantTaskIds(id)];
    const idSet = new Set(subtreeIds);
    const deletedEntries = this.data.tasks
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => idSet.has(item.id))
      .map(({ item, index }) => ({ task: clonePlain(item), index }));
    const referring = this.data.tasks
      .filter((item) => !idSet.has(item.id) && Array.isArray(item.relatedTaskIds) && item.relatedTaskIds.some((relatedId) => idSet.has(relatedId)))
      .map((item) => ({ id: item.id, relatedTaskIds: clonePlain(item.relatedTaskIds) }));

    this.plugin.motionController?.prepareVisibleTaskLayoutTransition(id);
    await this.plugin.motionController?.exitTask(id, "delete");
    this.data.tasks = this.data.tasks.filter((item) => !idSet.has(item.id));
    for (const item of this.data.tasks) {
      if (Array.isArray(item.relatedTaskIds)) item.relatedTaskIds = item.relatedTaskIds.filter((relatedId) => !idSet.has(relatedId));
    }
    await this.changed();

    if (undo && !this.plugin.undoController?.isRestoring) {
      this.plugin.undoController?.push(`已删除「${title}」${subtreeIds.length > 1 ? `及 ${subtreeIds.length - 1} 个子任务` : ""}`, async () => {
        const restored = [...deletedEntries].sort((a, b) => a.index - b.index);
        for (const entry of restored) {
          if (this.getTask(entry.task.id)) continue;
          const insertAt = Math.max(0, Math.min(entry.index, this.data.tasks.length));
          this.data.tasks.splice(insertAt, 0, clonePlain(entry.task));
          this.plugin.motionController?.markTaskChange(entry.task.id, "add");
        }
        for (const refSnapshot of referring) {
          const ref = this.getTask(refSnapshot.id);
          if (ref) ref.relatedTaskIds = clonePlain(refSnapshot.relatedTaskIds);
        }
        await this.changed();
      }, { duration: 6500 });
    }
  }

  async updateTaskGroup(id, groupId, { undo = true } = {}) {
    const task = this.data.tasks.find((t) => t.id === id);
    if (!task) return;
    const list = this.getList(task.listId);
    const valid = groupId == null || (list?.groups || []).some((group) => group.id === groupId);
    if (!valid) return;
    const before = { groupId: task.groupId || null, updatedAt: task.updatedAt };
    const descendants = this.taskTree(id).slice(1);
    const descendantBefore = this.captureContainers(descendants);
    if (before.groupId !== (groupId || null)) {
      await this.plugin.motionController?.previewTaskMove(id);
      this.plugin.motionController?.prepareVisibleTaskLayoutTransition(id);
    }
    task.groupId = groupId || null;
    task.updatedAt = Date.now();
    if (before.groupId !== task.groupId) this.moveTreeContainer(descendants, task.listId, task.groupId, task.updatedAt);
    this.plugin.motionController?.markTaskChange(id, "move");
    await this.changed();

    if (undo && !this.plugin.undoController?.isRestoring && before.groupId !== (task.groupId || null)) {
      const group = task.groupId ? this.getGroup(task.listId, task.groupId) : null;
      this.plugin.undoController?.push(group ? `已移动到「${group.name}」` : "已移到未分组", async () => {
        const current = this.getTask(id);
        if (!current) return;
        current.groupId = before.groupId;
        current.updatedAt = before.updatedAt;
        this.restoreContainers(descendantBefore);
        this.plugin.motionController?.markTaskChange(id, "move");
        await this.changed();
      });
    }
  }

  async addFolder(name) {
    const clean = name.trim();
    if (!clean) return null;
    const folder = { id: uid(), name: clean, pinned: false, order: this.data.folders.length, viewMode: "list", timelineCollapsedLists: [] };
    this.data.folders.push(folder);
    await this.changed();
    return folder;
  }

  async updateFolder(id, patch) {
    const folder = this.getFolder(id);
    if (!folder) return;
    Object.assign(folder, patch);
    await this.changed();
  }

  async addList(name, folderId = null) {
    const clean = name.trim();
    if (!clean) return null;
    if (this.data.lists.some((l) => l.name === clean)) return null;
    const fallbackFolder = this.data.folders[0] || await this.addFolder("默认");
    const targetFolderId = this.getFolder(folderId)?.id || fallbackFolder?.id || null;
    const list = { id: uid(), name: clean, color: "neutral", folderId: targetFolderId, viewMode: "list", groups: [], timelineCollapsedGroups: [] };
    this.data.lists.push(list);
    await this.changed();
    return list;
  }

  async updateList(id, patch) {
    const list = this.getList(id);
    if (!list) return;
    const next = { ...patch };
    if (list.system) {
      const safe = {};
      if (next.viewMode && ["list", "board", "timeline"].includes(next.viewMode)) safe.viewMode = next.viewMode;
      if (Array.isArray(next.timelineCollapsedGroups)) safe.timelineCollapsedGroups = [...new Set(next.timelineCollapsedGroups.filter(Boolean))];
      if (!Object.keys(safe).length) return;
      Object.assign(list, safe);
      await this.changed();
      return;
    }
    if (next.folderId && !this.getFolder(next.folderId)) delete next.folderId;
    if (next.viewMode && !["list", "board", "timeline"].includes(next.viewMode)) delete next.viewMode;
    Object.assign(list, next);
    await this.changed();
  }

  async addGroup(listId, name) {
    const list = this.getList(listId);
    const clean = name.trim();
    if (!list || list.system || !clean) return null;
    const group = { id: uid(), name: clean, order: (list.groups || []).length };
    if (!Array.isArray(list.groups)) list.groups = [];
    list.groups.push(group);
    await this.changed();
    return group;
  }

  async updateGroup(listId, groupId, patch) {
    const list = this.getList(listId);
    const group = (list?.groups || []).find((item) => item.id === groupId);
    if (!group) return;
    Object.assign(group, patch);
    await this.changed();
  }
}

class TodaySidebarView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.store = plugin.store;
    this.unsubscribe = null;
    this.draft = this.newDraft();
    this.popover = null;
  }

  getViewType() {
    return SIDEBAR_VIEW;
  }

  getDisplayText() {
    return "Today";
  }

  getIcon() {
    return "list-checks";
  }

  async onOpen() {
    this.unsubscribe = this.store.subscribe(() => this.render());
    this.render();
  }

  async onClose() {
    if (this.unsubscribe) this.unsubscribe();
  }

  newDraft() {
    return {
      title: "",
      priority: 0,
      listId: "inbox",
      tags: [],
      attachment: "",
      startDate: "",
      dueDate: todayISO(),
      _dateExplicit: false,
      dueTime: "",
      endTime: "",
      repeat: null,
    };
  }

  contentElSafe() {
    return this.contentEl || this.containerEl.children[1] || this.containerEl;
  }

  render() {
    // An unedited composer follows the real calendar day, even if Obsidian
    // remains open over midnight. Explicitly chosen dates are never changed.
    if (this.draft && !this.draft._dateExplicit && this.draft.dueDate !== todayISO()) {
      this.draft.dueDate = todayISO();
    }
    const el = this.contentElSafe();
    el.replaceChildren();
    el.addClass?.("today-sidebar-view");
    el.classList.add("today-plugin-root", "today-plugin-sidebar");

    const root = document.createElement("div");
    root.className = "today-shell";
    el.appendChild(root);

    root.appendChild(this.renderHeader());
    root.appendChild(this.renderTaskGroups());
    root.appendChild(this.renderBottomNav());
  }

  renderHeader() {
    const header = document.createElement("header");
    header.className = "today-header";

    const top = document.createElement("div");
    top.className = "today-date-row";
    const left = document.createElement("div");
    const kicker = document.createElement("div");
    kicker.className = "today-kicker";
    kicker.textContent = `TODAY · ${new Intl.DateTimeFormat("en", { weekday: "long" }).format(new Date()).toUpperCase()}`;
    const title = document.createElement("div");
    title.className = "today-date-title";
    title.textContent = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(new Date());
    left.append(kicker, title);

    const todayTasks = this.store.topLevelTasks().filter((t) => t.dueDate === todayISO());
    const completedToday = todayTasks.filter((t) => t.done).length;
    const score = document.createElement("div");
    score.className = "today-score";
    score.textContent = `${completedToday} / ${todayTasks.length}`;
    score.style.setProperty("--today-score-progress", `${todayTasks.length ? (completedToday / todayTasks.length) * 100 : 0}%`);
    score.setAttribute("aria-label", `今日已完成 ${completedToday} 项，共 ${todayTasks.length} 项`);
    top.append(left, score);

    header.append(top, this.renderComposer());
    return header;
  }

  iconButton(icon, label, click, extra = "") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `today-icon-btn ${extra}`.trim();
    btn.setAttribute("aria-label", label);
    btn.title = label;
    setIcon(btn, icon);
    btn.addEventListener("click", click);
    return btn;
  }

  renderComposer() {
    const wrap = document.createElement("div");
    wrap.className = "today-composer-wrap";

    const composer = document.createElement("form");
    composer.className = `today-composer ${this.plugin.data.composerMode === "detail" ? "is-detail" : "is-compact"}`;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "today-composer-input";
    input.placeholder = `＋ 添加任务至“${this.store.getList(this.draft.listId).name}”`;
    input.value = this.draft.title;
    input.addEventListener("input", () => (this.draft.title = input.value));

    const tagRow = document.createElement("div");
    tagRow.className = "today-composer-tags";
    if (!this.draft.tags.length) tagRow.classList.add("is-hidden");
    for (const tag of this.draft.tags) {
      const chip = document.createElement("span");
      chip.className = "today-tag-chip";
      chip.textContent = `#${tag}`;
      const x = document.createElement("button");
      x.type = "button";
      x.textContent = "×";
      x.addEventListener("click", () => {
        this.draft.tags = this.draft.tags.filter((t) => t !== tag);
        this.render();
      });
      chip.appendChild(x);
      tagRow.appendChild(chip);
    }

    const tools = document.createElement("div");
    tools.className = "today-composer-tools";

    const dateBtn = this.iconButton("calendar-days", "日期与时间", (e) => this.openDatePopover(wrap, e.currentTarget));
    if (this.draft.dueDate && this.draft._dateExplicit) dateBtn.classList.add("is-active");
    tools.appendChild(dateBtn);

    if (this.plugin.data.composerMode === "detail") {
      const p = this.iconButton("flag", "优先级", (e) => this.openPriorityPopover(wrap, e.currentTarget));
      p.classList.add(`priority-${this.draft.priority}`);
      const list = this.iconButton("inbox", "清单", (e) => this.openListPopover(wrap, e.currentTarget));
      if (this.draft.listId !== "inbox") list.classList.add("is-active");
      const tag = this.iconButton("tag", "标签", (e) => this.openTagPopover(wrap, e.currentTarget));
      if (this.draft.tags.length) tag.classList.add("is-active");
      const attachment = this.iconButton("paperclip", "附件", (e) => this.openAttachmentPopover(wrap, e.currentTarget));
      if (this.draft.attachment) attachment.classList.add("is-active");
      const more = this.iconButton("ellipsis", "更多", (e) => this.openMorePopover(wrap, e.currentTarget));
      tools.append(p, list, tag, attachment, more);

      const add = document.createElement("button");
      add.type = "submit";
      add.className = "today-add-btn";
      add.textContent = "添加";
      const syncAddState = () => add.classList.toggle("is-ready", !!this.draft.title.trim());
      syncAddState();
      input.addEventListener("input", syncAddState);
      tools.appendChild(add);
    } else {
      const more = this.iconButton("chevron-down", "更多任务设置", (e) => this.openCompactPopover(wrap, e.currentTarget));
      tools.appendChild(more);
    }

    composer.append(input);
    if (this.plugin.data.composerMode === "detail") composer.append(tagRow, tools);
    else composer.append(tools);

    composer.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!this.draft.title.trim()) {
        input.focus();
        return;
      }
      const { _dateExplicit, ...taskDraft } = this.draft;
      if (!_dateExplicit) taskDraft.dueDate = todayISO();
      await this.store.addTask({
        ...taskDraft,
        dueDate: taskDraft.dueDate,
        dueTime: taskDraft.dueDate ? (taskDraft.dueTime || "23:59") : "",
      });
      this.draft = this.newDraft();
      this.closePopover();
      new Notice("任务已添加");
      this.render();
    });

    wrap.appendChild(composer);
    return wrap;
  }

  openPopover(wrap, anchor, content, width = 220) {
    if (this.popover?.isConnected && this.popoverAnchor === anchor) {
      this.closePopover();
      return null;
    }
    this.closePopover();
    const pop = document.createElement("div");
    pop.className = "today-popover";
    pop.style.width = `${width}px`;
    pop.setAttribute("role", "dialog");
    wrap.appendChild(pop);
    pop.appendChild(content);

    requestAnimationFrame(() => {
      const wr = wrap.getBoundingClientRect();
      const ar = anchor.getBoundingClientRect();
      let left = ar.left - wr.left + ar.width / 2 - width / 2;
      left = Math.max(0, Math.min(wr.width - width, left));
      pop.style.left = `${left}px`;
    });
    this.popover = pop;
    this.popoverAnchor = anchor;
    this.popoverKeyboardCleanup = installPopoverKeyboard(pop, anchor, () => this.closePopover());
    this.popoverDismissCleanup = installPopoverDismiss(pop, anchor, () => this.closePopover());
    return pop;
  }

  closePopover() {
    this.popoverDismissCleanup?.();
    this.popoverDismissCleanup = null;
    this.popoverKeyboardCleanup?.();
    this.popoverKeyboardCleanup = null;
    if (this.popoverAnchor?.getAttribute?.("aria-expanded") === "true") this.popoverAnchor.setAttribute("aria-expanded", "false");
    this.popoverAnchor = null;
    if (this.popover?.isConnected) this.popover.remove();
    this.popover = null;
  }

  rowButton(icon, title, subtitle, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "today-menu-row";
    const iconEl = document.createElement("span");
    iconEl.className = "today-menu-icon";
    setIcon(iconEl, icon);
    const text = document.createElement("span");
    text.textContent = title;
    const spacer = document.createElement("span");
    spacer.className = "today-spacer";
    btn.append(iconEl, text, spacer);
    if (subtitle) {
      const sub = document.createElement("span");
      sub.className = "today-menu-sub";
      sub.textContent = subtitle;
      btn.appendChild(sub);
    }
    btn.addEventListener("click", onClick);
    return btn;
  }

  openPriorityPopover(wrap, anchor) {
    const box = document.createElement("div");
    box.className = "today-menu";
    [
      [1, "flag", "高优先级"],
      [2, "flag", "中优先级"],
      [3, "flag", "低优先级"],
      [0, "flag", "无优先级"],
    ].forEach(([value, icon, title]) => {
      const row = this.rowButton(icon, title, this.draft.priority === value ? "✓" : "", () => {
        this.draft.priority = value;
        this.closePopover();
        this.render();
      });
      row.classList.add(`priority-${value}`);
      box.appendChild(row);
    });
    this.openPopover(wrap, anchor, box, 190);
  }

  openListPopover(wrap, anchor) {
    const box = document.createElement("div");
    box.className = "today-menu";
    const search = document.createElement("input");
    search.className = "today-menu-search";
    search.placeholder = "搜索清单";
    box.appendChild(search);
    const rows = document.createElement("div");
    box.appendChild(rows);

    const draw = () => {
      rows.replaceChildren();
      const q = search.value.trim().toLowerCase();
      for (const list of this.store.data.lists.filter((l) => !q || l.name.toLowerCase().includes(q))) {
        rows.appendChild(this.rowButton(list.system ? "inbox" : "list", list.name, list.id === this.draft.listId ? "✓" : "", () => {
          this.draft.listId = list.id;
          this.closePopover();
          this.render();
        }));
      }
    };
    search.addEventListener("input", draw);
    draw();
    this.openPopover(wrap, anchor, box, 210);
    setTimeout(() => search.focus(), 0);
  }

  openTagPopover(wrap, anchor) {
    const box = document.createElement("div");
    box.className = "today-menu";
    const input = document.createElement("input");
    input.className = "today-menu-search";
    input.placeholder = "输入标签";
    const allTags = this.store.getAllTags();
    const rows = document.createElement("div");
    const actions = document.createElement("div");
    actions.className = "today-pop-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "取消";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "is-primary";
    confirm.textContent = "确定";
    let working = new Set(this.draft.tags);

    const draw = () => {
      rows.replaceChildren();
      const q = input.value.trim().replace(/^#/, "").toLowerCase();
      for (const tag of allTags.filter((t) => !q || t.toLowerCase().includes(q))) {
        rows.appendChild(this.rowButton("tag", tag, working.has(tag) ? "✓" : "", () => {
          working.has(tag) ? working.delete(tag) : working.add(tag);
          draw();
        }));
      }
    };
    cancel.addEventListener("click", () => this.closePopover());
    confirm.addEventListener("click", () => {
      const typed = input.value.trim().replace(/^#+/, "");
      if (typed) working.add(typed);
      this.draft.tags = [...working];
      this.closePopover();
      this.render();
    });
    actions.append(cancel, confirm);
    input.addEventListener("input", draw);
    box.append(input, rows, actions);
    draw();
    this.openPopover(wrap, anchor, box, 210);
    setTimeout(() => input.focus(), 0);
  }

  openAttachmentPopover(wrap, anchor) {
    const box = document.createElement("div");
    box.className = "today-menu";
    const input = document.createElement("input");
    input.className = "today-menu-search";
    input.placeholder = "文件路径或链接";
    input.value = this.draft.attachment || "";
    const actions = document.createElement("div");
    actions.className = "today-pop-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "取消";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "is-primary";
    confirm.textContent = "确定";
    cancel.addEventListener("click", () => this.closePopover());
    confirm.addEventListener("click", () => {
      this.draft.attachment = input.value.trim();
      this.closePopover();
      this.render();
    });
    actions.append(cancel, confirm);
    box.append(input, actions);
    this.openPopover(wrap, anchor, box, 240);
  }

  async setComposerMode(mode) {
    this.plugin.data.composerMode = mode;
    await this.plugin.saveData(this.plugin.data);
    this.closePopover();
    this.render();
  }

  openMorePopover(wrap, anchor) {
    const box = document.createElement("div");
    box.className = "today-menu";
    const template = this.rowButton("file-plus-2", "从模板添加", "后续", () => {});
    template.disabled = true;
    const note = this.rowButton("notebook-pen", "转换为笔记", "后续", () => {});
    note.disabled = true;
    const mode = this.rowButton("settings-2", "输入框设置", "详细", () => this.setComposerMode("compact"));
    box.append(template, note, document.createElement("hr"), mode);
    this.openPopover(wrap, anchor, box, 190);
  }

  openCompactPopover(wrap, anchor) {
    const box = document.createElement("div");
    box.className = "today-menu";
    box.append(
      this.rowButton("flag", "优先级", this.draft.priority ? `P${this.draft.priority}` : "", () => this.openPriorityPopover(wrap, anchor)),
      this.rowButton("inbox", this.store.getList(this.draft.listId).name, "", () => this.openListPopover(wrap, anchor)),
      this.rowButton("tag", "标签", this.draft.tags.length ? `${this.draft.tags.length}` : "", () => this.openTagPopover(wrap, anchor)),
      this.rowButton("paperclip", "附件", this.draft.attachment ? "1" : "", () => this.openAttachmentPopover(wrap, anchor)),
      document.createElement("hr"),
      this.rowButton("settings-2", "输入框设置", "简洁", () => this.setComposerMode("detail"))
    );
    this.openPopover(wrap, anchor, box, 210);
  }

  openDatePopover(wrap, anchor) {
    const box = document.createElement("div");
    box.className = "today-date-pop";

    let mode = typeof this.datePopoverInitialMode === "function" ? this.datePopoverInitialMode() : "date";
    if (mode !== "range") mode = "date";
    let viewMonth = parseDateOnly(this.draft.dueDate || todayISO()) || new Date();
    let selected = this.draft.dueDate || todayISO();
    let rangeStart = this.draft.startDate || this.draft.dueDate || todayISO();
    let rangeEnd = this.draft.dueDate || todayISO();
    let dueTime = this.draft.dueTime || "";
    let endTime = this.draft.endTime || "";
    let repeat = this.draft.repeat ? JSON.parse(JSON.stringify(this.draft.repeat)) : null;
    let timeOpen = false;
    let repeatOpen = false;
    let allDay = !(dueTime || endTime);
    let editorTime = dueTime || "21:00";

    const tabs = document.createElement("div");
    tabs.className = "today-date-tabs";
    const dateTab = document.createElement("button");
    dateTab.type = "button";
    dateTab.textContent = "日期";
    dateTab.className = "is-active";
    const rangeTab = document.createElement("button");
    rangeTab.type = "button";
    rangeTab.textContent = "时间段";
    tabs.append(dateTab, rangeTab);

    const body = document.createElement("div");
    const footer = document.createElement("div");
    footer.className = "today-pop-actions today-date-actions";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "清除";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "is-primary";
    confirm.textContent = "确定";
    footer.append(clear, confirm);
    box.append(tabs, body, footer);

    const normalizeTime = (value) => {
      const [h0, m0] = String(value || "21:00").split(":").map(Number);
      const h = Math.max(0, Math.min(23, Number.isFinite(h0) ? h0 : 21));
      const m = Math.max(0, Math.min(59, Number.isFinite(m0) ? m0 : 0));
      return `${pad(h)}:${pad(m)}`;
    };

    const setEditorTime = (value, commit = true) => {
      editorTime = normalizeTime(value);
      if (commit) dueTime = editorTime;
    };

    const weekdayName = (day) => ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][day];
    const repeatSummary = () => {
      if (!repeat) return "";
      if (repeat.type === "daily") return "每天";
      if (repeat.type === "weekly") {
        const days = [...(repeat.days || [])].sort((a, b) => a - b);
        if (days.length === 7) return "每天";
        if (days.length === 1) return `每周 · ${weekdayName(days[0])}`;
        if (days.length === 2) return `每周 · ${days.map(weekdayName).join("/")}`;
        return `每周 · ${days.length}天`;
      }
      if (repeat.type === "monthly") {
        const days = [...(repeat.days || [])].sort((a, b) => a - b);
        if (days.length === 1) return `每月 · ${days[0]}日`;
        if (days.length <= 3) return `每月 · ${days.join("/")}日`;
        return `每月 · ${days.length}天`;
      }
      return "";
    };

    const draw = () => {
      body.replaceChildren();
      dateTab.classList.toggle("is-active", mode === "date");
      rangeTab.classList.toggle("is-active", mode === "range");
      if (mode === "date") drawDateMode();
      else drawRangeMode();
    };

    const iconShortcut = (icon, label, onClick) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "today-date-shortcut";
      b.title = label;
      b.setAttribute("aria-label", label);
      setIcon(b, icon);
      b.addEventListener("click", onClick);
      return b;
    };

    const quickDate = (offset) => {
      selected = addDays(todayISO(), offset);
      viewMonth = parseDateOnly(selected);
      draw();
    };

    const drawCalendar = (parent) => {
      const head = document.createElement("div");
      head.className = "today-calendar-head";
      const title = document.createElement("strong");
      title.textContent = `${viewMonth.getFullYear()}年${viewMonth.getMonth() + 1}月`;
      const nav = document.createElement("div");
      const prev = this.iconButton("chevron-left", "上个月", () => {
        viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1);
        draw();
      });
      const today = this.iconButton("circle-dot", "回到今天", () => {
        viewMonth = parseDateOnly(todayISO());
        selected = todayISO();
        draw();
      });
      const next = this.iconButton("chevron-right", "下个月", () => {
        viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);
        draw();
      });
      nav.append(prev, today, next);
      head.append(title, nav);

      const weekdays = document.createElement("div");
      weekdays.className = "today-calendar-weekdays";
      ["日", "一", "二", "三", "四", "五", "六"].forEach((x) => {
        const s = document.createElement("span");
        s.textContent = x;
        weekdays.appendChild(s);
      });

      const grid = document.createElement("div");
      grid.className = "today-calendar-grid";
      const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
      const start = new Date(first);
      start.setDate(1 - first.getDay());

      for (let i = 0; i < 42; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = d.getDate();
        b.className = "today-calendar-day";
        if (d.getMonth() !== viewMonth.getMonth()) b.classList.add("is-other");
        if (value === todayISO()) b.classList.add("is-today");
        if (value === selected) b.classList.add("is-selected");

        let repeatHit = false;
        if (repeat?.type === "daily") repeatHit = true;
        else if (repeat?.type === "weekly") repeatHit = (repeat.days || []).includes(d.getDay());
        else if (repeat?.type === "monthly") repeatHit = (repeat.days || []).includes(d.getDate());
        if (repeatHit) b.classList.add("is-repeat");

        b.addEventListener("click", () => {
          if (repeat?.type === "weekly") {
            const set = new Set(repeat.days || []);
            set.has(d.getDay()) ? set.delete(d.getDay()) : set.add(d.getDay());
            repeat = set.size === 7 ? { type: "daily" } : { type: "weekly", days: [...set].sort((a, b) => a - b) };
          } else if (repeat?.type === "monthly") {
            const set = new Set(repeat.days || []);
            set.has(d.getDate()) ? set.delete(d.getDate()) : set.add(d.getDate());
            if (!set.size) set.add(d.getDate());
            repeat = { type: "monthly", days: [...set].sort((a, b) => a - b) };
          } else {
            selected = value;
          }
          draw();
        });
        grid.appendChild(b);
      }
      parent.append(head, weekdays, grid);
    };

    const makeDateOption = (icon, label, value, onClick) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "today-date-option";
      const iconEl = document.createElement("span");
      iconEl.className = "today-menu-icon";
      setIcon(iconEl, icon);
      const text = document.createElement("span");
      text.textContent = label;
      const val = document.createElement("span");
      val.className = "today-option-value";
      val.textContent = value || "";
      const chev = document.createElement("span");
      setIcon(chev, "chevron-right");
      chev.querySelector("svg")?.setAttribute("width", "14");
      b.append(iconEl, text, val, chev);
      b.addEventListener("click", onClick);
      return b;
    };

    const renderTimeEditor = (parent) => {
      const editor = document.createElement("div");
      editor.className = "today-time-editor";
      const head = document.createElement("div");
      head.className = "today-time-editor-head";
      const label = document.createElement("span");
      label.textContent = "精确到分钟";
      const clearTime = document.createElement("button");
      clearTime.type = "button";
      clearTime.className = "today-time-default";
      clearTime.textContent = "默认 24:00";
      clearTime.addEventListener("click", () => {
        dueTime = "";
        editorTime = "21:00";
        draw();
      });
      head.append(label, clearTime);

      const shell = document.createElement("div");
      shell.className = "today-time-picker-shell";
      const minus = document.createElement("button");
      minus.type = "button";
      minus.className = "today-time-step";
      minus.textContent = "−";
      const plus = document.createElement("button");
      plus.type = "button";
      plus.className = "today-time-step";
      plus.textContent = "＋";
      const fields = document.createElement("div");
      fields.className = "today-time-fields";
      const hour = document.createElement("input");
      hour.type = "number";
      hour.min = "0";
      hour.max = "23";
      hour.inputMode = "numeric";
      const minute = document.createElement("input");
      minute.type = "number";
      minute.min = "0";
      minute.max = "59";
      minute.inputMode = "numeric";
      const colon = document.createElement("span");
      colon.className = "today-time-colon";
      colon.textContent = ":";
      const [eh, em] = normalizeTime(editorTime).split(":");
      hour.value = String(Number(eh));
      minute.value = em;
      const syncFields = () => {
        const h = Math.max(0, Math.min(23, Number(hour.value) || 0));
        const m = Math.max(0, Math.min(59, Number(minute.value) || 0));
        setEditorTime(`${h}:${m}`);
        draw();
      };
      hour.addEventListener("change", syncFields);
      minute.addEventListener("change", syncFields);
      fields.append(hour, colon, minute);

      const step = (amount) => {
        const [h, m] = normalizeTime(editorTime).split(":").map(Number);
        let total = (h * 60 + m + amount) % 1440;
        if (total < 0) total += 1440;
        setEditorTime(`${Math.floor(total / 60)}:${total % 60}`);
        draw();
      };
      minus.addEventListener("click", () => step(-30));
      plus.addEventListener("click", () => step(30));
      shell.append(minus, fields, plus);

      const presets = document.createElement("div");
      presets.className = "today-time-presets";
      ["09:00", "12:00", "18:00", "21:00"].forEach((value) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "today-time-preset";
        b.textContent = value;
        if (dueTime === value) b.classList.add("is-active");
        b.addEventListener("click", () => {
          setEditorTime(value);
          draw();
        });
        presets.appendChild(b);
      });
      editor.append(head, shell, presets);
      parent.appendChild(editor);
    };

    const renderRepeatFlyout = (parent, anchorRow) => {
      const fly = document.createElement("div");
      fly.className = "today-repeat-flyout";
      const items = [
        ["每天", "daily"],
        ["每周", "weekly"],
        ["每月", "monthly"],
      ];
      items.forEach(([label, type]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "today-repeat-item";
        if (repeat?.type === type) b.classList.add("is-active");
        const text = document.createElement("span");
        text.textContent = label;
        const caption = document.createElement("span");
        caption.className = "today-repeat-caption";
        if (type === "weekly" && repeat?.type === "weekly") caption.textContent = repeatSummary().replace("每周 · ", "");
        if (type === "monthly" && repeat?.type === "monthly") caption.textContent = repeatSummary().replace("每月 · ", "");
        b.append(text, caption);
        b.addEventListener("click", () => {
          if (type === "daily") {
            repeat = { type: "daily" };
            repeatOpen = false;
          } else if (type === "weekly") {
            const d = parseDateOnly(selected || todayISO());
            repeat = { type: "weekly", days: repeat?.type === "weekly" ? [...(repeat.days || [])] : [d.getDay()] };
          } else {
            const d = parseDateOnly(selected || todayISO());
            repeat = { type: "monthly", days: repeat?.type === "monthly" ? [...(repeat.days || [])] : [d.getDate()] };
          }
          draw();
        });
        fly.appendChild(b);
      });
      parent.appendChild(fly);
      requestAnimationFrame(() => {
        const rect = this.popover?.getBoundingClientRect();
        const openRight = rect ? rect.right + 220 < window.innerWidth : false;
        fly.classList.add(openRight ? "is-right" : "is-left");
        fly.style.top = `${Math.max(38, anchorRow.offsetTop - 4)}px`;
      });
    };

    const drawDateMode = () => {
      const shortcuts = document.createElement("div");
      shortcuts.className = "today-date-shortcuts";
      shortcuts.append(
        iconShortcut("sun", "今天", () => quickDate(0)),
        iconShortcut("sunrise", "明天", () => quickDate(1)),
        iconShortcut("calendar-plus", "下周", () => quickDate(7)),
        iconShortcut("moon", "无日期", () => {
          selected = "";
          draw();
        })
      );
      body.appendChild(shortcuts);
      drawCalendar(body);

      const options = document.createElement("div");
      options.className = "today-date-options";
      const timeRow = makeDateOption("clock-3", "时间", dueTime || "默认 24:00", () => {
        timeOpen = !timeOpen;
        repeatOpen = false;
        draw();
      });
      options.appendChild(timeRow);
      if (timeOpen) renderTimeEditor(options);
      const repeatRow = makeDateOption("repeat-2", "重复", repeatSummary(), () => {
        repeatOpen = !repeatOpen;
        timeOpen = false;
        draw();
      });
      options.appendChild(repeatRow);
      body.appendChild(options);
      if (repeatOpen) renderRepeatFlyout(body, repeatRow);
    };

    const drawRangeMode = () => {
      const panel = document.createElement("div");
      panel.className = "today-range-panel";

      const makeRangeDateRow = (labelText, value, onChange) => {
        const row = document.createElement("label");
        row.className = "today-range-row";
        const labelEl = document.createElement("span");
        labelEl.textContent = labelText;
        const input = document.createElement("input");
        input.type = "date";
        input.value = value || todayISO();
        input.addEventListener("change", () => onChange(input.value));
        row.append(labelEl, input);
        return row;
      };

      panel.append(
        makeRangeDateRow("开始", rangeStart, (value) => {
          rangeStart = value || todayISO();
          if (rangeEnd && rangeStart > rangeEnd) rangeEnd = rangeStart;
        }),
        makeRangeDateRow("结束", rangeEnd, (value) => {
          rangeEnd = value || rangeStart || todayISO();
          if (rangeStart && rangeEnd < rangeStart) rangeStart = rangeEnd;
        })
      );

      const toggleRow = document.createElement("div");
      toggleRow.className = "today-range-toggle";
      const toggleLabel = document.createElement("span");
      toggleLabel.textContent = "全天";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = `today-switch ${allDay ? "is-on" : ""}`;
      toggle.addEventListener("click", () => {
        allDay = !allDay;
        if (!allDay && !dueTime) dueTime = "19:00";
        if (!allDay && !endTime) endTime = "20:00";
        draw();
      });
      toggleRow.append(toggleLabel, toggle);
      panel.appendChild(toggleRow);

      if (!allDay) {
        const fields = document.createElement("div");
        fields.className = "today-range-time-fields";
        const start = document.createElement("input");
        start.type = "time";
        start.value = dueTime || "19:00";
        const sep = document.createElement("span");
        sep.textContent = "至";
        const end = document.createElement("input");
        end.type = "time";
        end.value = endTime || "20:00";
        start.addEventListener("change", () => (dueTime = start.value));
        end.addEventListener("change", () => (endTime = end.value));
        fields.append(start, sep, end);
        panel.appendChild(fields);
      }

      const repeatRow = makeDateOption("repeat-2", "重复", repeatSummary(), () => {
        repeatOpen = !repeatOpen;
        draw();
      });
      panel.appendChild(repeatRow);
      body.appendChild(panel);
      if (repeatOpen) renderRepeatFlyout(body, repeatRow);
    };

    dateTab.addEventListener("click", () => {
      mode = "date";
      repeatOpen = false;
      draw();
    });
    rangeTab.addEventListener("click", () => {
      mode = "range";
      timeOpen = false;
      repeatOpen = false;
      draw();
    });
    clear.addEventListener("click", () => {
      selected = "";
      rangeStart = todayISO();
      rangeEnd = todayISO();
      dueTime = "";
      endTime = "";
      repeat = null;
      timeOpen = false;
      repeatOpen = false;
      editorTime = "21:00";
      draw();
    });
    confirm.addEventListener("click", () => {
      this.draft._dateExplicit = true;
      if (mode === "range") {
        const startValue = rangeStart || todayISO();
        const endValue = rangeEnd || startValue;
        this.draft.startDate = startValue <= endValue ? startValue : endValue;
        this.draft.dueDate = startValue <= endValue ? endValue : startValue;
      } else {
        this.draft.startDate = "";
        this.draft.dueDate = selected;
      }
      this.draft.dueTime = allDay && mode === "range" ? "" : dueTime;
      this.draft.endTime = allDay && mode === "range" ? "" : endTime;
      this.draft.repeat = repeat;
      this.closePopover();
      this.render();
    });

    draw();
    this.openPopover(wrap, anchor, box, 278);
  }

  renderTaskGroups() {
    const main = document.createElement("main");
    main.className = "today-task-area";
    const today = todayISO();
    const tasks = this.store.topLevelTasks();
    const overdue = tasks.filter((t) => !t.done && t.dueDate && dayDiff(t.dueDate) < 0);
    const todayList = tasks.filter((t) => t.dueDate === today);
    const week = tasks.filter((t) => !t.done && t.dueDate && dayDiff(t.dueDate) > 0 && dayDiff(t.dueDate) <= 7);

    if (overdue.length) main.appendChild(this.renderGroup("已过期", overdue));
    main.appendChild(this.renderGroup(`今天 ${new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(new Date())}`, todayList));
    if (week.length) main.appendChild(this.renderGroup("最近 7 天", week));
    if (!overdue.length && !todayList.length && !week.length) {
      const empty = document.createElement("div");
      empty.className = "today-empty";
      empty.textContent = "今天还没有任务";
      main.appendChild(empty);
    }
    return main;
  }

  renderGroup(title, tasks) {
    const section = document.createElement("section");
    section.className = "today-task-group";
    const head = document.createElement("div");
    head.className = "today-task-group-head";
    const chevron = document.createElement("span");
    setIcon(chevron, "chevron-down");
    const label = document.createElement("strong");
    label.textContent = title;
    const count = document.createElement("span");
    count.textContent = tasks.length;
    head.append(chevron, label, count);
    const list = document.createElement("div");
    for (const task of tasks) list.appendChild(this.renderTask(task));
    section.append(head, list);
    return section;
  }

  renderTask(task) {
    const row = document.createElement("div");
    row.className = "today-task";
    row.dataset.todayTaskId = task.id;
    if (task.done) row.classList.add("is-done");

    const check = document.createElement("button");
    check.type = "button";
    check.className = "today-check";
    if (task.done) {
      check.classList.add("is-done");
      setIcon(check, "check");
    }
    check.addEventListener("click", (event) => { event.stopPropagation(); this.lastTaskClickId = null; this.lastTaskClickAt = 0; this.store.toggleTask(task.id); });

    const body = document.createElement("div");
    body.className = "today-task-body";
    const title = document.createElement("div");
    title.className = `today-task-title priority-${task.priority || 0}`;
    title.textContent = task.title;
    const meta = document.createElement("div");
    meta.className = "today-task-meta";

    const list = this.store.getList(task.listId);
    const listChip = document.createElement("span");
    listChip.className = `today-pill list-${list.color || "neutral"}`;
    listChip.textContent = list.name;
    meta.appendChild(listChip);

    for (const tag of task.tags || []) {
      const chip = document.createElement("span");
      chip.className = "today-pill is-tag";
      chip.textContent = `#${tag}`;
      meta.appendChild(chip);
    }

    if (task.dueDate) {
      const due = document.createElement("span");
      due.className = `today-pill ${dayDiff(task.dueDate) < 0 && !task.done ? "is-overdue" : "is-due"}`;
      due.textContent = compactTaskDateLabel(task);
      meta.appendChild(due);
    }

    if (task.repeat) {
      const repeat = document.createElement("span");
      repeat.className = "today-pill";
      repeat.textContent = `↻ ${repeatLabel(task)}`;
      meta.appendChild(repeat);
    }

    body.append(title, meta);
    row.append(check, body);
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `打开任务 ${task.title}`);
    row.addEventListener("click", (event) => this.plugin.openTaskDetail(task.id, event.currentTarget));
    row.addEventListener("contextmenu", (event) => this.plugin.openTaskContextMenu(event, task, { anchor: row }));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); this.plugin.openTaskDetail(task.id, row); }
      else if (event.key === " ") { event.preventDefault(); this.store.toggleTask(task.id); }
    });
    return row;
  }

  renderBottomNav() {
    const nav = document.createElement("nav");
    nav.className = "today-bottom-nav";
    const today = document.createElement("button");
    today.type = "button";
    today.className = "is-active";
    today.textContent = "今天";
    const lists = document.createElement("button");
    lists.type = "button";
    lists.textContent = "清单";
    lists.addEventListener("click", () => this.plugin.openCenter("lists"));
    const stats = document.createElement("button");
    stats.type = "button";
    stats.textContent = "统计";
    stats.addEventListener("click", () => this.plugin.openCenter("stats"));
    nav.append(today, lists, stats);
    return nav;
  }
}


class ListEditorModal extends Modal {
  constructor(app, plugin, list) {
    super(app);
    this.plugin = plugin;
    this.list = list;
    this.draft = {
      name: list.name,
      color: list.color || "neutral",
      folderId: list.folderId || plugin.data.folders[0]?.id || "",
      viewMode: list.viewMode || "list",
    };
  }

  onOpen() {
    this.modalEl.classList.add("today-small-editor-modal");
    const el = this.contentEl;
    el.replaceChildren();
    el.classList.add("today-plugin-root", "today-editor-modal");
    const title = document.createElement("h2");
    title.textContent = "编辑清单";
    el.appendChild(title);

    new Setting(el).setName("名称").addText((input) => input.setValue(this.draft.name).onChange((value) => { this.draft.name = value; }));
    new Setting(el).setName("颜色").addDropdown((dropdown) => {
      [["neutral", "灰"], ["blue", "蓝"], ["violet", "紫"], ["green", "绿"], ["orange", "橙"]].forEach(([value, label]) => dropdown.addOption(value, label));
      dropdown.setValue(this.draft.color).onChange((value) => { this.draft.color = value; });
    });
    new Setting(el).setName("文件夹").addDropdown((dropdown) => {
      for (const folder of this.plugin.data.folders) dropdown.addOption(folder.id, folder.name);
      if (this.draft.folderId) dropdown.setValue(this.draft.folderId);
      dropdown.onChange((value) => { this.draft.folderId = value; });
    });
    new Setting(el).setName("默认视图").setDesc("列表、看板与时间线是这个清单的呈现方式。分组会分别成为 Section、Column 和 Lane。").addDropdown((dropdown) => {
      dropdown.addOption("list", "列表");
      dropdown.addOption("board", "看板");
      dropdown.addOption("timeline", "时间线");
      dropdown.setValue(this.draft.viewMode).onChange((value) => { this.draft.viewMode = value; });
    });

    const actions = document.createElement("div");
    actions.className = "today-editor-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "取消";
    cancel.addEventListener("click", () => this.close());
    const save = document.createElement("button");
    save.type = "button";
    save.className = "mod-cta";
    save.textContent = "保存";
    save.addEventListener("click", async () => {
      const name = this.draft.name.trim();
      if (!name) return new Notice("清单名称不能为空");
      await this.plugin.store.updateList(this.list.id, { ...this.draft, name });
      this.close();
    });
    actions.append(cancel, save);
    el.appendChild(actions);
  }
}

class FolderEditorModal extends Modal {
  constructor(app, plugin, folder) {
    super(app);
    this.plugin = plugin;
    this.folder = folder;
    this.name = folder.name;
    this.pinned = !!folder.pinned;
  }

  onOpen() {
    this.modalEl.classList.add("today-small-editor-modal");
    const el = this.contentEl;
    el.replaceChildren();
    el.classList.add("today-plugin-root", "today-editor-modal");
    const title = document.createElement("h2");
    title.textContent = "编辑文件夹";
    el.appendChild(title);
    new Setting(el).setName("名称").addText((input) => input.setValue(this.name).onChange((value) => { this.name = value; }));
    new Setting(el).setName("置顶").setDesc("置顶文件夹会优先显示在清单区域顶部。").addToggle((toggle) => toggle.setValue(this.pinned).onChange((value) => { this.pinned = value; }));
    const actions = document.createElement("div");
    actions.className = "today-editor-actions";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "取消"; cancel.addEventListener("click", () => this.close());
    const save = document.createElement("button"); save.type = "button"; save.className = "mod-cta"; save.textContent = "保存";
    save.addEventListener("click", async () => {
      const name = this.name.trim();
      if (!name) return new Notice("文件夹名称不能为空");
      await this.plugin.store.updateFolder(this.folder.id, { name, pinned: this.pinned });
      this.close();
    });
    actions.append(cancel, save); el.appendChild(actions);
  }
}

class TagManageModal extends Modal {
  constructor(app, plugin, source, mode, view = null) {
    super(app);
    this.plugin = plugin;
    this.source = source;
    this.mode = mode;
    this.view = view;
    this.target = "";
  }

  onOpen() {
    this.modalEl.classList.add("today-small-editor-modal");
    const el = this.contentEl;
    el.replaceChildren();
    el.classList.add("today-plugin-root", "today-editor-modal");
    const titles = { rename: "重命名标签", merge: "合并标签", delete: "移除标签" };
    const title = document.createElement("h2");
    title.textContent = titles[this.mode];
    el.appendChild(title);
    const description = document.createElement("p");
    description.className = "today-tag-manager-description";
    const count = this.plugin.store.data.tasks.filter((task) => (task.tags || []).includes(this.source)).length;
    description.textContent = this.mode === "rename" ? `为 ${count} 个使用 #${this.source} 的任务更换标签名称。` :
      this.mode === "merge" ? `将 #${this.source} 合并到已有标签，涉及 ${count} 个任务；已有目标标签不会重复。` :
      `仅从 ${count} 个任务上移除 #${this.source} 标签，不删除任务、正文或其他标签。`;
    el.appendChild(description);

    if (this.mode === "rename") {
      this.target = this.source;
      new Setting(el).setName("新标签名称").addText((control) => {
        control.setValue(this.source).onChange((value) => { this.target = value; });
        control.inputEl?.setAttribute("aria-label", "新标签名称");
        window.setTimeout(() => { if (this.modalEl?.isConnected) { control.inputEl?.focus(); control.inputEl?.select(); } }, 0);
      });
    } else if (this.mode === "merge") {
      const targets = this.plugin.store.getAllTags().filter((tag) => tag !== this.source);
      this.target = targets[0] || "";
      new Setting(el).setName("合并到").addDropdown((control) => {
        for (const tag of targets) control.addOption(tag, `#${tag}`);
        if (this.target) control.setValue(this.target);
        control.onChange((value) => { this.target = value; });
      });
    }

    const error = document.createElement("div");
    error.className = "today-tag-manager-error";
    error.setAttribute("role", "alert");
    el.appendChild(error);
    const actions = document.createElement("div");
    actions.className = "today-editor-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "取消";
    cancel.addEventListener("click", () => this.close());
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = this.mode === "delete" ? "mod-warning" : "mod-cta";
    confirm.textContent = titles[this.mode];
    confirm.disabled = this.mode === "merge" && !this.target;
    confirm.addEventListener("click", async () => {
      if (confirm.disabled) return;
      error.textContent = "";
      const target = this.plugin.store.normalizedTag(this.target);
      if (this.mode === "rename" && target === this.source) { this.close(); return; }
      confirm.disabled = true;
      try {
        // Set the destination before the store notifies views, so the tag view
        // follows the renamed/merged tag rather than falling back to the first.
        if (this.view && this.view.isOpen) this.view.selectedTag = this.mode === "delete" ? "" : target;
        if (this.mode === "rename") await this.plugin.store.renameTag(this.source, target);
        else if (this.mode === "merge") await this.plugin.store.mergeTag(this.source, target);
        else await this.plugin.store.deleteTag(this.source);
        this.close();
      } catch (exception) {
        if (this.view && this.view.isOpen) this.view.selectedTag = this.source;
        error.textContent = exception?.message || "修改标签失败";
        confirm.disabled = false;
      }
    });
    actions.append(cancel, confirm);
    el.appendChild(actions);
  }
}

class TaskDetailModal extends Modal {
  constructor(app, plugin, taskId, anchor = null) {
    super(app);
    this.plugin = plugin;
    this.store = plugin.store;
    this.taskId = taskId;
    this.anchorRect = this.readAnchorRect(anchor);
    this.anchorMode = this.readAnchorMode(anchor);
    this.editorEl = null;
    this.formatOpen = false;
    this.previewOpen = false;
    this.persistTimer = null;
    this.hasLocalChanges = false;
    this.datePopover = null;
    this.datePopoverOutsideHandler = null;
    this.priorityPopover = null;
    this.priorityPopoverDismissCleanup = null;
    this.priorityPopoverKeyboardCleanup = null;
    this.dockedFooterEl = null;
    this.dockedFooterCleanup = null;
    this.formatBarEl = null;
    this.formatButtonEl = null;
    this.formatDismissCleanup = null;
    this.footerPopoverEl = null;
    this.footerPopoverAnchor = null;
    this.footerPopoverCleanup = null;
    this.footerPopoverKind = "";
    this.tagButtonEl = null;
    this.moreButtonEl = null;
    this.containerMenuEl = null;
    this.containerSubmenuEl = null;
    this.containerGroupMenuEl = null;
    this.containerMenuCleanup = null;
    this.uiOwnerId = uid();
    this.dockedFooterPane = null;
    this.detailOutsideHandler = null;
    this.subtaskComposerOpen = false;
    this.subtaskDragId = null;
    this.slashMenuEl = null;
    this.slashMenuCleanup = null;
    this.slashMenuCommands = [];
    this.slashMenuActiveIndex = 0;
    this.slashMenuQuery = null;
  }

  ensureUiOwner() {
    if (!this.uiOwnerId) this.uiOwnerId = uid();
    return this.uiOwnerId;
  }

  isDockedDetail() {
    return !!this.contentEl?.classList?.contains?.("today-center-detail-pane");
  }

  appendDetailPortal(node, role = "popover") {
    if (!node) return node;
    const owner = this.ensureUiOwner();
    node.classList?.add?.("today-task-detail-portal");
    node.dataset.todayDetailOwner = owner;
    node.dataset.todayDetailRole = role;
    // Anchored Board/Timeline task documents are Obsidian Modals. Keep their
    // transient controls inside the same modal layer so clicks remain inside
    // the modal's lifecycle. Docked Content uses body because its command strip
    // is viewport anchored.
    const host = !this.isDockedDetail() && this.modalContainerEl?.isConnected
      ? this.modalContainerEl
      : document.body;
    host.appendChild(node);
    // Prevent a portalled control inside a task modal from being interpreted as
    // a click on the transparent modal backdrop.
    node.addEventListener("pointerdown", (event) => event.stopPropagation());
    node.addEventListener("click", (event) => event.stopPropagation());
    return node;
  }

  ownsFunctionalTarget(target) {
    if (!target) return false;
    if (this.modalEl?.contains?.(target)) return true;
    const owner = this.uiOwnerId;
    if (!owner) return false;
    return [...document.querySelectorAll(".today-task-detail-portal")].some((node) =>
      node.dataset.todayDetailOwner === owner && node.contains?.(target)
    );
  }

  removeOwnedPortals({ includeFooter = true } = {}) {
    const owner = this.uiOwnerId;
    if (!owner) return;
    document.querySelectorAll(".today-task-detail-portal").forEach((node) => {
      if (node.dataset.todayDetailOwner !== owner) return;
      if (!includeFooter && node.dataset.todayDetailRole === "footer") return;
      node.remove();
    });
  }

  disposeFunctionalUi({ includeFooter = true } = {}) {
    this.closeSlashMenu?.();
    this.closeDatePopover?.();
    this.closePriorityPopover?.();
    this.closeFooterPopover?.({ restoreFocus: false });
    this.closeContainerMenu?.({ restoreFocus: false });
    this.closeFormatToolbar?.({ focusEditor: false });
    if (includeFooter) this.closeDockedFooter?.();
    this.removeOwnedPortals({ includeFooter });
  }

  get task() {
    return this.store.getTask(this.taskId);
  }

  makeIcon(name, className = "") {
    const span = document.createElement("span");
    if (className) span.className = className;
    setIcon(span, name);
    return span;
  }

  makeFooterToolButton(icon, label, onClick, { preserveSelection = false, className = "" } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `today-task-detail-footer-tool ${className}`.trim();
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    setIcon(button, icon);
    if (preserveSelection) button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick?.(event);
    });
    return button;
  }

  readAnchorMode(anchor) {
    const source = anchor?.currentTarget || anchor;
    if (!source?.closest) return "side";
    return source.closest(
      ".today-center-timeline-bar, .today-center-timeline-context-item, .today-center-timeline-project-plan, .today-center-timeline-project-phase, .today-center-timeline-project-milestone, .today-center-unscheduled-chip"
    ) ? "below" : "side";
  }

  readAnchorRect(anchor) {
    const source = anchor?.currentTarget || anchor;
    if (!source) return null;
    if (typeof source.getBoundingClientRect === "function") {
      const rect = source.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    }
    if (["left", "top", "right", "bottom"].every((key) => Number.isFinite(source[key]))) {
      return {
        left: source.left, top: source.top, right: source.right, bottom: source.bottom,
        width: Number.isFinite(source.width) ? source.width : Math.max(0, source.right - source.left),
        height: Number.isFinite(source.height) ? source.height : Math.max(0, source.bottom - source.top)
      };
    }
    return null;
  }

  setAnchor(anchor) {
    this.anchorRect = this.readAnchorRect(anchor);
    this.anchorMode = this.readAnchorMode(anchor);
    window.requestAnimationFrame(() => this.placeNearAnchor());
  }

  placeNearAnchor() {
    const anchor = this.anchorRect;
    if (!anchor || !this.modalEl) {
      this.modalEl?.classList.remove("is-anchored");
      return;
    }

    this.modalEl.classList.add("is-anchored");
    const modalRect = this.modalEl.getBoundingClientRect();
    const width = modalRect.width || 420;
    const height = modalRect.height || 370;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const gapX = 10;
    const gapY = 8;
    const gutter = 12;

    let left;
    let top;

    if (this.anchorMode === "below") {
      // Timeline cards read more naturally when the editor belongs to the bar
      // beneath it. Anchor the panel by the task's horizontal centre instead
      // of making the panel's top-left corner start at the task's right edge.
      left = anchor.left + anchor.width / 2 - width / 2;
      top = anchor.bottom + gapY;
      left = Math.max(gutter, Math.min(left, viewportWidth - width - gutter));

      // Keep the same centre alignment when there is no room below.
      if (top + height > viewportHeight - gutter) top = anchor.top - height - gapY;
      top = Math.max(gutter, Math.min(top, viewportHeight - height - gutter));
    } else {
      // Compact task cards outside the timeline keep the familiar side anchor.
      left = anchor.right + gapX;
      top = anchor.bottom + gapY;
      if (left + width > viewportWidth - gutter) left = anchor.left - width - gapX;
      if (left < gutter || left + width > viewportWidth - gutter) {
        left = Math.min(Math.max(anchor.right - width, gutter), Math.max(gutter, viewportWidth - width - gutter));
      }
      if (top + height > viewportHeight - gutter) top = anchor.top - height - gapY;
      if (top < gutter || top + height > viewportHeight - gutter) {
        top = Math.min(Math.max(anchor.bottom + gapY, gutter), Math.max(gutter, viewportHeight - height - gutter));
      }
    }

    this.modalEl.style.setProperty("--today-task-detail-left", `${Math.round(left)}px`);
    this.modalEl.style.setProperty("--today-task-detail-top", `${Math.round(top)}px`);
  }

  onOpen() {
    this.ensureUiOwner();
    this.modalEl.classList.add("today-task-detail-modal");
    this.contentEl.classList.add("today-plugin-root", "today-task-detail");
    this.modalContainerEl = this.modalEl.parentElement;
    this.modalContainerEl?.classList.add("today-task-detail-layer");
    this.render();
    window.requestAnimationFrame(() => {
      this.placeNearAnchor();
      this.plugin.motionController?.enterDetailIfNeeded(this.contentEl);
    });
    // Obsidian's transparent modal backdrop is intentionally visually absent in
    // spatial views. Keep dismissal explicit: a click outside the task document
    // and all of its owned popovers closes the entire anchored detail.
    this.detailOutsideHandler = (event) => {
      if (this.ownsFunctionalTarget(event.target)) return;
      this.close();
    };
    setTimeout(() => {
      if (this.detailOutsideHandler && this.modalEl?.isConnected) {
        document.addEventListener("pointerdown", this.detailOutsideHandler, true);
      }
    }, 0);
  }

  async setTask(taskId) {
    await this.flushLocalChanges(false);
    if (taskId !== this.taskId) await this.plugin.motionController?.exitDetail(this.contentEl);
    this.disposeFunctionalUi({ includeFooter: true });
    this.taskId = taskId;
    this.formatOpen = false;
    this.previewOpen = false;
    this.subtaskComposerOpen = false;
    this.subtaskDragId = null;
    this.plugin.motionController?.markDetailSwitch(taskId, this.isDockedDetail() ? "docked" : "spatial");
    delete this.contentEl?.dataset?.todayMotionEntered;
    this.render();
    window.requestAnimationFrame(() => this.plugin.motionController?.enterDetailIfNeeded(this.contentEl));
  }

  schedulePersist() {
    this.hasLocalChanges = true;
    if (this.persistTimer) window.clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null;
      this.plugin.saveData(this.plugin.data);
    }, 350);
  }

  async flushLocalChanges(notify = true) {
    if (this.persistTimer) {
      window.clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (!this.hasLocalChanges) return;
    this.hasLocalChanges = false;
    if (notify) await this.store.changed();
    else await this.plugin.saveData(this.plugin.data);
  }

  async onClose() {
    if (this.detailOutsideHandler) {
      document.removeEventListener("pointerdown", this.detailOutsideHandler, true);
      this.detailOutsideHandler = null;
    }
    await this.plugin.motionController?.exitDetail(this.contentEl);
    this.disposeFunctionalUi({ includeFooter: true });
    await this.flushLocalChanges(true);
    this.modalContainerEl?.classList.remove("today-task-detail-layer");
    this.modalContainerEl = null;
    this.contentEl.replaceChildren();
    if (this.plugin.taskDetailModal === this) this.plugin.taskDetailModal = null;
    // Board selection represents the currently open anchored task document.
    // When that document is dismissed (outside click, Escape, focus change),
    // clear the card state in place so a stale blue selection is not left behind.
    this.plugin.centerModal?.clearBoardTaskSelectionInPlace?.(this.taskId);
  }

  dateText(task) {
    if (!task.dueDate) return "设置日期";
    let text = task.startDate && task.startDate !== task.dueDate
      ? `${task.startDate.slice(5).replace("-", "/")} – ${task.dueDate.slice(5).replace("-", "/")}`
      : task.dueDate.slice(5).replace("-", "/");
    if (task.dueTime) text += ` · ${task.dueTime}${task.endTime ? `–${task.endTime}` : ""}`;
    return text;
  }

  async patch(patch, rerender = true) {
    await this.flushLocalChanges(false);
    const keys = Object.keys(patch || {});
    let undoLabel = "";
    if (keys.some((key) => ["startDate", "dueDate", "dueTime", "endTime", "repeat"].includes(key))) undoLabel = "已修改日期";
    else if (keys.length === 1 && keys[0] === "priority") undoLabel = "已修改优先级";
    else if (keys.includes("attachments")) undoLabel = "已修改附件";
    await this.store.updateTask(this.taskId, patch, { undoLabel });
    if (rerender && this.task) this.render();
  }

  closeDatePopover() {
    this.datePopoverPositionCleanup?.();
    this.datePopoverPositionCleanup = null;
    if (this.datePopoverOutsideHandler) {
      document.removeEventListener("pointerdown", this.datePopoverOutsideHandler, true);
      this.datePopoverOutsideHandler = null;
    }
    this.datePopoverKeyboardCleanup?.();
    this.datePopoverKeyboardCleanup = null;
    if (this.datePopover?.isConnected) this.datePopover.remove();
    this.datePopover = null;
  }

  showDateMenu(event) {
    const task = this.task;
    if (!task) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const anchor = event?.currentTarget || event?.target;
    if (!anchor?.getBoundingClientRect) return;

    this.closeDatePopover();
    const detail = this;
    const draft = {
      startDate: task.startDate || "",
      dueDate: task.dueDate || "",
      dueTime: task.dueTime || "",
      endTime: task.endTime || "",
      repeat: task.repeat ? JSON.parse(JSON.stringify(task.repeat)) : null,
    };

    // Reuse the exact same date/time module as quick task creation.  Only the
    // popover host and the persistence callback differ in task detail.
    const pickerHost = {
      draft,
      popover: null,
      datePopoverInitialMode: () => (draft.startDate ? "range" : "date"),
      iconButton(icon, label, click, extra = "") {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `today-icon-btn ${extra}`.trim();
        btn.setAttribute("aria-label", label);
        btn.title = label;
        setIcon(btn, icon);
        btn.addEventListener("click", click);
        return btn;
      },
      openPopover(_wrap, pickerAnchor, content, width = 278) {
        detail.closeDatePopover();
        const pop = document.createElement("div");
        pop.className = "today-plugin-root today-popover today-task-detail-date-popover";
        pop.style.width = `${width}px`;
        pop.appendChild(content);
        detail.appendDetailPortal(pop, "date");
        pickerHost.popover = pop;
        detail.datePopover = pop;
        detail.datePopoverKeyboardCleanup = installPopoverKeyboard(pop, pickerAnchor, () => detail.closeDatePopover());

        detail.datePopoverPositionCleanup = detail.plugin.floatingController?.autoUpdate(pop, pickerAnchor, {
          placement: "bottom-start",
          gap: 7,
          padding: 10,
          crossOffset: -6,
          flip: true,
          shift: true,
        }) || null;

        detail.datePopoverOutsideHandler = (pointerEvent) => {
          const target = pointerEvent.target;
          if (pop.contains(target) || pickerAnchor.contains?.(target)) return;
          detail.closeDatePopover();
        };
        setTimeout(() => {
          if (detail.datePopover === pop && detail.datePopoverOutsideHandler) {
            document.addEventListener("pointerdown", detail.datePopoverOutsideHandler, true);
          }
        }, 0);
        return pop;
      },
      closePopover() {
        detail.closeDatePopover();
        pickerHost.popover = null;
      },
      render() {
        detail.patch({
          startDate: draft.startDate || "",
          dueDate: draft.dueDate || "",
          dueTime: draft.dueDate ? (draft.dueTime || "") : "",
          endTime: draft.dueDate ? (draft.endTime || "") : "",
          repeat: draft.dueDate && draft.repeat ? JSON.parse(JSON.stringify(draft.repeat)) : null,
        });
      },
    };

    TodaySidebarView.prototype.openDatePopover.call(pickerHost, null, anchor);
  }

  closePriorityPopover({ restoreFocus = false } = {}) {
    this.priorityPopoverPositionCleanup?.();
    this.priorityPopoverPositionCleanup = null;
    this.priorityPopoverDismissCleanup?.();
    this.priorityPopoverDismissCleanup = null;
    this.priorityPopoverKeyboardCleanup?.();
    this.priorityPopoverKeyboardCleanup = null;
    const anchor = this.priorityPopoverAnchor;
    if (this.priorityPopover?.isConnected) this.priorityPopover.remove();
    this.priorityPopover = null;
    this.priorityPopoverAnchor = null;
    if (restoreFocus) anchor?.focus?.({ preventScroll: true });
  }

  showPriorityMenu(event) {
    const task = this.task;
    if (!task) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const anchor = event?.currentTarget || event?.target;
    if (!anchor?.getBoundingClientRect) return;

    this.closePriorityPopover();
    const detail = this;
    const draft = { priority: Number(task.priority || 0) };

    // Reuse the exact same priority picker used by Quick Add.  The picker DOM,
    // row spacing, semantic flag colours and checked state therefore cannot drift.
    const pickerHost = {
      draft,
      popover: null,
      rowButton(icon, title, subtitle, onClick) {
        return TodaySidebarView.prototype.rowButton.call(pickerHost, icon, title, subtitle, onClick);
      },
      openPopover(_wrap, pickerAnchor, content, width = 190) {
        detail.closePriorityPopover();
        const pop = document.createElement("div");
        pop.className = "today-plugin-root today-popover today-task-detail-priority-popover";
        pop.style.width = `${width}px`;
        pop.appendChild(content);
        detail.appendDetailPortal(pop, "priority");
        pickerHost.popover = pop;
        detail.priorityPopover = pop;
        detail.priorityPopoverAnchor = pickerAnchor;
        detail.priorityPopoverKeyboardCleanup = installPopoverKeyboard(pop, pickerAnchor, () => detail.closePriorityPopover({ restoreFocus: true }));
        detail.priorityPopoverDismissCleanup = installPopoverDismiss(pop, pickerAnchor, () => detail.closePriorityPopover());

        detail.priorityPopoverPositionCleanup = detail.plugin.floatingController?.autoUpdate(pop, pickerAnchor, {
          placement: "bottom-end",
          gap: 7,
          padding: 10,
          flip: true,
          shift: true,
        }) || null;
        return pop;
      },
      closePopover() {
        detail.closePriorityPopover();
        pickerHost.popover = null;
      },
      render() {
        detail.patch({ priority: Number(draft.priority || 0) });
      },
    };

    TodaySidebarView.prototype.openPriorityPopover.call(pickerHost, null, anchor);
  }

  closeDockedFooter() {
    // A docked command strip owns every footer-derived popup. Destroy the whole
    // functional subtree together so a List -> Board/Timeline switch cannot
    // leave body portals behind.
    this.closeFooterPopover?.({ restoreFocus: false });
    this.closeContainerMenu?.({ restoreFocus: false });
    this.dockedFooterCleanup?.();
    this.dockedFooterCleanup = null;
    if (this.dockedFooterEl?.isConnected) this.dockedFooterEl.remove();
    this.dockedFooterEl = null;
    this.dockedFooterPane = null;
  }

  mountDockedFooter(footer) {
    const pane = this.contentEl;
    if (!pane?.classList?.contains("today-center-detail-pane")) return false;
    this.closeDockedFooter();
    footer.classList.add("today-plugin-root", "today-task-detail-footer-floating");
    footer.style.visibility = "hidden";
    this.appendDetailPortal(footer, "footer");
    this.dockedFooterEl = footer;
    this.dockedFooterPane = pane;

    let frame = 0;
    let disposed = false;
    const disposeIfOrphaned = () => {
      if (disposed) return true;
      if (pane.isConnected && this.contentEl === pane) return false;
      this.closeDockedFooter();
      return true;
    };
    const position = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (disposeIfOrphaned() || !footer.isConnected) return;
        const rect = pane.getBoundingClientRect();
        const side = 10;
        const bottomGap = 10;
        const visibleBottom = Math.min(window.innerHeight, rect.bottom);
        const width = Math.max(180, rect.width - side * 2);
        footer.style.left = `${Math.round(rect.left + side)}px`;
        footer.style.width = `${Math.round(width)}px`;
        footer.style.right = "auto";
        footer.style.bottom = "auto";
        const height = footer.getBoundingClientRect().height || 40;
        footer.style.top = `${Math.round(Math.max(rect.top + 8, visibleBottom - height - bottomGap))}px`;
        footer.style.visibility = "visible";
      });
    };

    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(position) : null;
    resizeObserver?.observe(pane);
    // Explicit TaskCenter cleanup is the primary lifecycle. This observer is a
    // safety net for any DOM replacement path that removes the pane first.
    const lifecycleObserver = typeof MutationObserver !== "undefined"
      ? new MutationObserver(() => disposeIfOrphaned())
      : null;
    lifecycleObserver?.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    position();
    this.dockedFooterCleanup = () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      lifecycleObserver?.disconnect();
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", position, true);
    };
    return true;
  }

  closeFooterPopover({ restoreFocus = false } = {}) {
    const anchor = this.footerPopoverAnchor;
    this.footerPopoverCleanup?.();
    this.footerPopoverCleanup = null;
    if (this.footerPopoverEl?.isConnected) this.footerPopoverEl.remove();
    if (anchor) {
      anchor.classList?.remove("is-active");
      anchor.setAttribute?.("aria-expanded", "false");
      anchor.removeAttribute?.("aria-controls");
    }
    this.footerPopoverEl = null;
    this.footerPopoverAnchor = null;
    this.footerPopoverKind = "";
    this.formatBarEl = null;
    this.formatOpen = false;
    this.formatButtonEl?.classList?.remove("is-active");
    this.tagButtonEl?.classList?.remove("is-active");
    this.moreButtonEl?.classList?.remove("is-active");
    if (restoreFocus) anchor?.focus?.({ preventScroll: true });
  }

  positionFooterPopover(popover, anchor, align = "right") {
    if (!popover?.isConnected || !anchor?.isConnected) return;
    this.plugin.floatingController?.place(popover, anchor, {
      placement: align === "left" ? "top-start" : "top-end",
      gap: 8,
      padding: 10,
      flip: true,
      shift: true,
    });
  }

  openFooterPopover(anchor, popover, kind, { align = "right" } = {}) {
    if (!anchor || !popover) return null;
    this.closeContainerMenu({ restoreFocus: false });
    this.closeFooterPopover({ restoreFocus: false });
    popover.classList.add("today-task-detail-footer-popover");
    popover.dataset.kind = kind || "menu";
    if (!popover.id) popover.id = `today-task-detail-popover-${uid()}`;
    this.appendDetailPortal(popover, `footer-${kind || "menu"}`);
    this.footerPopoverEl = popover;
    this.footerPopoverAnchor = anchor;
    this.footerPopoverKind = kind || "menu";
    anchor.classList?.add("is-active");
    anchor.setAttribute?.("aria-expanded", "true");
    anchor.setAttribute?.("aria-controls", popover.id);

    const floatingCleanup = this.plugin.floatingController?.autoUpdate(popover, anchor, {
      placement: align === "left" ? "top-start" : "top-end",
      gap: 8,
      padding: 10,
      flip: true,
      shift: true,
    }) || (() => {});
    const onPointerDown = (event) => {
      if (popover.contains(event.target) || anchor.contains?.(event.target)) return;
      this.closeFooterPopover();
    };
    const onFocusIn = (event) => {
      if (popover.contains(event.target) || anchor.contains?.(event.target)) return;
      this.closeFooterPopover();
    };
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.closeFooterPopover({ restoreFocus: true });
    };
    const onBlur = () => this.closeFooterPopover();
    setTimeout(() => {
      if (this.footerPopoverEl !== popover || !popover.isConnected) return;
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("blur", onBlur, true);

    }, 0);
    this.footerPopoverCleanup = () => {
      floatingCleanup();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", onBlur, true);
    };
    this.positionFooterPopover(popover, anchor, align);
    requestAnimationFrame(() => popover.classList.add("is-open"));
    return popover;
  }

  closeContainerMenu({ restoreFocus = false } = {}) {
    const anchor = this.containerMenuAnchor;
    this.containerMenuCleanup?.();
    this.containerMenuCleanup = null;
    this.containerGroupMenuEl?.remove();
    this.containerSubmenuEl?.remove();
    this.containerMenuEl?.remove();
    this.containerGroupMenuEl = null;
    this.containerSubmenuEl = null;
    this.containerMenuEl = null;
    if (anchor) {
      anchor.classList?.remove("is-active");
      anchor.setAttribute?.("aria-expanded", "false");
      anchor.removeAttribute?.("aria-controls");
    }
    if (restoreFocus) anchor?.focus?.({ preventScroll: true });
    this.containerMenuAnchor = null;
  }

  async moveTaskToContainer(listId, groupId = null) {
    const taskId = this.taskId;
    const task = this.store.getTask(taskId);
    // A move action must target the exact list the user clicked. getList()
    // intentionally has a fallback for rendering and therefore is not suitable
    // for mutating container ownership.
    const list = this.store.data.lists.find((item) => item.id === listId);
    if (!task || !list) return false;
    const validGroupId = groupId && (list.groups || []).some((group) => group.id === groupId)
      ? groupId
      : null;

    // Container changes must be synchronous from the click's point of view.
    // Title/content input handlers already write directly into the same task
    // object, so there is nothing useful to await before changing listId. The
    // old implementation awaited a pending editor flush first; a blur/save race
    // could therefore remove the chooser while never reaching the actual move.
    if (this.persistTimer) {
      window.clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.hasLocalChanges = false;
    const beforeContainer = {
      listId: task.listId,
      groupId: task.groupId || null,
      updatedAt: task.updatedAt,
    };
    if (beforeContainer.listId !== list.id || beforeContainer.groupId !== (validGroupId || null)) {
      this.plugin.motionController?.prepareVisibleTaskLayoutTransition(taskId);
    }
    task.listId = list.id;
    task.groupId = validGroupId;
    task.updatedAt = Date.now();

    // Close the chooser only after the model already contains the new owner,
    // then redraw this detail immediately. This makes the footer label an
    // optimistic reflection of the source of truth rather than a side effect of
    // Task Center's later subscriber render.
    this.closeContainerMenu({ restoreFocus: false });
    if (this.taskId === taskId && this.contentEl?.isConnected) this.render();

    try {
      await this.store.changed();
    } catch (error) {
      console.error('[Today] Failed to persist task container move', error);
      new Notice('移动任务失败，请打开开发者控制台查看错误');
      return false;
    }

    // Verify the persisted in-memory source of truth. This is intentionally not
    // based on footer DOM state, because docked details may be rebuilt by store
    // subscribers during changed().
    const updated = this.store.getTask(taskId);
    if (!updated || updated.listId !== list.id || (updated.groupId || null) !== (validGroupId || null)) {
      console.error('[Today] Task container move verification failed', {
        taskId,
        expectedListId: list.id,
        expectedGroupId: validGroupId,
        actualListId: updated?.listId,
        actualGroupId: updated?.groupId,
      });
      new Notice('任务归属更新失败');
      return false;
    }

    if (!this.plugin.undoController?.isRestoring &&
        (beforeContainer.listId !== list.id || beforeContainer.groupId !== (validGroupId || null))) {
      const targetGroup = validGroupId ? (list.groups || []).find((item) => item.id === validGroupId) : null;
      const targetLabel = targetGroup ? `${list.name} / ${targetGroup.name}` : list.name;
      this.plugin.undoController?.push(`已移动到「${targetLabel}」`, async () => {
        const current = this.store.getTask(taskId);
        if (!current) return;
        current.listId = beforeContainer.listId;
        current.groupId = beforeContainer.groupId;
        current.updatedAt = beforeContainer.updatedAt;
        await this.store.changed();
      });
    }
    return true;
  }

  positionContainerPopover(popover, anchorRect, mode = "below") {
    if (!popover || !anchorRect) return;
    const placement = mode === "side" ? "right-start" : mode === "above" ? "top-start" : "bottom-start";
    this.plugin.floatingController?.place(popover, anchorRect, {
      placement,
      gap: 8,
      padding: 10,
      crossOffset: mode === "side" ? -4 : 0,
      flip: true,
      shift: true,
    });
    requestAnimationFrame(() => popover.classList.add("is-open"));
  }

  containerMenuRow({ icon, label, checked = false, hasSubmenu = false, muted = "" } = {}) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "today-task-detail-container-menu-row";
    row.setAttribute("role", hasSubmenu ? "menuitem" : "menuitemradio");
    if (!hasSubmenu) row.setAttribute("aria-checked", checked ? "true" : "false");
    if (checked) row.classList.add("is-active");
    const left = document.createElement("span");
    left.className = "today-task-detail-container-menu-left";
    left.append(this.makeIcon(icon || "list"), document.createTextNode(label || ""));
    row.appendChild(left);
    if (muted) {
      const meta = document.createElement("span");
      meta.className = "today-task-detail-container-menu-meta";
      meta.textContent = muted;
      row.appendChild(meta);
    }
    if (checked) row.appendChild(this.makeIcon("check", "today-task-detail-container-menu-check"));
    else if (hasSubmenu) row.appendChild(this.makeIcon("chevron-right", "today-task-detail-container-menu-chevron"));
    return row;
  }

  bindContainerMenuAction(row, action) {
    // Pointer selection must commit before any focus/outside-dismiss logic can
    // tear down the portalled menu tree. Keyboard activation still arrives as
    // click without a preceding pointerdown, so keep click as a fallback.
    let handledByPointer = false;
    row.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      handledByPointer = true;
      void action(event);
    });
    row.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (handledByPointer) {
        handledByPointer = false;
        return;
      }
      void action(event);
    });
  }

  openContainerGroupMenu(list, anchorRow) {
    this.containerGroupMenuEl?.remove();
    this.containerGroupMenuEl = null;
    if (!list || list.system) return;
    const task = this.task;
    if (!task) return;
    const panel = document.createElement("div");
    panel.className = "today-task-detail-container-menu today-task-detail-container-group-menu";
    panel.dataset.menuLevel = "3";
    panel.setAttribute("role", "menu");

    const ungrouped = this.containerMenuRow({
      icon: "minus",
      label: "未分组",
      checked: task.listId === list.id && !task.groupId,
    });
    this.bindContainerMenuAction(ungrouped, () => this.moveTaskToContainer(list.id, null));
    panel.appendChild(ungrouped);

    for (const group of this.store.getGroups(list.id)) {
      const row = this.containerMenuRow({
        icon: "rows-3",
        label: group.name,
        checked: task.listId === list.id && task.groupId === group.id,
      });
      this.bindContainerMenuAction(row, () => this.moveTaskToContainer(list.id, group.id));
      panel.appendChild(row);
    }
    this.appendDetailPortal(panel, "container-level-3");
    this.containerGroupMenuEl = panel;
    this.positionContainerPopover(panel, anchorRow.getBoundingClientRect(), "side");
  }

  openContainerFolderMenu(folder, anchorRow) {
    this.containerSubmenuEl?.remove();
    this.containerGroupMenuEl?.remove();
    this.containerSubmenuEl = null;
    this.containerGroupMenuEl = null;
    const task = this.task;
    if (!task || !folder) return;
    const lists = this.store.data.lists.filter((list) => !list.system && list.folderId === folder.id);
    const panel = document.createElement("div");
    panel.className = "today-task-detail-container-menu today-task-detail-container-list-menu";
    panel.dataset.menuLevel = "2";
    panel.setAttribute("role", "menu");
    if (!lists.length) {
      const empty = document.createElement("div");
      empty.className = "today-task-detail-container-menu-empty";
      empty.textContent = "暂无清单";
      panel.appendChild(empty);
    }
    for (const list of lists) {
      const groups = this.store.getGroups(list.id);
      const row = this.containerMenuRow({
        icon: "list",
        label: list.name,
        checked: task.listId === list.id && !task.groupId,
        hasSubmenu: groups.length > 0,
      });
      const activate = () => {
        if (groups.length) this.openContainerGroupMenu(list, row);
        else return this.moveTaskToContainer(list.id, null);
      };
      row.addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight" && groups.length) { event.preventDefault(); this.openContainerGroupMenu(list, row); }
      });
      this.bindContainerMenuAction(row, activate);
      panel.appendChild(row);
    }
    this.appendDetailPortal(panel, "container-level-2");
    this.containerSubmenuEl = panel;
    this.positionContainerPopover(panel, anchorRow.getBoundingClientRect(), "side");
  }

  openContainerSearchResult(list, anchorRow) {
    this.containerSubmenuEl?.remove();
    this.containerGroupMenuEl?.remove();
    this.containerSubmenuEl = null;
    this.containerGroupMenuEl = null;
    const groups = this.store.getGroups(list.id);
    if (groups.length) this.openContainerGroupMenu(list, anchorRow);
  }

  showContainerMenu(event) {
    const task = this.task;
    if (!task) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const anchor = event?.currentTarget || event?.target;
    if (this.containerMenuEl?.isConnected && this.containerMenuAnchor === anchor) {
      this.closeContainerMenu({ restoreFocus: true });
      return;
    }
    this.closeFooterPopover({ restoreFocus: false });
    this.closeContainerMenu({ restoreFocus: false });
    this.containerMenuAnchor = anchor;
    anchor?.classList?.add("is-active");
    anchor?.setAttribute?.("aria-expanded", "true");

    const menu = document.createElement("div");
    menu.className = "today-task-detail-container-menu today-task-detail-container-root-menu";
    menu.dataset.menuLevel = "1";
    menu.setAttribute("role", "menu");

    const searchWrap = document.createElement("div");
    searchWrap.className = "today-task-detail-container-search-wrap";
    searchWrap.appendChild(this.makeIcon("search"));
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "搜索清单";
    search.setAttribute("aria-label", "搜索清单");
    searchWrap.appendChild(search);
    menu.appendChild(searchWrap);

    const rowsHost = document.createElement("div");
    rowsHost.className = "today-task-detail-container-menu-rows";
    menu.appendChild(rowsHost);

    const renderRows = (query = "") => {
      rowsHost.replaceChildren();
      this.containerSubmenuEl?.remove();
      this.containerGroupMenuEl?.remove();
      this.containerSubmenuEl = null;
      this.containerGroupMenuEl = null;
      const q = query.trim().toLowerCase();

      const inbox = this.store.data.lists.find((list) => list.id === "inbox") || this.store.data.lists.find((list) => list.system);
      if (!q && inbox) {
        const row = this.containerMenuRow({ icon: "inbox", label: inbox.name, checked: task.listId === inbox.id });
        this.bindContainerMenuAction(row, () => this.moveTaskToContainer(inbox.id, null));
        rowsHost.appendChild(row);
      }

      if (q) {
        const matches = this.store.data.lists.filter((list) => !list.system && list.name.toLowerCase().includes(q));
        for (const list of matches) {
          const folder = this.store.getFolder(list.folderId);
          const groups = this.store.getGroups(list.id);
          const row = this.containerMenuRow({
            icon: "list",
            label: list.name,
            checked: task.listId === list.id && !task.groupId,
            hasSubmenu: groups.length > 0,
            muted: folder?.name || "",
          });
          const activate = () => this.openContainerSearchResult(list, row);
          row.addEventListener("keydown", (ev) => {
            if (ev.key === "ArrowRight" && groups.length) { ev.preventDefault(); activate(); }
          });
          this.bindContainerMenuAction(row, () => {
            if (groups.length) return this.openContainerGroupMenu(list, row);
            return this.moveTaskToContainer(list.id, null);
          });
          rowsHost.appendChild(row);
        }
        if (!matches.length) {
          const empty = document.createElement("div");
          empty.className = "today-task-detail-container-menu-empty";
          empty.textContent = "没有匹配清单";
          rowsHost.appendChild(empty);
        }
        return;
      }

      const currentList = this.store.data.lists.find((list) => list.id === task.listId) || null;
    const currentFolderId = currentList?.folderId || null;
    const folders = [...this.store.data.folders].sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(a.order || 0) - Number(b.order || 0));
      for (const folder of folders) {
        const lists = this.store.data.lists.filter((list) => !list.system && list.folderId === folder.id);
        if (!lists.length) continue;
        const row = this.containerMenuRow({ icon: "folder-open", label: folder.name, hasSubmenu: true });
        // Keep the existing menu focus scope stable while opening the next
        // portalled level. This also avoids a browser focus transition racing
        // with submenu creation on desktop Obsidian.
        const activate = () => this.openContainerFolderMenu(folder, row);
        row.addEventListener("keydown", (ev) => {
          if (ev.key === "ArrowRight") { ev.preventDefault(); activate(); }
        });
        this.bindContainerMenuAction(row, activate);
        rowsHost.appendChild(row);
      }
      const unfiled = this.store.data.lists.filter((list) => !list.system && !this.store.getFolder(list.folderId));
      for (const list of unfiled) {
        const groups = this.store.getGroups(list.id);
        const row = this.containerMenuRow({ icon: "list", label: list.name, checked: task.listId === list.id && !task.groupId, hasSubmenu: groups.length > 0 });
        row.addEventListener("keydown", (ev) => {
          if (ev.key === "ArrowRight" && groups.length) { ev.preventDefault(); this.openContainerGroupMenu(list, row); }
        });
        this.bindContainerMenuAction(row, () => {
          if (groups.length) return this.openContainerGroupMenu(list, row);
          return this.moveTaskToContainer(list.id, null);
        });
        rowsHost.appendChild(row);
      }
    };
    renderRows();
    search.addEventListener("input", () => renderRows(search.value));
    search.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        this.closeContainerMenu({ restoreFocus: true });
      }
    });

    if (!menu.id) menu.id = `today-task-detail-container-menu-${uid()}`;
    this.appendDetailPortal(menu, "container-level-1");
    this.containerMenuEl = menu;
    anchor?.setAttribute?.("aria-controls", menu.id);
    this.positionContainerPopover(menu, anchor.getBoundingClientRect(), "above");

    const containsTarget = (target) => [this.containerMenuEl, this.containerSubmenuEl, this.containerGroupMenuEl].some((panel) => panel?.contains?.(target));
    const onPointerDown = (ev) => {
      if (containsTarget(ev.target) || anchor?.contains?.(ev.target)) return;
      this.closeContainerMenu();
    };
    // A cascading menu is one logical focus scope even though each level is
    // portalled to document.body. Do not dismiss on focusin: moving from the
    // root menu to a child list/group menu (or clicking a submenu trigger)
    // must not be interpreted as leaving the chooser. Pointer-outside, Escape
    // and window blur are the authoritative dismissal paths.
    const onKeyDown = (ev) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      this.closeContainerMenu({ restoreFocus: true });
    };
    const onBlur = () => this.closeContainerMenu();
    setTimeout(() => {
      if (this.containerMenuEl !== menu || !menu.isConnected) return;
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("blur", onBlur, true);
    }, 0);
    this.containerMenuCleanup = () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", onBlur, true);
    };
    window.requestAnimationFrame(() => search.focus({ preventScroll: true }));
  }

  async addTag() {
    // Kept for callers from the More menu. Prefer the footer tag picker when it
    // has a live anchor; fall back to a prompt only outside the docked detail.
    if (this.tagButtonEl?.isConnected) {
      this.showTagMenu({ currentTarget: this.tagButtonEl, preventDefault() {}, stopPropagation() {} });
      return;
    }
    const task = this.task;
    if (!task) return;
    const raw = await this.app.todayPrompt("标签名称");
    if (!raw?.trim()) return;
    const tag = raw.trim().replace(/^#/, "");
    await this.patch({ tags: [...new Set([...(task.tags || []), tag])] });
  }

  showTagMenu(event) {
    const task = this.task;
    if (!task) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const anchor = event?.currentTarget || this.tagButtonEl;
    if (!anchor) return;
    if (this.footerPopoverKind === "tag" && this.footerPopoverAnchor === anchor) {
      this.closeFooterPopover({ restoreFocus: true });
      return;
    }

    const panel = document.createElement("div");
    panel.className = "today-task-detail-tag-popover";
    const inputWrap = document.createElement("div");
    inputWrap.className = "today-task-detail-footer-search";
    inputWrap.appendChild(this.makeIcon("search"));
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "输入标签";
    input.setAttribute("aria-label", "输入标签");
    inputWrap.appendChild(input);
    const rows = document.createElement("div");
    rows.className = "today-task-detail-footer-menu-rows";
    const actions = document.createElement("div");
    actions.className = "today-task-detail-footer-pop-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "取消";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "is-primary";
    confirm.textContent = "确定";
    let working = new Set(task.tags || []);
    const allTags = this.store.getAllTags();

    const draw = () => {
      rows.replaceChildren();
      const q = input.value.trim().replace(/^#+/, "").toLowerCase();
      const visible = allTags.filter((tag) => !q || tag.toLowerCase().includes(q));
      for (const tag of visible) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = `today-task-detail-footer-menu-row${working.has(tag) ? " is-active" : ""}`;
        row.append(this.makeIcon("tag"), document.createTextNode(tag));
        if (working.has(tag)) row.appendChild(this.makeIcon("check", "today-task-detail-footer-menu-check"));
        row.addEventListener("click", (ev) => {
          ev.preventDefault();
          working.has(tag) ? working.delete(tag) : working.add(tag);
          draw();
        });
        rows.appendChild(row);
      }
      if (!visible.length && !q) {
        const empty = document.createElement("div");
        empty.className = "today-task-detail-footer-menu-empty";
        empty.textContent = "暂无标签";
        rows.appendChild(empty);
      }
    };
    input.addEventListener("input", draw);
    cancel.addEventListener("click", () => this.closeFooterPopover({ restoreFocus: true }));
    confirm.addEventListener("click", async () => {
      const typed = input.value.trim().replace(/^#+/, "");
      if (typed) working.add(typed);
      const tags = [...working];
      this.closeFooterPopover();
      await this.patch({ tags });
    });
    actions.append(cancel, confirm);
    panel.append(inputWrap, rows, actions);
    draw();
    this.openFooterPopover(anchor, panel, "tag", { align: "right" });
    requestAnimationFrame(() => input.focus({ preventScroll: true }));
  }

  showMoreMenu(event) {
    const task = this.task;
    if (!task) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const anchor = event?.currentTarget || this.moreButtonEl;
    if (!anchor) return;
    if (this.footerPopoverKind === "more" && this.footerPopoverAnchor === anchor) {
      this.closeFooterPopover({ restoreFocus: true });
      return;
    }

    const panel = document.createElement("div");
    panel.className = "today-task-detail-more-popover";
    const addRow = (icon, label, handler, { danger = false, closeBefore = true } = {}) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `today-task-detail-footer-menu-row${danger ? " is-danger" : ""}`;
      row.append(this.makeIcon(icon), document.createTextNode(label));
      row.addEventListener("mousedown", (ev) => ev.preventDefault());
      row.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        // Some actions (notably 子任务) need to mutate/render the detail before
        // the owning popover is torn down. Closing first used to destroy the
        // functional layer and the follow-up composer never became visible.
        if (closeBefore) this.closeFooterPopover();
        await handler();
        if (!closeBefore && this.footerPopoverEl === panel) this.closeFooterPopover();
      });
      panel.appendChild(row);
      return row;
    };
    const divider = () => {
      const el = document.createElement("div");
      el.className = "today-task-detail-footer-menu-divider";
      panel.appendChild(el);
    };

    addRow("paperclip", "添加附件路径", async () => {
      const path = await this.app.todayPrompt("附件路径或 URL");
      if (!path?.trim()) return;
      await this.patch({ attachments: [...new Set([...(task.attachments || []), path.trim()])] });
    });
    addRow("git-branch", "子任务", async () => {
      this.openSubtaskComposer();
    });
    addRow("tag", "添加标签", async () => {
      requestAnimationFrame(() => this.showTagMenu({ currentTarget: this.tagButtonEl, preventDefault() {}, stopPropagation() {} }));
    });
    addRow("git-branch", "关联任务", async () => {
      const query = await this.app.todayPrompt("输入要关联的任务标题关键词");
      if (!query?.trim()) return;
      const q = query.trim().toLowerCase();
      const candidates = this.store.data.tasks.filter((candidate) => candidate.id !== task.id && candidate.title.toLowerCase().includes(q));
      if (!candidates.length) return new Notice("没有找到匹配任务");
      const target = candidates[0];
      await this.patch({ relatedTaskIds: [...new Set([...(task.relatedTaskIds || []), target.id])] });
      if (candidates.length > 1) new Notice(`已关联「${target.title}」；还有 ${candidates.length - 1} 个匹配项`);
    });
    addRow("link", "关联笔记路径", async () => {
      const path = await this.app.todayPrompt("Obsidian 笔记路径，例如 Projects/Spine.md");
      if (!path?.trim()) return;
      await this.patch({ relatedNotePaths: [...new Set([...(task.relatedNotePaths || []), path.trim()])] });
    });
    divider();
    if (task.parentTaskId) {
      addRow("corner-up-left", "移出父任务", async () => {
        await this.store.updateTaskParent(task.id, null);
        if (this.store.getTask(task.id)) this.render();
      });
    }
    addRow("trash-2", "删除任务", async () => {
      await this.store.deleteTask(task.id);
      this.close();
    }, { danger: true });

    this.openFooterPopover(anchor, panel, "more", { align: "right" });
  }

  escapeMarkdownText(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/([`*_~\[\]])/g, "\\$1");
  }

  inlineNodeToMarkdown(node) {
    if (!node) return "";
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue || "";
      if (/^\s+$/.test(value) && value.includes("\n")) return "";
      return this.escapeMarkdownText(value);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const tag = node.tagName.toLowerCase();
    if (tag === "br") return "\n";
    if (tag === "input") return "";
    const inner = [...node.childNodes].map((child) => this.inlineNodeToMarkdown(child)).join("");
    if (tag === "strong" || tag === "b") return inner ? `**${inner}**` : "";
    if (tag === "em" || tag === "i") return inner ? `*${inner}*` : "";
    if (tag === "del" || tag === "s" || tag === "strike") return inner ? `~~${inner}~~` : "";
    if (tag === "code") return inner ? `\`${inner.replace(/`/g, "\\`")}\`` : "";
    if (tag === "a") {
      const label = inner || this.escapeMarkdownText(node.textContent || "");
      const internal = node.getAttribute("data-href");
      if (internal && node.classList.contains("internal-link")) {
        const rawLabel = (node.textContent || "").trim();
        return rawLabel && rawLabel !== internal ? `[[${internal}|${rawLabel}]]` : `[[${internal}]]`;
      }
      const href = node.getAttribute("href") || "";
      return href ? `[${label}](${href})` : label;
    }
    return inner;
  }

  listItemInlineMarkdown(li) {
    const parts = [];
    for (const child of li.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        if (tag === "ul" || tag === "ol" || tag === "input") continue;
        if (tag === "p" || tag === "div") {
          parts.push([...child.childNodes].map((node) => this.inlineNodeToMarkdown(node)).join(""));
          continue;
        }
      }
      parts.push(this.inlineNodeToMarkdown(child));
    }
    return parts.join("").replace(/\s+$/g, "").trimStart();
  }

  listToMarkdown(list, depth = 0) {
    const ordered = list.tagName.toLowerCase() === "ol";
    const lines = [];
    const children = [...list.children].filter((child) => child.tagName?.toLowerCase() === "li");
    children.forEach((li, index) => {
      const directCheckbox = [...li.children].find((child) => child.matches?.('input[type="checkbox"]'));
      const isTask = Boolean(directCheckbox || li.classList.contains("task-list-item") || li.hasAttribute("data-task"));
      const checked = directCheckbox ? !!directCheckbox.checked : String(li.getAttribute("data-task") || "").toLowerCase() === "x";
      let marker = ordered ? `${index + 1}.` : "-";
      if (isTask) marker = `- [${checked ? "x" : " "}]`;
      const text = this.listItemInlineMarkdown(li) || " ";
      lines.push(`${"  ".repeat(depth)}${marker} ${text}`.trimEnd());
      for (const nested of [...li.children].filter((child) => ["ul", "ol"].includes(child.tagName?.toLowerCase()))) {
        lines.push(this.listToMarkdown(nested, depth + 1).replace(/\n+$/g, ""));
      }
    });
    return `${lines.join("\n")}\n`;
  }

  blockNodeToMarkdown(node) {
    if (!node) return "";
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue || "";
      return /^\s*$/.test(text) ? "" : `${this.escapeMarkdownText(text)}\n\n`;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const tag = node.tagName.toLowerCase();
    const inline = () => [...node.childNodes].map((child) => this.inlineNodeToMarkdown(child)).join("").trim();
    if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag.slice(1)))} ${inline()}\n\n`;
    if (tag === "p") return `${inline()}\n\n`;
    if (tag === "ul" || tag === "ol") return `${this.listToMarkdown(node)}\n`;
    if (tag === "blockquote") {
      const raw = [...node.childNodes].map((child) => {
        if (child.nodeType === Node.ELEMENT_NODE && ["p", "div"].includes(child.tagName.toLowerCase())) {
          return [...child.childNodes].map((part) => this.inlineNodeToMarkdown(part)).join("");
        }
        return this.inlineNodeToMarkdown(child);
      }).join("").trim();
      return raw ? `${raw.split("\n").map((line) => `> ${line}`).join("\n")}\n\n` : "> \n\n";
    }
    if (tag === "hr") return "---\n\n";
    if (tag === "pre") {
      const code = node.textContent || "";
      return `\`\`\`\n${code.replace(/\n+$/g, "")}\n\`\`\`\n\n`;
    }
    if (tag === "div") {
      const blockChildren = [...node.children].some((child) => ["p", "div", "ul", "ol", "blockquote", "hr", "pre"].includes(child.tagName?.toLowerCase()) || /^h[1-6]$/.test(child.tagName?.toLowerCase() || ""));
      if (blockChildren) return [...node.childNodes].map((child) => this.blockNodeToMarkdown(child)).join("");
      const text = inline();
      return text ? `${text}\n\n` : "";
    }
    const text = inline();
    return text ? `${text}\n\n` : "";
  }

  visualEditorToMarkdown(editor) {
    if (!editor) return "";
    let markdown = [...editor.childNodes].map((node) => this.blockNodeToMarkdown(node)).join("");
    markdown = markdown
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\n+|\n+$/g, "");
    return markdown;
  }

  syncVisualEditor(task = this.task) {
    const editor = this.editorEl;
    if (!task || !editor || !editor.isConnected) return;
    task.content = this.visualEditorToMarkdown(editor);
    task.updatedAt = Date.now();
    editor.dataset.empty = task.content.trim() ? "false" : "true";
    this.schedulePersist();
    window.requestAnimationFrame(() => this.placeNearAnchor());
  }

  currentEditableElement(editor) {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    let node = selection.anchorNode;
    if (!node) return null;
    if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
    if (!node || !editor.contains(node)) return null;
    return node;
  }

  wrapVisualSelection(tagName) {
    const editor = this.editorEl;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    const wrapper = document.createElement(tagName);
    if (range.collapsed) {
      wrapper.textContent = tagName === "code" ? "代码" : "文本";
      range.insertNode(wrapper);
      const next = document.createRange();
      next.selectNodeContents(wrapper);
      selection.removeAllRanges();
      selection.addRange(next);
    } else {
      try {
        range.surroundContents(wrapper);
      } catch (_) {
        wrapper.appendChild(range.extractContents());
        range.insertNode(wrapper);
      }
    }
  }

  normalizeChecklistItem(li) {
    if (!li) return null;
    const checkbox = [...li.children].find((child) => child.matches?.('input[type="checkbox"]')) || null;
    const checked = checkbox ? !!checkbox.checked : String(li.getAttribute("data-task") || "").toLowerCase() === "x";
    li.classList.add("task-list-item");
    li.setAttribute("data-task", checked ? "x" : " ");
    li.classList.toggle("is-checked", checked);
    li.removeAttribute("contenteditable");

    // Keep checklist text as native contenteditable list content. A real input
    // node at the start of <li> creates an extra caret stop in Chromium and
    // makes an empty task line behave like a form control instead of Markdown.
    // The checkbox is now a CSS marker backed by data-task, so the whole line
    // keeps normal Markdown editing semantics.
    if (checkbox) checkbox.remove();
    const textHost = [...li.children].find((child) => child.classList?.contains("today-task-detail-check-text")) || null;
    if (textHost) {
      while (textHost.firstChild) li.insertBefore(textHost.firstChild, textHost);
      textHost.remove();
    }
    const nestedLists = [...li.children].filter((child) => ["ul", "ol"].includes(child.tagName?.toLowerCase()));
    const hasInlineNode = [...li.childNodes].some((child) => !nestedLists.includes(child) && !(child.nodeType === Node.TEXT_NODE && !child.nodeValue));
    if (!hasInlineNode) li.insertBefore(document.createElement("br"), nestedLists[0] || null);
    return li;
  }

  normalizeVisualEditorStructure(editor = this.editorEl) {
    if (!editor) return;
    for (const li of editor.querySelectorAll("li.task-list-item, li[data-task]")) {
      this.normalizeChecklistItem(li);
      const parent = li.parentElement;
      if (parent?.tagName?.toLowerCase() === "ul") parent.classList.add("contains-task-list");
    }
    // Obsidian's Markdown renderer wraps blockquote text in <p>. Keep those
    // paragraphs compact and ensure a genuinely empty quote still owns a caret.
    for (const quote of editor.querySelectorAll("blockquote")) {
      if (!quote.childNodes.length) {
        const paragraph = document.createElement("p");
        paragraph.appendChild(document.createElement("br"));
        quote.appendChild(paragraph);
      }
    }
  }

  setChecklistState(li, checked) {
    if (!li?.classList?.contains("task-list-item")) return false;
    li.setAttribute("data-task", checked ? "x" : " ");
    li.classList.toggle("is-checked", !!checked);
    return true;
  }

  handleChecklistPointerDown(event) {
    if (event.button !== 0) return false;
    const li = event.target?.closest?.("li.task-list-item");
    if (!li || !this.editorEl?.contains(li)) return false;
    const rect = li.getBoundingClientRect();
    // Marker is painted in the first 23px of the list item. Only that compact
    // hit area toggles completion; clicks on text keep ordinary caret behavior.
    if (event.clientX > rect.left + 23) return false;
    event.preventDefault();
    event.stopPropagation();
    const checked = String(li.getAttribute("data-task") || "").toLowerCase() === "x";
    this.setChecklistState(li, !checked);
    this.syncVisualEditor();
    return true;
  }

  exitChecklistItemToParagraph(li) {
    const list = li?.parentElement;
    if (!list || list.tagName?.toLowerCase() !== "ul") return false;
    const paragraph = document.createElement("p");
    paragraph.appendChild(document.createElement("br"));
    const items = [...list.children].filter((child) => child.tagName?.toLowerCase() === "li");
    const index = items.indexOf(li);

    if (index <= 0) {
      list.parentNode?.insertBefore(paragraph, list);
    } else if (index === items.length - 1) {
      list.parentNode?.insertBefore(paragraph, list.nextSibling);
    } else {
      const tail = list.cloneNode(false);
      tail.classList.add("contains-task-list");
      for (const item of items.slice(index + 1)) tail.appendChild(item);
      list.parentNode?.insertBefore(paragraph, list.nextSibling);
      paragraph.parentNode?.insertBefore(tail, paragraph.nextSibling);
    }
    li.remove();
    if (![...list.children].some((child) => child.tagName?.toLowerCase() === "li")) list.remove();
    this.placeCaretAtEnd(paragraph);
    return true;
  }

  handleVisualEditorBackspace(event) {
    const editor = this.editorEl;
    const ctx = this.visualEditorCaretContext(editor);
    if (!ctx) return false;
    const li = ctx.block?.tagName?.toLowerCase() === "li" ? ctx.block : ctx.block?.closest?.("li.task-list-item");
    if (!li?.classList?.contains("task-list-item")) return false;
    const text = this.listItemInlineMarkdown(li).replace(/\u200b/g, "").trim();
    if (text || ctx.before.replace(/\u200b/g, "").length) return false;
    event.preventDefault();
    if (!this.exitChecklistItemToParagraph(li)) return false;
    this.syncVisualEditor();
    return true;
  }

  makeCurrentLineChecklist() {
    const editor = this.editorEl;
    if (!editor) return;
    let current = this.currentEditableElement(editor);
    let li = current?.closest?.("li");
    if (!li || !editor.contains(li)) {
      document.execCommand("insertUnorderedList", false, null);
      current = this.currentEditableElement(editor);
      li = current?.closest?.("li");
    }
    if (!li) return;
    li.classList.add("task-list-item");
    li.setAttribute("data-task", " ");
    const item = this.normalizeChecklistItem(li);
    const parent = li.parentElement;
    if (parent?.tagName?.toLowerCase() === "ul") parent.classList.add("contains-task-list");
    this.placeCaretAtEnd(item || li);
  }

  visualEditorCaretContext(editor = this.editorEl) {
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount || !selection.isCollapsed) return null;
    const anchor = selection.anchorNode;
    if (!anchor || !editor.contains(anchor)) return null;
    let element = anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement;
    if (!element) return null;
    let block = element.closest?.("li, p, h1, h2, h3, h4, h5, h6, blockquote, div");
    if (!block || block === editor || !editor.contains(block)) block = element;
    if (!block || block === editor || !editor.contains(block)) return null;
    try {
      const beforeRange = document.createRange();
      beforeRange.selectNodeContents(block);
      beforeRange.setEnd(anchor, selection.anchorOffset);
      const before = beforeRange.toString();
      return { selection, anchor, block, before, full: block.textContent || "" };
    } catch (_) {
      return null;
    }
  }

  placeCaretAtEnd(element) {
    if (!element) return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  replaceVisualBlock(block, replacement, caretTarget = replacement) {
    if (!block?.parentNode || !replacement) return false;
    block.parentNode.replaceChild(replacement, block);
    this.placeCaretAtEnd(caretTarget);
    return true;
  }

  makeChecklistItem(li, checked = false, clearMarker = false) {
    if (!li) return false;
    li.classList.add("task-list-item");
    li.setAttribute("data-task", checked ? "x" : " ");
    if (clearMarker) {
      const nestedLists = [...li.children].filter((child) => ["ul", "ol"].includes(child.tagName?.toLowerCase()));
      for (const child of [...li.childNodes]) {
        if (nestedLists.includes(child)) continue;
        child.remove();
      }
      li.insertBefore(document.createElement("br"), nestedLists[0] || null);
    }
    const item = this.normalizeChecklistItem(li);
    const parent = li.parentElement;
    if (parent?.tagName?.toLowerCase() === "ul") parent.classList.add("contains-task-list");
    this.placeCaretAtEnd(item || li);
    return true;
  }

  convertVisualBlockMarkerOnSpace(event) {
    const editor = this.editorEl;
    const ctx = this.visualEditorCaretContext(editor);
    if (!ctx || ctx.before !== ctx.full) return false;
    const { block, before } = ctx;
    const tag = block.tagName?.toLowerCase?.() || "";

    if (tag === "li") {
      const match = before.match(/^\[([ xX])\]$/);
      if (!match) return false;
      event.preventDefault();
      this.makeChecklistItem(block, match[1].toLowerCase() === "x", true);
      this.syncVisualEditor();
      return true;
    }

    if (!["p", "div", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) return false;
    const createEmpty = (name) => {
      const el = document.createElement(name);
      el.appendChild(document.createElement("br"));
      return el;
    };

    let replacement = null;
    let caretTarget = null;
    if (/^#{1,3}$/.test(before)) {
      replacement = createEmpty(`h${before.length}`);
    } else if (before === ">") {
      const quote = document.createElement("blockquote");
      const paragraph = createEmpty("p");
      quote.appendChild(paragraph);
      replacement = quote;
      caretTarget = paragraph;
    } else if (["-", "*", "+"].includes(before)) {
      const list = document.createElement("ul");
      const li = createEmpty("li");
      list.appendChild(li);
      replacement = list;
      caretTarget = li;
    } else if (/^1\.$/.test(before)) {
      const list = document.createElement("ol");
      const li = createEmpty("li");
      list.appendChild(li);
      replacement = list;
      caretTarget = li;
    } else {
      return false;
    }

    event.preventDefault();
    if (this.replaceVisualBlock(block, replacement, caretTarget || replacement)) {
      this.syncVisualEditor();
      return true;
    }
    return false;
  }

  convertVisualInlineMarkdownOnSpace(event) {
    const editor = this.editorEl;
    const ctx = this.visualEditorCaretContext(editor);
    if (!ctx || ctx.before !== ctx.full) return false;
    const { block, before } = ctx;
    const allowed = [...block.childNodes].every((node) => {
      if (node.nodeType === Node.TEXT_NODE) return true;
      if (node.nodeType !== Node.ELEMENT_NODE) return false;
      const tag = node.tagName.toLowerCase();
      return tag === "br" || (tag === "input" && node.matches?.('input[type="checkbox"]'));
    });
    if (!allowed || !before) return false;

    const patterns = [
      { re: /\*\*([^*\n]+)\*\*$/, tag: "strong", group: 1 },
      { re: /__([^_\n]+)__$/, tag: "strong", group: 1 },
      { re: /~~([^~\n]+)~~$/, tag: "del", group: 1 },
      { re: /`([^`\n]+)`$/, tag: "code", group: 1 },
      { re: /(^|[^*])\*([^*\n]+)\*$/, tag: "em", group: 2, prefixGroup: 1 },
      { re: /(^|[^_])_([^_\n]+)_$/, tag: "em", group: 2, prefixGroup: 1 },
    ];
    let matched = null;
    for (const pattern of patterns) {
      const match = before.match(pattern.re);
      if (match) { matched = { ...pattern, match }; break; }
    }
    if (!matched) return false;

    const markerStart = matched.match.index + (matched.prefixGroup ? (matched.match[matched.prefixGroup] || "").length : 0);
    const prefix = before.slice(0, markerStart);
    const value = matched.match[matched.group] || "";
    if (!value.trim()) return false;

    event.preventDefault();
    const nestedLists = [...block.children].filter((child) => ["ul", "ol"].includes(child.tagName?.toLowerCase()));
    for (const child of [...block.childNodes]) {
      if (nestedLists.includes(child)) continue;
      child.remove();
    }
    if (prefix) block.appendChild(document.createTextNode(prefix));
    const wrapper = document.createElement(matched.tag);
    wrapper.textContent = value;
    block.appendChild(wrapper);
    block.appendChild(document.createTextNode(" "));
    for (const nested of nestedLists) block.appendChild(nested);
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      const spacer = wrapper.nextSibling;
      if (spacer?.nodeType === Node.TEXT_NODE) range.setStart(spacer, spacer.nodeValue.length);
      else { range.selectNodeContents(block); range.collapse(false); }
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    this.syncVisualEditor();
    return true;
  }

  handleVisualEditorEnter(event) {
    const editor = this.editorEl;
    const ctx = this.visualEditorCaretContext(editor);
    if (!ctx || ctx.before !== ctx.full) return false;
    const { block, before } = ctx;
    const tag = block.tagName?.toLowerCase?.() || "";

    // A quote behaves like a normal writing block: Enter creates the next quote
    // line, and Enter again on that empty line exits to a plain paragraph.
    const quote = tag === "blockquote" ? block : block.closest?.("blockquote");
    if (quote) {
      const line = block === quote ? quote : block;
      const lineText = (line.textContent || "").replace(/\u200b/g, "").trim();
      if (!lineText && !before.trim()) {
        event.preventDefault();
        const paragraph = document.createElement("p");
        paragraph.appendChild(document.createElement("br"));
        quote.parentNode?.insertBefore(paragraph, quote.nextSibling);
        if (line !== quote) line.remove();
        const remainingText = (quote.textContent || "").replace(/\u200b/g, "").trim();
        const meaningfulChildren = [...quote.children].some((child) => {
          if (["p", "div"].includes(child.tagName?.toLowerCase())) return (child.textContent || "").trim().length > 0;
          return true;
        });
        if (!remainingText && !meaningfulChildren) quote.remove();
        this.placeCaretAtEnd(paragraph);
        this.syncVisualEditor();
        return true;
      }
    }

    if (["p", "div", "blockquote"].includes(tag) && ["---", "***", "___"].includes(before.trim())) {
      event.preventDefault();
      const hr = document.createElement("hr");
      const paragraph = document.createElement("p");
      paragraph.appendChild(document.createElement("br"));
      block.parentNode?.insertBefore(hr, block);
      block.parentNode?.replaceChild(paragraph, block);
      this.placeCaretAtEnd(paragraph);
      this.syncVisualEditor();
      return true;
    }

    if (tag !== "li" || !block.classList.contains("task-list-item")) return false;
    const text = this.listItemInlineMarkdown(block).trim();
    const list = block.parentElement;
    if (!list || list.tagName?.toLowerCase() !== "ul") return false;

    event.preventDefault();
    if (!text) {
      const paragraph = document.createElement("p");
      paragraph.appendChild(document.createElement("br"));
      list.parentNode?.insertBefore(paragraph, list.nextSibling);
      block.remove();
      if (![...list.children].some((child) => child.tagName?.toLowerCase() === "li")) list.remove();
      this.placeCaretAtEnd(paragraph);
    } else {
      const li = document.createElement("li");
      li.className = "task-list-item";
      li.setAttribute("data-task", " ");
      li.appendChild(document.createElement("br"));
      list.insertBefore(li, block.nextSibling);
      list.classList.add("contains-task-list");
      const item = this.normalizeChecklistItem(li);
      this.placeCaretAtEnd(item || li);
    }
    this.syncVisualEditor();
    return true;
  }

  makeCurrentLineQuote() {
    const editor = this.editorEl;
    const ctx = this.visualEditorCaretContext(editor);
    if (!editor || !ctx) return false;
    const block = ctx.block;
    if (!block || block === editor || block.closest?.("blockquote")) return false;
    const quote = document.createElement("blockquote");
    const paragraph = document.createElement("p");
    const movable = [...block.childNodes];
    for (const child of movable) paragraph.appendChild(child);
    if (!paragraph.childNodes.length) paragraph.appendChild(document.createElement("br"));
    quote.appendChild(paragraph);
    if (!this.replaceVisualBlock(block, quote, paragraph)) return false;
    return true;
  }

  insertMarkdown(kind) {
    const editor = this.editorEl;
    if (!editor) return;
    const selection = window.getSelection();
    const selectionInside = selection?.rangeCount && editor.contains(selection.anchorNode);
    if (!selectionInside) editor.focus({ preventScroll: true });

    if (kind === "bold") document.execCommand("bold", false, null);
    else if (kind === "italic") document.execCommand("italic", false, null);
    else if (kind === "strike") document.execCommand("strikeThrough", false, null);
    else if (kind === "h1") document.execCommand("formatBlock", false, "h1");
    else if (kind === "h2") document.execCommand("formatBlock", false, "h2");
    else if (kind === "h3") document.execCommand("formatBlock", false, "h3");
    else if (kind === "bullet") document.execCommand("insertUnorderedList", false, null);
    else if (kind === "number") document.execCommand("insertOrderedList", false, null);
    else if (kind === "check") this.makeCurrentLineChecklist();
    else if (kind === "quote") this.makeCurrentLineQuote();
    else if (kind === "divider") document.execCommand("insertHorizontalRule", false, null);
    else if (kind === "code") this.wrapVisualSelection("code");

    this.syncVisualEditor();
    editor.focus({ preventScroll: true });
  }

  closeFormatToolbar({ focusEditor = false } = {}) {
    if (this.footerPopoverKind === "format") this.closeFooterPopover({ restoreFocus: false });
    else {
      this.formatBarEl?.remove();
      this.formatBarEl = null;
      this.formatOpen = false;
      this.formatButtonEl?.classList?.remove("is-active");
    }
    if (focusEditor) this.editorEl?.focus?.({ preventScroll: true });
  }

  installFormatDismiss(_bar) {
    // Footer popovers share one dismissal lifecycle in openFooterPopover().
  }

  renderFormatToolbar(_container) {
    const anchor = this.formatButtonEl;
    if (!anchor?.isConnected) return null;
    if (this.footerPopoverKind === "format" && this.footerPopoverAnchor === anchor) {
      this.closeFooterPopover({ restoreFocus: true });
      return null;
    }
    const bar = document.createElement("div");
    bar.className = "today-task-detail-formatbar";
    bar.setAttribute("role", "toolbar");
    const actions = [
      ["h1", "heading-1", "一级标题"],
      ["h2", "heading-2", "二级标题"],
      ["h3", "heading-3", "三级标题"],
      ["bold", "bold", "粗体"],
      ["italic", "italic", "斜体"],
      ["strike", "strikethrough", "删除线"],
      ["bullet", "list", "无序列表"],
      ["number", "list-ordered", "有序列表"],
      ["check", "list-checks", "检查事项"],
      ["quote", "quote", "引用"],
      ["divider", "minus", "分隔线"],
      ["code", "code-2", "行内代码"],
    ];
    for (const [kind, icon, label] of actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "today-task-detail-format-tool";
      btn.title = label;
      btn.setAttribute("aria-label", label);
      setIcon(btn, icon);
      btn.addEventListener("mousedown", (event) => event.preventDefault());
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.insertMarkdown(kind);
      });
      bar.appendChild(btn);
    }
    this.formatBarEl = bar;
    this.formatOpen = true;
    this.openFooterPopover(anchor, bar, "format", { align: "right" });
    this.formatOpen = true;
    anchor.classList.add("is-active");
    return bar;
  }

  async renderVisualEditor(container, task) {
    const editor = document.createElement("div");
    editor.className = "today-task-detail-preview today-task-detail-visual-editor markdown-rendered";
    editor.setAttribute("contenteditable", "true");
    editor.setAttribute("role", "textbox");
    editor.setAttribute("aria-multiline", "true");
    editor.setAttribute("data-placeholder", "输入内容或使用 / 快速插入");
    editor.spellcheck = true;
    editor.dataset.empty = task.content.trim() ? "false" : "true";
    this.editorEl = editor;
    container.appendChild(editor);

    const renderToken = `${task.id}-${Date.now()}-${Math.random()}`;
    this.visualRenderToken = renderToken;
    try {
      if (task.content.trim()) {
        editor.setAttribute("contenteditable", "false");
        await MarkdownRenderer.render(this.app, task.content, editor, "", this.plugin);
      } else {
        const paragraph = document.createElement("p");
        paragraph.appendChild(document.createElement("br"));
        editor.appendChild(paragraph);
      }
    } catch (_) {
      editor.textContent = task.content || "";
    }
    // The Task Center renders its docked detail pane while the pane is still
    // detached from document.body, then mounts it into the three-column shell.
    // `isConnected` therefore used to abort here, which meant the docked editor
    // never received input/keydown listeners: its placeholder stayed visible and
    // Markdown shortcuts were not converted in real time.  Treat the editor as
    // current as long as it still belongs to this render container; this keeps the
    // exact same live WYSIWYG editor for both timeline popovers and the docked pane.
    if (this.visualRenderToken !== renderToken || this.taskId !== task.id || editor.parentElement !== container) return;
    editor.setAttribute("contenteditable", "true");
    editor.dataset.empty = task.content.trim() ? "false" : "true";

    this.normalizeVisualEditorStructure(editor);

    editor.addEventListener("pointerdown", (event) => {
      this.handleChecklistPointerDown(event);
    });
    editor.addEventListener("input", () => {
      this.syncVisualEditor(task);
      this.updateSlashMenuFromEditor();
    });
    editor.addEventListener("click", (event) => {
      const link = event.target?.closest?.("a");
      if (link && !event.metaKey && !event.ctrlKey) event.preventDefault();
    });
    editor.addEventListener("paste", (event) => {
      event.preventDefault();
      const plain = event.clipboardData?.getData("text/plain") || "";
      document.execCommand("insertText", false, plain);
    });
    editor.addEventListener("keydown", (event) => {
      if (this.slashMenuEl && this.handleSlashMenuKeydown(event)) return;
      if (event.isComposing) return;
      const hasCommandModifier = event.metaKey || event.ctrlKey || event.altKey;
      if (!hasCommandModifier && !event.shiftKey && event.key === "Backspace") {
        if (this.handleVisualEditorBackspace(event)) return;
      }
      if (!hasCommandModifier && event.key === " ") {
        if (this.convertVisualBlockMarkerOnSpace(event)) return;
        if (this.convertVisualInlineMarkdownOnSpace(event)) return;
      }
      if (!hasCommandModifier && !event.shiftKey && event.key === "Enter") {
        if (this.handleVisualEditorEnter(event)) return;
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "b") { event.preventDefault(); this.insertMarkdown("bold"); }
      else if (key === "i") { event.preventDefault(); this.insertMarkdown("italic"); }
    });
    editor.addEventListener("blur", (event) => {
      const next = event.relatedTarget;
      if (next && (container.contains(next) || next.closest?.(".today-task-detail-footer") || this.slashMenuEl?.contains?.(next))) return;
      this.flushLocalChanges(true);
    });
  }

  closeSlashMenu() {
    this.slashMenuCleanup?.();
    this.slashMenuCleanup = null;
    if (this.slashMenuEl?.isConnected) this.slashMenuEl.remove();
    this.slashMenuEl = null;
    this.slashMenuCommands = [];
    this.slashMenuActiveIndex = 0;
    this.slashMenuQuery = null;
  }

  slashCommandContext() {
    const ctx = this.visualEditorCaretContext(this.editorEl);
    if (!ctx || ctx.before !== ctx.full) return null;
    const tag = ctx.block?.tagName?.toLowerCase?.() || "";
    // Keep slash commands block-oriented. Checklist/list items already have
    // their own Enter/marker semantics and should not lose their checkbox/list
    // structure when the slash token is removed.
    if (tag === "li") return null;
    const match = ctx.before.match(/^\/([^\s/]*)$/u);
    if (!match) return null;
    return { ...ctx, query: match[1] || "" };
  }

  slashCaretRect(ctx = this.slashCommandContext()) {
    if (!ctx) return null;
    const selection = window.getSelection();
    try {
      if (selection?.rangeCount) {
        const range = selection.getRangeAt(0).cloneRange();
        range.collapse(true);
        const rect = range.getBoundingClientRect();
        if (rect && (rect.width || rect.height || rect.left || rect.top)) {
          return { left: rect.left, right: rect.right || rect.left, top: rect.top, bottom: rect.bottom || rect.top + 18, width: rect.width || 1, height: rect.height || 18 };
        }
      }
    } catch (_) {}
    const rect = ctx.block?.getBoundingClientRect?.();
    if (!rect) return null;
    return { left: rect.left, right: rect.left + 1, top: rect.top, bottom: rect.bottom, width: 1, height: rect.height };
  }

  positionSlashMenu(panel = this.slashMenuEl, rect = this.slashCaretRect()) {
    if (!panel?.isConnected || !rect) return;
    const gutter = 10;
    const gap = 7;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const width = panel.offsetWidth || 238;
    const height = panel.offsetHeight || 360;
    let left = rect.left;
    let top = rect.bottom + gap;
    if (left + width > viewportWidth - gutter) left = Math.max(gutter, viewportWidth - width - gutter);
    if (left < gutter) left = gutter;
    if (top + height > viewportHeight - gutter) top = Math.max(gutter, rect.top - height - gap);
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }

  slashCommandDefinitions() {
    return [
      { id: "h1", icon: "heading-1", label: "一级标题", keywords: "标题 h1" },
      { id: "h2", icon: "heading-2", label: "二级标题", keywords: "标题 h2" },
      { id: "h3", icon: "heading-3", label: "三级标题", keywords: "标题 h3" },
      { id: "bullet", icon: "list", label: "无序列表", keywords: "列表 bullet" },
      { id: "number", icon: "list-ordered", label: "有序列表", keywords: "列表 number" },
      { id: "check", icon: "list-checks", label: "检查项", keywords: "todo checklist" },
      { id: "quote", icon: "quote", label: "引用", keywords: "quote" },
      { id: "divider", icon: "minus", label: "水平分割线", keywords: "分割 divider hr" },
      { id: "attachment", icon: "paperclip", label: "附件", keywords: "附件 文件 attachment", separatorBefore: true },
      { id: "subtask", icon: "git-branch", label: "子任务", keywords: "子任务 subtask" },
      { id: "tag", icon: "tag", label: "标签", keywords: "标签 tag" },
      { id: "related", icon: "git-branch", label: "关联任务/笔记", keywords: "关联 任务 笔记 link related" },
    ];
  }

  updateSlashMenuActive() {
    const panel = this.slashMenuEl;
    if (!panel) return;
    const rows = [...panel.querySelectorAll(".today-task-detail-slash-row")];
    if (!rows.length) return;
    this.slashMenuActiveIndex = Math.max(0, Math.min(this.slashMenuActiveIndex, rows.length - 1));
    rows.forEach((row, index) => {
      const active = index === this.slashMenuActiveIndex;
      row.classList.toggle("is-active", active);
      row.setAttribute("aria-selected", active ? "true" : "false");
    });

    const activeRow = rows[this.slashMenuActiveIndex];
    activeRow?.scrollIntoView?.({ block: "nearest" });

    // The slash menu is portalled to document.body, so use a dedicated moving
    // selection surface rather than relying only on root-scoped hover tokens.
    // This also gives ArrowUp/ArrowDown a visible continuity cue instead of an
    // abrupt per-row background toggle.
    let selection = panel.querySelector(".today-task-detail-slash-selection");
    if (!selection) {
      selection = document.createElement("div");
      selection.className = "today-task-detail-slash-selection";
      selection.setAttribute("aria-hidden", "true");
      panel.prepend(selection);
    }
    if (activeRow) {
      selection.style.height = `${activeRow.offsetHeight}px`;
      selection.style.transform = `translate3d(0, ${activeRow.offsetTop}px, 0)`;
      selection.classList.add("is-visible");
    } else {
      selection.classList.remove("is-visible");
    }
  }

  updateSlashMenuFromEditor() {
    const ctx = this.slashCommandContext();
    if (!ctx) {
      this.closeSlashMenu();
      return false;
    }
    const query = ctx.query.trim().toLowerCase();
    const queryChanged = this.slashMenuQuery !== query;
    this.slashMenuQuery = query;
    const commands = this.slashCommandDefinitions().filter((command) => {
      if (!query) return true;
      return `${command.label} ${command.keywords || ""}`.toLowerCase().includes(query);
    });

    let panel = this.slashMenuEl;
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "today-task-detail-slash-popover";
      panel.setAttribute("role", "listbox");
      panel.setAttribute("aria-label", "快速插入");
      this.appendDetailPortal(panel, "slash-command");
      this.slashMenuEl = panel;
      const onPointerDown = (event) => {
        if (panel.contains(event.target) || this.editorEl?.contains?.(event.target)) return;
        this.closeSlashMenu();
      };
      const onResize = () => this.positionSlashMenu();
      const onScroll = () => this.positionSlashMenu();
      // Capture slash-menu navigation before Obsidian/editor-level key handlers.
      // A bubbling listener on the contenteditable is too late in some desktop
      // configurations: Arrow/Enter can be consumed by the host before it
      // reaches the editor. Keep the menu model active at window-capture level,
      // but only for keystrokes originating from this detail editor.
      const onKeyDownCapture = (event) => {
        if (!this.slashMenuEl || !this.editorEl) return;
        const target = event.target;
        if (!(target === this.editorEl || this.editorEl.contains?.(target))) return;
        const navigationKey = event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End" || event.key === "Enter" || event.key === "Tab" || event.key === "Escape";
        if (!navigationKey) return;
        // `isComposing` can remain true briefly with CJK IMEs even after a slash
        // token is visibly committed. An open slash menu should still own its
        // navigation keys. Filtering text itself is left to normal IME input.
        this.handleSlashMenuKeydown(event);
      };
      setTimeout(() => document.addEventListener("pointerdown", onPointerDown, true), 0);
      window.addEventListener("keydown", onKeyDownCapture, true);
      window.addEventListener("resize", onResize);
      document.addEventListener("scroll", onScroll, true);
      this.slashMenuCleanup = () => {
        document.removeEventListener("pointerdown", onPointerDown, true);
        window.removeEventListener("keydown", onKeyDownCapture, true);
        window.removeEventListener("resize", onResize);
        document.removeEventListener("scroll", onScroll, true);
      };
      requestAnimationFrame(() => panel.classList.add("is-open"));
    }

    panel.replaceChildren();
    this.slashMenuCommands = commands;
    // A fresh slash menu, or a newly filtered result set, always starts on
    // the first candidate. This mirrors command palettes: typing narrows the
    // list, then ArrowUp/ArrowDown moves from a predictable selection.
    if (queryChanged) this.slashMenuActiveIndex = 0;
    else this.slashMenuActiveIndex = Math.min(this.slashMenuActiveIndex, Math.max(0, commands.length - 1));
    if (!commands.length) {
      const empty = document.createElement("div");
      empty.className = "today-task-detail-slash-empty";
      empty.textContent = "没有匹配的插入项";
      panel.appendChild(empty);
    } else {
      commands.forEach((command, index) => {
        if (command.separatorBefore && panel.childElementCount) {
          const divider = document.createElement("div");
          divider.className = "today-task-detail-slash-divider";
          panel.appendChild(divider);
        }
        const row = document.createElement("button");
        row.type = "button";
        row.className = "today-task-detail-slash-row";
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", "false");
        row.tabIndex = -1;
        row.dataset.commandId = command.id;
        const label = document.createElement("span");
        label.className = "today-task-detail-slash-label";
        label.textContent = command.label;
        row.append(this.makeIcon(command.icon), label);
        row.addEventListener("mousedown", (event) => event.preventDefault());
        row.addEventListener("mouseenter", () => {
          this.slashMenuActiveIndex = index;
          this.updateSlashMenuActive();
        });
        row.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          void this.runSlashCommand(command.id);
        });
        panel.appendChild(row);
      });
      this.updateSlashMenuActive();
    }
    this.positionSlashMenu(panel, this.slashCaretRect(ctx));
    return true;
  }

  handleSlashMenuKeydown(event) {
    if (!this.slashMenuEl) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.closeSlashMenu();
      return true;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      if (!this.slashMenuCommands.length) return true;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Home") this.slashMenuActiveIndex = 0;
      else if (event.key === "End") this.slashMenuActiveIndex = this.slashMenuCommands.length - 1;
      else {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        this.slashMenuActiveIndex = (this.slashMenuActiveIndex + delta + this.slashMenuCommands.length) % this.slashMenuCommands.length;
      }
      this.updateSlashMenuActive();
      return true;
    }
    if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
      const command = this.slashMenuCommands[this.slashMenuActiveIndex];
      if (!command) return false;
      event.preventDefault();
      event.stopPropagation();
      void this.runSlashCommand(command.id);
      return true;
    }
    return false;
  }

  removeSlashTrigger() {
    const ctx = this.slashCommandContext();
    if (!ctx) return false;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return false;
    try {
      const range = document.createRange();
      range.selectNodeContents(ctx.block);
      range.setEnd(selection.anchorNode, selection.anchorOffset);
      range.deleteContents();
      if (!(ctx.block.textContent || "").length && !ctx.block.querySelector("br")) ctx.block.appendChild(document.createElement("br"));
      this.placeCaretAtEnd(ctx.block);
      this.syncVisualEditor(this.task);
      return true;
    } catch (_) {
      return false;
    }
  }

  async runSlashCommand(commandId) {
    const task = this.task;
    if (!task) return;
    this.removeSlashTrigger();
    this.closeSlashMenu();
    const formatCommands = new Set(["h1", "h2", "h3", "bullet", "number", "check", "quote", "divider"]);
    if (formatCommands.has(commandId)) {
      this.insertMarkdown(commandId);
      return;
    }
    if (commandId === "subtask") {
      this.openSubtaskComposer();
      return;
    }
    if (commandId === "attachment") {
      const path = await this.app.todayPrompt("附件路径或 URL");
      if (!path?.trim()) return;
      await this.patch({ attachments: [...new Set([...(task.attachments || []), path.trim()])] });
      return;
    }
    if (commandId === "tag") {
      requestAnimationFrame(() => {
        if (this.tagButtonEl) this.showTagMenu({ currentTarget: this.tagButtonEl, preventDefault() {}, stopPropagation() {} });
      });
      return;
    }
    if (commandId === "related") {
      const raw = await this.app.todayPrompt("输入任务标题关键词，或输入 Obsidian 笔记路径");
      if (!raw?.trim()) return;
      const value = raw.trim();
      const q = value.toLowerCase();
      const candidates = this.store.data.tasks.filter((candidate) => candidate.id !== task.id && candidate.title.toLowerCase().includes(q));
      if (candidates.length) {
        const target = candidates[0];
        await this.patch({ relatedTaskIds: [...new Set([...(task.relatedTaskIds || []), target.id])] });
        if (candidates.length > 1) new Notice(`已关联「${target.title}」；还有 ${candidates.length - 1} 个匹配项`);
      } else {
        await this.patch({ relatedNotePaths: [...new Set([...(task.relatedNotePaths || []), value])] });
      }
    }
  }

  refreshSubtasksSection({ focus = false } = {}) {
    const task = this.task;
    const host = this.contentEl;
    const contentWrap = this.contentWrapEl?.isConnected
      ? this.contentWrapEl
      : host?.querySelector?.(":scope > .today-task-detail-content-wrap");
    if (!task || !host || !contentWrap) return null;
    const previous = contentWrap.querySelector(":scope > .today-task-detail-subtasks");
    const staging = document.createElement("div");
    this.renderSubtasks(staging, task);
    const next = staging.firstElementChild;
    if (previous && next) previous.replaceWith(next);
    else if (previous && !next) previous.remove();
    else if (next) contentWrap.appendChild(next);
    contentWrap.classList.toggle("has-subtasks", Boolean(next));
    if (focus) {
      window.requestAnimationFrame(() => {
        const input = contentWrap.querySelector(".today-task-detail-subtask-input");
        input?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
        input?.focus?.({ preventScroll: true });
      });
    }
    return next || null;
  }

  openSubtaskComposer() {
    this.subtaskComposerOpen = true;
    // Do not rebuild the whole detail document just to reveal one input. A full
    // render tears down the footer/menu owner while the menu click is still
    // dispatching; updating only the relationship section is deterministic for
    // both the More menu and the slash-command entry point.
    this.refreshSubtasksSection({ focus: true });
  }

  renderTaskBreadcrumb(container, task) {
    const ancestors = this.store.taskAncestors(task);
    if (!ancestors.length) return;
    const nav = document.createElement("nav");
    nav.className = "today-task-detail-breadcrumb";
    nav.setAttribute("aria-label", "父任务路径");
    ancestors.forEach((ancestor, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "today-task-detail-breadcrumb-item";
      button.textContent = ancestor.title || "未命名任务";
      button.title = `返回父任务：${ancestor.title || "未命名任务"}`;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.setTask(ancestor.id);
      });
      nav.appendChild(button);
      const chevron = this.makeIcon("chevron-right", "today-task-detail-breadcrumb-chevron");
      chevron.setAttribute("aria-hidden", "true");
      nav.appendChild(chevron);
    });
    container.appendChild(nav);
  }

  clearSubtaskDropStates(section) {
    section?.querySelectorAll?.(".is-subtask-dragging, .is-subtask-drop-before, .is-subtask-drop-end").forEach((node) => {
      node.classList.remove("is-subtask-dragging", "is-subtask-drop-before", "is-subtask-drop-end");
    });
  }

  renderSubtasks(container, task) {
    const children = this.store.childTasks(task.id);
    if (!children.length && !this.subtaskComposerOpen) return;

    const section = document.createElement("section");
    section.className = "today-task-detail-subtasks";
    section.setAttribute("aria-label", "子任务");

    const head = document.createElement("div");
    head.className = "today-task-detail-subtasks-head";
    const label = document.createElement("span");
    label.className = "today-task-detail-subtasks-label";
    label.textContent = "子任务";
    const progress = document.createElement("span");
    progress.className = "today-task-detail-subtasks-progress";
    const doneCount = children.filter((child) => child.done).length;
    progress.textContent = `${doneCount}/${children.length}`;
    head.append(label, progress);
    section.appendChild(head);

    const list = document.createElement("div");
    list.className = "today-task-detail-subtask-list";
    for (const child of children) {
      const row = document.createElement("div");
      row.className = `today-task-detail-subtask today-center-task is-ticktick-row priority-${child.priority || 0}${child.done ? " is-done" : ""}`;
      row.dataset.subtaskId = child.id;
      row.dataset.todayTaskId = child.id;

      const handle = document.createElement("span");
      handle.className = "today-task-detail-subtask-handle";
      handle.title = "拖动排序";
      handle.setAttribute("draggable", "true");
      handle.setAttribute("aria-label", `拖动子任务 ${child.title}`);
      setIcon(handle, "grip-vertical");

      const check = document.createElement("button");
      check.type = "button";
      check.className = `today-task-detail-subtask-check today-center-check${child.done ? " is-done" : ""}`;
      check.setAttribute("aria-label", child.done ? `取消完成 ${child.title}` : `完成 ${child.title}`);
      if (child.done) setIcon(check, "check");
      check.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await this.store.toggleTask(child.id);
        if (this.task) this.render();
      });

      const open = document.createElement("button");
      open.type = "button";
      open.className = "today-task-detail-subtask-open today-center-task-body";
      const title = document.createElement("span");
      title.className = `today-task-detail-subtask-title today-center-task-title priority-${child.priority || 0}`;
      title.textContent = child.title || "未命名任务";
      open.appendChild(title);
      open.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.setTask(child.id);
      });

      const meta = document.createElement("div");
      meta.className = "today-task-detail-subtask-meta today-center-task-side-meta";
      if (child.priority) {
        const flag = this.makeIcon("flag", `today-task-detail-subtask-priority priority-${child.priority}`);
        flag.title = child.priority === 1 ? "高优先级" : child.priority === 2 ? "中优先级" : "低优先级";
        meta.appendChild(flag);
      }
      if (child.dueDate) {
        const due = document.createElement("span");
        due.className = `today-task-detail-subtask-date${dayDiff(child.dueDate) < 0 && !child.done ? " is-overdue" : ""}`;
        due.textContent = compactTaskDateLabel(child);
        meta.appendChild(due);
      }

      handle.addEventListener("dragstart", (event) => {
        this.subtaskDragId = child.id;
        row.classList.add("is-subtask-dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", child.id);
        }
      });
      handle.addEventListener("dragend", () => {
        this.subtaskDragId = null;
        this.clearSubtaskDropStates(section);
      });
      row.addEventListener("dragover", (event) => {
        const draggedId = this.subtaskDragId || event.dataTransfer?.getData("text/plain");
        if (!draggedId || draggedId === child.id) return;
        const dragged = this.store.getTask(draggedId);
        if (dragged?.parentTaskId !== task.id) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        this.clearSubtaskDropStates(section);
        row.classList.add("is-subtask-drop-before");
      });
      row.addEventListener("dragleave", (event) => {
        if (row.contains(event.relatedTarget)) return;
        row.classList.remove("is-subtask-drop-before");
      });
      row.addEventListener("drop", async (event) => {
        const draggedId = this.subtaskDragId || event.dataTransfer?.getData("text/plain");
        if (!draggedId || draggedId === child.id) return;
        event.preventDefault();
        event.stopPropagation();
        this.subtaskDragId = null;
        this.clearSubtaskDropStates(section);
        await this.store.reorderSubtask(draggedId, child.id);
        if (this.task) this.render();
      });

      row.addEventListener("contextmenu", (event) => {
        this.plugin.openTaskContextMenu(event, child, { anchor: row });
      });
      row.append(handle, check, open, meta);
      list.appendChild(row);
    }

    const endDrop = document.createElement("div");
    endDrop.className = "today-task-detail-subtask-end-drop";
    endDrop.setAttribute("aria-hidden", "true");
    endDrop.addEventListener("dragover", (event) => {
      const draggedId = this.subtaskDragId || event.dataTransfer?.getData("text/plain");
      const dragged = this.store.getTask(draggedId);
      if (!draggedId || dragged?.parentTaskId !== task.id) return;
      event.preventDefault();
      this.clearSubtaskDropStates(section);
      endDrop.classList.add("is-subtask-drop-end");
    });
    endDrop.addEventListener("drop", async (event) => {
      const draggedId = this.subtaskDragId || event.dataTransfer?.getData("text/plain");
      const dragged = this.store.getTask(draggedId);
      if (!draggedId || dragged?.parentTaskId !== task.id) return;
      event.preventDefault();
      event.stopPropagation();
      this.subtaskDragId = null;
      this.clearSubtaskDropStates(section);
      await this.store.reorderSubtask(draggedId, null);
      if (this.task) this.render();
    });
    list.appendChild(endDrop);
    section.appendChild(list);

    if (this.subtaskComposerOpen) {
      // Pending child = the exact same task row shell as a saved child.
      // Only the title node changes from a text span to an editable input.
      const composer = document.createElement("div");
      composer.className = "today-task-detail-subtask today-center-task is-ticktick-row priority-0 today-task-detail-subtask-composer";

      const handle = document.createElement("span");
      handle.className = "today-task-detail-subtask-handle today-task-detail-subtask-handle-placeholder";
      handle.setAttribute("aria-hidden", "true");
      setIcon(handle, "grip-vertical");

      const ghostCheck = document.createElement("button");
      ghostCheck.type = "button";
      ghostCheck.className = "today-task-detail-subtask-check today-center-check today-task-detail-subtask-check-placeholder";
      ghostCheck.tabIndex = -1;
      ghostCheck.setAttribute("aria-hidden", "true");

      const body = document.createElement("div");
      body.className = "today-task-detail-subtask-open today-center-task-body";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "today-task-detail-subtask-title today-center-task-title today-task-detail-subtask-input";
      input.placeholder = "添加子任务";
      body.appendChild(input);

      const submit = async () => {
        const title = input.value.trim();
        if (!title) return;
        input.disabled = true;
        await this.store.addSubtask(task.id, { title });
        this.subtaskComposerOpen = true;
        this.refreshSubtasksSection({ focus: true });
      };
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.isComposing) {
          event.preventDefault();
          void submit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          this.subtaskComposerOpen = false;
          this.refreshSubtasksSection({ focus: false });
          this.editorEl?.focus?.({ preventScroll: true });
        }
      });

      const meta = document.createElement("div");
      meta.className = "today-task-detail-subtask-meta today-center-task-side-meta";
      const submitButton = document.createElement("button");
      submitButton.type = "button";
      submitButton.className = "today-task-detail-subtask-submit";
      submitButton.title = "创建子任务";
      submitButton.setAttribute("aria-label", "创建子任务");
      setIcon(submitButton, "plus");
      submitButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void submit();
      });
      meta.appendChild(submitButton);

      composer.append(handle, ghostCheck, body, meta);
      list.appendChild(composer);
    }

    if (!this.subtaskComposerOpen) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "today-task-detail-subtask-add";
      add.append(this.makeIcon("plus"), document.createTextNode("添加子任务"));
      add.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openSubtaskComposer();
      });
      section.appendChild(add);
    }
    container.appendChild(section);
  }

  render() {
    this.ensureUiOwner();
    this.disposeFunctionalUi({ includeFooter: true });
    const task = this.task;
    const el = this.contentEl;
    el.replaceChildren();
    el.classList.add("today-plugin-root", "today-task-detail");
    if (task?.id) el.dataset.todayDetailTaskId = task.id;
    else delete el.dataset.todayDetailTaskId;
    const taskContentFontSize = Math.max(12, Math.min(20, Number(this.plugin.data.settings?.taskContentFontSize) || 15));
    el.style.setProperty("--today-task-content-font-size", `${taskContentFontSize}px`);
    if (!task) {
      const missing = document.createElement("div");
      missing.className = "today-task-detail-missing";
      missing.textContent = "任务不存在";
      el.appendChild(missing);
      return;
    }

    const header = document.createElement("div");
    header.className = "today-task-detail-header";

    const complete = document.createElement("button");
    complete.type = "button";
    complete.className = `today-task-detail-complete${task.done ? " is-done" : ""}`;
    complete.title = task.done ? "取消完成" : "完成任务";
    if (task.done) setIcon(complete, "check");
    complete.addEventListener("click", async () => { await this.store.toggleTask(task.id); if (!this.isDockedDetail()) this.render(); });

    const date = document.createElement("button");
    date.type = "button";
    date.className = `today-task-detail-date${task.dueDate ? " has-date" : ""}`;
    const dateText = document.createElement("span");
    dateText.className = "today-task-detail-date-text";
    dateText.textContent = this.dateText(task);
    date.append(this.makeIcon("calendar-days"), dateText);
    date.addEventListener("click", (event) => this.showDateMenu(event));

    const priority = document.createElement("button");
    priority.type = "button";
    priority.className = `today-task-detail-priority priority-${task.priority || 0}`;
    priority.title = task.priority === 1 ? "高优先级" : task.priority === 2 ? "中优先级" : task.priority === 3 ? "低优先级" : "设置优先级";
    priority.setAttribute("aria-label", priority.title);
    priority.appendChild(this.makeIcon("flag"));
    priority.addEventListener("click", (event) => this.showPriorityMenu(event));

    header.append(complete, date, priority);
    if (this.isDockedDetail()) this.renderNavigation?.(header);
    el.appendChild(header);

    this.renderTaskBreadcrumb(el, task);

    const title = document.createElement("input");
    title.type = "text";
    title.className = "today-task-detail-title";
    title.value = task.title;
    title.placeholder = "任务标题";
    const titleHeading = document.createElement("h1");
    titleHeading.className = "today-task-detail-title-heading";
    titleHeading.setAttribute("aria-label", task.title);
    title.addEventListener("input", () => {
      task.title = title.value.replace(/\n+/g, " ");
      titleHeading.setAttribute("aria-label", task.title);
      task.updatedAt = Date.now();
      this.schedulePersist();
    });
    title.addEventListener("blur", () => {
      if (!task.title.trim()) { task.title = "未命名任务"; title.value = task.title; titleHeading.setAttribute("aria-label", task.title); }
      this.flushLocalChanges(true);
    });
    titleHeading.appendChild(title);
    el.appendChild(titleHeading);

    const contentWrap = document.createElement("div");
    contentWrap.className = "today-task-detail-content-wrap";
    this.contentWrapEl = contentWrap;
    this.renderVisualEditor(contentWrap, task);
    this.renderSubtasks(contentWrap, task);
    contentWrap.classList.toggle("has-subtasks", Boolean(contentWrap.querySelector(":scope > .today-task-detail-subtasks")));
    el.appendChild(contentWrap);

    const attachments = task.attachments || [];
    const relatedNotes = task.relatedNotePaths || [];
    if (attachments.length || relatedNotes.length || (task.relatedTaskIds || []).length || (task.tags || []).length) {
      const resources = document.createElement("div");
      resources.className = "today-task-detail-resources";
      for (const tag of task.tags || []) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "today-task-detail-chip is-tag";
        chip.textContent = `#${tag}`;
        chip.title = "点击移除标签";
        chip.addEventListener("click", () => this.patch({ tags: (task.tags || []).filter((item) => item !== tag) }));
        resources.appendChild(chip);
      }
      for (const path of attachments) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "today-task-detail-chip";
        chip.append(this.makeIcon("paperclip"), document.createTextNode(path));
        chip.title = "点击打开附件；右键移除引用";
        chip.addEventListener("click", () => {
          if (/^https?:\/\//i.test(path)) {
            window.open(path, "_blank", "noopener,noreferrer");
          } else {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file && file.extension) this.app.workspace.getLeaf(true).openFile(file);
            else this.app.workspace.openLinkText(path, "", false);
          }
        });
        chip.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          this.patch({ attachments: (this.task?.attachments || []).filter((item) => item !== path) });
        });
        resources.appendChild(chip);
      }
      for (const relatedId of task.relatedTaskIds || []) {
        const related = this.store.getTask(relatedId);
        if (!related) continue;
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "today-task-detail-chip";
        chip.append(this.makeIcon("git-branch"), document.createTextNode(related.title));
        chip.title = "点击打开关联任务；右键移除关联";
        chip.addEventListener("click", () => this.setTask(related.id));
        chip.addEventListener("contextmenu", (event) => { event.preventDefault(); this.patch({ relatedTaskIds: (task.relatedTaskIds || []).filter((id) => id !== related.id) }); });
        resources.appendChild(chip);
      }
      for (const path of relatedNotes) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "today-task-detail-chip";
        chip.append(this.makeIcon("file-text"), document.createTextNode(path));
        chip.title = "点击打开笔记；右键移除关联";
        chip.addEventListener("click", () => this.app.workspace.openLinkText(path, "", false));
        chip.addEventListener("contextmenu", (event) => { event.preventDefault(); this.patch({ relatedNotePaths: relatedNotes.filter((item) => item !== path) }); });
        resources.appendChild(chip);
      }
      el.appendChild(resources);
    }


    const footer = document.createElement("div");
    footer.className = "today-task-detail-footer";
    const containerBtn = document.createElement("button");
    containerBtn.type = "button";
    containerBtn.className = "today-task-detail-container";
    const list = this.store.getList(task.listId);
    const group = this.store.getGroup(task.listId, task.groupId);
    const containerLabel = group ? `${list?.name || "收集箱"} / ${group.name}` : (list?.name || "收集箱");
    containerBtn.title = `当前清单 / 分组：${containerLabel}`;
    containerBtn.setAttribute("aria-label", containerBtn.title);
    containerBtn.setAttribute("aria-haspopup", "menu");
    containerBtn.setAttribute("aria-expanded", "false");
    containerBtn.append(this.makeIcon("folder-open"), document.createTextNode(containerLabel));
    containerBtn.addEventListener("click", (event) => this.showContainerMenu(event));

    const footerActions = document.createElement("div");
    footerActions.className = "today-task-detail-footer-actions";
    const format = this.makeFooterToolButton("type", "格式工具", () => this.renderFormatToolbar(contentWrap), { preserveSelection: true, className: "is-format" });
    if (this.formatOpen) format.classList.add("is-active");
    this.formatButtonEl = format;
    const tag = this.makeFooterToolButton("tag", "标签", (event) => this.showTagMenu(event), { className: "is-tag" });
    this.tagButtonEl = tag;
    const more = this.makeFooterToolButton("ellipsis", "更多", (event) => this.showMoreMenu(event), { className: "is-more" });
    this.moreButtonEl = more;
    footerActions.append(format, tag, more);
    footer.append(containerBtn, footerActions);
    if (!this.mountDockedFooter(footer)) el.appendChild(footer);
  }
}


class TaskContextMenuController {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.store = plugin.store;
    this.menuEl = null;
    this.helper = null;
    this.cleanup = null;
    this.unsubscribe = null;
    this.taskId = null;
    this.childMenus = [];
  }

  close() {
    this.cleanup?.();
    this.cleanup = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.clearChildMenus(1);
    this.helper?.disposeFunctionalUi?.({ includeFooter: true });
    this.helper = null;
    this.menuEl?.remove();
    this.menuEl = null;
    this.taskId = null;
  }

  clearChildMenus(fromLevel = 1) {
    const keep = [];
    for (const entry of this.childMenus || []) {
      if (Number(entry.level || 1) >= fromLevel) {
        try { entry.cleanup?.(); } catch (_) {}
        if (entry.anchor) {
          entry.anchor.classList.remove('is-submenu-open');
          if (entry.anchor.hasAttribute('aria-expanded')) entry.anchor.setAttribute('aria-expanded', 'false');
        }
        entry.el?.remove?.();
      } else keep.push(entry);
    }
    this.childMenus = keep;
  }

  registerChildMenu(el, level = 1, cleanup = null, anchor = null) {
    if (!el) return el;
    el.classList.add('today-task-context-owned-child');
    el.dataset.todayTaskContextLevel = String(level);
    if (anchor) {
      anchor.classList.add('is-submenu-open');
      if (anchor.hasAttribute('aria-expanded')) anchor.setAttribute('aria-expanded', 'true');
    }
    this.childMenus.push({ el, level, cleanup, anchor });
    return el;
  }

  ownsTarget(target) {
    if (!target) return false;
    if (this.menuEl?.contains?.(target)) return true;
    if ((this.childMenus || []).some((entry) => entry.el?.contains?.(target))) return true;
    return !!this.helper?.ownsFunctionalTarget?.(target);
  }

  positionChildMenu(panel, anchor, level = 1) {
    if (!panel || !anchor?.getBoundingClientRect) return;
    this.plugin.floatingController?.place(panel, anchor, {
      placement: "right-start",
      gap: 7,
      padding: 10,
      crossOffset: -6,
      flip: true,
      shift: true,
    });
    panel.style.zIndex = String(10130 + Math.max(0, level - 1));
    requestAnimationFrame(() => panel.classList.add('is-open'));
  }

  makeContainerRow({ icon = 'list', label = '', checked = false, currentPath = false, submenu = false, muted = '' } = {}) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `today-task-detail-container-menu-row${checked ? ' is-active' : ''}${currentPath && !checked ? ' is-current-path' : ''}`;
    if (checked) row.setAttribute('aria-current', 'true');
    else if (currentPath) row.setAttribute('aria-current', 'location');
    if (submenu) {
      row.setAttribute('aria-haspopup', 'menu');
      row.setAttribute('aria-expanded', 'false');
    }
    const left = document.createElement('span');
    left.className = 'today-task-detail-container-menu-left';
    left.append(this.makeIcon(icon), document.createTextNode(label));
    row.appendChild(left);
    if (muted) {
      const meta = document.createElement('span');
      meta.className = 'today-task-detail-container-menu-meta';
      meta.textContent = muted;
      row.appendChild(meta);
    }
    if (checked) row.appendChild(this.makeIcon('check', 'today-task-detail-container-menu-check'));
    else if (submenu) row.appendChild(this.makeIcon('chevron-right', 'today-task-detail-container-menu-chevron'));
    return row;
  }

  makeCascadeHeader(icon, label) {
    const header = document.createElement('div');
    header.className = 'today-task-context-cascade-header';
    header.append(this.makeIcon(icon), document.createTextNode(label));
    return header;
  }

  bindSubmenuControl(control, action) {
    let suppressClickUntil = 0;
    // Leaf rows still participate in the cascade trail. The highlight is
    // immediate on hover; selection only happens on pointerdown/click.
    control.addEventListener('pointerenter', () => control.classList.add('is-cascade-hover'));
    control.addEventListener('pointerleave', () => control.classList.remove('is-cascade-hover'));
    control.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClickUntil = Date.now() + 600;
      void action(event, control);
    });
    control.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (Date.now() < suppressClickUntil) return;
      void action(event, control);
    });
  }

  bindHoverCascadeControl(control, { open = null, select = null, clearFromLevel = null, delay = 90 } = {}) {
    let hoverTimer = 0;
    let suppressClickUntil = 0;
    const cancelHover = () => {
      if (!hoverTimer) return;
      window.clearTimeout(hoverTimer);
      hoverTimer = 0;
    };
    const openSubmenu = () => {
      cancelHover();
      if (typeof clearFromLevel === 'number') this.clearChildMenus(clearFromLevel);
      if (typeof open === 'function') void open(control);
    };
    control.addEventListener('pointerenter', () => {
      cancelHover();
      // Highlight immediately so the user can visually trace the branch even
      // during the short submenu-open delay. Once the submenu is open, the
      // anchor keeps its gray background via `is-submenu-open`.
      control.classList.add('is-cascade-hover');
      if (typeof open !== 'function' && typeof clearFromLevel !== 'number') return;
      hoverTimer = window.setTimeout(() => {
        hoverTimer = 0;
        if (!control.isConnected) return;
        openSubmenu();
      }, Math.max(0, Number(delay) || 0));
    });
    control.addEventListener('pointerleave', () => {
      cancelHover();
      control.classList.remove('is-cascade-hover');
    });
    control.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      cancelHover();
      suppressClickUntil = Date.now() + 600;
      // A folder is navigation-only, while a list is a valid destination even
      // when it also owns groups. In the latter case, click moves to the list
      // root (ungrouped) and hover previews the group's submenu.
      if (typeof select === 'function') void select(event, control);
      else openSubmenu();
    });
    control.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (Date.now() < suppressClickUntil) return;
      if (typeof select === 'function') void select(event, control);
      else openSubmenu();
    });
  }

  openMoveGroupMenu(list, anchorRow) {
    if (!list) return;
    this.clearChildMenus(3);
    const task = this.store.getTask(this.taskId);
    if (!task) return;
    const panel = document.createElement('div');
    panel.className = 'today-task-detail-container-menu today-task-detail-container-group-menu';
    panel.dataset.menuLevel = '3';
    panel.appendChild(this.makeCascadeHeader('list', list.name));
    const ungrouped = this.makeContainerRow({ icon: 'minus', label: '未分组', checked: task.listId === list.id && !task.groupId });
    this.bindSubmenuControl(ungrouped, () => this.commitContainerMove(task.id, list.id, null));
    panel.appendChild(ungrouped);
    for (const group of this.store.getGroups(list.id)) {
      const row = this.makeContainerRow({ icon: 'rows-3', label: group.name, checked: task.listId === list.id && task.groupId === group.id });
      this.bindSubmenuControl(row, () => this.commitContainerMove(task.id, list.id, group.id));
      panel.appendChild(row);
    }
    document.body.appendChild(panel);
    this.registerChildMenu(panel, 3, null, anchorRow);
    this.positionChildMenu(panel, anchorRow, 3);
  }

  openMoveListMenu(folder, anchorRow) {
    this.clearChildMenus(2);
    const task = this.store.getTask(this.taskId);
    if (!task || !folder) return;
    const panel = document.createElement('div');
    panel.className = 'today-task-detail-container-menu today-task-detail-container-list-menu';
    panel.dataset.menuLevel = '2';
    panel.appendChild(this.makeCascadeHeader('folder-open', folder.name));
    const lists = this.store.data.lists.filter((list) => !list.system && list.folderId === folder.id);
    if (!lists.length) {
      const empty = document.createElement('div');
      empty.className = 'today-task-detail-container-menu-empty';
      empty.textContent = '暂无清单';
      panel.appendChild(empty);
    }
    for (const list of lists) {
      const groups = this.store.getGroups(list.id);
      const isCurrentList = task.listId === list.id;
      const row = this.makeContainerRow({
        icon: 'list',
        label: list.name,
        checked: isCurrentList && groups.length === 0,
        currentPath: isCurrentList && groups.length > 0,
        submenu: groups.length > 0
      });
      if (groups.length) {
        this.bindHoverCascadeControl(row, {
          open: () => this.openMoveGroupMenu(list, row),
          select: () => this.commitContainerMove(task.id, list.id, null),
          delay: 90,
        });
      } else {
        this.bindHoverCascadeControl(row, {
          clearFromLevel: 3,
          select: () => this.commitContainerMove(task.id, list.id, null),
          delay: 70,
        });
      }
      panel.appendChild(row);
    }
    document.body.appendChild(panel);
    this.registerChildMenu(panel, 2, null, anchorRow);
    this.positionChildMenu(panel, anchorRow, 2);
  }

  openMoveMenu(anchorRow) {
    this.clearChildMenus(1);
    const task = this.store.getTask(this.taskId);
    if (!task) return;
    // Resolve the task's current list/folder inside this method. 0.18.30
    // introduced path highlighting but accidentally referenced currentFolderId
    // without defining it here, which aborted submenu construction as soon as
    // the first folder row was rendered. Use an exact list lookup (no fallback)
    // so the highlight reflects the task's real container.
    const currentList = this.store.data.lists.find((list) => list.id === task.listId) || null;
    const currentFolderId = currentList?.folderId || null;
    const panel = document.createElement('div');
    panel.className = 'today-task-detail-container-menu today-task-detail-container-root-menu';
    panel.dataset.menuLevel = '1';

    const inbox = this.store.data.lists.find((list) => list.id === 'inbox') || this.store.data.lists.find((list) => list.system);
    if (inbox) {
      const row = this.makeContainerRow({ icon: 'inbox', label: inbox.name, checked: task.listId === inbox.id });
      this.bindHoverCascadeControl(row, {
        clearFromLevel: 2,
        select: () => this.commitContainerMove(task.id, inbox.id, null),
        delay: 70,
      });
      panel.appendChild(row);
    }
    const folders = [...this.store.data.folders].sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(a.order || 0) - Number(b.order || 0));
    for (const folder of folders) {
      const lists = this.store.data.lists.filter((list) => !list.system && list.folderId === folder.id);
      if (!lists.length) continue;
      const row = this.makeContainerRow({ icon: 'folder-open', label: folder.name, currentPath: currentFolderId === folder.id, submenu: true });
      this.bindHoverCascadeControl(row, {
        open: () => this.openMoveListMenu(folder, row),
        delay: 90,
      });
      panel.appendChild(row);
    }
    for (const list of this.store.data.lists.filter((item) => !item.system && !this.store.getFolder(item.folderId))) {
      const groups = this.store.getGroups(list.id);
      const isCurrentList = task.listId === list.id;
      const row = this.makeContainerRow({
        icon: 'list',
        label: list.name,
        checked: isCurrentList && groups.length === 0,
        currentPath: isCurrentList && groups.length > 0,
        submenu: groups.length > 0
      });
      if (groups.length) {
        this.bindHoverCascadeControl(row, {
          open: () => this.openMoveGroupMenu(list, row),
          select: () => this.commitContainerMove(task.id, list.id, null),
          delay: 90,
        });
      } else {
        this.bindHoverCascadeControl(row, {
          clearFromLevel: 3,
          select: () => this.commitContainerMove(task.id, list.id, null),
          delay: 70,
        });
      }
      panel.appendChild(row);
    }
    document.body.appendChild(panel);
    this.registerChildMenu(panel, 1, null, anchorRow);
    this.positionChildMenu(panel, anchorRow, 1);
  }

  openTagSubmenu(anchorRow) {
    this.clearChildMenus(1);
    const task = this.store.getTask(this.taskId);
    if (!task) return;
    const panel = document.createElement('div');
    panel.className = 'today-task-detail-tag-popover today-task-detail-footer-popover';
    const inputWrap = document.createElement('div');
    inputWrap.className = 'today-task-detail-footer-search';
    inputWrap.appendChild(this.makeIcon('search'));
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = '输入标签';
    inputWrap.appendChild(input);
    const rows = document.createElement('div');
    rows.className = 'today-task-detail-footer-menu-rows';
    const actions = document.createElement('div');
    actions.className = 'today-task-detail-footer-pop-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '取消';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'is-primary';
    confirm.textContent = '确定';
    let working = new Set(task.tags || []);
    const allTags = this.store.getAllTags();
    const draw = () => {
      rows.replaceChildren();
      const q = input.value.trim().replace(/^#+/, '').toLowerCase();
      const visible = allTags.filter((tag) => !q || tag.toLowerCase().includes(q));
      for (const tag of visible) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `today-task-detail-footer-menu-row${working.has(tag) ? ' is-active' : ''}`;
        row.append(this.makeIcon('tag'), document.createTextNode(tag));
        if (working.has(tag)) row.appendChild(this.makeIcon('check', 'today-task-detail-footer-menu-check'));
        this.bindSubmenuControl(row, () => {
          working.has(tag) ? working.delete(tag) : working.add(tag);
          draw();
        });
        rows.appendChild(row);
      }
      if (!visible.length && !q) {
        const empty = document.createElement('div');
        empty.className = 'today-task-detail-footer-menu-empty';
        empty.textContent = '暂无标签';
        rows.appendChild(empty);
      }
    };
    input.addEventListener('input', draw);
    this.bindSubmenuControl(cancel, () => this.clearChildMenus(1));
    this.bindSubmenuControl(confirm, () => {
      const typed = input.value.trim().replace(/^#+/, '');
      if (typed) working.add(typed);
      return this.commitPatch(task.id, { tags: [...working] }, '已修改标签');
    });
    actions.append(cancel, confirm);
    panel.append(inputWrap, rows, actions);
    draw();
    document.body.appendChild(panel);
    this.registerChildMenu(panel, 1);
    this.positionChildMenu(panel, anchorRow, 1);
    requestAnimationFrame(() => input.focus({ preventScroll: true }));
  }

  makeIcon(name, className = '') {
    const span = document.createElement('span');
    if (className) span.className = className;
    setIcon(span, name);
    return span;
  }

  makeHelper(taskId) {
    const helper = new TaskDetailModal(this.app, this.plugin, taskId, null);
    // Context menus borrow TaskDetail's proven date/priority/container/tag
    // popovers, but do not need a second hidden task document render tree.
    // Important: persistence is owned by the context-menu controller.  The
    // old implementation let TaskDetail patch/move methods race with the
    // context-menu teardown, which could dismiss the UI before the action was
    // reliably committed.  Route every borrowed picker back through the same
    // commit path used by the quick actions below.
    helper.render = () => {};
    helper.close = () => this.close();
    helper.patch = async (patch) => {
      const keys = Object.keys(patch || {});
      let undoLabel = '';
      if (keys.some((key) => ['startDate', 'dueDate', 'dueTime', 'endTime', 'repeat'].includes(key))) undoLabel = '已修改日期';
      else if (keys.length === 1 && keys[0] === 'priority') undoLabel = '已修改优先级';
      else if (keys.length === 1 && keys[0] === 'tags') undoLabel = '已修改标签';
      return this.commitPatch(taskId, patch, undoLabel);
    };
    helper.moveTaskToContainer = async (listId, groupId = null) => {
      return this.commitContainerMove(taskId, listId, groupId);
    };

    // The borrowed TaskDetail pickers are portalled independently from the
    // context menu. Keep TaskDetail's owner/lifecycle machinery, but mark every
    // borrowed portal as a child of this context menu so it renders above the
    // root menu and is still treated as part of the same interaction tree.
    const appendDetailPortal = helper.appendDetailPortal.bind(helper);
    helper.appendDetailPortal = (node, role = 'popover') => {
      const mounted = appendDetailPortal(node, role);
      if (mounted) {
        mounted.classList?.add?.('today-task-context-child-popover');
        mounted.dataset.todayTaskContextTask = taskId;
      }
      return mounted;
    };
    return helper;
  }

  async commitPatch(taskId, patch, undoLabel = '') {
    const task = this.store.getTask(taskId);
    if (!task) {
      this.close();
      return false;
    }
    try {
      await this.store.updateTask(taskId, patch, { undoLabel });
      this.close();
      return true;
    } catch (error) {
      console.error('[Today] Context-menu task update failed', error);
      this.plugin.undoController?.showError?.('任务修改失败');
      this.close();
      return false;
    }
  }

  async commitToggle(taskId) {
    if (!this.store.getTask(taskId)) {
      this.close();
      return false;
    }
    try {
      await this.store.toggleTask(taskId);
      this.close();
      return true;
    } catch (error) {
      console.error('[Today] Context-menu toggle failed', error);
      this.plugin.undoController?.showError?.('任务状态修改失败');
      this.close();
      return false;
    }
  }

  async commitContainerMove(taskId, listId, groupId = null) {
    const task = this.store.getTask(taskId);
    const list = this.store.data.lists.find((item) => item.id === listId);
    if (!task || !list) {
      this.close();
      return false;
    }
    try {
      await this.store.updateTaskContainer(taskId, list.id, groupId);
      this.close();
      return true;
    } catch (error) {
      console.error('[Today] Context-menu move failed', error);
      this.plugin.undoController?.showError?.('移动任务失败');
      this.close();
      return false;
    }
  }

  async commitDelete(taskId) {
    if (!this.store.getTask(taskId)) {
      this.close();
      return false;
    }
    try {
      await this.store.deleteTask(taskId);
      this.close();
      return true;
    } catch (error) {
      console.error('[Today] Context-menu delete failed', error);
      this.plugin.undoController?.showError?.('删除任务失败');
      this.close();
      return false;
    }
  }

  bindActionControl(control, action) {
    // Desktop Obsidian has several capture-phase pointerdown dismiss handlers
    // (task details, popovers, composers, etc.). A context-menu action bound
    // only to `click` can therefore lose its DOM node before the click event is
    // dispatched. Commit mouse actions at pointerdown, exactly like the proven
    // container/group cascading menu. Keep click only as keyboard activation.
    let suppressClickUntil = 0;
    control.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClickUntil = Date.now() + 600;
      void action(event, control);
    });
    control.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (Date.now() < suppressClickUntil) return;
      void action(event, control);
    });
  }

  makeQuickButton(icon, label, onClick, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `today-task-context-quick ${className}`.trim();
    button.title = label;
    button.setAttribute('aria-label', label);
    setIcon(button, icon);
    this.bindActionControl(button, onClick);
    return button;
  }

  makeRow(icon, label, onClick, { danger = false, submenu = false, checked = false } = {}) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `today-task-context-row${danger ? ' is-danger' : ''}${checked ? ' is-checked' : ''}`;
    const left = document.createElement('span');
    left.className = 'today-task-context-row-left';
    left.append(this.makeIcon(icon), document.createTextNode(label));
    row.appendChild(left);
    if (checked) row.appendChild(this.makeIcon('check', 'today-task-context-row-trailing'));
    else if (submenu) row.appendChild(this.makeIcon('chevron-right', 'today-task-context-row-trailing'));
    this.bindActionControl(row, onClick);
    return row;
  }

  position(menu, event, anchor = null) {
    const pad = 10;
    const gap = 4;
    const rect = menu.getBoundingClientRect();
    const anchorRect = anchor?.getBoundingClientRect?.();
    let left = Number.isFinite(event?.clientX) ? event.clientX : (anchorRect?.left || pad);
    let top = Number.isFinite(event?.clientY) ? event.clientY : (anchorRect?.bottom || pad) + gap;
    if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - rect.width - pad;
    if (top + rect.height > window.innerHeight - pad) top = window.innerHeight - rect.height - pad;
    left = Math.max(pad, left);
    top = Math.max(pad, top);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  async setQuickDate(task, offset) {
    const liveTask = this.store.getTask(task.id);
    if (!liveTask) return this.close();
    const dueDate = addDays(todayISO(), offset);
    await this.commitPatch(task.id, {
      startDate: '',
      dueDate,
      dueTime: liveTask.dueTime || '23:59',
      endTime: liveTask.endTime || '',
    }, '已修改日期');
  }

  async clearDate(task) {
    await this.commitPatch(task.id, {
      startDate: '',
      dueDate: '',
      dueTime: '',
      endTime: '',
      repeat: null,
    }, '已修改日期');
  }

  open(event, taskOrId, { anchor = null, extraActions = [] } = {}) {
    const task = typeof taskOrId === 'string' ? this.store.getTask(taskOrId) : taskOrId;
    if (!task) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    this.close();
    this.taskId = task.id;
    this.helper = this.makeHelper(task.id);

    const menu = document.createElement('div');
    menu.className = 'today-plugin-root today-task-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', `编辑任务 ${task.title || ''}`);

    const dateBlock = document.createElement('section');
    dateBlock.className = 'today-task-context-block';
    const dateLabelEl = document.createElement('div');
    dateLabelEl.className = 'today-task-context-label';
    dateLabelEl.textContent = '日期';
    const dateQuick = document.createElement('div');
    dateQuick.className = 'today-task-context-quickbar';
    dateQuick.append(
      this.makeQuickButton('sun', '今天', () => this.setQuickDate(task, 0), task.dueDate === todayISO() ? 'is-active' : ''),
      this.makeQuickButton('sunrise', '明天', () => this.setQuickDate(task, 1), task.dueDate === addDays(todayISO(), 1) ? 'is-active' : ''),
      this.makeQuickButton('calendar-plus', '下周', () => this.setQuickDate(task, 7), task.dueDate === addDays(todayISO(), 7) ? 'is-active' : ''),
      this.makeQuickButton('calendar-days', '选择日期', (ev, button) => this.helper?.showDateMenu({ currentTarget: button, preventDefault() {}, stopPropagation() {} })),
      this.makeQuickButton('calendar-x', '无日期', () => this.clearDate(task), !task.dueDate ? 'is-active' : '')
    );
    dateBlock.append(dateLabelEl, dateQuick);

    const priorityBlock = document.createElement('section');
    priorityBlock.className = 'today-task-context-block';
    const priorityLabelEl = document.createElement('div');
    priorityLabelEl.className = 'today-task-context-label';
    priorityLabelEl.textContent = '优先级';
    const priorityQuick = document.createElement('div');
    priorityQuick.className = 'today-task-context-quickbar is-priority';
    const priorityDefs = [
      [1, '高优先级', 'is-high'],
      [2, '中优先级', 'is-medium'],
      [3, '低优先级', 'is-low'],
      [0, '无优先级', 'is-none'],
    ];
    for (const [value, label, cls] of priorityDefs) {
      const button = this.makeQuickButton('flag', label, async () => {
        await this.commitPatch(task.id, { priority: value }, '已修改优先级');
      }, `today-task-context-priority ${cls}${Number(task.priority || 0) === value ? ' is-active' : ''}`);
      priorityQuick.appendChild(button);
    }
    priorityBlock.append(priorityLabelEl, priorityQuick);
    menu.append(dateBlock, priorityBlock);

    const divider = () => {
      const el = document.createElement('div');
      el.className = 'today-task-context-divider';
      menu.appendChild(el);
    };
    divider();

    menu.appendChild(this.makeRow('square-pen', '打开任务', () => {
      const source = anchor || event?.currentTarget || event?.target;
      this.close();
      this.plugin.openTaskDetail(task.id, source);
    }));
    menu.appendChild(this.makeRow(task.done ? 'circle' : 'circle-check', task.done ? '取消完成' : '完成任务', async () => {
      await this.commitToggle(task.id);
    }));
    const moveRow = this.makeRow('folder-input', '移动到', () => {}, { submenu: true });
    // makeRow() binds a generic action handler. Replace its mouse path with a
    // hover-driven cascade by cloning the node, keeping the same visual markup.
    const hoverMoveRow = moveRow.cloneNode(true);
    this.bindHoverCascadeControl(hoverMoveRow, {
      open: () => this.openMoveMenu(hoverMoveRow),
      delay: 90,
    });
    menu.appendChild(hoverMoveRow);

    if (Array.isArray(extraActions) && extraActions.length) {
      divider();
      for (const action of extraActions) {
        if (!action?.label || typeof action.onClick !== 'function') continue;
        menu.appendChild(this.makeRow(action.icon || 'circle', action.label, async () => {
          this.close();
          await action.onClick();
        }, { danger: !!action.danger, checked: !!action.checked, submenu: !!action.submenu }));
      }
    }

    divider();
    menu.appendChild(this.makeRow('trash-2', '删除任务', async () => {
      await this.commitDelete(task.id);
    }, { danger: true }));

    document.body.appendChild(menu);
    this.menuEl = menu;
    this.position(menu, event, anchor);
    requestAnimationFrame(() => menu.classList.add('is-open'));

    const owned = (target) => this.ownsTarget(target);
    const onPointerDown = (pointerEvent) => {
      if (owned(pointerEvent.target)) return;
      this.close();
    };
    const onContextMenu = (contextEvent) => {
      if (owned(contextEvent.target)) return;
      this.close();
    };
    const onKeyDown = (keyEvent) => {
      if (keyEvent.key !== 'Escape') return;
      keyEvent.preventDefault();
      this.close();
    };
    const onBlur = () => this.close();
    const onResize = () => this.close();
    setTimeout(() => {
      if (this.menuEl !== menu || !menu.isConnected) return;
      document.addEventListener('pointerdown', onPointerDown, true);
      document.addEventListener('contextmenu', onContextMenu, true);
      document.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('blur', onBlur, true);
      window.addEventListener('resize', onResize, true);
    }, 0);
    this.cleanup = () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('contextmenu', onContextMenu, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', onBlur, true);
      window.removeEventListener('resize', onResize, true);
    };
    // Action handlers own teardown explicitly and only close after the model
    // mutation has been committed.  Do not subscribe this transient menu to
    // store.changed(): doing so can tear down borrowed pickers in the middle of
    // their own selection callback.
    this.unsubscribe = null;
  }
}


class TaskCenterView extends ItemView {
  constructor(leaf, plugin, initialTab = "lists") {
    super(leaf);
    this.plugin = plugin;
    this.store = plugin.store;
    this.tab = initialTab;
    this.unsubscribe = null;
    this.selectedListId = "smart-today";
    this.selectedTaskId = null;
    this.completedListId = "";
    this.completedPeriod = "all";
    this.pendingTaskFocusId = null;
    this.lastTaskClickId = null;
    this.lastTaskClickAt = 0;
    this.inlineTaskDetail = null;
    this.dockedSelectionRevision = 0;
    this.dockedSelectionSave = Promise.resolve();
    this.quickTaskPropertyHelper = null;
    this.selectedTag = "";
    this.calendarDayPopoverEl = null;
    this.calendarDayPopoverCleanup = null;
    this.calendarDayPopoverDate = "";
    const now = new Date();
    this.calendarYear = now.getFullYear();
    this.calendarMonth = now.getMonth();
    this.statsRange = "30";
    this.query = "";
    this.timelineScale = "day";
    this.timelineAnchorDate = todayISO();
    this.timelineDragTaskId = null;
    this.timelineQuickCreateEl = null;
    this.timelineQuickCreateCleanup = null;
    this.planningEditorEl = null;
    this.planningEditorOutsideHandler = null;
    this.collapsedFolders = new Set();
    // Smart-list section folding (e.g. 已过期 / 今天 / 已完成).
    // Kept in the modal session so rerenders preserve the user's fold state.
    this.collapsedSections = new Set();
    // Parent rows can reveal their direct children without turning the main list
    // into a heavy tree. Child previews are navigation rows and intentionally do
    // not participate in the top-level drag/drop ordering surface.
    this.expandedSubtaskParents = new Set();
    // TickTick-style smart list view options. Keep these modal-scoped for now so
    // experimenting with grouping/sorting does not mutate task data.
    this.listViewOptions = {
      // Smart/aggregate views default to time, while a concrete custom list
      // defaults to its persistent internal groups. Keep the two choices
      // separate so switching between Today and a project list does not
      // silently change the user's grouping model.
      group: "time",
      customGroup: "group",
      folderGroup: "list",
      sort: "time",
      order: "asc",
    };
    this.viewOptionsMenuEl = null;
    this.viewOptionsSubmenuEl = null;
    this.viewOptionsAnchor = null;
    this.viewOptionsKeyboardCleanup = null;
    this.viewOptionsOutsideHandler = null;
    this.displayMenuEl = null;
    this.displayMenuAnchor = null;
    this.displayMenuKeyboardCleanup = null;
    this.displayMenuOutsideHandler = null;
    // Inline Task Center capture state.  The center now reuses the same
    // date / priority / list / tag / attachment workflow as the sidebar
    // instead of falling back to await this.app.todayPrompt().
    this.centerComposerDraft = null;
    this.centerComposerContext = null;
    this.centerComposerFocusPending = false;
    this.centerComposerHost = null;
    this.centerComposerOutsideHandler = null;
    this.columnResizeCleanup = null;
    this.refreshCenterColumns = null;
    this.loadingTimer = null;
    this.loadingOverlayEl = null;
    this.loadingToken = null;
    // P1.4 drag-and-drop state. Native desktop drag events are used as the
    // transport layer; placement/semantics remain owned by the Task Center.
    this.taskDragState = null;
    this.taskDropIndicatorEl = null;
    this.taskDragAutoScrollFrame = 0;
    this.taskDragLeaveTimer = 0;
    this.taskDropKeySeed = 0;
    this.suppressTaskClickUntil = 0;
  }

  getViewType() {
    return CENTER_VIEW;
  }

  getDisplayText() {
    return "Today";
  }

  getIcon() {
    return "list-checks";
  }

  onOpen() {
    this.isOpen = true;
    this.modalEl = this.contentEl;
    this.contentEl.classList.add("today-plugin-root", "today-plugin-center", "today-center-workspace");
    this.applyAppearanceSettings();
    this.unsubscribe = this.store.subscribe(() => this.render());
    this.render();
  }

  applyAppearanceSettings() {
    const settings = this.plugin.data.settings || {};
    const scale = Math.max(0.9, Math.min(1.5, Number(settings.centerScale) || 1.30));
    const width = Math.max(900, Math.min(1800, Number(settings.centerWidth) || 1480));
    const height = Math.max(620, Math.min(1100, Number(settings.centerHeight) || 920));
    this.modalEl.style.setProperty("--today-center-modal-width", `${width}px`);
    this.modalEl.style.setProperty("--today-center-modal-height", `${height}px`);

    // CSS zoom behaves inconsistently inside Obsidian's modal flex layout and can
    // make the enlarged area appear as an empty strip. Scale our own shell with a
    // transform instead; the inverse logical size makes the transformed shell fill
    // the modal exactly in both directions.
    this.contentEl.style.removeProperty("zoom");
    this.contentEl.style.removeProperty("width");
    this.contentEl.style.removeProperty("height");
    const shell = this.contentEl.querySelector(".today-center-shell");
    if (shell && this.contentEl.classList.contains("today-center-workspace")) {
      shell.style.removeProperty("transform");
      shell.style.removeProperty("transform-origin");
      shell.style.removeProperty("width");
      shell.style.removeProperty("height");
      shell.style.zoom = String(scale);
    } else if (shell) {
      shell.style.removeProperty("zoom");
      shell.style.transformOrigin = "top left";
      shell.style.transform = `scale(${scale})`;
      shell.style.width = `${100 / scale}%`;
      shell.style.height = `${100 / scale}%`;
    }
  }

  onClose() {
    this.plugin.taskContextMenuController?.close();
    this.closeQuickTaskPropertyHelper();
    this.stopDelayedLoading();
    this.columnResizeCleanup?.();
    this.closeViewOptionsMenu();
    this.closeDisplayMenu();
    this.detachCenterComposerOutsideHandler();
    this.closeCenterComposerPopover();
    this.closeTimelineQuickCreate();
    this.closePlanningEditor();
    this.closeCalendarDayPopover();
    this.cleanupTaskDragVisuals();
    this.dockedSelectionRevision++;
    this.plugin.motionController?.cancelDockedDetailTransition(this.getDockedDetailPane());
    this.inlineTaskDetail?.disposeFunctionalUi?.({ includeFooter: true });
    void this.inlineTaskDetail?.flushLocalChanges?.(false);
    this.isOpen = false;
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
    this.contentEl.replaceChildren();
    if (this.plugin.centerModal === this) this.plugin.centerModal = null;
  }

  closeSpatialTaskDetail() {
    const modal = this.plugin.taskDetailModal;
    if (!modal) return;
    modal.close();
  }

  async setTab(tab) {
    if (tab !== this.tab) {
      const currentView = this.contentEl?.querySelector?.(".today-center-main, .today-center-tag-view, .today-center-calendar, .today-center-stats");
      await this.plugin.motionController?.exitView(currentView);
      this.plugin.motionController?.markViewSwitch(`tab:${tab}`);
      this.cancelCenterComposer({ rerender: false });
      this.inlineTaskDetail?.disposeFunctionalUi?.({ includeFooter: true });
      this.closeSpatialTaskDetail();
    }
    this.tab = tab;
    if (tab !== "lists") this.selectedTaskId = null;
    if (this.isOpen) this.render();
  }

  getDockedDetailPane() {
    if (this.tab !== "lists") return null;
    return this.contentEl?.querySelector?.(".today-center-list-view.has-detail > .today-center-detail-pane") || null;
  }

  syncDockedTaskSelection(taskId, { focus = false, keepFocusOn = null } = {}) {
    const main = this.contentEl?.querySelector?.(".today-center-list-view.has-detail > .today-center-main");
    if (!main) return;
    let focusTarget = null;
    let fallbackTabStop = null;
    for (const row of main.querySelectorAll("[data-today-task-id]")) {
      const selected = !!taskId && row.dataset.todayTaskId === taskId;
      const restore = !!keepFocusOn && row.dataset.todayTaskId === keepFocusOn;
      row.classList.toggle("is-selected", selected);
      row.setAttribute("aria-selected", selected ? "true" : "false");
      row.tabIndex = selected || (!taskId && restore) ? 0 : -1;
      if (selected || restore) focusTarget = row;
      if (!fallbackTabStop) fallbackTabStop = row;
    }
    // An empty selection still needs a roving tab stop for keyboard users.
    if (!taskId && !focusTarget && fallbackTabStop) fallbackTabStop.tabIndex = 0;
    if (focus && focusTarget) {
      focusTarget.focus?.({ preventScroll: true });
      focusTarget.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
  }

  async switchDockedTaskContent(taskId, pane, revision) {
    try {
      // Serialize pending disk writes across rapid A→B→C selections. Only
      // the latest revision may mount content, but every previous save must
      // settle first so writes cannot complete in reverse order.
      const detail = this.inlineTaskDetail;
      const saving = this.dockedSelectionSave.then(() => detail?.flushLocalChanges?.(false));
      this.dockedSelectionSave = saving;
      await saving;
    } catch (error) {
      console.error("[Today] Could not save the previous task before switching", error);
      // A rejected write must not poison the next attempted save.
      if (this.dockedSelectionSave) this.dockedSelectionSave = this.dockedSelectionSave.catch(() => {});
      if (revision === this.dockedSelectionRevision) {
        // flushLocalChanges cleared its dirty flag before the rejected write.
        // Keep the same mounted editor and its contents intact for retry.
        if (this.inlineTaskDetail) this.inlineTaskDetail.hasLocalChanges = true;
        this.selectedTaskId = this.inlineTaskDetail?.taskId || null;
        this.syncDockedTaskSelection(this.selectedTaskId);
        new Notice("当前任务保存失败，未切换任务；请重试");
      }
      return;
    }
    if (revision !== this.dockedSelectionRevision || !this.isOpen ||
        this.selectedTaskId !== taskId || !pane.isConnected ||
        this.getDockedDetailPane() !== pane) return;
    this.plugin.motionController?.cancelDockedDetailTransition(pane);
    this.inlineTaskDetail?.disposeFunctionalUi?.({ includeFooter: true });
    this.renderDockedTaskDetail(pane);
    this.plugin.motionController?.animateDockedDetailContent(pane);
  }

  selectCenterTask(taskId, { focus = false } = {}) {
    if (!this.store.getTask(taskId)) return;
    const pane = this.getDockedDetailPane();
    const main = this.contentEl?.querySelector?.(".today-center-list-view.has-detail > .today-center-main");
    // Offscreen linked tasks and non-list layouts still use the existing full
    // render path, which validates tree visibility and view-specific behavior.
    const visible = !!main && [...main.querySelectorAll("[data-today-task-id]")]
      .some((row) => row.dataset.todayTaskId === taskId);
    if (!pane || !visible) {
      if (this.selectedTaskId !== taskId) {
        this.inlineTaskDetail?.disposeFunctionalUi?.({ includeFooter: true });
        this.plugin.motionController?.markDetailSwitch(taskId, "docked");
        this.plugin.motionController?.markTaskChange(taskId, "select");
      }
      this.selectedTaskId = taskId;
      if (focus) this.pendingTaskFocusId = taskId;
      if (this.isOpen) this.render();
      return;
    }
    if (this.selectedTaskId === taskId) {
      // Repeated clicks must not recreate the contenteditable element, caret,
      // or selection. The existing double-click handler remains unchanged.
      if (focus) this.syncDockedTaskSelection(taskId, { focus: true });
      return;
    }
    this.selectedTaskId = taskId;
    this.syncDockedTaskSelection(taskId, { focus });
    const revision = ++this.dockedSelectionRevision;
    void this.switchDockedTaskContent(taskId, pane, revision);
  }

  clearCenterTask({ keepFocusOn = null } = {}) {
    this.lastTaskClickId = null;
    this.lastTaskClickAt = 0;
    const pane = this.getDockedDetailPane();
    if (pane) {
      this.selectedTaskId = null;
      this.syncDockedTaskSelection(null, { focus: !!keepFocusOn, keepFocusOn });
      const revision = ++this.dockedSelectionRevision;
      void this.switchDockedTaskContent(null, pane, revision);
      return;
    }
    this.inlineTaskDetail?.disposeFunctionalUi?.({ includeFooter: true });
    void this.inlineTaskDetail?.flushLocalChanges?.(false);
    this.selectedTaskId = null;
    if (keepFocusOn) this.pendingTaskFocusId = keepFocusOn;
    if (this.isOpen) this.render();
  }

  visibleTaskIds(main = this.contentEl?.querySelector(".today-center-main")) {
    if (!main) return this.detailTaskIds || [];
    return [...new Set([...main.querySelectorAll("[data-today-task-id]")]
      .filter((row) => main.isConnected ? row.offsetParent !== null : !row.hidden && row.style.display !== "none")
      .map((row) => row.dataset.todayTaskId))];
  }

  renderDetailNavigation(header, taskId) {
    const ids = this.visibleTaskIds();
    const index = ids.indexOf(taskId);
    const controls = document.createElement("div");
    controls.className = "today-detail-navigation";
    controls.setAttribute("role", "group");
    controls.setAttribute("aria-label", "切换任务");
    for (const [offset, icon, label] of [[-1, "chevron-up", "上一条任务"], [1, "chevron-down", "下一条任务"]]) {
      const button = this.makeTaskHoverAction(icon, label, () => {
        const current = this.visibleTaskIds();
        const target = current[current.indexOf(this.selectedTaskId) + offset];
        if (target) {
          this.lastTaskClickId = null;
          this.lastTaskClickAt = 0;
          this.selectCenterTask(target);
        }
      });
      button.disabled = index < 0 || !ids[index + offset];
      button.dataset.taskOffset = String(offset);
      controls.appendChild(button);
    }
    controls.appendChild(this.makeTaskHoverAction("x", "关闭任务详情", () => this.clearCenterTask({ keepFocusOn: taskId })));
    header.appendChild(controls);
  }

  syncDetailNavigation() {
    const ids = this.visibleTaskIds();
    const index = ids.indexOf(this.selectedTaskId);
    this.getDockedDetailPane()?.querySelectorAll("[data-task-offset]").forEach((button) => {
      button.disabled = index < 0 || !ids[index + Number(button.dataset.taskOffset)];
    });
  }

  restorePendingTaskFocus(root) {
    const taskId = this.pendingTaskFocusId;
    if (!taskId || !root) return;
    this.pendingTaskFocusId = null;
    requestAnimationFrame(() => {
      const target = [...root.querySelectorAll("[data-today-task-id]")].find((el) => el.dataset.todayTaskId === taskId);
      target?.focus?.({ preventScroll: true });
      target?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    });
  }

  selectCenterTaskInPlace(taskId, root, { focus = false } = {}) {
    if (!this.store.getTask(taskId) || !root) return;
    this.selectedTaskId = taskId;
    for (const el of root.querySelectorAll("[data-today-task-id]")) {
      const selected = el.dataset.todayTaskId === taskId;
      el.classList.toggle("is-selected", selected);
      el.setAttribute("aria-selected", selected ? "true" : "false");
      el.tabIndex = selected ? 0 : -1;
    }
    if (focus) {
      const target = [...root.querySelectorAll("[data-today-task-id]")].find((el) => el.dataset.todayTaskId === taskId);
      target?.focus?.({ preventScroll: true });
      target?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
  }

  clearBoardTaskSelectionInPlace(taskId = null) {
    if (taskId && this.selectedTaskId !== taskId) return;
    const boardRoot = this.contentEl?.querySelector?.(".today-center-list-view.is-board");
    if (!boardRoot) return;
    const previousId = this.selectedTaskId;
    this.selectedTaskId = null;
    this.lastTaskClickId = null;
    this.lastTaskClickAt = 0;

    let previous = null;
    for (const el of boardRoot.querySelectorAll("[data-today-task-id]")) {
      if (previousId && el.dataset.todayTaskId === previousId) previous = el;
      el.classList.remove("is-selected");
      el.setAttribute("aria-selected", "false");
      if (el !== previous) el.tabIndex = -1;
    }
    // Keep the previously active card as the board's roving keyboard tab stop,
    // but it is no longer semantically or visually selected. This avoids a
    // full board rerender and preserves scroll position when the detail closes.
    if (previous) previous.tabIndex = 0;
  }

  activateTaskFromPointer(taskId, element, { spatial = false } = {}) {
    if (!this.store.getTask(taskId)) return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const isSecondClick = this.lastTaskClickId === taskId && now - this.lastTaskClickAt <= 420;
    this.lastTaskClickId = isSecondClick ? null : taskId;
    this.lastTaskClickAt = isSecondClick ? 0 : now;
    if (isSecondClick) {
      this.plugin.openTaskDetail(taskId, element);
      return;
    }
    if (spatial) this.selectCenterTaskInPlace(taskId, element.closest(".today-center-main") || this.contentElSafe());
    else this.selectCenterTask(taskId);
  }

  installTaskKeyboardNavigation(root) {
    if (!root) return;
    const initialItems = [...root.querySelectorAll("[data-today-task-id]")];
    if (initialItems.length && !initialItems.some((el) => el.tabIndex === 0)) initialItems[0].tabIndex = 0;
    root.addEventListener("keydown", (event) => {
      const item = event.target?.closest?.("[data-today-task-id]");
      if (!item || !root.contains(item)) return;
      if (event.target !== item && event.target?.closest?.("button, input, textarea, select, [contenteditable='true']")) return;
      const taskId = item.dataset.todayTaskId;
      const task = this.store.getTask(taskId);
      if (!task) return;
      const elements = [...root.querySelectorAll("[data-today-task-id]")].filter((el) => el.offsetParent !== null);
      const index = elements.indexOf(item);
      const spatial = !!root.closest(".today-center-list-view")?.matches?.(".is-board, .is-timeline");
      const move = (nextIndex) => {
        if (!elements.length) return;
        const bounded = Math.max(0, Math.min(elements.length - 1, nextIndex));
        const nextId = elements[bounded]?.dataset?.todayTaskId;
        if (!nextId) return;
        if (spatial) this.selectCenterTaskInPlace(nextId, root, { focus: true });
        else this.selectCenterTask(nextId, { focus: true });
      };

      if (event.key === "ArrowDown" || event.key.toLowerCase() === "j") { event.preventDefault(); move(index + 1); return; }
      if (event.key === "ArrowUp" || event.key.toLowerCase() === "k") { event.preventDefault(); move(index - 1); return; }
      if (event.key === "Home") { event.preventDefault(); move(0); return; }
      if (event.key === "End") { event.preventDefault(); move(elements.length - 1); return; }
      if (event.key === "Enter") { event.preventDefault(); this.plugin.openTaskDetail(taskId, item); return; }
      if (event.key === " ") { event.preventDefault(); this.store.toggleTask(taskId); return; }
      if (event.key === "Escape") {
        event.preventDefault();
        if (spatial) {
          this.selectedTaskId = null;
          item.classList.remove("is-selected");
          item.setAttribute("aria-selected", "false");
        } else this.clearCenterTask({ keepFocusOn: taskId });
      }
    });
  }

  renderViewState({
    kind = "empty",
    title = "",
    description = "",
    icon = "inbox",
    actionLabel = "",
    onAction = null,
    compact = false,
    extraClass = "",
  } = {}) {
    const state = document.createElement("div");
    state.className = `today-view-state is-${kind}${compact ? " is-compact" : ""}${extraClass ? ` ${extraClass}` : ""}`;
    state.setAttribute("role", kind === "error" ? "alert" : "status");

    if (icon) {
      const iconWrap = document.createElement("div");
      iconWrap.className = "today-view-state-icon";
      iconWrap.appendChild(this.makeIcon(icon));
      state.appendChild(iconWrap);
    }

    const copy = document.createElement("div");
    copy.className = "today-view-state-copy";
    if (title) {
      const heading = document.createElement("div");
      heading.className = "today-view-state-title";
      heading.textContent = title;
      copy.appendChild(heading);
    }
    if (description) {
      const desc = document.createElement("div");
      desc.className = "today-view-state-description";
      desc.textContent = description;
      copy.appendChild(desc);
    }
    state.appendChild(copy);

    if (actionLabel && typeof onAction === "function") {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "today-view-state-action";
      action.textContent = actionLabel;
      action.addEventListener("click", (event) => {
        event.stopPropagation();
        onAction(event);
      });
      state.appendChild(action);
    }
    return state;
  }

  renderFilteredEmptyState() {
    return this.renderViewState({
      kind: "filtered",
      icon: "filter-x",
      title: "当前筛选下没有可显示的任务",
      description: "已完成任务被隐藏了。",
      actionLabel: "显示已完成",
      onAction: () => this.setListDisplayOption("hideCompleted", false),
    });
  }

  renderViewError(error) {
    console.error("[Today] Task Center view render failed", error);
    const shell = document.createElement("main");
    shell.className = "today-center-view-error";
    shell.appendChild(this.renderViewState({
      kind: "error",
      icon: "triangle-alert",
      title: "这个视图暂时无法显示",
      description: "任务数据没有被删除。可以重新加载当前视图再试一次。",
      actionLabel: "重新加载",
      onAction: () => this.render(),
    }));
    return shell;
  }

  startDelayedLoading(label = "正在更新…", delay = 160) {
    this.stopDelayedLoading();
    const token = uid();
    this.loadingToken = token;
    this.loadingTimer = window.setTimeout(() => {
      if (!this.isOpen || this.loadingToken !== token) return;
      const host = this.contentElSafe();
      if (!host?.isConnected) return;
      const overlay = document.createElement("div");
      overlay.className = "today-delayed-loading";
      overlay.setAttribute("role", "status");
      overlay.setAttribute("aria-live", "polite");
      const card = document.createElement("div");
      card.className = "today-delayed-loading-card";
      const spinner = this.makeIcon("loader-circle", "today-delayed-loading-icon");
      const text = document.createElement("span");
      text.textContent = label;
      card.append(spinner, text);
      const skeleton = document.createElement("div");
      skeleton.className = "today-delayed-loading-skeleton";
      for (let i = 0; i < 3; i += 1) {
        const row = document.createElement("span");
        skeleton.appendChild(row);
      }
      overlay.append(card, skeleton);
      host.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add("is-visible"));
      this.loadingOverlayEl = overlay;
    }, delay);
    return () => {
      if (this.loadingToken === token) this.stopDelayedLoading();
    };
  }

  stopDelayedLoading() {
    if (this.loadingTimer) {
      window.clearTimeout(this.loadingTimer);
      this.loadingTimer = null;
    }
    this.loadingToken = null;
    if (this.loadingOverlayEl?.isConnected) this.loadingOverlayEl.remove();
    this.loadingOverlayEl = null;
  }

  emptyDetailOverview() {
    const all = this.store.topLevelTasks();
    const selected = this.selectedListId;
    let title = "清单";
    let tasks = [];
    if (selected === "smart-today") {
      title = "今天";
      tasks = all.filter((task) => task.dueDate && (dayDiff(task.dueDate) <= 0 || (task.done && task.dueDate === todayISO())));
    } else if (selected === "smart-week") {
      title = "最近7天";
      tasks = all.filter((task) => task.dueDate && dayDiff(task.dueDate) >= 0 && dayDiff(task.dueDate) <= 7);
    } else if (selected === "smart-completed") {
      title = "已完成";
      tasks = this.completedTasks();
    } else if (this.isFolderSelection(selected)) {
      const folder = this.selectedFolder();
      title = folder?.name || "清单夹";
      const ids = new Set(this.folderLists(folder).map((list) => list.id));
      tasks = all.filter((task) => ids.has(task.listId));
    } else {
      const list = this.store.getList(selected);
      title = list?.name || "清单";
      tasks = all.filter((task) => task.listId === selected);
    }
    const pending = tasks.filter((task) => !task.done);
    const done = tasks.filter((task) => task.done);
    const overdue = pending.filter((task) => task.dueDate && dayDiff(task.dueDate) < 0);
    const today = pending.filter((task) => task.dueDate === todayISO());
    const sourceLists = new Set(tasks.map((task) => task.listId).filter(Boolean)).size;
    return { title, total: tasks.length, pending: pending.length, done: done.length, overdue: overdue.length, today: today.length, sourceLists };
  }

  closeQuickTaskPropertyHelper() {
    const helper = this.quickTaskPropertyHelper;
    if (!helper) return;
    helper.closeDatePopover?.();
    helper.closePriorityPopover?.();
    this.quickTaskPropertyHelper = null;
  }

  makeQuickTaskPropertyHelper(taskId) {
    this.closeQuickTaskPropertyHelper();
    const helper = new TaskDetailModal(this.app, this.plugin, taskId, null);
    helper.render = () => {};
    helper.close = () => this.closeQuickTaskPropertyHelper();
    helper.patch = async (patch) => {
      const keys = Object.keys(patch || {});
      let undoLabel = "";
      if (keys.some((key) => ["startDate", "dueDate", "dueTime", "endTime", "repeat"].includes(key))) undoLabel = "已修改日期";
      else if (keys.length === 1 && keys[0] === "priority") undoLabel = "已修改优先级";
      await this.store.updateTask(taskId, patch, { undoLabel });
    };
    this.quickTaskPropertyHelper = helper;
    return helper;
  }

  openQuickTaskDate(task, anchor, event = null) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const helper = this.makeQuickTaskPropertyHelper(task.id);
    helper.showDateMenu({ currentTarget: anchor, target: anchor, preventDefault() {}, stopPropagation() {} });
  }

  openQuickTaskPriority(task, anchor, event = null) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const helper = this.makeQuickTaskPropertyHelper(task.id);
    helper.showPriorityMenu({ currentTarget: anchor, target: anchor, preventDefault() {}, stopPropagation() {} });
  }

  makeTaskHoverAction(icon, label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "today-center-task-hover-action";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.appendChild(this.makeIcon(icon));
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick(event, button);
    });
    return button;
  }

  renderDockedTaskDetail(existingPane = null) {
    const task = this.selectedTaskId ? this.store.getTask(this.selectedTaskId) : null;

    // Keep the Content/document pane structurally present even when no task is
    // selected. This mirrors the desktop TickTick layout: the right column is a
    // stable workspace, initially blank, and selecting a task simply fills it.
    const pane = existingPane || document.createElement("aside");
    pane.className = "today-center-detail-pane today-plugin-root";
    pane.replaceChildren();
    delete pane.dataset.todayDetailTaskId;
    if (!task) {
      if (this.inlineTaskDetail) this.inlineTaskDetail.visualRenderToken = null;
      pane.classList.add("is-empty");
      pane.setAttribute("aria-label", "任务内容");
      const overview = this.emptyDetailOverview();
      const empty = document.createElement("div");
      empty.className = "today-content-empty-overview";
      const kicker = document.createElement("div");
      kicker.className = "today-content-empty-kicker";
      kicker.textContent = overview.title;
      const metric = document.createElement("div");
      metric.className = "today-content-empty-metric";
      const metricValue = document.createElement("strong");
      metricValue.textContent = String(overview.pending);
      if (this.selectedListId === "smart-completed") metricValue.textContent = String(overview.done);
      metric.append(metricValue, document.createTextNode(this.selectedListId === "smart-completed" ? " 个已完成" : " 个待办"));
      const meta = document.createElement("div");
      meta.className = "today-content-empty-meta";
      const parts = [];
      if (overview.overdue) parts.push(`${overview.overdue} 个逾期`);
      if (overview.today && this.selectedListId !== "smart-today") parts.push(`${overview.today} 个今天`);
      if (overview.done) parts.push(`${overview.done} 个已完成`);
      if (!parts.length) parts.push(overview.total ? `${overview.total} 个任务` : "暂无任务");
      meta.textContent = parts.slice(0, 2).join(" · ");
      if (this.selectedListId === "smart-completed") meta.textContent = overview.sourceLists ? `${overview.sourceLists} 个清单` : "";
      const hint = document.createElement("div");
      hint.className = "today-content-empty-hint";
      hint.textContent = "选择一条任务查看详情";
      empty.append(kicker, metric, meta, hint);
      pane.appendChild(empty);
      return pane;
    }
    pane.classList.add("today-task-detail");
    pane.dataset.todayDetailTaskId = task.id;

    let detail = this.inlineTaskDetail;
    if (!detail) {
      detail = Object.create(TaskDetailModal.prototype);
      detail.app = this.app;
      detail.plugin = this.plugin;
      detail.store = this.store;
      detail.anchorRect = null;
      detail.editorEl = null;
      detail.formatOpen = false;
      detail.previewOpen = false;
      detail.footerPopoverEl = null;
      detail.footerPopoverAnchor = null;
      detail.footerPopoverCleanup = null;
      detail.footerPopoverKind = "";
      detail.tagButtonEl = null;
      detail.moreButtonEl = null;
      detail.persistTimer = null;
      detail.hasLocalChanges = false;
      detail.datePopover = null;
      detail.datePopoverOutsideHandler = null;
      detail.priorityPopover = null;
      detail.priorityPopoverDismissCleanup = null;
      detail.priorityPopoverKeyboardCleanup = null;
      detail.dockedFooterEl = null;
      detail.dockedFooterCleanup = null;
      detail.dockedFooterPane = null;
      detail.subtaskComposerOpen = false;
      detail.subtaskDragId = null;
      detail.slashMenuEl = null;
      detail.slashMenuCleanup = null;
      detail.slashMenuCommands = [];
      detail.slashMenuActiveIndex = 0;
      detail.slashMenuQuery = null;
      detail.uiOwnerId = uid();
      detail.placeNearAnchor = () => {};
      detail.renderNavigation = (header) => this.renderDetailNavigation(header, detail.taskId);
      detail.close = () => this.clearCenterTask();
      detail.setTask = async (taskId) => {
        if (!this.store.getTask(taskId)) return;
        // Related-task chips may navigate outside the visible list and thus
        // fall back to a structural render. Preserve the original setTask
        // save-before-navigation behavior for that path as well.
        const revision = this.dockedSelectionRevision;
        try {
          await detail.flushLocalChanges(false);
        } catch (error) {
          console.error("[Today] Could not save before opening a related task", error);
          detail.hasLocalChanges = true;
          new Notice("当前任务保存失败，未跳转关联任务；请重试");
          return;
        }
        if (revision !== this.dockedSelectionRevision || !this.isOpen) return;
        detail.subtaskComposerOpen = false;
        detail.subtaskDragId = null;
        this.selectCenterTask(taskId);
      };
      this.inlineTaskDetail = detail;
    }
    detail.taskId = task.id;
    detail.contentEl = pane;
    detail.modalEl = pane;
    detail.render();
    return pane;
  }

  contentElSafe() {
    return this.contentEl;
  }

  makeIcon(name, className = "") {
    const span = document.createElement("span");
    if (className) span.className = className;
    setIcon(span, name);
    return span;
  }

  applySearch(root) {
    const q = this.query.trim().toLowerCase();
    root.querySelectorAll(".today-search-empty-state").forEach((node) => node.remove());
    root.querySelectorAll(".has-search-empty").forEach((node) => node.classList.remove("has-search-empty"));

    root.querySelectorAll("[data-search]").forEach((node) => {
      const hay = (node.dataset.search || "").toLowerCase();
      node.classList.toggle("today-center-search-hidden", !!q && !hay.includes(q));
    });
    this.syncDetailNavigation();

    if (!q || this.tab !== "lists") return;
    const main = root.querySelector(".today-center-main");
    if (!main) return;
    const taskNodes = [...main.querySelectorAll("[data-today-task-id]")];
    const hasVisibleTask = taskNodes.some((node) => !node.classList.contains("today-center-search-hidden"));
    if (hasVisibleTask) return;

    main.classList.add("has-search-empty");
    const state = this.renderViewState({
      kind: "search",
      icon: "search-x",
      title: `没有找到“${this.query.trim()}”`,
      description: "试试其它关键词，或清除当前搜索。",
      actionLabel: "清除搜索",
      onAction: () => {
        this.query = "";
        const input = root.querySelector(".today-center-search input");
        if (input) input.value = "";
        this.applySearch(root);
        input?.focus?.();
      },
      extraClass: "today-search-empty-state",
    });
    main.appendChild(state);
  }

  render() {
    // A structural rerender supersedes any pending asynchronous selection.
    this.dockedSelectionRevision++;
    this.plugin.motionController?.cancelDockedDetailTransition(this.getDockedDetailPane());
    this.columnResizeCleanup?.();
    this.cleanupTaskDragVisuals();
    this.inlineTaskDetail?.disposeFunctionalUi?.({ includeFooter: true });
    this.closeViewOptionsMenu();
    this.closeDisplayMenu();
    this.closePlanningEditor();
    this.closeCalendarDayPopover();
    const el = this.contentElSafe();
    el.replaceChildren();
    el.classList.add("today-plugin-root", "today-plugin-center");

    const shell = document.createElement("div");
    shell.className = "today-center-shell";

    const head = document.createElement("header");
    head.className = "today-center-topbar";

    const navRow = document.createElement("div");
    navRow.className = "today-center-nav-row";

    const tabs = document.createElement("nav");
    tabs.className = "today-center-tabs";
    tabs.setAttribute("aria-label", "任务中心导航");
    [
      ["lists", "清单", "list-checks"],
      ["tags", "标签", "tag"],
      ["calendar", "日历", "calendar-days"],
      ["stats", "统计", "chart-no-axes-column-increasing"],
    ].forEach(([id, label, icon]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.append(this.makeIcon(icon, "today-center-tab-icon"), document.createTextNode(label));
      if (id === this.tab) {
        b.classList.add("is-active");
        b.setAttribute("aria-current", "page");
      }
      b.addEventListener("click", () => this.setTab(id));
      tabs.appendChild(b);
    });

    const search = document.createElement("label");
    search.className = "today-center-search";
    search.appendChild(this.makeIcon("search", "today-center-search-icon"));
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.placeholder = "搜索任务、标签或清单";
    searchInput.value = this.query;
    searchInput.addEventListener("input", () => {
      this.query = searchInput.value;
      this.applySearch(shell);
    });
    search.appendChild(searchInput);
    navRow.append(tabs, search);

    head.append(navRow);
    shell.appendChild(head);

    try {
      if (this.tab === "lists") shell.appendChild(this.renderLists());
      else if (this.tab === "tags") shell.appendChild(this.renderTags());
      else if (this.tab === "calendar") shell.appendChild(this.renderCalendar());
      else shell.appendChild(this.renderStats());
    } catch (error) {
      shell.appendChild(this.renderViewError(error));
    }

    el.appendChild(shell);
    this.applyAppearanceSettings();
    try { this.applySearch(shell); } catch (error) { console.error("[Today] Search state failed", error); }
    this.restorePendingTaskFocus(shell);
  }

  makeListDot(list) {
    const dot = document.createElement("span");
    dot.className = `today-center-list-dot list-${list?.color || "neutral"}`;
    return dot;
  }

  makePill(text, type = "") {
    const pill = document.createElement("span");
    pill.className = `today-center-pill ${type ? `is-${type}` : ""}`.trim();
    pill.textContent = text;
    return pill;
  }

  plannedMinutes(task) {
    if (!task?.dueTime || !task?.endTime) return 0;
    const [sh, sm] = task.dueTime.split(":").map(Number);
    const [eh, em] = task.endTime.split(":").map(Number);
    const minutes = eh * 60 + em - (sh * 60 + sm);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
  }

  formatDuration(minutes) {
    if (!minutes) return "—";
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (!h) return `${m}m`;
    return m ? `${h}h ${m}m` : `${h}h`;
  }


  folderSelectionId(folderId) {
    return `folder:${folderId}`;
  }

  isFolderSelection(id = this.selectedListId) {
    return typeof id === "string" && id.startsWith("folder:");
  }

  selectedFolder() {
    if (!this.isFolderSelection()) return null;
    return this.store.getFolder(this.selectedListId.slice("folder:".length));
  }

  folderLists(folder = this.selectedFolder()) {
    if (!folder) return [];
    return this.store.data.lists.filter((list) => !list.system && list.folderId === folder.id);
  }

  viewOptionLabel(kind, value) {
    const labels = {
      group: { group: "分组", list: "清单", time: "时间", created: "创建时间", tag: "标签", priority: "优先级", none: "无" },
      sort: { manual: "手动排序", time: "时间", created: "创建时间", updated: "修改时间", title: "标题", tag: "标签", priority: "优先级" },
      order: { asc: "从旧到新", desc: "从新到旧" },
    };
    return labels[kind]?.[value] || value || "";
  }

  isCustomListGroupingContext(list = null) {
    if (this.isFolderSelection()) return false;
    const resolved = list || this.store.data.lists.find((entry) => entry.id === this.selectedListId) || null;
    return !!resolved && !resolved.system && this.selectedListId !== "smart-today" && this.selectedListId !== "smart-week";
  }

  currentGroupMode(list = null) {
    if (this.isFolderSelection()) return this.listViewOptions.folderGroup || "list";
    return this.isCustomListGroupingContext(list)
      ? (this.listViewOptions.customGroup || "group")
      : (this.listViewOptions.group || "time");
  }

  setCurrentGroupMode(value, list = null) {
    if (this.isFolderSelection()) this.listViewOptions.folderGroup = value;
    else if (this.isCustomListGroupingContext(list)) this.listViewOptions.customGroup = value;
    else this.listViewOptions.group = value;
  }

  groupingChoices(list = null) {
    // Folder → List → Group → Task. A selected folder structurally groups by
    // child List; a selected custom list structurally groups by persistent Group.
    const structural = this.isFolderSelection()
      ? ["list", "清单"]
      : (this.isCustomListGroupingContext(list) ? ["group", "分组"] : ["list", "清单"]);
    return [
      structural,
      ["time", "时间"],
      ["created", "创建时间"],
      ["tag", "标签"],
      ["priority", "优先级"],
      ["none", "无"],
    ];
  }

  getListDisplayOptions() {
    const settings = this.plugin.data.settings || (this.plugin.data.settings = {});
    const raw = settings.taskCenterDisplay || {};
    const allowed = new Set(["list", "board", "timeline"]);
    const normalized = {
      hideCompleted: !!raw.hideCompleted,
      showDetails: !!raw.showDetails,
      hideChecklist: !!raw.hideChecklist,
      smartTodayView: ["list", "board"].includes(raw.smartTodayView) ? raw.smartTodayView : "list",
      smartWeekView: allowed.has(raw.smartWeekView) ? raw.smartWeekView : "list",
    };
    settings.taskCenterDisplay = normalized;
    return normalized;
  }

  async setListDisplayOption(key, value) {
    const stopLoading = this.startDelayedLoading("正在更新视图…");
    try {
      const options = this.getListDisplayOptions();
      options[key] = value;
      this.plugin.data.settings.taskCenterDisplay = options;
      await this.plugin.saveData(this.plugin.data);
      if (this.isOpen) this.render();
    } finally {
      stopLoading();
    }
  }

  currentListViewMode({ isTodaySmart = false, isWeekSmart = false, list = null, folder = null } = {}) {
    if (isTodaySmart) return this.getListDisplayOptions().smartTodayView || "list";
    if (isWeekSmart) return this.getListDisplayOptions().smartWeekView || "list";
    if (folder) return folder.viewMode || "list";
    return list?.viewMode || "list";
  }

  async setCurrentListViewMode(view, { isTodaySmart = false, isWeekSmart = false, list = null, folder = null } = {}) {
    if (!["list", "board", "timeline"].includes(view)) return;
    // “今天” supports list + board. Keep timeline disabled because the day
    // aggregate has little value as a separate Gantt surface.
    if (isTodaySmart && view === "timeline") return;
    if (this.currentListViewMode({ isTodaySmart, isWeekSmart, list, folder }) === view) return;
    const stopLoading = this.startDelayedLoading("正在切换视图…");
    try {
      const currentMain = this.contentEl?.querySelector?.(".today-center-main");
      await this.plugin.motionController?.exitView(currentMain);
      this.plugin.motionController?.markViewSwitch(view);
      this.inlineTaskDetail?.disposeFunctionalUi?.({ includeFooter: true });
      this.closeSpatialTaskDetail();
      this.selectedTaskId = null;
      if (isTodaySmart) {
        const options = this.getListDisplayOptions();
        options.smartTodayView = view;
        this.plugin.data.settings.taskCenterDisplay = options;
        await this.plugin.saveData(this.plugin.data);
        if (this.isOpen) this.render();
        return;
      }
      if (isWeekSmart) {
        const options = this.getListDisplayOptions();
        options.smartWeekView = view;
        this.plugin.data.settings.taskCenterDisplay = options;
        await this.plugin.saveData(this.plugin.data);
        if (this.isOpen) this.render();
        return;
      }
      if (folder) {
        await this.store.updateFolder(folder.id, { viewMode: view });
        return;
      }
      if (list) await this.store.updateList(list.id, { viewMode: view });
    } finally {
      stopLoading();
    }
  }

  closeDisplayMenu() {
    this.displayMenuKeyboardCleanup?.();
    this.displayMenuKeyboardCleanup = null;
    if (this.displayMenuAnchor?.getAttribute?.("aria-expanded") === "true") this.displayMenuAnchor.setAttribute("aria-expanded", "false");
    this.displayMenuAnchor = null;
    this.displayMenuEl?.remove();
    this.displayMenuEl = null;
    if (this.displayMenuOutsideHandler) {
      document.removeEventListener("pointerdown", this.displayMenuOutsideHandler, true);
      this.displayMenuOutsideHandler = null;
    }
  }

  taskContentPresentation(task) {
    const raw = String(task?.content || "");
    const lines = raw.split(/\r?\n/);
    let checklistTotal = 0;
    let checklistDone = 0;
    const prose = [];
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      const check = trimmed.match(/^[-*+]\s+\[([ xX])\]\s+(.*)$/);
      if (check) {
        checklistTotal += 1;
        if (String(check[1]).toLowerCase() === "x") checklistDone += 1;
        continue;
      }
      let line = trimmed
        .replace(/^#{1,6}\s+/, "")
        .replace(/^>\s?/, "")
        .replace(/^[-*+]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/(\*\*|__)(.*?)\1/g, "$2")
        .replace(/(\*|_)(.*?)\1/g, "$2")
        .replace(/~~(.*?)~~/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .trim();
      if (line && !/^---+$/.test(line)) prose.push(line);
    }
    return {
      summary: prose.join(" · "),
      checklistTotal,
      checklistDone,
    };
  }

  showDisplayMenu(event, anchor, context = {}) {
    event?.stopPropagation?.();
    this.closeViewOptionsMenu();
    this.closeDisplayMenu();
    const options = this.getListDisplayOptions();
    const currentView = this.currentListViewMode(context);

    const menu = document.createElement("div");
    menu.className = "today-center-display-menu";
    menu.setAttribute("role", "menu");

    const viewLabel = document.createElement("div");
    viewLabel.className = "today-center-display-menu-label";
    viewLabel.textContent = "视图";
    menu.appendChild(viewLabel);

    const viewRow = document.createElement("div");
    viewRow.className = "today-center-display-view-row";
    const viewDefs = [
      ["list", "list", "列表"],
      ["board", "columns-3", "看板"],
      ["timeline", "gantt-chart", "时间线"],
    ];
    for (const [view, icon, label] of viewDefs) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "today-center-display-view-button";
      button.title = `${label}视图`;
      button.setAttribute("aria-label", `${label}视图`);
      const unsupported = !!context.isTodaySmart && view === "timeline";
      if (view === currentView) button.classList.add("is-active");
      if (unsupported) {
        button.disabled = true;
        button.classList.add("is-disabled");
      }
      button.appendChild(this.makeIcon(icon, "today-center-display-view-icon"));
      button.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        if (unsupported || view === currentView) return;
        this.closeDisplayMenu();
        await this.setCurrentListViewMode(view, context);
      });
      viewRow.appendChild(button);
    }
    menu.appendChild(viewRow);

    const divider = document.createElement("div");
    divider.className = "today-center-display-divider";
    menu.appendChild(divider);

    const toggles = [
      ["hideCompleted", "circle-check-big", "隐藏已完成"],
      ["showDetails", "git-branch", "显示详细"],
      ["hideChecklist", "list-checks", "隐藏检查事项"],
    ];
    for (const [key, icon, label] of toggles) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "today-center-display-toggle";
      row.setAttribute("role", "menuitemcheckbox");
      const active = !!options[key];
      row.setAttribute("aria-checked", active ? "true" : "false");
      if (active) row.classList.add("is-active");
      const left = document.createElement("span");
      left.className = "today-center-display-toggle-left";
      left.append(this.makeIcon(icon, "today-center-display-toggle-icon"), document.createTextNode(label));
      row.appendChild(left);
      if (active) row.appendChild(this.makeIcon("check", "today-center-display-toggle-check"));
      row.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        this.closeDisplayMenu();
        await this.setListDisplayOption(key, !active);
      });
      menu.appendChild(row);
    }

    document.body.appendChild(menu);
    this.displayMenuEl = menu;
    this.displayMenuAnchor = anchor;
    this.displayMenuKeyboardCleanup = installPopoverKeyboard(menu, anchor, () => this.closeDisplayMenu(), { itemSelector: "button:not(:disabled)", ariaHasPopup: "menu" });
    this.positionViewOptionsPopover(menu, anchor.getBoundingClientRect());
    setTimeout(() => {
      this.displayMenuOutsideHandler = (pointerEvent) => {
        if (this.displayMenuEl?.contains(pointerEvent.target) || anchor.contains(pointerEvent.target)) return;
        this.closeDisplayMenu();
      };
      document.addEventListener("pointerdown", this.displayMenuOutsideHandler, true);
    }, 0);
  }

  closeViewOptionsMenu() {
    this.viewOptionsKeyboardCleanup?.();
    this.viewOptionsKeyboardCleanup = null;
    if (this.viewOptionsAnchor?.getAttribute?.("aria-expanded") === "true") this.viewOptionsAnchor.setAttribute("aria-expanded", "false");
    this.viewOptionsAnchor = null;
    this.viewOptionsSubmenuEl?.remove();
    this.viewOptionsMenuEl?.remove();
    this.viewOptionsSubmenuEl = null;
    this.viewOptionsMenuEl = null;
    if (this.viewOptionsOutsideHandler) {
      document.removeEventListener("pointerdown", this.viewOptionsOutsideHandler, true);
      this.viewOptionsOutsideHandler = null;
    }
  }

  positionViewOptionsPopover(popover, anchorRect, preferred = "below") {
    if (!popover || !anchorRect) return;
    this.plugin.floatingController?.place(popover, anchorRect, {
      placement: preferred === "submenu" ? "bottom-start" : "bottom-start",
      gap: preferred === "submenu" ? -2 : 6,
      padding: 8,
      crossOffset: preferred === "submenu" ? 18 : 0,
      flip: true,
      shift: true,
    });
  }

  openViewOptionsSubmenu(kind, anchorRow) {
    this.viewOptionsSubmenuEl?.remove();
    this.viewOptionsSubmenuEl = null;
    const choices = {
      group: this.groupingChoices(),
      sort: [
        ["manual", "手动排序"],
        ["time", "时间"],
        ["created", "创建时间"],
        ["updated", "修改时间"],
        ["title", "标题"],
        ["tag", "标签"],
        ["priority", "优先级"],
      ],
      order: [
        ["asc", "从旧到新"],
        ["desc", "从新到旧"],
      ],
    };
    const menu = document.createElement("div");
    menu.className = "today-center-view-submenu";
    menu.setAttribute("role", "menu");
    for (const [value, label] of choices[kind]) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "today-center-view-submenu-row";
      row.setAttribute("role", "menuitemradio");
      const active = kind === "group" ? this.currentGroupMode() === value : this.listViewOptions[kind] === value;
      row.setAttribute("aria-checked", active ? "true" : "false");
      if (active) row.classList.add("is-active");
      const text = document.createElement("span");
      text.textContent = label;
      row.appendChild(text);
      if (active) row.appendChild(this.makeIcon("check", "today-center-view-menu-check"));
      row.addEventListener("click", (event) => {
        event.stopPropagation();
        if (kind === "group") this.setCurrentGroupMode(value);
        else this.listViewOptions[kind] = value;
        this.closeViewOptionsMenu();
        this.render();
      });
      menu.appendChild(row);
    }
    document.body.appendChild(menu);
    this.viewOptionsSubmenuEl = menu;
    installPopoverKeyboard(menu, anchorRow, () => { menu.remove(); this.viewOptionsSubmenuEl = null; anchorRow.focus?.({ preventScroll: true }); }, { itemSelector: "button:not(:disabled)", ariaHasPopup: "menu" });
    this.positionViewOptionsPopover(menu, anchorRow.getBoundingClientRect(), "submenu");
  }

  showViewOptionsMenu(event, anchor) {
    event?.stopPropagation?.();
    this.closeViewOptionsMenu();
    const menu = document.createElement("div");
    menu.className = "today-center-view-menu";
    menu.setAttribute("role", "menu");
    const rows = [
      ["group", "rows-3", "分组"],
      ["sort", "list-ordered", "排序"],
      ["order", "arrow-down-up", "顺序"],
    ];
    for (const [kind, icon, label] of rows) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "today-center-view-menu-row";
      row.setAttribute("role", "menuitem");
      const left = document.createElement("span");
      left.className = "today-center-view-menu-left";
      left.append(this.makeIcon(icon, "today-center-view-menu-icon"), document.createTextNode(label));
      const right = document.createElement("span");
      right.className = "today-center-view-menu-right";
      const value = document.createElement("span");
      value.className = "today-center-view-menu-value";
      value.textContent = this.viewOptionLabel(kind, kind === "group" ? this.currentGroupMode() : this.listViewOptions[kind]);
      right.append(value, this.makeIcon("chevron-right", "today-center-view-menu-chevron"));
      row.append(left, right);
      row.addEventListener("click", (ev) => {
        ev.stopPropagation();
        menu.querySelectorAll(".today-center-view-menu-row.is-open").forEach((node) => node.classList.remove("is-open"));
        row.classList.add("is-open");
        this.openViewOptionsSubmenu(kind, row);
      });
      menu.appendChild(row);
    }
    document.body.appendChild(menu);
    this.viewOptionsMenuEl = menu;
    this.viewOptionsAnchor = anchor;
    this.viewOptionsKeyboardCleanup = installPopoverKeyboard(menu, anchor, () => this.closeViewOptionsMenu(), { itemSelector: "button:not(:disabled)", ariaHasPopup: "menu" });
    this.positionViewOptionsPopover(menu, anchor.getBoundingClientRect());
    setTimeout(() => {
      this.viewOptionsOutsideHandler = (pointerEvent) => {
        if (this.viewOptionsMenuEl?.contains(pointerEvent.target) || this.viewOptionsSubmenuEl?.contains(pointerEvent.target) || anchor.contains(pointerEvent.target)) return;
        this.closeViewOptionsMenu();
      };
      document.addEventListener("pointerdown", this.viewOptionsOutsideHandler, true);
    }, 0);
  }

  sortTasksForListView(tasks) {
    const mode = this.listViewOptions.sort;
    const order = this.listViewOptions.order === "desc" ? -1 : 1;
    if (mode === "manual") {
      return [...tasks].sort((a, b) => {
        const av = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : Number(a.createdAt || 0);
        const bv = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : Number(b.createdAt || 0);
        if (av !== bv) return (av - bv) * order;
        return String(a.title || "").localeCompare(String(b.title || ""), "zh-CN") * order;
      });
    }
    const key = (task) => {
      if (mode === "time") return `${task.dueDate || "9999-12-31"} ${task.dueTime || "23:59"}`;
      if (mode === "created") return task.createdAt || "9999-12-31T23:59:59";
      if (mode === "updated") return task.updatedAt || task.createdAt || "9999-12-31T23:59:59";
      if (mode === "title") return (task.title || "").toLocaleLowerCase();
      if (mode === "tag") return (task.tags?.[0] || "zzzzzz").toLocaleLowerCase();
      if (mode === "priority") return String(task.priority ? task.priority : 9);
      return "";
    };
    return [...tasks].sort((a, b) => {
      const av = key(a), bv = key(b);
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "zh-CN", { numeric: true });
      if (cmp) return cmp * order;
      return String(a.title || "").localeCompare(String(b.title || ""), "zh-CN") * order;
    });
  }

  renderOptionGroupedTasks(tasks, container, { list = null, draggable = false } = {}) {
    const grouped = this.currentGroupMode(list);
    const sorted = this.sortTasksForListView(tasks);
    if (grouped === "none") {
      if (!draggable) {
        for (const task of sorted) this.appendTaskWithExpandedSubtasks(container, task);
        return;
      }
      const taskHost = document.createElement("div");
      taskHost.className = "today-center-section-tasks is-ungrouped";
      for (const task of sorted) this.appendTaskWithExpandedSubtasks(taskHost, task, { draggable: true });
      container.appendChild(taskHost);
      this.installTaskDropZone(taskHost, { kind: "list", preserveContainer: true, label: "当前顺序" });
      return;
    }
    const buckets = new Map();
    const add = (label, task) => {
      if (!buckets.has(label)) buckets.set(label, []);
      buckets.get(label).push(task);
    };
    for (const task of sorted) {
      if (grouped === "list") add(this.store.getList(task.listId)?.name || "无清单", task);
      else if (grouped === "created") {
        const raw = task.createdAt ? new Date(task.createdAt) : null;
        add(raw && !Number.isNaN(raw.getTime()) ? `${raw.getMonth() + 1}月${raw.getDate()}日` : "未知创建时间", task);
      } else if (grouped === "tag") add(task.tags?.[0] ? `#${task.tags[0]}` : "无标签", task);
      else if (grouped === "priority") add(task.priority === 1 ? "高优先级" : task.priority === 2 ? "中优先级" : task.priority === 3 ? "低优先级" : "无优先级", task);
      else {
        if (task.done) add("已完成", task);
        else if (!task.dueDate) add("无日期", task);
        else if (dayDiff(task.dueDate) < 0) add("已过期", task);
        else if (dayDiff(task.dueDate) === 0) add("今天", task);
        else if (dayDiff(task.dueDate) === 1) add("明天", task);
        else {
          const d = parseDateOnly(task.dueDate);
          add(`${d.getMonth() + 1}月${d.getDate()}日`, task);
        }
      }
    }
    for (const [label, bucket] of buckets) {
      let dropConfig = null;
      if (draggable) {
        if (grouped === "priority") {
          const priority = label === "高优先级" ? 1 : label === "中优先级" ? 2 : label === "低优先级" ? 3 : 0;
          dropConfig = { preserveContainer: true, sameSectionOnly: false, patch: { priority }, label };
        } else if (grouped === "list") {
          const targetListId = bucket[0]?.listId || null;
          dropConfig = targetListId ? { preserveContainer: false, sameSectionOnly: false, listId: targetListId, groupId: null, label } : null;
        } else if (grouped === "time") {
          if (label === "已完成") dropConfig = { preserveContainer: true, sameSectionOnly: false, patch: { done: true }, label };
          else if (label === "今天") dropConfig = { preserveContainer: true, sameSectionOnly: false, patch: { dueDate: todayISO(), done: false }, label };
          else if (label === "明天") dropConfig = { preserveContainer: true, sameSectionOnly: false, patch: { dueDate: addDays(todayISO(), 1), done: false }, label };
          else if (label === "无日期") dropConfig = { preserveContainer: true, sameSectionOnly: false, patch: { dueDate: "", dueTime: "", endTime: "", done: false }, label };
          else if (bucket[0]?.dueDate) dropConfig = { preserveContainer: true, sameSectionOnly: false, patch: { dueDate: bucket[0].dueDate, done: false }, label };
        }
      }
      this.renderSection(label, bucket, container, {
        always: true,
        preserveOrder: true,
        groupMenuList: list && !list.system ? list : null,
        draggable,
        dropConfig: dropConfig || undefined,
      });
    }
  }


  groupBuckets(list, tasks, { includeEmpty = true } = {}) {
    if (!list) return [];
    if (list.system) {
      return [{ id: null, name: list.name || "未分组", order: 0, tasks: [...tasks], pseudo: true }];
    }
    const ordered = this.store.getGroups(list.id);
    const buckets = ordered.map((group) => ({ ...group, tasks: tasks.filter((task) => task.groupId === group.id) }));
    const ungrouped = tasks.filter((task) => !task.groupId || !ordered.some((group) => group.id === task.groupId));
    if (ungrouped.length || (!ordered.length && includeEmpty)) {
      buckets.push({ id: null, name: "未分组", order: 99999, tasks: ungrouped, pseudo: true });
    }
    return includeEmpty ? buckets : buckets.filter((bucket) => bucket.tasks.length);
  }

  newCenterComposerDraft(list, groupId = null, defaults = {}) {
    return {
      title: "",
      content: "",
      priority: 0,
      listId: list?.id || "inbox",
      groupId: groupId || null,
      tags: [],
      attachment: "",
      startDate: "",
      dueDate: todayISO(),
      _dateExplicit: false,
      dueTime: "",
      endTime: "",
      repeat: null,
      ...clonePlain(defaults),
    };
  }

  startCenterComposer(list, groupId = null, viewKey = this.selectedListId, { slot = "main", defaults = {} } = {}) {
    if (!list) return;
    // One capture surface owns the draft. Another + must not erase unfinished input.
    if ((this.centerComposerDraft?.title?.trim() || this.centerComposerDraft?.content?.trim() || this.centerComposerDraft?.attachment) && this.centerComposerContext?.viewKey === viewKey) {
      this.centerComposerFocusPending = true;
      this.render();
      return;
    }
    this.closeCenterComposerPopover();
    this.centerComposerDraft = this.newCenterComposerDraft(list, groupId, defaults);
    this.centerComposerContext = { listId: list.id, groupId: groupId || null, viewKey, slot, defaults: clonePlain(defaults) };
    this.centerComposerFocusPending = true;
    this.render();
  }

  renderCenterComposerAt(container, list, slot = "main") {
    const context = this.centerComposerContext;
    if (!list || !this.centerComposerDraft || context?.viewKey !== this.selectedListId || (context.slot || "main") !== slot) return false;
    const composer = this.renderCenterComposer(list, context.groupId);
    composer.dataset.composerSlot = slot;
    container.appendChild(composer);
    return true;
  }

  cancelCenterComposer({ rerender = true } = {}) {
    this.detachCenterComposerOutsideHandler();
    this.closeCenterComposerPopover();
    this.centerComposerDraft = null;
    this.centerComposerContext = null;
    this.centerComposerFocusPending = false;
    if (rerender) this.render();
  }

  closeCenterComposerPopover() {
    if (this.centerComposerHost?.closePopover) this.centerComposerHost.closePopover();
    else {
      const pop = this.centerComposerHost?.popover;
      if (pop?.isConnected) pop.remove();
      if (this.centerComposerHost) this.centerComposerHost.popover = null;
    }
  }

  detachCenterComposerOutsideHandler() {
    if (!this.centerComposerOutsideHandler) return;
    document.removeEventListener("pointerdown", this.centerComposerOutsideHandler, true);
    this.centerComposerOutsideHandler = null;
  }

  makeCenterComposerHost() {
    const center = this;
    center.closeCenterComposerPopover();
    const host = {
      draft: center.centerComposerDraft,
      store: center.store,
      plugin: center.plugin,
      popover: null,
      iconButton(icon, label, click, extra = "") {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `today-icon-btn ${extra}`.trim();
        btn.setAttribute("aria-label", label);
        btn.title = label;
        setIcon(btn, icon);
        btn.addEventListener("click", click);
        return btn;
      },
      rowButton(icon, title, subtitle, onClick) {
        return TodaySidebarView.prototype.rowButton.call(host, icon, title, subtitle, onClick);
      },
      openPopover(wrap, anchor, content, width = 220) {
        return TodaySidebarView.prototype.openPopover.call(host, wrap, anchor, content, width);
      },
      closePopover() {
        return TodaySidebarView.prototype.closePopover.call(host);
      },
      render() {
        // If the list was changed from the compact property menu, a group from
        // the previous list must never leak into the new container.
        const selectedList = center.store.getList(host.draft.listId);
        if (host.draft.groupId && !selectedList?.groups?.some((group) => group.id === host.draft.groupId)) {
          host.draft.groupId = null;
        }
        center.centerComposerDraft = host.draft;
        center.centerComposerFocusPending = true;
        center.render();
      },
      openPriorityPopover(wrap, anchor) {
        return TodaySidebarView.prototype.openPriorityPopover.call(host, wrap, anchor);
      },
      openListPopover(wrap, anchor) {
        return TodaySidebarView.prototype.openListPopover.call(host, wrap, anchor);
      },
      openTagPopover(wrap, anchor) {
        return TodaySidebarView.prototype.openTagPopover.call(host, wrap, anchor);
      },
      openAttachmentPopover(wrap, anchor) {
        return TodaySidebarView.prototype.openAttachmentPopover.call(host, wrap, anchor);
      },
      openDatePopover(wrap, anchor) {
        return TodaySidebarView.prototype.openDatePopover.call(host, wrap, anchor);
      },
    };
    center.centerComposerHost = host;
    return host;
  }

  openCenterComposerMore(wrap, anchor) {
    const host = this.centerComposerHost || this.makeCenterComposerHost();
    const box = document.createElement("div");
    box.className = "today-menu";
    box.appendChild(host.rowButton("text", host.draft._showDescription ? "收起描述" : "添加描述", "", () => {
      host.draft._showDescription = !host.draft._showDescription;
      host.closePopover();
      host.render();
      if (host.draft._showDescription) requestAnimationFrame(() => this.contentEl.querySelector(".today-center-composer-description")?.focus());
    }));
    host.openPopover(wrap, anchor, box, 190);
  }

  renderCenterComposer(targetList, groupId = null) {
    const wrap = document.createElement("div");
    wrap.className = "today-center-composer-wrap today-composer-wrap";

    // The center composer deliberately reuses the sidebar's detailed capture
    // grammar: title on the first row, task properties directly underneath.
    // On a wide center pane this keeps the controls spatially attached to the
    // title instead of marooning them on the far right edge.
    const form = document.createElement("form");
    form.className = "today-center-composer today-composer is-detail";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "today-center-composer-input today-composer-input";
    input.placeholder = `＋ 添加任务至“${this.store.getList(this.centerComposerDraft?.listId || targetList.id)?.name || targetList.name}”`;
    input.value = this.centerComposerDraft?.title || "";
    input.autocomplete = "off";
    input.addEventListener("input", () => {
      if (this.centerComposerDraft) this.centerComposerDraft.title = input.value;
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.cancelCenterComposer();
      }
    });

    const host = this.makeCenterComposerHost();
    const propertyLabel = (button, label) => {
      button.classList.add("has-label");
      const text = document.createElement("span");
      text.className = "today-center-composer-property-label";
      text.textContent = label;
      button.appendChild(text);
    };

    const tagRow = document.createElement("div");
    tagRow.className = "today-center-composer-tags today-composer-tags";
    if (!host.draft.tags.length) tagRow.classList.add("is-hidden");
    for (const tag of host.draft.tags) {
      const chip = document.createElement("span");
      chip.className = "today-tag-chip";
      chip.textContent = `#${tag}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `移除标签 ${tag}`);
      remove.addEventListener("click", () => {
        host.draft.tags = host.draft.tags.filter((item) => item !== tag);
        host.render();
      });
      chip.appendChild(remove);
      tagRow.appendChild(chip);
    }

    const tools = document.createElement("div");
    tools.className = "today-center-composer-tools today-composer-tools";

    const dateBtn = host.iconButton("calendar-days", "日期与时间", (event) => host.openDatePopover(wrap, event.currentTarget));
    const scheduleLabel = `${dateLabel(host.draft)}${host.draft.repeat ? ` · ${repeatLabel(host.draft)}` : ""}`;
    propertyLabel(dateBtn, scheduleLabel);
    dateBtn.title = `日期与时间：${scheduleLabel}`;
    if (host.draft.dueDate && host.draft._dateExplicit) dateBtn.classList.add("is-active");

    const priorityBtn = host.iconButton("flag", "优先级", (event) => host.openPriorityPopover(wrap, event.currentTarget));
    priorityBtn.classList.add(`priority-${host.draft.priority || 0}`);
    if (host.draft.priority) propertyLabel(priorityBtn, ["", "高", "中", "低"][host.draft.priority]);

    const listBtn = host.iconButton("inbox", "清单", (event) => host.openListPopover(wrap, event.currentTarget));
    const draftList = this.store.getList(host.draft.listId);
    const draftGroup = this.store.getGroup(host.draft.listId, host.draft.groupId);
    const containerLabel = [draftList?.name || "收集箱", draftGroup?.name].filter(Boolean).join(" / ");
    propertyLabel(listBtn, containerLabel);
    listBtn.title = `清单：${containerLabel}`;
    if (host.draft.listId !== "inbox") listBtn.classList.add("is-active");

    const tagBtn = host.iconButton("tag", "标签", (event) => host.openTagPopover(wrap, event.currentTarget));
    if (host.draft.tags.length) tagBtn.classList.add("is-active");

    const attachmentBtn = host.iconButton("paperclip", "附件", (event) => host.openAttachmentPopover(wrap, event.currentTarget));
    if (host.draft.attachment) attachmentBtn.classList.add("is-active");

    const moreBtn = host.iconButton("ellipsis", "更多", (event) => this.openCenterComposerMore(wrap, event.currentTarget));

    for (const button of [dateBtn, priorityBtn, listBtn, tagBtn, attachmentBtn, moreBtn]) {
      button.classList.add("today-center-composer-tool");
      tools.appendChild(button);
    }

    const addBtn = document.createElement("button");
    addBtn.type = "submit";
    addBtn.className = "today-add-btn today-center-composer-add";
    addBtn.textContent = "添加";
    const syncCenterAddState = () => {
      const ready = !!this.centerComposerDraft?.title?.trim();
      addBtn.disabled = !ready;
      addBtn.classList.toggle("is-ready", ready);
    };
    syncCenterAddState();
    input.addEventListener("input", syncCenterAddState);
    tools.appendChild(addBtn);

    form.appendChild(input);
    if (host.draft._showDescription) {
      const description = document.createElement("textarea");
      description.className = "today-center-composer-description";
      description.placeholder = "添加描述";
      description.setAttribute("aria-label", "任务描述");
      description.rows = 2;
      description.value = host.draft.content || "";
      description.addEventListener("input", () => { host.draft.content = description.value; });
      description.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); form.requestSubmit(); }
      });
      form.appendChild(description);
    }
    form.append(tagRow);
    if (host.draft.attachment) {
      const attachment = document.createElement("div");
      attachment.className = "today-center-composer-attachment";
      const path = document.createElement("span");
      path.textContent = host.draft.attachment;
      path.title = host.draft.attachment;
      const remove = host.iconButton("x", "移除附件", () => { host.draft.attachment = ""; host.render(); });
      attachment.append(this.makeIcon("paperclip"), path, remove);
      form.appendChild(attachment);
    }
    form.appendChild(tools);
    wrap.appendChild(form);

    // The detailed capture is still transient. Clicking outside releases focus;
    // an untouched draft collapses back to the quiet one-line add affordance.
    const collapseEmptyComposer = () => {
      setTimeout(() => {
        if (!wrap.isConnected || !this.isOpen || !this.centerComposerDraft) return;
        if (this.centerComposerContext?.viewKey !== this.selectedListId) return;
        if (wrap.contains(document.activeElement)) return;
        if (this.centerComposerHost?.popover?.isConnected) return;
        if (!this.centerComposerDraft.title?.trim() && !this.centerComposerDraft.content?.trim() && !this.centerComposerDraft.attachment) this.cancelCenterComposer();
      }, 0);
    };

    form.addEventListener("focusout", () => collapseEmptyComposer());

    this.detachCenterComposerOutsideHandler();
    this.centerComposerOutsideHandler = (event) => {
      if (!wrap.isConnected) {
        this.detachCenterComposerOutsideHandler();
        return;
      }
      const target = event.target;
      if (target instanceof Node && wrap.contains(target)) return;
      input.blur();
      collapseEmptyComposer();
    };
    document.addEventListener("pointerdown", this.centerComposerOutsideHandler, true);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const draft = this.centerComposerDraft;
      const title = draft?.title?.trim();
      if (!title) {
        input.focus();
        return;
      }
      const context = this.centerComposerContext || { listId: targetList.id, groupId, viewKey: this.selectedListId };
      const { _dateExplicit, _showDescription, ...taskDraft } = draft;
      if (!_dateExplicit) taskDraft.dueDate = todayISO();
      const payload = {
        ...taskDraft,
        title,
        groupId: taskDraft.groupId || null,
        dueDate: taskDraft.dueDate || "",
        dueTime: taskDraft.dueDate ? (taskDraft.dueTime || "23:59") : "",
      };

      const defaultList = this.store.getList(context.listId) || targetList;
      this.closeCenterComposerPopover();
      this.centerComposerDraft = this.newCenterComposerDraft(defaultList, context.groupId, context.defaults);
      this.centerComposerContext = context;
      this.centerComposerFocusPending = true;
      await this.store.addTask(payload);
      new Notice("任务已添加");
      // TaskStore.changed already rendered and focused the next draft.
    });

    if (this.centerComposerFocusPending) {
      requestAnimationFrame(() => {
        if (!input.isConnected || !this.centerComposerFocusPending) return;
        this.centerComposerFocusPending = false;
        input.focus();
        const end = input.value.length;
        input.setSelectionRange?.(end, end);
      });
    }
    return wrap;
  }

  startTaskComposer(list, groupId = null, slot = "main") {
    this.startCenterComposer(list, groupId, this.selectedListId, { slot });
  }

  startBoardTaskComposer(list, bucket) {
    const groupMode = this.currentGroupMode(list);
    const defaults = {};

    // New tasks inherit the visible lane whenever that lane maps to a writable
    // property. In a concrete list, the structural “分组” lane maps directly
    // to the task's persistent groupId.
    if (groupMode === "group") {
      defaults.groupId = bucket?.groupId || null;
    } else if (groupMode === "priority" && Number.isFinite(Number(bucket?.priority))) {
      defaults.priority = Number(bucket.priority) || 0;
    } else if (groupMode === "tag" && bucket?.tag) {
      defaults.tags = [bucket.tag];
    } else if (groupMode === "time") {
      if (bucket?.id === "time-none") {
        defaults.dueDate = "";
        defaults.dueTime = "";
        defaults._dateExplicit = true;
      } else if (bucket?.dueDate) {
        defaults.dueDate = bucket.dueDate;
        defaults._dateExplicit = true;
      } else if (bucket?.id === "time-overdue") {
        defaults.dueDate = addDays(todayISO(), -1);
        defaults._dateExplicit = true;
      }
    }

    this.startCenterComposer(list, defaults.groupId || null, this.selectedListId, { slot: `board:${list.id}:${bucket.id}`, defaults });
  }

  showTaskGroupMenu(event, task, list) {
    // Kept as a compatibility entry point for older render paths. Task editing
    // now uses one reusable context menu across List / Board / Timeline.
    this.plugin.openTaskContextMenu(event, task, { anchor: event?.currentTarget || event?.target });
  }

  showFolderMenu(event, folder) {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("添加清单").setIcon("plus").onClick(async () => {
      const name = await this.app.todayPrompt("清单名称");
      if (name?.trim()) await this.store.addList(name, folder.id);
    }));
    menu.addItem((item) => item.setTitle("编辑文件夹").setIcon("pencil").onClick(() => new FolderEditorModal(this.app, this.plugin, folder).open()));
    menu.addItem((item) => item.setTitle(folder.pinned ? "取消置顶" : "置顶文件夹").setIcon("pin").onClick(() => this.store.updateFolder(folder.id, { pinned: !folder.pinned })));
    menu.showAtMouseEvent(event);
  }

  showListMenu(event, list) {
    if (!list || list.system) return;
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("新建分组").setIcon("rows-3").onClick(async () => {
      const name = await this.app.todayPrompt("分组名称");
      if (name?.trim()) await this.store.addGroup(list.id, name);
    }));
    menu.addItem((item) => item.setTitle("编辑清单").setIcon("pencil").onClick(() => new ListEditorModal(this.app, this.plugin, list).open()));
    menu.showAtMouseEvent(event);
  }

  showGroupMenu(event, list, group) {
    if (!group || group.pseudo) return;
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("添加任务").setIcon("plus").onClick(() => this.startTaskComposer(list, group.id)));
    menu.addItem((item) => item.setTitle("重命名分组").setIcon("pencil").onClick(async () => {
      const name = await this.app.todayPrompt("分组名称", group.name);
      if (name?.trim()) await this.store.updateGroup(list.id, group.id, { name: name.trim() });
    }));
    menu.showAtMouseEvent(event);
  }

  renderInlineSubtaskPreview(task, parentTask, depth = 1) {
    // Reuse the exact normal List-row renderer. Inline subtasks differ only by
    // their indented host; title, summary, metadata, selection, completion,
    // priority and context-menu behavior all come from renderCenterTask().
    const row = this.renderCenterTask(task, { draggable: false });
    row.classList.add("today-center-inline-task-row");
    row.dataset.todaySubtaskId = task.id;
    row.dataset.todaySubtaskParentId = parentTask?.id || "";
    row.style.setProperty("--today-subtask-depth", String(Math.max(1, depth)));
    row.title = `子任务 · 父任务：${parentTask?.title || "任务"} · 单击选择 · 双击或 Enter 打开`;
    return row;
  }

  appendInlineSubtaskTree(host, task, parentTask, depth = 1) {
    host.appendChild(this.renderInlineSubtaskPreview(task, parentTask, depth));
    if (!this.expandedSubtaskParents.has(task.id)) return;
    const children = this.store.childTasks(task.id);
    if (!children.length) return;
    const nested = document.createElement("div");
    nested.className = "today-center-inline-subtasks";
    nested.dataset.todaySubtaskParentId = task.id;
    nested.dataset.todaySubtaskDepth = String(depth + 1);
    nested.setAttribute("aria-label", `${task.title || "任务"} 的子任务`);
    for (const child of children) this.appendInlineSubtaskTree(nested, child, task, depth + 1);
    host.appendChild(nested);
  }

  appendTaskWithExpandedSubtasks(host, task, options = {}) {
    host.appendChild(this.renderCenterTask(task, options));
    if (this.tab !== "lists" || !this.expandedSubtaskParents.has(task.id)) return;
    const children = this.store.childTasks(task.id);
    if (!children.length) return;
    const nested = document.createElement("div");
    nested.className = "today-center-inline-subtasks";
    nested.dataset.todaySubtaskParentId = task.id;
    nested.dataset.todaySubtaskDepth = "1";
    nested.setAttribute("aria-label", `${task.title || "任务"} 的子任务`);
    for (const child of children) this.appendInlineSubtaskTree(nested, child, task, 1);
    host.appendChild(nested);
  }

  renderCenterTask(task, options = {}) {
    const row = document.createElement("div");
    row.className = `today-center-task priority-${task.priority || 0}`;
    if (task.done) row.classList.add("is-done");
    row.dataset.search = [task.title, task.content || "", ...(task.tags || []), this.store.getList(task.listId)?.name || ""].join(" ");

    const check = document.createElement("button");
    check.type = "button";
    check.className = "today-center-check";
    check.setAttribute("aria-label", task.done ? `取消完成 ${task.title}` : `完成 ${task.title}`);
    if (task.done) {
      check.classList.add("is-done");
      setIcon(check, "check");
    }
    check.addEventListener("click", (event) => { event.stopPropagation(); this.store.toggleTask(task.id); });

    const body = document.createElement("div");
    body.className = "today-center-task-body";
    const title = document.createElement("div");
    title.className = `today-center-task-title priority-${task.priority || 0}`;
    title.textContent = task.title;

    const list = this.store.getList(task.listId);

    if (this.tab === "lists") {
      row.classList.add("is-ticktick-row");
      const displayOptions = this.getListDisplayOptions();
      body.appendChild(title);
      if (options.completed && task.parentTaskId) {
        const trail = this.store.taskAncestors(task).map((ancestor) => ancestor.title).join(" / ");
        if (trail) {
          const parent = document.createElement("div");
          parent.className = "today-completed-parent";
          parent.textContent = `↳ ${trail}`;
          parent.title = trail;
          body.appendChild(parent);
        }
      }

      const presentation = this.taskContentPresentation(task);
      if (displayOptions.showDetails) {
        row.classList.add("is-detailed");
        const previewText = presentation.summary || (!displayOptions.hideChecklist && presentation.checklistTotal
          ? `检查事项 ${presentation.checklistDone}/${presentation.checklistTotal}`
          : "");
        if (previewText) {
          body.classList.add("has-summary");
          const summary = document.createElement("div");
          summary.className = "today-center-task-detail-summary";
          summary.textContent = previewText;
          summary.title = previewText;
          body.appendChild(summary);
        }
      }

      // Keep contextual metadata and the due date in two explicit lanes.
      // This avoids every task row calculating a different visual baseline/right edge.
      const sideMeta = document.createElement("div");
      sideMeta.className = "today-center-task-side-meta";
      const contextMeta = document.createElement("span");
      contextMeta.className = "today-center-task-side-context";
      const endMeta = document.createElement("span");
      endMeta.className = "today-center-task-side-end";

      const showList = this.selectedListId === "smart-today" || this.selectedListId === "smart-week" || this.selectedListId === "smart-completed" || this.selectedListId === "inbox" || this.isFolderSelection();
      if (showList && list) {
        const listMeta = document.createElement("span");
        listMeta.className = `today-center-task-side-list list-${list.color || "neutral"}`;
        const dot = this.makeListDot(list);
        dot.classList.add("today-center-task-side-dot");
        const text = document.createElement("span");
        text.textContent = list.name;
        listMeta.append(dot, text);
        contextMeta.appendChild(listMeta);
      }
      if (task.repeat) {
        const repeatMeta = document.createElement("span");
        repeatMeta.className = "today-center-task-side-icon";
        repeatMeta.title = repeatLabel(task);
        repeatMeta.appendChild(this.makeIcon("repeat-2"));
        contextMeta.appendChild(repeatMeta);
      }
      const subtaskProgress = this.store.subtaskProgress(task.id);
      if (subtaskProgress.total) {
        const subtaskMeta = document.createElement("button");
        subtaskMeta.type = "button";
        subtaskMeta.className = `today-center-task-side-subtasks${this.expandedSubtaskParents.has(task.id) ? " is-expanded" : ""}`;
        subtaskMeta.title = `${this.expandedSubtaskParents.has(task.id) ? "收起" : "展开"}子任务 · ${subtaskProgress.done}/${subtaskProgress.total}`;
        subtaskMeta.setAttribute("aria-expanded", this.expandedSubtaskParents.has(task.id) ? "true" : "false");
        const branchIcon = this.makeIcon("git-branch", "today-center-task-side-subtasks-branch");
        const progressText = document.createElement("span");
        progressText.className = "today-center-task-side-subtasks-count";
        progressText.textContent = `${subtaskProgress.done}/${subtaskProgress.total}`;
        subtaskMeta.append(branchIcon, progressText);
        subtaskMeta.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (this.expandedSubtaskParents.has(task.id)) this.expandedSubtaskParents.delete(task.id);
          else this.expandedSubtaskParents.add(task.id);
          this.render();
        });
        contextMeta.appendChild(subtaskMeta);
      }
      if (displayOptions.showDetails && !displayOptions.hideChecklist && presentation.checklistTotal) {
        const progressMeta = document.createElement("span");
        progressMeta.className = "today-center-task-side-checklist";
        progressMeta.append(this.makeIcon("list-checks"), document.createTextNode(`${presentation.checklistDone}/${presentation.checklistTotal}`));
        contextMeta.appendChild(progressMeta);
      }
      if (task.dueDate && !options.completed) {
        const dueMeta = document.createElement("span");
        const diff = dayDiff(task.dueDate);
        const dueState = diff < 0 && !task.done ? "is-overdue" : diff === 0 ? "is-today" : diff > 0 ? "is-future" : "is-past";
        dueMeta.className = `today-center-task-side-due ${dueState}`;
        dueMeta.textContent = compactTaskDateLabel(task);
        endMeta.appendChild(dueMeta);
      }
      if (options.metric) {
        const metric = document.createElement("span");
        metric.className = "today-center-task-side-metric";
        metric.textContent = options.metric;
        endMeta.appendChild(metric);
      }
      sideMeta.append(contextMeta, endMeta);
      row.append(check, body, sideMeta);

      const hoverActions = document.createElement("div");
      hoverActions.className = "today-center-task-hover-actions";
      const dateAction = this.makeTaskHoverAction("calendar-days", "日期", (event, button) => this.openQuickTaskDate(task, button, event));
      const priorityAction = this.makeTaskHoverAction("flag", "优先级", (event, button) => this.openQuickTaskPriority(task, button, event));
      const moreAction = this.makeTaskHoverAction("ellipsis", "更多", (event, button) => this.plugin.openTaskContextMenu(event, task, { anchor: button }));
      hoverActions.append(dateAction, priorityAction, moreAction);
      row.appendChild(hoverActions);
    } else {
      const meta = document.createElement("div");
      meta.className = "today-center-task-meta";
      if (task.parentTaskId) {
        const trail = this.store.taskAncestors(task).map((item) => item.title);
        if (trail.length) {
          const parentPill = this.makePill(`↳ ${trail.join(" / ")}`, "list");
          parentPill.title = `所属父任务：${trail.join(" / ")}`;
          meta.appendChild(parentPill);
        }
      }
      const listPill = this.makePill(list.name, "list");
      listPill.classList.add(`list-${list.color || "neutral"}`);
      meta.appendChild(listPill);
      for (const tag of task.tags || []) meta.appendChild(this.makePill(`#${tag}`, "tag"));
      if (task.dueDate) {
        const dueType = dayDiff(task.dueDate) < 0 && !task.done ? "overdue" : "due";
        meta.appendChild(this.makePill(compactTaskDateLabel(task), dueType));
      }
      if (task.repeat) meta.appendChild(this.makePill(`↻ ${repeatLabel(task)}`, "repeat"));
      body.append(title, meta);
      row.append(check, body);
      if (options.metric) {
        const metric = document.createElement("div");
        metric.className = "today-center-task-metric";
        metric.textContent = options.metric;
        row.appendChild(metric);
      }
    }
    if (this.tab === "lists") {
      row.dataset.todayTaskId = task.id;
      row.tabIndex = task.id === this.selectedTaskId ? 0 : -1;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", task.id === this.selectedTaskId ? "true" : "false");
      row.title = options.draggable
        ? "拖动排序或移动 · 单击选择 · 双击或 Enter 打开"
        : (options.groupMenuList && !options.groupMenuList.system
          ? "单击选择 · 双击或 Enter 打开 · 右键移动到其他分组"
          : "单击选择 · 双击或 Enter 打开");
      if (task.id === this.selectedTaskId) row.classList.add("is-selected");
      row.addEventListener("click", (event) => {
        event.stopPropagation();
        if (Date.now() < this.suppressTaskClickUntil) return;
        this.activateTaskFromPointer(task.id, row);
      });
      if (options.draggable) this.installTaskDraggable(row, task, "list");
    } else {
      row.addEventListener("click", (event) => this.plugin.openTaskDetail(task.id, event.currentTarget));
    }
    row.addEventListener("contextmenu", (event) => {
      this.plugin.openTaskContextMenu(event, task, { anchor: row });
    });
    return row;
  }

  renderSummaryCard(label, value, sub) {
    const card = document.createElement("div");
    card.className = "today-center-summary-card";
    const l = document.createElement("div");
    l.className = "today-center-summary-label";
    l.textContent = label;
    const v = document.createElement("div");
    v.className = "today-center-summary-value";
    v.textContent = String(value);
    const s = document.createElement("div");
    s.className = "today-center-summary-sub";
    s.textContent = sub;
    card.append(l, v, s);
    return card;
  }

  completedTasks() {
    const since = this.completedPeriod === "today" ? todayISO()
      : this.completedPeriod === "week" ? addDays(todayISO(), -6)
      : this.completedPeriod === "month" ? addDays(todayISO(), -29) : "";
    return this.store.data.tasks.filter((task) => {
      if (!task.done || (this.completedListId && task.listId !== this.completedListId)) return false;
      const day = completionDay(task);
      return !since || (day && day >= since && day <= todayISO());
    }).sort((a, b) => (completionDay(b) ? Number(b.completedAt) : 0) - (completionDay(a) ? Number(a.completedAt) : 0) || a.title.localeCompare(b.title));
  }

  renderCompletedView(main) {
    if (this.completedListId && !this.store.data.lists.some((list) => list.id === this.completedListId)) this.completedListId = "";
    const tasks = this.completedTasks();
    const filters = document.createElement("div");
    filters.className = "today-completed-filters";
    const addFilter = (label, key, choices) => {
      const select = document.createElement("select");
      select.setAttribute("aria-label", label);
      for (const [value, text] of choices) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        select.appendChild(option);
      }
      select.value = this[key];
      select.addEventListener("change", async () => {
        try { await this.inlineTaskDetail?.flushLocalChanges?.(false); }
        catch (error) {
          console.error("[Today] Could not save before filtering completed tasks", error);
          this.inlineTaskDetail.hasLocalChanges = true;
          select.value = this[key];
          new Notice("当前任务保存失败，请重试");
          return;
        }
        this[key] = select.value;
        this.render();
      });
      filters.appendChild(select);
    };
    addFilter("完成时间", "completedPeriod", [["all", "全部日期"], ["today", "今天"], ["week", "最近7天"], ["month", "最近30天"]]);
    addFilter("完成任务所属清单", "completedListId", [["", "全部清单"], ...this.store.data.lists.map((list) => [list.id, list.name])]);
    const count = document.createElement("span");
    count.className = "today-completed-count";
    count.textContent = `${tasks.length} 项`;
    filters.appendChild(count);
    main.appendChild(filters);
    if (!tasks.length) {
      const filtered = this.completedPeriod !== "all" || !!this.completedListId;
      main.appendChild(this.renderViewState({
        icon: "circle-check-big",
        title: filtered ? "没有符合条件的已完成任务" : "还没有已完成任务",
        ...(filtered ? { actionLabel: "清除筛选", onAction: () => { this.completedPeriod = "all"; this.completedListId = ""; this.render(); } } : {}),
      }));
      return tasks;
    }
    const days = new Map();
    for (const task of tasks) {
      const day = completionDay(task);
      if (!days.has(day)) days.set(day, []);
      days.get(day).push(task);
    }
    for (const [day, entries] of days) {
      let title = "未记录完成时间";
      if (day) {
        const diff = dayDiff(day);
        title = diff === 0 ? "今天" : diff === -1 ? "昨天" : day.replaceAll("-", "/");
      }
      this.renderSection(title, entries, main, { preserveOrder: true, completed: true, flat: true, metric: (task) => {
        if (!completionDay(task)) return "—";
        const date = new Date(task.completedAt);
        return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
      } });
    }
    return tasks;
  }

  renderSection(title, tasks, container, options = {}) {
    if (!tasks.length && !options.always) return;

    // The same section title may occur in different smart/list views. Scope the
    // fold key to the active list so folding one "已完成" does not fold all of them.
    const sectionKey = `${this.selectedListId || "none"}::${title}`;
    const collapsed = this.collapsedSections.has(sectionKey);

    const head = document.createElement("div");
    head.className = `today-center-section-head${collapsed ? " is-collapsed" : ""}${options.dateSection ? " is-date-section" : ""}`;
    head.setAttribute("role", "button");
    head.setAttribute("tabindex", "0");
    head.setAttribute("aria-expanded", collapsed ? "false" : "true");
    head.setAttribute("aria-label", `${collapsed ? "展开" : "折叠"}${title}`);

    const chevron = this.makeIcon(collapsed ? "chevron-right" : "chevron-down", "today-center-section-chevron");
    const label = document.createElement("span");
    label.className = "today-center-section-title";
    label.textContent = title;
    const count = document.createElement("span");
    count.className = "today-center-section-count";
    count.textContent = String(tasks.length);
    head.append(chevron, label, count);
    container.appendChild(head);

    const toggle = () => {
      if (this.collapsedSections.has(sectionKey)) this.collapsedSections.delete(sectionKey);
      else this.collapsedSections.add(sectionKey);
      this.render();
    };
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggle();
    });

    if (collapsed) return;
    const sectionTasks = options.preserveOrder ? tasks : this.sortTasksForListView(tasks);
    const dragEnabled = !!options.draggable;
    const taskHost = dragEnabled ? document.createElement("div") : container;
    if (dragEnabled) taskHost.className = "today-center-section-tasks";
    for (const task of sectionTasks) {
      const metric = options.metric ? options.metric(task) : "";
      const taskOptions = {};
      if (metric) taskOptions.metric = metric;
      if (options.groupMenuList) taskOptions.groupMenuList = options.groupMenuList;
      if (dragEnabled) taskOptions.draggable = true;
      if (options.flat) taskHost.appendChild(this.renderCenterTask(task, { ...taskOptions, completed: !!options.completed }));
      else this.appendTaskWithExpandedSubtasks(taskHost, task, taskOptions);
    }
    if (dragEnabled) {
      container.appendChild(taskHost);
      this.installTaskDropZone(taskHost, {
        kind: "list",
        preserveContainer: true,
        sameSectionOnly: true,
        label: title,
        ...(options.dropConfig || {}),
      });
    }
  }

  renderLists() {
    const panel = document.createElement("div");
    panel.className = "today-center-list-view today-center-resizable";

    const allTop = this.store.topLevelTasks();
    const todayKey = todayISO();
    const pendingToday = allTop.filter((task) => !task.done && task.dueDate && dayDiff(task.dueDate) <= 0);
    const pendingWeek = allTop.filter((task) => !task.done && task.dueDate && dayDiff(task.dueDate) >= 0 && dayDiff(task.dueDate) <= 7);

    const sidebar = document.createElement("aside");
    sidebar.className = "today-center-sidebar";

    const renderSmartButton = (id, label, icon, count) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "today-center-side-item today-center-smart-item";
      b.dataset.search = label;
      if (this.selectedListId === id) b.classList.add("is-active");
      const iconEl = this.makeIcon(icon, "today-center-smart-icon");
      const name = document.createElement("span");
      name.textContent = label;
      const countEl = document.createElement("span");
      countEl.className = "today-center-side-count";
      countEl.textContent = String(count);
      b.append(iconEl, name, countEl);
      b.addEventListener("click", () => { this.cancelCenterComposer({ rerender: false }); this.inlineTaskDetail?.disposeFunctionalUi?.({ includeFooter: true }); this.closeSpatialTaskDetail(); this.selectedListId = id; this.selectedTaskId = null; this.render(); });
      return b;
    };

    sidebar.appendChild(renderSmartButton("smart-today", "今天", "calendar-days", pendingToday.length));
    sidebar.appendChild(renderSmartButton("smart-week", "最近7天", "calendar-range", pendingWeek.length));
    const inbox = this.store.data.lists.find((list) => list.id === "inbox") || this.store.data.lists[0];
    const inboxCount = allTop.filter((task) => task.listId === inbox.id && !task.done).length;
    sidebar.appendChild(renderSmartButton(inbox.id, inbox.name, "inbox", inboxCount));

    const sep = document.createElement("div");
    sep.className = "today-center-side-sep";
    sidebar.appendChild(sep);
    const foldersLabel = document.createElement("div");
    foldersLabel.className = "today-center-side-label";
    foldersLabel.textContent = "清单";
    sidebar.appendChild(foldersLabel);

    const renderListButton = (list, nested = false) => {
      const tasks = allTop.filter((task) => task.listId === list.id && !task.done);
      const b = document.createElement("button");
      b.type = "button";
      b.className = `today-center-side-item${nested ? " is-nested" : ""}`;
      b.dataset.search = list.name;
      if (list.id === this.selectedListId) b.classList.add("is-active");
      const name = document.createElement("span");
      name.textContent = list.name;
      const count = document.createElement("span");
      count.className = "today-center-side-count";
      count.textContent = String(tasks.length);
      b.append(this.makeListDot(list), name, count);
      b.addEventListener("click", () => { this.cancelCenterComposer({ rerender: false }); this.inlineTaskDetail?.disposeFunctionalUi?.({ includeFooter: true }); this.closeSpatialTaskDetail(); this.selectedListId = list.id; this.selectedTaskId = null; this.render(); });
      if (!list.system) b.addEventListener("contextmenu", (event) => { event.preventDefault(); this.showListMenu(event, list); });
      return b;
    };

    const folders = [...this.store.data.folders].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.order || 0) - (b.order || 0));
    for (const folder of folders) {
      const folderLists = this.store.data.lists.filter((list) => !list.system && list.folderId === folder.id);
      const wrap = document.createElement("div");
      wrap.className = `today-center-folder${folder.pinned ? " is-pinned" : ""}`;
      const head = document.createElement("button");
      head.type = "button";
      head.className = "today-center-folder-head";
      const chevron = this.makeIcon(this.collapsedFolders.has(folder.id) ? "chevron-right" : "chevron-down", "today-center-folder-chevron");
      const folderIcon = this.makeIcon("folder", "today-center-folder-icon");
      const folderName = document.createElement("span");
      folderName.className = "today-center-folder-name";
      folderName.textContent = folder.name;
      const count = document.createElement("span");
      count.className = "today-center-folder-count";
      count.textContent = String(folderLists.length);
      head.append(chevron, folderIcon, folderName, count);
      if (this.selectedListId === this.folderSelectionId(folder.id)) head.classList.add("is-active");
      head.addEventListener("click", (event) => {
        if (event.target.closest(".today-center-folder-chevron")) {
          this.collapsedFolders.has(folder.id) ? this.collapsedFolders.delete(folder.id) : this.collapsedFolders.add(folder.id);
          this.render();
          return;
        }
        this.cancelCenterComposer({ rerender: false });
        this.inlineTaskDetail?.disposeFunctionalUi?.({ includeFooter: true });
        this.closeSpatialTaskDetail();
        this.selectedListId = this.folderSelectionId(folder.id);
        this.selectedTaskId = null;
        this.render();
      });
      head.addEventListener("contextmenu", (event) => { event.preventDefault(); this.showFolderMenu(event, folder); });
      wrap.appendChild(head);
      if (!this.collapsedFolders.has(folder.id)) {
        const items = document.createElement("div");
        items.className = "today-center-folder-items";
        for (const list of folderLists) items.appendChild(renderListButton(list, true));
        wrap.appendChild(items);
      }
      sidebar.appendChild(wrap);
    }

    const unfiled = this.store.data.lists.filter((list) => !list.system && !this.store.getFolder(list.folderId));
    if (unfiled.length) {
      const noFolder = document.createElement("div");
      noFolder.className = "today-center-folder";
      const label = document.createElement("div");
      label.className = "today-center-folder-head is-static";
      label.append(this.makeIcon("folder-open", "today-center-folder-icon"), document.createTextNode("未归档"));
      noFolder.appendChild(label);
      const items = document.createElement("div");
      items.className = "today-center-folder-items";
      unfiled.forEach((list) => items.appendChild(renderListButton(list, true)));
      noFolder.appendChild(items);
      sidebar.appendChild(noFolder);
    }

    const add = document.createElement("button");
    add.type = "button";
    add.className = "today-center-side-item today-center-new-list";
    add.append(this.makeIcon("plus", "today-center-side-icon"), document.createTextNode("新建"));
    add.addEventListener("click", (event) => {
      const menu = new Menu();
      menu.addItem((item) => item.setTitle("新建文件夹").setIcon("folder-plus").onClick(async () => {
        const name = await this.app.todayPrompt("文件夹名称"); if (name?.trim()) await this.store.addFolder(name);
      }));
      menu.addItem((item) => item.setTitle("新建清单").setIcon("list-plus").onClick(async () => {
        const name = await this.app.todayPrompt("清单名称"); if (name?.trim()) await this.store.addList(name, folders[0]?.id || null);
      }));
      menu.showAtMouseEvent(event);
    });
    sidebar.appendChild(add);

    const historySep = document.createElement("div");
    historySep.className = "today-center-side-sep";
    sidebar.append(historySep, renderSmartButton("smart-completed", "已完成", "circle-check-big", this.store.data.tasks.filter((task) => task.done).length));

    const main = document.createElement("main");
    main.className = "today-center-main";
    const isTodaySmart = this.selectedListId === "smart-today";
    const isWeekSmart = this.selectedListId === "smart-week";
    const isCompletedSmart = this.selectedListId === "smart-completed";
    main.classList.toggle("is-completed-history", isCompletedSmart);
    const isSmart = isTodaySmart || isWeekSmart || isCompletedSmart;
    const isFolder = this.isFolderSelection();
    const folder = isFolder ? this.selectedFolder() : null;
    const selectedFolderLists = folder ? this.folderLists(folder) : [];
    const list = (!isSmart && !isFolder) ? (this.store.data.lists.find((entry) => entry.id === this.selectedListId) || null) : null;
    if ((!isSmart && !isFolder && !list) || (isFolder && !folder)) { this.selectedListId = "smart-today"; return this.renderLists(); }

    const mainHead = document.createElement("div");
    mainHead.className = "today-center-main-head";
    const info = document.createElement("div");
    const title = document.createElement("div");
    title.className = "today-center-list-title";
    const titleText = document.createElement("span");
    titleText.className = "today-center-list-title-text";
    titleText.textContent = isTodaySmart ? "今天" : isWeekSmart ? "最近7天" : isCompletedSmart ? "已完成" : folder ? folder.name : list.name;
    if (isTodaySmart) title.append(this.makeIcon("calendar-days", "today-center-smart-title-icon"), titleText);
    else if (isWeekSmart) title.append(this.makeIcon("calendar-range", "today-center-smart-title-icon"), titleText);
    else if (isCompletedSmart) title.append(this.makeIcon("circle-check-big", "today-center-smart-title-icon"), titleText);
    else if (folder) title.append(this.makeIcon("folder-open", "today-center-smart-title-icon"), titleText);
    else title.append(this.makeListDot(list), titleText);
    info.appendChild(title);
    const actions = document.createElement("div");
    actions.className = "today-center-actions";

    const viewMode = this.currentListViewMode({ isTodaySmart, isWeekSmart, list, folder });

    const sortMenu = document.createElement("button");
    sortMenu.type = "button";
    sortMenu.className = "today-center-action today-center-action-icon-only today-center-action-bare";
    sortMenu.title = "分组与排序";
    sortMenu.setAttribute("aria-label", "分组与排序");
    sortMenu.appendChild(this.makeIcon("arrow-down-up", "today-center-action-icon"));
    sortMenu.addEventListener("click", (event) => this.showViewOptionsMenu(event, sortMenu));
    const more = document.createElement("button");
    more.type = "button";
    more.className = "today-center-action today-center-action-icon-only today-center-action-bare";
    more.title = "更多";
    more.setAttribute("aria-label", "更多");
    more.appendChild(this.makeIcon("ellipsis", "today-center-action-icon"));
    more.addEventListener("click", (event) => this.showDisplayMenu(event, more, { isTodaySmart, isWeekSmart, list, folder, viewMode }));
    if (!isCompletedSmart) actions.append(sortMenu, more);
    mainHead.append(info, actions);
    main.appendChild(mainHead);

    if (!isCompletedSmart) {
      const targetList = list || selectedFolderLists[0] || (!folder ? inbox : null);
      const composerActive = this.renderCenterComposerAt(main, targetList);
      if (!composerActive && viewMode === "list" && targetList) {
        const quickAdd = document.createElement("button");
        quickAdd.type = "button";
        quickAdd.className = "today-center-quick-add";
        const quickAddLabel = document.createElement("span");
        quickAddLabel.className = "today-center-quick-add-label";
        quickAddLabel.textContent = "添加任务";
        quickAdd.append(this.makeIcon("plus", "today-center-quick-add-icon"), quickAddLabel);
        quickAdd.addEventListener("click", () => this.startCenterComposer(targetList, null, this.selectedListId));
        main.appendChild(quickAdd);
      }
    }

    const displayOptions = this.getListDisplayOptions();
    let visibleTasks = [];
    if (isCompletedSmart) {
      visibleTasks = this.renderCompletedView(main);
    } else if (isTodaySmart) {
      const overdue = allTop.filter((task) => !task.done && task.dueDate && dayDiff(task.dueDate) < 0);
      const todayPending = allTop.filter((task) => !task.done && task.dueDate === todayKey);
      const doneToday = displayOptions.hideCompleted ? [] : allTop.filter((task) => task.done && task.dueDate === todayKey);
      visibleTasks = [...overdue, ...todayPending, ...doneToday];
      const completedTodayAll = allTop.filter((task) => task.done && task.dueDate === todayKey);
      if (!visibleTasks.length && displayOptions.hideCompleted && completedTodayAll.length) {
        main.appendChild(this.renderFilteredEmptyState());
      } else if (!visibleTasks.length && viewMode === "list") {
        main.appendChild(this.renderViewState({
          kind: "empty",
          icon: "sun",
          title: "今天没有待办",
          description: "今天可以轻一点，也可以添加一条新任务。",
          actionLabel: "添加今天的任务",
          onAction: () => this.startCenterComposer(inbox, null, this.selectedListId),
        }));
      } else if (viewMode === "board") {
        main.appendChild(this.renderSmartBoardView(visibleTasks, "today"));
      } else if (this.currentGroupMode() === "time") {
        this.renderSection("已过期", overdue, main, { draggable: true });
        this.renderSection("今天", todayPending, main, { always: true, draggable: true, dateSection: true, dropConfig: { preserveContainer: true, sameSectionOnly: false, patch: { dueDate: todayKey }, label: "今天" } });
        this.renderSection("已完成", doneToday, main, { draggable: true });
      } else this.renderOptionGroupedTasks(visibleTasks, main, { draggable: true });
    } else if (isWeekSmart) {
      const rawWeek = allTop.filter((task) => task.dueDate && dayDiff(task.dueDate) >= 0 && dayDiff(task.dueDate) <= 7);
      let inRange = displayOptions.hideCompleted ? rawWeek.filter((task) => !task.done) : rawWeek;
      visibleTasks = inRange;
      const pending = inRange.filter((task) => !task.done);
      if (!inRange.length && displayOptions.hideCompleted && rawWeek.length) {
        main.appendChild(this.renderFilteredEmptyState());
      } else if (viewMode === "board") {
        main.appendChild(this.renderSmartBoardView(inRange, "week"));
      } else if (viewMode === "timeline") {
        // The aggregate timeline keeps dates editable while using a single lane;
        // source-list grouping can be layered in later without changing the view contract.
        main.appendChild(this.renderTimelineView(inRange, { ...inbox, name: "最近7天" }));
      } else if (!inRange.length) {
        main.appendChild(this.renderViewState({
          kind: "empty",
          icon: "calendar-range",
          title: "最近 7 天没有任务",
          description: "未来一周暂时没有安排。",
          actionLabel: "添加任务",
          onAction: () => this.startCenterComposer(inbox, null, this.selectedListId),
        }));
      } else if (this.currentGroupMode() === "time") {
        const byDate = new Map();
        for (const task of pending) {
          if (!byDate.has(task.dueDate)) byDate.set(task.dueDate, []);
          byDate.get(task.dueDate).push(task);
        }
        const dateKeys = [...byDate.keys()].sort();
        for (const key of dateKeys) {
          const diff = dayDiff(key);
          const d = parseDateOnly(key);
          const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
          const label = diff === 0 ? "今天" : diff === 1 ? "明天" : `${weekday} · ${d.getMonth() + 1}月${d.getDate()}日`;
          this.renderSection(label, byDate.get(key), main, { always: true, draggable: true, dateSection: true, dropConfig: { preserveContainer: true, sameSectionOnly: false, patch: { dueDate: key }, label } });
        }
        if (!displayOptions.hideCompleted) this.renderSection("已完成", inRange.filter((task) => task.done), main, { draggable: true });
      } else this.renderOptionGroupedTasks(inRange, main, { draggable: true });
    } else if (isFolder) {
      const listIds = new Set(selectedFolderLists.map((entry) => entry.id));
      const allRaw = allTop.filter((task) => listIds.has(task.listId));
      const all = displayOptions.hideCompleted ? allRaw.filter((task) => !task.done) : allRaw;
      visibleTasks = all;
      if (!selectedFolderLists.length) {
        main.appendChild(this.renderViewState({
          kind: "empty",
          icon: "folder-plus",
          title: "这个清单夹还没有清单",
          description: "先创建一个清单，再开始添加任务。",
          actionLabel: "新建清单",
          onAction: async () => {
            const name = await this.app.todayPrompt("清单名称");
            if (name?.trim()) await this.store.addList(name, folder.id);
          },
        }));
      } else if (allRaw.length && !all.length && displayOptions.hideCompleted) {
        main.appendChild(this.renderFilteredEmptyState());
      } else if (viewMode === "board") {
        main.appendChild(this.renderFolderBoardView(all, folder, selectedFolderLists));
      } else if (viewMode === "timeline") {
        main.appendChild(this.renderTimelineView(all, this.folderTimelineContext(folder, selectedFolderLists)));
      } else if (this.currentGroupMode() === "list") {
        main.appendChild(this.renderFolderGroupedListView(all, folder, selectedFolderLists));
      } else {
        this.renderOptionGroupedTasks(all, main, { draggable: true });
      }
    } else {
      const allRaw = allTop.filter((task) => task.listId === this.selectedListId);
      const all = displayOptions.hideCompleted ? allRaw.filter((task) => !task.done) : allRaw;
      visibleTasks = all;
      if (allRaw.length && !all.length && displayOptions.hideCompleted) {
        main.appendChild(this.renderFilteredEmptyState());
      } else if (!allRaw.length && list?.system) {
        main.appendChild(this.renderViewState({
          kind: "empty",
          icon: "inbox",
          title: "这个清单还没有任务",
          description: "添加第一条任务后，它会显示在这里。",
          actionLabel: "添加任务",
          onAction: () => this.startCenterComposer(list, null, this.selectedListId),
        }));
      } else if (list?.system && viewMode === "board") {
        main.appendChild(this.renderSmartBoardView(all, "inbox"));
      } else if (list?.system && viewMode === "timeline") {
        main.appendChild(this.renderTimelineView(all, list));
      } else if (list?.system) {
        if (this.currentGroupMode() === "time") {
          const pending = all.filter((task) => !task.done);
          const today = pending.filter((task) => task.dueDate === todayKey);
          const overdue = pending.filter((task) => task.dueDate && dayDiff(task.dueDate) < 0);
          const later = pending.filter((task) => task.dueDate && dayDiff(task.dueDate) > 0);
          const noDate = pending.filter((task) => !task.dueDate);
          const done = all.filter((task) => task.done);
          this.renderSection("已过期", overdue, main, { draggable: true });
          this.renderSection("今天", today, main, { always: true, draggable: true, dropConfig: { preserveContainer: true, sameSectionOnly: false, patch: { dueDate: todayKey }, label: "今天" } });
          this.renderSection("稍后", later, main, { draggable: true });
          this.renderSection("无日期", noDate, main, { draggable: true, dropConfig: { preserveContainer: true, sameSectionOnly: false, patch: { dueDate: "", dueTime: "", endTime: "" }, label: "无日期" } });
          if (!displayOptions.hideCompleted) this.renderSection("已完成", done, main, { draggable: true });
        } else this.renderOptionGroupedTasks(all, main, { list, draggable: true });
      } else if (viewMode === "board") {
        main.appendChild(this.renderBoardView(all, list));
      } else if (viewMode === "timeline") {
        main.appendChild(this.renderTimelineView(all, list));
      } else if (this.currentGroupMode(list) === "group") {
        main.appendChild(this.renderGroupedListView(all, list));
      } else {
        this.renderOptionGroupedTasks(all, main, { list, draggable: true });
      }
    }

    // Changing grouping or view must not strand an unfinished column draft.
    if (this.centerComposerDraft && this.centerComposerContext?.viewKey === this.selectedListId && !main.querySelector(".today-center-composer")) {
      const targetList = this.store.getList(this.centerComposerContext.listId);
      this.centerComposerContext.slot = "main";
      this.centerComposerFocusPending = true;
      main.querySelector(".today-center-quick-add")?.remove();
      const composer = this.renderCenterComposer(targetList, this.centerComposerContext.groupId);
      composer.dataset.composerSlot = "main";
      mainHead.after(composer);
    }

    // Keep a selected subtask open in the docked Content pane when its parent
    // task is visible in the current list. Subtasks are intentionally excluded
    // from top-level `visibleTasks`, so checking only the selected id used to
    // clear the selection immediately after clicking a child row.
    if (this.selectedTaskId) {
      const selectedTask = this.store.getTask(this.selectedTaskId);
      const visibleIds = new Set(visibleTasks.map((task) => task.id));
      let selectionBelongsToVisibleTree = !!selectedTask && visibleIds.has(selectedTask.id);
      let ancestorId = selectedTask?.parentTaskId || null;
      const seenAncestors = new Set();
      while (!selectionBelongsToVisibleTree && ancestorId && !seenAncestors.has(ancestorId)) {
        seenAncestors.add(ancestorId);
        if (visibleIds.has(ancestorId)) {
          selectionBelongsToVisibleTree = true;
          break;
        }
        ancestorId = this.store.getTask(ancestorId)?.parentTaskId || null;
      }
      if (!selectionBelongsToVisibleTree) this.selectedTaskId = null;
    }
    // The persistent right Content document belongs to list view only.
    // Board and timeline keep their spatial canvas full-width and open the
    // compact anchored task editor instead.
    this.detailTaskIds = this.visibleTaskIds(main);
    const detailPane = viewMode === "list" ? this.renderDockedTaskDetail() : null;
    if (detailPane) panel.classList.add("has-detail");
    if (viewMode === "timeline") panel.classList.add("is-timeline");
    if (viewMode === "board") panel.classList.add("is-board");

    panel.append(sidebar, main);
    if (detailPane) panel.appendChild(detailPane);
    this.installTaskKeyboardNavigation(main);
    this.installColumnResizers(panel, sidebar, main, detailPane);
    return panel;
  }

  installColumnResizers(panel, sidebar, main, detailPane) {
    const doc = panel.ownerDocument;
    const settings = this.plugin.data.settings || {};
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    let sidebarWidth = clamp(Number(settings.centerSidebarWidth) || 250, 180, 420);
    let detailWidth = clamp(Number(settings.centerDetailWidth) || 360, 250, 640);
    let disposed = false;
    let dragging = false;
    let activeHandle = null;
    let activePointerId = null;
    let cleanupDrag = null;

    const leftHandle = doc.createElement("div");
    leftHandle.className = "today-center-resizer today-center-resizer-sidebar";
    leftHandle.tabIndex = 0;
    leftHandle.setAttribute("role", "separator");
    leftHandle.setAttribute("aria-orientation", "vertical");
    leftHandle.setAttribute("aria-label", "调整清单栏宽度");
    leftHandle.title = "拖动调整清单栏宽度，双击恢复默认";
    panel.appendChild(leftHandle);

    const rightHandle = detailPane ? doc.createElement("div") : null;
    if (rightHandle) {
      rightHandle.className = "today-center-resizer today-center-resizer-detail";
      rightHandle.tabIndex = 0;
      rightHandle.setAttribute("role", "separator");
      rightHandle.setAttribute("aria-orientation", "vertical");
      rightHandle.setAttribute("aria-label", "调整详情栏宽度");
      rightHandle.title = "拖动调整详情栏宽度，双击恢复默认";
      panel.appendChild(rightHandle);
    }

    const measuredScale = () => {
      const logical = Math.max(1, panel.clientWidth || panel.offsetWidth || 1);
      const visual = Math.max(1, panel.getBoundingClientRect().width || logical);
      return clamp(visual / logical, 0.5, 3);
    };

    const saveWidths = async () => {
      settings.centerSidebarWidth = Math.round(sidebarWidth);
      settings.centerDetailWidth = Math.round(detailWidth);
      try {
        await this.plugin.saveData(this.plugin.data);
      } catch (error) {
        console.error("Today: failed to save center column widths", error);
      }
    };

    const apply = () => {
      if (disposed) return;
      const visualWidth = panel.getBoundingClientRect().width || panel.clientWidth || 0;
      const hasDetail = !!detailPane;
      const inlineDetail = hasDetail && visualWidth >= 1040;
      const twoColumns = visualWidth >= 620;
      panel.classList.toggle("today-center-detail-below", hasDetail && !inlineDetail && twoColumns);
      panel.classList.toggle("today-center-columns-stacked", !twoColumns);

      if (!twoColumns) {
        panel.style.setProperty("grid-template-columns", "minmax(0, 1fr)", "important");
        panel.style.setProperty("grid-template-rows", "auto", "important");
      } else if (inlineDetail) {
        panel.style.setProperty(
          "grid-template-columns",
          sidebarWidth + "px minmax(0, 1fr) " + detailWidth + "px",
          "important",
        );
        panel.style.setProperty("grid-template-rows", "minmax(0, 1fr)", "important");
      } else {
        panel.style.setProperty("grid-template-columns", sidebarWidth + "px minmax(0, 1fr)", "important");
        panel.style.setProperty("grid-template-rows", "minmax(0, 1fr) auto", "important");
      }

      leftHandle.hidden = !twoColumns;
      leftHandle.style.left = sidebarWidth + "px";
      leftHandle.setAttribute("aria-valuemin", "180");
      leftHandle.setAttribute("aria-valuemax", "420");
      leftHandle.setAttribute("aria-valuenow", String(Math.round(sidebarWidth)));
      leftHandle.setAttribute("aria-valuetext", Math.round(sidebarWidth) + " 像素");

      if (rightHandle) {
        rightHandle.hidden = !inlineDetail;
        // Anchor both splitters by their visual centre. Using `right` together
        // with translateX(-50%) shifted the detail splitter several pixels
        // into the task column; `left: calc(100% - width)` keeps it exactly
        // on the grid boundary.
        rightHandle.style.left = `calc(100% - ${detailWidth}px)`;
        rightHandle.style.right = "auto";
        rightHandle.setAttribute("aria-valuemin", "250");
        rightHandle.setAttribute("aria-valuemax", "640");
        rightHandle.setAttribute("aria-valuenow", String(Math.round(detailWidth)));
        rightHandle.setAttribute("aria-valuetext", Math.round(detailWidth) + " 像素");
      }
    };

    const startDrag = (event, kind, handle) => {
      if (event.button !== 0 || dragging || handle.hidden) return;
      event.preventDefault();
      event.stopPropagation();
      dragging = true;
      activeHandle = handle;
      activePointerId = event.pointerId;
      const scale = measuredScale();
      const startX = event.clientX;
      const startSidebar = (sidebar.getBoundingClientRect().width || sidebarWidth) / scale;
      const startDetail = detailPane ? (detailPane.getBoundingClientRect().width || detailWidth) / scale : detailWidth;
      const startValues = { sidebar: sidebarWidth, detail: detailWidth };
      const body = doc.body;
      body.classList.add("today-is-resizing-columns");
      handle.classList.add("is-dragging");

      const finish = (cancel = false) => {
        if (!dragging) return;
        dragging = false;
        body.classList.remove("today-is-resizing-columns");
        handle.classList.remove("is-dragging");
        if (cancel) {
          sidebarWidth = startValues.sidebar;
          detailWidth = startValues.detail;
          apply();
        } else {
          void saveWidths();
        }
        if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        cleanupDrag?.();
        cleanupDrag = null;
        activeHandle = null;
        activePointerId = null;
      };

      const move = (moveEvent) => {
        if (!dragging) return;
        const delta = (moveEvent.clientX - startX) / scale;
        if (kind === "sidebar") sidebarWidth = clamp(startSidebar + delta, 180, 420);
        else detailWidth = clamp(startDetail - delta, 250, 640);
        apply();
      };
      const up = () => finish(false);
      const cancel = () => finish(true);
      const keydown = (keyEvent) => {
        if (keyEvent.key === "Escape") {
          keyEvent.preventDefault();
          finish(true);
        }
      };
      doc.addEventListener("pointermove", move);
      doc.addEventListener("pointerup", up, { once: true });
      doc.addEventListener("pointercancel", cancel, { once: true });
      doc.addEventListener("keydown", keydown);
      cleanupDrag = () => {
        doc.removeEventListener("pointermove", move);
        doc.removeEventListener("pointerup", up);
        doc.removeEventListener("pointercancel", cancel);
        doc.removeEventListener("keydown", keydown);
      };
      handle.setPointerCapture?.(event.pointerId);
    };

    const handleKey = (event, kind) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      const step = event.shiftKey ? 40 : 10;
      if (kind === "sidebar") {
        if (event.key === "Home") sidebarWidth = 180;
        else if (event.key === "End") sidebarWidth = 420;
        else sidebarWidth = clamp(sidebarWidth + (event.key === "ArrowRight" ? step : -step), 180, 420);
      } else {
        if (event.key === "Home") detailWidth = 250;
        else if (event.key === "End") detailWidth = 640;
        else detailWidth = clamp(detailWidth + (event.key === "ArrowLeft" ? step : -step), 250, 640);
      }
      apply();
      void saveWidths();
    };

    const reset = (event, kind) => {
      event.preventDefault();
      if (kind === "sidebar") sidebarWidth = 250;
      else detailWidth = 360;
      apply();
      void saveWidths();
    };

    leftHandle.addEventListener("pointerdown", (event) => startDrag(event, "sidebar", leftHandle));
    leftHandle.addEventListener("keydown", (event) => handleKey(event, "sidebar"));
    leftHandle.addEventListener("dblclick", (event) => reset(event, "sidebar"));
    if (rightHandle) {
      rightHandle.addEventListener("pointerdown", (event) => startDrag(event, "detail", rightHandle));
      rightHandle.addEventListener("keydown", (event) => handleKey(event, "detail"));
      rightHandle.addEventListener("dblclick", (event) => reset(event, "detail"));
    }

    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(apply) : null;
    observer?.observe(panel);
    const frame = requestAnimationFrame(apply);
    this.refreshCenterColumns = apply;
    this.columnResizeCleanup = () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      cleanupDrag?.();
      if (activeHandle && activePointerId != null && activeHandle.hasPointerCapture?.(activePointerId)) {
        activeHandle.releasePointerCapture(activePointerId);
      }
      doc.body.classList.remove("today-is-resizing-columns");
      leftHandle.remove();
      rightHandle?.remove();
      if (this.refreshCenterColumns === apply) this.refreshCenterColumns = null;
      if (this.columnResizeCleanup) this.columnResizeCleanup = null;
    };
  }

  clearTaskDropHost(host = null, { removeIndicator = false } = {}) {
    const state = this.taskDragState;
    const active = state?.activeDropHost || null;
    const target = host || active;
    if (target) {
      target.classList?.remove("is-drop-target");
      const kind = state?.activeDropKind === "board" ? "board" : "list";
      target.closest?.(kind === "board" ? ".today-center-board-col" : ".today-center-list-group-block")?.classList.remove("is-drop-parent");
    }
    if (!host || active === host) {
      if (state) {
        state.activeDropHost = null;
        state.activeDropKind = null;
        state.dropPlacement = null;
        state.dropPlacementKey = "";
        if (state.scrollHost === target) state.scrollHost = null;
      }
      if (removeIndicator) {
        this.taskDropIndicatorEl?.remove();
        this.taskDropIndicatorEl = null;
      }
    }
  }

  activateTaskDropHost(host, kind = "list") {
    const state = this.taskDragState;
    if (!state || !host) return;
    if (this.taskDragLeaveTimer) {
      window.clearTimeout(this.taskDragLeaveTimer);
      this.taskDragLeaveTimer = 0;
    }
    if (state.activeDropHost && state.activeDropHost !== host) this.clearTaskDropHost(state.activeDropHost);
    state.activeDropHost = host;
    state.activeDropKind = kind;
    host.classList.add("is-drop-target");
    host.closest?.(kind === "board" ? ".today-center-board-col" : ".today-center-list-group-block")?.classList.add("is-drop-parent");
  }

  scheduleTaskDropHostClear(host) {
    if (this.taskDragLeaveTimer) window.clearTimeout(this.taskDragLeaveTimer);
    this.taskDragLeaveTimer = window.setTimeout(() => {
      this.taskDragLeaveTimer = 0;
      const state = this.taskDragState;
      if (!state || state.activeDropHost !== host || !host?.isConnected) return;
      const rect = host.getBoundingClientRect();
      const x = state.pointerX;
      const y = state.pointerY;
      const stillInside = Number.isFinite(x) && Number.isFinite(y)
        && x >= rect.left - 6 && x <= rect.right + 6
        && y >= rect.top - 6 && y <= rect.bottom + 6;
      if (!stillInside) this.clearTaskDropHost(host, { removeIndicator: true });
    }, 110);
  }

  stopTaskDragAutoScroll() {
    if (this.taskDragAutoScrollFrame) cancelAnimationFrame(this.taskDragAutoScrollFrame);
    this.taskDragAutoScrollFrame = 0;
  }

  startTaskDragAutoScroll() {
    if (this.taskDragAutoScrollFrame || !this.taskDragState) return;
    const speedForEdge = (value, min, max, edge, maxSpeed) => {
      if (value < min + edge) return -Math.ceil(maxSpeed * Math.min(1, (min + edge - value) / edge));
      if (value > max - edge) return Math.ceil(maxSpeed * Math.min(1, (value - (max - edge)) / edge));
      return 0;
    };
    const tick = () => {
      this.taskDragAutoScrollFrame = 0;
      const state = this.taskDragState;
      if (!state) return;
      const host = state.activeDropHost || state.scrollHost;
      const x = state.pointerX;
      const y = state.pointerY;
      let moved = false;
      if (host && Number.isFinite(y)) {
        const vertical = host.closest?.(".today-center-main");
        if (vertical) {
          const rect = vertical.getBoundingClientRect();
          const delta = speedForEdge(y, rect.top, rect.bottom, 58, 18);
          if (delta) {
            const before = vertical.scrollTop;
            vertical.scrollTop += delta;
            moved = moved || vertical.scrollTop !== before;
          }
        }
        const board = state.activeDropKind === "board" ? host.closest?.(".today-center-board") : null;
        if (board && Number.isFinite(x) && board.scrollWidth > board.clientWidth + 2) {
          const rect = board.getBoundingClientRect();
          const delta = speedForEdge(x, rect.left, rect.right, 72, 20);
          if (delta) {
            const before = board.scrollLeft;
            board.scrollLeft += delta;
            moved = moved || board.scrollLeft !== before;
          }
        }
        if (moved && state.activeDropHost?.isConnected && Number.isFinite(y)) {
          this.updateTaskDropIndicator(state.activeDropHost, y, state.activeDropKind || "list", { fromAutoScroll: true });
        }
      }
      if (this.taskDragState) this.taskDragAutoScrollFrame = requestAnimationFrame(tick);
    };
    this.taskDragAutoScrollFrame = requestAnimationFrame(tick);
  }

  cleanupTaskDragVisuals({ clearState = true } = {}) {
    this.stopTaskDragAutoScroll();
    if (this.taskDragLeaveTimer) { window.clearTimeout(this.taskDragLeaveTimer); this.taskDragLeaveTimer = 0; }
    this.clearTaskDropHost(null, { removeIndicator: true });
    const root = this.contentEl;
    root?.querySelectorAll?.(".is-dragging, .is-drop-target, .is-drop-parent").forEach((el) => el.classList.remove("is-dragging", "is-drop-target", "is-drop-parent"));
    document.body?.classList?.remove("today-task-dragging");
    document.querySelectorAll?.(".today-task-drag-ghost").forEach((el) => el.remove());
    if (clearState) this.taskDragState = null;
  }

  installTaskDraggable(element, task, kind = "list") {
    if (!element || !task) return;
    element.classList.add("is-draggable");
    element.draggable = true;
    let blockedByControl = false;
    element.addEventListener("pointerdown", (event) => {
      blockedByControl = !!event.target?.closest?.("button, input, textarea, select, a, [contenteditable='true']");
    });
    element.addEventListener("pointerup", () => { blockedByControl = false; });
    element.addEventListener("dragstart", (event) => {
      if (blockedByControl) { event.preventDefault(); return; }
      this.cleanupTaskDragVisuals();
      this.taskDragState = {
        taskId: task.id,
        kind,
        sourceEl: element,
        sourceGroupKey: element.closest?.(".today-center-board-col")?.dataset?.groupKey || "",
        sourceDropHost: element.closest?.(".today-task-drop-zone") || element.parentElement || null,
        sourceDropKey: element.closest?.(".today-task-drop-zone")?.dataset?.todayDropKey || "",
        activeDropHost: null,
        activeDropKind: null,
        dropPlacement: null,
        pointerX: event.clientX,
        pointerY: event.clientY,
        lastDragClientY: event.clientY,
        scrollHost: null,
      };
      this.suppressTaskClickUntil = Date.now() + 900;
      element.classList.add("is-dragging");
      document.body?.classList?.add("today-task-dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", `today-task:${task.id}`);
        const ghost = document.createElement("div");
        ghost.className = `today-task-drag-ghost is-${kind}`;
        const sourceRect = element.getBoundingClientRect();
        ghost.style.width = `${Math.min(kind === "board" ? 286 : 360, Math.max(190, sourceRect.width))}px`;
        ghost.append(this.makeIcon("grip-vertical", "today-task-drag-ghost-icon"), document.createTextNode(task.title || "任务"));
        document.body.appendChild(ghost);
        event.dataTransfer.setDragImage(ghost, Math.min(22, sourceRect.width * .12), Math.min(18, sourceRect.height * .45));
      }
    });
    element.addEventListener("dragend", () => {
      this.suppressTaskClickUntil = Date.now() + 220;
      this.cleanupTaskDragVisuals();
    });
  }

  ensureTaskDropIndicator(kind = "list") {
    if (!this.taskDropIndicatorEl) {
      const indicator = document.createElement("div");
      indicator.className = "today-task-drop-indicator";
      indicator.setAttribute("aria-hidden", "true");
      this.taskDropIndicatorEl = indicator;
    }
    this.taskDropIndicatorEl.classList.toggle("is-board", kind === "board");
    return this.taskDropIndicatorEl;
  }

  updateTaskDropIndicator(host, clientY, kind = "list", { fromAutoScroll = false } = {}) {
    const state = this.taskDragState;
    if (!state || !host) return { previousTaskId: null, beforeTaskId: null };
    const items = [...host.children].filter((child) => child?.dataset?.todayTaskId && child.dataset.todayTaskId !== state.taskId && !child.classList.contains("today-center-search-hidden"));
    const lastY = Number.isFinite(state.lastDragClientY) ? state.lastDragClientY : clientY;
    const direction = fromAutoScroll ? 0 : Math.sign(clientY - lastY);
    const hysteresis = direction === 0 ? 0 : 5;
    let beforeEl = null;
    for (const item of items) {
      const rect = item.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      const threshold = midpoint + (direction > 0 ? hysteresis : direction < 0 ? -hysteresis : 0);
      if (clientY < threshold) { beforeEl = item; break; }
    }
    if (!fromAutoScroll) state.lastDragClientY = clientY;
    const beforeIndex = beforeEl ? items.indexOf(beforeEl) : items.length;
    const previousEl = beforeIndex > 0 ? items[beforeIndex - 1] : null;
    const indicator = this.ensureTaskDropIndicator(kind);
    const placement = {
      previousTaskId: previousEl?.dataset?.todayTaskId || null,
      beforeTaskId: beforeEl?.dataset?.todayTaskId || null,
    };
    const placementKey = `${host.dataset.todayDropKey || "host"}::${placement.previousTaskId || "start"}::${placement.beforeTaskId || "end"}`;
    const placementChanged = state.dropPlacementKey !== placementKey || indicator.parentElement !== host;
    if (placementChanged) {
      if (beforeEl) {
        if (indicator.parentElement !== host || indicator.nextElementSibling !== beforeEl) host.insertBefore(indicator, beforeEl);
      } else {
        const empty = [...host.children].find((child) => child.classList?.contains("today-center-board-empty") || child.classList?.contains("today-center-group-empty"));
        const desiredBefore = empty || null;
        if (indicator.parentElement !== host || indicator.nextElementSibling !== desiredBefore) {
          if (empty) host.insertBefore(indicator, empty); else host.appendChild(indicator);
        }
      }
      state.dropPlacementKey = placementKey;
    }
    state.dropPlacement = placement;
    return placement;
  }

  updateTaskDragPointer(event, host, kind = "list") {
    const state = this.taskDragState;
    if (!state) return;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    state.scrollHost = host;
    state.activeDropKind = kind;
    this.startTaskDragAutoScroll();
  }

  taskIdsInDropHost(host) {
    if (!host) return [];
    return [...host.children]
      .map((child) => child?.dataset?.todayTaskId || "")
      .filter(Boolean);
  }

  affectedTaskIdsForDrop(state, targetHost, placement) {
    const affected = new Set();
    if (!state || !targetHost) return affected;
    const taskId = state.taskId;
    const sourceHost = state.sourceDropHost;
    const sourceOld = this.taskIdsInDropHost(sourceHost);
    const targetOld = sourceHost === targetHost ? sourceOld : this.taskIdsInDropHost(targetHost);

    const insert = (ids) => {
      const next = ids.filter((id) => id !== taskId);
      let index = next.length;
      if (placement?.beforeTaskId) {
        const found = next.indexOf(placement.beforeTaskId);
        if (found >= 0) index = found;
      } else if (placement?.previousTaskId) {
        const found = next.indexOf(placement.previousTaskId);
        if (found >= 0) index = found + 1;
      }
      next.splice(index, 0, taskId);
      return next;
    };
    const collectMoved = (before, after) => {
      const beforeIndex = new Map(before.map((id, index) => [id, index]));
      const afterIndex = new Map(after.map((id, index) => [id, index]));
      for (const id of new Set([...before, ...after])) {
        if (!id || id === taskId) continue;
        if (beforeIndex.get(id) !== afterIndex.get(id)) affected.add(id);
      }
    };

    if (sourceHost === targetHost) {
      collectMoved(sourceOld, insert(sourceOld));
    } else {
      collectMoved(sourceOld, sourceOld.filter((id) => id !== taskId));
      collectMoved(targetOld, insert(targetOld));
    }
    return affected;
  }

  seedManualOrderFromDom() {
    const root = this.contentEl?.querySelector?.(".today-center-main");
    if (!root) return;
    const seen = new Set();
    let order = 0;
    for (const node of root.querySelectorAll("[data-today-task-id]")) {
      const id = node.dataset.todayTaskId;
      if (!id || seen.has(id)) continue;
      const task = this.store.getTask(id);
      if (!task) continue;
      seen.add(id);
      task.sortOrder = order;
      order += 1000;
    }
    this.listViewOptions.sort = "manual";
    this.listViewOptions.order = "asc";
  }

  resolveBoardDragTarget(task, { group, list = null, mode = "group" } = {}) {
    if (!task || !group) return { allowed: false };
    const sourceKey = this.taskDragState?.sourceGroupKey || "";
    const sameBucketOnly = () => ({
      allowed: sourceKey === group.id,
      listId: task.listId,
      groupId: task.groupId || null,
      patch: {},
      label: group.name,
    });
    if (mode === "group") {
      const listId = group.listId || list?.id || task.listId;
      return { allowed: !!listId, listId, groupId: group.groupId || null, patch: {}, label: group.name };
    }
    if (mode === "list") {
      return group.listId
        ? { allowed: true, listId: group.listId, groupId: null, patch: {}, label: group.name }
        : { allowed: false };
    }
    if (mode === "priority") {
      return { allowed: Number.isFinite(Number(group.priority)), listId: task.listId, groupId: task.groupId || null, patch: { priority: Number(group.priority || 0) }, label: group.name };
    }
    if (mode === "time") {
      // Time buckets are semantic destinations. Moving out of “已完成” resumes
      // the task; moving into it completes the task. Date buckets therefore
      // update both scheduling and completion state rather than only dueDate.
      if (group.id === "time-done") {
        return { allowed: true, listId: task.listId, groupId: task.groupId || null, patch: { done: true }, label: group.name };
      }
      if (group.id === "time-none") {
        return { allowed: true, listId: task.listId, groupId: task.groupId || null, patch: { dueDate: "", dueTime: "", endTime: "", done: false }, label: group.name };
      }
      if (group.dueDate) {
        return { allowed: true, listId: task.listId, groupId: task.groupId || null, patch: { dueDate: group.dueDate, done: false }, label: group.name };
      }
      return sameBucketOnly();
    }
    if (mode === "none") return { allowed: true, listId: task.listId, groupId: task.groupId || null, patch: {}, label: group.name };
    // Created/tag buckets are projections rather than writable containers. Keep
    // intra-column manual sorting but do not silently mutate those properties.
    return sameBucketOnly();
  }

  installTaskDropZone(host, config = {}) {
    if (!host) return;
    host.classList.add("today-task-drop-zone");
    if (!host.dataset.todayDropKey) host.dataset.todayDropKey = config.dropKey || `drop-${++this.taskDropKeySeed}`;
    const kind = config.kind === "board" ? "board" : "list";
    const descriptor = () => {
      const state = this.taskDragState;
      const task = this.store.getTask(state?.taskId);
      if (!task) return { allowed: false };
      if (config.sameSectionOnly && state?.sourceDropKey && state.sourceDropKey !== host.dataset.todayDropKey) return { allowed: false };
      if (kind === "board") return this.resolveBoardDragTarget(task, config);
      const preserveContainer = !!config.preserveContainer;
      const targetListId = preserveContainer ? (config.listId || task.listId) : config.listId;
      const targetGroupId = config.groupId !== undefined
        ? (config.groupId || null)
        : (preserveContainer ? (task.groupId || null) : null);
      return {
        allowed: !!targetListId,
        listId: targetListId,
        groupId: targetGroupId,
        patch: config.patch || {},
        label: config.label || this.store.getGroup(targetListId, targetGroupId)?.name || this.store.getList(targetListId)?.name || "目标位置",
      };
    };
    host.addEventListener("dragover", (event) => {
      if (!this.taskDragState) return;
      const target = descriptor();
      if (!target.allowed) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      this.activateTaskDropHost(host, kind);
      this.updateTaskDragPointer(event, host, kind);
      this.updateTaskDropIndicator(host, event.clientY, kind);
    });
    host.addEventListener("dragleave", (event) => {
      if (host.contains(event.relatedTarget)) return;
      this.scheduleTaskDropHostClear(host);
    });
    host.addEventListener("drop", async (event) => {
      if (!this.taskDragState) return;
      const target = descriptor();
      if (!target.allowed) return;
      event.preventDefault();
      event.stopPropagation();
      const taskId = this.taskDragState.taskId;
      this.updateTaskDragPointer(event, host, kind);
      const placement = this.updateTaskDropIndicator(host, event.clientY, kind);
      const dragState = this.taskDragState;
      const affectedIds = this.affectedTaskIdsForDrop(dragState, host, placement);
      this.seedManualOrderFromDom();
      const task = this.store.getTask(taskId);
      if (!task) { this.cleanupTaskDragVisuals(); return; }
      const patchKeys = Object.keys(target.patch || {});
      const semanticChanged = task.listId !== target.listId || (task.groupId || null) !== (target.groupId || null) || patchKeys.some((key) => JSON.stringify(task[key]) !== JSON.stringify(target.patch[key]));
      const label = semanticChanged ? `已移动到「${target.label || "目标位置"}」` : "已调整任务顺序";
      this.cleanupTaskDragVisuals({ clearState: false });
      const layoutScope = this.contentEl?.querySelector?.(".today-center-main") || this.contentEl;
      const layoutBeforeDrop = this.plugin.motionController?.captureTaskLayoutByIds(affectedIds, layoutScope);
      this.plugin.motionController?.prepareTaskLayoutTransition(layoutBeforeDrop, taskId);
      await this.store.applyTaskDrag(taskId, {
        listId: target.listId,
        groupId: target.groupId,
        patch: target.patch || {},
        previousTaskId: placement.previousTaskId,
        beforeTaskId: placement.beforeTaskId,
        undoLabel: label,
      });
      this.taskDragState = null;
      this.suppressTaskClickUntil = Date.now() + 260;
    });
  }

  folderBuckets(folder, tasks, folderLists = this.folderLists(folder), { includeEmpty = true } = {}) {
    const buckets = folderLists.map((list, index) => ({
      id: list.id,
      name: list.name,
      listId: list.id,
      color: list.color || "neutral",
      order: index,
      tasks: tasks.filter((task) => task.listId === list.id),
      isFolderList: true,
    }));
    return includeEmpty ? buckets : buckets.filter((bucket) => bucket.tasks.length);
  }

  renderFolderGroupedListView(tasks, folder, folderLists = this.folderLists(folder)) {
    const wrap = document.createElement("div");
    wrap.className = "today-center-grouped-list today-center-folder-grouped-list";
    const buckets = this.folderBuckets(folder, tasks, folderLists, { includeEmpty: true });
    for (const bucket of buckets) {
      const list = this.store.data.lists.find((entry) => entry.id === bucket.listId);
      if (!list) continue;
      const head = document.createElement("div");
      head.className = "today-center-list-group-head is-folder-list";
      const left = document.createElement("div"); left.className = "today-center-list-group-title-wrap";
      const dot = this.makeListDot(list); dot.classList.add("today-center-list-group-dot");
      const name = document.createElement("span"); name.className = "today-center-list-group-title"; name.textContent = list.name;
      const count = document.createElement("span"); count.className = "today-center-list-group-count"; count.textContent = String(bucket.tasks.length);
      left.append(dot, name, count);
      const tools = document.createElement("div"); tools.className = "today-center-list-group-tools";
      const add = document.createElement("button"); add.type = "button"; add.title = `添加任务到 ${list.name}`; add.appendChild(this.makeIcon("plus", "today-center-action-icon")); add.addEventListener("click", () => this.startTaskComposer(list, null, `folder-list:${list.id}`));
      const more = document.createElement("button"); more.type = "button"; more.title = "清单菜单"; more.appendChild(this.makeIcon("ellipsis", "today-center-action-icon")); more.addEventListener("click", (event) => this.showListMenu(event, list));
      tools.append(add, more);
      head.append(left, tools);
      head.addEventListener("contextmenu", (event) => { event.preventDefault(); this.showListMenu(event, list); });
      const block = document.createElement("section");
      block.className = "today-center-list-group-block is-folder-list";
      block.appendChild(head);
      const taskHost = document.createElement("div");
      taskHost.className = "today-center-list-group-tasks";
      const composing = this.renderCenterComposerAt(taskHost, list, `folder-list:${list.id}`);
      if (!bucket.tasks.length && !composing) {
        const empty = document.createElement("div"); empty.className = "today-center-group-empty"; empty.textContent = "暂无任务"; taskHost.appendChild(empty);
      } else {
        for (const task of this.sortTasksForListView(bucket.tasks)) this.appendTaskWithExpandedSubtasks(taskHost, task, { groupMenuList: list, draggable: true });
      }
      this.installTaskDropZone(taskHost, { kind: "list", listId: list.id, groupId: null, label: list.name });
      block.appendChild(taskHost);
      wrap.appendChild(block);
    }
    return wrap;
  }

  renderFolderBoardView(tasks, folder, folderLists = this.folderLists(folder)) {
    const board = document.createElement("div");
    board.className = "today-center-board today-center-folder-board";
    const groupMode = this.currentGroupMode();
    let groups = groupMode === "list"
      ? this.folderBuckets(folder, tasks, folderLists, { includeEmpty: true }).map((bucket) => ({ ...bucket, id: `list-${bucket.listId}` }))
      : this.smartBoardBuckets(tasks, "folder");
    if (!groups.length) {
      const empty = document.createElement("div"); empty.className = "today-center-board-global-empty"; empty.textContent = "暂无任务"; board.appendChild(empty); return board;
    }
    for (const group of groups) {
      const targetList = groupMode === "list" ? this.store.data.lists.find((entry) => entry.id === group.listId) : null;
      const col = document.createElement("section");
      col.className = "today-center-board-col";
      col.dataset.groupKey = group.id;
      const head = document.createElement("div"); head.className = "today-center-board-head";
      const dot = document.createElement("span"); dot.className = "today-center-board-dot"; dot.style.background = this.boardColumnAccent(group);
      const title = document.createElement("span"); title.className = "today-center-board-title"; title.textContent = group.name;
      const count = document.createElement("span"); count.className = "today-center-board-count"; count.textContent = String(group.tasks.length);
      head.append(dot, title, count);
      if (groupMode === "list" && group.listId) {
        const list = this.store.data.lists.find((entry) => entry.id === group.listId);
        if (list) {
          const add = document.createElement("button"); add.type = "button"; add.className = "today-center-board-add"; add.title = `添加任务到 ${list.name}`; add.appendChild(this.makeIcon("plus", "today-center-action-icon")); add.addEventListener("click", () => this.startTaskComposer(list, null, `folder-list:${list.id}`)); head.appendChild(add);
        }
      }
      col.appendChild(head);
      const cards = document.createElement("div"); cards.className = "today-center-board-cards";
      const composing = this.renderCenterComposerAt(cards, targetList, `folder-list:${group.listId}`);
      for (const task of this.sortTasksForListView(group.tasks)) {
        const sourceList = this.store.data.lists.find((entry) => entry.id === task.listId) || null;
        const card = this.renderBoardTaskCard(task, { showSourceList: groupMode !== "list" });
        cards.appendChild(card);
      }
      if (!group.tasks.length && !composing) {
        const empty = document.createElement("div");
        empty.className = "today-center-board-empty";
        if (groupMode === "list" && group.listId) {
          const targetList = this.store.data.lists.find((entry) => entry.id === group.listId);
          empty.append(this.makeIcon("plus", "today-center-board-empty-icon"), document.createTextNode("添加任务"));
          empty.setAttribute("role", "button");
          empty.tabIndex = 0;
          const create = () => targetList && this.startTaskComposer(targetList, null, `folder-list:${targetList.id}`);
          empty.addEventListener("click", create);
          empty.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); create(); } });
        } else {
          empty.textContent = "暂无任务";
        }
        cards.appendChild(empty);
      }
      this.installTaskDropZone(cards, { kind: "board", group, list: null, mode: groupMode });
      col.appendChild(cards);
      board.appendChild(col);
    }
    return board;
  }

  folderTimelineContext(folder, folderLists = this.folderLists(folder)) {
    return {
      id: `folder:${folder.id}`,
      name: folder.name,
      _folderContext: true,
      folderId: folder.id,
      folderLists,
      timelineCollapsedGroups: folder.timelineCollapsedLists || [],
    };
  }

  timelineBuckets(context, tasks) {
    if (context?._folderContext) return this.folderBuckets(this.store.getFolder(context.folderId), tasks, context.folderLists || [], { includeEmpty: true });
    return this.groupBuckets(context, tasks);
  }

  renderGroupedListView(tasks, list) {
    const wrap = document.createElement("div");
    wrap.className = "today-center-grouped-list";
    const buckets = this.groupBuckets(list, tasks);
    if (!buckets.length) {
      wrap.appendChild(this.renderViewState({
        kind: "empty",
        icon: "list-todo",
        title: "这个清单还没有任务",
        description: "可以直接添加第一条任务。",
        actionLabel: "添加任务",
        onAction: () => this.startCenterComposer(list, null, this.selectedListId),
      }));
      return wrap;
    }
    for (const group of buckets) {
      const head = document.createElement("div");
      head.className = `today-center-list-group-head${group.pseudo ? " is-ungrouped" : ""}`;
      const left = document.createElement("div"); left.className = "today-center-list-group-title-wrap";
      const dot = document.createElement("span"); dot.className = "today-center-list-group-dot";
      const name = document.createElement("span"); name.className = "today-center-list-group-title"; name.textContent = group.name;
      const count = document.createElement("span"); count.className = "today-center-list-group-count"; count.textContent = String(group.tasks.length);
      left.append(dot, name, count);
      const tools = document.createElement("div"); tools.className = "today-center-list-group-tools";
      const add = document.createElement("button"); add.type = "button"; add.title = `添加任务到 ${group.name}`; add.appendChild(this.makeIcon("plus", "today-center-action-icon")); add.addEventListener("click", () => this.startTaskComposer(list, group.id, `list-group:${list.id}:${group.id || "none"}`));
      tools.appendChild(add);
      if (!group.pseudo) {
        const more = document.createElement("button"); more.type = "button"; more.title = "分组菜单"; more.appendChild(this.makeIcon("ellipsis", "today-center-action-icon")); more.addEventListener("click", (event) => this.showGroupMenu(event, list, group)); tools.appendChild(more);
        head.addEventListener("contextmenu", (event) => { event.preventDefault(); this.showGroupMenu(event, list, group); });
      }
      head.append(left, tools);
      const block = document.createElement("section");
      block.className = "today-center-list-group-block";
      block.appendChild(head);
      const taskHost = document.createElement("div");
      taskHost.className = "today-center-list-group-tasks";
      const composing = this.renderCenterComposerAt(taskHost, list, `list-group:${list.id}:${group.id || "none"}`);
      if (!group.tasks.length && !composing) {
        const empty = document.createElement("div"); empty.className = "today-center-group-empty"; empty.textContent = "暂无任务"; taskHost.appendChild(empty);
      } else {
        for (const task of this.sortTasksForListView(group.tasks)) this.appendTaskWithExpandedSubtasks(taskHost, task, { groupMenuList: list, draggable: true });
      }
      this.installTaskDropZone(taskHost, { kind: "list", listId: list.id, groupId: group.id || null, label: group.name });
      block.appendChild(taskHost);
      wrap.appendChild(block);
    }
    return wrap;
  }

  smartBoardBuckets(tasks, mode = "week", listContext = null) {
    const groupMode = this.currentGroupMode(listContext);
    const sorted = this.sortTasksForListView(tasks);
    const buckets = new Map();
    const add = (key, label, task, extra = {}) => {
      if (!buckets.has(key)) buckets.set(key, { id: key, name: label, tasks: [], pseudo: true, ...extra });
      buckets.get(key).tasks.push(task);
    };

    const createdBucket = (task) => {
      const stamp = Number(task.createdAt || 0);
      if (!stamp) return ["created-unknown", "未知创建时间", 99];
      const d = new Date(stamp);
      d.setHours(0, 0, 0, 0);
      const now = parseDateOnly(todayISO());
      const diff = Math.floor((now - d) / 86400000);
      if (diff <= 0) return ["created-today", "今天创建", 0];
      if (diff === 1) return ["created-yesterday", "昨天创建", 1];
      if (diff <= 7) return ["created-week", "过去7天", 2];
      if (diff <= 30) return ["created-month", "过去30天", 3];
      return ["created-older", "更早", 4];
    };

    if (groupMode === "none") {
      for (const task of sorted) add("all", "任务", task, { order: 0 });
    } else if (groupMode === "list") {
      const orderMap = new Map(this.store.data.lists.map((list, index) => [list.id, index]));
      for (const task of sorted) {
        const list = this.store.getList(task.listId);
        add(`list-${list?.id || "none"}`, list?.name || "无清单", task, {
          order: orderMap.get(list?.id) ?? 999,
          listId: list?.id || null,
          color: list?.color || "neutral",
        });
      }
    } else if (groupMode === "priority") {
      for (const task of sorted) {
        const p = Number(task.priority || 0);
        const label = p === 1 ? "高优先级" : p === 2 ? "中优先级" : p === 3 ? "低优先级" : "无优先级";
        const order = p === 1 ? 0 : p === 2 ? 1 : p === 3 ? 2 : 3;
        add(`priority-${p}`, label, task, { order, priority: p });
      }
    } else if (groupMode === "tag") {
      for (const task of sorted) {
        const tag = task.tags?.[0] || "";
        add(`tag-${tag || "none"}`, tag ? `#${tag}` : "无标签", task, { order: tag ? 0 : 999, tag });
      }
    } else if (groupMode === "created") {
      for (const task of sorted) {
        const [key, label, order] = createdBucket(task);
        add(key, label, task, { order });
      }
    } else {
      // Time grouping is deliberately semantic instead of just “one date = one
      // column”: overdue/completed/no-date remain stable lanes while future
      // dates retain their exact day.  This makes the same task set visibly move
      // when the user changes the grouping menu, matching TickTick's board.
      for (const task of sorted) {
        if (task.done) {
          add("time-done", "已完成", task, { order: 9000 });
          continue;
        }
        if (!task.dueDate) {
          add("time-none", "无日期", task, { order: 8000 });
          continue;
        }
        const diff = dayDiff(task.dueDate);
        if (diff < 0) {
          add("time-overdue", "已过期", task, { order: -1000 });
          continue;
        }
        const d = parseDateOnly(task.dueDate);
        const label = diff === 0 ? "今天" : diff === 1 ? "明天" : `${d.getMonth() + 1}月${d.getDate()}日`;
        add(`time-${task.dueDate}`, label, task, { order: diff, dueDate: task.dueDate });
      }
    }

    const out = [...buckets.values()];
    if (groupMode === "tag") {
      out.sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name, "zh-CN"));
    } else {
      out.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
    }
    return out;
  }

  boardBucketsForList(tasks, list) {
    const groupMode = this.currentGroupMode(list);

    // Inside a concrete list, the structural grouping is its persistent Group
    // layer (Folder → List → Group → Task).  Empty groups stay visible so the
    // board remains an organizer, not merely a projection of existing tasks.
    if (groupMode === "group") {
      return this.groupBuckets(list, tasks, { includeEmpty: true }).map((group, index) => ({
        ...group,
        tasks: this.sortTasksForListView(group.tasks),
        id: `group-${group.id || "none"}`,
        groupId: group.id || null,
        listId: list?.id || null,
        color: list?.color || "neutral",
        order: Number.isFinite(Number(group.order)) ? Number(group.order) : index,
      }));
    }

    const buckets = this.smartBoardBuckets(tasks, "week", list);
    if (buckets.length) return buckets;

    // Keep an empty custom-list board actionable. The fallback lane mirrors
    // the active display grouping so switching to Board never produces a dead
    // canvas with no place to create the first task.
    if (groupMode === "priority") {
      return [{ id: "priority-0", name: "无优先级", tasks: [], pseudo: true, order: 3, priority: 0 }];
    }
    if (groupMode === "tag") {
      return [{ id: "tag-none", name: "无标签", tasks: [], pseudo: true, order: 999, tag: "" }];
    }
    if (groupMode === "created") {
      return [{ id: "created-today", name: "今天创建", tasks: [], pseudo: true, order: 0 }];
    }
    if (groupMode === "none") {
      return [{ id: "all", name: "任务", tasks: [], pseudo: true, order: 0 }];
    }
    return [{ id: `time-${todayISO()}`, name: "今天", tasks: [], pseudo: true, order: 0, dueDate: todayISO() }];
  }

  boardColumnAccent(group) {
    if (group?.priority === 1) return "#ef5b5b";
    if (group?.priority === 2) return "#e39a16";
    if (group?.priority === 3) return "#5b73e6";
    if (group?.listId) {
      const list = this.store.getList(group.listId);
      const colors = { blue: "#5271df", violet: "#7867dc", green: "#49a36f", orange: "#e58a2b", neutral: "#9b9b9b" };
      return colors[list?.color || "neutral"] || "#8a78e8";
    }
    return "#8a78e8";
  }

  renderBoardTaskCard(task, { showSourceList = true } = {}) {
    const displayOptions = this.getListDisplayOptions();
    const card = document.createElement("article");
    card.className = `today-center-board-card priority-${task.priority || 0}`;
    if (task.done) card.classList.add("is-done");
    if (task.id === this.selectedTaskId) card.classList.add("is-selected");
    card.dataset.search = [task.title, task.content || "", ...(task.tags || [])].join(" ");
    card.dataset.todayTaskId = task.id;
    card.tabIndex = task.id === this.selectedTaskId ? 0 : -1;
    card.setAttribute("role", "option");
    card.setAttribute("aria-selected", task.id === this.selectedTaskId ? "true" : "false");
    card.title = "拖动排序或移动到其他列 · 单击或 Enter 打开任务详情";

    const top = document.createElement("div");
    top.className = "today-center-board-card-top";
    const check = document.createElement("button");
    check.type = "button";
    check.className = "today-center-board-card-check";
    check.setAttribute("aria-label", task.done ? `取消完成 ${task.title}` : `完成 ${task.title}`);
    if (task.done) {
      check.classList.add("is-done");
      setIcon(check, "check");
    }
    check.addEventListener("click", (event) => {
      event.stopPropagation();
      this.lastTaskClickId = null;
      this.lastTaskClickAt = 0;
      this.store.toggleTask(task.id);
    });
    const title = document.createElement("div");
    title.className = "today-center-board-card-title";
    title.textContent = task.title;
    top.append(check, title);
    card.appendChild(top);

    const presentation = this.taskContentPresentation(task);
    if (displayOptions.showDetails) {
      const preview = presentation.summary || (!displayOptions.hideChecklist && presentation.checklistTotal
        ? `检查事项 ${presentation.checklistDone}/${presentation.checklistTotal}`
        : "");
      if (preview) {
        const summary = document.createElement("div");
        summary.className = "today-center-board-card-summary";
        summary.textContent = preview;
        summary.title = preview;
        card.appendChild(summary);
      }
    }

    const meta = document.createElement("div");
    meta.className = "today-center-board-card-meta";
    if (task.dueDate) {
      const due = document.createElement("span");
      due.className = `today-center-board-card-due ${dayDiff(task.dueDate) < 0 && !task.done ? "is-overdue" : ""}`;
      due.textContent = compactTaskDateLabel(task);
      meta.appendChild(due);
    }
    const source = this.store.getList(task.listId);
    if (showSourceList && source) {
      const sourceEl = document.createElement("span");
      sourceEl.className = `today-center-board-card-list list-${source.color || "neutral"}`;
      const dot = this.makeListDot(source);
      dot.classList.add("today-center-board-card-list-dot");
      sourceEl.append(dot, document.createTextNode(source.name));
      meta.appendChild(sourceEl);
    }
    if (task.repeat) {
      const repeat = document.createElement("span");
      repeat.className = "today-center-board-card-repeat";
      repeat.title = repeatLabel(task);
      repeat.appendChild(this.makeIcon("repeat-2"));
      meta.appendChild(repeat);
    }
    const subtaskProgress = this.store.subtaskProgress(task.id);
    if (subtaskProgress.total) {
      const subtaskMeta = document.createElement("span");
      subtaskMeta.className = "today-center-board-card-subtasks";
      subtaskMeta.title = `子任务 ${subtaskProgress.done}/${subtaskProgress.total}`;
      subtaskMeta.append(this.makeIcon("git-branch"), document.createTextNode(`${subtaskProgress.done}/${subtaskProgress.total}`));
      meta.appendChild(subtaskMeta);
    }
    if (displayOptions.showDetails && !displayOptions.hideChecklist && presentation.checklistTotal) {
      const progress = document.createElement("span");
      progress.className = "today-center-board-card-checklist";
      progress.append(this.makeIcon("list-checks"), document.createTextNode(`${presentation.checklistDone}/${presentation.checklistTotal}`));
      meta.appendChild(progress);
    }
    if (meta.childNodes.length) card.appendChild(meta);

    card.addEventListener("contextmenu", (event) => {
      this.plugin.openTaskContextMenu(event, task, { anchor: card });
    });
    card.addEventListener("click", (event) => {
      event.stopPropagation();
      if (Date.now() < this.suppressTaskClickUntil) return;
      // Board cards are direct-entry surfaces, but the card should remain
      // visibly selected while its anchored task document is open. Update the
      // spatial selection in place first so we do not rerender the board or
      // disturb its scroll position, then open the detail surface.
      this.lastTaskClickId = null;
      this.lastTaskClickAt = 0;
      this.selectCenterTaskInPlace(task.id, card.closest(".today-center-main") || this.contentElSafe());
      this.plugin.openTaskDetail(task.id, card);
    });
    this.installTaskDraggable(card, task, "board");
    return card;
  }

  renderSmartBoardView(tasks, mode = "week") {
    const board = document.createElement("div");
    board.className = "today-center-board today-center-smart-board";
    const buckets = this.smartBoardBuckets(tasks, mode);
    if (!buckets.length) {
      board.appendChild(this.renderViewState({
        kind: "empty",
        icon: "columns-3",
        title: mode === "today" ? "今天没有待办" : "这里还没有任务",
        description: mode === "today" ? "今天可以轻一点，也可以添加一条新任务。" : "创建任务后会按当前分组显示在看板中。",
        compact: true,
        extraClass: "today-center-board-global-empty",
      }));
      return board;
    }
    for (const group of buckets) {
      const col = document.createElement("section");
      col.className = "today-center-board-col is-smart";
      col.dataset.groupKey = group.id;
      const head = document.createElement("div");
      head.className = "today-center-board-head";
      const dot = document.createElement("span");
      dot.className = "today-center-board-dot";
      dot.style.background = this.boardColumnAccent(group);
      const title = document.createElement("span");
      title.className = "today-center-board-title";
      title.textContent = group.name;
      const count = document.createElement("span");
      count.className = "today-center-board-count";
      count.textContent = String(group.tasks.length);
      head.append(dot, title, count);
      col.appendChild(head);

      const cards = document.createElement("div");
      cards.className = "today-center-board-cards";
      const boardMode = this.currentGroupMode();
      const hideSourceList = boardMode === "list";
      for (const task of this.sortTasksForListView(group.tasks)) cards.appendChild(this.renderBoardTaskCard(task, { showSourceList: !hideSourceList }));
      this.installTaskDropZone(cards, { kind: "board", group, list: null, mode: boardMode });
      col.appendChild(cards);
      board.appendChild(col);
    }
    return board;
  }

  renderBoardView(tasks, list) {
    const board = document.createElement("div");
    board.className = "today-center-board";

    // Board columns follow the same "分组" option as the list view.
    // For a concrete custom list, the structural option is the persistent
    // Group layer; aggregate views use source List as their structural option.
    const groups = this.boardBucketsForList(tasks, list);
    if (!groups.length) {
      board.appendChild(this.renderViewState({
        kind: "empty",
        icon: "columns-3",
        title: "这个看板还没有任务",
        description: "添加任务后会按当前分组显示在这里。",
        actionLabel: "添加任务",
        onAction: () => this.startTaskComposer(list, null),
        compact: true,
        extraClass: "today-center-board-global-empty",
      }));
      return board;
    }

    for (const group of groups) {
      const col = document.createElement("section");
      col.className = "today-center-board-col";
      col.dataset.groupKey = group.id;

      const head = document.createElement("div");
      head.className = "today-center-board-head";
      const dot = document.createElement("span");
      dot.className = "today-center-board-dot";
      dot.style.background = this.boardColumnAccent(group);
      const title = document.createElement("span");
      title.className = "today-center-board-title";
      title.textContent = group.name;
      const count = document.createElement("span");
      count.className = "today-center-board-count";
      count.textContent = String(group.tasks.length);
      head.append(dot, title, count);

      // Completed is a terminal lane, so creating directly into it is more
      // surprising than useful. Other dynamic lanes keep a compact + action
      // and inherit the lane's writable property where possible.
      if (group.id !== "time-done") {
        const add = document.createElement("button");
        add.type = "button";
        add.className = "today-center-board-add";
        add.title = `添加任务到 ${group.name}`;
        add.appendChild(this.makeIcon("plus", "today-center-action-icon"));
        add.addEventListener("click", () => this.startBoardTaskComposer(list, group));
        head.appendChild(add);
      }
      col.appendChild(head);

      const cards = document.createElement("div");
      cards.className = "today-center-board-cards";
      const composing = this.renderCenterComposerAt(cards, list, `board:${list.id}:${group.id}`);
      const boardMode = this.currentGroupMode(list);
      for (const task of this.sortTasksForListView(group.tasks)) {
        const card = this.renderBoardTaskCard(task, { showSourceList: false });
        cards.appendChild(card);
      }
      if (!group.tasks.length && !composing) {
        const empty = document.createElement("div");
        empty.className = "today-center-board-empty";
        empty.append(this.makeIcon("plus", "today-center-board-empty-icon"), document.createTextNode("添加任务"));
        empty.setAttribute("role", "button");
        empty.tabIndex = 0;
        empty.addEventListener("click", () => this.startBoardTaskComposer(list, group));
        empty.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); this.startBoardTaskComposer(list, group); }
        });
        cards.appendChild(empty);
      }
      this.installTaskDropZone(cards, { kind: "board", group, list, mode: boardMode });
      col.appendChild(cards);
      board.appendChild(col);
    }
    return board;
  }

  timelineWindow() {
    const anchor = parseDateOnly(this.timelineAnchorDate || todayISO()) || parseDateOnly(todayISO());
    anchor.setHours(0, 0, 0, 0);
    const units = [];
    let start;
    let columnMin = 86;

    if (this.timelineScale === "month") {
      start = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1);
      columnMin = 138;
      for (let index = 0; index < 8; index++) {
        const unitStart = new Date(start.getFullYear(), start.getMonth() + index, 1);
        const unitEnd = new Date(unitStart.getFullYear(), unitStart.getMonth() + 1, 1);
        units.push({
          start: unitStart,
          endExclusive: unitEnd,
          main: `${unitStart.getMonth() + 1}月`,
          sub: String(unitStart.getFullYear()),
        });
      }
    } else if (this.timelineScale === "week") {
      const mondayOffset = (anchor.getDay() + 6) % 7;
      start = new Date(anchor);
      start.setDate(anchor.getDate() - mondayOffset - 7);
      columnMin = 112;
      for (let index = 0; index < 10; index++) {
        const unitStart = new Date(start);
        unitStart.setDate(start.getDate() + index * 7);
        const unitEnd = new Date(unitStart);
        unitEnd.setDate(unitStart.getDate() + 7);
        const inclusiveEnd = new Date(unitEnd);
        inclusiveEnd.setDate(unitEnd.getDate() - 1);
        units.push({
          start: unitStart,
          endExclusive: unitEnd,
          main: `${unitStart.getMonth() + 1}/${unitStart.getDate()}–${inclusiveEnd.getMonth() + 1}/${inclusiveEnd.getDate()}`,
          sub: "周",
        });
      }
    } else {
      start = new Date(anchor);
      start.setDate(anchor.getDate() - 2);
      columnMin = 84;
      const names = ["日", "一", "二", "三", "四", "五", "六"];
      for (let index = 0; index < 14; index++) {
        const unitStart = new Date(start);
        unitStart.setDate(start.getDate() + index);
        const unitEnd = new Date(unitStart);
        unitEnd.setDate(unitStart.getDate() + 1);
        units.push({
          start: unitStart,
          endExclusive: unitEnd,
          main: `${unitStart.getMonth() + 1}/${unitStart.getDate()}`,
          sub: names[unitStart.getDay()],
          weekend: unitStart.getDay() === 0 || unitStart.getDay() === 6,
        });
      }
    }

    const endExclusive = new Date(units[units.length - 1].endExclusive);
    return { start, endExclusive, units, unitCount: units.length, columnMin };
  }

  timelineCoordinate(value, window) {
    const date = typeof value === "string" ? parseDateOnly(value) : new Date(value);
    if (!date) return -999;
    date.setHours(0, 0, 0, 0);
    if (this.timelineScale === "month") {
      const monthDiff = (date.getFullYear() - window.start.getFullYear()) * 12 + (date.getMonth() - window.start.getMonth());
      return monthDiff + (date.getDate() - 1) / daysInMonth(date.getFullYear(), date.getMonth());
    }
    const unitDays = this.timelineScale === "week" ? 7 : 1;
    return daysBetween(window.start, date) / unitDays;
  }

  timelineDateCenterCoordinate(value, window) {
    const date = typeof value === "string" ? parseDateOnly(value) : new Date(value);
    if (!date) return -999;
    date.setHours(0, 0, 0, 0);
    const start = this.timelineCoordinate(date, window);
    if (this.timelineScale === "month") {
      return start + 0.5 / daysInMonth(date.getFullYear(), date.getMonth());
    }
    return start + (this.timelineScale === "week" ? 0.5 / 7 : 0.5);
  }

  timelineDateAtCoordinate(coord, window) {
    const safe = Math.max(0, Math.min(window.unitCount - 0.0001, coord));
    if (this.timelineScale === "month") {
      const unitIndex = Math.floor(safe);
      const fraction = safe - unitIndex;
      const monthStart = new Date(window.start.getFullYear(), window.start.getMonth() + unitIndex, 1);
      const count = daysInMonth(monthStart.getFullYear(), monthStart.getMonth());
      const day = Math.min(count, Math.floor(fraction * count) + 1);
      return dateToISO(new Date(monthStart.getFullYear(), monthStart.getMonth(), day));
    }
    const unitDays = this.timelineScale === "week" ? 7 : 1;
    const date = new Date(window.start);
    date.setDate(window.start.getDate() + Math.floor(safe * unitDays));
    return dateToISO(date);
  }

  timelineTaskRange(task, window) {
    if (!task?.dueDate) return null;
    let startValue = task.startDate || task.dueDate;
    let endValue = task.dueDate;
    if (startValue > endValue) [startValue, endValue] = [endValue, startValue];

    // Tasks use inclusive calendar dates in storage, but lane packing works best
    // with half-open ranges: [start, end + 1 day). This means a task ending
    // on 9/2 and another starting on 9/3 are adjacent, not overlapping.
    const startDate = parseDateOnly(startValue);
    const endExclusiveDate = parseDateOnly(endValue);
    if (!startDate || !endExclusiveDate) return null;
    startDate.setHours(0, 0, 0, 0);
    endExclusiveDate.setHours(0, 0, 0, 0);
    endExclusiveDate.setDate(endExclusiveDate.getDate() + 1);

    const start = this.timelineCoordinate(startDate, window);
    const end = this.timelineCoordinate(endExclusiveDate, window);
    return {
      start,
      end,
      startValue,
      endValue,
      startMs: startDate.getTime(),
      endExclusiveMs: endExclusiveDate.getTime(),
    };
  }

  shiftTimeline(direction) {
    const anchor = parseDateOnly(this.timelineAnchorDate || todayISO()) || parseDateOnly(todayISO());
    if (this.timelineScale === "month") anchor.setMonth(anchor.getMonth() + direction * 4);
    else anchor.setDate(anchor.getDate() + direction * (this.timelineScale === "week" ? 28 : 7));
    this.timelineAnchorDate = dateToISO(anchor);
    this.render();
  }

  timelineGroupKey(group) {
    return group?.id || "__ungrouped__";
  }

  async toggleTimelineGroup(list, group) {
    const key = this.timelineGroupKey(group);
    const collapsed = new Set(list.timelineCollapsedGroups || []);
    collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key);
    if (list?._folderContext) {
      await this.store.updateFolder(list.folderId, { timelineCollapsedLists: [...collapsed] });
      return;
    }
    await this.store.updateList(list.id, { timelineCollapsedGroups: [...collapsed] });
  }

  closeTimelineQuickCreate() {
    if (this.timelineQuickCreateCleanup) {
      this.timelineQuickCreateCleanup();
      this.timelineQuickCreateCleanup = null;
    }
    this.timelineQuickCreateEl?.remove();
    this.timelineQuickCreateEl = null;
    document.querySelectorAll(".today-center-timeline-create-marker").forEach((el) => el.remove());
  }

  openTimelineQuickCreate(list, group, dueDate, event, track, windowData, rangeEndDate = "") {
    this.closeTimelineQuickCreate();

    const date = parseDateOnly(dueDate);
    if (!date) return;
    const rangeEnd = rangeEndDate && parseDateOnly(rangeEndDate) ? rangeEndDate : "";

    // Give the click an immediate visual anchor, similar to a provisional task bar.
    const marker = document.createElement("div");
    marker.className = "today-center-timeline-create-marker";
    const start = this.timelineCoordinate(date, windowData);
    const endDate = parseDateOnly(rangeEnd || dueDate) || new Date(date);
    endDate.setDate(endDate.getDate() + 1);
    const end = this.timelineCoordinate(endDate, windowData);
    const visibleStart = Math.max(0, start);
    const visibleEnd = Math.min(windowData.unitCount, end);
    marker.style.setProperty("--timeline-left", `${(visibleStart / windowData.unitCount) * 100}%`);
    marker.style.setProperty("--timeline-width", `${(Math.max(0.06, visibleEnd - visibleStart) / windowData.unitCount) * 100}%`);

    // Keep the provisional task in the row the user actually clicked instead of
    // always pinning it to the first visual row. The final task can still be
    // compacted by the normal overlap algorithm after creation.
    const trackRectAtOpen = track.getBoundingClientRect();
    const rowStep = 37;
    const taskOffset = Number(track.dataset.timelineTaskOffset || 0);
    const rowTop = 10 + (Number.isFinite(taskOffset) ? taskOffset : 0);
    const barHeight = 30;

    // The Task Center shell is transform-scaled (130% by default). Pointer
    // coordinates and getBoundingClientRect() are therefore in *visual* pixels,
    // while --timeline-top is expressed in the track's unscaled CSS pixels.
    // Mixing the two made a click on row N land on row N+1 at larger UI scales.
    const logicalTrackHeight = track.offsetHeight || track.clientHeight || trackRectAtOpen.height;
    const visualScaleY = logicalTrackHeight > 0 ? (trackRectAtOpen.height / logicalTrackHeight) : 1;
    const safeScaleY = Number.isFinite(visualScaleY) && visualScaleY > 0 ? visualScaleY : 1;
    const localClickY = Number.isFinite(event?.clientY)
      ? (event.clientY - trackRectAtOpen.top) / safeScaleY
      : rowTop + barHeight / 2;

    // Snap to the nearest visual task row by its center. This makes the small
    // gaps between rows behave naturally instead of always biasing downward.
    const firstRowCenter = rowTop + barHeight / 2;
    const rowCount = Math.max(1, Math.floor(Math.max(0, logicalTrackHeight - rowTop - 10) / rowStep) + 1);
    const clickedRow = Math.max(0, Math.min(rowCount - 1, Math.round((localClickY - firstRowCenter) / rowStep)));
    const maxMarkerTop = Math.max(rowTop, logicalTrackHeight - barHeight - 10);
    marker.style.setProperty("--timeline-top", `${Math.min(rowTop + clickedRow * rowStep, maxMarkerTop)}px`);
    track.appendChild(marker);

    const panel = document.createElement("div");
    panel.className = "today-center-timeline-quick-create";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "快速创建任务");

    const header = document.createElement("div");
    header.className = "today-center-timeline-quick-head";
    const dateWrap = document.createElement("div");
    dateWrap.className = "today-center-timeline-quick-date";
    dateWrap.appendChild(this.makeIcon("calendar-days", "today-center-timeline-quick-icon"));
    const dateText = document.createElement("span");
    const isToday = dueDate === todayISO();
    const rangeEndParsed = rangeEnd ? parseDateOnly(rangeEnd) : null;
    dateText.textContent = rangeEndParsed && rangeEnd !== dueDate
      ? `${date.getMonth() + 1}月${date.getDate()}日 – ${rangeEndParsed.getMonth() + 1}月${rangeEndParsed.getDate()}日`
      : `${date.getMonth() + 1}月${date.getDate()}日${isToday ? "，今天" : ""}`;
    dateWrap.appendChild(dateText);

    let priority = 0;
    const priorityButton = document.createElement("button");
    priorityButton.type = "button";
    priorityButton.className = "today-center-timeline-quick-priority";
    priorityButton.title = "设置优先级";
    priorityButton.appendChild(this.makeIcon("flag", "today-center-timeline-quick-flag"));
    const priorityStates = [0, 1, 2, 3];
    const updatePriority = () => {
      priorityButton.dataset.priority = String(priority);
      priorityButton.title = ["无优先级", "高优先级", "中优先级", "低优先级"][priority] || "优先级";
    };
    updatePriority();
    priorityButton.addEventListener("click", (e) => {
      e.stopPropagation();
      priority = priorityStates[(priorityStates.indexOf(priority) + 1) % priorityStates.length];
      updatePriority();
    });
    header.append(dateWrap, priorityButton);

    const input = document.createElement("textarea");
    input.className = "today-center-timeline-quick-input";
    input.rows = 2;
    input.placeholder = "准备做什么？";
    input.setAttribute("aria-label", "任务标题");

    const footer = document.createElement("div");
    footer.className = "today-center-timeline-quick-footer";
    const groupLabel = document.createElement("div");
    groupLabel.className = "today-center-timeline-quick-group";
    groupLabel.appendChild(this.makeIcon("rows-3", "today-center-timeline-quick-group-icon"));
    const groupText = document.createElement("span");
    groupText.textContent = group?.name || "未分组";
    groupLabel.appendChild(groupText);
    const enterHint = document.createElement("span");
    enterHint.className = "today-center-timeline-quick-enter";
    enterHint.textContent = "Enter 创建";
    footer.append(groupLabel, enterHint);

    panel.append(header, input, footer);

    // Keep the editor inside Obsidian's modal focus scope. Appending it to body
    // looks correct, but Obsidian's focus trap immediately pulls keyboard focus
    // back into the modal, which makes the textarea appear impossible to type in.
    this.modalEl.appendChild(panel);
    this.timelineQuickCreateEl = panel;

    const place = () => {
      const markerRect = marker.getBoundingClientRect();
      const modalRect = this.modalEl.getBoundingClientRect();
      const panelWidth = Math.min(390, Math.max(320, modalRect.width - 24));
      panel.style.width = `${panelWidth}px`;
      const panelHeight = panel.offsetHeight || 230;
      let left = markerRect.left - 4;
      let top = markerRect.bottom + 7;
      const minLeft = modalRect.left + 12;
      const maxLeft = modalRect.right - panelWidth - 12;
      const minTop = modalRect.top + 12;
      const maxBottom = modalRect.bottom - 12;
      left = Math.max(minLeft, Math.min(maxLeft, left));
      if (top + panelHeight > maxBottom) top = Math.max(minTop, markerRect.top - panelHeight - 7);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    };
    requestAnimationFrame(() => {
      place();
      input.focus({ preventScroll: true });
      try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) {}
      // A second focus on the next frame handles themes/plugins that re-focus
      // the modal immediately after a click.
      requestAnimationFrame(() => input.focus({ preventScroll: true }));
    });

    let submitting = false;
    const submit = async () => {
      if (submitting) return;
      const title = input.value.trim();
      if (!title) { this.closeTimelineQuickCreate(); return; }
      submitting = true;
      this.closeTimelineQuickCreate();
      const targetList = list?._folderContext ? this.store.data.lists.find((entry) => entry.id === group?.listId) : list;
      if (!targetList) return;
      await this.store.addTask({
        title,
        listId: targetList.id,
        groupId: list?._folderContext ? null : (group?.id || null),
        priority,
        startDate: rangeEnd && rangeEnd !== dueDate ? dueDate : "",
        dueDate: rangeEnd || dueDate,
        dueTime: "23:59",
        tags: [],
      });
    };

    const onPointerDown = (e) => {
      if (panel.contains(e.target)) return;
      // Clicking another timeline blank closes this editor first; the next click
      // handler will immediately open a new one at that date.
      if (input.value.trim()) submit();
      else this.closeTimelineQuickCreate();
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.closeTimelineQuickCreate();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    };
    const onResize = () => place();
    const stopEditorPointer = (e) => e.stopPropagation();
    panel.addEventListener("pointerdown", stopEditorPointer);
    panel.addEventListener("click", stopEditorPointer);
    input.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    document.addEventListener("pointerdown", onPointerDown, true);
    this.timelineQuickCreateCleanup = () => {
      panel.removeEventListener("pointerdown", stopEditorPointer);
      panel.removeEventListener("click", stopEditorPointer);
      input.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }

  async moveTimelineTask(task, group, dueDate) {
    if (!task || !dueDate) return;
    const oldStart = task.startDate || task.dueDate || dueDate;
    const duration = task.dueDate ? Math.max(1, daysBetween(oldStart, task.dueDate) + 1) : 1;
    const patch = {
      groupId: group?.isFolderList ? null : (group?.id || null),
      ...(group?.isFolderList && group?.listId ? { listId: group.listId } : {}),
      dueDate: addDays(dueDate, duration - 1),
      startDate: duration > 1 ? dueDate : "",
    };

    // A project/planning rail is a single visual object. When it is dragged,
    // keep its embedded phases and milestones attached to the parent instead
    // of leaving the planning annotations behind on the old dates.
    if (task.timelineRole === "project" && Array.isArray(task.timelineItems) && task.timelineItems.length) {
      const delta = daysBetween(oldStart, dueDate);
      if (delta) {
        patch.timelineItems = task.timelineItems.map((item) => {
          if (item.type === "milestone") {
            return { ...item, date: item.date ? addDays(item.date, delta) : item.date };
          }
          return {
            ...item,
            startDate: item.startDate ? addDays(item.startDate, delta) : item.startDate,
            endDate: item.endDate ? addDays(item.endDate, delta) : item.endDate,
          };
        });
      }
    }
    await this.store.updateTask(task.id, patch, { undoLabel: "已调整时间线" });
  }

  timelineResizePatch(task, edge, targetDate) {
    if (!task || !targetDate) return null;
    let start = task.startDate || task.dueDate || targetDate;
    let end = task.dueDate || task.startDate || targetDate;
    if (start > end) [start, end] = [end, start];

    if (edge === "start") {
      const nextStart = targetDate > end ? end : targetDate;
      return {
        startDate: nextStart === end ? "" : nextStart,
        dueDate: end,
      };
    }

    const nextEnd = targetDate < start ? start : targetDate;
    return {
      startDate: nextEnd === start ? "" : start,
      dueDate: nextEnd,
    };
  }

  bindTimelineResizeHandle(handle, edge, bar, task, track, windowData) {
    if (!handle || !bar || !task || !track) return;
    handle.addEventListener("dragstart", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = track.getBoundingClientRect();
      const range = this.timelineTaskRange(task, windowData);
      if (!rect.width || !range) return;
      const originalLeft = bar.style.getPropertyValue("--timeline-left");
      const originalWidth = bar.style.getPropertyValue("--timeline-width");
      let pendingPatch = null;
      let raf = 0;
      let lastClientX = event.clientX;
      const originX = event.clientX;
      let active = false;

      try { handle.setPointerCapture?.(event.pointerId); } catch (_) {}

      const coordinateAtX = (clientX) => {
        const currentRect = track.getBoundingClientRect();
        const x = Math.max(0, Math.min(currentRect.width, clientX - currentRect.left));
        return (x / currentRect.width) * windowData.unitCount;
      };
      const dateAtX = (clientX) => this.timelineDateAtCoordinate(coordinateAtX(clientX), windowData);

      const preview = (clientX) => {
        const currentRect = track.getBoundingClientRect();
        if (!currentRect.width) return;
        const coord = coordinateAtX(clientX);
        const targetDate = dateAtX(clientX);
        const patch = this.timelineResizePatch(task, edge, targetDate);
        if (!patch) return;
        pendingPatch = patch;

        const visibleStart = Math.max(0, range.start);
        const visibleEnd = Math.min(windowData.unitCount, range.end);
        const minUnits = Math.max((22 / currentRect.width) * windowData.unitCount, 0.015);
        let previewStart = visibleStart;
        let previewEnd = visibleEnd;
        if (edge === "start") previewStart = Math.max(0, Math.min(coord, visibleEnd - minUnits));
        else previewEnd = Math.min(windowData.unitCount, Math.max(coord, visibleStart + minUnits));
        if (previewEnd <= previewStart) return;
        bar.style.setProperty("--timeline-left", `${(previewStart / windowData.unitCount) * 100}%`);
        bar.style.setProperty("--timeline-width", `${((previewEnd - previewStart) / windowData.unitCount) * 100}%`);
      };

      const schedulePreview = (clientX) => {
        lastClientX = clientX;
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          preview(lastClientX);
        });
      };

      const activate = () => {
        if (active) return;
        active = true;
        bar.dataset.suppressClick = "1";
        window.setTimeout(() => { if (bar.dataset.suppressClick === "1") delete bar.dataset.suppressClick; }, 220);
        bar.classList.add("is-resizing");
        track.classList.add("is-resizing-task");
        handle.classList.add("is-active");
      };
      const onMove = (pointerEvent) => {
        if (pointerEvent.pointerId !== event.pointerId) return;
        if (!active && Math.abs(pointerEvent.clientX - originX) < TODAY_POINTER_DRAG_THRESHOLD) return;
        activate();
        pointerEvent.preventDefault();
        schedulePreview(pointerEvent.clientX);
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        window.removeEventListener("pointercancel", onCancel, true);
        document.removeEventListener("keydown", onKeyDown, true);
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        bar.classList.remove("is-resizing");
        track.classList.remove("is-resizing-task");
        handle.classList.remove("is-active");
      };

      const onUp = async (pointerEvent) => {
        if (pointerEvent.pointerId !== event.pointerId) return;
        pointerEvent.preventDefault();
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
          preview(pointerEvent.clientX);
        }
        cleanup();
        if (active && pendingPatch) await this.store.updateTask(task.id, pendingPatch, { undoLabel: "已调整任务日期" });
        else {
          bar.style.setProperty("--timeline-left", originalLeft);
          bar.style.setProperty("--timeline-width", originalWidth);
        }
      };

      const cancelResize = () => {
        cleanup();
        bar.style.setProperty("--timeline-left", originalLeft);
        bar.style.setProperty("--timeline-width", originalWidth);
      };
      const onCancel = (pointerEvent) => {
        if (pointerEvent.pointerId !== event.pointerId) return;
        cancelResize();
      };
      const onKeyDown = (keyEvent) => {
        if (keyEvent.key !== "Escape") return;
        keyEvent.preventDefault();
        cancelResize();
      };

      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onCancel, true);
      document.addEventListener("keydown", onKeyDown, true);
    });
  }

  bindTimelineMoveBar(bar, task, track, group, list, windowData) {
    if (!bar || !task || !track || !list) return;
    bar.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest?.(".today-center-timeline-resize-handle, .today-center-timeline-project-phase, .today-center-timeline-project-milestone, .today-center-timeline-project-phase-handle")) return;
      const startRect = bar.getBoundingClientRect();
      if (!startRect.width) return;
      const grabOffsetX = event.clientX - startRect.left;
      const grabOffsetY = event.clientY - startRect.top;
      const originX = event.clientX;
      const originY = event.clientY;
      let active = false;
      let preview = null;
      let targetTrack = track;
      let targetGroup = group;
      let targetDate = task.startDate || task.dueDate;
      let raf = 0;
      let lastPoint = { x: event.clientX, y: event.clientY };

      const groupForTrack = (candidate) => {
        const id = candidate?.dataset?.timelineGroupId;
        if (!id || id === "__ungrouped__") return null;
        if (list?._folderContext) {
          const sourceList = (list.folderLists || []).find((entry) => entry.id === id);
          return sourceList
            ? { id: sourceList.id, name: sourceList.name, listId: sourceList.id, isFolderList: true }
            : group;
        }
        return this.store.getGroup(list.id, id) || group;
      };

      const updateTarget = (clientX, clientY) => {
        const hit = document.elementFromPoint(clientX, clientY);
        const candidate = hit?.closest?.(".today-center-timeline-track");
        if (candidate && candidate.closest(".today-center-timeline")) {
          if (targetTrack !== candidate) {
            targetTrack?.classList.remove("is-pointer-drag-target");
            targetTrack = candidate;
            targetGroup = groupForTrack(candidate);
            targetTrack.classList.add("is-pointer-drag-target");
          }
        }
        if (!targetTrack) return;
        const rect = targetTrack.getBoundingClientRect();
        if (!rect.width) return;
        const leftX = Math.max(0, Math.min(rect.width - 1, clientX - rect.left - grabOffsetX));
        targetDate = this.timelineDateAtCoordinate((leftX / rect.width) * windowData.unitCount, windowData);
      };

      const renderPreview = () => {
        raf = 0;
        if (!preview) return;
        const dx = lastPoint.x - originX;
        const dy = lastPoint.y - originY;
        preview.style.transform = `translate3d(${dx}px,${dy}px,0)`;
        updateTarget(lastPoint.x, lastPoint.y);
      };

      const activate = () => {
        if (active) return;
        active = true;
        event.preventDefault();
        bar.dataset.suppressClick = "1";
        window.setTimeout(() => { if (bar.dataset.suppressClick === "1") delete bar.dataset.suppressClick; }, 180);
        bar.classList.add("is-pointer-dragging");
        track.classList.add("is-pointer-drag-target");
        preview = bar.cloneNode(true);
        preview.classList.remove("is-pointer-dragging", "is-resizing");
        preview.classList.add("is-pointer-drag-preview");
        preview.querySelectorAll(".today-center-timeline-resize-handle").forEach((el) => el.remove());
        preview.style.left = `${startRect.left}px`;
        preview.style.top = `${startRect.top}px`;
        preview.style.width = `${startRect.width}px`;
        preview.style.height = `${startRect.height}px`;
        preview.style.removeProperty("--timeline-left");
        preview.style.removeProperty("--timeline-width");
        preview.style.removeProperty("--timeline-top");
        preview.style.setProperty("--timeline-label-shift", "0px");
        document.body.appendChild(preview);
      };

      const onMove = (pointerEvent) => {
        if (pointerEvent.pointerId !== event.pointerId) return;
        const dx = pointerEvent.clientX - originX;
        const dy = pointerEvent.clientY - originY;
        if (!active && Math.hypot(dx, dy) < TODAY_POINTER_DRAG_THRESHOLD) return;
        if (!active) activate();
        pointerEvent.preventDefault();
        lastPoint = { x: pointerEvent.clientX, y: pointerEvent.clientY };
        if (!raf) raf = requestAnimationFrame(renderPreview);
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        window.removeEventListener("pointercancel", onCancel, true);
        document.removeEventListener("keydown", onKeyDown, true);
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        bar.classList.remove("is-pointer-dragging");
        document.querySelectorAll(".today-center-timeline-track.is-pointer-drag-target").forEach((el) => el.classList.remove("is-pointer-drag-target"));
        preview?.remove();
        preview = null;
      };

      const onUp = async (pointerEvent) => {
        if (pointerEvent.pointerId !== event.pointerId) return;
        if (active) {
          pointerEvent.preventDefault();
          if (raf) {
            cancelAnimationFrame(raf);
            raf = 0;
            lastPoint = { x: pointerEvent.clientX, y: pointerEvent.clientY };
            renderPreview();
          } else updateTarget(pointerEvent.clientX, pointerEvent.clientY);
          const dueDate = targetDate;
          const destination = targetGroup;
          cleanup();
          if (dueDate) await this.moveTimelineTask(task, destination, dueDate);
        } else cleanup();
      };

      const onCancel = (pointerEvent) => {
        if (pointerEvent.pointerId !== event.pointerId) return;
        cleanup();
      };
      const onKeyDown = (keyEvent) => {
        if (keyEvent.key !== "Escape") return;
        keyEvent.preventDefault();
        if (active) {
          bar.dataset.suppressClick = "1";
          window.setTimeout(() => { if (bar.dataset.suppressClick === "1") delete bar.dataset.suppressClick; }, 320);
        }
        cleanup();
      };

      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onCancel, true);
      document.addEventListener("keydown", onKeyDown, true);
    });
  }


  closePlanningEditor() {
    if (this.planningEditorOutsideHandler) {
      document.removeEventListener("pointerdown", this.planningEditorOutsideHandler, true);
      this.planningEditorOutsideHandler = null;
    }
    if (this.planningEditorEl?.isConnected) this.planningEditorEl.remove();
    this.planningEditorEl = null;
  }

  planningItemDefaults(task, type = "phase", preferredDate = "") {
    const preferred = parseDateOnly(preferredDate) ? preferredDate : "";
    const base = preferred || task?.startDate || task?.dueDate || todayISO();
    if (type === "milestone") {
      return { id: uid(), type: "milestone", title: "新节点", date: preferred || task?.dueDate || base };
    }
    const end = preferred
      ? addDays(base, 2)
      : (task?.dueDate && task.dueDate >= base ? task.dueDate : addDays(base, 2));
    return { id: uid(), type: "phase", title: "新阶段", startDate: base, endDate: end };
  }

  suggestedPlanningDate(task) {
    if (!task) return todayISO();
    const today = todayISO();
    const starts = [];
    const ends = [];
    if (task.startDate) starts.push(task.startDate);
    if (task.dueDate) ends.push(task.dueDate);
    for (const item of task.timelineItems || []) {
      if (item.type === "phase") {
        if (item.startDate) starts.push(item.startDate);
        if (item.endDate) ends.push(item.endDate);
      } else if (item.type === "milestone" && item.date) {
        starts.push(item.date);
        ends.push(item.date);
      }
    }
    const min = starts.sort()[0] || task.startDate || task.dueDate || today;
    const max = ends.sort().at(-1) || task.dueDate || task.startDate || today;
    if (today >= min && today <= max) return today;
    if (ends.length) {
      const after = addDays(max, 1);
      if (!task.dueDate || after <= task.dueDate) return after;
    }
    return task.startDate || task.dueDate || today;
  }

  async savePlanningItem(task, item) {
    if (!task || !item) return;
    const items = [...(task.timelineItems || [])];
    const index = items.findIndex((entry) => entry.id === item.id);
    if (index >= 0) items[index] = { ...item };
    else items.push({ ...item, id: item.id || uid() });
    await this.store.updateTask(task.id, { timelineRole: "project", timelineItems: items });
  }

  async deletePlanningItem(task, itemId) {
    if (!task || !itemId) return;
    const timelineItems = (task.timelineItems || []).filter((entry) => entry.id !== itemId);
    await this.store.updateTask(task.id, { timelineItems });
  }

  showPlanningItemEditor(anchor, task, item = null, type = "phase", preferredDate = "") {
    if (!task) return;
    const source = anchor?.currentTarget || anchor;
    const anchorRect = source?.getBoundingClientRect?.();
    if (!anchorRect) return;
    this.closePlanningEditor();

    const draft = item ? { ...item } : this.planningItemDefaults(task, type, preferredDate);
    const isPhase = draft.type !== "milestone";
    const panel = document.createElement("div");
    panel.className = "today-plugin-root today-center-planning-editor";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", isPhase ? "编辑阶段" : "编辑里程碑");

    const header = document.createElement("div");
    header.className = "today-center-planning-editor-head";
    const kind = document.createElement("div");
    kind.className = "today-center-planning-editor-kind";
    kind.append(this.makeIcon(isPhase ? "route" : "diamond", "today-center-planning-editor-kind-icon"), document.createTextNode(isPhase ? "阶段" : "里程碑"));
    const taskLabel = document.createElement("button");
    taskLabel.type = "button";
    taskLabel.className = "today-center-planning-editor-task";
    taskLabel.title = "打开所属任务";
    taskLabel.textContent = task.title;
    taskLabel.addEventListener("click", (event) => {
      event.stopPropagation();
      this.closePlanningEditor();
      this.plugin.openTaskDetail(task.id, source);
    });
    const close = document.createElement("button");
    close.type = "button";
    close.className = "today-center-planning-editor-close";
    close.title = "关闭";
    close.appendChild(this.makeIcon("x"));
    close.addEventListener("click", () => this.closePlanningEditor());
    header.append(kind, taskLabel, close);

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.className = "today-center-planning-editor-title";
    titleInput.value = draft.title || (isPhase ? "阶段" : "节点");
    titleInput.placeholder = isPhase ? "阶段名称" : "里程碑名称";

    const dates = document.createElement("div");
    dates.className = `today-center-planning-editor-dates${isPhase ? " is-range" : ""}`;
    const makeDateField = (labelText, value) => {
      const field = document.createElement("label");
      field.className = "today-center-planning-editor-date-field";
      const label = document.createElement("span");
      label.textContent = labelText;
      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "numeric";
      input.placeholder = "YYYY-MM-DD";
      input.value = value || "";
      field.append(label, input);
      return { field, input };
    };

    const first = makeDateField(isPhase ? "开始" : "日期", isPhase ? draft.startDate : draft.date);
    dates.appendChild(first.field);
    let second = null;
    if (isPhase) {
      second = makeDateField("结束", draft.endDate);
      dates.appendChild(second.field);
    }

    const message = document.createElement("div");
    message.className = "today-center-planning-editor-message";

    const footer = document.createElement("div");
    footer.className = "today-center-planning-editor-footer";
    const leftActions = document.createElement("div");
    leftActions.className = "today-center-planning-editor-footer-left";
    if (item) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "today-center-planning-editor-delete";
      remove.title = isPhase ? "删除阶段" : "删除里程碑";
      remove.append(this.makeIcon("trash-2"), document.createTextNode("删除"));
      remove.addEventListener("click", async () => {
        this.closePlanningEditor();
        await this.deletePlanningItem(task, draft.id);
      });
      leftActions.appendChild(remove);
    }
    const save = document.createElement("button");
    save.type = "button";
    save.className = "today-center-planning-editor-save";
    save.textContent = item ? "保存" : "添加";
    footer.append(leftActions, save);

    panel.append(header, titleInput, dates, message, footer);
    document.body.appendChild(panel);
    this.planningEditorEl = panel;

    const place = () => {
      if (!panel.isConnected) return;
      const rect = source.getBoundingClientRect?.() || anchorRect;
      const pr = panel.getBoundingClientRect();
      const gap = 7;
      const gutter = 10;
      let left = rect.left + Math.min(18, rect.width * .2);
      let top = rect.bottom + gap;
      if (left + pr.width > window.innerWidth - gutter) left = window.innerWidth - pr.width - gutter;
      if (top + pr.height > window.innerHeight - gutter) top = rect.top - pr.height - gap;
      left = Math.max(gutter, left);
      top = Math.max(gutter, Math.min(top, window.innerHeight - pr.height - gutter));
      panel.style.left = `${Math.round(left)}px`;
      panel.style.top = `${Math.round(top)}px`;
    };

    const normalizeDate = (value) => {
      const raw = String(value || "").trim().replace(/[./]/g, "-");
      const parsed = parseDateOnly(raw);
      return parsed ? dateToISO(parsed) : "";
    };

    const commit = async () => {
      const title = titleInput.value.trim() || (isPhase ? "阶段" : "节点");
      if (isPhase) {
        let startDate = normalizeDate(first.input.value);
        let endDate = normalizeDate(second.input.value);
        if (!startDate || !endDate) {
          message.textContent = "请输入有效的开始和结束日期";
          return;
        }
        if (startDate > endDate) [startDate, endDate] = [endDate, startDate];
        draft.title = title;
        draft.startDate = startDate;
        draft.endDate = endDate;
      } else {
        const date = normalizeDate(first.input.value);
        if (!date) {
          message.textContent = "请输入有效日期";
          return;
        }
        draft.title = title;
        draft.date = date;
      }
      this.closePlanningEditor();
      await this.savePlanningItem(task, draft);
    };

    save.addEventListener("click", commit);
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.closePlanningEditor();
      } else if (event.key === "Enter") {
        event.preventDefault();
        commit();
      }
    });
    panel.addEventListener("pointerdown", (event) => event.stopPropagation());
    requestAnimationFrame(() => {
      place();
      titleInput.focus({ preventScroll: true });
      titleInput.select();
    });

    this.planningEditorOutsideHandler = (event) => {
      if (panel.contains(event.target) || source.contains?.(event.target)) return;
      this.closePlanningEditor();
    };
    setTimeout(() => {
      if (this.planningEditorEl === panel && this.planningEditorOutsideHandler) {
        document.addEventListener("pointerdown", this.planningEditorOutsideHandler, true);
      }
    }, 0);
  }

  showPlanningAddMenu(event, task, anchor, preferredDate = "") {
    if (!task) return;
    const source = anchor || event.currentTarget || event.target;
    const date = preferredDate || this.suggestedPlanningDate(task);
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("添加阶段").setIcon("route").onClick(() => {
      this.showPlanningItemEditor(source, task, null, "phase", date);
    }));
    menu.addItem((item) => item.setTitle("添加里程碑").setIcon("diamond").onClick(() => {
      this.showPlanningItemEditor(source, task, null, "milestone", date);
    }));
    menu.showAtMouseEvent(event);
  }

  showProjectPlanningMenu(event, task, list, anchor, preferredDate = "") {
    if (!task) return;
    const source = anchor || event.currentTarget || event.target;
    const date = preferredDate || this.suggestedPlanningDate(task);
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(`添加阶段${date ? ` · ${date.slice(5)}` : ""}`).setIcon("route").onClick(() => {
      this.showPlanningItemEditor(source, task, null, "phase", date);
    }));
    menu.addItem((item) => item.setTitle(`添加里程碑${date ? ` · ${date.slice(5)}` : ""}`).setIcon("diamond").onClick(() => {
      this.showPlanningItemEditor(source, task, null, "milestone", date);
    }));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("打开任务").setIcon("square-pen").onClick(() => this.plugin.openTaskDetail(task.id, source)));
    if (list && !list.system) {
      menu.addSeparator();
      menu.addItem((item) => item.setTitle("移动 · 未分组").setIcon("minus").setChecked(!task.groupId).onClick(() => this.store.updateTaskGroup(task.id, null)));
      for (const group of this.store.getGroups(list.id)) {
        menu.addItem((item) => item.setTitle(`移动 · ${group.name}`).setIcon("rows-3").setChecked(task.groupId === group.id).onClick(() => this.store.updateTaskGroup(task.id, group.id)));
      }
    }
    menu.showAtMouseEvent(event);
  }

  showWindowEditor(anchor, task) {
    if (!task) return;
    const source = anchor?.currentTarget || anchor;
    const anchorRect = source?.getBoundingClientRect?.();
    if (!anchorRect) return;
    this.closePlanningEditor();

    const fallbackStart = task.windowStart || task.startDate || task.dueDate || todayISO();
    const fallbackEnd = task.windowEnd || (task.dueDate && task.dueDate >= fallbackStart ? task.dueDate : addDays(fallbackStart, 6));
    const panel = document.createElement("div");
    panel.className = "today-plugin-root today-center-planning-editor is-window";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "编辑可执行时间窗");

    const header = document.createElement("div");
    header.className = "today-center-planning-editor-head";
    const kind = document.createElement("div");
    kind.className = "today-center-planning-editor-kind";
    kind.append(this.makeIcon("calendar-range", "today-center-planning-editor-kind-icon"), document.createTextNode("可执行时间窗"));
    const taskLabel = document.createElement("button");
    taskLabel.type = "button";
    taskLabel.className = "today-center-planning-editor-task";
    taskLabel.textContent = task.title;
    taskLabel.addEventListener("click", (event) => { event.stopPropagation(); this.closePlanningEditor(); this.plugin.openTaskDetail(task.id, source); });
    const close = document.createElement("button");
    close.type = "button";
    close.className = "today-center-planning-editor-close";
    close.appendChild(this.makeIcon("x"));
    close.addEventListener("click", () => this.closePlanningEditor());
    header.append(kind, taskLabel, close);

    const note = document.createElement("div");
    note.className = "today-center-planning-editor-window-note";
    note.textContent = "表示这段日期内任意时候完成即可，不等同于连续工作时长。";

    const dates = document.createElement("div");
    dates.className = "today-center-planning-editor-dates is-range";
    const field = (labelText, value) => {
      const label = document.createElement("label");
      label.className = "today-center-planning-editor-date-field";
      const caption = document.createElement("span"); caption.textContent = labelText;
      const input = document.createElement("input"); input.type = "text"; input.inputMode = "numeric"; input.placeholder = "YYYY-MM-DD"; input.value = value || "";
      label.append(caption, input);
      return { label, input };
    };
    const start = field("开始可做", fallbackStart);
    const end = field("截止", fallbackEnd);
    dates.append(start.label, end.label);

    const message = document.createElement("div");
    message.className = "today-center-planning-editor-message";
    const footer = document.createElement("div");
    footer.className = "today-center-planning-editor-footer";
    const leftActions = document.createElement("div");
    leftActions.className = "today-center-planning-editor-footer-left";
    if (task.windowStart && task.windowEnd) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "today-center-planning-editor-delete";
      clear.append(this.makeIcon("eraser"), document.createTextNode("清除"));
      clear.addEventListener("click", async () => { this.closePlanningEditor(); await this.store.updateTask(task.id, { windowStart: "", windowEnd: "" }); });
      leftActions.appendChild(clear);
    }
    const save = document.createElement("button");
    save.type = "button"; save.className = "today-center-planning-editor-save"; save.textContent = task.windowStart && task.windowEnd ? "保存" : "设置";
    footer.append(leftActions, save);
    panel.append(header, note, dates, message, footer);
    document.body.appendChild(panel);
    this.planningEditorEl = panel;

    const normalizeDate = (value) => { const parsed = parseDateOnly(String(value || "").trim().replace(/[./]/g, "-")); return parsed ? dateToISO(parsed) : ""; };
    const commit = async () => {
      let startDate = normalizeDate(start.input.value);
      let endDate = normalizeDate(end.input.value);
      if (!startDate || !endDate) { message.textContent = "请输入有效的开始和截止日期"; return; }
      if (startDate > endDate) [startDate, endDate] = [endDate, startDate];
      this.closePlanningEditor();
      await this.store.updateTask(task.id, { windowStart: startDate, windowEnd: endDate });
    };
    save.addEventListener("click", commit);
    panel.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); this.closePlanningEditor(); } else if (event.key === "Enter") { event.preventDefault(); commit(); } });
    panel.addEventListener("pointerdown", (event) => event.stopPropagation());

    const place = () => {
      if (!panel.isConnected) return;
      const rect = source.getBoundingClientRect?.() || anchorRect;
      const pr = panel.getBoundingClientRect();
      const gap = 7, gutter = 10;
      let left = rect.left + Math.min(18, rect.width * .2);
      let top = rect.bottom + gap;
      if (left + pr.width > window.innerWidth - gutter) left = window.innerWidth - pr.width - gutter;
      if (top + pr.height > window.innerHeight - gutter) top = rect.top - pr.height - gap;
      panel.style.left = `${Math.max(gutter, Math.round(left))}px`;
      panel.style.top = `${Math.max(gutter, Math.min(Math.round(top), window.innerHeight - pr.height - gutter))}px`;
    };
    requestAnimationFrame(() => { place(); start.input.focus({ preventScroll: true }); start.input.select(); });
    this.planningEditorOutsideHandler = (event) => { if (panel.contains(event.target) || source.contains?.(event.target)) return; this.closePlanningEditor(); };
    setTimeout(() => { if (this.planningEditorEl === panel && this.planningEditorOutsideHandler) document.addEventListener("pointerdown", this.planningEditorOutsideHandler, true); }, 0);
  }

  projectPlanningItemPatch(task, itemId, patch) {
    const timelineItems = (task.timelineItems || []).map((entry) => entry.id === itemId ? { ...entry, ...patch } : { ...entry });
    return { timelineItems };
  }

  timelineDateAtClientX(clientX, track, windowData) {
    const rect = track?.getBoundingClientRect?.();
    if (!rect?.width) return null;
    const x = Math.max(0, Math.min(rect.width - 1, clientX - rect.left));
    return this.timelineDateAtCoordinate((x / rect.width) * windowData.unitCount, windowData);
  }

  bindProjectPhaseInteraction(phaseEl, plan, task, phase, track, windowData, visibleStart, visibleEnd) {
    if (!phaseEl || !plan || !task || !phase || !track) return;
    const projectSpan = Math.max(0.001, visibleEnd - visibleStart);
    const leftHandle = document.createElement("span");
    leftHandle.className = "today-center-timeline-project-phase-handle is-start";
    const rightHandle = document.createElement("span");
    rightHandle.className = "today-center-timeline-project-phase-handle is-end";
    phaseEl.append(leftHandle, rightHandle);

    const applyPreview = (startDate, endDate) => {
      const range = this.timelinePlanningRange(startDate, endDate, windowData);
      if (!range) return;
      const phaseStart = Math.max(visibleStart, range.start);
      const phaseEnd = Math.min(visibleEnd, range.end);
      if (phaseEnd <= phaseStart) return;
      phaseEl.style.left = `${((phaseStart - visibleStart) / projectSpan) * 100}%`;
      phaseEl.style.width = `${((phaseEnd - phaseStart) / projectSpan) * 100}%`;
    };

    const begin = (event, mode) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const originalStart = phase.startDate;
      const originalEnd = phase.endDate;
      const pointerStartDate = this.timelineDateAtClientX(event.clientX, track, windowData) || originalStart;
      let nextStart = originalStart;
      let nextEnd = originalEnd;
      let active = false;
      let raf = 0;
      let lastX = event.clientX;
      const originX = event.clientX;
      const suppressPhaseClick = () => {
        phaseEl.dataset.suppressClick = "1";
        window.setTimeout(() => { if (phaseEl.dataset.suppressClick === "1") delete phaseEl.dataset.suppressClick; }, 220);
      };
      if (active) {
        suppressPhaseClick();
        phaseEl.classList.add("is-adjusting");
      }
      try { phaseEl.setPointerCapture?.(event.pointerId); } catch (_) {}

      const preview = (clientX) => {
        const targetDate = this.timelineDateAtClientX(clientX, track, windowData);
        if (!targetDate) return;
        if (mode === "start") {
          nextStart = targetDate > originalEnd ? originalEnd : targetDate;
          nextEnd = originalEnd;
        } else if (mode === "end") {
          nextStart = originalStart;
          nextEnd = targetDate < originalStart ? originalStart : targetDate;
        } else {
          const delta = daysBetween(pointerStartDate, targetDate);
          nextStart = addDays(originalStart, delta);
          nextEnd = addDays(originalEnd, delta);
        }
        applyPreview(nextStart, nextEnd);
      };

      const onMove = (pointerEvent) => {
        if (pointerEvent.pointerId !== event.pointerId) return;
        lastX = pointerEvent.clientX;
        if (!active && Math.abs(pointerEvent.clientX - originX) >= TODAY_POINTER_DRAG_THRESHOLD) {
          active = true;
          suppressPhaseClick();
          phaseEl.classList.add("is-adjusting");
        }
        if (!active) return;
        pointerEvent.preventDefault();
        if (raf) return;
        raf = requestAnimationFrame(() => { raf = 0; preview(lastX); });
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        window.removeEventListener("pointercancel", onCancel, true);
        document.removeEventListener("keydown", onKeyDown, true);
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        phaseEl.classList.remove("is-adjusting");
      };
      const onUp = async (pointerEvent) => {
        if (pointerEvent.pointerId !== event.pointerId) return;
        if (active) {
          if (raf) { cancelAnimationFrame(raf); raf = 0; preview(pointerEvent.clientX); }
          cleanup();
          await this.store.updateTask(task.id, this.projectPlanningItemPatch(task, phase.id, { startDate: nextStart, endDate: nextEnd }));
        } else cleanup();
      };
      const cancelPhase = () => { cleanup(); applyPreview(originalStart, originalEnd); };
      const onCancel = (pointerEvent) => {
        if (pointerEvent.pointerId !== event.pointerId) return;
        cancelPhase();
      };
      const onKeyDown = (keyEvent) => { if (keyEvent.key === "Escape") { keyEvent.preventDefault(); cancelPhase(); } };
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onCancel, true);
      document.addEventListener("keydown", onKeyDown, true);
    };

    leftHandle.addEventListener("pointerdown", (event) => begin(event, "start"));
    rightHandle.addEventListener("pointerdown", (event) => begin(event, "end"));
    phaseEl.addEventListener("pointerdown", (event) => {
      if (event.target.closest?.(".today-center-timeline-project-phase-handle")) return;
      begin(event, "move");
    });
    phaseEl.addEventListener("click", (event) => {
      event.stopPropagation();
      if (phaseEl.dataset.suppressClick === "1") return;
      this.showPlanningItemEditor(phaseEl, task, phase, "phase");
    });
    phaseEl.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.showPlanningItemEditor(phaseEl, task, phase, "phase");
    });
  }

  bindProjectMilestoneInteraction(milestoneEl, plan, task, milestone, track, windowData, visibleStart, visibleEnd) {
    if (!milestoneEl || !task || !milestone || !track) return;
    const projectSpan = Math.max(0.001, visibleEnd - visibleStart);
    milestoneEl.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const originalDate = milestone.date;
      const originX = event.clientX;
      let nextDate = originalDate;
      let active = false;
      let raf = 0;
      let lastX = event.clientX;
      const suppressMilestoneClick = () => {
        milestoneEl.dataset.suppressClick = "1";
        window.setTimeout(() => { if (milestoneEl.dataset.suppressClick === "1") delete milestoneEl.dataset.suppressClick; }, 220);
      };
      try { milestoneEl.setPointerCapture?.(event.pointerId); } catch (_) {}

      const preview = (clientX) => {
        const targetDate = this.timelineDateAtClientX(clientX, track, windowData);
        if (!targetDate) return;
        nextDate = targetDate;
        const date = parseDateOnly(targetDate);
        if (!date) return;
        date.setHours(0, 0, 0, 0);
        const coord = this.timelineDateCenterCoordinate(date, windowData);
        milestoneEl.style.left = `${((coord - visibleStart) / projectSpan) * 100}%`;
      };
      const onMove = (pointerEvent) => {
        if (pointerEvent.pointerId !== event.pointerId) return;
        lastX = pointerEvent.clientX;
        if (!active && Math.abs(pointerEvent.clientX - originX) >= TODAY_POINTER_DRAG_THRESHOLD) {
          active = true;
          suppressMilestoneClick();
          milestoneEl.classList.add("is-adjusting");
        }
        if (!active) return;
        pointerEvent.preventDefault();
        if (raf) return;
        raf = requestAnimationFrame(() => { raf = 0; preview(lastX); });
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        window.removeEventListener("pointercancel", onCancel, true);
        document.removeEventListener("keydown", onKeyDown, true);
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        milestoneEl.classList.remove("is-adjusting");
      };
      const onUp = async (pointerEvent) => {
        if (pointerEvent.pointerId !== event.pointerId) return;
        if (active) {
          if (raf) { cancelAnimationFrame(raf); raf = 0; preview(pointerEvent.clientX); }
          cleanup();
          await this.store.updateTask(task.id, this.projectPlanningItemPatch(task, milestone.id, { date: nextDate }));
        } else cleanup();
      };
      const cancelMilestone = () => {
        cleanup();
        const date = parseDateOnly(originalDate);
        if (date) {
          date.setHours(0, 0, 0, 0);
          const coord = this.timelineDateCenterCoordinate(date, windowData);
          milestoneEl.style.left = `${((coord - visibleStart) / projectSpan) * 100}%`;
        }
      };
      const onCancel = (pointerEvent) => { if (pointerEvent.pointerId === event.pointerId) cancelMilestone(); };
      const onKeyDown = (keyEvent) => { if (keyEvent.key === "Escape") { keyEvent.preventDefault(); cancelMilestone(); } };
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onCancel, true);
      document.addEventListener("keydown", onKeyDown, true);
    });
    milestoneEl.addEventListener("click", (event) => {
      event.stopPropagation();
      if (milestoneEl.dataset.suppressClick === "1") return;
      this.showPlanningItemEditor(milestoneEl, task, milestone, "milestone");
    });
    milestoneEl.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.showPlanningItemEditor(milestoneEl, task, milestone, "milestone");
    });
  }

  bindTimelineWindowInteraction(windowEl, task, track, windowData, range) {
    if (!windowEl || !task || !track || !range) return;
    const startHandle = document.createElement("span");
    startHandle.className = "today-center-timeline-window-handle is-start";
    const endHandle = document.createElement("span");
    endHandle.className = "today-center-timeline-window-handle is-end";
    windowEl.append(startHandle, endHandle);

    const applyPreview = (startDate, endDate) => {
      const nextRange = this.timelinePlanningRange(startDate, endDate, windowData);
      if (!nextRange) return;
      const visibleStart = Math.max(0, nextRange.start);
      const visibleEnd = Math.min(windowData.unitCount, nextRange.end);
      windowEl.style.setProperty("--timeline-left", `${(visibleStart / windowData.unitCount) * 100}%`);
      windowEl.style.setProperty("--timeline-width", `${((Math.max(.025, visibleEnd - visibleStart)) / windowData.unitCount) * 100}%`);
    };

    const begin = (event, mode) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const originalStart = task.windowStart;
      const originalEnd = task.windowEnd;
      const pointerStartDate = this.timelineDateAtClientX(event.clientX, track, windowData) || originalStart;
      const originX = event.clientX;
      let nextStart = originalStart, nextEnd = originalEnd, active = false, raf = 0, lastX = event.clientX;
      const suppress = () => { windowEl.dataset.suppressClick = "1"; window.setTimeout(() => { if (windowEl.dataset.suppressClick === "1") delete windowEl.dataset.suppressClick; }, 220); };
      if (active) { suppress(); windowEl.classList.add("is-adjusting"); }
      const preview = (clientX) => {
        const targetDate = this.timelineDateAtClientX(clientX, track, windowData);
        if (!targetDate) return;
        if (mode === "start") { nextStart = targetDate > originalEnd ? originalEnd : targetDate; nextEnd = originalEnd; }
        else if (mode === "end") { nextStart = originalStart; nextEnd = targetDate < originalStart ? originalStart : targetDate; }
        else { const delta = daysBetween(pointerStartDate, targetDate); nextStart = addDays(originalStart, delta); nextEnd = addDays(originalEnd, delta); }
        applyPreview(nextStart, nextEnd);
      };
      const onMove = (e) => {
        if (e.pointerId !== event.pointerId) return;
        lastX = e.clientX;
        if (!active && Math.abs(e.clientX - originX) >= TODAY_POINTER_DRAG_THRESHOLD) { active = true; suppress(); windowEl.classList.add("is-adjusting"); }
        if (!active) return;
        e.preventDefault();
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; preview(lastX); });
      };
      const cleanup = () => { window.removeEventListener("pointermove", onMove, true); window.removeEventListener("pointerup", onUp, true); window.removeEventListener("pointercancel", onCancel, true); document.removeEventListener("keydown", onKeyDown, true); if (raf) cancelAnimationFrame(raf); windowEl.classList.remove("is-adjusting"); };
      const onUp = async (e) => {
        if (e.pointerId !== event.pointerId) return;
        if (active) { if (raf) { cancelAnimationFrame(raf); raf = 0; preview(e.clientX); } cleanup(); await this.store.updateTask(task.id, { windowStart: nextStart, windowEnd: nextEnd }); }
        else cleanup();
      };
      const cancelWindow = () => { cleanup(); applyPreview(originalStart, originalEnd); };
      const onCancel = (e) => { if (e.pointerId === event.pointerId) cancelWindow(); };
      const onKeyDown = (keyEvent) => { if (keyEvent.key === "Escape") { keyEvent.preventDefault(); cancelWindow(); } };
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onCancel, true);
      document.addEventListener("keydown", onKeyDown, true);
    };
    startHandle.addEventListener("pointerdown", (event) => begin(event, "start"));
    endHandle.addEventListener("pointerdown", (event) => begin(event, "end"));
    windowEl.addEventListener("pointerdown", (event) => { if (event.target.closest?.(".today-center-timeline-window-handle")) return; begin(event, "move"); });
    windowEl.addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopPropagation(); this.showWindowEditor(windowEl, task); });
  }

  showTimelineTaskMenu(event, task, list, anchor) {
    if (!task) return;
    const source = anchor || event.currentTarget || event.target;
    const extraActions = [
      {
        icon: "calendar-range",
        label: task.windowStart && task.windowEnd ? "编辑可执行时间窗" : "设置可执行时间窗",
        onClick: () => this.showWindowEditor(source, task),
      },
    ];
    if (task.windowStart && task.windowEnd) {
      extraActions.push({
        icon: "eraser",
        label: "清除可执行时间窗",
        onClick: () => this.store.updateTask(task.id, { windowStart: "", windowEnd: "" }, { undoLabel: "已修改时间窗" }),
      });
    }
    extraActions.push(
      { icon: "route", label: "添加阶段", onClick: () => this.showPlanningItemEditor(source, task, null, "phase", this.suggestedPlanningDate(task)) },
      { icon: "diamond", label: "添加里程碑", onClick: () => this.showPlanningItemEditor(source, task, null, "milestone", this.suggestedPlanningDate(task)) },
    );
    this.plugin.openTaskContextMenu(event, task, { anchor: source, extraActions });
  }

  timelinePlanningRange(startValue, endValue, windowData) {
    if (!startValue || !endValue) return null;
    let startKey = startValue;
    let endKey = endValue;
    if (startKey > endKey) [startKey, endKey] = [endKey, startKey];
    const startDate = parseDateOnly(startKey);
    const endExclusiveDate = parseDateOnly(endKey);
    if (!startDate || !endExclusiveDate) return null;
    startDate.setHours(0, 0, 0, 0);
    endExclusiveDate.setHours(0, 0, 0, 0);
    endExclusiveDate.setDate(endExclusiveDate.getDate() + 1);
    return {
      start: this.timelineCoordinate(startDate, windowData),
      end: this.timelineCoordinate(endExclusiveDate, windowData),
      startMs: startDate.getTime(),
      endExclusiveMs: endExclusiveDate.getTime(),
      startValue: startKey,
      endValue: endKey,
    };
  }

  timelinePlanningEntries(task, windowData) {
    const entries = [];
    if (!task) return entries;
    if (task.windowStart && task.windowEnd) {
      const range = this.timelinePlanningRange(task.windowStart, task.windowEnd, windowData);
      if (range) entries.push({ kind: "window", task, title: task.title, range });
    }
    for (const item of task.timelineItems || []) {
      if (item.type === "milestone" && item.date) {
        const date = parseDateOnly(item.date);
        if (!date) continue;
        date.setHours(0, 0, 0, 0);
        const next = new Date(date);
        next.setDate(next.getDate() + 1);
        entries.push({
          kind: "milestone",
          task,
          item,
          title: item.title || "节点",
          range: {
            start: this.timelineCoordinate(date, windowData),
            end: this.timelineCoordinate(next, windowData),
            startMs: date.getTime(),
            endExclusiveMs: date.getTime() + 12 * 3600000,
            startValue: item.date,
            endValue: item.date,
          },
        });
      } else if (item.type === "phase" && item.startDate && item.endDate) {
        const range = this.timelinePlanningRange(item.startDate, item.endDate, windowData);
        if (range) entries.push({ kind: "phase", task, item, title: item.title || "阶段", range });
      }
    }
    return entries;
  }

  timelineProjectRange(task, windowData) {
    if (!task) return null;
    const ranges = [];
    const taskRange = this.timelineTaskRange(task, windowData);
    if (taskRange) ranges.push(taskRange);
    for (const entry of this.timelinePlanningEntries(task, windowData)) {
      if (entry.kind === "window" || !entry.range) continue;
      ranges.push(entry.range);
    }
    if (!ranges.length) return null;
    return {
      start: Math.min(...ranges.map((range) => range.start)),
      end: Math.max(...ranges.map((range) => range.end)),
      startMs: Math.min(...ranges.map((range) => range.startMs)),
      endExclusiveMs: Math.max(...ranges.map((range) => range.endExclusiveMs)),
    };
  }

  timelineProjectPhaseLayout(task) {
    const phases = (task?.timelineItems || [])
      .filter((item) => item.type === "phase" && item.startDate && item.endDate)
      .map((item) => {
        const start = parseDateOnly(item.startDate);
        const end = parseDateOnly(item.endDate);
        if (!start || !end) return null;
        start.setHours(0, 0, 0, 0);
        end.setHours(0, 0, 0, 0);
        const endExclusive = new Date(end);
        endExclusive.setDate(endExclusive.getDate() + 1);
        return { item, startMs: start.getTime(), endExclusiveMs: endExclusive.getTime() };
      })
      .filter(Boolean)
      .sort((a, b) => a.startMs - b.startMs || a.endExclusiveMs - b.endExclusiveMs);

    // Phase rows are packed by their real calendar boundaries. Adjacent phases
    // reuse the same row, while true overlaps move to the next compact sub-rail.
    const laneEnds = [];
    const laneById = new Map();
    for (const phase of phases) {
      let laneIndex = laneEnds.findIndex((endExclusiveMs) => phase.startMs >= endExclusiveMs);
      if (laneIndex < 0) {
        laneIndex = laneEnds.length;
        laneEnds.push(phase.endExclusiveMs);
      } else {
        laneEnds[laneIndex] = phase.endExclusiveMs;
      }
      laneById.set(phase.item.id, laneIndex);
    }
    return { laneById, laneCount: Math.max(1, laneEnds.length) };
  }

  renderTimelineView(tasks, list) {
    const wrap = document.createElement("div");
    wrap.className = `today-center-timeline is-scale-${this.timelineScale}`;
    const windowData = this.timelineWindow();
    const unscheduled = tasks.filter((task) => !task.done && !task.dueDate && !task.windowStart && !(task.timelineItems || []).length);

    const toolbar = document.createElement("div");
    toolbar.className = "today-center-timeline-toolbar";
    const left = document.createElement("div");
    left.className = "today-center-timeline-toolbar-left";
    const title = document.createElement("span");
    title.className = "today-center-timeline-title";
    title.textContent = "时间线";
    left.appendChild(title);

    const right = document.createElement("div");
    right.className = "today-center-timeline-toolbar-right";
    const unscheduledBtn = document.createElement("button");
    unscheduledBtn.type = "button";
    unscheduledBtn.className = "today-center-unscheduled-button";
    unscheduledBtn.append(this.makeIcon("list-todo", "today-center-action-icon"), document.createTextNode("待安排"));
    const unscheduledCount = document.createElement("span");
    unscheduledCount.className = "today-center-unscheduled-count";
    unscheduledCount.textContent = String(unscheduled.length);
    unscheduledBtn.appendChild(unscheduledCount);

    const nav = document.createElement("div");
    nav.className = "today-center-timeline-nav";
    const prev = document.createElement("button");
    prev.type = "button";
    prev.title = "上一段";
    prev.appendChild(this.makeIcon("chevron-left", "today-center-action-icon"));
    prev.addEventListener("click", () => this.shiftTimeline(-1));
    const todayBtn = document.createElement("button");
    todayBtn.type = "button";
    todayBtn.className = "today-center-timeline-today";
    todayBtn.textContent = "今天";
    todayBtn.addEventListener("click", () => { this.timelineAnchorDate = todayISO(); this.render(); });
    const next = document.createElement("button");
    next.type = "button";
    next.title = "下一段";
    next.appendChild(this.makeIcon("chevron-right", "today-center-action-icon"));
    next.addEventListener("click", () => this.shiftTimeline(1));
    nav.append(prev, todayBtn, next);

    const scale = document.createElement("div");
    scale.className = "today-center-timeline-scale";
    [["day", "天"], ["week", "周"], ["month", "月"]].forEach(([id, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      if (this.timelineScale === id) button.classList.add("is-active");
      button.addEventListener("click", () => { this.timelineScale = id; this.timelineAnchorDate = todayISO(); this.render(); });
      scale.appendChild(button);
    });
    right.append(unscheduledBtn, nav, scale);
    toolbar.append(left, right);
    wrap.appendChild(toolbar);

    const scheduledTasks = tasks.filter((task) => task.dueDate || (task.windowStart && task.windowEnd) || (task.timelineItems || []).length);
    if (!scheduledTasks.length) {
      wrap.appendChild(this.renderViewState({
        kind: "empty",
        icon: "calendar-clock",
        title: tasks.length ? "还没有已安排任务" : "时间线还没有任务",
        description: unscheduled.length ? "从“待安排”拖入时间线，或双击日期创建任务。" : "双击时间线日期即可创建任务。",
        compact: true,
        extraClass: "today-timeline-empty-hint",
      }));
    }

    if (unscheduled.length) {
      const strip = document.createElement("div");
      strip.className = "today-center-unscheduled is-collapsed";
      const chips = document.createElement("div");
      chips.className = "today-center-unscheduled-chips";
      for (const task of unscheduled) {
        const group = list?._folderContext
          ? this.store.data.lists.find((entry) => entry.id === task.listId)
          : this.store.getGroup(list.id, task.groupId);
        const chip = document.createElement("span");
        chip.className = "today-center-unscheduled-chip";
        if (task.id === this.selectedTaskId) chip.classList.add("is-selected");
        chip.textContent = `${group ? `${group.name} · ` : ""}${task.title}`;
        chip.dataset.todayTaskId = task.id;
        chip.tabIndex = task.id === this.selectedTaskId ? 0 : -1;
        chip.setAttribute("role", "option");
        chip.setAttribute("aria-selected", task.id === this.selectedTaskId ? "true" : "false");
        chip.draggable = true;
        chip.title = "单击选择 · 双击或 Enter 打开 · 拖到时间线安排日期";
        chip.addEventListener("click", (event) => {
          event.stopPropagation();
          if (chip.dataset.suppressClick === "1") return;
          this.activateTaskFromPointer(task.id, chip, { spatial: true });
        });
        chip.addEventListener("dragstart", (event) => {
          chip.dataset.suppressClick = "1";
          this.timelineDragTaskId = task.id;
          event.dataTransfer?.setData("text/plain", task.id);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
          chip.classList.add("is-dragging");
        });
        chip.addEventListener("dragend", () => {
          this.timelineDragTaskId = null;
          chip.classList.remove("is-dragging");
          window.setTimeout(() => { if (chip.dataset.suppressClick === "1") delete chip.dataset.suppressClick; }, 180);
        });
        chips.appendChild(chip);
      }
      strip.appendChild(chips);
      unscheduledBtn.addEventListener("click", () => {
        strip.classList.toggle("is-collapsed");
        unscheduledBtn.classList.toggle("is-active", !strip.classList.contains("is-collapsed"));
      });
      wrap.appendChild(strip);
    } else {
      unscheduledBtn.disabled = true;
    }

    const canvas = document.createElement("div");
    canvas.className = "today-center-timeline-canvas";
    const gridMinWidth = 192 + windowData.units.length * windowData.columnMin;
    canvas.style.setProperty("--timeline-grid-min-width", `${gridMinWidth}px`);
    canvas.style.setProperty("--timeline-columns", String(windowData.units.length));
    canvas.style.setProperty("--timeline-column-min", `${windowData.columnMin}px`);

    const todayDate = parseDateOnly(todayISO());
    const head = document.createElement("div");
    head.className = "today-center-timeline-head";
    const first = document.createElement("div");
    first.className = "today-center-timeline-task-head";
    const firstTitle = document.createElement("span");
    firstTitle.textContent = "分组";
    first.appendChild(firstTitle);
    head.appendChild(first);

    for (const unit of windowData.units) {
      const cell = document.createElement("div");
      cell.className = "today-center-timeline-date-cell";
      if (todayDate >= unit.start && todayDate < unit.endExclusive) cell.classList.add("is-today");
      if (unit.weekend) cell.classList.add("is-weekend");
      const main = document.createElement("span");
      main.className = "today-center-timeline-date-main";
      main.textContent = unit.main;
      const sub = document.createElement("span");
      sub.className = "today-center-timeline-date-sub";
      sub.textContent = unit.sub;
      cell.append(main, sub);
      if (cell.classList.contains("is-today")) {
        const dot = document.createElement("span");
        dot.className = "today-center-timeline-today-dot";
        cell.appendChild(dot);
      }
      head.appendChild(cell);
    }
    canvas.appendChild(head);

    const collapsedGroups = new Set(list.timelineCollapsedGroups || []);
    for (const group of this.timelineBuckets(list, tasks)) {
      const groupKey = this.timelineGroupKey(group);
      const isCollapsed = collapsedGroups.has(groupKey);
      const lane = document.createElement("section");
      lane.className = `today-center-timeline-group-lane${group.pseudo ? " is-ungrouped" : ""}${isCollapsed ? " is-collapsed" : ""}`;

      const label = document.createElement("div");
      label.className = "today-center-timeline-label";
      const labelTop = document.createElement("div");
      labelTop.className = "today-center-timeline-label-top";
      const collapse = document.createElement("button");
      collapse.type = "button";
      collapse.className = "today-center-timeline-collapse";
      collapse.title = isCollapsed ? "展开分组" : "折叠分组";
      collapse.appendChild(this.makeIcon(isCollapsed ? "chevron-right" : "chevron-down", "today-center-action-icon"));
      collapse.addEventListener("click", (event) => { event.stopPropagation(); this.toggleTimelineGroup(list, group); });
      const lt = document.createElement("div");
      lt.className = "today-center-timeline-label-title";
      lt.textContent = group.name;
      const count = document.createElement("span");
      count.className = "today-center-timeline-label-count";
      count.textContent = String(group.tasks.length);
      labelTop.append(collapse, lt, count);
      const scheduledCount = group.tasks.filter((task) => task.dueDate || (task.windowStart && task.windowEnd) || (task.timelineItems || []).length).length;
      const ls = document.createElement("div");
      ls.className = "today-center-timeline-label-sub";
      ls.textContent = scheduledCount === group.tasks.length ? `${scheduledCount} 个已安排` : `${scheduledCount}/${group.tasks.length} 已安排`;
      label.append(labelTop, ls);
      if (!group.pseudo) label.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        if (list?._folderContext && group.listId) {
          const sourceList = this.store.data.lists.find((entry) => entry.id === group.listId);
          if (sourceList) this.showListMenu(event, sourceList);
        } else this.showGroupMenu(event, list, group);
      });
      lane.appendChild(label);

      const track = document.createElement("div");
      track.className = "today-center-timeline-track";
      track.dataset.timelineGroupId = group.id || "__ungrouped__";
      track.style.setProperty("--timeline-columns", String(windowData.units.length));
      track.style.setProperty("--timeline-column-min", `${windowData.columnMin}px`);
      for (const unit of windowData.units) {
        const slot = document.createElement("div");
        slot.className = "today-center-timeline-slot";
        if (todayDate >= unit.start && todayDate < unit.endExclusive) slot.classList.add("is-today");
        if (unit.weekend) slot.classList.add("is-weekend");
        track.appendChild(slot);
      }

      if (!isCollapsed) {
        const eventDate = (event) => {
          const rect = track.getBoundingClientRect();
          const x = Math.max(0, Math.min(rect.width - 1, event.clientX - rect.left));
          return this.timelineDateAtCoordinate((x / rect.width) * windowData.unitCount, windowData);
        };
        track.addEventListener("dblclick", (event) => {
          if (event.button !== 0) return;
          if (event.target.closest(".today-center-timeline-bar, .today-center-timeline-context-item, .today-center-timeline-project-plan")) return;
          if (track.classList.contains("is-resizing-task") || this.timelineDragTaskId) return;
          event.preventDefault();
          this.openTimelineQuickCreate(list, group, eventDate(event), event, track, windowData);
        });
        track.addEventListener("pointerdown", (event) => {
          if (event.button !== 0) return;
          if (event.target.closest(".today-center-timeline-bar, .today-center-timeline-context-item, .today-center-timeline-project-plan")) return;
          if (track.classList.contains("is-resizing-task") || this.timelineDragTaskId) return;
          const originX = event.clientX;
          const originY = event.clientY;
          const startDate = eventDate(event);
          if (!startDate) return;
          const trackRectAtStart = track.getBoundingClientRect();
          const logicalTrackHeight = track.offsetHeight || track.clientHeight || trackRectAtStart.height;
          const visualScaleY = logicalTrackHeight > 0 ? trackRectAtStart.height / logicalTrackHeight : 1;
          const safeScaleY = Number.isFinite(visualScaleY) && visualScaleY > 0 ? visualScaleY : 1;
          const rowStep = 37;
          const taskOffset = Number(track.dataset.timelineTaskOffset || 0);
          const rowTop = 10 + (Number.isFinite(taskOffset) ? taskOffset : 0);
          const localStartY = (originY - trackRectAtStart.top) / safeScaleY;
          const clickedRow = Math.max(0, Math.round((localStartY - (rowTop + 15)) / rowStep));
          const markerTop = Math.max(rowTop, Math.min(rowTop + clickedRow * rowStep, Math.max(rowTop, logicalTrackHeight - 40)));
          let active = false;
          let endDate = startDate;
          let marker = null;
          const updateMarker = (clientX) => {
            const synthetic = { clientX };
            const rawEnd = eventDate(synthetic) || startDate;
            const first = rawEnd < startDate ? rawEnd : startDate;
            const last = rawEnd < startDate ? startDate : rawEnd;
            endDate = last;
            const startCoord = this.timelineCoordinate(parseDateOnly(first), windowData);
            const endExclusive = parseDateOnly(last);
            endExclusive.setDate(endExclusive.getDate() + 1);
            const endCoord = this.timelineCoordinate(endExclusive, windowData);
            if (!marker) {
              marker = document.createElement("div");
              marker.className = "today-center-timeline-create-marker is-range-drag";
              marker.style.setProperty("--timeline-top", `${markerTop}px`);
              track.appendChild(marker);
            }
            marker.style.setProperty("--timeline-left", `${(Math.max(0, startCoord) / windowData.unitCount) * 100}%`);
            marker.style.setProperty("--timeline-width", `${((Math.max(.06, Math.min(windowData.unitCount, endCoord) - Math.max(0, startCoord))) / windowData.unitCount) * 100}%`);
          };
          const onMove = (moveEvent) => {
            if (moveEvent.pointerId !== event.pointerId) return;
            const dx = moveEvent.clientX - originX;
            const dy = moveEvent.clientY - originY;
            if (!active && Math.hypot(dx, dy) < TODAY_POINTER_DRAG_THRESHOLD) return;
            if (!active) active = true;
            moveEvent.preventDefault();
            updateMarker(moveEvent.clientX);
          };
          const cleanup = () => {
            window.removeEventListener("pointermove", onMove, true);
            window.removeEventListener("pointerup", onUp, true);
            window.removeEventListener("pointercancel", onCancel, true);
            document.removeEventListener("keydown", onKeyDown, true);
            marker?.remove();
            marker = null;
          };
          const onUp = (upEvent) => {
            if (upEvent.pointerId !== event.pointerId) return;
            if (!active) { cleanup(); return; }
            upEvent.preventDefault();
            const rawEnd = eventDate(upEvent) || endDate;
            const first = rawEnd < startDate ? rawEnd : startDate;
            const last = rawEnd < startDate ? startDate : rawEnd;
            cleanup();
            this.openTimelineQuickCreate(list, group, first, upEvent, track, windowData, last);
          };
          const onCancel = (cancelEvent) => { if (cancelEvent.pointerId === event.pointerId) cleanup(); };
          const onKeyDown = (keyEvent) => { if (keyEvent.key === "Escape") { keyEvent.preventDefault(); cleanup(); } };
          window.addEventListener("pointermove", onMove, true);
          window.addEventListener("pointerup", onUp, true);
          window.addEventListener("pointercancel", onCancel, true);
          document.addEventListener("keydown", onKeyDown, true);
        });
        track.addEventListener("dragover", (event) => {
          if (!this.timelineDragTaskId) return;
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
          track.classList.add("is-drag-over");
        });
        track.addEventListener("dragleave", () => track.classList.remove("is-drag-over"));
        track.addEventListener("drop", async (event) => {
          if (!this.timelineDragTaskId) return;
          event.preventDefault();
          track.classList.remove("is-drag-over");
          const task = this.store.data.tasks.find((item) => item.id === this.timelineDragTaskId);
          const dueDate = eventDate(event);
          this.timelineDragTaskId = null;
          if (task) await this.moveTimelineTask(task, group, dueDate);
        });

        // Generic planning annotations remain a compact context band. Project
        // tasks are handled separately below so their phases/milestones are
        // embedded into one parent rail instead of consuming three unrelated
        // vertical layers (phase + milestone + duplicate project task bar).
        const planningCandidates = group.tasks
          .flatMap((task) => this.timelinePlanningEntries(task, windowData)
            .filter((entry) => task.timelineRole !== "project" || entry.kind === "window"))
          .filter((entry) => entry.range && entry.range.start < windowData.unitCount && entry.range.end > 0)
          .sort((a, b) => a.range.startMs - b.range.startMs || a.range.endExclusiveMs - b.range.endExclusiveMs);

        const planningLaneEnds = [];
        for (const entry of planningCandidates) {
          const visibleStart = Math.max(0, entry.range.start);
          const visibleEnd = Math.min(windowData.unitCount, entry.range.end);
          if (visibleEnd <= visibleStart) continue;
          let rowIndex = planningLaneEnds.findIndex((endExclusiveMs) => entry.range.startMs >= endExclusiveMs);
          if (rowIndex < 0) {
            rowIndex = planningLaneEnds.length;
            planningLaneEnds.push(entry.range.endExclusiveMs);
          } else {
            planningLaneEnds[rowIndex] = entry.range.endExclusiveMs;
          }

          const planningEl = document.createElement("div");
          planningEl.className = `today-center-timeline-context-item is-${entry.kind}`;
          planningEl.style.setProperty("--timeline-left", `${(visibleStart / windowData.unitCount) * 100}%`);
          planningEl.style.setProperty("--timeline-width", `${((Math.max(0.025, visibleEnd - visibleStart)) / windowData.unitCount) * 100}%`);
          planningEl.style.setProperty("--timeline-top", `${7 + rowIndex * 25}px`);
          planningEl.title = entry.kind === "phase"
            ? `阶段 · ${entry.title} · ${entry.range.startValue} – ${entry.range.endValue}`
            : entry.kind === "window"
              ? `可执行窗口 · ${entry.title} · ${entry.range.startValue} – ${entry.range.endValue}`
              : `里程碑 · ${entry.title} · ${entry.range.startValue}`;
          planningEl.addEventListener("click", (event) => {
            event.stopPropagation();
            if (planningEl.dataset.suppressClick === "1") return;
            this.plugin.openTaskDetail(entry.task.id, event.currentTarget);
          });

          if (entry.kind === "milestone") {
            const diamond = document.createElement("span");
            diamond.className = "today-center-timeline-milestone-diamond";
            const text = document.createElement("span");
            text.className = "today-center-timeline-context-text";
            text.textContent = entry.title;
            planningEl.append(diamond, text);
          } else if (entry.kind === "window") {
            const rail = document.createElement("span");
            rail.className = "today-center-timeline-window-rail";
            const text = document.createElement("span");
            text.className = "today-center-timeline-context-text";
            text.textContent = entry.title;
            planningEl.append(rail, text);
            this.bindTimelineWindowInteraction(planningEl, entry.task, track, windowData, entry.range);
            if (entry.task.done && entry.task.completedAt) {
              const completedDate = new Date(entry.task.completedAt);
              completedDate.setHours(0, 0, 0, 0);
              const completedCoord = this.timelineCoordinate(completedDate, windowData);
              if (completedCoord >= visibleStart && completedCoord <= visibleEnd) {
                const marker = document.createElement("span");
                marker.className = "today-center-timeline-window-complete";
                const relative = Math.max(0, Math.min(1, (completedCoord - visibleStart) / Math.max(0.001, visibleEnd - visibleStart)));
                marker.style.left = `${relative * 100}%`;
                marker.textContent = "✓";
                planningEl.appendChild(marker);
              }
            }
          } else {
            const text = document.createElement("span");
            text.className = "today-center-timeline-context-text";
            text.textContent = entry.title;
            planningEl.appendChild(text);
          }
          track.appendChild(planningEl);
        }

        const genericContextHeight = planningLaneEnds.length ? planningLaneEnds.length * 25 + 5 : 0;

        const projectCandidates = group.tasks
          .filter((task) => task.timelineRole === "project")
          .map((task) => {
            const phaseLayout = this.timelineProjectPhaseLayout(task);
            return {
              task,
              range: this.timelineProjectRange(task, windowData),
              phaseLayout,
              planHeight: 44 + Math.max(0, phaseLayout.laneCount - 1) * 8,
            };
          })
          .filter((item) => item.range && item.range.start < windowData.unitCount && item.range.end > 0)
          .sort((a, b) => a.range.startMs - b.range.startMs || a.range.endExclusiveMs - b.range.endExclusiveMs);

        // Project rails themselves can overlap in time. Pack them first so a
        // project with stacked internal phases reserves exactly the vertical
        // space it needs without pushing every project to a fixed 52px row.
        const projectRows = [];
        for (const item of projectCandidates) {
          let rowIndex = projectRows.findIndex((row) => item.range.startMs >= row.endExclusiveMs);
          if (rowIndex < 0) {
            rowIndex = projectRows.length;
            projectRows.push({ endExclusiveMs: item.range.endExclusiveMs, height: item.planHeight });
          } else {
            const row = projectRows[rowIndex];
            row.endExclusiveMs = item.range.endExclusiveMs;
            row.height = Math.max(row.height, item.planHeight);
          }
          item.rowIndex = rowIndex;
        }
        const projectRowOffsets = [];
        let projectRowsHeight = 0;
        for (const row of projectRows) {
          projectRowOffsets.push(projectRowsHeight);
          projectRowsHeight += row.height + 8;
        }

        for (const item of projectCandidates) {
          const visibleStart = Math.max(0, item.range.start);
          const visibleEnd = Math.min(windowData.unitCount, item.range.end);
          if (visibleEnd <= visibleStart) continue;
          const rowIndex = item.rowIndex || 0;

          const plan = document.createElement("div");
          plan.className = "today-center-timeline-project-plan";
          if (item.range.start < 0) plan.classList.add("is-clipped-left");
          if (item.range.end > windowData.unitCount) plan.classList.add("is-clipped-right");
          plan.style.setProperty("--timeline-left", `${(visibleStart / windowData.unitCount) * 100}%`);
          plan.style.setProperty("--timeline-width", `${((visibleEnd - visibleStart) / windowData.unitCount) * 100}%`);
          plan.style.setProperty("--timeline-top", `${genericContextHeight + 6 + (projectRowOffsets[rowIndex] || 0)}px`);
          plan.style.setProperty("--project-plan-height", `${item.planHeight}px`);
          plan.style.setProperty("--project-phase-lanes", String(item.phaseLayout.laneCount));
          plan.style.setProperty("--project-base-top", `${28.5 + Math.max(0, item.phaseLayout.laneCount - 1) * 8}px`);
          plan.dataset.search = [item.task.title, item.task.content || "", ...(item.task.tags || [])].join(" ");
          plan.dataset.todayTaskId = item.task.id;
          plan.tabIndex = item.task.id === this.selectedTaskId ? 0 : -1;
          plan.setAttribute("role", "option");
          plan.setAttribute("aria-selected", item.task.id === this.selectedTaskId ? "true" : "false");
          if (item.task.id === this.selectedTaskId) plan.classList.add("is-selected");
          plan.title = `${item.task.title} · 规划主线 · 单击选择，双击或 Enter 打开，拖动整体调整主线和内部阶段`;
          plan.addEventListener("click", (event) => {
            event.stopPropagation();
            if (plan.dataset.suppressClick === "1") return;
            this.activateTaskFromPointer(item.task.id, plan, { spatial: true });
          });
          plan.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const preferredDate = this.timelineDateAtClientX(event.clientX, track, windowData) || this.suggestedPlanningDate(item.task);
            this.showProjectPlanningMenu(event, item.task, list, plan, preferredDate);
          });

          const titleEl = document.createElement("span");
          titleEl.className = "today-center-timeline-project-title";
          titleEl.textContent = item.task.title;
          const baseRail = document.createElement("span");
          baseRail.className = "today-center-timeline-project-base";
          const addPlan = document.createElement("button");
          addPlan.type = "button";
          addPlan.className = "today-center-timeline-project-add";
          addPlan.title = "添加阶段或里程碑";
          addPlan.appendChild(this.makeIcon("plus"));
          addPlan.addEventListener("pointerdown", (event) => event.stopPropagation());
          addPlan.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.showPlanningAddMenu(event, item.task, addPlan, this.suggestedPlanningDate(item.task));
          });
          plan.append(titleEl, baseRail, addPlan);

          const projectSpan = Math.max(0.001, visibleEnd - visibleStart);
          for (const phase of (item.task.timelineItems || []).filter((entry) => entry.type === "phase")) {
            const phaseRange = this.timelinePlanningRange(phase.startDate, phase.endDate, windowData);
            if (!phaseRange) continue;
            const phaseStart = Math.max(visibleStart, phaseRange.start);
            const phaseEnd = Math.min(visibleEnd, phaseRange.end);
            if (phaseEnd <= phaseStart) continue;
            const phaseEl = document.createElement("span");
            phaseEl.className = "today-center-timeline-project-phase";
            const phaseLaneIndex = item.phaseLayout.laneById.get(phase.id) || 0;
            phaseEl.dataset.phaseLane = String(phaseLaneIndex);
            phaseEl.style.left = `${((phaseStart - visibleStart) / projectSpan) * 100}%`;
            phaseEl.style.width = `${((phaseEnd - phaseStart) / projectSpan) * 100}%`;
            const overlapLift = Math.max(0, item.phaseLayout.laneCount - 1) * 8;
            // Keep the primary phase on the main rail. Overlapping phases are
            // compact annotation brackets above it instead of full stacked rails.
            phaseEl.style.top = phaseLaneIndex === 0
              ? `${14 + overlapLift}px`
              : `${14 + (phaseLaneIndex - 1) * 8}px`;
            const phaseLabel = document.createElement("span");
            phaseLabel.className = "today-center-timeline-project-phase-label";
            phaseLabel.textContent = phase.title || "阶段";
            phaseEl.appendChild(phaseLabel);
            phaseEl.title = `${phase.title || "阶段"} · ${phase.startDate} – ${phase.endDate} · 拖动移动，拖两端调整范围`;
            this.bindProjectPhaseInteraction(phaseEl, plan, item.task, phase, track, windowData, visibleStart, visibleEnd);
            plan.appendChild(phaseEl);
          }

          for (const milestone of (item.task.timelineItems || []).filter((entry) => entry.type === "milestone" && entry.date)) {
            const milestoneDate = parseDateOnly(milestone.date);
            if (!milestoneDate) continue;
            milestoneDate.setHours(0, 0, 0, 0);
            const coord = this.timelineDateCenterCoordinate(milestoneDate, windowData);
            if (coord < visibleStart || coord > visibleEnd) continue;
            const milestoneEl = document.createElement("span");
            milestoneEl.className = "today-center-timeline-project-milestone";
            milestoneEl.style.left = `${((coord - visibleStart) / projectSpan) * 100}%`;
            milestoneEl.style.top = `${24 + Math.max(0, item.phaseLayout.laneCount - 1) * 8}px`;
            milestoneEl.title = `${milestone.title || "节点"} · ${milestone.date}`;
            const diamond = document.createElement("span");
            diamond.className = "today-center-timeline-project-milestone-diamond";
            const labelText = document.createElement("span");
            labelText.className = "today-center-timeline-project-milestone-label";
            labelText.textContent = milestone.title || "节点";
            milestoneEl.append(diamond, labelText);
            milestoneEl.title = `${milestone.title || "节点"} · ${milestone.date} · 左右拖动调整日期`;
            this.bindProjectMilestoneInteraction(milestoneEl, plan, item.task, milestone, track, windowData, visibleStart, visibleEnd);
            plan.appendChild(milestoneEl);
          }

          this.bindTimelineMoveBar(plan, item.task, track, group, list, windowData);
          track.appendChild(plan);
        }

        const projectContextHeight = projectRows.length ? Math.max(0, projectRowsHeight - 8) + 2 : 0;
        const contextHeight = genericContextHeight + projectContextHeight;
        track.dataset.timelineTaskOffset = String(contextHeight);

        const candidates = group.tasks
          .filter((task) => task.timelineRole !== "project")
          .map((task) => ({ task, range: this.timelineTaskRange(task, windowData) }))
          .filter((item) => item.range && item.range.start < windowData.unitCount && item.range.end > 0)
          .sort((a, b) => a.range.startMs - b.range.startMs || b.range.endExclusiveMs - b.range.startMs - (a.range.endExclusiveMs - a.range.startMs));

        // Each lane stores the real calendar end-exclusive boundary instead of
        // the clipped visual coordinate. Adjacent tasks can therefore reuse a
        // row exactly at the next day's boundary, while true overlaps still
        // stack onto a new row at every zoom scale.
        const laneEnds = [];
        for (const item of candidates) {
          const visibleStart = Math.max(0, item.range.start);
          const visibleEnd = Math.min(windowData.unitCount, item.range.end);
          if (visibleEnd <= visibleStart) continue;
          let rowIndex = laneEnds.findIndex((endExclusiveMs) => item.range.startMs >= endExclusiveMs);
          if (rowIndex < 0) {
            rowIndex = laneEnds.length;
            laneEnds.push(item.range.endExclusiveMs);
          } else {
            laneEnds[rowIndex] = item.range.endExclusiveMs;
          }

          const bar = document.createElement("div");
          bar.className = `today-center-timeline-bar priority-${item.task.priority || 0}${item.task.timelineRole === "project" ? " is-project" : ""}`;
          if (item.task.done) bar.classList.add("is-done");
          if (item.task.repeat) bar.classList.add("is-repeat");
          if (item.range.start < 0) bar.classList.add("is-clipped-left");
          if (item.range.end > windowData.unitCount) bar.classList.add("is-clipped-right");
          bar.style.setProperty("--timeline-left", `${(visibleStart / windowData.unitCount) * 100}%`);
          bar.style.setProperty("--timeline-width", `${((visibleEnd - visibleStart) / windowData.unitCount) * 100}%`);
          bar.style.setProperty("--timeline-top", `${contextHeight + 10 + rowIndex * 37}px`);
          bar.title = `${item.task.title} · ${dateLabel(item.task)} · 拖动整体改期，拖动左右边缘调整时间范围`;
          bar.dataset.search = [item.task.title, item.task.content || "", ...(item.task.tags || [])].join(" ");
          bar.dataset.todayTaskId = item.task.id;
          bar.tabIndex = item.task.id === this.selectedTaskId ? 0 : -1;
          bar.setAttribute("role", "option");
          bar.setAttribute("aria-selected", item.task.id === this.selectedTaskId ? "true" : "false");
          if (item.task.id === this.selectedTaskId) bar.classList.add("is-selected");
          bar.draggable = false;
          bar.addEventListener("click", (event) => {
            event.stopPropagation();
            if (bar.dataset.suppressClick === "1") return;
            this.activateTaskFromPointer(item.task.id, bar, { spatial: true });
          });
          bar.addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopPropagation(); this.showTimelineTaskMenu(event, item.task, list, bar); });

          const startHandle = document.createElement("span");
          startHandle.className = "today-center-timeline-resize-handle is-start";
          startHandle.title = "拖动调整开始日期";
          startHandle.setAttribute("aria-label", "调整开始日期");
          startHandle.draggable = false;

          const barText = document.createElement("span");
          barText.className = "today-center-timeline-bar-text";
          barText.textContent = item.task.title;

          const endHandle = document.createElement("span");
          endHandle.className = "today-center-timeline-resize-handle is-end";
          endHandle.title = "拖动调整结束日期";
          endHandle.setAttribute("aria-label", "调整结束日期");
          endHandle.draggable = false;

          bar.append(startHandle, barText, endHandle);
          this.bindTimelineResizeHandle(startHandle, "start", bar, item.task, track, windowData);
          this.bindTimelineResizeHandle(endHandle, "end", bar, item.task, track, windowData);
          this.bindTimelineMoveBar(bar, item.task, track, group, list, windowData);
          track.appendChild(bar);
        }
        const normalTaskHeight = laneEnds.length ? laneEnds.length * 37 + 20 : 12;
        track.style.setProperty("--timeline-track-height", `${Math.max(44, contextHeight + normalTaskHeight)}px`);
      } else {
        track.style.setProperty("--timeline-track-height", "44px");
      }

      lane.appendChild(track);
      canvas.appendChild(lane);
    }

    // Keep the title of a long task inside the visible part of its bar while
    // horizontally scrolling the timeline. TickTick uses the same idea: the
    // time block keeps its real duration, but the label follows the viewport
    // until the right edge of the task is reached.
    let stickyLabelRaf = 0;
    const updateTimelineBarLabels = () => {
      const canvasRect = canvas.getBoundingClientRect();
      const stickyGroupRect = first.getBoundingClientRect();
      const visibleLeft = Math.max(canvasRect.left, stickyGroupRect.right) + 8;
      const visibleRight = canvasRect.right - 8;

      canvas.querySelectorAll(".today-center-timeline-bar, .today-center-timeline-project-plan").forEach((bar) => {
        const rect = bar.getBoundingClientRect();
        if (!rect.width || rect.right <= visibleLeft || rect.left >= visibleRight) {
          bar.style.setProperty("--timeline-label-shift", "0px");
          return;
        }

        // Only shift when the task's natural left edge has moved underneath
        // the sticky group column / outside the visible timeline viewport.
        // Leave a small amount of bar width available so the label fades out
        // naturally when the task itself is almost completely off screen.
        const desiredClient = Math.max(0, visibleLeft - rect.left);
        // getBoundingClientRect() is measured after the Task Center's visual
        // scale (130% by default), while CSS translate values are specified in
        // the bar's unscaled layout pixels. Convert between the two spaces so
        // the sticky label lands exactly at the timeline viewport edge instead
        // of drifting too far right on scaled modals.
        const layoutWidth = bar.offsetWidth || bar.clientWidth || rect.width || 1;
        const scaleX = rect.width > 0 ? rect.width / layoutWidth : 1;
        const desired = desiredClient / Math.max(0.01, scaleX);
        const maxShift = Math.max(0, layoutWidth - 34);
        const shift = Math.min(desired, maxShift);
        bar.style.setProperty("--timeline-label-shift", `${shift.toFixed(2)}px`);
      });
    };
    const scheduleTimelineBarLabelUpdate = () => {
      if (stickyLabelRaf) return;
      stickyLabelRaf = requestAnimationFrame(() => {
        stickyLabelRaf = 0;
        updateTimelineBarLabels();
      });
    };
    canvas.addEventListener("scroll", scheduleTimelineBarLabelUpdate, { passive:true });
    requestAnimationFrame(updateTimelineBarLabels);

    wrap.appendChild(canvas);
    return wrap;
  }

  tagMap() {
    const tags = new Map();
    // Tag search is a discovery view: explicit subtask tags are searchable,
    // while the main list keeps its parent/child hierarchy unchanged.
    for (const task of this.store.data.tasks) {
      for (const tag of task.tags || []) {
        if (!tags.has(tag)) tags.set(tag, []);
        tags.get(tag).push(task);
      }
    }
    return tags;
  }

  renderTags() {
    const tags = this.tagMap();
    const panel = document.createElement("div");
    panel.className = "today-center-tag-view";
    const sidebar = document.createElement("aside");
    sidebar.className = "today-center-tag-sidebar";

    const search = document.createElement("label");
    search.className = "today-center-tag-search";
    search.appendChild(this.makeIcon("search", "today-center-search-icon"));
    const input = document.createElement("input");
    input.placeholder = "搜索标签";
    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      sidebar.querySelectorAll(".today-center-tag-item").forEach((node) => {
        node.classList.toggle("today-center-search-hidden", !!q && !(node.dataset.tag || "").toLowerCase().includes(q));
      });
    });
    search.appendChild(input);
    sidebar.appendChild(search);

    const label = document.createElement("div");
    label.className = "today-center-side-label";
    label.textContent = "常用标签";
    sidebar.appendChild(label);

    const sorted = [...tags.entries()].sort((a, b) => b[1].length - a[1].length);
    if (!this.selectedTag || !tags.has(this.selectedTag)) this.selectedTag = sorted[0]?.[0] || "";
    for (const [tag, tasks] of sorted) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "today-center-tag-item";
      b.dataset.tag = tag;
      b.dataset.search = tag;
      if (tag === this.selectedTag) b.classList.add("is-active");
      const symbol = document.createElement("span");
      symbol.className = "today-center-tag-symbol";
      symbol.textContent = "#";
      const name = document.createElement("span");
      name.textContent = tag;
      const count = document.createElement("span");
      count.className = "today-center-side-count";
      count.textContent = String(tasks.length);
      b.append(symbol, name, count);
      b.addEventListener("click", () => {
        this.selectedTag = tag;
        this.render();
      });
      sidebar.appendChild(b);
    }

    const main = document.createElement("main");
    main.className = "today-center-tag-main";
    if (!this.selectedTag) {
      main.appendChild(this.renderViewState({
        kind: "empty",
        icon: "tag",
        title: "还没有标签",
        description: "给任务添加标签后，会在这里聚合显示。",
      }));
      panel.append(sidebar, main);
      return panel;
    }

    const tasks = tags.get(this.selectedTag) || [];
    const hero = document.createElement("div");
    hero.className = "today-center-tag-hero";
    const heroInfo = document.createElement("div");
    const heroTitle = document.createElement("div");
    heroTitle.className = "today-center-tag-title";
    const sym = document.createElement("span");
    sym.className = "today-center-tag-symbol";
    sym.textContent = "#";
    heroTitle.append(sym, document.createTextNode(this.selectedTag));
    heroInfo.appendChild(heroTitle);
    const more = document.createElement("button");
    more.type = "button";
    more.className = "today-center-action today-center-action-icon-only";
    more.appendChild(this.makeIcon("ellipsis", "today-center-action-icon"));
    more.setAttribute("aria-label", `管理标签 ${this.selectedTag}`);
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      const source = this.selectedTag;
      const menu = new Menu();
      menu.addItem((item) => item.setTitle("重命名标签").setIcon("pencil").onClick(() => new TagManageModal(this.app, this.plugin, source, "rename", this).open()));
      menu.addItem((item) => item.setTitle("合并到其他标签").setIcon("git-merge").onClick(() => new TagManageModal(this.app, this.plugin, source, "merge", this).open()));
      menu.addSeparator();
      menu.addItem((item) => item.setTitle("移除标签").setIcon("trash-2").onClick(() => new TagManageModal(this.app, this.plugin, source, "delete", this).open()));
      const rect = more.getBoundingClientRect();
      menu.showAtPosition({ x: rect.right, y: rect.bottom });
    });
    hero.append(heroInfo, more);
    main.appendChild(hero);

    const incomplete = tasks.filter((t) => !t.done).length;
    const totalMinutes = tasks.reduce((sum, t) => sum + this.plannedMinutes(t), 0);
    const activeDays = new Set(tasks.map((t) => t.dueDate).filter(Boolean)).size;
    const metrics = document.createElement("div");
    metrics.className = "today-center-tag-metrics";
    metrics.append(
      this.renderSummaryCard("未完成", incomplete, "仍在进行"),
      this.renderSummaryCard("记录投入", this.formatDuration(totalMinutes), "来自时间段任务"),
      this.renderSummaryCard("活跃天数", activeDays, "有任务记录的日期")
    );
    main.appendChild(metrics);

    const relatedCounts = new Map();
    for (const task of tasks) {
      for (const tag of task.tags || []) {
        if (tag === this.selectedTag) continue;
        relatedCounts.set(tag, (relatedCounts.get(tag) || 0) + 1);
      }
    }
    const related = [...relatedCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (related.length) {
      const h = document.createElement("div");
      h.className = "today-center-section-head";
      const t = document.createElement("span");
      t.className = "today-center-section-title";
      t.textContent = "关联标签";
      h.appendChild(t);
      const chips = document.createElement("div");
      chips.className = "today-center-related-tags";
      for (const [tag] of related) chips.appendChild(this.makePill(`#${tag}`, "tag"));
      main.append(h, chips);
    }

    const active = tasks.filter((t) => !t.done);
    const done = tasks.filter((t) => t.done);
    this.renderSection("进行中", active, main, { metric: (task) => this.formatDuration(this.plannedMinutes(task)) });
    this.renderSection("已完成", done, main, { metric: (task) => this.formatDuration(this.plannedMinutes(task)) });

    panel.append(sidebar, main);
    return panel;
  }

  closeCalendarDayPopover({ restoreFocus = false } = {}) {
    const popover = this.calendarDayPopoverEl;
    const anchor = this.calendarDayPopoverAnchor;
    this.calendarDayPopoverCleanup?.();
    this.calendarDayPopoverCleanup = null;
    this.calendarDayPopoverEl = null;
    this.calendarDayPopoverDate = "";
    this.calendarDayPopoverAnchor = null;
    popover?.remove();
    if (restoreFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
  }

  openCalendarDayPopover(date, anchor) {
    if (this.calendarDayPopoverDate === date && this.calendarDayPopoverEl?.isConnected) {
      this.closeCalendarDayPopover({ restoreFocus: true });
      return;
    }
    this.closeCalendarDayPopover();
    const tasks = this.store.data.tasks.filter((task) => task.dueDate === date);
    const panel = document.createElement("section");
    panel.className = "today-plugin-root today-center-calendar-day-popover";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", `${date} 的全部任务`);
    const heading = document.createElement("div");
    heading.className = "today-center-calendar-day-heading";
    const title = document.createElement("strong");
    title.textContent = `${date.slice(5).replace("-", "月")}日 · ${tasks.length} 项`;
    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "关闭当天任务");
    close.appendChild(this.makeIcon("x"));
    close.addEventListener("click", () => this.closeCalendarDayPopover({ restoreFocus: true }));
    heading.append(title, close);
    panel.appendChild(heading);
    const rows = document.createElement("div");
    rows.className = "today-center-calendar-day-rows";
    for (const task of tasks) {
      const row = document.createElement("div");
      row.className = `today-center-calendar-day-row${task.done ? " is-done" : ""}`;
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "today-center-calendar-day-toggle";
      toggle.setAttribute("aria-label", task.done ? `恢复 ${task.title}` : `完成 ${task.title}`);
      toggle.appendChild(this.makeIcon(task.done ? "check-circle-2" : "circle"));
      toggle.addEventListener("click", async () => {
        this.closeCalendarDayPopover();
        await this.store.toggleTask(task.id);
      });
      const open = document.createElement("button");
      open.type = "button";
      open.className = "today-center-calendar-day-task";
      const label = document.createElement("span");
      label.className = "today-center-calendar-day-task-title";
      label.textContent = task.title;
      const parent = this.store.taskAncestors(task).map((item) => item.title).join(" / ");
      const meta = document.createElement("small");
      meta.textContent = [parent, task.dueTime].filter(Boolean).join(" · ");
      open.append(label, meta);
      open.addEventListener("click", () => {
        const anchorRect = open.getBoundingClientRect();
        this.closeCalendarDayPopover();
        this.plugin.openTaskDetail(task.id, anchorRect);
      });
      row.append(toggle, open);
      rows.appendChild(row);
    }
    panel.appendChild(rows);

    const add = document.createElement("button");
    add.type = "button";
    add.className = "today-center-calendar-day-add";
    add.append(this.makeIcon("plus"), document.createTextNode("添加当天任务"));
    add.addEventListener("click", () => {
      add.remove();
      const form = document.createElement("form");
      form.className = "today-center-calendar-day-add-form";
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "任务名称 · Enter 创建";
      input.setAttribute("aria-label", "当天新任务名称");
      form.appendChild(input);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const value = input.value.trim();
        if (!value) return;
        input.disabled = true;
        try {
          // A date explicitly selected in the calendar is a concrete dueDate;
          // other creation entry points retain their existing defaults.
          await this.store.addTask({ title: value, dueDate: date });
          this.closeCalendarDayPopover();
        } catch (error) {
          input.disabled = false;
          this.plugin.undoController?.showError?.("创建任务失败");
        }
      });
      panel.appendChild(form);
      input.focus({ preventScroll: true });
    });
    panel.appendChild(add);

    document.body.appendChild(panel);
    this.calendarDayPopoverEl = panel;
    this.calendarDayPopoverAnchor = anchor;
    this.calendarDayPopoverDate = date;
    const position = { placement: "bottom-end", gap: 5, padding: 8, strategy: "fixed" };
    this.plugin.floatingController?.place(panel, anchor, position);
    const stopPosition = this.plugin.floatingController?.autoUpdate(panel, anchor, position);
    const outside = (event) => {
      if (panel.contains(event.target) || anchor?.contains?.(event.target)) return;
      this.closeCalendarDayPopover();
    };
    const keydown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.closeCalendarDayPopover({ restoreFocus: true });
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", keydown, true);
    this.calendarDayPopoverCleanup = () => {
      stopPosition?.();
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", keydown, true);
    };
    this.plugin.motionController?.enterSurface?.(panel, "popover");
    requestAnimationFrame(() => {
      if (this.calendarDayPopoverEl === panel && panel.isConnected) close.focus({ preventScroll: true });
    });
  }

  monthKey(year, month) {
    return `${year}-${pad(month + 1)}`;
  }

  renderCalendar() {
    const panel = document.createElement("main");
    panel.className = "today-center-calendar";

    const toolbar = document.createElement("div");
    toolbar.className = "today-center-calendar-toolbar";
    const left = document.createElement("div");
    left.className = "today-center-calendar-left";
    const monthTitle = document.createElement("div");
    monthTitle.className = "today-center-calendar-title";
    monthTitle.textContent = `${this.calendarYear}年${this.calendarMonth + 1}月`;
    const nav = document.createElement("div");
    nav.className = "today-center-calendar-nav";
    const navButton = (icon, label, onClick) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-label", label);
      b.appendChild(this.makeIcon(icon, "today-center-calendar-nav-icon"));
      b.addEventListener("click", onClick);
      return b;
    };
    nav.append(
      navButton("chevron-left", "上个月", () => {
        this.calendarMonth -= 1;
        if (this.calendarMonth < 0) { this.calendarMonth = 11; this.calendarYear -= 1; }
        this.render();
      }),
      navButton("circle-dot", "本月", () => {
        const now = new Date(); this.calendarYear = now.getFullYear(); this.calendarMonth = now.getMonth(); this.render();
      }),
      navButton("chevron-right", "下个月", () => {
        this.calendarMonth += 1;
        if (this.calendarMonth > 11) { this.calendarMonth = 0; this.calendarYear += 1; }
        this.render();
      })
    );
    left.append(monthTitle, nav);

    const mode = document.createElement("div");
    mode.className = "today-center-calendar-mode";
    ["月", "周", "日程"].forEach((label, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      if (i === 0) b.classList.add("is-active");
      if (i > 0) b.addEventListener("click", () => new Notice(`${label}视图将在后续版本加入`));
      mode.appendChild(b);
    });
    toolbar.append(left, mode);
    panel.appendChild(toolbar);

    const grid = document.createElement("div");
    grid.className = "today-center-month-grid";
    const weekdays = document.createElement("div");
    weekdays.className = "today-center-month-weekdays";
    ["日", "一", "二", "三", "四", "五", "六"].forEach((d) => {
      const span = document.createElement("span"); span.textContent = d; weekdays.appendChild(span);
    });
    grid.appendChild(weekdays);

    const days = document.createElement("div");
    days.className = "today-center-month-days";
    const first = new Date(this.calendarYear, this.calendarMonth, 1);
    const start = new Date(this.calendarYear, this.calendarMonth, 1 - first.getDay());
    const today = todayISO();
    const byDate = new Map();
    for (const task of this.store.data.tasks) {
      if (!task.dueDate) continue;
      if (!byDate.has(task.dueDate)) byDate.set(task.dueDate, []);
      byDate.get(task.dueDate).push(task);
    }

    for (let i = 0; i < 42; i += 1) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const cell = document.createElement("div");
      cell.className = "today-center-month-cell";
      if (d.getMonth() !== this.calendarMonth) cell.classList.add("is-other");
      if (iso === today) cell.classList.add("is-today");

      const dateRow = document.createElement("div");
      dateRow.className = "today-center-month-date";
      const badge = document.createElement("span");
      badge.className = "today-center-month-date-badge";
      badge.textContent = String(d.getDate());
      dateRow.appendChild(badge);
      const cellTasks = byDate.get(iso) || [];
      if (cellTasks.length) {
        const load = document.createElement("span");
        load.className = "today-center-month-load";
        load.textContent = `${cellTasks.length} 项`;
        dateRow.appendChild(load);
      }
      cell.appendChild(dateRow);

      cellTasks.slice(0, 3).forEach((task) => {
        const chip = document.createElement("div");
        chip.className = "today-center-calendar-chip";
        if (task.priority === 1) chip.classList.add("p1");
        else if (task.priority === 2) chip.classList.add("p2");
        else if (task.priority === 3) chip.classList.add("p3");
        if (task.repeat) chip.classList.add("is-repeat");
        if (task.done) chip.classList.add("is-done");
        const suffix = task.dueTime ? ` · ${task.endTime ? `${task.dueTime}–${task.endTime}` : task.dueTime}` : "";
        chip.textContent = `${task.done ? "✓ " : ""}${task.title}${suffix}`;
        const ancestors = this.store.taskAncestors(task);
        chip.title = ancestors.length ? `${chip.textContent} · ${ancestors.map((item) => item.title).join(" / ")}` : chip.textContent;
        chip.dataset.search = [task.title, task.content || "", ...(task.tags || [])].join(" ");
        chip.addEventListener("click", (event) => { event.stopPropagation(); this.plugin.openTaskDetail(task.id, event.currentTarget); });
        cell.appendChild(chip);
      });
      if (cellTasks.length > 3) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "today-center-calendar-more";
        more.textContent = `+${cellTasks.length - 3}`;
        more.setAttribute("aria-label", `查看 ${iso} 的全部 ${cellTasks.length} 项任务`);
        more.addEventListener("click", (event) => {
          event.stopPropagation();
          this.openCalendarDayPopover(iso, more);
        });
        cell.appendChild(more);
      }
      days.appendChild(cell);
    }
    grid.appendChild(days);
    panel.appendChild(grid);
    return panel;
  }

  statsRangeDays() {
    if (this.statsRange === "7") return 7;
    if (this.statsRange === "year") {
      const now = new Date();
      const start = new Date(now.getFullYear(), 0, 1);
      return Math.max(1, Math.ceil((now - start) / 86400000) + 1);
    }
    return 30;
  }

  rangeTasks() {
    const days = this.statsRangeDays();
    return this.store.topLevelTasks().filter((task) => {
      if (!task.dueDate) return false;
      const diff = dayDiff(task.dueDate);
      return diff <= 0 && diff > -days;
    });
  }

  longestStreak(tasks) {
    const dates = [...new Set(tasks.map(completionDay).filter(Boolean))].sort();
    let best = 0;
    let current = 0;
    let prev = null;
    for (const date of dates) {
      if (!prev) current = 1;
      else current = dayDiff(date, prev) === 1 ? current + 1 : 1;
      best = Math.max(best, current);
      prev = date;
    }
    return best;
  }

  renderStatsRow(name, value, ratio) {
    const row = document.createElement("div");
    row.className = "today-center-stats-row";
    const n = document.createElement("span");
    n.className = "today-center-stats-row-name";
    n.textContent = name;
    const track = document.createElement("span");
    track.className = "today-center-stats-track";
    const fill = document.createElement("span");
    fill.style.width = `${Math.max(0, Math.min(100, ratio * 100))}%`;
    track.appendChild(fill);
    const v = document.createElement("span");
    v.className = "today-center-stats-row-value";
    v.textContent = value;
    row.append(n, track, v);
    return row;
  }

  renderStatsBox(title) {
    const box = document.createElement("section");
    box.className = "today-center-stats-box";
    const h = document.createElement("div");
    h.className = "today-center-stats-box-title";
    h.textContent = title;
    box.appendChild(h);
    return box;
  }

  renderStats() {
    const panel = document.createElement("main");
    panel.className = "today-center-stats";
    const head = document.createElement("div");
    head.className = "today-center-stats-head";
    const info = document.createElement("div");
    const title = document.createElement("div");
    title.className = "today-center-stats-title";
    title.textContent = "统计";
    info.appendChild(title);
    const range = document.createElement("div");
    range.className = "today-center-stats-range";
    [["7", "7天"], ["30", "30天"], ["year", "今年"]].forEach(([value, label]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      if (this.statsRange === value) b.classList.add("is-active");
      b.addEventListener("click", () => { this.statsRange = value; this.render(); });
      range.appendChild(b);
    });
    head.append(info, range);
    panel.appendChild(head);

    const tasks = this.rangeTasks();
    const completed = tasks.filter((t) => t.done);
    const completedCount = completed.length;
    const rangeDays = this.statsRangeDays();
    const completionTasks = this.store.topLevelTasks().filter((t) => {
      const day = completionDay(t);
      if (!day) return false;
      const diff = dayDiff(day);
      return diff <= 0 && diff > -rangeDays;
    });
    const plannedMinutes = tasks.reduce((sum, task) => sum + this.plannedMinutes(task), 0);
    const activeDays = new Set(tasks.map((t) => t.dueDate).filter(Boolean)).size;
    const rate = tasks.length ? Math.round(completedCount / tasks.length * 100) : 0;
    const streak = this.longestStreak(completionTasks);

    const summary = document.createElement("div");
    summary.className = "today-center-stats-summary";
    summary.append(
      this.renderSummaryCard("期间完成", completionTasks.length, "按实际完成日期"),
      this.renderSummaryCard("记录投入", this.formatDuration(plannedMinutes), `${activeDays} 个活跃日`),
      this.renderSummaryCard("最高连续", `${streak} 天`, "按完成日期计算"),
      this.renderSummaryCard("计划完成率", `${rate}%`, `${completedCount} / ${tasks.length || 0}`)
    );
    panel.appendChild(summary);

    const grid = document.createElement("div");
    grid.className = "today-center-stats-grid";

    const trend = this.renderStatsBox("最近 7 天完成趋势");
    const bars = document.createElement("div");
    bars.className = "today-center-weekly-bars";
    const now = parseDateOnly(todayISO());
    const dayLabels = ["日", "一", "二", "三", "四", "五", "六"];
    const counts = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const count = this.store.topLevelTasks().filter((t) => completionDay(t) === iso).length;
      counts.push({ label: dayLabels[d.getDay()], count });
    }
    const max = Math.max(1, ...counts.map((x) => x.count));
    counts.forEach(({ label, count }) => {
      const col = document.createElement("div");
      col.className = "today-center-bar-col";
      const track = document.createElement("div");
      track.className = "today-center-bar-track";
      const fill = document.createElement("div");
      fill.className = "today-center-bar-fill";
      fill.style.height = `${Math.max(7, Math.round(count / max * 100))}%`;
      fill.title = `${count} 项完成`;
      track.appendChild(fill);
      const day = document.createElement("span");
      day.className = "today-center-bar-day";
      day.textContent = label;
      col.append(track, day);
      bars.appendChild(col);
    });
    trend.appendChild(bars);

    const tagBox = this.renderStatsBox("标签投入");
    const tagList = document.createElement("div");
    tagList.className = "today-center-stats-list";
    const tagMinutes = new Map();
    for (const task of tasks) {
      const minutes = this.plannedMinutes(task);
      for (const tag of task.tags || []) tagMinutes.set(tag, (tagMinutes.get(tag) || 0) + minutes);
    }
    const tagRows = [...tagMinutes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxTag = Math.max(1, ...tagRows.map((x) => x[1]));
    if (!tagRows.length) {
      const empty = document.createElement("div"); empty.className = "today-center-stats-empty"; empty.textContent = "还没有带时间段的标签记录"; tagList.appendChild(empty);
    } else {
      tagRows.forEach(([tag, minutes]) => tagList.appendChild(this.renderStatsRow(`#${tag}`, this.formatDuration(minutes), minutes / maxTag)));
    }
    tagBox.appendChild(tagList);

    const listBox = this.renderStatsBox("清单分布");
    const listWrap = document.createElement("div");
    listWrap.className = "today-center-stats-list";
    const listCounts = this.store.data.lists.map((list) => [list.name, tasks.filter((t) => t.listId === list.id).length]).filter((x) => x[1]).sort((a, b) => b[1] - a[1]);
    const maxList = Math.max(1, ...listCounts.map((x) => x[1]));
    if (!listCounts.length) {
      const empty = document.createElement("div"); empty.className = "today-center-stats-empty"; empty.textContent = "暂无清单数据"; listWrap.appendChild(empty);
    } else {
      listCounts.forEach(([name, count]) => listWrap.appendChild(this.renderStatsRow(name, String(count), count / maxList)));
    }
    listBox.appendChild(listWrap);

    const focusBox = this.renderStatsBox("本期重点");
    const focus = document.createElement("div");
    focus.className = "today-center-focus-tags";
    const tagActiveDays = new Map();
    for (const task of tasks) {
      for (const tag of task.tags || []) {
        if (!tagActiveDays.has(tag)) tagActiveDays.set(tag, new Set());
        if (task.dueDate) tagActiveDays.get(tag).add(task.dueDate);
      }
    }
    [...tagActiveDays.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 6).forEach(([tag, dates]) => {
      focus.appendChild(this.makePill(`#${tag} · ${dates.size}天`, "tag"));
    });
    if (!focus.children.length) {
      const empty = document.createElement("div"); empty.className = "today-center-stats-empty"; empty.textContent = "添加标签后会在这里看到重点主题"; focus.appendChild(empty);
    }
    focusBox.appendChild(focus);

    grid.append(trend, tagBox, listBox, focusBox);
    panel.appendChild(grid);
    return panel;
  }
}



class TodaySettingsTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Today Sidebar" });
    containerEl.createEl("p", {
      text: "调整任务中心界面的显示比例与内容密度。",
      cls: "setting-item-description",
    });

    const settings = this.plugin.data.settings;
    const applyLive = async () => {
      await this.plugin.saveData(this.plugin.data);
      if (this.plugin.centerModal?.isOpen) this.plugin.centerModal.applyAppearanceSettings();
      const fontSize = Math.max(12, Math.min(20, Number(settings.taskContentFontSize) || 15));
      document.querySelectorAll(".today-task-detail").forEach((el) => {
        el.style.setProperty("--today-task-content-font-size", `${fontSize}px`);
      });
    };

    new Setting(containerEl)
      .setName("任务中心界面缩放")
      .setDesc("同时放大文字、图标、任务行和时间线。2K 屏默认 130%。")
      .addSlider((slider) =>
        slider
          .setLimits(90, 150, 5)
          .setValue(Math.round((settings.centerScale || 1.30) * 100))
          .setDynamicTooltip()
          .onChange(async (value) => {
            settings.centerScale = value / 100;
            await applyLive();
          })
      );

    new Setting(containerEl)
      .setName("任务内容字号")
      .setDesc("调整右侧 Content 与时间线任务详情中的正文/编辑字号。默认 15px。")
      .addSlider((slider) =>
        slider
          .setLimits(12, 20, 0.5)
          .setValue(Number(settings.taskContentFontSize) || 15)
          .setDynamicTooltip()
          .onChange(async (value) => {
            settings.taskContentFontSize = value;
            await applyLive();
          })
      );

    new Setting(containerEl)
      .setName("任务中心宽度")
      .setDesc("调整任务中心内容宽度；窗口较小时会自动适配。")
      .addSlider((slider) =>
        slider
          .setLimits(900, 1800, 20)
          .setValue(settings.centerWidth || 1480)
          .setDynamicTooltip()
          .onChange(async (value) => {
            settings.centerWidth = value;
            await applyLive();
          })
      );

    new Setting(containerEl)
      .setName("任务中心高度")
      .setDesc("调整任务中心内容高度；窗口较小时会自动适配。")
      .addSlider((slider) =>
        slider
          .setLimits(620, 1100, 20)
          .setValue(settings.centerHeight || 920)
          .setDynamicTooltip()
          .onChange(async (value) => {
            settings.centerHeight = value;
            await applyLive();
          })
      );

    new Setting(containerEl)
      .setName("恢复推荐尺寸")
      .setDesc("恢复到推荐的 130% 缩放、1480 × 920。")
      .addButton((button) =>
        button.setButtonText("恢复").onClick(async () => {
          settings.centerScale = 1.30;
          settings.centerWidth = 1480;
          settings.centerHeight = 920;
          settings.sizingVersion = 3;
          await applyLive();
          this.display();
        })
      );
  }
}

class TodayPlugin extends Plugin {
  async saveData(data) {
    try {
      await super.saveData(data);
      return true;
    } catch (error) {
      console.error("[Today] Failed to save plugin data", error);
      const retry = async () => {
        try {
          await super.saveData(data);
          return true;
        } catch (retryError) {
          console.error("[Today] Retry save failed", retryError);
          return false;
        }
      };
      if (this.undoController) this.undoController.showError("保存失败，修改仍保留在当前会话中", retry);
      else new Notice("Today：保存失败，任务数据暂未写入磁盘");
      return false;
    }
  }

  cleanupTaskDetailOrphans() {
    if (typeof document === "undefined") return;
    document.querySelectorAll([
      ".today-task-detail-footer-floating",
      ".today-task-detail-footer-popover",
      ".today-task-detail-container-menu",
      ".today-task-detail-priority-popover",
      ".today-task-detail-date-popover",
      ".today-task-context-menu",
      ".today-undo-toast",
    ].join(",")).forEach((node) => node.remove());
  }

  async onload() {
    this.cleanupTaskDetailOrphans();
    this.data = normalizeData(await this.loadData());
    await this.saveData(this.data);
    this.motionController = new TodayMotionController(this);
    this.motionController.start();
    this.floatingController = new TodayFloatingController();
    this.undoController = new TodayUndoController(this);
    this.store = new TaskStore(this);
    this.taskContextMenuController = new TaskContextMenuController(this);

    this.registerView(SIDEBAR_VIEW, (leaf) => new TodaySidebarView(leaf, this));
    this.registerView(CENTER_VIEW, (leaf) => new TaskCenterView(leaf, this, "lists"));
    this.centerModal = null;
    this.taskDetailModal = null;

    this.addRibbonIcon("list-checks", "打开 Today", () => this.openSidebar(true));
    this.addCommand({
      id: "open-today-sidebar",
      name: "打开 Today 侧边栏",
      callback: () => this.openSidebar(true),
    });
    this.addCommand({
      id: "open-task-center",
      name: "打开任务中心",
      callback: () => this.openCenter("lists"),
    });

    this.addSettingTab(new TodaySettingsTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.openSidebar(false);
      this.openCenter("lists");
    });
  }

  onunload() {
    this.taskContextMenuController?.close();
    this.taskContextMenuController = null;
    this.undoController?.dispose();
    this.undoController = null;
    this.motionController?.dispose();
    this.motionController = null;
    this.floatingController?.dispose();
    this.floatingController = null;
    this.cleanupTaskDetailOrphans();
    this.app.workspace.detachLeavesOfType(SIDEBAR_VIEW);
    this.app.workspace.detachLeavesOfType(CENTER_VIEW);
    if (this.taskDetailModal) this.taskDetailModal.close();
    this.centerModal = null;
  }

  async openSidebar(reveal = true) {
    let leaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW);
    let leaf = leaves[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: SIDEBAR_VIEW, active: true });
    }
    if (reveal) this.app.workspace.revealLeaf(leaf);
  }

  openTaskContextMenu(event, taskOrId, options = {}) {
    if (!this.taskContextMenuController) this.taskContextMenuController = new TaskContextMenuController(this);
    this.taskContextMenuController.open(event, taskOrId, options);
  }

  openTaskDetail(taskId, anchor = null) {
    if (!this.store.getTask(taskId)) return;
    // Spatial Board/Timeline detail replaces the docked Content command layer.
    this.centerModal?.inlineTaskDetail?.disposeFunctionalUi?.({ includeFooter: true });
    if (this.taskDetailModal) {
      if (anchor) this.taskDetailModal.setAnchor(anchor);
      this.taskDetailModal.setTask(taskId);
      return;
    }
    this.motionController?.markDetailSwitch(taskId, "spatial");
    this.taskDetailModal = new TaskDetailModal(this.app, this, taskId, anchor);
    this.taskDetailModal.open();
  }

  openCenter(tab = "lists") {
    const leaves = this.app.workspace.getLeavesOfType(CENTER_VIEW);
    const existing = leaves[0];
    if (existing && existing.view instanceof TaskCenterView) {
      this.centerModal = existing.view;
      this.centerModal.setTab(tab);
      this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    void leaf.setViewState({ type: CENTER_VIEW, active: true }).then(() => {
      if (!(leaf.view instanceof TaskCenterView)) return;
      this.centerModal = leaf.view;
      this.centerModal.setTab(tab);
      this.app.workspace.revealLeaf(leaf);
    });
  }
}

export default TodayPlugin;
export { normalizeData };
