import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readTailEventsForSession } from "./service.js";
import type { DiscoverySnapshot } from "./types.js";

const directories: string[] = [];
const savedEnv: Record<string, string | undefined> = {};
const ISOLATED_ENV = [
  "OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT",
  "OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT",
  "CODEX_HOME",
] as const;

beforeEach(async () => {
  for (const key of ISOLATED_ENV) savedEnv[key] = process.env[key];
  // Exact lookups must read only the stores owned by this test.
  const fixtureRoot = await mkdtemp(join(tmpdir(), "openscout-tail-stores-"));
  directories.push(fixtureRoot);
  process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT = join(fixtureRoot, "codex-sessions");
  process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT = join(fixtureRoot, "claude-projects");
  delete process.env.CODEX_HOME;
});


afterEach(async () => {
  for (const key of ISOLATED_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("exact session Tail history", () => {
  for (const source of ["claude", "codex"] as const) {
    test(`reads ${source} history when opted in without changing Observe's source selection`, async () => {
      const directory = await mkdtemp(join(tmpdir(), "openscout-tail-history-"));
      directories.push(directory);
      const sessionId = `${source}-quiet-task`;
      const transcriptPath = join(directory, "session.jsonl");
      const records = ["earlier reply", "latest reply"].map((text, index) => {
        const timestamp = `2026-04-27T15:00:0${index}.000Z`;
        return source === "claude" ? {
          type: "assistant", timestamp,
          message: { id: `message-${index}`, content: [{ type: "text", text }] },
        } : {
          type: "response_item", timestamp,
          payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
        };
      });
      const content = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
      await writeFile(transcriptPath, content);
      const discovery: DiscoverySnapshot = {
        generatedAt: Date.now(),
        processes: [],
        transcripts: [{ source, transcriptPath, sessionId, cwd: directory, project: "fixture",
          harness: "unattributed", mtimeMs: Date.now(), size: Buffer.byteLength(content) }],
        totals: { total: 0, scoutManaged: 0, hudsonManaged: 0, unattributed: 0, transcripts: 1 },
      };

      expect(await readTailEventsForSession(sessionId, { discovery })).toBeNull();
      const result = await readTailEventsForSession(sessionId, { discovery, includeAllSources: true, limit: 1 });
      expect(result?.events).toHaveLength(1);
      expect(result?.events[0]).toMatchObject({ source, sessionId, kind: "assistant", summary: "latest reply" });
      expect(await readTailEventsForSession("another-task", { discovery, includeAllSources: true })).toBeNull();
    });
  }
  test("finds an old Claude session by its file name", async () => {
    const sessionId = "c6470ea2-9ad0-468c-ab7a-8f916e5cd43d";
    const project = join(process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT!, "-work-project");
    mkdirSync(project, { recursive: true });
    const path = join(project, `${sessionId}.jsonl`);
    writeFileSync(path, JSON.stringify({
      type: "assistant", timestamp: "2026-10-11T15:09:01.000Z", sessionId, cwd: "/work/project",
      message: { id: "message-1", content: [{ type: "text", text: "old but present" }] },
    }) + "\n");
    const threeDaysAgo = (Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(path, threeDaysAgo, threeDaysAgo);

    const discovery: DiscoverySnapshot = { generatedAt: Date.now(), processes: [], transcripts: [],
      totals: { total: 0, scoutManaged: 0, hudsonManaged: 0, unattributed: 0, transcripts: 0 } };
    const result = await readTailEventsForSession(sessionId, { discovery, includeAllSources: true });
    expect(result?.events.map((event) => event.summary)).toEqual(["old but present"]);
    expect(result?.transcript.transcriptPath).toBe(path);
  });

  test("finds an old Claude subagent under its parent's folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "scout-old-subagent-"));
    directories.push(root);
    const previousRoot = process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT;
    process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT = root;
    try {
      const parentId = "9b1f63d2-5c1e-4c55-8d0e-0c3a7a4f2e11";
      const project = join(process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT!, "-work-project");
      const subagents = join(project, parentId, "subagents");
      mkdirSync(subagents, { recursive: true });
      const parentPath = join(project, `${parentId}.jsonl`);
      writeFileSync(parentPath, JSON.stringify({
        type: "assistant", timestamp: "2026-10-11T15:09:01.000Z", sessionId: parentId, cwd: "/work/project",
        message: { id: "message-1", content: [{ type: "text", text: "the parent" }] },
      }) + "\n");
      const childPath = join(subagents, "agent-worker123.jsonl");
      writeFileSync(childPath, JSON.stringify({
        type: "assistant", timestamp: "2026-10-11T15:10:01.000Z", sessionId: parentId, cwd: "/work/project",
        message: { id: "message-2", content: [{ type: "text", text: "the child's reply" }] },
      }) + "\n");
      const threeDaysAgo = (Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000;
      utimesSync(parentPath, threeDaysAgo, threeDaysAgo);
      utimesSync(childPath, threeDaysAgo, threeDaysAgo);

      const result = await readTailEventsForSession("worker123", { discovery: { generatedAt: Date.now(), processes: [], transcripts: [], totals: { total: 0, scoutManaged: 0, hudsonManaged: 0, unattributed: 0, transcripts: 0 } }, includeAllSources: true });
      expect(result?.events.map((event) => event.summary)).toEqual(["the child's reply"]);
      expect(result?.transcript.parentSessionId).toBe(parentId);
      expect(await readTailEventsForSession("worker123", { discovery: { generatedAt: Date.now(), processes: [], transcripts: [], totals: { total: 0, scoutManaged: 0, hudsonManaged: 0, unattributed: 0, transcripts: 0 } } })).toBeNull();
    } finally {
      if (previousRoot === undefined) delete process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT;
      else process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT = previousRoot;
    }
  });

});
