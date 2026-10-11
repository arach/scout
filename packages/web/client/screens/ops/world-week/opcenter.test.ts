import { describe, expect, test } from "bun:test";
import { VERBS, TRACED, answerFrozen, canSend, groupFrame, inferVerb, jevFramePayload, modeLine, payloadFor, silentRule, type Target, type Unit } from "./opcenter.ts";

const T: Target = { name: "MINI/FAB", harness: "claude", lane: "openscout", root: "~/dev/openscout", host: "mini", hostName: "mini", agentId: "fab.mini", agentName: "fab", sessionId: "s-1" };

describe("verbs", () => {
  test("Ask is the default; Send only when the words say so", () => {
    for (const w of ["why is the build red", "can you check the tests", "send me the summary later?"]) {
      // "send me" leads with send: the one exception the words make on purpose
      if (w.startsWith("send")) continue;
      expect(inferVerb(w).verb).toBe("ask");
    }
    expect(inferVerb("type it in: yes, continue").verb).toBe("send");
    expect(inferVerb("send it directly: continue").verb).toBe("send");
    expect(inferVerb("please continue directly").verb).toBe("send");
    expect(inferVerb("ask it why the tests fail").verb).toBe("ask");
    expect(inferVerb("ask it why the tests fail").text).toBe("why the tests fail");
    expect(inferVerb("report on this").verb).toBe("report");
    expect(inferVerb("dispatch someone to fix the lint").verb).toBe("dispatch");
  });
  test("the traced / direct split is fixed", () => {
    expect(VERBS.filter(v => TRACED[v])).toEqual(["ask", "report", "dispatch"]);
    expect(silentRule("ask", "30m")).toContain("Never falls back to direct");
    expect(silentRule("send", "30m")).toContain("Never falls back to Ask");
  });
});

describe("payloads", () => {
  test("each verb has its own route; Send never borrows Ask's", () => {
    expect(payloadFor("ask", T, "why").url).toBe("/api/ask");
    expect(payloadFor("ask", T, "why").body).toMatchObject({ targetAgentId: "fab.mini", body: "why" });
    expect(payloadFor("report", T, "").url).toBe("/api/scoutbot/chat");
    expect(payloadFor("dispatch", T, "fix lint", { selfHost: "mini" }).url).toBe("/api/sessions");
    const send = payloadFor("send", T, "continue");
    expect(send.url).toBeNull();
    expect(send.missing).toContain("/api/sessions/send");
    expect(send.body).toMatchObject({ sessionId: "s-1", delivery: "in_place_only" });
    expect(canSend(send, true)).toBe(false);
  });
  test("remote dispatch needs a machine id; without one it is a stub, never a local start", () => {
    const p = payloadFor("dispatch", T, "x", { selfHost: "arts-mini" });
    expect(p.url).toBeNull();
    expect(payloadFor("dispatch", T, "x", { selfHost: "arts-mini", machineId: "m1" }).url).toBe("/api/hosts/m1/api/sessions");
  });
  test("dry run unless live", () => {
    const p = payloadFor("ask", T, "why");
    expect(canSend(p, false)).toBe(false);
    expect(canSend(p, true)).toBe(true);
  });
  test("an Ask without a Scout agent id is a stub, never a guess by lane name", () => {
    const p = payloadFor("ask", { ...T, agentId: null }, "why");
    expect(p.missing).toBeTruthy();
    expect(canSend(p, true)).toBe(false);
  });
  test("review's STUB line is one short line", () => {
    expect(modeLine(payloadFor("ask", { ...T, agentId: null }, "why"), false)).toBe("STUB · no agent id · nothing sent");
    expect(modeLine(payloadFor("send", T, "go"), true)).toBe("STUB · no in-place send route · nothing sent");
    expect(modeLine(payloadFor("ask", T, "why"), false)).toBe("DRY RUN · would POST /api/ask");
  });
});

describe("freeze grouping", () => {
  const t = 10 * 3600e3;
  const units: Unit[] = [
    { key: "openscout|mini", lane: "openscout", host: "mini", hostName: "mini", calls: 40, last: t - 60e3, stuck: 0, failed: 0 },
    { key: "talkie|mini", lane: "talkie", host: "mini", hostName: "mini", calls: 3, last: t - 5 * 3600e3, stuck: 2, stuckSince: t - 45 * 60e3, failed: 0 },
    { key: "fab|arts-mini", lane: "fab", host: "arts-mini", hostName: "arts-mini", calls: 9, last: t - 2 * 60e3, stuck: 0, failed: 1 },
    { key: "docs|arts-mini", lane: "docs", host: "arts-mini", hostName: "arts-mini", calls: 2, last: t - 3 * 3600e3, stuck: 0, failed: 0 },
  ];
  test("deterministic: trouble first, the same frame groups the same way in any order", () => {
    const a = groupFrame(units, t), b = groupFrame([...units].reverse(), t);
    expect(a).toEqual(b);
    expect(a.map(g => g.cls)).toEqual(["stuck", "failed", "working", "quiet"]);
    expect(a[0]!.label).toBe("C1 · stuck 45m · mini · talkie");
  });
  test("a question about the frame is answered from the groups, with the hull to light", () => {
    const g = groupFrame(units, t);
    expect(answerFrozen("what's stuck?", g, t).lit).toBe("C1");
    expect(answerFrozen("anything failing", g, t).lit).toBe("C2");
    expect(answerFrozen("what is arts-mini doing", g, t).lit).not.toBeNull();
  });
  test("the jev payload carries counts, never prompt text", () => {
    const body = jevFramePayload(groupFrame(units, t), { t, from: 0, to: t, lanes: ["openscout"] });
    const json = JSON.stringify(body);
    expect(json).not.toContain("task");
    expect(body.frame[0]).toEqual({ id: "C1", cls: "stuck", host: "mini", lanes: ["talkie"], calls: 3, stuck: 2, failed: 0 });
  });
  test("a failure in a catch-all lane is named in plain words, never 'other · 33'", () => {
    const at = t - 48 * 60e3;
    const u: Unit[] = [{ key: "other · 33|arts-mini", lane: "other · 33", host: "arts-mini", hostName: "arts-mini", calls: 0, last: null, stuck: 0, failed: 1,
      trouble: [{ cls: "failed", who: "lattices", what: "ask", at, why: "it went stale and the broker closed it" }] }];
    const g = groupFrame(u, t);
    expect(g[0]!.label).toBe("C1 · 1 failed · arts-mini · lattices");
    const a = answerFrozen("what failed in this frame", g, t);
    expect(a.lit).toBe("C1");
    expect(a.text).not.toContain("other");
    expect(a.text).not.toContain("C1:");
    expect(a.text).toContain("lattices");
    expect(a.text).toContain("stale");
    expect(JSON.stringify(jevFramePayload(g, { t, from: 0, to: t, lanes: [] }))).not.toContain("stale");
  });
});
