# Producer Tag — Setup Guide for AI Agents

You are an AI coding agent helping a user install **Producer Tag**
into their environment. Producer Tag plays a recorded sound on their machine every time
they `git commit` or `git push`. This file is your runbook. Follow it top to bottom.

It is purely local, just for fun, and **the git hooks always exit 0** — they can never block,
slow, or fail a commit/push. Nothing here touches the network or the user's repos' contents.

---

## 0. What you'll set up

```
~/.producer-tag/            ← per-user data (created automatically)
  config.json               ← settings + the tag library
  tag_*.wav                 ← the user's recorded / uploaded / edited sounds
  history.log               ← play log (powers the activity feed)
  hooks/                    ← the global git hooks (only if installed globally)
<this repo>/
  server.js                 ← the control-panel web server (Node, no deps)
  public/index.html         ← the control-panel UI
  hooks/ + install.sh       ← the git hooks + installer
```

## 1. Check prerequisites

Run these and report what's missing. **Only Node is required**; the rest degrade gracefully.

```bash
node --version        # REQUIRED, >= 14
git --version         # REQUIRED
uname -s              # platform: Darwin (macOS) / Linux / MINGW*|MSYS* (Windows Git Bash)
# playback backend (one of these per-OS):
command -v afplay     # macOS — built in
command -v paplay aplay ffplay   # Linux
#   Windows uses PowerShell (built in) — nothing to install
# OPTIONAL — only for Autotune + the audio editor:
command -v ffmpeg && ffmpeg -hide_banner -filters 2>/dev/null | grep -q rubberband && echo "ffmpeg+rubberband OK"
python3 -c "import numpy" 2>/dev/null && echo "numpy OK"
```

- No `ffmpeg`/`numpy`? Everything works except autotune and the audio editor (the UI shows a
  clear error if those are used). Don't block setup on them.
- macOS has `afplay` built in. On Linux, if none of paplay/aplay/ffplay exist, install one
  (e.g. `sudo apt-get install pulseaudio-utils`). On Windows (Git Bash) playback uses
  PowerShell's `Media.SoundPlayer` for WAV — no install needed.

## 2. Start the control panel

```bash
cd <this repo>
npm start                      # serves http://localhost:7777  (override: PORT=8080 npm start)
# or, for a desktop window instead of a browser tab (no extra deps — uses an
# installed Chromium browser; Edge on Windows works out of the box):
npm run app
```

Leave it running. Tell the user to open **http://localhost:7777** and:
1. Record a tag (mic) or upload one, name it, Save.
2. Hit **Test** to hear it.

### Seeding a tag without a mic (headless / CI / demo)

If the user has no mic handy, create a quick tag from text-to-speech and POST it:

```bash
# macOS example — make a wav and add it via the API while the server runs:
say -o /tmp/t.aiff "another one" && afconvert -f WAVE -d LEI16@44100 /tmp/t.aiff /tmp/t.wav
B64=$(base64 -i /tmp/t.wav | tr -d '\n')
curl -s -X POST http://localhost:7777/api/sound -H 'Content-Type: application/json' \
  -d "{\"contentB64\":\"$B64\",\"ext\":\"wav\",\"name\":\"My Tag\"}"
# (Linux: use `espeak`/`pico2wave` to make the wav; Windows: any .wav file works.)
```

## 3. Install the git hooks

Ask the user which they want, then run ONE of these:

```bash
# A) GLOBAL — fires in EVERY repo on this machine (recommended for "tag everything"):
bash install.sh --global
#   Sets git's global core.hooksPath to ~/.producer-tag/hooks. It chains to each repo's
#   own .git/hooks, so any existing hooks keep working. Undo:
#     git config --global --unset core.hooksPath

# B) ONE repo only:
bash install.sh /path/to/their/repo      # or `bash install.sh` inside it
#   Preserves an existing post-commit/pre-push as <hook>.local and runs it first.
```

Default triggers: **push on, commit off.** The user can change this (and volume, random mode,
notifications) in the control panel.

## 4. Verify it actually works

```bash
# Fire the hook manually exactly as git would (from inside any repo with hooks installed):
bash ~/.producer-tag/hooks/pre-push push        # global install
#   …or, for a single-repo install:
bash <repo>/.git/hooks/pre-push                  # (or its hooksPath equivalent)

# Confirm a play was logged:
cat ~/.producer-tag/history.log                  # epoch <tab> event <tab> repo <tab> file
curl -s http://localhost:7777/api/history        # same, as JSON, newest first
```

You should hear the active tag and see a new line in the log (and in the control panel's
**Recent activity** panel). If the user enabled notifications, a desktop banner appears too.

## 5. Troubleshooting

| Symptom | Cause & fix |
|---|---|
| Hook does nothing on push | Producer Tag is OFF, or the **push** event is off. Toggle them on in the panel. |
| Nothing plays in a specific repo | That repo sets its own `core.hooksPath`. Run `bash install.sh <repo>` to install there too. |
| "Could not play preview" in Safari | Already handled — the server sends HTTP Range (206). Make sure they loaded the current `public/index.html` (hard-reload: Cmd/Ctrl+Shift+R). |
| Preview volume doesn't change | Browser preview caps at 100%; the volume slider above 100% only boosts the *real* fired tag (afplay). |
| Autotune / editor errors | `ffmpeg` (with `rubberband`) and/or `python3`+`numpy` not found. Install them or skip those features. |
| Windows: no sound | Run the hooks under **Git Bash** (which ships with Git for Windows); it invokes PowerShell to play WAV. |
| Want it silent for now | Flip the master switch off in the panel, or `git config --global --unset core.hooksPath`. |
| Tag plays multiple times when several repos commit/push at once | Expected to be ONE play — a debounce window collapses the burst. Tune `debounceMs` in config (default 2000ms) or set `$PRODUCER_TAG_DEBOUNCE_MS`; 0 disables. |

## 6. Uninstall

```bash
git config --global --unset core.hooksPath          # if installed globally
# per-repo: delete post-commit, pre-push, producer-tag-play.sh from the repo's hooks dir
#           and restore any <hook>.local backup
rm -rf ~/.producer-tag                               # removes all tags + settings (optional)
```

---

## API reference (control panel server)

All JSON, served at `http://localhost:7777`:

- `GET  /api/config` · `POST /api/config` — `{enabled, volume(0–2), mode:'fixed'|'random', notify, events:{commit,push}, repoMode:'all'|'only', debounceMs}`
  - `debounceMs` (default 2000): when several repos commit/push at once, only the FIRST tag plays within this window — so it never overlaps. 0 disables. Also overridable per-invocation via `$PRODUCER_TAG_DEBOUNCE_MS`.
- `POST /api/sound` — add a tag `{contentB64, ext, name}` (base64 audio; wav/mp3/m4a/aac/aiff/caf)
- `GET  /api/sound[?id=]` — stream a tag (Range-enabled) · `POST /api/active {id}` · `POST /api/rename {id,name}` · `POST /api/delete {id}` · `POST /api/skip {id,skip}`
- `POST /api/autotune {id?, style:'subtle'|'hard'|'chipmunk'}` — adds a tuned copy
- `POST /api/edit {id?, save:'preview'|'new'|'replace', effects:{trimStart,trimEnd,pitch,speed,gain,fadeIn,fadeOut,reverse,reverb,autotune}}`
- `POST /api/test {id?}` — play through speakers (afplay)
- `GET  /api/history` — last 10 plays + `repos:[{name,enabled}]` (per-repo state). The hook trims the log to 50 lines.
- `POST /api/repo {repo, enabled}` — mute/unmute the tag for one repo
- `POST /api/scan {dir}` — find git repos under a folder and register them in the panel. Skips throwaway/auto-named repos (docker-style `adjective-noun-hex` worktrees, `auto-*`/`agent-*` scratch dirs) and worktrees, so only real projects are added.

> Safety: `scan` and `extract`'s `path` only accept folders/files **inside the user's home
> directory** (symlinks resolved). The server is localhost-only and makes no outbound calls.

## Controlling which repos play

> **This is a LOCAL tool, not a GitHub integration — set expectations up front.** The panel
> lists repos **cloned on this machine** that fire a *local* `git commit`/`push`, keyed by the
> repo's **local folder basename**. It does **not** read the user's GitHub account. So if a user
> says "I have lots of repos on GitHub but only see a few here," that's expected: (a) repos they haven't
> pushed to since installing haven't shown up yet, (b) GitHub repos not cloned on this machine
> can never fire a local hook, and (c) local folder names often differ from GitHub repo names
> (`my-app` vs `my-app-ios`). Don't wire this to the GitHub API to "fix" it —
> that would break the local-only / no-outbound-calls guarantee. Just scan their local projects
> folder or let repos appear as they push.

By default the tag plays in **every** repo. The **Repositories** panel lets the user
scope that:

- **All repos** (default) — plays everywhere; toggle a repo **off** to mute it there.
- **Only selected** — silent everywhere *except* repos the user turns **on** (an allowlist).
- Repos appear automatically after their first push. The user can also **add one by name**
  (to pre-mute/allow before it fires) or **Scan a folder** (e.g. `~/Code`) to register every
  git repo under it at once.

> Don't try to bulk-register *every* repo on the machine (e.g. a blind `find ~ -name .git`).
> A real dev machine is full of **non-project** git repos — tool-generated worktrees with
> docker-style names (`blissful-lamarr-f4b591`), `auto-*`/`agent-*` scratch dirs, package
> caches, downloaded samples — and registering them all buries the user's real projects.
> `scan` already skips these, but the safest path is to **scan the user's actual projects
> folder** (ask them where it is) or let repos appear on their own after they push.

Under the hood this is `config.json` → `repoMode` + `repos:{ "<name>": true|false }`, where
`<name>` is the repo folder's basename. The hook reads it: in `all` mode it skips repos set to
`false`; in `only` mode it plays only repos set to `true`.

> Note: the panel only knows about repos that have **played the tag** (or that the user added /
> scanned). It does **not** query GitHub or scan the whole disk — it reads
> `~/.producer-tag/history.log` plus the user's explicit repo settings.
