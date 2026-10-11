import type { ScoutRecentEntry, ScoutRecentReport } from "../../core/mesh/recent.ts";

function oneLine(value: string | null): string {
  return value?.replace(/[\r\n\t\x00-\x1f\x7f]+/g, " ") || "—";
}

function renderEntry(entry: ScoutRecentEntry): string {
  const timestamp = entry.timestamp === null ? "no timestamp" : `${new Date(entry.timestamp).toISOString()} (${entry.timestampKind})`;
  return [
    entry.nodeName ?? entry.nodeId, entry.projectRoot, entry.harness,
    `session ${entry.sessionId ?? "—"}`, timestamp,
    `${entry.kind} ${entry.id} [${entry.state}]`,
    ...(entry.workState ? [`work [${entry.workState}] ${entry.workTitle ?? "—"}`] : []),
  ].map(oneLine).join(" · ");
}

export function renderScoutRecent(report: ScoutRecentReport): string {
  const lines = [report.scope];
  if (report.since !== null) lines.push(`Since ${new Date(report.since).toISOString()} (on each row's reported timestamp).`);
  for (const machine of report.machines) {
    const label = machine.nodeName ? `${oneLine(machine.nodeName)} (${oneLine(machine.nodeId)})` : oneLine(machine.nodeId);
    if (machine.status !== "ok") {
      lines.push(`${label}: ${oneLine(machine.error)}; recent activity unknown.`);
      continue;
    }
    lines.push(`${label}: ${Object.entries(machine.coverage).map(([kind, count]) => `${kind} ${count.returned}/${count.total}${count.truncated ? " [truncated]" : ""}`).join(", ")}`);
    if (report.since !== null && Object.values(machine.coverage).some((count) => count.truncated)) {
      lines.push("  Bounded response: caps apply before the local time filter; older/unreturned rows may be missing.");
    }
    lines.push(...machine.entries.map(renderEntry));
    if (machine.noTimestamp.length) {
      lines.push(`${label} — no timestamp:`);
      lines.push(...machine.noTimestamp.map(renderEntry));
    }
    if (!machine.entries.length && !machine.noTimestamp.length) {
      lines.push(`${label}: no matching rows in this bounded node-state response.`);
    }
  }
  return lines.join("\n");
}
