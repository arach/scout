// Where a live harness process runs, read from the process itself.
//
// Terminal hosts export their own coordinates into every pane they spawn:
// Herdr sets HERDR_SESSION and HERDR_PANE_ID, Orca sets ORCA_TERMINAL_HANDLE
// and ORCA_PANE_KEY, tmux sets TMUX_PANE. A harness inherits them, so its
// process environment names the exact pane holding it. That is the same
// answer Herdr gives through its agent integration, without depending on the
// integration being installed — a Herdr pane started before the integration
// reports `agentSession: null` but still carries HERDR_PANE_ID.
//
// Those variables are inherited by everything below the pane, including
// another terminal host started from it: an Orca app launched from a Herdr
// shell hands HERDR_PANE_ID to every agent it spawns. Only TERM_PROGRAM is
// rewritten by each host, so it alone says which host is innermost.

import { readFile } from "node:fs/promises";

import { execSystemFile } from "../system-probes/exec.js";

export type ProcessHostLocation =
  | { host: "herdr"; session: string; paneId: string }
  | { host: "orca"; terminalHandle: string; paneKey: string | null; worktreeId: string | null }
  | { host: "tmux"; pane: string };

/** Only these variables are read; the rest of a process environment is never kept. */
const HOST_VARIABLES = [
  "TERM_PROGRAM",
  "HERDR_SESSION",
  "HERDR_PANE_ID",
  "ORCA_TERMINAL_HANDLE",
  "ORCA_PANE_KEY",
  "ORCA_WORKTREE_ID",
  "TMUX",
  "TMUX_PANE",
] as const;

type HostVariable = typeof HOST_VARIABLES[number];
export type ProcessHostEnv = Partial<Record<HostVariable, string>>;

/**
 * Picks the host variables out of `ps -E` output (command, then environment,
 * space-separated) or a `/proc/<pid>/environ` dump (NUL-separated). Host
 * values never contain spaces, so splitting on whitespace is safe for them.
 */
export function parseProcessHostEnv(output: string): ProcessHostEnv {
  const env: ProcessHostEnv = {};
  for (const token of output.split(/[\s\0]+/u)) {
    const eq = token.indexOf("=");
    if (eq <= 0) continue;
    const key = token.slice(0, eq) as HostVariable;
    if (!HOST_VARIABLES.includes(key)) continue;
    const value = token.slice(eq + 1).trim();
    // The first occurrence wins: `ps -E` prints the command line first, and an
    // argument shaped like KEY=value there must not shadow the real variable.
    if (value && env[key] === undefined) env[key] = value;
  }
  return env;
}

/**
 * Every host whose coordinates a process carries, inherited or not. Use it to
 * recognise a pane, never to choose one to type into: see innermostProcessHost.
 */
export function processHostLocations(env: ProcessHostEnv): ProcessHostLocation[] {
  const locations: ProcessHostLocation[] = [];
  if (env.ORCA_TERMINAL_HANDLE) {
    locations.push({
      host: "orca",
      terminalHandle: env.ORCA_TERMINAL_HANDLE,
      paneKey: env.ORCA_PANE_KEY ?? null,
      worktreeId: env.ORCA_WORKTREE_ID ?? null,
    });
  }
  if (env.HERDR_SESSION && env.HERDR_PANE_ID) {
    locations.push({ host: "herdr", session: env.HERDR_SESSION, paneId: env.HERDR_PANE_ID });
  }
  if (env.TMUX && env.TMUX_PANE) {
    locations.push({ host: "tmux", pane: env.TMUX_PANE });
  }
  return locations;
}

const TERM_PROGRAM_HOSTS: Record<string, ProcessHostLocation["host"]> = {
  herdr: "herdr",
  orca: "orca",
  tmux: "tmux",
};

/**
 * The pane that spawned the process: the host TERM_PROGRAM names, with that
 * host's own coordinates. Null when TERM_PROGRAM names none of them — the
 * process then sits in a plain terminal, whatever host variables it inherited.
 */
export function innermostProcessHost(env: ProcessHostEnv): ProcessHostLocation | null {
  const host = TERM_PROGRAM_HOSTS[(env.TERM_PROGRAM ?? "").trim().toLowerCase()];
  if (!host) return null;
  return processHostLocations(env).find((location) => location.host === host) ?? null;
}

/** The host variables of a running process; empty when it cannot be read. */
export async function readProcessHostEnv(
  pid: number,
  options: { platform?: NodeJS.Platform } = {},
): Promise<ProcessHostEnv> {
  if (!Number.isInteger(pid) || pid <= 0) return {};
  const platform = options.platform ?? process.platform;
  if (platform === "linux") {
    const raw = await readFile(`/proc/${pid}/environ`, "utf8").catch(() => "");
    return parseProcessHostEnv(raw);
  }
  // macOS shows another process's environment only to its owner, which is
  // exactly the case here: Scout and the operator's harness run as one user.
  const { stdout } = await execSystemFile("ps", ["-E", "-ww", "-p", String(pid), "-o", "command="], {
    timeoutMs: 2_000,
    maxStdoutBytes: 256 * 1024,
  }).catch(() => ({ stdout: "" }));
  return parseProcessHostEnv(stdout);
}
