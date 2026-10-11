import { describe, expect, test } from "bun:test";

import { BASE_MAX, BASE_MIN, BASE_SHOULDER, homeBaseSpan, onBase } from "./home-base.ts";

const home = { start: 14, end: 50 };

describe("home base", () => {
  test("with nobody home it is the minimum, starting under the hex", () => {
    const span = homeBaseSpan({ anchor: "left", home, slots: [], width: 1000 });
    expect(span.start).toBeLessThan(home.start);
    expect(span.end - span.start).toBe(BASE_MIN);
  });

  test("stretches over figures shoulder to shoulder with it, stops at a gap", () => {
    const slots = [{ x: 65, w: 30 }, { x: 95, w: 30 }, { x: 300, w: 30 }];
    const span = homeBaseSpan({ anchor: "left", home, slots, width: 1000 });
    expect(onBase(span, 65)).toBe(true);
    expect(onBase(span, 95)).toBe(true);
    expect(onBase(span, 300)).toBe(false);
    expect(span.end).toBeLessThan(300);
  });

  test("never passes the maximum", () => {
    const slots = Array.from({ length: 20 }, (_, i) => ({ x: 65 + i * 30, w: 30 }));
    const span = homeBaseSpan({ anchor: "left", home, slots, width: 2000 });
    expect(span.end - span.start).toBeLessThanOrEqual(BASE_MAX);
  });

  test("mirrors at the right corner", () => {
    const right = { start: 950, end: 986 };
    const span = homeBaseSpan({ anchor: "right", home: right, slots: [{ x: 935, w: 30 }], width: 1000 });
    expect(span.end).toBeLessThanOrEqual(1000);
    expect(span.end).toBeGreaterThan(right.end);
    expect(onBase(span, 935)).toBe(true);
    expect(span.start).toBeLessThan(935 - 15 - BASE_SHOULDER + 1);
  });
});
