import { expect, test } from "bun:test";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

const runtimeDirectory = fileURLToPath(new URL(".", import.meta.url));
const routerPath = fileURLToPath(
  new URL("./broker-trpc-router.ts", import.meta.url),
);
const bufferPath = fileURLToPath(
  new URL("./tail/replay-buffer.ts", import.meta.url),
);
const fixturePath = new URL("./test-fixtures/tail-barrier.ts", import.meta.url);

async function run(mode: string) {
  return await new Promise<any>((resolve, reject) => {
    const worker = new Worker(fixturePath, {
      workerData: { mode, routerPath, bufferPath, runtimeDirectory },
    });
    let result: any;
    // A failing instrument is terminated, never counted as clean success.
    const guard = setTimeout(() => {
      void worker.terminate();
      reject(new Error("Tail barrier fixture watchdog"));
    }, 15_000);
    worker.on("message", (value) => {
      result = value;
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      clearTimeout(guard);
      if (code === 0 && result?.clean) resolve(result);
      else reject(new Error("Tail barrier fixture exited " + code));
    });
  });
}

test("actual tail procedure retains a publication during suspended replay", async () => {
  expect((await run("direct")).result.received).toEqual(["A", "B", "C", "D"]);
}, 20_000);
test("installed WS adapter retains replay/live handoff and exact legacy tracked frames", async () => {
  expect((await run("ws")).result.legacyFramesUnchanged).toBe(true);
}, 20_000);
test("equal event IDs at distinct ordinals are both delivered", async () => {
  expect((await run("duplicate")).result.summaries).toEqual([
    "first occurrence",
    "B",
    "second occurrence",
    "D",
  ]);
}, 20_000);
test("outer replay cursor is committed before generator suspension", async () => {
  expect((await run("cursor-replay")).result.lastDeliveredId).toBe("A");
}, 20_000);
test("outer live cursor is committed before generator suspension", async () => {
  expect((await run("cursor-live")).result.lastDeliveredId).toBe("live");
}, 20_000);
test("live overflow interrupts replay with the outer replay cursor", async () => {
  expect((await run("overflow")).result.terminalBeforeReplayB).toBe(true);
}, 20_000);

test("return and abort wake pending live reads and remove the actual router listener", async () => {
  expect((await run("lifecycle")).result.returnWakesPendingNext).toBe(true);
}, 20_000);
test("legacy since/source cursor matrix remains unchanged", async () => {
  expect((await run("matrix")).result.cases).toBe(12);
}, 20_000);
test("accounting, pre-yield overflow and formatting failures release the actual router listener", async () => {
  expect((await run("exceptional")).result.formattingCleanup).toBe(true);
}, 20_000);

test("publication after the last replay yield remains queued at the live transition", async () => {
  expect((await run("after-last")).result.covered).toBe(true);
}, 20_000);

test("WS disconnect aborts the pending live reader without a subscription stop", async () => {
  expect((await run("ws-disconnect")).result.disconnectCleanup).toBe(true);
}, 20_000);
