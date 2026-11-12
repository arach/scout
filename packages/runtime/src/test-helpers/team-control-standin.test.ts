/**
 * Stand-in for the team control layer, in process and in memory. It holds a
 * team's records, signs its policy, and answers the three host endpoints. It
 * exists so the host side of `scout-access/2` can be exercised; it is not a
 * service and nothing ships it.
 *
 * `session` stands for a signed-in person. A real control layer derives it
 * from its own sign-in; a request body never supplies it.
 */
import { randomUUID } from "node:crypto";
import { nodeKeyId, type NodeIdentity } from "../node-identity-wire.js";
import { MeshAccessError, accessKeyId } from "../mesh-access.js";
import { PEER_AUTH_HEADERS, PeerNonceCache, verifyPeerRequest } from "../mesh-peer-auth.js";
import {
  TEAM_POLICY_PROTOCOL,
  TEAM_POLICY_SCHEMA_VERSION,
  signTeamPolicy,
  validateTeamPolicy,
  type TeamGrant,
  type TeamHost,
  type TeamMember,
  type TeamPin,
  type TeamPolicy,
  type TeamProject,
  type TeamRole,
} from "../team-policy.js";

export type StandInSession = { personId: string };
export type StandInRequest = { method: string; path: string; body?: string; headers?: Record<string, string>; session?: StandInSession };
export type StandInResponse = { status: number; body?: unknown };
type State = { revision: number; members: TeamMember[]; hosts: TeamHost[]; projects: TeamProject[]; grants: TeamGrant[]; revokedHostIds: string[] };

const HOSTS = /^\/v1\/teams\/([^/?]+)\/hosts$/;
const POLICY = /^\/v1\/teams\/([^/?]+)\/policy(?:\?after=(\d+))?$/;
const ENROLLMENT = /^\/v1\/teams\/([^/?]+)\/hosts\/([^/?]+)\/enrollment$/;

function refuse(status: number, code: string): never { throw new MeshAccessError(code, code, status); }
function parse(body: string | undefined, expected: string[]): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(body ?? ""); } catch { refuse(400, "invalid_body"); }
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || Object.keys(value).length !== expected.length || !Object.keys(value).every((key) => expected.includes(key))) refuse(400, "invalid_body");
  return value as Record<string, unknown>;
}

export class StandInTeamControl {
  readonly pin: TeamPin;
  private state: State;
  private readonly nonces = new PeerNonceCache();
  private readonly bootedAt: number;

  constructor(private readonly input: {
    teamId: string; label: string; authorityKey: NodeIdentity; owner: { personId: string; label: string }; ttlMs?: number; now: () => number;
  }) {
    this.pin = { teamId: input.teamId, authority: { id: nodeKeyId(input.authorityKey.publicKey), publicKey: input.authorityKey.publicKey, label: "Team control" } };
    this.state = { revision: 1, members: [{ ...input.owner, role: "owner" }], hosts: [], projects: [], grants: [], revokedHostIds: [] };
    this.bootedAt = input.now();
  }

  /** Signs the current records. Every call is a new document with a new expiry. */
  issue(state: State = this.state): TeamPolicy {
    const now = this.input.now();
    return signTeamPolicy(this.input.authorityKey, {
      protocol: TEAM_POLICY_PROTOCOL, kind: "team-policy", schemaVersion: TEAM_POLICY_SCHEMA_VERSION, policyId: randomUUID(),
      teamId: this.pin.teamId, authority: this.pin.authority, label: this.input.label, revision: state.revision,
      issuedAt: now, expiresAt: now + (this.input.ttlMs ?? 60 * 60_000),
      members: state.members, hosts: state.hosts, projects: state.projects, grants: state.grants, revokedHostIds: state.revokedHostIds,
    });
  }

  private role(session: StandInSession | undefined): TeamRole | undefined {
    return this.state.members.find((member) => member.personId === session?.personId)?.role;
  }
  private administrator(session: StandInSession | undefined): TeamRole {
    const role = this.role(session);
    if (role !== "owner" && role !== "admin") refuse(403, "not_an_administrator");
    return role;
  }
  /** Applies a change only if the policy it produces is one a host would accept. */
  private change(mutate: (draft: State) => void): void {
    const draft = structuredClone(this.state);
    mutate(draft);
    draft.revision += 1;
    validateTeamPolicy(this.issue(draft), this.pin, this.input.now());
    this.state = draft;
  }
  private static dropHost(draft: State, hostId: string): void {
    draft.hosts = draft.hosts.filter((host) => host.hostId !== hostId);
    draft.projects = draft.projects.filter((project) => project.hostId !== hostId);
    draft.grants = draft.grants.filter((grant) => !(grant.subject.kind === "host" && grant.subject.hostId === hostId));
    for (const grant of draft.grants) grant.hosts.hostIds = grant.hosts.hostIds.filter((id) => id !== hostId);
    StandInTeamControl.pruneProjects(draft);
    if (!draft.revokedHostIds.includes(hostId)) draft.revokedHostIds.push(hostId);
  }
  /** A grant keeps only the projects that one of its hosts still lists. */
  private static pruneProjects(draft: State): void {
    for (const grant of draft.grants) {
      const hostIds = grant.hosts.all ? draft.hosts.map((host) => host.hostId) : grant.hosts.hostIds;
      grant.scope.projectIds = grant.scope.projectIds.filter((projectId) => draft.projects.some((project) => project.projectId === projectId && hostIds.includes(project.hostId)));
    }
  }

  addMember(session: StandInSession, member: TeamMember): void {
    if (this.administrator(session) !== "owner" && member.role !== "member") refuse(403, "only_an_owner_names_administrators");
    this.change((draft) => { draft.members.push(member); });
  }
  removeMember(session: StandInSession, personId: string): void {
    this.administrator(session);
    this.change((draft) => {
      for (const host of draft.hosts.filter((entry) => entry.ownership === "personal" && entry.ownerPersonId === personId)) StandInTeamControl.dropHost(draft, host.hostId);
      draft.members = draft.members.filter((member) => member.personId !== personId);
      draft.grants = draft.grants.filter((grant) => !(grant.subject.kind === "person" && grant.subject.personId === personId));
    });
  }
  setGrant(session: StandInSession, grant: TeamGrant): void {
    this.administrator(session);
    this.change((draft) => { draft.grants = [...draft.grants.filter((entry) => entry.id !== grant.id), grant]; });
  }
  /** An administrator can revoke any host. A person can revoke their own. */
  revokeHost(session: StandInSession, hostId: string): void {
    const host = this.state.hosts.find((entry) => entry.hostId === hostId);
    if (!host) refuse(404, "unknown_host");
    if (!(host.ownership === "personal" && host.ownerPersonId === session.personId)) this.administrator(session);
    this.change((draft) => StandInTeamControl.dropHost(draft, hostId));
  }

  handle(request: StandInRequest): StandInResponse {
    try { return this.route(request); } catch (error) {
      if (error instanceof MeshAccessError) return { status: error.status, body: { error: error.code } };
      throw error;
    }
  }

  private authenticate(request: StandInRequest, lookup: (keyId: string) => string | undefined): string {
    const headers = request.headers ?? {};
    const result = verifyPeerRequest({
      method: request.method, path: request.path, body: request.body ?? "",
      headers: { peer: headers[PEER_AUTH_HEADERS.peer], ts: headers[PEER_AUTH_HEADERS.ts], nonce: headers[PEER_AUTH_HEADERS.nonce], signature: headers[PEER_AUTH_HEADERS.signature] },
      destinationKeyId: this.pin.authority.id,
      lookupPeer: (keyId) => { const publicKey = lookup(keyId); return publicKey ? { publicKey, tier: "observe" } : undefined; },
      nonceClaim: this.nonces, bootedAt: this.bootedAt, now: this.input.now(),
    });
    if (!result.ok) refuse(401, "unauthenticated");
    return result.principal.keyId;
  }
  private enrolledHost(request: StandInRequest): string {
    if (this.state.revokedHostIds.includes(request.headers?.[PEER_AUTH_HEADERS.peer] ?? "")) refuse(403, "host_revoked");
    return this.authenticate(request, (keyId) => this.state.hosts.find((host) => host.hostId === keyId)?.publicKey);
  }

  private route(request: StandInRequest): StandInResponse {
    const join = request.method === "POST" ? HOSTS.exec(request.path) : null;
    const policy = request.method === "GET" ? POLICY.exec(request.path) : null;
    const enrollment = request.method === "PUT" ? ENROLLMENT.exec(request.path) : null;
    const match = join ?? policy ?? enrollment;
    if (!match || match[1] !== this.pin.teamId) refuse(404, "not_found");

    if (join) {
      const role = this.role(request.session);
      if (!request.session) refuse(401, "sign_in_required");
      if (!role) refuse(403, "not_a_member");
      const body = parse(request.body, ["publicKey", "label", "ownership"]);
      const hostId = accessKeyId(body.publicKey);
      // The request is signed by the key being enrolled: nobody joins a key they do not hold.
      this.authenticate(request, (keyId) => (keyId === hostId ? (body.publicKey as string) : undefined));
      if (this.state.revokedHostIds.includes(hostId) || this.state.hosts.some((host) => host.hostId === hostId)) refuse(409, "host_already_known");
      if (body.ownership !== "personal" && body.ownership !== "team") refuse(400, "invalid_body");
      if (body.ownership === "team" && role === "member") refuse(403, "not_an_administrator");
      const base = { hostId, publicKey: body.publicKey as string, label: body.label as string };
      const ownerPersonId = request.session.personId;
      this.change((draft) => { draft.hosts.push(body.ownership === "team" ? { ...base, ownership: "team" } : { ...base, ownership: "personal", ownerPersonId }); });
      return { status: 201, body: { teamId: this.pin.teamId, authority: this.pin.authority, hostId, policy: this.issue() } };
    }

    const hostId = this.enrolledHost(request);
    if (policy) {
      if (policy[2] !== undefined && this.state.revision <= Number(policy[2])) return { status: 304 };
      return { status: 200, body: { policy: this.issue() } };
    }
    if (hostId !== match[2]) refuse(403, "not_this_host");
    const body = parse(request.body, ["projects"]);
    if (!Array.isArray(body.projects)) refuse(400, "invalid_body");
    const projects = (body.projects as unknown[]).map((entry) => {
      const project = parse(JSON.stringify(entry), ["projectId", "label"]);
      return { hostId, projectId: project.projectId as string, label: project.label as string };
    });
    this.change((draft) => {
      draft.projects = [...draft.projects.filter((project) => project.hostId !== hostId), ...projects];
      StandInTeamControl.pruneProjects(draft);
    });
    return { status: 200, body: { policy: this.issue() } };
  }
}
