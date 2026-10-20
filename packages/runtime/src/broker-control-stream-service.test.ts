import { EventEmitter } from "node:events";

import { describe, expect, test } from "bun:test";

import type {
  ControlEvent,
  DeliveryIntent,
  InvocationRequest,
  MessageRecord,
} from "@openscout/protocol";

import {
  BrokerControlStreamService,
  invocationIdsForEvent,
  parseInboxReasons,
  parseInboxStatuses,
  writeSseFrame,
} from "./broker-control-stream-service.js";

class FakeRequest extends EventEmitter {}

class FakeResponse extends EventEmitter {
  readonly chunks: string[] = [];
  headers: Record<string, string> | undefined;
  status: number | undefined;
  ended = false;

  writeHead(status: number, headers: Record<string, string>): void {
    this.status = status;
    this.headers = headers;
  }

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  end(): void {
    this.ended = true;
    this.emit("finish");
  }

  body(): string {
    return this.chunks.join("");
  }
}

function delivery(input: Partial<DeliveryIntent> = {}): DeliveryIntent {
  return {
    id: "delivery-1",
    messageId: "message-1",
    targetId: "agent-1",
    targetKind: "agent",
    transport: "local_socket",
    reason: "direct_message",
    policy: "best_effort",
    status: "pending",
    ...input,
  };
}

function message(input: Partial<MessageRecord> = {}): MessageRecord {
  return {
    id: "message-1",
    conversationId: "conversation-1",
    actorId: "operator",
    originNodeId: "node-1",
    class: "person",
    body: "hello",
    visibility: "workspace",
    policy: "best_effort",
    createdAt: 1,
    ...input,
  };
}

function invocation(input: Partial<InvocationRequest> = {}): InvocationRequest {
  return {
    id: "invocation-1",
    requesterId: "operator",
    requesterNodeId: "node-1",
    targetAgentId: "agent-1",
    action: "consult",
    task: "queued work",
    ensureAwake: true,
    stream: false,
    createdAt: 1,
    ...input,
  };
}

function createService(input: {
  deliveries?: DeliveryIntent[];
  messages?: MessageRecord[];
  invocations?: InvocationRequest[];
  presenceSnapshot?: ControlEvent[];
} = {}) {
  const deliveries = new Map((input.deliveries ?? []).map((item) => [item.id, item]));
  const messages = new Map((input.messages ?? []).map((item) => [item.id, item]));
  const invocations = new Map((input.invocations ?? []).map((item) => [item.id, item]));
  const enqueuedEvents: ControlEvent[] = [];
  const service = new BrokerControlStreamService({
    enqueueEvent: (event) => enqueuedEvents.push(event),
    findDeliveryById: (deliveryId) => deliveries.get(deliveryId),
    listDeliveries: (options) => [...deliveries.values()]
      .filter(item => !options.targetId || item.targetId === options.targetId)
      .filter(item => !options.statuses || options.statuses.includes(item.status))
      .filter(item => !options.reasons || options.reasons.includes(item.reason))
      .slice(0, options.limit),
    messageById: (messageId) => messages.get(messageId),
    invocationById: (invocationId) => invocations.get(invocationId),
    presenceSnapshot: input.presenceSnapshot ? () => input.presenceSnapshot ?? [] : undefined,
  });
  return { enqueuedEvents, service };
}

function presenceEvent(agentId: string): ControlEvent {
  return {
    id: `event-presence-${agentId}`,
    kind: "presence.updated",
    ts: 1_700_000_000_000,
    actorId: agentId,
    payload: {
      beat: {
        agentId,
        activity: "executing",
        phase: "running",
        transitionAt: 1_699_999_000_000,
        updatedAt: 1_700_000_000_000,
        staleAt: 1_700_000_045_000,
        confidence: 0.9,
      },
    },
  } as ControlEvent;
}

describe("broker control stream service", () => {
  test("a slow SSE socket disconnects without losing canonical events or blocking other clients", () => {
    const { service, enqueuedEvents } = createService();
    const slow = new FakeResponse(); const fast = new FakeResponse();
    service.addEventStream({ request: new FakeRequest() as never, response: slow as never, hello: {} });
    service.addEventStream({ request: new FakeRequest() as never, response: fast as never, hello: {} });
    slow.write = chunk => { slow.chunks.push(chunk); return false; };
    for (let i = 0; i < 1000; i++) service.streamEvent({
      id: `event-${i}`, kind: "message.posted", ts: i, actorId: "operator",
      payload: { message: message({ id: `message-${i}` }) },
    } as ControlEvent);
    expect(slow.ended).toBe(true); expect(slow.chunks).toHaveLength(2);
    expect(service.eventSubscriberCount()).toBe(1);
    expect(enqueuedEvents).toHaveLength(1000); expect(fast.chunks).toHaveLength(1001);
  });

  test("frames above the configured singleton limit close before writing", () => {
    const response = new FakeResponse();
    expect(writeSseFrame(response as never, "snapshot", "x".repeat(1024), { maxFrameBytes: 1024 })).toBe(false);
    expect(response.ended).toBe(true); expect(response.chunks).toHaveLength(0);
  });

  test("a legal large snapshot drains its accepted frame and never registers for later events", () => {
    const { service } = createService(); const response = new FakeResponse();
    let destroyed = false;
    Object.assign(response, { destroy: () => { destroyed = true; } });
    response.write = chunk => { response.chunks.push(chunk); return false; };
    const flight = { id: "large-flight", state: "completed", output: "x".repeat(3 * 1024 * 1024) };
    service.addInvocationStream({ request: new FakeRequest() as never, response: response as never,
      invocationId: "invocation-1", snapshot: { flight } });
    expect(response.ended).toBe(true);
    expect(destroyed).toBe(false);
    expect(response.chunks).toHaveLength(1);
    expect(JSON.parse(response.chunks[0]!.split("data: ")[1]!.trim()).flight).toEqual(flight);
    expect(service.invocationSubscriberCount("invocation-1")).toBe(0);
    expect(response.listenerCount("finish")).toBe(0);
    expect(response.listenerCount("close")).toBe(0);
  });

  test("an accepted frame on a stalled socket has a bounded drain deadline", async () => {
    const response = new FakeResponse(); let destroyed = false;
    Object.assign(response, { destroy: () => { destroyed = true; } });
    response.end = () => { response.ended = true; }; // No finish/close: a stalled peer.
    response.write = chunk => { response.chunks.push(chunk); return false; };
    expect(writeSseFrame(response as never, "snapshot", { complete: true }, { drainTimeoutMs: 5 })).toBe(false);
    expect(destroyed).toBe(false);
    expect(writeSseFrame(response as never, "later", { ignored: true })).toBe(false);
    expect(response.chunks).toHaveLength(1);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(destroyed).toBe(true);
    expect(response.listenerCount("finish")).toBe(0);
    expect(response.listenerCount("close")).toBe(0);
  });

  test("a stalled inbox history read has bounded publications and forces resnapshot", async () => {
    let resolveRead!: (value: MessageRecord) => void; let reads = 0; let committed = 0;
    const read = new Promise<MessageRecord>(resolve => { resolveRead = resolve; });
    const service = new BrokerControlStreamService({ enqueueEvent: () => { committed++; },
      findDeliveryById: () => undefined, listDeliveries: () => [], invocationById: () => undefined,
      messageById: () => { reads++; return read; } });
    const response = new FakeResponse();
    service.addInboxStream({ request: new FakeRequest() as never, response: response as never, targetId: "agent-1", snapshot: {} });
    service.streamEvent({ id: "first", kind: "delivery.planned", payload: { delivery: delivery() } } as ControlEvent);
    await Promise.resolve();
    for (let i = 0; i < 1000; i++) service.streamEvent({ id: `event-${i}`, kind: "delivery.planned",
      payload: { delivery: delivery({ id: `delivery-${i}` }) } } as ControlEvent);
    expect(response.ended).toBe(true); expect(service.inboxSubscriberCount("agent-1")).toBe(0);
    expect(committed).toBe(1001); expect(reads).toBe(1);
    resolveRead(message()); await new Promise(resolve => setTimeout(resolve, 0));
    expect(reads).toBe(1); expect(response.chunks).toHaveLength(1);
  });

  test("history for other recipients or states cannot hide a pending inbox delivery", async () => {
    const rows = Array.from({ length: 5_001 }, (_, index) => delivery({
      id: `older-${index}`, targetId: index % 2 ? "other-agent" : "agent-1", status: "completed",
    }));
    rows.push(delivery({ id: "wanted", status: "accepted" }));
    const { service } = createService({ deliveries: rows });
    expect((await service.listInboxItems({ targetId: "agent-1", limit: 1 })).map(item => item.id)).toEqual(["wanted"]);
  });
  test("parses comma-separated inbox filters", () => {
    const url = new URL("http://broker.test/v1/inbox?status=pending,leased&reason=direct_message&reason=invocation");

    expect(parseInboxStatuses(url)).toEqual(new Set(["pending", "leased"]));
    expect(parseInboxReasons(url)).toEqual(new Set(["direct_message", "invocation"]));
  });

  test("routes delivery attempts to invocation subscribers through the delivery record", () => {
    const relatedDelivery = delivery({ id: "delivery-1", invocationId: "invocation-1" });
    const event = {
      kind: "delivery.attempted",
      payload: {
        attempt: {
          id: "attempt-1",
          deliveryId: relatedDelivery.id,
          attempt: 1,
          status: "sent",
          createdAt: 10,
        },
      },
    } as ControlEvent;

    expect(invocationIdsForEvent(event, {
      findDeliveryById: (deliveryId) => deliveryId === relatedDelivery.id ? relatedDelivery : undefined,
    })).toEqual(["invocation-1"]);
  });

  test("replays the presence current value to a new event-stream subscriber", () => {
    const { enqueuedEvents, service } = createService({
      presenceSnapshot: [presenceEvent("agent-1"), presenceEvent("agent-2")],
    });
    const request = new FakeRequest();
    const response = new FakeResponse();

    service.addEventStream({
      request: request as never,
      response: response as never,
      hello: { nodeId: "node-1" },
    });

    const body = response.body();
    expect(body.indexOf("event: hello")).toBeLessThan(body.indexOf("event: presence.updated"));
    expect(body).toContain('"agentId":"agent-1"');
    expect(body).toContain('"agentId":"agent-2"');
    // Replaying current value must not create a durable row, and must not
    // resemble a backlog: one frame per agent, no history.
    expect(enqueuedEvents).toEqual([]);
    expect(body.split("event: presence.updated").length - 1).toBe(2);
  });

  test("event streams open cleanly when nothing has ever published presence", () => {
    const { service } = createService();
    const request = new FakeRequest();
    const response = new FakeResponse();

    service.addEventStream({
      request: request as never,
      response: response as never,
      hello: { nodeId: "node-1" },
    });

    expect(response.body()).toContain("event: hello");
    expect(response.body()).not.toContain("presence.updated");
    expect(service.eventSubscriberCount()).toBe(1);
  });

  test("streams invocation snapshots and cleans up subscribers on close", () => {
    const { service } = createService();
    const request = new FakeRequest();
    const response = new FakeResponse();

    service.addInvocationStream({
      request: request as never,
      response: response as never,
      invocationId: "invocation-1",
      snapshot: { invocationId: "invocation-1" },
    });

    expect(response.status).toBe(200);
    expect(response.headers?.["content-type"]).toBe("text/event-stream");
    expect(response.body()).toContain("event: snapshot");
    expect(service.invocationSubscriberCount("invocation-1")).toBe(1);

    request.emit("close");

    expect(service.invocationSubscriberCount("invocation-1")).toBe(0);
    expect(response.ended).toBe(true);
  });

  test("fans control events to global, invocation, and inbox subscribers", async () => {
    const relatedDelivery = delivery({ invocationId: "invocation-1" });
    const { enqueuedEvents, service } = createService({
      deliveries: [relatedDelivery],
      messages: [message()],
      invocations: [invocation()],
    });
    const eventRequest = new FakeRequest();
    const eventResponse = new FakeResponse();
    const invocationRequest = new FakeRequest();
    const invocationResponse = new FakeResponse();
    const inboxRequest = new FakeRequest();
    const inboxResponse = new FakeResponse();

    service.addEventStream({
      request: eventRequest as never,
      response: eventResponse as never,
      hello: { nodeId: "node-1" },
    });
    service.addInvocationStream({
      request: invocationRequest as never,
      response: invocationResponse as never,
      invocationId: "invocation-1",
      snapshot: { invocationId: "invocation-1" },
    });
    service.addInboxStream({
      request: inboxRequest as never,
      response: inboxResponse as never,
      targetId: "agent-1",
      snapshot: { targetId: "agent-1", items: [] },
    });

    const event = {
      kind: "delivery.planned",
      payload: {
        delivery: relatedDelivery,
      },
    } as ControlEvent;
    service.streamEvent(event);

    expect(enqueuedEvents).toEqual([event]);
    expect(eventResponse.body()).toContain("event: delivery.planned");
    expect(invocationResponse.body()).toContain("event: delivery.planned");
    await new Promise((resolve) => setImmediate(resolve));
    expect(inboxResponse.body()).toContain("event: inbox.item");
    expect(inboxResponse.body()).toContain("\"conversationId\":\"conversation-1\"");
  });

  test("keeps event and invocation streams alive without touching inbox streams", () => {
    const { service } = createService();
    const eventResponse = new FakeResponse();
    const invocationResponse = new FakeResponse();
    const inboxResponse = new FakeResponse();

    service.addEventStream({
      request: new FakeRequest() as never,
      response: eventResponse as never,
      hello: {},
    });
    service.addInvocationStream({
      request: new FakeRequest() as never,
      response: invocationResponse as never,
      invocationId: "invocation-1",
      snapshot: {},
    });
    service.addInboxStream({
      request: new FakeRequest() as never,
      response: inboxResponse as never,
      targetId: "agent-1",
      snapshot: {},
    });

    service.streamKeepAlive();

    expect(eventResponse.body()).toContain(": keepalive");
    expect(invocationResponse.body()).toContain(": keepalive");
    expect(inboxResponse.body()).not.toContain(": keepalive");
  });
});

test("already-journaled bridge lifecycle events fan out once without a second journal write", () => {
  const { service, enqueuedEvents } = createService();
  const response = new FakeResponse();
  service.addEventStream({ request: new FakeRequest() as never, response: response as never, hello: {} });
  const event: ControlEvent = { id: "event-bridge", kind: "mesh.bridge.lifecycle", ts: 1, actorId: "operator",
    payload: { action: "disable", phase: "requested" } };
  service.streamRecordedEvent(event);
  expect(enqueuedEvents).toEqual([]);
  expect(response.body()).toContain('event: mesh.bridge.lifecycle');
  expect(response.body().match(/event-bridge/g)).toHaveLength(1);
});

test("recorded bridge failures fan out once without a second journal write", () => {
  const { service, enqueuedEvents } = createService();
  const response = new FakeResponse();
  service.addEventStream({ request: new FakeRequest() as never, response: response as never, hello: {} });
  const event: ControlEvent = { id: "event-bridge-failed", kind: "mesh.bridge.lifecycle", ts: 2, actorId: "operator",
    payload: { action: "configure", phase: "failed" } };
  service.streamRecordedEvent(event);
  expect(enqueuedEvents).toEqual([]);
  expect(response.body()).toContain('"phase":"failed"');
  expect(response.body().match(/event-bridge-failed/g)).toHaveLength(1);
});
