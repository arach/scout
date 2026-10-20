import { redactDiagnosticText } from "./diagnostic-report.js";
import type { ProbeSnapshot } from "./system-probes/registry.js";
import type { TailscaleStatusSummary } from "./system-probes/tailscale-status.js";

export type EffectiveMeshSettings = {
  nodeId: string; nodeName: string; meshId: string;
  advertiseScope: "local" | "mesh"; brokerUrl: string;
  seedUrls: string[]; discoveryIntervalMs: number;
};

const text = (value: string | undefined, max = 256) =>
  value === undefined ? null : redactDiagnosticText(value).slice(0, max);

/** Settings URLs disclose origins only, never userinfo, paths, queries or fragments. */
function origin(value: string): string | null {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.origin.slice(0, 512) : null;
  } catch { return null; }
}

/** Build a bounded allowlist, not a projection of the process environment. */
export function meshDiagnostics(
  probe: ProbeSnapshot<TailscaleStatusSummary | null>, settings: EffectiveMeshSettings, now = Date.now(),
) {
  const value = probe.value;
  const peers = value?.peers ?? [];
  return {
    generatedAt: now,
    settings: {
      nodeId: text(settings.nodeId), nodeName: text(settings.nodeName), meshId: text(settings.meshId),
      advertiseScope: settings.advertiseScope,
      brokerOrigin: origin(settings.brokerUrl),
      seedOrigins: settings.seedUrls.slice(0, 32).map(origin).filter((url): url is string => url !== null),
      discoveryIntervalMs: Number.isFinite(settings.discoveryIntervalMs) && settings.discoveryIntervalMs > 0
        ? settings.discoveryIntervalMs : null,
    },
    tailscale: {
      unavailable: value === null,
      status: probe.status, at: probe.at, ageMs: probe.ageMs,
      stale: probe.stale, refreshing: probe.refreshing, backend: probe.backend,
      // Probe error text may contain command arguments or fixture paths. Do not return it.
      error: probe.error ? { code: "probe_failed", at: probe.error.at, timedOut: probe.error.timedOut === true } : null,
      running: value?.running ?? null, backendState: text(value?.backendState ?? undefined),
      health: (value?.health ?? []).slice(0, 16).map(message => text(message, 512)),
      healthTruncated: (value?.health.length ?? 0) > 16,
      peerCount: peers.length, onlinePeerCount: peers.filter(peer => peer.online).length,
      peers: peers.slice(0, 128).map(peer => ({
        id: text(peer.id), name: text(peer.name), dnsName: text(peer.dnsName),
        hostName: text(peer.hostName), os: text(peer.os), online: peer.online,
        addresses: peer.addresses.slice(0, 8).map(address => text(address, 64)),
      })),
      peersTruncated: peers.length > 128,
      self: value?.self ? {
        id: text(value.self.id), name: text(value.self.name), dnsName: text(value.self.dnsName),
        online: value.self.online, addresses: value.self.addresses.slice(0, 8).map(address => text(address, 64)),
      } : null,
    },
  };
}
export type MeshDiagnostics = ReturnType<typeof meshDiagnostics>;
