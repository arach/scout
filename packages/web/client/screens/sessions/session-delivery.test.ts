import { beforeEach, expect, mock, test } from "bun:test";
import type { Agent } from "../../lib/types.ts";
const calls: { path: string; body: Record<string, unknown> }[] = [];
let fail = false;
mock.module("../../lib/api.ts", () => ({ api: async (path: string, init: RequestInit) => {
  calls.push({ path, body: JSON.parse(String(init.body)) });
  if (fail) throw new Error("Unavailable"); return { ok: true, audit: { id: "audit-1" } };
} }));
const { sendSessionDraft, sessionDeliveryAvailability, sessionInterruptAgent, sessionTargetFromObserve } = await import("./session-delivery.ts");
beforeEach(() => { calls.length = 0; fail = false; });
const target = { sessionId: "exact-old-session", sessionRef: "session:codex:exact-old-session", machineId: "here", agentId: "worker" };
const ready = { available: true, reason: "Ready", code: "ready", target: null };

test("steering stays disabled until the server verifies a live process", () => {
  expect(sessionDeliveryAvailability(target).available).toBe(false);
  expect(sessionDeliveryAvailability(target, ready).available).toBe(true);
  expect(sessionDeliveryAvailability(target, { ...ready, available: false, reason: "Ambiguous process" })).toMatchObject({ available: false, reason: "Ambiguous process" });
});
test("Steer posts verbatim text to the exact session and machine, never a broker ask", async () => {
  await sendSessionDraft(target, "  steer\nthis  ");
  expect(calls).toEqual([{ path: "/api/session-ref/session%3Acodex%3Aexact-old-session/steer?machine=here", body: { text: "  steer\nthis  " } }]);
});
test("failures never try start, resume, /send or /sessions/reply", async () => {
  fail = true; await expect(sendSessionDraft(target, "kept")).rejects.toThrow("Unavailable");
  expect(calls).toHaveLength(1);
});
test("unresolved and machine-unverified targets cannot send even with a stale ready response", async () => {
  for (const candidate of [{ ...target, sessionId: "" }, { ...target, sessionRef: null }, { ...target, machineId: null }]) {
    expect(sessionDeliveryAvailability(candidate, ready).available).toBe(false);
    await expect(sendSessionDraft(candidate, "hello")).rejects.toThrow();
  }
  expect(calls).toEqual([]);
});
test("interrupt is still only available for the exact working tmux session", () => {
  const agent = { id: "worker", harnessSessionId: "exact-old-session", state: "working", terminalSurface: { backend: "tmux" } } as Agent;
  expect(sessionInterruptAgent(target, agent)).toBe(agent);
  expect(sessionInterruptAgent(target, { ...agent, harnessSessionId: "new-session" })).toBeNull();
  expect(sessionInterruptAgent(target, { ...agent, state: "idle" })).toBeNull();
  expect(sessionInterruptAgent(target, { ...agent, state: "queued" })).toBeNull();
  expect(sessionInterruptAgent(target, { ...agent, terminalSurface: null, transport: "codex_app_server" })).toBeNull();
  expect(sessionInterruptAgent({ ...target, interruptLocal: false }, agent)).toBeNull();
});
test("unresolved conversation backing cannot steer while Observe is delayed or failed", async () => {
  const unresolved = sessionTargetFromObserve(null, { agentId: "worker", harnessSessionId: "raw", sessionId: "broker" } as never);
  expect(unresolved.sessionId).toBe(""); expect(sessionDeliveryAvailability(unresolved, ready).available).toBe(false);
  await expect(sendSessionDraft(unresolved, "no wrong-session delivery")).rejects.toThrow("resolved session identity");
  expect(calls).toEqual([]);
});
test("observed execution ids are raw; machine mismatches fail closed", async () => {
  const observe = { kind: "agent", agentId: "worker", sessionId: "session:codex:raw", data: { events: [], files: [], metadata: { session: { nodeId: "here", adapterType: "codex" } } } } as never;
  const exact = sessionTargetFromObserve(observe, null, "here", "here");
  expect(exact).toMatchObject({ sessionId: "raw", sessionRef: "session:codex:raw", machineId: "here" });
  expect(sessionDeliveryAvailability(exact, ready).available).toBe(true);
  const mismatch = sessionTargetFromObserve(observe, null, "peer", "here");
  expect(sessionDeliveryAvailability(mismatch, ready).available).toBe(false);
  await expect(sendSessionDraft(mismatch, "no")).rejects.toThrow("machine"); expect(calls).toEqual([]);
});
test("local Observe without node metadata uses only its exact current owner evidence", () => {
  const observe = { kind: "agent", agentId: "worker", sessionId: "raw", data: { events: [], files: [], metadata: { session: { adapterType: "codex" } } } } as never;
  const owner = { id: "worker", harnessSessionId: "raw", homeNodeId: "here" } as Agent;
  expect(sessionDeliveryAvailability(sessionTargetFromObserve(observe, null, "here", "here", owner), ready).available).toBe(true);
  expect(sessionDeliveryAvailability(sessionTargetFromObserve(observe, null, "here", "here", { ...owner, harnessSessionId: "new-session" }), ready).available).toBe(false);
  expect(sessionDeliveryAvailability(sessionTargetFromObserve(observe, null, "peer", "here", owner), ready).available).toBe(false);
});

test("capability reads never overlap or regress to an older ready response", async () => {
  const { sessionSteerPoll } = await import("./session-delivery.ts");
  let finish!: (value: string) => void, reads = 0;
  const received: string[] = [];
  const poll = sessionSteerPoll(() => { reads++; return new Promise<string>((resolve) => { finish = resolve; }); }, (v) => received.push(v), () => {});
  const first = poll.refresh(); await poll.refresh(); expect(reads).toBe(1);
  finish("ready"); await first;
  const second = poll.refresh(); finish("refused"); await second;
  expect(received).toEqual(["ready", "refused"]);
});
test("changing slots discards a late capability response for the previous target", async () => {
  const { sessionSteerPoll } = await import("./session-delivery.ts");
  let finish!: (value: string) => void;
  const received: string[] = [];
  const old = sessionSteerPoll(() => new Promise<string>((resolve) => { finish = resolve; }), (v) => received.push(v), () => received.push("error"));
  const read = old.refresh(); old.stop(); finish("old target ready"); await read;
  expect(received).toEqual([]);
  await old.refresh(); expect(received).toEqual([]);
});
