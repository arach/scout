import {expect,test} from "bun:test";
import {join} from "node:path";
import {currentExtensionChannelCoordinate} from "../../../runtime/src/extension-channel-qualification.ts";
import {allocateExtensionChannel} from "../../../runtime/src/extension-channel-host.ts";
import {runnerWitness,type RunnerFault} from "../../../../scripts/extension-numeric-spike/runner-witness.ts";
import type {WitnessEvent} from "./extension-descriptor-witness.ts";
const measured=currentExtensionChannelCoordinate()?test:test.skip;
measured("actual context runner: eight exchanges, independent reap-first, reuse, fresh victims and observed collection",async()=>{
 const events:WitnessEvent[]=[];await runnerWitness(()=>allocateExtensionChannel("context"),e=>events.push(e));
 expect(events.filter(e=>e.event==="native-collected")).toHaveLength(9);expect(events.filter(e=>e.event==="second-spawn-reuse")).toHaveLength(1);
 expect(events.filter(e=>e.event==="runner-exchange")).toHaveLength(9);expect(events.filter(e=>e.event==="reclaim-check").length).toBeGreaterThanOrEqual(160);
 expect(events.filter(e=>e.event==="reap-before-close-survived")).toHaveLength(1);expect(events.at(-1)).toMatchObject({event:"complete",eofExchanges:8,reapFirstExchanges:1,reuse:true});
},30000);
const faults:Record<RunnerFault,string>={"stale-second-close":"reclaimed descriptor lost","second-spawn-close":"replacement spawn descriptor lost","finalizer-close":"finalizer closed runtime-owned number",mapping:"child mapping failed",eof:"child EOF failed",cloexec:"CLOEXEC copy discipline failed","collection-retained":"native subprocess collection was not observed within 64 GC rounds","cancel-double-close":"reclaimed descriptor lost"};
for(const [fault,message] of Object.entries(faults)) measured(`actual context runner sensitivity: ${fault}`,async()=>{
 const child=Bun.spawn([process.execPath,join(import.meta.dir,"../../../../scripts/extension-numeric-spike/runner-witness.ts"),fault],{stdout:"pipe",stderr:"pipe",env:{PATH:process.env.PATH}});
 const timer=setTimeout(()=>child.kill("SIGKILL"),20000);
 try{const [out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect(code).toBe(1);expect(err).toBe("");expect(JSON.parse(out.trim().split("\n").at(-1)!)).toMatchObject({event:"failure",fault});expect(out).toContain(message);}
 finally{clearTimeout(timer);if(child.exitCode===null)child.kill("SIGKILL");await child.exited;}
},30000);
