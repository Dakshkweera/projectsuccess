const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  hideWindow: () => {},
  quitApp: () => {},
  resizeWindow: () => {},
  captureScreenshot: () => {},
  autoAnalyzeScreen: () => {},
  openScreenRecordingSettings: () => {},
  getConfig: async () => ({}),
  saveConfig: async () => true,
  toggleTray: async () => true,
  onScreenshot: cb => ipcRenderer.on('screenshot-captured', (_, dataUrl) => cb(dataUrl)),
  onScreenshotError: cb => ipcRenderer.on('screenshot-error', (_, error) => cb(error)),
  onAutoAnalyzeScreen: cb => ipcRenderer.on('auto-analyze-screen', (_, dataUrl) => cb(dataUrl)),
  onCycleModel: cb => ipcRenderer.on('cycle-model', () => cb()),
  onPrevModel: cb => ipcRenderer.on('prev-model', () => cb()),
  onNewChat: cb => ipcRenderer.on('new-chat', () => cb()),
  onShortcutsUpdated: cb => ipcRenderer.on('shortcuts-updated', (_, data) => cb(data)),
});
