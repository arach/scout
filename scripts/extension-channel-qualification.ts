/** Explicit checkpoint runner; never dispatches CI or opens a product gate. */
import {readFileSync} from "node:fs";
import {checkpointFiles, command, verifyFenceInventory} from "./extension-channel-checkpoint-command.ts";
import {currentExtensionChannelCoordinate, EXTENSION_CHANNEL_QUALIFICATION as Q} from "../packages/runtime/src/extension-channel-qualification.ts";
if (!currentExtensionChannelCoordinate()) throw Error("qualification job requires the exact supported host; skips are not evidence");
console.log(JSON.stringify({event:"qualification-host",coordinate:currentExtensionChannelCoordinate(),version:Bun.version,revision:Bun.revision,ruling:Q.ruling,sourceHead:Q.head,adapter:Q.adapter,shim:Q.shim}));
await command([process.execPath,"test",...checkpointFiles("scripts/extension-channel-checkpoint-command.test.ts")]);
await command([process.execPath,...checkpointFiles("scripts/extension-numeric-spike/host-detector-witness.ts"),"positive"]);
const cold = await command([process.execPath,...checkpointFiles("scripts/extension-numeric-spike/witness.ts"),"credential","none","async","read-timeout"],{...process.env,BUN_JSC_useDFGJIT:"0"});
const events = cold.trim().split("\n").filter(line=>line.startsWith("{")).map(line=>JSON.parse(line));
if (events.filter(e=>e.event==="native-collected").length !== 9 || events.filter(e=>e.event==="reclaim-check").length < 160
  || !events.some(e=>e.event==="second-spawn-reuse") || !events.some(e=>e.event==="complete"&&e.modeExchanges===8&&e.reapFirstExchanges===1&&e.reuse===true)
  || events.some(e=>e.event==="failure"||e.event==="collection-incomplete")) throw Error("cold witness completion record missing");
const warmEnv = {...process.env}; delete warmEnv.BUN_JSC_useDFGJIT;
const matrix = await command([process.execPath,"test",...checkpointFiles("packages/cli/src/cli/extension-async-io.test.ts")],warmEnv);
if (!/\b(\d+) pass\b/.test(matrix) || Number(matrix.match(/\b(\d+) pass\b/)![1]) < 28 || /\b[1-9]\d* skip\b/.test(matrix) || !/\b0 fail\b/.test(matrix)) throw Error("warm matrix incomplete/skipped");
const controls=["stale-second-close","second-spawn-close","finalizer-close","mapping","eof","cloexec","collection-retained","cancel-double-close"];
// Freeze case identities, not just totals: replacing a deleted control with an
// unrelated passing test must not keep this checkpoint green.
for(const form of ["context","credential"]) {
  for(const mode of ["normal","timeout","cancel","crash",...(form==="credential"?["read-timeout","read-cancel"]:[])]) {
    if(!matrix.includes(`(pass) async ${form}: whole witness, ${mode}, 64 KiB, reclaim/reuse/collection`)) throw Error("required exchange case missing");
  }
  for(const control of controls) if(!matrix.includes(`(pass) async ${form} sensitivity: ${control}`)) throw Error("required sensitivity control missing");
}
for(const name of ["compiled helper collection refuses retained wrapper","compiled helper collection cannot close reclaimed endpoint numbers"]) if(!matrix.includes(`(pass) ${name}`)) throw Error("compiler collection control missing");
const cohort = await command([process.execPath,"test",...checkpointFiles("packages/runtime/src/extension-channel-io.test.ts","packages/runtime/src/extension-channel-qualification.test.ts","scripts/extension-numeric-spike/pipe-pressure.test.ts","scripts/check-native-compile-fence.test.ts","packages/runtime/src/supervision-handoff/native-load-fence.test.ts","packages/cli/src/cli/extension-context.test.ts")],warmEnv);
if (!/Ran \d+ tests across 6 files\./.test(cohort) || /\b[1-9]\d* skip\b/.test(cohort)) throw Error("pure/pressure/fence cohort incomplete/skipped");
for (const name of [
  "public API2 install, binary stdin, argv, context EOF, cwd, output and descendant closure",
  "public context dispatch: eight qualified invocations or zero-spawn unsupported refusals",
  "independent credential guard refuses through public dispatch before native load/allocation or provider spawn",
  "unsupported runtime coordinates refuse public dispatch before native load or spawn",
  "selection changed during fixed host loading refuses before allocation",
  "after-context sentinel keeps fresh descriptor identities through repeated GC",
]) if (!cohort.includes(`(pass) ${name}`)) throw Error("context activation case missing");
const runner = await command([process.execPath,"test",...checkpointFiles("packages/cli/src/cli/extension-context-executor.test.ts","packages/cli/src/cli/extension-context-reclaim.test.ts")],warmEnv);
if (Number(runner.match(/\b(\d+) pass\b/)?.[1]??0)<25 || /\b[1-9]\d* skip\b/.test(runner)) throw Error("actual-runner positive cohort incomplete/skipped");
await command(["node","--test",...checkpointFiles("packages/cli/test/extension-channel-package.test.mjs")],warmEnv);
for(const control of controls) if(!runner.includes(`(pass) actual context runner sensitivity: ${control}`)) throw Error("actual-runner sensitivity control missing");
const allowance = JSON.parse(readFileSync("scripts/sync-exec-allowlist/packages/runtime/src/extension-channel-io.ts/cc.json","utf8"));
if (allowance.path!=="packages/runtime/src/extension-channel-io.ts" || allowance.symbol!=="cc" || allowance.category!=="native-compile"
  || JSON.stringify(allowance.sourceFiles)!==JSON.stringify(["packages/runtime/src/extension-channel-native.c"])) throw Error("fixed-source fence restriction changed");
const fence = await command([process.execPath,...checkpointFiles("scripts/check-sync-exec-fence.ts")]);
console.log(JSON.stringify({event:"fence-inventory",pairs:verifyFenceInventory(fence)}));
