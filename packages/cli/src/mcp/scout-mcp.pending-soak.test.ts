/** Opt-in real stdio/runtime regression. No real agent or existing service is used.
 * OPENSCOUT_MCP_PENDING_SOAK=1 bun test ./src/mcp/scout-mcp.pending-soak.test.ts
 * Add OPENSCOUT_MCP_PENDING_SOAK_SECONDS=7200 for delayed completion after 2h.
 * OPENSCOUT_MCP_PENDING_SOAK_HEAP=1 writes owned snapshots; analyze/delete them.
 */
import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as z from "zod/v4";

const enabled = process.env.OPENSCOUT_MCP_PENDING_SOAK === "1";
const seconds = Number(process.env.OPENSCOUT_MCP_PENDING_SOAK_SECONDS ?? 2);
const timeout = (Number.isFinite(seconds) && seconds >= 0 ? seconds : 2) * 1000 + 120000;
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(OPENSCOUT_|SCOUT_|CODEX_|CLAUDE_|BUN_JSC_)/.test(key),
));
function diskGuard(directory: string) {
  const disk = statfsSync(process.platform === "darwin" ? "/System/Volumes/Data" : directory);
  if (disk.bavail * disk.bsize < 3 * 1024 ** 3) throw Error("pending soak disk guard: below 3 GiB");
}

async function checkedDisk(directory: string) {
  diskGuard(directory);
  const df = Bun.spawn(["df", "-h", process.platform === "darwin" ? "/System/Volumes/Data" : directory], { stdout: "pipe", stderr: "inherit" });
  console.log(await new Response(df.stdout).text()); await df.exited;
}

if (!enabled) {
  test.skip("opt-in: pending MCP work, retries and delayed completion", () => {});
} else if (process.env.OWNED_MCP_PENDING_ISOLATED !== "1") {
  test("run pending MCP regression with a scrubbed environment and scratch HOME", async () => {
    const home = mkdtempSync(join(tmpdir(), "scout-pending-soak-"));
    await checkedDisk(home);
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      cwd: resolve(import.meta.dir, "../.."), stdin: "ignore", stdout: "inherit", stderr: "inherit",
      env: { ...cleanEnv(), HOME: home, OWNED_MCP_PENDING_ISOLATED: "1", OPENSCOUT_MCP_PENDING_SOAK: "1",
        OPENSCOUT_MCP_PENDING_SOAK_SECONDS: String(seconds), OPENSCOUT_MCP_PENDING_SOAK_HEAP: process.env.OPENSCOUT_MCP_PENDING_SOAK_HEAP,
        OPENSCOUT_MCP_PENDING_SOAK_REPORT_DIR: process.env.OPENSCOUT_MCP_PENDING_SOAK_REPORT_DIR },
    });
    try { expect(await child.exited).toBe(0); }
    finally { if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; rmSync(home, { recursive: true, force: true }); }
  }, timeout + 30000);
} else {
  // Import this owned-runtime fixture dynamically: runtime tests intentionally
  // have a separate TypeScript boundary from the CLI's source typecheck.
  const { createBrokerDaemonTestHarness } = await import(resolve(import.meta.dir, "../../../runtime/src/test-helpers/broker-daemon-harness.test.ts"));
  const broker = createBrokerDaemonTestHarness();
  test("pending work has one reply subscription per canonical flight, then completes late", async () => {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 7200) throw Error("pending soak seconds must be between 0 and 7200");
    const root = process.env.HOME!;
    const report = mkdtempSync(join(process.env.OPENSCOUT_MCP_PENDING_SOAK_REPORT_DIR ?? tmpdir(), "scout-pending-report-"));
    const controlHome = join(root, "control"); const bin = join(root, "bin"); const project = join(root, "project");
    for (const directory of [controlHome, bin, project]) mkdirSync(directory);
    const release = join(root, "release"); const hold = join(root, "hold");
    const pi = join(bin, "pi");
    writeFileSync(pi, `#!/usr/bin/env node
const fs=require('node:fs');const emit=x=>console.log(JSON.stringify(x));const owner=process.ppid;let active=null;
const finish=()=>{if(!active)return;emit({type:'turn_end',message:{role:'assistant',model:'fixture-model',provider:'fixture',content:[{type:'text',text:'owned late result'}],stopReason:'stop'}});emit({type:'agent_end'});active=null;};
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const cmd=JSON.parse(line);if(cmd.type==='get_state')emit({type:'response',command:'get_state',success:true,data:{sessionId:'owned-pending-pi',model:{id:'fixture-model',provider:'fixture'},thinkingLevel:'off'}});if(cmd.type==='prompt'){active=cmd.message;emit({type:'agent_start'});emit({type:'turn_start'});if(!fs.existsSync(${JSON.stringify(hold)})||fs.existsSync(${JSON.stringify(release)}))setTimeout(finish,5);}});
setInterval(()=>{if(process.ppid!==owner)process.exit(0);if(fs.existsSync(${JSON.stringify(release)}))finish()},100);
`); chmodSync(pi, 0o755);
    broker.writeRelayAgentRegistry(join(controlHome, "support"), {});
    await checkedDisk(root);
    const built = await Bun.build({ entrypoints: [resolve(import.meta.dir, "../cli/main.ts")], target: "bun", format: "esm",
      outdir: join(root, "bundle"), banner: `import ${JSON.stringify(import.meta.resolve("reflect-metadata"))};` });
    if (!built.success) throw Error(built.logs.map(String).join("\n"));
    const h = await broker.startBroker({ controlHome, preload: join(import.meta.dir, "fixtures/pending-pi-preload.ts"), startupTimeoutMs: 20000,
      env: { HOME: root, PATH: bin + ":" + process.env.PATH, OPENSCOUT_CORE_AGENTS: "", OPENSCOUT_LOCAL_AGENT_SYNC_INTERVAL_MS: "0", OPENSCOUT_PI_SCOUT_EXTENSION: "0" } });
    await broker.seedBasicConversation(h);
    const address = broker.startA2AResponder((body: Record<string, unknown>) => ({ result: { task: { id: `normal-${body.id}`, status: { state: "TASK_STATE_COMPLETED" }, artifacts: [{ artifactId: "output", parts: [{ text: "normal result" }] }] } } }));
    await broker.postJson(h.baseUrl, "/v1/agents", { id: "fast", kind: "agent", displayName: "Fast", handle: "fast", homeNodeId: h.nodeId, authorityNodeId: h.nodeId, advertiseScope: "local", agentClass: "general", capabilities: ["chat", "invoke"], wakePolicy: "on_demand" });
    await broker.postJson(h.baseUrl, "/v1/endpoints", { id: "fast-endpoint", agentId: "fast", nodeId: h.nodeId, harness: "http", transport: "http", state: "idle", address, metadata: { a2aExecutionUrl: address, a2aProtocolVersion: "1.0" } });
    const transport = new StdioClientTransport({ command: process.execPath, args: ["--preload", join(import.meta.dir, "fixtures/pending-memory-probe.ts"), built.outputs[0]!.path, "mcp"], cwd: root, stderr: "pipe",
      env: { ...cleanEnv(), HOME: root, OPENSCOUT_CONTROL_HOME: controlHome, OPENSCOUT_SUPPORT_DIRECTORY: controlHome + "/support", OPENSCOUT_BROKER_URL: h.baseUrl, OPENSCOUT_INSTANCE: "prod", OPENSCOUT_MCP_ENABLE_NOTIFICATIONS: "1", OWNED_MCP_PENDING_PROBE: report } as Record<string, string> });
    const client = new Client({ name: "owned-pending-soak", version: "1" }, { capabilities: {} });
    const replies: any[] = []; const samples: any[] = []; let buffer = ""; let waits = 0;
    client.setNotificationHandler(z.object({ method: z.literal("notifications/scout/reply"), params: z.any() }), note => { replies.push(note.params); });
    transport.stderr!.on("data", chunk => { buffer += chunk.toString(); let end: number; while ((end = buffer.indexOf("\n")) !== -1) { const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); try { const row = JSON.parse(line); if (row.event === "pending-soak-sample") samples.push(row); } catch {} } });
    const until = async (predicate: () => boolean) => { const end = Date.now() + 60000; while (!predicate()) { if (Date.now() > end) throw Error("owned pending soak deadline"); await Bun.sleep(10); } };
    const call = async (name: string, args: Record<string, unknown>) => { const result = await client.callTool({ name, arguments: args }); if (result.isError) throw Error(JSON.stringify(result)); return result.structuredContent as any; };
    const sample = async (label: string) => { diskGuard(root); const count = samples.length; writeFileSync(join(report, "command.json"), JSON.stringify({ label, snapshot: process.env.OPENSCOUT_MCP_PENDING_SOAK_HEAP === "1" })); process.kill(transport.pid!, "SIGUSR2"); await until(() => samples.length > count); };
    try {
      await client.connect(transport);
      const boot = await call("ask", { projectPath: project, harness: "pi", model: "fixture/fixture-model", reasoningEffort: "none", body: "bootstrap", senderId: "operator", replyMode: "notify" });
      await call("invocations_wait", { flightId: boot.ids.flightId, timeoutSeconds: 10 });
      const topology = await broker.getJson(h.baseUrl, "/v1/snapshot");
      const endpoint = Object.values(topology.endpoints).find((value: any) => value.transport === "pi_rpc") as any;
      expect(endpoint).toBeDefined(); const target = `session:${endpoint.sessionId}`;
      writeFileSync(hold, "hold owned fake turn"); await sample("empty");
      const pending: any[] = [];
      for (let i = 0; i < 8; i++) { const result = await call("ask", { to: target, requestId: `pending-${i}`, body: `pending ${i}`, senderId: "operator", replyMode: "notify" }); expect(result.ok).toBe(true); pending.push(result.ids); }
      await sample("pending");
      for (let i = 0; i < 128; i++) { const result = await call("ask", { to: target, requestId: "pending-0", body: "pending 0", senderId: "operator", replyMode: "notify" }); expect(result.ids.flightId).toBe(pending[0].flightId); }
      await sample("retried"); const start = Date.now(); let next = 60000;
      do {
        diskGuard(root);
        const result = await call("invocations_wait", { flightId: pending[0].flightId, timeoutSeconds: 1 }); expect(result.waitStatus).toBe("pending"); waits++;
        const normal = await call("ask", { to: "id:fast", body: `normal ${waits}`, senderId: "operator", replyMode: "notify" }); await call("invocations_wait", { flightId: normal.ids.flightId, timeoutSeconds: 5 });
        if (Date.now() - start >= next) { await sample(`hold-${Math.floor((Date.now() - start) / 1000)}`); next += 60000; }
      } while (Date.now() - start < seconds * 1000);
      await sample("before-release"); writeFileSync(release, "complete owned fake turn");
      await until(() => pending.every(p => replies.some(reply => reply.flightId === p.flightId && reply.status === "completed")));
      await Bun.sleep(1100); await sample("completed");
      expect(replies.filter(reply => pending.some(p => p.flightId === reply.flightId))).toHaveLength(pending.length);
      writeFileSync(join(report, "result.json"), JSON.stringify({ seconds: (Date.now() - start) / 1000, waits, pending: pending.length, retries: 128, samples }, null, 2));
      console.log(JSON.stringify({ event: "pending-soak-report", directory: report, waits, pending: pending.length, retries: 128 }));
    } finally { await client.close(); }
  }, timeout);
}
