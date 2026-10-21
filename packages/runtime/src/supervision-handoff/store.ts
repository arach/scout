import type { LegacyRoleCapture } from "./role-absence.js";
import type { Pointer } from "bun:ffi";
import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { constants as osConstants } from "node:os";
import { HANDOFF_CAPABILITY, HANDOFF_PROTOCOL, HANDOFF_ROLES, requireRole, refuse,
  type AuthorizationIntent, type FloorPolicy, type HandoffRole, type Ownership, type MutationReceipt,
  type OperatorApproval, type PendingReceipt, type StageApproval, type SelectedInstance } from "./contracts.js";

export type CustodyState = { version: 1; instance: SelectedInstance; policy: FloorPolicy;
  roles: Record<HandoffRole, Ownership>;
  authorizations: Record<string, { intent: AuthorizationIntent; state: "issued" | "reserved" | "used" | "revoked"; policy: string }>;
  receipts: Record<string, MutationReceipt>; legacyCaptures?: Record<string, { manifest: LegacyRoleCapture; authorization: string }> };
const MAX_BYTES = 16 * 1024 * 1024;
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
    const library = dlopen(process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6", {
      flock: { args: ["i32", "i32"], returns: "i32" },
      [process.platform === "darwin" ? "__error" : "__errno_location"]: { args: [], returns: "ptr" },
    });
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
function fileIdentity(pathOrFd: string | number) {
  const stat = typeof pathOrFd === "number" ? fstatSync(pathOrFd, { bigint: true }) : lstatSync(pathOrFd, { bigint: true });
  return { dev: stat.dev.toString(), ino: stat.ino.toString() };
}
function owned(path: string, directory: boolean, uid: number) {
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
}
/** Same stable inode for OS lock and append-only authority journal. Never
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
      const state: CustodyState = { version: 1, instance: this.instance, policy: structuredClone(policy),
        roles: Object.fromEntries(HANDOFF_ROLES.map(role => [role, { owner: null, generation: 0, phase: "staged", desired: "stopped" }])) as CustodyState["roles"],
        authorizations: {}, receipts: {} };
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
  async authorize(intent: AuthorizationIntent, approve: OperatorApproval): Promise<string> {
    intent = structuredClone(intent); requireRole(intent.role);
    const snapshot = await this.exclusive(async tx => structuredClone(tx.state.policy));
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
function readJournal(fd: number): { state: CustodyState; sequence: number; hash: string } {
  if (fstatSync(fd).size > MAX_BYTES) refuse("ownership_store_capacity");
  const text = readFileSync(fd, "utf8");
  if (!text || !text.endsWith("\n")) refuse("ownership_store_corrupt");
  let previous = ""; let sequence = 0; let state!: CustodyState;
  try {
    for (const line of text.trimEnd().split("\n")) {
      const record = JSON.parse(line);
      if (record.sequence !== sequence + 1 || record.previous !== previous
        || record.hash !== digest([record.sequence, record.previous, record.state]) || record.state.version !== 1) refuse("ownership_store_corrupt");
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
export class CustodyTransaction {
  active = true;
  rootIdentity?: { dev: string; ino: string };
  private identity: { dev: string; ino: string };
  private size: number;
  constructor(private store: HandoffStore, private fd: number, readonly state: CustodyState, private sequence: number, private hash: string) {
    this.identity = fileIdentity(fd); this.size = fstatSync(fd).size;
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
      this.assertCurrent(); const sequence = this.sequence + 1, hash = digest([sequence, this.hash, this.state]);
      const bytes = Buffer.from(JSON.stringify({ sequence, previous: this.hash, state: this.state, hash }) + "\n");
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
