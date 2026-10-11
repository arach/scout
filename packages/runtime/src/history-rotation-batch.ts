import type { BrokerJournalVerificationRecords } from "./broker-journal.js";
import { emptyHistoryRotationPlan, type HistoryRotationPlan } from "./history-rotation.js";

// The order accelerates progress; dependency gates enforce it even after a
// cursor wrap, failed publication, or a concurrent change before the marker.
const categories = [
  ["deliveryAttemptIds", "deliveryAttempts"],
  ["deliveryIds", "deliveries"],
  ["invocationIds", "invocations"],
  ["flightIds", "flights"],
  ["messageIds", "messages"],
  ["collaborationEventIds", "collaborationEvents"],
] as const;
type PlanKey = typeof categories[number][0];
type CapturedRecord = BrokerJournalVerificationRecords[typeof categories[number][1]][number];
type Node = { key: PlanKey; id: string; anchor: string; record?: CapturedRecord; duplicate?: boolean };
const anchorFor = (key: PlanKey, id: string): string => `${categories.findIndex(([candidate]) => candidate === key)}:${key}:${id}`;

export type HistoryRotationBatchOptions = {
  maxRecords?: number;
  /** Budget for captured typed JSON, not the worker's raw SQLite child rows. */
  maxBytes?: number;
  /** Last considered record anchor from the previous call. */
  cursor?: string | null;
  maxRecordsScanned?: number;
  maxPressureSamples?: number;
};
export type HistoryRotationBatchPressure = {
  reason: "missing_record_capture" | "duplicate_record_capture" | "unserializable_record" | "record_bytes_limit";
  recordId: string;
  category: PlanKey;
  estimatedBytes: number;
};
export type HistoryRotationBatch = {
  plan: HistoryRotationPlan;
  /** Keep between runs, including when this batch is empty. */
  cursor: string | null;
  selectedRecords: number;
  estimatedBytes: number;
  scannedRecords: number;
  totalRecords: number;
  pressure: { count: number; samples: HistoryRotationBatchPressure[] };
};

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`);
  return value;
}

function dependencyGraph(eligible: HistoryRotationPlan, captured: BrokerJournalVerificationRecords) {
  const nodes = new Map<string, Node>();
  for (const [key, captureKey] of categories) {
    for (const id of eligible[key]) {
      const anchor = anchorFor(key, id);
      nodes.set(anchor, { key, id, anchor });
    }
    for (const record of captured[captureKey]) {
      const node = nodes.get(anchorFor(key, record.id));
      if (!node) continue;
      if (node.record) node.duplicate = true;
      else node.record = record;
    }
  }
  const prerequisites = new Map<string, Set<string>>();
  const requireFirst = (key: PlanKey, id: string | undefined, beforeKey: PlanKey, beforeId: string): void => {
    if (!id) return;
    const anchor = anchorFor(key, id), before = anchorFor(beforeKey, beforeId);
    if (!nodes.has(anchor) || !nodes.has(before)) return;
    let required = prerequisites.get(anchor);
    if (!required) prerequisites.set(anchor, required = new Set());
    required.add(before);
  };
  for (const flight of captured.flights) {
    // Removing all terminal evidence while an invocation remains would make
    // that invocation permanently ineligible under the global planner.
    requireFirst("flightIds", flight.id, "invocationIds", flight.invocationId);
  }
  for (const delivery of captured.deliveries) {
    // A delivery can lose eligibility when its only evictable referent leaves
    // but its other referent remains protected. Retire the delivery first.
    requireFirst("invocationIds", delivery.invocationId, "deliveryIds", delivery.id);
    requireFirst("messageIds", delivery.messageId, "deliveryIds", delivery.id);
  }
  for (const attempt of captured.deliveryAttempts) {
    // Otherwise the SQL FK retains a delivery after its journal marker, and
    // ordinary candidate scans can never return to physically drain it.
    requireFirst("deliveryIds", attempt.deliveryId, "deliveryAttemptIds", attempt.id);
  }
  const unavailable = new Set<string>();
  const uncertainParents = new Set<PlanKey>();
  for (const node of nodes.values()) {
    if (!node.record || node.duplicate) unavailable.add(node.anchor);
    // Complete duplicate captures above contribute the union of their links.
    // An absent child has no parent ID to inspect. Protect only categories
    // that could depend on it; independent history may still make progress.
    if (!node.record && node.key === "deliveryAttemptIds") uncertainParents.add("deliveryIds");
    if (!node.record && node.key === "deliveryIds") {
      uncertainParents.add("invocationIds"); uncertainParents.add("messageIds");
    }
  }
  for (const node of nodes.values()) if (uncertainParents.has(node.key)) unavailable.add(node.anchor);
  return { nodes, prerequisites, unavailable };
}

/**
 * Recheck partial-batch prerequisites inside the canonical writer after
 * payload/eligibility revalidation. New attempts or reappeared invocations
 * are unselected dependencies too. This only removes IDs; callers move them
 * to `missing`, then apply refineVerifiedRotation across the selected batch.
 */
export function constrainHistoryRotationBatch(
  selected: HistoryRotationPlan,
  globallyEligible: HistoryRotationPlan,
  captured: BrokerJournalVerificationRecords,
): HistoryRotationPlan {
  const { nodes, prerequisites, unavailable } = dependencyGraph(globallyEligible, captured);
  const safe = emptyHistoryRotationPlan();
  const included = new Set<string>();
  for (const node of nodes.values()) if (selected[node.key].has(node.id) && !unavailable.has(node.anchor)) included.add(node.anchor);
  const dependents = new Map<string, string[]>();
  const remove: string[] = [];
  for (const anchor of included) {
    for (const prerequisite of prerequisites.get(anchor) ?? []) {
      if (!included.has(prerequisite)) remove.push(anchor);
      const list = dependents.get(prerequisite) ?? [];
      list.push(anchor); dependents.set(prerequisite, list);
    }
  }
  while (remove.length) {
    const anchor = remove.pop()!;
    if (!included.delete(anchor)) continue;
    for (const dependent of dependents.get(anchor) ?? []) remove.push(dependent);
  }
  for (const anchor of included) {
    const node = nodes.get(anchor)!;
    safe[node.key].add(node.id);
  }
  return safe;
}

/**
 * Select a bounded page of globally eligible terminal history. Connected
 * groups may span pages: complete immutable historical records and SQL
 * identity anchors preserve their references across tiers. Prerequisites
 * preserve future eligibility and physical cleanup, without requiring an
 * arbitrarily large group to fit a single maintenance turn.
 *
 * Selection is not eviction proof. Publish every selected record, verify its
 * durable payload, revalidate current eligibility/version, constrain the
 * current partial order, then apply selected-record verification closure.
 */
export function selectHistoryRotationBatch(
  eligible: HistoryRotationPlan,
  captured: BrokerJournalVerificationRecords,
  options: HistoryRotationBatchOptions = {},
): HistoryRotationBatch {
  const maxRecords = positiveInteger(options.maxRecords, 250, "maxRecords");
  const maxBytes = positiveInteger(options.maxBytes, 8 * 1024 * 1024, "maxBytes");
  const maxRecordsScanned = positiveInteger(options.maxRecordsScanned, 1_000, "maxRecordsScanned");
  const maxPressureSamples = options.maxPressureSamples ?? 16;
  if (!Number.isSafeInteger(maxPressureSamples) || maxPressureSamples < 0) throw new Error("maxPressureSamples must be a non-negative safe integer");
  const { nodes, prerequisites, unavailable } = dependencyGraph(eligible, captured);
  const result: HistoryRotationBatch = {
    plan: emptyHistoryRotationPlan(), cursor: options.cursor ?? null,
    selectedRecords: 0, estimatedBytes: 0, scannedRecords: 0, totalRecords: nodes.size,
    pressure: { count: 0, samples: [] },
  };
  const recordPressure = (node: Node, reason: HistoryRotationBatchPressure["reason"], estimatedBytes = 0): void => {
    result.pressure.count++;
    if (result.pressure.samples.length < maxPressureSamples) {
      result.pressure.samples.push({ reason, recordId: node.id, category: node.key, estimatedBytes });
    }
  };
  for (const node of nodes.values()) {
    if (!node.record || node.duplicate) recordPressure(node, node.duplicate ? "duplicate_record_capture" : "missing_record_capture");
  }
  const ordered = [...nodes.values()].sort((a, b) => a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0);
  if (!ordered.length) return result;
  const nextIndex = options.cursor ? ordered.findIndex(node => node.anchor > options.cursor!) : 0;
  const start = nextIndex < 0 ? 0 : nextIndex;
  const included = new Set<string>();
  for (let offset = 0; offset < Math.min(ordered.length, maxRecordsScanned); offset++) {
    const node = ordered[(start + offset) % ordered.length]!;
    const ready = !unavailable.has(node.anchor)
      && [...(prerequisites.get(node.anchor) ?? [])].every(prerequisite => included.has(prerequisite));
    if (ready) {
      let estimatedBytes = 0;
      let reason: HistoryRotationBatchPressure["reason"] | undefined;
      try {
        const encoded = JSON.stringify(node.record);
        if (encoded === undefined) throw new Error("Record cannot be represented as JSON");
        estimatedBytes = Buffer.byteLength(encoded) + 1;
        if (estimatedBytes > maxBytes) reason = "record_bytes_limit";
      } catch { reason = "unserializable_record"; }
      if (reason) recordPressure(node, reason, estimatedBytes);
      else {
        // Leave a record that fits a fresh page at the front of the next run.
        if (result.estimatedBytes + estimatedBytes > maxBytes) break;
        result.plan[node.key].add(node.id); included.add(node.anchor);
        result.selectedRecords++; result.estimatedBytes += estimatedBytes;
      }
    }
    result.scannedRecords++; result.cursor = node.anchor;
    if (result.selectedRecords >= maxRecords) break;
  }
  return result;
}
