/** Paired omission controls for lazy ACP warmup and refusal propagation.
 * Subjects retain real handler, agent and setup owners; only one edge changes. */
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
const historical=process.argv[4];
const results=[];
for(const flavor of ["web","desktop"]){
 const local="packages/runtime/src/local-agents.ts";
 const defs:Def[]=historical?[{id:"baseline-0532153c",key:"local",path:local,stage:"publication",anchor:"",replacement:""}]:[
  {id:"startup-forward",key:"local",path:local,stage:"publication",anchor:"      beforeWarmupEffect: beforeConfigEffect, // startup warmup forwarding",replacement:"      // planted startup warmup omission"},
  {id:"binding-forward",key:"local",path:local,stage:"publication",anchor:"    beforeWarmupEffect: options.beforeWarmupEffect, // binding warmup forwarding",replacement:"    // planted binding warmup omission"},
  {id:"registered-forward",key:"local",path:local,stage:"publication",anchor:"ensureLocalAgentOnline(agentId, harnessRecord, options.beforeWarmupEffect)",replacement:"ensureLocalAgentOnline(agentId, harnessRecord)"},
  {id:"flight-forward",key:"local",path:local,stage:"publication",anchor:"ensureLocalAgentOnlineOnce(agentName, normalizedRecord, beforeFlightEffect)",replacement:"ensureLocalAgentOnlineOnce(agentName, normalizedRecord)"},
  {id:"lazy-publication-forward",key:"local",path:local,stage:"publication",anchor:"writeLocalAgentRegistry(registry, beforeWarmupEffect)",replacement:"writeLocalAgentRegistry(registry)"},
  {id:"registry-forward",key:"local",path:local,stage:"publication",anchor:"writeRelayAgentOverrides(nextOverrides, beforeEffect)",replacement:"writeRelayAgentOverrides(nextOverrides)"},
  {id:"refusal-swallowed",key:"local",path:local,stage:"directory",anchor:"        if (options.beforeWarmupEffect) throw error;",replacement:"        // planted swallowed authority refusal"},
 ];
 for(const def of defs){
  const source=readFileSync(def.path,"utf8"),pair:any={flavor,protocol,id:def.id,stage:def.stage,source:def.path,hashes:{},exits:{},observations:{}};
  for(const kind of ["healthy","bypass"]){
   const disk=statfsSync(process.platform==="darwin"?"/System/Volumes/Data":"/");if(disk.bavail*disk.bsize<3*1024**3)throw Error("3 GiB floor");
   const scratch=mkdtempSync(join(tmpdir(),"pairing-capsule-acp-warmup-control-"));let child:ReturnType<typeof Bun.spawn>|undefined,timer:ReturnType<typeof setTimeout>|undefined;
   try{
    const home=join(scratch,"home"),store=join(scratch,"pairing-capsule-store");mkdirSync(home);mkdirSync(store);
    const raw=kind==="healthy"?source:historical?readFileSync(historical,"utf8"):omit(source,def.anchor,def.replacement,def.nth,def.count);
    pair.hashes[kind]=createHash("sha256").update(raw).digest("hex");
    const subject=join(scratch,"subject.ts"),config=join(scratch,"config.json");writeFileSync(subject,relocate(raw,def.path));writeFileSync(config,JSON.stringify({[def.key]:subject}));
    child=Bun.spawn([process.execPath,"scripts/live-session-acp-warmup-worker.ts",flavor,protocol,"grok-acp",def.stage,config],{env:{...process.env,HOME:home,OPENSCOUT_HOME:join(home,"scout"),OPENSCOUT_SUPPORT_DIRECTORY:join(home,"support"),OPENSCOUT_PAIRING_HOME:store,OPENSCOUT_NODE_QUALIFIER:"fixture"},stdout:"pipe",stderr:"pipe"});
    timer=setTimeout(()=>child?.kill(),60_000);
    const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);const text=stdout+stderr;pair.exits[kind]=code;writeFileSync(join(out,`${flavor}-${def.id}-${kind}.log`),text);
    const row=text.split("\n").find(l=>l.startsWith("ACP_WARMUP_EFFECT "));if(!row)throw Error(`no boundary evidence ${flavor}/${def.id}/${kind}`);
    const seen=JSON.parse(row.slice("ACP_WARMUP_EFFECT ".length));pair.observations[kind]=seen;
    const swallowed=def.id==="refusal-swallowed";
    const oracle=swallowed?'assert.equal(bindings,0,"lazy ACP refusal must not become a successful binding");':'assert.equal(lateMutations,0,"no resumed lazy ACP registry mutation after revoke ACK");';
    const message=swallowed?"lazy ACP refusal must not become a successful binding":"no resumed lazy ACP registry mutation after revoke ACK";
    if(kind==="healthy"?code!==0:!(code!==0&&(swallowed?seen.bindings>0:seen.lateMutations>0)&&assertionControlFailed(text,oracle,message)&&!/Cannot find module|SyntaxError|pause not reached/.test(text)))throw Error(`invalid evidence ${flavor}/${def.id}/${kind}`);
   }finally{if(timer)clearTimeout(timer);child?.kill();if(child)await child.exited;rmSync(scratch,{recursive:true,force:true});}
  }
  pair.caught=true;results.push(pair);
 }
}
writeFileSync(join(out,"results.json"),JSON.stringify({bun:Bun.version,pairs:results},null,2));console.log(JSON.stringify({bun:Bun.version,pairs:results.length,allCaught:results.every(p=>p.caught)}));
