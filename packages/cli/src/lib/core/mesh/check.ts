import { knowledgeIndexEnabled } from "@openscout/runtime/knowledge";
import { basename } from "node:path";
import { RoutingStore, disabledRouteResult, parseRouteQuery, resolveRoute, ROUTE_CLOSE_RATIO, type RouteCandidate, type RouteResult } from "@openscout/runtime/routing";
import { loadScoutMachineInventory, loadScoutRecent, type ScoutRecentDeps, type ScoutRecentOptions, type ScoutRecentReport } from "./recent.ts";
import { resolveScoutMachines } from "./machine-selector.ts";

export type ScoutCheckOptions = { topic?: string; machine?: string; since?: number };
export type ScoutTopicCheck = { routing: RouteResult; activity: { candidate: RouteCandidate; live: ScoutRecentReport }[] };
export type ScoutCheckReport = ScoutRecentReport | ScoutTopicCheck;
export type ScoutCheckDeps = ScoutRecentDeps & {
  resolve?: typeof resolveRoute;
  store?: RoutingStore;
  recent?: (options: ScoutRecentOptions, deps: ScoutRecentDeps) => Promise<ScoutRecentReport>;
};

export async function loadScoutCheck(options: ScoutCheckOptions = {}, deps: ScoutCheckDeps = {}): Promise<ScoutCheckReport> {
  const recent = deps.recent ?? loadScoutRecent;
  if (!options.topic?.trim()) return recent({ machine: options.machine, since: options.since }, deps);
  if (!knowledgeIndexEnabled()) return { routing: disabledRouteResult(options.topic), activity: [] };
  const inventory = await loadScoutMachineInventory(deps);
  const nodes = Object.values({ ...inventory.knownNodes, [inventory.localNode.id]: inventory.localNode });
  if (options.machine) resolveScoutMachines(nodes, options.machine); // fail unknown explicit machines
  const machines = nodes.map((node) => ({ id: node.id, names: [node.name, node.hostName].filter((s): s is string => Boolean(s)) }));
  const routeOptions = { machine: options.machine, machines };
  const parsed = parseRouteQuery(options.topic, machines, routeOptions);
  if (!parsed.topic) return recent({ since: options.since, nodeIds: parsed.selected ?? undefined }, { ...deps, inventory });
  const store = deps.store ?? new RoutingStore();
  let routing: RouteResult;
  try { routing = (deps.resolve ?? resolveRoute)(store, options.topic, routeOptions); }
  finally { if (!deps.store) store.close(); }
  const best = routing.candidates[0];
  const candidates = routing.outcome === "none" || !best ? [] : routing.candidates
    .filter((candidate) => candidate.score >= best.score * ROUTE_CLOSE_RATIO).slice(0, 3);
  const activity = await Promise.all(candidates.map(async (candidate) => {
    let live: ScoutRecentReport;
    try {
      live = await recent({ since: options.since, machine: candidate.target.nodeId, projectRoot: candidate.target.projectRoot,
        ...(candidate.target.agentId ? { agentId: candidate.target.agentId } : {}) }, { ...deps, inventory });
    } catch (error) {
      // A stale indexed node must not erase successful reads for other candidates.
      live = { since: options.since ?? null, scope: "Topic live read unavailable", machines: [{
        nodeId: candidate.target.nodeId, nodeName: nodes.find((n) => n.id === candidate.target.nodeId)?.name ?? null,
        local: candidate.target.nodeId === inventory.localNode.id, status: "unavailable",
        error: (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 240),
      }] };
    }
    return { candidate, live };
  }));
  return { routing, activity };
}

export function checkResolutionLine(topic: string, candidate: RouteCandidate, nodeName?: string | null): string {
  const target = candidate.target;
  return `${topic} → ${target.kind} ${basename(target.projectRoot)} @ ${nodeName ?? target.nodeId} (${candidate.score.toFixed(2)})`
    .replace(/[\r\n\t\x00-\x1f\x7f]+/g, " ");
}

export function parseCheckSince(value: string, now = Date.now()): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/i.exec(value);
  const units: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const duration = match ? Number(match[1]) * units[match[2]!.toLowerCase()]! : NaN;
  if (!Number.isFinite(duration) || duration <= 0 || duration > now) throw new Error(`invalid since duration: ${value}`);
  return now - duration;
}
