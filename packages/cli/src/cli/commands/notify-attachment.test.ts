import {afterEach,expect,test} from "bun:test";
import {createServer,type Server} from "node:http";
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,openSync,ftruncateSync,closeSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import type {ConversationDefinition,MessageRecord} from "@openscout/protocol";
import {BrokerAttachmentService} from "../../../../runtime/src/broker-attachment-service.ts";
import {AttachmentBlobStore} from "../../../../runtime/src/attachment-blob-store.ts";
import {FileBackedBrokerJournal} from "../../../../runtime/src/broker-journal.ts";
import {createOperatorAttachmentNotifier} from "../../../../runtime/src/broker-operator-attachment-notifier.ts";
import {handleAttachmentRoute} from "../../../../runtime/src/broker-attachments-http.ts";
import type {RuntimeHttpRequestLike} from "../../../../runtime/src/portable-types.ts";
import {createScoutCommandContext} from "../context.ts";
import {runNotifyCommand} from "./notify.ts";
import {runOperatorCommand} from "./operator.ts";
const roots:string[]=[],servers:Server[]=[],journals:FileBackedBrokerJournal[]=[];
const keys=["HOME","OPENSCOUT_ADVERTISE_SCOPE","OPENSCOUT_HOME","OPENSCOUT_SUPPORT_DIRECTORY","OPENSCOUT_CONTROL_HOME","OPENSCOUT_RELAY_HUB","OPENSCOUT_BROKER_URL","OPENSCOUT_BROKER_SOCKET_PATH"];
const original=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
afterEach(async()=>{
  for(const s of servers.splice(0)){s.closeAllConnections();await new Promise<void>(r=>s.close(()=>r()));}
  for(const j of journals.splice(0))await j.close();
  for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});
  for(const k of keys){if(original[k]===undefined)delete process.env[k];else process.env[k]=original[k];}
});
async function fixture() {
  const root=mkdtempSync(join(tmpdir(),"notify-command-"));roots.push(root);
  Object.assign(process.env,{HOME:root,OPENSCOUT_ADVERTISE_SCOPE:"local",OPENSCOUT_HOME:join(root,"scout"),OPENSCOUT_SUPPORT_DIRECTORY:join(root,"support"),OPENSCOUT_CONTROL_HOME:join(root,"control"),OPENSCOUT_RELAY_HUB:join(root,"relay"),OPENSCOUT_BROKER_URL:"http://127.0.0.1:1",OPENSCOUT_BROKER_SOCKET_PATH:join(root,"broker.sock")});
  const bytes=Buffer.from([137,80,78,71,13,10,26,10]);writeFileSync(join(root,"screen.png"),bytes);
  const messages=new Map<string,MessageRecord>(),conversations=new Map<string,ConversationDefinition>(),signals:unknown[]=[],requests:string[]=[];
  const journal=new FileBackedBrokerJournal(join(root,"journal.jsonl"));journals.push(journal);await journal.load();
  const service=new BrokerAttachmentService({nodeId:"n",operatorActorId:"operator",store:new AttachmentBlobStore({supportDirectory:root,references:async()=>new Set()}),
    authorizeActor:p=>["a","b","operator"].includes(p.actorId)&&p.nodeId==="n",conversation:id=>conversations.get(id),message:async id=>messages.get(id),
    post:async message=>{service.assertMessageAdmission(message);await journal.appendEntries([{kind:"message.record",message}]);messages.set(message.id,message);}});
  const notifyOperator=createOperatorAttachmentNotifier({service:()=>service,operatorActorId:"operator",ensureOperator:async()=>{},conversation:async(actorId,operator)=>{
    const id=`dm.${actorId}`;const c:ConversationDefinition={id,kind:"direct",title:id,participantIds:[actorId,operator],visibility:"private",shareMode:"local",authorityNodeId:"n"};conversations.set(id,c);return c;
  },requester:actorId=>({requesterName:actorId}),queueSignal:s=>signals.push(s)});
  const deps={nodeId:"n",service,notifyOperator,peerNode:()=>undefined};
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url!,"http://localhost");requests.push(`${req.method} ${url.pathname}${url.search}`);
    const json=(data:unknown)=>{res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify(data));};
    if(url.pathname==="/health"){json({ok:true,nodeId:"n",meshId:"mesh"});return;}
    if(url.pathname==="/v1/node"){json({id:"n"});return;}
    if(url.pathname==="/v1/snapshot"){json({actors:Object.fromEntries(["a","b","operator"].map(id=>[id,{id,kind:"person",displayName:id}])),agents:{},endpoints:{},conversations:{},messages:{},flights:{}});return;}
    const request=Object.assign(req,{transportContext:{transport:"unix-socket"}}) as unknown as RuntimeHttpRequestLike;
    if(await handleAttachmentRoute(request,res,url,deps))return;
    res.writeHead(404);res.end();
  });servers.push(server);await new Promise<void>(r=>server.listen(process.env.OPENSCOUT_BROKER_SOCKET_PATH!,r));
  const run=async(handler:typeof runNotifyCommand,args:string[],env:NodeJS.ProcessEnv={OPENSCOUT_AGENT:"b"})=>{
    const lines:string[]=[];await handler(createScoutCommandContext({cwd:root,env,stdout:s=>lines.push(s),outputMode:"json"}),args);return JSON.parse(lines[0]!);
  };
  return {root,bytes,run,messages,signals,requests,service};
}
test("notify and plain operator retain explicit/environment sender identity and commit readable canonical images",async()=>{
  const f=await fixture();
  const explicit=await f.run(runNotifyCommand,["--message","Ready","--image","screen.png","--as","a"]);
  const inferred=await f.run(runOperatorCommand,["Ready too","--image","screen.png"]);
  expect(explicit).toMatchObject({status:"recorded",notificationDelivery:"unconfirmed",senderId:"a",conversationId:"dm.a",imageExpiresAt:null});
  expect(inferred).toMatchObject({status:"recorded",senderId:"b",conversationId:"dm.b",imageExpiresAt:null});
  expect(f.messages.size).toBe(2);expect(f.signals).toHaveLength(2);
  expect(f.requests.filter(r=>r.startsWith("POST"))).toEqual(["POST /v1/operator/notify-with-attachment","POST /v1/operator/notify-with-attachment"]);
  expect(f.requests.filter(r=>r.includes("snapshot"))).toEqual(["GET /v1/snapshot?scope=identity","GET /v1/snapshot?scope=identity"]);
  for(const m of f.messages.values()) {
    expect(m.replyToMessageId).toBeUndefined();expect(m.metadata?.operatorSignal).toEqual({kind:"notify",blocking:false,replyExpectation:"none"});
    expect(await f.service.read({conversationId:m.conversationId,messageId:m.id,blobId:m.attachments![0]!.blob!.sha256,mode:"image"},{actorId:m.actorId,nodeId:"n"})).toMatchObject({data:f.bytes.toString("base64")});
  }
  expect(readFileSync(join(f.root,"journal.jsonl"),"utf8")).not.toContain(f.bytes.toString("base64"));
});
test("refused identity and malformed image never produce a success receipt or operator signal",async()=>{
  const f=await fixture();
  await expect(f.run(runNotifyCommand,["--message","Ready","--image","screen.png","--as","unknown"])).rejects.toThrow();
  writeFileSync(join(f.root,"bad.png"),"not a PNG");
  await expect(f.run(runNotifyCommand,["--message","Ready","--image","bad.png","--as","a"])).rejects.toThrow("attachment_mime_mismatch");
  expect(f.messages.size).toBe(0);expect(f.signals).toHaveLength(0);
});
test("invalid file bounds and remote broker are refused before any upload",async()=>{
  const f=await fixture();writeFileSync(join(f.root,"empty.png"),"");mkdirSync(join(f.root,"directory.png"));
  const fd=openSync(join(f.root,"large.png"),"w");ftruncateSync(fd,25*1024*1024+1);closeSync(fd);
  for(const image of ["empty.png","directory.png","large.png","unknown.svg"])
    await expect(f.run(runNotifyCommand,["--message","Ready","--image",image,"--as","a"])).rejects.toThrow();
  process.env.OPENSCOUT_BROKER_URL="https://remote.test";
  await expect(f.run(runNotifyCommand,["--message","Ready","--image","not-even-read.png","--as","a"])).rejects.toThrow("local broker");
  expect(f.requests).toEqual([]);expect(f.messages.size).toBe(0);
});
test("question and permission operator modes cannot borrow the image writer or answer fields",async()=>{
  const f=await fixture();
  for(const args of [["--question","Can I deploy?","--image","screen.png"],["--question","Can I deploy?","--permission","--image","screen.png"],["Ready","--image","screen.png","--reply-to","question"]])
    await expect(f.run(runOperatorCommand,args)).rejects.toThrow();
  expect(f.requests).toEqual([]);expect(f.messages.size).toBe(0);expect(f.signals).toHaveLength(0);
});
