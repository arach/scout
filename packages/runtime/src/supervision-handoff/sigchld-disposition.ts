import { createRequire } from "node:module";

export type SigchldDisposition = { safe: true } | { safe: false;
  reason: "sigchld_ignored" | "sigchld_no_cldwait" | "sigchld_probe_unavailable" | "sigchld_probe_failed" };
// Darwin user-space sigaction, arm64/x64: handler union (8), mask (4), flags (4).
// https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/signal.h
export const DARWIN_SIGCHLD = 20;
export const DARWIN_SIGACTION_BYTES = 16;
export const DARWIN_SA_NOCLDWAIT = 0x0020;
export function inspectSigchldDisposition(bytes: Buffer): SigchldDisposition {
  if (bytes.length !== DARWIN_SIGACTION_BYTES) return { safe: false, reason: "sigchld_probe_failed" };
  if (bytes.readBigUInt64LE(0) === 1n) return { safe: false, reason: "sigchld_ignored" }; // SIG_IGN
  if (bytes.readUInt32LE(12) & DARWIN_SA_NOCLDWAIT) return { safe: false, reason: "sigchld_no_cldwait" };
  return { safe: true };
}
let query: ((bytes: Buffer) => number) | undefined;
/** Read-only current disposition, not proof that no foreign native reaper exists.
 * Import/construction does not load native code. Never cache the disposition. */
export function probeSigchldDisposition(): SigchldDisposition {
  if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch)) return { safe: false, reason: "sigchld_probe_unavailable" };
  if (!query) {
    try {
      const { dlopen, ptr } = createRequire(import.meta.url)("bun:ffi") as typeof import("bun:ffi");
      const system = dlopen("/usr/lib/libSystem.B.dylib", { sigaction: { args: ["i32", "ptr", "ptr"], returns: "i32" } });
      query = bytes => system.symbols.sigaction(DARWIN_SIGCHLD, null, ptr(bytes));
    } catch { return { safe: false, reason: "sigchld_probe_unavailable" }; }
  }
  try {
    const bytes = Buffer.alloc(DARWIN_SIGACTION_BYTES);
    if (query(bytes) !== 0) return { safe: false, reason: "sigchld_probe_failed" };
    return inspectSigchldDisposition(bytes);
  } catch { return { safe: false, reason: "sigchld_probe_failed" }; }
}
