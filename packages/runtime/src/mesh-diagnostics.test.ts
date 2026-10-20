import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { meshDiagnostics, type EffectiveMeshSettings } from "./mesh-diagnostics.js";
import type { ProbeSnapshot } from "./system-probes/registry.js";
import type { TailscaleStatusSummary } from "./system-probes/tailscale-status.js";
const settings: EffectiveMeshSettings = { nodeId: "node", nodeName: "Node", meshId: "mesh",
  advertiseScope: "mesh", brokerUrl: "https://user:pass@node.example:43110/private?token=secret#secret",
  seedUrls: ["https://user:pass@seed.example/private?token=secret", "file:///etc/passwd"], discoveryIntervalMs: 60_000 };
const empty: ProbeSnapshot<TailscaleStatusSummary> = { id: "tailscale", value: null, at: null, ageMs: null,
  stale: true, refreshing: true, status: "empty", error: null, consecutiveFailures: 0, backend: "local" };
describe("runtime mesh diagnostic read model", () => {
  test("empty/refreshing is unavailable, not stopped or uninstalled", () => {
    const report = meshDiagnostics(empty, settings, 100);
    expect(report.tailscale).toMatchObject({ unavailable: true, running: null, status: "empty", refreshing: true, stale: true });
    expect(report.settings.brokerOrigin).toBe("https://node.example:43110");
    expect(report.settings.seedOrigins).toEqual(["https://seed.example"]);
    expect(JSON.stringify(report)).not.toMatch(/secret|private|user:pass|passwd/);
  });
  test("stale successful data and a failed refresh are both explicit", () => {
    const report = meshDiagnostics({ ...empty, at: 1, ageMs: 99, status: "stale", refreshing: false,
      value: { running: true, backendState: "Running", health: [], peers: [], self: null },
      error: { code: "spawn_failed", message: "/home/operator/secret token=private", at: 90, timedOut: true } }, settings, 100);
    expect(report.tailscale).toMatchObject({ unavailable: false, stale: true, running: true, at: 1, ageMs: 99,
      error: { code: "probe_failed", at: 90, timedOut: true } });
    expect(JSON.stringify(report)).not.toContain("operator");
  });
  test("peers, health, strings and nested arrays are bounded and unexpected fields are omitted", () => {
    const value = { running: true, backendState: "Running", health: Array(50).fill("token=private " + "x".repeat(5000)),
      peers: Array.from({ length: 200 }, (_, i) => ({ id: String(i), name: "n".repeat(5000), online: i % 2 === 0,
        addresses: Array(30).fill("100.64.0.1"), tags: ["secret"], unexpected: "private" })), self: null };
    const report = meshDiagnostics({ ...empty, value, stale: false, status: "fresh", refreshing: false },
      { ...settings, seedUrls: Array(50).fill(settings.seedUrls[0]!), unexpected: "private" } as EffectiveMeshSettings);
    expect(report.tailscale.peers).toHaveLength(128);
    expect(report.tailscale.peerCount).toBe(200); expect(report.tailscale.onlinePeerCount).toBe(100);
    expect(report.tailscale.peersTruncated).toBe(true); expect(report.tailscale.healthTruncated).toBe(true);
    expect(report.tailscale.peers[0]!.addresses).toHaveLength(8); expect(report.tailscale.peers[0]!.name!.length).toBe(256);
    expect(report.settings.seedOrigins).toHaveLength(32);
    expect(JSON.stringify(report)).not.toMatch(/private|unexpected|tags/);
    expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThan(200_000);
  });
  test("failed probe without previous data remains unavailable with error metadata", () => {
    expect(meshDiagnostics({ ...empty, status: "failed", refreshing: false,
      error: { code: "failure", message: "secret", at: 5 } }, settings).tailscale).toMatchObject({
        status: "failed", unavailable: true, running: null, error: { code: "probe_failed", at: 5, timedOut: false } });
  });
});


test("diagnostic dependencies load after instance bootstrap", () => {
  const source = readFileSync(new URL("./broker-daemon.ts", import.meta.url), "utf8");
  expect(source.match(/^import .*$/m)?.[0]).toBe('import { openScoutCheckoutInstanceDefault, openScoutInstanceBootstrap } from "./instance-checkout-bootstrap.js";');
});
test("private key blocks are redacted before truncation", () => {
  const secret = "-----BEGIN PRIVATE KEY-----" + "A".repeat(4000) + "-----END PRIVATE KEY-----";
  const report = meshDiagnostics({ ...empty, value: { running: true, backendState: "Running", health: [secret], peers: [], self: null } }, settings);
  expect(report.tailscale.health[0]).toBe("[REDACTED PRIVATE KEY]");
});
