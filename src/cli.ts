#!/usr/bin/env bun
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { cppEngine } from "./engines/cpp.ts";
import { GIGAAM_SUPPORTED_FORMATS, gigaamEngine } from "./engines/gigaam.ts";
import { mlxEngine } from "./engines/mlx.ts";
import { ENGINES, FORMATS, type Engine, type EngineName, type Format } from "./engines/types.ts";

const HELP = `transcribe <file.m4a> [options]

Options:
  --engine <name>    mlx | cpp | gigaam              (default: mlx)
  --model <name>     engine-specific model alias or HuggingFace repo id
  --format <fmt>     txt | srt | vtt | json | all   (default: txt)
  --output <file>    output file path                (default: <input-stem>.<ext> next to input)
  --language <code>  ISO language code               (default: ru)
  --prompt <text>    initial prompt (mlx/cpp only — vocabulary biasing)
  --threads <n>      decoder threads (cpp engine only; default: min(cpus, 8))
  --keep-wav         retain the intermediate 16kHz WAV (cpp engine only)
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
                  Requires: 'bun run setup' (uv + mlx-whisper + model).
  cpp     — whisper.cpp built from source. Offline-strict, no Python,
            richer VAD knobs, cross-platform-friendly.
            Requires: 'bun run setup:cpp' (cmake + ffmpeg + ggml model).
  gigaam  — Sber GigaAM-v3 (Russian-only). Native Latin char output for
            "MCP"/"API". Strong on CV-ru benchmarks but didn't clearly
            beat antony66 on our 48-min PRD memo (similar acronym
            preservation, single-paragraph output is less readable).
            Use for a second-opinion run or future LLM-vote post-correction.
            Requires: 'bun run setup' (uv + torch + transformers + model).
            Limitation: txt/json formats only in v1.
`;

export class UserError extends Error {}

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
      case "-h":
      case "--help":
        process.stdout.write(HELP);
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

async function main(): Promise<void> {
  let opts: CliOptions;
  try {
    opts = parseArgs(process.argv.slice(2));
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

function describeFormat(f: Format): string {
  return f === "all" ? "{txt,srt,vtt,json}" : f;
}

if (import.meta.main) {
  await main();
}
