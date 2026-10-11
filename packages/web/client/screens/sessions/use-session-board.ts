import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api.ts";
import { isBrokerDataEvent, useBrokerEventsRefresh } from "../../lib/sse.ts";
import { useTailEvents } from "../../lib/tail-events.ts";
import { useOperatorRequests } from "../../lib/use-operator-requests.ts";
import type { MeshStatus, SessionEntry, TailDiscoverySnapshot, TailEvent } from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import { buildSessionBoardRows, stableSessionOrder } from "./session-board-model.ts";

export function useSessionBoard() {
  const { agents, operatorName } = useScout();
  const requests = useOperatorRequests();
  const [conversations, setConversations] = useState<SessionEntry[]>([]);
  const [discovery, setDiscovery] = useState<TailDiscoverySnapshot | null>(null);
  const [events, setEvents] = useState<TailEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const [localNodeId, setLocalNodeId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void api<MeshStatus>("/api/mesh").then((mesh) => { if (!cancelled) setLocalNodeId(mesh.localNode?.id ?? mesh.health.nodeId); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const mounted = useRef(false); const pending = useRef(false);
  const order = useRef<string[]>([]);
  const refresh = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    const results = await Promise.allSettled([
      api<SessionEntry[]>("/api/sessions"),
      api<SessionEntry[]>("/api/conversations?limit=250"),
      api<TailDiscoverySnapshot>("/api/tail/discover"),
      api<{ events: TailEvent[] }>("/api/tail/recent?limit=1000&transcripts=true"),
    ]);
    pending.current = false;
    if (!mounted.current) return;
    const [legacy, comms, discovered, recent] = results;
    if (legacy.status === "fulfilled" || comms.status === "fulfilled") {
      const byId = new Map((legacy.status === "fulfilled" ? legacy.value : []).map((s) => [s.id, s]));
      if (comms.status === "fulfilled") for (const session of comms.value) byId.set(session.id, { ...byId.get(session.id), ...session });
      setConversations([...byId.values()]);
    }
    if (discovered.status === "fulfilled") setDiscovery(discovered.value);
    if (recent.status === "fulfilled") setEvents((current) => [...new Map([...recent.value.events, ...current].map((e) => [e.id, e])).values()].sort((a, b) => a.ts - b.ts).slice(-1000));
    setError(results.some((r) => r.status === "rejected") ? "Some session sources are unavailable. Showing the last successful reads; Refresh to retry." : null);
    setLoading(false); setNow(Date.now());
  }, []);
  useEffect(() => {
    mounted.current = true; void refresh(); const timer = setInterval(() => void refresh(), 15_000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [refresh]);
  useBrokerEventsRefresh(isBrokerDataEvent, () => { void refresh(); }, 1_000);
  useTailEvents((event) => setEvents((current) => [...current.filter((e) => e.id !== event.id), event].slice(-1000)));
  const rows = useMemo(() => {
    const next = buildSessionBoardRows({ conversations, transcripts: discovery?.transcripts ?? [], events, agents, attention: requests.state?.items ?? [], now, operatorName, localNodeId });
    order.current = stableSessionOrder(order.current, next);
    const byId = new Map(next.map((r) => [r.key, r]));
    return order.current.map((key) => byId.get(key)!);
  }, [conversations, discovery, events, agents, requests.state, now, operatorName, localNodeId]);
  return { rows, loading, error, refresh, now, requests, localNodeId };
}
