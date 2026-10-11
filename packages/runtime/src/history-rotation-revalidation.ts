import { isDeepStrictEqual } from "node:util";
import type { BrokerJournalVerificationRecords } from "./broker-journal.js";
import { emptyHistoryRotationPlan, type HistoryRotationPlan } from "./history-rotation.js";

const fields = {
  messageIds: "messages", invocationIds: "invocations", flightIds: "flights",
  deliveryIds: "deliveries", deliveryAttemptIds: "deliveryAttempts", collaborationEventIds: "collaborationEvents",
} as const;

/** Storage verification can run outside the command writer. At commit time,
 * retain every record that changed or gained a live dependency in the interim.
 * The caller then reapplies the dependency closure before publishing eviction.
 */
export function revalidateHistoryRotation(
  plan: HistoryRotationPlan,
  verified: HistoryRotationPlan,
  stillEligible: HistoryRotationPlan,
  prepared: BrokerJournalVerificationRecords,
  current: BrokerJournalVerificationRecords,
): { present: HistoryRotationPlan; missing: HistoryRotationPlan } {
  const present = emptyHistoryRotationPlan(); const missing = emptyHistoryRotationPlan();
  for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
    const field = fields[key];
    const before = new Map<string, unknown>(prepared[field].map(record => [record.id, record]));
    const after = new Map<string, unknown>(current[field].map(record => [record.id, record]));
    for (const id of plan[key]) {
      if (verified[key].has(id) && stillEligible[key].has(id) && before.has(id)
        && after.has(id) && isDeepStrictEqual(before.get(id), after.get(id))) present[key].add(id);
      else missing[key].add(id);
    }
  }
  return { present, missing };
}
