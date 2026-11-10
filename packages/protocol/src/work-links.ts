/**
 * Work links: the edges between Scout's work record and objects in connected
 * systems. DRAFT: see docs/plans/interconnection-architecture.md.
 *
 * One record type replaces two that never met: `ExternalWorkContext` (one
 * read-only observation on the work item) and the issue runner's
 * `IssueBinding` (an unused binding with no field policy). A ticket link keeps
 * `ExternalWorkContext` as its `observed` field, so that contract survives.
 *
 * Native mode is the zero-link case: an item with no active ticket link owns
 * every field. Linear-leaning mode is one ticket link whose field policy gives
 * the ticket fields to Linear. The claim, attempts, plan, waiting state,
 * acceptance and receipts stay Scout's in both modes.
 *
 * Links are Scout-owned. Adapters never write them; the runtime creates and
 * updates them from normalized observations and commands.
 */
import type { CollaborationPriority, CollaborationRelationKind, ExternalWorkContext, WorkItemState } from "./collaboration.js";
import type { ScoutId } from "./common.js";
import { externalObjectKey, type ExternalObjectRef, type SourceAudience } from "./external-identity.js";

export type WorkLinkKind = "ticket" | "thread" | "pull_request" | "commit" | "branch" | "document";

/**
 * `origin`: the request started there. `tracker`: the ticket that tracks the
 * item. `artifact`: Scout produced it. `reference`: it mentions the item.
 */
export type WorkLinkRole = "origin" | "tracker" | "artifact" | "reference";

export type WorkLinkOriginSide = "scout" | "external" | "manual_link";

/**
 * `suggested` links are inferred. They never wake an agent, change state, or
 * widen visibility, and they do not count toward link invariants. Accepting
 * one makes it `pending` or `healthy`. `unlinked` links stay for audit.
 */
export type WorkLinkStatus = "suggested" | "pending" | "healthy" | "conflict" | "error" | "paused" | "unlinked";

export const ACTIVE_WORK_LINK_STATUSES: readonly WorkLinkStatus[] = ["pending", "healthy", "conflict", "error", "paused"];

export function isActiveWorkLink(link: Pick<WorkLinkBase, "status">): boolean {
  return ACTIVE_WORK_LINK_STATUSES.includes(link.status);
}

/** How the link was made, in the order the runtime checks before creating one. */
export type WorkLinkMethod =
  | "created_by_scout"
  | "delegation"
  | "mention"
  | "thread_reply"
  | "backlink_marker"
  | "key_reference"
  | "manual"
  | "inferred";

export interface WorkLinkBase {
  id: ScoutId;
  /** Fixed for the link's life. */
  workId: ScoutId;
  kind: WorkLinkKind;
  connectionId: ScoutId;
  external: ExternalObjectRef;
  role: WorkLinkRole;
  originSide: WorkLinkOriginSide;
  status: WorkLinkStatus;
  audience: SourceAudience;
  linkedBy: {
    method: WorkLinkMethod;
    principalId?: ScoutId;
    agentId?: ScoutId;
    ruleId?: string;
  };
  /** The records-cache row this link's latest observation came from. */
  recordStateId?: ScoutId;
  observedAt: number;
  createdAt: number;
  updatedAt: number;
  unlinkedAt?: number;
}

// ---------------------------------------------------------------------------
// Ticket links

/** Fields a ticket link can give to another system. Everything else is Scout's. */
export type TicketField = "title" | "summary" | "priority" | "labels" | "state" | "ownerId" | "relations" | "parentId";

export const TICKET_FIELDS: readonly TicketField[] = ["title", "summary", "priority", "labels", "state", "ownerId", "relations", "parentId"];

/** `shared`: the external side owns the base category; Scout owns its sub-state. Only `state` may be shared. */
export type TicketFieldOwner = "scout" | "external" | "shared";

export type TicketFieldPolicy = Record<TicketField, TicketFieldOwner>;

export const NATIVE_FIELD_POLICY: TicketFieldPolicy = {
  title: "scout", summary: "scout", priority: "scout", labels: "scout",
  state: "scout", ownerId: "scout", relations: "scout", parentId: "scout",
};

export const TRACKER_LEANING_FIELD_POLICY: TicketFieldPolicy = {
  title: "external", summary: "external", priority: "external", labels: "external",
  state: "shared", ownerId: "external", relations: "external", parentId: "external",
};

/** Linear's workflow state types, which Merge and Jira categories also map onto. */
export type TicketStateCategory = "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled";

/** The Scout state floor for an external category. Scout's sub-state (working, waiting, review) stays Scout's. */
export const TICKET_CATEGORY_STATE_FLOOR: Record<TicketStateCategory, WorkItemState> = {
  triage: "open", backlog: "open", unstarted: "open", started: "working", completed: "done", canceled: "cancelled",
};

export function ticketCategoryForState(state: WorkItemState): TicketStateCategory {
  switch (state) {
    case "open": return "unstarted";
    case "working":
    case "waiting":
    case "review": return "started";
    case "done": return "completed";
    case "cancelled": return "canceled";
  }
}

/** Normalized ticket field values. Relations and parents point at linked Scout items only. */
export interface TicketFieldValues {
  title?: string;
  summary?: string;
  priority?: CollaborationPriority | null;
  labels?: string[];
  state?: TicketStateCategory;
  ownerId?: ScoutId | null;
  relations?: Array<{ kind: CollaborationRelationKind; targetWorkId: ScoutId }>;
  parentId?: ScoutId | null;
}

export type TicketSyncMode = "import_only" | "export_only" | "bidirectional" | "observer" | "disabled";

/** `tracker_driven`: the tracker's delegation starts flights. `observer`: Scout watches and never claims. */
export type TicketRunMode = "scout_controlled" | "tracker_driven" | "observer";

export interface TicketSyncState {
  syncMode: TicketSyncMode;
  runMode: TicketRunMode;
  fieldPolicy: TicketFieldPolicy;
  /** The last value both sides agreed on, per mapped field. The three-way merge compares against it. */
  base: TicketFieldValues;
  /** The last normalized external values. */
  external: TicketFieldValues;
  externalRevision?: string;
  scoutFingerprint?: string;
  lastInboundAt?: number;
  lastOutboundAt?: number;
  lastReconcileAt?: number;
  /**
   * Who the tracker says works the item. `foreign_agent` means another agent
   * holds it: Scout observes and does not claim.
   */
  delegate?: { kind: "scout" | "foreign_agent" | "none"; externalActorId?: ScoutId; observedAt: number };
  /**
   * The tracker's own run record for the current flight (a Linear agent
   * session). A follow-up mention reuses the latest session.
   */
  agentSession?: { externalSessionId: string; flightId?: ScoutId; status?: string; observedAt: number };
  /**
   * Whether the tracker moves states on pull request events (Linear's
   * per-team git automation). When true, Scout observes those moves and does
   * not project them.
   */
  trackerAutomation?: { prDrivenStateMoves: boolean; observedAt: number };
}

export interface TicketWorkLink extends WorkLinkBase {
  kind: "ticket";
  role: "tracker" | "origin" | "reference";
  /** The existing observation contract, unchanged. */
  observed: ExternalWorkContext;
  ticket: TicketSyncState;
}

// ---------------------------------------------------------------------------
// Thread links

export interface ThreadWorkLink extends WorkLinkBase {
  kind: "thread";
  thread: {
    /** The Scout conversation that mirrors the thread, when one exists. */
    conversationId?: ScoutId;
    /** The `ConversationBinding` that routes replies into it. */
    bindingId?: ScoutId;
    /** Root message id in the source (Slack `thread_ts`). */
    rootRemoteId: string;
    /** The source deleted the root. Scout keeps its captured request text. */
    rootDeleted?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Artifact links

export interface ArtifactObservation {
  state: string;
  headSha?: string;
  checks?: string;
  reviewDecision?: string;
  mergedAt?: number;
  observedAt: number;
}

export interface ArtifactWorkLink extends WorkLinkBase {
  kind: "pull_request" | "commit" | "branch" | "document";
  artifact: {
    /** Present when a Scout flight produced it. */
    receiptId?: ScoutId;
    observed?: ArtifactObservation;
  };
}

export type WorkLink = TicketWorkLink | ThreadWorkLink | ArtifactWorkLink;

// ---------------------------------------------------------------------------
// Divergences: proposals and conflicts on a link

/**
 * `proposal`: one side wrote a field the other side owns; it goes to the
 * field's owner as a decision. `field_conflict`: both sides changed a field
 * since the base. The structural kinds never delete or close Scout work.
 */
export type WorkLinkDivergenceKind =
  | "proposal"
  | "field_conflict"
  | "deletion"
  | "closure"
  | "reopen"
  | "routing"
  | "policy";

export interface WorkLinkDivergence {
  id: ScoutId;
  linkId: ScoutId;
  workId: ScoutId;
  kind: WorkLinkDivergenceKind;
  field?: TicketField;
  base?: unknown;
  external?: unknown;
  scout?: unknown;
  externalActorId?: ScoutId;
  scoutActorId?: ScoutId;
  /** The field's owner, then the work owner, then the next mover. Not the operator by default. */
  routedToId: ScoutId;
  state: "open" | "resolved" | "dismissed" | "superseded";
  resolution?: { byId: ScoutId; at: number; choice: "external" | "scout" | "value"; value?: unknown };
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Invariants

/** Who owns a ticket field on this item. With no active ticket link, Scout owns it. */
export function workFieldOwner(links: readonly WorkLink[], workId: ScoutId, field: TicketField): TicketFieldOwner {
  const ticket = links.find((link): link is TicketWorkLink => link.kind === "ticket" && link.workId === workId && isActiveWorkLink(link));
  return ticket ? ticket.ticket.fieldPolicy[field] : "scout";
}

/**
 * Link-set invariants the runtime enforces before it writes a link:
 * an external object maps to at most one active link, and an item has at most
 * one active ticket link (a second backend would give two owners to the same
 * fields; an operator override must be explicit and is not modeled here).
 */
export function validateWorkLinks(links: readonly WorkLink[]): string[] {
  const errors: string[] = [];
  const byExternal = new Map<string, string>();
  const ticketsByWork = new Map<string, string>();
  for (const link of links) {
    if (link.external.adapterId !== link.audience.adapterId || link.external.instanceId !== link.audience.instanceId) {
      errors.push(`${link.id}: audience must come from the linked object's connection`);
    }
    for (const [field, owner] of Object.entries(link.kind === "ticket" ? link.ticket.fieldPolicy : {})) {
      if (owner === "shared" && field !== "state") errors.push(`${link.id}: only state may be shared, not ${field}`);
    }
    if (!isActiveWorkLink(link)) continue;
    const key = externalObjectKey(link.external);
    const prior = byExternal.get(key);
    if (prior) errors.push(`${link.id}: ${key} is already linked by ${prior}`);
    else byExternal.set(key, link.id);
    if (link.kind === "ticket") {
      const priorTicket = ticketsByWork.get(link.workId);
      if (priorTicket) errors.push(`${link.id}: work ${link.workId} already has active ticket link ${priorTicket}`);
      else ticketsByWork.set(link.workId, link.id);
    }
  }
  return errors;
}
