/**
 * Home's first-task card: pick a ready agent, review a small read-only task,
 * send it, then follow its real lifecycle to the agent's answer.
 *
 * Readiness, progress and approvals come only from observations — the roster,
 * the runtime catalog, broker health, the flight record and operator
 * attention. Nothing is sent until the operator presses Send.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Check, X } from "lucide-react";

import { api } from "../lib/api.ts";
import { friendlyApiError } from "../lib/api-errors.ts";
import { ensureAgentChat } from "../lib/agent-chat.ts";
import { loadConversationList } from "../lib/conversation-list-cache.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo } from "../lib/time.ts";
import type {
  AgentConfigurationState,
  BrokerDiagnostics,
  Message,
  Route,
  Flight as WebFlight,
} from "../lib/types.ts";
import { useScout } from "../scout/Provider.tsx";
import {
  FIRST_TASK_PHASE_LABEL,
  FIRST_TASK_STEPS,
  firstTaskPresentation,
  firstTaskExecutionTarget,
  firstTaskReadiness,
  isTerminalPhase,
  phaseForFlightState,
  pickFirstTaskResult,
  projectLabelFor,
  readFirstTaskStore,
  EMPTY_FIRST_TASK_STORE,
  stepIndexForPhase,
  suggestedFirstTask,
  updateFirstTaskScopedState,
  type FirstTaskCandidate,
  type FirstTaskMessage,
  type FirstTaskPhase,
  type FirstTaskReadiness,
  type FirstTaskRecord,
  type FirstTaskRuntime,
  type FirstTaskStore,
} from "./first-task.ts";
import { useBrokerHealth } from "./broker-health.ts";
import { watchFirstTaskDispatch } from "./first-task-dispatch.ts";

const FLIGHT_POLL_MS = 2_500;
const FIRST_TASK_SOURCE = "scout-web-first-task";

type AskResponse = {
  flight?: { id: string; state?: string; invocationId?: string; targetAgentId?: string } | null;
  targetAgentId?: string;
  conversationId?: string;
  messageId?: string;
  error?: string;
};

function useFirstTaskStore(identity: string | null) {
  const [state, setState] = useState(() => ({ identity, store: readFirstTaskStore(identity) }));
  // Render an empty store immediately when authority changes; never paint or
  // poll the previous operator's task while an effect catches up.
  const store = state.identity === identity ? state.store : EMPTY_FIRST_TASK_STORE;
  useEffect(() => { setState({ identity, store: readFirstTaskStore(identity) }); }, [identity]);
  const update = useCallback((next: (current: FirstTaskStore) => FirstTaskStore) => {
    setState((current) => updateFirstTaskScopedState(current, identity, next));
  }, [identity]);
  return [store, update] as const;
}

function useRuntimeCatalog(enabled: boolean) {
  const [failed, setFailed] = useState(false);
  const [runtimes, setRuntimes] = useState<FirstTaskRuntime[] | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setFailed(false);
    api<AgentConfigurationState>("/api/agent-config/snapshot")
      .then((snapshot) => { if (!cancelled) setRuntimes(snapshot.runtimes ?? []); })
      // A failed catalog read is not "no runtimes"; stay unknown and let retry ask again.
      .catch(() => { if (!cancelled) { setRuntimes(null); setFailed(true); } });
    return () => { cancelled = true; };
  }, [enabled, nonce]);
  return { runtimes, failed, recheck: () => setNonce((value) => value + 1) };
}

function firstTaskTitle(task: FirstTaskRecord): string {
  switch (task.lastPhase) {
    case "completed": return "Check the agent’s reply";
    case "failed": return `${task.agentName} couldn't finish`;
    case "cancelled": return "The task was cancelled";
    case "awaiting_input": return `${task.agentName} is waiting on you`;
    default: return `${task.agentName} is on it`;
  }
}

export function FirstTask({ navigate, allowStart = true }: { navigate: (route: Route) => void; allowStart?: boolean }) {
  const health = useBrokerHealth();
  const [store, update] = useFirstTaskStore(health?.persistenceIdentity ?? null);
  const presentation = firstTaskPresentation(store);
  const [expanded, setExpanded] = useState(false);

  if (presentation === "hidden" || (!store.task && !allowStart)) return null;
  if (presentation === "resume_chip" && !expanded) {
    return (
      <div className="sb-ft-chip-row">
        <button
          type="button"
          className="sb-ft-chip"
          onClick={() => {
            setExpanded(true);
            update((current) => ({ ...current, skippedAt: null }));
          }}
        >
          Resume first task
          <ArrowRight size={12} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <section className="sb-ft" aria-label="First task">
      <header className="sb-ft-head">
        <div>
          <p className="sb-ft-kicker">First task</p>
          <h2 className="sb-ft-title">
            {store.task ? firstTaskTitle(store.task) : "Send an agent one small task"}
          </h2>
        </div>
        {store.task && isTerminalPhase(store.task.lastPhase) ? (
          <button
            type="button"
            className="s-btn sb-ft-quiet"
            onClick={() => update((current) => ({ ...current, dismissedAt: Date.now() }))}
          >
            Dismiss
          </button>
        ) : !store.task ? (
          <button
            type="button"
            className="s-btn sb-ft-quiet"
            onClick={() => {
              setExpanded(false);
              update((current) => ({ ...current, skippedAt: Date.now() }));
            }}
          >
            Skip for now
          </button>
        ) : null}
      </header>
      {store.task ? (
        <FirstTaskProgress
          task={store.task}
          navigate={navigate}
          onPhase={(phase) => update((current) => current.task && current.task.lastPhase !== phase
            ? { ...current, task: { ...current.task, lastPhase: phase } }
            : current)}
          onStartOver={() => update((current) => ({ ...current, task: null }))}
        />
      ) : (
        <FirstTaskSetup
          navigate={navigate}
          onSent={(task) => update((current) => ({ ...current, skippedAt: null, task }))}
        />
      )}
    </section>
  );
}

/* ── Before the send ───────────────────────────────────────────────────── */

function FirstTaskSetup({
  navigate,
  onSent,
}: {
  navigate: (route: Route) => void;
  onSent: (task: FirstTaskRecord) => void;
}) {
  const { agents, agentsLoaded, apiConnection, onboarding, reload } = useScout();
  const [healthNonce, setHealthNonce] = useState(0);
  const broker = useBrokerHealth(healthNonce);
  const apiOnline = apiConnection.status !== "offline";
  const { runtimes, failed, recheck } = useRuntimeCatalog(apiOnline);
  const readiness = firstTaskReadiness({
    apiOnline,
    brokerReachable: broker ? broker.reachable && broker.ok : null,
    agentsLoaded,
    agents,
    runtimes,
    catalogFailed: failed,
    projectRoot: onboarding?.projectRoot ?? onboarding?.contextRoot ?? null,
  });
  const retry = useCallback(() => {
    void reload();
    recheck();
    setHealthNonce(value => value + 1);
  }, [recheck, reload]);

  if (readiness.kind !== "ready") {
    return <FirstTaskBlocked readiness={readiness} onRetry={retry} navigate={navigate} />;
  }
  return <FirstTaskComposer candidates={readiness.candidates} onSent={onSent} />;
}

function Command({ children }: { children: string }) {
  return <code className="sb-ft-cmd">{children}</code>;
}

function FirstTaskBlocked({
  readiness,
  onRetry,
  navigate,
}: {
  readiness: Exclude<FirstTaskReadiness, { kind: "ready" }>;
  onRetry: () => void;
  navigate: (route: Route) => void;
}) {
  let body: ReactNode;
  switch (readiness.kind) {
    case "checking":
      body = <p>Checking Scout, the broker and your agents…</p>;
      break;
    case "verification_unavailable":
      body = <p>Broker or runtime readiness could not be verified. Check again before sending.</p>;
      break;
    case "scout_offline":
      body = (
        <>
          <p><strong>This page can't reach Scout.</strong> Check it from a terminal on the machine running Scout:</p>
          <Command>scout setup</Command>
        </>
      );
      break;
    case "broker_unreachable":
      body = (
        <>
          <p>
            <strong>The broker isn't answering,</strong> so a task can't be delivered yet. Rerun setup on
            this machine; it checks the broker and reports what it found:
          </p>
          <Command>scout setup</Command>
        </>
      );
      break;
    case "no_agent":
      body = (
        <>
          <p><strong>No agent is registered yet.</strong> Point setup at a project folder and it registers one:</p>
          <Command>scout setup --source-root ~/dev</Command>
        </>
      );
      break;
    case "runtime_not_ready":
      body = (
        <>
          <p>
            <strong>{readiness.candidates.length === 1 ? "Your agent needs" : "Your agents need"} a signed-in runtime.</strong>{" "}
            Sign in, then check again:
          </p>
          {readiness.login.map((entry) => (
            <div key={entry.label} className="sb-ft-login">
              <span>{entry.label}</span>
              {entry.command ? <Command>{entry.command}</Command> : <span className="sb-ft-note">No login command is known for this runtime.</span>}
            </div>
          ))}
        </>
      );
      break;
  }
  return (
    <div className="sb-ft-blocked" role="status">
      {body}
      <div className="sb-ft-actions">
        <button type="button" className="s-btn" onClick={onRetry}>Check again</button>
        {readiness.kind === "broker_unreachable" && (
          <button type="button" className="s-btn sb-ft-quiet" onClick={() => navigate({ view: "broker" })}>
            Open Dispatch
          </button>
        )}
      </div>
    </div>
  );
}

function FirstTaskComposer({
  candidates,
  onSent,
}: {
  candidates: FirstTaskCandidate[];
  onSent: (task: FirstTaskRecord) => void;
}) {
  const [agentId, setAgentId] = useState(candidates[0]!.agent.id);
  const chosen = candidates.find((candidate) => candidate.agent.id === agentId) ?? candidates[0]!;
  const project = projectLabelFor(chosen.agent);
  const [body, setBody] = useState(() => suggestedFirstTask(projectLabelFor(candidates[0]!.agent)));
  const [edited, setEdited] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedWithoutIdentity, setAcceptedWithoutIdentity] = useState(false);

  // Retarget the suggestion with the agent until the operator has edited it.
  useEffect(() => {
    if (!edited) setBody(suggestedFirstTask(project));
  }, [edited, project]);

  const send = useCallback(async () => {
    const text = body.trim();
    if (!text) return;
    setSending(true);
    setError(null);
    let submitted = false;
    try {
      const conversationId = await ensureAgentChat(chosen.agent);
      submitted = true;
      const result = await api<AskResponse>("/api/ask", {
        method: "POST",
        body: JSON.stringify({
          body: text,
          chatId: conversationId,
          targetAgentId: chosen.agent.id,
          metadata: { source: FIRST_TASK_SOURCE },
        }),
      });
      const flightId = result.flight?.id;
      if (!flightId) throw new Error("The broker accepted the message but returned no task id.");
      void loadConversationList({ force: true }).catch(() => null);
      onSent({
        flightId,
        invocationId: result.flight?.invocationId ?? null,
        conversationId: result.conversationId ?? conversationId,
        messageId: result.messageId ?? null,
        agentId: firstTaskExecutionTarget(result),
        agentName: chosen.agent.name,
        body: text,
        sentAt: Date.now(),
        lastPhase: phaseForFlightState(result.flight?.state ?? "queued"),
      });
    } catch (cause) {
      setError(friendlyApiError(cause));
      // Once the POST starts, a lost response cannot prove non-delivery.
      // Keep the text, but require inspection before sending another request.
      setAcceptedWithoutIdentity(submitted);
      setSending(false);
    }
  }, [body, chosen.agent, onSent]);

  return (
    <form
      className="sb-ft-compose"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <label className="sb-ft-field">
        <span>Agent</span>
        <select
          className="sb-input"
          value={agentId}
          disabled={sending}
          onChange={(event) => setAgentId(event.target.value)}
        >
          {candidates.map((candidate) => (
            <option key={candidate.agent.id} value={candidate.agent.id}>
              {candidate.agent.name}
              {projectLabelFor(candidate.agent) ? ` · ${projectLabelFor(candidate.agent)}` : ""}
              {candidate.runtime ? ` · ${candidate.runtime.label}` : ""}
            </option>
          ))}
        </select>
      </label>
      <p className="sb-ft-note">
        {chosen.runtime?.label ?? chosen.agent.harness} is signed in
        {chosen.agent.projectRoot ? <> · works in <code>{chosen.agent.projectRoot}</code></> : null}
      </p>
      <label className="sb-ft-field">
        <span>Task — review it before sending</span>
        <textarea
          className="sb-input sb-ft-text"
          rows={3}
          value={body}
          disabled={sending}
          onChange={(event) => {
            setEdited(true);
            setBody(event.target.value);
          }}
        />
      </label>
      {error && (
        <p className="sb-error" role="alert">
          {acceptedWithoutIdentity ? (
            <>Scout could not confirm this request’s execution identity. Check Dispatch before sending it again. {error} <button type="button" className="sb-ft-link" onClick={() => { window.location.href = "/dispatch"; }}>Open Dispatch</button></>
          ) : (
            <>Not sent: {error}</>
          )}
        </p>
      )}
      <div className="sb-ft-actions">
        <button type="submit" className="s-btn sb-ft-primary" disabled={sending || acceptedWithoutIdentity || !body.trim()}>
          {sending ? "Sending…" : `Send to ${chosen.agent.name}`}
        </button>
        <span className="sb-ft-note">It opens as a DM, so you can follow up there.</span>
      </div>
    </form>
  );
}

/* ── After the send ────────────────────────────────────────────────────── */

type FlightRead =
  | { kind: "pending" }
  | { kind: "ok"; flight: WebFlight }
  | { kind: "missing" }
  | { kind: "error"; message: string };

function useFlight(flightId: string, settled: boolean) {
  const [read, setRead] = useState<FlightRead>({ kind: "pending" });
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    api<WebFlight[]>(`/api/flights?flightId=${encodeURIComponent(flightId)}&active=false`)
      .then((flights) => {
        if (cancelled) return;
        const flight = flights.find((candidate) => candidate.id === flightId);
        setRead(flight ? { kind: "ok", flight } : { kind: "missing" });
      })
      .catch((cause) => { if (!cancelled) setRead({ kind: "error", message: friendlyApiError(cause) }); });
    return () => { cancelled = true; };
  }, [flightId, nonce]);

  useEffect(() => {
    if (settled) return;
    const timer = window.setInterval(refresh, FLIGHT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh, settled]);

  useBrokerEvents((event) => {
    if (event.kind.startsWith("flight.") || event.kind === "message.posted" || event.kind.startsWith("delivery.")) {
      refresh();
    }
  });

  return { read, refresh };
}

function useResult(task: FirstTaskRecord, phase: FirstTaskPhase) {
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setNonce(n => n + 1), FLIGHT_POLL_MS);
    return () => window.clearInterval(timer);
  }, []);
  const [result, setResult] = useState<FirstTaskMessage | null>(null);
  useEffect(() => {
    if (phase === "sending") return;
    let cancelled = false;
    api<Message[]>(`/api/messages?conversationId=${encodeURIComponent(task.conversationId)}&limit=40`)
      .then((messages) => {
        if (cancelled) return;
        setResult(pickFirstTaskResult(
          messages.map((message) => ({
            id: message.id,
            actorId: message.actorId,
            class: message.class,
            body: message.body,
            createdAt: message.createdAt,
            replyToMessageId: message.replyToMessageId,
            metadata: message.metadata ?? null,
          })),
          task,
        ));
      })
      .catch(() => null);
    return () => { cancelled = true; };
  }, [phase, task, nonce]);
  return result;
}

/** The Dispatch row for this task's message, so the link opens it selected. */
function useDispatchAttemptId(messageId: string | null): string | null {
  const [match, setMatch] = useState<{ messageId: string; attemptId: string } | null>(null);
  useEffect(() => {
    if (!messageId) return;
    return watchFirstTaskDispatch(
      messageId,
      (signal) => api<BrokerDiagnostics>("/api/broker", { signal }),
      (attemptId) => setMatch({ messageId, attemptId }),
    );
  }, [messageId]);
  // A new task must not briefly link to the previous task's Dispatch row.
  return match?.messageId === messageId ? match.attemptId : null;
}

function FirstTaskProgress({
  task,
  navigate,
  onPhase,
  onStartOver,
}: {
  task: FirstTaskRecord;
  navigate: (route: Route) => void;
  onPhase: (phase: FirstTaskPhase) => void;
  onStartOver: () => void;
}) {
  const { read, refresh } = useFlight(task.flightId, task.lastPhase === "failed" || task.lastPhase === "cancelled");
  const flight = read.kind === "ok" ? read.flight : null;
  // Until the first read answers, the last phase this browser saw is the truth it has.
  const phase: FirstTaskPhase = flight ? phaseForFlightState(flight.state) : task.lastPhase;

  useEffect(() => {
    if (flight) onPhase(phase);
  }, [flight, onPhase, phase]);

  const correlatedTask = useMemo(() => flight ? { ...task, invocationId: flight.invocationId, workId: flight.collaborationRecordId } : task, [task, flight]);
  const result = useResult(correlatedTask, phase);
  const attemptId = useDispatchAttemptId(task.messageId);
  const failed = phase === "failed" || phase === "cancelled";

  return (
    <div className="sb-ft-progress">
      <blockquote className="sb-ft-sent">
        <span>You sent {timeAgo(task.sentAt)}</span>
        {task.body}
      </blockquote>
      <ol className="sb-ft-steps" aria-label="Task lifecycle">
        {/* A failed flight only proves it was accepted (it has an id); the
            steps after that are not claimed. */}
        {(failed ? FIRST_TASK_STEPS.slice(0, 1) : phase === "completed" ? ["accepted", "completed"] as const : FIRST_TASK_STEPS).map((step, index) => {
          const reached = failed || index <= stepIndexForPhase(phase);
          const current = failed ? false : phase === step || (step === "running" && phase === "awaiting_input");
          return (
            <li
              key={step}
              className={`sb-ft-step${reached ? " is-reached" : ""}${current ? " is-current" : ""}`}
              aria-current={current ? "step" : undefined}
            >
              <span className="sb-ft-step-mark" aria-hidden="true">{reached && !current ? <Check size={10} /> : null}</span>
              {step === "running" && phase === "awaiting_input" ? FIRST_TASK_PHASE_LABEL.awaiting_input : FIRST_TASK_PHASE_LABEL[step]}
            </li>
          );
        })}
        {failed && (
          <li className="sb-ft-step is-failed" aria-current="step">
            <span className="sb-ft-step-mark" aria-hidden="true"><X size={10} /></span>
            {FIRST_TASK_PHASE_LABEL[phase]}
          </li>
        )}
      </ol>

      {read.kind === "error" && (
        <p className="sb-ft-note" role="status">
          Can't read the task's state right now ({read.message}). Last seen: {FIRST_TASK_PHASE_LABEL[task.lastPhase]}.
        </p>
      )}
      {read.kind === "missing" && (
        <p className="sb-ft-note" role="status">
          {isTerminalPhase(task.lastPhase)
            ? "The broker no longer lists this task. Any reply is in the DM."
            : "The broker has no record of this task yet. It may still be registering — this updates on its own."}
        </p>
      )}

      {phase === "awaiting_input" && (
        <FirstTaskApprovals task={task} flight={flight} onDecided={refresh} navigate={navigate} />
      )}

      {failed && (
        <div className="sb-ft-blocked" role="alert">
          <p>
            <strong>{phase === "failed" ? "The task failed." : "The task was cancelled."}</strong>{" "}
            {flight?.summary ?? flight?.dispatchOutcome?.reason ?? "Dispatch shows the delivery detail."}
          </p>
        </div>
      )}

      {(phase === "completed" || result) && (
        <div className="sb-ft-result">
          <p className="sb-ft-kicker">Latest reply</p>
          {result ? (
            <div className="sb-ft-result-body">{result.body}</div>
          ) : (
            <p className="sb-ft-note">A reply may acknowledge your request before the task finishes. The conversation keeps updating; check the DM for the answer.</p>
          )}
        </div>
      )}

      <div className="sb-ft-actions">
        <button
          type="button"
          className={`s-btn${phase === "completed" ? " sb-ft-primary" : ""}`}
          onClick={() => navigate({ view: "conversation", conversationId: task.conversationId })}
        >
          {phase === "completed" ? "Follow up in DM" : "Open DM"}
        </button>
        <button
          type="button"
          className="s-btn"
          onClick={() => navigate(attemptId ? { view: "broker", attemptId } : { view: "broker" })}
        >
          View in Dispatch
        </button>
        {failed && (
          <button type="button" className="s-btn sb-ft-quiet" onClick={onStartOver}>Try another task</button>
        )}
      </div>
    </div>
  );
}

/** Current attention carries session identity, not authoritative ask identity.
 * A reused session may be serving another ask: never render decision controls.
 */
function FirstTaskApprovals({ task, navigate }: {
  task: FirstTaskRecord;
  flight: WebFlight | null;
  onDecided: () => void;
  navigate: (route: Route) => void;
}) {
  return <div className="sb-ft-approvals" role="region" aria-label="Waiting on you">
    <p className="sb-ft-note">Continue in the agent’s app to answer its prompt. You can also check this task’s conversation.</p>
    <button type="button" className="s-btn" onClick={() => navigate({ view: "conversation", conversationId: task.conversationId })}>Open DM</button>
  </div>;
}
