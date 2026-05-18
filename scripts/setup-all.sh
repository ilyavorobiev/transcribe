#!/usr/bin/env bash
#
# transcribe setup orchestrator.
#
# Default install (no flags) is the MINIMAL set: mlx engine + antony66
# Russian fine-tune. ~6 GB, ~8 min. Everything else is opt-in.
#
# Usage:
#   transcribe setup                           # minimal default
#   transcribe setup --with cpp                # add whisper.cpp
#   transcribe setup --with gigaam             # add GigaAM
#   transcribe setup --with cpp --with gigaam  # combine
#   transcribe setup --full                    # everything (~20 GB)
#   transcribe setup --clean                   # only run cleanup pass
#   transcribe setup --force                   # re-download even if present
#   transcribe setup --wipe                    # rm -rf install set then install
#   transcribe setup --wipe --with gigaam      # wipe + reinstall just gigaam
#                                              #   (== `transcribe reinstall gigaam`)
#
# Deprecated (still honored, emits a stderr warning, removal in 1.0.0):
#   --no-cpp / --no-mlx / --no-gigaam / --no-bond005
#     Each implies --full minus the named component.
#
# Artifacts:
#   ~/Library/Caches/transcribe/{models,vendor}/  (default)
#   Override with TRANSCRIBE_CACHE_DIR or XDG_CACHE_HOME (we append /transcribe).
#   Local-dev backcompat: if <repo>/models already has files, that path
#   wins (so the author's existing downloads aren't orphaned).
#
# Env knobs:
#   TRANSCRIBE_KEEP_HF=1      keep -hf source dirs (skip cleanup after convert)
#   TRANSCRIBE_KEEP_BUILD=1   keep whisper.cpp CMakeFiles/ (skip cpp build cleanup)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# --- Flag parse ------------------------------------------------------------

INSTALL_SET_DEFAULT="mlx,antony66"
INSTALL_SET_FULL="mlx,antony66,bond005,cpp,gigaam"

declare -a WITH_ITEMS=()
declare -a REMOVE_ITEMS=()
FULL_EXPLICIT=0
FORCE=0
CLEAN_ONLY=0
WIPE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --full)        FULL_EXPLICIT=1 ;;
    --with)
      if [ -z "${2:-}" ]; then
        echo "error: --with requires a value (mlx|antony66|bond005|cpp|gigaam)" >&2
        exit 1
      fi
      case "$2" in
        mlx|antony66|bond005|cpp|gigaam) WITH_ITEMS+=("$2") ;;
        *) echo "error: --with: unknown component '$2'" >&2; exit 1 ;;
      esac
      shift ;;
    --force)       FORCE=1 ;;
    --clean)       CLEAN_ONLY=1 ;;
    --wipe)        WIPE=1 ;;
    --no-mlx)
      echo "warning: --no-mlx is deprecated; remove it and rely on the minimal default" >&2
      REMOVE_ITEMS+=(mlx antony66 bond005)
      FULL_EXPLICIT=1 ;;
    --no-cpp)
      echo "warning: --no-cpp is deprecated; remove it and rely on the minimal default" >&2
      REMOVE_ITEMS+=(cpp)
      FULL_EXPLICIT=1 ;;
    --no-gigaam)
      echo "warning: --no-gigaam is deprecated; remove it and rely on the minimal default" >&2
      REMOVE_ITEMS+=(gigaam)
      FULL_EXPLICIT=1 ;;
    --no-bond005)
      echo "warning: --no-bond005 is deprecated; remove it and rely on the minimal default" >&2
      REMOVE_ITEMS+=(bond005)
      FULL_EXPLICIT=1 ;;
    -h|--help)
      sed -n '2,/^set -euo pipefail/p' "$0" | sed 's/^# \?//;$d'
      exit 0 ;;
    *)
      echo "error: unknown flag: $1 (use -h for help)" >&2
      exit 1 ;;
  esac
  shift
done

# Compute install set
if [ "$FULL_EXPLICIT" -eq 1 ]; then
  IFS=, read -r -a START_SET <<<"$INSTALL_SET_FULL"
else
  IFS=, read -r -a START_SET <<<"$INSTALL_SET_DEFAULT"
fi

# union(START_SET, WITH_ITEMS) minus REMOVE_ITEMS, deduped
declare -A SET_MAP=()
for i in "${START_SET[@]}";  do SET_MAP[$i]=1; done
for i in "${WITH_ITEMS[@]}";  do SET_MAP[$i]=1; done
for i in "${REMOVE_ITEMS[@]}"; do unset 'SET_MAP[$i]'; done

# Conflict check: --with X and --no-X
for w in "${WITH_ITEMS[@]}"; do
  for r in "${REMOVE_ITEMS[@]}"; do
    if [ "$w" = "$r" ]; then
      echo "error: conflicting flags --with $w and --no-$w" >&2
      exit 1
    fi
  done
done

# mlx prerequisite for antony66/bond005
if [ -z "${SET_MAP[mlx]:-}" ]; then
  if [ -n "${SET_MAP[antony66]:-}" ] || [ -n "${SET_MAP[bond005]:-}" ]; then
    echo "error: antony66 and bond005 require the mlx engine" >&2
    exit 1
  fi
fi

in_set() { [ -n "${SET_MAP[$1]:-}" ]; }

INSTALL_SUMMARY=""
for i in mlx antony66 bond005 cpp gigaam; do
  if in_set "$i"; then INSTALL_SUMMARY="$INSTALL_SUMMARY $i"; fi
done
INSTALL_SUMMARY="${INSTALL_SUMMARY:- (none)}"

# --- Cache directory resolution -------------------------------------------

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

# --- Cleanup pass (idempotent; can run standalone via --clean) ------------

run_cleanup() {
  echo "==> Cleanup: removing intermediary -hf source dirs (~3 GB each)"
  if [ -z "${TRANSCRIBE_KEEP_HF:-}" ]; then
    local dir
    for dir in "$MODELS_DIR"/*-hf; do
      [ -d "$dir" ] || continue
      echo "    rm: $dir"
      rm -rf "$dir"
    done
  else
    echo "    (skipped: TRANSCRIBE_KEEP_HF set)"
  fi
  echo "==> Cleanup: removing whisper.cpp build intermediates (~200 MB)"
  if [ -z "${TRANSCRIBE_KEEP_BUILD:-}" ]; then
    local build_dir="$VENDOR_DIR/whisper.cpp/build"
    if [ -d "$build_dir/CMakeFiles" ]; then
      echo "    rm: $build_dir/CMakeFiles"
      rm -rf "$build_dir/CMakeFiles"
    fi
    if [ -d "$build_dir" ]; then
      find "$build_dir" -name '*.o' -delete 2>/dev/null || true
    fi
  else
    echo "    (skipped: TRANSCRIBE_KEEP_BUILD set)"
  fi
}

if [ "$CLEAN_ONLY" -eq 1 ]; then
  run_cleanup
  echo "==> Done."
  exit 0
fi

# --- Wipe pass (only what's in the install set) ---------------------------

run_wipe() {
  echo "==> Wipe: removing existing artifacts for the install set"
  if in_set antony66; then
    echo "    rm: $MODELS_DIR/antony66-russian-mlx*"
    rm -rf "$MODELS_DIR/antony66-russian-mlx" "$MODELS_DIR/antony66-russian-hf"
  fi
  if in_set bond005; then
    echo "    rm: $MODELS_DIR/bond005-turbo-mlx*"
    rm -rf "$MODELS_DIR/bond005-turbo-mlx" "$MODELS_DIR/bond005-turbo-hf"
  fi
  if in_set cpp; then
    echo "    rm: $VENDOR_DIR/whisper.cpp/build and ggml-large-v3.bin + VAD"
    rm -rf "$VENDOR_DIR/whisper.cpp/build"
    rm -f "$MODELS_DIR/ggml-large-v3.bin" "$MODELS_DIR/ggml-silero-v5.1.2.bin"
  fi
  if in_set gigaam; then
    echo "    rm: $MODELS_DIR/gigaam-*"
    rm -rf "$MODELS_DIR"/gigaam-*
  fi
}

if [ "$WIPE" -eq 1 ]; then
  run_wipe
fi

echo "==> Installing:$INSTALL_SUMMARY"
[ "$FORCE" -eq 1 ] && echo "    (--force: ignoring already-present checks)"

# --- Disk-space check (rough; sum of installed items) ---------------------

REQ_GB=0
in_set mlx       && REQ_GB=$((REQ_GB + 1))   # uv venv
in_set antony66  && REQ_GB=$((REQ_GB + 4))   # HF + MLX (-hf cleaned after)
in_set bond005   && REQ_GB=$((REQ_GB + 4))   # same
in_set cpp       && REQ_GB=$((REQ_GB + 4))   # build + ggml + VAD
in_set gigaam    && REQ_GB=$((REQ_GB + 4))   # torch + transformers wheels + model

AVAIL_GB=$(df -k "$(dirname "$MODELS_DIR")" | tail -1 | awk '{ printf "%d", $4/1024/1024 }')
echo "==> Disk: ${AVAIL_GB} GB free, ~${REQ_GB} GB needed"
if [ "$AVAIL_GB" -lt "$REQ_GB" ]; then
  echo "error: insufficient disk space" >&2
  exit 1
fi

# --- Section 1: brew deps -------------------------------------------------

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

echo "==> Homebrew deps"
in_set mlx     && { ensure uv; ensure ffmpeg; }
in_set gigaam  && { ensure uv; ensure ffmpeg; }
in_set cpp     && { ensure cmake; ensure git; ensure ffmpeg; }

# --- Section 2: mlx-whisper ------------------------------------------------

if in_set mlx; then
  echo "==> mlx-whisper"
  if command -v mlx_whisper >/dev/null 2>&1 && [ "$FORCE" -eq 0 ]; then
    echo "    already installed: $(command -v mlx_whisper)"
  else
    echo "    installing mlx-whisper into isolated uv tool venv..."
    uv tool install --python 3.12 mlx-whisper $([ "$FORCE" -eq 1 ] && echo --force)
  fi
fi

# --- Section 3: whisper.cpp ------------------------------------------------

if in_set cpp; then
  echo "==> whisper.cpp + ggml-large-v3 + Silero VAD"
  MODEL=large-v3 bash "$ROOT/scripts/setup-cpp.sh"
fi

# --- Section 4: antony66 ---------------------------------------------------

if in_set antony66; then
  echo "==> antony66/whisper-large-v3-russian → MLX"
  ANTONY_DIR="$MODELS_DIR/antony66-russian-mlx"
  if [ -f "$ANTONY_DIR/weights.safetensors" ] && [ "$FORCE" -eq 0 ]; then
    echo "    already converted: $ANTONY_DIR"
  else
    bash "$ROOT/scripts/convert-hf-to-mlx.sh" \
      antony66/whisper-large-v3-russian \
      "$ANTONY_DIR"
  fi
fi

# --- Section 5: bond005 ----------------------------------------------------

if in_set bond005; then
  echo "==> bond005/whisper-podlodka-turbo → MLX"
  BOND005_DIR="$MODELS_DIR/bond005-turbo-mlx"
  if [ -f "$BOND005_DIR/weights.safetensors" ] && [ "$FORCE" -eq 0 ]; then
    echo "    already converted: $BOND005_DIR"
  else
    bash "$ROOT/scripts/convert-hf-to-mlx.sh" \
      bond005/whisper-podlodka-turbo \
      "$BOND005_DIR"
  fi
fi

# --- Section 6: GigaAM-v3 --------------------------------------------------

if in_set gigaam; then
  echo "==> GigaAM-v3 (Sber)"
  GIGAAM_DIR="$MODELS_DIR/gigaam-v3-e2e-rnnt"
  if [ -f "$GIGAAM_DIR/pytorch_model.bin" ] && [ "$FORCE" -eq 0 ]; then
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

# --- Final cleanup --------------------------------------------------------

run_cleanup

# --- Summary --------------------------------------------------------------

cat <<EOF

==============================================================================
Setup complete. Artifacts: $MODELS_DIR
Installed:$INSTALL_SUMMARY

Try transcribing now:

  transcribe path/to/memo.m4a                       # default: mlx + antony66
EOF
in_set cpp     && echo "  transcribe path/to/memo.m4a --engine cpp           # whisper.cpp"
in_set gigaam  && echo "  transcribe path/to/memo.m4a --engine gigaam        # GigaAM-v3 (Russian)"
in_set bond005 && echo "  transcribe path/to/memo.m4a --model bond005-turbo  # ru+en code-switching"
echo
echo "  transcribe reinstall <name>                       # wipe + reinstall one item"
echo "  transcribe setup --with gigaam                    # add an opt-in component"
echo
