import { expect,test } from "bun:test";
import { readAttachmentHostResponse } from "./attachment-host-response.js";
const input={conversationId:"c",messageId:"m",blobId:"a".repeat(64),mode:"text" as const};
const result={status:200,body:{blobId:input.blobId,messageId:"m",mode:"text",mediaType:"text/plain",byteSize:5,text:"hello",truncated:false,sourceTrust:"untrusted_attachment"}};
test("remote attachment responses retain identity and bounded untrusted text",async()=>{
  expect(await readAttachmentHostResponse(Response.json(result),input)).toEqual(result);
});
test("host response reader refuses redirects, oversized streams, identity changes and extra fetch fields",async()=>{
  for(const response of [new Response("",{status:302,headers:{location:"https://evil.test"}}),new Response("x".repeat(512*1024+1)),Response.json({...result,body:{...result.body,messageId:"other"}}),Response.json({...result,body:{...result.body,url:"https://evil.test"}}),Response.json({...result,body:{...result.body,text:"x".repeat(32001)}})]){
    await expect(readAttachmentHostResponse(response,input)).rejects.toThrow("attachment_unavailable");
  }
});
test("old destinations produce explicit attachment capability unavailability",async()=>{
  expect(await readAttachmentHostResponse(Response.json({status:400,body:{error:"unsupported_host_operation"}}),input)).toEqual({status:400,body:{error:"attachments_unavailable"}});
});
