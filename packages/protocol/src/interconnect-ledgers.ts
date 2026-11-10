/**
 * Runtime-owned ledgers for connected systems. DRAFT: see
 * docs/plans/interconnection-architecture.md.
 *
 * The adapter descriptor declares what a record is (its primary key, cursor
 * field, deletion mode). The runtime owns everything else, here: the
 * connection, inbound event dedup, the records cache with change detection and
 * tombstones, cursors saved in the same write as their effects, sync runs with
 * the mass-delete hold, and the outbound effect ledger with echo markers.
 * Adapters return normalized data and perform writes the runtime asks for.
 * They never write these records.
 */
import type { MetadataMap, ScoutId } from "./common.js";
import type { AdapterKind, ExternalObjectRef, SourceAudience } from "./external-identity.js";
import type { RequestClass } from "./interconnect-policy.js";

export type ExternalErrorCategory =
  | "auth"
  | "rate_limited"
  | "request"
  | "status"
  | "payload"
  | "cursor_invalid"
  | "signature";

export interface ExternalError {
  category: ExternalErrorCategory;
  at: number;
  message?: string;
  retryAfterMs?: number;
}

// ---------------------------------------------------------------------------
// Connection

/**
 * Credentials expiring or an outage changes nothing about ownership: items go
 * stale with `observedAt`. Only `detached` returns field ownership to Scout.
 */
export type ExternalConnectionStatus = "connecting" | "healthy" | "degraded" | "auth_expired" | "paused" | "detached";

/** One installed connection: a Slack team, a Linear organization, a GitHub installation. */
export interface ExternalConnection {
  id: ScoutId;
  adapterId: string;
  /** Pinned descriptor version (`YYYYMMDD_NN`). Upgrades are explicit. */
  descriptorVersion: string;
  instanceId: string;
  enterpriseId?: string;
  displayName: string;
  kinds: AdapterKind[];
  /** A reference to where the secret lives. Never the secret. */
  credential: {
    backend: "secret_cli" | "private_file" | "transport_managed";
    keys: Record<string, string>;
  };
  /** The `ExternalActor` for Scout's own app or bot user. Events it authored are echoes. */
  appActorId?: ScoutId;
  /** The binding unit: which Scout projects and which containers this connection serves. */
  scope: {
    projectIds?: ScoutId[];
    containers?: string[];
  };
  status: ExternalConnectionStatus;
  health: {
    lastEventAt?: number;
    lastReconcileAt?: number;
    lastError?: ExternalError;
    /** For example an unmapped workflow state. Shown, never silently dropped. */
    warnings: string[];
  };
  revision: number;
  detachedAt?: number;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Inbound event ledger

/** An unsigned event is a hint; the runtime confirms it with a read. */
export type ExternalEventVerification = "signed" | "unsigned_hint" | "poll";

/**
 * Addressed means delivery: it can start or continue work. Ambient means
 * observation: it is source material and never routes or instructs.
 */
export type ExternalEventAddressing = "addressed" | "ambient" | "system";

export type ExternalEventDisposition =
  | "received"
  | "applied"
  | "duplicate"
  | "echo"
  | "ignored"
  | "held"
  | "failed";

/**
 * One row per provider event, unique on `(adapterId, instanceId,
 * providerEventId)` for the life of the records it produced. The row is
 * inserted before the transport is acknowledged; the insert is the only work
 * done before the ack.
 */
export interface ExternalEventRecord {
  id: ScoutId;
  connectionId: ScoutId;
  adapterId: string;
  instanceId: string;
  /** Slack `event_id`, `Linear-Delivery`, `X-GitHub-Delivery`, or a poll-synthesized id. */
  providerEventId: string;
  eventType: string;
  verification: ExternalEventVerification;
  addressing: ExternalEventAddressing;
  subject?: ExternalObjectRef;
  authorActorId?: ScoutId;
  receivedAt: number;
  providerTimestamp?: number;
  disposition: ExternalEventDisposition;
  dispositionAt?: number;
  /** Set when the event is Scout's own delivery coming back. */
  echoOfDeliveryId?: ScoutId;
  /** Scout records this event produced or touched. */
  producedRecordIds: ScoutId[];
  payloadHash: string;
  /** Raw payload, kept for a bounded window. */
  raw?: unknown;
  rawExpiresAt?: number;
  error?: ExternalError;
}

// ---------------------------------------------------------------------------
// Records cache

export type ExternalRecordAction = "added" | "updated" | "deleted";

/**
 * The latest normalized copy of one external object. Change detection hashes
 * the normalized payload, minus the descriptor's `hashExclude` paths. Deletes
 * are soft: a tombstone from an event, a flag field, or a sweep after a clean
 * full run.
 */
export interface ExternalRecordState<T extends MetadataMap = MetadataMap> {
  id: ScoutId;
  connectionId: ScoutId;
  stream: string;
  ref: ExternalObjectRef;
  normalized: T;
  payloadHash: string;
  raw?: unknown;
  remoteCreatedAt?: number;
  remoteUpdatedAt?: number;
  /** Provider revision, when the provider has one. */
  revision?: string;
  firstSeenAt: number;
  lastModifiedAt: number;
  lastAction: ExternalRecordAction;
  deletedAt?: number;
  deletionBasis?: "tombstone" | "flag" | "sweep";
  cursor?: string;
  audience: SourceAudience;
  /** `ExternalActor` ids resolved from the descriptor's identity fields. */
  actorIds: ScoutId[];
  /**
   * The same object as seen through another adapter: a Linear comment synced
   * from a Slack message. The normalizer keeps one copy and links both.
   */
  sameAs?: ExternalObjectRef[];
  lastRunId?: ScoutId;
}

// ---------------------------------------------------------------------------
// Cursors and sync runs

export type ExternalSyncMode = "incremental" | "full" | "reconcile" | "event_confirm";

export interface ExternalStreamCursor {
  connectionId: ScoutId;
  stream: string;
  /** Saved in the same write as the effects of the page that produced it. */
  cursor?: string;
  lastRunId?: ScoutId;
  lastCleanFullRunAt?: number;
  updatedAt: number;
}

export type ExternalSyncOutcome = "clean" | "partial" | "failed" | "held";

export interface ExternalSyncRun {
  id: ScoutId;
  connectionId: ScoutId;
  stream: string;
  mode: ExternalSyncMode;
  startedAt: number;
  finishedAt?: number;
  outcome?: ExternalSyncOutcome;
  counts: { added: number; updated: number; deleted: number; unchanged: number };
  cursorBefore?: string;
  cursorAfter?: string;
  /** A full run that would delete too much is held for a person instead of applied. */
  hold?: { reason: "mass_delete"; wouldDelete: number; total: number };
  error?: ExternalError;
}

/** Whether a full run's sweep may apply its deletes. Sweeps run only on clean completion. */
export function sweepAllowed(
  run: Pick<ExternalSyncRun, "mode" | "outcome">,
  wouldDelete: number,
  total: number,
  hold: { ratio: number; minimum: number },
): "apply" | "hold" | "skip" {
  if (run.mode !== "full" || run.outcome !== "clean") return "skip";
  if (wouldDelete >= hold.minimum && total > 0 && wouldDelete / total > hold.ratio) return "hold";
  return "apply";
}

// ---------------------------------------------------------------------------
// Outbound effect ledger

export type ExternalEffectKind =
  | "post"
  | "update"
  | "react"
  | "upload"
  | "unfurl"
  | "comment"
  | "create"
  | "transition"
  | "set_fields"
  | "set_backlink"
  | "attach"
  | "activity"
  | "set_plan"
  | "set_delegate"
  | "open_pull_request";

/**
 * Extends the delivery outbox with `uncertain` (the provider may have applied
 * it: reconcile by marker before any resend), `suppressed` (policy or echo
 * rules stopped it) and `superseded` (a newer revision of the same card).
 */
export type ExternalDeliveryState =
  | "queued"
  | "delivering"
  | "delivered"
  | "uncertain"
  | "suppressed"
  | "superseded"
  | "expired"
  | "undeliverable";

/** Whose credential carried the write. `host` is today's default and must be shown when it differs from the responsible person. */
export type ExternalCredentialMode = "app" | "host" | "personal";

export interface ExternalDelivery {
  id: ScoutId;
  connectionId: ScoutId;
  adapterId: string;
  instanceId: string;
  linkId?: ScoutId;
  destination: { containerId?: string; threadId?: string; object?: ExternalObjectRef };
  effect: ExternalEffectKind;
  /** The Scout message, flight, decision or work item this effect projects. */
  sourceRecordId: ScoutId;
  /** `(linkId or destination, effect, sourceRecordId)`. A retry cannot apply twice. */
  idempotencyKey: string;
  requestClass: RequestClass;
  attribution: {
    agentId?: ScoutId;
    responsiblePrincipalId?: ScoutId;
    /** "<agent> via Scout" display, where the provider supports it (Linear `createAsUser`, Slack `chat:write.customize`). */
    presentAs?: { name: string; iconUrl?: string };
    credentialMode: ExternalCredentialMode;
  };
  /** Carried on the external object (Slack message metadata, a body marker) for echo, loop and uncertain-send reconciliation. */
  marker: { kind: "scout_delivery"; deliveryId: ScoutId; workId?: ScoutId };
  /** Edits to one card are revisions of one delivery. Only the latest queued revision is sent. */
  revision: number;
  supersedesId?: ScoutId;
  state: ExternalDeliveryState;
  providerRef?: { id?: string; ts?: string; url?: string };
  attempts: number;
  nextAttemptAt?: number;
  lastError?: ExternalError;
  createdAt: number;
  updatedAt: number;
}

export function externalDeliveryIdempotencyKey(
  target: { linkId?: ScoutId; destination?: ExternalDelivery["destination"] },
  effect: ExternalEffectKind,
  sourceRecordId: ScoutId,
): string {
  const where = target.linkId
    ?? [target.destination?.containerId, target.destination?.threadId, target.destination?.object?.id].filter(Boolean).join("/");
  return [where, effect, sourceRecordId].map((part) => encodeURIComponent(part ?? "")).join(":");
}

// ---------------------------------------------------------------------------
// Artifact provenance

/** Why an artifact exists and who it was made for. The provider owns its state; Scout owns this receipt. */
export interface ArtifactReceipt {
  id: ScoutId;
  kind: "pull_request" | "commit" | "branch" | "patch" | "document";
  connectionId?: ScoutId;
  ref?: ExternalObjectRef;
  repo?: { id: string; fullName: string; visibility: "public" | "private" | "internal" };
  git?: { number?: number; headRef: string; headSha: string; baseRef?: string };
  producedBy: {
    workId: ScoutId;
    invocationId: ScoutId;
    flightId: ScoutId;
    agentId: ScoutId;
    claimGeneration?: number;
    sessionId?: string;
    harness: string;
    nodeId: ScoutId;
  };
  requestedBy: { principalId?: ScoutId; externalActorId?: ScoutId };
  responsiblePrincipalId?: ScoutId;
  authoredAs: { externalActorId?: ScoutId; login?: string; credentialMode: ExternalCredentialMode | "unknown" };
  /** `(workId, flightId, effect)`: a retry cannot open a second pull request. */
  idempotencyKey: string;
  /** The head sha for git artifacts; a content hash otherwise. */
  contentId: string;
  createdAt: number;
}
