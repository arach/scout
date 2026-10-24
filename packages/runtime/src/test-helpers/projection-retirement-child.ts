// Run without unhandledRejection listeners: a rejected message callback must
// fail this disposable child, not take down the test runner or a live broker.
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Worker } from "node:worker_threads";
import { FileBackedBrokerJournal } from "../broker-journal.js";
import { WorkerSQLiteProjection } from "../sqlite-projection-worker.js";

const [mode, root] = process.argv.slice(2);
const journalPath = join(root!, "journal.jsonl"), dbPath = join(root!, "control.sqlite");
const journal = new FileBackedBrokerJournal(journalPath);
await journal.load();
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const entered = deferred<void>(), release = deferred<void>(), finished = deferred<void>();
const capture = journal.captureReplayBoundary.bind(journal);
let held = false;
if (mode !== "dispatch-error" && mode !== "rpc-post-error" && !mode?.startsWith("entry-")) {
  journal.captureReplayBoundary = async (options) => {
    if (held) return capture(options);
    held = true; entered.resolve();
    try { await release.promise; return await capture(options); }
    finally { finished.resolve(); }
  };
}
let workerUrl: URL | undefined;
if (mode === "dispatch-error" || mode?.startsWith("entry-")) {
  const path = join(root!, "worker.ts"), marker = join(root!, "sent-malformed");
  const entryUrl = new URL("../sqlite-projection-worker-entry.ts", import.meta.url), entry = entryUrl.href;
  let firstEntry = entry;
  if (mode.startsWith("entry-")) {
    // Bun's parentPort methods are readonly. Substitute only the port binding
    // in an otherwise exact entry module, without adding a production seam.
    const instrumented = (await readFile(entryUrl, "utf8"))
      .replace(/import "(\.\/[^\"]+)\.js"/g, (_match, relative: string) => `import ${JSON.stringify(new URL(`${relative}.ts`, entryUrl).href)}`)
      .replace(/from "(\.\/[^\"]+)\.js"/g, (_match, relative: string) => `from ${JSON.stringify(new URL(`${relative}.ts`, entryUrl).href)}`)
      .replace("const port = parentPort;", `let attempts = 0;
        const port = { on: parentPort.on.bind(parentPort), close: parentPort.close.bind(parentPort),
          postMessage(packet: any) {
            if (packet.kind === "result") {
              writeFileSync(${JSON.stringify(join(root!, "reply-attempts"))}, String(++attempts));
              throw new DOMException("fixture closed parent port", "InvalidStateError");
            }
            return parentPort.postMessage(packet);
          } };
        import {writeFileSync} from "node:fs";`);
    const instrumentedPath = join(root!, "entry.ts");
    await writeFile(instrumentedPath, instrumented); firstEntry = pathToFileURL(instrumentedPath).href;
  }
  await writeFile(path, `import {parentPort} from "node:worker_threads";
    import {existsSync,writeFileSync} from "node:fs";
    if (!existsSync(${JSON.stringify(marker)})) {
      writeFileSync(${JSON.stringify(marker)}, "once");
      ${mode === "dispatch-error" ? 'parentPort.on("message", () => parentPort.postMessage(null));' : `await import(${JSON.stringify(firstEntry)});`}
    } else { await import(${JSON.stringify(entry)}); }`);
  workerUrl = pathToFileURL(path);
}
const projection = new WorkerSQLiteProjection(dbPath, journalPath, journal, { requestTimeoutMs: 2_000, workerUrl });
const workerOf = () => (projection as unknown as { worker: Worker }).worker;
const outcome = (promise: Promise<unknown>) => promise.then(() => null, error => error as Error);
const drain = () => new Promise<void>(resolve => setImmediate(resolve));
let recovery: WorkerSQLiteProjection = projection;
try {
  if (mode?.startsWith("entry-")) {
    const request = mode === "entry-error-post-error"
      ? (projection as unknown as { rpc(method: string, args: unknown[]): Promise<void> }).rpc("constructor", [])
      : projection.warm();
    const failure = await outcome(request);
    assert(failure instanceof Error);
    assert.equal(projection.statusSnapshot().state, "degraded");
    assert.equal(await readFile(join(root!, "reply-attempts"), "utf8").catch(() => { throw failure; }), "1");
  } else if (mode === "dispatch-error") {
    assert(await outcome(projection.warm()) instanceof Error);
    assert.equal(projection.statusSnapshot().state, "degraded");
  } else if (mode === "rpc-post-error") {
    await projection.warm(); await projection.flush();
    workerOf().postMessage = () => { throw new DOMException("fixture terminated worker", "InvalidStateError"); };
    assert(await outcome(projection.latestThreadSeq("conversation")) instanceof Error);
    assert.equal(projection.statusSnapshot().state, "degraded");
  } else {
    const warming = outcome(projection.warm()); // Observe RPC rejection immediately.
    const oldWorker = workerOf(), retired = once(oldWorker, "exit");
    await entered.promise;
    if (mode!.startsWith("watchdog")) {
      const failure = await warming;
      assert.match(failure?.message ?? "", /stalled/);
      assert.equal(projection.statusSnapshot().state, "degraded");
      assert.equal(projection.statusSnapshot().worker.pendingRequests, 0);
      await retired;
      // Start the replacement before releasing the old generation's await.
      await projection.warm(); await projection.flush();
      assert.notEqual(workerOf(), oldWorker);
      assert.equal(projection.statusSnapshot().state, "ready");
    } else if (mode!.startsWith("close")) {
      projection.close();
      assert.match((await warming)?.message ?? "", /closed/);
      await retired;
      recovery = new WorkerSQLiteProjection(dbPath, journalPath, journal);
    } else if (mode === "post-error") {
      oldWorker.postMessage = () => { throw new DOMException("fixture terminated worker", "InvalidStateError"); };
    } else throw new Error(`Unknown mode: ${mode}`);
    if (mode!.endsWith("error") && mode !== "post-error") release.reject(new Error("ENOSPC: fixture boundary capture failed"));
    else release.resolve();
    await finished.promise; await drain(); await drain();
    if (mode === "post-error") {
      assert.match((await warming)?.message ?? "", /fixture terminated/);
      assert.equal(projection.statusSnapshot().state, "degraded");
    }
  }
  await recovery.warm(); await recovery.flush();
  assert.equal(recovery.statusSnapshot().state, "ready");
  assert.equal(recovery.statusSnapshot().worker.pendingRequests, 0);
  assert.equal((await recovery.readMessages(["missing"])).size, 0);
  console.log(JSON.stringify({ mode, survived: true, recovered: true, pending: 0 }));
} finally { projection.close(); if (recovery !== projection) recovery.close(); }
