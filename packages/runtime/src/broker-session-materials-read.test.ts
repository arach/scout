import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { createSessionMaterialsRead, SESSION_MATERIAL_MAX_BYTES, SESSION_MATERIAL_MAX_LINES } from "./broker-session-materials-read.js";
import { createBrokerHttpRouter, type BrokerHttpRouterDeps } from "./broker-http-router.js";
import type { DiscoverySnapshot } from "./tail/types.js";
import { meshRouteTierFor } from "./mesh-route-matrix.js";
const root = realpathSync(mkdtempSync(join(tmpdir(), "scout-materials-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let serial = 0;
function fixture(records: unknown[], harness = "claude", id = "native-1") {
  const path = join(root, `${serial++}.jsonl`); writeFileSync(path, records.map(record => typeof record === "string" ? record : JSON.stringify(record)).join("\n"));
  const cached: DiscoverySnapshot = { generatedAt: 100, processes: [], transcripts: [{ source: harness, sessionId: id, transcriptPath: path, cwd: root, project: "test", harness: "unattributed", size: 0, mtimeMs: 0 }],
    totals: { total: 0, transcripts: 1, scoutManaged: 0, hudsonManaged: 0, unattributed: 0 }, readStatus: { initialized: true, scope: "shallow", sources: [{ harness, availability: "available", processes: "available" }] } };
  const deps = { nodeId: "node-1", readCache: () => cached, readEndpoints: () => ({}) };
  const url = new URL(`http://local/v1/observed-sessions/materials?nodeId=node-1&harness=${harness}&nativeSessionId=${id}`);
  return { path, cached, deps, url, read: createSessionMaterialsRead(deps) };
}
const init = (id = "native-1") => ({ type: "system", subtype: "init", session_id: id, cwd: root, timestamp: "2026-04-22T12:00:00Z" });
const user = { type: "user", timestamp: "2026-04-22T12:00:01Z", message: { role: "user", content: "work" } };
const tool = (name: string, path: string, id: string) => [
  { type: "tool_use", tool_name: name, tool_use_id: id, input: { file_path: path }, timestamp: "2026-04-22T12:00:02Z" },
  { type: "tool_result", tool_use_id: id, content: "ok", timestamp: "2026-04-22T12:00:03Z" },
];
const end = { type: "result", subtype: "success", is_error: false, timestamp: "2026-04-22T12:00:04Z" };

test("public Claude parser yields bounded relative file facts and read/changed counts, not trace content", async () => {
  const f = fixture([init(), user, ...tool("Read", join(root, "a.ts"), "r"), ...tool("Edit", "a.ts", "e"), ...tool("Read", "b.ts", "b"), ...tool("Write", "c.ts", "w"), ...tool("Read", "../outside", "o"), end]);
  const result = await f.read(f.url);
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ schema: "scout.session-materials/v1", identity: { nodeId: "node-1", harness: "claude", nativeSessionId: "native-1" }, counts: { files: 3, changedFiles: 2, readFiles: 1 }, coverage: { excludedOutsideWorktree: 1, pendingActions: 0 } });
  expect((result.body as any).files.map((file: any) => [file.path, file.state, file.touches])).toEqual([["a.ts", "modified", 2], ["b.ts", "read", 1], ["c.ts", "modified", 1]]);
  expect(JSON.stringify(result.body)).not.toContain(f.path);
  expect(result.body).not.toHaveProperty("events");
});

test("verified empty is available; absent, invalid and mismatched history are not empty", async () => {
  const empty = fixture([init()]); expect(await empty.read(empty.url)).toMatchObject({ status: 200, body: { files: [], counts: { files: 0 } } });
  const missing = fixture([init()]); rmSync(missing.path); expect((await missing.read(missing.url)).status).toBe(503);
  const invalid = fixture(["{broken"]); expect((await invalid.read(invalid.url)).status).toBe(503);
  const wrong = fixture([init("other-session")]); expect(await wrong.read(wrong.url)).toMatchObject({ status: 409, body: { error: "session_materials_identity_mismatch" } });
  const unknown = fixture([user]); expect(await unknown.read(unknown.url)).toMatchObject({ status: 503, body: { error: "session_materials_identity_unverified" } });
});

test("existing public Codex and Pi parser envelopes preserve exact native identity", async () => {
  const codex = fixture([{ type: "session_meta", payload: { id: "native-1", cwd: root }, timestamp: "2026-04-22T12:00:00Z" }], "codex");
  expect(await codex.read(codex.url)).toMatchObject({ status: 200, body: { identity: { harness: "codex", nativeSessionId: "native-1" }, files: [] } });
  const pi = fixture([{ type: "session", id: "native-1", cwd: root, timestamp: "2026-04-22T12:00:00Z" }], "pi");
  expect(await pi.read(pi.url)).toMatchObject({ status: 200, body: { identity: { harness: "pi", nativeSessionId: "native-1" }, files: [] } });
});

test("byte/line/file budgets and symlinks refuse rather than truncate into an empty result", async () => {
  const bytes = fixture([init()]); writeFileSync(bytes.path, " ".repeat(SESSION_MATERIAL_MAX_BYTES + 1));
  expect(await bytes.read(bytes.url)).toMatchObject({ status: 413, body: { error: "session_materials_byte_budget" } });
  const lines = fixture([init(), ...Array.from({ length: SESSION_MATERIAL_MAX_LINES }, () => ({ type: "progress" }))]);
  expect(await lines.read(lines.url)).toMatchObject({ status: 413, body: { error: "session_materials_line_budget" } });
  const files = fixture([init(), user, ...Array.from({ length: 501 }, (_, i) => tool("Read", `file-${i}`, String(i))).flat(), end]);
  expect(await files.read(files.url)).toMatchObject({ status: 413, body: { error: "session_materials_file_budget" } });
  const target = fixture([init()]), link = fixture([init()]); rmSync(link.path); symlinkSync(target.path, link.path);
  expect((await link.read(link.url)).status).toBe(503);
});

test("strict selectors, failed source and unsupported harness never trigger a filesystem fallback", async () => {
  const f = fixture([init()]);
  for (const query of ["?path=/etc/passwd", "?harness=claude", f.url.search + "&path=/tmp", f.url.search + "&nodeId=other"]) expect((await f.read(new URL("http://local/" + query))).status).toBe(400);
  f.cached.readStatus!.sources[0].availability = "unavailable"; expect((await f.read(f.url)).status).toBe(503);
  const unsupported = fixture([], "kimi"); expect(await unsupported.read(unsupported.url)).toMatchObject({ status: 501, body: { error: "session_materials_unsupported_harness" } });
});

test("only one parse runs at once and rejection does not leak the slot", async () => {
  const f = fixture([init()]); const first = f.read(f.url);
  expect(await f.read(f.url)).toMatchObject({ status: 503, body: { error: "session_materials_busy" } });
  expect((await first).status).toBe(200); expect((await f.read(f.url)).status).toBe(200);
});
class Response extends EventEmitter { status = 0; body = ""; writableEnded = false; writeHead(status: number) { this.status = status; } end(body = "") { this.body += body; this.writableEnded = true; } }
test("HTTP materials route uses the same local/scoped/guest policy with no web/full snapshot", async () => {
  const f = fixture([init()]);
  const route = createBrokerHttpRouter({ brokerService: {} as never, nodeId: "node-1", host: "local", port: 1, readObservedSessionCache: () => f.cached,
    runtime: { peek: () => ({ endpoints: {} }), snapshot() { throw new Error("no full snapshot"); } }, webControl: new Proxy({}, { get() { throw new Error("no web"); } }),
  } as unknown as BrokerHttpRouterDeps);
  for (const transportContext of [undefined, { transport: "remote" }, { transport: "local", guest: {} }, { transport: "local", scoped: {} }]) {
    const response = new Response(); await route({ method: "GET", url: f.url.pathname + f.url.search, headers: {}, transportContext } as any, response as any);
    expect(response.status).toBe(transportContext ? 403 : 200);
  }
  expect(meshRouteTierFor("GET", f.url.pathname)).toBe("local");
});


test("changed worktree scope is refused and incomplete actions do not masquerade as complete empty", async () => {
  const changed = fixture([init(), { type: "system", subtype: "init", session_id: "native-1", cwd: "/different" }]);
  expect(await changed.read(changed.url)).toMatchObject({ status: 503, body: { error: "session_materials_multiple_worktrees" } });
  const pending = fixture([init(), user, tool("Read", "waiting", "p")[0]]);
  expect(await pending.read(pending.url)).toMatchObject({ status: 200, body: { files: [], coverage: { complete: false, pendingActions: 1 } } });
});
