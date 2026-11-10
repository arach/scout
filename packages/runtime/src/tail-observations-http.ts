import { randomUUID } from "node:crypto";
import { json, readRequestBody } from "./broker-http-helpers.js";
import type { RuntimeHttpRequestLike, RuntimeHttpResponseLike } from "./portable-types.js";
import type { MeshPeerFetch } from "./mesh-peer-client.js";
import { TailObservationError, TailObservationService, parseTailObservationTarget,
  TAIL_OBSERVATION_LEASE_MS, type TailObservationTarget, type TailObservationUpdate } from "./tail-observations.js";

const LOCAL = "/v1/tail/observations/";
const REMOTE = "/v1/mesh/tail/observations/";
export function handleTailObservationRoute(request: RuntimeHttpRequestLike, response: RuntimeHttpResponseLike, url: URL, method: string, router: TailObservationRouter) {
  return router.handle(request, response, url, method);
}
type Forward = { remoteId: string; target: TailObservationTarget; expires: number };

/** One hop only. Source leases belong to the signed peer, never to body identity. */
export class TailObservationRouter {
  private readonly forwards = new Map<string, Forward>();
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly deps: {
    nodeId: string; source: TailObservationService;
    peer: (nodeId: string) => { brokerUrl: string } | null;
    peerFetch: MeshPeerFetch;
  }) {
    this.timer = setInterval(() => {
      for (const [id, entry] of this.forwards) if (entry.expires <= Date.now()) {
        this.forwards.delete(id); void this.remote(entry, "unsubscribe", {}).catch(() => {});
      }
    }, 5_000);
    this.timer.unref?.();
  }
  private async remote(entry: Forward, operation: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<TailObservationUpdate> {
    const peer = this.deps.peer(entry.target.nodeId);
    if (!peer) throw new TailObservationError("The source host is not reachable or no longer trusted for observation.", 503);
    const response = await this.deps.peerFetch(peer.brokerUrl, REMOTE + operation, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, observationId: entry.remoteId }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    });
    const value = await response.json() as TailObservationUpdate & { error?: string };
    if (!response.ok) throw new TailObservationError(response.status === 404
      ? "This host does not support scoped Tail observations. Update its runtime."
      : value.error ?? "The source host refused the observation.", response.status);
    if (operation !== "unsubscribe" && (value.target?.nodeId !== entry.target.nodeId || value.target.endpointId !== entry.target.endpointId))
      throw new TailObservationError("The source host returned a different observation identity.", 502);
    return value;
  }
  async handle(request: RuntimeHttpRequestLike, response: RuntimeHttpResponseLike, url: URL, method: string): Promise<boolean> {
    const mesh = url.pathname.startsWith(REMOTE);
    if (!mesh && !url.pathname.startsWith(LOCAL)) return false;
    const context = request.transportContext;
    const local = Boolean(context && context.transport !== "remote" && !context.guest && !context.scoped);
    const peer = context?.transport === "remote" && !context.guest && !context.scoped && context.peer?.tier === "control" ? context.peer : null;
    if ((!mesh && !local) || (mesh && !peer)) { json(response, 403, { error: "Observation requires the local operator or an authenticated control peer." }); return true; }
    const owner = peer ? `peer:${peer.keyId}` : "local";
    const operation = url.pathname.slice((mesh ? REMOTE : LOCAL).length);
    if (method === "GET" && url.pathname === "/v1/tail/observations/active") {
      json(response, 200, { local: this.deps.source.list(), remote: [...this.forwards.values()].map(row => ({ target: row.target })) }); return true;
    }
    const supported = method === "POST" && (url.pathname === "/v1/tail/observations/subscribe" || url.pathname === "/v1/tail/observations/read" || url.pathname === "/v1/tail/observations/unsubscribe"
      || url.pathname === "/v1/mesh/tail/observations/subscribe" || url.pathname === "/v1/mesh/tail/observations/read" || url.pathname === "/v1/mesh/tail/observations/unsubscribe");
    if (!supported) {
      json(response, 405, { error: "Unsupported observation operation" }); return true;
    }
    const abort = new AbortController();
    response.on("close", () => { if (!response.writableEnded) abort.abort(); });
    try {
      const body = await readRequestBody<Record<string, unknown>>(request, { maxBytes: 4_096 });
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new TailObservationError("Invalid observation request", 400);
      let value: unknown;
      if (operation === "subscribe") {
        const target = parseTailObservationTarget(body.target);
        if (!target) throw new TailObservationError("An exact host and endpoint are required", 400);
        if (target.nodeId === this.deps.nodeId) value = await this.deps.source.open(target, owner);
        else {
          if (mesh) throw new TailObservationError("Observations cannot be forwarded to a third host", 403);
          if (this.forwards.size >= 64) throw new TailObservationError("Too many remote observations", 429);
          const entry: Forward = { target, remoteId: "", expires: Date.now() + TAIL_OBSERVATION_LEASE_MS };
          const update = await this.remote(entry, "subscribe", { target }, abort.signal);
          entry.remoteId = update.observationId;
          const id = randomUUID();
          this.forwards.set(id, entry);
          value = { ...update, observationId: id, sourceIsLocal: false };
        }
      } else {
        const id = typeof body.observationId === "string" ? body.observationId : "";
        if (!id || id.length > 100) throw new TailObservationError("An observation ID is required", 400);
        const entry = !mesh ? this.forwards.get(id) : undefined;
        if (entry) {
          if (operation === "unsubscribe") this.forwards.delete(id);
          else if (entry.expires <= Date.now()) { this.forwards.delete(id); throw new TailObservationError("Observation expired. Follow again.", 410); }
          entry.expires = Date.now() + TAIL_OBSERVATION_LEASE_MS;
          const update = await this.remote(entry, operation, { cursor: typeof body.cursor === "string" ? body.cursor : undefined }, abort.signal);
          value = operation === "unsubscribe" ? { ok: true } : { ...update, observationId: id, sourceIsLocal: false };
        } else if (operation === "unsubscribe") { this.deps.source.close(id, owner); value = { ok: true }; }
        else value = await this.deps.source.read(id, owner, typeof body.cursor === "string" ? body.cursor : undefined, abort.signal);
      }
      if (!abort.signal.aborted) json(response, 200, value);
    } catch (error) {
      if (!abort.signal.aborted) json(response, error instanceof TailObservationError ? error.status : 503,
        { error: error instanceof Error ? error.message : "Source observation unavailable" });
    }
    return true;
  }
  stop() {
    clearInterval(this.timer);
    for (const entry of this.forwards.values()) void this.remote(entry, "unsubscribe", {}).catch(() => {});
    this.forwards.clear(); this.deps.source.stop();
  }
}
