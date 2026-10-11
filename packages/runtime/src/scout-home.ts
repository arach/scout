import { existsSync, lstatSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

export interface ScoutHomeOptions {
  /** Inject HOME for sandboxes; never substitute the real home in tests. */
  home?: string;
  env?: NodeJS.ProcessEnv;
}

/** Pure resolution: importing or reading this module never moves user data. */
export function resolveScoutHome(options: ScoutHomeOptions = {}): string {
  const env = options.env ?? process.env;
  return env.SCOUT_HOME?.trim() || env.OPENSCOUT_HOME?.trim()
    || join(options.home ?? env.HOME?.trim() ?? homedir(), ".scout");
}

export function scoutHomeReadRoots(options: ScoutHomeOptions = {}): string[] {
  const env = options.env ?? process.env;
  const primary = resolveScoutHome(options);
  // Explicit overrides are isolation boundaries, not invitations to read real data.
  if (env.SCOUT_HOME?.trim() || env.OPENSCOUT_HOME?.trim()) return [primary];
  return [primary, join(options.home ?? env.HOME?.trim() ?? homedir(), ".openscout")];
}

function child(root: string, name: string): string {
  const result = resolve(root, name);
  const rel = relative(resolve(root), result);
  if (!name || isAbsolute(name) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error("Scout home paths must be nonempty relative paths inside the home");
  }
  return result;
}

/** New wins; missing files fall back to legacy. Never creates either home. */
export function scoutHomeReadPath(name: string, options: ScoutHomeOptions = {}): string {
  const candidates = scoutHomeReadRoots(options).map((root) => child(root, name));
  return candidates.find((path) => existsSync(path)) ?? candidates[0]!;
}

/** New-only target. Callers must complete the broker cutover before adoption. */
export function scoutHomeWritePath(name: string, options: ScoutHomeOptions = {}): string {
  return child(resolveScoutHome(options), name);
}

/**
 * Offline whole-root fast path, not a live-broker migration API.
 * The lifecycle owner must hold an exclusive admission lease across this call
 * and restart. A PID check, absent WAL, or SQLite backup is NOT such a lease.
 * Existing .scout trees need the journalled merge described in the plan.
 */
export function moveLegacyScoutHomeOffline(
  options: ScoutHomeOptions & { assertExclusiveOwnership: () => void },
): "moved" | "absent" | "overridden" {
  const env = options.env ?? process.env;
  if (env.SCOUT_HOME?.trim() || env.OPENSCOUT_HOME?.trim()) return "overridden";
  const [target, legacy] = scoutHomeReadRoots(options);
  if (!existsSync(legacy!)) return "absent";
  options.assertExclusiveOwnership();
  if (existsSync(target!)) throw new Error("Scout home merge requires the coordinated migration journal; neither home was changed");
  if (!lstatSync(legacy!).isDirectory() || lstatSync(legacy!).isSymbolicLink()) {
    throw new Error("Refusing to migrate a symlink or non-directory Scout home");
  }
  // Same-parent rename moves SQLite + WAL + SHM together without copying.
  // EXDEV and all other failures propagate; never fall back to a partial copy.
  renameSync(legacy!, target!);
  return "moved";
}
