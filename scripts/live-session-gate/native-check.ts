/** Native clock, wait/hold and mutual-exclusion self-test. NOT THE GATE. */
import assert from "node:assert/strict";
import fs from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {instrument,nativeClock,assertCommonClock} from "./instrument.ts";
const [library,mode,shared]=process.argv.slice(2);assert(library);
const root=shared??fs.mkdtempSync(join(tmpdir(),"scout-live-gate-native-")),clock=nativeClock(library);
const rows:any[]=[];let adapter:any;
const owner:any={register:(a:any)=>{adapter=a;return()=>{};}};
for(const name of ["readyState","state","capsuleState","readFile","completeCapsule","finishPendingCutover","readAuthority","syncDirectory","completePublication"])owner[name]=()=>{};
const probe=instrument({library,gateLock:join(root,"lock")},owner,row=>rows.push(row));
if(mode==="child"){
 fs.writeFileSync(join(root,"ready"),"outside");
 probe.measure("lock-child",()=>adapter.withGate(null,()=>fs.writeFileSync(join(root,"entered"),"inside")));
 console.log(JSON.stringify({at:clock.nowNs().toString(),rows}));probe.close();clock.close();process.exit(0);
}
let child:ReturnType<typeof Bun.spawn>|undefined;
try{
 const before=clock.nowNs();
 probe.measure("lock-parent",()=>adapter.withGate(null,()=>{
  child=Bun.spawn([process.execPath,fileURLToPath(import.meta.url),library,"child",root],{stdout:"pipe",stderr:"pipe"});
  const deadline=performance.now()+10000;
  while(!fs.existsSync(join(root,"ready"))){assert(performance.now()<deadline,"native child must start");Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2);}
  assert(!fs.existsSync(join(root,"entered")),"another process must not enter the held gate");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50);
  assert(!fs.existsSync(join(root,"entered")),"native mutex must remain held");
 }));
 const timer=setTimeout(()=>child?.kill(),15000);
 const [code,out,err]=await Promise.all([child!.exited,new Response(child!.stdout as ReadableStream).text(),new Response(child!.stderr as ReadableStream).text()]);clearTimeout(timer);assert.equal(code,0,err);
 const receipt=JSON.parse(out.trim());assertCommonClock(BigInt(receipt.at),before,clock.nowNs());
 assert(rows[0].gates[0].holdMs>=50,"true hold must include the synchronous body and native unlock boundary");
 assert(receipt.rows[0].gates[0].waitMs>=0);
 assert.throws(()=>assertCommonClock(process.hrtime.bigint(),before,clock.nowNs()),/clock mismatch/);
 console.log(JSON.stringify({bun:Bun.version,qualification:false,commonClock:true,wrongOriginControlCaught:true,mutualExclusion:true,parent:rows[0].gates,child:receipt.rows[0].gates}));
}finally{child?.kill();if(child)await child.exited;probe.close();clock.close();fs.rmSync(root,{recursive:true,force:true});}
