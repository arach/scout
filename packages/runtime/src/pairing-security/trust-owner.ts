/** Canonical pairing trust persistence. No I/O or adapter installation on import.
 * See docs/pairing-trust-owner.md for the on-disk and interruption contract. */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, constants, existsSync, fstatSync, fsyncSync, linkSync, lstatSync,
  mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync,
  unlinkSync, writeFileSync, rmdirSync, type Stats,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { resolveOpenScoutPairingHome } from "../support-paths.js";
import { CAPSULE_PREFIX, CUTOVER, CHUNK_TARGET, SLOT_LIMIT, commitName, doneName, dataName, slotName, stageName,
  pack, unpack, hex, integer, token, same, policyValid, partValid, rowValid, outcome,
  logicalHead, legacyCharge, type CapsuleBarrier, type CapsuleHead, type CapsuleDecoded,
  type CapsuleSlot, type CapsuleRow, type CapsulePart, type ManagedPolicy, type RetiredFile } from "./trust-capsule.js";

export type TrustedPeer = { publicKey: string; name?: string; pairedAt: string; lastSeen?: string };
export type PairingRootIdentity = Readonly<{ path: string; id: string }>;
declare const contextBrand: unique symbol;
export type PairingTrustContext = { readonly [contextBrand]: true };
/** Trusted bootstrap only. No loader, environment selector or remote installer.
 * withGate MUST retain native ownership until body settles (including Promise
 * results), and release on all exits. currentHolder checks actual ownership.
 * A synchronous legacy writer requires a synchronous gate adapter. This seam
 * does not certify native deadlines, full-key session authority or host policy. */
export interface PairingTrustAdapter {
  readonly id: string;
  withGate<T>(root: PairingRootIdentity, body: (holder: object) => T): T;
  currentHolder(root: PairingRootIdentity): object | null;
}
export type TrustMutation =
  | { type: "grant"; peer: TrustedPeer }
  | { type: "revoke"; publicKey: string }
  | { type: "manage" };
export type TrustOutcome = Readonly<{
  mutationId: string; revision: number; type: TrustMutation["type"];
  publicKey: string | null; changed: boolean;
}>;
type SavedOutcome = { request: string; outcome: TrustOutcome };
type Marker = { schema: "scout.pairing-trust-managed/v1"; rootId: string; adapterId: string };
type ProjectionAdoption = { fromProjectionHash: string; toProjectionHash: string };
type Generation = {
  schema: "scout.pairing-trust-owner/v1"; rootId: string; revision: number;
  previousHash: string; peersHash: string; peers: TrustedPeer[];
  managed: Marker | null; mutation: SavedOutcome; adoption?: ProjectionAdoption | null;
  projectionStage?: string;
};
/** A local, single-use pairing opportunity. Never accepted from request data. */
export interface PairingOpportunity {
  readonly id: string;
  readonly expiresAt: number;
  cancel(): void;
  isOpen(): boolean;
  admit(publicKey: string, room: string, isLive: () => boolean): boolean;
}
export type TrustSnapshot = Readonly<{ revision: number; peers: readonly TrustedPeer[] }>;
type State = { revision: number; peers: TrustedPeer[]; hash: string; peersHash: string;
  managed: Marker | null; outcomes: Record<string, SavedOutcome>; bytes: number;
  projectionHash: string; adoption: ProjectionAdoption | null; pendingStage: string | null; projectionStage: string | null;
  capsule?: CapsuleDecoded };
type Invocation = { owner: PairingTrustOwner; root: PairingRootIdentity; adapter: PairingTrustAdapter;
  holder: object; active: boolean; used: boolean };
const invocations = new AsyncLocalStorage<Invocation>();
const contexts = new WeakMap<object, Invocation>();
const adapters = new Map<string, PairingTrustAdapter>();
const owners = new Map<string, PairingTrustOwner>();
// Reentrant local observers see publication_incomplete, never recursively help.
const completing = new Set<string>();
const PEERS = "trusted-peers.json", MARKER = "trusted-peers.managed.json";
const PREFIX = "trusted-peers.owner.";
const LAST_SEEN = "trusted-peers.last-seen.json";
type LastSeenEntry = { publicKey: string; lastSeen: string };
const FILE_LIMIT = 1024 * 1024, TOTAL_LIMIT = 128 * 1024 * 1024, REVISION_LIMIT = 65_536;
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const encodePeers = (peers: readonly TrustedPeer[]) => JSON.stringify(peers, null, 2);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function refuse(code: string): never { throw new PairingTrustError(code); }
export class PairingTrustError extends Error {
  constructor(readonly code: string) { super(`pairing_trust_${code}`); }
}
function owned(stat: Stats, directory = false, legacyProjection = false, stagedGeneration = false) {
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())
    || stat.uid !== process.getuid?.() || (stat.mode & 0o022) !== 0
    || (!directory && ((stat.nlink !== 1 && !(stagedGeneration && stat.nlink === 2)) || (!legacyProjection && (stat.mode & 0o077) !== 0)))) refuse("unsafe_path");
}
function id(stat: Stats) { return `${stat.dev}:${stat.ino}`; }
/** Ancestor aliases (e.g. the system temporary directory) normalize; a final
 * symlink root is rejected. A spelling must never choose a second owner. */
function canonical(path: string): string {
  const absolute = resolve(path);
  try { const stat = lstatSync(absolute); owned(stat, true); return realpathSync(absolute); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return join(canonicalAncestor(dirname(absolute)), basename(absolute));
  }
}
function canonicalAncestor(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  return join(canonicalAncestor(dirname(path)), basename(path));
}
function peersOf(value: unknown): TrustedPeer[] {
  if (!Array.isArray(value) || value.length > 4096) refuse("invalid_peers");
  const keys = new Set<string>();
  return value.map(peer => {
    if (!record(peer) || typeof peer.publicKey !== "string" || !/^[0-9a-f]{64}$/.test(peer.publicKey)
      || typeof peer.pairedAt !== "string" || peer.pairedAt.length > 128
      || (peer.name !== undefined && (typeof peer.name !== "string" || peer.name.length > 1024))
      || (peer.lastSeen !== undefined && (typeof peer.lastSeen !== "string" || peer.lastSeen.length > 128))
      || keys.has(peer.publicKey)) refuse("invalid_peers");
    keys.add(peer.publicKey);
    return { publicKey: peer.publicKey, pairedAt: peer.pairedAt,
      ...(peer.name === undefined ? {} : {name: peer.name}), ...(peer.lastSeen === undefined ? {} : {lastSeen: peer.lastSeen}) };
  });
}
function fullKey(key: string) { if (!/^[0-9a-f]{64}$/.test(key)) refuse("full_key_required"); }

export class PairingTrustOwner {
  readonly path: string;
  private rootId: string | null = null;
  constructor(path: string) { this.path = canonical(path); }
  private root(create = false): PairingRootIdentity | null {
    if (create) {
      const missing: string[] = []; let directory = this.path;
      while (!existsSync(directory)) { missing.push(directory); directory = dirname(directory); }
      for (const path of missing.reverse()) {
        try { mkdirSync(path, {mode: 0o700}); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
        owned(lstatSync(path), true);
        const parent = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try { fsyncSync(parent); } finally { closeSync(parent); }
      }
    }
    let stat;
    try { stat = lstatSync(this.path); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT" && this.rootId === null) return null;
      throw e;
    }
    owned(stat, true);
    if (this.rootId !== null && id(stat) !== this.rootId) refuse("root_replaced");
    this.rootId = id(stat);
    return Object.freeze({path: this.path, id: this.rootId});
  }
  private check(root: PairingRootIdentity) { if (this.root()?.id !== root.id) refuse("root_replaced"); }
  private readFile(root: PairingRootIdentity, name: string, stagedGeneration = name.startsWith(PREFIX)): Buffer | null {
    this.check(root); const path = join(root.path, name);
    let fd: number;
    try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
    try {
      const stat = fstatSync(fd); owned(stat, false, name === PEERS, stagedGeneration);
      if (stat.size > FILE_LIMIT || id(lstatSync(path)) !== id(stat)) refuse("unsafe_path");
      const data = readFileSync(fd);
      if (data.length > FILE_LIMIT || id(lstatSync(path)) !== id(stat)) refuse("unsafe_path");
      this.check(root); return data;
    } finally { closeSync(fd); }
  }
  /** The CAS staging hard link stays live until projection rename. Its presence
   * distinguishes an in-flight owner publication from an unmanaged old writer.
   * Any owner operation can help finish a verified head publication. */
  private pendingStage(root: PairingRootIdentity, revision: number): string | null {
    const target = lstatSync(join(root.path, `${PREFIX}${revision}.json`));
    if (target.nlink === 1) return null;
    owned(target, false, false, true);
    const matches = readdirSync(root.path).filter(name => /^\.pairing-owner-[a-f0-9-]{36}\.tmp$/.test(name))
      .map(name => join(root.path, name)).filter(path => {
        let stat;
        try { stat = lstatSync(path); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
        if (id(stat) !== id(target)) return false;
        owned(stat, false, false, true); return true;
      });
    const now = lstatSync(join(root.path, `${PREFIX}${revision}.json`)); owned(now, false, false, true);
    if (id(now) !== id(target)) refuse("unsafe_path");
    if (now.nlink === 1) return null; // Another helper removed the witness.
    if (matches.length !== 1) refuse("unsafe_path");
    this.check(root); return matches[0]!;
  }
  private syncDirectory(root: PairingRootIdentity) {
    this.check(root);
    const fd = openSync(root.path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { if (id(fstatSync(fd)) !== root.id) refuse("root_replaced"); fsyncSync(fd); this.check(root); }
    finally { closeSync(fd); }
  }
  private stage(root: PairingRootIdentity, bytes: string, prefix = ".pairing-owner"): string {
    const name = `${prefix}-${randomUUID()}.tmp`, path = join(root.path, name);
    this.writeNew(root, name, bytes);
    return path;
  }
  private writeNew(root: PairingRootIdentity, name: string, bytes: string) {
    this.check(root);
    if ((name.includes("/") && !/^\.pairing-v2-slot-[0-7]\/[a-f0-9-]{36}\.json$/.test(name)) || name === "." || name === "..") refuse("unsafe_path");
    if (Buffer.byteLength(bytes) > FILE_LIMIT) refuse("capacity");
    const path = join(root.path, name);
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { owned(fstatSync(fd)); writeFileSync(fd, bytes); fsyncSync(fd); this.check(root); }
    catch (e) { try { unlinkSync(path); } catch {} throw e; }
    finally { closeSync(fd); }
  }
  /** Display-only data. Broken/unsafe advisory files never affect authority.
   * O_NONBLOCK also prevents a raced-in FIFO from blocking an advisory read. */
  private lastSeen(root: PairingRootIdentity): Map<string, string> {
    let fd: number | undefined;
    try {
      this.check(root);
      const path = join(root.path, LAST_SEEN);
      owned(lstatSync(path));
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = fstatSync(fd); owned(stat);
      if (stat.size > FILE_LIMIT || id(lstatSync(path)) !== id(stat)) return new Map();
      const bytes = readFileSync(fd);
      if (bytes.length > FILE_LIMIT || id(lstatSync(path)) !== id(stat)) return new Map();
      this.check(root);
      const value = JSON.parse(bytes.toString());
      if (!record(value) || value.schema !== "scout.pairing-last-seen/v1"
        || !Array.isArray(value.entries) || value.entries.length > 4096) return new Map();
      const entries = new Map<string, string>();
      for (const entry of value.entries) {
        if (!record(entry) || typeof entry.publicKey !== "string" || !/^[a-f0-9]{64}$/.test(entry.publicKey)
          || typeof entry.lastSeen !== "string" || entry.lastSeen.length > 128
          || !Number.isFinite(Date.parse(entry.lastSeen)) || entries.has(entry.publicKey)) return new Map();
        entries.set(entry.publicKey, entry.lastSeen);
      }
      return entries;
    } catch { return new Map(); }
    finally { if (fd !== undefined) { try { closeSync(fd); } catch {} } }
  }
  private laterSeen(peer: TrustedPeer, advisory: string): string {
    // Grant time is the floor; an old binary's newer projection value wins too.
    let latest = advisory;
    for (const value of [peer.pairedAt, peer.lastSeen]) {
      if (value !== undefined && Date.parse(value) > Date.parse(latest)) latest = value;
    }
    return latest;
  }
  private recordLastSeen(root: PairingRootIdentity, peers: readonly TrustedPeer[], publicKey: string, lastSeen: string) {
    let staged: string | null = null;
    try {
      if (!Number.isFinite(Date.parse(lastSeen))) return;
      const previous = this.lastSeen(root), entries: LastSeenEntry[] = [];
      for (const peer of peers) {
        const existing = previous.get(peer.publicKey);
        const candidate = peer.publicKey === publicKey && (!existing || Date.parse(lastSeen) > Date.parse(existing)) ? lastSeen : existing;
        if (candidate) entries.push({publicKey: peer.publicKey, lastSeen: this.laterSeen(peer, candidate)});
      }
      // Only current members survive. No advisory value enters state()/mutate().
      const bytes = JSON.stringify({schema: "scout.pairing-last-seen/v1", entries});
      staged = this.stage(root, bytes, ".pairing-last-seen");
      this.check(root); renameSync(staged, join(root.path, LAST_SEEN));
      // No directory durability barrier: advisory updates can be lost.
    } catch { /* Best effort: metadata failure must not fail a handshake. */ }
    finally { if (staged) { try { unlinkSync(staged); } catch {} } }
  }
  private marker(root: PairingRootIdentity): Marker | null {
    const bytes = this.readFile(root, MARKER); if (!bytes) return null;
    const value = JSON.parse(bytes.toString());
    if (value.schema !== "scout.pairing-trust-managed/v1" || value.rootId !== root.id
      || typeof value.adapterId !== "string" || !/^[a-z0-9.-]{1,64}$/.test(value.adapterId)) refuse("managed_marker_invalid");
    return value;
  }
  private state(root: PairingRootIdentity, allowPending = false): State {
    this.check(root);
    const inventory = readdirSync(root.path);
    if (inventory.some(n => n.startsWith(CAPSULE_PREFIX) || n.startsWith(".pairing-v2"))) return this.capsuleState(root, allowPending, inventory);
    const marker = this.marker(root);
    const names = readdirSync(root.path).filter(n => n.startsWith(PREFIX));
    if (names.length > REVISION_LIMIT) refuse("capacity");
    const revisions = names.map(n => {
      const match = /^trusted-peers\.owner\.([1-9][0-9]*)\.json$/.exec(n);
      if (!match || !Number.isSafeInteger(Number(match[1]))) refuse("generation_invalid");
      return Number(match[1]);
    }).sort((a,b) => a-b);
    const projection = this.readFile(root, PEERS);
    // Parse the legacy projection only after classifying a pending owner head.
    // A pending head determines its own peers, even after an outside write.
    const projectionHash = hash(projection ?? Buffer.alloc(0));
    let current: State = {revision: 0, peers: [], hash: projectionHash, peersHash: projectionHash,
      managed: null, outcomes: {}, bytes: 0, projectionHash, adoption: null, pendingStage: null, projectionStage: null};
    for (const revision of revisions) {
      if (revision !== current.revision + 1) refuse("generation_gap");
      const bytes = this.readFile(root, `${PREFIX}${revision}.json`); if (!bytes) refuse("generation_missing");
      current.bytes += bytes.length; if (current.bytes > TOTAL_LIMIT) refuse("capacity");
      const envelope = JSON.parse(bytes.toString()), value: Generation = envelope.generation;
      if (!record(value) || envelope.sha256 !== hash(JSON.stringify(value))) refuse("generation_checksum");
      if (value.schema !== "scout.pairing-trust-owner/v1" || value.rootId !== root.id || value.revision !== revision
        || !/^[a-f0-9]{64}$/.test(value.previousHash) || (revision > 1 && value.previousHash !== current.hash)
        || !record(value.mutation)) refuse("generation_invalid");
      const peers = peersOf(value.peers);
      if (value.peersHash !== hash(encodePeers(peers))) refuse("generation_invalid");
      const saved = value.mutation, outcome = saved.outcome;
      if (typeof saved.request !== "string" || !record(outcome)
        || !/^[a-zA-Z0-9._:-]{1,128}$/.test(outcome.mutationId) || outcome.revision !== revision
        // Historical draft refresh outcomes remain readable; no new refresh
        // mutation is accepted or persisted by this owner.
        || !["grant","refresh","revoke","manage"].includes(outcome.type) || typeof outcome.changed !== "boolean"
        || (outcome.type === "manage" ? outcome.publicKey !== null : typeof outcome.publicKey !== "string" || !/^[0-9a-f]{64}$/.test(outcome.publicKey))
        || Object.hasOwn(current.outcomes, outcome.mutationId)) refuse("generation_invalid");
      const outcomes = current.outcomes;
      Object.defineProperty(outcomes, outcome.mutationId, {value: saved, enumerable: true});
      if (current.managed && JSON.stringify(value.managed) !== JSON.stringify(current.managed)) refuse("managed_downgrade");
      if (value.adoption != null && (!record(value.adoption)
        || !/^[a-f0-9]{64}$/.test(value.adoption.fromProjectionHash) || !/^[a-f0-9]{64}$/.test(value.adoption.toProjectionHash))) refuse("generation_invalid");
      if (value.projectionStage !== undefined && !/^\.pairing-owner-[a-f0-9-]{36}\.tmp$/.test(value.projectionStage)) refuse("generation_invalid");
      const pendingStage = this.pendingStage(root, revision);
      if (pendingStage && revision !== revisions.at(-1)) refuse("publication_incomplete");
      current = {...value, peers, outcomes, hash: hash(bytes), bytes: current.bytes,
        projectionHash, adoption: null, pendingStage, projectionStage: value.projectionStage ?? null};
    }
    if (JSON.stringify(current.managed) !== JSON.stringify(marker)) refuse("managed_marker_mismatch");
    if (marker) {
      const adapter = adapters.get(root.id);
      if (!adapter || adapter.id !== marker.adapterId) refuse("managed_adapter_required");
      const active = invocations.getStore();
      if (!active || active.owner !== this) refuse("managed_context_required");
      this.validateInvocation(active, root);
    }
    if (JSON.stringify(readdirSync(root.path).filter(n => n.startsWith(PREFIX)).sort()) !== JSON.stringify(names.sort())) refuse("revision_conflict");
    this.check(root);
    if (current.pendingStage) {
      if (!allowPending) refuse("publication_incomplete");
      return current;
    }
    const changedProjection = current.revision > 0 && projectionHash !== current.peersHash;
    if (marker && changedProjection) refuse("external_change_or_incomplete");
    if (!marker) {
      // Mixed-version standalone operation: outside writers are not serialized
      // by our CAS. Adopt their validated array without rewriting our ledger.
      current.peers = projection ? peersOf(JSON.parse(projection.toString())) : [];
      if (changedProjection) current.adoption = {fromProjectionHash: current.peersHash, toProjectionHash: projectionHash};
    }
    return current;
  }
  private retainedStage(root: PairingRootIdentity, name: string, generationAlias = false): Buffer | null {
    try { return this.readFile(root, name, generationAlias); }
    catch (error) {
      // The shared source can be consumed while its fd is being inspected.
      // Absence is verified below against the ledger/projection, never guessed.
      try { lstatSync(join(root.path, name)); }
      catch (missing) { if ((missing as NodeJS.ErrnoException).code === "ENOENT") return null; }
      throw error;
    }
  }
  /** Publish from ONE consumable source, shared by the reserving writer and all
   * helpers. Never recreate it: a delayed rename then gets ENOENT instead of
   * overwriting a newer revision. This is not a liveness/age-based lock. */
  private completePublication(root: PairingRootIdentity, state: State) {
    if (completing.has(root.id)) refuse("publication_incomplete");
    completing.add(root.id);
    try {
      const bytes = encodePeers(state.peers);
      if (hash(bytes) !== state.peersHash) refuse("publication_incomplete");
      const current = this.state(root, true);
      if (current.revision !== state.revision || current.hash !== state.hash || !current.pendingStage) {
        this.syncDirectory(root); return;
      }
      let source = state.projectionStage;
      if (!source) {
        // Older envelopes did not name the projection stage. A real crash
        // retains it; ambiguity or absence with an old projection stays closed.
        const matches = readdirSync(root.path).filter(name => /^\.pairing-owner-[a-f0-9-]{36}\.tmp$/.test(name))
          .filter(name => { const data = this.retainedStage(root, name, true); return data && hash(data) === state.peersHash; });
        if (matches.length > 1) refuse("publication_incomplete");
        source = matches[0] ?? null;
      }
      const staged = source ? this.retainedStage(root, source) : null;
      if (staged) {
        if (hash(staged) !== state.peersHash) refuse("publication_incomplete");
        this.check(root);
        try { renameSync(join(root.path, source!), join(root.path, PEERS)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      // Missing source is either a helper's atomic rename or damaged evidence.
      // Verify the current ledger before removing the witness or claiming ACK.
      const after = this.state(root, true);
      if (after.revision === state.revision && after.pendingStage) {
        if (after.projectionHash !== state.peersHash) refuse("publication_incomplete");
        try { unlinkSync(after.pendingStage); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      this.syncDirectory(root);
    } catch (error) {
      // Structural integrity/marker/context refusals keep their precise codes.
      if (error instanceof PairingTrustError) throw error;
      refuse("publication_incomplete");
    } finally { completing.delete(root.id); }
  }
  private readyState(root: PairingRootIdentity): State {
    const state = this.state(root, true);
    if (state.capsule) {
      if (state.capsule.needsRecovery) this.completeCapsule(root, state);
      return state.capsule.needsRecovery ? this.state(root) : state;
    }
    if (state.pendingStage) this.completePublication(root, state);
    return state.pendingStage ? this.state(root) : state;
  }
  private capsulePolicy(root: PairingRootIdentity, policy: ManagedPolicy | null) {
    if (!policy) return;
    const adapter = adapters.get(root.id);
    if (!adapter || adapter.id !== policy.marker.adapterId) refuse("managed_adapter_required");
    const active = invocations.getStore();
    if (!active || active.owner !== this) refuse("managed_context_required");
    this.validateInvocation(active, root);
  }
  /** A slot is an atomic mkdir resource claim. The unique token file is never
   * reused. Late release unlinks only that token; rmdir cannot remove a new,
   * nonempty claim. A raced empty replacement fails its creator's inode check.
   * Empty/crashed slots remain occupied; no PID, timestamp or age takeover. */
  private capsuleSlots(root: PairingRootIdentity, inventory: string[]) {
    const claims = new Map<string,CapsuleSlot>(), allowed = new Set<string>();
    for (const name of inventory.filter(n => n.startsWith(".pairing-v2-slot-"))) {
      if (!/^\.pairing-v2-slot-[0-7]$/.test(name)) refuse("capacity");
      const index = Number(name.at(-1)), path = join(root.path,name), stat = lstatSync(path); owned(stat,true);
      const children = readdirSync(path);
      if (children.length > 1) refuse("unsafe_path");
      allowed.add(name);
      if (!children.length) continue;
      const child = children[0]!;
      if (!/^[a-f0-9-]{36}\.json$/.test(child)) refuse("unsafe_path");
      const bytes = this.readFile(root,`${name}/${child}`,false); if (!bytes) refuse("revision_conflict");
      const claim = unpack<Record<string,unknown>>(bytes,"claim",refuse);
      if (claim.rootId !== root.id || claim.index !== index || !token(claim.token) || child !== `${claim.token}.json`
        || claim.identity !== id(stat) || id(lstatSync(path)) !== id(stat)) refuse("unsafe_path");
      const slot = {index,token:claim.token,identity:id(stat)};
      if(claims.has(slot.token))refuse("capsule_slot_invalid");claims.set(slot.token,slot);
      let total = bytes.length;
      for (const candidate of [dataName(slot.token), ...(["peers","commit","marker","done"] as const).map(r=>stageName(slot.token,r))]) {
        allowed.add(candidate);
        try {
          const s = lstatSync(join(root.path,candidate)); owned(s,false,false,candidate===stageName(slot.token,"commit"));
          if (s.size > FILE_LIMIT) refuse("capacity"); total += s.size;
        } catch (e) {if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;}
      }
      if (total > SLOT_LIMIT) refuse("capacity");
    }
    this.check(root); return {claims,allowed};
  }
  private capsuleState(root: PairingRootIdentity, allowPending: boolean, inventory: string[]): State {
    const names = inventory.filter(n=>n.startsWith(PREFIX) || n.startsWith(CAPSULE_PREFIX) || n.startsWith(".pairing-v2")).sort();
    if (names.length > 360) refuse("capacity");
    const barriers = names.filter(n=>n.startsWith(PREFIX));
    if (barriers.length !== 1) refuse("capsule_unexpected_history");
    const barrierBytes = this.readFile(root,barriers[0]!,false); if (!barrierBytes) refuse("capsule_barrier_required");
    const b = unpack<CapsuleBarrier>(barrierBytes,"barrier",refuse), cutHash = hash(barrierBytes);
    if (b.schema !== "scout.pairing-cut/v2" || b.rootId !== root.id || !integer(b.revision,0,REVISION_LIMIT)
      || barriers[0] !== `${PREFIX}${b.revision+1}.json` || !hex(b.logicalHead) || !hex(b.logicalPeersHash)
      || !hex(b.checkpointPeersHash) || !hex(b.projectionHash) || !hex(b.outcomesDigest)
      || !integer(b.chargedBytes,0,TOTAL_LIMIT) || !policyValid(b.policy,root.id,b.revision)
      || !Array.isArray(b.parts) || b.parts.length>256 || !b.parts.every(partValid)) refuse("capsule_barrier_invalid");
    const cutBytes = this.readFile(root,CUTOVER,false); if (!cutBytes) refuse("capsule_cutover_incomplete");
    const cut = unpack<Record<string,unknown>>(cutBytes,"receipt",refuse);
    if (cut.schema !== "scout.pairing-cutover-done/v2" || cut.rootId !== root.id || cut.cutHash !== cutHash) refuse("capsule_cutover_incomplete");
    const serials = names.filter(n=>n.startsWith(`${CAPSULE_PREFIX}commit.`)).map(n=>{
      const match=/^trusted-peers\.v2\.commit\.([1-9][0-9]*)\.json$/.exec(n);
      if (!match || !integer(Number(match[1]),1,Number.MAX_SAFE_INTEGER)) refuse("capsule_serial_invalid");
      return Number(match[1]);
    });
    if (!serials.length || serials.length>2) refuse("capsule_serial_invalid");
    const serial = Math.max(...serials), name = commitName(serial);
    const physical = this.readFile(root,name,true); if (!physical) refuse("revision_conflict");
    const h = unpack<CapsuleHead>(physical,"capsule",refuse), physicalHash = hash(physical);
    if (h.schema !== "scout.pairing-capsule/v2") refuse("capsule_version_unsupported");
    if (h.rootId !== root.id || h.cutHash !== cutHash || h.serial !== serial || !integer(h.revision,b.revision,REVISION_LIMIT)
      || h.serial!==h.revision-b.revision+1
      || !hex(h.logicalHead) || !hex(h.previousLogicalHead) || !hex(h.previousPhysicalHead)
      || !hex(h.logicalPeersHash) || !hex(h.checkpointPeersHash) || !hex(h.projectionHash) || !hex(h.outcomesDigest)
      || !integer(h.chargedBytes,0,TOTAL_LIMIT) || !policyValid(h.policy,root.id,h.revision)
      || !Array.isArray(h.parts) || h.parts.length>256 || !h.parts.every(partValid)
      || !Array.isArray(h.retire) || h.retire.length>3) refuse("capsule_invalid");
    if (!same(h.parts.slice(0,b.parts.length),b.parts)) refuse("capsule_cut_changed");
    const checkpointPeers=peersOf(h.peers);
    if (hash(encodePeers(checkpointPeers)) !== h.checkpointPeersHash) refuse("capsule_peers_invalid");
    if (h.adoption !== null && (!record(h.adoption) || !hex(h.adoption.fromProjectionHash) || !hex(h.adoption.toProjectionHash))) refuse("capsule_invalid");
    const uniqueParts=new Set(h.parts.map(p=>p.name));
    if (uniqueParts.size !== h.parts.length) refuse("capsule_invalid");
    const outcomes:Record<string,SavedOutcome>={}, rows:CapsuleRow[]=[], partData:Buffer[]=[];
    let charge=0, cutCharge=0, policy:ManagedPolicy|null=null, cutPolicy:ManagedPolicy|null=null, authorityBytes=physical.length+barrierBytes.length+cutBytes.length;
    // Reject an over-budget inventory before allocating its bodies. Each
    // declared byte length is also compared with the checked file below.
    if(authorityBytes+h.parts.reduce((n,p)=>n+p.bytes,0)>TOTAL_LIMIT)refuse("capacity");
    const fullDigest=createHash("sha256").update("["), cutDigest=createHash("sha256").update("[");
    for (let i=0;i<h.parts.length;i++) {
      const p=h.parts[i]!, bytes=this.readFile(root,p.name,false); if (!bytes) refuse("capsule_chunk_missing");
      authorityBytes+=bytes.length; if (authorityBytes>TOTAL_LIMIT) refuse("capacity");
      if (bytes.length!==p.bytes || hash(bytes)!==p.sha256) refuse("capsule_chunk_checksum");
      if (bytes[0]!==91 || bytes.at(-1)!==93) refuse("capsule_rows_invalid");
      const values:unknown=JSON.parse(bytes.toString());
      if (!Array.isArray(values) || values.length!==p.count) refuse("capsule_rows_invalid");
      if(i) fullDigest.update(","); fullDigest.update(bytes.subarray(1,-1));
      if(i<b.parts.length){if(i)cutDigest.update(",");cutDigest.update(bytes.subarray(1,-1));}
      for(const value of values){
        if(!rowValid(value,rows.length+1,root.id) || Object.hasOwn(outcomes,value[0])) refuse("capsule_outcome_invalid");
        const row=value; rows.push(row); charge+=row[6];
        if(row[2]==="manage") {if(policy)refuse("managed_downgrade");policy={revision:row[1],marker:row[7]!};}
        if(row[1]<=b.revision){cutCharge+=row[6];cutPolicy=policy;}
        Object.defineProperty(outcomes,row[0],{value:{request:row[5],outcome:outcome(row)},enumerable:true});
      }
      partData.push(bytes);
    }
    if(rows.length!==h.revision || charge!==h.chargedBytes || charge>TOTAL_LIMIT || cutCharge!==b.chargedBytes
      || b.parts.reduce((n,p)=>n+p.count,0)!==b.revision || fullDigest.update("]").digest("hex")!==h.outcomesDigest
      || cutDigest.update("]").digest("hex")!==b.outcomesDigest) refuse("capsule_outcomes_invalid");
    // Permanent policy is derived from all retained records, not a head flag.
    if(!same(policy,h.policy) || !same(cutPolicy,b.policy)) refuse("managed_downgrade");
    if(h.revision===b.revision){
      if(h.previousLogicalHead!==b.logicalHead || h.previousPhysicalHead!==cutHash || h.logicalHead!==b.logicalHead || h.logicalPeersHash!==b.logicalPeersHash || h.checkpointPeersHash!==b.checkpointPeersHash
        || h.projectionHash!==b.projectionHash || h.outcomesDigest!==b.outcomesDigest) refuse("capsule_cut_changed");
    } else if(h.logicalPeersHash!==h.checkpointPeersHash || h.projectionHash!==h.checkpointPeersHash
      || h.logicalHead!==logicalHead(root.id,h.revision,h.previousLogicalHead,h.logicalPeersHash,h.policy,rows.at(-1)!,h.adoption,h.outcomesDigest)) refuse("capsule_logical_head_invalid");
    this.capsulePolicy(root,policy);
    const slots=this.capsuleSlots(root,inventory);
    if(h.slot!==null && (!record(h.slot) || !integer(h.slot.index,0,7) || !token(h.slot.token)
      || typeof h.slot.identity!=="string" || !/^\d+:\d+$/.test(h.slot.identity))) refuse("capsule_slot_invalid");
    if(h.slot===null && (h.serial!==1 || h.revision!==b.revision)) refuse("capsule_slot_invalid");
    const stat=lstatSync(join(root.path,name));owned(stat,false,false,true);
    const pending=stat.nlink===2;
    if(pending){
      if(!h.slot || !same(slots.claims.get(h.slot.token),h.slot)) refuse("capsule_slot_invalid");
      const witness=lstatSync(join(root.path,stageName(h.slot.token,"commit")));owned(witness,false,false,true);
      if(id(witness)!==id(stat))refuse("publication_incomplete");
    }
    const marker=this.marker(root), managed=policy?.marker??null;
    if(!same(marker,managed) && !(pending && marker===null && managed!==null)) refuse("managed_marker_mismatch");
    const projection=this.readFile(root,PEERS), projectionHash=hash(projection??Buffer.alloc(0));
    let peers=checkpointPeers, adoption:ProjectionAdoption|null=null;
    if(!pending){
      if(managed && projectionHash!==h.logicalPeersHash)refuse("external_change_or_incomplete");
      if(!managed){
        peers=projection?peersOf(JSON.parse(projection.toString())):[];
        if(projectionHash!==h.logicalPeersHash)adoption={fromProjectionHash:h.logicalPeersHash,toProjectionHash:projectionHash};
      }
    }
    const allowed=new Set([barriers[0]!,CUTOVER,name,doneName(serial),...h.parts.map(p=>p.name),...slots.allowed]);
    const retiredNames=new Set<string>();
    if(serial===1 && h.retire.length)refuse("capsule_retirement_invalid");
    for(const r of h.retire){
      if(!record(r) || typeof r.name!=="string" || !hex(r.sha256) || typeof r.identity!=="string" || !/^\d+:\d+$/.test(r.identity)
        || retiredNames.has(r.name) || uniqueParts.has(r.name)
        || !(r.name===commitName(serial-1) && r.sha256===h.previousPhysicalHead || r.name===doneName(serial-1)
          || /^trusted-peers\.v2\.data\.[a-f0-9-]{36}\.json$/.test(r.name))) refuse("capsule_retirement_invalid");
      retiredNames.add(r.name);allowed.add(r.name);
    }
    if(serial>1 && (!retiredNames.has(commitName(serial-1)) || !retiredNames.has(doneName(serial-1))))refuse("capsule_retirement_invalid");
    if(names.some(n=>!allowed.has(n)))refuse("capsule_unexpected_history");
    const receiptBytes=this.readFile(root,doneName(serial),false);
    if(receiptBytes){const receipt=unpack<Record<string,unknown>>(receiptBytes,"receipt",refuse);
      if(authorityBytes+receiptBytes.length>TOTAL_LIMIT)refuse("capacity");
      if(receipt.schema!=="scout.pairing-collected/v2" || receipt.rootId!==root.id || receipt.serial!==serial || receipt.physicalHash!==physicalHash)refuse("capsule_receipt_invalid");
      if(h.retire.some(r=>names.includes(r.name)))refuse("capsule_retired_reappeared");
    }
    const ownSlotExists=!!(h.slot && names.includes(slotName(h.slot.index)) && id(lstatSync(join(root.path,slotName(h.slot.index))))===h.slot.identity);
    const needsRecovery=pending || !receiptBytes || ownSlotExists;
    if(needsRecovery && !allowPending)refuse("publication_incomplete");
    const after=readdirSync(root.path).filter(n=>n.startsWith(PREFIX)||n.startsWith(CAPSULE_PREFIX)||n.startsWith(".pairing-v2")).sort();
    if(!same(names,after))refuse("revision_conflict");this.check(root);
    this.capsulePolicy(root,policy); // Also validate the holder after all authority I/O.
    return {revision:h.revision,peers,hash:h.logicalHead,peersHash:h.logicalPeersHash,managed,outcomes,bytes:charge,
      projectionHash,adoption,pendingStage:pending&&h.slot?join(root.path,stageName(h.slot.token,"commit")):null,
      projectionStage:h.slot?stageName(h.slot.token,"peers"):null,
      capsule:{barrier:b,barrierName:barriers[0]!,cutHash,head:h,physicalHash,rows,partData,needsRecovery,pending}};
  }
  private syncSlot(root: PairingRootIdentity, slot: CapsuleSlot) {
    this.check(root); const path=join(root.path,slotName(slot.index));
    const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    try {const s=fstatSync(fd);owned(s,true);if(id(s)!==slot.identity)refuse("capsule_slot_invalid");fsyncSync(fd);}
    finally {closeSync(fd);} this.check(root);
  }
  private claimCapsuleSlot(root: PairingRootIdentity): CapsuleSlot {
    for(let index=0;index<8;index++){
      const path=join(root.path,slotName(index));
      this.check(root);
      try{mkdirSync(path,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code==="EEXIST")continue;throw e;}
      const stat=lstatSync(path);owned(stat,true);
      const slot={index,token:randomUUID(),identity:id(stat)};
      try {
        this.writeNew(root,`${slotName(index)}/${slot.token}.json`,pack("claim",{rootId:root.id,...slot}));
        if(id(lstatSync(path))!==slot.identity || !same(readdirSync(path),[`${slot.token}.json`]))refuse("capsule_slot_invalid");
        this.syncSlot(root,slot);this.syncDirectory(root);return slot;
      } catch(e){this.releaseCapsuleSlot(root,slot);throw e;}
    }
    return refuse("capsule_staging_capacity");
  }
  private releaseCapsuleSlot(root: PairingRootIdentity, slot: CapsuleSlot) {
    this.check(root);const directory=join(root.path,slotName(slot.index));
    let stat;try{stat=lstatSync(directory);}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return;throw e;}
    owned(stat,true);if(id(stat)!==slot.identity)return; // a different, newer claim
    const name=`${slotName(slot.index)}/${slot.token}.json`, bytes=this.readFile(root,name,false);
    if(bytes){const claim=unpack<Record<string,unknown>>(bytes,"claim",refuse);
      if(!same(claim,{rootId:root.id,...slot}))refuse("capsule_slot_invalid");
      try{unlinkSync(join(root.path,name));}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
    }
    // Never delete an entry owned by another token, or recursively remove a slot.
    try {
      if(id(lstatSync(directory))!==slot.identity)return;
      this.syncSlot(root,slot);rmdirSync(directory);
    }catch(e){if(!["ENOENT","ENOTEMPTY","EEXIST"].includes((e as NodeJS.ErrnoException).code??""))throw e;}
    this.syncDirectory(root);
  }
  private capsuleFileIdentity(root: PairingRootIdentity, name: string): RetiredFile {
    const bytes=this.readFile(root,name,false);if(!bytes)refuse("revision_conflict");
    const stat=lstatSync(join(root.path,name));owned(stat);
    return {name,sha256:hash(bytes),identity:id(stat)};
  }
  private completeCapsule(root: PairingRootIdentity, snapshot: State) {
    if(completing.has(root.id))refuse("publication_incomplete");
    completing.add(root.id);
    try {
      let state=this.state(root,true), cap=state.capsule!;
      if(!cap || cap.head.serial!==snapshot.capsule!.head.serial)return;
      const h=cap.head, slot=h.slot;
      if(cap.pending){
        if(!slot)refuse("publication_incomplete");
        this.capsulePolicy(root,h.policy);
        if(h.policy){
          const markerSource=stageName(slot.token,"marker"), staged=this.readFile(root,markerSource,false);
          if(staged){
            if(!same(JSON.parse(staged.toString()),h.policy.marker))refuse("publication_incomplete");
            try{renameSync(join(root.path,markerSource),join(root.path,MARKER));}
            catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
          }
          if(!same(this.marker(root),h.policy.marker))refuse("managed_marker_mismatch");
        }
        const source=stageName(slot.token,"peers"), bytes=this.readFile(root,source,false);
        if(bytes){
          if(hash(bytes)!==h.projectionHash)refuse("publication_incomplete");
          this.check(root);
          try{renameSync(join(root.path,source),join(root.path,PEERS));}
          catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
        }
        state=this.state(root,true);cap=state.capsule!;
        if(cap.head.serial!==h.serial)return;
        if(state.projectionHash!==h.projectionHash || !same(this.marker(root),h.policy?.marker??null))refuse("publication_incomplete");
        try{unlinkSync(join(root.path,stageName(slot.token,"commit")));}
        catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
        this.syncDirectory(root);
      }
      state=this.state(root,true);cap=state.capsule!;
      if(cap.head.serial!==h.serial)return;
      if(!this.readFile(root,doneName(h.serial),false)){
        // Establish publication durability BEFORE retiring any older authority.
        this.syncDirectory(root);
        try {
          for(const retired of h.retire){
            const bytes=this.readFile(root,retired.name,false);
            if(!bytes)continue;
            const stat=lstatSync(join(root.path,retired.name));owned(stat);
            if(id(stat)!==retired.identity || hash(bytes)!==retired.sha256)refuse("capsule_retirement_changed");
            this.check(root);
            try{unlinkSync(join(root.path,retired.name));}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
          }
          this.syncDirectory(root);
          if(!slot)refuse("publication_incomplete");
          const receiptSource=stageName(slot.token,"done"), receipt=this.readFile(root,receiptSource,false);
          if(receipt){
            const r=unpack<Record<string,unknown>>(receipt,"receipt",refuse);
            if(r.rootId!==root.id || r.serial!==h.serial || r.physicalHash!==cap.physicalHash || r.schema!=="scout.pairing-collected/v2")refuse("capsule_receipt_invalid");
            try{renameSync(join(root.path,receiptSource),join(root.path,doneName(h.serial)));}
            catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
          }
          this.syncDirectory(root);
          // A consumed receipt source is never reconstructed by a late helper.
          const latest=this.state(root,true);
          if(latest.capsule!.head.serial!==h.serial)return;
          if(!this.readFile(root,doneName(h.serial),false))refuse("publication_incomplete");
        }catch(e){if(e instanceof PairingTrustError)throw e;refuse("capsule_collection_failed");}
      }
      if(slot)this.releaseCapsuleSlot(root,slot);
    } catch(e){if(e instanceof PairingTrustError)throw e;refuse("publication_incomplete");}
    finally{completing.delete(root.id);}
  }
  private publishCapsule(root: PairingRootIdentity, state: State, peers: TrustedPeer[], managed: Marker|null,
    request: string, result: TrustOutcome, invocation?: Invocation, beforePublish?:()=>void): TrustOutcome {
    const prior=state.capsule!, old=prior.head;
    if(old.serial>=Number.MAX_SAFE_INTEGER)refuse("capacity");
    const charge=legacyCharge(root.id,result.revision,state.hash,peers,managed,request,result,state.adoption);
    if(charge>FILE_LIMIT || state.bytes+charge>TOTAL_LIMIT)refuse("capacity");
    const row:CapsuleRow=[result.mutationId,result.revision,result.type,result.publicKey,result.changed,request,charge,
      result.type==="manage"?managed:null];
    const policy:ManagedPolicy|null=result.type==="manage"?{revision:result.revision,marker:managed!}:old.policy;
    this.capsulePolicy(root,policy);
    const slot=this.claimCapsuleSlot(root), serial=old.serial+1;
    let reserved=false, uncertain=false;
    try {
      const parts=old.parts.map(p=>({...p})), payloads=prior.partData.slice();
      let replaced:CapsulePart|undefined, data:string;
      const tail=payloads.at(-1);
      // Initial cut chunks stay immutable forever. Later writes COW only the final chunk.
      if(parts.length>prior.barrier.parts.length && tail && tail.length+Buffer.byteLength(JSON.stringify(row))+1<=CHUNK_TARGET){
        replaced=parts.pop();payloads.pop();
        data=tail.subarray(0,-1).toString()+","+JSON.stringify(row)+"]";
        if(!Buffer.from(data).subarray(0,tail.length-1).equals(tail.subarray(0,-1)))refuse("capsule_prior_rows_changed");
      }else data=JSON.stringify([row]);
      const bytes=Buffer.from(data), part:CapsulePart={name:dataName(slot.token),sha256:hash(bytes),bytes:bytes.length,
        count:(replaced?.count??0)+1};
      if(bytes.length>FILE_LIMIT || parts.length>=256)refuse("capacity");
      parts.push(part);payloads.push(bytes);
      const table=createHash("sha256").update("[");
      payloads.forEach((b,i)=>{if(i)table.update(",");table.update(b.subarray(1,-1));});
      const outcomesDigest=table.update("]").digest("hex"), peerBytes=encodePeers(peers), peersHash=hash(peerBytes);
      const retire=[this.capsuleFileIdentity(root,commitName(old.serial)),this.capsuleFileIdentity(root,doneName(old.serial))];
      if(replaced)retire.push(this.capsuleFileIdentity(root,replaced.name));
      const h:CapsuleHead={schema:"scout.pairing-capsule/v2",rootId:root.id,cutHash:prior.cutHash,serial,
        revision:result.revision,logicalHead:logicalHead(root.id,result.revision,state.hash,peersHash,policy,row,state.adoption,outcomesDigest),
        previousLogicalHead:state.hash,previousPhysicalHead:prior.physicalHash,logicalPeersHash:peersHash,
        checkpointPeersHash:peersHash,projectionHash:peersHash,peers,policy,outcomesDigest,chargedBytes:state.bytes+charge,
        parts,adoption:state.adoption,slot,retire};
      const header=pack("capsule",h), physicalHash=hash(header);
      const receipt=pack("receipt",{schema:"scout.pairing-collected/v2",rootId:root.id,serial,physicalHash});
      const markerBytes=managed && !state.managed?JSON.stringify(managed):"";
      if([data,peerBytes,header,receipt,markerBytes].some(v=>Buffer.byteLength(v)>FILE_LIMIT))refuse("capacity");
      const barrierBytes=this.readFile(root,prior.barrierName,false), cutBytes=this.readFile(root,CUTOVER,false);
      if(!barrierBytes || !cutBytes)refuse("revision_conflict");
      if(Buffer.byteLength(header)+parts.reduce((n,p)=>n+p.bytes,0)+barrierBytes.length+cutBytes.length+Buffer.byteLength(receipt)>TOTAL_LIMIT)refuse("capacity");
      const claimBytes=this.readFile(root,`${slotName(slot.index)}/${slot.token}.json`,false);
      if(!claimBytes || claimBytes.length+bytes.length+Buffer.byteLength(peerBytes)+Buffer.byteLength(header)+Buffer.byteLength(receipt)+Buffer.byteLength(markerBytes)>SLOT_LIMIT)refuse("capacity");
      this.writeNew(root,part.name,data);
      this.writeNew(root,stageName(slot.token,"peers"),peerBytes);
      if(markerBytes)this.writeNew(root,stageName(slot.token,"marker"),markerBytes);
      this.writeNew(root,stageName(slot.token,"commit"),header);
      this.writeNew(root,stageName(slot.token,"done"),receipt);
      this.capsuleSlots(root,readdirSync(root.path));
      this.syncDirectory(root);
      const before=this.state(root);
      if(!before.capsule || before.revision!==state.revision || before.hash!==state.hash || before.projectionHash!==state.projectionHash
        || before.capsule.physicalHash!==prior.physicalHash)refuse("revision_conflict");
      // Verify the actual candidate sources, not just the in-memory intent.
      const candidateFiles:[string,string][]=[[part.name,data],[stageName(slot.token,"peers"),peerBytes],
        [stageName(slot.token,"commit"),header],[stageName(slot.token,"done"),receipt]];
      if(markerBytes)candidateFiles.push([stageName(slot.token,"marker"),markerBytes]);
      for(const [name,expected] of candidateFiles){const actual=this.readFile(root,name,false);
        if(!actual || !actual.equals(Buffer.from(expected)))refuse("capsule_candidate_changed");}
      // Assert prior records, not merely their count, immediately before publication.
      const oldRows=before.capsule.rows;
      const candidateRows=payloads.flatMap(b=>JSON.parse(b.toString()) as CapsuleRow[]);
      if(!same(candidateRows.slice(0,-1),oldRows) || !same(candidateRows.at(-1),row))refuse("capsule_prior_rows_changed");
      if(invocation){this.validateInvocation(invocation,root);invocation.used=true;}
      beforePublish?.();
      uncertain=true;
      try{linkSync(join(root.path,stageName(slot.token,"commit")),join(root.path,commitName(serial)));}
      catch(e){if((e as NodeJS.ErrnoException).code==="EEXIST"){uncertain=false;refuse("revision_conflict");}throw e;}
      reserved=true;uncertain=false;
      this.syncDirectory(root);
      this.completeCapsule(root,this.state(root,true));
      if(invocation)this.validateInvocation(invocation,root);
      const committed=this.readyState(root);
      if(committed.outcomes[result.mutationId]?.request!==request)refuse("outcome_unavailable");
      return structuredClone(result);
    } finally {
      if(!reserved && !uncertain){
        for(const name of [dataName(slot.token),...(["peers","commit","marker","done"] as const).map(r=>stageName(slot.token,r))]){
          const bytes=this.readFile(root,name,false);
          if(bytes){this.check(root);try{unlinkSync(join(root.path,name));}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}}
        }
        this.releaseCapsuleSlot(root,slot);
      }
    }
  }
  private validateInvocation(invocation: Invocation, root: PairingRootIdentity) {
    if (!invocation.active || invocations.getStore() !== invocation || invocation.owner !== this
      || invocation.root.id !== root.id || adapters.get(root.id) !== invocation.adapter
      || invocation.adapter.currentHolder(root) !== invocation.holder) refuse("invalid_context");
  }
  /** One callback invocation; a context permits at most one publication.
   * Reads can repeat. Capturing an object does not capture gate ownership. */
  withInvocation<T>(body: (context: PairingTrustContext) => T): T {
    const root = this.root(true)!; const adapter = adapters.get(root.id);
    if (!adapter) refuse("managed_adapter_required");
    return adapter.withGate(root, holder => {
      const invocation: Invocation = {owner: this, root, adapter, holder, active: true, used: false};
      const context = Object.freeze({ toJSON(): never { return refuse("context_not_serializable"); } }) as unknown as PairingTrustContext;
      contexts.set(context, invocation);
      return invocations.run(invocation, () => {
        try {
          this.validateInvocation(invocation, root);
          const result = body(context);
          if (result && typeof (result as {then?: unknown}).then === "function") {
            return Promise.resolve(result).finally(() => { invocation.active = false; }) as T;
          }
          invocation.active = false; return result;
        } catch (e) { invocation.active = false; throw e; }
      });
    });
  }
  private operation<T>(context: PairingTrustContext | undefined, body: (root: PairingRootIdentity | null, invocation?: Invocation) => T): T {
    const root = this.root();
    if (context !== undefined) {
      const invocation = contexts.get(context as object);
      if (!root || !invocation) refuse("invalid_context");
      this.validateInvocation(invocation, root); return body(root, invocation);
    }
    if (root && adapters.has(root.id)) return this.withInvocation(ctx => this.operation(ctx, body));
    return body(root);
  }
  read(context?: PairingTrustContext): TrustSnapshot {
    const snapshot = this.operation(context, root => {
      if (!root) return {revision: 0, peers: [] as TrustedPeer[]};
      const state = this.readyState(root); return {revision: state.revision, peers: structuredClone(state.peers)};
    });
    try {
      const root = this.root(), advisory = root ? this.lastSeen(root) : new Map<string, string>();
      for (const peer of snapshot.peers) {
        const seen = advisory.get(peer.publicKey);
        if (seen) peer.lastSeen = this.laterSeen(peer, seen);
      }
    } catch { /* An unavailable advisory file never hides an authority snapshot. */ }
    return snapshot;
  }
  /** Membership is authoritative; the subsequent display-only write is best
   * effort, needs no gate and never changes projection/generations/outcomes. */
  refresh(publicKey: string, lastSeen: string, context?: PairingTrustContext): void {
    fullKey(publicKey);
    if (typeof lastSeen !== "string" || lastSeen.length > 128) refuse("invalid_mutation");
    const snapshot = this.read(context);
    if (!snapshot.peers.some(peer => peer.publicKey === publicKey)) refuse("peer_revoked");
    try {
      const root = this.root();
      if (root) this.recordLastSeen(root, snapshot.peers, publicKey, lastSeen);
    } catch { /* Authority succeeded; advisory metadata is optional. */ }
  }
  /** Verified decision baseline for a trusted workflow crossing process startup.
   * This is not a grant; only a matching live opportunity can admit a peer. */
  pairingAuthorityStamp(): string {
    this.root(true);
    return this.operation(undefined, root => this.pairingOpportunityStamp(root!, this.readyState(root!)));
  }
  private pairingOpportunityStamp(root: PairingRootIdentity, state: State): string {
    return hash(JSON.stringify([root.id, state.revision, state.hash, state.projectionHash, state.managed]));
  }
  /** Trusted local workflow only. Opening a window does not write authority.
   * Any intervening authority change cancels it; advisory lastSeen is excluded. */
  openPairingOpportunity(room: string, expiresAt: number, expectedPublicKey?: string, expectedAuthorityStamp?: string): PairingOpportunity {
    if (expectedPublicKey !== undefined) fullKey(expectedPublicKey);
    if (typeof room !== "string" || !room || room.length > 256 || !Number.isFinite(expiresAt) || expiresAt <= Date.now()
      || expiresAt - Date.now() > 300_000) refuse("invalid_pairing_opportunity");
    this.root(true);
    const stamp = (root: PairingRootIdentity, state: State) => this.pairingOpportunityStamp(root, state);
    const baseline = this.operation(undefined, root => stamp(root!, this.readyState(root!)));
    if (expectedAuthorityStamp !== undefined && expectedAuthorityStamp !== baseline) refuse("pairing_opportunity_closed");
    const deadline = performance.now() + (expiresAt - Date.now());
    const id = randomUUID(); let closed = false, consumed = false;
    const valid = () => !closed && !consumed && Date.now() < expiresAt && performance.now() < deadline;
    return Object.freeze({ id, expiresAt,
      toJSON(): never { return refuse("opportunity_not_serializable"); },
      cancel() { closed = true; },
      isOpen: () => {
        if (!valid()) { closed = true; return false; }
        try {
          const current = this.operation(undefined, root => stamp(root!, this.readyState(root!)));
          if (current !== baseline) closed = true;
          return valid();
        } catch { closed = true; return false; }
      },
      admit: (publicKey: string, logicalRoom: string, isLive: () => boolean) => {
        try {
          fullKey(publicKey);
          // A different key cannot consume a named request's opportunity.
          if (expectedPublicKey !== undefined && publicKey !== expectedPublicKey) return false;
          if (logicalRoom !== room || !isLive() || !valid()) { closed = true; return false; }
          return this.operation(undefined, (root, invocation) => {
            const state = this.readyState(root!);
            if (!isLive() || !valid() || stamp(root!, state) !== baseline) { closed = true; return false; }
            // Consume before publication, including failed/uncertain publication.
            consumed = true;
            // A trusted scan still consumes, but creates no authority generation.
            if (state.peers.some(peer => peer.publicKey === publicKey)) {
              if (!isLive() || closed || Date.now() >= expiresAt || performance.now() >= deadline
                || stamp(root!, this.readyState(root!)) !== baseline) { closed = true; return false; }
              return true;
            }
            const peer = {publicKey, pairedAt: new Date().toISOString()};
            const context = invocation ? this.contextFor(invocation) : undefined;
            this.mutateGuarded(state.revision, id, {type: "grant", peer}, context, () => {
              const current = this.readyState(root!);
              if (!isLive() || closed || Date.now() >= expiresAt || performance.now() >= deadline
                || stamp(root!, current) !== baseline) refuse("pairing_opportunity_closed");
            });
            return true;
          });
        } catch (error) { closed = true; throw error; }
      },
    });
  }
  mutate(expectedRevision: number, mutationId: string, raw: TrustMutation, context?: PairingTrustContext): TrustOutcome {
    return this.mutateGuarded(expectedRevision, mutationId, raw, context);
  }
  private mutateGuarded(expectedRevision: number, mutationId: string, raw: TrustMutation, context?: PairingTrustContext, beforePublish?: () => void): TrustOutcome {
    // Snapshot untrusted caller-owned objects before adapter callbacks or I/O.
    const mutation = structuredClone(raw);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !/^[a-zA-Z0-9._:-]{1,128}$/.test(mutationId)) refuse("invalid_mutation");
    if (mutation.type === "grant") mutation.peer = peersOf([mutation.peer])[0]!;
    else if (mutation.type === "revoke") fullKey(mutation.publicKey);
    else if (mutation.type !== "manage") refuse("invalid_mutation");
    this.root(true);
    return this.operation(context, (bound, invocation) => {
      const root = bound!, state = this.readyState(root);
      const request = JSON.stringify([expectedRevision, mutation.type,
        mutation.type === "grant" ? mutation.peer : mutation.type === "manage" ? null : mutation.publicKey,
        null]);
      const saved = Object.hasOwn(state.outcomes, mutationId) ? state.outcomes[mutationId] : undefined;
      if (saved) {
        if (saved.request !== request) refuse("mutation_id_reused");
        // An earlier attempt may have published but failed its directory sync.
        // A retry must establish the barrier, not infer durability from bytes.
        this.syncDirectory(root);
        if (invocation) this.validateInvocation(invocation, root);
        const verified = this.state(root);
        if (verified.outcomes[mutationId]?.request !== request) refuse("outcome_unavailable");
        return structuredClone(saved.outcome);
      }
      if (state.revision !== expectedRevision) refuse("revision_conflict");
      if (invocation?.used) refuse("context_already_used");
      if (state.revision >= REVISION_LIMIT) refuse("capacity");
      const peers = structuredClone(state.peers);
      let changed = false, publicKey: string | null = null;
      let managed = state.managed;
      if (mutation.type === "manage") {
        if (!invocation || managed) refuse("invalid_adoption");
        managed = {schema: "scout.pairing-trust-managed/v1", rootId: root.id, adapterId: invocation.adapter.id};
        changed = true;
      } else {
        publicKey = mutation.type === "grant" ? mutation.peer.publicKey : mutation.publicKey;
        const index = peers.findIndex(p => p.publicKey === publicKey);
        if (mutation.type === "grant") {
          if (index < 0) peers.push(mutation.peer); else peers[index] = mutation.peer;
          changed = true;
        } else if (index >= 0) { peers.splice(index, 1); changed = true; }
      }
      const outcome: TrustOutcome = {mutationId, revision: state.revision + 1, type: mutation.type, publicKey, changed};
      const peerBytes = encodePeers(peers);
      if (state.capsule) return this.publishCapsule(root, state, peers, managed, request, outcome, invocation, beforePublish);
      let stagedPeers: string | null = null, stagedGeneration: string | null = null, stagedMarker: string | null = null;
      let reserved = false;
      try {
        stagedPeers = this.stage(root, peerBytes);
        const generation: Generation = {schema: "scout.pairing-trust-owner/v1", rootId: root.id,
          revision: outcome.revision, previousHash: state.hash, peersHash: hash(peerBytes), peers, managed, adoption: state.adoption, projectionStage: basename(stagedPeers), mutation: {request, outcome}};
        const bytes = JSON.stringify({generation, sha256: hash(JSON.stringify(generation))});
        if (state.bytes + Buffer.byteLength(bytes) > TOTAL_LIMIT) refuse("capacity");
        stagedGeneration = this.stage(root, bytes);
        // Revalidate after staging, including external replacement detection.
        const before = this.state(root);
        if (before.revision !== expectedRevision || before.hash !== state.hash || before.projectionHash !== state.projectionHash) refuse("revision_conflict");
        if (invocation) { this.validateInvocation(invocation, root); invocation.used = true; }
        // Exclusive immutable generation name is the unmanaged CAS. No new lock.
        beforePublish?.();
        try { linkSync(stagedGeneration, join(root.path, `${PREFIX}${outcome.revision}.json`)); }
        catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") refuse("revision_conflict"); throw e; }
        reserved = true;
        if (mutation.type === "manage") {
          stagedMarker = this.stage(root, JSON.stringify(managed));
          linkSync(stagedMarker, join(root.path, MARKER)); unlinkSync(stagedMarker); stagedMarker = null;
        }
        // Original writer and helpers consume the same named projection stage.
        // If a helper already finished, do not rename or replay this mutation.
        const published = this.state(root, true);
        if (published.pendingStage && published.revision === outcome.revision && published.hash === hash(bytes)) this.completePublication(root, published);
        else this.syncDirectory(root);
        if (invocation) this.validateInvocation(invocation, root);
        const committed = this.state(root, true);
        if (committed.outcomes[mutationId]?.request !== request) refuse("outcome_unavailable");
        return structuredClone(outcome);
      } finally {
        for (const path of [reserved ? null : stagedPeers, reserved ? null : stagedGeneration, stagedMarker]) {
          if (path) { try { unlinkSync(path); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; } }
        }
      }
    });
  }
  revokePrefix(prefix: string, mutationId = randomUUID()): boolean {
    if (!/^[0-9a-f]{16}$/.test(prefix) && !/^[0-9a-f]{64}$/.test(prefix)) refuse("invalid_prefix");
    return this.operation(undefined, (_root, invocation) => {
      // Reuse this invocation rather than reacquire a native gate.
      const context = invocation ? this.contextFor(invocation) : undefined;
      const snapshot = this.read(context), matches = snapshot.peers.filter(p => p.publicKey.startsWith(prefix));
      if (matches.length > 1) refuse("ambiguous_prefix");
      if (!matches.length) return false;
      return this.mutate(snapshot.revision, mutationId, {type: "revoke", publicKey: matches[0]!.publicKey}, context).changed;
    });
  }
  private contextFor(invocation: Invocation): PairingTrustContext {
    const context = Object.freeze({toJSON(): never { return refuse("context_not_serializable"); }}) as unknown as PairingTrustContext;
    contexts.set(context, invocation); return context;
  }
  /** Typed trusted-bootstrap registration, root identity checked before install.
   * Unregistration does not delete the persistent managed marker. */
  register(adapter: PairingTrustAdapter): () => void {
    const root = this.root(true)!;
    if (!adapter || !/^[a-z0-9.-]{1,64}$/.test(adapter.id) || typeof adapter.withGate !== "function"
      || typeof adapter.currentHolder !== "function") refuse("invalid_adapter");
    if (adapters.has(root.id)) refuse("adapter_already_registered");
    adapters.set(root.id, adapter);
    return () => { if (adapters.get(root.id) === adapter) adapters.delete(root.id); };
  }
}
export function pairingTrustOwner(path = resolveOpenScoutPairingHome()): PairingTrustOwner {
  const root = canonical(path); let owner = owners.get(root);
  if (!owner) { owner = new PairingTrustOwner(root); owners.set(root, owner); }
  return owner;
}
