/**
 * The companion's own read of the agent roster and cast identity.
 *
 * The desktop companion runs on its own entry (`companion.html`) without
 * `ScoutProvider`, so it reads the two things it used from that provider —
 * the roster and who the operator is — directly. The shape satisfies
 * `CastScope`, so figures resolve characters exactly as the app's avatars do.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api.ts";
import { AGENT_ROSTER_EVENT_KINDS, matchesKinds } from "../../lib/broker-event-kinds.ts";
import { useBrokerRefresh, type BrokerRefreshPolicy } from "../../lib/broker-refresh.ts";
import type { CastScope } from "../../lib/cast-slug.ts";
import { readCachedOperatorName, writeCachedOperatorName } from "../../lib/operator-identity.ts";
import { SCOUT_THEME_STORAGE_KEY, resolveScoutStartupAppearanceDetails } from "../../lib/theme.ts";
import type { Agent } from "../../lib/types.ts";

const ROSTER_URL = "/api/agents?detail=summary";
/** The app's roster policy: roster events and stream reconnects refresh it;
 *  online/offline can change without an event, so a slow net stays. The
 *  panel is shown without ever taking focus, so visible is enough. */
const ROSTER_REFRESH_POLICY: BrokerRefreshPolicy = {
  matches: matchesKinds(AGENT_ROSTER_EVENT_KINDS),
  activeWhen: "visible",
  fallbackPollMs: 30_000,
  livePollMs: 60_000,
};

export type CompanionRoster = Omit<CastScope, "agents"> & { agents: Agent[] };

function sameJson<T>(previous: T, next: T): boolean {
  try {
    return JSON.stringify(previous) === JSON.stringify(next);
  } catch {
    return false;
  }
}

export function useCompanionRoster(): CompanionRoster {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [operatorName, setOperatorName] = useState<string | null>(readCachedOperatorName);
  const [appearanceDetails, setAppearanceDetails] = useState(resolveScoutStartupAppearanceDetails);

  const reload = useCallback(async () => {
    try {
      const next = await api<Agent[]>(ROSTER_URL);
      setAgents((previous) => (sameJson(previous, next) ? previous : next));
    } catch {
      // Keep the last roster; the companion's own reads report reachability.
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useBrokerRefresh(() => void reload(), ROSTER_REFRESH_POLICY);

  useEffect(() => {
    let cancelled = false;
    void api<{ operatorName?: string | null; operatorNameSuggestion?: string | null }>("/api/onboarding/state")
      .then((state) => {
        if (cancelled) return;
        const resolved = state.operatorName?.trim() || state.operatorNameSuggestion?.trim() || null;
        setOperatorName(resolved);
        writeCachedOperatorName(resolved);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // A character picked in the app's settings reaches the panel without a reload.
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== null && event.key !== SCOUT_THEME_STORAGE_KEY) return;
      setAppearanceDetails(resolveScoutStartupAppearanceDetails());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  return useMemo(() => ({ agents, operatorName, appearanceDetails }), [agents, operatorName, appearanceDetails]);
}
