/** Gate-only bootstrap. Install before importing any product module. */
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import {mock} from "bun:test";
import {inspect} from "node:util";

export function installSyncSpawnRecorder(output:string){
 const fd=fs.openSync(path.join(output,`${process.pid}.sync-spawn.jsonl`),"wx",0o600);
 const counts:Record<string,number>={execSync:0,execFileSync:0,spawnSync:0,"Bun.spawnSync":0};let serial=0,broken=false;
 const emit=(row:any)=>{try{fs.writeSync(fd,JSON.stringify({pid:process.pid,atUnixMs:Date.now(),...row})+"\n");}catch{broken=true;}};
 const wrap=(target:any,key:string,api:string)=>{
  const original=target[key],descriptor=Object.getOwnPropertyDescriptor(target,key)!;
  const wrapped=function(this:any,...args:any[]){
   const id=serial++,started=performance.now();counts[api]++;
   let argumentsText="<uninspectable>",expectedChild:string|null=null;
   try{argumentsText=inspect(args,{depth:null,maxArrayLength:null,maxStringLength:null,getters:false,customInspect:false});
    // Data properties only: observation must not invoke an option getter twice.
    const options=args[0]&&typeof args[0]==="object"&&!Array.isArray(args[0])?Object.getOwnPropertyDescriptor(args[0],"cmd")?.value:undefined;
    const vector=Array.isArray(args[0])?args[0]:options;
    const command=api==="execSync"?"/bin/sh":vector?Object.getOwnPropertyDescriptor(vector,"0")?.value:args[0];
    if(typeof command==="string")expectedChild=path.basename(command);
   }catch{}
   emit({kind:"sync-spawn",event:"start",id,api,arguments:argumentsText,expectedChild,stack:new Error().stack,monotonicMs:started});
   let threw=true;
   try{const result=Reflect.apply(original,this,args);threw=false;return result;}
   finally{emit({kind:"sync-spawn",event:"end",id,api,durationMs:performance.now()-started,threw});}
  };
  Object.defineProperty(wrapped,"name",{value:original.name});Object.defineProperty(wrapped,"length",{value:original.length});
  Object.defineProperty(target,key,{...descriptor,value:wrapped});
 };
 for(const key of ["execSync","execFileSync","spawnSync"])wrap(cp,key,key);
 wrap(Bun,"spawnSync","Bun.spawnSync");
 // Bun 1.3.13/14 syncBuiltinESMExports does not update named bindings. Keep
 // default object and async-function identities, and publish those SAME wrappers to both aliases.
 const exports={...cp,default:cp};
 mock.module("node:child_process",()=>exports);mock.module("child_process",()=>exports);
 emit({kind:"sync-spawn-recorder",event:"ready",apis:Object.keys(counts)});
 process.on("exit",()=>emit({kind:"sync-spawn-recorder",event:"exit",counts,broken}));
 return {counts,finish:()=>emit({kind:"sync-spawn-recorder",event:"stop",counts,broken})};
}
