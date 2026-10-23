import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pairingTrustOwner } from "./trust-owner.ts";
const roots:string[]=[];const key="a".repeat(64),other="b".repeat(64);
function setup(){const root=mkdtempSync(join(tmpdir(),"pairing-opportunity-"));roots.push(root);return pairingTrustOwner(root);}
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
test("single completion, correct room, cancel and timeout",async()=>{
 const owner=setup();const window=owner.openPairingOpportunity("room",Date.now()+1000);
 expect(()=>JSON.stringify(window)).toThrow("not_serializable");expect(owner.read().revision).toBe(0);
 expect(window.admit(key,"room",()=>true)).toBe(true);expect(window.admit(other,"room",()=>true)).toBe(false);expect(owner.read().revision).toBe(1);
 const cancel=owner.openPairingOpportunity("room",Date.now()+1000);cancel.cancel();expect(cancel.admit(other,"room",()=>true)).toBe(false);
 const timeout=owner.openPairingOpportunity("room",Date.now()+15);await Bun.sleep(25);expect(timeout.admit(other,"room",()=>true)).toBe(false);
 const wrongRoom=owner.openPairingOpportunity("room",Date.now()+1000);expect(wrongRoom.admit(other,"elsewhere",()=>true)).toBe(false);expect(wrongRoom.admit(other,"room",()=>true)).toBe(false);
});
test("authority change cancels, fresh explicit opportunity can regrant same full key",()=>{
 const owner=setup();owner.mutate(0,"seed",{type:"grant",peer:{publicKey:key,pairedAt:"2026-01-01"}});
 const old=owner.openPairingOpportunity("room",Date.now()+1000);owner.mutate(1,"revoke",{type:"revoke",publicKey:key});
 expect(old.admit(key,"room",()=>true)).toBe(false);expect(owner.read().peers).toEqual([]);
 expect(owner.openPairingOpportunity("room",Date.now()+1000).admit(key,"room",()=>true)).toBe(true);
});
test("advisory reconnect does not cancel; unmanaged external projection change does",()=>{
 const owner=setup();owner.mutate(0,"seed",{type:"grant",peer:{publicKey:key,pairedAt:"2026-01-01"}});
 const window=owner.openPairingOpportunity("room",Date.now()+1000);owner.refresh(key,"2026-10-23T00:00:00Z");expect(window.admit(other,"room",()=>true)).toBe(true);
 const external=owner.openPairingOpportunity("room",Date.now()+1000);writeFileSync(join(owner.path,"trusted-peers.json"),"[]",{mode:0o600});expect(external.admit(key,"room",()=>true)).toBe(false);
});
test("dead transport and cancellation immediately before publication refuse",()=>{
 const owner=setup();const dead=owner.openPairingOpportunity("room",Date.now()+1000);expect(dead.admit(key,"room",()=>false)).toBe(false);
 const late=owner.openPairingOpportunity("room",Date.now()+1000);let checks=0;
 expect(()=>late.admit(key,"room",()=>++checks<3)).toThrow("pairing_opportunity_closed");expect(owner.read().revision).toBe(0);
 const cancel=owner.openPairingOpportunity("room",Date.now()+1000);checks=0;
 expect(()=>cancel.admit(key,"room",()=>{if(++checks===3)cancel.cancel();return true;})).toThrow("pairing_opportunity_closed");
 expect(owner.read().revision).toBe(0);
});
test("managed opportunity uses current owner's gate for publication",()=>{
 const owner=setup();let held:object|null=null,entries=0;
 const remove=owner.register({id:"test.window",withGate(_r,body){expect(held).toBe(null);held={};entries++;try{return body(held);}finally{held=null;}},currentHolder(){return held;}});
 try{owner.withInvocation(c=>owner.mutate(0,"manage",{type:"manage"},c));const w=owner.openPairingOpportunity("room",Date.now()+1000);expect(w.admit(key,"room",()=>true)).toBe(true);expect(entries).toBe(3);}finally{remove();}
});

test("a changed projection immediately before publication cannot slip into a grant",()=>{
 const owner=setup(), w=owner.openPairingOpportunity("room",Date.now()+1000);let checks=0;
 expect(()=>w.admit(key,"room",()=>{
  if(++checks===2) writeFileSync(join(owner.path,"trusted-peers.json"),JSON.stringify([{publicKey:other,pairedAt:"2026-01-01"}]),{mode:0o600});
  return true;
 })).toThrow("pairing_opportunity_closed");
 expect(owner.read().revision).toBe(0);expect(owner.read().peers.map(p=>p.publicKey)).toEqual([other]);
});
