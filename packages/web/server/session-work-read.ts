/**
 * Scoutbot's read of a session's work: what it is doing now, the operator
 * guidance in force, and the shape of the work.
 *
 * One cheap completion over a compact digest: the operator's prompts in
 * full (read from the transcript, since observe carries only the agent's
 * side), the agent's last message, and a tool/file tally from observe. Raw tool output never goes in. Reads are cached per session and
 * re-run only at turn boundaries (a new prompt or agent message) or after
 * a stretch of tool calls, so reopening a session costs nothing.
 */

import type { ObserveData } from "../shared/api/observe.ts";
import type { SessionPrompt } from "./session-prompts.ts";
import type {
  SessionWorkRead,
  SessionWorkReadResponse,
  SessionWorkSteering,
} from "../shared/api/session-work-read.ts";

export type { SessionWorkRead, SessionWorkReadResponse, SessionWorkSteering };

export type SessionWorkReadComplete = (input: {
  systemPrompt: string;
  body: string;
}) => Promise<{ text: string; model: string }>;

const SYSTEM_PROMPT = [
  "You are Scoutbot, reading an AI coding agent's session for the operator who is watching it.",
  "You get the operator's prompts (oldest first, each with askIndex; the last one is the most recent), the agent's latest message, its recent steps, and a tally of tool calls and files.",
  "The operator often dictates by voice, so read through transcription slips (\"threat\" for \"thread\", \"bass\" for \"base\") and never repeat them.",
  "Return ONLY JSON with this shape:",
  "{\"now\":\"two plain sentences: what the agent is working on right now, naming the concrete files or steps from recentSteps and filesChanged, and how far along it is\",",
  "\"steering\":[{\"text\":\"one standing instruction from the operator, paraphrased in under 15 words\",\"askIndex\":0,\"supersedes\":\"the earlier instruction it replaced, or null\"}],",
  "\"shape\":{\"goal\":\"what the work is for, one clause, or null\",\"must\":[\"a requirement the operator set\"],\"mustNot\":[\"something the operator ruled out\"],\"deliver\":\"what finished looks like, one clause, or null\"}}",
  "must and mustNot hold only requirements the operator actually stated; leave them [] otherwise.",
  "steering: at most 4 instructions still in force, weighted toward the most recent prompts. When a later prompt corrects or narrows an earlier one, keep the later one and name what it replaced in supersedes.",
  "Ground everything in the supplied prompts and digest. Do not invent files, counts or progress. If there are no operator prompts, steering is [] and shape comes from the agent's own activity, or null and [].",
  "Write plainly. No markdown, no emoji. Use JSON null, never the string \"null\".",
].join(" ");

const MAX_PROMPT_CHARS = 2_400;
const MAX_PROMPTS = 8;
const MAX_MESSAGE_CHARS = 1_800;
const MAX_STEPS = 14;
const MAX_FILES = 24;
/** Re-read inside a long turn after this many more tool calls. */
const TOOL_STRIDE = 25;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+\n/g, "\n").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function sessionWorkDigest(data: ObserveData, prompts: SessionPrompt[]) {
  const messages = data.events.filter((event) => event.kind === "message" && event.text.trim());
  const tools = data.events.filter((event) => event.kind === "tool");
  const toolCounts: Record<string, number> = {};
  for (const event of tools) {
    const name = event.tool?.trim() || "tool";
    toolCounts[name] = (toolCounts[name] ?? 0) + 1;
  }
  const changed = data.files
    .filter((file) => file.state !== "read")
    .sort((a, b) => b.lastT - a.lastT)
    .slice(0, MAX_FILES)
    .map((file) => `${file.state === "created" ? "new" : "edit"} ${file.path} (${file.touches}×)`);
  const readCount = data.files.filter((file) => file.state === "read").length;
  const steps = data.events
    .filter((event) => event.kind === "tool" || event.kind === "think")
    .slice(-MAX_STEPS)
    .map((event) => clip(
      event.kind === "tool"
        ? `${event.tool ?? "tool"} ${event.arg ?? event.text}`
        : `think ${event.text}`,
      180,
    ));
  const shownPrompts = prompts.slice(-MAX_PROMPTS);
  const firstShown = prompts.length - shownPrompts.length;
  const session = data.metadata?.session;
  const lastMessage = messages.at(-1);
  const fingerprint = [
    prompts.length,
    prompts.at(-1)?.at ?? prompts.at(-1)?.text.length ?? "",
    lastMessage?.id ?? "",
    Math.floor(tools.length / TOOL_STRIDE),
  ].join(":");

  return {
    fingerprint,
    turn: prompts.length,
    askTimes: prompts.map((prompt) => prompt.at),
    body: {
      session: {
        harness: session?.adapterType ?? null,
        model: session?.model ?? null,
        cwd: session?.cwd ?? null,
        branch: session?.gitBranch ?? null,
        live: data.live ?? false,
      },
      prompts: shownPrompts.map((prompt, index) => ({
        askIndex: firstShown + index,
        text: clip(prompt.text, MAX_PROMPT_CHARS),
      })),
      latestAgentMessage: lastMessage ? clip(lastMessage.text, MAX_MESSAGE_CHARS) : null,
      tools: toolCounts,
      toolCalls: tools.length,
      filesChanged: changed,
      filesRead: readCount,
      recentSteps: steps,
    },
  };
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  // Small models sometimes spell null as a string.
  return text && text.toLowerCase() !== "null" ? text : null;
}

function stringList(value: unknown, max: number): string[] {
  return Array.isArray(value)
    ? value.map(stringOrNull).filter((item): item is string => !!item).slice(0, max)
    : [];
}

export function parseSessionWorkRead(text: string, askTimes: (number | null)[]): SessionWorkRead {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Scoutbot did not return JSON.");
  const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  const now = stringOrNull(raw.now);
  if (!now) throw new Error("Scoutbot's read had no summary.");
  const shape = (raw.shape && typeof raw.shape === "object" ? raw.shape : {}) as Record<string, unknown>;
  const steering = Array.isArray(raw.steering)
    ? raw.steering.flatMap((item): SessionWorkSteering[] => {
        if (!item || typeof item !== "object") return [];
        const entry = item as Record<string, unknown>;
        const textValue = stringOrNull(entry.text);
        if (!textValue) return [];
        const index = typeof entry.askIndex === "number" && Number.isInteger(entry.askIndex)
          && entry.askIndex >= 0 && entry.askIndex < askTimes.length
          ? entry.askIndex
          : null;
        return [{
          text: textValue,
          askIndex: index,
          at: index === null ? null : askTimes[index] ?? null,
          supersedes: stringOrNull(entry.supersedes),
        }];
      })
        // Newest guidance first, whatever order the model used.
        .sort((a, b) => (b.askIndex ?? -1) - (a.askIndex ?? -1))
        .slice(0, 4)
    : [];
  return {
    now,
    steering,
    shape: {
      goal: stringOrNull(shape.goal),
      must: stringList(shape.must, 5),
      mustNot: stringList(shape.mustNot, 5),
      deliver: stringOrNull(shape.deliver),
    },
  };
}

type CacheEntry = {
  fingerprint: string;
  read?: SessionWorkRead;
  model?: string;
  generatedAt?: number;
  turn: number;
  error?: string;
  attemptedAt: number;
  inflight?: Promise<void>;
};

/** A failed read retries on the same turn after this long. */
const RETRY_MS = 60_000;

const CACHE_LIMIT = 64;
const cache = new Map<string, CacheEntry>();

export function resetSessionWorkReadCache(): void {
  cache.clear();
}

/**
 * Returns the cached read for this session, starting a refresh when the
 * session has moved past it. Never waits on the model unless `wait` is set.
 */
export async function readSessionWork(
  key: string,
  data: ObserveData,
  prompts: SessionPrompt[],
  options: { complete: SessionWorkReadComplete; wait?: boolean; now?: () => number },
): Promise<SessionWorkReadResponse> {
  const digest = sessionWorkDigest(data, prompts);
  if (digest.turn === 0 && digest.body.toolCalls === 0 && !digest.body.latestAgentMessage) {
    return { status: "unavailable", detail: "Nothing in this session to read yet.", turn: 0 };
  }
  const now = options.now?.() ?? Date.now();
  let entry = cache.get(key);
  const moved = entry ? entry.fingerprint !== digest.fingerprint : true;
  const retry = entry?.error ? now - entry.attemptedAt > RETRY_MS : false;
  if (!entry || ((moved || retry) && !entry.inflight)) {
    const previous: CacheEntry | undefined = entry;
    const next: CacheEntry = {
      fingerprint: digest.fingerprint,
      turn: digest.turn,
      read: previous?.read,
      model: previous?.model,
      generatedAt: previous?.generatedAt,
      attemptedAt: now,
    };
    next.inflight = options.complete({ systemPrompt: SYSTEM_PROMPT, body: JSON.stringify(digest.body) })
      .then((response) => {
        next.read = parseSessionWorkRead(response.text, digest.askTimes);
        next.model = response.model;
        next.generatedAt = options.now?.() ?? Date.now();
        next.error = undefined;
      })
      .catch((error: unknown) => {
        next.error = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        next.inflight = undefined;
      });
    cache.delete(key);
    cache.set(key, next);
    while (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (typeof oldest !== "string") break;
      cache.delete(oldest);
    }
    entry = next;
  }
  if (options.wait && entry.inflight) await entry.inflight;

  if (entry.read && entry.model && entry.generatedAt) {
    return {
      status: "ready",
      read: entry.read,
      model: entry.model,
      generatedAt: entry.generatedAt,
      turn: entry.turn,
      ...(entry.inflight || entry.fingerprint !== digest.fingerprint ? { stale: true } : {}),
    };
  }
  if (entry.inflight) return { status: "pending", turn: digest.turn };
  return { status: "unavailable", detail: entry.error ?? "Scoutbot could not read this session.", turn: digest.turn };
}
