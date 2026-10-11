import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  extractPendingApprovalRequests,
  type NormalizedApprovalRequest,
} from "@openscout/agent-sessions/protocol/approval-normalization";
import { redactSecretsDeep } from "@openscout/agent-sessions/secret-redaction";
import type { SessionState } from "@openscout/agent-sessions";

import { json, readRequestBody } from "./broker-http-helpers.js";
import { writeSseFrame } from "./broker-control-stream-service.js";
import type { MeshPeerFetch } from "./mesh-peer-client.js";
import type { RuntimeHttpRequestLike, RuntimeHttpResponseLike } from "./portable-types.js";

/**
 * Cross-machine approvals: a session waiting on the operator's Allow/Deny on
 * one Mac shows up on another Mac the operator chose to watch from.
 *
 * Sharing side (B): opt-in per peer key. `GET /v1/mesh/approvals/stream`
 * sends the full pending set on connect and on every change;
 * `POST /v1/mesh/approvals/decide` applies one answer through the local
 * pairing bridge after checking it still matches what is pending.
 *
 * Watching side (A): one SSE subscription per trusted peer while `watch` is on.
 * What arrives is an observation of B, kept in memory keyed by origin node —
 * never republished into A's own stream, never forwarded onward.
 */

export const MESH_APPROVALS_MAX_ITEMS = 50;
const TEXT_LIMIT = 2_000;
const POLL_MS = 1_000;
const HEARTBEAT_MS = 15_000;
const RECENT_DECISION_TTL_MS = 10 * 60_000;

/* ── Config ── */

export type MeshApprovalsConfig = {
  /** Peer key ids allowed to see and answer this machine's approvals. */
  share: string[];
  /** Subscribe to peers that share with this machine. */
  watch: boolean;
};

export function meshApprovalsConfigPath(supportDirectory: string): string {
  return join(supportDirectory, "mesh-approvals.json");
}

export function readMeshApprovalsConfig(path: string): MeshApprovalsConfig {
  try {
    if (!existsSync(path)) return { share: [], watch: false };
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<MeshApprovalsConfig>;
    return {
      share: Array.isArray(raw.share) ? raw.share.filter((key): key is string => typeof key === "string" && key.length > 0) : [],
      watch: raw.watch === true,
    };
  } catch {
    return { share: [], watch: false };
  }
}

export function writeMeshApprovalsConfig(path: string, config: MeshApprovalsConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ share: [...new Set(config.share)], watch: config.watch }, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

/* ── Wire shapes ── */

export type MeshSharedApproval = Pick<NormalizedApprovalRequest,
  "sessionId" | "sessionName" | "adapterType" | "turnId" | "turnStartedAt" | "blockId" | "version"
  | "risk" | "title" | "description" | "detail" | "actionKind">;

export type MeshApprovalsSnapshot = {
  nodeId: string;
  generatedAt: number;
  approvals: MeshSharedApproval[];
  truncated: boolean;
};

export type MeshApprovalDecision = {
  sessionId: string;
  turnId: string;
  blockId: string;
  version: number;
  decision: "approve" | "deny";
  reason?: string;
};

function clip(text: string | null): string | null {
  if (text === null) return null;
  return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}…` : text;
}

export function shareableApprovals(snapshots: SessionState[]): { approvals: MeshSharedApproval[]; truncated: boolean } {
  const all = snapshots.flatMap((snapshot) => extractPendingApprovalRequests(snapshot));
  const approvals = all.slice(0, MESH_APPROVALS_MAX_ITEMS).map((approval): MeshSharedApproval => redactSecretsDeep({
    sessionId: approval.sessionId,
    sessionName: approval.sessionName,
    adapterType: approval.adapterType,
    turnId: approval.turnId,
    ...(approval.turnStartedAt !== undefined ? { turnStartedAt: approval.turnStartedAt } : {}),
    blockId: approval.blockId,
    version: approval.version,
    risk: approval.risk,
    title: clip(approval.title) ?? "",
    description: clip(approval.description) ?? "",
    detail: clip(approval.detail),
    actionKind: approval.actionKind,
  }));
  return { approvals, truncated: all.length > approvals.length };
}

function approvalKey(input: { sessionId: string; turnId: string; blockId: string }): string {
  return `${input.sessionId}\u0000${input.turnId}\u0000${input.blockId}`;
}

export function parseMeshApprovalDecision(body: unknown): MeshApprovalDecision | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const text = (key: string) => typeof value[key] === "string" && (value[key] as string).length > 0 ? value[key] as string : null;
  const sessionId = text("sessionId");
  const turnId = text("turnId");
  const blockId = text("blockId");
  const version = value.version;
  const decision = value.decision;
  if (!sessionId || !turnId || !blockId) return null;
  if (typeof version !== "number" || !Number.isInteger(version)) return null;
  if (decision !== "approve" && decision !== "deny") return null;
  const reason = typeof value.reason === "string" && value.reason.trim() ? value.reason.trim().slice(0, TEXT_LIMIT) : undefined;
  return { sessionId, turnId, blockId, version, decision, ...(reason ? { reason } : {}) };
}

/* ── Sharing side (B) ── */

export type MeshApprovalShareDeps = {
  nodeId: string;
  listSnapshots: () => Promise<SessionState[]>;
  decide: (input: MeshApprovalDecision) => Promise<void>;
  /** Re-read on every request so `scout mesh approvals share` applies without a restart. */
  readConfig: () => MeshApprovalsConfig;
  auditPath?: string;
  now?: () => number;
  pollMs?: number;
  heartbeatMs?: number;
};

export type MeshApprovalDecideResult =
  | { status: 200; body: { ok: true; repeated?: boolean } }
  | { status: 403; body: { error: "approvals_not_shared" } }
  | { status: 409; body: { error: "stale_version" | "not_pending" | "already_decided"; currentVersion?: number } }
  | { status: 502; body: { error: "decide_failed" } };

export type MeshApprovalShare = {
  isShared: (keyId: string | undefined) => boolean;
  current: () => Promise<MeshApprovalsSnapshot>;
  subscribe: (listener: (snapshot: MeshApprovalsSnapshot) => void) => () => void;
  /** `stillAllowed` is re-run right before the answer is applied, after any queue wait. */
  decide: (input: MeshApprovalDecision, actor: string, stillAllowed?: () => boolean) => Promise<MeshApprovalDecideResult>;
  stop: () => void;
};

export function createMeshApprovalShare(deps: MeshApprovalShareDeps): MeshApprovalShare {
  const now = deps.now ?? Date.now;
  const listeners = new Set<(snapshot: MeshApprovalsSnapshot) => void>();
  const recent = new Map<string, { version: number; decision: "approve" | "deny"; at: number }>();
  let last: MeshApprovalsSnapshot | null = null;
  let lastKey = "";
  let timer: ReturnType<typeof setInterval> | null = null;
  let polling = false;
  let queue: Promise<unknown> = Promise.resolve();

  async function read(): Promise<MeshApprovalsSnapshot> {
    const { approvals, truncated } = shareableApprovals(await deps.listSnapshots());
    return { nodeId: deps.nodeId, generatedAt: now(), approvals, truncated };
  }

  async function poll(): Promise<void> {
    if (polling) return;
    polling = true;
    try {
      const next = await read();
      const key = JSON.stringify([next.approvals, next.truncated]);
      if (key !== lastKey) {
        last = next;
        lastKey = key;
        for (const listener of listeners) listener(next);
      }
    } catch {
      // Bridge down — keep the last answer; the next tick tries again.
    } finally {
      polling = false;
    }
  }

  function audit(line: Record<string, unknown>): void {
    if (!deps.auditPath) return;
    try {
      mkdirSync(dirname(deps.auditPath), { recursive: true });
      appendFileSync(deps.auditPath, `${JSON.stringify({ at: new Date(now()).toISOString(), ...line })}\n`);
    } catch {
      // Audit is best-effort; never block the answer on it.
    }
  }

  async function decideNow(input: MeshApprovalDecision, actor: string, stillAllowed: () => boolean): Promise<MeshApprovalDecideResult> {
    if (!stillAllowed()) return { status: 403, body: { error: "approvals_not_shared" } };
    const key = approvalKey(input);
    for (const [entry, value] of recent) if (now() - value.at > RECENT_DECISION_TTL_MS) recent.delete(entry);
    const previous = recent.get(key);
    if (previous && previous.version === input.version) {
      return previous.decision === input.decision
        ? { status: 200, body: { ok: true, repeated: true } }
        : { status: 409, body: { error: "already_decided" } };
    }
    const { approvals } = shareableApprovals(await deps.listSnapshots());
    const pending = approvals.find((approval) => approvalKey(approval) === key);
    if (!pending) return { status: 409, body: { error: "not_pending" } };
    if (pending.version !== input.version) return { status: 409, body: { error: "stale_version", currentVersion: pending.version } };
    if (!stillAllowed()) return { status: 403, body: { error: "approvals_not_shared" } };
    try {
      await deps.decide(input);
    } catch {
      audit({ actor, ...input, outcome: "failed" });
      return { status: 502, body: { error: "decide_failed" } };
    }
    recent.set(key, { version: input.version, decision: input.decision, at: now() });
    audit({ actor, ...input, outcome: "applied" });
    void poll();
    return { status: 200, body: { ok: true } };
  }

  return {
    isShared: (keyId) => Boolean(keyId) && deps.readConfig().share.includes(keyId!),
    current: async () => last ?? read(),
    subscribe(listener) {
      listeners.add(listener);
      timer ??= setInterval(() => void poll(), deps.pollMs ?? POLL_MS);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    decide(input, actor, stillAllowed = () => true) {
      // One answer at a time so two clicks can't both pass the pending check.
      const result = queue.then(() => decideNow(input, actor, stillAllowed));
      queue = result.catch(() => undefined);
      return result;
    },
    stop() {
      listeners.clear();
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

/* ── Watching side (A) ── */

export type MeshApprovalPeer = { keyId: string; nodeId: string; label: string; brokerUrl?: string };

export type MeshRemoteApprovalsState = "connecting" | "live" | "stale" | "not_shared" | "unreachable";

export type MeshRemoteApprovals = {
  nodeId: string;
  label: string;
  state: MeshRemoteApprovalsState;
  approvals: MeshSharedApproval[];
  truncated: boolean;
  updatedAt: number | null;
};

export type MeshApprovalWatchDeps = {
  listPeers: () => MeshApprovalPeer[];
  peerFetch: MeshPeerFetch;
  readConfig: () => MeshApprovalsConfig;
  now?: () => number;
  /** How often the peer list and watch flag are re-read. */
  reconcileMs?: number;
  log?: (message: string) => void;
};

export type MeshApprovalWatch = {
  list: () => MeshRemoteApprovals[];
  decide: (nodeId: string, input: MeshApprovalDecision) => Promise<{ status: number; body: unknown }>;
  reconcile: () => void;
  stop: () => void;
};

type WatchLink = {
  peer: MeshApprovalPeer;
  entry: MeshRemoteApprovals;
  controller: AbortController;
  attempt: number;
  retry: ReturnType<typeof setTimeout> | null;
};

export function createMeshApprovalWatch(deps: MeshApprovalWatchDeps): MeshApprovalWatch {
  const now = deps.now ?? Date.now;
  const links = new Map<string, WatchLink>();
  let stopped = false;

  function backoff(link: WatchLink, slow: boolean): number {
    if (slow) return 5 * 60_000;
    return Math.min(60_000, 1_000 * 2 ** Math.min(link.attempt, 6));
  }

  function schedule(link: WatchLink, slow: boolean): void {
    if (stopped || links.get(link.peer.nodeId) !== link) return;
    link.attempt += 1;
    link.retry = setTimeout(() => {
      link.retry = null;
      void connect(link);
    }, backoff(link, slow));
  }

  async function connect(link: WatchLink): Promise<void> {
    if (stopped || links.get(link.peer.nodeId) !== link || !link.peer.brokerUrl) return;
    link.controller = new AbortController();
    let notShared = false;
    try {
      const response = await deps.peerFetch(link.peer.brokerUrl, "/v1/mesh/approvals/stream", {
        headers: { accept: "text/event-stream" },
        signal: link.controller.signal,
      });
      if (response.status === 403 || response.status === 404) {
        notShared = true;
        link.entry = { ...link.entry, state: "not_shared", approvals: [], truncated: false };
        return;
      }
      if (!response.ok || !response.body) {
        link.entry = { ...link.entry, state: link.entry.updatedAt ? "stale" : "unreachable" };
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index = buffer.indexOf("\n\n");
        while (index !== -1) {
          const frame = parseSseFrame(buffer.slice(0, index));
          buffer = buffer.slice(index + 2);
          if (frame?.event === "snapshot") {
            try {
              const snapshot = JSON.parse(frame.data) as MeshApprovalsSnapshot;
              if (Array.isArray(snapshot.approvals)) {
                link.attempt = 0;
                link.entry = {
                  ...link.entry,
                  state: "live",
                  approvals: snapshot.approvals.slice(0, MESH_APPROVALS_MAX_ITEMS),
                  truncated: Boolean(snapshot.truncated),
                  updatedAt: now(),
                };
              }
            } catch {
              // Malformed frame — keep streaming.
            }
          }
          index = buffer.indexOf("\n\n");
        }
      }
      link.entry = { ...link.entry, state: "stale" };
    } catch {
      link.entry = { ...link.entry, state: link.entry.updatedAt ? "stale" : "unreachable" };
    } finally {
      if (!link.controller.signal.aborted) schedule(link, notShared);
    }
  }

  function drop(nodeId: string): void {
    const link = links.get(nodeId);
    if (!link) return;
    links.delete(nodeId);
    link.controller.abort();
    if (link.retry) clearTimeout(link.retry);
  }

  function reconcile(): void {
    if (stopped) return;
    const watching = deps.readConfig().watch;
    const peers = watching ? deps.listPeers().filter((peer) => peer.brokerUrl) : [];
    const wanted = new Map(peers.map((peer) => [peer.nodeId, peer]));
    for (const nodeId of [...links.keys()]) {
      const peer = wanted.get(nodeId);
      if (!peer || peer.brokerUrl !== links.get(nodeId)!.peer.brokerUrl || peer.keyId !== links.get(nodeId)!.peer.keyId) drop(nodeId);
    }
    for (const peer of peers) {
      if (links.has(peer.nodeId)) continue;
      const link: WatchLink = {
        peer,
        entry: { nodeId: peer.nodeId, label: peer.label, state: "connecting", approvals: [], truncated: false, updatedAt: null },
        controller: new AbortController(),
        attempt: 0,
        retry: null,
      };
      links.set(peer.nodeId, link);
      void connect(link);
    }
  }

  const reconcileTimer = setInterval(reconcile, deps.reconcileMs ?? 30_000);
  reconcile();

  return {
    list: () => [...links.values()].map((link) => link.entry),
    async decide(nodeId, input) {
      const link = links.get(nodeId);
      if (!link?.peer.brokerUrl) return { status: 404, body: { error: "not_watched" } };
      if (link.entry.state !== "live") return { status: 409, body: { error: "not_live", state: link.entry.state } };
      try {
        const response = await deps.peerFetch(link.peer.brokerUrl, "/v1/mesh/approvals/decide", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(20_000),
        });
        const body = await response.json().catch(() => ({ error: "invalid_response" }));
        return { status: response.status, body };
      } catch {
        return { status: 502, body: { error: "unreachable" } };
      }
    },
    reconcile,
    stop() {
      stopped = true;
      clearInterval(reconcileTimer);
      for (const nodeId of [...links.keys()]) drop(nodeId);
    },
  };
}

function parseSseFrame(frame: string): { event: string; data: string } | undefined {
  let event = "message";
  const dataLines: string[] = [];
  for (const rawLine of frame.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).replace(/^\s/, ""));
  }
  if (dataLines.length === 0) return undefined;
  return { event, data: dataLines.join("\n") };
}

/* ── HTTP ── */

export type MeshApprovalsHttpDeps = {
  share?: MeshApprovalShare;
  watch?: MeshApprovalWatch;
  heartbeatMs?: number;
};

function isLocal(request: RuntimeHttpRequestLike): boolean {
  const context = request.transportContext;
  return Boolean(context) && context!.transport !== "remote" && !context!.guest && !context!.scoped;
}

/** Returns true when the route was handled. */
export async function handleBrokerMeshApprovalsRoute(
  request: RuntimeHttpRequestLike,
  response: RuntimeHttpResponseLike,
  url: { pathname: string },
  method: string,
  deps: MeshApprovalsHttpDeps,
): Promise<boolean> {
  if (url.pathname === "/v1/mesh/approvals/stream" || url.pathname === "/v1/mesh/approvals/decide") {
    // Only a verified peer this machine opted to share with — the grant tier
    // alone is not enough. Local callers are this machine's own operator.
    const peer = request.transportContext?.peer;
    const share = deps.share;
    const stillAllowed = () => Boolean(share) && (isLocal(request)
      || (request.transportContext?.transport === "remote" && share!.isShared(peer?.keyId)));
    if (!share || !stillAllowed()) {
      json(response, 403, { error: "approvals_not_shared" });
      return true;
    }
    if (method === "GET" && url.pathname === "/v1/mesh/approvals/stream") {
      const heartbeatMs = deps.heartbeatMs ?? HEARTBEAT_MS;
      let closed = false;
      let unsubscribe = () => {};
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      // Cleanup is bound before any await so a disconnect mid-snapshot is not missed.
      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
        if (!response.writableEnded) response.end();
      };
      request.on("close", close);
      response.on("close", close);
      response.on("error", close);
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });
      // Sharing can be withdrawn at any time; check before every frame.
      const send = (snapshot: MeshApprovalsSnapshot) => {
        if (closed) return;
        if (!stillAllowed()) {
          close();
          return;
        }
        writeSseFrame(response, "snapshot", snapshot);
      };
      let first: MeshApprovalsSnapshot;
      try {
        first = await share.current();
      } catch {
        first = { nodeId: "", generatedAt: Date.now(), approvals: [], truncated: false };
      }
      if (closed) return true;
      send(first);
      if (closed) return true;
      unsubscribe = share.subscribe(send);
      heartbeat = setInterval(() => {
        if (!stillAllowed()) close();
        else response.write(": keepalive\n\n");
      }, heartbeatMs);
      return true;
    }
    if (method === "POST" && url.pathname === "/v1/mesh/approvals/decide") {
      const input = parseMeshApprovalDecision(await readRequestBody(request).catch(() => null));
      if (!input) {
        json(response, 400, { error: "invalid_decision" });
        return true;
      }
      const result = await share.decide(input, peer?.keyId ? `peer:${peer.keyId}` : "local", stillAllowed);
      json(response, result.status, result.body);
      return true;
    }
    json(response, 405, { error: "method_not_allowed" });
    return true;
  }

  if (url.pathname === "/v1/approvals/remote" || url.pathname === "/v1/approvals/remote/decide") {
    if (!isLocal(request)) {
      json(response, 403, { error: "local_only" });
      return true;
    }
    if (method === "GET" && url.pathname === "/v1/approvals/remote") {
      json(response, 200, { nodes: deps.watch?.list() ?? [] });
      return true;
    }
    if (method === "POST" && url.pathname === "/v1/approvals/remote/decide") {
      const body = await readRequestBody(request).catch(() => null) as Record<string, unknown> | null;
      const nodeId = typeof body?.nodeId === "string" ? body.nodeId : "";
      const input = parseMeshApprovalDecision(body);
      if (!nodeId || !input) {
        json(response, 400, { error: "invalid_decision" });
        return true;
      }
      if (!deps.watch) {
        json(response, 404, { error: "not_watching" });
        return true;
      }
      const result = await deps.watch.decide(nodeId, input);
      json(response, result.status, result.body);
      return true;
    }
    json(response, 405, { error: "method_not_allowed" });
    return true;
  }

  return false;
}
