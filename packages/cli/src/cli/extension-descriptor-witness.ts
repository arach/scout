/** Test apparatus, not a transport or a qualification predicate. Never imported by the runner. */
import { spawn } from "node:child_process";
import { closeSync, fstatSync, mkdirSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex, Writable } from "node:stream";
import { INHERITED_DESCRIPTOR_LAYOUTS, MAX_INHERITED_DESCRIPTOR_SLOT } from "@openscout/runtime/inherited-descriptors";

type Identity = { dev: number; ino: number; file: boolean; socket: boolean; fifo: boolean };
export type DescriptorForm = "context" | "credential";
export type WitnessEvent = Record<string, unknown>;
function identity(fd: number): Identity | null {
  try { const s = fstatSync(fd); return { dev: s.dev, ino: s.ino, file: s.isFile(), socket: s.isSocket(), fifo: s.isFIFO() }; }
  catch { return null; }
}
function same(a: Identity | null, b: Identity | null) {
  return a !== null && b !== null && a.dev === b.dev && a.ino === b.ino && a.file === b.file && a.socket === b.socket && a.fifo === b.fifo;
}
function census() { return Array.from({ length: 2048 }, (_, fd) => identity(fd)); }

/** Open AFTER teardown, including the former pipe numbers; never close a recycled non-owned FD. */
export async function checkReclaimedDescriptors(input: {
  former: number[]; directory: string; emit?: (event: WitnessEvent) => void; staleClose?: boolean;
  // Optional bounded finalizer observation: keep the reclaimed victims OPEN
  // until collection is observed, rather than assuming GC rounds imply it.
  collected?: () => boolean;
}) {
  const files: Array<{ fd: number; identity: Identity }> = [];
  try {
    const target = Math.max(0, ...input.former);
    for (let n = 0; n < 256; n++) {
      const fd = openSync(join(input.directory, `probe-${n}`), "wx");
      files.push({ fd, identity: identity(fd)! });
      // A sentinel with no qualified backend samples fresh numbers, not a pre-opened bystander.
      if (input.former.length ? fd > target + 8 : files.length >= 128) break;
    }
    if (input.former.some(fd => !files.some(file => file.fd === fd))) throw Error("former pipe number was not reclaimed");
    input.emit?.({ event: "reclaimed", former: input.former, files });
    if (input.staleClose) closeSync(files.find(file => input.former.includes(file.fd))!.fd);
    for (let round = 0; round < (input.collected ? 64 : 8); round++) {
      Bun.gc(true); await Bun.sleep(5);
      const losses = files.filter(file => !same(file.identity, identity(file.fd)));
      input.emit?.({ event: "reclaim-check", round, losses });
      if (losses.length) throw Error(`reclaimed descriptor lost: ${losses.map(file => file.fd).join(",")}`);
      if (round >= 7 && input.collected?.()) {
        input.emit?.({event: "collection-observed", gcRounds: round + 1});
        return;
      }
    }
    if (input.collected) throw Error("native subprocess collection was not observed within 64 GC rounds");
  } finally {
    for (const file of files) if (same(file.identity, identity(file.fd))) closeSync(file.fd);
  }
}

/** Eight sequential exchanges, with fresh-file reclaim AND GC during a second spawn reusing a number.
 * standard-control exercises the instrument only (stdin/stdout); node-extra-record measures the
 * rejected mechanism at the registry's actual context5/credential6 targets, never the product gate.
 */
export async function runDescriptorReclaimWitness(input: {
  form: DescriptorForm; mechanism: "standard-control" | "node-extra-record";
  emit?: (event: WitnessEvent) => void; fault?: "stale-second-close" | "second-spawn-close";
}) {
  const home = mkdtempSync(join(tmpdir(), "scout-descriptor-reclaim-"));
  const failures: string[] = []; let previous: number[] = [], reuse = false, exchanges = 0;
  const slot = INHERITED_DESCRIPTOR_LAYOUTS.extensionApi2[input.form === "context" ? "context" : "credential"];
  const raw = input.mechanism === "node-extra-record", duplex = input.form === "credential";
  const emit = (event: WitnessEvent) => input.emit?.({ form: input.form, mechanism: input.mechanism, target: slot, ...event });
  try {
    for (let iteration = 0; iteration < 8; iteration++) {
      const before = census();
      const stdio: Array<"pipe" | "ignore" | "inherit"> = raw ? Array(MAX_INHERITED_DESCRIPTOR_SLOT + 1).fill("ignore") : ["pipe", duplex ? "pipe" : "ignore", "inherit"];
      if (raw) { stdio[0] = stdio[1] = stdio[2] = "inherit"; stdio[slot] = "pipe"; }
      const readSlot = raw ? slot : 0, writeSlot = raw ? slot : 1;
      const script = `import{createReadStream,writeSync}from'node:fs';${duplex ? `writeSync(${writeSlot},'request\\n');` : ""}let wire='';for await(const part of createReadStream(null,{fd:${readSlot},autoClose:true}))wire+=part;if(wire!=='response\\n')process.exit(91);`;
      let child: ReturnType<typeof spawn> | null = spawn(process.execPath, ["-e", script], { stdio, env: { HOME: home, PATH: process.env.PATH } });
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done, reject) => {
        child!.once("exit", (code, signal) => done({ code, signal })); child!.once("error", reject);
      });
      let channel = (child.stdio as unknown[])[raw ? slot : 0] as Writable | null;
      let reader = duplex ? (child.stdio as unknown[])[raw ? slot : 1] as Duplex | null : null;
      const after = census();
      const ports = raw ? [(channel as unknown as { _handle?: { fd?: number } })?._handle?.fd].filter((fd): fd is number => Number.isInteger(fd))
        : after.flatMap((value, fd) => fd > 2 && value && (value.fifo || value.socket) && !same(before[fd], value) ? [fd] : []);
      const active = ports.map(fd => ({ fd, identity: identity(fd) }));
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("exchange deadline")), 5000); });
      let request = "";
      emit({ event: "spawn", iteration, pid: child.pid, ports, active });
      try {
        if (!channel || ports.length === 0) throw Error("mechanism did not expose an identifiable parent descriptor");
        channel.on("error", () => {}); reader?.on("error", () => {});
        const reused = ports.filter(fd => previous.includes(fd));
        if (iteration === 1 && reused.length === 0) throw Error("second spawn did not reuse a former descriptor number");
        if (iteration === 1) {
          reuse = true; emit({ event: "second-spawn-reuse", iteration, reused });
          if (input.fault === "second-spawn-close") closeSync(reused[0]!);
        }
        // Exercise stale ownership while the replacement child is still using the same number.
        Bun.gc(true); await Bun.sleep(5); Bun.gc(true);
        if (active.some(port => !same(port.identity, identity(port.fd)))) throw Error("replacement spawn descriptor lost");
        if (duplex) reader!.on("data", chunk => {
          request += chunk;
          if (request === "request\n") channel!.end("response\n", () => channel!.destroy());
        });
        else channel.end("response\n", () => channel!.destroy());
        const status = await Promise.race([exited, deadline]);
        emit({ event: "reaped", iteration, ...status, request });
        if (status.code !== 0 || duplex && request !== "request\n") throw Error(`exchange failed: ${JSON.stringify(status)}`);
      } catch (error) { failures.push(`exchange${iteration}: ${String(error)}`); }
      finally {
        clearTimeout(timer); channel?.destroy(); reader?.destroy();
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await exited; child = null; channel = null; reader = null;
      }
      const directory = join(home, String(iteration));
      // mkdir is deferred until after teardown, before reclaim; no GC occurs in between.
      mkdirSync(directory);
      try { await checkReclaimedDescriptors({ former: ports, directory, emit: event => emit({ iteration, ...event }), staleClose: input.fault === "stale-second-close" }); }
      catch (error) { failures.push(`reclaim${iteration}: ${String(error)}`); }
      finally { rmSync(directory, { recursive: true, force: true }); }
      previous = ports; exchanges++;
    }
    if (!reuse) failures.push("second-spawn reuse was not demonstrated");
    if (exchanges !== 8) failures.push("eight exchanges were not completed");
    emit({ event: "complete", exchanges, reuse, failures });
    if (failures.length) throw Error(failures.join("; "));
  } finally { rmSync(home, { recursive: true, force: true }); }
}
