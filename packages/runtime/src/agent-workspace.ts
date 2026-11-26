// Agent workspace isolation.
//
// A dispatched agent runs in an isolated git worktree so its edits don't
// clobber the operator's working tree. This module owns the single shared
// implementation that used to be duplicated byte-for-byte inline in the desktop
// and web mobile services.
//
// On supported Darwin volumes, dedicated sessions use a clonefile payload
// with a linked Git index and shared branch storage. Other checkouts use a
// conventional Git worktree.

import { lstatSync, realpathSync } from "node:fs";
import { mkdir, readdir, rename } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { prepareAgentWorkspaceClonePayload, stageAgentWorkspaceClone } from "./agent-workspace-clone.js";
import { execSystemFile } from "./system-probes/exec.js";

/** Directory (under the project root) that holds every Scout-created workspace. */
export const SCOUT_WORKSPACES_DIRNAME = ".scout-worktrees";

export interface AgentWorktreeOwnership {
  sessionId: string;
  path: string;
  branch: string;
  directoryIdentity: string;
  gitfileIdentity: string;
}

function directoryEntryIdentity(path: string): string {
  const stat = lstatSync(path, { bigint: true });
  return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
}

export interface CreateAgentWorkspaceResult {
  /** Absolute path the agent should run in (its cwdOverride). */
  path: string;
  /** Branch the worktree tracks (`scout/<agent>` unless one was requested). */
  branch: string;
  /** Start commit of a newly created branch. Omitted when reusing a branch or worktree. */
  baseRef?: string;
  ownership?: AgentWorktreeOwnership;
}

export interface AgentWorkspaceBaseOptions {
  /** Git ref or commit to use instead of the repository's default. */
  baseRef?: string;
  /** Refresh a remote-tracking base before use. Defaults to true. */
  fetchBase?: boolean;
  /** A dedicated session must not inherit a prior workspace. */
  ownerSessionId?: string;
}

/**
 * In-process handshake with the retirement sweep. A workspace handed to a
 * session counts as activity, so the sweep will not retire it in the window
 * before that session's endpoint is recorded. A workspace that the sweep is
 * retiring is not handed out until the retirement settles.
 */
const workspaceClaimedAt = new Map<string, number>();
const workspaceRetirements = new Map<string, Promise<unknown>>();
const workspaceDispatches = new Map<string, number>();

/** Count in-process launches and turns, including preparation before a worker starts. */
export function agentWorkspaceDispatchCount(path: string): number {
  return workspaceDispatches.get(agentWorkspaceKey(path)) ?? 0;
}

/** Acquire synchronously so retirement cannot pass its final check between admission and launch. */
export function admitAgentWorkspaceDispatch(path: string): (() => void) | undefined {
  const key = agentWorkspaceKey(path);
  if (workspaceRetirements.has(key)) return undefined;
  workspaceDispatches.set(key, (workspaceDispatches.get(key) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (workspaceDispatches.get(key) ?? 1) - 1;
    if (count) workspaceDispatches.set(key, count);
    else workspaceDispatches.delete(key);
  };
}

export function agentWorkspaceKey(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** When this process last handed the workspace at `path` to a session. */
export function agentWorkspaceClaimedAt(path: string): number | undefined {
  return workspaceClaimedAt.get(agentWorkspaceKey(path));
}

/** Hold new sessions off `path` until `retirement` settles. */
export async function withAgentWorkspaceRetirement<T>(path: string, retirement: () => Promise<T>): Promise<T> {
  const key = agentWorkspaceKey(path);
  const previous = workspaceRetirements.get(key);
  const pending = Promise.resolve(previous).catch(() => undefined).then(retirement);
  workspaceRetirements.set(key, pending);
  try {
    return await pending;
  } finally {
    if (workspaceRetirements.get(key) === pending) workspaceRetirements.delete(key);
  }
}

function claimAgentWorkspace(path: string): void {
  workspaceClaimedAt.set(agentWorkspaceKey(path), Date.now());
}

async function isMatchingWorktree(root: string, path: string, branch: string): Promise<boolean> {
  try {
    if (realpathSync(path) !== path || !lstatSync(join(path, ".git")).isFile()) return false;
    const [top, common, expectedCommon, ref, registered] = await Promise.all([
      gitOutput(path, ["rev-parse", "--show-toplevel"]),
      gitOutput(path, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
      gitOutput(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
      gitOutput(path, ["symbolic-ref", "HEAD"]),
      gitOutput(root, ["worktree", "list", "--porcelain", "-z"]),
    ]);
    return !!top && realpathSync(top) === path
      && !!common && !!expectedCommon && realpathSync(common) === realpathSync(expectedCommon)
      && ref === `refs/heads/${branch}`
      && registered?.split("\0").includes(`worktree ${path}`) === true;
  } catch {
    return false;
  }
}

function validateWorktreeBranch(branch: string): void {
  if (!branch || branch.includes("\0") || branch.startsWith("-")) {
    throw new Error("git worktree branch must be non-empty and must not start with '-'");
  }
}

function validBaseRef(ref: string): boolean {
  return !!ref && !ref.includes("\0") && !ref.startsWith("-");
}

async function gitOutput(projectRoot: string, args: readonly string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execSystemFile("git", args, { cwd: projectRoot, timeoutMs: 2_000 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function resolveCommit(projectRoot: string, ref: string): Promise<string | undefined> {
  return gitOutput(projectRoot, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]);
}

const REMOTE_REFS = "refs/remotes/";
type FetchSource = { remote: string; source: string };
type RemoteBase = { ref: string; upstream?: FetchSource };

async function remoteBaseForRef(projectRoot: string, ref: string): Promise<RemoteBase | undefined> {
  // Resolve symbolic refs such as origin/HEAD and keep Git's precedence over
  // similarly named local branches or tags.
  const fullRef = await gitOutput(projectRoot, ["rev-parse", "--symbolic-full-name", "--verify", "--quiet", "--end-of-options", ref]);
  return fullRef?.startsWith(REMOTE_REFS) ? { ref: fullRef } : undefined;
}

/** Match a literal or single-wildcard fetch refspec, returning the captured text. */
function matchRefspec(pattern: string, ref: string): string | undefined {
  const [prefix, suffix, extra] = pattern.split("*");
  if (suffix === undefined) return pattern === ref ? "" : undefined;
  if (extra !== undefined || ref.length < prefix.length + suffix.length
      || !ref.startsWith(prefix) || !ref.endsWith(suffix)) return undefined;
  return ref.slice(prefix.length, ref.length - suffix.length);
}

async function configuredFetchSource(
  projectRoot: string,
  destination: string,
  upstream?: FetchSource,
): Promise<FetchSource | undefined> {
  const remotes = (await gitOutput(projectRoot, ["remote"]))?.split("\n") ?? [];
  let match: FetchSource | undefined;
  for (const remote of remotes) {
    if (upstream && remote !== upstream.remote) continue;
    const config = await gitOutput(projectRoot, ["config", "--null", "--get-all", `remote.${remote}.fetch`]);
    const refspecs = config?.split("\0") ?? [];
    for (const spec of refspecs) {
      if (spec.startsWith("^")) continue;
      const [source, target, extra] = spec.replace(/^\+/, "").split(":");
      if (!target || extra !== undefined) continue;
      const shorthand = target.startsWith("remotes/");
      const captured = matchRefspec(shorthand ? `refs/${target}` : target, destination);
      if (captured === undefined) continue;
      // A shorthand destination or an implicit remote HEAD can compete with
      // a fully qualified mapping. Leave the tracking ref alone in either case.
      if (!source || shorthand) return undefined;
      if (source.includes("*") !== target.includes("*")) continue;
      const ref = source.replace("*", () => captured);
      if (ref.includes("*")) continue;
      if (match && (match.remote !== remote || match.source !== ref)) return undefined;
      // A targeted fetch uses an empty refmap, so check the exclusions before
      // asking Git to update the ref. Short sources cannot be compared safely
      // to exclusions on fully qualified refs.
      if (refspecs.some((rule) => rule.startsWith("^")
          && (!ref.startsWith("refs/") || matchRefspec(rule.slice(1), ref) !== undefined))) return undefined;
      match = { remote, source: ref };
    }
  }
  return upstream && match?.source !== upstream.source ? undefined : match;
}

async function refreshRemoteBase(projectRoot: string, base: RemoteBase): Promise<boolean> {
  // A fetch updates only the selected remote-tracking ref, never a local
  // branch. Don't follow an unusual symbolic tracking ref into refs/heads/.
  const destination = await gitOutput(projectRoot, ["symbolic-ref", "--quiet", "--", base.ref]) ?? base.ref;
  if (!destination.startsWith(REMOTE_REFS)) return false;
  const mapping = await configuredFetchSource(projectRoot, destination, base.upstream);
  if (!mapping) return false;
  try {
    await execSystemFile("git", [
      "fetch", "--no-tags", "--no-prune", "--no-recurse-submodules",
      "--no-write-fetch-head", "--no-auto-gc", "--refmap=", "--",
      mapping.remote, `+${mapping.source}:${destination}`,
    ], { cwd: projectRoot, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, timeoutMs: 2_000 });
    return true;
  } catch {
    return false;
  }
}

async function resolveWorktreeBase(
  projectRoot: string,
  explicitRef: string | undefined,
  fetchBase: boolean,
): Promise<string | undefined> {
  const preferred = explicitRef ?? await gitOutput(projectRoot, ["config", "--get", "scout.worktreeBase"]);
  if (preferred && validBaseRef(preferred)) {
    if (fetchBase) {
      const remoteBase = await remoteBaseForRef(projectRoot, preferred);
      if (remoteBase) await refreshRemoteBase(projectRoot, remoteBase);
    }
    const commit = await resolveCommit(projectRoot, preferred);
    if (commit) return commit;
  }
  if (explicitRef !== undefined) {
    throw new Error(`git worktree baseRef ${JSON.stringify(explicitRef)} does not resolve to a commit. Fetch the ref or choose an existing commit.`);
  }

  const head = await resolveCommit(projectRoot, "HEAD");
  if (!head) return undefined;
  const branch = await gitOutput(projectRoot, ["symbolic-ref", "--quiet", "HEAD"]);
  if (!branch?.startsWith("refs/heads/")) return head;

  // Read both ends of the branch's upstream mapping rather than assuming
  // the remote branch has the same name as the local branch.
  const upstream = await gitOutput(projectRoot, [
    "for-each-ref", "--format=%(upstream)%09%(upstream:remotename)%09%(upstream:remoteref)", "--", branch,
  ]);
  const [ref, remote, source] = upstream?.split("\t") ?? [];
  const base = ref?.startsWith(REMOTE_REFS) && remote && remote !== "." && source
    ? { ref, upstream: { remote, source } }
    : await remoteBaseForRef(projectRoot, "refs/remotes/origin/main")
      ?? await remoteBaseForRef(projectRoot, "refs/remotes/origin/HEAD");
  if (!base || (fetchBase && !(await refreshRemoteBase(projectRoot, base)))) return head;

  const remoteCommit = await resolveCommit(projectRoot, base.ref);
  if (!remoteCommit || remoteCommit === head) return head;
  try {
    await execSystemFile("git", ["merge-base", "--is-ancestor", head, remoteCommit], { cwd: projectRoot, timeoutMs: 2_000 });
    return remoteCommit;
  } catch {
    return head;
  }
}

async function publishClonedWorktree(root: string, destination: string, branch: string, base: string): Promise<boolean> {
  if (process.platform !== "darwin" || !lstatSync(join(root, ".git"), { throwIfNoEntry: false })?.isDirectory()
      || await resolveCommit(root, "HEAD") !== base
      || await resolveCommit(root, `refs/heads/${branch}`)) return false;
  const git = (cwd: string, args: string[]) => execSystemFile("git", args, { cwd, timeoutMs: 30_000 });
  const stage = await stageAgentWorkspaceClone(root);
  if (!stage) return false;
  const parent = dirname(stage.path);
  const payload = join(parent, "payload");
  const linked = join(parent, "linked");
  let registered = false;
  try {
    const paths = (await git(root, ["ls-tree", "-rz", "--name-only", base])).stdout.split("\0").filter(Boolean);
    await prepareAgentWorkspaceClonePayload(stage.path, payload, paths);
    await git(root, ["worktree", "add", "--detach", "--no-checkout", "--", linked, base]);
    registered = true;
    for (const name of await readdir(payload)) await rename(join(payload, name), join(linked, name));
    await git(linked, ["reset", "--mixed", base]);
    const dirty = await git(linked, ["status", "--porcelain", "--untracked-files=all", "--ignore-submodules=none"]);
    if (dirty.stdout) return false;
    await git(linked, ["switch", "-c", branch]);
    if (lstatSync(destination, { throwIfNoEntry: false })) return false;
    if (realpathSync(dirname(destination)) !== dirname(destination)) return false;
    await git(root, ["worktree", "move", "--", linked, destination]);
    registered = false;
    return true;
  } catch {
    return false;
  } finally {
    if (registered) {
      // This temporary checkout has never been dispatched. If Git cannot
      // unregister it, keep the staging directory for operator inspection.
      await git(root, ["worktree", "remove", "--force", "--", linked]).then(
        () => { registered = false; },
        () => undefined,
      );
    }
    if (!registered) await stage.dispose();
  }
}

/**
 * Materialize an isolated git worktree for `agentName` under
 * `<projectRoot>/.scout-worktrees/<agentName>`, on branch `scout/<agentName>`
 * (or `requestedBranch` when given). An existing worktree at that path is
 * reused only if Git registers it for this repository and branch.
 *
 * Returns the workspace descriptor, or `null` when the project isn't a git repo
 * (or both `git worktree add` attempts fail) — callers then run the agent in the
 * project root, exactly as before.
 */
export async function createAgentWorkspace(
  projectRoot: string,
  agentName: string,
  requestedBranch?: string,
  options: AgentWorkspaceBaseOptions = {},
): Promise<CreateAgentWorkspaceResult | null> {
  const explicitRef = options.baseRef?.trim();
  if (explicitRef !== undefined && !validBaseRef(explicitRef)) {
    throw new Error("git worktree baseRef must be non-empty, must not contain a NUL byte, and must not start with '-'");
  }
  if (!agentName || agentName !== basename(agentName) || agentName === "." || agentName === ".." || agentName.includes("\0")) {
    throw new Error("workspace agent name must be a single path component");
  }
  const top = await gitOutput(projectRoot, ["rev-parse", "--show-toplevel"]);
  if (!top || realpathSync(top) !== realpathSync(projectRoot)) return null;
  projectRoot = realpathSync(projectRoot);

  const branch = requestedBranch?.trim() || `scout/${agentName}`;
  validateWorktreeBranch(branch);
  const workspaceDir = join(projectRoot, SCOUT_WORKSPACES_DIRNAME);
  const workspacePath = join(workspaceDir, agentName);

  const verifyWorkspaceDir = () => {
    const directory = lstatSync(workspaceDir, { throwIfNoEntry: false });
    if (directory && (!directory.isDirectory()
        || relative(projectRoot, realpathSync(workspaceDir)) !== SCOUT_WORKSPACES_DIRNAME)) {
      throw new Error("workspace directory must be a real directory inside the project");
    }
  };
  verifyWorkspaceDir();

  // Wait for retirement, then claim before any async Git verification.
  let retiring: Promise<unknown> | undefined;
  while ((retiring = workspaceRetirements.get(agentWorkspaceKey(workspacePath)))) {
    await retiring.catch(() => undefined);
  }
  if (lstatSync(workspacePath, { throwIfNoEntry: false })) {
    if (options.ownerSessionId) return null;
    if (!lstatSync(workspacePath, { throwIfNoEntry: false })?.isDirectory()) return null;
    claimAgentWorkspace(workspacePath);
    return await isMatchingWorktree(projectRoot, workspacePath, branch) ? { path: workspacePath, branch } : null;
  }

  const baseRef = await resolveWorktreeBase(projectRoot, explicitRef, options.fetchBase ?? true);
  await mkdir(workspaceDir, { recursive: true });
  verifyWorkspaceDir();

  const ownership = () => options.ownerSessionId ? {
    ownership: {
      sessionId: options.ownerSessionId,
      path: workspacePath,
      branch,
      directoryIdentity: directoryEntryIdentity(workspacePath),
      gitfileIdentity: directoryEntryIdentity(join(workspacePath, ".git")),
    },
  } : {};
  if (options.ownerSessionId && baseRef && await publishClonedWorktree(projectRoot, workspacePath, branch, baseRef)) {
    claimAgentWorkspace(workspacePath);
    return { path: workspacePath, branch, baseRef, ...ownership() };
  }
  if (options.ownerSessionId && lstatSync(workspacePath, { throwIfNoEntry: false })) return null;
  try {
    // Use the resolved commit so a concurrent fetch cannot change the start point.
    await execSystemFile("git", ["worktree", "add", "-b", branch, "--", workspacePath, ...(baseRef ? [baseRef] : [])], { cwd: projectRoot, timeoutMs: 10_000 });
    claimAgentWorkspace(workspacePath);
    return { path: workspacePath, branch, ...(baseRef ? { baseRef } : {}), ...ownership() };
  } catch {
    // Branch might already exist — retry attaching to it without -b.
    if (explicitRef !== undefined && await resolveCommit(projectRoot, `refs/heads/${branch}`) !== baseRef) {
      throw new Error(`git worktree could not create branch ${JSON.stringify(branch)} at baseRef ${JSON.stringify(explicitRef)}. Choose a new branch or check git worktree list.`);
    }
    try {
      await execSystemFile("git", ["worktree", "add", "--", workspacePath, branch], { cwd: projectRoot, timeoutMs: 10_000 });
      claimAgentWorkspace(workspacePath);
      return { path: workspacePath, branch, ...ownership() };
    } catch {
      // If both fail, fall back to no worktree.
      return null;
    }
  }
}

/**
 * Capture tracked and unignored changes without retiring the workspace.
 * The caller must hold an exclusive workspace lease and establish runtime
 * ownership separately; Git registration is not proof of Scout ownership.
 * On failure the directory and any staged changes must be kept.
 */
export async function captureAgentWorktree(projectRoot: string, workspace: Pick<CreateAgentWorkspaceResult, "path" | "branch">): Promise<string> {
  const root = realpathSync(projectRoot);
  const container = join(root, SCOUT_WORKSPACES_DIRNAME);
  const path = workspace.path;
  const branchRef = `refs/heads/${workspace.branch}`;
  if (!workspace.branch.startsWith("scout/") || !lstatSync(container).isDirectory()
      || relative(container, path) !== basename(path) || !await isMatchingWorktree(root, path, workspace.branch)) {
    throw new Error("cannot capture: workspace is not the registered Scout worktree on the expected branch");
  }

  const run = (args: string[]) => execSystemFile("git", args, { cwd: path, timeoutMs: 30_000 });
  const status = ["status", "--porcelain", "--untracked-files=all", "--ignore-submodules=none"];
  if ((await run(status)).stdout.length > 0) {
    if ((await run(["ls-files", "--unmerged"])).stdout) {
      throw new Error("cannot capture: unresolved merge conflicts; keep the workspace");
    }
    await run(["add", "-A", "--", "."]);
    const staged = (await run(["diff", "--cached", "--raw", "--no-renames", "-z"])).stdout.split("\0");
    if (staged.some((record, index) => index % 2 === 0 && /^:(?:160000 |[0-7]{6} 160000 )/.test(record))) {
      throw new Error("cannot capture: Git links do not preserve nested repository contents; keep the workspace");
    }
    await run([
      "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false",
      "commit", "-m", "Capture agent workspace changes",
    ]);
  }
  const head = await resolveCommit(path, "HEAD");
  if (!head || head !== await resolveCommit(root, branchRef)
      || (await run(status)).stdout.length > 0 || !await isMatchingWorktree(root, path, workspace.branch)) {
    throw new Error("cannot verify the captured workspace commit; keep the workspace");
  }
  return head;
}

/** Validate a persisted claim against the original checkout and filesystem entries. */
export async function matchesAgentWorktreeOwnership(projectRoot: string, ownership: AgentWorktreeOwnership): Promise<boolean> {
  try {
    const root = realpathSync(projectRoot);
    const container = join(root, SCOUT_WORKSPACES_DIRNAME);
    return relative(container, ownership.path) === basename(ownership.path)
      && ownership.branch.startsWith("scout/")
      && await isMatchingWorktree(root, ownership.path, ownership.branch)
      && directoryEntryIdentity(ownership.path) === ownership.directoryIdentity
      && directoryEntryIdentity(join(ownership.path, ".git")) === ownership.gitfileIdentity;
  } catch {
    return false;
  }
}

export interface SessionWorkspace {
  /** Directory the session runs in. */
  cwd: string;
  /** Branch of the worktree, when the session runs in one. */
  branch?: string;
  /** Start commit of a newly created branch. */
  baseRef?: string;
  ownership?: AgentWorktreeOwnership;
}

/**
 * Pick the working directory for a new session. `same` (or no choice) runs in
 * the project root. `new_worktree` runs in a git worktree, and fails with an
 * actionable error instead of falling back to the project root: a caller that
 * asked for isolation must not get a worker in the shared checkout.
 */
export async function resolveSessionWorkspace(input: AgentWorkspaceBaseOptions & {
  projectRoot: string;
  agentName: string;
  workspace?: "same" | "new_worktree";
  createWorkspace?: typeof createAgentWorkspace;
}): Promise<SessionWorkspace> {
  if (input.workspace !== "new_worktree") {
    return { cwd: input.projectRoot };
  }
  const created = await (input.createWorkspace ?? createAgentWorkspace)(input.projectRoot, input.agentName, undefined, {
    baseRef: input.baseRef,
    fetchBase: input.fetchBase,
    ownerSessionId: input.ownerSessionId,
  });
  if (!created) {
    throw new Error(
      `workspace new_worktree: could not create a git worktree for ${input.projectRoot}`
      + ` (branch scout/${input.agentName} under ${SCOUT_WORKSPACES_DIRNAME}/).`
      + " The folder must be a git repository with at least one commit."
      + " Ask without workspace new_worktree to run in the project folder.",
    );
  }
  return { cwd: created.path, branch: created.branch, ...(created.baseRef ? { baseRef: created.baseRef } : {}), ...(created.ownership ? { ownership: created.ownership } : {}) };
}
