/** Whole corrected witness around the dormant production I/O candidate. */
import { expect, test } from "bun:test";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createExtensionChannelCandidate, releaseExtensionChannelCodeForWitness } from "../../../runtime/src/extension-channel-io.ts";
import { checkReclaimedDescriptors } from "./extension-descriptor-witness.ts";
import { APPARATUS_MESSAGES } from "../../../../scripts/extension-numeric-spike/apparatus-contract.ts";
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
      try { await numericWitness(form, e => events.push(e), undefined, {io: "async", mode}); }
      catch (error) {
        // Keep the refusal. The test reporter otherwise discards the witness's
        // collection observations, making a VM pin indistinguishable from a
        // late finalization callback or a descriptor-identity loss in CI logs.
        console.error(JSON.stringify({event: "async-positive-refused", form, mode,
          version: Bun.version, revision: Bun.revision, platform: process.platform, arch: process.arch,
          apparatus: events.filter(e=>e.event==="reservation-startup"||String(e.event).startsWith("reservation-")||String(e.event).startsWith("setup-")),
          collection: events.filter(e => e.event === "collection-incomplete"),
          ports: events.filter(e => e.event === "copy-discipline"),
          reuse: events.filter(e => e.event === "second-spawn-reuse"),
          reclaimChecks: events.filter(e => e.event === "reclaim-check").length,
          losses: events.filter(e => e.event === "reclaim-check" && (e.losses as unknown[]).length),
        }));
        throw error;
      }
      console.log(JSON.stringify({event:"async-positive-receipt",form,mode,events}));
      expect(events.filter(e => e.event === "reservation-placement")).toHaveLength(9);
      expect(events.filter(e => e.event === "setup-frame-unwound" && e.pinCleared === true)).toHaveLength(9);
      expect(events.filter(e => e.event === "close-to-victim")).toHaveLength(18);
      expect(events.filter(e => e.event === "native-collected")).toHaveLength(9);
      expect(events.filter(e => e.event === "second-spawn-reuse")).toHaveLength(1);
      expect(events.filter(e => e.event === "reap-before-close-survived")).toHaveLength(1);
      expect(events.filter(e => e.event === "reclaim-check").length).toBeGreaterThanOrEqual(160);
      expect(events.every(e => e.target === (form === "context" ? 5 : 6))).toBe(true);
      const io = events.filter(e => e.event === "async-io"); expect(io).toHaveLength(9);
      if (form === "context" && (mode === "timeout" || mode === "cancel")) {
        const pressure = events.filter(e => e.event === "pressure-fill");
        const held = events.filter(e => e.event === "pressure-held");
        expect(pressure).toHaveLength(8); expect(held).toHaveLength(8);
        for (const e of pressure) {
          expect(e.blocked).toBe(true); expect(e.primerBytes as number).toBeGreaterThanOrEqual(4096);
          expect(e.primerBytes as number).toBeLessThan(1024 * 1024); expect(e.drainQuota).toBe(4096);
        }
        for (const e of held) expect(e.drainedBytes).toBe(4096);
      }
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
          if (form === "context") expect(e.frameBytes).toBe(4096);
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
        console.log(JSON.stringify({event:"async-sensitivity-receipt",form,fault,code,stdout,stderr}));
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

// Extend the original 28 identities; every intervention executes a real syscall
// or keeps a real identified descriptor/object alive in its isolated process.
for(const form of ["context","credential"] as const) {
  measured(`async ${form} apparatus: above-frontier-churn`,async()=>{
    const events:WitnessEvent[]=[];
    await numericWitness(form,e=>events.push(e),undefined,{io:"async",mode:"normal",apparatus:"above-frontier-churn"});
    console.log(JSON.stringify({event:"apparatus-positive-receipt",form,control:"above-frontier-churn",events}));
    expect(events.filter(e=>e.event==="above-frontier-churn")).toHaveLength(9);
    for(const e of events.filter(e=>e.event==="above-frontier-churn")) expect(e.fd as number).toBeGreaterThan(128);
    expect(events.filter(e=>e.event==="native-collected")).toHaveLength(9);
    expect(events.filter(e=>e.event==="reclaim-check").length).toBeGreaterThanOrEqual(160);
    expect(events.filter(e=>e.event==="second-spawn-reuse")).toHaveLength(1);
    expect(events.filter(e=>e.event==="setup-frame-unwound"&&e.pinCleared===true)).toHaveLength(9);
  },30000);
  for(const [control,message] of Object.entries(APPARATUS_MESSAGES)) measured(`async ${form} apparatus: ${control}`,async()=>{
    const child=Bun.spawn([process.execPath,join(import.meta.dir,"../../../../scripts/extension-numeric-spike/witness.ts"),form,"none","async","normal",control],
      {stdin:"ignore",stdout:"pipe",stderr:"pipe",env:{PATH:process.env.PATH}});
    const timer=setTimeout(()=>child.kill("SIGKILL"),20000);
    try {
      const [out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
      console.log(JSON.stringify({event:"apparatus-control-receipt",form,control,code,stdout:out,stderr:err}));
      expect(code).toBe(1);expect(err).toBe("");
      const events=out.trim().split("\n").map(line=>JSON.parse(line));
      expect(events.at(-1)).toMatchObject({event:"failure",form,error:`Error: ${message}`});
      const intervention=({"suppressed-close":"source-close-suppressed","occupied-parent":"reservation-allocation-observed",
        "released-guard":"guard-released","reservation-stale-close":"reservation-stale-close","retained-setup-pin":"setup-pin-escaped","low-prefix-interference":"prefix-interference-planted","compile-residue":"compile-residue-planted"} as const)[control as keyof typeof APPARATUS_MESSAGES];
      const observed=events.find(e=>e.event===intervention && (["suppressed-close","low-prefix-interference","compile-residue"].includes(control)||e.iteration===1));
      expect(observed).toBeDefined();
      if(control==="occupied-parent") {
        expect(observed.occupied).toBe(true);
        expect(observed.ports[0]).not.toBe(observed.slots[3]);
      }
      if(control==="retained-setup-pin") {
        expect(observed.count).toBeGreaterThan(0);expect(observed.seedCleared).toBe(true);
        expect(events.some(e=>e.event==="setup-control-seed-cleared"&&e.iteration===1)).toBe(true);
        expect(events.find(e=>e.event==="collection-incomplete").observations).toHaveLength(9);
        expect(events.find(e=>e.event==="collection-incomplete").observations[0]).toMatchObject({iteration:0,alive:true,callback:false});
      }
    } finally {clearTimeout(timer);if(child.exitCode===null)child.kill("SIGKILL");await child.exited;}
  },30000);
}

test("compile-only preparation: zero pairs/endpoints, idempotent, no facade exposure",async()=>{
  const child=Bun.spawn([process.execPath,join(import.meta.dir,"../../../../scripts/extension-numeric-spike/prepare-contract.ts")],{stdin:"ignore",stdout:"pipe",stderr:"pipe",env:{PATH:process.env.PATH}});
  const timer=setTimeout(()=>child.kill("SIGKILL"),10000);
  try {
    const [out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
    expect(code).toBe(0);expect(err).toBe("");
    expect(JSON.parse(out)).toMatchObject({event:"prepare-contract",compiles:1,pairs:0,endpoints:0,idempotent:true,productionCallers:0});
  }finally{clearTimeout(timer);if(child.exitCode===null)child.kill("SIGKILL");await child.exited;}
},15000);
