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
if [ ! -f "$MODEL_FILE" ]; then
  echo "==> Downloading model: $MODEL_NAME"
  bash "$WHISPER_DIR/models/download-ggml-model.sh" "$MODEL_NAME" "$MODELS"
else
  echo "==> Model already present: $MODEL_FILE"
fi

cat <<EOF

Setup complete.
  whisper binary : $WHISPER_BIN
  model          : $MODEL_FILE

Sanity check:
  "$WHISPER_BIN" --help | head -5

Try it:
  bun run transcribe path/to/memo.m4a
EOF
