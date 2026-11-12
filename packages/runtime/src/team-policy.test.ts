import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { nodeKeyId, type NodeIdentity } from "./node-identity-wire.js";
import { MeshAccessError, type AccessScope } from "./mesh-access.js";
import { PeerNonceCache, signPeerRequest, verifyPeerRequest } from "./mesh-peer-auth.js";
import { TeamPolicyHost, signTeamPolicy, validateTeamPolicy, type TeamAccessRequest, type TeamGrant, type TeamPolicy } from "./team-policy.js";
import { StandInTeamControl, type StandInResponse, type StandInSession } from "./test-helpers/team-control-standin.test.js";

const HOUR = 60 * 60_000;
const OWNER: StandInSession = { personId: "person-owner" };
const MEMBER: StandInSession = { personId: "person-member" };
const only = (projectId: string): AccessScope => ({ all: false, agentIds: [], projectIds: [projectId] });
const everything: AccessScope = { all: true, agentIds: [], projectIds: [] };

function key(): NodeIdentity {
  const pair = generateKeyPairSync("ed25519");
  return { version: 1, createdAt: 0, publicKey: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64"), privateKey: pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64") };
}
function code(run: () => unknown): string {
  try { run(); } catch (error) { if (error instanceof MeshAccessError) return error.code; throw error; }
  return "accepted";
}

/** A team with an owner, a member, a personal host for each, and one team-owned host. */
function team(ttlMs = HOUR) {
  const clock = { now: 1_800_000_000_000 };
  const authorityKey = key();
  const control = new StandInTeamControl({ teamId: "team-1", label: "Test team", authorityKey, owner: { personId: OWNER.personId, label: "Owner" }, ttlMs, now: () => clock.now });
  control.addMember(OWNER, { personId: MEMBER.personId, label: "Member", role: "member" });

  const call = (identity: NodeIdentity, method: string, path: string, body?: unknown, session?: StandInSession): StandInResponse => {
    const text = body === undefined ? undefined : JSON.stringify(body);
    return control.handle({ method, path, body: text, session, headers: signPeerRequest(identity, { method, path, body: text, destinationKeyId: control.pin.authority.id, ts: clock.now }) });
  };
  const join = (session: StandInSession, ownership: "personal" | "team", label: string) => {
    const identity = key();
    const response = call(identity, "POST", "/v1/teams/team-1/hosts", { publicKey: identity.publicKey, label, ownership }, session);
    expect(response.status).toBe(201);
    const joined = response.body as { teamId: string; authority: TeamPolicy["authority"]; hostId: string; policy: TeamPolicy };
    const host = new TeamPolicyHost({ pin: { teamId: joined.teamId, authority: joined.authority }, hostId: joined.hostId });
    host.accept(joined.policy, clock.now);
    return { identity, id: joined.hostId, host };
  };
  type Joined = ReturnType<typeof join>;
  /** What a host does on a timer: ask for the policy and take it if one comes back. */
  const pull = (member: Joined): number => {
    const after = member.host.refreshAfter(clock.now);
    const response = call(member.identity, "GET", `/v1/teams/team-1/policy${after === undefined ? "" : `?after=${after}`}`);
    if (response.status === 200) member.host.accept((response.body as { policy: TeamPolicy }).policy, clock.now);
    return response.status;
  };
  const enroll = (member: Joined, projectIds: string[]) => {
    const response = call(member.identity, "PUT", `/v1/teams/team-1/hosts/${member.id}/enrollment`, { projects: projectIds.map((projectId) => ({ projectId, label: projectId })) });
    expect(response.status).toBe(200);
    if (member.host.state().policy?.hosts.find((host) => host.hostId === member.id)?.ownership === "personal") {
      member.host.setLocal({ enrolled: { agentIds: [], projectIds }, denied: { agentIds: [], projectIds: [] } });
    }
  };
  const grant = (id: string, subject: TeamGrant["subject"], hostId: string, scope: AccessScope) =>
    control.setGrant(OWNER, { id, subject, hosts: { all: false, hostIds: [hostId] }, scope, actions: ["discover", "message", "request"] });

  const ownerHost = join(OWNER, "personal", "Owner laptop");
  const memberHost = join(MEMBER, "personal", "Member laptop");
  const buildHost = join(OWNER, "team", "Build host");
  const all = [ownerHost, memberHost, buildHost];
  const sync = () => all.map(pull);
  const ask = (from: Joined, projectId: string, extra: Partial<TeamAccessRequest> = {}): TeamAccessRequest =>
    ({ peerHostId: from.id, action: "message", resource: { agentId: "agent-1", projectId }, ...extra });
  return { clock, authorityKey, control, call, join, pull, enroll, grant, sync, ask, ownerHost, memberHost, buildHost };
}

describe("a host joins a team, pulls its policy and enforces it", () => {
  test("a member reaches a project the owner enrolled on a personal host, and nothing else", () => {
    const t = team();
    t.enroll(t.ownerHost, ["web", "notes"]);
    t.grant("grant-web", { kind: "person", personId: MEMBER.personId }, t.ownerHost.id, only("web"));
    t.sync();

    const decision = t.ownerHost.host.evaluate(t.ask(t.memberHost, "web"), t.clock.now);
    expect(decision).toMatchObject({ allowed: true, principal: { kind: "person", personId: MEMBER.personId, role: "member" }, grantIds: ["grant-web"] });
    expect(t.ownerHost.host.evaluate(t.ask(t.memberHost, "notes"), t.clock.now)).toMatchObject({ allowed: false, reason: "no_grant" });
    expect(t.ownerHost.host.evaluate(t.ask(t.memberHost, "web", { action: "read-history" }), t.clock.now)).toMatchObject({ allowed: false, reason: "no_grant" });
    // The grant names one host. The same project id elsewhere is not covered.
    t.memberHost.host.setLocal({ enrolled: { agentIds: [], projectIds: ["web"] }, denied: { agentIds: [], projectIds: [] } });
    expect(t.memberHost.host.evaluate(t.ask(t.memberHost, "web"), t.clock.now)).toMatchObject({ allowed: false, reason: "no_grant" });
  });

  test("the policy supplies the peer keys for the existing signed peer request", () => {
    const t = team();
    t.enroll(t.ownerHost, ["web"]);
    t.grant("grant-web", { kind: "role", role: "member" }, t.ownerHost.id, only("web"));
    t.sync();
    const verify = (from: NodeIdentity) => verifyPeerRequest({
      method: "POST", path: "/v1/messages", body: "{}", destinationKeyId: t.ownerHost.id, bootedAt: t.clock.now, now: t.clock.now, nonceClaim: new PeerNonceCache(),
      headers: (({ "x-openscout-peer": peer, "x-openscout-ts": ts, "x-openscout-nonce": nonce, "x-openscout-signature": signature }) => ({ peer, ts, nonce, signature }))(
        signPeerRequest(from, { method: "POST", path: "/v1/messages", body: "{}", destinationKeyId: t.ownerHost.id, ts: t.clock.now })),
      lookupPeer: (keyId) => { const publicKey = t.ownerHost.host.peerKey(keyId, t.clock.now); return publicKey ? { publicKey, tier: "observe" } : undefined; },
    });
    const peer = verify(t.memberHost.identity);
    expect(peer.ok && t.ownerHost.host.evaluate(t.ask({ ...t.memberHost, id: peer.principal.keyId }, "web"), t.clock.now).allowed).toBe(true);
    expect(verify(key()).ok).toBe(false);
  });

  test("a team-owned host serves on the policy alone", () => {
    const t = team();
    t.enroll(t.buildHost, ["release"]);
    t.grant("grant-release", { kind: "role", role: "member" }, t.buildHost.id, only("release"));
    t.sync();
    expect(t.buildHost.host.evaluate(t.ask(t.memberHost, "release"), t.clock.now).allowed).toBe(true);
    // A role grant covers the roles above it.
    expect(t.buildHost.host.evaluate(t.ask(t.ownerHost, "release"), t.clock.now)).toMatchObject({ allowed: true, principal: { role: "owner" } });
  });
});

describe("what a host refuses to accept", () => {
  test("a policy the authority did not sign, or one changed after signing", () => {
    const t = team();
    const held = t.ownerHost.host.state().policy!;
    const { signature: _, ...unsigned } = held;
    const forged = signTeamPolicy(key(), { ...unsigned, revision: held.revision + 1, grants: [{ id: "g", subject: { kind: "role", role: "member" }, hosts: { all: true, hostIds: [] }, scope: everything, actions: ["read-history"] }] });
    expect(code(() => t.ownerHost.host.accept(forged, t.clock.now))).toBe("team_policy_signature");
    expect(code(() => t.ownerHost.host.accept({ ...held, revision: held.revision + 1 }, t.clock.now))).toBe("team_policy_signature");
    expect(code(() => t.ownerHost.host.accept({ ...held, revokedHostIds: [t.memberHost.id] }, t.clock.now))).toBe("team_policy_signature");
    expect(t.ownerHost.host.state().policy).toEqual(held);
  });

  test("another authority that claims the same team", () => {
    const t = team();
    const impostorKey = key();
    const impostor = new StandInTeamControl({ teamId: "team-1", label: "Test team", authorityKey: impostorKey, owner: { personId: "person-else", label: "Else" }, now: () => t.clock.now + 1 });
    for (let i = 0; i < 20; i += 1) impostor.addMember({ personId: "person-else" }, { personId: `person-${i}`, label: "Extra", role: "member" });
    const policy = impostor.issue();
    expect(validateTeamPolicy(policy, impostor.pin, t.clock.now + 1).revision).toBeGreaterThan(t.ownerHost.host.state().highestRevision);
    expect(code(() => t.ownerHost.host.accept(policy, t.clock.now + 1))).toBe("team_authority_mismatch");
    // Naming the pinned authority without holding its key fails on the signature instead.
    const { signature: _, ...unsigned } = policy;
    expect(code(() => t.ownerHost.host.accept(signTeamPolicy(impostorKey, { ...unsigned, authority: t.control.pin.authority }), t.clock.now + 1))).toBe("team_policy_signature");
  });

  test("an older revision, also after a restart", () => {
    const t = team();
    const old = t.ownerHost.host.state().policy!;
    t.enroll(t.ownerHost, ["web"]);
    t.grant("grant-web", { kind: "person", personId: MEMBER.personId }, t.ownerHost.id, only("web"));
    t.sync();
    const wide = t.ownerHost.host.state().policy!;
    expect(t.ownerHost.host.evaluate(t.ask(t.memberHost, "web"), t.clock.now).allowed).toBe(true);
    // The grant is narrowed to discovery. Replaying the wider policy must not bring messaging back.
    t.control.setGrant(OWNER, { id: "grant-web", subject: { kind: "person", personId: MEMBER.personId }, hosts: { all: false, hostIds: [t.ownerHost.id] }, scope: only("web"), actions: ["discover"] });
    t.sync();
    expect(wide.revision).toBeGreaterThan(old.revision);
    expect(code(() => t.ownerHost.host.accept(old, t.clock.now))).toBe("team_policy_rollback");
    expect(code(() => t.ownerHost.host.accept(wide, t.clock.now))).toBe("team_policy_rollback");
    expect(t.ownerHost.host.evaluate(t.ask(t.memberHost, "web"), t.clock.now)).toMatchObject({ allowed: false, reason: "no_grant" });

    const saved = t.ownerHost.host.state();
    const restarted = new TeamPolicyHost(JSON.parse(JSON.stringify(saved)));
    expect(code(() => restarted.accept(old, t.clock.now))).toBe("team_policy_rollback");
    expect(restarted.evaluate(t.ask(t.memberHost, "web"), t.clock.now)).toMatchObject({ allowed: false, reason: "no_grant" });
    // Saved state is checked too: an edited policy or a lowered high-water mark does not load.
    expect(code(() => new TeamPolicyHost({ ...saved, policy: { ...saved.policy!, grants: [] } }))).toBe("team_policy_signature");
    expect(code(() => new TeamPolicyHost({ ...saved, highestRevision: 1 }))).toBe("invalid_team_policy");
  });

  test("two documents that share a revision but differ, and an older issue of the same revision", () => {
    const t = team();
    const held = t.ownerHost.host.state().policy!;
    const { signature: _, ...unsigned } = held;
    const sameRevisionOtherContent = signTeamPolicy(t.authorityKey, { ...unsigned, policyId: "other", label: "Renamed" });
    expect(code(() => t.ownerHost.host.accept(sameRevisionOtherContent, t.clock.now))).toBe("team_policy_conflict");
    const olderIssue = signTeamPolicy(t.authorityKey, { ...unsigned, policyId: "older", issuedAt: held.issuedAt - 1_000, expiresAt: held.expiresAt - 1_000 });
    expect(code(() => t.ownerHost.host.accept(olderIssue, t.clock.now))).toBe("team_policy_rollback");
  });

  test("an expired policy, a future-dated one, and one that outlives the maximum lifetime", () => {
    const t = team();
    const { signature: _, ...unsigned } = t.ownerHost.host.state().policy!;
    const sign = (issuedAt: number, expiresAt: number) => signTeamPolicy(t.authorityKey, { ...unsigned, revision: unsigned.revision + 1, issuedAt, expiresAt });
    expect(code(() => t.ownerHost.host.accept(sign(t.clock.now - 2 * HOUR, t.clock.now - HOUR), t.clock.now))).toBe("team_policy_expired");
    expect(code(() => t.ownerHost.host.accept(sign(t.clock.now + HOUR, t.clock.now + 2 * HOUR), t.clock.now))).toBe("invalid_team_policy");
    expect(code(() => t.ownerHost.host.accept(sign(t.clock.now, t.clock.now + 25 * HOUR), t.clock.now))).toBe("invalid_team_policy");
  });

  test("a document with fields the contract does not name, a path, or an admin grant", () => {
    const t = team();
    t.enroll(t.ownerHost, ["web"]);
    const { signature: _, ...unsigned } = t.control.issue();
    const resign = (change: object) => signTeamPolicy(t.authorityKey, { ...unsigned, ...change } as Omit<TeamPolicy, "signature">);
    const grant: TeamGrant = { id: "g", subject: { kind: "role", role: "member" }, hosts: { all: true, hostIds: [] }, scope: only("web"), actions: ["message"] };
    expect(code(() => t.memberHost.host.accept(resign({ grants: [grant] }), t.clock.now))).toBe("accepted");
    for (const change of [
      { projects: [{ ...unsigned.projects[0], root: "/somewhere" }] },
      { grants: [{ ...grant, actions: ["admin"] }] },
      { grants: [{ ...grant, scope: only("unlisted") }] },
      { grants: [{ ...grant, subject: { kind: "person", personId: "person-stranger" } }] },
      { grants: [{ ...grant, subject: { kind: "host", hostId: t.ownerHost.id } }] },
      { hosts: unsigned.hosts.map((host) => (host.hostId === t.memberHost.id ? { ...host, ownerPersonId: "person-stranger" } : host)) },
      { hosts: unsigned.hosts.map((host) => (host.hostId === t.buildHost.id ? { ...host, ownerPersonId: OWNER.personId } : host)) },
      { members: unsigned.members.map((member) => ({ ...member, role: "member" })) },
      { schemaVersion: 2 },
      { note: "extra" },
    ]) expect(code(() => t.memberHost.host.accept(resign(change), t.clock.now))).toBe("invalid_team_policy");
  });
});

describe("what a host refuses to serve", () => {
  test("a host that is not in the team", () => {
    const t = team();
    t.enroll(t.ownerHost, ["web"]);
    t.grant("grant-web", { kind: "role", role: "member" }, t.ownerHost.id, only("web"));
    t.sync();
    const stranger = key();
    expect(t.ownerHost.host.evaluate({ peerHostId: nodeKeyId(stranger.publicKey), action: "message", resource: { agentId: "a", projectId: "web" } }, t.clock.now)).toMatchObject({ allowed: false, reason: "peer_not_in_team" });
    expect(t.ownerHost.host.peerKey(nodeKeyId(stranger.publicKey), t.clock.now)).toBeUndefined();
    expect(t.call(stranger, "GET", "/v1/teams/team-1/policy").status).toBe(401);
  });

  test("a revoked host: at once at the control layer, at the next pull on a peer, at expiry without one", () => {
    const t = team();
    t.enroll(t.ownerHost, ["web"]);
    t.grant("grant-web", { kind: "role", role: "member" }, t.ownerHost.id, only("web"));
    t.sync();
    expect(t.ownerHost.host.evaluate(t.ask(t.memberHost, "web"), t.clock.now).allowed).toBe(true);

    t.control.revokeHost(OWNER, t.memberHost.id);
    expect(t.call(t.memberHost.identity, "GET", "/v1/teams/team-1/policy").status).toBe(403);
    // The owner's host has not pulled yet. It still holds a valid policy that lists the revoked host.
    expect(t.ownerHost.host.evaluate(t.ask(t.memberHost, "web"), t.clock.now).allowed).toBe(true);
    // With no pull at all, access ends when that policy expires.
    expect(t.ownerHost.host.evaluate(t.ask(t.memberHost, "web"), t.clock.now + HOUR)).toMatchObject({ allowed: false, reason: "policy_expired" });
    expect(t.pull(t.ownerHost)).toBe(200);
    expect(t.ownerHost.host.evaluate(t.ask(t.memberHost, "web"), t.clock.now)).toMatchObject({ allowed: false, reason: "peer_revoked" });
    expect(t.ownerHost.host.peerKey(t.memberHost.id, t.clock.now)).toBeUndefined();
    // The revoked host cannot re-enter with the same key.
    expect(t.call(t.memberHost.identity, "POST", "/v1/teams/team-1/hosts", { publicKey: t.memberHost.identity.publicKey, label: "Again", ownership: "personal" }, MEMBER).status).toBe(409);
  });

  test("a removed member's host, and a host that was itself removed from the team", () => {
    const t = team();
    t.enroll(t.ownerHost, ["web"]);
    t.enroll(t.memberHost, ["docs"]);
    t.grant("grant-web", { kind: "role", role: "member" }, t.ownerHost.id, only("web"));
    t.grant("grant-docs", { kind: "role", role: "member" }, t.memberHost.id, only("docs"));
    t.control.removeMember(OWNER, MEMBER.personId);
    t.pull(t.ownerHost);
    expect(t.ownerHost.host.evaluate(t.ask(t.memberHost, "web"), t.clock.now)).toMatchObject({ allowed: false, reason: "peer_revoked" });
    // Given the new policy by any route, the removed host stops serving the team.
    t.memberHost.host.accept(t.control.issue(), t.clock.now);
    expect(t.memberHost.host.evaluate(t.ask(t.ownerHost, "docs"), t.clock.now)).toMatchObject({ allowed: false, reason: "host_not_in_team" });
  });

  test("when the control layer cannot be reached: the cached policy holds until it expires, then nothing", () => {
    const t = team();
    t.enroll(t.ownerHost, ["web"]);
    t.grant("grant-web", { kind: "role", role: "member" }, t.ownerHost.id, only("web"));
    t.sync();
    const expiresAt = t.ownerHost.host.state().policy!.expiresAt;
    expect(t.ownerHost.host.evaluate(t.ask(t.memberHost, "web"), expiresAt - 1).allowed).toBe(true);
    expect(t.ownerHost.host.evaluate(t.ask(t.memberHost, "web"), expiresAt)).toMatchObject({ allowed: false, reason: "policy_expired" });
    expect(t.ownerHost.host.current(expiresAt)).toBeUndefined();
    expect(t.ownerHost.host.peerKey(t.memberHost.id, expiresAt)).toBeUndefined();
    // Reachable again: one pull restores service.
    t.clock.now = expiresAt + 5_000;
    expect(t.pull(t.ownerHost)).toBe(200);
    expect(t.ownerHost.host.evaluate(t.ask(t.memberHost, "web"), t.clock.now).allowed).toBe(true);
  });

  test("a project a personal host never enrolled, whatever the control layer says", () => {
    const t = team();
    t.enroll(t.ownerHost, ["web"]);
    const { signature: _, ...unsigned } = t.control.issue();
    // A control layer that adds a project to the owner's host and grants the whole host.
    t.ownerHost.host.accept(signTeamPolicy(t.authorityKey, {
      ...unsigned, revision: unsigned.revision + 1,
      projects: [...unsigned.projects, { hostId: t.ownerHost.id, projectId: "private", label: "Private" }],
      grants: [{ id: "g", subject: { kind: "role", role: "member" }, hosts: { all: true, hostIds: [] }, scope: everything, actions: ["message", "read-history"] }],
    }), t.clock.now);
    expect(t.ownerHost.host.evaluate(t.ask(t.memberHost, "web"), t.clock.now).allowed).toBe(true);
    expect(t.ownerHost.host.evaluate(t.ask(t.memberHost, "private"), t.clock.now)).toMatchObject({ allowed: false, reason: "not_enrolled" });
    expect(t.ownerHost.host.evaluate(t.ask(t.memberHost, "private", { action: "read-history" }), t.clock.now)).toMatchObject({ allowed: false, reason: "not_enrolled" });
  });

  test("a project the owner of a personal host has hidden", () => {
    const t = team();
    t.enroll(t.ownerHost, ["web", "notes"]);
    t.grant("grant-all", { kind: "role", role: "member" }, t.ownerHost.id, everything);
    t.sync();
    t.ownerHost.host.setLocal({ enrolled: { agentIds: [], projectIds: ["web", "notes"] }, denied: { agentIds: ["agent-quiet"], projectIds: ["notes"] } });
    expect(t.ownerHost.host.evaluate(t.ask(t.memberHost, "web"), t.clock.now).allowed).toBe(true);
    expect(t.ownerHost.host.evaluate(t.ask(t.memberHost, "notes"), t.clock.now)).toMatchObject({ allowed: false, reason: "local_deny" });
    expect(t.ownerHost.host.evaluate(t.ask(t.memberHost, "web", { resource: { agentId: "agent-quiet", projectId: "web" } }), t.clock.now)).toMatchObject({ allowed: false, reason: "local_deny" });
  });

  test("a team-owned host that asks as a person", () => {
    const t = team();
    t.enroll(t.ownerHost, ["web"]);
    t.grant("grant-person", { kind: "person", personId: OWNER.personId }, t.ownerHost.id, only("web"));
    t.grant("grant-role", { kind: "role", role: "member" }, t.ownerHost.id, only("web"));
    t.sync();
    // People hold grants here. The build host holds none, so it gets nothing by naming them.
    expect(t.ownerHost.host.evaluate(t.ask(t.buildHost, "web"), t.clock.now)).toMatchObject({ allowed: false, reason: "no_grant" });
    expect(t.ownerHost.host.evaluate(t.ask(t.buildHost, "web", { personId: OWNER.personId }), t.clock.now)).toMatchObject({ allowed: false, reason: "person_assertion_unsupported" });
    expect(t.ownerHost.host.evaluate(t.ask(t.buildHost, "web", { attributedTo: OWNER.personId }), t.clock.now)).toMatchObject({ allowed: false, reason: "no_grant" });

    t.grant("grant-build", { kind: "host", hostId: t.buildHost.id }, t.ownerHost.id, only("web"));
    t.sync();
    expect(t.ownerHost.host.evaluate(t.ask(t.buildHost, "web", { attributedTo: MEMBER.personId }), t.clock.now))
      .toMatchObject({ allowed: true, principal: { kind: "host", hostId: t.buildHost.id }, grantIds: ["grant-build"], attributedTo: MEMBER.personId });
    expect(t.ownerHost.host.evaluate(t.ask(t.buildHost, "web", { personId: OWNER.personId }), t.clock.now)).toMatchObject({ allowed: false, reason: "person_assertion_unsupported" });
  });

  test("a personal host that asks as someone other than its owner", () => {
    const t = team();
    t.enroll(t.buildHost, ["release"]);
    t.grant("grant-owner", { kind: "person", personId: OWNER.personId }, t.buildHost.id, only("release"));
    t.sync();
    expect(t.buildHost.host.evaluate(t.ask(t.ownerHost, "release", { personId: OWNER.personId }), t.clock.now).allowed).toBe(true);
    expect(t.buildHost.host.evaluate(t.ask(t.memberHost, "release", { personId: OWNER.personId }), t.clock.now)).toMatchObject({ allowed: false, reason: "person_mismatch" });
    expect(t.buildHost.host.evaluate(t.ask(t.memberHost, "release"), t.clock.now)).toMatchObject({ allowed: false, reason: "no_grant" });
  });

  test("anything, before a first policy", () => {
    const t = team();
    const fresh = new TeamPolicyHost({ pin: t.control.pin, hostId: t.ownerHost.id });
    expect(fresh.evaluate(t.ask(t.memberHost, "web"), t.clock.now)).toMatchObject({ allowed: false, reason: "no_policy" });
  });
});

describe("what the control layer refuses", () => {
  test("a join without a signed-in member, with a key the caller does not hold, or with an owner in the body", () => {
    const t = team();
    const identity = key();
    const body = { publicKey: identity.publicKey, label: "Laptop", ownership: "personal" };
    expect(t.call(identity, "POST", "/v1/teams/team-1/hosts", body).status).toBe(401);
    expect(t.call(identity, "POST", "/v1/teams/team-1/hosts", body, { personId: "person-stranger" }).status).toBe(403);
    expect(t.call(key(), "POST", "/v1/teams/team-1/hosts", body, MEMBER).status).toBe(401);
    expect(t.call(identity, "POST", "/v1/teams/team-1/hosts", { ...body, ownerPersonId: OWNER.personId }, MEMBER).status).toBe(400);
    // The owner of a personal host is whoever is signed in.
    const response = t.call(identity, "POST", "/v1/teams/team-1/hosts", body, MEMBER);
    expect(response.status).toBe(201);
    const { hostId, policy } = response.body as { hostId: string; policy: TeamPolicy };
    expect(policy.hosts.find((host) => host.hostId === hostId)).toMatchObject({ ownership: "personal", ownerPersonId: MEMBER.personId });
  });

  test("a team-owned host added by a member", () => {
    const t = team();
    const identity = key();
    const body = { publicKey: identity.publicKey, label: "Shared host", ownership: "team" };
    expect(t.call(identity, "POST", "/v1/teams/team-1/hosts", body, MEMBER).status).toBe(403);
    expect(t.call(identity, "POST", "/v1/teams/team-1/hosts", body, OWNER).status).toBe(201);
  });

  test("a replayed request, a request for another host's enrolment, and a grant from a member", () => {
    const t = team();
    const path = "/v1/teams/team-1/policy";
    const headers = signPeerRequest(t.memberHost.identity, { method: "GET", path, destinationKeyId: t.control.pin.authority.id, ts: t.clock.now });
    expect(t.control.handle({ method: "GET", path, headers }).status).toBe(200);
    expect(t.control.handle({ method: "GET", path, headers }).status).toBe(401);
    expect(t.control.handle({ method: "GET", path: `${path}?after=0`, headers }).status).toBe(401);
    expect(t.call(t.memberHost.identity, "PUT", `/v1/teams/team-1/hosts/${t.ownerHost.id}/enrollment`, { projects: [{ projectId: "planted", label: "Planted" }] }).status).toBe(403);
    expect(code(() => t.grant("g", { kind: "role", role: "member" }, t.ownerHost.id, everything))).toBe("accepted");
    expect(code(() => t.control.setGrant(MEMBER, { id: "g2", subject: { kind: "role", role: "member" }, hosts: { all: true, hostIds: [] }, scope: everything, actions: ["message"] }))).toBe("not_an_administrator");
    expect(code(() => t.control.addMember(MEMBER, { personId: "person-new", label: "New", role: "member" }))).toBe("not_an_administrator");
  });

  test("an unchanged policy is not resent early, and is resent with a new expiry late", () => {
    const t = team();
    t.sync();
    const first = t.ownerHost.host.state().policy!;
    expect(t.pull(t.ownerHost)).toBe(304);
    t.clock.now += HOUR / 2 + 1;
    expect(t.pull(t.ownerHost)).toBe(200);
    const second = t.ownerHost.host.state().policy!;
    expect(second.revision).toBe(first.revision);
    expect(second.expiresAt).toBeGreaterThan(first.expiresAt);
    // Unenrolling a project withdraws it from the grants that named it.
    t.enroll(t.ownerHost, ["web"]);
    t.grant("grant-web", { kind: "role", role: "member" }, t.ownerHost.id, only("web"));
    t.enroll(t.ownerHost, []);
    t.pull(t.ownerHost);
    expect(t.ownerHost.host.state().policy!.grants[0]!.scope.projectIds).toEqual([]);
  });
});
