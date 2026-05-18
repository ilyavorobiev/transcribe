import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cacheModelsDir,
  cacheRoot,
  cacheVendorDir,
  modelPath,
  resolveModelDirPath,
  whisperBinaryPath,
} from "./paths.ts";

const original = {
  WHISPER_BIN: process.env.WHISPER_BIN,
  WHISPER_MODEL_DIR: process.env.WHISPER_MODEL_DIR,
  TRANSCRIBE_CACHE_DIR: process.env.TRANSCRIBE_CACHE_DIR,
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
  HOME: process.env.HOME,
};

const tempDirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "transcriber-paths-test-"));
  tempDirs.push(d);
  return d;
}

afterEach(() => {
  for (const [key, value] of Object.entries(original) as Array<[keyof typeof original, string | undefined]>) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

// -- whisperBinaryPath (legacy) ----------------------------------------------

test("whisperBinaryPath returns WHISPER_BIN when it points to a real file", () => {
  process.env.WHISPER_BIN = "/usr/bin/env";
  expect(whisperBinaryPath()).toBe("/usr/bin/env");
});

test("whisperBinaryPath throws when WHISPER_BIN is missing", () => {
  process.env.WHISPER_BIN = "/no/such/path/zzz/whisper-cli";
  expect(() => whisperBinaryPath()).toThrow(/non-existent/);
});

// -- modelPath (legacy + cache integration) ----------------------------------

test("modelPath honors WHISPER_MODEL_DIR as a hard override (no fallback)", () => {
  process.env.WHISPER_MODEL_DIR = "/no/such/models/dir/zzz";
  expect(() => modelPath("large-v3")).toThrow(/Model file not found/);
});

// -- cache-dir resolution ----------------------------------------------------

test("cacheRoot: TRANSCRIBE_CACHE_DIR wins over XDG and the macOS default", () => {
  process.env.TRANSCRIBE_CACHE_DIR = "/tmp/explicit-cache";
  process.env.XDG_CACHE_HOME = "/tmp/should-be-ignored";
  expect(cacheRoot()).toBe("/tmp/explicit-cache");
});

test("cacheRoot: XDG_CACHE_HOME falls back to $XDG/transcribe when TRANSCRIBE_CACHE_DIR unset", () => {
  delete process.env.TRANSCRIBE_CACHE_DIR;
  process.env.XDG_CACHE_HOME = "/tmp/xdg-cache";
  expect(cacheRoot()).toBe("/tmp/xdg-cache/transcribe");
});

test("cacheRoot: macOS default = $HOME/Library/Caches/transcribe", () => {
  delete process.env.TRANSCRIBE_CACHE_DIR;
  delete process.env.XDG_CACHE_HOME;
  process.env.HOME = "/Users/testuser";
  expect(cacheRoot()).toBe("/Users/testuser/Library/Caches/transcribe");
});

test("cacheModelsDir/cacheVendorDir compose under cacheRoot", () => {
  process.env.TRANSCRIBE_CACHE_DIR = "/tmp/x";
  expect(cacheModelsDir()).toBe("/tmp/x/models");
  expect(cacheVendorDir()).toBe("/tmp/x/vendor");
});

// -- resolveModelDirPath (used by mlx + gigaam engines) ----------------------

test("resolveModelDirPath: returns existing cache path when present", () => {
  const cache = tmp();
  process.env.TRANSCRIBE_CACHE_DIR = cache;
  mkdirSync(join(cache, "models", "antony66-russian-mlx"), { recursive: true });
  expect(resolveModelDirPath("antony66-russian-mlx"))
    .toBe(join(cache, "models", "antony66-russian-mlx"));
});

test("resolveModelDirPath: returns the default cache path when nothing exists yet (caller handles missing)", () => {
  // Setup hasn't run yet; the function returns the canonical cache path so
  // the engine can emit a setup-hint error on it (see MissingLocalModelError).
  const cache = tmp();
  process.env.TRANSCRIBE_CACHE_DIR = cache;
  expect(resolveModelDirPath("never-downloaded-model"))
    .toBe(join(cache, "models", "never-downloaded-model"));
});

test("modelPath: explicit WHISPER_MODEL_DIR + present file works", () => {
  const dir = tmp();
  process.env.WHISPER_MODEL_DIR = dir;
  writeFileSync(join(dir, "ggml-large-v3.bin"), "x");
  expect(modelPath("large-v3")).toBe(join(dir, "ggml-large-v3.bin"));
});

test("modelPath: cache-dir model wins when no env override", () => {
  const cache = tmp();
  delete process.env.WHISPER_MODEL_DIR;
  process.env.TRANSCRIBE_CACHE_DIR = cache;
  mkdirSync(join(cache, "models"), { recursive: true });
  writeFileSync(join(cache, "models", "ggml-tiny.bin"), "x");
  expect(modelPath("tiny")).toBe(join(cache, "models", "ggml-tiny.bin"));
});
