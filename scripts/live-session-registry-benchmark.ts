/** Preliminary registry core gate. Real migration, real Noise bindings and
 * managed public owner gate. Endpoint/process workload qualification is separate. */
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir,cpus,release} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {capsuleFixture} from "./fixtures/pairing-capsule.ts";
import {fixtureHost,liveTransport,generateKeyPair} from "./fixtures/live-transport.ts";
import {bytesToHex} from "../packages/runtime/src/pairing-security/identity.ts";
import {TransportDomain,requireTransportContext} from "../packages/runtime/src/pairing-security/transport.ts";
import type {PairingTrustOwner} from "../packages/runtime/src/pairing-security/trust-owner.ts";
const tier=process.argv[2]??"realistic", large=tier==="large", n=large?32:4;
const root=mkdtempSync(join(tmpdir(),"pairing-capsule-registry-bench-"));
const report:any={tier,kind:"preliminary-core-not-endpoint-qualification",runtime:{version:Bun.version,revision:Bun.revision,
 binarySha256:createHash("sha256").update(readFileSync(process.execPath)).digest("hex"),platform:process.platform,release:release(),cpu:cpus()[0]?.model},samples:{},limits:{admission:large?[25,75,200]:[5,15,50],gate:large?[20,60,150]:[3,10,30],sweep:large?[25,75,200]:[5,15,50]}};
let domain:TransportDomain|undefined,unregister:(()=>void)|undefined,hold:number[]=[],holder:object|null=null;
const start=performance.now(),startCpu=process.cpuUsage();
try {
 const phones=Array.from({length:n},()=>generateKeyPair()),host=generateKeyPair();
 const keys=phones.map(p=>bytesToHex(p.publicKey));
 const f=capsuleFixture(root,{generations:(large?10000:100)-1,keys:n,publicKeys:keys,migrate:true,prepare:(owner:PairingTrustOwner)=>{
   unregister=owner.register({id:"registry-gate-probe",currentHolder:()=>holder,withGate(_root,body){
     if(holder)throw Error("Nested gate probe");holder={};const t=performance.now();
     try {return body(holder);}finally{hold.push(performance.now()-t);holder=null;}
   }});
   owner.mutate(owner.read().revision,"fixture-managed",{type:"manage"});
 }});
 report.preparation={elapsed:performance.now()-start,cpu:process.cpuUsage(startCpu),legacyBytes:f.legacyBytes,
   revision:f.owner.read().revision,migrationId:f.barrier.migration?.migrationId,parts:f.head.parts.length};
 domain=new TransportDomain({},bytesToHex(host.publicKey),f.owner);fixtureHost(domain,host);
 const peers=phones.map(p=>liveTransport(domain!,p));
 const stat=(values:number[])=>{const s=[...values].sort((a,b)=>a-b);return [s[Math.ceil(s.length*.5)-1],s[Math.ceil(s.length*.95)-1],s.at(-1)];};
 report.firstTouch={admission:performance.now()};requireTransportContext(peers[0].ctx);report.firstTouch.admission=performance.now()-report.firstTouch.admission;
 for(const [name,op]of Object.entries({admission:()=>requireTransportContext(peers[0].ctx),sweep:()=>{(domain as any).indicator="";domain!.sweep();}})){
   for(let i=0;i<100;i++)op();
   const values:number[]=[],holds:number[]=[];
   for(let i=0;i<1000;i++){
     hold=[];const t=performance.now();op();values.push(performance.now()-t);holds.push(...hold);
     if(values.at(-1)!>report.limits[name][2] || holds.some(v=>v>report.limits.gate[2])){
       report.samples[name]=values;report.samples[name+"Gate"]=holds;report.stop={metric:name,index:i,reason:"maximum ceiling"};throw Error("cost gate exceeded");
     }
   }
   report.samples[name]=values;report.samples[name+"Gate"]=holds;
   report[name]={latency:stat(values),hold:stat(holds)};
   if(stat(values).some((v,i)=>v!>report.limits[name][i])||stat(holds).some((v,i)=>v!>report.limits.gate[i])){report.stop={metric:name,reason:"percentile ceiling"};throw Error("cost gate exceeded");}
 }
 report.ok=true;
}catch(error){report.ok=false;report.error=String(error);process.exitCode=1;}
finally{domain?.dispose();unregister?.();rmSync(root,{recursive:true,force:true});console.log(JSON.stringify(report));}
