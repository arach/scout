import {test,expect} from "bun:test";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {requestScoutBrokerJson} from "./broker-api.js";

async function fixture(body:(f:{baseUrl:string;root:string;hits:()=>number})=>Promise<void>){
  const root=mkdtempSync(join(tmpdir(),"scout-broker-admission-"));let hits=0;
  const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch(){hits++;return Response.json({ok:true});}});
  try{await body({baseUrl:`http://127.0.0.1:${server.port}`,root,hits:()=>hits});}
  finally{server.stop(true);rmSync(root,{recursive:true,force:true});}
}
test("broker submission: valid callback is local only and preserves an ordinary request",()=>fixture(async f=>{
  let admissions=0;
  const result=await requestScoutBrokerJson(f.baseUrl,"/read-cursors",{method:"POST",body:{actorId:"operator"},beforeEffect:()=>{admissions++;}});
  expect(result).toEqual({ok:true});expect(admissions).toBe(1);expect(f.hits()).toBe(1);
}));
for(const transport of ["http","unix"])test(`broker submission: ${transport} admission follows body serialization`,()=>fixture(async f=>{
  let revoked=false,admissions=0;const refusal=new Error("no longer admitted");
  const socketPath=join(f.root,"socket-placeholder");writeFileSync(socketPath,"");
  await expect(requestScoutBrokerJson(f.baseUrl,"/read-cursors",{method:"POST",socketPath:transport==="unix"?socketPath:undefined,
    body:{toJSON(){revoked=true;return {actorId:"operator"};}},beforeEffect:()=>{admissions++;if(revoked)throw refusal;}})).rejects.toBe(refusal);
  expect(admissions).toBe(1);expect(f.hits()).toBe(0);
}));
test("broker submission: asynchronous missing-socket fallback re-admits before HTTP",()=>fixture(async f=>{
  let revoked=false;const refusal=new Error("no longer admitted");
  const pending=requestScoutBrokerJson(f.baseUrl,"/read-cursors",{method:"POST",body:{actorId:"operator"},socketPath:join(f.root,"absent"),beforeEffect:()=>{if(revoked)throw refusal;}});
  revoked=true;
  await expect(pending).rejects.toBe(refusal);expect(f.hits()).toBe(0);
}));
test("broker submission: an admission error with an I/O code never becomes a fallback",()=>fixture(async f=>{
  let admissions=0;const refusal=Object.assign(new Error("no longer admitted"),{code:"ENOENT"});
  const socketPath=join(f.root,"socket-placeholder");writeFileSync(socketPath,"");
  await expect(requestScoutBrokerJson(f.baseUrl,"/read-cursors",{method:"POST",body:{actorId:"operator"},socketPath,beforeEffect:()=>{admissions++;throw refusal;}})).rejects.toBe(refusal);
  expect(admissions).toBe(1);expect(f.hits()).toBe(0);
}));
test("broker submission: an asynchronous admission cannot authorize a request",()=>fixture(async f=>{
  await expect(requestScoutBrokerJson(f.baseUrl,"/read-cursors",{method:"POST",body:{actorId:"operator"},beforeEffect:async()=>{}})).rejects.toThrow("synchronous broker admission required");
  expect(f.hits()).toBe(0);
}));
