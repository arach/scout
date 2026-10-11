import type { WorkDetail, WorkMaterial } from "../../lib/types.ts";

/* Pure readings of a work item, shared by the Work page and the companion's Work card. */

export type MadeLink = { label: string; material: WorkMaterial; display: string };

export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 && m < 30 ? `${m}m ${s % 60}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

export function closingEvent(detail: WorkDetail) {
  return [...detail.timeline]
    .filter((item) => item.kind === "collaboration_event" && item.detailKind === "done")
    .sort((a, b) => b.at - a.at)[0] ?? null;
}

export function touchedMaterials(detail: WorkDetail): WorkMaterial[] {
  return (detail.inventory?.materials ?? []).filter((m) => m.status !== "observed");
}

/** How the status plate reads: live work pulses, paused work rests, done settles. */
export function workStatusTone(detail: WorkDetail): "active" | "paused" | "done" | "idle" {
  if (detail.state === "done") return "done";
  if (detail.state === "waiting" || detail.state === "review") return "paused";
  const askState = detail.primaryInvocation?.state;
  if (detail.activeFlights.length > 0 || askState === "running" || askState === "waking" || detail.state === "working") return "active";
  return "idle";
}

/** The latest summary without its routing tag ("[ask:f-…] Done: …"). */
export function latestSummaryText(summary: string | null): string | null {
  const text = summary?.replace(/^\s*\[ask:[^\]]+\]\s*/i, "").trim();
  return text ? text : null;
}

export type WorkCue = {
  label: string;
  text: string;
  tone: "blocked" | "waiting";
  action?: { label: string; onClick: () => void };
};

/** The milestones the agent wrote, oldest first. */
export function workMilestones(detail: WorkDetail): { id: string; text: string; at: number }[] {
  // A summary tagged "[ask:…]" is the final reply echoed onto the event, not a milestone.
  return detail.timeline
    .filter((item) => item.kind === "collaboration_event" && item.detailKind !== "created" && item.summary?.trim() && !/^\s*\[ask:/i.test(item.summary))
    .sort((a, b) => a.at - b.at)
    .map((item) => ({ id: item.id, text: latestSummaryText(item.summary) ?? item.summary!, at: item.at }));
}

/** The agent's last written milestone, verbatim; the final reply only when there is none. */
export function lastMilestone(detail: WorkDetail): { text: string; at: number } | null {
  const event = workMilestones(detail).at(-1);
  if (event) return { text: event.text, at: event.at };
  const text = latestSummaryText(detail.lastMeaningfulSummary);
  return text ? { text, at: detail.lastMeaningfulAt } : null;
}

/** Say the state once: review + acceptance pending + your move is one phrase. */
export function workStateLabel(detail: WorkDetail): { main: string; sub: string | null } {
  const acceptance = detail.acceptanceState && detail.acceptanceState !== "none" ? detail.acceptanceState.replace(/_/g, " ") : null;
  if (detail.state === "review" && (!acceptance || acceptance === "pending")) {
    return { main: detail.nextMoveOwnerId === "operator" ? "Awaiting your review" : "In review", sub: null };
  }
  return { main: detail.currentPhase, sub: acceptance && acceptance !== "pending" ? `Acceptance ${acceptance}` : null };
}

/** How long the agent actually ran, not how long the ticket has been open. */
export function runSpan(detail: WorkDetail): number | null {
  const started = detail.timeline.filter((item) => item.kind === "flight_started").map((item) => item.at);
  const ended = detail.timeline.filter((item) => item.kind === "flight_completed").map((item) => item.at);
  if (started.length === 0) return null;
  const from = Math.min(...started);
  if (detail.activeFlights.length > 0) return Date.now() - from;
  return ended.length > 0 ? Math.max(...ended) - from : null;
}

const STUDY_PATH = /^design\/studio\/(?:app\/studies\/([^/]+)\/page\.tsx|views\/([^/]+)\.tsx)$/;

/** Documents and studies this work wrote, newest evidence first. */
export function madeLinks(detail: WorkDetail): MadeLink[] {
  const out: MadeLink[] = [];
  for (const material of touchedMaterials(detail)) {
    // git status alone is the shared checkout, not this agent; it must have written the file.
    if (!material.evidence.some((e) => e === "trace-write" || e === "trace-edit" || e === "broker")) continue;
    const study = material.path.match(STUDY_PATH);
    const outside = material.path.startsWith("/") || material.path.startsWith("~");
    if (study) {
      out.push({ label: "Studio study", material, display: `/studies/${study[1] ?? study[2]}` });
    } else if (material.kind === "plan" || material.kind === "spec" || material.kind === "doc") {
      out.push({ label: material.kind === "doc" ? "Doc" : material.kind === "plan" ? "Plan" : "Spec", material, display: material.path });
    } else if (outside && /\.(md|markdown|txt)$/i.test(material.path)) {
      out.push({ label: "Note", material, display: material.path.split("/").slice(-2).join("/") });
    }
  }
  return out.slice(0, 6);
}

