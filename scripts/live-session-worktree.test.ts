import {test,expect} from "bun:test";
import {mkdtempSync,mkdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
for(const flavor of ["web","desktop"])for(const stage of ["discovery","directory","retry"])for(const protocol of ["trpc","legacy"]){
  test(`resumed worktree effect ${flavor}/${stage}/${protocol}`,async()=>{
    const root=mkdtempSync(join(tmpdir(),"pairing-capsule-worktree-")),home=join(root,"home"),store=join(root,"pairing-capsule-worktree-store");
    mkdirSync(home);mkdirSync(store);
    const child=Bun.spawn([process.execPath,"scripts/live-session-worktree-worker.ts",flavor,stage,"","","",protocol],{env:{...process.env,HOME:home,OPENSCOUT_PAIRING_HOME:store},stdout:"pipe",stderr:"pipe"});
    const timer=setTimeout(()=>child.kill(),60_000);
    try{
      const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
      console.log(out);if(code!==0)console.error(err);expect(code).toBe(0);expect(out).toContain('"lateMutations":0,"lateDirectories":0');
    }finally{clearTimeout(timer);child.kill();await child.exited;rmSync(root,{recursive:true,force:true});}
  },65_000);
}
