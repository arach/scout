import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ProviderQuotaRead, ProviderQuotaReadWindow } from "@openscout/protocol";
import { createScoutCommandContext } from "../context.ts";
import { parseScoutArgv } from "../argv.ts";
import { buildProviderQuotaMap, buildProviderUsageReport, parseProvidersCommandOptions, renderProviderUsageReport, runProvidersCommand } from "./providers.ts";

const NOW = 1_800_000_000_000;
function window(overrides: Partial<ProviderQuotaReadWindow> = {}): ProviderQuotaReadWindow {
  return { id: "quota-1", source: "provider_reported", provider: "openai", harness: "codex", transport: "codex_app_server",
    accountId: "Account A", userId: "user-1", endpointId: "endpoint-1", sessionId: "Opaque/Session ID", label: "weekly",
    usedPercent: 37, percentRemaining: 63, resetAt: NOW + 86_400_000, windowMs: 7 * 86_400_000, capturedAt: NOW - 30_000,
    ageMs: 30_000, observationSource: "codex.providerMeta.observeQuota", ...overrides };
}
function quota(windows = [window()], overrides: Partial<ProviderQuotaRead> = {}): ProviderQuotaRead {
  return { schema: "scout.provider-quotas/v1", generatedAt: NOW, availability: windows.length ? "available" : "unknown", refresh: "unsupported",
    windows, coverage: { endpointsScanned: windows.length, truncated: false }, ...overrides };
}
const format = { now: NOW, locale: "en-US", timeZone: "UTC" };
async function fixture(run: (value: { context: ReturnType<typeof createScoutCommandContext>; lines: string[]; paths: URL[] }) => Promise<void>, response: (url: URL) => Response = url => Response.json(quota(undefined, { refresh: url.searchParams.has("refresh") ? "unsupported" : "not_requested" })), mode: "json" | "plain" = "json") {
  const lines: string[] = [], paths: URL[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) { const url = new URL(request.url); paths.push(url); return response(url); } });
  const context = createScoutCommandContext({ env: { OPENSCOUT_BROKER_URL: server.url.origin, OPENSCOUT_WEB_URL: "http://127.0.0.1:1", OPENSCOUT_WEB_AUTH_TOKEN: "never-send" }, outputMode: mode, stdout: line => lines.push(line), stderr() {}, isTty: false });
  try { await run({ context, lines, paths }); } finally { await server.stop(true); }
}

describe("passive runtime provider quota consumer", () => {
  test("default refresh is reported unsupported without rewriting provenance or capture time", async () => {
    await fixture(async ({ context, lines, paths }) => {
      await runProvidersCommand(context, ["usage"], format);
      expect(paths.map(url => url.pathname)).toEqual(["/v1/provider-quotas"]);
      expect(Object.fromEntries(paths[0]!.searchParams)).toEqual({ limit: "200", refresh: "1" });
      const report = JSON.parse(lines[0]!);
      expect(report).toMatchObject({ schema: "scout.provider-usage/v1", availability: "available", refresh: "unsupported", generatedAt: NOW });
      expect(report.providers[0].identity).toMatchObject({ provider: "openai", accountId: "Account A", endpointId: "endpoint-1", sessionId: "Opaque/Session ID" });
      expect(report.providers[0].windows[0].facts).toEqual(window());
      expect(report.providers[0].windows[0].freshness).toMatchObject({ capturedAt: NOW - 30_000, ageMs: 30_000, stale: false });
    });
  });
  test("cached mode remains passive and text never claims a successful refresh", async () => {
    for (const cached of [false, true]) await fixture(async ({ context, lines, paths }) => {
      await runProvidersCommand(context, ["usage", ...(cached ? ["--cached"] : ["--refresh"])], format);
      expect(paths[0]!.searchParams.get("refresh")).toBe(cached ? null : "1");
      expect(lines[0]).toContain(cached ? "refresh not requested" : "Refresh unsupported");
      expect(lines[0]).not.toContain("Force live");
    }, undefined, "plain");
  });
  test("two accounts on one provider never collapse into one usage row", () => {
    const facts = [window(), window({ id: "quota-2", accountId: "Account B", endpointId: "endpoint-2", usedPercent: 90, percentRemaining: 10 })];
    const report = buildProviderUsageReport(quota(facts), format);
    expect(report.providers).toHaveLength(2);
    expect(new Set(report.providers.map(pool => pool.poolId)).size).toBe(2);
    expect(report.providers.map(pool => pool.identity.accountId)).toEqual(["Account A", "Account B"]);
    expect(report.providers.map(pool => pool.windows[0]!.facts)).toEqual(facts);
    const text = renderProviderUsageReport(report);
    expect(text).toContain('account "Account A"'); expect(text).toContain('account "Account B"');
    expect(text).toContain('endpoint "endpoint-1"'); expect(text).toContain('endpoint "endpoint-2"');
    const sharedEndpoint = buildProviderUsageReport(quota([window(), window({ id: "another-account", accountId: "Account B" })]), format);
    expect(sharedEndpoint.providers).toHaveLength(2);
    expect(() => buildProviderQuotaMap(sharedEndpoint, { now: NOW })).toThrow("pool_ambiguous");
  });
  test("same account across endpoints/sessions remains separate, while its windows stay distinct", () => {
    const report = buildProviderUsageReport(quota([window(), window({ id: "5h", label: "5h" }), window({ id: "other", endpointId: "endpoint-2", sessionId: "session-2" })]), format);
    expect(report.providers).toHaveLength(2); expect(report.providers[0]!.windows).toHaveLength(2);
    expect(() => buildProviderQuotaMap(report, { now: NOW })).toThrow("pool_ambiguous");
  });
  test("retains existing flag grammar and preserves account case without new pool selectors", () => {
    expect(parseProvidersCommandOptions(["map", "--role", "implementation", "--cached"])).toEqual({ command: "map", role: "implementation", forceRefresh: false });
    const args = ["providers", "map", "--role", "implementation", "--json"];
    expect(parseScoutArgv(args)).toMatchObject({ command: "providers", args: args.slice(1, -1), outputMode: "json" });
    const report = buildProviderUsageReport(quota([window(), window({ id: "case", accountId: "account a" })]), format);
    expect(report.providers.map(pool => pool.identity.accountId)).toEqual(["Account A", "account a"]);
    for (const args of [["usage", "--account", "Account A"], ["map", "--endpoint", "endpoint-1"]]) expect(() => parseProvidersCommandOptions(args)).toThrow(`unknown providers ${args[0]} option: ${args[1]}`);
  });
  test("ambiguous map refuses instead of last-account-wins or an average", async () => {
    await fixture(async ({ context, lines }) => {
      await expect(runProvidersCommand(context, ["map"], format)).rejects.toThrow("pool_ambiguous"); expect(lines).toEqual([]);
    }, () => Response.json(quota([window(), window({ id: "two", accountId: "Account B", endpointId: "endpoint-2" })])));
  });
  test("single-pool map retains exact quota basis and does not promise account-bound dispatch", async () => {
    await fixture(async ({ context, lines, paths }) => {
      await runProvidersCommand(context, ["map", "--role", "implementation"], format);
      const map = JSON.parse(lines[0]!);
      expect(map.quotaRead.providers).toHaveLength(1);
      expect(map.quotaBasis).toEqual([{ providerId: "codex", poolId: map.quotaRead.providers[0].poolId, identity: expect.objectContaining({ provider: "openai", accountId: "Account B", endpointId: "endpoint-2" }) }]);
      expect(map.accountBinding).toBe("not_enforced"); expect(map.assignments).toHaveLength(1);
      expect(paths[0]!.searchParams.has("endpointId")).toBe(false); // Do not invent new runtime selector parameters.
    }, () => Response.json(quota([window({ id: "two", accountId: "Account B", endpointId: "endpoint-2" })])));
  });
  test("map text names the account/endpoint observation basis", async () => {
    await fixture(async ({ context, lines }) => {
      await runProvidersCommand(context, ["map"], format);
      expect(lines[0]).toContain('account "Account A"'); expect(lines[0]).toContain('endpoint "endpoint-1"'); expect(lines[0]).toContain("Refresh unsupported"); expect(lines[0]).toContain("Account binding is not enforced");
    }, undefined, "plain");
  });
  test("missing account identity stays unknown, is never substituted with user identity, and cannot feed map guidance", () => {
    const report = buildProviderUsageReport(quota([window({ accountId: undefined })]), format);
    expect(report.providers[0]!.identity.accountId).toBeNull();
    expect(renderProviderUsageReport(report)).toContain("account (unknown)");
    expect(() => buildProviderQuotaMap(report, { now: NOW })).toThrow("identity_unknown");
    expect(buildProviderUsageReport(quota([window({ accountId: undefined }), window({ id: "anon-2", accountId: undefined, label: "5h" })]), format).providers).toHaveLength(2);
  });
  test("no facts is explicitly unknown, not zero or successful empty quota; map refuses", async () => {
    await fixture(async ({ context, lines }) => {
      await runProvidersCommand(context, ["usage"], format);
      expect(JSON.parse(lines[0]!)).toMatchObject({ availability: "unknown", providers: [], refresh: "unsupported" });
      await expect(runProvidersCommand(context, ["map"], format)).rejects.toThrow("provider_quotas_unknown");
    }, () => Response.json(quota([])));
    const text = renderProviderUsageReport(buildProviderUsageReport(quota([]), format));
    expect(text).toContain("unknown"); expect(text).not.toContain("0 windows"); expect(text).not.toContain("0% used");
  });
  test("explicit observed zero is valid, unlike absent numeric facts", () => {
    const report = buildProviderUsageReport(quota([window({ usedPercent: 0, percentRemaining: 100 })]), format);
    expect(report.providers[0]!.windows[0]!.usedPercent).toBe(0);
    expect(report.availability).toBe("available");
    expect(() => buildProviderUsageReport(quota([window({ usedPercent: undefined, percentRemaining: undefined })]), format)).toThrow("invalid_response");
    expect(buildProviderUsageReport(quota([window({ usedPercent: undefined, percentRemaining: 63 })]), format).providers[0]!.windows[0]!.usedPercent).toBe(37);
  });
  test("stale-only facts keep their values and timestamps but never feed current map guidance", () => {
    const facts = window({ capturedAt: NOW - 7_200_000, ageMs: 7_200_000 });
    const report = buildProviderUsageReport(quota([facts]), format);
    expect(report.availability).toBe("stale"); expect(report.providers[0]!.windows[0]!.facts).toEqual(facts);
    expect(renderProviderUsageReport(report)).toContain("historical facts, not current capacity");
    expect(() => buildProviderQuotaMap(report, { now: NOW })).toThrow("provider_quotas_stale");
  });
  test("waiting, refresh or an old reset cannot make observations fresh", () => {
    const body = quota();
    const later = buildProviderUsageReport(body, { ...format, now: NOW + 3_600_000 });
    expect(later.providers[0]!.windows[0]!.freshness.stale).toBe(true);
    expect(later.providers[0]!.windows[0]!.facts.capturedAt).toBe(NOW - 30_000);
    const reset = buildProviderUsageReport(quota([window({ resetAt: NOW - 1 })]), format);
    expect(reset.providers[0]!.windows[0]!.freshness.stale).toBe(true);
    const badAge = buildProviderUsageReport(quota([window({ ageMs: 0, capturedAt: NOW - 7_200_000 })]), format);
    expect(badAge.providers[0]!.windows[0]!.freshness.stale).toBe(true);
    const earlierClient = buildProviderUsageReport(body, { ...format, now: NOW - 60_000 });
    expect(earlierClient.providers[0]!.windows[0]!.freshness.ageMs).toBe(30_000);
  });
  test("incomplete coverage is visible in usage and blocks mapping", () => {
    const report = buildProviderUsageReport(quota(undefined, { coverage: { endpointsScanned: 1000, truncated: true } }), format);
    expect(report.coverage.truncated).toBe(true); expect(renderProviderUsageReport(report)).toContain("Incomplete observation coverage");
    expect(() => buildProviderQuotaMap(report, { now: NOW })).toThrow("coverage_incomplete");
  });
  test("future providers stay visible in usage but need a routing policy before mapping", () => {
    const report = buildProviderUsageReport(quota([window({ provider: "future-provider" })]), format);
    expect(report.providers[0]!.id).toBe("future-provider");
    expect(() => buildProviderQuotaMap(report, { now: NOW })).toThrow("provider_unsupported");
  });
  test("real HTTP unavailability/refusal never becomes unknown-empty data or a web retry", async () => {
    for (const status of [503, 403, 404]) await fixture(async ({ context, paths, lines }) => {
      await expect(runProvidersCommand(context, ["usage"], format)).rejects.toThrow(`HTTP ${status}`);
      expect(paths).toHaveLength(1); expect(paths[0]!.pathname).toBe("/v1/provider-quotas"); expect(lines).toEqual([]);
    }, () => Response.json({ error: "provider_quotas_unavailable" }, { status }));
  });
  test("uses the selected Unix broker socket without falling back to HTTP/web", async () => {
    const dir = mkdtempSync(join(tmpdir(), "provider_read_"));
    const paths: string[] = [];
    const server = Bun.serve({ unix: join(dir, "control.sock"), fetch(request) { paths.push(new URL(request.url).pathname); return Response.json(quota()); } });
    const lines: string[] = [];
    const context = createScoutCommandContext({ env: { OPENSCOUT_BROKER_URL: "http://127.0.0.1:1", OPENSCOUT_BROKER_SOCKET_PATH: join(dir, "control.sock") }, outputMode: "json", stdout: line => lines.push(line) });
    try { await runProvidersCommand(context, ["usage"], format); expect(paths).toEqual(["/v1/provider-quotas"]); expect(JSON.parse(lines[0]!).refresh).toBe("unsupported"); }
    finally { await server.stop(true); rmSync(dir, { recursive: true, force: true }); }
  });
  test("malformed or contradictory response state cannot silently become an empty/zero quota", () => {
    for (const body of [quota([], { availability: "available" }), quota([window()], { availability: "unknown" }), quota([window({ capturedAt: NOW + 1 })]), quota([window({ usedPercent: NaN })]), quota([window({ percentRemaining: 0 })]), quota([window({ resetAt: Infinity })])]) expect(() => buildProviderUsageReport(body, format)).toThrow("invalid_response");
  });
  test("a passive runtime cannot pretend a refresh succeeded", async () => {
    await fixture(async ({ context, lines }) => { await expect(runProvidersCommand(context, ["usage", "--refresh"], format)).rejects.toThrow("passive runtime"); expect(lines).toEqual([]); }, () => Response.json(quota(undefined, { refresh: "not_requested" })));
  });
  test("help does not read the broker", async () => {
    await fixture(async ({ context, paths }) => { await runProvidersCommand(context, ["help"], format); await runProvidersCommand(context, ["map", "--help"], format); expect(paths).toEqual([]); });
  });
});
