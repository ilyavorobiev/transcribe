import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseArgs,
  readPackageVersion,
  resolveEngine,
  resolveModel,
  resolveOutputStem,
  routeArgs,
  setupScriptPath,
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

// -- routeArgs (subcommand dispatch) -----------------------------------------

test("routeArgs: empty argv routes to transcribe (missing-input error happens later)", () => {
  expect(routeArgs([])).toEqual({ kind: "transcribe", argv: [] });
});

test("routeArgs: --version intercepts at argv[0]", () => {
  expect(routeArgs(["--version"])).toEqual({ kind: "version" });
  expect(routeArgs(["-v"])).toEqual({ kind: "version" });
});

test("routeArgs: top-level --help intercepts at argv[0]", () => {
  expect(routeArgs(["--help"])).toEqual({ kind: "help" });
  expect(routeArgs(["-h"])).toEqual({ kind: "help" });
});

test("routeArgs: --help mid-argv falls through to transcribe (per-flag help)", () => {
  // `transcribe foo.m4a --help` should hit parseArgs's --help, not the
  // combined top-level help. routeArgs only intercepts at argv[0].
  expect(routeArgs(["foo.m4a", "--help"])).toEqual({
    kind: "transcribe",
    argv: ["foo.m4a", "--help"],
  });
});

test("routeArgs: setup subcommand passes through trailing flags", () => {
  expect(routeArgs(["setup"])).toEqual({
    kind: "setup",
    subcommand: "setup",
    argv: [],
  });
  expect(routeArgs(["setup", "--no-gigaam", "--no-cpp"])).toEqual({
    kind: "setup",
    subcommand: "setup",
    argv: ["--no-gigaam", "--no-cpp"],
  });
});

test("routeArgs: setup:mlx and setup:cpp subcommands", () => {
  expect(routeArgs(["setup:mlx"])).toMatchObject({
    kind: "setup",
    subcommand: "setup:mlx",
  });
  expect(routeArgs(["setup:cpp"])).toMatchObject({
    kind: "setup",
    subcommand: "setup:cpp",
  });
});

test("routeArgs: unrecognized first arg routes to transcribe", () => {
  // `transcribe my-audio.m4a` and `transcribe install` should both fall
  // through; parseArgs / file-existence check will surface the right error.
  expect(routeArgs(["my-audio.m4a", "--engine", "cpp"])).toEqual({
    kind: "transcribe",
    argv: ["my-audio.m4a", "--engine", "cpp"],
  });
  expect(routeArgs(["install"])).toEqual({
    kind: "transcribe",
    argv: ["install"],
  });
});

test("routeArgs: filename that contains 'setup' substring isn't a subcommand", () => {
  // exact-match only; `setup-notes.m4a` is a filename, not setup
  expect(routeArgs(["setup-notes.m4a"])).toEqual({
    kind: "transcribe",
    argv: ["setup-notes.m4a"],
  });
});

test("setupScriptPath returns paths to the bash scripts", () => {
  expect(setupScriptPath("setup")).toMatch(/scripts\/setup-all\.sh$/);
  expect(setupScriptPath("setup:mlx")).toMatch(/scripts\/setup-mlx\.sh$/);
  expect(setupScriptPath("setup:cpp")).toMatch(/scripts\/setup-cpp\.sh$/);
});

test("readPackageVersion returns the version from package.json", () => {
  // Just verify shape: matches MAJOR.MINOR.PATCH. The exact value is the
  // version we publish, so don't hardcode it.
  expect(readPackageVersion()).toMatch(/^\d+\.\d+\.\d+/);
});
