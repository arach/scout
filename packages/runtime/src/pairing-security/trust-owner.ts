/** Canonical pairing trust persistence. No I/O or adapter installation on import.
 * See docs/pairing-trust-owner.md for the on-disk and interruption contract. */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, constants, existsSync, fstatSync, fsyncSync, linkSync, lstatSync,
  mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync,
  unlinkSync, writeFileSync, type Stats,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { resolveOpenScoutPairingHome } from "../support-paths.js";

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
  | { type: "refresh"; publicKey: string; lastSeen: string }
  | { type: "revoke"; publicKey: string }
  | { type: "manage" };
export type TrustOutcome = Readonly<{
  mutationId: string; revision: number; type: TrustMutation["type"];
  publicKey: string | null; changed: boolean;
}>;
type SavedOutcome = { request: string; outcome: TrustOutcome };
type Marker = { schema: "scout.pairing-trust-managed/v1"; rootId: string; adapterId: string };
type Generation = {
  schema: "scout.pairing-trust-owner/v1"; rootId: string; revision: number;
  previousHash: string; peersHash: string; peers: TrustedPeer[];
  managed: Marker | null; mutation: SavedOutcome;
};
export type TrustSnapshot = Readonly<{ revision: number; peers: readonly TrustedPeer[] }>;
type State = { revision: number; peers: TrustedPeer[]; hash: string; peersHash: string;
  managed: Marker | null; outcomes: Record<string, SavedOutcome>; bytes: number };
type Invocation = { owner: PairingTrustOwner; root: PairingRootIdentity; adapter: PairingTrustAdapter;
  holder: object; active: boolean; used: boolean };
const invocations = new AsyncLocalStorage<Invocation>();
const contexts = new WeakMap<object, Invocation>();
const adapters = new Map<string, PairingTrustAdapter>();
const owners = new Map<string, PairingTrustOwner>();
const PEERS = "trusted-peers.json", MARKER = "trusted-peers.managed.json";
const PREFIX = "trusted-peers.owner.";
const FILE_LIMIT = 1024 * 1024, TOTAL_LIMIT = 128 * 1024 * 1024, REVISION_LIMIT = 65_536;
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const encodePeers = (peers: readonly TrustedPeer[]) => JSON.stringify(peers, null, 2);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function refuse(code: string): never { throw new PairingTrustError(code); }
export class PairingTrustError extends Error {
  constructor(readonly code: string) { super(`pairing_trust_${code}`); }
}
function owned(stat: Stats, directory = false, legacyProjection = false) {
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())
    || stat.uid !== process.getuid?.() || (stat.mode & 0o022) !== 0
    || (!directory && (stat.nlink !== 1 || (!legacyProjection && (stat.mode & 0o077) !== 0)))) refuse("unsafe_path");
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
  private readFile(root: PairingRootIdentity, name: string): Buffer | null {
    this.check(root); const path = join(root.path, name);
    let fd: number;
    try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
    try {
      const stat = fstatSync(fd); owned(stat, false, name === PEERS);
      if (stat.size > FILE_LIMIT || id(lstatSync(path)) !== id(stat)) refuse("unsafe_path");
      const data = readFileSync(fd);
      if (data.length > FILE_LIMIT || id(lstatSync(path)) !== id(stat)) refuse("unsafe_path");
      this.check(root); return data;
    } finally { closeSync(fd); }
  }
  private syncDirectory(root: PairingRootIdentity) {
    this.check(root);
    const fd = openSync(root.path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { if (id(fstatSync(fd)) !== root.id) refuse("root_replaced"); fsyncSync(fd); this.check(root); }
    finally { closeSync(fd); }
  }
  private stage(root: PairingRootIdentity, bytes: string): string {
    this.check(root);
    if (Buffer.byteLength(bytes) > FILE_LIMIT) refuse("capacity");
    const name = `.pairing-owner-${randomUUID()}.tmp`, path = join(root.path, name);
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { owned(fstatSync(fd)); writeFileSync(fd, bytes); fsyncSync(fd); this.check(root); }
    catch (e) { try { unlinkSync(path); } catch {} throw e; }
    finally { closeSync(fd); }
    return path;
  }
  private marker(root: PairingRootIdentity): Marker | null {
    const bytes = this.readFile(root, MARKER); if (!bytes) return null;
    const value = JSON.parse(bytes.toString());
    if (value.schema !== "scout.pairing-trust-managed/v1" || value.rootId !== root.id
      || typeof value.adapterId !== "string" || !/^[a-z0-9.-]{1,64}$/.test(value.adapterId)) refuse("managed_marker_invalid");
    return value;
  }
  private state(root: PairingRootIdentity): State {
    this.check(root);
    const marker = this.marker(root);
    const names = readdirSync(root.path).filter(n => n.startsWith(PREFIX));
    if (names.length > REVISION_LIMIT) refuse("capacity");
    const revisions = names.map(n => {
      const match = /^trusted-peers\.owner\.([1-9][0-9]*)\.json$/.exec(n);
      if (!match || !Number.isSafeInteger(Number(match[1]))) refuse("generation_invalid");
      return Number(match[1]);
    }).sort((a,b) => a-b);
    const projection = this.readFile(root, PEERS);
    let current: State = {revision: 0, peers: projection ? peersOf(JSON.parse(projection.toString())) : [],
      hash: hash(projection ?? Buffer.alloc(0)), peersHash: hash(projection ?? Buffer.alloc(0)), managed: null, outcomes: {}, bytes: 0};
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
        || !["grant","refresh","revoke","manage"].includes(outcome.type) || typeof outcome.changed !== "boolean"
        || (outcome.type === "manage" ? outcome.publicKey !== null : typeof outcome.publicKey !== "string" || !/^[0-9a-f]{64}$/.test(outcome.publicKey))
        || Object.hasOwn(current.outcomes, outcome.mutationId)) refuse("generation_invalid");
      const outcomes = current.outcomes;
      Object.defineProperty(outcomes, outcome.mutationId, {value: saved, enumerable: true});
      if (current.managed && JSON.stringify(value.managed) !== JSON.stringify(current.managed)) refuse("managed_downgrade");
      current = {...value, peers, outcomes, hash: hash(bytes), bytes: current.bytes};
    }
    if (JSON.stringify(current.managed) !== JSON.stringify(marker)) refuse("managed_marker_mismatch");
    if (current.revision && (!projection || hash(projection) !== current.peersHash)) refuse("external_change_or_incomplete");
    if (marker) {
      const adapter = adapters.get(root.id);
      if (!adapter || adapter.id !== marker.adapterId) refuse("managed_adapter_required");
      const active = invocations.getStore();
      if (!active || active.owner !== this) refuse("managed_context_required");
      this.validateInvocation(active, root);
    }
    if (JSON.stringify(readdirSync(root.path).filter(n => n.startsWith(PREFIX)).sort()) !== JSON.stringify(names.sort())) refuse("revision_conflict");
    this.check(root); return current;
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
    return this.operation(context, root => {
      if (!root) return {revision: 0, peers: []};
      const state = this.state(root); return {revision: state.revision, peers: structuredClone(state.peers)};
    });
  }
  mutate(expectedRevision: number, mutationId: string, raw: TrustMutation, context?: PairingTrustContext): TrustOutcome {
    // Snapshot untrusted caller-owned objects before adapter callbacks or I/O.
    const mutation = structuredClone(raw);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !/^[a-zA-Z0-9._:-]{1,128}$/.test(mutationId)) refuse("invalid_mutation");
    if (mutation.type === "grant") mutation.peer = peersOf([mutation.peer])[0]!;
    else if (mutation.type === "revoke" || mutation.type === "refresh") {
      fullKey(mutation.publicKey);
      if (mutation.type === "refresh" && (typeof mutation.lastSeen !== "string" || mutation.lastSeen.length > 128)) refuse("invalid_mutation");
    } else if (mutation.type !== "manage") refuse("invalid_mutation");
    this.root(true);
    return this.operation(context, (bound, invocation) => {
      const root = bound!, state = this.state(root);
      const request = JSON.stringify([expectedRevision, mutation.type,
        mutation.type === "grant" ? mutation.peer : mutation.type === "manage" ? null : mutation.publicKey,
        mutation.type === "refresh" ? mutation.lastSeen : null]);
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
        } else if (mutation.type === "revoke") {
          if (index >= 0) { peers.splice(index, 1); changed = true; }
        } else {
          // Never turn a delayed reconnect's stale peer into a grant.
          if (index < 0) refuse("peer_revoked");
          peers[index] = {...peers[index]!, lastSeen: mutation.lastSeen}; changed = true;
        }
      }
      const outcome: TrustOutcome = {mutationId, revision: state.revision + 1, type: mutation.type, publicKey, changed};
      const peerBytes = encodePeers(peers);
      const generation: Generation = {schema: "scout.pairing-trust-owner/v1", rootId: root.id,
        revision: outcome.revision, previousHash: state.hash, peersHash: hash(peerBytes), peers, managed, mutation: {request, outcome}};
      const bytes = JSON.stringify({generation, sha256: hash(JSON.stringify(generation))});
      if (state.bytes + Buffer.byteLength(bytes) > TOTAL_LIMIT) refuse("capacity");
      let stagedPeers: string | null = null, stagedGeneration: string | null = null, stagedMarker: string | null = null;
      try {
        stagedPeers = this.stage(root, peerBytes); stagedGeneration = this.stage(root, bytes);
        // Revalidate after staging, including external replacement detection.
        const before = this.state(root);
        if (before.revision !== expectedRevision || before.hash !== state.hash) refuse("revision_conflict");
        if (invocation) { this.validateInvocation(invocation, root); invocation.used = true; }
        // Exclusive immutable generation name is the unmanaged CAS. No new lock.
        try { linkSync(stagedGeneration, join(root.path, `${PREFIX}${outcome.revision}.json`)); }
        catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") refuse("revision_conflict"); throw e; }
        unlinkSync(stagedGeneration);
        if (mutation.type === "manage") {
          stagedMarker = this.stage(root, JSON.stringify(managed));
          linkSync(stagedMarker, join(root.path, MARKER)); unlinkSync(stagedMarker); stagedMarker = null;
        }
        // A reserved generation with a mismatching projection is UNAVAILABLE,
        // never read as an older permissive state. No successor may pass state().
        this.check(root); renameSync(stagedPeers, join(root.path, PEERS)); this.syncDirectory(root);
        if (invocation) this.validateInvocation(invocation, root);
        const committed = this.state(root);
        if (committed.outcomes[mutationId]?.request !== request) refuse("outcome_unavailable");
        return structuredClone(outcome);
      } finally {
        for (const path of [stagedPeers, stagedGeneration, stagedMarker]) {
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
