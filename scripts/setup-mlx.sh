#!/usr/bin/env bash
set -euo pipefail

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

ensure uv
ensure ffmpeg

if ! command -v mlx_whisper >/dev/null 2>&1; then
  echo "==> Installing mlx-whisper into an isolated uv tool venv..."
  uv tool install --python 3.12 mlx-whisper
else
  echo "==> mlx-whisper already installed: $(command -v mlx_whisper)"
fi

DEFAULT_MODEL="${MODEL:-antony66/whisper-large-v3-russian}"

cat <<EOF

Setup complete.
  mlx_whisper : $(command -v mlx_whisper)
  ffmpeg      : $(command -v ffmpeg)

The default model on first invocation is:
  $DEFAULT_MODEL

mlx_whisper downloads HuggingFace models lazily on first use and caches them
under ~/.cache/huggingface/. The first run on a fresh machine will fetch
~3 GB; subsequent runs are instant.

For HF repos already in MLX format, no conversion is needed. For repos in
the original safetensors format (like antony66/whisper-large-v3-russian),
mlx_whisper auto-converts on the fly the first time you load them.

Try it:
  bun run transcribe:mlx PRD1.m4a
  bun run transcribe:mlx PRD1.m4a --model bond005-turbo
  bun run transcribe:mlx PRD1.m4a --prompt "Обсуждаем MCP, API, latency."
EOF
