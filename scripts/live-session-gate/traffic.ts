/** Generator and fixture process. Serving processes never build their stores. */
import {installSyncSpawnRecorder} from "./spawn-recorder.ts";
import fs from "node:fs";
import {createServer} from "node:net";
import {join,dirname} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {instrument,nativeClock,assertCommonClock} from "./instrument.ts";
const config=JSON.parse(fs.readFileSync(process.argv[2]!,"utf8")),here=dirname(fileURLToPath(import.meta.url));
installSyncSpawnRecorder(config.output);
if(process.env.BUN_JSC_logGC!=="1")throw Error("native GC log required");
const clock=nativeClock(config.library);
const executableSHA256=createHash("sha256").update(fs.readFileSync(process.execPath)).digest("hex");if(config.executableSHA256&&executableSHA256!==config.executableSHA256)throw Error("generator executable mismatch");
const emit=(x:any)=>fs.writeSync(1,JSON.stringify(x)+"\n"),url=(p:string)=>pathToFileURL(join(config.source,p)).href;
const {generateKeyPair}=await import(url("packages/runtime/src/pairing-security/noise.ts"));
const {SecureTransport}=await import(url("packages/runtime/src/pairing-security/transport.ts"));
const {bytesToHex}=await import(url("packages/runtime/src/pairing-security/identity.ts"));
const encode=(k:any)=>({publicKey:bytesToHex(k.publicKey),privateKey:bytesToHex(k.privateKey)}),decode=(k:any)=>({publicKey:new Uint8Array(Buffer.from(k.publicKey,"hex")),privateKey:new Uint8Array(Buffer.from(k.privateKey,"hex"))});
const generations=config.tier==="large"?10000:100,keyCount=config.tier==="large"?32:4;
if(config.phase==="prepare"){
 const {capsuleFixture}=await import(url("scripts/fixtures/pairing-capsule.ts"));
 const phones=Array.from({length:keyCount},()=>generateKeyPair()),host=generateKeyPair();let probe:any;const started=performance.now(),usage=process.resourceUsage();
 const f=capsuleFixture(fs.realpathSync(config.root),{generations:generations-1,keys:keyCount,publicKeys:phones.map((k:any)=>bytesToHex(k.publicKey)),migrate:true,prepare:(owner:any)=>{
  probe=instrument(config,owner,emit);probe.measure("manage-fixture",()=>owner.mutate(owner.read().revision,crypto.randomUUID(),{type:"manage"}));
 }});
 if(!f.barrier.migration?.planHash||f.owner.read().revision!==generations)throw Error("real managed migration fixture required");
 fs.writeFileSync(config.keys,JSON.stringify({phones:phones.map(encode),host:encode(host)}),{mode:0o600,flag:"wx"});
 emit({kind:"prepared",tier:config.tier,generations,keys:keyCount,elapsedMs:performance.now()-started,usageBefore:usage,usageAfter:process.resourceUsage(),legacyBytes:f.legacyBytes,largestLegacyGenerationBytes:Math.max(...f.rows.map((row:any)=>row[6])),migration:f.barrier.migration,stamp:f.stamp,authorityFiles:fs.readdirSync(config.root).map(name=>({name,bytes:fs.statSync(join(config.root,name)).size}))});probe.close();clock.close();process.exit(0);
}
const keys=JSON.parse(fs.readFileSync(config.keys,"utf8"));
let stopping=false,failureMessage:string|undefined;
let serial=0;const children:any[]=[],peers:any[]=[],invalidations:any[]=[];
const wait=async(fn:()=>boolean,label:string,ms=30000)=>{const until=performance.now()+ms;while(!fn()){if(performance.now()>until)throw Error("gate timeout: "+label);await Bun.sleep(1);}};
const port=()=>new Promise<number>((r,j)=>{const s=createServer();s.on("error",j);s.listen(0,"127.0.0.1",()=>{const n=(s.address()as any).port;s.close(e=>e?j(e):r(n));});});
async function spawn(role:string,flavor?:string){
 const id=children.length,pending=new Map(),file=join(config.output,`worker-${id}.config.json`),home=join(config.output,`home-${id}`);fs.mkdirSync(home);
 const sub={...config,role,flavor,source:config.baseline?config.baselineSource:config.source,port:await port()};fs.writeFileSync(file,JSON.stringify(sub));
 let ready:any,readyReceived:bigint;const launched=clock.nowNs();const logs=[fs.openSync(join(config.output,`worker-${id}.jsonl`),"wx",0o600),fs.openSync(join(config.output,`worker-${id}.gc.log`),"wx",0o600)];
 const child=Bun.spawn([process.execPath,join(here,"worker.ts"),file],{env:{...process.env,HOME:home,OPENSCOUT_HOME:join(home,"scout"),OPENSCOUT_PAIRING_HOME:config.root},stdout:logs[0],stderr:logs[1],ipc:(m:any)=>{
  if(m.kind==="ready"){readyReceived=clock.nowNs();ready={...m,parentClockBracket:{launchedNs:launched.toString(),receivedNs:readyReceived.toString()}};}
  else if(m.kind==="invalidated")invalidations.push({worker:id,...m});
  else if(m.kind==="reply"){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.result);}}
 }});
 void child.exited.then(code=>{if(!stopping)emit({kind:"worker-exit",pid:child.pid,exitCode:code,signalCode:child.signalCode,atUnixMs:Date.now()});});
 const ask=async(command:string,data:any={})=>{const n=serial++;let timer:any;try{return await Promise.race([new Promise<any>((resolve,reject)=>{pending.set(n,{resolve,reject});child.send({...data,command,id:n});}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("worker command timeout: "+command)),30000);})]);}finally{clearTimeout(timer);pending.delete(n);}};
 const value={child,ask,ready:()=>ready,sub,id,logs};children.push(value);
 await wait(()=>!!ready||child.exitCode!==null,"worker ready");if(!ready||(ready.version!==Bun.version||ready.executableSHA256!==executableSHA256))throw Error("worker startup failed");assertCommonClock(BigInt(ready.at),launched,readyReceived!);return value;
}
async function connect(worker:any,phone:any){
 const target=config.path.startsWith("relay")?`ws://127.0.0.1:${worker.sub.port}?room=${worker.ready().room}&role=client`:`ws://127.0.0.1:${worker.sub.port}`;
 const ws=new WebSocket(target),data:any[]=[];let ready=false,closed:any,transport:any;
 const value={ws,data,send:(v:any)=>transport.send(JSON.stringify(v)),closed:()=>closed};peers.push(value);
 ws.onmessage=e=>transport.receive(typeof e.data==="string"?e.data:new Uint8Array(e.data as ArrayBuffer));ws.onclose=e=>{closed={at:clock.nowNs().toString(),code:e.code};};
 await new Promise<void>((r,j)=>{ws.onopen=()=>r();ws.onerror=()=>j(Error("client connect failed"));});
 transport=new SecureTransport({send:(f:any)=>ws.send(f)},"initiator",decode(phone),{onReady:(key:any)=>{if(bytesToHex(key)!==keys.host.publicKey)throw Error("wrong responder");ready=true;},onMessage:(s:string)=>{const value=JSON.parse(s);Object.defineProperty(value,"gateArrival",{value:performance.now()});data.push(value);}},{trustOnComplete:false,skipTrustWrite:()=>true});
 await wait(()=>ready,"Noise ready");await Bun.sleep(5);return value;
}
async function rpc(peer:any,id:number){
 const started=performance.now();peer.send(config.path==="trpc"?{id,jsonrpc:"2.0",method:"query",params:{path:"ping"}}:{id,method:"session/list"});
 await wait(()=>peer.data.some((v:any)=>v.id===id),"RPC reply");const row=peer.data.find((v:any)=>v.id===id);if(row.error||row.result?.type==="error")throw Error("RPC refusal: "+JSON.stringify(row));
 return performance.now()-started;
}
async function phase(workers:any[],name:string){for(const w of workers)await w.ask("phase",{phase:name});}
async function counters(workers:any[]){return await Promise.all(workers.map(w=>w.ask("counters")));}
const start=performance.now(),clientUsage=process.resourceUsage();
try{
 if(config.phase==="mutation-recovery"){
  const mutator=await spawn("mutator");await phase([mutator],"mutation-recovery");
  const key=keys.phones[0].publicKey;await mutator.ask("mutate",{mutation:{type:"revoke",publicKey:key}});await mutator.ask("mutate",{mutation:{type:"grant",peer:{publicKey:key,pairedAt:"gate"}}});await mutator.ask("recover");
 }else{
  const workers=[await spawn("server","web"),await spawn("server","desktop")],localPeers:any[][]=[];
  const attach=async()=>{
   for(const p of peers)p.ws.close();peers.length=0;localPeers.length=0;
   for(const w of workers){const list=[];for(const phone of keys.phones.slice(0,config.peers))list.push(await connect(w,phone));localPeers.push(list);}
   if(config.path.includes("retired"))for(const w of workers)await w.ask("retire");
  };
  await attach();
  if(config.phase==="admission"){
   for(const [label,count]of [["first",1],["warmup",config.warmups],["timed",config.samples]] as const){
    await phase(workers,`${label}/${config.path}/${config.peers}`);
    for(let i=0;i<count;i++)for(let w=0;w<workers.length;w++)emit({kind:"rpc",label,flavor:workers[w].sub.flavor,index:i,wallMs:await rpc(localPeers[w][0],serial++),dropped:0,refused:0});
   }
  }else if(config.phase==="revokes"){
   const mutator=await spawn("mutator");const key=keys.phones[0].publicKey;
   for(let i=0;i<config.trials;i++){
    if(i){await mutator.ask("mutate",{mutation:{type:"grant",peer:{publicKey:key,pairedAt:"gate-regrant"}}});await attach();}
    invalidations.length=0;await phase(workers,"revoke-"+i);await Bun.sleep((i*137)%1000);
    const ack=await mutator.ask("mutate",{mutation:{type:"revoke",publicKey:key}});
    // No RPC or event is submitted to the idle target after the ACK.
    await wait(()=>workers.every(w=>invalidations.some(v=>v.worker===w.id&&v.key===key)),"idle invalidation",5000);
    await wait(()=>localPeers.every(p=>p[0].closed()),"physical close",5000);
    for(let w=0;w<workers.length;w++){const inv=invalidations.find(v=>v.worker===workers[w].id&&v.key===key),close=localPeers[w][0].closed();
     emit({kind:"revoke",trial:i,flavor:workers[w].sub.flavor,ackNs:ack.at,invalidatedNs:inv.at,signedACKDeltaMs:Number(BigInt(inv.at)-BigInt(ack.at))/1e6,ackToInvalidationMs:Math.max(0,Number(BigInt(inv.at)-BigInt(ack.at))/1e6),physicalCloseMs:Number(BigInt(close.at)-BigInt(ack.at))/1e6,code:close.code});if(close.code!==4003)throw Error("revoked key close code");}
   }
   await mutator.ask("mutate",{mutation:{type:"grant",peer:{publicKey:key,pairedAt:"gate-trials-complete"}}});
  }else if(config.phase==="suspend"||config.phase==="active-revoke"){
   const mutator=await spawn("mutator"),key=keys.phones[0].publicKey;
   await phase(workers,config.phase);invalidations.length=0;
   if(config.phase==="suspend"){
    for(const w of workers)w.child.send({command:"park",id:serial++});
    await wait(()=>workers.every(w=>fs.existsSync(join(config.output,`parked-${w.child.pid}.json`))),"outside-gate parked processes");
   }
   try{
    const ack=await mutator.ask("mutate",{mutation:{type:"revoke",publicKey:key}});
    if(config.phase==="suspend")await mutator.ask("mutate",{mutation:{type:"grant",peer:{publicKey:key,pairedAt:"suspended-regrant"}}});
    const ids=workers.map(()=>serial++);
    for(let w=0;w<workers.length;w++)localPeers[w][0].send({id:ids[w],method:"session/list"});
    if(config.phase==="suspend")for(const w of workers)process.kill(w.child.pid,"SIGCONT");
    await wait(()=>localPeers.every(list=>!!list[0].closed()),"stale transport close");
    for(let w=0;w<workers.length;w++){
     if(localPeers[w][0].data.some((v:any)=>v.id===ids[w]))throw Error("stale transport delivered an RPC result");
     if(localPeers[w][0].closed().code!==(config.phase==="suspend"?4006:4003))throw Error("stale transport close code");
    }
    emit({kind:"lifetime-witness",phase:config.phase,ack,invalidations,closes:localPeers.map(list=>list[0].closed()),wallClockClosurePromise:false});
   }finally{for(const w of workers){try{process.kill(w.child.pid,"SIGCONT");}catch{}}}
   await mutator.ask("mutate",{mutation:{type:"grant",peer:{publicKey:key,pairedAt:"witness-complete"}}});
  }else if(["steady","idle","burst"].includes(config.phase)){
   if(config.phase==="steady"){
    for(const p of localPeers.map(p=>p[0])){const id=serial++;p.send({id,jsonrpc:"2.0",method:"subscription",params:{path:"stream"}});await wait(()=>p.data.some((v:any)=>v.id===id&&v.result?.type==="started"),"subscription started");}
   }
   // Prime the first indicator sweep. The ensuing 60-second idle interval
   // includes the real 60-second full-read backstop, not only stat ticks.
   await Bun.sleep(2100);await phase(workers,config.phase);const before=await counters(workers),began=performance.now(),tasks:Promise<any>[]=[],latencies:any[]=[];
   const deadline=clock.nowNs()+BigInt(config.seconds)*1000000000n;
   const windowCounters=config.phase==="burst"?undefined:(async()=>{while(clock.nowNs()<deadline)await Bun.sleep(Math.max(1,Number(deadline-clock.nowNs())/1e6));return await counters(workers);})();
   windowCounters?.catch(()=>{});
   const submit=(kind:string,w:number,id:number,due:number)=>{
    const queued=performance.now()-due;emit({kind:"offered-operation",operation:kind,worker:w,id,queueDelayMs:queued});
    const p=kind==="rpc"?rpc(localPeers[w][0],id):workers[w].ask(kind,{id});
    const job=p.then(()=>{const row={kind,worker:w,id,queueDelayMs:queued,wallMs:performance.now()-due,completionBoundary:kind==="rpc"?"client RPC reply":"producer IPC acknowledgement"};latencies.push(row);emit({kind:"completed-operation",operation:row});},error=>{emit({kind:"refused-operation",operation:kind,worker:w,id,error:String(error),wallMs:performance.now()-due});throw error;});tasks.push(job);job.catch(()=>{});
   };
   if(config.phase==="burst"){
    for(let i=0;i<100;i++){submit("rpc",i%2,serial++,began);submit("event",i%2,serial++,began);}
   }else if(config.phase==="steady"){
    const offered:any[]=[];
    for(const [kind,rate]of [["rpc",10],["event",10],["stream",12]] as const)for(let i=0;i<config.seconds*rate;i++)offered.push({kind,w:i%2,due:began+i*1000/rate});
    offered.sort((a,b)=>a.due-b.due);
    for(const item of offered){await Bun.sleep(Math.max(0,item.due-performance.now()));submit(item.kind,item.w,serial++,item.due);}
   }else await Bun.sleep(config.seconds*1000);
   await Promise.all(tasks);if(config.phase==="steady")await Bun.sleep(Math.max(0,began+config.seconds*1000-performance.now()));
   // Drain actual frames, not just producer IPC acknowledgements.
   if(config.phase!=="idle"){
    const n=config.phase==="burst"?100:config.seconds*10;
    await wait(()=>localPeers.every((list,w)=>list.every(p=>p.data.filter((v:any)=>v.event?.event==="gate-event").length>=Math.floor(n/2))),"event delivery drain");
    if(config.phase==="steady")await wait(()=>localPeers.reduce((n,list)=>n+list[0].data.filter((v:any)=>v.result?.data?.gateStream!==undefined).length,0)>=config.seconds*12,"awaited frame delivery drain");
   }
   const after=windowCounters?await windowCounters:await counters(workers),elapsedMs=performance.now()-began,cpuWindowMs=config.phase==="burst"?elapsedMs:config.seconds*1000;
   emit({kind:"load",phase:config.phase,baseline:!!config.baseline,elapsedMs,cpuWindowMs,cpuWindowPolicy:"fixed declared window; a late counter includes extra CPU, never extra denominator",counterSpanMs:after.map((row,i)=>Number(BigInt(row.at)-BigInt(before[i].at))/1e6),before,after,cpuPercentOneCore:after.reduce((n,a,i)=>n+(a.usage[0]-before[i].usage[0]+a.usage[1]-before[i].usage[1])/1000/cpuWindowMs*100,0),latencies,dropped:0,refused:0,
    streamArrivalMs:localPeers.map(list=>list[0].data.filter((v:any)=>v.result?.data?.gateStream!==undefined).map((v:any)=>v.gateArrival-began)),deliveredEvents:localPeers.map(list=>list.map(p=>p.data.filter((v:any)=>v.event?.event==="gate-event").length)),deliveredStreamFrames:localPeers.map(list=>list[0].data.filter((v:any)=>v.result?.data?.gateStream!==undefined).length)});
  }else throw Error("unknown workload phase");
 }
 emit({kind:"complete",phase:config.phase,elapsedMs:performance.now()-start,generatorUsageBefore:clientUsage,generatorUsageAfter:process.resourceUsage(),qualification:!config.smoke,version:Bun.version});
}catch(error){failureMessage=String((error as any)?.message??error);emit({kind:"generator-error",message:failureMessage,stack:(error as any)?.stack,atUnixMs:Date.now()});throw error;
}finally{
 stopping=true;
 for(const p of peers){p.ws.onclose=null;p.ws.close();}
 for(const w of children){let stopAcknowledged=false;try{const stopped=await w.ask("stop");stopAcknowledged=true;emit({kind:"workerUsage",role:w.sub.role,flavor:w.sub.flavor,started:w.ready(),stopped});}catch{}emit({kind:"worker-kill",pid:w.child.pid,stopAcknowledged,alreadyExited:w.child.exitCode!==null,cause:failureMessage,atUnixMs:Date.now()});w.child.kill();await w.child.exited;emit({kind:"worker-kill-result",pid:w.child.pid,signalCode:w.child.signalCode,atUnixMs:Date.now()});for(const fd of w.logs)fs.closeSync(fd);}
 clock.close();
}
