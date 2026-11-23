import { closeSync, existsSync, openSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { openRuntimeSqliteDatabase } from "../sqlite-adapter.js";
import { resolveHubHome } from "./state.js";

type Kind = "collect" | "pull" | "webhook" | "rejection" | "connect" | "disconnect" | "test";
type Activity = { id: string; at: string; kind: Kind; summary: string };

function lines(home: string): string[] {
  const file = join(home, "activity.jsonl");
  return existsSync(file) ? readFileSync(file, "utf8").trimEnd().split("\n").filter(Boolean) : [];
}

export function recordActivity(kind: Kind, summary: string, home = resolveHubHome()) {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  // Both CLI and daemon write here. SQLite supplies a portable process lock
  // that releases on crash; the JSONL file itself is the only event store.
  const lockPath = join(home, "activity.lock");
  closeSync(openSync(lockPath, "a", 0o600));
  const lock = openRuntimeSqliteDatabase(lockPath);
  try {
    lock.exec("PRAGMA busy_timeout = 3000; BEGIN IMMEDIATE");
    const rows = lines(home);
    const last = rows.at(-1);
    const sequence = last ? parseInt((JSON.parse(last) as Activity).id, 36) + 1 : 1;
    const row: Activity = { id: sequence.toString(36).padStart(10, "0"), at: new Date().toISOString(), kind, summary };
    rows.push(JSON.stringify(row));
    const file = join(home, "activity.jsonl");
    writeFileSync(file + ".tmp", rows.slice(-1000).join("\n") + "\n", { mode: 0o600 });
    renameSync(file + ".tmp", file);
  } finally {
    lock.close?.();
  }
}

export function activityPage(before: string | null, limit: number, home = resolveHubHome()) {
  const rows = lines(home).reverse().map(line => JSON.parse(line) as Activity)
    .filter(row => !before || row.id < before);
  const items = rows.slice(0, limit);
  return { items, nextBefore: rows.length > limit ? items.at(-1)!.id : null };
}
