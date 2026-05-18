import { expect, test } from "bun:test";
import {
  DEFAULT_INSTALL_SET,
  FULL_INSTALL_SET,
  installSetToEnv,
  parseSetupArgs,
  SetupArgError,
  type InstallItem,
} from "./setup-args.ts";

function setOf(...items: InstallItem[]): Set<InstallItem> {
  return new Set(items);
}

// -- default + --full -------------------------------------------------------

test("no flags → minimal default (mlx + antony66)", () => {
  const r = parseSetupArgs([]);
  expect(r.set).toEqual(setOf("mlx", "antony66"));
  expect(r.force).toBe(false);
  expect(r.clean).toBe(false);
  expect(r.wipe).toBe(false);
  expect(r.deprecationWarnings).toEqual([]);
});

test("--full → every item", () => {
  const r = parseSetupArgs(["--full"]);
  expect(r.set).toEqual(new Set(FULL_INSTALL_SET));
});

test("DEFAULT and FULL constants are what callers expect", () => {
  expect(DEFAULT_INSTALL_SET).toEqual(setOf("mlx", "antony66"));
  expect(FULL_INSTALL_SET).toEqual(setOf("mlx", "antony66", "bond005", "cpp", "gigaam"));
});

// -- --with adders -----------------------------------------------------------

test("--with cpp on top of minimal default", () => {
  const r = parseSetupArgs(["--with", "cpp"]);
  expect(r.set).toEqual(setOf("mlx", "antony66", "cpp"));
});

test("--with repeated", () => {
  const r = parseSetupArgs(["--with", "cpp", "--with", "gigaam"]);
  expect(r.set).toEqual(setOf("mlx", "antony66", "cpp", "gigaam"));
});

test("--with bond005 adds bond005 (mlx already in default)", () => {
  const r = parseSetupArgs(["--with", "bond005"]);
  expect(r.set).toEqual(setOf("mlx", "antony66", "bond005"));
});

test("--with unknown → SetupArgError", () => {
  expect(() => parseSetupArgs(["--with", "bogus"])).toThrow(SetupArgError);
});

test("--with missing value → SetupArgError", () => {
  expect(() => parseSetupArgs(["--with"])).toThrow(SetupArgError);
});

// -- --no-* deprecation backwards-compat -------------------------------------

test("--no-cpp → start from FULL, remove cpp, emit deprecation warning", () => {
  const r = parseSetupArgs(["--no-cpp"]);
  expect(r.set).toEqual(setOf("mlx", "antony66", "bond005", "gigaam"));
  expect(r.deprecationWarnings).toHaveLength(1);
  expect(r.deprecationWarnings[0]).toMatch(/--no-cpp is deprecated/);
});

test("--no-gigaam --no-bond005 stacks (still emits each warning)", () => {
  const r = parseSetupArgs(["--no-gigaam", "--no-bond005"]);
  expect(r.set).toEqual(setOf("mlx", "antony66", "cpp"));
  expect(r.deprecationWarnings).toHaveLength(2);
});

test("--no-mlx historically removes mlx + antony66 + bond005", () => {
  // Because antony66 and bond005 are MLX-only models.
  const r = parseSetupArgs(["--no-mlx"]);
  expect(r.set).toEqual(setOf("cpp", "gigaam"));
});

test("--with cpp --no-cpp → SetupArgError (conflicting)", () => {
  expect(() => parseSetupArgs(["--with", "cpp", "--no-cpp"])).toThrow(/Conflicting flags/);
});

// -- mlx prerequisite check --------------------------------------------------

test("--no-mlx with explicit --with antony66 → SetupArgError", () => {
  // --no-mlx also implies --no-antony66 (mlx prerequisite), so this trips
  // the conflict check before reaching the mlx-requires check. Either
  // error message is fine; the contract is "don't silently produce a
  // broken install".
  expect(() => parseSetupArgs(["--no-mlx", "--with", "antony66"])).toThrow(SetupArgError);
});

test("--no-mlx with no explicit --with → just drops antony66/bond005 silently (legit footprint)", () => {
  const r = parseSetupArgs(["--no-mlx"]);
  expect(r.set).toEqual(setOf("cpp", "gigaam"));
});

// -- --force / --clean / --wipe ---------------------------------------------

test("--force / --clean / --wipe parse independently", () => {
  const r = parseSetupArgs(["--clean", "--force", "--wipe"]);
  expect(r.force).toBe(true);
  expect(r.clean).toBe(true);
  expect(r.wipe).toBe(true);
  // No install items beyond default unless --with or --full is also passed.
  expect(r.set).toEqual(setOf("mlx", "antony66"));
});

test("--full --force preserves both", () => {
  const r = parseSetupArgs(["--full", "--force"]);
  expect(r.set).toEqual(new Set(FULL_INSTALL_SET));
  expect(r.force).toBe(true);
});

// -- error surface -----------------------------------------------------------

test("unknown flag → SetupArgError", () => {
  expect(() => parseSetupArgs(["--bogus"])).toThrow(SetupArgError);
});

test("unexpected positional → SetupArgError", () => {
  expect(() => parseSetupArgs(["positional-arg"])).toThrow(SetupArgError);
});

// -- env serialization -------------------------------------------------------

test("installSetToEnv produces the comma-separated form bash reads", () => {
  expect(installSetToEnv(setOf("mlx", "antony66"))).toBe("mlx,antony66");
  expect(installSetToEnv(setOf("cpp"))).toBe("cpp");
  expect(installSetToEnv(new Set())).toBe("");
});
