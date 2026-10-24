/** Exact healthy/broken endpoint witnesses for configuration submission and
 * every new callback forwarding edge. No agent or shared broker is started. */
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
 const base=flavor==="web"?"packages/web/server/core":"apps/desktop/src/core",setup="packages/runtime/src/setup.ts",local="packages/runtime/src/local-agents.ts";
 const defs:Def[]=[
  {id:"mobile-forward",key:"mobile",path:`${base}/mobile/service.ts`,stage:"discovery",anchor:"  }, beforeEffect); // mobile agent configuration admission forwarding",replacement:"  }); // planted mobile forwarding omission"},
  {id:"service-forward",key:"agents",path:"packages/runtime/src/control-plane-agents.ts",stage:"discovery",anchor:"await localAgents.startLocalAgent(input, beforeConfigEffect)",replacement:"await localAgents.startLocalAgent(input)"},
  {id:"cold-setup-forward",key:"local",path:local,stage:"discovery",anchor:"ensureProjectConfigForDirectory(projectPath, undefined, beforeConfigEffect)",replacement:"ensureProjectConfigForDirectory(projectPath)"},
  {id:"registry-wrapper-forward",key:"local",path:local,stage:"registry-directory",anchor:"writeRelayAgentOverridesToDisk(overrides, beforeEffect)",replacement:"writeRelayAgentOverridesToDisk(overrides)"},
  ...["registry-directory","fork","warm"].map((stage,nth)=>({id:`registry-branch-${nth}`,key:"local",path:local,stage,anchor:"await writeRelayAgentOverrides(overrides, beforeConfigEffect);",replacement:"await writeRelayAgentOverrides(overrides);",nth,count:3})),
  {id:"json-directory",key:"setup",path:setup,stage:"discovery",anchor:"  admitSynchronousEffect(beforeEffect); // config-directory submission, after serialization",replacement:"  // planted directory admission omission"},
  {id:"json-file",key:"setup",path:setup,stage:"directory",anchor:"  admitSynchronousEffect(beforeEffect); // config-file submission, after directory creation",replacement:"  // planted file admission omission"},
  {id:"ignore-write",key:"setup",path:setup,stage:"ignore",anchor:"  admitSynchronousEffect(beforeEffect); // ignore-file submission, after asynchronous read",replacement:"  // planted ignore admission omission"},
  {id:"legacy-remove",key:"setup",path:setup,stage:"cleanup",anchor:"  admitSynchronousEffect(beforeEffect); // legacy-link removal, after project setup",replacement:"  // planted removal admission omission"},
  {id:"relay-json-forward",key:"setup",path:setup,stage:"registry-directory",anchor:"  }, beforeEffect); // relay configuration writer forwarding",replacement:"  }); // planted relay writer forwarding omission"},
  {id:"project-json-forward",key:"setup",path:setup,stage:"discovery",anchor:"writeJsonFile(projectConfigPath(projectRoot), config, beforeEffect)",replacement:"writeJsonFile(projectConfigPath(projectRoot), config)"},
  ...["ignore","existing"].map((stage,nth)=>({id:`ignore-forward-${nth}`,key:"setup",path:setup,stage,anchor:"await ensureProjectConfigIgnored(projectRoot, beforeEffect);",replacement:"await ensureProjectConfigIgnored(projectRoot);",nth,count:2})),
  ...["existing-update","discovery"].map((stage,nth)=>({id:`project-forward-${nth}`,key:"setup",path:setup,stage,anchor:"await writeProjectConfig(projectRoot, synced.config, beforeEffect);",replacement:"await writeProjectConfig(projectRoot, synced.config);",nth,count:2})),
  {id:"remove-forward",key:"setup",path:setup,stage:"cleanup",anchor:"removeLegacyRelayLink(projectRoot, beforeEffect)",replacement:"removeLegacyRelayLink(projectRoot)"},
  {id:"positive-survives-await",key:"admission",path:"packages/runtime/src/effect-admission.ts",stage:"directory",anchor:"  const result: unknown = beforeEffect?.();",replacement:"  if (beforeEffect && accepted.has(beforeEffect)) return;\n  const result: unknown = beforeEffect?.();\n  if (beforeEffect) accepted.add(beforeEffect);"},
 ];
 for(const def of defs){
  const source=readFileSync(def.path,"utf8"),pair:any={flavor,protocol,id:def.id,stage:def.stage,source:def.path,hashes:{},exits:{},observations:{}};
  for(const kind of ["healthy","bypass"]){
   const disk=statfsSync(process.platform==="darwin"?"/System/Volumes/Data":"/");if(disk.bavail*disk.bsize<3*1024**3)throw Error("3 GiB floor");
   const scratch=mkdtempSync(join(tmpdir(),"pairing-capsule-agent-config-control-"));let child:ReturnType<typeof Bun.spawn>|undefined,timer:ReturnType<typeof setTimeout>|undefined;
   try{
    const home=join(scratch,"home"),store=join(scratch,"pairing-capsule-store");mkdirSync(home);mkdirSync(store);
    let raw=kind==="healthy"?source:omit(source,def.anchor,def.replacement,def.nth,def.count);
    if(kind==="bypass"&&def.key==="admission")raw="const accepted = new WeakSet<() => void>();\n"+raw;
    pair.hashes[kind]=createHash("sha256").update(raw).digest("hex");
    const subject=join(scratch,"subject.ts"),config=join(scratch,"config.json");writeFileSync(subject,relocate(raw,def.path));writeFileSync(config,JSON.stringify({[def.key]:subject}));
    child=Bun.spawn([process.execPath,"scripts/live-session-agent-config-worker.ts",flavor,protocol,def.stage,config],{env:{...process.env,HOME:home,OPENSCOUT_HOME:join(home,"scout"),OPENSCOUT_SUPPORT_DIRECTORY:join(home,"support"),OPENSCOUT_PAIRING_HOME:store,OPENSCOUT_NODE_QUALIFIER:"fixture"},stdout:"pipe",stderr:"pipe"});
    timer=setTimeout(()=>child?.kill(),60_000);
    const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);const text=stdout+stderr;pair.exits[kind]=code;writeFileSync(join(out,`${flavor}-${def.id}-${kind}.log`),text);
    const row=text.split("\n").find(l=>l.startsWith("AGENT_CONFIG_EFFECT "));if(!row)throw Error(`no boundary evidence ${flavor}/${def.id}/${kind}`);
    const seen=JSON.parse(row.slice("AGENT_CONFIG_EFFECT ".length));pair.observations[kind]=seen;
    if(kind==="healthy"?code!==0:!(code!==0&&seen.lateMutations>0&&assertionControlFailed(text,'assert.equal(lateMutations,0,"no resumed agent configuration mutation after revoke ACK");',"no resumed agent configuration mutation after revoke ACK")&&!/Cannot find module|SyntaxError|pause not reached/.test(text)))throw Error(`invalid evidence ${flavor}/${def.id}/${kind}`);
   }finally{if(timer)clearTimeout(timer);child?.kill();if(child)await child.exited;rmSync(scratch,{recursive:true,force:true});}
  }
  pair.caught=true;results.push(pair);
 }
}
writeFileSync(join(out,"results.json"),JSON.stringify({bun:Bun.version,pairs:results},null,2));console.log(JSON.stringify({bun:Bun.version,pairs:results.length,allCaught:results.every(p=>p.caught)}));
