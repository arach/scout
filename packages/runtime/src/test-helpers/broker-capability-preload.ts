// Used only by the owned capability-route broker fixtures. Keep the real
// catalog/readiness projection, but never inspect or run installed harnesses.
import { mock } from "bun:test";
import { join } from "node:path";
import * as catalog from "../harness-catalog.js";

const loadCatalog = catalog.loadHarnessCatalogSnapshot;
mock.module("../harness-catalog.js", () => ({
  ...catalog,
  loadHarnessCatalogSnapshot(options: catalog.HarnessCatalogLoadOptions = {}) {
    return loadCatalog({
      ...options,
      env: {},
      overridePath: join(process.env.OPENSCOUT_CONTROL_HOME!, "absent-harness-catalog.json"),
      whichBinary: () => null,
      executableExists: () => false,
      requirementExists: () => false,
      runCommand: () => false,
    });
  },
}));
