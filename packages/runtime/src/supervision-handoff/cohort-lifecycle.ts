import { closeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { refuse, type CohortRetirement, type HandoffInspector, type HandoffOwner, type HandoffRole, type MutationReceipt } from "./contracts.js";
import { policyHash, receiptKey, type CustodyTransaction } from "./store.js";
import type { DirectChildren } from "./child-custody.js";
import type { LifetimeFences } from "./lifetime-fence.js";
import type { EffectExclusionProfile } from "./exclusion-contracts.js";
import { certifyEffectExclusion } from "./effect-exclusion.js";

/** Only the SDK's carrier-only start protocol can be retired this way. This
 * does not settle arbitrary SDK mutation receipts from an external-work claim. */
function carrierStart(receipt: MutationReceipt) {
  return receipt.operation === "start" && !receipt.retirement
    && receipt.effects.every(effect => effect.kind === "start" && effect.carrier === "role-lifetime/3");
}
export function cohortStarts(tx: CustodyTransaction, role: HandoffRole, generation: number) {
  return Object.entries(tx.state.receipts).filter(([key]) => key.startsWith(`${role}:${generation}:`))
    .flatMap(([, receipt]) => receipt.effects.filter(effect => effect.kind === "start"));
}
/** Call under the ledger mutex after readiness/owner checks. No wait for a
 * process or child initialization holds that mutex. Busy remains retryable. */
export async function retireCohort(tx: CustodyTransaction, role: HandoffRole, owner: HandoffOwner, generation: number,
  id: string, signal: "SIGTERM" | "SIGKILL", profile: EffectExclusionProfile, inspector: HandoffInspector,
  fences: LifetimeFences, children: DirectChildren): Promise<CohortRetirement> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) refuse("invalid_request_id");
  if (signal !== "SIGTERM" && signal !== "SIGKILL") refuse("invalid_child_signal");
  const state = tx.state.roles[role], key = receiptKey(role, generation, id);
  let receipt = tx.state.receipts[key];
  const pending = Object.entries(tx.state.receipts).filter(([key, value]) => key.startsWith(`${role}:${generation}:`) && value.state === "pending");
  if (pending.some(([pendingKey, value]) => pendingKey !== key && !carrierStart(value))) refuse("outcome_uncertain");
  if (receipt && (receipt.operation !== "stop" || !receipt.retirement || receipt.retirement.signal !== signal)) refuse("request_id_conflict");
  if (state.retirement && state.retirement.requestId !== id) refuse("cohort_retirement_conflict");
  const hash = policyHash(tx.state.policy);
  if (receipt?.retirement?.policyHash !== undefined && receipt.retirement.policyHash !== hash) refuse("policy_changed");
  const result = (replayed: boolean): CohortRetirement => ({ state: "retired", role, owner, generation, requestId: id,
    replayed, exclusion: structuredClone(receipt!.retirement!.exclusion!) });
  if (receipt?.state === "done") {
    if (!receipt.retirement?.exclusion || state.retirement?.state !== "retired") refuse("cohort_retirement_required");
    return result(true); // A receipt snapshot, never fresh certification.
  }
  if (!receipt) {
    if (Object.keys(tx.state.receipts).length >= 256) refuse("receipt_capacity");
    receipt = tx.state.receipts[key] = { operation: "stop", state: "pending",
      effects: [{ id: randomBytes(16).toString("hex"), kind: "stop", state: "intent" }],
      retirement: { policyHash: hash, signal } };
    state.retirement = { requestId: id, state: "retiring" };
    if (state.phase === "active") state.desired = "stopped"; // A draining handoff preserves the incoming running intent.
    tx.persist(); // Revoke all ordinary effect scopes before signaling or close.
  }
  if (state.retirement?.state !== "retiring") refuse("cohort_retirement_required");
  const starts = cohortStarts(tx, role, generation);
  // There is at most one start intent in a schema-3 generation. Lost birth or
  // handle custody is never repaired by PID adoption or by a second spawn.
  if (starts.length > 1) refuse("cohort_start_conflict");
  const record = starts[0]?.directChild;
  if (record && children.has(record.child)) {
    if (!receipt.retirement!.signalAttempted) {
      receipt.retirement!.signalAttempted = true; receipt.effects[0]!.child = structuredClone(record.child);
      tx.persist(); // A lost acknowledgment never replays a signal syscall.
      receipt.retirement!.signalResult = children.signal(record.child, signal); tx.persist();
    }
    if (!record.exit) {
      try {
        const exit = children.pollExit(record);
        if (exit) { record.exit = exit; tx.persist(); }
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "child_exit_unproven")) throw error;
        // A failed wait is not an exit record. Independent full exclusion may
        // still retire the effects; any actual carrier continues to block below.
      }
    }
  }
  // Closing and opening a new description happen under the same ledger mutex.
  // Other conforming acquirers cannot enter; any surviving carrier stays busy.
  fences.releaseIfHeld(tx, role);
  const fd = fences.acquire(tx, role);
  try {
    const proof = await certifyEffectExclusion(tx, role, fd, profile, inspector);
    for (const [pendingKey, value] of pending) if (pendingKey !== key) {
      for (const effect of value.effects) if (effect.state === "intent") effect.state = "retired";
      value.error = "cohort_retired"; value.state = "done"; // Not a successful start observation.
    }
    receipt.effects[0]!.state = "confirmed"; receipt.retirement!.exclusion = proof;
    receipt.state = "done"; state.retirement.state = "retired"; tx.persist();
    return result(false);
  } finally { closeSync(fd); } // No effect authority remains in this generation.
}
