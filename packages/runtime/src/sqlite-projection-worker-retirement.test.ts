import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const mode of ["watchdog-success", "watchdog-error", "close-success", "close-error", "post-error", "dispatch-error", "rpc-post-error", "entry-result-post-error", "entry-error-post-error"]) {
  test(`projection worker retirement: ${mode} cannot escape and the next request recovers`, async () => {
    const root = await mkdtemp(join(tmpdir(), "scout-projection-retirement-"));
    const child = Bun.spawn({
      cmd: [process.execPath, new URL("./test-helpers/projection-retirement-child.ts", import.meta.url).pathname, mode, root],
      stdout: "pipe", stderr: "pipe",
    });
    const timer = setTimeout(() => child.kill(), 15_000);
    try {
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
      expect(JSON.parse(stdout.trim())).toEqual({ mode, survived: true, recovered: true, pending: 0 });
    } finally { clearTimeout(timer); child.kill(); await child.exited; await rm(root, { recursive: true, force: true }); }
  }, 20_000);
}
