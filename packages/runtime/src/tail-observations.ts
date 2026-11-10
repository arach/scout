import { randomUUID } from "node:crypto";
import { redactSecretsDeep } from "@openscout/agent-sessions/secret-redaction";
import type { TailEvent } from "./tail/types.js";

/** A runtime-owned endpoint on an exact host. Never a path or a search query. */
export type TailObservationTarget = { nodeId: string; endpointId: string };
export type TailObservationBinding = TailObservationTarget & { source: string; sessionId: string; hostLabel: string };
export type TailObservationState = {
  kind: "following" | "permission" | "question" | "finished" | "unavailable";
  summary?: string;
  requestId?: string;
};
export type TailObservationUpdate = {
  observationId: string;
  target: TailObservationBinding;
  /** Whether the source endpoint is on the runtime serving this local request. */
  sourceIsLocal: boolean;
  cursor: string;
  reset: boolean;
  gap: boolean;
  events: TailEvent[];
  state: TailObservationState;
  observedAt: number;
  leaseMs: number;
};
export const TAIL_OBSERVATION_LEASE_MS = 60_000;
const EVENT_LIMIT = 120;
const MAX_OBSERVATIONS = 64;

export class TailObservationError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}
export function parseTailObservationTarget(value: unknown): TailObservationTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { nodeId, endpointId } = value as Record<string, unknown>;
  return [nodeId, endpointId].every(v => typeof v === "string" && v.trim() === v && v.length > 0 && v.length <= 512)
    ? { nodeId: nodeId as string, endpointId: endpointId as string } : null;
}

type Bucket = {
  binding: TailObservationBinding; epoch: string; sequence: number;
  events: Array<{ sequence: number; event: TailEvent }>; state: TailObservationState;
  observedAt: number; consumers: Set<string>; listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval>; stopEvents: () => void;
  pending: boolean; stopped: boolean; lastHistory: number;
};
type Lease = { owner: string; bucket: Bucket; expires: number; reading: boolean };

/** Connection-independent leases allow a mesh reconnect without retaining a fleet firehose. */
export class TailObservationService {
  private readonly buckets = new Map<string, Bucket>();
  private readonly leases = new Map<string, Lease>();
  private readonly opening = new Map<string, Promise<Bucket>>();
  private readonly expiry: ReturnType<typeof setInterval>;
  private stopped = false;
  constructor(private readonly deps: {
    bind: (target: TailObservationTarget) => TailObservationBinding;
    history: (binding: TailObservationBinding) => Promise<TailEvent[]>;
    state: (binding: TailObservationBinding) => Promise<TailObservationState>;
    subscribe: (listener: (event: TailEvent) => void) => () => void;
    now?: () => number; pollMs?: number; leaseMs?: number; waitMs?: number;
  }) {
    this.expiry = setInterval(() => this.sweep(), Math.min(5_000, this.leaseMs));
    this.expiry.unref?.();
  }
  private get now() { return (this.deps.now ?? Date.now)(); }
  private get leaseMs() { return this.deps.leaseMs ?? TAIL_OBSERVATION_LEASE_MS; }
  private key(target: TailObservationTarget) { return JSON.stringify([target.nodeId, target.endpointId]); }
  private publish(bucket: Bucket) { for (const listener of [...bucket.listeners]) listener(); }
  private append(bucket: Bucket, events: TailEvent[]) {
    const held = new Set(bucket.events.map(row => `${row.event.id}\0${row.event.ts}`));
    for (const original of events) {
      if (original.source !== bucket.binding.source || original.sessionId !== bucket.binding.sessionId
        || !["user", "assistant", "tool", "tool-result", "system"].includes(original.kind)
        || held.has(`${original.id}\0${original.ts}`)) continue;
      // No raw tool payloads, provider diagnostics, or prompt markup cross the wire.
      const event = redactSecretsDeep({ id: original.id, ts: original.ts, source: original.source,
        sessionId: original.sessionId, kind: original.kind, summary: original.summary.slice(0, 2_000),
        project: original.project.slice(0, 200), cwd: original.cwd.slice(0, 1_000),
        pid: original.pid, parentPid: original.parentPid, harness: original.harness });
      bucket.events.push({ sequence: ++bucket.sequence, event });
      held.add(`${event.id}\0${event.ts}`);
    }
    if (bucket.events.length > EVENT_LIMIT) bucket.events.splice(0, bucket.events.length - EVENT_LIMIT);
  }
  private async refresh(bucket: Bucket, initial = false) {
    if (bucket.pending || bucket.stopped) return;
    bucket.pending = true;
    const before = bucket.sequence;
    try {
      const current = this.deps.bind(bucket.binding);
      if (current.sessionId !== bucket.binding.sessionId || current.source !== bucket.binding.source)
        throw new TailObservationError("The endpoint now belongs to another session. Follow its new session explicitly.");
      const readHistory = initial || this.now - bucket.lastHistory >= 5_000;
      const [state, events] = await Promise.all([
        this.deps.state(bucket.binding), readHistory ? this.deps.history(bucket.binding) : Promise.resolve([]),
      ]);
      if (bucket.stopped) return;
      if (readHistory) bucket.lastHistory = this.now;
      this.append(bucket, events);
      const bounded = redactSecretsDeep({ ...state, ...(state.summary ? { summary: state.summary.slice(0, 4_000) } : {}) });
      if (JSON.stringify(bucket.state) !== JSON.stringify(bounded)) { bucket.state = bounded; bucket.sequence++; }
      bucket.observedAt = this.now;
    } catch (error) {
      if (bucket.stopped) return;
      const state: TailObservationState = redactSecretsDeep({ kind: "unavailable", summary: error instanceof Error ? error.message.slice(0, 1_000) : "Source observation failed" });
      if (JSON.stringify(bucket.state) !== JSON.stringify(state)) { bucket.state = state; bucket.sequence++; }
    } finally {
      bucket.pending = false;
      if (bucket.sequence !== before) this.publish(bucket);
    }
  }
  async open(target: TailObservationTarget, owner: string): Promise<TailObservationUpdate> {
    if (this.stopped) throw new TailObservationError("Tail observation service is stopped.", 503);
    this.sweep();
    if (this.leases.size >= MAX_OBSERVATIONS || this.opening.size >= MAX_OBSERVATIONS)
      throw new TailObservationError("Too many Tail observations. Unfollow a session first.", 429);
    const key = this.key(target);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      let opening = this.opening.get(key);
      if (!opening) {
        opening = (async () => {
          const binding = this.deps.bind(target);
          const next: Bucket = { binding, epoch: randomUUID(), sequence: 0, events: [],
            state: { kind: "following" }, observedAt: this.now, consumers: new Set(), listeners: new Set(),
            timer: undefined as never, stopEvents: () => {}, pending: false, stopped: false, lastHistory: 0 };
          next.stopEvents = this.deps.subscribe(event => {
            const before = next.sequence;
            if (!next.stopped) this.append(next, [event]);
            if (next.sequence !== before) this.publish(next);
          });
          await this.refresh(next, true);
          if (this.stopped) {
            next.stopped = true;
            next.stopEvents();
            throw new TailObservationError("Tail observation service is stopped.", 503);
          }
          next.timer = setInterval(() => void this.refresh(next), this.deps.pollMs ?? 2_000);
          next.timer.unref?.();
          this.buckets.set(key, next);
          return next;
        })().finally(() => this.opening.delete(key));
        this.opening.set(key, opening);
      }
      bucket = await opening;
    }
    if (this.stopped) throw new TailObservationError("Tail observation service is stopped.", 503);
    if (this.leases.size >= MAX_OBSERVATIONS) {
      if (!bucket.consumers.size) {
        bucket.stopped = true;
        clearInterval(bucket.timer);
        bucket.stopEvents();
        this.buckets.delete(key);
      }
      throw new TailObservationError("Too many Tail observations. Unfollow a session first.", 429);
    }
    const id = randomUUID();
    this.leases.set(id, { owner, bucket, expires: this.now + this.leaseMs, reading: false });
    bucket.consumers.add(id);
    return this.update(id, bucket);
  }
  private lease(id: string, owner: string): Lease {
    this.sweep();
    const lease = this.leases.get(id);
    if (!lease || lease.owner !== owner) throw new TailObservationError("Tail observation expired or is no longer available. Follow again.", 410);
    return lease;
  }
  private update(id: string, bucket: Bucket, cursor?: string): TailObservationUpdate {
    const [epoch, rawSequence] = (cursor ?? "").split(":");
    const sequence = Number(rawSequence);
    const oldest = bucket.events[0]?.sequence ?? bucket.sequence;
    const valid = epoch === bucket.epoch && Number.isSafeInteger(sequence) && sequence >= 0 && sequence <= bucket.sequence && sequence >= oldest - 1;
    return { observationId: id, target: bucket.binding, sourceIsLocal: true, cursor: `${bucket.epoch}:${bucket.sequence}`,
      reset: !valid, gap: Boolean(cursor && !valid), events: bucket.events.filter(row => !valid || row.sequence > sequence).map(row => row.event),
      state: bucket.state, observedAt: bucket.observedAt, leaseMs: this.leaseMs };
  }
  async read(id: string, owner: string, cursor?: string, signal?: AbortSignal): Promise<TailObservationUpdate> {
    const lease = this.lease(id, owner);
    if (lease.reading) throw new TailObservationError("This observation already has a pending read.");
    lease.expires = this.now + this.leaseMs;
    const bucket = lease.bucket;
    const current = this.update(id, bucket, cursor);
    if (!cursor || current.cursor !== cursor || current.reset) return current;
    lease.reading = true;
    try {
      await new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout>;
        const cleanup = () => { clearTimeout(timer); bucket.listeners.delete(finish); signal?.removeEventListener("abort", abort); };
        const finish = () => { cleanup(); resolve(); };
        const abort = () => { cleanup(); reject(new TailObservationError("Observation read cancelled", 499)); };
        bucket.listeners.add(finish);
        timer = setTimeout(finish, this.deps.waitMs ?? 12_000);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
      this.lease(id, owner);
      return this.update(id, bucket, cursor);
    } finally { lease.reading = false; }
  }
  close(id: string, owner: string) {
    const lease = this.leases.get(id);
    if (!lease || lease.owner !== owner) return;
    this.leases.delete(id); lease.bucket.consumers.delete(id); this.publish(lease.bucket);
    if (!lease.bucket.consumers.size) {
      lease.bucket.stopped = true;
      clearInterval(lease.bucket.timer); lease.bucket.stopEvents();
      this.buckets.delete(this.key(lease.bucket.binding));
      lease.bucket.events = [];
    }
  }
  sweep() { for (const [id, lease] of this.leases) if (lease.expires <= this.now) this.close(id, lease.owner); }
  list() { this.sweep(); return [...this.buckets.values()].map(bucket => ({ target: bucket.binding, consumers: bucket.consumers.size })); }
  stop() { this.stopped = true; clearInterval(this.expiry); for (const [id, lease] of this.leases) this.close(id, lease.owner); }
}
