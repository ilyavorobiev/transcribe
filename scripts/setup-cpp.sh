#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/vendor"
MODELS="$ROOT/models"
WHISPER_DIR="$VENDOR/whisper.cpp"
MODEL_NAME="${MODEL:-large-v3}"

if ! command -v brew >/dev/null 2>&1; then
  echo "error: Homebrew is required. Install from https://brew.sh" >&2
  exit 1
fi

ensure() {
  local pkg="$1"
  local cmd="${2:-$1}"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "==> Installing $pkg..."
    brew install "$pkg"
  fi
}

ensure git
ensure cmake
ensure ffmpeg

mkdir -p "$VENDOR" "$MODELS"

if [ ! -d "$WHISPER_DIR/.git" ]; then
  echo "==> Cloning whisper.cpp..."
  git clone https://github.com/ggml-org/whisper.cpp "$WHISPER_DIR"
else
  echo "==> Updating whisper.cpp..."
  git -C "$WHISPER_DIR" pull --ff-only
fi

echo "==> Building whisper.cpp with Metal..."
cmake -S "$WHISPER_DIR" -B "$WHISPER_DIR/build" -DGGML_METAL=ON
cmake --build "$WHISPER_DIR/build" -j --config Release

WHISPER_BIN="$WHISPER_DIR/build/bin/whisper-cli"
if [ ! -x "$WHISPER_BIN" ]; then
  echo "error: build finished but $WHISPER_BIN is missing" >&2
  exit 1
fi

MODEL_FILE="$MODELS/ggml-$MODEL_NAME.bin"

# Minimum plausible size per model — if the file is smaller, treat as
# truncated and re-download. We don't hardcode exact sizes because HF
# occasionally re-uploads with tiny metadata changes (~400 KB drift), which
# makes an exact-match check trigger unnecessary multi-GB re-downloads.
MIN_SIZE_GB=""
case "$MODEL_NAME" in
  large-v3|large-v2) MIN_SIZE_GB=2.5 ;;
  large-v3-turbo)    MIN_SIZE_GB=1.4 ;;
  medium)            MIN_SIZE_GB=1.3 ;;
  small)             MIN_SIZE_GB=0.4 ;;
  base)              MIN_SIZE_GB=0.1 ;;
  tiny)              MIN_SIZE_GB=0.05 ;;
esac

needs_download=1
if [ -f "$MODEL_FILE" ]; then
  actual_bytes=$(stat -f %z "$MODEL_FILE" 2>/dev/null || stat -c %s "$MODEL_FILE")
  if [ -n "$MIN_SIZE_GB" ]; then
    min_bytes=$(awk "BEGIN { printf \"%d\", $MIN_SIZE_GB * 1024 * 1024 * 1024 }")
    if [ "$actual_bytes" -ge "$min_bytes" ]; then
      echo "==> Model already present (~$(awk "BEGIN { printf \"%.1f\", $actual_bytes/1024/1024/1024 }") GB, OK): $MODEL_FILE"
      needs_download=0
    else
      echo "==> Model present but $actual_bytes bytes < ${MIN_SIZE_GB} GB minimum — truncated; re-downloading"
      rm -f "$MODEL_FILE"
    fi
  else
    echo "==> Model already present: $MODEL_FILE"
    needs_download=0
  fi
fi

if [ "$needs_download" -eq 1 ]; then
  # NOTE: do NOT use $WHISPER_DIR/models/download-ggml-model.sh — it
  # silently truncates on HuggingFace's S3 redirect (see specs/cli/spec.md).
  echo "==> Downloading ggml-$MODEL_NAME.bin via curl..."
  curl -L --fail --progress-bar \
    -o "$MODEL_FILE" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$MODEL_NAME.bin"
fi

VAD_FILE="$MODELS/ggml-silero-v5.1.2.bin"
if [ ! -f "$VAD_FILE" ]; then
  echo "==> Downloading Silero VAD model (~880 KB)..."
  curl -L --fail --silent \
    -o "$VAD_FILE" \
    "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin"
else
  echo "==> VAD model already present: $VAD_FILE"
fi

cat <<EOF

cpp engine setup complete.
  whisper binary : $WHISPER_BIN
  model          : $MODEL_FILE
  VAD model      : $VAD_FILE

Sanity check:
  "$WHISPER_BIN" --help | head -5

Try it:
  bun run transcribe path/to/memo.m4a --engine cpp
EOF
