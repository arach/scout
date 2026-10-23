import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type FencePair = { path: string; symbol: string; policySha256: string };
type NamedPair = FencePair & { reason: string };
export type FenceInventory = {
  schema: "scout.extension-channel-fence-inventory/v1";
  baseline: { sourceHead: string; expectedCount: number; pairs: FencePair[] };
  changes: Array<{ id: string; sourceHead: string; reason: string; fromCount: number; toCount: number; retired: NamedPair[]; added: NamedPair[] }>;
};
// The approved b90c69fd inventory is immutable. Later changes append named
// accounting records; editing the baseline or merely recounting disk refuses.
const BASELINE_SHA256 = "ce0d3bd07e36a7abb21516a36624b3d13fdd5eea8bae799f702ef75562aa2d45";
const schema = "scout.extension-channel-fence-inventory/v1";
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const nonempty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const sha = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const head = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{40}$/.test(v);
const key = (pair: FencePair) => `${pair.path}\0${pair.symbol}`;
function refuse(message: string): never { throw Error(`qualification fence ${message}`); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined || typeof value === "number" && !Number.isFinite(value)) refuse("non-JSON inventory value");
  return encoded;
}
/** Hash the complete policy, including category and native path restrictions. */
export function fenceInventoryDigest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
function pair(value: unknown, named = false): FencePair {
  if (!record(value) || typeof value.path !== "string" || !/^(packages|apps)\//.test(value.path)
    || value.path.includes("\\") || value.path.includes("\0") || value.path.split("/").some(p => !p || p === "." || p === "..")
    || typeof value.symbol !== "string" || !/^[A-Za-z0-9_.:-]+$/.test(value.symbol) || !sha(value.policySha256)) refuse("invalid expected pair");
  if (named && !nonempty(value.reason)) refuse("change requires named accounting for every pair");
  return {path: value.path, symbol: value.symbol, policySha256: value.policySha256};
}

/** Pure ledger fold. The caller supplies a fixed approved baseline digest,
 * never a digest inferred from the current allowance files. */
export function expectedFenceInventory(value: unknown, baselineDigest: string): Map<string, FencePair> {
  if (!record(value) || value.schema !== schema || !record(value.baseline) || !sha(baselineDigest)
    || fenceInventoryDigest(value.baseline) !== baselineDigest) refuse("baseline changed without named accounting");
  const base = value.baseline;
  if (!head(base.sourceHead) || !Array.isArray(base.pairs) || !Number.isInteger(base.expectedCount)
    || base.expectedCount !== base.pairs.length || !base.pairs.length || !Array.isArray(value.changes)) refuse("invalid expected baseline");
  const expected = new Map<string, FencePair>();
  for (const raw of base.pairs) {
    const entry = pair(raw);
    if (expected.has(key(entry))) refuse("duplicate expected pair");
    expected.set(key(entry), entry);
  }
  const ids = new Set<string>();
  for (const change of value.changes) {
    if (!record(change) || !nonempty(change.id) || ids.has(change.id) || !head(change.sourceHead) || !nonempty(change.reason)
      || change.fromCount !== expected.size || !Number.isInteger(change.toCount) || !Array.isArray(change.retired)
      || !Array.isArray(change.added) || change.retired.length + change.added.length === 0) refuse("change requires named accounting and exact counts");
    ids.add(change.id);
    const retired = new Map<string, FencePair>();
    for (const raw of change.retired) {
      const entry = pair(raw, true), old = expected.get(key(entry));
      if (!old || old.policySha256 !== entry.policySha256) refuse("retirement does not match expected pair");
      retired.set(key(entry), entry); expected.delete(key(entry));
    }
    for (const raw of change.added) {
      const entry = pair(raw, true);
      if (expected.has(key(entry)) || retired.get(key(entry))?.policySha256 === entry.policySha256) refuse("duplicate or unchanged accounted pair");
      expected.set(key(entry), entry);
    }
    if (change.toCount !== expected.size || !expected.size) refuse("accounted inventory count mismatch");
  }
  return expected;
}

export function readFenceInventory(root: string): Map<string, FencePair> {
  for (const directory of ["packages", "apps", "scripts/sync-exec-allowlist"]) {
    if (!lstatSync(join(root, directory)).isDirectory()) refuse("scan root missing");
  }
  const actual = new Map<string, FencePair>();
  const visit = (relative: string) => {
    const directory = join(root, "scripts/sync-exec-allowlist", relative);
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        const policy: unknown = JSON.parse(readFileSync(join(directory, entry.name), "utf8"));
        if (!record(policy)) refuse("invalid policy record");
        const item = pair({...policy, policySha256: fenceInventoryDigest(policy)});
        if (path !== `${item.path}/${encodeURIComponent(item.symbol)}.json` || actual.has(key(item))) refuse("policy location or identity mismatch");
        actual.set(key(item), item);
      } else refuse("inventory must contain regular per-key JSON files");
    }
  };
  visit(""); return actual;
}

/** The reported count and every policy identity/restriction must match the
 * reviewed expected inventory, not the number of live allowance files. */
export function verifyExpectedFenceInventory(output: string, actual: ReadonlyMap<string, FencePair>, expected: ReadonlyMap<string, FencePair>): number {
  const records = [...output.matchAll(/^Sync exec fence passed \((\d+) allowlisted symbol\/file pairs\)\.$/gm)];
  const observed = records.length === 1 ? Number(records[0]![1]) : NaN;
  if (!expected.size || observed !== expected.size || actual.size !== expected.size) refuse(`inventory mismatch: expected ${expected.size}, observed ${observed}, on disk ${actual.size}`);
  for (const [id, entry] of expected) if (actual.get(id)?.policySha256 !== entry.policySha256) refuse(`inventory mismatch: unaccounted removal or policy edit: ${entry.path} / ${entry.symbol}`);
  return observed;
}

export function verifyFenceInventory(output: string, root = process.cwd()): number {
  const manifest: unknown = JSON.parse(readFileSync(new URL("./extension-channel-fence-inventory.json", import.meta.url), "utf8"));
  return verifyExpectedFenceInventory(output, readFenceInventory(root), expectedFenceInventory(manifest, BASELINE_SHA256));
}
