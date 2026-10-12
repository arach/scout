import { describe, expect, test } from "bun:test";
import {
  cachedCount,
  cells,
  compactReset,
  OBSERVED_AT,
  percentage,
  readingsFor,
  remaining,
} from "./model";

describe("public quota study semantics", () => {
  test("missing capacity and exhaustion remain different", () => {
    expect(remaining(readingsFor("missing")[1])).toBeNull();
    expect(remaining(readingsFor("pressure")[1])).toBe(0);
    expect(compactReset(readingsFor("missing")[1])).toBe("due");
    expect(compactReset(readingsFor("missing")[3])).toBe("—");
  });
  test("absent captures do not count as cached samples", () => {
    expect(cachedCount(readingsFor("example"))).toBe(3);
    expect(cachedCount(readingsFor("missing"))).toBe(2);
  });
  test("invalid inputs do not invent capacity and gauges remain bounded", () => {
    const reading = readingsFor("example")[0];
    expect(remaining({ ...reading, used: Number.NaN })).toBeNull();
    expect(remaining({ ...reading, used: 110 })).toBe(0);
    expect(remaining({ ...reading, used: -10 })).toBe(100);
    expect(cells(null)).toBe(0);
    expect(cells(0)).toBe(0);
    expect(cells(1)).toBe(1);
    expect(cells(100)).toBe(20);
    expect(cells(remaining({ ...reading, used: 99.9 }))).toBe(1);
    expect(percentage(remaining({ ...reading, used: 99.9 }))).toBe("0.1");
    expect(percentage(.01)).toBe("<0.1");
  });
  test("examples are independent synthetic values with a fixed clock", () => {
    const example = readingsFor("example");
    expect(example.every((reading) => reading.source.startsWith("Synthetic")))
      .toBe(true);
    example[0].used = 100;
    expect(readingsFor("example")[0].used).toBe(35);
    expect(new Date(OBSERVED_AT).toISOString()).toBe(
      "2026-01-01T12:00:00.000Z",
    );
  });
});
