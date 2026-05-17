import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";

export interface PreprocessOptions {
  input: string;
  keepWav: boolean;
}

export interface PreprocessResult {
  wavPath: string;
  cleanup: () => Promise<void>;
}

export function ffmpegArgv(input: string, output: string): string[] {
  return ["-y", "-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", output];
}

export async function preprocess({ input, keepWav }: PreprocessOptions): Promise<PreprocessResult> {
  const stem = basename(input, extname(input));
  let wavPath: string;
  let cleanup: () => Promise<void>;

  if (keepWav) {
    wavPath = join(dirname(input), `${stem}.wav`);
    cleanup = async () => {};
  } else {
    const dir = await mkdtemp(join(tmpdir(), "transcriber-"));
    wavPath = join(dir, `${stem}.wav`);
    cleanup = async () => {
      await rm(dir, { recursive: true, force: true });
    };
  }

  const proc = Bun.spawn({
    cmd: ["ffmpeg", ...ffmpegArgv(input, wavPath)],
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) {
    await cleanup();
    const tail = stderr.trim().split("\n").slice(-20).join("\n");
    throw new Error(`ffmpeg failed (exit ${code}):\n${tail}`);
  }

  return { wavPath, cleanup };
}
