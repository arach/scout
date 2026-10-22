/** Candidate measurements, NOT backend qualification; the product gate stays false. */
import { expect, test } from "bun:test";
import { join } from "node:path";
import { numericWitness, type Fault } from "../../../../scripts/extension-numeric-spike/witness.ts";
import type { DescriptorForm, WitnessEvent } from "./extension-descriptor-witness.ts";
const candidate = Bun.revision === "0d9b296af33f2b851fcbf4df3e9ec89751734ba4" && ["darwin", "linux"].includes(process.platform);
const measured = candidate ? test : test.skip;
const messages: Record<Fault, string> = {
  "stale-second-close": "reclaimed descriptor lost",
  "second-spawn-close": "replacement spawn descriptor lost",
  "finalizer-close": "finalizer closed runtime-owned number",
  mapping: "child mapping failed",
  eof: "child EOF failed",
  cloexec: "CLOEXEC copy discipline failed",
  "collection-retained": "native subprocess collection was not observed within 64 GC rounds",
};
for (const form of ["context", "credential"] as DescriptorForm[]) {
  measured(`numeric candidate ${form}: EOF, reclaim, collection, copy discipline and reuse`, async () => {
    const events: WitnessEvent[] = [];
    await numericWitness(form, event => events.push(event));
    expect(events.filter(e => e.event === "exchange" && e.mode === "eof")).toHaveLength(8);
    expect(events.filter(e => e.event === "reap-before-close-survived")).toHaveLength(1);
    expect(events.filter(e => e.event === "reclaim-check").length).toBeGreaterThanOrEqual(160);
    expect(events.filter(e => e.event === "native-collected")).toHaveLength(9);
    expect(events.filter(e => e.event === "collection-observed")).toHaveLength(1);
    expect(events.filter(e => e.event === "live-copy-survived")).toHaveLength(9);
    expect(events.filter(e => e.event === "second-spawn-reuse")).toHaveLength(1);
    expect(events.every(e => e.target === (form === "context" ? 5 : 6))).toBe(true);
  }, 30_000);
  for (const fault of Object.keys(messages) as Fault[]) {
    measured(`numeric ${form} sensitivity: ${fault}`, async () => {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, "../../../../scripts/extension-numeric-spike/witness.ts"), form, fault], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH } });
      const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
      try {
        const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        expect(code).toBe(1); expect(stderr).toBe("");
        const failure = stdout.trim().split("\n").map(line => JSON.parse(line)).at(-1);
        expect(failure).toMatchObject({ event: "failure", form, fault });
        expect(failure.error).toContain(messages[fault]);
      } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
    }, 30_000);
  }
}
