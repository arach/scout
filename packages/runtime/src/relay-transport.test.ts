import { afterEach, expect, test } from "bun:test";
import { createServer } from "node:net";

import { startRelay, type RelayTransportOptions as RelayOptions } from "./relay-transport.js";

const activeRelays: Array<{ stop: () => void }> = [];
const activeSockets: WebSocket[] = [];

interface RelayEnvelope {
  phase: "relay";
  event: "message" | "close";
  clientId: string;
  payload?: string;
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to allocate a free port."));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
    server.once("error", reject);
  });
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for websocket open."));
    }, 5_000);

    const handleOpen = () => {
      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      reject(new Error("WebSocket failed before open."));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("error", handleError);
    };

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("error", handleError);
  });
}

function waitForMessage<T = string>(
  socket: WebSocket,
  decode: (event: MessageEvent) => T = (event) => (typeof event.data === "string" ? event.data : String(event.data)) as T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for websocket message."));
    }, 5_000);

    const handleMessage = (event: MessageEvent) => {
      cleanup();
      resolve(decode(event));
    };

    const handleClose = () => {
      cleanup();
      reject(new Error("WebSocket closed before message arrived."));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener("message", handleMessage);
      socket.removeEventListener("close", handleClose);
    };

    socket.addEventListener("message", handleMessage);
    socket.addEventListener("close", handleClose);
  });
}

function waitForNoMessage(socket: WebSocket, durationMs = 250): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleMessage = () => {
      cleanup();
      reject(new Error("Unexpected websocket message."));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener("message", handleMessage);
    };

    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, durationMs);

    socket.addEventListener("message", handleMessage);
  });
}

afterEach(() => {
  while (activeSockets.length > 0) {
    const socket = activeSockets.pop();
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      socket.close();
    }
  }

  while (activeRelays.length > 0) {
    activeRelays.pop()?.stop();
  }
});

test("relay routes distinct client envelopes to and from the bridge", async () => {
  const port = await getFreePort();
  const relay = startRelay(port, {} satisfies RelayOptions);
  activeRelays.push(relay);

  const room = `room-${Date.now()}`;
  const bridge = new WebSocket(`ws://127.0.0.1:${port}?room=${room}&role=bridge&key=bridge-key`);
  const clientA = new WebSocket(`ws://127.0.0.1:${port}?room=${room}&role=client`);
  const clientB = new WebSocket(`ws://127.0.0.1:${port}?room=${room}&role=client`);
  activeSockets.push(bridge, clientA, clientB);

  await Promise.all([waitForOpen(bridge), waitForOpen(clientA), waitForOpen(clientB)]);

  const envelopeA = waitForMessage<RelayEnvelope>(bridge, (event) => JSON.parse(String(event.data)));
  clientA.send("from-a");
  const receivedA = await envelopeA;
  expect(receivedA.phase).toBe("relay");
  expect(receivedA.event).toBe("message");
  expect(receivedA.payload).toBe("from-a");

  const envelopeB = waitForMessage<RelayEnvelope>(bridge, (event) => JSON.parse(String(event.data)));
  clientB.send("from-b");
  const receivedB = await envelopeB;
  expect(receivedB.phase).toBe("relay");
  expect(receivedB.event).toBe("message");
  expect(receivedB.payload).toBe("from-b");
  expect(receivedB.clientId).not.toBe(receivedA.clientId);

  const clientAMessage = waitForMessage(clientA);
  const clientBQuiet = waitForNoMessage(clientB);
  bridge.send(JSON.stringify({
    phase: "relay",
    event: "message",
    clientId: receivedA.clientId,
    payload: "to-a",
  } satisfies RelayEnvelope));
  expect(await clientAMessage).toBe("to-a");
  await clientBQuiet;

  const clientBMessage = waitForMessage(clientB);
  const clientAQuiet = waitForNoMessage(clientA);
  bridge.send(JSON.stringify({
    phase: "relay",
    event: "message",
    clientId: receivedB.clientId,
    payload: "to-b",
  } satisfies RelayEnvelope));
  expect(await clientBMessage).toBe("to-b");
  await clientAQuiet;
});

function closed(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Timed out waiting for close")), 5_000);
    socket.addEventListener("close", event => { clearTimeout(timer); resolve({ code: event.code, reason: event.reason }); }, { once: true });
  });
}
async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw Error("Timed out waiting for relay close callback");
    await Bun.sleep(1);
  }
}
async function connect(port: number, room: string, role: string, key = "key"): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?room=${room}&role=${role}&key=${key}`);
  activeSockets.push(socket); await waitForOpen(socket); return socket;
}
function messages(socket: WebSocket, count: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const result: string[] = [];
    const timer = setTimeout(() => { socket.removeEventListener("message", listener); reject(Error("Missing ordered messages")); }, 5_000);
    const listener = (event: MessageEvent) => {
      result.push(String(event.data));
      if (result.length === count) { clearTimeout(timer); socket.removeEventListener("message", listener); resolve(result); }
    };
    socket.addEventListener("message", listener);
  });
}

test("public transport has no web target or outbound HTTP by default; discovery is routing metadata", async () => {
  const port = await getFreePort(); activeRelays.push(startRelay(port));
  const http = globalThis.fetch; let outbound = 0;
  globalThis.fetch = (async () => { outbound++; throw Error("No implicit proxy allowed"); }) as unknown as typeof fetch;
  try {
    const response = await http(`http://127.0.0.1:${port}/pair`);
    expect(response.status).toBe(400); expect(outbound).toBe(0);
    expect((await http(`http://127.0.0.1:${port}/?role=other&room=a`)).status).toBe(400);
    const health = await (await http(`http://127.0.0.1:${port}/healthz?bridgePublicKey=unknown`)).json();
    expect(health).toMatchObject({ ok: true, bridgeConnected: false, roomId: null, bridgePublicKey: "unknown" });
    const resolve = (body: string) => http(`http://127.0.0.1:${port}/resolve`, { method: "POST", body });
    expect((await resolve("not-json")).status).toBe(400);
    expect((await resolve("{}")).status).toBe(400);
    expect((await resolve('{"bridgePublicKey":"unknown"}')).status).toBe(404);
    expect(outbound).toBe(0);
  } finally { globalThis.fetch = http; }
});

test("ordered client frames keep the legacy UTF-8 binary conversion; bridge binary/malformed envelopes are ignored", async () => {
  const port = await getFreePort(); activeRelays.push(startRelay(port));
  const bridge = await connect(port, "order", "bridge"), client = await connect(port, "order", "client");
  const incoming = messages(bridge, 3);
  client.send("one"); client.send(new TextEncoder().encode("two")); client.send("three");
  const frames = (await incoming).map(v => JSON.parse(v) as RelayEnvelope);
  expect(frames.map(v => v.payload)).toEqual(["one", "two", "three"]);
  expect(new Set(frames.map(v => v.clientId)).size).toBe(1);
  const quiet = waitForNoMessage(client, 40);
  bridge.send("not-json"); bridge.send(JSON.stringify({ phase: "other", event: "message", clientId: frames[0]!.clientId, payload: "ignored" }));
  bridge.send(new TextEncoder().encode(JSON.stringify({ ...frames[0], payload: "binary ignored" })));
  bridge.send(JSON.stringify({ ...frames[0], payload: "" }));
  await quiet;
  const replies = messages(client, 3);
  for (const payload of ["reply-one", "reply-two", "reply-three"]) bridge.send(JSON.stringify({ ...frames[0], payload }));
  expect(await replies).toEqual(["reply-one", "reply-two", "reply-three"]);
});

test("rooms isolate delivery and client-close notifications preserve per-connection IDs", async () => {
  const port = await getFreePort(); activeRelays.push(startRelay(port));
  const bridge = await connect(port, "first", "bridge"), client = await connect(port, "first", "client");
  const otherBridge = await connect(port, "second", "bridge"), otherClient = await connect(port, "second", "client");
  const received = waitForMessage<RelayEnvelope>(bridge, e => JSON.parse(String(e.data)));
  const otherQuiet = waitForNoMessage(otherBridge, 40); client.send("first-room");
  const envelope = await received; await otherQuiet;
  const notified = waitForMessage<RelayEnvelope>(bridge, e => JSON.parse(String(e.data)));
  const end = closed(client); const otherClientQuiet = waitForNoMessage(otherClient, 40);
  bridge.send(JSON.stringify({ phase: "relay", event: "close", clientId: envelope.clientId, code: 4009, reason: "fixture close" }));
  expect(await end).toMatchObject({ code: 4009, reason: "fixture close" });
  expect(await notified).toEqual({ phase: "relay", event: "close", clientId: envelope.clientId });
  await otherClientQuiet;
});

test("replacement closes only the old bridge with 4001 and keeps the new bridge discoverable", async () => {
  const port = await getFreePort(); activeRelays.push(startRelay(port));
  const old = await connect(port, "replace", "bridge", "old-key"); const end = closed(old);
  const current = await connect(port, "replace", "bridge", "new-key");
  expect(await end).toMatchObject({ code: 4001, reason: "Replaced by new bridge" });
  const response = await fetch(`http://127.0.0.1:${port}/resolve`, { method: "POST", body: JSON.stringify({ bridgePublicKey: "new-key" }) });
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ room: "replace" });
  const health = await (await fetch(`http://127.0.0.1:${port}/healthz?bridgePublicKey=new-key`)).json();
  expect(health).toMatchObject({ bridgeConnected: true, roomId: "replace" });
  const client = await connect(port, "replace", "client"); const incoming = waitForMessage<RelayEnvelope>(current, e => JSON.parse(String(e.data)));
  client.send("new-owner"); expect((await incoming).payload).toBe("new-owner");
});

test("bridge reconnect cancels the 30s grace; expiry keeps 4004 and empty client rooms keep 60s idle cleanup", async () => {
  const timers: Array<{ delay: number; timer: ReturnType<typeof setTimeout>; run: () => void; cancelled: boolean }> = [];
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  globalThis.setTimeout = ((handler: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    const timer = realSet(handler, delay, ...args);
    if (delay === 30_000 || delay === 60_000) timers.push({ delay, timer, run: () => handler(...args), cancelled: false });
    return timer;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
    for (const entry of timers) if (entry.timer === timer) entry.cancelled = true;
    realClear(timer);
  }) as typeof clearTimeout;
  try {
    const port = await getFreePort(); activeRelays.push(startRelay(port));
    const bridge = await connect(port, "grace", "bridge"), client = await connect(port, "grace", "client");
    const left = closed(bridge); bridge.close(); await left;
    await waitUntil(() => timers.some(v => v.delay === 30_000));
    const first = timers.find(v => v.delay === 30_000); expect(first).toBeDefined();
    const reconnected = await connect(port, "grace", "bridge"); expect(first!.cancelled).toBe(true); expect(client.readyState).toBe(WebSocket.OPEN);
    const leftAgain = closed(reconnected); reconnected.close(); await leftAgain;
    await waitUntil(() => timers.filter(v => v.delay === 30_000).length === 2);
    const grace = timers.filter(v => v.delay === 30_000).at(-1)!; expect(grace.cancelled).toBe(false);
    const absent = closed(client); realClear(grace.timer); grace.run();
    expect(await absent).toMatchObject({ code: 4004, reason: "Bridge absent" });
    const idle = await connect(port, "idle", "client"); const idleClose = closed(idle); idle.close(); await idleClose;
    await waitUntil(() => timers.some(v => v.delay === 60_000));
    const cleanup = timers.find(v => v.delay === 60_000); expect(cleanup).toBeDefined(); realClear(cleanup!.timer); cleanup!.run();
  } finally {
    for (const entry of timers) realClear(entry.timer);
    globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear;
  }
});

test("shutdown preserves the observed Bun close code and reason for bridge and clients", async () => {
  const port = await getFreePort(); const relay = startRelay(port); activeRelays.push(relay);
  const bridge = await connect(port, "stop", "bridge"), client = await connect(port, "stop", "client");
  const endBridge = closed(bridge), endClient = closed(client); relay.stop();
  // Both unmodified relays request 1001 then immediately call server.stop().
  // Bun 1.3.13/1.3.14 expose 1000 on the wire in that sequence. Preserve it;
  // do not change shutdown scheduling or replace baseline behavior in this move.
  expect(await endBridge).toEqual({ code: 1000, reason: "Relay shutting down" });
  expect(await endClient).toEqual({ code: 1000, reason: "Relay shutting down" });
});

test("trusted HTTP composition is explicit and undefined delegates to the unchanged relay routes", async () => {
  const port = await getFreePort(); activeRelays.push(startRelay(port, {
    httpHandler(request, context) {
      if (new URL(request.url).pathname !== "/custom") return undefined;
      expect(context.clientAddress).toBe("127.0.0.1"); return new Response("composed", { status: 201 });
    },
  }));
  const custom = await fetch(`http://127.0.0.1:${port}/custom`); expect(custom.status).toBe(201); expect(await custom.text()).toBe("composed");
  expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
});
