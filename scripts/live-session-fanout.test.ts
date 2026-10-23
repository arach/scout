import {test,expect} from "bun:test";
import {mkdtempSync,mkdirSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
for(const flavor of ["web","desktop"])for(const kind of ["legacy","trpc","relay"]){
 test(`batch: real ${flavor}/${kind} endpoints`,async()=>{
  const root=mkdtempSync(join(tmpdir(),"pairing-capsule-endpoint-count-")),home=join(root,"home"),pairing=join(root,"pairing-capsule-store");mkdirSync(home,{mode:0o700});mkdirSync(pairing,{mode:0o700});
  const child=Bun.spawn([process.execPath,"scripts/live-session-fanout-worker.ts",flavor,kind],{env:{...process.env,HOME:home,OPENSCOUT_PAIRING_HOME:pairing},stdout:"pipe",stderr:"pipe"});
  const timer=setTimeout(()=>child.kill(),60_000);
  try{const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);console.log(out);if(code!==0)console.error(err);expect(code).toBe(0);expect(out).toContain('"eventReads":1');}
  finally{clearTimeout(timer);child.kill();await child.exited;rmSync(root,{recursive:true,force:true});}
 },65_000);
}
