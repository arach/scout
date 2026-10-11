import type { NodeDefinition, RouteAliasBinding } from "@openscout/protocol";
import { requestScoutBrokerJson } from "../broker-api.js";
import { resolveBrokerSocketPathForBaseUrl } from "../broker-process-manager.js";
import { ROUTE_EXTRACTOR_VERSION, RoutingStore } from "./store.js";
import type { RoutingRefreshInput, RoutingSnapshot } from "./refresh.js";

export type RoutingRead = <T>(path: string) => Promise<T>;

/** A broker-owned read API, never a second writer/reader of broker.sqlite. */
export async function readRoutingBrokerSource(store: RoutingStore, brokerUrl: string, full = false, read?: RoutingRead): Promise<RoutingRefreshInput> {
  const readJson: RoutingRead = read ?? (<T>(path: string) => requestScoutBrokerJson<T>(brokerUrl, path, {
    socketPath: resolveBrokerSocketPathForBaseUrl(brokerUrl), signal: AbortSignal.timeout(60_000),
  }));
  const startedAt = Date.now();
  const node = await readJson<NodeDefinition>("/v1/node");
  if (!node?.id) throw new Error("Broker returned no local node identity");
  const cursor = store.cursor("broker", 0);
  const stale = !Number.isFinite(cursor) || cursor < 0 || cursor > startedAt || store.meta("nodeId", node.id) !== node.id;
  const rebuild = full || stale || store.meta<string>("extractor", "") !== ROUTE_EXTRACTOR_VERSION;
  const since = rebuild ? 0 : Math.max(0, cursor - 1_000);
  const snapshot = await readJson<RoutingSnapshot>(`/v1/snapshot${since ? `?since=${since}` : ""}`);
  if (!snapshot?.agents || !snapshot.endpoints || !snapshot.nodes || !snapshot.messages || !snapshot.invocations) {
    throw new Error("Broker returned an incomplete routing source snapshot; cursor not advanced");
  }
  const warnings = stale ? ["Reset stale broker cursor"] : [];
  const aliases: RouteAliasBinding[] = [];
  const roots = new Set(Object.values(snapshot.agents).filter((a) => a.homeNodeId === node.id)
    .map((a) => a.metadata?.projectRoot).filter((s): s is string => typeof s === "string"));
  for (const endpoint of Object.values(snapshot.endpoints)) if (endpoint.nodeId === node.id && endpoint.projectRoot) roots.add(endpoint.projectRoot);
  // This is an explicit refresh, not a broker timer or a live-route hot path.
  for (const projectRoot of roots) {
    try {
      const response = await readJson<{ bindings: RouteAliasBinding[] }>(`/v1/aliases?${new URLSearchParams({ projectRoot, nodeId: node.id, limit: "1000" })}`);
      if (!Array.isArray(response.bindings)) throw new Error("Invalid alias response");
      aliases.push(...response.bindings);
      if (response.bindings.length >= 1000) warnings.push(`Alias coverage capped: ${projectRoot}`);
    } catch (error) { warnings.push(`Aliases unavailable for ${projectRoot}: ${String(error)}`); }
  }
  // Save the request start, not finish or max event time. Inclusive overlap plus
  // content-addressed source keys makes concurrent arrivals safe to replay.
  return { node, snapshot, aliases, full: rebuild, brokerCursor: startedAt, warnings };
}
