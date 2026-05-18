import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cppCheckReady, whisperArgv, defaultThreads, type CppArgs } from "./cpp.ts";

const originalEnv = {
  PATH: process.env.PATH,
  WHISPER_BIN: process.env.WHISPER_BIN,
  WHISPER_MODEL_DIR: process.env.WHISPER_MODEL_DIR,
  TRANSCRIBE_CACHE_DIR: process.env.TRANSCRIBE_CACHE_DIR,
};
const tempDirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "cpp-test-"));
  tempDirs.push(d);
  return d;
}
afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv) as Array<[keyof typeof originalEnv, string | undefined]>) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

const base: CppArgs = {
  wavPath: "/tmp/x.wav",
  outputStem: "/out/x",
  modelFile: "/models/ggml-large-v3.bin",
  language: "ru",
  format: "txt",
  threads: 8,
};

test("whisperArgv full layout for txt", () => {
  expect(whisperArgv(base)).toEqual([
    "-m", "/models/ggml-large-v3.bin",
    "-l", "ru",
    "-t", "8",
    "-f", "/tmp/x.wav",
    "-of", "/out/x",
    "--print-progress",
    "-mc", "0",
    "-bs", "5",
    "-et", "2.6",
    "-fa",
    "--suppress-nst",
    "-otxt",
  ]);
});

test("whisperArgv includes anti-hallucination flags by default", () => {
  const argv = whisperArgv(base);
  const mc = argv.indexOf("-mc");
  expect(argv[mc + 1]).toBe("0");
  expect(argv).toContain("-bs");
  expect(argv).toContain("-et");
  expect(argv).toContain("-fa");
  expect(argv).toContain("--suppress-nst");
});

test("whisperArgv does NOT include -bo (redundant with -bs at T=0)", () => {
  expect(whisperArgv(base)).not.toContain("-bo");
});

test("whisperArgv appends VAD flags + tuned timings when vadModelFile is given", () => {
  const argv = whisperArgv({ ...base, vadModelFile: "/models/ggml-silero-v5.1.2.bin" });
  expect(argv).toContain("--vad");
  const m = argv.indexOf("--vad-model");
  expect(argv[m + 1]).toBe("/models/ggml-silero-v5.1.2.bin");
  expect(argv[argv.indexOf("--vad-min-silence-duration-ms") + 1]).toBe("500");
  expect(argv[argv.indexOf("--vad-speech-pad-ms") + 1]).toBe("300");
  expect(argv[argv.indexOf("--vad-max-speech-duration-s") + 1]).toBe("30");
});

test("whisperArgv omits VAD flags when vadModelFile is undefined", () => {
  const argv = whisperArgv(base);
  expect(argv).not.toContain("--vad");
  expect(argv).not.toContain("--vad-model");
});

test("whisperArgv appends --prompt when initialPrompt is set", () => {
  const argv = whisperArgv({ ...base, initialPrompt: "MCP, API. Эээ." });
  const p = argv.indexOf("--prompt");
  expect(argv[p + 1]).toBe("MCP, API. Эээ.");
});

test("whisperArgv emits one format flag per single format", () => {
  for (const [format, flag] of [
    ["txt", "-otxt"],
    ["srt", "-osrt"],
    ["vtt", "-ovtt"],
    ["json", "-oj"],
  ] as const) {
    const argv = whisperArgv({ ...base, format });
    const formatFlags = argv.filter((a) => ["-otxt", "-osrt", "-ovtt", "-oj"].includes(a));
    expect(formatFlags).toEqual([flag]);
  }
});

test("whisperArgv 'all' emits txt, srt, vtt, json flags", () => {
  const argv = whisperArgv({ ...base, format: "all" });
  expect(argv).toContain("-otxt");
  expect(argv).toContain("-osrt");
  expect(argv).toContain("-ovtt");
  expect(argv).toContain("-oj");
});

test("defaultThreads returns 1..8", () => {
  const n = defaultThreads();
  expect(n).toBeGreaterThanOrEqual(1);
  expect(n).toBeLessThanOrEqual(8);
});

// -- cppCheckReady -----------------------------------------------------------

test("cppCheckReady: missing binary + missing model + missing ffmpeg → all reported", () => {
  process.env.PATH = tmp(); // no ffmpeg, no nothing
  process.env.WHISPER_BIN = "/no/such/whisper-cli/zzz";
  process.env.WHISPER_MODEL_DIR = "/no/such/models/zzz";
  // WHISPER_BIN exists check will throw before we get to the model;
  // suppress the throw by unsetting WHISPER_BIN and pointing the resolver
  // at a cache dir with nothing in it.
  delete process.env.WHISPER_BIN;
  process.env.TRANSCRIBE_CACHE_DIR = tmp();
  delete process.env.WHISPER_MODEL_DIR;

  const r = cppCheckReady({ model: "large-v3", language: "en" });
  expect(r.ready).toBe(false);
  if (!r.ready) {
    expect(r.missing.some(m => m.includes("whisper-cli"))).toBe(true);
    expect(r.missing.some(m => m.includes("ggml-large-v3.bin"))).toBe(true);
    expect(r.missing.some(m => m.includes("ffmpeg"))).toBe(true);
    expect(r.installCmd).toEqual(["transcribe", "setup", "--with", "cpp"]);
  }
});

test("cppCheckReady: WHISPER_BIN points at a real file + model present → only ffmpeg missing", () => {
  process.env.WHISPER_BIN = "/usr/bin/env"; // any existing executable
  const modelDir = tmp();
  process.env.WHISPER_MODEL_DIR = modelDir;
  writeFileSync(join(modelDir, "ggml-large-v3.bin"), "x");
  process.env.PATH = tmp(); // no ffmpeg

  const r = cppCheckReady({ model: "large-v3", language: "en" });
  expect(r.ready).toBe(false);
  if (!r.ready) {
    expect(r.missing).toEqual(["ffmpeg (brew install ffmpeg)"]);
  }
});
