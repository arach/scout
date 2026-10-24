// Parent-only CLI hang diagnostics. No I/O on import. Never instrument the
// test body/runtime, change child stdio/environment, or consume pipe data.
import { readFileSync, readdirSync, readlinkSync, writeSync } from "node:fs";
import { basename } from "node:path";

let sequence = 0;
function emit(record: Record<string, unknown>): void {
  try {
    const data = Buffer.from(JSON.stringify({ event: "cli-env-diag", schema: 2, at: Date.now(), observerPid: process.pid, ...record }) + "\n");
    for (let offset = 0; offset < data.length;) {
      const written = writeSync(2, data, offset, data.length - offset);
      if (written <= 0) break;
      offset += written;
    }
  } catch { /* Diagnostics must not replace a test result. */ }
}
function read(path: string): string {
  try { return readFileSync(path, "utf8"); } catch { return ""; }
}
function entries(path: string): string[] {
  try { return readdirSync(path); } catch { return []; }
}
function rawLink(path: string): string | null {
  try { return readlinkSync(path); } catch { return null; }
}
function safeLink(path: string): string {
  const value = rawLink(path);
  return value === null ? "gone" : /^(?:pipe:|socket:|anon_inode:)/.test(value) ? value : basename(value);
}
function descriptors(pid: number, procRoot: string) {
  const names = entries(`${procRoot}/${pid}/fd`).filter(fd => /^\d+$/.test(fd)).sort((a, b) => Number(a) - Number(b));
  const counts = { pipe: 0, socket: 0, anon_inode: 0, file: 0, device: 0, other: 0, gone: 0 };
  const filesByBasename: Record<string, number> = Object.create(null);
  const fds: { fd: number; target: string; info: string[] }[] = [];
  const vanishedFds: number[] = [];
  for (const fd of names) {
    const target = rawLink(`${procRoot}/${pid}/fd/${fd}`);
    const kind = target === null ? "gone" : target.startsWith("pipe:") ? "pipe" : target.startsWith("socket:") ? "socket"
      : target.startsWith("anon_inode:") ? "anon_inode" : target.startsWith("/dev/") ? "device" : target.startsWith("/") ? "file" : "other";
    counts[kind]++;
    if (kind === "gone") vanishedFds.push(Number(fd));
    else if (kind === "pipe" || kind === "socket" || kind === "anon_inode") {
      // No descriptor or epoll-registration cap. Only kernel metadata is read.
      fds.push({ fd: Number(fd), target: target!, info: read(`${procRoot}/${pid}/fdinfo/${fd}`).split("\n")
        .filter(line => /^(?:pos:|flags:|mnt_id:|ino:|tfd:)/.test(line)) });
    } else {
      const name = basename(target!);
      filesByBasename[name] = (filesByBasename[name] ?? 0) + 1;
    }
  }
  return { fdCount: names.length, fdCounts: counts, filesByBasename, fds, vanishedFds };
}
function processRecord(pid: number, procRoot: string) {
  const tids = entries(`${procRoot}/${pid}/task`).filter(tid => /^\d+$/.test(tid)).sort((a, b) => Number(a) - Number(b));
  const childOwners = tids.flatMap(tid => read(`${procRoot}/${pid}/task/${tid}/children`).trim().split(/\s+/).filter(Boolean)
    .map(child => ({ pid: Number(child), parentPid: pid, ownerTid: Number(tid) })));
  const args = read(`${procRoot}/${pid}/cmdline`).split("\0").filter(Boolean);
  const stat = read(`${procRoot}/${pid}/stat`);
  const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
  return { pid, exe: safeLink(`${procRoot}/${pid}/exe`), comm: read(`${procRoot}/${pid}/comm`).trim(),
    argc: args.length, script: args.find(arg => /\.(?:mjs|cjs|js|ts)$/.test(arg))?.split("/").pop(),
    gitOperation: args.includes("symbolic-ref") ? "symbolic-ref" : args.includes("rev-parse") ? "rev-parse" : undefined,
    startTicks: fields[19], state: /^State:.*$/m.exec(read(`${procRoot}/${pid}/status`))?.[0],
    wchan: read(`${procRoot}/${pid}/wchan`).trim(),
    threads: tids.map(tid => ({ tid: Number(tid), wchan: read(`${procRoot}/${pid}/task/${tid}/wchan`).trim() })),
    childOwners, ...descriptors(pid, procRoot) };
}
// procRoot permits a portable synthetic /proc witness without changing the
// real test inventory. Production diagnostic calls always use /proc.
export function cliEnvProcessSnapshot(pid: number, procRoot = "/proc") {
  const root = { ...processRecord(pid, procRoot), parentPid: null as number | null, ownerTid: null as number | null };
  const processes = [root];
  const seen = new Set([pid]);
  for (let index = 0; index < processes.length; index++) {
    for (const child of processes[index]!.childOwners) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      processes.push({ ...processRecord(child.pid, procRoot), parentPid: child.parentPid, ownerTid: child.ownerTid });
    }
  }
  return { pid, sampledAt: Date.now(), processes };
}
type Snapshot = ReturnType<typeof cliEnvProcessSnapshot>;
function batches<T>(items: T[], visit: (batch: T[], part: number, parts: number) => void): void {
  // This is transport framing, not a collection cap: emit EVERY batch. Small
  // lines avoid truncating a whole inventory in hosted log readers.
  const parts = Math.ceil(items.length / 8);
  for (let part = 0; part < parts; part++) visit(items.slice(part * 8, (part + 1) * 8), part, parts);
}
export function emitCliEnvSnapshot(kind: string, snapshot: Snapshot, metadata: Record<string, unknown> = {}): void {
  const snapshotId = `${process.pid}:${++sequence}`;
  emit({ kind, snapshotId, pid: snapshot.pid, sampledAt: snapshot.sampledAt, processCount: snapshot.processes.length, ...metadata });
  for (const record of snapshot.processes) {
    const { threads, fds, filesByBasename, vanishedFds, childOwners, ...identity } = record;
    const ref = { snapshotId, pid: record.pid };
    emit({ kind: "snapshot-process", ...ref, ...identity, threadCount: threads.length, childCount: childOwners.length });
    batches(threads, (items, part, parts) => emit({ kind: "snapshot-threads", ...ref, part, parts, items }));
    batches(Object.entries(filesByBasename), (items, part, parts) => emit({ kind: "snapshot-file-counts", ...ref, part, parts, items }));
    batches(vanishedFds, (items, part, parts) => emit({ kind: "snapshot-vanished-fds", ...ref, part, parts, items }));
    batches(fds.map(fd => ({ ...fd, info: fd.info.filter(line => !line.startsWith("tfd:")),
      epollRegistrationCount: fd.info.filter(line => line.startsWith("tfd:")).length })),
    (items, part, parts) => emit({ kind: "snapshot-descriptors", ...ref, part, parts, items }));
    for (const fd of fds) {
      batches(fd.info.filter(line => line.startsWith("tfd:")), (items, part, parts) => emit({ kind: "snapshot-epoll", ...ref, epollFd: fd.fd, part, parts, items }));
    }
  }
  emit({ kind: "snapshot-complete", snapshotId, pid: snapshot.pid });
}
export function watchCliEnvProcess(pid: number, iteration?: number): () => void {
  if (process.platform !== "linux") {
    emit({ kind: "parent-watch-unavailable", platform: process.platform, pid, iteration });
    return () => {};
  }
  // Observe from the existing runner, without changing the test's FD table.
  let previous = "";
  let polls = 0;
  let previousChildren = new Map<string, Snapshot["processes"][number]>();
  const sample = () => {
    try {
      const snapshot = cliEnvProcessSnapshot(pid);
      const children = new Map(snapshot.processes.slice(1).map(child => [`${child.pid}:${child.startTicks}`, child]));
      for (const [key, child] of previousChildren) if (!children.has(key)) {
        emit({ kind: "child-not-observed", pid, iteration, childPid: child.pid, startTicks: child.startTicks,
          exe: child.exe, script: child.script, gitOperation: child.gitOperation, lastState: child.state, lastWchan: child.wchan });
      }
      previousChildren = children;
      const serialized = JSON.stringify(snapshot.processes);
      polls++;
      if (serialized !== previous || polls % 4 === 0) {
        previous = serialized;
        emitCliEnvSnapshot("parent-snapshot", snapshot, { poll: polls, iteration });
      }
    } catch { /* A process may exit during a snapshot. */ }
  };
  sample();
  const timer = setInterval(sample, 250);
  return () => { clearInterval(timer); sample(); };
}
