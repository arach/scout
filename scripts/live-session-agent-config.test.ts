import {test,expect} from "bun:test";
import {mkdtempSync,mkdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
for(const flavor of ["web","desktop"])for(const protocol of ["trpc","legacy"])for(const stage of ["discovery","directory","ignore","cleanup","registry-directory","existing","existing-update","fork","warm","happy"]){
 test(`resumed agent configuration ${flavor}/${protocol}/${stage}`,async()=>{
  const root=mkdtempSync(join(tmpdir(),"pairing-capsule-agent-config-")),home=join(root,"home"),store=join(root,"pairing-capsule-agent-config-store");mkdirSync(home);mkdirSync(store);
  const child=Bun.spawn([process.execPath,"scripts/live-session-agent-config-worker.ts",flavor,protocol,stage],{env:{...process.env,HOME:home,OPENSCOUT_HOME:join(home,"scout"),OPENSCOUT_SUPPORT_DIRECTORY:join(home,"support"),OPENSCOUT_PAIRING_HOME:store,OPENSCOUT_NODE_QUALIFIER:"fixture"},stdout:"pipe",stderr:"pipe"});
  const timer=setTimeout(()=>child.kill(),60_000);
  try{const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);console.log(out);if(code!==0)console.error(err);expect(code).toBe(0);expect(out).toContain('"lateMutations":0');}
  finally{clearTimeout(timer);child.kill();await child.exited;rmSync(root,{recursive:true,force:true});}
 },65_000);
}
