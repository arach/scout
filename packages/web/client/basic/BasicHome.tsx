import type { ReactNode } from "react";

import { BrokerScreen } from "../screens/broker/BrokerScreen.tsx";
import { HomeContent, SectionRule } from "../screens/home/content.tsx";
import type { Route } from "../lib/types.ts";
import { useScout } from "../scout/Provider.tsx";

/**
 * Home: what's moving across the fleet, then the delivery ledger. A native
 * host's Home embed carries the ledger; the browser shell gives it its own
 * Dispatch page instead.
 */
export function BasicHome({
  navigate: navigateOverride,
  lead,
  deliveries = true,
}: {
  navigate?: (route: Route) => void;
  /** Next-step strip; the browser shell passes one, a native host's embed doesn't. */
  lead?: ReactNode;
  deliveries?: boolean;
} = {}) {
  const { route, navigate: scoutNavigate } = useScout();
  // A native host owns navigation when Home is embedded.
  const navigate = navigateOverride ?? scoutNavigate;
  const attemptId = route.view === "broker" ? route.attemptId : undefined;

  return (
    <HomeContent navigate={navigate} basic lead={lead}>
      {deliveries && <section className="s-fleet-section sb-deliveries" aria-label="Deliveries">
        <SectionRule label="Deliveries" />
        <BrokerScreen navigate={navigate} basic initialAttemptId={attemptId} />
      </section>}
    </HomeContent>
  );
}

/** Dispatch: the delivery ledger as its own page. Filters ride `/dispatch?filter=…`. */
export function BasicDispatch() {
  const { route, navigate } = useScout();
  const attemptId = route.view === "broker" ? route.attemptId : undefined;
  return (
    <div className="sb-dispatch">
      <BrokerScreen navigate={navigate} basic initialAttemptId={attemptId} />
    </div>
  );
}
