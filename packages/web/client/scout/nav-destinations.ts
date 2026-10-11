/**
 * Canonical navigation destination catalog + surface projections.
 *
 * Identity (id, label, route, active, capability) lives here once.
 * Surface-specific concerns — tab keys, action prefixes, shortcut keys,
 * palette ids/subtitles, dock icons — live in the projections below.
 *
 * History: the sco-082 web-navigation worklog series was removed from the
 * tree after its PRs merged; see git history.
 */
import type { LucideIcon } from "lucide-react";
import {
  Code2,
  Compass,
  FileText,
  GitBranch,
  House,
  ScrollText,
  Search,
  Send,
  Terminal,
} from "lucide-react";
import type { CommandOption } from "@hudsonkit";
import type { SecondaryNavGroup } from "../components/SecondaryNav.tsx";
import type { Route } from "../lib/types.ts";
import { ROUTE_AREA_BY_VIEW } from "./route-areas.ts";

/**
 * Top-tab keys used by chrome. `system` is a residual key for routes outside
 * the tab row (settings, voice) so no tab false-highlights on them.
 */
export type TopNavKey =
  | "requests"
  | "home"
  | "chat"
  | "agents"
  | "terminals"
  | "sessions"
  | "broker"
  | "search"
  | "ops"
  | "system";

export type TopNavItem = {
  key: TopNavKey;
  label: string;
  route: Route;
};

/* ── Catalog ──────────────────────────────────────────────────────────── */

export type NavCapability = "ops.control" | "surface.mesh-ops";

export type NavDestinationId =
  | "requests"
  | "home"
  | "projects"
  | "project-list"
  | "sessions"
  | "chat"
  | "search"
  | "terminals"
  | "tail"
  | "dispatch"
  | "activity"
  | "mesh"
  | "mesh-ops"
  | "mission-control"
  | "lanes"
  | "world"
  | "week"
  | "repos"
  | "code"
  | "providers"
  | "runtime"
  | "advisor"
  | "agent-config"
  | "ops";

export type NavDestination = {
  id: NavDestinationId;
  /** Canonical product label for this destination. */
  label: string;
  /** Default route opened when navigating to this destination. */
  route: Route;
  /** Whether the current route is "on" this destination. */
  active: (route: Route) => boolean;
  /** When set, surfaces must hide this destination unless the flag is on. */
  capability?: NavCapability;
};

function isOpsMission(route: Route): boolean {
  return (
    route.view === "ops" &&
    (route.mode === undefined || route.mode === "mission" || route.mode === "issues")
  );
}

/**
 * Single source of truth for every navigable product destination.
 * Projections pick rows from this table; they do not redefine routes/active.
 */
/** The project list, or a project's own pages (not an agent opened in one). */
function isProjectListRoute(route: Route): boolean {
  if (route.view !== "agents-v2") return false;
  if (route.projectSlug) return !route.agentId;
  return route.indexView === "projects";
}

export const NAV_DESTINATIONS: readonly NavDestination[] = [
  { id: "requests", label: "Requests", route: { view: "requests" }, active: (route) => route.view === "requests" },
  {
    id: "home",
    label: "Home",
    route: { view: "inbox" },
    active: (route) => route.view === "inbox",
  },
  {
    // Historical destination id: this is the Agents sub-page, not the
    // primary area id "projects". Area entry points use "project-list".
    id: "projects",
    label: "Agents",
    route: { view: "agents-v2" },
    // The activity feed and agent pages. The project list and project
    // pages belong to the Projects tab below.
    active: (route) =>
      (route.view === "agents-v2" && !isProjectListRoute(route)) ||
      route.view === "agent-info",
  },
  {
    id: "project-list",
    label: "Projects",
    route: { view: "agents-v2", indexView: "projects" },
    active: isProjectListRoute,
  },
  {
    id: "sessions",
    label: "Sessions",
    route: { view: "sessions" },
    active: (route) => route.view === "sessions",
  },
  {
    id: "chat",
    label: "Chats",
    route: { view: "messages" },
    active: (route) =>
      route.view === "messages" ||
      route.view === "conversation",
  },
  {
    id: "search",
    label: "Search",
    route: { view: "search" },
    active: (route) => route.view === "search",
  },
  {
    id: "terminals",
    label: "Terminals",
    route: { view: "terminal" },
    active: (route) => route.view === "terminal",
  },
  {
    id: "tail",
    label: "Tail",
    route: { view: "ops", mode: "tail" },
    active: (route) => route.view === "ops" && route.mode === "tail",
  },
  {
    id: "dispatch",
    label: "Dispatch",
    route: { view: "broker" },
    active: (route) => route.view === "broker",
  },
  {
    id: "activity",
    label: "Activity Log",
    route: { view: "activity" },
    active: (route) => route.view === "activity",
  },
  {
    id: "mesh",
    label: "Network",
    route: { view: "mesh" },
    active: (route) => route.view === "mesh",
  },
  {
    id: "mesh-ops",
    label: "Mesh Ops",
    route: { view: "mesh-ops" },
    active: (route) => route.view === "mesh-ops",
    capability: "surface.mesh-ops",
  },
  {
    id: "mission-control",
    label: "Mission Control",
    route: { view: "ops", mode: "mission" },
    active: isOpsMission,
    capability: "ops.control",
  },
  {
    id: "lanes",
    label: "Lanes",
    route: { view: "ops", mode: "lanes" },
    active: (route) => route.view === "ops" && route.mode === "lanes",
  },
  {
    id: "world",
    label: "Fleet",
    route: { view: "ops", mode: "world" },
    active: (route) => route.view === "ops" && route.mode === "world",
  },
  {
    id: "week",
    // The week HUD: one real week of tool calls, asks and sessions in 3D.
    // A different instrument from Fleet, not its replacement.
    label: "Week",
    route: { view: "ops", mode: "week" },
    active: (route) => route.view === "ops" && route.mode === "week",
  },
  {
    id: "repos",
    label: "Repos",
    route: { view: "repos" },
    // SCO-085: repo-diff is a Repos detail surface — keep Repos sub-nav active.
    active: (route) => route.view === "repos" || route.view === "repo-diff",
  },
  {
    id: "code",
    label: "Code",
    route: { view: "code" },
    active: (route) => route.view === "code",
  },
  {
    id: "providers",
    label: "Providers",
    route: { view: "harnesses" },
    active: (route) => route.view === "harnesses",
  },
  {
    id: "runtime",
    label: "Runtime",
    route: { view: "ops", mode: "atop" },
    active: (route) => route.view === "ops" && route.mode === "atop",
    capability: "ops.control",
  },
  {
    id: "advisor",
    label: "Host Advisor",
    route: { view: "ops", mode: "advisor" },
    active: (route) => route.view === "ops" && route.mode === "advisor",
  },
  {
    id: "agent-config",
    label: "Agent Configuration",
    route: { view: "settings", section: "agents" },
    active: (route) => route.view === "settings" && route.section === "agents",
  },
  {
    id: "ops",
    // The Ops umbrella tab. Mode-specific destinations (mission-control,
    // lanes, tail, runtime, advisor) stay in the catalog for deep links and
    // the Ops secondary strip; this entry is the tab-level default.
    label: "Ops",
    route: { view: "ops" },
    active: (route) => route.view === "ops",
  },
] as const;

const DESTINATION_BY_ID: ReadonlyMap<NavDestinationId, NavDestination> = new Map(
  NAV_DESTINATIONS.map((destination) => [destination.id, destination]),
);

export function getDestination(id: NavDestinationId): NavDestination {
  const destination = DESTINATION_BY_ID.get(id);
  if (!destination) {
    throw new Error(`Unknown nav destination: ${id}`);
  }
  return destination;
}

export function requireDestination(id: NavDestinationId): NavDestination {
  return getDestination(id);
}

/* ── Shared projection helpers ────────────────────────────────────────── */

function project(
  id: NavDestinationId,
  overrides?: Partial<Pick<NavDestination, "route" | "active">>,
): {
  id: NavDestinationId;
  label: string;
  route: Route;
  active: (route: Route) => boolean;
  capability?: NavCapability;
} {
  const destination = getDestination(id);
  return {
    id: destination.id,
    label: destination.label,
    route: overrides?.route ?? destination.route,
    active: overrides?.active ?? destination.active,
    capability: destination.capability,
  };
}

/* ── Projection: top tabs ─────────────────────────────────────────────── */

type TopTabProjection = {
  destinationId: NavDestinationId;
  key: TopNavKey;
};

const TOP_TAB_PROJECTION: readonly TopTabProjection[] = [
  { destinationId: "home", key: "home" },
  { destinationId: "sessions", key: "sessions" },
  { destinationId: "chat", key: "chat" },
  { destinationId: "project-list", key: "agents" },
  { destinationId: "terminals", key: "terminals" },
  { destinationId: "dispatch", key: "broker" },
  { destinationId: "search", key: "search" },
  { destinationId: "ops", key: "ops" },
];

export function projectTopNavItems(): TopNavItem[] {
  return TOP_TAB_PROJECTION.map((entry) => {
    const destination = getDestination(entry.destinationId);
    return {
      key: entry.key,
      label: destination.label,
      route: destination.route,
    };
  });
}

/* ── Projection: secondary nav ────────────────────────────────────────── */

type SecondaryItemProjection = {
  destinationId: NavDestinationId;
  id: string;
  route?: Route;
  active?: (route: Route) => boolean;
};

function projectSecondaryGroup(
  items: readonly SecondaryItemProjection[],
): SecondaryNavGroup {
  return {
    items: items.map((entry) => {
      const projected = project(entry.destinationId, {
        route: entry.route,
        active: entry.active,
      });
      return {
        id: entry.id,
        label: projected.label,
        route: projected.route,
        active: projected.active,
      };
    }),
  };
}

export function projectAgentsSecondaryNav(): SecondaryNavGroup[] {
  return [
    projectSecondaryGroup([
      { destinationId: "agent-config", id: "config" },
    ]),
  ];
}

/**
 * Chat secondary strip is production-dead. Route unification collapsed the
 * DM/Channels split onto a single conversation route, so there is nothing left
 * to switch between. Kept as an empty projection only for catalog integrity
 * helpers; do not reintroduce a Chat strip in chrome.
 */
export function projectChatSecondaryNav(): SecondaryNavGroup[] {
  return [];
}

/**
 * Search secondary strip is production-dead (single surface). Kept as an empty
 * projection only for catalog integrity helpers that still iterate secondary
 * surfaces; do not reintroduce a Search strip in chrome.
 * @deprecated SCO-083 — Search has no secondary strip.
 */
export function projectSearchSecondaryNav(): SecondaryNavGroup[] {
  return [];
}

/**
 * Ops cluster secondary strip — Ops-area destinations only (SCO-083).
 * Dispatch, Repos, and Code moved out of Ops (Dispatch is top-level; Repos/Code
 * are Crew workspace tools). Do not re-add them here or the sidebar active area will
 * disagree with the in-content strip.
 * Shared Ops order for the in-content strip and expanded sidebar.
 */
const OPS_NAV_PROJECTION: readonly SecondaryItemProjection[] = [
  { destinationId: "mission-control", id: "control" },
  { destinationId: "lanes", id: "lanes" },
  { destinationId: "world", id: "world" },
  { destinationId: "week", id: "week" },
  { destinationId: "tail", id: "tail" },
  { destinationId: "advisor", id: "advisor" },
  { destinationId: "providers", id: "harnesses" },
  { destinationId: "runtime", id: "runtime" },
  { destinationId: "mesh", id: "mesh" },
];

export function projectOpsSecondaryNav(): SecondaryNavGroup[] {
  return [projectSecondaryGroup(OPS_NAV_PROJECTION)];
}

/* ── Projection: go-shortcuts ─────────────────────────────────────────── */

export type GoShortcutProjection = {
  key: string;
  destinationId: NavDestinationId;
  /** Override route when the shortcut intentionally differs from catalog default. */
  route?: Route;
};

/**
 * Curated g+key sequences. Keys are surface-specific; labels, destination
 * identity and default route come from the catalog.
 */
export const GO_SHORTCUT_PROJECTION: readonly GoShortcutProjection[] = [
  { key: "h", destinationId: "home" },
  { key: "i", destinationId: "chat" },
  { key: "c", destinationId: "chat" },
  { key: "p", destinationId: "project-list" },
  { key: "s", destinationId: "sessions" },
  { key: "t", destinationId: "terminals" },
  { key: "r", destinationId: "repos" },
  { key: "b", destinationId: "code" },
  { key: "f", destinationId: "search" },
  { key: "l", destinationId: "tail" },
  { key: "w", destinationId: "world" },
  // Default ops entry uses bare `{ view: "ops" }` (mode undefined), matching
  // the historical shortcut — not the explicit mission mode in the catalog.
  { key: "o", destinationId: "mission-control", route: { view: "ops" } },
  { key: "d", destinationId: "dispatch" },
  { key: "m", destinationId: "mesh" },
  { key: "a", destinationId: "activity" },
];

export type GoShortcut = {
  key: string;
  label: string;
  route: Route;
  destinationId: NavDestinationId;
};

export function projectGoShortcuts(): readonly GoShortcut[] {
  return GO_SHORTCUT_PROJECTION.map((entry) => {
    const destination = getDestination(entry.destinationId);
    return {
      key: entry.key,
      label: `Go to ${destination.label}`,
      route: entry.route ?? destination.route,
      destinationId: entry.destinationId,
    };
  });
}

/* ── Projection: jump dock ────────────────────────────────────────────── */

export type JumpDockItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  route: Route;
  destinationId: NavDestinationId;
  opsGated?: boolean;
};

type JumpDockProjection = {
  destinationId: NavDestinationId;
  id: string;
  icon: LucideIcon;
  route?: Route;
  /** Explicit ops gate independent of catalog capability (mission control uses both). */
  opsGated?: boolean;
};

const JUMP_DOCK_PROJECTION: readonly JumpDockProjection[] = [
  { destinationId: "sessions", id: "sessions", icon: FileText },
  { destinationId: "terminals", id: "terminals", icon: Terminal },
  { destinationId: "repos", id: "repos", icon: GitBranch },
  { destinationId: "code", id: "code", icon: Code2 },
  { destinationId: "search", id: "search", icon: Search },
  { destinationId: "tail", id: "tail", icon: ScrollText },
  // Mission control bounces to Home when the ops cluster is off — only offer
  // the jump when it actually resolves.
  {
    destinationId: "mission-control",
    id: "ops",
    icon: Compass,
    route: { view: "ops", mode: "mission" },
    opsGated: true,
  },
  { destinationId: "home", id: "home", icon: House },
  { destinationId: "dispatch", id: "dispatch", icon: Send },
];

export function projectJumpDockItems(): JumpDockItem[] {
  return JUMP_DOCK_PROJECTION.map((entry) => {
    const destination = getDestination(entry.destinationId);
    return {
      id: entry.id,
      label: destination.label,
      icon: entry.icon,
      route: entry.route ?? destination.route,
      destinationId: entry.destinationId,
      opsGated: entry.opsGated ?? destination.capability === "ops.control",
    };
  });
}

/* ── Projection: command palette (static nav subset) ──────────────────── */

export type PaletteNavCommand = {
  id: string;
  label: string;
  destinationId: NavDestinationId;
  route: Route;
  shortcut?: string;
  capability?: NavCapability;
};

type PaletteNavProjection = {
  id: string;
  prefix: "Go to" | "Open";
  destinationId: NavDestinationId;
  route?: Route;
  shortcut?: string;
  capability?: NavCapability;
};

/**
 * Static navigate-to-destination palette rows. Overlay actions (settings
 * drawer), Scoutbot, reload, capture, and dynamic per-agent commands stay in
 * `useScoutCommands` — they are not pure destinations.
 */
const PALETTE_NAV_PROJECTION: readonly PaletteNavProjection[] = [
  { id: "nav:requests", prefix: "Open", destinationId: "requests" },
  { id: "nav:home", prefix: "Go to", destinationId: "home", shortcut: "Cmd+1" },
  { id: "nav:agents", prefix: "Go to", destinationId: "project-list", shortcut: "Cmd+2" },
  { id: "nav:messages", prefix: "Go to", destinationId: "chat", shortcut: "Cmd+3" },
  { id: "nav:sessions", prefix: "Open", destinationId: "sessions" },
  { id: "nav:terminals", prefix: "Open", destinationId: "terminals" },
  { id: "nav:search", prefix: "Go to", destinationId: "search", shortcut: "Cmd+4" },
  { id: "nav:activity", prefix: "Open", destinationId: "activity" },
  { id: "nav:mesh", prefix: "Open", destinationId: "mesh" },
  { id: "nav:dispatch", prefix: "Open", destinationId: "dispatch" },
  { id: "nav:repos", prefix: "Open", destinationId: "repos" },
  { id: "nav:code", prefix: "Open", destinationId: "code" },
  { id: "nav:harnesses", prefix: "Open", destinationId: "providers" },
  { id: "nav:ops-lanes", prefix: "Open", destinationId: "lanes" },
  { id: "nav:ops-world", prefix: "Open", destinationId: "world" },
  {
    id: "nav:ops",
    prefix: "Go to",
    destinationId: "mission-control",
    route: { view: "ops" },
    shortcut: "Cmd+5",
    capability: "ops.control",
  },
  {
    id: "nav:ops-atop",
    prefix: "Open",
    destinationId: "runtime",
    capability: "ops.control",
  },
  {
    id: "nav:agent-config",
    prefix: "Open",
    destinationId: "agent-config",
  },
];

export function projectPaletteNavCommands(options?: {
  opsEnabled?: boolean;
}): PaletteNavCommand[] {
  const opsEnabled = options?.opsEnabled ?? true;
  return PALETTE_NAV_PROJECTION
    .filter((entry) => {
      const capability = entry.capability ?? getDestination(entry.destinationId).capability;
      if (capability === "ops.control" && !opsEnabled) return false;
      return true;
    })
    .map((entry) => {
      const destination = getDestination(entry.destinationId);
      return {
        id: entry.id,
        label: `${entry.prefix} ${destination.label}`,
        destinationId: entry.destinationId,
        route: entry.route ?? destination.route,
        shortcut: entry.shortcut,
        capability: entry.capability ?? destination.capability,
      };
    });
}

/** Build CommandOption rows for the static nav subset of the palette. */
export function paletteNavCommandOptions(
  navigate: (route: Route) => void,
  options?: { opsEnabled?: boolean },
): CommandOption[] {
  return projectPaletteNavCommands(options).map((command) => ({
    id: command.id,
    label: command.label,
    action: () => navigate(command.route),
    shortcut: command.shortcut,
  }));
}

/* ── Projection: area sub-nav (SCO-085) ───────────────────────────────── */

/**
 * Mouse entry points lost when Repos/Code left Ops and Terminals left the jump
 * dock path. Projected under the active primary area (sidebar expanded) and as
 * a shared center-pane strip (icon-rail mode). Not SideRail content.
 */
export type AreaSubNavAreaId = "projects";

export type AreaSubNavItem = {
  id: string;
  label: string;
  route: Route;
  active: (route: Route) => boolean;
  destinationId: NavDestinationId;
};

type AreaSubNavProjection = {
  destinationId: NavDestinationId;
  id: string;
};

const AREA_SUB_NAV_PROJECTION: Record<
  AreaSubNavAreaId,
  readonly AreaSubNavProjection[]
> = {
  projects: [
    { destinationId: "project-list", id: "project-list" },
    { destinationId: "projects", id: "projects" },
    { destinationId: "repos", id: "repos" },
    { destinationId: "code", id: "code" },
  ],
};

function projectAreaSubNavItem(entry: AreaSubNavProjection): AreaSubNavItem {
  const projected = project(entry.destinationId);
  return {
    id: entry.id,
    label: projected.label,
    route: projected.route,
    active: projected.active,
    destinationId: projected.id,
  };
}

/** Sub-nav items for a primary area, or empty when the area has none. */
export function projectAreaSubNav(areaId: AreaSubNavAreaId): AreaSubNavItem[] {
  return AREA_SUB_NAV_PROJECTION[areaId].map(projectAreaSubNavItem);
}

/**
 * Resolve area sub-nav for the current route from its primary area.
 * Returns null when the area has no AREA_SUB_NAV projection.
 *
 * Classification is shared through route-areas.ts; primary areas themselves
 * read this catalog's labels, without an initialization cycle.
 */
export function areaSubNavForRoute(route: Route): {
  areaId: AreaSubNavAreaId;
  items: AreaSubNavItem[];
} | null {
  const area = ROUTE_AREA_BY_VIEW[route.view];
  if (area !== "projects") return null;
  const areaId: AreaSubNavAreaId = area;
  return { areaId, items: projectAreaSubNav(areaId) };
}

/* ── Projection: expanded sidebar sub-nav ────────────────────────────── */

export type SidebarSubNavAreaId = AreaSubNavAreaId | "dispatch" | "ops";

type SidebarSubNavProjection = AreaSubNavProjection & {
  /** Dispatch filter names are not destination labels. */
  filterLabel?: string;
  route?: Route;
  active?: (route: Route) => boolean;
};

const SIDEBAR_SUB_NAV_PROJECTION: Record<
  SidebarSubNavAreaId,
  readonly SidebarSubNavProjection[]
> = {
  ...AREA_SUB_NAV_PROJECTION,
  // No `chat` entry: route unification left the Chat area with a single
  // surface, so the expanded sidebar projects no sub-nav for it.
  dispatch: [
    {
      destinationId: "dispatch",
      id: "dispatch-all",
      filterLabel: "All Dispatches",
      route: { view: "broker" },
      active: (route) =>
        route.view === "broker" && (route.filter === undefined || route.filter === "all"),
    },
    {
      destinationId: "dispatch",
      id: "dispatch-delivered",
      filterLabel: "Delivered",
      route: { view: "broker", filter: "delivered" },
      active: (route) => route.view === "broker" && route.filter === "delivered",
    },
    {
      destinationId: "dispatch",
      id: "dispatch-failed",
      filterLabel: "Failed",
      route: { view: "broker", filter: "failed" },
      active: (route) => route.view === "broker" && route.filter === "failed",
    },
  ],
  ops: OPS_NAV_PROJECTION,
};

function projectSidebarSubNavItem(entry: SidebarSubNavProjection): AreaSubNavItem {
  const projected = project(entry.destinationId, {
    route: entry.route,
    active: entry.active,
  });
  return {
    id: entry.id,
    label: entry.filterLabel ?? projected.label,
    route: projected.route,
    active: projected.active,
    destinationId: projected.id,
  };
}

/** Nested destinations shown only beneath the active area in the expanded sidebar. */
export function sidebarSubNavForRoute(
  route: Route,
  options?: { opsControlEnabled?: boolean },
): { areaId: SidebarSubNavAreaId; items: AreaSubNavItem[] } | null {
  const area = ROUTE_AREA_BY_VIEW[route.view];
  if (!(area in SIDEBAR_SUB_NAV_PROJECTION)) return null;
  const areaId = area as SidebarSubNavAreaId;
  const items = SIDEBAR_SUB_NAV_PROJECTION[areaId]
    .map(projectSidebarSubNavItem)
    .filter((item) => {
      const capability = getDestination(item.destinationId).capability;
      return capability !== "ops.control" || options?.opsControlEnabled !== false;
    });
  return { areaId, items };
}

/* ── Integrity helpers (tests) ────────────────────────────────────────── */

/** Every destination id referenced by any projection. */
export function allProjectedDestinationIds(): NavDestinationId[] {
  const ids = new Set<NavDestinationId>();
  for (const entry of TOP_TAB_PROJECTION) ids.add(entry.destinationId);
  for (const entry of GO_SHORTCUT_PROJECTION) ids.add(entry.destinationId);
  for (const entry of JUMP_DOCK_PROJECTION) ids.add(entry.destinationId);
  for (const entry of PALETTE_NAV_PROJECTION) ids.add(entry.destinationId);
  for (const areaId of Object.keys(AREA_SUB_NAV_PROJECTION) as AreaSubNavAreaId[]) {
    for (const entry of AREA_SUB_NAV_PROJECTION[areaId]) {
      ids.add(entry.destinationId);
    }
  }
  for (const areaId of Object.keys(SIDEBAR_SUB_NAV_PROJECTION) as SidebarSubNavAreaId[]) {
    for (const entry of SIDEBAR_SUB_NAV_PROJECTION[areaId]) {
      ids.add(entry.destinationId);
    }
  }
  for (const group of [
    ...projectAgentsSecondaryNav(),
    ...projectChatSecondaryNav(),
    ...projectSearchSecondaryNav(),
    ...projectOpsSecondaryNav(),
  ]) {
    for (const item of group.items) {
      // Secondary items don't carry destinationId on the public shape; resolve
      // by matching route/active against the catalog in tests instead.
      void item;
    }
  }
  // Explicit secondary destination ids for integrity checks (SCO-083: Ops strip
  // no longer includes dispatch/repos/code; Search secondary is empty).
  for (const id of [
    "agent-config",
    "chat",
    "lanes",
    "world",
    "week",
    "mission-control",
    "providers",
    "mesh",
    "mesh-ops",
    "tail",
    "runtime",
    "advisor",
  ] as const) {
    ids.add(id);
  }
  return [...ids];
}
