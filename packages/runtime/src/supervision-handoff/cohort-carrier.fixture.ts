import { closeSync, createReadStream, existsSync, fstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ChildRoleCustody, EFFECT_EXCLUSION_CAPABILITY } from "./index.js";
import { descriptorFlags } from "./carrier-layout.js";

if (!import.meta.main) throw new Error("isolated cohort fixture only");
const config = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const descendant = process.argv[3] === "descendant", nonOwner = process.argv[3] === "non-owner";
const timer = setTimeout(() => process.exit(96), 5_000);
if (!descendant && !nonOwner) writeFileSync(join(config.root, "spawn-pid"), String(process.pid));
let helper: ReturnType<typeof Bun.spawn> | undefined;
const waitFor = async (file: string) => { while (!existsSync(join(config.root, file))) await Bun.sleep(10); };
const parentIsPipe = fstatSync(3).isFIFO(), flagsBefore = descriptorFlags(7);
// Negative helpers deliberately violate the cooperative guard. The kernel
// fence must still prevent a false completed stop while such a carrier lives.
if (!descendant && !nonOwner && config.mode !== "drop" && config.mode !== "ignore-parent") {
  if (!parentIsPipe) throw new Error("FD 3 is not the parent pipe");
  const parent = createReadStream("", { fd: 3, autoClose: false });
  const lost = () => { writeFileSync(join(config.root, "parent-eof"), ""); process.exit(0); };
  parent.on("end", lost); parent.on("close", lost); parent.on("error", () => process.exit(97)); parent.resume();
}
try {
  if (nonOwner) closeSync(7); // Independent computation; no role effects.
  else {
    const child = new ChildRoleCustody(config.instance, [EFFECT_EXCLUSION_CAPABILITY]);
    for (;;) {
      try { await child.check("web", "R0", config.generation); break; }
      catch (error) {
        if ((error as { code?: string }).code !== "ownership_busy") throw error;
        await Bun.sleep(10); // Parent must first release its spawn ledger scope.
      }
    }
  }
  if (descendant || nonOwner) {
    writeFileSync(join(config.root, "desc-ready"), JSON.stringify({ pid: process.pid, nonOwner, flagsBefore, flagsAfter: nonOwner ? null : descriptorFlags(7) }));
    await waitFor("desc-exit");
  } else {
    if (config.mode === "drop") closeSync(7); // Deliberate lost-coverage negative.
    if (config.mode === "descendant" || config.mode === "non-owner") {
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("OPENSCOUT_") && !key.startsWith("SCOUT_")));
      helper = Bun.spawn([process.execPath, import.meta.path, process.argv[2]!, config.mode === "non-owner" ? "non-owner" : "descendant"], {
        cwd: config.root, env, detached: true, stdio: ["ignore", "ignore", "ignore", "ignore", "ignore", "ignore", "ignore", 7],
      });
      writeFileSync(join(config.root, "desc-pid"), String(helper.pid));
      await waitFor("desc-ready");
    }
    writeFileSync(join(config.root, "ready"), JSON.stringify({ pid: process.pid, descendant: helper?.pid, parentIsPipe, flagsBefore,
      flagsAfter: config.mode === "drop" ? null : descriptorFlags(7) }));
    await waitFor("exit");
    // Deliberately orphan a bounded carrier/non-owner. The controller checks
    // native disappearance including zombies after requesting helper cleanup.
  }
} finally { clearTimeout(timer); }
process.exit(0);
