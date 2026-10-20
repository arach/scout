import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import type { NodeDefinition, TrustedPeerRecord } from "@openscout/protocol";
import { buildSignedNodeCard, nodeKeyId, type NodeIdentity } from "./node-identity.js";
import { createMeshPing, readPingBody, MESH_PING_MAX_BYTES } from "./mesh-ping.js";
import { PeerTlsPinError, type PinnedHttpsClient } from "./mesh-pinned-https-client.js";
function identity(): NodeIdentity {
  const keys = generateKeyPairSync("ed25519");
  return { version: 1, publicKey: keys.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    privateKey: keys.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"), createdAt: Date.now() };
}
function fixture() {
  const remote = identity(), local = identity(), pin = "a".repeat(64);
  const card = buildSignedNodeCard(remote, { nodeId: "peer", label: "Peer", version: "test", capabilities: [],
    endpoints: ["https://peer.example"], tls: { spkiFingerprint: pin } });
  const nodes = [{ id: "peer", meshId: "mesh", name: "Peer", brokerUrl: "https://peer.example" }] as NodeDefinition[];
  let peers = [{ keyId: nodeKeyId(remote.publicKey), nodeId: "peer", tlsSpkiFingerprint: pin }] as TrustedPeerRecord[];
  let signed = 0;
  const calls: { url: string; headers: Headers; pin: string }[] = [];
  const pinned = { fetch: async (url, channel, init) => {
    calls.push({ url, headers: new Headers(init?.headers), pin: channel.spkiFingerprint });
    return Response.json({ card });
  }, close() {}, invalidate() {}, probeFetch: async () => { throw new Error("must never probe unpinned"); } } as PinnedHttpsClient;
  const deps = { nodes: () => nodes, peers: () => peers, meshId: "mesh", localNodeId: "local", pinned,
    identity: () => { signed++; return local; } };
  return { deps, nodes, calls, card, pin, local, get signed() { return signed; }, revoke() { peers = []; } };
}
describe("bounded runtime mesh ping", () => {
  test("known runtime node proves its card on pinned TLS before any signature", async () => {
    const f = fixture(); const ping = createMeshPing(f.deps);
    expect(await ping("Peer")).toMatchObject({ ok: true, signed: true, nodeId: "peer", attempts: 1 });
    expect(f.signed).toBe(1); expect(f.calls).toHaveLength(2);
    expect([...f.calls[0]!.headers.keys()]).toEqual([]);
    expect([...f.calls[1]!.headers.keys()].some(key => key.startsWith("x-openscout-"))).toBe(true);
    expect(f.calls.every(call => call.url === "https://peer.example/v1/node" && call.pin === f.pin)).toBe(true);
  });
  test("a raw URL, including a known peer URL, gets only unsigned public GET", async () => {
    const f = fixture(); let calls = 0;
    const ping = createMeshPing({ ...f.deps, fetch: (async (url, init) => {
      calls++; expect(String(url)).toBe("https://peer.example/v1/node"); expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("error"); expect([...new Headers(init?.headers).keys()]).toEqual(["accept"]);
      return Response.json({ card: f.card });
    }) as typeof fetch });
    expect(await ping("https://peer.example")).toMatchObject({ signed: false, attempts: 1, ok: true });
    expect(calls).toBe(1); expect(f.signed).toBe(0); expect(f.calls).toHaveLength(0);
  });
  test("unknown, ambiguous, credential/path URLs and unpinned nodes never sign", async () => {
    const f = fixture(); const ping = createMeshPing(f.deps);
    for (const target of ["missing", "https://user:secret@peer.example", "https://peer.example/path", "file:///etc/passwd", "https://peer.example?secret=1"]) {
      await expect(ping(target)).rejects.toBeDefined();
    }
    f.nodes.push({ ...f.nodes[0]!, id: "another" });
    await expect(ping("Peer")).rejects.toMatchObject({ code: "ambiguous_mesh_target" });
    expect(f.signed).toBe(0); expect(f.calls).toHaveLength(0);
    const g = fixture(); const unpinned = { ...g.deps.peers()[0]!, tlsSpkiFingerprint: undefined };
    g.deps.peers = () => [unpinned];
    await expect(createMeshPing(g.deps)("peer")).rejects.toMatchObject({ code: "target_not_pinned" });
    expect(g.signed).toBe(0);
  });
  test("pin or identity mismatch fails closed, without signing or fallback", async () => {
    for (const mismatch of ["pin", "card"]) {
      const f = fixture(); let calls = 0;
      f.deps.pinned.fetch = async () => { calls++;
        if (mismatch === "pin") throw new PeerTlsPinError("test", "https://peer.example", f.pin);
        return Response.json({ card: { ...f.card, nodeId: "wrong" } }); };
      await expect(createMeshPing(f.deps)("peer")).rejects.toBeDefined();
      expect(f.signed).toBe(0); expect(calls).toBe(1);
    }
  });
  test("revocation during card fetch is checked again before signing", async () => {
    const f = fixture(); f.deps.pinned.fetch = async () => { f.revoke(); return Response.json({ card: f.card }); };
    await expect(createMeshPing(f.deps)("peer")).rejects.toMatchObject({ code: "peer_changed" });
    expect(f.signed).toBe(0);
  });
  test("attempt count and rate are capped", async () => {
    const f = fixture(); let attempts = 0;
    f.nodes[0]!.meshEntrypoints = Array.from({ length: 10 }, (_, i) => ({ kind: "http", url: `https://peer-${i}.example` })) as NodeDefinition["meshEntrypoints"];
    f.deps.pinned.fetch = async () => { attempts++; throw new Error("unreachable"); };
    const ping = createMeshPing(f.deps);
    expect(await ping("peer")).toMatchObject({ ok: false, attempts: 3 }); expect(attempts).toBe(3);
    for (let i = 0; i < 9; i++) await ping("peer");
    await expect(ping("peer")).rejects.toMatchObject({ status: 429 });
    expect(f.signed).toBe(0);
  });
  test("chunked bodies are bounded and cancelled, including stalled bodies", async () => {
    let cancelled = false;
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MESH_PING_MAX_BYTES + 1)); }, cancel() { cancelled = true; } });
    await expect(readPingBody(new Response(stream), AbortSignal.timeout(100))).rejects.toMatchObject({ code: "response_too_large" });
    expect(cancelled).toBe(true);
    await expect(readPingBody(new Response(new ReadableStream({})), AbortSignal.timeout(10))).rejects.toBeDefined();
  });
});
