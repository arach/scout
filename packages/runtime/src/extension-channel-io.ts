/** Dormant candidate. Not exported by the runtime package or imported by any runner.
 * Own raw descriptors only: no stream, FileHandle, Bun.file or finalizing FD wrapper. */
import { createRequire } from "node:module";
import { INHERITED_DESCRIPTOR_LAYOUTS, MAX_INHERITED_DESCRIPTOR_SLOT } from "./inherited-descriptors.js";
export const EXTENSION_CHANNEL_LIMIT = 64 * 1024;
const CHUNK = 4096, BUDGET = 4;
export type ChannelIoReason = "closed" | "cancelled" | "timeout" | "busy" | "invalid_input" | "oversize" | "truncated_frame" | "multiple_frames" | "native_error" | "native_unavailable";
export class ChannelIoError extends Error {
  constructor(readonly reason: ChannelIoReason, readonly nativeCode?: number) { super(`extension_channel_${reason}`); }
}
/** Synchronous nonblocking syscalls only. Negative codes: -1 AGAIN, -2 EINTR,
 * all others hard errors. An injected test driver never creates real FDs. */
export interface ChannelDriver {
  read(fd: number, bytes: Uint8Array): number;
  write(fd: number, bytes: Uint8Array): number;
  close(fd: number): number;
}
export type ChannelIoOptions = { timeoutMs?: number; signal?: AbortSignal };
export class BoundedChannelDescriptor {
  readonly stats = { readCalls: 0, writeCalls: 0, readBytes: 0, writeBytes: 0, readWouldBlock: 0, writeWouldBlock: 0, yields: 0, closeCalls: 0, peakReadBuffer: 0, peakWriteBuffer: 0 };
  #closed = false; #reason = new ChannelIoError("closed");
  #reading = false; #writing = false;
  #waiters = new Set<(error: ChannelIoError) => void>();
  constructor(readonly fd: number, private readonly driver: ChannelDriver) {}
  get closed() { return this.#closed; }
  /** Invalidate BEFORE the one close syscall. Never retry close on EINTR: its
   * number may already have been reused. All queued turns are disarmed. */
  close(reason = new ChannelIoError("closed")) {
    if (this.#closed) return;
    this.#closed = true; this.#reason = reason; this.stats.closeCalls++;
    try { this.driver.close(this.fd); }
    finally { for (const wake of this.#waiters) wake(reason); this.#waiters.clear(); }
  }
  #check() { if (this.#closed) throw this.#reason; }
  async #turn(delay: number) {
    this.#check(); this.stats.yields++;
    await new Promise<void>((resolve, reject) => {
      const wake = (error: ChannelIoError) => { clearTimeout(timer); this.#waiters.delete(wake); reject(error); };
      const timer = setTimeout(() => { this.#waiters.delete(wake); resolve(); }, delay);
      this.#waiters.add(wake);
    });
    this.#check();
  }
  async #operation<T>(kind: "read" | "write", options: ChannelIoOptions, body: () => Promise<T>): Promise<T> {
    try {
      this.#check();
      if (kind === "read" ? this.#reading : this.#writing) throw new ChannelIoError("busy");
      const timeout = options.timeoutMs ?? 2000;
      if (!Number.isFinite(timeout) || timeout < 1 || timeout > 60_000) throw new ChannelIoError("invalid_input");
      if (options.signal?.aborted) throw new ChannelIoError("cancelled");
      if (kind === "read") this.#reading = true; else this.#writing = true;
      const abort = () => this.close(new ChannelIoError("cancelled"));
      const timer = setTimeout(() => this.close(new ChannelIoError("timeout")), timeout);
      try { options.signal?.addEventListener("abort", abort, { once: true }); return await body(); }
      finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); if (kind === "read") this.#reading = false; else this.#writing = false; }
    } catch (error) {
      const reason = error instanceof ChannelIoError ? error : new ChannelIoError("native_error");
      this.close(reason); throw reason;
    }
  }
  /** At most one writer and one 64-KiB snapshot, never an unbounded write queue.
   * Four <=4-KiB syscalls per turn; partial progress, EINTR and EAGAIN all yield. */
  write(bytes: Uint8Array, options: ChannelIoOptions = {}) {
    return this.#operation("write", options, async () => {
      if (!(bytes instanceof Uint8Array)) throw new ChannelIoError("invalid_input");
      if (bytes.byteLength > EXTENSION_CHANNEL_LIMIT) throw new ChannelIoError("oversize");
      const snapshot = Uint8Array.from(bytes); this.stats.peakWriteBuffer = Math.max(this.stats.peakWriteBuffer, snapshot.length);
      let offset = 0, budget = BUDGET;
      while (offset < snapshot.length) {
        this.#check();
        const part = snapshot.subarray(offset, Math.min(offset + CHUNK, snapshot.length));
        this.stats.writeCalls++;
        const n = this.driver.write(this.fd, part);
        if (n > part.length || n === 0 || n < -2) throw new ChannelIoError("native_error", n);
        if (n > 0) { offset += n; this.stats.writeBytes += n; }
        if (n === -1) this.stats.writeWouldBlock++;
        if (n === -1 || --budget === 0) { await this.#turn(n === -1 ? 2 : 0); budget = BUDGET; }
      }
    });
  }
  /** One LF frame, including LF, capped at 64 KiB. No hidden trailing-frame
   * queue: multiple frames in one read refuse. Empty EOF closes and returns null;
   * unterminated EOF/oversize frames close and refuse. */
  readFrame(options: ChannelIoOptions = {}): Promise<Uint8Array | null> {
    return this.#operation("read", options, async () => {
      const frame = new Uint8Array(EXTENSION_CHANNEL_LIMIT); this.stats.peakReadBuffer = frame.length;
      let offset = 0, budget = BUDGET;
      for (;;) {
        this.#check();
        if (offset === frame.length) throw new ChannelIoError("oversize");
        const part = frame.subarray(offset, Math.min(offset + CHUNK, frame.length));
        this.stats.readCalls++;
        const n = this.driver.read(this.fd, part);
        if (n > part.length || n < -2) throw new ChannelIoError("native_error", n);
        if (n === 0) { if (offset) throw new ChannelIoError("truncated_frame"); this.close(); return null; }
        if (n > 0) {
          const end = offset + n; this.stats.readBytes += n;
          const lf = frame.subarray(offset, end).indexOf(10);
          if (lf >= 0) {
            if (offset + lf !== end - 1) throw new ChannelIoError("multiple_frames");
            return frame.subarray(0, end);
          }
          offset = end;
        }
        if (n === -1) this.stats.readWouldBlock++;
        if (n === -1 || --budget === 0) { await this.#turn(n === -1 ? 2 : 0); budget = BUDGET; }
      }
    });
  }
}
let native: ReturnType<typeof loadNative> | undefined;
function loadNative() {
  const { cc, ptr } = createRequire(import.meta.url)("bun:ffi") as typeof import("bun:ffi");
  // Fixed repository-owned source, not environment/search-path controlled code.
  // Packaging this C asset and compiler/header availability remain release gates.
  const library = cc({ source: new URL("./extension-channel-native.c", import.meta.url), symbols: {
    scout_channel_pair: { args: ["i32", "i32", "ptr"], returns: "i32" },
    scout_channel_flags: { args: ["i32"], returns: "i32" },
    scout_channel_nonblocking: { args: ["i32"], returns: "i32" },
    scout_channel_read: { args: ["i32", "ptr", "i32"], returns: "i32" },
    scout_channel_write: { args: ["i32", "ptr", "i32"], returns: "i32" },
    scout_channel_close: { args: ["i32"], returns: "i32" },
  } });
  const symbols = library.symbols, activity = {count: 0};
  const driver: ChannelDriver = {
    read: (fd, bytes) => symbols.scout_channel_read(fd, ptr(bytes), bytes.length),
    write: (fd, bytes) => symbols.scout_channel_write(fd, ptr(bytes), bytes.length),
    close: fd => { const result = symbols.scout_channel_close(fd); activity.count--; return result; },
  };
  return { library, driver, ptr, activity };
}
/** Candidate allow-list, NOT the product context/credential capability gates.
 * Refuse before native loading/allocation on all other revisions/platforms. */
export function createExtensionChannelCandidate(form: "context" | "credential") {
  if (form !== "context" && form !== "credential") throw new ChannelIoError("invalid_input");
  if (Bun.revision !== "0d9b296af33f2b851fcbf4df3e9ec89751734ba4" || !(process.platform === "darwin" && process.arch === "arm64" || process.platform === "linux" && process.arch === "x64")) throw Error("extension_channel_candidate_unavailable");
  try { native ??= loadNative(); }
  catch { throw new ChannelIoError("native_unavailable"); }
  const fds = new Int32Array(2);
  const code = native.library.symbols.scout_channel_pair(form === "credential" ? 1 : 0, MAX_INHERITED_DESCRIPTOR_SLOT + 1, native.ptr(fds));
  if (code !== 0) throw new ChannelIoError("native_error", code);
  native.activity.count += 2;
  const parent = new BoundedChannelDescriptor(fds[0]!, native.driver);
  const child = new BoundedChannelDescriptor(fds[1]!, native.driver);
  return { parent, child, target: INHERITED_DESCRIPTOR_LAYOUTS.extensionApi2[form],
    flags: (fd: number) => native!.library.symbols.scout_channel_flags(fd),
    nonblocking: () => native!.library.symbols.scout_channel_nonblocking(parent.fd),
  };
}

/** Evidence hook only, not a package export. Drop the code cache ONLY after
 * every explicitly owned endpoint has closed; never unload code used by I/O.
 * The reclaim witness must also challenge this helper's collection, rather
 * than relying on a permanently retained compiler/library wrapper. */
export function releaseExtensionChannelCodeForWitness(observe: (library: object) => void) {
  if (!native) throw Error("no extension channel code loaded");
  if (native.activity.count !== 0) throw Error("extension channel endpoints still open");
  observe(native.library); native = undefined;
}
