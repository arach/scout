/** Actual endpoint/relay/Noise operation counts, not a timing qualification.
 * Only the broker/Tail sources and application router are instrumented sinks. */
import {mock} from "bun:test";
import assert from "node:assert/strict";
import {realpathSync} from "node:fs";
import {createServer} from "node:net";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {capsuleFixture} from "./fixtures/pairing-capsule.ts";
import {generateKeyPair} from "../packages/runtime/src/pairing-security/noise.ts";
import {bytesToHex} from "../packages/runtime/src/pairing-security/identity.ts";
import {SecureTransport, transportDomainForBridge, requireTransportContext} from "../packages/runtime/src/pairing-security/transport.ts";
import {PairingTrustOwner} from "../packages/runtime/src/pairing-security/trust-owner.ts";
import {startRelay} from "../packages/runtime/src/relay-transport.ts";
const [flavor,kind]=process.argv.slice(2),root=realpathSync(process.env.OPENSCOUT_PAIRING_HOME!);
const base=resolve(flavor==="web"?"packages/web/server/core/pairing/runtime/bridge":"apps/desktop/src/core/pairing/runtime/bridge");
const sourceWatches=new Set<any>();
const broker=resolve(flavor==="web"?"packages/web/server/core/broker/service.ts":"packages/cli/src/lib/core/broker/service.ts");
const realBroker=await import(pathToFileURL(broker).href);
mock.module(broker,()=>({...realBroker,watchScoutMessages:async(options:any)=>{
 sourceWatches.add(options);await new Promise<void>(r=>options.signal.addEventListener("abort",()=>{sourceWatches.delete(options);r();},{once:true}));
}}));
const tailListeners=new Set<(event:any)=>void>();let tailStarts=0;
const tail={subscribe(fn:(event:any)=>void){tailStarts++;tailListeners.add(fn);return()=>tailListeners.delete(fn);}};
mock.module(join(base,"tail-fanout.ts"),()=>({getTailFanout:()=>tail}));
const {initTRPC}=await import(Bun.resolveSync("@trpc/server",base));const t=initTRPC.create();
let streamNext:((value:number)=>void)|undefined;
const router=t.router({stream:t.procedure.subscription(async function*({ctx}:any){
 requireTransportContext(ctx);
 for(;;){const value=await new Promise<number>(r=>{streamNext=r;});yield {streamSample:value};}
})});
mock.module(join(base,"router.ts"),()=>({bridgeRouter:router,lookupMobileInboxItemForEvent:()=>null}));
const host=generateKeyPair(),phones=Array.from({length:4},()=>generateKeyPair()),keys=phones.map(p=>bytesToHex(p.publicKey));
const f=capsuleFixture(root,{generations:6,keys:4,publicKeys:keys,migrate:true});
let holder:object|null=null;
const unregister=f.owner.register({id:"endpoint-fanout",currentHolder:()=>holder,withGate(_root,body){
 assert.equal(holder,null,"no nested native gate");holder={};try{return body(holder);}finally{holder=null;}
}});
f.owner.mutate(f.owner.read().revision,"manage-endpoint-fanout",{type:"manage"});
const events=new Set<(event:any)=>void>();let bridgeStarts=0;
const bridge={listSessions:()=>[1,2,3].map(i=>({id:String(i),sessionId:String(i)})),onEvent(fn:(event:any)=>void){bridgeStarts++;events.add(fn);return()=>events.delete(fn);}};
let reads=0;const read=f.owner.readAuthority.bind(f.owner);f.owner.readAuthority=ctx=>{reads++;return read(ctx);};
const port=()=>new Promise<number>((resolve,reject)=>{const s=createServer();s.on("error",reject);s.listen(0,"127.0.0.1",()=>{const p=(s.address()as any).port;s.close(e=>e?reject(e):resolve(p));});});
const wait=async(fn:()=>boolean)=>{const until=performance.now()+20_000;while(!fn()){if(performance.now()>until)throw Error("fanout fixture timeout");await Bun.sleep(2);}};
let server:any,relay:any,connection:any,room:string|undefined;const peers:any[]=[];
try {
 const p=await port();
 if(kind==="relay"){
  relay=startRelay(p,{hostname:"127.0.0.1"});
  const {connectToRelay}=await import(pathToFileURL(process.argv[4]??join(base,"relay-client.ts")).href);
  connection=connectToRelay(`ws://127.0.0.1:${p}`,host,bridge,{kind:"reconnect"});room=connection.qrPayload.room;
  await Bun.sleep(50);
 }else{
  const mod=await import(pathToFileURL(join(base,kind==="legacy"?"server.ts":"server-trpc.ts")).href);
  server=kind==="legacy"?mod.startBridgeServer(bridge,p,{secure:true,identity:host}):mod.startBridgeServerTRPC({bridge,port:p,secure:true,identity:host});
 }
 const connect = async (phone: ReturnType<typeof generateKeyPair>) => {
  const ws=new WebSocket(kind==="relay"?`ws://127.0.0.1:${p}?room=${room}&role=client`:`ws://127.0.0.1:${p}`),data:any[]=[];
  let transport:SecureTransport;const peer={ws,data,ready:false,closed:0,closeReason:"",send:(value:any)=>transport.send(JSON.stringify(value))};peers.push(peer);
  ws.addEventListener("close",event=>{peer.closed=event.code;peer.closeReason=event.reason;});
  ws.addEventListener("message",event=>transport.receive(typeof event.data==="string"?event.data:new Uint8Array(event.data as ArrayBuffer)));
  await new Promise<void>((resolve,reject)=>{ws.addEventListener("open",()=>resolve(),{once:true});ws.addEventListener("error",()=>reject(Error("phone open failed")),{once:true});});
  transport=new SecureTransport({send:frame=>ws.send(frame)},"initiator",phone,{onReady:()=>{peer.ready=true;},onMessage:message=>data.push(JSON.parse(message))},{trustOnComplete:false,skipTrustWrite:()=>true});
  await wait(()=>peer.ready&&data.length===3);return peer;
 };
 for(const phone of phones)await connect(phone);
 const domain=transportDomainForBridge(bridge,bytesToHex(host.publicKey),f.owner);
 // This isolates deterministic operation counts. It is not idle/sweep timing evidence.
 clearInterval((domain as any).timer);
 for(const entry of (domain as any).entries){const socket=entry.transport.socket,send=socket.send.bind(socket);socket.send=(data:any)=>{assert.equal(holder,null,"physical frame while gate held");return send(data);};}
 reads=0;
 for(const fn of [...events])fn({seq:99,event:{event:"fanout-secret"}});
 await wait(()=>peers.every(p=>p.data.some((v:any)=>v.event?.event==="fanout-secret")));
 const eventReads=reads;assert.equal(eventReads,1,"actual endpoint bridge fanout must use one view");assert.equal(bridgeStarts,1);
 let brokerReads:number|null=null,lifecycleReads:number|null=null,tailReads:number|null=null;
 if(kind!=="legacy"){
  await wait(()=>sourceWatches.size===1);reads=0;
  for(const source of sourceWatches)source.onMessage({id:"message-count",conversationId:"conversation",metadata:{}});
  await wait(()=>peers.every(p=>p.data.some((v:any)=>v.event==="mobile:conversation:changed")));
  brokerReads=reads;assert.equal(brokerReads,1,"actual broker fanout must use one view");reads=0;
  for(const source of sourceWatches)source.onLifecycle({conversationId:"conversation",state:"running"});
  await wait(()=>peers.every(p=>p.data.some((v:any)=>v.event==="mobile:conversation:lifecycle")));
  lifecycleReads=reads;assert.equal(lifecycleReads,1);
 }
 if(flavor==="desktop"&&kind==="trpc"){
  reads=0;for(const fn of tailListeners)fn({id:"tail-count",source:"probe"});
  await wait(()=>peers.every(p=>p.data.some((v:any)=>v.id==="tail-count")));tailReads=reads;assert.equal(tailReads,1);assert.equal(tailStarts,1);
 }
 let streamReads:number|null=null;
 if(kind==="trpc"){
  peers[0].send({id:51,jsonrpc:"2.0",method:"subscription",params:{path:"stream"}});
  await wait(()=>!!streamNext&&peers[0].data.some((v:any)=>v.id===51&&v.result?.type==="started"));reads=0;
  for(let i=0;i<100;i++){
   await wait(()=>!!streamNext);const emit=streamNext!;streamNext=undefined;emit(i);
   await wait(()=>peers[0].data.some((v:any)=>v.id===51&&v.result?.data?.streamSample===i));
  }
  streamReads=reads;assert.equal(streamReads,100,"every post-await stream frame needs a fresh decision");
 }
 let sameKeyAuthorityClose:number|null=null;
 if(kind==="relay") {
  // A separate owner misses this domain's in-process hints, like a third mutator.
  const other=new PairingTrustOwner(root);
  other.mutate(other.read().revision,"missed-revoke",{type:"revoke",publicKey:keys[0]!});
  other.mutate(other.read().revision,"missed-regrant",{type:"grant",peer:{publicKey:keys[0]!,pairedAt:"regranted"}});
  await connect(phones[0]!);await wait(()=>peers[0].closed!==0);sameKeyAuthorityClose=peers[0].closed;
  console.log("AUTHORITY_REPLACEMENT "+JSON.stringify({flavor,code:sameKeyAuthorityClose,reason:peers[0].closeReason}));
  assert.equal(sameKeyAuthorityClose,4006,"replacement cannot override an earlier same-view authority invalidation");
 }
 console.log("ENDPOINT_FANOUT_COUNTS "+JSON.stringify({flavor,kind,peers:4,eventReads,brokerReads,lifecycleReads,tailReads,streamFrames:streamReads===null?null:100,streamReads,sameKeyAuthorityClose,bridgeStarts,tailStarts,sourceWatches:sourceWatches.size,qualification:false}));
}finally{
 for(const peer of peers)peer.ws.close();connection?.disconnect();server?.stop();relay?.stop();unregister();
}
process.exit(0);
