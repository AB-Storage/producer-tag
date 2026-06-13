#!/usr/bin/env bash
# Producer Tag — install the git hooks.
#
#   bash install.sh [path-to-repo]   install into one repo (default: current dir)
#   bash install.sh --global         install GLOBALLY → fires in EVERY repo
#
# Safe & idempotent:
#   - respects an existing core.hooksPath
#   - if a post-commit / pre-push hook already exists, it is preserved as
#     <hook>.local and still runs first (its exit code is honored, so a
#     blocking pre-push keeps blocking) — then the producer tag plays.
#   - global mode also chains to each repo's own .git/hooks, so local hooks keep working.
#   - re-running install does nothing harmful.
set -e

SRC="$(cd "$(dirname "$0")" && pwd)"
DATA="${PRODUCER_TAG_HOME:-$HOME/.producer-tag}"

# ── global install: every repo on this machine ──────────────────────────────
if [ "$1" = "--global" ]; then
  GHOOKS="$DATA/hooks"
  mkdir -p "$GHOOKS"
  cp "$SRC/hooks/producer-tag-play.sh" "$GHOOKS/producer-tag-play.sh"
  chmod +x "$GHOOKS/producer-tag-play.sh"
  for pair in "post-commit:commit" "pre-push:push"; do
    name="${pair%%:*}"; event="${pair##*:}"
    cat > "$GHOOKS/$name" <<EOF
#!/usr/bin/env bash
# Global Producer Tag hook. Also runs this repo's own .git/hooks/$name (local hooks keep working).
DIR="\$(cd "\$(dirname "\$0")" && pwd)"
LOCAL="\$(git rev-parse --git-dir 2>/dev/null)/hooks/$name"
if [ -x "\$LOCAL" ] && [ "\$LOCAL" != "\$DIR/$name" ]; then "\$LOCAL" "\$@" || exit \$?; fi
bash "\$DIR/producer-tag-play.sh" $event
exit 0
EOF
    chmod +x "$GHOOKS/$name"
  done
  git config --global core.hooksPath "$GHOOKS"
  echo "✓ Producer Tag installed GLOBALLY (git core.hooksPath = $GHOOKS)"
  echo "  It now fires in every repo. Undo with: git config --global --unset core.hooksPath"
  exit 0
fi

REPO="${1:-$PWD}"

if ! git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
  echo "✗ not a git repository: $REPO"; exit 1
fi

HOOK_DIR="$(git -C "$REPO" config core.hooksPath || true)"
if [ -z "$HOOK_DIR" ]; then
  HOOK_DIR="$(cd "$REPO" && cd "$(git -C "$REPO" rev-parse --git-dir)" && pwd)/hooks"
else
  case "$HOOK_DIR" in /*) : ;; *) HOOK_DIR="$REPO/$HOOK_DIR" ;; esac
fi
mkdir -p "$HOOK_DIR"

cp "$SRC/hooks/producer-tag-play.sh" "$HOOK_DIR/producer-tag-play.sh"
chmod +x "$HOOK_DIR/producer-tag-play.sh"

install_hook() {
  local name="$1"
  local event="$2"
  local path="$HOOK_DIR/$name"
  if [ -f "$path" ] && ! grep -q "producer-tag-play.sh" "$path" 2>/dev/null; then
    mv "$path" "$path.local"
    echo "  • preserved your existing $name as $name.local (still runs first)"
  fi
  cat > "$path" <<EOF
#!/usr/bin/env bash
# Managed by Producer Tag. Your previous hook (if any) is preserved as $name.local.
DIR="\$(cd "\$(dirname "\$0")" && pwd)"
if [ -x "\$DIR/$name.local" ]; then "\$DIR/$name.local" "\$@" || exit \$?; fi
bash "\$DIR/producer-tag-play.sh" $event
exit 0
EOF
  chmod +x "$path"
}

install_hook post-commit commit
install_hook pre-push push

echo "✓ Producer Tag hooks installed in: $HOOK_DIR"
echo "  Open the control panel (npm start) to record a tag and turn it on."
