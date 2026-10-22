import { expect, test } from "bun:test";
import { CODEX_WIRE_LOG_GAP_PREFIX, CodexWireLog } from "./codex-wire-log.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("wire logs serialize and batch appends so completion cannot overtake output", async () => {
  const first = deferred();
  const writes: Array<[string, string]> = [];
  const log = new CodexWireLog({
    setPaused: () => {}, onError: () => {},
    append: async (path, text) => {
      if (!writes.length) { writes.push([path, text]); await first.promise; }
      else writes.push([path, text]);
    },
  });
  log.append("stdout", "started\n");
  log.append("stdout", "delta\n");
  log.append("stdout", "completed\n");
  log.append("stderr", "diagnostic\n");
  log.append("stdout", "next\n");
  let flushed = false;
  const flush = log.flush().then(() => { flushed = true; });
  await Promise.resolve();
  expect(writes).toEqual([["stdout", "started\n"]]);
  expect(flushed).toBe(false);
  first.resolve();
  await flush;
  expect(writes).toEqual([["stdout", "started\n"], ["stdout", "delta\ncompleted\n"], ["stderr", "diagnostic\n"], ["stdout", "next\n"]]);
  expect(log.bufferedBytes).toBe(0);
  expect(log.bufferedEntries).toBe(0);
});

test("wire logs pause input at the high water mark and resume only after persistence", async () => {
  const gate = deferred();
  const pauses: boolean[] = [];
  const log = new CodexWireLog({
    highWaterBytes: 12, lowWaterBytes: 3,
    setPaused: (paused) => pauses.push(paused), onError: () => {},
    append: async () => gate.promise,
  });
  log.append("stdout", "first\n");
  log.append("stdout", "second\n");
  expect(log.bufferedBytes).toBe(13);
  expect(pauses).toEqual([true]);
  gate.resolve();
  await log.flush();
  expect(pauses).toEqual([true, false]);
});

test("wire logs bound small-line descriptors as well as bytes", async () => {
  const gate = deferred();
  const pauses: boolean[] = [];
  const log = new CodexWireLog({
    maxBufferedEntries: 3,
    setPaused: (paused) => pauses.push(paused), onError: () => {}, append: () => gate.promise,
  });
  for (let index = 0; index < 3; index += 1) log.append("stdout", "x");
  expect(pauses).toEqual([true]);
  gate.resolve();
  await log.flush();
  expect(pauses).toEqual([true, false]);
});

function enospc() { return Object.assign(new Error("disk full"), { code: "ENOSPC" }); }
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!predicate() && Date.now() < deadline) await Bun.sleep(5);
  expect(predicate()).toBe(true);
}

test("ENOSPC drops bounded payloads, releases backpressure and retries a counted gap without new input", async () => {
  let full = true, clock = 0; const errors: Error[] = [], pauses: boolean[] = [], writes: string[] = [];
  const log = new CodexWireLog({ retryMs: 10, highWaterBytes: 1, lowWaterBytes: 0, now: () => clock++,
    setPaused: value => pauses.push(value), onError: error => errors.push(error),
    append: async (_path, text) => { if (full) throw enospc(); writes.push(text); } });
  try {
    log.append("stdout", "output\n"); log.append("stdout", "completed\n");
    await log.flush(); // A failed observational flush must not fail the session.
    for (let n = 0; n < 500; n++) log.append("stdout", "x");
    expect(log.bufferedEntries).toBe(0); expect(log.bufferedBytes).toBe(0);
    expect(log.droppedEntries).toBe(502); expect(log.droppedBytes).toBe(517);
    expect(log.isPaused).toBe(false); expect(pauses).toEqual([true, false]); expect(errors).toHaveLength(1);
    full = false;
    await until(() => writes.some(text => text.startsWith("\n" + CODEX_WIRE_LOG_GAP_PREFIX)));
    await log.flush();
    const markers = writes.map(text => JSON.parse(text.trim().slice(CODEX_WIRE_LOG_GAP_PREFIX.length)));
    expect(markers.reduce((sum, gap) => sum + gap.entries, 0)).toBe(502);
    expect(markers.reduce((sum, gap) => sum + gap.bytes, 0)).toBe(517);
    expect(markers[0]).toMatchObject({ schema: "scout.codex-wire-log-gap/v1", firstAt: new Date(0).toISOString(), lastAt: new Date(1).toISOString(), error: "ENOSPC", partialWritePossible: true });
    expect(markers.at(-1).lastAt).toBe(new Date(501).toISOString());
    log.append("stdout", "after\n"); await log.flush(); expect(writes.at(-1)).toBe("after\n");
  } finally { log.setActive(false); }
});

test("partial data and failed markers are not replayed; recovery separates and identifies the gap", async () => {
  let file = "", attempt = 0;
  const log = new CodexWireLog({ retryMs: 10, setPaused: () => {}, onError: () => {}, append: async (_path, text) => {
    attempt++;
    if (attempt === 1) { file += text.slice(0, 5); throw enospc(); }
    if (attempt === 2) { file += text; throw enospc(); } // Possibly-complete uncertain marker.
    file += text;
  } });
  try {
    log.append("stdout", '{"data":"never-replayed"}\n'); await log.flush();
    await until(() => attempt >= 3); await log.flush();
    log.append("stdout", '{"after":true}\n'); await log.flush();
    expect(file.startsWith('{"dat\n' + CODEX_WIRE_LOG_GAP_PREFIX)).toBe(true);
    expect(file).not.toContain("never-replayed");
    const markers = file.split("\n").filter(line => line.startsWith(CODEX_WIRE_LOG_GAP_PREFIX)).map(line => JSON.parse(line.slice(CODEX_WIRE_LOG_GAP_PREFIX.length)));
    expect(markers).toHaveLength(2); expect(markers[0]).toEqual(markers[1]);
    expect(markers[0].entries).toBe(1); expect(markers[0].bytes).toBe(Buffer.byteLength('{"data":"never-replayed"}\n'));
    expect(file.endsWith('{"after":true}\n')).toBe(true);
  } finally { log.setActive(false); }
});

test("stdout and stderr gaps remain separate and disconnected retry timers stop", async () => {
  let full = true, attempts = 0; const writes: Array<[string, string]> = [];
  const log = new CodexWireLog({ retryMs: 10, setPaused: () => {}, onError: () => {}, append: async (path, text) => {
    attempts++; if (full) throw enospc(); writes.push([path, text]);
  } });
  try {
    log.append("stdout", "out"); log.append("stderr", "err"); await log.flush(); log.setActive(false);
    const stopped = attempts; await Bun.sleep(30); expect(attempts).toBe(stopped);
    full = false; log.setActive(true); await until(() => writes.length === 2);
    expect(writes.map(([path]) => path).sort()).toEqual(["stderr", "stdout"]);
  } finally { log.setActive(false); }
});


test("wire-log flush preserves ordered tail across bounded sink rotation", async () => {
  const { mkdtemp, readFile, rm, stat } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { appendBoundedLog } = await import("../bounded-log.ts");
  const dir = await mkdtemp(join(tmpdir(), "scout-wire-rotation-"));
  const path = join(dir, "stdout.log");
  const errors: Error[] = [];
  const log = new CodexWireLog({
    setPaused: () => {}, onError: error => errors.push(error),
    append: (path, text) => appendBoundedLog(path, text, 8),
  });
  try {
    log.append(path, "abcdefgh");
    log.append(path, "ijklmnop");
    log.append(path, "qrstuv");
    await log.flush();
    expect(await readFile(`${path}.1`, "utf8")).toBe("ijklmnop");
    expect(await readFile(path, "utf8")).toBe("qrstuv");
    expect((await stat(path)).size).toBeLessThanOrEqual(8);
    expect((await stat(`${path}.1`)).size).toBeLessThanOrEqual(8);
    expect(log.bufferedBytes).toBe(0);
    expect(errors).toEqual([]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a failing diagnostic callback cannot prevent dropping or retrying failed payloads", async () => {
  let full = true; const writes: string[] = [];
  const log = new CodexWireLog({ retryMs: 10, setPaused: () => {}, onError: () => { throw enospc(); },
    append: async (_path, text) => { if (full) throw enospc(); writes.push(text); } });
  try {
    log.append("stdout", "data\n"); await log.flush(); expect(log.droppedEntries).toBe(1); expect(log.bufferedEntries).toBe(0);
    full = false; await until(() => writes.length === 1); expect(writes[0]).toContain(CODEX_WIRE_LOG_GAP_PREFIX);
  } finally { log.setActive(false); }
});

test("recovery emits a gap marker before persisting later data", async () => {
  let full = true; const writes: string[] = [];
  const log = new CodexWireLog({ retryMs: 1000, setPaused: () => {}, onError: () => {},
    append: async (_path, text) => { if (full) throw enospc(); writes.push(text); } });
  try {
    log.append("stdout", "lost\n"); await log.flush(); full = false; await log.flush();
    log.append("stdout", "after\n"); await log.flush();
    expect(writes[0]?.startsWith("\n" + CODEX_WIRE_LOG_GAP_PREFIX)).toBe(true);
    expect(JSON.parse(writes[0]!.trim().slice(CODEX_WIRE_LOG_GAP_PREFIX.length)).entries).toBe(1);
    expect(writes[1]).toBe("after\n");
  } finally { log.setActive(false); }
});

test("backpressure remains paused between batches above the low-water mark", async () => {
  const first = deferred(), second = deferred(), secondStarted = deferred(); const pauses: boolean[] = []; let writes = 0;
  const log = new CodexWireLog({ highWaterBytes: 12, lowWaterBytes: 3, setPaused: value => pauses.push(value), onError: () => {},
    append: async () => { writes++; if (writes === 1) await first.promise; else { secondStarted.resolve(); await second.promise; } } });
  try {
    log.append("stdout", "1234567"); log.append("stdout", "7654321");
    expect(log.bufferedBytes).toBe(14); expect(pauses).toEqual([true]);
    first.resolve(); await secondStarted.promise;
    expect(log.bufferedBytes).toBe(7); expect(log.isPaused).toBe(true); expect(pauses).toEqual([true]);
    second.resolve(); await log.flush(); expect(pauses).toEqual([true, false]);
  } finally { first.resolve(); second.resolve(); await log.flush(); log.setActive(false); }
});
