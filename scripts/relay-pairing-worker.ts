// Process-isolated fixture: actual relay WebSockets and Noise, with application
// sinks instrumented to count dispatches and secret/event delivery.
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { generateKeyPair, type KeyPair } from "../packages/runtime/src/pairing-security/noise.ts";
import { SecureTransport } from "../packages/runtime/src/pairing-security/transport.ts";
import { bytesToHex } from "../packages/runtime/src/pairing-security/identity.ts";
import { pairingTrustOwner, type PairingOpportunity } from "../packages/runtime/src/pairing-security/trust-owner.ts";
import { requestLocalPairingOpportunity } from "../packages/runtime/src/pairing-local-socket.ts";
import { startRelay } from "../packages/runtime/src/relay-transport.ts";

const flavor = process.argv[2] ?? "web", scenario = process.argv[3] ?? "revoked";
const base = resolve(flavor === "web" ? "packages/web/server/core/pairing/runtime" : "apps/desktop/src/core/pairing/runtime");
const { initTRPC } = await import(Bun.resolveSync("@trpc/server", base));
let dispatches = 0, subscriptions = 0;
const t = initTRPC.create();
mock.module(resolve(base, "bridge/router.ts"), () => ({lookupMobileInboxItemForEvent: () => null, bridgeRouter: t.router({probe: t.procedure.query(() => {dispatches++; return "rpc-secret";})})}));
mock.module(resolve(base, "bridge/server.ts"), () => ({handleRPC: async () => {dispatches++; return {id: "probe", result: "rpc-secret"};}}));
mock.module(resolve(base, "bridge/broker-message-fanout.ts"), () => ({watchSharedScoutMessages: async () => {subscriptions++;}}));
const OriginalWebSocket = globalThis.WebSocket;
const carriers: WebSocket[] = [];
globalThis.WebSocket = class extends OriginalWebSocket {
  constructor(url: any, options?: any) {
    super(url, options);
    if (new URL(String(url)).searchParams.get("role") === "bridge") carriers.push(this);
  }
} as typeof WebSocket;
const { connectToRelay } = await import(pathToFileURL(resolve(base, "bridge/relay-client.ts")).href);
async function freePort() {
  return new Promise<number>((done, fail) => {
    const s = createServer(); s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as {port: number}).port; s.close(e => e ? fail(e) : done(p));
    });
  });
}
const port = await freePort(), relay = startRelay(port, {hostname: "127.0.0.1"}), url = `ws://127.0.0.1:${port}`;
let host = generateKeyPair();
const phone = generateKeyPair(), other = generateKeyPair(), key = bytesToHex(phone.publicKey), owner = pairingTrustOwner();
let bridgeEvents: ((e: unknown) => void) | undefined, opportunity: PairingOpportunity | undefined;
const bridge = {
  listSessions: () => [{sessionId: "session-secret"}],
  onEvent: (fn: (e: unknown) => void) => {subscriptions++; bridgeEvents = fn; return () => {bridgeEvents = undefined;};},
};
let runtime: any, bridgePort = 0, workflowRoom: string | undefined;
// The live-session baseline uses the production cutover before listeners.
if (scenario === "live-revoke") { seed(); owner.migrateToCapsule("live-baseline-cutover"); }
let connection: ReturnType<typeof connectToRelay>;
if (scenario === "workflow") {
  bridgePort = await freePort();
  process.env.OPENSCOUT_PAIRING_PORT = String(bridgePort);
  writeFileSync(join(process.env.OPENSCOUT_PAIRING_HOME!, "config.json"), JSON.stringify({port: bridgePort, secure: true}));
  const { startPairingRuntime } = await import(pathToFileURL(resolve(base, "runtime.ts")).href);
  runtime = await startPairingRuntime({relayUrl: url});
  host = runtime.identity;
  connection = runtime.relayConnection;
} else {
  connection = connectToRelay(url, host, bridge as any, {
    kind: "pairing",
    admitNewPeer: (k, room, live) => opportunity?.admit(k, room, live) ?? false,
    onPeerAdmitted: () => {opportunity?.cancel(); opportunity = undefined;},
  });
}
const sockets: WebSocket[] = [];
async function until(check: () => boolean, label: string) {
  const end = Date.now() + 3000;
  while (!check()) {if (Date.now() > end) throw Error(`timeout ${label}`); await Bun.sleep(5);}
}
async function connect(pattern: "XX" | "IK", keys: KeyPair = phone, direct = false) {
  const ws = new WebSocket(direct ? `ws://127.0.0.1:${bridgePort}?events=0` : `${url}?room=${(workflowRoom ?? connection.qrPayload.room)}&role=client`);
  sockets.push(ws);
  const data: string[] = [], state = {ready: false, closed: 0, reason: ""}; let transport: SecureTransport;
  ws.addEventListener("message", e => transport.receive(typeof e.data === "string" ? e.data : new Uint8Array(e.data as ArrayBuffer)));
  ws.addEventListener("close", e => {state.closed = e.code; state.reason = e.reason;});
  await new Promise<void>((done, fail) => {
    ws.addEventListener("open", () => done(), {once: true}); ws.addEventListener("error", () => fail(Error("phone websocket")), {once: true});
  });
  transport = new SecureTransport({send: f => ws.send(f)}, "initiator", keys, {
    onReady: () => {state.ready = true;}, onMessage: m => data.push(m),
  }, {pattern, remoteStaticKey: pattern === "IK" ? host.publicKey : undefined, trustOnComplete: false, skipTrustWrite: () => true});
  await until(() => state.ready || state.closed !== 0, "phone handshake");
  return {ws, data, state, transport};
}
function begin(ms = 1000) {opportunity = owner.openPairingOpportunity(connection.qrPayload.room, Date.now() + ms);}
function revoke() {owner.mutate(owner.read().revision, crypto.randomUUID(), {type: "revoke", publicKey: key});}
function seed() {owner.mutate(owner.read().revision, crypto.randomUUID(), {type: "grant", peer: {publicKey: key, pairedAt: new Date().toISOString()}});}
async function accepted(pattern: "XX" | "IK" = "XX") {
  const p = await connect(pattern);
  p.transport.send(JSON.stringify({id: 3, jsonrpc: "2.0", method: "query", params: {path: "probe"}}));
  await until(() => p.data.some(x => x.includes("rpc-secret")), "accepted RPC");
  assert.equal(p.state.closed, 0); return p;
}
async function denied(pattern: "XX" | "IK", keys = phone) {
  const beforeDispatch = dispatches, beforeSubscriptions = subscriptions;
  const p = await connect(pattern, keys);
  if (p.state.closed === 0) {
    // Pipeline both application protocols as soon as the phone finishes Noise.
    p.transport.send(JSON.stringify({id: "probe", method: "session/list"}));
    p.transport.send(JSON.stringify({id: 4, jsonrpc: "2.0", method: "query", params: {path: "probe"}}));
  }
  await Bun.sleep(60);
  bridgeEvents?.({seq: 9, event: {event: "secret-event"}});
  await Bun.sleep(10);
  assert.equal(p.state.closed, 4003, "unadmitted peer must close 4003");
  assert.equal(p.data.length, 0, "unadmitted peer received data");
  assert.equal(dispatches, beforeDispatch, "unadmitted RPC dispatched");
  assert.equal(subscriptions, beforeSubscriptions, "unadmitted peer started subscriptions");
  return p;
}
try {
  await Bun.sleep(40);
  if (scenario === "live-revoke") {
    const current = await accepted("IK");
    const beforeDispatch = dispatches;
    current.data.length = 0;
    revoke(); // mutate returns only after its verified publication acknowledgement.
    const revokedRevision = owner.read().revision;
    const memberAfterAck = owner.read().peers.some(p => p.publicKey === key);
    if (current.state.closed === 0) {
      current.transport.send(JSON.stringify({id: "after-ack", method: "session/list"}));
      current.transport.send(JSON.stringify({id: 91, jsonrpc: "2.0", method: "query", params: {path: "probe"}}));
    }
    bridgeEvents?.({seq: 91, event: {event: "secret-event"}});
    await Bun.sleep(100);
    console.log(JSON.stringify({observation: "live-revoke", flavor, revokedRevision, memberAfterAck,
      postAckDispatches: dispatches - beforeDispatch,
      rpcAfterAck: current.data.some(x => x.includes("rpc-secret")),
      eventAfterAck: current.data.some(x => x.includes("secret-event")),
      phoneClose: current.state.closed, data: current.data}));
  } else if (scenario === "revoked") {
    seed(); const first = await accepted(); revoke();
    // Already-connected revocation is the separate registry change. This fix
    // must not let an unadmitted reconnect evict this still-connected peer.
    const retry = await connect("IK"); await Bun.sleep(60);
    const retrusted = owner.read().peers.some(p => p.publicKey === key);
    console.log(JSON.stringify({flavor, scenario, retrusted, phoneClose: retry.state.closed, data: retry.data}));
    assert.equal(retrusted, false, "revoked phone was re-trusted by remembered-room reconnect");
    assert.equal(retry.state.closed, 4003); assert.equal(retry.data.length, 0); assert.equal(first.state.closed, 0);
    await denied("XX");
  } else if (scenario === "lifecycle") {
    await denied("XX");
    begin(); opportunity!.cancel(); await denied("XX");
    begin(15); await Bun.sleep(25); await denied("IK");
    begin(); seed(); revoke(); await denied("XX"); // revision change cancels
    begin(); await accepted(); await denied("IK", other); // completion closes
    const revision = owner.read().revision;
    for (const pattern of ["IK", "XX"] as const) await accepted(pattern);
    assert.equal(owner.read().revision, revision, "trusted reconnect wrote a generation");
    revoke();
    // Changing only the QR display lifetime cannot open an opportunity.
    connection.qrPayload.expiresAt = Date.now() + 300_000;
    await denied("IK"); await denied("XX");
    begin(); await accepted("IK"); assert(owner.read().peers.some(p => p.publicKey === key));
  } else if (scenario === "carrier") {
    seed(); await accepted();
    const old = carriers[0]!; old.close(1012, "test carrier restart");
    await until(() => carriers.length > 1 && carriers.at(-1)!.readyState === WebSocket.OPEN, "carrier reconnect");
    const current = await accepted("IK");
    // Deliver a late callback on the old real socket after a new carrier is up.
    old.dispatchEvent(new Event("close"));
    current.data.length = 0;
    current.transport.send(JSON.stringify({id: 5, jsonrpc: "2.0", method: "query", params: {path: "probe"}}));
    await until(() => current.data.some(x => x.includes("rpc-secret")), "current carrier survived stale close");
    await denied("XX", other);
  } else if (scenario === "authority") {
    begin(); console.log("OPPORTUNITY_READY"); await Bun.stdin.text();
    await denied("XX"); assert(!owner.read().peers.some(p => p.publicKey === key));
  } else if (scenario === "workflow") {
    await denied("XX"); // runtime/daemon start is reconnect-only
    const originalRoom = runtime.qrPayload.room;
    const opened = await requestLocalPairingOpportunity(bridgePort, "open"); assert(opened);
    assert.notEqual(opened.payload.room, originalRoom, "explicit QR must rotate remembered room");
    await requestLocalPairingOpportunity(bridgePort, "cancel", opened.windowId);
    await denied("IK");
    const fresh = await requestLocalPairingOpportunity(bridgePort, "open"); assert(fresh);
    assert.notEqual(fresh.payload.room, opened.payload.room);
    await requestLocalPairingOpportunity(bridgePort, "cancel", opened.windowId); // stale cancel cannot cancel a newer view
    workflowRoom = fresh.payload.room;
    await accepted(); await denied("XX", other);
    const direct = await connect("XX", phone, true);
    direct.transport.send(JSON.stringify({id: "forged-control", method: "pairing/opportunity", params: {action: "open"}}));
    await until(() => direct.data.some(x => x.includes("forged-control")), "remote control refusal");
    assert(direct.data.find(x => x.includes("forged-control"))!.includes("-32001"));
    await denied("XX", other);
  } else throw Error("unknown scenario");
  console.log(JSON.stringify({ok: true, flavor, scenario, revision: owner.read().revision, dispatches, subscriptions}));
} finally {
  for (const ws of sockets) ws.close();
  if (runtime) await runtime.stop(); else connection.disconnect();
  relay.stop();
}
// Relay idle/grace timers are not application ownership; do not leave a worker
// alive just to wait them out after its explicit shutdown.
process.exit(0);
