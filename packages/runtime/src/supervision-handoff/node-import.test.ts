import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

test("Node imports the compiled handoff index and gets typed unavailable native evidence", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "r0-node-import-")));
  let stopFixture: (() => Promise<void>) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const compiled = join(root, "compiled"), supportDirectory = join(root, "support");
    mkdirSync(compiled); mkdirSync(supportDirectory, { mode: 0o700 });
    writeFileSync(join(compiled, "package.json"), JSON.stringify({ type: "module" }));
    const transpiler = new Bun.Transpiler({ loader: "ts", target: "node" });
    for (const name of ["index", "contracts", "store", "process-evidence", "process-sampling", "darwin-process-source"]) {
      // Preserve the actual ESM graph instead of bundling or stubbing native imports.
      writeFileSync(join(compiled, name + ".js"), transpiler.transformSync(readFileSync(join(import.meta.dir, name + ".ts"), "utf8")));
    }
    const script = `
      import assert from "node:assert/strict";
      import { readdirSync } from "node:fs";
      const sdk = await import(${JSON.stringify(pathToFileURL(join(compiled, "index.js")).href)});
      assert.equal(typeof globalThis.Bun, "undefined");
      const instance = { uid: process.geteuid(), id: "node-import-fixture", supportDirectory: ${JSON.stringify(supportDirectory)} };
      const reader = sdk.createProcessEvidenceReader(instance);
      const result = reader.sample(process.pid);
      assert.deepEqual(result, { state: "unavailable", reason: process.platform === "darwin" && ["arm64", "x64"].includes(process.arch)
        ? "native_binding_unavailable" : "unsupported_platform" });
      assert.equal(sdk.productionHandoffReadiness().ready, false);
      assert.deepEqual(readdirSync(instance.supportDirectory), []);
      const store = await import(${JSON.stringify(pathToFileURL(join(compiled, "store.js")).href)});
      assert.throws(() => store.acquireOwnershipLock(-1), error => error.code === "ownership_lock_unsupported");
      console.log("node-import-unavailable-ok");
    `;
    const child = Bun.spawn(["node", "--input-type=module", "--eval", script], {
      stdout: "pipe", stderr: "pipe", env: { ...process.env, HOME: root, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
    });
    stopFixture = async () => { child.kill("SIGKILL"); await child.exited; };
    const run = Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    const [exit, stdout, stderr] = await Promise.race([run, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Node import fixture timed out")), 10_000);
    })]);
    expect(stderr).toBe("");
    expect(exit).toBe(0);
    expect(stdout.trim()).toBe("node-import-unavailable-ok");
  } finally {
    clearTimeout(timer);
    await stopFixture?.();
    rmSync(root, { recursive: true, force: true });
  }
}, 15_000);
