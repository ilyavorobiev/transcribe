# Publishing `transcribe` to npm + GitHub — Technical Specification

## 1. Meta Information

- **Branch:** `main`
- **Epic:** v0.1.0 — public OSS release on npm + GitHub
- **PRD:** N/A (personal OSS project)
- **Status:** **Shipped 2026-05-17** as `@ilyavorobiev/transcribe@0.1.0`.
  See §12 for field findings hit during the publish work.

## 2. Context

The local CLI works on the author's machine. This spec covers what's needed
to turn it into a **publishable, installable CLI** that any macOS user can
`bun add -g` and use.

Since this spec was originally written, the architecture has grown
substantially:

- **Three engines** (mlx default, cpp opt-in, gigaam opt-in) — see
  `specs/mlx-russian/spec.md` and `specs/gigaam/spec.md`.
- **`bun run setup`** is a single orchestrator that installs all three
  engines and ~20 GB of models in one shot. Idempotent.
- **55 unit tests** across 6 files. Pure argv-construction; no external
  binaries needed to run them.
- **Engine interface** at `src/engines/types.ts`; each engine is a thin
  wrapper around an external binary (`whisper-cli`, `mlx_whisper`, GigaAM
  Python script).

The publish goals haven't changed:

- **Distribution:** npm (scoped, `@ilyavorobiev/transcribe`) and a public
  GitHub repository under `github.com/ilyavorobiev/transcribe`.
- **Surface:** CLI binary only (no exported library API). Users run
  `transcribe <file>` and `transcribe setup`.
- **License:** MIT.
- **Platforms (v1):** macOS only (Apple Silicon native; cpp engine works on
  Intel too as a side benefit). Linux/Windows deferred.
- **Provisioning:** users see and consent to the expensive setup step;
  npm install itself stays fast and side-effect-light.

The exact npm package name and GitHub repo slug are assumed available; if
`@ilyavorobiev` scope or `transcribe` repo name is taken, the closest variant
is selected at publish time (no design changes).

## 3. Key Technical Drivers

- **Driver 1 — One-line install:** `bun add -g @ilyavorobiev/transcribe` must
  succeed in seconds on any Mac, with no surprises (no multi-GB downloads
  during install, no install-time failures from missing system deps).
- **Driver 2 — Predictable two-step UX:** install → `transcribe setup` (once)
  → `transcribe file.m4a`. The user sees and consents to the expensive step.
- **Driver 3 — Don't ship binaries we didn't build deterministically:** for
  v1 we build whisper.cpp from upstream source on the user's machine. No
  prebuilt artifacts hosted by us; no opaque blobs.
- **Driver 4 — Survive reinstalls:** the built binary and downloaded model
  live in a user cache directory, not inside `node_modules`, so reinstalling
  the package doesn't trigger a re-build/re-download.
- **Driver 5 — OSS hygiene:** LICENSE, README with badges, CHANGELOG,
  CI, semver — the minimums a stranger expects when evaluating the package.

## 4. Current State

The codebase has grown well beyond what this spec originally described.
Snapshot as of the latest commit (`8def437`):

```
src/
  cli.ts                # arg parsing, engine dispatch, resolveEngine/Model
  audio.ts              # ffmpeg preprocessor (used by cpp + gigaam engines)
  paths.ts              # WHISPER_BIN / WHISPER_MODEL_DIR / PROJECT_ROOT
  engines/
    types.ts            # Format, EngineName ("mlx"|"cpp"|"gigaam"), Engine
    cpp.ts              # whisper.cpp wrapper + whisperArgv (pure)
    mlx.ts              # mlx-whisper wrapper + mlxArgv + model aliases
    gigaam.ts           # GigaAM wrapper (spawns gigaam_transcribe.py via uv)
    *.test.ts           # 4 colocated engine test files
  *.test.ts             # cli / audio / paths tests
scripts/
  setup-all.sh          # default `bun run setup` orchestrator
  setup-mlx.sh          # MLX engine only
  setup-cpp.sh          # whisper.cpp engine only
  convert-hf-to-mlx.sh  # HF Whisper → MLX format
  download-hf-model.sh  # generic HF repo downloader via curl
  gigaam_transcribe.py  # PEP 723 inline-deps Python wrapper for GigaAM
  install.sh            # symlink transcribe shim into PATH
specs/
  cli/spec.md           # implemented — local CLI v0.1
  publish/spec.md       # this spec
  mlx-russian/spec.md   # implemented — MLX engine + Russian fine-tune
  gigaam/spec.md        # implemented — GigaAM engine (opt-in)
guidelines/             # workflow.md + docs/{spec,prd}.md + roles/
AGENTS.md + CLAUDE.md   # CLAUDE.md is `@AGENTS.md` (Claude Code @-import)
package.json            # private: true; bin.transcribe = ./src/cli.ts
.gitignore              # ignores vendor/, models/, .claude/, PRD*.txt
tsconfig.json           # strict, noUncheckedIndexedAccess
```

State of moving parts:

- **Git initialized**, 3 commits on `main` (`23a1242`, `079fa5e`, `8def437`).
  No remote, no pushes.
- **`package.json`** still has `private: true`. No `name`/`license`/`author`/
  `repository`/`bugs`/`homepage`/`keywords`/`files`/`os`/`engines`/`scripts.postinstall` yet.
- **No LICENSE, CHANGELOG, README badges, CI, `.github/`.**
- **55 tests pass**, typecheck clean.
- **End-to-end works on the author's machine**: `bun run setup` (~20 GB,
  ~15–30 min) → `bun run transcribe foo.m4a` produces a Russian transcript
  using mlx + antony66 by default.
- **Not yet validated on a fresh machine** — that's `T29` in the plan.

## 5. Considered Options

### 5.1. Option 1: Postinstall builds, `setup` downloads model (CHOSEN)

- **Description:** `bun install` triggers a postinstall hook that
  best-effort builds whisper.cpp from source into the user cache dir. The
  separate `transcribe setup` subcommand re-runs the build (idempotently)
  and additionally downloads a model. Postinstall **never fails the install**
  — on missing deps or build error it prints clear next steps.
- **Pros:** First-run experience is "more done"; users with `cmake`/`ffmpeg`
  already present get a binary out of the box. Setup command is still the
  canonical entry point and works regardless of postinstall outcome.
- **Cons:** Postinstall scripts have a poor reputation (slow installs in CI,
  supply-chain anxiety). Mitigated by env-var opt-out, no network calls, no
  model downloads in postinstall, and graceful failure.

### 5.2. Option 2: No postinstall — `setup` does everything

- **Description:** Install is a pure file copy. User must run
  `transcribe setup` before first use.
- **Pros:** Honest, no install-time work, friendly to CI users who pulled
  the package transitively.
- **Cons:** Extra step the user might forget; first `transcribe file.m4a`
  fails with a "run setup first" error.

### 5.3. Option 3: Prebuilt binaries from GitHub Releases

- **Description:** A CI workflow builds `whisper-cli` per arch and attaches
  the binaries to a GitHub Release. Postinstall downloads the right tarball.
- **Pros:** Fastest install; no `cmake`/`ffmpeg` needed for build.
- **Cons:** Maintenance burden (release per whisper.cpp upgrade × per arch);
  hosting cost for binaries; signature/notarization concerns on macOS;
  introduces a trust step (binary not built on user machine).

### 5.4. Comparison

| Criteria / Driver               | Postinstall + setup (CHOSEN) | Setup only | Prebuilt binaries |
| ------------------------------- | ---------------------------- | ---------- | ----------------- |
| Install is fast & predictable   | ~ (postinstall runs)         | +          | ~                 |
| First-use UX                    | +                            | -          | +                 |
| No multi-GB at install time     | +                            | +          | +                 |
| Survives reinstalls (cache dir) | +                            | +          | +                 |
| Maintenance burden              | +                            | +          | -                 |
| Trust / reproducibility         | +                            | +          | -                 |

## 6. Proposed Solution

### 6.1. Publishable repo layout

Files currently exist; the publish epic adds the bolded ones. Anything
under `vendor/`, `models/`, `.claude/`, `PRD*.txt` is gitignored and never
published.

```
transcribe/
├── src/                          # ALREADY EXISTS
│   ├── cli.ts                    #   dispatch + arg parsing
│   ├── audio.ts
│   ├── paths.ts                  #   needs cache-dir extension (T10)
│   ├── engines/
│   │   ├── types.ts
│   │   ├── cpp.ts | mlx.ts | gigaam.ts
│   │   └── *.test.ts
│   └── *.test.ts
├── scripts/                      # ALREADY EXISTS
│   ├── setup-all.sh              #   orchestrator — called by `transcribe setup`
│   ├── setup-mlx.sh | setup-cpp.sh
│   ├── convert-hf-to-mlx.sh
│   ├── download-hf-model.sh
│   ├── gigaam_transcribe.py
│   ├── install.sh
│   └── **postinstall.ts**        #   T11 — NEW: best-effort, never fails install
├── .github/                      # **T6, T18, T19 — NEW**
│   ├── workflows/{ci,release}.yml
│   └── ISSUE_TEMPLATE/{bug,feature}.md
├── specs/                        # ALREADY EXISTS
├── guidelines/                   # ALREADY EXISTS
├── AGENTS.md + CLAUDE.md         # ALREADY EXISTS
├── **LICENSE**                   # T1 — NEW (MIT)
├── **README.md**                 # T17 — NEEDS REWRITE (currently a stub)
├── **CHANGELOG.md**              # T2 — NEW
├── **CONTRIBUTING.md**           # T3 — NEW
├── package.json                  #   T4 — needs publish-fields rewrite
├── tsconfig.json
├── .gitignore                    # ALREADY EXISTS
└── **.npmignore**                # T5 — NEW (belt-and-suspenders)
```

### 6.2. `package.json` publish-ready

Current `package.json` is for local dev (`private: true`, minimal fields).
The publish version needs:

```jsonc
{
  "name": "@ilyavorobiev/transcribe",
  "version": "0.1.0",
  "description": "Offline transcription of iPhone voice memos on macOS — 3 engines (mlx/cpp/gigaam) optimized for Russian",
  "license": "MIT",
  "author": "Ilya Vorobiev",
  "homepage": "https://github.com/ilyavorobiev/transcribe",
  "repository": { "type": "git", "url": "git+https://github.com/ilyavorobiev/transcribe.git" },
  "bugs": { "url": "https://github.com/ilyavorobiev/transcribe/issues" },
  "keywords": [
    "whisper", "whisper.cpp", "mlx-whisper", "gigaam",
    "transcribe", "speech-to-text", "stt", "asr",
    "russian", "m4a", "voice-memo",
    "macos", "apple-silicon", "metal", "cli", "offline"
  ],
  "type": "module",
  "engines": { "bun": ">=1.1.0" },
  "os": ["darwin"],
  "bin": { "transcribe": "./src/cli.ts" },
  "files": [
    "src",
    "scripts/setup-all.sh",
    "scripts/setup-mlx.sh",
    "scripts/setup-cpp.sh",
    "scripts/convert-hf-to-mlx.sh",
    "scripts/download-hf-model.sh",
    "scripts/gigaam_transcribe.py",
    "scripts/postinstall.ts",
    "README.md", "LICENSE", "CHANGELOG.md"
  ],
  "scripts": {
    "postinstall": "bun run scripts/postinstall.ts || true",
    "test": "bun test src",
    "typecheck": "bunx tsc --noEmit",
    "transcribe": "bun run src/cli.ts",
    "setup": "bash scripts/setup-all.sh"
  }
}
```

Notes:

- `private: true` removed.
- `os: ["darwin"]` — npm refuses to install on Linux/Windows with a clear
  error.
- `bin.transcribe` runs the TS file via Bun's `#!/usr/bin/env bun` shebang
  (already in `src/cli.ts`).
- `files` allowlist must include every script `transcribe setup` will call
  at runtime. No `vendor/`, no `models/`, no tests, no specs/guidelines
  (those are dev-only).
- `postinstall` wrapped with `|| true` so install never fails.
- `scripts.test` scoped to `src` (avoids the broken whisper.cpp Node-addon
  test that lives in `vendor/`).

### 6.3. Subcommand routing (NEW — not yet implemented)

For the published binary to be usable globally (`transcribe foo.m4a` from
any folder; `transcribe setup` to install models), we need `transcribe`
to dispatch a `setup` subcommand. Today, setup runs as `bun run setup`
(works only inside the source repo).

Target shape:

```
transcribe <file.m4a> [options]      # transcribe (current default behavior)
transcribe setup [--no-cpp|--no-mlx|--no-gigaam|--no-bond005]   # one-time install
transcribe setup:mlx | setup:cpp     # single-engine installs
transcribe --version                 # prints package version
transcribe --help                    # combined help (transcribe + setup)
```

Implementation: in `src/cli.ts`, before the existing arg parser, check if
the first positional matches a known subcommand (`setup`, `setup:mlx`,
`setup:cpp`). If yes, exec the corresponding `scripts/setup-*.sh` with the
remaining args. Otherwise, fall through to the existing transcribe flow.

Tracked as task **T8** in §8.5.

### 6.4. `transcribe setup` implementation

Already exists as `scripts/setup-all.sh` (Bash). Documented at length in
`specs/mlx-russian/spec.md` and `specs/gigaam/spec.md` Field findings. The
publish work is **wiring it as a subcommand** (T8) and **changing where
artifacts land** (T10, cache directory) — not rewriting setup.

The cache-dir change (T10) is necessary: when installed globally as
`@ilyavorobiev/transcribe`, the package lives somewhere like
`~/.bun/install/global/node_modules/@ilyavorobiev/transcribe/`. Models in
`<that>/models/` would be wiped on `bun update -g`. We need them under a
user cache dir instead. See §6.6.

### 6.5. `scripts/postinstall.ts`

Runs during `bun install`. Must be **fast** and **safe**. With ~20 GB of
real install work, we are MORE conservative than the original spec assumed:

- Skip if any of: `CI=true`, `TRANSCRIBE_SKIP_POSTINSTALL=1`,
  `process.platform !== "darwin"`, `npm_config_production` truthy.
- Print one banner with the next step: `transcribe setup`.
- **No build, no download, no Python install.** Doing any of those during
  npm install would be hostile (multi-minute hangs, multi-GB downloads).
  Setup is an explicit user step.
- Always exit 0.

This is a stricter version of what the original spec proposed (which had
postinstall attempting a whisper.cpp build). Real-world test: `bun add -g`
should complete in seconds.

### 6.6. Cache directory (`src/paths.ts` extension — T10)

**The single most important unimplemented item.** Without it, models live
inside the package directory and get wiped on every `bun update -g`.

Resolution order:

1. `WHISPER_BIN` env var — single binary override (already supported).
2. `TRANSCRIBE_CACHE_DIR` env var — root for everything.
3. `$XDG_CACHE_HOME/transcribe` if set.
4. `~/Library/Caches/transcribe` on macOS (default).
5. Legacy `{PROJECT_ROOT}/{vendor,models}` — for local dev, when running
   from the source repo (detected by presence of `.git` or `specs/`).

Each engine's path resolver (`src/engines/{cpp,mlx,gigaam}.ts`) consults
this in priority order. Aliases like `antony66-russian` resolve to
`<cache>/models/antony66-russian-mlx/`. `transcribe setup` writes there.

Migration for the author: copy existing `models/`, `vendor/` from the
repo to `~/Library/Caches/transcribe/` once. Or symlink. Documented in
CONTRIBUTING.md.

### 6.7. CI (`.github/workflows/ci.yml`)

```yaml
on: [push, pull_request]
jobs:
  test:
    runs-on: macos-latest   # Apple Silicon
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
        env: { TRANSCRIBE_SKIP_POSTINSTALL: "1" }
      - run: bun run typecheck
      - run: bun run test
```

Tests are pure — no whisper.cpp build, no MLX install, no model download
in CI. Postinstall skipped via the env var the script itself respects.
Locked-in Bun version via `setup-bun`.

### 6.8. Release (`.github/workflows/release.yml`)

```yaml
on:
  push:
    tags: ['v*.*.*']
jobs:
  publish:
    runs-on: macos-latest
    permissions: { id-token: write, contents: read }
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
        env: { TRANSCRIBE_SKIP_POSTINSTALL: "1" }
      - run: bun run typecheck && bun run test
      - run: bun publish --access public
        env: { NPM_CONFIG_TOKEN: ${{ secrets.NPM_TOKEN }} }
```

Release flow: bump `version` in `package.json`, update `CHANGELOG.md`, commit,
`git tag v0.1.0 && git push --tags`. CI does the publish.

### 6.9. README.md content (replace existing — currently a stub)

The published README needs (T17):

- **Badges**: npm version, MIT license, CI status, "macOS only" platform.
- **30-second quickstart**:
  ```sh
  bun add -g @ilyavorobiev/transcribe
  transcribe setup          # ~15-30 min, ~20 GB; one-time
  transcribe memo.m4a       # produces memo.txt next to memo.m4a
  ```
- **Three engines, when to use which** (mirror the table from AGENTS.md):
  mlx default (multilingual, Russian-default = antony66), cpp (offline-strict),
  gigaam (opt-in 2nd-opinion for Russian).
- **Supported platforms**: macOS Apple Silicon (preferred) and Intel
  (cpp engine works, mlx/gigaam require Apple Silicon for performance).
- **Disk footprint**: ~20 GB for full setup; flags to reduce
  (`--no-cpp`, `--no-bond005`, `--no-gigaam`, `--no-mlx`).
- **Environment variables**: `WHISPER_BIN`, `TRANSCRIBE_CACHE_DIR`,
  `TRANSCRIBE_SKIP_POSTINSTALL`.
- **Troubleshooting**: HF download stalls (use `setup` not auto-download),
  transformers ≥4.50 + GigaAM, "Too long wav file" (use `transcribe`
  not the model's own `transcribe` method).
- **Credit upstream**: whisper.cpp (Georgi Gerganov), Whisper (OpenAI),
  mlx-whisper (Apple ML Explore), GigaAM (Sber), antony66 + bond005
  (HuggingFace community).

### 6.10. CHANGELOG.md (Keep-a-Changelog)

```
## [0.1.0] - <release-date>
### Added
- Initial public release.
- CLI: `transcribe <file>` and `transcribe setup [--no-cpp|--no-mlx|...]`.
- macOS support (Apple Silicon native via Metal; Intel works via cpp engine).
- Three transcription engines:
  - mlx (default): mlx-whisper + antony66/whisper-large-v3-russian for ru,
    stock multilingual large-v3 for other languages. ~99 languages.
  - cpp: whisper.cpp built from source with Metal + tuned anti-hallucination
    flags + Silero VAD. Offline-strict, no Python.
  - gigaam (opt-in): Sber GigaAM-v3 RNN-T for Russian-only, native Latin
    output for tech acronyms.
- Russian-specific quality work: antony66 + bond005 fine-tunes converted
  to MLX format on first setup.
- Domain-vocabulary biasing via `--prompt` (mlx/cpp).
```

### 6.11. Pros and Cons

- **Pros:**
  - Conventional npm package shape — discoverable, installable, auditable.
  - Cache-dir model storage means `bun update -g` is cheap.
  - All binaries source-built or curl-downloaded on the user's machine —
    no opaque blobs shipped by us.
  - CI gates every release.
  - Three engines means one of them will work for most users (offline-strict
    → cpp; quality-first Russian → mlx; experimental → gigaam).
- **Cons:**
  - First-run setup is now ~15–30 min and ~20 GB (3 engines + 4 model
    families + 3 GB of Python wheels). Inherent to the design choices in
    `mlx-russian/` and `gigaam/` specs, not fixable here.
  - Three engines = three things that can break with upstream version drift
    (transformers, mlx-whisper, whisper.cpp). The `--no-*` flags in setup
    mitigate by letting users opt out of the engines they don't need.
  - Bun-only runtime is a barrier for Node users.
  - Python (via uv) is a runtime dependency now, even though we isolate it.
- **Consequences:**
  - You become the maintainer of an npm package — issues, dependabot,
    occasional whisper.cpp / mlx-whisper / transformers compat work.
  - npm 2FA strongly recommended for the publishing account.
  - The CHANGELOG should call out engine version pins (we're pinned to
    `transformers<4.50` for gigaam — a future loosening is a real release
    note).
  - Public repo means the design and code are now subject to public scrutiny.

## 7. Testing Strategy

Current state: **55 tests pass** across 6 files (cli, audio, paths, and
three engine wrappers). Pure argv construction + alias resolution + flag
parsing. None require an installed engine binary or model file.

The publish work adds 3 new test surfaces (subcommand routing,
postinstall skip logic, cache-dir resolution). No tests exercise actual
builds or model downloads (too slow, too network-dependent).

### 7.1. Unit Tests (additions for the publish epic)

- `cli.ts` subcommand routing: `transcribe foo.m4a` → transcribe handler,
  `transcribe setup` / `transcribe setup:mlx` / `transcribe setup:cpp` →
  spawn the matching `scripts/setup-*.sh`, `transcribe --version` →
  prints `package.json` version, `transcribe --help` → combined help.
- `paths.ts` cache-dir resolution: honors `TRANSCRIBE_CACHE_DIR`,
  `XDG_CACHE_HOME`, the macOS default, and the legacy local-dev fallback.
- `postinstall.ts` skip logic: returns "skip" reason given any of
  `CI=true`, `TRANSCRIBE_SKIP_POSTINSTALL=1`, non-darwin platform.

Existing 55 tests stay green throughout.

### 7.2. Integration Tests (manual, in CONTRIBUTING.md release checklist)

- `bun publish --dry-run --access public` shows file list matches `files`
  allowlist (no `vendor/`, no `models/`, no `*.test.ts`, no `specs/`).
- `npm pack` produces a tarball; `bun add ./tarball` in a tmp dir installs
  cleanly with `TRANSCRIBE_SKIP_POSTINSTALL=1`. The `transcribe` binary is
  on PATH and `transcribe --help` exits 0.
- **Fresh-Mac install test** (T29 in §8.5): on a Mac that has never run
  `bun run setup` from this repo, `bun add -g @ilyavorobiev/transcribe &&
  transcribe setup && transcribe sample-ru.m4a` produces a Russian
  transcript. This is the real ship gate.

## 8. Definition of Done

### Universal (always required)

- [ ] Tests pass (`bun run test`)
- [ ] TypeScript compiles cleanly (`bun run typecheck`)
- [ ] Linter passes (`bun run lint`) — N/A until linter added; documented.
- [ ] Spec updated to reflect implementation (if diverged)

### Feature-Specific

Done items checked. Remaining items unchecked.

- [x] `git init` and initial commit (`23a1242`, then `079fa5e`, `8def437`).
- [ ] `LICENSE` file present (MIT, © 2026 Ilya Vorobiev). **T1**
- [ ] `CHANGELOG.md` with `0.1.0` entry per §6.10. **T2**
- [ ] `CONTRIBUTING.md` documents test commands, release procedure, and
      the engine-version-pin policy. **T3**
- [ ] `package.json` updated per §6.2: `name`, `version`, `description`,
      `license`, `author`, `homepage`, `repository`, `bugs`, `keywords`,
      `files`, `os`, `engines.bun`, `bin`, `scripts.postinstall`.
      `private` removed. **T4**
- [ ] `.npmignore` belt-and-suspenders alongside `files` allowlist. **T5**
- [ ] `.github/ISSUE_TEMPLATE/{bug,feature}.md`. **T6**
- [ ] `src/cli.ts` dispatches `setup` / `setup:mlx` / `setup:cpp`
      subcommands and `--version` / `--help` flags. **T8**
- [ ] `scripts/postinstall.ts` implemented per §6.5; honors
      `TRANSCRIBE_SKIP_POSTINSTALL=1` and `CI=true`; never fails install,
      never builds, never downloads. **T11**
- [ ] `src/paths.ts` resolves model + binary paths to
      `~/Library/Caches/transcribe/` by default per §6.6; env overrides
      honored; legacy local-dev path still works when running from the
      source repo. **T10**
- [ ] `setup-all.sh` writes artifacts into the cache dir, not `<repo>/models`.
      Idempotent across cache-dir-vs-local-dev environments. **T10b**
- [ ] `README.md` rewritten per §6.9 (badges, quickstart, three engines,
      env vars, troubleshooting). **T17**
- [ ] `.github/workflows/ci.yml` runs typecheck + tests on macos-latest. **T18**
- [ ] `.github/workflows/release.yml` publishes on `v*.*.*` tags. **T19**
- [ ] Public GitHub repository created at
      `github.com/ilyavorobiev/transcribe` and pushed. **T21, T22**
- [ ] `NPM_TOKEN` secret added to the GitHub repository. **T24, T25**
- [ ] `bun publish --dry-run --access public` shows the expected file list. **T26**
- [ ] Initial `v0.1.0` tag pushed; release workflow publishes successfully. **T27**
- [ ] **Fresh-Mac smoke test**: clean shell on a Mac that has never run
      this repo's setup. `bun add -g @ilyavorobiev/transcribe &&
      transcribe setup && transcribe sample-ru.m4a` produces a Russian
      transcript. **T29** — this is the real ship gate.

## 8.5. Execution Plan

Many tasks from the original plan landed during the engine-architecture
work (`mlx-russian/`, `gigaam/` specs). The table below marks what's done,
what changed, and what's still needed for v0.1.0 publish.

### Tasks

| ID  | Task                                                                                                                       | Status | Deps          | Est.    |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ------ | ------------- | ------- |
| T1  | Add `LICENSE` (MIT, © 2026 Ilya Vorobiev)                                                                                  | TODO   | —             | 5 min   |
| T2  | Add `CHANGELOG.md` with `0.1.0` entry (§6.10)                                                                              | TODO   | —             | 5 min   |
| T3  | Add `CONTRIBUTING.md` (tests, release procedure, engine version-pin policy)                                                | TODO   | —             | 20 min  |
| T4  | Update `package.json` per §6.2 (name, version, description, license, author, homepage, repository, bugs, keywords, `files`, `os`, `engines`, `bin`, `scripts.postinstall`; remove `private`) | TODO | —             | 30 min  |
| T5  | Add `.npmignore`                                                                                                           | TODO   | —             | 5 min   |
| T6  | Add `.github/ISSUE_TEMPLATE/{bug,feature}.md`                                                                              | TODO   | —             | 15 min  |
| T7  | Engine extraction — formerly "extract main flow to commands/transcribe.ts"                                                 | DONE   | —             | —       |
|     | → Done in a different shape: `src/engines/{cpp,mlx,gigaam}.ts` + `types.ts`. Each engine exposes a pure argv builder + `Engine` instance. `cli.ts` dispatches via `ENGINE_MAP`. |        |               |         |
| T8  | Subcommand routing in `src/cli.ts` — `transcribe setup` / `setup:mlx` / `setup:cpp`, plus `--version`                       | TODO   | T7            | 45 min  |
|     | (Without this, `bun add -g …` ships a binary that can transcribe but can't install its own engines.)                       |        |               |         |
| T9  | "Implement `commands/setup.ts`" — formerly Bun.fetch model download                                                        | DONE   | —             | —       |
|     | → Done in a different shape: `scripts/setup-all.sh` + 4 helper scripts. Curl-based downloads (HF S3-redirect bug avoided). Documented in `mlx-russian/` and `gigaam/` specs. |        |               |         |
| T10 | Extend `src/paths.ts` + each engine to use `~/Library/Caches/transcribe/` cache-dir (§6.6). Honor `TRANSCRIBE_CACHE_DIR`, `XDG_CACHE_HOME`. Legacy local-dev fallback. | TODO | —             | 1.5 h   |
| T10b | Update `scripts/setup-all.sh` (+ helpers) to write artifacts into the cache dir, not `<repo>/models`. Backwards-compat: if `<repo>/models/...` already exists (author's machine), prefer it. | TODO | T10          | 30 min  |
| T11 | Implement `scripts/postinstall.ts` per §6.5 — skip-only behavior, prints next-step banner, never builds, never downloads, never fails install | TODO | T8          | 30 min  |
| T12 | (Originally: delete superseded scripts) — N/A; current scripts stay                                                        | DROPPED| —             | —       |
| T13 | Tests: CLI subcommand routing                                                                                              | TODO   | T8            | 20 min  |
| T14 | (Originally: setup arg parsing tests) — N/A; setup is bash, exercised by smoke tests, not unit tests                       | DROPPED| —             | —       |
| T15 | Tests: cache-dir resolution                                                                                                | TODO   | T10           | 20 min  |
| T16 | Tests: postinstall skip logic                                                                                              | TODO   | T11           | 20 min  |
| T17 | Rewrite `README.md` per §6.9 (currently a stub — three engines, quickstart, env vars, troubleshooting)                     | TODO   | T4, T8        | 1.5 h   |
| T18 | `.github/workflows/ci.yml` per §6.7                                                                                        | TODO   | T4            | 20 min  |
| T19 | `.github/workflows/release.yml` per §6.8                                                                                   | TODO   | T4            | 20 min  |
| T20 | `git init`, first commit                                                                                                   | DONE   | —             | —       |
|     | → Done: `23a1242`, `079fa5e`, `8def437` on `main`.                                                                         |        |               |         |
| T21 | **External**: create public GitHub repo `github.com/ilyavorobiev/transcribe`                                               | TODO   | —             | 5 min   |
| T22 | `git remote add origin … && git push -u origin main`                                                                       | TODO   | T1–T19, T20, T21 | 5 min |
| T23 | Verify CI workflow green on first push                                                                                     | TODO   | T18, T22      | 5 min   |
| T24 | **External**: register npm scope `@ilyavorobiev` on npmjs.com                                                              | TODO   | —             | 5 min   |
| T25 | **External**: generate npm token, add `NPM_TOKEN` secret in GitHub repo                                                    | TODO   | T21, T24      | 5 min   |
| T26 | `bun publish --dry-run --access public` — verify file list                                                                 | TODO   | T4, T5        | 5 min   |
| T27 | Tag `v0.1.0`, push — triggers `release.yml`                                                                                | TODO   | T23, T25, T26 | 5 min   |
| T28 | Verify package live on npmjs.com                                                                                           | TODO   | T27           | 2 min   |
| T29 | **Fresh-Mac install**: `bun add -g … && transcribe setup && transcribe sample-ru.m4a` produces a Russian transcript        | TODO   | T28           | 30 min  |

### Done so far (counts toward critical path)

✓ Engine architecture (T7 in spirit) — three engines behind `Engine` interface.
✓ Setup workflow (T9 in spirit) — `setup-all.sh` orchestrator.
✓ Local git history (T20) — three commits on `main`.
✓ 55 unit tests in place — enough that T13/T15/T16 are quick additions, not greenfield.

### Remaining critical path

```
T8 (subcommand routing) → T11 (postinstall) → T10 (cache dir)
                                                  ↓
T17 (README) ← T4 (package.json)               T22 (push) → T23 (CI green)
                                                  ↓
                                          T26 (publish dry-run) → T27 (tag/release)
                                                  ↓
                                                T28 → T29 (fresh-Mac smoke)
```

**T8 + T10 + T10b are the load-bearing items.** Together they answer the
user's "will I have a simple command from any folder?" question:
- T8 makes `transcribe setup` work after global install.
- T10/T10b put models in `~/Library/Caches/`, surviving `bun update -g`.

### Estimated remaining effort

| Phase                            | Estimate  |
| -------------------------------- | --------- |
| Hygiene burst (T1, T2, T3, T5, T6) | ~50 min |
| Subcommand routing + cache (T8, T10, T10b) | ~3 h |
| Postinstall (T11)                | ~30 min   |
| Tests for the above (T13, T15, T16) | ~1 h   |
| README rewrite (T17)             | ~1.5 h    |
| package.json + .npmignore (T4, T5) | ~35 min |
| CI + release workflows (T18, T19) | ~40 min  |
| External setup (T21, T24, T25)   | ~15 min (parallel) |
| Push + verify + publish (T22, T23, T26, T27, T28) | ~25 min + CI |
| Fresh-Mac smoke (T29)            | ~30 min (needs a clean Mac or VM) |

**≈ 7–8 hours of focused work** to ship v0.1.0, assuming no surprises.
T29 (fresh-Mac install) is the most likely place for unknown bugs; the
"works on my machine" gap is real for this kind of multi-engine setup.

### Risks & mitigations

| Risk                                                                  | Mitigation                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `@ilyavorobiev` scope unavailable on npm                              | Have a fallback name ready (e.g. `@ilya-vorobiev/transcribe`). Decided at T24.                   |
| `macos-latest` runner switches arch mid-stream                        | Pin to a specific runner label (`macos-14`+ for ARM) in T18.                                     |
| HuggingFace S3 redirect format changes again                          | All downloads use curl with `--fail`; failed downloads raise, never silently truncate.            |
| Postinstall fails in some user environments                           | T11 is skip-only behavior; never builds or downloads. README/CONTRIBUTING document opt-out env var. |
| First publish goes out with a broken `files` list                     | T26 dry-run is a hard gate before T27.                                                           |
| `bun publish` API differences across Bun versions                     | Pin `oven-sh/setup-bun@v2` + a specific `bun-version` in T19; document in CONTRIBUTING.md.       |
| Fresh-Mac smoke (T29) hits engine-specific bug we missed              | gigaam already cost us 6 bug-fix rounds (specs/gigaam/spec.md §11). Budget for similar pain.     |
| Cache dir migration breaks the author's local setup during T10        | T10b's backwards-compat (prefer existing `<repo>/models` if present) keeps the dev loop working. |
| Package size on npm too large because we forgot to gitignore something | `files` allowlist + `.npmignore` + T26 dry-run = three gates.                                    |

## 9. Alternatives Not Chosen

- **Programmatic library export (`import { transcribe } from "..."`):** User
  explicitly chose CLI-only. Can be added in a future minor version without
  breaking changes by extending the same `src/commands/transcribe.ts` core.
- **Cross-platform (Linux/Windows) in v1:** Deferred. The `os: ["darwin"]`
  guard prevents accidental installs on unsupported platforms with a clear
  message; future PRs can add `linux`/`win32` with build flags per arch.
- **Prebuilt binary distribution:** Deferred — see §5.3 trade-offs.
- **Bundling a small model in the package:** The smallest usable Whisper
  model (`tiny`) is ~75 MB — too large for npm, and the default `large-v3`
  is 3 GB which is unthinkable.
- **Node.js bindings (`smart-whisper`, `whisper-node`):** Rejected in the
  original spec — bindings lag upstream and the CLI binary is more flexible.
- **Telemetry / phone-home for usage metrics:** Out of scope; conflicts with
  the offline/private design driver.

## 10. References

- npm scoped packages: <https://docs.npmjs.com/about-scopes>
- npm `files` allowlist: <https://docs.npmjs.com/cli/v10/configuring-npm/package-json#files>
- npm `os` field: <https://docs.npmjs.com/cli/v10/configuring-npm/package-json#os>
- Bun publish: <https://bun.sh/docs/cli/publish>
- Bun `os.tmpdir`-equivalent cache patterns: macOS Library/Caches convention via Apple's File System Programming Guide.
- Keep a Changelog: <https://keepachangelog.com/en/1.1.0/>
- Semantic Versioning: <https://semver.org/spec/v2.0.0.html>
- MIT License: <https://opensource.org/license/mit/>
- Postinstall script concerns (background reading): <https://overreacted.io/npm-audit-broken-by-design/>
- GitHub Actions for macOS: <https://docs.github.com/en/actions/using-github-hosted-runners/about-github-hosted-runners>
- whisper.cpp models index: <https://huggingface.co/ggerganov/whisper.cpp>
- Related specs (now implemented):
  - [`../mlx-russian/spec.md`](../mlx-russian/spec.md) — MLX engine + antony66/bond005
  - [`../gigaam/spec.md`](../gigaam/spec.md) — GigaAM engine + 6 bug fixes
  - [`../cli/spec.md`](../cli/spec.md) — original whisper.cpp-only v0.1

## 11. Implementation Notes (post-spec drift)

This spec was originally written when the project was a whisper.cpp-only
CLI with 23 tests and a single `scripts/setup.sh`. Since then:

### What changed before publish work started

- **Two new engines** landed (`mlx-russian/`, `gigaam/`), each its own
  spec, each with field findings documenting the bugs hit. The CLI now
  has 3 engines behind a unified interface.
- **Setup grew** from a single bash script to an orchestrator
  (`setup-all.sh`) plus 4 helpers (`setup-mlx.sh`, `setup-cpp.sh`,
  `convert-hf-to-mlx.sh`, `download-hf-model.sh`) plus 1 Python script
  (`gigaam_transcribe.py`). Disk footprint grew from ~3 GB to ~20 GB.
- **`scripts/setup.sh` was renamed** to `scripts/setup-cpp.sh`.
- **`bun run setup`** now points at the orchestrator. Was originally
  going to be a TS subcommand handler (`src/commands/setup.ts`) per the
  original §6.4. The bash-script-orchestrator approach proved simpler
  and is what's in production; the publish work needs to **wire that
  into a `transcribe setup` subcommand** (T8) without re-implementing it.
- **55 tests** across 6 files (up from 23). Engine wrappers added
  significant test surface.

### What this changes about the publish plan

- **T7 (extract `commands/transcribe.ts`)** is satisfied by the engine
  refactor — the "main flow" is now the `Engine` interface + per-engine
  files. No further refactor needed for publish.
- **T9 (implement `commands/setup.ts`)** is satisfied by the existing
  bash orchestrator. The remaining work is exposing it as `transcribe
  setup` (T8 subcommand routing).
- **T10 (cache directory)** is now MORE important, not less. With 4
  model families (~16 GB), a `bun update -g` that wipes them is a
  real-world disaster.
- **T11 (postinstall)** is downgraded. The original spec had it
  attempting a whisper.cpp build during `bun install`. With Python
  install + mlx + 3 engines, that's catastrophically hostile. New
  postinstall is **skip-only**: prints a banner, exits 0.
- **T14 (`setup.ts` arg parsing tests)** is dropped — setup is bash;
  smoke tests cover the orchestrator end-to-end. Unit-testing bash
  argv would be wasted complexity.
- **T29 (fresh-Mac smoke)** is more important than originally captured.
  Three engines means three places where "works on author's machine"
  might not transfer.

### Pin-policy commitment

The `gigaam` engine requires `transformers>=4.40,<4.50` (see
`gigaam/spec.md` §11 Field finding #3). When transformers 5.0 lands or
when the GigaAM model's `trust_remote_code` modeling gets updated to be
compatible with meta-device init, we'll loosen this pin. **That's a
real CHANGELOG entry** — not a silent dep bump.

Similar pins likely needed for `mlx-whisper` (currently floats; no
known breakage), `pyannote.audio` (needed-but-unused), `torchaudio`
(API drift cost us bug #4 in gigaam). Document each in CONTRIBUTING.md.

## 12. Field findings (publish work, 2026-05-17)

### Finding #1 — Bun's `files` allowlist ignores `.npmignore`

We wrote a `.npmignore` excluding `**/*.test.ts` as the "belt" half of a
belt-and-suspenders setup with the `files` array (§6.2). On `bun publish
--dry-run` every `src/**/*.test.ts` was still packed (10+ KB of test code
in a 79 KB tarball). Confirmed with `bun publish v1.3.11`: when `files`
is set, Bun uses it as the authoritative allowlist and does **not**
intersect it with `.npmignore` patterns.

**Fix:** use negative globs inside `files` itself. The current
`package.json` carries:

```json
"files": [
  "src",
  "!src/**/*.test.ts",
  "!src/**/*.test.tsx",
  ...
]
```

`.npmignore` is kept as defense-in-depth and as a hint to developers
reading the repo, but it does not influence the tarball under Bun.

### Finding #2 — `bun publish --dry-run` requires auth in CI

The original `release.yml` (§6.8) had a dry-run gate before the real
publish to catch packing regressions. In CI without an npm token,
`bun publish --dry-run` exits with code 1 even though packing succeeds
and the file list is printed (`error: missing authentication (run
'bunx npm login')`). This is different from `npm publish --dry-run`,
which works without auth. The result was a release.yml that failed
**before** ever attempting the real publish.

**Fix:** dropped the dry-run step from CI. The real `bun publish` packs
identically, so a packing bug would surface there a few seconds later
with the same error. `CONTRIBUTING.md` still calls out a local
`bun publish --dry-run --access public` as part of the manual release
checklist (where the developer is already logged in via `bun login`).

### Finding #3 — `os.homedir()` ignores `$HOME` env mutations

`src/paths.ts cacheRoot()` originally relied on `os.homedir()` from
node:os to compose the macOS default `~/Library/Caches/transcribe`.
The cache-dir unit tests set `process.env.HOME = "/Users/testuser"`
and expected the resolver to pick that up. It didn't — `homedir()`
under libuv reads from the passwd database at first call and caches,
so test overrides never take effect.

**Fix:** `cacheRoot()` checks `process.env.HOME` first and falls back
to `homedir()`. This also matches the bash resolver in
`scripts/setup-all.sh resolve_artifact_dirs()`, which uses `$HOME`
unconditionally — write-time and read-time agree.

### Finding #4 — Tag-recreation is part of the release dance

We tagged `v0.1.0` while release.yml still had the broken dry-run
step. The workflow failed at the dry-run step, **before** the real
publish step ran, so nothing actually reached npm — but the tag was
sitting on a broken release config. Recovery was: fix release.yml,
commit, delete tag both locally and on origin, re-tag on the new
commit, push.

This is safe **only because no consumer has the tag yet** (the repo
is brand-new). For a real subsequent release, the right move is
always to bump to the next patch version rather than recycle a tag.
We caught a freebie this time; document it so future-you doesn't
expect to recycle tags after public consumption.

### Finding #5 — `script.test` must be `bun test src`, not `bun test`

Already documented in `cli/spec.md` and `AGENTS.md`, but worth
re-stating: `bun test` (no args) walks the working tree and picks
up the broken Node-addon test inside `vendor/whisper.cpp/`. The
package.json `test` script is `bun test src` to scope. CI runs
`bun run test` (the script), not `bun test` directly.
