#!/usr/bin/env node
/*
 * Producer Tag — local control panel server.
 *
 * Serves the web UI and a small JSON API for managing your "producer tag"
 * sounds: record/upload a library of tags, pick the active one, autotune,
 * and toggle when it plays on git events. The git hooks read the same config
 * and play the active (or a random) tag via afplay.
 *
 * Pure Node stdlib — no dependencies. Data lives in ~/.producer-tag/.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const os = require('os');

const PORT = Number(process.env.PORT) || 7777;
const DATA_DIR = process.env.PRODUCER_TAG_HOME || path.join(os.homedir(), '.producer-tag');
const CFG_FILE = path.join(DATA_DIR, 'config.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// afplay (macOS CoreAudio) plays these — NOT webm/opus (the browser recorder default).
const EXTS = ['wav', 'm4a', 'aac', 'mp3', 'aiff', 'caf'];
const MIME = { wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', aiff: 'audio/aiff', caf: 'audio/x-caf' };

// ── helpers ──────────────────────────────────────────────────────────────
function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    req.on('error', () => resolve(null));
  });
}
function firstExist(cands, fallback) { return cands.find((p) => p && fs.existsSync(p)) || fallback; }

// ── config model: a LIBRARY of tags; one is "active". `sound` mirrors the
//    active tag's filename so the git hook stays a one-liner. ──────────────
function readRaw() { try { return JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch { return {}; } }

function normalize(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const cfg = {
    enabled: raw.enabled !== false,                 // default ON
    volume: Math.max(0, Math.min(2, Number(raw.volume) || 1.0)),
    mode: raw.mode === 'random' ? 'random' : 'fixed',
    notify: raw.notify !== false,                   // desktop notification; default ON
    events: { commit: !!(raw.events && raw.events.commit), push: raw.events ? !!raw.events.push : true },
    repoMode: raw.repoMode === 'only' ? 'only' : 'all', // 'all' = play everywhere except muted; 'only' = allowlist
    repos: {},                                       // explicit per-repo: { name: true|false }
    active: raw.active != null ? String(raw.active) : null,
    tags: [],
  };
  if (raw.repos && typeof raw.repos === 'object') {
    for (const k in raw.repos) if (typeof raw.repos[k] === 'boolean') cfg.repos[String(k)] = raw.repos[k];
  }
  const seen = new Set();
  if (Array.isArray(raw.tags)) {
    for (const t of raw.tags) {
      if (!t || typeof t !== 'object') continue;
      const file = String(t.file || '').replace(/[\\/]/g, '');
      if (!file || seen.has(file)) continue;
      let size = 0;
      try { size = fs.statSync(path.join(DATA_DIR, file)).size; } catch { continue; }
      seen.add(file);
      cfg.tags.push({
        id: String(t.id || file),
        name: String(t.name || 'Untitled tag').slice(0, 60),
        file, ext: (file.split('.').pop() || 'wav').toLowerCase(),
        size, createdAt: Number(t.createdAt) || 0, skipRandom: !!t.skipRandom,
      });
    }
  }
  if (!cfg.tags.find((t) => t.id === cfg.active)) cfg.active = cfg.tags.length ? cfg.tags[0].id : null;
  return cfg;
}
function activeTag(cfg) { return cfg.tags.find((t) => t.id === cfg.active) || null; }
function write(cfg) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const a = activeTag(cfg);
  fs.writeFileSync(CFG_FILE, JSON.stringify({
    enabled: cfg.enabled, volume: cfg.volume, mode: cfg.mode, notify: cfg.notify, events: cfg.events,
    repoMode: cfg.repoMode, repos: cfg.repos,
    active: cfg.active, sound: a ? a.file : '',
    tags: cfg.tags.map((t) => ({ id: t.id, name: t.name, file: t.file, ext: t.ext, size: t.size, createdAt: t.createdAt, skipRandom: !!t.skipRandom })),
  }, null, 2));
}
function pub(cfg) {
  const a = activeTag(cfg);
  return {
    ok: true, enabled: cfg.enabled, volume: cfg.volume, mode: cfg.mode, notify: cfg.notify, events: cfg.events,
    repoMode: cfg.repoMode, repos: cfg.repos,
    active: cfg.active, hasSound: !!a, soundSize: a ? a.size : 0,
    tags: cfg.tags.map((t) => ({ id: t.id, name: t.name, ext: t.ext, size: t.size, createdAt: t.createdAt, skipRandom: !!t.skipRandom })),
  };
}

// ── handlers ─────────────────────────────────────────────────────────────
function getConfig(req, res) { const cfg = normalize(readRaw()); try { write(cfg); } catch {} json(res, pub(cfg)); }

async function postConfig(req, res) {
  const b = await readBody(req);
  if (!b || typeof b !== 'object') return json(res, { error: 'invalid body' }, 400);
  const cfg = normalize(readRaw());
  if (typeof b.enabled === 'boolean') cfg.enabled = b.enabled;
  if (typeof b.notify === 'boolean') cfg.notify = b.notify;
  if (b.repoMode != null) cfg.repoMode = b.repoMode === 'only' ? 'only' : 'all';
  if (b.volume != null) cfg.volume = Math.max(0, Math.min(2, Number(b.volume) || 1.0));
  if (b.mode != null) cfg.mode = b.mode === 'random' ? 'random' : 'fixed';
  if (b.events) {
    if (typeof b.events.commit === 'boolean') cfg.events.commit = b.events.commit;
    if (typeof b.events.push === 'boolean') cfg.events.push = b.events.push;
  }
  try { write(cfg); } catch (e) { return json(res, { error: 'write failed: ' + e.message }, 500); }
  json(res, pub(cfg));
}

async function postSound(req, res) {
  const b = await readBody(req);
  if (!b || typeof b !== 'object') return json(res, { error: 'invalid body' }, 400);
  const b64 = String(b.contentB64 || '');
  if (!b64) return json(res, { error: 'contentB64 required' }, 400);
  if (b64.length > 14 * 1024 * 1024) return json(res, { error: 'file too large (max 10MB)' }, 413);
  let ext = String(b.ext || 'wav').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!EXTS.includes(ext)) ext = 'wav';
  const cfg = normalize(readRaw());
  const id = 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const file = 'tag_' + id + '.' + ext;
  const name = String(b.name || '').trim().replace(/[\r\n\t]+/g, ' ').slice(0, 60) || 'Tag ' + (cfg.tags.length + 1);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const buf = Buffer.from(b64, 'base64');
    fs.writeFileSync(path.join(DATA_DIR, file), buf);
    cfg.tags.push({ id, name, file, ext, size: buf.length, createdAt: Date.now(), skipRandom: false });
    cfg.active = id;
    write(cfg);
    json(res, { ok: true, id, name, ext, size: buf.length });
  } catch (e) { json(res, { error: 'write failed: ' + e.message }, 500); }
}

// Serve audio WITH HTTP Range support — Safari's <audio> requires a 206 or it
// refuses to play ("Could not play preview"). Chrome is lenient; Safari is not.
function serveAudio(req, res, p, mime) {
  let stat; try { stat = fs.statSync(p); } catch { return json(res, { error: 'missing file' }, 404); }
  const total = stat.size;
  const base = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' };
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
    if (isNaN(start)) start = 0;
    if (isNaN(end) || end >= total) end = total - 1;
    if (start > end || start >= total) { res.writeHead(416, { 'Content-Range': `bytes */${total}` }); return res.end(); }
    res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(p, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...base, 'Content-Length': total });
  fs.createReadStream(p).pipe(res);
}

function getSound(req, res, query) {
  const cfg = normalize(readRaw());
  const tag = query.id ? cfg.tags.find((t) => t.id === String(query.id)) : activeTag(cfg);
  if (!tag) return json(res, { error: 'no sound' }, 404);
  const p = path.join(DATA_DIR, tag.file);
  if (!fs.existsSync(p)) return json(res, { error: 'missing file' }, 404);
  serveAudio(req, res, p, MIME[tag.ext] || 'application/octet-stream');
}

async function postActive(req, res) {
  const b = await readBody(req);
  const id = b && b.id != null ? String(b.id) : '';
  const cfg = normalize(readRaw());
  if (!cfg.tags.find((t) => t.id === id)) return json(res, { error: 'unknown tag' }, 404);
  cfg.active = id;
  try { write(cfg); } catch (e) { return json(res, { error: 'write failed: ' + e.message }, 500); }
  json(res, pub(cfg));
}

async function postRename(req, res) {
  const b = await readBody(req);
  const id = b && b.id != null ? String(b.id) : '';
  const name = String((b && b.name) || '').trim().replace(/[\r\n\t]+/g, ' ').slice(0, 60);
  const cfg = normalize(readRaw());
  const t = cfg.tags.find((x) => x.id === id);
  if (!t) return json(res, { error: 'unknown tag' }, 404);
  if (!name) return json(res, { error: 'name required' }, 400);
  t.name = name;
  try { write(cfg); } catch (e) { return json(res, { error: 'write failed: ' + e.message }, 500); }
  json(res, pub(cfg));
}

async function postDelete(req, res) {
  const b = await readBody(req);
  const id = b && b.id != null ? String(b.id) : '';
  const cfg = normalize(readRaw());
  const t = cfg.tags.find((x) => x.id === id);
  if (!t) return json(res, { error: 'unknown tag' }, 404);
  try { fs.unlinkSync(path.join(DATA_DIR, t.file)); } catch {}
  cfg.tags = cfg.tags.filter((x) => x.id !== id);
  if (cfg.active === id) cfg.active = cfg.tags.length ? cfg.tags[0].id : null;
  try { write(cfg); } catch (e) { return json(res, { error: 'write failed: ' + e.message }, 500); }
  json(res, pub(cfg));
}

async function postSkip(req, res) {
  const b = await readBody(req);
  const id = b && b.id != null ? String(b.id) : '';
  const cfg = normalize(readRaw());
  const t = cfg.tags.find((x) => x.id === id);
  if (!t) return json(res, { error: 'unknown tag' }, 404);
  t.skipRandom = !!(b && b.skip);
  try { write(cfg); } catch (e) { return json(res, { error: 'write failed: ' + e.message }, 500); }
  json(res, pub(cfg));
}

// Real autotune: numpy detects the dominant pitch, snaps to the nearest
// semitone, ffmpeg+rubberband pitch-corrects with style-specific character.
async function postAutotune(req, res) {
  const b = (await readBody(req)) || {};
  const cfg = normalize(readRaw());
  const src = b.id ? cfg.tags.find((t) => t.id === String(b.id)) : activeTag(cfg);
  if (!src) return json(res, { error: 'no sound' }, 404);
  const srcPath = path.join(DATA_DIR, src.file);
  if (!fs.existsSync(srcPath)) return json(res, { error: 'missing file' }, 404);
  const style = ['subtle', 'hard', 'chipmunk'].includes(b.style) ? b.style : 'subtle';

  const { execFile } = require('child_process');
  const run = (cmd, args) => new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (err, out, errout) =>
      err ? reject(new Error(String(errout || err.message || '').slice(0, 300))) : resolve(String(out)));
  });
  const HOME = os.homedir();
  const FFMPEG = firstExist([process.env.FFMPEG, path.join(HOME, '.local/bin/ffmpeg'), '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'], 'ffmpeg');
  const PYTHON = firstExist(['/usr/bin/python3', path.join(HOME, '.local/bin/python3'), '/opt/homebrew/bin/python3', '/usr/local/bin/python3'], 'python3');

  const PY = `
import sys, wave, numpy as np
try:
    w=wave.open(sys.argv[1],'rb'); sr=w.getframerate(); n=w.getnframes(); ch=w.getnchannels(); sw=w.getsampwidth()
    raw=w.readframes(n); w.close()
    dt={1:np.int8,2:np.int16,4:np.int32}.get(sw,np.int16)
    x=np.frombuffer(raw,dtype=dt).astype(np.float64)
    if ch>1: x=x.reshape(-1,ch).mean(axis=1)
    if x.size<256: print("1.0"); sys.exit(0)
    x=x-np.mean(x); m=np.max(np.abs(x))
    if m>0: x=x/m
    win=min(2048,x.size); hop=512
    if x.size>win:
        e=np.array([np.sum(x[i:i+win]**2) for i in range(0,x.size-win,hop)])
        s=int(np.argmax(e))*hop; seg=x[s:s+win*4]
    else: seg=x
    seg=seg-np.mean(seg)
    ac=np.correlate(seg,seg,'full')[len(seg)-1:]
    lo=max(1,int(sr/500)); hi=min(len(ac),int(sr/80))
    if hi<=lo: print("1.0"); sys.exit(0)
    peak=lo+int(np.argmax(ac[lo:hi])); f0=sr/peak if peak>0 else 0
    if f0<=0: print("1.0"); sys.exit(0)
    midi=69+12*np.log2(f0/440.0); tgt=440.0*2**((round(midi)-69)/12.0); r=tgt/f0
    print("%.5f"%max(0.80,min(1.25,r)))
except Exception:
    print("1.0")
`;
  let ratio = '1.0';
  try { ratio = (await run(PYTHON, ['-c', PY, srcPath])).trim() || '1.0'; }
  catch (e) { return json(res, { error: 'pitch detect failed (need python3 + numpy): ' + e.message }, 501); }
  if (!/^[0-9.]+$/.test(ratio)) ratio = '1.0';

  const outId = 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const outFile = 'tag_' + outId + '.wav';
  const outPath = path.join(DATA_DIR, outFile);
  let af, suffix;
  if (style === 'chipmunk') {
    const p = (Number(ratio) * Math.pow(2, 10 / 12)).toFixed(5);
    af = `rubberband=pitch=${p}:transients=crisp,atempo=1.12,chorus=0.6:0.9:50:0.4:0.3:2,highpass=f=120,acompressor=ratio=4,volume=3,alimiter=limit=0.95`;
    suffix = ' (Chipmunk)';
  } else if (style === 'hard') {
    af = `rubberband=pitch=${ratio}:transients=crisp,chorus=0.7:0.9:45:0.5:0.3:2.4,chorus=0.6:0.85:25:0.4:0.22:1.6,highpass=f=90,acompressor=ratio=6,volume=3,alimiter=limit=0.95`;
    suffix = ' (Hard Tune)';
  } else {
    af = `rubberband=pitch=${ratio}:transients=crisp,chorus=0.6:0.9:55:0.4:0.25:2,highpass=f=85,acompressor=ratio=3,volume=3,alimiter=limit=0.95`;
    suffix = ' (Autotune)';
  }
  try { await run(FFMPEG, ['-y', '-i', srcPath, '-af', af, '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', outPath]); }
  catch (e) { try { fs.unlinkSync(outPath); } catch {} return json(res, { error: 'ffmpeg autotune failed (need ffmpeg w/ rubberband): ' + e.message }, 501); }
  let size = 0; try { size = fs.statSync(outPath).size; } catch {}
  if (!size) { try { fs.unlinkSync(outPath); } catch {} return json(res, { error: 'autotune produced empty file' }, 500); }

  const base = src.name.replace(/\s*\((Autotune|Hard Tune|Chipmunk)\)\s*$/i, '');
  const name = (base + suffix).slice(0, 60);
  cfg.tags.push({ id: outId, name, file: outFile, ext: 'wav', size, createdAt: Date.now(), skipRandom: false });
  cfg.active = outId;
  try { write(cfg); } catch (e) { return json(res, { error: 'write failed: ' + e.message }, 500); }
  json(res, { ok: true, id: outId, name, style, ratio: Number(ratio), ...pub(cfg) });
}

// GET /api/history — recent plays logged by the git hook
function getHistory(req, res) {
  const cfg = normalize(readRaw());
  const byFile = {}; cfg.tags.forEach((t) => { byFile[t.file] = t.name; });
  let lines = [];
  try { lines = fs.readFileSync(path.join(DATA_DIR, 'history.log'), 'utf8').trim().split('\n').filter(Boolean); } catch {}
  // Show only the last 10 plays (the rest are auto-trimmed by the hook).
  const plays = lines.slice(-10).reverse().map((l) => {
    const [ts, event, repo, file] = l.split('\t');
    return { ts: (Number(ts) || 0) * 1000, event: event || '', repo: repo || '', tag: byFile[file] || file || '' };
  });
  // Repos seen recently ∪ any explicitly muted — each with its on/off state.
  const names = new Set();
  lines.forEach((l) => { const r = l.split('\t')[2]; if (r) names.add(r); });
  Object.keys(cfg.repos).forEach((r) => names.add(r));
  const willPlay = (name) => cfg.repoMode === 'only' ? cfg.repos[name] === true : cfg.repos[name] !== false;
  const repos = [...names].filter((n) => n && n !== '(unknown)').sort().map((name) => ({ name, enabled: willPlay(name) }));
  json(res, { ok: true, plays, count: lines.length, repoMode: cfg.repoMode, repos });
}

// POST /api/repo { repo, enabled } — mute/unmute the tag for a specific repo
async function postRepo(req, res) {
  const b = await readBody(req);
  const repo = b && b.repo != null ? String(b.repo).trim() : '';
  if (!repo) return json(res, { error: 'repo required' }, 400);
  const cfg = normalize(readRaw());
  cfg.repos[repo] = b.enabled === true;   // store the explicit play/silent state
  try { write(cfg); } catch (e) { return json(res, { error: 'write failed: ' + e.message }, 500); }
  json(res, { ok: true, repos: cfg.repos });
}

// Find git repos under a folder (a dir containing a .git folder), bounded.
function findRepos(root, maxDepth) {
  const out = []; const stack = [[root, 0]];
  while (stack.length && out.length < 300) {
    const [dir, depth] = stack.pop();
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    if (entries.some((e) => e.isDirectory() && e.name === '.git')) { out.push(path.basename(dir)); continue; }
    if (depth >= maxDepth) continue;
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
      stack.push([path.join(dir, e.name), depth + 1]);
    }
  }
  return out;
}

// POST /api/scan { dir } — list git repos under a local folder and register them
async function postScan(req, res) {
  const b = await readBody(req);
  let dir = b && b.dir != null ? String(b.dir).trim() : '';
  if (!dir) return json(res, { error: 'folder path required' }, 400);
  dir = dir.replace(/^~(?=[/\\])/, os.homedir());
  let st; try { st = fs.statSync(dir); } catch { return json(res, { error: 'folder not found: ' + dir }, 404); }
  if (!st.isDirectory()) return json(res, { error: 'not a folder: ' + dir }, 400);
  const found = findRepos(dir, 4);
  const cfg = normalize(readRaw());
  const def = cfg.repoMode === 'only' ? false : true;   // appear with the mode's default
  let added = 0;
  found.forEach((name) => { if (!(name in cfg.repos)) { cfg.repos[name] = def; added++; } });
  try { write(cfg); } catch (e) { return json(res, { error: 'write failed: ' + e.message }, 500); }
  json(res, { ok: true, found: found.length, added });
}

// binary resolution + runner (autotune/edit need ffmpeg + python)
function bins() {
  const HOME = os.homedir();
  const fe = (c, f) => c.find((p) => p && fs.existsSync(p)) || f;
  return {
    ffmpeg: fe([process.env.FFMPEG, path.join(HOME, '.local/bin/ffmpeg'), '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'], 'ffmpeg'),
    python: fe(['/usr/bin/python3', path.join(HOME, '.local/bin/python3'), '/opt/homebrew/bin/python3', '/usr/local/bin/python3'], 'python3'),
  };
}
function runCmd(cmd, args) {
  const { execFile } = require('child_process');
  return new Promise((resolve, reject) => execFile(cmd, args, { timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
    (e, o, eo) => (e ? reject(new Error(String(eo || e.message).slice(0, 300))) : resolve(String(o)))));
}
const DETECT_PY = `
import sys, wave, numpy as np
try:
    w=wave.open(sys.argv[1],'rb'); sr=w.getframerate(); n=w.getnframes(); ch=w.getnchannels(); sw=w.getsampwidth()
    raw=w.readframes(n); w.close()
    dt={1:np.int8,2:np.int16,4:np.int32}.get(sw,np.int16)
    x=np.frombuffer(raw,dtype=dt).astype(np.float64)
    if ch>1: x=x.reshape(-1,ch).mean(axis=1)
    if x.size<256: print("1.0"); sys.exit(0)
    x=x-np.mean(x); m=np.max(np.abs(x))
    if m>0: x=x/m
    win=min(2048,x.size); hop=512
    if x.size>win:
        e=np.array([np.sum(x[i:i+win]**2) for i in range(0,x.size-win,hop)]); s=int(np.argmax(e))*hop; seg=x[s:s+win*4]
    else: seg=x
    seg=seg-np.mean(seg); ac=np.correlate(seg,seg,'full')[len(seg)-1:]
    lo=max(1,int(sr/500)); hi=min(len(ac),int(sr/80))
    if hi<=lo: print("1.0"); sys.exit(0)
    peak=lo+int(np.argmax(ac[lo:hi])); f0=sr/peak if peak>0 else 0
    if f0<=0: print("1.0"); sys.exit(0)
    midi=69+12*np.log2(f0/440.0); tgt=440.0*2**((round(midi)-69)/12.0); r=tgt/f0
    print("%.5f"%max(0.80,min(1.25,r)))
except Exception:
    print("1.0")
`;

// POST /api/edit — trim + effects via ffmpeg (preview | new | replace)
async function postEdit(req, res) {
  const body = (await readBody(req).catch(() => ({}))) || {};
  const cfg = normalize(readRaw());
  const src = body.id ? cfg.tags.find((t) => t.id === String(body.id)) : activeTag(cfg);
  if (!src) return json(res, { error: 'no sound' }, 404);
  const srcPath = path.join(DATA_DIR, src.file);
  if (!fs.existsSync(srcPath)) return json(res, { error: 'missing file' }, 404);
  const e = body.effects || {};
  const save = ['preview', 'new', 'replace'].includes(body.save) ? body.save : 'preview';
  const { ffmpeg: FFMPEG, python: PYTHON } = bins();

  const filters = [];
  const ts = Math.max(0, Number(e.trimStart) || 0);
  const teRaw = Number(e.trimEnd);
  const te = isFinite(teRaw) && teRaw > ts ? teRaw : null;
  if (ts > 0 || te != null) filters.push(`atrim=start=${ts}${te != null ? `:end=${te}` : ''}`, 'asetpts=PTS-STARTPTS');
  if (e.reverse) filters.push('areverse');
  const style = ['subtle', 'hard', 'chipmunk'].includes(e.autotune) ? e.autotune : null;
  if (style) {
    let ratio = '1.0';
    try { ratio = (await runCmd(PYTHON, ['-c', DETECT_PY, srcPath])).trim() || '1.0'; } catch {}
    if (!/^[0-9.]+$/.test(ratio)) ratio = '1.0';
    if (style === 'chipmunk') filters.push(`rubberband=pitch=${(Number(ratio) * Math.pow(2, 10 / 12)).toFixed(5)}:transients=crisp`, 'atempo=1.12', 'chorus=0.6:0.9:50:0.4:0.3:2');
    else if (style === 'hard') filters.push(`rubberband=pitch=${ratio}:transients=crisp`, 'chorus=0.7:0.9:45:0.5:0.3:2.4', 'acompressor=ratio=6');
    else filters.push(`rubberband=pitch=${ratio}:transients=crisp`, 'chorus=0.6:0.9:55:0.4:0.25:2');
  } else {
    const semi = Number(e.pitch) || 0;
    if (semi) filters.push(`rubberband=pitch=${Math.pow(2, semi / 12).toFixed(5)}:transients=crisp`);
  }
  let speed = Number(e.speed) || 1; speed = Math.max(0.5, Math.min(2, speed));
  if (speed !== 1) filters.push(`atempo=${speed.toFixed(3)}`);
  const gain = Number(e.gain) || 0;
  if (gain) filters.push(`volume=${Math.max(-30, Math.min(30, gain))}dB`);
  if (e.reverb) filters.push('aecho=0.8:0.88:60:0.35');
  const fi = Math.max(0, Number(e.fadeIn) || 0);
  const fo = Math.max(0, Number(e.fadeOut) || 0);
  if (fi > 0) filters.push(`afade=t=in:st=0:d=${fi}`);
  if (fo > 0 && te != null) { const so = Math.max(0, (te - ts) / speed - fo); filters.push(`afade=t=out:st=${so.toFixed(3)}:d=${fo}`); }
  filters.push('alimiter=limit=0.95');

  const outId = 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const outFile = 'tag_' + outId + '.wav';
  const outPath = path.join(DATA_DIR, outFile);
  try { await runCmd(FFMPEG, ['-y', '-i', srcPath, '-af', filters.join(','), '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', outPath]); }
  catch (err) { try { fs.unlinkSync(outPath); } catch {} return json(res, { error: 'edit failed (need ffmpeg): ' + err.message }, 501); }
  let size = 0; try { size = fs.statSync(outPath).size; } catch {}
  if (!size) { try { fs.unlinkSync(outPath); } catch {} return json(res, { error: 'edit produced empty file' }, 500); }

  if (save === 'preview') {
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*', 'Content-Length': size });
    const stream = fs.createReadStream(outPath);
    stream.pipe(res);
    stream.on('close', () => { try { fs.unlinkSync(outPath); } catch {} });
    return;
  }
  if (save === 'replace') {
    const t = cfg.tags.find((x) => x.id === src.id);
    try { if (t.file !== outFile) fs.unlinkSync(path.join(DATA_DIR, t.file)); } catch {}
    t.file = outFile; t.ext = 'wav'; t.size = size; cfg.active = t.id;
    try { write(cfg); } catch (err) { return json(res, { error: 'write failed: ' + err.message }, 500); }
    return json(res, { ok: true, replaced: t.id, ...pub(cfg) });
  }
  const name = (src.name.replace(/\s*\((Autotune|Hard Tune|Chipmunk|Edit)\)\s*$/i, '') + ' (Edit)').slice(0, 60);
  cfg.tags.push({ id: outId, name, file: outFile, ext: 'wav', size, createdAt: Date.now(), skipRandom: false });
  cfg.active = outId;
  try { write(cfg); } catch (err) { return json(res, { error: 'write failed: ' + err.message }, 500); }
  json(res, { ok: true, id: outId, ...pub(cfg) });
}

// POST /api/extract — pull audio out of ANY file (video or audio, any format
// ffmpeg reads). Accepts an uploaded file (contentB64) OR a local file path
// (no size limit — runs on the user's machine). Saves the audio as a tag.
async function postExtract(req, res) {
  const body = (await readBody(req).catch(() => ({}))) || {};
  const { ffmpeg: FFMPEG } = bins();
  let inputPath = '', tmpInput = '';
  if (body.path) {
    const p = String(body.path).trim().replace(/^~(?=\/)/, os.homedir());
    let st; try { st = fs.statSync(p); } catch { return json(res, { error: 'file not found: ' + p }, 404); }
    if (!st.isFile()) return json(res, { error: 'not a file: ' + p }, 400);
    inputPath = p;
  } else if (body.contentB64) {
    const b64 = String(body.contentB64);
    if (b64.length > 80 * 1024 * 1024) return json(res, { error: 'file too large (~60MB max) — use the file-path field for big files' }, 413);
    const ext = String(body.ext || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'bin';
    tmpInput = path.join(DATA_DIR, '_extract_' + Date.now().toString(36) + '.' + ext);
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(tmpInput, Buffer.from(b64, 'base64')); }
    catch (e) { return json(res, { error: 'write failed: ' + e.message }, 500); }
    inputPath = tmpInput;
  } else return json(res, { error: 'contentB64 or path required' }, 400);

  const cfg = normalize(readRaw());
  const outId = 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const outFile = 'tag_' + outId + '.wav';
  const outPath = path.join(DATA_DIR, outFile);
  const args = ['-y'];
  const start = Number(body.start) || 0; if (start > 0) args.push('-ss', String(start));
  args.push('-i', inputPath);
  const dur = Number(body.duration) || 0; if (dur > 0) args.push('-t', String(dur));
  args.push('-vn', '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', outPath);
  const cleanup = () => { if (tmpInput) { try { fs.unlinkSync(tmpInput); } catch {} } };
  try { await runCmd(FFMPEG, args); }
  catch (e) { try { fs.unlinkSync(outPath); } catch {} cleanup(); return json(res, { error: 'extract failed (need ffmpeg): ' + e.message }, 501); }
  cleanup();
  let size = 0; try { size = fs.statSync(outPath).size; } catch {}
  if (!size) { try { fs.unlinkSync(outPath); } catch {} return json(res, { error: 'no audio track found in that file' }, 422); }
  let name = String(body.name || '').trim().replace(/[\r\n\t]+/g, ' ').slice(0, 60);
  if (!name) {
    const base = body.path ? String(body.path).split(/[\\/]/).pop() : (body.filename || 'Extracted');
    name = String(base).replace(/\.[^.]+$/, '').slice(0, 60) || 'Extracted';
  }
  cfg.tags.push({ id: outId, name, file: outFile, ext: 'wav', size, createdAt: Date.now(), skipRandom: false });
  cfg.active = outId;
  try { write(cfg); } catch (e) { return json(res, { error: 'write failed: ' + e.message }, 500); }
  json(res, { ok: true, id: outId, name, size, ...pub(cfg) });
}

async function postTest(req, res) {
  const b = (await readBody(req)) || {};
  const cfg = normalize(readRaw());
  let tag;
  if (b.id) tag = cfg.tags.find((t) => t.id === String(b.id));
  else if (cfg.mode === 'random' && cfg.tags.length) {
    const pool = cfg.tags.filter((t) => !t.skipRandom);
    const choose = pool.length ? pool : cfg.tags;
    tag = choose[Math.floor(Math.random() * choose.length)];
  } else tag = activeTag(cfg);
  if (!tag) return json(res, { error: 'no sound' }, 404);
  const p = path.join(DATA_DIR, tag.file);
  if (!fs.existsSync(p)) return json(res, { error: 'missing file' }, 404);
  if (process.platform !== 'darwin') return json(res, { error: 'afplay is macOS-only' }, 501);
  try {
    const { spawn } = require('child_process');
    const c = spawn('afplay', ['-v', String(cfg.volume), p], { detached: true, stdio: 'ignore' });
    c.unref();
    json(res, { ok: true, played: tag.name, volume: cfg.volume });
  } catch (e) { json(res, { error: 'play failed: ' + e.message }, 500); }
}

function serveIndex(res) {
  fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err, buf) => {
    if (err) { res.writeHead(500); return res.end('index.html missing'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

// ── router ───────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const { pathname, query } = url.parse(req.url, true);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }
  if (pathname === '/' || pathname === '/index.html') return serveIndex(res);
  if (pathname === '/api/config' && req.method === 'GET') return getConfig(req, res);
  if (pathname === '/api/config' && req.method === 'POST') return postConfig(req, res);
  if (pathname === '/api/sound' && req.method === 'POST') return postSound(req, res);
  if (pathname === '/api/sound' && req.method === 'GET') return getSound(req, res, query);
  if (pathname === '/api/active' && req.method === 'POST') return postActive(req, res);
  if (pathname === '/api/rename' && req.method === 'POST') return postRename(req, res);
  if (pathname === '/api/delete' && req.method === 'POST') return postDelete(req, res);
  if (pathname === '/api/skip' && req.method === 'POST') return postSkip(req, res);
  if (pathname === '/api/history' && req.method === 'GET') return getHistory(req, res);
  if (pathname === '/api/repo' && req.method === 'POST') return postRepo(req, res);
  if (pathname === '/api/scan' && req.method === 'POST') return postScan(req, res);
  if (pathname === '/api/autotune' && req.method === 'POST') return postAutotune(req, res);
  if (pathname === '/api/edit' && req.method === 'POST') return postEdit(req, res);
  if (pathname === '/api/extract' && req.method === 'POST') return postExtract(req, res);
  if (pathname === '/api/test' && req.method === 'POST') return postTest(req, res);
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('\n  Producer Tag  →  http://localhost:' + PORT);
  console.log('  data: ' + DATA_DIR + '\n');
});
