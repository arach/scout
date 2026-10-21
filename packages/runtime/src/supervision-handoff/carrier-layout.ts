import { closeSync } from "node:fs";
import { createRequire } from "node:module";
import { refuse } from "./contracts.js";

/** Fixed SDK-owned slots. Reserved context is not implemented or populated. */
export const CARRIER_LAYOUT = Object.freeze({ id: "role-custody/1", parentChannel: 3, reservedContext: 4, fence: 7 } as const);
let native: ReturnType<typeof openNative> | undefined;
function openNative() {
  if (process.platform !== "darwin") refuse("carrier_layout_unsupported");
  try {
    const { dlopen, ptr } = createRequire(import.meta.url)("bun:ffi") as typeof import("bun:ffi");
    const library = dlopen("/usr/lib/libSystem.B.dylib", {
      pipe: { args: ["ptr"], returns: "i32" },
      dup: { args: ["i32"], returns: "i32" },
      // Both commands below take no variadic payload. Do not bind a variadic
      // F_SETFD integer argument with the wrong Darwin arm64 calling convention.
      ioctl: { args: ["i32", "u64"], returns: "i32" },
      fcntl: { args: ["i32", "i32"], returns: "i32" },
    });
    return { library, ptr };
  } catch { refuse("carrier_layout_unavailable"); }
}
export function descriptorFlags(fd: number): number {
  native ??= openNative();
  const flags = native.library.symbols.fcntl(fd, 1); // F_GETFD, Darwin sys/fcntl.h
  if (flags < 0) refuse("carrier_descriptor_flags_failed");
  return flags;
}
export function markCloseOnExec(fd: number) {
  native ??= openNative();
  // FIOCLEX = _IO('f', 1), Darwin sys/filio.h. This changes descriptor flags,
  // never the shared flock or its open-file description.
  if (native.library.symbols.ioctl(fd, 0x20006601) !== 0 || !(descriptorFlags(fd) & 1)) refuse("carrier_descriptor_flags_failed");
}
/** Synchronous pipe -> FIOCLEX preparation, with no JS await. The trusted host
 * must exclude foreign native fork/exec during this non-atomic Darwin sequence.
 * Unlike Bun-owned extra pipes, these endpoints have one explicit SDK owner. */
export function createParentChannel() {
  native ??= openNative();
  const fds = new Int32Array(2);
  if (native.library.symbols.pipe(native.ptr(fds)) !== 0) refuse("parent_channel_failed");
  let reader: number | undefined = fds[0]!, writer: number | undefined = fds[1]!;
  const closeRead = () => { if (reader !== undefined) { const fd = reader; reader = undefined; closeSync(fd); } };
  const closeWrite = () => { if (writer !== undefined) { const fd = writer; writer = undefined; closeSync(fd); } };
  try { markCloseOnExec(reader); markCloseOnExec(writer); }
  catch (error) { try { closeRead(); } finally { closeWrite(); } throw error; }
  return { reader, writer, closeRead, closeWrite };
}
/** Bun's ordered dup2 actions can overwrite a low numbered numeric source
 * while preparing slots 0..7. Map only copies above every target slot. Close
 * copies after spawn on the audited borrowed-FD backend; never unlock them. */
export function mappingCopy(fd: number) {
  native ??= openNative();
  const low: number[] = []; let copy: number | undefined;
  try {
    for (;;) {
      const next = native.library.symbols.dup(fd);
      if (next < 0) refuse("carrier_mapping_copy_failed");
      copy = next; markCloseOnExec(copy);
      if (copy > CARRIER_LAYOUT.fence) break;
      low.push(copy); copy = undefined;
    }
    let owned: number | undefined = copy; copy = undefined;
    return { descriptor: owned, close: () => { if (owned !== undefined) { const fd = owned; owned = undefined; closeSync(fd); } } };
  } finally { if (copy !== undefined) closeSync(copy); for (const fd of low) closeSync(fd); }
}
