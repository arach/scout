import { expect, test } from "bun:test";
import { mkdtempSync, openSync, closeSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkReclaimedDescriptors, runDescriptorReclaimWitness, type DescriptorForm } from "./extension-descriptor-witness.ts";

async function negative(form: DescriptorForm, fault: "stale-second-close" | "second-spawn-close", message: string) {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/extension-descriptor-negative.ts"), form, fault], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH } });
  const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code).toBe(1); expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({ schema: "scout.descriptor-negative/v1", form, fault });
    expect(JSON.parse(stdout).failure).toContain(message);
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
}

// These standard-stdio controls qualify the INSTRUMENT, never an API2 backend.
for (const form of ["context", "credential"] as DescriptorForm[]) {
  test(`reclaim instrument: ${form} standard-stdio control, eight exchanges and second-spawn reuse`, async () => {
    const events: Array<Record<string, unknown>> = [];
    await runDescriptorReclaimWitness({ form, mechanism: "standard-control", emit: event => events.push(event) });
    expect(events.filter(event => event.event === "spawn")).toHaveLength(8);
    expect(events.filter(event => event.event === "reclaim-check")).toHaveLength(64);
    expect(events.filter(event => event.event === "second-spawn-reuse")).toHaveLength(1);
    const spawns=events.filter(event=>event.event==="spawn");
    expect(events.find(event=>event.event==="second-spawn-reuse")).toMatchObject({construction:"identified-reservation-dup2",reused:spawns[0]!.ports});
    expect(events.filter(event=>event.event==="reaped"&&event.code===0)).toHaveLength(8);
    expect(events.filter(event=>event.event==="reclaim-check").every(event=>Array.isArray(event.losses)&&event.losses.length===0)).toBe(true);
    expect(events.every(event => event.target === (form === "context" ? 5 : 6))).toBe(true);
  }, 30_000);
  test(`reclaim instrument forces ${form} reuse even when unrelated files consume free numbers`, async()=>{
    const events:Array<Record<string,unknown>>=[];
    await runDescriptorReclaimWitness({form,mechanism:"standard-control",controlChurn:true,emit:e=>events.push(e)});
    const spawns=events.filter(e=>e.event==="spawn");
    expect(spawns).toHaveLength(8);
    expect(spawns.every(e=>JSON.stringify(e.ports)===JSON.stringify(spawns[0]!.ports))).toBe(true);
    expect(events.filter(e=>e.event==="reclaim-check")).toHaveLength(64);
    expect(events.filter(e=>e.event==="reaped"&&e.code===0)).toHaveLength(8);
  },30_000);
  test(`reclaim instrument catches a stale second close in ${form} form`, async () => {
    await negative(form, "stale-second-close", "reclaimed descriptor lost");
  }, 30_000);
  test(`reclaim instrument catches a stale owner closing the second ${form} spawn`, async () => {
    await negative(form, "second-spawn-close", "replacement spawn descriptor lost");
  }, 30_000);
}
test("after-context sentinel detects a recycled number closed by an earlier owner", async () => {
  const root = mkdtempSync(join(tmpdir(), "scout-reclaim-sensitivity-"));
  const old = openSync(join(root, "old"), "wx"); closeSync(old);
  try { await expect(checkReclaimedDescriptors({ former: [old], directory: root, staleClose: true })).rejects.toThrow("reclaimed descriptor lost"); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
