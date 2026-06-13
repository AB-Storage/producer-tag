#!/usr/bin/env node
// Producer Tag — lightweight desktop GUI launcher (no Electron).
//
// Starts the control-panel server, then opens it in a chromeless "app" window
// using whatever Chromium-based browser is installed (Chrome / Edge / Brave /
// Chromium). Edge ships with Windows, so this works out of the box there.
// Closing the window quits the app (and stops the server).
//
// The git hooks read ~/.producer-tag directly, so quitting this never stops
// your tag from firing — it's only the control panel.
'use strict';
const net = require('net');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function freePort(start) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(freePort(start + 1)));
    s.listen(start, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
function waitReady(port, tries) {
  tries = tries || 80;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/config' }, (r) => { r.resume(); resolve(); });
      req.on('error', () => { if (--tries <= 0) reject(new Error('server not ready')); else setTimeout(tick, 100); });
    };
    tick();
  });
}
function findBrowser() {
  const p = process.platform;
  const PF = process.env['PROGRAMFILES'] || 'C:\\Program Files';
  const PF86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const LAD = process.env['LOCALAPPDATA'] || '';
  const lists = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ],
    win32: [
      PF + '\\Google\\Chrome\\Application\\chrome.exe',
      PF86 + '\\Google\\Chrome\\Application\\chrome.exe',
      LAD + '\\Google\\Chrome\\Application\\chrome.exe',
      PF + '\\Microsoft\\Edge\\Application\\msedge.exe',
      PF86 + '\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
    linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium'],
  };
  const cands = lists[p] || lists.linux;
  return cands.find((c) => { try { return c && fs.existsSync(c); } catch { return false; } });
}
function openDefault(url) {
  const p = process.platform;
  if (p === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
  else if (p === 'win32') spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
  else spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
}

(async () => {
  const port = await freePort(7777);
  process.env.PORT = String(port);
  require(path.join(__dirname, 'server.js')); // starts listening on PORT
  const url = 'http://localhost:' + port;
  try { await waitReady(port); } catch {}

  const browser = findBrowser();
  if (browser) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'producer-tag-'));
    const child = spawn(browser, [
      '--app=' + url,
      '--user-data-dir=' + profile,
      '--window-size=780,940',
      '--no-first-run',
      '--no-default-browser-check',
    ], { stdio: 'ignore' });
    // Closing the app window ends this browser instance → quit cleanly.
    child.on('close', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(0); });
    child.on('error', () => { openDefault(url); console.log('\n  Producer Tag → ' + url + '\n  (Could not launch app window — opened your browser. Ctrl+C to stop.)\n'); });
  } else {
    openDefault(url);
    console.log('\n  Producer Tag → ' + url + '\n  (No Chrome/Edge found — opened your default browser. Ctrl+C here to stop.)\n');
  }
})();
