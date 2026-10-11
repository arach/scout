import { observeEventWallMs } from "../../../lib/lane-observe.ts";
import type { ObserveEvent } from "../../../lib/types.ts";
import type { AgentLane } from "../agent-lanes-model.ts";
import { floorPreviewText } from "../floor-preview-text.ts";

export type ActivityPreview = { id: string; label: string; text: string; at: number | null };

function describe(event: ObserveEvent): string {
  if (event.kind !== "tool") return floorPreviewText(event.text, 480);
  // Keep command payloads out of a glanceable preview. Neutral wording makes
  // an old tool call readable without implying it is still running or finished.
  const tool = event.tool || "tool";
  return /read|open|view/i.test(tool) ? "Context read"
    : /edit|write|patch/i.test(tool) ? "File update"
    : /search|grep|find/i.test(tool) ? "Workspace search"
    : /bash|exec|terminal/i.test(tool) ? "Command execution"
    : `Tool use · ${tool}`;
}

/** Latest available history, independent of active turn, roster window or age.
 * Timestamps come from the observed event, never from a roster heartbeat. */
export function activityPreview(lane: AgentLane, now: number, limit = 4): ActivityPreview[] {
  const seen = new Set<string>();
  const events = (lane.observe?.events ?? []).flatMap((event, index) => {
    if (!["tool", "message", "ask", "note"].includes(event.kind)) return [];
    const at = observeEventWallMs(event, lane.observe?.metadata?.session?.sessionStart);
    const text = describe(event);
    if (at === null || at > now + 2 * 60_000 || !text) return [];
    return [{ id: event.id, at, text, index, label: event.kind === "tool" ? "Tool" : event.kind === "ask" ? "Request" : "Update" }];
  }).sort((a, b) => b.at - a.at || b.index - a.index).filter(event => {
    if (seen.has(event.id)) return false;
    seen.add(event.id); return true;
  }).slice(0, Math.max(1, limit));
  if (events.length) return events;
  const task = floorPreviewText(lane.facts?.currentTask, 480);
  return [{ id: "fallback", at: null, label: task ? "Last reported task" : "Activity", text: task || "No activity has been recorded for this agent yet." }];
}
