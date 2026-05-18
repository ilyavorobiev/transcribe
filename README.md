# @ilyavorobiev/transcribe

[![npm](https://img.shields.io/npm/v/@ilyavorobiev/transcribe.svg)](https://npmjs.com/package/@ilyavorobiev/transcribe)
[![license](https://img.shields.io/npm/l/@ilyavorobiev/transcribe.svg)](./LICENSE)
[![CI](https://github.com/ilyavorobiev/transcribe/actions/workflows/ci.yml/badge.svg)](https://github.com/ilyavorobiev/transcribe/actions/workflows/ci.yml)
[![platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](#supported-platforms)

Offline transcription of iPhone `.m4a` voice memos on macOS, with three
engines unified behind a single CLI. Optimized for Russian; multilingual
support via Whisper. Built for Apple Silicon (Metal), works on Intel via
the cpp engine.

```sh
bun add -g @ilyavorobiev/transcribe
transcribe setup            # one-time, ~15–30 min, ~20 GB
transcribe memo.m4a         # produces memo.txt next to memo.m4a
```

## Why three engines

Different recordings sound their best on different models. `transcribe`
ships all three so you can switch with one flag.

| Recording type                              | Engine + model                        | One-liner                                            |
| ------------------------------------------- | ------------------------------------- | ---------------------------------------------------- |
| Russian (with or without tech acronyms)     | **mlx + antony66-russian** (default)  | `transcribe memo.m4a`                                |
| Russian, heavy ru+en code-switching         | mlx + bond005-turbo                   | `transcribe memo.m4a --model bond005-turbo`          |
| English / German / French / Japanese / …    | **mlx + large-v3** (default for `--language`≠`ru`) | `transcribe memo.m4a --language en`     |
| Russian, second-opinion for LLM-vote        | gigaam + gigaam-v3                    | `transcribe memo.m4a --engine gigaam`                |
| Offline-strict / version-pinned / no Python | cpp + large-v3                        | `transcribe memo.m4a --engine cpp`                   |

Defaults are language-aware for the mlx engine: `--language ru` →
[`antony66/whisper-large-v3-russian`](https://huggingface.co/antony66/whisper-large-v3-russian),
otherwise stock multilingual `large-v3`. Engine and language are
independent — there is no automatic engine selection based on language
(see [`specs/gigaam/spec.md`](./specs/gigaam/spec.md) field findings for
the reasoning).

## Supported platforms

- **macOS Apple Silicon (M-series)** — fully supported. All three engines.
- **macOS Intel** — cpp engine works. mlx + gigaam require Apple Silicon
  for usable performance.
- **Linux / Windows** — not supported in v0.x. The `os` field in
  `package.json` blocks install with a clear error.

## Disk footprint

Full setup pulls ~20 GB. Trim with engine-skip flags:

```sh
transcribe setup --no-cpp        # skip whisper.cpp + ggml model (~17 GB)
transcribe setup --no-bond005    # skip bond005 fine-tune (~14 GB)
transcribe setup --no-gigaam     # skip GigaAM (~16 GB)
transcribe setup --no-mlx        # skip MLX entirely (cpp + gigaam only)
```

Per-engine single-shot installs:

```sh
transcribe setup:mlx             # only the mlx engine + Russian fine-tune
transcribe setup:cpp             # only whisper.cpp + ggml-large-v3 + VAD
```

Models and the whisper.cpp build live under `~/Library/Caches/transcribe/`
by default, so a `bun update -g` doesn't wipe ~20 GB of downloads.

## Usage

```
transcribe <file.m4a> [options]

Options:
  --engine <name>    mlx | cpp | gigaam              (default: mlx)
  --model <name>     engine-specific alias or HuggingFace repo id
  --format <fmt>     txt | srt | vtt | json | all   (default: txt)
                     (gigaam v1: txt | json only)
  --output <file>    output file path                (default: <input-stem>.<ext>)
  --language <code>  ISO language code               (default: ru)
  --prompt <text>    initial prompt (mlx/cpp — vocabulary biasing)
  --threads <n>      decoder threads                (cpp only)
  --keep-wav         retain the intermediate 16kHz WAV (cpp only)
  -h, --help         show this help

  transcribe setup [--no-cpp|--no-mlx|--no-bond005|--no-gigaam]
  transcribe setup:mlx | setup:cpp
  transcribe --version
```

Vocabulary biasing example (helpful for tech / domain-specific acronyms):

```sh
transcribe memo.m4a --prompt "Обсуждаем MCP, API, latency, RAG, GPT-4."
```

## Environment variables

| Variable                       | Effect                                                                  |
| ------------------------------ | ----------------------------------------------------------------------- |
| `TRANSCRIBE_CACHE_DIR`         | Root for models + the whisper.cpp build (default `~/Library/Caches/transcribe/`). |
| `XDG_CACHE_HOME`               | If set, default cache becomes `$XDG_CACHE_HOME/transcribe`.             |
| `WHISPER_BIN`                  | Explicit override for the `whisper-cli` binary path (cpp engine).       |
| `WHISPER_MODEL_DIR`            | Explicit override for the ggml-`<name>`.bin lookup (cpp engine).        |
| `TRANSCRIBE_SKIP_POSTINSTALL`  | If truthy (`1`/`true`/`yes`), the postinstall banner is silent.         |
| `CI`                           | If truthy, postinstall is skipped (avoids polluting CI logs).           |

## Troubleshooting

**`Model file not found`** or **`model 'antony66-russian' resolves to … but that directory doesn't exist`**
— You haven't run setup yet. Run `transcribe setup` (or the narrower
`transcribe setup:mlx`).

**HF download stalls in CLOSE_WAIT during setup** — known issue with
HuggingFace's parallel Python downloader on big multi-file Russian
repos. Setup uses plain `curl` to avoid it. If you see this from
something else (e.g. `mlx_whisper` auto-downloading a model you didn't
pre-fetch), re-run setup which downloads via the reliable path.

**`TypeError: ModelDimensions.__init__() got an unexpected keyword argument '_name_or_path'`**
— You're trying to point `--model` at an HF-format Whisper repo
(antony66, bond005) without converting it first. Use the alias
(`--model antony66-russian`) which resolves to the locally-converted
MLX directory. Setup runs the conversion automatically.

**`Too long wav file`** when using the gigaam engine — the model's
built-in `transcribe()` rejects files longer than ~30 s. We work around
this by chunking the file (30 s windows, 2 s overlap). If you hit this,
you're probably calling GigaAM directly outside this CLI — use
`transcribe ... --engine gigaam` which handles chunking.

**`transformers` install error during gigaam setup** — we pin
`transformers>=4.40,<4.50` because 4.50 changed the meta-device init
path in a way that breaks GigaAM's `trust_remote_code` modeling. The pin
lives in `scripts/gigaam_transcribe.py` PEP 723 inline metadata.

**Transcription in the wrong language** — pass `--language <code>` (e.g.
`en`, `de`, `ja`); the default is `ru`. When using `--engine gigaam`,
non-Russian language produces gibberish (the model is Russian-only); the
CLI warns about this.

## How it works

- **mlx** engine spawns `mlx_whisper` (from a `uv tool install` venv)
  with anti-hallucination tuning (`--temperature 0`,
  `--condition-on-previous-text False`, `--no-speech-threshold 0.5`).
- **cpp** engine spawns `whisper-cli` built from
  [whisper.cpp](https://github.com/ggml-org/whisper.cpp) source with
  Metal, plus the Silero VAD model and tuned anti-hallucination flags
  (`-mc 0 -bs 5 -et 2.6 -fa --suppress-nst`).
- **gigaam** engine spawns `scripts/gigaam_transcribe.py` via `uv run`
  (PEP 723 inline deps). The script chunks audio into 30 s windows with
  2 s overlap and stitches the output (avoids the model's hardcoded
  30 s limit without needing pyannote / `HF_TOKEN`).

For Russian inputs the default `mlx + antony66` produced the most
readable output in our benchmarks. `gigaam` is opt-in because on real
recordings it didn't measurably beat antony66 (similar acronym
preservation; single-paragraph output is less readable). See
[`specs/gigaam/spec.md`](./specs/gigaam/spec.md) for the full comparison.

## Credits

This project is a thin wrapper around brilliant upstream work:

- [whisper.cpp](https://github.com/ggml-org/whisper.cpp) — Georgi Gerganov
- [Whisper](https://github.com/openai/whisper) — OpenAI
- [mlx-whisper](https://github.com/ml-explore/mlx-examples/tree/main/whisper) — Apple ML Explore
- [GigaAM-v3](https://huggingface.co/ai-sage/GigaAM-v3) — Sber AI
- [`antony66/whisper-large-v3-russian`](https://huggingface.co/antony66/whisper-large-v3-russian) — antony66 (HF)
- [`bond005/whisper-podlodka-turbo`](https://huggingface.co/bond005/whisper-podlodka-turbo) — bond005 (HF)
- [Silero VAD](https://github.com/snakers4/silero-vad) — Silero Team
- [Bun](https://bun.sh), [uv](https://github.com/astral-sh/uv)

## License

MIT — see [LICENSE](./LICENSE).
