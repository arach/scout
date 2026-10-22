/** Test-only actual-runner witness. Never imported by a product entrypoint.
 * Extends, rather than replaces, the qualified 28-case adapter instrument.
 */
import {spawn} from "node:child_process";
import {writeSync,closeSync,fstatSync,mkdirSync,mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {pathToFileURL} from "node:url";
import {executeScoutExtensionContext} from "../../packages/cli/src/cli/extension-context-executor.ts";
import {checkReclaimedDescriptors,type WitnessEvent} from "../../packages/cli/src/cli/extension-descriptor-witness.ts";
import {prefillForWriteAbort} from "./pressure.ts";
import {flags,clearCloseOnExecForNegativeControl} from "./pair.ts";
import type {allocateExtensionChannel} from "../../packages/runtime/src/extension-channel-host.ts";
import type {ChannelDriver} from "../../packages/runtime/src/extension-channel-io.ts";
type Channel=ReturnType<typeof allocateExtensionChannel>;
export type RunnerFault="stale-second-close"|"second-spawn-close"|"finalizer-close"|"mapping"|"eof"|"cloexec"|"collection-retained"|"cancel-double-close";
let retained:object|undefined;
function identity(fd:number) {try {const s=fstatSync(fd);return {dev:s.dev,ino:s.ino,file:s.isFile(),fifo:s.isFIFO(),socket:s.isSocket()};}catch{return null;}}
function same(fd:number,expected:ReturnType<typeof identity>){return expected!==null&&JSON.stringify(identity(fd))===JSON.stringify(expected);}
async function exchange(factory:()=>Channel,iteration:number,previous:number[],directory:string,observe:(o:object)=>WeakRef<object>,event:(e:WitnessEvent)=>void,fault?:RunnerFault){
 let channel:Channel|undefined,ref:WeakRef<object>|undefined,child:ReturnType<typeof spawn>|undefined,deadline:ReturnType<typeof setTimeout>|undefined;
 let output="",errors="",killed=false,ports:number[]=[],expected:Array<ReturnType<typeof identity>>=[],calls:number[]=[];
 let driver:ChannelDriver|undefined,originalClose:ChannelDriver["close"]|undefined;
 const reapFirst=iteration===8,cancelCase=fault==="cancel-double-close"&&!reapFirst;
 const abort=new AbortController();let primer=0,held=false;
 try {
  const outcome=await executeScoutExtensionContext({command:process.execPath,args:["-e",`if(${cancelCase})process.on('SIGTERM',()=>{});import{fstatSync,readSync}from'node:fs';const s=fstatSync(5);console.log(JSON.stringify({event:'mapped',identity:{dev:s.dev,ino:s.ino,file:s.isFile(),fifo:s.isFIFO(),socket:s.isSocket()}}));const b=Buffer.alloc(4096);let wire='';if(${cancelCase}){while(wire.length<4096){const n=readSync(5,b,0,4096-wire.length,null);if(!n)process.exit(92);wire+=b.subarray(0,n);}console.log(JSON.stringify({event:'pressure-held'}));if(readSync(0,Buffer.alloc(1),0,1,null)!==1)process.exit(93);}for(;;){const n=readSync(5,b);if(!n)break;wire+=b.subarray(0,n);if(${reapFirst}&&wire.length===65536)break;}if(${cancelCase}?wire!=='p'.repeat(${"${PRIMER}"})+'r'.repeat(4096):wire!=='r'.repeat(65535)+'\\n')process.exit(91);console.log(JSON.stringify({event:${reapFirst?"'frame'":"'eof'"}}));`],signal:abort.signal,env:{PATH:process.env.PATH},cwd:directory,wire:Buffer.from('r'.repeat(65535)+'\n')},()=>{
   channel=factory();ports=[channel.parent.fd,channel.source.fd];expected=ports.map(identity);
   if(fault==="cloexec")clearCloseOnExecForNegativeControl(channel.source.fd);
   if(ports.some(fd=>fd<=7||flags(fd)!==1))throw Error("CLOEXEC copy discipline failed");
   if(cancelCase)primer=prefillForWriteAbort(bytes=>writeSync(channel!.parent.fd,bytes)).bytes;
   event({event:"copy-discipline",iteration,ports,flags:ports.map(flags),ceiling:7});
   if(iteration===1){const reuse=[ports[0]!].filter(fd=>previous.includes(fd));if(!reuse.length)throw Error("second spawn did not reuse a former descriptor number");event({event:"second-spawn-reuse",reused:reuse});if(fault==="second-spawn-close"){closeSync(ports[0]!);if(!same(ports[0]!,expected[0]!))throw Error("replacement spawn descriptor lost");}}
   // Observe actual driver close syscalls, not merely adapter close invocations.
   driver=(channel.parent as unknown as {driver:ChannelDriver}).driver;originalClose=driver.close;
   driver.close=fd=>{calls.push(fd);const result=originalClose!(fd);if(cancelCase&&fd===ports[0])child?.stdin?.write("d");return result;};
   const write=channel.parent.write.bind(channel.parent);
   channel.parent.write=async(bytes,options)=>{
    const sourceVictim=join(directory,"source");mkdirSync(sourceVictim);
    await checkReclaimedDescriptors({former:[ports[1]!],directory:sourceVictim,emit:e=>event({iteration,phase:"source-close",...e})});
    if(!same(ports[0]!,expected[0]!))throw Error("replacement spawn descriptor lost");
    if(cancelCase){while(!held)await Bun.sleep(1);setTimeout(()=>abort.abort(),10);}
    return await write(bytes,options);
   };
   if(reapFirst||fault==="eof")channel.parent.close=()=>{}; // Explicit reap-first intervention/EOF negative control only.
   return channel;
  },((cmd,args,options)=>{
   const stdio=[...options!.stdio as Array<string|number>];
   if(stdio[5]!==ports[1]||stdio[6]!=="ignore")throw Error("child mapping failed");
   stdio[0]=cancelCase?"pipe":"ignore";stdio[1]="pipe";stdio[2]="pipe";
   if(fault==="mapping"){stdio[4]=stdio[5]!;stdio[5]="ignore";}
   const raw=Bun.spawn;
   Bun.spawn=((...args:unknown[])=>{const native=Reflect.apply(raw,Bun,args);ref=observe(native);if(fault==="collection-retained")retained=native;return native;}) as typeof Bun.spawn;
   try{child=spawn(cmd,args!.map(arg=>arg.replaceAll("${PRIMER}",String(primer))),{...options,stdio:stdio as never});}finally{Bun.spawn=raw;}
   if(!same(ports[1]!,expected[1]!))throw Error("spawn consumed numeric source");
   if((child.stdio as unknown[])[5]!==null)throw Error("runtime-owned extra stream");
   child.stdin?.on("error",()=>{});
   child.stdout!.on("data",chunk=>{output+=chunk;held=output.includes('"event":"pressure-held"');});child.stderr!.on("data",chunk=>{errors+=chunk;});
   deadline=setTimeout(()=>{killed=true;child?.kill("SIGKILL");},3000);
   return child;
  }) as typeof spawn).then(code=>({code,error:null}),error=>({code:null,error}));
  if(outcome.error){if(!cancelCase||outcome.error.reason!=="cancelled")throw outcome.error;}else if(cancelCase)throw Error("cancel unexpectedly completed");
  const code=outcome.code??0;
  if(cancelCase&&(channel!.parent.stats.writeBytes!==4096||channel!.parent.stats.writeWouldBlock<1))throw Error("cancel did not interrupt pending kernel I/O");
  if(fault==="eof"&&killed)throw Error("child EOF failed: retained parent writer");
  const mapped=output.split("\n").filter(Boolean).map(line=>JSON.parse(line)).find(e=>e.event==="mapped");
  if(!mapped||JSON.stringify(mapped.identity)!==JSON.stringify(expected[1]))throw Error("child mapping failed");
  if(code!==0||errors!=="")throw Error(`child exchange failed ${code}`);
  if(!output.includes(JSON.stringify({event:reapFirst?"frame":"eof"})))throw Error("child EOF/frame acknowledgement missing");
  if(!ref)throw Error("native subprocess was not observed");
  if(calls.filter(fd=>fd===ports[1]).length!==1||calls.filter(fd=>fd===ports[0]).length!==(reapFirst?0:1))throw Error("driver close custody failed");
  event({event:"runner-exchange",iteration,sourceCloses:1,parentCloses:reapFirst?0:1});
  return {channel:channel!,ports,expected,ref};
 }catch(error){
  if(fault==="mapping"){
   const mapped=output.split("\n").filter(Boolean).map(line=>JSON.parse(line)).find(e=>e.event==="mapped");
   if(errors.includes("EBADF")||(mapped&&JSON.stringify(mapped.identity)!==JSON.stringify(expected[1])))throw Error("child mapping failed");
  }
  throw error;
 }
 finally {
  clearTimeout(deadline);
  if(child&&child.exitCode===null&&child.signalCode===null){const ended=new Promise(done=>child!.once("close",done));child.kill("SIGKILL");await ended;}
  if(driver&&originalClose)driver.close=originalClose;
  child=undefined;
 }
}
export async function runnerWitness(factory:()=>Channel,emit:(e:WitnessEvent)=>void=()=>{},fault?:RunnerFault){
 const directory=mkdtempSync(join(tmpdir(),"scout-runner-reclaim-"));
 const event=(e:WitnessEvent)=>emit({form:"context",target:5,io:"actual-runner",...e});
 const tracker={seen:new Set<WeakRef<object>>(),registry:null as FinalizationRegistry<WeakRef<object>>|null};
 tracker.registry=new FinalizationRegistry(ref=>tracker.seen.add(ref));
 const observe=(native:object)=>{const ref=new WeakRef(native);tracker.registry!.register(native,ref);return ref;};
 const refs:WeakRef<object>[]=[];let previous:number[]=[],last:Awaited<ReturnType<typeof exchange>>|undefined;
 try {
  for(let iteration=0;iteration<9;iteration++){
   const work=join(directory,String(iteration));mkdirSync(work);
   const result=await exchange(factory,iteration,previous,work,observe,event,fault);refs.push(result.ref);previous=result.ports;
   if(iteration===8){last=result;break;}
   const victims=join(work,"parent");mkdirSync(victims);
   await checkReclaimedDescriptors({former:fault==="cancel-double-close"?[result.ports[0]!]:result.ports,directory:victims,staleClose:fault==="stale-second-close"||fault==="cancel-double-close",emit:e=>event({iteration,phase:"parent-close",...e})});
  }
  if(!last)throw Error("missing reap-first exchange");
  if(fault==="finalizer-close")closeSync(last.ports[0]!);
  const victims=join(directory,"reap-source");mkdirSync(victims);
  await checkReclaimedDescriptors({former:[last.ports[1]!],directory:victims,collected:()=>refs.every(ref=>tracker.seen.has(ref)),emit:e=>event({phase:"reap-first-source-victim",...e})});
  if(!same(last.ports[0]!,last.expected[0]!))throw Error("finalizer closed runtime-owned number");
  for(let iteration=0;iteration<refs.length;iteration++){if(refs[iteration]!.deref()!==undefined)throw Error("native subprocess was not collected");event({event:"native-collected",iteration});}
  event({event:"reap-before-close-survived",iteration:8,parent:last.ports[0]});
  // The intervention replaced only this instance method, not adapter source.
  const prototype=Object.getPrototypeOf(last.channel.parent) as Channel["parent"];
  const driver=(last.channel.parent as unknown as {driver:ChannelDriver}).driver,close=driver.close;let parentCloses=0;
  driver.close=fd=>{if(fd===last!.ports[0])parentCloses++;return close(fd);};
  try{prototype.close.call(last.channel.parent);}finally{driver.close=close;}
  if(parentCloses!==1)throw Error("reap-first driver close custody failed");
  event({event:"reap-first-parent-close",parentCloses});
  const parentVictims=join(directory,"last-parent");mkdirSync(parentVictims);
  await checkReclaimedDescriptors({former:last.ports,directory:parentVictims,emit:e=>event({phase:"parent-close",...e})});
  const final=join(directory,"final");mkdirSync(final);
  await checkReclaimedDescriptors({former:last.ports,directory:final,emit:e=>event({phase:"all-native-finalized",...e})});
  event({event:"complete",eofExchanges:8,reapFirstExchanges:1,reuse:true});
 }finally{
  if(last&&same(last.ports[0]!,last.expected[0]!)){const prototype=Object.getPrototypeOf(last.channel.parent) as Channel["parent"];prototype.close.call(last.channel.parent);}
  retained=undefined;rmSync(directory,{recursive:true,force:true});
 }
}
if(import.meta.main){
 const fault=(process.argv[2]==="none"?undefined:process.argv[2]) as RunnerFault|undefined;
 const location=process.argv[3]?pathToFileURL(process.argv[3]):new URL("../../packages/runtime/src/extension-channel-host.ts",import.meta.url);
 try{const host:typeof import("../../packages/runtime/src/extension-channel-host.ts")=await import(location.href);await runnerWitness(()=>host.allocateExtensionChannel("context"),e=>console.log(JSON.stringify(e)),fault);}
 catch(error){console.log(JSON.stringify({event:"failure",fault,error:String(error)}));process.exitCode=1;}
}
