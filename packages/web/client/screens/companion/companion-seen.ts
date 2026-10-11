import type { CompanionCardState } from "./companion-model.ts";

/**
 * Asks the operator has dismissed from the companion, by work id, with the
 * activity time they had seen. Kept in this browser only: dismissing clears
 * the figure's alert, not the work's state, and anything newer brings the
 * alert back.
 */
export type SeenAsks = ReadonlyMap<string, number>;

const STORAGE_KEY = "scout.companion.seen-asks.v1";
const MAX_ENTRIES = 200;

export function readSeenAsks(): Map<string, number> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return new Map();
    return new Map(Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
  } catch {
    return new Map();
  }
}

export function writeSeenAsks(seen: ReadonlyMap<string, number>): void {
  try {
    // Newest dismissals win when the list is trimmed.
    const kept = [...seen].sort((a, b) => b[1] - a[1]).slice(0, MAX_ENTRIES);
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Private mode or blocked storage: the dismissal lasts this page only.
  }
}

/** A dismissed ask whose activity has not moved since. */
export function isSeenAsk(
  seen: SeenAsks,
  workId: string,
  state: CompanionCardState | undefined,
  lastActivityAt: number,
): boolean {
  if (state !== "question" && state !== "blocked") return false;
  const at = seen.get(workId);
  return at !== undefined && lastActivityAt <= at;
}
