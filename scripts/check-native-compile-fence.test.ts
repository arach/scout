import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
async function inspect(source: string, allow = true, sourceFiles = ["packages/fixture/native.c"]) {
  const root = mkdtempSync(join(tmpdir(), "native-compile-fence-"));
  mkdirSync(join(root, "packages/fixture"), {recursive: true}); mkdirSync(join(root, "scripts"));
  writeFileSync(join(root, "packages/fixture/native.ts"), 'import {cc} from "bun:ffi";\n'+source);
  const allowance = join(root, "scripts/sync-exec-allowlist/packages/fixture/native.ts");
  mkdirSync(allowance, {recursive: true});
  if (allow) writeFileSync(join(allowance, "cc.json"), JSON.stringify({path: "packages/fixture/native.ts", symbol: "cc", category: "native-compile", sourceFiles, reason: "static test fixture; never compiled or executed", owner: "test"}));
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "check-sync-exec-fence.ts")], {cwd: root, stdout: "pipe", stderr: "pipe"});
  const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
  try { const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]); return {code, output: stdout + stderr}; }
  finally {clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; rmSync(root, {recursive: true, force: true});}
}
const safe = 'cc({source: new URL("./native.c", import.meta.url), symbols: {}});';
test("native compiler requires the reviewed source and cannot load unlisted code", async () => {
  expect((await inspect(safe)).code).toBe(0);
  const missing = await inspect(safe, false); expect(missing.code).toBe(1); expect(missing.output).toContain("uses cc without");
});
for (const source of [
  'cc({source: process.env.SOURCE, symbols: {}});',
  'cc({source: new URL("./other.c", import.meta.url), symbols: {}});',
  'cc({source: new URL("./native.c", import.meta.url), symbols: {}, flags: process.env.FLAGS});',
  'cc({source: new URL("./native.c", import.meta.url), source: process.env.SOURCE, symbols: {}});',
  'cc({source: new URL("./native.c", import.meta.url), symbols: {}, ...options});',
  'const compile = cc; compile({source: new URL("./native.c", import.meta.url), symbols: {}});',
  'const {cc: compile} = ffi; compile({source: new URL("./native.c", import.meta.url), symbols: {}});',
  'cc({source: new URL("./native.c", process.env.BASE), symbols: {}});',
]) test(`native compiler fence refuses ${source}`, async () => {
  const result = await inspect(source); expect(result.code).toBe(1); expect(result.output).toContain("reviewed fixed module-relative C source");
});

for (const path of ["../outside.c", "/tmp/outside.c", "packages/fixture/../native.c", "packages/fixture/\0native.c", "packages/fixture/\\native.c"]) test(`native compiler rejects malformed reviewed source path ${JSON.stringify(path)}`, async () => {
  const result = await inspect(safe, true, [path]); expect(result.code).toBe(1); expect(result.output).toContain("repository-relative sourceFiles");
});
