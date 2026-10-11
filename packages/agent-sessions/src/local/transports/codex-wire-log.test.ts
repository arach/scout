import { expect, test } from "bun:test";
import { CodexWireLog } from "./codex-wire-log.ts";

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

test("wire log errors retain pending context, pause input, and reject flush without uncertain replay", async () => {
  const failure = new Error("ENOSPC");
  const errors: Error[] = [];
  const pauses: boolean[] = [];
  let attempts = 0;
  const log = new CodexWireLog({
    setPaused: (paused) => pauses.push(paused), onError: (error) => errors.push(error),
    append: async () => { attempts += 1; throw failure; },
  });
  log.append("stdout", "output\n");
  log.append("stdout", "completed\n");
  await expect(log.flush()).rejects.toThrow("ENOSPC");
  expect(log.bufferedEntries).toBe(2);
  expect(log.bufferedBytes).toBe(17);
  expect(errors).toEqual([failure]);
  expect(pauses).toEqual([true]);
  await expect(log.flush()).rejects.toThrow("ENOSPC");
  expect(attempts).toBe(1);
});
