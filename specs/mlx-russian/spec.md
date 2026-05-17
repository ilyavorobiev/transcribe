# Add MLX Engine alongside whisper.cpp + Russian Fine-tune

## 1. Meta Information

- **Branch:** TBD (e.g. `mlx-russian`)
- **Epic:** Quality v2 — add MLX engine and a Russian fine-tuned model
- **PRD:** N/A (personal project)
- **Status:** **Implemented** (deviation from original §5.1 → §5.2 — see
  Implementation Notes below).

## 2. Context

The current tool (see [`specs/cli/spec.md`](../cli/spec.md)) uses `whisper.cpp`
built from source with the stock OpenAI `large-v3` model. After flag tuning
(`specs/cli/spec.md` §6.3 anti-hallucination defaults + VAD), it produces
usable Russian transcripts but still:

- mishears Russian-specific phrases (stock `large-v3` WER ≈ **9.84** on
  Common Voice 17 ru);
- transliterates English acronyms inside Russian sentences ("MCP" → "эмсипи");
- has no way to load HuggingFace fine-tunes without manual `convert-h5-to-ggml.py`
  conversion that lags upstream model updates.

This spec proposes replacing the engine and model in one shot:

- **Engine**: [`mlx-whisper`](https://github.com/ml-explore/mlx-examples/tree/main/whisper)
  — Apple-native MLX implementation, loads HuggingFace Whisper models
  directly (or via lightweight conversion), 1.5–2× faster than whisper.cpp
  on M-series.
- **Model**: [`antony66/whisper-large-v3-russian`](https://huggingface.co/antony66/whisper-large-v3-russian)
  — Russian fine-tune, WER **6.39** on Common Voice 17 ru
  (**~35% relative improvement**). Fallback option:
  [`bond005/whisper-podlodka-turbo`](https://huggingface.co/bond005/whisper-podlodka-turbo)
  — turbo-based, explicit ru+en code-switching, lower hallucination rate.

Same CLI shape (`transcribe <file.m4a>`) — engine swap is invisible to the
user except for: a Python install during setup, a different first-run model
download, and noticeably better Russian output.

## 3. Key Technical Drivers

- **Driver 1 — Russian transcription quality**: ~35% WER reduction is the
  single biggest quality lever available; flag tuning is marginal in
  comparison. Validated against Common Voice 17 ru benchmarks published by
  the model authors.
- **Driver 2 — Easy access to HuggingFace fine-tunes**: future model swaps
  (a newer Russian fine-tune, a domain-specific one) become a config change,
  not a build-script change.
- **Driver 3 — Apple Silicon native**: MLX is Apple's own framework; no
  custom cmake build, no Metal vs CPU branching, automatic mixed precision.
- **Driver 4 — Same CLI UX**: the user must not have to learn new flags or
  change how they invoke the tool. Internal engine swap, external behavior
  preserved.
- **Driver 5 — Reversible**: setup keeps both engines available during a
  transition period so the user can `--engine whisper.cpp` if MLX
  misbehaves on a specific recording.

## 4. Current State

- Engine: `vendor/whisper.cpp/build/bin/whisper-cli` (built from source).
- Model: `models/ggml-large-v3.bin` (3.1 GB).
- Pipeline (per `specs/cli/spec.md`): `ffmpeg` → `whisper-cli` → output file.
- Flags currently emitted (after the Path A tuning that lands alongside this
  spec): `-mc 0 -bs 5 -et 2.6 -fa --suppress-nst --vad --vad-model ...
  --vad-min-silence-duration-ms 500 --vad-speech-pad-ms 300
  --vad-max-speech-duration-s 30 [--prompt ...]`.
- Empirical baseline on `PRD1.m4a` (48 min Russian monologue): readable
  transcript with occasional short repetition loops (~6–16 lines repeated
  for filler phrases like "Как бы", "и пиентов такое демо демо").
- No Python in the project; Bun-only runtime.

## 5. Considered Options

### 5.1. Option 1: Replace engine + model

- **Description**: Remove whisper.cpp from the runtime path. Setup installs
  `uv` (Python package manager) and `mlx-whisper`. Default model becomes a
  Russian fine-tune. `src/whisper.ts` becomes `src/mlx.ts` and spawns
  `mlx_whisper` instead of `whisper-cli`.
- **Pros**: simplest mental model; smallest long-term surface area; one
  engine, one model format, one update path.
- **Cons**: largest one-time change; loses whisper.cpp's strengths
  (offline-strict, no Python, richer VAD, cross-platform-friendly); no
  fallback for non-Russian recordings where the Russian fine-tune hurts
  quality.

### 5.2. Option 2: Add MLX as opt-in `--engine mlx` (CHOSEN)

- **Description**: Keep `whisper.cpp` available; add MLX as a parallel
  engine selectable via flag. **Default engine** flipped to `mlx` so the
  common case (Russian recordings) gets the better path automatically.
- **Pros**: best of both — MLX + antony66 for Russian quality, whisper.cpp
  retained for offline-strict / no-Python / cross-platform scenarios.
  Engine separation made the implementation cleaner than expected via a
  shared `Engine` interface.
- **Cons**: two engine wrappers and two setup scripts to maintain. Argv
  builders for both engines must stay pure and tested.

**Reason for changing the choice mid-implementation**: while drafting the
implementation, it became clear that the cpp engine genuinely wins for
non-Russian recordings (a Russian fine-tune actively hurts English) and
that the duplication cost was small (~150 LoC for the cpp wrapper, kept
behind a `--engine cpp` flag).

### 5.3. Option 3: Convert Russian fine-tunes to ggml, keep whisper.cpp

- **Description**: Use `vendor/whisper.cpp/models/convert-h5-to-ggml.py` to
  produce `ggml-antony66-russian.bin` and `ggml-bond005-turbo.bin`. No
  engine change.
- **Pros**: zero engine churn; keeps the lightweight Bun-only runtime.
- **Cons**: conversion requires Python anyway (defeats the "no Python"
  argument); conversion lags model updates and silently breaks on architecture
  changes; quality of converted models historically slightly worse than
  native; we wouldn't get the MLX speed boost or future fine-tune
  loadability.

### 5.4. Option 4: Stay on whisper.cpp + stock `large-v3` (status quo)

- **Description**: Do nothing. Accept the current quality.
- **Pros**: no work.
- **Cons**: the ~35% Russian WER gap is exactly what's still annoying about
  current output (mistransliterated acronyms, "круд"→"крут" class errors).

### 5.5. Comparison

| Criteria / Driver           | 1 Replace | 2 Opt-in MLX (CHOSEN) | 3 Convert to ggml | 4 Status quo |
| --------------------------- | --------- | --------------------- | ----------------- | ------------ |
| Russian WER improvement     | + (~35%)  | + (~35%)              | + (~30%)          | -            |
| Easy future fine-tune swaps | +         | +                     | -                 | -            |
| Apple Silicon native        | +         | +                     | ~ (Metal in cpp)  | ~            |
| Smallest setup surface      | +         | -                     | ~                 | +            |
| Reversibility               | -         | +                     | +                 | n/a          |
| Non-Russian recording fallback | -      | +                     | +                 | +            |
| No-Python option preserved  | -         | + (via --engine cpp)  | +                 | +            |

## 6. Proposed Solution

### 6.1. New runtime dependency: Python via `uv`

- Setup installs [`uv`](https://docs.astral.sh/uv/) via Homebrew (`brew install uv`),
  the fast Python package manager from Astral.
- `uv tool install --python 3.12 mlx-whisper` installs `mlx_whisper` into an
  isolated venv on PATH. No global Python pollution.
- Pinned in the setup script for reproducibility:
  `uv tool install --python 3.12 'mlx-whisper==X.Y.Z'`.

Why uv: zero-config, faster than pip, manages the Python version itself,
shipping a single binary. Project ships no `requirements.txt` or
`pyproject.toml`; we treat `mlx-whisper` as a binary dependency just like
ffmpeg.

### 6.2. Model acquisition

**Default model**: `antony66/whisper-large-v3-russian` if an MLX-converted
copy exists on `mlx-community/...`; otherwise convert on first setup via
`python -m mlx_whisper.convert --hf-repo antony66/whisper-large-v3-russian
--mlx-path models/whisper-large-v3-russian-mlx`.

**Alternative**: `bond005/whisper-podlodka-turbo` — flagged as the choice
for recordings with heavier ru+en mixing (e.g. tech podcasts). User
selects with `--model bond005-turbo`.

Models live in the existing cache dir (per `specs/publish/spec.md` §6.6,
`~/Library/Caches/transcribe/models/`) as MLX-formatted directories rather
than single `.bin` files. Path resolution in `src/paths.ts` extended to
return a directory path when the model is MLX-format.

### 6.3. New `src/mlx.ts` (replaces `src/whisper.ts`)

```ts
export interface MlxArgs {
  inputPath: string;          // .m4a or .wav — mlx_whisper handles ffmpeg internally
  outputDir: string;
  modelPath: string;
  language: string;
  format: Format;
  initialPrompt?: string;
  temperature: number;        // default 0
  wordTimestamps: boolean;    // default false
}

export function mlxArgv(opts: MlxArgs): string[];
export async function transcribe(opts: TranscribeOptions): Promise<void>;
```

Argv mapping (verified against `mlx_whisper --help`):

| Our flag           | mlx_whisper arg                |
| ------------------ | ------------------------------ |
| `--model`          | `--model <path-or-hf-id>`      |
| `--language`       | `--language <code>`            |
| `--format txt`     | `--output-format txt`          |
| `--format all`     | (multiple invocations or `--output-format all`) |
| `--output <file>`  | `--output-dir <dir> --output-name <stem>` |
| `--prompt <text>`  | `--initial-prompt <text>`      |
| (not exposed)      | `--temperature 0` (default)    |
| (not exposed)      | `--no-speech-threshold 0.6` (default) |

Same purity discipline as whisper.ts: `mlxArgv()` stays a pure function for
unit testing.

### 6.4. VAD strategy

`mlx_whisper` does **not** bundle Silero VAD. Two paths:

1. **Run our own VAD pre-pass** with `pyannote.audio` or a standalone Silero
   ONNX (Python). Adds complexity and another model download.
2. **Rely on mlx_whisper's built-in `--no-speech-threshold` and chunking**.
   Tighten the no-speech threshold from default 0.6 to e.g. 0.5 to be more
   aggressive about skipping non-speech.

**Decision for v1**: option 2. Simpler, no extra model, and the Russian
fine-tunes are explicitly trained with fewer non-speech hallucinations
(bond005 mentions this). If it's empirically worse than the whisper.cpp +
Silero baseline, add option 1 in v1.1.

### 6.5. CLI shape (unchanged)

```
transcribe <file.m4a> [options]
  --model <name>     antony66-russian | bond005-turbo | large-v3 | large-v3-turbo
                     (default: antony66-russian)
  --format <fmt>     txt | srt | vtt | json | all   (default: txt)
  --output <file>    output file path                (default: <input-stem>.<ext> next to input)
  --language <code>  ISO language code               (default: ru)
  --prompt <text>    initial prompt (vocabulary biasing)
  --threads <n>      decoder threads                 (default: min(cpus, 8))
  -h, --help         show this help
```

Differences from the whisper.cpp version: `--keep-wav` removed (mlx_whisper
handles audio decoding internally; no temp WAV to keep). Model name aliases
map to MLX paths internally (`antony66-russian` → cache-dir path).

### 6.6. Setup script changes

`scripts/setup.sh` (or `src/commands/setup.ts` post-publish-spec):

1. `brew install uv ffmpeg` (whisper.cpp / cmake / git no longer needed).
2. `uv tool install --python 3.12 'mlx-whisper==X.Y.Z'`.
3. Download / convert default model:
   - Try `huggingface-cli download mlx-community/whisper-large-v3-russian-mlx --local-dir <cache>/models/...`.
   - If 404, fall back to: `python -m mlx_whisper.convert --hf-repo antony66/whisper-large-v3-russian --mlx-path <cache>/models/...`.
4. Print summary with the resolved binary (`which mlx_whisper`) and model
   directory path.

Estimated first-run setup: ~3 min vs current ~10 min (no whisper.cpp build,
similar download size).

### 6.7. Removed components

- `vendor/whisper.cpp/` checkout — no longer used; can be deleted at the
  user's discretion to reclaim ~500 MB of disk.
- `cmake` and `git` build-time dependencies — no longer required.
- `src/whisper.ts`, `src/whisper.test.ts` — replaced.
- VAD model file (`ggml-silero-v5.1.2.bin`) — no longer used by MLX engine.

### 6.8. Pros and Cons

- **Pros**:
  - ~35% Russian WER reduction (the primary goal).
  - English acronyms preserved in Latin script for ru+en code-switching
    (specifically what bond005 is trained for).
  - 1.5–2× faster decoding on M-series.
  - Trivial future model swaps (any HF Whisper-architecture model).
  - Simpler setup (no source build).
- **Cons**:
  - Python in the dependency tree (mitigated by `uv` isolation).
  - Lose Silero VAD; rely on mlx_whisper's internal no-speech detection.
  - First version of the engine swap; less battle-tested in the project than
    whisper.cpp.
- **Consequences**:
  - The `specs/publish/spec.md` postinstall + setup design needs updating
    to install Python tooling instead of building C++.
  - `package.json` should keep `os: ["darwin"]` — MLX is Apple-only.
  - VAD-related env vars, paths, and tests are removed.

## 7. Testing Strategy

### 7.1. Unit Tests

- `mlxArgv()`: pure-function tests for argv construction across all formats,
  with and without `--initial-prompt`.
- `paths.ts`: MLX-model-directory resolution honors `TRANSCRIBE_CACHE_DIR`
  and falls back to default cache directory.
- `cli.ts`: model name aliases (`antony66-russian`, `bond005-turbo`)
  resolve to expected cache paths.

### 7.2. Integration Tests (manual, documented in CONTRIBUTING.md)

- Side-by-side run on `PRD1.m4a` (existing fixture): MLX + antony66 vs
  whisper.cpp + large-v3. Compare unique-line ratio and tail content.
  Acceptance: MLX run shows no hallucination loops longer than 3 repeats and
  contains recognizable continued content past the 25-minute mark (where
  v1 broke).
- Spot-check: tech acronyms ("MCP", "API", "PRD") appear in Latin script in
  MLX output (not transliterated).

## 8. Definition of Done

### Universal (always required)

- [ ] Tests pass (`bun run test`)
- [ ] TypeScript compiles cleanly (`bun run typecheck`)
- [ ] Linter passes (`bun run lint`)
- [ ] Spec updated to reflect implementation (if diverged)

### Feature-Specific

- [ ] `scripts/setup.sh` installs `uv` + `mlx-whisper` and downloads/converts
      the default Russian model on a clean Apple Silicon Mac.
- [ ] `src/mlx.ts` implements `mlxArgv()` and `transcribe()`; `src/whisper.ts`
      and related VAD code removed (or moved to git history if a rollback
      escape hatch is desired).
- [ ] `bun run transcribe PRD1.m4a` produces a recognizable Russian
      transcript covering the full duration of the input (no truncation past
      a hallucination loop).
- [ ] English acronyms in the input appear in Latin script in the output.
- [ ] Output formats (`txt`, `srt`, `vtt`, `json`, `all`) all produced
      correctly.
- [ ] `specs/cli/spec.md` updated or replaced to reflect the new engine.
- [ ] `specs/publish/spec.md` Execution Plan revised to reference the new
      setup steps.
- [ ] `AGENTS.md` updated: layout, commands, conventions, things-not-to-do.

## 9. Alternatives Not Chosen

- **`whisperX` (with diarization + forced alignment)**: only useful for
  multi-speaker scenarios or word-level timestamps. Our use case is
  single-speaker monologue; net negative complexity.
- **`faster-whisper` (CTranslate2)**: same accuracy as openai/whisper (and
  whisper.cpp) — speed-only upgrade, not a quality upgrade. Doesn't address
  the primary driver.
- **`insanely-fast-whisper`**: throughput play, no quality advantage.
- **Cloud APIs (OpenAI Whisper API, AssemblyAI, ElevenLabs Scribe)**: would
  reach equal or better quality but conflicts with the project's offline /
  private design driver (see `specs/cli/spec.md` Driver 1).
- **Fine-tuning our own model**: out of scope. Community models already
  exist and address the gap.
- **LLM-based post-processing for cleanup** (Claude / GPT-4 reformatting):
  worth doing separately; orthogonal to engine choice. Track as a future
  spec.

## 11. Implementation Notes (post-spec)

The implementation followed **Option 2** rather than the originally-chosen
Option 1. Concrete shape that landed:

### Layout

```
src/
  cli.ts                   # single CLI entry, --engine dispatch (default: mlx)
  audio.ts                 # ffmpeg preprocessor (used only by cpp engine)
  paths.ts                 # cpp engine: WHISPER_BIN / WHISPER_MODEL_DIR resolution
  engines/
    types.ts               # Format, EngineName, TranscribeOptions, Engine interface
    cpp.ts                 # whisper.cpp wrapper + pure whisperArgv()
    mlx.ts                 # mlx-whisper wrapper + pure mlxArgv() + model alias table
    cpp.test.ts
    mlx.test.ts
scripts/
  setup-mlx.sh             # default `bun run setup` — installs uv + mlx-whisper
  setup.sh                 # `bun run setup:cpp` — builds whisper.cpp + downloads ggml model
```

### `Engine` interface

```ts
export type EngineName = "mlx" | "cpp";

export interface TranscribeOptions {
  inputPath: string;
  outputStem: string;
  model: string;
  language: string;
  format: Format;
  initialPrompt?: string;
  threads?: number;        // cpp only — rejected by CLI if --engine mlx
  keepWav?: boolean;       // cpp only — rejected by CLI if --engine mlx
}

export interface Engine {
  name: EngineName;
  transcribe(opts: TranscribeOptions): Promise<void>;
}
```

The cpp engine's `transcribe()` internally calls `preprocess()` (ffmpeg
→ WAV) and `cleanup()` (rm WAV); the mlx engine's `transcribe()` spawns
`mlx_whisper` directly since it handles audio internally. Both check for
the expected output file after exit 0 (catches the silent-failure bug we
hit with the removed `-nc` flag).

### Default model per engine

```ts
const DEFAULT_MODEL: Record<EngineName, string> = {
  mlx: "antony66-russian",
  cpp: "large-v3",
};
```

If `--model` is unset, the engine's default applies. Either engine accepts
an explicit `--model` (alias or raw HF repo id for mlx; ggml model name for
cpp).

### Tests

39 tests across 5 files (was 23 pre-Path-A, 30 after Path A, now 39 after
unification refactor): cli routing + `--engine` validation + engine-specific
flag rejection; both engines' pure argv builders; ffmpeg argv; cache-dir
resolution.

## 10. References

- mlx-examples Whisper: <https://github.com/ml-explore/mlx-examples/tree/main/whisper>
- mlx-whisper PyPI: <https://pypi.org/project/mlx-whisper/>
- antony66 model card (WER 6.39 vs 9.84): <https://huggingface.co/antony66/whisper-large-v3-russian>
- bond005 podlodka-turbo (ru+en, hallucination-resistant): <https://huggingface.co/bond005/whisper-podlodka-turbo>
- "Choosing between Whisper variants" (Modal blog): <https://modal.com/blog/choosing-whisper-variants>
- Simon Willison on mlx-whisper: <https://simonwillison.net/2024/Aug/13/mlx-whisper/>
- Open Russian speech models 2025 (alphacephei): <https://alphacephei.com/nsh/2025/04/18/russian-models.html>
- uv (Python package manager): <https://docs.astral.sh/uv/>
- mac-whisper-speedtest benchmarks: <https://github.com/anvanvan/mac-whisper-speedtest>
