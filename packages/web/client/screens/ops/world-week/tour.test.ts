import { describe, expect, test } from "bun:test";
import { RUNGS, foldLevel, parseFly, parseRate, parseRung, parseTour, rateLabel, spanLabel, windowSpan } from "./tour.ts";

describe("World tours · the file", () => {
  test("seconds, bars and relative times; directives; comments", () => {
    const t = parseTour(`# a demo
name The Week
bpm 120
offset 0.5
quiet
t=0 speed 1h/s     # trailing comment
b=2 fly low day over 8s
t=+1.5 open worktree mini-onboarding
t=1 goto @1791220739774`, "file");
    expect(t.name).toBe("The Week"); expect(t.quiet).toBe(true); expect(t.bpm).toBe(120);
    // bar 2 at 120 bpm, 4 beats = 4s, plus the 0.5s offset; +1.5 is relative to the line before
    expect(t.steps.map(s => [s.t, s.line])).toEqual([[0, "speed 1h/s"], [1, "goto @1791220739774"], [4.5, "fly low day over 8s"], [6, "open worktree mini-onboarding"]]);
    expect(t.length).toBe(6);
  });
  test("names fall back to the file; bad lines say where", () => {
    expect(parseTour("t=0 play", "demo").name).toBe("demo");
    expect(() => parseTour("t=0 play\nplay")).toThrow("line 2");
    expect(() => parseTour("b=1 play")).toThrow("bpm");
    expect(() => parseTour("t=-1 play")).toThrow("before the start");
  });
});

describe("World tours · rates", () => {
  test("week time per second, in the HUD's words", () => {
    expect(parseRate("1h/s")).toBe(3600); expect(parseRate("10m/s")).toBe(600); expect(parseRate("30s/s")).toBe(30);
    expect(parseRate("realtime")).toBe(1); expect(parseRate("2")).toBeNull(); expect(parseRate("0h/s")).toBeNull();
    expect(rateLabel(3600)).toBe("1H/S"); expect(rateLabel(1)).toBe("REAL TIME"); expect(rateLabel(90)).toBe("1.5M/S"); expect(rateLabel(4032)).toBe("1.12H/S");
  });
});

describe("World tours · fly", () => {
  test("views, rungs, numbers, live targets and duration", () => {
    expect(parseFly("low day over 8s")).toEqual({ view: "low", level: "DAY", over: 8 });
    expect(parseFly("az 320 el 30 r 90 x -10 z 4 linear in 12")).toEqual({ az: 320, el: 30, r: 90, x: -10, z: 4, linear: true, over: 12 });
    expect(parseFly("lane web playhead cut")).toEqual({ lane: "web", playhead: true, over: 0 });
    expect(parseFly("cam desk over 3s")).toEqual({ cam: "desk", over: 3 });
    expect(parseFly("follow turn -20")).toEqual({ follow: true, turn: -20, over: 2 });
    expect(parseFly("week iso home cut")).toEqual({ level: "WEEK", view: "iso", home: true, over: 0 });
  });
  test("says what it didn't understand", () => {
    expect(parseFly("")).toContain("where to");
    expect(parseFly("over 4s")).toContain("where to");
    expect(parseFly("sideways")).toContain('"sideways"');
    expect(parseFly("az north")).toContain("az needs a number");
  });
});

describe("World · the window ladder", () => {
  test("rungs by name, by key, and by step", () => {
    expect(RUNGS.map(r => r.k)).toEqual(["live", "5m", "30m", "4h", "24h", "all"]);
    expect(parseRung("30m")).toBe(2); expect(parseRung("ALL")).toBe(5); expect(parseRung("1")).toBe(0); expect(parseRung("6")).toBe(5);
    expect(parseRung("off")).toBe("off"); expect(parseRung("none", 3)).toBe("off");
    // [ ] from no window open the ends of the ladder; otherwise they step and stop at the ends
    expect(parseRung("wider")).toBe(5); expect(parseRung("narrower")).toBe(0);
    expect(parseRung("]", 2)).toBe(3); expect(parseRung("[", 2)).toBe(1); expect(parseRung("out", 5)).toBe(5); expect(parseRung("in", 0)).toBe(0);
    expect(parseRung("7")).toBe(null); expect(parseRung("1h")).toBe(null); expect(parseRung("")).toBe(null);
  });
  test("a window ends at its anchor; longer than the data shows all of it and says so", () => {
    const from = 1_000_000_000_000, anchor = from + 10 * 36e5;
    expect(windowSpan(3, anchor, from)).toEqual({ a: anchor - 4 * 36e5, b: anchor, clamped: false });
    expect(windowSpan(4, anchor, from)).toEqual({ a: from, b: anchor, clamped: true });
    expect(windowSpan(5, anchor, from)).toEqual({ a: from, b: anchor, clamped: false });
    expect(windowSpan(0, anchor, from).a).toBe(anchor - 60e3);
  });
  test("the fold climbs World → Lanes → Mesh with the rung", () => {
    expect(RUNGS.map(r => foldLevel(r.fold))).toEqual(["WORLD", "WORLD", "WORLD", "LANES", "MESH", "MESH"]);
    expect(foldLevel(0.34)).toBe("WORLD"); expect(foldLevel(0.5)).toBe("LANES"); expect(foldLevel(0.72)).toBe("MESH");
  });
  test("spans in the HUD's words", () => {
    expect(spanLabel(45e3)).toBe("45S"); expect(spanLabel(60e3)).toBe("1M"); expect(spanLabel(30 * 60e3)).toBe("30M");
    expect(spanLabel(4 * 36e5)).toBe("4H"); expect(spanLabel(2.5 * 36e5)).toBe("2.5H"); expect(spanLabel(864e5)).toBe("1D"); expect(spanLabel(864e5 + 6 * 36e5)).toBe("1D 6H");
  });
});
