import { describe, expect, test } from "bun:test";
import { ROUTE_VIEW_LABELS, routeBreadcrumbForRoute } from "./route-breadcrumb.ts";

describe("route breadcrumbs (SCO-083)", () => {
  test("skips top-level primary destinations", () => {
    expect(routeBreadcrumbForRoute({ view: "inbox" })).toBeNull();
    expect(routeBreadcrumbForRoute({ view: "agents-v2" })).toBeNull();
    expect(routeBreadcrumbForRoute({ view: "messages" })).toBeNull();
    expect(routeBreadcrumbForRoute({ view: "search" })).toBeNull();
    // Broker and Terminals are top-level tabs now; no crumb repeats the tab.
    expect(routeBreadcrumbForRoute({ view: "broker" })).toBeNull();
    expect(routeBreadcrumbForRoute({ view: "terminal" })).toBeNull();
    // Sessions is its own area; the slot toolbar owns its heading.
    expect(routeBreadcrumbForRoute({ view: "sessions" })).toBeNull();
  });

  test("uses agent-first labels for Agents workspace routes", () => {
    expect(ROUTE_VIEW_LABELS["agents-v2"]).toBe("Agents");
    expect(ROUTE_VIEW_LABELS.code).toBe("Code");
    expect(ROUTE_VIEW_LABELS.repos).toBe("Repos");
  });

  test("labels detail and ops surfaces", () => {
    expect(routeBreadcrumbForRoute({ view: "conversation", conversationId: "c1" })).toBe(
      "Conversation",
    );
    expect(routeBreadcrumbForRoute({ view: "settings", section: "agents" })).toBe(
      "Agent Configuration",
    );
    expect(routeBreadcrumbForRoute({ view: "settings" })).toBe("Settings");
    expect(routeBreadcrumbForRoute({ view: "ops" })).toBe("Mission Control");
    expect(routeBreadcrumbForRoute({ view: "ops", mode: "tail" })).toBe("Tail");
    expect(routeBreadcrumbForRoute({ view: "ops", mode: "lanes" })).toBe("Lanes");
    expect(routeBreadcrumbForRoute({ view: "ops", mode: "world" })).toBe("Fleet");
    expect(routeBreadcrumbForRoute({ view: "repos" })).toBe("Repos");
    expect(routeBreadcrumbForRoute({ view: "code" })).toBe("Code");
    expect(routeBreadcrumbForRoute({ view: "repo-diff", path: "/tmp/x" })).toBe("Diff");
  });

  test("exposes labels for all primary-area views", () => {
    for (const view of [
      "inbox",
      "activity",
      "briefings",
      "agents-v2",
      "agent-info",
      "repos",
      "repo-diff",
      "code",
      "sessions",
      "terminal",
      "messages",
      "conversation",
      "broker",
      "work",
      "follow",
      "search",
      "ops",
      "mesh",
      "harnesses",
      "settings",
    ] as const) {
      expect(ROUTE_VIEW_LABELS[view]).toBeTruthy();
    }
  });
});
