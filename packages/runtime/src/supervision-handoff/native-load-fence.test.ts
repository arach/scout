import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function fence(source: string, paths?: string[]) {
  const root = mkdtempSync(join(tmpdir(), "native-load-fence-"));
  const file = "packages/fixture/native.ts";
  mkdirSync(join(root, "packages/fixture"), { recursive: true }); mkdirSync(join(root, "scripts"));
  writeFileSync(join(root, file), source);
  writeFileSync(join(root, "scripts/sync-exec-allowlist.json"), JSON.stringify(paths ? [{ path: file, symbol: "dlopen", category: "dlopen",
    reason: "isolated static policy fixture; never executed", owner: "tests", libraryPaths: paths }] : []));
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "../../../../scripts/check-sync-exec-fence.ts")], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { exit, output: stdout + stderr };
  } finally { clearTimeout(timer); child.kill("SIGKILL"); await child.exited; rmSync(root, { recursive: true, force: true }); }
}
const library = "/usr/lib/libSystem.B.dylib";
test("native-load fence refuses an unlisted dlopen even with an absolute path", async () => {
  const result = await fence(`dlopen(${JSON.stringify(library)}, {});`);
  expect(result.exit).toBe(1); expect(result.output).toContain("uses dlopen without");
});
test("native-load fence permits a reviewed fixed absolute path literal", async () => {
  const result = await fence(`dlopen(${JSON.stringify(library)}, {});`, [library]);
  expect(result.exit).toBe(0); expect(result.output).toContain("1 allowlisted symbol/file pairs");
});
test.each(["libc.so.6", "./lib.so", "/usr/lib/../lib/libSystem.B.dylib"])("native-load allowlist refuses non-fixed path %s", async path => {
  const result = await fence(`dlopen(${JSON.stringify(path)}, {});`, [path]);
  expect(result.exit).not.toBe(0); expect(result.output).toContain("fixed absolute libraryPaths");
});
test.each(["process.env.LIBRARY", '"libc.so.6"', '"/usr/lib/unreviewed.dylib"', '`${process.cwd()}/lib.so`'])("native-load fence refuses a dynamic, relative or unreviewed argument (%s)", async argument => {
  const result = await fence(`dlopen(${argument}, {});`, [library]);
  expect(result.exit).toBe(1); expect(result.output).toContain("reviewed fixed absolute library path literal");
});
test.each(["ffi.dlopen", 'ffi["dlopen"]', "(dlopen)"])("native-load fence checks %s calls too", async callee => {
  const result = await fence(`${callee}(process.env.LIBRARY, {});`, [library]);
  expect(result.exit).toBe(1); expect(result.output).toContain("reviewed fixed absolute library path literal");
});
test("native-load policy does not mistake text/comments for a native load", async () => {
  const result = await fence(`const diagnostic = "dlopen failed"; // dlopen("arbitrary", {})`);
  expect(result.exit).toBe(0);
});

test.each([
  'const { dlopen: load } = ffi; load("/usr/lib/libSystem.B.dylib", {});',
  'const { "dlopen": load } = ffi; load("/usr/lib/libSystem.B.dylib", {});',
  'const { ["dlopen"]: load } = ffi; load("/usr/lib/libSystem.B.dylib", {});',
  'import { dlopen as load } from "bun:ffi"; load("/usr/lib/libSystem.B.dylib", {});',
  'const load = ffi.dlopen; load("/usr/lib/libSystem.B.dylib", {});',
  'passToAnotherFunction(dlopen);',
])("native-load fence refuses aliases or escaping references (%s)", async source => {
  const result = await fence(source, [library]);
  expect(result.exit).toBe(1); expect(result.output).toContain("reviewed fixed absolute library path literal");
});
