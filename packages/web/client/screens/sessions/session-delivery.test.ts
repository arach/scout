import { beforeEach, expect, mock, test } from "bun:test";
import type { Agent } from "../../lib/types.ts";
const calls: { path: string; body: Record<string, unknown> }[] = [];
let fail = false;
mock.module("../../lib/api.ts", () => ({ api: async (path: string, init: RequestInit) => {
  calls.push({ path, body: JSON.parse(String(init.body)) });
  if (fail) throw new Error("Unavailable"); return { conversationId: "c1" };
} }));
const { sendSessionDraft, sessionDeliveryAvailability, sessionInterruptAgent } = await import("./session-delivery.ts");
beforeEach(() => { calls.length = 0; fail = false; });
const target = { sessionId: "exact-old-session", agentId: "worker" };
test("untraced delivery is disabled instead of falling back to a traced ask", async () => {
  expect(sessionDeliveryAvailability(target).live.available).toBe(false);
  await expect(sendSessionDraft("live", target, "hi")).rejects.toThrow("direct web transport");
  expect(calls).toEqual([]);
});
test("a traced ask carries the exact selected session even if the agent has moved on", async () => {
  await sendSessionDraft("scout", target, "steer");
  expect(calls).toEqual([{ path: "/api/sessions", body: { target: { agentId: "worker" }, execution: { session: "existing", targetSessionId: "exact-old-session" }, seed: { instructions: "steer" } } }]);
});
test("traced delivery failures do not try /send or /sessions/reply", async () => {
  fail = true; await expect(sendSessionDraft("scout", target, "kept")).rejects.toThrow("Unavailable");
  expect(calls).toHaveLength(1);
});
test("a bare history resumes its own harness and project, not a guessed target", async () => {
  await sendSessionDraft("scout", { sessionId: "history", projectPath: "/repo", harness: "claude-code", model: "model-a" }, "hello");
  expect(calls[0].body).toMatchObject({ target: { projectPath: "/repo" }, execution: { session: "existing", targetSessionId: "history", harness: "claude", model: "model-a" } });
});
test("unknown bare harnesses or missing projects cannot send", async () => {
  for (const target of [{ sessionId: "s" }, { sessionId: "s", harness: "unknown", projectPath: "/repo" }]) {
    expect(sessionDeliveryAvailability(target).scout.available).toBe(false);
    await expect(sendSessionDraft("scout", target, "hi")).rejects.toThrow();
  }
  expect(calls).toEqual([]);
});
test("interrupt is only available for the exact working tmux session", () => {
  const agent = { id: "worker", harnessSessionId: "exact-old-session", state: "working", terminalSurface: { backend: "tmux" } } as Agent;
  expect(sessionInterruptAgent(target, agent)).toBe(agent);
  expect(sessionInterruptAgent(target, { ...agent, harnessSessionId: "new-session" })).toBeNull();
  expect(sessionInterruptAgent(target, { ...agent, state: "idle" })).toBeNull();
  expect(sessionInterruptAgent(target, { ...agent, state: "queued" })).toBeNull();
  expect(sessionInterruptAgent(target, { ...agent, terminalSurface: null, transport: "codex_app_server" })).toBeNull();
});
test("unresolved conversation backing cannot send while the observed lookup is delayed or fails", async () => {
  const { sessionTargetFromObserve } = await import("./session-delivery.ts");
  const target = sessionTargetFromObserve(null, { agentId: "worker", harnessSessionId: "raw", sessionId: "broker" } as never);
  expect(target.sessionId).toBe(""); expect(sessionDeliveryAvailability(target).scout.available).toBe(false);
  await expect(sendSessionDraft("scout", target, "no wrong-session delivery")).rejects.toThrow("resolved session identity");
  expect(calls).toEqual([]);
});
test("observed execution ids are raw; machine mismatches and unverifiable nodes fail closed", async () => {
  const { sessionTargetFromObserve } = await import("./session-delivery.ts");
  const observe = { kind: "agent", agentId: "worker", sessionId: "session:codex:raw", data: { events: [], files: [], metadata: { session: { nodeId: "here", adapterType: "codex" } } } } as never;
  const exact = sessionTargetFromObserve(observe, null, "here", "here"); expect(exact.sessionId).toBe("raw");
  expect(sessionDeliveryAvailability(exact).scout.available).toBe(true);
  const mismatch = sessionTargetFromObserve(observe, null, "peer", "here");
  expect(sessionDeliveryAvailability(mismatch).scout.available).toBe(false);
  await expect(sendSessionDraft("scout", mismatch, "no")).rejects.toThrow("machine");
  expect(calls).toEqual([]);
});
test("a registered local Observe without node metadata uses only its exact current owner evidence", async () => {
  const { sessionTargetFromObserve } = await import("./session-delivery.ts");
  const observe = { kind: "agent", agentId: "worker", sessionId: "raw", data: { events: [], files: [], metadata: { session: { adapterType: "codex" } } } } as never;
  const owner = { id: "worker", harnessSessionId: "raw", homeNodeId: "here" } as Agent;
  expect(sessionDeliveryAvailability(sessionTargetFromObserve(observe, null, "here", "here", owner)).scout.available).toBe(true);
  expect(sessionDeliveryAvailability(sessionTargetFromObserve(observe, null, "here", "here", { ...owner, harnessSessionId: "new-session" })).scout.available).toBe(false);
  expect(sessionDeliveryAvailability(sessionTargetFromObserve(observe, null, "peer", "here", owner)).scout.available).toBe(false);
});
