/** Diagnostic control: legitimate same-process FD activity can defeat incidental
 * reuse. Keep those FDs occupied while the unchanged case passes in a child.
 * This never retries, reserves numbers for the witness, or changes its bounds.
 */
import { closeSync, fstatSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { numericWitness } from "./witness.ts";
import { command } from "../extension-channel-checkpoint-command.ts";
const root = mkdtempSync(join(tmpdir(), "reuse-contention-"));
const occupied: number[] = [];
let former: number[] = [], refusal = "";
try {
  try {
    await numericWitness("context", event => {
      if (event.event === "copy-discipline" && event.iteration === 0) former = [...event.ports as number[]];
      if (event.event === "exchange" && event.iteration === 0) {
        for (let i = 0; i < 128 && !former.every(fd => occupied.includes(fd)); i++) {
          occupied.push(openSync(join(root, String(i)), "w+"));
        }
        if (!former.length || !former.every(fd => occupied.includes(fd))) throw Error("contention control did not occupy both former numbers");
      }
    }, undefined, {io:"async",mode:"normal"});
  } catch (error) {refusal=(error as Error).message;}
  if (refusal !== "second spawn did not reuse a former descriptor number") throw Error(`unexpected contention outcome: ${refusal}`);
  console.log(JSON.stringify({event:"same-process-reuse-refused",former,occupied,refusal}));
  const identities = () => occupied.map(fd => {const s=fstatSync(fd);return [fd,s.dev,s.ino,s.isFile()];});
  const before = JSON.stringify(identities());
  const name = "async context: whole witness, normal, 64 KiB, reclaim/reuse/collection";
  const output = await command([process.execPath,"test",join(import.meta.dir,"../../packages/cli/src/cli/extension-async-io.test.ts"),"--test-name-pattern",`^${name}$`]);
  if (!output.includes(`(pass) ${name}`) || !/\b1 pass\b/.test(output) || !/\b0 fail\b/.test(output)) throw Error("isolated unchanged case did not pass");
  if (JSON.stringify(identities()) !== before) throw Error("parent contender identity lost");
  console.log(JSON.stringify({event:"isolated-reuse-passed",parentFormerStillOccupied:true}));
} finally {
  for (const fd of occupied) closeSync(fd);
  rmSync(root,{recursive:true,force:true});
}
