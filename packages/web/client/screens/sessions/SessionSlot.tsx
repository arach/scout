import { formatSessionRouteRef, parseSessionRouteRef } from "../../../shared/session-route-ref.ts";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { BASIC_WEB } from "../../basic/profile.ts";
import { sessionDraftStore } from "./session-drafts.ts";
import { HarnessMark } from "../../components/HarnessMark.tsx";
import { Button } from "../../components/ui/button.tsx";
import { MessageMarkup } from "../../lib/message-markup.tsx";
import { SessionSteerComposer, SessionSteeredList, unobservedSteers, type PendingSessionSteer } from "./SessionSteer.tsx";
import type { SessionSteerAvailability, SessionSteerAuditEntry } from "../../../shared/api/session-steer.ts";
import { isAgentInTurn } from "../../lib/agent-state.ts";
import { api } from "../../lib/api.ts";
import { conversationSessionId } from "../../lib/conversation-kind.ts";
import { useScout } from "../../scout/Provider.tsx";
import { useTurnSteps } from "../chat/use-turn-steps.ts";
import { useRequestActions } from "../requests/use-request-actions.ts";
import type { ObserveEvent, ObserveFile, OperatorAttentionItem, Route } from "../../lib/types.ts";
import { SessionObserveContextRail } from "./SessionObserve.tsx";
import { useSessionRefLookup } from "./SessionRefScreen.tsx";
import { attentionForSession, sessionOrigin, type SessionBoardRow } from "./session-board-model.ts";
import { observedSessionTurns, observedTurnDuration, sessionWorkLabel, observedFileEdits } from "./session-turns.ts";
import { sendSessionDraft, sessionDeliveryAvailability, sessionInterruptAgent, sessionTargetFromObserve, sessionSteerPath, sessionSteerPoll, type SessionDeliveryTarget } from "./session-delivery.ts";
import type { SessionDensity, SessionSelection } from "./slot-deck.ts";

function InlineSessionRequest({ item, navigate }: { item: OperatorAttentionItem; navigate: (r: Route) => void }) {
  const { busy, error, sent, answer, act } = useRequestActions(item, (action) => navigate(action.route!));
  const [draft, setDraft] = useState("");
  return <section className="s-session-request" aria-label={item.approval ? "Session approval" : "Session question"} aria-busy={busy}>
    <strong>{item.title}</strong>
    {item.summary && item.summary !== item.title && <p>{item.summary}</p>}
    {item.detail && <pre>{item.detail}</pre>}
    <div className="s-session-actions">
      {item.approval && item.actions.filter((a) => a.kind === "approve" || a.kind === "deny").map((action) =>
        <Button key={action.kind} size="sm" variant="outline" disabled={busy} onClick={() => void act(action)}>{action.kind === "approve" ? "Yes, proceed" : "No"}</Button>)}
      {sent ? <span role="status">Answered: {sent}</span> : item.answer?.options.map((option) =>
        <Button key={option} size="sm" variant="outline" disabled={busy} onClick={() => void answer(option)}>{option}</Button>)}
      {!item.approval && !item.answer && item.actions.filter((a) => a.kind === "open" && a.route).map((action, i) =>
        <Button key={i} size="sm" variant="outline" onClick={() => void act(action)}>{action.label}</Button>)}
    </div>
    {!item.approval && !item.answer && item.kind === "question" && <p>Answer in the live harness. This question has no browser answer endpoint.</p>}
    {item.answer && !sent && <form onSubmit={(event) => { event.preventDefault(); if (draft.trim()) void answer(draft.trim()); }}>
      <label>Answer<input value={draft} onChange={(event) => setDraft(event.target.value)} disabled={busy} /></label>
      <Button type="submit" size="sm" variant="outline" disabled={busy || !draft.trim()}>Send answer</Button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

type Touched = { files: ObserveFile[]; worktreePath: string | null; counts: { changedFiles: number; readFiles: number } };
function SessionChanges({ sessionRef, refreshKey, events, navigate }: { sessionRef: string; refreshKey: number; events: ObserveEvent[]; navigate: (r: Route) => void }) {
  const edits = observedFileEdits(events);
  const [result, setResult] = useState<Touched | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void api<Touched>(`/api/session-ref/${encodeURIComponent(sessionRef)}/touched`)
      .then((value) => { if (!cancelled) { setResult(value); setError(null); } })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [sessionRef, refreshKey, retry]);
  return <section className="s-session-changes" aria-label="Session changes">
    <header><strong>{result ? `${result.counts.changedFiles} ${result.counts.changedFiles === 1 ? "file" : "files"} changed` : "Changes"}</strong></header>
    {error ? <p role="status">Touched files unavailable: {error} <Button size="xs" variant="outline" onClick={() => setRetry((v) => v + 1)}>Retry</Button></p>
      : !result ? <p role="status">Loading touched files…</p>
      : <><ul>{result.files.filter((file) => file.state !== "read").map((file) => { const count = edits.get(file.path); return <li key={file.path}><code>{file.path}</code>{count ? <span title="Observed tool edits in this window, not a net worktree diff"><b className="s-session-add">+{count.add}</b> <b className="s-session-del">−{count.del}</b></span> : <span>{file.state}</span>}</li>; })}</ul>
        {result.counts.changedFiles === 0 && <p>No file changes recorded in this observed window.</p>}
        {!BASIC_WEB && result.worktreePath && result.counts.changedFiles > 0 && <Button size="sm" variant="outline" onClick={() => navigate({ view: "repo-diff", path: result.worktreePath!, sessionId: sessionRef, include: "changed" })}>Review changes</Button>}
        {BASIC_WEB && result.counts.changedFiles > 0 && <p>Full diff review is available in the full web client.</p>}
      </>}
  </section>;
}

export function SessionSlot({ selection, density = "desk", inspector = false, row, requests, navigate, localNodeId }: {
  selection: SessionSelection;
  density?: SessionDensity;
  localNodeId?: string | null;
  inspector?: boolean;
  row?: SessionBoardRow;
  requests: readonly OperatorAttentionItem[];
  navigate: (r: Route) => void;
}) {
  const { agents, operatorName } = useScout();
  const [auditRevision, setAuditRevision] = useState(0);
  const first = useSessionRefLookup(selection.sessionRef);
  const conversation = first.lookup?.session ?? row?.conversation ?? null;
  const backing = first.lookup?.kind === "conversation" ? formatSessionRouteRef(conversation?.harness, conversation?.harnessSessionId || conversationSessionId(conversation)) : null;
  const second = useSessionRefLookup(backing && backing !== selection.sessionRef ? backing : "");
  const resolved = first.lookup?.kind === "observe" ? first.lookup : second.lookup?.kind === "observe" ? second.lookup : null;
  const observe = resolved?.observe;
  const data = observe?.data;
  const meta = data?.metadata?.session;
  const agent = agents.find((a) => a.id === (observe?.agentId ?? conversation?.agentId));
  const target = sessionTargetFromObserve(observe, conversation, selection.machineId, localNodeId, agent);
  const sessionId = target.sessionId || parseSessionRouteRef(backing || row?.sessionId || selection.sessionRef)?.refId || selection.sessionRef;
  const agentId = target.agentId;
  const working = Boolean(agent?.harnessSessionId === sessionId ? isAgentInTurn(agent.state, agent)
    : data ? data.live || data.events.some((e) => e.live) : row?.working);
  const origin = sessionOrigin({ conversation, requester: observe?.kind === "agent" ? observe.initiatingAsk : null,
    parentSessionId: row?.lane?.facts?.parentSessionId, agents, operatorName });
  const turnSteps = useTurnSteps({ sessionIds: sessionId ? [sessionId] : [], active: working, perSession: true });
  const turns = useMemo(() => data ? observedSessionTurns(data, working) : [], [data, working]);
  const attention = attentionForSession(requests, [sessionId, observe?.sessionId ?? "", conversation?.sessionId ?? "", selection.sessionRef], conversation?.id, selection.machineId, localNodeId);
  const loading = first.loading || Boolean(backing && backing !== selection.sessionRef && second.loading);
  const error = first.error ?? (backing ? second.error : null);
  const title = conversation?.title || row?.title || meta?.cwd?.split("/").at(-1) || sessionId;
  const harness = meta?.adapterType || row?.harness || conversation?.harness;
  const project = meta?.cwd || row?.project || conversation?.workspaceRoot;
  const branch = meta?.gitBranch || row?.branch || conversation?.currentBranch;
  const model = meta?.model || row?.model || conversation?.model;
  return <div className={`s-session-slot s-session-slot--${density}`}>
    <div className="s-session-thread">
      <header className="s-session-header">
        <HarnessMark harness={harness ?? "unknown"} size={18} />
        <div title={[project, branch, model, origin.label, sessionId].filter(Boolean).join(" · ")}><h2>{title}</h2></div>
        <span role="status">{attention.length ? "Needs input" : working ? "Working" : loading ? "Loading" : error ? "Unavailable" : "Idle"}</span>
      </header>
      <div className="s-session-transcript s-observe--conversation">
        {loading && !data && <p role="status">Resolving this session…</p>}
        {error && <p className="s-session-unavailable" role="status">This session can't be read right now ({error}). <Button size="xs" variant="outline" onClick={() => void (backing ? second.refresh() : first.refresh())}>Retry session</Button></p>}
        {!loading && !data && !error && <p>No observed transcript is attached to this reference.</p>}
        {turns.map((turn) => <section className="s-session-turn" key={turn.id}>
          {turn.prompt.map((event) => <div className="s-session-user-message" key={event.id}><MessageMarkup text={event.text} /></div>)}
          {turn.steps.length > 0 && <details className="s-session-steps">
            <summary>{turn.boundary === "window" ? "Observed work" : turn.working ? "Working" : observe?.fidelity === "timestamped" ? `Worked for ${observedTurnDuration(turn)}` : "Observed work"}</summary>
            <div className="s-session-work-rows">{turn.steps.map((event) => <details key={event.id} className="s-session-work-row"><summary>{sessionWorkLabel(event)}</summary>
              <pre>{event.detail || event.text}{event.diff ? `\n${event.diff.preview}` : ""}</pre></details>)}</div>
          </details>}
          {turn.messages.map((event) => <div className="s-session-agent-message" key={event.id}><MessageMarkup text={event.kind === "ask" && event.to ? `Question: ${event.text}${event.answer ? `\n\nAnswer: ${event.answer}` : ""}` : event.text} /></div>)}
        </section>)}
        {working && turnSteps.length > 0 && <details className="s-session-steps"><summary>Working</summary>
          <p className="s-session-muted">Bounded Tail evidence, not a complete durable turn history.</p>
          <ol>{turnSteps.map((step) => <li key={step.id}><span>{step.phase}</span> {step.text}</li>)}</ol>
        </details>}
        {attention.map((item) => <InlineSessionRequest key={`${item.id}:${item.approval?.version ?? item.updatedAt}`} item={item} navigate={navigate} />)}
        {data && <SessionChanges sessionRef={observe?.refId ?? selection.sessionRef} refreshKey={observe?.updatedAt ?? 0} events={data.events} navigate={navigate} />}
      </div>
      <SessionSlotComposer key={`${target.machineId}:${target.sessionRef}`} target={target} working={working} loaded={Boolean(resolved)}
        prompts={turns.flatMap((turn) => turn.prompt)} onAttempt={() => setAuditRevision((n) => n + 1)} />
    </div>
    {inspector && <aside className="s-session-inspector"><SessionSteerHistory key={`${target.machineId}:${target.sessionRef}`} target={target} revision={auditRevision} />
      {data && <SessionObserveContextRail data={data} sessionId={sessionId} agentId={agentId ?? undefined} surface="context" observeSource={observe?.source} observeFidelity={observe?.fidelity} />}</aside>}
  </div>;
}

function SessionSteerHistory({ target, revision }: { target: SessionDeliveryTarget; revision: number }) {
  const [entries, setEntries] = useState<SessionSteerAuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = sessionSteerPath(target).replace("/steer?", "/steer/audit?");
  useEffect(() => {
    const poll = sessionSteerPoll(() => api<{ entries: SessionSteerAuditEntry[] }>(path),
      (value) => { setEntries(value.entries); setError(null); }, () => setError("Steering audit unavailable."));
    void poll.refresh(); const timer = setInterval(() => void poll.refresh(), 10_000);
    return () => { poll.stop(); clearInterval(timer); };
  }, [path, revision]);
  return <SessionSteeredList entries={entries} error={error} />;
}

function SessionSlotComposer({ target, working, loaded, prompts, onAttempt }: {
  target: SessionDeliveryTarget; working: boolean; loaded: boolean; prompts: ObserveEvent[]; onAttempt: () => void;
}) {
  const { agents, operatorName } = useScout();
  const store = sessionDraftStore(operatorName ?? "operator", target.machineId ?? undefined, target.sessionRef ?? target.sessionId);
  const draft = useSyncExternalStore(store.subscribe, store.read, () => "");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingSessionSteer[]>([]);
  const [live, setLive] = useState<SessionSteerAvailability | null>(null);
  const [revision, setRevision] = useState(0);
  const path = sessionSteerPath(target);
  useEffect(() => {
    if (!loaded || target.blockedReason) return;
    const poll = sessionSteerPoll(() => api<SessionSteerAvailability>(path), setLive,
      () => setLive({ available: false, code: "unavailable", reason: "Live steering is unavailable. Checking again shortly…", target: null }));
    void poll.refresh(); const timer = setInterval(() => void poll.refresh(), 10_000);
    return () => { poll.stop(); clearInterval(timer); };
  }, [path, loaded, target.blockedReason, revision]);
  const availability = sessionDeliveryAvailability(target, live);
  const canSend = loaded && availability.available;
  const interruptAgent = working ? sessionInterruptAgent(target, agents.find((a) => a.id === target.agentId)) : null;
  const submit = async () => {
    if (inFlight.current || !canSend || !draft.trim()) return;
    inFlight.current = true; setBusy(true); setError(null); setStatus(null);
    try {
      const receipt = await sendSessionDraft(target, draft);
      if (!receipt.ok) throw new Error(receipt.audit.reason);
      store.clearIfUnchanged(draft);
      setPending((items) => [...unobservedSteers(items, prompts), { id: receipt.audit.id, text: draft, duringTurn: working, observedIds: prompts.map((p) => p.id) }]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setLive(null); }
    finally { inFlight.current = false; setBusy(false); setRevision((v) => v + 1); onAttempt(); }
  };
  const interrupt = async () => {
    if (!interruptAgent || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); setStatus(null);
    try {
      await api(`/api/agents/${encodeURIComponent(interruptAgent.id)}/interrupt`, { method: "POST", body: JSON.stringify({ expectedSessionId: target.sessionId }) });
      setStatus("Interrupt requested for the live session.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <SessionSteerComposer draft={draft} onChange={store.write} submit={() => void submit()}
    interrupt={interruptAgent ? () => void interrupt() : null} working={working} busy={busy} available={canSend}
    reason={availability.reason} pending={unobservedSteers(pending, prompts)} error={error} status={status} />;
}
