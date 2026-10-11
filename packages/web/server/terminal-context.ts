import { execFile } from "node:child_process";
import { hostname, homedir } from "node:os";
import { basename, resolve as pathResolve } from "node:path";
import type { HerdrSessionTopology, TerminalSessionRecord } from "@openscout/protocol";

/**
 * Where a terminal is, for the context card an emptyish terminal shows under
 * its prompt: host and shell, the git state of the directory, and the agents
 * working in the same checkout (or on this host when it is not a checkout).
 *
 * Every git read is async with a short timeout — this runs on the web
 * server's loop and a slow repo must cost the card, never the server.
 */

export type TerminalContextGit = {
  root: string;
  branch: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  staged: number;
  modified: number;
  untracked: number;
  head: { sha: string; subject: string; relative: string } | null;
};

export type TerminalContextAgent = {
  id: string;
  /** What the row leads with: the pane's own title when the host reports one. */
  title: string;
  /** Host-reported agent state (herdr: working, idle, blocked…); null when unknown. */
  state: string | null;
  /** Null for a discovered multiplexer session, whose harness is unknown. */
  harness: string | null;
  backend: string;
  sessionName: string;
  cwd: string;
  /** What the pane is running now, when discovery reports it. */
  command: string | null;
};

export type TerminalContext = {
  host: string;
  cwd: string;
  displayCwd: string;
  shell: string | null;
  git: TerminalContextGit | null;
  agentScope: "checkout" | "host";
  agents: TerminalContextAgent[];
  /** Every agent in scope; `agents` is the first MAX_AGENTS of them. */
  agentTotal: number;
};

const GIT_TIMEOUT_MS = 1500;
const MAX_AGENTS = 6;

// The cwd comes from the client, so git must not run anything the repo's own
// config names (fsmonitor), nor take the index lock while reading status.
const GIT_READ_ONLY_ARGS = ["-c", "core.fsmonitor=false", "--no-optional-locks"];

function run(cmd: string, args: string[], cwd: string): Promise<string | null> {
  const argv = cmd === "git" ? [...GIT_READ_ONLY_ARGS, ...args] : args;
  return new Promise((resolve) => {
    execFile(cmd, argv, { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolve(error ? null : stdout.toString());
    });
  });
}

export function displayPath(path: string, home = homedir()): string {
  if (path === home) return "~";
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** Counts from `git status --porcelain=v1`: index column → staged, worktree column → modified. */
export function parsePorcelainCounts(porcelain: string): { staged: number; modified: number; untracked: number } {
  let staged = 0;
  let modified = 0;
  let untracked = 0;
  for (const line of porcelain.split("\n")) {
    if (line.length < 2) continue;
    const x = line[0];
    const y = line[1];
    if (x === "?" && y === "?") {
      untracked += 1;
      continue;
    }
    if (x !== " " && x !== "!") staged += 1;
    if (y !== " " && y !== "!") modified += 1;
  }
  return { staged, modified, untracked };
}

/** `git rev-list --left-right --count @{u}...HEAD` prints "<behind>\t<ahead>". */
export function parseLeftRight(output: string | null): { ahead: number | null; behind: number | null } {
  const match = output?.trim().match(/^(\d+)\s+(\d+)$/);
  if (!match) return { ahead: null, behind: null };
  return { behind: Number(match[1]), ahead: Number(match[2]) };
}

export async function readTerminalGitContext(cwd: string): Promise<TerminalContextGit | null> {
  const root = (await run("git", ["rev-parse", "--show-toplevel"], cwd))?.trim();
  if (!root) return null;
  const [branchOut, upstreamOut, countsOut, statusOut, headOut] = await Promise.all([
    run("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], root),
    run("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], root),
    run("git", ["rev-list", "--left-right", "--count", "@{u}...HEAD"], root),
    run("git", ["status", "--porcelain=v1", "--untracked-files=normal"], root),
    run("git", ["log", "-1", "--format=%h%x1f%s%x1f%cr"], root),
  ]);
  const [sha, subject, relative] = (headOut ?? "").trim().split("\x1f");
  return {
    root,
    branch: branchOut?.trim() || null,
    upstream: upstreamOut?.trim() || null,
    ...parseLeftRight(countsOut),
    ...parsePorcelainCounts(statusOut ?? ""),
    head: sha ? { sha, subject: subject ?? "", relative: relative ?? "" } : null,
  };
}

/**
 * Claude Code titles its process with its version ("2.1.280"), so a discovered
 * pane whose current command is a bare version is a Claude session.
 */
export function inferHarness(command: string | null): string | null {
  return command && /^\d+\.\d+\.\d+$/.test(command) ? "claude" : null;
}

function isUnder(path: string, root: string): boolean {
  const p = pathResolve(path);
  return p === root || p.startsWith(`${root}/`);
}

/**
 * Live terminal sessions, scoped to the checkout when there is one. Registry
 * sessions carry their harness; discovered ones (a tmux or herdr session seen
 * on the host) do not, and their timestamps are discovery time rather than
 * activity, so the order is registry first, then by name — stable, not "recent".
 */
export function pickContextAgents(
  sessions: TerminalSessionRecord[],
  root: string | null,
  limit = MAX_AGENTS,
): TerminalContextAgent[] {
  const agents: Array<TerminalContextAgent & { registry: boolean }> = [];
  for (const session of sessions) {
    if (root && !(session.cwd && isUnder(session.cwd, root))) continue;
    const live = session.surfaces.find((surface) => surface.state === "live");
    if (!live) continue;
    const rawCommand = session.metadata?.currentCommand;
    const command = typeof rawCommand === "string" && rawCommand.trim() ? rawCommand.trim() : null;
    agents.push({
      id: session.id,
      title: live.sessionName,
      state: null,
      harness: session.harness?.trim() || inferHarness(command),
      backend: live.backend,
      sessionName: live.sessionName,
      cwd: session.cwd,
      command,
      registry: session.origin !== "discovered",
    });
  }
  return agents
    .sort((a, b) => Number(b.registry) - Number(a.registry) || a.sessionName.localeCompare(b.sessionName))
    .slice(0, limit)
    .map(({ registry: _registry, ...agent }) => agent);
}

/**
 * A herdr session is a container, not an agent: swap its row for the agent
 * panes inside it, each with the title and state herdr reports. A session
 * whose topology cannot be read keeps its single row.
 */
export function expandHerdrAgents(
  agents: TerminalContextAgent[],
  topologies: Map<string, HerdrSessionTopology>,
  root: string | null,
): TerminalContextAgent[] {
  return agents.flatMap((agent) => {
    const topology = agent.backend === "herdr" ? topologies.get(agent.sessionName) : undefined;
    if (!topology?.running) return [agent];
    const panes = topology.workspaces
      .flatMap((workspace) => workspace.tabs)
      .flatMap((tab) => tab.panes)
      .filter((pane) => pane.agent && (!root || isUnder(pane.foregroundCwd ?? pane.cwd ?? "", root)));
    return panes.map((pane) => ({
      id: `${agent.id}:${pane.paneId}`,
      title: pane.name ?? pane.label ?? pane.agent ?? pane.paneId,
      state: pane.agentStatus === "unknown" ? null : pane.agentStatus,
      harness: pane.agent,
      backend: "herdr",
      sessionName: agent.sessionName,
      cwd: pane.foregroundCwd ?? pane.cwd ?? agent.cwd,
      command: null,
    }));
  });
}

export async function readTerminalContext(
  rawCwd: string | undefined,
  sessions: () => Promise<TerminalSessionRecord[]>,
  readHerdr: (session: string) => Promise<HerdrSessionTopology> = async (session) => ({
    session,
    running: false,
    workspaces: [],
    observedAt: Date.now(),
  }),
): Promise<TerminalContext> {
  const home = homedir();
  const cwd = pathResolve(rawCwd?.trim() ? rawCwd.replace(/^~(?=$|\/)/, home) : home);
  const [git, inventory] = await Promise.all([
    readTerminalGitContext(cwd),
    sessions().catch(() => [] as TerminalSessionRecord[]),
  ]);
  const root = git?.root ?? null;
  const live = pickContextAgents(inventory, root, Number.POSITIVE_INFINITY);
  const herdrNames = [...new Set(live.filter((a) => a.backend === "herdr").map((a) => a.sessionName))];
  const topologies = new Map<string, HerdrSessionTopology>();
  await Promise.all(herdrNames.map(async (name) => {
    const topology = await readHerdr(name).catch(() => null);
    if (topology) topologies.set(name, topology);
  }));
  const agents = expandHerdrAgents(live, topologies, root);
  const shellPath = process.env.SHELL;
  return {
    host: hostname().replace(/\.local$/, ""),
    cwd,
    displayCwd: displayPath(cwd, home),
    shell: shellPath ? basename(shellPath) : null,
    git: git ? { ...git, root: displayPath(git.root, home) } : null,
    agentScope: git ? "checkout" : "host",
    agents: agents.slice(0, MAX_AGENTS),
    agentTotal: agents.length,
  };
}
