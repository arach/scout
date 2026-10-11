import { createHash } from "node:crypto";
import { canonicalRecord, type CanonicalRecordContext, type PersistedRotationRecordKind } from "./sqlite-store.js";
import type { HistoryRotationPlan } from "./history-rotation.js";

export type ProjectionVerificationDigest = { kind: PersistedRotationRecordKind; id: string; digest: string };
export const verificationPlanKeys: Record<PersistedRotationRecordKind, keyof HistoryRotationPlan> = {
  message: "messageIds", invocation: "invocationIds", flight: "flightIds", delivery: "deliveryIds",
  deliveryAttempt: "deliveryAttemptIds", collaborationEvent: "collaborationEventIds",
};

/** Identical canonical semantics to field-by-field verification, bounded wire
 * representation even when one accepted record contains a very large body. */
export function projectionVerificationDigest(kind: PersistedRotationRecordKind, record: unknown, context?: CanonicalRecordContext): string {
  const hash = createHash("sha256");
  const visit = (value: unknown): void => {
    if (value === undefined) { hash.update("u;"); return; }
    if (value === null) { hash.update("n;"); return; }
    if (Array.isArray(value)) {
      hash.update("["); for (const item of value) visit(item); hash.update("]"); return;
    }
    if (typeof value === "object") {
      hash.update("{");
      for (const key of Object.keys(value).sort()) {
        hash.update(JSON.stringify(key)); visit((value as Record<string, unknown>)[key]);
      }
      hash.update("}"); return;
    }
    hash.update(`${typeof value}:`);
    hash.update(typeof value === "number" && Object.is(value, -0) ? "-0" : JSON.stringify(value));
    hash.update(";");
  };
  visit(canonicalRecord(kind, record, context));
  return hash.digest("hex");
}
