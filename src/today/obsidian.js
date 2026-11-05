import { Plugin as BasePlugin } from '../port/obsidian.js';

export { ItemView, Modal, Notice, setIcon, PluginSettingTab, Setting, Menu, MarkdownRenderer } from '../port/obsidian.js';

// The runtime edits a projection owned by the native Workbench store. It never
// reads or writes the original Obsidian plugin directory or a second task file.
export class Plugin extends BasePlugin {
  async loadData() { return this.app.todayLoad(); }
  async saveData(data) { await this.app.todaySave(data); }
}
