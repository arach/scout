/** Fresh-process production-owner read gate on real migrated test stores. */
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir,cpus,release,platform} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {capsuleFixture} from "./fixtures/pairing-capsule.ts";

const tier=process.argv[2];
if(tier!=="realistic" && tier!=="large")throw Error("expected realistic or large");
const generations=tier==="large"?10000:100,keys=tier==="large"?32:4;
const limits=tier==="large"?[25,75,200]:[5,15,50];
const root=mkdtempSync(join(tmpdir(),"pairing-capsule-benchmark-"));
const result:any={schema:1,tier,generations,keys,limits,warmups:100,iterations:1000,
  runtime:Bun.version,runtimeRevision:Bun.revision,executableSha256:createHash("sha256").update(readFileSync(process.execPath)).digest("hex"),
  os:{platform:platform(),release:release(),arch:process.arch,cpu:cpus()[0]?.model},
  sources:Object.fromEntries(["trust-owner.ts","trust-capsule.ts","trust-cutover.ts"].map(n=>[n,createHash("sha256").update(readFileSync(new URL(`../packages/runtime/src/pairing-security/${n}`,import.meta.url))).digest("hex")])),paths:[]};
try{
  const f=capsuleFixture(root,{generations,keys,migrate:true});result.legacyBytes=f.legacyBytes;result.realMigration=f.barrier.migration;
  for(const path of ["read","stamp"]){
    let actual:unknown;
    const run=()=>{actual=path==="read"?f.owner.read():f.owner.pairingAuthorityStamp();};
    const first=performance.now();run();const firstMs=performance.now()-first;
    const warmupSamples:number[]=[];
    for(let i=0;i<100;i++){const start=performance.now();run();warmupSamples.push(performance.now()-start);}
    const samples:number[]=[];const cpu=process.cpuUsage();
    for(let i=0;i<1000;i++){
      const start=performance.now();run();const ms=performance.now()-start;samples.push(ms);
      if(ms>limits[2]!){result.paths.push({path,firstMs,warmupSamples,samples,failed:"maximum",cpu:process.cpuUsage(cpu)});throw Error(`${path}: maximum ${ms} > ${limits[2]}`);}
    }
    const sorted=samples.toSorted((a,b)=>a-b),p50=sorted[499]!,p95=sorted[949]!,max=sorted.at(-1)!;
    const passed=p50<=limits[0]! && p95<=limits[1]! && max<=limits[2]!;
    result.paths.push({path,firstMs,warmupSamples,p50,p95,max,samples,passed,cpu:process.cpuUsage(cpu)});
    if(!passed)throw Error(`${path}: percentile gate failed`);
    if(path==="read" && (actual as any).revision!==generations)throw Error("wrong revision");
    if(path==="stamp" && actual!==f.stamp)throw Error("wrong logical stamp");
  }
  result.passed=true;
}catch(e){result.passed=false;result.error=String(e);process.exitCode=1;}
finally{rmSync(root,{recursive:true,force:true});console.log(JSON.stringify(result));}
