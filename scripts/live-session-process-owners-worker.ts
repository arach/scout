/** Real bound context; dependency and native sinks are isolated to this child. */
import {fixtureRuntime} from "./fixtures/process-runtime-isolation.ts";
import {mock} from "bun:test";
import assert from "node:assert/strict";
import {mkdirSync,writeFileSync,realpathSync} from "node:fs";
import * as fs from "node:fs/promises";
import * as childProcess from "node:child_process";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {capsuleFixture} from "./fixtures/pairing-capsule.ts";
import {fixtureHost,liveTransport,generateKeyPair} from "./fixtures/live-transport.ts";
import {bytesToHex} from "../packages/runtime/src/pairing-security/identity.ts";
import {TransportDomain,requireTransportContext} from "../packages/runtime/src/pairing-security/transport.ts";
await fixtureRuntime.probe();
const [kind,target,state,flavor="web"]=process.argv.slice(2),home=process.env.HOME!;
assert(["router","engine","codex-turn"].includes(kind!));assert(["live","revoke","trusted-join"].includes(state!));
process.env.OPENSCOUT_BUN_BIN=process.execPath;process.env.OPENSCOUT_PROBES_SOCKET=join(home,"absent.sock");process.env.OPENSCOUT_PI_SCOUT_EXTENSION="0";
const runtime=join(home,"runtime"),logs=join(home,"logs"),project=join(home,"project"),bin=join(home,"bin");mkdirSync(project);mkdirSync(bin);writeFileSync(join(bin,"claude"),"fixture only",{mode:0o700});process.env.PATH=bin;
const host=generateKeyPair(),phone=generateKeyPair(),key=bytesToHex(phone.publicKey),fixture=capsuleFixture(realpathSync(process.env.OPENSCOUT_PAIRING_HOME!),{generations:2,keys:1,publicKeys:[key],migrate:true}),bridge={};
const domain=new TransportDomain(bridge,bytesToHex(host.publicKey),fixture.owner);fixtureHost(domain,host);const peer=liveTransport(domain,phone);assert.equal(requireTransportContext(peer.ctx,true).publicKey,key);console.log("A2_OWNER_FIXTURE_READY real-noise");
let entered=false,revoked=false,effects=0,lateMutations=0,admissions=0,release!:()=>void;const pause=new Promise<void>(r=>release=r);const admission=()=>{admissions++;requireTransportContext(peer.ctx,true);};const sink=Error("fixture native launch submission observed");
const source=(path:string)=>pathToFileURL(resolve(path)).href;
let cleanup:(()=>Promise<void>)|undefined,acceptedTracking:(()=>boolean)|undefined;
let run!:()=>Promise<unknown>,joiner:(()=>Promise<unknown>)|undefined;
if(kind==="router"){
 const path=source("packages/runtime/src/local-agents.ts"),actual=await import(path);
 const effect=async(hook?:()=>void)=>{entered=true;await pause;hook?.();effects++;return {threadId:"fixture-thread",project:"fixture",cwd:project};};
 mock.module(path,()=>({...actual,getLocalAgentConfig:async()=>({runtime:{transport:"codex_app_server"}}),getCodexDeckThreadSnapshot:async()=>null,isCodexDeckThreadConnected:async()=>false,
  restartLocalAgent:async(_id:string,options?:{beforeEffect?:()=>void})=>effect(options?.beforeEffect),connectCodexDeckThread:async(_id:string,hook?:()=>void)=>effect(hook),startCodexDeckTurn:async(_id:string,_text:string,hook?:()=>void)=>effect(hook)}));
 const root=flavor==="web"?"packages/web/server/core":"apps/desktop/src/core";
 const {bridgeRouter}=await import(source(root+"/pairing/runtime/bridge/router.ts"));const caller=bridgeRouter.createCaller(peer.ctx);
 run=()=>target==="restart"?caller.mobile.agentRestart({agentId:"fixture"}):target==="connect"?caller.codexDeck.connect({agentId:"fixture"}):caller.codexDeck.start({agentId:"fixture",text:"fixture"});
}else if(kind==="codex-turn"){
 const rollout=join(home,"rollout.jsonl");writeFileSync(rollout,"");
 const connectionPath=source("packages/agent-sessions/src/local/transports/codex-app-server-connection.ts"),connection=await import(connectionPath);
 mock.module(connectionPath,()=>({...connection,spawnCodexAppServerStdioConnection:(input:any)=>{input.beforeEffect?.();let open=true;return {mode:"spawned",pid:null,socketPath:null,isOpen:()=>open,setReadingPaused(){},detach(){},async close(){open=false;},send(text:string){
  const request=JSON.parse(text);if(request.method==="turn/start")effects++;
  if(!request.id)return;
  const result=request.method==="thread/start"?{thread:{id:"fixture-thread",path:rollout}}:request.method==="turn/start"?{turn:{id:"fixture-turn"}}:{userAgent:"fixture"};
  const respond=()=>input.handlers.onMessage(JSON.stringify({id:request.id,result}));
  if(request.method==="turn/start"&&target==="accepted"){entered=true;void pause.then(respond);}else queueMicrotask(respond);
 }};}}));
 const options={agentName:"fixture",sessionId:"fixture-session",cwd:project,systemPrompt:"fixture",runtimeDirectory:runtime,logsDirectory:logs,launchArgs:[]};
 const {ensureCodexAppServerAgentOnline,startCodexAppServerAgent,shutdownCodexAppServerAgent}=await import(source("packages/runtime/src/codex-app-server.ts"));
 await ensureCodexAppServerAgentOnline(options); // earlier trusted startup, no turn submitted
 const {getOrCreateCodexAppServerClient}=await import(source("packages/agent-sessions/src/local/transports/codex-app-server.ts"));
 const client=getOrCreateCodexAppServerClient(options),transport=(client as any).transport,ensure=transport.ensureOnline.bind(transport);
 if(target!=="accepted")transport.ensureOnline=async(...args:any[])=>{const result=await ensure(...args);entered=true;await pause;return result;};
 run=()=>startCodexAppServerAgent({...options,prompt:"fixture"},admission);
 cleanup=()=>shutdownCodexAppServerAgent(options);acceptedTracking=()=>client.hasActiveTurn();
}else{
 const mkdir=fs.mkdir;
 mock.module("node:fs/promises",()=>({...fs,mkdir:async(...args:Parameters<typeof fs.mkdir>)=>{const p=String(args[0]);assert(p.startsWith(home+"/"));if(revoked)lateMutations++;const value=await (mkdir as any)(...args);if(p===runtime&&!entered){entered=true;await pause;}return value;}}));
 const options={agentName:"fixture",sessionId:"fixture-session",cwd:project,systemPrompt:"fixture",runtimeDirectory:runtime,logsDirectory:logs,launchArgs:[]};
 if(target==="codex"){
  const connectionPath=source("packages/agent-sessions/src/local/transports/codex-app-server-connection.ts"),connection=await import(connectionPath);
  mock.module(connectionPath,()=>({...connection,spawnCodexAppServerStdioConnection:(input:any)=>{input.beforeEffect?.();effects++;throw sink;}}));
  const {ensureCodexAppServerAgentOnline}=await import(source("packages/runtime/src/codex-app-server.ts"));
  run=()=>ensureCodexAppServerAgentOnline(options,admission);joiner=()=>ensureCodexAppServerAgentOnline(options);
 }else if(target==="claude"){
  mock.module("node:child_process",()=>({...childProcess,spawn:()=>{effects++;throw sink;}}));
  const {connectClaudeDeck}=await import(source("packages/runtime/src/claude-stream-json.ts"));run=()=>connectClaudeDeck(options,admission);
 }else{
  assert.equal(target,"pi");const processPath=source("packages/agent-sessions/src/runtime/process.ts"),processModule=await import(processPath);
  mock.module(processPath,()=>({...processModule,spawnHarnessProcess:async(_command:string,_args:unknown,input:any)=>{input.beforeEffect?.();effects++;throw sink;}}));
  const {ensurePiRpcAgentOnline}=await import(source("packages/runtime/src/pi-rpc.ts"));run=()=>ensurePiRpcAgentOnline(options,admission);
 }
}
let operation:Promise<unknown>|undefined,joined:Promise<unknown>|undefined;
try{
 let settled=false;operation=Promise.resolve(run()).catch(error=>error);operation.then(()=>{settled=true;});
 const until=performance.now()+15_000;while(!entered){if(settled)throw Error("owner settled before pause: "+String(await operation));if(performance.now()>until)throw Error("owner pause not reached");await Bun.sleep(1);}
 if(state==="trusted-join"){assert(joiner);joined=joiner!().catch(error=>error);await Bun.sleep(20);}
 if(state!=="live"){fixture.owner.mutate(fixture.owner.read().revision,crypto.randomUUID(),{type:"revoke",publicKey:key});assert.throws(()=>requireTransportContext(peer.ctx,true));revoked=true;}
 release();const result=await operation;if(joined)await joined;
 console.log("A2_OWNER_EFFECT "+JSON.stringify({kind,target,state,flavor,revoked,effects,lateMutations,admissions,nativeExecutions:0,result:String(result)}));
 if(state==="live"){assert.equal(effects,1);if(kind==="engine")assert.match(String(result),/fixture native launch submission observed/);}
 else if(kind==="codex-turn"&&target==="accepted"){assert.equal(effects,1,"accepted native input remains earlier work");assert(acceptedTracking!(),"accepted turn tracking must survive a later revoke ACK");assert.equal((result as any).threadId,"fixture-thread");}
 else{assert.equal(effects,state==="trusted-join"?1:0);if(state!=="trusted-join")assert.equal(lateMutations,0);assert.match(String(result),/Unauthorized|live authenticated/i);}
}finally{release();if(operation)await operation;if(joined)await joined;if(cleanup)await cleanup();domain.dispose();await fixtureRuntime.close();}
