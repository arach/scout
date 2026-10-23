import {mock} from "bun:test";
/** Real exported handlers + real session owner. The adapter is an effect sink;
 * metadata discovery is a separate bounded process, paused by an explicit file. */
import assert from "node:assert/strict";
import {existsSync,writeFileSync,mkdirSync,realpathSync} from "node:fs";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {capsuleFixture} from "./fixtures/pairing-capsule.ts";
import {fixtureHost,liveTransport,generateKeyPair} from "./fixtures/live-transport.ts";
import {bytesToHex} from "../packages/runtime/src/pairing-security/identity.ts";
import {TransportDomain, requireTransportContext} from "../packages/runtime/src/pairing-security/transport.ts";
const [flavor,scenario] = process.argv.slice(2);
const root=realpathSync(process.env.OPENSCOUT_PAIRING_HOME!);
const base=resolve(flavor === "web" ? "packages/web/server/core/pairing/runtime/bridge" : "apps/desktop/src/core/pairing/runtime/bridge");
// Test-only subject injection for a paired shared-session-owner control.
if (process.argv[4]) {
 const actual=await import(Bun.resolveSync("@openscout/agent-sessions",base));
 const subject=await import(pathToFileURL(process.argv[4]).href);
 mock.module("@openscout/agent-sessions",()=>({...actual,SessionRegistry:subject.SessionRegistry}));
}
const {Bridge} = await import(pathToFileURL(join(base,"bridge.ts")).href);
const {bridgeRouter} = await import(pathToFileURL(join(base,"router.ts")).href);
const {handleRPC} = await import(pathToFileURL(join(base,"server.ts")).href);
const {callTRPCProcedure} = await import(Bun.resolveSync("@trpc/server",base));
let factories=0, starts=0;
const bridge=new Bridge({adapters:{probe:(config:any)=>{
  factories++;
  const session={id:config.sessionId,name:"probe",adapterType:"probe",status:"active",cwd:config.cwd};
  return {type:"probe",session,on(){},off(){},async start(){starts++;},async shutdown(){},send(){},interrupt(){}};
}}});
const host=generateKeyPair(),phone=generateKeyPair(),key=bytesToHex(phone.publicKey);
const f=capsuleFixture(root,{generations:2,keys:1,publicKeys:[key],migrate:true});
const domain=new TransportDomain(bridge,bytesToHex(host.publicKey),f.owner);fixtureHost(domain,host);
const peer=liveTransport(domain,phone);
const ctx={...peer.ctx,cwd:root};
const revoke=()=>f.owner.mutate(f.owner.read().revision,crypto.randomUUID(),{type:"revoke",publicKey:key});
const wait=async(check:()=>boolean)=>{const until=performance.now()+20_000;while(!check()){if(performance.now()>until)throw Error("fixture pause not reached");await Bun.sleep(5);}};
let refused=false;
try {
 if(scenario==="forge") {
  const fake={bridge,cwd:root,secureTransport:true,trustedPeer:true,deviceId:key};
  const rpc=await handleRPC(bridge,{id:"forge",method:"session/create",params:{adapterType:"probe",cwd:root}},fake);
  assert(rpc.error);
  await assert.rejects(bridgeRouter.createCaller(fake).session.create({adapterType:"probe",cwd:root}));
  assert.equal(factories,0);assert.equal(starts,0);refused=true;
 } else if(scenario==="parser") {
  let entered=false, release!:()=>void;
  const paused=new Promise<void>(r=>{release=r;});
  const pending=callTRPCProcedure({router:bridgeRouter,path:"session.create",type:"mutation",ctx,
    getRawInput:async()=>{entered=true;await paused;return {adapterType:"probe",cwd:root};},signal:undefined,batchIndex:0});
  const result=pending.catch((e:any)=>e);
  await wait(()=>entered);revoke();release();
  const response=await result;refused=response instanceof Error;
  assert.equal(factories,0);assert.equal(starts,0);assert(refused,"parser continuation must re-admit");
 } else {
  const bin=join(root,"fake-bin");mkdirSync(bin);
  const entered=join(root,"git-entered"),release=join(root,"git-release");
  writeFileSync(join(bin,"git"),`#!${process.execPath}\nimport {existsSync,writeFileSync} from 'node:fs';\nwriteFileSync(${JSON.stringify(entered)},'entered');\nconst timer=setTimeout(()=>process.exit(79),20000);\nwhile(!existsSync(${JSON.stringify(release)}))await Bun.sleep(2);\nclearTimeout(timer);console.log('effect-fence');\n`,{mode:0o755});
  const path=process.env.PATH;process.env.PATH=bin;
  const pending=scenario==="legacy"?handleRPC(bridge,{id:"create",method:"session/create",params:{adapterType:"probe",cwd:root}},peer.ctx)
    :bridgeRouter.createCaller(ctx).session.create({adapterType:"probe",cwd:root});
  const outcome=pending.catch((e:any)=>e);
  try {await wait(()=>existsSync(entered));assert.equal(factories,0);revoke();}
  finally {writeFileSync(release,"release");process.env.PATH=path;}
  const result=await outcome;refused=result instanceof Error || Boolean(result?.error);
  console.log("EFFECT_AFTER "+JSON.stringify({flavor,scenario,refused,factories,starts}));
  assert.equal(factories,0,"stale resumed creation must not construct adapter");
  assert.equal(starts,0);assert(refused);
 }
 assert.throws(()=>requireTransportContext({...peer.ctx,bridge:{}}));
 console.log("EFFECT_OBSERVATION "+JSON.stringify({flavor,scenario,refused,factories,starts}));
}finally{domain.dispose();await bridge.shutdown();}
