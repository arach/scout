import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import type { NodeDefinition } from "@openscout/protocol";
import { RoutingStore, resolveRoute, type RouteTarget } from "@openscout/runtime/routing";
import { loadScoutCheck, type ScoutCheckDeps } from "./check.ts";
import { renderScoutCheck } from "../../../cli/commands/recent.ts";
import type { ScoutRecentOptions, ScoutRecentReport } from "./recent.ts";

let support: string;
let previousSupport: string | undefined;
beforeEach(() => {
  previousSupport = process.env.OPENSCOUT_SUPPORT_DIRECTORY;
  support = mkdtempSync(join(tmpdir(), "scout-check-test-"));
  process.env.OPENSCOUT_SUPPORT_DIRECTORY = support;
  writeFileSync(join(support, "settings.json"), JSON.stringify({ knowledgeIndexEnabled: true }));
});
afterEach(() => {
  rmSync(support, { recursive: true, force: true });
  if (previousSupport === undefined) delete process.env.OPENSCOUT_SUPPORT_DIRECTORY; else process.env.OPENSCOUT_SUPPORT_DIRECTORY = previousSupport;
});
const node = { id: "mini-id", name: "mini", hostName: "arts-mini.local" } as NodeDefinition;
const empty: ScoutRecentReport = { since: null, scope: "live fixture", machines: [] };
function fixture(names: string[][] = [["hex"]]) {
  const store = new RoutingStore(":memory:");
  names.forEach((names, index) => {
    const t: RouteTarget = { id: `p${index}`, kind: "project", projectRoot: `/repo/${index}`, nodeId: node.id, names, projectKey: null, agentId: null, harness: null, sessionId: null };
    store.putTarget(t, Date.now());
  });
  store.finish(Date.now()); store.setMeta("nodeId", node.id);
  const calls: ScoutRecentOptions[] = [];
  const deps: ScoutCheckDeps = { store, inventory: { localNode: node, knownNodes: { [node.id]: node } },
    recent: async (options) => { calls.push(options); return empty; } };
  return { store, calls, deps };
}

describe("check topic to live read", () => {
  test("no topic is the unchanged live read and never opens the routing store", async () => {
    const calls: ScoutRecentOptions[] = [];
    const result = await loadScoutCheck({ machine: "mini", since: 42 }, {
      readLocal: async () => { throw new Error("must not load inventory twice"); },
      resolve: () => { throw new Error("must not resolve"); },
      recent: async (input) => { calls.push(input); return empty; },
    });
    expect(result).toBe(empty); expect(calls).toEqual([{ machine: "mini", since: 42 }]);
  });
  test("known trailing on machine resolves against fresh inventory and filters before live caps", async () => {
    const { store, calls, deps } = fixture();
    try {
      const result = await loadScoutCheck({ topic: "hex on mini", since: 42 }, deps);
      expect(calls).toEqual([{ since: 42, machine: node.id, projectRoot: "/repo/0" }]);
      expect("routing" in result && result.routing.topic).toBe("hex");
      expect(renderScoutCheck(result).split("\n")[0]).toBe("hex → project 0 @ mini-id (1.00)");
    } finally { store.close(); }
  });
  test("unknown suffix and filler remain literal names, not machine or kind syntax", async () => {
    const { store, calls, deps } = fixture([["work on hex"], ["world week"], ["agent layer"], ["mini music"]]);
    try {
      for (const topic of ["work on hex", "world week", "agent layer", "mini music"]) {
        const result = await loadScoutCheck({ topic }, deps);
        expect("routing" in result && result.routing.topic).toBe(topic);
        expect("routing" in result && result.routing.outcome).toBe("resolved");
      }
      expect(calls).toHaveLength(4);
    } finally { store.close(); }
  });
  test("ties read every shortlisted root, none reads nothing, machine-only stays live", async () => {
    const { store, calls, deps } = fixture([["hex"], ["hex"], ["hex"], ["hex"]]);
    try {
      const result = await loadScoutCheck({ topic: "hex" }, deps);
      expect("routing" in result && result.routing.outcome).toBe("candidates");
      expect(calls).toHaveLength(3);
      calls.length = 0;
      await loadScoutCheck({ topic: "nonexistent" }, deps); expect(calls).toHaveLength(0);
      await loadScoutCheck({ topic: "on mini" }, deps); expect(calls).toEqual([{ nodeIds: [node.id] }]);
      await expect(loadScoutCheck({ machine: "not-known", topic: "hex" }, deps)).rejects.toThrow("Unknown machine");
    } finally { store.close(); }
  });
  test("near ties read together but a distant candidate is omitted", async () => {
    const { store, calls, deps } = fixture([["hex"], ["hex"], ["hex"]]);
    deps.resolve = (s, query, options) => {
      const result = resolveRoute(s, query, options);
      result.candidates.forEach((c, i) => { c.score = [1, 0.85, 0.3][i]!; });
      return result;
    };
    try { await loadScoutCheck({ topic: "hex" }, deps); expect(calls.map((c) => c.projectRoot)).toEqual(["/repo/0", "/repo/1"]); }
    finally { store.close(); }
  });
});

test("a stale indexed node produces a per-candidate failure without discarding good live reads", async () => {
  const { store, deps } = fixture([["hex"], ["hex"]]);
  deps.recent = async (options) => {
    if (options.projectRoot === "/repo/0") throw new Error("Unknown machine from stale routing index");
    return empty;
  };
  try {
    const result = await loadScoutCheck({ topic: "hex" }, deps);
    if (!("activity" in result)) throw new Error("missing shortlist");
    expect(result.activity).toHaveLength(2);
    expect(result.activity[0]?.live.machines[0]).toMatchObject({ status: "unavailable", error: "Unknown machine from stale routing index" });
    expect(result.activity[1]?.live).toBe(empty);
  } finally { store.close(); }
});

test("disabled topic check does not open cached routing or probe live machines", async () => {
  writeFileSync(join(support, "settings.json"), "{}");
  const result = await loadScoutCheck({ topic: "cached topic" }, {
    resolve: () => { throw new Error("must not resolve"); },
    readLocal: async () => { throw new Error("must not probe"); },
  });
  expect(result).toMatchObject({ activity: [], routing: { outcome: "none", candidates: [] } });
  expect("routing" in result && result.routing.reason).toContain("index is off");
});
