import {test,expect} from "bun:test";
import {mkdtempSync,mkdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
for(const protocol of ["legacy","trpc"])for(const stage of ["discovery","fallback","happy"]){
  test(`read-cursor effect ${protocol}/${stage}`,async()=>{
    const root=mkdtempSync(join(tmpdir(),"pairing-capsule-read-cursor-")),home=join(root,"home"),store=join(root,"pairing-capsule-read-store");mkdirSync(home);mkdirSync(store);
    const child=Bun.spawn([process.execPath,"scripts/live-session-read-cursor-worker.ts",protocol,stage],{env:{...process.env,HOME:home,OPENSCOUT_PAIRING_HOME:store,OPENSCOUT_BROKER_SOCKET_ONLY:"0"},stdout:"pipe",stderr:"pipe"});
    const timer=setTimeout(()=>child.kill(),60_000);
    try{const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);console.log(out);if(code!==0)console.error(err);expect(code).toBe(0);expect(out).toContain("READ_CURSOR_EFFECT ");}
    finally{clearTimeout(timer);child.kill();await child.exited;rmSync(root,{recursive:true,force:true});}
  },65_000);
}
