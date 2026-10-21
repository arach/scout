import type { AgentEndpoint, ProviderQuotaRead, ProviderQuotaReadWindow } from "@openscout/protocol";
import { budgetObservationsFromEndpoint } from "./budget-observations.js";

const MAX_ENDPOINTS = 1_000;
const MAX_WINDOWS_PER_ENDPOINT = 8;
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
/** Read already-observed public adapter metadata only, with no IO or DB writer. */
export function readProviderQuotas(endpoints: Record<string, AgentEndpoint>, nodeId: string, url: URL, now = Date.now()): ProviderQuotaRead {
  for (const key of url.searchParams.keys()) {
    if (!["refresh", "limit"].includes(key) || url.searchParams.getAll(key).length !== 1) throw new TypeError("Invalid quota query.");
  }
  const limit = Number(url.searchParams.get("limit") ?? 100);
  const refresh = url.searchParams.get("refresh");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200 || (refresh !== null && !["1", "true", "0", "false"].includes(refresh))) throw new TypeError("Invalid quota query.");
  const windows: ProviderQuotaReadWindow[] = [];
  let scanned = 0, truncated = false;
  // Iteration stops at the scan budget; do not copy an unbounded endpoint map.
  for (const id in endpoints) {
    if (!Object.hasOwn(endpoints, id)) continue;
    if (scanned >= MAX_ENDPOINTS) { truncated = true; break; }
    scanned++;
    const endpoint = endpoints[id];
    if (endpoint.nodeId !== nodeId || !/^(codex|claude|claude-code)$/u.test(endpoint.harness)) continue;
    const metadata = record(endpoint.metadata), providerMeta = record(metadata?.providerMeta), quota = record(providerMeta?.observeQuota);
    // Do not let the adapter's generic fallback replace missing capture time with now.
    if (typeof quota?.capturedAt !== "number" || !Number.isFinite(quota.capturedAt) || quota.capturedAt <= 0 || quota.capturedAt > now) continue;
    const raw = Array.isArray(quota.windows) ? quota.windows : [];
    if (raw.length > MAX_WINDOWS_PER_ENDPOINT) truncated = true;
    const bounded = { ...endpoint, metadata: { providerMeta: { ...providerMeta, observeUsage: undefined, observeQuota: { ...quota, windows: raw.slice(0, MAX_WINDOWS_PER_ENDPOINT) } } } };
    for (const window of budgetObservationsFromEndpoint(bounded, now).quotaWindows) {
      // The existing collector emits both current and hourly-history rows.
      if (window.id.startsWith("budget:quota:history:")) continue;
      if (window.usedPercent === undefined && window.percentRemaining === undefined && !(window.used !== undefined && window.limit !== undefined && window.limit > 0)) continue;
      if ([window.usedPercent, window.percentRemaining].some(value => value !== undefined && (value < 0 || value > 100))) continue;
      // Runtime records may contain long optional labels/identity fields; do not
      // turn a bounded window count into an unbounded response body.
      if (Object.entries(window).some(([key, value]) => key !== "metadata" && typeof value === "string" && value.length > 1024)
        || [window.used, window.limit, window.windowMs].some(value => value !== undefined && value < 0)) { truncated = true; continue; }
      if (windows.length >= limit) { truncated = true; continue; }
      const { metadata: provenance, createdAt: _createdAt, ...facts } = window;
      windows.push({ ...facts, ageMs: now - window.capturedAt, observationSource: String(provenance?.source ?? "public_adapter.observeQuota") });
    }
  }
  return { schema: "scout.provider-quotas/v1", generatedAt: now, availability: windows.length ? "available" : "unknown",
    refresh: refresh === "1" || refresh === "true" ? "unsupported" : "not_requested", windows,
    coverage: { endpointsScanned: scanned, truncated } };
}
