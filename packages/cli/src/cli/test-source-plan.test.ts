import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { QUIET_PROCESS_FILES, sourceTestFiles, sourceTestPlan } from "../../scripts/test-source.ts";

test("CLI source plan runs every discovered test exactly once and isolates reuse suites by process", () => {
  const files = sourceTestFiles(resolve(import.meta.dir, "../.."));
  const groups = sourceTestPlan(files);
  expect(groups.flat().sort()).toEqual(files);
  expect(new Set(groups.flat()).size).toBe(files.length);
  expect(groups[0]!.length).toBeGreaterThan(0);
  for (const file of QUIET_PROCESS_FILES) {
    expect(groups.filter(group => group.includes(file))).toEqual([[file]]);
  }
});
test("CLI source plan refuses an empty, duplicate or incomplete inventory", () => {
  expect(() => sourceTestPlan([])).toThrow("empty/duplicate");
  expect(() => sourceTestPlan([...QUIET_PROCESS_FILES,QUIET_PROCESS_FILES[0]])).toThrow("empty/duplicate");
  expect(() => sourceTestPlan(QUIET_PROCESS_FILES.slice(1))).toThrow("missing quiet-process suite");
});

const supported = Bun.revision==="0d9b296af33f2b851fcbf4df3e9ec89751734ba4" && (process.platform==="darwin"&&process.arch==="arm64"||process.platform==="linux"&&process.arch==="x64");
(supported ? test : test.skip)("process boundary survives competing parent FDs without weakening the reuse assertion",async()=>{
  const child=Bun.spawn([process.execPath,resolve(import.meta.dir,"../../../../scripts/extension-numeric-spike/reuse-contention.ts")],{stdout:"pipe",stderr:"pipe",env:{PATH:process.env.PATH}});
  const timer=setTimeout(()=>child.kill("SIGKILL"),25000);
  try {
    const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    expect(code).toBe(0);expect(err).toContain("1 pass");expect(out).toContain('"event":"same-process-reuse-refused"');expect(out).toContain('"event":"isolated-reuse-passed"');
  } finally {clearTimeout(timer);if(child.exitCode===null)child.kill("SIGKILL");await child.exited;}
},30000);
