import { expect, test } from "bun:test";
import { createPollingReadCache, pollingReadFailureResponse, PollingReadUnavailable } from "./polling-read-cache.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("a slow refresh stays shared after the old observe TTL; freshness starts on completion", async () => {
  let now = 0;
  let calls = 0;
  const work = deferred<number>();
  const cache = createPollingReadCache<number>({ ttlMs: 900, now: () => now });
  const load = () => { calls += 1; return work.promise; };
  const first = cache.get("session", load);
  await Promise.resolve();
  now = 10_000;
  const second = cache.get("session", load);
  expect(second).toBe(first);
  expect(calls).toBe(1);
  work.resolve(7);
  expect(await first).toBe(7);
  now = 10_899;
  expect(await cache.get("session", () => 8)).toBe(7);
  now = 10_900;
  expect(await cache.get("session", () => 8)).toBe(8);
});

test("failures back off exponentially with a cap; polls do not retry during cooldown; success resets", async () => {
  let now = 0;
  let calls = 0;
  const cache = createPollingReadCache<number>({ ttlMs: 1, now: () => now, random: () => 0.5 });
  const fail = () => { calls += 1; throw new Error("private SQL /path"); };
  for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
    const error = await cache.get("view", fail).catch((error) => error);
    expect(error).toBeInstanceOf(PollingReadUnavailable);
    expect(error.retryAfterMs).toBe(delay);
    const count = calls;
    for (let poll = 0; poll < 20; poll++) await cache.get("view", fail).catch(() => {});
    expect(calls).toBe(count);
    const response = pollingReadFailureResponse(error);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe(String(delay / 1_000));
    expect(await response.text()).not.toContain("private SQL");
    now += delay;
  }
  expect(await cache.get("view", () => 1)).toBe(1);
  now += 1;
  const reset = await cache.get("view", fail).catch((error) => error);
  expect(reset.retryAfterMs).toBe(1_000);
});

test("admission bounds independent work and never evicts pending work or a cooldown", async () => {
  const work = deferred<number>();
  const cache = createPollingReadCache<number>({ ttlMs: 900, maxEntries: 1, random: () => 0.5 });
  const first = cache.get("a", () => work.promise);
  await expect(cache.get("b", () => 2)).rejects.toBeInstanceOf(PollingReadUnavailable);
  expect(cache.get("a", () => 99)).toBe(first);
  work.resolve(1);
  await first;
  await expect(cache.get("b", () => { throw new Error("busy"); })).rejects.toBeInstanceOf(PollingReadUnavailable);
  await expect(cache.get("c", () => 3)).rejects.toBeInstanceOf(PollingReadUnavailable);
});

test("concurrent key limit rejects excess work without starting it", async () => {
  const work = deferred<number>();
  const cache = createPollingReadCache<number>({ ttlMs: 900, maxConcurrent: 1 });
  const first = cache.get("a", () => work.promise);
  let started = false;
  await expect(cache.get("b", () => { started = true; return 2; })).rejects.toBeInstanceOf(PollingReadUnavailable);
  expect(started).toBe(false);
  work.resolve(1);
  await first;
  expect(await cache.get("b", () => 2)).toBe(2);
});

test("a pre-mutation refresh cannot repopulate the response cache after invalidation", async () => {
  const work = deferred<number>();
  const cache = createPollingReadCache<number>({ ttlMs: 2_000 });
  const first = cache.get("attention", () => work.promise);
  cache.invalidate("attention");
  work.resolve(1);
  await first;
  expect(await cache.get("attention", () => 2)).toBe(2);
});
