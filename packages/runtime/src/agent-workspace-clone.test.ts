import { expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stageAgentWorkspaceClone } from "./agent-workspace-clone.js";

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
