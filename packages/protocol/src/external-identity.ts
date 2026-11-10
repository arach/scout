/**
 * How Scout names things and people outside itself. DRAFT: see
 * docs/plans/interconnection-architecture.md.
 *
 * - {@link ExternalObjectRef} is the natural key of an object in a connected
 *   system. Ledgers, links and dedup key on it.
 * - {@link ExternalActor} maps a user inside a connected system to a Scout
 *   principal. Only a verified link sets `principalId`; an email match is a
 *   candidate and grants nothing.
 * - {@link SourceAudience} records who could see imported content at its source.
 *   A reader must pass the Scout scope and the source audience.
 */
import type { ScoutId } from "./common.js";

/** What an adapter module serves. One module per external system; a module may serve more than one kind. */
export type AdapterKind = "channel" | "ticket" | "repo";

export type ExternalObjectKind =
  | "ticket"
  | "comment"
  | "channel"
  | "thread"
  | "message"
  | "repository"
  | "pull_request"
  | "review"
  | "check"
  | "commit"
  | "branch"
  | "document"
  | "team"
  | "user"
  | "agent_session";

/**
 * Natural key: `(adapterId, instanceId, objectKind, id)`. `instanceId` is one
 * installed connection's tenant: a Slack team (with its enterprise), a Linear
 * organization, a GitHub installation. `id` is the stable provider id (a GitHub
 * node id or numeric id, never a login or a title).
 */
export interface ExternalObjectRef {
  adapterId: string;
  instanceId: string;
  objectKind: ExternalObjectKind;
  id: string;
  /** Human key such as `ENG-142` or `acme/app#88`. Display and matching only. */
  key?: string;
  url?: string;
  /** Slack channel, Linear team, GitHub repository. */
  containerId?: string;
}

export function externalObjectKey(ref: Pick<ExternalObjectRef, "adapterId" | "instanceId" | "objectKind" | "id">): string {
  return [ref.adapterId, ref.instanceId, ref.objectKind, ref.id].map(encodeURIComponent).join(":");
}

// ---------------------------------------------------------------------------
// External actors (subject identity)

/**
 * `scout_app` is Scout's own bot or app user: events it authored are echoes.
 * `foreign_agent` is another vendor's agent (Linear Agent, Copilot, Codex):
 * its writes are external moves, attributed to it, never to "the system".
 */
export type ExternalActorType = "human" | "scout_app" | "foreign_agent" | "integration" | "unknown";

/** Membership in the external tenant, as last observed. Guests and shared-channel users are limited by default. */
export type ExternalMembership = "member" | "guest" | "external_shared" | "unknown";

export type ExternalActorLinkState = "unlinked" | "candidate" | "linked" | "revoked";

export interface ExternalActorLink {
  method: "self_confirm" | "admin_confirm";
  /** Where the person confirmed: a Slack command, Linear's `auth` elicitation signal, the front door. */
  via: "slash_command" | "tracker_auth_signal" | "front_door" | "admin";
  at: number;
  confirmedById?: ScoutId;
}

export interface ExternalActorCandidate {
  principalId: ScoutId;
  basis: "email_match" | "display_name_match";
  observedAt: number;
}

export interface ExternalActor {
  id: ScoutId;
  adapterId: string;
  instanceId: string;
  /** Slack `U…`/`W…`, Linear user id, GitHub numeric id. Never a login. */
  externalUserId: string;
  /** Enterprise Grid user id when the provider sends one. */
  enterpriseUserId?: string;
  displayName: string;
  actorType: ExternalActorType;
  membership: ExternalMembership;
  membershipObservedAt?: number;
  linkState: ExternalActorLinkState;
  /** Set only when `linkState` is `linked`. */
  principalId?: ScoutId;
  link?: ExternalActorLink;
  /** Suggestions for a person to confirm. They never grant anything. */
  candidates?: ExternalActorCandidate[];
  createdAt: number;
  updatedAt: number;
}

export function externalActorKey(actor: Pick<ExternalActor, "adapterId" | "instanceId" | "externalUserId">): string {
  return [actor.adapterId, actor.instanceId, actor.externalUserId].map(encodeURIComponent).join(":");
}

export function validateExternalActor(actor: ExternalActor): string[] {
  const errors: string[] = [];
  for (const key of ["id", "adapterId", "instanceId", "externalUserId", "displayName"] as const) {
    if (!actor[key]?.trim()) errors.push(`${key} is required`);
  }
  if (actor.linkState === "linked" && (!actor.principalId || !actor.link)) {
    errors.push("a linked actor needs principalId and link");
  }
  if (actor.linkState !== "linked" && actor.principalId) {
    errors.push("only a linked actor carries principalId");
  }
  if (actor.linkState === "candidate" && !actor.candidates?.length) {
    errors.push("a candidate actor needs at least one candidate");
  }
  if (actor.actorType === "scout_app" && actor.linkState === "linked") {
    errors.push("Scout's own app identity never links to a principal");
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Source audience

/** `unknown` is read as `private`. */
export type SourceVisibility = "org_public" | "private" | "external_shared" | "unknown";

export interface SourceAudience {
  adapterId: string;
  instanceId: string;
  /** Slack channel, Linear team, GitHub repository. */
  container: string;
  visibility: SourceVisibility;
  membershipObservedAt?: number;
}

export function sourceAudienceKey(audience: Pick<SourceAudience, "adapterId" | "instanceId" | "container">): string {
  return [audience.adapterId, audience.instanceId, audience.container].map(encodeURIComponent).join(":");
}

/**
 * The audiences a record's content came from. A reader must pass every one.
 * `basis` scopes the rule: Scout tracks the sources it supplied to a flight or
 * recorded from it. Reads a harness makes through its own tools are the
 * harness's to fence.
 */
export interface AudienceStamp {
  sources: SourceAudience[];
  basis: "supplied_or_recorded";
}

/** Derived content carries the narrowest audience: the union of every source's constraint. */
export function narrowAudience(...stamps: Array<AudienceStamp | SourceAudience | null | undefined>): AudienceStamp {
  const byKey = new Map<string, SourceAudience>();
  for (const stamp of stamps) {
    if (!stamp) continue;
    const sources = "sources" in stamp ? stamp.sources : [stamp];
    for (const source of sources) {
      const key = sourceAudienceKey(source);
      const prior = byKey.get(key);
      byKey.set(key, prior ? narrowerOf(prior, source) : source);
    }
  }
  return { sources: [...byKey.values()], basis: "supplied_or_recorded" };
}

const VISIBILITY_RANK: Record<SourceVisibility, number> = { org_public: 0, external_shared: 1, private: 2, unknown: 3 };

function narrowerOf(a: SourceAudience, b: SourceAudience): SourceAudience {
  return VISIBILITY_RANK[b.visibility] > VISIBILITY_RANK[a.visibility] ? b : a;
}

/** Membership of one principal's linked actor in one source container, as observed. */
export interface AudienceMembershipObservation {
  audienceKey: string;
  externalActorId: ScoutId;
  member: boolean;
  observedAt: number;
}

export interface AudienceReader {
  /** The reader's linked external actors. Unlinked actors cannot be readers. */
  actors: Array<Pick<ExternalActor, "id" | "adapterId" | "instanceId" | "membership" | "linkState">>;
  memberships: AudienceMembershipObservation[];
}

export interface AudienceCheck {
  allowed: boolean;
  /** Sources the reader failed. Present for diagnostics; never shown to an agent. */
  failed: SourceAudience[];
}

/**
 * The audience half of a read check. The runtime ANDs it with the Scout
 * visibility scope. Unknown membership fails closed.
 */
export function canReadAudience(
  reader: AudienceReader,
  stamp: AudienceStamp | null | undefined,
  options: { now: number; membershipMaxAgeMs: number },
): AudienceCheck {
  if (!stamp || stamp.sources.length === 0) return { allowed: true, failed: [] };
  const failed: SourceAudience[] = [];
  for (const source of stamp.sources) {
    const actors = reader.actors.filter((actor) => actor.linkState === "linked"
      && actor.adapterId === source.adapterId
      && actor.instanceId === source.instanceId);
    const key = sourceAudienceKey(source);
    const freshMember = actors.some((actor) => reader.memberships.some((m) => m.audienceKey === key
      && m.externalActorId === actor.id
      && m.member
      && options.now - m.observedAt <= options.membershipMaxAgeMs));
    const passes = source.visibility === "org_public"
      ? actors.some((actor) => actor.membership === "member") || freshMember
      : freshMember;
    if (!passes) failed.push(source);
  }
  return { allowed: failed.length === 0, failed };
}
