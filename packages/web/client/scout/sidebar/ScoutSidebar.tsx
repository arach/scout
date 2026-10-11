/**
 * Scout primary navigation chrome (SCO-084 / SCO-085) — shadcn Sidebar composition.
 *
 * Stable app chrome only (Requirement 7 revised 2026-07-20 / SCO-086):
 * destinations, scope items, and the global New task launcher. Per-area context
 * content lives in the left HudsonKit SidePanel (side rail), not here — do not
 * re-introduce a Context group.
 *
 * SCO-085 full-height: brand strip at window top (titleBarInset padding),
 * drag region on the brand strip. Settings is a primary area.
 *
 * SCO-087: the app-wide top row (right of the sidebar) owns machine scope, the
 * ⌘K trigger and the settings accelerator — they are NOT in the sidebar footer
 * anymore (machine scope: exactly one instance, in the top row). The sidebar
 * edge chevron (RailToggle) is also rendered by the shell so it can ride the
 * ghost edge during drag-resize; the sidebar body is pure presentation.
 *
 * SCO-086: logo is static (click → Home, never a toggle).
 *
 * Gated by nav.sidebar; renders exactly one chrome tree vs legacy left panel.
 * State (open/collapsed) is owned by useSidebarCollapse via SidebarProvider;
 * this file is presentation only. Default presentation is the 48px icon rail.
 *
 * HudsonKit SidePanel is intentionally separate (side rail / right inspector /
 * legacy left). Do not route this chrome through SidePanel.
 */
import type { CSSProperties, HTMLAttributes } from "react";
import { usePlatform } from "@hudsonkit";
import { Bell, Plus, Inbox } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "../../components/ui/sidebar.tsx";
import {
  NEW_CHAT_SHORTCUT_LABEL,
  NEW_TASK_ACTION_LABEL,
} from "../../lib/new-chat-shortcut.ts";
import { cn } from "../../lib/utils.ts";
import type { Route } from "../../lib/types.ts";
import { useScout } from "../Provider.tsx";
import {
  PRIMARY_AREAS,
  defaultRouteForArea,
  getPrimaryArea,
  primaryAreaForRoute,
  type PrimaryArea,
  type PrimaryAreaId,
  type NavigationEntryId,
} from "../primary-areas.ts";
import {
  sidebarSubNavForRoute,
  type SidebarSubNavAreaId,
} from "../nav-destinations.ts";
import { useOptionalFlag } from "hudsonkit/flags";
import { useSidebarModel } from "./useSidebarModel.ts";
import { useOperatorRequests } from "../../lib/use-operator-requests.ts";
import { RequestsCount } from "../../screens/requests/RequestsCount.tsx";
import { requestsCountState } from "../../screens/requests/requests-model.ts";
import { getDestination } from "../nav-destinations.ts";
import "../../screens/requests/requests.css";
import { ScoutMark } from "../../components/ScoutMark.tsx";

const ACTIVE_MENU_CLASS =
  "data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-accent-foreground";

function AreaMenuItems({
  areas,
  activeAreaId,
  onNavigateArea,
  route,
  navigate,
  opsControlEnabled,
  subNav: showSubNav,
  presentation,
}: {
  areas: readonly PrimaryArea[];
  activeAreaId: NavigationEntryId;
  onNavigateArea: (id: PrimaryAreaId) => void;
  route: Route;
  navigate: (route: Route) => void;
  opsControlEnabled: boolean;
  subNav: boolean;
  presentation: "scout" | "slack";
}) {
  const { state } = useSidebar();
  const expanded = state === "expanded";
  const subNav = showSubNav ? sidebarSubNavForRoute(route, { opsControlEnabled }) : null;

  return (
    <SidebarMenu>
      {areas.map((area) => {
        const slackHome = presentation === "slack" && area.id === "home";
        const slackActivity = presentation === "slack" && area.id === "chat";
        const projectedAreaId = slackHome ? "chat" : slackActivity ? "home" : area.id;
        const Icon = slackActivity ? Bell : area.icon;
        const label = slackActivity ? "Activity" : area.label;
        const active = projectedAreaId === activeAreaId;
        const areaSub =
          expanded &&
          active &&
          subNav &&
          (subNav.areaId as string) === projectedAreaId
            ? subNav.items
            : null;
        return (
          <SidebarMenuItem key={area.id}>
            <SidebarMenuButton
              type="button"
              isActive={active}
              tooltip={label}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              data-area={area.id}
              className={cn(
                "font-mono text-sm font-medium tracking-[0.02em]",
                ACTIVE_MENU_CLASS,
              )}
              onClick={() => onNavigateArea(area.id)}
            >
              <Icon size={16} strokeWidth={1.6} aria-hidden />
              <span>{label}</span>
            </SidebarMenuButton>
            {areaSub && areaSub.length > 0 ? (
              <SidebarMenuSub>
                {areaSub.map((item) => {
                  const itemActive = item.active(route);
                  return (
                    <SidebarMenuSubItem key={item.id}>
                      <SidebarMenuSubButton
                        render={<button type="button" />}
                        isActive={itemActive}
                        aria-current={itemActive ? "page" : undefined}
                        data-subnav={item.id}
                        className="font-mono text-xs"
                        onClick={() => navigate(item.route)}
                      >
                        <span>{item.label}</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  );
                })}
              </SidebarMenuSub>
            ) : null}
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

export function ScoutSidebar({
  brandLabel = "Scout",
  presentation = "scout",
  areas,
  areaRoutes,
  subNav = true,
  showRequests = true,
  onNewTask,
}: {
  /**
   * Fixed product brand (usually app.name / "Scout"). Scope's active section
   * label is NOT a brand — scope destinations live in the model body.
   */
  brandLabel?: string;
  presentation?: "scout" | "slack";
  /**
   * The areas this build serves, when it serves fewer than all of them (basic).
   * Same sidebar, same order and labels; areas outside the set are left out,
   * so adding a surface to a build is adding its id here.
   */
  areas?: readonly PrimaryAreaId[];
  /** Where an area opens in this build, when not the full app's default (basic's Ops is Lanes). */
  areaRoutes?: Partial<Record<PrimaryAreaId, Route>>;
  /** Area sub-destinations under the active row; a build that serves only the area's front page turns them off. */
  subNav?: boolean;
  /** Requests lives on the full shell; a build without it hides the row. */
  showRequests?: boolean;
  /** The build's own "new task" when it has no context-capture overlay. */
  onNewTask?: () => void;
}) {
  const { route, navigate, openSettings, openContextCapture } = useScout();
  const { titleBarInset, dragRegionProps, onInteractiveMouseDown } = usePlatform();
  const opsControlEnabled = useOptionalFlag("ops.control", true);
  const model = useSidebarModel(route);
  const attention = useOperatorRequests();
  const requestsCount = requestsCountState(attention.state?.items.length ?? 0);
  const requestsLabel = getDestination("requests").label;
  const activeAreaId = primaryAreaForRoute(route);
  const served = (area: PrimaryArea) => !areas || areas.includes(area.id);
  const navigateAreas = PRIMARY_AREAS.filter((a) => a.section === "navigate" && served(a));
  // SCO-088c §2: Settings is pinned at the sidebar bottom (see footer), so it is
  // removed from the SYSTEM nav list — it must live exactly once. SYSTEM keeps Ops.
  const systemAreas = PRIMARY_AREAS.filter(
    (a) => a.section === "system" && a.id !== "settings" && served(a),
  );
  const settingsArea = getPrimaryArea("settings");
  const SettingsIcon = settingsArea.icon;
  const settingsActive = activeAreaId === "settings";

  const goHome = () =>
    navigate(presentation === "slack" ? { view: "messages" } : { view: "inbox" });
  const startNewTask = () => (onNewTask ? onNewTask() : openContextCapture());
  const goArea = (id: PrimaryAreaId) => {
    if (presentation === "slack" && id === "home") {
      if (activeAreaId === "chat") return;
      navigate({ view: "messages" });
      return;
    }
    if (presentation === "slack" && id === "chat") {
      if (activeAreaId === "home") return;
      navigate({ view: "activity" });
      return;
    }
    // Stay put if already in the area (preserve deep links).
    if (primaryAreaForRoute(route) === id) return;
    navigate(areaRoutes?.[id] ?? defaultRouteForArea(id, { opsControlEnabled }));
  };

  return (
    <Sidebar
      side="left"
      variant="sidebar"
      collapsible="icon"
      aria-label={model.kind === "scope" ? "Scope navigation" : "Primary navigation"}
      data-sidebar-kind={model.kind}
      data-presentation={presentation}
    >
      {/* Brand strip: drag region + titleBarInset so macOS traffic lights clear.
          SCO-087b: the brand band is pinned to the shared 44px top grid line
          (see app.css brand-row rule); titleBarInset is the only top padding so
          the SCOUT baseline lines up with the side-rail header + title bar. */}
      <SidebarHeader
        className="border-b border-sidebar-border"
        style={{
          paddingTop: titleBarInset || 0,
          ...((dragRegionProps as { style?: CSSProperties } | undefined)?.style ?? {}),
        }}
        {...(Object.fromEntries(
          Object.entries((dragRegionProps ?? {}) as Record<string, unknown>).filter(
            ([key]) => key !== "style",
          ),
        ) as HTMLAttributes<HTMLDivElement>)}
        data-sidebar-drag-region=""
      >
        {/* Static logo — click → Home, never a collapse toggle (SCO-086). */}
        <div className="flex items-center gap-0.5" data-sidebar="brand-row">
          <SidebarMenu className="min-w-0 flex-1">
            <SidebarMenuItem>
              <SidebarMenuButton
                type="button"
                size="lg"
                tooltip="Home"
                onClick={goHome}
                onMouseDown={onInteractiveMouseDown}
                aria-label="Scout Home"
                title="Home"
                className={cn(
                  "data-[slot=sidebar-menu-button]:!p-2",
                  presentation === "slack" ? "font-sans" : "font-mono",
                )}
              >
                <ScoutMark className="size-[22px] shrink-0" />
                <span className={cn(
                  "truncate text-sm font-bold",
                  presentation === "slack" ? "tracking-[-0.01em]" : "tracking-[0.08em] uppercase",
                )}>
                  {brandLabel}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0">
        <SidebarGroup className="border-b border-sidebar-border">
          <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              tooltip={`${NEW_TASK_ACTION_LABEL} (${NEW_CHAT_SHORTCUT_LABEL})`}
              aria-label={NEW_TASK_ACTION_LABEL}
              aria-keyshortcuts={NEW_CHAT_SHORTCUT_LABEL}
              data-action="new-task"
              className="font-mono text-sm font-semibold tracking-[0.02em] [&_svg]:text-[var(--hud-accent)]"
              onClick={startNewTask}
            >
              <Plus size={16} strokeWidth={1.8} aria-hidden />
              <span>{NEW_TASK_ACTION_LABEL}</span>
            </SidebarMenuButton>
            <SidebarMenuBadge className="font-mono text-2xs text-sidebar-foreground/55">
              {NEW_CHAT_SHORTCUT_LABEL}
            </SidebarMenuBadge>
          </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        {model.kind === "scope" ? (
          <SidebarGroup>
            {/* Column header — see data-sidebar-head note on the Navigate group. */}
            <SidebarGroupLabel data-sidebar-head="" className="font-mono uppercase">
              Surfaces
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {model.items.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      type="button"
                      isActive={item.active}
                      tooltip={item.label}
                      aria-current={item.active ? "page" : undefined}
                      data-area={item.id}
                      aria-label={item.label}
                      title={item.label}
                      className={cn(
                        "font-mono text-sm font-medium",
                        ACTIVE_MENU_CLASS,
                      )}
                      onClick={() => navigate(item.route)}
                    >
                      {/* Scope items have no icons — initial-letter fallback for icon rail. */}
                      <span
                        className="flex size-4 shrink-0 items-center justify-center text-sm font-bold uppercase"
                        aria-hidden
                      >
                        {item.label.slice(0, 1)}
                      </span>
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          <>
            <SidebarGroup>
              {/* data-sidebar-head: this is the rail's COLUMN header, not an
                  in-list group label. It sits on the same grid line as the side
                  rail's ("HOME") and inspector's ("CONTEXT") panel headers, so
                  app.css gives it the same 44px band, dashed hairline and
                  eyebrow type. SYSTEM below stays a quiet divider — it groups a
                  list, it does not head the column. */}
              <SidebarGroupLabel data-sidebar-head="" className="font-mono uppercase">
                Navigate
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <AreaMenuItems
                  areas={navigateAreas}
                  activeAreaId={activeAreaId}
                  onNavigateArea={goArea}
                  route={route}
                  navigate={navigate}
                  opsControlEnabled={opsControlEnabled}
                  subNav={subNav}
                  presentation={presentation}
                />
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel className="font-mono text-2xs tracking-[0.12em] uppercase">
                System
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <AreaMenuItems
                  areas={systemAreas}
                  activeAreaId={activeAreaId}
                  onNavigateArea={goArea}
                  route={route}
                  navigate={navigate}
                  opsControlEnabled={opsControlEnabled}
                  subNav={subNav}
                  presentation={presentation}
                />
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        {/* Requests and Settings stay pinned here across every route — utilities,
            not primary areas. In the icon rail they remain deterministic
            targets with hover tooltips. */}
        <SidebarMenu className="gap-1">
          {showRequests ? <SidebarMenuItem>
            <SidebarMenuButton type="button" isActive={route.view === "requests"} tooltip={requestsLabel}
              aria-label={`${requestsLabel}, ${requestsCount.count} open`} aria-current={route.view === "requests" ? "page" : undefined}
              data-entry="requests" className={cn("scout-requests-nav-row font-mono text-sm", ACTIVE_MENU_CLASS)}
              onClick={() => navigate({ view: "requests" })}>
              <Inbox size={16} strokeWidth={1.6} aria-hidden /><span className="scout-requests-nav-label">{requestsLabel}</span>
              <RequestsCount count={requestsCount.count} navigation pending={attention.loading && !attention.state} />
            </SidebarMenuButton>
          </SidebarMenuItem> : null}
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              isActive={settingsActive}
              tooltip={settingsArea.label}
              aria-label={settingsArea.label}
              aria-current={settingsActive ? "page" : undefined}
              data-area="settings"
              className={cn(
                "font-mono text-sm font-medium tracking-[0.02em]",
                ACTIVE_MENU_CLASS,
              )}
              onClick={() => openSettings()}
            >
              <SettingsIcon size={16} strokeWidth={1.6} aria-hidden />
              <span>{settingsArea.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

/** Hook-friendly active area for tests / consumers. */
export function sidebarActiveAreaId(route: Route): NavigationEntryId {
  return primaryAreaForRoute(route);
}

/** Area sub-nav area ids used by the sidebar projection (tests). */
export type { SidebarSubNavAreaId };
