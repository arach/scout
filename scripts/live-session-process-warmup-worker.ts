/** Real mobile dispatch and warmup owners; all files and sinks stay in HOME.
 * The launch sink records submission, never starts a native harness. */
import {fixtureRuntime} from "./fixtures/process-runtime-isolation.ts";
import {mock} from "bun:test";
import assert from "node:assert/strict";
import {mkdirSync,realpathSync,readFileSync,writeFileSync} from "node:fs";
import * as fs from "node:fs/promises";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {capsuleFixture} from "./fixtures/pairing-capsule.ts";
import {fixtureHost,liveTransport,generateKeyPair} from "./fixtures/live-transport.ts";
import {bytesToHex} from "../packages/runtime/src/pairing-security/identity.ts";
import {TransportDomain,requireTransportContext} from "../packages/runtime/src/pairing-security/transport.ts";
await fixtureRuntime.probe();
const [flavor,protocol,harness,stage,configPath]=process.argv.slice(2);
assert(["web","desktop"].includes(flavor!));assert(["legacy","trpc"].includes(protocol!));
assert(["claude"].includes(harness!));assert(["warmup-directory","happy","broker-residue","command-residue"].includes(stage!));
const config=configPath?JSON.parse(readFileSync(configPath,"utf8")):{};
const base=resolve(flavor==="web"?"packages/web/server/core":"apps/desktop/src/core"),home=process.env.HOME!;
const project=join(home,"agent-project"),support=process.env.OPENSCOUT_SUPPORT_DIRECTORY!,registry=join(support,"relay-agents.json");mkdirSync(project);
// Existence-only binary discovery. Any attempt to execute these must fail.
process.env.OPENSCOUT_BUN_BIN=process.execPath;process.env.OPENSCOUT_PROBES_SOCKET=join(home,"absent-probes.sock");
const bin=join(home,"bin");mkdirSync(bin);for(const name of ["claude","tmux"])writeFileSync(join(bin,name),"not executable: fixture sinks own launch submission\n");process.env.PATH=bin;
let launches=0,brokerEntered=false,brokerPosts=0,brokerRoutedAfterAck=false,brokerRelease:()=>void=()=>{};
const brokerPause=new Promise<void>(r=>{brokerRelease=r;});
let routeBroker:((body:any)=>Promise<unknown>)|undefined;
const probesPath=pathToFileURL(resolve("packages/runtime/src/system-probes/index.ts")).href;
const probes=await import(probesPath);
mock.module(probesPath,()=>({...probes,readTmuxSessionExists:async()=>false,readTmuxSessionExistsSnapshot:()=>false,execSystemFile:async(command:string,args:string[])=>{if(command==="tmux"&&args[0]==="new-session"){launches++;throw Error("fixture tmux launch submission observed");}return {stdout:"",stderr:"",exitCode:0};}}));
let entered=false,revoked=false,release:()=>void=()=>{},lateMutations=0,bindings=0,registryWrites=0,readsAfterConfig=0;
const seen:string[]=[],pause=new Promise<void>(r=>{release=r;});
async function stop(){if(!entered){entered=true;await pause;}}
function mutation(kind:string,path:unknown){const p=String(path);assert(p.startsWith(home+"/"),"warmup must remain inside isolated HOME");if(revoked)lateMutations++;seen.push(kind+":"+p.slice(home.length));}
const read=fs.readFile,mkdir=fs.mkdir,write=fs.writeFile;
mock.module("node:fs/promises",()=>({...fs,
 readFile:async(...args:Parameters<typeof fs.readFile>)=>{
  if(String(args[0])===registry&&registryWrites===1){readsAfterConfig++;

  }
  return (read as any)(...args);
 },
 mkdir:async(...args:Parameters<typeof fs.mkdir>)=>{mutation("mkdir",args[0]);const value=await (mkdir as any)(...args);if((stage==="warmup-directory"||stage==="broker-residue"||stage==="command-residue")&&String(args[0])!==support&&registryWrites===1)await stop();return value;},
 writeFile:async(...args:Parameters<typeof fs.writeFile>)=>{mutation("write",args[0]);const value=await (write as any)(...args);if(String(args[0])===registry)registryWrites++;return value;},
}));
if(config.local){const m=await import(pathToFileURL(config.local).href);mock.module(pathToFileURL(resolve("packages/runtime/src/local-agents.ts")).href,()=>m);}
if(stage==="broker-residue"||stage==="command-residue"){
 fixtureRuntime.setHandler(async request=>{
  const path=new URL(request.url).pathname;
  if(path==="/health"){brokerEntered=true;await brokerPause;return Response.json({ok:true,nodeId:"fixture",meshId:"fixture"});}
  if(path==="/v1/node")return Response.json({id:"fixture"});
  if(path==="/v1/snapshot")return Response.json({actors:{},agents:{},endpoints:{},conversations:{},messages:{},flights:{}});
  assert.equal(path,"/v1/deliver","all broker I/O must stay on the sandbox");
  assert.equal(request.method,"POST");brokerPosts++;assert(revoked,"delivery must reach broker AFTER revoke ACK");brokerRoutedAfterAck=true;
  await routeBroker!(await request.json());
  return Response.json({kind:"delivery",accepted:true,conversation:{id:"fixture-conversation"},message:{id:"fixture-message"},flight:{id:"fixture-flight"}});
 });
}
const brokerPath=flavor==="web"?join(base,"broker/service.ts"):resolve("packages/cli/src/lib/core/broker/service.ts");
const broker=await import(pathToFileURL(brokerPath).href);
mock.module(pathToFileURL(brokerPath).href,()=>({...broker,
 registerScoutLocalAgentBinding:async()=>{bindings++;return null;},
 ...((stage==="broker-residue"||stage==="command-residue")?{}:{loadScoutBrokerContext:async()=>{throw Error("warmup witness stops before subsequent broker effects");}}),
}));
const {bridgeRouter}=await import(pathToFileURL(join(base,"pairing/runtime/bridge/router.ts")).href);
const {handleRPC}=await import(pathToFileURL(join(base,"pairing/runtime/bridge/server.ts")).href);
const host=generateKeyPair(),phone=generateKeyPair(),key=bytesToHex(phone.publicKey),bridge={};
const fixture=capsuleFixture(realpathSync(process.env.OPENSCOUT_PAIRING_HOME!),{generations:2,keys:1,publicKeys:[key],migrate:true});
const domain=new TransportDomain(bridge,bytesToHex(host.publicKey),fixture.owner);fixtureHost(domain,host);const peer=liveTransport(domain,phone);assert.equal(requireTransportContext(peer.ctx,true).publicKey,key);console.log("A2_FIXTURE_READY real-noise bound-session sandbox-only");
let brokerOutcome:Promise<unknown>|undefined;
try{
 const ctx={...peer.ctx,cwd:project,deviceId:key.slice(0,16)},input={workspaceId:project,harness};let settled=false;
 const outcome=(protocol==="legacy"?handleRPC(bridge,{id:"acp-warmup",method:"mobile/session/create",params:input},ctx):bridgeRouter.createCaller(ctx).mobile.createSession(input)).catch((error:unknown)=>error);outcome.then(()=>{settled=true;});
 if(stage!=="happy"){
  const end=performance.now()+20_000;while(!entered){if(settled){const result:any=await outcome;throw Error("warmup settled before pause: "+(result?.message??result?.error?.message));}if(performance.now()>end)throw Error("warmup pause not reached");await Bun.sleep(2);}
  if(stage==="broker-residue"||stage==="command-residue"){
   const {ensureLocalAgentBindingOnline,ensureLocalSessionEndpointOnline}=await import(pathToFileURL(resolve("packages/runtime/src/local-agents.ts")).href);
   const {BrokerLocalEndpointResolver}=await import(pathToFileURL(resolve("packages/runtime/src/broker-local-endpoint-resolver.ts")).href);
   const {readRelayAgentOverrides}=await import(pathToFileURL(resolve("packages/runtime/src/setup.ts")).href);
   const ids=Object.keys(await readRelayAgentOverrides());assert.equal(ids.length,1);
   const resolver=new BrokerLocalEndpointResolver({nodeId:"fixture",runtime:{endpointsForAgent:()=>[]},isLocalAgentEndpointAlive:()=>false,
    ensureLocalAgentBindingOnline,ensureLocalSessionEndpointOnline,upsertActor:async()=>{},upsertAgent:async()=>{},persistEndpoint:async()=>{}});
   routeBroker=async body=>{assert.equal(body.targetAgentId,ids[0]);assert.equal(body.ensureAwake,true);
    await resolver.resolveLocalEndpointForInvocation({...body,id:"fixture-invocation",conversationId:"fixture-conversation",requesterId:"operator",targetAgentId:ids[0],execution:{session:"new"},ensureAwake:true} as any);
   };
   const send={agentId:ids[0],body:"fixture residue only"};
   brokerOutcome=Promise.resolve(stage==="command-residue"?broker.sendScoutDirectMessage(send):protocol==="legacy"?handleRPC(bridge,{id:"broker-residue",method:"mobile/message/send",params:send},ctx):bridgeRouter.createCaller(ctx).mobile.sendMessage(send)).catch((error:unknown)=>error);
   let brokerSettled=false;brokerOutcome.then(()=>{brokerSettled=true;});
   const until=performance.now()+10_000;while(!brokerEntered){if(brokerSettled)throw Error("broker stopped before health: "+String(await brokerOutcome));if(performance.now()>until)throw Error("broker health pause not reached");await Bun.sleep(2);}
  }
  fixture.owner.mutate(fixture.owner.read().revision,crypto.randomUUID(),{type:"revoke",publicKey:key});assert.throws(()=>requireTransportContext(peer.ctx,true));revoked=true;release();
 }
 const result=await outcome;const directLateMutations=lateMutations;const directLaunches=launches;
 if(stage==="broker-residue"||stage==="command-residue"){
  brokerRelease();const brokerResult:any=await brokerOutcome;
  if(stage==="command-residue"){
   // Explicit host/local producer without a phone callback. This is not a
   // complete phone-to-local-command routing qualification.
   assert.equal(brokerPosts,1);assert(brokerRoutedAfterAck);assert.equal(launches,1,"remaining local broker producer must reach fixture launch after ACK");assert(lateMutations>0,"local producer residue must remain observable");
  }else{
   assert.equal(brokerPosts,0,"resumed phone broker submission must refuse after ACK");assert(!brokerRoutedAfterAck);assert.equal(launches,0);assert.equal(lateMutations,0);
   assert.match(brokerResult?.message??brokerResult?.error?.message??"",/Unauthorized|live authenticated/i);
  }
 }
 const message=result instanceof Error?result.message:(result as any)?.error?.message;
 console.log("A2_WARMUP_BASELINE "+JSON.stringify({flavor,protocol,harness,stage,entered,revoked,directLateMutations,directLaunches,brokerPosts,brokerRoutedAfterAck,launchSubmissions:launches,nativeLaunches:0,lateMutations,bindings,registryWrites,readsAfterConfig,seen,message}));
 if(stage==="happy"){
  assert.equal(launches,1,"healthy warmup must reach the launch sink");assert.equal(bindings,0);assert.match(message,/fixture tmux launch submission observed/);
 }else{
  assert.equal(directLateMutations,0,"no resumed process warmup mutation after revoke ACK");
  assert.equal(directLaunches,0,"direct launch must be fenced");
  assert.equal(bindings,0,"direct warmup refusal must not become a successful binding");
  assert.match(message,/Unauthorized|live authenticated/i,"must be authority refusal");
 }
}finally{release();brokerRelease();if(brokerOutcome)await brokerOutcome;await fixtureRuntime.close();domain.dispose();}
