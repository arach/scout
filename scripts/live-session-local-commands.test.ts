import {test,expect} from "bun:test";
import {mkdtempSync,mkdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
const cases:string[][]=[];
for(const flavor of ["web","desktop"])for(const target of ["stop","interrupt","steer","codex-interrupt"])for(const state of ["live","revoke"])cases.push(["router",target,state,flavor]);
for(const target of ["tmux","codex_app_server","claude_stream_json","pi_rpc","kimi_acp","interrupt","restart"])for(const state of ["live","revoke"])cases.push(["local",target,state]);
for(const target of ["steer","interrupt"])for(const state of ["live","revoke","accepted"])cases.push(["codex",target,state]);
for(const target of ["initialize","authenticate","session/new","session/resume","session/load","session/set_model","recovery/load","recovery/new"])for(const state of ["live","revoke"])for(const flavor of ["web","desktop"])cases.push(["acp",target,state,flavor]);
for(const flavor of ["web","desktop"])for(const protocol of ["trpc","legacy"])for(const state of ["live","revoke","accepted"])cases.push(["acp","prompt",state,flavor,protocol]);
for(const target of ["steer","interrupt"])for(const state of ["live","revoke"])cases.push(["deck",target,state]);
for(const state of ["live","revoke"])cases.push(["pool","close",state]);
cases.push(["residue","codex-invoke","revoke"]);
for(const target of ["stop","interrupt"])cases.push(["refusal",target,"live"]);
// Added after the failing baseline: pin the reach used by the narrowed limits.
for(const harness of ["grok","kimi","cursor","opencode","devin"])cases.push(["scope",harness,"live"]);
for(const args of cases)test(`local commands ${args.join("/")}`,async()=>{
 const root=mkdtempSync(join(tmpdir(),"pairing-capsule-local-command-")),home=join(root,"home"),store=join(root,"pairing-capsule-store");mkdirSync(home);mkdirSync(store);
 let requests=0;const sentinel=Bun.serve({hostname:"127.0.0.1",port:0,fetch(){requests++;return Response.json({fixture:true});}});
 const child=Bun.spawn([process.execPath,join(import.meta.dir,"live-session-local-commands-worker.ts"),...args],{env:{...process.env,HOME:home,OPENSCOUT_HOME:join(home,"scout"),OPENSCOUT_SUPPORT_DIRECTORY:join(home,"support"),OPENSCOUT_PAIRING_HOME:store,OPENSCOUT_BROKER_URL:sentinel.url.href,OPENSCOUT_BROKER_INTERNAL_URL:sentinel.url.href},stdout:"pipe",stderr:"pipe"});const timer=setTimeout(()=>child.kill(),35_000);
 try{const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);console.log(out);if(code!==0)console.error(err);expect(requests).toBe(0);expect(out).toContain('A2_RUNTIME_ISOLATION {"probes":2,"localRequests":2}');expect(code).toBe(0);expect(out).toContain("STAGE5_EFFECT");}
 finally{clearTimeout(timer);child.kill();await child.exited;await sentinel.stop(true);rmSync(root,{recursive:true,force:true});}
},40_000);
