// The answer a session gives to words typed into it, read from the harness's
// own transcript. A session the operator runs does not report back to Scout;
// its transcript is the only record of what it said. Only the lines written
// after the words were typed are read, and the turn is found by a marker the
// typed words carry, so an unrelated turn is never mistaken for the answer.

import { open, stat } from "node:fs/promises";

import { claudeTranscriptPathForSession, findLiveClaudeSession } from "../claude-session-records.js";

import { codexThreadHeldByChatGPTApp, codexThreadHolderPids, findCodexTranscript } from "./deliver.js";

export type SessionReply =
  /** No finished answer yet. `accepted` says the transcript recorded the typed words. */
  | { state: "pending"; accepted: boolean }
  | { state: "answered"; text: string }
  /** The turn that took the words was interrupted before it answered. */
  | { state: "aborted" };

type Row = Record<string, unknown>;

function parseRow(line: string): Row | null {
  if (!line.trim()) return null;
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
  } catch {
    return null; // A line still being written; the next read sees it whole.
  }
}

function record(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function blocks(content: unknown): Row[] {
  return Array.isArray(content) ? content.map(record).filter((block): block is Row => block !== null) : [];
}

function blockText(content: unknown, types: readonly string[]): string {
  if (typeof content === "string") return content;
  return blocks(content)
    .filter((block) => types.includes(String(block.type)) && typeof block.text === "string")
    .map((block) => String(block.text))
    .join("\n");
}

/**
 * Codex writes `task_complete` with the turn's last message when a turn ends
 * and `turn_aborted` when it is interrupted. The answer is the first of those
 * after the user message that carries the marker.
 */
export function codexReplyFromTranscript(text: string, marker: string): SessionReply {
  let accepted = false;
  let lastMessage = "";
  for (const line of text.split("\n")) {
    const row = parseRow(line);
    const payload = record(row?.payload);
    if (!row || !payload) continue;
    const type = String(payload.type);
    if (row.type === "event_msg" && type === "user_message") {
      if (!accepted && typeof payload.message === "string" && payload.message.includes(marker)) accepted = true;
      continue;
    }
    if (row.type === "response_item" && type === "message") {
      if (payload.role === "user") {
        if (!accepted && blockText(payload.content, ["input_text", "text"]).includes(marker)) accepted = true;
      } else if (accepted && payload.role === "assistant") {
        const said = blockText(payload.content, ["output_text", "text"]);
        if (said.trim()) lastMessage = said;
      }
      continue;
    }
    if (!accepted || row.type !== "event_msg") continue;
    if (type === "agent_message" && typeof payload.message === "string" && payload.message.trim()) {
      lastMessage = payload.message;
    } else if (type === "task_complete") {
      const final = typeof payload.last_agent_message === "string" && payload.last_agent_message.trim()
        ? payload.last_agent_message
        : lastMessage;
      return { state: "answered", text: final.trim() };
    } else if (type === "turn_aborted") {
      return { state: "aborted" };
    }
  }
  return { state: "pending", accepted };
}

/**
 * Claude Code has no single end-of-turn record across versions, so three
 * signals are accepted, each only after assistant text that follows the last
 * tool result: `stop_reason: "end_turn"`, the `turn_duration` system record,
 * and the harness's own report that the session is idle (`idle`).
 */
export function claudeReplyFromTranscript(text: string, marker: string, options: { idle?: boolean } = {}): SessionReply {
  let accepted = false;
  let answer = "";
  let toolPending = false;
  for (const line of text.split("\n")) {
    const row = parseRow(line);
    if (!row || row.isSidechain === true) continue;
    const message = record(row.message);
    if (row.type === "user") {
      const content = message?.content;
      if (blocks(content).some((block) => block.type === "tool_result")) {
        if (accepted) {
          answer = "";
          toolPending = false;
        }
        continue;
      }
      const said = blockText(content, ["text"]);
      if (!accepted) {
        if (said.includes(marker)) accepted = true;
        continue;
      }
      if (row.isMeta === true || !said.trim()) continue;
      if (said.trimStart().startsWith("[Request interrupted")) return { state: "aborted" };
      // The next prompt: the turn that took our words has ended.
      if (answer.trim() && !toolPending) return { state: "answered", text: answer.trim() };
      continue;
    }
    if (!accepted) continue;
    if (row.type === "assistant") {
      const said = blockText(message?.content, ["text"]);
      if (said.trim()) answer = answer ? `${answer}\n\n${said}` : said;
      if (blocks(message?.content).some((block) => block.type === "tool_use")) toolPending = true;
      if (message?.stop_reason === "end_turn" && answer.trim()) return { state: "answered", text: answer.trim() };
      continue;
    }
    if (row.type === "system" && row.subtype === "turn_duration" && answer.trim() && !toolPending) {
      return { state: "answered", text: answer.trim() };
    }
  }
  if (options.idle && accepted && answer.trim() && !toolPending) return { state: "answered", text: answer.trim() };
  return { state: "pending", accepted };
}

export type SessionReplyReader = {
  path: string;
  /** Where reading starts: the transcript's end when the reader was first opened. */
  offset: number;
  /** The transcript's size at the last read, to tell a quiet transcript from a growing one. */
  size(): number;
  read(options?: { idle?: boolean }): Promise<SessionReply>;
};

/**
 * Open the session's transcript at its current end. Call it before typing, so
 * the reader sees exactly what the typed words caused. Returns null when the
 * transcript cannot be found; the caller then needs another way to hear back.
 *
 * `fromOffset` reopens a reader where an earlier one started, after the words
 * were typed: a runtime that restarted reads the same turn the first one saw.
 */
export async function openSessionReplyReader(input: {
  sessionId: string;
  harness: "claude" | "codex";
  marker: string;
  /** Folders the session may be running in; Claude files its transcript by folder. */
  cwds?: Array<string | null | undefined>;
  fromOffset?: number;
}): Promise<SessionReplyReader | null> {
  let path: string | null = null;
  if (input.harness === "codex") {
    path = await findCodexTranscript(input.sessionId);
  } else {
    const live = await findLiveClaudeSession(input.sessionId).catch(() => null);
    for (const cwd of [live?.cwd, ...(input.cwds ?? [])]) {
      path = cwd ? claudeTranscriptPathForSession(cwd, input.sessionId) : null;
      if (path) break;
    }
  }
  if (!path) return null;
  const end = (await stat(path).catch(() => null))?.size;
  if (end === undefined) return null;
  const offset = input.fromOffset === undefined ? end : Math.min(Math.max(0, input.fromOffset), end);
  const transcript = path;
  let size = offset;
  // A transcript that has not grown gives the same answer; it is read again
  // only when it grows or the idle report changes.
  let last: { size: number; idle: boolean; reply: SessionReply } | null = null;
  return {
    path: transcript,
    offset,
    size: () => size,
    async read(options = {}) {
      const idle = options.idle === true;
      const current = (await stat(transcript).catch(() => null))?.size;
      if (current === undefined) return { state: "pending", accepted: false };
      if (last && last.size === current && last.idle === idle) return last.reply;
      const text = await readFrom(transcript, offset).catch(() => null);
      if (text === null) return { state: "pending", accepted: false };
      size = offset + Buffer.byteLength(text, "utf8");
      const reply = input.harness === "codex"
        ? codexReplyFromTranscript(text, input.marker)
        : claudeReplyFromTranscript(text, input.marker, options);
      last = { size: current, idle, reply };
      return reply;
    },
  };
}

async function readFrom(path: string, offset: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    if (size <= offset) return "";
    const buffer = Buffer.alloc(size - offset);
    await handle.read(buffer, 0, buffer.length, offset);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

/**
 * Whether a harness process still has the session open, and whether that
 * harness says it is idle. Only Claude Code reports idleness here; Codex turn
 * ends are read from its transcript.
 */
export async function readSessionHolderState(
  sessionId: string,
  harness: "claude" | "codex",
): Promise<{ live: boolean; idle: boolean }> {
  if (harness === "claude") {
    const live = await findLiveClaudeSession(sessionId);
    // "shell" is a finished turn with a background shell still running.
    return { live: live !== null, idle: live?.status === "idle" || live?.status === "shell" };
  }
  const held = (await codexThreadHolderPids(sessionId)).length > 0 || await codexThreadHeldByChatGPTApp(sessionId);
  return { live: held, idle: false };
}
