/** Real mobile/controller/broker owners; every mutation goes to an owned sink. */
import {fixtureRuntime} from "./fixtures/process-runtime-isolation.ts";
import {mock} from "bun:test";
import assert from "node:assert/strict";
import {mkdirSync,realpathSync} from "node:fs";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {capsuleFixture} from "./fixtures/pairing-capsule.ts";
import {fixtureHost,liveTransport,generateKeyPair} from "./fixtures/live-transport.ts";
import {bytesToHex} from "../packages/runtime/src/pairing-security/identity.ts";
import {TransportDomain,requireTransportContext} from "../packages/runtime/src/pairing-security/transport.ts";
await fixtureRuntime.probe();
const [flavor,protocol,stage,state]=process.argv.slice(2),home=process.env.HOME!,project=join(home,"project");mkdirSync(project);
assert(["web","desktop"].includes(flavor!));assert(["trpc","legacy"].includes(protocol!));assert(["live","revoke"].includes(state!));
const source=(p:string)=>pathToFileURL(resolve(p)).href,base=flavor==="web"?"packages/web/server/core":"apps/desktop/src/core";
let entered=false,revoked=false,release!:()=>void;const pause=new Promise<void>(r=>release=r);
async function park(){if(!entered){entered=true;await pause;}}
const effects:{path:string;afterAck:boolean}[]=[];
const agent={id:"fixture-agent",kind:"agent",displayName:"Fixture",homeNodeId:"fixture",metadata:{}},actor={id:agent.id,kind:"agent",displayName:"Fixture"},endpoint={id:"fixture-endpoint",agentId:agent.id,nodeId:"fixture",harness:"claude",state:"ready",cwd:project,projectRoot:project,metadata:{}};
const snapshot:any={actors:{operator:{id:"operator",kind:"person"},[agent.id]:actor},agents:{[agent.id]:agent},endpoints:{[endpoint.id]:endpoint},conversations:{},messages:{},flights:{},nodes:{fixture:{id:"fixture"}}};
const node={id:"fixture"};
fixtureRuntime.setHandler(async request=>{
 const path=new URL(request.url).pathname;
 if(request.method==="GET"){
  if(path==="/health")return Response.json({ok:true,nodeId:"fixture",meshId:"fixture"});
  if(path==="/v1/node")return Response.json(node);
  if(path==="/v1/snapshot")return Response.json(snapshot);
  throw Error("unexpected fixture read: "+path);
 }
 assert.equal(request.method,"POST");assert(["/v1/actors","/v1/agents","/v1/endpoints","/v1/conversations","/v1/deliver"].includes(path),path);
 const body:any=await request.json();effects.push({path,afterAck:revoked});
 if(path==="/v1/conversations")snapshot.conversations[body.id]=body;
 if(stage==="binding-next"&&path==="/v1/actors")await park(); // accepted earlier; next POST is a fresh effect
 if(stage==="accepted"&&path==="/v1/deliver")await park();
 return Response.json(path==="/v1/deliver"?{kind:"delivery",conversation:{id:"fixture-conversation"},message:{id:"fixture-message"},flight:{id:"fixture-flight"}}:{ok:true});
});
const probesPath=source("packages/runtime/src/system-probes/index.ts"),probes=await import(probesPath);
mock.module(probesPath,()=>({...probes,execSystemFile:async()=>({stdout:"",stderr:"",exitCode:0})}));
const localPath=source("packages/runtime/src/local-agents.ts"),local=await import(localPath);
mock.module(localPath,()=>({...local,inferLocalAgentBinding:async()=>{if(stage==="binding"||stage==="controller-infer")await park();return {actor,agent,endpoint};}}));
const brokerPath=source(flavor==="web"?base+"/broker/service.ts":"packages/cli/src/lib/core/broker/service.ts"),broker=await import(brokerPath);
const originalOpen=broker.openScoutPeerSession,originalSend=broker.sendScoutDirectMessage;
// Wrappers simulate an async resolver/input boundary, retaining real downstream
// broker helpers and their final HTTP submissions (not just a counter stub).
mock.module(brokerPath,()=>({...broker,
 openScoutPeerSession:async(input:any)=>{if(stage==="peer")await park();return originalOpen(input);},
 sendScoutDirectMessage:async(input:any)=>{if(stage==="seed")await park();return originalSend(input);},
}));
const status:any={agentId:agent.id,projectName:"Fixture",projectRoot:project,harness:"claude",transport:"tmux",sessionId:"fixture-session"};
const start=async(_input:any,beforeEffect?:()=>void)=>{beforeEffect?.();if(stage==="startup"||stage==="controller")await park();return status;};
const agentPath=source(flavor==="web"?base+"/agents/service.ts":"packages/cli/src/lib/core/agents/service.ts"),agents=await import(agentPath);
mock.module(agentPath,()=>({...agents,upScoutAgent:start}));
const host=generateKeyPair(),phone=generateKeyPair(),key=bytesToHex(phone.publicKey),fixture=capsuleFixture(realpathSync(process.env.OPENSCOUT_PAIRING_HOME!),{generations:2,keys:1,publicKeys:[key],migrate:true}),bridge={};
const domain=new TransportDomain(bridge,bytesToHex(host.publicKey),fixture.owner);fixtureHost(domain,host);const peer=liveTransport(domain,phone),ctx={...peer.ctx,cwd:project};
const admit=()=>{requireTransportContext(ctx,true);};
let operation:Promise<any>|undefined;
try{
 console.log("MOBILE_POST_READY real-noise sandbox-only");
 if(stage==="residue"){
  // The surviving local-agent command/broker producer has no phone callback.
  fixture.owner.mutate(fixture.owner.read().revision,"residue-revoke",{type:"revoke",publicKey:key});revoked=true;assert.throws(admit);
  const {createScoutAgentService}=await import(source("packages/runtime/src/control-plane-agents.ts"));
  const service=createScoutAgentService({...broker,localAgents:{startLocalAgent:start}} as any);
  await service.upScoutAgent({projectPath:project} as any);
  await broker.openScoutPeerSession({sourceId:"operator",targetId:agent.id,currentDirectory:project});
  await broker.sendScoutDirectMessage({agentId:agent.id,body:"fixture seed",currentDirectory:project});
  console.log("MOBILE_POST_EFFECT "+JSON.stringify({flavor,protocol,stage,state,revoked,effects,nativeHarnesses:0}));
  assert.equal(effects.filter(x=>x.afterAck).length,5,"remaining local-agent/broker producers stay visible");
 }else{
  if(stage==="controller"||stage==="controller-infer"){
   const {createScoutAgentService}=await import(source("packages/runtime/src/control-plane-agents.ts"));
   const service=createScoutAgentService({...broker,localAgents:{startLocalAgent:start}} as any);
   operation=service.upScoutAgent({projectPath:project} as any,admit).catch(error=>error);
  }else{
   const {bridgeRouter}=await import(source(base+"/pairing/runtime/bridge/router.ts"));const {handleRPC}=await import(source(base+"/pairing/runtime/bridge/server.ts"));
   const input={workspaceId:project,harness:"claude",seed:{instructions:"fixture seed"}};
   operation=Promise.resolve(protocol==="legacy"?handleRPC(bridge,{id:"post-startup",method:"mobile/session/create",params:input},ctx):bridgeRouter.createCaller(ctx).mobile.createSession(input)).catch(error=>error);
  }
  let settled=false;operation.then(()=>{settled=true;});const end=performance.now()+15_000;
  while(!entered){if(settled)throw Error("post-startup operation stopped before pause: "+String(await operation));if(performance.now()>end)throw Error("post-startup pause not reached");await Bun.sleep(1);}
  if(state==="revoke"){fixture.owner.mutate(fixture.owner.read().revision,"post-revoke",{type:"revoke",publicKey:key});revoked=true;assert.throws(admit);}
  release();const result=await operation,message=result instanceof Error?result.message:result?.error?.message;
  console.log("MOBILE_POST_EFFECT "+JSON.stringify({flavor,protocol,stage,state,revoked,effects,nativeHarnesses:0,message}));
  assert.equal(effects.filter(x=>x.afterAck).length,0,"no resumed mobile post-startup submission after revoke ACK");
  if(state==="revoke"&&stage!=="accepted")assert.match(message??"",/Unauthorized|live authenticated/i,"authority refusal must not be swallowed");
  else{assert.equal(message,undefined,"healthy or earlier-accepted work must complete");assert.equal(effects.length,stage!.startsWith("controller")?3:5);}
 }
}finally{release();if(operation)await operation;domain.dispose();await fixtureRuntime.close();}
