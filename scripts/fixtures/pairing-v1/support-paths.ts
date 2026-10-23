import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { deriveOpenScoutInstanceLayout } from "./instance.js";

export type OpenScoutSupportPaths = {
  supportDirectory: string;
  logsDirectory: string;
  appLogsDirectory: string;
  brokerLogsDirectory: string;
  runtimeDirectory: string;
  catalogDirectory: string;
  relayAgentsDirectory: string;
  settingsPath: string;
  harnessCatalogPath: string;
  relayAgentsRegistryPath: string;
  managedInstallsPath: string;
  hostInfoPath: string;
  relayHubDirectory: string;
  controlHome: string;
  knowledgeDirectory: string;
  knowledgeQmdDirectory: string;
  knowledgeSqlitePath: string;
  desktopStatusPath: string;
  workspaceStatePath: string;
  cutoverMarkerPath: string;
};

const OPENSCOUT_RPC_CUTOVER_MARKER = "rpc-runtime-cutover-v1";

/**
 * True when this process is a test run. NODE_ENV=test is the primary signal,
 * but bun test does not override a preset NODE_ENV (a dev shell exporting
 * NODE_ENV=development silently disarmed the old check), so also recognize
 * the runner by its entrypoint: under bun test the main module is always a
 * test file.
 */
export function isTestRunnerProcess(): boolean {
  if (process.env.NODE_ENV === "test") return true;
  const entry = typeof Bun !== "undefined" ? Bun.main : process.argv[1] ?? "";
  return /[._](test|spec)\.[cm]?[jt]sx?$/.test(entry);
}

/**
 * Tests must never touch real user data. Every writer of OpenScout user state
 * calls this first: under a test runner the write is refused unless the
 * isolation env var redirects it to a temp directory. This exists because an
 * unisolated test once persisted its fake temp-home workspaceRoots into the
 * operator's real settings.json.
 */
export function assertTestIsolatedUserData(operation: string, isolationEnvKey: string): void {
  if (!isTestRunnerProcess()) return;
  if (process.env[isolationEnvKey]?.trim()) return;
  throw new Error(
    `Refusing to ${operation} under a test runner without ${isolationEnvKey} set. `
      + "Tests must isolate OpenScout user data in a temp directory (see prepareHome in onboarding.test.ts).",
  );
}

/**
 * Durable support directory when OPENSCOUT_SUPPORT_DIRECTORY is unset, for
 * the current OPENSCOUT_INSTANCE. Prod on Darwin stays
 * ~/Library/Application Support/OpenScout; prod elsewhere uses
 * ${XDG_DATA_HOME:-~/.local/share}/openscout. A non-prod instance uses
 * ~/.openscout/instances/<name>/support on every platform.
 */
export function defaultOpenScoutSupportDirectory(home = homedir()): string {
  return deriveOpenScoutInstanceLayout({ home }).supportDirectory;
}

/** Control-plane home when OPENSCOUT_CONTROL_HOME is unset, for the current instance. */
export function defaultOpenScoutControlHome(home = homedir()): string {
  return deriveOpenScoutInstanceLayout({ home }).controlHome;
}

function envPath(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

/**
 * OPENSCOUT_HOME (config.json, user.json, run/ sockets, zellij sockets, chat):
 * ~/.openscout for prod, the instance root otherwise.
 */
export function resolveOpenScoutHome(): string {
  return envPath("OPENSCOUT_HOME") ?? deriveOpenScoutInstanceLayout().openscoutHome;
}

/**
 * OPENSCOUT_SCOUT_HOME: the `~/.scout` class of state (local edge, CLI logs,
 * CLI mtime cache). ~/.scout for prod, the instance root otherwise.
 */
export function resolveOpenScoutScoutHome(): string {
  return envPath("OPENSCOUT_SCOUT_HOME") ?? deriveOpenScoutInstanceLayout().scoutHome;
}

/**
 * Pairing bridge state (Noise static key, trusted peers, runtime.json, logs,
 * attachments). OPENSCOUT_PAIRING_HOME wins, then the legacy SCOUT_PAIRING_HOME
 * and OPENSCOUT_PAIRING_DIR spellings, then <scout home>/pairing for an
 * explicit OPENSCOUT_SCOUT_HOME, then the instance default (~/.scout/pairing
 * for prod).
 */
export function resolveOpenScoutPairingHome(): string {
  const explicit = envPath("OPENSCOUT_PAIRING_HOME")
    ?? envPath("SCOUT_PAIRING_HOME")
    ?? envPath("OPENSCOUT_PAIRING_DIR");
  if (explicit) return explicit;
  const scoutHome = envPath("OPENSCOUT_SCOUT_HOME");
  if (scoutHome) return join(scoutHome, "pairing");
  return deriveOpenScoutInstanceLayout().pairingHome;
}

/** resolveOpenScoutHome for an explicit env (HOME honoured from that env). */
export function resolveOpenScoutHomeForEnv(env: Record<string, string | undefined>): string {
  const explicit = env.OPENSCOUT_HOME?.trim();
  if (explicit) return explicit;
  return deriveOpenScoutInstanceLayout({ env, home: env.HOME?.trim() || homedir() }).openscoutHome;
}

/** resolveOpenScoutPairingHome for an explicit env (HOME honoured from that env). */
export function resolveOpenScoutPairingHomeForEnv(env: Record<string, string | undefined>): string {
  const explicit = env.OPENSCOUT_PAIRING_HOME?.trim()
    || env.SCOUT_PAIRING_HOME?.trim()
    || env.OPENSCOUT_PAIRING_DIR?.trim();
  if (explicit) return explicit;
  const scoutHome = env.OPENSCOUT_SCOUT_HOME?.trim();
  if (scoutHome) return join(scoutHome, "pairing");
  return deriveOpenScoutInstanceLayout({ env, home: env.HOME?.trim() || homedir() }).pairingHome;
}

/** Local edge (Caddy) state: <scout home>/local-edge. */
export function resolveOpenScoutLocalEdgeDirectory(): string {
  return join(resolveOpenScoutScoutHome(), "local-edge");
}

export function resolveOpenScoutSupportPaths(): OpenScoutSupportPaths {
  const layout = deriveOpenScoutInstanceLayout();
  const supportDirectory = envPath("OPENSCOUT_SUPPORT_DIRECTORY") ?? layout.supportDirectory;
  const logsDirectory = join(supportDirectory, "logs");
  const runtimeDirectory = join(supportDirectory, "runtime");
  const catalogDirectory = join(supportDirectory, "catalog");
  const controlHome = envPath("OPENSCOUT_CONTROL_HOME") ?? layout.controlHome;
  const knowledgeDirectory = join(controlHome, "knowledge");

  return {
    supportDirectory,
    logsDirectory,
    appLogsDirectory: join(logsDirectory, "app"),
    brokerLogsDirectory: join(logsDirectory, "broker"),
    runtimeDirectory,
    catalogDirectory,
    relayAgentsDirectory: join(runtimeDirectory, "agents"),
    settingsPath: join(supportDirectory, "settings.json"),
    harnessCatalogPath: join(catalogDirectory, "harness-catalog.json"),
    relayAgentsRegistryPath: join(supportDirectory, "relay-agents.json"),
    managedInstallsPath: join(supportDirectory, "managed-installs.json"),
    hostInfoPath: join(supportDirectory, ".host-info"),
    relayHubDirectory: envPath("OPENSCOUT_RELAY_HUB") ?? layout.relayHub,
    controlHome,
    knowledgeDirectory,
    knowledgeQmdDirectory: join(knowledgeDirectory, "qmd"),
    knowledgeSqlitePath: join(knowledgeDirectory, "knowledge.sqlite"),
    desktopStatusPath: join(supportDirectory, "agent-status.json"),
    workspaceStatePath: join(supportDirectory, "workspace-state.json"),
    cutoverMarkerPath: join(supportDirectory, OPENSCOUT_RPC_CUTOVER_MARKER),
  };
}

/**
 * Base directory for control-plane archive output (gzip JSONL exports written
 * before pruning). Sits next to the control-plane home so an overridden
 * OPENSCOUT_CONTROL_HOME keeps archives on the same volume.
 */
export function controlPlaneArchiveDirectory(): string {
  const { controlHome } = resolveOpenScoutSupportPaths();
  return join(dirname(controlHome), "work-archives", "control-plane");
}

export function localAgentRuntimeDirectory(agentId: string): string {
  return join(resolveOpenScoutSupportPaths().relayAgentsDirectory, agentId);
}

export function localAgentLogsDirectory(agentId: string): string {
  return join(localAgentRuntimeDirectory(agentId), "logs");
}

export function relayAgentRuntimeDirectory(agentId: string): string {
  return localAgentRuntimeDirectory(agentId);
}

export function relayAgentLogsDirectory(agentId: string): string {
  return localAgentLogsDirectory(agentId);
}

export function ensureOpenScoutCleanSlateSync(): void {
  assertTestIsolatedUserData("initialize the OpenScout support directory", "OPENSCOUT_SUPPORT_DIRECTORY");
  const paths = resolveOpenScoutSupportPaths();
  if (existsSync(paths.cutoverMarkerPath)) {
    return;
  }

  // Keep the compatibility marker without discarding durable state or files
  // already opened by the supervisor before the broker's first startup.
  mkdirSync(paths.supportDirectory, { recursive: true });
  writeFileSync(paths.cutoverMarkerPath, `${Date.now()}\n`, "utf8");
}
