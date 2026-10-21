// Test child only. Never import this module into a test runner or SDK host.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { directChildCapability } from "./child-custody.js";
import { DARWIN_SA_NOCLDWAIT, DARWIN_SIGACTION_BYTES, DARWIN_SIGCHLD, probeSigchldDisposition } from "./sigchld-disposition.js";

const mode = process.argv[2];
if (process.argv[1] !== fileURLToPath(import.meta.url) || process.platform !== "darwin" || !["default", "ignore", "no-cldwait", "default-again"].includes(mode!)) throw new Error("invalid native disposition fixture");
const { dlopen, ptr } = createRequire(import.meta.url)("bun:ffi") as typeof import("bun:ffi");
const system = dlopen("/usr/lib/libSystem.B.dylib", { sigaction: { args: ["i32", "ptr", "ptr"], returns: "i32" } });
function set(handler: bigint, flags: number) {
  const bytes = Buffer.alloc(DARWIN_SIGACTION_BYTES);
  bytes.writeBigUInt64LE(handler, 0); bytes.writeUInt32LE(flags, 12);
  if (system.symbols.sigaction(DARWIN_SIGCHLD, ptr(bytes), null) !== 0) throw new Error("fixture sigaction failed");
}
// This process never spawns a child, installs a runtime, or runs an app.
if (mode === "ignore" || mode === "default-again") set(1n, 0);
else set(0n, mode === "no-cldwait" ? DARWIN_SA_NOCLDWAIT : 0);
const first = directChildCapability();
if (mode === "default-again") set(0n, 0);
console.log(JSON.stringify({ first, capability: directChildCapability(), probe: probeSigchldDisposition() }));
