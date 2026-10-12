export type RouteKind = "project" | "agent" | "session";
export type RouteSignal = "S0" | "S1" | "S2";
export type RouteTarget = {
  id: string;
  kind: RouteKind;
  nodeId: string;
  projectRoot: string;
  projectKey: string | null;
  agentId: string | null;
  harness: string | null;
  sessionId: string | null;
  names: string[];
};
export type RouteMachine = { id: string; names: string[] };
export type RouteTerm = { term: string; field: "stable" | "recent"; weight: number; lastUsedAt: number };
export type RouteEvidence = { key: string; targetId: string; hash: string; terms: RouteTerm[] };
export type RouteCandidate = {
  target: RouteTarget;
  score: number;
  signals: Partial<Record<RouteSignal, { score: number; rank: number; contribution: number; terms: string[] }>>;
};
export type RouteCoverage = {
  localOnly: true;
  machines: RouteMachine[];
  selectedMachineIds: string[];
  peerDigests: never[];
  indexedAt: number | null;
  ageMs: number | null;
  targets: number;
  scopedTargets: number;
  signals: RouteSignal[];
  chunksIndexedAt: number | null;
  warnings: string[];
};
export type RouteResult = {
  outcome: "resolved" | "candidates" | "none";
  query: string;
  topic: string;
  reason: string;
  candidates: RouteCandidate[];
  coverage: RouteCoverage;
};
export type RouteOptions = {
  /** Fresh caller inventory for machine parsing; never changes indexed identity. */
  machines?: RouteMachine[];
  machine?: string;
  /** Exact scope supplied by current discovery, before ranking/capping. */
  nodeIds?: string[];
  projectRoot?: string;
  agentId?: string;
  kind?: RouteKind;
  signals?: RouteSignal[];
  now?: number;
};
export type RouteChunkMapping = { collectionId: string; projectId: string; sessionId: string | null; agentId: string | null };
export type RouteGold = { id: string; query: string; projectRoot: string; source: "A" | "B"; messageId?: string };
