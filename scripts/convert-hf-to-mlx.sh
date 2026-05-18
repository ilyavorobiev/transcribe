#!/usr/bin/env bash
#
# Download a HuggingFace Whisper model and convert it to MLX format,
# producing a directory ready to pass to `transcribe --model <dir>`.
#
# Usage:
#   scripts/convert-hf-to-mlx.sh <hf-repo> [target-dir]
#
# Examples:
#   scripts/convert-hf-to-mlx.sh antony66/whisper-large-v3-russian
#   scripts/convert-hf-to-mlx.sh bond005/whisper-podlodka-turbo models/bond005
#
# Why this script exists:
#
# 1. `mlx_whisper` cannot load HF-format safetensors directly. Russian
#    fine-tunes like antony66 and bond005 ship in HF Transformers format
#    (with a config.json containing `_name_or_path` etc.) and need a
#    one-shot conversion to MLX format (a different config.json + a
#    weights.safetensors file). The conversion script lives in
#    `mlx-examples/whisper/convert.py` upstream and is not bundled with
#    the `mlx-whisper` pip package.
#
# 2. HuggingFace's parallel Python downloader (used by `mlx_whisper` on
#    auto-download) frequently stalls in CLOSE_WAIT on large multi-file
#    Russian repos. Manual curl is far more reliable and bypasses all
#    the Xet / hf-transfer / huggingface_hub version churn.
#
# 3. The version of `mlx_whisper` currently on PyPI (0.4.3) expects the
#    converted weights to be named `weights.safetensors`, but the
#    upstream `convert.py` writes `model.safetensors`. We rename to make
#    them work together.

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <hf-repo> [target-dir]" >&2
  echo "Example: $0 antony66/whisper-large-v3-russian" >&2
  exit 1
fi

HF_REPO="$1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# When invoked via setup-all.sh, defaults land under the cache dir; stand-
# alone runs fall back to the legacy <repo>/models layout.
MODELS_DIR="${TRANSCRIBE_MODELS_DIR:-$ROOT/models}"
DEFAULT_NAME="$(basename "$HF_REPO" | sed 's/whisper-//;s/-russian/-russian/' )"
TARGET_DIR="${2:-$MODELS_DIR/$DEFAULT_NAME-mlx}"
RAW_DIR="$(dirname "$TARGET_DIR")/$(basename "$TARGET_DIR" -mlx)-hf"

if ! command -v uv >/dev/null 2>&1; then
  echo "error: uv is required (brew install uv)" >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl is required" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 is required" >&2
  exit 1
fi

# --- 1. List repo files (skip test fixtures) ---------------------------------

echo "==> Listing files in $HF_REPO"
FILES=$(curl -sf "https://huggingface.co/api/models/$HF_REPO/tree/main" |
  python3 -c "
import json, sys
for f in json.load(sys.stdin):
    if f['type'] != 'file': continue
    p = f['path']
    if p.startswith('test_') or p.endswith('.wav') or p.endswith('.mp3'):
        continue
    print(p)
")

if [ -z "$FILES" ]; then
  echo "error: no files returned for $HF_REPO" >&2
  exit 1
fi

# --- 2. Download all files via curl (skip if already complete) ---------------

echo "==> Downloading to $RAW_DIR"
mkdir -p "$RAW_DIR"
BASE="https://huggingface.co/$HF_REPO/resolve/main"
for f in $FILES; do
  dest="$RAW_DIR/$f"
  mkdir -p "$(dirname "$dest")"
  if [ -f "$dest" ] && [ -s "$dest" ]; then
    echo "    skip (exists): $f"
    continue
  fi
  echo "    fetch: $f"
  curl -L --fail --progress-bar -o "$dest" "$BASE/$f"
done

# --- 3. Fetch the conversion script (cached in /tmp) -------------------------

CONVERT_PY="/tmp/mlx_whisper_convert.py"
if [ ! -f "$CONVERT_PY" ]; then
  echo "==> Fetching mlx-examples convert.py"
  curl -L --fail --silent -o "$CONVERT_PY" \
    "https://raw.githubusercontent.com/ml-explore/mlx-examples/main/whisper/convert.py"
fi

# --- 4. Convert to MLX format ------------------------------------------------

echo "==> Converting HF → MLX (float16) — uses torch + transformers via uv"
mkdir -p "$TARGET_DIR"
uv tool run --from mlx-whisper --with transformers --with torch \
  python "$CONVERT_PY" \
    --torch-name-or-path "$RAW_DIR" \
    --mlx-path "$TARGET_DIR" \
    --dtype float16

# --- 5. Rename model.safetensors → weights.safetensors ----------------------
#
# mlx-whisper 0.4.3's load_models.py looks for `weights.safetensors` (then
# falls back to `weights.npz`), but the upstream convert.py writes
# `model.safetensors`. Rename so the loader finds it.

if [ -f "$TARGET_DIR/model.safetensors" ] && [ ! -f "$TARGET_DIR/weights.safetensors" ]; then
  echo "==> Renaming model.safetensors → weights.safetensors (mlx-whisper 0.4.3 expects this name)"
  mv "$TARGET_DIR/model.safetensors" "$TARGET_DIR/weights.safetensors"
fi

# --- 6. Sanity-check the conversion ------------------------------------------
#
# Before we delete the -hf source (~3 GB), verify the converted MLX dir
# looks plausible. If any of these fail, we KEEP the source and ask the
# user to file a bug — losing the source on a bad conversion is exactly
# the failure mode the -hf dir is supposed to protect against.

CLEANUP_OK=1

WEIGHTS_FILE="$TARGET_DIR/weights.safetensors"
if [ ! -f "$WEIGHTS_FILE" ]; then
  echo "warning: sanity-check failed — weights.safetensors not found in $TARGET_DIR" >&2
  CLEANUP_OK=0
else
  WEIGHTS_BYTES=$(stat -f %z "$WEIGHTS_FILE" 2>/dev/null || stat -c %s "$WEIGHTS_FILE")
  MIN_BYTES=$((50 * 1024 * 1024))
  if [ "$WEIGHTS_BYTES" -lt "$MIN_BYTES" ]; then
    echo "warning: sanity-check failed — weights.safetensors is only $((WEIGHTS_BYTES / 1024 / 1024)) MB (< 50 MB minimum)" >&2
    CLEANUP_OK=0
  fi
fi

CONFIG_FILE="$TARGET_DIR/config.json"
if [ ! -f "$CONFIG_FILE" ]; then
  echo "warning: sanity-check failed — config.json missing in $TARGET_DIR" >&2
  CLEANUP_OK=0
elif ! python3 -c "import json,sys; c=json.load(open('$CONFIG_FILE')); assert c.get('model_type')=='whisper', 'model_type != whisper'" 2>/dev/null; then
  echo "warning: sanity-check failed — config.json not parseable or model_type != 'whisper'" >&2
  CLEANUP_OK=0
fi

if [ -f "$TARGET_DIR/pytorch_model.bin" ]; then
  echo "warning: sanity-check failed — pytorch_model.bin present in MLX dir (HF source leaked into target)" >&2
  CLEANUP_OK=0
fi

# --- 7. Auto-clean the -hf source --------------------------------------------

if [ "$CLEANUP_OK" -eq 1 ] && [ -z "${TRANSCRIBE_KEEP_HF:-}" ]; then
  if [ -d "$RAW_DIR" ]; then
    echo "==> Sanity check passed; removing -hf source ($RAW_DIR) to reclaim ~3 GB"
    rm -rf "$RAW_DIR"
  fi
elif [ "$CLEANUP_OK" -eq 0 ]; then
  echo "==> Sanity check FAILED; keeping -hf source at $RAW_DIR for recovery"
  echo "    If the converted model works, you can remove it manually:"
  echo "      rm -rf $RAW_DIR"
  echo "    If it doesn't, file an issue at https://github.com/ilyavorobiev/transcribe/issues"
  echo "    and re-run with: transcribe reinstall $(basename "$TARGET_DIR" -mlx)"
elif [ -n "${TRANSCRIBE_KEEP_HF:-}" ]; then
  echo "==> TRANSCRIBE_KEEP_HF set; keeping -hf source at $RAW_DIR"
fi

# --- 8. Done -----------------------------------------------------------------

cat <<EOF

Converted MLX model ready:
  $TARGET_DIR

Use it:
  transcribe path/to/audio.m4a --model $TARGET_DIR
EOF
