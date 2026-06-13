# Producer Tag

Drop your signature sound — DJ-style — every time you push to git.

Record a short audio tag (your name, a catchphrase, an air horn, whatever), and
it plays on your machine whenever you commit or push. Manage a whole **library**
of tags from a little web control panel, pick which one is active, shuffle them
at random, or run them through a built-in **autotune** (including a very silly
chipmunk mode).

It's purely local and just for fun. The git hooks run in the background and
**always exit 0**, so they can never block, slow, or fail a commit or push.

---

## Requirements

- **macOS** — playback uses the built-in `afplay`.
- **Node.js** ≥ 14 — for the control panel server (no npm dependencies).
- **Optional, for autotune:** `ffmpeg` (built with `rubberband`) and `python3`
  with `numpy`. Everything else works without them.

## Quick start

```bash
# 1. Start the control panel
npm start
#   → http://localhost:7777

# 2. In the browser: record or upload a tag, hit Test to hear it.

# 3. Install the hooks into a repo you want it to fire on:
bash install.sh /path/to/your/repo
#   (or just `bash install.sh` from inside that repo)
```

That's it. Next time you `git push` in that repo, your tag drops.

Change the port with `PORT=8080 npm start`. Sounds and settings are stored in
`~/.producer-tag/` (override with `PRODUCER_TAG_HOME`).

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

  Autotuning creates a *new* tag, so your original is never touched.

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

## License

MIT — see [LICENSE](LICENSE).
