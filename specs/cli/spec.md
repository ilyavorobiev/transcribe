# Russian iPhone Audio Transcriber — Technical Specification

## 1. Meta Information

- **Branch:** `main`
- **Epic:** Personal tool — Russian voice-memo transcription
- **PRD:** N/A (personal project)

## 2. Context

Transcribe Russian-language voice memos recorded on an iPhone (`.m4a` files) into readable text on a local Mac. The tool runs fully offline using [whisper.cpp](https://github.com/ggml-org/whisper.cpp), avoiding cloud APIs and per-minute costs while keeping recordings private. Target environment is Apple Silicon (M-series), so the build path leverages Metal/Core ML acceleration.

## 3. Key Technical Drivers

- **Driver 1 — Offline & private:** No audio leaves the machine. Rules out OpenAI Whisper API, AssemblyAI, Deepgram, etc.
- **Driver 2 — Russian-language accuracy:** Russian is the primary language; multilingual Whisper models (`large-v3` / `large-v3-turbo`) are required for usable quality.
- **Driver 3 — Apple Silicon performance:** Must use Metal (and optionally Core ML encoder) so a 30-minute memo transcribes in well under real-time.
- **Driver 4 — Minimal friction:** Single CLI command (`transcribe path/to/file.m4a`) producing a `.txt` (and optionally `.srt`/`.json`) next to the source. No GUI, no daemon, no config file required.
- **Driver 5 — Low maintenance:** As few dependencies as possible. Wrapper code should be thin enough to read in one sitting.

## 4. Current State

Greenfield. Working directory `/Users/ivorobiev/Desktop/repos/transcriber` is empty. Mac assumed to have:

- macOS on Apple Silicon
- Homebrew
- Git, Xcode Command Line Tools

Nothing else is pre-installed; the setup script provisions everything.

## 5. Considered Options

### 5.1. Option 1: Bash wrapper around `whisper-cli`

- **Description:** ~40-line shell script that runs `ffmpeg | whisper-cli` directly.
- **Pros:** Smallest possible surface area; no runtime dependency beyond the binaries.
- **Cons:** Awkward to grow (batch mode, JSON post-processing, structured logs); error handling in bash is painful; no type safety on argument parsing.

### 5.2. Option 2: TypeScript CLI on Bun (CHOSEN)

- **Description:** TypeScript CLI executed via [Bun](https://bun.sh). Uses Bun's built-in `$` shell helper to spawn `ffmpeg` and `whisper-cli`. Distributed as a single repo with `bun run transcribe <file>` and an installable `transcribe` shim.
- **Pros:** Native TypeScript (no build step), fast startup, single binary runtime, ergonomic process spawning, easy to extend (batching, summaries, watch mode later).
- **Cons:** Adds Bun as a runtime dependency (small — single Homebrew install).

### 5.3. Option 3: Python with `pywhispercpp` or `faster-whisper`

- **Description:** Python CLI calling Python bindings to whisper.cpp (or the separate `faster-whisper` CTranslate2 implementation).
- **Pros:** Richest ecosystem for downstream NLP (summarization, diarization).
- **Cons:** Heavier setup (venv, pip, binding compilation); `faster-whisper` is a different engine than the project the user explicitly named (whisper.cpp).

### 5.4. Option 4: Node.js binding (`smart-whisper` / `whisper-node`)

- **Description:** Node package that links whisper.cpp via N-API.
- **Pros:** No subprocess overhead.
- **Cons:** Bindings lag upstream whisper.cpp releases; rebuilds can break on new macOS/Node versions; loses Core ML toggle that `whisper-cli` exposes via flags.

### 5.5. Comparison

| Criteria / Driver           | Bash wrapper | **TS on Bun** | Python | Node binding |
| --------------------------- | ------------ | ------------- | ------ | ------------ |
| Offline / private           | +            | +             | +      | +            |
| Russian accuracy            | +            | +             | +      | +            |
| Apple Silicon performance   | +            | +             | +      | ~            |
| Minimal friction (1 cmd)    | +            | +             | -      | +            |
| Low maintenance / readable  | ~            | +             | -      | -            |
| Easy to extend later        | -            | +             | +      | ~            |

## 6. Proposed Solution

A small TypeScript-on-Bun CLI that orchestrates two existing binaries: `ffmpeg` for audio normalization and `whisper-cli` (built from whisper.cpp source) for transcription.

```
transcriber/
├── src/
│   ├── cli.ts          # arg parsing + top-level orchestration
│   ├── audio.ts        # m4a → 16kHz mono WAV via ffmpeg
│   ├── whisper.ts      # whisper-cli invocation + flag mapping
│   └── paths.ts        # locate vendored binary, model file, output dir
├── scripts/
│   ├── setup.sh        # clone + build whisper.cpp, download model
│   └── install.sh      # symlink `transcribe` into ~/.local/bin
├── vendor/             # gitignored — whisper.cpp checkout + build artifacts
├── models/             # gitignored — ggml-*.bin model files
├── package.json
├── tsconfig.json
├── .gitignore
└── README.md
```

CLI shape:

```
transcribe <file.m4a> [options]

Options:
  --model <name>     tiny | base | small | medium | large-v3 | large-v3-turbo
                     (default: large-v3)
  --format <fmt>     txt | srt | vtt | json | all   (default: txt)
  --output <file>    output file path                (default: <input-stem>.<ext> next to input)
  --language <code>  ISO language code               (default: ru)
  --keep-wav         retain the intermediate 16kHz WAV
  --threads <n>      whisper threads                 (default: physical cores)
```

### 6.1. Setup script (`scripts/setup.sh`)

Idempotent shell script that:

1. Verifies `brew`, `git`, `cmake`, `ffmpeg` are present; installs missing ones with `brew install`.
2. Clones `https://github.com/ggml-org/whisper.cpp` into `vendor/whisper.cpp` (or `git pull` if present).
3. Builds with Metal enabled: `cmake -B build -DGGML_METAL=ON && cmake --build build -j --config Release`.
4. Downloads the chosen model (default `ggml-large-v3.bin`, ~3.1 GB) into `models/` via `vendor/whisper.cpp/models/download-ggml-model.sh`.
5. Prints the resolved binary path and a sanity-check command.

Core ML conversion is **out of scope for v1** (adds Python + coremltools dependency) but documented in the README as a future option.

### 6.2. Audio preprocessor (`src/audio.ts`)

`whisper-cli` only ingests 16 kHz mono PCM WAV. iPhone memos are AAC-in-MP4 at 44.1 / 48 kHz.

- Spawns `ffmpeg -i <input.m4a> -ar 16000 -ac 1 -c:a pcm_s16le <tmp.wav>`.
- Writes the WAV to `os.tmpdir()` unless `--keep-wav` is set (then writes next to the input).
- On non-zero exit: surface the last 20 lines of `ffmpeg` stderr and exit 1.
- Returns the WAV path.

### 6.3. Whisper runner (`src/whisper.ts`)

- Resolves `vendor/whisper.cpp/build/bin/whisper-cli` (override via `WHISPER_BIN` env var).
- Resolves `models/ggml-<name>.bin` (override via `WHISPER_MODEL_DIR`).
- Builds the argv:
  - `-m <model>` — model file
  - `-l ru` (or user override) — language
  - `-t <threads>` — physical core count from `os.cpus()`
  - `-f <wav>` — input
  - `-of <stem>` — output stem (whisper-cli appends the format extension; stem derived from `--output` with extension stripped, or from the input filename next to the input)
  - `--print-progress` so progress goes to stderr without polluting stdout
  - **Anti-hallucination defaults** (essential for long-form recordings):
    - `-mc 0` — set max-context tokens to 0, i.e. disable previous-segment
      context. The single biggest mitigation against self-reinforcing
      hallucination loops on silent or hesitant passages. Observed
      empirically: a 48-minute memo produced ~25 minutes of repeated
      `"Вау-эффект, вау-сценарий"` without this flag. (Note: an older
      whisper.cpp `-nc` / `--no-context` short-flag was removed in favor of
      `-mc N`; we discovered this the hard way when `-nc` made whisper-cli
      print its help, exit 0, and produce no file.)
    - `-bs 5` — beam-search size 5 (default; explicit for documentation).
      Beam search is materially better than greedy decoding on long-form
      audio.
    - `-et 2.6` — entropy threshold raised from the default 2.4. Triggers
      temperature fallback faster on degenerate spans, killing the residual
      short repetition loops (e.g. "демо демо демо") that survive `-mc 0`.
      Sourced from [whisper.cpp discussion #2286](https://github.com/ggml-org/whisper.cpp/discussions/2286).
    - `-fa` (`--flash-attn`) — Flash Attention on Metal. ~1.3–2× speedup at
      equal or better quality. Free win on Apple Silicon.
    - `--suppress-nst` — suppress non-speech tokens (breaths, laughter).
    - **No `-bo`** — best-of-N only kicks in at temperature > 0; with
      default T=0 it's slower for zero gain. Dropped after research review.
    - `--vad --vad-model models/ggml-silero-v5.1.2.bin` plus tuned timings:
      - `--vad-min-silence-duration-ms 500` (default 100 over-segments on
        "эээ"/"ну" pauses, which then trigger per-fragment hallucinations)
      - `--vad-speech-pad-ms 300` (default 30 clips words at segment edges)
      - `--vad-max-speech-duration-s 30` (matches Whisper's 30 s window;
        prevents internal re-chunking that re-introduces the loop bug)

      Silero VAD skips silent gaps entirely. Auto-enabled when the VAD
      model is present in the models directory (download:
      `curl -L -o models/ggml-silero-v5.1.2.bin https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin`).
      `transcribe()` emits a warning and proceeds without VAD if missing,
      rather than failing.
    - **Optional `--prompt <text>`** (CLI flag) — initial prompt for
      vocabulary biasing. Best written as *example text in the target
      register*, not as an instruction. For ru+en tech monologues:
      `--prompt "Обсуждаем MCP-сервер, API, latency, refactor. Эээ, ну, короче."`
      English acronyms in Latin form keep the BPE from transliterating them
      to Cyrillic; including disfluencies preserves them in the output.
      Measured WER effect ~1–3% but meaningful for domain vocabulary.
  - format flags: `-otxt`, `-osrt`, `-ovtt`, `-oj` (one or many) — placed
    last so the file-extension flags are visually grouped in `--help`.
- Streams stderr to the user's terminal; collects exit code; cleans up the
  temp WAV (unless `--keep-wav`).
- **Post-run output check**: after exit 0, verify the expected output files
  (`<outputStem>.<ext>` for each requested format) exist. If they don't,
  raise an error pointing at the stderr. This catches the case where
  whisper-cli encounters an unknown argument, prints its help, and exits 0
  without producing a transcript — a real bug we hit during development
  with the removed `-nc` flag.

### 6.4. CLI entry (`src/cli.ts`)

- Parses argv with a minimal hand-rolled parser (no need for `commander`/`yargs`).
- Validates: input file exists, extension is `.m4a` / `.mp3` / `.wav` / `.mp4` (warn-but-continue for non-m4a), model file exists.
- Pipeline: `validate → ffmpeg → whisper-cli → report output paths`.
- Exit codes: `0` success, `1` user error (bad args, missing file), `2` external tool failure.

### 6.5. Pros and Cons

- **Pros:**
  - Two small process boundaries (ffmpeg, whisper-cli) — easy to debug by running each command by hand.
  - Trivial to extend: a `transcribe-all <dir>` batch mode is a `for` loop; a watch mode is one `fs.watch` call.
  - All heavy lifting stays in the upstream binaries — we benefit from whisper.cpp performance work for free.
- **Cons:**
  - Spawn overhead per file (~tens of ms) — irrelevant for minute+ recordings, would matter for thousands of clips.
  - Requires the user to run `scripts/setup.sh` once; not pure `npm install`.
- **Consequences:**
  - First-run friction (clone + build whisper.cpp takes 1–2 minutes, model download is ~3.1 GB for `large-v3`). This is a one-time cost and is the price of running fully offline. Users who want faster transcription at slightly lower accuracy can pass `--model large-v3-turbo` (~1.6 GB, ~5–8× faster).

## 7. Testing Strategy

This is a thin orchestration layer over external binaries; tests focus on argv construction and the I/O contract, not on Whisper's transcription quality.

### 7.1. Unit Tests

- `audio.ts`: given an input path and options, the constructed `ffmpeg` argv is correct (`-ar 16000`, `-ac 1`, `pcm_s16le`, output extension `.wav`).
- `whisper.ts`: argv mapping for each format flag (`txt`, `srt`, `vtt`, `json`, `all`); model path resolution honors `WHISPER_MODEL_DIR`; thread count defaults sensibly.
- `cli.ts`: arg parser handles `--model`, `--format`, `--output`, `--language`, `--keep-wav`, `--threads`, and positional input; rejects missing input file with exit code 1. When `--output` is given, the path's parent directory is created if missing; with `--format all`, the path's extension is stripped and used as a stem (each format appends its own extension).
- `paths.ts`: binary resolution prefers `WHISPER_BIN`, falls back to `vendor/whisper.cpp/build/bin/whisper-cli`, errors clearly if neither exists.

### 7.2. Integration Tests

- One end-to-end test against a tiny committed sample (`fixtures/sample-ru-3s.m4a`, ~3 seconds of Russian speech) using the `tiny` model (only ~75 MB, fast in CI):
  - Asserts the command exits 0.
  - Asserts a `.txt` file is produced next to the input.
  - Asserts the produced `.txt` is non-empty UTF-8.
  - Does **not** assert specific transcribed text (model output is not byte-stable).
- Skip-by-default if `WHISPER_BIN` and the tiny model aren't present, so unit tests stay fast and dependency-free.

## 8. Definition of Done

### Universal (always required)

- [ ] Tests pass (`bun run test`)
- [ ] TypeScript compiles cleanly (`bun run typecheck`)
- [ ] Linter passes (`bun run lint`)
- [ ] Spec updated to reflect implementation (if diverged)

### Feature-Specific

- [ ] `scripts/setup.sh` runs end-to-end on a clean Apple Silicon Mac and produces a working `whisper-cli` plus downloaded `large-v3` model.
- [ ] `bun run transcribe path/to/memo.m4a` produces `memo.txt` next to the input, in Russian, for a real iPhone voice memo.
- [ ] All five CLI flags (`--model`, `--format`, `--output`, `--language`, `--keep-wav`) function as documented.
- [ ] Errors from `ffmpeg` or `whisper-cli` are surfaced (last lines of stderr) rather than swallowed.
- [ ] Temp WAV files are cleaned up on success and on failure (unless `--keep-wav`).
- [ ] `README.md` documents: install, setup, basic usage, model trade-offs (turbo vs large-v3 vs medium), and troubleshooting (missing ffmpeg, missing model).
- [ ] `transcribe` shim installed via `scripts/install.sh` works from any directory.

## 9. Alternatives Not Chosen

- **OpenAI Whisper API / cloud STT (AssemblyAI, Deepgram):** Rejected — violates Driver 1 (offline/private) and incurs per-minute cost.
- **Original Python OpenAI Whisper:** Rejected — slower than whisper.cpp on Apple Silicon, requires PyTorch, larger install footprint.
- **`faster-whisper` (CTranslate2):** Excellent performance but is a different engine than the user-named whisper.cpp. Worth revisiting if v1 proves too slow.
- **MacWhisper / other GUI apps:** Rejected — not scriptable, opaque, paid for the good models.
- **Diarization (who-said-what), summarization, translation:** Out of scope for v1. Architecture leaves room to add a post-processing step that consumes the JSON output.
- **Watch-folder daemon / web UI:** Out of scope for v1 per chosen interface; the CLI is composable into either later (`fswatch | xargs -n1 transcribe`).

## 10. References

- whisper.cpp: <https://github.com/ggml-org/whisper.cpp>
- whisper.cpp models index: <https://huggingface.co/ggerganov/whisper.cpp>
- Whisper paper (multilingual evaluation including Russian): <https://cdn.openai.com/papers/whisper.pdf>
- whisper.cpp Core ML guide: <https://github.com/ggml-org/whisper.cpp#core-ml-support>
- ffmpeg AAC decoding & resampling: <https://ffmpeg.org/ffmpeg.html>
- Bun shell (`$`) docs: <https://bun.sh/docs/runtime/shell>
