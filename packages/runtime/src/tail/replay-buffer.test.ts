import { afterEach, expect, spyOn, test } from "bun:test";
import { TailReplayBuffer, type TailReplayCapture } from "./replay-buffer.js";
import { StreamResyncRequired } from "../bounded-event-iterable.js";
import {
  __testing,
  attachTailReplay,
  readRecentLiveEvents,
  snapshotRecentEvents,
} from "./service.js";
import type { TailEvent } from "./types.js";

const captures: TailReplayCapture[] = [];
afterEach(() => {
  for (const capture of captures.splice(0)) capture.close();
  __testing.resetTailEventBuffers();
  __testing.resetQuietTailCoalescer();
});
function event(id: string, source = "fixture", summary = id): TailEvent {
  return {
    id,
    source,
    summary,
    ts: 0,
    sessionId: "fixture",
    pid: 0,
    parentPid: null,
    project: "",
    cwd: "",
    harness: "unattributed",
    kind: "assistant",
  };
}
function attach(
  buffer: TailReplayBuffer,
  options: Partial<Parameters<TailReplayBuffer["attach"]>[0]> = {},
) {
  const capture = buffer.attach({ limit: 500, ...options });
  captures.push(capture);
  return capture;
}
function value(item: IteratorResult<{ event: TailEvent }>) {
  if (item.done) throw new Error("missing event");
  return item.value.event;
}

test("watermark and replay use one ring image even when publication follows capture synchronously", async () => {
  const buffer = new TailReplayBuffer(10_000);
  buffer.publish(event("A"));
  const original = buffer.snapshot.bind(buffer);
  const hook = spyOn(buffer, "snapshot").mockImplementation((limit) => {
    const image = original(limit);
    buffer.publish(event("C"));
    return image;
  });
  const capture = attach(buffer);
  hook.mockRestore();
  buffer.publish(event("D"));
  expect(capture.image.entries.map((item) => item.event.id)).toEqual(["A"]);
  expect(capture.image.watermark).toBe(1);
  expect(value(await capture.live.next()).id).toBe("C");
  expect(value(await capture.live.next()).id).toBe("D");
});

test("pre-capture synchronous overlap is discarded by ordinal, not by ID", async () => {
  const buffer = new TailReplayBuffer(10_000);
  buffer.publish(event("A"));
  const original = buffer.snapshot.bind(buffer);
  const hook = spyOn(buffer, "snapshot").mockImplementation((limit) => {
    buffer.publish(event("dup", "fixture", "replayed"));
    return original(limit);
  });
  const capture = attach(buffer, { maxCount: 1 });
  hook.mockRestore();
  expect(capture.image.entries.map((item) => item.event.id)).toEqual([
    "A",
    "dup",
  ]);
  buffer.publish(event("dup", "fixture", "live"));
  expect(capture.check()).toBe(true);
  expect(value(await capture.live.next()).summary).toBe("live");
});

test("pre-watermark overflow stays failed even if every entry overlaps the replay", () => {
  const buffer = new TailReplayBuffer(10_000),
    original = buffer.snapshot.bind(buffer);
  const hook = spyOn(buffer, "snapshot").mockImplementation((limit) => {
    for (let i = 0; i < 257; i++) buffer.publish(event(String(i)));
    return original(limit);
  });
  try {
    expect(() => attach(buffer)).toThrow(StreamResyncRequired);
    expect(buffer.subscriberCount).toBe(0);
  } finally {
    hook.mockRestore();
  }
});

test("count, byte, oversize and age limits remain active during replay", async () => {
  const count = new TailReplayBuffer(10_000);
  const c = attach(count, { maxCount: 2 });
  count.publish(event("1"));
  count.publish(event("2"));
  count.publish(event("3"));
  expect(() => c.check()).toThrow(StreamResyncRequired);
  await expect(c.live.next()).rejects.toBeInstanceOf(StreamResyncRequired);
  expect(count.subscriberCount).toBe(0);
  const byte = new TailReplayBuffer(10_000);
  const b = attach(byte, {
    maxBytes: Buffer.byteLength(JSON.stringify(event("1"))) + 1,
  });
  byte.publish(event("1"));
  byte.publish(event("2"));
  expect(() => b.check()).toThrow(StreamResyncRequired);
  const large = new TailReplayBuffer(10_000);
  const l = attach(large, { maxBytes: 32 });
  large.publish(event("oversize"));
  expect(() => l.check()).toThrow(StreamResyncRequired);
  const age = new TailReplayBuffer(10_000);
  const a = attach(age, { maxAgeMs: 10 });
  age.publish(event("old"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(() => a.check()).toThrow(StreamResyncRequired);
  expect(age.subscriberCount).toBe(0);
});

test("unselected traffic is rejected before queue count, bytes or serialization accounting", async () => {
  const buffer = new TailReplayBuffer(10_000);
  const capture = attach(buffer, {
    maxCount: 1,
    maxBytes: 1000,
    accepts: (event) => event.source === "selected",
  });
  for (let i = 0; i < 1000; i++)
    buffer.publish({ ...event(String(i), "other"), raw: 1n });
  buffer.publish(event("yes", "selected"));
  expect(capture.check()).toBe(true);
  expect(value(await capture.live.next()).id).toBe("yes");
});

test("serialization and filter exceptions fail closed without escaping the publisher", () => {
  const buffer = new TailReplayBuffer(10_000);
  const capture = attach(buffer);
  expect(() => buffer.publish({ ...event("bad"), raw: 1n })).not.toThrow();
  expect(() => capture.check()).toThrow(StreamResyncRequired);
  expect(buffer.subscriberCount).toBe(0);
  const rejected = attach(buffer, {
    accepts: () => {
      throw new Error("filter failed");
    },
  });
  expect(() => buffer.publish(event("later"))).not.toThrow();
  expect(() => rejected.check()).toThrow(StreamResyncRequired);
});

test("pre-abort, abort with pending next, repeated return, and snapshot failure leave no listener", async () => {
  const buffer = new TailReplayBuffer(10_000);
  const controller = new AbortController();
  controller.abort();
  const pre = attach(buffer, { signal: controller.signal });
  expect(buffer.subscriberCount).toBe(0);
  expect((await pre.live.next()).done).toBe(true);
  const live = new AbortController();
  const capture = attach(buffer, { signal: live.signal });
  const pending = capture.live.next();
  live.abort();
  expect((await pending).done).toBe(true);
  capture.close();
  await capture.live.return?.();
  expect(buffer.subscriberCount).toBe(0);
  const hook = spyOn(buffer, "snapshot").mockImplementation(() => {
    throw new Error("capture failure");
  });
  try {
    expect(() => attach(buffer)).toThrow("capture failure");
    expect(buffer.subscriberCount).toBe(0);
  } finally {
    hook.mockRestore();
  }
});

test("close clears the actual owned age timer; repeated captures release their queue and listener", () => {
  const buffer = new TailReplayBuffer(10_000);
  const clear = spyOn(globalThis, "clearTimeout");
  const set = spyOn(globalThis, "setTimeout");
  try {
    const capture = attach(buffer);
    buffer.publish(event("queued"));
    const timer = set.mock.results.at(-1)?.value;
    expect(timer).toBeDefined();
    capture.close();
    expect(clear).toHaveBeenCalledWith(timer);
    for (let i = 0; i < 100; i++) {
      const next = attach(buffer);
      buffer.publish(event(String(i)));
      next.close();
      expect(buffer.subscriberCount).toBe(0);
    }
  } finally {
    clear.mockRestore();
    set.mockRestore();
  }
});

test("retention windows 0, 1, 499, 500, 501 and 10001 keep public order and bounded ordinal metadata", () => {
  const buffer = new TailReplayBuffer(10_000);
  expect(buffer.recent(500)).toEqual([]);
  for (let i = 1; i <= 10001; i++) {
    buffer.publish(event(String(i)));
    if ([1, 499, 500, 501, 10001].includes(i)) {
      const image = buffer.snapshot(500);
      expect(image.entries.length).toBe(Math.min(i, 500));
      expect(image.watermark).toBe(i);
      expect(image.entries[0].ordinal).toBe(Math.max(1, i - 499));
      expect(buffer.recent(10000).length).toBe(Math.min(i, 10000));
    }
  }
  expect(buffer.recent(10000)[0].id).toBe("2");
  expect(buffer.recent(500).some((event) => event.id === "9501")).toBe(false);
});

test("counter exhaustion refuses streams instead of wrapping; reset invalidates old capture", () => {
  const buffer = new TailReplayBuffer(10_000, Number.MAX_SAFE_INTEGER - 1);
  const capture = attach(buffer);
  expect(buffer.publish(event("last"))).toBe(true);
  expect(buffer.publish(event("refused"))).toBe(false);
  expect(() => capture.check()).toThrow(StreamResyncRequired);
  expect(() => attach(buffer)).toThrow(StreamResyncRequired);
  expect(buffer.recent(500).map((event) => event.id)).toEqual(["last"]);
  const reset = new TailReplayBuffer(10_000);
  reset.publish(event("before"));
  const old = attach(reset);
  reset.reset();
  expect(() => old.check()).toThrow(StreamResyncRequired);
  reset.publish(event("after"));
  expect(reset.snapshot(500).watermark).toBe(2);
});

test("service captures post-coalescing public commits and unwraps recent/session reads unchanged", async () => {
  __testing.resetTailEventBuffers();
  __testing.resetQuietTailCoalescer();
  const observed: TailEvent[] = [];
  const stop = __testing.addInternalSubscriberWithoutLoop((event) =>
    observed.push(event),
  );
  try {
    __testing.pushEvent({
      ...event("q1", "grok", "phase · streaming_text"),
      kind: "system",
      ts: 1000,
    });
    __testing.pushEvent({
      ...event("q2", "grok", "phase · streaming_text"),
      kind: "system",
      ts: 1250,
    });
    expect(observed.length).toBe(2);
    const replay = attachTailReplay({ limit: 500 }, () => {});
    captures.push(replay);
    expect(replay.image.entries.map((item) => item.event.id)).toEqual(["q1"]);
    expect(replay.image.entries.length).toBe(1);
    const expected = snapshotRecentEvents(500);
    expect(await readRecentLiveEvents(500)).toEqual(expected);
    expect(__testing.snapshotSessionEvents("fixture", "grok", 500)).toEqual(
      expected,
    );
    expect(Object.keys(expected[0])).not.toContain("ordinal");
    expect(__testing.tailLoopState().publicSubscriberCount).toBe(1);
    expect(__testing.tailLoopState().internalSubscriberCount).toBe(1);
    expect(__testing.tailLoopState().running).toBe(false);
  } finally {
    stop();
  }
});

test("service registers and captures before starting shared public demand; start failure unwinds", async () => {
  __testing.resetTailEventBuffers();
  __testing.pushEvent(event("A"));
  let starts = 0;
  const capture = attachTailReplay({ limit: 500 }, () => {
    starts++;
    expect(__testing.tailLoopState().publicSubscriberCount).toBe(1);
    __testing.pushEvent(event("C"));
  });
  captures.push(capture);
  expect(starts).toBe(1);
  expect(capture.image.entries.map((item) => item.event.id)).toEqual(["A"]);
  expect(value(await capture.live.next()).id).toBe("C");
  capture.close();
  expect(__testing.tailLoopState().publicSubscriberCount).toBe(0);
  expect(() =>
    attachTailReplay({ limit: 500 }, () => {
      throw new Error("start failed");
    }),
  ).toThrow("start failed");
  expect(__testing.tailLoopState().publicSubscriberCount).toBe(0);
  const aborted = new AbortController();
  aborted.abort();
  const pre = attachTailReplay({ limit: 500, signal: aborted.signal }, () => {
    throw new Error("must not start");
  });
  expect(pre.check()).toBe(false);
  expect(__testing.tailLoopState().publicSubscriberCount).toBe(0);
});

test("ordinal delivery precedes reentrant legacy callbacks", async () => {
  const capture = attachTailReplay({ limit: 500 }, () => {});
  captures.push(capture);
  const stop = __testing.addPublicSubscriberWithoutLoop((event) => {
    if (event.id === "A")
      __testing.pushEvent({ ...event, id: "B", summary: "B" });
  });
  try {
    __testing.pushEvent(event("A"));
    expect(value(await capture.live.next()).id).toBe("A");
    expect(value(await capture.live.next()).id).toBe("B");
  } finally {
    stop();
  }
});
