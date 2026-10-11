import { randomUUID } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { RepoWatchPathHint, RepoWatchProject, RepoWatchSnapshot } from "./index.js";

type Root = { topLevel: string; commonGitDir: string; workingRoots: string[]; hints: RepoWatchPathHint[] };
type Options = {
  key: string;
  hints: RepoWatchPathHint[];
  maxRoots: number;
  force?: boolean;
  scanId?: string;
  cacheTtlMs: number;
  previous?: RepoWatchSnapshot;
  idForRoot: (path: string) => string;
  scan: (root: Root) => Promise<{ project: RepoWatchProject; warnings: string[] }>;
  totals: (projects: RepoWatchProject[]) => RepoWatchSnapshot["totals"];
};
type Load = { key: string; snapshot: RepoWatchSnapshot; ready: Promise<void> };
const loads = new Map<string, Load>();
const ignored = new Set([".git", "node_modules", ".build", "dist", "build", ".next", "vendor", "target"]);

async function modifiedAt(path: string): Promise<number> {
  try { return (await stat(path)).mtimeMs; } catch { return 0; }
}

// A bounded metadata read, never a recursive Git/status scan. Known source
// directories and the last checkout/commit supplement the root's own mtime.
async function recentTouch(root: string, gitDir: string): Promise<number> {
  const paths = [root, join(gitDir, "logs", "HEAD")];
  for (const directory of [root, join(root, "src"), join(root, "app"), join(root, "Sources")]) {
    const names = await readdir(directory).catch(() => [] as string[]);
    paths.push(...names.filter((name) => !ignored.has(name) && !name.startsWith(".")).sort().slice(0, 64)
      .map((name) => join(directory, name)));
  }
  return Math.max(0, ...await Promise.all(paths.map(modifiedAt)));
}

// Resolve ordinary clones, nested cwd hints, linked worktrees and symlinks
// without spawning git. Linked worktrees collapse onto the same common dir.
async function resolveRoot(path: string): Promise<Omit<Root, "hints"> | null> {
  let current: string;
  try {
    current = await realpath(path);
    if (!(await stat(current)).isDirectory()) current = dirname(current);
  } catch { return null; }
  for (let depth = 0; depth < 32; depth++) {
    const marker = join(current, ".git");
    try {
      const entry = await stat(marker);
      const gitDir = entry.isDirectory() ? marker
        : resolve(current, (await readFile(marker, "utf8")).match(/^gitdir:\s*(.+)\s*$/m)?.[1]?.trim() ?? "");
      if (!entry.isDirectory() && gitDir === current) return null;
      const common = await readFile(join(gitDir, "commondir"), "utf8").catch(() => null);
      const commonGitDir = await realpath(common ? resolve(gitDir, common.trim()) : gitDir);
      const mainRoot = basename(commonGitDir) === ".git" ? dirname(commonGitDir) : current;
      return { topLevel: mainRoot, commonGitDir, workingRoots: [current] };
    } catch { /* This cwd may be nested below the repository root. */ }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

async function mapBounded<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!);
    }
  }));
  return results;
}

async function inventory(options: Options): Promise<{ roots: Root[]; projects: RepoWatchProject[]; warnings: string[] }> {
  const grouped = new Map<string, RepoWatchPathHint[]>();
  for (const hint of options.hints) {
    const group = grouped.get(hint.path);
    if (group) group.push(hint);
    else grouped.set(hint.path, [hint]);
  }
  const entries = [...grouped.entries()].slice(0, 512);
  const found = await mapBounded(entries, 8, async ([path, hints]) => {
    const root = await resolveRoot(path);
    return root ? { ...root, hints } : null;
  });
  const roots = new Map<string, Root>();
  for (const root of found) {
    if (!root) continue;
    const prior = roots.get(root.commonGitDir);
    if (prior) {
      prior.hints.push(...root.hints);
      prior.workingRoots = [...new Set([...prior.workingRoots, ...root.workingRoots])];
    }
    else roots.set(root.commonGitDir, root);
  }
  const previous = new Map(options.previous?.projects.map((project) => [project.id, project]) ?? []);
  const rows = await mapBounded([...roots.values()], 4, async (root) => {
    const id = options.idForRoot(root.commonGitDir);
    const cached = previous.get(id);
    const touches = await mapBounded([...new Set([root.topLevel, ...root.workingRoots])], 2,
      (path) => recentTouch(path, root.commonGitDir));
    const lastTouchedAt = Math.max(...touches, cached?.lastTouchedAt ?? 0);
    const project: RepoWatchProject = {
      id, name: basename(root.topLevel), root: root.topLevel, commonGitDir: root.commonGitDir,
      attention: "unknown", attentionReasons: [], worktrees: [], hints: [],
      stats: { worktrees: 0, dirtyWorktrees: 0, conflictedWorktrees: 0, attachedAgents: 0,
        attachedSessions: 0, staged: 0, unstaged: 0, untracked: 0, conflicts: 0 },
      ...cached, lastTouchedAt, sortTouchedAt: lastTouchedAt, scanState: "pending",
    };
    // Older snapshots may have used the first worktree's name as the repo name.
    project.name = basename(root.topLevel);
    project.root = root.topLevel;
    return { root, project };
  });
  rows.sort((a, b) => (b.project.lastTouchedAt ?? 0) - (a.project.lastTouchedAt ?? 0)
    || a.project.name.localeCompare(b.project.name) || a.project.id.localeCompare(b.project.id));
  const limited = rows.slice(0, options.maxRoots);
  return {
    roots: limited.map((row) => row.root), projects: limited.map((row) => row.project),
    warnings: [
      ...(rows.length > limited.length ? [`Showing the ${options.maxRoots} most recently touched repositories.`] : []),
      ...(grouped.size > entries.length ? ["Repository discovery was limited to 512 tracked paths."] : []),
    ],
  };
}

/** The inventory is the first response; subsequent reads return row updates.
 * One broker-owned scan is shared by every caller. Each row keeps its identity,
 * recency and position for the whole pass, including failures and refreshes. */
export async function getProgressiveRepoWatchSnapshot(options: Options): Promise<RepoWatchSnapshot> {
  const pinned = options.scanId ? loads.get(options.scanId) : undefined;
  if (pinned) { await pinned.ready; return pinned.snapshot; }
  const existing = [...loads.values()].reverse().find((load) => load.key === options.key);
  if (existing && (existing.snapshot.scan?.phase !== "complete"
    || (!options.force && Date.now() - existing.snapshot.generatedAt <= options.cacheTtlMs))) {
    await existing.ready;
    return existing.snapshot;
  }
  // Never evict a running pass. Completed passes have a small bounded cache.
  for (const [id, load] of loads) {
    if (load.snapshot.scan?.phase === "complete"
      && (loads.size >= 4 || Date.now() - load.snapshot.generatedAt > 300_000)) loads.delete(id);
  }
  const id = randomUUID();
  if (loads.size >= 4) throw new Error("Repository scans are busy. Please retry shortly.");
  const load: Load = {
    key: options.key,
    snapshot: { generatedAt: Date.now(), projects: [], totals: options.totals([]), warnings: [],
      scan: { id, phase: "loading", completed: 0, total: 0 } },
    ready: Promise.resolve(),
  };
  loads.set(id, load);
  load.ready = (async () => {
    const first = await inventory({ ...options, previous: existing?.snapshot ?? options.previous });
    const projects = first.projects;
    const warnings = first.warnings;
    let completed = 0;
    const publish = () => {
      load.snapshot = { generatedAt: Date.now(), projects: [...projects], totals: options.totals(projects),
        warnings: [...new Set(warnings)],
        scan: { id, phase: completed === projects.length ? "complete" : "loading", completed, total: projects.length } };
    };
    publish();
    void mapBounded(first.roots, 3, async (root) => {
      const index = projects.findIndex((project) => project.commonGitDir === root.commonGitDir);
      const prior = projects[index]!;
      try {
        const result = await options.scan(root);
        warnings.push(...result.warnings);
        if (result.project.worktrees.length === 0) throw new Error("Repository status is unavailable.");
        // The progressive view needs facts, not the repeated discovery-hint
        // ledger. Keeping it out makes each follow-up response small.
        projects[index] = { ...result.project, id: prior.id, name: prior.name, root: prior.root,
          hints: [], worktrees: result.project.worktrees.map((worktree) => ({ ...worktree, hints: [] })),
          lastTouchedAt: Math.max(prior.lastTouchedAt ?? 0, ...result.project.worktrees.map((worktree) => worktree.lastTouchedAt ?? 0)),
          sortTouchedAt: prior.sortTouchedAt, scanState: "ready" };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        projects[index] = { ...prior, scanState: "error", scanError: message };
      }
      completed++;
      publish();
    });
  })().catch((error) => { loads.delete(id); throw error; });
  await load.ready;
  return load.snapshot;
}
