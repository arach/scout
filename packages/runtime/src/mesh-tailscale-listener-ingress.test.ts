import { expect, test } from "bun:test";
import { createServer, request as httpRequest, type IncomingMessage } from "node:http";
import { createServer as createTcpServer, connect } from "node:net";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { createMeshIngressGate } from "./mesh-ingress-gate.js";
import { createTailscaleListenerGuard, isRuntimeLoopbackTcpSocket, TAILSCALE_GUARD_ERROR } from "./mesh-tailscale-listener-guard.js";
import { PeerNonceCache, signPeerRequest } from "./mesh-peer-auth.js";
import { accessTestKey } from "./test-helpers/access-fixture.test.js";
import { nodeKeyId } from "./node-identity.js";
import { requestScoutBrokerJson } from "./broker-api.js";
import { meshRouteTierFor } from "./mesh-route-matrix.js";

async function fixture(mode: "verify-warn" | "enforce") {
  const dir = mkdtempSync(join(tmpdir(), "runtime-ts-guard-")), socketPath = join(dir, "runtime.sock");
  let port = 0, now = 0, status = "{}", ok = true;
  let guard: ReturnType<typeof createTailscaleListenerGuard>;
  const peer = accessTestKey(), destinationKeyId = "b".repeat(64);
  const listenerKinds = new WeakMap<object, "tcp" | "unix">();
  const gate = createMeshIngressGate({ mode, destinationKeyId, bootedAt: Date.now() - 1000,
    guardedLocalListener: (socket) => {
      const listener = listenerKinds.get(socket);
      return Boolean(listener && guard.isGuarded(listener));
    },
    lookupPeer: (id) => id === nodeKeyId(peer.publicKey) ? { publicKey: peer.publicKey, tier: "observe" } : undefined,
    nonceClaim: new PeerNonceCache(), logger: { warn() {} } });
  const serve = (listener: "tcp" | "unix") => {
    const server = createServer((req, res) => { if (listener === "unix" || isRuntimeLoopbackTcpSocket(req.socket, port)) listenerKinds.set(req.socket, listener); void gate.gateHttpRequest(req, res, async () => {
      if (req.url === "/v1/events/stream") { res.writeHead(200, { "content-type": "text/event-stream" }); res.write("data: fixture\n\n"); return; }
      res.setHeader("content-type", "application/json"); res.end('{"ok":true}');
    }); });
    server.on("upgrade", (req, socket) => {
      if (listener === "unix" || isRuntimeLoopbackTcpSocket(socket as { localPort?: number; localAddress?: string }, port)) listenerKinds.set(socket, listener);
      if (gate.gateUpgrade(req, socket)) {
        socket.end("HTTP/1.1 101 Switching Protocols\r\nConnection: close\r\n\r\n");
      }
    });
    server.on("connection", (socket) => {
      if (listener === "unix" || isRuntimeLoopbackTcpSocket(socket, port)) guard.trackConnection(listener, socket);
    });
    return server;
  };
  const tcp = serve("tcp"), unix = serve("unix");
  await Promise.all([new Promise<void>((r) => tcp.listen(0, "127.0.0.1", r)), new Promise<void>((r) => unix.listen(socketPath, r))]);
  port = (tcp.address() as { port: number }).port;
  guard = createTailscaleListenerGuard({ port, socketPath }, { now: () => now, read: async () => ({ ok, stdout: status, source: "cli" }) });
  const base = `http://127.0.0.1:${port}`;
  const request = (path: string, viaUnix = false, headers: Record<string, string> = {}, method = "GET") => new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = httpRequest({ ...(viaUnix ? { socketPath } : { hostname: "127.0.0.1", port }), path, headers, method }, (res) => {
      let body = ""; res.on("data", (chunk) => body += chunk); res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(body) }));
    }); req.on("error", reject); req.end();
  });
  return { base, port, socketPath, guard, peer, destinationKeyId, request,
    setNow: (value: number) => now = value,
    async setStatus(value: string, success = true) { status = value; ok = success; await guard.refresh(); },
    async close() { guard.stop(); tcp.closeAllConnections(); unix.closeAllConnections(); await Promise.all([new Promise<void>((r) => tcp.close(() => r())), new Promise<void>((r) => unix.close(() => r()))]); rmSync(dir, { recursive: true, force: true }); },
  };
}

// E1 management routes must lose local authority at the common ingress gate,
// before any diagnostic, ping, configuration, control or upload handler runs.
const meshManagementRoutes = [
  ["GET", "/v1/mesh/approvals/config"],
  ["POST", "/v1/mesh/approvals/config"],
  ["GET", "/v1/mesh/diagnostics"],
  ["POST", "/v1/mesh/ping"],
  ["GET", "/v1/mesh/bridge"],
  ["POST", "/v1/mesh/bridge/config"],
  ["POST", "/v1/mesh/bridge/control"],
  ["POST", "/v1/diagnostics/reports/collect"],
  ["POST", "/v1/diagnostics/reports/upload"],
  ["POST", "/v1/mesh/bridge/feedback/collect"],
  ["POST", "/v1/mesh/bridge/feedback/upload"],
] as const;
for (const mode of ["verify-warn", "enforce"] as const) {
  for (const listener of ["tcp", "unix"] as const) {
    test(`mesh management routes are refused only on the guarded ${listener} listener in ${mode}`, async () => {
      const f = await fixture(mode), viaUnix = listener === "unix";
      try {
        const target = viaUnix ? `unix:${f.socketPath}` : `127.0.0.1:${f.port}`;
        for (const [method, path] of meshManagementRoutes) {
          expect(meshRouteTierFor(method, path)).toBe("local");
          expect((await f.request(path, viaUnix, {}, method)).status).toBe(200);
        }
        await f.setStatus(JSON.stringify({ TCP: { "443": { TCPForward: target } } }));
        for (const [method, path] of meshManagementRoutes) {
          const denied = await f.request(path, viaUnix, {}, method);
          expect(denied.status).toBe(403);
          expect(denied.body.error).toBe(TAILSCALE_GUARD_ERROR);
          expect((await f.request(path, !viaUnix, {}, method)).status).toBe(200);
        }
        await f.setStatus("{}");
        for (const [method, path] of meshManagementRoutes) {
          expect((await f.request(path, viaUnix, {}, method)).status).toBe(200);
        }
      } finally { await f.close(); }
    });
  }
}
for (const mode of ["verify-warn", "enforce"] as const) {
  test(`TCP match demotes only that listener and preserves public/peer auth in ${mode}`, async () => {
    const f = await fixture(mode);
    try {
      expect((await f.request("/v1/snapshot")).status).toBe(200);
      await f.setStatus(JSON.stringify({ TCP: { "443": { TCPForward: `127.0.0.1:${f.port}` } }, AllowFunnel: { "fixture:443": true } }));
      const denied = await f.request("/v1/snapshot");
      expect(denied.status).toBe(403); expect(denied.body.error).toBe(TAILSCALE_GUARD_ERROR);
      expect(denied.body.detail).toContain("Removing the handler restores local access");
      expect(JSON.stringify(denied.body)).not.toContain(String(f.port)); expect(JSON.stringify(denied.body)).not.toContain("fixture:");
      expect((await f.request("/v1/snapshot", true)).status).toBe(200);
      expect(await requestScoutBrokerJson(f.base, "/v1/snapshot", { socketPath: f.socketPath })).toEqual({ ok: true });
      expect((await f.request("/v1/node")).status).toBe(200);
      expect((await f.request("/v1/mesh/nodes")).status).toBe(401);
      const headers = signPeerRequest(f.peer, { method: "GET", path: "/v1/mesh/nodes", destinationKeyId: f.destinationKeyId });
      expect((await f.request("/v1/mesh/nodes", false, headers)).status).toBe(200);
      await f.setStatus("{}"); expect((await f.request("/v1/snapshot")).status).toBe(200);
    } finally { await f.close(); }
  });
  test(`canonical socket match leaves TCP working and unknown/failed/stale probes restore local in ${mode}`, async () => {
    const f = await fixture(mode);
    try {
      const alias = `${f.socketPath}.alias`; symlinkSync(f.socketPath, alias);
      const config = JSON.stringify({ TCP: { "443": { TCPForward: `unix:${alias}` } } });
      await f.setStatus(config);
      expect((await f.request("/v1/snapshot", true)).body.error).toBe(TAILSCALE_GUARD_ERROR);
      expect((await f.request("/v1/snapshot")).status).toBe(200);
      for (const [text, success] of [[config, false], ["not JSON", true], ['{"Unknown":true}', true]] as const) {
        await f.setStatus(config); await f.setStatus(text, success);
        expect((await f.request("/v1/snapshot", true)).status).toBe(200);
      }
      await f.setStatus(config); f.setNow(10_000);
      expect((await f.request("/v1/snapshot", true)).status).toBe(200);
      await f.setStatus('{"Web":{"fixture:443":{"Handlers":{"/":{"Proxy":"http://localhost:43120"}}}}}');
      expect(f.guard.report().guardedListeners).toEqual([]);
    } finally { await f.close(); }
  });
}

test("headerless raw TCP relay and upgrades lose local tier after config evidence", async () => {
  const f = await fixture("verify-warn"), sockets = new Set<Duplex>();
  const relay = createTcpServer((socket) => {
    const upstream = connect(f.port, "127.0.0.1"); sockets.add(socket); sockets.add(upstream);
    socket.on("error", () => upstream.destroy()); upstream.on("error", () => socket.destroy());
    socket.pipe(upstream).pipe(socket);
  });
  await new Promise<void>((r) => relay.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(relay.address() as { port: number }).port}`;
  try {
    expect((await fetch(base + "/v1/snapshot")).status).toBe(200);
    await f.setStatus(JSON.stringify({ TCP: { "443": { TCPForward: `localhost:${f.port}` } } }));
    const denied = await fetch(base + "/v1/snapshot"); expect(denied.status).toBe(403);
    expect((await denied.json() as any).error).toBe(TAILSCALE_GUARD_ERROR);
    const upgrade = await new Promise<string>((resolve, reject) => {
      const socket = connect((relay.address() as { port: number }).port, "127.0.0.1");
      let text = ""; const timeout = setTimeout(() => { socket.destroy(); reject(new Error("upgrade timeout")); }, 1500);
      socket.on("data", (chunk) => text += chunk);
      socket.on("end", () => { clearTimeout(timeout); resolve(text); socket.destroy(); });
      socket.on("error", (error) => { clearTimeout(timeout); reject(error); });
      socket.on("connect", () => socket.write("GET /trpc HTTP/1.1\r\nHost: fixture.invalid\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: Zml4dHVyZS1rZXktMTIzNA==\r\n\r\n"));
    });
    // Bun HTTP upgrade compatibility can close without delivering a denial body.
    // Either way this real byte relay must not receive an accepted upgrade.
    expect(upgrade).not.toContain("101 Switching Protocols");
    if (upgrade) expect(upgrade).toContain(TAILSCALE_GUARD_ERROR);
  } finally { for (const socket of sockets) socket.destroy(); await new Promise<void>((r) => relay.close(() => r())); await f.close(); }
});

test("activation retires an existing HTTP stream only on the targeted listener", async () => {
  const f = await fixture("verify-warn");
  let tcpClosed = false, unixClosed = false;
  // Real server connections (including idle keepalives/streams) are registered
  // by the owning listener before a request, as in the daemon.
  const open = (unix: boolean) => new Promise<{ close(): void }>((resolve, reject) => {
    const req = httpRequest({ ...(unix ? { socketPath: f.socketPath } : { hostname: "127.0.0.1", port: f.port }), path: "/v1/events/stream" }, (res) => {
      const closed = () => { if (unix) unixClosed = true; else tcpClosed = true; };
      res.on("aborted", closed); res.on("error", closed); res.on("end", closed);
      res.once("data", () => resolve({ close() { res.destroy(); req.destroy(); } }));
    }); req.on("error", reject); req.end();
  });
  let tcp: { close(): void } | undefined, unix: { close(): void } | undefined;
  try {
    tcp = await open(false); unix = await open(true);
    expect(tcpClosed).toBe(false); expect(unixClosed).toBe(false);
    await f.setStatus(JSON.stringify({ TCP: { "443": { TCPForward: `127.0.0.1:${f.port}` } } }));
    for (let i = 0; i < 50 && !tcpClosed; i++) await new Promise((r) => setTimeout(r, 5));
    expect(tcpClosed).toBe(true); expect(unixClosed).toBe(false);
  } finally { tcp?.close(); unix?.close(); await f.close(); }
});

for (const [path, statusLine] of [
  ["/v1/snapshot", "HTTP/1.1 403 Forbidden"],
  ["/v1/mesh/nodes", "HTTP/1.1 401 Unauthorized"],
] as const) test(`guarded upgrade ${statusLine} constructs its sanitized refusal and closes after flush`, () => {
  let reply = "", destroyed = false;
  const gate = createMeshIngressGate({ mode: "verify-warn", guardedLocalListener: () => true,
    destinationKeyId: "b".repeat(64), bootedAt: Date.now(), lookupPeer: () => undefined,
    nonceClaim: new PeerNonceCache(), logger: { warn() {} } });
  const socket = { remoteAddress: "127.0.0.1", end(data: string, flushed?: () => void) { reply = data; flushed?.(); }, destroy() { destroyed = true; } } as unknown as Duplex;
  expect(gate.gateUpgrade({ method: "GET", url: path, headers: {} } as IncomingMessage, socket)).toBe(false);
  expect(reply.startsWith(`${statusLine}\r\n`)).toBe(true);
  expect(reply).toContain(TAILSCALE_GUARD_ERROR); expect(reply).toContain("Removing the handler restores local access");
  expect(destroyed).toBe(true);
});
