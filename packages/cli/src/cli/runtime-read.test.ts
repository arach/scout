import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { ObservedSessionMaterials } from "@openscout/protocol";
import { createScoutCommandContext } from "./context.ts";
import { parseScoutArgv } from "./argv.ts";
import { parseObservedSessionSelector, readScoutRuntimeJson } from "./runtime-read.ts";
import { runDiffCommand } from "./commands/diff.ts";
import { runSessionCommand } from "./commands/session.ts";

const identity = { nodeId: "node-1", harness: "codex", nativeSessionId: "Native/Case ID" };
const materials: ObservedSessionMaterials = {
  schema: "scout.session-materials/v1", identity, links: [], source: "history", worktreePath: "/repo",
  files: [{ path: "src/a.ts", state: "modified", touches: 2, lastTouchedAt: 1 }, { path: "read.txt", state: "read", touches: 1, lastTouchedAt: 1 }],
  counts: { files: 2, changedFiles: 1, readFiles: 1 },
  coverage: { kind: "observed_tool_paths", bytes: 100, lines: 2, maxBytes: 1000, maxLines: 100, excludedOutsideWorktree: 0, pendingActions: 0, failedActions: 0, skippedRecords: 0, complete: true },
};
const tuple = [identity.nativeSessionId, "--node", identity.nodeId, "--harness", identity.harness];
const diff = { worktreePath: "/repo", layers: ["branch", "unstaged", "staged"].map(kind => ({ kind, files: [], rawPatch: `${kind} patch` })) };

async function fixture(run: (value: { context: ReturnType<typeof createScoutCommandContext>; lines: string[]; paths: URL[] }) => Promise<void>, respond: (url: URL) => Response = url => Response.json(url.pathname.endsWith("/materials") ? materials : diff), mode: "json" | "plain" = "json") {
  const paths: URL[] = [], lines: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) { const url = new URL(req.url); paths.push(url); return respond(url); } });
  const context = createScoutCommandContext({ cwd: "/repo", env: { OPENSCOUT_BROKER_URL: server.url.origin, OPENSCOUT_WEB_URL: "http://127.0.0.1:1", OPENSCOUT_WEB_AUTH_TOKEN: "must-not-use" }, outputMode: mode, stdout: line => lines.push(line), stderr() {}, isTty: false });
  try { await run({ context, lines, paths }); } finally { await server.stop(true); }
}

describe("runtime read consumers without web", () => {
  test("uses the selected Unix control socket without an HTTP/web fallback", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime_read_"));
    const paths: string[] = [];
    const server = Bun.serve({ unix: join(dir, "control.sock"), fetch(req) { paths.push(new URL(req.url).pathname); return Response.json(diff); } });
    try {
      const context = createScoutCommandContext({ env: { OPENSCOUT_BROKER_URL: "http://127.0.0.1:1", OPENSCOUT_BROKER_SOCKET_PATH: join(dir, "control.sock") }, stdout() {} });
      expect(await readScoutRuntimeJson<typeof diff>(context, "/v1/repo-diff/worktree?path=/repo")).toEqual(diff);
      expect(paths).toEqual(["/v1/repo-diff/worktree"]);
    } finally { await server.stop(true); rmSync(dir, { recursive: true, force: true }); }
  });
  test("requires an exact tuple and preserves opaque case-sensitive ids", () => {
    expect(parseObservedSessionSelector(tuple)).toEqual(identity);
    expect(parseScoutArgv(["session", "touched", ...tuple, "--json"])).toMatchObject({ command: "session", args: ["touched", ...tuple], outputMode: "json" });
    expect(parseScoutArgv(["diff", "session", ...tuple])).toMatchObject({ command: "diff", args: ["session", ...tuple] });
    for (const args of [["ref"], ["ref", "--node", "node"], [...tuple, "extra"], [...tuple, "--node", "again"], [...tuple, "--harness", "claude"], ["x", "--node", "n", "--harness", "unknown"], [...tuple, "--typo"]]) expect(() => parseObservedSessionSelector(args)).toThrow();
  });
  test("worktree diff uses only the public route and retains file/raw/JSON modes", async () => {
    await fixture(async ({ context, lines, paths }) => {
      await runDiffCommand(context, ["worktree", ".", "--file", "src/a.ts"]);
      expect(paths).toHaveLength(1); expect(paths[0]!.pathname).toBe("/v1/repo-diff/worktree");
      expect(paths[0]!.searchParams.get("path")).toBe("/repo"); expect(paths[0]!.searchParams.getAll("file")).toEqual(["src/a.ts"]);
      expect(JSON.parse(lines[0]!)).toEqual(diff);
    });
    await fixture(async ({ context, lines }) => { await runDiffCommand(context, ["worktree", "--raw"]); expect(lines).toEqual(["branch patch\nunstaged patch\nstaged patch"]); }, undefined, "plain");
  });
  test("session touched uses the exact materials tuple, preserving identity and coverage", async () => {
    await fixture(async ({ context, lines, paths }) => {
      await runSessionCommand(context, ["touched", ...tuple]);
      expect(paths).toHaveLength(1); expect(paths[0]!.pathname).toBe("/v1/observed-sessions/materials");
      expect(Object.fromEntries(paths[0]!.searchParams)).toEqual(identity); expect(JSON.parse(lines[0]!)).toEqual(materials);
    });
  });
  test("touched text labels bounded observations rather than claiming full history", async () => {
    await fixture(async ({ context, lines }) => { await runSessionCommand(context, ["touched", ...tuple]); expect(lines[0]).toContain("incomplete coverage"); expect(lines[0]).toContain("node-1/codex/Native/Case ID"); }, () => Response.json({ ...materials, coverage: { ...materials.coverage, complete: false } }), "plain");
  });
  test("session diff filters changed files by default and keeps authoritative worktree/coverage", async () => {
    await fixture(async ({ context, lines, paths }) => {
      await runDiffCommand(context, ["session", ...tuple]); expect(paths.map(p => p.pathname)).toEqual(["/v1/observed-sessions/materials", "/v1/repo-diff/worktree"]);
      expect(paths[1]!.searchParams.getAll("file")).toEqual(["src/a.ts"]);
      expect(JSON.parse(lines[0]!)).toMatchObject({ identity, coverage: materials.coverage, scope: { kind: "session", touchedFiles: 2, changedFiles: 1, filteredPaths: ["src/a.ts"] } });
    });
  });
  test("--all and --touched include read paths; --changed keeps only modifications", async () => {
    for (const flag of ["--all", "--touched", "--changed"]) await fixture(async ({ context, paths }) => {
      await runDiffCommand(context, ["session", ...tuple, flag]); expect(paths[1]!.searchParams.getAll("file")).toEqual(flag === "--changed" ? ["src/a.ts"] : ["src/a.ts", "read.txt"]);
    });
  });
  test("empty touched sets never request an unfiltered worktree", async () => {
    await fixture(async ({ context, lines, paths }) => { await runDiffCommand(context, ["session", ...tuple]); expect(paths).toHaveLength(1); expect(JSON.parse(lines[0]!)).toMatchObject({ layers: [], scope: { filteredPaths: [] } }); }, () => Response.json({ ...materials, files: [], counts: { files: 0, changedFiles: 0, readFiles: 0 } }));
  });
  test("incomplete materials and too many paths refuse before diff", async () => {
    for (const result of [{ ...materials, coverage: { ...materials.coverage, complete: false } }, { ...materials, files: Array.from({ length: 201 }, (_, i) => ({ ...materials.files[0]!, path: `${i}.ts` })) }]) await fixture(async ({ context, paths, lines }) => {
      await expect(runDiffCommand(context, ["session", ...tuple])).rejects.toThrow(result.coverage.complete ? "too_many_files" : "incomplete"); expect(paths).toHaveLength(1); expect(lines).toEqual([]);
    }, () => Response.json(result));
  });
  test("a different response tuple refuses without local or web fallback", async () => {
    await fixture(async ({ context, paths }) => { await expect(runDiffCommand(context, ["session", ...tuple])).rejects.toThrow("identity_mismatch"); expect(paths).toHaveLength(1); }, () => Response.json({ ...materials, identity: { ...identity, nodeId: "other" } }));
  });
  test("HTTP conflict/unavailable/forbidden errors remain distinguishable and never yield empty data", async () => {
    for (const status of [409, 503, 403]) await fixture(async ({ context, lines, paths }) => {
      await expect(runSessionCommand(context, ["touched", ...tuple])).rejects.toThrow(`HTTP ${status} session_materials_identity_unverified`); expect(lines).toEqual([]); expect(paths).toHaveLength(1);
    }, () => Response.json({ error: "session_materials_identity_unverified" }, { status }));
  });
  test("unknown worktree or unavailable diff remains a failure", async () => {
    await fixture(async ({ context, lines }) => { await expect(runDiffCommand(context, ["worktree"])).rejects.toThrow("HTTP 503 repo_diff_unavailable"); expect(lines).toEqual([]); }, () => Response.json({ error: "repo_diff_unavailable" }, { status: 503 }));
  });
  test("an explicit unavailable broker never falls back to a local data source", async () => {
    const context = createScoutCommandContext({ env: { OPENSCOUT_BROKER_URL: "http://127.0.0.1:1" }, stdout() {} });
    await expect(readScoutRuntimeJson(context, "/v1/repo-diff/worktree?path=/repo")).rejects.toThrow();
  });
  test("help and invalid selectors make no requests", async () => {
    await fixture(async ({ context, paths }) => {
      await runDiffCommand(context, ["session", "--help"]); await runSessionCommand(context, ["touched", "--help"]);
      await expect(runSessionCommand(context, ["touched", "unqualified-ref"])).rejects.toThrow("unqualified refs");
      await expect(runDiffCommand(context, ["session", ...tuple, "--all", "--node"])).rejects.toThrow("needs a value"); expect(paths).toEqual([]);
    });
  });
});
