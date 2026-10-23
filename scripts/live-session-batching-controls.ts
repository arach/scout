/** Paired source mutations. Copied owner/transport/Noise fixture share one brand;
 * no production switch or changed live checkout is used by the subjects. */
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,statfsSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
const root=process.cwd(),out=resolve(process.argv[2]!);mkdirSync(out,{recursive:true});
const transport=readFileSync("packages/runtime/src/pairing-security/transport.ts","utf8");
const owner=readFileSync("packages/runtime/src/pairing-security/trust-owner.ts","utf8");
const tests=readFileSync("scripts/live-session-batching.test.ts","utf8"),helper=readFileSync("scripts/fixtures/live-transport.ts","utf8");
const oldBatch=transport.slice(transport.indexOf('    const view = this.owner.withTransportAuthority(fresh => {'),transport.indexOf('  /** One source callback'));
const controls=[
 {id:"close-rechecks-later-membership",test:"close: selection uses the invalidating view",subject:"transport",edits:[['try {e.close(code, code === PAIRING_AUTHORITY_CHANGED_CLOSE_CODE ? AUTHORITY_CHANGED_REASON : "Transport no longer authorized");} catch {}','try { let later=code; if(code===4003 || code===PAIRING_AUTHORITY_CHANGED_CLOSE_CODE) this.owner.withTransportAuthority(v=>{later=v.has(e.key!)?PAIRING_AUTHORITY_CHANGED_CLOSE_CODE:4003;}); e.close(later, later===PAIRING_AUTHORITY_CHANGED_CLOSE_CODE?AUTHORITY_CHANGED_REASON:"Transport no longer authorized"); } catch {}']],oracle:'absent in invalidating view stays 4003'},
 {id:"publication-keeps-batch-permission",test:"batch: a publication discards old permission",subject:"transport",edits:[['    if (this.batchView && (this.batchView.rootId !== view.rootId || this.batchView.stamp !== view.stamp))\n      this.batchView = undefined;','    // planted: preserve old batch permission across a publication']],oracle:'"winner"'},
 {id:"hub-not-batched",test:"batch: direct/relay-style",subject:"transport",edits:[['            this.batch(() => {','            ((body: () => void) => body())(() => {']],oracle:'one exhaustive view for the whole source callback'},
 {id:"nested-batch-reverifies",test:"batch: direct/relay-style",subject:"transport",edits:[['    if (this.batchView) return synchronous();','    if (false && this.batchView) return synchronous();']],oracle:'one exhaustive view for the whole source callback'},
 {id:"snapshot-survives-stack",test:"batch: a later queued sender",subject:"transport",edits:[['    finally { this.batchView = undefined; }','    finally { /* planted retained positive */ }']],oracle:'"outbound":["before","after"]'},
 {id:"network-inside-gate",test:"batch: frames leave only",subject:"transport",edits:[[oldBatch,`    return this.owner.withTransportAuthority(fresh => {
      this.reconcile(fresh); this.batchView = fresh;
      try { return synchronous(); } finally { this.batchView = undefined; }
    });
  }
`]],oracle:'network frame must follow authority gate release'},
 {id:"watch-not-grouped",test:"batch: broker message and lifecycle",subject:"transport",edits:[['        const key = listener.options.transportDomain;','        const key = undefined;']],oracle:'"reads":4'},
 {id:"observer-on-every-read",test:"observer: ordinary reads",subject:"owner",edits:[['    return ready;\n  }\n\n  private cutDirectory','    this.notifyTransportPublication(root, ready);\n    return ready;\n  }\n\n  private cutDirectory']],oracle:'no secondary transport view on ordinary reads'},
 {id:"writer-no-local-hint",test:"observer: ordinary reads",subject:"owner",edits:[['      this.notifyTransportPublication(root,committed);','      // planted omission of the writer publication hint']],oracle:'durable writer ACK notifies'},
];
const url=(p:string)=>pathToFileURL(join(root,p)).href;
const results=[];
for(const c of controls){
 const disk=statfsSync(process.platform==="darwin"?"/System/Volumes/Data":"/");if(disk.bavail*disk.bsize<3*1024**3)throw Error("3 GiB floor");
 const original=c.subject==="owner"?owner:transport;let altered=original;
 for(const [needle,replacement]of c.edits){if(altered.split(needle!).length!==2)throw Error(`nonunique anchor ${c.id}`);altered=altered.replace(needle!,replacement!);}
 const scratch=mkdtempSync(join(tmpdir(),"pairing-capsule-batch-control-")),hashes:any={};
 try{for(const [kind,raw]of [["healthy",original],["bypass",altered]]){
  hashes[kind!]=createHash("sha256").update(raw!).digest("hex");
  const subjectOwner=join(scratch,`${kind}-owner.ts`),subjectTransport=join(scratch,`${kind}-transport.ts`),subjectHelper=join(scratch,`${kind}-helper.ts`),subjectTest=join(scratch,`${kind}.test.ts`);
  let o=c.subject==="owner"?raw!:owner;
  for(const [from,to]of [["../support-paths.js","packages/runtime/src/support-paths.ts"],["./trust-capsule.js","packages/runtime/src/pairing-security/trust-capsule.ts"],["./trust-cutover.js","packages/runtime/src/pairing-security/trust-cutover.ts"],["./trust-reclamation.js","packages/runtime/src/pairing-security/trust-reclamation.ts"]])o=o.replaceAll(JSON.stringify(from),JSON.stringify(url(to!)));
  writeFileSync(subjectOwner,o);
  let t=c.subject==="transport"?raw!:transport;
  for(const [from,to]of [["./noise.js",url("packages/runtime/src/pairing-security/noise.ts")],["./identity.js",url("packages/runtime/src/pairing-security/identity.ts")],["./trust-owner.js",subjectOwner]])t=t.replaceAll(JSON.stringify(from),JSON.stringify(to));
  writeFileSync(subjectTransport,t);
  let h=helper.replaceAll('"../../packages/runtime/src/pairing-security/transport.ts"',JSON.stringify(subjectTransport)).replaceAll('"../../packages/runtime/src/pairing-security/noise.ts"',JSON.stringify(url("packages/runtime/src/pairing-security/noise.ts")));
  writeFileSync(subjectHelper,h);
  let unit=tests.replaceAll('"./fixtures/pairing-capsule.ts"',JSON.stringify(url("scripts/fixtures/pairing-capsule.ts")))
   .replaceAll('"./fixtures/live-transport.ts"',JSON.stringify(subjectHelper))
   .replaceAll('"../packages/runtime/src/pairing-security/identity.ts"',JSON.stringify(url("packages/runtime/src/pairing-security/identity.ts")))
   .replaceAll('"../packages/runtime/src/pairing-security/trust-owner.ts"',JSON.stringify(subjectOwner))
   .replaceAll('"../packages/runtime/src/pairing-security/transport.ts"',JSON.stringify(subjectTransport));
  writeFileSync(subjectTest,unit);
  const child=Bun.spawn([process.execPath,"test",subjectTest,"-t",c.test],{stdout:"pipe",stderr:"pipe"});const timer=setTimeout(()=>child.kill(),60_000);
  const [exit,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);clearTimeout(timer);
  const log=stdout+stderr;writeFileSync(join(out,`${c.id}-${kind}.log`),log);
  if(kind==="healthy"?exit!==0:!(exit!==0&&log.includes("(fail)")&&log.includes(c.oracle)&&!/Cannot find module|SyntaxError|ParseError|timed out/.test(log)))throw Error(`invalid control evidence ${c.id}/${kind}`);
 }
 results.push({id:c.id,caught:true,hashes});
 }finally{rmSync(scratch,{recursive:true,force:true});}
}
writeFileSync(join(out,"results.json"),JSON.stringify({bun:Bun.version,controls:results},null,2));console.log(JSON.stringify(results));
