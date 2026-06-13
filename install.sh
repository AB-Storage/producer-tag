#!/usr/bin/env bash
# Producer Tag — install the git hooks into a repository.
#
#   bash install.sh [path-to-repo]      (defaults to the current directory)
#
# Safe & idempotent:
#   - respects an existing core.hooksPath
#   - if a post-commit / pre-push hook already exists, it is preserved as
#     <hook>.local and still runs first (its exit code is honored, so a
#     blocking pre-push keeps blocking) — then the producer tag plays.
#   - re-running install does nothing harmful.
set -e

SRC="$(cd "$(dirname "$0")" && pwd)"
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
