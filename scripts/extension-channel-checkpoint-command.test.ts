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

test("fence coverage follows legitimate retirements but rejects partial and vacuous success", async () => {
  const root = mkdtempSync(join(tmpdir(),"checkpoint-inventory-"));
  const policy = join(root,"scripts/sync-exec-allowlist/packages/fixture");
  mkdirSync(policy,{recursive:true});mkdirSync(join(root,"packages/fixture"),{recursive:true});mkdirSync(join(root,"apps"));
  const add = (name:string) => {
    const path = `packages/fixture/${name}.ts`;
    writeFileSync(join(root,path),"Bun.spawnSync([]);");
    mkdirSync(join(policy,`${name}.ts`));
    writeFileSync(join(policy,`${name}.ts/Bun.spawnSync.json`),JSON.stringify({path,symbol:"Bun.spawnSync",category:"test",reason:"static fixture",owner:"test"}));
  };
  const fence = async () => {
    const child=Bun.spawn([process.execPath,join(import.meta.dir,"check-sync-exec-fence.ts")],{cwd:root,stdout:"pipe",stderr:"pipe"});
    const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    return {code,output:out+err};
  };
  try {
    add("a");add("b");
    const full=await fence();expect(full.code).toBe(0);expect(verifyFenceInventory(full.output,root)).toBe(2);
    expect(()=>verifyFenceInventory("Sync exec fence passed (1 allowlisted symbol/file pairs).",root)).toThrow("inventory mismatch");
    expect(()=>verifyFenceInventory("Sync exec fence passed (0 allowlisted symbol/file pairs).",root)).toThrow("inventory mismatch");
    expect(()=>verifyFenceInventory(full.output+full.output,root)).toThrow("inventory mismatch");
    expect(()=>verifyFenceInventory("",root)).toThrow("inventory mismatch");
    unlinkSync(join(root,"packages/fixture/b.ts"));
    const partial=await fence();expect(partial.code).toBe(1);expect(partial.output).toContain("no matching usage was found");
    rmSync(join(policy,"b.ts"),{recursive:true});
    const retired=await fence();expect(retired.code).toBe(0);expect(verifyFenceInventory(retired.output,root)).toBe(1);
    unlinkSync(join(root,"packages/fixture/a.ts"));rmSync(join(policy,"a.ts"),{recursive:true});
    const empty=await fence();expect(empty.code).toBe(0);expect(()=>verifyFenceInventory(empty.output,root)).toThrow("inventory mismatch");
    rmSync(join(root,"apps"),{recursive:true});
    expect(()=>verifyFenceInventory(empty.output,root)).toThrow();
  } finally {rmSync(root,{recursive:true,force:true});}
});
