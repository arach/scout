import { describe, expect, test } from "bun:test";

import {
  countWorkingLocalAgents,
  HOST_KEEP_AWAKE_GRACE_MS,
  HostKeepAwake,
  hostKeepAwakeEnabled,
  hostKeepAwakeGraceMs,
  type KeepAwakeHold,
} from "./host-keep-awake.js";

function fakeHolds() {
  const taken: Array<{ released: boolean; end: () => void }> = [];
  const acquire = (): KeepAwakeHold => {
    const listeners: Array<() => void> = [];
    const entry = { released: false, end: () => listeners.forEach((listener) => listener()) };
    taken.push(entry);
    return {
      release: () => { entry.released = true; },
      onEnd: (listener) => { listeners.push(listener); },
    };
  };
  return { taken, acquire };
}

describe("HostKeepAwake", () => {
  test("holds while agents work and for the grace period after", () => {
    let now = 0;
    const holds = fakeHolds();
    const keepAwake = new HostKeepAwake({ graceMs: 600_000, now: () => now, acquire: holds.acquire });

    keepAwake.update(0);
    expect(holds.taken).toHaveLength(0);

    keepAwake.update(2);
    expect(keepAwake.holding).toBe(true);
    now = 30_000;
    keepAwake.update(1);
    expect(holds.taken).toHaveLength(1);

    now = 30_000 + 599_999;
    keepAwake.update(0);
    expect(keepAwake.holding).toBe(true);

    now = 30_000 + 600_000;
    keepAwake.update(0);
    expect(keepAwake.holding).toBe(false);
    expect(holds.taken[0]!.released).toBe(true);
  });

  test("work inside the grace period restarts it", () => {
    let now = 0;
    const holds = fakeHolds();
    const keepAwake = new HostKeepAwake({ graceMs: 600_000, now: () => now, acquire: holds.acquire });
    keepAwake.update(1);
    now = 500_000;
    keepAwake.update(1);
    now = 1_000_000;
    keepAwake.update(0);
    expect(keepAwake.holding).toBe(true);
    now = 1_100_000;
    keepAwake.update(0);
    expect(keepAwake.holding).toBe(false);
  });

  test("retakes a hold that ended by itself while work continues", () => {
    const holds = fakeHolds();
    const keepAwake = new HostKeepAwake({ now: () => 0, acquire: holds.acquire });
    keepAwake.update(1);
    holds.taken[0]!.end();
    expect(keepAwake.holding).toBe(false);
    keepAwake.update(1);
    expect(holds.taken).toHaveLength(2);
    expect(keepAwake.holding).toBe(true);
  });

  test("stop releases the hold", () => {
    const holds = fakeHolds();
    const keepAwake = new HostKeepAwake({ now: () => 0, acquire: holds.acquire });
    keepAwake.update(1);
    keepAwake.stop();
    expect(holds.taken[0]!.released).toBe(true);
    expect(keepAwake.holding).toBe(false);
  });
});

describe("countWorkingLocalAgents", () => {
  const endpoints = {
    "ep-a": { agentId: "a", nodeId: "here" },
    "ep-b": { agentId: "b", nodeId: "here" },
    "ep-c": { agentId: "c", nodeId: "elsewhere" },
    "ep-d": { agentId: "d", nodeId: "here" },
    "ep-e": { agentId: "e", nodeId: "here" },
  };

  test("counts fresh, mid-task agents on this node only", () => {
    const beats = [
      { agentId: "a", activity: "executing" as const, staleAt: 200 },
      { agentId: "b", activity: "waiting_on_actor" as const, staleAt: 200 },
      { agentId: "c", activity: "working" as const, staleAt: 200 },
      { agentId: "d", activity: "waiting_for_input" as const, staleAt: 200 },
      { agentId: "e", activity: "working" as const, staleAt: 50 },
    ];
    expect(countWorkingLocalAgents(beats, endpoints, "here", 100)).toBe(2);
  });
});

describe("configuration", () => {
  test("on for darwin unless turned off", () => {
    expect(hostKeepAwakeEnabled({}, "darwin")).toBe(true);
    expect(hostKeepAwakeEnabled({ OPENSCOUT_KEEP_AWAKE: "0" }, "darwin")).toBe(false);
    expect(hostKeepAwakeEnabled({}, "linux")).toBe(false);
  });

  test("grace defaults to ten minutes", () => {
    expect(hostKeepAwakeGraceMs({})).toBe(HOST_KEEP_AWAKE_GRACE_MS);
    expect(hostKeepAwakeGraceMs({ OPENSCOUT_KEEP_AWAKE_GRACE_MS: "60000" })).toBe(60_000);
    expect(hostKeepAwakeGraceMs({ OPENSCOUT_KEEP_AWAKE_GRACE_MS: "soon" })).toBe(HOST_KEEP_AWAKE_GRACE_MS);
  });
});
