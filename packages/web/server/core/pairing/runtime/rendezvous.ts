import { hostname } from "node:os";

import type { NodeDefinition } from "@openscout/protocol";
import {
  resolveMeshRendezvousPublishConfig,
  startMeshRendezvousPublisher,
  type MeshRendezvousPublisher,
} from "@openscout/runtime";

import type { PairingRuntimeSnapshot } from "./runtime-state.ts";

export type PairingRendezvousPublisherOptions = {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  logger?: Pick<Console, "log" | "warn">;
  now?: () => number;
};

export function startPairingRendezvousPublisher(
  snapshot: () => PairingRuntimeSnapshot,
  options: PairingRendezvousPublisherOptions = {},
): MeshRendezvousPublisher | null {
  const config = resolveMeshRendezvousPublishConfig(options.env, {
    includeSettings: options.env === undefined,
  });
  if (!config) {
    return null;
  }

  return startMeshRendezvousPublisher(
    () => buildPairingRendezvousNode(snapshot(), {
      env: options.env,
      now: options.now?.() ?? Date.now(),
    }),
    {
      config,
      fetch: options.fetch,
      logger: options.logger ?? console,
    },
  );
}

export function buildPairingRendezvousNode(
  snapshot: PairingRuntimeSnapshot,
  options: { env?: NodeJS.ProcessEnv; now?: number } = {},
): NodeDefinition {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now();
  const meshId = readEnv(env, "OPENSCOUT_MESH_ID") ?? "openscout";
  const name = readEnv(env, "OPENSCOUT_NODE_NAME") ?? hostname();
  const nodeId = readEnv(env, "OPENSCOUT_NODE_ID") ?? normalizeNodeId(`${name}-${meshId}`);

  return {
    id: nodeId,
    meshId,
    name,
    advertiseScope: "mesh",
    registeredAt: snapshot.startedAt ?? now,
    lastSeenAt: now,
    // QR invitations are local consent, never mesh discovery metadata.
    meshEntrypoints: [],
  };
}

function readEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function normalizeNodeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "openscout-node";
}
