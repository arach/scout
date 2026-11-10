import { describe, expect, test } from "bun:test";

import { validateCollaborationRecord, type WorkItemRecord } from "./collaboration.js";
import {
  decideWorkClaim,
  validateWorkClaimPlacement,
  workClaimForMove,
  workReadiness,
  WORK_CLAIM_DEFAULT_LEASE_MS,
  type WorkClaimSubject,
} from "./work-claims.js";
import {
  NATIVE_FIELD_POLICY,
  TRACKER_LEANING_FIELD_POLICY,
  validateWorkLinks,
  workFieldOwner,
  type ThreadWorkLink,
  type TicketWorkLink,
  type WorkLink,
} from "./work-links.js";
import {
  canReadAudience,
  narrowAudience,
  sourceAudienceKey,
  validateExternalActor,
  type ExternalActor,
  type SourceAudience,
} from "./external-identity.js";
import { sweepAllowed } from "./interconnect-ledgers.js";
import {
  defaultConnectionPolicies,
  defaultWorkspacePolicies,
  evaluateRequest,
  principalProjectGrant,
  type PolicyRecord,
} from "./interconnect-policy.js";
import { ADAPTER_DESCRIPTOR_SCHEMA, validateAdapterDescriptor, type AdapterDescriptor } from "./adapter-descriptors.js";

const NOW = 1_800_000_000_000;

function item(overrides: Partial<WorkClaimSubject> = {}): WorkClaimSubject {
  return { id: "wrk-1", state: "open", ownerId: "person:dana", nextMoveOwnerId: "person:dana", revision: 3, ...overrides };
}

describe("claims on the work record", () => {
  test("claiming an open item moves it to working and keeps the human owner", () => {
    const decision = decideWorkClaim(item(), { workId: "wrk-1", action: "claim", actorId: "agent:a", sessionAddress: "sess.a" }, NOW);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.patch).toMatchObject({ state: "working", claimGeneration: 1, nextMoveOwnerId: "agent:a", ownerId: "person:dana", event: "claimed" });
    expect(decision.patch.claim).toMatchObject({ holderId: "agent:a", generation: 1, lease: "active", leaseExpiresAt: NOW + WORK_CLAIM_DEFAULT_LEASE_MS });
  });

  test("an unowned item takes its responsible person as owner, not the agent", () => {
    const decision = decideWorkClaim(item({ ownerId: undefined, responsiblePrincipalId: "person:sam" }), { workId: "wrk-1", action: "claim", actorId: "agent:a" }, NOW);
    expect(decision.ok && decision.patch.ownerId).toBe("person:sam");
  });

  test("a second claimant gets a conflict that names the holder and the time left", () => {
    const first = decideWorkClaim(item(), { workId: "wrk-1", action: "claim", actorId: "agent:a" }, NOW);
    if (!first.ok) throw new Error("expected claim");
    const held = item({ state: "working", claim: first.patch.claim!, claimGeneration: 1 });
    const second = decideWorkClaim(held, { workId: "wrk-1", action: "claim", actorId: "agent:b" }, NOW + 60_000);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.conflict.code).toBe("work_claim_held");
    expect(second.conflict.holder?.holderId).toBe("agent:a");
    expect(second.conflict.retryAfterMs).toBe(WORK_CLAIM_DEFAULT_LEASE_MS - 60_000);
  });

  test("the holder re-claiming renews without a ledger event", () => {
    const first = decideWorkClaim(item(), { workId: "wrk-1", action: "claim", actorId: "agent:a" }, NOW);
    if (!first.ok) throw new Error("expected claim");
    const renewed = decideWorkClaim(item({ state: "working", claim: first.patch.claim!, claimGeneration: 1 }), { workId: "wrk-1", action: "claim", actorId: "agent:a" }, NOW + 1000);
    expect(renewed.ok && renewed.patch.event).toBeNull();
    expect(renewed.ok && renewed.patch.claimGeneration).toBe(1);
  });

  test("an expired lease is reclaimable, and the old generation is fenced", () => {
    const first = decideWorkClaim(item(), { workId: "wrk-1", action: "claim", actorId: "agent:a", leaseMs: 10_000 }, NOW);
    if (!first.ok) throw new Error("expected claim");
    const lapsed = item({ state: "working", claim: first.patch.claim!, claimGeneration: 1 });
    expect(workReadiness({ item: lapsed, blockers: [], now: NOW + 20_000 })).toEqual({ ready: true, reclaimable: true, reasons: [] });
    const reclaim = decideWorkClaim(lapsed, { workId: "wrk-1", action: "claim", actorId: "agent:b" }, NOW + 20_000);
    if (!reclaim.ok) throw new Error("expected reclaim");
    expect(reclaim.patch).toMatchObject({ claimGeneration: 2, event: "reclaimed" });
    const stale = decideWorkClaim(item({ state: "working", claim: reclaim.patch.claim!, claimGeneration: 2 }), { workId: "wrk-1", action: "renew", actorId: "agent:b", generation: 1 }, NOW + 21_000);
    expect(!stale.ok && stale.conflict.code).toBe("work_claim_stale_generation");
  });

  test("generation survives release, so a later claim cannot reuse it", () => {
    const released = decideWorkClaim(
      item({ state: "working", claimGeneration: 4, claim: { holderId: "agent:a", generation: 4, source: "native", claimedAt: NOW, renewedAt: NOW, leaseMs: 60_000, lease: "active", leaseExpiresAt: NOW + 60_000 } }),
      { workId: "wrk-1", action: "release", actorId: "agent:a", generation: 4 }, NOW,
    );
    if (!released.ok) throw new Error("expected release");
    expect(released.patch).toMatchObject({ state: "open", claim: null, claimGeneration: 4, event: "released" });
    const next = decideWorkClaim(item({ claimGeneration: 4 }), { workId: "wrk-1", action: "claim", actorId: "agent:b" }, NOW);
    expect(next.ok && next.patch.claimGeneration).toBe(5);
  });

  test("waiting and review park the lease; only the holder re-arms it", () => {
    const claim = { holderId: "agent:a", generation: 1, source: "native" as const, claimedAt: NOW, renewedAt: NOW, leaseMs: 10_000, lease: "active" as const, leaseExpiresAt: NOW + 10_000 };
    const parked = workClaimForMove(claim, "waiting", "agent:a", NOW + 1000);
    if (!("claim" in parked) || !parked.claim) throw new Error("expected parked claim");
    expect(parked.claim.lease).toBe("parked");
    expect(parked.claim.leaseExpiresAt).toBeUndefined();
    // Hours later the item is still held, not reclaimable.
    const later = workReadiness({ item: { state: "waiting", claim: parked.claim }, blockers: [], now: NOW + 6 * 3600_000 });
    expect(later.ready).toBe(false);
    expect(later.reasons).toContain("parked");
    expect(workClaimForMove(parked.claim, "working", "agent:b", NOW)).toEqual({ conflict: "work_claim_held" });
    const rearmed = workClaimForMove(parked.claim, "working", "agent:a", NOW + 5000);
    expect("claim" in rearmed && rearmed.claim?.leaseExpiresAt).toBe(NOW + 15_000);
    expect(validateWorkClaimPlacement("waiting", parked.claim)).toEqual([]);
    expect(validateWorkClaimPlacement("open", parked.claim)).toContain("open work items hold no claim");
  });

  test("a stale revision is refused before anything else", () => {
    const decision = decideWorkClaim(item(), { workId: "wrk-1", action: "claim", actorId: "agent:a", expectedRevision: 2 }, NOW);
    expect(!decision.ok && decision.conflict.code).toBe("work_revision_mismatch");
  });

  test("readiness: blocked, deferred and foreign delegates are not ready", () => {
    const r = workReadiness({ item: { state: "open", deferUntil: NOW + 1 }, blockers: [{ id: "wrk-0", state: "working" }], foreignDelegate: true, now: NOW });
    expect(r.reasons).toEqual(["deferred", "blocked", "foreign_delegate"]);
    expect(workReadiness({ item: { state: "open" }, blockers: [{ id: "wrk-0", state: "done" }], now: NOW }).ready).toBe(true);
  });

  test("the draft fields leave existing record validation unchanged", () => {
    const record: WorkItemRecord = {
      id: "wrk-1", kind: "work_item", title: "Retry delivery", createdById: "person:dana", ownerId: "person:dana",
      nextMoveOwnerId: "agent:a", state: "working", acceptanceState: "none", createdAt: NOW, updatedAt: NOW,
      key: "SCO-142", revision: 4, claimGeneration: 1, responsiblePrincipalId: "person:dana",
      claim: { holderId: "agent:a", generation: 1, source: "native", claimedAt: NOW, renewedAt: NOW, leaseMs: 60_000, lease: "active", leaseExpiresAt: NOW + 60_000 },
    };
    expect(validateCollaborationRecord(record)).toEqual([]);
  });
});

const slackAudience: SourceAudience = { adapterId: "slack", instanceId: "T01", container: "C9", visibility: "private" };
const linearAudience: SourceAudience = { adapterId: "linear", instanceId: "org-acme", container: "team-eng", visibility: "org_public" };

function ticketLink(overrides: Partial<TicketWorkLink> = {}): TicketWorkLink {
  return {
    id: "lnk-1", workId: "wrk-1", kind: "ticket", connectionId: "conn-linear", role: "tracker", originSide: "external", status: "healthy",
    external: { adapterId: "linear", instanceId: "org-acme", objectKind: "ticket", id: "6a1", key: "ENG-142", containerId: "team-eng" },
    audience: linearAudience, linkedBy: { method: "delegation" }, observedAt: NOW, createdAt: NOW, updatedAt: NOW,
    observed: { source: { adapterId: "linear", instanceId: "org-acme", workItemId: "6a1" }, observedAt: NOW, sourceState: "started" },
    ticket: { syncMode: "import_only", runMode: "tracker_driven", fieldPolicy: TRACKER_LEANING_FIELD_POLICY, base: { title: "Retry", state: "started" }, external: { title: "Retry", state: "started" } },
    ...overrides,
  };
}

function threadLink(overrides: Partial<ThreadWorkLink> = {}): ThreadWorkLink {
  return {
    id: "lnk-2", workId: "wrk-1", kind: "thread", connectionId: "conn-slack", role: "origin", originSide: "external", status: "healthy",
    external: { adapterId: "slack", instanceId: "T01", objectKind: "thread", id: "1730990000.1234", containerId: "C9" },
    audience: slackAudience, linkedBy: { method: "mention" }, observedAt: NOW, createdAt: NOW, updatedAt: NOW,
    thread: { rootRemoteId: "1730990000.1234" },
    ...overrides,
  };
}

describe("work links", () => {
  test("native mode is the zero-link case", () => {
    expect(workFieldOwner([], "wrk-1", "title")).toBe("scout");
    expect(workFieldOwner([ticketLink()], "wrk-1", "title")).toBe("external");
    expect(workFieldOwner([ticketLink()], "wrk-1", "state")).toBe("shared");
    expect(workFieldOwner([ticketLink({ status: "unlinked" })], "wrk-1", "title")).toBe("scout");
  });

  test("one active ticket link per item, one active link per external object", () => {
    const links: WorkLink[] = [ticketLink(), threadLink(), ticketLink({ id: "lnk-3", external: { adapterId: "linear", instanceId: "org-acme", objectKind: "ticket", id: "7b2" } })];
    expect(validateWorkLinks(links)).toEqual(["lnk-3: work wrk-1 already has active ticket link lnk-1"]);
    expect(validateWorkLinks([threadLink(), threadLink({ id: "lnk-4", workId: "wrk-2" })])[0]).toContain("already linked by lnk-2");
  });

  test("suggested links do not count, and only state may be shared", () => {
    expect(validateWorkLinks([ticketLink(), ticketLink({ id: "lnk-5", status: "suggested", external: { adapterId: "linear", instanceId: "org-acme", objectKind: "ticket", id: "9" } })])).toEqual([]);
    const bad = ticketLink({ ticket: { ...ticketLink().ticket, fieldPolicy: { ...NATIVE_FIELD_POLICY, title: "shared" } } });
    expect(validateWorkLinks([bad])).toEqual(["lnk-1: only state may be shared, not title"]);
  });
});

describe("identity and audience", () => {
  const linked: ExternalActor = {
    id: "xa-1", adapterId: "slack", instanceId: "T01", externalUserId: "U123", displayName: "Dana", actorType: "human",
    membership: "member", linkState: "linked", principalId: "person:dana",
    link: { method: "self_confirm", via: "slash_command", at: NOW }, createdAt: NOW, updatedAt: NOW,
  };

  test("an email match is a candidate, never a link", () => {
    expect(validateExternalActor(linked)).toEqual([]);
    expect(validateExternalActor({ ...linked, linkState: "candidate", link: undefined })).toContain("only a linked actor carries principalId");
  });

  test("derived content carries every source, at its narrowest visibility", () => {
    const stamp = narrowAudience(slackAudience, linearAudience, { ...linearAudience, visibility: "unknown" });
    expect(stamp.sources).toHaveLength(2);
    expect(stamp.sources.find((s) => s.adapterId === "linear")?.visibility).toBe("unknown");
  });

  test("private sources need a fresh membership observation; unknown fails closed", () => {
    const stamp = narrowAudience(slackAudience);
    const reader = { actors: [linked], memberships: [{ audienceKey: sourceAudienceKey(slackAudience), externalActorId: "xa-1", member: true, observedAt: NOW - 1000 }] };
    expect(canReadAudience(reader, stamp, { now: NOW, membershipMaxAgeMs: 60_000 }).allowed).toBe(true);
    expect(canReadAudience(reader, stamp, { now: NOW + 120_000, membershipMaxAgeMs: 60_000 }).allowed).toBe(false);
    expect(canReadAudience({ actors: [linked], memberships: [] }, stamp, { now: NOW, membershipMaxAgeMs: 60_000 }).failed).toEqual([slackAudience]);
    expect(canReadAudience({ actors: [], memberships: [] }, undefined, { now: NOW, membershipMaxAgeMs: 1 }).allowed).toBe(true);
  });
});

describe("request policy", () => {
  const policies: PolicyRecord[] = [
    ...defaultConnectionPolicies({ connectionId: "conn-slack", adapterId: "slack", instanceId: "T01", projectId: "proj-1", issuedById: "person:admin", now: NOW }),
    ...defaultWorkspacePolicies({ projectId: "proj-1", issuedById: "person:admin", now: NOW }),
    principalProjectGrant({ principalId: "person:dana", projectId: "proj-1", classes: ["ask", "review", "change", "publish"], issuedById: "person:admin", now: NOW }),
  ];
  const target = { projectId: "proj-1", connectionId: "conn-slack" };
  const unlinked = { kind: "external_actor" as const, actor: { id: "xa-2", adapterId: "slack", instanceId: "T01", linkState: "unlinked" as const, membership: "member" as const, actorType: "human" as const } };

  test("an unlinked member may ask from the source audience, and is told why otherwise", () => {
    expect(evaluateRequest(policies, { requestClass: "ask", requester: unlinked, target, facts: { withinSourceAudience: true }, now: NOW }).verdict).toBe("allow");
    const change = evaluateRequest(policies, { requestClass: "change", requester: unlinked, target, now: NOW });
    expect(change).toMatchObject({ verdict: "deny", refusal: { disclosure: "explain", code: "not_linked" } });
  });

  test("a guest is capped at ask", () => {
    const guest = { kind: "external_actor" as const, actor: { ...unlinked.actor, membership: "guest" as const } };
    expect(evaluateRequest(policies, { requestClass: "change", requester: guest, target, now: NOW }).refusal?.code).toBe("above_ceiling");
  });

  test("a linked member acts with their principal's grants", () => {
    const linkedActor = { kind: "external_actor" as const, actor: { ...unlinked.actor, linkState: "linked" as const, principalId: "person:dana" } };
    expect(evaluateRequest(policies, { requestClass: "publish", requester: linkedActor, target, now: NOW })).toMatchObject({ verdict: "allow", accountablePrincipalId: "person:dana" });
  });

  test("an agent publishes only under a responsible person who holds publish", () => {
    const agent = { kind: "agent" as const, agentId: "agent:a" };
    expect(evaluateRequest(policies, { requestClass: "change", requester: agent, target, now: NOW }).verdict).toBe("allow");
    const none = evaluateRequest(policies, { requestClass: "publish", requester: agent, target, now: NOW });
    expect(none).toEqual({ verdict: "deny", grantIds: [], refusal: { disclosure: "opaque" } });
    expect(evaluateRequest(policies, { requestClass: "publish", requester: agent, responsiblePrincipalId: "person:dana", target, now: NOW }))
      .toMatchObject({ verdict: "allow", accountablePrincipalId: "person:dana" });
    expect(evaluateRequest(policies, { requestClass: "release", requester: agent, responsiblePrincipalId: "person:dana", target, now: NOW }).verdict).toBe("deny");
  });

  test("a tracker delegation runs as the person who delegated, in tracker_driven mode only", () => {
    const linearPolicies = [...policies, ...defaultConnectionPolicies({ connectionId: "conn-linear", adapterId: "linear", instanceId: "org-acme", projectId: "proj-1", issuedById: "person:admin", now: NOW })];
    const event = { kind: "integration_event" as const, adapterId: "linear", delegatorPrincipalId: "person:dana" };
    const ctx = { requestClass: "change" as const, requester: event, target: { projectId: "proj-1", connectionId: "conn-linear" }, now: NOW };
    expect(evaluateRequest(linearPolicies, { ...ctx, facts: { runMode: "tracker_driven" } }).verdict).toBe("allow");
    expect(evaluateRequest(linearPolicies, { ...ctx, facts: { runMode: "observer" } }).refusal?.code).toBe("run_mode");
  });
});

describe("ledger rules", () => {
  test("a sweep applies only after a clean full run, and a mass delete is held", () => {
    const hold = { ratio: 0.3, minimum: 10 };
    expect(sweepAllowed({ mode: "full", outcome: "clean" }, 5, 100, hold)).toBe("apply");
    expect(sweepAllowed({ mode: "full", outcome: "clean" }, 40, 100, hold)).toBe("hold");
    expect(sweepAllowed({ mode: "full", outcome: "partial" }, 1, 100, hold)).toBe("skip");
    expect(sweepAllowed({ mode: "incremental", outcome: "clean" }, 1, 100, hold)).toBe("skip");
  });
});

// ---------------------------------------------------------------------------
// Descriptor fixtures: one module per external system.

export const LINEAR_DESCRIPTOR: AdapterDescriptor = {
  schema: ADAPTER_DESCRIPTOR_SCHEMA,
  adapterId: "linear",
  version: "20261107_01",
  displayName: "Linear",
  kinds: ["ticket"],
  transport: "native",
  auth: { mode: "oauth2", actor: "app", scopes: ["read", "write", "app:assignable", "app:mentionable"] },
  events: { delivery: "webhook", verification: "hmac_sha256", eventIdPath: "$.headers.linear-delivery", eventTypePath: "$.type", timestampPath: "$.webhookTimestamp", toleranceMs: 60_000, ackDeadlineMs: 5_000, retries: "3 retries at 1 min, 1 h, 6 h; may auto-disable" },
  identity: [{
    kind: "linear_user", keyPath: "$.id", displayNamePath: "$.name", emailPath: "$.email",
    actorType: { path: "$.botActor.type", map: { ai: "foreign_agent", workflow: "integration", slack: "integration" } },
  }],
  streams: [
    {
      name: "issues", kind: "ticket", objectKind: "ticket", primaryKey: "$.id", containerPath: "$.team.id",
      cursor: { mode: "updated_at", field: "$.updatedAt" }, syncModes: ["incremental", "webhook"],
      deletion: { mode: "flag_field", flagPath: "$.archivedAt" }, revisionPath: "$.updatedAt", remoteUpdatedAtPath: "$.updatedAt",
      fields: {
        title: "$.title",
        summary: { from: "$.description", typecast: "markdown" },
        priority: { from: "$.priority", enum: { "0": "unset", "1": "urgent", "2": "high", "3": "normal", "4": "low" } },
        labels: { from: "$.labels.nodes[*].name", typecast: "string_array" },
        state: "$.state.type",
        ownerId: { from: "$.assignee.id", identity: "linear_user" },
        relations: "$.relations.nodes[*]",
        parentId: "$.parent.id",
        x_delegate: { from: "$.delegate.id", identity: "linear_user" },
        x_branch_name: "$.branchName",
      },
      stateCategories: { path: "$.state.type", map: { triage: "triage", backlog: "backlog", unstarted: "unstarted", started: "started", completed: "completed", canceled: "canceled" } },
      audience: { containerPath: "$.team.id", visibility: { path: "$.team.private", map: { true: "private", false: "org_public" } } },
      addressing: [{ kind: "delegation", path: "$.delegate.id" }],
    },
    {
      name: "comments", kind: "ticket", objectKind: "comment", primaryKey: "$.id", containerPath: "$.issue.team.id",
      cursor: { mode: "updated_at", field: "$.updatedAt" }, syncModes: ["incremental", "webhook"],
      deletion: { mode: "tombstone_event" }, hashExclude: ["$.reactionData"],
      fields: { body: { from: "$.body", typecast: "markdown" }, authorId: { from: "$.user.id", identity: "linear_user" }, issueId: "$.issue.id" },
      // A comment synced from a Slack thread is the same object as the Slack message: keep one copy.
      sameAs: [{ adapterId: "slack", objectKind: "message", keyPaths: ["$.syncedWith[*].metadata.channelId", "$.syncedWith[*].id"], originalWhenPath: "$.syncedWith[*].metadata.isFromSlack" }],
    },
    {
      name: "agent_sessions", kind: "ticket", objectKind: "agent_session", primaryKey: "$.agentSession.id",
      cursor: { mode: "event_only" }, syncModes: ["webhook"], deletion: { mode: "none" },
      fields: { issueId: "$.agentSession.issue.id", status: "$.agentSession.status", prompt: "$.agentActivity.body", creatorId: { from: "$.agentSession.creator.id", identity: "linear_user" } },
      addressing: [{ kind: "agent_session_prompt", path: "$.action" }],
    },
  ],
  capabilities: {
    ownableFields: ["title", "summary", "priority", "labels", "state", "ownerId", "relations", "parentId"],
    writes: ["comment", "transition", "set_fields", "set_backlink", "attach", "create", "activity", "set_plan", "set_delegate"],
    agentNative: ["agent_session", "activity", "plan", "delegate", "elicitation_select", "elicitation_auth", "session_summary", "external_links", "present_as"],
    routingRuleKinds: ["comment_command", "label", "state_lane", "user_mapping", "default_route"],
    trackerAutomation: { prDrivenStateMovesPath: "$.team.gitAutomationStates.nodes[*]" },
  },
  echo: { marker: "external_link", authorPath: "$.actor.id" },
  errors: [
    { match: { status: 429 }, category: "rate_limited", retryAfterHeader: "Retry-After" },
    { match: { status: 400, code: "RATELIMITED" }, category: "rate_limited" },
    { match: { status: 401 }, category: "auth" },
  ],
  rateLimit: { requestsPerHour: 5000, retryAfterHeader: "Retry-After" },
};

export const SLACK_DESCRIPTOR: AdapterDescriptor = {
  schema: ADAPTER_DESCRIPTOR_SCHEMA,
  adapterId: "slack",
  version: "20261107_01",
  displayName: "Slack",
  kinds: ["channel"],
  transport: "native",
  auth: { mode: "bot_token", actor: "app", scopes: ["app_mentions:read", "chat:write", "chat:write.customize", "im:history", "channels:history"] },
  events: { delivery: "socket", verification: "slack_signing_v0", eventIdPath: "$.event_id", eventTypePath: "$.event.type", timestampPath: "$.event_time", ackDeadlineMs: 3_000 },
  identity: [{
    kind: "slack_user", keyPath: "$.id", enterpriseKeyPath: "$.enterprise_user.id", displayNamePath: "$.profile.display_name", emailPath: "$.profile.email",
    actorType: { path: "$.is_bot", map: { true: "integration" } },
    membership: { path: "$.is_restricted", map: { true: "guest", false: "member" } },
  }],
  streams: [{
    name: "messages", kind: "channel", objectKind: "message", primaryKey: ["$.event.channel", "$.event.ts"], containerPath: "$.event.channel",
    cursor: { mode: "event_only" }, syncModes: ["webhook"], deletion: { mode: "tombstone_event" },
    fields: { text: "$.event.text", authorId: { from: "$.event.user", identity: "slack_user" }, threadTs: "$.event.thread_ts", metadata: "$.event.metadata" },
    audience: { containerPath: "$.event.channel", visibility: { path: "$.channel_type", map: { channel: "org_public", group: "private", im: "private", mpim: "private" } } },
    addressing: [
      { kind: "mention_of_app", path: "$.event.type" },
      { kind: "direct_message", path: "$.event.channel_type", value: "im" },
      { kind: "slash_command" },
      { kind: "bound_thread_reply", threadPath: "$.event.thread_ts" },
    ],
  }],
  capabilities: { ownableFields: [], writes: ["post", "update", "react", "upload", "unfurl"], agentNative: ["present_as"], routingRuleKinds: ["default_route"] },
  echo: { marker: "message_metadata", markerPath: "$.event.metadata.event_payload.deliveryId", authorPath: "$.event.bot_id" },
  errors: [{ match: { status: 429 }, category: "rate_limited", retryAfterHeader: "Retry-After" }, { match: { code: "invalid_auth" }, category: "auth" }],
  rateLimit: { perContainerPerSecond: 1, retryAfterHeader: "Retry-After" },
};

export const GITHUB_DESCRIPTOR: AdapterDescriptor = {
  schema: ADAPTER_DESCRIPTOR_SCHEMA,
  adapterId: "github",
  version: "20261107_01",
  displayName: "GitHub",
  kinds: ["repo"],
  transport: "native",
  auth: { mode: "app_installation", actor: "app", scopes: ["pull_requests:read", "checks:read", "contents:read"] },
  events: { delivery: "webhook", verification: "hmac_sha256", eventIdPath: "$.headers.x-github-delivery", eventTypePath: "$.headers.x-github-event", ackDeadlineMs: 10_000 },
  identity: [{ kind: "github_user", keyPath: "$.id", displayNamePath: "$.login", actorType: { path: "$.type", map: { Bot: "integration" } } }],
  streams: [{
    name: "pull_requests", kind: "repo", objectKind: "pull_request", primaryKey: "$.pull_request.node_id", containerPath: "$.repository.node_id",
    cursor: { mode: "updated_at", field: "$.pull_request.updated_at" }, syncModes: ["webhook", "incremental", "full"],
    deletion: { mode: "full_sweep", massDeleteHold: { ratio: 0.3, minimum: 10 } }, hashExclude: ["$.pull_request.comments"],
    fields: { state: "$.pull_request.state", merged: "$.pull_request.merged", headSha: "$.pull_request.head.sha", headRef: "$.pull_request.head.ref", authorId: { from: "$.pull_request.user.id", identity: "github_user" } },
    audience: { containerPath: "$.repository.node_id", visibility: { path: "$.repository.visibility", map: { public: "org_public", internal: "org_public", private: "private" } } },
  }],
  capabilities: { ownableFields: [], writes: ["comment", "open_pull_request"], agentNative: [], routingRuleKinds: [] },
  echo: { marker: "body_marker", markerPath: "$.pull_request.body" },
  errors: [{ match: { status: 403, code: "rate_limited" }, category: "rate_limited", retryAfterHeader: "Retry-After" }, { match: { status: 401 }, category: "auth" }],
};

describe("adapter descriptors", () => {
  test("the Linear, Slack and GitHub fixtures validate", () => {
    expect(validateAdapterDescriptor(LINEAR_DESCRIPTOR)).toEqual([]);
    expect(validateAdapterDescriptor(SLACK_DESCRIPTOR)).toEqual([]);
    expect(validateAdapterDescriptor(GITHUB_DESCRIPTOR)).toEqual([]);
  });

  test("the validator catches declarations the normalizer cannot honor", () => {
    const bad: AdapterDescriptor = {
      ...GITHUB_DESCRIPTOR,
      version: "v2",
      streams: [{ ...GITHUB_DESCRIPTOR.streams[0]!, syncModes: ["webhook"], deletion: { mode: "full_sweep" }, fields: { authorId: { from: "$.user.id", identity: "nobody" } } }],
    };
    expect(validateAdapterDescriptor(bad)).toEqual([
      "version must be YYYYMMDD_NN",
      "stream pull_requests: full_sweep deletion needs a full sync mode",
      "stream pull_requests: full_sweep deletion needs a massDeleteHold",
      "stream pull_requests.authorId: identity kind nobody is not declared",
    ]);
    const noAddressing = { ...SLACK_DESCRIPTOR, streams: [{ ...SLACK_DESCRIPTOR.streams[0]!, addressing: [] }] };
    expect(validateAdapterDescriptor(noAddressing)).toEqual(["stream messages: message streams declare addressing rules; everything else is ambient"]);
  });
});
