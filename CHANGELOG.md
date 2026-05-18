# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-05-17

### Changed

- **Default `transcribe setup` is now the minimal install: `mlx + antony66`
  Russian fine-tune only (~6 GB, ~8 min).** Previously installed everything
  (~20 GB, ~15–30 min). To get the old behavior:
  `transcribe setup --full`. This is the breaking change in 0.2.0.

### Added

- `transcribe setup --with <cpp|gigaam|bond005|mlx|antony66>` (repeatable):
  opt-in components on top of the minimal default.
- `transcribe setup --full`: install everything (~20 GB).
- `transcribe setup --clean`: run only the cleanup pass (no installs).
- `transcribe setup --force`: re-download / re-build even if artifacts
  look present.
- `transcribe setup --wipe`: `rm -rf` the install set before installing.
- `transcribe reinstall [<name>|--all]`: first-class verb that wipes
  and re-installs. `<name>` can be an engine (`mlx`, `cpp`, `gigaam`)
  or a model alias (`antony66-russian`, `bond005-turbo`, `gigaam-v3`).
- **In-place install prompt**: when you run a command whose engine
  isn't installed, the CLI prompts you to install in place (TTY only;
  non-TTY contexts fail-fast with a clear command to copy-paste).
- `--auto-install` / `--no-auto-install` CLI flags and
  `TRANSCRIBE_AUTO_INSTALL` env var to control the prompt behavior.
- **Auto-cleanup of intermediary files** after successful operations:
  - MLX conversion: the `-hf` source directory (~3 GB per converted
    model) is removed after a strict sanity check (weights ≥ 50 MB,
    `config.json` parseable as a Whisper config, no stray
    `pytorch_model.bin` in the MLX dir).
  - whisper.cpp build: `CMakeFiles/` + `*.o` (~200 MB) are removed
    after the binary is verified to exist.
  - Opt-out via `TRANSCRIBE_KEEP_HF=1` / `TRANSCRIBE_KEEP_BUILD=1`.
- `Engine.checkReady(args)` primitive on the Engine interface — pure
  readiness check (file/dir existence + `PATH` lookups, no spawning).
  Used by the CLI to gate transcription and offer the install prompt.

### Deprecated

- `--no-mlx` / `--no-cpp` / `--no-gigaam` / `--no-bond005` flags. Still
  honored (each implies `--full` minus the named component) and prints
  a stderr deprecation warning. **Removal planned for 1.0.0.** Use
  `--with` and `--full` instead.

### Fixed

- `TRANSCRIBE_CACHE_DIR` is now a strict hard override: the legacy
  local-dev fallback to `<repo>/{models,vendor}` is suppressed when
  the env var is set. Previously the fallback would silently kick in
  and return paths under the source-checkout dir even when the user
  pointed the cache elsewhere.

## [0.1.0] — 2026-05-17

### Added

- Initial public release.
- CLI: `transcribe <file>` and `transcribe setup [--no-cpp|--no-mlx|--no-bond005|--no-gigaam]`.
- macOS support (Apple Silicon native via Metal; Intel works via the cpp engine).
- Three transcription engines, unified behind a single CLI:
  - **mlx** (default): `mlx-whisper` + `antony66/whisper-large-v3-russian`
    for `--language ru`; stock multilingual `large-v3` for everything else
    (~99 languages).
  - **cpp**: `whisper.cpp` built from source with Metal, tuned
    anti-hallucination flags, and Silero VAD. Offline-strict, no Python
    runtime.
  - **gigaam** (opt-in): Sber `GigaAM-v3` RNN-T for Russian-only,
    native Latin-character output for tech acronyms.
- Russian-specific quality work: `antony66/whisper-large-v3-russian` and
  `bond005/whisper-podlodka-turbo` fine-tunes are downloaded and converted
  to MLX format on first setup.
- Domain-vocabulary biasing via `--prompt` (mlx and cpp engines).
- `transcribe setup` orchestrator installs Homebrew deps, all three engines,
  and ~20 GB of models in one shot. Idempotent; safe to re-run. Engine-skip
  flags (`--no-cpp`, `--no-mlx`, `--no-bond005`, `--no-gigaam`) let users
  reduce the footprint.
- Cache directory: models and the whisper.cpp build live under
  `~/Library/Caches/transcribe/` by default (override via
  `TRANSCRIBE_CACHE_DIR` or `XDG_CACHE_HOME`), so `bun update -g` doesn't
  wipe them.
- Postinstall is intentionally skip-only: it prints the next step
  (`transcribe setup`) and never builds, downloads, or fails the install.

### Engine version pins (notable)

- `transformers>=4.40,<4.50` for the gigaam engine — pinned because
  GigaAM's `trust_remote_code` modeling currently breaks under
  transformers' meta-device init in 4.50+. Loosening this is a real
  CHANGELOG entry, not a silent bump.

[Unreleased]: https://github.com/ilyavorobiev/transcribe/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ilyavorobiev/transcribe/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ilyavorobiev/transcribe/releases/tag/v0.1.0
