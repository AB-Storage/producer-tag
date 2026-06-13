// Producer Tag — Electron desktop wrapper.
//
// This window IS just the control panel. The git hooks read ~/.producer-tag
// directly, so closing this app does NOT stop your tag from firing — open it
// only when you want to record, edit, or change settings.
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const net = require('net');

// Find an open port starting at 7777 (so it won't collide with `npm start`).
function freePort(start) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(freePort(start + 1)));
    srv.listen(start, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
  });
}

let win = null;
let port = 0;
let serverUp = false;

async function ensureServer() {
  if (serverUp) return;
  port = await freePort(7777);
  process.env.PORT = String(port);
  require(path.join(__dirname, '..', 'server.js')); // starts listening on PORT
  serverUp = true;
}

function createWindow() {
  win = new BrowserWindow({
    width: 760, height: 920, minWidth: 420, minHeight: 600,
    title: 'Producer Tag', backgroundColor: '#15110d', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  const url = `http://localhost:${port}`;
  const tryLoad = () => { if (win) win.loadURL(url).catch(() => setTimeout(tryLoad, 250)); };
  tryLoad();
  // The window may try to load before the server is listening — retry on failure.
  win.webContents.on('did-fail-load', () => setTimeout(tryLoad, 250));
  // Open external links (GitHub, etc.) in the system browser, not a new window.
  win.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: 'deny' }; });
  win.on('closed', () => { win = null; });
}

app.whenReady().then(async () => {
  await ensureServer();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Quitting is safe — the producer tag keeps working via the git hooks.
app.on('window-all-closed', () => app.quit());
