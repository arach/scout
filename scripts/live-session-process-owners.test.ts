import {test,expect} from "bun:test";
import {mkdtempSync,mkdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
const cases:string[][]=[];
for(const flavor of ["web","desktop"])for(const target of ["restart","connect","start"])for(const state of ["live","revoke"])cases.push(["router",target,state,flavor]);
for(const target of ["codex","claude","pi"])for(const state of ["live","revoke"])cases.push(["engine",target,state]);
cases.push(["engine","codex","trusted-join"]);
for(const target of ["turn-start","accepted"])for(const state of ["live","revoke"])cases.push(["codex-turn",target,state]);
for(const args of cases)test(`process owner ${args.join("/")}`,async()=>{
 const root=mkdtempSync(join(tmpdir(),"pairing-capsule-process-owner-")),home=join(root,"home"),store=join(root,"pairing-capsule-store");mkdirSync(home);mkdirSync(store);
 let sentinelRequests=0;const sentinel=Bun.serve({hostname:"127.0.0.1",port:0,fetch(){sentinelRequests++;return Response.json({fixture:true});}});
 const child=Bun.spawn([process.execPath,join(import.meta.dir,"live-session-process-owners-worker.ts"),...args],{env:{...process.env,OPENSCOUT_BROKER_URL:sentinel.url.href,OPENSCOUT_BROKER_INTERNAL_URL:sentinel.url.href,HOME:home,OPENSCOUT_HOME:join(home,"scout"),OPENSCOUT_SUPPORT_DIRECTORY:join(home,"support"),OPENSCOUT_PAIRING_HOME:store,OPENSCOUT_NODE_QUALIFIER:"fixture"},stdout:"pipe",stderr:"pipe"});const timer=setTimeout(()=>child.kill(),60_000);
 try{const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);console.log(out);if(code!==0)console.error(err);console.log("A2_RUNTIME_SENTINEL "+JSON.stringify({requests:sentinelRequests}));expect(sentinelRequests).toBe(0);expect(out).toContain('A2_RUNTIME_ISOLATION {"probes":2,"localRequests":2}');expect(code).toBe(0);expect(out).toContain("A2_OWNER_EFFECT");}
 finally{clearTimeout(timer);child.kill();await child.exited;await sentinel.stop(true);rmSync(root,{recursive:true,force:true});}
},65_000);
