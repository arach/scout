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
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Activity wording mirrors the Codex thread, without inventing tool results. */
export function sessionWorkLabel(event: ObserveEvent): string {
  const tool = (event.tool ?? "").toLowerCase();
  const arg = event.arg || event.text;
  if (event.kind === "think") return event.live ? "Thinking" : "Thought";
  if (event.kind !== "tool") return event.text;
  if (tool === "res") return "Output";
  if (/^(read|read_file|view_image)$/u.test(tool)) return `Read ${arg}`;
  if (/^(edit|write|edit_file|write_file|apply_patch|multiedit)$/u.test(tool)) return `Edited ${arg}`;
  if (/^(search|grep|glob|rg|web_search|web|find|web\.run)$/u.test(tool)) return `Searched ${arg}`;
  if (/^(bash|shell|exec_command|run|terminal|command)$/u.test(tool)) return `Ran ${arg}`;
  return `${event.tool || "Tool"} ${arg}`;
}

/** Counts only explicit per-file diff evidence. Multi-file aggregate patches
 * cannot be attributed to one file; missing counts stay missing, not zero. */
export function observedFileEdits(events: ObserveEvent[]): Map<string, { add: number; del: number }> {
  const counts = new Map<string, { add: number; del: number }>();
  for (const event of events) {
    if (!event.diff) continue;
    const files = filesFromObserveEvents([event]);
    if (files.length !== 1) continue;
    const path = files[0]!.path, previous = counts.get(path) ?? { add: 0, del: 0 };
    counts.set(path, { add: previous.add + event.diff.add, del: previous.del + event.diff.del });
  }
  return counts;
}
