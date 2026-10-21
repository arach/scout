import { closeSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ChildRoleCustody, EFFECT_EXCLUSION_CAPABILITY } from "./index.js";

if (!import.meta.main) throw new Error("isolated cohort fixture only");
const config = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const descendant = process.argv[3] === "descendant", nonOwner = process.argv[3] === "non-owner";
const timer = setTimeout(() => process.exit(96), 5_000);
if (!descendant && !nonOwner) writeFileSync(join(config.root, "spawn-pid"), String(process.pid));
let helper: ReturnType<typeof Bun.spawn> | undefined;
const waitFor = async (file: string) => { while (!existsSync(join(config.root, file))) await Bun.sleep(10); };
try {
  if (nonOwner) closeSync(3); // Independent computation; no role effects.
  else {
    const child = new ChildRoleCustody(config.instance, [EFFECT_EXCLUSION_CAPABILITY]);
    for (;;) {
      try { await child.check("web", "R0", config.generation, 3); break; }
      catch (error) {
        if ((error as { code?: string }).code !== "ownership_busy") throw error;
        await Bun.sleep(10); // Parent must first release its spawn ledger scope.
      }
    }
  }
  if (descendant || nonOwner) {
    writeFileSync(join(config.root, "desc-ready"), JSON.stringify({ pid: process.pid, nonOwner }));
    await waitFor("desc-exit");
  } else {
    if (config.mode === "drop") closeSync(3); // Deliberate lost-coverage negative.
    if (config.mode === "descendant" || config.mode === "non-owner") {
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("OPENSCOUT_") && !key.startsWith("SCOUT_")));
      helper = Bun.spawn([process.execPath, import.meta.path, process.argv[2]!, config.mode === "non-owner" ? "non-owner" : "descendant"], {
        cwd: config.root, env, detached: true, stdio: ["ignore", "ignore", "ignore", 3],
      });
      writeFileSync(join(config.root, "desc-pid"), String(helper.pid));
      await waitFor("desc-ready");
    }
    writeFileSync(join(config.root, "ready"), JSON.stringify({ pid: process.pid, descendant: helper?.pid }));
    await waitFor("exit");
    // Deliberately orphan a bounded carrier/non-owner. The controller checks
    // native disappearance including zombies after requesting helper cleanup.
  }
} finally { clearTimeout(timer); }
process.exit(0);
