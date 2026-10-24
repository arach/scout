/** Real mobile send/update/delivery owners; only owned HTTP sinks are reachable. */
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
const source=(p:string)=>pathToFileURL(resolve(p)).href,base=flavor==="web"?"packages/web/server/core":"apps/desktop/src/core";
let entered=false,revoked=false,release!:()=>void;const pause=new Promise<void>(r=>release=r);
async function park(){if(!entered){entered=true;await pause;}}
const effects:{path:string;afterAck:boolean}[]=[];
const agent={id:"fixture-agent",kind:"agent",displayName:"Fixture",homeNodeId:"fixture",metadata:{}},endpoint={id:"fixture-endpoint",agentId:agent.id,nodeId:"fixture",harness:"claude",state:"ready",cwd:project,projectRoot:project,metadata:{}};
const conversation=(id:string,kind:string)=>({id,kind,title:"fixture",visibility:"private",shareMode:"local",authorityNodeId:"fixture",participantIds:["operator",agent.id],metadata:{channel:"fixture"}});
const snapshot:any={actors:{operator:{id:"operator",kind:"person"},[agent.id]:agent},agents:{[agent.id]:agent},endpoints:{[endpoint.id]:endpoint},conversations:{direct:conversation("direct","direct"),group:conversation("group","group_direct"),"channel.fixture":conversation("channel.fixture","channel")},messages:{anchor:{id:"anchor",conversationId:"group",actorId:agent.id,createdAt:1,body:"fixture anchor"}},flights:{},nodes:{fixture:{id:"fixture"}}};
const node={id:"fixture",capabilities:["session-input-receipts/1"]};
fixtureRuntime.setHandler(async request=>{
 const path=new URL(request.url).pathname;
 if(request.method==="GET"){
  if(path==="/health")return Response.json({ok:true,nodeId:"fixture",meshId:"fixture"});
  if(path==="/v1/node")return Response.json(node);
  if(path==="/v1/snapshot"){
   if(!["channel-next","bot-next","fallback"].includes(stage!))await park();
   return Response.json(snapshot);
  }
  throw Error("unexpected fixture read: "+path);
 }
 assert.equal(request.method,"POST");assert(["/v1/actors","/v1/agents","/v1/endpoints","/v1/conversations","/v1/messages","/v1/deliver","/v1/invocations"].includes(path)||path.endsWith("/read-cursors"),path);
 const body:any=await request.json();assert(!Object.hasOwn(body,"beforeEffect"),"admission must remain local");effects.push({path,afterAck:revoked});
 if(path==="/v1/conversations")snapshot.conversations[body.id]=body;
 if((stage==="channel-next"||stage==="bot-next")&&path==="/v1/conversations")await park();
 if(stage==="fallback"&&path==="/v1/deliver"){await park();return Response.json({kind:"rejected",rejection:{reason:"target_unavailable",detail:"fixture unavailable"}});}
 return Response.json(path==="/v1/deliver"?{kind:"delivery",conversation:{id:"fixture-conversation"},message:{id:"fixture-message"},flight:{id:"fixture-flight"}}:{ok:true});
});
const probesPath=source("packages/runtime/src/system-probes/index.ts"),probes=await import(probesPath);
mock.module(probesPath,()=>({...probes,execSystemFile:async()=>({stdout:"",stderr:"",exitCode:0})}));
if(flavor==="web"){
 const threadPath=source("packages/web/server/scoutbot/thread-map.ts"),threads=await import(threadPath);
 const thread={threadId:"thr-default",name:"fixture",conversationId:"fixture-bot",transportSessionId:null,transport:"codex_app_server",pins:null,lastActiveAt:1};
 mock.module(threadPath,()=>({...threads,ScoutbotThreadMapStore:class{async list(){return {defaultThreadId:thread.threadId,threads:[thread]};}async getThread(){return thread;}}}));
}
const host=generateKeyPair(),phone=generateKeyPair(),key=bytesToHex(phone.publicKey),fixture=capsuleFixture(realpathSync(process.env.OPENSCOUT_PAIRING_HOME!),{generations:2,keys:1,publicKeys:[key],migrate:true}),bridge={};
const domain=new TransportDomain(bridge,bytesToHex(host.publicKey),fixture.owner);fixtureHost(domain,host);const peer=liveTransport(domain,phone),ctx={...peer.ctx,cwd:project};
let operation:Promise<any>|undefined;
let refusal:any,admissionCalls=0;
try{
 const {bridgeRouter}=await import(source(base+"/pairing/runtime/bridge/router.ts")),{handleRPC}=await import(source(base+"/pairing/runtime/bridge/server.ts"));
 const caller=bridgeRouter.createCaller(ctx),send=stage==="send"||stage!.startsWith("bot"),read=stage==="read";
 const input=stage==="harness-residue"?{sessionId:"fixture-session",harness:"claude",cwd:project,body:"fixture reply",clientMessageId:"fixture-reply"}:send?{agentId:stage!.startsWith("bot")?"scoutbot":agent.id,body:"fixture body"}:{conversationId:stage==="group"?"group":stage==="fallback"?"direct":"channel.fixture",body:"fixture body",replyToMessageId:stage==="group"?"anchor":undefined};
 if(stage==="one-shot-refusal"){
  const broker=await import(source("packages/web/server/core/broker/service.ts"));
  refusal=Object.assign(new broker.ScoutDirectDeliveryUnavailableError({kind:"rejected",rejection:{reason:"target_unavailable",detail:"fixture one-shot admission refused"}} as any),{code:"ECONNREFUSED"});
 }
 console.log("BROKER_SUBMISSION_READY real-noise sandbox-only");
 operation=Promise.resolve(stage==="one-shot-refusal"?(await import(source(base+"/mobile/service.ts"))).sendScoutMobileComms({conversationId:"direct",body:"fixture body"},project,ctx.deviceId,()=>{requireTransportContext(ctx,true);if(++admissionCalls===1)throw refusal;}):protocol==="legacy"?handleRPC(bridge,{id:"broker-post",method:read?"mobile/comms/read":send?"mobile/message/send":"mobile/comms/send",params:input},ctx):stage==="harness-residue"?caller.mobile.askSession(input):read?caller.mobile.commsMarkRead(input):send?caller.mobile.sendMessage(input):caller.mobile.commsSend(input)).catch(error=>error);
 let settled=false;operation.then(()=>settled=true);const until=performance.now()+15_000;
 while(!entered){if(settled)throw Error("operation stopped before fixture wait: "+JSON.stringify(await operation));if(performance.now()>until)throw Error("fixture wait not reached");await Bun.sleep(1);}
 if(state==="revoke"){fixture.owner.mutate(fixture.owner.read().revision,"broker-revoke",{type:"revoke",publicKey:key});revoked=true;assert.throws(()=>requireTransportContext(ctx,true));}
 release();const result=await operation,message=result instanceof Error?result.message:result?.error?.message;
 console.log("BROKER_SUBMISSION_EFFECT "+JSON.stringify({flavor,protocol,stage,state,effects,message,admissionCalls,nativeHarnesses:0}));
 if(stage==="harness-residue"){assert(effects.some(x=>x.afterAck),"remaining harness-reply producer still submits after ACK");}
 else assert.equal(effects.filter(x=>x.afterAck).length,0,"no final broker client submission after revoke ACK");
 if(stage==="one-shot-refusal"){assert.equal(result,refusal,"one-shot admission refusal must not become persistence fallback");assert.equal(effects.length,0);assert.equal(admissionCalls,1);}
 else if(stage==="harness-residue"){}
 else if(state==="revoke")assert.match(message??"",/Unauthorized|live authenticated/i,"authority refusal must propagate");
 else{assert.equal(message,undefined,"healthy routing preserved");assert(effects.length>0,"healthy mutation must reach owned broker sink");}
}finally{release();if(operation)await operation;domain.dispose();await fixtureRuntime.close();}
