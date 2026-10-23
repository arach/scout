import {test,expect,afterEach} from "bun:test";
import {mkdtempSync,mkdirSync,rmSync,readdirSync,readFileSync,writeFileSync,existsSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {capsuleFixture} from "./fixtures/pairing-capsule.ts";
import {pairingTrustOwner} from "../packages/runtime/src/pairing-security/trust-owner.ts";
const worker=fileURLToPath(new URL("./pairing-slot-reclamation-worker.ts",import.meta.url)),roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){const root=mkdtempSync(join(tmpdir(),"pairing-capsule-reclamation-"));roots.push(root);const data=join(root,"pairing-capsule-data"),coord=join(root,"coord");mkdirSync(data,{mode:0o700});mkdirSync(coord);return {f:capsuleFixture(data,{migrate:true,factory:pairingTrustOwner}),coord};}
const launch=(root:string,coord:string,options:object)=>Bun.spawn([process.execPath,worker,root,coord,JSON.stringify(options)],{stdout:"pipe",stderr:"pipe"});
async function result(child:ReturnType<typeof launch>){const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);return {code,stderr,value:stdout.trim()?JSON.parse(stdout.trim().split("\n").at(-1)!):null};}
async function ready(path:string){const end=Date.now()+30000;while(!existsSync(path)){if(Date.now()>end)throw Error("fixture pause not reached");await Bun.sleep(5);}}
function empties(root:string){for(let i=0;i<8;i++)mkdirSync(join(root,`.pairing-v2-slot-${i}`),{mode:0o700});}
function events(coord:string){return readFileSync(join(coord,"trace.jsonl"),"utf8").trim().split("\n").map(line=>JSON.parse(line));}
test("abandoned empty slots are reclaimed so a stranded store can revoke",()=>{
 const {f}=fixture();empties(f.root);const key=f.owner.read().peers[0]!.publicKey;
 const outcome=f.owner.mutate(1,"revoke-after-stranding",{type:"revoke",publicKey:key});
 expect(outcome.changed).toBe(true);expect(f.owner.read().peers).toEqual([]);
 expect(f.owner.mutate(1,"revoke-after-stranding",{type:"revoke",publicKey:key})).toEqual(outcome);
 expect(readdirSync(f.root).filter(n=>n.startsWith(".pairing-v2-slot-"))).toHaveLength(7);
},30000);
test("eight live token-bearing claims refuse staging and are not replaced",()=>{
 const {f}=fixture(),owner=f.owner as any;
 owner.operation(undefined,(root:any)=>{
  const claims=Array.from({length:8},()=>owner.claimCapsuleSlot(root));
  const before=claims.map(c=>readFileSync(join(f.root,`.pairing-v2-slot-${c.index}`,`${c.token}.json`),"utf8"));
  expect(()=>f.owner.mutate(1,"ninth",{type:"revoke",publicKey:"a".repeat(64)})).toThrow("capsule_staging_capacity");
  expect(claims.map(c=>readFileSync(join(f.root,`.pairing-v2-slot-${c.index}`,`${c.token}.json`),"utf8"))).toEqual(before);
  for(const claim of claims)owner.releaseCapsuleSlot(root,claim);
 });
},30000);
test("real interruptions between candidate stage rename unlink and rmdir preserve recovery",async()=>{
 for(const point of ["after-candidate-mkdir","after-candidate-token","after-candidate-sync","after-claim-rename","after-slot-token-unlink","before-slot-rmdir","after-slot-rmdir"]){
  const {f,coord}=fixture();empties(f.root);
  const crashed=await result(launch(f.root,coord,{id:"crashed",point}));expect(crashed.code,`${point}:${crashed.stderr}`).toBe(81);
  const revision=f.owner.read().revision;
  const next=f.owner.mutate(revision,`recovered-${point}`,{type:"revoke",publicKey:f.owner.read().peers[0]?.publicKey??"a".repeat(64)});
  expect(next.revision).toBe(revision+1);
  const trace=events(coord);console.log(JSON.stringify({case:"slot-crash",point,revision,next,trace}));
  if(point==="after-claim-rename"){
   const rename=trace.find(e=>e.claim===true);expect(rename).toBeDefined();
   const source=rename.source;expect(trace.some(e=>e.event==="sync" && e.directory===true && e.path===source)).toBe(true);
   expect(trace.some(e=>e.event==="sync" && e.directory===false && e.path.startsWith(source+"/"))).toBe(true);
  }
 }
},30000);
test("two real claimants race one abandoned slot with exactly one rename winner",async()=>{
 const {f,coord}=fixture(),owner=f.owner as any;
 owner.operation(undefined,(root:any)=>{for(let i=0;i<7;i++)owner.claimCapsuleSlot(root);});mkdirSync(join(f.root,".pairing-v2-slot-7"),{mode:0o700});
 const a=launch(f.root,coord,{mode:"claim",id:"one",index:7,point:"before-claim-rename",pause:true});
 const b=launch(f.root,coord,{mode:"claim",id:"two",index:7,point:"before-claim-rename",pause:true});
 try{await Promise.all([ready(join(coord,"ready-one")),ready(join(coord,"ready-two"))]);}finally{writeFileSync(join(coord,"go"),"go");}
 const responses=await Promise.all([result(a),result(b)]);expect(responses.filter(r=>r.value?.ok)).toHaveLength(1);
 expect(responses.find(r=>!r.value?.ok)?.value.error).toContain("capsule_staging_capacity");
 const trace=events(coord),wins=trace.filter(e=>e.event==="rename" && e.claim && e.target.endsWith("slot-7"));expect(wins).toHaveLength(1);
 expect(readdirSync(join(f.root,".pairing-v2-slot-7"))).toEqual([`${responses.find(r=>r.value?.ok)!.value.result.token}.json`]);
 console.log(JSON.stringify({case:"single-empty-slot-race",responses,trace}));
},30000);
test("late release cannot delete a new live claim renamed over its abandoned empty slot",async()=>{
 const {f,coord}=fixture();const writer=launch(f.root,coord,{id:"paused-release",point:"before-slot-rmdir",pause:true});
 let claimed:any;
 try{
  await ready(join(coord,"ready-paused-release"));
  const contender=await result(launch(f.root,coord,{mode:"claim",id:"replacement"}));expect(contender.value?.ok).toBe(true);claimed=contender.value.result;
 }finally{writeFileSync(join(coord,"go"),"go");}
 const released=await result(writer);expect(released.value?.ok).toBe(true);
 expect(readdirSync(join(f.root,`.pairing-v2-slot-${claimed.index}`))).toEqual([`${claimed.token}.json`]);
 expect(f.owner.read().revision).toBe(2);console.log(JSON.stringify({case:"late-release-replaced-empty",released,claimed,trace:events(coord)}));
},30000);

test("candidate claim durability and absence of direct slot mkdir are witnessed",async()=>{
 const {f,coord}=fixture();
 const response=await result(launch(f.root,coord,{id:"ordered"}));expect(response.value?.ok).toBe(true);
 const trace=events(coord),claim=trace.findIndex(e=>e.event==="rename" && e.claim);
 expect(claim).toBeGreaterThan(0);const source=trace[claim]!.source;
 const tokenSync=trace.findIndex(e=>e.event==="sync" && !e.directory && e.path.startsWith(source+"/"));
 const directorySync=trace.findIndex(e=>e.event==="sync" && e.directory && e.path===source);
 expect(tokenSync).toBeGreaterThan(0);expect(directorySync).toBeGreaterThan(tokenSync);expect(claim).toBeGreaterThan(directorySync);
 expect(trace.slice(directorySync+1,claim).some(e=>e.event==="sync" && e.path===f.root)).toBe(true);
 const bulk=trace.findIndex(e=>e.event==="sync" && e.path.includes("/trusted-peers.v2.data."));
 expect(trace.slice(claim+1,bulk).some(e=>e.event==="sync" && e.path===f.root)).toBe(true);
 expect(trace.filter(e=>e.event==="mkdir" && /\.pairing-v2-slot-[0-7]$/.test(e.path))).toEqual([]);
 console.log(JSON.stringify({case:"candidate-durability-order",response,trace}));
},30000);

test("both platform nonempty-rename errnos preserve live claims and reclaim the empty index",async()=>{
 const {f,coord}=fixture(),owner=f.owner as any;
 const live=owner.operation(undefined,(root:any)=>Array.from({length:7},()=>owner.claimCapsuleSlot(root)));
 const before=live.map((c:any)=>readFileSync(join(f.root,`.pairing-v2-slot-${c.index}`,`${c.token}.json`),"utf8"));
 for(const renameErrno of ["ENOTEMPTY","EEXIST"]){
  mkdirSync(join(f.root,".pairing-v2-slot-7"),{mode:0o700});
  const response=await result(launch(f.root,coord,{mode:"claim",id:renameErrno,renameErrno}));
  expect(response.value?.ok,JSON.stringify(response)).toBe(true);expect(response.value.result.index).toBe(7);
  expect(live.map((c:any)=>readFileSync(join(f.root,`.pairing-v2-slot-${c.index}`,`${c.token}.json`),"utf8"))).toEqual(before);
  owner.operation(undefined,(root:any)=>owner.releaseCapsuleSlot(root,response.value.result));
 }
 const trace=events(coord);expect(trace.filter(e=>e.event==="rename_failure").map(e=>e.code)).toEqual([...Array(7).fill("ENOTEMPTY"),...Array(7).fill("EEXIST")]);
 console.log(JSON.stringify({case:"platform-rename-errnos",trace}));
},30000);
