/** Compiled first-party runtime witness. Run after the runtime build on Node 24. */
import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pairingTrustOwner, PairingTrustOwner} from "../packages/runtime/dist/pairing-security/trust-owner.js";

assert.equal(Number(process.versions.node.split(".")[0]), 24, "qualification requires Node 24");
const root = mkdtempSync(join(tmpdir(), "pairing-capsule-compiled-"));
try {
  const owner = pairingTrustOwner(root), peer = {publicKey: "a".repeat(64), pairedAt: "date"};
  owner.mutate(0, "seed", {type: "grant", peer});
  const legacy = readFileSync(join(root, "trusted-peers.owner.1.json")), stamp = owner.pairingAuthorityStamp();
  const receipt = owner.migrateToCapsule("compiled-cut");
  assert.equal(owner.pairingAuthorityStamp(), stamp);
  assert.deepEqual(owner.migrateToCapsule("compiled-cut"), receipt);
  assert.ok(!readdirSync(root).includes(".pairing-cutover"));
  const revoked = owner.mutate(1, "revoke", {type: "revoke", publicKey: peer.publicKey});
  assert.deepEqual(owner.mutate(1, "revoke", {type: "revoke", publicKey: peer.publicKey}), revoked);
  assert.equal(owner.read().peers.length, 0);
  const head = JSON.parse(readFileSync(join(root, "trusted-peers.v2.commit.2.json"), "utf8")).capsule;
  const path = join(root, head.parts[0].name), bytes = readFileSync(path, "utf8");
  writeFileSync(path, bytes.replace('"seed"', '"bad!"'));
  assert.throws(() => owner.read(), /capsule_chunk_checksum/);
  assert.throws(() => new PairingTrustOwner(root).read(), /capsule_chunk_checksum/);
  writeFileSync(path, bytes);
  writeFileSync(join(root, "trusted-peers.owner.1.json"), legacy, {mode: 0o600});
  assert.throws(() => owner.read(), /capsule_unexpected_history/);
  console.log(JSON.stringify({node: process.version, compiledOwner: true, realMigration: true,
    stampPreserved: true, exactRetry: true, realRevoke: true, freshCorruptionAndResurrectionRefusal: true}));
} finally {rmSync(root, {recursive: true, force: true});}
