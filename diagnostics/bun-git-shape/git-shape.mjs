// Standalone Bun diagnostic. No Scout import. Forced finalization timing adapted
// from oven-sh/bun#44581 (MIT). Not production code or a qualification witness.
import { execFileSync } from 'node:child_process';
import { openSync, writeSync } from 'node:fs';
const fixture = process.argv[2];
const record = data => writeSync(2, JSON.stringify({ event:'git-shape', ...data })+'\n');
const heldFds=[];
// Match the observed descriptor height, not any application module graph.
// Holding one stable file read-only cannot import an application or open IPC.
let last=0;
while (last<584) { last=openSync(import.meta.filename,'r'); heldFds.push(last); }
globalThis.writers=[];
const refs=[];
for (let i=0;i<2;i++) {
 const writer=Bun.stdout.writer(); writer.write(''); writer.flush();
 globalThis.writers.push(writer); refs.push(new WeakRef(writer));
}
globalThis.pressure=Bun.stdout.writer();
globalThis.pressure.write(Buffer.alloc(4*1024*1024,120));
await Bun.sleep(0);
const prime=Bun.spawnSync({cmd:['true'],stdout:'pipe',stderr:'pipe',timeout:2000,
 get maxBuffer(){Bun.gc(true);globalThis.writers=null;},
});
let collected=0;
for(const ref of refs) if(ref.deref()===undefined)collected++;
record({phase:'before-git',collected,primeCode:prime.exitCode,primeTimeout:prime.exitedDueToTimeout,lastHeldFd:last,heldFdCount:heldFds.length,revision:Bun.revision});
const start=performance.now(),cpu=process.cpuUsage();
try {
 const branch=execFileSync('git',['-C',fixture,'rev-parse','--abbrev-ref','HEAD'],{stdio:['ignore','pipe','ignore'],encoding:'utf8'});
 record({phase:'after-git',branch:branch.trim(),elapsedMs:performance.now()-start,cpuMicros:process.cpuUsage(cpu)});
 process.exit(0);
}catch(error){record({phase:'git-error',code:error.code,elapsedMs:performance.now()-start});process.exit(1);}
