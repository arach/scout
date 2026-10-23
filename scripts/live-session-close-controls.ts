/** Restore the old application replacement in isolated real relay subjects.
 * It must not override a close code already selected from the invalidating view. */
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,statfsSync} from "node:fs";
import {join,resolve,dirname} from "node:path";
import {tmpdir} from "node:os";
import {isBuiltin} from "node:module";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
const out=resolve(process.argv[2]!);mkdirSync(out,{recursive:true});const results=[];
const old=`  function replaceOlderPeerForSameDevice(peer: RelayPeerState): void {
    if (!peer.admitted || !peer.publicKey) return;
    for (const [otherClientId, otherPeer] of securePeers) {
      if (otherClientId === peer.clientId || !otherPeer.admitted || otherPeer.publicKey !== peer.publicKey) continue;
      otherPeer.transport.dispose();
      sendRelayClose(otherClientId, 4001, "Replaced by newer connection");
      teardownSecurePeer(otherClientId);
    }
  }

`;
for(const flavor of ["web","desktop"]){
 const file=resolve(flavor==="web"?"packages/web/server/core/pairing/runtime/bridge/relay-client.ts":"apps/desktop/src/core/pairing/runtime/bridge/relay-client.ts");
 const source=readFileSync(file,"utf8"),anchor='          // Same-key replacement belongs to the registry, including close-code precedence.';
 if(source.split(anchor).length!==2)throw Error("unique replacement anchor");
 const broken=source.replace(anchor,'          replaceOlderPeerForSameDevice(peer);').replace('  function teardownSecurePeer(',old+'  function teardownSecurePeer(');
 const hashes:any={};
 for(const [kind,raw]of [["healthy",source],["bypass",broken]]){
  const disk=statfsSync(process.platform==="darwin"?"/System/Volumes/Data":"/");if(disk.bavail*disk.bsize<3*1024**3)throw Error("3 GiB floor");
  const scratch=mkdtempSync(join(tmpdir(),"pairing-capsule-close-control-"));
  try {
   hashes[kind!]=createHash("sha256").update(raw!).digest("hex");
   const home=join(scratch,"home"),pairing=join(scratch,"pairing-capsule-store");mkdirSync(home,{mode:0o700});mkdirSync(pairing,{mode:0o700});
   const subject=join(scratch,"relay.ts");
   const relocated=raw!.replace(/\bfrom\s+(["'])([^"']+)\1/g,(match,q,dep)=>isBuiltin(dep)?match:`from ${JSON.stringify(pathToFileURL(Bun.resolveSync(dep,dirname(file))).href)}`);
   writeFileSync(subject,relocated);
   const child=Bun.spawn([process.execPath,"scripts/live-session-fanout-worker.ts",flavor,"relay",subject],{env:{...process.env,HOME:home,OPENSCOUT_PAIRING_HOME:pairing},stdout:"pipe",stderr:"pipe"});const timer=setTimeout(()=>child.kill(),60_000);
   const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);clearTimeout(timer);
   const log=stdout+stderr;writeFileSync(join(out,`${flavor}-${kind}.log`),log);
   if(kind==="healthy"?code!==0:!(code!==0&&log.includes('"code":4001')&&log.includes('replacement cannot override an earlier same-view authority invalidation')&&!/Cannot find module|SyntaxError|fixture timeout/.test(log)))throw Error(`invalid close control ${flavor}/${kind}`);
  }finally{rmSync(scratch,{recursive:true,force:true});}
 }
 results.push({flavor,control:"restore-app-key-replacement",caught:true,hashes});
}
writeFileSync(join(out,"results.json"),JSON.stringify({bun:Bun.version,controls:results},null,2));console.log(JSON.stringify(results));
