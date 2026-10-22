import { renderCapabilitySnapshotSummary } from "./runtimes.ts";
export { renderScoutRuntimesReport } from "./runtimes.ts";
import { assessSetupCompletion, type SetupCompletion } from "@openscout/runtime/onboarding";
import type {
  ScoutDoctorReport,
  ScoutLocalEdgeDoctorReport,
  ScoutLocalEdgeHostResolution,
  ScoutProjectInventoryEntry,
  ScoutSetupReport,
} from "../../core/setup/service.ts";
import { deriveOpenScoutInstanceLayout } from "@openscout/runtime/instance";

type LocalEdgeDependencyReport = ScoutSetupReport["localEdge"];

function renderInstanceLine(): string {
  const layout = deriveOpenScoutInstanceLayout();
  return `Instance: ${layout.name}${layout.root ? ` (root ${layout.root})` : ""}`;
}

function renderBrokerHealthTransportLines(
  broker: ScoutDoctorReport["broker"] | ScoutSetupReport["broker"],
): string[] {
  const lines = [
    `  Broker socket: ${broker.brokerSocketPath}`,
    `  Health transport: ${broker.health.transport ?? "unknown"}`,
  ];
  if (broker.health.socketFallbackError) {
    lines.push(`  Socket fallback: ${broker.health.socketFallbackError}`);
  }
  return lines;
}

export function renderScoutDoctorStreamingLead(input: { repoRoot: string; currentDirectory: string }): string {
  return [
    "Scout doctor",
    renderInstanceLine(),
    `Repo root: ${input.repoRoot}`,
    `Context root: ${input.currentDirectory}`,
    "",
    "Discovering projects…",
    "",
  ].join("\n");
}

export function formatScoutDoctorStreamedProjectEntry(project: ScoutProjectInventoryEntry): string {
  const harnesses = project.harnesses
    .map((entry) => `${entry.harness} (${entry.detail})`)
    .join(" | ");

  const lines = [
    `  - ${project.displayName} (${project.agentId})`,
    `    Root: ${project.projectRoot}`,
    `    Source root: ${project.sourceRoot}`,
    `    Relative path: ${project.relativePath}`,
    `    State: ${project.registrationKind === "configured" ? "configured agent" : "discovered project"}`,
    `    Default harness: ${project.defaultHarness}`,
    `    Harnesses: ${harnesses}`,
  ];
  if (project.projectConfigPath) {
    lines.push(`    Manifest: ${project.projectConfigPath}`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderScoutDoctorTailAfterStream(report: ScoutDoctorReport): string {
  const roots = report.setup.settings.discovery.workspaceRoots;
  const n = report.setup.projectInventory.length;
  const lines = [
    "",
    `Project inventory: ${n} project${n === 1 ? "" : "s"} (streamed above).`,
    "",
    `Support directory: ${report.setup.supportDirectory}`,
    `Settings: ${report.setup.settingsPath}`,
    `Harness catalog: ${report.setup.harnessCatalogPath}`,
    `Agent registry: ${report.setup.relayAgentsPath}`,
    `Managed installs: ${report.setup.managedInstallsPath}`,
    `Current project config: ${report.setup.currentProjectConfigPath ?? "not found"}`,
    "",
    "Source roots:",
    ...(roots.length > 0 ? roots.map((root) => `  - ${root}`) : ["  (none — Scout is not scanning any parent folders for repos.)"]),
    ...(roots.length === 0
      ? [
          "",
          "Tip: Set discovery.workspaceRoots in your OpenScout settings file, or run `scout setup --source-root <path>`.",
        ]
      : []),
    ...(roots.length > 0 && n === 0
      ? [
          "",
          "Tip: Under each source root, projects need a signal such as .git, a language manifest (Cargo.toml,",
          "go.mod, pyproject.toml, Gemfile, Package.swift, …), or agent docs (CLAUDE.md, AGENTS.md).",
          "Symlinked directories are followed.",
        ]
      : []),
    "",
    "Agent defaults:",
    `  Harness: ${report.setup.settings.agents.defaultHarness}`,
    `  Capabilities: ${report.setup.settings.agents.defaultCapabilities.join(", ")}`,
    `  Session prefix: ${report.setup.settings.agents.sessionPrefix}`,
    "",
    "Base service:",
    `  Label: ${report.broker.label}`,
    `  Broker URL: ${report.broker.brokerUrl}`,
    ...renderBrokerHealthTransportLines(report.broker),
    `  Installed: ${report.broker.installed ? "yes" : "no"}`,
    `  Loaded: ${report.broker.loaded ? "yes" : "no"}`,
    `  Reachable: ${report.broker.reachable ? "yes" : "no"}`,
    ...(report.broker.serviceAdapter === "headless-foreground"
      ? ["  Lifecycle: foreground process (managed externally)"]
      : [`  LaunchAgent: ${report.broker.launchAgentPath}`, `  Bootout: ${report.broker.bootoutCommand}`]),
    `  Stdout: ${report.broker.stdoutLogPath}`,
    `  Stderr: ${report.broker.stderrLogPath}`,
    "",
    ...renderLocalEdgeDoctor(report.localEdge),
    "",
    ...renderTerminalPtyReport(report.terminalPty),
    "",
    ...renderSystemProbes(report.systemProbes),
    "",
    `Known runtimes: ${report.catalog.entries.length}`,
  ];

  for (const entry of report.catalog.entries) {
    lines.push(`  - ${entry.label} (${entry.name})`);
    lines.push(`    State: ${entry.readinessReport.state}`);
    lines.push(`    Detail: ${entry.readinessReport.detail}`);
    if (entry.readinessReport.missing.length > 0) {
      lines.push(`    Missing: ${entry.readinessReport.missing.join(" | ")}`);
    }
  }

  lines.push("", ...renderCapabilitySnapshotSummary(report.capabilities));

  return lines.join("\n");
}

function renderProjectInventory(projects: ScoutProjectInventoryEntry[]): string[] {
  const lines = [`Project inventory: ${projects.length}`];
  if (projects.length === 0) {
    lines.push("  No projects discovered yet.");
    return lines;
  }

  for (const project of projects) {
    const harnesses = project.harnesses
      .map((entry) => `${entry.harness} (${entry.detail})`)
      .join(" | ");

    lines.push(`  - ${project.displayName} (${project.agentId})`);
    lines.push(`    Root: ${project.projectRoot}`);
    lines.push(`    Source root: ${project.sourceRoot}`);
    lines.push(`    Relative path: ${project.relativePath}`);
    lines.push(`    State: ${project.registrationKind === "configured" ? "configured agent" : "discovered project"}`);
    lines.push(`    Default harness: ${project.defaultHarness}`);
    lines.push(`    Harnesses: ${harnesses}`);
    if (project.projectConfigPath) {
      lines.push(`    Manifest: ${project.projectConfigPath}`);
    }
  }

  return lines;
}

function renderLocalEdgeDependencyReport(report: LocalEdgeDependencyReport): string[] {
  const lines = [
    "Local edge:",
    `  Caddy: ${report.status}`,
    `  Detail: ${report.detail}`,
  ];
  if (report.caddyPath) {
    lines.push(`  Path: ${report.caddyPath}`);
  }
  if (report.caddyVersion) {
    lines.push(`  Version: ${report.caddyVersion}`);
  }
  if (report.installCommand) {
    lines.push(`  Install: ${report.installCommand}`);
  }
  return lines;
}

function renderTerminalPtyReport(report: ScoutDoctorReport["terminalPty"]): string[] {
  const lines = [
    "Web terminal (Node PTY relay):",
    `  State: ${report.status}`,
    `  Detail: ${report.detail}`,
  ];
  if (report.nodePath) {
    lines.push(`  Node: ${report.nodePath}${report.nodeVersion ? ` (${report.nodeVersion})` : ""}`);
  }
  lines.push(
    report.bindingPath
      ? `  Binding: ${report.bindingPackage} -> ${report.bindingPath}`
      : `  Binding: ${report.bindingPackage}`,
  );
  if (report.installCommand) {
    lines.push(`  Install: ${report.installCommand}`);
  }
  return lines;
}

function renderSystemProbes(report: ScoutDoctorReport["systemProbes"]): string[] {
  const lines = [
    "System probes:",
    `  Socket: ${report.socketPath}`,
    `  Socket exists: ${report.socketExists ? "yes" : "no"}`,
    `  Daemon observed: ${report.daemonObserved ? "yes" : "no"}`,
    `  Daemon version: ${report.daemonVersion ?? "-"}`,
    `  Capabilities: ${report.supportedProbeIds.length > 0 ? report.supportedProbeIds.join(", ") : "-"}`,
  ];
  if (report.lastError) {
    lines.push(`  Last scoutd error: ${report.lastError}`);
  }
  for (const family of report.families) {
    const fallback = family.fallbackSince
      ? `; fallback ${Math.round((family.fallbackAgeMs ?? 0) / 1000)}s: ${family.fallbackReason ?? "unknown"}`
      : "";
    lines.push(`  - ${family.id}: ${family.backend} (${family.status})${fallback}`);
  }
  for (const warning of report.warnings) {
    lines.push(`  Warning: ${warning}`);
  }
  return lines;
}

function formatLocalEdgeHostResolution(resolution: ScoutLocalEdgeHostResolution): string {
  if (resolution.resolved) {
    return `${resolution.host} -> ${resolution.addresses.join(", ")}`;
  }
  return `${resolution.host} -> not resolved${resolution.error ? ` (${resolution.error})` : ""}`;
}

function renderLocalEdgeDoctor(edge: ScoutLocalEdgeDoctorReport): string[] {
  const lines = [
    "Local web edge:",
    `  State: ${edge.state}`,
    `  Caddy: ${edge.dependency.status}`,
    `  Detail: ${edge.dependency.detail}`,
  ];
  if (edge.dependency.caddyPath) {
    lines.push(`  Path: ${edge.dependency.caddyPath}`);
  }
  if (edge.dependency.caddyVersion) {
    lines.push(`  Version: ${edge.dependency.caddyVersion}`);
  }
  if (edge.dependency.installCommand) {
    lines.push(`  Install: ${edge.dependency.installCommand}`);
  }
  lines.push(
    `  Portal host: ${formatLocalEdgeHostResolution(edge.dns.portal)}`,
    `  Node host: ${formatLocalEdgeHostResolution(edge.dns.node)}`,
    `  Caddyfile: ${edge.caddyfilePath}`,
    `  HTTP listener: ${edge.listeners.http.listening ? "yes" : "no"} (127.0.0.1:${edge.listeners.http.port})`,
    `  HTTPS listener: ${edge.listeners.https.listening ? "yes" : "no"} (127.0.0.1:${edge.listeners.https.port})`,
  );

  for (const hint of edge.hints) {
    lines.push(`  Hint: ${hint}`);
  }

  return lines;
}

export function renderScoutDoctorReport(report: ScoutDoctorReport): string {
  const roots = report.setup.settings.discovery.workspaceRoots;
  const lines = [
    "Scout doctor",
    renderInstanceLine(),
    `Repo root: ${report.repoRoot}`,
    `Context root: ${report.currentDirectory}`,
    `Support directory: ${report.setup.supportDirectory}`,
    `Settings: ${report.setup.settingsPath}`,
    `Harness catalog: ${report.setup.harnessCatalogPath}`,
    `Agent registry: ${report.setup.relayAgentsPath}`,
    `Managed installs: ${report.setup.managedInstallsPath}`,
    `Current project config: ${report.setup.currentProjectConfigPath ?? "not found"}`,
    "",
    "Source roots:",
    ...(roots.length > 0 ? roots.map((root) => `  - ${root}`) : ["  (none — Scout is not scanning any parent folders for repos.)"]),
    ...(roots.length === 0
      ? [
          "",
          "Tip: Set discovery.workspaceRoots in your OpenScout settings file, or run `scout setup --source-root <path>`.",
        ]
      : []),
    ...(roots.length > 0 && report.setup.projectInventory.length === 0
      ? [
          "",
          "Tip: Under each source root, projects need a signal such as .git, a language manifest (Cargo.toml,",
          "go.mod, pyproject.toml, Gemfile, Package.swift, …), or agent docs (CLAUDE.md, AGENTS.md).",
          "Symlinked directories are followed.",
        ]
      : []),
    "",
    "Agent defaults:",
    `  Harness: ${report.setup.settings.agents.defaultHarness}`,
    `  Capabilities: ${report.setup.settings.agents.defaultCapabilities.join(", ")}`,
    `  Session prefix: ${report.setup.settings.agents.sessionPrefix}`,
    "",
    ...renderProjectInventory(report.setup.projectInventory),
    "",
    "Base service:",
    `  Label: ${report.broker.label}`,
    `  Broker URL: ${report.broker.brokerUrl}`,
    ...renderBrokerHealthTransportLines(report.broker),
    `  Installed: ${report.broker.installed ? "yes" : "no"}`,
    `  Loaded: ${report.broker.loaded ? "yes" : "no"}`,
    `  Reachable: ${report.broker.reachable ? "yes" : "no"}`,
    ...(report.broker.serviceAdapter === "headless-foreground"
      ? ["  Lifecycle: foreground process (managed externally)"]
      : [`  LaunchAgent: ${report.broker.launchAgentPath}`, `  Bootout: ${report.broker.bootoutCommand}`]),
    `  Stdout: ${report.broker.stdoutLogPath}`,
    `  Stderr: ${report.broker.stderrLogPath}`,
    "",
    ...renderLocalEdgeDoctor(report.localEdge),
    "",
    ...renderTerminalPtyReport(report.terminalPty),
    "",
    ...renderSystemProbes(report.systemProbes),
    "",
    `Known runtimes: ${report.catalog.entries.length}`,
  ];

  for (const entry of report.catalog.entries) {
    lines.push(`  - ${entry.label} (${entry.name})`);
    lines.push(`    State: ${entry.readinessReport.state}`);
    lines.push(`    Detail: ${entry.readinessReport.detail}`);
    if (entry.readinessReport.missing.length > 0) {
      lines.push(`    Missing: ${entry.readinessReport.missing.join(" | ")}`);
    }
  }

  lines.push("", ...renderCapabilitySnapshotSummary(report.capabilities));

  return lines.join("\n");
}

export function renderScoutSetupReport(report: ScoutSetupReport, completion: SetupCompletion = assessSetupCompletion(report)): string {
  const lines = [
    completion.headline,
    `Context root: ${report.currentDirectory}`,
    `Support directory: ${report.setup.supportDirectory}`,
    `Settings: ${report.setup.settingsPath}`,
    `Harness catalog: ${report.setup.harnessCatalogPath}`,
    `Agent registry: ${report.setup.relayAgentsPath}`,
    `Managed installs: ${report.setup.managedInstallsPath}`,
    `Claude statusline: ${report.claudeStatusline.status} (${report.claudeStatusline.wrapperPath})`,
    `Current project config: ${report.setup.currentProjectConfigPath ?? "not created"}`,
    `Created project config: ${report.setup.createdProjectConfig ? "yes" : "no"}`,
    "",
    "Source roots:",
    ...report.setup.settings.discovery.workspaceRoots.map((root) => `  - ${root}`),
    "",
    ...renderProjectInventory(report.setup.projectInventory),
    "",
    "Base service:",
    `  Label: ${report.broker.label}`,
    `  Broker URL: ${report.broker.brokerUrl}`,
    ...renderBrokerHealthTransportLines(report.broker),
    `  Reachable: ${report.broker.reachable ? "yes" : "no"}`,
    ...(report.broker.serviceAdapter === "headless-foreground"
      ? ["  Lifecycle: foreground process (managed externally)"]
      : [`  LaunchAgent: ${report.broker.launchAgentPath}`, `  Bootout: ${report.broker.bootoutCommand}`]),
    `  Logs: ${report.broker.stdoutLogPath} | ${report.broker.stderrLogPath}`,
  ];

  if (report.brokerWarning) {
    lines.push(`  Error: ${report.brokerWarning}`);
  }
  for (const entry of report.scoutSkill.entries.filter((entry) => entry.status === "error")) {
    lines.push(`  Error: ${entry.error ?? `Skill install failed: ${entry.id}`}`);
  }
  if (report.claudeStatusline.status === "error") lines.push(`  Error: ${report.claudeStatusline.error ?? "Claude statusline install failed"}`);
  if (completion.outcome === "handoff" && report.brokerHandoff) {
    lines.push(`  ${report.brokerHandoff.detail}`);
  } else if (!report.broker.health.ok) {
    lines.push(`  Health error: ${report.broker.health.error ?? "Broker health verification failed"}`);
  }

  lines.push("", ...renderLocalEdgeDependencyReport(report.localEdge));

  lines.push("", "Harnesses:");
  for (const entry of report.catalog.entries) {
    lines.push(`  - ${entry.label} (${entry.name})`);
    lines.push(`    State: ${entry.readinessReport.state}`);
    lines.push(`    Detail: ${entry.readinessReport.detail}`);
  }

  lines.push("", `Next: ${completion.nextStep}`, `Browser: ${completion.webUrl} (starts on demand)`);
  if (completion.browserGuidance) lines.push(completion.browserGuidance);
  lines.push("", "Also available:", ...completion.alsoAvailable.map((step) => `  ${step}`));

  return lines.join("\n");
}
