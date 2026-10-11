import { describe, expect, test } from "bun:test";
import type { MessageRecord } from "@openscout/protocol";
import type { BrokerJournalVerificationRecords } from "./broker-journal.js";
import { emptyHistoryRotationPlan, planHistoryRotation, refineVerifiedRotation, type HistoryRotationPlan } from "./history-rotation.js";
import { constrainHistoryRotationBatch, selectHistoryRotationBatch } from "./history-rotation-batch.js";
import { revalidateHistoryRotation } from "./history-rotation-revalidation.js";
import { createRuntimeRegistrySnapshot } from "./registry.js";

const categories = [
  ["messageIds", "messages"], ["invocationIds", "invocations"], ["flightIds", "flights"],
  ["deliveryIds", "deliveries"], ["deliveryAttemptIds", "deliveryAttempts"],
  ["collaborationEventIds", "collaborationEvents"],
] as const;
function emptyRecords(): BrokerJournalVerificationRecords {
  return { messages: [], invocations: [], flights: [], deliveries: [], deliveryAttempts: [], collaborationEvents: [] };
}
function message(id: string, body = "saved context"): MessageRecord {
  return { id, conversationId: "conversation", actorId: "operator", originNodeId: "node",
    class: "agent", body, visibility: "private", policy: "durable", createdAt: 1 };
}
function chain(id: string): BrokerJournalVerificationRecords {
  return {
    messages: [message(`m-${id}`)],
    invocations: [{ id: `i-${id}`, messageId: `m-${id}`, requesterId: "operator", targetAgentId: "agent",
      action: "execute", task: "saved work", ensureAwake: true, stream: true, createdAt: 1,
      context: { nested: ["original context", id] } }],
    flights: [{ id: `f-${id}`, invocationId: `i-${id}`, requesterId: "operator", targetAgentId: "agent",
      state: "completed", startedAt: 1, completedAt: 2, output: "saved answer" }],
    deliveries: [{ id: `d-${id}`, invocationId: `i-${id}`, messageId: `m-${id}`, targetId: "agent",
      targetKind: "agent", transport: "local_socket", reason: "direct_message", policy: "best_effort", status: "completed" }],
    deliveryAttempts: [{ id: `a-${id}`, deliveryId: `d-${id}`, attempt: 1, status: "acknowledged", createdAt: 2 }],
    collaborationEvents: [],
  };
}
function planFor(records: BrokerJournalVerificationRecords): HistoryRotationPlan {
  const plan = emptyHistoryRotationPlan();
  for (const [key, captureKey] of categories) for (const record of records[captureKey]) plan[key].add(record.id);
  return plan;
}
function merge(...inputs: BrokerJournalVerificationRecords[]): BrokerJournalVerificationRecords {
  return Object.fromEntries(categories.map(([, key]) => [key, inputs.flatMap(input => input[key])])) as BrokerJournalVerificationRecords;
}
function capture(records: BrokerJournalVerificationRecords, plan: HistoryRotationPlan): BrokerJournalVerificationRecords {
  return Object.fromEntries(categories.map(([key, field]) => [field, records[field].filter(record => plan[key].has(record.id))])) as BrokerJournalVerificationRecords;
}
function count(plan: HistoryRotationPlan): number {
  return categories.reduce((sum, [key]) => sum + plan[key].size, 0);
}
function subtract(plan: HistoryRotationPlan, selected: HistoryRotationPlan): void {
  for (const [key] of categories) for (const id of selected[key]) plan[key].delete(id);
}
function globalPlan(records: BrokerJournalVerificationRecords): HistoryRotationPlan {
  const snapshot = createRuntimeRegistrySnapshot({
    messages: Object.fromEntries(records.messages.map(record => [record.id, record])),
    invocations: Object.fromEntries(records.invocations.map(record => [record.id, record])),
    flights: Object.fromEntries(records.flights.map(record => [record.id, record])),
  });
  return planHistoryRotation(snapshot, 50, records);
}
function closeVerified(selected: HistoryRotationPlan, present: HistoryRotationPlan, records: BrokerJournalVerificationRecords) {
  const constrained = constrainHistoryRotationBatch(present, globalPlan(records), capture(records, globalPlan(records)));
  const missing = emptyHistoryRotationPlan();
  for (const [key] of categories) for (const id of selected[key]) if (!constrained[key].has(id)) missing[key].add(id);
  return refineVerifiedRotation(constrained, missing, {
    invocation: id => records.invocations.find(record => record.id === id),
    flight: id => records.flights.find(record => record.id === id),
    delivery: id => records.deliveries.find(record => record.id === id),
    deliveryAttempt: id => records.deliveryAttempts.find(record => record.id === id),
  });
}
function drain(original: BrokerJournalVerificationRecords, maxRecords = 250) {
  let working = structuredClone(original);
  const historical = new Map<string, unknown>();
  let cursor: string | null = null;
  let pages = 0;
  for (; pages < 100; pages++) {
    const eligible = globalPlan(working);
    if (!count(eligible)) break;
    const selected = selectHistoryRotationBatch(eligible, capture(working, eligible), { cursor, maxRecords });
    cursor = selected.cursor;
    expect(selected.selectedRecords).toBeLessThanOrEqual(maxRecords);
    expect(selected.pressure.count).toBe(0);
    const archived = capture(working, selected.plan);
    // Model complete immutable publication, then use the real revalidation and
    // selected closure. Actual SQL/worker relocation is covered separately.
    for (const [key, field] of categories) for (const record of archived[field]) historical.set(`${key}:${record.id}`, structuredClone(record));
    const verified = revalidateHistoryRotation(selected.plan, selected.plan, globalPlan(working), archived, capture(working, selected.plan));
    const safe = closeVerified(selected.plan, verified.present, working).evictable;
    expect(safe).toEqual(selected.plan);
    working = Object.fromEntries(categories.map(([key, field]) => [field, working[field].filter(record => !safe[key].has(record.id))])) as BrokerJournalVerificationRecords;
  }
  expect(pages).toBeLessThan(100);
  // Every original ID resolves to the exact original context, hot or cold.
  for (const [key, field] of categories) for (const record of original[field]) {
    expect(working[field].find(value => value.id === record.id) ?? historical.get(`${key}:${record.id}`)).toEqual(record);
  }
  return { working, historical, pages };
}

describe("bounded incremental history rotation batches", () => {
  test("a connected 1000-invocation reply chain drains across bounded pages without losing context", () => {
    const pieces = Array.from({ length: 1000 }, (_, i) => chain(String(i).padStart(4, "0")));
    for (let i = 1; i < pieces.length; i++) Object.assign(pieces[i]!.invocations[0]!, { replyToMessageId: pieces[i - 1]!.messages[0]!.id });
    const records = merge(...pieces);
    const result = drain(records);
    expect(count(planFor(result.working))).toBe(0);
    expect(result.historical.size).toBe(5000);
    expect(result.pages).toBeGreaterThan(1);
  });

  test("one invocation with over 250 flights and one delivery with over 250 attempts make progress", () => {
    const records = chain("large");
    for (let i = 1; i < 1000; i++) {
      records.flights.push({ ...records.flights[0]!, id: `flight-${i}`, output: `answer-${i}` });
      records.deliveryAttempts.push({ ...records.deliveryAttempts[0]!, id: `attempt-${i}`, attempt: i + 1 });
    }
    const result = drain(records);
    expect(count(planFor(result.working))).toBe(0);
    expect(result.historical.size).toBe(2003);
  });

  test("a delivery retires before its only eligible referent when the other message is protected by age", () => {
    const records = chain("fresh-message");
    records.messages[0]!.createdAt = 100;
    const result = drain(records, 1);
    expect(result.working.messages).toEqual(records.messages);
    expect(result.working.deliveries).toEqual([]);
    expect(result.working.invocations).toEqual([]);
    expect(result.historical.size).toBe(4);
  });

  test("a failed invocation publication cannot let a cursor remove its last flight", () => {
    const records = chain("retry"); records.messages = []; records.deliveries = []; records.deliveryAttempts = [];
    const eligible = globalPlan(records);
    const first = selectHistoryRotationBatch(eligible, records, { maxRecords: 1 });
    expect([...first.plan.invocationIds]).toEqual(["i-retry"]);
    // Nothing is removed: publishing the first page failed.
    const second = selectHistoryRotationBatch(eligible, records, { maxRecords: 1, cursor: first.cursor });
    expect(second.plan.flightIds.size).toBe(0);
    expect([...second.plan.invocationIds]).toEqual(["i-retry"]);
  });

  test("failure of a selected publication preserves its selected dependents and terminal evidence", () => {
    const records = chain("failure");
    const selected = selectHistoryRotationBatch(globalPlan(records), records).plan;
    const present = planFor(records); present.invocationIds.clear();
    const refined = closeVerified(selected, present, records);
    expect(count(refined.evictable)).toBe(0);
    expect(refined.retained).toEqual(selected);
  });

  test("late activation after publication retains the selected context and lifecycle", () => {
    const records = chain("active");
    const selected = selectHistoryRotationBatch(globalPlan(records), records).plan;
    const prepared = structuredClone(records);
    records.flights[0]!.state = "running";
    const current = globalPlan(records);
    const verified = revalidateHistoryRotation(selected, selected, current, prepared, capture(records, selected));
    expect(count(closeVerified(selected, verified.present, records).evictable)).toBe(0);
  });

  test("a late unselected attempt protects delivery and all selected parents inside the writer", () => {
    const records = chain("late-attempt");
    const selected = selectHistoryRotationBatch(globalPlan(records), records).plan;
    records.deliveryAttempts.push({ ...records.deliveryAttempts[0]!, id: "late", attempt: 2 });
    const constrained = constrainHistoryRotationBatch(selected, globalPlan(records), records);
    expect(constrained.deliveryAttemptIds).toEqual(selected.deliveryAttemptIds);
    expect(count(constrained)).toBe(1);
    expect(count(closeVerified(selected, selected, records).evictable)).toBe(0);
  });

  test("a reappeared invocation protects a previously orphaned selected flight", () => {
    const records = chain("reappeared");
    const invocation = records.invocations.pop()!;
    records.messages = []; records.deliveries = []; records.deliveryAttempts = [];
    const selected = selectHistoryRotationBatch(globalPlan(records), records).plan;
    expect(count(selected)).toBe(1);
    records.invocations.push(invocation);
    expect(count(constrainHistoryRotationBatch(selected, globalPlan(records), records))).toBe(0);
  });

  test("individual oversized records stay safe while independent records progress", () => {
    const records = emptyRecords();
    records.messages.push(message("a", "界".repeat(100)), message("b", "tiny"));
    const encoded = JSON.stringify(records.messages[0]);
    const result = selectHistoryRotationBatch(planFor(records), records, { maxBytes: encoded.length + 1 });
    expect(result.plan.messageIds).toEqual(new Set(["b"]));
    expect(result.pressure.samples[0]).toMatchObject({ reason: "record_bytes_limit", recordId: "a" });
    expect(result.pressure.samples[0]!.estimatedBytes).toBe(Buffer.byteLength(encoded) + 1);
  });

  test("same IDs in different categories remain independent and noncandidate parents need no removal", () => {
    const records = chain("external");
    records.invocations[0]!.id = "same"; records.invocations[0]!.messageId = "retained-message";
    records.flights[0]!.invocationId = "same"; records.deliveries = []; records.deliveryAttempts = [];
    records.messages = [message("same")];
    const first = selectHistoryRotationBatch(planFor(records), records, { maxRecords: 2 });
    expect(first.plan.invocationIds).toEqual(new Set(["same"]));
    expect(first.plan.flightIds).toEqual(new Set(["f-external"]));
    expect(first.plan.messageIds.size).toBe(0);
    const second = selectHistoryRotationBatch(planFor(records), records, { maxRecords: 1, cursor: first.cursor });
    expect(second.plan.messageIds).toEqual(new Set(["same"]));
  });

  test("missing and duplicate captures retain uncertain records and dependents rather than guessing links", () => {
    const records = chain("missing"); const eligible = planFor(records);
    records.invocations = [];
    const result = selectHistoryRotationBatch(eligible, records);
    expect(result.plan.invocationIds.size).toBe(0);
    expect(result.plan.flightIds.size).toBe(0);
    expect(result.plan.deliveryAttemptIds).toEqual(new Set(["a-missing"]));
    expect(result.pressure.samples[0]).toMatchObject({ reason: "missing_record_capture", recordId: "i-missing" });
    const constrained = constrainHistoryRotationBatch(eligible, eligible, records);
    expect(constrained.invocationIds.size).toBe(0);
    expect(constrained.flightIds.size).toBe(0);
    const duplicate = chain("duplicate"); duplicate.messages.push(duplicate.messages[0]!);
    expect(selectHistoryRotationBatch(planFor(duplicate), duplicate).pressure.samples[0]!.reason).toBe("duplicate_record_capture");
  });

  test("an unrelated missing invocation capture cannot prevent a complete valid history chain from draining", () => {
    const records = merge(chain("bad"), chain("good"));
    const eligible = planFor(records);
    records.invocations = records.invocations.filter(record => record.id !== "i-bad");
    const drained = emptyHistoryRotationPlan();
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const batch = selectHistoryRotationBatch(eligible, records, { cursor, maxRecords: 2 });
      cursor = batch.cursor;
      const safe = constrainHistoryRotationBatch(batch.plan, eligible, records);
      expect(count(safe)).toBeLessThanOrEqual(2);
      for (const [key, field] of categories) {
        for (const id of safe[key]) drained[key].add(id);
        records[field] = records[field].filter(record => !safe[key].has(record.id)) as never;
      }
      subtract(eligible, safe);
    }
    for (const [key] of categories) for (const id of planFor(chain("good"))[key]) expect(drained[key].has(id)).toBe(true);
    expect(drained.invocationIds.has("i-bad")).toBe(false);
    expect(drained.flightIds.has("f-bad")).toBe(false);
  });

  test("duplicate child captures protect the union of known parents while unrelated history advances", () => {
    const records = merge(chain("bad"), chain("other"), chain("good"));
    records.deliveries.push({ ...records.deliveries[0]!, invocationId: "i-other", messageId: "m-other" });
    const eligible = planFor(records);
    const selected = selectHistoryRotationBatch(eligible, records);
    const safe = constrainHistoryRotationBatch(eligible, eligible, records);
    for (const plan of [selected.plan, safe]) {
      expect(plan.deliveryIds.has("d-bad")).toBe(false);
      expect(plan.invocationIds).toEqual(new Set(["i-good"]));
      expect(plan.flightIds).toEqual(new Set(["f-good"]));
      expect(plan.messageIds).toEqual(new Set(["m-good"]));
    }
    expect(selected.pressure.count).toBe(1);
  });

  test.each(["deliveryIds", "deliveryAttemptIds"] as const)("a missing %s capture protects potential parent categories, not independent history", key => {
    const records = merge(chain("bad"), chain("independent"));
    records.deliveries = records.deliveries.filter(record => record.id !== "d-independent");
    records.deliveryAttempts = records.deliveryAttempts.filter(record => record.id !== "a-independent");
    records.collaborationEvents = [{ id: "event", collaborationId: "collab", event: "fixture", actorId: "operator", createdAt: 1 } as never];
    const eligible = planFor(records);
    if (key === "deliveryIds") records.deliveries = [];
    else records.deliveryAttempts = [];
    for (const plan of [selectHistoryRotationBatch(eligible, records).plan, constrainHistoryRotationBatch(eligible, eligible, records)]) {
      expect(plan.collaborationEventIds.has("event")).toBe(true);
      expect(plan.invocationIds.has("i-bad")).toBe(false);
      expect(plan.messageIds.has("m-bad")).toBe(false);
      if (key === "deliveryAttemptIds") expect(plan.invocationIds.has("i-independent")).toBe(true);
      else expect(plan.deliveryAttemptIds.has("a-bad")).toBe(true);
    }
  });

  test("unserializable records are retained without holding independent records", () => {
    const records = emptyRecords(); records.messages = [message("a"), message("b")];
    Object.assign(records.messages[0]!, { metadata: { bad: 1n } });
    const result = selectHistoryRotationBatch(planFor(records), records);
    expect(result.plan.messageIds).toEqual(new Set(["b"]));
    expect(result.pressure.samples[0]!.reason).toBe("unserializable_record");
  });

  test("bounded scanning and diagnostics advance beyond an oversized prefix", () => {
    const records = emptyRecords();
    for (let i = 0; i < 20; i++) records.messages.push(message(`a-${String(i).padStart(2, "0")}`, "x".repeat(500)));
    records.messages.push(message("z", "small"));
    let cursor: string | null = null; let reached = false;
    for (let i = 0; i < 5; i++) {
      const result = selectHistoryRotationBatch(planFor(records), records, {
        cursor, maxBytes: 400, maxRecordsScanned: 5, maxPressureSamples: 2,
      });
      expect(result.scannedRecords).toBeLessThanOrEqual(5);
      expect(result.pressure.samples.length).toBeLessThanOrEqual(2);
      cursor = result.cursor; reached ||= result.plan.messageIds.has("z");
    }
    expect(reached).toBe(true);
  });

  test("cursor survives removal and newly inserted prefixes cannot starve older suffixes", () => {
    const records = emptyRecords(); records.messages = [message("b"), message("c")];
    const eligible = planFor(records);
    const first = selectHistoryRotationBatch(eligible, records, { maxRecords: 1 });
    subtract(eligible, first.plan); records.messages.push(message("a")); eligible.messageIds.add("a");
    const second = selectHistoryRotationBatch(eligible, records, { maxRecords: 1, cursor: first.cursor });
    expect(second.plan.messageIds).toEqual(new Set(["c"]));
    subtract(eligible, second.plan);
    expect(selectHistoryRotationBatch(eligible, records, { maxRecords: 1, cursor: second.cursor }).plan.messageIds).toEqual(new Set(["a"]));
  });

  test("collaboration events drain in bounded independent pages", () => {
    const records = emptyRecords();
    for (let i = 0; i < 600; i++) records.collaborationEvents.push({ id: `event-${i}`, recordId: "work",
      recordKind: "work_item", kind: "progressed", actorId: "operator", at: 1 });
    const result = drain(records);
    expect(result.pages).toBe(3); expect(result.historical.size).toBe(600);
  });

  test("invalid budgets reject before selection", () => {
    const records = emptyRecords();
    for (const options of [{ maxRecords: 0 }, { maxBytes: Infinity }, { maxRecordsScanned: -1 }, { maxPressureSamples: -1 }]) {
      expect(() => selectHistoryRotationBatch(planFor(records), records, options)).toThrow();
    }
    expect(selectHistoryRotationBatch(planFor(records), records).plan).toEqual(emptyHistoryRotationPlan());
  });
});
