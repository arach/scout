import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { getRepoDiffSnapshot, type RepoDiffSnapshotOptions, type RepoDiffResponse, type ScoutRepoDiffSnapshot } from "./repo-diff/index.js";
import { runRepoServiceJson } from "./repo-service/process.js";

/** Local-only read contract. No source-tree binary discovery, cargo or web fallback. */
export type RepoDiffRead = (options: RepoDiffSnapshotOptions) => Promise<ScoutRepoDiffSnapshot>;
export class RepoDiffQueryError extends Error {}
const layers = new Set(["branch", "staged", "unstaged"]);
export const REPO_DIFF_READ_LIMITS = Object.freeze({
  maxPatchBytes: 512 * 1024, maxFiles: 200, maxHunksPerFile: 100,
  maxLinesPerHunk: 200, timeoutMs: 5_000, includeBinaryPatch: false,
});

/** Absolute worktree identity and literal repository-relative filters only. */
export async function parseRepoDiffRead(url: URL): Promise<RepoDiffSnapshotOptions> {
  const allowed = new Set(["path", "file", "layers", "baseRef", "compareRef", "tier"]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || (key !== "file" && url.searchParams.getAll(key).length !== 1)) throw new RepoDiffQueryError("Unknown or repeated diff parameter.");
  }
  const path = url.searchParams.get("path");
  if (!path || path.length > 4096 || path.includes("\0") || !isAbsolute(path)) throw new RepoDiffQueryError("path must be an absolute worktree directory.");
  // A missing/unreadable worktree is unavailable, never a successful empty diff.
  const worktreePath = await realpath(path);
  if (!(await stat(worktreePath)).isDirectory()) throw new RepoDiffQueryError("path must be a directory.");
  const selected = (url.searchParams.get("layers") ?? "branch,unstaged,staged").split(",");
  if (!selected.length || selected.length > 3 || new Set(selected).size !== selected.length || selected.some(value => !layers.has(value))) throw new RepoDiffQueryError("Invalid diff layers.");
  const paths = url.searchParams.getAll("file");
  if (paths.length > 200) throw new RepoDiffQueryError("At most 200 file filters are allowed.");
  for (const path of paths) {
    if (!path || path.length > 4096 || isAbsolute(path) || /[\0\\*?\[\]:]/u.test(path)) throw new RepoDiffQueryError("file must be a literal relative path.");
    const child = relative(worktreePath, resolve(worktreePath, path));
    if (!child || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new RepoDiffQueryError("file must stay within the worktree.");
  }
  const refs = ["baseRef", "compareRef"] as const;
  for (const ref of refs) {
    const value = url.searchParams.get(ref);
    if (value !== null && (!value || value.length > 256 || value.startsWith("-") || /[\0\r\n]/u.test(value))) throw new RepoDiffQueryError("Invalid Git ref.");
  }
  const tier = url.searchParams.get("tier") ?? "patch";
  if (tier !== "patch" && tier !== "summary") throw new RepoDiffQueryError("tier must be patch or summary.");
  return {
    worktreePath, layers: selected as RepoDiffSnapshotOptions["layers"],
    ...(paths.length ? { paths: [...new Set(paths)] } : {}),
    ...(url.searchParams.has("baseRef") ? { baseRef: url.searchParams.get("baseRef") } : {}),
    ...(url.searchParams.has("compareRef") ? { compareRef: url.searchParams.get("compareRef") } : {}),
    limits: { ...REPO_DIFF_READ_LIMITS, includeRawPatch: tier === "patch", includeParsedHunks: tier === "patch" },
  };
}

export function createCoreRepoDiffRead(run: typeof runRepoServiceJson = runRepoServiceJson): RepoDiffRead {
  return options => getRepoDiffSnapshot({
  ...options,
  // null disables the legacy spawn fallback, including implicit cargo run.
  nativeDiff: async request => {
    const value = await run(null, request, 6_500, "diff") as RepoDiffResponse;
    if (value?.schema !== "openscout.repo.diff/v1" || value.worktreePath !== request.worktreePath || !Array.isArray(value.layers)) throw new Error("Invalid repo diff identity or schema.");
    return value;
  },
  });
}
export const readCoreRepoDiff = createCoreRepoDiffRead();

/** Coalesce nothing across identities; refuse overload rather than queue patches. */
export function createRepoDiffReadHandler(read: RepoDiffRead = readCoreRepoDiff) {
  let active = 0;
  return async (url: URL): Promise<{ status: number; body: unknown }> => {
    if (active >= 2) return { status: 503, body: { error: "repo_diff_busy", retryable: true } };
    active++;
    try {
      const options = await parseRepoDiffRead(url);
      const snapshot = await read(options);
      return { status: 200, body: { ...snapshot, scope: { kind: "worktree", label: "Worktree diff", worktreePath: options.worktreePath, filteredPaths: options.paths ?? [] } } };
    } catch (error) {
      return { status: error instanceof RepoDiffQueryError ? 400 : 503,
        body: { error: error instanceof RepoDiffQueryError ? "invalid_repo_diff_query" : "repo_diff_unavailable" } };
    } finally { active--; }
  };
}
