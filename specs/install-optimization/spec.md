# Install optimization — minimal default, cleanup, on-demand install — Technical Specification

## 1. Meta Information

- **Branch:** main
- **Epic:** v0.2.0 — shrink the first-install footprint, auto-clean
  intermediaries, install-on-demand for opt-in engines, explicit
  reinstall verb
- **PRD:** N/A (continuation of `specs/publish/spec.md`)
- **Status:** Proposed. Open questions in §11.

## 2. Context

### 2.1. What's wrong today

`transcribe setup` is a one-shot "install everything" command. It
downloads + builds + converts:

| Component                                       | Disk      | Time             |
| ----------------------------------------------- | --------- | ---------------- |
| mlx-whisper (uv tool venv)                      | ~1 GB     | ~1 min           |
| whisper.cpp source + Metal build                | ~500 MB   | ~3–5 min         |
| ggml-large-v3 (cpp engine)                      | ~3 GB     | ~1–5 min         |
| Silero VAD                                      | ~1 MB     | trivial          |
| antony66 HF download (`-hf` dir)                | ~3 GB     | ~3–10 min        |
| antony66 → MLX converted                        | ~3 GB     | ~2 min           |
| bond005 HF download (`-hf` dir)                 | ~3 GB     | ~3–10 min        |
| bond005 → MLX converted                         | ~3 GB     | ~2 min           |
| GigaAM-v3 model files                           | ~420 MB   | ~1 min           |
| GigaAM uv venv warm (torch + transformers etc.) | ~3 GB     | ~5 min           |
| **Default total**                               | **~20 GB**| **~15–30 min**   |

The result is hostile for first-time users:
- A user who just wants "Russian voice memo → text" doesn't need cpp
  (offline-strict) or gigaam (2nd-opinion) or bond005 (code-switching
  alt). The default `mlx + antony66` path is what they'll actually use.
- The `-hf` intermediate directories (~6 GB total) are dead weight
  after a successful conversion — they're only kept "in case the
  conversion went wrong" but the conversion is deterministic.
- A user who tries `--engine gigaam` and gets a setup hint can't
  recover in-place — they have to leave the prompt, re-run setup, then
  re-run their command.
- There's no obvious "wipe and re-download" if a model was corrupted
  or a transformers version drift broke an install.

### 2.2. What the user asked for

1. Default install = mlx + antony66 only.
2. Auto-clean intermediary files after successful operations.
3. Prompt to install missing pieces when running a command that needs
   them (e.g. `--engine gigaam` without gigaam installed).
4. A first-class reinstall verb.

This spec works through each, plus the knock-on changes to CLI
surface, env vars, and tests.

## 3. Key Technical Drivers

- **D1 — Minimal time-to-first-transcript.** The default install
  should be the smallest disk + time footprint that gets the user's
  most likely command (`transcribe foo.m4a`) working. Target:
  **≤ 6 GB, ≤ 8 min** on a clean Mac.
- **D2 — No surprise disk.** Conversions leave behind `-hf` source
  directories that triple the on-disk model footprint until the user
  manually deletes them. Auto-cleanup after a verified-good
  conversion eliminates the surprise.
- **D3 — In-place recovery.** A user hitting "engine not installed"
  in the middle of a workflow should be one Y/Enter away from
  finishing, not "exit, run setup, come back".
- **D4 — Idempotence remains.** All existing guarantees of the
  current setup (re-runs skip work, partial states recover) must hold
  for the new minimal default and the new reinstall verb.
- **D5 — Scripted contexts don't get prompted.** CI, automated
  pipelines, and "I piped output to a file" must not block on a TTY
  question. Default to TTY-only prompts; provide opt-out.
- **D6 — Backwards-compat with the author's machine.** The legacy
  local-dev cache fallback (specs/publish/spec.md §6.6) keeps working.
  Existing fully-installed users don't see anything regress.

## 4. Current State

### 4.1. Setup flow (today)

`scripts/setup-all.sh` is the orchestrator:
- Section 1: brew deps (uv, ffmpeg, cmake, git)
- Section 2: mlx-whisper via `uv tool install`
- Section 3: whisper.cpp clone + Metal build + ggml-large-v3 + VAD
- Section 4: antony66 HF download + MLX convert
- Section 5: bond005 HF download + MLX convert
- Section 6: GigaAM-v3 model + uv venv warm

Each section honors `--no-cpp`, `--no-mlx`, `--no-bond005`,
`--no-gigaam` flags (opt-out). Idempotent: re-runs skip completed
sections.

### 4.2. Missing-engine handling (today)

Each engine has its own error class with a setup hint:

```ts
// src/engines/mlx.ts
new MissingLocalModelError(alias, resolvedPath)
// → "model 'antony66-russian' resolves to /Users/.../antony66-russian-mlx
//    but that directory doesn't exist.
//    Fix: transcribe setup        # downloads + converts antony66"
```

The user reads the hint, ctrl-c's, runs the suggested command, then
re-runs their original. No in-place recovery.

### 4.3. Cleanup (today)

`scripts/convert-hf-to-mlx.sh` does this at the end:

```
The HF-format source files are kept at:
  <cache>/models/antony66-russian-hf
(you can rm -rf this to reclaim ~3 GB once you're sure the conversion is good)
```

Nothing automatic. The cpp engine's whisper.cpp build also leaves
`build/CMakeFiles/` (~200 MB of object files) sitting around forever.

### 4.4. Reinstall (today)

There isn't one. Workarounds:
- `rm -rf ~/Library/Caches/transcribe/models/antony66-russian-mlx`
  then `transcribe setup`. Possible but the user has to know the
  exact paths and pick the right dirs.
- `transcribe setup` re-run is a no-op for already-present artifacts —
  it cannot fix a corrupted half-download.

## 5. Considered Options

### 5.1. Option 1 (CHOSEN) — Opt-in install, auto-cleanup, smart on-demand, explicit reinstall

- **Description:** `transcribe setup` shrinks to "mlx + antony66
  only" by default. New `--with <name>` and `--full` flags add engines
  / models. Conversions auto-clean their `-hf` sources after a
  size-and-shape sanity check. On engine-missing errors the CLI
  detects, prompts (TTY only), installs in-place, retries.
  `transcribe reinstall [<name>]` wipes and re-downloads.
- **Pros:**
  - First-install drops from 20 GB / 30 min to ~6 GB / ~8 min.
  - No more `-hf` orphans.
  - In-place recovery — one Y/Enter to fix and continue.
  - Reinstall is a first-class verb, no `rm -rf` archaeology.
- **Cons:**
  - Breaking change to `setup` default behavior. Existing users
    expecting "install all" will be surprised on next `bun update -g`
    if they re-run setup. Mitigated by: idempotence — existing installs
    don't get wiped; `--full` documented; CHANGELOG entry; deprecation
    aliases for the `--no-*` flags.
  - Auto-cleanup is destructive (we delete the `-hf` source). If the
    conversion silently produced bad weights the user lost the
    source. Mitigated by a strict sanity check before deletion and
    `reinstall` being one command away.

### 5.2. Option 2 — Keep opt-out, just shrink default + auto-clean

- **Description:** `transcribe setup` still installs everything, but
  drop bond005 + (maybe) gigaam from the default set. Add auto-clean.
  Skip the on-demand prompt + reinstall verb.
- **Pros:** Less behavioral churn. No new prompts to design.
- **Cons:** Still 14+ GB on default install (vs ~6 GB for Option 1).
  Doesn't address in-place recovery or reinstall, which are explicit
  user asks.
- **Verdict:** Misses 2 of the 4 user requirements. Rejected.

### 5.3. Option 3 — Pure manual: don't auto-install, don't auto-clean, just give better errors

- **Description:** Improve error messages, add `transcribe reinstall`,
  do nothing else. The user runs every install command explicitly.
- **Pros:** Smallest scope. No prompt-vs-script tension. No risk of
  surprise auto-installs in someone else's CI.
- **Cons:** Doesn't address requirement #1 (minimal default) at all.
  Punts on requirement #2 (auto-clean). Doesn't deliver requirement
  #3 (in-place recovery) — just makes the errors slightly nicer.
- **Verdict:** Doesn't match the ask. Rejected.

### 5.4. Comparison

| Driver / Criterion              | Opt 1 (CHOSEN) | Opt 2 (shrink+clean) | Opt 3 (manual+errors) |
| ------------------------------- | -------------- | -------------------- | --------------------- |
| Time-to-first-transcript (D1)   | ++             | +                    | −                     |
| No surprise disk (D2)           | +              | +                    | −                     |
| In-place recovery (D3)          | +              | −                    | ~                     |
| Idempotence preserved (D4)      | +              | +                    | +                     |
| TTY safety for CI (D5)          | + (opt-out)    | n/a                  | + (no prompts)        |
| Author-machine backcompat (D6)  | +              | +                    | +                     |
| Covers all 4 user requirements  | +              | partial              | partial               |

## 6. Proposed Solution

### 6.1. New `transcribe setup` semantics

`transcribe setup [options]` (run by both the bin and the bash
orchestrator):

| Flag                                | Effect                                                                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| (no flags)                          | **Minimal default**: brew deps (uv, ffmpeg), mlx-whisper, antony66 conversion. Skip cpp, gigaam, bond005.                           |
| `--with cpp` / `--with gigaam` / `--with bond005` (repeatable) | Add one or more opt-in components. Combine freely (`--with cpp --with gigaam`).                          |
| `--full`                            | Install everything (current default behavior). Equivalent to `--with cpp --with gigaam --with bond005`.                             |
| `--no-cpp` / `--no-mlx` / `--no-gigaam` / `--no-bond005` | **Deprecated** but still honored: implies `--full` minus the named component. Prints a deprecation notice pointing at `--with`. |
| `--clean`                           | Only run the cleanup pass (remove `-hf` dirs + cpp build intermediates). No installs.                                              |
| `--force`                           | Re-download / re-build even if artifacts look present. Combines with the above.                                                    |

Per-engine subcommands (`transcribe setup:mlx`, `transcribe setup:cpp`)
keep their current single-engine behavior and add a `transcribe setup:gigaam`
sibling for symmetry.

Implementation: the bash orchestrator (`scripts/setup-all.sh`) gains
an `INSTALL_SET` variable populated from the flags. Each section
guards on membership: `if has_item cpp; then …`. Default
`INSTALL_SET` = `mlx,antony66`.

### 6.2. Auto-cleanup

Two cleanup targets, each fired by the relevant install path:

1. **HF source dirs after MLX conversion** (`scripts/convert-hf-to-mlx.sh`)
   - After conversion succeeds, the script already moves
     `model.safetensors → weights.safetensors`.
   - New step 6: **sanity-check** the converted dir
     (`weights.safetensors` exists and is ≥ 50 MB; `config.json`
     present and parseable as JSON; no `pytorch_model.bin` from the
     HF side accidentally copied in). If pass, `rm -rf "$RAW_DIR"`.
   - If sanity-check fails, keep `-hf` and print a warning + the
     `transcribe reinstall <model>` hint.
   - Env opt-out: `TRANSCRIBE_KEEP_HF=1` keeps `-hf` (debugging).

2. **whisper.cpp build intermediates** (`scripts/setup-cpp.sh`)
   - After the build produces a valid `whisper-cli` binary, run
     `cmake --build "$WHISPER_DIR/build" --target install` if
     supported, OR explicitly delete `build/CMakeFiles/` and
     `build/**/*.o`. Keeps `bin/whisper-cli` + the .dylibs it links.
   - Net: ~200 MB freed.
   - Same env opt-out: `TRANSCRIBE_KEEP_BUILD=1`.

`transcribe setup --clean` (or `transcribe cleanup` — see §11.3)
runs both sweeps idempotently on the current cache without doing any
installs. Safe to re-run.

### 6.3. On-demand install prompt

Each engine's missing-dependency error currently throws inside
`engine.transcribe()`. New flow:

1. `src/cli.ts main()` resolves engine + model **before** calling
   `engine.transcribe()` (already does).
2. New `engine.checkReady(opts) -> { ready: true } | { ready: false, missing: string[], installCmd: string[] }`
   added to the Engine interface. Pure check: file/dir existence.
3. If not ready, `cli.ts` calls `promptInstall(decision)`:
   - **TTY + `TRANSCRIBE_AUTO_INSTALL` not `0`**: print "`<engine>`
     is not installed (~`<size>` GB, ~`<time>` min). Install now?
     [Y/n]". On Y, spawn `installCmd` (`transcribe setup --with
     <name>`); on success, fall through to transcribe. On N, exit 1
     with the current error message.
   - **Non-TTY** OR **`TRANSCRIBE_AUTO_INSTALL=0`**: skip the
     prompt; exit 1 with the current error + the installCmd
     printed plain.
4. New flag `--auto-install` / `--no-auto-install` makes the choice
   per-invocation. Default = auto (with TTY check).

Concrete example:

```sh
$ transcribe memo.m4a --engine gigaam
warning: gigaam engine is not installed
  needs: GigaAM-v3 model (~420 MB) + uv venv warm (~3 GB, ~5 min first time)
  to install: transcribe setup --with gigaam

Install now? [Y/n] y
==> Installing gigaam...
[normal setup output]
==> Done. Resuming transcription.
[normal transcribe output]
```

Non-TTY:

```sh
$ transcribe memo.m4a --engine gigaam < /dev/null
error: gigaam engine is not installed
  needs: GigaAM-v3 model (~420 MB) + uv venv warm (~3 GB)
  to install: transcribe setup --with gigaam
$ echo $?
1
```

### 6.4. `transcribe reinstall`

New top-level subcommand:

| Form                                                              | Effect                                                                                          |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `transcribe reinstall`                                            | Wipe and re-install the minimal default set (mlx + antony66). Same as `setup --force` but with explicit "rm before install" semantics. |
| `transcribe reinstall <name>` (e.g. `antony66`, `bond005`, `cpp`, `gigaam`) | Wipe only the named item, then re-install it. Doesn't touch other engines.            |
| `transcribe reinstall --all`                                      | Wipe and re-install everything currently present. Doesn't add components that weren't installed. |

Wipe semantics:
- For MLX model dirs: `rm -rf "$CACHE/models/<dir>" "$CACHE/models/<dir>-hf"`.
- For cpp: `rm -rf "$CACHE/vendor/whisper.cpp/build"` and (if `--all`)
  the source clone.
- For gigaam: `rm -rf "$CACHE/models/gigaam-*"`. The uv venv is
  managed by uv itself; reinstall does `uv tool uninstall` + reinstall
  if needed, but only when `--all` is passed (the venv is shared
  across all gigaam variants).

Routes through the same subcommand dispatcher as `setup`. Implementation
is `scripts/reinstall.sh` (small) or — preferable — a flag on the
existing orchestrator: `bash setup-all.sh --wipe --with <name>`.
Then `transcribe reinstall <name>` is a thin alias.

### 6.5. Knock-on changes

- **`src/cli.ts`**: new `reinstall` subcommand in the route table;
  new `--auto-install` / `--no-auto-install` / `TRANSCRIBE_AUTO_INSTALL`
  env support; missing-engine guard before dispatching to
  `engine.transcribe()`.
- **`src/engines/types.ts`**: add `checkReady(opts): ReadinessReport`
  to the Engine interface. Each engine implements it (file/dir
  existence checks; no spawning).
- **`src/engines/{mlx,cpp,gigaam}.ts`**: implement `checkReady`. The
  existing `MissingLocalModelError` / `MissingGigaAmModelError` /
  `whisperBinaryPath()` throw paths become the **fallback** for when
  the prompt is declined or unavailable.
- **`scripts/setup-all.sh`**: parse `--with` / `--full` / `--clean` /
  `--force` / `--wipe`; default `INSTALL_SET` shrinks to
  `mlx,antony66`; honor deprecated `--no-*` flags with a deprecation
  notice on stderr.
- **`scripts/convert-hf-to-mlx.sh`**: new sanity-check + cleanup
  step. `TRANSCRIBE_KEEP_HF` opt-out.
- **`scripts/setup-cpp.sh`**: post-build cleanup of CMake objects.
  `TRANSCRIBE_KEEP_BUILD` opt-out.
- **`README.md`**: `transcribe setup` quickstart shrinks to "~6 GB,
  ~8 min" with `--with` and `--full` as the documented escape
  hatches. Troubleshooting gains "I want everything back" →
  `transcribe setup --full`.
- **`CHANGELOG.md` `0.2.0`**: behavioral-change entry under
  "Changed", deprecation entry under "Deprecated", auto-cleanup +
  reinstall verb under "Added".

### 6.6. Pros and Cons

**Pros:**
- New users get from `bun add -g` to "working transcript" in
  ~8 minutes and ~6 GB instead of 30 minutes and 20 GB.
- Opt-in engines are still one prompt away — discoverability is
  preserved.
- `reinstall` removes the only `rm -rf` operation we currently
  ask users to do by hand.

**Cons:**
- Behavioral break on the install command. Mitigated by docs + the
  deprecated `--no-*` aliases.
- Auto-cleanup is irreversible (the `-hf` source is gone). Reinstall
  re-downloads when needed. Sanity check before deletion is the
  guardrail.
- New surface to test (readiness checks, TTY/no-TTY prompt
  branches, `--with`/`--full`/`--clean` parsing).

**Consequences:**
- Eventually drop the `--no-*` flags entirely (in `v0.3.x` or
  `v1.0.0`).
- `engine.checkReady()` becomes a reusable primitive — any future
  surface that wants to ask "is this engine ready?" gets it for free.
- The README badge for "~20 GB total" goes away; the prose updates
  to "~6 GB default, ~20 GB with everything".

## 7. Testing Strategy

### 7.1. Unit tests (pure)

- `src/cli.test.ts`:
  - New `reinstall` subcommand in `routeArgs`: `transcribe reinstall`,
    `transcribe reinstall antony66`, `transcribe reinstall --all`.
  - `parseArgs` rejects `--with` on the transcribe path
    (it's a setup-only flag).
  - `--auto-install` / `--no-auto-install` parse + propagate.
- `src/engines/{mlx,cpp,gigaam}.test.ts`:
  - `checkReady()` pure: returns the right shape given file
    existence (use tmp dirs); doesn't spawn anything.
  - Per-engine: setup-cmd suggestion is correct
    (`transcribe setup --with gigaam`, etc.).
- `src/install-prompt.test.ts` (new file):
  - TTY-vs-not branching: pure decision function takes a
    `{isTty, env, flags}` object and returns `{action: "prompt" | "fail-fast" | "skip"}`.
  - `TRANSCRIBE_AUTO_INSTALL=0` → fail-fast.
  - `--no-auto-install` → fail-fast.
  - `--auto-install` + non-TTY → still fail-fast (user must
    explicitly accept; non-interactive contexts shouldn't side-effect).
- `src/setup-args.test.ts` (new file, mirrors the bash parser as a
  pure TS function for testability):
  - `--with cpp --with gigaam` → install set `{mlx, antony66, cpp, gigaam}`.
  - `--full` → install set with everything.
  - `--no-cpp` → deprecation notice + install set with cpp removed
    (treated as `--full --no-cpp` equivalently).
  - Conflicting flags: `--with cpp --no-cpp` → error.

### 7.2. Integration / smoke

- Manual: on the author's machine, `transcribe setup --clean` is a
  no-op the second time (idempotence).
- Manual: on a clean Mac (T29-from-publish was the original gate),
  `transcribe setup && transcribe sample-ru.m4a` finishes in
  ~10 minutes and `du -sh ~/Library/Caches/transcribe` is ~6 GB.
- Manual: `transcribe sample-ru.m4a --engine gigaam` in an
  interactive shell → prompt appears → Y installs → transcription
  completes.
- Manual: same command piped to a file → no prompt, exit 1, install
  hint in stderr.

### 7.3. Things explicitly NOT tested in unit tests

- Real engine spawns (same posture as the existing 83 tests).
- Real `bun add -g` / network behavior.
- TTY readline interaction (we test the decision function, not the
  `process.stdin` reader).

## 8. Definition of Done

### Universal

- [ ] `bun run test` passes (existing 83 + new readiness / setup-args / prompt-decision tests; expect +20-30 tests)
- [ ] `bun run typecheck` clean
- [ ] Spec field findings appended (if any)

### Feature-Specific

- [ ] `scripts/setup-all.sh` default install set shrinks to `mlx + antony66`; `--with`, `--full`, `--clean`, `--force`, `--wipe` work
- [ ] `scripts/convert-hf-to-mlx.sh` deletes `-hf` after a passing sanity check; `TRANSCRIBE_KEEP_HF=1` opts out
- [ ] `scripts/setup-cpp.sh` cleans CMake intermediates after a passing build; `TRANSCRIBE_KEEP_BUILD=1` opts out
- [ ] `src/cli.ts` routes `reinstall`, gates `transcribe` on readiness check, runs the install prompt on miss when TTY
- [ ] `src/engines/types.ts` Engine interface adds `checkReady`; each engine implements it
- [ ] Deprecated `--no-*` flags still parse and behave as documented; deprecation notice printed
- [ ] README + CHANGELOG updated for the v0.2.0 behavioral changes
- [ ] `specs/README.md` index updated

## 8.5. Execution Plan

| ID  | Task                                                                                                         | Est.  | Deps  |
| --- | ------------------------------------------------------------------------------------------------------------ | ----- | ----- |
| T1  | `src/engines/types.ts`: add `ReadinessReport` + `checkReady()` to Engine interface                           | 15 m  | —     |
| T2  | Implement `checkReady` for mlx engine + tests                                                                | 30 m  | T1    |
| T3  | Implement `checkReady` for cpp engine + tests                                                                | 30 m  | T1    |
| T4  | Implement `checkReady` for gigaam engine + tests                                                             | 30 m  | T1    |
| T5  | `src/install-prompt.ts`: pure decision function + tests                                                      | 45 m  | —     |
| T6  | `src/setup-args.ts`: pure parse-flags → install-set function + tests (mirrors the bash parser)               | 45 m  | —     |
| T7  | `src/cli.ts`: integrate readiness check + prompt into transcribe flow; add `--auto-install` / `--no-auto-install` | 1 h   | T2, T3, T4, T5 |
| T8  | `src/cli.ts`: add `reinstall` route + tests                                                                  | 30 m  | —     |
| T9  | `scripts/setup-all.sh`: rewire to default `mlx,antony66`; implement `--with`, `--full`, `--clean`, `--force`, `--wipe`; deprecation notice for `--no-*` | 1.5 h | T6    |
| T10 | `scripts/convert-hf-to-mlx.sh`: sanity-check + `-hf` cleanup                                                  | 30 m  | T9    |
| T11 | `scripts/setup-cpp.sh`: post-build cleanup                                                                    | 20 m  | T9    |
| T12 | `scripts/reinstall.sh` (or thin alias inside setup-all.sh): wipe semantics                                    | 30 m  | T9    |
| T13 | README: shrink quickstart to minimal default; document `--with`, `--full`, `reinstall`, env vars              | 45 m  | T9    |
| T14 | CHANGELOG `0.2.0`: Changed / Added / Deprecated sections                                                     | 15 m  | T13   |
| T15 | Manual smoke on a fresh Mac (or a `rm -rf ~/Library/Caches/transcribe` reset): default ≤ 6 GB, ≤ 10 min       | 45 m  | T9–T14|

**~9 h of work.** Heaviest unknowns: (a) the right sanity-check
thresholds for the `-hf` cleanup (we may need to be paranoid the
first month), (b) whether `--no-*` deprecation should be loud (stderr
warning) or silent (just a docs note).

## 9. Alternatives Not Chosen

- **Drop bond005 from the engines list entirely.** Tempting (it's
  the rarest use case) but breaking. Keep it; just don't install by
  default.
- **Lazy-load model files at first `transcribe foo.m4a` use.**
  Would make `setup` near-instant but moves the long wait into the
  first transcribe command. Bad UX for the user who didn't know that
  command would download 6 GB.
- **Cache deduplication via hard links between `-hf` and `-mlx`
  dirs.** Saves the ~3 GB without deleting source. Too clever; the
  source files (`pytorch_model.bin`) and the MLX weights
  (`weights.safetensors`) aren't byte-identical anyway.
- **Make `--auto-install` the on-by-default behavior even in
  non-TTY contexts.** Hostile for CI ("CI accidentally downloaded
  6 GB of models"); strict TTY check is the right default.
- **A whole-package reinstall verb (`transcribe reinstall self`)
  that does `bun update -g @ilyavorobiev/transcribe`.** Out of
  scope; that's a package-manager concern, not an engine concern.

## 10. References

- Current setup orchestrator: `scripts/setup-all.sh`
- Conversion script (target of cleanup): `scripts/convert-hf-to-mlx.sh`
- Existing engine interface: `src/engines/types.ts`
- Cache-dir resolution: `src/paths.ts` (introduced in
  [`../publish/spec.md`](../publish/spec.md) §6.6)

## 11. Open Questions

1. **`--no-*` deprecation timeline.** Print a one-line stderr
   warning in 0.2.0; remove the flags in 0.3.x or 1.0.0? Reflexively
   I'd say "remove in 1.0.0 to give the deprecation a long runway".
2. **What does "antony66" mean as a `reinstall` arg name?**
   Options: `antony66`, `antony66-russian` (matches the alias),
   `mlx-antony66` (engine-prefixed). The existing alias system
   already calls it `antony66-russian` — match that for
   consistency.
3. **Should there be a `transcribe cleanup` subcommand separate from
   `transcribe setup --clean`?** Same operation; question is
   discoverability. Suggestion: alias only (the `setup --clean` form
   is documented; `cleanup` is a hidden alias). Decide at
   implementation time.
4. **Auto-install prompt wording.** "[Y/n]" assumes uppercase-Y is
   accept; common but not universal. Spell it out: "Install now?
   (yes/no) [yes]". Verbose but unambiguous.
5. **Sanity-check thresholds for `-hf` cleanup.** First implementation:
   - `weights.safetensors` ≥ 50 MB.
   - `config.json` parseable JSON with `model_type == "whisper"`.
   - No `pytorch_model.bin` in the MLX dir.
   Tighten or relax based on field findings during T15.
6. **Auto-cleanup of HF source after `bond005` conversion.** Same
   rules as antony66, but bond005 is rarer; should the cleanup be
   delayed until the user confirms the model works? Probably no —
   reinstall is fast enough to be the recovery path.
