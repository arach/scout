import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { bundleScoutKnowledgeIndexChildBun, getOpenScoutRepoRoot } from "./bundle-core.mjs";

test("the CLI indexing child runs from a relocated installed-style dist fixture", () => {
  const repo = getOpenScoutRepoRoot();
  // Resolve normal runtime dependencies through this lane's install, while the
  // emitted child itself has no source-tree sibling or source-relative imports.
  const root = mkdtempSync(join(repo, "packages/cli/node_modules/.child-bundle-test-"));
  const output = join(root, "dist/knowledge-index-child.mjs");
  try {
    assert.equal(bundleScoutKnowledgeIndexChildBun(repo, output), true);
    const transcripts = join(root, "claude/project");
    mkdirSync(transcripts, { recursive: true });
    writeFileSync(join(transcripts, "fixture.jsonl"), JSON.stringify({
      type: "user", cwd: root, sessionId: "packed-child-fixture",
      message: { role: "user", content: "A packaged indexing child can read this fixture." },
    }) + "\n");
    const support = join(root, "support");
    mkdirSync(support, { recursive: true });
    // Keep the installed-style cwd under node_modules, but isolate all Scout
    // state from the invoking runtime/instance. Indexing requires local consent.
    const inherited = Object.fromEntries(Object.entries(process.env)
      .filter(([key]) => !/^(OPENSCOUT|SCOUT)_/.test(key)));
    const env = { ...inherited, HOME: join(root, "home"),
      OPENSCOUT_HOME: join(root, "home/.openscout"), OPENSCOUT_INSTANCE: "prod",
      OPENSCOUT_CONTROL_HOME: join(root, "control"),
      OPENSCOUT_SUPPORT_DIRECTORY: support,
      OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT: join(root, "claude") };
    const runChild = () => {
      const run = spawnSync("bun", [output, JSON.stringify({ harness: "claude", limit: 1 })], {
        cwd: root, encoding: "utf8", timeout: 20_000, env,
      });
      assert.equal(run.status, 0, run.stderr || run.error?.message);
      const outcome = JSON.parse(run.stdout.trim().split("\n").at(-1));
      assert.equal(outcome.ok, true);
      return outcome;
    };
    const assertDisabled = (outcome) => {
      assert.equal(outcome.result.enabled, false);
      assert.equal(outcome.result.job.state, "cancelled");
      assert.equal(outcome.result.discovered, 0);
      assert.equal(outcome.result.indexed, 0);
    };
    // Missing consent is not a packaging failure or an implicit opt-in.
    assertDisabled(runChild());
    writeFileSync(join(support, "settings.json"), JSON.stringify({ knowledgeIndexEnabled: true }));
    const outcome = runChild();
    assert.notEqual(outcome.result.enabled, false);
    assert.equal(outcome.result.discovered, 1);
    assert.equal(outcome.result.indexed, 1);
    assert.equal(outcome.result.failed, 0);
    assert.equal(outcome.result.job.state, "completed");
    assert.ok(outcome.status.chunks > 0);
    // Revoking consent must still prevent discovery through the bundled child.
    writeFileSync(join(support, "settings.json"), JSON.stringify({ knowledgeIndexEnabled: false }));
    assertDisabled(runChild());
  } finally { rmSync(root, { recursive: true, force: true }); }
});
