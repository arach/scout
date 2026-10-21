import { afterEach, describe, expect, test } from "bun:test";
import { askScoutQuestion as askExportedScoutQuestion } from "./scout-broker.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { initTRPC } from "@trpc/server";
import type { ScoutDeliverRequest, ScoutDeliverResponse } from "@openscout/protocol";
import { SCOUT_SESSION_INPUT_RECEIPTS_CAPABILITY } from "@openscout/protocol";
import { BrokerRequestReceipts } from "./broker-request-receipts.js";
import { brokerDeliverRequestSchema } from "./broker-command-boundary-schemas.js";
import { deliverScoutRequest, normalizeOutgoingAttachments, prepareScoutDelivery, prepareScoutSessionReply,
  validateScoutSessionReplyResult } from "./delivery-client.js";
import golden from "./test-helpers/delivery-golden.json";

const fetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetch; });
const normalized = (value: unknown) => JSON.parse(JSON.stringify(value));
const broker = { baseUrl: "http://delivery.test", expectedNodeId: "node-1", socketPath: null };
const replyInput = { clientMessageId: " session-key ", requesterId: "operator", requesterNodeId: "node-1",
  sessionId: " native-session ", harness: "codex" as const, body: "  keep going  ", source: "scout-mobile" };
const attachments = [
  { mediaType: "  ", url: "invalid" },
  { mediaType: " image/png ", fileName: " evidence.png ", blobKey: " blob-original " },
  { id: " uploaded-explicit ", mediaType: " text/plain ", url: " https://example.com/evidence " },
];

// Captured by the original web service at bb15baf2, before extraction. Compare
// normalized objects, not object insertion order or serialized JSON strings.
describe("pre-extraction command parity", () => {
  for (const [index, name] of ["direct", "ask", "explicit message", "selected message"].entries()) {
    test(name, () => {
      const { id: _, requestId: __, attachments: ___, ...command } = golden[index]!;
      const prepared = prepareScoutDelivery({ clientMessageId: " golden-key ", now: 999_999,
        command: { ...command, attachments } as Parameters<typeof prepareScoutDelivery>[0]["command"] });
      expect(normalized(prepared)).toEqual(golden[index]);
      expect(prepared.createdAt).toBeUndefined();
    });
  }
  test("native session reply, including trim and Codex guard", () => {
    const prepared = prepareScoutSessionReply(replyInput);
    expect(normalized({ ...prepared, intent: "session_input" })).toEqual(golden[4]);
    expect(prepared.target).toMatchObject({ forkIfLive: true });
    expect(prepareScoutSessionReply({ ...replyInput, harness: "claude" }).target).toMatchObject({ forkIfLive: false });
  });
  test("retained timestamp and explicit ids are not regenerated", () => {
    const prepared = prepareScoutDelivery({ clientMessageId: " key ", createdAtMs: 123, now: 999,
      command: { intent: "tell", body: "same", attachments } });
    expect(prepared.createdAt).toBe(123);
    expect(prepared.attachments?.[1]?.id).toBe("uploaded-explicit");
    expect(prepared).toEqual(prepareScoutDelivery({ clientMessageId: "key", createdAtMs: 123, now: 1000,
      command: { intent: "tell", body: "same", attachments } }));
  });
  test("unkeyed sends do not claim durable idempotency", () => {
    const input = { now: 123, command: { intent: "tell" as const, body: "same" } };
    const first = prepareScoutDelivery(input), second = prepareScoutDelivery(input);
    expect(first.requestId).toBeUndefined();
    expect(first.createdAt).toBe(123);
    expect(first.id).not.toBe(second.id);
    expect(normalizeOutgoingAttachments([{ mediaType: " ", url: "x" }], "key")).toBeUndefined();
  });
  test("native input never gets a random fallback key or unsupported harness", () => {
    expect(() => prepareScoutSessionReply({ ...replyInput, clientMessageId: " " })).toThrow("request_id_required");
    expect(() => prepareScoutSessionReply({ ...replyInput, harness: "other" as never })).toThrow("session_input_unsupported");
    expect(() => prepareScoutSessionReply({ ...replyInput, body: " " })).toThrow("session_input_unsupported");
  });
});

function compatibleBroker() {
  let capabilities = [SCOUT_SESSION_INPUT_RECEIPTS_CAPABILITY];
  let nodeId = "node-1", legacy = false, submissions = 0;
  const posts: unknown[] = [];
  // The original broker boundary's required two-value enum is the fence.
  // Passthrough permits sessionDelivery, but cannot turn session_input into consult.
  const old = z.object({ body: z.string().trim().min(1), intent: z.enum(["tell", "consult"]) }).passthrough();
  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (new URL(request.url).pathname === "/v1/node") return Response.json({ id: nodeId, capabilities });
    const command = await request.json(); posts.push(command);
    if (legacy && !old.safeParse(command).success) return Response.json({ error: "invalid intent" }, { status: 400 });
    const payload = brokerDeliverRequestSchema.parse(command);
    submissions++;
    return Response.json({ kind: "delivery", accepted: true, receipt: { inputSubmitted: {
      kind: "in_place", state: "submitted", sessionId: "native-session", harness: "codex", via: "tmux", location: "%3",
    } }, conversation: { id: "dm" }, message: { id: "message" } });
  }) as typeof fetch;
  return { posts, submissions: () => submissions, downgrade: () => { capabilities = []; },
    replace: () => { legacy = true; }, changeNode: () => { nodeId = "another-node"; } };
}

test("every native submission checks fresh node capabilities and identity", async () => {
  const fixture = compatibleBroker();
  const command = prepareScoutSessionReply(replyInput);
  await deliverScoutRequest(broker, command);
  fixture.downgrade();
  await expect(deliverScoutRequest(broker, command)).rejects.toThrow("session_input_unsupported");
  expect(fixture.posts).toHaveLength(1);
  const other = compatibleBroker(); other.changeNode();
  await expect(deliverScoutRequest(broker, command)).rejects.toThrow("session_input_unsupported");
  expect(other.posts).toHaveLength(0);
});

test("required old enum rejects versioned input after a compatible capability probe", async () => {
  const fixture = compatibleBroker(); fixture.replace();
  const prepared = prepareScoutSessionReply(replyInput);
  await expect(deliverScoutRequest(broker, prepared)).rejects.toThrow("invalid intent");
  expect(fixture.posts).toHaveLength(1);
  expect(fixture.posts[0]).toMatchObject({ intent: "session_input", sessionDelivery: "in_place_or_resume" });
  expect(fixture.submissions()).toBe(0);
  expect(prepared.intent).toBe("consult"); // Wire encoding never mutates retained content.
});

test("old pairing methods cannot reinterpret the durable method as legacy input", async () => {
  let inputs = 0;
  const t = initTRPC.create();
  const old = t.router({ mobile: t.router({ askSession: t.procedure.mutation(() => { inputs++; }) }) });
  const caller = old.createCaller({}) as unknown as { mobile: { askSessionDurable(input: unknown): Promise<unknown> } };
  await expect(caller.mobile.askSessionDurable(replyInput)).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(inputs).toBe(0);
});

test("structured routing refusals are not successful deliveries or fallback submissions", async () => {
  let posts = 0;
  const rejected = { kind: "rejected", accepted: false, reason: "invalid_target", rejection: { id: "dispatch" } };
  globalThis.fetch = (async () => { posts++; return Response.json(rejected, { status: 422 }); }) as typeof fetch;
  expect(await deliverScoutRequest(broker, prepareScoutDelivery({ command: { intent: "tell", body: "hello" } }))).toEqual(rejected);
  expect(posts).toBe(1);
});

test("public client retains one command across concurrency, clock change, response loss and ledger reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "delivery-client-"));
  try {
    let ledger = new BrokerRequestReceipts(directory), executions = 0, lose = true;
    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const payload = brokerDeliverRequestSchema.parse(await request.json());
      const result = await ledger.run(payload.requesterId!, payload.requestId!, "deliver", payload, async () => {
        executions++;
        return { kind: "delivery", accepted: true, message: { id: "original" }, flight: { id: "original-flight" } };
      });
      if (lose) { lose = false; throw new Error("response lost after acceptance"); }
      return Response.json(result);
    }) as typeof fetch;
    const input = { clientMessageId: "retained", command: { requesterId: "operator", body: "Inspect", intent: "consult" as const, attachments } };
    const prepared = prepareScoutDelivery(input);
    const results = await Promise.allSettled([deliverScoutRequest(broker, prepared), deliverScoutRequest(broker, prepared)]);
    expect(results.map(r => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    ledger = new BrokerRequestReceipts(directory);
    const rebuilt = prepareScoutDelivery({ ...input, now: 999_999_999 });
    expect(rebuilt).toEqual(prepared);
    expect(await deliverScoutRequest(broker, rebuilt)).toMatchObject({ message: { id: "original" } });
    expect(executions).toBe(1);
    for (const change of [{ body: "different" }, { targetAgentId: "other" }, { attachments: [{ mediaType: "text/plain", url: "https://example.com/changed" }] }, { execution: { model: "different" } }]) {
      await expect(deliverScoutRequest(broker, { ...rebuilt, ...change })).rejects.toThrow("different content");
    }
    expect(executions).toBe(1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("session receipt validation distinguishes submission, resume and unconfirmed acceptance", () => {
  const expected = { sessionId: "native", harness: "claude" as const };
  const inputSubmitted = { kind: "in_place" as const, state: "submitted" as const, sessionId: "native", harness: "claude" as const, via: "tmux" as const, location: "%1" };
  expect(validateScoutSessionReplyResult(expected, { conversationId: "dm", inputSubmitted })).toEqual({ kind: "in_place", receipt: inputSubmitted });
  expect(validateScoutSessionReplyResult(expected, { conversationId: "dm", flight: { id: "flight" } })).toEqual({ kind: "resumed", sessionId: "native", flightId: "flight" });
  for (const result of [{}, { conversationId: "dm" }, { conversationId: "dm", inputSubmitted: { ...inputSubmitted, sessionId: "wrong" } }, { conversationId: "dm", inputSubmitted: { ...inputSubmitted, harness: "codex" as const } }]) {
    expect(() => validateScoutSessionReplyResult(expected, result)).toThrow("delivery_unconfirmed");
  }
});


test("native client refuses malformed acceptance and never invents a replacement key", async () => {
  let posts = 0;
  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (new URL(request.url).pathname === "/v1/node") return Response.json({ id: "node-1", capabilities: [SCOUT_SESSION_INPUT_RECEIPTS_CAPABILITY] });
    posts++;
    return Response.json({ kind: "delivery", accepted: true, conversation: { id: "dm" }, message: { id: "m" }, receipt: {} });
  }) as typeof fetch;
  const prepared = prepareScoutSessionReply(replyInput);
  await expect(deliverScoutRequest(broker, { ...prepared, requestId: undefined })).rejects.toThrow("request_id_required");
  expect(posts).toBe(0);
  await expect(deliverScoutRequest(broker, prepared)).rejects.toThrow("delivery_unconfirmed");
  expect(posts).toBe(1);
});

test("exported ordinary ask delegates retained keys while preserving unkeyed compatibility", async () => {
  const directory = await mkdtemp(join(tmpdir(), "exported-delivery-client-"));
  const keys = ["HOME", "OPENSCOUT_HOME", "OPENSCOUT_SUPPORT_DIRECTORY", "OPENSCOUT_CONTROL_HOME", "OPENSCOUT_RELAY_HUB", "OPENSCOUT_BROKER_URL", "OPENSCOUT_BROKER_SOCKET_PATH", "OPENSCOUT_BROKER_SOCKET_ONLY"];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) process.env[key] = directory;
  process.env.OPENSCOUT_BROKER_URL = broker.baseUrl;
  process.env.OPENSCOUT_BROKER_SOCKET_PATH = join(directory, "absent.sock");
  delete process.env.OPENSCOUT_BROKER_SOCKET_ONLY;
  try {
    const posts: ScoutDeliverRequest[] = [];
    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const path = new URL(request.url).pathname;
      if (path === "/health") return Response.json({ ok: true });
      if (path === "/v1/node") return Response.json({ id: "node-1" });
      if (path === "/v1/snapshot") return Response.json({ actors: { operator: { id: "operator", kind: "person" } },
        agents: { kepler: { id: "kepler", kind: "agent", handle: "kepler", state: "idle" } }, endpoints: {}, conversations: {}, messages: {} });
      if (path !== "/v1/deliver") throw new Error(`unexpected write: ${path}`);
      posts.push(await request.json() as ScoutDeliverRequest);
      return Response.json({ kind: "delivery", accepted: true, conversation: { id: "dm" }, message: { id: "m" }, receipt: {} });
    }) as typeof fetch;
    const input = { senderId: "operator", targetLabel: "kepler", body: "inspect" };
    await askExportedScoutQuestion({ ...input, clientMessageId: " retained " });
    await askExportedScoutQuestion({ ...input, clientMessageId: "retained" });
    expect(posts[1]).toEqual(posts[0]);
    expect(posts[0]?.requestId).toMatch(/^deliver-client-/);
    expect(posts[0]?.createdAt).toBeUndefined();
    await askExportedScoutQuestion(input);
    expect(posts[2]?.requestId).toBeUndefined();
    expect(posts[2]?.createdAt).toBeNumber();
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
    await rm(directory, { recursive: true, force: true });
  }
});
