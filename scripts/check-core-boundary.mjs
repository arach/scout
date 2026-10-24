import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export function findCoreSourceBoundaryFailures(root) {
  const failures = [];
  const departed = ["apps/desktop", "packages/web", "crates/openscout-voice-core", "packages/session-trace-react"];
  for (const name of departed) if (existsSync(join(root, name))) failures.push(`Departed tree returned: ${name}`);
  const inspect = directory => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (["node_modules", "dist", ".git"].includes(entry.name)) continue;
      const file = join(directory, entry.name);
      if (entry.isDirectory()) { inspect(file); continue; }
      if (!/\.[cm]?[jt]sx?$/.test(entry.name)) continue;
      const source = readFileSync(file, "utf8");
      for (const imported of ts.preProcessFile(source, true, true).importedFiles) {
        const specifier = imported.fileName;
        const target = specifier.startsWith(".") ? relative(root, resolve(dirname(file), specifier)).replaceAll("\\", "/") : specifier;
        if (departed.some(name => target === name || target.startsWith(name + "/"))
          || /^(?:@scout\/app|@openscout\/web)(?:\/|$)/.test(specifier)) {
          failures.push(`${relative(root, file)} imports departed source: ${specifier}`);
        }
      }
    }
  };
  inspect(join(root, "packages"));
  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = findCoreSourceBoundaryFailures(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
  else console.log("Core source boundary passed: no app trees or imports.");
}
