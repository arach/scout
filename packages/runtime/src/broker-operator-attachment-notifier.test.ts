import { expect, test } from "bun:test";
import { createOperatorAttachmentNotifier } from "./broker-operator-attachment-notifier.js";
import type { BrokerAttachmentService } from "./broker-attachment-service.js";
const input={actorId:"agent",requestId:"request",body:"Ready",attachment:{data:"iVBORw0KGgo=",mediaType:"image/png"}};
const principal={actorId:"agent",nodeId:"node"};
function fixture(mode="success") {
  const calls:unknown[]=[];
  const result={ok:true,duplicate:mode==="duplicate",message:{id:"message",conversationId:"dm",actorId:"agent",body:"Ready",createdAt:123}};
  const service={assertLocalActor:(p:unknown)=>{calls.push(["authorize",p]);if(mode==="unauthorized")throw Error("forbidden");},postOperatorNotification:async(i:unknown,p:unknown)=>{calls.push(["commit",i,p]);if(mode==="failed")throw Error("failed");return result;}} as unknown as BrokerAttachmentService;
  const notify=createOperatorAttachmentNotifier({service:()=>mode==="unavailable"?undefined:service,operatorActorId:"operator",ensureOperator:async()=>{calls.push("ensure-operator");},conversation:async(a,b)=>{calls.push(["dm",a,b]);return {id:"dm"} as never;},requester:id=>({requesterName:id,projectRoot:"/project"}),queueSignal:i=>{calls.push(["signal",i]);}});
  return {notify,calls,result};
}
test("notify composition fixes the operator target and signals only after the same canonical commit",async()=>{
  const f=fixture();expect(await f.notify(input,principal)).toBe(f.result);
  expect(f.calls).toEqual([["authorize",principal],"ensure-operator",["dm","agent","operator"],["commit",{requestId:"request",conversationId:"dm",body:"Ready",attachments:[input.attachment]},principal],["signal",{signal:{kind:"notify",blocking:false,replyExpectation:"none"},messageId:"message",conversationId:"dm",requesterId:"agent",requesterNodeId:"node",body:"Ready",requesterName:"agent",projectRoot:"/project",createdAt:123}]]);
});
test("failed, unauthorized and duplicate writes cannot enqueue another operator signal",async()=>{
  for(const mode of ["failed","unauthorized","unavailable","duplicate"]) {
    const f=fixture(mode);
    if(mode==="duplicate")expect(await f.notify(input,principal)).toBe(f.result);
    else await expect(f.notify(input,principal)).rejects.toThrow();
    expect(f.calls.some(c=>Array.isArray(c)&&c[0]==="signal")).toBe(false);
    if(mode==="unauthorized"||mode==="unavailable")expect(f.calls).not.toContain("ensure-operator");
  }
  const f=fixture();await expect(f.notify(input,{...principal,actorId:"operator"})).rejects.toThrow("attachment_forbidden");expect(f.calls).toEqual([]);
});
