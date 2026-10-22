/** Product-free numeric backend spike; corrected in-tree reclaim instrument is shared. */
import { spawn } from "node:child_process";
import { closeSync, fstatSync, mkdirSync, mkdtempSync, readSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pair, flags, clearCloseOnExecForNegativeControl } from "./pair.ts";
import { createExtensionChannelCandidate, ChannelIoError } from "../../packages/runtime/src/extension-channel-io.ts";
import { checkReclaimedDescriptors, type DescriptorForm, type WitnessEvent } from "../../packages/cli/src/cli/extension-descriptor-witness.ts";
import { INHERITED_DESCRIPTOR_LAYOUTS, MAX_INHERITED_DESCRIPTOR_SLOT } from "../../packages/runtime/src/inherited-descriptors.ts";
export type AsyncWitnessOptions = { io?: "async"; mode?: "normal" | "timeout" | "cancel" | "crash" | "read-timeout" | "read-cancel" };
type AnyFault = Fault | "cancel-double-close";
type Pair = ReturnType<typeof pair> | ReturnType<typeof createExtensionChannelCandidate>;

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
  form: DescriptorForm; iteration: number; channel: Pair;
  expected: ReturnType<typeof identity>[]; previous: number[]; home: string; directory: string;
  event: (e: WitnessEvent) => void; fault?: AnyFault; options?: AsyncWitnessOptions; observe?: (native: object) => WeakRef<object>;
}) {
  const {form, iteration, channel, expected, previous, home, directory, event, fault, options, observe} = input;
  const mode = iteration === 8 ? "normal" : options?.mode ?? (fault === "cancel-double-close" ? "cancel" : "normal");
  const duplex = form === "credential", slot = INHERITED_DESCRIPTOR_LAYOUTS.extensionApi2[form];
  const reapFirst = iteration === 8, ports = [channel.parent.fd, channel.child.fd];
  let child: ReturnType<typeof spawn> | null = null;
  let exited: Promise<number | null> | undefined, deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const stdio: Array<"ignore" | "pipe" | number> = Array(MAX_INHERITED_DESCRIPTOR_SLOT + 1).fill("ignore");
    stdio[1] = "pipe"; stdio[2] = "pipe"; stdio[fault === "mapping" ? 4 : slot] = channel.child.fd;
    // fs owns ONLY the child's mapped descriptor; the parent never wraps its raw FDs.
    let script = `import{fstatSync,readSync,writeSync}from'node:fs';const slot=${slot};const s=fstatSync(slot);console.log(JSON.stringify({event:'mapped',identity:{dev:s.dev,ino:s.ino,file:s.isFile(),fifo:s.isFIFO(),socket:s.isSocket()}}));${duplex ? `writeSync(slot,'request\\n');` : ""}let wire='';const b=Buffer.alloc(64);for(;;){const n=readSync(slot,b,0,b.length,null);if(!n)break;wire+=b.subarray(0,n);if(${reapFirst}&&wire==='response\\n')break;}if(wire!=='response\\n')process.exit(91);console.log(JSON.stringify({event:${reapFirst ? "'frame'" : "'eof'"}}));`;
    if (options?.io === "async") {
      const lf = JSON.stringify("\n"), aborted = mode === "timeout" || mode === "cancel", readAbort = mode === "read-timeout" || mode === "read-cancel";
      script = `import{fstatSync,readSync,writeSync}from'node:fs';const slot=${slot};const s=fstatSync(slot);console.log(JSON.stringify({event:'mapped',identity:{dev:s.dev,ino:s.ino,file:s.isFile(),fifo:s.isFIFO(),socket:s.isSocket()}}));
      ${duplex ? `const request=Buffer.from(${readAbort ? "'q'.repeat(8192)" : "'q'.repeat(65535)+"+lf});let sent=0;while(sent<request.length)sent+=writeSync(slot,request,sent,request.length-sent);` : ""}
      ${mode === "crash" ? "process.exit(7);" : ""}
      await Bun.sleep(200);
      let wire='';const b=Buffer.alloc(4096);for(;;){const n=readSync(slot,b,0,b.length,null);if(!n)break;wire+=b.subarray(0,n);if(${reapFirst}&&wire.length===69632)break;await Bun.sleep(3);}
      if(${readAbort} ? wire!=='' : ${aborted} ? !(wire.startsWith('p'.repeat(4096))&&wire.length>4096&&wire.length<69632) : wire!=='p'.repeat(4096)+'r'.repeat(65535)+${lf})process.exit(91);
      console.log(JSON.stringify({event:${reapFirst ? "'frame'" : "'eof'"}}));`;
    }
    let nativeRef: WeakRef<object> | undefined;
    const rawSpawn = Bun.spawn;
    // Observe collection without retaining the native object as the rejected
    // retention workaround did. Restore immediately; no concurrent spawn here.
    Bun.spawn = ((...args: unknown[]) => {
      const native = Reflect.apply(rawSpawn, Bun, args);
      nativeRef = observe ? observe(native) : new WeakRef(native);
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
    if (options?.io === "async" && "write" in channel.parent) {
      const endpoint = channel.parent;
      const readAbort = mode === "read-timeout" || mode === "read-cancel";
      if (readAbort) {
        const abort = new AbortController();
        const timer = mode === "read-cancel" ? setTimeout(() => abort.abort(), 10) : undefined;
        try { await endpoint.readFrame({signal: abort.signal, timeoutMs: mode === "read-timeout" ? 30 : 2000}); throw Error("reader abort unexpectedly completed"); }
        catch (error) {
          if (!(error instanceof ChannelIoError) || error.reason !== (mode === "read-timeout" ? "timeout" : "cancelled")) throw error;
          if (!(endpoint.stats.readBytes > 0 && endpoint.stats.readBytes < 65536)) throw Error("reader abort did not happen mid-exchange");
        } finally {clearTimeout(timer);}
        if (endpoint.stats.closeCalls !== 1) throw Error("reader abort close count was not one");
        event({event: "async-io", iteration, mode, frameBytes: 0, stats: {...endpoint.stats}});
      } else {
        if (duplex) {
          const request = await endpoint.readFrame({timeoutMs: 2000});
          if (Buffer.from(request ?? []).toString() !== "q".repeat(65535) + "\n") throw Error("duplex request failed");
        }
        if (mode === "crash") { await exited; await closed; }
        // Test-only pressure primer: force an actual full pipe/socket even when
        // the kernel grows a pipe to hold one complete 64-KiB frame. No queued
        // application writes: the primer completes before the frame starts.
        if (mode !== "crash") await endpoint.write(Buffer.from("p".repeat(4096)), {timeoutMs: 2000});
        const beforeFrame = endpoint.stats.writeBytes;
        const abort = new AbortController();
        let cancel: ReturnType<typeof setTimeout> | undefined;
        if (mode === "cancel") cancel = setTimeout(() => abort.abort(), 10);
        try {
          await endpoint.write(Buffer.from("r".repeat(65535) + "\n"), {timeoutMs: mode === "timeout" ? 30 : 2000, signal: abort.signal});
          if (mode !== "normal") throw Error("abort/crash exchange unexpectedly wrote the whole frame");
        } catch (error) {
          const reason = mode === "timeout" ? "timeout" : mode === "cancel" ? "cancelled" : mode === "crash" ? "native_error" : null;
          if (!(error instanceof ChannelIoError) || !reason || error.reason !== reason) throw error;
          if (mode !== "crash" && !(endpoint.stats.writeBytes - beforeFrame > 0 && endpoint.stats.writeBytes - beforeFrame < 65536)) throw Error("abort did not happen mid-exchange");
        } finally { clearTimeout(cancel); }
        if (mode === "normal" && !reapFirst && fault !== "eof") endpoint.close();
        event({event: "async-io", iteration, mode, frameBytes: endpoint.stats.writeBytes - beforeFrame, stats: {...endpoint.stats}});
        if (mode !== "normal" && endpoint.stats.closeCalls !== 1) throw Error("abort/crash close count was not one");
      }
    } else {
      if (duplex) {
        const request = Buffer.alloc(8); const n = readSync(channel.parent.fd, request, 0, request.length, null);
        if (request.subarray(0, n).toString() !== "request\n") throw Error("duplex request failed");
      }
      writeSync(channel.parent.fd, "response\n");
      if (!reapFirst && fault !== "eof") channel.parent.close();
    }
    const code = await exited; await closed;
    if (fault === "eof" && !reapFirst && killed) throw Error("child EOF failed: retained parent writer");
    if (code !== (mode === "crash" ? 7 : 0)) throw Error(`child exchange failed ${code}: ${errors}`);
    if (mode !== "crash" && !output.includes(JSON.stringify({ event: reapFirst ? "frame" : "eof" }))) throw Error("child EOF/frame acknowledgement missing");
    return nativeRef;
  } finally {
    clearTimeout(deadline);
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
    child = null;
  }
}
async function exchanges(home: string, form: DescriptorForm, event: (e: WitnessEvent) => void, fault?: AnyFault, options?: AsyncWitnessOptions, observe?: (native: object) => WeakRef<object>) {
  let previous: number[] = [];
  const pending: Array<{iteration: number; ref: WeakRef<object>}> = [];
  // Eight EOF exchanges plus an independent reap-before-parent-close intervention.
  for (let iteration = 0; iteration < 9; iteration++) {
    const reapFirst = iteration === 8, channel = options?.io === "async" ? createExtensionChannelCandidate(form) : pair(form === "credential");
    const ports = [channel.parent.fd, channel.child.fd], expected = ports.map(identity);
    const directory = join(home, String(iteration)); mkdirSync(directory);
    let handedOff = false;
    try {
      if (fault === "cloexec") clearCloseOnExecForNegativeControl(channel.child.fd);
      if (ports.some(fd => fd <= MAX_INHERITED_DESCRIPTOR_SLOT || flags(fd) !== 1)) throw Error("CLOEXEC copy discipline failed");
      event({ event: "copy-discipline", iteration, ports, flags: ports.map(flags), ceiling: MAX_INHERITED_DESCRIPTOR_SLOT });
      if ("nonblocking" in channel && channel.nonblocking() !== 1) throw Error("parent endpoint was not nonblocking");
      const ref = await exchange({form, iteration, channel, expected, previous, home, directory, event, fault, options, observe});
      pending.push({iteration, ref});
      // Return the last runtime-owned endpoint STILL OPEN. The entire spawn and
      // loop stack has unwound before its native collection is required below.
      if (reapFirst) { handedOff = true; return {pending, channel, ports, expected}; }
      const reclaimed = join(directory, "parent"); mkdirSync(reclaimed);
      await checkReclaimedDescriptors({ former: fault === "cancel-double-close" ? [ports[0]!] : ports, directory: reclaimed, staleClose: fault === "stale-second-close" || fault === "cancel-double-close", emit: e => event({ iteration, phase: "parent-close", ...e }) });
      event({event: "exchange", iteration, mode: options?.mode ?? (fault === "cancel-double-close" ? "cancel" : "eof"), parent: ports[0], source: ports[1], code: 0});
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
export async function numericWitness(form: DescriptorForm, emit: (e: WitnessEvent) => void = () => {}, fault?: AnyFault, options?: AsyncWitnessOptions) {
  if (Bun.revision !== "0d9b296af33f2b851fcbf4df3e9ec89751734ba4") throw Error("numeric spike requires the exact candidate Bun revision");
  const home = mkdtempSync(join(tmpdir(), "scout-numeric-"));
  const event = (e: WitnessEvent) => emit({ io: options?.io ?? "blocking-spike", mode: options?.mode ?? "normal", form, target: INHERITED_DESCRIPTOR_LAYOUTS.extensionApi2[form], ...e });
  let last: Awaited<ReturnType<typeof exchanges>> | undefined;
  // Polling WeakRef.deref can itself keep the target alive until the end of a
  // job. The async witness observes collection without touching its targets.
  const tracker = {seen: new Set<WeakRef<object>>(), registry: null as FinalizationRegistry<WeakRef<object>> | null};
  tracker.registry = new FinalizationRegistry(ref => tracker.seen.add(ref));
  const observe = (native: object) => { const ref = new WeakRef(native); tracker.registry!.register(native, ref); return ref; };
  try {
    last = await exchanges(home, form, event, fault, options, options?.io === "async" ? observe : undefined);
    if (fault === "finalizer-close") closeSync(last.channel.parent.fd);
    // Reclaim the numeric SOURCE before collecting the last native subprocess;
    // otherwise a late close of that number could happen while it has no victim.
    const sourceVictim = join(home, "last-source"); mkdirSync(sourceVictim);
    let collectionRounds = 0;
    try {
      await checkReclaimedDescriptors({former: [last.ports[1]!], directory: sourceVictim, collected: () => last!.pending.every(entry => options?.io === "async" ? tracker.seen.has(entry.ref) : entry.ref.deref() === undefined), emit: e => {
        if (e.event === "collection-observed") collectionRounds = e.gcRounds as number;
        event({phase: "reap-first-source-victim", ...e});
      }});
    } catch (error) {
      event({event: "collection-incomplete", observations: last.pending.map(entry => ({iteration: entry.iteration, callback: tracker.seen.has(entry.ref), alive: entry.ref.deref() !== undefined}))});
      // Diagnostic only, AFTER the witness has refused. A fresh macrotask ends
      // deref's keepalive job; snapshotting must not create an observer pin.
      const snapshot = process.env.SCOUT_DESCRIPTOR_HEAP_SNAPSHOT;
      if (snapshot) {
        await Bun.sleep(0);
        await Bun.write(snapshot, JSON.stringify(Bun.generateHeapSnapshot()));
        event({event: "retainer-snapshot", path: snapshot, classification: "unclassified"});
      }
      throw error;
    }
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
    event({event: "complete", eofExchanges: options?.mode && options.mode !== "normal" || fault === "cancel-double-close" ? 0 : 8, modeExchanges: 8, reapFirstExchanges: 1, reuse: true});
  } finally {
    if (last && same(last.channel.parent.fd, last.expected[0]!)) last.channel.parent.close();
    retainedForNegativeControl = undefined;
    rmSync(home, {recursive: true, force: true});
  }
}
if (import.meta.main) {
  const form = process.argv[2] as DescriptorForm, fault = (process.argv[3] === "none" ? undefined : process.argv[3]) as AnyFault | undefined;
  const options: AsyncWitnessOptions | undefined = process.argv[4] === "async" ? {io: "async", mode: process.argv[5] as AsyncWitnessOptions["mode"]} : undefined;
  if (form !== "context" && form !== "credential") throw Error("choose context or credential");
  console.log(JSON.stringify({ event: "host", platform: process.platform, arch: process.arch, version: Bun.version, revision: Bun.revision, requestedDfgJit: process.env.BUN_JSC_useDFGJIT ?? "default" }));
  try { await numericWitness(form, e => console.log(JSON.stringify(e)), fault, options); }
  catch (error) { console.log(JSON.stringify({ event: "failure", form, fault, error: String(error) })); process.exitCode = 1; }
}
