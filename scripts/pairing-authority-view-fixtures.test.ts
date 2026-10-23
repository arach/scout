/** Replay the EXISTING capsule corruption/refusal/boundary fixtures through the
 * view flavor. Run with --isolate: this intentionally redirects this realm's
 * public reads only, never mutation, retry, completion or recovery internals. */
import {afterAll} from "bun:test";
import {PairingTrustOwner} from "../packages/runtime/src/pairing-security/trust-owner.ts";
const read=PairingTrustOwner.prototype.read,stamp=PairingTrustOwner.prototype.pairingAuthorityStamp;
PairingTrustOwner.prototype.read=function(context){
  // Preserve the unrelated missing-root read contract; a view has a root stamp.
  if(!(this as any).root())return read.call(this,context);
  const view=this.readAuthority(context);
  // Reapply read()'s DISPLAY-only merge so existing advisory fixtures keep
  // their original interface assertions. Authority itself came only from view.
  try {const root=(this as any).root(),advisory=(this as any).lastSeen(root);
    for(const peer of view.peers){const seen=advisory.get(peer.publicKey);if(seen)peer.lastSeen=(this as any).laterSeen(peer,seen);}
  } catch { /* Same best-effort display contract as read(). */ }
  return {revision:view.revision,peers:view.peers};
};
PairingTrustOwner.prototype.pairingAuthorityStamp=function(){return this.readAuthority().stamp;};
afterAll(()=>{PairingTrustOwner.prototype.read=read;PairingTrustOwner.prototype.pairingAuthorityStamp=stamp;});
await import("../packages/runtime/src/pairing-security/trust-capsule.test.ts");
await import("../packages/runtime/src/pairing-security/trust-owner.test.ts");
await import("../packages/runtime/src/pairing-security/trust-cutover.test.ts");
