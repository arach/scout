// Force-only Darwin cloning. A missing backend or failed syscall is not a
// request to copy. The caller may choose a Git worktree instead.
import { lstat, mkdir, mkdtemp, readdir, readlink, realpath, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

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

async function validateDependencies(root: string, path: string): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) {
    const target = await readlink(path);
    if (isAbsolute(target) || !inside(root, resolve(dirname(path), target))
        || !inside(root, await realpath(path))) {
      throw new Error("dependency symlink escapes its workspace");
    }
  } else if (stat.isDirectory()) {
    for (const name of await readdir(path)) await validateDependencies(root, join(path, name));
  } else if (!stat.isFile()) {
    throw new Error("unsupported dependency entry");
  }
}

/**
 * Extract only regular tracked files and an isolated root node_modules from
 * a private clone. The caller supplies paths from the selected Git tree (not
 * the live index), and must verify their contents against that tree before
 * publication. No source-Git metadata, ignored config, or old workspace is
 * moved. Both directories belong to the staging transaction.
 */
export async function prepareAgentWorkspaceClonePayload(
  clone: string,
  payload: string,
  trackedPaths: readonly string[],
): Promise<void> {
  const root = await realpath(clone);
  await mkdir(payload, { mode: 0o700 }); // Exclusive destination.
  for (const file of trackedPaths) {
    const parts = file.split("/");
    if (parts.some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")
        || [".scout-worktrees", "node_modules"].includes(parts[0]!)) {
      throw new Error("unsupported tracked path in workspace clone");
    }
    const source = join(root, file);
    if (!inside(root, source) || await realpath(source) !== source || !(await lstat(source)).isFile()) {
      throw new Error("workspace clone tracked path is not a regular file");
    }
    const dest = join(payload, file);
    await mkdir(dirname(dest), { recursive: true });
    await rename(source, dest);
  }

  const dependencies = join(root, "node_modules");
  const stat = await lstat(dependencies).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return;
  if (!stat.isDirectory()) throw new Error("node_modules must be a real directory");
  // Links into the tracked tree resolve in the payload, but never to the
  // source checkout or to ignored files left in the clone.
  const payloadRoot = await realpath(payload);
  const destination = join(payloadRoot, "node_modules");
  await rename(dependencies, destination);
  await validateDependencies(payloadRoot, destination);
}
