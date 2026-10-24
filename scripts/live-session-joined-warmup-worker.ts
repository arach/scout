/** Real protected mobile startup sharing a flight with other callers.
 * AsyncLocalStorage attributes each actual filesystem submission to its caller.
 * The admission observer calls the real helper unchanged; it supplies no grant. */
import {mock} from "bun:test";
import assert from "node:assert/strict";
import {AsyncLocalStorage} from "node:async_hooks";
import {mkdirSync,realpathSync,readFileSync,writeFileSync} from "node:fs";
import * as fs from "node:fs/promises";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {capsuleFixture} from "./fixtures/pairing-capsule.ts";
import {fixtureHost,liveTransport,generateKeyPair} from "./fixtures/live-transport.ts";
import {bytesToHex} from "../packages/runtime/src/pairing-security/identity.ts";
import {TransportDomain,requireTransportContext} from "../packages/runtime/src/pairing-security/transport.ts";
const [flavor,protocol,stage,configPath]=process.argv.slice(2);
assert(["web","desktop"].includes(flavor!));assert(["legacy","trpc"].includes(protocol!));
assert(["revoke-one","revoke-two","protected-live","ordinary-error"].includes(stage!));
const config=configPath?JSON.parse(readFileSync(configPath,"utf8")):{};
const base=resolve(flavor==="web"?"packages/web/server/core":"apps/desktop/src/core"),home=process.env.HOME!;
const project=join(home,"agent-project"),support=process.env.OPENSCOUT_SUPPORT_DIRECTORY!,registry=join(support,"relay-agents.json");mkdirSync(project);
const bin=join(home,"bin");mkdirSync(bin);writeFileSync(join(bin,"grok"),"non-executable lazy ACP fixture\n");process.env.PATH=bin;
const actors=new AsyncLocalStorage<string>();let entered=false,revoked=false,joining=false,joinedEntries=0,protectedReads=0,registryWrites=0,protectedLateMutations=0,trustedPublications=0,livePublications=0,bindings=0;
let release:()=>void=()=>{};const gate=new Promise<void>(r=>{release=r;});const seen:{actor:string;kind:string;path:string;afterAck:boolean}[]=[];
function mutation(kind:string,path:unknown){const p=String(path),actor=actors.getStore()??"fixture";assert(p.startsWith(home+"/"));seen.push({actor,kind,path:p.slice(home.length),afterAck:revoked});if(actor==="protected"&&revoked)protectedLateMutations++;if(actor.startsWith("trusted-")&&kind==="write"&&p===registry)trustedPublications++;if(actor==="live-phone"&&kind==="write"&&p===registry&&revoked)livePublications++;}
const read=fs.readFile,mkdir=fs.mkdir,write=fs.writeFile;
mock.module("node:fs/promises",()=>({...fs,
 readFile:async(...args:Parameters<typeof fs.readFile>)=>{
  if(actors.getStore()==="protected"&&String(args[0])===registry&&registryWrites===1&&++protectedReads===5){entered=true;await gate;}
  return (read as any)(...args);
 },
 mkdir:async(...args:Parameters<typeof fs.mkdir>)=>{mutation("mkdir",args[0]);if(stage==="ordinary-error"&&entered&&actors.getStore()==="protected"&&String(args[0])===support&&registryWrites===1)throw Object.assign(new Error("ordinary warmup I/O failure"),{code:"EIO"});return (mkdir as any)(...args);},
 writeFile:async(...args:Parameters<typeof fs.writeFile>)=>{mutation("write",args[0]);const value=await (write as any)(...args);if(String(args[0])===registry)registryWrites++;return value;},
}));
const admissionPath=pathToFileURL(resolve("packages/runtime/src/effect-admission.ts")).href;
const {admitSynchronousEffect:actualAdmission}=await import(admissionPath);
mock.module(admissionPath,()=>({admitSynchronousEffect:(hook?:()=>void)=>{actualAdmission(hook);if(joining&&(actors.getStore()?.startsWith("trusted-")&&!hook||actors.getStore()==="live-phone"&&!!hook))joinedEntries++;}}));
if(config.local){const m=await import(pathToFileURL(config.local).href);mock.module(pathToFileURL(resolve("packages/runtime/src/local-agents.ts")).href,()=>m);}
const {loadRegisteredLocalAgentBindings}=await import(pathToFileURL(resolve("packages/runtime/src/local-agents.ts")).href);
const {readRelayAgentOverrides}=await import(pathToFileURL(resolve("packages/runtime/src/setup.ts")).href);
const brokerPath=flavor==="web"?join(base,"broker/service.ts"):resolve("packages/cli/src/lib/core/broker/service.ts");
const broker=await import(pathToFileURL(brokerPath).href);
mock.module(pathToFileURL(brokerPath).href,()=>({...broker,registerScoutLocalAgentBinding:async()=>{bindings++;return null;},loadScoutBrokerContext:async()=>{throw Error("joined warmup witness stops before later broker effects");}}));
const {bridgeRouter}=await import(pathToFileURL(join(base,"pairing/runtime/bridge/router.ts")).href);
const {handleRPC}=await import(pathToFileURL(join(base,"pairing/runtime/bridge/server.ts")).href);
const host=generateKeyPair(),phone=generateKeyPair(),secondPhone=generateKeyPair(),key=bytesToHex(phone.publicKey),secondKey=bytesToHex(secondPhone.publicKey),bridge={};
const fixture=capsuleFixture(realpathSync(process.env.OPENSCOUT_PAIRING_HOME!),{generations:3,keys:2,publicKeys:[key,secondKey],migrate:true});
const domain=new TransportDomain(bridge,bytesToHex(host.publicKey),fixture.owner);fixtureHost(domain,host);const peer=liveTransport(domain,phone);
let outcome:Promise<unknown>|undefined;const trusted:Promise<any>[]=[];
async function until(predicate:()=>boolean,label:string){const end=performance.now()+20_000;while(!predicate()){if(performance.now()>end)throw Error("joined warmup pause not reached: "+label);await Bun.sleep(2);}}
try{
 const ctx={...peer.ctx,cwd:project,deviceId:key.slice(0,16)},input={workspaceId:project,harness:"grok-acp"};
 outcome=actors.run("protected",()=>Promise.resolve(protocol==="legacy"?handleRPC(bridge,{id:"joined-warmup",method:"mobile/session/create",params:input},ctx):bridgeRouter.createCaller(ctx).mobile.createSession(input)).catch((error:unknown)=>error));
 await until(()=>entered,"protected writer");
 const ids=Object.keys(await readRelayAgentOverrides());assert.equal(ids.length,1);const joiners=stage==="revoke-two"?2:1;joining=true;
 // All old paired handles close on a stamp change. Admit the second phone at
 // the new stamp after the ACK, while the first phone's flight is still held.
 if(stage==="protected-live"){
  fixture.owner.mutate(fixture.owner.read().revision,crypto.randomUUID(),{type:"revoke",publicKey:key});revoked=true;
  const second=liveTransport(domain,secondPhone);
  trusted.push(actors.run("live-phone",()=>loadRegisteredLocalAgentBindings("fixture",{agentIds:ids,ensureOnline:true,beforeWarmupEffect:()=>{requireTransportContext(second.ctx);}}).catch((error:unknown)=>({failure:String(error)}))));
 }else for(let i=0;i<joiners;i++)trusted.push(actors.run(`trusted-${i}`,()=>loadRegisteredLocalAgentBindings("fixture",{agentIds:ids,ensureOnline:true}).catch((error:unknown)=>({failure:String(error)}))));
 await until(()=>joinedEntries===joiners,"trusted flight entry");joining=false;
 assert.equal(registryWrites,1,"joiners must await the blocked original flight, not publish independently");
 if(stage!=="ordinary-error"&&stage!=="protected-live"){fixture.owner.mutate(fixture.owner.read().revision,crypto.randomUUID(),{type:"revoke",publicKey:key});revoked=true;}
 release();const result:any=await outcome,joined=await Promise.all(trusted),message=result instanceof Error?result.message:result?.error?.message;
 console.log("JOINED_WARMUP_EFFECT "+JSON.stringify({flavor,protocol,stage,joinedEntries,protectedLateMutations,trustedPublications,livePublications,registryWrites,bindings,joined,message,seen}));
 assert.equal(protectedLateMutations,0,"refused protected caller must publish nothing after revoke ACK");
 assert.equal(bindings,0,"failed protected startup must not register a broker binding");
 if(stage==="protected-live"){
  assert.equal(livePublications,1,"live protected joiner must publish its own warmup after another phone's refusal");
  assert.equal(trustedPublications,0,"protected retry must retain its own hook and actor");
 }
 for(const value of joined){assert(Array.isArray(value)&&value.length===1,"trusted caller must receive one binding");assert.equal(value[0].endpoint.state,"idle","trusted joiner must get its online binding");}
 if(stage==="ordinary-error"){
  assert.equal(trustedPublications,0,"ordinary warmup failures must not be retried as admission refusals");
  assert.match(message,/ordinary warmup I\/O failure/);
 }else if(stage!=="protected-live"){
  assert.equal(trustedPublications,1,"trusted joiners must coalesce their own warmup after another caller's admission refusal");
  assert.match(message,/Unauthorized|live authenticated/i);
 }
}finally{release();if(outcome)await outcome;await Promise.allSettled(trusted);domain.dispose();}
