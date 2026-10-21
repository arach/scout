import { expect, test } from "bun:test";
import { Readable } from "node:stream";
import type { RuntimeHttpRequestLike, RuntimeRequestTransportContext } from "./portable-types.js";
import { handleAttachmentRoute, executeHostAttachmentRead, ATTACHMENT_READ_PATH } from "./broker-attachments-http.js";
import type { BrokerAttachmentService } from "./broker-attachment-service.js";
import { createBrokerHttpRouter } from "./broker-http-router.js";
const read = { actorId: "agent", conversationId: "c", messageId: "m", blobId: "a".repeat(64), mode: "text" };
function request(body: unknown, path = ATTACHMENT_READ_PATH, context: RuntimeRequestTransportContext = { transport: "unix-socket" }) {
  return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method: "POST", url: path, headers: { "content-type": "application/json", host: "localhost" }, transportContext: context }) as unknown as RuntimeHttpRequestLike;
}
function response() {
  let status = 0, body = "";
  return { writeHead(code: number) { status=code; }, end(value: string) { body+=value; }, get status() { return status; }, get body() { return JSON.parse(body); } };
}
function deps() {
  const calls: unknown[] = [];
  const service = { async read(input: unknown, principal: unknown) { calls.push({input,principal}); return {mode:"text",text:"bounded"}; }, async postWithAttachments(input: unknown, principal: unknown) { calls.push({input,principal}); return {ok:true}; } } as unknown as BrokerAttachmentService;
  return { calls, service, nodeId: "n", peerNode: (key: string) => key==="verified" ? "peer" : undefined };
}
test("core-only attachment HTTP routes call the service without web or cookie auth", async () => {
  const d = deps(), res = response();
  expect(await handleAttachmentRoute(request(read),res,new URL(`http://localhost${ATTACHMENT_READ_PATH}`),d)).toBe(true);
  expect(res.status).toBe(200); expect(d.calls).toEqual([{ input: {conversationId:"c",messageId:"m",blobId:"a".repeat(64),mode:"text"}, principal:{actorId:"agent",nodeId:"n"} }]);
});
test("local upload route is strict and rejects paths, URLs, IDs and remote/scoped callers", async () => {
  const input = { actorId:"agent",requestId:"r",conversationId:"c",body:"hello",attachments:[{data:"YQ==",mediaType:"text/plain"}] };
  const path = "/v1/messages/with-attachments";
  for (const extra of [{path:"/etc/passwd"},{url:"https://evil.test"},{id:"adopt"},{blob:{sha256:"a".repeat(64)}}]) {
    const d=deps(),res=response(); await handleAttachmentRoute(request({...input,attachments:[{...input.attachments[0],...extra}]},path),res,new URL(`http://localhost${path}`),d);
    expect(res.status).toBe(400); expect(d.calls).toHaveLength(0);
  }
  for (const context of [{transport:"remote",peer:{keyId:"verified",tier:"control"}},{transport:"loopback",scoped:{}},{transport:"loopback",guest:{keyId:"g",grantId:"g"}}]) {
    const d=deps(),res=response(); await handleAttachmentRoute(request(input,path,context as RuntimeRequestTransportContext),res,new URL(`http://localhost${path}`),d);
    expect(res.status).toBe(403); expect(d.calls).toHaveLength(0);
  }
  const d=deps(),res=response(); await handleAttachmentRoute(request(input,path),res,new URL(`http://localhost${path}`),d);
  expect(res.status).toBe(200); expect(d.calls).toHaveLength(1);
});
test("unsupported HTTP attachment capability fails before a canonical mutation", async () => {
  const res=response(); await handleAttachmentRoute(request(read),res,new URL(`http://localhost${ATTACHMENT_READ_PATH}`),{nodeId:"n",peerNode:()=>undefined});
  expect(res.status).toBe(503); expect(res.body).toEqual({error:"attachments_unavailable"});
});
test("existing host routes forward only an exact node and fixed attachment operation", async () => {
  const d=deps(),forwards:unknown[]=[];
  const input={path:ATTACHMENT_READ_PATH,method:"POST",nodeId:"destination",body:read};
  const result=await executeHostAttachmentRead(input,request(input),"/v1/hosts/web-request",{...d,forward:async input=>{forwards.push(input);return {status:200,body:{text:"remote"}};}});
  expect(result).toEqual({status:200,body:{text:"remote"}}); expect(forwards).toEqual([input]); expect(d.calls).toHaveLength(0);
  for (const change of [{path:"https://evil.test/file"},{path:"/api/blobs/anything"},{body:{...read,url:"https://evil.test"}},{body:{...read,blobId:"../../etc/passwd"}}]) {
    expect((await executeHostAttachmentRead({...input,...change},request(input),"/v1/hosts/web-request",d)).status).toBe(400);
  }
});
test("destination preserves verified node authority and never defaults a remote caller to operator", async () => {
  const d=deps(),input={path:ATTACHMENT_READ_PATH,method:"POST",body:read};
  const req=request(input,"/v1/mesh/web-request",{transport:"remote",peer:{keyId:"verified",tier:"control"}});
  expect((await executeHostAttachmentRead(input,req,"/v1/mesh/web-request",d)).status).toBe(200);
  expect(d.calls).toEqual([{input:{conversationId:"c",messageId:"m",blobId:"a".repeat(64),mode:"text"},principal:{actorId:"agent",nodeId:"peer"}}]);
  req.transportContext={transport:"remote"}; req.headers["x-openscout-forwarded-node-id"]="peer";
  expect((await executeHostAttachmentRead(input,req,"/v1/mesh/web-request",d)).status).toBe(403);
  req.transportContext={transport:"remote",peer:{keyId:"unknown",tier:"control"}};
  expect((await executeHostAttachmentRead(input,req,"/v1/mesh/web-request",d)).status).toBe(403);
  expect((await executeHostAttachmentRead({...input,nodeId:"peer"},req,"/v1/mesh/web-request",d)).status).toBe(403);
});
test("real router dispatches the fixed host operation before its legacy web adapter", async () => {
  const d=deps(); let webReads=0;
  const router=createBrokerHttpRouter({attachments:d,nodeId:"n",meshId:"mesh",runtime:{snapshot:()=>({nodes:{}})},webControl:{requestForHost:()=>{webReads++;throw Error("must not fetch web");}}} as never);
  const input={path:ATTACHMENT_READ_PATH,method:"POST",nodeId:"n",body:read},res=response();
  await router(request(input,"/v1/hosts/web-request"),res);
  expect(res.status).toBe(200); expect(res.body.status).toBe(200); expect(d.calls).toHaveLength(1); expect(webReads).toBe(0);
});
test("ordinary message POST cannot bypass the inline attachment write capability", async () => {
  const d=deps(),res=response(); let posted=false;
  const router=createBrokerHttpRouter({attachments:d,nodeId:"n",meshId:"mesh",runtime:{snapshot:()=>({nodes:{}})},brokerService:{postConversationMessage:()=>{posted=true;}}} as never);
  await router(request({attachments:[{blob:{sha256:"a".repeat(64)}}]},"/v1/messages"),res);
  expect(res.status).toBe(400); expect(posted).toBe(false);
});
test("upload admission happens before reading another large request body", async () => {
  const d=deps(),path="/v1/messages/with-attachments";
  let release!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve}),started=new Promise<void>(resolve=>{entered=resolve});
  d.service.postWithAttachments=async()=>{entered();await gate;return {ok:true} as never;};
  const input={actorId:"agent",requestId:"r",conversationId:"c",body:"",attachments:[{data:"YQ==",mediaType:"text/plain"}]};
  const one=handleAttachmentRoute(request(input,path),response(),new URL(`http://localhost${path}`),d); await started;
  const two=response(); await handleAttachmentRoute(request(input,path),two,new URL(`http://localhost${path}`),d);
  expect(two.status).toBe(503); expect(two.body).toEqual({error:"attachments_busy"}); release(); await one;
});
test("public attachment subpath is import-safe and does not expose an unscoped blob store",async()=>{
  const api=await import("@openscout/runtime/attachments");
  expect(typeof api.BrokerAttachmentService).toBe("function");
  expect("AttachmentBlobStore" in api).toBe(false);
  expect("readPairingAttachmentBlob" in api).toBe(false);
});
