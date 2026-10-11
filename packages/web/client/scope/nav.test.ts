import { describe, expect, test } from "bun:test";
import { getDestination } from "../scout/nav-destinations.ts";
import { SCOPE_TOP_NAV_ITEMS, scopePresentationTitle, scopeTopNavKeyForRoute } from "./nav.ts";

describe("Scope navigation labels", () => {
  test("inherits destination names without changing Scope keys or routes", () => {
    expect(SCOPE_TOP_NAV_ITEMS.map((item) => item.key)).toEqual(["lanes", "sessions", "tail", "agents"]);
    expect(SCOPE_TOP_NAV_ITEMS.map((item) => item.label)).toEqual(
      (["lanes", "sessions", "tail", "projects"] as const).map((id) => getDestination(id).label),
    );
    for (const item of SCOPE_TOP_NAV_ITEMS) {
      expect(scopeTopNavKeyForRoute(item.route)).toBe(item.key);
      expect(scopePresentationTitle(item.route)).toBe(item.label);
    }
  });
});
