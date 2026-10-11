import { getDestination, type NavDestinationId } from "../scout/nav-destinations.ts";
import type { Route } from "../lib/types.ts";
import { SCOPE_BRAND_LABEL, SCOPE_ROUTE_SEGMENTS } from "../../shared/scope-integration.js";
import type { NavCenterItem } from "../scout/nav-center.tsx";
import { routeToScopeSegment, segmentToRoute, type ScopeRouteSegment } from "./paths.ts";

// Scope keeps its own tab keys — the scout TopNavKey slimmed to the
// single-personality nav and no longer covers the scope sections.
export type ScopeTopNavKey = "lanes" | "sessions" | "tail" | "agents";

const SCOPE_NAV_REGISTRY: ReadonlyArray<{
  key: ScopeTopNavKey;
  destinationId: NavDestinationId;
  segment: ScopeRouteSegment;
}> = [
  { key: "lanes", destinationId: "lanes", segment: SCOPE_ROUTE_SEGMENTS.lanes },
  { key: "sessions", destinationId: "sessions", segment: SCOPE_ROUTE_SEGMENTS.sessions },
  { key: "tail", destinationId: "tail", segment: SCOPE_ROUTE_SEGMENTS.tail },
  { key: "agents", destinationId: "projects", segment: SCOPE_ROUTE_SEGMENTS.agents },
];

export const SCOPE_TOP_NAV_ITEMS: NavCenterItem<ScopeTopNavKey>[] = SCOPE_NAV_REGISTRY.map((entry) => ({
  key: entry.key,
  label: getDestination(entry.destinationId).label,
  route: segmentToRoute(entry.segment),
}));

export function scopeTopNavKeyForRoute(route: Route): ScopeTopNavKey {
  const segment = routeToScopeSegment(route);
  return SCOPE_NAV_REGISTRY.find((entry) => entry.segment === segment)?.key ?? "lanes";
}

/** Active Scope section label derived from the route→segment mapping. */
export function scopePresentationTitle(route: Route): string {
  const segment = routeToScopeSegment(route);
  const entry = SCOPE_NAV_REGISTRY.find((entry) => entry.segment === segment);
  return entry ? getDestination(entry.destinationId).label : SCOPE_BRAND_LABEL;
}
