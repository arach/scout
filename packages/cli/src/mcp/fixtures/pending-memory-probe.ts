/** Loaded only into the owned MCP child by the opt-in pending-work test. */
import { heapStats } from "bun:jsc";
import { readFileSync, statfsSync, writeFileSync } from "node:fs";
const directory = process.env.OWNED_MCP_PENDING_PROBE!;
process.on("SIGUSR2", () => { void collect(); });
async function collect() {
  const disk = statfsSync(process.platform === "darwin" ? "/System/Volumes/Data" : directory);
  if (disk.bavail * disk.bsize < 3 * 1024 ** 3) throw Error("pending soak disk guard: below 3 GiB");
  const command = JSON.parse(readFileSync(`${directory}/command.json`, "utf8")) as { label: string; snapshot: boolean };
  const df = Bun.spawn(["df", "-h", process.platform === "darwin" ? "/System/Volumes/Data" : directory], { stdout: "pipe", stderr: "ignore" });
  console.error(await new Response(df.stdout).text()); await df.exited;
  Bun.gc(true);
  const heap = heapStats();
  let footprint: string | null = null;
  if (process.platform === "darwin") {
    const child = Bun.spawn(["vmmap", "-summary", String(process.pid)], { stdout: "pipe", stderr: "ignore" });
    const output = await new Response(child.stdout).text(); await child.exited;
    footprint = output.match(/^Physical footprint:\s*(.+)$/m)?.[1] ?? null;
  }
  if (command.snapshot) writeFileSync(`${directory}/${command.label}.heapsnapshot`, Bun.generateHeapSnapshot("v8"));
  console.error(JSON.stringify({ event: "pending-soak-sample", label: command.label, heap, footprint, memory: process.memoryUsage() }));
}
