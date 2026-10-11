import { expect, test } from "bun:test";
import { boundedEventIterable, StreamResyncRequired } from "./bounded-event-iterable.js";

function fixture(options: { maxCount?: number; maxBytes?: number; maxAgeMs?: number; signal?: AbortSignal } = {}) {
  let listener: ((event: { id: string; body?: string }) => void) | undefined;
  let subscriptions = 0;
  const iterable = boundedEventIterable({ ...options, id: event => event.id, subscribe: (fn: typeof listener) => {
    listener = fn; subscriptions++; return () => { listener = undefined; subscriptions--; };
  } });
  return { iterator: iterable[Symbol.asyncIterator](), emit: (id: string, body?: string) => listener?.({ id, body }), count: () => subscriptions };
}

test("ordered bounded stream preserves the last delivered cursor on overflow", async () => {
  const f = fixture({ maxCount: 2 });
  f.emit("first"); expect((await f.iterator.next()).value.id).toBe("first");
  f.emit("second"); f.emit("third"); f.emit("fourth");
  expect(f.count()).toBe(0);
  try { await f.iterator.next(); throw new Error("missing failure"); }
  catch (error) { expect(error).toBeInstanceOf(StreamResyncRequired); expect((error as StreamResyncRequired).lastDeliveredId).toBe("first"); }
});

test("byte and age limits disconnect consumers even without another event", async () => {
  const bytes = fixture({ maxBytes: 32 }); bytes.emit("big", "x".repeat(33));
  await expect(bytes.iterator.next()).rejects.toThrow("resnapshot"); expect(bytes.count()).toBe(0);
  const age = fixture({ maxAgeMs: 10 }); age.emit("old");
  await new Promise(resolve => setTimeout(resolve, 30));
  await expect(age.iterator.next()).rejects.toThrow("resnapshot"); expect(age.count()).toBe(0);
});

test("abort wakes blocked reads and releases queued events and listener", async () => {
  const controller = new AbortController(); const f = fixture({ signal: controller.signal });
  const pending = f.iterator.next(); controller.abort(); expect(await pending).toEqual({ done: true, value: undefined });
  expect(f.count()).toBe(0);
  const ended = fixture({ signal: controller.signal }); expect(ended.count()).toBe(0);
  expect(await ended.iterator.next()).toEqual({ done: true, value: undefined });
});

test("normal consumer drains in order and return unsubscribes", async () => {
  const f = fixture(); const pending = f.iterator.next(); f.emit("a");
  expect((await pending).value.id).toBe("a"); f.emit("b"); f.emit("c");
  expect((await f.iterator.next()).value.id).toBe("b"); expect((await f.iterator.next()).value.id).toBe("c");
  await f.iterator.return?.(); expect(f.count()).toBe(0);
});
