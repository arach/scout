import { closeSync, fsyncSync, openSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";

import type { ActorIdentity } from "@openscout/protocol";
import { resolveOperatorName } from "@openscout/runtime/user-config";
import { resolveOpenScoutSupportPaths } from "@openscout/runtime/support-paths";

import type {
  ScoutBrokerAgentRecord,
  ScoutBrokerEndpointRecord,
  ScoutBrokerMessageRecord,
  ScoutBrokerNodeRecord,
  ScoutBrokerSnapshot,
} from "../../core/broker/service.ts";
import type { ScoutbotBrain } from "../../scoutbot-brain.ts";
import { prefilterHandle } from "../prefilter.ts";
import { handleDiagnosticCommand } from "../report.ts";
import {
  SCOUTBOT_AGENT_ID,
  SCOUTBOT_DISPLAY_NAME,
  SCOUTBOT_HANDLE,
  scoutbotProvenance,
} from "../role.ts";
import {
  buildScoutbotThreadConversation,
  ScoutbotThreadMapStore,
  type ScoutbotThreadRecord,
} from "../thread-map.ts";
import { parseSseBlock, type ScoutbotBrokerLink } from "./broker-link.ts";
import { replyMessageId, type ScoutbotDispatchJournal } from "./dispatch-journal.ts";
import type { ScoutbotMcp } from "./scout-mcp.ts";

/**
 * Scoutbot as its own process: registers itself with the broker, watches the
 * broker's event stream for messages addressed to it in a Scoutbot thread,
 * and answers through the Pi brain. Everything goes over the broker socket.
 */

export const SCOUTBOT_PROCESS_ENDPOINT_ID = "endpoint.scoutbot.process";
export const SCOUTBOT_PROCESS_DEFAULT_MODEL = "gpt-5.6-luna";

export const SCOUTBOT_PROCESS_SYSTEM_PROMPT = [
  "You are Scout, the operator's assistant inside OpenScout. You answer in a chat thread with the operator.",
  "Each request carries a live snapshot of the Scout control plane (agents, endpoints, work in flight). Use it to answer state questions concretely; it reflects this moment only.",
  "You can read files, find files, inspect Scout and dispatch work with ask. Use messages_send only for FYIs, not owned work. You act as scoutbot, never the operator.",
  "For fresh work use projectPath plus harness/runtime, not a guessed agent name. Newly dispatched work runs in background placement. You cannot run commands yourself.",
  "Dispatch returns quickly; say it was dispatched only when the receipt confirms it. Flight results arrive later in this same thread. Never wait inside the turn.",
  "A tool outcome unknown is not a failed dispatch: do not replace it or change the request to retry. Recovery reconciles the original key.",
  "Answer ordinary questions directly. Keep answers short unless the operator asks for detail.",
].join("\n");

export type ScoutbotProcessLog = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

export type ScoutbotProcessOptions = {
  broker: ScoutbotBrokerLink;
  brain: ScoutbotBrain;
  journal?: ScoutbotDispatchJournal;
  mcp?: ScoutbotMcp;
  currentDirectory: string;
  threads?: ScoutbotThreadMapStore;
  conversations?: ScoutbotBrainConversationMap;
  model?: string;
  log?: ScoutbotProcessLog;
  now?: () => number;
};

export type ScoutbotProcess = {
  /** Registers Scoutbot and makes sure its default thread exists. */
  bootstrap: () => Promise<void>;
  reportFlight: (flightId: string, signal: AbortSignal) => Promise<void>;
  /** Follows the event stream until `signal` aborts, reconnecting with backoff. */
  run: (signal: AbortSignal) => Promise<void>;
  /** One message from the stream; exposed for tests. */
  handleMessage: (message: ScoutBrokerMessageRecord) => Promise<void>;
};

type Snapshot = ScoutBrokerSnapshot & {
  endpoints?: Record<string, ScoutBrokerEndpointRecord>;
  flights?: Record<string, { id: string; targetAgentId?: string; state?: string; startedAt?: number; summary?: string }>;
  messages?: Record<string, ScoutBrokerMessageRecord>;
};

const defaultLog: ScoutbotProcessLog = {
  info: (message) => console.log(`[scoutbot] ${message}`),
  warn: (message) => console.warn(`[scoutbot] ${message}`),
};

export function createScoutbotProcess(options: ScoutbotProcessOptions): ScoutbotProcess {
  const { broker, brain } = options;
  const log = options.log ?? defaultLog;
  const now = options.now ?? Date.now;
  const threads = options.threads ?? new ScoutbotThreadMapStore();
  const conversations = options.conversations ?? createScoutbotBrainConversationMap();
  // Replays after a reconnect, and the turn already running, answer once.
  const handled = new Set<string>();
  const turns = new Map<string, Promise<void>>();

  const readNode = () => broker.getJson<ScoutBrokerNodeRecord>("/v1/node");
  const readSnapshot = () => broker.getJson<Snapshot>(`/v1/snapshot?since=${Math.trunc(now() - 24 * 60 * 60_000)}`);

  const ensureOperatorActor = async (snapshot: Snapshot) => {
    // The DM's member rows have a foreign key on actors.
    if (snapshot.actors?.[OPERATOR_ID]) return;
    await broker.postJson("/v1/actors", buildOperatorActor());
  };

  const bootstrap = async () => {
    const node = await readNode();
    const snapshot = await readSnapshot();
    if (!snapshot.actors?.[SCOUTBOT_AGENT_ID]) {
      await broker.postJson("/v1/actors", buildScoutbotActor());
    }
    await broker.postJson("/v1/agents", buildScoutbotAgent(node.id));
    const endpoint = buildScoutbotProcessEndpoint(node.id, options.currentDirectory, now());
    await broker.postJson("/v1/endpoints", endpoint);
    // The in-web runner's Codex endpoint outranks a local socket for delivery,
    // so this process retires it.
    for (const stale of Object.values(snapshot.endpoints ?? {})) {
      if (stale.agentId !== SCOUTBOT_AGENT_ID || stale.id === endpoint.id || stale.state === "offline") continue;
      await broker.postJson("/v1/endpoints", { ...stale, state: "offline" });
      log.info(`retired endpoint ${stale.id}`);
    }
    const thread = await threads.ensureDefaultThread({ snapshot, transport: "local_socket" });
    const conversation = buildScoutbotThreadConversation(thread, snapshot, node.id);
    if (conversation && !snapshot.conversations?.[conversation.id]) {
      await ensureOperatorActor(snapshot);
      await broker.postJson("/v1/conversations", conversation);
    }
    log.info(`registered on ${broker.socketPath} as ${SCOUTBOT_AGENT_ID} (node ${node.id})`);
  };

  const answer = async (message: ScoutBrokerMessageRecord, thread: ScoutbotThreadRecord) => {
    const [node, snapshot] = await Promise.all([readNode(), readSnapshot()]);
    if (Object.values(snapshot.messages ?? {}).some((candidate) =>
      candidate.id === replyMessageId(message.id))) {
      const turn = options.journal?.turn(message.id);
      if (turn) options.journal!.saveTurn({ ...turn, published: true });
      return;
    }
    const conversation = snapshot.conversations?.[message.conversationId];
    const prompt = stripScoutbotAddress(message.body);
    const reply = (body: string, metadata: Record<string, unknown>) => broker.postJson("/v1/messages", {
      id: replyMessageId(message.id),
      conversationId: message.conversationId,
      actorId: SCOUTBOT_AGENT_ID,
      originNodeId: node.id,
      class: "agent",
      body,
      replyToMessageId: message.id,
      audience: { notify: [message.actorId], reason: "reply" },
      visibility: conversation?.visibility ?? "private",
      policy: "durable",
      createdAt: now(),
      metadata: {
        ...scoutbotProvenance({ requestedBy: message.actorId, sourceMessageId: message.id }),
        scoutbotThreadId: thread.threadId,
        ...metadata,
        clientMessageId: replyMessageId(message.id),
      },
    });

    const prefilter = prefilterHandle(prompt, snapshot);
    if (prefilter) {
      const rule = prefilter.metadata.matched_rule;
      if (rule === "slash.report" || rule === "slash.feedback") {
        prefilter.body = await handleDiagnosticCommand(prompt);
      }
      await reply(prefilter.body, { ...prefilter.metadata, sourcePath: "scoutbot-prefilter" });
      log.info(`prefilter reply rule=${rule} source=${message.id}`);
      return;
    }

    const model = thread.model?.trim() || options.model || SCOUTBOT_PROCESS_DEFAULT_MODEL;
    const started = now();
    try {
      const bound = options.journal?.turn(message.id);
      const conversationId = bound?.conversationId ?? (brain.ensureConversation
        ? await brain.ensureConversation({ conversationId: conversations.get(thread.threadId), model, systemPrompt: SCOUTBOT_PROCESS_SYSTEM_PROMPT })
        : conversations.get(thread.threadId));
      if (conversationId !== null) conversations.set(thread.threadId, conversationId);
      if (options.journal && conversationId !== null) options.journal.activate(bound ?? {
        sourceMessageId: message.id, threadId: thread.threadId, brokerConversationId: message.conversationId,
        conversationId, body: prompt, model, actorId: message.actorId,
      });
      const result = bound?.text !== undefined
        ? { conversationId: bound.conversationId, text: bound.text, usage: null }
        : await brain.reply({
        conversationId,
        requestId: message.id,
        body: prompt,
        state: renderScoutbotState(snapshot, now()),
        model,
        systemPrompt: SCOUTBOT_PROCESS_SYSTEM_PROMPT,
      });
      conversations.set(thread.threadId, result.conversationId);
      const text = result.text.trim();
      const turn = options.journal?.turn(message.id);
      if (turn) options.journal!.saveTurn({ ...turn, text: text || "I came back with an empty answer. Try asking again." });
      await reply(text || "I came back with an empty answer. Try asking again.", {
        sourcePath: "scoutbot-brain",
        model,
        brainConversationId: result.conversationId,
        ...(result.usage?.totalTokens != null ? { totalTokens: result.usage.totalTokens } : {}),
      });
      if (turn) options.journal!.saveTurn({ ...turn, text: text || "I came back with an empty answer. Try asking again.", published: true });
      log.info(`answered source=${message.id} model=${model} ms=${now() - started}`);
    } catch (error) {
      if (options.journal?.turn(message.id)?.text !== undefined) throw error;
      // A thread that never gets a reply stays "pending" for the composer, so
      // a failed turn still answers.
      log.warn(`brain failed source=${message.id}: ${describeError(error)}`);
      const failedTurn = options.journal?.turn(message.id);
      const errorText = `I couldn't answer that: ${describeError(error)}`;
      if (failedTurn) options.journal!.saveTurn({ ...failedTurn, text: errorText });
      await reply(errorText, {
        sourcePath: "scoutbot-brain",
        model,
        error: true,
      });
      if (failedTurn) options.journal!.saveTurn({ ...failedTurn, text: errorText, published: true });
    }
  };

  const enqueue = async (threadId: string, work: () => Promise<void>) => {
    const previous = turns.get(threadId) ?? Promise.resolve();
    const turn = previous.catch(() => undefined).then(work);
    turns.set(threadId, turn);
    try { await turn; } finally { if (turns.get(threadId) === turn) turns.delete(threadId); }
  };
  const reportFlight = async (flightId: string, signal: AbortSignal) => {
    const journal = options.journal;
    if (!journal || !options.mcp) throw new Error("Flight reporter requires dispatch journal/MCP");
    let waiter = journal.waiter(flightId);
    if (!waiter || waiter.stage === "published") return;
    while (waiter.stage === "dispatched") {
      signal.throwIfAborted();
      try {
        const result = await options.mcp.call("invocations_wait", { flightId, timeoutSeconds: 10 }, signal);
        if (result.isError) throw new Error(JSON.stringify(result));
        const structured = result.structuredContent as { flight?: { state?: string } } | undefined;
        if (["completed", "failed", "cancelled"].includes(structured?.flight?.state ?? "")) {
          waiter = { ...waiter, stage: "completed", result: result.structuredContent ?? result };
          journal.saveWaiter(waiter);
          break;
        }
      } catch (error) {
        if (signal.aborted) throw error;
        log.warn(`wait ${flightId}: ${describeError(error)}`);
      }
      await sleep(1000, signal);
    }
    await enqueue(waiter.threadId, async () => {
      signal.throwIfAborted();
      let current = journal.waiter(flightId)!;
      if (current.stage === "published") return;
      if (current.stage === "completed") {
        journal.activate({ sourceMessageId: `flight:${flightId}`, threadId: current.threadId,
          brokerConversationId: current.brokerConversationId, conversationId: current.conversationId,
          body: `The dispatched flight ${flightId} finished. Tell the operator the result; do not dispatch it again.\n${JSON.stringify(current.result)}`,
          model: current.model, actorId: current.actorId });
        const answer = await brain.reply({ conversationId: current.conversationId,
          requestId: `flight:${flightId}`, body: journal.active(current.conversationId)!.body,
          model: current.model, systemPrompt: SCOUTBOT_PROCESS_SYSTEM_PROMPT, signal });
        current = { ...current, stage: "submitted", text: answer.text.trim() || "The flight finished without an answer." };
        journal.saveWaiter(current);
      }
      const node = await readNode();
      const id = replyMessageId(`flight:${flightId}`);
      await broker.postJson("/v1/messages", {
        id, actorId: SCOUTBOT_AGENT_ID, conversationId: current.brokerConversationId, originNodeId: node.id,
        class: "agent", body: current.text!, replyToMessageId: current.sourceMessageId,
        audience: { notify: [current.actorId], reason: "reply" }, visibility: "private", policy: "durable", createdAt: now(),
        metadata: { ...scoutbotProvenance({ requestedBy: current.actorId, sourceMessageId: current.sourceMessageId }),
          clientMessageId: id, scoutbotThreadId: current.threadId, sourcePath: "scoutbot-flight", flightId,
          brainConversationId: current.conversationId },
      });
      journal.saveWaiter({ ...current, stage: "published" });
    });
  };
  const handleMessage = async (message: ScoutBrokerMessageRecord) => {
    if (message.actorId === SCOUTBOT_AGENT_ID) return;
    if (!isAddressedToScoutbot(message)) return;
    if (handled.has(message.id)) return;
    const thread = await threads.getThreadByConversationId(message.conversationId);
    if (!thread) return;
    handled.add(message.id);
    if (handled.size > 2_000) handled.delete(handled.values().next().value!);
    try { await enqueue(thread.threadId, () => answer(message, thread)); }
    catch (error) { handled.delete(message.id); throw error; }
  };

  const run = async (signal: AbortSignal) => {
    let attempt = 0;
    let recovering = false;
    const recover = async () => {
      if (recovering || signal.aborted) return;
      recovering = true;
      try {
        // Queue durable operator turns before opening Pi: resumed reporters must
        // not overtake the unfinished input whose tools they report on.
        for (const turn of options.journal?.turns() ?? []) {
          if (turn.published || turn.sourceMessageId.startsWith("flight:") || handled.has(turn.sourceMessageId)) continue;
          handled.add(turn.sourceMessageId);
          void enqueue(turn.threadId, async () => {
            const thread = await threads.getThreadByConversationId(turn.brokerConversationId);
            if (!thread) throw new Error(`Missing recovered thread ${turn.threadId}`);
            await answer({ id: turn.sourceMessageId, conversationId: turn.brokerConversationId,
              actorId: turn.actorId, body: turn.body, audience: { notify: [SCOUTBOT_AGENT_ID] } } as ScoutBrokerMessageRecord, thread);
          }).catch(error => { handled.delete(turn.sourceMessageId); log.warn(`recover turn: ${describeError(error)}`); });
        }
        await options.mcp?.reconcilePending().catch(error => log.warn(`reconcile: ${describeError(error)}`));
        for (const waiter of options.journal?.waiters() ?? []) {
          if (waiter.stage !== "published") await brain.startBackground?.(waiter.flightId, waiter.conversationId);
        }
        // SSE does not promise gap-free reconnect delivery. Reconcile the inbox
        // too, including a source received before its Pi binding was journaled.
        const snapshot = await readSnapshot();
        for (const message of Object.values(snapshot.messages ?? {}).sort((a, b) => a.createdAt - b.createdAt)) {
          if (message.actorId !== SCOUTBOT_AGENT_ID && isAddressedToScoutbot(message)) {
            void handleMessage(message).catch(error => log.warn(`backlog: ${describeError(error)}`));
          }
        }
      } finally { recovering = false; }
    };
    await recover();
    const recoveryTimer = setInterval(() => void recover().catch(error => log.warn(describeError(error))), 5000);
    try { while (!signal.aborted) {
      try {
        await broker.streamEvents((block) => {
          attempt = 0;
          const event = parseSseBlock(block);
          if (event?.eventName !== "message.posted") return;
          const message = extractPostedMessage(event.data);
          if (!message) return;
          void handleMessage(message).catch((error) => {
            log.warn(`turn failed source=${message.id}: ${describeError(error)}`);
          });
        }, signal);
      } catch (error) {
        if (signal.aborted) return;
        attempt += 1;
        const delayMs = Math.min(15_000, 500 * 2 ** Math.min(attempt, 5));
        log.warn(`event stream dropped (attempt ${attempt}): ${describeError(error)}; retrying in ${delayMs}ms`);
        await sleep(delayMs, signal);
        continue;
      }
      if (!signal.aborted) await sleep(500, signal);
    } } finally { clearInterval(recoveryTimer); }
  };

  return { bootstrap, run, handleMessage, reportFlight };
}

const OPERATOR_ID = "operator";

function buildOperatorActor(): ActorIdentity {
  return {
    id: OPERATOR_ID,
    kind: "person",
    displayName: resolveOperatorName().trim() || OPERATOR_ID,
    handle: OPERATOR_ID,
    labels: ["scout"],
    metadata: { source: "scoutbot" },
  };
}

function buildScoutbotActor(): ActorIdentity {
  return {
    id: SCOUTBOT_AGENT_ID,
    kind: "agent",
    displayName: SCOUTBOT_DISPLAY_NAME,
    handle: SCOUTBOT_HANDLE,
    labels: ["assistant", "scout", "scoutbot"],
    metadata: { source: "scoutbot", brokerRegistered: true, role: "operator-assistant" },
  };
}

export function buildScoutbotAgent(nodeId: string): ScoutBrokerAgentRecord {
  return {
    ...buildScoutbotActor(),
    kind: "agent",
    definitionId: SCOUTBOT_HANDLE,
    selector: `@${SCOUTBOT_HANDLE}`,
    defaultSelector: `@${SCOUTBOT_HANDLE}`,
    agentClass: "operator",
    capabilities: ["chat"],
    wakePolicy: "keep_warm",
    homeNodeId: nodeId,
    authorityNodeId: nodeId,
    advertiseScope: "local",
    metadata: {
      source: "scoutbot",
      brokerRegistered: true,
      role: "operator-assistant",
      runtime: "scoutbot-process",
      summary: "The operator's assistant, running beside the broker.",
    },
  };
}

export function buildScoutbotProcessEndpoint(nodeId: string, currentDirectory: string, now: number): ScoutBrokerEndpointRecord {
  return {
    id: `${SCOUTBOT_PROCESS_ENDPOINT_ID}.${nodeId}`,
    agentId: SCOUTBOT_AGENT_ID,
    nodeId,
    harness: "pi",
    transport: "local_socket",
    state: "idle",
    cwd: currentDirectory,
    projectRoot: currentDirectory,
    metadata: {
      source: "scoutbot",
      runtime: "scoutbot-process",
      pid: process.pid,
      startedAt: String(now),
    },
  };
}

export function isAddressedToScoutbot(message: ScoutBrokerMessageRecord): boolean {
  if (message.mentions?.some((mention) => mention.actorId === SCOUTBOT_AGENT_ID)) return true;
  if (message.audience?.notify?.includes(SCOUTBOT_AGENT_ID)) return true;
  const metadata = message.metadata ?? {};
  if (metadata.relayTarget === SCOUTBOT_AGENT_ID) return true;
  return /(^|\s)@scoutbot(\b|\s|$)/i.test(message.body);
}

function stripScoutbotAddress(body: string): string {
  return body.replace(/^\s*@scoutbot(?=\s|[:,]|$)[:,]?\s*/i, "").trim();
}

function extractPostedMessage(data: unknown): ScoutBrokerMessageRecord | null {
  if (!data || typeof data !== "object") return null;
  if ((data as { kind?: unknown }).kind !== "message.posted") return null;
  const message = (data as { payload?: { message?: unknown } }).payload?.message;
  if (!message || typeof message !== "object") return null;
  const record = message as ScoutBrokerMessageRecord;
  return typeof record.id === "string" && typeof record.conversationId === "string" ? record : null;
}

const MAX_STATE_AGENTS = 60;
const LIVE_ENDPOINT_STATES = new Set(["working", "waiting", "idle"]);

/** A compact, model-facing view of the control plane at this moment. */
export function renderScoutbotState(snapshot: Snapshot, now: number): string {
  const endpointsByAgent = new Map<string, ScoutBrokerEndpointRecord[]>();
  for (const endpoint of Object.values(snapshot.endpoints ?? {})) {
    const list = endpointsByAgent.get(endpoint.agentId) ?? [];
    list.push(endpoint);
    endpointsByAgent.set(endpoint.agentId, list);
  }
  const agents = Object.values(snapshot.agents ?? {})
    .filter((agent) => agent.id !== SCOUTBOT_AGENT_ID)
    .map((agent) => {
      const endpoints = endpointsByAgent.get(agent.id) ?? [];
      const live = endpoints.find((endpoint) => LIVE_ENDPOINT_STATES.has(endpoint.state ?? ""))
        ?? endpoints[0];
      const project = live?.projectRoot ?? live?.cwd;
      return {
        handle: agent.handle ?? agent.id,
        name: agent.displayName,
        state: live?.state ?? "no endpoint",
        harness: live?.harness,
        project: project ? basename(project) : undefined,
      };
    })
    .sort((a, b) => Number(LIVE_ENDPOINT_STATES.has(b.state)) - Number(LIVE_ENDPOINT_STATES.has(a.state)));
  const working = Object.values(snapshot.flights ?? {})
    .filter((flight) => flight.state && !["completed", "failed", "cancelled"].includes(flight.state))
    .map((flight) => ({
      agent: flight.targetAgentId,
      state: flight.state,
      minutes: typeof flight.startedAt === "number" ? Math.round((now - flight.startedAt) / 60_000) : undefined,
      summary: flight.summary,
    }));
  return JSON.stringify({
    at: new Date(now).toISOString(),
    agentCount: agents.length,
    agents: agents.slice(0, MAX_STATE_AGENTS),
    ...(agents.length > MAX_STATE_AGENTS ? { agentsOmitted: agents.length - MAX_STATE_AGENTS } : {}),
    workInFlight: working,
  });
}

/** Which Pi conversation holds each Scoutbot thread. */
export type ScoutbotBrainConversationMap = {
  get: (threadId: string) => number | null;
  set: (threadId: string, conversationId: number) => void;
};

export function createScoutbotBrainConversationMap(
  filePath = join(resolveOpenScoutSupportPaths().supportDirectory, "scoutbot", "process-threads.json"),
): ScoutbotBrainConversationMap {
  let entries: Record<string, number> = {};
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { threads?: Record<string, unknown> };
    for (const [threadId, value] of Object.entries(parsed.threads ?? {})) {
      if (typeof value === "number" && Number.isInteger(value)) entries[threadId] = value;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return {
    get: (threadId) => entries[threadId] ?? null,
    set: (threadId, conversationId) => {
      if (entries[threadId] === conversationId) return;
      const next = { ...entries, [threadId]: conversationId };
      try {
        mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
        const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
        const fd = openSync(temporaryPath, "wx", 0o600);
        try { writeFileSync(fd, `${JSON.stringify({ version: 1, threads: next })}\n`); fsyncSync(fd); } finally { closeSync(fd); }
        renameSync(temporaryPath, filePath);
        const directory = openSync(dirname(filePath), "r");
        try { fsyncSync(directory); } finally { closeSync(directory); }
        entries = next;
      } catch (error) {
        throw new Error(`Could not save Scoutbot conversation binding: ${String(error)}`);
      }
    },
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
