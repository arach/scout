import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { CallToolResult } from "@earendil-works/pi-mcp";

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const dispatchKey = (sourceMessageId: string, tool: string, args: unknown) =>
  `scoutbot:${createHash("sha256").update(stableJson([sourceMessageId, tool, args])).digest("hex")}`;
export const replyMessageId = (requestId: string) => `msg.scoutbot.${createHash("sha256").update(requestId).digest("hex")}`;
export type DispatchTurn = { sourceMessageId: string; threadId: string; brokerConversationId: string; conversationId: number; body: string; model: string; actorId: string; published?: boolean; text?: string };
export type DispatchCall = { key: string; sourceMessageId: string; conversationId: number; tool: "ask" | "messages_send"; args: Record<string, unknown>; callId: string; state: "intent" | "unknown" | "done"; receipt?: CallToolResult };
export type DispatchWaiter = { flightId: string; sourceMessageId: string; threadId: string; brokerConversationId: string; conversationId: number; model: string; actorId: string; stage: "dispatched" | "completed" | "submitted" | "published"; result?: unknown; text?: string };

/** Its own FULL-sync SQLite journal, never shared with scout-web. Unknown/corrupt state is fatal, not an empty ledger. */
export class ScoutbotDispatchJournal {
  private db: Database;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS dispatch_records(kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind,id));");
  }
  private read<T>(kind: string, id: string): T | undefined {
    const row = this.db.query<{ value: string }, [string, string]>("SELECT value FROM dispatch_records WHERE kind=? AND id=?").get(kind, id);
    return row ? JSON.parse(row.value) as T : undefined;
  }
  private write(kind: string, id: string, value: unknown) {
    this.db.query("INSERT INTO dispatch_records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value").run(kind, id, JSON.stringify(value));
  }
  private list<T>(kind: string): T[] { return this.db.query<{ value: string }, [string]>("SELECT value FROM dispatch_records WHERE kind=?").all(kind).map(row => JSON.parse(row.value) as T); }
  turn(id: string) { return this.read<DispatchTurn>("turn", id); }
  turns() { return this.list<DispatchTurn>("turn"); }
  saveTurn(turn: DispatchTurn) { this.write("turn", turn.sourceMessageId, turn); }
  active(conversationId: number): DispatchTurn | undefined {
    const id = this.read<string>("active", String(conversationId));
    return id ? this.turn(id) : undefined;
  }
  activate(turn: DispatchTurn) { this.saveTurn(turn); this.write("active", String(turn.conversationId), turn.sourceMessageId); }
  call(key: string) { return this.read<DispatchCall>("call", key); }
  calls() { return this.list<DispatchCall>("call"); }
  saveCall(call: DispatchCall) { this.write("call", call.key, call); }
  waiter(id: string) { return this.read<DispatchWaiter>("waiter", id); }
  waiters() { return this.list<DispatchWaiter>("waiter"); }
  saveWaiter(waiter: DispatchWaiter) { this.write("waiter", waiter.flightId, waiter); }
  close() { this.db.close(); }
}
