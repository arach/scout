import { watchCliEnvProcess } from "./cli-env-diagnostic.ts";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

// --isolate separates JS realms, not the process-wide descriptor table. These
// suites deliberately require second-spawn reuse and must not inherit late FD
// activity from unrelated files. All assertions still run; nothing is skipped.
export const QUIET_PROCESS_FILES = [
  "src/cli/extension-async-io.test.ts",
  "src/cli/extension-context-reclaim.test.ts",
  "src/cli/extension-context.test.ts",
  "src/cli/extension-numeric-spike.test.ts",
] as const;

export function sourceTestFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /[._](?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) files.push(path);
    }
  };
  visit("src");
  return files.sort();
}
export function sourceTestPlan(files: readonly string[]): string[][] {
  if (!files.length || new Set(files).size !== files.length) throw Error("empty/duplicate CLI unit selection");
  for (const file of QUIET_PROCESS_FILES) if (!files.includes(file)) throw Error(`missing quiet-process suite: ${file}`);
  const ordinary = files.filter(file => !(QUIET_PROCESS_FILES as readonly string[]).includes(file));
  return [...(ordinary.length ? [ordinary] : []), ...QUIET_PROCESS_FILES.map(file => [file])];
}
if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  for (const files of sourceTestPlan(sourceTestFiles(root))) {
    const ordinary = files.some(file => !(QUIET_PROCESS_FILES as readonly string[]).includes(file));
    const repetitions = ordinary ? 5 : 1;
    for (let iteration = 1; iteration <= repetitions; iteration++) {
      console.log(JSON.stringify({event:"cli-unit-process",files,iteration,repetitions,ordinary,version:Bun.version,revision:Bun.revision}));
      const child = Bun.spawn([process.execPath, "test", "--isolate", ...files.map(file => `./${file}`)], {
        cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit",
      });
      console.log(JSON.stringify({event:"cli-unit-process-started",pid:child.pid,iteration,repetitions,ordinary}));
      const stopWatch = ordinary ? watchCliEnvProcess(child.pid, iteration) : () => {};
      let code: number;
      try { code = await child.exited; } finally { stopWatch(); }
      console.log(JSON.stringify({event:"cli-unit-process-exited",pid:child.pid,iteration,repetitions,ordinary,code}));
      // Preserve the first failure and its aftermath; do not run another
      // ordinary process or a quiet suite after it.
      if (code !== 0) process.exit(code || 1);
    }
  }
}
