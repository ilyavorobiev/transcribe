#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_DIR="${1:-$HOME/.local/bin}"
LINK="$TARGET_DIR/transcribe"

mkdir -p "$TARGET_DIR"

cat > "$LINK" <<EOF
#!/usr/bin/env bash
exec bun run "$ROOT/src/cli.ts" "\$@"
EOF
chmod +x "$LINK"

echo "Installed: $LINK"
case ":$PATH:" in
  *":$TARGET_DIR:"*) ;;
  *) echo "warning: $TARGET_DIR is not in your PATH. Add it to your shell profile." >&2 ;;
esac
