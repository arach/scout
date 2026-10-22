import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SupervisionHandoff, EFFECT_EXCLUSION_CAPABILITY, type ExactChild } from "./index.js";
import { HandoffStore } from "./store.js";

if (!import.meta.main) throw new Error("isolated layout-owner fixture only");
const config = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const timer = setTimeout(() => process.exit(96), 5_000);
writeFileSync(join(config.root, "owner-pid"), String(process.pid));
const store = new HandoffStore(config.instance);
const profile = await store.exclusive(async tx => structuredClone(tx.state.policy.effectProfiles!.web!));
let child: ExactChild | undefined;
const sdk = new SupervisionHandoff(config.instance, {
  readiness: async () => config.readiness,
  observe: async () => child ? { state: "owned", child } : { state: "unknown" },
  exclusion: async context => ({ ...context, state: "observed", coverageId: profile.coverageId,
    resources: { inventoryId: profile.resourceInventory.id, entries: profile.resourceInventory.resources.map(entry => ({ ...entry, state: "released" })), unexplained: [] },
    legacy: { evidenceId: profile.legacyEvidenceId, state: "settled" }, delegated: "settled", relaunch: "fenced", inFlight: "quiescent", descendants: "unproven", nonOwners: [] }),
}, {}, { enableAuditedDirectChildren: true, capabilities: [EFFECT_EXCLUSION_CAPABILITY] });
try {
  writeFileSync(join(config.root, "owner-stage"), "acquiring");
  await sdk.acquireLifetimeFence("R0", "web", config.generation);
  writeFileSync(join(config.root, "owner-stage"), "starting");
  await sdk.exclusive("R0", "web", config.generation, async lease => {
    lease.begin("start", "start");
    await lease.perform("start", "start", async permit => {
      child = permit.spawnChild({ argv: [process.execPath, join(import.meta.dir, "cohort-carrier.fixture.ts"), process.argv[2]!], cwd: config.root,
        env: { HOME: config.root, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" }, carrier: "role-lifetime/7", stdio: ["ignore", "ignore", "inherit"] });
    });
    lease.complete("start");
  });
  writeFileSync(join(config.root, "owner-stage"), "waiting-ready");
  while (!existsSync(join(config.root, "ready"))) await Bun.sleep(10); // Outside the parent's ledger scope.
  console.log("owner-ready");
  await Bun.stdin.text();
} finally { clearTimeout(timer); await sdk.releaseControllerFences(); }
