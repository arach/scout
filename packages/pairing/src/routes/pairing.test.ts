import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import type { Context } from "hono";
import * as realPairing from "../pairing.ts";
import { createPendingPairRequestStore } from "../pairing-pair-requests.ts";

const stubs = {
  pairingStateResult: {} as Record<string, any>,
  getPairingStateCalls: 0,
  refreshPairingStateCalls: 0,
  controlPairingCalls: 0,
  approvalPairingCalls: [] as Array<{ action: string; request: { token: string } }>,
  approvalPairingWindows: new Map<string, { windowId: string; payload: Record<string, unknown> }>(),
};
function makePairingState(overrides: Record<string, unknown> = {}) {
  return { pairing: null, ...overrides };
}
beforeEach(() => {
  stubs.pairingStateResult = makePairingState();
  stubs.getPairingStateCalls = stubs.refreshPairingStateCalls = stubs.controlPairingCalls = 0;
  stubs.approvalPairingWindows.clear();
  stubs.approvalPairingCalls.length = 0;
});
mock.module("../pairing.ts", () => ({
  ...realPairing,
  async controlScoutWebApprovalPairing(action: string, request: { token: string }) {
    stubs.approvalPairingCalls.push({ action, request });
    if (action === "cancel") { stubs.approvalPairingWindows.delete(request.token); return null; }
    if (action === "open" && !stubs.approvalPairingWindows.has(request.token)) {
      stubs.approvalPairingWindows.set(request.token, { windowId: crypto.randomUUID(), payload: {
        v: 1, relay: "wss://relay.example.test", room: `request-${request.token}`,
        publicKey: "b".repeat(64), expiresAt: Date.now() + 300000,
      } });
    }
    return stubs.approvalPairingWindows.get(request.token) ?? null;
  },
  async controlScoutWebPairingService() { stubs.controlPairingCalls++; return stubs.pairingStateResult; },
  async getScoutWebPairingState() { stubs.getPairingStateCalls++; return stubs.pairingStateResult; },
  async refreshScoutWebPairingState() { stubs.refreshPairingStateCalls++; return stubs.pairingStateResult; },
  async removeScoutPairingTrustedPeer() {},
}));
const { mountPairingRoutes } = await import("./pairing.ts");
function makeStaticRoot() { return ""; }
async function createOpenScoutWebServer(options: {
  currentDirectory: string; resolvePeerAddress?: (c: Context) => string | undefined;
  assetMode?: string; staticRoot?: string; lanAccessScope?: string;
}) {
  const app = new Hono();
  mountPairingRoutes(app, {
    options, currentDirectory: options.currentDirectory,
    pendingPairRequests: createPendingPairRequestStore(),
    shellStateCache: { invalidate() {} },
  });
  return { app, async stop() {} };
}

describe("createOpenScoutWebServer: pairing routes", () => {
  test("requires and atomically consumes approval for direct LAN pairing", async () => {
    const qrValue = JSON.stringify({
      v: 1,
      relay: "ws://192.0.2.14:43131",
      room: "room-approved",
      publicKey: "b".repeat(64),
      expiresAt: Date.now() + 60_000,
    });
    stubs.pairingStateResult = makePairingState({
      pairing: {
        relay: "ws://192.0.2.14:43131",
        room: "room-approved",
        publicKey: "b".repeat(64),
        expiresAt: Date.now() + 60_000,
        qrArt: "",
        qrValue,
      },
    });
    let peerAddress = "192.0.2.201";
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
      lanAccessScope: "pairing",
      resolvePeerAddress: () => peerAddress,
    });

    const knock = await server.app.request("http://localhost/pair?route=lan", {
      headers: {
        accept: "application/json",
        "x-forwarded-for": "198.51.100.77",
      },
      redirect: "manual",
    });
    expect(knock.status).toBe(202);
    expect(knock.headers.get("location")).toBeNull();
    expect(stubs.getPairingStateCalls).toBeGreaterThan(0);
    expect(stubs.refreshPairingStateCalls).toBe(0);
    const { token } = await knock.json() as { token: string };

    const pendingPoll = await server.app.request(`http://localhost/pair?route=lan&token=${token}`, {
      headers: { accept: "application/json" },
      redirect: "manual",
    });
    expect(pendingPoll.status).toBe(202);
    await expect(pendingPoll.json()).resolves.toMatchObject({ status: "pending", token });

    peerAddress = "127.0.0.1";
    const listed = await server.app.request("http://localhost/api/pairing/requests");
    const listedBody = await listed.json() as {
      requests: Array<{ token: string; requesterIp: string | null }>;
    };
    expect(listedBody.requests.find((request) => request.token === token)?.requesterIp)
      .toBe("192.0.2.201");
    const approval = await server.app.request(`http://localhost/api/pairing/requests/${token}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approve" }),
    });
    expect(approval.status).toBe(200);
    expect(stubs.controlPairingCalls, "approval must not open the QR window").toBe(0);

    peerAddress = "192.0.2.201";
    const delivered = await server.app.request(`http://localhost/pair?route=lan&token=${token}`, {
      headers: { accept: "application/json" },
      redirect: "manual",
    });
    expect(delivered.status).toBe(302);
    expect(delivered.headers.get("location"))
      .toBe(`scout://pair?payload=${encodeURIComponent(JSON.stringify(stubs.approvalPairingWindows.get(token)!.payload))}`);
    expect(delivered.headers.get("location")).not.toContain(encodeURIComponent(qrValue));

    const replay = await server.app.request(`http://localhost/pair?route=lan&token=${token}`, {
      headers: { accept: "application/json" },
      redirect: "manual",
    });
    expect(replay.status).toBe(410);
    await server.stop();
  });

  test("approval alone opens a private request window without publishing a QR", async () => {
    stubs.pairingStateResult = makePairingState({ pairing: null });
    let peerAddress = "192.0.2.203";
    const server = await createOpenScoutWebServer({ currentDirectory: "/tmp/openscout",
      assetMode: "static", staticRoot: makeStaticRoot(), lanAccessScope: "pairing",
      resolvePeerAddress: () => peerAddress });
    try {
      const knock = await server.app.request("http://localhost/pair", { headers: { accept: "application/json" } });
      const { token } = await knock.json() as { token: string };
      peerAddress = "127.0.0.1";
      const approval = await server.app.request(`http://localhost/api/pairing/requests/${token}/decide`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "approve" }) });
      expect(approval.status).toBe(200);
      expect(stubs.controlPairingCalls, "approval must not open the QR window").toBe(0);
      peerAddress = "192.0.2.203";
      const poll = await server.app.request(`http://localhost/pair?token=${token}`, {
        headers: { accept: "application/json" }, redirect: "manual" });
      expect(poll.status).toBe(302);
      const deliveredPayload = JSON.parse(new URL(poll.headers.get("location")!).searchParams.get("payload")!);
      expect(deliveredPayload.room).toBe(`request-${token}`);
      expect(stubs.pairingStateResult.pairing).toBeNull();
      expect(stubs.approvalPairingCalls.filter(call => call.action === "open")).toHaveLength(1);
    } finally { await server.stop(); }
  });

  test("keeps denied LAN sources denied without minting another request", async () => {
    stubs.pairingStateResult = makePairingState({ pairing: null });
    let peerAddress = "192.0.2.202";
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
      lanAccessScope: "pairing",
      resolvePeerAddress: () => peerAddress,
    });

    const knock = await server.app.request("http://localhost/pair", {
      headers: { accept: "application/json" },
    });
    const { token } = await knock.json() as { token: string };
    peerAddress = "127.0.0.1";
    const denial = await server.app.request(`http://localhost/api/pairing/requests/${token}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "deny" }),
    });
    expect(denial.status).toBe(200);

    peerAddress = "192.0.2.202";
    const retry = await server.app.request("http://localhost/pair", {
      headers: { accept: "application/json" },
    });
    expect(retry.status).toBe(403);
    await expect(retry.json()).resolves.toEqual({ status: "denied", token });
    await server.stop();
  });

  test("does not let a loopback reverse proxy bypass LAN approval", async () => {
    stubs.pairingStateResult = makePairingState({ pairing: { qrValue: "proxied-live-secret" } });
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
      lanAccessScope: "pairing",
      resolvePeerAddress: () => "127.0.0.1",
    });

    const response = await server.app.request("http://localhost/pair", {
      headers: {
        accept: "application/json",
        // A trusted edge appends the authoritative peer at the right. The
        // caller-controlled first hop must not become the dedupe identity.
        "x-forwarded-for": "198.51.100.77, 192.0.2.204",
      },
      redirect: "manual",
    });
    expect(response.status).toBe(202);
    expect(response.headers.get("location")).toBeNull();
    const { token } = await response.json() as { token: string };
    const listed = await server.app.request("http://localhost/api/pairing/requests");
    const body = await listed.json() as {
      requests: Array<{ token: string; requesterIp: string | null }>;
    };
    expect(body.requests.find((request) => request.token === token)?.requesterIp)
      .toBe("192.0.2.204");
    await server.stop();
  });

  test("GET /pair does not require an operator credential and records the client app", async () => {
    stubs.pairingStateResult = makePairingState({ pairing: null });
    let peerAddress = "192.0.2.211";
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
      resolvePeerAddress: () => peerAddress,
    });

    const response = await server.app.request("http://localhost/pair?route=lan", {
      headers: {
        accept: "application/json",
        "x-scout-client": "scout-ios",
        "x-scout-device-name": "Test phone",
      },
    });

    expect(response.status).toBe(202);
    const body = await response.json() as { status: string; token: string };
    expect(body.status).toBe("pending");
    expect(body.token).toBeTruthy();

    peerAddress = "127.0.0.1";
    const listed = await server.app.request("http://localhost/api/pairing/requests");
    expect(listed.status).toBe(200);
    const payload = await listed.json() as {
      requests: Array<{ requesterApp?: string; requesterLabel?: string }>;
    };
    expect(payload.requests[0]?.requesterApp).toBe("scout-ios");
    expect(payload.requests[0]?.requesterLabel).toBe("Test phone");
  });
});
