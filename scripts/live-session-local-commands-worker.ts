/** Bound-session submission witnesses. Every process and network sink is owned here. */
import {fixtureRuntime} from "./fixtures/process-runtime-isolation.ts";
import {mock} from "bun:test";
import assert from "node:assert/strict";
import {mkdirSync,writeFileSync,realpathSync} from "node:fs";
import * as fs from "node:fs/promises";
import * as cp from "node:child_process";
import {EventEmitter} from "node:events";
import {PassThrough,Writable} from "node:stream";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {capsuleFixture} from "./fixtures/pairing-capsule.ts";
import {fixtureHost,liveTransport,generateKeyPair} from "./fixtures/live-transport.ts";
import {bytesToHex} from "../packages/runtime/src/pairing-security/identity.ts";
import {TransportDomain,requireTransportContext} from "../packages/runtime/src/pairing-security/transport.ts";
await fixtureRuntime.probe();
const [kind,target,state,flavor="web",protocol="trpc"]=process.argv.slice(2),home=process.env.HOME!,project=join(home,"project"),support=process.env.OPENSCOUT_SUPPORT_DIRECTORY!;
mkdirSync(project);mkdirSync(support,{recursive:true});process.env.OPENSCOUT_PROBES_SOCKET=join(home,"absent.sock");process.env.OPENSCOUT_BUN_BIN=process.execPath;process.env.OPENSCOUT_NODE_QUALIFIER="fixture";
const source=(p:string)=>pathToFileURL(resolve(p)).href;
const host=generateKeyPair(),phone=generateKeyPair(),otherPhone=generateKeyPair(),key=bytesToHex(phone.publicKey),otherKey=bytesToHex(otherPhone.publicKey),publicKeys=kind==="acp"&&target==="prompt"&&state==="revoke"?[key,otherKey]:[key],fixture=capsuleFixture(realpathSync(process.env.OPENSCOUT_PAIRING_HOME!),{generations:publicKeys.length+1,keys:publicKeys.length,publicKeys,migrate:true}),bridge:any={};
const domain=new TransportDomain(bridge,bytesToHex(host.publicKey),fixture.owner);fixtureHost(domain,host);const peer=liveTransport(domain,phone),otherPeer=publicKeys.length>1?liveTransport(domain,otherPhone):undefined;assert.equal(requireTransportContext(peer.ctx,true).publicKey,key);
let inCommandSink=false,refusalUsed=false;const oneShot=Object.assign(Error("fixture one-shot caller refusal"),{code:"ECONNREFUSED"});
let entered=false,afterAck=false,effects=0,late=0,ownerReadsAfterAck=0,admissions=0,release!:()=>void;const pause=new Promise<void>(r=>release=r),admit=()=>{admissions++;requireTransportContext(peer.ctx,true);if(kind==="refusal"&&inCommandSink&&!refusalUsed){refusalUsed=true;throw oneShot;}};
const sink=()=>{effects++;if(afterAck)late++;};let run!:()=>Promise<unknown>,cleanup=async()=>{};let siblingRun:(()=>Promise<void>)|undefined;
if(kind==="scope"){
 // Unsupported harnesses must refuse before any broker request. This pins
 // producer reach, not admission after an await or generic ACP invocation.
 let brokerRequests=0;
 fixtureRuntime.setHandler(request=>{
  brokerRequests++;const path=new URL(request.url).pathname;
  console.log("STAGE5_SCOPE_BROKER "+JSON.stringify({harness:target,path,brokerRequests}));
  if(path==="/health")return Response.json({ok:true,nodeId:"fixture",meshId:"fixture"});
  if(path==="/v1/node")return Response.json({id:"fixture",capabilities:["session-input-receipts/1"]});
  if(path==="/v1/snapshot")return Response.json({actors:{},agents:{},endpoints:{},conversations:{},messages:{},flights:{}});
  return Response.json({ok:false});
 });
 const {bridgeRouter}=await import(source("packages/web/server/core/pairing/runtime/bridge/router.ts"));
 entered=true;
 run=async()=>{
  assert.equal(requireTransportContext(peer.ctx,true).publicKey,key);
  const result=await bridgeRouter.createCaller(peer.ctx).mobile.askSession({sessionId:"fixture-session",harness:target,cwd:project,body:"fixture scope probe",clientMessageId:"fixture-scope-"+target});
  console.log("STAGE5_SCOPE "+JSON.stringify({harness:target,liveBoundPhone:true,brokerRequests,result,nativeExecutions:0}));
  assert.equal(brokerRequests,0,"unsupported ACP harness must not reach broker");
  assert.equal(result.ok,false);assert.equal((result as any).code,"session_not_resumable");return result;
 };
}else if(kind==="router"){
 const path=source("packages/runtime/src/local-agents.ts"),actual=await import(path);
 const effect=async(hook?:()=>void)=>{entered=true;await pause;hook?.();sink();return {agentId:"fixture",accepted:true};};
 mock.module(path,()=>({...actual,stopLocalAgent:async(_id:string,hook?:()=>void)=>effect(hook),interruptLocalAgent:async(_id:string,hook?:()=>void)=>effect(hook),steerCodexDeckTurn:async(_id:string,_text:string,hook?:()=>void)=>effect(hook),interruptCodexDeckTurn:async(_id:string,hook?:()=>void)=>effect(hook)}));
 const root=flavor==="web"?"packages/web/server/core":"apps/desktop/src/core",{bridgeRouter}=await import(source(root+"/pairing/runtime/bridge/router.ts")),caller=bridgeRouter.createCaller(peer.ctx);
 run=()=>target==="stop"?caller.mobile.agentStop({agentId:"fixture"}):target==="interrupt"?caller.mobile.agentInterrupt({agentId:"fixture"}):target==="steer"?caller.codexDeck.steer({agentId:"fixture",text:"fixture"}):caller.codexDeck.interrupt({agentId:"fixture"});
}else if(kind==="local"||kind==="deck"||kind==="refusal"){
 const registry=join(support,"relay-agents.json");writeFileSync(registry,JSON.stringify({version:1,agents:{fixture:{agentId:"fixture",projectName:"fixture",projectRoot:project,runtime:{cwd:project,sessionId:"fixture",harness:kind==="deck"||target==="codex_app_server"?"codex":target==="pi_rpc"?"pi":(target==="kimi_acp"||target==="restart")?"kimi":"claude",transport:kind==="refusal"?"tmux":kind==="deck"?"codex_app_server":target==="restart"?"kimi_acp":target==="interrupt"?"tmux":target},capabilities:[]}}}));
 const {buildRelayAgentInstance}=await import(source("packages/runtime/src/setup.ts"));const agentId=buildRelayAgentInstance("fixture",project).id;
 const read=fs.readFile;mock.module("node:fs/promises",()=>({...fs,readFile:async(...args:Parameters<typeof fs.readFile>)=>{const result=await (read as any)(...args);if(target!=="restart"&&String(args[0])===registry&&!entered){entered=true;await pause;}return result;}}));
 const probesPath=source("packages/runtime/src/system-probes/index.ts"),probes=await import(probesPath);mock.module(probesPath,()=>({...probes,execSystemFile:async(_c:string,_a:any,o:any)=>{inCommandSink=true;try{o?.beforeEffect?.();sink();return {stdout:"",stderr:"",exitCode:0};}finally{inCommandSink=false;}}}));
 for(const [file,name] of [["codex-app-server","shutdownCodexAppServerAgent"],["claude-stream-json","shutdownClaudeStreamJsonAgent"],["pi-rpc","shutdownPiRpcAgent"]]){const path=source(`packages/runtime/src/${file}.ts`),actual=await import(path);mock.module(path,()=>({...actual,[name!]:async(_o:any,_s:any,hook?:()=>void)=>{hook?.();sink();},...(file==="codex-app-server"?{getCodexAppServerAgentSnapshot:async()=>({session:{id:"fixture",providerMeta:{threadId:"fixture"}},currentTurnId:"active",turns:[{id:"active",status:"started"}]}),steerCodexAppServerAgent:async(_o:any,hook?:()=>void)=>{hook?.();sink();},interruptCodexAppServerAgent:async(_o:any,hook?:()=>void)=>{hook?.();sink();}}:{})}));}
 const acpPath=source("packages/runtime/src/acp-agent-invocation.ts"),acp=await import(acpPath);mock.module(acpPath,()=>({...acp,shutdownAcpAgentSession:async(_o:any,hook?:()=>void)=>{if(target==="restart"){entered=true;await pause;}hook?.();sink();}}));
 const local=await import(source("packages/runtime/src/local-agents.ts"));run=()=>target==="restart"?local.restartLocalAgent(agentId,{beforeEffect:admit}):kind==="deck"?(target==="steer"?local.steerCodexDeckTurn(agentId,"fixture",admit):local.interruptCodexDeckTurn(agentId,admit)):target==="interrupt"?local.interruptLocalAgent(agentId,admit):local.stopLocalAgent(agentId,admit);
}else if(kind==="codex"){
 const rollout=join(home,"rollout.jsonl");writeFileSync(rollout,"");
 let commandRunning=false;const path=source("packages/agent-sessions/src/local/transports/codex-app-server-connection.ts"),actual=await import(path);
 mock.module(path,()=>({...actual,spawnCodexAppServerStdioConnection:(input:any)=>{input.beforeEffect?.();let open=true;return {mode:"spawned",pid:null,socketPath:null,isOpen:()=>open,setReadingPaused(){},detach(){},async close(){open=false;},send(text:string){if(commandRunning&&state==="accepted"){sink();entered=true;void pause.then(()=>{assert(afterAck);ownerReadsAfterAck++;const q=JSON.parse(text);input.handlers.onMessage(JSON.stringify({id:q.id,result:{}}));});return;}const q=JSON.parse(text);if(q.method==="turn/steer"||q.method==="turn/interrupt")sink();if(!q.id)return;const result=q.method==="thread/start"?{thread:{id:"fixture-thread",path:rollout}}:q.method==="turn/start"?{turn:{id:"fixture-turn"}}:{};const respond=()=>input.handlers.onMessage(JSON.stringify({id:q.id,result}));if((q.method==="turn/steer"||q.method==="turn/interrupt")&&state==="accepted"){entered=true;void pause.then(respond);}else queueMicrotask(respond);}};}}));
 const options={agentName:"fixture",sessionId:"fixture-session",cwd:project,systemPrompt:"fixture",runtimeDirectory:join(home,"runtime"),logsDirectory:join(home,"logs"),launchArgs:[]},runtime=await import(source("packages/runtime/src/codex-app-server.ts"));
 await runtime.startCodexAppServerAgent({...options,prompt:"earlier trusted start"});
 const {getOrCreateCodexAppServerClient}=await import(source("packages/agent-sessions/src/local/transports/codex-app-server.ts")),client=getOrCreateCodexAppServerClient(options),transport=(client as any).transport,ensure=transport.ensureOnline.bind(transport);
 if(state!=="accepted")transport.ensureOnline=async(...args:any[])=>{const value=await ensure(...args);entered=true;await pause;return value;};
 run=()=>{commandRunning=true;return target==="steer"?runtime.steerCodexAppServerAgent({...options,prompt:"fixture"},admit):runtime.interruptCodexAppServerAgent(options,admit);};cleanup=()=>runtime.shutdownCodexAppServerAgent(options);
}else if(kind==="residue"){
 // The remaining harness-reply producer is a genuine phone RPC. Its broker
 // submission happens after ACK; the owned runtime then performs the command.
 process.env.OPENSCOUT_CODEX_HOME_SOURCE=join(home,"codex");
 const rollout=join(home,"rollout.jsonl");writeFileSync(rollout,"");
 const path=source("packages/agent-sessions/src/local/transports/codex-app-server-connection.ts"),actual=await import(path);
 mock.module(path,()=>({...actual,spawnCodexAppServerStdioConnection:(input:any)=>{assert(afterAck);return {mode:"spawned",pid:null,socketPath:null,isOpen:()=>true,setReadingPaused(){},detach(){},async close(){},send(text:string){const q=JSON.parse(text);if(q.method==="turn/start")sink();if(!q.id)return;const result=q.method==="thread/start"?{thread:{id:"fixture-thread",path:rollout}}:q.method==="turn/start"?{turn:{id:"fixture-turn"}}:{};queueMicrotask(()=>{input.handlers.onMessage(JSON.stringify({id:q.id,result}));if(q.method==="turn/start")queueMicrotask(()=>{input.handlers.onMessage(JSON.stringify({method:"item/completed",params:{threadId:"fixture-thread",turnId:"fixture-turn",item:{type:"agentMessage",id:"fixture-message",text:"fixture reply"}}}));input.handlers.onMessage(JSON.stringify({method:"turn/completed",params:{threadId:"fixture-thread",turn:{id:"fixture-turn",status:"completed"}}}));});});}};}}));
 const {invokeLocalAgentEndpoint}=await import(source("packages/runtime/src/local-agents.ts"));
 fixtureRuntime.setHandler(async request=>{const p=new URL(request.url).pathname;
  if(p==="/health")return Response.json({ok:true,nodeId:"fixture",meshId:"fixture"});
  if(p==="/v1/node")return Response.json({id:"fixture",capabilities:["session-input-receipts/1"]});
  if(p==="/v1/snapshot"){entered=true;await pause;return Response.json({actors:{},agents:{},endpoints:{},conversations:{},messages:{},flights:{}});}
  assert.equal(request.method,"POST");const body:any=await request.json();assert(!Object.hasOwn(body,"beforeEffect"));assert(afterAck);
  if(p==="/v1/deliver")await invokeLocalAgentEndpoint({id:"fixture-endpoint",agentId:"fixture",nodeId:"fixture",harness:"codex",transport:"codex_app_server",state:"idle",cwd:project,projectRoot:project,metadata:{}} as any,{...body,id:"fixture-invocation",targetAgentId:"fixture",requesterId:"operator",conversationId:"fixture-conversation",task:"fixture reply"} as any);
  return Response.json(p==="/v1/deliver"?{kind:"delivery",conversation:{id:"fixture-conversation"},message:{id:"fixture-message"},flight:{id:"fixture-flight"}}:{ok:true});
 });
 const {bridgeRouter}=await import(source("packages/web/server/core/pairing/runtime/bridge/router.ts"));run=()=>bridgeRouter.createCaller({...peer.ctx,cwd:project}).mobile.askSession({sessionId:"fixture-session",harness:"codex",cwd:project,body:"fixture reply",clientMessageId:"fixture-reply"});
 const {shutdownCodexAppServerAgent}=await import(source("packages/runtime/src/codex-app-server.ts"));const {buildCodexEndpointSessionOptions}=await import(source("packages/runtime/src/local-agents.ts"));cleanup=()=>shutdownCodexAppServerAgent(buildCodexEndpointSessionOptions({id:"fixture-endpoint",agentId:"fixture",nodeId:"fixture",harness:"codex",transport:"codex_app_server",state:"idle",cwd:project,projectRoot:project,metadata:{}} as any));
}else if(kind==="pool"){
 const path=source("packages/agent-sessions/src/local/index.ts"),actual=await import(path);
 mock.module(path,()=>({...actual,createLocalAgentClient:async()=>{entered=true;await pause;return {turn:async()=>({text:"earlier host invocation",session:{nativeId:"fixture"}}),close:async()=>sink()};}}));
 const acp=await import(source("packages/runtime/src/acp-agent-invocation.ts")),options={adapterType:"kimi-acp",label:"fixture",sessionId:"fixture",cwd:project,prompt:"earlier host invocation"};
 const earlier=acp.invokeAcpAgent(options);void earlier.catch(()=>{});
 run=()=>acp.shutdownAcpAgentSession(options,admit);cleanup=async()=>{await earlier;await acp.shutdownAllAcpAgentSessions();};
}else{
 assert.equal(kind,"acp");const child:any=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.killed=false;child.exitCode=null;child.kill=()=>{child.killed=true;return true;};
 let adapter:any,holdingPrompt=false;const methods:string[]=[];let heldReply:(()=>void)|undefined;
 child.stdin=new Writable({write(chunk,_encoding,done){if(holdingPrompt&&state==="accepted"){holdingPrompt=false;sink();entered=true;void pause.then(()=>{assert(afterAck);ownerReadsAfterAck++;const q=JSON.parse(String(chunk));child.stdout.write(JSON.stringify({jsonrpc:"2.0",id:q.id,result:{stopReason:"end_turn"}})+"\n");});done();return;}const q=JSON.parse(String(chunk));methods.push(q.method);if((target==="prompt"&&q.method==="session/prompt")||(afterAck&&q.method!=="session/close"))sink();const result=q.method==="initialize"?{protocolVersion:1,agentCapabilities:{loadSession:true,sessionCapabilities:{resume:true}},authMethods:[{id:"fixture",name:"fixture"}]}:q.method==="session/prompt"?{stopReason:"end_turn"}:q.method.startsWith("session/")?{sessionId:"provider-fixture"}:{};
 const rejected=(target.startsWith("recovery/")&&q.method==="session/resume")||(target==="recovery/new"&&q.method==="session/load");
 const respond=()=>child.stdout.write(JSON.stringify({jsonrpc:"2.0",id:q.id,...(rejected?{error:{code:-32000,message:"fixture recovery rejection"}}:{result})})+"\n");
 if(target==="prompt"&&q.method==="session/prompt"&&state==="accepted"){entered=true;void pause.then(respond);done();return;}
 const predecessor=target==="prompt"?null:target==="recovery/load"?"session/resume":target==="recovery/new"?"session/load":target==="initialize"?null:target==="authenticate"?"initialize":target==="session/set_model"?"session/new":"authenticate";
 if(q.method===predecessor&&!entered){entered=true;heldReply=respond;void pause.then(respond);}else queueMicrotask(respond);done();}});
 mock.module("node:child_process",()=>({...cp,spawn:()=>{if(afterAck)sink();if(target==="initialize"&&!entered){entered=true; // Spawn has been accepted; the initialize write must still be admitted after this seam.
 // Defer initialization by instrumenting the adapter request, below.
 }return child;}}));
 const {AcpAdapter}=await import(source("packages/agent-sessions/src/adapters/acp/adapter.ts"));
 if(target==="initialize"){const start=(AcpAdapter.prototype as any).startProcess;(AcpAdapter.prototype as any).startProcess=async function(...args:any[]){entered=true;await pause;return start.apply(this,args);};}
 const root=flavor==="web"?"packages/web/server/core":"apps/desktop/src/core",{Bridge}=await import(source(root+"/pairing/runtime/bridge/bridge.ts"));
 const sessionMode=target.startsWith("recovery/")?"auto":target==="session/resume"?"resume":target==="session/load"?"load":"new";
 const actualBridge=new Bridge({adapters:{fixture:(config:any)=>(adapter=new AcpAdapter({...config,options:{command:"fixture-never-executed",args:[],adapterType:"grok-acp",requireAuth:true,authMethodId:"fixture",sessionMode,sessionId:"provider-fixture",...(target==="session/set_model"?{model:"fixture-model"}:{})}}))}});
 Object.assign(bridge,actualBridge);Object.setPrototypeOf(bridge,Bridge.prototype);
 const {bridgeRouter}=await import(source(root+"/pairing/runtime/bridge/router.ts"));
 run=async()=>{
  const caller=bridgeRouter.createCaller(peer.ctx);
  const session=await caller.session.create({adapterType:"fixture",cwd:project});
  if(target!=="prompt")return session;
  if(state!=="accepted")adapter.promptQueue=pause;
  holdingPrompt=true;
  const submitted=protocol==="trpc"?caller.prompt.send({sessionId:session.id,text:"fixture prompt"}):(await import(source(root+"/pairing/runtime/bridge/server.ts"))).handleRPC(bridge,{id:"prompt-fixture",method:"prompt/send",params:{sessionId:session.id,text:"fixture prompt"}},peer.ctx);
  await submitted;
  if(state!=="accepted")entered=true;
  return await adapter.promptQueue;
 };
 siblingRun=otherPeer?async()=>{
  assert.throws(()=>requireTransportContext(otherPeer.ctx,true),/Unauthorized|live authenticated/i);
  const fresh=liveTransport(domain,otherPhone);assert.equal(requireTransportContext(fresh.ctx,true).publicKey,otherKey);
  const session=bridge.listSessions()[0];assert(session);
  assert.equal(bridge.getSessionSnapshot(session.id)?.session.status,"idle","refused phone must not mark the shared provider failed");
  const before=effects;const receipt=await bridgeRouter.createCaller(fresh.ctx).prompt.send({sessionId:session.id,text:"healthy sibling"});await adapter.promptQueue;
  assert.equal(receipt.ok,true);assert.equal(effects,before+1,"another paired phone can reconnect and submit its own command");
  console.log("STAGE5_SIBLING "+JSON.stringify({protocol,live:true,submissions:effects-before,providerState:bridge.getSessionSnapshot(session.id)?.session.status}));
 }:undefined;
 cleanup=()=>actualBridge.shutdown();
}
let operation:Promise<unknown>|undefined;
try{
 let settled=false;operation=Promise.resolve(run()).catch(error=>error);operation.then(()=>{settled=true;});
 const until=performance.now()+15_000;while(!entered){if(settled)throw Error("operation settled before seam: "+String(await operation));if(performance.now()>until)throw Error("pause not reached");await Bun.sleep(1);}
 if(state!=="live"){fixture.owner.mutate(fixture.owner.read().revision,crypto.randomUUID(),{type:"revoke",publicKey:key});assert.throws(()=>requireTransportContext(peer.ctx,true));afterAck=true;}release();const result=await operation;
 console.log("STAGE5_EFFECT "+JSON.stringify({kind,target,state,flavor,protocol,effects,late,ownerReadsAfterAck,admissions,nativeExecutions:0,result:String(result)}));
 if(kind==="scope"){assert(!(result instanceof Error),String(result));assert.equal(effects,0);}
 else if(kind==="refusal"){assert.equal(result,oneShot,"ordinary I/O handling must preserve the original one-shot refusal");assert.equal(effects,0);}
 else if(kind==="residue"){assert.equal(effects,1);assert.equal(late,1,"remaining harness-reply producer reaches runtime command after ACK");}
 else if(state==="accepted"){assert.equal(effects,1);assert.equal(ownerReadsAfterAck,1,"fixture owner first reads the accepted command after ACK");assert.equal(late,0,"queued receiver reads are earlier work");assert(!(result instanceof Error));}
 else if(state==="live"){if(kind!=="acp")assert.equal(effects,1);assert(!(result instanceof Error),String(result));}
 else{assert.equal(late,0,"no command submission after revoke ACK");assert.equal(effects,0,"no resumed command effect after revoke ACK");assert.match(String(result),/Unauthorized|live authenticated/i,"authority refusal must propagate");}
 if(siblingRun)await siblingRun();
}finally{release();if(operation)await operation;await cleanup();domain.dispose();await fixtureRuntime.close();}
