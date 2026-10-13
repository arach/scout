// Loaded only by owned broker test subprocesses, never by production entrypoints.
// Routing fixtures need deterministic admission regardless of the host's APFS
// reserve. Dedicated storage-pressure tests continue to exercise real policy.
import { mock } from "bun:test";
import * as filesystem from "node:fs/promises";

const realStatfs = filesystem.statfs;
const controlHome = process.env.OPENSCOUT_CONTROL_HOME;
mock.module("node:fs/promises", () => ({
  ...filesystem,
  async statfs(path: Parameters<typeof realStatfs>[0], options?: any) {
    const result = await realStatfs(path, options);
    if (!controlHome || String(path) !== controlHome) return result;
    return { ...result, bavail: typeof result.bavail === "bigint" ? 1_048_576n : 1_048_576 };
  },
}));
