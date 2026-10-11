/**
 * World · FAILED · STUCK — the plain rules the engine draws with, kept pure so they can be tested.
 * Only real trouble takes the alarm:
 *   FAILED  a failed broker ask, or a message delivery that failed for a real reason. A delivery the broker closed as
 *           housekeeping ("Stale local delivery reconciled") is RECONCILED: a quiet count, no mark. A broker ask closed
 *           as "Stale running flight reconciled" stays FAILED: that work really died.
 *   STUCK   a broker ask (or an undelivered message) still open longer than the threshold at time t, and younger than the
 *           staleness horizon. Older than the horizon it is STALE: a quiet count (queue debris, not something to chase).
 *   Tool-call errors (a non-zero exit…) are not trouble at all here: a quiet number in the tally, nothing in the world.
 * An operator's own turn ("t") or a subagent call ("s") is work in progress, never stuck; rows from
 * older payloads carry no kind and count as broker asks. t is the playhead (the wall clock in LIVE).
 */
export const STUCK_DEFAULT = 30 * 60e3;
export const STUCK_CHOICES: [string, number][] = [["10m", 10 * 60e3], ["30m", 30 * 60e3], ["1h", 60 * 60e3]];
/** the staleness horizon: open longer than this is STALE (quiet), not STUCK */
export const STALE_DEFAULT = 24 * 36e5;
/** a delivery the broker closed as housekeeping: counted as RECONCILED, never FAILED */
export const RECONCILED_RE = /^\s*stale local delivery reconciled\b/i;

/** "10m", "30", "1h", "1.5 hours" → ms; anything outside 1 minute … 7 days is null */
export function parseStuck(s: unknown): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?)?$/i.exec(String(s ?? "").trim());
  if (!m) return null;
  const v = parseFloat(m[1]) * (/^h/i.test(m[2] || "m") ? 36e5 : 6e4);
  return v >= 6e4 && v <= 7 * 864e5 ? v : null;
}
/** ":stuck 30m 24h" → threshold and horizon (either may be left out: null keeps the current one). The horizon accepts
 *  days ("2d") and must be longer than the threshold; it runs up to 30 days. null when the words aren't durations */
export function parseStuckArgs(s: unknown): { ms: number | null; horizon: number | null } | null {
  const parts = String(s ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length || parts.length > 2) return null;
  const ms = parseStuck(parts[0]); if (!ms) return null;
  if (parts.length === 1) return { ms, horizon: null };
  const m = /^(\d+(?:\.\d+)?)\s*(m|h|d)$/i.exec(parts[1]); if (!m) return null;
  const horizon = parseFloat(m[1]) * ({ m: 6e4, h: 36e5, d: 864e5 } as Record<string, number>)[m[2].toLowerCase()];
  return horizon > ms && horizon <= 30 * 864e5 ? { ms, horizon } : null;
}
/** 30 min → "30M", 1 h → "1H", 24 h → "24H" */
export const stuckLabel = (ms: number) => ms % 864e5 === 0 && ms > 864e5 ? ms / 864e5 + "D" : ms % 36e5 === 0 ? ms / 36e5 + "H" : Math.round(ms / 6e4) + "M";

export type TroubleRow = { ts: number; done: number | null; st: string; src?: string; kind?: string; err?: string };
export const stuckable = (o: TroubleRow) => o.kind === "msg" || !o.src || o.src === "b";
const openAt = (o: TroubleRow, t: number) => stuckable(o) && o.ts <= t && (o.done == null || o.done > t);
/** open at t (sent, not finished by t), older than ms and no older than the horizon */
export const isStuck = (o: TroubleRow, t: number, ms: number, horizon = Infinity) => openAt(o, t) && t - o.ts > ms && t - o.ts <= horizon;
/** open at t and older than the horizon (and the threshold): queue debris, counted quietly */
export const isStale = (o: TroubleRow, t: number, ms: number, horizon = STALE_DEFAULT) => openAt(o, t) && t - o.ts > Math.max(ms, horizon);
/** a failed message delivery the broker closed as housekeeping */
export const isReconciled = (o: TroubleRow) => o.kind === "msg" && o.st === "f" && RECONCILED_RE.test(o.err || "");
/** finished by t as a failure (asks, and deliveries that failed for a real reason) */
export const isFailed = (o: TroubleRow, t: number) => o.st === "f" && o.done != null && o.done <= t && !isReconciled(o);
/** the tally's age buckets: how many are older than N, 2N, 4N (each includes the next) */
export function stuckBuckets(ages: number[], ms: number): [number, number, number] {
  const b: [number, number, number] = [0, 0, 0];
  for (const a of ages) { if (a > ms) b[0]++; if (a > 2 * ms) b[1]++; if (a > 4 * ms) b[2]++; }
  return b;
}
