/**
 * Team policy contract, `scout-access/2`. Spike: nothing in the runtime calls
 * this yet, and `scout-access/1` is unchanged.
 *
 * A team has one authority key, held by a control layer. The control layer
 * signs a short-lived policy that names the team's members, hosts, projects
 * and grants. A host pins the authority key when it joins, fetches the policy,
 * and enforces it locally. Content never passes through the control layer.
 *
 * Rules a host applies:
 * - Only a policy signed by the pinned key changes what the host enforces. A
 *   matching team id with another key is refused; there is no key rotation.
 * - Revisions never go down, and a cached policy is enforced until it expires
 *   and not after. Revocation therefore reaches a host at its next refresh and
 *   no later than the expiry of the policy it holds.
 * - A personal host acts for its owner. A team-owned host acts under grants
 *   made to the host itself; a person it names is attribution only, and a
 *   request it makes as a person is refused.
 * - On a personal host the resource must also be in the host's own enrolment,
 *   and a local deny wins. On a team-owned host the policy decides.
 */
import { canonicalJson, signNodePayload, verifyNodeSignature, type NodeIdentity } from "./node-identity-wire.js";
import {
  ACCESS_ACTIONS,
  ACCESS_CLOCK_SKEW_MS,
  MeshAccessError,
  accessKeyId,
  accessScopeMatches,
  validateAccessScope,
  type AccessAction,
  type AccessResource,
  type AccessScope,
} from "./mesh-access.js";

export const TEAM_POLICY_PROTOCOL = "scout-access/2" as const;
export const TEAM_POLICY_SCHEMA_VERSION = 1 as const;
/** Longest lifetime a host accepts. It is also the upper bound on revocation latency. */
export const TEAM_POLICY_MAX_TTL_MS = 24 * 60 * 60_000;
export const TEAM_POLICY_MAX_BYTES = 256 * 1024;
/** `admin` stays out of team grants: it is not defined for teams yet. */
export const TEAM_GRANT_ACTIONS: readonly AccessAction[] = ACCESS_ACTIONS.filter((action) => action !== "admin");

export type TeamRole = "owner" | "admin" | "member";
export type TeamAuthority = { id: string; publicKey: string; label: string };
export type TeamMember = { personId: string; label: string; role: TeamRole };
export type TeamHost =
  | { hostId: string; publicKey: string; label: string; ownership: "personal"; ownerPersonId: string }
  | { hostId: string; publicKey: string; label: string; ownership: "team" };
/** A project is named by (hostId, projectId). A policy carries no filesystem path. */
export type TeamProject = { hostId: string; projectId: string; label: string };
export type TeamGrantSubject =
  | { kind: "person"; personId: string }
  /** Covers the named role and every role above it. */
  | { kind: "role"; role: TeamRole }
  /** A team-owned host acting as itself. */
  | { kind: "host"; hostId: string };
/** Which hosts a grant applies on. Empty is always no access. */
export type TeamGrantHosts = { all: boolean; hostIds: string[] };
export type TeamGrant = { id: string; subject: TeamGrantSubject; hosts: TeamGrantHosts; scope: AccessScope; actions: AccessAction[] };
export type TeamPolicy = {
  protocol: typeof TEAM_POLICY_PROTOCOL;
  kind: "team-policy";
  schemaVersion: typeof TEAM_POLICY_SCHEMA_VERSION;
  /** Names this signed document, for audit. A refresh gets a new one. */
  policyId: string;
  /** Opaque. Stays the same when the control layer moves or is self-hosted. */
  teamId: string;
  authority: TeamAuthority;
  label: string;
  /** Goes up with every change to the content below. */
  revision: number;
  issuedAt: number;
  expiresAt: number;
  members: TeamMember[];
  hosts: TeamHost[];
  projects: TeamProject[];
  grants: TeamGrant[];
  revokedHostIds: string[];
  signature: string;
};
export type TeamPin = { teamId: string; authority: TeamAuthority };

const ROLE_RANK: Record<TeamRole, number> = { member: 1, admin: 2, owner: 3 };
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:@-]{0,199}$/;

function fail(code: string, message: string, status = 400): never { throw new MeshAccessError(code, message, status); }
function need(condition: unknown, message: string): asserts condition { if (!condition) fail("invalid_team_policy", message); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function keys(value: unknown, expected: string[]): asserts value is Record<string, unknown> {
  need(isRecord(value) && Object.keys(value).length === expected.length && Object.keys(value).every((key) => expected.includes(key)), "unexpected or missing team policy fields");
}
function id(value: unknown): value is string { return typeof value === "string" && ID.test(value); }
function label(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 100; }
function list(value: unknown, what: string): asserts value is unknown[] { need(Array.isArray(value) && value.length <= 1000, `invalid ${what}`); }
function idList(value: unknown, what: string): asserts value is string[] {
  list(value, what);
  need(value.every(id) && new Set(value).size === value.length, `invalid or duplicate ${what}`);
}

export function signTeamPolicy(authority: NodeIdentity, policy: Omit<TeamPolicy, "signature">): TeamPolicy {
  return { ...policy, signature: signNodePayload(authority, canonicalJson(policy)) };
}

/** What a revision covers: everything but the fields a refresh rewrites. */
export function teamPolicyContent(policy: TeamPolicy): string {
  const { policyId: _id, issuedAt: _issued, expiresAt: _expires, signature: _signature, ...content } = policy;
  return canonicalJson(content);
}

/**
 * Checks shape, references, lifetime and the signature against the pinned
 * authority. It trusts nothing in the document about who may sign it.
 */
export function validateTeamPolicy(value: unknown, pin: TeamPin, now = Date.now()): TeamPolicy {
  keys(value, ["protocol", "kind", "schemaVersion", "policyId", "teamId", "authority", "label", "revision", "issuedAt", "expiresAt", "members", "hosts", "projects", "grants", "revokedHostIds", "signature"]);
  const policy = value as TeamPolicy;
  need(policy.protocol === TEAM_POLICY_PROTOCOL && policy.kind === "team-policy" && policy.schemaVersion === TEAM_POLICY_SCHEMA_VERSION, "unsupported team policy protocol, kind or schema version");
  need(id(policy.policyId) && id(policy.teamId) && label(policy.label), "invalid team policy identity");
  if (policy.teamId !== pin.teamId) fail("team_mismatch", "policy is for another team", 403);

  keys(policy.authority, ["id", "publicKey", "label"]);
  need(label(policy.authority.label) && accessKeyId(policy.authority.publicKey) === policy.authority.id, "authority key and id do not match");
  if (policy.authority.id !== pin.authority.id || policy.authority.publicKey !== pin.authority.publicKey) {
    fail("team_authority_mismatch", "policy names an authority this host did not pin", 403);
  }

  need(Number.isSafeInteger(policy.revision) && policy.revision >= 1, "invalid policy revision");
  need(Number.isSafeInteger(policy.issuedAt) && Number.isSafeInteger(policy.expiresAt) && policy.expiresAt > policy.issuedAt
    && policy.expiresAt - policy.issuedAt <= TEAM_POLICY_MAX_TTL_MS && policy.issuedAt <= now + ACCESS_CLOCK_SKEW_MS, "policy is future-dated or exceeds the maximum lifetime");
  if (policy.expiresAt <= now) fail("team_policy_expired", "policy has expired", 403);

  list(policy.members, "members");
  const roles = new Map<string, TeamRole>();
  for (const member of policy.members as TeamMember[]) {
    keys(member, ["personId", "label", "role"]);
    need(id(member.personId) && label(member.label) && Object.hasOwn(ROLE_RANK, member.role), "invalid member");
    need(!roles.has(member.personId), "duplicate member");
    roles.set(member.personId, member.role);
  }
  need([...roles.values()].includes("owner"), "a team needs an owner");

  list(policy.hosts, "hosts");
  const ownership = new Map<string, TeamHost["ownership"]>();
  for (const host of policy.hosts as TeamHost[]) {
    need(isRecord(host) && (host.ownership === "personal" || host.ownership === "team"), "invalid host ownership");
    keys(host, host.ownership === "personal" ? ["hostId", "publicKey", "label", "ownership", "ownerPersonId"] : ["hostId", "publicKey", "label", "ownership"]);
    need(label(host.label) && accessKeyId(host.publicKey) === host.hostId, "host key and id do not match");
    need(!ownership.has(host.hostId) && host.hostId !== policy.authority.id, "duplicate host or host using the authority key");
    need(host.ownership === "team" || roles.has(host.ownerPersonId), "personal host owner is not a member");
    ownership.set(host.hostId, host.ownership);
  }

  list(policy.projects, "projects");
  const projects = new Map<string, Set<string>>();
  for (const project of policy.projects as TeamProject[]) {
    keys(project, ["hostId", "projectId", "label"]);
    need(id(project.projectId) && label(project.label) && ownership.has(project.hostId), "invalid project or unknown host");
    const onHost = projects.get(project.hostId) ?? new Set<string>();
    need(!onHost.has(project.projectId), "duplicate project on a host");
    projects.set(project.hostId, onHost.add(project.projectId));
  }

  list(policy.grants, "grants");
  const grantIds = new Set<string>();
  for (const grant of policy.grants as TeamGrant[]) {
    keys(grant, ["id", "subject", "hosts", "scope", "actions"]);
    need(id(grant.id) && !grantIds.has(grant.id), "invalid or duplicate grant id");
    grantIds.add(grant.id);
    need(isRecord(grant.subject), "invalid grant subject");
    if (grant.subject.kind === "person") {
      keys(grant.subject, ["kind", "personId"]);
      need(roles.has(grant.subject.personId), "grant names a person who is not a member");
    } else if (grant.subject.kind === "role") {
      keys(grant.subject, ["kind", "role"]);
      need(Object.hasOwn(ROLE_RANK, grant.subject.role), "grant names an unknown role");
    } else {
      need(grant.subject.kind === "host", "invalid grant subject");
      keys(grant.subject, ["kind", "hostId"]);
      need(ownership.get(grant.subject.hostId) === "team", "only a team-owned host can hold a grant as itself");
    }
    keys(grant.hosts, ["all", "hostIds"]);
    need(typeof grant.hosts.all === "boolean", "grant hosts.all must be explicit");
    idList(grant.hosts.hostIds, "grant hosts");
    need(!grant.hosts.all || grant.hosts.hostIds.length === 0, "all hosts cannot be combined with selected hosts");
    need(grant.hosts.hostIds.every((hostId) => ownership.has(hostId)), "grant names a host that is not in the team");
    validateAccessScope(grant.scope);
    const reachable = grant.hosts.all ? [...ownership.keys()] : grant.hosts.hostIds;
    need(grant.scope.projectIds.every((projectId) => reachable.some((hostId) => projects.get(hostId)?.has(projectId))), "grant names a project none of its hosts lists");
    need(Array.isArray(grant.actions) && grant.actions.length > 0 && grant.actions.every((action) => TEAM_GRANT_ACTIONS.includes(action))
      && new Set(grant.actions).size === grant.actions.length, "invalid grant actions");
  }

  idList(policy.revokedHostIds, "revoked hosts");
  need(typeof policy.signature === "string" && policy.signature.length <= 100, "invalid policy signature");
  const { signature, ...unsigned } = policy;
  const payload = canonicalJson(unsigned);
  need(payload.length <= TEAM_POLICY_MAX_BYTES, "policy is too large");
  if (!verifyNodeSignature(pin.authority.publicKey, payload, signature)) fail("team_policy_signature", "policy is not signed by the pinned authority", 403);
  return policy;
}

export type TeamPrincipal = { kind: "person"; personId: string; role: TeamRole } | { kind: "host"; hostId: string };
export type TeamAccessRequest = {
  /** The key id the peer authenticated with. The caller has already verified its signature. */
  peerHostId: string;
  /** The person the peer acts as. Honoured only when the peer is that person's own host. */
  personId?: string;
  /** Recorded and returned. Never used to decide. */
  attributedTo?: string;
  action: AccessAction;
  resource: AccessResource;
};
export type TeamDenyReason =
  | "no_policy" | "policy_expired" | "host_not_in_team" | "peer_not_in_team" | "peer_revoked"
  | "person_mismatch" | "person_assertion_unsupported" | "no_grant" | "not_enrolled" | "local_deny";
export type TeamDecision =
  | { allowed: true; teamId: string; policyId: string; revision: number; principal: TeamPrincipal; grantIds: string[]; attributedTo?: string }
  | { allowed: false; teamId: string; reason: TeamDenyReason; revision?: number };
/** What a personal host has chosen to share with the team, and what it hides. */
export type TeamLocalRules = { enrolled: { agentIds: string[]; projectIds: string[] }; denied: { agentIds: string[]; projectIds: string[] } };
export type TeamHostState = { pin: TeamPin; hostId: string; highestRevision: number; policy?: TeamPolicy; local: TeamLocalRules };

function grantCoversSubject(subject: TeamGrantSubject, principal: TeamPrincipal): boolean {
  if (principal.kind === "host") return subject.kind === "host" && subject.hostId === principal.hostId;
  if (subject.kind === "person") return subject.personId === principal.personId;
  return subject.kind === "role" && ROLE_RANK[principal.role] >= ROLE_RANK[subject.role];
}

/** One decision against an accepted, unexpired policy. Pure. */
export function evaluateTeamAccess(policy: TeamPolicy, selfHostId: string, local: TeamLocalRules, request: TeamAccessRequest): TeamDecision {
  const deny = (reason: TeamDenyReason): TeamDecision => ({ allowed: false, teamId: policy.teamId, reason, revision: policy.revision });
  const self = policy.hosts.find((host) => host.hostId === selfHostId);
  if (!self || policy.revokedHostIds.includes(selfHostId)) return deny("host_not_in_team");
  if (policy.revokedHostIds.includes(request.peerHostId)) return deny("peer_revoked");
  const peer = policy.hosts.find((host) => host.hostId === request.peerHostId);
  if (!peer) return deny("peer_not_in_team");

  let principal: TeamPrincipal;
  if (peer.ownership === "team") {
    if (request.personId !== undefined) return deny("person_assertion_unsupported");
    principal = { kind: "host", hostId: peer.hostId };
  } else {
    if (request.personId !== undefined && request.personId !== peer.ownerPersonId) return deny("person_mismatch");
    const owner = policy.members.find((member) => member.personId === peer.ownerPersonId);
    if (!owner) return deny("peer_not_in_team");
    principal = { kind: "person", personId: owner.personId, role: owner.role };
  }

  const grantIds = policy.grants
    .filter((grant) => grantCoversSubject(grant.subject, principal)
      && (grant.hosts.all || grant.hosts.hostIds.includes(selfHostId))
      && grant.actions.includes(request.action) && accessScopeMatches(grant.scope, request.resource))
    .map((grant) => grant.id);
  if (grantIds.length === 0) return deny("no_grant");

  if (self.ownership === "personal") {
    if (!accessScopeMatches({ all: false, ...local.enrolled }, request.resource)) return deny("not_enrolled");
    if (accessScopeMatches({ all: false, ...local.denied }, request.resource)) return deny("local_deny");
  }
  return {
    allowed: true, teamId: policy.teamId, policyId: policy.policyId, revision: policy.revision, principal, grantIds,
    ...(request.attributedTo === undefined ? {} : { attributedTo: request.attributedTo }),
  };
}

/**
 * A host's membership in one team: the pinned authority, the newest policy it
 * accepted, the highest revision it has seen, and its local rules. `state()`
 * is what a host must persist; losing `highestRevision` reopens rollback.
 */
export class TeamPolicyHost {
  private readonly pin: TeamPin;
  private readonly hostId: string;
  private highestRevision: number;
  private policy: TeamPolicy | undefined;
  private local: TeamLocalRules;

  constructor(input: { pin: TeamPin; hostId: string } | TeamHostState) {
    need(id(input.pin.teamId) && accessKeyId(input.pin.authority.publicKey) === input.pin.authority.id, "invalid team pin");
    this.pin = structuredClone(input.pin);
    this.hostId = input.hostId;
    this.highestRevision = "highestRevision" in input ? input.highestRevision : 0;
    // A saved policy is checked like any other, as of its own issue time: saved state earns no extra trust.
    const saved: unknown = "policy" in input ? input.policy : undefined;
    this.policy = saved === undefined ? undefined
      : structuredClone(validateTeamPolicy(saved, this.pin, isRecord(saved) && typeof saved.issuedAt === "number" ? saved.issuedAt : 0));
    this.local = "local" in input ? structuredClone(input.local) : { enrolled: { agentIds: [], projectIds: [] }, denied: { agentIds: [], projectIds: [] } };
    need(Number.isSafeInteger(this.highestRevision) && this.highestRevision >= (this.policy?.revision ?? 0), "saved state is behind its own policy");
  }

  /** Takes a policy from anywhere. Throws unless it is signed by the pin, current, and not older than what this host holds. */
  accept(value: unknown, now = Date.now()): TeamPolicy {
    const next = validateTeamPolicy(value, this.pin, now);
    const held = this.policy;
    if (next.revision < this.highestRevision) fail("team_policy_rollback", "policy revision is older than one this host has accepted", 409);
    if (held && next.revision === held.revision) {
      if (teamPolicyContent(next) !== teamPolicyContent(held)) fail("team_policy_conflict", "two policies share a revision but differ", 409);
      if (next.issuedAt < held.issuedAt) fail("team_policy_rollback", "policy is an older issue of the revision this host holds", 409);
    }
    this.policy = structuredClone(next);
    this.highestRevision = next.revision;
    return next;
  }

  /** The policy in force, or nothing once it has expired. */
  current(now = Date.now()): TeamPolicy | undefined {
    return this.policy && this.policy.expiresAt > now ? this.policy : undefined;
  }

  /** Revision to send as `after`. Omitted in the second half of a policy's life, so the reply carries a fresh expiry. */
  refreshAfter(now = Date.now()): number | undefined {
    const policy = this.current(now);
    return policy && policy.expiresAt - now > (policy.expiresAt - policy.issuedAt) / 2 ? policy.revision : undefined;
  }

  /** Public key of a host that may connect as a team peer right now. */
  peerKey(hostId: string, now = Date.now()): string | undefined {
    const policy = this.current(now);
    if (!policy || policy.revokedHostIds.includes(hostId)) return undefined;
    return policy.hosts.find((host) => host.hostId === hostId)?.publicKey;
  }

  setLocal(local: TeamLocalRules): void {
    for (const selectors of [local.enrolled.agentIds, local.enrolled.projectIds, local.denied.agentIds, local.denied.projectIds]) idList(selectors, "local selectors");
    this.local = structuredClone(local);
  }

  evaluate(request: TeamAccessRequest, now = Date.now()): TeamDecision {
    if (!this.policy) return { allowed: false, teamId: this.pin.teamId, reason: "no_policy" };
    if (this.policy.expiresAt <= now) return { allowed: false, teamId: this.pin.teamId, reason: "policy_expired", revision: this.policy.revision };
    return evaluateTeamAccess(this.policy, this.hostId, this.local, request);
  }

  state(): TeamHostState {
    return structuredClone({ pin: this.pin, hostId: this.hostId, highestRevision: this.highestRevision, ...(this.policy ? { policy: this.policy } : {}), local: this.local });
  }
}
