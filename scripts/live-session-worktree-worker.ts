/** Actual exported mobile resolver, mobile service and shared workspace owner.
 * Only command/agent effect sinks and the asynchronous directory boundary are
 * instrumented. No agent, broker, worktree command or shared suite is started. */
import {mock} from "bun:test";
import assert from "node:assert/strict";
import {mkdirSync,realpathSync} from "node:fs";
import * as promises from "node:fs/promises";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {capsuleFixture} from "./fixtures/pairing-capsule.ts";
import {fixtureHost,liveTransport,generateKeyPair} from "./fixtures/live-transport.ts";
import {bytesToHex} from "../packages/runtime/src/pairing-security/identity.ts";
import {TransportDomain} from "../packages/runtime/src/pairing-security/transport.ts";

const [flavor,stage,subject,serviceSubject,routerSubject,protocol="trpc",serverSubject] = process.argv.slice(2);
assert(["web","desktop"].includes(flavor!));assert(["discovery","directory","retry"].includes(stage!));
const base=resolve(flavor==="web"?"packages/web/server/core":"apps/desktop/src/core");
const project=join(process.env.HOME!,"worktree-project");mkdirSync(project);
let entered=false,release!:()=>void,revoked=false,lateMutations=0,lateDirectories=0,earlyMutations=0,agentStarts=0;
const pause=new Promise<void>(r=>{release=r;});
const wait=async()=>{const end=performance.now()+20_000;while(!entered){if(performance.now()>end)throw Error("worktree pause not reached");await Bun.sleep(2);}};
const execUrl=pathToFileURL(resolve("packages/runtime/src/system-probes/exec.ts")).href;
const exec=await import(execUrl);
mock.module(execUrl,()=>({...exec,execSystemFile:async(_file:string,args:string[])=>{
  if(args[0]==="rev-parse"){
    if(stage==="discovery"){entered=true;await pause;}
    return {stdout:".git",stderr:"",exitCode:0};
  }
  assert.equal(args[0],"worktree");
  if(revoked)lateMutations++;else earlyMutations++;
  if(stage==="retry"&&earlyMutations===1&&!revoked){entered=true;await pause;}
  throw Error("instrumented git failure");
}}));
const realMkdir=promises.mkdir;
mock.module("node:fs/promises",()=>({...promises,mkdir:async(...args:Parameters<typeof promises.mkdir>)=>{
  if(revoked)lateDirectories++;
  const result=await (realMkdir as any)(...args);
  if(stage==="directory"){entered=true;await pause;}
  return result;
}}));
const agentUrl=pathToFileURL(flavor==="web"?join(base,"agents/service.ts"):resolve("packages/cli/src/lib/core/agents/service.ts")).href;
const agents=await import(agentUrl);
mock.module(agentUrl,()=>({...agents,upScoutAgent:async()=>{agentStarts++;throw Error("instrumented agent boundary");}}));
if(subject){
  const workspace=await import(pathToFileURL(subject).href);
  mock.module("@openscout/runtime/agent-workspace",()=>workspace);
}
if(serviceSubject){
  const service=await import(pathToFileURL(serviceSubject).href);
  mock.module(pathToFileURL(join(base,"mobile/service.ts")).href,()=>service);
}
const {bridgeRouter}=await import(pathToFileURL(routerSubject||join(base,"pairing/runtime/bridge/router.ts")).href);
const {handleRPC}=await import(pathToFileURL(serverSubject||join(base,"pairing/runtime/bridge/server.ts")).href);
const host=generateKeyPair(),phone=generateKeyPair(),key=bytesToHex(phone.publicKey),bridge={};
const fixture=capsuleFixture(realpathSync(process.env.OPENSCOUT_PAIRING_HOME!),{generations:2,keys:1,publicKeys:[key],migrate:true});
const domain=new TransportDomain(bridge,bytesToHex(host.publicKey),fixture.owner);fixtureHost(domain,host);
const peer=liveTransport(domain,phone),ctx={...peer.ctx,cwd:project,deviceId:key.slice(0,16)};
try{
  const input={workspaceId:project,worktree:"isolated",branch:"test"};
  const outcome=(protocol==="legacy"?handleRPC(bridge,{id:"worktree",method:"mobile/session/create",params:input},ctx):
    bridgeRouter.createCaller(ctx).mobile.createSession(input)).catch((e:unknown)=>e);
  await wait();
  assert.equal(lateMutations,0);assert.equal(lateDirectories,0);assert.equal(agentStarts,0);
  fixture.owner.mutate(fixture.owner.read().revision,crypto.randomUUID(),{type:"revoke",publicKey:key});revoked=true;release();
  const result=await outcome;
  const message=result instanceof Error?result.message:(result as any)?.error?.message;
  console.log("WORKTREE_EFFECT "+JSON.stringify({flavor,stage,protocol,lateMutations,lateDirectories,earlyMutations,agentStarts,refused:typeof message==="string"}));
  assert.equal(lateDirectories,0,"no resumed directory creation after revoke ACK");
  assert.equal(lateMutations,0,"no resumed git mutation after revoke ACK");
  assert.equal(agentStarts,0,"refusal must not fall through to agent launch");
  assert.equal(typeof message,"string","revoked operation must refuse");
  assert.match(message,/Unauthorized|live authenticated/i,"must be authority refusal, not instrument failure");
}finally{release();domain.dispose();}
