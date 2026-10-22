import { digestHerdrTopology, emptyHerdrSessionTopology, HERDR_DIGEST_PANE_CAP, HERDR_DIGEST_LEAD_CAP,
  type HerdrSessionTopology, type HerdrWorkspacesRead } from "@openscout/protocol";
import { readHerdrSessionsSnapshot, readHerdrTopologySnapshot, type HerdrSessionInfo, type HerdrTopologyRead } from "./system-probes/herdr.js";
import type { ProbeSnapshot } from "./system-probes/registry.js";

export const HERDR_WORKSPACE_LIMITS = Object.freeze({ sessions: 8, enumeratedSessions: 256,
  workspacesPerSession: 16, tabsPerSession: 64, inputPanesPerSession: 256,
  emittedPanesPerSession: HERDR_DIGEST_PANE_CAP, leadsPerSession: HERDR_DIGEST_LEAD_CAP, concurrentSessions: 2 });
export type HerdrWorkspacesReadDeps = {
  nodeId: string;
  sessions?: () => Promise<ProbeSnapshot<HerdrSessionInfo[]>>;
  topology?: (session: string) => Promise<HerdrTopologyRead>;
};
const validSession = (value: string) => value.length > 0 && value.length <= 128 && value !== "." && value !== ".." && !/[/\\\x00-\x1f\x7f]/u.test(value);

/** Cap traversal before the presentation helper, which otherwise visits every
 * workspace/tab/pane and emits one unbounded shape per tab. Never mutate cache. */
function boundedTopology(input: HerdrSessionTopology): { topology: HerdrSessionTopology; truncated: boolean } {
  const limits = HERDR_WORKSPACE_LIMITS;
  let tabs = 0, panes = 0, truncated = input.workspaces.length > limits.workspacesPerSession;
  const workspaces = input.workspaces.slice(0, limits.workspacesPerSession).map(workspace => {
    const remaining = limits.tabsPerSession - tabs;
    if (workspace.tabs.length > remaining) truncated = true;
    const kept = workspace.tabs.slice(0, remaining).map(tab => {
      tabs++;
      const available = limits.inputPanesPerSession - panes;
      if (tab.panes.length > available) truncated = true;
      const keptPanes = tab.panes.slice(0, available); panes += keptPanes.length;
      // Geometry only determines the shape description, not a second pane
      // inventory. Bound it too; no terminal output is read or returned.
      if (tab.layout && (tab.layout.panes.length > limits.inputPanesPerSession || tab.layout.splits.length > limits.inputPanesPerSession)) truncated = true;
      const layout = tab.layout ? { ...tab.layout, panes: tab.layout.panes.slice(0, limits.inputPanesPerSession), splits: tab.layout.splits.slice(0, limits.inputPanesPerSession) } : null;
      return { ...tab, panes: keptPanes, layout };
    });
    return { ...workspace, tabs: kept };
  });
  return { topology: { ...input, workspaces }, truncated };
}

export async function readHerdrWorkspaces(deps: HerdrWorkspacesReadDeps, url: URL): Promise<{ status: number; body: HerdrWorkspacesRead | { error: string } }> {
  for (const key of url.searchParams.keys()) if (key !== "session" || url.searchParams.getAll(key).length !== 1) return { status: 400, body: { error: "invalid_herdr_query" } };
  const session = url.searchParams.get("session");
  if (session !== null && (!validSession(session) || session !== session.trim())) return { status: 400, body: { error: "invalid_herdr_session" } };
  const body: HerdrWorkspacesRead = { schema: "scout.herdr-workspaces/v1", nodeId: deps.nodeId, scannedAt: null,
    availability: "not_scanned", reason: "not_scanned", requestedSession: session, count: 0, digests: [], truncated: false,
    coverage: { kind: "ttl_cached_probes", scope: "this_host_only", listedSessions: null, limits: HERDR_WORKSPACE_LIMITS } };
  let snapshot: ProbeSnapshot<HerdrSessionInfo[]>;
  try { snapshot = await (deps.sessions ?? readHerdrSessionsSnapshot)(); }
  catch { body.availability = "unavailable"; body.reason = "session_list_unavailable"; return { status: 200, body }; }
  body.scannedAt = snapshot.error?.at ?? snapshot.at;
  if (snapshot.error || snapshot.status === "failed") {
    body.availability = "unavailable"; body.reason = "session_list_unavailable"; return { status: 200, body };
  }
  if (snapshot.at === null || snapshot.value === null) return { status: 200, body };
  body.reason = null;
  body.coverage.listedSessions = snapshot.value.length;
  const inspected = snapshot.value.slice(0, HERDR_WORKSPACE_LIMITS.enumeratedSessions);
  const names = [...new Set(inspected.map(entry => entry.name).filter(validSession))];
  const omitted = names.length !== inspected.length || snapshot.value.length > inspected.length;
  const stale = snapshot.stale || snapshot.status !== "fresh";
  body.truncated = omitted;
  if (session && !names.includes(session)) return { status: omitted ? 503 : 404, body: { error: omitted ? "herdr_inventory_incomplete" : "herdr_session_not_listed" } };
  const selected = session ? [session] : names.slice(0, HERDR_WORKSPACE_LIMITS.sessions);
  body.truncated ||= names.length > selected.length && session === null;
  const digests: HerdrWorkspacesRead["digests"] = new Array(selected.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(selected.length, HERDR_WORKSPACE_LIMITS.concurrentSessions) }, async () => {
    while (next < selected.length) {
      const index = next++, name = selected[index];
      let read: HerdrTopologyRead;
      try {
        read = await (deps.topology ?? readHerdrTopologySnapshot)(name);
        if (read.topology.session !== name) throw new Error("Herdr session mismatch");
      } catch { read = { topology: emptyHerdrSessionTopology(name, false, "unreadable"), availability: "unavailable" }; }
      const bounded = boundedTopology(read.topology);
      const digest = digestHerdrTopology(bounded.topology);
      if (bounded.truncated) { digest.truncated = true; digest.notes.push("Topology input capped; totals describe only the bounded prefix."); }
      if (read.availability === "partial" && read.topology.running) digest.notes.push("Some live topology or optional metadata was unavailable.");
      digests[index] = { ...digest, availability: read.availability };
    }
  }));
  body.digests = digests; body.count = digests.length;
  body.truncated ||= digests.some(digest => digest.truncated);
  body.availability = digests.length && digests.every(digest => digest.availability === "unavailable") ? "unavailable"
    : omitted || stale || digests.some(digest => digest.availability !== "available") ? "partial" : "available";
  return { status: 200, body };
}
