import {afterEach, expect, test} from "bun:test";
import {createHash} from "node:crypto";
import {mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {PairingTrustOwner, pairingTrustOwner, type PairingTrustAdapter} from "./trust-owner.ts";
import {legacyFixture} from "../../../../scripts/fixtures/pairing-capsule.ts";
import {PairingTrustOwner as OldOwner} from "../../../../scripts/fixtures/pairing-v1/pairing-security/trust-owner.ts";
import {CUT_DIRECTORY} from "./trust-cutover.ts";

const roots: string[] = [], removers: (() => void)[] = [];
function root() {const path = mkdtempSync(join(tmpdir(), "pairing-capsule-cutover-unit-")); roots.push(path); return path;}
function fixture(options: Parameters<typeof legacyFixture>[1] = {}) {
  return legacyFixture(root(), {factory: pairingTrustOwner, ...options});
}
function adapter() {
  const stack: object[] = [];
  const a: PairingTrustAdapter = {id: "cutover.test", withGate(_r, body) {
    const holder = {}; stack.push(holder);
    const release = () => {stack.splice(stack.indexOf(holder), 1);};
    try {const result = body(holder); if (result && typeof (result as any).then === "function") return Promise.resolve(result).finally(release) as any;
      release(); return result;
    } catch (error) {release(); throw error;}
  }, currentHolder() {return stack.at(-1) ?? null;}};
  return a;
}
afterEach(() => {for (const remove of removers.splice(0)) remove(); for (const path of roots.splice(0)) rmSync(path, {recursive: true, force: true});});

test("exact pinned old-owner bytes and missing-root reads are inert", () => {
  const bytes = readFileSync(new URL("../../../../scripts/fixtures/pairing-v1/pairing-security/trust-owner.ts", import.meta.url));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe("e0f650bacb7e72a413df1beb6520e136ba237feaf376500f5de77d0e9a6c4695");
  const parent = root(), missing = join(parent, "missing");
  expect(new OldOwner(missing).read()).toEqual({revision: 0, peers: []});
  expect(pairingTrustOwner(missing).read()).toEqual({revision: 0, peers: []});
  expect(readdirSync(parent)).toEqual([]);
});

test("real cutover preserves the byte-exact stamp, raw adoption, outcomes and charge", () => {
  for (const projection of [undefined, " [ ]\n", null]) {
    const f = fixture({generations: 3, keys: 2, projection});
    const stamp = f.owner.pairingAuthorityStamp(), before = f.owner.read();
    const raw = existsSync(join(f.root, "trusted-peers.json")) ? readFileSync(join(f.root, "trusted-peers.json"), "utf8") : null;
    const legacyBytes = readdirSync(f.root).filter(n => n.startsWith("trusted-peers.owner.")).reduce((n, name) => n + readFileSync(join(f.root, name)).length, 0);
    const result = f.owner.migrateToCapsule("cut");
    expect(result).toMatchObject({migrationId: "cut", revision: 3});
    expect(f.owner.pairingAuthorityStamp()).toBe(stamp); expect(f.owner.read()).toEqual(before);
    const h = JSON.parse(readFileSync(join(f.root, "trusted-peers.v2.commit.1.json"), "utf8")).capsule;
    expect(h.chargedBytes).toBe(legacyBytes); expect(existsSync(join(f.root, CUT_DIRECTORY))).toBe(false);
    expect(existsSync(join(f.root, "trusted-peers.json")) ? readFileSync(join(f.root, "trusted-peers.json"), "utf8") : null).toBe(raw);
    const original = f.owner.mutate(2, "fixture-final-publication", {type: "grant", peer: {publicKey: f.keys[0]!, pairedAt: "2026-01-01T00:00:00Z", name: "final-name"}});
    expect(original.revision).toBe(3);
    f.owner.mutate(3, "later", {type: "grant", peer: {publicKey: "b".repeat(64), pairedAt: "date"}});
    const next = JSON.parse(readFileSync(join(f.root, "trusted-peers.v2.commit.2.json"), "utf8")).capsule;
    if (projection !== undefined) expect(next.adoption).toEqual({fromProjectionHash: h.logicalPeersHash,
      toProjectionHash: createHash("sha256").update(raw ?? "").digest("hex")});
    expect(f.owner.migrateToCapsule("cut")).toEqual(result); expect(f.owner.read().revision).toBe(4);
    expect(() => f.owner.migrateToCapsule("different-id")).toThrow("migration_id_reused");
  }
}, 30000);

test("managed cutover preserves stamp and policy, excludes advisory data and permits a real revoke", () => {
  const f = fixture({prepare(o) {removers.push(o.register(adapter())); o.mutate(1, "manage", {type: "manage"});}});
  f.owner.refresh(f.keys[0]!, "2026-10-01T00:00:00Z");
  const stamp = f.owner.pairingAuthorityStamp();
  f.owner.migrateToCapsule("managed-cut"); expect(f.owner.pairingAuthorityStamp()).toBe(stamp);
  const h = JSON.parse(readFileSync(join(f.root, "trusted-peers.v2.commit.1.json"), "utf8")).capsule;
  expect(h.peers[0].lastSeen).toBeUndefined(); expect(f.owner.read().peers[0]!.lastSeen).toBe("2026-10-01T00:00:00Z");
  expect(h.policy).toMatchObject({revision: 2, marker: {adapterId: "cutover.test"}});
  f.owner.mutate(2, "revoke", {type: "revoke", publicKey: f.keys[0]!}); expect(f.owner.read().peers).toEqual([]);
  removers.pop()!(); expect(() => new PairingTrustOwner(f.root).read()).toThrow("managed_adapter_required");
}, 30000);

test("migration refuses another observable live invocation before reserving resources", async () => {
  const f = fixture({prepare(o) {removers.push(o.register(adapter())); o.mutate(1, "manage", {type: "manage"});}});
  let release!: () => void;
  const held = f.owner.withInvocation(async () => {await new Promise<void>(r => {release = r;});});
  try {
    expect(() => f.owner.withInvocation(c => f.owner.migrateToCapsule("not-yet", c))).toThrow("migration_holder_active");
    expect(existsSync(join(f.root, CUT_DIRECTORY))).toBe(false);
  } finally {release(); await held;}
  f.owner.withInvocation(c => f.owner.migrateToCapsule("now", c)); expect(f.owner.read().revision).toBe(2);
}, 30000);

test("a live pinned-v1 holder exposed by currentHolder cannot be replaced by a claimed new holder", async () => {
  let holder: object | null = null, acquisitions = 0;
  const a: PairingTrustAdapter = {id: "cutover.test", currentHolder() {return holder;}, withGate(_r, body) {
    acquisitions++;
    const candidate = {}, owns = holder === null; if (owns) holder = candidate;
    const release = () => {if (owns) holder = null;};
    // Deliberately dishonest acquisition, but truthful currentHolder: the
    // owner must reject the claimed new holder while the old owner is live.
    try {const value = body(candidate); if (value && typeof (value as any).then === "function") return Promise.resolve(value).finally(release) as any;
      release(); return value;
    } catch (error) {release(); throw error;}
  }};
  const f = fixture({prepare(o) {removers.push(o.register(a)); o.mutate(1, "manage", {type: "manage"});}});
  const old = new OldOwner(f.root); removers.push(old.register(a));
  let release!: () => void;
  const active = old.withInvocation(async () => {await new Promise<void>(r => {release = r;});});
  const before = acquisitions;
  try {
    let error: unknown; try {f.owner.migrateToCapsule("refuse-old");} catch (caught) {error = caught;}
    expect(acquisitions).toBe(before);
    expect(String(error)).toContain("migration_holder_active");
    expect(existsSync(join(f.root, CUT_DIRECTORY))).toBe(false);
  } finally {release(); await active;}
  f.owner.migrateToCapsule("after-old"); expect(f.owner.read().revision).toBe(2);
}, 30000);

test("migrated reads remain exhaustive and resurrected retired generations refuse", () => {
  const f = fixture({generations: 4, keys: 2});
  const retired = readFileSync(join(f.root, "trusted-peers.owner.1.json"));
  f.owner.migrateToCapsule("cut"); expect(f.owner.read().revision).toBe(4);
  const h = JSON.parse(readFileSync(join(f.root, "trusted-peers.v2.commit.1.json"), "utf8")).capsule;
  const path = join(f.root, h.parts[0].name), bytes = readFileSync(path, "utf8");
  writeFileSync(path, bytes.replace("fixture-1", "fixture-0"));
  expect(() => f.owner.read()).toThrow("capsule_chunk_checksum");
  expect(() => new PairingTrustOwner(f.root).read()).toThrow("capsule_chunk_checksum");
  writeFileSync(path, bytes); writeFileSync(join(f.root, "trusted-peers.owner.1.json"), retired, {mode: 0o600});
  expect(() => f.owner.read()).toThrow("capsule_unexpected_history");
}, 30000);
