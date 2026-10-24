import {test,expect} from "bun:test";
import {mkdtempSync,mkdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
for(const flavor of ["web","desktop"])for(const protocol of ["trpc","legacy"])for(const harness of ["grok-acp","kimi","devin"])for(const stage of ["discovery","publication","directory","happy"]){
 test(`resumed lazy ACP warmup ${flavor}/${protocol}/${harness}/${stage}`,async()=>{
  const root=mkdtempSync(join(tmpdir(),"pairing-capsule-acp-warmup-")),home=join(root,"home"),store=join(root,"pairing-capsule-store");mkdirSync(home);mkdirSync(store);
  const child=Bun.spawn([process.execPath,"scripts/live-session-acp-warmup-worker.ts",flavor,protocol,harness,stage],{env:{...process.env,HOME:home,OPENSCOUT_HOME:join(home,"scout"),OPENSCOUT_SUPPORT_DIRECTORY:join(home,"support"),OPENSCOUT_PAIRING_HOME:store,OPENSCOUT_NODE_QUALIFIER:"fixture"},stdout:"pipe",stderr:"pipe"});
  const timer=setTimeout(()=>child.kill(),60_000);
  try{const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);console.log(out);if(code!==0)console.error(err);expect(code).toBe(0);expect(out).toContain('"lateMutations":0');}
  finally{clearTimeout(timer);child.kill();await child.exited;rmSync(root,{recursive:true,force:true});}
 },65_000);
}
