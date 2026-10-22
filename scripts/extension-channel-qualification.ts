/** Explicit checkpoint runner; never dispatches CI or opens a product gate. */
import {readFileSync} from "node:fs";
import {currentExtensionChannelCoordinate, EXTENSION_CHANNEL_QUALIFICATION as Q} from "../packages/runtime/src/extension-channel-qualification.ts";
if (!currentExtensionChannelCoordinate()) throw Error("qualification job requires the exact supported host; skips are not evidence");
console.log(JSON.stringify({event:"qualification-host",coordinate:currentExtensionChannelCoordinate(),version:Bun.version,revision:Bun.revision,ruling:Q.ruling}));
async function command(args: string[], env = process.env) {
  const child = Bun.spawn(args,{env,stdout:"pipe",stderr:"pipe"});
  const [out,err,code] = await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
  process.stdout.write(out); process.stderr.write(err);
  if (code !== 0) throw Error(`qualification command failed: ${args.join(" ")}`);
  return out+err;
}
const cold = await command([process.execPath,"scripts/extension-numeric-spike/witness.ts","credential","none","async","read-timeout"],{...process.env,BUN_JSC_useDFGJIT:"0"});
const events = cold.trim().split("\n").filter(line=>line.startsWith("{")).map(line=>JSON.parse(line));
if (events.filter(e=>e.event==="native-collected").length !== 9 || events.filter(e=>e.event==="reclaim-check").length < 160
  || !events.some(e=>e.event==="second-spawn-reuse") || !events.some(e=>e.event==="complete"&&e.modeExchanges===8&&e.reapFirstExchanges===1&&e.reuse===true)
  || events.some(e=>e.event==="failure"||e.event==="collection-incomplete")) throw Error("cold witness completion record missing");
const warmEnv = {...process.env}; delete warmEnv.BUN_JSC_useDFGJIT;
const matrix = await command([process.execPath,"test","packages/cli/src/cli/extension-async-io.test.ts"],warmEnv);
if (!/\b(\d+) pass\b/.test(matrix) || Number(matrix.match(/\b(\d+) pass\b/)![1]) < 28 || /\b[1-9]\d* skip\b/.test(matrix) || !/\b0 fail\b/.test(matrix)) throw Error("warm matrix incomplete/skipped");
await command([process.execPath,"test","packages/runtime/src/extension-channel-io.test.ts","packages/runtime/src/extension-channel-qualification.test.ts","scripts/extension-numeric-spike/pipe-pressure.test.ts","scripts/check-native-compile-fence.test.ts","scripts/check-native-load-fence.test.ts","packages/cli/src/cli/extension-context.test.ts"],warmEnv);
await command(["node","--test","packages/cli/test/extension-channel-package.test.mjs"],warmEnv);
const allowance = JSON.parse(readFileSync("scripts/sync-exec-allowlist/packages/runtime/src/extension-channel-io.ts/cc.json","utf8"));
if (allowance.path!=="packages/runtime/src/extension-channel-io.ts" || allowance.symbol!=="cc" || allowance.category!=="native-compile"
  || JSON.stringify(allowance.sourceFiles)!==JSON.stringify(["packages/runtime/src/extension-channel-native.c"])) throw Error("fixed-source fence restriction changed");
const fence = await command([process.execPath,"scripts/check-sync-exec-fence.ts"]);
if (Number(fence.match(/\((\d+) allowlisted/)?.[1]??0)<174) throw Error("fence inventory regressed");
