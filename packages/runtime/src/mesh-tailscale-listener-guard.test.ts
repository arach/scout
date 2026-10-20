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
  expect(parse('{"Services":{"svc:fixture":{"Tun":true,"TCP":{"443":{"TCPForward":"127.0.0.1:43110"}}}}}').matches).toEqual([]);
});
test("one config can target both owned listeners independently", () => {
  expect(parse('{"TCP":{"443":{"TCPForward":"unix:/fixture/runtime.sock"}},"Web":{"fixture:8443":{"Handlers":{"/":{"Proxy":"http://localhost:43110"}}}}}').matches).toEqual(["tcp", "unix"]);
});

test("empty null, no substring matching, remote targets, other sockets and unknown schemas", () => {
  expect(parse("null")).toEqual({ outcome: "ok", matches: [] });
  for (const target of ["100.64.0.1:43110", "localhost:431100", "remote.example.invalid:43110", "unix:/fixture/other.sock", "unix:relative.sock", "http://localhost:43110@remote.example.invalid/", "http://remote.example.invalid/43110"]) {
    expect(parse(JSON.stringify({ Web: { "fixture:443": { Handlers: { "/": { Proxy: target } } } } })).matches).toEqual([]);
  }
  for (const text of ['{"TCP":[]}', '{"Web":{"x":{"Handlers":{"/":{"Proxy":123}}}}}', '[]']) {
    expect(parse(text)).toEqual({ outcome: "unknown", matches: [] });
  }
  expect(parse(readFileSync(new URL("./test-helpers/fixtures/tailscale-status/unparseable.txt", import.meta.url), "utf8"))).toEqual({ outcome: "unparseable", matches: [] });
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
  let mode: "ok" | "oversize" | "error" | "timeout" = "ok", requests = 0;
  const server = createServer((req, res) => {
    requests++; expect(req.url).toBe("/localapi/v0/serve-config"); expect(req.headers.host).toBe("local-tailscaled.sock");
    if (mode === "timeout") return;
    if (mode === "oversize") res.end(" ".repeat(2 * 1024 * 1024 + 1));
    else if (mode === "error") res.writeHead(403).end("not allowed");
    else res.end('{"AllowFunnel":{"fixture:443":true}}');
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  try {
    expect(await readTailscaleServeConfigFromSocket(socketPath)).toEqual({ ok: true, stdout: '{"AllowFunnel":{"fixture:443":true}}', source: "localapi" });
    mode = "oversize"; expect((await readTailscaleServeConfigFromSocket(socketPath)).ok).toBe(false);
    mode = "error"; expect((await readTailscaleServeConfigFromSocket(socketPath)).ok).toBe(false);
    mode = "timeout"; expect((await readTailscaleServeConfigFromSocket(socketPath)).ok).toBe(false);
    expect(requests).toBe(4);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); rmSync(dir, { recursive: true, force: true }); }
});

test("detection closes existing connections only on the matched listener", async () => {
  let config = "{}", tcpClosed = false, unixClosed = false;
  const guard = createTailscaleListenerGuard(own, { canonicalize, read: async () => ({ ok: true, stdout: config, source: "cli" }) });
  guard.trackConnection("tcp", { destroy() { tcpClosed = true; }, once() {} });
  guard.trackConnection("unix", { destroy() { unixClosed = true; }, once() {} });
  config = '{"TCP":{"443":{"TCPForward":"127.0.0.1:43110"}}}';
  await guard.refresh(); expect(tcpClosed).toBe(true); expect(unixClosed).toBe(false);
  guard.stop();
});

test("receiving TCP identity excludes peer TLS addresses and other ports", async () => {
  const { isRuntimeLoopbackTcpSocket } = await import("./mesh-tailscale-listener-guard.js");
  for (const localAddress of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) expect(isRuntimeLoopbackTcpSocket({ localAddress, localPort: 43110 }, 43110)).toBe(true);
  for (const socket of [{}, { localAddress: "100.64.0.1", localPort: 43110 }, { localAddress: "127.0.0.1", localPort: 43120 }]) expect(isRuntimeLoopbackTcpSocket(socket, 43110)).toBe(false);
});

test("a failed daemon is advisory; unrelated handler fields preserve evidence", async () => {
  const guard = createTailscaleListenerGuard(own, { read: async () => { throw new Error("fixture ENOENT"); } });
  await guard.refresh(); expect(guard.report().outcome).toBe("failed"); expect(guard.report().guardedListeners).toEqual([]);
  expect(JSON.stringify(guard.report())).not.toContain("ENOENT"); guard.stop();
  expect(parse('{"TCP":{"443":{"TCPForward":"localhost:43110","Unknown":true}}}')).toEqual({ outcome: "ok", matches: ["tcp"] });
});

for (const [name, extra] of [
  ["AcceptAppCaps", { "/caps": { Proxy: "http://localhost:43120", AcceptAppCaps: ["example.invalid/cap/fixture"] } }],
  ["Redirect", { "/redirect": { Redirect: "https://example.invalid/" } }],
  ["future field", { "/future": { FutureField: { "not-a-target": [true] } } }],
] as const) test(`${name} never discards a recognized runtime target`, async () => {
  const config = { Web: { "fixture.example.ts.net:443": {
    Handlers: { "/runtime": { Proxy: "http://localhost:43110" }, ...extra },
  } } };
  const guard = createTailscaleListenerGuard(own, { canonicalize, read: async () => ({ ok: true, source: "cli", stdout: JSON.stringify(config) }) });
  await guard.refresh(); expect(guard.isGuarded("tcp")).toBe(true); guard.stop();
});

test("wrong target types are skipped without erasing other recognized targets", () => {
  for (const bad of [null, 43110, ["http://localhost:43110"], { Proxy: "http://localhost:43110" }]) {
    expect(parse(JSON.stringify({ Web: { "fixture:443": { Handlers: { "/bad": { Proxy: bad } } } } })).matches).toEqual([]);
    expect(parse(JSON.stringify({ Web: { "fixture:443": { Handlers: { "/bad": { Proxy: bad }, "/good": { Proxy: "http://localhost:43110" } } } } })).matches).toEqual(["tcp"]);
    expect(parse(JSON.stringify({ TCP: { "443": { TCPForward: bad } } })).matches).toEqual([]);
  }
  expect(parse('{"Future":{"Proxy":"http://localhost:43110"}}').matches).toEqual([]);
  expect(parse('{"FutureRoot":{"fixture:443":true},"TCP":{"443":{"TCPForward":"localhost:43110","FutureTCP":[true]}}}').matches).toEqual(["tcp"]);
});

test("unavailable transports have their own advisory outcome", async () => {
  const guard = createTailscaleListenerGuard(own, { read: async () => ({ ok: false, stdout: "", source: "cli", unavailable: true }) });
  await guard.refresh(); expect(guard.report().outcome).toBe("unavailable"); expect(guard.isGuarded("tcp")).toBe(false); guard.stop();
});

for (const host of ["0.0.0.0", "[::]"]) for (const kind of ["Proxy", "TCPForward"] as const) {
  test(`${kind} to unspecified address ${host} guards only the runtime port`, async () => {
    const config = (port: number) => JSON.stringify(kind === "Proxy"
      ? { Web: { "fixture:443": { Handlers: { "/": { Proxy: `http://${host}:${port}` } } } } }
      : { TCP: { "443": { TCPForward: `${host}:${port}` } } });
    let stdout = config(own.port);
    const guard = createTailscaleListenerGuard(own, { canonicalize, read: async () => ({ ok: true, stdout, source: "cli" }) });
    try {
      await guard.refresh(); expect(guard.isGuarded("tcp")).toBe(true); expect(guard.isGuarded("unix")).toBe(false);
      stdout = config(43120); await guard.refresh(); expect(guard.isGuarded("tcp")).toBe(false);
    } finally { guard.stop(); }
  });
}
