import { expect, test } from "bun:test";
import { command, checkpointFiles } from "./extension-channel-checkpoint-command.ts";

const present = "scripts/extension-channel-checkpoint-command.test.ts";
test("checkpoint files are explicit paths, never bare Bun filters", () => {
  expect(checkpointFiles(present, `./${present}`)).toEqual([`./${present}`, `./${present}`]);
});
test("a missing file refuses even alongside a matching test file", () => {
  expect(() => checkpointFiles(present, "scripts/check-native-load-fence.test.ts"))
    .toThrow("qualification file missing or not regular: ./scripts/check-native-load-fence.test.ts");
  expect(() => checkpointFiles("scripts")).toThrow("not regular");
});
test("command scrubs agent reporter modes without mutating the caller or JIT lane", async () => {
  const env = { ...process.env, CLAUDECODE: "1", FORCE_COLOR: "1", NO_COLOR: "1", BUN_JSC_useDFGJIT: "0" };
  const result = await command([process.execPath, "--eval", `
    console.log(JSON.stringify({
      agent:process.env.CLAUDECODE??null,
      color:process.env.FORCE_COLOR??null,
      noColor:process.env.NO_COLOR??null,
      jit:process.env.BUN_JSC_useDFGJIT
    }));
  `], env);
  expect(JSON.parse(result)).toEqual({ agent: null, color: null, noColor: null, jit: "0" });
  expect(env.CLAUDECODE).toBe("1");
  expect(env.FORCE_COLOR).toBe("1");
  expect(env.NO_COLOR).toBe("1");
});
test("command refuses nonzero status", async () => {
  await expect(command([process.execPath, "--eval", "process.exit(7)"])).rejects.toThrow("qualification command failed");
});

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyFenceInventory } from "./extension-channel-checkpoint-command.ts";
import { expectedFenceInventory, fenceInventoryDigest, readFenceInventory, verifyExpectedFenceInventory, type FenceInventory } from "./extension-channel-fence-inventory.ts";

test("fence inventory requires named retirements and rejects partial, vacuous and same-count substitutions", async () => {
  const root = mkdtempSync(join(tmpdir(),"checkpoint-inventory-"));
  const policy = join(root,"scripts/sync-exec-allowlist/packages/fixture");
  mkdirSync(policy,{recursive:true});mkdirSync(join(root,"packages/fixture"),{recursive:true});mkdirSync(join(root,"apps"));
  const add = (name:string) => {
    const path = `packages/fixture/${name}.ts`;
    writeFileSync(join(root,path),"Bun.spawnSync([]);");
    mkdirSync(join(policy,`${name}.ts`),{recursive:true});
    writeFileSync(join(policy,`${name}.ts/Bun.spawnSync.json`),JSON.stringify({path,symbol:"Bun.spawnSync",category:"test",reason:"static fixture",owner:"test"}));
  };
  const fence = async () => {
    const child=Bun.spawn([process.execPath,join(import.meta.dir,"check-sync-exec-fence.ts")],{cwd:root,stdout:"pipe",stderr:"pipe"});
    const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    return {code,output:out+err};
  };
  const remove = (name: string) => {
    unlinkSync(join(root,`packages/fixture/${name}.ts`));
    rmSync(join(policy,`${name}.ts`),{recursive:true});
  };
  try {
    add("a");add("b");
    const manifest: FenceInventory = {schema:"scout.extension-channel-fence-inventory/v1",baseline:{sourceHead:"a".repeat(40),expectedCount:2,pairs:[...readFenceInventory(root).values()]},changes:[]};
    const anchor=fenceInventoryDigest(manifest.baseline);
    let expected=expectedFenceInventory(manifest,anchor);
    const verify=(output:string)=>verifyExpectedFenceInventory(output,readFenceInventory(root),expected);
    const full=await fence();expect(full.code).toBe(0);expect(verify(full.output)).toBe(2);
    expect(()=>verify("Sync exec fence passed (1 allowlisted symbol/file pairs).")).toThrow("inventory mismatch");
    expect(()=>verify("Sync exec fence passed (0 allowlisted symbol/file pairs).")).toThrow("inventory mismatch");
    expect(()=>verify(full.output+full.output)).toThrow("inventory mismatch");
    expect(()=>verify("")).toThrow("inventory mismatch");
    unlinkSync(join(root,"packages/fixture/b.ts"));
    const partial=await fence();expect(partial.code).toBe(1);expect(partial.output).toContain("no matching usage was found");
    rmSync(join(policy,"b.ts"),{recursive:true});
    const retired=await fence();expect(retired.code).toBe(0);
    // A legitimate source/policy retirement still refuses until it is NAMED.
    expect(()=>verify(retired.output)).toThrow("inventory mismatch");
    manifest.changes.push({id:"retire-b",sourceHead:"b".repeat(40),reason:"Fixture b now uses asynchronous execution",fromCount:2,toCount:1,
      retired:[{...manifest.baseline.pairs.find(p=>p.path.endsWith("/b.ts"))!,reason:"Retire b's obsolete synchronous fixture call"}],added:[]});
    expected=expectedFenceInventory(manifest,anchor);
    expect(verify(retired.output)).toBe(1);
    remove("a");add("c");
    const swapped=await fence();expect(swapped.code).toBe(0);
    expect(()=>verify(swapped.output)).toThrow("unaccounted removal or policy edit");
    remove("c");add("a");
    writeFileSync(join(policy,"a.ts/Bun.spawnSync.json"),JSON.stringify({path:"packages/fixture/a.ts",symbol:"Bun.spawnSync",category:"cli",reason:"unreviewed policy change",owner:"test"}));
    const edited=await fence();expect(edited.code).toBe(0);
    expect(()=>verify(edited.output)).toThrow("unaccounted removal or policy edit");
    remove("a");
    const empty=await fence();expect(empty.code).toBe(0);expect(()=>verify(empty.output)).toThrow("inventory mismatch");
    rmSync(join(root,"apps"),{recursive:true});
    expect(()=>verify(empty.output)).toThrow();
  } finally {rmSync(root,{recursive:true,force:true});}
});

test("expected inventory refuses silent baseline changes and unnamed policy transitions",()=>{
  const original={path:"packages/fixture/a.ts",symbol:"cc",policySha256:fenceInventoryDigest({sourceFiles:["packages/fixture/a.c"]})};
  const wider={...original,policySha256:fenceInventoryDigest({sourceFiles:["packages/fixture/a.c","packages/fixture/b.c"]})};
  const reviewed={...original,policySha256:fenceInventoryDigest({sourceFiles:["packages/fixture/a.c"],reason:"Clarify the same fixed source"})};
  const manifest: FenceInventory={schema:"scout.extension-channel-fence-inventory/v1",baseline:{sourceHead:"a".repeat(40),expectedCount:1,pairs:[original]},changes:[]};
  const anchor=fenceInventoryDigest(manifest.baseline);
  const initial=expectedFenceInventory(manifest,anchor);
  const actual=new Map([[`${wider.path}\0${wider.symbol}`,wider]]);
  expect(()=>verifyExpectedFenceInventory("Sync exec fence passed (1 allowlisted symbol/file pairs).",actual,initial)).toThrow("unaccounted removal or policy edit");
  expect(()=>expectedFenceInventory({...manifest,baseline:{...manifest.baseline,pairs:[wider]}},anchor)).toThrow("baseline changed without named accounting");
  expect(()=>expectedFenceInventory({...manifest,baseline:{...manifest.baseline,expectedCount:0,pairs:[]}},anchor)).toThrow("baseline changed without named accounting");
  const change={id:"named-policy-change",sourceHead:"b".repeat(40),reason:"Explicit audit-note change, retaining the same fixed source",fromCount:1,toCount:1,
    retired:[{...original,reason:"Replace the old policy text"}],added:[{...reviewed,reason:"Clarify the reason without changing sourceFiles"}]};
  for(const bad of [
    {...change,reason:""},
    {...change,retired:[{...original,reason:""}]},
    {...change,added:[{...reviewed,reason:""}]},
    {...change,fromCount:2},
    {...change,toCount:2},
  ]) expect(()=>expectedFenceInventory({...manifest,changes:[bad]},anchor)).toThrow();
  const named=expectedFenceInventory({...manifest,changes:[change]},anchor);
  expect(verifyExpectedFenceInventory("Sync exec fence passed (1 allowlisted symbol/file pairs).",new Map([[`${reviewed.path}\0${reviewed.symbol}`,reviewed]]),named)).toBe(1);
  expect(()=>verifyExpectedFenceInventory("Sync exec fence passed (1 allowlisted symbol/file pairs).",actual,named)).toThrow("unaccounted removal or policy edit");
  expect(()=>expectedFenceInventory({...manifest,changes:[change,change]},anchor)).toThrow();
});

test("checkpoint uses the fixed expected ledger rather than deriving approval from disk",()=>{
  const count=readFenceInventory(process.cwd()).size;
  expect(verifyFenceInventory(`Sync exec fence passed (${count} allowlisted symbol/file pairs).`)).toBe(count);
});

test("preloaded proof tests select the test command, never the package test script",async()=>{
  const root=mkdtempSync(join(tmpdir(),"checkpoint-preload-"));
  try {
    writeFileSync(join(root,"package.json"),JSON.stringify({scripts:{test:"echo WRONG_PACKAGE_SCRIPT; exit 9"}}));
    writeFileSync(join(root,"preload.ts"),"globalThis.__checkpointPreloaded=true;");
    writeFileSync(join(root,"selected.test.ts"),"import {test,expect} from 'bun:test'; test('explicit-preload-selection',()=>expect(globalThis.__checkpointPreloaded).toBe(true));");
    writeFileSync(join(root,"unselected.test.ts"),"throw Error('WRONG_UNSELECTED_FILE');");
    const child=Bun.spawn([process.execPath,"test","--preload","./preload.ts","./selected.test.ts"],{cwd:root,env:{...process.env,CLAUDECODE:undefined,FORCE_COLOR:undefined},stdout:"pipe",stderr:"pipe"});
    const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    expect(code).toBe(0);expect(out+err).toContain("explicit-preload-selection");
    expect(out+err).not.toContain("WRONG_");expect(out+err).toMatch(/1 pass/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("nonzero command drains both piped output tails before its parent exits", async () => {
  const root = mkdtempSync(join(tmpdir(), "checkpoint-output-tail-"));
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const bytes = 2 * 1024 * 1024;
    const stdout = "o".repeat(bytes) + "\nLAST_STDOUT_REFUSAL_LINE\n";
    const stderr = "e".repeat(bytes) + "\nLAST_STDERR_REFUSAL_LINE\n";
    const writer = join(root, "writer.ts"), parent = join(root, "parent.ts");
    writeFileSync(writer, `import {writeSync} from "node:fs";
      const writeAll=(fd,text)=>{const bytes=Buffer.from(text);let offset=0;while(offset<bytes.length)offset+=writeSync(fd,bytes,offset,bytes.length-offset);};
      writeAll(1,"o".repeat(${bytes})+"\\nLAST_STDOUT_REFUSAL_LINE\\n");
      writeAll(2,"e".repeat(${bytes})+"\\nLAST_STDERR_REFUSAL_LINE\\n");
      process.exit(1);`);
    writeFileSync(parent, `import {command} from ${JSON.stringify(join(import.meta.dir,"extension-channel-checkpoint-command.ts"))};
      try {await command([process.execPath,${JSON.stringify(writer)}]);}
      catch(error) {process.exit(String(error).includes("qualification command failed:")?1:2);}
      process.exit(3);`);
    child = Bun.spawn([process.execPath, parent], {stdout: "pipe", stderr: "pipe"});
    timer = setTimeout(() => child?.kill("SIGKILL"), 10000);
    // Let the parent's pipes fill before consuming them, rather than relying
    // on the platform's pipe capacity or the scheduler to expose the bug.
    await Bun.sleep(100);
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect(code).toBe(1);
    expect(out).toBe(stdout);
    expect(err).toBe(stderr);
  } finally {
    clearTimeout(timer);
    if (child) {if (child.exitCode === null) child.kill("SIGKILL"); await child.exited;}
    rmSync(root, {recursive: true, force: true});
  }
}, 15000);
