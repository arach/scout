/** Process-only fault instrumentation. No production selector or loader. */
import fs from "node:fs";
import {join, basename, resolve} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {mock} from "bun:test";

const [mode, root, coordination, detail = "{}"] = process.argv.slice(2);
if (!mode || !root || !coordination || !fs.realpathSync(root).startsWith(fs.realpathSync(tmpdir()) + "/")
  || !basename(resolve(root)).startsWith("pairing-capsule-")) throw Error("temporary cutover fixture required");
const options = JSON.parse(detail), point = options.point;
const original = {...fs}, canonical = original.realpathSync(root), paths = new Map<number, string>();
let allocated = 0, published = false, deleted = 0, receipted = false, held = false, paused = false;
const trace = (event: object) => original.appendFileSync(join(coordination, "trace.jsonl"), JSON.stringify(event) + "\n");
function pause(name: string) {
  original.writeFileSync(join(coordination, `ready-${name}`), "ready");
  const deadline = Date.now() + 30000;
  while (!original.existsSync(join(coordination, "go"))) {
    if (Date.now() > deadline) throw Error("fixture coordination timeout; never an ownership timeout");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
}
const crash = (name: string) => {if (point === name) process.exit(81);};
fs.openSync = ((path: any, ...args: any[]) => {const fd = (original.openSync as any)(path, ...args); paths.set(fd, String(path)); return fd;}) as any;
fs.mkdirSync = ((path: any, ...args: any[]) => {
  const result = (original.mkdirSync as any)(path, ...args);
  if (String(path).endsWith("/.pairing-cutover")) {trace({event: "claim", held}); crash("after-claim");}
  return result;
}) as any;
fs.writeFileSync = ((path: any, ...args: any[]) => {
  if (point === "reservation-exhaustion" && typeof path === "number" && paths.get(path)?.includes("/reserve.") && allocated === 5) {
    trace({event: "reservation_failure", allocated}); throw Object.assign(Error("reservation exhausted"), {code: "ENOSPC"});
  }
  return (original.writeFileSync as any)(path, ...args);
}) as any;
fs.fsyncSync = ((fd: number) => {
  const path = paths.get(fd), directory = original.fstatSync(fd).isDirectory();
  trace({event: "sync", path, directory, held}); original.fsyncSync(fd);
  if (allocated < 320 && path?.includes("/.pairing-cutover/reserve.") && original.fstatSync(fd).size === 1024 * 1024) {
    allocated++; const stat = original.fstatSync(fd);
    trace({event: "allocated", count: allocated, bytes: stat.size, physicalBytes: stat.blocks * 512});
    if (allocated === 320) crash("after-reservation");
  }
  trace({event: "sync_success", path, directory});
  if (path === canonical && published && !deleted) crash("after-barrier-sync");
  if (path === canonical && deleted === options.revision && !receipted) crash("after-retirement");
  if (path === canonical && receipted) crash("after-receipt-sync");
}) as any;
fs.linkSync = ((source: any, target: any) => {
  const migrating = String(source).endsWith("/.pairing-cutover/barrier.json");
  if (migrating && point === "before-cas") pause("before-cas");
  if (!migrating && mode === "old-write" && point === "old-before-cas") pause("old-before-cas");
  original.linkSync(source, target); trace({event: "link", source: String(source), target: String(target), held});
  if (migrating) {
    published = true; crash("after-cas");
    if (point === "uncertain-cas") throw Object.assign(Error("ACK lost at link syscall"), {code: "EIO"});
  }
}) as any;
fs.renameSync = ((source: any, target: any) => {
  const from = String(source), to = String(target), inCut = from.includes("/.pairing-cutover/");
  // Also reaches the pause in the deliberately wrong rename-for-CAS control.
  if (from.endsWith("/.pairing-cutover/barrier.json") && to.includes("/trusted-peers.owner.") && point === "before-cas") pause("before-cas");
  if (mode === "old-write" && point === "old-before-projection" && to.endsWith("/trusted-peers.json")) pause("old-before-projection");
  if (inCut && !to.includes("/.pairing-cutover/") && to.endsWith("/trusted-peers.v2.commit.1.json") && point === "publish-head") pause("publish-head");
  if (inCut && to === join(canonical, "trusted-peers.v2.cutover.json") && point === "before-receipt") pause("before-receipt");
  original.renameSync(source, target); trace({event: "rename", source: from, target: to, held});
  if (to.includes("/.pairing-cutover/") && to.endsWith("/trusted-peers.v2.cutover.json")) crash("after-staging");
  if (to === join(canonical, "trusted-peers.v2.cutover.json")) {receipted = true; crash("after-receipt");}
}) as any;
fs.unlinkSync = ((path: any) => {
  const name = String(path), legacy = name.startsWith(canonical + "/trusted-peers.owner.");
  if (legacy && point === "before-retirement" && !paused) {paused = true; pause("before-retirement");}
  if (legacy && point === "retirement-fail") throw Object.assign(Error("retirement I/O failure"), {code: "EIO"});
  if (point === "cleanup-fail" && name.includes("/.pairing-cutover/reserve.") && original.existsSync(join(canonical, "trusted-peers.v2.cutover.json"))) throw Object.assign(Error("cleanup I/O failure"), {code: "EIO"});
  original.unlinkSync(path); trace({event: "unlink", path: name, held});
  if (legacy) {deleted++; crash("during-retirement");}
  if (receipted && name.includes("/.pairing-cutover/")) crash("during-cleanup");
}) as any;
mock.module("node:fs", () => ({...fs}));

const pinned = new URL("./fixtures/pairing-v1/pairing-security/trust-owner.ts", import.meta.url);
// Exact recursive import closure from 509c7595; source bytes ship in the
// fixture so this assertion does not depend on a deep CI git checkout.
const closure = {
  "./trust-owner.ts": "e0f650bacb7e72a413df1beb6520e136ba237feaf376500f5de77d0e9a6c4695",
  "../support-paths.ts": "89bb061034a2e8ce7d11ca17c4db888744fd980d2a2e101ad8d4d2604298c6b1",
  "../instance.ts": "22872b4328ff65c863308adaad4e2035b083ed6694c0ac8d8461e1a11a047f65"
};
for (const [path, expected] of Object.entries(closure)) {
  const actual = createHash("sha256").update(original.readFileSync(new URL(path, pinned))).digest("hex");
  if (actual !== expected) throw Error(`pinned v1 closure changed: ${path}: ${actual} != ${expected}`);
}

const current = await import("../packages/runtime/src/pairing-security/trust-owner.ts");
const old = await import("./fixtures/pairing-v1/pairing-security/trust-owner.ts");
try {
  const owner = (mode.startsWith("old-") ? old : current).pairingTrustOwner(root);
  if (options.managed) {
    let holder: object | null = null;
    owner.register({id: "cutover.test", withGate(_root, body) {holder = {}; held = true;
      try {return body(holder);} finally {holder = null; held = false;}}, currentHolder() {return holder;}});
  }
  if (mode === "cut") {
    const result = current.pairingTrustOwner(root).migrateToCapsule(options.id ?? "migration"); crash("lost-ack");
    console.log(JSON.stringify({ok: true, result}));
  } else if (mode === "old-write" || mode === "new-write") {
    const result = owner.mutate(options.revision, options.id ?? "writer", options.mutation ?? {
      type: "grant", peer: {publicKey: "a".repeat(64), pairedAt: "date"},
    }); console.log(JSON.stringify({ok: true, result}));
  } else console.log(JSON.stringify({ok: true, snapshot: owner.read()}));
} catch (error) {console.log(JSON.stringify({ok: false, error: String(error), code: (error as NodeJS.ErrnoException).code}));}
