import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

import type { SessionState } from "@openscout/agent-sessions";

import {
  createMeshApprovalShare,
  createMeshApprovalWatch,
  handleBrokerMeshApprovalsRoute,
  readMeshApprovalsConfig,
  writeMeshApprovalsConfig,
  type MeshApprovalDecision,
  type MeshApprovalShare,
  type MeshApprovalsConfig,
} from "./mesh-approvals.js";
import type { RuntimeHttpRequestLike, RuntimeHttpResponseLike, RuntimeRequestTransportContext } from "./portable-types.js";

const PEER = "a".repeat(64);
const STRANGER = "b".repeat(64);

function sessionWithApproval(version: number, status = "awaiting_approval"): SessionState {
  return {
    session: { id: "s1", name: "fix tests", adapterType: "claude-code", status: "active" },
    turns: [{
      id: "t1",
      startedAt: 1,
      blocks: [{
        block: {
          type: "action",
          id: "b1",
          action: { kind: "command", status, command: "rm -rf build", approval: { version, risk: "high" } },
        },
      }],
    }],
  } as unknown as SessionState;
}

const DECISION: MeshApprovalDecision = { sessionId: "s1", turnId: "t1", blockId: "b1", version: 2, decision: "approve" };

function share(options: { snapshots: () => SessionState[]; config?: MeshApprovalsConfig; decided?: MeshApprovalDecision[] }) {
  const decided = options.decided ?? [];
  return createMeshApprovalShare({
    nodeId: "mini",
    listSnapshots: async () => options.snapshots(),
    decide: async (input) => { decided.push(input); },
    readConfig: () => options.config ?? { share: [PEER], watch: false },
    pollMs: 5,
  });
}

class FakeRequest extends EventEmitter {
  headers: Record<string, string> = {};
  method: string;
  url: string;
  transportContext?: RuntimeRequestTransportContext;
  private body: string | null;
  constructor(method: string, url: string, context: RuntimeRequestTransportContext | undefined, body?: unknown) {
    super();
    this.method = method;
    this.url = url;
    this.transportContext = context;
    this.body = body === undefined ? null : JSON.stringify(body);
    if (this.body !== null) this.headers["content-type"] = "application/json";
  }
  override on(event: string, listener: (...args: any[]) => void): this {
    super.on(event, listener);
    if (event === "end") {
      queueMicrotask(() => {
        if (this.body !== null) this.emit("data", Buffer.from(this.body));
        this.emit("end");
      });
    }
    return this;
  }
  resume() {}
  destroy() {}
}

class FakeResponse extends EventEmitter {
  status = 0;
  chunks: string[] = [];
  writableEnded = false;
  headers: Record<string, unknown> = {};
  writeHead(status: number, headers?: Record<string, unknown>) { this.status = status; Object.assign(this.headers, headers ?? {}); return this; }
  setHeader(name: string, value: unknown) { this.headers[name] = value; }
  write(chunk: unknown) { this.chunks.push(String(chunk)); return true; }
  end(chunk?: unknown) { if (chunk !== undefined) this.chunks.push(String(chunk)); this.writableEnded = true; this.emit("finish"); }
  text() { return this.chunks.join(""); }
}

const remote = (keyId: string): RuntimeRequestTransportContext => ({ transport: "remote", peer: { keyId, tier: "control" } } as RuntimeRequestTransportContext);
const local = { transport: "http" } as RuntimeRequestTransportContext;

async function call(method: string, path: string, context: RuntimeRequestTransportContext | undefined, deps: Parameters<typeof handleBrokerMeshApprovalsRoute>[4], body?: unknown) {
  const request = new FakeRequest(method, path, context, body);
  const response = new FakeResponse();
  const handled = await handleBrokerMeshApprovalsRoute(
    request as unknown as RuntimeHttpRequestLike,
    response as unknown as RuntimeHttpResponseLike,
    new URL(`http://x${path}`),
    method,
    deps,
  );
  return { handled, request, response };
}

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("mesh approvals config", () => {
  test("missing or broken file reads as off", () => {
    const dir = mkdtempSync(join(tmpdir(), "mesh-approvals-"));
    dirs.push(dir);
    const path = join(dir, "mesh-approvals.json");
    expect(readMeshApprovalsConfig(path)).toEqual({ share: [], watch: false });
    writeMeshApprovalsConfig(path, { share: [PEER, PEER], watch: true });
    expect(readMeshApprovalsConfig(path)).toEqual({ share: [PEER], watch: true });
  });
});

describe("sharing side", () => {
  test("decide checks the approval is still pending at that version", async () => {
    const decided: MeshApprovalDecision[] = [];
    const subject = share({ snapshots: () => [sessionWithApproval(2)], decided });

    expect(await subject.decide({ ...DECISION, blockId: "nope" }, "peer")).toMatchObject({ status: 409, body: { error: "not_pending" } });
    expect(await subject.decide({ ...DECISION, version: 1 }, "peer")).toMatchObject({ status: 409, body: { error: "stale_version", currentVersion: 2 } });
    expect(await subject.decide(DECISION, "peer")).toMatchObject({ status: 200 });
    expect(decided).toHaveLength(1);

    // The same answer again is a no-op; a different one is refused.
    expect(await subject.decide(DECISION, "peer")).toMatchObject({ status: 200, body: { repeated: true } });
    expect(await subject.decide({ ...DECISION, decision: "deny" }, "peer")).toMatchObject({ status: 409, body: { error: "already_decided" } });
    expect(decided).toHaveLength(1);
    subject.stop();
  });

  test("concurrent answers are applied once", async () => {
    const decided: MeshApprovalDecision[] = [];
    const subject = share({ snapshots: () => decided.length ? [] : [sessionWithApproval(2)], decided });
    const results = await Promise.all([subject.decide(DECISION, "a"), subject.decide({ ...DECISION, decision: "deny" }, "b")]);
    expect(decided).toHaveLength(1);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  });

  test("only real pending approvals are shared, with secrets left out of the wire shape", async () => {
    const subject = share({ snapshots: () => [sessionWithApproval(2), sessionWithApproval(1, "running")] });
    const snapshot = await subject.current();
    expect(snapshot.approvals).toHaveLength(1);
    expect(snapshot.approvals[0]).toMatchObject({ sessionName: "fix tests", version: 2, risk: "high", detail: "rm -rf build" });
    expect(Object.keys(snapshot.approvals[0]!)).not.toContain("actionStatus");
  });
});

describe("routes", () => {
  test("a peer that was not shared with gets 403, whatever its tier", async () => {
    const subject = share({ snapshots: () => [sessionWithApproval(2)] });
    for (const path of ["/v1/mesh/approvals/stream", "/v1/mesh/approvals/decide"]) {
      const { response } = await call(path.endsWith("stream") ? "GET" : "POST", path, remote(STRANGER), { share: subject }, DECISION);
      expect(response.status).toBe(403);
    }
    expect((await call("GET", "/v1/mesh/approvals/stream", remote(PEER), {})).response.status).toBe(403);
  });

  test("a shared peer gets the snapshot on connect and answers through decide", async () => {
    const decided: MeshApprovalDecision[] = [];
    const subject = share({ snapshots: () => [sessionWithApproval(2)], decided });
    const stream = await call("GET", "/v1/mesh/approvals/stream", remote(PEER), { share: subject });
    expect(stream.response.status).toBe(200);
    expect(stream.response.text()).toContain("event: snapshot");
    expect(stream.response.text()).toContain("\"blockId\":\"b1\"");
    stream.request.emit("close");

    const decide = await call("POST", "/v1/mesh/approvals/decide", remote(PEER), { share: subject }, DECISION);
    expect(decide.response.status).toBe(200);
    expect(decided).toEqual([DECISION]);
  });

  test("unsharing cuts a live stream at the next change and refuses a queued answer", async () => {
    const config: MeshApprovalsConfig = { share: [PEER], watch: false };
    let version = 2;
    const decided: MeshApprovalDecision[] = [];
    const subject = share({ snapshots: () => [sessionWithApproval(version)], config, decided });
    const stream = await call("GET", "/v1/mesh/approvals/stream", remote(PEER), { share: subject });
    expect(stream.response.text()).toContain("\"version\":2");
    config.share = [];
    version = 3;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(stream.response.text()).not.toContain("\"version\":3");
    expect(stream.response.writableEnded).toBe(true);

    expect(await subject.decide(DECISION, "peer", () => config.share.includes(PEER))).toMatchObject({ status: 403 });
    expect(decided).toEqual([]);
    subject.stop();
  });

  test("a client gone before the first snapshot leaves no subscription behind", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let subscribed = 0;
    const subject = share({ snapshots: () => [sessionWithApproval(2)] });
    const slow: MeshApprovalShare = {
      ...subject,
      current: async () => { await gate; return subject.current(); },
      subscribe: (listener) => { subscribed += 1; return subject.subscribe(listener); },
    };
    const request = new FakeRequest("GET", "/v1/mesh/approvals/stream", remote(PEER));
    const response = new FakeResponse();
    const pending = handleBrokerMeshApprovalsRoute(request as unknown as RuntimeHttpRequestLike, response as unknown as RuntimeHttpResponseLike, new URL("http://x/v1/mesh/approvals/stream"), "GET", { share: slow });
    response.emit("close");
    release();
    await pending;
    expect(subscribed).toBe(0);
    expect(response.text()).not.toContain("event: snapshot");
  });

  test("remote-cache routes are this machine's only", async () => {
    expect((await call("GET", "/v1/approvals/remote", remote(PEER), {})).response.status).toBe(403);
    const ok = await call("GET", "/v1/approvals/remote", local, {});
    expect(ok.response.status).toBe(200);
    expect(JSON.parse(ok.response.text())).toEqual({ nodes: [] });
    expect((await call("GET", "/v1/elsewhere", local, {})).handled).toBe(false);
  });
});

describe("watching side", () => {
  function wire(subject: MeshApprovalShare, keyId: string) {
    // A peer fetch that runs the sharing side's handler in-process, as the
    // mesh ingress gate would after verifying the peer's signature.
    return async (_base: string, path: string, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      const request = new FakeRequest(method, path, remote(keyId), body);
      init?.signal?.addEventListener("abort", () => request.emit("close"));
      if (method === "GET") {
        const stream = new TransformStream<Uint8Array, Uint8Array>();
        const writer = stream.writable.getWriter();
        const encoder = new TextEncoder();
        let status = 0;
        const response = {
          writableEnded: false,
          writeHead(code: number) { status = code; },
          write(chunk: unknown) { void writer.write(encoder.encode(String(chunk))); return true; },
          end(chunk?: unknown) { if (chunk !== undefined) void writer.write(encoder.encode(String(chunk))); void writer.close().catch(() => {}); },
          on() {},
          setHeader() {},
        };
        await handleBrokerMeshApprovalsRoute(request as unknown as RuntimeHttpRequestLike, response as unknown as RuntimeHttpResponseLike, new URL(`http://x${path}`), method, { share: subject });
        return new Response(status === 200 ? stream.readable : null, { status });
      }
      const response = new FakeResponse();
      await handleBrokerMeshApprovalsRoute(request as unknown as RuntimeHttpRequestLike, response as unknown as RuntimeHttpResponseLike, new URL(`http://x${path}`), method, { share: subject });
      return new Response(response.text(), { status: response.status });
    };
  }

  async function until(check: () => boolean) {
    for (let i = 0; i < 100 && !check(); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(check()).toBe(true);
  }

  test("watch off: no subscriptions at all", () => {
    const watch = createMeshApprovalWatch({
      listPeers: () => [{ keyId: PEER, nodeId: "mini", label: "mini", brokerUrl: "https://mini" }],
      peerFetch: async () => { throw new Error("should not connect"); },
      readConfig: () => ({ share: [], watch: false }),
    });
    expect(watch.list()).toEqual([]);
    watch.stop();
  });

  test("a shared peer's approvals arrive live and an answer goes back to it", async () => {
    const decided: MeshApprovalDecision[] = [];
    const subject = share({ snapshots: () => decided.length ? [] : [sessionWithApproval(2)], decided });
    const watch = createMeshApprovalWatch({
      listPeers: () => [{ keyId: PEER, nodeId: "mini", label: "mini", brokerUrl: "https://mini" }],
      peerFetch: wire(subject, PEER),
      readConfig: () => ({ share: [], watch: true }),
    });
    await until(() => watch.list()[0]?.state === "live" && watch.list()[0]!.approvals.length === 1);

    const result = await watch.decide("mini", DECISION);
    expect(result.status).toBe(200);
    expect(decided).toEqual([DECISION]);
    await until(() => watch.list()[0]!.approvals.length === 0);
    watch.stop();
    subject.stop();
  });

  test("a peer that does not share is marked not_shared and cannot be answered", async () => {
    const subject = share({ snapshots: () => [sessionWithApproval(2)], config: { share: [], watch: false } });
    const watch = createMeshApprovalWatch({
      listPeers: () => [{ keyId: PEER, nodeId: "mini", label: "mini", brokerUrl: "https://mini" }],
      peerFetch: wire(subject, PEER),
      readConfig: () => ({ share: [], watch: true }),
    });
    await until(() => watch.list()[0]?.state === "not_shared");
    expect((await watch.decide("mini", DECISION)).status).toBe(409);
    watch.stop();
  });
});

describe("local approvals configuration API", () => {
  function configDeps() {
    const dir = mkdtempSync(join(tmpdir(), "approvals-api-")); dirs.push(dir);
    const path = join(dir, "mesh-approvals.json");
    return { config: { read: () => readMeshApprovalsConfig(path),
      write: (config: MeshApprovalsConfig) => writeMeshApprovalsConfig(path, config),
      isActivePeer: (key: string) => key === PEER } };
  }
  test("atomic opt-in, watch and withdrawal use the same config as sharing", async () => {
    const deps = configDeps();
    const sharing = createMeshApprovalShare({ nodeId: "test", listSnapshots: async () => [],
      decide: async () => {}, readConfig: deps.config.read });
    expect(sharing.isShared(PEER)).toBe(false);
    expect((await call("POST", "/v1/mesh/approvals/config", local, deps, { share: [PEER], watch: true })).response.status).toBe(200);
    expect(sharing.isShared(PEER)).toBe(true);
    expect(deps.config.read()).toEqual({ share: [PEER], watch: true });
    expect((await call("POST", "/v1/mesh/approvals/config", local, deps, { share: [], watch: false })).response.status).toBe(200);
    expect(sharing.isShared(PEER)).toBe(false);
    expect(JSON.parse((await call("GET", "/v1/mesh/approvals/config", local, deps)).response.text())).toEqual({ share: [], watch: false });
    sharing.stop();
  });
  test("remote, guest, scoped and ungated callers cannot configure", async () => {
    for (const context of [remote(PEER), undefined, { ...local, guest: {} }, { ...local, scoped: {} }]) {
      for (const method of ["GET", "POST"]) {
        expect((await call(method, "/v1/mesh/approvals/config", context as RuntimeRequestTransportContext, configDeps(), { share: [], watch: false })).response.status).toBe(403);
      }
    }
  });
  test("invalid, revoked, expired, unknown and noncanonical entries do not partially write", async () => {
    const deps = configDeps();
    for (const body of [{ share: [PEER, STRANGER], watch: true }, { share: [PEER.toUpperCase()], watch: true },
      { share: [PEER.slice(0, 12)], watch: true }, { share: [PEER] }, { share: [], watch: false, path: "/tmp/file" },
      { share: Array(129).fill(PEER), watch: true }]) {
      expect((await call("POST", "/v1/mesh/approvals/config", local, deps, body)).response.status).toBe(400);
      expect(deps.config.read()).toEqual({ share: [], watch: false });
    }
  });
});
