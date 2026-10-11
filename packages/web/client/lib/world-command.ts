import type { ScoutbotUiAction } from "./scoutbot.ts";

/**
 * Hand-off for `world.command` UI actions (always-on voice, Scoutbot) to the
 * World · Week HUD. The shell applies every UI action; this one only means
 * something to a mounted HUD, so it waits here briefly when it arrives with a
 * navigate to /ops/week and the HUD is still reading the week.
 */

export type WorldCommandAction = Extract<ScoutbotUiAction, { type: "world.command" }>;

const PENDING_TTL_MS = 30_000;
let handler: ((action: WorldCommandAction) => void) | null = null;
let pending: Array<{ action: WorldCommandAction; at: number }> = [];

export function deliverWorldCommand(action: WorldCommandAction): void {
  if (handler) {
    handler(action);
    return;
  }
  pending.push({ action, at: Date.now() });
}

/** The mounted HUD takes commands (and anything that arrived just before it). */
export function takeWorldCommands(fn: (action: WorldCommandAction) => void): () => void {
  handler = fn;
  const fresh = pending.filter((entry) => Date.now() - entry.at < PENDING_TTL_MS);
  pending = [];
  for (const entry of fresh) fn(entry.action);
  return () => {
    if (handler === fn) handler = null;
  };
}
