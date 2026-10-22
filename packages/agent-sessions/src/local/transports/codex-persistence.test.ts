import { expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexAppServerTransport } from "./codex-app-server.ts";
import { spawnCodexAppServerStdioConnection } from "./codex-app-server-connection.ts";
import { CodexWireLog, CODEX_WIRE_LOG_GAP_PREFIX } from "./codex-wire-log.ts";
import { writeCodexMetadata } from "./codex-metadata-file.ts";
const enospc = () => Object.assign(new Error("disk full"), { code: "ENOSPC" });
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3000; while (!predicate() && Date.now() < deadline) await Bun.sleep(5);
  expect(predicate()).toBe(true);
}
function transport(dir: string) {
  return new CodexAppServerTransport({ agentName: "disk-test", sessionId: "disk-test", cwd: dir, systemPrompt: "test", runtimeDirectory: dir, logsDirectory: dir });
}

test("ENOSPC while a real app server keeps sending cannot hide turn completion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scout-codex-disk-"));
  const owner = transport(dir), seam = owner as any;
  let full = true, completed = false; const writes: string[] = [], pauses: boolean[] = [];
  const log = new CodexWireLog({ retryMs: 10, highWaterBytes: 8, lowWaterBytes: 0,
    append: async (_path, text) => { if (full) throw enospc(); writes.push(text); }, onError: () => {},
    setPaused: paused => { pauses.push(paused); connection?.setReadingPaused(paused); } });
  seam.wireLog = log; seam.threadId = seam.durableThreadId = "thread";
  owner.onNotification(message => { if (message.method === "turn/completed") completed = true; });
  let connection: ReturnType<typeof spawnCodexAppServerStdioConnection> | undefined;
  try {
    const script = `for(let n=0;n<20;n++){console.log(JSON.stringify({method:n===19?'turn/completed':'item/agentMessage/delta',params:{threadId:'thread',turn:{id:'turn',status:'completed'},delta:'data'}}));await Bun.sleep(5)}setInterval(()=>{},1000);`;
    connection = spawnCodexAppServerStdioConnection({ executable: process.execPath, args: ["-e", script], cwd: dir, env: {}, handlers: seam.connectionHandlers(() => connection) });
    seam.connection = connection;
    await until(() => completed);
    expect(connection.isOpen()).toBe(true); expect(log.droppedEntries).toBe(20); expect(log.isPaused).toBe(false);
    expect(pauses).toContain(true); expect(pauses).toContain(false);
    full = false; await until(() => writes.some(text => text.includes(CODEX_WIRE_LOG_GAP_PREFIX))); await log.flush();
    const gaps = writes.filter(text => text.includes(CODEX_WIRE_LOG_GAP_PREFIX)).map(text => JSON.parse(text.trim().slice(CODEX_WIRE_LOG_GAP_PREFIX.length)));
    expect(gaps.reduce((sum, gap) => sum + gap.entries, 0)).toBe(20);
    seam.handleMessageText(JSON.stringify({ method: "after/recovery", params: {} })); await log.flush();
    expect(writes.at(-1)).toContain('"method":"after/recovery"');
  } finally {
    log.setActive(false); seam.setPersistenceActive(false); connection?.detach(); await connection?.close();
    if (connection?.pid) await until(() => { try { process.kill(connection!.pid!, 0); return false; } catch { return true; } });
    await rm(dir, { recursive: true, force: true });
  }
}, 10_000);

test("partial metadata publication preserves the previous thread ID and valid state JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scout-codex-atomic-"));
  try {
    for (const [name, old, next] of [["codex-thread-id.txt", "old-thread\n", "new-thread\n"], ["state.json", '{"old":true}\n', '{"new":true}\n']]) {
      const path = join(dir, name!); await writeFile(path, old!);
      await expect(writeCodexMetadata(path, next!, async (stage, text) => { await writeFile(stage, text.slice(0, 3)); throw enospc(); })).rejects.toMatchObject({ code: "ENOSPC" });
      expect(await readFile(path, "utf8")).toBe(old!); expect((await readdir(dir)).some(name => name.endsWith(".tmp"))).toBe(false);
      await writeCodexMetadata(path, next!); expect(await readFile(path, "utf8")).toBe(next!);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("thread/state/prompt persistence failures stay nonfatal and retry confirmed identity after space returns", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scout-codex-metadata-"));
  const owner = transport(dir), seam = owner as any; let full = true, completed = false;
  seam.metadataRetryMs = 10; seam.durableThreadId = "previous-thread"; seam.threadId = "confirmed-thread"; seam.promptDirty = true;
  seam.writeMetadata = async (path: string, text: string) => { if (full) throw enospc(); await writeCodexMetadata(path, text); };
  seam.wireLog = new CodexWireLog({ setPaused: () => {}, onError: () => {}, append: async () => {} });
  owner.onNotification(message => { if (message.method === "turn/completed") completed = true; });
  try {
    await seam.persistThreadId({ confirmed: true }); await seam.persistState(); await seam.persistPrompt();
    expect(owner.currentThreadId).toBe("confirmed-thread"); expect(owner.currentDurableThreadId).toBeNull();
    seam.handleMessageText(JSON.stringify({ method: "turn/completed", params: { threadId: "confirmed-thread", turn: { id: "turn" } } }));
    expect(completed).toBe(true);
    full = false; await until(() => owner.currentDurableThreadId === "confirmed-thread" && seam.catalogedThreadId === "confirmed-thread");
    await seam.threadPersistence;
    expect(await readFile(join(dir, "codex-thread-id.txt"), "utf8")).toBe("confirmed-thread\n");
    expect(JSON.parse(await readFile(join(dir, "state.json"), "utf8")).threadId).toBe("confirmed-thread");
    expect(await readFile(join(dir, "prompt.txt"), "utf8")).toBe("test");
  } finally { seam.setPersistenceActive(false); await seam.threadPersistence; await rm(dir, { recursive: true, force: true }); }
});

test("failed catalog adoption is retried even when the thread ID already became durable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scout-codex-catalog-")); const owner = transport(dir), seam = owner as any;
  let calls = 0; const record = seam.recordCatalog; seam.metadataRetryMs = 10; seam.threadId = "thread";
  seam.recordCatalog = async (...args: unknown[]) => { calls++; if (calls === 1) throw enospc(); return record(...args); };
  try {
    await seam.persistThreadId({ confirmed: true }); expect(owner.currentDurableThreadId).toBe("thread"); expect(seam.catalogedThreadId).toBeNull();
    await until(() => seam.catalogedThreadId === "thread"); expect(calls).toBe(2);
  } finally { seam.setPersistenceActive(false); await seam.threadPersistence; await rm(dir, { recursive: true, force: true }); }
});

test("notification persistence coalesces to one active write and one dirty snapshot", async () => {
  const owner = transport("/not-created"), seam = owner as any; let release!: () => void, calls = 0;
  const gate = new Promise<void>(done => { release = done; });
  seam.persistThreadIdNow = async () => { calls++; if (calls === 1) await gate; };
  const first = seam.persistThreadId();
  for (let n = 0; n < 500; n++) expect(seam.persistThreadId()).toBe(first);
  expect(calls).toBe(1); release(); await first; expect(calls).toBe(2); seam.setPersistenceActive(false);
});

test("a persistence retry cannot promote an unconfirmed thread to durable identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scout-codex-unconfirmed-")); const owner = transport(dir), seam = owner as any;
  let full = true; seam.metadataRetryMs = 10; seam.threadId = "unconfirmed";
  seam.writeMetadata = async (path: string, text: string) => { if (full) throw enospc(); return writeCodexMetadata(path, text); };
  try {
    await seam.persistThreadId(); full = false;
    await until(() => seam.metadataRetry === null); await seam.threadPersistence;
    expect(owner.currentDurableThreadId).toBeNull();
    await expect(readFile(join(dir, "codex-thread-id.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(join(dir, "state.json"), "utf8")).threadId).toBeNull();
  } finally { seam.setPersistenceActive(false); await seam.threadPersistence; await rm(dir, { recursive: true, force: true }); }
});

test("metadata diagnostics cannot reject notification persistence when their own sink fails", async () => {
  const owner = transport("/not-created"), seam = owner as any; const warn = console.warn;
  seam.writeMetadata = async () => { throw enospc(); }; seam.threadId = "thread";
  try {
    console.warn = () => { throw enospc(); };
    await seam.persistThreadId({ confirmed: true }); await seam.persistState();
    expect(owner.currentDurableThreadId).toBeNull(); expect(seam.metadataRetry).not.toBeNull();
  } finally { console.warn = warn; seam.setPersistenceActive(false); await seam.threadPersistence; }
});

test("failed startup disables retries rather than retaining an idle transport", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scout-codex-start-failure-"));
  const owner = new CodexAppServerTransport({ agentName: "disk-test", sessionId: "disk-test", cwd: join(dir, "missing"), systemPrompt: "test", runtimeDirectory: dir, logsDirectory: dir });
  const seam = owner as any; seam.writeMetadata = async () => { throw enospc(); };
  seam.wireLog = new CodexWireLog({ setPaused: () => {}, onError: () => {}, append: async () => {} });
  try {
    await expect(seam.ensureStarted()).rejects.toThrow();
    expect(seam.metadataRetry).toBeNull(); expect(seam.metadataRetriesEnabled).toBe(false);
  } finally { seam.setPersistenceActive(false); await rm(dir, { recursive: true, force: true }); }
});

test("a slow old identity write cannot publish stale durable state for a newer thread", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scout-codex-identity-race-")); const owner = transport(dir), seam = owner as any;
  let release!: () => void; const gate = new Promise<void>(done => { release = done; }); const states: Array<string | null> = [];
  seam.writeMetadata = async (path: string, text: string) => {
    if (path.endsWith("codex-thread-id.txt") && text === "old\n") await gate;
    if (path.endsWith("state.json")) states.push(JSON.parse(text).threadId);
    await writeCodexMetadata(path, text);
  };
  try {
    seam.threadId = "old"; const first = seam.persistThreadId({ confirmed: true });
    seam.threadId = "new"; const second = seam.persistThreadId({ confirmed: true });
    release(); await first; await second;
    expect(owner.currentDurableThreadId).toBe("new"); expect(states).not.toContain("old");
    expect(await readFile(join(dir, "codex-thread-id.txt"), "utf8")).toBe("new\n");
  } finally { release(); seam.setPersistenceActive(false); await seam.threadPersistence; await rm(dir, { recursive: true, force: true }); }
});
