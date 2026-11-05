const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rwWindow', {
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
  close: () => ipcRenderer.send('win:close'),
  getAutoLaunch: () => ipcRenderer.invoke('app:get-auto-launch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('app:set-auto-launch', enabled),
  getCloseToTray: () => ipcRenderer.invoke('app:get-close-to-tray'),
  setCloseToTray: (enabled) => ipcRenderer.invoke('app:set-close-to-tray', enabled),
  researchFiles: (action, payload) => ipcRenderer.invoke('research:files', action, payload),
  migrateResearch: (sourceRoot) => ipcRenderer.invoke('research:migrate', sourceRoot),
  researchRequest: (options) => ipcRenderer.invoke('research:request', options),
  researchMetrics: (action, payload) => ipcRenderer.invoke('research:metrics', action, payload),
  researchRuntime: () => ipcRenderer.invoke('research:runtime'),
  chooseResearchSource: () => ipcRenderer.invoke('research:choose-source'),
  showResearchStorage: () => ipcRenderer.invoke('research:show-storage'),
  researchCliInfo: () => ipcRenderer.invoke('research:cli-info'),
  onCliRequest: (callback) => {
    const listener = (_event, request) => callback(request);
    ipcRenderer.on('research:cli-command', listener);
    return () => ipcRenderer.removeListener('research:cli-command', listener);
  },
  replyCliRequest: (id, result) => ipcRenderer.send('research:cli-result', id, result),
});
