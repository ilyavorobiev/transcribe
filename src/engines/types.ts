export type Format = "txt" | "srt" | "vtt" | "json" | "all";
export const FORMATS: readonly Format[] = ["txt", "srt", "vtt", "json", "all"];

export type EngineName = "mlx" | "cpp" | "gigaam";
export const ENGINES: readonly EngineName[] = ["mlx", "cpp", "gigaam"];

export interface TranscribeOptions {
  inputPath: string;
  outputStem: string;
  model: string;
  language: string;
  format: Format;
  initialPrompt?: string;
  threads?: number;
  keepWav?: boolean;
}

// Pure readiness check: file/dir existence only, no spawning. Used by
// src/cli.ts to gate transcribe and offer in-place install on miss.
export interface ReadinessCheckArgs {
  model: string;
  language: string;
}

export interface ReadinessReady {
  ready: true;
}

export interface ReadinessMissing {
  ready: false;
  // Human-readable strings naming what's absent ("antony66-russian MLX model",
  // "whisper-cli binary", "ffmpeg"). Surfaced in the prompt + error.
  missing: string[];
  // Argv suggestion for the fix. Always a transcribe subcommand so the user
  // can copy-paste regardless of how they launched.
  installCmd: string[];
  // Rough disk + time figures for the prompt. Inexact on purpose — the user
  // just needs an order of magnitude to decide.
  sizeGb: number;
  etaMin: number;
}

export type ReadinessReport = ReadinessReady | ReadinessMissing;

export interface Engine {
  name: EngineName;
  transcribe(opts: TranscribeOptions): Promise<void>;
  checkReady(args: ReadinessCheckArgs): ReadinessReport;
}
