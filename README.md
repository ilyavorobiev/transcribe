# Transcribe — offline voice-memo transcription for macOS

[![npm](https://img.shields.io/npm/v/@ilyavorobiev/transcribe.svg)](https://npmjs.com/package/@ilyavorobiev/transcribe)
[![license](https://img.shields.io/github/license/ilyavorobiev/transcribe.svg)](./LICENSE)
[![CI](https://github.com/ilyavorobiev/transcribe/actions/workflows/ci.yml/badge.svg)](https://github.com/ilyavorobiev/transcribe/actions/workflows/ci.yml)
[![platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](#supported-platforms)

A macOS command-line tool that transcribes audio files — iPhone `.m4a`
voice memos by default — entirely on your machine. **No cloud, no API
keys, no network calls during transcription.** Three transcription
engines are unified behind a single CLI: **mlx-whisper** (default;
Apple Silicon native), **whisper.cpp** (offline-strict, no Python
runtime), and Sber **GigaAM-v3** (Russian-only opt-in). Optimized for
Russian out of the box; multilingual support via Whisper for ~99
languages.

Built for a specific personal workflow (long Russian voice memos
recorded on iPhone, often with English tech vocabulary mixed in), then
published as OSS in case it's useful to anyone else. Bug reports and
PRs are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md).

```sh
bun add -g @ilyavorobiev/transcribe
transcribe setup            # one-time, ~6 GB, ~8 min (mlx + antony66)
transcribe memo.m4a         # produces memo.txt next to memo.m4a
```

The minimal default install gets you Russian transcription with the
mlx engine. Other engines (`whisper.cpp` for offline-strict, `gigaam`
for an opt-in 2nd-opinion) are one flag away — see [Disk
footprint](#disk-footprint) below. If you run `transcribe <file>
--engine gigaam` without gigaam installed, the CLI prompts you to
install it in place.

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

Default install is the smallest useful set: **mlx engine + antony66
Russian fine-tune. ~6 GB, ~8 min.** Add opt-in components with
`--with`:

```sh
transcribe setup --with cpp                  # add whisper.cpp (~+4 GB)
transcribe setup --with gigaam               # add GigaAM (~+4 GB)
transcribe setup --with bond005              # add bond005 ru+en fine-tune (~+4 GB)
transcribe setup --with cpp --with gigaam    # combine
transcribe setup --full                      # everything (~20 GB)
```

Per-engine single-shot installs (for narrow setups):

```sh
transcribe setup:mlx             # only the mlx engine + Russian fine-tune
transcribe setup:cpp             # only whisper.cpp + ggml-large-v3 + VAD
```

When you run a command whose engine isn't installed, the CLI prompts
you to install it in place (TTY only — scripts get a fail-fast error
with the install command). Disable the prompt with `--no-auto-install`
or `TRANSCRIBE_AUTO_INSTALL=0`.

To wipe and re-install something (corrupted download, transformers
version drift, etc.):

```sh
transcribe reinstall                       # the minimal default set
transcribe reinstall antony66-russian      # one model
transcribe reinstall gigaam                # one engine
transcribe reinstall --all                 # everything currently installed
```

Models and the whisper.cpp build live under `~/Library/Caches/transcribe/`
by default (override with `TRANSCRIBE_CACHE_DIR`), so a `bun update -g`
doesn't wipe gigabytes of downloads. Conversion intermediates (the `-hf`
source dirs and whisper.cpp CMake objects) are auto-cleaned after a
strict sanity check — opt out with `TRANSCRIBE_KEEP_HF=1` /
`TRANSCRIBE_KEEP_BUILD=1` if you're debugging.

> The legacy `--no-cpp`, `--no-mlx`, `--no-gigaam`, `--no-bond005`
> flags are still honored (with a deprecation warning) and will be
> removed in `1.0.0`. Use `--with` and `--full` instead.

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
  --auto-install     prompt to install missing engine if not ready (default on TTY)
  --no-auto-install  fail-fast on missing engine (default in scripts / non-TTY)
  -h, --help         show this help

  transcribe setup [--with cpp|--with gigaam|--with bond005|--full]
                                                   default: minimal (mlx + antony66)
  transcribe setup --clean                         remove intermediary files only
  transcribe setup --force                         re-download even if present
  transcribe setup:mlx | setup:cpp                 single-engine installs
  transcribe reinstall [<name>|--all]              wipe + reinstall
  transcribe --version
```

Vocabulary biasing example (helpful for tech / domain-specific acronyms):

```sh
transcribe memo.m4a --prompt "Обсуждаем MCP, API, latency, RAG, GPT-4."
```

## Environment variables

| Variable                       | Effect                                                                  |
| ------------------------------ | ----------------------------------------------------------------------- |
| `TRANSCRIBE_CACHE_DIR`         | Root for models + the whisper.cpp build (default `~/Library/Caches/transcribe/`). Hard override: disables the local-dev fallback to `<repo>/{models,vendor}`. |
| `XDG_CACHE_HOME`               | If set, default cache becomes `$XDG_CACHE_HOME/transcribe`.             |
| `WHISPER_BIN`                  | Explicit override for the `whisper-cli` binary path (cpp engine).       |
| `WHISPER_MODEL_DIR`            | Explicit override for the ggml-`<name>`.bin lookup (cpp engine).        |
| `TRANSCRIBE_AUTO_INSTALL`      | `0`/`false`/`no` → never prompt to install (fail-fast). `1`/`true`/`yes` → prompt iff TTY. Default = prompt iff TTY. |
| `TRANSCRIBE_KEEP_HF`           | If truthy, keep the `-hf` source directory after MLX conversion (saves ~3 GB normally; useful when debugging a bad conversion). |
| `TRANSCRIBE_KEEP_BUILD`        | If truthy, keep whisper.cpp `build/CMakeFiles/` after a successful build (saves ~200 MB normally; useful when iterating on whisper.cpp). |
| `TRANSCRIBE_SKIP_POSTINSTALL`  | If truthy (`1`/`true`/`yes`), the postinstall banner is silent.         |
| `CI`                           | If truthy, postinstall is skipped (avoids polluting CI logs).           |

## Troubleshooting

**`Model file not found`** or **`model 'antony66-russian' resolves to … but that directory doesn't exist`**
— You haven't run setup yet. Run `transcribe setup` (or the narrower
`transcribe setup:mlx`). If you previously installed and the dir got
clobbered, `transcribe reinstall antony66-russian` re-downloads it.

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
