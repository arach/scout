import { describe, expect, test } from "bun:test";

import type { RuntimeRegistrySnapshot } from "./registry.js";
import { readMeshNodeState } from "./mesh-node-state.js";
import { withNodeCoverage, type BrokerHomeAgent } from "./broker-home-service.js";

function agent(id: string, homeNodeId: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    kind: "agent",
    definitionId: id,
    displayName: id,
    agentClass: "general",
    capabilities: [],
    wakePolicy: "never",
    homeNodeId,
    authorityNodeId: homeNodeId,
    advertiseScope: "mesh",
    ...extra,
  };
}

function endpoint(id: string, agentId: string, nodeId: string, state: string) {
  return {
    id,
    agentId,
    nodeId,
    harness: "claude",
    transport: "local",
    state,
    lastSeenAt: 1_000,
  };
}

function snapshotWith(
  agents: Record<string, unknown>,
  endpoints: Record<string, unknown> = {},
  flights: Record<string, unknown> = {},
): RuntimeRegistrySnapshot {
  return {
    nodes: {
      "arc-server-openscout": {
        id: "arc-server-openscout",
        name: "arc-server",
        hostName: "arc-server",
        meshId: "openscout",
        capabilities: ["broker", "mesh"],
      },
    },
    agents,
    endpoints,
    flights,
    conversations: {},
    messages: {},
  } as unknown as RuntimeRegistrySnapshot;
}

const displayName = (_snapshot: RuntimeRegistrySnapshot, actorId: string): string => actorId;

describe("readMeshNodeState", () => {
  test("filters exact projectRoot and agentId before all caps, never by cwd", () => {
    const agents: Record<string, unknown> = {};
    const endpoints: Record<string, unknown> = {};
    const flights: Record<string, unknown> = {};
    for (let i = 0; i < 40; i += 1) {
      const id = `other-${i}`;
      agents[id] = agent(id, "arc-server-openscout", { metadata: { projectRoot: "/other/project" } });
      endpoints[id] = { ...endpoint(id, id, "arc-server-openscout", "active"), cwd: "/wanted/project" };
      flights[id] = { id, targetAgentId: id, state: "running" };
    }
    agents.wanted = agent("wanted", "arc-server-openscout");
    endpoints.wanted = { ...endpoint("wanted-ep", "wanted", "arc-server-openscout", "active"), projectRoot: "/wanted/project" };
    flights.wanted = { id: "wanted-flight", targetAgentId: "wanted", state: "completed" };
    endpoints.orphan = endpoint("orphan", "not-registered", "arc-server-openscout", "active");
    const snapshot = snapshotWith(agents, endpoints, flights);
    const deps = { snapshot: () => snapshot, nodeId: "arc-server-openscout", meshId: "openscout", actorDisplayName: displayName };
    for (const query of [{ projectRoot: "/wanted/project" }, { agentId: "wanted" }, { projectRoot: "/wanted/project", agentId: "wanted" }]) {
      const report = readMeshNodeState(deps, query);
      expect(report.workload).toMatchObject({ total: 1, truncated: false });
      expect(report.roster.map((row) => row.id)).toEqual(["wanted"]);
      expect(report.sessions).toMatchObject({ total: 1, truncated: false });
      expect(report.sessions.items.map((row) => row.id)).toEqual(["wanted-ep"]);
      expect(report.work).toMatchObject({ total: 1, truncated: false });
      expect(report.work.items.map((row) => row.id)).toEqual(["wanted-flight"]);
      expect(report.sessions.items[0]).not.toHaveProperty("lastSeenAt");
    }
    expect(readMeshNodeState(deps, { projectRoot: "/wanted/project", agentId: "other-0" }).workload.total).toBe(0);
    expect(readMeshNodeState(deps).workload.total).toBe(41);
  });

  test("default caps are 24/16/16 and are marked truncated even when exactly hit", () => {
    const agents: Record<string, unknown> = {};
    const endpoints: Record<string, unknown> = {};
    const flights: Record<string, unknown> = {};
    for (let i = 0; i < 24; i += 1) {
      const id = `agent-${i}`;
      agents[id] = agent(id, "arc-server-openscout");
      if (i < 16) {
        endpoints[id] = endpoint(id, id, "arc-server-openscout", "active");
        flights[id] = { id, targetAgentId: id, state: "running" };
      }
    }
    const report = readMeshNodeState({ snapshot: () => snapshotWith(agents, endpoints, flights), nodeId: "arc-server-openscout", meshId: "openscout", actorDisplayName: displayName });
    expect(report.roster).toHaveLength(24);
    expect(report.sessions.items).toHaveLength(16);
    expect(report.work.items).toHaveLength(16);
    expect(report.workload.truncated).toBe(true);
    expect(report.sessions.truncated).toBe(true);
    expect(report.work.truncated).toBe(true);
  });

  test("reports node identity and the workloads homed on this node", () => {
    const snapshot = snapshotWith(
      {
        "exedev.arc-server": agent("exedev.arc-server", "arc-server-openscout"),
        "idle.arc-server": agent("idle.arc-server", "arc-server-openscout"),
      },
      {
        "ep-1": endpoint("ep-1", "exedev.arc-server", "arc-server-openscout", "active"),
        "ep-2": endpoint("ep-2", "idle.arc-server", "arc-server-openscout", "active"),
      },
      {
        "flt-1": { id: "flt-1", state: "running", targetAgentId: "exedev.arc-server" },
      },
    );

    const report = readMeshNodeState({
      snapshot: () => snapshot,
      nodeId: "arc-server-openscout",
      meshId: "openscout",
      actorDisplayName: displayName,
      now: () => 1_700,
    });

    expect(report.kind).toBe("mesh-node-state");
    expect(report.version).toBe(1);
    expect(report.nodeId).toBe("arc-server-openscout");
    expect(report.hostName).toBe("arc-server");
    expect(report.meshId).toBe("openscout");
    expect(report.observedAt).toBe(1_700);
    expect(report.workload.total).toBe(2);
    expect(report.workload.working).toBe(1);
    expect(report.workload.truncated).toBe(false);
    expect(report.roster.map((row) => row.id)).toEqual(["exedev.arc-server", "idle.arc-server"]);
    expect(report.sessions.total).toBe(2);
    expect(report.sessions.items.map((row) => row.harness)).toEqual(["claude", "claude"]);
    expect(report.work.total).toBe(1);
    expect(report.work.running).toBe(1);
    expect(report.work.items[0]?.targetAgentId).toBe("exedev.arc-server");
  });

  test("lists the repos a peer can start work in, ranked by live sessions", () => {
    const snapshot = snapshotWith(
      {
        "a.arc": agent("a.arc", "arc-server-openscout", { metadata: { projectRoot: "/home/a/renders/arsenal-x" } }),
        "b.arc": agent("b.arc", "arc-server-openscout", { metadata: { projectRoot: "/home/a/dev/peal" } }),
        "c.arc": agent("c.arc", "arc-server-openscout", { metadata: { projectRoot: "/home/a/dev/peal" } }),
        "elsewhere": agent("elsewhere", "other-node", { metadata: { projectRoot: "/home/a/dev/secret" } }),
      },
      {
        "ep-1": { ...endpoint("ep-1", "a.arc", "arc-server-openscout", "active"), projectRoot: "/home/a/renders/arsenal-x", cwd: "/home/a/renders/arsenal-x/frames" },
      },
    );

    const report = readMeshNodeState({
      snapshot: () => snapshot,
      nodeId: "arc-server-openscout",
      meshId: "openscout",
      actorDisplayName: displayName,
    });

    expect(report.projects?.total).toBe(2);
    expect(report.projects?.truncated).toBe(false);
    expect(report.projects?.items).toEqual([
      { root: "/home/a/renders/arsenal-x", name: "arsenal-x", agents: 1, liveSessions: 1 },
      { root: "/home/a/dev/peal", name: "peal", agents: 2, liveSessions: 0 },
    ]);
    expect(JSON.stringify(report.projects)).not.toContain("frames");
    expect(JSON.stringify(report.projects)).not.toContain("secret");
  });

  test("scopes sessions and work to this node's own agents", () => {
    const snapshot = snapshotWith(
      {
        "local.agent": agent("local.agent", "arc-server-openscout"),
        "somewhere.else": agent("somewhere.else", "ocean-iron-openscout"),
      },
      {
        "ep-1": endpoint("ep-1", "local.agent", "arc-server-openscout", "active"),
        // A session this broker knows about, running on another machine.
        "ep-2": endpoint("ep-2", "somewhere.else", "ocean-iron-openscout", "active"),
      },
      {
        "flt-1": { id: "flt-1", state: "running", targetAgentId: "local.agent" },
        "flt-2": { id: "flt-2", state: "running", targetAgentId: "somewhere.else" },
      },
    );

    const report = readMeshNodeState({
      snapshot: () => snapshot,
      nodeId: "arc-server-openscout",
      meshId: "openscout",
      actorDisplayName: displayName,
    });

    expect(report.sessions.items.map((row) => row.id)).toEqual(["ep-1"]);
    expect(report.work.items.map((row) => row.id)).toEqual(["flt-1"]);
  });

  test("clips a long work summary rather than carrying a log across the mesh", () => {
    const snapshot = snapshotWith(
      { "local.agent": agent("local.agent", "arc-server-openscout") },
      {},
      { "flt-1": { id: "flt-1", state: "running", targetAgentId: "local.agent", summary: "x".repeat(900), output: "SECRET OUTPUT" } },
    );

    const report = readMeshNodeState({
      snapshot: () => snapshot,
      nodeId: "arc-server-openscout",
      meshId: "openscout",
      actorDisplayName: displayName,
    });

    expect(report.work.items[0]?.summary?.length).toBe(160);
    expect(JSON.stringify(report)).not.toContain("SECRET OUTPUT");
  });

  test("never reports this broker's second-hand view of another node's agents", () => {
    const snapshot = snapshotWith({
      "local.agent": agent("local.agent", "arc-server-openscout"),
      "somewhere.else": agent("somewhere.else", "ocean-iron-openscout"),
    });

    const report = readMeshNodeState({
      snapshot: () => snapshot,
      nodeId: "arc-server-openscout",
      meshId: "openscout",
      actorDisplayName: displayName,
    });

    expect(report.roster.map((row) => row.id)).toEqual(["local.agent"]);
    expect(report.workload.total).toBe(1);
  });

  test("bounds the roster but keeps the totals exact", () => {
    const agents: Record<string, unknown> = {};
    for (let i = 0; i < 40; i += 1) {
      agents[`a${String(i).padStart(2, "0")}`] = agent(`a${String(i).padStart(2, "0")}`, "arc-server-openscout");
    }

    const report = readMeshNodeState({
      snapshot: () => snapshotWith(agents),
      nodeId: "arc-server-openscout",
      meshId: "openscout",
      actorDisplayName: displayName,
      rosterLimit: 5,
    });

    expect(report.roster).toHaveLength(5);
    expect(report.workload.total).toBe(40);
    expect(report.workload.truncated).toBe(true);
    expect(report.sessions.total).toBe(0);
    expect(report.work.total).toBe(0);
  });

  test("carries no conversation, message or endpoint address material", () => {
    const snapshot = snapshotWith(
      { "local.agent": agent("local.agent", "arc-server-openscout") },
      { "ep-1": { ...endpoint("ep-1", "local.agent", "arc-server-openscout", "active"), address: "tcp://10.0.0.4:4321" } },
    );
    (snapshot as unknown as { messages: Record<string, unknown> }).messages = {
      "msg-1": { id: "msg-1", body: "secret", actorId: "local.agent", conversationId: "c1", createdAt: 1 },
    };

    const report = readMeshNodeState({
      snapshot: () => snapshot,
      nodeId: "arc-server-openscout",
      meshId: "openscout",
      actorDisplayName: displayName,
    });

    const wire = JSON.stringify(report);
    expect(wire).not.toContain("secret");
    expect(wire).not.toContain("10.0.0.4");
    expect(wire).not.toContain("conversation");
  });
});

describe("withNodeCoverage", () => {
  function homeAgent(id: string, homeNodeId: string | null): BrokerHomeAgent {
    return {
      id,
      title: id,
      role: null,
      summary: null,
      projectRoot: null,
      homeNodeId,
      authorityNodeId: homeNodeId,
      state: "available",
      reachable: true,
      statusLabel: "ready",
      statusDetail: null,
      activeTask: null,
      lastSeenAt: null,
    };
  }

  test("keeps one representative per node when the cap would drop a whole machine", () => {
    // Exactly #906's shape: a busy local broker plus one card per remote node,
    // ranked last, with a cap that used to slice them away.
    const ranked = [
      ...Array.from({ length: 10 }, (_, i) => homeAgent(`local-${i}`, "arts-mini-openscout")),
      homeAgent("remote-arc", "arc-server-openscout"),
      homeAgent("remote-ocean", "ocean-iron-openscout"),
    ];

    const kept = withNodeCoverage(ranked, 5);

    expect(kept).toHaveLength(5);
    expect(kept.map((row) => row.id)).toContain("remote-arc");
    expect(kept.map((row) => row.id)).toContain("remote-ocean");
    expect(new Set(kept.map((row) => row.homeNodeId)).size).toBe(3);
  });

  test("preserves the input ranking among the agents it keeps", () => {
    const ranked = [
      homeAgent("a", "n1"),
      homeAgent("b", "n1"),
      homeAgent("c", "n2"),
      homeAgent("d", "n3"),
    ];

    expect(withNodeCoverage(ranked, 3).map((row) => row.id)).toEqual(["a", "c", "d"]);
  });

  test("is a pass-through when everything fits", () => {
    const ranked = [homeAgent("a", "n1"), homeAgent("b", "n2")];
    expect(withNodeCoverage(ranked, 10).map((row) => row.id)).toEqual(["a", "b"]);
  });

  test("does not reserve a slot for cards with no node identity", () => {
    const ranked = [
      homeAgent("x", null),
      homeAgent("y", null),
      homeAgent("z", "n9"),
    ];
    expect(withNodeCoverage(ranked, 2).map((row) => row.id)).toEqual(["x", "z"]);
  });
});
