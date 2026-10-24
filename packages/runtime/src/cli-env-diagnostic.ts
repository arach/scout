// Temporary, opt-in CLI hang diagnostics. Never materialize process.stdout,
// spawn an observer in the test process, change budgets, or consume pipe data.
import { readFileSync, readdirSync, readlinkSync, writeSync } from "node:fs";
import { basename } from "node:path";

let active = false;
let phase = "idle";
let started = 0;
function emit(record: Record<string, unknown>): void {
  try { writeSync(2, JSON.stringify({ event: "cli-env-diag", at: Date.now(), observerPid: process.pid, ...record }) + "\n"); }
  catch { /* Diagnostics must not replace a test result. */ }
}
function read(path: string): string {
  try { return readFileSync(path, "utf8"); } catch { return ""; }
}
function entries(path: string): string[] {
  try { return readdirSync(path); } catch { return []; }
}
function link(path: string): string {
  try {
    const value = readlinkSync(path);
    return /^(?:pipe:|socket:|anon_inode:)/.test(value) ? value : basename(value);
  } catch { return "gone"; }
}
function descriptors(pid: number) {
  return entries(`/proc/${pid}/fd`).sort((a, b) => Number(a) - Number(b)).slice(0, 128).map(fd => ({
    fd: Number(fd), target: link(`/proc/${pid}/fd/${fd}`),
    // Include epoll registrations and inode/flags, but never regular file contents.
    info: read(`/proc/${pid}/fdinfo/${fd}`).split("\n").filter(line => /^(?:pos:|flags:|mnt_id:|ino:|tfd:)/.test(line)).slice(0, 32),
  }));
}
function snapshot(pid: number) {
  const tids = entries(`/proc/${pid}/task`).slice(0, 128);
  const childOwners = tids.flatMap(tid => read(`/proc/${pid}/task/${tid}/children`).trim().split(/\s+/).filter(Boolean).map(child => ({ pid: Number(child), ownerTid: Number(tid) })));
  const children = childOwners.slice(0, 32).map(child => {
    const args = read(`/proc/${child.pid}/cmdline`).split("\0").filter(Boolean);
    return { ...child, exe: link(`/proc/${child.pid}/exe`), comm: read(`/proc/${child.pid}/comm`).trim(),
      argc: args.length, script: args.find(arg => /\.(?:mjs|cjs|js|ts)$/.test(arg))?.split("/").pop(),
      gitOperation: args.includes("symbolic-ref") ? "symbolic-ref" : args.includes("rev-parse") ? "rev-parse" : undefined,
      state: /^State:.*$/m.exec(read(`/proc/${child.pid}/status`))?.[0], wchan: read(`/proc/${child.pid}/wchan`).trim(), fds: descriptors(child.pid) };
  });
  return { pid, threads: tids.map(tid => ({ tid: Number(tid), wchan: read(`/proc/${pid}/task/${tid}/wchan`).trim() })), fds: descriptors(pid), children };
}
export function cliEnvPhase(next: string): void {
  if (!active) return;
  phase = next;
  const stdout = Object.getOwnPropertyDescriptor(process, "stdout");
  emit({ kind: "phase", phase, elapsedMs: Date.now() - started,
    stdoutDescriptor: { getter: typeof stdout?.get, value: typeof stdout?.value } });
}
export function beginCliEnvDiagnostic(): () => void {
  if (process.env.SCOUT_CLI_ENV_DIAG !== "1") return () => {};
  active = true;
  started = Date.now();
  cliEnvPhase("test.begin");
  if (process.platform === "linux") emit({ kind: "test-start-snapshot", ...snapshot(process.pid) });
  // A synchronous Git wait cannot emit this pulse; the parent still samples it.
  const timer = setInterval(() => emit({ kind: "pulse", phase, elapsedMs: Date.now() - started }), 250);
  return () => { clearInterval(timer); cliEnvPhase("test.end"); active = false; };
}
export function watchCliEnvProcess(pid: number): () => void {
  if (process.platform !== "linux") {
    emit({ kind: "parent-watch-unavailable", platform: process.platform, pid });
    return () => {};
  }
  // This runs in the existing runner, not in the isolated test process. It can
  // observe a blocked synchronous spawn without adding test-process pipe FDs.
  let previous = "";
  let polls = 0;
  const sample = () => {
    if (++polls > 1800) return;
    try {
      const record = snapshot(pid);
      const serialized = JSON.stringify(record);
      if (serialized !== previous || polls % 20 === 0) {
        previous = serialized;
        emit({ kind: "parent-snapshot", poll: polls, ...record });
      }
    } catch { /* A process may exit during a snapshot. */ }
  };
  sample();
  const timer = setInterval(sample, 250);
  return () => { clearInterval(timer); sample(); };
}
