import { expect, test } from "bun:test";
import { decideInstallAction, type DecisionInput } from "./install-prompt.ts";

function input(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return {
    isTty: true,
    env: {},
    flag: "default",
    ...overrides,
  };
}

test("default + TTY → prompt", () => {
  expect(decideInstallAction(input())).toBe("prompt");
});

test("default + non-TTY → fail-fast (CI safety)", () => {
  expect(decideInstallAction(input({ isTty: false }))).toBe("fail-fast");
});

test("--no-auto-install always fail-fast (even with TTY + env=1)", () => {
  expect(decideInstallAction(input({ flag: "no-auto" }))).toBe("fail-fast");
  expect(decideInstallAction(input({
    flag: "no-auto", isTty: true, env: { TRANSCRIBE_AUTO_INSTALL: "1" },
  }))).toBe("fail-fast");
});

test("--auto-install + TTY → prompt", () => {
  expect(decideInstallAction(input({ flag: "auto" }))).toBe("prompt");
});

test("--auto-install + non-TTY → still fail-fast (no surprise downloads in scripts)", () => {
  expect(decideInstallAction(input({ flag: "auto", isTty: false }))).toBe("fail-fast");
});

test("TRANSCRIBE_AUTO_INSTALL=0/false/no → fail-fast", () => {
  for (const v of ["0", "false", "no", "FALSE", "No"]) {
    expect(decideInstallAction(input({ env: { TRANSCRIBE_AUTO_INSTALL: v } }))).toBe("fail-fast");
  }
});

test("TRANSCRIBE_AUTO_INSTALL=1/true/yes + TTY → prompt", () => {
  for (const v of ["1", "true", "yes", "TRUE", "Yes"]) {
    expect(decideInstallAction(input({ env: { TRANSCRIBE_AUTO_INSTALL: v } }))).toBe("prompt");
  }
});

test("TRANSCRIBE_AUTO_INSTALL=1 + non-TTY → fail-fast", () => {
  expect(decideInstallAction(input({
    isTty: false, env: { TRANSCRIBE_AUTO_INSTALL: "1" },
  }))).toBe("fail-fast");
});

test("TRANSCRIBE_AUTO_INSTALL=garbage (unrecognized) → default behavior (TTY)", () => {
  expect(decideInstallAction(input({ env: { TRANSCRIBE_AUTO_INSTALL: "maybe" } }))).toBe("prompt");
  expect(decideInstallAction(input({
    isTty: false, env: { TRANSCRIBE_AUTO_INSTALL: "maybe" },
  }))).toBe("fail-fast");
});

test("flag wins over env in both directions", () => {
  // --no-auto-install overrides TRANSCRIBE_AUTO_INSTALL=1
  expect(decideInstallAction(input({
    flag: "no-auto", env: { TRANSCRIBE_AUTO_INSTALL: "1" },
  }))).toBe("fail-fast");
  // --auto-install overrides TRANSCRIBE_AUTO_INSTALL=0
  expect(decideInstallAction(input({
    flag: "auto", env: { TRANSCRIBE_AUTO_INSTALL: "0" },
  }))).toBe("prompt");
});
