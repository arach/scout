// Approval regression fixture: actual relay, Noise,
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
import { requestLocalApprovalPairingOpportunity, requestLocalPairingOpportunity } from "../packages/runtime/src/pairing-local-socket.ts";
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
let qrState: any = null;
const published: unknown[] = [];
const expiryCallbacks: Array<() => void> = [];
const originalSetTimeout = globalThis.setTimeout;
if (["A-RETRY", "A-SPENT-POLL"].includes(scenario)) globalThis.setTimeout = ((callback: any, delay: number, ...args: any[]) => {
  const timer = originalSetTimeout(callback, delay, ...args);
  if (delay === 300000) expiryCallbacks.push(() => {clearTimeout(timer); callback(...args);});
  return timer;
}) as typeof setTimeout;
const runtimeOptions = {
  relayUrl: relayURL + "?key=stale-configured-key",
  relayEvents: {onConnected: ({room}: {room: string}) => { connectedRooms.push(room); published.push({room}); }},
  onPairingOpportunity: (payload: any) => {windowVisible = payload !== null; qrState = payload ? {...payload, qrValue: JSON.stringify(payload)} : null; published.push(qrState);},
};
let runtime = await startPairingRuntime(runtimeOptions);
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
async function connect(keys: KeyPair, room: string, pattern: "XX" | "IK", direct = false) {
  const socket = new WebSocket(direct ? `ws://127.0.0.1:${bridgePort}?events=0` : `${relayURL}?room=${room}&role=client`); sockets.push(socket);
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
function record(value: object) {console.log(`APPROVAL_OBSERVATION ${JSON.stringify({id: scenario, flavor, ...value})}`);}
// Keep the application sinks instrumented; exercise real HTTP route logic,
// store transitions, own-key local control, relay carriers, Noise and owner.
const web = resolve("packages/web/server");
let beforeApprovalOpen: (() => Promise<void>) | undefined;
mock.module(resolve(web, "pairing.ts"), () => ({
  controlScoutWebApprovalPairing: async (action: "open" | "read" | "cancel", request: any) => {
    const authorityStamp = action === "open" ? owner.pairingAuthorityStamp() : undefined;
    if (action === "open") await beforeApprovalOpen?.();
    return requestLocalApprovalPairingOpportunity(bridgePort, action, {
      requestId: request.token, authorityStamp, ...(request.requesterPublicKey ? {publicKey: request.requesterPublicKey} : {}),
    });
  },
  controlScoutWebPairingService: async () => { throw Error("approval must not open QR"); },
  removeScoutPairingTrustedPeer: async () => {},
}));
mock.module(resolve(web, "pairing-state.ts"), () => ({loadPairingState: async () => ({pairing: qrState})}));
const { Hono } = await import(Bun.resolveSync("hono", web));
const { mountPairingRoutes } = await import(pathToFileURL(resolve(web, "routes/pairing.ts")).href);
const { createPendingPairRequestStore } = await import(pathToFileURL(resolve(web, "pairing-pair-requests.ts")).href);
const { buildPairingRendezvousNode } = await import(pathToFileURL(resolve(web, "core/pairing/runtime/rendezvous.ts")).href);
const { mobilePairingMeshEntrypointFromSnapshot, buildMeshRendezvousPresence } = await import("../packages/runtime/src/mesh-rendezvous.ts");
let clock = Date.now(), peerNumber = 1, peerAddress = "192.0.2.20";
const store = createPendingPairRequestStore({now: () => clock, ttlMs: 2000});
const app = new Hono();
mountPairingRoutes(app, {currentDirectory: process.cwd(), pendingPairRequests: store,
  options: {resolvePeerAddress: () => peerAddress}, shellStateCache: {invalidate() {}} as any});
const headers = {accept: "application/json"};
async function knock(publicKey?: string) {
  peerAddress = `192.0.2.${peerNumber++}`;
  const response = await app.request("http://localhost/pair", {headers: {...headers,
    "x-scout-client": "scout-ios", "x-scout-device-name": "Test phone",
    ...(publicKey ? {"x-scout-device-public-key": publicKey} : {})}});
  assert.equal(response.status, 202, "fixture: request created");
  const body = await response.json() as {token: string};
  return store.get(body.token)!;
}
async function approve(request: any, decision = "approve") {
  peerAddress = "127.0.0.1";
  return app.request(`http://localhost/api/pairing/requests/${request.token}/decide`, {
    method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({decision}),
  });
}
async function poll(request: any) {
  return app.request(`http://localhost/pair?token=${request.token}`, {headers, redirect: "manual"});
}
function payload(response: Response) {
  const location = response.headers.get("location");
  return location ? JSON.parse(new URL(location).searchParams.get("payload")!) : null;
}
async function readResult(request: any) {
  return requestLocalApprovalPairingOpportunity(bridgePort, "read", {requestId: request.token,
    ...(request.requesterPublicKey ? {publicKey: request.requesterPublicKey} : {})});
}
async function read(request: any) {
  const result = await readResult(request);
  return result && "payload" in result ? result : null;
}
async function carrierReady(room: string) {
  await waitFor(() => carriers.some(socket => new URL(socket.url).searchParams.get("room") === room && socket.readyState === WebSocket.OPEN), "approval carrier");
}
try {
  await waitFor(() => connectedRooms.length > 0, "reconnect carrier");
  if (scenario === "A-KEYED") {
    grantTrusted();
    const request = await knock(bytesToHex(intended.publicKey));
    const approvalStatus = (await approve(request)).status;
    const delivered = await poll(request), invitation = payload(delivered);
    if (!invitation) { record({approvalStatus, deliveredStatus: delivered.status, paired: false}); }
    else {
      await carrierReady(invitation.room);
      const wrong = await connect(trusted, invitation.room, "IK");
      const wrongRPC = await probe(wrong), remainsOpen = Boolean(await read(request));
      const right = await connect(intended, invitation.room, "XX");
      const paired = await probe(right), closed = await read(request) === null;
      record({approvalStatus, deliveredStatus: delivered.status, wrongRPC, wrongClose: wrong.state.closed,
        remainsOpen, paired, closed, replayStatus: (await poll(request)).status,
        noQR: !windowVisible && qrState === null});
    }
  } else if (scenario === "A-LEGACY") {
    const request = await knock();
    const approvalStatus = (await approve(request)).status;
    const delivered = await poll(request), invitation = payload(delivered);
    if (!invitation) record({approvalStatus, paired: false});
    else {
      await carrierReady(invitation.room);
      const first = await connect(intended, invitation.room, "XX");
      const paired = await probe(first);
      const other = await connect(trusted, invitation.room, "XX");
      const secondRPC = await probe(other);
      record({approvalStatus, paired, secondRPC, secondClose: other.state.closed,
        consumed: await read(request) === null, replayStatus: (await poll(request)).status});
    }
  } else if (scenario === "A-PRIVATE") {
    const qr = await openWindow();
    const request = await knock(bytesToHex(intended.publicKey));
    await approve(request);
    const privateWindow = await read(request);
    assert(privateWindow, "fixture: open approval");
    await carrierReady(privateWindow.payload.room);
    const room = privateWindow.payload.room;
    const health = await (await fetch(`${httpURL}/healthz?bridgePublicKey=${hostKey}`)).json() as any;
    const other = await knock(bytesToHex(intended.publicKey));
    await approve(other);
    const otherWindow = await read(other); assert(otherWindow);
    const otherPoll = await poll(other), otherPayload = payload(otherPoll);
    const hostState = {pairing: qrState, startedAt: Date.now(), updatedAt: Date.now()};
    const node = buildPairingRendezvousNode(hostState as any);
    const list = await app.request("http://localhost/api/pairing/requests");
    const direct = await app.request("http://localhost/api/pairing-state");
    const privacy = !JSON.stringify({hostState, published, node, list: await list.json(), state: await direct.json(),
      runtimeQR: runtime.qrPayload, generic: mobilePairingMeshEntrypointFromSnapshot(hostState),
      presence: buildMeshRendezvousPresence(node), other: otherPayload}).includes(room);
    const carrier = carriers.find(socket => new URL(socket.url).searchParams.get("room") === room)!;
    record({privacy, privateUnindexed: !new URL(carrier.url).searchParams.has("key"),
      resolvePrivate: await resolveRoom() === room, healthPrivate: health.roomId === room,
      resolveStable: await resolveRoom() === runtime.relayConnection!.qrPayload.room, healthStable: health.roomId === runtime.relayConnection!.qrPayload.room,
      qrUnchanged: qrState.room === qr.payload.room, otherStatus: otherPoll.status,
      otherOwnRoom: otherPayload?.room === otherWindow.payload.room,
      distinctRequests: otherPayload?.room !== room,
      ownPayload: payload(await poll(request))?.room === room});
  } else if (scenario === "A-AUTHORITY") {
    grantTrusted();
    const request = await knock(trustedKey); await approve(request);
    const invitation = payload(await poll(request)); assert(invitation, "fixture: delivered request");
    await carrierReady(invitation.room);
    owner.mutate(owner.read().revision, crypto.randomUUID(), {type: "revoke", publicKey: trustedKey});
    const phone = await connect(trusted, invitation.room, "IK");
    const revokedRPC = await probe(phone);
    record({revokedRPC, revokedClose: phone.state.closed,
      revokedTrusted: owner.read().peers.some(p => p.publicKey === trustedKey),
      invalidated: await read(request) === null});
  } else if (scenario === "A-COEXIST") {
    grantTrusted();
    const first = await knock(), second = await knock();
    await approve(first); const before = await read(first); assert(before);
    await approve(second); const next = await read(second); assert(next);
    const qr = await openWindow();
    const independent = Boolean(await read(first)) && Boolean(await read(second)) && windowVisible
      && before.payload.room !== next.payload.room && next.payload.room !== qr.payload.room;
    if (!independent) record({independent});
    else {
    await carrierReady(before.payload.room);
    const phone = await connect(trusted, before.payload.room, "IK");
    const firstPaired = await probe(phone);
    const firstConsumed = await read(first) === null;
    const otherSurvivesTrustedAdmission = Boolean(await read(second)) && windowVisible;
    // QR scan by an already-trusted key consumes only the QR window.
    const qrPhone = await connect(trusted, qr.payload.room, "XX");
    const qrPaired = await probe(qrPhone);
    const secondSurvivesQR = Boolean(await read(second)) && !windowVisible;
    // Any actual new grant invalidates other windows' authority baselines.
    const third = await knock(); await approve(third);
    const invite = payload(await poll(second)); assert(invite);
    await carrierReady(invite.room);
    const secondPhone = await connect(intended, invite.room, "XX");
    const secondPaired = await probe(secondPhone);
    record({independent, firstConsumed, firstPaired, otherSurvivesTrustedAdmission, qrPaired, secondSurvivesQR,
      secondPaired, authorityCancelsThird: await read(third) === null});
    }
  } else if (scenario === "A-DELIVERY") {
    const qr = await openWindow();
    const denied = await knock(); await approve(denied); await approve(denied, "deny");
    const deniedPoll = await poll(denied);
    const expired = await knock(); await approve(expired); clock += 2001;
    const expiredPoll = await poll(expired);
    const pending = await knock(); const pendingPoll = await poll(pending);
    const live = await knock(); await approve(live); const livePoll = await poll(live);
    const replay = await poll(live);
    record({deniedClosed: await read(denied) === null, requestNotQR: payload(livePoll)?.room !== qr.payload.room,
      denied: deniedPoll.status, deniedLocation: deniedPoll.headers.get("location"),
      expired: expiredPoll.status, expiredLocation: expiredPoll.headers.get("location"),
      pending: pendingPoll.status, pendingLocation: pendingPoll.headers.get("location"),
      live: livePoll.status, replay: replay.status, replayLocation: replay.headers.get("location")});
  } else if (scenario === "A-STARTUP-AUTHORITY") {
    grantTrusted(); const request = await knock(trustedKey);
    let release!: () => void, entered = false;
    beforeApprovalOpen = () => new Promise<void>(done => {release = done; entered = true;});
    const approving = approve(request);
    await waitFor(() => entered, "approval startup blocked");
    owner.mutate(owner.read().revision, crypto.randomUUID(), {type: "revoke", publicKey: trustedKey});
    beforeApprovalOpen = undefined; release();
    const approvalStatus = (await approving).status;
    const invitation = payload(await poll(request));
    let regranted = false;
    if (invitation) {
      await carrierReady(invitation.room);
      regranted = await probe(await connect(trusted, invitation.room, "IK"));
    }
    record({approvalStatus, noPayload: invitation === null, regranted,
      trusted: owner.read().peers.some(peer => peer.publicKey === trustedKey)});
  } else if (scenario === "A-RACE") {
    const request = await knock(); let release!: () => void, entered = false;
    beforeApprovalOpen = () => new Promise<void>(done => {release = done; entered = true;});
    const approving = approve(request);
    await waitFor(() => entered, "approval startup blocked");
    const denialStatus = (await approve(request, "deny")).status;
    beforeApprovalOpen = undefined; release();
    const lateApprovalStatus = (await approving).status;
    record({denialStatus, lateApprovalStatus, closed: await read(request) === null, poll: (await poll(request)).status});
  } else if (scenario === "A-RETRY") {
    const request = await knock(); await approve(request); const first = await read(request); assert(first);
    await approve(request); const second = await read(request); assert(second);
    await requestLocalApprovalPairingOpportunity(bridgePort, "cancel", {requestId: request.token});
    const reopenStatus = (await approve(request)).status;
    // Deliver the bounded-lifetime cleanup callback without a five-minute wait.
    for (const expire of expiryCallbacks.splice(0)) expire();
    const afterCleanupStatus = (await approve(request)).status;
    record({afterCleanupStatus, sameRoom: first.payload.room === second.payload.room, sameId: first.windowId === second.windowId,
      sameDeadline: first.payload.expiresAt === second.payload.expiresAt, reopenStatus, cancelled: await read(request) === null});
  } else if (scenario === "A-LOCAL-AUTH") {
    grantTrusted();
    const request = await knock(); await approve(request); const invitation = await read(request); assert(invitation);
    const phone = await connect(trusted, "", "XX", true);
    assert(phone.state.ready, "fixture: trusted direct phone ready");
    phone.transport.send(JSON.stringify({id: "forged", method: "pairing/opportunity",
      params: {action: "request-read", binding: {requestId: request.token}}}));
    await observeUntil(() => phone.data.some(text => JSON.parse(text).id === "forged"), 750);
    const response = phone.data.map(text => JSON.parse(text)).find(value => value.id === "forged");
    record({errorCode: response?.error?.code ?? null,
      noRoom: !JSON.stringify(response).includes(invitation.payload.room), remainsOpen: Boolean(await read(request))});
  } else if (scenario === "A-HEADER") {
    const key = bytesToHex(intended.publicKey);
    const request = await knock(key.toUpperCase());
    const bad = await app.request("http://localhost/pair", {headers: {...headers, "x-scout-device-public-key": key.slice(0,16)}});
    await approve(request);
    peerAddress = request.requesterIp;
    const repeat = await app.request("http://localhost/pair", {headers: {...headers, "x-scout-device-public-key": key}});
    const repeatBody = await repeat.json() as any;
    record({normalized: request.requesterPublicKey === key, prefixStatus: bad.status,
      notRedisclosed: repeatBody.token !== request.token});
  } else if (scenario === "A-SPENT-POLL") {
    const statuses: number[] = [];
    let spent = true, noTouch = true, noLocation = true, expiredBodies = true;
    let lastRequest: any;
    // Each request is still approved in the HTTP store and has not fetched its
    // room. Only the runtime can distinguish spent from temporarily absent.
    for (const reason of ["cancel", "consumed", "authority", "expiry", "cleanup"]) {
      const request = await knock(); lastRequest = request;
      assert.equal((await approve(request)).status, 200, "fixture: approved live window");
      const invitation = await read(request); assert(invitation, "fixture: real window before spending");
      if (reason === "cancel") await requestLocalApprovalPairingOpportunity(bridgePort, "cancel", {requestId: request.token});
      if (reason === "consumed") {
        await carrierReady(invitation.payload.room);
        assert(await probe(await connect(intended, invitation.payload.room, "XX")), "fixture: admission consumes window");
      }
      if (reason === "authority") grantTrusted();
      if (reason === "cleanup") for (const expire of expiryCallbacks.splice(0)) expire();
      const originalNow = Date.now;
      if (reason === "expiry") Date.now = () => originalNow() + 300001;
      try {
        const expiresAt = store.get(request.token)!.expiresAt; clock += 1500;
        const response = await poll(request); statuses.push(response.status);
        const body = await response.json() as any;
        expiredBodies &&= body.status === "expired" && body.token === request.token;
        noTouch &&= store.get(request.token)!.expiresAt === expiresAt;
        noLocation &&= response.headers.get("location") === null;
        const result = await readResult(request);
        spent &&= Boolean(result && "status" in result && result.status === "spent");
      } finally { Date.now = originalNow; }
    }
    const text = await app.request(`http://localhost/pair?token=${lastRequest.token}`, {redirect: "manual"});
    const textStatus = text.status, textExpired = (await text.text()) === "Pairing request expired.";
    // An absent window is not known spent. Do not turn startup/unavailability
    // into a terminal response or reconstruct an invitation from approval.
    const unknown = await knock(); store.decide(unknown.token, "approve");
    const unknownStatus = (await poll(unknown)).status;
    await runtime.stop();
    runtime = await startPairingRuntime(runtimeOptions);
    const afterRestart = await poll(lastRequest);
    record({statuses, spent, noTouch, noLocation, expiredBodies, textStatus, textExpired, unknownStatus,
      restartStatus: afterRestart.status, restartNoRoom: afterRestart.headers.get("location") === null && await read(lastRequest) === null});
  } else if (scenario === "A-CANCEL-FIRST") {
    const binding = {requestId: crypto.randomUUID(), publicKey: bytesToHex(intended.publicKey)};
    const revision = owner.read().revision;
    await requestLocalApprovalPairingOpportunity(bridgePort, "cancel", binding);
    // Use the runtime control directly, without the HTTP route denial recheck.
    const result = await requestLocalApprovalPairingOpportunity(bridgePort, "open", binding);
    record({opened: Boolean(result && "payload" in result), noGrant: owner.read().revision === revision});
  } else if (scenario === "A-EXPIRY") {
    const request = await knock(); await approve(request); const invitation = await read(request); assert(invitation);
    const original = Date.now; Date.now = () => original() + 300001;
    try { record({expired: await read(request) === null}); } finally { Date.now = original; }
  } else throw Error("fixture: unknown approval scenario");
} finally {
  store.dispose();
  for (const socket of sockets) socket.close();
  await runtime.stop(); relay.stop();
}
process.exit(0);
