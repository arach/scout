import {test,expect,afterEach} from "bun:test";
import {mkdtempSync,mkdirSync,rmSync,readdirSync,readFileSync,writeFileSync,existsSync,lstatSync,renameSync,statfsSync,symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {pack} from "../packages/runtime/src/pairing-security/trust-capsule.ts";
import {capsuleFixture} from "./fixtures/pairing-capsule.ts";
import {pairingTrustOwner} from "../packages/runtime/src/pairing-security/trust-owner.ts";
const roots:string[]=[],removers:(()=>void)[]=[];
afterEach(()=>{for(const remove of removers.splice(0))remove();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(managed=false){
 const disk=statfsSync(process.platform==="darwin"?"/System/Volumes/Data":"/");if(disk.bavail*disk.bsize<3*1024**3)throw Error("3 GiB disk floor");
 const parent=mkdtempSync(join(tmpdir(),"pairing-capsule-quiescent-"));roots.push(parent);
 const root=join(parent,"pairing-capsule-data"),coord=join(parent,"coord");mkdirSync(root,{mode:0o700});mkdirSync(coord);
 let native:object|null=null;
 return {...capsuleFixture(root,{migrate:true,factory:pairingTrustOwner,prepare:managed?owner=>{
  removers.push(owner.register({id:"quiescent-managed-test",currentHolder:()=>native,withGate(_root,body){native={};try{return body(native);}finally{native=null;}}}));
  owner.mutate(owner.read().revision,"managed-fixture",{type:"manage"});
 }:undefined}),coord};
}
async function strand(f:ReturnType<typeof fixture>,count=8){
 const worker=fileURLToPath(new URL("./pairing-slot-reclamation-worker.ts",import.meta.url));
 for(let i=0;i<count;i++){
  const child=Bun.spawn([process.execPath,worker,f.root,f.coord,JSON.stringify({id:`dead-${i}`,key:f.keys[0],point:"after-claim-rename"})],{stdout:"pipe",stderr:"pipe"});
  const [exit,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
  expect(exit,`${i}:${out}:${err}`).toBe(81);
 }
}
test("eight actual post-rename deaths refuse staging, then explicit quiescent reclamation restores mutation",async()=>{
 const f=fixture();await strand(f);
 const slots=readdirSync(f.root).filter(n=>n.startsWith(".pairing-v2-slot-"));expect(slots).toHaveLength(8);
 expect(()=>f.owner.mutate(1,"before-reclamation",{type:"revoke",publicKey:f.keys[0]!})).toThrow("capsule_staging_capacity");
 console.log(JSON.stringify({case:"eight-post-rename-deaths",slots,revision:f.owner.read().revision,
   operation:typeof (f.owner as any).reclaimCapsuleStaging,trace:readFileSync(join(f.coord,"trace.jsonl"),"utf8")}));
 const receipt=(f.owner as any).reclaimCapsuleStaging("recover-eight",{quiescent:true});
 expect(receipt.moved.filter((x:any)=>x.kind==="claim")).toHaveLength(8);
 expect(f.owner.read().revision).toBe(1);
 expect(f.owner.mutate(1,"after-reclamation",{type:"revoke",publicKey:f.keys[0]!}).changed).toBe(true);
 expect(f.owner.read().peers).toEqual([]);
},60_000);

const maintenanceWorker=fileURLToPath(new URL("./pairing-quiescent-reclamation-worker.ts",import.meta.url));
async function maintenance(f:ReturnType<typeof fixture>,options:object={},mode="reclaim"){
 const child=Bun.spawn([process.execPath,maintenanceWorker,mode,f.root,f.coord,JSON.stringify(options)],{stdout:"pipe",stderr:"pipe"});
 const [exit,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
 return {exit,err,value:out.trim()?JSON.parse(out.trim().split("\n").at(-1)!):null};
}
async function debris(f:ReturnType<typeof fixture>){
 const stranded=await maintenance(f,{point:"before-publication",key:f.keys[0]},"strand");expect(stranded.exit,stranded.err).toBe(83);
 const worker=fileURLToPath(new URL("./pairing-slot-reclamation-worker.ts",import.meta.url));
 const p=Bun.spawn([process.execPath,worker,f.root,f.coord,JSON.stringify({point:"after-candidate-sync",id:"candidate",mode:"claim"})],{stdout:"pipe",stderr:"pipe"});
 const [exit,out,err]=await Promise.all([p.exited,new Response(p.stdout).text(),new Response(p.stderr).text()]);expect(exit,out+err).toBe(81);
 // Creation's trace is separate from the operation under test.
 writeFileSync(join(f.coord,"maintenance.jsonl"),"");
}
function trace(f:ReturnType<typeof fixture>){return readFileSync(join(f.coord,"maintenance.jsonl"),"utf8").trim().split("\n").filter(Boolean).map(s=>JSON.parse(s));}
function prove(f:ReturnType<typeof fixture>,id:string){const before=f.owner.read();expect(before.revision).toBeGreaterThanOrEqual(1);
 expect(f.owner.mutate(before.revision,id,{type:"revoke",publicKey:f.keys[0]!}).changed).toBe(true);expect(f.owner.read().peers).toEqual([]);}

test("healthy move-only receipt retains every byte and syncs evidence after every move",async()=>{
 const f=fixture();await debris(f);const before=f.owner.pairingAuthorityStamp();
 const result=await maintenance(f);expect(result.exit,result.err).toBe(0);expect(result.value?.ok,JSON.stringify(result)).toBe(true);
 const receipt=result.value.result;expect(receipt.moved).toHaveLength(6);
 expect(receipt.moved.filter((m:any)=>m.kind==="candidate")).toHaveLength(1);expect(receipt.moved.filter((m:any)=>m.kind==="claim")).toHaveLength(1);
 const events=trace(f);expect(events.filter(e=>e.event==="delete")).toEqual([]);
 for(let i=0;i<events.length;i++)if(events[i].event==="move"){
  const next=events.findIndex((e,j)=>j>i&&e.event==="move"),window=events.slice(i+1,next<0?undefined:next);
  const evidence=window.findIndex(e=>e.event==="sync"&&e.directory&&e.path===receipt.evidenceDirectory);
  const root=window.findIndex(e=>e.event==="sync"&&e.directory&&e.path===f.root);
  expect(evidence).toBeGreaterThanOrEqual(0);expect(root).toBeGreaterThan(evidence);
 }
 expect(f.owner.pairingAuthorityStamp()).toBe(before);
 expect(f.owner.reclaimCapsuleStaging("maintenance",{quiescent:true})).toEqual(receipt);
 for(const m of receipt.moved)expect(existsSync(m.to)).toBe(true);
 prove(f,"healthy-after-maintenance");
 // Exact retry remains valid after a later trust mutation, but re-verifies it.
 expect(f.owner.reclaimCapsuleStaging("maintenance",{quiescent:true})).toEqual(receipt);
 console.log(JSON.stringify({case:"move-only",receipt,events}));
},60_000);

test("actual process exits after every move and fsync converge with all evidence retained",async()=>{
 const healthy=fixture();await debris(healthy);const ok=await maintenance(healthy);expect(ok.value?.ok).toBe(true);
 const events=trace(healthy),moves=events.filter(e=>e.event==="move").length,syncs=events.filter(e=>e.event==="sync").length;
 expect(moves).toBe(6);expect(syncs).toBeGreaterThan(20);
 const f=fixture();
 for(const point of [...Array.from({length:moves},(_,i)=>`before-move-${i+1}`),...Array.from({length:moves},(_,i)=>`move-${i+1}`),
   ...Array.from({length:syncs},(_,i)=>`before-sync-${i+1}`),...Array.from({length:syncs},(_,i)=>`sync-${i+1}`)]){
  if(!f.owner.read().peers.length)f.owner.mutate(f.owner.read().revision,`seed-${point}`,{type:"grant",peer:{publicKey:f.keys[0]!,pairedAt:"2026"}});
  await debris(f);const before=f.owner.pairingAuthorityStamp(),id=`maintenance-${point}`;
  const crashed=await maintenance(f,{point,id});expect(crashed.exit,point+":"+crashed.err).toBe(83);
  expect(f.owner.pairingAuthorityStamp(),point).toBe(before); // Every partial state remains readable.
  const recovered=f.owner.reclaimCapsuleStaging(id,{quiescent:true});expect(recovered.moved,point).toHaveLength(6);
  expect(f.owner.reclaimCapsuleStaging(id,{quiescent:true})).toEqual(recovered);
  for(const item of recovered.moved)expect(existsSync(item.to),point).toBe(true);
  prove(f,`after-${point}`);console.log(JSON.stringify({case:"maintenance-crash",point,moved:recovered.moved.map(m=>m.kind)}));
 }
 console.log(JSON.stringify({case:"maintenance-boundary-counts",moves,syncs}));
},180_000);

test("observable holder refuses before any acquisition or evidence creation",()=>{
 const f=fixture(),holder={};let acquisitions=0;
 const remove=f.owner.register({id:"holder-probe",currentHolder:()=>holder,withGate(){acquisitions++;throw Error("must not acquire while holder observed");}});
 try{expect(()=>f.owner.reclaimCapsuleStaging("held",{quiescent:true})).toThrow("reclamation_holder_active");expect(acquisitions).toBe(0);expect(existsSync(f.root+".pairing-reclamation")).toBe(false);}finally{remove();}
},30_000);

test("live invocation refuses even when an adapter hides its holder",()=>{
 const f=fixture();let holder:object|null=null,hide=false;
 const remove=f.owner.register({id:"live-probe",currentHolder:()=>hide?null:holder,withGate(_root,body){holder={};try{return body(holder);}finally{holder=null;}}});
 try{f.owner.withInvocation(()=>{hide=true;try{expect(()=>f.owner.reclaimCapsuleStaging("live",{quiescent:true})).toThrow("reclamation_holder_active");}finally{hide=false;}});}finally{remove();}
 expect(existsSync(f.root+".pairing-reclamation")).toBe(false);
},30_000);

test("committed publication is completed and never moved as abandoned staging",async()=>{
 const f=fixture();const crashed=await maintenance(f,{key:f.keys[0],point:"after-publication"},"committed");expect(crashed.exit).toBe(83);
 const result=f.owner.reclaimCapsuleStaging("committed",{quiescent:true});expect(result.moved).toEqual([]);
 expect(f.owner.read().revision).toBe(2);expect(f.owner.read().peers).toEqual([]);
 expect(f.owner.mutate(1,"interrupted-revoke",{type:"revoke",publicKey:f.keys[0]!}).revision).toBe(2);
 expect(f.owner.mutate(2,"later",{type:"grant",peer:{publicKey:f.keys[0]!,pairedAt:"2026"}}).revision).toBe(3);
},30_000);

function syntheticClaim(f:ReturnType<typeof fixture>,kind:"candidate"|"claim",t=crypto.randomUUID(),badRoot=false){
 const name=kind==="candidate"?`.pairing-claim-${crypto.randomUUID()}`:".pairing-v2-slot-0",directory=join(f.root,name);
 mkdirSync(directory,{mode:0o700});const s=lstatSync(directory),claim={rootId:badRoot?"other-root":f.rootId,index:0,token:t,identity:`${s.dev}:${s.ino}`};
 writeFileSync(join(directory,`${t}.json`),pack("claim",claim),{mode:0o600});return {name,directory,claim};
}
test("complete token record is verified before moving ignored candidate metadata",()=>{
 const f=fixture(),c=syntheticClaim(f,"candidate",undefined,true);expect(f.owner.read().revision).toBe(1);
 expect(()=>f.owner.reclaimCapsuleStaging("bad-token",{quiescent:true})).toThrow("reclamation_token_invalid");
 expect(existsSync(c.directory)).toBe(true);expect(existsSync(f.root+".pairing-reclamation")).toBe(false);
},30_000);

test("a referenced retained chunk and its token claim never move",()=>{
 const f=fixture(),part=f.head.parts[0]!,t=part.name.match(/data\.([a-f0-9-]{36})\.json$/)![1]!;
 const c=syntheticClaim(f,"claim",t),bytes=readFileSync(join(f.root,part.name));expect(f.owner.read().revision).toBe(1);
 expect(()=>f.owner.reclaimCapsuleStaging("referenced",{quiescent:true})).toThrow("reclamation_referenced");
 expect(readFileSync(join(f.root,part.name))).toEqual(bytes);expect(existsSync(c.directory)).toBe(true);
},30_000);

test("empty metadata is retained, explicit assertion required, and receipt tampering refuses",()=>{
 const f=fixture(),empty=join(f.root,`.pairing-claim-${crypto.randomUUID()}`);mkdirSync(empty,{mode:0o700});
 expect(()=>f.owner.reclaimCapsuleStaging("no-assertion",{} as any)).toThrow("reclamation_quiescence_required");
 const result=f.owner.reclaimCapsuleStaging("empty",{quiescent:true});expect(result.moved).toEqual([]);expect(result.retained).toHaveLength(1);expect(existsSync(empty)).toBe(true);
 writeFileSync(join(result.evidenceDirectory,"receipt.json"),"corrupt");expect(()=>f.owner.reclaimCapsuleStaging("empty",{quiescent:true})).toThrow();
},30_000);

test("both platform rename collision errors retain source and target, then retry safely",async()=>{
 for(const errno of ["EEXIST","ENOTEMPTY"]){const f=fixture();await debris(f);
  const result=await maintenance(f,{conflict:true,errno});expect(result.value?.ok).toBe(false);
  const events=trace(f),failure=events.find(e=>e.event==="rename_failure");expect(failure?.code).toBe(errno);
  const evidence=f.root+".pairing-reclamation/op.maintenance",conflict=readdirSync(evidence).find(n=>n.startsWith(".pairing-claim-"))!;
  expect(readFileSync(join(evidence,conflict,"conflict"),"utf8")).toBe("retain");expect(existsSync(join(f.root,conflict))).toBe(true);
  // Test fixture, under quiescence: move the injected unrelated obstruction, never discard it.
  renameSync(join(evidence,conflict),join(f.coord,`retained-conflict-${errno}`));
  const recovered=f.owner.reclaimCapsuleStaging("maintenance",{quiescent:true});expect(recovered.moved).toHaveLength(6);prove(f,`after-${errno}`);
 }
},60_000);

test("canonical index reuse is bound by the new full token, not a historical head index",async()=>{
 const f=fixture();f.owner.mutate(1,"first-use",{type:"grant",peer:{publicKey:f.keys[0]!,pairedAt:"2027"}});
 await strand(f,1);const receipt=f.owner.reclaimCapsuleStaging("index-reuse",{quiescent:true});
 expect(receipt.moved.filter(x=>x.kind==="claim")).toHaveLength(1);expect(f.owner.read().revision).toBe(2);
 expect(f.owner.mutate(2,"later-use",{type:"revoke",publicKey:f.keys[0]!}).changed).toBe(true);
},30_000);

test("pre-CAS migration directory remains outside this operation and retains migration_busy",async()=>{
 const parent=mkdtempSync(join(tmpdir(),"pairing-capsule-precut-"));roots.push(parent);
 const root=join(parent,"pairing-capsule-data"),coord=join(parent,"coord");mkdirSync(root,{mode:0o700});mkdirSync(coord);
 const {legacyFixture}=await import("./fixtures/pairing-capsule.ts"),f=legacyFixture(root,{factory:pairingTrustOwner,generations:2});
 const worker=fileURLToPath(new URL("./pairing-cutover-worker.ts",import.meta.url));
 const child=Bun.spawn([process.execPath,worker,"cut",f.root,coord,JSON.stringify({point:"after-claim",id:"precut"})],{stdout:"pipe",stderr:"pipe"});
 const [exit,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);expect(exit,out+err).toBe(81);
 expect(()=>f.owner.reclaimCapsuleStaging("precut",{quiescent:true})).toThrow("reclamation_capsule_required");
 expect(existsSync(join(f.root,".pairing-cutover"))).toBe(true);expect(f.owner.read().revision).toBe(2);
 expect(()=>f.owner.migrateToCapsule("precut")).toThrow("migration_busy");
},30_000);

test("managed reclamation uses its own real owner invocation and keeps every move inside that gate",async()=>{
 const f=fixture(true),managedId="quiescent-managed-test";
 const crash=await maintenance(f,{key:f.keys[0],managedId,point:"before-publication"},"strand");expect(crash.exit).toBe(83);
 writeFileSync(join(f.coord,"maintenance.jsonl"),"");
 const result=await maintenance(f,{managedId});expect(result.value?.ok,JSON.stringify(result)).toBe(true);expect(result.value.result.moved).toHaveLength(5);
 const events=trace(f).filter(e=>e.event==="sync"||e.event==="move");expect(events.length).toBeGreaterThan(5);expect(events.every(e=>e.held)).toBe(true);
 expect(f.owner.read().revision).toBe(2);expect(f.owner.mutate(2,"managed-revoke",{type:"revoke",publicKey:f.keys[0]!}).changed).toBe(true);
},30_000);

test("retained token corruption refuses receipt replay without affecting active authority",()=>{
 const f=fixture();syntheticClaim(f,"candidate");const receipt=f.owner.reclaimCapsuleStaging("artifact",{quiescent:true});
 const path=join(receipt.moved[0]!.to,readdirSync(receipt.moved[0]!.to)[0]!);writeFileSync(path,"corrupt");
 expect(()=>f.owner.reclaimCapsuleStaging("artifact",{quiescent:true})).toThrow();prove(f,"after-artifact-corruption");
},30_000);

test("a symlink evidence root is refused rather than followed",()=>{
 const f=fixture();syntheticClaim(f,"candidate");symlinkSync(f.coord,f.root+".pairing-reclamation");
 expect(()=>f.owner.reclaimCapsuleStaging("symlink",{quiescent:true})).toThrow();expect(f.owner.read().revision).toBe(1);
 expect(readdirSync(f.root).filter(n=>n.startsWith(".pairing-claim-"))).toHaveLength(1);
},30_000);
