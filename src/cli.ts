#!/usr/bin/env bun
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { cppEngine } from "./engines/cpp.ts";
import { mlxEngine } from "./engines/mlx.ts";
import { ENGINES, FORMATS, type EngineName, type Format } from "./engines/types.ts";

const HELP = `transcribe <file.m4a> [options]

Options:
  --engine <name>    mlx | cpp                       (default: mlx)
  --model <name>     engine-specific model alias or HuggingFace repo id
                     mlx defaults to antony66-russian; cpp defaults to large-v3
  --format <fmt>     txt | srt | vtt | json | all   (default: txt)
  --output <file>    output file path                (default: <input-stem>.<ext> next to input)
  --language <code>  ISO language code               (default: ru)
  --prompt <text>    initial prompt (vocabulary biasing for domain terms / acronyms)
  --threads <n>      decoder threads (cpp engine only; default: min(cpus, 8))
  --keep-wav         retain the intermediate 16kHz WAV (cpp engine only)
  -h, --help         show this help

Engine quick reference:
  mlx (default)  — Apple Silicon native; loads HuggingFace models directly.
                   Best Russian quality via the antony66 fine-tune.
                   Requires: 'bun run setup:mlx' (uv + mlx-whisper).
  cpp            — whisper.cpp built from source. Offline-strict, no Python,
                   richer VAD knobs, cross-platform-friendly.
                   Requires: 'bun run setup' (cmake + ffmpeg + ggml model).
`;

export class UserError extends Error {}

export interface CliOptions {
  input: string;
  engine: EngineName;
  model: string | undefined;
  format: Format;
  output: string | undefined;
  language: string;
  prompt: string | undefined;
  threads: number | undefined;
  keepWav: boolean;
}

const DEFAULT_MODEL: Record<EngineName, string> = {
  mlx: "antony66-russian",
  cpp: "large-v3",
};

export function parseArgs(argv: readonly string[]): CliOptions {
  const opts = {
    input: undefined as string | undefined,
    engine: "mlx" as EngineName,
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

  if (opts.engine === "mlx" && opts.keepWav) {
    throw new UserError("--keep-wav is only supported by the cpp engine (mlx_whisper handles audio internally)");
  }
  if (opts.engine === "mlx" && opts.threads !== undefined) {
    throw new UserError("--threads is only supported by the cpp engine");
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

export function resolveModel(opts: CliOptions): string {
  return opts.model ?? DEFAULT_MODEL[opts.engine];
}

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
  const engine = opts.engine === "cpp" ? cppEngine : mlxEngine;

  try {
    await engine.transcribe({
      inputPath: inputAbs,
      outputStem,
      model: resolveModel(opts),
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
