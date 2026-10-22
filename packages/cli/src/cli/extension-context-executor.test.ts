import {expect,test} from "bun:test";
import {spawn,type ChildProcess} from "node:child_process";
import {EventEmitter} from "node:events";
import {executeScoutExtensionContext, scoutExtensionContextStdio, EXTENSION_CONTEXT_DELIVERY_TIMEOUT_MS} from "./extension-context-executor.ts";
import {BoundedChannelDescriptor,type ChannelDriver} from "../../../runtime/src/extension-channel-io.ts";
import {allocateExtensionChannel} from "../../../runtime/src/extension-channel-host.ts";
import {currentExtensionChannelCoordinate} from "../../../runtime/src/extension-channel-qualification.ts";
import {prefillForWriteAbort} from "../../../../scripts/extension-numeric-spike/witness.ts";
import {writeSync} from "node:fs";
const input={command:process.execPath,args:[] as string[],env:process.env,cwd:process.cwd(),wire:Buffer.from('{}\n')};
function doubles(write:ChannelDriver["write"] = (_fd,bytes)=>bytes.length) {
 const calls:Array<{fd:number;op:string}>=[];
 const driver:ChannelDriver={read(fd){calls.push({fd,op:"read"});return -1;},write(fd,bytes){calls.push({fd,op:"write"});return write(fd,bytes);},close(fd){calls.push({fd,op:"close"});return 0;}};
 return {channel:{parent:new BoundedChannelDescriptor(101,driver),source:new BoundedChannelDescriptor(102,driver),target:5 as 5|6},calls};
}
function fakeChild() {
 const child=new EventEmitter() as ChildProcess;
 Object.assign(child,{exitCode:null,signalCode:null,pid:999999,kill(signal:string){Object.assign(child,{signalCode:signal});queueMicrotask(()=>child.emit("close",null,signal));return true;}});
 return child;
}
function closes(calls:Array<{fd:number;op:string}>) {expect(calls.filter(c=>c.op==="close")).toEqual([{fd:102,op:"close"},{fd:101,op:"close"}]);}
test("synchronous spawn throw closes BOTH adapter drivers exactly once, source before await",async()=>{
 const f=doubles();let synchronous=false;
 const promise=executeScoutExtensionContext(input,()=>f.channel,(()=>{throw Error("spawn throw");}) as typeof spawn);
 synchronous=f.channel.source.closed&&f.channel.parent.closed;
 await expect(promise).rejects.toThrow("spawn throw");expect(synchronous).toBe(true);closes(f.calls);
});
test("allocation/target/mapping/listener failures are covered by finally",async()=>{
 await expect(executeScoutExtensionContext(input,()=>{throw Error("allocation");})).rejects.toThrow("allocation");
 for(const target of [4,5]) {const f=doubles();f.channel.target=target as 5;if(target===5)Object.defineProperty(f.channel.source,"fd",{value:5});
 await expect(executeScoutExtensionContext(input,()=>f.channel)).rejects.toThrow("context_delivery_failed");
 expect(f.calls.filter(c=>c.op==="close")).toHaveLength(2);expect(f.channel.parent.closed).toBe(true);expect(f.channel.source.closed).toBe(true);}
 const f=doubles(),child=fakeChild(),on=child.on;child.on=function(this:ChildProcess,event,...rest){if(event==="error")throw Error("setup");return Reflect.apply(on,this,[event,...rest]);} as typeof child.on;
 await expect(executeScoutExtensionContext(input,()=>f.channel,(()=>child) as typeof spawn)).rejects.toThrow("setup");closes(f.calls);expect(child.signalCode).toBe("SIGTERM");
});
test("async spawn error and early close cancel pending writes, no losing branch continues",async()=>{
 for(const kind of ["error","close"]){const f=doubles(()=>-1),child=fakeChild();
 const promise=executeScoutExtensionContext(input,()=>f.channel,(()=>{setTimeout(()=>{if(kind==="error")child.emit("error",Error("ENOENT"));else {Object.assign(child,{exitCode:0});child.emit("close",0,null);}},10);return child;}) as typeof spawn);
 await expect(promise).rejects.toThrow();closes(f.calls);const count=f.calls.length;await Bun.sleep(15);expect(f.calls).toHaveLength(count);}
});
test("external abort and SIGINT cancel pending I/O without forwarding SIGINT",async()=>{
 for(const mode of ["abort","SIGINT"]){const f=doubles(()=>-1),child=fakeChild(),abort=new AbortController();let intForwarded=false;
 const kill=child.kill;child.kill=function(signal){if(signal==="SIGINT")intForwarded=true;return Reflect.apply(kill,this,[signal]);};
 const promise=executeScoutExtensionContext({...input,signal:abort.signal},()=>f.channel,(()=>child) as typeof spawn);
 if(mode==="abort")abort.abort();else process.emit("SIGINT","SIGINT");
 await expect(promise).rejects.toThrow();closes(f.calls);expect(intForwarded).toBe(false);}
});
test("successful write closes EOF before waiting; long command retains status, removes listeners",async()=>{
 const f=doubles(),child=fakeChild(),before=process.listenerCount("SIGTERM");
 const pending=executeScoutExtensionContext(input,()=>f.channel,(()=>child) as typeof spawn);
 await Bun.sleep(5);process.emit("SIGINT","SIGINT");expect(f.channel.parent.closed).toBe(true);expect(f.channel.source.closed).toBe(true);
 Object.assign(child,{exitCode:19});child.emit("close",19,null);expect(await pending).toBe(19);closes(f.calls);expect(process.listenerCount("SIGTERM")).toBe(before);
});
test("frame validation allocates nothing and numeric registry mapping excludes credential authority",async()=>{
 let allocated=0;await expect(executeScoutExtensionContext({...input,wire:Buffer.alloc(65537)},()=>{allocated++;return doubles().channel;})).rejects.toThrow();expect(allocated).toBe(0);
 expect(scoutExtensionContextStdio(19)).toEqual(["inherit","inherit","inherit","ignore","ignore",19,"ignore","ignore"]);
 expect(()=>scoutExtensionContextStdio(5)).toThrow();
});
const measured=currentExtensionChannelCoordinate()?test:test.skip;
measured("real runner maps slot 5 numerically, delivers EOF and owns no extra stream",async()=>{
 let channel:ReturnType<typeof allocateExtensionChannel>|undefined;let output="";
 const code=await executeScoutExtensionContext({...input,args:["-e",`import{readFileSync}from'node:fs';if(readFileSync(5,'utf8')!=='{}\\n')process.exit(91);console.log('eof');`]},()=>channel=allocateExtensionChannel("context"),((cmd,args,options)=>{
   const stdio=[...options!.stdio as any[]];expect(stdio[5]).toBe(channel!.source.fd);stdio[1]="pipe";const child=spawn(cmd,args!,{...options,stdio});
   expect((child.stdio as unknown[])[5]).toBeNull();child.stdout!.on("data",chunk=>output+=chunk);return child;
 }) as typeof spawn);
 expect(code).toBe(0);expect(output.trim()).toBe("eof");expect(channel!.source.stats.closeCalls).toBe(1);expect(channel!.parent.stats.closeCalls).toBe(1);
});
for(const mode of ["timeout","cancel"] as const) measured(`real runner ${mode} proves kernel EAGAIN and exact partial frame at product deadline`,async()=>{
 let channel:ReturnType<typeof allocateExtensionChannel>,child:ChildProcess,output="",errors="",primer=0,held=false;
 const abort=new AbortController();let closeTime=0,start=0;
 const allocate=()=>{
   channel=allocateExtensionChannel("context");primer=prefillForWriteAbort(bytes=>writeSync(channel.parent.fd,bytes)).bytes;
   const write=channel.parent.write.bind(channel.parent),close=channel.parent.close.bind(channel.parent);
   channel.parent.write=async(bytes,options)=>{while(!held)await Bun.sleep(1);start=Date.now();if(mode==="cancel")setTimeout(()=>abort.abort(),10);return await write(bytes,options);};
   channel.parent.close=(reason)=>{if(!channel.parent.closed){closeTime=Date.now();child?.stdin?.write('d');}close(reason);};
   return channel;
 };
 const script=`process.on('SIGTERM',()=>{});import{readSync}from'node:fs';const b=Buffer.alloc(4096),c=Buffer.alloc(1);let all='';while(all.length<4096){const n=readSync(5,b,0,4096-all.length,null);if(!n)process.exit(91);all+=b.subarray(0,n);}console.log('held');if(readSync(0,c,0,1,null)!==1)process.exit(92);for(;;){const n=readSync(5,b);if(!n)break;all+=b.subarray(0,n);}if(!all.startsWith('p'.repeat(${"${PRIMER}"}))||all.slice(${"${PRIMER}"})!=='r'.repeat(4096))process.exit(93);console.log('eof');`;
 const pending=executeScoutExtensionContext({...input,wire:Buffer.from('r'.repeat(65535)+'\n'),signal:abort.signal,args:["-e",script]},allocate,((cmd,args,options)=>{
   // Primer is known only after allocation; substitute in the bounded fixture.
   const actual=args!.map(arg=>arg.replaceAll('${PRIMER}',String(primer)));const stdio=[...options!.stdio as any[]];stdio[0]="pipe";stdio[1]="pipe";stdio[2]="pipe";
   child=spawn(cmd,actual,{...options,stdio});child.stdin!.on("error",()=>{});child.stdout!.on("data",chunk=>{output+=chunk;held=output.includes('held\n');});child.stderr!.on("data",chunk=>errors+=chunk);return child;
 }) as typeof spawn);
 await expect(pending).rejects.toThrow();
 expect(channel!.parent.stats.writeBytes).toBe(4096);expect(channel!.parent.stats.writeWouldBlock).toBeGreaterThan(0);expect(channel!.parent.stats.closeCalls).toBe(1);expect(channel!.source.stats.closeCalls).toBe(1);
 if(mode==="timeout")expect(closeTime-start).toBeGreaterThanOrEqual(EXTENSION_CONTEXT_DELIVERY_TIMEOUT_MS-50);
 expect(errors).toBe("");expect(output).toContain("eof\n");expect(child!.exitCode).toBe(0);
},10000);
measured("child crash cancels a genuinely blocked delivery and reaps the invocation",async()=>{
 let channel:ReturnType<typeof allocateExtensionChannel>;
 await expect(executeScoutExtensionContext({...input,args:["-e","process.exit(7)"]},()=>{channel=allocateExtensionChannel("context");prefillForWriteAbort(bytes=>writeSync(channel.parent.fd,bytes));return channel;})).rejects.toThrow();
 expect(channel!.source.stats.closeCalls).toBe(1);expect(channel!.parent.stats.closeCalls).toBe(1);expect(channel!.parent.stats.writeWouldBlock).toBeGreaterThan(0);
});
for(const signal of ["SIGTERM","SIGHUP"] as const) measured(`foreground ${signal} forwards only to its child after EOF and retains status`,async()=>{
 let child:ChildProcess,ready=false,channel:ReturnType<typeof allocateExtensionChannel>;
 const script=`import{readFileSync}from'node:fs';readFileSync(5);process.on('${signal}',()=>process.exit(19));console.log('ready');setInterval(()=>{},1000);`;
 const pending=executeScoutExtensionContext({...input,args:["-e",script]},()=>channel=allocateExtensionChannel("context"),((cmd,args,options)=>{const stdio=[...options!.stdio as any[]];stdio[1]="pipe";child=spawn(cmd,args!,{...options,stdio});child.stdout!.on("data",()=>ready=true);return child;}) as typeof spawn);
 const deadline=Date.now()+2000;while(!ready&&Date.now()<deadline)await Bun.sleep(2);expect(ready).toBe(true);process.emit(signal,signal);expect(await pending).toBe(19);expect(child!.exitCode).toBe(19);expect(channel!.parent.stats.closeCalls).toBe(1);expect(channel!.source.stats.closeCalls).toBe(1);
});

test("child close during final yield preserves complete kernel delivery, not a false cancellation",async()=>{
 const child=fakeChild();let calls=0;const f=doubles((_fd,bytes)=>{if(++calls===4)queueMicrotask(()=>{Object.assign(child,{exitCode:19});child.emit("close",19,null);});return bytes.length;});
 const wire=Buffer.from('r'.repeat(16383)+'\n');
 expect(await executeScoutExtensionContext({...input,wire},()=>f.channel,(()=>child) as typeof spawn)).toBe(19);expect(f.channel.parent.stats.writeBytes).toBe(wire.length);closes(f.calls);
});
test("child close with partial kernel progress cancels remaining bytes before any retry",async()=>{
 const child=fakeChild();let calls=0;const f=doubles((_fd,bytes)=>{if(++calls===1){queueMicrotask(()=>{Object.assign(child,{exitCode:0});child.emit("close",0,null);});return bytes.length;}return -1;});
 await expect(executeScoutExtensionContext({...input,wire:Buffer.from('r'.repeat(16383)+'\n')},()=>f.channel,(()=>child) as typeof spawn)).rejects.toThrow();expect(f.channel.parent.stats.writeBytes).toBe(4096);closes(f.calls);const count=f.calls.length;await Bun.sleep(15);expect(f.calls).toHaveLength(count);
});

measured("real missing executable closes both native adapters on spawn failure",async()=>{
 let channel:ReturnType<typeof allocateExtensionChannel>;
 await expect(executeScoutExtensionContext({...input,command:"/nonexistent-scout-extension-context-fixture"},()=>channel=allocateExtensionChannel("context"))).rejects.toThrow();
 expect(channel!.parent.stats.closeCalls).toBe(1);expect(channel!.source.stats.closeCalls).toBe(1);
});
