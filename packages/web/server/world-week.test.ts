import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorldWeekService, worldDays } from "./world-week.ts";
import type { WorldBrokerSnapshot } from "./db/world.ts";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const stamp = (time: number) => new Date(time).toISOString();
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "world-week-")); roots.push(home);
  const cwd = join(home, "dev/project"), claude = join(home, ".claude/projects/p"), codex = join(home, ".codex/sessions/2026/10/08");
  await Promise.all([mkdir(cwd, { recursive: true }), mkdir(claude, { recursive: true }), mkdir(codex, { recursive: true })]);
  const now = Date.now(), at = now - 60_000, file = join(cwd, "file with spaces.md"), plain = join(cwd, "plain.ts");
  await Promise.all([writeFile(file, "preview"), writeFile(plain, "export const n = 1;")]);
  const task = "Please inspect the fixture project and update the requested file with spaces";
  const broker: WorldBrokerSnapshot = {
    asks: [{ created_at: at, completed_at: at + 30_000, state: "completed", requester_id: "human", target_agent_id: "agent", task, error: null }],
    messages: [{ created_at: at, actor_id: "agent", class: "work" }],
    actors: [{ id: "human", kind: "human", display_name: "Operator", metadata_json: null }, { id: "agent", kind: "agent", display_name: "Worker", metadata_json: null }],
    agents: [{ id: "agent", node_qualifier: "mini", workspace_qualifier: "main", agent_class: null, metadata_json: JSON.stringify({ projectRoot: cwd, harness: "claude", project: "project" }) }],
  };
  const claudeFile = join(claude, "abcd1234-rest.jsonl");
  await writeFile(claudeFile, [
    { type: "user", timestamp: stamp(at + 100), message: { content: task } },
    { type: "user", timestamp: stamp(at + 200), message: { content: "# AGENTS.md injected instructions" } },
    { type: "user", timestamp: stamp(at + 300), message: { content: [{ type: "text", text: "A native operator turn" }] } },
    { type: "assistant", timestamp: stamp(at + 400), cwd, message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: file } }, { type: "tool_use", name: "Bash", input: { command: "cat ./plain.ts" } }] } },
  ].map(x => JSON.stringify(x)).join("\n"));
  const codexFile = join(codex, "rollout-2026-10-08T12-00-00-019acafe-0000-7000-8000-1234deadbeef.jsonl");
  await writeFile(codexFile, [
    { type: "session_meta", payload: { cwd } },
    { timestamp: stamp(at + 500), type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Codex native turn" }] } },
    { timestamp: stamp(at + 550), type: "event_msg", payload: { type: "user_message", message: "Codex native turn" } },
    { timestamp: stamp(at + 600), payload: { type: "custom_tool_call", name: "apply_patch", input: "*** Begin Patch\n*** Update File: file with spaces.md\n@@\n-old\n+new\n*** End Patch" } },
    { timestamp: stamp(at + 700), payload: { type: "function_call", name: "exec", arguments: `const r = await tools.view_image({path: "${file}"});` } },
    { timestamp: stamp(now - 15 * 864e5), payload: { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: "old call" }) } },
  ].map(x => JSON.stringify(x)).join("\n"));
  await writeFile(join(codex, "rollout-019acafe-0000-7000-8000-1234cafebabe.jsonl"), [
    { type: "session_meta", payload: { cwd } },
    { timestamp: stamp(at + 900), payload: { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: "bun test", workdir: cwd }) } },
  ].map(x => JSON.stringify(x)).join("\n"));
  const hosts = [{ name: "arts-mini", platform: "darwin", self: true, seen: now, tailnet: true, caps: ["scout-web"] }];
  return { home, now, at, file, plain, task, broker, codexFile, hosts };
}
describe("World week", () => {
  test("preserves the packed study shape, native turns, UUID tails and stat-checked spaced paths", async () => {
    const f = await fixture();
    const service = createWorldWeekService({ home: f.home, now: () => f.now, readBroker: () => f.broker, readHosts: async () => f.hosts });
    const data = await service.get();
    expect(Object.keys(data)).toEqual(["now", "from", "actors", "asks", "msgs", "hosts", "events", "strs", "sessions", "work", "allow", "roots", "quota", "usage", "usageLoose", "colds", "errs", "dlv"]);
    expect(data.from).toBe(f.now - 7 * 864e5);
    expect(data.asks[0]).toEqual([f.at, f.at + 30_000, "c", 0, 1, f.task, "", "b"]);
    expect(data.msgs[0]).toEqual([f.at, 1, "w"]);
    expect(data.hosts).toEqual(f.hosts);
    expect(data.actors[1].root).toBe("~/dev/project");
    expect(data.events).toHaveLength(5);
    // edits carry [lines added, lines removed]; every other call is the 7-field row
    expect(data.events.every(e => e.length === (data.strs[e[4]] === "apply_patch" || data.strs[e[4]] === "Edit" ? 9 : 7))).toBe(true);
    expect(data.sessions.map(s => s[0])).toEqual(["abcd1234", "deadbeef", "cafebabe"]);
    expect(data.sessions.every(s => s.length === 4)).toBe(true);
    expect(data.sessions[0][3].map(t => data.strs[t[1]])).toEqual(["A native operator turn"]);
    expect(data.sessions[1][3].map(t => data.strs[t[1]])).toEqual(["Codex native turn"]);
    const patch = data.events.find(e => data.strs[e[4]] === "apply_patch")!;
    expect(data.strs[patch[6]]).toBe(f.file);
    expect(patch.slice(7)).toEqual([1, 1]);
    expect(data.allow).toContain(f.file);
    expect(data.allow).toContain(f.plain);
    expect(data.work[0].files.find(row => row[1] === f.file)?.slice(2, 5)).toEqual([1, 0, 7]);
    expect(JSON.parse(await service.json())).toEqual(data);
  });
  test("never serves a transcript or broker secret: targets, commands, user turns, ask text and URLs are redacted", async () => {
    const f = await fixture(), at = f.now - 30_000, cwd = join(f.home, "dev/project");
    const token = "abc123def456ghi789jkl", key = "sk-proj-zyxwvutsrqponmlkjihgfedcba";
    await writeFile(join(f.home, ".claude/projects/p/eeee5555-secret.jsonl"), [
      { type: "user", timestamp: stamp(at), message: { content: `Please call the API with --password hunter2 and ${key} for this run` } },
      { type: "assistant", timestamp: stamp(at + 10), cwd, message: { content: [
        { type: "tool_use", name: "Bash", input: { command: `curl -H 'Authorization: Bearer ${token}' https://alice:pw0rd@api.example.com/v1` } },
        { type: "tool_use", name: "WebFetch", input: { url: `https://api.example.com/?api_key=${token}` } },
      ] } },
    ].map(x => JSON.stringify(x)).join("\n"));
    const task = `Please call the API with --password hunter2 and ${key} for this run`;
    const broker = { ...f.broker, asks: [...f.broker.asks, { created_at: at - 1000, completed_at: at + 20_000, state: "failed", requester_id: "human", target_agent_id: "agent", task, error: `401 for Bearer ${token}` }] };
    const service = createWorldWeekService({ home: f.home, now: () => f.now, readBroker: () => broker, readHosts: async () => [] });
    const json = await service.json();
    for (const secret of [token, "hunter2", key, "zyxwvutsrqponmlkji", "pw0rd"]) expect(json).not.toContain(secret);
    const data = JSON.parse(json);
    expect(data.strs.some((s: string) => s.startsWith("curl -H 'Authorization: •••"))).toBe(true);
    expect(Object.values(data.work).some((w: any) => w.cmds.length && w.urls.length)).toBe(true);
  });
  test("single-flights requests and reuses unchanged transcript parses across payload refreshes", async () => {
    const f = await fixture(); let now = f.now, reads = 0;
    const service = createWorldWeekService({ home: f.home, now: () => now, ttlMs: 100, readBroker: () => { reads++; return f.broker; }, readHosts: async () => [] });
    const [a, b] = await Promise.all([service.get(), service.get()]);
    expect(a).toBe(b); expect(reads).toBe(1);
    expect(service.metrics().parsedFiles).toBe(3);
    await service.get(); expect(reads).toBe(1);
    now += 101; await service.get();
    expect(reads).toBe(2); expect(service.metrics().parsedFiles).toBe(3); expect(service.metrics().reusedFiles).toBe(3);
    await appendFile(f.codexFile, "\n" + JSON.stringify({ timestamp: stamp(f.now - 100), payload: { type: "function_call", name: "exec_command", arguments: '{"cmd":"changed"}' } }));
    now += 101; const updated = await service.get();
    expect(service.metrics().parsedFiles).toBe(4); expect(service.metrics().reusedFiles).toBe(5);
    expect(updated.events).toHaveLength(a.events.length + 1);
  });
  test("retains the last good host roster and handles absent transcript directories", async () => {
    const f = await fixture(); let now = f.now, broken = false;
    const service = createWorldWeekService({ home: join(f.home, "empty"), now: () => now, ttlMs: 100, readBroker: () => f.broker, readHosts: async () => { if (broken) throw Error("offline"); return f.hosts; } });
    expect((await service.get()).events).toEqual([]);
    broken = true; now += 101;
    expect((await service.get()).hosts).toEqual(f.hosts);
  });
  test("bounds days to 1–14, defaulting invalid values to seven", () => {
    expect([undefined, "", "bad", "0", "-2"].map(worldDays)).toEqual([7, 7, 7, 7, 7]);
    expect(worldDays("99")).toBe(14); expect(worldDays("2")).toBe(2); expect(worldDays("0.5")).toBe(1);
  });
});
