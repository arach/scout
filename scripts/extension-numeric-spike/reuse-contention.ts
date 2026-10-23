/** Real non-reuse: explicitly borrow/hold the identified former parent guard,
 * while the unchanged case runs in another process with an independent table.
 * Never retry or close the scaffold's borrowed reservations here.
 */
import { fstatSync } from "node:fs";
import { join } from "node:path";
import { numericWitness } from "./witness.ts";
import { readDescriptorReservations } from "./reservations.ts";
import { startNumericWitnessProcess } from "./sentinel.ts";
import { command } from "../extension-channel-checkpoint-command.ts";
export async function reuseContention() {
await startNumericWitnessProcess();
const reservations = readDescriptorReservations();
let former:number[]=[],refusal="";
try {
  await numericWitness("context",event=>{
    if(event.event==="copy-discipline"&&event.iteration===0) former=[...event.ports as number[]];
  },undefined,{io:"async",mode:"normal",apparatus:"occupied-parent"});
} catch(error) {refusal=(error as Error).message;}
if(refusal!=="second spawn did not reuse a former descriptor number") throw Error(`unexpected contention outcome: ${refusal}`);
const occupied=reservations!.victims(former).map(file=>file.fd);
console.log(JSON.stringify({event:"same-process-reuse-refused",former,occupied,refusal}));
const identities=()=>occupied.map(fd=>{const s=fstatSync(fd);return [fd,s.dev,s.ino,s.isFile()];});
const before=JSON.stringify(identities());
const name="async context: whole witness, normal, 64 KiB, reclaim/reuse/collection";
const output=await command([process.execPath,"test","--preload",join(import.meta.dir,"preload.ts"),join(import.meta.dir,"../../packages/cli/src/cli/extension-async-io.test.ts"),"--test-name-pattern",`^${name}$`]);
if(!output.includes(`(pass) ${name}`)||!/\b1 pass\b/.test(output)||!/\b0 fail\b/.test(output)) throw Error("isolated unchanged case did not pass");
if(JSON.stringify(identities())!==before) throw Error("parent contender identity lost");
console.log(JSON.stringify({event:"isolated-reuse-passed",parentFormerStillOccupied:true}));

}
if (import.meta.main) await reuseContention();
