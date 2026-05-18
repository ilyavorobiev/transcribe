# MCP server + Claude plugin for `transcribe` — Technical Specification

## 1. Meta Information

- **Branch:** main
- **Epic:** v0.2.0 — expose `transcribe` as an MCP tool surface, ship as a Claude Code plugin
- **PRD:** N/A (personal OSS continuation of `transcribe`)
- **Status:** Proposed (exploratory). Open questions in §11.

## 2. Context

### 2.1. The ask

> I want a plugin. MCP that is using local host to transcribe files. Is it
> possible?

Short answer: **yes, with one important caveat about which Claude
product can talk to localhost**. This spec lays out the landscape, the
proposed solution, and the constraints.

### 2.2. The Claude product landscape (relevant bits)

There are three Anthropic products a user might call "Claude", and they
differ in how they talk to MCP servers:

| Product                  | MCP transport(s) supported               | Can reach `localhost`?              |
| ------------------------ | ---------------------------------------- | ----------------------------------- |
| **Claude Code** (this CLI) | stdio (subprocess) + HTTP/SSE (remote)  | ✅ stdio is *the* common pattern    |
| **Claude Desktop** (Mac)   | stdio (subprocess) + HTTP/SSE           | ✅ stdio                            |
| **claude.ai** (the web app) | HTTPS only (Custom Connectors)        | ❌ no — claude.ai's *server* makes the connection, not your browser |

The user said "plugin for claude.ai". The honest answer is that
**claude.ai (the web app) cannot reach `localhost`** — its inference
runs on Anthropic's servers, and any "Custom Connector" they add must
be a publicly-reachable HTTPS endpoint. There's no "the browser proxies
the connection" trick (CORS / connector-architecture both block it).

The path that actually delivers "MCP + localhost transcription" is
**Claude Code** (which the user is using right now, in this very
conversation) or **Claude Desktop**. Both run as local processes that
spawn an MCP server as a child process over stdio. Audio files on the
user's disk are reachable. No tunnel, no public URL, no upload.

This spec proposes Claude Code (and by extension Claude Desktop, which
uses the same MCP server) as the primary target. claude.ai-the-web-app
gets a deferred follow-up (§5.3) that requires an HTTPS tunnel and is
appropriately caveated.

### 2.3. Why this is worth building

`transcribe` already does the hard work: 3 engines, anti-hallucination
tuning, cache-dir hygiene, language-aware defaults. The current
surface is a CLI that a user invokes from a shell. An MCP wrapper would
let Claude (in any local-MCP product) do things like:

- "Transcribe `~/Downloads/standup-2026-05-15.m4a` in Russian and
  summarize the action items." — Claude calls `transcribe_audio` via
  MCP, gets the transcript text back, then summarizes natively.
- "Diff the transcripts of these two meetings." — multi-step workflow
  where the transcripts are intermediate values, not final products.
- "Transcribe this voice memo using both mlx-antony66 and gigaam, then
  tell me which one preserved acronyms better." — A/B comparison that
  was theoretically possible before via separate `transcribe` runs but
  is now a single LLM-orchestrated task.

The combination — Claude orchestrating + local engines doing the audio
work + no network — is the value. Cloud APIs (OpenAI Whisper API,
AssemblyAI, etc.) can do step 1 alone but lose the privacy/cost story.

## 3. Key Technical Drivers

- **D1 — Local-first, network-free transcription.** Audio never leaves
  the user's machine. The MCP server spawns the existing `transcribe`
  CLI, which spawns the existing engines (mlx-whisper / whisper-cli /
  gigaam_transcribe.py). Same offline guarantees as the CLI today.
- **D2 — Zero new heavy dependencies.** No web server, no Python web
  framework, no Docker. The MCP server is a small TypeScript/Bun
  process started by the host. Same runtime constraint as the CLI.
- **D3 — Survive `bun update -g`.** Same cache-dir story as
  `specs/publish/spec.md` §6.6. The MCP server should resolve paths
  through the existing `src/paths.ts` resolver so no duplicate
  config story.
- **D4 — Self-contained packaging.** A user should be able to install
  the plugin in Claude Code with a single `/plugin install` (after
  optionally `bun add -g @ilyavorobiev/transcribe` and
  `transcribe setup`). No manual JSON-editing of
  `~/.claude.json` / `claude_desktop_config.json` unless they want to.
- **D5 — Tool surface that a model can use well.** Tool descriptions
  must be specific enough that Claude picks them up without prompting
  contortions. Returns the *transcript content* (not just a file
  path) so the model can act on it immediately.
- **D6 — Reuse, don't re-architect.** The CLI is the production-tested
  interface. The MCP server should shell out to it — not re-implement
  engine dispatch in a parallel codebase that drifts.

## 4. Current State

### 4.1. What exists

- `@ilyavorobiev/transcribe@0.1.0` is live on npm
  (see `specs/publish/spec.md`).
- CLI surface: `transcribe <file> [options]`,
  `transcribe setup[:mlx|:cpp]`, `transcribe --version | --help`.
- Engine interface (`src/engines/types.ts`) with three implementations
  (`cpp.ts`, `mlx.ts`, `gigaam.ts`).
- Pure argv builders + 83 unit tests.
- Cache dir at `~/Library/Caches/transcribe/` (overridable).

### 4.2. What doesn't exist yet

- No programmatic library export. `package.json` `bin` is the entry;
  there is no `import { transcribe } from "..."`. This is deliberate
  (see `specs/publish/spec.md` §9 / "Don't add a programmatic library
  export" in AGENTS.md).
- No MCP server, no plugin manifest.
- No JSON output of a finished transcript with metadata bundled (text,
  duration, language, model used). The CLI writes text to a file; the
  caller reads it back.

### 4.3. MCP server-side primitives in scope

- Anthropic publishes an official MCP SDK for TypeScript
  (`@modelcontextprotocol/sdk`) which gives us `Server` + `StdioServerTransport`
  in maybe ~30 lines of glue.
- stdio transport is what Claude Code / Claude Desktop launch by
  default. The host sends JSON-RPC over stdin/stdout; the server
  responds. No port, no TLS, no auth — the host *is* the security
  boundary.

## 5. Considered Options

### 5.1. Option 1 (CHOSEN) — Claude Code plugin bundling a local stdio MCP server

- **Description:** Add a small TS file `src/mcp/server.ts` that
  implements an MCP server exposing tools that wrap the CLI. Ship a
  Claude Code plugin manifest (`plugin.json` + `mcpServers` entry)
  that registers the server. Server is started by Claude Code as a
  child process; communication via stdio. Plugin distributed via a
  GitHub-based marketplace (same repo as `transcribe`).
- **Pros:**
  - True localhost: audio file paths are valid on both sides because
    "both sides" is the same machine.
  - No tunnel, no public URL, no auth surface to harden.
  - Same trust model as the CLI: the user already trusts the binary
    they `bun add -g`'d; the MCP server is the same code.
  - One-command install for the user (`/plugin install …`).
  - Works in Claude Code and Claude Desktop with the same `plugin.json`.
- **Cons:**
  - Doesn't help claude.ai-the-web-app users. (See §5.3.)
  - Requires the user to have installed the CLI globally first
    (`bun add -g @ilyavorobiev/transcribe && transcribe setup`).
    Documented; non-trivially solvable.

### 5.2. Option 2 — claude.ai Custom Connector (HTTPS, public URL)

- **Description:** Implement the MCP server with **streamable HTTP**
  transport, deploy it to a public HTTPS endpoint, register it as a
  Custom Connector in claude.ai → Settings.
- **Pros:**
  - Works in the web app, no local Claude install needed.
- **Cons:**
  - Defeats the local-first design driver — audio files would need
    to be uploaded to the server before transcription. That's the
    cloud-API story the project explicitly avoided.
  - Operational cost (a server that has to be up).
  - Auth surface (OAuth / API keys; the connector isn't anonymous).
  - Per-user storage / GPU / model footprint on the server. Doesn't
    scale within a single hobbyist's budget.
- **Verdict:** Rejected as the primary path. **Not actually a
  "localhost" solution**, despite what one might read into the user's
  ask. Re-listed as a deferred follow-up in §5.3.

### 5.3. Option 3 (FUTURE) — Hybrid: Option 1 + tunnel adapter for claude.ai

- **Description:** Same Option 1 stdio MCP server, but also include a
  `transcribe mcp serve --http --port <n>` subcommand that runs the
  server over streamable HTTP. The user can then tunnel it via
  `cloudflared tunnel` / `ngrok http <port>` and register the public
  URL as a Custom Connector. Audio files stay on the user's machine
  (since the server still spawns local engines), only the tool-call
  RPC traverses the tunnel.
- **Pros:**
  - Single codebase serves all three Claude products.
  - Still local-first: audio doesn't leave the machine.
- **Cons:**
  - Auth: a public URL pointing at the user's machine is not
    something to wave at the internet. Needs token auth or strict
    origin checks.
  - Tunnel UX is non-trivial (cloudflared / ngrok config, deciding
    which audio paths to expose).
  - Path translation: claude.ai sends `~/Desktop/foo.m4a`, which is
    only meaningful on the user's machine — the LLM has to know that.
    Solvable, but a new failure mode.
  - Doesn't unblock anyone in the short term — Option 1 covers the
    Claude Code + Claude Desktop majority.
- **Verdict:** Defer. Spec it as `specs/mcp-tunnel/` in v0.3.x if
  there's a real user with this need.

### 5.4. Comparison

| Driver / Criterion          | Opt 1 (Code plugin, stdio) | Opt 2 (HTTPS, cloud) | Opt 3 (Hybrid + tunnel) |
| --------------------------- | -------------------------- | -------------------- | ----------------------- |
| Local-first (D1)            | +                          | −                    | + (audio stays local)   |
| Zero new heavy deps (D2)    | +                          | −                    | ~ (tunnel binary)       |
| Cache-dir reuse (D3)        | + (same `src/paths.ts`)    | n/a                  | +                       |
| Self-contained install (D4) | + (one `/plugin install`)  | ~ (server + creds)   | − (tunnel setup)        |
| Tool surface (D5)           | + (full)                   | + (full)             | + (full)                |
| Reuse the CLI (D6)          | + (shell out)              | + (shell out)        | + (shell out)           |
| Works with claude.ai-web    | −                          | +                    | + (with tunnel)         |
| Time to ship                | ~ 1 day                    | ~ 1 week + ops       | ~ 2 weeks               |

## 6. Proposed Solution

### 6.1. Architecture

```
┌────────────────────┐    stdio   ┌─────────────────────┐    spawn   ┌─────────────┐
│  Claude Code  /    │◀──────────▶│  transcribe MCP     │───────────▶│  transcribe │
│  Claude Desktop    │  JSON-RPC  │  server (TS / Bun)  │  argv      │  CLI        │
└────────────────────┘            └─────────────────────┘            └─────────────┘
                                          │                                  │
                                          │  read transcript file            │  spawn mlx_whisper /
                                          │  resolve via src/paths.ts        │  whisper-cli /
                                          ▼                                  ▼  gigaam_transcribe.py
                                  return {text, format, model, language, durationSec}
```

The MCP server is a *thin* layer: it accepts a JSON-RPC tool call,
maps it to a `transcribe` argv invocation, spawns the existing CLI,
waits for the output file to land, reads it, returns the contents to
Claude. No engine logic in the MCP server.

### 6.2. New files

```
src/
  mcp/
    server.ts         # MCP Server + StdioServerTransport entry
    tools.ts          # Tool definitions (handlers, schemas) — pure & tested
    tools.test.ts     # Unit tests for the pure tool handlers
    invoke.ts         # spawnTranscribe(argv): {stdout, stderr, code} wrapper
    invoke.test.ts    # Mocked-spawn tests
plugin/
  plugin.json         # Claude Code plugin manifest (name, version, mcpServers)
  README.md           # Plugin install + usage (1 page)
specs/
  mcp-plugin/spec.md  # this file
```

`bin` in `package.json` grows a second entry:

```json
"bin": {
  "transcribe": "./src/cli.ts",
  "transcribe-mcp": "./src/mcp/server.ts"
}
```

So after `bun add -g @ilyavorobiev/transcribe`, the user has both
binaries on PATH. The plugin manifest references `transcribe-mcp` for
its MCP server entry.

### 6.3. MCP tool surface

Three tools, all pure JSON in / JSON out:

#### 6.3.1. `transcribe_audio`

```jsonc
{
  "name": "transcribe_audio",
  "description": "Transcribe an audio file on the user's local machine using the `transcribe` CLI. Returns the transcript text directly so the model can act on it. Supports Russian (default), English, and ~99 other languages via Whisper. The audio file must already be on disk — pass an absolute path or a path the user just referenced.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "file_path": {
        "type": "string",
        "description": "Absolute path to the audio file (m4a/mp3/mp4/wav/aac/flac/ogg). Tilde-expansion is performed server-side."
      },
      "language": {
        "type": "string",
        "default": "ru",
        "description": "ISO language code. 'ru' (default) routes to the Russian fine-tune on the mlx engine."
      },
      "engine": {
        "type": "string",
        "enum": ["mlx", "cpp", "gigaam"],
        "default": "mlx",
        "description": "mlx = default (Russian fine-tune or stock multilingual). cpp = whisper.cpp (offline-strict, no Python). gigaam = Sber GigaAM-v3 (Russian-only, opt-in 2nd-opinion engine)."
      },
      "model": {
        "type": "string",
        "description": "Engine-specific model alias or HuggingFace repo id. Optional — sensible default selected per (engine, language)."
      },
      "prompt": {
        "type": "string",
        "description": "Initial prompt for vocabulary biasing (mlx/cpp only). Useful for technical / domain-specific acronyms."
      }
    },
    "required": ["file_path"]
  }
}
```

Returns:

```jsonc
{
  "text": "...",                     // the transcript content (txt format)
  "engine_used": "mlx",
  "model_used": "antony66-russian",
  "language": "ru",
  "duration_sec": 387.4,             // input audio duration via ffprobe (already used by audio.ts)
  "output_file": "/Users/.../memo.txt"
}
```

`text` is the actual content, not a pointer. This is the contract that
makes the tool model-friendly: the LLM doesn't have to fire a second
"read this file" tool to act on the result.

#### 6.3.2. `list_engines`

Returns the three engines, whether each is "ready" (binary + default
model present in the cache dir), and the setup command to fix any that
aren't. Lets Claude diagnose its own broken environment ("Looks like
gigaam isn't installed; run `transcribe setup` first").

#### 6.3.3. `transcribe_setup_status`

Lightweight: reports cache dir, disk free, which engines + models are
on disk. Lets Claude answer "is transcribe ready?" without spawning
anything.

### 6.4. Plugin manifest

```jsonc
// plugin/plugin.json
{
  "name": "transcribe",
  "version": "0.2.0",
  "description": "Local offline transcription for Claude Code / Desktop. Three engines, Russian-optimized.",
  "author": "Ilya Vorobiev",
  "homepage": "https://github.com/ilyavorobiev/transcribe",
  "mcpServers": {
    "transcribe": {
      "command": "transcribe-mcp",
      "args": [],
      "env": {}
    }
  }
}
```

The plugin assumes `transcribe-mcp` is on PATH, i.e. the user ran
`bun add -g @ilyavorobiev/transcribe` first. Plugin README documents
this as the prerequisite.

### 6.5. Distribution

Two layers:

1. **npm**: the `@ilyavorobiev/transcribe` package gains the
   `transcribe-mcp` bin. Existing users `bun update -g` to pick it up.
2. **Claude plugin marketplace**: register the GitHub repo as a
   marketplace
   (`/plugin marketplace add ilyavorobiev/transcribe`), then
   `/plugin install transcribe@ilyavorobiev/transcribe`. The plugin
   manifest lives under `plugin/` in the same repo.

Users on Claude Desktop (no marketplace UI today) get hand-installation
instructions in the plugin README: append the `mcpServers` block to
`~/Library/Application Support/Claude/claude_desktop_config.json`.

### 6.6. Pros and Cons of the chosen path

**Pros:**
- Reuses the entire engine architecture; the MCP layer is ~150 lines.
- Local-first preserved: same offline guarantee as the CLI.
- Single source of truth for engine behavior (the CLI). No drift risk.
- Claude can chain transcription with summarization, translation,
  diffing — multiplies the value of `transcribe`.
- Works in Claude Code (this CLI) and Claude Desktop with the same
  artifact.

**Cons:**
- Doesn't help claude.ai-web users — they need Option 3, which is
  deferred.
- Spawning the CLI as a subprocess is slower than calling an engine
  function in-process (cold start ~50–200 ms for Bun, plus engine
  startup which is the real cost). Acceptable for transcription
  workloads (engines take seconds to minutes anyway).
- Adds a second public surface (the MCP tool schema) to maintain
  alongside the CLI flags. Any new CLI flag worth exposing to Claude
  needs a parallel schema field.

**Consequences:**
- Plugin marketplace presence = more discoverability = more drive-by
  users who haven't run `transcribe setup`. The `list_engines` /
  `transcribe_setup_status` tools matter for those users — they let
  Claude diagnose and recover gracefully instead of failing inside
  `transcribe_audio`.
- The pin policy (`transformers>=4.40,<4.50` for gigaam, etc.) still
  applies and is still a real CHANGELOG entry.
- If we later add Option 3 (tunnel), we'll need to write the auth
  story carefully. Don't pre-design it.

## 7. Testing Strategy

### 7.1. Unit tests

- `src/mcp/tools.test.ts`:
  - Tool-schema serialization shape matches MCP spec.
  - `transcribe_audio` handler: given mocked spawn output, returns the
    expected `{text, engine_used, ...}` JSON.
  - Error paths: missing file → MCP error response with the same
    message text the CLI emits.
  - Tilde expansion.
- `src/mcp/invoke.test.ts`:
  - Argv construction (engine / model / language / prompt flags →
    correct CLI argv).
  - Exit-code propagation (spawned CLI exit 1 → MCP error).
- All tests pure — no spawning of the real CLI or any engine. Same
  testing posture as the existing 83 tests.

### 7.2. Integration tests

- **Manual smoke**: launch `transcribe-mcp` interactively, send it a
  hand-rolled JSON-RPC `initialize` then `tools/list` then
  `tools/call`, verify the response. Documented in CONTRIBUTING.md as
  a release step. Not in CI (would require an installed engine + a
  sample audio file).
- **Claude Code roundtrip**: register the plugin in a dev profile,
  ask Claude to transcribe a known fixture. Pass = "Claude calls the
  tool and reports the right text". Manual; documented in the plugin
  README.

## 8. Definition of Done

### Universal

- [ ] `bun run test` passes (existing 83 + new tool/invoke tests)
- [ ] `bun run typecheck` clean
- [ ] Spec updated with field findings (if any)

### Feature-Specific

- [ ] `src/mcp/{server,tools,invoke}.ts` + tests
- [ ] `package.json` `bin` adds `transcribe-mcp`
- [ ] `plugin/plugin.json` valid against Claude Code plugin schema
- [ ] `plugin/README.md` covers: install (CLI prereq), Claude Code
      plugin install, Claude Desktop manual install, troubleshooting
- [ ] Smoke test: launch `transcribe-mcp`, JSON-RPC `tools/list`
      returns 3 tools; `tools/call transcribe_audio` against a
      bundled fixture returns the expected text
- [ ] CHANGELOG entry under `0.2.0`
- [ ] `specs/README.md` index updated

## 8.5. Execution Plan

| ID  | Task                                                                                       | Est.  | Deps    |
| --- | ------------------------------------------------------------------------------------------ | ----- | ------- |
| R1  | Research: confirm exact Claude Code plugin manifest format (look at one or two existing plugins; verify `mcpServers` key shape). Spike with the official MCP TS SDK. | 1 h   | —       |
| T1  | Add `@modelcontextprotocol/sdk` as a runtime dep (first runtime dep — note in CONTRIBUTING.md pin-policy) | 15 m  | R1      |
| T2  | `src/mcp/invoke.ts` + tests — pure argv builder + spawn wrapper                            | 1 h   | R1      |
| T3  | `src/mcp/tools.ts` + tests — pure tool handlers wrapping invoke                            | 1.5 h | T2      |
| T4  | `src/mcp/server.ts` — wire StdioServerTransport, register tools                            | 1 h   | T3      |
| T5  | `package.json` — add `transcribe-mcp` bin, update files allowlist                          | 10 m  | T4      |
| T6  | `plugin/plugin.json` + `plugin/README.md`                                                  | 1 h   | T4      |
| T7  | Smoke test via hand-rolled JSON-RPC (documented in CONTRIBUTING.md)                         | 30 m  | T5, T6  |
| T8  | Claude Code roundtrip test (manual): install plugin, transcribe a fixture                  | 30 m  | T5, T6  |
| T9  | Bump version to 0.2.0, CHANGELOG, README ("MCP plugin" section), publish via `git tag v0.2.0` | 30 m  | T7, T8 |
| T10 | Update `specs/README.md` + `specs/mcp-plugin/spec.md` field findings                       | 15 m  | T9      |

**~7 h of work.** R1 is the unknown — the Claude Code plugin manifest
schema might require nuances the spec doesn't capture; budget more if
the spike surfaces surprises.

## 9. Alternatives Not Chosen

- **Re-implement engine dispatch in the MCP server.** Tempting for
  cold-start latency, but the CLI is the production-tested path.
  Drift between two implementations would be a long-term tax.
- **Use HTTP transport for the local case.** stdio is the path of
  least resistance for Claude Code / Desktop and avoids deciding on a
  port. Reserved for the tunnel case (§5.3).
- **Bundle a tiny Whisper model in the plugin** so the user doesn't
  need to run `transcribe setup`. Same blocker as the CLI: even
  `tiny` is ~75 MB and quality is bad for Russian. Setup is the
  honest path.
- **Programmatic library export** (`import { transcribe } from ...`)
  so the MCP server uses in-process calls. AGENTS.md and the publish
  spec explicitly punted this for v0.1. Revisit if cold-start latency
  becomes a complaint.
- **Auto-detect the user's audio files** (e.g. scan `~/Voice Memos`).
  Out of scope; the user always identifies the file in the prompt.
  Auto-discovery is a different feature.

## 10. References

- Model Context Protocol spec: <https://modelcontextprotocol.io>
- MCP TypeScript SDK: <https://github.com/modelcontextprotocol/typescript-sdk>
- Claude Code plugin docs (verify exact format in R1):
  <https://docs.claude.com/en/docs/claude-code/plugins>
- Claude Desktop MCP config docs:
  <https://docs.claude.com/en/docs/agents-and-tools/mcp-servers>
- Claude.ai Custom Connectors:
  <https://support.anthropic.com/en/articles/connectors>
- Existing specs to reuse patterns from:
  - [`../publish/spec.md`](../publish/spec.md) — packaging + cache-dir story
  - [`../gigaam/spec.md`](../gigaam/spec.md) — opt-in engine, field-findings layout

## 11. Open Questions

1. **R1 finding-pending**: What does a valid Claude Code plugin
   `plugin.json` look like in 2026-05? The schema has shifted across
   minor versions; we should spike against the current one before
   committing to the field names in §6.4.
2. **Tool-result size limits**: MCP tool responses have practical size
   limits in Claude clients (~25 KB last I checked). A 60-minute
   transcript can be 30 KB+. Do we (a) chunk the response, (b) save
   to file and return a path, (c) return both first-N-chars +
   path? Probably (c) but worth confirming once we test with a long
   recording.
3. **Naming the plugin**: `transcribe` (matches the CLI) or
   `transcribe-mcp` (matches the bin)? Marketplace search and the
   `/plugin install` UX argue for a friendly name. Default
   recommendation: plugin name = `transcribe`, bin name =
   `transcribe-mcp`, npm package name unchanged.
4. **Audio-file path resolution**: how the MCP server handles tilde,
   relative paths, and "the file the user just dragged into Claude
   Desktop". Test against real-world ask styles before locking the
   handler.
5. **Should we ship this in v0.2.0 or as a separate
   `@ilyavorobiev/transcribe-mcp` package?** Same-package is simpler
   for the user (one install). Separate-package gives independent
   versioning. Current recommendation: same-package, but revisit if
   the MCP surface starts evolving on its own cadence.
