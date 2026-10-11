import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { AgentDefinition, NodeDefinition, RouteAliasBinding } from "@openscout/protocol";
import type { RuntimeRegistrySnapshot } from "../registry.js";
import { RoutingChunks } from "./chunks.js";
import { git, projectCanonicalizer, projectId, sessionTargetId } from "./identity.js";
import { ROUTE_EXTRACTOR_VERSION, RoutingStore } from "./store.js";
import { extractPathTerms, extractTerms, hash } from "./text.js";
import type { RouteGold, RouteMachine, RouteTarget, RouteTerm } from "./types.js";

export type RoutingSnapshot = Pick<RuntimeRegistrySnapshot, "nodes" | "agents" | "endpoints" | "messages" | "invocations">;
export type RoutingRefreshInput = {
  node: Pick<NodeDefinition, "id" | "name" | "hostName">;
  snapshot: RoutingSnapshot;
  aliases?: RouteAliasBinding[];
  full?: boolean;
  now?: number;
  brokerCursor?: number;
  chunks?: RoutingChunks;
  excludeGold?: RouteGold[];
  warnings?: string[];
};

function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function rootForAgent(agent: AgentDefinition, snapshot: RoutingSnapshot): string | null {
  return text(agent.metadata?.projectRoot) ?? Object.values(snapshot.endpoints)
    .find((e) => e.agentId === agent.id && e.nodeId === agent.homeNodeId && e.projectRoot)?.projectRoot ?? null;
}

export function mineRoutingGold(snapshot: RoutingSnapshot, nodeId: string): RouteGold[] {
  const canonical = projectCanonicalizer();
  const seen = new Set<string>();
  const gold: RouteGold[] = [];
  for (const invocation of Object.values(snapshot.invocations).sort((a, b) => a.createdAt - b.createdAt)) {
    if (!["scout-cli", "scout-mcp"].includes(text(invocation.metadata?.source) ?? "")) continue;
    const agent = snapshot.agents[invocation.targetAgentId];
    if ((agent && agent.homeNodeId !== nodeId) || (invocation.targetNodeId && invocation.targetNodeId !== nodeId)) continue;
    const endpoints = Object.values(snapshot.endpoints).filter((e) => e.agentId === invocation.targetAgentId && e.nodeId === nodeId);
    const endpointRoots = [...new Set(endpoints.map((e) => e.projectRoot && canonical(e.projectRoot)).filter(Boolean))];
    if (!agent && endpointRoots.length !== 1) continue;
    const explicit = text(invocation.context?.projectPath) ?? text(invocation.metadata?.projectPath);
    const root = explicit ?? (agent ? rootForAgent(agent, snapshot) : endpointRoots[0]);
    const projectRoot = root && canonical(root);
    const query = invocation.task.trim();
    if (!projectRoot || query.length < 8) continue;
    const key = hash([query, projectRoot]);
    if (seen.has(key)) continue;
    seen.add(key);
    gold.push({ id: invocation.id, query, projectRoot, source: "A", ...(invocation.messageId ? { messageId: invocation.messageId } : {}) });
  }
  return gold;
}

export function refreshRoutingIndex(store: RoutingStore, input: RoutingRefreshInput) {
  const now = input.now ?? Date.now();
  const started = performance.now();
  const chunks = input.chunks ?? new RoutingChunks();
  const warnings = [...(input.warnings ?? [])];
  const canonical = projectCanonicalizer();
  const snapshot = input.snapshot;
  const full = Boolean(input.full || store.meta<string>("extractor", "") !== ROUTE_EXTRACTOR_VERSION || store.meta("nodeId", input.node.id) !== input.node.id);
  const excluded = new Set(input.excludeGold?.flatMap((g) => [g.id, g.messageId].filter((id): id is string => Boolean(id))) ?? []);
  const excludedTexts = input.excludeGold?.map((g) => g.query.toLowerCase()).filter((q) => q.length >= 20).flatMap((q) => q.length >= 120 ? [q, q.slice(0, 120)] : [q]) ?? [];
  let sourcesChanged = 0;
  let chunkCollectionsRead = 0;
  try {
    return store.transaction(() => {
      if (full) store.reset();
      const targets = new Map(store.targets().map((target) => [target.id, target]));
      const addTarget = (target: RouteTarget) => { targets.set(target.id, target); store.putTarget(target, now); return target; };
      for (const { id, alias } of store.meta<{ id: string; alias: string }[]>("aliasNames", [])) {
        const target = targets.get(id);
        if (target) addTarget({ ...target, names: target.names.filter((name) => name !== alias) });
      }
      for (const target of targets.values()) if (target.kind === "project") {
        addTarget({ ...target, names: [...target.names, basename(target.projectRoot), target.projectRoot] });
      }
      const ensureProject = (path: string): RouteTarget | null => {
        const root = canonical(path);
        if (!root) return null;
        const id = projectId(input.node.id, root);
        return targets.get(id) ?? addTarget({ id, kind: "project", nodeId: input.node.id, projectRoot: root, projectKey: null,
          agentId: null, harness: null, sessionId: null, names: [basename(root), root] });
      };
      const evidence = (key: string, target: RouteTarget, value: string, terms: RouteTerm[]) => {
        if (store.putEvidence({ key, targetId: target.id, hash: hash(value), terms })) sourcesChanged++;
      };
      const agentTargets = new Map<string, RouteTarget>();
      const sessionTargets = new Map<string, RouteTarget>();
      for (const agent of Object.values(snapshot.agents)) {
        if (agent.homeNodeId !== input.node.id) continue;
        const path = rootForAgent(agent, snapshot);
        const project = path && ensureProject(path);
        if (!project) continue;
        const target = addTarget({ ...project, id: `agent:${agent.id}`, kind: "agent", agentId: agent.id,
          names: [agent.id, agent.handle, agent.displayName, agent.selector, agent.defaultSelector].filter((s): s is string => Boolean(s)) });
        agentTargets.set(agent.id, target);
      }
      for (const endpoint of Object.values(snapshot.endpoints)) {
        if (endpoint.nodeId !== input.node.id || !endpoint.sessionId) continue;
        const owner = agentTargets.get(endpoint.agentId);
        const project = endpoint.projectRoot ? ensureProject(endpoint.projectRoot) : owner && targets.get(projectId(input.node.id, owner.projectRoot));
        if (!project) continue;
        const nativeSessionId = text(endpoint.metadata?.externalSessionId) ?? endpoint.sessionId;
        const session = addTarget({ ...project, kind: "session", id: sessionTargetId(input.node.id, endpoint.harness, nativeSessionId),
          agentId: owner?.agentId ?? null, sessionId: nativeSessionId, harness: endpoint.harness,
          names: [endpoint.sessionId, nativeSessionId, text(endpoint.metadata?.displayName), text(endpoint.metadata?.handle)].filter((s): s is string => Boolean(s)) });
        sessionTargets.set(`${endpoint.harness}\0${nativeSessionId}`, session);
        // Cardless asks have an endpoint but intentionally no durable agent card.
        // Attribute their prompts to the existing session, never invent an agent.
        if (!owner) {
          const roots = new Set(Object.values(snapshot.endpoints).filter((e) => e.agentId === endpoint.agentId && e.nodeId === input.node.id)
            .map((e) => e.projectRoot && canonical(e.projectRoot)).filter(Boolean));
          if (roots.size === 1) agentTargets.set(endpoint.agentId, session);
        }
      }

      const invocationMessages = new Set(Object.values(snapshot.invocations).map((i) => i.messageId));
      const addPrompt = (key: string, value: string, time: number, target: RouteTarget) => {
        const terms = extractTerms(value.slice(0, 32_768), "recent", time);
        evidence(key, target, value, terms);
        const project = ensureProject(target.projectRoot)!;
        if (target.id !== project.id) evidence(key, project, value, terms);
      };
      for (const invocation of Object.values(snapshot.invocations)) {
        if (excluded.has(invocation.id) || excluded.has(invocation.messageId ?? "")) continue;
        if (invocation.targetNodeId && invocation.targetNodeId !== input.node.id) continue;
        const target = agentTargets.get(invocation.targetAgentId);
        if (target) addPrompt(`broker:ask:${invocation.id}`, invocation.task, invocation.createdAt, target);
      }
      for (const message of Object.values(snapshot.messages)) {
        if (excluded.has(message.id) || invocationMessages.has(message.id) || message.class !== "agent") continue;
        const ids = [...new Set(message.audience?.invoke ?? message.audience?.notify ?? [])];
        // Do not interpret body mentions or guess a project for group/broadcast text.
        const target = ids.length === 1 ? agentTargets.get(ids[0]!) : agentTargets.get(message.actorId);
        if (target) addPrompt(`broker:message:${message.id}`, message.body, message.createdAt, target);
      }

      const collections = chunks.collections();
      const knownCollections = new Set(collections.map((c) => `chunks:${c.id}`));
      store.removeSources("chunks:", knownCollections);
      store.db.exec("DELETE FROM route_chunk_collections");
      for (const collection of collections) {
        const facets = JSON.parse(collection.facets_json) as Record<string, string>;
        const project = facets.projectPath && ensureProject(facets.projectPath);
        if (!project) continue;
        const known = sessionTargets.get(`${facets.harness}\0${facets.sessionId}`);
        const session = facets.sessionId && facets.harness ? addTarget({ ...project,
          id: sessionTargetId(input.node.id, facets.harness, facets.sessionId), kind: "session",
          sessionId: facets.sessionId, harness: facets.harness, agentId: known?.agentId ?? null,
          names: [...(known?.names ?? []), facets.sessionId, collection.title],
        }) : null;
        store.putMapping({ collectionId: collection.id, projectId: project.id, sessionId: session?.id ?? null,
          agentId: session?.agentId ? `agent:${session.agentId}` : null });
        const cursorKey = `chunks:${collection.id}`;
        // Content and extractor fingerprints, not elapsed time, decide whether to reread.
        const fingerprint = hash([collection.content_hash, collection.facets_json, collection.source_refs_json, collection.updated_at]);
        if (store.cursor(cursorKey, "") === fingerprint) continue;
        const refs = JSON.parse(collection.source_refs_json) as { anchor?: { mtimeMs?: number } }[];
        const time = refs[0]?.anchor?.mtimeMs ?? 0; // transcript mtime, never index time
        store.putChunkKeys(collection.id, chunks.keys(collection.id));
        const terms: RouteTerm[] = [];
        for (const chunk of chunks.chunks(collection.id)) {
          if (excludedTexts.some((q) => chunk.text.toLowerCase().includes(q))) continue;
          const chunkFacets = JSON.parse(chunk.facets_json) as { documentKind?: string; touchedPath?: string | string[] };
          // Tool output/meta include policies, approval JSON and repeated path
          // listings. The session index already identifies conversational lines;
          // use those for the small fingerprint and leave raw evidence to S2.
          const body = chunkFacets.documentKind === "events"
            ? chunk.text.split("\n").filter((line) => /`(?:user_turn|assistant_turn)`/.test(line)).join("\n")
            : chunkFacets.documentKind === "files" ? "" : chunk.text;
          terms.push(...extractTerms(body, "stable", time), ...extractTerms(body, "recent", time));
          const paths = [chunkFacets.touchedPath ?? []].flat();
          terms.push(...extractPathTerms(paths, "stable", time), ...extractPathTerms(paths, "recent", time));
        }
        evidence(cursorKey, project, fingerprint, terms);
        if (session) evidence(cursorKey, session, fingerprint, terms);
        store.setCursor(cursorKey, fingerprint);
        chunkCollectionsRead++;
      }
      store.db.exec("DELETE FROM route_chunk_keys WHERE collection_id NOT IN (SELECT collection_id FROM route_chunk_collections)");

      // Alias metadata is advisory: broker dispatch continues to own expiry/revision validation.
      const aliasNames: { id: string; alias: string }[] = [];
      for (const binding of input.aliases ?? []) {
        if (binding.scopeNodeId !== input.node.id || binding.state !== "active" || (binding.expiresAt && binding.expiresAt <= now)) continue;
        const aliasTarget = binding.target;
        const target = aliasTarget.kind === "agent" ? agentTargets.get(aliasTarget.agentId)
          : [...targets.values()].find((t) => t.kind === "session" && t.sessionId === aliasTarget.sessionId);
        if (!target) continue;
        addTarget({ ...target, names: [...target.names, binding.alias] });
        aliasNames.push({ id: target.id, alias: binding.alias });
        const project = ensureProject(target.projectRoot)!;
        addTarget({ ...project, names: [...project.names, binding.alias] });
        aliasNames.push({ id: project.id, alias: binding.alias });
      }
      store.setMeta("aliasNames", aliasNames);

      for (const project of [...targets.values()].filter((t) => t.kind === "project")) {
        const root = project.projectRoot;
        for (const name of ["README.md", "AGENTS.md", "CLAUDE.md", "package.json"]) {
          const key = `manifest:${project.id}:${name}`;
          try {
            const path = join(root, name);
            const stat = statSync(path);
            const cursor = `${stat.mtimeMs}:${stat.size}`;
            if (store.cursor(key, "") === cursor) continue;
            if (!stat.isFile() || stat.size > 256 * 1024) { warnings.push(`Skipped oversized/non-file manifest: ${path}`); continue; }
            const body = readFileSync(path, "utf8");
            evidence(key, project, body, extractTerms(body, "stable", stat.mtimeMs));
            store.setCursor(key, cursor);
          } catch { store.removeSources(key); store.setCursor(key, null); }
        }
        try {
          const dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules").map((d) => d.name).sort().join(" ");
          evidence(`directories:${project.id}`, project, dirs, extractTerms(dirs, "stable", 0));
        } catch { /* unavailable project still has names */ }
        const head = git(root, ["rev-parse", "HEAD"]);
        if (!head) continue;
        const key = `git:${project.id}`;
        const branch = git(root, ["branch", "--show-current"]);
        const oldBranch = store.cursor(`${key}:branch`, "");
        addTarget({ ...project, names: [...project.names.filter((n) => n !== oldBranch), basename(root), root, ...(branch ? [branch] : [])] });
        store.setCursor(`${key}:branch`, branch ?? "");
        const previous = store.cursor<string | null>(key, null);
        if (previous === head) continue;
        const incremental = previous && git(root, ["merge-base", "--is-ancestor", previous, head]) !== null;
        if (previous && !incremental) { store.removeSources(`${key}:`); warnings.push(`Reset stale git cursor for ${root}`); }
        const log = git(root, ["log", "-201", "--format=%x1e%H%x1f%ct%x1f%s", "--name-only", incremental ? `${previous}..${head}` : head, "--"]);
        if (log === null) { warnings.push(`Git log unavailable: ${root}; cursor not advanced`); continue; }
        const entries = log.split("\x1e").filter(Boolean);
        if (entries.length > 200) warnings.push(`Git history capped at 200 newest commits: ${root}`);
        for (const entry of entries.slice(0, 200)) {
          const [sha, epoch, ...rest] = entry.split("\x1f");
          const [subject, ...paths] = rest.join("\x1f").split("\n");
          const time = Number(epoch) * 1000;
          if (!sha || !Number.isFinite(time)) continue;
          evidence(`${key}:${sha}`, project, entry, [
            ...extractTerms(subject ?? "", "stable", time), ...extractTerms(subject ?? "", "recent", time),
            ...extractPathTerms(paths, "stable", time), ...extractPathTerms(paths, "recent", time),
          ]);
        }
        store.setCursor(key, head);
      }
      const targetsChanged = store.finish(now);
      const machines: RouteMachine[] = Object.values({ ...snapshot.nodes, [input.node.id]: input.node }).map((node) => ({
        id: node.id, names: [node.name, node.hostName].filter((s): s is string => Boolean(s)),
      }));
      store.setMeta("machines", machines);
      store.setMeta("nodeId", input.node.id);
      store.setMeta("extractor", ROUTE_EXTRACTOR_VERSION);
      store.setMeta("indexedAt", now);
      store.setMeta("chunksIndexedAt", collections.length ? Math.max(...collections.map((c) => c.updated_at)) : null);
      store.setMeta("warnings", warnings);
      if (input.brokerCursor !== undefined) store.setCursor("broker", input.brokerCursor);
      const counts = { targets: targets.size, targetsChanged, sourcesChanged, chunkCollectionsRead, warnings };
      store.db.query("INSERT INTO route_runs(mode,counts_json,started_at,duration_ms) VALUES (?,?,?,?)")
        .run(full ? "full" : "incremental", JSON.stringify(counts), now, Math.round(performance.now() - started));
      return { ...counts, mode: full ? "full" : "incremental", durationMs: Math.round(performance.now() - started) };
    });
  } finally { if (!input.chunks) chunks.close(); }
}
