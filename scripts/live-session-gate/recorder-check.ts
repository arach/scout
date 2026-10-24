/** Behavior and alias self-test, NOT the gate. Run in a fresh process per Bun. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
import {installSyncSpawnRecorder} from "./spawn-recorder.ts";
const output=process.argv[2]??fs.mkdtempSync(path.join(os.tmpdir(),"gate-recorder-check-"));fs.mkdirSync(output,{recursive:true});
const realMode=process.argv[3]==="real";
const real=cp.execFileSync,sentinel={exactThrownObject:true},receiver={receiver:true};let seen:any;
// A planted implementation proves exact return, receiver, argument and throw identity.
const result={exactReturnObject:true};if(!realMode)cp.execFileSync=function execFileSync(this:any,...args:any[]){seen={self:this,args};if(args[0]==="throw")throw sentinel;return result;}as any;
const probe=installSyncSpawnRecorder(output),wrapped=cp.execFileSync;
if(!realMode){
const argument={get value(){throw Error("must not inspect getter");}};
assert.equal(Reflect.apply(wrapped,receiver,[argument]),result);assert.equal(seen.self,receiver);assert.equal(seen.args[0],argument);
assert.throws(()=>Reflect.apply(wrapped,receiver,["throw"]),e=>e===sentinel);
assert.equal(wrapped.name,real.name); // Both planted and original are named execFileSync.
for(const m of [await import("node:child_process"),await import("child_process"),require("child_process"),require("node:child_process")]){
 assert.equal(m.execFileSync,wrapped);assert.equal(m.default?.execFileSync??m.execFileSync,wrapped);
 assert.equal(m.execFileSync("alias"),result);
}
}else{
 const named=await import("node:child_process");
 assert.equal(named.execFileSync("/bin/sh",["-c","printf real; printf err >&2"],{encoding:"utf8",stdio:"pipe"}),"real");
 const args=["/bin/sh",["-c","printf out; printf err >&2; exit 6"],{encoding:"utf8",stdio:"pipe"}]as const;
 let before:any,after:any;try{Reflect.apply(real,cp,args);}catch(e){before=e;}try{Reflect.apply(named.execFileSync,cp,args);}catch(e){after=e;}
 for(const key of ["status","signal","stdout","stderr"])assert.deepEqual(after[key],before[key]);
}
// Other APIs retain actual output/status/error/stdio behavior.
assert.equal(cp.execSync("printf gate-recorder",{encoding:"utf8"}),"gate-recorder");
const spawned=cp.spawnSync("/bin/sh",["-c","printf out; printf err >&2; exit 7"],{encoding:"utf8"});
assert.equal(spawned.status,7);assert.equal(spawned.stdout,"out");assert.equal(spawned.stderr,"err");
assert.equal(cp.spawnSync("/no/such/gate-executable").error?.["code" as keyof Error],"ENOENT");
const bun=Bun.spawnSync(["/bin/sh","-c","printf bun; printf err >&2; exit 8"]);
assert.equal(bun.exitCode,8);assert.equal(bun.stdout.toString(),"bun");assert.equal(bun.stderr.toString(),"err");
const inherited=fs.openSync(path.join(output,"stdio.txt"),"wx");cp.spawnSync("/bin/sh",["-c","printf inherited"],{stdio:["ignore",inherited,"ignore"]});fs.closeSync(inherited);
assert.equal(fs.readFileSync(path.join(output,"stdio.txt"),"utf8"),"inherited");
probe.finish();const data=fs.readFileSync(path.join(output,`${process.pid}.sync-spawn.jsonl`),"utf8").trim().split("\n").map(x=>JSON.parse(x));
assert.equal(data.filter(x=>x.event==="start").length,Object.values(probe.counts).reduce((a,b)=>a+b,0));
assert.equal(data.filter(x=>x.event==="start").length,data.filter(x=>x.event==="end").length);
assert.ok(data.filter(x=>x.event==="start").every(x=>x.arguments&&x.stack&&Number.isFinite(x.atUnixMs)));
assert.ok(data.filter(x=>x.event==="end").every(x=>Number.isFinite(x.durationMs)&&x.durationMs>=0));
console.log(JSON.stringify({notTheGate:true,version:Bun.version,counts:probe.counts,output}));
