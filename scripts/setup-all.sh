#!/usr/bin/env bash
#
# Single-shot setup: install both engines, download and convert all
# default models. After this completes, the only thing left to do is:
#
#   transcribe path/to/memo.m4a
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
#
# Where artifacts go:
#   Default: ~/Library/Caches/transcribe/{models,vendor}/ (survives
#            `bun update -g` reinstalls).
#   Override with TRANSCRIBE_CACHE_DIR=<path>, or XDG_CACHE_HOME=<path>
#   (we'll append /transcribe).
#   Local-dev backcompat: if running from a source checkout AND
#   <repo>/models/ already has files, that path is preferred so the
#   original author's existing downloads aren't orphaned.

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

# --- Cache directory resolution ---------------------------------------------

# Resolves MODELS_DIR and VENDOR_DIR (exported via TRANSCRIBE_MODELS_DIR /
# TRANSCRIBE_VENDOR_DIR so child helper scripts pick them up). Mirrors
# src/paths.ts cacheRoot() so the setup-time write target matches the
# runtime read paths.
resolve_artifact_dirs() {
  local explicit_cache="${TRANSCRIBE_CACHE_DIR:-}"
  local cache_root
  if [ -n "$explicit_cache" ]; then
    cache_root="$explicit_cache"
  elif [ -n "${XDG_CACHE_HOME:-}" ]; then
    cache_root="$XDG_CACHE_HOME/transcribe"
  else
    cache_root="$HOME/Library/Caches/transcribe"
  fi

  # Local-dev backcompat: when running from a source checkout (has .git or
  # specs/) AND <repo>/models already has at least one big artifact, prefer
  # those paths. Avoids re-downloading 20 GB on the original author's
  # machine. The runtime resolver in src/paths.ts has the same fallback so
  # the read path agrees with the write path.
  local has_repo_models=0
  if [ -d "$ROOT/models" ]; then
    if find "$ROOT/models" -maxdepth 2 -type f -size +10M 2>/dev/null | head -1 | grep -q .; then
      has_repo_models=1
    fi
  fi
  local in_local_dev=0
  if [ -d "$ROOT/.git" ] || [ -d "$ROOT/specs" ]; then
    in_local_dev=1
  fi

  if [ -z "$explicit_cache" ] && [ "$in_local_dev" -eq 1 ] && [ "$has_repo_models" -eq 1 ]; then
    MODELS_DIR="$ROOT/models"
    VENDOR_DIR="$ROOT/vendor"
    echo "==> Artifacts dir (local-dev backcompat): $ROOT/{models,vendor}"
  else
    MODELS_DIR="$cache_root/models"
    VENDOR_DIR="$cache_root/vendor"
    mkdir -p "$MODELS_DIR" "$VENDOR_DIR"
    echo "==> Artifacts dir: $cache_root/{models,vendor}"
  fi
  export TRANSCRIBE_MODELS_DIR="$MODELS_DIR"
  export TRANSCRIBE_VENDOR_DIR="$VENDOR_DIR"
}

resolve_artifact_dirs

# --- Disk-space check --------------------------------------------------------

REQ_GB=20
[ "$SKIP_CPP" -eq 1 ] && REQ_GB=$((REQ_GB - 3))
[ "$SKIP_MLX" -eq 1 ] && REQ_GB=$((REQ_GB - 6))
[ "$SKIP_BOND005" -eq 1 ] && REQ_GB=$((REQ_GB - 6))
[ "$SKIP_GIGAAM" -eq 1 ] && REQ_GB=$((REQ_GB - 4))

# df the cache dir's parent (which definitely exists), not the cache dir
# itself (which we may have just created).
AVAIL_GB=$(df -k "$(dirname "$MODELS_DIR")" | tail -1 | awk '{ printf "%d", $4/1024/1024 }')
echo "==> Disk: ${AVAIL_GB} GB free at $(dirname "$MODELS_DIR"), ~${REQ_GB} GB needed"
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

echo "==> Section 1/6: Homebrew dependencies"
ensure uv
ensure ffmpeg
[ "$SKIP_CPP" -eq 0 ] && { ensure cmake; ensure git; }

# --- Section 2: mlx-whisper --------------------------------------------------

if [ "$SKIP_MLX" -eq 1 ]; then
  echo "==> Section 2/6: skipping MLX (--no-mlx)"
else
  echo "==> Section 2/6: mlx-whisper"
  if command -v mlx_whisper >/dev/null 2>&1; then
    echo "    already installed: $(command -v mlx_whisper)"
  else
    echo "    installing mlx-whisper into isolated uv tool venv..."
    uv tool install --python 3.12 mlx-whisper
  fi
fi

# --- Section 3: whisper.cpp --------------------------------------------------

if [ "$SKIP_CPP" -eq 1 ]; then
  echo "==> Section 3/6: skipping whisper.cpp (--no-cpp)"
else
  echo "==> Section 3/6: whisper.cpp + ggml-large-v3 + Silero VAD"
  MODEL=large-v3 bash "$ROOT/scripts/setup-cpp.sh"
fi

# --- Section 4: antony66 (default Russian model) -----------------------------

if [ "$SKIP_MLX" -eq 1 ]; then
  echo "==> Section 4/6: skipping antony66 (--no-mlx)"
else
  echo "==> Section 4/6: antony66/whisper-large-v3-russian → MLX"
  # Target dir matches the alias `antony66-russian` subdir resolved by
  # src/engines/mlx.ts. Keep names in sync.
  ANTONY_DIR="$MODELS_DIR/antony66-russian-mlx"
  if [ -f "$ANTONY_DIR/weights.safetensors" ]; then
    echo "    already converted: $ANTONY_DIR"
  else
    bash "$ROOT/scripts/convert-hf-to-mlx.sh" \
      antony66/whisper-large-v3-russian \
      "$ANTONY_DIR"
  fi
fi

# --- Section 5: bond005 (ru+en code-switching) -------------------------------

if [ "$SKIP_MLX" -eq 1 ] || [ "$SKIP_BOND005" -eq 1 ]; then
  echo "==> Section 5/6: skipping bond005"
else
  echo "==> Section 5/6: bond005/whisper-podlodka-turbo → MLX"
  BOND005_DIR="$MODELS_DIR/bond005-turbo-mlx"
  if [ -f "$BOND005_DIR/weights.safetensors" ]; then
    echo "    already converted: $BOND005_DIR"
  else
    bash "$ROOT/scripts/convert-hf-to-mlx.sh" \
      bond005/whisper-podlodka-turbo \
      "$BOND005_DIR"
  fi
fi

# --- Section 6: GigaAM-v3 (opt-in 2nd-opinion Russian engine) ----------------

if [ "$SKIP_GIGAAM" -eq 1 ]; then
  echo "==> Section 6/6: skipping GigaAM (--no-gigaam)"
else
  echo "==> Section 6/6: GigaAM-v3 (Sber, opt-in 2nd-opinion for ru)"
  # Curl-based download (same robustness pattern as Whisper Russian
  # fine-tunes — avoids huggingface_hub's stalling parallel downloader).
  GIGAAM_DIR="$MODELS_DIR/gigaam-v3-e2e-rnnt"
  if [ -f "$GIGAAM_DIR/pytorch_model.bin" ]; then
    echo "    model files already present: $GIGAAM_DIR"
  else
    bash "$ROOT/scripts/download-hf-model.sh" \
      ai-sage/GigaAM-v3 \
      "$GIGAAM_DIR" \
      --revision e2e_rnnt
  fi
  echo "    warming uv venv (first run: ~5 min for torch + transformers + pyannote)..."
  uv run --script "$ROOT/scripts/gigaam_transcribe.py" \
    --model-repo "$GIGAAM_DIR" \
    --revision main \
    --warm
fi

# --- Summary -----------------------------------------------------------------

cat <<EOF

==============================================================================
Setup complete. Artifacts: $MODELS_DIR

Try transcribing now:

  transcribe path/to/memo.m4a
                              # default: mlx + antony66 for Russian,
                              #          mlx + large-v3 for other languages

  transcribe path/to/memo.m4a --model bond005-turbo
                              # MLX + bond005 (ru+en code-switching alt)

  transcribe path/to/memo.m4a --engine gigaam
                              # Sber GigaAM-v3 — opt-in 2nd-opinion engine

  transcribe path/to/memo.m4a --engine cpp
                              # whisper.cpp + ggml-large-v3 + Silero VAD

  transcribe path/to/memo.m4a --prompt "Обсуждаем MCP, API, latency."
                              # vocabulary biasing (mlx/cpp only)

EOF
