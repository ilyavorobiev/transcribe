# Publishing `transcribe` to npm + GitHub — Technical Specification

## 1. Meta Information

- **Branch:** `main`
- **Epic:** v0.1.0 — public OSS release on npm + GitHub
- **PRD:** N/A (personal OSS project)

## 2. Context

The local CLI at `/Users/ivorobiev/Desktop/repos/transcriber/` works for the
author. This spec covers what's needed to turn it into a **publishable,
installable CLI** that any macOS user can `bun add -g` and use.

- **Distribution:** npm (scoped, `@ilyavorobiev/transcribe`) and a public
  GitHub repository under `github.com/ilyavorobiev/transcribe`.
- **Surface:** CLI binary only (no exported library API). Users run
  `transcribe <file>` and `transcribe setup`.
- **License:** MIT.
- **Platforms (v1):** macOS only (Apple Silicon native, Intel falls back to CPU).
- **Binary/model provisioning:** post-install script attempts a build, and an
  explicit `transcribe setup` subcommand handles building + model download as
  a first-class, idempotent command.

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

- Code: `/Users/ivorobiev/Desktop/repos/transcriber/` — not a git repo.
- `package.json`: `private: true`, `bin.transcribe` = `./src/cli.ts`.
- `src/`: `cli.ts`, `audio.ts`, `whisper.ts`, `paths.ts`, plus colocated
  tests (23 passing).
- `scripts/setup.sh`: bash; clones whisper.cpp into `vendor/` next to source
  and downloads the model into `models/` next to source. Hard-codes
  project-root-relative paths.
- `scripts/install.sh`: writes a `transcribe` shim to `~/.local/bin/`.
- `tsconfig.json`: strict, `noUncheckedIndexedAccess`.
- No LICENSE, no CHANGELOG, no README badges, no CI, no `.github/`.

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

### 6.1. Repo layout (publishable)

```
transcribe/
├── src/
│   ├── cli.ts            # entry — now also routes subcommands
│   ├── commands/
│   │   ├── transcribe.ts # current main flow extracted
│   │   ├── setup.ts      # new — builds whisper.cpp + downloads model
│   │   └── doctor.ts     # new — diagnoses env (post-v1, optional)
│   ├── audio.ts
│   ├── whisper.ts
│   ├── paths.ts          # extended with cache-dir resolution
│   ├── log.ts            # tiny styled-stderr helper (no deps)
│   └── *.test.ts
├── scripts/
│   └── postinstall.ts    # replaces setup.sh; TS for testability
├── .github/
│   ├── workflows/
│   │   ├── ci.yml        # typecheck + tests on macos-latest
│   │   └── release.yml   # publish on tag push
│   └── ISSUE_TEMPLATE/
│       ├── bug.md
│       └── feature.md
├── LICENSE               # MIT
├── README.md             # badges, install, usage, troubleshooting
├── CHANGELOG.md          # Keep-a-Changelog
├── CONTRIBUTING.md       # how to run tests, propose changes, cut releases
├── package.json
├── tsconfig.json
├── .gitignore
└── .npmignore            # belt-and-suspenders with package.json `files`
```

### 6.2. `package.json` changes

```jsonc
{
  "name": "@ilyavorobiev/transcribe",
  "version": "0.1.0",
  "description": "Offline transcription of iPhone voice memos via whisper.cpp",
  "license": "MIT",
  "author": "Ilya Vorobiev",
  "homepage": "https://github.com/ilyavorobiev/transcribe",
  "repository": { "type": "git", "url": "git+https://github.com/ilyavorobiev/transcribe.git" },
  "bugs": { "url": "https://github.com/ilyavorobiev/transcribe/issues" },
  "keywords": ["whisper", "whisper.cpp", "transcribe", "speech-to-text", "russian", "m4a", "voice-memo", "macos", "cli", "offline"],
  "type": "module",
  "engines": { "bun": ">=1.1.0" },
  "os": ["darwin"],
  "bin": { "transcribe": "./src/cli.ts" },
  "files": ["src", "scripts/postinstall.ts", "README.md", "LICENSE", "CHANGELOG.md"],
  "scripts": {
    "postinstall": "bun run scripts/postinstall.ts || true",
    "test": "bun test",
    "typecheck": "bunx tsc --noEmit",
    "transcribe": "bun run src/cli.ts"
  }
}
```

Notes:

- `private: true` removed.
- `os: ["darwin"]` — npm refuses to install on Linux/Windows with a clear
  error, matching v1 scope.
- `engines.bun` — runtime is Bun (the published `bin` is `.ts`).
- `postinstall` is wrapped with `|| true` as a safety net so install never
  fails even if the script crashes.
- `files` allowlist publishes only what's needed. No `vendor/`, no `models/`,
  no `*.test.ts`, no `tsconfig.json`.

### 6.3. CLI subcommand routing (`src/cli.ts`)

`transcribe`'s first positional argument is now either a known subcommand
or a file path. Known subcommands: `setup`, `doctor` (post-v1), `help`.
Special flags: `--version`, `-V`, `--help`, `-h`.

```
transcribe <file.m4a> [options]      # transcribe
transcribe setup [--model <name>]    # one-time install (build + model)
transcribe --version                 # prints package version
transcribe --help                    # combined help
```

The existing `transcribe` flow moves into `src/commands/transcribe.ts` with
no behavior change. `src/cli.ts` becomes a thin dispatcher.

### 6.4. `transcribe setup` (`src/commands/setup.ts`)

Idempotent, network-touching, can run multiple times safely.

Behavior:

1. Verify macOS; refuse politely otherwise.
2. Ensure `git`, `cmake`, `ffmpeg` are present. If missing, print exactly
   the `brew install …` command needed and exit 1.
3. Resolve the cache directory (see §6.6). Create `vendor/` + `models/`.
4. Clone or `git pull --ff-only` whisper.cpp into `<cache>/vendor/whisper.cpp`.
5. `cmake -B build -DGGML_METAL=ON` on Apple Silicon, plain config on Intel.
   Build `whisper-cli`. Skip if `whisper-cli` exists and `git rev-parse HEAD`
   hasn't changed since the last successful build (tracked in
   `<cache>/.build-state.json`).
6. Resolve target model from `--model` (default: `large-v3`).
7. If `<cache>/models/ggml-<model>.bin` exists and its size matches the
   expected size (HEAD-checked against the HuggingFace URL), skip download.
8. Otherwise download from
   `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-<model>.bin`
   directly via `Bun.fetch` (handles the S3 redirect natively — this is the
   bug that broke the upstream `download-ggml-model.sh` in the existing repo).
9. Verify final file size matches `Content-Length`. Refuse to leave a partial
   file in place — write to `*.partial` and rename on success.
10. Print summary with absolute paths.

Flags:

```
transcribe setup [options]
  --model <name>     model to download (default: large-v3)
  --no-build         skip whisper.cpp clone+build, only download model
  --no-model         skip model download, only build whisper.cpp
  --force            rebuild and re-download even if up to date
  --cache-dir <p>    override cache directory
```

### 6.5. `scripts/postinstall.ts`

Runs during `bun install`. Must be **fast** and **safe**.

- Skip if any of: `CI=true`, `TRANSCRIBE_SKIP_POSTINSTALL=1`,
  `process.platform !== "darwin"`, `npm_config_production` truthy.
- Print a concise banner with the next step (`transcribe setup`).
- Best-effort: if `git`, `cmake`, `ffmpeg` are all on PATH, invoke the same
  build logic as `transcribe setup --no-model`. Failures print a warning
  and exit 0 (never fail install).
- **Never** download the model from postinstall (multi-GB download during
  `npm install` is hostile).

### 6.6. Cache directory (`src/paths.ts` extended)

Resolution order:

1. `WHISPER_BIN` env var (existing).
2. `TRANSCRIBE_CACHE_DIR` env var.
3. `$XDG_CACHE_HOME/transcribe` if set.
4. `~/Library/Caches/transcribe` on macOS (default).
5. Legacy `{package-root}/vendor` and `{package-root}/models` — kept for
   local dev only (when running from the source repo).

Same scheme for `WHISPER_MODEL_DIR` → `TRANSCRIBE_MODELS_DIR` →
`<cache>/models/`.

This is the single most important change: when installed globally, the
package lives in a Bun-managed directory that `bun update` will rewrite —
keeping the multi-GB model out of there protects users from accidentally
re-downloading on every package upgrade.

### 6.7. CI (`.github/workflows/ci.yml`)

```yaml
on: [push, pull_request]
jobs:
  test:
    runs-on: macos-latest   # currently Apple Silicon
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
        env: { TRANSCRIBE_SKIP_POSTINSTALL: "1" }
      - run: bun run typecheck
      - run: bun test
```

Tests are pure — no whisper.cpp build or model download in CI. Postinstall
is skipped via the env var the script itself respects.

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
      - run: bun run typecheck && bun test
      - run: bun publish --access public
        env: { NPM_CONFIG_TOKEN: ${{ secrets.NPM_TOKEN }} }
```

Release flow: bump `version` in `package.json`, update `CHANGELOG.md`, commit,
`git tag v0.1.0 && git push --tags`. CI does the publish.

### 6.9. README.md content (replace existing)

- npm install badge (`npm version`), MIT badge, CI status badge.
- 30-second quickstart: `bun add -g @ilyavorobiev/transcribe && transcribe setup && transcribe memo.m4a`.
- Supported platforms: macOS Apple Silicon (Metal) and Intel (CPU).
- Model trade-off table (kept from current README).
- Environment variables: `WHISPER_BIN`, `TRANSCRIBE_CACHE_DIR`,
  `TRANSCRIBE_SKIP_POSTINSTALL`.
- Troubleshooting (existing entries plus: "first run after upgrade redownloads
  whisper.cpp — this is expected, model stays cached").
- Credit upstream: whisper.cpp by Georgi Gerganov, Whisper by OpenAI.

### 6.10. CHANGELOG.md (Keep-a-Changelog)

```
## [0.1.0] - 2026-05-17
### Added
- Initial public release.
- CLI: `transcribe <file>` and `transcribe setup`.
- macOS (Apple Silicon + Intel) support via whisper.cpp.
- Russian, English, and 97 other languages via Whisper large-v3.
```

### 6.11. Pros and Cons

- **Pros:**
  - Conventional npm package shape — discoverable, installable, auditable.
  - Cache-dir model storage means upgrades are cheap.
  - Source-built binary keeps trust simple.
  - CI gates every release.
- **Cons:**
  - Postinstall remains controversial in some communities; mitigated but
    not eliminated.
  - First-run setup still 5–10 minutes (~3 GB model + build) — fundamental
    to whisper.cpp, can't be avoided without bundling.
  - Bun-only runtime is a barrier for Node users.
- **Consequences:**
  - You become the maintainer of an npm package — issues, dependabot,
    occasional whisper.cpp compat work.
  - npm 2FA strongly recommended for the publishing account.
  - Public repo means the design and code are now subject to public scrutiny.

## 7. Testing Strategy

Test scope grows by exactly two things: subcommand routing, and the new
`setup`/`postinstall` decision logic. No tests exercise the actual build or
model download (too slow, too network-dependent).

### 7.1. Unit Tests

- `cli.ts` routing: `transcribe foo.m4a`, `transcribe setup`,
  `transcribe --help`, `transcribe --version` each dispatch to the correct
  handler.
- `setup.ts` argv parsing: `--model`, `--no-build`, `--no-model`, `--force`,
  `--cache-dir` parse correctly and conflicts (`--no-build --no-model`) are
  rejected.
- `paths.ts` cache-dir resolution: covers `TRANSCRIBE_CACHE_DIR`,
  `XDG_CACHE_HOME`, and the macOS default.
- `postinstall.ts` skip logic: returns "skip" reason given CI=true,
  `TRANSCRIBE_SKIP_POSTINSTALL=1`, non-darwin platform, or missing build deps.

### 7.2. Integration Tests

- `npm pack` produces a tarball; running `bun add ./tarball` in a tmp dir
  installs cleanly with `TRANSCRIBE_SKIP_POSTINSTALL=1`. The `transcribe`
  binary is on PATH and `transcribe --help` exits 0. (Manual, documented in
  CONTRIBUTING.md release checklist; not automated in CI for v1.)

## 8. Definition of Done

### Universal (always required)

- [ ] Tests pass (`bun run test`)
- [ ] TypeScript compiles cleanly (`bun run typecheck`)
- [ ] Linter passes (`bun run lint`) — N/A until linter added; documented.
- [ ] Spec updated to reflect implementation (if diverged)

### Feature-Specific

- [ ] `LICENSE` file present (MIT, © 2026 Ilya Vorobiev).
- [ ] `CHANGELOG.md` present with `0.1.0` entry.
- [ ] `package.json` updated: `name`, `version`, `description`, `license`,
      `author`, `homepage`, `repository`, `bugs`, `keywords`, `files`,
      `os`, `engines.bun`, `bin`, `scripts.postinstall`. `private` removed.
- [ ] `src/cli.ts` dispatches `setup` subcommand and `--version` flag.
- [ ] `src/commands/setup.ts` implemented and idempotent.
- [ ] `scripts/postinstall.ts` implemented; honors
      `TRANSCRIBE_SKIP_POSTINSTALL=1` and `CI=true`; never fails install.
- [ ] `src/paths.ts` resolves to `~/Library/Caches/transcribe/` by default;
      env overrides honored.
- [ ] `README.md` rewritten with badges, quickstart, env vars, troubleshooting.
- [ ] `CONTRIBUTING.md` documents test commands and release procedure.
- [ ] `.github/workflows/ci.yml` runs typecheck + tests on macos-latest.
- [ ] `.github/workflows/release.yml` publishes on `v*.*.*` tags.
- [ ] `git init && git remote add origin git@github.com:ilyavorobiev/transcribe.git`.
- [ ] Public GitHub repository created and initial commit pushed.
- [ ] `NPM_TOKEN` secret added to the GitHub repository.
- [ ] `bun publish --dry-run --access public` shows the expected file list.
- [ ] Initial `v0.1.0` tag pushed; release workflow publishes successfully.
- [ ] `bun add -g @ilyavorobiev/transcribe` in a clean shell installs the
      package and `transcribe --help` works.

## 8.5. Execution Plan

Turns §6 (Proposed Solution) into a sequenced task graph. Each task is small
enough to land in one PR; estimates are calendar time for one focused person.

### Tasks

| ID  | Task                                                                                                                                                                | Deps          | Est.    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------- |
| T1  | Add `LICENSE` (MIT, © 2026 Ilya Vorobiev)                                                                                                                           | —             | 5 min   |
| T2  | Add `CHANGELOG.md` with `0.1.0` placeholder                                                                                                                          | —             | 5 min   |
| T3  | Add `CONTRIBUTING.md` (test + release procedure)                                                                                                                     | —             | 15 min  |
| T4  | Update `package.json` (name, version, description, license, author, homepage, repository, bugs, keywords, `files`, `os`, `engines`, `bin`, `scripts.postinstall`; remove `private`) | —             | 20 min  |
| T5  | Add `.npmignore`                                                                                                                                                    | —             | 5 min   |
| T6  | Add `.github/ISSUE_TEMPLATE/{bug,feature}.md`                                                                                                                        | —             | 15 min  |
| T7  | Extract current main flow → `src/commands/transcribe.ts`                                                                                                            | —             | 20 min  |
| T8  | Add subcommand routing + `--version` / `--help` in `src/cli.ts`                                                                                                     | T7            | 30 min  |
| T9  | Implement `src/commands/setup.ts` — idempotent build + model download via direct `Bun.fetch` (fixes the HuggingFace S3-redirect bug that broke our first attempt)   | T7            | 2 h     |
| T10 | Extend `src/paths.ts` with cache-dir resolution (`~/Library/Caches/transcribe/`, `TRANSCRIBE_CACHE_DIR`, `XDG_CACHE_HOME`)                                          | —             | 30 min  |
| T11 | Implement `scripts/postinstall.ts` — skip logic (`CI`, `TRANSCRIBE_SKIP_POSTINSTALL`, non-darwin), best-effort build, never fails install                            | T9, T10       | 45 min  |
| T12 | Delete `scripts/setup.sh` and `scripts/install.sh` (superseded by T9 and T11)                                                                                       | T11           | 5 min   |
| T13 | Tests: CLI subcommand routing dispatch                                                                                                                              | T8            | 20 min  |
| T14 | Tests: `setup` arg parsing                                                                                                                                          | T9            | 20 min  |
| T15 | Tests: cache-dir resolution                                                                                                                                         | T10           | 20 min  |
| T16 | Tests: postinstall skip logic                                                                                                                                       | T11           | 20 min  |
| T17 | Rewrite `README.md` (badges, quickstart, env vars, troubleshooting, model trade-offs)                                                                               | T4, T8        | 45 min  |
| T18 | `.github/workflows/ci.yml` (typecheck + tests on `macos-latest`, postinstall skipped)                                                                               | T4            | 20 min  |
| T19 | `.github/workflows/release.yml` (publish on `v*.*.*` tag)                                                                                                           | T4            | 20 min  |
| T20 | `git init`, first commit                                                                                                                                            | T1–T19        | 5 min   |
| T21 | **External**: create public GitHub repo `github.com/ilyavorobiev/transcribe`                                                                                        | —             | 5 min   |
| T22 | `git remote add origin … && git push -u origin main`                                                                                                                | T20, T21      | 5 min   |
| T23 | Verify CI workflow green on initial push                                                                                                                            | T18, T22      | 5 min   |
| T24 | **External**: register npm scope `@ilyavorobiev` on npmjs.com                                                                                                       | —             | 5 min   |
| T25 | **External**: generate npm token, add as `NPM_TOKEN` secret in GitHub repo                                                                                          | T21, T24      | 5 min   |
| T26 | `bun publish --dry-run --access public` — verify file list matches `files` allowlist                                                                                | T4, T5        | 5 min   |
| T27 | Tag `v0.1.0`, push — triggers `release.yml`                                                                                                                         | T23, T25, T26 | 5 min   |
| T28 | Verify package live on npmjs.com                                                                                                                                    | T27           | 2 min   |
| T29 | Verify `bun add -g @ilyavorobiev/transcribe && transcribe --help` in a clean shell                                                                                  | T28           | 5 min   |

### Critical path

The longest dependency chain — minimum wall-clock time to ship:

```
T7 → T9 → T11 → T16 → T20 → T22 → T23 → T27 → T28 → T29
```

≈ **4 hours of focused work** plus CI wait (~5 min) plus external steps
(GitHub repo + npm scope + token; ~15 min total if done in parallel).

**T9** (the `setup.ts` rewrite with the HuggingFace download fix) is the
single longest task and the load-bearing item — most downstream work waits
on it. Land it early.

### Parallelizable work (off the critical path)

Can happen any time before T20 and don't block each other:

- **Hygiene burst** (~45 min total): T1, T2, T3, T5, T6.
- **CI workflows** (~40 min): T18 and T19 — only depend on T4.
- **Tests** (~80 min): T13, T14, T15 are independent siblings of T16 and
  can be written alongside their corresponding implementation.
- **README** (~45 min): T17 — needs T8 (final subcommand shape).
- **External setup**: T21, T24, T25 — start on day 1 so they're ready by T27.

### Recommended sequence

Keeps visible progress and the critical path moving:

1. **Hygiene burst** (45 min): T1, T2, T3, T5, T6 — easy wins, makes repo
   look "real" to anyone who lands on it mid-build.
2. **External kick-off** (15 min, parallel): T21, T24, T25.
3. **`package.json` + extraction** (50 min): T4, T7 — unblocks everything.
4. **Core implementation** (~3 h): T8, T9 — the bulk of the work.
5. **Cache + postinstall** (~1.5 h): T10, T11, T12.
6. **Tests + README + CI** (~2 h, parallel within): T13–T19.
7. **Git + push + verify CI** (30 min): T20, T22, T23.
8. **Ship** (~15 min + CI time): T26, T27, T28, T29.

### Risks & mitigations

| Risk                                                                  | Mitigation                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `@ilyavorobiev` scope unavailable on npm                              | Have a fallback name ready (e.g. `@ilya-vorobiev/transcribe`). Decided at T24.                   |
| `macos-latest` runner switches arch mid-stream                        | Pin to a specific runner label (`macos-14` for ARM) in T18.                                      |
| HuggingFace changes the download path again                           | T9 includes HEAD-check + size verification; falls back to clear error with manual URL.           |
| Postinstall fails in some user environments                           | T11 makes it strictly best-effort; T17 README mentions opt-out env var prominently.              |
| First publish goes out with a broken `files` list                     | T26 dry-run is a hard gate before T27.                                                           |
| `bun publish` API differences across Bun versions                     | Pin `oven-sh/setup-bun@v2` and a specific `bun-version` in T19; document it in CONTRIBUTING.md.  |

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
