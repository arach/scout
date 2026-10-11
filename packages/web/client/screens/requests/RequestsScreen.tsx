/**
 * Requests extends Industrial II: one quiet column of stable request cards,
 * not a second dashboard. Source links and pairing approval decisions are real;
 * missing history, context and waiting-start data are never fabricated.
 */
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import type { OperatorAttentionItem, Route } from "../../lib/types.ts";
import { useOperatorRequests } from "../../lib/use-operator-requests.ts";
import { refreshRequests } from "../../lib/operator-requests-store.ts";
import { getDestination } from "../../scout/nav-destinations.ts";
import { defineSurface } from "../../surfaces/types.ts";
import { requestActionLabel, requestActions, requestKind, requestUpdatedAge, requestsCountState } from "./requests-model.ts";
import { RequestsCount } from "./RequestsCount.tsx";
import { useRequestActions } from "./use-request-actions.ts";
import "./requests.css";

function RequestCard({ item, now, navigate }: { item: OperatorAttentionItem; now: number; navigate: (route: Route) => void }) {
  const { busy, error, sent, answer, act } = useRequestActions(item, (action) => navigate(action.route!));
  return <article className="scout-request-card" aria-labelledby={`request-${encodeURIComponent(item.id)}`} aria-busy={busy}>
    <header>
      <span className="scout-request-kind">{requestKind(item)}</span>
      <strong>{item.agentName ?? item.agentId ?? "Agent not supplied"}</strong>
      <span className="scout-request-age">{requestUpdatedAge(item.updatedAt, now)}</span>
    </header>
    <div className="scout-request-meta">{item.sourceLabel}{item.approval ? ` · ${item.approval.sessionName}` : ""}</div>
    <h2 id={`request-${encodeURIComponent(item.id)}`}>{item.title}</h2>
    {item.summary && item.summary !== item.title ? <p>{item.summary}</p> : null}
    {item.detail && item.detail !== item.summary ? <p className="scout-request-detail">{item.detail}</p> : null}
    <div className="scout-request-actions">
      {sent ? <span className="scout-request-meta">Answered: {sent}</span>
        : item.answer?.options.map((option) => <Button key={`answer:${option}`} variant="outline" size="sm" disabled={busy} onClick={() => void answer(option)}>{option}</Button>)}
      {requestActions(item).map((action, index) => <Button key={`${action.kind}:${index}`} variant="outline" size="sm" disabled={busy} onClick={() => void act(action)}>{requestActionLabel(action)}</Button>)}
      {requestActions(item).length === 0 && !item.answer ? <span className="scout-request-meta">No action link supplied by this source.</span> : null}
    </div>
    {error ? <p className="scout-request-error" role="alert">{error}</p> : null}
  </article>;
}

export function RequestsScreen({ navigate }: { navigate: (route: Route) => void; embedded?: boolean }) {
  const { state, error, loading } = useOperatorRequests();
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  const count = requestsCountState(state?.items.length ?? 0);
  return <section className="scout-requests" aria-label={getDestination("requests").label}>
    <header className="scout-requests-heading"><h1>{getDestination("requests").label}</h1><RequestsCount count={count.count} pending={loading && !state} /><Button variant="outline" size="sm" onClick={() => void refreshRequests()}>Refresh</Button></header>
    {error ? <p role="alert" className="scout-request-error">{error}{state ? " · Showing the last successful snapshot." : ""}</p> : null}
    {loading && !state ? <p role="status">Loading requests…</p> : null}
    {!loading && state?.items.length === 0 ? <div className="scout-requests-empty"><h2>No open requests</h2><p>Approvals, questions and permission prompts from your agents show up here.</p></div> : null}
    <div className="scout-requests-list">{state?.items.map((item) => <RequestCard key={item.id} item={item} now={now} navigate={navigate} />)}</div>
    {state && state.items.length > 0 ? <p className="scout-requests-source-note">The source supplies update times, not when waiting began. Request history is not available.</p> : null}
  </section>;
}

export const scoutSurface = defineSurface({
  id: "requests", label: getDestination("requests").label, route: { view: "requests" }, webPath: "/requests", screen: "RequestsScreen",
  embed: { path: "/embed/requests", profile: "macos.requests", ownsInternalRoutes: false, chrome: { showSecondaryNav: false, showPageStatusBar: false }, hosts: { macos: true } },
});
