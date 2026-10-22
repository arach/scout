/** Candidate apparatus only. No runner imports this and no capability gate is changed. */
import { dlopen, ptr } from "bun:ffi";
import { closeSync } from "node:fs";
import { MAX_INHERITED_DESCRIPTOR_SLOT } from "../../packages/runtime/src/inherited-descriptors.ts";

const darwin = process.platform === "darwin";
// Linux's loader resolves libc.so.6 on glibc hosts; musl is deliberately not claimed.
let library: ReturnType<typeof openNative> | undefined;
function native() { return library ??= openNative(); }
function openNative() {
  if (!darwin && process.platform !== "linux") throw Error("unsupported spike platform");
  return dlopen(darwin ? "/usr/lib/libSystem.B.dylib" : "libc.so.6", {
    pipe: { args: ["ptr"], returns: "i32" },
    socketpair: { args: ["i32", "i32", "i32", "ptr"], returns: "i32" },
    dup: { args: ["i32"], returns: "i32" },
    fcntl: { args: ["i32", "i32"], returns: "i32" },
    // No variadic payload: avoids Darwin arm64's variadic integer ABI trap.
    ioctl: { args: ["i32", "u64"], returns: "i32" },
  });
}
export function clearCloseOnExecForNegativeControl(fd: number) {
  if (native().symbols.ioctl(fd, darwin ? 0x20006602 : 0x5450) !== 0) throw Error("CLOEXEC clearing failed");
}
export const flags = (fd: number) => native().symbols.fcntl(fd, 1); // F_GETFD
function mark(fd: number) {
  if (native().symbols.ioctl(fd, darwin ? 0x20006601 : 0x5451) !== 0 || !(flags(fd) & 1)) throw Error("CLOEXEC marking failed");
}
function own(fd: number) {
  let live = true;
  return { fd, close() { if (live) { live = false; closeSync(fd); } } };
}
function copy(fd: number) {
  const low: ReturnType<typeof own>[] = [];
  try {
    for (;;) {
      const n = native().symbols.dup(fd);
      if (n < 0) throw Error("dup failed");
      const result = own(n);
      try { mark(n); } catch (error) { result.close(); throw error; }
      if (n > MAX_INHERITED_DESCRIPTOR_SLOT) return result;
      low.push(result);
    }
  } finally { for (const entry of low) entry.close(); }
}
/** Synchronous allocation/mark/copy/close. Trusted host must exclude foreign
 * native fork/exec during this non-atomic interval, just as carrier-layout does.
 * Raw ends and temporary low copies close before return. Only two owners escape.
 */
export function pair(duplex: boolean) {
  const fds = new Int32Array(2);
  const result = duplex ? native().symbols.socketpair(1, 1, 0, ptr(fds)) : native().symbols.pipe(ptr(fds));
  if (result !== 0) throw Error("pair allocation failed");
  const raw = [own(fds[0]!), own(fds[1]!)];
  let parent: ReturnType<typeof own> | undefined, child: ReturnType<typeof own> | undefined;
  try {
    for (const end of raw) mark(end.fd);
    child = copy(raw[0]!.fd); parent = copy(raw[1]!.fd);
    return { parent, child };
  } catch (error) { child?.close(); parent?.close(); throw error; }
  finally { for (const end of raw) end.close(); }
}
