# Producer Tag — Setup Guide for AI Agents

You are an AI assistant (Claude Code, Cursor, etc.) helping a user install **Producer Tag**
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

- `GET  /api/config` · `POST /api/config` — `{enabled, volume(0–2), mode:'fixed'|'random', notify, events:{commit,push}}`
- `POST /api/sound` — add a tag `{contentB64, ext, name}` (base64 audio; wav/mp3/m4a/aac/aiff/caf)
- `GET  /api/sound[?id=]` — stream a tag (Range-enabled) · `POST /api/active {id}` · `POST /api/rename {id,name}` · `POST /api/delete {id}` · `POST /api/skip {id,skip}`
- `POST /api/autotune {id?, style:'subtle'|'hard'|'chipmunk'}` — adds a tuned copy
- `POST /api/edit {id?, save:'preview'|'new'|'replace', effects:{trimStart,trimEnd,pitch,speed,gain,fadeIn,fadeOut,reverse,reverb,autotune}}`
- `POST /api/test {id?}` — play through speakers (afplay) · `GET /api/history` — recent plays
