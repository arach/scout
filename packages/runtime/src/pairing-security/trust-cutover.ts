/** Internal cutover codec. No filesystem operations or activation on import. */
import type { TrustedPeer } from "./trust-owner.js";
import {
  pack, digest, commitName, doneName, CUTOVER,
  type CapsuleBarrier, type CapsuleHead, type CapsulePart, type ManagedPolicy,
} from "./trust-capsule.js";

export const CUT_DIRECTORY = ".pairing-cutover";
export const RESERVATION_FILES = 320;
export const RESERVATION_BYTES = RESERVATION_FILES * 1024 * 1024;
export const reserveName = (index: number) => `reserve.${String(index).padStart(3, "0")}`;
export const cutChild = (name: string) => `${CUT_DIRECTORY}/${name}`;
export const cutName = (name: string) => /^(?:claim\.json|plan\.json|barrier\.json|reserve\.[0-9]{3}|retire\.[a-f0-9-]{36}\.json|trusted-peers\.v2\.(?:data\.[a-f0-9-]{36}|commit\.1|done\.1|cutover)\.json)$/.test(name);
export type CutClaim = {rootId: string; token: string; identity: string; migrationId: string};
export type CutFile = {name: string; sha256: string; bytes: number; count: number};
export type CutRetired = {name: string; sha256: string; bytes: number; identity: string};
export type CutPlan = CutClaim & {
  schema: "scout.pairing-cutover-plan/v2";
  revision: number; logicalHead: string; logicalPeersHash: string;
  checkpointPeersHash: string; projectionHash: string; peers: TrustedPeer[];
  outcomesDigest: string; chargedBytes: number; policy: ManagedPolicy | null;
  parts: CapsulePart[]; inventories: CutFile[];
  adoption: CapsuleHead["adoption"];
};
export type CutResult = Readonly<{migrationId: string; revision: number; logicalHead: string}>;

/** Exact initial bodies are derivable from the barrier-authenticated plan.
 * Helpers consume prewritten sources; this function never creates a file. */
export function cutBodies(plan: CutPlan, planHash: string) {
  const barrier: CapsuleBarrier = {
    schema: "scout.pairing-cut/v2", rootId: plan.rootId, revision: plan.revision,
    logicalHead: plan.logicalHead, logicalPeersHash: plan.logicalPeersHash,
    checkpointPeersHash: plan.checkpointPeersHash, projectionHash: plan.projectionHash,
    outcomesDigest: plan.outcomesDigest, chargedBytes: plan.chargedBytes,
    policy: plan.policy, parts: plan.parts,
    migration: {migrationId: plan.migrationId, token: plan.token, identity: plan.identity, planHash},
  };
  const barrierBytes = pack("barrier", barrier), cutHash = digest(barrierBytes);
  const head: CapsuleHead = {
    schema: "scout.pairing-capsule/v2", rootId: plan.rootId, cutHash,
    serial: 1, revision: plan.revision, logicalHead: plan.logicalHead,
    previousLogicalHead: plan.logicalHead, previousPhysicalHead: cutHash,
    logicalPeersHash: plan.logicalPeersHash, checkpointPeersHash: plan.checkpointPeersHash,
    projectionHash: plan.projectionHash, peers: plan.peers, policy: plan.policy,
    outcomesDigest: plan.outcomesDigest, chargedBytes: plan.chargedBytes,
    parts: plan.parts, adoption: plan.adoption, slot: null, retire: [],
  };
  const headBytes = pack("capsule", head);
  const files: [string, string][] = [
    [commitName(1), headBytes],
    [doneName(1), pack("receipt", {schema: "scout.pairing-collected/v2", rootId: plan.rootId,
      serial: 1, physicalHash: digest(headBytes)})],
    [CUTOVER, pack("receipt", {schema: "scout.pairing-cutover-done/v2", rootId: plan.rootId,
      cutHash, migrationId: plan.migrationId})],
  ];
  return {barrier, barrierBytes, cutHash, head, files,
    barrierName: `trusted-peers.owner.${plan.revision + 1}.json`};
}
