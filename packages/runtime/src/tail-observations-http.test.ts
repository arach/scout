import { afterEach, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { TailObservationService } from "./tail-observations.js";
import { TailObservationRouter } from "./tail-observations-http.js";
import type { RuntimeHttpRequestLike, RuntimeHttpResponseLike, RuntimeRequestTransportContext } from "./portable-types.js";

class Request extends EventEmitter {
  headers = { "content-type": "application/json" };
  constructor(readonly transportContext: RuntimeRequestTransportContext, readonly body: unknown) { super(); }
  override on(name: string, listener: (...args: any[]) => void): this {
    super.on(name, listener);
    if (name === "end") queueMicrotask(() => { this.emit("data", Buffer.from(JSON.stringify(this.body))); this.emit("end"); });
    return this;
  }
  resume() {} destroy() {}
}
class Response extends EventEmitter {
  status = 0; body = ""; writableEnded = false;
  writeHead(status: number) { this.status = status; return this; }
  setHeader() {}
  end(value: unknown) { this.body += String(value ?? ""); this.writableEnded = true; }
}
const local = { transport: "loopback" } as const;
const peer = { transport: "remote", peer: { keyId: "watcher", tier: "control" } } as const;
const stop: Array<() => void> = [];
afterEach(() => { for (const fn of stop.splice(0)) fn(); });
async function call(router: TailObservationRouter, path: string, body: unknown, context: RuntimeRequestTransportContext = local) {
  const request = new Request(context, body), response = new Response();
  await router.handle(request as unknown as RuntimeHttpRequestLike, response as unknown as RuntimeHttpResponseLike, new URL(`http://runtime${path}`), "POST");
  return { status: response.status, body: JSON.parse(response.body) };
}
function source(nodeId: string) {
  let listeners = 0;
  const service = new TailObservationService({
    bind: target => { if (target.nodeId !== nodeId) throw Error("not local"); return { ...target, source: "claude", sessionId: "native", hostLabel: "Source host" }; },
    history: async () => [{ id: "one", ts: 1, sessionId: "native", source: "claude", kind: "assistant", summary: "Selected work", raw: { private: "raw" }, project: "p", cwd: "/p", pid: 1, parentPid: null, harness: "scout-managed" }],
    state: async () => ({ kind: "permission", summary: "Allow the build?" }),
    subscribe: () => { listeners++; return () => { listeners--; }; }, waitMs: 5,
  });
  return { service, listeners: () => listeners };
}

test("two runtimes forward only an exact selected observation and release the source on unsubscribe", async () => {
  const a = source("a"), b = source("b");
  const unreachable = async () => { throw Error("unexpected forward"); };
  const remote = new TailObservationRouter({ nodeId: "b", source: b.service, peer: () => null, peerFetch: unreachable });
  const paths: string[] = [];
  let trusted = true;
  const watch = new TailObservationRouter({ nodeId: "a", source: a.service,
    peer: id => trusted && id === "b" ? { brokerUrl: "http://b" } : null,
    peerFetch: async (_base, path, init) => {
      paths.push(path);
      const result = await call(remote, path, JSON.parse(String(init?.body)), peer);
      return new globalThis.Response(JSON.stringify(result.body), { status: result.status });
    } });
  stop.push(() => watch.stop(), () => remote.stop());
  const opened = await call(watch, "/v1/tail/observations/subscribe", { target: { nodeId: "b", endpointId: "selected" } });
  expect(opened.status).toBe(200);
  expect(opened.body.target).toMatchObject({ nodeId: "b", endpointId: "selected", sessionId: "native" });
  expect(opened.body.sourceIsLocal).toBe(false);
  expect(opened.body.events[0].raw).toBeUndefined();
  expect(opened.body.state.kind).toBe("permission");
  expect(a.listeners()).toBe(0); expect(b.listeners()).toBe(1);
  expect(paths).toEqual(["/v1/mesh/tail/observations/subscribe"]);
  const id = opened.body.observationId;
  expect((await call(watch, "/v1/tail/observations/read", { observationId: id, cursor: opened.body.cursor })).status).toBe(200);
  trusted = false;
  expect((await call(watch, "/v1/tail/observations/read", { observationId: id })).status).toBe(503);
  trusted = true;
  expect((await call(watch, "/v1/tail/observations/unsubscribe", { observationId: id })).status).toBe(200);
  expect(b.listeners()).toBe(0);
});

test("remote observations require control trust, forbid third-host forwarding, and bind leases to the signed peer", async () => {
  const b = source("b");
  const router = new TailObservationRouter({ nodeId: "b", source: b.service, peer: () => null, peerFetch: async () => { throw Error("no forward"); } });
  stop.push(() => router.stop());
  const path = "/v1/mesh/tail/observations/subscribe", target = { nodeId: "b", endpointId: "e" };
  for (const context of [local, { transport: "remote" }, { ...peer, peer: { keyId: "watcher", tier: "observe" } }, { ...peer, scoped: {} }, { ...peer, guest: {} }])
    expect((await call(router, path, { target }, context as RuntimeRequestTransportContext)).status).toBe(403);
  expect((await call(router, path, { target: { ...target, nodeId: "third" } }, peer)).status).toBe(403);
  expect((await call(router, "/v1/tail/observations/subscribe", { target }, peer)).status).toBe(403);
  const opened = await call(router, path, { target }, peer);
  expect(opened.status).toBe(200);
  expect(opened.body.sourceIsLocal).toBe(true);
  const other = { ...peer, peer: { ...peer.peer, keyId: "other" } };
  expect((await call(router, "/v1/mesh/tail/observations/read", { observationId: opened.body.observationId }, other)).status).toBe(410);
  await call(router, "/v1/mesh/tail/observations/unsubscribe", { observationId: opened.body.observationId }, other);
  expect(b.listeners()).toBe(1);
  await call(router, "/v1/mesh/tail/observations/unsubscribe", { observationId: opened.body.observationId }, peer);
  expect(b.listeners()).toBe(0);
});
