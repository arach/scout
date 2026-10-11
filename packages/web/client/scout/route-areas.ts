/**
 * Route classification shared by area chrome and destination projections.
 * Kept dependency-free so primary areas can read canonical catalog labels
 * without creating a primary-areas ↔ nav-destinations initialization cycle.
 */
import type { Route } from "../lib/types.ts";

export type PrimaryAreaId =
  | "home"
  | "projects"
  | "sessions"
  | "terminals"
  | "chat"
  | "dispatch"
  | "search"
  | "ops"
  | "settings";

export type NavigationEntryId = PrimaryAreaId | "requests";

/**
 * Exhaustive view → primary area map. Proves every Route["view"] union member
 * is classified. Runtime tests assert 10 non-empty buckets and exactly 23 keys.
 *
 * Note: `follow` is a transient resolver; primaryAreaForRoute may prefer a
 * resolved target area from preferredView when present.
 */
export const ROUTE_AREA_BY_VIEW = {
  requests: "requests",
  inbox: "home",
  activity: "home",
  briefings: "home",
  "agents-v2": "projects",
  "agent-info": "projects",
  repos: "projects",
  "repo-diff": "projects",
  code: "projects",
  sessions: "sessions",
  terminal: "terminals",
  messages: "chat",
  conversation: "chat",
  broker: "dispatch",
  work: "dispatch",
  follow: "dispatch",
  search: "search",
  ops: "ops",
  mesh: "ops",
  "mesh-ops": "ops",
  harnesses: "ops",
  settings: "settings",
  voice: "settings",
} as const satisfies Record<Route["view"], NavigationEntryId>;
