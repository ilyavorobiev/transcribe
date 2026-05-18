import { existsSync } from "node:fs";
import { join } from "node:path";
import { preprocess } from "../audio.ts";
import { PROJECT_ROOT } from "../paths.ts";
import type { Engine, Format, TranscribeOptions } from "./types.ts";

export interface GigaAmModelRef {
  repo: string;
  revision: string;
}

// Aliases point at LOCAL directories populated by `bun run setup` via
// scripts/download-hf-model.sh. We avoid passing HF repo IDs to
// `transformers.AutoModel.from_pretrained()` directly because that triggers
// the huggingface_hub parallel downloader (stalls in CLOSE_WAIT for big
// multi-file Russian repos; same root cause as antony66/bond005).
const MODEL_ALIASES: Record<string, GigaAmModelRef> = {
  "gigaam-v3": {
    repo: join(PROJECT_ROOT, "models", "gigaam-v3-e2e-rnnt"),
    revision: "main",
  },
  "gigaam-v3-ctc": {
    repo: join(PROJECT_ROOT, "models", "gigaam-v3-e2e-ctc"),
    revision: "main",
  },
  "gigaam-v2": {
    repo: join(PROJECT_ROOT, "models", "gigaam-v2"),
    revision: "main",
  },
};

const SETUP_HINT: Record<string, string> = {
  "gigaam-v3":
    "bun run setup           # downloads ai-sage/GigaAM-v3 @ e2e_rnnt (~420 MB)",
  "gigaam-v3-ctc":
    "bash scripts/download-hf-model.sh ai-sage/GigaAM-v3 models/gigaam-v3-e2e-ctc --revision e2e_ctc",
  "gigaam-v2":
    "bash scripts/download-hf-model.sh ai-sage/GigaAM-v2 models/gigaam-v2",
};

export function resolveGigaAmModel(name: string): GigaAmModelRef {
  return MODEL_ALIASES[name] ?? { repo: name, revision: "main" };
}

export function isLocalRepo(ref: string): boolean {
  return ref.startsWith("/") || ref.startsWith("./") || ref.startsWith("../");
}

export class MissingGigaAmModelError extends Error {
  constructor(alias: string, resolvedPath: string) {
    const hint = SETUP_HINT[alias];
    super(
      `gigaam model '${alias}' resolves to ${resolvedPath} but that directory doesn't exist.\n` +
        (hint ? `Fix: ${hint}` : "Fix: run 'bun run setup' or pass --model with a different value"),
    );
  }
}

export const GIGAAM_SUPPORTED_FORMATS: readonly Format[] = ["txt", "json"];

export interface GigaAmArgs {
  scriptPath: string;
  audioPath: string;
  outputStem: string;
  repo: string;
  revision: string;
  format: Format;
}

export function gigaamArgv(opts: GigaAmArgs): string[] {
  return [
    "run",
    "--script",
    opts.scriptPath,
    "--audio", opts.audioPath,
    "--output-stem", opts.outputStem,
    "--model-repo", opts.repo,
    "--revision", opts.revision,
    "--format", opts.format,
  ];
}

export const gigaamEngine: Engine = {
  name: "gigaam",
  async transcribe(opts: TranscribeOptions): Promise<void> {
    if (!GIGAAM_SUPPORTED_FORMATS.includes(opts.format)) {
      throw new Error(
        `gigaam engine v1 only supports format=txt or format=json (got '${opts.format}'). ` +
          `For srt/vtt/all use --engine mlx or --engine cpp.`,
      );
    }
    if (opts.initialPrompt) {
      console.warn("warning: gigaam engine ignores --prompt (no prompt-biasing API)");
    }

    const wav = await preprocess({ input: opts.inputPath, keepWav: opts.keepWav ?? false });
    try {
      const scriptPath = join(PROJECT_ROOT, "scripts", "gigaam_transcribe.py");
      const { repo, revision } = resolveGigaAmModel(opts.model);
      if (isLocalRepo(repo) && !existsSync(repo)) {
        throw new MissingGigaAmModelError(opts.model, repo);
      }
      const argv = gigaamArgv({
        scriptPath,
        audioPath: wav.wavPath,
        outputStem: opts.outputStem,
        repo,
        revision,
        format: opts.format,
      });
      const proc = Bun.spawn({
        cmd: ["uv", ...argv],
        stdout: "inherit",
        stderr: "inherit",
      });
      const code = await proc.exited;
      if (code !== 0) {
        throw new Error(
          `gigaam_transcribe.py failed with exit code ${code}\n` +
            "Check stderr above. Common causes:\n" +
            "  - uv not installed (brew install uv)\n" +
            "  - first run: torch + transformers download (~3 GB; takes minutes)\n" +
            "  - HF rate-limit on model download (export HF_TOKEN=...)",
        );
      }
      const expected = `${opts.outputStem}.${opts.format}`;
      if (!existsSync(expected)) {
        throw new Error(`gigaam exited 0 but did not produce ${expected}`);
      }
    } finally {
      await wav.cleanup();
    }
  },
};
