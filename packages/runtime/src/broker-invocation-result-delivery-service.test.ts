import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSecretValue } from "@openscout/agent-sessions/secret-redaction";
import type { FlightRecord, MessageRecord } from "@openscout/protocol";
import { isIdempotentMessageRetry } from "./broker-message-idempotency.js";
import { BrokerQuarantine } from "./broker-quarantine.js";
import {
  BrokerInvocationResultDeliveryService,
  createInvocationResultReplyIntent,
  invocationResultMessageId,
  matchesPendingInvocationResultReply,
  pendingInvocationResultReply,
  type BrokerInvocationResultDeliveryServiceOptions,
} from "./broker-invocation-result-delivery-service.js";

function resultFlight(invocationId = "invocation-1"): FlightRecord {
  const id = `flight-${invocationId}`;
  const message: MessageRecord = {
    id: "unused",
    actorId: "agent-1",
    originNodeId: "node-1",
    conversationId: "conversation-1",
    replyToMessageId: "request-1",
    class: "agent",
    visibility: "workspace",
    policy: "durable",
    body: `answer for ${invocationId}`,
    createdAt: 2_000,
    audience: { notify: ["operator"] },
    metadata: { invocationId, flightId: id },
  };
  return {
    id, invocationId, targetAgentId: "agent-1", requesterId: "operator",
    state: "completed", output: message.body, completedAt: message.createdAt,
    metadata: { resultReply: createInvocationResultReplyIntent(invocationId, message) },
  };
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function harness(options: {
  flights?: FlightRecord[];
  beforePost?: (message: MessageRecord) => Promise<void>;
  beforeAck?: () => Promise<void>;
  maxPending?: number;
  concurrency?: number;
  quarantineRecord?: BrokerInvocationResultDeliveryServiceOptions["quarantineRecord"];
} = {}) {
  const flights = new Map((options.flights ?? [resultFlight()]).map((flight) => [flight.invocationId, flight]));
  const messages = new Map<string, MessageRecord>();
  const postAttempts: MessageRecord[] = [];
  const warnings: string[] = [];
  function createService() {
    return new BrokerInvocationResultDeliveryService({
      flightForInvocation: (id) => flights.get(id),
      maxPending: options.maxPending,
      concurrency: options.concurrency,
      quarantineRecord: options.quarantineRecord,
      async postMessage(message) {
        postAttempts.push(structuredClone(message));
        await options.beforePost?.(message);
        const existing = messages.get(message.id);
        if (existing) {
          if (!isIdempotentMessageRetry(existing, message)) throw new Error("conflicting retry");
          return;
        }
        messages.set(message.id, structuredClone(message));
      },
      async markDelivered(id, expected) {
        await options.beforeAck?.();
        const flight = flights.get(id);
        if (!flight || !matchesPendingInvocationResultReply(flight, expected)) return false;
        flights.set(id, { ...flight, metadata: { ...flight.metadata, resultReply: { ...expected, status: "delivered", deliveredAt: 3_000 } } });
        return true;
      },
      warn: (message) => warnings.push(message),
    });
  }
  return { flights, messages, postAttempts, warnings, createService };
}

describe("BrokerInvocationResultDeliveryService", () => {
  test("malformed pending reply is durably quarantined without blocking another session or changing its source", async () => {
    const directory = mkdtempSync(join(tmpdir(), "scout-result-quarantine-"));
    const path = join(directory, "quarantine.sqlite");
    let ledger = new BrokerQuarantine(path);
    try {
      const original = resultFlight("bad");
      const malformed = { ...original, output: "canonical output differs from pending reply" };
      const stored = structuredClone(malformed);
      let preserves = 0;
      const h = harness({ flights: [malformed, resultFlight("good")], concurrency: 1,
        quarantineRecord: (entry, reason) => { preserves++; return ledger.preserve({ kind: entry.kind, reason,
          bytes: Buffer.from(JSON.stringify(entry)), source: { path: "fixture-broker.ndjson" }, entries: [entry] }); },
      });
      const service = h.createService();
      expect(service.recover(h.flights.values()).scheduled).toBe(2);
      expect(await service.deliver("bad")).toBe("quarantined");
      expect(await service.deliver("good")).toBe("delivered");
      expect(await service.deliver("bad")).toBe("quarantined");
      expect(preserves).toBe(1);
      expect(h.flights.get("bad")).toEqual(stored);
      expect(h.postAttempts.map(message => message.metadata?.invocationId)).toEqual(["good"]);
      expect(h.warnings).toEqual([]);
      const warning = ledger.list()[0]!;
      expect(warning.scope.recordIds).toContain(malformed.id);
      expect(warning.scope.invocationIds).toContain("bad");
      expect(JSON.parse(Buffer.from(ledger.read(warning.id)!.payload, "base64").toString())).toEqual({ kind: "flight.record", flight: stored });
      ledger.acknowledge(warning.id);
      ledger.close();
      ledger = new BrokerQuarantine(path);
      expect(await h.createService().deliver("bad")).toBe("quarantined");
      expect(preserves).toBe(2);
      expect(ledger.status()).toMatchObject({ openCount: 0, acknowledgedCount: 1 });
      expect(h.postAttempts).toHaveLength(1);
      expect(h.flights.get("bad")).toEqual(stored);
      // A validated repair is a different record; acknowledgement alone above
      // neither modified the source nor authorized sending an invalid reply.
      h.flights.set("bad", original);
      expect(await service.deliver("bad")).toBe("delivered");
    } finally { ledger.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  test("failed quarantine persistence retains pending evidence and releases the worker for a valid reply", async () => {
    const malformed = { ...resultFlight("bad"), output: "mismatch" };
    const h = harness({ flights: [malformed, resultFlight("good")], concurrency: 1,
      quarantineRecord: async () => { throw new Error("quarantine storage unavailable"); },
    });
    const service = h.createService();
    service.recover(h.flights.values());
    expect(await service.deliver("bad")).toBe("failed");
    expect(await service.deliver("good")).toBe("delivered");
    expect(h.flights.get("bad")).toEqual(malformed);
    expect(h.warnings).toHaveLength(1);
    expect(h.postAttempts.map(message => message.metadata?.invocationId)).toEqual(["good"]);
    expect(service.pendingCount).toBe(0);
  });

  test("a restart after completion recovers the exact persisted reply", async () => {
    const stored = structuredClone(resultFlight());
    const h = harness({ flights: [stored] });
    const service = h.createService();
    expect(service.recover(h.flights.values())).toEqual({ scanned: 1, scheduled: 1, atCapacity: false });
    expect(await service.deliver(stored.invocationId)).toBe("delivered");
    expect(h.messages.size).toBe(1);
    const message = h.messages.get(invocationResultMessageId(stored.invocationId))!;
    expect(message).toEqual((stored.metadata!.resultReply as { message: MessageRecord }).message);
    expect(message.createdAt).toBe(2_000);
    expect(pendingInvocationResultReply(h.flights.get(stored.invocationId))).toBeNull();
    expect(h.flights.get(stored.invocationId)?.output).toBe(stored.output);
  });

  test("a restart after posting but before acknowledgement retries one idempotent message", async () => {
    let failAck = true;
    const h = harness({ async beforeAck() { if (failAck) throw new Error("crash before acknowledgement"); } });
    expect(await h.createService().deliver("invocation-1")).toBe("failed");
    expect(h.messages.size).toBe(1);
    expect(pendingInvocationResultReply(h.flights.get("invocation-1"))).not.toBeNull();
    failAck = false;
    expect(await h.createService().deliver("invocation-1")).toBe("delivered");
    expect(h.messages.size).toBe(1);
    expect(h.postAttempts).toHaveLength(2);
    expect(h.postAttempts[0]).toEqual(h.postAttempts[1]);
  });

  test("post failures preserve pending output and retry without an executor", async () => {
    let unavailable = true;
    const h = harness({ async beforePost() { if (unavailable) throw new Error("authority unavailable"); } });
    const service = h.createService();
    expect(await service.deliver("invocation-1")).toBe("failed");
    expect(h.messages.size).toBe(0);
    expect(service.pendingCount).toBe(0);
    expect(pendingInvocationResultReply(h.flights.get("invocation-1"))).not.toBeNull();
    expect(h.flights.get("invocation-1")?.state).toBe("completed");
    unavailable = false;
    expect(await service.deliver("invocation-1")).toBe("delivered");
    expect(h.messages.size).toBe(1);
  });

  test("a queued delivery rechecks terminal truth before posting", async () => {
    const entered = gate();
    const release = gate();
    const first = resultFlight("first");
    const cancelled = resultFlight("cancelled");
    const h = harness({
      flights: [first, cancelled], concurrency: 1,
      async beforePost() { entered.resolve(); await release.promise; },
    });
    const service = h.createService();
    const firstDelivery = service.deliver("first");
    const secondDelivery = service.deliver("cancelled");
    await entered.promise;
    h.flights.set("cancelled", { ...cancelled, state: "cancelled" });
    release.resolve();
    expect(await firstDelivery).toBe("delivered");
    expect(await secondDelivery).toBe("stale");
    expect(h.postAttempts.map((message) => message.metadata?.invocationId)).toEqual(["first"]);
  });

  test("acknowledgement compares the exact pending intent inside the writer", async () => {
    const h = harness({
      async beforeAck() {
        const current = h.flights.get("invocation-1")!;
        const expected = pendingInvocationResultReply(current)!;
        h.flights.set(current.invocationId, { ...current, metadata: { ...current.metadata, resultReply: { ...expected, message: { ...expected.message, audience: { delivery: "none" } } } } });
      },
    });
    expect(await h.createService().deliver("invocation-1")).toBe("stale");
    expect(pendingInvocationResultReply(h.flights.get("invocation-1"))).not.toBeNull();
  });

  test("deduplicates active delivery and bounds pending descriptors and recovery scans", async () => {
    const release = gate();
    const h = harness({ flights: [resultFlight("one"), resultFlight("two"), resultFlight("three")], maxPending: 2, concurrency: 1, async beforePost() { await release.promise; } });
    const service = h.createService();
    const first = service.deliver("one");
    expect(service.deliver("one")).toBe(first);
    const second = service.deliver("two");
    expect(await service.deliver("three")).toBe("deferred");
    expect(service.pendingCount).toBe(2);
    expect(service.recover(h.flights.values())).toEqual({ scanned: 0, scheduled: 0, atCapacity: true });
    release.resolve();
    await Promise.all([first, second]);
    expect(service.pendingCount).toBe(0);
    expect(service.recover([h.flights.get("three")!, h.flights.get("one")!], 1).scanned).toBe(1);
    expect(await service.deliver("three")).toBe("delivered");
  });

  test("does not post missing, mismatched, or already delivered intents", async () => {
    const flight = resultFlight();
    const h = harness({ flights: [{ ...flight, output: "different result" }] });
    expect(await h.createService().deliver("invocation-1")).toBe("stale");
    h.flights.set("invocation-1", { ...flight, metadata: {} });
    expect(await h.createService().deliver("invocation-1")).toBe("stale");
    h.flights.set("invocation-1", flight);
    const service = h.createService();
    expect(await service.deliver("invocation-1")).toBe("delivered");
    expect(await service.deliver("invocation-1")).toBe("stale");
    expect(h.postAttempts).toHaveLength(1);
  });

  test("redacts registered secrets before saving the reply body in metadata", () => {
    const secret = "fixture-result-intent-sensitive-value";
    registerSecretValue(secret, "result-intent-test");
    const message = pendingInvocationResultReply(resultFlight())!.message;
    const intent = createInvocationResultReplyIntent("invocation-1", { ...message, body: `result ${secret}` });
    expect(intent.message.body).toBe("result [redacted]");
    expect(JSON.stringify(intent)).not.toContain(secret);
  });
});
