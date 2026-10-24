import {expect,test} from "bun:test";
import {mkdtempSync,mkdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
for(const flavor of ["web","desktop"])for(const scenario of ["forge","parser","legacy","trpc"]){
 test(`T-RPC-ORDER exported ${flavor}/${scenario}`,async()=>{
  const root=mkdtempSync(join(tmpdir(),"pairing-capsule-effect-")),home=join(root,"home"),pairing=join(root,"pairing-capsule-effect-store");
  mkdirSync(home,{mode:0o700});mkdirSync(pairing,{mode:0o700});
  const child=Bun.spawn([process.execPath,"scripts/live-session-effect-worker.ts",flavor,scenario],{
   env:{...process.env,HOME:home,OPENSCOUT_PAIRING_HOME:pairing},stdout:"pipe",stderr:"pipe"});
  const timer=setTimeout(()=>child.kill(),60_000);
  try{const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
   console.log(out);if(code!==0)console.error(err);expect(code).toBe(0);expect(out).toContain('"refused":true');
  }finally{clearTimeout(timer);child.kill();await child.exited;rmSync(root,{recursive:true,force:true});}
 },65_000);
}
