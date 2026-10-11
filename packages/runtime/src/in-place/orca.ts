// Orca (stablyai/orca) through its own CLI. Orca hosts agent CLIs in terminals
// inside git worktrees and reports their state from its agent hooks; Scout
// reads that state and types into a terminal, and never manages Orca's
// worktrees, tabs, or layout.

import { access } from "node:fs/promises";
import { constants } from "node:fs";

import { execSystemFile } from "../system-probes/exec.js";

const ORCA_TIMEOUT_MS = 8_000;
/** How long `terminal send` watches for the prompt to be submitted. */
const ORCA_SUBMIT_WAIT_S = 5;

/** Orca's own agent states (`AGENT_STATUS_STATES` in Orca's shared types). */
export type OrcaAgentState = "working" | "blocked" | "waiting" | "done" | "unknown";

export type OrcaAgent = {
  paneKey: string;
  agentType: string | null;
  state: OrcaAgentState;
  worktreeId: string;
  worktreePath: string | null;
  lastAssistantMessage: string | null;
};

export type OrcaStatus = {
  installed: boolean;
  /** The Orca app (or `orca serve`) is up and answering. */
  running: boolean;
  version: string | null;
  bin: string | null;
};

/**
 * Where the CLI lives. Homebrew links it onto PATH, but a Scout service can
 * run with a narrow PATH, so the app bundle's own launcher is the fallback.
 */
const ORCA_BIN_CANDIDATES = [
  "/opt/homebrew/bin/orca",
  "/usr/local/bin/orca",
  "/Applications/Orca.app/Contents/Resources/bin/orca",
];

export async function resolveOrcaBin(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const explicit = env.OPENSCOUT_ORCA_BIN?.trim();
  if (explicit) return explicit;
  for (const candidate of ORCA_BIN_CANDIDATES) {
    if (await access(candidate, constants.X_OK).then(() => true, () => false)) return candidate;
  }
  // Last resort: whatever PATH finds. A miss surfaces as ENOENT at exec time.
  return "orca";
}

type OrcaEnvelope<T> = { ok?: boolean; result?: T; error?: { message?: string } | string };

async function runOrca<T>(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<T> {
  const bin = await resolveOrcaBin(env);
  if (!bin) throw new Error("Orca isn't installed");
  const { stdout } = await execSystemFile(bin, args, { timeoutMs: ORCA_TIMEOUT_MS, maxStdoutBytes: 2 * 1024 * 1024 });
  let parsed: OrcaEnvelope<T>;
  try {
    parsed = JSON.parse(stdout) as OrcaEnvelope<T>;
  } catch {
    throw new Error(`orca ${args[0]} returned unreadable output`);
  }
  if (parsed.ok === false || parsed.result === undefined) {
    const message = typeof parsed.error === "string" ? parsed.error : parsed.error?.message;
    throw new Error(message || `orca ${args.slice(0, 2).join(" ")} failed`);
  }
  return parsed.result;
}

export async function readOrcaStatus(env: NodeJS.ProcessEnv = process.env): Promise<OrcaStatus> {
  const bin = await resolveOrcaBin(env);
  try {
    const result = await runOrca<{
      app?: { running?: boolean };
      runtime?: { reachable?: boolean; appVersion?: string };
    }>(["status", "--json"], env);
    return {
      installed: true,
      running: result.runtime?.reachable === true,
      version: result.runtime?.appVersion ?? null,
      bin,
    };
  } catch (error) {
    const missing = (error as { code?: string }).code === "ENOENT";
    return { installed: !missing, running: false, version: null, bin: missing ? null : bin };
  }
}

export function parseOrcaWorktreeAgents(result: unknown): OrcaAgent[] {
  const worktrees = (result as { worktrees?: unknown[] } | null)?.worktrees;
  if (!Array.isArray(worktrees)) return [];
  const agents: OrcaAgent[] = [];
  for (const worktree of worktrees) {
    const record = worktree as Record<string, unknown>;
    const worktreeId = typeof record.worktreeId === "string" ? record.worktreeId : null;
    if (!worktreeId || !Array.isArray(record.agents)) continue;
    for (const agent of record.agents as Array<Record<string, unknown>>) {
      if (typeof agent.paneKey !== "string") continue;
      const state = typeof agent.state === "string" && ["working", "blocked", "waiting", "done"].includes(agent.state)
        ? agent.state as OrcaAgentState
        : "unknown";
      agents.push({
        paneKey: agent.paneKey,
        agentType: typeof agent.agentType === "string" ? agent.agentType : null,
        state,
        worktreeId,
        worktreePath: typeof record.path === "string" ? record.path : null,
        lastAssistantMessage: typeof agent.lastAssistantMessage === "string" ? agent.lastAssistantMessage : null,
      });
    }
  }
  return agents;
}

/** Every agent Orca reports, with the state its hooks last recorded. */
export async function readOrcaAgents(env: NodeJS.ProcessEnv = process.env): Promise<OrcaAgent[]> {
  return parseOrcaWorktreeAgents(await runOrca<unknown>(["worktree", "ps", "--json"], env));
}

/**
 * Types a prompt into an Orca terminal and presses Enter. Orca accepts the
 * input or refuses it; for Claude it cannot also prove the turn started
 * (its receipt stops at `input_accepted`), so acceptance is the bar here and
 * the agent's own state is the proof that follows.
 */
export async function sendOrcaPrompt(
  terminalHandle: string,
  body: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const result = await runOrca<{ send?: { accepted?: boolean } }>([
    "terminal", "send",
    "--terminal", terminalHandle,
    "--text", body,
    "--enter",
    "--wait-submit", String(ORCA_SUBMIT_WAIT_S),
    "--json",
  ], env);
  if (result.send?.accepted !== true) throw new Error("Orca didn't accept the input");
}
