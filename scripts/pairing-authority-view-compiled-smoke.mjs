/** Emitted owner API witness, after test:pairing-cutover:compiled builds it. */
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pairingTrustOwner} from "../packages/runtime/dist/pairing-security/trust-owner.js";
assert.equal(Number(process.versions.node.split(".")[0]),24);
const root=mkdtempSync(join(tmpdir(),"pairing-capsule-view-compiled-"));
try {
 const owner=pairingTrustOwner(root),peer={publicKey:"a".repeat(64),pairedAt:"date"};
 owner.mutate(0,"seed",{type:"grant",peer});owner.migrateToCapsule("view-cut");
 const view=owner.readAuthority();assert.equal(view.stamp,owner.pairingAuthorityStamp());assert.deepEqual(view.peers,owner.read().peers);
 owner.mutate(1,"revoke",{type:"revoke",publicKey:peer.publicKey});
 assert.equal(owner.readAuthority().peers.length,0);assert.notEqual(owner.readAuthority().stamp,view.stamp);
 console.log(JSON.stringify({node:process.version,emittedAuthorityView:true,stampEquivalent:true,freshRevocation:true}));
} finally {rmSync(root,{recursive:true,force:true});}
