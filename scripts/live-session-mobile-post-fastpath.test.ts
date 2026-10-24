import {test,expect,afterAll} from "bun:test";
import {mkdtempSync,mkdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {capsuleFixture} from "./fixtures/pairing-capsule.ts";
import {fixtureHost,liveTransport,generateKeyPair} from "./fixtures/live-transport.ts";
import {bytesToHex} from "../packages/runtime/src/pairing-security/identity.ts";
import {TransportDomain,requireTransportContext} from "../packages/runtime/src/pairing-security/transport.ts";

// This non-spawning test owns its complete HTTP boundary; workers use the
// shared child-only isolation module instead.
let httpRequests=0;
const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch(){httpRequests++;return new Response("unexpected fixture HTTP",{status:500});}});
const urls=[process.env.OPENSCOUT_BROKER_URL,process.env.OPENSCOUT_BROKER_INTERNAL_URL],originalFetch=globalThis.fetch;
process.env.OPENSCOUT_BROKER_URL=server.url.href;process.env.OPENSCOUT_BROKER_INTERNAL_URL=server.url.href;
globalThis.fetch=((input:any,options:any)=>{if(new URL(input instanceof Request?input.url:String(input)).origin!==server.url.origin)throw Error("fixture must never contact a shared runtime");return originalFetch(input,options);}) as typeof fetch;
afterAll(async()=>{await server.stop(true);globalThis.fetch=originalFetch;for(const [i,name] of ["OPENSCOUT_BROKER_URL","OPENSCOUT_BROKER_INTERNAL_URL"].entries()){if(urls[i]===undefined)delete process.env[name];else process.env[name]=urls[i];}});
const {registerActiveScoutBrokerService,unregisterActiveScoutBrokerService,maybePostJsonToActiveScoutBrokerService}=await import("../packages/runtime/src/broker-api.ts");
for(const mode of ["live","revoke","io-refusal","async-refusal"])test(`mobile post active broker ${mode}`,async()=>{
 const root=mkdtempSync(join(tmpdir(),"pairing-capsule-mobile-active-")),store=join(root,"pairing-capsule-store");mkdirSync(store);
 const host=generateKeyPair(),phone=generateKeyPair(),key=bytesToHex(phone.publicKey),f=capsuleFixture(store,{generations:2,keys:1,publicKeys:[key],migrate:true}),domain=new TransportDomain({},bytesToHex(host.publicKey),f.owner);fixtureHost(domain,host);const peer=liveTransport(domain,phone);
 let accepted=0;const refusal=Object.assign(Error("fixture admission refusal"),{code:"ECONNREFUSED"}),baseUrl=process.env.OPENSCOUT_BROKER_URL!;
 registerActiveScoutBrokerService({baseUrl,executeCommand:async()=>{accepted++;return {ok:true};}} as any);
 try{
  requireTransportContext(peer.ctx,true);console.log("MOBILE_ACTIVE_READY real-noise");
  if(mode==="revoke")f.owner.mutate(f.owner.read().revision,"active-revoke",{type:"revoke",publicKey:key});
  const beforeEffect=()=>{if(mode==="io-refusal")throw refusal;if(mode==="async-refusal")return Promise.resolve();requireTransportContext(peer.ctx,true);};
  const result=await maybePostJsonToActiveScoutBrokerService(baseUrl,"/v1/actors",{id:"fixture-actor"},{beforeEffect:beforeEffect as ()=>void}).catch(error=>error);
  console.log("MOBILE_ACTIVE_EFFECT "+JSON.stringify({mode,accepted}));expect(httpRequests).toBe(0);expect(accepted).toBe(mode==="live"?1:0);
  if(mode==="revoke")expect(String(result)).toMatch(/Unauthorized|live authenticated/i);
  if(mode==="io-refusal")expect(result).toBe(refusal);
  if(mode==="async-refusal")expect(String(result)).toContain("synchronous effect admission required");
 }finally{unregisterActiveScoutBrokerService(baseUrl);domain.dispose();rmSync(root,{recursive:true,force:true});}
});
for(const mode of ["ordinary-error","one-shot-refusal"])test(`mobile post controller preserves ${mode}`,async()=>{
 const root=mkdtempSync(join(tmpdir(),"pairing-capsule-mobile-refusal-")),store=join(root,"pairing-capsule-store");mkdirSync(store);
 const host=generateKeyPair(),phone=generateKeyPair(),key=bytesToHex(phone.publicKey),f=capsuleFixture(store,{generations:2,keys:1,publicKeys:[key],migrate:true}),domain=new TransportDomain({},bytesToHex(host.publicKey),f.owner);fixtureHost(domain,host);const peer=liveTransport(domain,phone);
 let admissions=0;const refusal=Object.assign(Error("one-shot fixture refusal"),{code:"ECONNREFUSED"}),ordinary=Error("ordinary broker unavailable"),status:any={agentId:"fixture"};
 const beforeEffect=()=>{requireTransportContext(peer.ctx,true);admissions++;if(mode==="one-shot-refusal"&&admissions===3)throw refusal;};
 const {createScoutAgentService}=await import("../packages/runtime/src/control-plane-agents.ts");
 const service=createScoutAgentService({localAgents:{startLocalAgent:async(_input:any,hook?:()=>void)=>{hook?.();return status;}},registerScoutLocalAgentBinding:async(input:any)=>{input.beforeEffect?.();if(mode==="ordinary-error")throw ordinary;return null;}} as any);
 try{
  console.log("MOBILE_CONTROLLER_READY real-noise");const result=await service.upScoutAgent({} as any,beforeEffect).catch(error=>error);
  console.log("MOBILE_CONTROLLER_EFFECT "+JSON.stringify({mode,admissions,refused:result===refusal}));
  expect(result).toBe(mode==="one-shot-refusal"?refusal:status);expect(httpRequests).toBe(0);
 }finally{domain.dispose();rmSync(root,{recursive:true,force:true});}
});
