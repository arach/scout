/**
 * Claims on the native work record. DRAFT: types and pure decisions only; the
 * runtime does not call these yet. See docs/plans/interconnection-architecture.md.
 *
 * A claim is a field of the work item, not a side table and not a lock beside
 * the lifecycle. The runtime changes it only inside a lifecycle move, under its
 * single writer, as a compare-and-set:
 *
 * - `open` items hold no claim. Claiming one moves it to `working`.
 * - In `working`, the claim's lease is active. The holder renews it, or it
 *   expires and the item is ready again (reclaimable).
 * - In `waiting` and `review`, the next move belongs to someone else, so the
 *   lease is parked: the holder keeps the item and nothing expires. Moving back
 *   to `working` re-arms the lease for the same holder.
 * - `done` and `cancelled` items hold no claim. Releasing returns an item to
 *   `open`.
 *
 * The holder is the delegate who does the work. It becomes `nextMoveOwnerId`.
 * It does not replace `ownerId`, the accountable person, unless the item has no
 * owner yet. This is Linear's split: a human stays the assignee and the agent
 * is the delegate.
 *
 * `generation` fences one attempt. The item's `claimGeneration` counts every
 * claim ever granted and survives release, so a write that carries an old
 * generation is refused after a reclaim. A retry is a new claim (and a new
 * invocation) on the same item; backoff is `deferUntil`.
 */
import type {
  CollaborationEventKind,
  CollaborationRelationKind,
  WorkItemRecord,
  WorkItemState,
} from "./collaboration.js";
import type { ScoutId } from "./common.js";

export const WORK_CLAIM_DEFAULT_LEASE_MS = 15 * 60 * 1000;
export const WORK_CLAIM_MIN_LEASE_MS = 10 * 1000;
export const WORK_CLAIM_MAX_LEASE_MS = 24 * 60 * 60 * 1000;

/** How the claim arose. Tracker delegations and runner claims use the same field. */
export type WorkClaimSource = "native" | "tracker_delegation" | "issue_runner" | "handoff";

/** `active` ticks toward expiry; `parked` holds the item while another actor owns the next move. */
export type WorkLeaseMode = "active" | "parked";

export interface WorkClaim {
  /** The delegate doing the work. The runtime mirrors it into `nextMoveOwnerId` while `working`. */
  holderId: ScoutId;
  /** The session the claim came from, so follow-ups and review feedback route back to it first. */
  sessionAddress?: string;
  /** The flight carrying this attempt, once one is planned. */
  flightId?: ScoutId;
  generation: number;
  source: WorkClaimSource;
  claimedAt: number;
  renewedAt: number;
  leaseMs: number;
  lease: WorkLeaseMode;
  /** Present only while `lease` is `active`. */
  leaseExpiresAt?: number;
  /** Present only while `lease` is `parked`. */
  parkedAt?: number;
}

export type WorkClaimAction = "claim" | "renew" | "release" | "handoff" | "expire";

export interface WorkClaimRequest {
  workId: ScoutId;
  action: WorkClaimAction;
  actorId: ScoutId;
  sessionAddress?: string;
  flightId?: ScoutId;
  source?: WorkClaimSource;
  leaseMs?: number;
  /** Required by `renew`, `release` and `handoff` from the holder. */
  generation?: number;
  /** Compare-and-set on the whole record. */
  expectedRevision?: number;
  /** `handoff` only: the next holder. */
  toHolderId?: ScoutId;
  /** Operator override: release or hand off an active claim the actor does not hold. */
  force?: boolean;
}

export type WorkClaimConflictCode =
  | "work_claim_held"
  | "work_claim_not_held"
  | "work_claim_stale_generation"
  | "work_claim_closed"
  | "work_claim_parked"
  | "work_claim_not_expired"
  | "work_revision_mismatch";

/** The body of a 409. It names the holder and what the caller can do next. */
export interface WorkClaimConflict {
  code: WorkClaimConflictCode;
  workId: ScoutId;
  holder?: WorkClaim;
  retryAfterMs?: number;
  hint: string;
}

/** The patch a granted claim action applies to the item, in the same write as its ledger event. */
export interface WorkClaimPatch {
  state: WorkItemState;
  claim: WorkClaim | null;
  claimGeneration: number;
  nextMoveOwnerId: ScoutId;
  ownerId?: ScoutId;
  /** `null` when the action records no ledger event (a renewal). */
  event: CollaborationEventKind | null;
}

export type WorkClaimDecision =
  | { ok: true; patch: WorkClaimPatch }
  | { ok: false; conflict: WorkClaimConflict };

export type WorkClaimSubject = Pick<
  WorkItemRecord,
  "id" | "state" | "ownerId" | "nextMoveOwnerId" | "requestedById" | "responsiblePrincipalId" | "claim" | "claimGeneration" | "revision"
>;

export function clampWorkClaimLeaseMs(leaseMs: number | undefined): number {
  if (typeof leaseMs !== "number" || !Number.isFinite(leaseMs)) return WORK_CLAIM_DEFAULT_LEASE_MS;
  return Math.min(Math.max(Math.round(leaseMs), WORK_CLAIM_MIN_LEASE_MS), WORK_CLAIM_MAX_LEASE_MS);
}

export type WorkClaimStatus = "unclaimed" | "active" | "parked" | "expired";

export function workClaimStatus(claim: WorkClaim | null | undefined, now: number): WorkClaimStatus {
  if (!claim) return "unclaimed";
  if (claim.lease === "parked") return "parked";
  return (claim.leaseExpiresAt ?? 0) > now ? "active" : "expired";
}

function isTerminal(state: WorkItemState): boolean {
  return state === "done" || state === "cancelled";
}

function conflict(code: WorkClaimConflictCode, item: WorkClaimSubject, hint: string, now: number): WorkClaimDecision {
  const holder = item.claim ?? undefined;
  const retryAfterMs = holder?.lease === "active" && holder.leaseExpiresAt
    ? Math.max(0, holder.leaseExpiresAt - now)
    : undefined;
  return { ok: false, conflict: { code, workId: item.id, holder, retryAfterMs, hint } };
}

function activeClaim(base: Omit<WorkClaim, "lease" | "leaseExpiresAt" | "parkedAt">, now: number): WorkClaim {
  return { ...base, lease: "active", leaseExpiresAt: now + base.leaseMs };
}

/**
 * Decide one claim action against the item as the writer holds it. Pure: the
 * runtime applies the patch and its event in one durable write, or returns the
 * conflict as a 409. Parking and re-arming on other moves use
 * {@link workClaimForMove}.
 */
export function decideWorkClaim(item: WorkClaimSubject, request: WorkClaimRequest, now: number): WorkClaimDecision {
  if (request.expectedRevision !== undefined && request.expectedRevision !== (item.revision ?? 0)) {
    return conflict("work_revision_mismatch", item, "Re-read the item and retry against its current revision.", now);
  }
  if (isTerminal(item.state)) {
    return conflict("work_claim_closed", item, "The item is closed. Reopen it before claiming.", now);
  }
  const status = workClaimStatus(item.claim, now);
  const held = item.claim ?? null;
  const generation = item.claimGeneration ?? held?.generation ?? 0;
  const isHolder = held?.holderId === request.actorId;
  const generationMatches = request.generation === undefined || request.generation === held?.generation;

  switch (request.action) {
    case "claim": {
      if (status === "parked") {
        return conflict("work_claim_parked", item, "The holder is waiting on another actor. Ask the holder or the next move owner.", now);
      }
      if (status === "active" && !isHolder) {
        return conflict("work_claim_held", item, "Another actor holds this item. Wait for the lease to lapse or ask the holder to hand it off.", now);
      }
      if (status === "active" && isHolder && held) {
        // Re-claim by the holder renews the lease and records no event.
        const claim = activeClaim({ ...held, renewedAt: now, leaseMs: clampWorkClaimLeaseMs(request.leaseMs ?? held.leaseMs) }, now);
        return { ok: true, patch: { state: "working", claim, claimGeneration: generation, nextMoveOwnerId: claim.holderId, event: null } };
      }
      const next = generation + 1;
      const claim = activeClaim({
        holderId: request.actorId,
        sessionAddress: request.sessionAddress,
        flightId: request.flightId,
        generation: next,
        source: request.source ?? "native",
        claimedAt: now,
        renewedAt: now,
        leaseMs: clampWorkClaimLeaseMs(request.leaseMs),
      }, now);
      return {
        ok: true,
        patch: {
          state: "working",
          claim,
          claimGeneration: next,
          nextMoveOwnerId: claim.holderId,
          ownerId: item.ownerId ?? item.responsiblePrincipalId ?? item.requestedById ?? request.actorId,
          event: status === "expired" ? "reclaimed" : "claimed",
        },
      };
    }
    case "renew": {
      if (!held || !isHolder) return conflict("work_claim_not_held", item, "Only the holder can renew. Claim the item instead.", now);
      if (!generationMatches) return conflict("work_claim_stale_generation", item, "The item was reclaimed. Stop this attempt.", now);
      if (held.lease === "parked") return conflict("work_claim_parked", item, "A parked claim does not expire. Move the item back to working to re-arm it.", now);
      const claim = activeClaim({ ...held, renewedAt: now, leaseMs: clampWorkClaimLeaseMs(request.leaseMs ?? held.leaseMs) }, now);
      return { ok: true, patch: { state: item.state, claim, claimGeneration: generation, nextMoveOwnerId: claim.holderId, event: null } };
    }
    case "release": {
      if (!held) return conflict("work_claim_not_held", item, "The item holds no claim.", now);
      const mayRelease = (isHolder && generationMatches) || status === "expired" || request.force === true;
      if (!mayRelease) {
        return conflict(isHolder ? "work_claim_stale_generation" : "work_claim_held", item, "Only the holder or the operator can release an active claim.", now);
      }
      return {
        ok: true,
        patch: { state: "open", claim: null, claimGeneration: generation, nextMoveOwnerId: item.ownerId ?? held.holderId, event: "released" },
      };
    }
    case "handoff": {
      if (!request.toHolderId) return conflict("work_claim_not_held", item, "A handoff names the next holder.", now);
      if (!held || !((isHolder && generationMatches) || request.force === true)) {
        return conflict("work_claim_not_held", item, "Only the holder or the operator can hand off a claim.", now);
      }
      const next = generation + 1;
      const base = {
        holderId: request.toHolderId,
        generation: next,
        source: "handoff" as const,
        claimedAt: now,
        renewedAt: now,
        leaseMs: clampWorkClaimLeaseMs(request.leaseMs ?? held.leaseMs),
      };
      const claim: WorkClaim = held.lease === "parked"
        ? { ...base, lease: "parked", parkedAt: now }
        : activeClaim(base, now);
      const nextMoveOwnerId = item.state === "working" ? claim.holderId : (item.nextMoveOwnerId ?? claim.holderId);
      return { ok: true, patch: { state: item.state, claim, claimGeneration: next, nextMoveOwnerId, event: "handoff" } };
    }
    case "expire": {
      if (status !== "expired" || !held) return conflict("work_claim_not_expired", item, "The lease is still active or parked.", now);
      return {
        ok: true,
        patch: { state: "open", claim: null, claimGeneration: generation, nextMoveOwnerId: item.ownerId ?? held.holderId, event: "lease_expired" },
      };
    }
  }
}

/**
 * The claim after a lifecycle move that is not itself a claim action. Moving
 * into `waiting` or `review` parks the lease, moving back to `working` re-arms
 * it, and closing or reopening to `open` clears it. Only the holder re-arms.
 */
export function workClaimForMove(
  claim: WorkClaim | null | undefined,
  toState: WorkItemState,
  moverId: ScoutId,
  now: number,
): { claim: WorkClaim | null } | { conflict: WorkClaimConflictCode } {
  if (!claim) return { claim: null };
  switch (toState) {
    case "open":
    case "done":
    case "cancelled":
      return { claim: null };
    case "waiting":
    case "review": {
      const { leaseExpiresAt: _expiresAt, ...rest } = claim;
      return { claim: { ...rest, lease: "parked", parkedAt: claim.parkedAt ?? now } };
    }
    case "working": {
      if (claim.lease === "active") return { claim };
      if (claim.holderId !== moverId) return { conflict: "work_claim_held" };
      const { parkedAt: _parkedAt, ...rest } = claim;
      return { claim: { ...rest, lease: "active", renewedAt: now, leaseExpiresAt: now + claim.leaseMs } };
    }
  }
}

/** A claim field that contradicts the item's state is a validation error. */
export function validateWorkClaimPlacement(state: WorkItemState, claim: WorkClaim | null | undefined): string[] {
  if (!claim) return [];
  const errors: string[] = [];
  if (state === "open" || isTerminal(state)) errors.push(`${state} work items hold no claim`);
  if (state === "working" && claim.lease !== "active") errors.push("a working item's claim must have an active lease");
  if ((state === "waiting" || state === "review") && claim.lease !== "parked") errors.push(`a ${state} item's claim must be parked`);
  if (claim.lease === "active" && claim.leaseExpiresAt === undefined) errors.push("an active lease needs leaseExpiresAt");
  if (claim.lease === "parked" && claim.parkedAt === undefined) errors.push("a parked lease needs parkedAt");
  if (!Number.isInteger(claim.generation) || claim.generation < 1) errors.push("claim generation must be a positive integer");
  return errors;
}

// ---------------------------------------------------------------------------
// Readiness: the ready queue is a computed view, not a state.

/** Relations that hold readiness. The rest record provenance and never block. */
export const BLOCKING_RELATION_KINDS: readonly CollaborationRelationKind[] = ["blocks", "depends_on"];

export type WorkNotReadyReason = "not_open" | "claimed" | "parked" | "deferred" | "blocked" | "foreign_delegate";

export interface WorkReadinessInput {
  item: Pick<WorkItemRecord, "state" | "claim" | "deferUntil">;
  /**
   * Items that must settle first, resolved by the runtime: targets of this
   * item's `depends_on`, and items whose `blocks` relation targets this item.
   */
  blockers: Array<{ id: ScoutId; state: WorkItemState }>;
  /** An active ticket link observes the tracker delegating this item to an agent that is not Scout. */
  foreignDelegate?: boolean;
  now: number;
}

export interface WorkReadiness {
  ready: boolean;
  /** True when the item is ready because a working claim's lease lapsed. */
  reclaimable: boolean;
  reasons: WorkNotReadyReason[];
}

/** Open, unblocked, not deferred, unclaimed (or lapsed), and not delegated elsewhere. */
export function workReadiness(input: WorkReadinessInput): WorkReadiness {
  const reasons: WorkNotReadyReason[] = [];
  const status = workClaimStatus(input.item.claim, input.now);
  const reclaimable = input.item.state === "working" && status === "expired";
  if (input.item.state !== "open" && !reclaimable) reasons.push("not_open");
  if (status === "active") reasons.push("claimed");
  if (status === "parked") reasons.push("parked");
  if (input.item.deferUntil !== undefined && input.item.deferUntil > input.now) reasons.push("deferred");
  if (input.blockers.some((b) => !isTerminal(b.state))) reasons.push("blocked");
  if (input.foreignDelegate) reasons.push("foreign_delegate");
  return { ready: reasons.length === 0, reclaimable: reclaimable && reasons.length === 0, reasons };
}
