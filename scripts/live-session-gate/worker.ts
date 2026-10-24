/** Isolated real endpoint or third-mutator process; never used by the app. */
import {mock} from "bun:test";
import fs from "node:fs";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {instrument} from "./instrument.ts";
const config=JSON.parse(fs.readFileSync(process.argv[2]!,"utf8"));
const send=(value:any)=>process.send?.(value),log=(value:any)=>fs.writeSync(1,JSON.stringify(value)+"\n");
const source=(p:string)=>pathToFileURL(join(config.source,p)).href;
const {pairingTrustOwner}=await import(source("packages/runtime/src/pairing-security/trust-owner.ts"));
const owner=pairingTrustOwner(config.root),probe=instrument(config,owner,log);
const keys=JSON.parse(fs.readFileSync(config.keys,"utf8"));
const decode=(k:any)=>({publicKey:new Uint8Array(Buffer.from(k.publicKey,"hex")),privateKey:new Uint8Array(Buffer.from(k.privateKey,"hex"))});
let server:any,relay:any,connection:any,domain:any;const events=new Set<any>();const streamWaiters=new Map<string,(value:any)=>void>();
let closeIndex=0;
const base=resolve(config.source,config.flavor==="web"?"packages/web/server/core/pairing/runtime/bridge":"apps/desktop/src/core/pairing/runtime/bridge");
const bridge={listSessions:()=>[],getSessionSummaries:()=>[],onEvent:(fn:any)=>{events.add(fn);return()=>events.delete(fn);}};
function watchEntries(){} // Invalidation is observed at its synchronous owner below.

if(config.role!=="mutator"){
 const transport=await import(source("packages/runtime/src/pairing-security/transport.ts"));
 if(!config.baseline){const actual=transport.requireTransportContext;mock.module(source("packages/runtime/src/pairing-security/transport.ts"),()=>({...transport,requireTransportContext:(...args:any[])=>probe.measure("resolver-admission",()=>actual(...args))}));}
 const {initTRPC}=await import(Bun.resolveSync("@trpc/server",base));const t=initTRPC.create();
 // The application body is deliberately trivial. The actual socket, Noise,
 // dispatcher, resolver proxy, subscription loop and send guard stay unchanged.
 const router=t.router({ping:t.procedure.query(({ctx}:any)=>{if(!config.baseline)transport.requireTransportContext(ctx);return {gatePing:true};}),
  stream:t.procedure.subscription(async function*({ctx}:any){
   if(!config.baseline)transport.requireTransportContext(ctx);
   const id=ctx.deviceId;try{for(;;){const value=await new Promise(r=>streamWaiters.set(id,r));yield {gateStream:value};}}finally{streamWaiters.delete(id);}
  })});
 mock.module(join(base,"router.ts"),()=>({bridgeRouter:config.path==="fallback"?undefined:router,lookupMobileInboxItemForEvent:()=>null}));
 const broker=resolve(config.source,config.flavor==="web"?"packages/web/server/core/broker/service.ts":"packages/cli/src/lib/core/broker/service.ts");
 const actual=await import(pathToFileURL(broker).href);
 mock.module(broker,()=>({...actual,watchScoutMessages:async(o:any)=>{await new Promise<void>(r=>o.signal.addEventListener("abort",()=>r(),{once:true}));}}));
 mock.module(join(base,"tail-fanout.ts"),()=>({getTailFanout:()=>({subscribe:()=>()=>{}})}));
 const host=decode(keys.host),port=config.port;
 if(config.path.startsWith("relay")){
  const {startRelay}=await import(source("packages/runtime/src/relay-transport.ts"));relay=startRelay(port,{hostname:"127.0.0.1"});
  const {connectToRelay}=await import(pathToFileURL(join(base,"relay-client.ts")).href);
  const opportunities=new Map<string,any>(),request=config.path.includes("request");
  connection=connectToRelay(`ws://127.0.0.1:${port}`,host,bridge,{kind:config.path==="relay-reconnect"?"reconnect":"pairing",privateRoom:request,
   ...(request?{authorizePeer:(key:string,room:string,live:()=>boolean)=>opportunities.get(key)?.admit(key,room,live)===true}:{})});
  if(request)for(const key of keys.phones)opportunities.set(key.publicKey,owner.openPairingOpportunity(connection.qrPayload.room,Date.now()+300000,key.publicKey));
 }else{
  const mod=await import(pathToFileURL(join(base,config.path==="legacy"?"server.ts":"server-trpc.ts")).href);
  server=config.path==="legacy"?mod.startBridgeServer(bridge,port,{secure:true,identity:host}):mod.startBridgeServerTRPC({bridge,port,secure:true,identity:host});
 }
 if(!config.baseline){
  domain=transport.transportDomainForBridge(bridge,keys.host.publicKey,owner);
  const invalidate=domain.invalidate.bind(domain);
  domain.invalidate=(entry:any,code?:number)=>{const wasActive=entry.kind!=="invalid",key=entry.key;invalidate(entry,code);if(wasActive&&entry.kind==="invalid"&&key){const record={kind:"invalidated",index:closeIndex++,key,at:probe.nowNs().toString()};queueMicrotask(()=>send(record));}};
  const sweep=domain.sweep.bind(domain);domain.sweep=()=>{const now=performance.now();log({kind:"sweepTick",now,expected:nextTick,delayMs:Math.max(0,now-nextTick)});nextTick=now+1000;return probe.measure("sweep",sweep);};let nextTick=performance.now()+1000;
 }
}
process.on("message",async(m:any)=>{
 try{
  if(m.command==="park"){
   if(probe.isHeld())throw Error("cannot suspend a gate holder");
   fs.writeFileSync(join(config.output,`parked-${process.pid}.json`),JSON.stringify({outsideGate:true,at:probe.nowNs().toString()}));
   process.kill(process.pid,"SIGSTOP");
  }else if(m.command==="phase"){probe.setPhase(m.phase);watchEntries();}
  else if(m.command==="event"){for(const fn of events)fn({seq:m.id,event:{event:"gate-event",gateId:m.id}});}
  else if(m.command==="stream"){
   const next=streamWaiters.values().next().value;if(!next)throw Error("awaited subscription not ready");streamWaiters.delete(streamWaiters.keys().next().value!);next(m.id);
  }else if(m.command==="retire"){connection?.retire();watchEntries();}
  else if(m.command==="counters"){send({kind:"reply",id:m.id,result:{usage:probe.usage(),at:probe.nowNs().toString(),pid:process.pid}});return;}
  else if(m.command==="mutate"){
   let acknowledged:bigint;const result=probe.measure("mutation",()=>{const value=owner.mutate(owner.read().revision,crypto.randomUUID(),m.mutation);acknowledged=probe.nowNs();return value;});
   send({kind:"reply",id:m.id,result:{result,at:acknowledged!.toString()}});return;
  }else if(m.command==="recover"){
   // Interrupt only the completion seam AFTER a real durable publication.
   // The authentic writer retains its stage/receipt sources for the real reader.
   const original=owner.completeCapsule,sentinel=Error("gate interrupted after committed publication");
   owner.completeCapsule=()=>{throw sentinel;};
   try{probe.measure("pending-publication",()=>owner.mutate(owner.read().revision,crypto.randomUUID(),{type:"grant",peer:{publicKey:keys.phones[0].publicKey,pairedAt:"gate-recovery",name:"pending"}}));throw Error("publication interruption was not reached");}
   catch(error){if(error!==sentinel)throw error;}
   finally{owner.completeCapsule=original;}
   const recovered=probe.measure("recovery",()=>owner.readAuthority());log({kind:"recovery-complete",revision:recovered.revision});
  }else if(m.command==="stop"){
   connection?.disconnect();server?.stop();relay?.stop();const usage=probe.usage(),at=probe.nowNs().toString();probe.close();send({kind:"reply",id:m.id,result:{stopped:true,usage,at}});setTimeout(()=>process.exit(0),10);return;
  }else throw Error("unknown command");
  send({kind:"reply",id:m.id,result:{ok:true,streams:streamWaiters.size}});
 }catch(error){send({kind:"reply",id:m.id,error:String(error)});}
});
send({kind:"ready",executableSHA256:createHash("sha256").update(fs.readFileSync(process.execPath)).digest("hex"),room:connection?.qrPayload.room,pid:process.pid,authorityRevision:owner.readAuthority().revision,version:Bun.version,baseline:!!config.baseline,usage:probe.usage(),at:probe.nowNs().toString()});
