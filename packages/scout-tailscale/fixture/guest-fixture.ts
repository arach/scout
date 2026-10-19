#!/usr/bin/env bun
/**
 * Isolated Scout guest fixture for scout-tailscale integration tests.
 *
 * Runs the REAL runtime guest gate (mesh-ingress-gate, enforce mode) and the
 * REAL guest routes (broker-guest-http-routes) with temporary state: its own
 * node key, its own TLS identity, an in-process grant store, and one harmless
 * agent, `fixture.echo`, which completes every ask with a deterministic
 * reply. It never touches the live broker, its database, or its keys.
 *
 *   bun packages/scout-tailscale/fixture/guest-fixture.ts serve \
 *     --host 127.0.0.1 --port 43191 --advertise https://127.0.0.1:43191
 *
 * prints the node key id, TLS pin and card, and opens a loopback-only admin
 * listener. Enroll a guest from its PUBLIC key only:
 *
 *   bun packages/scout-tailscale/fixture/guest-fixture.ts grant --public-key <base64 SPKI> [--admin 43192]
 *
 * which installs a narrow grant (target fixture.echo, 24h) through the real
 * loopback admin route and prints the bootstrap the client imports.
 *
 * Several fixtures make a multi-machine test: give each its own --state,
 * --port/--admin, --label (the friendly machine name on its signed card) and
 * --agents; grant each one separately with --targets.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { handleBrokerGuestRoute, type BrokerGuestHttpDeps } from "../../runtime/src/broker-guest-http-routes.ts";
import { GuestGrantStore } from "../../runtime/src/guest-access.ts";
import { createMeshIngressGate } from "../../runtime/src/mesh-ingress-gate.ts";
import { PeerNonceCache } from "../../runtime/src/mesh-peer-auth.ts";
import { buildSignedNodeCard, loadOrCreateNodeIdentity, nodeKeyId } from "../../runtime/src/node-identity.ts";
import { loadOrCreateTlsIdentity } from "../../runtime/src/node-tls-identity.ts";

const ECHO_AGENT = "fixture.echo";

function flag(args: string[], name: string, fallback?: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

type Flight = { id: string; invocationId: string; state: string; output?: string; completedAt?: number };

async function serve(args: string[]) {
  const host = flag(args, "host", "127.0.0.1")!;
  const port = Number(flag(args, "port", "43191"));
  const adminPort = Number(flag(args, "admin", String(port + 1)));
  const dir = flag(args, "state") ?? mkdtempSync(join(tmpdir(), "scout-guest-fixture-"));
  const advertise = (flag(args, "advertise") ?? `https://${host}:${port}`).split(",");
  const replyDelayMs = Number(flag(args, "reply-delay-ms", "500"));
  const label = flag(args, "label", "Scout guest fixture")!;
  const agents = (flag(args, "agents") ?? ECHO_AGENT).split(",").filter(Boolean);

  const node = loadOrCreateNodeIdentity(dir);
  const keyId = nodeKeyId(node.publicKey);
  const tls = await loadOrCreateTlsIdentity(dir, { algorithm: "ec-p256" });
  const nodeId = `fixture-${keyId.slice(0, 8)}`;
  const card = () => buildSignedNodeCard(node, {
    nodeId, label, version: "fixture", capabilities: [], endpoints: advertise,
    tls: { spkiFingerprint: tls.spkiFingerprint },
  });

  const grants = new GuestGrantStore(new Database(join(dir, "guest.sqlite")) as never, () => false);
  const invocations = new Map<string, any>();
  const flights = new Map<string, Flight>();
  const deps: BrokerGuestHttpDeps = {
    grants, nodeId, nodeKeyId: keyId, nodeCard: card,
    listAgents: () => agents.map((id) => ({ id, displayName: `${label} ${id}`, handle: id.split(".").pop() })) as never,
    ensureGuestActor: async () => {},
    // Echo fixtures exercise transport; real reply matching is tested in the daemon.
    openThread: async ({ requesterId, targetAgentId }) => ({
      id: `dm.${requesterId}.${targetAgentId}`, kind: "direct", title: targetAgentId,
      visibility: "private", shareMode: "local", authorityNodeId: nodeId,
      participantIds: [requesterId, targetAgentId].sort(),
    }),
    postMessage: async () => {},
    invoke: async (invocation) => {
      invocations.set(invocation.id, invocation);
      const flight: Flight = { id: `flight-${invocation.id}`, invocationId: invocation.id, state: "queued" };
      flights.set(invocation.id, flight);
      setTimeout(() => {
        flight.state = "completed";
        flight.output = `${invocation.targetAgentId} received ${Buffer.byteLength(invocation.task)} bytes: ${invocation.task}`;
        flight.completedAt = Date.now();
      }, replyDelayMs);
      return { flight };
    },
    existingInvocation: (id) => invocations.get(id),
    flightForInvocation: (id) => flights.get(id) as never,
  };

  const gate = createMeshIngressGate({
    mode: "enforce",
    destinationKeyId: keyId,
    bootedAt: Date.now(),
    lookupPeer: () => undefined,
    lookupGuest: (guestKeyId) => {
      const grant = grants.activeByKeyId(guestKeyId, Date.now());
      return grant ? { publicKey: grant.publicKey, grantId: grant.id } : undefined;
    },
    nonceClaim: new PeerNonceCache(),
    logger: { warn: (message, detail) => console.warn(`[gate] ${message}`, detail ?? "") },
    forceRemoteEnforce: () => true,
  });

  const handler = (request: any, response: any) => {
    void gate.gateHttpRequest(request, response, async (gated) => {
      const url = new URL(gated.url ?? "/", "http://fixture");
      const method = (gated.method ?? "GET").toUpperCase();
      if (method === "GET" && url.pathname === "/v1/node") {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: nodeId, card: card(), gateMode: "enforce" }));
        return;
      }
      console.log(`${new Date().toISOString()} ${method} ${url.pathname}${gated.transportContext?.guest ? ` guest=${gated.transportContext.guest.keyId.slice(0, 12)}` : ""}`);
      if (!await handleBrokerGuestRoute(gated as never, response, url, method, deps)) {
        response.writeHead(404, { "content-type": "application/json" }).end('{"error":"not_found"}');
      }
    });
  };
  const listener = createHttpsServer({ key: tls.keyPair.privateKey.export({ type: "pkcs8", format: "pem" }) as string, cert: tls.certificatePem }, handler);
  await new Promise<void>((resolve) => listener.listen(port, host, resolve));
  const admin = createHttpServer(handler);
  await new Promise<void>((resolve) => admin.listen(adminPort, "127.0.0.1", resolve));

  const info = { stateDir: dir, nodeId, nodeKeyId: keyId, tlsSpkiFingerprint: tls.spkiFingerprint, endpoints: advertise,
    listen: `https://${host}:${port}`, admin: `http://127.0.0.1:${adminPort}`, label, agents, card: card() };
  writeFileSync(join(dir, "fixture.json"), JSON.stringify(info, null, 2));
  console.log(JSON.stringify(info, null, 2));
  console.log(`fixture ready; state in ${dir}`);
}

async function grant(args: string[]) {
  const publicKey = flag(args, "public-key");
  if (!publicKey) throw new Error("--public-key <base64 SPKI> is required");
  const admin = `http://127.0.0.1:${flag(args, "admin", "43192")}`;
  const hours = Number(flag(args, "hours", "24"));
  const response = await fetch(`${admin}/v1/guest-grants`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: flag(args, "request-id", `fixture-${Date.now()}`),
      clientPublicKey: publicKey,
      label: flag(args, "label", "muse-fixture-test"),
      allowedTargets: (flag(args, "targets") ?? ECHO_AGENT).split(",").filter(Boolean),
      expiresAt: Date.now() + hours * 3_600_000,
    }),
  });
  const body = await response.json() as Record<string, any>;
  if (response.status !== 200) throw new Error(`grant failed: ${response.status} ${JSON.stringify(body)}`);
  // The same shape the hosted claim returns, so the client imports it the same way.
  const claim = { mode: "direct", bootstrap: body.bootstrap, allowed_targets: body.grant.allowedTargets,
    expires_at: new Date(body.grant.expiresAt).toISOString() };
  const out = flag(args, "out");
  if (out) writeFileSync(out, JSON.stringify(claim, null, 2));
  console.log(JSON.stringify(claim, null, 2));
}

async function revoke(args: string[]) {
  const admin = `http://127.0.0.1:${flag(args, "admin", "43192")}`;
  const response = await fetch(`${admin}/v1/guest-grants/revoke`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: flag(args, "request-id") }),
  });
  console.log(response.status, await response.text());
}

const [command, ...rest] = process.argv.slice(2);
const commands: Record<string, (args: string[]) => Promise<void>> = { serve, grant, revoke };
if (!command || !commands[command]) {
  console.error("usage: guest-fixture.ts serve|grant|revoke [flags]");
  process.exit(2);
}
await commands[command](rest);
