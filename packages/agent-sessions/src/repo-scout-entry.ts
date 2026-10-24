import { join } from "node:path";

/** The core checkout's CLI entry, shared by launch and root discovery. */
export function repoScoutEntrypoint(repoRoot: string): string {
  return join(repoRoot, "packages", "cli", "bin", "scout.mjs");
}
