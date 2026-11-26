// Force-only Darwin cloning. A missing backend or failed syscall is not a
// request to copy. The caller may choose a Git worktree instead.
import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

const CLONE_NOFOLLOW = 1;

function clonefile(source: string, destination: string): boolean {
  const { dlopen, ptr } = createRequire(import.meta.url)("bun:ffi") as typeof import("bun:ffi");
  const library = dlopen("/usr/lib/libSystem.B.dylib", {
    clonefile: { args: ["ptr", "ptr", "i32"], returns: "i32" },
  });
  try {
    return library.symbols.clonefile(
      ptr(Buffer.from(`${source}\0`)),
      ptr(Buffer.from(`${destination}\0`)),
      CLONE_NOFOLLOW,
    ) === 0;
  } finally {
    library.close();
  }
}

function inside(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`));
}

/**
 * Stage a checkout clone in a unique sibling directory. It is not runnable
 * yet: the caller must validate the cloned tree and dependencies, select the
 * base and assign Git ownership before publication.
 */
export async function stageAgentWorkspaceClone(projectRoot: string): Promise<{
  path: string;
  dispose: () => Promise<void>;
} | null> {
  if (process.platform !== "darwin" || !process.versions.bun) return null;
  let root: string;
  try {
    root = await realpath(projectRoot);
    if (!(await lstat(join(root, ".git"))).isDirectory()) return null;
  } catch {
    return null;
  }
  const parent = dirname(root);
  if (inside(root, parent)) return null;
  const stage = await mkdtemp(join(parent, ".scout-clone-")).catch(() => null);
  if (!stage) return null;
  const identity = await lstat(stage, { bigint: true });
  const dispose = async () => {
    const current = await lstat(stage, { bigint: true }).catch(() => null);
    if (current?.isDirectory() && current.dev === identity.dev && current.ino === identity.ino
        && current.birthtimeNs === identity.birthtimeNs && await realpath(stage) === stage) {
      await rm(stage, { recursive: true });
    }
  };
  const destination = join(stage, "checkout");
  try {
    if (clonefile(root, destination)) return { path: destination, dispose };
  } catch {
    // No FFI or clonefile support; never use a copying fallback here.
  }
  await dispose();
  return null;
}
