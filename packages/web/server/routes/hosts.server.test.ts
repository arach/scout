import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { MachineRecord } from "@openscout/protocol";
import type { MachineReadiness } from "@openscout/runtime/system-probes";

import { createReadinessStore, machineWayIn } from "../core/machines/readiness.ts";
import { mountMeshRoutes, type MeshRouteDeps } from "./mesh.ts";

function machine(id: string, patch: Partial<MachineRecord> = {}): MachineRecord {
  return {
    id,
    displayName: null,
    name: id,
    platform: "macos",
    identityKeys: [],
    isSelf: false,
    hostNames: [],
    addresses: [],
    macAddresses: [],
    capabilities: [],
    routes: [],
    evidence: [],
    pinned: false,
    firstSeenAt: 1,
    lastSeenAt: 1,
    ...patch,
  };
}

const SELF = machine("mach-self", { isSelf: true });
const MINI = machine("mach-mini", {
  hostNames: ["mini.tail1e8e67.ts.net"],
  sshTargets: [{ alias: "mini", aliases: ["mini"], hostName: "mini.tail1e8e67.ts.net", configPath: "~/.ssh/config" }],
});
const LAB = machine("mach-lab", {
  hostNames: ["studio-lab"],
  evidence: [{
    kind: "tailnet",
    observedAt: 1,
    peerId: "p1",
    dnsName: "studio-lab.tail1e8e67.ts.net.",
    addresses: [],
    online: true,
  }],
});
const NEIGHBOUR = machine("mach-lan", { macAddresses: ["2e:18:2a:be:39:7d"] });
const ALL = [SELF, MINI, LAB, NEIGHBOUR];

function reading(destination: string | null): MachineReadiness {
  return {
    testedAt: 5,
    via: destination === null ? "local" : "ssh",
    destination,
    reachable: true,
    failure: null,
    failureDetail: null,
    os: "Darwin",
    arch: "arm64",
    hostName: destination,
    osVersion: "27.0.1",
    scoutVersion: "0.3.6",
    tools: { scout: "/bin/scout", herdr: null, tmux: null, orca: null, claude: null, codex: null },
  };
}

function app(overrides: Partial<MeshRouteDeps> = {}) {
  const probed: (string | null)[] = [];
  const opened: string[][] = [];
  const server = new Hono();
  mountMeshRoutes(server, {
    meshNodeStateStore: {} as MeshRouteDeps["meshNodeStateStore"],
    readiness: createReadinessStore(async (destination) => {
      probed.push(destination);
      return reading(destination);
    }),
    openLocalTerminal: async (argv) => {
      opened.push([...argv]);
      return { app: "Ghostty" };
    },
    loadMachines: async () => ({ machines: ALL, generatedAt: 0, sources: {} as never, brokerUrl: "" }),
    loadMachine: async (reference) => {
      const found = ALL.find((candidate) => candidate.id === reference);
      if (!found) throw new Error("not found");
      return found;
    },
    ...overrides,
  });
  return { server, probed, opened };
}

describe("hosts routes", () => {
  test("the way in prefers the operator's ssh alias, then the tailnet name", () => {
    expect(machineWayIn(SELF)).toEqual({ kind: "local" });
    expect(machineWayIn(MINI)).toEqual({ kind: "ssh", destination: "mini", source: "config" });
    expect(machineWayIn(LAB)).toEqual({ kind: "ssh", destination: "studio-lab.tail1e8e67.ts.net", source: "tailnet" });
    expect(machineWayIn(NEIGHBOUR)).toBeNull();
  });

  test("testing one machine probes its way in and keeps the reading", async () => {
    const { server, probed } = app();
    const response = await server.request("/api/machines/mach-mini/test", { method: "POST" });
    expect(response.status).toBe(200);
    expect(probed).toEqual(["mini"]);
    const listed = await (await server.request("/api/machines/readiness")).json() as { readings: Record<string, MachineReadiness> };
    expect(listed.readings["mach-mini"]?.scoutVersion).toBe("0.3.6");
  });

  test("a machine with no way in answers 409 and runs nothing", async () => {
    const { server, probed } = app();
    const response = await server.request("/api/machines/mach-lan/test", { method: "POST" });
    expect(response.status).toBe(409);
    expect(probed).toEqual([]);
  });

  test("test all skips machines with no way in", async () => {
    const { server, probed } = app();
    await server.request("/api/machines/test", { method: "POST" });
    expect(probed.sort()).toEqual([null, "mini", "studio-lab.tail1e8e67.ts.net"].sort());
  });

  test("test all skips phones and older records of this Mac", async () => {
    const ghost = machine("mach-old-self", { isSelf: true, lastSeenAt: 0 });
    const phone = machine("mach-phone", { platform: "ios", sshTargets: MINI.sshTargets });
    const { server, probed } = app({
      loadMachines: async () => ({ machines: [ghost, ...ALL, phone], generatedAt: 0, sources: {} as never, brokerUrl: "" }),
    });
    await server.request("/api/machines/test", { method: "POST" });
    expect(probed.sort()).toEqual([null, "mini", "studio-lab.tail1e8e67.ts.net"].sort());
  });

  test("open terminal hands ssh <alias> to the terminal app, never this Mac", async () => {
    const { server, opened } = app();
    expect((await server.request("/api/machines/mach-mini/open-terminal", { method: "POST" })).status).toBe(200);
    expect(opened).toEqual([["ssh", "mini"]]);
    expect((await server.request("/api/machines/mach-self/open-terminal", { method: "POST" })).status).toBe(409);
  });

  test("readiness is not read as a machine reference", async () => {
    const { server } = app();
    const response = await server.request("/api/machines/readiness");
    expect(response.status).toBe(200);
  });
});
