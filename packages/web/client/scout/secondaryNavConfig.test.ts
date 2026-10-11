import { describe, expect, test } from "bun:test";
import { sidebarSubNavForRoute } from "./nav-destinations.ts";
import { OPS_SECONDARY_NAV } from "./secondaryNavConfig.ts";

describe("ops secondary nav", () => {
  test("uses the same Ops order and labels as the expanded sidebar", () => {
    const items = OPS_SECONDARY_NAV.flatMap((group) => group.items);
    expect(items.map((item) => item.label)).toEqual([
      "Mission Control", "Lanes", "Fleet", "Week", "Tail", "Host Advisor", "Providers", "Runtime", "Network",
    ]);
    expect(items.map(({ id, label, route }) => ({ id, label, route }))).toEqual(
      sidebarSubNavForRoute({ view: "ops" })!.items.map(({ id, label, route }) => ({ id, label, route })),
    );
  });
  test("keeps Mission Control reachable inside the ops cluster", () => {
    const missionControl = OPS_SECONDARY_NAV
      .flatMap((group) => group.items)
      .find((item) => item.id === "control");

    expect(missionControl).toBeDefined();
    expect(missionControl?.label).toBe("Mission Control");
    expect(missionControl?.route).toEqual({ view: "ops", mode: "mission" });
    expect(missionControl?.active({ view: "ops" })).toBe(true);
    expect(missionControl?.active({ view: "ops", mode: "mission" })).toBe(true);
  });
});
