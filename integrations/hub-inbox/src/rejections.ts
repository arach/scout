import type { InboxBucket } from "./worker.ts";

const HOUR = 3_600_000;
export const REJECTION_PREFIX = "r/";
type Counter = { count: number; lastAt: string };
type Hour = Record<string, Counter & { seconds: Record<number, number> }>;

const keyFor = (ms: number) => REJECTION_PREFIX + new Date(ms).toISOString().slice(0, 13);
const decode = (bytes: ArrayBuffer): Hour => JSON.parse(new TextDecoder().decode(bytes));

// Conditional writes keep simultaneous refusals on different Worker isolates
// from replacing one another. Only fixed reason names, counts and times go to R2.
export async function countRejection(bucket: InboxBucket, reason: string, now = Date.now()) {
  const key = keyFor(now);
  const at = new Date(now).toISOString();
  const second = Math.floor((now % HOUR) / 1000);
  for (;;) {
    const old = await bucket.get(key);
    const hour: Hour = old ? decode(await old.arrayBuffer()) : {};
    const counter = hour[reason] ??= { count: 0, lastAt: at, seconds: {} };
    counter.count++;
    if (at > counter.lastAt) counter.lastAt = at;
    counter.seconds[second] = (counter.seconds[second] ?? 0) + 1;
    const onlyIf = new Headers(old ? { "if-match": old.httpEtag } : { "if-none-match": "*" });
    if (await bucket.put(key, new TextEncoder().encode(JSON.stringify(hour)), { onlyIf })) return;
  }
}

export async function readRejections(bucket: InboxBucket, includeBuckets: boolean, now = Date.now()) {
  const cutoff = now - 24 * HOUR;
  const first = keyFor(cutoff);
  const second = Math.floor((cutoff % HOUR) / 1000);
  const rejections: Record<string, Counter> = {};
  // Cumulative per-hour counts let a collector distinguish new refusals from
  // old ones expiring in the same poll. A normal health read needs only totals.
  const rejectionBuckets: Record<string, Record<string, number>> = {};
  let cursor: string | undefined;
  const keys: string[] = [];
  do {
    const page = await bucket.list({ prefix: REJECTION_PREFIX, cursor });
    keys.push(...page.objects.map(o => o.key).filter(key => key >= first && key <= keyFor(now)));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  for (const key of keys) {
    const obj = await bucket.get(key);
    if (!obj) continue;
    const counts: Record<string, number> = {};
    for (const [reason, entry] of Object.entries(decode(await obj.arrayBuffer()))) {
      const count = key === first
        ? Object.entries(entry.seconds).reduce((sum, [s, n]) => sum + (Number(s) >= second ? n : 0), 0)
        : entry.count;
      if (!count) continue;
      const total = rejections[reason] ??= { count: 0, lastAt: entry.lastAt };
      total.count += count;
      if (entry.lastAt > total.lastAt) total.lastAt = entry.lastAt;
      counts[reason] = entry.count;
    }
    if (includeBuckets) rejectionBuckets[key.slice(REJECTION_PREFIX.length)] = counts;
  }
  return { rejections, ...(includeBuckets ? { rejectionBuckets } : {}) };
}
