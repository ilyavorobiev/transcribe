import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mlxArgv,
  mlxCheckReady,
  resolveModelRef,
  sanitizeOutputName,
  type MlxArgs,
} from "./mlx.ts";

const originalEnv = {
  PATH: process.env.PATH,
  TRANSCRIBE_CACHE_DIR: process.env.TRANSCRIBE_CACHE_DIR,
};
const tempDirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "mlx-test-"));
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

const base: MlxArgs = {
  inputPath: "/in/memo.m4a",
  outputDir: "/out",
  outputName: "memo",
  modelRef: "mlx-community/whisper-large-v3-turbo",
  language: "ru",
  format: "txt",
};

test("mlxArgv full layout for txt", () => {
  expect(mlxArgv(base)).toEqual([
    "/in/memo.m4a",
    "--model", "mlx-community/whisper-large-v3-turbo",
    "--language", "ru",
    "--output-dir", "/out",
    "--output-name", "memo",
    "--output-format", "txt",
    "--condition-on-previous-text", "False",
    "--word-timestamps", "False",
    "--temperature", "0",
    "--no-speech-threshold", "0.5",
  ]);
});

test("mlxArgv does NOT pass --beam-size (mlx_whisper uses beam search internally at T=0)", () => {
  expect(mlxArgv(base)).not.toContain("--beam-size");
});

test("mlxArgv passes format through to --output-format for every format", () => {
  for (const fmt of ["txt", "srt", "vtt", "json", "all"] as const) {
    const argv = mlxArgv({ ...base, format: fmt });
    const i = argv.indexOf("--output-format");
    expect(argv[i + 1]).toBe(fmt);
  }
});

test("mlxArgv disables previous-text conditioning by default", () => {
  const argv = mlxArgv(base);
  const i = argv.indexOf("--condition-on-previous-text");
  expect(argv[i + 1]).toBe("False");
});

test("mlxArgv appends --initial-prompt when set", () => {
  const argv = mlxArgv({ ...base, initialPrompt: "MCP, API. Эээ." });
  const i = argv.indexOf("--initial-prompt");
  expect(argv[i + 1]).toBe("MCP, API. Эээ.");
});

test("mlxArgv omits --initial-prompt when undefined", () => {
  expect(mlxArgv(base)).not.toContain("--initial-prompt");
});

test("resolveModelRef expands Russian fine-tunes to LOCAL converted paths (not HF repos)", () => {
  // antony66 and bond005 ship in HF format and can't be auto-loaded by
  // mlx_whisper; the alias must point at the local converted directory
  // populated by 'bun run setup'.
  expect(resolveModelRef("antony66-russian")).toMatch(/\/models\/antony66-russian-mlx$/);
  expect(resolveModelRef("bond005-turbo")).toMatch(/\/models\/bond005-turbo-mlx$/);
});

test("resolveModelRef expands stock multilingual aliases to mlx-community HF repos", () => {
  expect(resolveModelRef("large-v3")).toBe("mlx-community/whisper-large-v3-mlx");
  expect(resolveModelRef("large-v3-turbo")).toBe("mlx-community/whisper-large-v3-turbo");
});

test("resolveModelRef passes raw HF refs through unchanged", () => {
  expect(resolveModelRef("mlx-community/whisper-large-v3-turbo")).toBe(
    "mlx-community/whisper-large-v3-turbo",
  );
  expect(resolveModelRef("some-user/some-mlx-model")).toBe("some-user/some-mlx-model");
});

test("sanitizeOutputName replaces dots with underscores (workaround for mlx_whisper Path.with_suffix bug)", () => {
  expect(sanitizeOutputName("PRD1.v5-antony")).toBe("PRD1_v5-antony");
  expect(sanitizeOutputName("memo.2025-05-17")).toBe("memo_2025-05-17");
  expect(sanitizeOutputName("plain")).toBe("plain");
  expect(sanitizeOutputName("a.b.c.d")).toBe("a_b_c_d");
});

// -- mlxCheckReady -----------------------------------------------------------

// Test setup: point PATH at an empty dir so Bun.which("mlx_whisper") returns
// null; point TRANSCRIBE_CACHE_DIR at a tmp dir we control.

test("mlxCheckReady: cache empty + no mlx_whisper on PATH → missing both", () => {
  const cache = tmp();
  process.env.PATH = tmp(); // empty dir
  process.env.TRANSCRIBE_CACHE_DIR = cache;
  const r = mlxCheckReady({ model: "antony66-russian", language: "ru" });
  expect(r.ready).toBe(false);
  if (!r.ready) {
    expect(r.missing.some(m => m.includes("mlx_whisper"))).toBe(true);
    expect(r.missing.some(m => m.includes("antony66-russian"))).toBe(true);
    expect(r.installCmd).toEqual(["transcribe", "setup", "--with", "mlx"]);
    expect(r.sizeGb).toBeGreaterThan(0);
  }
});

test("mlxCheckReady: HF-alias model (large-v3) only needs the binary (no local dir check)", () => {
  process.env.PATH = tmp(); // no mlx_whisper
  const r = mlxCheckReady({ model: "large-v3", language: "en" });
  expect(r.ready).toBe(false);
  if (!r.ready) {
    expect(r.missing).toEqual(["mlx_whisper binary (uv tool install mlx-whisper)"]);
  }
});

test("mlxCheckReady: bond005 gets bigger install footprint than antony66", () => {
  process.env.PATH = tmp();
  const antony = mlxCheckReady({ model: "antony66-russian", language: "ru" });
  const bond = mlxCheckReady({ model: "bond005-turbo", language: "ru" });
  if (!antony.ready && !bond.ready) {
    expect(bond.sizeGb).toBeGreaterThan(antony.sizeGb);
    expect(bond.installCmd).toContain("bond005");
  }
});

test("mlxCheckReady: present local model file + (assume) mlx_whisper available → ready", () => {
  // We can't easily fake mlx_whisper on PATH without dropping a real
  // executable in a tmp dir. Use the actual system binary if present;
  // skip the assertion path on environments that don't have it.
  if (!Bun.which("mlx_whisper")) return;
  const cache = tmp();
  process.env.TRANSCRIBE_CACHE_DIR = cache;
  mkdirSync(join(cache, "models", "antony66-russian-mlx"), { recursive: true });
  writeFileSync(join(cache, "models", "antony66-russian-mlx", "weights.safetensors"), "x".repeat(100));
  const r = mlxCheckReady({ model: "antony66-russian", language: "ru" });
  expect(r.ready).toBe(true);
});
