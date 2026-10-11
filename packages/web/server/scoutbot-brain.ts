import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import { createModels, type Models } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import {
  createRegistry,
  defineExtension,
  defineTool,
  defineTask,
  type ToolRegistration,
  GenerationTask,
  Harness,
  hook,
  section,
  watchEvents,
  type ConversationId,
  type Storage,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import {
  SqliteStorage,
  type SqliteDatabase,
  type SqliteExecutor,
  type SqliteValue,
} from "@earendil-works/pi-durable/storage/sqlite";
import { createReadTool } from "@earendil-works/pi-durable/tools";
import { resolveOpenScoutSupportPaths } from "@openscout/runtime/support-paths";

import type { ScoutbotFileLookup } from "./scoutbot-file-lookup.ts";

/**
 * Scoutbot's brain on Pi Durable: each Scoutbot conversation is a durable Pi
 * conversation, so the model keeps its own transcript across web-server
 * restarts, with compaction instead of re-sending a trimmed history.
 *
 * The control-plane snapshot is live state, not history: it is added to the
 * newest user message of each request and never stored in the transcript.
 */

export type ScoutbotBrainUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type ScoutbotBrainReply = {
  conversationId: number;
  text: string;
  usage: ScoutbotBrainUsage | null;
};

export type ScoutbotBrain = {
  ensureConversation?: (input: { conversationId: number | null; model: string; systemPrompt: string }) => Promise<number>;
  startBackground?: (flightId: string, conversationId: number) => Promise<void>;
  reply: (input: {
    /** The Pi conversation from an earlier reply; null starts a new one. */
    conversationId: number | null;
    body: string;
    requestId?: string;
    /** Rendered snapshot for this request only. */
    state?: string;
    model: string;
    systemPrompt: string;
    signal?: AbortSignal;
    onDelta?: (delta: string) => void;
  }) => Promise<ScoutbotBrainReply>;
  close: () => Promise<void>;
};

const PROVIDER = "openai";

export function defaultScoutbotBrainPath(): string {
  return join(resolveOpenScoutSupportPaths().supportDirectory, "scoutbot", "brain.sqlite");
}

export function createScoutbotBrain(options: {
  /** Storage for the brain; defaults to SQLite at `defaultScoutbotBrainPath()`. */
  openStorage?: () => Promise<Storage>;
  /** Model access; defaults to OpenAI with `resolveApiKey`. */
  models?: Models;
  provider?: string;
  resolveApiKey?: () => Promise<string | undefined>;
  currentDirectory: string;
  findFiles?: ScoutbotFileLookup;
  tools?: () => Promise<ToolRegistration[]>;
  initialSystemPrompt?: string;
  backgroundWork?: (flightId: string, signal: AbortSignal) => Promise<void>;
}): ScoutbotBrain {
  const provider = options.provider ?? PROVIDER;
  const pendingState = new Map<number, string>();
  let systemPrompt = options.initialSystemPrompt ?? "";
  let opening: Promise<Harness> | null = null;

  const reporter = defineTask<{ flightId: string }, { phase: "report" }, null>({
    name: "scoutbot.flight-reporter", version: 1, initial: () => ({ phase: "report" }),
    phases: { report: async (task, runtime, context) => {
      await options.backgroundWork?.(task.input.flightId, runtime.signal);
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context);
    } },
    abort: async (_task, runtime, context) => {
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context);
    },
  });
  const open = (): Promise<Harness> => {
    opening ??= (async () => {
      const models = options.models ?? createOpenAIModels(options.resolveApiKey);
      const registry = createRegistry();
      const tools = [
        createReadTool(),
        ...await (options.tools?.() ?? Promise.resolve([])),
        ...(options.findFiles ? [createFindFilesTool(options.findFiles)] : []),
      ];
      registry.install(defineExtension({
        name: "scoutbot",
        tools,
        tasks: options.backgroundWork ? [reporter] : [],
        sections: [section("preamble", () => systemPrompt, { tag: false })],
        hooks: [hook(GenerationTask, {
          beforeRequest: (request, api) => {
            const state = pendingState.get(api.conversationId);
            if (!state) return undefined;
            return { messages: withStateOnNewestUserMessage(request.messages, state) };
          },
        })],
      }));
      const storage = await (options.openStorage ?? (() => openBunSqliteStorage(defaultScoutbotBrainPath())))();
      const harness = await Harness.open(storage, {
        models,
        registry,
        env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? options.currentDirectory }),
        // A failing provider should hand the turn back to the ladder quickly.
        settings: { retry: { maxRetries: 1, baseDelayMs: 1000 }, stream: { timeoutMs: 120_000 } },
        onReport: (error) => console.warn("[scoutbot brain]", error),
      }, BACKGROUND_CONTEXT);
      // Continue any reply the last process left unfinished.
      harness.resume();
      return harness;
    })();
    opening.catch(() => { opening = null; });
    return opening;
  };

  return {
    ensureConversation: async (input) => {
      systemPrompt = input.systemPrompt;
      const harness = await open();
      const existing = input.conversationId !== null ? await harness.conversation(input.conversationId as ConversationId, BACKGROUND_CONTEXT) : undefined;
      if (existing) return existing.id as number;
      const conversation = await harness.createConversation({ ownership: { kind: "ownerless" }, agent: {
        model: { provider, modelId: input.model }, cwd: options.currentDirectory,
      } }, BACKGROUND_CONTEXT);
      return conversation.id as number;
    },
    startBackground: async (flightId, conversationId) => {
      const harness = await open();
      const conversation = await harness.conversation(conversationId as ConversationId, BACKGROUND_CONTEXT);
      if (!conversation) throw new Error("Missing flight conversation");
      await conversation.commit(async tx => {
        let cursor;
        do {
          const page = await tx.scanTasks({ conversationId: conversation.id, kind: reporter.definition.name }, 100, cursor);
          if (page.items.some(task => (task.input as { flightId?: string }).flightId === flightId && task.state.status !== "terminal")) return;
          cursor = page.next;
        } while (cursor);
        await tx.createTask(reporter, { flightId }, { ownership: { kind: "conversation" }, background: true });
      }, BACKGROUND_CONTEXT);
    },
    reply: async (input) => {
      const harness = await open();
      const context = input.signal ? withAbortSignal(input.signal, BACKGROUND_CONTEXT) : BACKGROUND_CONTEXT;
      systemPrompt = input.systemPrompt;
      const agent = {
        model: { provider, modelId: input.model },
        cwd: options.currentDirectory,
      };
      let conversation = input.conversationId !== null
        ? await harness.conversation(input.conversationId as ConversationId, context)
        : undefined;
      if (conversation) {
        await conversation.configure({ model: agent.model }, context);
      } else {
        conversation = await harness.createConversation({ ownership: { kind: "ownerless" }, agent }, context);
      }
      const id = conversation.id as number;

      // Partials are committed at most every 100 ms, so a quick answer may
      // arrive whole; whatever the stream did not carry is sent at the end.
      let streamed = "";
      const events = input.onDelta ? await watchEvents(harness, conversation.id, context) : null;
      events?.start(async (batch) => {
        for (const event of batch) {
          if (event.type === "message_start") streamed = "";
          if (event.type !== "message_update") continue;
          for (const change of event.changes) {
            if (change.type !== "text_delta") continue;
            streamed += change.delta;
            input.onDelta?.(change.delta);
          }
        }
      });
      const stopEvents = async () => {
        const watch = events;
        if (!watch) return;
        await watch.stop().catch(() => undefined);
      };

      if (input.state) pendingState.set(id, input.state);
      else pendingState.delete(id);
      const abort = () => { void conversation!.abort(BACKGROUND_CONTEXT).catch(() => undefined); };
      input.signal?.addEventListener("abort", abort, { once: true });
      try {
        const submission = await conversation.submit({ type: "input", content: input.body, requestId: input.requestId, whenBusy: "reject" }, context);
        const settled = await submission.wait(context);
        if (settled.status !== "done" || settled.type !== "input" || settled.answer === undefined) {
          throw new Error(`Scoutbot brain did not answer (${settled.status}${"reason" in settled && settled.reason ? `: ${String(settled.reason)}` : ""}).`);
        }
        const view = await conversation.viewState(context);
        const answer = view.value.entries.find((entry) => entry.id === settled.answer);
        view.dispose();
        const message = (answer as { model?: unknown[] } | undefined)?.model?.at(-1);
        const text = assistantText(message);
        await stopEvents();
        if (input.onDelta && text.startsWith(streamed) && text.length > streamed.length) {
          input.onDelta(text.slice(streamed.length));
        }
        return { conversationId: id, text, usage: assistantUsage(message) };
      } finally {
        input.signal?.removeEventListener("abort", abort);
        pendingState.delete(id);
        await stopEvents();
      }
    },
    close: async () => {
      if (!opening) return;
      const harness = await opening.catch(() => null);
      opening = null;
      await harness?.close(BACKGROUND_CONTEXT);
    },
  };
}

function createOpenAIModels(resolveApiKey?: () => Promise<string | undefined>): Models {
  const models = createModels({
    credentials: {
      read: async (providerId) => {
        if (providerId !== PROVIDER) return undefined;
        const key = (await resolveApiKey?.()) ?? process.env.OPENAI_API_KEY;
        return key ? { type: "api_key", key } : undefined;
      },
      list: async () => [],
      modify: async (_providerId, fn) => fn(undefined),
      delete: async () => undefined,
    },
  });
  models.setProvider(openaiProvider());
  return models;
}

function createFindFilesTool(findFiles: ScoutbotFileLookup) {
  return defineTool({
    name: "find_files",
    description: "Find files in the operator's workspace by name or path fragment. Returns absolute paths.",
    parameters: Type.Object({ query: Type.String() }),
    replay: "safe",
    execute: async (args) => {
      const paths = await findFiles(args.query);
      return { content: [{ type: "text", text: paths.length ? paths.join("\n") : "No matching files." }] };
    },
  });
}

type RequestMessage = { role?: string; content?: unknown };

function withStateOnNewestUserMessage<T>(messages: readonly T[], state: string): T[] {
  const next = [...messages];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const message = next[index] as RequestMessage;
    if (message?.role !== "user") continue;
    const content = typeof message.content === "string"
      ? [{ type: "text", text: message.content }]
      : Array.isArray(message.content) ? message.content : [];
    next[index] = {
      ...message,
      content: [...content, { type: "text", text: `Current Scout control-plane snapshot (live, this request only):\n${state}` }],
    } as T;
    break;
  }
  return next;
}

function assistantText(message: unknown): string {
  const content = (message as { content?: unknown })?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: "text"; text: string } =>
      Boolean(block) && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string")
    .map((block) => block.text)
    .join("");
}

function assistantUsage(message: unknown): ScoutbotBrainUsage | null {
  const usage = (message as { usage?: Record<string, unknown> })?.usage;
  if (!usage) return null;
  const pick = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  return { inputTokens: pick(usage.input), outputTokens: pick(usage.output), totalTokens: pick(usage.totalTokens) };
}

/**
 * Bun has no `node:sqlite`, so the brain opens Pi's portable SQLite storage
 * over `bun:sqlite`. FULL sync: a reply that was shown must survive a crash.
 */
export async function openBunSqliteStorage(path: string): Promise<Storage> {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
  const bind = (params: SqliteValue[]) => params as Array<string | number | bigint | boolean | null | Uint8Array>;
  const executor: SqliteExecutor = {
    exec: async (sql) => { db.exec(sql); },
    run: async (sql, ...params) => { db.query(sql).run(...bind(params)); },
    get: async <T extends object>(sql: string, ...params: SqliteValue[]) =>
      (db.query(sql).get(...bind(params)) ?? undefined) as T | undefined,
    all: async <T extends object>(sql: string, ...params: SqliteValue[]) =>
      db.query(sql).all(...bind(params)) as T[],
  };
  // One transaction at a time, and plain calls wait behind it, as the
  // storage contract requires.
  let tail: Promise<unknown> = Promise.resolve();
  const queued = <T>(run: () => Promise<T>): Promise<T> => {
    const next = tail.then(run);
    tail = next.catch(() => undefined);
    return next;
  };
  const database: SqliteDatabase = {
    exec: (sql) => queued(() => executor.exec(sql)),
    run: (sql, ...params) => queued(() => executor.run(sql, ...params)),
    get: (sql, ...params) => queued(() => executor.get(sql, ...params)),
    all: (sql, ...params) => queued(() => executor.all(sql, ...params)),
    transaction: (callback) => queued(async () => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = await callback(executor);
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }),
    close: () => queued(async () => { db.close(); }),
  };
  return SqliteStorage.open(database);
}
