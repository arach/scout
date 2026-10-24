import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { findCoreSourceBoundaryFailures } from "./check-core-boundary.mjs";

test("core source guard rejects value, type, re-export, dynamic and package edges", () => {
  const root = mkdtempSync(join(tmpdir(), "core-boundary-"));
  const file = join(root, "packages/fixture/src/index.ts");
  mkdirSync(dirname(file), { recursive: true });
  try {
    writeFileSync(file, 'import { x } from "@openscout/runtime";');
    assert.deepEqual(findCoreSourceBoundaryFailures(root), []);
    for (const source of [
      'import "../../../apps/desktop/x.ts";',
      'import type { T } from "../../web/x.ts";',
      'export * from "../../web/x.ts";',
      'await import("../../../apps/desktop/x.ts");',
      'import "@openscout/web";',
      'const app = createRequire(new URL("../../web/package.json", import.meta.url));',
    ]) {
      writeFileSync(file, source);
      assert.equal(findCoreSourceBoundaryFailures(root).length, 1, source);
    }
    writeFileSync(file, 'export {};');
    mkdirSync(join(root, "packages/web"), { recursive: true });
    assert.match(findCoreSourceBoundaryFailures(root).join("\n"), /Departed tree returned/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
