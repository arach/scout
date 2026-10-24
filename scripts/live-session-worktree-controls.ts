/** Paired omission controls for every resumed workspace effect and each wire
 * forwarding edge. Subjects are isolated; command sinks never execute git. */
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,statfsSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {isBuiltin} from "node:module";
const root=process.cwd(),out=resolve(process.argv[2]!),protocol=process.argv[3]??"trpc";mkdirSync(out,{recursive:true});
function relocate(raw:string,path:string){
  return raw.replace(/(from\s*|import\s*)["']([^"']+)["']/g,(all,prefix,spec)=>{
    if(isBuiltin(spec)||spec.startsWith("bun:"))return all;
    return prefix+JSON.stringify(pathToFileURL(Bun.resolveSync(spec,dirname(resolve(path)))).href);
  });
}
const results=[];
for(const flavor of ["web","desktop"]){
  const base=flavor==="web"?"packages/web/server/core":"apps/desktop/src/core";
  for(const id of ["directory","new-branch","retry","router-forward","service-forward","wrapper-forward"]){
    const stage=id==="new-branch"?"directory":id==="retry"?"retry":"discovery";
    const path=id==="router-forward"?`${base}/pairing/runtime/bridge/${protocol==="legacy"?"server":"router"}.ts`:
      id==="service-forward"||id==="wrapper-forward"?`${base}/mobile/service.ts`:"packages/runtime/src/agent-workspace.ts";
    const source=readFileSync(path,"utf8");
    const anchors:Record<string,string>={
      directory:"  beforeEffect?.(); // workspace-directory admission, after repository discovery",
      "new-branch":"  beforeEffect?.(); // new-branch admission, after asynchronous directory creation",
      retry:"  beforeEffect?.(); // existing-branch retry admission, after the failed attempt",
      "router-forward":protocol==="legacy"?"createScoutSession(p, resolveMobileCurrentDirectory(), rpcContext.deviceId, () => { requireTransportContext(rpcContext); })":"        () => { requireTransportContext(ctx); },",
      "service-forward":"createGitWorktree(workspace.root, agentName, input.branch, beforeEffect)",
      "wrapper-forward":"createAgentWorkspace(projectRoot, agentName, requestedBranch, beforeEffect)",
    };
    const anchor=anchors[id]!;if(source.split(anchor).length!==2)throw Error(`unique ${id} anchor required`);
    const replacement=id==="router-forward"&&protocol==="legacy"?"createScoutSession(p, resolveMobileCurrentDirectory(), rpcContext.deviceId)":
      id==="service-forward"||id==="wrapper-forward"?anchor.replace(", beforeEffect",""):"// planted admission omission";
    const pair:any={flavor,protocol,id,stage,source:path,hashes:{}};
    for(const kind of ["healthy","bypass"]){
      const disk=statfsSync(process.platform==="darwin"?"/System/Volumes/Data":"/");if(disk.bavail*disk.bsize<3*1024**3)throw Error("3 GiB floor");
      const scratch=mkdtempSync(join(tmpdir(),"pairing-capsule-worktree-control-"));
      try{
        const home=join(scratch,"home"),store=join(scratch,"pairing-capsule-worktree-store");mkdirSync(home);mkdirSync(store);
        const raw=kind==="healthy"?source:source.replace(anchor,replacement);
        pair.hashes[kind]=createHash("sha256").update(raw).digest("hex");
        const subject=join(scratch,"subject.ts");writeFileSync(subject,relocate(raw,path));
        const positions=id==="router-forward"?(protocol==="legacy"?["","","",protocol,subject]:["","",subject,protocol]):
          id==="service-forward"||id==="wrapper-forward"?["",subject,"",protocol]:[subject,"","",protocol];
        const child=Bun.spawn([process.execPath,"scripts/live-session-worktree-worker.ts",flavor,stage,...positions],{env:{...process.env,HOME:home,OPENSCOUT_PAIRING_HOME:store},stdout:"pipe",stderr:"pipe"});
        const timer=setTimeout(()=>child.kill(),60_000);
        const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);clearTimeout(timer);
        const text=stdout+stderr;writeFileSync(join(out,`${flavor}-${id}-${kind}.log`),text);
        const observation=text.split("\n").find(line=>line.startsWith("WORKTREE_EFFECT "));
        if(!observation)throw Error(`no boundary evidence ${flavor}/${id}/${kind}`);
        const seen=JSON.parse(observation.slice("WORKTREE_EFFECT ".length));
        if(kind==="healthy"?code!==0:!(code!==0&&(seen.lateDirectories>0||seen.lateMutations>0)&&/no resumed (directory creation|git mutation) after revoke ACK/.test(text)&&!/Cannot find module|SyntaxError|worktree pause not reached/.test(text)))throw Error(`invalid evidence ${flavor}/${id}/${kind}`);
      }finally{rmSync(scratch,{recursive:true,force:true});}
    }
    pair.caught=true;results.push(pair);
  }
}
writeFileSync(join(out,"results.json"),JSON.stringify({bun:Bun.version,pairs:results},null,2));console.log(JSON.stringify(results));
