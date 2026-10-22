import { resolveBrokerServiceConfig } from "@openscout/runtime/broker-process-manager";
import { fileURLToPath } from "node:url";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolRegistration } from "@earendil-works/pi-durable";
import { McpClient, StdioTransport, toLlmContent, type McpTransport, type CallToolResult } from "@earendil-works/pi-mcp";
import type { ScoutbotBrokerLink } from "./broker-link.ts";
import { dispatchKey, type ScoutbotDispatchJournal, type DispatchCall } from "./dispatch-journal.ts";

const READ_TOOLS = ["agents_search", "agents_resolve", "sessions_inventory", "broker_feed", "invocations_get", "whoami"];
export type ScoutbotMcp = ReturnType<typeof createScoutbotMcp>;
export function createScoutbotMcp(options: {
  broker: ScoutbotBrokerLink; journal: ScoutbotDispatchJournal; currentDirectory: string;
  transport?: () => McpTransport;
  onDispatch: (flightId: string, conversationId: number) => Promise<void>;
}) {
  let client: McpClient | undefined;
  let connecting: Promise<McpClient> | undefined;
  let stopped = false;
  const connect = async () => {
    if (stopped) throw new Error("Scout MCP is stopped");
    if (client?.connectionState === "connected") return client;
    if (connecting) return connecting;
    connecting = (async () => {
      const candidate = new McpClient({ name: "scout-bot", version: "1", requestTimeoutMs: 45_000 });
      // Source CLI avoids a stale dist bundle. mcp is excluded from CLI freshness/restart maintenance.
      const entry = fileURLToPath(new URL("../../../../cli/src/cli/main.ts", import.meta.url));
      const transport = options.transport?.() ?? new StdioTransport({
        command: process.execPath, args: [entry, "mcp", "--context-root", options.currentDirectory],
        cwd: options.currentDirectory,
        env: { OPENSCOUT_AGENT: "scoutbot", OPENSCOUT_BROKER_SOCKET_ONLY: "1", OPENSCOUT_BROKER_SOCKET_PATH: options.broker.socketPath,
          OPENSCOUT_BROKER_URL: process.env.OPENSCOUT_BROKER_URL || resolveBrokerServiceConfig().brokerUrl,
          CODEX_THREAD_ID: "", OPENSCOUT_CODEX_THREAD_ID: "", OPENSCOUT_SESSION_ID: "", OPENSCOUT_REPLY_CONTEXT: "", OPENSCOUT_REPLY_CONTEXT_FILE: "", SCOUT_REPLY_CONTEXT: "" },
        onStderr: chunk => console.warn("[scoutbot mcp]", chunk.trim()),
      });
      await candidate.connect(transport).catch(async error => { await candidate.close(); throw error; });
      client = candidate;
      candidate.onClose(() => {
        if (client === candidate) client = undefined;
        // Only reconnect. Never retry a failed mutation because its child restarted.
        if (!stopped) setTimeout(() => void connect().catch(error => console.warn("[scoutbot mcp] reconnect:", error)), 1000).unref();
      });
      return candidate;
    })();
    try { return await connecting; } finally { connecting = undefined; }
  };
  const call = async (name: string, args: Record<string, unknown>, signal?: AbortSignal) =>
    (await connect()).callTool(name, { ...args, senderId: "scoutbot", currentDirectory: options.currentDirectory }, { signal });

  const register = async (record: DispatchCall, receipt: CallToolResult) => {
    const structured = receipt.structuredContent as Record<string, unknown> | undefined;
    const ids = structured?.ids as Record<string, unknown> | undefined;
    const flightId = ids?.flightId ?? structured?.flightId;
    if (record.tool === "ask" && typeof flightId === "string") {
      const turn = options.journal.turn(record.sourceMessageId);
      if (!turn) throw new Error("Missing dispatch source binding");
      if (!options.journal.waiter(flightId)) options.journal.saveWaiter({ ...turn, flightId, stage: "dispatched" });
      await options.onDispatch(flightId, record.conversationId);
    }
    options.journal.saveCall({ ...record, state: "done", receipt });
    return receipt;
  };
  const reconcile = async (record: DispatchCall): Promise<CallToolResult | undefined> => {
    if (record.state === "done") {
      // Also repairs a lost task registration, without resetting a progressed waiter.
      return register(record, record.receipt!);
    }
    const { receipt } = await options.broker.getJson<{ receipt: { state: string; result?: Record<string, unknown> } | null }>(
      `/v1/request-receipts/${encodeURIComponent(record.key)}?requesterId=scoutbot&operation=deliver`);
    if (!receipt) return undefined; // broker has not reserved it; same-key submission is safe
    if (receipt.state !== "done") throw new Error(`Outcome unknown for ${record.key}; broker has reserved it. Do not replace this dispatch.`);
    const delivery = receipt.result;
    if (delivery?.kind !== "delivery") {
      return register(record, { isError: true, content: [{ type: "text", text: JSON.stringify(delivery) }], structuredContent: delivery });
    }
    const flight = delivery.flight as Record<string, unknown> | undefined;
    const message = delivery.message as Record<string, unknown> | undefined;
    const conversation = delivery.conversation as Record<string, unknown> | undefined;
    const ids = { flightId: flight?.id, invocationId: flight?.invocationId, messageId: message?.id, conversationId: conversation?.id };
    const structuredContent = { ok: true, state: "queued", usedBroker: true, ids, flightId: flight?.id, messageId: message?.id };
    return register(record, { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent });
  };
  const mutate = async (tool: "ask" | "messages_send", args: Record<string, unknown>, conversationId: number, callId: string, signal?: AbortSignal) => {
    const turn = options.journal.active(conversationId);
    if (!turn) throw new Error("Missing durable source-message binding; dispatch refused");
    const effective = { ...args, ...(tool === "ask" ? { replyMode: "none", placement: "background" } : {}) };
    const key = dispatchKey(turn.sourceMessageId, tool, effective);
    // A differently worded model retry must not replace an unresolved call.
    for (const pending of options.journal.calls().filter(c => c.state !== "done")) {
      const recovered = await reconcile(pending);
      if (pending.key !== key) {
        if (recovered) return recovered; // acknowledge the recovered work before accepting any replacement
        throw new Error(`Outcome unknown for ${pending.key}; reconcile before replacement dispatch.`);
      }
    }
    const prior = options.journal.call(key);
    if (prior) {
      const recovered = await reconcile(prior);
      if (recovered) return recovered;
    }
    const record: DispatchCall = prior ?? { key, tool, args: effective, sourceMessageId: turn.sourceMessageId, conversationId, callId, state: "intent" };
    options.journal.saveCall(record); // durable BEFORE submission, including model retries
    try {
      const receipt = await call(tool, { ...effective, requestId: key }, signal);
      const structured = receipt.structuredContent as Record<string, unknown> | undefined;
      if (receipt.isError || structured?.usedBroker === false || (structured?.error as { code?: string } | undefined)?.code === "broker_unreachable") {
        throw new Error(JSON.stringify(receipt));
      }
      return await register(record, receipt);
    } catch (error) {
      options.journal.saveCall({ ...record, state: "unknown" });
      throw new Error(`Outcome unknown for ${key}; reconcile by key before replacement. ${String(error)}`);
    }
  };
  return {
    connect,
    call,
    reconcilePending: async () => {
      for (const record of options.journal.calls().filter(c => c.state !== "done")) await reconcile(record);
    },
    tools: async (): Promise<ToolRegistration[]> => {
      const available = await (await connect()).listTools();
      const names = [...READ_TOOLS, "ask", "messages_send"];
      return names.map(name => {
        const source = available.find(tool => tool.name === name);
        if (!source) throw new Error(`Scout MCP is missing ${name}`);
        // Identity, caller wait, runtime profile/permission, and lifecycle overrides are host-owned.
        const schema = structuredClone(source.inputSchema);
        const properties = (schema.properties ?? {}) as Record<string, unknown>;
        for (const field of ["senderId", "requesterId", "currentDirectory", "requestId", "profile", "permission", "permissionProfile", "replyMode", "replyToSessionId", "wait", "timeoutSeconds", "placement", "wake", "interaction", "workItem"]) delete properties[field];
        if (name === "messages_send") {
          for (const field of Object.keys(properties)) if (!["body", "targetLabel", "channel", "shouldSpeak"].includes(field)) delete properties[field];
          schema.required = ["body", "targetLabel"];
        } else schema.required = (Array.isArray(schema.required) ? schema.required as string[] : []).filter(field => field in properties);
        schema.properties = properties;
        schema.additionalProperties = false;
        return defineTool({
          name, description: source.description ?? name, parameters: Type.Unsafe<Record<string, unknown>>(schema), replay: "safe", executionMode: "sequential",
          execute: async (args, api, context) => {
            const result = name === "ask" || name === "messages_send"
              ? await mutate(name, args, api.conversationId as number, api.callId, context.abortSignal)
              : await call(name, args, context.abortSignal);
            return { content: toLlmContent(result), isError: result.isError };
          },
        });
      });
    },
    close: async () => { stopped = true; const current = client ?? await connecting?.catch(() => undefined); client = undefined; await current?.close(); },
  };
}
