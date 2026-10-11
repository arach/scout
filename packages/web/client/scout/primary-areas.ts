/**
 * Sidebar primary-area model (SCO-083).
 *
 * Two explicit layers:
 * 1. PRIMARY_AREAS — 9 primary navigation destinations (area id, label, icon,
 *    default route, visibility/default-route policy).
 * 2. ROUTE_AREA_BY_VIEW — exhaustive compile-time map of every Route["view"] to
 *    exactly one NavigationEntryId (Requests is separate). Sidebar active state is
 *    primaryAreaForRoute(route) === area.id.
 *
 * Destination predicates in nav-destinations.ts continue to drive secondary
 * nav and command/shortcut projections unchanged.
 *
 * History: the sco-083 sidebar-navigation worklog series was removed from the
 * tree after its PRs merged; see git history.
 */
import type { LucideIcon } from "lucide-react";
import {
  Compass,
  FolderKanban,
  House,
  MessageSquare,
  Search,
  Send,
  Settings,
  Terminal,
  PanelLeft,
} from "lucide-react";
import type { Route } from "../lib/types.ts";
import { getDestination } from "./nav-destinations.ts";
import { ROUTE_AREA_BY_VIEW, type PrimaryAreaId, type NavigationEntryId } from "./route-areas.ts";
export { ROUTE_AREA_BY_VIEW, type PrimaryAreaId, type NavigationEntryId } from "./route-areas.ts";

export type PrimaryAreaSection = "navigate" | "system";

export type PrimaryArea = {
  id: PrimaryAreaId;
  label: string;
  icon: LucideIcon;
  /** Default route when the area is selected (before gate policy). */
  defaultRoute: Route;
  section: PrimaryAreaSection;
};

/**
 * Nine primary areas. Navigate section first (Home…Search), then System
 * (Ops, Settings). Icons are for the sidebar icon rail; labels match product
 * nouns.
 */
export const PRIMARY_AREAS: readonly PrimaryArea[] = [
  {
    id: "home",
    label: getDestination("home").label,
    icon: House,
    defaultRoute: { view: "inbox" },
    section: "navigate",
  },
  {
    id: "sessions",
    label: getDestination("sessions").label,
    icon: PanelLeft,
    defaultRoute: { view: "sessions" },
    section: "navigate",
  },
  {
    id: "chat",
    label: getDestination("chat").label,
    icon: MessageSquare,
    defaultRoute: { view: "messages" },
    section: "navigate",
  },
  {
    id: "projects",
    label: getDestination("project-list").label,
    icon: FolderKanban,
    defaultRoute: { view: "agents-v2", indexView: "projects" },
    section: "navigate",
  },
  {
    id: "terminals",
    label: getDestination("terminals").label,
    icon: Terminal,
    defaultRoute: { view: "terminal" },
    section: "navigate",
  },
  {
    id: "dispatch",
    label: getDestination("dispatch").label,
    icon: Send,
    defaultRoute: { view: "broker" },
    section: "navigate",
  },
  {
    id: "search",
    label: getDestination("search").label,
    icon: Search,
    defaultRoute: { view: "search" },
    section: "navigate",
  },
  {
    id: "ops",
    label: getDestination("ops").label,
    icon: Compass,
    // Catalog default is Mission Control; gate policy may redirect to Tail.
    defaultRoute: { view: "ops", mode: "mission" },
    section: "system",
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    defaultRoute: { view: "settings", section: "appearance" },
    section: "system",
  },
] as const;


const AREA_BY_ID: ReadonlyMap<PrimaryAreaId, PrimaryArea> = new Map(
  PRIMARY_AREAS.map((area) => [area.id, area]),
);

export function getPrimaryArea(id: PrimaryAreaId): PrimaryArea {
  const area = AREA_BY_ID.get(id);
  if (!area) {
    throw new Error(`Unknown primary area: ${id}`);
  }
  return area;
}

/**
 * Resolve the primary area for a route. FollowScreen is a transient resolver:
 * when preferredView is set, active area follows the resolved target; otherwise
 * the view falls back to Dispatch (ROUTE_AREA_BY_VIEW.follow).
 */
export function primaryAreaForRoute(route: Route): NavigationEntryId {
  if (route.view === "follow" && route.preferredView) {
    switch (route.preferredView) {
      case "tail":
        return "ops";
      case "session":
        return "sessions";
      case "chat":
        return "chat";
      case "work":
        return "dispatch";
      default:
        break;
    }
  }
  return ROUTE_AREA_BY_VIEW[route.view];
}

/**
 * Default route for an area, applying Ops gate policy:
 * - ops.control on → Mission Control
 * - ops.control off → Tail (ungated surface; Lanes also ungated but Tail is
 *   the historical primary ungated ops entry)
 *
 * Ops area itself stays visible either way; only context entries are gated.
 */
export function defaultRouteForArea(
  areaId: PrimaryAreaId,
  options?: { opsControlEnabled?: boolean },
): Route {
  const area = getPrimaryArea(areaId);
  if (areaId === "ops") {
    const opsControlEnabled = options?.opsControlEnabled ?? true;
    if (opsControlEnabled) {
      return { view: "ops", mode: "mission" };
    }
    return { view: "ops", mode: "tail" };
  }
  return area.defaultRoute;
}

/** Areas in the Navigate section (order stable). */
export function navigatePrimaryAreas(): readonly PrimaryArea[] {
  return PRIMARY_AREAS.filter((area) => area.section === "navigate");
}

/** Areas in the System section (order stable). */
export function systemPrimaryAreas(): readonly PrimaryArea[] {
  return PRIMARY_AREAS.filter((area) => area.section === "system");
}

/** All Route["view"] keys classified by the area map. */
export function allRouteViews(): readonly Route["view"][] {
  return Object.keys(ROUTE_AREA_BY_VIEW) as Route["view"][];
}

/** Bucket every view under its navigation entry (Requests is not an area). */
export function routeViewsByArea(): Record<NavigationEntryId, Route["view"][]> {
  const buckets = Object.fromEntries(
    PRIMARY_AREAS.map((area) => [area.id, [] as Route["view"][]]),
  ) as Record<NavigationEntryId, Route["view"][]>;
  buckets.requests = [];
  for (const [view, areaId] of Object.entries(ROUTE_AREA_BY_VIEW) as Array<
    [Route["view"], NavigationEntryId]
  >) {
    buckets[areaId].push(view);
  }
  return buckets;
}
