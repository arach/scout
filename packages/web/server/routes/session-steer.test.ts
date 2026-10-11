import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClaudeSessionRecord } from "@openscout/runtime";
import { deliverInPlace, type DeliverInPlaceDeps } from "@openscout/runtime/in-place";
import { createSessionSteerAudit } from "../session-steer-audit.ts";
import { createSessionSteering, type SessionSteeringDeps, type InPlaceRuntime } from "../session-steering.ts";
import { installScoutApiMiddleware } from "../server-core.ts";
import { mountSessionSteerRoutes } from "./session-steer.ts";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const ref = "session:claude:exact-session", start = "Sat Oct 10 18:00:00 2026";
const headers = { authorization: "Bearer operator-test", "content-type": "application/json", origin: "http://localhost" };
const url = (machine = "here", sessionRef = ref) => `http://localhost/api/session-ref/${encodeURIComponent(sessionRef)}/steer?machine=${machine}`;
const record = (pid = 100): ClaudeSessionRecord => ({ pid, procStart: start, sessionId: "exact-session", cwd: "/repo", startedAt: null, kind: "interactive", entrypoint: "cli", version: null, tmux: null, name: null, nameSource: null, recordPath: `/records/${pid}.json` });

async function fixture(overrides: Partial<SessionSteeringDeps> = {}, runtimeOverrides: Partial<InPlaceRuntime> = {}) {
  const root = await mkdtemp(join(tmpdir(), "session-steer-")); roots.push(root);
  const log = join(root, "control/session-steer-audit.jsonl"), audit = createSessionSteerAudit(log);
  const sent: Parameters<InPlaceRuntime["deliverInPlace"]>[] = [];
  const runtime: InPlaceRuntime = {
    readProcessHostEnv: async () => ({}), innermostProcessHost: () => null, processHostLocations: () => [],
    resolveInPlaceOrder: () => ["herdr", "orca", "tmux", "terminal"],
    codexThreadHolderPids: async () => [], codexThreadHeldByChatGPTApp: async () => false,
    readOrcaAgents: async () => [], isScoutBackgroundCopy: () => false,
    deliverInPlace: async (...args) => { sent.push(args); return { ok: true }; }, ...runtimeOverrides,
  };
  const deps: SessionSteeringDeps = {
    runtime, machine: async () => "here", records: async () => [record()],
    process: async (pid) => ({ pid, parent: 1, start, tty: "ttys002", foreground: true }),
    self: async () => ({ pids: [999], ttys: ["ttys001"], hosts: [] }),
    herdr: async () => { throw new Error("Unexpected Herdr probe"); }, tmux: async () => null,
    ...overrides,
  };
  const steering = createSessionSteering(deps), app = new Hono();
  installScoutApiMiddleware(app, "steering-test", { authToken: "operator-test" });
  mountSessionSteerRoutes(app, { steering, audit, operator: () => "Arach" });
  const post = (text = "do this next", machine = "here", sessionRef = ref) => app.request(url(machine, sessionRef), { method: "POST", headers, body: JSON.stringify({ text, operator: "spoofed" }) });
  return { app, audit, log, sent, post, deps, steering };
}

test("bound: types verbatim into exactly the native process and appends one private metadata-only audit", async () => {
  const f = await fixture();
  const capability = await f.app.request(url(), { headers });
  expect(await capability.json()).toMatchObject({ available: true, target: { pid: 100, host: "terminal", address: "ttys002" } });
  expect(f.sent).toHaveLength(0);
  const text = "  body with é\nand a secret  ", response = await f.post(text);
  expect(response.status).toBe(200);
  const receipt = await response.json();
  expect(f.sent).toHaveLength(1);
  expect(f.sent[0]![0]).toEqual({ sessionId: "exact-session", harness: "claude", body: text });
  const pinned = f.sent[0]![1];
  expect(pinned.order).toEqual(["terminal"]);
  expect(await pinned.findHerdrPane()).toBeNull();
  expect(await pinned.codexThreadPids()).toEqual([]);
  expect(await pinned.codexHeldByApp()).toBe(false);
  expect(await pinned.ttyForPid()).toBe("ttys002");
  expect(receipt.audit).toMatchObject({ operator: "Arach", sessionRef: ref, machine: "here", outcome: "accepted", textLength: text.length, target: { pid: 100, processStart: start } });
  const raw = await readFile(f.log, "utf8");
  expect(raw.trim().split("\n")).toHaveLength(2);
  expect(receipt.audit.textSha256).toBe(createHash("sha256").update(text).digest("hex"));
  expect(JSON.parse(raw.trim().split("\n")[1]!)).not.toHaveProperty("textSha256");
  expect(raw).not.toContain("secret"); expect(raw).not.toContain("spoofed");
  expect((await stat(f.log)).mode & 0o777).toBe(0o600);
  expect((await (await f.app.request(url().replace("/steer?", "/steer/audit?"), { headers })).json()).entries).toEqual([receipt.audit]);
});

test.each([
  ["ambiguous", { records: async () => [record(100), record(101)] }, "ambiguous"],
  ["missing", { records: async () => [] }, "not_live"],
  ["reused pid", { records: async () => [{ ...record(), procStart: "an earlier process" }] }, "not_live"],
  ["self tty", { self: async () => ({ pids: [999], ttys: ["ttys002"], hosts: [] }) }, "self_target"],
  ["self process", { self: async () => ({ pids: [100], ttys: [], hosts: [] }) }, "self_target"],
  ["no foreground process", { process: async (pid: number) => ({ pid, parent: 1, start, tty: "ttys002", foreground: false }) }, "not_foreground"],
] as const)("%s refuses and records exactly one attempt", async (_name, overrides, code) => {
  const f = await fixture(overrides);
  expect((await f.post()).status).toBe(409); expect(f.sent).toEqual([]);
  expect(await f.audit.read(ref, "here")).toMatchObject([{ outcome: "refused", code }]);
});

test("remote-refused even if the local machine has an identical native id", async () => {
  const f = await fixture({ records: async () => { throw new Error("Must not probe a local lookalike"); } });
  const response = await f.post("hello", "remote");
  expect(response.status).toBe(409);
  expect((await response.json()).audit.code).toBe("remote_refused");
  expect(await f.audit.read(ref, "remote")).toHaveLength(1);
  expect(await f.audit.read(ref, "here")).toEqual([]); expect(f.sent).toEqual([]);
});

const tmuxEnv = { TERM_PROGRAM: "tmux", TMUX: "/tmp/socket,77,0", TMUX_PANE: "%8" };
test("tmux uses only a matching default socket and birth-verified pane", async () => {
  const f = await fixture({ records: async () => [{ ...record(), tmux: { session: "live", pane: "%8", window: "@1" } }],
    tmux: async () => ({ socket: "/tmp/socket", pid: 100, tty: "ttys002", pane: "%8", session: "live" }) },
  { readProcessHostEnv: async () => tmuxEnv, innermostProcessHost: () => ({ host: "tmux", pane: "%8" }) });
  expect((await f.post()).status).toBe(200); expect(f.sent[0]![1].order).toEqual(["tmux"]);
});
test("self-pane-refused even when the server has no tty", async () => {
  const f = await fixture({ self: async () => ({ pids: [999], ttys: [], hosts: [{ host: "tmux", pane: "%8" }] }) },
    { readProcessHostEnv: async () => tmuxEnv, innermostProcessHost: () => ({ host: "tmux", pane: "%8" }) });
  expect((await (await f.post()).json()).audit.code).toBe("self_target"); expect(f.sent).toEqual([]);
});
test("a similarly numbered pane on another tmux socket is not a target", async () => {
  const f = await fixture({ tmux: async () => ({ socket: "/different/socket", pid: 100, tty: "ttys002", pane: "%8", session: "live" }) },
    { readProcessHostEnv: async () => tmuxEnv, innermostProcessHost: () => ({ host: "tmux", pane: "%8" }) });
  expect((await (await f.post()).json()).audit.code).toBe("tmux_unverified"); expect(f.sent).toEqual([]);
});

test("Herdr delivery is pinned to the pane that confirms the native session", async () => {
  const host = { host: "herdr" as const, session: "herdr-live", paneId: "w1:p2" };
  const f = await fixture({ herdr: async () => ({ running: true, workspaces: [{ tabs: [{ panes: [{ paneId: "w1:p2", agentSession: { value: "exact-session" }, agentStatus: "working" }] }] }] }) as never },
    { innermostProcessHost: () => host });
  expect((await f.post()).status).toBe(200);
  expect(f.sent[0]![1].order).toEqual(["herdr"]);
  expect(await f.sent[0]![1].findHerdrPane()).toEqual({ session: "herdr-live", paneId: "w1:p2", status: "working" });
});
test("Herdr duplicate session panes refuse instead of choosing the first", async () => {
  const f = await fixture({ herdr: async () => ({ running: true, workspaces: [{ tabs: [{ panes: ["w1:p2", "w1:p3"].map((paneId) => ({ paneId, agentSession: { value: "exact-session" }, agentStatus: "working" })) }] }] }) as never },
    { innermostProcessHost: () => ({ host: "herdr", session: "herdr-live", paneId: "w1:p2" }) });
  expect((await (await f.post()).json()).audit.code).toBe("host_unverified"); expect(f.sent).toEqual([]);
});
test.each(["working", "waiting"] as const)("Codex Orca %s is bound or blocked without opening the native app", async (state) => {
  const f = await fixture({}, {
    codexThreadHolderPids: async () => [100],
    innermostProcessHost: () => ({ host: "orca", terminalHandle: "term_2", paneKey: "p2", worktreeId: "w1" }),
    readOrcaAgents: async () => [{ paneKey: "p2", state, agentType: "codex", worktreeId: "w1", worktreePath: "/repo", lastAssistantMessage: null }],
  });
  const response = await f.post("go", "here", "session:codex:exact-session");
  expect(response.status).toBe(state === "working" ? 200 : 409);
  expect(f.sent).toHaveLength(state === "working" ? 1 : 0);
  if (state === "working") expect(f.sent[0]![1].order).toEqual(["orca"]);
});
test("the configured host order chooses between verified bindings for the same process", async () => {
  const f = await fixture({
    records: async () => [{ ...record(), tmux: { session: "live", pane: "%8", window: "@1" } }],
    tmux: async () => ({ socket: "/tmp/socket", pid: 100, tty: "ttys002", pane: "%8", session: "live" }),
    herdr: async () => ({ running: true, workspaces: [{ tabs: [{ panes: [{ paneId: "w1:p2", agentSession: { value: "exact-session" }, agentStatus: "working" }] }] }] }) as never,
  }, { readProcessHostEnv: async () => tmuxEnv,
    innermostProcessHost: () => ({ host: "herdr", session: "herdr-live", paneId: "w1:p2" }),
    resolveInPlaceOrder: () => ["tmux", "herdr", "orca", "terminal"],
  });
  expect((await f.post()).status).toBe(200); expect(f.sent[0]![1].order).toEqual(["tmux"]);
});
test("Codex native-app ownership and ambiguous holders refuse", async () => {
  const app = await fixture({}, { codexThreadHeldByChatGPTApp: async () => true });
  expect((await (await app.post("go", "here", "session:codex:exact-session")).json()).audit.code).toBe("native_app_refused");
  expect(app.sent).toEqual([]);
  const ambiguous = await fixture({}, { codexThreadHolderPids: async () => [100, 101] });
  expect((await (await ambiguous.post("go", "here", "session:codex:exact-session")).json()).audit.code).toBe("ambiguous");
  expect(ambiguous.sent).toEqual([]);
});
test("concurrent steers cannot interleave input into the same pane", async () => {
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const f = await fixture({}, { deliverInPlace: async () => { calls++; started(); await gate; return { ok: true }; } });
  const first = f.post("one"); await entered;
  expect((await (await f.post("two")).json()).audit.code).toBe("busy");
  release(); expect((await first).status).toBe(200); expect(calls).toBe(1);
  expect(await f.audit.read(ref, "here")).toHaveLength(2);
});

test("a changed process between verification and actuation is refused", async () => {
  let reads = 0;
  const f = await fixture({ records: async () => [record(++reads === 1 ? 100 : 101)] });
  expect((await (await f.post()).json()).audit.code).toBe("binding_changed"); expect(f.sent).toEqual([]);
});
test("host failure is final, metadata-only, and never retried", async () => {
  let calls = 0;
  const f = await fixture({}, { deliverInPlace: async () => { calls++; throw new Error("argv includes TOP SECRET TEXT"); } });
  expect((await f.post("TOP SECRET TEXT")).status).toBe(409); expect(calls).toBe(1);
  const rows = await f.audit.read(ref, "here");
  expect(rows).toHaveLength(1); expect(rows[0]!.code).toBe("delivery_unconfirmed");
  expect(JSON.stringify(rows)).not.toContain("TOP SECRET");
});
test("invalid text is also audited, without actuation", async () => {
  const f = await fixture();
  expect((await f.post("   ")).status).toBe(400);
  expect((await f.post("a".repeat(32_001))).status).toBe(400);
  expect((await f.audit.read(ref, "here")).map((r) => r.textLength)).toEqual([32_001, 3]);
  expect(f.sent).toEqual([]);
});
test("unqualified refs and missing machine cannot guess an execution target", async () => {
  const f = await fixture();
  expect((await (await f.post("hi", "here", "exact-session")).json()).audit.code).toBe("invalid_session");
  expect((await (await f.post("hi", "")).json()).audit.code).toBe("machine_unverified");
  expect(f.sent).toEqual([]);
});
test("audit is append-only, newest-first, capped, and scoped to the exact session and machine", async () => {
  const f = await fixture();
  await f.post("one"); const before = await readFile(f.log, "utf8");
  await f.post("two"); await f.post("three", "remote"); await f.post("four", "here", "session:claude:another");
  expect((await readFile(f.log, "utf8")).startsWith(before)).toBe(true);
  expect(await f.audit.read(ref, "here", 1)).toMatchObject([{ textLength: 3, outcome: "accepted" }]);
  expect(await f.audit.read(ref, "here")).toHaveLength(2);
  expect(await f.audit.read("session:claude:another", "remote")).toEqual([]);
});
test("unavailable audit prevents typing", async () => {
  const f = await fixture(), app = new Hono();
  mountSessionSteerRoutes(app, { steering: f.steering, audit: { ...f.audit, open: async () => { throw new Error("disk unavailable"); } } });
  expect((await app.request(url(), { method: "POST", body: JSON.stringify({ text: "no" }) })).status).toBe(503);
  expect(f.sent).toEqual([]);
});
test("operator gate and origin checks protect capability, read and write routes", async () => {
  const f = await fixture();
  for (const path of [url(), url().replace("/steer?", "/steer/audit?")]) {
    expect((await f.app.request(path)).status).toBe(401);
    expect((await f.app.request(path, { headers: { ...headers, origin: "https://evil.test" } })).status).toBe(403);
  }
  expect((await f.app.request(url(), { method: "POST", body: JSON.stringify({ text: "no" }) })).status).toBe(401);
  expect(f.sent).toEqual([]);
});

test("a process exit after host probing or after intent fsync prevents actuation", async () => {
  let reads = 0;
  const f = await fixture({ process: async (pid) => ++reads < 3 ? { pid, parent: 1, start, tty: "ttys002", foreground: true } : null });
  expect((await (await f.post()).json()).audit.code).toBe("binding_changed");
  expect(f.sent).toEqual([]); expect(await f.audit.read(ref, "here")).toMatchObject([{ outcome: "refused", code: "binding_changed" }]);
});
test("a session switched inside the same process is not steered", async () => {
  let reads = 0;
  const f = await fixture({ records: async () => [{ ...record(), sessionId: ++reads < 3 ? "exact-session" : "another-session" }] });
  expect((await (await f.post()).json()).audit.code).toBe("binding_changed"); expect(f.sent).toEqual([]);
});
test.each([start, null])("a second holder appearing during audit fsync prevents actuation (birth: %s)", async (procStart) => {
  let reads = 0;
  const f = await fixture({ records: async () => ++reads < 3 ? [record()] : [record(), { ...record(101), procStart }] });
  expect((await (await f.post()).json()).audit.code).toBe("binding_changed"); expect(f.sent).toEqual([]);
});
test("Codex native-app ownership appearing during audit fsync prevents actuation", async () => {
  let reads = 0;
  const f = await fixture({}, {
    codexThreadHeldByChatGPTApp: async () => ++reads >= 3,
    codexThreadHolderPids: async () => [100],
    innermostProcessHost: () => ({ host: "orca", terminalHandle: "term_2", paneKey: "p2", worktreeId: "w1" }),
    readOrcaAgents: async () => [{ paneKey: "p2", state: "working", agentType: "codex", worktreeId: "w1", worktreePath: "/repo", lastAssistantMessage: null }],
  });
  const response = await f.post("go", "here", "session:codex:exact-session");
  expect((await response.json()).audit.code).toBe("binding_changed"); expect(f.sent).toEqual([]);
});
test("an unverified second native process cannot be silently ignored", async () => {
  const f = await fixture({ records: async () => [record(), { ...record(101), procStart: null }] });
  expect((await (await f.post()).json()).audit.code).toBe("unverified_process"); expect(f.sent).toEqual([]);
});
test("crash between intent and outcome folds to one Unconfirmed attempt after restart", async () => {
  const f = await fixture(); await f.post();
  const intent = JSON.parse((await readFile(f.log, "utf8")).split("\n")[0]!);
  const recoveryPath = `${f.log}.recovery`, sink = await createSessionSteerAudit(recoveryPath).open();
  await sink.append(intent); await sink.close(); // Crash: deliberately no outcome.
  const restarted = createSessionSteerAudit(recoveryPath);
  expect(await restarted.read(ref, "here")).toMatchObject([{ id: intent.entry.id, outcome: "unconfirmed", code: "dispatch_started" }]);
  expect(await restarted.read(ref, "here")).toHaveLength(1);
});
test("duplicate outcomes fold to the first and are flagged, never changing intent metadata", async () => {
  const f = await fixture(), receipt = await (await f.post()).json();
  const sink = await f.audit.open();
  await sink.append({ kind: "outcome", id: receipt.audit.id, outcome: "refused", code: "contradiction", reason: "late failure" }); await sink.close();
  const entries = await f.audit.read(ref, "here");
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ ...receipt.audit, outcome: "accepted", duplicateOutcomes: 1 });
});
test("intent append failure prevents typing, not just failure to open the audit", async () => {
  const f = await fixture(), app = new Hono();
  mountSessionSteerRoutes(app, { steering: f.steering, audit: { ...f.audit, open: async () => ({ append: async () => { throw new Error("full disk"); }, close: async () => {} }) } });
  expect((await app.request(url(), { method: "POST", body: JSON.stringify({ text: "no" }) })).status).toBe(503); expect(f.sent).toEqual([]);
});
test("outcome append failure preserves the synced intent as Unconfirmed and does not retry", async () => {
  const f = await fixture(), app = new Hono(); let appends = 0;
  mountSessionSteerRoutes(app, { steering: f.steering, audit: { ...f.audit, open: async () => {
    const sink = await f.audit.open(); return { ...sink, append: async (row) => { if (++appends > 1) throw new Error("disk stopped"); await sink.append(row); } };
  } } });
  expect((await app.request(url(), { method: "POST", body: JSON.stringify({ text: "maybe sent" }) })).status).toBe(503);
  expect(f.sent).toHaveLength(1);
  expect(await f.audit.read(ref, "here")).toMatchObject([{ outcome: "unconfirmed", code: "dispatch_started" }]);
});
test("cleanup errors do not erase a durable accepted receipt or echo exception text", async () => {
  const f = await fixture(), app = new Hono();
  mountSessionSteerRoutes(app, { steering: f.steering, audit: { ...f.audit, open: async () => {
    const sink = await f.audit.open(); return { ...sink, close: async () => { await sink.close(); throw new Error("private exception"); } };
  } } });
  const response = await app.request(url(), { method: "POST", body: JSON.stringify({ text: "hi" }) });
  expect(response.status).toBe(200); expect(await response.text()).not.toContain("private exception");
  expect(f.sent).toHaveLength(1);
});

// Exercise the real upstream cascade, with every actuator replaced. This is
// contract verification, not live host input or a second discovery path.
async function runtimeContractFixture(harness: "claude" | "codex", host: "herdr" | "orca" | "tmux" | "terminal", mode: "accepted" | "failed" | "vanished" = "accepted") {
  const calls: string[] = [];
  const inputs: { target: unknown; body: string }[] = [];
  const actuator = (name: string) => async (target: unknown, body: string) => {
    calls.push(name);
    inputs.push({ target, body });
    if (mode === "failed") throw new Error("fixture host failure");
  };
  const actuators: DeliverInPlaceDeps = { promptHerdr: actuator("herdr"), promptOrca: actuator("orca"),
    promptTmux: actuator("tmux"), typeIntoTty: actuator("terminal"), typeIntoCodexApp: actuator("native-app"),
    askScoutApp: async () => { calls.push("native-app-socket"); return { ok: true, accessibility: "granted" }; } };
  const f = await fixture({
    records: async () => [{ ...record(), tmux: host === "tmux" ? { session: "live", pane: "%8", window: "@1" } : null }],
    tmux: async () => ({ socket: "/tmp/socket", pid: 100, tty: "ttys002", pane: "%8", session: "live" }),
    herdr: async () => ({ running: true, workspaces: [{ tabs: [{ panes: [{ paneId: "w1:p2", agentSession: { value: "exact-session" }, agentStatus: "working" }] }] }] }) as never,
  }, {
    codexThreadHolderPids: async () => [100],
    readProcessHostEnv: async () => host === "tmux" ? tmuxEnv : {},
    innermostProcessHost: () => host === "herdr" ? { host, session: "herdr-live", paneId: "w1:p2" }
      : host === "orca" ? { host, terminalHandle: "term_2", paneKey: "p2", worktreeId: "w1" }
      : host === "tmux" ? { host, pane: "%8" } : null,
    readOrcaAgents: async () => [{ paneKey: "p2", state: "working", agentType: harness, worktreeId: "w1", worktreePath: "/repo", lastAssistantMessage: null }],
    deliverInPlace: (input, pinned) => deliverInPlace(input, { ...pinned, ...actuators,
      ...(mode === "vanished" ? { locateProcess: async () => null } : {}) }),
  });
  return { ...f, calls, inputs, response: await f.post("  exact input\né  ", "here", `session:${harness}:exact-session`) };
}

test.each([
  ["claude", "herdr"], ["claude", "orca"], ["claude", "tmux"], ["claude", "terminal"],
  ["codex", "herdr"], ["codex", "orca"],
] as const)("real runtime contract: %s uses only its pinned %s actuator", async (harness, host) => {
  const f = await runtimeContractFixture(harness, host);
  expect(f.response.status).toBe(200); expect(f.calls).toEqual([host]);
  const target = host === "herdr" ? { session: "herdr-live", paneId: "w1:p2", status: "working" }
    : host === "orca" ? "term_2" : host === "tmux" ? "%8" : "ttys002";
  expect(f.inputs).toEqual([{ target, body: "  exact input\né  " }]);
  expect((await f.response.json()).audit).toMatchObject({ outcome: "accepted", target: { host, pid: 100 } });
});
test("real runtime contract: failed actuator never falls through to another host", async () => {
  const f = await runtimeContractFixture("claude", "orca", "failed");
  expect(f.response.status).toBe(409); expect(f.calls).toEqual(["orca"]);
  expect((await f.response.json()).audit.outcome).toBe("unconfirmed");
});
test("real runtime contract: missing pinned Codex host never opens the native app", async () => {
  const f = await runtimeContractFixture("codex", "orca", "vanished");
  expect(f.response.status).toBe(409); expect(f.calls).toEqual([]);
});
