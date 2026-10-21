import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { AgentEndpoint } from "@openscout/protocol";
import { readProviderQuotas } from "./broker-provider-quota-read.js";
import { createBrokerHttpRouter, type BrokerHttpRouterDeps } from "./broker-http-router.js";
import { grantSatisfiesRouteTier, meshRouteTierFor } from "./mesh-route-matrix.js";
const now = 1_800_000_000_000;
const url = (query = "") => new URL(`http://local/v1/provider-quotas${query}`);
function endpoint(id = "ep-1", quota: Record<string, unknown> = {}) {
  return { id, nodeId: "node-1", agentId: "agent-1", harness: "codex", transport: "codex_app_server", sessionId: "exact-session", metadata: { providerMeta: { secret: "never-export", observeQuota: { capturedAt: now - 30_000, accountId: "account-1", windows: [{ label: "weekly", usedPercent: 37 }], ...quota } } } } as unknown as AgentEndpoint;
}
test("returns public provider facts with capture age and exact session/account identity, without metadata", () => {
  const result = readProviderQuotas({ one: endpoint() }, "node-1", url(), now);
  expect(result).toMatchObject({ availability: "available", refresh: "not_requested", coverage: { endpointsScanned: 1, truncated: false } });
  expect(result.windows).toHaveLength(1);
  expect(result.windows[0]).toMatchObject({ provider: "openai", source: "provider_reported", endpointId: "ep-1", sessionId: "exact-session", accountId: "account-1", usedPercent: 37, percentRemaining: 63, capturedAt: now - 30_000, ageMs: 30_000, observationSource: "codex.providerMeta.observeQuota" });
  expect(JSON.stringify(result)).not.toContain("never-export");
  expect(result.windows[0]).not.toHaveProperty("metadata");
});
test("missing/unapproved observations stay unknown; explicit observed zero is not confused with missing", () => {
  for (const candidate of [undefined, endpoint("a", { capturedAt: undefined }), endpoint("b", { windows: [{}] }), { ...endpoint(), harness: "unsupported" }, { ...endpoint(), nodeId: "remote" }, endpoint("c", { capturedAt: now + 1 }), endpoint("d", { windows: [{ usedPercent: 101 }] })]) {
    const result = readProviderQuotas(candidate ? { one: candidate } : {}, "node-1", url("?refresh=1"), now);
    expect(result).toMatchObject({ availability: "unknown", refresh: "unsupported", windows: [] });
  }
  expect(readProviderQuotas({ one: endpoint("z", { windows: [{ usedPercent: 0 }] }) }, "node-1", url(), now).windows[0].usedPercent).toBe(0);
});
test("keeps account/session pools separate and stale capture times unchanged on refresh", () => {
  const result = readProviderQuotas({ one: endpoint(), two: endpoint("ep-2", { capturedAt: now - 86_400_000, accountId: "account-2" }) }, "node-1", url("?refresh=true"), now);
  expect(result.windows).toHaveLength(2);
  expect(result.windows.map(window => window.accountId)).toEqual(["account-1", "account-2"]);
  expect(result.windows[1].ageMs).toBe(86_400_000);
  expect(result.refresh).toBe("unsupported");
});
test("validates parameters and bounds both observation fanout and output", () => {
  for (const query of ["?limit=0", "?limit=201", "?limit=1.5", "?refresh=live", "?accountId=other", "?limit=1&limit=2"]) expect(() => readProviderQuotas({}, "node-1", url(query), now)).toThrow();
  const result = readProviderQuotas({ one: endpoint("ep", { windows: Array.from({ length: 50 }, (_, i) => ({ label: String(i), usedPercent: 10 })) }) }, "node-1", url("?limit=2"), now);
  expect(result.windows).toHaveLength(2); expect(result.coverage.truncated).toBe(true);
  expect(readProviderQuotas({ one: endpoint("long", { accountId: "x".repeat(1025) }) }, "node-1", url(), now)).toMatchObject({ availability: "unknown", coverage: { truncated: true } });
  const many = Object.fromEntries(Array.from({ length: 1_001 }, (_, i) => [String(i), endpoint(String(i))]));
  expect(readProviderQuotas(many, "node-1", url(), now).coverage).toEqual({ endpointsScanned: 1_000, truncated: true });
});
class Response extends EventEmitter {
  status = 0; body = ""; writableEnded = false;
  writeHead(status: number) { this.status = status; }
  end(body = "") { this.body += body; this.writableEnded = true; }
}
test("router is machine-local, refuses remote/scoped/guest, and has no refresh IO", async () => {
  let reads = 0;
  const route = createBrokerHttpRouter({ host: "local", port: 1, nodeId: "node-1", runtime: { snapshot: () => { reads++; return { endpoints: {} }; } },
    webControl: new Proxy({}, { get() { throw new Error("no web access"); } }),
  } as unknown as BrokerHttpRouterDeps);
  for (const transportContext of [undefined, { transport: "remote" }, { transport: "local", scoped: {} }, { transport: "local", guest: {} }]) {
    const response = new Response();
    await route({ method: "GET", url: "/v1/provider-quotas?refresh=1", headers: {}, transportContext } as any, response as any);
    expect(response.status).toBe(transportContext ? 403 : 200);
    if (!transportContext) expect(JSON.parse(response.body)).toMatchObject({ availability: "unknown", refresh: "unsupported" });
  }
  expect(reads).toBe(1);
  const tier = meshRouteTierFor("GET", "/v1/provider-quotas"); expect(tier).toBe("local");
  expect(grantSatisfiesRouteTier("observe", tier)).toBe(false); expect(grantSatisfiesRouteTier("control", tier)).toBe(false);
});
