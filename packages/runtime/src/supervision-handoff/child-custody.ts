import { probeSigchldDisposition } from "./sigchld-disposition.js";
import { isAbsolute } from "node:path";
import { createProcessEvidenceReader, type ProcessSample } from "./process-evidence.js";
import { refuse, type ExactChild, type HandoffRole, type SelectedInstance } from "./contracts.js";
import { RetainedChild, type ChildExit } from "./retained-child.js";
import type { CustodyTransaction } from "./store.js";
import { createParentChannel, mappingCopy } from "./carrier-layout.js";

export type DirectChildCommand = { argv: string[]; cwd: string; env: Record<string, string>;
  stdio?: readonly ["ignore" | "inherit", "ignore" | "inherit", "ignore" | "inherit"];
  carrier?: "role-lifetime/7" };
export type DirectChildRecord = { format: "bun-darwin-direct-child/1"; child: ExactChild; sample: ProcessSample; exit?: ChildExit };
export type CurrentChildCoverage = { state: "no_starts" | "unknown";
  reason?: "current_owner_birth_unproven" | "current_owner_exit_unproven" | "current_owner_descendants_unproven";
  starts: number; exited: number };
const audited = new Set(["bf2e2cecf27e800962b1e7f03d66278f9d5d2e79", "0d9b296af33f2b851fcbf4df3e9ec89751734ba4"]);
export function directChildCapability() {
  if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch)
    || typeof Bun === "undefined" || !audited.has(Bun.revision)) return { available: false as const, reason: "child_custody_backend_unproven" as const };
  const disposition = probeSigchldDisposition();
  return disposition.safe ? { available: true as const, backend: "darwin-event-loop-wait4/1" as const }
    : { available: false as const, reason: disposition.reason };
}
function requireDirectChildCapability() {
  const capability = directChildCapability();
  if (!capability.available) refuse(capability.reason);
}
/** Extra numeric stdio FDs are borrowed only on this audited revision. Bun
 * 1.3.13 closes them in Subprocess.finalizeStreams, even when caller-owned.
 * Duplicating and manually closing one would permit a later GC double-close;
 * leaving it to GC would make retirement depend on nondeterministic GC. */
export function carrierChildCapability() {
  const direct = directChildCapability();
  if (!direct.available) return direct;
  return Bun.revision === "0d9b296af33f2b851fcbf4df3e9ec89751734ba4"
    ? { available: true as const, backend: "darwin-borrowed-extra-fd/1" as const }
    : { available: false as const, reason: "carrier_mapping_backend_unproven" as const };
}
function sameChild(a: ExactChild, b: ExactChild) {
  return (["uid", "instance", "role", "generation", "pid", "birth", "executable", "effectId"] as const).every(key => a[key] === b[key]);
}
/** Process-local, non-adoptable handles. Construction does no IO. The caller
 * must be the sole reaper of these direct children (no foreign native wait). */
export class DirectChildren {
  private readonly held = new Map<string, { retained: RetainedChild; record?: DirectChildRecord;
    role: HandoffRole; generation: number; channel?: ReturnType<typeof createParentChannel> }>();
  constructor(private readonly instance: SelectedInstance, private readonly enabled = false) {}
  spawn(role: HandoffRole, generation: number, effectId: string, command: DirectChildCommand, carrierDescriptor?: number): DirectChildRecord {
    if (!this.enabled) refuse("child_custody_not_enabled");
    if (this.held.has(effectId)) refuse("child_effect_already_started");
    if (!command || !Array.isArray(command.argv) || !command.argv.length || typeof command.argv[0] !== "string" || !isAbsolute(command.argv[0])
      || Array.from(command.argv).some(arg => typeof arg !== "string" || arg.includes("\0"))
      || typeof command.cwd !== "string" || !isAbsolute(command.cwd) || command.cwd.includes("\0")
      || !command.env || typeof command.env !== "object" || Array.isArray(command.env)
      || Object.entries(command.env).some(([key, value]) => !key || /[=\0]/.test(key) || typeof value !== "string" || value.includes("\0"))
      || (command.stdio !== undefined && (!Array.isArray(command.stdio) || command.stdio.length !== 3 || [0, 1, 2].some(index => command.stdio![index] !== "ignore" && command.stdio![index] !== "inherit")))
      || (command.carrier !== undefined && (command.carrier !== "role-lifetime/7" || Object.keys(command).some(key => !["argv", "cwd", "env", "stdio", "carrier"].includes(key))))) refuse("invalid_child_command");
    if (command.carrier ? !Number.isSafeInteger(carrierDescriptor) || carrierDescriptor! < 3 : carrierDescriptor !== undefined) refuse("carrier_mapping_required");
    // Refusal of malformed input (and a retained duplicate) is host-independent.
    // No process evidence, descriptor mapping or spawn happens before this gate.
    requireDirectChildCapability();
    if (command.carrier) { const capability = carrierChildCapability(); if (!capability.available) refuse(capability.reason); }
    const reader = createProcessEvidenceReader(this.instance); // validate selection before spawn
    let reaped = false, waitError = false;
    const stdio = command.stdio ?? ["ignore", "ignore", "ignore"] as const;
    const channel = command.carrier ? createParentChannel() : undefined;
    let handle!: ReturnType<typeof Bun.spawn>;
    let held: { retained: RetainedChild; record?: DirectChildRecord; role: HandoffRole; generation: number; channel?: ReturnType<typeof createParentChannel> } | undefined;
    let parentMapping: ReturnType<typeof mappingCopy> | undefined, fenceMapping: ReturnType<typeof mappingCopy> | undefined;
    try {
      if (channel) { parentMapping = mappingCopy(channel.reader); fenceMapping = mappingCopy(carrierDescriptor!); }
      handle = Bun.spawn(command.argv, { onExit: (_child, _code, _signal, error) => { reaped = true; waitError = error != null; }, cwd: command.cwd, env: { ...command.env },
        stdio: channel ? [stdio[0], stdio[1], stdio[2], parentMapping!.descriptor, "ignore", "ignore", "ignore", fenceMapping!.descriptor] : [stdio[0], stdio[1], stdio[2]] });
      held = { retained: new RetainedChild(handle, () => waitError), record: undefined, role, generation, channel };
      this.held.set(effectId, held); // Retain even if mapping cleanup, birth sampling or persistence fails.
    } catch (error) {
      if (!held) { try { channel?.closeRead(); } finally { channel?.closeWrite(); } }
      throw error;
    } finally { try { parentMapping?.close(); } finally { fenceMapping?.close(); } }
    channel?.closeRead(); // Child FD 3 owns its mapping; host retains only the writer.
    // Synchronous, before the event-loop reaper can run. No sample-then-kill:
    // later signals use only this exact retained handle, never sample.pid.
    if (reaped || handle.exitCode !== null || handle.signalCode !== null) refuse("child_birth_unproven");
    const result = reader.sample(handle.pid);
    if (reaped || result.state !== "sampled") refuse("child_birth_unproven");
    const sample = result.sample;
    const child: ExactChild = { uid: sample.uid, instance: this.instance.id, role, generation, pid: sample.pid,
      birth: `${sample.bootSession.toLowerCase()}:${sample.startSeconds}:${sample.startMicroseconds}`,
      executable: sample.executable, effectId };
    held.record = { format: "bun-darwin-direct-child/1", child, sample };
    return structuredClone(held.record);
  }
  signal(child: ExactChild, signal: "SIGTERM" | "SIGKILL") {
    const held = this.held.get(child.effectId);
    if (!held?.record || !sameChild(held.record.child, child)) refuse("child_custody_lost");
    requireDirectChildCapability();
    return held.retained.signal(signal);
  }
  async exit(record: DirectChildRecord) {
    const held = this.held.get(record.child.effectId);
    if (!held?.record || !sameChild(held.record.child, record.child)) refuse("child_custody_lost");
    return held.retained.exit();
  }
  has(child: ExactChild) {
    const held = this.held.get(child.effectId);
    return !!held?.record && sameChild(held.record.child, child);
  }
  pollExit(record: DirectChildRecord) {
    const held = this.held.get(record.child.effectId);
    if (!held?.record || !sameChild(held.record.child, record.child)) return undefined;
    return held.retained.pollExit();
  }
  closeParentChannels(role: HandoffRole, generation: number) {
    for (const held of this.held.values()) if (held.role === role && held.generation === generation) held.channel?.closeWrite();
  }
  /** Internal: call only after a certified advance is durably committed (or
   * its persisted replay is verified). Forget handles, never kill/reap/adopt.
   * Closed writers are idempotent; no descriptor or fence is unlocked. */
  forgetThrough(role: HandoffRole, generation: number) {
    for (const [id, held] of this.held) if (held.role === role && held.generation <= generation) {
      held.channel?.closeWrite(); this.held.delete(id);
    }
  }
  closeAllParentChannels() {
    for (const held of this.held.values()) held.channel?.closeWrite();
  }
}
/** Direct exit is necessary, never sufficient for role absence. There is no
 * native descendant coverage on this adapter. Do not accept a caller's boolean
 * or a process-group kill as that missing proof. */
export function currentChildCoverage(tx: CustodyTransaction, role: HandoffRole): CurrentChildCoverage {
  tx.assertCurrent();
  const generation = tx.state.roles[role].generation;
  const starts = Object.entries(tx.state.receipts).filter(([key]) => key.startsWith(`${role}:${generation}:`))
    .flatMap(([, receipt]) => receipt.effects.filter(effect => effect.kind === "start"));
  const bound = (effect: typeof starts[number]) => {
    const record = effect.directChild, child = record?.child, sample = record?.sample;
    return record?.format === "bun-darwin-direct-child/1" && child?.effectId === effect.id && child.role === role
      && child.generation === generation && child.instance === tx.state.instance.id && child.uid === tx.state.instance.uid
      && sample?.format === "darwin-bsd-process/1" && sample.instance.id === child.instance && sample.instance.uid === child.uid
      && sample.instance.supportDirectory === tx.state.instance.supportDirectory && sample.pid === child.pid && sample.uid === child.uid
      && child.birth === `${sample.bootSession.toLowerCase()}:${sample.startSeconds}:${sample.startMicroseconds}` && child.executable === sample.executable;
  };
  const exited = starts.filter(effect => {
    if (!bound(effect)) return false;
    const exit = effect.directChild?.exit;
    return exit && (Number.isInteger(exit.code) && exit.code! >= 0 && exit.code! <= 255 && exit.signal === null
      || exit.code === null && (typeof exit.signal === "string" && /^SIG[A-Z0-9]+$/.test(exit.signal)
        || typeof exit.signal === "number" && Number.isInteger(exit.signal) && exit.signal > 0));
  }).length;
  if (!starts.length) return { state: "no_starts", starts: 0, exited: 0 };
  const reason = starts.some(effect => !bound(effect)) ? "current_owner_birth_unproven"
    : exited !== starts.length ? "current_owner_exit_unproven" : "current_owner_descendants_unproven";
  return { state: "unknown", reason, starts: starts.length, exited };
}
