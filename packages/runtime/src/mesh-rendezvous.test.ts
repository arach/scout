import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  OPENSCOUT_IROH_MESH_ALPN,
  OPENSCOUT_MESH_PROTOCOL_VERSION,
  type NodeDefinition,
} from "@openscout/protocol";

import {
  buildMeshRendezvousPresence,
  mobilePairingMeshEntrypointFromSnapshot,
  readMobilePairingMeshEntrypoint,
  publishMeshRendezvousPresence,
  resolveMeshRendezvousPublishConfig,
  startMeshRendezvousPublisher,
} from "./mesh-rendezvous.js";
import { writeOpenScoutSettings } from "./setup.js";

const originalPairingStatePath = process.env.OPENSCOUT_PAIRING_RUNTIME_STATE_PATH;
const originalSupportDirectory = process.env.OPENSCOUT_SUPPORT_DIRECTORY;
const originalControlHome = process.env.OPENSCOUT_CONTROL_HOME;
const originalRelayHub = process.env.OPENSCOUT_RELAY_HUB;
const testDirectories = new Set<string>();

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "openscout-rendezvous-test-"));
  testDirectories.add(home);
  process.env.OPENSCOUT_PAIRING_RUNTIME_STATE_PATH = join(home, "runtime.json");
  process.env.OPENSCOUT_SUPPORT_DIRECTORY = join(home, "support");
  process.env.OPENSCOUT_CONTROL_HOME = join(home, "control");
  process.env.OPENSCOUT_RELAY_HUB = join(home, "relay");
});

afterEach(() => {
  if (originalPairingStatePath === undefined) delete process.env.OPENSCOUT_PAIRING_RUNTIME_STATE_PATH;
  else process.env.OPENSCOUT_PAIRING_RUNTIME_STATE_PATH = originalPairingStatePath;
  if (originalSupportDirectory === undefined) {
    delete process.env.OPENSCOUT_SUPPORT_DIRECTORY;
  } else {
    process.env.OPENSCOUT_SUPPORT_DIRECTORY = originalSupportDirectory;
  }
  if (originalControlHome === undefined) {
    delete process.env.OPENSCOUT_CONTROL_HOME;
  } else {
    process.env.OPENSCOUT_CONTROL_HOME = originalControlHome;
  }
  if (originalRelayHub === undefined) {
    delete process.env.OPENSCOUT_RELAY_HUB;
  } else {
    process.env.OPENSCOUT_RELAY_HUB = originalRelayHub;
  }
  for (const directory of testDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  testDirectories.clear();
});

describe("mesh rendezvous publisher", () => {
  test("resolves opt-in publish config from env", () => {
    expect(resolveMeshRendezvousPublishConfig({})).toBeUndefined();
    expect(resolveMeshRendezvousPublishConfig({ OPENSCOUT_MESH_RENDEZVOUS_URL: "false" })).toBeUndefined();
    expect(resolveMeshRendezvousPublishConfig({ OPENSCOUT_MESH_RENDEZVOUS_URL: "0" })).toBeUndefined();
    expect(resolveMeshRendezvousPublishConfig({
      OPENSCOUT_MESH_RENDEZVOUS_URL: "https://mesh.oscout.net/",
      OPENSCOUT_MESH_RENDEZVOUS_TOKEN: "secret",
      OPENSCOUT_MESH_RENDEZVOUS_TTL_MS: "120000",
      OPENSCOUT_MESH_RENDEZVOUS_INTERVAL_MS: "45000",
    })).toEqual({
      url: "https://mesh.oscout.net",
      token: "secret",
      sessionToken: undefined,
      ttlMs: 120_000,
      intervalMs: 45_000,
    });
  });

  test("resolves OSN session auth separately from shared bearer tokens", () => {
    expect(resolveMeshRendezvousPublishConfig({
      OPENSCOUT_MESH_RENDEZVOUS_URL: "https://mesh.oscout.net",
      OPENSCOUT_MESH_RENDEZVOUS_SESSION: "abc",
    })).toMatchObject({
      url: "https://mesh.oscout.net",
      sessionToken: "abc",
    });
  });

  test("uses OpenScout Network settings as the rendezvous opt-in", async () => {
    await writeOpenScoutSettings({
      network: {
        openScoutNetwork: {
          discoveryEnabled: true,
          rendezvousUrl: "https://mesh.example.test/",
        },
      },
    });

    expect(resolveMeshRendezvousPublishConfig({})).toMatchObject({ url: "https://mesh.example.test" });
    expect(resolveMeshRendezvousPublishConfig({
      OPENSCOUT_MESH_RENDEZVOUS_ALLOW_ANONYMOUS: "1",
    })).toEqual({
      url: "https://mesh.example.test",
      token: undefined,
      sessionToken: undefined,
      ttlMs: 60_000,
      intervalMs: 30_000,
    });
  });

  test("publishes nothing until this host is approved, then publishes with its credential", async () => {
    const config = resolveMeshRendezvousPublishConfig({
      OPENSCOUT_MESH_RENDEZVOUS_URL: "https://mesh.oscout.net",
    });
    expect(config?.hostCredential).toBeDefined();
    const requests: Request[] = [];
    const logs: string[] = [];
    const publisher = startMeshRendezvousPublisher(makeNode(), {
      config: { ...config!, intervalMs: 60_000 },
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
      logger: { log: (message) => logs.push(message), warn() {} },
    });

    await publisher.publishNow();
    await publisher.publishNow();
    expect(requests).toHaveLength(0);
    expect(logs).toEqual([expect.stringContaining("waits for this host's approval")]);

    // `scout mesh bridge connect` writes the bridge config once the account approves the host.
    writeBridgeConfig({ token: "osbr_approved" });
    await publisher.publishNow();
    publisher.stop();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer osbr_approved");
  });

  test("anonymous publishing is opt-in and never reads the host's credential", () => {
    writeBridgeConfig({ token: "osbr_approved" });
    expect(resolveMeshRendezvousPublishConfig({
      OPENSCOUT_MESH_RENDEZVOUS_URL: "https://mesh.oscout.net",
      OPENSCOUT_MESH_RENDEZVOUS_ALLOW_ANONYMOUS: "true",
    })).toEqual({
      url: "https://mesh.oscout.net",
      token: undefined,
      sessionToken: undefined,
      ttlMs: 60_000,
      intervalMs: 30_000,
    });
    // A caller that passes its own environment reads nothing from this machine.
    expect(resolveMeshRendezvousPublishConfig({
      OPENSCOUT_MESH_RENDEZVOUS_URL: "https://mesh.oscout.net",
    }, { includeSettings: false })).toBeUndefined();
  });

  test("a refused host credential stops publishing until the host is approved again", async () => {
    writeBridgeConfig({ token: "osbr_revoked" });
    const sent: Array<string | null> = [];
    const warnings: string[] = [];
    const publisher = startMeshRendezvousPublisher(makeNode(), {
      config: { ...resolveMeshRendezvousPublishConfig({ OPENSCOUT_MESH_RENDEZVOUS_URL: "https://mesh.oscout.net" })!, intervalMs: 60_000 },
      fetch: async (input, init) => {
        const authorization = new Request(input, init).headers.get("authorization");
        sent.push(authorization);
        return authorization === "Bearer osbr_revoked"
          ? new Response("unauthorized", { status: 401 })
          : new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
      logger: { log() {}, warn: (message) => warnings.push(message) },
    });

    await publisher.publishNow();
    await publisher.publishNow();
    expect(sent).toEqual(["Bearer osbr_revoked"]);
    expect(warnings).toEqual([expect.stringContaining("approved again")]);

    writeBridgeConfig({ token: "osbr_reapproved" }, Date.now() + 5_000);
    await publisher.publishNow();
    publisher.stop();
    expect(sent).toEqual(["Bearer osbr_revoked", "Bearer osbr_reapproved"]);
  });

  test("builds presence from Iroh entrypoints and skips loopback HTTP", () => {
    const presence = buildMeshRendezvousPresence(makeNode({
      brokerUrl: "http://127.0.0.1:65501",
    }), { issuedAt: 1_000, ttlMs: 60_000 });

    expect(presence?.nodeId).toBe("node-a");
    expect(presence?.entrypoints).toHaveLength(1);
    expect(presence?.entrypoints[0]?.kind).toBe("iroh");
    expect(presence?.expiresAt).toBe(61_000);
  });

  test("includes non-loopback broker URL as HTTP entrypoint", () => {
    const presence = buildMeshRendezvousPresence(makeNode({
      brokerUrl: "https://node-a.mesh.oscout.net",
    }));

    expect(presence?.entrypoints.map((entrypoint) => entrypoint.kind)).toEqual(["iroh", "http"]);
  });

  test("filters mobile_pairing even when supplied by another node builder", () => {
    const node = makeNode();
    node.meshEntrypoints = [...(node.meshEntrypoints ?? []), { kind: "mobile_pairing",
      relay: "wss://relay.example.test", room: "private-invitation", publicKey: "a".repeat(64),
      expiresAt: Date.now() + 60_000 }];
    const presence = buildMeshRendezvousPresence(node);
    expect(presence?.entrypoints.map(entry => entry.kind)).toEqual(["iroh"]);
    expect(JSON.stringify(presence)).not.toContain("private-invitation");
  });

  test("never extracts a pairing invitation for rendezvous", () => {
    expect(mobilePairingMeshEntrypointFromSnapshot({
      updatedAt: 12_000,
      pairing: {
        relay: "wss://relay.oscout.net",
        room: "room-1",
        publicKey: "a".repeat(64),
        expiresAt: 70_000,
        qrValue: JSON.stringify({
          fallbackRelays: ["wss://relay.tailnet.ts.net:43131"],
        }),
      },
    }, 10_000)).toBeUndefined();

    expect(mobilePairingMeshEntrypointFromSnapshot({
      pairing: {
        relay: "wss://relay.oscout.net",
        room: "room-1",
        publicKey: "a".repeat(64),
        expiresAt: 9_999,
      },
    }, 10_000)).toBeUndefined();
  });

  test("reads the selected pairing home and never falls back to another instance", () => {
    const home = mkdtempSync(join(tmpdir(), "rendezvous-pairing-home-"));
    testDirectories.add(home);
    const production = join(home, ".scout", "pairing");
    const selected = join(home, "isolated-pairing");
    mkdirSync(production, { recursive: true });
    mkdirSync(selected);
    const snapshot = { pairing: { relay: "wss://relay.example.test", accountRoom: "selected-account",
      publicKey: "a".repeat(64), expiresAt: Date.now() + 60_000 } };
    writeFileSync(join(production, "runtime.json"), JSON.stringify(snapshot));
    expect(readMobilePairingMeshEntrypoint({ HOME: home, OPENSCOUT_INSTANCE: "rendezvous-test" })).toBeUndefined();
    expect(readMobilePairingMeshEntrypoint({ HOME: home, OPENSCOUT_PAIRING_HOME: selected })).toBeUndefined();
    writeFileSync(join(selected, "runtime.json"), JSON.stringify(snapshot));
    expect(readMobilePairingMeshEntrypoint({ HOME: home, OPENSCOUT_PAIRING_HOME: selected })?.room).toBe("selected-account");
    expect(readMobilePairingMeshEntrypoint({ HOME: home, OPENSCOUT_PAIRING_HOME: selected,
      OPENSCOUT_PAIRING_RUNTIME_STATE_PATH: join(home, "missing.json") })).toBeUndefined();
  });

  test("publishes only the host runtime's account room, never node-supplied invitations", async () => {
    const snapshot = { pairing: {
      relay: "wss://relay.example.test", accountRoom: "owner-account-room",
      room: "pairing-code-room", publicKey: "a".repeat(64), expiresAt: Date.now() + 60_000,
    } };
    writeFileSync(process.env.OPENSCOUT_PAIRING_RUNTIME_STATE_PATH!, JSON.stringify(snapshot));
    const node = makeNode();
    node.meshEntrypoints = [{ kind: "mobile_pairing", relay: "wss://relay.example.test",
      room: "node-supplied-room", publicKey: "b".repeat(64), expiresAt: Date.now() + 60_000,
      metadata: { source: "openscout-pairing-runtime" } }];
    const requests: unknown[] = [];
    await publishMeshRendezvousPresence(node, {
      config: { url: "https://mesh.example.test", token: "test", ttlMs: 60_000, intervalMs: 30_000 },
      fetch: async (_input, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return new Response("{}", { status: 200 });
      },
    });
    expect(requests).toHaveLength(1);
    expect((requests[0] as { entrypoints: unknown[] }).entrypoints).toEqual([
      expect.objectContaining({ kind: "mobile_pairing", room: "owner-account-room" }),
    ]);
    expect(JSON.stringify(requests)).not.toContain("pairing-code-room");
    expect(JSON.stringify(requests)).not.toContain("node-supplied-room");
  });

  test("publishes no mobile pairing without an account room, including code-only snapshots", () => {
    const node = makeNode({ meshEntrypoints: [], brokerUrl: "http://127.0.0.1:65501" });
    expect(buildMeshRendezvousPresence(node)).toBeUndefined();
    for (const pairing of [{}, { room: "pairing-code-room" }, { accountRoom: " " },
      { accountRoom: "expired-account", expiresAt: Date.now() - 1 }]) {
      writeFileSync(process.env.OPENSCOUT_PAIRING_RUNTIME_STATE_PATH!, JSON.stringify({ pairing: {
        relay: "wss://relay.example.test", publicKey: "a".repeat(64), expiresAt: Date.now() + 60_000,
        ...pairing,
      } }));
      expect(buildMeshRendezvousPresence(node)).toBeUndefined();
    }
    writeFileSync(process.env.OPENSCOUT_PAIRING_RUNTIME_STATE_PATH!, "not JSON");
    expect(buildMeshRendezvousPresence(node)).toBeUndefined();
  });

  test("publishes signed-in-directory presence to the configured front door", async () => {
    const requests: Request[] = [];
    const ok = await publishMeshRendezvousPresence(makeNode(), {
      config: {
        url: "https://mesh.oscout.net",
        token: "secret",
        sessionToken: undefined,
        ttlMs: 60_000,
        intervalMs: 30_000,
      },
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    expect(ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://mesh.oscout.net/v1/presence");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer secret");
    const payload = await requests[0]!.json();
    expect(payload.nodeId).toBe("node-a");
  });

  test("publishes OSN-session presence with the native session bearer format", async () => {
    const requests: Request[] = [];
    await publishMeshRendezvousPresence(makeNode(), {
      config: {
        url: "https://mesh.oscout.net",
        sessionToken: "abc",
        ttlMs: 60_000,
        intervalMs: 30_000,
      },
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    expect(requests[0]?.headers.get("authorization")).toBe("Bearer osn_session_abc");
  });

  test("publisher resolves dynamic node source on each publish", async () => {
    const requests: Request[] = [];
    let name = "Node A";
    const publisher = startMeshRendezvousPublisher(() => makeNode({ name }), {
      config: {
        url: "https://mesh.oscout.net",
        token: "secret",
        sessionToken: undefined,
        ttlMs: 60_000,
        intervalMs: 60_000,
      },
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    await publisher.publishNow();
    name = "Node B";
    await publisher.publishNow();
    publisher.stop();

    expect(requests).toHaveLength(2);
    await expect(requests[0]!.json()).resolves.toMatchObject({ nodeName: "Node A" });
    await expect(requests[1]!.json()).resolves.toMatchObject({ nodeName: "Node B" });
  });

  test("suspends an immutable publisher after authentication is rejected", async () => {
    const warnings: string[] = [];
    let requests = 0;
    const publisher = startMeshRendezvousPublisher(makeNode(), {
      config: {
        url: "https://mesh.oscout.net",
        token: "expired",
        sessionToken: undefined,
        ttlMs: 60_000,
        intervalMs: 60_000,
      },
      fetch: async () => {
        requests += 1;
        return new Response("unauthorized", { status: 401 });
      },
      logger: {
        log() {},
        warn: (message) => warnings.push(message),
      },
    });

    await publisher.publishNow();
    await publisher.publishNow();
    publisher.stop();

    expect(requests).toBe(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("publishing is suspended until restart");
  });
});

/** The bridge config `scout mesh bridge connect` writes, in the test's support directory. */
function writeBridgeConfig(fields: Record<string, unknown>, mtimeMs?: number): void {
  const supportDirectory = process.env.OPENSCOUT_SUPPORT_DIRECTORY!;
  mkdirSync(supportDirectory, { recursive: true });
  const path = join(supportDirectory, "mcp-bridge.json");
  writeFileSync(path, JSON.stringify({ relayUrl: "https://mcp.oscout.net", ...fields }));
  if (mtimeMs !== undefined) utimesSync(path, new Date(mtimeMs), new Date(mtimeMs));
}

function makeNode(input: Partial<NodeDefinition> = {}): NodeDefinition {
  return {
    id: "node-a",
    meshId: "openscout",
    name: input.name ?? "Node A",
    advertiseScope: "mesh",
    registeredAt: 1,
    lastSeenAt: 2,
    brokerUrl: input.brokerUrl,
    meshEntrypoints: input.meshEntrypoints ?? [
      {
        kind: "iroh",
        endpointId: "endpoint-a",
        endpointAddr: { id: "endpoint-a", addrs: [] },
        alpn: OPENSCOUT_IROH_MESH_ALPN,
        bridgeProtocolVersion: OPENSCOUT_MESH_PROTOCOL_VERSION,
      },
    ],
  };
}
