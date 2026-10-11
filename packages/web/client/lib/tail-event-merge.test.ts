import { describe, expect, test } from "bun:test";

import {
  appendLiveTailEvent,
  dedupeTailEvents,
  mergeHydratedTailEvents,
  mergeTailSessionPresence,
  tailEventKey,
} from "./tail-event-merge.ts";
import type { TailEvent } from "./types.ts";

function event(overrides: Partial<TailEvent> & { id: string }): TailEvent {
  return {
    ts: 1_000,
    source: "codex",
    sessionId: "S",
    pid: 1,
    parentPid: null,
    project: "openscout",
    cwd: "/repo",
    harness: "scout-managed",
    kind: "tool",
    summary: "Read file.ts",
    ...overrides,
  };
}

describe("tailEventKey", () => {
  test("the same transcript line keys identically despite divergent ids", () => {
    // Live tail and disk replay mint different ids for the same line (line-offset
    // is computed differently per path) — content identity must still match.
    const live = event({ id: "codex:S:0" });
    const replay = event({ id: "codex:S:312" });
    expect(tailEventKey(live)).toBe(tailEventKey(replay));
  });

  test("distinct events with the same summary at different times stay distinct", () => {
    const first = event({ id: "a", ts: 1_000 });
    const second = event({ id: "b", ts: 2_000 });
    expect(tailEventKey(first)).not.toBe(tailEventKey(second));
  });
});

describe("appendLiveTailEvent", () => {
  test("drops a live event already held under a different id (the dup case)", () => {
    const hydrated = [event({ id: "codex:S:312" })];
    const next = appendLiveTailEvent(hydrated, event({ id: "codex:S:0" }), 500);
    expect(next).toBe(hydrated); // unchanged reference — nothing appended
    expect(next).toHaveLength(1);
  });

  test("appends a genuinely new live event", () => {
    const hydrated = [event({ id: "codex:S:312", ts: 1_000 })];
    const next = appendLiveTailEvent(hydrated, event({ id: "codex:S:313", ts: 2_000, summary: "Edit x" }), 500);
    expect(next).toHaveLength(2);
    expect(next[1].summary).toBe("Edit x");
  });

  test("caps to the recent limit, keeping the newest", () => {
    const previous = [event({ id: "1", ts: 1, summary: "one" }), event({ id: "2", ts: 2, summary: "two" })];
    const next = appendLiveTailEvent(previous, event({ id: "3", ts: 3, summary: "three" }), 2);
    expect(next.map((e) => e.summary)).toEqual(["two", "three"]);
  });
});

describe("mergeHydratedTailEvents", () => {
  test("merges disk history with in-flight live events, collapsing the overlap", () => {
    const liveDuringFetch = [event({ id: "codex:S:0", ts: 2_000, summary: "newest live" })];
    const hydrated = [
      event({ id: "codex:S:310", ts: 1_000, summary: "old" }),
      event({ id: "codex:S:312", ts: 2_000, summary: "newest live" }), // same line as the live one
    ];
    const merged = mergeHydratedTailEvents(liveDuringFetch, hydrated, 500);
    expect(merged.filter((e) => e.summary === "newest live")).toHaveLength(1);
    expect(merged).toHaveLength(2);
  });
});

describe("dedupeTailEvents", () => {
  test("first occurrence wins", () => {
    const deduped = dedupeTailEvents([
      event({ id: "codex:S:312", summary: "x" }),
      event({ id: "codex:S:0", summary: "x" }),
    ]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].id).toBe("codex:S:312");
  });
});

describe("session presence alongside bounded detail", () => {
  test("a quiet Claude remains present while Codex fills and advances the detail buffer", () => {
    const now = 4 * 60 * 60_000;
    const claude = event({ id: "quiet-claude", source: "claude", sessionId: "C", kind: "assistant", ts: now - 90 * 60_000, summary: "Finished checking the design" });
    let detail = Array.from({ length: 1_200 }, (_, i) => event({ id: String(i), ts: now - 1_200 + i, summary: `Read ${i}` }));
    detail = mergeHydratedTailEvents([], detail, 1_000);
    for (let i = 0; i < 100; i++) detail = appendLiveTailEvent(detail, event({ id: `live-${i}`, ts: now + i, summary: `Live ${i}` }), 1_000);
    const merged = mergeTailSessionPresence(detail, [claude], now + 100, now);
    expect(detail).toHaveLength(1_000);
    expect(merged).toHaveLength(1_001);
    expect(merged.find(e => e.sessionId === "C")).toEqual(claude);
  });
  test("presence keeps one real reply per source and session inside the chosen horizon", () => {
    const old = event({ id: "old", kind: "assistant", ts: 10 });
    const latest = event({ id: "new", kind: "assistant", ts: 80 });
    const otherSource = event({ id: "claude", kind: "assistant", source: "claude", ts: 70 });
    const duplicates = event({ ...latest, id: "live-copy" });
    const merged = mergeTailSessionPresence([duplicates], [old, latest, otherSource,
      event({ id: "heartbeat", kind: "system", ts: 90 }),
      event({ id: "future", kind: "assistant", ts: 101 }),
      event({ id: "nan", kind: "assistant", ts: Number.NaN }),
    ], 100, 50);
    expect(merged.map(e => e.id)).toEqual(["claude", "new"]);
    expect(mergeTailSessionPresence([], [latest], 200, 50)).toHaveLength(0);
  });
});
