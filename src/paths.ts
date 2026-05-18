import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const PROJECT_ROOT = resolve(import.meta.dir, "..");

// When the package is installed globally (e.g. ~/.bun/install/global/node_modules/
// @ilyavorobiev/transcribe), models in <pkg>/models/ would be wiped on
// `bun update -g`. So default cache dir is ~/Library/Caches/transcribe/ on
// macOS. Local dev (running from a source checkout) keeps using the legacy
// {PROJECT_ROOT}/{vendor,models} layout for the original author's sake.
export function cacheRoot(): string {
  const explicit = process.env.TRANSCRIBE_CACHE_DIR;
  if (explicit) return explicit;
  const xdg = process.env.XDG_CACHE_HOME;
  if (xdg) return join(xdg, "transcribe");
  // Honor $HOME for testability + parity with the setup-all.sh resolver.
  // os.homedir() doesn't pick up $HOME changes after libuv reads the passwd db.
  const home = process.env.HOME ?? homedir();
  return join(home, "Library", "Caches", "transcribe");
}

// "Local dev" = running from the source checkout. Detected by the presence
// of specs/ next to PROJECT_ROOT (the published tarball ships neither
// specs/ nor .git nor any sentinel we control). If true, we keep using the
// legacy <repo>/models and <repo>/vendor directories so the author's
// existing 20 GB of downloads aren't orphaned.
export function isLocalDev(): boolean {
  return existsSync(join(PROJECT_ROOT, "specs")) || existsSync(join(PROJECT_ROOT, ".git"));
}

export function cacheModelsDir(): string {
  return join(cacheRoot(), "models");
}

export function cacheVendorDir(): string {
  return join(cacheRoot(), "vendor");
}

// Resolution order:
//   1. WHISPER_BIN env (explicit override — single file)
//   2. <cache>/vendor/whisper.cpp/build/bin/whisper-cli
//   3. <repo>/vendor/whisper.cpp/build/bin/whisper-cli  (local dev only)
export function whisperBinaryPath(): string {
  const fromEnv = process.env.WHISPER_BIN;
  if (fromEnv) {
    if (!existsSync(fromEnv)) {
      throw new Error(`WHISPER_BIN points to a non-existent file: ${fromEnv}`);
    }
    return fromEnv;
  }
  const candidates = [
    join(cacheVendorDir(), "whisper.cpp", "build", "bin", "whisper-cli"),
  ];
  if (isLocalDev()) {
    candidates.push(join(PROJECT_ROOT, "vendor", "whisper.cpp", "build", "bin", "whisper-cli"));
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    `whisper-cli not found in:\n  ${candidates.join("\n  ")}\n` +
      `Run 'transcribe setup' (or 'bun run setup' from source) or set WHISPER_BIN.`,
  );
}

// Resolution order:
//   1. WHISPER_MODEL_DIR env (explicit override; no fallback)
//   2. <cache>/models
export function modelDir(): string {
  return process.env.WHISPER_MODEL_DIR ?? cacheModelsDir();
}

// Search plausible locations for a ggml model file. WHISPER_MODEL_DIR is a
// hard override (no fallback). Otherwise: cache dir, plus the legacy
// <repo>/models fallback for local dev so the author's existing downloads
// keep working.
export function modelPath(name: string): string {
  const filename = `ggml-${name}.bin`;
  const envOverride = process.env.WHISPER_MODEL_DIR;
  const candidates = envOverride
    ? [join(envOverride, filename)]
    : [join(cacheModelsDir(), filename)];
  if (!envOverride && isLocalDev()) {
    candidates.push(join(PROJECT_ROOT, "models", filename));
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    `Model file not found in:\n  ${candidates.join("\n  ")}\n` +
      `Run 'transcribe setup' (or 'bun run setup' from source) to download it.`,
  );
}

// MLX engine + GigaAM engine both store unpacked HF model directories (not
// single .bin files). They share the same cache root but the directory name
// is the alias-specific subdir under <cache>/models/.
//
// Returns the first plausible candidate that exists, OR the cache-default
// path (which may not yet exist). Callers should existsSync the result
// themselves and emit a setup hint on miss — that's what
// MissingLocalModelError / MissingGigaAmModelError already do.
export function resolveModelDirPath(subdir: string): string {
  const cacheCandidate = join(cacheModelsDir(), subdir);
  if (existsSync(cacheCandidate)) return cacheCandidate;
  if (isLocalDev()) {
    const repoCandidate = join(PROJECT_ROOT, "models", subdir);
    if (existsSync(repoCandidate)) return repoCandidate;
  }
  return cacheCandidate;
}
