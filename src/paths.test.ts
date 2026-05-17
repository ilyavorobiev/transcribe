import { afterEach, expect, test } from "bun:test";
import { modelPath, whisperBinaryPath } from "./paths.ts";

const original = {
  WHISPER_BIN: process.env.WHISPER_BIN,
  WHISPER_MODEL_DIR: process.env.WHISPER_MODEL_DIR,
};

afterEach(() => {
  for (const [key, value] of Object.entries(original) as Array<[keyof typeof original, string | undefined]>) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("whisperBinaryPath returns WHISPER_BIN when it points to a real file", () => {
  process.env.WHISPER_BIN = "/usr/bin/env";
  expect(whisperBinaryPath()).toBe("/usr/bin/env");
});

test("whisperBinaryPath throws when WHISPER_BIN is missing", () => {
  process.env.WHISPER_BIN = "/no/such/path/zzz/whisper-cli";
  expect(() => whisperBinaryPath()).toThrow(/non-existent/);
});

test("modelPath throws with actionable message when model not present", () => {
  process.env.WHISPER_MODEL_DIR = "/no/such/models/dir/zzz";
  expect(() => modelPath("large-v3")).toThrow(/Model file not found/);
});
