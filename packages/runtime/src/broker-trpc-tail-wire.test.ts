import { expect, test } from "bun:test";
import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const runtimeDirectory = fileURLToPath(new URL(".", import.meta.url));
const routerPath = fileURLToPath(
  new URL("./broker-trpc-router.ts", import.meta.url),
);
const bufferPath = fileURLToPath(
  new URL("./tail/replay-buffer.ts", import.meta.url),
);
const fixturePath = new URL("./test-fixtures/tail-wire.ts", import.meta.url);
// Default: installed workspace client. Evidence also pins the exact 11.16.0
// client in an external scratch install without changing another lane's lock.
const clientModule =
  process.env.TAIL_WIRE_CLIENT_MODULE ??
  createRequire(new URL("../../web/package.json", import.meta.url)).resolve(
    "@trpc/client",
  );
const remoteModule = process.env.TAIL_WIRE_REMOTE_MODULE;
async function run(mode: string) {
  return await new Promise<any>((resolve, reject) => {
    const worker = new Worker(fixturePath, {
      workerData: {
        mode,
        routerPath,
        bufferPath,
        runtimeDirectory,
        clientModule,
        remoteModule,
      },
    });
    let result: any;
    const guard = setTimeout(() => {
      void worker.terminate();
      reject(new Error("Tail wire fixture watchdog"));
    }, 15_000);
    worker.on("message", (value) => {
      result = value;
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      clearTimeout(guard);
      if (code === 0 && result?.clean) resolve(result.result);
      else reject(new Error("Tail wire fixture exited " + code));
    });
  });
}
test("negotiated status is first and unique across exact cursor/source/window matrix", async () => {
  expect((await run("matrix")).cases).toBe(31);
}, 20_000);
test("legacy has no status; invalid negotiation refuses before attachment", async () => {
  expect((await run("negotiation")).invalid).toBe(8);
}, 20_000);
test("epoch is process-owned, changes on reset/restart, and cross-epoch ID never found", async () => {
  const a = await run("epochs"),
    b = await run("epochs");
  expect(a.processEpoch).not.toBe(b.processEpoch);
}, 20_000);
test("new status, error, cancellation and reset paths release capture custody", async () => {
  expect((await run("lifetime")).cycles).toBe(30);
}, 20_000);
test("installed WS adapter and JS client preserve untracked status and structured resync", async () => {
  expect((await run("transport")).realClient).toBe(true);
}, 20_000);
test.skipIf(!remoteModule)(
  "unchanged C raw codec accepts legacy and retains its own delivered cursor",
  async () => {
    expect((await run("legacy-codec")).serverAheadIgnored).toBe(true);
  },
  20_000,
);
