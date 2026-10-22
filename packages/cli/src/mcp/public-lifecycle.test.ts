import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function isolated(root: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("OPENSCOUT_") && !key.startsWith("SCOUT_")));
  return { ...env, HOME: root, SCOUT_HOME: join(root, "scout"), OPENSCOUT_HOME: join(root, "legacy"),
    OPENSCOUT_SUPPORT_DIRECTORY: join(root, "support"), OPENSCOUT_INSTANCE: "prod", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" };
}
async function childProbe(args: string[], env: NodeJS.ProcessEnv, run: (child: ReturnType<typeof Bun.spawn>, response: (id: number) => Promise<any>) => Promise<void>) {
  const child = Bun.spawn([process.execPath, ...args], { env, detached: true, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const stderr = new Response(child.stderr).text();
  const messages: any[] = [];
  const output = (async () => {
    let buffer = "";
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value: bytes } = await reader.read();
      if (done) break;
      buffer += decoder.decode(bytes, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) { const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (line) messages.push(JSON.parse(line)); }
    }
  })();
  const kill = () => { try { process.kill(-child.pid, "SIGKILL"); } catch {} };
  const watchdog = setTimeout(kill, 8_000);
  const response = async (id: number) => {
    const deadline = Date.now() + 6_000;
    while (Date.now() < deadline) { const found = messages.find(m => m.id === id); if (found) return found; if (child.exitCode !== null) break; await Bun.sleep(10); }
    throw new Error(`no JSON-RPC response ${id}; ${child.exitCode !== null ? await stderr : "child still running"}`);
  };
  try {
    await run(child, response);
    expect({ code: await child.exited, stderr: await stderr }).toEqual({ code: 0, stderr: "" });
    await output;
    expect(await stderr).toBe("");
  } finally {
    kill(); await child.exited; clearTimeout(watchdog);
    await output.catch(() => {});
    // Check the process group, not merely the direct child: no inherited pipe
    // holder or transport worker may survive the session.
    let survivor: unknown;
    try { process.kill(-child.pid, 0); } catch (error) { survivor = error; }
    expect((survivor as NodeJS.ErrnoException | undefined)?.code).toBe("ESRCH");
  }
  return messages;
}
function send(child: ReturnType<typeof Bun.spawn>, message: unknown) { (child.stdin as any).write(JSON.stringify(message) + "\n"); }

test("public MCP factory import starts no listener, socket, timer, worker, child or runtime contact", async () => {
  const root = mkdtempSync(join(tmpdir(), "scout-pure-mcp-"));
  try {
    const messages = await childProbe([resolve(import.meta.dir, "test-helpers/import-purity.ts")], isolated(root), async (child) => { (child.stdin as any).end(); });
    expect(messages).toEqual([{ imported: true, effects: [] }]);
    expect(readdirSync(root)).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const mode of ["mcp", "channel"] as const) for (const shutdown of ["EOF", "SIGTERM"] as const) test(`public ${mode} serves JSON-RPC and reaps its lifecycle on ${shutdown}`, async () => {
  const root = mkdtempSync(join(tmpdir(), `scout-${mode}-lifecycle-`));
  const endpointStates: string[] = [];
  let streamCancelled = false;
  const broker = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/health") return Response.json({ ok: true });
    if (path === "/v1/node") return Response.json({ id: "fixture-node" });
    if (path === "/v1/snapshot") return Response.json({ agents: {}, actors: {}, messages: {}, conversations: {} });
    if (path === "/v1/endpoints") { endpointStates.push((await request.json() as any).state); return Response.json({ ok: true }); }
    if (path === "/v1/inbox/stream") return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(": fixture\n\n")); }, cancel() { streamCancelled = true; } }), { headers: { "content-type": "text/event-stream" } });
    throw new Error(`unexpected fixture request ${path}`);
  } });
  try {
    const env = { ...isolated(root), OPENSCOUT_AGENT: "fixture-agent", OPENSCOUT_BROKER_URL: `http://127.0.0.1:${broker.port}` };
    const entry = resolve(import.meta.dir, "../main.ts");
    // Channel normally performs CLI freshness maintenance before dispatch.
    // Stub only that external service operation; exercise the actual public
    // command, SDK transport, heartbeat, subscription and shutdown unchanged.
    const preload = join(root, "no-maintenance.ts");
    if (mode === "channel") writeFileSync(preload, `import { mock } from "bun:test";
      mock.module(${JSON.stringify(resolve(import.meta.dir, "../cli/broker-update.ts"))}, () => ({
        brokerUpdateDebugEnabled: () => false, ensureBrokerUptodate: async () => {},
      }));`);
    const args = [...(mode === "channel" ? ["--preload", preload] : []), entry, mode, "--context-root", root];
    await childProbe(args, env, async (child, response) => {
      send(child, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "lifecycle-test", version: "1" } } });
      expect((await response(1)).result.serverInfo.name).toBe(mode === "mcp" ? "openscout" : "scout");
      send(child, { jsonrpc: "2.0", method: "notifications/initialized" });
      send(child, { jsonrpc: "2.0", id: 2, method: "tools/list" });
      const tools = (await response(2)).result.tools;
      expect(tools.some((t: any) => t.name === (mode === "mcp" ? "current_reply_context" : "scout_send"))).toBe(true);
      send(child, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: mode === "mcp" ? "current_reply_context" : "scout_send", arguments: {} } });
      const called = (await response(3)).result;
      expect(called.isError === true).toBe(mode === "channel"); // channel validates the request, without sending a message
      if (shutdown === "EOF") (child.stdin as any).end(); else child.kill("SIGTERM");
    });
    if (mode === "channel") { expect(endpointStates).toContain("active"); expect(endpointStates).toContain("offline"); expect(streamCancelled).toBe(true); }
  } finally { broker.stop(true); rmSync(root, { recursive: true, force: true }); }
}, 12_000);
