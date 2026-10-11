import { describe, expect, test } from "bun:test";
import { RECONCILED_RE, STALE_DEFAULT, STUCK_CHOICES, STUCK_DEFAULT, isFailed, isReconciled, isStale, isStuck, parseStuck, parseStuckArgs, stuckBuckets, stuckLabel, stuckable } from "./trouble.ts";

const M = 60e3;
describe("World · STUCK threshold", () => {
  test("one named default, 30 minutes; the :stuck choices", () => {
    expect(STUCK_DEFAULT).toBe(30 * M);
    expect(STUCK_CHOICES.map(c => c[0])).toEqual(["10m", "30m", "1h"]);
    expect(stuckLabel(STUCK_DEFAULT)).toBe("30M");
    expect(stuckLabel(60 * M)).toBe("1H");
    expect(stuckLabel(120 * M)).toBe("2H");
  });
  test(":stuck arguments", () => {
    expect(parseStuck("10m")).toBe(10 * M);
    expect(parseStuck("30")).toBe(30 * M);
    expect(parseStuck("1h")).toBe(60 * M);
    expect(parseStuck("1.5 hours")).toBe(90 * M);
    expect(parseStuck("0m")).toBeNull();
    expect(parseStuck("soon")).toBeNull();
    expect(parseStuck("9999h")).toBeNull();
  });
  test("an open broker ask crosses the line the moment its age passes N, and not before", () => {
    const a = { ts: 0, done: null, st: "o", src: "b" };
    expect(isStuck(a, 30 * M, 30 * M)).toBe(false);
    expect(isStuck(a, 30 * M + 1, 30 * M)).toBe(true);
    expect(isStuck(a, 11 * M, 10 * M)).toBe(true);
    expect(isStuck(a, 59 * M, 60 * M)).toBe(false);
  });
  test("finished in time is not stuck; finished later is stuck until then", () => {
    const a = { ts: 0, done: 45 * M, st: "c", src: "b" };
    expect(isStuck(a, 40 * M, 30 * M)).toBe(true);
    expect(isStuck(a, 45 * M, 30 * M)).toBe(false);
    expect(isStuck({ ts: 100 * M, done: null, st: "o" }, 50 * M, 30 * M)).toBe(false);   // not sent yet at t
  });
  test("only broker asks and messages can be stuck: an operator turn or a subagent is work", () => {
    expect(stuckable({ ts: 0, done: null, st: "o", src: "t" })).toBe(false);
    expect(stuckable({ ts: 0, done: null, st: "o", src: "s" })).toBe(false);
    expect(stuckable({ ts: 0, done: null, st: "o", src: "b" })).toBe(true);
    expect(stuckable({ ts: 0, done: null, st: "o" })).toBe(true);             // older payloads: no kind
    expect(stuckable({ ts: 0, done: null, st: "o", kind: "msg" })).toBe(true);
    expect(isStuck({ ts: 0, done: null, st: "o", src: "t" }, 5 * 36e5, 30 * M)).toBe(false);
  });
  test("failed only once it finished as a failure", () => {
    expect(isFailed({ ts: 0, done: 5 * M, st: "f" }, 4 * M)).toBe(false);
    expect(isFailed({ ts: 0, done: 5 * M, st: "f" }, 5 * M)).toBe(true);
    expect(isFailed({ ts: 0, done: 5 * M, st: "c" }, 9 * M)).toBe(false);
  });
  test("age buckets >N · >2N · >4N", () => {
    expect(stuckBuckets([31, 61, 121, 29].map(x => x * M), 30 * M)).toEqual([3, 2, 1]);
    expect(stuckBuckets([], 30 * M)).toEqual([0, 0, 0]);
  });
});

const H = 36e5;
describe("World · only real trouble takes the alarm", () => {
  test("one named staleness horizon, 24 hours; :stuck takes a threshold and a horizon", () => {
    expect(STALE_DEFAULT).toBe(24 * H);
    expect(stuckLabel(STALE_DEFAULT)).toBe("24H");
    expect(stuckLabel(3 * 864e5)).toBe("3D");
    expect(parseStuckArgs("30m 24h")).toEqual({ ms: 30 * M, horizon: 24 * H });
    expect(parseStuckArgs("10m 3d")).toEqual({ ms: 10 * M, horizon: 72 * H });
    expect(parseStuckArgs("1h")).toEqual({ ms: H, horizon: null });
    expect(parseStuckArgs("1h 30m")).toBeNull();      // the horizon must be longer than the threshold
    expect(parseStuckArgs("30m 60d")).toBeNull();     // up to 30 days
    expect(parseStuckArgs("30m soon")).toBeNull();
  });
  test("STUCK lives between the threshold and the horizon; past the horizon it is STALE (quiet), never both", () => {
    const a = { ts: 0, done: null, st: "o", src: "b" };
    expect(isStuck(a, 23 * H, 30 * M, 24 * H)).toBe(true);
    expect(isStuck(a, 24 * H, 30 * M, 24 * H)).toBe(true);
    expect(isStuck(a, 24 * H + 1, 30 * M, 24 * H)).toBe(false);
    expect(isStale(a, 24 * H + 1, 30 * M, 24 * H)).toBe(true);
    expect(isStale(a, 23 * H, 30 * M, 24 * H)).toBe(false);
    expect(isStale({ ...a, src: "t" }, 99 * H, 30 * M, 24 * H)).toBe(false);   // an operator's turn is neither
    expect(isStale({ ts: 0, done: 25 * H, st: "c", src: "b" }, 26 * H, 30 * M, 24 * H)).toBe(false);   // done by then
    expect(isStuck(a, 99 * H, 30 * M)).toBe(true);   // no horizon given: the old rule
  });
  test("a delivery closed as housekeeping is RECONCILED, not FAILED; a stale running flight on an ask stays FAILED", () => {
    const rec = { ts: 0, done: M, st: "f", kind: "msg", err: "Stale local delivery reconciled: endpoint endpoint.x is offline" };
    expect(RECONCILED_RE.test(rec.err)).toBe(true);
    expect(isReconciled(rec)).toBe(true);
    expect(isFailed(rec, 2 * M)).toBe(false);
    expect(isFailed({ ...rec, err: "Endpoint resolution failed before execution" }, 2 * M)).toBe(true);
    const flight = { ts: 0, done: M, st: "f", kind: "ask", err: "Stale running flight reconciled: superseded by newer failed flight" };
    expect(isReconciled(flight)).toBe(false);
    expect(isFailed(flight, 2 * M)).toBe(true);
  });
});

