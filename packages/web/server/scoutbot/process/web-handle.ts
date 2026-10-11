import type { ActorIdentity } from "@openscout/protocol";
import { resolveOperatorName } from "@openscout/runtime/user-config";

import { loadScoutBrokerContext, resolveScoutBrokerUrl } from "../../core/broker/service.ts";
import { postScoutbotOperatorMessage, type ScoutbotRunnerHandle } from "../runner.ts";
import { buildScoutbotThreadConversation, ScoutbotThreadMapStore } from "../thread-map.ts";

/**
 * When the broker runs Scoutbot as its own process, scout-web still writes the
 * operator's side of Scoutbot threads, but it neither registers Scoutbot nor
 * answers: that is the process's job, and two answerers would reply twice.
 */
export function isScoutbotProcessManaged(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPENSCOUT_SCOUTBOT_PROCESS?.trim() === "managed";
}

export function createScoutbotPostingHandle(input: {
  brokerBaseUrl?: string;
  currentDirectory: string;
  threadMap?: ScoutbotThreadMapStore;
}): ScoutbotRunnerHandle {
  const baseUrl = input.brokerBaseUrl ?? resolveScoutBrokerUrl();
  const threadMap = input.threadMap ?? new ScoutbotThreadMapStore();
  return {
    async stop() { /* nothing runs here */ },
    async getThreads() {
      return threadMap.list();
    },
    async createThread(thread) {
      const ctx = await loadScoutBrokerContext(baseUrl);
      if (!ctx) throw new Error("broker unreachable");
      const created = await threadMap.createThread(thread.name, { ...thread, transportSessionId: null, transport: "local_socket" });
      const conversation = buildScoutbotThreadConversation(created, ctx.snapshot, ctx.node.id);
      if (conversation) {
        // The DM's member rows have a foreign key on actors.
        if (!ctx.snapshot.actors?.operator) await postJson(baseUrl, "/v1/actors", operatorActor());
        await postJson(baseUrl, "/v1/conversations", conversation);
      }
      return created;
    },
    async postOperatorMessage(message) {
      return postScoutbotOperatorMessage({
        brokerBaseUrl: baseUrl,
        currentDirectory: input.currentDirectory,
        body: message.body,
        threadId: message.threadId,
        attachments: message.attachments,
        replyToMessageId: message.replyToMessageId,
        source: "scout-web",
        threadMap,
      });
    },
  };
}

function operatorActor(): ActorIdentity {
  return {
    id: "operator",
    kind: "person",
    displayName: resolveOperatorName().trim() || "operator",
    handle: "operator",
    labels: ["scout"],
    metadata: { source: "scoutbot" },
  };
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<void> {
  const response = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`POST ${path} ${response.status} ${await response.text().catch(() => "")}`.trim());
  }
}
