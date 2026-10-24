/** Actual mobile handlers and agent owners. Only asynchronous filesystem
 * observation and the post-startup broker sinks are injected. Lazy ACP warmup
 * must publish registry state without launching a harness. */
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
const [flavor,protocol,harness,stage,configPath]=process.argv.slice(2);
assert(["web","desktop"].includes(flavor!));assert(["legacy","trpc"].includes(protocol!));
assert(["grok-acp","kimi","devin"].includes(harness!));assert(["discovery","publication","directory","happy"].includes(stage!));
const config=configPath?JSON.parse(readFileSync(configPath,"utf8")):{};
const base=resolve(flavor==="web"?"packages/web/server/core":"apps/desktop/src/core"),home=process.env.HOME!;
const project=join(home,"agent-project"),support=process.env.OPENSCOUT_SUPPORT_DIRECTORY!,registry=join(support,"relay-agents.json");mkdirSync(project);
// Existence-only binary discovery. Any attempt to execute these must fail.
const bin=join(home,"bin");mkdirSync(bin);for(const name of ["grok","kimi","devin"])writeFileSync(join(bin,name),"not executable: lazy warmup must not spawn\n");process.env.PATH=bin;
let entered=false,revoked=false,release:()=>void=()=>{},lateMutations=0,bindings=0,registryWrites=0,readsAfterConfig=0;
const seen:string[]=[],pause=new Promise<void>(r=>{release=r;});
async function stop(){if(!entered){entered=true;await pause;}}
function mutation(kind:string,path:unknown){const p=String(path);assert(p.startsWith(home+"/"),"warmup must remain inside isolated HOME");if(revoked)lateMutations++;seen.push(kind+":"+p.slice(home.length));}
const read=fs.readFile,mkdir=fs.mkdir,write=fs.writeFile;
mock.module("node:fs/promises",()=>({...fs,
 readFile:async(...args:Parameters<typeof fs.readFile>)=>{
  if(String(args[0])===registry&&registryWrites===1){readsAfterConfig++;
   // Startup reads the override, registered binding reads registry+overrides,
   // then lazy warmup reads its registry. Pause at the writer's own later read.
   if((stage==="discovery"&&readsAfterConfig===1)||(stage==="publication"&&readsAfterConfig===5))await stop();
  }
  return (read as any)(...args);
 },
 mkdir:async(...args:Parameters<typeof fs.mkdir>)=>{mutation("mkdir",args[0]);const value=await (mkdir as any)(...args);if(stage==="directory"&&String(args[0])===support&&registryWrites===1)await stop();return value;},
 writeFile:async(...args:Parameters<typeof fs.writeFile>)=>{mutation("write",args[0]);const value=await (write as any)(...args);if(String(args[0])===registry)registryWrites++;return value;},
}));
if(config.local){const m=await import(pathToFileURL(config.local).href);mock.module(pathToFileURL(resolve("packages/runtime/src/local-agents.ts")).href,()=>m);}
const brokerPath=flavor==="web"?join(base,"broker/service.ts"):resolve("packages/cli/src/lib/core/broker/service.ts");
const broker=await import(pathToFileURL(brokerPath).href);
mock.module(pathToFileURL(brokerPath).href,()=>({...broker,
 registerScoutLocalAgentBinding:async()=>{bindings++;return null;},
 loadScoutBrokerContext:async()=>{throw Error("warmup witness stops before subsequent broker effects");},
}));
const {bridgeRouter}=await import(pathToFileURL(join(base,"pairing/runtime/bridge/router.ts")).href);
const {handleRPC}=await import(pathToFileURL(join(base,"pairing/runtime/bridge/server.ts")).href);
const host=generateKeyPair(),phone=generateKeyPair(),key=bytesToHex(phone.publicKey),bridge={};
const fixture=capsuleFixture(realpathSync(process.env.OPENSCOUT_PAIRING_HOME!),{generations:2,keys:1,publicKeys:[key],migrate:true});
const domain=new TransportDomain(bridge,bytesToHex(host.publicKey),fixture.owner);fixtureHost(domain,host);const peer=liveTransport(domain,phone);
try{
 const ctx={...peer.ctx,cwd:project,deviceId:key.slice(0,16)},input={workspaceId:project,harness};let settled=false;
 const outcome=(protocol==="legacy"?handleRPC(bridge,{id:"acp-warmup",method:"mobile/session/create",params:input},ctx):bridgeRouter.createCaller(ctx).mobile.createSession(input)).catch((error:unknown)=>error);outcome.then(()=>{settled=true;});
 if(stage!=="happy"){
  const end=performance.now()+20_000;while(!entered){if(settled){const result:any=await outcome;throw Error("ACP warmup settled before pause: "+(result?.message??result?.error?.message));}if(performance.now()>end)throw Error("ACP warmup pause not reached");await Bun.sleep(2);}
  fixture.owner.mutate(fixture.owner.read().revision,crypto.randomUUID(),{type:"revoke",publicKey:key});revoked=true;release();
 }
 const result=await outcome,message=result instanceof Error?result.message:(result as any)?.error?.message;
 console.log("ACP_WARMUP_EFFECT "+JSON.stringify({flavor,protocol,harness,stage,lateMutations,bindings,registryWrites,readsAfterConfig,seen,message}));
 if(stage==="happy"){
  assert.equal(registryWrites,2,"healthy lazy ACP warmup must actually publish its registry");assert.equal(bindings,1);assert.match(message,/warmup witness stops before/);
 }else{
  assert.equal(lateMutations,0,"no resumed lazy ACP registry mutation after revoke ACK");
  assert.equal(bindings,0,"lazy ACP refusal must not become a successful binding");
  assert.match(message,/Unauthorized|live authenticated/i,"must be authority refusal");
 }
}finally{release();domain.dispose();}
