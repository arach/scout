import { constants } from "node:os";
import type { SelectedInstance } from "./contracts.js";
import { BSD_INFO_BYTES, PID_PATH_BYTES, type DarwinProcessSource } from "./darwin-process-source.js";
import type { ProcessSampleResult } from "./process-evidence.js";

const unavailable = (reason: Extract<ProcessSampleResult, { state: "unavailable" }>["reason"]): ProcessSampleResult => ({ state: "unavailable", reason });
function metadata(bytes: Buffer, pid: number) {
  if (bytes.length !== BSD_INFO_BYTES || bytes.readUInt32LE(12) !== pid) return undefined;
  const seconds = bytes.readBigUInt64LE(120), microseconds = bytes.readBigUInt64LE(128);
  if (seconds === 0n || microseconds >= 1_000_000n) return undefined;
  return { uid: bytes.readUInt32LE(20), startSeconds: seconds.toString(), startMicroseconds: microseconds.toString() };
}
function executable(value: ReturnType<DarwinProcessSource["executable"]>) {
  // proc_pidpath returns the string length excluding its terminal NUL.
  if (value.count <= 0 || value.count >= PID_PATH_BYTES || value.bytes.length !== PID_PATH_BYTES || value.bytes[value.count] !== 0) return undefined;
  const bytes = value.bytes.subarray(0, value.count);
  const path = bytes.toString("utf8");
  if (!path.startsWith("/") || path.includes("\0") || !Buffer.from(path).equals(bytes)) return undefined;
  return path;
}
function failure(errno: number) {
  return unavailable(errno === constants.errno.EACCES || errno === constants.errno.EPERM ? "permission_denied" : "native_probe_failed");
}
/** Internal deterministic sampler. The public factory never accepts a source
 * from requests or env; only this test seam can replace native observations. */
export function sampleDarwinProcess(instance: SelectedInstance, pid: number, source: DarwinProcessSource): ProcessSampleResult {
  try {
    const bootSession = source.bootSession();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bootSession)) return unavailable("boot_session_unavailable");
    const first = source.bsdInfo(pid);
    if (first.count === 0) return first.errno === constants.errno.ESRCH ? { state: "pid_absent", pid } : failure(first.errno);
    if (first.count !== BSD_INFO_BYTES) return unavailable("incomplete_native_read");
    const identity = metadata(first.bytes, pid);
    if (!identity) return unavailable("invalid_native_identity");
    if (identity.uid !== instance.uid) return unavailable("foreign_uid");
    const path1 = source.executable(pid);
    if (path1.count <= 0) return failure(path1.errno);
    const path = executable(path1);
    if (!path) return unavailable("incomplete_native_read");
    const second = source.bsdInfo(pid);
    // Disappearance during a partial sample is unknown, not an absence proof.
    if (second.count === 0) return failure(second.errno);
    if (second.count !== BSD_INFO_BYTES) return unavailable("incomplete_native_read");
    const final = metadata(second.bytes, pid);
    if (!final) return unavailable("invalid_native_identity");
    if (final.uid !== identity.uid || final.startSeconds !== identity.startSeconds || final.startMicroseconds !== identity.startMicroseconds) return unavailable("identity_changed");
    const path2 = source.executable(pid);
    if (path2.count <= 0) return failure(path2.errno);
    const finalPath = executable(path2);
    if (!finalPath) return unavailable("incomplete_native_read");
    if (finalPath !== path) return unavailable("identity_changed");
    return { state: "sampled", sample: { format: "darwin-bsd-process/1", instance: { ...instance }, pid, ...identity, bootSession, executable: path } };
  } catch { return unavailable("native_probe_failed"); }
}
