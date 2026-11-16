const { app, BrowserWindow, desktopCapturer, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const outputDir = path.join(rootDir, 'verification');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function saveWindowPng(win, fileName) {
  const image = await win.webContents.capturePage();
  const filePath = path.join(outputDir, fileName);
  fs.writeFileSync(filePath, image.toPNG());
  return filePath;
}

async function capturePrimaryScreen() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
  });
  const source = sources.find(s => s.display_id === String(primaryDisplay.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('No non-empty screen capture was returned.');
  }
  const filePath = path.join(outputDir, 'verification-screen.png');
  fs.writeFileSync(filePath, source.thumbnail.toPNG());
  return { filePath, dataUrl: source.thumbnail.toDataURL() };
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });

  const win = new BrowserWindow({
    width: 480,
    height: 620,
    show: false,
    backgroundColor: '#101018',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'verify-preload.js'),
    },
  });

  await win.loadFile(path.join(rootDir, 'index.html'));
  await delay(700);

  const overlay = await saveWindowPng(win, 'verification-overlay.png');
  const screenCapture = await capturePrimaryScreen();

  win.webContents.send('screenshot-captured', screenCapture.dataUrl);
  await delay(500);
  const overlayWithScreenshot = await saveWindowPng(win, 'verification-overlay-with-screenshot.png');

  console.log(JSON.stringify({
    overlay,
    screen: screenCapture.filePath,
    overlayWithScreenshot,
  }, null, 2));
}

app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch(error => {
    console.error(error);
    app.exit(1);
  });
