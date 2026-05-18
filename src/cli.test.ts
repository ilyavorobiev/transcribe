import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseArgs,
  resolveEngine,
  resolveModel,
  resolveOutputStem,
  UserError,
} from "./cli.ts";

const tempDirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "transcriber-test-"));
  tempDirs.push(d);
  return d;
}
afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

// -- parseArgs ----------------------------------------------------------------

test("parseArgs defaults (no --engine, no --model)", () => {
  const opts = parseArgs(["foo.m4a"]);
  expect(opts).toEqual({
    input: "foo.m4a",
    engine: undefined,
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

test("parseArgs accepts all three engines", () => {
  expect(parseArgs(["x.m4a", "--engine", "mlx"]).engine).toBe("mlx");
  expect(parseArgs(["x.m4a", "--engine", "cpp"]).engine).toBe("cpp");
  expect(parseArgs(["x.m4a", "--engine", "gigaam"]).engine).toBe("gigaam");
});

test("parseArgs rejects invalid --engine", () => {
  expect(() => parseArgs(["x.m4a", "--engine", "bogus"])).toThrow(UserError);
});

test("parseArgs rejects --keep-wav unless engine resolves to cpp", () => {
  expect(() => parseArgs(["x.m4a", "--engine", "mlx", "--keep-wav"])).toThrow(/cpp engine/);
  expect(() => parseArgs(["x.m4a", "--engine", "gigaam", "--keep-wav"])).toThrow(/cpp engine/);
  // default engine is mlx (not cpp), so --keep-wav alone is rejected
  expect(() => parseArgs(["x.m4a", "--keep-wav"])).toThrow(/cpp engine/);
});

test("parseArgs rejects --threads unless engine resolves to cpp", () => {
  expect(() => parseArgs(["x.m4a", "--engine", "mlx", "--threads", "4"])).toThrow(/cpp engine/);
  expect(() => parseArgs(["x.m4a", "--engine", "gigaam", "--threads", "4"])).toThrow(/cpp engine/);
});

test("parseArgs allows --keep-wav and --threads on cpp engine", () => {
  expect(() => parseArgs(["x.m4a", "--engine", "cpp", "--keep-wav", "--threads", "4"]))
    .not.toThrow();
});

test("parseArgs rejects --format srt|vtt|all on explicit --engine gigaam", () => {
  expect(() => parseArgs(["x.m4a", "--engine", "gigaam", "--format", "srt"])).toThrow(/gigaam/);
  expect(() => parseArgs(["x.m4a", "--engine", "gigaam", "--format", "vtt"])).toThrow(/gigaam/);
  expect(() => parseArgs(["x.m4a", "--engine", "gigaam", "--format", "all"])).toThrow(/gigaam/);
});

test("parseArgs allows --format srt with default engine (mlx)", () => {
  // After revert: default is mlx (which supports all formats), not gigaam
  expect(() => parseArgs(["x.m4a", "--format", "srt"])).not.toThrow();
});

test("parseArgs allows --format txt|json on gigaam", () => {
  expect(() => parseArgs(["x.m4a", "--engine", "gigaam", "--format", "txt"])).not.toThrow();
  expect(() => parseArgs(["x.m4a", "--engine", "gigaam", "--format", "json"])).not.toThrow();
});

test("parseArgs rejects unknown flag", () => {
  expect(() => parseArgs(["--bogus", "foo.m4a"])).toThrow(UserError);
});

test("parseArgs rejects invalid --format", () => {
  expect(() => parseArgs(["foo.m4a", "--format", "ogg"])).toThrow(UserError);
});

test("parseArgs rejects invalid --threads value", () => {
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

// -- resolveEngine / resolveModel (auto-routing) -----------------------------

test("resolveEngine: default is always mlx regardless of language", () => {
  // After revert (specs/gigaam/spec.md field findings): gigaam didn't measurably
  // beat antony66 on real recordings, so mlx is the universal default and
  // gigaam is opt-in via explicit --engine.
  expect(resolveEngine(undefined, "ru")).toBe("mlx");
  expect(resolveEngine(undefined, "en")).toBe("mlx");
  expect(resolveEngine(undefined, "de")).toBe("mlx");
  expect(resolveEngine(undefined, "ja")).toBe("mlx");
});

test("resolveEngine: explicit --engine always wins", () => {
  expect(resolveEngine("mlx", "ru")).toBe("mlx");
  expect(resolveEngine("cpp", "ru")).toBe("cpp");
  expect(resolveEngine("gigaam", "ru")).toBe("gigaam");
  expect(resolveEngine("gigaam", "en")).toBe("gigaam"); // user accepts the language warning
});

test("resolveModel: gigaam engine defaults to gigaam-v3", () => {
  expect(resolveModel({ engine: "gigaam", language: "ru" })).toBe("gigaam-v3");
});

test("resolveModel: cpp engine defaults to large-v3", () => {
  expect(resolveModel({ engine: "cpp", language: "ru" })).toBe("large-v3");
  expect(resolveModel({ engine: "cpp", language: "en" })).toBe("large-v3");
});

test("resolveModel: mlx + ru defaults to antony66-russian", () => {
  expect(resolveModel({ engine: "mlx", language: "ru" })).toBe("antony66-russian");
});

test("resolveModel: mlx + non-ru defaults to stock large-v3", () => {
  expect(resolveModel({ engine: "mlx", language: "en" })).toBe("large-v3");
  expect(resolveModel({ engine: "mlx", language: "de" })).toBe("large-v3");
});

test("resolveModel: explicit --model wins over engine/language defaults", () => {
  expect(resolveModel({ model: "bond005-turbo", engine: "mlx", language: "ru" })).toBe("bond005-turbo");
  expect(resolveModel({ model: "tiny", engine: "cpp", language: "en" })).toBe("tiny");
  expect(resolveModel({ model: "gigaam-v3-ctc", engine: "gigaam", language: "ru" })).toBe("gigaam-v3-ctc");
});

// -- resolveOutputStem -------------------------------------------------------

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
