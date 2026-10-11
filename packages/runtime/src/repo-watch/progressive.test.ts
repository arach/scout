import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, utimes, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProgressiveRepoWatchSnapshot } from "./progressive.js";
import type { RepoWatchProject, RepoWatchSnapshot } from "./index.js";

const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "scout-progressive-")));
  directories.push(directory);
  const recent = join(directory, "recent");
  const older = join(directory, "older");
  for (const root of [recent, older]) {
    await mkdir(join(root, ".git"), { recursive: true });
    await writeFile(join(root, "README.md"), "example");
  }
  await utimes(join(older, "README.md"), 100, 100);
  await utimes(older, 100, 100);
  return { directory, recent, older };
}
function totals(projects: RepoWatchProject[]): RepoWatchSnapshot["totals"] {
  return { projects: projects.length, worktrees: projects.flatMap(p => p.worktrees).length,
    dirtyWorktrees: 0, conflictedWorktrees: 0, attentionWorktrees: 0, attachedAgents: 0, attachedSessions: 0 };
}
function detail(project: RepoWatchProject) {
  return { project: { ...project, attention: "critical" as const,
    worktrees: [{ id: `wt:${project.id}`, lastTouchedAt: Date.now() + 1000 }] as RepoWatchProject["worktrees"] }, warnings: [] };
}
async function until(read: () => Promise<RepoWatchSnapshot>, accept: (snapshot: RepoWatchSnapshot) => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const snapshot = await read();
    if (accept(snapshot)) return snapshot;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  throw new Error("Progressive snapshot did not advance");
}

test("returns recent-first inventory before Git completes, coalesces readers and never reorders on enrichment", async () => {
  const { directory, recent, older } = await fixture();
  const gates = new Map([recent, older].map(root => [root, deferred<ReturnType<typeof detail>>()]));
  let scans = 0;
  const options = { key: directory, hints: [older, recent].map(path => ({ path, source: "environment" as const })),
    maxRoots: 128, cacheTtlMs: 60_000, idForRoot: (path: string) => path, totals,
    scan: async (root: { topLevel: string }) => { scans++; return gates.get(root.topLevel)!.promise; } };
  const initial = await getProgressiveRepoWatchSnapshot(options);
  expect(initial.projects.map(p => p.name)).toEqual(["recent", "older"]);
  expect(initial.projects.every(p => p.scanState === "pending" && p.worktrees.length === 0)).toBe(true);
  expect(initial.scan).toMatchObject({ phase: "loading", completed: 0, total: 2 });
  const again = await getProgressiveRepoWatchSnapshot({ ...options, force: true });
  expect(again.scan?.id).toBe(initial.scan?.id);
  expect(scans).toBe(2);
  gates.get(older)!.resolve(detail(initial.projects[1]!));
  const read = () => getProgressiveRepoWatchSnapshot({ ...options, scanId: initial.scan!.id });
  const partial = await until(read, s => s.scan?.completed === 1);
  expect(partial.projects.map(p => p.id)).toEqual(initial.projects.map(p => p.id));
  expect(partial.projects[1]!.scanState).toBe("ready");
  gates.get(recent)!.reject(new Error("unreadable repository"));
  const complete = await until(read, s => s.scan?.phase === "complete");
  expect(complete.projects).toHaveLength(2);
  expect(complete.projects[0]).toMatchObject({ scanState: "error", scanError: "unreadable repository" });
  expect(complete.projects.map(p => p.sortTouchedAt)).toEqual(initial.projects.map(p => p.sortTouchedAt));
  expect(complete.projects[1]!.lastTouchedAt!).toBeGreaterThan(initial.projects[1]!.lastTouchedAt!);
  const refreshGate = deferred<ReturnType<typeof detail>>();
  const refreshed = await getProgressiveRepoWatchSnapshot({ ...options, force: true, scan: () => refreshGate.promise });
  expect(refreshed.scan?.id).not.toBe(initial.scan?.id);
  expect((await read()).scan?.id).toBe(initial.scan?.id);
  expect(refreshed.projects[0]!.id).toBe(complete.projects[1]!.id);
  expect(refreshed.projects[0]!.worktrees).toEqual(complete.projects[1]!.worktrees);
  refreshGate.resolve(detail(complete.projects[1]!));
  await until(() => getProgressiveRepoWatchSnapshot({ ...options, scanId: refreshed.scan!.id }), s => s.scan?.phase === "complete");
});

test("groups linked worktrees, nested paths and symlinks by common Git directory before applying the recent-first limit", async () => {
  const { directory, recent, older } = await fixture();
  const linked = join(directory, "linked");
  const gitDir = join(recent, ".git", "worktrees", "linked");
  await mkdir(gitDir, { recursive: true });
  await mkdir(linked);
  await mkdir(join(recent, "src"));
  await writeFile(join(linked, ".git"), `gitdir: ${gitDir}\n`);
  await writeFile(join(gitDir, "commondir"), "../..\n");
  await symlink(recent, join(directory, "alias"));
  const gate = deferred<ReturnType<typeof detail>>();
  const options = { key: directory, hints: [older, linked, join(recent, "src"), join(directory, "alias"), join(directory, "missing")]
    .map(path => ({ path, source: "environment" as const })), maxRoots: 1, cacheTtlMs: 60_000,
    idForRoot: (path: string) => path, totals, scan: () => gate.promise };
  const initial = await getProgressiveRepoWatchSnapshot(options);
  expect(initial.projects).toHaveLength(1);
  expect(initial.projects[0]!.root).toBe(recent);
  expect(initial.warnings).toContain("Showing the 1 most recently touched repositories.");
  gate.resolve(detail(initial.projects[0]!));
  await until(() => getProgressiveRepoWatchSnapshot(options), s => s.scan?.phase === "complete");
});

test("an empty inventory completes without scheduling status scans", async () => {
  let scans = 0;
  const snapshot = await getProgressiveRepoWatchSnapshot({ key: "empty-inventory", hints: [], maxRoots: 128,
    cacheTtlMs: 60_000, idForRoot: p => p, totals, scan: async () => { scans++; throw new Error("unexpected scan"); } });
  expect(snapshot.scan).toMatchObject({ phase: "complete", completed: 0, total: 0 });
  expect(scans).toBe(0);
});
