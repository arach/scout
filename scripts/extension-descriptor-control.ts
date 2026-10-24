/** Instrument control only. Numeric stdio 0/1, never an extension backend.
 * Raw endpoints have one explicit closing owner. Unlike Bun-owned pipes, their
 * teardown does not depend on GC. No product runner imports this apparatus. */
import { dlopen, ptr } from "bun:ffi";
import { closeSync, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync, readSync, rmSync, writeSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INHERITED_DESCRIPTOR_LAYOUTS, MAX_INHERITED_DESCRIPTOR_SLOT } from "../packages/runtime/src/inherited-descriptors.ts";
import type { checkReclaimedDescriptors, DescriptorForm, WitnessEvent } from "../packages/cli/src/cli/extension-descriptor-witness.ts";

let library: ReturnType<typeof openNative> | undefined;
function openNative() {
  if (process.platform !== "darwin" && process.platform !== "linux") throw Error("unsupported control platform");
  // Diagnostic apparatus follows the numeric spike's glibc Linux scope.
  return dlopen(process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6", {
    pipe: { args: ["ptr"], returns: "i32" }, socketpair: { args: ["i32", "i32", "i32", "ptr"], returns: "i32" },
    dup: { args: ["i32"], returns: "i32" }, dup2: { args: ["i32", "i32"], returns: "i32" },
    ioctl: { args: ["i32", "u64"], returns: "i32" },
  });
}
const native = () => library ??= openNative();
function identity(fd: number) {
  try { const s=fstatSync(fd); return {dev:s.dev,ino:s.ino,file:s.isFile(),socket:s.isSocket(),fifo:s.isFIFO()}; } catch { return null; }
}
function same(fd: number, id: ReturnType<typeof identity>) { return id !== null && JSON.stringify(identity(fd)) === JSON.stringify(id); }
function own(fd: number) {
  const id=identity(fd); let live=true;
  return {fd, id, close() {if(live){live=false;if(same(fd,id))closeSync(fd);}}};
}
function mark(fd: number) {
  if(native().symbols.ioctl(fd,process.platform==="darwin"?0x20006601:0x5451)!==0)throw Error("control CLOEXEC failed");
}
function copy(fd: number) {
  const low: ReturnType<typeof own>[]=[];
  try {for(;;){const n=native().symbols.dup(fd);if(n<0)throw Error("control dup failed");const next=own(n);try{mark(n);}catch(error){next.close();throw error;}if(n>MAX_INHERITED_DESCRIPTOR_SLOT)return next;low.push(next);}}
  finally {for(const entry of low)entry.close();}
}
/** Replace only our own still-identified regular-file reservation, never an
 * arbitrary number which the runtime may have reclaimed between exchanges. */
function pair(duplex: boolean, reservation?: ReturnType<typeof own>) {
  const fds=new Int32Array(2);
  if((duplex?native().symbols.socketpair(1,1,0,ptr(fds)):native().symbols.pipe(ptr(fds)))!==0)throw Error("control pair failed");
  const raw=[own(fds[0]!),own(fds[1]!)];let child:ReturnType<typeof own>|undefined,parent:ReturnType<typeof own>|undefined;
  try {
    for(const end of raw)mark(end.fd);
    child=copy(raw[0]!.fd);
    if(reservation){
      if(!same(reservation.fd,reservation.id)||!reservation.id?.file)throw Error("control reservation identity changed");
      if(native().symbols.dup2(raw[1]!.fd,reservation.fd)!==reservation.fd)throw Error("control reserved reuse failed");
      parent=own(reservation.fd);mark(reservation.fd);
    } else parent=copy(raw[1]!.fd);
    return {parent,child};
  } catch(error){child?.close();parent?.close();throw error;}
  finally {for(const end of raw)end.close();}
}

export async function runStandardDescriptorControl(input: {
  form: DescriptorForm; emit?: (event:WitnessEvent)=>void;
  fault?: "stale-second-close"|"second-spawn-close"; controlChurn?: boolean;
  check: typeof checkReclaimedDescriptors;
}) {
  const home=mkdtempSync(join(tmpdir(),"scout-descriptor-control-"));const duplex=input.form==="credential";
  const emit=(e:WitnessEvent)=>input.emit?.({form:input.form,mechanism:"standard-control",target:INHERITED_DESCRIPTOR_LAYOUTS.extensionApi2[input.form],...e});
  let reservation:ReturnType<typeof own>|undefined,previous:number|undefined;
  try {
    for(let iteration=0;iteration<8;iteration++){
      // Deliberately consume free numbers while the previous victim reserves
      // its own number. Reuse must not depend on lowest-free allocation order.
      const churn=input.controlChurn?Array.from({length:32},(_,n)=>own(openSync(join(home,`churn-${iteration}-${n}`),"wx"))):[];
      let channel:ReturnType<typeof pair>;
      try {channel=pair(duplex,reservation);reservation=undefined;}
      finally {for(const fd of churn)fd.close();}
      const parent=channel.parent,source=channel.child;
      const ready=join(home,`ready-${iteration}`);let child:ReturnType<typeof spawn>|undefined;
      let exited:Promise<number|null>|undefined,closed:Promise<void>|undefined,timer:ReturnType<typeof setTimeout>|undefined;
      try {
        // stdin and (for duplex) stdout map copies of the raw child endpoint.
        // The child marker is emitted only AFTER its complete eight-byte request
        // reaches the pipe, so the parent's tiny read cannot block awaiting I/O.
        const script=`import{readSync,writeSync,writeFileSync}from'node:fs';${duplex?`writeSync(1,'request\\n');writeFileSync(${JSON.stringify(ready)},'ready');`:""}let wire='';const b=Buffer.alloc(64);for(;;){const n=readSync(0,b,0,b.length,null);if(!n)break;wire+=b.subarray(0,n);}if(wire!=='response\\n')process.exit(91);`;
        child=spawn(process.execPath,["-e",script],{stdio:[source.fd,duplex?source.fd:"ignore","inherit"],env:{HOME:home,PATH:process.env.PATH}});
        exited=new Promise((done,reject)=>{child!.once("exit",done);child!.once("error",reject);});
        closed=new Promise(done=>child!.once("close",()=>done()));
        source.close(); // Numeric source remains ours; close synchronously.
        emit({event:"spawn",iteration,pid:child.pid,ports:[parent.fd],active:[{fd:parent.fd,identity:parent.id}]});
        if(iteration===1){
          if(parent.fd!==previous)throw Error("second spawn did not reuse a former descriptor number");
          emit({event:"second-spawn-reuse",iteration,reused:[parent.fd],construction:"identified-reservation-dup2"});
          if(input.fault==="second-spawn-close"){
            // Corrupt the replacement while it is alive, but only after its
            // request was written. Otherwise the control races a child EPIPE
            // diagnostic instead of testing the parent's stale descriptor owner.
            if(duplex){
              const until=Date.now()+3000;
              while(!existsSync(ready)&&child.exitCode===null&&Date.now()<until)await Bun.sleep(5);
              if(!existsSync(ready))throw Error("control request missing before stale close");
              // Drain the request before destroying its socket. Linux resets a
              // peer with unread data; that incidental child ECONNRESET races
              // the intended parent ownership assertion. EOF is sufficient.
              const request=Buffer.alloc(8),n=readSync(parent.fd,request,0,8,null);
              if(n!==8||request.toString()!=="request\n")throw Error("control request mismatch before stale close");
            }
            closeSync(parent.fd);
          }
        }
        Bun.gc(true);await Bun.sleep(5);Bun.gc(true);
        if(!same(parent.fd,parent.id))throw Error("replacement spawn descriptor lost");
        const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("control exchange deadline")),5000);});
        if(duplex){
          const until=Date.now()+3000;
          while(!existsSync(ready)&&child.exitCode===null&&Date.now()<until)await Bun.sleep(5);
          if(!existsSync(ready))throw Error("control request missing");
          const request=Buffer.alloc(8),n=readSync(parent.fd,request,0,8,null);
          if(n!==8||request.toString()!=="request\n")throw Error("control request mismatch");
        }
        writeSync(parent.fd,"response\n");parent.close();
        const code=await Promise.race([exited,deadline]);await closed;
        emit({event:"reaped",iteration,code,request:duplex?"request\n":""});
        if(code!==0)throw Error("control EOF exchange failed");
      } finally {
        clearTimeout(timer);
        if(child&&child.exitCode===null&&child.signalCode===null)child.kill("SIGKILL");
        await exited;await closed;source.close();parent.close();
      }
      const directory=join(home,String(iteration));mkdirSync(directory);
      // Retain the freshly reclaimed regular file AFTER all eight sensitive GC
      // checks. It reserves the exact former parent number for the next spawn.
      await input.check({former:[parent.fd],directory,emit:e=>emit({iteration,...e}),staleClose:input.fault==="stale-second-close",
        reserveFormer:iteration<7?fd=>{reservation=own(fd);}:undefined});
      previous=parent.fd;
    }
    emit({event:"complete",exchanges:8,reuse:true,failures:[]});
  } finally {reservation?.close();rmSync(home,{recursive:true,force:true});}
}
