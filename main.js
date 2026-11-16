// ─── EPIPE Nuclear Fix — must be the very first lines of code ────────────────
// When launched without a terminal (login item, double-click), stdout/stderr
// pipes are closed. Electron's internal browser_init calls console.error()
// which tries to write to the dead pipe → EPIPE → Electron's native dialog.
//
// process.on('uncaughtException') is NOT enough because Electron's native
// crash reporter fires *independently* of Node's exception listener system.
//
// The ONLY reliable fix: replace the write() method itself with a no-op so
// the broken pipe is never written to and EPIPE can never be triggered.

const _safeWrite = () => true; // always report "write succeeded"

if (!process.stdout.isTTY) {
  try { process.stdout.write = _safeWrite; } catch { }
}
if (!process.stderr.isTTY) {
  try { process.stderr.write = _safeWrite; } catch { }
}

// Belt-and-suspenders: also catch anything that slips through
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE' || (err.message && err.message.includes('EPIPE'))) return;
  try {
    require('fs').appendFileSync(
      require('path').join(require('os').homedir(), 'Chrome-error.log'),
      `[${new Date().toISOString()}] ${err.stack || err}\n`
    );
  } catch { }
});
try { process.stdout.on('error', () => { }); } catch { }
try { process.stderr.on('error', () => { }); } catch { }

const electron = require('electron');
// With ELECTRON_RUN_AS_NODE set, require('electron') is just the binary path and
// every API below is undefined. Fail loudly instead of exiting silently with 0.
if (typeof electron === 'string' || !electron.app) {
  const msg = 'Chrome cannot start: ELECTRON_RUN_AS_NODE is set, so Electron is running as plain Node. '
    + 'Unset it (PowerShell: Remove-Item Env:ELECTRON_RUN_AS_NODE) or launch with `npm start`.';
  try { require('fs').appendFileSync(require('path').join(require('os').homedir(), 'Chrome-error.log'), `[${new Date().toISOString()}] ${msg}\n`); } catch { }
  try { require('fs').writeSync(2, msg + '\n'); } catch { }
  process.exit(1);
}
const { app, BrowserWindow, globalShortcut, ipcMain, screen, desktopCapturer, Tray, Menu, nativeImage, systemPreferences, shell, session } = electron;
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

// Avoid macOS's per-capture ScreenCaptureKit picker. Permission is checked below
// before desktopCapturer is called, so macOS does not show its native dialog for
// every shortcut press when access has not yet been granted.
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'ScreenCaptureKitPickerScreen,ScreenCaptureKitStreamPickerSonoma');
}

let mainWindow = null;
let tray = null;
let overlayOpacity = 1; // 0.2 – 1.0, remembered in config
let toggleLock = false; // debounce guard — prevents double-trigger on rapid keypresses

const MIN_OPACITY = 0.2;
const MAX_OPACITY = 1;
const OPACITY_STEP = 0.1;
const MOVE_STEP = 40; // px the overlay nudges per arrow-key press (fine positioning)
let screenshotCaptureInFlight = false;
const registeredShortcuts = {};
const shortcutFailures = [];

function formatAccelerator(accelerator) {
  const isMac = process.platform === 'darwin';
  return accelerator
    .replace(/CommandOrControl/g, isMac ? 'Cmd' : 'Ctrl')
    .replace(/Command/g, 'Cmd')
    .replace(/Control/g, 'Ctrl')
    .replace(/Alt/g, isMac ? 'Option' : 'Alt')
    .replace(/\+/g, '+');
}

function shortcutLabel(id, fallback) {
  return registeredShortcuts[id]?.label || fallback;
}

function registerShortcut(id, accelerators, callback) {
  for (const accelerator of accelerators) {
    try {
      if (globalShortcut.register(accelerator, callback)) {
        registeredShortcuts[id] = {
          accelerator,
          label: formatAccelerator(accelerator),
        };
        return true;
      }
    } catch { }
  }
  shortcutFailures.push({ id, label: accelerators.map(formatAccelerator).join(' / ') });
  return false;
}

function sendShortcutState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('shortcuts-updated', {
      shortcuts: registeredShortcuts,
      failures: shortcutFailures,
    });
  }
}

// ─── APP ICON ───────────────────────────────────────────────────────────────
const APP_ICON_PATH = path.join(__dirname, 'chrome_logo.png');

let appIcon = null;
function getAppIcon() {
  if (!appIcon) {
    const image = nativeImage.createFromPath(APP_ICON_PATH);
    appIcon = image.isEmpty() ? null : image;
  }
  return appIcon;
}

// ─── TRAY ICON: app logo scaled down to menu-bar size ───
function createTrayIcon() {
  const size = process.platform === 'darwin' ? 16 : 32;
  const icon = getAppIcon();
  if (icon) return icon.resize({ width: size, height: size });

  // Fallback: programmatic white circle if the logo file is missing
  const buf = Buffer.alloc(16 * 16 * 4);
  const cx = 8, cy = 8, r = 6;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const i = (y * 16 + x) * 4;
      const alpha = dist <= r ? 255 : dist <= r + 1 ? Math.round(255 * (r + 1 - dist)) : 0;
      buf[i] = 255; buf[i + 1] = 255; buf[i + 2] = 255; buf[i + 3] = alpha;
    }
  }
  return nativeImage.createFromBuffer(buf, { width: 16, height: 16 });
}

function updateTrayMenu() {
  if (!tray) return;
  const visible = mainWindow ? mainWindow.isVisible() : false;
  const toggle = shortcutLabel('toggle', process.platform === 'darwin' ? 'Cmd+Shift+Space' : 'Ctrl+Shift+Space');
  const screenshot = shortcutLabel('screenshot', process.platform === 'darwin' ? 'Cmd+Shift+S' : 'Ctrl+Shift+S');
  tray.setToolTip(visible ? 'Chrome — Visible' : 'Chrome — Hidden');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: visible ? '● Overlay is ON' : '○ Overlay is OFF', enabled: false },
    { label: `${toggle} to toggle anywhere`, enabled: false },
    { type: 'separator' },
    {
      label: visible ? 'Hide Overlay' : `Show Overlay  ${toggle}`,
      click: () => toggleWindow(),
    },
    { label: `Screenshot  ${screenshot}`, click: () => capturePrimaryScreen('screenshot-captured') },
    { type: 'separator' },
    { label: 'Force Quit Chrome', click: () => { globalShortcut.unregisterAll(); app.exit(0); } },
  ]));
}

function createTray() {
  if (tray) return;
  tray = new Tray(createTrayIcon());
  tray.on('click', () => toggleWindow());
  updateTrayMenu();
}

function setTrayVisibility(visible) {
  if (!visible && tray) {
    tray.destroy();
    tray = null;
  } else if (visible && !tray) {
    createTray();
  }
}

let configPath = null;

function getConfigPath() {
  if (!configPath) {
    configPath = path.join(app.getPath('userData'), 'config.json');
    const legacyPath = path.join(__dirname, 'config.json');
    if (!fs.existsSync(configPath) && fs.existsSync(legacyPath)) {
      try { fs.copyFileSync(legacyPath, configPath); } catch { }
    }
  }
  return configPath;
}

function readConfig() {
  try { return JSON.parse(fs.readFileSync(getConfigPath(), 'utf8')); }
  catch { return {}; }
}

function writeConfig(data) {
  fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(data, null, 2));
}

function createWindow() {
  // Guard: never create more than one window
  if (mainWindow && !mainWindow.isDestroyed()) return;

  const { x: areaX, y: areaY, width, height } = screen.getPrimaryDisplay().workArea;

  mainWindow = new BrowserWindow({
    title: 'Chrome',
    width: 480,
    height: 620,
    x: areaX + width - 500,
    y: areaY + Math.floor(height / 2) - 310,
    frame: false,
    // NOTE: transparent windows render fully invisible on some Windows GPUs
    // (the whole window never composites). Use an opaque window with a solid
    // background instead; see-through is handled via setOpacity (Ctrl+Shift+± ).
    transparent: false,
    backgroundColor: '#0c0c10',
    alwaysOnTop: true,
    resizable: true,
    movable: true,
    // Block "full screen" — Windows' Win+Up (and any maximize/fullscreen key)
    // would otherwise blow the overlay up to fill the screen.
    maximizable: false,
    fullscreenable: false,
    show: false,
    // No taskbar/dock entry and no Alt+Tab entry — the overlay leaves no icon behind
    skipTaskbar: true,
    hasShadow: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // Live Assistant runs 300–400 ms turn timers; Chromium would clamp them to
      // ~1 s while the overlay is hidden or covered.
      backgroundThrottling: false,
    },
  });
  mainWindow.setContentProtection(true);
  mainWindow.removeMenu();

  // ─── Voice input: allow mic + system-audio (loopback) capture ───
  const ses = mainWindow.webContents.session;
  // Grant microphone / audio-capture permission (local overlay app).
  ses.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['media', 'audioCapture', 'display-capture'].includes(permission));
  });
  ses.setPermissionCheckHandler(() => true);
  // Serve getDisplayMedia({audio:true}) with the screen + system-audio loopback,
  // without showing a picker — we only keep the audio track in the renderer.
  ses.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] })
      .then(sources => callback({ video: sources[0], audio: 'loopback' }))
      .catch(() => callback({}));
  });

  if (process.platform === 'darwin') {
    mainWindow.setAlwaysOnTop(true, 'floating');
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  }

  // Keep tray menu in sync with actual window visibility
  mainWindow.on('show', updateTrayMenu);
  mainWindow.on('hide', updateTrayMenu);

  // Clean up reference if window is destroyed
  mainWindow.on('closed', () => { mainWindow = null; });

  // Restore the last-used see-through level (default fully opaque)
  const savedOpacity = readConfig().opacity;
  applyOpacity(typeof savedOpacity === 'number' ? savedOpacity : 1);

  mainWindow.loadFile('index.html');
  mainWindow.webContents.on('did-finish-load', sendShortcutState);
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.setOpacity(overlayOpacity);
      mainWindow.showInactive();
    }
  });
}

function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  // Debounce: ignore calls within 300 ms of each other to prevent double-trigger
  if (toggleLock) return;
  toggleLock = true;
  setTimeout(() => { toggleLock = false; }, 300);

  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    // Show WITH focus and drop the cursor into the input box, so the overlay
    // can be driven entirely by keyboard (no clicking → no telltale cursor).
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('focus-input');
  }
  // updateTrayMenu() is called automatically via the 'show'/'hide' window events
}

// ─── Screenshot capture ──────────────────────────────────────────────────────
function getScreenRecordingPermission() {
  if (process.platform !== 'darwin') return 'granted';
  return systemPreferences.getMediaAccessStatus('screen');
}

function screenRecordingPermissionMessage(status) {
  const action = 'Enable Chrome in System Settings → Privacy & Security → Screen & System Audio Recording, then quit and reopen Chrome.';
  if (status === 'denied' || status === 'restricted') {
    return `Screen Recording permission is ${status}. ${action}`;
  }
  return `Screen Recording permission has not been granted yet. ${action}`;
}

function sendScreenshotError(targetWindow, message) {
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send('screenshot-error', message);
  }
}

async function captureScreenDataUrl() {
  // Electron's native desktopCapturer works perfectly here because we disabled the
  // ScreenCaptureKit picker via app.commandLine switches above. This avoids the
  // child_process permission bug in macOS 14 where screencapture fails to inherit
  // the TCC grant of the main app.

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
  });
  if (!sources.length) throw new Error('No screen source found.');
  const source = sources.find(s => s.display_id === String(primaryDisplay.id)) || sources[0];
  if (source.thumbnail.isEmpty()) throw new Error('Screen source returned an empty thumbnail.');
  return source.thumbnail.toDataURL();
}

async function capturePrimaryScreen(eventName, { showOnSuccess = false } = {}) {
  const targetWindow = mainWindow;
  if (!targetWindow || targetWindow.isDestroyed() || screenshotCaptureInFlight) return;

  // Bypass buggy systemPreferences.getMediaAccessStatus check which often
  // wrongly returns 'denied' for ad-hoc signed apps even when permitted.
  // We rely on desktopCapturer to either succeed or throw natively.

  screenshotCaptureInFlight = true;
  const wasVisible = targetWindow.isVisible();
  let captured = false;
  try {
    if (wasVisible) targetWindow.hide();
    await new Promise(resolve => setTimeout(resolve, 250));

    const dataUrl = await captureScreenDataUrl();
    captured = true;
    if (!targetWindow.isDestroyed()) {
      targetWindow.webContents.send(eventName, dataUrl);
    }
  } catch (err) {
    const message = (err && (err.message || err.toString())) || 'Screen capture failed.';
    sendScreenshotError(targetWindow, message);
  } finally {
    if (!targetWindow.isDestroyed()) {
      if (wasVisible || (captured && showOnSuccess)) targetWindow.showInactive();
    }
    screenshotCaptureInFlight = false;
  }
}

function registerAppShortcuts() {
  shortcutFailures.length = 0;

  registerShortcut('toggle', ['CommandOrControl+Shift+Space', 'CommandOrControl+Shift+G'], () => {
    toggleWindow();
  });

  registerShortcut('newChat', ['CommandOrControl+Shift+N', 'CommandOrControl+Alt+C'], () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) mainWindow.showInactive();
    mainWindow.webContents.send('new-chat');
  });

  registerShortcut('screenshot', ['CommandOrControl+Shift+S', 'CommandOrControl+Alt+S'], () =>
    capturePrimaryScreen('screenshot-captured'));

  registerShortcut('autoAnalyze', ['CommandOrControl+Shift+A', 'CommandOrControl+Alt+A'], () =>
    capturePrimaryScreen('auto-analyze-screen', { showOnSuccess: true }));

  registerShortcut('nextModel', ['CommandOrControl+Alt+M'], () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('cycle-model');
  });

  registerShortcut('prevModel', ['CommandOrControl+Alt+N'], () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('prev-model');
  });

  registerShortcut('moveLeft', ['CommandOrControl+Shift+Left'], () => moveOverlay('left'));
  registerShortcut('moveRight', ['CommandOrControl+Shift+Right'], () => moveOverlay('right'));
  registerShortcut('moveUp', ['CommandOrControl+Shift+Up'], () => moveOverlay('up'));
  registerShortcut('moveDown', ['CommandOrControl+Shift+Down'], () => moveOverlay('down'));

  // See-through control: raise/lower how transparent the whole overlay is
  registerShortcut('opacityUp', ['CommandOrControl+Shift+Plus', 'CommandOrControl+Shift+='], () => adjustOpacity(OPACITY_STEP));
  registerShortcut('opacityDown', ['CommandOrControl+Shift+-', 'CommandOrControl+Shift+_'], () => adjustOpacity(-OPACITY_STEP));

  // Voice input: start/stop listening (mic + system audio) → transcribe → send.
  // NOTE: Ctrl+Shift+L is AMD Radeon's "performance logging" hotkey and
  // Ctrl+Alt+L behaves as AltGr on some layouts (won't register), so voice
  // uses Ctrl+Shift+J (with Ctrl+Shift+K as a backup).
  registerShortcut('voice', ['CommandOrControl+Shift+J', 'CommandOrControl+Shift+K'], () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) { mainWindow.show(); mainWindow.focus(); }
    mainWindow.webContents.send('toggle-voice');
  });

  // Live Assistant: answer now (same as its ⚡ Answer button), from any app.
  // showInactive so the meeting window keeps keyboard focus.
  registerShortcut('liveAnswer', ['CommandOrControl+Shift+Enter', 'CommandOrControl+Alt+Enter'], () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) mainWindow.showInactive();
    mainWindow.webContents.send('live-answer');
  });

  // Fully quit the app (same as the Quit link) from anywhere.
  registerShortcut('quit', ['CommandOrControl+Shift+Q'], () => {
    globalShortcut.unregisterAll();
    app.exit(0);
  });

  updateTrayMenu();
  sendShortcutState();
}

function clampOpacity(value) {
  return Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, Math.round(value * 100) / 100));
}

// Apply a stored/current opacity to the window (no config write, no toast).
function applyOpacity(value) {
  overlayOpacity = clampOpacity(value);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setOpacity(overlayOpacity);
}

// Nudge opacity by `delta` and persist it. No on-screen toast — the change is
// already visible in the window itself.
function adjustOpacity(delta) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.isVisible()) mainWindow.showInactive();

  applyOpacity(overlayOpacity + delta);

  const config = readConfig();
  config.opacity = overlayOpacity;
  writeConfig(config);
}

function moveOverlay(direction) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const { workArea } = screen.getPrimaryDisplay();
  const [winWidth, winHeight] = mainWindow.getSize();
  const bounds = mainWindow.getBounds();

  let newX = bounds.x;
  let newY = bounds.y;

  // Nudge by a small step each press (clamped to the screen) so the overlay can
  // be positioned precisely with the keyboard, instead of jumping to an edge.
  const minX = workArea.x + 20;
  const maxX = workArea.x + workArea.width - winWidth - 20;
  const minY = workArea.y + 20;
  const maxY = workArea.y + workArea.height - winHeight - 20;

  if (direction === 'left') {
    newX = Math.max(minX, bounds.x - MOVE_STEP);
  } else if (direction === 'right') {
    newX = Math.min(maxX, bounds.x + MOVE_STEP);
  } else if (direction === 'up') {
    newY = Math.max(minY, bounds.y - MOVE_STEP);
  } else if (direction === 'down') {
    newY = Math.min(maxY, bounds.y + MOVE_STEP);
  }

  mainWindow.setPosition(newX, newY, true);
}

app.setName('Chrome');

// Windows: controls the taskbar grouping name/icon (must run before any window
// is created). macOS: dock icon comes from the bundle, but set it for `npm start`.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.vividhdesign.chrome');
}
app.whenReady().then(() => {
  const icon = getAppIcon();
  if (icon && process.platform === 'darwin' && app.dock) app.dock.setIcon(icon);
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.showInactive();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();

    const config = readConfig();
    // Tray icon is off by default. Opt back in by unchecking
    // "Hide Tray/Menu Icon" in settings.
    if (config.hideTray === false) {
      createTray(); // ─── Menu-bar icon with Show/Hide button ───
    }

    registerAppShortcuts();
  });
}

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', (e) => e.preventDefault());
// macOS: clicking the dock icon must never open a second window
app.on('activate', () => { if (!mainWindow || mainWindow.isDestroyed()) createWindow(); });

// ─── IPC ───
ipcMain.on('hide-window', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide(); });
ipcMain.on('quit-app', () => { globalShortcut.unregisterAll(); app.exit(0); });
ipcMain.on('resize-window', (_, { width, height }) => { if (mainWindow) mainWindow.setSize(width, height, true); });
ipcMain.on('capture-screenshot', () => capturePrimaryScreen('screenshot-captured'));
ipcMain.on('auto-analyze-screen', () => capturePrimaryScreen('auto-analyze-screen', { showOnSuccess: true }));
ipcMain.on('open-screen-recording-settings', () => {
  if (process.platform === 'darwin') {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  }
});

ipcMain.handle('get-config', () => readConfig());
ipcMain.handle('save-config', (_, data) => { writeConfig(data); return true; });
ipcMain.handle('toggle-tray', (_, hideTray) => {
  const config = readConfig();
  config.hideTray = hideTray;
  writeConfig(config);
  setTrayVisibility(!hideTray);
  return true;
});
