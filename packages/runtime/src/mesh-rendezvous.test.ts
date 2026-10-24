import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_OPENSCOUT_MESH_RELAY_URL,
  DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL,
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
      OPENSCOUT_MESH_RENDEZVOUS_URL: `${DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL}/`,
      OPENSCOUT_MESH_RENDEZVOUS_TOKEN: "secret",
      OPENSCOUT_MESH_RENDEZVOUS_TTL_MS: "120000",
      OPENSCOUT_MESH_RENDEZVOUS_INTERVAL_MS: "45000",
    })).toEqual({
      url: DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL,
      token: "secret",
      sessionToken: undefined,
      ttlMs: 120_000,
      intervalMs: 45_000,
    });
  });

  test("resolves OSN session auth separately from shared bearer tokens", () => {
    expect(resolveMeshRendezvousPublishConfig({
      OPENSCOUT_MESH_RENDEZVOUS_URL: DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL,
      OPENSCOUT_MESH_RENDEZVOUS_SESSION: "abc",
    })).toMatchObject({
      url: DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL,
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
      OPENSCOUT_MESH_RENDEZVOUS_URL: DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL,
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
      OPENSCOUT_MESH_RENDEZVOUS_URL: DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL,
      OPENSCOUT_MESH_RENDEZVOUS_ALLOW_ANONYMOUS: "true",
    })).toEqual({
      url: DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL,
      token: undefined,
      sessionToken: undefined,
      ttlMs: 60_000,
      intervalMs: 30_000,
    });
    // A caller that passes its own environment reads nothing from this machine.
    expect(resolveMeshRendezvousPublishConfig({
      OPENSCOUT_MESH_RENDEZVOUS_URL: DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL,
    }, { includeSettings: false })).toBeUndefined();
  });

  test("a refused host credential stops publishing until the host is approved again", async () => {
    writeBridgeConfig({ token: "osbr_revoked" });
    const sent: Array<string | null> = [];
    const warnings: string[] = [];
    const publisher = startMeshRendezvousPublisher(makeNode(), {
      config: { ...resolveMeshRendezvousPublishConfig({ OPENSCOUT_MESH_RENDEZVOUS_URL: DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL })!, intervalMs: 60_000 },
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

  test("the real default relay publishes only to its closed audience", async () => {
    writeBridgeConfig({ token: "osbr_default_pair" });
    const requests: Request[] = [];
    for (const url of [DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL, DEFAULT_OPENSCOUT_MESH_RELAY_URL]) {
      const config = resolveMeshRendezvousPublishConfig({ OPENSCOUT_MESH_RENDEZVOUS_URL: url })!;
      expect(await publishMeshRendezvousPresence(makeNode(), { config, fetch: async (input, init) => {
        expect(init?.redirect).toBe("error");
        requests.push(new Request(input, init)); return Response.json({ ok: true });
      } })).toBe(true);
    }
    expect(requests.map(request => request.url)).toEqual([
      new URL("/v1/presence", DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL).href,
      new URL("/v1/presence", DEFAULT_OPENSCOUT_MESH_RELAY_URL).href,
    ]);
    expect(requests.map(request => request.headers.get("authorization"))).toEqual([
      "Bearer osbr_default_pair", "Bearer osbr_default_pair",
    ]);
  });

  test("non-default split pairs and HTTP default pairs publish nothing", async () => {
    let requests = 0;
    const httpRelay = DEFAULT_OPENSCOUT_MESH_RELAY_URL.replace("https:", "http:");
    const httpRendezvous = DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL.replace("https:", "http:");
    for (const [relayUrl, url] of [
      [DEFAULT_OPENSCOUT_MESH_RELAY_URL, "https://other.example.test"],
      ["https://other.example.test", DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL],
      [httpRelay, httpRendezvous],
      [httpRelay, DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL],
      [DEFAULT_OPENSCOUT_MESH_RELAY_URL, httpRendezvous],
    ]) {
      writeBridgeConfig({ token: "osbr_default_pair", relayUrl });
      const config = resolveMeshRendezvousPublishConfig({ OPENSCOUT_MESH_RENDEZVOUS_URL: url })!;
      expect(await publishMeshRendezvousPresence(makeNode(), { config, fetch: async () => {
        requests++; return Response.json({ ok: true });
      } })).toBe(false);
    }
    expect(requests).toBe(0);
  });

  test("host credentials refuse remote HTTP and cross-origin HTTPS before fetch", async () => {
    writeBridgeConfig({ token: "osbr_approved" });
    for (const url of [DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL.replace("https:", "http:"), "https://other.example.test", `${DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL}:444`, "not-a-url"]) {
      let requests = 0;
      const warnings: string[] = [];
      const config = resolveMeshRendezvousPublishConfig({ OPENSCOUT_MESH_RENDEZVOUS_URL: url })!;
      const publisher = startMeshRendezvousPublisher(makeNode(), { config: { ...config, intervalMs: 60_000 },
        logger: { log() {}, warn: message => warnings.push(message) },
        fetch: async () => { requests++; return Response.json({ ok: true }); },
      });
      await publisher.publishNow(); await publisher.publishNow(); publisher.stop();
      expect(requests).toBe(0);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("exact origin");
    }
  });

  test("invalid bridge configuration publishes nothing and logs once per blocked state", async () => {
    writeBridgeConfig({ token: "osbr_approved", tokenFile: "/unrelated/private-key" });
    const logs: string[] = [];
    let requests = 0;
    const config = resolveMeshRendezvousPublishConfig({ OPENSCOUT_MESH_RENDEZVOUS_URL: DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL })!;
    const publisher = startMeshRendezvousPublisher(makeNode(), { config: { ...config, intervalMs: 60_000 },
      logger: { log: message => logs.push(message), warn() {} },
      fetch: async () => { requests++; return Response.json({ ok: true }); },
    });
    await publisher.publishNow(); await publisher.publishNow();
    expect(requests).toBe(0); expect(logs).toHaveLength(1);
    writeBridgeConfig({ token: "osbr_approved" }, 1000);
    await publisher.publishNow(); expect(requests).toBe(1);
    writeBridgeConfig({ token: "invalid token" }, 1000);
    await publisher.publishNow(); await publisher.publishNow(); publisher.stop();
    expect(requests).toBe(1);
    expect(logs.filter(message => message.includes("valid bridge configuration"))).toHaveLength(2);
  });

  test("compares the issuer every publish, including same-mtime changes and recovery", async () => {
    writeBridgeConfig({ token: "osbr_approved" }, 1000);
    let requests = 0;
    const warnings: string[] = [];
    const config = resolveMeshRendezvousPublishConfig({ OPENSCOUT_MESH_RENDEZVOUS_URL: DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL })!;
    const publisher = startMeshRendezvousPublisher(makeNode(), { config: { ...config, intervalMs: 60_000 },
      logger: { log() {}, warn: message => warnings.push(message) },
      fetch: async () => { requests++; return Response.json({ ok: true }); },
    });
    await publisher.publishNow(); expect(requests).toBe(1);
    writeBridgeConfig({ token: "osbr_approved", relayUrl: "https://other.example.test" }, 1000);
    await publisher.publishNow(); await publisher.publishNow(); expect(requests).toBe(1);
    writeBridgeConfig({ token: "osbr_approved" }, 1000);
    await publisher.publishNow(); expect(requests).toBe(2);
    writeBridgeConfig({ token: "osbr_approved", relayUrl: "https://other.example.test" }, 1000);
    await publisher.publishNow(); publisher.stop();
    expect(requests).toBe(2); expect(warnings).toHaveLength(2);
  });

  test("direct publish permits same-origin loopback HTTP and refuses redirect following for host auth", async () => {
    writeBridgeConfig({ token: "osbr_loopback", relayUrl: "http://127.0.0.1:43199" });
    const config = resolveMeshRendezvousPublishConfig({ OPENSCOUT_MESH_RENDEZVOUS_URL: "http://127.0.0.1:43199" })!;
    const requests: RequestInit[] = [];
    const options = { config, fetch: async (_input: any, init?: RequestInit) => {
      requests.push(init!); return Response.json({ ok: true });
    } };
    expect(await publishMeshRendezvousPresence(makeNode(), options)).toBe(true);
    expect(requests[0]?.headers).toMatchObject({ authorization: "Bearer osbr_loopback" });
    expect(requests[0]?.redirect).toBe("error");
    config.url = "https://other.example.test";
    expect(await publishMeshRendezvousPresence(makeNode(), options)).toBe(false);
    expect(requests).toHaveLength(1);
  });

  test("host-auth loopback HTTP reaches only presence and never follows a redirect", async () => {
    const paths: string[] = [];
    let redirect = false;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      paths.push(new URL(request.url).pathname);
      expect(request.headers.get("authorization")).toBe("Bearer osbr_loopback");
      return redirect ? new Response(null, { status: 302, headers: { location: "/unexpected" } }) : Response.json({ ok: true });
    } });
    try {
      const url = `http://127.0.0.1:${server.port}`;
      writeBridgeConfig({ token: "osbr_loopback", relayUrl: url });
      const config = resolveMeshRendezvousPublishConfig({ OPENSCOUT_MESH_RENDEZVOUS_URL: url })!;
      expect(await publishMeshRendezvousPresence(makeNode(), { config })).toBe(true);
      redirect = true;
      await expect(publishMeshRendezvousPresence(makeNode(), { config })).rejects.toThrow();
      expect(paths).toEqual(["/v1/presence", "/v1/presence"]);
    } finally { server.stop(true); }
  });

  test("environment token and session keep explicit remote HTTP and cross-origin behavior", async () => {
    writeBridgeConfig({ token: "invalid config token", tokenFile: "/unrelated/private-key" });
    for (const auth of [{ OPENSCOUT_MESH_RENDEZVOUS_TOKEN: "env-token" }, { OPENSCOUT_MESH_RENDEZVOUS_SESSION: "env-session" }]) {
      const config = resolveMeshRendezvousPublishConfig({ OPENSCOUT_MESH_RENDEZVOUS_URL: "http://explicit.example.test", ...auth })!;
      expect(config.hostCredential).toBeUndefined();
      const requests: RequestInit[] = [];
      expect(await publishMeshRendezvousPresence(makeNode(), { config, fetch: async (_input, init) => {
        requests.push(init!); return Response.json({ ok: true });
      } })).toBe(true);
      expect(requests[0]?.headers).toMatchObject({ authorization: auth.OPENSCOUT_MESH_RENDEZVOUS_TOKEN ? "Bearer env-token" : "Bearer osn_session_env-session" });
      expect(requests[0]?.redirect).toBeUndefined();
    }
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
        url: DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL,
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
    expect(requests[0]?.url).toBe(new URL("/v1/presence", DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL).href);
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer secret");
    const payload = await requests[0]!.json();
    expect(payload.nodeId).toBe("node-a");
  });

  test("publishes OSN-session presence with the native session bearer format", async () => {
    const requests: Request[] = [];
    await publishMeshRendezvousPresence(makeNode(), {
      config: {
        url: DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL,
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
        url: DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL,
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
        url: DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL,
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
  writeFileSync(path, JSON.stringify({ relayUrl: DEFAULT_OPENSCOUT_MESH_RELAY_URL, ...fields }));
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
