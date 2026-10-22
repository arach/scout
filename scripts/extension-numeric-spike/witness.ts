/** Product-free numeric backend spike; corrected in-tree reclaim instrument is shared. */
import { spawn } from "node:child_process";
import { closeSync, fstatSync, mkdirSync, mkdtempSync, readSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pair, flags, clearCloseOnExecForNegativeControl } from "./pair.ts";
import { checkReclaimedDescriptors, type DescriptorForm, type WitnessEvent } from "../../packages/cli/src/cli/extension-descriptor-witness.ts";
import { INHERITED_DESCRIPTOR_LAYOUTS, MAX_INHERITED_DESCRIPTOR_SLOT } from "../../packages/runtime/src/inherited-descriptors.ts";

export type Fault = "stale-second-close" | "second-spawn-close" | "finalizer-close" | "mapping" | "eof" | "cloexec" | "collection-retained";
let retainedForNegativeControl: object | undefined;
function identity(fd: number) {
  try { const s = fstatSync(fd); return { dev: s.dev, ino: s.ino, file: s.isFile(), fifo: s.isFIFO(), socket: s.isSocket() }; } catch { return null; }
}
function same(fd: number, expected: ReturnType<typeof identity>) { return expected !== null && JSON.stringify(identity(fd)) === JSON.stringify(expected); }
async function gc() { for (let n = 0; n < 8; n++) { Bun.gc(true); await Bun.sleep(5); } }
/** Keep the entire spawn frame out of the reclaim caller's stack. A weak
 * reference is the only subprocess observation allowed to escape this helper. */
async function exchange(input: {
  form: DescriptorForm; iteration: number; channel: ReturnType<typeof pair>;
  expected: ReturnType<typeof identity>[]; previous: number[]; home: string; directory: string;
  event: (e: WitnessEvent) => void; fault?: Fault;
}) {
  const {form, iteration, channel, expected, previous, home, directory, event, fault} = input;
  const duplex = form === "credential", slot = INHERITED_DESCRIPTOR_LAYOUTS.extensionApi2[form];
  const reapFirst = iteration === 8, ports = [channel.parent.fd, channel.child.fd];
  let child: ReturnType<typeof spawn> | null = null;
  let exited: Promise<number | null> | undefined, deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const stdio: Array<"ignore" | "pipe" | number> = Array(MAX_INHERITED_DESCRIPTOR_SLOT + 1).fill("ignore");
    stdio[1] = "pipe"; stdio[2] = "pipe"; stdio[fault === "mapping" ? 4 : slot] = channel.child.fd;
    // fs owns ONLY the child's mapped descriptor; the parent never wraps its raw FDs.
    const script = `import{fstatSync,readSync,writeSync}from'node:fs';const slot=${slot};const s=fstatSync(slot);console.log(JSON.stringify({event:'mapped',identity:{dev:s.dev,ino:s.ino,file:s.isFile(),fifo:s.isFIFO(),socket:s.isSocket()}}));${duplex ? `writeSync(slot,'request\\n');` : ""}let wire='';const b=Buffer.alloc(64);for(;;){const n=readSync(slot,b,0,b.length,null);if(!n)break;wire+=b.subarray(0,n);if(${reapFirst}&&wire==='response\\n')break;}if(wire!=='response\\n')process.exit(91);console.log(JSON.stringify({event:${reapFirst ? "'frame'" : "'eof'"}}));`;
    let nativeRef: WeakRef<object> | undefined;
    const rawSpawn = Bun.spawn;
    // Observe collection without retaining the native object as the rejected
    // retention workaround did. Restore immediately; no concurrent spawn here.
    Bun.spawn = ((...args: unknown[]) => {
      const native = Reflect.apply(rawSpawn, Bun, args);
      nativeRef = new WeakRef(native);
      if (fault === "collection-retained") retainedForNegativeControl = native;
      return native;
    }) as typeof Bun.spawn;
    try { child = spawn(process.execPath, ["-e", script], { stdio, env: { HOME: home, PATH: process.env.PATH } }); }
    finally { Bun.spawn = rawSpawn; }
    if (!nativeRef) throw Error("native subprocess was not observed");
    exited = new Promise<number | null>((done, reject) => { child!.once("exit", done); child!.once("error", reject); });
    let output = "", errors = "";
    child.stdout!.on("data", data => { output += data; }); child.stderr!.on("data", data => { errors += data; });
    const closed = new Promise<void>(done => child!.once("close", () => done()));
    let killed = false;
    deadline = setTimeout(() => { killed = true; child?.kill("SIGKILL"); }, 3000);
    // Numeric source remains owned here; spawn must neither consume nor close it.
    if (!same(channel.child.fd, expected[1])) throw Error("spawn consumed numeric source");
    channel.child.close(); // Immediately after spawn and source identity check, before any await.
    if (iteration === 1) {
      const reused = [channel.parent.fd].filter(fd => previous.includes(fd));
      if (!reused.length) throw Error("second spawn did not reuse a former descriptor number");
      event({ event: "second-spawn-reuse", reused });
      if (fault === "second-spawn-close") closeSync(reused[0]!);
    }
    await gc();
    if (!same(channel.parent.fd, expected[0]!)) throw Error("replacement spawn descriptor lost");
    event({ event: "live-copy-survived", iteration, parent: channel.parent.fd, gcRounds: 8 });
    // The mapping source's reclaimed number is challenged while the child is active.
    await checkReclaimedDescriptors({ former: [ports[1]!], directory, emit: e => event({ iteration, phase: "source-close", ...e }) });
    const until = Date.now() + 3000;
    while (!output.includes("\n") && child.exitCode === null && Date.now() < until) await Bun.sleep(5);
    const mapped = output.split("\n").filter(Boolean).map(line => JSON.parse(line)).find(e => e.event === "mapped");
    if (!mapped || JSON.stringify(mapped.identity) !== JSON.stringify(expected[1])) throw Error(`child mapping failed: ${errors}`);
    event({ event: "mapping", iteration, source: ports[1], identity: mapped.identity });
    if (duplex) {
      const request = Buffer.alloc(8); const n = readSync(channel.parent.fd, request, 0, request.length, null);
      if (request.subarray(0, n).toString() !== "request\n") throw Error("duplex request failed");
    }
    writeSync(channel.parent.fd, "response\n");
    if (!reapFirst && fault !== "eof") channel.parent.close();
    const code = await exited; await closed;
    if (fault === "eof" && !reapFirst && killed) throw Error("child EOF failed: retained parent writer");
    if (code !== 0) throw Error(`child exchange failed ${code}: ${errors}`);
    if (!output.includes(JSON.stringify({ event: reapFirst ? "frame" : "eof" }))) throw Error("child EOF/frame acknowledgement missing");
    return nativeRef;
  } finally {
    clearTimeout(deadline);
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
    child = null;
  }
}
async function exchanges(home: string, form: DescriptorForm, event: (e: WitnessEvent) => void, fault?: Fault) {
  let previous: number[] = [];
  const pending: Array<{iteration: number; ref: WeakRef<object>}> = [];
  // Eight EOF exchanges plus an independent reap-before-parent-close intervention.
  for (let iteration = 0; iteration < 9; iteration++) {
    const reapFirst = iteration === 8, channel = pair(form === "credential");
    const ports = [channel.parent.fd, channel.child.fd], expected = ports.map(identity);
    const directory = join(home, String(iteration)); mkdirSync(directory);
    let handedOff = false;
    try {
      if (fault === "cloexec") clearCloseOnExecForNegativeControl(channel.child.fd);
      if (ports.some(fd => fd <= MAX_INHERITED_DESCRIPTOR_SLOT || flags(fd) !== 1)) throw Error("CLOEXEC copy discipline failed");
      event({ event: "copy-discipline", iteration, ports, flags: ports.map(flags), ceiling: MAX_INHERITED_DESCRIPTOR_SLOT });
      const ref = await exchange({form, iteration, channel, expected, previous, home, directory, event, fault});
      pending.push({iteration, ref});
      // Return the last runtime-owned endpoint STILL OPEN. The entire spawn and
      // loop stack has unwound before its native collection is required below.
      if (reapFirst) { handedOff = true; return {pending, channel, ports, expected}; }
      const reclaimed = join(directory, "parent"); mkdirSync(reclaimed);
      await checkReclaimedDescriptors({ former: ports, directory: reclaimed, staleClose: fault === "stale-second-close", emit: e => event({ iteration, phase: "parent-close", ...e }) });
      event({event: "exchange", iteration, mode: "eof", parent: ports[0], source: ports[1], code: 0});
    } finally {
      // Faults run only in isolated processes. Never close a recycled number.
      if (!handedOff && same(channel.parent.fd, expected[0]!)) channel.parent.close();
      if (same(channel.child.fd, expected[1]!)) channel.child.close();
      rmSync(directory, { recursive: true, force: true });
    }
    previous = ports;
  }
  throw Error("missing reap-first exchange");
}
export async function numericWitness(form: DescriptorForm, emit: (e: WitnessEvent) => void = () => {}, fault?: Fault) {
  if (Bun.revision !== "0d9b296af33f2b851fcbf4df3e9ec89751734ba4") throw Error("numeric spike requires the exact candidate Bun revision");
  const home = mkdtempSync(join(tmpdir(), "scout-numeric-"));
  const event = (e: WitnessEvent) => emit({ form, target: INHERITED_DESCRIPTOR_LAYOUTS.extensionApi2[form], ...e });
  let last: Awaited<ReturnType<typeof exchanges>> | undefined;
  try {
    last = await exchanges(home, form, event, fault);
    if (fault === "finalizer-close") closeSync(last.channel.parent.fd);
    // Reclaim the numeric SOURCE before collecting the last native subprocess;
    // otherwise a late close of that number could happen while it has no victim.
    const sourceVictim = join(home, "last-source"); mkdirSync(sourceVictim);
    let collectionRounds = 0;
    await checkReclaimedDescriptors({former: [last.ports[1]!], directory: sourceVictim, collected: () => last!.pending.every(entry => entry.ref.deref() === undefined), emit: e => {
      if (e.event === "collection-observed") collectionRounds = e.gcRounds as number;
      event({phase: "reap-first-source-victim", ...e});
    }});
    if (!same(last.channel.parent.fd, last.expected[0]!)) throw Error("finalizer closed runtime-owned number");
    for (const entry of last.pending) {
      if (entry.ref.deref() !== undefined) throw Error(`native subprocess was not collected: ${entry.iteration}`);
      event({event: "native-collected", iteration: entry.iteration});
    }
    event({event: "reap-before-close-survived", iteration: 8, parent: last.ports[0], gcRounds: collectionRounds});
    last.channel.parent.close();
    const reclaimed = join(home, "last-parent"); mkdirSync(reclaimed);
    await checkReclaimedDescriptors({former: last.ports, directory: reclaimed, emit: e => event({iteration: 8, phase: "parent-close", ...e})});
    event({event: "exchange", iteration: 8, mode: "reap-first", parent: last.ports[0], source: last.ports[1], code: 0});
    const final = join(home, "final"); mkdirSync(final);
    await checkReclaimedDescriptors({former: last.ports, directory: final, emit: e => event({phase: "all-native-finalized", ...e})});
    event({event: "complete", eofExchanges: 8, reapFirstExchanges: 1, reuse: true});
  } finally {
    if (last && same(last.channel.parent.fd, last.expected[0]!)) last.channel.parent.close();
    retainedForNegativeControl = undefined;
    rmSync(home, {recursive: true, force: true});
  }
}
if (import.meta.main) {
  const form = process.argv[2] as DescriptorForm, fault = process.argv[3] as Fault | undefined;
  if (form !== "context" && form !== "credential") throw Error("choose context or credential");
  console.log(JSON.stringify({ event: "host", platform: process.platform, arch: process.arch, version: Bun.version, revision: Bun.revision }));
  try { await numericWitness(form, e => console.log(JSON.stringify(e)), fault); }
  catch (error) { console.log(JSON.stringify({ event: "failure", form, fault, error: String(error) })); process.exitCode = 1; }
}
