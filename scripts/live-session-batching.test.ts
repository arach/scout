import {test, expect} from "bun:test";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {capsuleFixture} from "./fixtures/pairing-capsule.ts";
import {fixtureHost, liveTransport, generateKeyPair} from "./fixtures/live-transport.ts";
import {bytesToHex} from "../packages/runtime/src/pairing-security/identity.ts";
import {pairingTrustOwner, PairingTrustOwner} from "../packages/runtime/src/pairing-security/trust-owner.ts";
import {TransportDomain, subscribeTransportEvents, createTransportWatchFanout, requireTransportContext} from "../packages/runtime/src/pairing-security/transport.ts";
async function fixture(run: (f: any) => unknown) {
 const root=mkdtempSync(join(tmpdir(),"pairing-capsule-batching-"));
 let domain:TransportDomain|undefined, unregister:(()=>void)|undefined, holder:object|null=null;
 try {
  const phones=Array.from({length:4},()=>generateKeyPair()),host=generateKeyPair(),keys=phones.map(p=>bytesToHex(p.publicKey));
  const f=capsuleFixture(root,{generations:6,keys:4,publicKeys:keys,migrate:true,factory:pairingTrustOwner});
  const owner=f.owner;
  unregister=owner.register({id:"batch-gate",currentHolder:()=>holder,withGate(_root,body){
   if(holder)throw Error("nested authority gate");holder={};try{return body(holder);}finally{holder=null;}
  }});
  owner.mutate(owner.read().revision,"managed-batch",{type:"manage"});
  const sourceListeners=new Set<(event:number)=>void>();let starts=0,stops=0;
  const source={onEvent(fn:(event:number)=>void){starts++;sourceListeners.add(fn);return ()=>{if(sourceListeners.delete(fn))stops++;};}};
  domain=new TransportDomain(source,bytesToHex(host.publicKey),owner);fixtureHost(domain,host);
  const peers=phones.map(phone=>liveTransport(domain!,phone));
  const counts={reads:0,notificationViews:0,frames:0};
  const read=owner.readAuthority.bind(owner),view=(owner as any).transportView.bind(owner);
  owner.readAuthority=ctx=>{counts.reads++;return read(ctx);};
  (owner as any).transportView=(...args:any[])=>{counts.notificationViews++;return view(...args);};
  for(const peer of peers){const socket=(peer.server as any).socket,send=socket.send.bind(socket);
   socket.send=(data:any)=>{expect(holder,"network frame must follow authority gate release").toBeNull();counts.frames++;send(data);};}
  await run({...f,owner,domain,source,peers,phones,keys,counts,get holder(){return holder;},
   emit:(n:number)=>{for(const fn of [...sourceListeners])fn(n);},starts:()=>starts,stops:()=>stops});
 }finally{domain?.dispose();unregister?.();rmSync(root,{recursive:true,force:true});}
}
test("batch: direct/relay-style listeners share one view and one source, each lifetime checked",()=>fixture(f=>{
 const unsubs=f.peers.map((p:any)=>subscribeTransportEvents(f.domain,f.source,()=>{
  requireTransportContext(p.ctx);f.domain.batch(()=>{p.server.send("first");p.server.send("second");});
 }));
 expect(f.starts()).toBe(1);f.counts.reads=0;f.emit(1);
 console.log("BATCH_COUNTS "+JSON.stringify({reads:f.counts.reads,frames:f.counts.frames,sourceStarts:f.starts()}));
 expect(f.counts.reads,"one exhaustive view for the whole source callback").toBe(1);
 expect(f.counts.frames).toBe(8);
 for(const p of f.peers){p.flush();expect(p.outbound).toEqual(["first","second"]);}
 unsubs[0]();f.emit(2);expect(f.counts.reads).toBe(2);expect(f.counts.frames).toBe(14);
 unsubs.slice(1).forEach((fn:any)=>fn());expect(f.stops()).toBe(1);f.emit(3);expect(f.counts.reads).toBe(2);
}),60_000);
test("batch: snapshots never cross a microtask, timer or asynchronous continuation",()=>fixture(async f=>{
 const p=f.peers[0];f.counts.reads=0;
 f.domain.batch(()=>{p.server.send("sync-a");p.server.send("sync-b");});
 expect(f.counts.reads).toBe(1);
 await Promise.resolve();p.server.send("microtask");expect(f.counts.reads).toBe(2);
 await Bun.sleep(0);p.server.send("timer");expect(f.counts.reads).toBe(3);
 expect(()=>f.domain.batch(async()=>{await Promise.resolve();p.server.send("resumed");})).toThrow("synchronous batch");
 await Promise.resolve();expect(f.counts.reads).toBe(5);
 p.flush();expect(p.outbound).toHaveLength(5);
}),60_000);
test("batch: a later queued sender refuses an external revoke without a notification",()=>fixture(async f=>{
 const p=f.peers[0];f.domain.batch(()=>p.server.send("before"));
 const other=new PairingTrustOwner(f.root);other.mutate(other.read().revision,"external-revoke",{type:"revoke",publicKey:f.keys[0]});
 expect(p.server.isReady()).toBe(true); // no local observer from the other owner
 await Promise.resolve();p.server.send("after");p.flush();
 console.log("LATE_SENDER "+JSON.stringify({outbound:p.outbound}));
 expect(p.outbound).toEqual(["before"]);expect(p.server.isReady()).toBe(false);
 await Bun.sleep(0);expect(p.closes[0].code).toBe(4003);
}),60_000);
test("batch: explicit managed contexts cannot borrow the public delivery snapshot",()=>fixture(f=>{
 let stale:any;f.owner.withInvocation((ctx:any)=>{stale=ctx;});
 f.domain.batch(()=>expect(()=>requireTransportContext(f.peers[0].ctx,true,stale)).toThrow());
}),60_000);
test("batch: broker message and lifecycle fanout each use one view per domain",()=>fixture(async f=>{
 let stream:any;const controllers=f.peers.map(()=>new AbortController());
 const watch=createTransportWatchFanout(async options=>{stream=options;await new Promise<void>(r=>options.signal!.addEventListener("abort",()=>r(),{once:true}));});
 const waits=f.peers.map((p:any,i:number)=>watch({allConversations:true,transportDomain:f.domain,signal:controllers[i].signal,
  onMessage:()=>p.server.send("message"),onLifecycle:()=>p.server.send("lifecycle")}));
 await Promise.resolve();expect(stream.transportDomain).toBeUndefined();f.counts.reads=0;
 stream.onMessage({});console.log("WATCH_COUNTS "+JSON.stringify(f.counts));expect(f.counts.reads).toBe(1);stream.onLifecycle({});expect(f.counts.reads).toBe(2);
 expect(f.counts.frames).toBe(8);controllers.forEach((c:any)=>c.abort());await Promise.all(waits);expect(stream.signal.aborted).toBe(true);
}),60_000);
test("batch: disposed or removed listeners cannot use a captured source callback",()=>fixture(f=>{
 const p=f.peers[0];let late:(event:number)=>void=()=>{};let stopped=0;
 f.domain.subscribe({},(emit:any)=>{late=emit;return()=>stopped++;},()=>p.server.send("late"));
 f.domain.dispose();late(1);expect(stopped).toBe(1);expect(f.counts.frames).toBe(0);
}),60_000);
test("observer: ordinary reads construct no notification view; durable writer ACK notifies once",()=>fixture(f=>{
 let notifications=0;const unobserve=f.owner.observeTransportAuthority(()=>{notifications++;throw Error("bad observer");});
 try {
  for(let i=0;i<20;i++){f.owner.readAuthority();f.owner.read();f.owner.withTransportAuthority(()=>{});}
  expect(f.counts.notificationViews,"no secondary transport view on ordinary reads").toBe(0);expect(notifications).toBe(0);
  const outcome=f.owner.mutate(f.owner.read().revision,"changed",{type:"grant",peer:{publicKey:f.keys[0],pairedAt:"new"}});
  console.log("OBSERVER_COUNTS "+JSON.stringify({changed:outcome.changed,notifications,notificationViews:f.counts.notificationViews}));
  expect(outcome.changed).toBe(true);expect(notifications,"durable writer ACK notifies").toBe(1);expect(f.counts.notificationViews).toBe(1);
  expect(f.peers[0].server.isReady()).toBe(false);
 }finally{unobserve();}
}),60_000);
test("batch: independent async stream turns still require one verified read per frame",()=>fixture(async f=>{
 const p=f.peers[0];f.counts.reads=0;
 for(let i=0;i<100;i++){await Promise.resolve();p.server.send(String(i));}
 p.flush();expect(f.counts.reads).toBe(100);expect(p.outbound).toHaveLength(100);
 console.log("ASYNC_FRAME_COUNTS "+JSON.stringify({frames:100,readAuthority:f.counts.reads,notificationViews:f.counts.notificationViews}));
}),60_000);

test("batch: frames leave only after the narrow managed read gate releases",()=>fixture(f=>{
 f.domain.batch(()=>f.peers[0].server.send("outside-gate"));
 f.peers[0].flush();expect(f.peers[0].outbound).toEqual(["outside-gate"]);
}),60_000);

test("batch: a publication discards old permission without killing its post-grant winner",()=>fixture(f=>{
 let winner:any;
 f.domain.batch(()=>{
  f.peers[0].server.send("before-grant");
  f.owner.mutate(f.owner.read().revision,"during-batch-grant",{type:"grant",peer:{publicKey:f.keys[0],pairedAt:"new-grant"}});
  winner=liveTransport(f.domain,f.phones[0]);winner.server.send("winner");
 });
 winner.flush();expect(winner.outbound).toEqual(["winner"]);expect(winner.server.isReady()).toBe(true);
 f.peers[0].flush();expect(f.peers[0].outbound).toEqual(["before-grant"]);expect(f.peers[0].server.isReady()).toBe(false);
}),60_000);

test("close: selection uses the invalidating view, not later membership",()=>fixture(async f=>{
 const p=f.peers[0];
 f.owner.mutate(f.owner.read().revision,"close-revoke",{type:"revoke",publicKey:f.keys[0]});
 f.owner.mutate(f.owner.read().revision,"close-regrant",{type:"grant",peer:{publicKey:f.keys[0],pairedAt:"again"}});
 await Promise.resolve();expect(p.closes[0].code,"absent in invalidating view stays 4003").toBe(4003);
 const fresh=liveTransport(f.domain,f.phones[0]);
 f.owner.mutate(f.owner.read().revision,"close-grant-other",{type:"grant",peer:{publicKey:f.keys[1],pairedAt:"another"}});
 f.owner.mutate(f.owner.read().revision,"close-revoke-later",{type:"revoke",publicKey:f.keys[0]});
 await Promise.resolve();expect(fresh.closes[0].code,"present in invalidating view stays 4006").toBe(4006);
}),60_000);
