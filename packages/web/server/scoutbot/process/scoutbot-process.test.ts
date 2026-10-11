import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ScoutbotBrain } from "../../scoutbot-brain.ts";
import { ScoutbotThreadMapStore } from "../thread-map.ts";
import type { ScoutbotBrokerLink } from "./broker-link.ts";
import {
  createScoutbotBrainConversationMap,
  createScoutbotProcess,
  renderScoutbotState,
} from "./scoutbot-process.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "scoutbot-process-"));
  directories.push(directory);
  return directory;
}

type Snapshot = Record<string, Record<string, any>>;

function fakeBroker(snapshot: Snapshot) {
  const posts: Array<{ path: string; body: any }> = [];
  const link: ScoutbotBrokerLink = {
    socketPath: "/tmp/broker.sock",
    getJson: async <T,>(path: string) => {
      if (path === "/v1/node") return { id: "node-1" } as T;
      if (path.startsWith("/v1/snapshot")) return structuredClone(snapshot) as T;
      throw new Error(`unexpected GET ${path}`);
    },
    postJson: async <T,>(path: string, body: unknown) => {
      posts.push({ path, body });
      if (path === "/v1/messages") {
        const message = body as { id: string };
        snapshot.messages = { ...snapshot.messages, [message.id]: message };
      }
      return { ok: true } as T;
    },
    streamEvents: async () => undefined,
  };
  return { link, posts };
}

function fakeBrain(answers: Array<string | Error>) {
  const calls: Array<{ conversationId: number | null; body: string; state?: string; model: string }> = [];
  const brain: ScoutbotBrain = {
    reply: async (input) => {
      calls.push({ conversationId: input.conversationId, body: input.body, state: input.state, model: input.model });
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return { conversationId: input.conversationId ?? 7, text: next ?? "", usage: null };
    },
    close: async () => undefined,
  };
  return { brain, calls };
}

function operatorMessage(id: string, conversationId: string, body: string) {
  return {
    id,
    conversationId,
    actorId: "operator",
    originNodeId: "node-1",
    class: "agent",
    body,
    mentions: [{ actorId: "scoutbot", label: "@scoutbot" }],
    audience: { notify: ["scoutbot"], reason: "direct_message" },
    visibility: "private",
    policy: "durable",
    createdAt: 1,
  } as any;
}

async function setup(answers: Array<string | Error>, snapshot: Snapshot = { actors: {}, agents: {}, endpoints: {}, conversations: {}, messages: {} }) {
  const directory = tempDirectory();
  const threads = new ScoutbotThreadMapStore(join(directory, "threads.json"));
  const broker = fakeBroker(snapshot);
  const { brain, calls } = fakeBrain(answers);
  const scoutbot = createScoutbotProcess({
    broker: broker.link,
    brain,
    currentDirectory: directory,
    threads,
    conversations: createScoutbotBrainConversationMap(join(directory, "brain-threads.json")),
    log: { info: () => undefined, warn: () => undefined },
  });
  await scoutbot.bootstrap();
  const thread = (await threads.list()).threads[0]!;
  return { directory, threads, broker, calls, scoutbot, thread, snapshot };
}

describe("Scoutbot process", () => {
  test("bootstrap registers the operator before the thread's conversation and retires the Codex endpoint", async () => {
    const { broker } = await setup([], {
      actors: {},
      agents: {},
      endpoints: {
        "endpoint.scoutbot.codex_app_server.node-1": {
          id: "endpoint.scoutbot.codex_app_server.node-1",
          agentId: "scoutbot",
          nodeId: "node-1",
          transport: "codex_app_server",
          state: "waiting",
        },
      },
      conversations: {},
      messages: {},
    });
    const operatorAt = broker.posts.findIndex((post) => post.path === "/v1/actors" && post.body.id === "operator");
    const conversationAt = broker.posts.findIndex((post) => post.path === "/v1/conversations");
    expect(operatorAt).toBeGreaterThanOrEqual(0);
    expect(operatorAt).toBeLessThan(conversationAt);
    const endpoints = broker.posts.filter((post) => post.path === "/v1/endpoints").map((post) => post.body);
    expect(endpoints[0]).toMatchObject({ agentId: "scoutbot", transport: "local_socket", state: "idle" });
    expect(endpoints[1]).toMatchObject({ id: "endpoint.scoutbot.codex_app_server.node-1", state: "offline" });
    const conversation = broker.posts.find((post) => post.path === "/v1/conversations")!.body;
    expect(conversation.participantIds).toEqual(["operator", "scoutbot"]);
  });

  test("answers through the brain and keeps one Pi conversation per thread", async () => {
    const { broker, calls, scoutbot, thread } = await setup(["First answer.", "Second answer."]);
    await scoutbot.handleMessage(operatorMessage("msg-1", thread.conversationId, "@scoutbot what is going on?"));
    await scoutbot.handleMessage(operatorMessage("msg-2", thread.conversationId, "and now?"));

    expect(calls.map((call) => call.conversationId)).toEqual([null, 7]);
    expect(calls[0]!.body).toBe("what is going on?");
    expect(JSON.parse(calls[0]!.state!)).toMatchObject({ agentCount: 0, workInFlight: [] });
    const replies = broker.posts.filter((post) => post.path === "/v1/messages").map((post) => post.body);
    expect(replies.map((reply) => [reply.replyToMessageId, reply.body, reply.actorId])).toEqual([
      ["msg-1", "First answer.", "scoutbot"],
      ["msg-2", "Second answer.", "scoutbot"],
    ]);
    expect(replies[0].audience).toEqual({ notify: ["operator"], reason: "reply" });
    expect(replies[0].metadata).toMatchObject({ sourcePath: "scoutbot-brain", brainConversationId: 7 });
  });

  test("a replayed message, its own reply, and other conversations get no answer", async () => {
    const { broker, calls, scoutbot, thread } = await setup(["Once."]);
    const message = operatorMessage("msg-1", thread.conversationId, "hello");
    await scoutbot.handleMessage(message);
    await scoutbot.handleMessage(message);
    await scoutbot.handleMessage({ ...operatorMessage("msg-3", thread.conversationId, "echo"), actorId: "scoutbot" });
    await scoutbot.handleMessage(operatorMessage("msg-4", "c-somewhere-else", "@scoutbot hi"));
    expect(calls).toHaveLength(1);
    expect(broker.posts.filter((post) => post.path === "/v1/messages")).toHaveLength(1);
  });

  test("a failed brain turn still answers, so the thread is not left pending", async () => {
    const { broker, scoutbot, thread } = await setup([new Error("no OpenAI key")]);
    await scoutbot.handleMessage(operatorMessage("msg-1", thread.conversationId, "hello"));
    const reply = broker.posts.find((post) => post.path === "/v1/messages")!.body;
    expect(reply.body).toContain("no OpenAI key");
    expect(reply.metadata).toMatchObject({ error: true, sourcePath: "scoutbot-brain" });
    expect(reply.replyToMessageId).toBe("msg-1");
  });

  test("the thread's Pi conversation survives a restart", async () => {
    const first = await setup(["One."]);
    await first.scoutbot.handleMessage(operatorMessage("msg-1", first.thread.conversationId, "remember heron"));
    const again = createScoutbotBrainConversationMap(join(first.directory, "brain-threads.json"));
    expect(again.get(first.thread.threadId)).toBe(7);
  });
});

describe("renderScoutbotState", () => {
  test("lists live agents first with their project, and work in flight", () => {
    const state = JSON.parse(renderScoutbotState({
      actors: {},
      conversations: {},
      agents: {
        a: { id: "a", handle: "quiet", displayName: "Quiet" },
        b: { id: "b", handle: "busy", displayName: "Busy" },
        scoutbot: { id: "scoutbot", handle: "scoutbot", displayName: "Scout" },
      },
      endpoints: {
        ea: { id: "ea", agentId: "a", state: "offline", cwd: "/x/alpha" },
        eb: { id: "eb", agentId: "b", state: "working", harness: "codex", projectRoot: "/x/openscout" },
      },
      flights: {
        f: { id: "f", targetAgentId: "b", state: "running", startedAt: 0, summary: "typecheck" },
        g: { id: "g", targetAgentId: "a", state: "completed" },
      },
    } as any, 5 * 60_000));
    expect(state.agents.map((agent: { handle: string }) => agent.handle)).toEqual(["busy", "quiet"]);
    expect(state.agents[0]).toMatchObject({ state: "working", harness: "codex", project: "openscout" });
    expect(state.workInFlight).toEqual([{ agent: "b", state: "running", minutes: 5, summary: "typecheck" }]);
  });
});
