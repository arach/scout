import { expect, test } from "bun:test";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssistantClaimError, BrokerAssistantClaims, protectAssistantService } from "../../../runtime/src/broker-assistant-claims.ts";
import { createBrokerHttpRouter, type BrokerHttpRouterDeps } from "../../../runtime/src/broker-http-router.ts";
import type { ActiveScoutBrokerService } from "../../../runtime/src/broker-api.ts";
import { startAssistantAnswerer, assistantClaimHeaders, bindAssistantClaim } from "./answerer-claim.ts";
import { startScoutbotRunner } from "./runner.ts";
import { buildScoutbotThreadConversation, ScoutbotThreadMapStore } from "./thread-map.ts";
import { createScoutbotBrokerLink } from "./process/broker-link.ts";
import { createAssistantBrokerProxy } from "./process/claim-broker-proxy.ts";
import { createScoutbotBrainConversationMap, createScoutbotProcess } from "./process/scoutbot-process.ts";

async function until(predicate: () => boolean) {
  const deadline = performance.now() + 3000;
  while (!predicate()) { if (performance.now() > deadline) throw new Error("fixture condition timed out"); await Bun.sleep(3); }
}
function waitForStop(signal: AbortSignal) {
  return new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener("abort", () => resolve(), { once: true }); });
}

/** No installed app, external broker, harness or model is contacted. Claim and
 * answer routes are the public runtime router; other records are fixture data. */
async function fixture(legacy = false, leaseOptions: { ttlMs?: number; now?: () => number } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "answerer-runners-"));
  const socketPath = join(directory, "runtime.sock");
  const claims = new BrokerAssistantClaims(["scoutbot"], leaseOptions);
  const posts: { path: string; body: any; token?: string }[] = [];
  const requests: string[] = [];
  const streams = new Set<ServerResponse>();
  const node = { id: "node-fixture", name: "Fixture", meshId: "mesh-fixture" };
  const snapshot: any = { actors: {}, agents: {}, endpoints: {}, conversations: {}, nodes: { [node.id]: node }, messages: {}, flights: {}, invocations: {} };
  const raw = { executeCommand: async () => {}, postConversationMessage: async (message: any) => {
    snapshot.messages[message.id] = message; posts.push({ path: "/v1/messages", body: message }); return { ok: true, message };
  } } as unknown as ActiveScoutBrokerService;
  const service = legacy ? raw : protectAssistantService(raw, claims);
  const router = createBrokerHttpRouter({ host: "127.0.0.1", port: 0, brokerService: service } as BrokerHttpRouterDeps);
  const handler = async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const path = new URL(request.url!, "http://localhost").pathname;
      requests.push(path);
      if (path.startsWith("/v1/assistant-claims") || path === "/v1/messages") { await router(request, response); return; }
      if (path === "/v1/events/stream") {
        response.writeHead(200, { "content-type": "text/event-stream" }); response.write(": ready\n\n");
        streams.add(response); response.on("close", () => streams.delete(response)); return;
      }
      const json = (body: unknown) => { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(body)); };
      if (request.method === "GET") {
        if (path === "/health" || path === "/healthz") { json({ ok: true, nodeId: node.id }); return; }
        if (path === "/v1/node") { json(node); return; }
        if (path === "/v1/snapshot") { json(snapshot); return; }
      } else {
        const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const proof = request.headers["x-scout-assistant-claim-token"] as string | undefined;
        const save = async () => { posts.push({ path, body, token: proof });
          const collection = { "/v1/actors": "actors", "/v1/agents": "agents", "/v1/endpoints": "endpoints", "/v1/conversations": "conversations" }[path];
          if (collection) snapshot[collection][body.id] = body;
        };
        if (!legacy) await claims.withToken(proof, () => claims.admit(path === "/v1/actors" || path === "/v1/agents" ? body.id : path === "/v1/endpoints" ? body.agentId : undefined, save));
        else await save();
        json({ ok: true }); return;
      }
      response.writeHead(404); response.end();
    } catch (error) {
      response.writeHead(error instanceof AssistantClaimError ? error.status : 500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof AssistantClaimError ? error.code : String(error) }));
    }
  };
  const tcp = createServer((req, res) => { void handler(req, res); });
  const unix = createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(resolve => tcp.listen(0, "127.0.0.1", resolve));
  await new Promise<void>(resolve => unix.listen(socketPath, resolve));
  const baseUrl = `http://127.0.0.1:${(tcp.address() as { port: number }).port}`;
  return { directory, socketPath, baseUrl, claims, posts, requests, streams, snapshot,
    emit(message: any) { for (const stream of streams) stream.write(`event: message.posted\ndata: ${JSON.stringify({ kind: "message.posted", payload: { message } })}\n\n`); },
    async close() {
      for (const stream of streams) stream.end();
      tcp.closeAllConnections(); unix.closeAllConnections();
      await Promise.all([new Promise<void>(r => tcp.close(() => r())), new Promise<void>(r => unix.close(() => r()))]);
      await rm(directory, { recursive: true, force: true });
    },
  };
}

// These integration tests include HTTP stream cancellation and Unix socket
// teardown. Ownership is the contract; teardown latency is not an assertion.
for (const legacy of [false, true]) {
  test(`public in-process web registers and answers with ${legacy ? "an old runtime" : "a claim"}`, async () => {
    const f = await fixture(legacy);
    const threads = new ScoutbotThreadMapStore(join(f.directory, "web-threads.json"));
    const thread = await threads.ensureDefaultThread({ snapshot: f.snapshot, transport: "codex_app_server" });
    f.snapshot.conversations[thread.conversationId] = buildScoutbotThreadConversation(thread, f.snapshot, "node-fixture");
    const warnings: string[] = [];
    const web = await startScoutbotRunner({ brokerBaseUrl: f.baseUrl, currentDirectory: f.directory, threadMap: threads,
      log: { info() {}, warn: warning => warnings.push(warning) },
    });
    try {
      await until(() => f.streams.size > 0);
      const thread = (await threads.list()).threads[0]!;
      const message = { id: "operator-status", actorId: "operator", body: "@scoutbot /status", conversationId: thread.conversationId,
        audience: { notify: ["scoutbot"], reason: "direct_message" }, createdAt: 1 };
      f.emit(message);
      await until(() => f.posts.some(p => p.path === "/v1/messages"));
      expect(f.posts.find(p => p.path === "/v1/messages")?.body).toMatchObject({ actorId: "scoutbot", replyToMessageId: message.id });
      const registration = f.posts.find(p => p.path === "/v1/agents")!;
      expect(!!registration.token).toBe(!legacy);
      if (!legacy) expect(f.claims.capability().agents.scoutbot.holderId).toContain(`web:pid:${process.pid}:`);
      expect(warnings).toEqual([]);
    } finally { await web.stop(); await f.close(); }
    expect(f.claims.capability().agents.scoutbot.held).toBe(false);
  }, 15_000);

  test(`standalone process registration, brain reply and MCP socket use ${legacy ? "legacy mode" : "one claim"}`, async () => {
    const f = await fixture(legacy); let complete = false; let proxySocket: string | undefined;
    const answerer = startAssistantAnswerer({ mode: "standalone", request: (path, init) => fetch(new URL(path, "http://localhost"), { ...init, unix: f.socketPath }) }, async signal => {
      const broker = createScoutbotBrokerLink({ socketPath: f.socketPath });
      const threads = new ScoutbotThreadMapStore(join(f.directory, "process-threads.json"));
      const scoutbot = createScoutbotProcess({ broker, threads, currentDirectory: f.directory,
        conversations: createScoutbotBrainConversationMap(join(f.directory, "conversations.json")),
        brain: { reply: async () => ({ conversationId: 1, text: "Fixture brain answer", usage: null }), close: async () => {} },
        log: { info() {}, warn() {} },
      });
      await scoutbot.bootstrap();
      const thread = (await threads.list()).threads[0]!;
      await scoutbot.handleMessage({ id: "question", actorId: "operator", body: "Explain closures", conversationId: thread.conversationId,
        audience: { notify: ["scoutbot"], reason: "direct_message" }, createdAt: 1 } as any);
      const proxy = await createAssistantBrokerProxy(f.socketPath); proxySocket = proxy.socketPath;
      try {
        expect((await stat(proxy.socketPath)).mode & 0o777).toBe(0o600);
        // Same request the stdio tool child sends: no token in its args or env.
        const result = await fetch("http://localhost/v1/messages", { unix: proxy.socketPath, method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "child-reply", actorId: "scoutbot", body: "Tool reply", conversationId: thread.conversationId,
            originNodeId: "node-fixture", class: "agent", visibility: "private", policy: "durable", createdAt: 2 }),
        });
        expect(result.status).toBe(200);
        complete = true;
        await waitForStop(signal);
      } finally { await proxy.close(); }
    });
    try {
      await until(() => complete);
      expect(f.posts.filter(p => p.path === "/v1/messages").map(p => p.body.body)).toEqual(["Fixture brain answer", "Tool reply"]);
      expect(!!f.posts.find(p => p.path === "/v1/agents")?.token).toBe(!legacy);
      if (!legacy) expect(f.claims.capability().agents.scoutbot.holderId).toBe(answerer.holderId);
    } finally { await answerer.stop(); await f.close(); }
    expect(f.claims.capability().agents.scoutbot.held).toBe(false);
    expect(await stat(proxySocket!).catch(() => null)).toBeNull();
  }, 15_000);
}

test("a stray web without managed stands down before registration or event consumption", async () => {
  const f = await fixture(); const owner = f.claims.acquire("scoutbot", "standalone:pid:fixture");
  const env = process.env.OPENSCOUT_SCOUTBOT_PROCESS; delete process.env.OPENSCOUT_SCOUTBOT_PROCESS;
  const warnings: string[] = [];
  let web: Awaited<ReturnType<typeof startScoutbotRunner>> | undefined;
  try {
    web = await startScoutbotRunner({ brokerBaseUrl: f.baseUrl, currentDirectory: f.directory,
      threadMap: new ScoutbotThreadMapStore(join(f.directory, "web-threads.json")), log: { info() {}, warn: w => warnings.push(w) },
    });
    expect(f.requests).toEqual(["/v1/assistant-claims", "/v1/assistant-claims"]);
    expect(f.posts).toEqual([]); expect(f.streams.size).toBe(0); expect(warnings).toEqual([]);
    await web.stop();
    expect(f.claims.capability().agents.scoutbot.holderId).toBe("standalone:pid:fixture");
    // UI thread reads on the standby handle do not acquire or register the assistant.
    await web.getThreads();
    expect(f.posts).toEqual([]);
  } finally {
    if (env === undefined) delete process.env.OPENSCOUT_SCOUTBOT_PROCESS; else process.env.OPENSCOUT_SCOUTBOT_PROCESS = env;
    await web?.stop(); f.claims.withToken(owner.token, () => f.claims.release("scoutbot")); await f.close();
  }
}, 15_000);

test("a stopped generation's proxy cannot submit under a later holder", async () => {
  const f = await fixture(); let proxy: Awaited<ReturnType<typeof createAssistantBrokerProxy>> | undefined;
  let lateHeaders!: () => Record<string, string>;
  const answerer = startAssistantAnswerer({ mode: "standalone", request: (path, init) => fetch(new URL(path, f.baseUrl), init) }, async signal => {
    proxy = await createAssistantBrokerProxy(f.socketPath);
    lateHeaders = bindAssistantClaim(assistantClaimHeaders);
    await waitForStop(signal); // Keep the socket open deliberately, to model a stale child.
  });
  try {
    await until(() => !!proxy);
    // Send raw dot segments (fetch normalizes them before sending). The tool
    // socket must not turn them into an authorized claim-management request.
    const managementStatus = await new Promise<number>(resolve => {
      const request = httpRequest({ socketPath: proxy!.socketPath, path: "/v1/unused/../assistant-claims/release", method: "POST",
        headers: { "content-type": "application/json" } }, response => { response.resume(); response.on("end", () => resolve(response.statusCode!)); });
      request.end(JSON.stringify({ agentId: "scoutbot" }));
    });
    expect(managementStatus).toBe(403);
    await answerer.stop();
    f.claims.acquire("scoutbot", "replacement:pid:fixture");
    expect(() => lateHeaders()).toThrow("assistant_claim_lost");
    const result = await fetch("http://localhost/v1/messages", { unix: proxy!.socketPath, method: "POST", body: JSON.stringify({ actorId: "scoutbot", body: "late" }) });
    expect(result.status).toBe(409); expect(f.posts).toEqual([]);
  } finally { await answerer.stop(); await proxy?.close(); await f.close(); }
}, 15_000);

test("runtime HTTP fences a dead holder's delayed post after a standby web takes over", async () => {
  let now = 100;
  const f = await fixture(false, { ttlMs: 1000, now: () => now });
  let disconnected = false; let oldProof: Record<string, string> | undefined; let lost = false;
  const dead = startAssistantAnswerer({ mode: "standalone", now: () => now,
    request: (path, init) => disconnected ? Promise.resolve(new Response(null, { status: 503 })) : fetch(new URL(path, f.baseUrl), init),
  }, async signal => { oldProof = assistantClaimHeaders(); await waitForStop(signal); lost = true; });
  let web: Awaited<ReturnType<typeof startScoutbotRunner>> | undefined;
  try {
    await until(() => !!oldProof);
    web = await startScoutbotRunner({ brokerBaseUrl: f.baseUrl, currentDirectory: f.directory,
      threadMap: new ScoutbotThreadMapStore(join(f.directory, "standby-threads.json")), log: { info() {}, warn() {} },
    });
    expect(f.streams.size).toBe(0); expect(f.posts).toEqual([]);
    disconnected = true;
    await until(() => lost); await dead.stop(); // Simulate death: no release reached the broker.
    expect(f.claims.capability().agents.scoutbot.held).toBe(true);
    now += 1001;
    await until(() => f.streams.size > 0);
    expect(f.claims.capability().agents.scoutbot.holderId).toContain(`web:pid:${process.pid}:`);
    const stale = await fetch(new URL("/v1/messages", f.baseUrl), { method: "POST", headers: { "content-type": "application/json", ...oldProof },
      body: JSON.stringify({ actorId: "scoutbot", body: "stale answer" }),
    });
    expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({ error: "assistant_claim_lost" });
    expect(f.posts.filter(p => p.path === "/v1/messages")).toEqual([]);
  } finally { await dead.stop(); await web?.stop(); await f.close(); }
}, 15_000);
