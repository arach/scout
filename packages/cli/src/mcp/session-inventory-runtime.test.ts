import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ObservedSessionInventory } from "@openscout/protocol";
import { readObservedSessions } from "../../../runtime/src/broker-observed-sessions-read.ts";
import type { DiscoverySnapshot } from "../../../runtime/src/tail/types.ts";
import { readRuntimeSessionInventory } from "./session-inventory-runtime.ts";

export function runtimeInventory(overrides: Partial<ObservedSessionInventory> = {}): ObservedSessionInventory {
  return { schema: "scout.observed-sessions/v1", nodeId: "node-one", scannedAt: 123, availability: "available",
    sources: [{ harness: "codex", availability: "available", processes: "unknown" }],
    sessions: [{ identity: { nodeId: "node-one", harness: "codex", nativeSessionId: "native-1" }, links: [{ kind: "agent", id: "agent-one" }], cwd: "/work", title: "Runtime title", observedAt: 123, availability: "available", identityConflict: false }],
    coverage: { kind: "cached_window", scope: "recent", truncated: false, links: { agents: "available", conversations: "unsupported", terminals: "unsupported" } }, ...overrides };
}
function fetcher(fn: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>): typeof fetch { return Object.assign(fn, { preconnect: () => undefined }); }
const read = (response: Response) => readRuntimeSessionInventory({ env: { OPENSCOUT_BROKER_URL: "http://localhost:1" }, fetchImpl: fetcher(async () => response) });

test("observed inventory uses one passive local broker GET, not web auth or resolver/materials", async () => {
  let calls = 0;
  const value = await readRuntimeSessionInventory({ env: { OPENSCOUT_BROKER_URL: "http://localhost:43121", OPENSCOUT_WEB_URL: "https://must-not-use.invalid", OPENSCOUT_WEB_AUTH_TOKEN: "must-not-send" }, fetchImpl: fetcher(async (input, init) => {
    calls++;
    expect(String(input)).toBe("http://localhost:43121/v1/observed-sessions?limit=200");
    expect(init).toMatchObject({ method: "GET", redirect: "error", credentials: "omit" });
    expect(new Headers(init?.headers).get("cookie")).toBeNull();
    expect(new Headers(init?.headers).get("authorization")).toBeNull();
    return Response.json(runtimeInventory());
  }) });
  expect(value).toEqual(runtimeInventory()); expect(calls).toBe(1);
});
test("real runtime read projection fits the consumer without identity rewriting", async () => {
  const snapshot = { generatedAt: 123, transcripts: [{ source: "codex", sessionId: "opaque:Native/1", transcriptPath: "/fixture/only", cwd: "/work", title: "Title" }], issues: [], readStatus: { initialized: true, scope: "recent", sources: [{ harness: "codex", availability: "available", processes: "unknown" }] } } as unknown as DiscoverySnapshot;
  const projection = readObservedSessions({ nodeId: "node-one", readCache: () => snapshot }, new URL("http://localhost/v1/observed-sessions?limit=200"), false);
  expect(projection.status).toBe(200);
  expect(await read(Response.json(projection.body))).toMatchObject({ sessions: [{ identity: { nodeId: "node-one", harness: "codex", nativeSessionId: "opaque:Native/1" } }], coverage: { links: { terminals: "unsupported" } } });
});
test.each([401, 403, 404, 409, 503])("runtime HTTP %i preserves safe code with details and performs no retry/bootstrap", async status => {
  let calls = 0;
  await expect(readRuntimeSessionInventory({ env: { OPENSCOUT_BROKER_URL: "http://localhost:1" }, fetchImpl: fetcher(async () => { calls++; return Response.json({ error: "session_inventory_unavailable", detail: "never reflect this" }, { status }); }) })).rejects.toMatchObject({ status, code: "session_inventory_unavailable" });
  expect(calls).toBe(1);
});
test("non-JSON denial preserves status but not body text", async () => {
  await expect(read(new Response("secret upstream body", { status: 403 }))).rejects.toMatchObject({ status: 403, code: "session_inventory_unavailable" });
});
test("not-scanned, unavailable, partial and truncated are values, not available-empty replacements", async () => {
  for (const availability of ["not_scanned", "unavailable", "partial", "unknown"] as const) {
    const value = runtimeInventory({ availability, scannedAt: availability === "not_scanned" ? null : 123, sessions: [], coverage: { ...runtimeInventory().coverage, truncated: true } });
    expect(await read(Response.json(value))).toEqual(value);
  }
});
test("malformed shape, foreign-node rows, repeated tuple and extra fields refuse", async () => {
  const v = runtimeInventory();
  for (const value of [{}, { ...v, schema: "other" }, { ...v, sessions: [{ ...v.sessions[0], identity: { ...v.sessions[0]!.identity, nodeId: "elsewhere" } }] }, { ...v, sessions: [v.sessions[0], v.sessions[0]] }, { ...v, url: "https://must-not-fetch.invalid" }, { ...v, coverage: { ...v.coverage, links: { agents: "available", terminals: "available", conversations: "unsupported" } } }, { ...v, sessions: Array(201).fill(v.sessions[0]) }]) {
    await expect(read(Response.json(value))).rejects.toMatchObject({ code: "invalid_session_inventory_response" });
  }
});
test("bounded JSON refuses declared/streamed oversize, invalid UTF8 and redirects", async () => {
  for (const response of [new Response("small", { headers: { "content-length": "8388609" } }), new Response("x".repeat(8388609)), new Response(new Uint8Array([0xff])), new Response(null, { status: 302, headers: { location: "https://must-not-fetch.invalid" } })]) {
    await expect(read(response)).rejects.toMatchObject({ code: "invalid_session_inventory_response" });
  }
});
test("local broker and explicit socket-only configuration are required", async () => {
  for (const url of ["https://remote.invalid", "http://user:password@localhost", "file:///tmp/no"]) await expect(readRuntimeSessionInventory({ env: { OPENSCOUT_BROKER_URL: url } })).rejects.toMatchObject({ code: "local_broker_required" });
  await expect(readRuntimeSessionInventory({ env: { OPENSCOUT_BROKER_URL: "http://localhost:1", OPENSCOUT_BROKER_SOCKET_ONLY: "1" } })).rejects.toMatchObject({ code: "broker_socket_required" });
});
test("real Bun Unix socket works and an absent selected socket cannot use an HTTP fallback", async () => {
  const root = mkdtempSync(join(tmpdir(), "session_inventory_")); const socket = join(root, "broker.sock");
  let httpCalls = 0, socketCalls = 0;
  const trap = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { httpCalls++; return Response.json(runtimeInventory()); } });
  const server = Bun.serve({ unix: socket, fetch(request) { socketCalls++; expect(new URL(request.url).searchParams.get("limit")).toBe("200"); return Response.json(runtimeInventory()); } });
  try {
    expect(await readRuntimeSessionInventory({ env: { OPENSCOUT_BROKER_URL: trap.url.origin, OPENSCOUT_BROKER_SOCKET_PATH: socket } })).toEqual(runtimeInventory());
    await expect(readRuntimeSessionInventory({ env: { OPENSCOUT_BROKER_URL: trap.url.origin, OPENSCOUT_BROKER_SOCKET_PATH: join(root, "absent.sock") } })).rejects.toThrow();
    expect(httpCalls).toBe(0); expect(socketCalls).toBe(1);
  } finally { await server.stop(true); await trap.stop(true); rmSync(root, { recursive: true, force: true }); }
});
