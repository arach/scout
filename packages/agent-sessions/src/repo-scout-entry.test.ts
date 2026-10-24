import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { repoScoutEntrypoint } from "./repo-scout-entry.js";

test("the shared Scout entry exists in this repository's actual core tree", () => {
  const root = resolve(import.meta.dir, "../../..");
  expect(repoScoutEntrypoint(root)).toBe(resolve(root, "packages/cli/bin/scout.mjs"));
  expect(existsSync(repoScoutEntrypoint(root))).toBe(true);
});
