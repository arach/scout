import { afterEach, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScoutPairingBridgeClient } from "./pairing.ts";
import { startBridgeServerTRPC } from "./core/pairing/runtime/bridge/server-trpc.ts";
import type { Bridge } from "./core/pairing/runtime/bridge/bridge.ts";

// These bridges run plaintext; pin it rather than read this machine's config.
const PLAINTEXT = { expectedMode: "plaintext" } as const;
const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });

test("status clients request no event stream and release the connection", async () => {
  let eventSubscriptions = 0;
  const bridge = {
    listSessions: () => [],
    getSessionSummaries: () => [],
    onEvent: () => { eventSubscriptions++; return () => {}; },
  } as unknown as Bridge;
  // The bridge helper does not expose its chosen ephemeral port.
  const reservation = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = reservation.port!;
  reservation.stop(true);
  const server = startBridgeServerTRPC({ bridge, port, secure: false });
  cleanup.push(() => server.stop());
  for (let i = 0; i < 10; i++) {
    const client = await createScoutPairingBridgeClient(port, PLAINTEXT);
    try {
      const result = await client.query<{ sessions: unknown[] }>("bridgeStatus");
      expect(result.sessions).toEqual([]);
    } finally { client.close(); }
  }
  expect(eventSubscriptions).toBe(0);
});

test("a timed-out handshake closes even when the server accepts it late", async () => {
  let live = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(req, server) {
      await Bun.sleep(1800);
      return server.upgrade(req) ? undefined : new Response("closed", { status: 400 });
    },
    websocket: {
      open() { live++; },
      close() { live--; },
      message() {},
    },
  });
  cleanup.push(() => server.stop(true));
  await expect(createScoutPairingBridgeClient(server.port!, PLAINTEXT)).rejects.toThrow("Timed out connecting");
  await Bun.sleep(500);
  expect(live).toBe(0);
  expect(server.pendingWebSockets).toBe(0);
});

test("connection refusal rejects without waiting for the connection timeout", async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = server.port!;
  server.stop(true);
  await expect(createScoutPairingBridgeClient(port, PLAINTEXT)).rejects.toThrow("Unable to connect");
});

function startLimitedBridge(connectionLimits: Parameters<typeof startBridgeServerTRPC>[0]["connectionLimits"]) {
  const reservation = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = reservation.port!;
  reservation.stop(true);
  const bridge = { listSessions: () => [], getSessionSummaries: () => [] } as unknown as Bridge;
  const server = startBridgeServerTRPC({ bridge, port, connectionLimits });
  cleanup.push(() => server.stop());
  return port;
}

async function openStatusSocket(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}?events=0`);
  cleanup.push(() => socket.close());
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error("connection failed"));
  });
  return socket;
}

test("server expires abandoned status sockets even if clients never close them", async () => {
  const port = startLimitedBridge({ queryLifetimeMs: 50, closeGraceMs: 50 });
  const socket = await openStatusSocket(port);
  const closed = await new Promise<CloseEvent>((resolve) => { socket.onclose = resolve; });
  expect(closed.code).toBe(1008);
  expect(closed.reason).toBe("Status connection expired");
  let connections = 1;
  const deadline = Date.now() + 500;
  while (connections && Date.now() < deadline) {
    await Bun.sleep(10);
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json() as { connections: number };
    connections = health.connections;
  }
  expect(connections).toBe(0);
});

test("connection admission is bounded and recovers after a client disconnects", async () => {
  const port = startLimitedBridge({ maxConnections: 2 });
  const a = await openStatusSocket(port);
  await openStatusSocket(port);
  const denied = new WebSocket(`ws://127.0.0.1:${port}?events=0`);
  cleanup.push(() => denied.close());
  const accepted = await new Promise<boolean>((resolve) => {
    denied.onopen = () => resolve(true);
    denied.onerror = () => resolve(false);
  });
  expect(accepted).toBe(false);
  await new Promise<void>((resolve) => { a.onclose = () => resolve(); a.close(); });
  const replacement = await openStatusSocket(port);
  expect(replacement.readyState).toBe(WebSocket.OPEN);
});

test("snapshot polls share one connection per window and refresh after it", async () => {
  const { loadScoutPairingSessionSnapshots } = await import("./pairing.ts");
  // Snapshot readers resolve their mode from config rather than a client option.
  // Own that config: no operator pairing mode or identity belongs in this test.
  const home = mkdtempSync(join(tmpdir(), "scout-pairing-snapshots-"));
  const previousHome = process.env.OPENSCOUT_PAIRING_HOME;
  cleanup.push(() => {
    if (previousHome === undefined) delete process.env.OPENSCOUT_PAIRING_HOME;
    else process.env.OPENSCOUT_PAIRING_HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  });
  writeFileSync(join(home, "config.json"), JSON.stringify({ secure: false }));
  process.env.OPENSCOUT_PAIRING_HOME = home;
  let connections = 0;
  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (new URL(req.url).pathname === "/health") return Response.json({ mode: "plaintext" });
      return server.upgrade(req) ? undefined : new Response();
    },
    websocket: {
      open() { connections++; },
      message(ws, raw) {
        const req = JSON.parse(String(raw));
        ws.send(JSON.stringify({ id: req.id, result: { type: "data", data: { sessions: [] } } }));
      },
    },
  });
  cleanup.push(() => server.stop(true));
  await Promise.all(Array.from({ length: 100 }, () => loadScoutPairingSessionSnapshots(server.port!)));
  expect(connections).toBe(1);
  await loadScoutPairingSessionSnapshots(server.port!);
  expect(connections).toBe(1);
  setSystemTime(new Date(Date.now() + 6_000));
  try {
    await loadScoutPairingSessionSnapshots(server.port!);
  } finally {
    setSystemTime();
  }
  expect(connections).toBe(2);
  expect(readdirSync(home)).toEqual(["config.json"]);
});

test("incomplete secure handshakes cannot retain a connection indefinitely", async () => {
  const { generateKeyPair } = await import("./core/pairing/runtime/security/index.ts");
  const reservation = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = reservation.port!;
  reservation.stop(true);
  const server = startBridgeServerTRPC({
    bridge: {} as Bridge, port, secure: true, identity: generateKeyPair(),
    connectionLimits: { handshakeTimeoutMs: 50 },
  });
  cleanup.push(() => server.stop());
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  cleanup.push(() => socket.close());
  const closed = await new Promise<CloseEvent>((resolve) => { socket.onclose = resolve; });
  expect(closed.code).toBe(1008);
  expect(closed.reason).toBe("Handshake timed out");
});

test("expired clients cannot hold a slot by ignoring the close handshake", async () => {
  const { connect } = await import("node:net");
  const port = startLimitedBridge({ queryLifetimeMs: 30, closeGraceMs: 30 });
  const socket = connect(port, "127.0.0.1");
  cleanup.push(() => socket.destroy());
  let upgraded = false;
  await new Promise<void>((resolve, reject) => {
    socket.setTimeout(1000, () => { socket.destroy(); reject(new Error("expired socket retained")); });
    socket.on("error", reject);
    socket.on("data", (data) => {
      if (data.toString().includes("101 Switching Protocols")) upgraded = true;
      // Deliberately never acknowledge the server's WebSocket close frame.
    });
    socket.on("close", () => resolve());
    socket.on("connect", () => socket.write(
      `GET /?events=0 HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    ));
  });
  expect(upgraded).toBe(true);
});

test("local readers reach a secure bridge with its own key and leave no paired-device record", async () => {
  const home = mkdtempSync(join(tmpdir(), "scout-pairing-home-"));
  cleanup.push(() => rmSync(home, { recursive: true, force: true }));
  const child = Bun.spawn(["bun", `${import.meta.dir}/fixtures/pairing-secure-local-reader.ts`], {
    env: { ...process.env, HOME: home, OPENSCOUT_HOME: join(home, "config"), OPENSCOUT_SUPPORT_DIRECTORY: join(home, "support"), OPENSCOUT_WEB_AUTH_TOKEN: "test-pairing-http-token" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(exitCode, stderr).toBe(0);
  const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
  expect(result.ingress).toEqual({unauthenticated: 401, authenticated: 200, forwarded: 401, noClient: 404, pairKnock: 202});
  expect(result.accountHost).toEqual({accountSpoof:400,approval:200,repeated:409,accountPoll:400,invitationOpens:0});
  expect(result.sessions).toEqual([]);
  expect(result.strangerCloseCode).toBe(4003);
  expect(result.trustedPeersWritten).toBe(false);
  expect(result.seededRecordUntouched).toBe(true);
  expect(result.squatterError).toContain("did not answer with this machine's bridge key");
}, 15_000);
