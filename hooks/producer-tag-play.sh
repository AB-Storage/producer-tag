#!/usr/bin/env bash
# Producer Tag — shared player called by the post-commit / pre-push hooks.
# Plays your active (or, in random mode, a random) tag on git events, logs the
# play, and optionally shows a desktop notification.
#
# Cross-platform: macOS (afplay), Windows (PowerShell, via Git Bash), Linux
# (paplay/aplay/ffplay).
#
# CONTRACT: never block or fail a git operation — always exits 0, plays in the
# background, and any missing file / disabled flag / parse error -> silent exit 0.
#
# Usage: producer-tag-play.sh <event>   where <event> is "commit" or "push"
# Data lives in ${PRODUCER_TAG_HOME:-$HOME/.producer-tag}.

EVENT="${1:-commit}"
DATA="${PRODUCER_TAG_HOME:-$HOME/.producer-tag}"
CFG="$DATA/config.json"

[ -f "$CFG" ] || exit 0
PY="$(command -v python3 || command -v python)"
[ -n "$PY" ] || exit 0

# Resolve: enabled | per-event flag | volume | file to play (random-aware) | notify
read -r ENABLED EVENT_ON VOLUME SOUND NOTIFY <<EOF
$("$PY" - "$CFG" "$EVENT" <<'PYEOF'
import json, sys, random
cfg_path, event = sys.argv[1], sys.argv[2]
try:
    c = json.load(open(cfg_path))
except Exception:
    print("0 0 1.0 - 0"); sys.exit(0)
enabled  = 1 if c.get("enabled") else 0
event_on = 1 if (c.get("events", {}) or {}).get(event) else 0
notify   = 1 if c.get("notify") else 0
try:
    vol = float(c.get("volume", 1.0))
except Exception:
    vol = 1.0
vol = max(0.0, min(2.0, vol))
sound = c.get("sound") or ""
if c.get("mode") == "random":
    tags = [t for t in (c.get("tags") or []) if isinstance(t, dict) and t.get("file")]
    pool = [t.get("file") for t in tags if not t.get("skipRandom")]
    if not pool:
        pool = [t.get("file") for t in tags]
    if pool:
        sound = random.choice(pool)
sound = (sound or "").replace("/", "").replace("\\", "").strip()
print(f"{enabled} {event_on} {vol} {sound} {notify}")
PYEOF
)
EOF

[ "$ENABLED" = "1" ] || exit 0
[ "$EVENT_ON" = "1" ] || exit 0
[ -n "$SOUND" ] || exit 0
SOUND_PATH="$DATA/$SOUND"
[ -f "$SOUND_PATH" ] || exit 0

# Repo name (for the log + notification)
REPO="$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null)"
[ -n "$REPO" ] || REPO="(unknown)"

# Append to the play history (plain TSV: epoch \t event \t repo \t soundfile), capped.
HIST="$DATA/history.log"
printf '%s\t%s\t%s\t%s\n' "$(date +%s 2>/dev/null)" "$EVENT" "$REPO" "$SOUND" >> "$HIST" 2>/dev/null || true
if [ -f "$HIST" ]; then tail -n 300 "$HIST" > "$HIST.tmp" 2>/dev/null && mv "$HIST.tmp" "$HIST" 2>/dev/null || true; fi

OS="$(uname -s 2>/dev/null)"
case "$OS" in
  Darwin)
    AF="$(command -v afplay)"
    [ -n "$AF" ] && ( "$AF" -v "${VOLUME:-1.0}" "$SOUND_PATH" >/dev/null 2>&1 & ) &
    [ "$NOTIFY" = "1" ] && osascript -e "display notification \"Played in $REPO ($EVENT)\" with title \"Producer Tag\"" >/dev/null 2>&1 &
    ;;
  Linux)
    P="$(command -v paplay || command -v aplay || command -v ffplay)"
    if [ -n "$P" ]; then
      case "$P" in
        *ffplay) ( "$P" -nodisp -autoexit -loglevel quiet "$SOUND_PATH" >/dev/null 2>&1 & ) & ;;
        *)       ( "$P" "$SOUND_PATH" >/dev/null 2>&1 & ) & ;;
      esac
    fi
    [ "$NOTIFY" = "1" ] && command -v notify-send >/dev/null 2>&1 && notify-send "Producer Tag" "Played in $REPO ($EVENT)" >/dev/null 2>&1 &
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    WINPATH="$(cygpath -w "$SOUND_PATH" 2>/dev/null || echo "$SOUND_PATH")"
    case "$SOUND" in
      *.wav) ( powershell.exe -NoProfile -Command "(New-Object Media.SoundPlayer '$WINPATH').PlaySync()" >/dev/null 2>&1 & ) & ;;
      *)     FF="$(command -v ffplay)"; [ -n "$FF" ] && ( "$FF" -nodisp -autoexit -loglevel quiet "$SOUND_PATH" >/dev/null 2>&1 & ) & ;;
    esac
    [ "$NOTIFY" = "1" ] && ( powershell.exe -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; \$n = New-Object System.Windows.Forms.NotifyIcon; \$n.Icon=[System.Drawing.SystemIcons]::Information; \$n.Visible=\$true; \$n.ShowBalloonTip(3000,'Producer Tag','Played in $REPO ($EVENT)','Info'); Start-Sleep -Milliseconds 3500; \$n.Dispose()" >/dev/null 2>&1 & ) &
    ;;
esac

exit 0
