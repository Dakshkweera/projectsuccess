const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  hideWindow:      ()          => ipcRenderer.send('hide-window'),
  quitApp:         ()          => ipcRenderer.send('quit-app'),
  resizeWindow:    (w, h)      => ipcRenderer.send('resize-window', { width: w, height: h }),
  captureScreenshot: ()        => ipcRenderer.send('capture-screenshot'),
  autoAnalyzeScreen: ()        => ipcRenderer.send('auto-analyze-screen'),
  openScreenRecordingSettings: () => ipcRenderer.send('open-screen-recording-settings'),
  getConfig:       ()          => ipcRenderer.invoke('get-config'),
  saveConfig:      (data)      => ipcRenderer.invoke('save-config', data),
  toggleTray:      (hide)      => ipcRenderer.invoke('toggle-tray', hide),
  onScreenshot:    (cb)        => ipcRenderer.on('screenshot-captured', (_, d) => cb(d)),
  onScreenshotError:(cb)       => ipcRenderer.on('screenshot-error',    (_, e) => cb(e)),
  onAutoAnalyzeScreen:(cb)     => ipcRenderer.on('auto-analyze-screen', (_, d) => cb(d)),
  onCycleModel:        (cb)     => ipcRenderer.on('cycle-model',         ()    => cb()),
  onPrevModel:         (cb)     => ipcRenderer.on('prev-model',          ()    => cb()),
  onNewChat:       (cb)        => ipcRenderer.on('new-chat',             ()    => cb()),
  onShortcutsUpdated:(cb)      => ipcRenderer.on('shortcuts-updated',    (_, d) => cb(d)),
  onOpacityChanged:(cb)        => ipcRenderer.on('opacity-changed',      (_, p) => cb(p)),
  onFocusInput:    (cb)        => ipcRenderer.on('focus-input',          ()    => cb()),
  onToggleVoice:   (cb)        => ipcRenderer.on('toggle-voice',         ()    => cb()),
  onLiveAnswer:    (cb)        => ipcRenderer.on('live-answer',          ()    => cb()),
});
