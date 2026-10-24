/** Real mobile resolver -> agent service -> startLocalAgent -> setup writers.
 * Only asynchronous FS submission observation and broker sinks are injected.
 * Pi's configuration-only warmup path starts no harness, terminal or broker. */
import {mock} from "bun:test";
import assert from "node:assert/strict";
import {mkdirSync,realpathSync,readFileSync,writeFileSync} from "node:fs";
import * as fs from "node:fs/promises";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {capsuleFixture} from "./fixtures/pairing-capsule.ts";
import {fixtureHost,liveTransport,generateKeyPair} from "./fixtures/live-transport.ts";
import {bytesToHex} from "../packages/runtime/src/pairing-security/identity.ts";
import {TransportDomain} from "../packages/runtime/src/pairing-security/transport.ts";
const [flavor,protocol,stage,configPath]=process.argv.slice(2);
assert(["web","desktop"].includes(flavor!));assert(["legacy","trpc"].includes(protocol!));
assert(["discovery","directory","ignore","cleanup","registry-directory","existing","existing-update","fork","warm","happy"].includes(stage!));
const config=configPath?JSON.parse(readFileSync(configPath,"utf8")):{};
const base=resolve(flavor==="web"?"packages/web/server/core":"apps/desktop/src/core"),home=process.env.HOME!;
const project=join(home,"agent-project"),support=process.env.OPENSCOUT_SUPPORT_DIRECTORY!;mkdirSync(project);
if(stage==="existing"||stage==="existing-update"){
 mkdirSync(join(project,".openscout"));writeFileSync(join(project,".openscout/project.json"),JSON.stringify({version:1,project:{name:""},agent:{id:"agent-project"}}));
 if(stage==="existing-update"){
  mkdirSync(join(project,".codex/environments"),{recursive:true});writeFileSync(join(project,".codex/environments/environment.toml"),'name = "config witness"\n');
 }
}
if(stage==="fork"||stage==="warm"){
 mkdirSync(support,{recursive:true});const id=stage==="warm"?"agent-project":"seed";
 writeFileSync(join(support,"relay-agents.json"),JSON.stringify({version:1,agents:{seed:{agentId:"seed",definitionId:id,projectRoot:project,source:"manual",startedAt:1,defaultHarness:"pi",runtime:{harness:"pi",transport:"pi_rpc",cwd:project,sessionId:"fixture-pi"}}}}));
}
const pausePoint=stage==="existing"?"ignore":stage==="existing-update"?"directory":stage==="fork"||stage==="warm"?"registry-directory":stage;
let entered=false,revoked=false,release:()=>void=()=>{},mutations=0,lateMutations=0,bindings=0,launches=0;
const seen:string[]=[],pause=new Promise<void>(r=>{release=r;});
async function stopAt(point:string){if(pausePoint===point&&!entered){entered=true;await pause;}}
function mutation(kind:string,path:unknown){const p=String(path);assert(p.startsWith(home+"/"),"configuration must remain inside isolated HOME");mutations++;if(revoked)lateMutations++;seen.push(kind+":"+p.slice(home.length));}
const read=fs.readFile,mkdir=fs.mkdir,write=fs.writeFile,rm=fs.rm;
mock.module("node:fs/promises",()=>({...fs,
  readFile:async(...args:Parameters<typeof fs.readFile>)=>{
    if(String(args[0])===join(support,"relay-agents.json"))await stopAt("discovery");
    if(String(args[0])===join(project,".gitignore"))await stopAt("ignore");
    return (read as any)(...args);
  },
  mkdir:async(...args:Parameters<typeof fs.mkdir>)=>{
    mutation("mkdir",args[0]);const result=await (mkdir as any)(...args);
    if(String(args[0])===join(project,".openscout"))await stopAt("directory");
    if(String(args[0])===support)await stopAt("registry-directory");return result;
  },
  writeFile:async(...args:Parameters<typeof fs.writeFile>)=>{
    mutation("write",args[0]);const result=await (write as any)(...args);
    if(String(args[0])===join(project,".gitignore"))await stopAt("cleanup");return result;
  },
  rm:async(...args:Parameters<typeof fs.rm>)=>{mutation("rm",args[0]);return (rm as any)(...args);},
}));
if(config.admission){const m=await import(pathToFileURL(config.admission).href);mock.module(pathToFileURL(resolve("packages/runtime/src/effect-admission.ts")).href,()=>m);}
if(config.setup){const m=await import(pathToFileURL(config.setup).href);mock.module(pathToFileURL(resolve("packages/runtime/src/setup.ts")).href,()=>m);}
if(config.local){const m=await import(pathToFileURL(config.local).href);mock.module(pathToFileURL(resolve("packages/runtime/src/local-agents.ts")).href,()=>m);}
if(config.agents){const m=await import(pathToFileURL(config.agents).href);mock.module("@openscout/runtime/control-plane-agents",()=>m);}
const piPath=pathToFileURL(resolve("packages/runtime/src/pi-rpc.ts")).href;
const pi=await import(piPath);
mock.module(piPath,()=>({...pi,ensurePiRpcAgentOnline:async()=>{launches++;throw Error("configuration witness forbids engine warmup");}}));
const brokerPath=flavor==="web"?join(base,"broker/service.ts"):resolve("packages/cli/src/lib/core/broker/service.ts");
const broker=await import(pathToFileURL(brokerPath).href);
mock.module(pathToFileURL(brokerPath).href,()=>({...broker,
  registerScoutLocalAgentBinding:async()=>{bindings++;return null;},
  loadScoutBrokerContext:async()=>{throw Error("configuration witness stops before subsequent broker effects");},
}));
if(config.mobile){const m=await import(pathToFileURL(config.mobile).href);mock.module(pathToFileURL(join(base,"mobile/service.ts")).href,()=>m);}
const {bridgeRouter}=await import(pathToFileURL(config.router??join(base,"pairing/runtime/bridge/router.ts")).href);
const {handleRPC}=await import(pathToFileURL(config.legacy??join(base,"pairing/runtime/bridge/server.ts")).href);
const host=generateKeyPair(),phone=generateKeyPair(),key=bytesToHex(phone.publicKey),bridge={};
const fixture=capsuleFixture(realpathSync(process.env.OPENSCOUT_PAIRING_HOME!),{generations:2,keys:1,publicKeys:[key],migrate:true});
const domain=new TransportDomain(bridge,bytesToHex(host.publicKey),fixture.owner);fixtureHost(domain,host);const peer=liveTransport(domain,phone);
try{
 const ctx={...peer.ctx,cwd:project,deviceId:key.slice(0,16)},input={workspaceId:project,harness:"pi"};
 let settled=false;
 const outcome=(protocol==="legacy"?handleRPC(bridge,{id:"agent-config",method:"mobile/session/create",params:input},ctx):
  bridgeRouter.createCaller(ctx).mobile.createSession(input)).catch((error:unknown)=>error);
 outcome.then(()=>{settled=true;});
 if(stage!=="happy"){
  const end=performance.now()+20_000;while(!entered){if(settled){const result:any=await outcome;throw Error("agent configuration settled before pause: "+(result?.message??result?.error?.message));}if(performance.now()>end)throw Error("agent configuration pause not reached");await Bun.sleep(2);}
  fixture.owner.mutate(fixture.owner.read().revision,crypto.randomUUID(),{type:"revoke",publicKey:key});revoked=true;release();
 }
 const result=await outcome,message=result instanceof Error?result.message:(result as any)?.error?.message;
 console.log("AGENT_CONFIG_EFFECT "+JSON.stringify({flavor,protocol,stage,mutations,lateMutations,bindings,launches,seen,message}));
 assert.equal(launches,0,"configuration witness must not launch an engine");
 if(stage==="happy"){
  assert(mutations>=5,"healthy setup must actually write configuration");assert(bindings>=1,"healthy setup must complete through agent startup");
  assert.match(message,/configuration witness stops before/);
 }else{
  assert.equal(lateMutations,0,"no resumed agent configuration mutation after revoke ACK");
  assert.equal(bindings,0,"refusal must not continue into binding registration");
  assert.match(message,/Unauthorized|live authenticated/i,"must be authority refusal");
 }
}finally{release();domain.dispose();}
