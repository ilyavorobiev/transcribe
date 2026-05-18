import { existsSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { resolveModelDirPath } from "../paths.ts";
import type { Engine, Format, TranscribeOptions } from "./types.ts";

// Aliases for Russian fine-tunes point at LOCAL converted directories
// (populated by `transcribe setup` via scripts/convert-hf-to-mlx.sh). These
// models are not in MLX format upstream and can't be auto-downloaded by
// mlx_whisper; pointing the alias at the HF repo ID would trigger an
// auto-download that stalls (see specs/mlx-russian/spec.md Field findings).
//
// LOCAL_MLX_SUBDIRS resolves at call time via resolveModelDirPath() so the
// path tracks the active cache root (TRANSCRIBE_CACHE_DIR / XDG_CACHE_HOME /
// macOS default / local-dev fallback).
//
// Aliases for stock multilingual models point at HF repo IDs under
// mlx-community/ — those are pre-converted to MLX format and mlx_whisper
// auto-fetches them fine, no local cache needed.
const LOCAL_MLX_SUBDIRS: Record<string, string> = {
  "antony66-russian": "antony66-russian-mlx",
  "bond005-turbo": "bond005-turbo-mlx",
};

const HF_ALIASES: Record<string, string> = {
  "large-v3": "mlx-community/whisper-large-v3-mlx",
  "large-v3-turbo": "mlx-community/whisper-large-v3-turbo",
};

const SETUP_HINT: Record<string, string> = {
  "antony66-russian": "transcribe setup        # downloads + converts antony66",
  "bond005-turbo": "transcribe setup        # downloads + converts bond005 too",
};

export function resolveModelRef(name: string): string {
  const localSubdir = LOCAL_MLX_SUBDIRS[name];
  if (localSubdir) return resolveModelDirPath(localSubdir);
  return HF_ALIASES[name] ?? name;
}

export function isLocalModelPath(ref: string): boolean {
  return ref.startsWith("/") || ref.startsWith("./") || ref.startsWith("../");
}

export class MissingLocalModelError extends Error {
  constructor(alias: string, resolvedPath: string) {
    const hint = SETUP_HINT[alias];
    super(
      `model '${alias}' resolves to ${resolvedPath} but that directory doesn't exist.\n` +
        (hint ? `Fix: ${hint}` : `Fix: run 'bun run setup' or pass --model with a different value`),
    );
  }
}

export interface MlxArgs {
  inputPath: string;
  outputDir: string;
  outputName: string;
  modelRef: string;
  language: string;
  format: Format;
  initialPrompt?: string;
}

export function mlxArgv(opts: MlxArgs): string[] {
  const args = [
    opts.inputPath,
    "--model", opts.modelRef,
    "--language", opts.language,
    "--output-dir", opts.outputDir,
    "--output-name", opts.outputName,
    "--output-format", opts.format,
    "--condition-on-previous-text", "False",
    "--word-timestamps", "False",
    "--temperature", "0",
    "--no-speech-threshold", "0.5",
  ];
  if (opts.initialPrompt) {
    args.push("--initial-prompt", opts.initialPrompt);
  }
  return args;
}

// mlx_whisper's writer does `Path(dir / name).with_suffix(".txt")` which
// strips everything after the last dot in `name`. So passing "PRD1.v5-antony"
// produces "PRD1.txt" instead of "PRD1.v5-antony.txt". Workaround: pass a
// dot-free stem to mlx_whisper, then rename to the intended name.
export function sanitizeOutputName(stem: string): string {
  return stem.replace(/\./g, "_");
}

export const mlxEngine: Engine = {
  name: "mlx",
  async transcribe(opts: TranscribeOptions): Promise<void> {
    const outputDir = dirname(opts.outputStem);
    const finalStem = basename(opts.outputStem);
    const safeStem = sanitizeOutputName(finalStem);
    const modelRef = resolveModelRef(opts.model);
    if (isLocalModelPath(modelRef) && !existsSync(modelRef)) {
      throw new MissingLocalModelError(opts.model, modelRef);
    }
    const argv = mlxArgv({
      inputPath: opts.inputPath,
      outputDir,
      outputName: safeStem,
      modelRef,
      language: opts.language,
      format: opts.format,
      initialPrompt: opts.initialPrompt,
    });
    const proc = Bun.spawn({
      cmd: ["mlx_whisper", ...argv],
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) {
      throw new Error(`mlx_whisper failed with exit code ${code}`);
    }

    const formatsToCheck = opts.format === "all" ? ["txt", "srt", "vtt", "json"] : [opts.format];

    if (finalStem !== safeStem) {
      for (const f of formatsToCheck) {
        const src = join(outputDir, `${safeStem}.${f}`);
        const dst = join(outputDir, `${finalStem}.${f}`);
        if (existsSync(src)) renameSync(src, dst);
      }
    }

    const expected = formatsToCheck.map((f) => `${opts.outputStem}.${f}`);
    const missing = expected.filter((p) => !existsSync(p));
    if (missing.length > 0) {
      throw new Error(
        `mlx_whisper exited 0 but did not produce expected output:\n  ${missing.join("\n  ")}\n` +
          `(check stderr above for clues; mlx_whisper output naming may have changed)`,
      );
    }
  },
};
