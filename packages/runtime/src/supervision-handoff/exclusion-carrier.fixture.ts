import { readFileSync } from "node:fs";
import { ChildRoleCustody, EFFECT_EXCLUSION_CAPABILITY } from "./index.js";

if (!import.meta.main) throw new Error("isolated carrier fixture only");
const timer = setTimeout(() => process.exit(96), 5_000);
try {
  const instance = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
  try {
    const proof = await new ChildRoleCustody(instance, [EFFECT_EXCLUSION_CAPABILITY]).check("web", "R0", 1);
    console.log(JSON.stringify(proof));
    await Bun.stdin.text(); // EOF releases the only deliberately inherited carrier reference.
  } catch (error) {
    console.log(JSON.stringify({ state: "refused", code: (error as { code?: string }).code }));
  }
} finally { clearTimeout(timer); }
