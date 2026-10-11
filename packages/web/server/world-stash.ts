import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertTestIsolatedUserData, resolveOpenScoutSupportPaths } from "@openscout/runtime/support-paths";

export const WORLD_STASH_CAP = 256 * 1024;
export type WorldStash = Record<string, unknown>[];
export function isWorldStash(value: unknown): value is WorldStash {
  return Array.isArray(value) && value.every(card => card !== null && typeof card === "object" && !Array.isArray(card));
}
export function createWorldStashStore(filePath?: string) {
  const path = filePath ?? join(resolveOpenScoutSupportPaths().controlHome, "world-modale-stash.json");
  return {
    async read(): Promise<WorldStash> {
      try {
        if ((await stat(path)).size > WORLD_STASH_CAP) throw new Error("World stash exceeds size limit");
        const value: unknown = JSON.parse(await readFile(path, "utf8"));
        if (!isWorldStash(value)) throw new Error("Invalid World stash file");
        return value;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    },
    async write(cards: WorldStash): Promise<void> {
      if (!filePath) assertTestIsolatedUserData("write the World stash", "OPENSCOUT_CONTROL_HOME");
      if (!isWorldStash(cards)) throw new Error("Invalid World stash");
      const json = JSON.stringify(cards);
      if (Buffer.byteLength(json) > WORLD_STASH_CAP) throw new Error("World stash exceeds size limit");
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, json, { encoding: "utf8", mode: 0o600 });
        await rename(temporary, path);
      } finally { await rm(temporary, { force: true }); }
    },
  };
}
