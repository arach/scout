import { expect, test } from "bun:test";
import { revalidateHistoryRotation } from "./history-rotation-revalidation.js";
import { emptyHistoryRotationPlan } from "./history-rotation.js";
import type { BrokerJournalVerificationRecords } from "./broker-journal.js";

function records(): BrokerJournalVerificationRecords {
  return { messages: [], invocations: [], flights: [], deliveries: [], deliveryAttempts: [], collaborationEvents: [] };
}
test("post-verification changes and newly live dependencies cannot be evicted", () => {
  const plan = emptyHistoryRotationPlan(); plan.messageIds = new Set(["unchanged", "changed", "protected", "missing"]);
  const prepared = records(); prepared.messages = [...plan.messageIds].map(id => ({ id, body: "full original context" })) as never;
  const current = structuredClone(prepared); current.messages[1].body = "new context";
  current.messages.pop();
  const eligible = { ...plan, messageIds: new Set(["unchanged", "changed", "missing"]) };
  const result = revalidateHistoryRotation(plan, plan, eligible, prepared, current);
  expect([...result.present.messageIds]).toEqual(["unchanged"]);
  expect([...result.missing.messageIds]).toEqual(["changed", "protected", "missing"]);
});
test("storage coverage is required even for unchanged eligible records", () => {
  const plan = emptyHistoryRotationPlan(); plan.flightIds.add("flight");
  const expected = records(); expected.flights = [{ id: "flight", state: "completed", output: { text: "context" } }] as never;
  expect(revalidateHistoryRotation(plan, emptyHistoryRotationPlan(), plan, expected, expected).missing.flightIds.has("flight")).toBe(true);
});
