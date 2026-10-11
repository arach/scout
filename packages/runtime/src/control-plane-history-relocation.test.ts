import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConversationProjectionStore } from "./conversation-projection-store.js";
import type { ControlPlaneSqliteTransactionalDatabase } from "./sqlite-adapter.js";
import { SQLiteControlPlaneStore } from "./sqlite-store.js";
import { ControlPlaneHistoryStore } from "./control-plane-history-store.js";
import { emptyHistoryRotationPlan } from "./history-rotation.js";
import type { FlightRecord, InvocationRequest, MessageRecord } from "@openscout/protocol";
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "openscout-tier-relocation-")); cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const store = new SQLiteControlPlaneStore(join(root, "control.sqlite")); cleanups.push(() => store.close());
  const history = new ControlPlaneHistoryStore(join(root, "history")); cleanups.push(() => history.close());
  store.configureHistory(join(root, "history"));
  store.upsertNode({ id: "node", meshId: "mesh", name: "Node", advertiseScope: "local", registeredAt: 1 });
  store.upsertActor({ id: "operator", kind: "human", displayName: "Operator" });
  store.upsertActor({ id: "agent", kind: "agent", displayName: "Agent" });
  store.upsertConversation({ id: "chat_history", kind: "direct", title: "History", visibility: "private", shareMode: "local", authorityNodeId: "node", participantIds: ["operator", "agent"] });
  const message: MessageRecord = { id: "message", conversationId: "chat_history", actorId: "operator", originNodeId: "node", class: "agent",
    body: "history雪".repeat(2048), visibility: "private", policy: "durable", createdAt: 1_700_000_000_000,
    mentions: [{ actorId: "agent", label: "Agent" }], attachments: [{ id: "attachment", mediaType: "text/plain", blobKey: "original-blob", metadata: { arbitrary: "context" } }],
    metadata: { context: { everyField: ["preserve", { unicode: "🚀" }] } } };
  const invocation: InvocationRequest = { id: "invocation", requesterId: "operator", requesterNodeId: "node", targetAgentId: "agent", action: "ask",
    task: "task".repeat(1024), conversationId: "chat_history", messageId: "message", context: { originalContext: "all".repeat(2048) }, createdAt: message.createdAt };
  const flight: FlightRecord = { id: "flight", invocationId: "invocation", requesterId: "operator", targetAgentId: "agent", state: "completed",
    output: "complete answer".repeat(2048), startedAt: message.createdAt, completedAt: message.createdAt + 1 };
  store.recordMessage(message); store.recordInvocation(invocation); store.recordFlight(flight);
  store.upsertMessageReaction({ channelId: "chat_history", messageId: "message", actorId: "agent", emoji: "🚀", createdAt: message.createdAt + 1 });
  const plan = emptyHistoryRotationPlan(); plan.messageIds.add(message.id); plan.invocationIds.add(invocation.id); plan.flightIds.add(flight.id);
  return { root, store, history, message, invocation, flight, plan };
}

test("payload moves to historical partitions while exact anchors, context, reactions and new replies remain correct", () => {
  const { store, history, message, invocation, flight, plan } = fixture();
  const expectedMessage = store.readMessages([message.id]).get(message.id);
  const expectedInvocation = store.readInvocations([invocation.id]).get(invocation.id);
  const expectedFlight = store.readFlights([flight.id]).get(flight.id);
  const prepared = store.publishHistoryRotation(plan, history);
  expect(prepared.publication).not.toBeNull();
  const result = store.removePublishedHistory(prepared.publication!, prepared.published, history);
  expect(result.blocked).toEqual([]);
  expect([...result.removed.messageIds]).toEqual([message.id]);
  expect(store.writerDb.query<{ body: string }>("SELECT body FROM messages WHERE id=?1").get(message.id)?.body).toBe("");
  expect(store.writerDb.query<{ task: string; context_json: string | null }>("SELECT task,context_json FROM invocations WHERE id=?1").get(invocation.id)).toEqual({ task: "", context_json: null });
  expect(store.writerDb.query("SELECT 1 FROM flights WHERE id=?1").get(flight.id)).toBeNull();
  expect(store.readMessages([message.id]).get(message.id)).toEqual(expectedMessage);
  expect(store.readInvocations([invocation.id]).get(invocation.id)).toEqual(expectedInvocation);
  expect(store.readInvocationSnapshot(invocation.id).flight).toEqual(expectedFlight);
  expect(store.listMessageReactions("chat_history")).toHaveLength(1);
  expect(store.loadSnapshot().messages[message.id]).toBeUndefined();
  expect(store.loadSnapshot().invocations[invocation.id]).toBeUndefined();
  store.recordMessage({ ...message, id: "new-reply", body: "new reply", replyToMessageId: message.id, attachments: [], mentions: [] });
  store.recordInvocation({ ...invocation, id: "new-invocation", task: "follow up", messageId: message.id });
  expect(store.readMessages(["new-reply"]).get("new-reply")?.replyToMessageId).toBe(message.id);
  expect(store.readInvocations(["new-invocation"]).get("new-invocation")?.messageId).toBe(message.id);
  expect(store.readMessages([message.id]).get(message.id)).toEqual(expectedMessage);
  expect(store.writerDb.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("post-publication changes preserve hot payload; late flight updates restore full archived invocation context", () => {
  const { store, history, message, invocation, flight, plan } = fixture();
  const prepared = store.publishHistoryRotation(plan, history);
  store.recordMessage({ ...message, body: "changed while worker published" });
  const result = store.removePublishedHistory(prepared.publication!, prepared.published, history);
  expect(result.blocked).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "message", id: message.id, reason: "record or related rows changed after publication" })]));
  expect(store.readMessages([message.id]).get(message.id)?.body).toBe("changed while worker published");
  expect(store.readInvocations([invocation.id]).get(invocation.id)?.context).toEqual(invocation.context);
  store.recordFlight({ ...flight, output: "updated terminal output", completedAt: flight.completedAt! + 1 });
  expect(store.readInvocations([invocation.id]).get(invocation.id)?.context).toEqual(invocation.context);
  expect(store.writerDb.query("SELECT 1 FROM broker_history_anchors WHERE kind='invocation' AND id=?1").get(invocation.id)).toBeNull();
  expect(store.readInvocationSnapshot(invocation.id).flight?.output).toBe("updated terminal output");
  expect(store.writerDb.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("archived message mutation restores full payload and attachments through ordinary canonical writes", () => {
  const { store, history, message, plan } = fixture();
  const prepared = store.publishHistoryRotation(plan, history);
  store.removePublishedHistory(prepared.publication!, prepared.published, history);
  const original = store.readMessages([message.id]).get(message.id)!;
  store.recordMessage({ ...original, body: "corrected full message" });
  expect(store.readMessages([message.id]).get(message.id)).toEqual({ ...original, body: "corrected full message" });
  expect(store.writerDb.query("SELECT 1 FROM broker_history_anchors WHERE kind='message' AND id=?1").get(message.id)).toBeNull();
  expect(history.read<MessageRecord>("message", message.id)?.body).toBe(original.body);
});


test("restart preserves the archived latest flight when an older sibling still remains hot", () => {
  const { root, store, history, invocation, flight, plan } = fixture();
  store.recordFlight({ ...flight, id: "older-flight", output: "older output", startedAt: flight.startedAt! - 100, completedAt: flight.completedAt! - 100 });
  const prepared = store.publishHistoryRotation(plan, history);
  store.removePublishedHistory(prepared.publication!, prepared.published, history);
  store.close();
  const reopened = new SQLiteControlPlaneStore(join(root, "control.sqlite")); cleanups.push(() => reopened.close());
  reopened.configureHistory(join(root, "history"));
  expect(reopened.readInvocationSnapshot(invocation.id).flight?.id).toBe(flight.id);
  expect(reopened.readInvocationSnapshot(invocation.id).flight?.output).toBe(flight.output);
  expect(reopened.readInvocations([invocation.id]).get(invocation.id)?.context).toEqual(invocation.context);
  expect(reopened.loadSnapshot().invocations[invocation.id]).toBeUndefined();
  expect(reopened.writerDb.query("PRAGMA foreign_key_check").all()).toEqual([]);
});


test("conversation summary rebuild reads the archived body instead of a blank anchor", () => {
  const { store, history, plan } = fixture();
  store.upsertConversation({ id: "chat_history", kind: "channel", title: "History", visibility: "private", shareMode: "local", authorityNodeId: "node", participantIds: ["operator", "agent"] });
  const projection = new ConversationProjectionStore(store.writerDb as ControlPlaneSqliteTransactionalDatabase, {
    readArchivedMessage: id => store.readArchivedMessage(id),
  });
  projection.reconcileAll();
  const before = projection.snapshot().items.find(item => item.conversationId === "chat_history")!;
  expect(before.preview).toContain("history雪");
  const prepared = store.publishHistoryRotation(plan, history);
  store.removePublishedHistory(prepared.publication!, prepared.published, history);
  projection.reconcileAll();
  expect(projection.snapshot().items.find(item => item.conversationId === "chat_history")?.preview).toBe(before.preview);
});

test("a valid large canonical record uses one bounded overflow partition and leaves no active body payload", () => {
  const { store, history, message } = fixture();
  const large = { ...message, body: "a".repeat(5 * 1024 * 1024) };
  store.recordMessage(large);
  const plan = emptyHistoryRotationPlan(); plan.messageIds.add(message.id);
  const prepared = store.publishHistoryRotation(plan, history);
  expect(prepared.publication!.payloadBytes).toBeGreaterThan(8 * 1024 * 1024);
  expect(prepared.publication!.records).toHaveLength(2);
  const removed = store.removePublishedHistory(prepared.publication!, prepared.published, history);
  expect([...removed.removed.messageIds]).toEqual([message.id]);
  expect(store.readMessages([message.id]).get(message.id)?.body).toBe(large.body);
  expect(store.writerDb.query<{ body: string }>("SELECT body FROM messages WHERE id=?1").get(message.id)?.body).toBe("");
});
