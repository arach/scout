import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BrokerChatListening, ChatListeningError, type ListeningMessage } from "./broker-chat-listening.js";
import type { ListeningDestination } from "./room-listening-delivery.js";

const homes: string[] = [];
afterEach(async () => { for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true }); });
const member = { origin: "http://127.0.0.1:1", space: "space", channelId: "room", actorId: "reader", token: "secret" };
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "room-delivery-")); homes.push(home);
  let now = 100_000, error: ChatListeningError | undefined, reads = 0;
  const messages: ListeningMessage[] = [], writes: any[] = [];
  let destination: ListeningDestination = { state: "idle", facing: "background", endpointId: "endpoint", sessionId: "native", token: "incarnation:idle", steer: true };
  let throwAfterWrite = false, store!: BrokerChatListening;
  const options = { path: join(home, "state.json"), now: () => now, isDurableAgent: () => true,
    observeSession: async () => ({ availability: "available" as const, endpointId: "endpoint" }),
    source: { read: async (_m: any, cursor: string | null) => { reads++; if (error) throw error; return {
      messages: cursor === null ? [] : messages.slice(Number(cursor)), cursor: String(messages.length), expiresAt: 9e12 }; } },
    delivery: { observe: async () => destination, submit: async (d: any, action: string, prompt: string) => {
      // Reservation must be fsynced before the effect, including after a crash.
      const events = await readFile(join(home, "state.json.events"), "utf8"); expect(events).toContain('"state":"uncertain"');
      writes.push({ d, action, prompt }); if (throwAfterWrite) throw Error("lost acknowledgement");
      return { accepted: true, evidence: "native_accepted" };
    } },
  };
  store = new BrokerChatListening(options); await store.load();
  const sub = await store.enroll("agent", member, "operator", { mode: "session", sessionId: "native", facing: "background" });
  return { get store() { return store; }, sub, writes, options, get reads() { return reads; },
    state: (patch: Partial<ListeningDestination>) => { destination = { ...destination, ...patch }; },
    fail: (e?: ChatListeningError) => { error = e; }, advance: (n = 5000) => { now += n; },
    uncertain: () => { throwAfterWrite = true; },
    post: (id: string, relevance: ListeningMessage["relevance"] = "mention") => messages.push({ id, actorId: "sender", body: `untrusted \x1b ${id}`, createdAt: now, relevance, threadRootId: id }),
    restart: async () => { await store.stop(); store = new BrokerChatListening(options); await store.load(); },
    policy: async (awake: "queue" | "steer" = "queue", idle: "hold" | "revive" = "revive") => {
      const p = await store.setPolicy("agent", sub.id, { active: true, awake, idle }, "operator");
      if (p.proposedPolicy) await store.confirmPolicy("agent", sub.id, p.proposedPolicy.revision, "agent");
    },
  };
}

test("default catch-up has no native effects; broadening requires other-party confirmation", async () => {
  const h = await fixture(); h.post("a"); await h.store.tick(); expect(h.writes).toHaveLength(0);
  const p = await h.store.setPolicy("agent", h.sub.id, { active: true, awake: "queue", idle: "revive" }, "operator");
  await h.store.tick(); expect(h.writes).toHaveLength(0);
  await expect(h.store.confirmPolicy("agent", h.sub.id, p.proposedPolicy!.revision, "operator")).rejects.toThrow("policy_confirmation_required");
  await expect(h.store.confirmPolicy("agent", h.sub.id, 123, "agent")).rejects.toThrow();
  await h.store.confirmPolicy("agent", h.sub.id, p.proposedPolicy!.revision, "agent"); await h.store.tick(); expect(h.writes).toHaveLength(1);
});

test("awake queue is Scout-owned; compact batch at idle boundary includes ids/sender/receipt, never auto-acks", async () => {
  const h = await fixture(); await h.policy(); h.state({ state: "active", turnId: "turn-1" });
  h.post("a"); h.post("b"); h.post("ordinary", null); h.post("reply", "direct-reply");
  await h.store.tick(); await h.store.tick(); expect(h.writes).toHaveLength(0);
  expect(h.store.status("agent")[0]!.delivery.status).toBe("queued_boundary");
  h.state({ state: "idle", token: "incarnation:2", turnId: undefined }); await h.store.tick();
  expect(h.writes).toHaveLength(1); expect(h.writes[0].action).toBe("revive");
  const status = h.store.status("agent")[0]!, attempt = status.delivery.attempts[0]!;
  expect(attempt.messageIds).toEqual(["a", "b"]); expect(attempt.state).toBe("accepted");
  expect(h.writes[0].prompt).toContain(attempt.id); expect(h.writes[0].prompt).toContain('"sender":"sender"');
  expect(h.writes[0].prompt).not.toContain("\x1b"); expect(Buffer.byteLength(h.writes[0].prompt)).toBeLessThanOrEqual(4096);
  expect(status.unreadCount).toBe(4); await h.store.ack("agent", h.sub.id, attempt.id); await h.store.ack("agent", h.sub.id, attempt.id);
  expect(h.store.status("agent")[0]!.unreadCount).toBe(2);
  expect((await h.store.catchUp("agent", h.sub.id)).messages.map(m => m.id)).toEqual(["ordinary", "reply"]);
});

test("queue+hold never starts at completion; unsupported steer holds instead of silently queueing", async () => {
  const h = await fixture(); await h.policy("queue", "hold"); h.post("a");
  h.state({ state: "active", turnId: "t" }); await h.store.tick(); h.state({ state: "idle" }); await h.store.tick(); expect(h.writes).toHaveLength(0);
  expect(h.store.status("agent")[0]!.delivery.status).toBe("waiting_for_next_turn");
  await h.policy("steer", "hold"); h.state({ state: "active", turnId: "t", steer: false }); await h.store.tick(); expect(h.writes).toHaveLength(0);
  expect(h.store.status("agent")[0]!.delivery.status).toBe("steer_unsupported");
  h.state({ steer: true }); await h.store.tick(); expect(h.writes[0].action).toBe("steer");
});

test("unknown, operator, and missing native proof hold; confirmed gone permanently ends session binding", async () => {
  const h = await fixture(); await h.policy(); h.post("a");
  for (const patch of [{ state: "unknown" }, { state: "idle", facing: "operator" }, { facing: "background", token: undefined }] as Partial<ListeningDestination>[]) {
    h.state(patch); await h.store.tick(); expect(h.writes).toHaveLength(0);
  }
  h.state({ state: "gone" }); await h.store.tick(); expect(h.store.status("agent")[0]!.binding.state).toBe("ended");
  await h.restart(); h.state({ state: "idle", token: "new" }); h.post("missed"); await h.store.tick();
  expect(h.writes).toHaveLength(0); expect(h.store.status("agent")[0]!.unreadCount).toBe(2);
});

test("accepted and uncertain submissions survive restart without duplicate input, including new arrivals", async () => {
  for (const uncertain of [false, true]) {
    const h = await fixture(); await h.policy(); if (uncertain) h.uncertain(); h.post("a"); await h.store.tick();
    await h.restart(); h.post("b"); await h.store.tick(); await h.store.tick(); expect(h.writes).toHaveLength(1);
    const a = h.store.status("agent")[0]!.delivery.attempts[0]!; expect(a.state).toBe(uncertain ? "uncertain" : "accepted");
    await h.store.ack("agent", h.sub.id, a.id); await h.store.tick(); expect(h.writes).toHaveLength(2);
    expect(h.store.status("agent")[0]!.delivery.attempts[1]!.messageIds).toEqual(["b"]);
  }
});

test("policy restriction before dispatch suppresses revive and persists across restart", async () => {
  const h = await fixture(); await h.policy(); h.post("a"); h.state({ state: "active", turnId: "t" }); await h.store.tick();
  await h.store.setPolicy("agent", h.sub.id, { active: true, awake: "queue", idle: "hold" }, "agent");
  await h.restart(); h.state({ state: "idle" }); await h.store.tick(); expect(h.writes).toHaveLength(0);
});

test("transient source failure doubles bounded retry and preserves deadline across restart; terminal denial stops", async () => {
  const h = await fixture(); await h.policy(); h.post("a"); h.fail(new ChatListeningError("source_unavailable"));
  await h.store.tick(); const first = h.reads; await h.store.tick(); expect(h.reads).toBe(first);
  h.advance(); await h.store.tick(); expect(h.reads).toBe(first + 1);
  const retry = h.store.status("agent")[0]!.retry!; expect(retry.nextAttemptAt).toBe(115_000);
  await h.restart(); h.advance(); await h.store.tick(); expect(h.reads).toBe(first + 1);
  h.advance(); h.fail(new ChatListeningError("membership_denied", true)); await h.store.tick(); const terminal = h.reads;
  expect(h.store.status("agent")[0]!.retry).toMatchObject({ terminal: true, nextAttemptAt: null });
  await h.restart(); h.advance(9e6); h.fail(); await h.store.tick(); expect(h.reads).toBe(terminal); expect(h.writes).toHaveLength(0);
  await h.store.enroll("agent", member, "operator", { mode: "session", sessionId: "native", endpointId: "endpoint", facing: "background" });
  await h.store.tick(); expect(h.writes).toHaveLength(1);
});

test("one endpoint across rooms cannot piggyback hold policy or submit overlapping batches", async () => {
  const h = await fixture(); const other = await h.store.enroll("other", { ...member, channelId: "other", actorId: "other" }, "operator", { mode: "session", sessionId: "native", facing: "background" });
  await h.policy(); h.post("a"); await h.store.tick(); expect(h.writes).toHaveLength(1);
  const p = await h.store.setPolicy("other", other.id, { active: true, awake: "queue", idle: "revive" }, "operator");
  await h.store.confirmPolicy("other", other.id, p.proposedPolicy!.revision, "other"); await h.store.tick(); expect(h.writes).toHaveLength(1);
  expect(h.store.status("other")[0]!.delivery.status).toBe("awaiting_ack_or_reconciliation");
});
