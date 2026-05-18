#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { cppEngine } from "./engines/cpp.ts";
import { GIGAAM_SUPPORTED_FORMATS, gigaamEngine } from "./engines/gigaam.ts";
import { mlxEngine } from "./engines/mlx.ts";
import {
  ENGINES,
  FORMATS,
  type Engine,
  type EngineName,
  type Format,
  type ReadinessMissing,
} from "./engines/types.ts";
import { PROJECT_ROOT } from "./paths.ts";
import { decideInstallAction } from "./install-prompt.ts";

const TRANSCRIBE_FLAGS_HELP = `Options:
  --engine <name>    mlx | cpp | gigaam              (default: mlx)
  --model <name>     engine-specific model alias or HuggingFace repo id
  --format <fmt>     txt | srt | vtt | json | all   (default: txt)
  --output <file>    output file path                (default: <input-stem>.<ext> next to input)
  --language <code>  ISO language code               (default: ru)
  --prompt <text>    initial prompt (mlx/cpp only — vocabulary biasing)
  --threads <n>      decoder threads (cpp engine only; default: min(cpus, 8))
  --keep-wav         retain the intermediate 16kHz WAV (cpp engine only)
  --auto-install     prompt to install missing engine if not ready (default on TTY)
  --no-auto-install  fail-fast on missing engine (default in scripts / non-TTY)
  -h, --help         show this help

Default model selection (when --model is omitted):
  --engine mlx + --language ru     → antony66-russian   (Russian fine-tune)
  --engine mlx + --language <other> → large-v3           (stock multilingual)
  --engine cpp                     → large-v3            (ggml file)
  --engine gigaam                  → gigaam-v3           (RNN-T head)

Engine quick reference:
  mlx (default) — Apple Silicon native via mlx-whisper. Multilingual.
                  Russian fine-tune antony66 produces the most readable
                  output in our benchmarks.
                  Requires: 'transcribe setup' (uv + mlx-whisper + model).
  cpp     — whisper.cpp built from source. Offline-strict, no Python,
            richer VAD knobs, cross-platform-friendly.
            Requires: 'transcribe setup:cpp' (cmake + ffmpeg + ggml model).
  gigaam  — Sber GigaAM-v3 (Russian-only). Native Latin char output for
            "MCP"/"API". Strong on CV-ru benchmarks but didn't clearly
            beat antony66 on our 48-min PRD memo (similar acronym
            preservation, single-paragraph output is less readable).
            Use for a second-opinion run or future LLM-vote post-correction.
            Requires: 'transcribe setup' (uv + torch + transformers + model).
            Limitation: txt/json formats only in v1.
`;

const HELP = `transcribe — offline transcription on macOS (mlx | cpp | gigaam)

USAGE
  transcribe <file.m4a> [options]
                                    transcribe one audio file
  transcribe setup [--with cpp|--with gigaam|--with bond005|--full]
                                    install engines + models (default: mlx + antony66, ~6 GB)
  transcribe setup --full           install everything (~20 GB, ~15-30 min)
  transcribe setup:mlx              install only the mlx engine
  transcribe setup:cpp              install only the cpp engine
  transcribe reinstall [<name>|--all]
                                    wipe and re-install (default: minimal set; <name> = one
                                    component; --all = everything currently installed)
  transcribe --version              print version
  transcribe --help                 show this help

${TRANSCRIBE_FLAGS_HELP}
More: https://github.com/ilyavorobiev/transcribe
`;

const TRANSCRIBE_HELP = `transcribe <file.m4a> [options]

${TRANSCRIBE_FLAGS_HELP}`;

export class UserError extends Error {}

export type AutoInstallFlag = "auto" | "no-auto" | "default";

export interface CliOptions {
  input: string;
  engine: EngineName | undefined;
  model: string | undefined;
  format: Format;
  output: string | undefined;
  language: string;
  prompt: string | undefined;
  threads: number | undefined;
  keepWav: boolean;
  autoInstall: AutoInstallFlag;
}

const SETUP_SCRIPTS = {
  "setup": "scripts/setup-all.sh",
  "setup:mlx": "scripts/setup-mlx.sh",
  "setup:cpp": "scripts/setup-cpp.sh",
} as const;

export type SubcommandName = keyof typeof SETUP_SCRIPTS;

const SUBCOMMAND_NAMES = Object.keys(SETUP_SCRIPTS) as readonly SubcommandName[];

export type Route =
  | { kind: "transcribe"; argv: readonly string[] }
  | { kind: "setup"; subcommand: SubcommandName; argv: readonly string[] }
  | { kind: "version" }
  | { kind: "help" };

// Model aliases users might type with `reinstall` — accept either the
// alias from the engine code (antony66-russian) or the install-item name
// (antony66). Map back to the canonical install item so the bash
// orchestrator sees stable names.
const REINSTALL_ALIASES: Record<string, string> = {
  "antony66-russian": "antony66",
  "antony66": "antony66",
  "bond005-turbo": "bond005",
  "bond005": "bond005",
  "mlx": "mlx",
  "cpp": "cpp",
  "gigaam": "gigaam",
  "gigaam-v3": "gigaam",
};

// reinstall <name>?  →  setup --wipe (--with name | --full)
// Pure: returns the synthesized argv for the setup script.
export function reinstallToSetupArgv(args: readonly string[]): readonly string[] {
  if (args.length === 0) return ["--wipe", "--force"];
  if (args.length === 1 && args[0] === "--all") return ["--wipe", "--force", "--full"];
  if (args.length === 1) {
    const item = REINSTALL_ALIASES[args[0]!];
    if (!item) {
      throw new UserError(
        `Unknown reinstall target: '${args[0]}'. Known: ${Object.keys(REINSTALL_ALIASES).join(", ")}, --all`,
      );
    }
    return ["--wipe", "--force", "--with", item];
  }
  throw new UserError(`reinstall takes at most one argument or --all`);
}

// Pure routing: argv[0] decides. Sub-flags pass through unchanged. We only
// intercept --version / --help at position 0 so `transcribe foo.m4a --help`
// still falls through to the per-flag help in parseArgs.
export function routeArgs(argv: readonly string[]): Route {
  const first = argv[0];
  if (first === "--version" || first === "-v") return { kind: "version" };
  if (first === "--help" || first === "-h") return { kind: "help" };
  if (first === "reinstall") {
    return {
      kind: "setup",
      subcommand: "setup",
      argv: reinstallToSetupArgv(argv.slice(1)),
    };
  }
  if (first !== undefined && (SUBCOMMAND_NAMES as readonly string[]).includes(first)) {
    return {
      kind: "setup",
      subcommand: first as SubcommandName,
      argv: argv.slice(1),
    };
  }
  return { kind: "transcribe", argv };
}

export function setupScriptPath(sub: SubcommandName): string {
  return join(PROJECT_ROOT, SETUP_SCRIPTS[sub]);
}

export function readPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf8")) as {
    version?: string;
  };
  return pkg.version ?? "0.0.0";
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const opts = {
    input: undefined as string | undefined,
    engine: undefined as EngineName | undefined,
    model: undefined as string | undefined,
    format: "txt" as Format,
    output: undefined as string | undefined,
    language: "ru",
    prompt: undefined as string | undefined,
    threads: undefined as number | undefined,
    keepWav: false,
    autoInstall: "default" as AutoInstallFlag,
  };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case "--engine": opts.engine = parseEngine(readValue(argv, ++i, a)); break;
      case "--model": opts.model = readValue(argv, ++i, a); break;
      case "--format": opts.format = parseFormat(readValue(argv, ++i, a)); break;
      case "--output": opts.output = readValue(argv, ++i, a); break;
      case "--language": opts.language = readValue(argv, ++i, a); break;
      case "--prompt": opts.prompt = readValue(argv, ++i, a); break;
      case "--threads": opts.threads = parseThreads(readValue(argv, ++i, a)); break;
      case "--keep-wav": opts.keepWav = true; break;
      case "--auto-install": opts.autoInstall = "auto"; break;
      case "--no-auto-install": opts.autoInstall = "no-auto"; break;
      case "-h":
      case "--help":
        process.stdout.write(TRANSCRIBE_HELP);
        process.exit(0);
      default:
        if (a.startsWith("--")) throw new UserError(`Unknown flag: ${a}`);
        positional.push(a);
    }
  }

  if (positional.length === 0) throw new UserError("Missing input file. Run with --help.");
  if (positional.length > 1) {
    throw new UserError(`Expected one input file, got ${positional.length}: ${positional.join(", ")}`);
  }

  const resolvedEngine = resolveEngine(opts.engine, opts.language);
  if (resolvedEngine !== "cpp" && opts.keepWav) {
    throw new UserError("--keep-wav is only supported by the cpp engine");
  }
  if (resolvedEngine !== "cpp" && opts.threads !== undefined) {
    throw new UserError("--threads is only supported by the cpp engine");
  }
  if (resolvedEngine === "gigaam" && !(GIGAAM_SUPPORTED_FORMATS as readonly Format[]).includes(opts.format)) {
    throw new UserError(
      `--format ${opts.format} is not supported by the gigaam engine (v1: txt | json). ` +
        "Use --engine mlx or --engine cpp for srt/vtt/all.",
    );
  }

  return { ...opts, input: positional[0]! };
}

function readValue(argv: readonly string[], i: number, flag: string): string {
  const v = argv[i];
  if (v === undefined) throw new UserError(`${flag} requires a value`);
  return v;
}

function parseEngine(s: string): EngineName {
  if ((ENGINES as readonly string[]).includes(s)) return s as EngineName;
  throw new UserError(`Invalid --engine: ${s} (expected one of ${ENGINES.join(", ")})`);
}

function parseFormat(s: string): Format {
  if ((FORMATS as readonly string[]).includes(s)) return s as Format;
  throw new UserError(`Invalid --format: ${s} (expected one of ${FORMATS.join(", ")})`);
}

function parseThreads(s: string): number {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) throw new UserError(`Invalid --threads: ${s}`);
  return n;
}

export function resolveOutputStem(input: string, output: string | undefined): string {
  if (!output) {
    return join(dirname(input), basename(input, extname(input)));
  }
  const dir = dirname(output);
  mkdirSync(dir, { recursive: true });
  const stem = basename(output, extname(output));
  return join(dir, stem);
}

// Default engine = mlx (universal). gigaam was tried as the auto-default for
// --language ru but didn't measurably beat antony66 on real recordings
// (see specs/gigaam/spec.md Field findings — same acronym preservation,
// single-paragraph output is less readable). gigaam stays opt-in via
// explicit --engine gigaam. Engine and language stay independent.
export function resolveEngine(explicit: EngineName | undefined, _language: string): EngineName {
  if (explicit) return explicit;
  return "mlx";
}

export function resolveModel(opts: { model?: string | undefined; engine: EngineName; language: string }): string {
  if (opts.model) return opts.model;
  if (opts.engine === "gigaam") return "gigaam-v3";
  if (opts.engine === "cpp") return "large-v3";
  // mlx engine: pick Russian fine-tune for ru, stock multilingual for everything else
  return opts.language === "ru" ? "antony66-russian" : "large-v3";
}

const ENGINE_MAP: Record<EngineName, Engine> = {
  mlx: mlxEngine,
  cpp: cppEngine,
  gigaam: gigaamEngine,
};

const KNOWN_AUDIO_EXT = new Set([".m4a", ".mp3", ".mp4", ".wav", ".aac", ".flac", ".ogg"]);

async function runSetup(sub: SubcommandName, argv: readonly string[]): Promise<never> {
  const script = setupScriptPath(sub);
  if (!existsSync(script)) {
    console.error(`error: setup script missing: ${script}`);
    process.exit(2);
  }
  const proc = Bun.spawn({
    cmd: ["bash", script, ...argv],
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const code = await proc.exited;
  process.exit(code);
}

async function runTranscribe(argv: readonly string[]): Promise<void> {
  let opts: CliOptions;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    if (e instanceof UserError) {
      console.error(`error: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }

  if (!existsSync(opts.input)) {
    console.error(`error: input file not found: ${opts.input}`);
    process.exit(1);
  }
  const ext = extname(opts.input).toLowerCase();
  if (!KNOWN_AUDIO_EXT.has(ext)) {
    console.error(`warning: unrecognized extension '${ext}'; attempting anyway`);
  }

  const inputAbs = resolve(opts.input);
  const outputStem = resolveOutputStem(inputAbs, opts.output);
  const engineName = resolveEngine(opts.engine, opts.language);
  const engine = ENGINE_MAP[engineName];
  const model = resolveModel({ model: opts.model, engine: engineName, language: opts.language });

  if (engineName === "gigaam" && opts.language !== "ru") {
    console.warn(
      `warning: gigaam is Russian-only; --language ${opts.language} will produce gibberish. ` +
        "Use --engine mlx for non-Russian audio.",
    );
  }

  if (!opts.engine || !opts.model) {
    console.error(`(using: --engine ${engineName} --model ${model})`);
  }

  // Readiness gate: ask the engine if it can run; if not, either prompt
  // the user to install (TTY) or fail with the install command (non-TTY).
  const readiness = engine.checkReady({ model, language: opts.language });
  if (!readiness.ready) {
    const shouldRun = await handleNotReady(engineName, readiness, opts.autoInstall);
    if (!shouldRun) process.exit(1);
  }

  try {
    await engine.transcribe({
      inputPath: inputAbs,
      outputStem,
      model,
      language: opts.language,
      format: opts.format,
      initialPrompt: opts.prompt,
      threads: opts.threads,
      keepWav: opts.keepWav,
    });
    console.log(`done: ${outputStem}.${describeFormat(opts.format)}`);
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    process.exit(2);
  }
}

// Returns true if installation succeeded and the caller should proceed
// with transcription; false on user-declined / non-TTY-fail-fast / install-
// failure. process.exit happens at the call site, not here, so this stays
// testable.
async function handleNotReady(
  engineName: EngineName,
  readiness: ReadinessMissing,
  flag: AutoInstallFlag,
): Promise<boolean> {
  const isTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const action = decideInstallAction({
    isTty,
    env: { TRANSCRIBE_AUTO_INSTALL: process.env.TRANSCRIBE_AUTO_INSTALL },
    flag,
  });

  const summary =
    `error: ${engineName} engine is not ready\n` +
    `  missing:\n    ${readiness.missing.join("\n    ")}\n` +
    `  install (~${readiness.sizeGb} GB, ~${readiness.etaMin} min): ` +
    `${readiness.installCmd.join(" ")}`;

  if (action === "fail-fast") {
    console.error(summary);
    if (!isTty) {
      console.error("(non-interactive; not prompting. " +
        "Re-run with --auto-install + a TTY to enable in-place install.)");
    }
    return false;
  }

  // Prompt path.
  console.error(summary);
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await rl.question("\nInstall now? [Y/n] ");
  rl.close();
  if (!isAffirmative(answer)) {
    console.error("declined; aborting.");
    return false;
  }
  console.error("==> Installing...");
  const proc = Bun.spawn({
    cmd: ["bash", setupScriptPath("setup"), ...readiness.installCmd.slice(2)],
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`install failed (exit ${code}); aborting.`);
    return false;
  }
  console.error("==> Install complete. Resuming transcription.");
  return true;
}

export function isAffirmative(answer: string): boolean {
  const a = answer.trim().toLowerCase();
  // Default = Y; only N variants reject. Y/yes/y/да all accepted.
  if (a === "" || a === "y" || a === "yes" || a === "да") return true;
  if (a === "n" || a === "no" || a === "нет") return false;
  return false;
}

async function main(): Promise<void> {
  const route = routeArgs(process.argv.slice(2));
  switch (route.kind) {
    case "version":
      process.stdout.write(`${readPackageVersion()}\n`);
      process.exit(0);
    case "help":
      process.stdout.write(HELP);
      process.exit(0);
    case "setup":
      await runSetup(route.subcommand, route.argv);
      return;
    case "transcribe":
      await runTranscribe(route.argv);
      return;
  }
}

function describeFormat(f: Format): string {
  return f === "all" ? "{txt,srt,vtt,json}" : f;
}

if (import.meta.main) {
  await main();
}
