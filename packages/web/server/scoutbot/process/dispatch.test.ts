import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import { describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createInMemoryTransportPair } from "@earendil-works/pi-mcp/testing";
import { StdioTransport, type CallToolResult, type McpTransport } from "@earendil-works/pi-mcp";
import { createScoutbotBrain, openBunSqliteStorage } from "../../scoutbot-brain.ts";
import { ScoutbotThreadMapStore } from "../thread-map.ts";
import { ScoutbotDispatchJournal, dispatchKey } from "./dispatch-journal.ts";
import { createScoutbotMcp } from "./scout-mcp.ts";
import { createScoutbotProcess, createScoutbotBrainConversationMap } from "./scoutbot-process.ts";
import type { ScoutbotBrokerLink } from "./broker-link.ts";

const names = ["ask", "messages_send", "agents_search", "agents_resolve", "sessions_inventory", "broker_feed", "invocations_get", "whoami"];
const askArgs = { projectPath: "/repo", harness: "codex", body: "Run typecheck" };
const accepted: CallToolResult = { content: [{ type: "text", text: "dispatched" }], structuredContent: { ok: true, ids: { flightId: "flt-1", invocationId: "inv-1" } } };
function memoryServer(handle: (name: string, args: Record<string, unknown>, server: McpTransport) => Promise<CallToolResult>) {
  return () => {
    const pair = createInMemoryTransportPair();
    void pair.server.start();
    pair.server.onMessage(message => {
      if (!("id" in message) || !("method" in message)) return;
      void (async () => {
        let result: unknown;
        if (message.method === "initialize") result = { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "test-scout", version: "1" } };
        else if (message.method === "tools/list") result = { tools: names.map(name => ({ name, description: name, inputSchema: { type: "object", properties: { body: { type: "string" }, projectPath: { type: "string" }, harness: { type: "string" }, targetLabel: { type: "string" }, profile: { type: "string" }, senderId: { type: "string" } } } })) };
        else if (message.method === "tools/call") {
          const params = message.params as { name: string; arguments: Record<string, unknown> };
          result = await handle(params.name, params.arguments, pair.server);
        } else result = {};
        await pair.server.send({ jsonrpc: "2.0", id: message.id, result });
      })().catch(() => undefined);
    });
    return pair.client;
  };
}
function sourceTurn() { return { sourceMessageId: "source-1", threadId: "thread-1", brokerConversationId: "conversation-1", conversationId: 1, body: "dispatch", model: "faux-1", actorId: "operator" }; }

function brokerFixture() {
  const snapshot: Record<string, any> = { actors: {}, agents: {}, endpoints: {}, conversations: {}, messages: {} };
  const posted = new Map<string, any>();
  let receipt: unknown = null;
  const broker: ScoutbotBrokerLink = {
    socketPath: "/throwaway/broker.sock",
    getJson: async <T,>(path: string) => {
      if (path === "/v1/node") return { id: "node-1" } as T;
      if (path.startsWith("/v1/snapshot")) return snapshot as T;
      if (path.startsWith("/v1/request-receipts/")) return { receipt } as T;
      throw new Error(path);
    },
    postJson: async <T,>(path: string, body: any) => {
      if (path === "/v1/messages") {
        if (!posted.has(body.id)) posted.set(body.id, body);
        snapshot.messages[body.id] = posted.get(body.id);
      }
      return { ok: true } as T;
    },
    streamEvents: async () => undefined,
  };
  return { broker, posted, snapshot, setReceipt: (value: unknown) => { receipt = value; } };
}
const completedReceipt = () => ({ state: "done", result: { kind: "delivery", message: { id: "msg-ask" }, conversation: { id: "worker-thread" }, flight: { id: "flt-1", invocationId: "inv-1" } } });

describe("Scoutbot plain MCP dispatch durability", () => {
  test("SIGKILL during a replay-safe Pi tool retains its call id and input request id", async () => {
    const directory = mkdtempSync(join(tmpdir(), "scoutbot-pi-replay-"));
    const child = spawn(process.execPath, [fileURLToPath(new URL("./fixtures/replay-child.ts", import.meta.url)), directory], { stdio: ["ignore", "ignore", "pipe"] });
    let childError = ""; child.stderr!.on("data", chunk => { childError += chunk; });
    let brain: ReturnType<typeof createScoutbotBrain> | undefined;
    try {
      for (let i = 0; i < 200 && !existsSync(join(directory, "in-flight")); i++) await Bun.sleep(10);
      expect(existsSync(join(directory, "in-flight")), childError).toBe(true);
      const exited = new Promise(resolve => child.once("exit", resolve));
      child.kill("SIGKILL"); await exited;
      const conversationId = Number(readFileSync(join(directory, "conversation"), "utf8"));
      const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
      faux.setResponses([fauxAssistantMessage("Recovered.")]);
      const models = createModels(); models.setProvider(faux.provider);
      brain = createScoutbotBrain({ currentDirectory: directory, models, provider: "faux", openStorage: () => openBunSqliteStorage(join(directory, "brain.sqlite")), tools: async () => [defineTool({
        name: "ask", description: "test", parameters: Type.Object({ body: Type.String() }), replay: "safe",
        execute: async (_args, api) => {
          appendFileSync(join(directory, "call-ids"), `${api.callId}\n`);
          return { content: [{ type: "text", text: "original receipt" }] };
        },
      })] });
      const reply = await brain.reply({ conversationId, requestId: "source-1", body: "build", model: "faux-1", systemPrompt: "test" });
      expect(reply.text).toBe("Recovered.");
      expect(readFileSync(join(directory, "call-ids"), "utf8").trim().split("\n")).toEqual(["stable-pi-call", "stable-pi-call"]);
      expect(faux.state.callCount).toBe(1);
    } finally { child.kill("SIGKILL"); await brain?.close(); rmSync(directory, { recursive: true, force: true }); }
  }, 10000);

  test("faux Pi turn calls ask then returns; a Pi background task submits and publishes the recorded flight result", async () => {
    const directory = mkdtempSync(join(tmpdir(), "scoutbot-dispatch-"));
    const journal = new ScoutbotDispatchJournal(join(directory, "journal.sqlite"));
    const fake = brokerFixture();
    let asks = 0; let waits = 0;
    const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
    faux.setResponses([fauxAssistantMessage(fauxToolCall("ask", askArgs, { id: "original-call" }), { stopReason: "toolUse" }), fauxAssistantMessage("Dispatched."), fauxAssistantMessage("Typecheck passed.")]);
    const models = createModels(); models.setProvider(faux.provider);
    let scoutbot: ReturnType<typeof createScoutbotProcess>;
    const mcp = createScoutbotMcp({ broker: fake.broker, journal, currentDirectory: directory,
      onDispatch: async (flight, conversation) => brain.startBackground?.(flight, conversation),
      transport: memoryServer(async (name, args) => {
        expect(args.senderId).toBe("scoutbot");
        if (name === "ask") { asks++; expect(args.replyMode).toBe("none"); expect(args.placement).toBe("background"); expect(args.profile).toBeUndefined(); fake.setReceipt(completedReceipt()); return accepted; }
        waits++; return { content: [], structuredContent: { flight: { id: "flt-1", state: "completed", result: { text: "typecheck passed" } } } };
      }),
    });
    const brain = createScoutbotBrain({ currentDirectory: directory, models, provider: "faux", tools: () => mcp.tools(),
      openStorage: () => openBunSqliteStorage(join(directory, "brain.sqlite")), backgroundWork: (flight, signal) => scoutbot.reportFlight(flight, signal) });
    const threads = new ScoutbotThreadMapStore(join(directory, "threads.json"));
    scoutbot = createScoutbotProcess({ broker: fake.broker, brain, journal, mcp, currentDirectory: directory, threads,
      model: "faux-1", conversations: createScoutbotBrainConversationMap(join(directory, "bindings.json")) });
    try {
      await scoutbot.bootstrap();
      const thread = (await threads.list()).threads[0]!;
      await scoutbot.handleMessage({ id: "source-1", conversationId: thread.conversationId!, actorId: "operator", originNodeId: "node-1", class: "agent", body: "Dispatch the build", audience: { notify: ["scoutbot"] }, visibility: "private", policy: "durable", createdAt: 1 } as any);
      for (let i = 0; i < 200 && journal.waiter("flt-1")?.stage !== "published"; i++) await Bun.sleep(10);
      expect(journal.waiter("flt-1")?.stage).toBe("published");
      expect(asks).toBe(1); expect(waits).toBe(1);
      expect([...fake.posted.values()].map(message => message.body)).toEqual(["Dispatched.", "Typecheck passed."]);
      expect(journal.calls()[0]!.callId).toBe("original-call");
    } finally { await brain.close(); await mcp.close(); journal.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  test.each(["broker accepted before waiter persistence", "waiter saved before tool result", "waiter saved before submission", "terminal flight reply unpublished", "submission completed before publication"])("recovers %s without another ask or reply", async boundary => {
    const directory = mkdtempSync(join(tmpdir(), "scoutbot-crash-"));
    let journal = new ScoutbotDispatchJournal(join(directory, "journal.sqlite"));
    const turn = sourceTurn(); journal.activate(turn);
    const effective = { ...askArgs, replyMode: "none", placement: "background" };
    const key = dispatchKey(turn.sourceMessageId, "ask", effective);
    journal.saveCall({ key, sourceMessageId: turn.sourceMessageId, conversationId: 1, tool: "ask", args: effective, callId: "persisted-call", state: "unknown" });
    if (boundary !== "broker accepted before waiter persistence") journal.saveWaiter({ ...turn, flightId: "flt-1", stage: boundary === "submission completed before publication" ? "submitted" : "completed", result: { flight: { state: "completed" } }, ...(boundary === "submission completed before publication" ? { text: "Result." } : {}) });
    journal.close(); journal = new ScoutbotDispatchJournal(join(directory, "journal.sqlite"));
    const fake = brokerFixture(); fake.setReceipt(completedReceipt());
    let asks = 1;
    let submissions = 0;
    const mcp = createScoutbotMcp({ broker: fake.broker, journal, currentDirectory: directory, onDispatch: async () => undefined,
      transport: memoryServer(async name => { if (name === "ask") asks++; return { content: [], structuredContent: { flight: { state: "completed" } } }; }) });
    const brain = { reply: async (input: any) => { expect(input.requestId).toBe("flight:flt-1"); submissions++; return { conversationId: 1, text: "Result.", usage: null }; }, close: async () => undefined };
    const process = createScoutbotProcess({ broker: fake.broker, brain, journal, mcp, currentDirectory: directory, threads: new ScoutbotThreadMapStore(join(directory, "threads.json")), conversations: createScoutbotBrainConversationMap(join(directory, "bindings.json")) });
    try {
      await mcp.reconcilePending();
      await process.reportFlight("flt-1", new AbortController().signal);
      // Simulate lost publication acknowledgement after the broker committed its message.
      journal.saveWaiter({ ...journal.waiter("flt-1")!, stage: "submitted" });
      await process.reportFlight("flt-1", new AbortController().signal);
      expect(asks).toBe(1); expect(fake.posted.size).toBe(1);
      expect(journal.waiter("flt-1")?.stage).toBe("published");
      expect(submissions).toBe(boundary === "submission completed before publication" ? 0 : 1);
    } finally { await mcp.close(); journal.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  test("SIGKILL only the stdio MCP child after acceptance leaves one ask and recovers its receipt", async () => {
    const directory = mkdtempSync(join(tmpdir(), "scoutbot-stdio-loss-"));
    const journal = new ScoutbotDispatchJournal(join(directory, "journal.sqlite")); journal.activate(sourceTurn());
    const fake = brokerFixture();
    let transport: StdioTransport;
    const mcp = createScoutbotMcp({ broker: fake.broker, journal, currentDirectory: directory, onDispatch: async () => undefined,
      transport: () => transport = new StdioTransport({ command: process.execPath,
        args: [fileURLToPath(new URL("./fixtures/mcp-child.ts", import.meta.url)), directory] }),
    });
    try {
      const tool = (await mcp.tools()).find(tool => tool.name === "ask")!;
      const context = { abortSignal: new AbortController().signal } as any;
      const pending = tool.execute(askArgs, { conversationId: 1, callId: "first" } as any, context).then(() => null, error => error as Error);
      for (let i = 0; i < 200 && !existsSync(join(directory, "accepted.json")); i++) await Bun.sleep(10);
      expect(existsSync(join(directory, "accepted.json"))).toBe(true);
      const recorded = JSON.parse(readFileSync(join(directory, "accepted.json"), "utf8"));
      expect(recorded.arguments.senderId).toBe("scoutbot");
      fake.setReceipt(completedReceipt());
      process.kill(transport!.pid!, "SIGKILL");
      expect((await pending)?.message).toContain("Outcome unknown");
      await tool.execute(askArgs, { conversationId: 1, callId: "model-retry" } as any, context);
      expect(journal.calls()).toHaveLength(1);
      expect(journal.waiter("flt-1")).toBeDefined();
      expect(journal.calls()[0]!.state).toBe("done");
    } finally { await mcp.close(); journal.close(); rmSync(directory, { recursive: true, force: true }); }
  }, 10000);

  test("MCP transport dies after acceptance: model retry gets original key/receipt, not a new ask", async () => {
    const directory = mkdtempSync(join(tmpdir(), "scoutbot-child-loss-"));
    const journal = new ScoutbotDispatchJournal(join(directory, "journal.sqlite")); journal.activate(sourceTurn());
    const fake = brokerFixture(); let asks = 0;
    const mcp = createScoutbotMcp({ broker: fake.broker, journal, currentDirectory: directory, onDispatch: async () => undefined,
      transport: memoryServer(async (name, _args, server) => {
        if (name === "ask") { asks++; fake.setReceipt(completedReceipt()); await server.close(); }
        return accepted;
      }) });
    try {
      const tool = (await mcp.tools()).find(tool => tool.name === "ask")!;
      const context = { abortSignal: new AbortController().signal } as any;
      await expect(tool.execute(askArgs, { conversationId: 1, callId: "first-call" } as any, context)).rejects.toThrow("Outcome unknown");
      expect(journal.calls()[0]!.state).toBe("unknown");
      await tool.execute(askArgs, { conversationId: 1, callId: "new-model-call" } as any, context);
      expect(asks).toBe(1); expect(journal.calls()).toHaveLength(1); expect(journal.waiter("flt-1")).toBeDefined();
      expect(tool.parameters.properties).not.toHaveProperty("profile");
      expect(tool.parameters.properties).not.toHaveProperty("senderId");
    } finally { await mcp.close(); journal.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});
