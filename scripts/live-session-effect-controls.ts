/** Shared effect-owner source control, isolated modules and actual handlers. */
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,statfsSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
const root=process.cwd(),out=resolve(process.argv[2]!);mkdirSync(out,{recursive:true});
const source=readFileSync("packages/agent-sessions/src/registry.ts","utf8");
if(source.split("    beforeEffect?.();").length!==2)throw Error("unique effect admission anchor required");
const results=[];
for(const flavor of ["web","desktop"])for(const scenario of ["legacy","trpc"]){
 const pair:any={flavor,scenario,kind:"omit-resumed-session-admission",subjects:{}};
 for(const kind of ["healthy","bypass"]){
  const disk=statfsSync(process.platform==="darwin"?"/System/Volumes/Data":"/");if(disk.bavail*disk.bsize<3*1024**3)throw Error("3 GiB floor");
  const scratch=mkdtempSync(join(tmpdir(),"pairing-capsule-effect-control-"));
  try {
   const home=join(scratch,"home"),pairing=join(scratch,"pairing-capsule-effect-store");mkdirSync(home,{mode:0o700});mkdirSync(pairing,{mode:0o700});
   let raw=kind==="healthy"?source:source.replace("    beforeEffect?.();","    // planted omission: no resumed admission");
   pair.subjects[kind]=createHash("sha256").update(raw).digest("hex");
   for(const name of ["buffer","state"])raw=raw.replace(`"./${name}.js"`,JSON.stringify(pathToFileURL(join(root,`packages/agent-sessions/src/${name}.ts`)).href));
   const subject=join(scratch,"registry.ts");writeFileSync(subject,raw);
   const child=Bun.spawn([process.execPath,"scripts/live-session-effect-worker.ts",flavor,scenario,subject],{env:{...process.env,HOME:home,OPENSCOUT_PAIRING_HOME:pairing},stdout:"pipe",stderr:"pipe"});
   const timer=setTimeout(()=>child.kill(),60_000);
   const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);clearTimeout(timer);
   const text=stdout+stderr;writeFileSync(join(out,`${flavor}-${scenario}-${kind}.log`),text);
   if(kind==="healthy"?code!==0:!(code!==0&&text.includes('"factories":1,"starts":1')&&text.includes("stale resumed creation must not construct adapter")&&!/Cannot find module|SyntaxError|fixture pause not reached/.test(text)))throw Error(`invalid control evidence ${flavor}/${scenario}/${kind}`);
  }finally{rmSync(scratch,{recursive:true,force:true});}
 }
 pair.caught=true;results.push(pair);
}
writeFileSync(join(out,"results.json"),JSON.stringify({bun:Bun.version,pairs:results},null,2));console.log(JSON.stringify(results));
