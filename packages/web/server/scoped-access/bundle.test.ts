import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { accessTestFixture } from "../../../runtime/src/test-helpers/access-fixture.test.ts";
import { loadOrCreateTlsIdentity } from "../../../runtime/src/node-tls-identity.js";
import { gatewayStaticRoot } from "./index.ts";

/** Launch the compiled entrypoint with synthetic credentials and an isolated
 * TLS listener; exercise the packaged static directory, not the source factory. */
test("bundled entrypoint serves its sibling access-client tree over TLS", async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "scoped-gateway-bundle-"))); chmodSync(directory, 0o700);
  let running: { close(): void } | undefined;
  try {
    const f = accessTestFixture();
    const write = (name: string, value: unknown) => { const path = join(directory, name); writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value), { mode: 0o600 }); return path; };
    const entrypoint = new URL("./index.ts", import.meta.url).pathname;
    const built = await Bun.build({ entrypoints: [entrypoint], target: "bun", format: "esm", outdir: directory, naming: "openscout-access-server.mjs" });
    expect(built.success).toBe(true);
    const dist = join(directory, "access-client"); mkdirSync(join(dist, "scoped-access"), { recursive: true }); mkdirSync(join(dist, "assets"));
    writeFileSync(join(dist, "scoped-access", "index.html"), '<!doctype html><title>Packaged access</title><script type="module" src="/assets/access.js"></script>');
    writeFileSync(join(dist, "assets", "access.js"), 'document.title = "Packaged access loaded";');
    const tls = await loadOrCreateTlsIdentity(directory, { algorithm: "ec-p256" });
    const certFile = write("gateway-cert.pem", tls.certificatePem), keyFile = write("gateway-key.pem", tls.keyPair.privateKey.export({ format: "pem", type: "pkcs8" }).toString());
    const uid = process.getuid!();
    const configPath = write("gateway.json", { privateDirectory: directory, isolation: { gatewayUid: uid, brokerUid: uid + 1, agentUids: [uid + 2] },
      origin: "https://access.bundle.test:0", brokerUrl: "http://127.0.0.1:9", audience: f.audience, tls: { certFile, keyFile },
      users: [{ login: "member", passwordHash: `scrypt-v1:${"0".repeat(32)}:${"0".repeat(128)}`,
        deviceFile: write("device.json", { protocol: "scout-access/1", kind: "private-device", identity: f.device }), delegationFile: write("delegation.json", f.delegation) }] });
    const bundled = await import(pathToFileURL(join(directory, "openscout-access-server.mjs")).href);
    expect(bundled.gatewayStaticRoot()).toBe(dist);
    expect(gatewayStaticRoot()).toBe(new URL("../../dist/access-client", import.meta.url).pathname);
    running = await bundled.startScopedAccessGateway(configPath);
    const port = (running as any).server.port;
    async function get(path: string, host = "access.bundle.test:0") {
      const response = await fetch(`https://127.0.0.1:${port}${path}`, {
        headers: { host }, redirect: "error",
        // Match the production Bun pinned-client TLS options, not the
        // node:https identity override ignored by Bun 1.3.13.
        tls: { ca: tls.certificatePem, checkServerIdentity: () => undefined },
      } satisfies BunFetchRequestInit);
      return { status: response.status, body: await response.text() };
    }
    const index = await get("/"); expect(index.status).toBe(200); expect(index.body).toContain("Packaged access");
    const asset = await get("/assets/access.js"); expect(asset.status).toBe(200); expect(asset.body).toContain("Packaged access loaded");
    expect((await get("/api/terminal")).status).toBe(404);
    // The real gateway checks the exact Host before serving static files.
    // Successful requests above and this rejected control prove fetch sends
    // the synthetic Host (including :0) and the bundled server sees it.
    const wrongHost = await get("/", "unexpected.bundle.test:0");
    expect(wrongHost.status).toBe(403); expect(JSON.parse(wrongHost.body).error).toBe("origin_not_allowed");
  } finally { running?.close(); rmSync(directory, { recursive: true, force: true }); }
}, 30_000);
