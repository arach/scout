import { describe, expect, test } from "bun:test";
import { CMD_LINE } from "./commands.ts";
import { pickRecap, recapTour, type RecapData } from "./recap.ts";
import { parseTour } from "./tour.ts";

// a small week by hand: two machines, a PR cut and merged from an ask, a cross-machine ask, a stuck ask, failures
const T0 = Date.UTC(2026, 9, 5, 0, 0), H = 36e5, M = 6e4;
const sec = (ms: number) => (ms - T0) / 1e3;
function week(): RecapData {
  const strs = ["web", "git checkout -b codex/fast-fix", "edit", "a.ts", "read", "exit 1", "gh pr create --head codex/fast-fix"];
  const ev = (t: number, k: string, sess: number, tgt = 3, add?: number, rem?: number) => [sec(t), 0, k, sess, 2, tgt, -1, add, rem];
  const events = [
    // session 0 (art): the branch is cut 5m into ask 0, edits, then the PR
    ev(T0 + 5 * M, "c", 0, 1), ev(T0 + 10 * M, "e", 0, 3, 40, 2), ev(T0 + 20 * M, "c", 0, 6),
    // session 1 (mini): a big edit for ask 1, a burst of calls for the failed ask 3
    ev(T0 + 2 * H, "e", 1, 3, 900, 100), ev(T0 + 2 * H + M, "e", 1, 3, 10, 0),
    ...Array.from({ length: 30 }, (_, i) => ev(T0 + 5 * H + i * M, "r", 1, 3)),
  ];
  return {
    now: T0 + 7 * 864e5 - H, from: T0,
    actors: [{ name: "Art", kind: "person", host: "art" }, { name: "devon", host: "art" }, { name: "mira", host: "mini" }],
    hosts: [{ name: "Art", host: "art" }, { name: "Mini", host: "mini" }],
    asks: [
      [T0, T0 + 30 * M, "c", 0, 1, "fix the header", "", "b"],
      [T0 + 2 * H - M, T0 + 2 * H + 5 * M, "c", 0, 2, "rebuild the sidebar", "", "b"],
      [T0 + 7 * 864e5 - 3 * H, null, "o", 0, 2, "check the relay", "", "b"],
      [T0 + 3 * H, null, "o", 0, 1, "an ask left open all week (stale, not stuck)", "", "b"],
      [T0 + 5 * H, T0 + 6 * H, "f", 0, 2, "port the world", "Timed out waiting for local agent turn after 3600000ms.", "b"],
      [T0 + 6 * H, null, "o", 0, 1, "my own turn", "", "t"],
    ],
    events, strs,
    sessions: [["s0", "claude", "web", []], ["s1", "codex", "web", []]],
    work: {
      0: { s: 0, t0: T0, t1: T0 + 30 * M, n: 3, files: [["a.ts", "/a.ts", 1, 0]] },
      1: { s: 1, t0: T0 + 2 * H - M, t1: T0 + 2 * H + 5 * M, n: 2, files: [["a.ts", "/a.ts", 2, 0], ["b.ts", "/b.ts", 1, 0]] },
      4: { s: 1, t0: T0 + 5 * H, t1: T0 + 6 * H, n: 30, files: [] },
    },
    dlv: [
      [T0 + H, T0 + H, "f", 1, "mira", "hello", "Stale local delivery reconciled: endpoint gone"],
      [T0 + 2 * H, T0 + 2 * H, "f", 1, "mira", "again", "Stale local delivery reconciled: endpoint gone"],
      [T0 + 7 * 864e5 - 5 * H, null, "o", 1, "ghost", "anyone there", ""],
      [T0 + 30 * M, null, "o", 1, "debris", "left in the queue all week", ""],
      [T0 + 4 * H, T0 + 4 * H, "f", 1, "mira", "real one", "Endpoint resolution failed before execution: no session"],
    ],
    errs: [[sec(T0 + 5 * H + 3 * M), 1, 4, 3, 5]],
    vcs: { prs: [[sec(T0 + 20 * M), sec(T0 + 40 * M), "", 7, "✨ Fast fix", "codex/fast-fix", null, "https://example.test/pull/7"]] },
    team: { hosts: [{ host: "art", persona: "Art" }, { host: "mini", persona: "Mini" }], sessionHost: [0, 1] },
  };
}

describe("recap picks", () => {
  const r = pickRecap(week());
  test("merge: the PR's branch leads back to the ask open when it was cut, and the caption says ask → merge", () => {
    const m = r.cats.merge[0]!;
    expect(m).toMatchObject({ ask: 0, cat: "merge", side: "hi" });
    expect(m.caption).toContain("merged 40m later");
    expect(m.title).toBe("#7 Fast fix");   // no emoji on the card
  });
  test("shipped: the completed broker ask with the most lines changed; an operator's own turn never counts", () => {
    expect(r.cats.shipped[0]).toMatchObject({ ask: 1 });
    expect(r.cats.shipped[0]!.caption).toContain("1,010 lines changed");
    expect(r.cats.shipped.some(p => p.ask === 5)).toBe(false);
  });
  test("busiest: one pick per machine, its busiest clock hour", () => {
    expect(r.cats.busiest.map(p => p.host).sort()).toEqual(["art", "mini"]);
    expect(r.cats.busiest[0]).toMatchObject({ host: "mini" });
    expect(r.cats.busiest[0]!.caption).toContain("30 tool calls");
  });
  test("handoff: completed and answered on another machine than the asker's", () => {
    expect(r.cats.handoff.map(p => p.ask)).toEqual([1]);
  });
  test("stuck: open past 30m and inside the 24h horizon at the end of the week, oldest first, the other kind second", () => {
    expect(r.cats.stuck.map(p => p.dlv ?? "a" + p.ask)).toEqual([2, "a2"]);   // the week-old ask and message are stale, not stuck
    expect(pickRecap(week(), 5, { staleMs: 8 * 864e5 }).cats.stuck.map(p => p.dlv ?? "a" + p.ask).slice(0, 2)).toEqual([3, "a3"]);
  });
  test("failed: real delivery failures grouped by reason, asks one per reason; housekeeping reconciles are not failures", () => {
    const f = r.cats.failed;
    expect(f.filter(p => p.id.startsWith("dlvs:")).map(p => p.title.split(" · ")[0])).toEqual(["1 delivery"]);
    expect(f.some(p => /Stale local delivery/.test(p.caption))).toBe(false);
    expect(f.some(p => p.ask === 4)).toBe(true);
  });
  test("burn: the calls made inside an ask that then failed", () => {
    expect(r.cats.burn[0]).toMatchObject({ ask: 4, sess: 1 });
    expect(r.cats.burn[0]!.caption).toContain("30 tool calls (1 errored)");
  });
  test("the top lists take each category before a second of any, and never the same ask twice", () => {
    expect(r.hi.map(p => p.cat)).toEqual(["merge", "shipped", "busiest", "busiest"]);   // ask 1 is shipped, so it isn't also the handoff
    expect(r.lo.slice(0, 3).map(p => p.cat)).toEqual(["stuck", "failed", "burn"]);
    const ids = [...r.hi, ...r.lo].map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the recap tour", () => {
  const r = pickRecap(week()), text = recapTour(r), t = parseTour(text, "recap");
  test("parses, on the beat grid, one :recap per pick, lowlights under :errors", () => {
    expect(t.bpm).toBe(138);
    const recaps = t.steps.filter(s => /^recap \d+$/.test(s.line));
    expect(recaps.length).toBe(r.hi.length + r.lo.length);
    const bar = 4 * 60 / 138;
    recaps.forEach((s, i) => expect(s.t).toBeCloseTo((1 + 4 * i) * bar, 3));
    const on = t.steps.find(s => s.line === "errors on")!;
    expect(on.t).toBeCloseTo(recaps[r.hi.length]!.t, 3);
  });
  test("every line is one the HUD's : grammar accepts", () => {
    for (const s of t.steps) expect({ line: s.line, ok: CMD_LINE.test(s.line) }).toEqual({ line: s.line, ok: true });
  });
});
