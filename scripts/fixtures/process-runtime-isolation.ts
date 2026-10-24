/** Child-only runtime sandbox. Import first, before product modules or stage selection. */
import {mock} from "bun:test";
import assert from "node:assert/strict";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
let handler:((request:Request)=>Response|Promise<Response>)|undefined,localProbes=0;
const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch(request){
 if(new URL(request.url).pathname==="/__a2_isolation_probe"){localProbes++;return Response.json({fixture:true});}
 assert(handler,"unexpected runtime request outside configured fixture");return handler(request);
}});
// Every current/future stage starts with both endpoints replaced, not inherited.
process.env.OPENSCOUT_BROKER_URL=server.url.href;
process.env.OPENSCOUT_BROKER_INTERNAL_URL=server.url.href;
const originalFetch=globalThis.fetch;
globalThis.fetch=((input:any,options:any)=>{
 const url=new URL(input instanceof Request?input.url:String(input));
 assert.equal(url.origin,server.url.origin,"fixture must never contact a shared runtime");
 return originalFetch(input,options);
}) as typeof fetch;
const path=pathToFileURL(resolve("packages/runtime/src/broker-process-manager.ts")).href;
const managers=await import(path);
mock.module(path,()=>({...managers,resolveScoutBrokerControlUrl:()=>server.url.href,resolveBrokerSocketPathForBaseUrl:()=>null}));
export const fixtureRuntime={
 setHandler(next:typeof handler){handler=next;},
 async probe(){
  for(const name of ["OPENSCOUT_BROKER_URL","OPENSCOUT_BROKER_INTERNAL_URL"]){
   const response=await fetch(new URL("/__a2_isolation_probe",process.env[name]!));
   assert.deepEqual(await response.json(),{fixture:true});
  }
  console.log("A2_RUNTIME_ISOLATION "+JSON.stringify({probes:2,localRequests:localProbes}));
 },
 close(){return server.stop(true);},
};
