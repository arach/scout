import { describe, expect, test } from "bun:test";
import type { NodeDefinition } from "@openscout/protocol";
import { resolveScoutMachines } from "./machine-selector.ts";

const mini = { id: "arts-mini-openscout", name: "arts-mini", hostName: "arts-mini.local" } as NodeDefinition;
const archie = { id: "archie-openscout", name: "archie", hostName: "archie.local" } as NodeDefinition;

describe("machine selector", () => {
  test("matches id, name, hostname and a short token, case-insensitively", () => {
    for (const ref of ["arts-mini-openscout", "arts-mini", "arts-mini.local", "MINI"]) {
      expect(resolveScoutMachines([mini, archie], ref)).toEqual([mini]);
    }
  });
  test("keeps every ambiguous name/token match distinct; exact ids and names win", () => {
    const other = { ...mini, id: "other-mini-id", name: "other-mini", hostName: "other-mini.local" };
    expect(resolveScoutMachines([mini, other], "mini")).toEqual([mini, other]);
    const sameName = { ...other, name: mini.name, hostName: mini.hostName };
    expect(resolveScoutMachines([mini, sameName], "arts-mini")).toEqual([mini, sameName]);
    expect(resolveScoutMachines([mini, sameName], mini.id)).toEqual([mini]);
    expect(() => resolveScoutMachines([mini], "missing")).toThrow("Unknown machine");
    expect(resolveScoutMachines([mini, { ...other, name: "mini" }], "mini")[0]?.id).toBe(other.id);
  });
});
