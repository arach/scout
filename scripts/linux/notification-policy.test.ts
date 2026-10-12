import { describe, expect, test } from "bun:test";
import type { ControlEvent, MessageRecord } from "../../packages/protocol/src/index.js";
import { defaultSettings, escapeMarkup, NotificationGate, NotificationProjection, parseSettings, plainPreview, SseDecoder } from "./notification-policy.js";

const message = (overrides: Partial<MessageRecord> = {}): MessageRecord => ({
  id: "msg.one", conversationId: "dm.operator.builder", actorId: "builder", originNodeId: "archie",
  class: "agent", body: "The build passed.", visibility: "private", policy: "durable", createdAt: 1000,
  audience: { notify: ["operator"] }, ...overrides,
});
const posted = (value: MessageRecord): ControlEvent => ({ id: "evt.one", kind: "message.posted", ts: 1000, actorId: value.actorId, payload: { message: value } });
const projection = () => { const p = new NotificationProjection(); p.nodeId = "archie"; return p; };

describe("Linux communication notifications", () => {
  test("shows inbound replies and outbound operator messages independently", () => {
    const p = projection();
    expect(p.project(posted(message()), defaultSettings)?.category).toBe("inbound");
    const outgoing = posted(message({ actorId: "operator", audience: { invoke: ["builder"] } }));
    expect(p.project(outgoing, defaultSettings)?.category).toBe("outbound");
    expect(p.project(outgoing, { ...defaultSettings, outbound: false })).toBeNull();
    expect(p.project(posted(message()), { ...defaultSettings, inbound: false })).toBeNull();
    expect(p.project(posted(message()), { ...defaultSettings, outbound: false })?.category).toBe("inbound");
  });

  test("uses node provenance for agent traffic and filters operator-only scope", () => {
    const p = projection();
    const peerMessage = message({ audience: { notify: ["reviewer"] }, originNodeId: "mac" });
    expect(p.project(posted(peerMessage), defaultSettings)?.category).toBe("inbound");
    expect(p.project(posted({ ...peerMessage, originNodeId: "archie" }), defaultSettings)?.category).toBe("outbound");
    expect(p.project(posted(peerMessage), { ...defaultSettings, scope: "operator" })).toBeNull();
    expect(p.project(posted(message({ mentions: [{ actorId: "operator" }], audience: {} })), { ...defaultSettings, scope: "operator" })?.category).toBe("inbound");
  });

  test("resolves participants and names from broker events even when disabled", () => {
    const p = projection();
    const settings = { ...defaultSettings, enabled: false };
    p.project({ id: "evt.actor", kind: "actor.registered", ts: 1000, actorId: "builder", payload: { actor: { id: "builder", kind: "agent", displayName: "Build agent" } } }, settings);
    p.project({ id: "evt.conv", kind: "conversation.upserted", ts: 1000, actorId: "builder", payload: { conversation: { id: "dm.operator.builder", kind: "direct", title: "Build", participantIds: ["builder", "operator"], authorityNodeId: "archie", visibility: "private", shareMode: "local" } } }, settings);
    expect(p.project(posted(message()), settings)).toBeNull();
    const notification = p.project(posted(message({ audience: {} })), { ...defaultSettings, scope: "operator" });
    expect(notification?.title).toContain("Build agent → You");
    expect(notification?.category).toBe("inbound");
  });

  test("attention remains separate from communication and has no duplicate message alert", () => {
    const p = projection();
    const need = posted(message({ metadata: { operatorSignal: { kind: "need" } } }));
    expect(p.project(need, { ...defaultSettings, inbound: false, outbound: false })?.category).toBe("attention");
    expect(p.project(need, { ...defaultSettings, attention: false })).toBeNull();
    expect(p.project(posted(message({ class: "log" })), defaultSettings)).toBeNull();
    expect(p.project(posted(message({ class: "status" })), defaultSettings)).toBeNull();
  });

  test("disabled previews contain no message text and IDs are encoded in routes", () => {
    const p = projection();
    const item = p.project(posted(message({ conversationId: "dm/one?other", body: "private preview" })), { ...defaultSettings, previews: false });
    expect(item?.body).not.toContain("private preview");
    expect(item?.path).toBe("/messages/dm%2Fone%3Fother");
    expect(escapeMarkup('<img src="remote"> & x')).toBe('&lt;img src="remote"&gt; &amp; x');
    expect(plainPreview("[ask:abc] hello\nworld\u0000")).toBe("hello world");
  });

  test("does not announce traffic before the broker identifies its node", () => {
    expect(new NotificationProjection().project(posted(message()), defaultSettings)).toBeNull();
  });
});

describe("notification lifecycle", () => {
  test("notifies operator-owned waits on transitions rather than every progress update", () => {
    const p = projection();
    const record = { id: "work.one", kind: "work_item" as const, state: "waiting" as const, acceptanceState: "none" as const,
      title: "Choose a deployment target", createdById: "builder", nextMoveOwnerId: "operator", createdAt: 1000, updatedAt: 1000 };
    const event = (state: "waiting" | "working", id: string): ControlEvent => ({ id, kind: "collaboration.upserted", actorId: "builder", ts: 1000, payload: { record: { ...record, state } } });
    expect(p.project(event("waiting", "first"), defaultSettings)?.category).toBe("attention");
    expect(p.project(event("waiting", "progress"), defaultSettings)).toBeNull();
    expect(p.project(event("working", "resolved"), defaultSettings)).toBeNull();
    expect(p.project(event("waiting", "reopened"), defaultSettings)?.category).toBe("attention");
  });

  test("completion alerts require an explicit callback and use active invocation metadata after startup", () => {
    const p = projection();
    const invocation = { id: "inv.one", requesterId: "operator", requesterNodeId: "archie", targetAgentId: "builder", action: "execute" as const,
      task: "Build the app", ensureAwake: true, stream: false, createdAt: 1000 };
    const flight: ControlEvent = { id: "evt.flight", kind: "flight.updated", actorId: "builder", ts: 1000,
      payload: { flight: { id: "flight.one", invocationId: "inv.one", requesterId: "operator", targetAgentId: "builder", state: "completed" } } };
    p.hydrate({ invocations: { "inv.one": invocation } });
    expect(p.project(flight, defaultSettings)).toBeNull();
    p.hydrate({ invocations: { "inv.one": { ...invocation, metadata: { replyMode: "notify" } } } });
    expect(p.project(flight, defaultSettings)?.title).toContain("finished");
    expect(p.project(flight, { ...defaultSettings, attention: false })).toBeNull();
  });

  test("deduplicates across a saved checkpoint without storing message bodies", () => {
    const item = projection().project(posted(message()), defaultSettings)!;
    const gate = new NotificationGate();
    expect(gate.admit(item, 12, 1000)).toBe(true);
    expect(gate.admit(item, 12, 1001)).toBe(false);
    expect(new NotificationGate(gate.keys()).admit(item, 12, 1002)).toBe(false);
    expect(gate.keys()).toEqual(["message:msg.one"]);
  });

  test("limits chat bursts, lets attention through, and bounds the dedupe cache", () => {
    const item = projection().project(posted(message()), defaultSettings)!;
    const gate = new NotificationGate();
    expect(gate.admit(item, 1, 1000)).toBe(true);
    expect(gate.admit({ ...item, key: "two" }, 1, 1001)).toBe(false);
    expect(gate.admit({ ...item, key: "urgent", category: "attention" }, 1, 1002)).toBe(true);
    expect(gate.admit({ ...item, key: "three" }, 1, 61_000)).toBe(true);
    for (let i = 0; i < 1500; i++) gate.admit({ ...item, key: String(i) }, 1, 61_000);
    expect(gate.keys()).toHaveLength(1000);
  });

  test("rejects malformed config rather than enabling accidentally", () => {
    expect(parseSettings({ inbound: false })).toEqual({ ...defaultSettings, inbound: false });
    for (const value of [{ inbound: "false" }, { scope: "everyone" }, { maxPerMinute: 0 }, { typo: true }, [], null, JSON.parse('{"__proto__":true}')]) {
      expect(() => parseSettings(value)).toThrow();
    }
  });

  test("decodes split SSE frames, CRLF, comments, and multiline JSON", () => {
    const frames: [string, string][] = [];
    const decoder = new SseDecoder((event, data) => frames.push([event, data]));
    decoder.push(": keepalive\r\nevent: message.post");
    decoder.push('ed\r\ndata: {"id":\r\ndata: "one"}\r\n\r');
    decoder.push('\nevent: hello\ndata: {"nodeId":"archie"}\n\n');
    expect(frames).toEqual([["message.posted", '{"id":\n"one"}'], ["hello", '{"nodeId":"archie"}']]);
    expect(() => decoder.push("x".repeat(2_000_001))).toThrow();
  });
});
