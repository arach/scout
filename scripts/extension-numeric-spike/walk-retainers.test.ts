import {expect, test} from "bun:test";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
const types = ["Internal", "Property", "Variable"], names = ["this", "#handle", "held"];
const classes = ["<root>", "FunctionCodeBlock", "JSLexicalEnvironment", "ChildProcess", "Subprocess", "Object", "WeakRef", "FinalizationRegistry"];
function snapshot(extra: number[][] = [], version = 3) {
  return {version, type: "Inspector", nodeClassNames: classes, edgeTypes: types, edgeNames: names,
    // Node9 is a Subprocess prototype, not an owned handle instance.
    nodes: [[0,0,0,0],[1,64,1,0],[2,32,2,0],[3,64,3,0],[4,928,4,0],[5,32,5,0],[6,32,6,0],[7,32,7,0],[9,37,4,0]].flat(),
    edges: [[1,2,0,0],[2,3,2,0],[3,4,1,1],[0,9,0,0],...extra].flat()};
}
async function walk(heap: ReturnType<typeof snapshot>) {
  const root = mkdtempSync(join(tmpdir(), "retainer-walker-")), file = join(root, "heap.json");
  writeFileSync(file, JSON.stringify(heap));
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "walk-retainers.ts"), file], {stdin: "ignore", stdout: "pipe", stderr: "pipe"});
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]); return {code, stdout, stderr};}
  finally {clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; rmSync(root, {recursive: true, force: true});}
}
test("Inspector-v3 four-field walk finds the VM-only pin and excludes the prototype", async () => {
  const result = await walk(snapshot()); expect(result.code).toBe(0); expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout.split("\n")[0]!)).toMatchObject({classification: "vm-codeblock-pin", exhaustive: true, target: 4, roots: [{id: 1, class: "FunctionCodeBlock"}]});
  expect(result.stdout).not.toContain("Subprocess#9");
});
test("an ordinary witness-held target prevents VM-only classification", async () => {
  const result = await walk(snapshot([[0,5,0,0],[5,4,1,2]])); expect(result.code).toBe(1); expect(result.stdout).toContain('"classification":"unclassified"');
});
test("WeakRef internal target is weak, not a witness-held retainer", async () => {
  const result = await walk(snapshot([[0,6,0,0],[6,4,0,0]])); expect(result.code).toBe(0);
});
test("a custom property on WeakRef IS a strong retainer", async () => {
  const result = await walk(snapshot([[0,6,0,0],[6,4,1,2]])); expect(result.code).toBe(1);
});
test("a registry held value IS a strong retainer", async () => {
  const result = await walk(snapshot([[0,7,0,0],[7,4,1,2]])); expect(result.code).toBe(1);
});
test("other heap formats refuse rather than inventing class identities", async () => {
  const result = await walk(snapshot([], 2)); expect(result.code).toBe(1); expect(result.stderr).toContain("unsupported heap snapshot format");
});
