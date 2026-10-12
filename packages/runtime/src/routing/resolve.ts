import { RoutingChunks } from "./chunks.js";
import { RoutingStore, ROUTE_EXTRACTOR_VERSION } from "./store.js";
import { decay, ftsQuery, scoreRouteName, words } from "./text.js";
import type { RouteCandidate, RouteMachine, RouteOptions, RouteResult, RouteSignal, RouteTarget } from "./types.js";

// Advisory shortlist weights, not dispatch confidence or probabilities.
// The P1 ablation favored chunks. Fingerprints and partial names break ties.
const SIGNALS: RouteSignal[] = ["S0", "S1", "S2"];
const WEIGHTS: Record<RouteSignal, number> = { S0: 0.1, S1: 0.2, S2: 0.7 };
export const ROUTE_CLOSE_RATIO = 0.8;
type Score = { score: number; terms: string[] };

function machineNames(machine: RouteMachine): string[] {
  return [...new Set([machine.id, ...machine.names.flatMap((name) => [name, name.replace(/\.local$/i, ""), ...name.split(/[^\p{L}\p{N}]+/u)])])]
    .map((name) => name.toLowerCase()).filter(Boolean);
}

export function parseRouteQuery(query: string, machines: RouteMachine[], options: RouteOptions) {
  let topic = query.trim();
  let selected: string[] | null = null;
  const warnings: string[] = [];
  const select = (reference: string) => {
    const needle = reference.trim().toLowerCase();
    const exact = machines.find((m) => m.id.toLowerCase() === needle);
    return exact ? [exact.id] : machines.filter((m) => machineNames(m).includes(needle)).map((m) => m.id);
  };
  if (options.machine) {
    selected = select(options.machine);
    if (!selected.length) warnings.push(`Unknown machine: ${options.machine}`);
  }
  // Only the trailing, explicit "on <known machine>" form is syntax.
  // Never erase ordinary name words ("world week", "work on hex", "agent").
  const suffix = /(?:^|\s)on\s+(\S+)$/i.exec(topic);
  if (suffix) {
    const ids = select(suffix[1]!);
    if (ids.length) {
      selected = selected === null ? ids : selected.filter((id) => ids.includes(id));
      topic = topic.slice(0, suffix.index).trim();
    }
  }
  return { topic, kind: options.kind ?? "project", selected, warnings };
}

function ranked(scores: Map<string, Score>, allowed: Set<string>): [string, Score][] {
  return [...scores].filter(([id, s]) => allowed.has(id) && s.score > 0)
    .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0])).slice(0, 20);
}

function fuse(targets: RouteTarget[], signals: Partial<Record<RouteSignal, Map<string, Score>>>): RouteCandidate[] {
  const byId = new Map(targets.map((target) => [target.id, target]));
  const allowed = new Set(byId.keys());
  const result = new Map<string, RouteCandidate>();
  const rankings = new Map(SIGNALS.map((signal) => [signal, ranked(signals[signal] ?? new Map(), allowed)]));
  const weight = SIGNALS.reduce((sum, signal) => sum + (rankings.get(signal)!.length ? WEIGHTS[signal] : 0), 0);
  for (const signal of SIGNALS) {
    const scores = signals[signal];
    if (!scores) continue;
    const ranking = rankings.get(signal)!;
    const best = ranking[0]?.[1].score ?? 1;
    ranking.forEach(([id, score], index) => {
      const candidate = result.get(id) ?? { target: byId.get(id)!, score: 0, signals: {} };
      const rank = index + 1;
      const contribution = (WEIGHTS[signal] / weight) * (score.score / best) * (11 / (10 + rank));
      candidate.score += contribution;
      candidate.signals[signal] = { ...score, rank, contribution };
      result.set(id, candidate);
    });
  }
  return [...result.values()].sort((a, b) => b.score - a.score || a.target.id.localeCompare(b.target.id)).slice(0, 20);
}

export function resolveRoute(store: RoutingStore, query: string, options: RouteOptions = {}, chunks?: RoutingChunks): RouteResult {
  if (query.length > 32_768) throw new Error("Routing query exceeds 32768 characters");
  const now = options.now ?? Date.now();
  const signals = options.signals ?? SIGNALS;
  const machines = options.machines ?? store.meta<RouteMachine[]>("machines", []);
  const parsed = parseRouteQuery(query, machines, options);
  const all = store.targets();
  const scoped = all.filter((t) => (parsed.selected === null || parsed.selected.includes(t.nodeId))
    && (!options.nodeIds || options.nodeIds.includes(t.nodeId))
    && (!options.projectRoot || t.projectRoot === options.projectRoot)
    && (!options.agentId || t.agentId === options.agentId || t.kind === "project"));
  const indexedAt = store.meta<number | null>("indexedAt", null);
  const result: RouteResult = { outcome: "none", query, topic: parsed.topic, reason: "No matching topic in indexed coverage", candidates: [], coverage: {
    localOnly: true, machines: machines.filter((m) => m.id === store.meta("nodeId", "")),
    selectedMachineIds: parsed.selected ?? [...new Set(scoped.map((t) => t.nodeId))], peerDigests: [],
    indexedAt, ageMs: indexedAt === null ? null : Math.max(0, now - indexedAt), targets: all.length, scopedTargets: scoped.length,
    signals: [...signals], chunksIndexedAt: store.meta<number | null>("chunksIndexedAt", null),
    warnings: [...store.meta<string[]>("warnings", []), ...parsed.warnings, "Local index only; no peer digests, live status, or dispatch."],
  } };
  if (indexedAt !== null && store.meta<string>("extractor", "") !== ROUTE_EXTRACTOR_VERSION) {
    result.coverage.warnings.push("Fingerprint extractor changed; run scout where index for the new fingerprints");
  }
  if (!all.length) { result.reason = "Empty routing index; run scout where index"; return result; }
  if (!parsed.topic) { result.reason = "No topic after the machine constraint"; return result; }
  const candidates = scoped.filter((t) => t.kind === parsed.kind);
  const s0 = new Map<string, Score>();
  if (signals.includes("S0")) for (const t of scoped) {
    const score = Math.max(0, ...t.names.map((name) => scoreRouteName(name, parsed.topic)));
    if (score) s0.set(t.id, { score, terms: [parsed.topic] });
  }
  const exact = candidates.filter((t) => s0.get(t.id)?.score === 900);
  if (exact.length) {
    result.outcome = exact.length === 1 ? "resolved" : "candidates";
    result.reason = exact.length === 1 ? "Unique exact name in scope" : "Tied exact names in scope";
    result.candidates = exact.slice(0, 3).map((target) => ({ target, score: 1, signals: { S0: { ...s0.get(target.id)!, rank: 1, contribution: 1 } } }));
    return result;
  }
  if (!words(parsed.topic).length) { result.reason = "No topical words after stoplist filtering"; return result; }

  const s1 = new Map<string, Score>();
  const topicWords = [...new Set(words(parsed.topic))].slice(0, 32);
  const topicWordSet = new Set(topicWords);
  if (signals.includes("S1")) {
    const rows = store.db.query<{ target_id: string; rank: number }>(
      "SELECT target_id,bm25(route_docs,5,2,3,0,0) AS rank FROM route_docs WHERE route_docs MATCH ? ORDER BY rank ASC",
    ).all(ftsQuery(parsed.topic));
    const allowed = new Set(scoped.filter((t) => t.kind === "project" || (t.kind === parsed.kind)).map((t) => t.id));
    const byId = new Map(scoped.map((t) => [t.id, t]));
    for (const row of rows) {
      if (!allowed.has(row.target_id)) continue;
      const target = byId.get(row.target_id)!;
      let raw = 0, aged = 0;
      const terms = new Set<string>();
      for (const term of store.terms(row.target_id)) {
        const matched = term.term.split(" ").filter((word) => topicWordSet.has(word));
        if (!matched.length) continue;
        const weight = (term.field === "stable" ? 2 : 3) * (1 + Math.log(term.weight));
        raw += weight;
        aged += weight * (term.field === "recent" ? decay(term.lastUsedAt, now) : 1);
        if (term.field === "stable" || decay(term.lastUsedAt, now) >= 0.05) matched.forEach((t) => terms.add(t));
      }
      const nameWords = words(target.names.join(" "));
      for (const word of topicWords) if (nameWords.includes(word)) { raw += 5; aged += 5; terms.add(word); }
      const score = Math.max(0, -row.rank) * (raw ? aged / raw : 0);
      if (score > 0 && terms.size) s1.set(row.target_id, { score, terms: [...terms] });
    }
  }

  const maps: Partial<Record<RouteSignal, Map<string, Score>>> = {};
  if (signals.includes("S0")) maps.S0 = s0;
  if (signals.includes("S1")) maps.S1 = s1;
  // Run S2 on every lexical query, not only when a weak fingerprint gives up.
  // One grouped pass covers projects and children, without rereading bodies.
  if (signals.includes("S2") && store.mappings().length) {
    const reader = chunks ?? new RoutingChunks();
    try {
      if (!reader.hasCachedKeys()) {
        const keys = store.chunkKeys();
        if (keys.length) reader.useCachedKeys(keys);
      }
      maps.S2 = reader.votes(parsed.topic, store.mappings(), new Set(scoped.filter((t) => t.kind === "project" || t.kind === parsed.kind).map((t) => t.id)), now);
      if (!reader.available()) result.coverage.warnings.push("S2 unavailable: no explicitly indexed session chunks");
    } finally { if (!chunks) reader.close(); }
  }
  if (signals.includes("S2") && !maps.S2) result.coverage.warnings.push("S2 unavailable: no mapped session chunks; run scout where index after explicit search indexing");
  let pool = candidates;
  if (parsed.kind !== "project") {
    const projects = fuse(scoped.filter((t) => t.kind === "project"), maps).slice(0, 3);
    const roots = new Set(projects.map((c) => `${c.target.nodeId}\0${c.target.projectRoot}`));
    pool = pool.filter((t) => roots.has(`${t.nodeId}\0${t.projectRoot}`));
  }
  result.candidates = fuse(pool, maps).slice(0, 3);
  if (result.candidates.length) {
    const [first, second] = result.candidates;
    result.outcome = !second || second.score < first!.score * ROUTE_CLOSE_RATIO ? "resolved" : "candidates";
    result.reason = result.outcome === "resolved" ? "Clear shortlist leader; identity is checked downstream"
      : "Similarly scored candidates; shortlist is advisory";
  }

  return result;
}

export function routingStatus(store: RoutingStore) {
  const targets = store.targets();
  return {
    path: store.path, targets: targets.length,
    kinds: Object.fromEntries(["project", "agent", "session"].map((kind) => [kind, targets.filter((t) => t.kind === kind).length])),
    machines: store.meta("machines", []), localNodeId: store.meta("nodeId", null), peerDigests: [], signals: SIGNALS,
    indexedAt: store.meta("indexedAt", null), chunksIndexedAt: store.meta("chunksIndexedAt", null),
    warnings: store.meta("warnings", []), refresh: "explicit only (timer deferred)",
    lastRun: store.db.query("SELECT * FROM route_runs ORDER BY id DESC LIMIT 1").get(),
  };
}
