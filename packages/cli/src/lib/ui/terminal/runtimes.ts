import type { ScoutCapabilityMatrixSnapshot } from "@openscout/protocol";
import type { ScoutRuntimesReport } from "../../core/setup/runtimes.ts";

export function renderCapabilitySnapshotSummary(
  snapshot: ScoutCapabilityMatrixSnapshot | null,
): string[] {
  if (!snapshot) {
    return [
      "Capability snapshot:",
      "  Broker readout: unavailable",
    ];
  }

  const sourceCounts = new Map<string, number>();
  for (const source of snapshot.sources) {
    sourceCounts.set(source.kind, (sourceCounts.get(source.kind) ?? 0) + 1);
  }
  const sourceSummary = [...sourceCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, count]) => `${kind}: ${count}`)
    .join(", ");
  const readinessCounts = new Map<string, number>();
  for (const capability of snapshot.capabilities) {
    readinessCounts.set(
      capability.readiness.state,
      (readinessCounts.get(capability.readiness.state) ?? 0) + 1,
    );
  }
  const readinessSummary = ["ready", "degraded", "missing", "disabled", "unknown"]
    .map((state) => `${state}: ${readinessCounts.get(state) ?? 0}`)
    .join(", ");
  const harnessSupportCount = Object.keys(snapshot.harnessSupport ?? {}).length;

  const lines = [
    "Capability snapshot:",
    `  Sources: ${snapshot.sources.length}${sourceSummary ? ` (${sourceSummary})` : ""}`,
    `  Harness support maps: ${harnessSupportCount}`,
    `  Capability definitions: ${snapshot.capabilities.length} (${readinessSummary})`,
    `  Warnings: ${snapshot.warnings.length}`,
  ];

  for (const warning of snapshot.warnings.slice(0, 3)) {
    lines.push(`    - ${warning}`);
  }
  return lines;
}

export function renderScoutRuntimesReport(report: ScoutRuntimesReport): string {
  const lines = [
    `Context root: ${report.currentDirectory}`,
    `Harness catalog: ${report.harnessCatalogPath}`,
    `Known runtimes: ${report.catalog.entries.length}`,
    `Core broker: ${report.coreHealth.state} — ${report.coreHealth.detail}`,
    "App readiness: unavailable (private app not inspected; not required for core).",
  ];

  for (const entry of report.catalog.entries) {
    const support = Object.entries(entry.support)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key)
      .join(", ");

    lines.push(`  - ${entry.label} (${entry.name})`);
    lines.push(`    State: ${entry.readinessReport.state}`);
    lines.push(`    Detail: ${entry.readinessReport.detail}`);
    lines.push(`    Support: ${support || "none"}`);
    if (entry.readinessReport.binaryPath) {
      const version = entry.readinessReport.binaryVersion ? ` (${entry.readinessReport.binaryVersion})` : "";
      const source = entry.readinessReport.binarySource ? ` [${entry.readinessReport.binarySource}]` : "";
      lines.push(`    Binary: ${entry.readinessReport.binaryPath}${version}${source}`);
    }
    const alternates = entry.readinessReport.binaryCandidates
      ?.filter((candidate) => candidate.executable && !candidate.selected)
      .slice(0, 4) ?? [];
    if (alternates.length > 0) {
      lines.push("    Other binaries:");
      for (const candidate of alternates) {
        const version = candidate.version ? ` (${candidate.version})` : "";
        lines.push(`      - ${candidate.path}${version} [${candidate.source}]`);
      }
    }
    if (entry.readinessReport.missing.length > 0) {
      lines.push(`    Missing: ${entry.readinessReport.missing.join(" | ")}`);
    }
    if (entry.readinessReport.loginCommand) {
      lines.push(`    Login: ${entry.readinessReport.loginCommand}`);
    }
  }

  lines.push("", "Exact runtime capabilities:");
  for (const harness of report.runtimeCapabilities.harnesses) {
    const models = report.runtimeCapabilities.models
      .filter((model) => model.harnesses.includes(harness.id))
      .map((model) => model.id);
    const efforts = report.runtimeCapabilities.efforts
      .filter((effort) => effort.harnesses.includes(harness.id))
      .map((effort) => effort.id);
    lines.push(`  - ${harness.id}`);
    lines.push(`    Models: ${models.join(", ") || "not selectable"}`);
    lines.push(`    Efforts: ${efforts.join(", ") || "not selectable"}`);
  }

  lines.push("", ...renderCapabilitySnapshotSummary(report.capabilities));

  return lines.join("\n");
}
