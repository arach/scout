// Review regression fixture: actual relay, Noise,
// runtime, local control and owner, with only application sinks instrumented.
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateKeyPair, type KeyPair } from "../packages/runtime/src/pairing-security/noise.ts";
import { SecureTransport } from "../packages/runtime/src/pairing-security/transport.ts";
import { bytesToHex } from "../packages/runtime/src/pairing-security/identity.ts";
import { pairingTrustOwner } from "../packages/runtime/src/pairing-security/trust-owner.ts";
import { requestLocalPairingOpportunity } from "../packages/runtime/src/pairing-local-socket.ts";
import { startRelay } from "../packages/runtime/src/relay-transport.ts";

const flavor = process.argv[2]!, scenario = process.argv[3]!;
const base = resolve(flavor === "web" ? "packages/web/server/core/pairing/runtime" : "apps/desktop/src/core/pairing/runtime");
const { initTRPC } = await import(Bun.resolveSync("@trpc/server", base));
const t = initTRPC.create();
mock.module(resolve(base, "bridge/router.ts"), () => ({
  bridgeRouter: t.router({probe: t.procedure.query(({ctx}: any) => ({secret: "rpc-secret", reconnectRoom: ctx.reconnectRoom}))}),
  lookupMobileInboxItemForEvent: () => null,
}));
mock.module(resolve(base, "bridge/server.ts"), () => ({handleRPC: async () => ({result: "rpc-secret"})}));
mock.module(resolve(base, "bridge/broker-message-fanout.ts"), () => ({watchSharedScoutMessages: async () => {}}));
async function freePort() {
  return new Promise<number>((done, fail) => {
    const server = createServer(); server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as {port: number}).port;
      server.close(error => error ? fail(error) : done(port));
    });
  });
}
async function waitFor(check: () => boolean, label: string, ms = 3000) {
  const deadline = performance.now() + ms;
  while (!check()) {
    if (performance.now() >= deadline) throw Error(`fixture timeout: ${label}`);
    await Bun.sleep(5);
  }
}
async function observeUntil(check: () => boolean, ms: number) {
  const deadline = performance.now() + ms;
  while (!check() && performance.now() < deadline) await Bun.sleep(5);
  return check();
}
const port = await freePort(), bridgePort = await freePort();
const relay = startRelay(port, {hostname: "127.0.0.1"});
const relayURL = `ws://127.0.0.1:${port}`, httpURL = `http://127.0.0.1:${port}`;
process.env.OPENSCOUT_PAIRING_PORT = String(bridgePort);
writeFileSync(join(process.env.OPENSCOUT_PAIRING_HOME!, "config.json"), JSON.stringify({port: bridgePort, secure: true, sessions: []}));
pairingTrustOwner().migrateToCapsule("registry-fixture-cutover");
const { startPairingRuntime } = await import(pathToFileURL(resolve(base, "runtime.ts")).href);
const carriers: WebSocket[] = [];
const OriginalWebSocket = globalThis.WebSocket;
globalThis.WebSocket = class extends OriginalWebSocket {
  constructor(url: any, options?: any) {
    super(url, options);
    if (new URL(String(url)).searchParams.get("role") === "bridge") carriers.push(this);
  }
} as typeof WebSocket;
const connectedRooms: string[] = [];
let windowVisible = false;
const runtime = await startPairingRuntime({
  relayUrl: relayURL + "?key=stale-configured-key",
  relayEvents: {onConnected: ({room}: {room: string}) => connectedRooms.push(room)},
  onPairingOpportunity: (payload: unknown) => {windowVisible = payload !== null;},
});
const hostKey = bytesToHex(runtime.identity.publicKey), owner = pairingTrustOwner();
const trusted = generateKeyPair(), intended = generateKeyPair(), trustedKey = bytesToHex(trusted.publicKey);
const sockets: WebSocket[] = [];
let requestId = 0;
function grantTrusted() {
  owner.mutate(owner.read().revision, crypto.randomUUID(), {type: "grant", peer: {
    publicKey: trustedKey, pairedAt: new Date().toISOString(),
  }});
}
async function resolveRoom() {
  const response = await fetch(`${httpURL}/resolve`, {
    method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({bridgePublicKey: hostKey}),
  });
  assert.equal(response.status, 200, "fixture: resolve must reach a live bridge");
  const body = await response.json() as {room: string};
  assert.equal(typeof body.room, "string"); return body.room;
}
async function openWindow() {
  const opened = await requestLocalPairingOpportunity(bridgePort, "open");
  assert(opened, "fixture: local control opens window");
  await waitFor(() => connectedRooms.includes(opened.payload.room), "QR carrier connected");
  assert(windowVisible, "fixture: window is initially visible");
  return opened;
}
async function connect(keys: KeyPair, room: string, pattern: "XX" | "IK") {
  const socket = new WebSocket(`${relayURL}?room=${room}&role=client`); sockets.push(socket);
  const data: string[] = [], state = {ready: false, closed: 0, reason: ""};
  let transport: SecureTransport;
  socket.addEventListener("close", event => {state.closed = event.code; state.reason = event.reason;});
  socket.addEventListener("message", event => transport.receive(
    typeof event.data === "string" ? event.data : new Uint8Array(event.data as ArrayBuffer),
  ));
  await new Promise<void>((done, fail) => {
    socket.addEventListener("open", () => done(), {once: true});
    socket.addEventListener("error", () => fail(Error("fixture: phone websocket open failed")), {once: true});
  });
  transport = new SecureTransport({send: frame => socket.send(frame)}, "initiator", keys, {
    onReady: () => {state.ready = true;}, onMessage: message => data.push(message),
  }, {pattern, remoteStaticKey: pattern === "IK" ? runtime.identity.publicKey : undefined,
    trustOnComplete: false, skipTrustWrite: () => true});
  // A vanished invitation carrier is a behavior observation, not a fixture
  // startup error. Positive setup probes below still require real Noise/RPC.
  await observeUntil(() => state.ready || state.closed !== 0, 1000);
  return {socket, transport, data, state, room};
}
type Phone = Awaited<ReturnType<typeof connect>>;
async function probe(phone: Phone, ms = 750) {
  const id = ++requestId;
  if (phone.state.ready && phone.state.closed === 0 && phone.socket.readyState === WebSocket.OPEN) {
    phone.transport.send(JSON.stringify({id, jsonrpc: "2.0", method: "query", params: {path: "probe"}}));
  }
  const answered = () => phone.data.some(text => {
    const result = JSON.parse(text); return result.id === id && text.includes("rpc-secret");
  });
  await observeUntil(() => answered() || phone.state.closed !== 0, ms);
  return answered();
}
function record(value: object) {console.log(`REVIEW_OBSERVATION ${JSON.stringify({id: scenario, flavor, ...value})}`);}
try {
  await waitFor(() => connectedRooms.length > 0, "initial reconnect carrier connected");
  if (scenario === "T-WINDOW-TRUSTED") {
    grantTrusted();
    const opened = await openWindow(), revision = owner.read().revision;
    // Reconnects discover a room through /resolve; a new scan uses the QR room.
    const existing = await connect(trusted, await resolveRoom(), "IK");
    assert(await probe(existing), "fixture: trusted reconnect RPC must work");
    const visibleAfterReconnect = windowVisible, revisionAfterReconnect = owner.read().revision;
    const newcomer = await connect(intended, opened.payload.room, "XX");
    const newPhoneAdmitted = await probe(newcomer);
    record({trustedRPC: true, windowVisibleAfterReconnect: visibleAfterReconnect,
      trustedReconnectChangedRevision: revisionAfterReconnect !== revision,
      newPhoneAdmitted, newPhoneClose: newcomer.state.closed,
      intendedTrusted: owner.read().peers.some(peer => peer.publicKey === bytesToHex(intended.publicKey))});
  } else if (scenario === "T-WINDOW-DISRUPT") {
    grantTrusted();
    const existing = await connect(trusted, await resolveRoom(), "IK");
    assert(await probe(existing), "fixture: pre-window RPC must work");
    const openedAt = performance.now(), opened = await openWindow();
    const resolvedRoom = await resolveRoom();
    const rpcAfterWindowOpen = await probe(existing);
    record({rpcBeforeWindowOpen: true, rpcAfterWindowOpen, oldRoom: existing.room,
      qrRoom: opened.payload.room, resolvedRoom, oldSocketClose: existing.state.closed,
      oldSocketReadyState: existing.socket.readyState, elapsedMs: performance.now() - openedAt,
      windowVisible});
  } else if (scenario === "T-REVOKED-RESOLVE") {
    grantTrusted();
    const original = await connect(trusted, await resolveRoom(), "IK");
    assert(await probe(original), "fixture: original trusted phone RPC must work");
    original.socket.close(); await waitFor(() => original.state.closed !== 0, "original phone disconnect");
    owner.mutate(owner.read().revision, crypto.randomUUID(), {type: "revoke", publicKey: trustedKey});
    assert(!owner.read().peers.some(peer => peer.publicKey === trustedKey), "fixture: revoke committed");
    const opened = await openWindow();
    const retry = await connect(trusted, await resolveRoom(), "IK");
    const revokedRPC = await probe(retry);
    const revokedPhoneTrusted = owner.read().peers.some(peer => peer.publicKey === trustedKey);
    const visibleAfterRetry = windowVisible;
    const replacement = await connect(intended, opened.payload.room, "XX");
    const intendedPhoneAdmitted = await probe(replacement);
    record({revokedPhoneTrusted, revokedRPC, revokedClose: retry.state.closed,
      windowVisibleAfterRetry: visibleAfterRetry, intendedPhoneAdmitted, intendedClose: replacement.state.closed});
  } else if (scenario === "T-MULTI-PHONE") {
    const initialRoom = await resolveRoom();
    const firstWindow = await openWindow();
    const first = await connect(intended, firstWindow.payload.room, "XX");
    assert(await probe(first), "fixture: first phone pairs");
    await waitFor(() => !windowVisible, "first window closes");
    first.socket.close(); await waitFor(() => first.state.closed !== 0, "first phone leaves QR room");
    const online = await connect(intended, await resolveRoom(), "IK");
    assert(await probe(online), "fixture: first phone reconnects");
    const secondWindow = await openWindow();
    const second = await connect(trusted, secondWindow.payload.room, "XX");
    const secondPaired = await probe(second), firstStillOnline = await probe(online);
    const reconnected = await connect(intended, await resolveRoom(), "IK");
    const freshReconnectRPC = await probe(reconnected);
    record({secondPaired, firstStillOnline, firstClose: online.state.closed, freshReconnectRPC,
      stableReconnectRoom: await resolveRoom() === initialRoom,
      manifestReconnectRoom: JSON.parse(second.data.find(text => text.includes("rpc-secret"))!).result.data.reconnectRoom,
      initialRoom, peers: owner.read().peers.length, windowClosed: !windowVisible});
  } else if (scenario === "T-RETIRED-ROOM") {
    grantTrusted();
    const opened = await openWindow();
    const phone = await connect(intended, opened.payload.room, "XX");
    assert(await probe(phone), "fixture: newly paired phone RPC");
    await waitFor(() => !windowVisible, "pairing window consumed");
    const untrusted = await connect(generateKeyPair(), opened.payload.room, "XX");
    await probe(untrusted);
    const alreadyTrusted = await connect(trusted, opened.payload.room, "IK");
    await probe(alreadyTrusted);
    const currentRPC = await probe(phone);
    const nextWindow = await openWindow();
    const survivesNextWindow = await probe(phone);
    const nextPhone = await connect(generateKeyPair(), nextWindow.payload.room, "XX");
    const nextPhonePaired = await probe(nextPhone);
    const carrier = carriers.find(socket => new URL(socket.url).searchParams.get("room") === opened.payload.room)!;
    await observeUntil(() => phone.state.closed !== 0, 1000);
    const authorityClose = phone.state.closed;
    const activeUntilEmpty = carrier.readyState === WebSocket.OPEN;
    phone.socket.close();
    const bridgeLeftAfterLastDevice = await observeUntil(() => carrier.readyState === WebSocket.CLOSED, 1000);
    record({untrustedClose: untrusted.state.closed, trustedNewConnectionClose: alreadyTrusted.state.closed,
      currentRPC, survivesNextWindow, nextPhonePaired, authorityClose, activeUntilEmpty, bridgeLeftAfterLastDevice, windowClosed: !windowVisible});
  } else if (scenario === "T-QR-TRUSTED" || scenario === "T-QR-REGRANT") {
    grantTrusted();
    if (scenario === "T-QR-REGRANT") owner.mutate(owner.read().revision, crypto.randomUUID(), {type: "revoke", publicKey: trustedKey});
    const opened = await openWindow(), revision = owner.read().revision;
    const phone = await connect(trusted, opened.payload.room, "XX");
    const admitted = await probe(phone);
    record({admitted, windowClosed: !windowVisible, revisionChanged: owner.read().revision !== revision,
      trusted: owner.read().peers.some(peer => peer.publicKey === trustedKey)});
  } else if (scenario === "T-RESOLVE-PAIRING-ROOM") {
    const opened = await openWindow();
    const resolvedRoom = await resolveRoom();
    const health = await (await fetch(`${httpURL}/healthz?bridgePublicKey=${hostKey}`)).json() as {roomId: string};
    const pairingCarrier = carriers.find(socket => new URL(socket.url).searchParams.get("room") === opened.payload.room)!;
    record({qrRoom: opened.payload.room, resolvedRoom, healthRoom: health.roomId,
      pairingIndexed: new URL(pairingCarrier.url).searchParams.has("key"),
      resolveReturnsPairingRoom: resolvedRoom === opened.payload.room});
  } else throw Error("fixture: unknown scenario");
} finally {
  for (const socket of sockets) socket.close();
  await runtime.stop(); relay.stop();
}
process.exit(0);
