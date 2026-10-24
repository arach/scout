import {test,expect} from "bun:test";
import {mkdtempSync,mkdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
const cases:string[][]=[];
for(const flavor of ["web","desktop"]){
 for(const protocol of ["trpc","legacy"])for(const stage of ["startup","binding","binding-next","peer","seed","accepted"])for(const state of ["live","revoke"])cases.push([flavor,protocol,stage,state]);
 for(const stage of ["controller","controller-infer"])for(const state of ["live","revoke"])cases.push([flavor,"trpc",stage,state]);
 cases.push([flavor,"trpc","residue","revoke"]);
}
for(const args of cases)test(`mobile post ${args.join("/")}`,async()=>{
 const root=mkdtempSync(join(tmpdir(),"pairing-capsule-mobile-post-")),home=join(root,"home"),store=join(root,"pairing-capsule-store");mkdirSync(home);mkdirSync(store);
 let requests=0;const sentinel=Bun.serve({hostname:"127.0.0.1",port:0,fetch(){requests++;return Response.json({fixture:true});}});
 const child=Bun.spawn([process.execPath,join(import.meta.dir,"live-session-mobile-post-worker.ts"),...args],{env:{...process.env,OPENSCOUT_BROKER_URL:sentinel.url.href,OPENSCOUT_BROKER_INTERNAL_URL:sentinel.url.href,HOME:home,OPENSCOUT_HOME:join(home,"scout"),OPENSCOUT_SUPPORT_DIRECTORY:join(home,"support"),OPENSCOUT_PAIRING_HOME:store,OPENSCOUT_NODE_QUALIFIER:"fixture",OPENSCOUT_PROBES_SOCKET:join(home,"absent.sock")},stdout:"pipe",stderr:"pipe"});const timer=setTimeout(()=>child.kill(),45_000);
 try{const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);console.log(out);if(code!==0)console.error(err);expect(requests).toBe(0);expect(out).toContain('A2_RUNTIME_ISOLATION {"probes":2,"localRequests":2}');expect(code).toBe(0);expect(out).toContain("MOBILE_POST_READY real-noise");expect(out).toContain("MOBILE_POST_EFFECT");}
 finally{clearTimeout(timer);child.kill();await child.exited;await sentinel.stop(true);rmSync(root,{recursive:true,force:true});}
},50_000);
