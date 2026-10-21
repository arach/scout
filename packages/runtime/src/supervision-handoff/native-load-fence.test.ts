import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const file = "packages/runtime/src/native-fixture.ts";
const policyRoot = "scripts/sync-exec-allowlist";
const policyFile = (root: string, symbol = "dlopen") => join(root, policyRoot, file, `${encodeURIComponent(symbol)}.json`);
const nativePolicy = (paths: string[]) => ({ path: file, symbol: "dlopen", category: "dlopen",
  reason: "isolated static policy fixture; never executed", owner: "tests", libraryPaths: paths });
function writePolicy(root: string, symbol: string, value: unknown) {
  const path = policyFile(root, symbol); mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

async function fence(source: string, paths?: string[], arrange?: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "native-load-fence-"));
  mkdirSync(dirname(join(root, file)), { recursive: true }); mkdirSync(join(root, policyRoot), { recursive: true });
  writeFileSync(join(root, file), source);
  if (paths) writePolicy(root, "dlopen", nativePolicy(paths));
  arrange?.(root);
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

test("per-key policy accepts distinct symbols for one source file", async () => {
  const result = await fence(`dlopen(${JSON.stringify(library)}, {}); Bun.spawn([]);`, [library], root => {
    writePolicy(root, "Bun.spawn", { path: file, symbol: "Bun.spawn", category: "test", reason: "static fixture", owner: "tests" });
  });
  expect(result.exit).toBe(0); expect(result.output).toContain("2 allowlisted symbol/file pairs");
});

test("per-key policy percent-encodes symbol punctuation", async () => {
  const symbol = ["node", "child_process"].join(":");
  const result = await fence(`import(${JSON.stringify(symbol)});`, undefined, root => {
    writePolicy(root, symbol, { path: file, symbol, category: "test", reason: "static fixture", owner: "tests" });
  });
  expect(result.exit).toBe(0); expect(result.output).toContain("1 allowlisted symbol/file pairs");
});

test("per-key policy names a misplaced entry and its corrective filename", async () => {
  const result = await fence(`dlopen(${JSON.stringify(library)}, {});`, [library], root => {
    renameSync(policyFile(root), join(root, policyRoot, "wrong.json"));
  });
  expect(result.exit).not.toBe(0);
  expect(result.output).toContain(`${file} dlopen is in ${policyRoot}/wrong.json`);
  expect(result.output).toContain(`move it to ${policyRoot}/${file}/dlopen.json`);
});

test("per-key policy reports the first misplaced entry in filename order", async () => {
  const result = await fence(`dlopen(${JSON.stringify(library)}, {}); Bun.spawn([]);`, [library], root => {
    renameSync(policyFile(root), join(root, policyRoot, "a-wrong.json"));
    writeFileSync(join(root, policyRoot, "z-wrong.json"), JSON.stringify({ path: file, symbol: "Bun.spawn", category: "test", reason: "static fixture", owner: "tests" }));
  });
  expect(result.exit).not.toBe(0); expect(result.output).toContain(`${policyRoot}/a-wrong.json`);
  expect(result.output).not.toContain(`${policyRoot}/z-wrong.json`);
});

test("per-key policy still refuses duplicate path and symbol keys", async () => {
  const result = await fence(`dlopen(${JSON.stringify(library)}, {});`, [library], root => {
    writeFileSync(join(root, policyRoot, "z-copy.json"), readFileSync(policyFile(root)));
  });
  expect(result.exit).not.toBe(0); expect(result.output).toContain(`duplicate allowlist entry for ${file} dlopen`);
});

test("one native allowance can review multiple libraries without duplicate keys", async () => {
  const second = "/usr/lib/libproc.dylib";
  const result = await fence(`dlopen(${JSON.stringify(library)}, {}); dlopen(${JSON.stringify(second)}, {});`, [library, second]);
  expect(result.exit).toBe(0); expect(result.output).toContain("1 allowlisted symbol/file pairs");
});

test("per-key policy refuses a leftover legacy array instead of ignoring it", async () => {
  const result = await fence("const fixture = 1;", undefined, root => {
    writeFileSync(join(root, "scripts/sync-exec-allowlist.json"), "[]");
  });
  expect(result.exit).not.toBe(0); expect(result.output).toContain("legacy scripts/sync-exec-allowlist.json");
  expect(result.output).toContain("remove the array");
});

test("each policy fragment must contain one object rather than an array", async () => {
  const result = await fence(`dlopen(${JSON.stringify(library)}, {});`, [library], root => {
    writeFileSync(policyFile(root), JSON.stringify([nativePolicy([library])]));
  });
  expect(result.exit).not.toBe(0); expect(result.output).toContain("invalid allowlist entry");
});

test("malformed allowance JSON names the bad fragment", async () => {
  const result = await fence("const fixture = 1;", [library], root => {
    writeFileSync(policyFile(root), "{");
  });
  expect(result.exit).not.toBe(0); expect(result.output).toContain(`invalid allowance JSON in ${policyRoot}/${file}/dlopen.json`);
});

test("per-key policy refuses symlinked allowance files", async () => {
  const result = await fence(`dlopen(${JSON.stringify(library)}, {});`, [library], root => {
    const target = join(root, "reviewed.json"); renameSync(policyFile(root), target); symlinkSync(target, policyFile(root));
  });
  expect(result.exit).not.toBe(0); expect(result.output).toContain("use regular per-key JSON files only");
});

test("per-key policy refuses unexpected files rather than silently skipping them", async () => {
  const result = await fence("const fixture = 1;", undefined, root => {
    writeFileSync(join(root, policyRoot, "unreviewed.txt"), "not a policy object");
  });
  expect(result.exit).not.toBe(0); expect(result.output).toContain(`${policyRoot}/unreviewed.txt`);
});
