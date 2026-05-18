# transcriber — agent instructions

Personal CLI tool: offline transcription of iPhone `.m4a` voice memos (Russian
by default). Two backends, unified behind a single CLI:

- **mlx** (default) — Apple Silicon native via
  [`mlx-whisper`](https://github.com/ml-explore/mlx-examples/tree/main/whisper).
  Loads HuggingFace models directly; defaults to
  [`antony66/whisper-large-v3-russian`](https://huggingface.co/antony66/whisper-large-v3-russian)
  for ~35% lower WER on Russian than stock large-v3.
- **cpp** — [`whisper.cpp`](https://github.com/ggml-org/whisper.cpp) built
  from source with Metal. Offline-strict, no Python, richer VAD knobs,
  cross-platform-friendly. Use when MLX defaults don't fit.

Bun + TypeScript. macOS only. Single binary: `transcribe`.

## First time on this repo

1. `bun install` — installs `@types/bun` and `typescript`. Fast.
2. `bun run setup` — **one-shot install of everything**: both engines,
   all default models, conversions. Idempotent; safe to re-run.
   - Disk: ~16 GB. Time: ~10–20 min depending on network.
   - Installs Homebrew deps (`uv`, `ffmpeg`, `cmake`, `git`).
   - Installs `mlx-whisper` into an isolated `uv tool` venv.
   - Clones + builds `whisper.cpp` with Metal.
   - Downloads `ggml-large-v3.bin` (~3.1 GB) + Silero VAD (~1 MB) for cpp.
   - Downloads + converts `antony66/whisper-large-v3-russian` (default).
   - Downloads + converts `bond005/whisper-podlodka-turbo`.
   - When it finishes, the next command can be `bun run transcribe …`.
3. Skips for narrow setups:
   - `bash scripts/setup-all.sh --no-cpp`     — MLX only (~12 GB)
   - `bash scripts/setup-all.sh --no-bond005` — antony66 only (~10 GB)
   - `bash scripts/setup-all.sh --no-mlx`     — cpp only (~4 GB)
   - `bun run setup:mlx` / `bun run setup:cpp` — single engine, explicit
4. `bun run typecheck && bun test` — should pass without any setup having run
   (tests are pure; they don't spawn ffmpeg/whisper/mlx_whisper).

## MLX model conversion

Russian Whisper fine-tunes on HuggingFace
([antony66/whisper-large-v3-russian](https://huggingface.co/antony66/whisper-large-v3-russian),
[bond005/whisper-podlodka-turbo](https://huggingface.co/bond005/whisper-podlodka-turbo))
ship in **HF Transformers format** — `mlx_whisper` cannot load them
directly and will error with
`TypeError: ModelDimensions.__init__() got an unexpected keyword argument '_name_or_path'`.

Use the conversion script:

```sh
# convert antony66 → models/antony66-russian-mlx/
bash scripts/convert-hf-to-mlx.sh antony66/whisper-large-v3-russian

# convert bond005 → models/podlodka-turbo-mlx/
bash scripts/convert-hf-to-mlx.sh bond005/whisper-podlodka-turbo

# then use it
bun run transcribe foo.m4a --model models/antony66-russian-mlx
bun run transcribe foo.m4a --model models/podlodka-turbo-mlx
```

What the script does:

1. Lists files in the repo via the HF API (skips `test_*.wav` fixtures).
2. **Downloads via plain `curl`** rather than `mlx_whisper`'s built-in
   downloader. The HF parallel Python downloader frequently stalls in
   `CLOSE_WAIT` on large multi-file Russian repos; plain curl is reliable.
3. Fetches `mlx-examples/whisper/convert.py` (it's not bundled with the
   `mlx-whisper` pip package).
4. Runs the conversion via `uv tool run --from mlx-whisper --with transformers --with torch`
   so torch and transformers are present without polluting your global Python.
5. Renames `model.safetensors` → `weights.safetensors`. `mlx-whisper 0.4.3`
   expects the latter name; the upstream `convert.py` writes the former.
   Plain version skew.

**Pre-converted MLX models** (anything under `mlx-community/`) can be passed
to `--model` directly with no conversion needed — `mlx_whisper` auto-downloads
them on first use.

```sh
bun run transcribe foo.m4a --model mlx-community/whisper-large-v3-turbo
bun run transcribe foo.m4a --model mlx-community/whisper-large-v3-mlx
```

## Essential commands

```sh
bun run transcribe <file.m4a> [flags]   # mlx engine, antony66-russian model
bun run transcribe foo.m4a --engine cpp # whisper.cpp engine, large-v3 model
bun run test                            # unit tests — fast, no external deps
bun run typecheck                       # strict TS check
bun run setup                           # provision mlx-whisper
bun run setup:cpp                       # provision whisper.cpp + ggml model
bun run install:bin                     # write ~/.local/bin/transcribe shim
```

## When to use which engine

| Recording type                     | --engine | --model           |
| ---------------------------------- | -------- | ----------------- |
| Russian only (primary use)         | mlx      | antony66-russian (default) |
| Russian + English acronyms         | mlx      | bond005-turbo     |
| English / other languages          | mlx      | large-v3          |
| Air-gapped / version-pinned        | cpp      | large-v3          |
| No Python in stack                 | cpp      | large-v3          |
| Cross-platform (future Linux/Win)  | cpp      | large-v3          |

## Layout

```
src/
  cli.ts            # entry, arg parsing, --engine dispatch
  audio.ts          # ffmpeg preprocessor (used only by cpp engine)
  paths.ts          # binary / model resolution (WHISPER_BIN, WHISPER_MODEL_DIR)
  engines/
    types.ts        # Format, EngineName, TranscribeOptions, Engine interface
    cpp.ts          # whisper.cpp wrapper + whisperArgv (pure)
    mlx.ts          # mlx-whisper wrapper + mlxArgv + model alias table (pure)
    *.test.ts       # colocated engine tests
  *.test.ts         # colocated cli / audio / paths tests
scripts/
  setup-mlx.sh      # default — installs uv + mlx-whisper
  setup.sh          # cpp engine — clones whisper.cpp, builds, downloads model
  install.sh        # symlink transcribe shim into PATH
specs/
  README.md         # spec index
  cli/spec.md       # built — local CLI (whisper.cpp era)
  publish/spec.md   # proposed — public npm + GitHub release
  mlx-russian/spec.md  # implemented — MLX engine + Russian fine-tune
guidelines/
  workflow.md, docs/{spec,prd}.md, roles/{eng,em}.md   # spec/PRD templates
vendor/             # whisper.cpp checkout + build (gitignored; cpp engine only)
models/             # downloaded ggml-*.bin files (gitignored; cpp engine only)
```

## Conventions

- **TypeScript**: strict, `noUncheckedIndexedAccess` enabled. Array index
  access returns `T | undefined` — handle it explicitly.
- **Subprocesses**: use `Bun.spawn` (not Node `child_process`).
- **Engine interface**: each engine in `src/engines/` exports a pure
  `*Argv()` function and an `Engine` object implementing `transcribe()`.
  Both are tested independently; the CLI just dispatches.
- **Pure argv functions**: `ffmpegArgv`, `whisperArgv`, `mlxArgv` are pure
  and unit-tested. Always thread new flags through them so they stay
  testable without spawning real processes.
- **Tests**: `bun:test` (`import { test, expect } from "bun:test"`). Tests
  must run without `ffmpeg`, `whisper-cli`, or `mlx_whisper` installed. Use
  env-var setup (e.g. `WHISPER_BIN`) only inside isolated `test()` blocks
  with restore in `afterEach`.
- **Output-file post-check**: every engine's `transcribe()` verifies the
  expected output file exists after exit-code-0. Caught a real bug
  (whisper-cli silently printing help and exiting 0 on an unknown flag).
- **Errors**:
  - User errors (bad args, missing file) → exit 1, message via `console.error`.
  - External tool failures → exit 2, surface last 20 stderr lines.
  - Internal bugs → throw; the harness will surface the stack.
- **Comments**: default to none. Only explain non-obvious WHY (a workaround,
  an invariant). Don't write WHAT — the code says that.
- **No runtime npm dependencies**. Devtime only: `@types/bun`, `typescript`.

## CLI shape (reference)

```
transcribe <file.m4a> [options]
  --engine <name>    mlx | cpp                       (default: mlx)
  --model <name>     engine-specific alias or HuggingFace repo id
                     mlx defaults to antony66-russian
                     cpp defaults to large-v3
  --format <fmt>     txt | srt | vtt | json | all   (default: txt)
  --output <file>    output file path                (default: <input-stem>.<ext> next to input)
  --language <code>  ISO language code               (default: ru)
  --prompt <text>    initial prompt for vocabulary biasing
  --threads <n>      decoder threads (cpp engine only; default: min(cpus, 8))
  --keep-wav         retain the intermediate 16kHz WAV (cpp engine only)
  -h, --help         show this help
```

`--output` is a **file path** (not a directory). With `--format all`, the
extension is stripped and used as a stem; each format appends its own
extension.

`--keep-wav` and `--threads` are rejected with a clear error if combined
with `--engine mlx` (mlx_whisper handles audio internally and manages its
own threading).

## Adding work

- **New spec**: create `specs/<slug>/spec.md` following
  `guidelines/docs/spec.md`. Add the entry to `specs/README.md`.
- **New flag**: thread it through `parseArgs` (`src/cli.ts`), then through the
  pure argv builder in `src/whisper.ts` or `src/audio.ts`. Add tests in the
  matching `*.test.ts`.
- **New language / model**: no code change needed — pass `--language <code>`
  / `--model <name>`. Model file must exist at
  `models/ggml-<name>.bin` (download via the script printed by `modelPath`'s
  error message, or `bun run setup --model <name>` once setup is in TS).

## Things to NOT do

- **Don't add a programmatic library export** (`import { transcribe }`).
  v0.1 is CLI-only by design — see `specs/publish/spec.md` §9.
- **Don't download the model from postinstall.** Multi-GB downloads during
  `npm install` are hostile. Setup is an explicit user step.
- **Don't change `--output` back to a directory.** It's a file path now.
- **Don't add Linux/Windows support to v0.1.** `package.json` will set
  `os: ["darwin"]` once published; cross-platform is a future epic.
  (Note: cpp engine could in principle run on Linux too. MLX engine cannot.)
- **Don't add runtime npm dependencies.** External binaries (ffmpeg,
  whisper-cli, mlx_whisper) are managed by the setup scripts, not npm.
- **Don't use the upstream `download-ggml-model.sh` for downloads.** It
  silently truncates on HuggingFace's S3 redirect (we hit this — see
  `specs/publish/spec.md` §6.4 step 8). Use `Bun.fetch` / `curl -L` directly.
- **Don't rely on `mlx_whisper`'s built-in HF download for large
  multi-file Russian repos** (antony66, bond005). It stalls in
  `CLOSE_WAIT`. `HF_HUB_ENABLE_HF_TRANSFER` is deprecated;
  `HF_XET_HIGH_PERFORMANCE=1` didn't help in our testing either. Use
  `scripts/convert-hf-to-mlx.sh` which curls each file.
- **Don't pass an mlx output stem with dots in it directly to mlx_whisper.**
  Its writer does `Path(name).with_suffix(".txt")` which strips at the
  last dot (so `PRD1.v5-antony.txt` becomes `PRD1.txt`). The mlx engine
  wrapper in `src/engines/mlx.ts` already applies `sanitizeOutputName()`
  + post-rename — keep that intact when editing.
- **Don't assume HF-format safetensors are MLX-loadable.** They're not.
  Russian fine-tunes need the conversion step in
  `scripts/convert-hf-to-mlx.sh`. Symptom of a missed conversion:
  `TypeError: ModelDimensions.__init__() got an unexpected keyword argument '_name_or_path'`.
- **Don't add a third engine without a new `specs/<engine>/spec.md`.** The
  Engine interface is `src/engines/types.ts`; follow the pattern in
  `cpp.ts` / `mlx.ts`. Each engine owns its model alias table.
- **Don't merge engine-specific flags into the shared `Engine` interface
  without thinking.** `--threads` and `--keep-wav` are cpp-only and live in
  `TranscribeOptions` as optional; the cli rejects them with a clear error
  if combined with `--engine mlx`. Don't silently drop them.
- **Don't commit `vendor/`, `models/`, `*.m4a`, or `*.wav`.** They're in
  `.gitignore` for good reasons (size, license, privacy).

## Pointers

- Original tool spec: `specs/cli/spec.md`
- Publishing plan: `specs/publish/spec.md`
- Spec template: `guidelines/docs/spec.md`
- whisper.cpp upstream: <https://github.com/ggml-org/whisper.cpp>
