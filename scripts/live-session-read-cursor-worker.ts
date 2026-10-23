/** Actual web legacy/tRPC resolver → mobile service → broker service → wire
 * client. An isolated HTTP fixture records writes; only discovery and the
 * failed Unix transport are instrumented. No shared broker is contacted. */
import {mock} from "bun:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,realpathSync} from "node:fs";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {EventEmitter} from "node:events";
import * as http from "node:http";
import {capsuleFixture} from "./fixtures/pairing-capsule.ts";
import {fixtureHost,liveTransport,generateKeyPair} from "./fixtures/live-transport.ts";
import {bytesToHex} from "../packages/runtime/src/pairing-security/identity.ts";
import {TransportDomain} from "../packages/runtime/src/pairing-security/transport.ts";

const [protocol,stage,configPath]=process.argv.slice(2);
assert(["legacy","trpc"].includes(protocol!));assert(["discovery","fallback","happy"].includes(stage!));
const config=configPath?JSON.parse(readFileSync(configPath,"utf8")):{};
const base=resolve("packages/web/server/core"),socketPath=join(process.env.HOME!,"fake-broker.sock");writeFileSync(socketPath,"");
let entered=false,revoked=false,uds=0,lateUDS=0,posts=0,latePosts=0,release:()=>void=()=>{};
const pause=new Promise<void>(r=>{release=r;});let releaseWire:()=>void=()=>{};const payloads:any[]=[];
const server=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(req){
  assert.equal(req.method,"POST");assert.equal(new URL(req.url).pathname,"/v1/conversations/conv/read-cursors");
  posts++;if(revoked)latePosts++;payloads.push(await req.json());return Response.json({ok:true});
}});
const baseUrl=`http://127.0.0.1:${server.port}`;
mock.module("node:http",()=>({...http,request:(options:any)=>{
  assert.equal(options.socketPath,socketPath);uds++;if(revoked)lateUDS++;
  const request:any=new EventEmitter();request.write=()=>true;request.destroy=()=>request;
  request.end=()=>{
    const fail=()=>queueMicrotask(()=>request.emit("error",Object.assign(new Error("fixture Unix transport unavailable"),{code:"ECONNREFUSED"})));
    if(stage==="fallback"&&!entered){entered=true;releaseWire=fail;}else fail();
  };return request;
}}));
const manager=await import("../packages/runtime/src/broker-process-manager.ts");
mock.module("@openscout/runtime/broker-process-manager",()=>({...manager,resolveBrokerSocketPathForBaseUrl:()=>socketPath}));
if(config.api){const api=await import(pathToFileURL(config.api).href);mock.module("@openscout/runtime/broker-api",()=>api);}
const brokerUrl=pathToFileURL(join(base,"broker/service.ts")).href;
const broker=await import(pathToFileURL(config.broker??join(base,"broker/service.ts")).href);
mock.module(brokerUrl,()=>({...broker,loadScoutBrokerContext:async()=>{
  if(stage==="discovery"){entered=true;await pause;}
  return {baseUrl,node:{id:"fixture-node"},snapshot:{conversations:{conv:{id:"conv"}},messages:{m1:{id:"m1",conversationId:"conv",createdAt:100}}}};
}}));
if(config.mobile){const mobile=await import(pathToFileURL(config.mobile).href);mock.module(pathToFileURL(join(base,"mobile/service.ts")).href,()=>mobile);}
const {bridgeRouter}=await import(pathToFileURL(config.router??join(base,"pairing/runtime/bridge/router.ts")).href);
const {handleRPC}=await import(pathToFileURL(config.legacy??join(base,"pairing/runtime/bridge/server.ts")).href);
const host=generateKeyPair(),phone=generateKeyPair(),key=bytesToHex(phone.publicKey),bridge={};
const fixture=capsuleFixture(realpathSync(process.env.OPENSCOUT_PAIRING_HOME!),{generations:2,keys:1,publicKeys:[key],migrate:true});
const domain=new TransportDomain(bridge,bytesToHex(host.publicKey),fixture.owner);fixtureHost(domain,host);const peer=liveTransport(domain,phone);
try{
  const ctx={...peer.ctx,cwd:process.env.HOME!,deviceId:key.slice(0,16)},input={conversationId:"conv"};
  const outcome=(protocol==="legacy"?handleRPC(bridge,{id:"read",method:"mobile/comms/read",params:input},ctx):
    bridgeRouter.createCaller(ctx).mobile.commsMarkRead(input)).catch((error:unknown)=>error);
  if(stage!=="happy"){
    const end=performance.now()+20_000;while(!entered){if(performance.now()>end)throw Error("read-cursor pause not reached");await Bun.sleep(2);}
    fixture.owner.mutate(fixture.owner.read().revision,crypto.randomUUID(),{type:"revoke",publicKey:key});revoked=true;release();releaseWire();
  }
  const result=await outcome,message=result instanceof Error?result.message:(result as any)?.error?.message;
  console.log("READ_CURSOR_EFFECT "+JSON.stringify({protocol,stage,uds,lateUDS,posts,latePosts,refused:typeof message==="string",payloads}));
  if(stage==="happy"){
    assert.equal(message,undefined);assert.equal(posts,1);assert.equal(uds,1);assert.deepEqual(payloads,[{actorId:"operator",lastReadMessageId:"m1"}]);
  }else{
    assert.equal(lateUDS+latePosts,0,"no resumed read-cursor submission after revoke ACK");
    assert.equal(posts,0);assert.equal(typeof message,"string");assert.match(message,/Unauthorized|live authenticated/i,"must be authority refusal");
  }
}finally{release();releaseWire();domain.dispose();server.stop(true);}
