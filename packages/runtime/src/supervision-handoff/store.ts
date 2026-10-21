import type { LegacyRoleCapture } from "./role-absence.js";
import { EFFECT_EXCLUSION_CAPABILITY, validateProfile, type FenceIdentity } from "./exclusion-contracts.js";
import type { Pointer } from "bun:ffi";
import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, ftruncateSync, lstatSync, openSync, readFileSync, readSync, realpathSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { constants as osConstants } from "node:os";
import { HANDOFF_CAPABILITY, HANDOFF_PROTOCOL, HANDOFF_ROLES, requireRole, refuse,
  type AuthorizationIntent, type FloorPolicy, type HandoffRole, type Ownership, type MutationReceipt,
  type OperatorApproval, type PendingReceipt, type StageApproval, type SelectedInstance } from "./contracts.js";

export type CustodyState = { version: 1 | 2 | 3 | 4; instance: SelectedInstance; policy: FloorPolicy;
  roles: Record<HandoffRole, Ownership>;
  authorizations: Record<string, { intent: AuthorizationIntent; state: "issued" | "reserved" | "used" | "revoked"; policy: string }>;
  receipts: Record<string, MutationReceipt>; legacyCaptures?: Record<string, { manifest: LegacyRoleCapture; authorization: string }>;
  lifetimeFences?: Partial<Record<HandoffRole, FenceIdentity>> };
const MAX_BYTES = 16 * 1024 * 1024;
const CHECKPOINT_AT = 1024 * 1024;
/** Internal filesystem boundary for crash injection, not an SDK option. */
export const checkpointIO = {
  write: (fd: number, data: Uint8Array, offset: number, length: number, position: number) => writeSync(fd, data, offset, length, position),
  sync: fsyncSync, truncate: ftruncateSync, rename: renameSync, unlink: unlinkSync,
};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest("hex");
export const policyHash = (policy: FloorPolicy) => digest(policy);
export const authorizationHash = (token: string) => digest(token);
export const receiptKey = (role: HandoffRole, generation: number, id: string) => `${role}:${generation}:${id}`;
let native: ReturnType<typeof openNative> | undefined;
function openNative() {
  if (process.platform !== "darwin" && process.platform !== "linux") refuse("ownership_lock_unsupported");
  try {
    const { dlopen, read } = createRequire(import.meta.url)("bun:ffi") as typeof import("bun:ffi");
    const symbols = {
      flock: { args: ["i32", "i32"], returns: "i32" },
      [process.platform === "darwin" ? "__error" : "__errno_location"]: { args: [], returns: "ptr" },
    } as const;
    // Fixed system paths only: no soname, cwd, environment or configured library.
    const library = (() => {
      if (process.platform === "darwin") return dlopen("/usr/lib/libSystem.B.dylib", symbols);
      if (process.arch === "x64") {
        try { return dlopen("/lib/x86_64-linux-gnu/libc.so.6", symbols); }
        catch { return dlopen("/lib64/libc.so.6", symbols); }
      }
      if (process.arch === "arm64") {
        try { return dlopen("/lib/aarch64-linux-gnu/libc.so.6", symbols); }
        catch { return dlopen("/lib64/libc.so.6", symbols); }
      }
      refuse("ownership_lock_unsupported");
    })();
    // The computed symbol key widens Bun's inferred return to include flock's
    // integer; its FFI descriptor above is always the errno pointer signature.
    const errnoPointer = library.symbols[process.platform === "darwin" ? "__error" : "__errno_location"] as () => Pointer | null;
    return { library, flock: library.symbols.flock,
      errno: () => {
        const pointer = errnoPointer();
        if (pointer === null) refuse("ownership_lock_failed");
        return read.i32(pointer);
      } };
  } catch { refuse("ownership_lock_unsupported"); }
}
/** Internal diagnostics boundary, not a public API or lock override. */
export function ownershipLockFailure(errno: number) {
  if (errno === osConstants.errno.EWOULDBLOCK || errno === osConstants.errno.EAGAIN) return "ownership_busy";
  if (errno === osConstants.errno.ENOTSUP || errno === osConstants.errno.EOPNOTSUPP) return "ownership_lock_unsupported";
  return "ownership_lock_failed";
}
export function acquireOwnershipLock(fd: number) {
  native ??= openNative();
  if (native.flock(fd, 2 | 4) !== 0) refuse(ownershipLockFailure(native.errno())); // LOCK_EX | LOCK_NB; no TTL/PID stealing.
}
function unlock(fd: number) { native!.flock(fd, 8); }
export function fileIdentity(pathOrFd: string | number) {
  const stat = typeof pathOrFd === "number" ? fstatSync(pathOrFd, { bigint: true }) : lstatSync(pathOrFd, { bigint: true });
  return { dev: stat.dev.toString(), ino: stat.ino.toString() };
}
export function owned(path: string, directory: boolean, uid: number) {
  const info = lstatSync(path);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile()) || info.uid !== uid
    || (info.mode & 0o7777) !== (directory ? 0o700 : 0o600) || (!directory && info.nlink !== 1)) refuse("unsafe_ownership_path");
  return { ...info, ...fileIdentity(path) };
}
function selection(value: SelectedInstance) {
  const uid = process.geteuid?.();
  if (uid === undefined || value.uid !== uid || uid === 0 || !value.id.trim()
    || !isAbsolute(value.supportDirectory) || realpathSync(value.supportDirectory) !== value.supportDirectory) refuse("wrong_instance");
  const root = lstatSync(value.supportDirectory);
  if (!root.isDirectory() || root.uid !== value.uid || (root.mode & 0o022) !== 0) refuse("unsafe_support_directory");
}
function policyValid(policy: FloorPolicy) {
  if (!policy.id?.trim() || !Bun.semver.satisfies(policy.minimumRuntimeVersion, "*")
    || !policy.runtimeArtifacts.length || !policy.launcherArtifacts.length
    || ![...policy.runtimeArtifacts, ...policy.launcherArtifacts, ...policy.rollbackArtifacts].every(v => typeof v === "string" && !!v.trim())
    || typeof policy.rollbackOpen !== "boolean") refuse("invalid_floor_policy");
  if (policy.effectProfiles !== undefined) {
    if (!policy.effectProfiles || typeof policy.effectProfiles !== "object" || Array.isArray(policy.effectProfiles)
      || Object.keys(policy.effectProfiles).some(role => !HANDOFF_ROLES.includes(role as HandoffRole))) refuse("invalid_exclusion_profile");
    for (const profile of Object.values(policy.effectProfiles)) validateProfile(profile!);
  }
}
/** Same stable inode for OS lock and authority journal. Never
 * rename/unlink/recreate it; no canonical broker DB or process lifecycle IO. */
export class HandoffStore {
  readonly directory: string;
  readonly path: string;
  private readonly instance: SelectedInstance;
  constructor(instance: SelectedInstance) {
    selection(instance); this.instance = Object.freeze({ uid: instance.uid, id: instance.id, supportDirectory: instance.supportDirectory });
    this.directory = join(instance.supportDirectory, "supervision-handoff-v1"); this.path = join(this.directory, "custody.log");
  }
  /** Updater pre-creates the exact 0700 directory. Reads create nothing. */
  async stage(policy: FloorPolicy, approve: StageApproval): Promise<void> {
    policy = structuredClone(policy); policyValid(policy);
    if (!await approve(this.instance, structuredClone(policy))) refuse("operator_authorization_required");
    selection(this.instance); owned(this.directory, true, this.instance.uid);
    const fd = openSync(this.path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
    try {
      acquireOwnershipLock(fd);
      const identity = fileIdentity(fd);
      const anchor = openSync(join(this.directory, "identity.json"), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try { const bytes = Buffer.from(JSON.stringify({ dev: identity.dev, ino: identity.ino }));
        if (writeSync(anchor, bytes) !== bytes.length) refuse("ownership_store_write_failed");
        fsyncSync(anchor);
      } finally { closeSync(anchor); }
      // Version 4 fences older writers BEFORE any redo is published or receipts
      // are pruned. Absence-only stores remain version 1; no in-place upgrade.
      const state: CustodyState = { version: Object.keys(policy.effectProfiles ?? {}).length ? 4 : 1, instance: this.instance, policy: structuredClone(policy),
        roles: Object.fromEntries(HANDOFF_ROLES.map(role => [role, { owner: null, generation: 0, phase: "staged", desired: "stopped" }])) as CustodyState["roles"],
        authorizations: {}, receipts: {} };
      // Preparation only, under the ledger mutex. No role is enrolled and no
      // lifetime lock is held. Re-preparation never replaces an existing inode.
      for (const role of HANDOFF_ROLES) if (policy.effectProfiles?.[role]) {
        const fence = openSync(join(this.directory, `lifetime-${role}.lock`), constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
        try { fsyncSync(fence); (state.lifetimeFences ??= {})[role] = fileIdentity(fence); }
        finally { closeSync(fence); }
      }
      new CustodyTransaction(this, fd, state, 0, "").persist();
      const dir = openSync(this.directory, "r"); try { fsyncSync(dir); } finally { closeSync(dir); }
    } finally { closeSync(fd); }
  }
  async exclusive<T>(run: (tx: CustodyTransaction) => Promise<T>): Promise<T> {
    selection(this.instance); const root = owned(this.directory, true, this.instance.uid);
    const info = owned(this.path, false, this.instance.uid);
    const fd = openSync(this.path, constants.O_RDWR | constants.O_NOFOLLOW);
    let tx: CustodyTransaction | undefined; let acquired = false;
    try {
      const opened = fileIdentity(fd);
      if (opened.ino !== info.ino || opened.dev !== info.dev) refuse("ownership_path_changed");
      this.assertIdentity(opened);
      acquireOwnershipLock(fd); acquired = true; fsyncSync(fd);
      recoverCheckpoint(this, fd, this.instance);
      const parsed = readJournal(fd);
      if (digest(parsed.state.instance) !== digest(this.instance)) refuse("wrong_instance");
      tx = new CustodyTransaction(this, fd, parsed.state, parsed.sequence, parsed.hash);
      tx.rootIdentity = { dev: root.dev, ino: root.ino };
      return await run(tx);
    } finally { if (tx) tx.active = false; if (acquired) unlock(fd); closeSync(fd); }
  }
  assertIdentity(info: { dev: string; ino: string }) {
    const path = join(this.directory, "identity.json");
    owned(path, false, this.instance.uid);
    const identity = JSON.parse(readFileSync(path, "utf8"));
    if (identity.dev !== info.dev || identity.ino !== info.ino) refuse("ownership_path_changed");
  }
  async read(role: HandoffRole) { requireRole(role); return this.exclusive(async tx => structuredClone(tx.state.roles[role])); }
  async pendingReceipts(role: HandoffRole, generation: number): Promise<PendingReceipt[]> {
    requireRole(role);
    if (!Number.isSafeInteger(generation) || generation < 0) refuse("invalid_generation");
    return this.exclusive(async tx => {
      if (tx.state.roles[role].generation !== generation) refuse("ownership_changed");
      const prefix = `${role}:${generation}:`;
      return Object.entries(tx.state.receipts)
        .filter(([key, receipt]) => key.startsWith(prefix) && receipt.state === "pending")
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, receipt]) => ({ requestId: key.slice(prefix.length), operation: receipt.operation, state: "pending",
          effects: receipt.effects.map(({ id, kind, state }) => ({ id, kind, state })) }));
    });
  }
  async handshake(hello: { protocol: number; instance: SelectedInstance }) {
    if (Object.keys(hello).some(key => !["protocol", "instance"].includes(key))) refuse("invalid_handshake");
    if (hello.protocol !== HANDOFF_PROTOCOL) refuse("protocol_incompatible");
    if (digest(hello.instance) !== digest(this.instance)) refuse("wrong_instance");
    return this.exclusive(async tx => ({ capability: HANDOFF_CAPABILITY, protocol: HANDOFF_PROTOCOL, ready: false as const,
      reason: "r0_effect_integration_unavailable",
      instance: structuredClone(this.instance), floor: structuredClone(tx.state.policy), roles: structuredClone(tx.state.roles) }));
  }
  async authorize(intent: AuthorizationIntent, approve: OperatorApproval, capabilities: readonly string[] = []): Promise<string> {
    intent = structuredClone(intent); requireRole(intent.role);
    const snapshot = await this.exclusive(async tx => {
      if (tx.state.policy.effectProfiles?.[intent.role] && tx.state.version !== 4) refuse("cohort_store_version_required");
      return structuredClone(tx.state.policy);
    });
    if (snapshot.effectProfiles?.[intent.role] && !capabilities.includes(EFFECT_EXCLUSION_CAPABILITY)) refuse("proof_capability_required");
    if (!await approve(this.instance, snapshot, structuredClone(intent))) refuse("operator_authorization_required");
    return this.exclusive(async tx => {
      if (digest(snapshot) !== digest(tx.state.policy)) refuse("policy_changed");
      const role = tx.state.roles[intent.role];
      if (role.generation !== intent.generation || role.owner !== intent.source) refuse("ownership_changed");
      if (!["R0", "P1"].includes(intent.target) || !["enroll", "handoff", "recover", "resume"].includes(intent.action)) refuse("invalid_authorization");
      if (intent.action === "enroll" && !["running", "stopped"].includes(intent.desired ?? "")) refuse("invalid_authorization");
      if (intent.action === "recover" && (!intent.requestId || !/^[A-Za-z0-9_-]{1,64}$/.test(intent.requestId)
        || tx.state.receipts[receiptKey(intent.role, intent.generation, intent.requestId)]?.state !== "pending")) refuse("invalid_authorization");
      if (Object.keys(tx.state.authorizations).length >= 256) refuse("authorization_capacity");
      const token = randomBytes(32).toString("hex");
      tx.state.authorizations[authorizationHash(token)] = { intent: structuredClone(intent), state: "issued", policy: policyHash(tx.state.policy) }; tx.persist(); return token;
    });
  }
  async closeRollback(approve: StageApproval) {
    const snapshot = await this.exclusive(async tx => structuredClone(tx.state.policy));
    if (!await approve(this.instance, structuredClone(snapshot))) refuse("operator_authorization_required");
    return this.exclusive(async tx => {
      if (digest(snapshot) !== digest(tx.state.policy)) refuse("policy_changed");
      tx.state.policy.rollbackOpen = false; tx.persist();
    });
  }
  async revoke(token: string) {
    return this.exclusive(async tx => { const grant = tx.state.authorizations[authorizationHash(token)];
      if (!grant || grant.state === "used") refuse("invalid_authorization"); grant.state = "revoked"; tx.persist(); });
  }
}
function readAll(fd: number) {
  const size = fstatSync(fd).size;
  if (size > MAX_BYTES) refuse("ownership_store_capacity");
  const bytes = Buffer.alloc(size); let offset = 0;
  while (offset < size) {
    const count = readSync(fd, bytes, offset, size - offset, offset);
    if (!count) refuse("ownership_store_corrupt"); offset += count;
  }
  return bytes;
}
function readJournal(fd: number): { state: CustodyState; sequence: number; hash: string } {
  if (fstatSync(fd).size > MAX_BYTES) refuse("ownership_store_capacity");
  return parseJournal(readAll(fd).toString("utf8"));
}
function parseJournal(text: string): { state: CustodyState; sequence: number; hash: string } {
  if (Buffer.byteLength(text) > MAX_BYTES) refuse("ownership_store_capacity");
  if (!text || !text.endsWith("\n")) refuse("ownership_store_corrupt");
  let previous = ""; let sequence = 0; let state!: CustodyState; let version: number | undefined;
  try {
    for (const line of text.trimEnd().split("\n")) {
      const record = JSON.parse(line);
      if (sequence === 0 && record.checkpoint !== undefined) {
        const base = record.checkpoint;
        if (record.state.version !== 4 || !Number.isSafeInteger(base.sequence) || base.sequence < 1
          || !/^[a-f0-9]{64}$/.test(base.hash) || base.sequence >= Number.MAX_SAFE_INTEGER) refuse("ownership_store_corrupt");
        sequence = base.sequence; previous = base.hash;
      } else if (record.checkpoint !== undefined) refuse("ownership_store_corrupt");
      if (record.sequence !== sequence + 1 || record.previous !== previous
        || record.hash !== digest([record.sequence, record.previous, record.state]) || ![1, 2, 3, 4].includes(record.state.version)
        || (version !== undefined && record.state.version !== version)
        || (Object.keys(record.state.policy?.effectProfiles ?? {}).length ? ![2, 3, 4].includes(record.state.version) : record.state.version !== 1)) refuse("ownership_store_corrupt");
      version = record.state.version; // No in-place upgrade or downgrade of this journal.
      previous = record.hash; sequence++; state = record.state; policyValid(state.policy);
      for (const role of HANDOFF_ROLES) {
        const value = state.roles[role];
        if (!value || !Number.isSafeInteger(value.generation) || value.generation < 0 || ![null, "R0", "P1"].includes(value.owner)
          || !["staged", "active", "draining"].includes(value.phase) || !["running", "stopped"].includes(value.desired)) refuse("ownership_store_corrupt");
      }
    }
  } catch { refuse("ownership_store_corrupt"); }
  return { state, sequence, hash: previous };
}
type CheckpointImage = { version: 1; identity: { dev: string; ino: string }; before: string; after: string; hash: string };
function syncDirectory(store: HandoffStore) {
  const fd = openSync(store.directory, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { checkpointIO.sync(fd); } finally { closeSync(fd); }
}
function writeAll(fd: number, bytes: Buffer) {
  let offset = 0;
  while (offset < bytes.length) {
    const count = checkpointIO.write(fd, bytes, offset, bytes.length - offset, offset);
    if (!count) refuse("ownership_store_write_failed"); offset += count;
  }
}
function pathPresent(path: string) {
  try { lstatSync(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
function removePreparation(store: HandoffStore) {
  const path = join(store.directory, "checkpoint.prepare");
  if (pathPresent(path)) { owned(path, false, process.geteuid!()); checkpointIO.unlink(path); syncDirectory(store); }
}
/** Publish a durable redo image before touching the anchored inode. The image
 * includes the old chain so recovery can validate its base even after a
 * torn, non-prefix overwrite. It is removed before any subsequent append. */
function checkpoint(store: HandoffStore, fd: number, after: Buffer) {
  const pending = join(store.directory, "checkpoint.pending"), prepare = join(store.directory, "checkpoint.prepare");
  if (pathPresent(pending)) refuse("ownership_checkpoint_pending");
  removePreparation(store);
  const before = readAll(fd), identity = fileIdentity(fd);
  const image: CheckpointImage = { version: 1, identity, before: before.toString("base64"), after: after.toString("base64"), hash: "" };
  image.hash = digest([image.version, identity, image.before, image.after]);
  const out = openSync(prepare, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { writeAll(out, Buffer.from(JSON.stringify(image))); checkpointIO.sync(out); } finally { closeSync(out); }
  checkpointIO.rename(prepare, pending); syncDirectory(store); // Redo is durable before the first destructive write.
  installCheckpoint(store, fd, after);
}
function installCheckpoint(store: HandoffStore, fd: number, after: Buffer) {
  writeAll(fd, after); checkpointIO.sync(fd);
  checkpointIO.truncate(fd, after.length); checkpointIO.sync(fd);
  checkpointIO.unlink(join(store.directory, "checkpoint.pending")); syncDirectory(store);
}
/** No PID/TTL recovery and no lock-inode replacement. This runs ONLY while
 * holding that inode's exclusive flock, before any state is returned. */
function recoverCheckpoint(store: HandoffStore, fd: number, instance: SelectedInstance) {
  const path = join(store.directory, "checkpoint.pending");
  if (!pathPresent(path)) return;
  const info = owned(path, false, process.geteuid!());
  if (info.size > 48 * 1024 * 1024) refuse("ownership_checkpoint_corrupt");
  let after: Buffer; let recordedInstance: SelectedInstance | undefined;
  try {
    const image: CheckpointImage = JSON.parse(readFileSync(path, "utf8")), identity = fileIdentity(fd);
    if (image.version !== 1 || image.identity.dev !== identity.dev || image.identity.ino !== identity.ino
      || image.hash !== digest([image.version, identity, image.before, image.after])) refuse("ownership_checkpoint_corrupt");
    const before = Buffer.from(image.before, "base64"); after = Buffer.from(image.after, "base64");
    if (before.toString("base64") !== image.before || after.toString("base64") !== image.after) refuse("ownership_checkpoint_corrupt");
    const base = parseJournal(before.toString("utf8")), next = parseJournal(after.toString("utf8"));
    recordedInstance = base.state.instance;
    const root = JSON.parse(after.toString("utf8").trimEnd()); // Exactly one checkpoint root, no tail in a redo image.
    if (base.state.version !== 4 || next.state.version !== 4 || next.sequence !== base.sequence + 1
      || root.checkpoint?.sequence !== base.sequence || root.checkpoint?.hash !== base.hash || root.previous !== base.hash
      || digest(base.state.instance) !== digest(next.state.instance)) refuse("ownership_checkpoint_corrupt");
    // Redo is authoritative once published. Unsynced file pages can reach disk
    // in any order, not necessarily as a prefix. A valid newer journal cannot
    // coexist with pending redo in this protocol: unlink + directory fsync
    // precedes all subsequent appends. Reject a stale redo over such a chain.
    if (fstatSync(fd).size > MAX_BYTES) refuse("ownership_checkpoint_corrupt");
    const currentBytes = readAll(fd);
    let current: ReturnType<typeof parseJournal> | undefined;
    try { current = parseJournal(currentBytes.toString("utf8")); } catch { /* Torn inode bytes are repaired from durable redo. */ }
    if (current && !((current.sequence === base.sequence && current.hash === base.hash)
      || (current.sequence === next.sequence && current.hash === next.hash))) refuse("ownership_checkpoint_corrupt");
  } catch { refuse("ownership_checkpoint_corrupt"); }
  if (digest(recordedInstance) !== digest(instance)) refuse("wrong_instance");
  // Re-establish redo durability even when the previous controller failed
  // immediately after rename, before its directory fsync succeeded.
  const redo = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { checkpointIO.sync(redo); } finally { closeSync(redo); }
  syncDirectory(store);
  installCheckpoint(store, fd, after!);
}
export class CustodyTransaction {
  active = true;
  rootIdentity?: { dev: string; ino: string };
  private identity: { dev: string; ino: string };
  private size: number;
  private readonly version: CustodyState["version"];
  constructor(private store: HandoffStore, private fd: number, readonly state: CustodyState, private sequence: number, private hash: string) {
    this.identity = fileIdentity(fd); this.size = fstatSync(fd).size; this.version = state.version;
  }
  assertCurrent() {
    try {
      if (!this.active) refuse("ownership_scope_closed");
      const info = owned(this.store.path, false, this.state.instance.uid), root = owned(this.store.directory, true, this.state.instance.uid);
      this.store.assertIdentity(info);
      if (info.dev !== this.identity.dev || info.ino !== this.identity.ino || info.size !== this.size
        || (this.rootIdentity && (root.dev !== this.rootIdentity.dev || root.ino !== this.rootIdentity.ino))) refuse("ownership_path_changed");
    } catch (error) { this.active = false; throw error; }
  }
  persist() {
    try {
      this.assertCurrent();
      // Enforce at the write boundary, including administrative APIs and direct
      // internal transactions. Reading an older profile store never upgrades it.
      if (this.version === 2 || this.version === 3) refuse("cohort_store_version_required");
      if (this.state.version !== this.version) refuse("ownership_store_version_changed");
      if (this.sequence >= Number.MAX_SAFE_INTEGER) refuse("ownership_sequence_exhausted");
      const sequence = this.sequence + 1, hash = digest([sequence, this.hash, this.state]);
      const record = { sequence, previous: this.hash, state: this.state, hash };
      const bytes = Buffer.from(JSON.stringify(record) + "\n");
      if (this.version === 4 && this.sequence > 0 && this.size + bytes.length > CHECKPOINT_AT) {
        const image = Buffer.from(JSON.stringify({ ...record, checkpoint: { sequence: this.sequence, hash: this.hash } }) + "\n");
        if (image.length > MAX_BYTES) refuse("ownership_store_capacity");
        checkpoint(this.store, this.fd, image);
        this.size = image.length; this.sequence = sequence; this.hash = hash; return;
      }
      if (this.size + bytes.length > MAX_BYTES) refuse("ownership_store_capacity");
      let written = 0;
      while (written < bytes.length) {
        const count = writeSync(this.fd, bytes, written, bytes.length - written, this.size + written);
        if (!count) refuse("ownership_store_write_failed"); written += count;
      }
      fsyncSync(this.fd); this.size += bytes.length; this.sequence = sequence; this.hash = hash;
    } catch (error) { this.active = false; throw error; }
  }
}
