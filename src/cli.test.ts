import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, resolveModel, resolveOutputStem, UserError, type CliOptions } from "./cli.ts";

const tempDirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "transcriber-test-"));
  tempDirs.push(d);
  return d;
}
afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

test("parseArgs defaults (mlx engine, no explicit model)", () => {
  const opts = parseArgs(["foo.m4a"]);
  expect(opts).toEqual({
    input: "foo.m4a",
    engine: "mlx",
    model: undefined,
    format: "txt",
    output: undefined,
    language: "ru",
    prompt: undefined,
    threads: undefined,
    keepWav: false,
  });
});

test("parseArgs reads every flag", () => {
  const opts = parseArgs([
    "memo.m4a",
    "--engine", "cpp",
    "--model", "large-v3",
    "--format", "srt",
    "--output", "/tmp/out.srt",
    "--language", "en",
    "--prompt", "MCP, API.",
    "--threads", "4",
    "--keep-wav",
  ]);
  expect(opts).toMatchObject({
    input: "memo.m4a",
    engine: "cpp",
    model: "large-v3",
    format: "srt",
    output: "/tmp/out.srt",
    language: "en",
    prompt: "MCP, API.",
    threads: 4,
    keepWav: true,
  });
});

test("parseArgs accepts --engine mlx and --engine cpp", () => {
  expect(parseArgs(["x.m4a", "--engine", "mlx"]).engine).toBe("mlx");
  expect(parseArgs(["x.m4a", "--engine", "cpp"]).engine).toBe("cpp");
});

test("parseArgs rejects invalid --engine", () => {
  expect(() => parseArgs(["x.m4a", "--engine", "bogus"])).toThrow(UserError);
});

test("parseArgs rejects --keep-wav on mlx engine", () => {
  expect(() => parseArgs(["x.m4a", "--engine", "mlx", "--keep-wav"])).toThrow(/cpp engine/);
});

test("parseArgs rejects --threads on mlx engine", () => {
  expect(() => parseArgs(["x.m4a", "--engine", "mlx", "--threads", "4"])).toThrow(/cpp engine/);
});

test("parseArgs allows --keep-wav and --threads on cpp engine", () => {
  expect(() => parseArgs(["x.m4a", "--engine", "cpp", "--keep-wav", "--threads", "4"]))
    .not.toThrow();
});

test("parseArgs rejects unknown flag", () => {
  expect(() => parseArgs(["--bogus", "foo.m4a"])).toThrow(UserError);
});

test("parseArgs rejects invalid --format", () => {
  expect(() => parseArgs(["foo.m4a", "--format", "ogg"])).toThrow(UserError);
});

test("parseArgs rejects invalid --threads", () => {
  expect(() => parseArgs(["foo.m4a", "--engine", "cpp", "--threads", "0"])).toThrow(UserError);
  expect(() => parseArgs(["foo.m4a", "--engine", "cpp", "--threads", "abc"])).toThrow(UserError);
});

test("parseArgs requires value for --prompt", () => {
  expect(() => parseArgs(["foo.m4a", "--prompt"])).toThrow(UserError);
});

test("parseArgs requires positional input", () => {
  expect(() => parseArgs([])).toThrow(UserError);
});

test("parseArgs rejects multiple positional inputs", () => {
  expect(() => parseArgs(["a.m4a", "b.m4a"])).toThrow(UserError);
});

test("resolveModel: mlx default is antony66-russian", () => {
  expect(resolveModel(parseArgs(["x.m4a"]))).toBe("antony66-russian");
});

test("resolveModel: cpp default is large-v3", () => {
  expect(resolveModel(parseArgs(["x.m4a", "--engine", "cpp"]))).toBe("large-v3");
});

test("resolveModel: explicit --model wins for both engines", () => {
  expect(resolveModel(parseArgs(["x.m4a", "--model", "bond005-turbo"]))).toBe("bond005-turbo");
  expect(resolveModel(parseArgs(["x.m4a", "--engine", "cpp", "--model", "medium"]))).toBe("medium");
});

test("resolveOutputStem default sits next to input", () => {
  expect(resolveOutputStem("/tmp/dir/memo.m4a", undefined)).toBe("/tmp/dir/memo");
});

test("resolveOutputStem strips extension from --output and creates parent", () => {
  const dir = tmp();
  const nested = join(dir, "a/b");
  const stem = resolveOutputStem("/x/memo.m4a", join(nested, "out.txt"));
  expect(stem).toBe(join(nested, "out"));
  expect(existsSync(nested)).toBe(true);
});
