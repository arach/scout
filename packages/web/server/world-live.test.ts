import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiveFrame } from "./world-live.ts";
import { emptyBatch, fromOtlp, toOtlp } from "./world-otlp.ts";
import { readAppended } from "./world-tail.ts";
import type { TeamWeekPayload } from "./world-team.ts";

const dir = () => mkdtempSync(join(tmpdir(), "world-live-"));
const SECRET = "sk-ant-api03-abcdefghijklmnopQRSTUV0123456789";

describe("readAppended: per-file byte offsets", () => {
  test("reads only complete lines; a partial last line waits for its newline", async () => {
    const d = dir(), f = join(d, "a.jsonl");
    try {
      writeFileSync(f, '{"a":1}\n{"b":2}\n{"c":');
      const r1 = (await readAppended(f, undefined))!;
      expect(r1.lines).toEqual(['{"a":1}', '{"b":2}']);
      expect(r1.next.off).toBe(16);
      expect((await readAppended(f, r1.next))!.lines).toEqual([]);
      appendFileSync(f, '3}\n{"d":4}\n');
      const r2 = (await readAppended(f, r1.next))!;
      expect(r2.lines).toEqual(['{"c":3}', '{"d":4}']);
      expect(r2.reset).toBe(false);
      expect(r2.bytes).toBe(r2.next.off - r1.next.off);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
  test("a truncated file starts over from byte 0", async () => {
    const d = dir(), f = join(d, "a.jsonl");
    try {
      writeFileSync(f, '{"a":1}\n{"b":2}\n');
      const r1 = (await readAppended(f, undefined))!;
      writeFileSync(f, '{"z":9}\n');
      const r2 = (await readAppended(f, r1.next))!;
      expect(r2.reset).toBe(true);
      expect(r2.lines).toEqual(['{"z":9}']);
      expect(r2.next.off).toBe(8);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
  test("a rotated file (new inode at the same path) starts over, even when longer", async () => {
    const d = dir(), f = join(d, "a.jsonl"), g = join(d, "b.jsonl");
    try {
      writeFileSync(f, '{"a":1}\n');
      const r1 = (await readAppended(f, undefined))!;
      writeFileSync(g, '{"x":1}\n{"y":2}\n{"z":3}\n'); renameSync(g, f);
      const r2 = (await readAppended(f, r1.next))!;
      expect(r2.reset).toBe(true);
      expect(r2.lines).toEqual(['{"x":1}', '{"y":2}', '{"z":3}']);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
  test("one line bigger than a chunk is skipped, and its tail is not read as a line", async () => {
    const d = dir(), f = join(d, "a.jsonl");
    try {
      writeFileSync(f, "x".repeat(40) + '\n{"ok":1}\n');
      const r1 = (await readAppended(f, undefined, 16))!;
      expect(r1.lines).toEqual([]); expect(r1.next.skip).toBe(1); expect(r1.next.off).toBe(16);
      // the next 16 bytes are still inside the giant line: skipped again
      const r2 = (await readAppended(f, r1.next, 16))!;
      expect(r2.lines).toEqual([]); expect(r2.next.skip).toBe(1);
      const r3 = (await readAppended(f, r2.next, 64))!;
      expect(r3.lines).toEqual(['{"ok":1}']);
      expect(r3.next.skip).toBeUndefined();
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
  test("a missing file is null, not an error", async () => {
    expect(await readAppended(join(tmpdir(), "world-live-none", "nope.jsonl"), undefined)).toBeNull();
  });
});

describe("redaction on deltas", () => {
  const now = Date.now();
  test("our own rows round-trip through OTLP with secrets redacted", () => {
    const b = emptyBatch("mini"); b.persona = "Devon";
    b.sessions.push({ sid: "abcd1234", h: "claude" });
    b.raw.push([now - 1000, "/Users/x/dev/p", "claude", "abcd1234", "Bash", `curl -H "Authorization: Bearer ${SECRET}" x`]);
    b.inbound.push([now - 2000, "abcd1234", `use key ${SECRET} please`]);
    const out = fromOtlp(toOtlp(b), { now });
    const json = JSON.stringify(out.batches);
    expect(json).not.toContain(SECRET);
    expect(out.batches[0]!.host).toBe("mini");
    expect(out.batches[0]!.raw).toHaveLength(1);
    expect(out.batches[0]!.inbound[0]![2]).toContain("sk-ant-•••");
  });
  test("an outside exporter's unredacted attributes and bodies are redacted on the way in", () => {
    const t = `${now - 500}000000`;
    const req = {
      resourceSpans: [{ resource: { attributes: [{ key: "service.name", value: { stringValue: "claude-code" } }, { key: "host.name", value: { stringValue: "air" } }] },
        scopeSpans: [{ spans: [{ name: "execute_tool Bash", startTimeUnixNano: t, endTimeUnixNano: t, attributes: [
          { key: "gen_ai.operation.name", value: { stringValue: "execute_tool" } }, { key: "gen_ai.tool.name", value: { stringValue: "Bash" } },
          { key: "gen_ai.conversation.id", value: { stringValue: "ffff0000-1111" } }, { key: "gen_ai.tool.call.arguments", value: { stringValue: `export ANTHROPIC_API_KEY=${SECRET}` } }] }] }] }],
      resourceLogs: [{ resource: { attributes: [{ key: "service.name", value: { stringValue: "claude-code" } }, { key: "host.name", value: { stringValue: "air" } }] },
        scopeLogs: [{ logRecords: [{ timeUnixNano: t, body: { stringValue: `my token is ${SECRET}` }, attributes: [{ key: "event.name", value: { stringValue: "gen_ai.user.message" } }, { key: "gen_ai.conversation.id", value: { stringValue: "ffff0000-1111" } }] }] }] }],
    };
    const out = fromOtlp(req, { now });
    expect(out.used).toBe(2);
    expect(JSON.stringify(out.batches)).not.toContain(SECRET);
  });
  test("one Claude Code tool call sent as a span and as a log is one dot", () => {
    const t = `${now - 400}000000`, res = [{ key: "service.name", value: { stringValue: "claude-code" } }];
    const id = { key: "tool_use_id", value: { stringValue: "toolu_dup_test_1" } }, sess = { key: "session.id", value: { stringValue: "aaaa1111-2222" } };
    const spans = fromOtlp({ resourceSpans: [{ resource: { attributes: res }, scopeSpans: [{ spans: [
      { name: "claude_code.tool", startTimeUnixNano: t, attributes: [{ key: "tool_name", value: { stringValue: "Read" } }, id, sess] },
      { name: "claude_code.tool.execution", startTimeUnixNano: t, attributes: [{ key: "tool_name", value: { stringValue: "Read" } }, sess] }] }] }] }, { now });
    const logs = fromOtlp({ resourceLogs: [{ resource: { attributes: res }, scopeLogs: [{ logRecords: [{ timeUnixNano: t, attributes: [{ key: "event.name", value: { stringValue: "tool_result" } }, { key: "tool_name", value: { stringValue: "Read" } }, id, sess] }] }] }] }, { now });
    expect(spans.used).toBe(1); expect(logs.used).toBe(0);
    expect(spans.batches[0]!.host).toBe("unknown-host");
  });
  test("rows older than the window or from the future are skipped", () => {
    const b = emptyBatch("mini");
    b.raw.push([now - 30 * 864e5, "/p", "claude", "s1", "Read", "a"], [now + 60 * 60e3, "/p", "claude", "s1", "Read", "b"]);
    const out = fromOtlp(toOtlp(b), { now });
    expect(out.used).toBe(0); expect(out.skipped).toBe(2);
  });
});

describe("LiveFrame: deltas indexed against the seed", () => {
  const from = Date.now() - 36e5;
  const seed = (): TeamWeekPayload => ({ from, now: from + 3 * 36e5, strs: ["~", "Read"], actors: [], events: [], sessions: [], asks: [], askIds: [], roots: {},
    team: { lanes: ["~"], sessionHost: [], hosts: [] } } as unknown as TeamWeekPayload);
  const frame = () => new LiveFrame(seed(), [{ host: "mini", persona: "Devon", ssh: "mini", platform: "macos" } as any], () => "/Users/x", () => ({}));
  test("a first call makes a session and a dot; the bases match what the page holds", () => {
    const f = frame(), b = emptyBatch("mini");
    b.sessions.push({ sid: "abcd1234", h: "claude" });
    b.raw.push([from + 60e3, "/Users/x/dev/p", "claude", "abcd1234", "Read", "/Users/x/dev/p/a.ts"]);
    const d = f.apply(b)!;
    expect(d.strBase).toBe(2); expect(d.sessBase).toBe(0); expect(d.askBase).toBe(0); expect(d.actorBase).toBe(0);
    expect(d.sessions).toHaveLength(1); expect(d.sessionHost).toEqual([0]);
    expect(d.events).toHaveLength(1);
    const [sec, , k, si, name, tgt] = d.events[0]!;
    expect(sec).toBe(60); expect(k).toBe("r"); expect(si).toBe(0);
    const strs = ["~", "Read", ...d.strs];
    expect(strs[name as number]).toBe("Read");   // reuses the seed's string
    expect(strs[tgt as number]).toBe("~/dev/p/a.ts");   // home folded
    expect(d.teamHosts).toEqual([]);
  });
  test("the next delta counts on from the last one; nothing new is null", () => {
    const f = frame(), b = emptyBatch("mini");
    b.raw.push([from + 60e3, "/p", "claude", "abcd1234", "Read", "x"]);
    const d1 = f.apply(b)!;
    const b2 = emptyBatch("mini"); b2.raw.push([from + 120e3, "/p", "claude", "abcd1234", "Edit", "y", [3, 1]]);
    const d2 = f.apply(b2)!;
    expect(d2.strBase).toBe(2 + d1.strs.length);
    expect(d2.sessBase).toBe(1); expect(d2.sessions).toEqual([]);
    expect(d2.events[0]!.slice(7)).toEqual([3, 1]);
    expect(f.apply(emptyBatch("mini"))).toBeNull();
  });
  test("an operator turn opens an ask before its calls; it closes once the session goes quiet", () => {
    const f = frame(), b = emptyBatch("mini");
    b.inbound.push([from + 30e3, "abcd1234", "fix the build"]);
    b.raw.push([from + 60e3, "/p", "claude", "abcd1234", "Bash", "bun test"]);
    const d = f.apply(b)!;
    expect(d.asks).toHaveLength(1); expect(d.asks[0]![2]).toBe("o"); expect(d.turns).toHaveLength(1);
    const t = f.tick(from + 60e3 + 21 * 60e3)!;
    expect(t.askUpdates).toEqual([[0, from + 60e3, "c"]]);
  });
  test("a machine the seed didn't know arrives as a team host (the page re-seeds)", () => {
    const f = frame(), b = emptyBatch("archie");
    b.raw.push([from + 60e3, "/p", "codex", "s1", "exec", "ls"]);
    expect(f.apply(b)!.teamHosts.map(h => h.host)).toEqual(["archie"]);
  });
  test("broker asks are drawn once and updated by id when they finish", () => {
    const f = frame(), b = emptyBatch("mini");
    b.asks.push({ id: "inv-1", created_at: from + 10e3, completed_at: null, state: "running", requester_id: "op", target_agent_id: "ag", target_node: null, task: `deploy with ${SECRET}`, error: null });
    const d1 = f.apply(b)!;
    expect(d1.asks).toHaveLength(1);
    const b2 = emptyBatch("mini");
    b2.asks.push({ ...b.asks[0]!, completed_at: from + 20e3, state: "completed" });
    const d2 = f.apply(b2)!;
    expect(d2.asks).toEqual([]); expect(d2.askUpdates).toEqual([[0, from + 20e3, "c"]]);
  });
});
