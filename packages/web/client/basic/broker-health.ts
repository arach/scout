import { useEffect, useState } from "react";

import { api } from "../lib/api.ts";

export type BrokerHealth = { reachable: boolean; ok: boolean; error: string | null; persistenceIdentity?: string | null };

const BROKER_HEALTH_POLL_MS = 15_000;

/** Live broker liveness; null until known, or when this server predates the route. */
export function useBrokerHealth(refreshKey = 0): BrokerHealth | null {
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
  }, [refreshKey]);
  return health;
}
