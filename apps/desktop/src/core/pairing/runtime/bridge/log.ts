// Bridge logger — writes to ~/.scout/pairing/bridge.log
//
// Usage:
//   import { log } from "./log.ts";
//   log.info("rpc", "prompt/send", { sessionId: "abc" });
//   log.error("transport", "decrypt failed", err);
//
// Debug lines (per-RPC traffic, connects) are dropped unless
// OPENSCOUT_BRIDGE_LOG_LEVEL=debug. The file rotates to bridge.log.1 at
// MAX_LOG_BYTES, so at most two files' worth is ever kept.
//
// Tail in another terminal:
//   tail -f ~/.scout/pairing/bridge.log

import { appendFileSync, mkdirSync, renameSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const LOG_DIR = join(homedir(), ".scout/pairing");
const LOG_FILE = join(LOG_DIR, "bridge.log");
const MAX_LOG_BYTES = 10 * 1024 * 1024;
const ROTATE_CHECK_EVERY = 500;

mkdirSync(LOG_DIR, { recursive: true });

type Level = "debug" | "info" | "warn" | "error";

const debugEnabled = process.env.OPENSCOUT_BRIDGE_LOG_LEVEL === "debug";
let writesSinceRotateCheck = ROTATE_CHECK_EVERY;

function rotateIfLarge(): void {
  if (++writesSinceRotateCheck < ROTATE_CHECK_EVERY) return;
  writesSinceRotateCheck = 0;
  try {
    if (statSync(LOG_FILE).size > MAX_LOG_BYTES) renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch { /* missing file or race with another writer */ }
}

function write(level: Level, category: string, message: string, data?: unknown): void {
  if (level === "debug" && !debugEnabled) return;
  const ts = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
  const lvl = level.toUpperCase().padEnd(5);
  const cat = category.padEnd(12);
  const prefix = `${ts} ${lvl} ${cat}`;
  const body = data ? `${message} ${JSON.stringify(data)}` : message;
  const line = level === "error"
    ? `${prefix} ⚠ ${body}\n`
    : `${prefix} ${body}\n`;
  try {
    rotateIfLarge();
    appendFileSync(LOG_FILE, line);
  } catch { /* don't crash on log failure */ }
}

export const log = {
  debug: (cat: string, msg: string, data?: unknown) => write("debug", cat, msg, data),
  info:  (cat: string, msg: string, data?: unknown) => write("info",  cat, msg, data),
  warn:  (cat: string, msg: string, data?: unknown) => write("warn",  cat, msg, data),
  error: (cat: string, msg: string, data?: unknown) => write("error", cat, msg, data),
  /** Path to the log file, for display at startup. */
  path: LOG_FILE,
};
