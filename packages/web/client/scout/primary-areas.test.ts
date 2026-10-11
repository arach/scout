import { describe, expect, test } from "bun:test";
import type { Route } from "../lib/types.ts";
import {
  PRIMARY_AREAS,
  ROUTE_AREA_BY_VIEW,
  allRouteViews,
  defaultRouteForArea,
  getPrimaryArea,
  navigatePrimaryAreas,
  primaryAreaForRoute,
  routeViewsByArea,
  systemPrimaryAreas,
  type NavigationEntryId,
} from "./primary-areas.ts";

describe("primary areas (SCO-083 IA model)", () => {
  test("defines exactly nine primary areas with unique ids", () => {
    expect(PRIMARY_AREAS).toHaveLength(9);
    const ids = PRIMARY_AREAS.map((area) => area.id);
    expect(new Set(ids).size).toBe(9);
    expect(ids).toEqual([
      "home",
      "sessions",
      "chat",
      "projects",
      "terminals",
      "dispatch",
      "search",
      "ops",
      "settings",
    ]);
  });

  test("Navigate and System sections partition the nine areas", () => {
    expect(navigatePrimaryAreas().map((a) => a.id)).toEqual([
      "home",
      "sessions",
      "chat",
      "projects",
      "terminals",
      "dispatch",
      "search",
    ]);
    expect(systemPrimaryAreas().map((a) => a.id)).toEqual(["ops", "settings"]);
    expect(getPrimaryArea("projects").label).toBe("Projects");
  });

  test("ROUTE_AREA_BY_VIEW has exactly 23 keys and 10 non-empty buckets", () => {
    const views = allRouteViews();
    expect(views).toHaveLength(23);
    expect(new Set(views).size).toBe(23);

    const buckets = routeViewsByArea();
    const areaIds = Object.keys(buckets) as NavigationEntryId[];
    expect(areaIds).toHaveLength(10);
    for (const id of areaIds) {
      expect(buckets[id].length).toBeGreaterThan(0);
    }

    // Partition matches the revised SCO-083 table.
    const sortedViews = (views: Route["view"][]) => [...views].sort();
    expect(sortedViews(buckets.home)).toEqual(sortedViews(["activity", "briefings", "inbox"]));
    expect(sortedViews(buckets.projects)).toEqual(
      sortedViews(["agent-info", "agents-v2", "code", "repo-diff", "repos"]),
    );
    expect(buckets.sessions).toEqual(["sessions"]);
    expect(buckets.terminals).toEqual(["terminal"]);
    // Route unification: channels are conversations, not their own view.
    expect(sortedViews(buckets.chat)).toEqual(sortedViews(["conversation", "messages"]));
    expect(sortedViews(buckets.dispatch)).toEqual(sortedViews(["broker", "follow", "work"]));
    expect(buckets.requests).toEqual(["requests"]);
    expect(buckets.search).toEqual(["search"] satisfies Route["view"][]);
    expect(sortedViews(buckets.ops)).toEqual(sortedViews(["harnesses", "mesh", "mesh-ops", "ops"]));
    expect(sortedViews(buckets.settings)).toEqual(sortedViews(["settings", "voice"]));
  });

  test("every Route view maps through primaryAreaForRoute", () => {
    for (const view of allRouteViews()) {
      const route = { view } as Route;
      const areaId = primaryAreaForRoute(route);
      expect(ROUTE_AREA_BY_VIEW[view]).toBe(areaId);
      if (areaId !== "requests") expect(getPrimaryArea(areaId).id).toBe(areaId);
      else expect(PRIMARY_AREAS.some((area) => area.id as string === "requests")).toBe(false);
    }
  });

  test("follow preferredView prefers the resolved target area", () => {
    expect(primaryAreaForRoute({ view: "follow" })).toBe("dispatch");
    expect(primaryAreaForRoute({ view: "follow", preferredView: "tail" })).toBe("ops");
    expect(primaryAreaForRoute({ view: "follow", preferredView: "session" })).toBe("sessions");
    expect(primaryAreaForRoute({ view: "follow", preferredView: "chat" })).toBe("chat");
    expect(primaryAreaForRoute({ view: "follow", preferredView: "work" })).toBe("dispatch");
  });

  test("Ops default route respects ops.control gate policy", () => {
    expect(defaultRouteForArea("ops", { opsControlEnabled: true })).toEqual({
      view: "ops",
      mode: "mission",
    });
    expect(defaultRouteForArea("ops", { opsControlEnabled: false })).toEqual({
      view: "ops",
      mode: "tail",
    });
    // Other areas ignore the ops gate.
    expect(defaultRouteForArea("home", { opsControlEnabled: false })).toEqual({ view: "inbox" });
    expect(defaultRouteForArea("dispatch")).toEqual({ view: "broker" });
    expect(defaultRouteForArea("projects")).toEqual({ view: "agents-v2", indexView: "projects" });
    expect(getPrimaryArea("dispatch").label).toBe("Dispatch");
    expect(PRIMARY_AREAS.map((area) => area.label)).toEqual([
      "Home", "Sessions", "Chats", "Projects", "Terminals", "Dispatch", "Search", "Ops", "Settings",
    ]);
  });

  test("each area default route activates that area", () => {
    for (const area of PRIMARY_AREAS) {
      expect(primaryAreaForRoute(area.defaultRoute)).toBe(area.id);
    }
  });
});
