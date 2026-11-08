/**
 * Policy as declarative records, evaluated by the runtime. DRAFT: see
 * docs/plans/interconnection-architecture.md.
 *
 * Two questions, both answered from records rather than code paths:
 *
 * - May this requester make this class of request here? Request-class grants
 *   and class ceilings decide it. A publish or release runs under the
 *   responsible person, who must hold the class too.
 * - May this reader see this content? The Scout visibility scope AND the
 *   source audience (`canReadAudience`), under the audience policy record.
 *
 * Grants only allow. No matching grant is a refusal. A person who was refused
 * learns why and what to do next; an agent gets an opaque refusal so it
 * cannot learn to route around it.
 */
import type { ScoutId } from "./common.js";
import type { ExternalActor } from "./external-identity.js";
import type { TicketRunMode } from "./work-links.js";

/** Requests are classed by effect, not by tool. Ordered from least to most effect. */
export type RequestClass = "ask" | "review" | "change" | "publish" | "release" | "govern";

export const REQUEST_CLASSES: readonly RequestClass[] = ["ask", "review", "change", "publish", "release", "govern"];

export function requestClassRank(requestClass: RequestClass): number {
  return REQUEST_CLASSES.indexOf(requestClass);
}

export type PrincipalSelector =
  | { kind: "principal"; principalId: ScoutId }
  /** Any external actor of this tenant linked to a Scout principal. */
  | { kind: "linked_member"; instanceId?: string }
  /** A tenant member with no verified link. */
  | { kind: "unlinked_member"; instanceId: string }
  /** A guest or shared-channel user of this tenant. */
  | { kind: "guest"; instanceId: string }
  | { kind: "agent"; agentId?: ScoutId }
  /** A tracker event such as a Linear delegation, acting for the person who delegated. */
  | { kind: "integration_event"; adapterId: string };

export type PrincipalSelectorKind = PrincipalSelector["kind"];

/** Absent fields match anything. */
export interface PolicyScopeSelector {
  projectId?: ScoutId;
  connectionId?: ScoutId;
  container?: string;
  repo?: string;
}

export interface RequestGrantPolicy {
  kind: "request_grant";
  id: string;
  subject: PrincipalSelector;
  classes: RequestClass[];
  scope: PolicyScopeSelector;
  constraints?: {
    /** Answer only from content the requester's source audience can see. */
    sourceAudienceOnly?: boolean;
    /** Only inside the container the request came from. */
    originContainerOnly?: boolean;
    /** The request runs under its responsible person, who must hold the class as well. */
    underResponsiblePrincipal?: boolean;
    runMode?: TicketRunMode;
  };
  /** The issuer is the accountable party for a group grant ("authority grant G by admin X"). */
  issuedById: ScoutId;
  issuedAt: number;
  expiresAt?: number;
  revokedAt?: number;
  note?: string;
}

/** No grant can lift a subject kind above its ceiling. Agents never release or govern on their own authority. */
export interface ClassCeilingPolicy {
  kind: "class_ceiling";
  id: string;
  subjectKind: Exclude<PrincipalSelectorKind, "principal" | "linked_member">;
  max: RequestClass;
}

export interface AudiencePolicy {
  kind: "audience";
  id: string;
  /** Membership observations older than this fail closed for private sources. */
  membershipMaxAgeMs: number;
  unknownVisibility: "private";
  /** Derived content carries the narrowest audience of the sources Scout supplied or recorded. */
  derived: "narrowest_supplied_or_recorded";
  /** Publishing derived content to a wider audience is this class, decided by someone inside the source audience. */
  widenRequires: RequestClass;
}

export interface DisclosurePolicy {
  kind: "refusal_disclosure";
  id: string;
  human: "explain" | "opaque";
  agent: "explain" | "opaque";
}

export type PolicyRecord = RequestGrantPolicy | ClassCeilingPolicy | AudiencePolicy | DisclosurePolicy;

// ---------------------------------------------------------------------------
// Evaluation

export type RequesterFacts =
  | { kind: "principal"; principalId: ScoutId }
  | { kind: "external_actor"; actor: Pick<ExternalActor, "id" | "adapterId" | "instanceId" | "linkState" | "principalId" | "membership" | "actorType"> }
  | { kind: "agent"; agentId: ScoutId }
  | { kind: "integration_event"; adapterId: string; delegatorPrincipalId?: ScoutId };

export interface RequestContext {
  requestClass: RequestClass;
  requester: RequesterFacts;
  responsiblePrincipalId?: ScoutId;
  target: PolicyScopeSelector;
  facts?: {
    withinSourceAudience?: boolean;
    withinOriginContainer?: boolean;
    runMode?: TicketRunMode;
  };
  now: number;
}

export type RequestRefusalCode =
  | "not_linked"
  | "class_not_granted"
  | "above_ceiling"
  | "responsible_principal_missing"
  | "responsible_principal_lacks_class"
  | "outside_source_audience"
  | "outside_origin_container"
  | "run_mode";

export interface RequestDecision {
  verdict: "allow" | "deny";
  grantIds: string[];
  /** Who answers for the effect in the receipt. */
  accountablePrincipalId?: ScoutId;
  refusal?: { disclosure: "explain" | "opaque"; code?: RequestRefusalCode; nextStep?: string };
}

const NEXT_STEP: Record<RequestRefusalCode, string> = {
  not_linked: "Link your identity (for example `/scout link`), or ask a linked member to make the request.",
  class_not_granted: "Ask a project member or an admin to grant this kind of request.",
  above_ceiling: "A person has to make this request.",
  responsible_principal_missing: "A person who holds this kind of request has to make or approve it.",
  responsible_principal_lacks_class: "The person this work is for does not hold this kind of request. Ask one who does.",
  outside_source_audience: "Ask from a place where the content you need is visible.",
  outside_origin_container: "Make this request from the channel it concerns.",
  run_mode: "This connection does not start work from tracker events.",
};

/** The selector kind a requester is checked as, and the principal it resolves to. */
function resolveRequester(requester: RequesterFacts): { kind: PrincipalSelectorKind; principalId?: ScoutId; instanceId?: string; adapterId?: string; agentId?: ScoutId; human: boolean } {
  switch (requester.kind) {
    case "principal":
      return { kind: "principal", principalId: requester.principalId, human: true };
    case "agent":
      return { kind: "agent", agentId: requester.agentId, human: false };
    case "integration_event":
      return { kind: "integration_event", adapterId: requester.adapterId, principalId: requester.delegatorPrincipalId, human: true };
    case "external_actor": {
      const actor = requester.actor;
      if (actor.linkState === "linked" && actor.principalId) {
        return { kind: "linked_member", principalId: actor.principalId, instanceId: actor.instanceId, human: true };
      }
      const kind = actor.membership === "member" ? "unlinked_member" : "guest";
      return { kind, instanceId: actor.instanceId, human: actor.actorType !== "foreign_agent" };
    }
  }
}

function subjectMatches(subject: PrincipalSelector, who: ReturnType<typeof resolveRequester>): boolean {
  switch (subject.kind) {
    case "principal": return Boolean(who.principalId) && (who.kind === "principal" || who.kind === "linked_member") && subject.principalId === who.principalId;
    case "linked_member": return who.kind === "linked_member" && (!subject.instanceId || subject.instanceId === who.instanceId);
    case "unlinked_member": return who.kind === "unlinked_member" && subject.instanceId === who.instanceId;
    case "guest": return who.kind === "guest" && subject.instanceId === who.instanceId;
    case "agent": return who.kind === "agent" && (!subject.agentId || subject.agentId === who.agentId);
    case "integration_event": return who.kind === "integration_event" && subject.adapterId === who.adapterId;
  }
}

function scopeMatches(scope: PolicyScopeSelector, target: PolicyScopeSelector): boolean {
  return (Object.keys(scope) as Array<keyof PolicyScopeSelector>)
    .every((key) => scope[key] === undefined || scope[key] === target[key]);
}

function isLive(grant: RequestGrantPolicy, now: number): boolean {
  return grant.revokedAt === undefined && (grant.expiresAt === undefined || grant.expiresAt > now);
}

function disclosureFor(policies: readonly PolicyRecord[], human: boolean): "explain" | "opaque" {
  const policy = policies.find((p): p is DisclosurePolicy => p.kind === "refusal_disclosure");
  return human ? policy?.human ?? "explain" : policy?.agent ?? "opaque";
}

function deny(policies: readonly PolicyRecord[], human: boolean, code: RequestRefusalCode): RequestDecision {
  const disclosure = disclosureFor(policies, human);
  return {
    verdict: "deny",
    grantIds: [],
    refusal: disclosure === "explain" ? { disclosure, code, nextStep: NEXT_STEP[code] } : { disclosure },
  };
}

/**
 * Decide one request from policy records. Pure. The runtime calls it when a
 * request is accepted and again before each publish or release effect, and
 * records the decision on the receipt.
 */
export function evaluateRequest(policies: readonly PolicyRecord[], ctx: RequestContext, depth = 0): RequestDecision {
  const who = resolveRequester(ctx.requester);
  const rank = requestClassRank(ctx.requestClass);

  const ceiling = policies.find((p): p is ClassCeilingPolicy => p.kind === "class_ceiling" && p.subjectKind === who.kind);
  if (ceiling && rank > requestClassRank(ceiling.max)) return deny(policies, who.human, "above_ceiling");

  const candidates = policies.filter((p): p is RequestGrantPolicy => p.kind === "request_grant"
    && isLive(p, ctx.now)
    && p.classes.includes(ctx.requestClass)
    && scopeMatches(p.scope, ctx.target)
    && subjectMatches(p.subject, who));

  let firstFailure: RequestRefusalCode | undefined;
  for (const grant of candidates) {
    const c = grant.constraints ?? {};
    let failure: RequestRefusalCode | undefined;
    if (c.sourceAudienceOnly && ctx.facts?.withinSourceAudience !== true) failure = "outside_source_audience";
    else if (c.originContainerOnly && ctx.facts?.withinOriginContainer !== true) failure = "outside_origin_container";
    else if (c.runMode && ctx.facts?.runMode !== c.runMode) failure = "run_mode";
    else if (c.underResponsiblePrincipal) {
      const responsible = ctx.responsiblePrincipalId ?? who.principalId;
      if (!responsible) failure = "responsible_principal_missing";
      else if (depth > 0) failure = "responsible_principal_lacks_class";
      else {
        const inner = evaluateRequest(policies, { ...ctx, requester: { kind: "principal", principalId: responsible }, facts: undefined }, depth + 1);
        if (inner.verdict !== "allow") failure = "responsible_principal_lacks_class";
        else {
          return { verdict: "allow", grantIds: [grant.id, ...inner.grantIds], accountablePrincipalId: responsible };
        }
      }
    }
    if (!failure) {
      return {
        verdict: "allow",
        grantIds: [grant.id],
        accountablePrincipalId: ctx.responsiblePrincipalId ?? who.principalId ?? grant.issuedById,
      };
    }
    firstFailure ??= failure;
  }

  if (firstFailure) return deny(policies, who.human, firstFailure);
  if (who.kind === "unlinked_member" || who.kind === "guest") return deny(policies, who.human, "not_linked");
  return deny(policies, who.human, "class_not_granted");
}

// ---------------------------------------------------------------------------
// Default records for a new connection. Data, not code: an admin edits or
// revokes them like any other policy record.

export interface DefaultPolicyInput {
  connectionId: ScoutId;
  adapterId: string;
  instanceId: string;
  projectId: ScoutId;
  issuedById: ScoutId;
  now: number;
}

export const DEFAULT_MEMBERSHIP_MAX_AGE_MS = 60 * 60 * 1000;

export function defaultConnectionPolicies(input: DefaultPolicyInput): PolicyRecord[] {
  const base = { issuedById: input.issuedById, issuedAt: input.now };
  const id = (suffix: string) => `pol-${input.connectionId}-${suffix}`;
  return [
    { kind: "request_grant", id: id("unlinked-ask"), subject: { kind: "unlinked_member", instanceId: input.instanceId }, classes: ["ask"], scope: { connectionId: input.connectionId }, constraints: { sourceAudienceOnly: true }, ...base },
    { kind: "request_grant", id: id("guest-ask"), subject: { kind: "guest", instanceId: input.instanceId }, classes: ["ask"], scope: { connectionId: input.connectionId }, constraints: { sourceAudienceOnly: true, originContainerOnly: true }, ...base },
    { kind: "request_grant", id: id("tracker-run"), subject: { kind: "integration_event", adapterId: input.adapterId }, classes: ["change", "publish"], scope: { connectionId: input.connectionId }, constraints: { runMode: "tracker_driven", underResponsiblePrincipal: true }, ...base },
    { kind: "class_ceiling", id: id("ceiling-guest"), subjectKind: "guest", max: "ask" },
    { kind: "class_ceiling", id: id("ceiling-unlinked"), subjectKind: "unlinked_member", max: "publish" },
    { kind: "class_ceiling", id: id("ceiling-integration"), subjectKind: "integration_event", max: "publish" },
  ];
}

/** Workspace-wide records: agent defaults (pending the operator's call on P1 agent rights), ceilings, audience and disclosure. */
export function defaultWorkspacePolicies(input: { projectId: ScoutId; issuedById: ScoutId; now: number }): PolicyRecord[] {
  const base = { issuedById: input.issuedById, issuedAt: input.now };
  return [
    { kind: "request_grant", id: `pol-${input.projectId}-agent-work`, subject: { kind: "agent" }, classes: ["ask", "review", "change"], scope: { projectId: input.projectId }, ...base },
    { kind: "request_grant", id: `pol-${input.projectId}-agent-publish`, subject: { kind: "agent" }, classes: ["publish"], scope: { projectId: input.projectId }, constraints: { underResponsiblePrincipal: true }, ...base },
    { kind: "class_ceiling", id: "pol-ceiling-agent", subjectKind: "agent", max: "publish" },
    { kind: "audience", id: "pol-audience", membershipMaxAgeMs: DEFAULT_MEMBERSHIP_MAX_AGE_MS, unknownVisibility: "private", derived: "narrowest_supplied_or_recorded", widenRequires: "govern" },
    { kind: "refusal_disclosure", id: "pol-disclosure", human: "explain", agent: "opaque" },
  ];
}

/** A project grant for one person. Release and govern are granted by role, one record each. */
export function principalProjectGrant(input: { principalId: ScoutId; projectId: ScoutId; classes: RequestClass[]; issuedById: ScoutId; now: number }): RequestGrantPolicy {
  return {
    kind: "request_grant",
    id: `pol-${input.projectId}-${input.principalId}`,
    subject: { kind: "principal", principalId: input.principalId },
    classes: input.classes,
    scope: { projectId: input.projectId },
    issuedById: input.issuedById,
    issuedAt: input.now,
  };
}
