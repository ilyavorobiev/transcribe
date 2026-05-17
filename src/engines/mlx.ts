import { existsSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { Engine, Format, TranscribeOptions } from "./types.ts";

const MODEL_ALIASES: Record<string, string> = {
  "antony66-russian": "antony66/whisper-large-v3-russian",
  "bond005-turbo": "bond005/whisper-podlodka-turbo",
  "large-v3": "mlx-community/whisper-large-v3-mlx",
  "large-v3-turbo": "mlx-community/whisper-large-v3-turbo",
};

export function resolveModelRef(name: string): string {
  return MODEL_ALIASES[name] ?? name;
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

export const mlxEngine: Engine = {
  name: "mlx",
  async transcribe(opts: TranscribeOptions): Promise<void> {
    const outputDir = dirname(opts.outputStem);
    const outputName = basename(opts.outputStem);
    const argv = mlxArgv({
      inputPath: opts.inputPath,
      outputDir,
      outputName,
      modelRef: resolveModelRef(opts.model),
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
