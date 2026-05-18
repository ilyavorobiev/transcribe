// Pure parser for `transcribe setup` flags. The bash orchestrator
// (scripts/setup-all.sh) implements the actual install logic; this TS
// module exists to unit-test the flag combinations and to let the CLI
// validate flag combos before exec'ing bash.

export type InstallItem = "mlx" | "antony66" | "bond005" | "cpp" | "gigaam";
export const INSTALL_ITEMS: readonly InstallItem[] = [
  "mlx", "antony66", "bond005", "cpp", "gigaam",
];

// Default install set per specs/install-optimization/spec.md §6.1.
// mlx implies antony66 (the Russian fine-tune is the whole point of the
// minimal install). Users who want JUST the engine binary without the
// model can use setup:mlx --no-model.
export const DEFAULT_INSTALL_SET: ReadonlySet<InstallItem> = new Set(["mlx", "antony66"]);

export const FULL_INSTALL_SET: ReadonlySet<InstallItem> = new Set(INSTALL_ITEMS);

export interface SetupParse {
  set: Set<InstallItem>;
  force: boolean;
  clean: boolean;
  wipe: boolean;
  deprecationWarnings: string[];
}

export class SetupArgError extends Error {}

const WITH_VALID = new Set<InstallItem>(["mlx", "antony66", "bond005", "cpp", "gigaam"]);
// Map deprecated --no-* flags to the install item they remove. --no-mlx
// historically removed both the engine and bond005 (bond005 needs mlx);
// model that here so a user passing --no-mlx gets the right footprint.
const NO_FLAG_REMOVES: Record<string, readonly InstallItem[]> = {
  "--no-mlx": ["mlx", "antony66", "bond005"],
  "--no-cpp": ["cpp"],
  "--no-gigaam": ["gigaam"],
  "--no-bond005": ["bond005"],
};

export function parseSetupArgs(argv: readonly string[]): SetupParse {
  let force = false;
  let clean = false;
  let wipe = false;
  let fullExplicit = false;
  const withItems = new Set<InstallItem>();
  const removeItems = new Set<InstallItem>();
  const deprecationWarnings: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case "--full":
        fullExplicit = true;
        break;
      case "--with": {
        const v = argv[i + 1];
        if (v === undefined) throw new SetupArgError("--with requires a value");
        if (!WITH_VALID.has(v as InstallItem)) {
          throw new SetupArgError(
            `--with: unknown component '${v}' (valid: ${[...WITH_VALID].join(", ")})`,
          );
        }
        withItems.add(v as InstallItem);
        i++;
        break;
      }
      case "--force":
        force = true;
        break;
      case "--clean":
        clean = true;
        break;
      case "--wipe":
        wipe = true;
        break;
      default:
        if (a in NO_FLAG_REMOVES) {
          for (const item of NO_FLAG_REMOVES[a]!) removeItems.add(item);
          deprecationWarnings.push(
            `${a} is deprecated; use '--full' and rely on the minimal default instead, ` +
              `or pass '--with' for individual components. ${a} will be removed in 1.0.0.`,
          );
        } else if (a.startsWith("--")) {
          throw new SetupArgError(`Unknown setup flag: ${a}`);
        } else {
          throw new SetupArgError(`Unexpected positional arg: ${a}`);
        }
    }
  }

  // Conflict: explicit --with X and --no-X is contradictory.
  for (const item of withItems) {
    if (removeItems.has(item)) {
      throw new SetupArgError(
        `Conflicting flags: --with ${item} and --no-${item} cannot be combined`,
      );
    }
  }

  // Compose the install set. Start point depends on flags:
  //   - --full or any --no-* present → start from FULL_INSTALL_SET
  //     (deprecated --no-* historically meant "everything minus this")
  //   - else → start from DEFAULT_INSTALL_SET (mlx + antony66)
  // Then apply --with adders and --no-* removers.
  const startFromFull = fullExplicit || removeItems.size > 0;
  const set = new Set<InstallItem>(
    startFromFull ? FULL_INSTALL_SET : DEFAULT_INSTALL_SET,
  );
  for (const item of withItems) set.add(item);
  for (const item of removeItems) set.delete(item);

  // mlx is a prerequisite for antony66 + bond005. If user removes mlx but
  // keeps the models, the install would fail mid-flight — fail-fast here.
  if (!set.has("mlx") && (set.has("antony66") || set.has("bond005"))) {
    throw new SetupArgError(
      "antony66 and bond005 require the mlx engine; cannot install them without mlx",
    );
  }

  return { set, force, clean, wipe, deprecationWarnings };
}

// Serialize a parsed install set back into the env-var format that the
// bash orchestrator reads. setup-all.sh consumes TRANSCRIBE_INSTALL_SET
// as a comma-separated list (new path; falls back to its own --with
// parsing for backwards-compat when the env isn't set).
export function installSetToEnv(set: ReadonlySet<InstallItem>): string {
  return [...set].join(",");
}
