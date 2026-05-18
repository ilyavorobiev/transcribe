#!/usr/bin/env bash
#
# Set up the MLX engine for transcribe.
#
# Installs:
#   - Homebrew packages: uv (Python package manager), ffmpeg (audio decode)
#   - mlx-whisper in an isolated uv tool venv
#
# Then (by default) downloads and converts the antony66 Russian fine-tune.
# Skip the model conversion with --no-model.
#
# Usage:
#   bun run setup                    # full setup including antony66 conversion
#   bash scripts/setup-mlx.sh --no-model      # tools only, convert later
#   MODEL=bond005/whisper-podlodka-turbo bash scripts/setup-mlx.sh
#   MODEL=mlx-community/whisper-large-v3-turbo bash scripts/setup-mlx.sh
#                                    # ↑ pre-converted MLX model on HF, no convert step

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKIP_MODEL=0
for arg in "$@"; do
  case "$arg" in
    --no-model) SKIP_MODEL=1 ;;
    *) echo "warning: unknown arg: $arg" >&2 ;;
  esac
done

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

MODEL="${MODEL:-antony66/whisper-large-v3-russian}"

if [ "$SKIP_MODEL" -eq 1 ]; then
  cat <<EOF

Tools installed. Skipped model download (--no-model).

To convert a HuggingFace Whisper fine-tune to MLX format later:
  bash scripts/convert-hf-to-mlx.sh <hf-repo>

For pre-converted MLX models (no conversion needed), pass the HF repo
directly to the CLI:
  bun run transcribe foo.m4a --model mlx-community/whisper-large-v3-turbo
EOF
  exit 0
fi

# Decide if conversion is needed. mlx-community models are pre-converted.
case "$MODEL" in
  mlx-community/*)
    echo "==> $MODEL is pre-converted MLX — no conversion needed"
    echo "    mlx_whisper will auto-download it on first use, or pre-fetch:"
    echo "    bun run transcribe foo.m4a --model $MODEL"
    ;;
  *)
    echo "==> $MODEL is in HF Transformers format; running conversion"
    bash "$ROOT/scripts/convert-hf-to-mlx.sh" "$MODEL"
    ;;
esac

cat <<EOF

Setup complete.
  mlx_whisper : $(command -v mlx_whisper)
  ffmpeg      : $(command -v ffmpeg)

Try it:
  bun run transcribe path/to/memo.m4a
  bun run transcribe path/to/memo.m4a --model bond005-turbo
  bun run transcribe path/to/memo.m4a --prompt "Обсуждаем MCP, API, latency."
EOF
