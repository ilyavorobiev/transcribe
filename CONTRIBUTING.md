# Contributing

Thanks for your interest in `@ilyavorobiev/transcribe`. This is a personal
OSS project, so the contribution surface is small. Bug reports and PRs are
welcome; please open an issue first for anything bigger than a typo so we
can avoid wasted work.

## Dev setup

macOS Apple Silicon, [Homebrew](https://brew.sh), and [Bun](https://bun.sh)
1.1+ are required.

```sh
git clone https://github.com/ilyavorobiev/transcribe.git
cd transcribe
bun install               # installs @types/bun + typescript only
bun run test              # 55+ pure tests; no external binaries needed
bun run typecheck         # strict TS
```

The full engine + model setup (~20 GB, ~15–30 min) is **only** needed if
you want to actually transcribe audio while developing:

```sh
bun run setup             # all three engines + every default model
# narrower options:
bash scripts/setup-all.sh --no-gigaam   # skip GigaAM (~16 GB)
bash scripts/setup-all.sh --no-cpp      # skip whisper.cpp (~17 GB)
bash scripts/setup-all.sh --no-bond005  # skip bond005 fine-tune (~14 GB)
bun run setup:mlx                       # only the mlx engine
bun run setup:cpp                       # only the cpp engine
```

`bun run setup` writes models and the whisper.cpp build into
`~/Library/Caches/transcribe/` by default. Override with
`TRANSCRIBE_CACHE_DIR=/some/path bun run setup`. When running from a
checked-out source repo, the legacy `<repo>/{models,vendor}` paths are
honored too (backwards-compatible for the original author's setup).

## Tests

- `bun run test` — fast (~20 ms), no `ffmpeg`/`mlx_whisper`/`whisper-cli`
  required. All argv builders and option resolvers are pure.
- New flags must be threaded through their pure argv builder
  (`mlxArgv`, `whisperArgv`, `gigaamArgv`) so the test suite can exercise
  them without spawning the real engine.
- Engine-specific tests live in `src/engines/*.test.ts`. The CLI top-level
  tests live in `src/cli.test.ts`. Keep test files colocated with code.
- `bun test` (no script) picks up the broken Node-addon test under
  `vendor/whisper.cpp/`. Always run `bun run test` (the npm script) which
  scopes to `src`.

## Engine version pins — policy

The project depends on three independently-versioned upstream stacks:

- `mlx-whisper` (Apple ML Explore — pip)
- `whisper.cpp` (Georgi Gerganov — built from source)
- `transformers` + `torch` + (optionally) `pyannote.audio` (HuggingFace
  / PyTorch — pip, isolated via uv)

Each engine pins what it has been verified against. A version bump that
loosens any pin is a **real CHANGELOG entry**, not a silent dependency
sweep. Current pins of note:

- `transformers>=4.40,<4.50` for gigaam — see `specs/gigaam/spec.md`
  §11 field-finding #3. transformers 4.50 changed the meta-device init
  path in a way that breaks GigaAM's `trust_remote_code` modeling. Will
  be loosened when GigaAM's upstream code adds compatibility.
- `mlx-whisper` itself currently floats. The conversion script
  (`scripts/convert-hf-to-mlx.sh`) renames `model.safetensors` →
  `weights.safetensors` because the upstream `convert.py` writes the
  former while `mlx-whisper 0.4.3` reads the latter. If a future
  mlx-whisper changes this, drop the rename.
- `whisper.cpp` is built from `master`. There's no pin, on the theory
  that source-from-upstream is the contract.

## Release procedure

Releases are tag-driven; `.github/workflows/release.yml` publishes to npm
on every `v*.*.*` tag push.

1. Bump `version` in `package.json` (manual; semver).
2. Update `CHANGELOG.md`: move `Unreleased` entries under the new
   version heading with a date. Keep version-pin loosens as their own
   bullet.
3. `bun run test && bun run typecheck` — both must pass.
4. `bun publish --dry-run --access public` — verify the file list
   matches the `files` allowlist in `package.json`. There must be
   **no** `vendor/`, `models/`, `*.test.ts`, `*.m4a`, `*.wav`, or
   `specs/` entries.
5. Commit (`chore(release): v<version>`).
6. `git tag v<version> && git push --tags`.
7. Watch the release workflow on GitHub Actions. On success, the
   package appears at <https://npmjs.com/package/@ilyavorobiev/transcribe>.

A `bun pack` followed by `bun add ./tarball` in a scratch directory is a
cheap pre-publish sanity check; the `TRANSCRIBE_SKIP_POSTINSTALL=1` env
var makes it instantaneous.

## Reporting bugs

Please include:

- macOS version + chip (Apple Silicon / Intel)
- `bun --version`
- Engine you were using (`mlx` / `cpp` / `gigaam`) and the model alias
- Output of `transcribe --version`
- Whether the same file works on a different engine
- The last ~20 lines of stderr from the failed run

Voice memos containing personal content shouldn't be attached; a tiny
sample that reproduces the bug is more useful (the canonical issue-
reproducing approach is to clip a 10–30 second segment with `ffmpeg`).
