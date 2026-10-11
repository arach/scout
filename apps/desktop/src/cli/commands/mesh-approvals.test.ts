import { describe, expect, test } from "bun:test";
import type { TrustedPeerRecord } from "@openscout/protocol";

import { resolveTrustedPeer } from "./mesh-approvals.ts";

function peer(keyId: string, label: string, nodeId?: string, patch: Partial<TrustedPeerRecord> = {}): TrustedPeerRecord {
  return {
    keyId,
    publicKey: "",
    fingerprint: `osc1:${keyId.slice(0, 4)}-${keyId.slice(4, 8)}`,
    label,
    ...(nodeId ? { nodeId } : {}),
    tier: "control",
    grantedVia: "sas",
    grantedAt: 1,
    ...patch,
  };
}

const PEERS = [
  peer("3be4111db2778fd5aaaa", "arts-mini", "arts-mini-openscout"),
  peer("9c01aa22bb33cc44dddd", "air", "air-openscout"),
  peer("ffff000011112222eeee", "old", "old-openscout", { revokedAt: 5 }),
];

describe("mesh approvals peer reference", () => {
  test("label, node id, short node name and key prefix all resolve", () => {
    expect(resolveTrustedPeer(PEERS, "arts-mini").keyId).toBe("3be4111db2778fd5aaaa");
    expect(resolveTrustedPeer(PEERS, "air-openscout").label).toBe("air");
    expect(resolveTrustedPeer(PEERS, "3be4111d").label).toBe("arts-mini");
  });

  test("revoked or unknown peers are refused", () => {
    expect(() => resolveTrustedPeer(PEERS, "old")).toThrow("no trusted peer");
    expect(() => resolveTrustedPeer(PEERS, "3be4")).toThrow("no trusted peer");
  });
});
