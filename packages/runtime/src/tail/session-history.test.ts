import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { __testing, mergeSessionHistory, readTailEventsForSession } from "./service.js";
import { CodexSource, codexSessionRoots, findCodexTranscript } from "./codex-source.js";
import { resolveOpenScoutSupportPaths } from "../support-paths.js";
import type { DiscoverySnapshot, TailEvent } from "./types.js";

const directories: string[] = [];
const savedEnv: Record<string, string | undefined> = {};
const ISOLATED_ENV = [
  "OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT",
  "OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT",
  "CODEX_HOME",
  "HOME",
  "OPENSCOUT_SUPPORT_DIRECTORY",
  "OPENSCOUT_INSTANCE",
  "OPENSCOUT_INSTANCE_ROOT",
  "OPENSCOUT_INSTANCE_PORT_BASE",
] as const;

let fixtureRoot = "";

beforeEach(async () => {
  for (const key of ISOLATED_ENV) savedEnv[key] = process.env[key];
  // Exact lookups must read only the stores owned by this test.
  fixtureRoot = await mkdtemp(join(tmpdir(), "openscout-tail-stores-"));
  directories.push(fixtureRoot);
  process.env.HOME = fixtureRoot;
  process.env.OPENSCOUT_SUPPORT_DIRECTORY = join(fixtureRoot, "support");
  __testing.resetTailEventBuffers();
  process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT = join(fixtureRoot, "codex-sessions");
  process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT = join(fixtureRoot, "claude-projects");
  delete process.env.CODEX_HOME;
});


afterEach(async () => {
  __testing.resetTailEventBuffers();
  for (const key of ISOLATED_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function emptyDiscovery(): DiscoverySnapshot {
  return {
    generatedAt: Date.now(),
    processes: [],
    transcripts: [],
    totals: { total: 0, scoutManaged: 0, hudsonManaged: 0, unattributed: 0, transcripts: 0 },
  };
}

/** A UUIDv7 thread id minted at `createdAt`, the way Codex names threads. */
function uuidV7At(createdAt: number, tail: string): string {
  const hex = createdAt.toString(16).padStart(12, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${tail.slice(0, 3)}-8${tail.slice(3, 6)}-${tail.slice(6, 18).padEnd(12, "0")}`;
}

function localDayFolder(at: number): string[] {
  const day = new Date(at);
  return [
    String(day.getFullYear()),
    String(day.getMonth() + 1).padStart(2, "0"),
    String(day.getDate()).padStart(2, "0"),
  ];
}

function writeCodexRollout(folder: string, threadId: string, replies: string[]): string {
  mkdirSync(folder, { recursive: true });
  const path = join(folder, `rollout-2026-10-11T21-16-16-${threadId}.jsonl`);
  const lines = [
    { timestamp: "2026-10-11T21:16:16.000Z", type: "session_meta", payload: { id: threadId, cwd: "/work/openscout" } },
    ...replies.map((text, index) => ({
      timestamp: `2026-10-11T21:16:2${index}.000Z`,
      type: "response_item",
      payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
    })),
  ];
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  // Older than any discovery window: only an exact lookup can find it.
  const threeDaysAgo = (Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000;
  utimesSync(path, threeDaysAgo, threeDaysAgo);
  return path;
}

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


describe("Codex history outside the discovery window", () => {
  test("finds a finished Codex thread that discovery no longer lists", async () => {
    const createdAt = Date.UTC(2026, 9, 11, 21, 16, 16);
    const threadId = uuidV7At(createdAt, "a1b2c3d4e5f6a7b8c9d0");
    const root = process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT!;
    writeCodexRollout(join(root, ...localDayFolder(createdAt)), threadId, ["read the diff", "review done"]);

    const result = await readTailEventsForSession(threadId, { discovery: emptyDiscovery(), includeAllSources: true });
    expect(result?.transcript.sessionId).toBe(threadId);
    expect(result?.events.filter((event) => event.kind === "assistant").map((event) => event.summary))
      .toEqual(["read the diff", "review done"]);
    // Observe's native-only lookup stays as it was.
    expect(await readTailEventsForSession(threadId, { discovery: emptyDiscovery() })).toBeNull();
  });

  test("finds a rollout filed under an unexpected day by walking folder names", async () => {
    const threadId = uuidV7At(Date.UTC(2026, 9, 11, 21, 16, 16), "f0e1d2c3b4a5968778695a4b");
    const root = process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT!;
    writeCodexRollout(join(root, "2025", "01", "02"), threadId, ["filed elsewhere"]);

    const result = await readTailEventsForSession(threadId, { discovery: emptyDiscovery(), includeAllSources: true });
    expect(result?.events.filter((event) => event.kind === "assistant").map((event) => event.summary))
      .toEqual(["filed elsewhere"]);
  });

  test("reads Scout's background Codex home by default", () => {
    delete process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT;
    process.env.OPENSCOUT_SUPPORT_DIRECTORY = join(fixtureRoot, "support");
    const background = join(fixtureRoot, "support", "runtime", "codex-background-home", "sessions");
    mkdirSync(background, { recursive: true });
    expect(codexSessionRoots()).toContain(background);
  });
});

describe("mergeSessionHistory", () => {
  const event = (id: string, ts: number, summary: string): TailEvent => ({
    id, ts, source: "codex", sessionId: "thread", pid: 0, parentPid: null, project: "p", cwd: "/p",
    harness: "scout-managed", kind: "assistant", summary, raw: null,
  });

  test("keeps the opening a watcher attached mid-run never saw, without doubling the overlap", () => {
    // The watcher attached at line 3; the replay numbers the same lines 0..3.
    const buffered = [event("codex:thread:live-0", 3, "third"), event("codex:thread:live-1", 4, "fourth")];
    const replayed = [
      event("codex:thread:0", 1, "first"),
      event("codex:thread:1", 2, "second"),
      event("codex:thread:2", 3, "third"),
    ];
    expect(mergeSessionHistory(replayed, buffered, 10).map((entry) => entry.id)).toEqual([
      "codex:thread:0", "codex:thread:1", "codex:thread:live-0", "codex:thread:live-1",
    ]);
    expect(mergeSessionHistory(replayed, buffered, 2).map((entry) => entry.summary)).toEqual(["third", "fourth"]);
  });

  test("a line repeated in the file survives as often as it appears", () => {
    const buffered = [event("live-0", 5, "retry")];
    const replayed = [event("r-0", 5, "retry"), event("r-1", 5, "retry")];
    expect(mergeSessionHistory(replayed, buffered, 10)).toHaveLength(2);
  });
});

describe("Codex source isolation and replay contract", () => {
  test("CODEX_HOME is a discoverable store and duplicate default roots are removed", () => {
    delete process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT;
    const codexHome = join(fixtureRoot, "codex-home");
    const sessions = join(codexHome, "sessions");
    mkdirSync(sessions, { recursive: true });
    process.env.CODEX_HOME = codexHome;
    expect(codexSessionRoots()).toContain(sessions);
    const thread = uuidV7At(Date.UTC(2026, 9, 11), "c0def00d111111111111");
    const path = writeCodexRollout(sessions, thread, ["from CODEX_HOME"]);
    expect(CodexSource.discoverTranscripts([], "deep").some(t => t.transcriptPath === path)).toBe(false); // Old rollouts remain outside bounded discovery.
    expect(findCodexTranscript(thread)?.transcriptPath).toBe(path);
    utimesSync(path, new Date(), new Date());
    expect(CodexSource.discoverTranscripts([], "deep").some(t => t.transcriptPath === path)).toBe(true);
    process.env.CODEX_HOME = join(fixtureRoot, ".codex");
    mkdirSync(join(fixtureRoot, ".codex", "sessions"), { recursive: true });
    expect(codexSessionRoots().filter(root => root === join(fixtureRoot, ".codex", "sessions"))).toHaveLength(1);
  });

  test("an explicit Tail root stays exclusive even when another Codex store exists", () => {
    const explicit = process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT!;
    process.env.CODEX_HOME = join(fixtureRoot, "other-codex");
    mkdirSync(join(process.env.CODEX_HOME, "sessions"), { recursive: true });
    expect(codexSessionRoots()).toEqual([explicit]);
    expect(findCodexTranscript("../escape")).toBeNull();
    expect(findCodexTranscript("/absolute")).toBeNull();
  });

  test("the Scout background root follows public instance selection, never a fixed production path", () => {
    delete process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT;
    delete process.env.OPENSCOUT_SUPPORT_DIRECTORY;
    process.env.OPENSCOUT_INSTANCE = "dev";
    process.env.OPENSCOUT_INSTANCE_ROOT = join(fixtureRoot, "selected-instance");
    process.env.OPENSCOUT_INSTANCE_PORT_BASE = "44500";
    const selected = join(resolveOpenScoutSupportPaths().runtimeDirectory, "codex-background-home", "sessions");
    mkdirSync(selected, { recursive: true });
    expect(selected.startsWith(join(fixtureRoot, "selected-instance"))).toBe(true);
    const thread = uuidV7At(Date.UTC(2026, 9, 11), "bac6a0d0122222222222");
    const path = writeCodexRollout(selected, thread, ["selected instance"]);
    expect(codexSessionRoots()).toContain(selected);
    expect(findCodexTranscript(thread)?.transcriptPath).toBe(path);
  });

  test("an exact read merges the transcript opening with a watcher suffix and keeps classified buffered copies", async () => {
    const thread = uuidV7At(Date.UTC(2026, 9, 11), "aabbccdd333333333333");
    writeCodexRollout(process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT!, thread, ["first", "second", "third"]);
    const replay = await readTailEventsForSession(thread, { discovery: emptyDiscovery(), includeAllSources: true, limit: 10 });
    const assistants = replay!.events.filter(event => event.kind === "assistant");
    expect(assistants).toHaveLength(3);
    const buffered = assistants.slice(1).map((event, i) => ({ ...event, id: `watcher:${i}` }));
    __testing.setSessionBuffer(thread, buffered);
    const merged = await readTailEventsForSession(thread, { discovery: emptyDiscovery(), includeAllSources: true, limit: 10 });
    const mergedAssistants = merged!.events.filter(event => event.kind === "assistant");
    expect(mergedAssistants.map(event => event.summary)).toEqual(["first", "second", "third"]);
    expect(mergedAssistants.slice(1)).toEqual(buffered);
  });

  test("the buffered classified prompt wins a replay overlap with another event id", () => {
    const common: TailEvent = { id: "replay", ts: 1, source: "codex", sessionId: "thread", pid: 0, parentPid: null, project: "p", cwd: "/p", harness: "unattributed", kind: "user", summary: "same raw summary" };
    const buffered: TailEvent = { ...common, id: "watcher", prompt: { parts: [{ kind: "words", text: "Operator words" }], words: "Operator words", harnessOnly: false } };
    expect(mergeSessionHistory([common], [buffered], 10)).toEqual([buffered]);
  });
});

test("Codex filename lookup accepts complete UUIDs beyond the old 019 prefix", () => {
  const thread = "aabbccdd-1234-4567-89ab-123456789abc";
  const root = process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT!;
  mkdirSync(root, { recursive: true });
  const path = join(root, `rollout-2026-10-11T21-16-16-${thread}.jsonl`);
  writeFileSync(path, JSON.stringify({ timestamp: "2026-10-11T21:16:20.000Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "reply without session_meta" }] } }) + "\n");
  expect(findCodexTranscript(thread)).toMatchObject({ sessionId: thread, transcriptPath: path });
});
