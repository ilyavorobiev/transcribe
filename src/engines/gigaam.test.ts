import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  gigaamArgv,
  gigaamCheckReady,
  GIGAAM_SUPPORTED_FORMATS,
  resolveGigaAmModel,
  type GigaAmArgs,
} from "./gigaam.ts";

const originalEnv = {
  PATH: process.env.PATH,
  TRANSCRIBE_CACHE_DIR: process.env.TRANSCRIBE_CACHE_DIR,
};
const tempDirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "gigaam-test-"));
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

const base: GigaAmArgs = {
  scriptPath: "/abs/scripts/gigaam_transcribe.py",
  audioPath: "/tmp/x.wav",
  outputStem: "/out/x",
  repo: "ai-sage/GigaAM-v3",
  revision: "e2e_rnnt",
  format: "txt",
};

test("gigaamArgv full layout for txt", () => {
  expect(gigaamArgv(base)).toEqual([
    "run",
    "--script",
    "/abs/scripts/gigaam_transcribe.py",
    "--audio", "/tmp/x.wav",
    "--output-stem", "/out/x",
    "--model-repo", "ai-sage/GigaAM-v3",
    "--revision", "e2e_rnnt",
    "--format", "txt",
  ]);
});

test("gigaamArgv passes through model repo + revision", () => {
  const argv = gigaamArgv({ ...base, repo: "some-other/repo", revision: "main" });
  const i = argv.indexOf("--model-repo");
  expect(argv[i + 1]).toBe("some-other/repo");
  const j = argv.indexOf("--revision");
  expect(argv[j + 1]).toBe("main");
});

test("gigaamArgv passes format through to --format", () => {
  for (const fmt of ["txt", "json"] as const) {
    const argv = gigaamArgv({ ...base, format: fmt });
    const i = argv.indexOf("--format");
    expect(argv[i + 1]).toBe(fmt);
  }
});

test("resolveGigaAmModel expands aliases to LOCAL paths (curl-downloaded by setup)", () => {
  const v3 = resolveGigaAmModel("gigaam-v3");
  expect(v3.repo).toMatch(/\/models\/gigaam-v3-e2e-rnnt$/);
  expect(v3.revision).toBe("main");

  const ctc = resolveGigaAmModel("gigaam-v3-ctc");
  expect(ctc.repo).toMatch(/\/models\/gigaam-v3-e2e-ctc$/);

  const v2 = resolveGigaAmModel("gigaam-v2");
  expect(v2.repo).toMatch(/\/models\/gigaam-v2$/);
});

test("resolveGigaAmModel passes raw HF repo ids through unchanged", () => {
  expect(resolveGigaAmModel("custom-user/custom-russian-asr")).toEqual({
    repo: "custom-user/custom-russian-asr",
    revision: "main",
  });
});

test("GIGAAM_SUPPORTED_FORMATS excludes srt/vtt/all (v1 limitation)", () => {
  expect(GIGAAM_SUPPORTED_FORMATS).toContain("txt");
  expect(GIGAAM_SUPPORTED_FORMATS).toContain("json");
  expect(GIGAAM_SUPPORTED_FORMATS).not.toContain("srt");
  expect(GIGAAM_SUPPORTED_FORMATS).not.toContain("vtt");
  expect(GIGAAM_SUPPORTED_FORMATS).not.toContain("all");
});

// -- gigaamCheckReady --------------------------------------------------------

test("gigaamCheckReady: empty PATH + empty cache → uv, ffmpeg, model all missing", () => {
  process.env.PATH = tmp();
  process.env.TRANSCRIBE_CACHE_DIR = tmp();
  const r = gigaamCheckReady({ model: "gigaam-v3", language: "ru" });
  expect(r.ready).toBe(false);
  if (!r.ready) {
    expect(r.missing.some(m => m.includes("uv"))).toBe(true);
    expect(r.missing.some(m => m.includes("ffmpeg"))).toBe(true);
    expect(r.missing.some(m => m.includes("gigaam-v3"))).toBe(true);
    expect(r.installCmd).toEqual(["transcribe", "setup", "--with", "gigaam"]);
  }
});

test("gigaamCheckReady: model dir present + (assume) uv/ffmpeg on PATH → ready", () => {
  // Same caveat as the mlx test: we can't fake uv/ffmpeg without dropping
  // a real executable. Use the system binaries if present; otherwise skip.
  if (!Bun.which("uv") || !Bun.which("ffmpeg")) return;
  const cache = tmp();
  process.env.TRANSCRIBE_CACHE_DIR = cache;
  const modelDir = join(cache, "models", "gigaam-v3-e2e-rnnt");
  mkdirSync(modelDir, { recursive: true });
  writeFileSync(join(modelDir, "pytorch_model.bin"), "x".repeat(1000));
  const r = gigaamCheckReady({ model: "gigaam-v3", language: "ru" });
  expect(r.ready).toBe(true);
});

test("gigaamCheckReady: custom HF repo (non-local) skips the dir check", () => {
  process.env.PATH = tmp();
  const r = gigaamCheckReady({ model: "custom-user/custom", language: "ru" });
  expect(r.ready).toBe(false);
  if (!r.ready) {
    // No "model files" entry — only the binaries.
    expect(r.missing.every(m => !m.includes("custom-user"))).toBe(true);
  }
});
