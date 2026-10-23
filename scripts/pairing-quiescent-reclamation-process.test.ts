import {test,expect,afterEach} from "bun:test";
import {mkdtempSync,mkdirSync,rmSync,readdirSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {capsuleFixture} from "./fixtures/pairing-capsule.ts";
import {pairingTrustOwner} from "../packages/runtime/src/pairing-security/trust-owner.ts";
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){
 const parent=mkdtempSync(join(tmpdir(),"pairing-capsule-quiescent-"));roots.push(parent);
 const root=join(parent,"pairing-capsule-data"),coord=join(parent,"coord");mkdirSync(root,{mode:0o700});mkdirSync(coord);
 return {...capsuleFixture(root,{migrate:true,factory:pairingTrustOwner}),coord};
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
