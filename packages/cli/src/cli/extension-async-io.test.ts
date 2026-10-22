/** Whole corrected witness around the dormant production I/O candidate. */
import { expect, test } from "bun:test";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createExtensionChannelCandidate, releaseExtensionChannelCodeForWitness } from "../../../runtime/src/extension-channel-io.ts";
import { checkReclaimedDescriptors } from "./extension-descriptor-witness.ts";
import { numericWitness, type Fault, type AsyncWitnessOptions } from "../../../../scripts/extension-numeric-spike/witness.ts";
import type { DescriptorForm, WitnessEvent } from "./extension-descriptor-witness.ts";
const candidate = Bun.revision === "0d9b296af33f2b851fcbf4df3e9ec89751734ba4" && (process.platform === "darwin" && process.arch === "arm64" || process.platform === "linux" && process.arch === "x64");
const measured = candidate ? test : test.skip;
const messages: Record<Fault | "cancel-double-close", string> = {
  "stale-second-close": "reclaimed descriptor lost", "second-spawn-close": "replacement spawn descriptor lost",
  "finalizer-close": "finalizer closed runtime-owned number", mapping: "child mapping failed", eof: "child EOF failed",
  cloexec: "CLOEXEC copy discipline failed", "collection-retained": "native subprocess collection was not observed within 64 GC rounds",
  "cancel-double-close": "reclaimed descriptor lost",
};
for (const form of ["context", "credential"] as DescriptorForm[]) {
  for (const mode of [...["normal", "timeout", "cancel", "crash"], ...(form === "credential" ? ["read-timeout", "read-cancel"] : [])] as AsyncWitnessOptions["mode"][]) {
    measured(`async ${form}: whole witness, ${mode}, 64 KiB, reclaim/reuse/collection`, async () => {
      const events: WitnessEvent[] = [];
      await numericWitness(form, e => events.push(e), undefined, {io: "async", mode});
      expect(events.filter(e => e.event === "native-collected")).toHaveLength(9);
      expect(events.filter(e => e.event === "second-spawn-reuse")).toHaveLength(1);
      expect(events.filter(e => e.event === "reap-before-close-survived")).toHaveLength(1);
      expect(events.filter(e => e.event === "reclaim-check").length).toBeGreaterThanOrEqual(160);
      expect(events.every(e => e.target === (form === "context" ? 5 : 6))).toBe(true);
      const io = events.filter(e => e.event === "async-io"); expect(io).toHaveLength(9);
      for (const e of io) {
        const stats = e.stats as Record<string, number>;
        const readAbort = e.mode === "read-timeout" || e.mode === "read-cancel";
        expect(stats.peakWriteBuffer).toBe(readAbort ? 0 : 65536);
        if (e.mode !== "crash") expect(stats.yields).toBeGreaterThan(0);
        expect(stats.closeCalls).toBe(e.iteration === 8 ? 0 : 1);
        if (form === "credential") {expect(stats.peakReadBuffer).toBe(65536); expect(stats.readBytes).toBe(readAbort ? 8192 : 65536);
          if (readAbort) { expect(stats.readWouldBlock).toBeGreaterThan(0); expect(stats.writeCalls).toBe(0); }}
        if (e.mode === "timeout" || e.mode === "cancel") {
          expect(e.frameBytes as number).toBeGreaterThan(0); expect(e.frameBytes as number).toBeLessThan(65536);
          expect(stats.closeCalls).toBe(1); expect(stats.writeWouldBlock).toBeGreaterThan(0);
        }
      }
    }, 30_000);
  }
  for (const fault of Object.keys(messages) as Array<keyof typeof messages>) {
    measured(`async ${form} sensitivity: ${fault}`, async () => {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, "../../../../scripts/extension-numeric-spike/witness.ts"), form, fault, "async"], {stdin: "ignore", stdout: "pipe", stderr: "pipe", env: {PATH: process.env.PATH}});
      const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
      try {
        const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        expect(code).toBe(1); expect(stderr).toBe("");
        const failure = stdout.trim().split("\n").map(line => JSON.parse(line)).at(-1);
        expect(failure).toMatchObject({event: "failure", form, fault}); expect(failure.error).toContain(messages[fault]);
      } finally {clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited;}
    }, 30000);
  }
}

for (const retain of [false, true]) measured(`compiled helper collection ${retain ? "refuses retained wrapper" : "cannot close reclaimed endpoint numbers"}`, async () => {
  const directory = mkdtempSync(join(tmpdir(), "extension-compiler-reclaim-"));
  const seen = {collected: false, registry: null as FinalizationRegistry<number> | null, held: null as object | null};
  seen.registry = new FinalizationRegistry(() => { seen.collected = true; });
  function closedPair() {
    const channel = createExtensionChannelCandidate("credential");
    expect(() => releaseExtensionChannelCodeForWitness(() => {})).toThrow("endpoints still open");
    const former = [channel.parent.fd, channel.child.fd];
    channel.parent.close(); channel.child.close();
    releaseExtensionChannelCodeForWitness(library => { seen.registry!.register(library, 1); if (retain) seen.held = library; });
    return former;
  }
  try {
    const proof = checkReclaimedDescriptors({former: closedPair(), directory, collected: () => seen.collected});
    if (retain) await expect(proof).rejects.toThrow("collection was not observed within 64 GC rounds");
    else {await proof; expect(seen.collected).toBe(true);}
  } finally {seen.held = null; rmSync(directory, {recursive: true, force: true});}
}, 10000);
