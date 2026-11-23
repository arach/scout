/**
 * Scout Hub actions shared by the `scout hub` CLI and the broker's /v1/hub/*
 * routes, so both apply the same checks. None of the results contain a token
 * or key.
 */

import { isAbsolute } from "node:path";

import { HubCollectorService, type HubCollectSummary } from "./collector.js";
import { connectClaudeCode, disconnectClaudeCode, type ConnectClaudeCodeResult } from "./connect.js";
import {
  isValidManagedAgentsLabel,
  loadManagedAgentsConfig,
  ManagedAgentsPuller,
  removeManagedAgentsConfig,
  saveManagedAgentsConfig,
  type ManagedAgentsPullSummary,
} from "./managed-agents.js";
import { loadHubConfig, loadHubIdentity, type HubConfig } from "./state.js";

export class HubActionError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) {
    super(message);
    this.name = "HubActionError";
  }
}

type Collector = Pick<HubCollectorService, "collectOnce">;
type Puller = Pick<ManagedAgentsPuller, "pullOnce">;

export type ConnectManagedAgentsInput = {
  apiKey: string;
  label?: string;
  lookbackDays?: number;
  /** Only for tests and proxies. */
  baseURL?: string;
};

export type ConnectManagedAgentsResult = { label: string; lookbackDays: number } & ManagedAgentsPullSummary;

/**
 * Save the key, then pull once: that proves the key can read sessions and
 * fills the mirror. A rejected key on a first connect leaves nothing saved.
 */
export async function connectManagedAgents(
  input: ConnectManagedAgentsInput,
  puller: Puller = new ManagedAgentsPuller(),
): Promise<ConnectManagedAgentsResult> {
  const apiKey = input.apiKey?.trim();
  if (!apiKey) throw new HubActionError("An API key is required.", "api_key_required");
  const previous = loadManagedAgentsConfig();
  const label = input.label ?? previous?.label ?? "anthropic";
  if (!isValidManagedAgentsLabel(label)) throw new HubActionError(`Label "${label}" must be letters, digits, dot, dash or underscore.`, "invalid_label");
  const lookbackDays = input.lookbackDays ?? previous?.lookbackDays ?? 7;
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 90) {
    throw new HubActionError("The lookback must be a whole number of days from 1 to 90.", "invalid_lookback");
  }
  const baseURL = input.baseURL ?? previous?.baseURL;
  saveManagedAgentsConfig({
    v: 1, label, apiKey, lookbackDays,
    ...(baseURL ? { baseURL } : {}),
    createdAt: previous?.createdAt || new Date().toISOString(),
  });
  const summary = await puller.pullOnce();
  if (summary.error) {
    if (!previous) removeManagedAgentsConfig();
    throw new HubActionError(
      `Could not read Managed Agents sessions: ${summary.error}${previous ? "" : ". Nothing was saved."}`,
      "managed_agents_unreadable", 502,
    );
  }
  return { label, lookbackDays, ...summary };
}

export function disconnectManagedAgents(): { removed: boolean } {
  return { removed: removeManagedAgentsConfig() };
}

function requireHubSetup(): { config: HubConfig; publicKey: Uint8Array } {
  const config = loadHubConfig();
  if (!config) throw new HubActionError("Scout Hub is not set up. Run `scout hub init --inbox <url>`.", "hub_not_initialized", 409);
  const identity = loadHubIdentity();
  if (!identity) throw new HubActionError("This runtime has no Scout Hub key. Run `scout hub init --inbox <url>`.", "hub_not_initialized", 409);
  return { config, publicKey: identity.publicKey };
}

function requireRepoRoot(repoRoot: unknown): string {
  if (typeof repoRoot !== "string" || !isAbsolute(repoRoot)) throw new HubActionError("repoRoot must be an absolute path.", "invalid_repo_root");
  return repoRoot;
}

/** Writes the reporter, its config and hooks into the repo. The operator commits them. */
export function connectClaudeCodeRepo(input: { repoRoot: string; label?: string }): ConnectClaudeCodeResult {
  const repoRoot = requireRepoRoot(input.repoRoot);
  const { config, publicKey } = requireHubSetup();
  try {
    return connectClaudeCode({ repoRoot, config, recipientPublicKey: publicKey, label: input.label });
  } catch (error) {
    throw new HubActionError(error instanceof Error ? error.message : String(error), "connect_failed");
  }
}

export function disconnectClaudeCodeRepo(input: { repoRoot: string }): { repoRoot: string; changed: string[] } {
  const repoRoot = requireRepoRoot(input.repoRoot);
  return { repoRoot, ...disconnectClaudeCode(repoRoot) };
}

export type HubCollectNowResult = { claudeCode: HubCollectSummary | null; managedAgents: ManagedAgentsPullSummary | null };

/**
 * Collect the inbox and pull Managed Agents now instead of waiting for the
 * loops. Pass the runtime's own loops so a pass already running is joined, not
 * repeated. Failures come back in each summary's `error`.
 */
export async function collectHubNow(loops: { collector?: Collector | null; puller?: Puller | null } = {}): Promise<HubCollectNowResult> {
  const hub = loadHubConfig();
  const managed = loadManagedAgentsConfig();
  if (!hub && !managed) {
    throw new HubActionError("Nothing to collect. Run `scout hub init --inbox <url>` or `scout hub connect managed-agents`.", "hub_not_initialized", 409);
  }
  const [managedAgents, claudeCode] = await Promise.all([
    managed ? (loops.puller ?? new ManagedAgentsPuller()).pullOnce() : null,
    hub ? (loops.collector ?? new HubCollectorService()).collectOnce() : null,
  ]);
  return { claudeCode, managedAgents };
}
