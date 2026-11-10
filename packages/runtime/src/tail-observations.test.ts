import { afterEach, expect, test } from "bun:test";
import { registerSecretValue, resetSecretRegistryForTests } from "@openscout/agent-sessions/secret-redaction";
import type { AgentEndpoint } from "@openscout/protocol";
import { bindTailObservation } from "./tail-observation-binding.js";
import { TailObservationService, parseTailObservationTarget, type TailObservationState } from "./tail-observations.js";
import type { TailEvent } from "./tail/types.js";

const target = { nodeId: "source", endpointId: "endpoint" };
const binding = { ...target, source: "claude", sessionId: "native", hostLabel: "Build host" };
const event = (id: string, patch: Partial<TailEvent> = {}): TailEvent => ({ id, ts: Number(id) || 1, source: "claude", sessionId: "native",
  kind: "assistant", summary: "Working", pid: 1, parentPid: null, project: "project", cwd: "/project", harness: "scout-managed", ...patch });
const services: TailObservationService[] = [];
afterEach(() => { for (const service of services.splice(0)) service.stop(); resetSecretRegistryForTests(); });
function fixture() {
  let now = 100; let stopped = 0; let subscriptions = 0;
  let listener: (event: TailEvent) => void = () => {};
  let state: TailObservationState = { kind: "following" };
  let current = binding;
  const service = new TailObservationService({ bind: () => current, history: async () => [event("1")],
    state: async () => state, subscribe: fn => { subscriptions++; listener = fn; return () => { stopped++; }; },
    now: () => now, leaseMs: 50, waitMs: 30, pollMs: 5 });
  services.push(service);
  return { service, emit: (event: TailEvent) => listener(event), state: (value: TailObservationState) => { state = value; },
    rebind: () => { current = { ...binding, sessionId: "other" }; }, advance: () => { now += 60; },
    stopped: () => stopped, subscriptions: () => subscriptions };
}
const pause = () => new Promise(resolve => setTimeout(resolve, 12));

test("stopping while the first snapshot is pending releases its source watcher", async () => {
  let finish!: (events: TailEvent[]) => void;
  let stopped = 0;
  const service = new TailObservationService({ bind: () => binding,
    history: () => new Promise(resolve => { finish = resolve; }), state: async () => ({ kind: "following" }),
    subscribe: () => () => { stopped++; } });
  const opening = service.open(target, "local");
  service.stop();
  finish([]);
  await expect(opening).rejects.toMatchObject({ status: 503 });
  expect(stopped).toBe(1);
  expect(service.list()).toEqual([]);
});

test("concurrent subscribers cannot exceed the lease limit", async () => {
  const f = fixture();
  const results = await Promise.allSettled(Array.from({ length: 65 }, () => f.service.open(target, "local")));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(64);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  expect(f.subscriptions()).toBe(1);
});

test("exact endpoint identity never substitutes a tmux session name or a conflicting alias", () => {
  expect(parseTailObservationTarget({ ...target, nodeId: "" })).toBeNull();
  const endpoint = { id: "endpoint", nodeId: "source", harness: "claude", transport: "tmux", sessionId: "runtime-session",
    metadata: { observedSessionId: "native", observedSessionEvidence: { source: "claude-session-record" }, externalSessionId: "native" } } as AgentEndpoint;
  expect(bindTailObservation(target, endpoint, "source", "Host").sessionId).toBe("native");
  expect(() => bindTailObservation(target, { ...endpoint, metadata: {} }, "source", "Host")).toThrow("verified native");
  expect(() => bindTailObservation(target, { ...endpoint, metadata: { ...endpoint.metadata, threadId: "other" } }, "source", "Host")).toThrow();
  expect(() => bindTailObservation(target, endpoint, "another", "Host")).toThrow();
});

test("two consumers share the source; last unsubscribe releases watcher and buffer", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.service.open(target, "peer:a"), f.service.open(target, "peer:b")]);
  expect(f.subscriptions()).toBe(1);
  expect(f.service.list()[0]?.consumers).toBe(2);
  expect(a.events.map(e => e.id)).toEqual(["1"]);
  f.service.close(a.observationId, "peer:b");
  expect(f.service.list()[0]?.consumers).toBe(2);
  f.service.close(a.observationId, "peer:a"); expect(f.stopped()).toBe(0);
  f.service.close(b.observationId, "peer:b"); expect(f.stopped()).toBe(1);
  expect(f.service.list()).toEqual([]);
});

test("filtering happens before delivery and raw payloads never cross the observation", async () => {
  const f = fixture(); const opened = await f.service.open(target, "local");
  registerSecretValue("registered-private-token");
  f.emit(event("2", { sessionId: "unrelated", summary: "must not arrive" }));
  f.emit(event("3", { source: "codex" }));
  f.emit(event("4", { kind: "other", summary: "provider diagnostics" }));
  f.emit(event("5", { summary: "using registered-private-token", raw: { secret: "full tool payload" } }));
  const update = await f.service.read(opened.observationId, "local", opened.cursor);
  expect(update.events.map(e => e.id)).toEqual(["5"]);
  expect(JSON.stringify(update)).not.toContain("registered-private-token");
  expect(update.events[0]?.raw).toBeUndefined();
});

test("a native permission wait wakes a quiet observation without a transcript event", async () => {
  const f = fixture(); const opened = await f.service.open(target, "local");
  f.state({ kind: "permission", summary: "Allow the build?" });
  const update = await f.service.read(opened.observationId, "local", opened.cursor);
  expect(update.state).toEqual({ kind: "permission", summary: "Allow the build?" });
  expect(update.events).toEqual([]);
  f.state({ kind: "following" }); await pause();
  expect((await f.service.read(opened.observationId, "local", update.cursor)).state.kind).toBe("following");
});

test("leases expire, ownership is enforced, and an abandoned pending read is released", async () => {
  const f = fixture(); const opened = await f.service.open(target, "peer:a");
  await expect(f.service.read(opened.observationId, "peer:b")).rejects.toMatchObject({ status: 410 });
  const controller = new AbortController();
  const read = f.service.read(opened.observationId, "peer:a", opened.cursor, controller.signal);
  controller.abort(); await expect(read).rejects.toMatchObject({ status: 499 });
  f.advance(); f.service.sweep(); expect(f.stopped()).toBe(1);
  await expect(f.service.read(opened.observationId, "peer:a")).rejects.toMatchObject({ status: 410 });
});

test("reconnect reports a gap when its cursor is no longer retained", async () => {
  const f = fixture(); const opened = await f.service.open(target, "local");
  for (let i = 2; i < 150; i++) f.emit(event(String(i)));
  const update = await f.service.read(opened.observationId, "local", opened.cursor);
  expect(update.reset).toBe(true); expect(update.gap).toBe(true); expect(update.events).toHaveLength(120);
});

test("an endpoint moving to another native session cannot silently retarget a subscription", async () => {
  const f = fixture(); const opened = await f.service.open(target, "local");
  f.rebind(); await pause();
  const update = await f.service.read(opened.observationId, "local", opened.cursor);
  expect(update.state.kind).toBe("unavailable");
  expect(update.target.sessionId).toBe("native");
});
