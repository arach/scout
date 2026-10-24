/** Test instrumentation only: real owner methods and real invocation contract. */
import fs from "node:fs";
import {dlopen,ptr} from "bun:ffi";
import {heapSize} from "bun:jsc";
export function assertCommonClock(value:bigint,before:bigint,after:bigint){if(value<before||value>after)throw Error("cross-process monotonic clock mismatch");}
export function nativeClock(library:string){
 let closed=false;const lib=dlopen(library,{native_now_us:{args:[],returns:"f64"}});
 return {nowNs:()=>{if(closed)throw Error("native clock is closed");const n=lib.symbols.native_now_us();if(!Number.isFinite(n)||n<0)throw Error("native clock");return BigInt(Math.round(n*1000));},close:()=>{if(!closed){closed=true;lib.close();}}};
}
export function instrument(config:any,owner:any,emit:(x:any)=>void){
 const lib=dlopen(config.library,{native_usage:{args:["ptr"],returns:"i32"},native_gate_open:{args:["ptr"],returns:"i32"},native_gate_lock:{args:["i32","ptr"],returns:"i32"},native_gate_unlock:{args:["i32","ptr"],returns:"i32"},native_gate_close:{args:["i32"],returns:"i32"}});
 const clock=nativeClock(config.library);
 const lockPath=Buffer.from(config.gateLock+"\0"),fd=lib.symbols.native_gate_open(ptr(lockPath));if(fd<0)throw Error("test gate open");
 const usage=()=>{const a=new Float64Array(6);if(lib.symbols.native_usage(ptr(a)))throw Error("getrusage");return Array.from(a);};
 let holder:object|null=null,active:any,serial=0,phase="setup",counts:Record<string,number>={},phaseStats:Record<string,{calls:number;wallSumMs:number;maxMs:number}>={},gates:any[]=[];
 const unregister=owner.register({id:"live-session-cost-instrument",currentHolder:()=>holder,withGate(_root:any,body:any){
  if(holder)throw Error("nested authority gate");const times=new Float64Array(3);if(lib.symbols.native_gate_lock(fd,ptr(times)))throw Error("test gate lock");holder={};
  try{const result=body(holder);if(result?.then)throw Error("gate crossed await");return result;}
  finally{if(lib.symbols.native_gate_unlock(fd,ptr(times)))throw Error("test gate unlock");holder=null;gates.push({waitMs:(times[1]!-times[0]!)/1000,holdMs:(times[2]!-times[1]!)/1000});}
 }});
 for(const name of ["readyState","state","capsuleState","readFile","completeCapsule","finishPendingCutover","readAuthority","syncDirectory","completePublication"]){
  const original=owner[name];if(typeof original!=="function")throw Error("missing owner counter: "+name);
  owner[name]=function(...args:any[]){if(!active)return original.apply(this,args);counts[name]=(counts[name]??0)+1;const start=performance.now();try{return original.apply(this,args);}finally{const ms=performance.now()-start,row=phaseStats[name]??={calls:0,wallSumMs:0,maxMs:0};row.calls++;row.wallSumMs+=ms;row.maxMs=Math.max(row.maxMs,ms);}};
 }
 function measure<T>(path:string,body:()=>T):T{
  // Nested measurements are attributed to the outer synchronous decision.
  if(active)return body();
  const id=serial++,memoryBefore=process.memoryUsage(),heapBefore=heapSize();counts={};phaseStats={};gates=[];active={path,id};
  fs.writeSync(2,`GATE_START ${path} ${id}\n`);const before=usage(),start=performance.now();let error:string|undefined;
  try{return body();}catch(e){error=String(e);throw e;}
  finally{const wallMs=performance.now()-start,after=usage();active=undefined;fs.writeSync(2,`GATE_END ${path} ${id}\n`);
   emit({kind:"sample",phase,path,id,wallMs,error,counts,phaseStats,gates,usageBefore:before,usageAfter:after,usageDelta:after.map((n,i)=>n-before[i]!),memoryBefore,memoryAfter:process.memoryUsage(),heapBefore,heapAfter:heapSize(),monotonicNs:clock.nowNs().toString()});}
 }
 if(typeof owner.withTransportAuthority==="function"){
  const original=owner.withTransportAuthority.bind(owner);
  owner.withTransportAuthority=(...args:any[])=>measure("admission",()=>original(...args));
 }
 return {usage,measure,nowNs:clock.nowNs,isHeld:()=>holder!==null,setPhase:(p:string)=>{phase=p;},close:()=>{unregister();lib.symbols.native_gate_close(fd);lib.close();clock.close();}};
}
