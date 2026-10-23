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
