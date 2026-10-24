import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function getOpenScoutRepoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}


// The core graph includes tsyringe (via @peculiar/x509 in
// @openscout/runtime's node-tls-identity), which throws at module init
// unless the reflect-metadata polyfill has already been evaluated. Bun's
// bundler does not preserve side-effect import order (a first-line
// `import "reflect-metadata"` in the entry gets hoisted into the entry
// body, which runs after dependency module init), so the polyfill must be
// hoisted above the whole bundle body via a banner ESM import. This makes
// reflect-metadata a runtime dependency of the bundle — it is declared in
// packages/cli/package.json.
export const REFLECT_METADATA_BANNER = '--banner=import "reflect-metadata";';


export function bundleScoutKnowledgeIndexChildBun(repoRoot, outfile) {
  mkdirSync(dirname(outfile), { recursive: true });
  const result = spawnSync("bun", [
    "build", resolve(repoRoot, "packages/runtime/src/knowledge-index-child.ts"),
    "--target=bun", "--format=esm", "--outfile", outfile, REFLECT_METADATA_BANNER,
  ], { cwd: repoRoot, stdio: "inherit" });
  return (result.status ?? 1) === 0 && verifyBundleStaticChecks(outfile);
}

export function verifyBundleStaticChecks(outfile) {
  const bundle = readFileSync(outfile, "utf8");

  const referencesPromiseAll = /\b__promiseAll\s*\(/.test(bundle);
  const definesPromiseAll = /\b(function|var|let|const)\s+__promiseAll\b/.test(bundle);
  if (referencesPromiseAll && !definesPromiseAll) {
    console.error(
      `[bundle-core] unresolved __promiseAll helper emitted in ${outfile}; refusing to ship a broken bundle`,
    );
    return false;
  }

  // Catch the 0.2.61 class of bug: a bare callsite like `existsSync(...)` with
  // no plain (unaliased) import of `existsSync`. Bun aliases identifiers when
  // multiple modules import the same symbol, so a bare callsite is only safe
  // if it has a matching unaliased import. If neither holds, the bundle will
  // ReferenceError at module-load.
  const fragileSymbols = [
    "existsSync",
    "readFileSync",
    "writeFileSync",
    "statSync",
    "mkdirSync",
    "rmSync",
    "readdirSync",
    "renameSync",
  ];

  for (const symbol of fragileSymbols) {
    const callsiteRegex = new RegExp(String.raw`(?:^|[^A-Za-z0-9_$])${symbol}\s*\(`, "m");
    if (!callsiteRegex.test(bundle)) {
      continue;
    }
    // A safe callsite needs an unaliased import of the same symbol somewhere
    // in the bundle: `import { ..., existsSync, ... } from "fs"` or the
    // node:fs equivalent, where existsSync is NOT followed by ` as `.
    const importRegex = new RegExp(
      String.raw`import\s*\{[^}]*\b${symbol}\b(?!\s+as\b)[^}]*\}\s*from\s*["'](?:node:)?fs(?:/promises)?["']`,
      "m",
    );
    if (importRegex.test(bundle)) {
      continue;
    }
    console.error(
      `[bundle-core] bare ${symbol}() callsite in ${outfile} with no matching unaliased import; refusing to ship.`,
    );
    return false;
  }

  return true;
}
