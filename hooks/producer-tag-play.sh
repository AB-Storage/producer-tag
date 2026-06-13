#!/usr/bin/env bash
# Producer Tag — shared player called by the post-commit / pre-push hooks.
# Plays your active (or, in random mode, a random) tag on git events.
#
# CONTRACT: never block or fail a git operation.
#   - always exits 0
#   - plays in the background and disowns, so git does not wait on afplay
#   - missing file / disabled / parse error -> silent exit 0
#
# Usage: producer-tag-play.sh <event>   where <event> is "commit" or "push"
# Config + sounds live in ${PRODUCER_TAG_HOME:-$HOME/.producer-tag}.

EVENT="${1:-commit}"
DATA="${PRODUCER_TAG_HOME:-$HOME/.producer-tag}"
CFG="$DATA/config.json"

[ -f "$CFG" ] || exit 0
PY="$(command -v python3)"
[ -n "$PY" ] || exit 0

# Resolve enabled / per-event flag / volume / file to play (random-aware).
read -r ENABLED EVENT_ON VOLUME SOUND <<EOF
$("$PY" - "$CFG" "$EVENT" <<'PYEOF'
import json, sys, random
cfg_path, event = sys.argv[1], sys.argv[2]
try:
    c = json.load(open(cfg_path))
except Exception:
    print("0 0 1.0 -"); sys.exit(0)
enabled  = 1 if c.get("enabled") else 0
event_on = 1 if (c.get("events", {}) or {}).get(event) else 0
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
print(f"{enabled} {event_on} {vol} {sound}")
PYEOF
)
EOF

[ "$ENABLED" = "1" ] || exit 0
[ "$EVENT_ON" = "1" ] || exit 0
[ -n "$SOUND" ] || exit 0

SOUND_PATH="$DATA/$SOUND"
[ -f "$SOUND_PATH" ] || exit 0

# macOS: afplay. Background + disown so git returns immediately.
AFPLAY="$(command -v afplay)"
if [ -n "$AFPLAY" ]; then
  ( "$AFPLAY" -v "${VOLUME:-1.0}" "$SOUND_PATH" >/dev/null 2>&1 & ) &
fi

exit 0
