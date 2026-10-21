import { expect, test } from "bun:test";
import type { AgentEndpoint } from "@openscout/protocol";
import { isLocalAgentEndpointAlive, isLocalAgentEndpointAliveAsync } from "./local-agents.js";

const external: AgentEndpoint = {
  id: "external-with-no-local-process", agentId: "cloud", nodeId: "local",
  harness: "devin", transport: "http", state: "idle", sessionId: "no-such-tmux-session",
  metadata: { externalSession: true, nativeSessionId: "devin-abcdef" },
};

test("external receive transports do not require a local tmux process", async () => {
  for (const transport of ["http", "mcp_poll", "devin_cloud_cli"] as const) {
    const endpoint = { ...external, transport };
    expect(isLocalAgentEndpointAlive(endpoint)).toBe(true);
    expect(await isLocalAgentEndpointAliveAsync(endpoint)).toBe(true);
    for (const state of ["offline", "failed", "stopped"] as const) {
      expect(isLocalAgentEndpointAlive({ ...endpoint, state })).toBe(false);
    }
  }
  // A generic HTTP record does not gain receive capability just from its state.
  expect(isLocalAgentEndpointAlive({ ...external, metadata: {} })).toBe(false);
});


test("receive liveness and broker classification share one state/transport table", async () => {
  const { localEndpointCanReceive } = await import("./broker-unavailable-target-service.js");
  const { classifyEndpoint } = await import("./broker-endpoint-selection.js");
  const states = ["registered", "attaching", "waking", "offline", "idle", "active", "waiting", "working",
    "unreachable", "failed", "superseded", "stopped", "online"];
  const receiving = new Set(["idle", "active", "waiting", "working", "online"]);
  const routes: AgentEndpoint[] = [
    ...(["http", "mcp_poll", "devin_cloud_cli"] as const).map(transport => ({ ...external, transport })),
    { ...external, transport: "http", metadata: { a2aExecutionUrl: "https://agent.example.test/rpc" } },
  ];
  const unexpectedProbe = () => { throw new Error("receive transport must not probe a local process"); };
  for (const route of routes) for (const state of states) {
    // "online" is a supported legacy runtime record, not a wire AgentState.
    const candidate = { ...route, state } as AgentEndpoint;
    const expected = receiving.has(state) || (route.transport === "mcp_poll" && state === "registered");
    expect(localEndpointCanReceive(candidate, unexpectedProbe)).toBe(expected);
    expect(isLocalAgentEndpointAlive(candidate)).toBe(expected);
    expect(await isLocalAgentEndpointAliveAsync(candidate)).toBe(expected);
    expect(classifyEndpoint(candidate).reachable).toBe(expected);
  }
  for (const transport of ["tmux", "codex_app_server", "http", "mcp_poll"] as const) {
    const local = { ...external, transport, metadata: {} };
    for (const alive of [false, true]) {
      let probes = 0;
      expect(localEndpointCanReceive(local, actual => { expect(actual).toBe(local); probes++; return alive; })).toBe(alive);
      expect(probes).toBe(1);
    }
  }
});
