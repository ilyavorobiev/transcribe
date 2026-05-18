// Decision function for what to do when an engine reports not-ready.
// Pure: pass it env + tty + flags, get back an action. The actual readline
// prompt + spawn live in cli.ts and are intentionally not in here.

export type InstallAction = "prompt" | "fail-fast";

export interface DecisionInput {
  isTty: boolean;
  env: {
    TRANSCRIBE_AUTO_INSTALL?: string | undefined;
  };
  flag: "auto" | "no-auto" | "default";
}

// Truthy parsing matches scripts/postinstall.ts: 1 / true / yes (case-
// insensitive). Anything else (including unset, "0", "false") is falsy.
function truthy(v: string | undefined): boolean {
  if (v === undefined) return false;
  const s = v.toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function falsy(v: string | undefined): boolean {
  if (v === undefined) return false;
  const s = v.toLowerCase();
  return s === "0" || s === "false" || s === "no";
}

export function decideInstallAction(input: DecisionInput): InstallAction {
  // Explicit flag wins over everything else.
  if (input.flag === "no-auto") return "fail-fast";
  if (input.flag === "auto") {
    // User said --auto-install. Even so, refuse on non-TTY; auto-install
    // in a script context is the kind of thing that turns a 30s CI run
    // into a 6 GB download. The user can pre-run setup if they want it.
    return input.isTty ? "prompt" : "fail-fast";
  }
  // No explicit flag: env wins.
  if (falsy(input.env.TRANSCRIBE_AUTO_INSTALL)) return "fail-fast";
  if (truthy(input.env.TRANSCRIBE_AUTO_INSTALL)) {
    return input.isTty ? "prompt" : "fail-fast";
  }
  // Default: prompt iff TTY.
  return input.isTty ? "prompt" : "fail-fast";
}
