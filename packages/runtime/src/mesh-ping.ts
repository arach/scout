import type { NodeDefinition, TrustedPeerRecord } from "@openscout/protocol";
import { httpMeshUrlsForNode } from "./mesh-dial-order.js";
import { signPeerRequest } from "./mesh-peer-auth.js";
import { createPinnedHttpsClient, PeerTlsPinError, PeerResponseTooLargeError, type PinnedHttpsClient } from "./mesh-pinned-https-client.js";
import { verifySignedNodeCard, type NodeIdentity, type SignedNodeCard } from "./node-identity.js";

export const MESH_PING_MAX_BYTES = 64 * 1024;
export const MESH_PING_MAX_ATTEMPTS = 3;
export const MESH_PING_TIMEOUT_MS = 6_000;
export class MeshPingError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

/** Streaming cap includes chunked/decompressed bodies, not just Content-Length. */
export async function readPingBody(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new MeshPingError(502, "invalid_node_card");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MESH_PING_MAX_BYTES) throw new MeshPingError(502, "response_too_large");
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
  }
}

function baseUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
      || url.search || url.hash || url.pathname !== "/") return null;
    return url.origin;
  } catch { return null; }
}
function verifiedCard(body: unknown, peer: TrustedPeerRecord, pin: string, now: number): SignedNodeCard {
  try {
    const card = (body as { card?: SignedNodeCard } | null)?.card;
    if (card && verifySignedNodeCard(card, now) && card.keyId === peer.keyId
      && card.nodeId === peer.nodeId && card.tls?.spkiFingerprint === pin) return card;
  } catch { /* malformed key/card data is an identity refusal, never a dial failure */ }
  throw new MeshPingError(502, "peer_identity_mismatch");
}

export type MeshPingDeps = {
  nodes: () => NodeDefinition[]; peers: () => TrustedPeerRecord[];
  meshId: string; localNodeId: string; identity: () => NodeIdentity;
  pinned?: PinnedHttpsClient; fetch?: typeof fetch; now?: () => number;
};

/** Narrow GET /v1/node probe. Never forwards caller headers, bodies, paths or methods. */
export function createMeshPing(deps: MeshPingDeps) {
  const now = deps.now ?? Date.now;
  const pinned = deps.pinned ?? createPinnedHttpsClient({ connectTimeoutMs: 2_000, maxResponseBytes: MESH_PING_MAX_BYTES });
  let windowStart = now(), used = 0, active = false;
  return async (target: string) => {
    if (now() - windowStart >= 60_000) { windowStart = now(); used = 0; }
    if (active || used >= 10) throw new MeshPingError(429, "mesh_ping_rate_limited");
    used++;
    active = true;
    try {
      const startedAt = now();
      const deadline = AbortSignal.timeout(MESH_PING_TIMEOUT_MS);
      const raw = /^[a-z][a-z0-9+.-]*:\/\//i.test(target);
      if (raw) {
        const base = baseUrl(target);
        if (!base) throw new MeshPingError(400, "invalid_target_url");
        const response = await (deps.fetch ?? fetch)(`${base}/v1/node`, {
          method: "GET", headers: { accept: "application/json" }, redirect: "error", signal: deadline,
        });
        // Even a known peer's raw URL is never upgraded to machine authentication.
        await readPingBody(response, deadline);
        return { ok: response.ok, signed: false, attempts: 1, status: response.status, elapsedMs: now() - startedAt };
      }
      const nodes = deps.nodes().filter(node => node.id !== deps.localNodeId && node.meshId === deps.meshId
        && [node.id, node.name, node.hostName].includes(target));
      if (!nodes.length) throw new MeshPingError(404, "unknown_mesh_target");
      if (nodes.length !== 1) throw new MeshPingError(409, "ambiguous_mesh_target");
      const node = nodes[0]!;
      const activePeers = () => deps.peers().filter(peer => peer.nodeId === node.id && !peer.revokedAt
        && (!peer.expiresAt || peer.expiresAt > now()));
      const peers = activePeers();
      if (peers.length !== 1) throw new MeshPingError(409, "target_not_uniquely_trusted");
      const peer = peers[0]!;
      const pin = peer.tlsSpkiFingerprint;
      if (!pin || !/^[a-f0-9]{64}$/.test(pin)) throw new MeshPingError(409, "target_not_pinned");
      const bases = [...new Set(httpMeshUrlsForNode(node).map(baseUrl).filter((url): url is string => !!url && url.startsWith("https:")))];
      if (!bases.length) throw new MeshPingError(409, "target_has_no_tls_route");
      let attempts = 0, signed = false;
      for (const base of bases.slice(0, MESH_PING_MAX_ATTEMPTS)) {
        deadline.throwIfAborted();
        attempts++;
        const signal = AbortSignal.any([deadline, AbortSignal.timeout(2_000)]);
        try {
          const url = `${base}/v1/node`;
          const channel = { spkiFingerprint: pin, expectedKeyId: peer.keyId };
          const probe = await pinned.fetch(url, channel, { method: "GET", redirect: "error", signal });
          if (!probe.ok) throw new MeshPingError(502, "peer_probe_failed");
          verifiedCard(await readPingBody(probe, signal), peer, pin, now());
          // Revocation/config changes during card I/O must not authorize a signature.
          const current = activePeers();
          if (current.length !== 1 || current[0]!.keyId !== peer.keyId || current[0]!.tlsSpkiFingerprint !== pin
            || !deps.nodes().some(currentNode => currentNode.id === node.id && currentNode.meshId === deps.meshId
              && httpMeshUrlsForNode(currentNode).some(candidate => baseUrl(candidate) === base))) {
            throw new MeshPingError(409, "peer_changed");
          }
          const headers = signPeerRequest(deps.identity(), { method: "GET", path: "/v1/node", destinationKeyId: peer.keyId });
          signed = true;
          const response = await pinned.fetch(url, channel, { method: "GET", headers, redirect: "error", signal });
          verifiedCard(await readPingBody(response, signal), peer, pin, now());
          return { ok: response.ok, signed: true, nodeId: node.id, attempts, status: response.status, elapsedMs: now() - startedAt };
        } catch (error) {
          // Identity/pin failures and oversized bodies never authorize alias fallback.
          if (error instanceof PeerResponseTooLargeError) throw new MeshPingError(502, "response_too_large");
          if (error instanceof MeshPingError || error instanceof PeerTlsPinError) throw error;
        }
      }
      return { ok: false, signed, nodeId: node.id, attempts, status: null, elapsedMs: now() - startedAt };
    } finally { active = false; }
  };
}
