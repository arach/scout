/** Sandboxed SSH records with real Noise-bound principals. Never real authorized_keys. */
import {test,expect,mock} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import {join,resolve} from "node:path";
import {createHash} from "node:crypto";
import {capsuleFixture} from "./fixtures/pairing-capsule.ts";
import {fixtureHost,liveTransport,generateKeyPair} from "./fixtures/live-transport.ts";
import {bytesToHex} from "../packages/runtime/src/pairing-security/identity.ts";
import {TransportDomain,requireTransportContext} from "../packages/runtime/src/pairing-security/transport.ts";
const SSH_A="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIC0uMiA4QE9WW2JpcHF4f4aNlJuiqbC4ucLJ0tng5+Y=",SSH_B="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHmAh46VnK29zdbj6vMAGSSvycjZ4eXq7gGrIoF0";
const KEY_A="1234567890abcdef"+"a".repeat(48),KEY_B="1234567890abcdef"+"b".repeat(48);
let home="",probeHook:(()=>void)|undefined;const reads=fs.readFileSync;
mock.module("os",()=>({...os,homedir:()=>{if(!home)throw Error("sandbox HOME not set");return home;},hostname:()=>"fixture",userInfo:()=>({username:"fixture"})}));
mock.module("fs",()=>({...fs,readFileSync:(p:any,...args:any[])=>p==="/etc/ssh/ssh_host_ed25519_key.pub"?SSH_A:Reflect.apply(reads,fs,[p,...args])}));
const probes=await import("../packages/runtime/src/system-probes/index.ts");
mock.module("@openscout/runtime/system-probes",()=>({...probes,execSystemFile:async(command:string,args:string[])=>{probeHook?.();return {stdout:args.includes("-lc")?"/fixture/tmux":"",stderr:"",exitCode:0};}}));
const modules=[]as any[];
for(const base of ["packages/web/server/core/pairing/runtime/bridge","apps/desktop/src/core/pairing/runtime/bridge"]){
 mock.module(resolve(base,"log.ts"),()=>({log:{info(){},warn(){},error(){},debug(){}}}));
 modules.push({base,helper:await import(resolve(base,"ssh-terminal-access.ts")),shell:await import(resolve(base,"mobile-terminal-provision.ts"))});
}
function legacy(device:string,key=SSH_A,pairing="unbound",session="scout"){return `restrict,pty ${key} scout:terminal-access:v0 device=${Buffer.from(device).toString("base64url")} ssh=fixture pairing=${pairing} session=${Buffer.from(session).toString("base64url")}\n`;}
const fingerprint=(key:string)=>"SHA256:"+createHash("sha256").update(key).digest("base64").replace(/=+$/,"");
async function sandbox(body:(f:any)=>Promise<void>|void){
 const root=fs.mkdtempSync(join(os.tmpdir(),"pairing-credentials-"));home=join(root,"home");fs.mkdirSync(join(home,".ssh"),{recursive:true});const phone=generateKeyPair(),other=generateKeyPair(),host=generateKeyPair();fs.mkdirSync(join(root,"pairing-capsule-trust"));const key=bytesToHex(phone.publicKey),otherKey=bytesToHex(other.publicKey),fixture=capsuleFixture(join(root,"pairing-capsule-trust"),{generations:3,keys:2,publicKeys:[key,otherKey],migrate:true});const domain=new TransportDomain({},bytesToHex(host.publicKey),fixture.owner);fixtureHost(domain,host);
 try{const a=liveTransport(domain,phone),b=liveTransport(domain,other);const ctxA=a.server.bindContext({bridge:domain.bridge,deviceId:"same-display",secureTransport:true,trustedPeer:true}),ctxB=b.server.bindContext({bridge:domain.bridge,deviceId:"same-display",secureTransport:true,trustedPeer:true});const bind=(ctx:any)=>({publicKey:requireTransportContext(ctx,true).publicKey!,admit:()=>{requireTransportContext(ctx,true);}});console.log("CREDENTIAL_FIXTURE_READY real-noise two-bound-sessions sandbox-only");await body({...fixture,key,otherKey,ctxA,ctxB,bind,path:join(home,".ssh","authorized_keys")});}
 finally{domain.dispose();probeHook=undefined;home="";fs.rmSync(root,{recursive:true,force:true});}
}
for(const {base,helper:h,shell:s}of modules){
 test(`${base} T-CREDENTIALS: status requires an owned grant, not ambient scout`,()=>sandbox(async f=>{
  await expect(s.readMobileTerminalStatus(undefined,f.key,f.bind(f.ctxA))).rejects.toThrow();
 }),60_000);
 test(`${base} T-CREDENTIALS: bound provision survives as an issued credential; stale provision/status refuse`,()=>sandbox(async f=>{
  const provisioned=await s.provisionMobileTerminalAccess(SSH_A,"same-display","iphone",f.bind(f.ctxA));await s.readMobileTerminalStatus(provisioned.sessionName,f.key,f.bind(f.ctxA));const issued=fs.readFileSync(f.path,"utf8");expect(issued).toContain(SSH_A);expect(issued).not.toContain("device=c2FtZS1kaXNwbGF5");
  f.owner.mutate(f.owner.read().revision,"credential-revoke",{type:"revoke",publicKey:f.key});
  await expect(s.provisionMobileTerminalAccess(SSH_B,"same-display","iphone",{publicKey:f.key,admit:()=>{requireTransportContext(f.ctxA,true);}})).rejects.toThrow();
  await expect(s.readMobileTerminalStatus(provisioned.sessionName,f.key,{publicKey:f.key,admit:()=>{requireTransportContext(f.ctxA,true);}})).rejects.toThrow();expect(fs.readFileSync(f.path,"utf8")).toBe(issued);
 }),60_000);
 test(`${base} T-PREFIX: helper ownership ignores colliding display ids`,()=>sandbox(f=>{
  const first=h.provisionSshTerminalAccess({authorizedKeys:"",deviceId:KEY_A.slice(0,16),pairingNoisePublicKey:KEY_A,sshPublicKey:SSH_A,terminalSessionName:"scout-iphone-aaaaaaaa"});
  const next=h.provisionSshTerminalAccess({authorizedKeys:first.authorizedKeys,deviceId:KEY_B.slice(0,16),pairingNoisePublicKey:KEY_B,sshPublicKey:SSH_B,terminalSessionName:"scout-ipad-bbbbbbbb"});
  expect(next.authorizedKeys).toContain(first.grant.authorizedKeyLine);expect(h.findSshTerminalSessionForDevice(next.authorizedKeys,KEY_A)).toBe("scout-iphone-aaaaaaaa");
  const revoked=h.revokeSshTerminalAccess({authorizedKeys:next.authorizedKeys,deviceId:KEY_A.slice(0,16),pairingNoisePublicKey:KEY_A});expect(revoked.authorizedKeys).toContain(next.grant.authorizedKeyLine);expect(revoked.removed).toBe(1);
 }),60_000);
 test(`${base} T-PREFIX: real bound keys with equal display metadata retain separate grants`,()=>sandbox(async f=>{
  const grantA=await s.provisionMobileTerminalAccess(SSH_A,"same-display","iphone",f.bind(f.ctxA));const one=fs.readFileSync(f.path,"utf8");const grantB=await s.provisionMobileTerminalAccess(SSH_B,"same-display","ipad",f.bind(f.ctxB));expect(fs.readFileSync(f.path,"utf8")).toContain(one.trim());
  await expect(s.readMobileTerminalStatus(grantB.sessionName,f.key,f.bind(f.ctxA))).rejects.toThrow();await expect(s.readMobileTerminalStatus(grantA.sessionName,f.otherKey,f.bind(f.ctxB))).rejects.toThrow();
  expect((await s.readMobileTerminalStatus(grantA.sessionName,f.key,f.bind(f.ctxA))).sessionName).toBe(grantA.sessionName);
 }),60_000);
 for(const kind of ["unknown","ambiguous"]){test(`${base} T-CREDENTIALS: ${kind} prefix-only legacy refuses inherit/replace/revoke`,()=>sandbox(f=>{
  const prefix=KEY_A.slice(0,16),old=legacy(prefix)+(kind==="ambiguous"?legacy(prefix,SSH_B):"");
  expect(()=>h.findSshTerminalSessionForDevice(old,KEY_A)).toThrow();
  expect(()=>h.provisionSshTerminalAccess({authorizedKeys:old,deviceId:prefix,pairingNoisePublicKey:KEY_A,sshPublicKey:SSH_B})).toThrow();
  expect(()=>h.revokeSshTerminalAccess({authorizedKeys:old,deviceId:prefix,pairingNoisePublicKey:KEY_A})).toThrow();
 }),60_000);}
 for(const kind of ["full-device","full-fingerprint"]){test(`${base} T-CREDENTIALS: ${kind} legacy migrates only its established owner`,()=>sandbox(f=>{
  const old=legacy(kind==="full-device"?KEY_A:KEY_A.slice(0,16),SSH_A,kind==="full-device"?"unbound":fingerprint(KEY_A),"scout-iphone-aaaaaaaa");expect(h.findSshTerminalSessionForDevice(old,KEY_A)).toBe("scout-iphone-aaaaaaaa");
  const next=h.provisionSshTerminalAccess({authorizedKeys:old,deviceId:KEY_A,pairingNoisePublicKey:KEY_A,sshPublicKey:SSH_B});expect(next.authorizedKeys).not.toContain(old.trim());expect(next.authorizedKeys).toContain("scout:terminal-access:v1");
 }),60_000);}
 test(`${base} T-CREDENTIALS: missing full owner cannot mint or revoke`,()=>sandbox(f=>{
  expect(()=>h.provisionSshTerminalAccess({authorizedKeys:"",deviceId:KEY_A.slice(0,16),sshPublicKey:SSH_A})).toThrow("Full Noise key");
  expect(()=>h.revokeSshTerminalAccess({authorizedKeys:legacy(KEY_A.slice(0,16)),deviceId:KEY_A.slice(0,16)})).toThrow("Full Noise key");
  expect(()=>h.findSshTerminalSessionForDevice("",KEY_A.slice(0,16))).toThrow("Full Noise key");
 }),60_000);
 test(`${base} T-CREDENTIALS: status resumes after a probe only with fresh admission`,()=>sandbox(async f=>{
  const grant=await s.provisionMobileTerminalAccess(SSH_A,"same-display","iphone",f.bind(f.ctxA));
  const binding=f.bind(f.ctxA);probeHook=()=>{probeHook=undefined;f.owner.mutate(f.owner.read().revision,"status-await-revoke",{type:"revoke",publicKey:f.key});};
  await expect(s.readMobileTerminalStatus(grant.sessionName,f.key,binding)).rejects.toThrow();
 }),60_000);
 test(`${base} T-CREDENTIALS: conflicting and duplicate legacy proof refuses without deleting`,()=>sandbox(f=>{
  for(const old of [legacy(KEY_A,SSH_A,fingerprint(KEY_B)),legacy(KEY_A.slice(0,16),SSH_A,fingerprint(KEY_A)).trim()+" pairing=unbound\n"]){
   expect(()=>h.findSshTerminalSessionForDevice(old,KEY_A)).toThrow();
   expect(()=>h.revokeSshTerminalAccess({authorizedKeys:old,pairingNoisePublicKey:KEY_A})).toThrow();
  }
 }),60_000);
 test(`${base} T-PREFIX: same SSH key and repeated replacement cannot delete a foreign owner`,()=>sandbox(f=>{
  const a=h.provisionSshTerminalAccess({authorizedKeys:"# untouched\n",deviceId:"display",pairingNoisePublicKey:KEY_A,sshPublicKey:SSH_A,terminalSessionName:"scout-iphone-aaaaaaaa"});
  const b=h.provisionSshTerminalAccess({authorizedKeys:a.authorizedKeys,deviceId:"display",pairingNoisePublicKey:KEY_B,sshPublicKey:SSH_A,terminalSessionName:"scout-ipad-bbbbbbbb"});
  const updated=h.provisionSshTerminalAccess({authorizedKeys:b.authorizedKeys,deviceId:"display",pairingNoisePublicKey:KEY_A,sshPublicKey:SSH_B});expect(updated.authorizedKeys).toContain(b.grant.authorizedKeyLine);expect(updated.authorizedKeys).toStartWith("# untouched\n");
  const removed=h.revokeSshTerminalAccess({authorizedKeys:updated.authorizedKeys,pairingNoisePublicKey:KEY_A});expect(removed.authorizedKeys).toBe("# untouched\n"+b.grant.authorizedKeyLine+"\n");
 }),60_000);

}
