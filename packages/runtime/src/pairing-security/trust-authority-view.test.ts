import {afterEach,expect,test} from "bun:test";
import {mkdtempSync,rmSync,readFileSync,writeFileSync,unlinkSync,readdirSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {pairingTrustOwner,PairingTrustError,type PairingTrustAdapter} from "./trust-owner.ts";
import {capsuleFixture} from "../../../../scripts/fixtures/pairing-capsule.ts";
import {pack,digest,commitName,doneName} from "./trust-capsule.ts";
const roots:string[]=[],removers:(()=>void)[]=[];
afterEach(()=>{for(const r of removers.splice(0))r();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});});
function fixture(options:Parameters<typeof capsuleFixture>[1]={}){const root=mkdtempSync(join(tmpdir(),"pairing-capsule-view-"));roots.push(root);return capsuleFixture(root,{factory:pairingTrustOwner,generations:4,keys:2,...options});}
function adapter(){let holder:object|null=null;const a:PairingTrustAdapter={id:"view.test",currentHolder:()=>holder,withGate(_r,body){holder={};try{return body(holder);}finally{holder=null;}}};return a;}
function code(body:()=>unknown){try{body();return "accepted";}catch(e){return e instanceof PairingTrustError?e.code:(e as NodeJS.ErrnoException).code??(e as Error).name;}}
function rewrite(f:ReturnType<typeof fixture>,edit:(h:any)=>void){const h=JSON.parse(readFileSync(join(f.root,commitName(1)),"utf8")).capsule;edit(h);const bytes=pack("capsule",h);writeFileSync(join(f.root,commitName(1)),bytes);writeFileSync(join(f.root,doneName(1)),pack("receipt",{schema:"scout.pairing-collected/v2",rootId:f.rootId,serial:1,physicalHash:digest(bytes)}));}
function rows(f:ReturnType<typeof fixture>,edit:(r:any[])=>void){
 const name=f.head.parts[0]!.name,r=JSON.parse(readFileSync(join(f.root,name),"utf8"));edit(r);const bytes=JSON.stringify(r);writeFileSync(join(f.root,name),bytes);
 // Keep both independently hashed headers consistent, so row validation, not
 // an unrelated envelope checksum, must reject this fixture.
 const b=JSON.parse(readFileSync(join(f.root,f.barrierName),"utf8")).barrier;
 b.parts[0]={...b.parts[0],bytes:Buffer.byteLength(bytes),sha256:digest(bytes)};b.outcomesDigest=digest(bytes);
 const barrier=pack("barrier",b),cutHash=digest(barrier);writeFileSync(join(f.root,f.barrierName),barrier);
 writeFileSync(join(f.root,"trusted-peers.v2.cutover.json"),pack("receipt",{schema:"scout.pairing-cutover-done/v2",rootId:f.rootId,cutHash}));
 rewrite(f,h=>{h.parts=b.parts;h.outcomesDigest=b.outcomesDigest;h.cutHash=cutHash;h.previousPhysicalHead=cutHash;});
}
test("authority view shares stamp and peers with full reads without materializing retry state",()=>{
 for(const projection of [undefined,"[]",null," [ ] \n"]){const f=fixture({projection}),o=f.owner as any;
  const s=o.readAuthority();expect(s.stamp).toBe(o.pairingAuthorityStamp());expect(s.revision).toBe(o.read().revision);expect(s.peers).toEqual(o.read().peers);
  const compact=o.operation(undefined,(r:any)=>o.readyState(r,false));expect(Object.keys(compact.outcomes)).toHaveLength(0);expect(compact.capsule.rows).toHaveLength(0);expect(compact.capsule.partData).toHaveLength(0);
  const full=o.operation(undefined,(r:any)=>o.readyState(r));expect(Object.keys(full.outcomes)).toHaveLength(4);expect(full.capsule.rows).toHaveLength(4);expect(full.capsule.partData.length).toBeGreaterThan(0);
  s.peers.push({publicKey:"e".repeat(64),pairedAt:"test"});expect(o.readAuthority().peers).not.toContainEqual(s.peers.at(-1));
 }
});
const cases=[
 {id:"changed early chunk",expected:"capsule_chunk_checksum",edit:(f:any)=>writeFileSync(join(f.root,f.head.parts[0].name),readFileSync(join(f.root,f.head.parts[0].name),"utf8").replace("fixture-1","fixture-0"))},
 {id:"row validation",expected:"capsule_outcome_invalid",edit:(f:any)=>rows(f,r=>r[0][4]="not-boolean")},
 {id:"duplicate mutation ID",expected:"capsule_outcome_invalid",edit:(f:any)=>rows(f,r=>r[1][0]=r[0][0])},
 {id:"bad row revision",expected:"capsule_outcome_invalid",edit:(f:any)=>rows(f,r=>r[0][1]=2)},
 {id:"invalid charge row",expected:"capsule_outcome_invalid",edit:(f:any)=>rows(f,r=>r[0][6]=0)},
 {id:"charge mismatch",expected:"capsule_outcomes_invalid",edit:(f:any)=>rewrite(f,h=>h.chargedBytes--)},
 {id:"unsupported serial",expected:"capsule_version_unsupported",edit:(f:any)=>writeFileSync(join(f.root,commitName(2)),pack("capsule",{...f.head,serial:2,schema:"future/v99"}),{mode:0o600})},
 {id:"resurfaced generation",expected:"capsule_unexpected_history",edit:(f:any)=>writeFileSync(join(f.root,"trusted-peers.owner.1.json"),"{}",{mode:0o600})},
 {id:"over budget",expected:"capsule_invalid",edit:(f:any)=>rewrite(f,h=>h.chargedBytes=128*1024*1024+1)},
 {id:"removed chunk",expected:"capsule_chunk_missing",edit:(f:any)=>unlinkSync(join(f.root,f.head.parts[0].name))},
 {id:"invalid receipt",expected:"capsule_receipt_invalid",edit:(f:any)=>writeFileSync(join(f.root,doneName(1)),pack("receipt",{}))},
 {id:"checksum envelope",expected:"capsule_checksum",edit:(f:any)=>writeFileSync(join(f.root,commitName(1)),"{}")},
];
for(const c of cases)test(`authority refusal equivalence: ${c.id}`,()=>{const f=fixture(),o=f.owner as any;
 expect(o.readAuthority().stamp).toBe(o.pairingAuthorityStamp());c.edit(f);
 const full=code(()=>o.read()),view=code(()=>o.readAuthority());expect(full).toBe(c.expected);expect(view).toBe(full);
 // Repeat on the same owner: no earlier healthy view can authorize a later read.
 expect(code(()=>o.readAuthority())).toBe(full);
});
test("authority refusal equivalence: removed permanent policy",()=>{
 const f=fixture({prepare(o){removers.push(o.register(adapter()));o.mutate(4,"managed",{type:"manage"});}}),o=f.owner as any;
 expect(o.readAuthority().revision).toBe(5);rewrite(f,h=>h.policy=null);unlinkSync(join(f.root,"trusted-peers.managed.json"));
 expect(code(()=>o.read())).toBe("managed_downgrade");expect(code(()=>o.readAuthority())).toBe("managed_downgrade");
});
test("authority view completes a real committed publication before serving peers and stamp",()=>{
 const f=fixture({migrate:true}),o=f.owner as any,complete=o.completeCapsule;
 // Real writer has already linked its durable serial when completion fails.
 o.completeCapsule=()=>{throw Error("interrupted after publication");};
 expect(()=>o.mutate(4,"pending-revoke",{type:"revoke",publicKey:f.keys[0]})).toThrow("interrupted after publication");
 expect(readdirSync(f.root)).toContain(commitName(2));expect(readFileSync(join(f.root,"trusted-peers.json"),"utf8")).toContain(f.keys[0]!);
 o.completeCapsule=complete;const v=o.readAuthority();
 expect(v.revision).toBe(5);expect(v.peers.some((p:any)=>p.publicKey===f.keys[0])).toBe(false);
 expect(readdirSync(f.root)).toContain(doneName(2));expect(readdirSync(f.root)).not.toContain(commitName(1));
 expect(v.stamp).toBe(o.pairingAuthorityStamp());
 expect(readFileSync(join(f.root,"trusted-peers.json"),"utf8")).not.toContain(f.keys[0]!);
 expect(o.mutate(4,"pending-revoke",{type:"revoke",publicKey:f.keys[0]}).revision).toBe(5);
});

for(const flavor of ["full","view"] as const)test(`shared row validator ${flavor} flavor rejects a checksum-consistent malformed row`,()=>{
 const f=fixture();rows(f,r=>r[0][4]="not-boolean");
 expect(code(()=>flavor==="full"?f.owner.read():f.owner.readAuthority())).toBe("capsule_outcome_invalid");
});
