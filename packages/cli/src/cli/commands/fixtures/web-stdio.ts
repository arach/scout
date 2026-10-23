// Exercise the real install, then the next command's lazy stdout initialization.
// The GC schedule follows https://github.com/oven-sh/bun/pull/44581: an older
// Bun finalizes stdio sinks against the wrong epoll while a synchronous child is active.
import { createHash } from "node:crypto";
import { readFileSync, writeSync } from "node:fs";
import { createScoutCommandContext } from "../../context.ts";
import { mock } from "bun:test";
// --no-restart never calls server control. Keep unrelated service discovery out
// of the deliberately allocation-heavy GC child (and away from real services).
mock.module("../server.ts", () => ({ requestScoutWebControl() { throw new Error("Unexpected server control"); } }));
const { runWebCommand } = await import("../web.ts");

const tarball = new Uint8Array(readFileSync(process.argv[2]!));
const held = globalThis as typeof globalThis & { stdioSinks: unknown };
held.stdioSinks = Array.from({ length: 4 }, () => {
  const sink = Bun.file(1).writer();
  sink.write("");
  return sink;
});
await Bun.sleep(0);
const original = Bun.spawnSync;
Bun.spawnSync = ((options: { cmd: string[]; maxBuffer?: number }) => original({
  ...options,
  get maxBuffer() {
    Bun.gc(true);
    held.stdioSinks = null;
    return options.maxBuffer;
  },
})) as typeof Bun.spawnSync;
try {
  await runWebCommand(createScoutCommandContext({ env: { SCOUT_DIST_KEY: "osdist_stdio_regression" }, isTty: false, stdout() {}, stderr() {} }), ["install", "--no-restart"], {
    supportDirectory: process.argv[3]!, version: "9.8.7", keyStores: [],
    fetchImpl: async () => new Response(tarball, { headers: { "x-openscout-sha256": createHash("sha256").update(tarball).digest("hex") } }),
  });
} finally {
  Bun.spawnSync = original;
}
held.stdioSinks = null;
Bun.gc(true);
await Bun.sleep(50);
// Do not preinitialize process.stdout: this is where the following test failed.
createScoutCommandContext({ env: {}, stdout() {}, stderr() {} });
process.stdout.write("stdio survived install\n");
writeSync(2, "stdio regression finished\n");
