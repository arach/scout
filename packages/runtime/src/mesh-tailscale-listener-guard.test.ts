import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createTailscaleListenerGuard, matchTailscaleRuntimeTargets, type TailscaleStatusRead } from "./mesh-tailscale-listener-guard.js";
const own = { port: 43110, socketPath: "/fixture/runtime.sock" };
const canonicalize = (p: string) => p === "/fixture/alias.sock" ? own.socketPath : p.startsWith("/fixture/") ? p : undefined;
const parse = (text: string) => matchTailscaleRuntimeTargets(text, own, canonicalize);
for (const [name, matches] of [
  ["http-runtime", ["tcp"]], ["tcp-runtime", ["tcp"]], ["funnel-runtime", ["tcp"]],
  ["web-only", []], ["empty", []], ["unix-runtime", ["unix"]], ["foreground-runtime", ["tcp"]],
] as const) test(`source-shaped ${name} status matches only its own listener`, () => {
  const text = readFileSync(new URL(`./test-helpers/fixtures/tailscale-status/${name}.json`, import.meta.url), "utf8");
  expect(parse(text)).toEqual({ outcome: "ok", matches: [...matches] });
});
for (const host of ["localhost", "localhost.", "127.0.0.1", "127.0.0.2", "[::1]", "[::ffff:127.0.0.1]"]) {
  test(`loopback alias ${host} is parsed as an endpoint, not text`, () => {
    expect(parse(JSON.stringify({ TCP: { "443": { TCPForward: `${host}:43110` } } })).matches).toEqual(["tcp"]);
  });
}
test("socket canonicalization, Proxy port shorthand and service nesting", () => {
  expect(parse('{"Web":{"fixture:443":{"Handlers":{"/":{"Proxy":"unix:/fixture/alias.sock"}}}}}').matches).toEqual(["unix"]);
  expect(parse('{"Web":{"fixture:443":{"Handlers":{"/":{"Proxy":"43110"}}}}}').matches).toEqual(["tcp"]);
  expect(parse('{"Services":{"svc:fixture":{"TCP":{"443":{"TCPForward":"127.0.0.1:43110"}}}}}').matches).toEqual(["tcp"]);
});
test("empty null, no substring matching, remote targets, other sockets and unknown schemas", () => {
  expect(parse("null")).toEqual({ outcome: "ok", matches: [] });
  for (const target of ["100.64.0.1:43110", "localhost:431100", "remote.example.invalid:43110", "unix:/fixture/other.sock", "unix:relative.sock", "http://localhost:43110@remote.example.invalid/", "http://remote.example.invalid/43110"]) {
    expect(parse(JSON.stringify({ Web: { "fixture:443": { Handlers: { "/": { Proxy: target } } } } })).matches).toEqual([]);
  }
  for (const text of ['{"TCP":[]}', '{"Web":{"x":{"Handlers":{"/":{"Proxy":123}}}}}', '{"TCP":{"443":{"TCPForward":"127.0.0.1:43110"}},"Unknown":true}', '[]']) {
    expect(parse(text)).toEqual({ outcome: "unknown", matches: [] });
  }
  expect(parse("bad JSON")).toEqual({ outcome: "unparseable", matches: [] });
  expect(parse('{"AllowFunnel":{"localhost:43110":true}}').matches).toEqual([]);
});
test("freshness, failures, empty config, single flight and stop cannot create sticky enforcement", async () => {
  let now = 0, read: TailscaleStatusRead = { ok: true, stdout: '{"TCP":{"443":{"TCPForward":"127.0.0.1:43110"}}}', source: "cli" }, calls = 0;
  const guard = createTailscaleListenerGuard(own, { now: () => now, wallNow: () => 1000 + now, canonicalize, read: async () => { calls++; return read; } });
  expect(guard.isGuarded("tcp")).toBe(false);
  await Promise.all([guard.refresh(), guard.refresh()]); expect(calls).toBe(1);
  expect(guard.isGuarded("tcp")).toBe(true); expect(guard.isGuarded("unix")).toBe(false);
  now = 10_000; expect(guard.report().outcome).toBe("stale"); expect(guard.isGuarded("tcp")).toBe(false);
  await guard.refresh(); expect(guard.isGuarded("tcp")).toBe(true);
  read = { ...read, ok: false }; await guard.refresh(); expect(guard.report().outcome).toBe("failed"); expect(guard.isGuarded("tcp")).toBe(false);
  for (const stdout of ["bad JSON", '{"unknown":true}', "{}", "null"]) {
    read = { ...read, ok: true, stdout }; await guard.refresh(); expect(guard.isGuarded("tcp")).toBe(false);
  }
  guard.stop(); await guard.refresh(); expect(guard.isGuarded("tcp")).toBe(false);
  expect(JSON.stringify(guard.report())).not.toContain(own.socketPath);
});
test("a slow or stopped probe cannot refresh old evidence", async () => {
  let now = 0; let finish!: (value: TailscaleStatusRead) => void;
  const guard = createTailscaleListenerGuard(own, { now: () => now, read: () => new Promise((resolve) => { finish = resolve; }) });
  const pending = guard.refresh(); now = 11_000;
  finish({ ok: true, stdout: '{"TCP":{"443":{"TCPForward":"127.0.0.1:43110"}}}', source: "cli" });
  await pending; expect(guard.report().outcome).toBe("stale"); expect(guard.isGuarded("tcp")).toBe(false);
  const next = guard.refresh(); guard.stop(); finish({ ok: true, stdout: "{}", source: "cli" }); await next;
  expect(guard.report().outcome).toBe("not-read");
});

test("socket LocalAPI uses one bounded processless ServeConfig read", async () => {
  const { createServer } = await import("node:http");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { readTailscaleServeConfigFromSocket } = await import("./mesh-tailscale-listener-guard.js");
  const dir = mkdtempSync(join(tmpdir(), "ts-guard-api-")), socketPath = join(dir, "api.sock");
  let mode: "ok" | "oversize" | "error" = "ok", requests = 0;
  const server = createServer((req, res) => {
    requests++; expect(req.url).toBe("/localapi/v0/serve-config"); expect(req.headers.host).toBe("local-tailscaled.sock");
    if (mode === "oversize") res.end(" ".repeat(2 * 1024 * 1024 + 1));
    else if (mode === "error") res.writeHead(403).end("not allowed");
    else res.end('{"AllowFunnel":{"fixture:443":true}}');
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  try {
    expect(await readTailscaleServeConfigFromSocket(socketPath)).toEqual({ ok: true, stdout: '{"AllowFunnel":{"fixture:443":true}}', source: "localapi" });
    mode = "oversize"; expect((await readTailscaleServeConfigFromSocket(socketPath)).ok).toBe(false);
    mode = "error"; expect((await readTailscaleServeConfigFromSocket(socketPath)).ok).toBe(false);
    expect(requests).toBe(3);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); rmSync(dir, { recursive: true, force: true }); }
});
