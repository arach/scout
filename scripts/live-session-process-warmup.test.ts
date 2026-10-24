import {test,expect} from "bun:test";
import {mkdtempSync,mkdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
const report=import.meta.dir;
for(const flavor of ["web","desktop"])for(const protocol of ["trpc","legacy"])for(const stage of ["warmup-directory","happy","broker-residue","command-residue"]){
 test(`process warmup ${flavor}/${protocol}/${stage}`,async()=>{
 const root=mkdtempSync(join(tmpdir(),"pairing-capsule-a2-baseline-")),home=join(root,"home"),store=join(root,"pairing-capsule-store");mkdirSync(home);mkdirSync(store);
 let sentinelRequests=0;const sentinel=Bun.serve({hostname:"127.0.0.1",port:0,fetch(){sentinelRequests++;return Response.json({fixture:true});}});
 const child=Bun.spawn([process.execPath,join(report,"live-session-process-warmup-worker.ts"),flavor,protocol,"claude",stage],{env:{...process.env,OPENSCOUT_BROKER_URL:sentinel.url.href,OPENSCOUT_BROKER_INTERNAL_URL:sentinel.url.href,HOME:home,OPENSCOUT_HOME:join(home,"scout"),OPENSCOUT_SUPPORT_DIRECTORY:join(home,"support"),OPENSCOUT_PAIRING_HOME:store,OPENSCOUT_NODE_QUALIFIER:"fixture"},stdout:"pipe",stderr:"pipe"});const timer=setTimeout(()=>child.kill(),60_000);
 try{const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);console.log(out);if(code!==0)console.error(err);console.log("A2_RUNTIME_SENTINEL "+JSON.stringify({requests:sentinelRequests}));expect(sentinelRequests).toBe(0);expect(out).toContain('A2_RUNTIME_ISOLATION {"probes":2,"localRequests":2}');expect(code).toBe(0);expect(out).toContain("A2_WARMUP_BASELINE");}
 finally{clearTimeout(timer);child.kill();await child.exited;await sentinel.stop(true);rmSync(root,{recursive:true,force:true});}
 },65_000);
}
