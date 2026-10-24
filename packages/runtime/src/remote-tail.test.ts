import { afterEach, test } from "bun:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createTCPServer } from "node:net";
import { WebSocketServer, WebSocket } from "ws";
import { initTRPC, tracked, TRPCError } from "@trpc/server";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { z } from "zod";
import { boundedEventIterable, StreamResyncRequired } from "./bounded-event-iterable.js";
import { subscribeRemoteTail, RemoteTailError, type RemoteTailItem, type RemoteTailOptions } from "./remote-tail.js";
import type { TailEvent } from "./tail/types.js";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean) {
  const end = performance.now() + 3_000;
  while (!predicate()) { if (performance.now() > end) throw Error("Fixture deadline"); await sleep(2); }
}
async function deadline<T>(promise: PromiseLike<T>, ms = 3_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("Read deadline")), ms); })]); }
  finally { clearTimeout(timer!); }
}
function event(id: string, source = "claude", summary = id): TailEvent {
  return { id, source, summary, ts: 1, sessionId: "fixture", pid: 1, parentPid: null, project: "fixture", cwd: "/fixture", harness: "claude", kind: "assistant" };
}

type FixtureOptions = {
  backlog?: TailEvent[];
  port?: number;
  status?: number;
  mutate?: (frame: any) => any;
  dropStarted?: boolean;
  flap?: boolean;
  fail?: boolean | "auth";
  binary?: boolean;
};
async function fixture(options: FixtureOptions = {}) {
  const backlog = options.backlog ?? [];
  const listeners = new Set<(value: TailEvent) => void>();
  const inputs: Array<{ since?: string; sources?: string[] } | undefined> = [];
  const requests: any[] = [];
  let connections = 0, live = 0;
  const t = initTRPC.create();
  // Same input and replay algorithm as broker-trpc-router tail.events; the
  // installed real server adapter supplies all tracked framing and lifetimes.
  // The injected source never imports/starts the local watcher.
  const router = t.router({ tail: t.router({ events: t.procedure
    .input(z.object({ since: z.string().optional(), sources: z.array(z.string()).optional() }).optional())
    .subscription(async function* ({ input, signal }) {
      inputs.push(input);
      if (options.fail === "auth") throw new TRPCError({ code: "UNAUTHORIZED", message: "do-not-echo-auth-detail" });
      if (options.fail) throw new StreamResyncRequired("not-a-client-cursor");
      const filter = input?.sources?.length ? new Set(input.sources) : null;
      const history = backlog.slice(-500);
      const found = input?.since ? history.findIndex(e => e.id === input.since) : -1;
      for (let i = found >= 0 ? found + 1 : 0; i < history.length; i++) {
        const e = history[i]!; if (!filter || filter.has(e.source)) yield tracked(e.id, e);
      }
      live++;
      try {
        for await (const e of boundedEventIterable<TailEvent>({
          subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
          accepts: e => !filter || filter.has(e.source), id: e => e.id, signal,
        })) yield tracked(e.id, e);
      } finally { live--; }
    }) }) });
  const server = createServer();
  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", socket => {
    connections++;
    const send = socket.send.bind(socket);
    socket.send = ((raw: any, ...args: any[]) => {
      if (String(raw) === "PING" || String(raw) === "PONG") return (send as any)(raw, ...args);
      const frame = JSON.parse(String(raw));
      if (options.dropStarted && frame.result?.type === "started") return;
      const changed = options.mutate ? options.mutate(frame) : frame;
      if (changed === "__invalid_json__") return (send as any)("{", ...args);
      const text = JSON.stringify(changed);
      return (send as any)(options.binary && frame.result?.type === "data" ? Buffer.from(text) : text, ...args);
    }) as typeof socket.send;
    socket.on("message", bytes => {
      if (String(bytes) === "PONG") { requests.push("PONG"); return; }
      const message = JSON.parse(String(bytes));
      for (const item of Array.isArray(message) ? message : [message]) requests.push(item);
    });
    if (options.flap) setTimeout(() => socket.terminate(), 10);
  });
  const handler = applyWSSHandler({ wss, router, createContext: () => ({}) });
  server.on("upgrade", (req, socket, head) => {
    if (options.status) { connections++; socket.end(`HTTP/1.1 ${options.status} Fixture\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); return; }
    assert.equal(req.url, "/trpc");
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers.cookie, undefined);
    wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
  });
  await new Promise<void>(resolve => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  let closed = false;
  const close = async () => {
    if (closed) return; closed = true;
    for (const socket of wss.clients) socket.terminate();
    // Close the ws mount first. Bun's shim owns an upgrade server and does
    // not invoke the optional ws close callback.
    wss.close();
    server.closeAllConnections();
    await deadline(new Promise<void>(resolve => server.close(() => resolve())));
    await until(() => live === 0 && listeners.size === 0 && wss.clients.size === 0);
  };
  cleanups.push(close);
  return { url: `http://127.0.0.1:${address.port}`, backlog, inputs, requests, wss, handler,
    connections: () => connections, live: () => live, close,
    publish(e: TailEvent) { backlog.push(e); for (const listener of listeners) listener(e); },
  };
}
function subscription(url: string, extra: Partial<RemoteTailOptions> = {}) {
  const controller = new AbortController();
  const stream = subscribeRemoteTail({ brokerUrl: url, ingress: { kind: "trusted-loopback" }, signal: controller.signal,
    reconnect: { maxAttempts: 3, maxElapsedMs: 2_000 }, ...extra });
  const iterator = stream[Symbol.asyncIterator]();
  cleanups.push(async () => { controller.abort(); await iterator.return?.(); });
  return { stream, iterator, controller };
}
async function nextEvent(iterator: AsyncIterator<RemoteTailItem>, notices: RemoteTailItem[] = []) {
  for (;;) {
    const item = await deadline(iterator.next()); assert(!item.done);
    if (item.value.type === "event") return item.value;
    notices.push(item.value);
  }
}
async function terminal(iterator: AsyncIterator<RemoteTailItem>): Promise<RemoteTailError> {
  try { for (;;) { const result = await deadline(iterator.next()); if (result.done) throw Error("Unexpected clean end"); } }
  catch (error) { assert(error instanceof RemoteTailError); return error; }
}

for (const spec of [
  { size: 0 }, { size: 3 }, { size: 500 }, { size: 501 },
  { size: 3, since: "e0" }, { size: 3, since: "e2" },
  { size: 501, since: "e0" }, { size: 3, since: "unknown" },
  { size: 3, since: "" }, { size: 3, sources: [] },
  { size: 6, since: "e1", sources: ["claude"] },
  { size: 3, sources: ["unknown-source"] },
]) {
  test(`replay parity ${JSON.stringify(spec)}`, async () => {
    const history = Array.from({ length: spec.size }, (_, i) => event(`e${i}`, i % 2 ? "codex" : "claude"));
    const f = await fixture({ backlog: history });
    const { iterator } = subscription(f.url, { since: spec.since, sources: spec.sources });
    const window = history.slice(-500), index = spec.since ? window.findIndex(e => e.id === spec.since) : -1;
    const expected = window.slice(index >= 0 ? index + 1 : 0).filter(e => !spec.sources?.length || spec.sources.includes(e.source));
    const notices: RemoteTailItem[] = [], got: TailEvent[] = [];
    // Consume concurrently with replay so the independent client bound is not
    // mistaken for the server's 500-event replay cap.
    for (const e of expected) got.push((await nextEvent(iterator, notices)).event);
    if (!expected.length) { await deadline(iterator.next()); }
    await until(() => f.live() > 0);
    f.publish(event("marker", spec.sources?.[0] ?? "claude"));
    assert.equal((await nextEvent(iterator, notices)).id, "marker");
    assert.deepEqual(got, expected);
    assert(notices.some(n => n.type === "continuity" && n.state === "unverified"));
  });
}

test("reconnect drains queued frames and sends last delivered since, never lastEventId", async () => {
  const f = await fixture({ backlog: [event("a"), event("b")] });
  const { iterator } = subscription(f.url, { since: "seed", sources: ["claude"] });
  const notices: RemoteTailItem[] = [];
  assert.equal((await nextEvent(iterator, notices)).id, "a");
  await until(() => f.live() === 1);
  // A PONG proves the preceding b frame reached the client's receive path,
  // without yielding b and incorrectly advancing its resume cursor.
  for (const socket of f.wss.clients) socket.send("PING");
  await until(() => f.requests.includes("PONG"));
  f.backlog.push(event("c"));
  for (const socket of f.wss.clients) socket.terminate();
  await until(() => f.wss.clients.size === 0);
  assert.equal((await nextEvent(iterator, notices)).id, "b");
  const c = await nextEvent(iterator, notices); assert.equal(c.id, "c"); assert.equal(c.generation, 2);
  assert.deepEqual(f.inputs, [{ since: "seed", sources: ["claude"] }, { since: "b", sources: ["claude"] }]);
  assert(f.requests.filter(r => r.method === "subscription").every(r => !("lastEventId" in r.params)));
  assert(notices.some(n => n.type === "continuity" && n.generation === 2 && n.after === "b"));
});

test("reconnect notice, PING/PONG and expired-window replay stay explicit", async () => {
  const f = await fixture({ backlog: [event("old")] });
  const { iterator } = subscription(f.url); const notices: RemoteTailItem[] = [];
  await nextEvent(iterator, notices);
  for (const socket of f.wss.clients) socket.send("PING");
  await until(() => f.requests.includes("PONG"));
  f.backlog.splice(0, f.backlog.length, event("different-epoch"));
  f.handler.broadcastReconnectNotification();
  assert.equal((await nextEvent(iterator, notices)).id, "different-epoch");
  assert.equal(f.inputs[1]?.since, "old");
  assert(notices.some(n => n.type === "continuity" && n.generation === 2 && n.state === "unverified"));
});

for (const kind of ["result-id", "envelope-id", "event-id", "missing-id", "bad-source", "unknown-request", "unknown-method", "not-json", "data-before-started"] as const) {
  test(`tracked framing refuses ${kind} without advancing`, async () => {
    const f = await fixture({ backlog: [event("one")], dropStarted: kind === "data-before-started", mutate(frame) {
      if (frame.result?.type !== "data") return frame;
      if (kind === "result-id") frame.result.id = "wrong";
      if (kind === "envelope-id") frame.result.data.id = "wrong";
      if (kind === "event-id") frame.result.data.data.id = "wrong";
      if (kind === "missing-id") delete frame.result.id;
      if (kind === "bad-source") frame.result.data.data.source = null;
      if (kind === "unknown-request") frame.id = 2;
      if (kind === "unknown-method") frame.method = "unexpected";
      if (kind === "not-json") return "__invalid_json__";
      return frame;
    } });
    const { iterator } = subscription(f.url);
    const error = await terminal(iterator);
    assert.equal(error.name, "RemoteTailError"); assert.equal(error.reason, "protocol_error");
    assert.equal(error.lastDeliveredId, null); assert.equal(error.generation, 1); assert.equal(error.resyncRequired, true);
  });
}

test("server resync errors use the stable sanitized terminal shape, not message parsing", async () => {
  const f = await fixture({ fail: true }); const { iterator } = subscription(f.url);
  const error = await terminal(iterator);
  assert.deepEqual({ name: error.name, reason: error.reason, lastDeliveredId: error.lastDeliveredId, generation: error.generation, resyncRequired: error.resyncRequired },
    { name: "RemoteTailError", reason: "server_error", lastDeliveredId: null, generation: 1, resyncRequired: true });
  assert(!error.message.includes("not-a-client-cursor")); assert.equal(f.connections(), 1);
});

for (const spec of [{ name: "count", history: Array.from({ length: 257 }, (_, i) => event(String(i))) },
  { name: "bytes", history: Array.from({ length: 9 }, (_, i) => event(String(i), "claude", "x".repeat(128 * 1024))) },
  { name: "single message", history: [event("large", "claude", "x".repeat(2 * 1024 * 1024))] }]) {
  test(`backpressure ${spec.name} is terminal and does not advance queued-only IDs`, async () => {
    const f = await fixture({ backlog: spec.history }); const { iterator } = subscription(f.url);
    await iterator.next(); await until(() => f.connections() === 1 && f.wss.clients.size === 0);
    const error = await terminal(iterator);
    assert.equal(error.reason, "consumer_lag"); assert.equal(error.lastDeliveredId, null); assert.equal(error.resyncRequired, true);
  });
}

test("oldest queued age expires without another incoming frame", async () => {
  const realSet = globalThis.setTimeout;
  let expire: (() => void) | undefined;
  globalThis.setTimeout = ((handler: (...args: any[]) => void, delay?: number, ...args: any[]) => {
    if (delay === 30_000 && !expire) expire = () => handler(...args);
    return realSet(handler, delay, ...args);
  }) as typeof setTimeout;
  try {
    const f = await fixture({ backlog: [event("queued")] }); const { iterator } = subscription(f.url);
    await iterator.next(); await until(() => !!expire); expire!();
    const error = await terminal(iterator); assert.equal(error.reason, "consumer_lag"); assert.equal(error.lastDeliveredId, null);
  } finally { globalThis.setTimeout = realSet; }
});

test("drain time counts against reconnect deadline and error preserves the yielded cursor", async () => {
  const f = await fixture({ backlog: [event("a"), event("b")] });
  const { iterator } = subscription(f.url, { reconnect: { maxAttempts: 5, maxElapsedMs: 70 } });
  await nextEvent(iterator); await until(() => f.live() === 1);
  for (const socket of f.wss.clients) socket.send("PING");
  await until(() => f.requests.includes("PONG"));
  for (const socket of f.wss.clients) socket.terminate();
  await sleep(110);
  const error = await terminal(iterator); assert.equal(error.reason, "retry_exhausted"); assert.equal(error.lastDeliveredId, "a");
  assert.equal(f.connections(), 1);
});

test("refused connection retries within budget and succeeds when the listener returns", async () => {
  const reservation = await fixture();
  const url = reservation.url, port = Number(new URL(url).port);
  await reservation.close();
  const { iterator } = subscription(url, { reconnect: { maxAttempts: 4, maxElapsedMs: 5_000 } });
  // Observe the second physical attempt, then restore during its backoff. The
  // initial two WS attempts see a genuinely closed port, not a rejected HTTP response.
  for (;;) {
    const item = await deadline(iterator.next()); assert(!item.done);
    if (item.value.type === "connection" && item.value.generation === 2) break;
  }
  const restore = async () => {
    await sleep(200);
    return fixture({ port, backlog: [event("restored")] });
  };
  const [item, f] = await Promise.all([nextEvent(iterator), restore()]);
  assert.equal(item.id, "restored"); assert.equal(item.generation, 3);
  assert.equal(f.connections(), 1);
});

test("live listener rejecting the upgrade is terminal with no second attempt", async () => {
  const peers: Array<{ bytes: number; closed: boolean }> = [];
  const server = createTCPServer(socket => {
    const peer = { bytes: 0, closed: false }; peers.push(peer);
    socket.on("data", data => {
      peer.bytes += data.length;
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    });
    socket.on("close", () => { peer.closed = true; });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert(address && typeof address !== "string");
  const { iterator } = subscription(`http://127.0.0.1:${address.port}`, { reconnect: { maxAttempts: 3, maxElapsedMs: 1_000 } });
  const error = await terminal(iterator);
  assert.equal(error.reason, "auth_denied");
  assert.equal(error.generation, 1); assert.equal(error.lastDeliveredId, null);
  assert.equal(error.resyncRequired, false);
  await until(() => peers.every(peer => peer.closed));
  await sleep(30);
  assert.equal(peers.length, 1);
  assert(peers[0]!.bytes > 0); // Exactly one actual upgrade request.
});

for (const status of [401, 403, 302, 503]) {
  test(`upgrade ${status} never follows or downgrades`, async () => {
    const f = await fixture({ status }); const { iterator } = subscription(f.url, { reconnect: { maxAttempts: 2, maxElapsedMs: 400 } });
    const error = await terminal(iterator);
    assert.equal(error.reason, status === 401 || status === 403 ? "auth_denied" : status === 503 ? "retry_exhausted" : "server_error");
    assert.equal(f.connections(), status === 503 ? 2 : 1);
  });
}

test("socket opens without started cannot reset an outage episode", async () => {
  const f = await fixture({ dropStarted: true, flap: true }); const { iterator } = subscription(f.url, { reconnect: { maxAttempts: 2, maxElapsedMs: 500 } });
  const error = await terminal(iterator); assert.equal(error.reason, "retry_exhausted"); assert.equal(error.generation, 2); assert.equal(f.connections(), 2);
});

test("one iterator, lazy start, pre-abort and return before first read open no socket", async () => {
  const f = await fixture(); const sub = subscription(f.url);
  assert.throws(() => sub.stream[Symbol.asyncIterator](), RemoteTailError); assert.equal(f.connections(), 0);
  await sub.iterator.return?.(); assert.equal((await sub.iterator.next()).done, true); assert.equal(f.connections(), 0);
  const controller = new AbortController(); controller.abort();
  const aborted = subscription(f.url, { signal: controller.signal }); assert.equal((await aborted.iterator.next()).done, true); assert.equal(f.connections(), 0);
});

test("abort pending reads, iterator return and consumer exceptions clean up without reconnect", async () => {
  for (const mode of ["abort", "return", "throw"]) {
    const f = await fixture(); const { iterator, controller } = subscription(f.url);
    // Read connected/continuity, then leave a pending next().
    for (;;) { const item = await iterator.next(); if (!item.done && item.value.type === "continuity") break; }
    const pending = iterator.next();
    if (mode === "abort") controller.abort();
    else if (mode === "return") await iterator.return?.();
    else await assert.rejects(iterator.throw!(Error("consumer failure")), /consumer failure/);
    assert.equal((await deadline(pending)).done, true);
    await until(() => f.wss.clients.size === 0 && f.live() === 0);
    await sleep(15); assert.equal(f.connections(), 1);
  }
});

test("abort during retry cancels every future attempt", async () => {
  const f = await fixture({ dropStarted: true, flap: true }); const { iterator, controller } = subscription(f.url, { reconnect: { maxAttempts: 8, maxElapsedMs: 5_000 } });
  await iterator.next(); await until(() => f.connections() === 2); controller.abort();
  assert.equal((await iterator.next()).done, true); await sleep(25); assert.equal(f.connections(), 2);
});

test("invalid origin, credentials, unsupported ingress and unbounded budgets refuse before I/O", () => {
  const options = { brokerUrl: "http://127.0.0.1:12345", ingress: { kind: "trusted-loopback" }, signal: new AbortController().signal,
    reconnect: { maxAttempts: 2, maxElapsedMs: 100 } } as RemoteTailOptions;
  for (const brokerUrl of ["http://localhost", "http://192.0.2.1", "http://0x7f000001", "http://user:secret@127.0.0.1", "http://127.0.0.1/?token=secret", "http://127.0.0.1/#fragment", "http://127.0.0.1/prefix", "http://127.0.0.1:0"])
    assert.throws(() => subscribeRemoteTail({ ...options, brokerUrl }), (error: unknown) => error instanceof RemoteTailError && error.reason === "invalid_options" && error.generation === 0 && !error.message.includes("secret"));
  assert.throws(() => subscribeRemoteTail({ ...options, ingress: { kind: "mesh-peer" } as any }), (e: unknown) => e instanceof RemoteTailError && e.reason === "unsupported_ingress");
  assert.throws(() => subscribeRemoteTail({ ...options, reconnect: { maxAttempts: Infinity, maxElapsedMs: 100 } }), RemoteTailError);
  assert.throws(() => subscribeRemoteTail({ ...options, ingress: { kind: "trusted-loopback", headers: {} } as any }), RemoteTailError);
});


test("binary tracked data is not accepted as the text JSON protocol", async () => {
  const f = await fixture({ backlog: [event("binary")], binary: true });
  const error = await terminal(subscription(f.url).iterator);
  assert.equal(error.reason, "protocol_error"); assert.equal(error.lastDeliveredId, null);
});

test("structured tRPC authorization denial is terminal even when handshake status is opaque", async () => {
  const f = await fixture({ fail: "auth" }); const error = await terminal(subscription(f.url).iterator);
  assert.equal(error.reason, "auth_denied"); assert.equal(error.resyncRequired, false);
  assert.equal(error.lastDeliveredId, null); assert.equal(f.connections(), 1);
  assert(!error.message.includes("do-not-echo-auth-detail"));
});

test("abort during the physical connection settles all pending reads", async () => {
  const f = await fixture(); const { iterator, controller } = subscription(f.url);
  assert.equal((await iterator.next()).value?.type, "connection");
  const reads = [iterator.next(), iterator.next(), iterator.next()];
  controller.abort();
  assert((await deadline(Promise.all(reads))).every(result => result.done));
  await until(() => f.wss.clients.size === 0);
  await sleep(15); assert(f.connections() <= 1);
});

test("for-await consumer exceptions invoke iterator cleanup", async () => {
  const f = await fixture({ backlog: [event("one")] }); const sub = subscription(f.url);
  await assert.rejects(async () => {
    for await (const item of { [Symbol.asyncIterator]: () => sub.iterator }) {
      if (item.type === "event") throw Error("consumer callback");
    }
  }, /consumer callback/);
  await until(() => f.wss.clients.size === 0 && f.live() === 0);
  await sleep(10); assert.equal(f.connections(), 1);
});

test("authority and source policy are snapshotted before asynchronous work", async () => {
  const f = await fixture({ backlog: [event("claude", "claude"), event("codex", "codex")] });
  const sources = ["claude"];
  const { iterator } = subscription(f.url, { sources }); sources[0] = "codex";
  assert.equal((await nextEvent(iterator)).id, "claude");
  assert.deepEqual(f.inputs[0]?.sources, ["claude"]);
});
