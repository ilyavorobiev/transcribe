#!/usr/bin/env bash
#
# Single-shot setup: install both engines, download and convert all
# default models. After this completes, the only thing left to do is:
#
#   bun run transcribe path/to/memo.m4a
#
# Steps (each is idempotent — re-runs skip work that's already done):
#   1. Homebrew deps        (uv, ffmpeg, cmake, git)
#   2. mlx-whisper          (via `uv tool install`)
#   3. whisper.cpp          (clone, build with Metal, get ggml-large-v3 + VAD)
#   4. antony66 → MLX       (download + convert)
#   5. bond005 → MLX        (download + convert)
#   6. GigaAM-v3            (warm uv venv + HF cache for Russian default)
#
# Total disk: ~20 GB (less if you skip --no-cpp / --no-bond005 / --no-gigaam).
# Total time: ~15–30 min depending on download speed.
#
# Flags:
#   --no-cpp        skip whisper.cpp build + ggml model (saves ~3.5 GB)
#   --no-bond005    skip bond005 (saves ~6 GB; antony66 is the primary
#                   Russian Whisper fine-tune anyway)
#   --no-mlx        skip MLX entirely (just install cpp + gigaam)
#   --no-gigaam     skip GigaAM (saves ~4 GB; falls back to mlx + antony66
#                   for Russian)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

SKIP_CPP=0
SKIP_BOND005=0
SKIP_MLX=0
SKIP_GIGAAM=0
for arg in "$@"; do
  case "$arg" in
    --no-cpp)     SKIP_CPP=1 ;;
    --no-bond005) SKIP_BOND005=1 ;;
    --no-mlx)     SKIP_MLX=1 ;;
    --no-gigaam)  SKIP_GIGAAM=1 ;;
    -h|--help)
      sed -n '2,/^set -euo pipefail/p' "$0" | sed 's/^# \?//;$d'
      exit 0 ;;
    *) echo "warning: unknown flag: $arg (use -h)" >&2 ;;
  esac
done

# --- Disk-space check --------------------------------------------------------

REQ_GB=20
[ "$SKIP_CPP" -eq 1 ] && REQ_GB=$((REQ_GB - 3))
[ "$SKIP_MLX" -eq 1 ] && REQ_GB=$((REQ_GB - 6))
[ "$SKIP_BOND005" -eq 1 ] && REQ_GB=$((REQ_GB - 6))
[ "$SKIP_GIGAAM" -eq 1 ] && REQ_GB=$((REQ_GB - 4))

AVAIL_GB=$(df -k "$ROOT" | tail -1 | awk '{ printf "%d", $4/1024/1024 }')
echo "==> Disk: ${AVAIL_GB} GB free, ~${REQ_GB} GB needed"
if [ "$AVAIL_GB" -lt "$REQ_GB" ]; then
  echo "error: insufficient disk space (need ~${REQ_GB} GB, have ${AVAIL_GB} GB)" >&2
  echo "       free some up, or use --no-cpp / --no-bond005 to reduce." >&2
  exit 1
fi

# --- Section 1: brew deps ----------------------------------------------------

if ! command -v brew >/dev/null 2>&1; then
  echo "error: Homebrew is required. Install from https://brew.sh" >&2
  exit 1
fi

ensure() {
  local pkg="$1"
  local cmd="${2:-$1}"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "    installing $pkg..."
    brew install "$pkg"
  fi
}

echo "==> Section 1/5: Homebrew dependencies"
ensure uv
ensure ffmpeg
[ "$SKIP_CPP" -eq 0 ] && { ensure cmake; ensure git; }

# --- Section 2: mlx-whisper --------------------------------------------------

if [ "$SKIP_MLX" -eq 1 ]; then
  echo "==> Section 2/5: skipping MLX (--no-mlx)"
else
  echo "==> Section 2/5: mlx-whisper"
  if command -v mlx_whisper >/dev/null 2>&1; then
    echo "    already installed: $(command -v mlx_whisper)"
  else
    echo "    installing mlx-whisper into isolated uv tool venv..."
    uv tool install --python 3.12 mlx-whisper
  fi
fi

# --- Section 3: whisper.cpp --------------------------------------------------

if [ "$SKIP_CPP" -eq 1 ]; then
  echo "==> Section 3/5: skipping whisper.cpp (--no-cpp)"
else
  echo "==> Section 3/5: whisper.cpp + ggml-large-v3 + Silero VAD"
  MODEL=large-v3 bash "$ROOT/scripts/setup-cpp.sh"
fi

# --- Section 4: antony66 (default Russian model) -----------------------------

if [ "$SKIP_MLX" -eq 1 ]; then
  echo "==> Section 4/5: skipping antony66 (--no-mlx)"
else
  echo "==> Section 4/5: antony66/whisper-large-v3-russian → MLX"
  # Explicit target dir matches the alias `antony66-russian` in
  # src/engines/mlx.ts. Keep the names in sync.
  if [ -f "$ROOT/models/antony66-russian-mlx/weights.safetensors" ]; then
    echo "    already converted: models/antony66-russian-mlx/"
  else
    bash "$ROOT/scripts/convert-hf-to-mlx.sh" \
      antony66/whisper-large-v3-russian \
      "$ROOT/models/antony66-russian-mlx"
  fi
fi

# --- Section 5: bond005 (ru+en code-switching) -------------------------------

if [ "$SKIP_MLX" -eq 1 ] || [ "$SKIP_BOND005" -eq 1 ]; then
  echo "==> Section 5/6: skipping bond005"
else
  echo "==> Section 5/6: bond005/whisper-podlodka-turbo → MLX"
  # Explicit target dir matches the alias `bond005-turbo`. Keep in sync.
  if [ -f "$ROOT/models/bond005-turbo-mlx/weights.safetensors" ]; then
    echo "    already converted: models/bond005-turbo-mlx/"
  else
    bash "$ROOT/scripts/convert-hf-to-mlx.sh" \
      bond005/whisper-podlodka-turbo \
      "$ROOT/models/bond005-turbo-mlx"
  fi
fi

# --- Section 6: GigaAM-v3 (default Russian engine) ---------------------------

if [ "$SKIP_GIGAAM" -eq 1 ]; then
  echo "==> Section 6/6: skipping GigaAM (--no-gigaam)"
else
  echo "==> Section 6/6: GigaAM-v3 (Sber, default for --language ru)"
  # Download model files directly via curl — same robustness pattern as
  # the Whisper Russian fine-tunes. Avoids huggingface_hub's stalling
  # parallel downloader and the `from_pretrained(<repo-id>)` first-run
  # latency. Tiny repo: ~420 MB at e2e_rnnt revision.
  if [ -f "$ROOT/models/gigaam-v3-e2e-rnnt/pytorch_model.bin" ]; then
    echo "    model files already present: models/gigaam-v3-e2e-rnnt/"
  else
    bash "$ROOT/scripts/download-hf-model.sh" \
      ai-sage/GigaAM-v3 \
      "$ROOT/models/gigaam-v3-e2e-rnnt" \
      --revision e2e_rnnt
  fi
  # Warm the uv venv (resolves torch + transformers + pyannote + ~3 GB of
  # wheels). Model load uses the local files we just downloaded.
  echo "    warming uv venv (first run: ~5 min for torch + transformers + pyannote)..."
  uv run --script "$ROOT/scripts/gigaam_transcribe.py" \
    --model-repo "$ROOT/models/gigaam-v3-e2e-rnnt" \
    --revision main \
    --warm
fi

# --- Summary -----------------------------------------------------------------

cat <<EOF

==============================================================================
Setup complete. Try transcribing now:

  bun run transcribe path/to/memo.m4a
                              # default: mlx + antony66 for Russian,
                              #          mlx + large-v3 for other languages

  bun run transcribe path/to/memo.m4a --model bond005-turbo
                              # MLX + bond005 (ru+en code-switching alt)

  bun run transcribe path/to/memo.m4a --engine gigaam
                              # Sber GigaAM-v3 — opt-in 2nd-opinion engine
                              # (didn't measurably beat antony66 on our test)

  bun run transcribe path/to/memo.m4a --engine cpp
                              # whisper.cpp + ggml-large-v3 + Silero VAD

  bun run transcribe path/to/memo.m4a --prompt "Обсуждаем MCP, API, latency."
                              # vocabulary biasing (mlx/cpp only)

EOF
