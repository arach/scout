import type { ObserveData, ObserveEvent } from "../../lib/types.ts";
import { filesFromObserveEvents } from "../../lib/lane-observe.ts";

export type ObservedSessionTurn = {
  id: string;
  boundary: "prompt" | "window";
  prompt: ObserveEvent[];
  steps: ObserveEvent[];
  messages: ObserveEvent[];
  start: number;
  end: number;
  working: boolean;
  fileCount: number;
};
/** Observed user requests delimit turns. Never invent broker turn ids or import
 * harness text into Scout records. An incomplete leading window stays labelled
 * as observed context; synthetic timestamps must not be advertised as duration. */
export function observedSessionTurns(data: ObserveData, working: boolean): ObservedSessionTurn[] {
  const turns: ObservedSessionTurn[] = [];
  let current: ObservedSessionTurn | null = null;
  for (const event of data.events) {
    const isPrompt = event.kind === "ask" && !event.to;
    if (!current || isPrompt) {
      current = { id: event.id, boundary: isPrompt ? "prompt" : "window", prompt: [], steps: [], messages: [], start: event.t, end: event.t, working: false, fileCount: 0 };
      turns.push(current);
    }
    current.end = Math.max(current.end, event.t);
    if (isPrompt) current.prompt.push(event);
    else if (event.kind === "message" || event.kind === "ask") current.messages.push(event);
    else current.steps.push(event);
  }
  for (const turn of turns) {
    // Generic shell/agent arguments can contain prose that resembles a path.
    // Count only the Observe inventory or explicit file-tool/diff evidence.
    const fileSteps = turn.steps.filter((event) => event.diff || /^(read|edit|write|read_file|edit_file|write_file)$/iu.test(event.tool ?? ""));
    turn.fileCount = new Set([
      ...filesFromObserveEvents(fileSteps).map((file) => file.path),
      ...data.files.filter((file) => file.lastT >= turn.start && file.lastT <= turn.end).map((file) => file.path),
    ]).size;
    turn.working = working && turn === turns.at(-1);
  }
  return turns;
}
export function observedStepCount(turn: ObservedSessionTurn): number {
  return turn.steps.filter((event) => event.kind === "tool" && event.tool !== "res" || event.kind === "think").length;
}
export function observedTurnDuration(turn: ObservedSessionTurn): string {
  const seconds = Math.max(0, Math.round(turn.end - turn.start));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60 ? ` ${seconds % 60}s` : ""}`;
}
