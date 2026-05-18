# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/ilyavorobiev/transcribe/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ilyavorobiev/transcribe/releases/tag/v0.1.0
