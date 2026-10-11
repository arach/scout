import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  OPENSCOUT_IROH_MESH_ALPN,
  OPENSCOUT_MESH_PROTOCOL_VERSION,
} from "@openscout/protocol";

import {
  resolveIrohMeshEntrypointFromEnv,
  startIrohBridgeServe,
  type IrohBridgeService,
} from "./iroh-bridge.js";

const tempDirs: string[] = [];
const services: IrohBridgeService[] = [];

afterEach(async () => {
  for (const service of services.splice(0)) {
    service.stop();
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "openscout-iroh-bridge-test-"));
  tempDirs.push(dir);
  return dir;
}

describe("iroh bridge helpers", () => {
  test("resolves a local Iroh mesh entrypoint from environment JSON", () => {
    const entrypoint = resolveIrohMeshEntrypointFromEnv({
      OPENSCOUT_IROH_ENDPOINT_ADDR_JSON: JSON.stringify({ id: "endpoint-from-json", addrs: [] }),
    });

    expect(entrypoint).toMatchObject({
      kind: "iroh",
      endpointId: "endpoint-from-json",
      alpn: OPENSCOUT_IROH_MESH_ALPN,
      bridgeProtocolVersion: OPENSCOUT_MESH_PROTOCOL_VERSION,
    });
  });

  test("starts a bridge process and reads its advertised endpoint", async () => {
    const dir = await makeTempDir();
    const scriptPath = join(dir, "fake-bridge.sh");
    await Bun.write(scriptPath, [
      "#!/bin/sh",
      "printf '%s\\n' '{\"bridgeProtocolVersion\":1,\"alpn\":\"openscout/mesh/1\",\"endpointId\":\"fake-endpoint\",\"endpointAddr\":{\"id\":\"fake-endpoint\",\"addrs\":[]},\"identityPath\":\"/tmp/fake.key\"}'",
      "sleep 30",
      "",
    ].join("\n"));
    await chmod(scriptPath, 0o755);

    const service = await startIrohBridgeServe({
      bridgeBin: scriptPath,
      identityPath: join(dir, "iroh.key"),
      brokerUrl: "http://127.0.0.1:65501",
      startupTimeoutMs: 1_000,
      onlineTimeoutMs: 100,
    });
    services.push(service);

    expect(service.entrypoint.endpointId).toBe("fake-endpoint");
    expect(service.entrypoint.endpointAddr).toEqual({ id: "fake-endpoint", addrs: [] });
  });
});

test("forward serializes an exact-body Scout proof bound to the destination Iroh endpoint", async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  const { forwardIrohMeshEnvelope } = await import("./iroh-bridge.js");
  const { nodeKeyId } = await import("./node-identity.js");
  const { verifyPeerRequest, PeerNonceCache } = await import("./mesh-peer-auth.js");
  const { peerAuthHeadersFrom } = await import("./mesh-ingress-gate.js");
  const dir = await makeTempDir(), scriptPath = join(dir, "forward.sh");
  const captured = join(dir, "request.json");
  await Bun.write(scriptPath, `#!/bin/sh\ncat > '${captured}'\nprintf '%s\\n' '{"status":200,"body":{"ok":true}}'\n`);
  await chmod(scriptPath, 0o755);
  const keys = generateKeyPairSync("ed25519");
  const identity = { version: 1 as const, createdAt: Date.now(), publicKey: keys.publicKey.export({ type: "spki", format: "der" }).toString("base64"), privateKey: keys.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64") };
  const endpointId = "a".repeat(64);
  const entrypoint = { kind: "iroh" as const, endpointId, endpointAddr: { id: endpointId }, alpn: OPENSCOUT_IROH_MESH_ALPN, bridgeProtocolVersion: OPENSCOUT_MESH_PROTOCOL_VERSION };
  const options = { nodeIdentity: identity, bridgeBin: scriptPath, identityPath: join(dir, "transport.key") };
  expect(await forwardIrohMeshEnvelope(entrypoint, "invocations", { z: "☃", a: 3 }, options)).toEqual({ status: 200, body: { ok: true } });
  const frame = await Bun.file(captured).json();
  expect(frame.body).toBe('{"z":"☃","a":3}');
  expect(verifyPeerRequest({ method: "POST", path: "/v1/mesh/invocations", body: frame.body, headers: peerAuthHeadersFrom(frame.headers), destinationKeyId: `iroh:${endpointId}`, bootedAt: Date.now() - 1000, nonceClaim: new PeerNonceCache(), lookupPeer: (id) => id === nodeKeyId(identity.publicKey) ? { publicKey: identity.publicKey, tier: "control" } : undefined }).ok).toBe(true);
  await expect(forwardIrohMeshEnvelope({ ...entrypoint, endpointAddr: { id: "b".repeat(64) } }, "invocations", {}, options)).rejects.toThrow("identity mismatch");
  await expect(forwardIrohMeshEnvelope({ ...entrypoint, alpn: "openscout/mesh/0" as typeof OPENSCOUT_IROH_MESH_ALPN }, "invocations", {}, options)).rejects.toThrow("authenticated forwarding");
});

test("rejects and terminates an old sidecar rather than advertising unsigned forwarding", async () => {
  const dir = await makeTempDir(), scriptPath = join(dir, "old-bridge.sh"), pidPath = join(dir, "pid");
  await Bun.write(scriptPath, `#!/bin/sh\necho $$ > '${pidPath}'\nprintf '%s\\n' '{"bridgeProtocolVersion":1,"alpn":"openscout/mesh/0","endpointId":"old"}'\nexec sleep 30\n`);
  await chmod(scriptPath, 0o755);
  await expect(startIrohBridgeServe({ bridgeBin: scriptPath, identityPath: join(dir, "iroh.key"), brokerUrl: "http://127.0.0.1:1", startupTimeoutMs: 1000 })).rejects.toThrow("unsupported ALPN");
  const pid = Number(await Bun.file(pidPath).text());
  let alive = true;
  for (let i = 0; i < 50 && alive; i++) {
    try { process.kill(pid, 0); await Bun.sleep(10); } catch { alive = false; }
  }
  expect(alive).toBe(false);
});
