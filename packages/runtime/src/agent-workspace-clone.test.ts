import { expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { prepareAgentWorkspaceClonePayload, stageAgentWorkspaceClone } from "./agent-workspace-clone.js";

test("force-only clone stages outside the checkout and refuses a Git file", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "scout-clone-test-"));
  const root = join(scratch, "source");
  try {
    const dotGit = join(root, ".git");
    await mkdir(root);
    await writeFile(dotGit, "gitdir: /elsewhere");
    expect(await stageAgentWorkspaceClone(root)).toBeNull();
    await rm(dotGit);
    await mkdir(dotGit);
    const dependency = "node_modules/data";
    await mkdir(join(root, dirname(dependency)));
    await writeFile(join(root, dependency), "original");
    const staged = await stageAgentWorkspaceClone(root);
    if (!staged) return; // Non-Darwin or volume without clonefile support.
    try {
      expect(dirname(dirname(staged.path))).not.toBe(root);
      expect((await lstat(join(staged.path, ".git"))).isDirectory()).toBe(true);
      expect(await readFile(join(staged.path, dependency), "utf8")).toBe("original");
      await writeFile(join(staged.path, dependency), "modified");
      expect(await readFile(join(root, dependency), "utf8")).toBe("original");
    } finally {
      await staged.dispose();
    }
    await expect(lstat(staged.path)).rejects.toThrow();
  } finally {
    await rm(scratch, { recursive: true });
  }
});

test("clone payload excludes ignored files and refuses dependency links to the source", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "scout-clone-payload-"));
  try {
    const clone = join(scratch, "checkout");
    for (const name of [".git", ".scout-worktrees", "node_modules", "packages"]) {
      await mkdir(join(clone, name), { recursive: true });
    }
    await writeFile(join(clone, ".env"), "not for the agent");
    await writeFile(join(clone, "packages", "tracked"), "tracked contents");
    await symlink("../packages/tracked", join(clone, "node_modules", "local"));
    const payload = join(scratch, "payload");
    await prepareAgentWorkspaceClonePayload(clone, payload, ["packages/tracked"]);
    expect(await readFile(join(payload, "node_modules", "local"), "utf8")).toBe("tracked contents");
    for (const excluded of [".git", ".env", ".scout-worktrees"]) {
      await expect(lstat(join(payload, excluded))).rejects.toThrow();
    }

    await mkdir(join(clone, "node_modules"));
    const outside = join(scratch, "outside");
    await writeFile(outside, "source");
    await symlink(outside, join(clone, "node_modules", "escape"));
    await expect(prepareAgentWorkspaceClonePayload(clone, join(scratch, "unsafe"), []))
      .rejects.toThrow("dependency symlink escapes");
    expect(await readFile(outside, "utf8")).toBe("source");
  } finally {
    await rm(scratch, { recursive: true });
  }
});
