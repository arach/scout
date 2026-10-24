import type { RuntimeEnv } from "./portable-types.js";
import {
  buildUnsignedMeshPresence,
  type MobilePairingMeshEntrypoint,
  type NodeDefinition,
  type NodeMeshEntrypoint,
  type OpenScoutMeshPresence,
} from "@openscout/protocol";

import { isLoopbackHost } from "./broker-process-manager.js";
import { meshBridgeCredentialSource } from "./mesh-bridge-credential.js";
import { readOpenScoutNetworkSettingsSync } from "./open-scout-network.js";
import { resolveOpenScoutSupportPaths } from "./support-paths.js";

export interface MeshRendezvousPublishConfig {
  url: string;
  token?: string;
  sessionToken?: string;
  /**
   * The host's own approval, read before each publish (mesh-bridge-credential.ts).
   * Set when the environment carries no token or session.
   */
  hostCredential?: () => Promise<string | null>;
  ttlMs: number;
  intervalMs: number;
}

export interface MeshRendezvousPublisher {
  publishNow(): Promise<void>;
  stop(): void;
}

export interface MeshRendezvousPublisherOptions {
  config: MeshRendezvousPublishConfig;
  fetch?: typeof fetch;
  logger?: Pick<Console, "log" | "warn">;
}

export type MeshRendezvousNodeSource = NodeDefinition | (() => NodeDefinition);

const DEFAULT_RENDEZVOUS_TTL_MS = 60_000;
const DEFAULT_RENDEZVOUS_INTERVAL_MS = 30_000;

class MeshRendezvousPublishError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "MeshRendezvousPublishError";
  }
}

export function resolveMeshRendezvousPublishConfig(
  env: RuntimeEnv = process.env,
  options: { includeSettings?: boolean } = {},
): MeshRendezvousPublishConfig | undefined {
  const explicitUrl = env.OPENSCOUT_MESH_RENDEZVOUS_URL?.trim();
  if (explicitUrl?.toLowerCase() === "false" || explicitUrl === "0") {
    return undefined;
  }
  const includeSettings = options.includeSettings ?? true;
  const settings = includeSettings ? readOpenScoutNetworkSettingsSync() : null;
  const rawUrl = explicitUrl || (settings?.discoveryEnabled ? settings.rendezvousUrl : "");
  if (!rawUrl) {
    return undefined;
  }

  const token = env.OPENSCOUT_MESH_RENDEZVOUS_TOKEN?.trim() || undefined;
  const sessionToken = env.OPENSCOUT_MESH_RENDEZVOUS_SESSION?.trim() || undefined;
  const allowAnonymous = readBooleanFlag(env.OPENSCOUT_MESH_RENDEZVOUS_ALLOW_ANONYMOUS);
  // With no token or session from the environment, the host publishes with
  // its own approval: the credential its mesh bridge holds.
  const hostCredential = !token && !sessionToken && !allowAnonymous && includeSettings
    ? meshBridgeCredentialSource({ supportDirectory: resolveOpenScoutSupportPaths().supportDirectory })
    : undefined;
  if (!token && !sessionToken && !hostCredential && !allowAnonymous) {
    return undefined;
  }

  return {
    url: rawUrl.replace(/\/$/, ""),
    token,
    sessionToken: sessionToken || undefined,
    ...(hostCredential ? { hostCredential } : {}),
    ttlMs: readPositiveInteger(env.OPENSCOUT_MESH_RENDEZVOUS_TTL_MS, DEFAULT_RENDEZVOUS_TTL_MS),
    intervalMs: readPositiveInteger(env.OPENSCOUT_MESH_RENDEZVOUS_INTERVAL_MS, DEFAULT_RENDEZVOUS_INTERVAL_MS),
  };
}

export function buildMeshRendezvousPresence(
  node: NodeDefinition,
  options: { issuedAt?: number; ttlMs?: number } = {},
): OpenScoutMeshPresence | undefined {
  const entrypoints = reachableEntrypointsForNode(node);
  if (entrypoints.length === 0) {
    return undefined;
  }

  return buildUnsignedMeshPresence({
    node,
    entrypoints,
    issuedAt: options.issuedAt,
    ttlMs: options.ttlMs,
    metadata: {
      source: "openscout-runtime",
    },
  });
}

/** `hostCredential` is the host's approval, already read; a host without one publishes nothing. */
export async function publishMeshRendezvousPresence(
  node: NodeDefinition,
  options: MeshRendezvousPublisherOptions,
  hostCredential?: string,
): Promise<boolean> {
  const presence = buildMeshRendezvousPresence(node, { ttlMs: options.config.ttlMs });
  if (!presence) {
    options.logger?.warn("[openscout-runtime] mesh rendezvous skipped: no reachable entrypoints to publish");
    return false;
  }
  const credential = hostCredential ?? (await options.config.hostCredential?.()) ?? undefined;
  if (options.config.hostCredential && !credential) {
    return false;
  }

  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(`${options.config.url}/v1/presence`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...rendezvousAuthHeaders(options.config, credential),
    },
    body: JSON.stringify(presence),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new MeshRendezvousPublishError(
      response.status,
      `rendezvous publish failed: ${response.status} ${response.statusText}${detail ? ` ${detail}` : ""}`,
    );
  }

  return true;
}

export function startMeshRendezvousPublisher(
  node: MeshRendezvousNodeSource,
  options: MeshRendezvousPublisherOptions,
): MeshRendezvousPublisher {
  let stopped = false;
  let suspendedForAuth = false;
  let inFlight: Promise<void> | null = null;
  // Logged when they change, not on every beat.
  let publishing = false;
  let waitingForApproval = false;
  // The host credential the rendezvous refused; a new approval replaces it.
  let refusedCredential: string | null = null;

  const publishOnce = async () => {
    let credential: string | undefined;
    if (options.config.hostCredential) {
      credential = (await options.config.hostCredential()) ?? undefined;
      if (!credential && !waitingForApproval) {
        options.logger?.log("[openscout-runtime] mesh rendezvous waits for this host's approval: run `scout mesh bridge connect`");
      }
      waitingForApproval = !credential;
      if (!credential || credential === refusedCredential) return;
    }
    try {
      if (await publishMeshRendezvousPresence(resolveNodeSource(node), options, credential)) {
        if (!publishing) {
          options.logger?.log(`[openscout-runtime] published mesh rendezvous presence to ${options.config.url}`);
        }
        publishing = true;
      }
    } catch (error) {
      publishing = false;
      if (
        error instanceof MeshRendezvousPublishError
        && (error.status === 401 || error.status === 403)
      ) {
        if (credential) {
          refusedCredential = credential;
          options.logger?.warn(
            `[openscout-runtime] mesh rendezvous refused this host's credential; publishing resumes once the host is approved again (scout mesh bridge connect): ${error.message}`,
          );
          return;
        }
        suspendedForAuth = true;
        options.logger?.warn(
          `[openscout-runtime] mesh rendezvous authentication rejected; publishing is suspended until restart: ${error.message}`,
        );
        return;
      }
      options.logger?.warn(`[openscout-runtime] mesh rendezvous publish failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const publishNow = async () => {
    if (stopped || suspendedForAuth) return;
    if (inFlight) {
      await inFlight;
      return;
    }
    inFlight = publishOnce().finally(() => {
      inFlight = null;
    });
    await inFlight;
  };

  const timer = setInterval(() => {
    publishNow().catch(() => undefined);
  }, options.config.intervalMs);
  timer.unref();
  publishNow().catch(() => undefined);

  return {
    publishNow,
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

/** @deprecated Pairing invitations are local-only and no longer published. */
export function readMobilePairingMeshEntrypoint(
  env: RuntimeEnv = process.env,
  now: number = Date.now(),
): MobilePairingMeshEntrypoint | undefined {
  void env;
  void now;
  return undefined;
}

/** @deprecated Pairing invitations are local-only and no longer published. */
export function mobilePairingMeshEntrypointFromSnapshot(
  input: unknown,
  now: number = Date.now(),
): MobilePairingMeshEntrypoint | undefined {
  // Kept as a compatibility export. Pairing invitations must not be published
  // to rendezvous, and existing mobile_pairing decoders require a room.
  void input;
  void now;
  return undefined;
}

function reachableEntrypointsForNode(node: NodeDefinition): NodeMeshEntrypoint[] {
  const entrypoints = (node.meshEntrypoints ?? []).filter(entrypoint => entrypoint.kind !== "mobile_pairing");
  if (node.brokerUrl && isReachableHttpUrl(node.brokerUrl)) {
    entrypoints.push({
      kind: "http",
      url: node.brokerUrl,
      lastSeenAt: node.lastSeenAt,
    });
  }
  return entrypoints;
}

function resolveNodeSource(source: MeshRendezvousNodeSource): NodeDefinition {
  return typeof source === "function" ? source() : source;
}

function rendezvousAuthHeaders(config: MeshRendezvousPublishConfig, hostCredential?: string): { authorization?: string } {
  if (config.sessionToken) {
    return { authorization: osnSessionAuthHeader(config.sessionToken) };
  }
  if (config.token) {
    return { authorization: `Bearer ${config.token}` };
  }
  if (hostCredential) {
    return { authorization: `Bearer ${hostCredential}` };
  }
  return {};
}

function osnSessionAuthHeader(sessionToken: string): string {
  return sessionToken.startsWith("osn_session_")
    ? `Bearer ${sessionToken}`
    : `Bearer osn_session_${sessionToken}`;
}

function isReachableHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBooleanFlag(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}
