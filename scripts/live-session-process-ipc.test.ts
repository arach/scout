import {test,expect} from "bun:test";
import {createServer} from "node:net";
import {mkdtempSync,mkdirSync,rmSync,realpathSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {capsuleFixture} from "./fixtures/pairing-capsule.ts";
import {fixtureHost,liveTransport,generateKeyPair} from "./fixtures/live-transport.ts";
import {bytesToHex} from "../packages/runtime/src/pairing-security/identity.ts";
import {TransportDomain,requireTransportContext} from "../packages/runtime/src/pairing-security/transport.ts";
import {execSystemFile,setExecSystemSpawnForTests,resetExecSystemTransportForTests} from "../packages/runtime/src/system-probes/exec.ts";
import {resetScoutdProbeClientForTests} from "../packages/runtime/src/system-probes/scoutd-client.ts";
for(const backend of ["bun","node","fallback"])for(const mode of ["happy","revoke-during-capabilities","io-refusal","async-refusal"])test(`A2 IPC ${backend}/${mode}`,async()=>{
 const revoke=mode==="revoke-during-capabilities";
 const root=realpathSync(mkdtempSync(join(tmpdir(),"pairing-capsule-a2-ipc-"))),store=join(root,"pairing-capsule-store");mkdirSync(store);
 const host=generateKeyPair(),phone=generateKeyPair(),key=bytesToHex(phone.publicKey),f=capsuleFixture(store,{generations:2,keys:1,publicKeys:[key],migrate:true}),domain=new TransportDomain({},bytesToHex(host.publicKey),f.owner);fixtureHost(domain,host);const peer=liveTransport(domain,phone);
 const socketPath=join(root,"probes.sock"),old=process.env.OPENSCOUT_PROBES_SOCKET;process.env.OPENSCOUT_PROBES_SOCKET=socketPath;resetScoutdProbeClientForTests();const connect=Bun.connect;if(backend==="node")Bun.connect=undefined as any;let entered=false,afterAck=false,execs=0,late=0,localSpawns=0,release!:()=>void;const pause=new Promise<void>(r=>release=r);const sockets=new Set<any>();
 const server=createServer(socket=>{sockets.add(socket);socket.on("close",()=>sockets.delete(socket));let text="";socket.on("data",async chunk=>{text+=String(chunk);if(!text.includes("\n"))return;const request=JSON.parse(text);if(request.schema==="openscout.probe.capabilities/v1"){entered=true;await pause;socket.end(JSON.stringify({schema:request.schema,daemonVersion:"sandbox",families:[],verbs:backend==="fallback"?[]:[{verb:"tmux.newSession",schemaVersion:1}]})+"\n");}else{expect(request.verb).toBe("tmux.newSession");execs++;if(afterAck)late++;socket.end(JSON.stringify({schema:"openscout.exec.response/v1",verb:request.verb,ok:true,value:{stdout:"%fixture",stderr:"",exitCode:0},daemonVersion:"sandbox"})+"\n");}});});
 await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(socketPath,resolve);});
 setExecSystemSpawnForTests((()=>{localSpawns++;throw Error("local spawn forbidden in IPC fixture");}) as never);
 let running:Promise<unknown>|undefined;
 try{
  expect(requireTransportContext(peer.ctx,true).publicKey).toBe(key);console.log("A2_IPC_FIXTURE_READY real-noise own-unix-socket");
  requireTransportContext(peer.ctx,true); // A caller-only guard before the async helper.
  running=execSystemFile("tmux",["new-session","-d","-s","fixture","-c",root,"fixture-only"],{timeoutMs:5000,beforeEffect:(()=>{if(mode==="io-refusal")throw Object.assign(Error("fixture admission refusal"),{code:"ECONNREFUSED"});if(mode==="async-refusal")return Promise.resolve();requireTransportContext(peer.ctx,true);}) as ()=>void}).catch(error=>error);
  const until=performance.now()+2000;while(!entered){if(performance.now()>until)throw Error("capability pause not reached");await Bun.sleep(1);}
  expect(execs).toBe(0);if(revoke){f.owner.mutate(f.owner.read().revision,crypto.randomUUID(),{type:"revoke",publicKey:key});expect(()=>requireTransportContext(peer.ctx,true)).toThrow();afterAck=true;}release();const result=await running;
  console.log("A2_IPC_BOUNDARY "+JSON.stringify({mode,revoke,execs,late,backend,localSpawns,nativeExecutions:0}));expect(localSpawns).toBe(mode==="happy"&&backend==="fallback"?1:0);expect(execs).toBe(mode==="happy"&&backend!=="fallback"?1:0);expect(late).toBe(0);if(revoke)expect(String(result)).toMatch(/Unauthorized|live authenticated/i);if(mode==="io-refusal")expect(String(result)).toContain("fixture admission refusal");if(mode==="async-refusal")expect(String(result)).toContain("synchronous effect admission required");
 }finally{release();if(running)await running.catch(()=>{});for(const socket of sockets)socket.destroy();await new Promise<void>(r=>server.close(()=>r()));Bun.connect=connect;resetExecSystemTransportForTests();resetScoutdProbeClientForTests();if(old===undefined)delete process.env.OPENSCOUT_PROBES_SOCKET;else process.env.OPENSCOUT_PROBES_SOCKET=old;domain.dispose();rmSync(root,{recursive:true,force:true});}
},10000);
