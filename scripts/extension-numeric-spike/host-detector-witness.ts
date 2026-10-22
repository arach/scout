/** Explicit real-host detector measurement; never writes or prints the report. */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentExtensionChannelCoordinate as coordinate } from "../../packages/runtime/src/extension-channel-qualification.ts";
import { allocateExtensionChannel, verifyExtensionChannelHostAssets } from "../../packages/runtime/src/extension-channel-host.ts";
import { releaseExtensionChannelCodeForWitness } from "../../packages/runtime/src/extension-channel-io.ts";
import { scoutExtensionContextBackend } from "../../packages/cli/src/cli/extension-context-host.ts";
import { runScoutExtensionWithContext, prepareScoutExtensionContext } from "../../packages/cli/src/cli/extension-context-runner.ts";
import { mutateScoutExtension } from "../../packages/cli/src/cli/extension-install.ts";
import { findScoutExtension } from "../../packages/cli/src/cli/extensions.ts";
import { captureScoutExtensionSelection } from "../../packages/cli/src/cli/extension-context.ts";
import { deriveOpenScoutInstanceLayout } from "../../packages/runtime/src/instance.ts";

const expected = process.argv[2];
if (expected !== "positive" && expected !== "negative") throw Error("expected positive or negative measurement");
const header = (process.report.getReport() as {header?: {glibcVersionRuntime?: unknown}}).header;
const result = coordinate(), enabled = scoutExtensionContextBackend();
if ((result !== null) !== (expected === "positive") || enabled !== (result !== null)) throw Error("detector outcome mismatch");
verifyExtensionChannelHostAssets();
let publicRefusal: string | null = null, noNativeLoad = false;
if (expected === "negative") {
  try { allocateExtensionChannel("context"); throw Error("unqualified allocation"); }
  catch (error) { if ((error as Error).message !== "extension_channel_host_unavailable") throw error; }
  const base = mkdtempSync(join(tmpdir(), "scout-detector-")), source = join(base, "provider"), home = join(base, "home");
  mkdirSync(source); mkdirSync(home);
  const env = {HOME:home,PATH:process.env.PATH,SCOUT_HOME:join(home,"scout"),OPENSCOUT_EXTENSIONS_HOME:join(home,"extensions"),OPENSCOUT_INSTANCE:"prod"};
  writeFileSync(join(source,"extension.json"),JSON.stringify({api:2,version:"1.0.0",command:"run",invocation:{context:"scout.extension-context/v1",requires:["selection/v1"]}}));
  writeFileSync(join(source,"run"),"#!/bin/sh\nexit 91\n",{mode:0o700});
  try {
    mutateScoutExtension("install","detector-fixture",source,env);
    const extension = findScoutExtension("detector-fixture",env)!;
    const cwd = process.cwd(), layout = deriveOpenScoutInstanceLayout({env,home,name:"prod",hostname:"detector"});
    const selection = captureScoutExtensionSelection({layout,env,home,uid:process.getuid!(),cwd});
    const frame = prepareScoutExtensionContext({extension,env,selection,cli:{version:"witness",executable:process.argv[1]!,runtimeExecutable:process.execPath,output:"json",cwd},brokerUrl:"http://127.0.0.1:43110"});
    const raw = Bun.spawn; let spawns = 0;
    Bun.spawn = (()=>{spawns++;throw Error("unexpected provider spawn");}) as typeof Bun.spawn;
    try {
      try { await runScoutExtensionWithContext(extension,[],env,frame,env);throw Error("public dispatch accepted"); }
      catch (error) { publicRefusal=(error as {reason?:string}).reason??null;if(publicRefusal!=="context_backend_unproven")throw error; }
      if(spawns!==0)throw Error("provider spawn observed");
    } finally {Bun.spawn=raw;}
    try {releaseExtensionChannelCodeForWitness(()=>{});throw Error("native code loaded");}
    catch(error){if(!(error as Error).message.includes("no extension channel code loaded"))throw error;noNativeLoad=true;}
  } finally {rmSync(base,{recursive:true,force:true});}
}
console.log(JSON.stringify({event:"real-host-detector",version:Bun.version,revision:Bun.revision,platform:process.platform,arch:process.arch,
  glibcFieldPresent:typeof header?.glibcVersionRuntime!=="undefined",glibcVersionRuntime:header?.glibcVersionRuntime??null,coordinate:result,contextEnabled:enabled,
  assetsValid:true,publicRefusal,noNativeLoad:expected==="negative"?noNativeLoad:null}));
