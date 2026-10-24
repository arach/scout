import {test,expect} from "bun:test";
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {capsuleFixture,legacyFixture} from "./fixtures/pairing-capsule.ts";
import {fixtureHost,liveTransport,generateKeyPair} from "./fixtures/live-transport.ts";
import {bytesToHex} from "../packages/runtime/src/pairing-security/identity.ts";
import {TransportDomain,requireTransportContext,SecureTransport,PAIRING_AUTHORITY_CHANGED_CLOSE_CODE} from "../packages/runtime/src/pairing-security/transport.ts";
function setup(body:(f:any)=>any) {
  const root=mkdtempSync(join(tmpdir(),"pairing-capsule-registry-"));let domain:TransportDomain|undefined;
  try {
    const phone=generateKeyPair(), host=generateKeyPair(), other=generateKeyPair();
    const key=bytesToHex(phone.publicKey), otherKey=bytesToHex(other.publicKey);
    const fixture=capsuleFixture(root,{generations:4,keys:2,publicKeys:[key,otherKey],migrate:true});
    domain=new TransportDomain({},bytesToHex(host.publicKey),fixture.owner);fixtureHost(domain,host);
    const value=body({...fixture,domain,phone,host,other,key,otherKey});
    if(value?.then)return value.finally(()=>{domain?.dispose();rmSync(root,{recursive:true,force:true});});
  } catch(e){domain?.dispose();rmSync(root,{recursive:true,force:true});throw e;}
  domain?.dispose();rmSync(root,{recursive:true,force:true});
}
test("T-FORGE/T-BOUNDARY: genuine Noise handle only, immutable full key and socket/domain binding",()=>setup(f=>{
  const peer=liveTransport(f.domain,f.phone,{mutateCallbackKey:true});
  expect(requireTransportContext(peer.ctx).publicKey).toBe(f.key);
  for(const ctx of [{}, {bridge:f.domain.bridge,secureTransport:true,trustedPeer:true,deviceId:f.key},
    {...peer.ctx,transportHandle:{}}, {...peer.ctx,transport: {}}, {...peer.ctx,bridge:{}},
    {...peer.ctx,transportHandle:Object.create(peer.ctx.transportHandle)}])expect(()=>requireTransportContext(ctx)).toThrow();
  expect(()=>JSON.stringify(peer.ctx.transportHandle)).toThrow();
  expect(()=>structuredClone(peer.ctx.transportHandle)).toThrow();
  const second=liveTransport(f.domain,f.other);
  expect(()=>requireTransportContext({...peer.ctx,transport:second.server})).toThrow();
}),60_000);
test("T-REGRANT/T-LOCAL: stamp once, old handle never revives, same-view close codes and own key stays local",async()=>setup(async f=>{
  const peer=liveTransport(f.domain,f.phone), local=liveTransport(f.domain,f.host,{local:true});
  expect(()=>requireTransportContext(local.ctx,true)).toThrow();
  const oldStamp=f.owner.pairingAuthorityStamp();
  f.owner.mutate(f.owner.read().revision,"revoke",{type:"revoke",publicKey:f.key});
  expect(()=>requireTransportContext(peer.ctx)).toThrow();
  f.owner.mutate(f.owner.read().revision,"regrant",{type:"grant",peer:{publicKey:f.key,pairedAt:"2026"}});
  expect(f.owner.pairingAuthorityStamp()).not.toBe(oldStamp);
  expect(()=>requireTransportContext(peer.ctx)).toThrow();
  expect(requireTransportContext(local.ctx).kind).toBe("local-service");
  const fresh=liveTransport(f.domain,f.phone);
  f.owner.mutate(f.owner.read().revision,"unrelated",{type:"grant",peer:{publicKey:f.otherKey,pairedAt:"2027"}});
  await Bun.sleep(0);
  expect(peer.closes[0].code).toBe(4003);
  expect(fresh.closes[0]).toMatchObject({code:PAIRING_AUTHORITY_CHANGED_CLOSE_CODE,reason:"authority changed, reconnect"});
  expect(()=>requireTransportContext(fresh.ctx)).toThrow();
}),60_000);
test("T-CLOSE/T-REPLACE: captured send/dispatch dies before cleanup; replacement group is not global key",async()=>setup(async f=>{
  const a=liveTransport(f.domain,f.phone,{group:"reconnect"}), retained=liveTransport(f.domain,f.phone,{group:"retired-qr"});
  const b=liveTransport(f.domain,f.phone,{group:"reconnect"});
  expect(a.server.isReady()).toBe(false);expect(()=>requireTransportContext(a.ctx)).toThrow();
  expect(requireTransportContext(retained.ctx).publicKey).toBe(f.key);
  expect(requireTransportContext(b.ctx).publicKey).toBe(f.key);
  const before=a.messages.length;a.client.send("late");a.flush();expect(a.messages.length).toBe(before);
  b.server.dispose();expect(b.server.isReady()).toBe(false);expect(()=>requireTransportContext(b.ctx)).toThrow();
  await Bun.sleep(0);expect(a.closes[0].code).toBe(4001);
}),60_000);
test("v1 startup refuses without implicit migration or listeners",()=>{
 const root=mkdtempSync(join(tmpdir(),"pairing-capsule-v1-registry-"));
 try {const f=legacyFixture(root,{generations:3});const before=readFileSync(join(root,"trusted-peers.json"));
   expect(()=>new TransportDomain({},"a".repeat(64),f.owner)).toThrow("capsule_migration_required");
   expect(readFileSync(join(root,"trusted-peers.json"))).toEqual(before);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("T-ROOT: in-place early retained chunk corruption refuses with warm same-process handle",()=>setup(f=>{
 const p=liveTransport(f.domain,f.phone);const name=f.head.parts[0].name, path=join(f.root,name), bytes=readFileSync(path);
 bytes[bytes.length-3]^=1;writeFileSync(path,bytes);
 expect(()=>requireTransportContext(p.ctx)).toThrow();expect(p.server.isReady()).toBe(false);
}),60_000);
test("bounded pending controllers fail closed and are released on dispose",()=>setup(f=>{
 const peers:SecureTransport[]=[];
 try {for(let i=0;i<1024;i++)peers.push(new SecureTransport({send(){}},"responder",f.host,{}, {domain:f.domain,trustOnComplete:false}));
 expect(()=>new SecureTransport({send(){}},"responder",f.host,{}, {domain:f.domain})).toThrow("capacity");
 peers[0].dispose();expect(()=>new SecureTransport({send(){}},"responder",f.host,{}, {domain:f.domain})).not.toThrow();
 }finally{for(const p of peers)p.dispose();}
}),60_000);

test("one readAuthority and one managed gate per synchronous decision",()=>setup(f=>{
 let holder:object|null=null, gates=0, views=0;
 const unregister=f.owner.register({id:"live-decision-probe",currentHolder:()=>holder,withGate(_root:any,body:any){
  if(holder)throw Error("nested managed gate");gates++;holder={};try{return body(holder);}finally{holder=null;}
 }});
 try {
  f.owner.mutate(f.owner.read().revision,"manage-decision",{type:"manage"});
  const original=f.owner.readAuthority.bind(f.owner);
  f.owner.readAuthority=(ctx:any)=>{views++;return original(ctx);};
  f.owner.read=()=>{throw Error("separate read forbidden");};
  f.owner.pairingAuthorityStamp=()=>{throw Error("separate stamp forbidden");};
  views=0;gates=0;
  f.owner.withTransportAuthority((v:any)=>{expect(holder).not.toBeNull();expect(v.has(f.key)).toBe(true);});
  expect(views).toBe(1);expect(gates).toBe(1);expect(holder).toBeNull();
 }finally{unregister();}
}),60_000);
