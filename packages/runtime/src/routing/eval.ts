import { resolveRoute } from "./resolve.js";
import { RoutingStore } from "./store.js";
import { RoutingChunks } from "./chunks.js";
import type { RouteGold, RouteSignal } from "./types.js";

export const ROUTING_ABLATIONS: { name: string; signals: RouteSignal[] }[] = [
  { name: "S0", signals: ["S0"] }, { name: "S1", signals: ["S1"] }, { name: "S2", signals: ["S2"] },
  { name: "S0+S1", signals: ["S0", "S1"] }, { name: "S0+S1+S2", signals: ["S0", "S1", "S2"] },
];

export function evaluateRouting(store: RoutingStore, gold: RouteGold[], options: { now?: number; chunks?: RoutingChunks } = {}) {
  return ROUTING_ABLATIONS.map(({ name, signals }) => {
    const latencies: number[] = [];
    let top1 = 0, top3 = 0, candidates = 0, wrongResolved = 0, resolved = 0, none = 0;
    const failures: { id: string; outcome: string; expected: string; actual: string | null }[] = [];
    for (const row of gold) {
      const start = performance.now();
      // Both gold files label projects, not specific agents or sessions. Do not
      // reinterpret a task mentioning "sessions" as a session-selection label.
      const result = resolveRoute(store, row.query, { kind: "project", signals, now: options.now }, options.chunks);
      latencies.push(performance.now() - start);
      const first = result.candidates[0]?.target.projectRoot ?? null;
      if (first === row.projectRoot) top1++;
      if (result.candidates.slice(0, 3).some((c) => c.target.projectRoot === row.projectRoot)) top3++;
      if (result.outcome === "candidates") candidates++;
      if (result.outcome === "none") none++;
      if (result.outcome === "resolved") { resolved++; if (first !== row.projectRoot) wrongResolved++; }
      if (first !== row.projectRoot) failures.push({ id: row.id, outcome: result.outcome, expected: row.projectRoot, actual: first });
    }
    latencies.sort((a, b) => a - b);
    const rate = (count: number) => gold.length ? Number((count / gold.length).toFixed(4)) : 0;
    const percentile = (p: number) => Number((latencies[Math.max(0, Math.ceil(latencies.length * p) - 1)] ?? 0).toFixed(2));
    return { signals: name, n: gold.length, top1: rate(top1), top3: rate(top3), candidates: rate(candidates), wrongResolved: rate(wrongResolved),
      wrongResolvedCount: wrongResolved, resolved, none: rate(none), p50Ms: percentile(0.5), p95Ms: percentile(0.95), failures };
  });
}
