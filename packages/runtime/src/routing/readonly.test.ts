import { expect, test } from "bun:test";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoutingStore } from "./store.js";

test("read-only routing lookup neither creates a missing index nor permits writes", () => {
  const directory = mkdtempSync(join(tmpdir(), "scout-routing-readonly-"));
  const path = join(directory, "routing.sqlite");
  try {
    expect(() => new RoutingStore(path, { readonly: true })).toThrow();
    expect(existsSync(path)).toBe(false);
    const writer = new RoutingStore(path);
    writer.close();
    const reader = new RoutingStore(path, { readonly: true });
    try {
      expect(reader.targets()).toEqual([]);
      expect(() => reader.db.exec("DELETE FROM route_targets")).toThrow();
    } finally { reader.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
