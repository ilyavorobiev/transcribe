import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export const PROJECT_ROOT = resolve(import.meta.dir, "..");

export function whisperBinaryPath(): string {
  const fromEnv = process.env.WHISPER_BIN;
  if (fromEnv) {
    if (!existsSync(fromEnv)) {
      throw new Error(`WHISPER_BIN points to a non-existent file: ${fromEnv}`);
    }
    return fromEnv;
  }
  const vendored = join(PROJECT_ROOT, "vendor/whisper.cpp/build/bin/whisper-cli");
  if (!existsSync(vendored)) {
    throw new Error(
      `whisper-cli not found at ${vendored}. Run 'bun run setup' first or set WHISPER_BIN.`,
    );
  }
  return vendored;
}

export function modelDir(): string {
  return process.env.WHISPER_MODEL_DIR ?? join(PROJECT_ROOT, "models");
}

export function modelPath(name: string): string {
  const file = join(modelDir(), `ggml-${name}.bin`);
  if (!existsSync(file)) {
    throw new Error(
      `Model file not found: ${file}\n` +
        `Download via: bash vendor/whisper.cpp/models/download-ggml-model.sh ${name} ${modelDir()}`,
    );
  }
  return file;
}
