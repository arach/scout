import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, normalize, resolve } from "node:path";
import { hash } from "./text.js";

export function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8", timeout: 5_000, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    }).trim();
  } catch { return null; }
}

/** Cache only for one refresh. Missing paths stay distinct; basenames never identify a repo. */
export function projectCanonicalizer(): (path: string) => string | null {
  const cache = new Map<string, string | null>();
  return (path) => {
    if (cache.has(path)) return cache.get(path)!;
    if (!isAbsolute(path) || path.includes("\0")) { cache.set(path, null); return null; }
    let root = normalize(path);
    try { root = realpathSync(root); } catch { /* preserve an unavailable absolute root */ }
    const common = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const top = git(root, ["rev-parse", "--show-toplevel"]);
    if (common && top) root = common.endsWith("/.git") ? dirname(common) : top;
    root = resolve(root);
    cache.set(path, root);
    return root;
  };
}

export function projectId(nodeId: string, root: string): string { return `project:${hash([nodeId, root]).slice(0, 24)}`; }
export function sessionTargetId(nodeId: string, harness: string, sessionId: string): string {
  return `session:${hash([nodeId, harness, sessionId]).slice(0, 24)}`;
}
