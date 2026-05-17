import { expect, test } from "bun:test";
import { mlxArgv, resolveModelRef, type MlxArgs } from "./mlx.ts";

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

test("resolveModelRef expands known aliases", () => {
  expect(resolveModelRef("antony66-russian")).toBe("antony66/whisper-large-v3-russian");
  expect(resolveModelRef("bond005-turbo")).toBe("bond005/whisper-podlodka-turbo");
  expect(resolveModelRef("large-v3")).toBe("mlx-community/whisper-large-v3-mlx");
  expect(resolveModelRef("large-v3-turbo")).toBe("mlx-community/whisper-large-v3-turbo");
});

test("resolveModelRef passes raw HF refs through unchanged", () => {
  expect(resolveModelRef("mlx-community/whisper-large-v3-turbo")).toBe(
    "mlx-community/whisper-large-v3-turbo",
  );
  expect(resolveModelRef("some-user/some-mlx-model")).toBe("some-user/some-mlx-model");
});
