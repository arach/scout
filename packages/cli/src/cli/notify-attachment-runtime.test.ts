import {afterEach,expect,test} from "bun:test";
import {createHash} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {postOperatorAttachment,OPERATOR_ATTACHMENT_PATH} from "./notify-attachment-runtime.ts";
const input={baseUrl:"http://127.0.0.1:1",actorId:"agent",requestId:"request",body:"Ready",attachment:{data:"iVBORw0KGgo=",mediaType:"image/png",fileName:"screen.png"}};
function receipt(i=input) {
  const id=`msg.request.${createHash("sha256").update(JSON.stringify([i.actorId,i.requestId])).digest("hex")}`;
  return {ok:true,message:{id,requestId:i.requestId,conversationId:"dm",actorId:i.actorId,originNodeId:"node",class:"agent",body:i.body.trim(),visibility:"private",policy:"durable",createdAt:1,metadata:{operatorSignal:{kind:"notify",blocking:false,replyExpectation:"none"}},attachments:[{id:`${id}.attachment.0`,mediaType:i.attachment.mediaType,fileName:i.attachment.fileName,blob:{sha256:createHash("sha256").update(Buffer.from(i.attachment.data,"base64")).digest("hex"),mediaType:i.attachment.mediaType,byteSize:8}}]}};
}
const roots:string[]=[];const servers:{stop:(force?:boolean)=>unknown}[]=[];
afterEach(()=>{for(const s of servers.splice(0))s.stop(true);for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});});
test("one fixed local write sends only bytes, sender and request identity with no ambient credentials",async()=>{
  let calls=0;
  const message=await postOperatorAttachment({...input,socketPath:"/selected.sock",fetchImpl:(async(url: RequestInfo | URL,init?: RequestInit)=>{
    calls++;expect(String(url)).toBe(`http://127.0.0.1:1${OPERATOR_ATTACHMENT_PATH}`);expect(init).toMatchObject({method:"POST",redirect:"error",credentials:"omit",unix:"/selected.sock"});
    expect(new Headers(init?.headers).get("cookie")).toBeNull();expect(new Headers(init?.headers).get("authorization")).toBeNull();
    expect(JSON.parse(String(init?.body))).toEqual({actorId:"agent",requestId:"request",body:"Ready",attachment:input.attachment});
    return Response.json(receipt());
  }) as unknown as typeof fetch});
  expect(message.actorId).toBe("agent");expect(calls).toBe(1);
});
test("refused or ambiguous write never retries or falls back from the selected socket",async()=>{
  let calls=0;
  await expect(postOperatorAttachment({...input,socketPath:"/missing.sock",fetchImpl:(async()=>{calls++;throw Error("secret transport detail");}) as unknown as typeof fetch})).rejects.toThrow("unconfirmed; do not automatically retry");expect(calls).toBe(1);
  for(const status of [401,403,404,409,413,503]) await expect(postOperatorAttachment({...input,fetchImpl:(async()=>Response.json({error:"attachment_forbidden",detail:"SECRET"},{status})) as unknown as typeof fetch})).rejects.toThrow(`HTTP ${status} attachment_forbidden`);
});
test("remote, ambiguous or URL-bearing broker selections refuse before fetch",async()=>{
  let calls=0;
  for(const baseUrl of ["https://remote.test","http://127.1","http://localhost.evil.test","http://user@localhost","http://localhost/path","http://localhost?secret=1","http://localhost/#fragment","http://localhost\n"]) {
    await expect(postOperatorAttachment({...input,baseUrl,fetchImpl:(async()=>{calls++;return Response.json(receipt());}) as unknown as typeof fetch})).rejects.toThrow("local broker");
  }
  expect(calls).toBe(0);
});
test("untrusted receipts cannot impersonate an actor, answer a question or substitute the image binding",async()=>{
  const changes=[(r:any)=>{r.message.requestId="different";},(r:any)=>{r.message.attachments[0].mediaType="text/plain";},(r:any)=>{r.message.attachments[0].fileName="different.png";},(r:any)=>{r.message.attachments[0].id="different";},(r:any)=>{r.message.actorId="operator";},(r:any)=>{r.message.id="other";},(r:any)=>{r.message.body="other";},(r:any)=>{r.message.conversationId="";},(r:any)=>{r.message.replyToMessageId="question";},(r:any)=>{r.message.metadata.operatorSignal.kind="need";},(r:any)=>{r.message.metadata.operatorSignal.blocking=true;},(r:any)=>{r.message.metadata.operatorSignal.replyExpectation="required";},(r:any)=>{r.message.attachments[0].url="https://evil.test";},(r:any)=>{r.message.attachments[0].blobKey="phone-store";},(r:any)=>{r.message.attachments[0].blob.sha256="0".repeat(64);},(r:any)=>{r.message.attachments[0].blob.mediaType="text/plain";},(r:any)=>{r.message.attachments[0].blob.byteSize=9;},(r:any)=>{r.message.attachments=[];}];
  for(const change of changes) {const r=receipt();change(r);await expect(postOperatorAttachment({...input,fetchImpl:(async()=>Response.json(r)) as unknown as typeof fetch})).rejects.toThrow("unconfirmed");}
  for(const data of [null,[],{},"bad"])await expect(postOperatorAttachment({...input,fetchImpl:(async()=>Response.json(data)) as unknown as typeof fetch})).rejects.toThrow("unconfirmed");
});
test("receipt body is bounded and errors do not echo arbitrary broker text",async()=>{
  for(const response of [new Response("x".repeat(1024*1024+1)),new Response(new Uint8Array([255])),new Response("not-json")])
    await expect(postOperatorAttachment({...input,fetchImpl:(async()=>response) as unknown as typeof fetch})).rejects.toThrow(/receipt/);
  await expect(postOperatorAttachment({...input,fetchImpl:(async()=>Response.json({error:"SECRET token"},{status:503})) as unknown as typeof fetch})).rejects.toThrow("operator attachment refused: HTTP 503");
});
test("real Unix socket wins over HTTP and an absent socket cannot fall back to the TCP trap",async()=>{
  const root=mkdtempSync(join(tmpdir(),"notify-socket-"));roots.push(root);const socket=join(root,"broker.sock");
  let http=0,unix=0;
  const tcp=Bun.serve({hostname:"127.0.0.1",port:0,fetch(){http++;return Response.json(receipt());}});servers.push(tcp);
  const uds=Bun.serve({unix:socket,fetch:async req=>{unix++;expect(new URL(req.url).pathname).toBe(OPERATOR_ATTACHMENT_PATH);expect(await req.json()).toMatchObject({actorId:"agent",attachment:input.attachment});return Response.json(receipt());}});servers.push(uds);
  await postOperatorAttachment({...input,baseUrl:`http://127.0.0.1:${tcp.port}`,socketPath:socket});
  await expect(postOperatorAttachment({...input,baseUrl:`http://127.0.0.1:${tcp.port}`,socketPath:join(root,"absent.sock")})).rejects.toThrow("unconfirmed");
  expect(unix).toBe(1);expect(http).toBe(0);
});
test("real redirect response cannot forward image bytes to another destination",async()=>{
  let reads=0;const trap=Bun.serve({hostname:"127.0.0.1",port:0,fetch(){reads++;return Response.json(receipt());}});servers.push(trap);
  const redirect=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>new Response(null,{status:307,headers:{location:`http://127.0.0.1:${trap.port}/steal`}})});servers.push(redirect);
  await expect(postOperatorAttachment({...input,baseUrl:`http://127.0.0.1:${redirect.port}`})).rejects.toThrow("unconfirmed");expect(reads).toBe(0);
});
