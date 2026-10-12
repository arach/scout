export type Scenario = "example" | "pressure" | "missing";
export type Direction = "led" | "progress" | "chart";
export type Reading = {
  provider: string;
  window: string;
  used: number | null;
  resetAt: number | null;
  capturedAt: number | null;
  source: string;
};

// Deliberately synthetic. No operator captures, billing data or account calls.
export const OBSERVED_AT = Date.UTC(2026, 0, 1, 12);
const MINUTE = 60_000;
const EXAMPLE: Reading[] = [
  {
    provider: "Codex",
    window: "7d",
    used: 35,
    resetAt: OBSERVED_AT + 6 * 86400000,
    capturedAt: OBSERVED_AT - 2 * MINUTE,
    source: "Synthetic Codex fixture",
  },
  {
    provider: "Claude",
    window: "5h",
    used: 20,
    resetAt: OBSERVED_AT + 128 * MINUTE,
    capturedAt: OBSERVED_AT - 60 * MINUTE,
    source: "Synthetic Claude fixture",
  },
  {
    provider: "Claude",
    window: "7d",
    used: 60,
    resetAt: OBSERVED_AT + 3 * 86400000,
    capturedAt: OBSERVED_AT - 90 * MINUTE,
    source: "Synthetic Claude fixture",
  },
  {
    provider: "Grok",
    window: "7d",
    used: 10,
    resetAt: OBSERVED_AT + 4 * 86400000,
    capturedAt: OBSERVED_AT - 120 * MINUTE,
    source: "Synthetic Grok fixture",
  },
  {
    provider: "GitHub",
    window: "1h",
    used: 5,
    resetAt: OBSERVED_AT + 58 * MINUTE,
    capturedAt: OBSERVED_AT - MINUTE,
    source: "Synthetic GitHub fixture",
  },
];
export const DIRECTIONS: {
  id: Direction;
  letter: string;
  title: string;
  note: string;
}[] = [
  {
    id: "led",
    letter: "A",
    title: "LED ledger",
    note:
      "Twenty cells give a quick estimate. The exact percentage stays beside them.",
  },
  {
    id: "progress",
    letter: "B",
    title: "Progress ledger",
    note: "A thin continuous rail keeps the same ledger columns.",
  },
  {
    id: "chart",
    letter: "C",
    title: "Capacity chart",
    note:
      "Every bar shares a 0–100% scale. This is capacity, not a time series.",
  },
];

export function remaining(reading: Reading): number | null {
  return reading.used === null || !Number.isFinite(reading.used)
    ? null
    : Math.max(0, Math.min(100, 100 - reading.used));
}
export function percentage(left: number | null): string {
  if (left === null) return "—";
  // Percentage-scale subtraction can put 100 - 99.9 just below 0.1.
  if (left > 0 && left < .1 - Number.EPSILON * 100) return "<0.1";
  return String(Number(left.toFixed(1)));
}
export function cached(reading: Reading): boolean {
  return reading.capturedAt !== null &&
    OBSERVED_AT - reading.capturedAt > 15 * MINUTE;
}
export function cachedCount(readings: Reading[]): number {
  return readings.filter(cached).length;
}
export function cells(left: number | null): number {
  return left === null || left === 0
    ? 0
    : Math.max(1, Math.min(20, Math.round(left / 5)));
}
export function duration(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  return `${Math.floor(hours / 24)}d${hours % 24 ? ` ${hours % 24}h` : ""}`;
}
export function compactReset(reading: Reading): string {
  if (reading.resetAt === null) return "—";
  return reading.resetAt <= OBSERVED_AT
    ? "due"
    : duration(reading.resetAt - OBSERVED_AT).replaceAll(" ", "");
}
export function captured(reading: Reading): string {
  if (reading.capturedAt === null) return "No reading";
  return `${cached(reading) ? "Cached" : "Read"} ${
    duration(OBSERVED_AT - reading.capturedAt)
  } ago`;
}
export function absolute(time: number | null): string {
  return time === null
    ? "Unknown"
    : new Date(time).toISOString().replace("T", " ").replace(".000Z", " UTC");
}
export function readingsFor(scenario: Scenario): Reading[] {
  if (scenario === "pressure") {
    return EXAMPLE.map((reading, i) => ({
      ...reading,
      used: [97, 100, 84, 55, 3][i],
      capturedAt: OBSERVED_AT - (i === 2 ? 90 : 2) * MINUTE,
    }));
  }
  if (scenario === "missing") {
    return EXAMPLE.map((reading, i) => ({
      ...reading,
      used: i === 1 || i === 3 ? null : reading.used,
      capturedAt: i === 3 ? null : reading.capturedAt,
      resetAt: i === 1
        ? OBSERVED_AT - MINUTE
        : i === 3
        ? null
        : reading.resetAt,
    }));
  }
  return EXAMPLE.map((reading) => ({ ...reading }));
}
