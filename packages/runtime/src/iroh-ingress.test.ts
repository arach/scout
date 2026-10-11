import { afterEach, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { createMeshIngressGate } from "./mesh-ingress-gate.js";
import { nodeKeyId, type NodeIdentity } from "./node-identity.js";
import { PeerNonceCache, signPeerRequest } from "./mesh-peer-auth.js";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => { s.closeAllConnections(); s.close(() => r()); }))); });
const endpointId = "a".repeat(64);
const path = "/v1/mesh/invocations";
const body = '{ "task": "hello ☃" }';
function identity(): NodeIdentity {
  const keys = generateKeyPairSync("ed25519");
  return { version: 1, createdAt: Date.now(), publicKey: keys.publicKey.export({ type: "spki", format: "der" }).toString("base64"), privateKey: keys.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64") };
}
async function fixture(tier: "control" | "observe" | null = "control", options: { guest?: boolean; scoped?: boolean; configured?: boolean } = {}) {
  const peer = identity(), keyId = nodeKeyId(peer.publicKey);
  let currentTier = tier;
  let receiverEndpoint = options.configured === false ? undefined : endpointId;
  const gate = createMeshIngressGate({ mode: "verify-warn", destinationKeyId: "b".repeat(64), bootedAt: Date.now() - 60_000,
    irohEndpointId: () => receiverEndpoint,
    lookupPeer: (id) => id === keyId && currentTier ? { publicKey: peer.publicKey, tier: currentTier } : undefined,
    lookupGuest: (id) => options.guest && id === keyId ? { publicKey: peer.publicKey, grantId: "guest" } : undefined,
    scopedAccess: { knownDevice: (id) => Boolean(options.scoped && id === keyId), verify: () => { throw new Error("unused"); }, accept: (p) => p },
    nonceClaim: new PeerNonceCache(), logger: { warn() {} } });
  const server = createServer((req, res) => { void gate.gateHttpRequest(req, res, async (accepted) => {
    let raw = ""; for await (const chunk of accepted) raw += chunk;
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ context: accepted.transportContext, body: raw, path: accepted.url }));
  }); });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const sign = (overrides: { path?: string; body?: string; destinationKeyId?: string } = {}) => signPeerRequest(peer, { method: "POST", path, body, destinationKeyId: `iroh:${endpointId}`, ...overrides });
  const send = (headers: Record<string, string> = {}, target = path, payload = body) => fetch(url + "/v1/iroh" + target, { method: "POST", body: payload, headers });
  return { send, sign, keyId, url, peer, revoke: () => { currentTier = null; }, setEndpoint: (id: string) => { receiverEndpoint = id; } };
}
test("unsigned Iroh remote traffic forwarded over loopback is never local, even in verify-warn", async () => {
  const f = await fixture(); expect((await f.send()).status).toBe(401);
});
test("enrolled control peer keeps its identity and exact body over Iroh", async () => {
  const f = await fixture(); const response = await f.send(f.sign()); expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ context: { transport: "remote", remoteAddress: "127.0.0.1", peer: { keyId: f.keyId, tier: "control" } }, body, path });
});
test("Iroh denies unenrolled, observe-only, guest and scoped credentials on mesh writes", async () => {
  for (const [tier, options] of [[null, {}], ["observe", {}], [null, { guest: true }], [null, { scoped: true }]] as const) {
    const f = await fixture(tier, options); expect((await f.send(f.sign())).status).toBeGreaterThanOrEqual(400);
  }
});
test("Iroh verifies body, path, destination and replay; never opens local routes", async () => {
  const f = await fixture();
  for (const proof of [f.sign({ body: "{}" }), f.sign({ path: "/v1/mesh/messages" }), f.sign({ destinationKeyId: `iroh:${"c".repeat(64)}` }), f.sign({ destinationKeyId: "b".repeat(64) })]) expect((await f.send(proof)).status).toBe(401);
  const proof = f.sign(); expect((await f.send(proof)).status).toBe(200); expect((await f.send(proof)).status).toBe(401);
  expect((await f.send(f.sign({ path: "/v1/commands" }), "/v1/commands")).status).toBe(403);
});
test("unconfigured Iroh fails closed; ordinary local operator calls stay local", async () => {
  const f = await fixture("control", { configured: false }); expect((await f.send(f.sign())).status).toBe(503);
  const response = await fetch(f.url + path, { method: "POST", body });
  expect((await response.json()).context.transport).toBe("loopback");
});

test("revocation applies to the next Iroh call; local-admin headers cannot promote it", async () => {
  const f = await fixture();
  expect((await f.send(f.sign())).status).toBe(200);
  f.revoke();
  expect((await f.send({ ...f.sign(), "x-openscout-local-admin": "a".repeat(64) })).status).toBe(401);
});

const nativeBridge = process.env.OPENSCOUT_TEST_IROH_BRIDGE_BIN;
test.skipIf(!nativeBridge)("native Iroh loopback round trip preserves enrolled caller and rejects revocation/unknown keys", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { startIrohBridgeServe, forwardIrohMeshEnvelope } = await import("./iroh-bridge.js");
  const f = await fixture();
  const directory = await mkdtemp(join(tmpdir(), "scout-iroh-roundtrip-"));
  let service: Awaited<ReturnType<typeof startIrohBridgeServe>> | undefined;
  try {
    service = await startIrohBridgeServe({ brokerUrl: f.url, bridgeBin: nativeBridge!, identityPath: join(directory, "receiver.key"), onlineTimeoutMs: 100, startupTimeoutMs: 5000 });
    f.setEndpoint(service.entrypoint.endpointId);
    const payload = { z: "☃", task: "synthetic Iroh authorization test" };
    const send = (nodeIdentity = f.peer) => forwardIrohMeshEnvelope<any>(service!.entrypoint, "invocations", payload, { bridgeBin: nativeBridge!, nodeIdentity, identityPath: join(directory, "sender.key"), timeoutMs: 10_000 });
    const result = await send();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ context: { transport: "remote", peer: { keyId: f.keyId, tier: "control" } }, body: JSON.stringify(payload), path });
    expect((await send(identity())).status).toBe(401);
    f.revoke(); expect((await send()).status).toBe(401);
  } finally { service?.stop(); await rm(directory, { recursive: true, force: true }); }
}, 45_000);
