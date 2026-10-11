import { Component, lazy, Suspense, useEffect, useState, type CSSProperties, type ErrorInfo, type ReactNode } from "react";

import { RailToggle } from "../components/RailToggle.tsx";
import { SidebarProvider } from "../components/ui/sidebar.tsx";
import { SCOUT_TERMINAL_HEADER_SLOT_IDS } from "../screens/terminal/TerminalHeaderMount.tsx";
import { api } from "../lib/api.ts";
import { useScout } from "../scout/Provider.tsx";
import { OnboardingTakeover } from "../scout/takeover/OnboardingTakeover.tsx";
import { onboardingTakeoverActive } from "../scout/takeover/onboarding-gate.ts";
import { ScoutSidebar } from "../scout/sidebar/ScoutSidebar.tsx";
import {
  RAIL_TOGGLE_HEADER_TOP,
  SIDEBAR_COLLAPSED_WIDTH,
  railToggleOffset,
  useSidebarCollapse,
} from "../scout/sidebar/useSidebarCollapse.ts";
import { BasicDms } from "./BasicDms.tsx";
import { BasicDispatch, BasicHome } from "./BasicHome.tsx";
import { BasicNextStep } from "./BasicNextStep.tsx";
import { BasicTail } from "./BasicTail.tsx";
import { basicArea, SOLO_AREA_ROUTES, SOLO_SIDEBAR_AREAS } from "./profile.ts";

/** The page set the Mac app embeds from basic; loaded only when opened. */
const BasicSettings = lazy(async () => {
  const { ScoutSettings } = await import("../screens/settings/ScoutSettings.tsx");
  function BasicSettings() {
    const { route, navigate } = useScout();
    const section = route.view === "settings" && route.section && route.section !== "agents" && route.section !== "pairing"
      ? route.section
      : "operator";
    return (
      <ScoutSettings
        section={section}
        onSectionChange={(next) => navigate({ view: "settings", section: next })}
        navigate={navigate}
        frame="flat"
      />
    );
  }
  return { default: BasicSettings };
});

const SessionsContent = lazy(() => import("../screens/sessions/content.tsx").then((module) => ({ default: module.SessionsContent })));
const TerminalContent = lazy(() => import("../screens/terminal/Terminal.tsx").then((module) => ({ default: module.TerminalContent })));
const SearchContent = lazy(() => import("../screens/search/content.tsx").then((module) => ({ default: module.SearchContent })));
const BasicLanes = lazy(async () => {
  const { AgentLanesView } = await import("../screens/ops/AgentLanesView.tsx");
  function BasicLanes() {
    const { agents, navigate } = useScout();
    return <AgentLanesView navigate={navigate} agents={agents} />;
  }
  return { default: BasicLanes };
});
const WorkDetailScreen = lazy(() => import("../screens/work/WorkDetailScreen.tsx").then((module) => ({ default: module.WorkDetailScreen })));
const FollowScreen = lazy(() => import("../screens/follow/FollowScreen.tsx").then((module) => ({ default: module.FollowScreen })));


export function BasicApp() {
  const { route, navigate, onboarding, onboardingSkipped } = useScout();
  const area = basicArea(route);
  // Same gate as the full shell's takeover slot: first run owns the page
  // until it's finished or set aside ("Set up later" stays on every step).
  const takeover = onboardingTakeoverActive(onboarding, onboardingSkipped) === true;
  const viewportWidth = useViewportWidth();
  // The full app's sidebar, state and widths; the basic build just serves fewer areas.
  const sidebar = useSidebarCollapse("scout-solo", viewportWidth, SIDEBAR_COLLAPSED_WIDTH);
  const navWidth = takeover ? 0 : sidebar.width;
  useSidebarChrome(!takeover);

  return (
    <div
      className="sb-shell"
      data-scout-theme
      style={{ "--sb-nav-width": `${navWidth}px` } as CSSProperties}
    >
      {!takeover && (
        <>
          <SidebarProvider
            open={!sidebar.effectiveCollapsed}
            onOpenChange={(open) => sidebar.setCollapsed(!open)}
            style={
              {
                "--sidebar-width": `${sidebar.expandedWidth}px`,
                "--sidebar-width-icon": `${SIDEBAR_COLLAPSED_WIDTH}px`,
                "--scout-sidebar-top": "0px",
                "--scout-sidebar-bottom": "0px",
              } as CSSProperties
            }
          >
            <ScoutSidebar
              areas={SOLO_SIDEBAR_AREAS}
              areaRoutes={SOLO_AREA_ROUTES}
              subNav={false}
              showRequests={false}
              onNewTask={() => navigate({ view: "messages" })}
            />
          </SidebarProvider>
          <RailToggle
            side="left"
            collapsed={sidebar.effectiveCollapsed}
            label="Sidebar"
            onToggle={sidebar.toggleCollapsed}
            className="scout-rail-toggle--band"
            style={{
              position: "fixed",
              left: railToggleOffset(sidebar.width, sidebar.effectiveCollapsed, SIDEBAR_COLLAPSED_WIDTH),
              top: RAIL_TOGGLE_HEADER_TOP,
              zIndex: 46,
            }}
          />
        </>
      )}
      <header className="sb-header">
        <BrokerStatus />
      </header>
      {!takeover && area === "terminal" && (
        <div className="sb-terminal-toolbar" aria-label="Terminal controls">
          <div id={SCOUT_TERMINAL_HEADER_SLOT_IDS.crumb} />
          <div id={SCOUT_TERMINAL_HEADER_SLOT_IDS.search} />
          <div id={SCOUT_TERMINAL_HEADER_SLOT_IDS.actions} />
        </div>
      )}
      {takeover ? (
        <main className="sb-main sb-main--setup" aria-label="First-run setup">
          <OnboardingTakeover />
        </main>
      ) : (
        <main className={`sb-main sb-main--${area}`}>
          {route.view === "work" ? <Suspense fallback={null}><WorkDetailScreen key={route.workId} workId={route.workId} navigate={navigate} /></Suspense>
            : route.view === "follow" ? <Suspense fallback={null}><FollowScreen route={route} navigate={navigate} /></Suspense>
            : area === "home" && <BasicHome lead={<BasicNextStep />} deliveries={false} />}
          {area === "dms" && <BasicDms />}
          {area === "sessions" && <Suspense fallback={null}><SessionsContent route={route} navigate={navigate} /></Suspense>}
          {area === "terminal" && route.view === "terminal" && (
            <Suspense fallback={null}><TerminalContent route={route} navigate={navigate} compact /></Suspense>
          )}
          {area === "dispatch" && <BasicDispatch />}
          {area === "search" && <Suspense fallback={null}><SearchContent route={route} navigate={navigate} /></Suspense>}
          {area === "ops" && (
            <div className="sb-ops">
              <nav className="sb-ops-nav" aria-label="Operations views">
                {(["lanes", "tail"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className="btn"
                    aria-current={route.view === "ops" && route.mode === mode ? "page" : undefined}
                    onClick={() => navigate({ view: "ops", mode })}
                  >
                    {mode === "lanes" ? "Lanes" : "Tail"}
                  </button>
                ))}
              </nav>
              <div className="sb-ops-body">
                {route.view === "ops" && route.mode === "tail"
                  ? <BasicTail />
                  : <Suspense fallback={null}><BasicLanes /></Suspense>}
              </div>
            </div>
          )}
          {area === "settings" && (
            <Suspense fallback={null}>
              <BasicSettings />
            </Suspense>
          )}
        </main>
      )}
    </div>
  );
}

/** The full shell's sidebar chrome rules (brand band, rail cells) key off this. */
function useSidebarChrome(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    document.documentElement.setAttribute("data-scout-sidebar-chrome", "");
    return () => document.documentElement.removeAttribute("data-scout-sidebar-chrome");
  }, [active]);
}

function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1280));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

type BrokerHealth = { reachable: boolean; ok: boolean; error: string | null };

const BROKER_HEALTH_POLL_MS = 15_000;

/** Live broker liveness; null until known, or when this server predates the route. */
function useBrokerHealth(): BrokerHealth | null {
  const [health, setHealth] = useState<BrokerHealth | null>(null);
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      api<BrokerHealth>("/api/broker/health")
        .then((next) => { if (!cancelled) setHealth(next); })
        .catch(() => { if (!cancelled) setHealth(null); });
    };
    check();
    const timer = window.setInterval(check, BROKER_HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  return health;
}

function BrokerStatus() {
  const { apiConnection, onlineCount, agentsLoaded, operatorName } = useScout();
  const broker = useBrokerHealth();
  const offline = apiConnection.status === "offline";
  const tone = offline || broker?.reachable === false
    ? "error"
    : apiConnection.status === "degraded" || broker?.ok === false
      ? "warn"
      : apiConnection.status === "online"
        ? "ok"
        : "idle";
  const label = offline
    ? "Scout offline"
    : broker?.reachable === false
      ? "Broker unreachable"
      : broker?.ok === false
        ? "Broker degraded"
        : apiConnection.status === "degraded"
          ? "Scout degraded"
          : apiConnection.status === "online"
            ? broker ? "Broker up" : "Scout up"
            : "Connecting";
  const title = broker?.error ?? apiConnection.message ?? undefined;
  return (
    <div className="sb-status" title={title}>
      <span className={`sb-status-dot sb-status-dot--${tone}`} aria-hidden="true" />
      <span className="sb-status-label">{label}</span>
      {agentsLoaded && tone === "ok" && (
        <span className="sb-status-meta">{onlineCount} online</span>
      )}
      {operatorName && <span className="sb-status-meta sb-status-operator">@{operatorName}</span>}
    </div>
  );
}

export class BasicBootErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[openscout] basic app render failed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="sb-crash">
        <h1>Scout could not render this view</h1>
        <pre>{this.state.error.message}</pre>
        <button type="button" onClick={() => window.location.assign("/")}>Back to Home</button>
      </main>
    );
  }
}
