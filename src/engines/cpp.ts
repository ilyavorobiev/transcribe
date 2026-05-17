import { existsSync } from "node:fs";
import { cpus } from "node:os";
import { modelPath, whisperBinaryPath } from "../paths.ts";
import { preprocess } from "../audio.ts";
import type { Engine, Format, TranscribeOptions } from "./types.ts";

const FORMAT_FLAGS = {
  txt: "-otxt",
  srt: "-osrt",
  vtt: "-ovtt",
  json: "-oj",
} as const;

const VAD_MODEL_NAME = "silero-v5.1.2";

export interface CppArgs {
  wavPath: string;
  outputStem: string;
  modelFile: string;
  language: string;
  format: Format;
  threads: number;
  vadModelFile?: string;
  initialPrompt?: string;
}

export function defaultThreads(): number {
  return Math.min(cpus().length, 8);
}

export function whisperArgv(opts: CppArgs): string[] {
  const formats: Array<keyof typeof FORMAT_FLAGS> =
    opts.format === "all" ? ["txt", "srt", "vtt", "json"] : [opts.format];
  const args = [
    "-m", opts.modelFile,
    "-l", opts.language,
    "-t", String(opts.threads),
    "-f", opts.wavPath,
    "-of", opts.outputStem,
    "--print-progress",
    "-mc", "0",
    "-bs", "5",
    "-et", "2.6",
    "-fa",
    "--suppress-nst",
  ];
  if (opts.vadModelFile) {
    args.push(
      "--vad",
      "--vad-model", opts.vadModelFile,
      "--vad-min-silence-duration-ms", "500",
      "--vad-speech-pad-ms", "300",
      "--vad-max-speech-duration-s", "30",
    );
  }
  if (opts.initialPrompt) {
    args.push("--prompt", opts.initialPrompt);
  }
  args.push(...formats.map((f) => FORMAT_FLAGS[f]));
  return args;
}

export const cppEngine: Engine = {
  name: "cpp",
  async transcribe(opts: TranscribeOptions): Promise<void> {
    const wav = await preprocess({ input: opts.inputPath, keepWav: opts.keepWav ?? false });
    try {
      let vadModelFile: string | undefined;
      try {
        vadModelFile = modelPath(VAD_MODEL_NAME);
      } catch {
        console.warn(
          `warning: VAD model ggml-${VAD_MODEL_NAME}.bin not found; continuing without VAD. ` +
            `Long recordings may hallucinate during silences. To enable: ` +
            `curl -L -o models/ggml-${VAD_MODEL_NAME}.bin https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-${VAD_MODEL_NAME}.bin`,
        );
      }
      const argv = whisperArgv({
        wavPath: wav.wavPath,
        outputStem: opts.outputStem,
        modelFile: modelPath(opts.model),
        language: opts.language,
        format: opts.format,
        threads: opts.threads ?? defaultThreads(),
        vadModelFile,
        initialPrompt: opts.initialPrompt,
      });
      const proc = Bun.spawn({
        cmd: [whisperBinaryPath(), ...argv],
        stdout: "inherit",
        stderr: "inherit",
      });
      const code = await proc.exited;
      if (code !== 0) {
        throw new Error(`whisper-cli failed with exit code ${code}`);
      }
      const formatsToCheck = opts.format === "all" ? ["txt", "srt", "vtt", "json"] : [opts.format];
      const expected = formatsToCheck.map((f) => `${opts.outputStem}.${f}`);
      const missing = expected.filter((p) => !existsSync(p));
      if (missing.length > 0) {
        throw new Error(
          `whisper-cli exited 0 but did not produce expected output:\n  ${missing.join("\n  ")}\n` +
            `(check stderr above for an 'unknown argument' or similar error)`,
        );
      }
    } finally {
      await wav.cleanup();
    }
  },
};
