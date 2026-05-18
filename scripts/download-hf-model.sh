#!/usr/bin/env bash
#
# Download all files in a HuggingFace model repo (at an optional revision)
# into a local directory via plain curl. Avoids huggingface_hub's parallel
# Python downloader which stalls in CLOSE_WAIT on large multi-file Russian
# repos.
#
# Usage:
#   scripts/download-hf-model.sh <hf-repo> [target-dir] [--revision <rev>]
#
# Examples:
#   scripts/download-hf-model.sh ai-sage/GigaAM-v3 models/gigaam-v3 --revision e2e_rnnt
#   scripts/download-hf-model.sh antony66/whisper-large-v3-russian
#
# Idempotent: skips files that already exist with non-zero size.

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <hf-repo> [target-dir] [--revision <rev>]" >&2
  exit 1
fi

HF_REPO="$1"
shift
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REVISION="main"
TARGET_DIR=""

while [ $# -gt 0 ]; do
  case "$1" in
    --revision)
      REVISION="$2"
      shift 2 ;;
    --revision=*)
      REVISION="${1#*=}"
      shift ;;
    *)
      if [ -z "$TARGET_DIR" ]; then
        TARGET_DIR="$1"
        shift
      else
        echo "unexpected arg: $1" >&2
        exit 1
      fi
      ;;
  esac
done

if [ -z "$TARGET_DIR" ]; then
  MODELS_DIR="${TRANSCRIBE_MODELS_DIR:-$ROOT/models}"
  TARGET_DIR="$MODELS_DIR/$(basename "$HF_REPO")"
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl is required" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 is required (used for HF API JSON parsing)" >&2
  exit 1
fi

echo "==> Listing files in $HF_REPO @ $REVISION"
FILES=$(curl -sf "https://huggingface.co/api/models/$HF_REPO/tree/$REVISION" |
  python3 -c "
import json, sys
for f in json.load(sys.stdin):
    if f['type'] != 'file': continue
    p = f['path']
    # skip test fixtures shipped in some repos (bond005 etc.)
    if p.startswith('test_') or p.endswith('.wav') or p.endswith('.mp3'):
        continue
    print(p)
")

if [ -z "$FILES" ]; then
  echo "error: no files returned for $HF_REPO @ $REVISION" >&2
  exit 1
fi

echo "==> Downloading to $TARGET_DIR"
mkdir -p "$TARGET_DIR"
BASE="https://huggingface.co/$HF_REPO/resolve/$REVISION"
for f in $FILES; do
  dest="$TARGET_DIR/$f"
  mkdir -p "$(dirname "$dest")"
  if [ -f "$dest" ] && [ -s "$dest" ]; then
    echo "    skip (exists): $f"
    continue
  fi
  echo "    fetch: $f"
  curl -L --fail --progress-bar -o "$dest" "$BASE/$f"
done

echo "==> Done: $TARGET_DIR"
