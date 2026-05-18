import { expect, test } from "bun:test";
import { buildMessage, decideSkip, type PostinstallEnv } from "../scripts/postinstall.ts";

function env(overrides: Partial<PostinstallEnv> = {}): PostinstallEnv {
  return {
    CI: undefined,
    TRANSCRIBE_SKIP_POSTINSTALL: undefined,
    npm_config_production: undefined,
    npm_config_global: undefined,
    platform: "darwin",
    ...overrides,
  };
}

test("decideSkip: clean macOS user install → run the banner", () => {
  expect(decideSkip(env())).toEqual({ skip: false });
});

test("decideSkip: non-darwin always skips (npm os field also blocks install, but defend in depth)", () => {
  for (const platform of ["linux", "win32", "freebsd"] as const) {
    const decision = decideSkip(env({ platform }));
    expect(decision.skip).toBe(true);
    if (decision.skip) {
      expect(decision.reason).toMatch(/macOS only/);
    }
  }
});

test("decideSkip: TRANSCRIBE_SKIP_POSTINSTALL=1 skips", () => {
  expect(decideSkip(env({ TRANSCRIBE_SKIP_POSTINSTALL: "1" }))).toEqual({
    skip: true,
    reason: "TRANSCRIBE_SKIP_POSTINSTALL is set",
  });
});

test("decideSkip: TRANSCRIBE_SKIP_POSTINSTALL=true/yes also skip (truthy)", () => {
  expect(decideSkip(env({ TRANSCRIBE_SKIP_POSTINSTALL: "true" })).skip).toBe(true);
  expect(decideSkip(env({ TRANSCRIBE_SKIP_POSTINSTALL: "yes" })).skip).toBe(true);
});

test("decideSkip: TRANSCRIBE_SKIP_POSTINSTALL=0/false/empty does NOT skip on its own", () => {
  expect(decideSkip(env({ TRANSCRIBE_SKIP_POSTINSTALL: "0" })).skip).toBe(false);
  expect(decideSkip(env({ TRANSCRIBE_SKIP_POSTINSTALL: "false" })).skip).toBe(false);
  expect(decideSkip(env({ TRANSCRIBE_SKIP_POSTINSTALL: "" })).skip).toBe(false);
});

test("decideSkip: CI=true skips (avoid polluting CI logs across the ecosystem)", () => {
  expect(decideSkip(env({ CI: "true" })).skip).toBe(true);
  expect(decideSkip(env({ CI: "1" })).skip).toBe(true);
});

test("decideSkip: npm --production skips (no banner for prod transitive installs)", () => {
  expect(decideSkip(env({ npm_config_production: "true" })).skip).toBe(true);
});

test("decideSkip: platform check fires before any env-var check", () => {
  // Non-darwin with TRANSCRIBE_SKIP_POSTINSTALL set still reports the platform
  // reason; that's the more informative one for a Linux/Windows user.
  const decision = decideSkip(env({
    platform: "linux",
    TRANSCRIBE_SKIP_POSTINSTALL: "1",
  }));
  expect(decision.skip).toBe(true);
  if (decision.skip) {
    expect(decision.reason).toMatch(/macOS only/);
  }
});

test("buildMessage: skip decision → 'postinstall skipped: <reason>'", () => {
  const msg = buildMessage({ skip: true, reason: "CI=true" });
  expect(msg).toMatch(/postinstall skipped: CI=true/);
});

test("buildMessage: run decision → banner with next-step pointer", () => {
  const msg = buildMessage({ skip: false });
  expect(msg).toMatch(/transcribe setup/);
  // Spec is explicit: postinstall never builds, never downloads. The banner
  // must point at the explicit setup step, not promise auto-installation.
  expect(msg).not.toMatch(/downloading/i);
  expect(msg).not.toMatch(/building/i);
});
