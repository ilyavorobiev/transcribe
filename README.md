# transcriber

Offline transcription of iPhone voice memos (`.m4a`) in Russian, powered by
[whisper.cpp](https://github.com/ggml-org/whisper.cpp) and accelerated on Apple
Silicon via Metal.

## Install

Prerequisites: macOS on Apple Silicon, [Homebrew](https://brew.sh), and
[Bun](https://bun.sh).

```sh
bun install
bun run setup
```

`setup` installs `git`, `cmake`, and `ffmpeg` if missing, clones and builds
whisper.cpp with Metal into `vendor/whisper.cpp/`, and downloads the
`large-v3` model (~3.1 GB) into `models/`.

Optional — add a `transcribe` shim to your PATH:

```sh
bun run install:bin           # writes ~/.local/bin/transcribe
```

## Use

```sh
bun run transcribe path/to/memo.m4a
# → path/to/memo.txt
```

All flags:

```
transcribe <file.m4a> [options]
  --model <name>     tiny | base | small | medium | large-v3 | large-v3-turbo
                     (default: large-v3)
  --format <fmt>     txt | srt | vtt | json | all   (default: txt)
  --output <file>    output file path                (default: <input-stem>.<ext> next to input)
  --language <code>  ISO language code               (default: ru)
  --keep-wav         retain the intermediate 16kHz WAV
  --threads <n>      whisper threads                 (default: min(cpus, 8))
  -h, --help         show this help
```

## Choosing a model

| Model            | Size    | Speed (M-series) | Notes                                              |
| ---------------- | ------- | ---------------- | -------------------------------------------------- |
| `tiny`           | ~75 MB  | very fast        | testing only — quality is poor                     |
| `small`          | ~466 MB | fast             | usable for short, clean speech                     |
| `medium`         | ~1.5 GB | moderate         | good cost/quality for casual notes                 |
| `large-v3`       | ~3.1 GB | slower           | **default** — best Russian accuracy                |
| `large-v3-turbo` | ~1.6 GB | ~5–8× faster     | nearly large-v3 quality, distilled decoder         |

Download additional models via:

```sh
bash vendor/whisper.cpp/models/download-ggml-model.sh <name> models/
```

## Develop

```sh
bun run test         # unit tests (no binary or model needed)
bun run typecheck    # strict TypeScript check
```

Tests are pure (argv construction, arg parsing, env overrides) — they don't
need `ffmpeg` or `whisper-cli` to be installed.

## Layout

```
src/
  cli.ts        CLI entry, arg parsing, orchestration
  audio.ts      ffmpeg preprocessor (m4a → 16kHz mono WAV)
  whisper.ts    whisper-cli wrapper + argv construction
  paths.ts      resolve vendored binary and model files
scripts/
  setup.sh      one-time install of deps + whisper.cpp + model
  install.sh    write ~/.local/bin/transcribe shim
vendor/         whisper.cpp source + build (gitignored)
models/         downloaded ggml model files (gitignored)
spec.md         design spec
```

## Troubleshooting

**`ffmpeg failed`** — install it: `brew install ffmpeg`. Verify with `ffmpeg -version`.

**`whisper-cli not found`** — run `bun run setup`. To use a system-wide
binary instead, set `WHISPER_BIN=/path/to/whisper-cli`.

**`Model file not found`** — download with the command in the error message,
or set `WHISPER_MODEL_DIR=/path/to/models` to point at an existing folder.

**Slow transcription** — try `--model large-v3-turbo` (5–8× faster on Apple
Silicon with similar Russian accuracy).

**Transcription is in the wrong language** — pass `--language <code>` (e.g.
`en`, `de`); the default is `ru`.

## License

Personal use.
