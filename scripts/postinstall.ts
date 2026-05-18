#!/usr/bin/env bun
// Postinstall — runs during `bun add @ilyavorobiev/transcribe` (and the
// equivalent `npm i -g`, `yarn add`, etc.).
//
// Strict contract: never builds, never downloads, never fails the install.
// We've got ~20 GB of engine + model installation work, and that has to be
// an explicit user step (`transcribe setup`), not silently triggered by a
// package manager. See specs/publish/spec.md §6.5.
//
// On exit 0 the install completes normally. The package.json scripts entry
// is wrapped in `|| true` as belt-and-suspenders, but exiting non-zero here
// would still be hostile (it pollutes install logs), so we always exit 0.

export type SkipReason =
  | { skip: false }
  | { skip: true; reason: string };

export interface PostinstallEnv {
  CI?: string | undefined;
  TRANSCRIBE_SKIP_POSTINSTALL?: string | undefined;
  npm_config_production?: string | undefined;
  npm_config_global?: string | undefined;
  platform: NodeJS.Platform;
}

// Pure. Tested.
export function decideSkip(env: PostinstallEnv): SkipReason {
  if (env.platform !== "darwin") {
    return { skip: true, reason: `unsupported platform: ${env.platform} (macOS only)` };
  }
  if (truthy(env.TRANSCRIBE_SKIP_POSTINSTALL)) {
    return { skip: true, reason: "TRANSCRIBE_SKIP_POSTINSTALL is set" };
  }
  if (truthy(env.CI)) {
    return { skip: true, reason: "running in CI (CI=true)" };
  }
  if (truthy(env.npm_config_production)) {
    return { skip: true, reason: "production install (npm --production)" };
  }
  return { skip: false };
}

function truthy(v: string | undefined): boolean {
  if (v === undefined) return false;
  const s = v.toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

const BANNER = `
================================================================
  @ilyavorobiev/transcribe installed.

  Next step (one-time, ~15-30 min, ~20 GB):

      transcribe setup

  This installs all three engines (mlx / cpp / gigaam) and the
  default models. Narrower options are available — run:

      transcribe setup --help

  Then transcribe an audio file:

      transcribe path/to/memo.m4a

  Docs: https://github.com/ilyavorobiev/transcribe
================================================================
`;

const SKIP_PREFIX = "transcribe: postinstall skipped";

export function buildMessage(decision: SkipReason): string {
  if (decision.skip) return `${SKIP_PREFIX}: ${decision.reason}\n`;
  return BANNER;
}

function currentEnv(): PostinstallEnv {
  return {
    CI: process.env.CI,
    TRANSCRIBE_SKIP_POSTINSTALL: process.env.TRANSCRIBE_SKIP_POSTINSTALL,
    npm_config_production: process.env.npm_config_production,
    npm_config_global: process.env.npm_config_global,
    platform: process.platform,
  };
}

function main(): void {
  const decision = decideSkip(currentEnv());
  process.stdout.write(buildMessage(decision));
  process.exit(0);
}

if (import.meta.main) {
  main();
}
