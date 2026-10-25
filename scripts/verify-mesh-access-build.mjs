// Compiled Node/Bun portability smoke. In-memory SQLite and loopback port 0 only.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { ACCESS_PROTOCOL, signAccessArtifact } from "../packages/runtime/dist/mesh-access.js";
import { MeshAccessStore } from "../packages/runtime/dist/mesh-access-store.js";
import { nodeKeyId } from "../packages/runtime/dist/node-identity.js";
import { PeerNonceCache, signScopedPeerRequest } from "../packages/runtime/dist/mesh-peer-auth.js";
import { createMeshIngressGate } from "../packages/runtime/dist/mesh-ingress-gate.js";
import { handleBrokerAccessRoute } from "../packages/runtime/dist/broker-access-http-routes.js";
import { openRuntimeSqliteDatabase } from "../packages/runtime/dist/sqlite-adapter.js";
function key() {
  const pair = generateKeyPairSync("ed25519");
  return { version: 1, createdAt: Date.now(), publicKey: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64"), privateKey: pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64") };
}
const owner = key(), service = key(), device = key(), receiver = key(), now = Date.now();
const root = { id: nodeKeyId(owner.publicKey), publicKey: owner.publicKey, kind: "person", label: "Synthetic owner" };
const subject = { id: nodeKeyId(service.publicKey), publicKey: service.publicKey, kind: "service", label: "Synthetic service" };
const audience = nodeKeyId(receiver.publicKey), scope = { all: false, agentIds: ["allowed"], projectIds: [] };
const policy = signAccessArtifact(owner, { protocol: ACCESS_PROTOCOL, kind: "policy", networkId: root.id, root, label: "Isolated test", revision: 1, issuedAt: now, expiresAt: now + 60_000, members: [{ principal: subject, role: "service" }], revokedPrincipalIds: [], revokedGrantIds: [], revokedDelegationIds: [], revokedDeviceIds: [] });
const delegation = signAccessArtifact(service, { protocol: ACCESS_PROTOCOL, kind: "delegation", id: "test-device", networkId: root.id, principalId: subject.id, devicePublicKey: device.publicKey, audience, issuedAt: now, expiresAt: now + 60_000, scope, actions: ["discover", "message", "read-own"] });
const grant = signAccessArtifact(owner, { protocol: ACCESS_PROTOCOL, kind: "grant", id: "test-grant", networkId: root.id, issuerId: root.id, subjectId: subject.id, audience, revision: 1, issuedAt: now, expiresAt: now + 60_000, revoked: false, scope, actions: ["discover", "message"] });
const db = openRuntimeSqliteDatabase(":memory:");
const store = new MeshAccessStore(db, audience);
store.importPolicy(policy, true); store.importGrant(grant);
store.enroll({ networkId: root.id, agentIds: ["allowed"], projects: [] }, new Set(), new Set(["allowed"]));
const messages = [], invocations = [];
const deps = { access: store, nodeId: "isolated", nodeKeyId: audience, enforced: () => true,
  listAgents: () => [{ id: "allowed", displayName: "Allowed" }, { id: "hidden", displayName: "Hidden" }],
  ensureGuestActor: async () => {}, openThread: async ({ requesterId, targetAgentId }) => ({ id: "thread", participantIds: [requesterId, targetAgentId] }),
  postMessage: async (message) => { messages.push(message); }, invoke: async (invocation) => { invocations.push(invocation); }, existingInvocation: () => undefined, flightForInvocation: () => undefined };
const gate = createMeshIngressGate({ mode: "enforce", localAdminKey: "a1".repeat(32), destinationKeyId: audience, bootedAt: now, lookupPeer: () => undefined, nonceClaim: new PeerNonceCache(), logger: { warn() {} },
  scopedAccess: { accept: (proof) => store.acceptDelegation(proof.delegation), knownDevice: (id) => store.knownDevice(id), verify: (envelope) => store.verifyDelegation(envelope.delegation) } });
const server = createServer((req, res) => { void gate.gateHttpRequest(req, res, async (request) => {
  const handled = await handleBrokerAccessRoute(request, res, new URL(request.url, "http://localhost"), request.method, deps);
  if (!handled) { res.writeHead(404); res.end(); }
}); });
try {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (operation) => {
    const path = "/v1/access/rpc", body = JSON.stringify({ delegation, ...operation });
    const response = await fetch(url + path, { method: "POST", body, headers: { "content-type": "application/json", ...signScopedPeerRequest(device, { delegation, method: "POST", path, body, destinationKeyId: audience }) } });
    return { status: response.status, data: await response.json() };
  };
  const discovered = await call({ operation: "discover" }); assert.equal(discovered.status, 200); assert.deepEqual(discovered.data.agents.map((a) => a.id), ["allowed"]);
  assert.equal((await call({ operation: "message", target: "allowed", requestId: "message-001", body: "@hidden must not wake" })).status, 202);
  assert.equal(messages.length, 1); assert.equal(messages[0].audience.delivery, "none"); assert.equal(invocations.length, 0);
  assert.equal((await call({ operation: "request", target: "allowed", requestId: "request-001", body: "cannot work" })).status, 404);
  assert.equal((await call({ operation: "message", target: "hidden", requestId: "message-002", body: "cannot see" })).status, 404);
  assert.equal((await fetch(url + "/v1/snapshot")).status, 403);
  const revocation = signAccessArtifact(service, { protocol: ACCESS_PROTOCOL, kind: "revocation", networkId: root.id, issuerId: subject.id,
    issuerPublicKey: service.publicKey, targetKind: "device", targetId: nodeKeyId(device.publicKey), issuedAt: Date.now() });
  assert.equal((await fetch(url + "/v1/access/policy", { method: "POST", body: JSON.stringify({ artifact: revocation }), headers: { "content-type": "application/json" } })).status, 200);
  assert.equal((await call({ operation: "discover" })).status, 403);
  process.stdout.write(JSON.stringify({ ok: true, runtime: process.versions.bun ? "bun" : "node", version: process.version, isolated: true }) + "\n");
} finally {
  await new Promise((resolve) => server.close(resolve)); db.close?.();
}
