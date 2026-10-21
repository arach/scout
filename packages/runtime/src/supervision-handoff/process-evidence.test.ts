import { afterEach, expect, spyOn, test } from "bun:test";
import { constants } from "node:os";
import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProcessEvidenceReader, productionHandoffReadiness, type SelectedInstance } from "./index.js";
import { BSD_INFO_BYTES, PID_PATH_BYTES, type DarwinProcessSource } from "./darwin-process-source.js";
import { sampleDarwinProcess } from "./process-sampling.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function selection(): SelectedInstance {
  const supportDirectory = realpathSync(mkdtempSync(join(tmpdir(), "r0-native-evidence-"))); roots.push(supportDirectory);
  return { uid: process.geteuid!(), id: "native-evidence-fixture", supportDirectory };
}
function fake() {
  const instance = selection(), pid = 123;
  const metadata = () => {
    const bytes = Buffer.alloc(BSD_INFO_BYTES);
    bytes.writeUInt32LE(pid, 12); bytes.writeUInt32LE(instance.uid, 20);
    bytes.writeBigUInt64LE(9007199254740993n, 120); bytes.writeBigUInt64LE(345678n, 128);
    return { count: bytes.length, bytes, errno: 0 };
  };
  const executable = (path = "/fixture/worker") => {
    const bytes = Buffer.alloc(PID_PATH_BYTES); bytes.write(path);
    return { count: Buffer.byteLength(path), bytes, errno: 0 };
  };
  let reads = 0;
  const source: DarwinProcessSource = {
    bootSession: () => "12345678-1234-1234-1234-123456789abc",
    bsdInfo: () => { reads++; return metadata(); }, executable: () => { reads++; return executable(); },
  };
  return { instance, pid, source, metadata, executable, reads: () => reads };
}

test("native sampling keeps kernel birth precision and returns detached selected-instance data", () => {
  const f = fake(), result = sampleDarwinProcess(f.instance, f.pid, f.source);
  expect(result).toEqual({ state: "sampled", sample: { format: "darwin-bsd-process/1", instance: f.instance, pid: f.pid,
    uid: f.instance.uid, bootSession: "12345678-1234-1234-1234-123456789abc", startSeconds: "9007199254740993",
    startMicroseconds: "345678", executable: "/fixture/worker" } });
  expect(f.reads()).toBe(4);
  if (result.state !== "sampled") throw new Error("fixture failed");
  expect(result.sample.instance).not.toBe(f.instance);
  // Intentionally not an SDK Absence/owned result or an effect permit.
  expect(Object.keys(result)).toEqual(["state", "sample"]);
  expect(productionHandoffReadiness().ready).toBe(false);
});

test.each(["", "not-a-boot-uuid"])("unknown boot session %s refuses before process reads", boot => {
  const f = fake(); f.source.bootSession = () => boot;
  expect(sampleDarwinProcess(f.instance, f.pid, f.source)).toEqual({ state: "unavailable", reason: "boot_session_unavailable" });
  expect(f.reads()).toBe(0);
});

test.each([
  [constants.errno.ESRCH, "pid_absent"], [constants.errno.EACCES, "permission_denied"],
  [constants.errno.EPERM, "permission_denied"], [constants.errno.EIO, "native_probe_failed"], [0, "native_probe_failed"],
] as const)("only initial ESRCH is a missing PID, errno %s", (errno, expected) => {
  const f = fake(); f.source.bsdInfo = () => ({ bytes: Buffer.alloc(BSD_INFO_BYTES), count: 0, errno });
  expect(sampleDarwinProcess(f.instance, f.pid, f.source)).toEqual(expected === "pid_absent"
    ? { state: "pid_absent", pid: f.pid } : { state: "unavailable", reason: expected });
});

test.each([0, 1, -1, BSD_INFO_BYTES - 1, BSD_INFO_BYTES + 1])("short or invalid BSD read count %s cannot be sampled", count => {
  const f = fake(); f.source.bsdInfo = () => ({ ...f.metadata(), count });
  expect(sampleDarwinProcess(f.instance, f.pid, f.source).state).toBe("unavailable");
});

test.each(["pid", "seconds", "microseconds", "length"])("invalid kernel metadata %s refuses", field => {
  const f = fake(); f.source.bsdInfo = () => {
    const result = f.metadata();
    if (field === "pid") result.bytes.writeUInt32LE(f.pid + 1, 12);
    if (field === "seconds") result.bytes.writeBigUInt64LE(0n, 120);
    if (field === "microseconds") result.bytes.writeBigUInt64LE(1_000_000n, 128);
    if (field === "length") result.bytes = result.bytes.subarray(0, BSD_INFO_BYTES - 1);
    return result;
  };
  expect(sampleDarwinProcess(f.instance, f.pid, f.source)).toEqual({ state: "unavailable", reason: "invalid_native_identity" });
});

test("another UID is unavailable and never triggers executable inspection", () => {
  const f = fake(); let paths = 0;
  f.source.bsdInfo = () => { const value = f.metadata(); value.bytes.writeUInt32LE(f.instance.uid + 1, 20); return value; };
  f.source.executable = () => { paths++; return f.executable(); };
  expect(sampleDarwinProcess(f.instance, f.pid, f.source)).toEqual({ state: "unavailable", reason: "foreign_uid" });
  expect(paths).toBe(0);
});

test.each(["uid", "seconds", "microseconds", "path"])("identity change during sampling (%s) is not a usable witness", field => {
  const f = fake(); let bsd = 0, paths = 0;
  f.source.bsdInfo = () => {
    const value = f.metadata();
    if (++bsd === 2) {
      if (field === "uid") value.bytes.writeUInt32LE(f.instance.uid + 1, 20);
      if (field === "seconds") value.bytes.writeBigUInt64LE(9007199254740994n, 120);
      if (field === "microseconds") value.bytes.writeBigUInt64LE(345679n, 128);
    }
    return value;
  };
  f.source.executable = () => f.executable(++paths === 2 && field === "path" ? "/fixture/replacement" : "/fixture/worker");
  expect(sampleDarwinProcess(f.instance, f.pid, f.source)).toEqual({ state: "unavailable", reason: "identity_changed" });
});

test.each(["path1", "metadata2", "path2"])("ESRCH after partial sampling (%s) stays unavailable", point => {
  const f = fake(); let bsd = 0, paths = 0;
  f.source.bsdInfo = () => ++bsd === 2 && point === "metadata2" ? { ...f.metadata(), count: 0, errno: constants.errno.ESRCH } : f.metadata();
  f.source.executable = () => ++paths === (point === "path1" ? 1 : point === "path2" ? 2 : -1)
    ? { ...f.executable(), count: 0, errno: constants.errno.ESRCH } : f.executable();
  expect(sampleDarwinProcess(f.instance, f.pid, f.source)).toEqual({ state: "unavailable", reason: "native_probe_failed" });
});

test.each(["relative", "nul", "unterminated", "truncated", "invalid-utf8", "short-buffer"])("invalid executable evidence %s refuses", kind => {
  const f = fake(); f.source.executable = () => {
    const result = f.executable(kind === "relative" ? "relative/worker" : "/fixture/worker");
    if (kind === "nul") result.bytes[2] = 0;
    if (kind === "unterminated") result.bytes[result.count] = 1;
    if (kind === "truncated") result.count = PID_PATH_BYTES;
    if (kind === "invalid-utf8") result.bytes[2] = 255;
    if (kind === "short-buffer") result.bytes = result.bytes.subarray(0, 16);
    return result;
  };
  expect(sampleDarwinProcess(f.instance, f.pid, f.source)).toEqual({ state: "unavailable", reason: "incomplete_native_read" });
});

test("native source exceptions refuse without guessing or falling back to ps", () => {
  const f = fake(); f.source.executable = () => { throw new Error("private diagnostic must not escape"); };
  expect(sampleDarwinProcess(f.instance, f.pid, f.source)).toEqual({ state: "unavailable", reason: "native_probe_failed" });
});

test("reader construction creates no custody state and rejects invalid PIDs before native lookup", () => {
  const instance = selection(), reader = createProcessEvidenceReader(instance);
  expect(readdirSync(instance.supportDirectory)).toEqual([]);
  for (const pid of [0, -1, 1.5, NaN, Infinity, 0x80000000]) expect(() => reader.sample(pid)).toThrow("invalid_process_id");
  expect(productionHandoffReadiness().ready).toBe(false);
});

test("reader binds its explicit instance and rechecks the effective UID on each sample", () => {
  const instance = selection(), reader = createProcessEvidenceReader(instance);
  const uid = spyOn(process, "geteuid");
  try {
    uid.mockReturnValue(instance.uid + 1);
    expect(() => reader.sample(process.pid)).toThrow("wrong_instance");
    uid.mockReturnValue(0);
    expect(() => reader.sample(process.pid)).toThrow("wrong_instance");
  } finally { uid.mockRestore(); }
  expect(readdirSync(instance.supportDirectory)).toEqual([]);
});

test("native self-sampling and comparisons are read-only, not custody or exit proofs", () => {
  const instance = selection(), reader = createProcessEvidenceReader(instance);
  const result = reader.sample(process.pid);
  if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch)) {
    expect(result).toEqual({ state: "unavailable", reason: "unsupported_platform" }); return;
  }
  expect(result.state).toBe("sampled");
  if (result.state !== "sampled") throw new Error("native self-probe unavailable");
  expect(result.sample.pid).toBe(process.pid);
  expect(result.sample.uid).toBe(instance.uid);
  expect(result.sample.executable.startsWith("/")).toBe(true);
  expect(reader.compare(result.sample)).toEqual({ state: "same_sample" });
  for (const field of ["bootSession", "startSeconds", "startMicroseconds", "executable"] as const) {
    expect(reader.compare({ ...result.sample, [field]: "different" })).toEqual({ state: "different_sample" });
  }
  expect(() => reader.compare({ ...result.sample, instance: { ...instance, id: "another-instance" } })).toThrow("wrong_instance");
  expect(readdirSync(instance.supportDirectory)).toEqual([]);
  expect(productionHandoffReadiness().ready).toBe(false);
});
