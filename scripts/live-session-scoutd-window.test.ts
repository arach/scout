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
for(const backend of ["node"])test(`scoutd queued pre-ACK submission ${backend}`,async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),"pairing-capsule-scoutd-window-"))),store=join(root,"pairing-capsule-store");mkdirSync(store);
 const host=generateKeyPair(),phone=generateKeyPair(),key=bytesToHex(phone.publicKey),f=capsuleFixture(store,{generations:2,keys:1,publicKeys:[key],migrate:true}),domain=new TransportDomain({},bytesToHex(host.publicKey),f.owner);fixtureHost(domain,host);const peer=liveTransport(domain,phone);
 const old=process.env.OPENSCOUT_PROBES_SOCKET,socketPath=join(root,"probes.sock");process.env.OPENSCOUT_PROBES_SOCKET=socketPath;resetScoutdProbeClientForTests();const connect=Bun.connect;if(backend==="node")Bun.connect=undefined as any;
 let connections=0,parked=false,ack=false,admissions=0,reads=0,spawns=0;const trace:any[]=[],sockets=new Set<any>();let release!:()=>void;const pause=new Promise<void>(r=>release=r);
 const server=createServer(socket=>{sockets.add(socket);socket.on("close",()=>sockets.delete(socket));connections++;const exec=connections===2;let text="";
 const drain=()=>{let chunk;while((chunk=socket.read())!==null)text+=String(chunk);if(!text.includes("\n"))return;const req=JSON.parse(text);text="";
 if(req.schema==="openscout.probe.capabilities/v1")socket.end(JSON.stringify({schema:req.schema,daemonVersion:"sandbox",families:[],verbs:[{verb:"tmux.newSession",schemaVersion:1}]})+"\n");
 else{expect(req.verb).toBe("tmux.newSession");reads++;trace.push({kind:"daemon-read",afterAck:ack});socket.end(JSON.stringify({schema:"openscout.exec.response/v1",verb:req.verb,ok:true,value:{stdout:"%fixture",stderr:"",exitCode:0},daemonVersion:"sandbox"})+"\n");}};
 // A readable listener buffers bytes without consuming them. No data listener
 // is installed; the first socket.read for the exec request runs after ACK.
 socket.on("readable",()=>{if(exec&&!ack){parked=true;return;}drain();});if(exec)pause.then(drain);
 });
 await new Promise<void>((r,j)=>{server.once("error",j);server.listen(socketPath,r);});setExecSystemSpawnForTests((()=>{spawns++;throw Error("native spawn forbidden");}) as never);
 let running:Promise<any>|undefined;
 try{
  running=execSystemFile("tmux",["new-session","-d","-s","fixture","-c",root,"fixture-only"],{timeoutMs:5000,beforeEffect:()=>{requireTransportContext(peer.ctx,true);admissions++;trace.push({kind:"client-write-admission",afterAck:ack});}});
  const until=performance.now()+2000;while(!parked||admissions===0){if(performance.now()>until)throw Error("guarded submission did not reach parked fixture daemon");await Bun.sleep(1);}
  // Admission and synchronous socket.write share a stack. This timer turn runs
  // after the write, while the fixture daemon has not read any exec request.
  expect(reads).toBe(0);f.owner.mutate(f.owner.read().revision,crypto.randomUUID(),{type:"revoke",publicKey:key});ack=true;expect(()=>requireTransportContext(peer.ctx,true)).toThrow();trace.push({kind:"revoke-ack",afterAck:true});release();const result=await running;
  expect(result.stdout).toBe("%fixture");expect(reads).toBe(1);expect(spawns).toBe(0);expect(trace.map(x=>x.kind)).toEqual(["client-write-admission","revoke-ack","daemon-read"]);
  console.log("SCOUTD_WINDOW "+JSON.stringify({backend,admissions,reads,spawns,nativeExecutions:0,trace}));
 }finally{release();if(running)await running.catch(()=>{});for(const s of sockets)s.destroy();await new Promise<void>(r=>server.close(()=>r()));Bun.connect=connect;resetExecSystemTransportForTests();resetScoutdProbeClientForTests();if(old===undefined)delete process.env.OPENSCOUT_PROBES_SOCKET;else process.env.OPENSCOUT_PROBES_SOCKET=old;domain.dispose();rmSync(root,{recursive:true,force:true});}
},10000);
