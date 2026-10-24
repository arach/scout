/** Trusted-joiner retry and refusal-provenance controls.
 * Each subject changes only the named shared-flight branch. */
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,statfsSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {isBuiltin} from "node:module";
import ts from "typescript";
import {assertionControlFailed} from "./fixtures/source-control-evidence.ts";
const out=resolve(process.argv[2]!),protocol=process.argv[3]??"trpc";mkdirSync(out,{recursive:true});
function relocate(raw:string,path:string){
 const file=ts.createSourceFile(path,raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),edits:{start:number;end:number;value:string}[]=[];
 const add=(literal:ts.StringLiteralLike)=>{
  const spec=literal.text;if(isBuiltin(spec)||spec.startsWith("bun:"))return;
  edits.push({start:literal.getStart(file),end:literal.getEnd(),value:JSON.stringify(pathToFileURL(Bun.resolveSync(spec,dirname(resolve(path)))).href)});
 };
 const visit=(node:ts.Node)=>{
  if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteralLike(node.moduleSpecifier))add(node.moduleSpecifier);
  if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments[0]&&ts.isStringLiteralLike(node.arguments[0]))add(node.arguments[0]);
  ts.forEachChild(node,visit);
 };
 visit(file);for(const edit of edits.sort((a,b)=>b.start-a.start))raw=raw.slice(0,edit.start)+edit.value+raw.slice(edit.end);return raw;
}
function omit(raw:string,anchor:string,replacement:string,nth=0,count=1){const parts=raw.split(anchor);if(parts.length!==count+1)throw Error(`expected ${count} anchors: ${anchor}`);let pos=-anchor.length;for(let i=0;i<=nth;i++)pos=raw.indexOf(anchor,pos+anchor.length);return raw.slice(0,pos)+replacement+raw.slice(pos+anchor.length);}
type Def={id:string;key:string;path:string;stage:string;anchor:string;replacement:string;nth?:number;count?:number};
const results=[];
for(const flavor of ["web","desktop"]){
 const local="packages/runtime/src/local-agents.ts";
 const defs:Def[]=[
  {id:"no-trusted-retry",key:"local",path:local,stage:"revoke-two",anchor:"return await ensureLocalAgentOnline(agentName, normalizedRecord); // trusted caller retries a foreign refusal",replacement:"throw error; // planted trusted retry omission"},
  {id:"retry-ordinary-error",key:"local",path:local,stage:"ordinary-error",anchor:"if (beforeWarmupEffect || !refusal?.refused || !Object.is(refusal.error, error)) {",replacement:"if (beforeWarmupEffect) {"},
 ];
 for(const def of defs){
  const source=readFileSync(def.path,"utf8"),pair:any={flavor,protocol,id:def.id,stage:def.stage,source:def.path,hashes:{},exits:{},observations:{}};
  for(const kind of ["healthy","bypass"]){
   const disk=statfsSync(process.platform==="darwin"?"/System/Volumes/Data":"/");if(disk.bavail*disk.bsize<3*1024**3)throw Error("3 GiB floor");
   const scratch=mkdtempSync(join(tmpdir(),"pairing-capsule-joined-warmup-control-"));let child:ReturnType<typeof Bun.spawn>|undefined,timer:ReturnType<typeof setTimeout>|undefined;
   try{
    const home=join(scratch,"home"),store=join(scratch,"pairing-capsule-store");mkdirSync(home);mkdirSync(store);
    const raw=kind==="healthy"?source:omit(source,def.anchor,def.replacement,def.nth,def.count);
    pair.hashes[kind]=createHash("sha256").update(raw).digest("hex");
    const subject=join(scratch,"subject.ts"),config=join(scratch,"config.json");writeFileSync(subject,relocate(raw,def.path));writeFileSync(config,JSON.stringify({[def.key]:subject}));
    child=Bun.spawn([process.execPath,"scripts/live-session-joined-warmup-worker.ts",flavor,protocol,def.stage,config],{env:{...process.env,HOME:home,OPENSCOUT_HOME:join(home,"scout"),OPENSCOUT_SUPPORT_DIRECTORY:join(home,"support"),OPENSCOUT_PAIRING_HOME:store,OPENSCOUT_NODE_QUALIFIER:"fixture"},stdout:"pipe",stderr:"pipe"});
    timer=setTimeout(()=>child?.kill(),60_000);
    const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);const text=stdout+stderr;pair.exits[kind]=code;writeFileSync(join(out,`${flavor}-${def.id}-${kind}.log`),text);
    const row=text.split("\n").find(l=>l.startsWith("JOINED_WARMUP_EFFECT "));if(!row)throw Error(`no boundary evidence ${flavor}/${def.id}/${kind}`);
    const seen=JSON.parse(row.slice("JOINED_WARMUP_EFFECT ".length));pair.observations[kind]=seen;
    const ordinary=def.id==="retry-ordinary-error";
    const oracle=ordinary?'assert.equal(trustedPublications,0,"ordinary warmup failures must not be retried as admission refusals");':`assert.equal(trustedPublications,1,"trusted joiners must coalesce their own warmup after another caller's admission refusal");`;
    const message=ordinary?"ordinary warmup failures must not be retried as admission refusals":"trusted joiners must coalesce their own warmup after another caller's admission refusal";
    if(kind==="healthy"?code!==0:!(code!==0&&(ordinary?seen.trustedPublications===1:seen.trustedPublications===0)&&seen.protectedLateMutations===0&&assertionControlFailed(text,oracle,message)&&!/Cannot find module|SyntaxError|pause not reached/.test(text)))throw Error(`invalid evidence ${flavor}/${def.id}/${kind}`);
   }finally{if(timer)clearTimeout(timer);child?.kill();if(child)await child.exited;rmSync(scratch,{recursive:true,force:true});}
  }
  pair.caught=true;results.push(pair);
 }
}
writeFileSync(join(out,"results.json"),JSON.stringify({bun:Bun.version,pairs:results},null,2));console.log(JSON.stringify({bun:Bun.version,pairs:results.length,allCaught:results.every(p=>p.caught)}));
