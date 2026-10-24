import type { Dirent } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative, posix } from "node:path";
import ts from "typescript";

type AllowCategory =
  | "boot"
  | "cli"
  | "build-script"
  | "test"
  | "imperative"
  | "probe-exec"
  | "repo-service-fallback"
  | "imperative-fallback"
  | "process-lifecycle"
  | "dlopen"
  | "native-compile";
type AllowEntry = {
  path: string;
  symbol:
    | "execFileSync"
    | "execSync"
    | "spawnSync"
    | "Bun.spawnSync"
    | "node:child_process"
    | "Bun.spawn"
    | "Subprocess.kill"
    | "dlopen"
    | "cc";
  category: AllowCategory;
  reason: string;
  owner: string;
  libraryPaths?: string[];
  sourceFiles?: string[];
};

const ROOT = process.cwd();
const ALLOWLIST_ROOT = "scripts/sync-exec-allowlist";
const SCAN_ROOTS = ["packages", "apps"];
const PHASE_B_ROOTS = [
  "packages/pairing/src",
  "packages/web/server",
  "packages/runtime/src",
  "apps/desktop/src/core",
  "packages/cli/src/lib/core",
  "packages/cli/src/mcp",
];
const SYNC_SYMBOLS = ["execFileSync", "execSync", "spawnSync", "Bun.spawnSync"] as const;
const PHASE_B_SYMBOLS = ["node:child_process", "Bun.spawn", "Bun.spawnSync"] as const;
const SYMBOLS = [...SYNC_SYMBOLS, "node:child_process", "Bun.spawn", "Subprocess.kill", "dlopen", "cc"] as const;
const CATEGORIES = new Set<AllowCategory>([
  "boot",
  "cli",
  "build-script",
  "test",
  "imperative",
  "probe-exec",
  "repo-service-fallback",
  "imperative-fallback",
  "process-lifecycle",
  "dlopen",
  "native-compile",
]);

function normalizePath(path: string): string {
  return path.split(/[\\/]+/).filter(Boolean).join("/");
}

async function walk(directory: string, out: string[] = []): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (
      entry.name === "node_modules"
      || entry.name === "dist"
      || entry.name === "build"
      || entry.name === ".build"
      || entry.name === ".deriveddata"
      || entry.name === ".next"
    ) {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(path, out);
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/u.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

function fixedLibraryPath(path: unknown): path is string {
  return typeof path === "string" && posix.isAbsolute(path) && posix.normalize(path) === path
    && !path.includes("\0") && !path.includes("\\");
}

// Native loads use syntax-aware argument checking. A reviewed file/symbol pair
// is not permission to substitute an env/cwd/soname path at that call site.
function nativeLoads(file: string, source: string, symbol: "dlopen" | "cc" = "dlopen") {
  const out: { index: number; library?: string }[] = [];
  if (!source.includes(symbol) || symbol === "cc" && !source.includes("bun:ffi")) return out;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const inspect = (node: ts.Expression) => {
    let expression = node;
    while (ts.isParenthesizedExpression(expression.parent) || ts.isAsExpression(expression.parent)
      || ts.isTypeAssertionExpression(expression.parent) || ts.isNonNullExpression(expression.parent)) expression = expression.parent;
    const call = expression.parent;
    const arg = ts.isCallExpression(call) && call.expression === expression ? call.arguments[0] : undefined;
    // A non-call reference would let an alias/argument escape this inventory.
    let library = arg && ts.isStringLiteralLike(arg) ? arg.text : undefined;
    if (symbol === "cc") {
      library = undefined;
      // Compile only one reviewed module-relative C source. No flags, library,
      // include, define, spread, alias or environment-controlled source override.
      if (arg && ts.isObjectLiteralExpression(arg) && arg.properties.length === 2
        && new Set(arg.properties.map(p => ts.isPropertyAssignment(p) ? p.name.getText(tree) : "")).size === 2 && arg.properties.every(p => ts.isPropertyAssignment(p)
        && ts.isIdentifier(p.name) && ["source", "symbols"].includes(p.name.text))) {
        const source = arg.properties.find(p => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "source");
        const value = source && ts.isPropertyAssignment(source) ? source.initializer : undefined;
        if (value && ts.isNewExpression(value) && ts.isIdentifier(value.expression) && value.expression.text === "URL"
          && value.arguments?.length === 2 && ts.isStringLiteralLike(value.arguments[0]!)
          && value.arguments[0]!.text.startsWith("./") && !value.arguments[0]!.text.includes("..")
          && value.arguments[1]!.getText(tree) === "import.meta.url") {
          library = posix.join(posix.dirname(file), value.arguments[0]!.text);
        }
      }
    }
    out.push({ index: node.getStart(tree), library });
  };
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === symbol) {
      const parent = node.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.name === node) { /* inspect the member below */ }
      else if (ts.isBindingElement(parent) && parent.name === node && !parent.propertyName) { /* const { dlopen } = ffi */ }
      else if (ts.isImportSpecifier(parent) && parent.name === node && !parent.propertyName) { /* import { dlopen } */ }
      else inspect(node);
    } else if (ts.isStringLiteralLike(node) && node.text === symbol
      && (ts.isBindingElement(node.parent) && node.parent.propertyName === node
        || ts.isImportSpecifier(node.parent) && node.parent.propertyName === node
        || ts.isComputedPropertyName(node.parent) && ts.isBindingElement(node.parent.parent))) {
      out.push({ index: node.getStart(tree) }); // literal/computed destructuring alias
    } else if (ts.isPropertyAccessExpression(node) && node.name.text === symbol
      || ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === symbol) {
      inspect(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree); return out;
}

function validateAllowlist(value: unknown, locations: readonly string[]): AllowEntry[] {
  if (!Array.isArray(value)) {
    throw new Error("sync exec allowlist must be an array");
  }
  const entries: AllowEntry[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== "object") {
      throw new Error("allowlist entries must be objects");
    }
    const entry = raw as Partial<AllowEntry>;
    if (!entry.path || !entry.symbol || !entry.category || !entry.reason || !entry.owner) {
      throw new Error(`invalid allowlist entry: ${JSON.stringify(raw)}`);
    }
    if (!SYMBOLS.includes(entry.symbol)) {
      throw new Error(`invalid allowlist symbol ${entry.symbol} for ${entry.path}`);
    }
    if (!CATEGORIES.has(entry.category)) {
      throw new Error(`invalid allowlist category ${entry.category} for ${entry.path}`);
    }
    if (entry.symbol === "dlopen") {
      if (entry.category !== "dlopen" || !Array.isArray(entry.libraryPaths) || !entry.libraryPaths.length
        || entry.libraryPaths.some(path => !fixedLibraryPath(path))) throw new Error(`dlopen requires reviewed fixed absolute libraryPaths for ${entry.path}`);
    } else if (entry.symbol === "cc") {
      if (entry.category !== "native-compile" || !Array.isArray(entry.sourceFiles) || !entry.sourceFiles.length
        || entry.sourceFiles.some(path => typeof path !== "string" || !path.endsWith(".c") || path.includes("\0") || path.includes("\\")
          || posix.isAbsolute(path) || posix.normalize(path) !== path || path.startsWith("../"))) throw Error(`cc requires reviewed repository-relative sourceFiles for ${entry.path}`);
    } else if (entry.category === "dlopen" || entry.libraryPaths !== undefined || entry.category === "native-compile" || entry.sourceFiles !== undefined) {
      throw new Error(`native library policy only applies to dlopen for ${entry.path}`);
    }
    const normalized: AllowEntry = {
      path: normalizePath(entry.path),
      symbol: entry.symbol,
      category: entry.category,
      reason: entry.reason.trim(),
      owner: entry.owner.trim(),
      ...(entry.symbol === "dlopen" ? { libraryPaths: [...entry.libraryPaths!] } : {}),
      ...(entry.symbol === "cc" ? { sourceFiles: [...entry.sourceFiles!] } : {}),
    };
    const key = `${normalized.path}\u0000${normalized.symbol}`;
    if (seen.has(key)) {
      throw new Error(`duplicate allowlist entry for ${normalized.path} ${normalized.symbol}`);
    }
    const expected = `${normalized.path}/${encodeURIComponent(normalized.symbol)}.json`;
    if (locations[index] !== expected) {
      throw new Error(`allowlist entry ${normalized.path} ${normalized.symbol} is in ${ALLOWLIST_ROOT}/${locations[index]}; move it to ${ALLOWLIST_ROOT}/${expected}`);
    }
    seen.add(key);
    entries.push(normalized);
  }
  return entries;
}

async function readAllowlist(): Promise<AllowEntry[]> {
  // Never silently ignore an old policy alongside the per-key files.
  try {
    await lstat(join(ROOT, "scripts/sync-exec-allowlist.json"));
    throw new Error(`legacy scripts/sync-exec-allowlist.json is unsupported; move each object to ${ALLOWLIST_ROOT}/<path>/<percent-encoded-symbol>.json and remove the array`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const directory = join(ROOT, ALLOWLIST_ROOT);
  const locations: string[] = [];
  const visit = async (path: string): Promise<void> => {
    const entries = (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && entry.name.endsWith(".json")) locations.push(normalizePath(relative(directory, file)));
      else throw new Error(`unexpected allowlist path ${ALLOWLIST_ROOT}/${normalizePath(relative(directory, file))}; use regular per-key JSON files only`);
    }
  };
  await visit(directory);
  const raw: unknown[] = [];
  for (const location of locations.sort()) {
    try { raw.push(JSON.parse(await readFile(join(directory, location), "utf8"))); }
    catch (error) { throw new Error(`invalid allowance JSON in ${ALLOWLIST_ROOT}/${location}: ${String(error)}`); }
  }
  return validateAllowlist(raw, locations);
}

function lineNumber(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function symbolPattern(symbol: AllowEntry["symbol"]): RegExp {
  if (symbol === "node:child_process") {
    return /(?:from\s+["']node:child_process["']|import\s*\(\s*["']node:child_process["']\s*\))/gu;
  }
  if (symbol === "Subprocess.kill") return /\.kill\s*\(/gu;
  if (symbol === "Bun.spawn") {
    return /(?<![A-Za-z0-9_$.])Bun\.spawn(?!Sync)(?![A-Za-z0-9_$])/gu;
  }
  const escaped = symbol.replace(".", "\\.");
  return new RegExp(`(?<![A-Za-z0-9_$.])${escaped}(?![A-Za-z0-9_$])`, "gu");
}

function isUnderAnyRoot(rel: string, roots: readonly string[]): boolean {
  return roots.some((root) => rel === root || rel.startsWith(`${root}/`));
}

function shouldScanSymbol(rel: string, symbol: AllowEntry["symbol"]): boolean {
  if (symbol === "dlopen" || symbol === "cc") return true;
  // Custody adds a protected signal boundary. Expand this scope deliberately,
  // rather than silently grandfathering every unrelated lifecycle caller.
  if (symbol === "Subprocess.kill") return isUnderAnyRoot(rel, ["packages/runtime/src/supervision-handoff"]);
  if ((SYNC_SYMBOLS as readonly string[]).includes(symbol)) return true;
  if ((PHASE_B_SYMBOLS as readonly string[]).includes(symbol)) {
    return isUnderAnyRoot(rel, PHASE_B_ROOTS);
  }
  return false;
}

const allowlist = await readAllowlist();
const allowed = new Map(allowlist.map((entry) => [`${entry.path}\u0000${entry.symbol}`, entry]));

const files = (await Promise.all(SCAN_ROOTS.map((root) => walk(join(ROOT, root))))).flat();
const violations: string[] = [];
const observed = new Set<string>();

for (const file of files) {
  const rel = normalizePath(relative(ROOT, file));
  const source = await readFile(file, "utf8");
  for (const symbol of SYMBOLS) {
    if (!shouldScanSymbol(rel, symbol)) continue;
    const matches = (symbol === "dlopen" || symbol === "cc") ? nativeLoads(rel, source, symbol) : source.matchAll(symbolPattern(symbol));
    for (const match of matches) {
      const key = `${rel}\u0000${symbol}`;
      observed.add(key);
      if (!allowed.has(key)) {
        violations.push(`${rel}:${lineNumber(source, match.index ?? 0)} uses ${symbol} without ${ALLOWLIST_ROOT}/${rel}/${encodeURIComponent(symbol)}.json`);
      }
      if (symbol === "cc") {
        const compiled = (match as {library?: string}).library;
        if (!compiled || !allowed.get(key)?.sourceFiles?.includes(compiled)) violations.push(`${rel}:${lineNumber(source, match.index ?? 0)} cc must use a reviewed fixed module-relative C source with no compiler overrides`);
      }
      if (symbol === "dlopen") {
        const library = (match as { library?: string }).library;
        if (!fixedLibraryPath(library) || !allowed.get(key)?.libraryPaths?.includes(library)) {
          violations.push(`${rel}:${lineNumber(source, match.index ?? 0)} dlopen must use a reviewed fixed absolute library path literal`);
        }
      }
    }
  }
}

const stale = [...allowed.keys()].filter((key) => !observed.has(key));
if (stale.length > 0) {
  violations.push(
    ...stale.map((key) => {
      const [path, symbol] = key.split("\u0000");
      return `${path} allowlists ${symbol} but no matching usage was found`;
    }),
  );
}

if (violations.length > 0) {
  console.error("Sync exec fence failed:");
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

console.log(`Sync exec fence passed (${observed.size} allowlisted symbol/file pairs).`);
