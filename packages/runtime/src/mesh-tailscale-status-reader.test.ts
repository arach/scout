import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type RequestListener, type Server } from "node:http";
import { join } from "node:path";
import { createTailscaleListenerGuard, readTailscaleServeConfig, type TailscaleStatusReaderOptions } from "./mesh-tailscale-listener-guard.js";

const dirs: string[] = [], servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function directory() {
  const dir = mkdtempSync(join(import.meta.dir, ".tailscale-reader-")); dirs.push(dir); return dir;
}
async function serve(handler: RequestListener) {
  const server = createServer(handler); servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture needs a TCP port");
  return address.port;
}
const unavailable = () => Object.assign(new Error("synthetic missing executable"), { code: "ENOENT" });
function options(discoveryDirectory = directory()): TailscaleStatusReaderOptions {
  return { platform: "darwin", discoveryDirectory, unixSocketPaths: [], env: {}, exec: async () => { throw unavailable(); } };
}
function proof(dir: string, port: number, token: string) {
  symlinkSync(String(port), join(dir, "ipnport"));
  writeFileSync(join(dir, `sameuserproof-${port}`), token, { mode: 0o640 });
}

test("standalone macOS uses same-user proof for one fixed GET and rereads credentials", async () => {
  // Synthetic proof values only. No test reads the installed app or invokes Tailscale.
  const dir = directory(); let token = "synthetic-proof-first", requests = 0, execs = 0;
  const config = '{"TCP":{"443":{"TCPForward":"localhost:43110"}}}';
  const port = await serve((req, res) => {
    requests++;
    expect(req.method).toBe("GET"); expect(req.url).toBe("/localapi/v0/serve-config");
    expect(req.headers.host).toBe("local-tailscaled.sock");
    expect(req.headers.authorization).toBe(`Basic ${Buffer.from(`:${token}`).toString("base64")}`);
    res.end(config);
  });
  proof(dir, port, ` ${token}\n`);
  const injected = { ...options(dir), exec: async () => { execs++; throw unavailable(); } };
  const guard = createTailscaleListenerGuard({ port: 43110, socketPath: "/fixture/runtime.sock" }, { read: () => readTailscaleServeConfig(injected) });
  try {
    await guard.refresh(); expect(guard.isGuarded("tcp")).toBe(true);
    expect(guard.report().source).toBe("macos-localapi"); expect(guard.report().outcome).toBe("ok");
    token = "synthetic-proof-rotated";
    writeFileSync(join(dir, `sameuserproof-${port}`), token);
    await guard.refresh(); expect(guard.isGuarded("tcp")).toBe(true);
    expect(requests).toBe(2); expect(execs).toBe(0);
    const report = JSON.stringify(guard.report());
    for (const privateValue of [token, dir, "127.0.0.1", "localhost", "sameuserproof"]) expect(report).not.toContain(privateValue);
  } finally { guard.stop(); }
});

test("standalone macOS rereads the discovery symlink rather than caching the port", async () => {
  const dir = directory(), token = "synthetic-proof";
  const first = await serve((_, res) => res.end("{}"));
  const second = await serve((_, res) => res.end("null"));
  proof(dir, first, token);
  expect((await readTailscaleServeConfig(options(dir))).stdout).toBe("{}");
  unlinkSync(join(dir, "ipnport")); proof(dir, second, token);
  expect((await readTailscaleServeConfig(options(dir))).stdout).toBe("null");
});

for (const target of ["0", "65536", "../43110", "43110\n", "http://localhost:43110"]) {
  test(`invalid discovery port ${JSON.stringify(target)} falls back without connecting`, async () => {
    const dir = directory(); symlinkSync(target, join(dir, "ipnport"));
    let execs = 0;
    const result = await readTailscaleServeConfig({ ...options(dir), exec: async () => { execs++; return { stdout: "{}" }; } });
    expect(result).toEqual({ ok: true, stdout: "{}", source: "cli" }); expect(execs).toBe(1);
  });
}
for (const kind of ["missing", "empty", "symlink", "oversized"] as const) {
  test(`${kind} same-user proof falls back without reading arbitrary credentials`, async () => {
    const dir = directory(); symlinkSync("43110", join(dir, "ipnport"));
    const file = join(dir, "sameuserproof-43110");
    if (kind === "empty") writeFileSync(file, " \n");
    if (kind === "oversized") writeFileSync(file, "x".repeat(4097));
    if (kind === "symlink") { writeFileSync(join(dir, "other"), "synthetic-proof"); symlinkSync("other", file); }
    expect(await readTailscaleServeConfig({ ...options(dir), exec: async () => ({ stdout: "{}" }) })).toEqual({ ok: true, stdout: "{}", source: "cli" });
  });
}

test("CLI fallback honors the existing binary override and fixed read-only arguments", async () => {
  const calls: string[] = [], env = { OPENSCOUT_TAILSCALE_BIN: "/fixture/custom-tailscale" };
  const result = await readTailscaleServeConfig({ ...options(), env, exec: async (file, args, signal, receivedEnv) => {
    calls.push(file); expect(args).toEqual(["serve", "status", "--json"]);
    expect(signal.aborted).toBe(false); expect(receivedEnv).toBe(env); return { stdout: "{}" };
  } });
  expect(result.ok).toBe(true); expect(calls).toEqual([env.OPENSCOUT_TAILSCALE_BIN]);
});

test("a missing PATH CLI falls back to the standalone app bundle", async () => {
  const calls: string[] = [];
  const result = await readTailscaleServeConfig({ ...options(), exec: async (file) => {
    calls.push(file); if (file === "tailscale") throw unavailable(); return { stdout: "{}" };
  } });
  expect(result).toEqual({ ok: true, stdout: "{}", source: "cli" });
  expect(calls).toEqual(["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"]);
});

test("unavailable transports are distinct from transient CLI failures", async () => {
  expect(await readTailscaleServeConfig(options())).toEqual({ ok: false, stdout: "", source: "cli", unavailable: true });
  const result = await readTailscaleServeConfig({ ...options(), exec: async () => { throw Object.assign(new Error("must not be reported"), { code: "timeout" }); } });
  expect(result).toEqual({ ok: false, stdout: "", source: "cli" });
});

for (const status of [401, 403, 500, 302]) test(`macOS LocalAPI HTTP ${status} is advisory, body discarded and redirects never followed`, async () => {
  const dir = directory(); let redirectCalls = 0, execs = 0;
  const otherPort = await serve((_, res) => { redirectCalls++; res.end("{}"); });
  const port = await serve((_, res) => res.writeHead(status, { location: `http://127.0.0.1:${otherPort}/` }).end("synthetic-sensitive-error-body"));
  proof(dir, port, "synthetic-proof");
  const result = await readTailscaleServeConfig({ ...options(dir), exec: async () => { execs++; return { stdout: "{}" }; } });
  expect(result).toEqual({ ok: false, stdout: "", source: "macos-localapi", ...(status === 401 || status === 403 ? { unavailable: true } : {}) });
  expect(redirectCalls).toBe(0); expect(execs).toBe(0);
});

test("macOS LocalAPI timeout and oversized responses remain bounded failures", async () => {
  const dir = directory(); let oversize = true;
  const port = await serve((_, res) => { if (oversize) res.end("x".repeat(2 * 1024 * 1024 + 1)); });
  proof(dir, port, "synthetic-proof");
  expect(await readTailscaleServeConfig(options(dir))).toEqual({ ok: false, stdout: "", source: "macos-localapi" });
  oversize = false;
  expect(await readTailscaleServeConfig(options(dir))).toEqual({ ok: false, stdout: "", source: "macos-localapi" });
});

test("a refused fixture LocalAPI endpoint is unavailable, not a transient read failure", async () => {
  const dir = directory();
  const port = await serve((_, res) => res.end("{}"));
  const server = servers.pop()!;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  proof(dir, port, "synthetic-proof");
  expect(await readTailscaleServeConfig(options(dir))).toEqual({ ok: false, stdout: "", source: "macos-localapi", unavailable: true });
});

test("non-macOS CLI resolution has no app-bundle fallback", async () => {
  const calls: string[] = [];
  expect(await readTailscaleServeConfig({ ...options(), platform: "linux", exec: async (file) => { calls.push(file); throw unavailable(); } })).toEqual({ ok: false, stdout: "", source: "cli", unavailable: true });
  expect(calls).toEqual(["tailscale"]);
});
