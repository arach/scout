import {test,expect,afterAll} from "bun:test";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {capsuleFixture} from "./fixtures/pairing-capsule.ts";
import {fixtureHost,liveTransport,generateKeyPair} from "./fixtures/live-transport.ts";
import {bytesToHex} from "../packages/runtime/src/pairing-security/identity.ts";
import {TransportDomain,requireTransportContext} from "../packages/runtime/src/pairing-security/transport.ts";
import {requestScoutBrokerJson} from "../packages/runtime/src/broker-api.ts";
// In-process equivalent of the worker boundary: one owned endpoint only.
let hits=0;const bodies:any[]=[];
const server=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(request){hits++;bodies.push(await request.json());return Response.json({ok:true});}}),fetchOriginal=globalThis.fetch;
globalThis.fetch=((input:any,options:any)=>{if(new URL(input instanceof Request?input.url:String(input)).origin!==server.url.origin)throw Error("fixture must never contact a shared runtime");return fetchOriginal(input,options);}) as typeof fetch;
afterAll(async()=>{globalThis.fetch=fetchOriginal;await server.stop(true);});
for(const mode of ["live","serialize-revoke","unix-fallback-revoke","io-refusal","async-refusal"])test(`broker final transport ${mode}`,async()=>{
 const root=mkdtempSync(join(tmpdir(),"pairing-capsule-broker-wire-")),store=join(root,"pairing-capsule-store");mkdirSync(store);
 const host=generateKeyPair(),phone=generateKeyPair(),key=bytesToHex(phone.publicKey),f=capsuleFixture(store,{generations:2,keys:1,publicKeys:[key],migrate:true}),domain=new TransportDomain({},bytesToHex(host.publicKey),f.owner);fixtureHost(domain,host);const peer=liveTransport(domain,phone);
 const before=hits,refusal=Object.assign(Error("one-shot wire refusal"),{code:"ECONNREFUSED"});let admissions=0;
 const revoke=()=>f.owner.mutate(f.owner.read().revision,crypto.randomUUID(),{type:"revoke",publicKey:key});
 const beforeEffect=()=>{admissions++;if(mode==="io-refusal")throw refusal;if(mode==="async-refusal")return Promise.resolve();requireTransportContext(peer.ctx,true);};
 try{
  const placeholder=join(root,"not-a-socket");writeFileSync(placeholder,"");requireTransportContext(peer.ctx,true);
  const pending=requestScoutBrokerJson(server.url.href,"/v1/messages",{method:"POST",body:mode==="serialize-revoke"?{toJSON(){revoke();return {body:"fixture"};}}:{body:"fixture"},socketPath:mode==="unix-fallback-revoke"?join(root,"missing"):mode==="io-refusal"?placeholder:undefined,beforeEffect:beforeEffect as ()=>void}).catch(error=>error);
  if(mode==="unix-fallback-revoke")revoke();const result=await pending;
  expect(hits-before).toBe(mode==="live"?1:0);expect(admissions).toBe(1);
  if(mode==="live"){expect(result).toEqual({ok:true});expect(bodies.at(-1)).toEqual({body:"fixture"});}
  if(mode.endsWith("revoke"))expect(String(result)).toMatch(/Unauthorized|live authenticated/i);
  if(mode==="io-refusal")expect(result).toBe(refusal);
  if(mode==="async-refusal")expect(String(result)).toContain("synchronous broker admission required");
  console.log("BROKER_WIRE_CONTROL "+JSON.stringify({mode,hits:hits-before,admissions}));
 }finally{domain.dispose();rmSync(root,{recursive:true,force:true});}
},10000);
