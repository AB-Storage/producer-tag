<p align="center"><img src="icon.png" width="120" alt="Producer Tag"></p>

# Producer Tag

Drop your signature sound — DJ-style — every time you push to git.

Record a short audio tag (your name, a catchphrase, an air horn, whatever), and
it plays on your machine whenever you commit or push. Manage a whole **library**
of tags from a little web control panel, pick which one is active, shuffle them
at random, **edit them** (trim + effects), or run them through a built-in
**autotune** (including a very silly chipmunk mode). A **Recent activity** feed
and optional **desktop notifications** show you exactly when and where it fired.

It's purely local and just for fun. The git hooks run in the background and
**always exit 0**, so they can never block, slow, or fail a commit or push.

---

## Requirements

- **Node.js** ≥ 14 — for the control panel server (no npm dependencies).
- **Playback:** macOS (`afplay`, built in) · Windows (PowerShell, via Git Bash)
  · Linux (`paplay`/`aplay`/`ffplay`).
- **Optional, for autotune + the audio editor:** `ffmpeg` (built with
  `rubberband`) and `python3` with `numpy`. Everything else works without them.

## Quick start

```bash
# 1. Start the control panel
npm start
#   → http://localhost:7777

# 2. In the browser: record or upload a tag, hit Test to hear it.

# 3a. Install GLOBALLY — fires in every repo on your machine:
bash install.sh --global

# 3b. …or install into one repo:
bash install.sh /path/to/your/repo
```

That's it. Next time you `git push`, your tag drops. Global install chains to each
repo's own hooks, so anything you already had keeps working.

Change the port with `PORT=8080 npm start`. Sounds and settings are stored in
`~/.producer-tag/` (override with `PRODUCER_TAG_HOME`).

## Desktop window

Prefer a real window you can open and close instead of a browser tab?

**Just double-click it** — no terminal needed:
- **macOS:** `Producer Tag.app` (drag it to your Applications or Dock).
  First launch: if macOS blocks it, right-click → **Open** once.
- **Windows:** `Producer Tag.bat`

Or from a terminal:

```bash
npm run app
```

This opens Producer Tag in a clean, chromeless app window — **no Electron, no
install, no extra dependencies.** It just starts the server and opens the panel
in an app window using whatever Chromium-based browser you already have (Chrome,
Edge, Brave…). Edge ships with Windows, so it works there out of the box.
**Close the window and the app quits.**

The window **is** just the control panel. The git hooks read `~/.producer-tag`
directly, so **closing it never stops your tag from firing** — open it only when
you want to record, edit, or change settings. (Headless? `node server.js` still
works with zero dependencies.)

## What you can do

- **Tag library** — keep as many tags as you like; preview, rename, or delete any.
- **Pick the active tag** — the one that plays in Fixed mode.
- **Fixed / Random** — Fixed plays your chosen tag; Random surprises you with a
  different one each push. Exclude individual tags from the shuffle.
- **Triggers** — play on push (default), on commit, or both. Per-event toggles.
- **Volume** — applied when the tag fires.
- **Autotune** — detects the tag's pitch, snaps it to the nearest note, and adds
  character. Three styles:
  - **Subtle** — gentle tune + light shimmer.
  - **Hard** — heavy T-Pain-style tune.
  - **Chipmunk** — funny super-pitched voice.
- **Audio editor** — a waveform with drag handles to **trim/cut**, plus pitch,
  speed, gain, fade in/out, reverse, and reverb. Preview the result, then save as
  a new tag or replace the original.
- **Recent activity** — a live feed of every play: which repo, push or commit, and
  when. So you always know it's working.
- **Desktop notifications** — optional banner each time the tag fires.

  Autotune and edits create a *new* tag (unless you pick Replace), so your
  original is never touched.

## How it works

```
~/.producer-tag/
  config.json     ← enabled, volume, mode, events, active tag, tag library
  tag_*.wav       ← your recorded / uploaded / autotuned sounds
```

`install.sh` adds two git hooks to your repo:

- `post-commit` → plays on commit (off by default)
- `pre-push`   → plays on push (on by default)

Both call `producer-tag-play.sh`, which reads `~/.producer-tag/config.json`,
picks the right sound (active, or random), and plays it with `afplay` in the
background.

If a repo already has a `post-commit` or `pre-push` hook, the installer preserves
it as `<hook>.local` and runs it **first** (honoring its exit code, so a blocking
`pre-push` keeps blocking) before playing your tag. Re-running `install.sh` is safe.

## Recording format

Browser microphone recording is saved as **WAV**, because `afplay` can't decode
the WebM/Opus that browsers record by default. Uploads accept `wav`, `mp3`,
`m4a`, `aac`, `aiff`, and `caf`.

## Turn it off

- Flip the master switch off in the control panel (keeps everything, just silent).
- Or remove the hooks: delete `post-commit`, `pre-push`, and `producer-tag-play.sh`
  from the repo's hooks directory (and restore any `*.local` backup).

## For AI assistants

Handing this repo to Claude Code, Cursor, or another agent to set up? Point it at
**[CLAUDE.md](CLAUDE.md)** — a full install/verify/troubleshoot runbook.

## License

MIT — see [LICENSE](LICENSE).
