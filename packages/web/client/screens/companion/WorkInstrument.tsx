import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DictationMic, type DictationMicControl, type MicStatus } from "../../components/DictationMic.tsx";
import { api } from "../../lib/api.ts";
import { focusCompanionInput, pressCodexVoice, talkInCodex, type CompanionVoiceControl } from "../../lib/companion-host.ts";
import { edgeVisible, exactLabel } from "./edge-model.ts";
import { ageLabel, type CompanionCardState } from "./companion-model.ts";
import type { EdgeWork } from "./CompanionEdge.tsx";
import type { Message, WorkDetail } from "../../lib/types.ts";
import { timeAgoWithSuffix } from "../../lib/time.ts";
import { buildTurnStepScope } from "../chat/turn-steps.ts";
import { useTurnSteps } from "../chat/use-turn-steps.ts";
import { madeLinks, runSpan, span, workMilestones, workStateLabel, workStatusTone } from "../work/work-summary.ts";

/** How many of the conversation's latest messages the thread popover holds. */
const THREAD_TAIL = 12;

/** Absolute paths read as their file name; the full path stays in the title. */
const PATH = /(\/(?:[\w.-]+\/)+[\w.-]+)/g;
function Prose({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(PATH)) {
    if (match.index! > last) parts.push(text.slice(last, match.index));
    parts.push(<span key={match.index} className="ce-in__file" title={match[1]}>{match[1]!.split("/").pop()}</span>);
    last = match.index! + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <p className="ce-in__prose">{parts}</p>;
}

function MicGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.1">
      <rect x="4" y="1.5" width="4" height="6" rx="2" /><path d="M2.5 6a3.5 3.5 0 0 0 7 0M6 9.5V11" />
    </svg>
  );
}

function SpeakerGlyph({ muted }: { muted: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.8 4.6h1.8L6 2.7v6.6L3.6 7.4H1.8z" />
      {muted ? <path d="M8 4.6 10.4 7.4M10.4 4.6 8 7.4" /> : <path d="M8.2 4.2a2.6 2.6 0 0 1 0 3.6M9.6 3a4.4 4.4 0 0 1 0 6" />}
    </svg>
  );
}

function MicOffGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
      <rect x="4" y="1.5" width="4" height="6" rx="2" /><path d="M2.5 6a3.5 3.5 0 0 0 7 0M6 9.5V11M2 10.5 10 1.5" />
    </svg>
  );
}

function GearGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1">
      <circle cx="6" cy="6" r="1.6" /><circle cx="6" cy="6" r="3.3" />
      <path d="M6 1.2v1.4M6 9.4v1.4M1.2 6h1.4M9.4 6h1.4M2.6 2.6l1 1M8.4 8.4l1 1M2.6 9.4l1-1M8.4 3.6l1-1" />
    </svg>
  );
}

const RESTING_NOTE: Partial<Record<CompanionCardState, string>> = {
  quiet: "No new activity for a while. Not paused: Scout has just not seen anything.",
  waiting: "Waiting on someone else, not on you.",
  ended: "The session ended without reporting done.",
  cancelled: "Cancelled. Nothing is running.",
};

type Sent = { at: number } | null;

/** The last few messages of a conversation, oldest first, kept fresh while shown. */
function useThreadTail(conversationId: string | null, open: boolean, bump: number) {
  const [state, setState] = useState<{ id: string; messages: Message[] | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (!open || !conversationId) return;
    let live = true;
    const load = () => {
      api<Message[]>(`/api/messages?conversationId=${encodeURIComponent(conversationId)}&limit=${THREAD_TAIL}`)
        .then((rows) => {
          if (!live) return;
          const messages = [...rows].sort((a, b) => a.createdAt - b.createdAt).slice(-THREAD_TAIL);
          setState({ id: conversationId, messages, failed: false });
        })
        .catch(() => { if (live) setState((prev) => ({ id: conversationId, messages: prev?.id === conversationId ? prev.messages : null, failed: true })); });
    };
    load();
    const timer = window.setInterval(load, 4000);
    return () => { live = false; window.clearInterval(timer); };
  }, [conversationId, open, bump]);
  return state?.id === conversationId ? state : null;
}

/**
 * The work item behind a figure. Fetched as soon as its card opens, so the
 * Work view usually lands filled; kept fresh while that view is shown.
 */
function useWorkDetail(workId: string, open: boolean) {
  const [state, setState] = useState<{ id: string; detail: WorkDetail | null; failed: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => {
      api<WorkDetail>(`/api/work/${encodeURIComponent(workId)}`)
        .then((detail) => { if (live) setState({ id: workId, detail, failed: false }); })
        .catch(() => { if (live) setState((prev) => ({ id: workId, detail: prev?.id === workId ? prev.detail : null, failed: true })); });
    };
    load();
    const timer = open ? window.setInterval(load, 5000) : undefined;
    return () => { live = false; window.clearInterval(timer); };
  }, [workId, open]);
  return state?.id === workId ? state : null;
}

/** Rows in the Work view's tail band: a fixed count, so the frame never resizes. */
const TAIL_ROWS = 5;

/** How many earlier milestones the Work view lists under the latest one. */
const WORK_STEPS = 4;

/** Inventory kinds worth counting, in the order they read. */
const TOUCHED_KINDS = [["code", "code"], ["tests", "tests"], ["docs", "docs"], ["specs", "specs"], ["plans", "plans"], ["config", "config"], ["assets", "assets"]] as const;

/** "write-path-reviewed: progress replaced" reads with its tag set apart. */
function Milestone({ text }: { text: string }) {
  const tag = text.match(/^([\w][\w -]{1,38}):\s+/);
  if (!tag) return <>{text}</>;
  return <><b>{tag[1]}</b> {text.slice(tag[0].length)}</>;
}

function ArrowGlyph() {
  return (
    <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8 8 4M4.5 4H8v3.5" />
    </svg>
  );
}

/**
 * What a figure's popover shows: the work's state, what it last said, and one
 * quiet row of actions. Reply opens a small composer that starts listening
 * when Scout voice is ready; typing works the whole time and takes over from
 * dictation. The figure's own settings sit behind the gear.
 */
export function WorkInstrument({
  work,
  name,
  offline,
  refTime,
  hosted,
  figureSettings,
  onThread,
  onWork,
  onPin,
  onDismiss,
  onComposing,
}: {
  work: EdgeWork;
  name: string;
  offline: boolean;
  refTime: number;
  hosted: boolean;
  /** Pinned work: the figure's settings, behind the gear. */
  figureSettings: ReactNode | null;
  onThread: (() => void) | null;
  onWork: () => void;
  /** Surfaced work: keep it as a pin. */
  onPin: (() => void) | null;
  /** Work that asks the operator: clear the alert until something newer happens. */
  onDismiss: (() => void) | null;
  /** The composer opened or closed: the edge keeps the popover open meanwhile. */
  onComposing: (composing: boolean) => void;
}) {
  const reading = edgeVisible(work.state, offline);
  const underlying = edgeVisible(work.state, false);
  const exact = work.status ?? exactLabel(work.state);
  const stateLabel = offline ? `${exact} at last sync` : exact;
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [mic, setMic] = useState<MicStatus | null>(null);
  const [sent, setSent] = useState<Sent>(null);
  const [error, setError] = useState<string | null>(null);
  const [gear, setGear] = useState(false);
  // One popover springs out of the action row, over the card. Thread and
  // Work are its two views; the full app stays one small click away.
  const [threadOpen, setThreadOpen] = useState(false);
  const [view, setView] = useState<"thread" | "work">("thread");
  const [threadBump, setThreadBump] = useState(0);
  // It opens as a short preview (the last few turns) and pops out to full
  // size when you reach for more: "Earlier", or scrolling up.
  const [threadFull, setThreadFull] = useState(false);
  const thread = useThreadTail(work.conversationId, threadOpen, threadBump);
  const workDetail = useWorkDetail(work.workId, threadOpen && view === "work");
  // The tail: what the work's own session is doing right now, keyed by its
  // flight's session traces and the agent's harness session.
  const tailFlight = workDetail?.detail
    ? workDetail.detail.allFlights.find((flight) => flight.id === workDetail.detail?.primaryInvocation?.flightId)
      ?? workDetail.detail.allFlights.at(-1) ?? null
    : null;
  const tailKeyParts = [tailFlight?.id, ...(tailFlight?.sessions ?? []).map((trace) => trace.sessionId), work.agent?.harnessSessionId].join("|");
  const tailScope = useMemo(
    () => buildTurnStepScope({ flight: tailFlight, agent: work.agent ?? null, sessionMeta: null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tailKeyParts],
  );
  const tailSteps = useTurnSteps({ sessionIds: tailScope, active: threadOpen && view === "work", perSession: true });
  const threadButton = useRef<HTMLButtonElement | null>(null);
  const workButton = useRef<HTMLButtonElement | null>(null);
  const threadFeed = useRef<HTMLOListElement | null>(null);
  const [notchX, setNotchX] = useState<number | null>(null);
  const dictation = useRef<DictationMicControl | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const listening = mic?.state === "recording" || mic?.state === "starting";

  const composingCallback = useRef(onComposing);
  composingCallback.current = onComposing;
  // The edge keeps the popover open while you reply or read the thread.
  useEffect(() => { composingCallback.current(composing || threadOpen); }, [composing, threadOpen]);
  // Every opened composer is its own session. Dictation and send results
  // land only in the session that started them: never in a later composer,
  // and never in another figure's (the popover is reused across figures).
  const [session, setSession] = useState(0);
  const sessionRef = useRef(0);
  const live = useRef(false);
  const draftRef = useRef("");
  draftRef.current = draft;
  // Send pressed mid-take: the reply goes once the take's words have landed.
  const [sendWhenHeard, setSendWhenHeard] = useState(false);
  const sendWhenHeardRef = useRef(false);
  const [sendingFor, setSendingFor] = useState<number | null>(null);
  const sending = sendingFor !== null && sendingFor === session;
  const holdSend = (on: boolean) => { sendWhenHeardRef.current = on; setSendWhenHeard(on); };

  useEffect(() => {
    sessionRef.current += 1;
    live.current = false;
    sendWhenHeardRef.current = false;
    setComposing(false); setDraft(""); setSent(null); setError(null); setGear(false); setSendWhenHeard(false);
    setThreadOpen(false);
    setThreadFull(false);
  }, [work.workId]);
  useEffect(() => { if (!threadOpen) setThreadFull(false); }, [threadOpen]);

  // The notch points at the pressed button, wherever the row puts it.
  useLayoutEffect(() => {
    if (!threadOpen) return;
    const button = view === "work" ? workButton.current : threadButton.current;
    if (button) setNotchX(button.offsetLeft + button.offsetWidth / 2);
  }, [threadOpen, view, composing, sent]);
  const press = (next: "thread" | "work") => {
    if (threadOpen && view === next) { setThreadOpen(false); return; }
    setView(next);
    setThreadFull(false);
    setThreadOpen(true);
  };
  // Newest at the foot: land there when it opens and as messages arrive.
  const tailKey = thread?.messages?.at(-1)?.id ?? "";
  useLayoutEffect(() => {
    const feed = threadFeed.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [threadOpen, view, threadFull, tailKey]);
  useEffect(() => {
    if (!threadOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !composing) setThreadOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [threadOpen, composing]);

  const openComposer = () => {
    heard.current = false;
    sessionRef.current += 1;
    live.current = true;
    setSession(sessionRef.current);
    setSent(null);
    setError(null);
    setComposing(true);
    if (hosted) focusCompanionInput();
    window.requestAnimationFrame(() => field.current?.focus());
  };
  const close = () => {
    // Closing unmounts the mic, which cancels any take in flight.
    sessionRef.current += 1;
    live.current = false;
    holdSend(false);
    setComposing(false);
    setDraft("");
    setError(null);
  };
  const post = async (body: string, forSession: number) => {
    if (!work.conversationId) return;
    setSendingFor(forSession);
    setError(null);
    try {
      await api("/api/send", { method: "POST", body: JSON.stringify({ body, chatId: work.conversationId }) });
      // Sent either way; only the composer that sent it closes.
      if (sessionRef.current !== forSession) return;
      sessionRef.current += 1;
      live.current = false;
      setSent({ at: Date.now() });
      setComposing(false);
      setDraft("");
      setThreadBump((n) => n + 1);
    } catch (failure) {
      if (sessionRef.current === forSession) setError(failure instanceof Error ? failure.message : "Could not send.");
    } finally {
      setSendingFor((current) => (current === forSession ? null : current));
    }
  };
  // Words from a take landed. A held send waits for the mic's next status,
  // which says whether the take ended cleanly or with an error.
  const heard = useRef(false);
  const append = (text: string, from: number) => {
    if (!live.current || from !== sessionRef.current) return;
    const prev = draftRef.current;
    const next = prev.trim() ? `${prev.replace(/\s*$/, "")} ${text}` : text;
    draftRef.current = next;
    setDraft(next);
    heard.current = true;
  };
  const send = () => {
    if (sending || sendWhenHeard || !work.conversationId) return;
    // Mid-take: finish it; the reply goes when its words land.
    if (dictation.current?.busy() || listening || mic?.state === "processing") {
      holdSend(true);
      dictation.current?.finish();
      return;
    }
    const body = draft.trim();
    if (body) void post(body, session);
  };
  // Send a held reply once the take is over and its words are in. A take that
  // ended in an error (even with recovered words) is left for review.
  useEffect(() => {
    if (!sendWhenHeardRef.current || !mic || mic.state !== "idle") return;
    if (mic.tone === "error") {
      heard.current = false;
      holdSend(false);
      return;
    }
    // Not busy means the take's transcript, if any, is already in the draft:
    // the mic clears its handle in the same step that delivers the words.
    if (dictation.current?.busy()) return;
    heard.current = false;
    holdSend(false);
    const body = draftRef.current.trim();
    if (body) void post(body, sessionRef.current);
  }, [mic]);

  const meta = (
    <div className="ce-in__meta">
      <span className={`ce-in__cell${underlying === "needs" && !offline ? " is-ask" : ""}`} data-visible={reading}><i>State</i>{stateLabel}</span>
      <span className="ce-in__cell"><i>Age</i>{ageLabel(work.lastActivityAt, refTime)}</span>
      <span className="ce-in__cell" title={name}><i>Agent</i>{name}</span>
      {work.harness && <span className="ce-in__cell"><i>Harness</i>{work.harness}</span>}
    </div>
  );

  // Talk: Codex's own voice chat, in the ChatGPT app, in this work's thread.
  // Only a chat pinned from the ChatGPT app: Scout's own Codex sessions keep
  // their threads in a store the app never reads.
  const codexThread = hosted ? work.codexThreadId ?? null : null;
  const [talk, setTalk] = useState<"starting" | "listening" | null>(null);
  const [talkError, setTalkError] = useState<string | null>(null);
  // While voice is on, the figure's card carries the chat's own controls.
  const voice = codexThread ? work.voice ?? null : null;
  useEffect(() => { if (voice) setTalk(null); }, [Boolean(voice)]);
  const [pressing, setPressing] = useState<CompanionVoiceControl | null>(null);
  const pressVoice = (control: CompanionVoiceControl, muted?: boolean) => {
    if (!codexThread || pressing) return;
    setPressing(control);
    setTalkError(null);
    pressCodexVoice(control, { muted, threadIds: [codexThread] })
      .catch((reason: unknown) => setTalkError(reason instanceof Error ? reason.message : "ChatGPT didn't take that."))
      .finally(() => setPressing(null));
  };
  const startTalk = () => {
    if (!codexThread || talk === "starting") return;
    setTalk("starting");
    setTalkError(null);
    talkInCodex(codexThread)
      .then((result) => setTalk(result.listening ? "listening" : null))
      .catch((reason: unknown) => {
        setTalk(null);
        setTalkError(reason instanceof Error ? reason.message : "Voice didn't start.");
      });
  };

  const note = [
    work.seen ? "Dismissed. Anything new from it brings the alert back." : null,
    !work.seen && underlying === "resting" && work.state ? RESTING_NOTE[work.state] ?? null : null,
    work.visitorFrom ? `Runs on ${work.visitorFrom}, not this Mac` : null,
    work.origin ? `Surfaced ${work.origin}` : null,
  ].filter(Boolean).join(" · ");

  const composerBox = composing && work.conversationId ? (
        <div className="ce-in__box" data-listening={listening}>
          <textarea
            ref={field}
            className="ce-in__input"
            rows={3}
            value={draft}
            placeholder={`Reply to ${name}`}
            aria-label={`Reply to ${name}`}
            onChange={(event) => {
              // Typing takes over: dictation stops, and its words still land.
              if (listening) dictation.current?.finish();
              if (sendWhenHeard) holdSend(false);
              setDraft(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              } else if (event.key === "Escape") {
                event.stopPropagation();
                close();
              }
            }}
          />
          {listening && mic?.partial ? <p className="ce-in__heard">{mic.partial}</p> : null}
          {error || (mic?.tone === "error" && mic.message) ? <p className="ce-in__err">{error ?? mic?.message}</p> : null}
          <div className="ce-in__row">
            <DictationMic
              className="ce-in__mic"
              autoStart={draft === ""}
              controlRef={dictation}
              disabled={sending}
              onStatus={setMic}
              key={session}
              onAppend={(text) => append(text, session)}
            />
            <span className="ce-in__hint">
              {listening ? "Listening · type to take over" : mic?.state === "processing" ? "Transcribing…" : "To the thread"}
            </span>
            <button type="button" className="ce-in__q" onClick={close}>Discard</button>
            <button type="button" className="ce-in__send" disabled={(!draft.trim() && !listening) || sending || sendWhenHeard} onClick={send}>
              {sending || sendWhenHeard ? "Sending…" : "Send"} <kbd>↩</kbd>
            </button>
          </div>
        </div>
  ) : null;

  const PREVIEW = 3;
  const tail = thread?.messages ?? null;
  const shown = tail && !threadFull && !composing ? tail.slice(-PREVIEW) : tail;
  const hidden = tail && shown ? tail.length - shown.length : 0;
  const showThread = view === "thread" && !!work.conversationId;
  const detail = workDetail?.detail ?? null;
  // The Work page's masthead, in small: where, how long, who, the state in
  // one phrase with the agent's last milestone, and what it made.
  const tone = detail ? workStatusTone(detail) : "idle";
  const verdict = detail ? workStateLabel(detail) : null;
  const milestones = detail ? workMilestones(detail) : [];
  const milestone = milestones.at(-1) ?? (detail?.lastMeaningfulSummary
    ? { id: "last", text: detail.lastMeaningfulSummary.replace(/^\s*\[ask:[^\]]+\]\s*/i, ""), at: detail.lastMeaningfulAt }
    : null);
  const earlier = milestones.slice(0, -1).slice(-WORK_STEPS);
  const ask = detail?.primaryInvocation ?? null;
  const asked = ask?.task?.trim() || detail?.summary?.trim() || null;
  const askedBy = ask ? [ask.requesterName ?? ask.requesterId, ask.targetAgentName ?? ask.targetAgentId].filter(Boolean).join(" → ") : null;
  const model = ask ? (ask.observedModel ?? ask.resolvedModel ?? ask.requestedModel) : null;
  const harness = ask ? (ask.observedHarness ?? ask.resolvedHarness ?? ask.requestedHarness) : null;
  const run = [model, harness && harness !== model ? harness : null, ask?.state === "failed" ? "failed" : null].filter(Boolean).join(" · ");
  const totals = detail?.inventory?.totals as Record<string, number> | undefined;
  const touched = totals ? TOUCHED_KINDS.filter(([key]) => (totals[key] ?? 0) > 0).map(([key, label]) => `${totals[key]} ${label}`).join(" · ") : "";
  const made = detail ? madeLinks(detail).slice(0, 3) : [];
  const ran = detail ? runSpan(detail) : null;
  const where = work.agent as { projectRoot?: string | null; branch?: string | null } | undefined;
  const workMeta = detail ? [
    where?.projectRoot ? where.projectRoot.replace(/^\/Users\/[^/]+/, "~") : null,
    where?.branch ?? null,
    [ran != null ? `${tone === "active" ? "running " : ""}${span(ran)}` : null, timeAgoWithSuffix(detail.lastMeaningfulAt)].filter(Boolean).join(" · "),
    detail.ownerName ?? detail.ownerId ?? null,
  ].filter((part): part is string => !!part) : [];
  const dive = showThread ? onThread : onWork;
  const spring = threadOpen && (view === "work" || work.conversationId) ? (
    <div
      className={`ce-in__thread${!showThread ? " is-work" : threadFull || composing ? " is-full" : ""}`}
      role="dialog"
      aria-label={showThread ? `Thread with ${name}` : `Work: ${work.title}`}
      data-hit="popover-thread"
      style={notchX === null ? undefined : { ["--ce-notch-x" as string]: `${notchX}px` }}
    >
      <header className="ce-in__thread-head">
        {showThread ? (
          <><b title={name}>{name}</b><span title={work.title}>{work.title}</span></>
        ) : (
          <b className="ce-in__wk-title" title={work.title}>{detail?.title ?? work.title}</b>
        )}
      </header>
      {showThread ? (
        <>
          {hidden > 0 && (
            <button type="button" className="ce-in__earlier" onClick={() => setThreadFull(true)}>
              {hidden} earlier
            </button>
          )}
          <ol
            className="ce-in__tx"
            ref={threadFeed}
            onWheel={(event) => { if (!threadFull && hidden > 0 && event.deltaY < 0) setThreadFull(true); }}
          >
            {shown?.length ? shown.map((message) => (
              <li key={message.id} className={message.actorId === "operator" ? "is-me" : undefined}>
                <header><b>{message.actorId === "operator" ? "You" : message.actorName}</b><i>{ageLabel(message.createdAt, refTime)}</i></header>
                <p>{message.body}</p>
              </li>
            )) : (
              <li className="ce-in__tx-empty">
                {thread?.failed ? "Could not load the thread." : tail ? "No messages yet." : "Loading the thread…"}
              </li>
            )}
          </ol>
          {composerBox}
        </>
      ) : detail ? (
        <div className="ce-in__wk">
          {workMeta.length > 0 && <p className="ce-in__wk-meta">{workMeta.map((part) => <span key={part}>{part}</span>)}</p>}
          <div className="ce-in__wk-verdict">
            <span className="ce-in__wk-state" data-tone={tone}><i aria-hidden="true" />{verdict?.main}{verdict?.sub ? ` · ${verdict.sub}` : ""}</span>
            {milestone && <p title={new Date(milestone.at).toLocaleString()}><Milestone text={milestone.text} /></p>}
          </div>
          {asked && (
            <section className="ce-in__wk-sec">
              <h4>Asked{askedBy ? <i>{askedBy}</i> : null}</h4>
              <p className="ce-in__wk-asked" title={asked}>{asked}</p>
            </section>
          )}
          {earlier.length > 0 && (
            <section className="ce-in__wk-sec">
              <h4>Progress</h4>
              <ol className="ce-in__wk-steps">
                {earlier.map((step) => (
                  <li key={step.id}>
                    <span title={step.text}><Milestone text={step.text} /></span>
                    <i>{ageLabel(step.at, refTime)}</i>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {(run || touched || made.length > 0) && (
            <dl className="ce-in__wk-facts">
              {run && <><dt>Run</dt><dd>{run}</dd></>}
              {touched && <><dt>Touched</dt><dd>{touched}</dd></>}
              {made.length > 0 && (
                <><dt>Made</dt><dd>{made.map((link) => <span key={link.material.id} title={link.material.path}>{link.display.split("/").pop()}</span>)}</dd></>
              )}
            </dl>
          )}
        </div>
      ) : workDetail?.failed ? (
        <p className="ce-in__tx-empty ce-in__wk">Could not load this work.</p>
      ) : (
        // The same frame, held while the work loads: what the card already
        // knows (state, last report) is real; the rest is placeholder lines.
        <div className="ce-in__wk" aria-busy="true" aria-label="Loading the work">
          <p className="ce-in__wk-meta"><i className="ce-sk" style={{ width: "64%" }} /></p>
          <div className="ce-in__wk-verdict">
            <span className="ce-in__wk-state" data-tone={underlying === "working" ? "active" : undefined}><i aria-hidden="true" />{stateLabel}</span>
            {work.report
              ? <p>{work.report}</p>
              : <p><i className="ce-sk ce-sk--line" /><i className="ce-sk ce-sk--line" style={{ width: "72%" }} /></p>}
          </div>
          <section className="ce-in__wk-sec">
            <h4>Asked</h4>
            <p className="ce-in__wk-asked"><i className="ce-sk ce-sk--line" /><i className="ce-sk ce-sk--line" style={{ width: "58%" }} /></p>
          </section>
          <section className="ce-in__wk-sec">
            <h4>Progress</h4>
            <ol className="ce-in__wk-steps">
              {[86, 70, 78].map((width) => (
                <li key={width}><span><i className="ce-sk ce-sk--line" style={{ width: `${width}%` }} /></span><i className="ce-sk" style={{ width: 18 }} /></li>
              ))}
            </ol>
          </section>
          <dl className="ce-in__wk-facts">
            <dt>Run</dt><dd><i className="ce-sk" style={{ width: "48%" }} /></dd>
            <dt>Touched</dt><dd><i className="ce-sk" style={{ width: "40%" }} /></dd>
          </dl>
        </div>
      )}
      {!showThread && !workDetail?.failed && (
        <section className="ce-in__wk-sec ce-in__wk-tail" aria-label="Tail">
          <h4>Tail{tone === "active" && <i className="ce-in__wk-live" aria-label="live" />}</h4>
          {!detail ? (
            <ol>{Array.from({ length: TAIL_ROWS }, (_, index) => <li key={index}><i className="ce-sk" style={{ width: `${[72, 54, 80, 46, 64][index]}%` }} /></li>)}</ol>
          ) : tailSteps.length > 0 ? (
            <ol>
              {tailSteps.slice(-TAIL_ROWS).map((step) => (
                <li key={step.id} data-status={step.status}>
                  <span title={step.text}>
                    {step.tool ? <><b>{step.tool}</b> {step.arg ?? ""}</> : step.text}
                    {step.repeatCount > 1 ? <em> ×{step.repeatCount}</em> : null}
                  </span>
                  <i>{ageLabel(step.ts, refTime)}</i>
                </li>
              ))}
            </ol>
          ) : (
            <p className="ce-in__wk-quiet">
              {tailScope.length === 0 ? "No session to follow yet." : tone === "active" ? "Waiting for the session's next move…" : "Nothing recent from this session."}
            </p>
          )}
        </section>
      )}
      {dive && (
        <footer className="ce-in__sfoot">
          <button type="button" className="ce-in__q ce-in__openin" onClick={() => { setThreadOpen(false); dive(); }}>
            {showThread ? "Open thread" : "Open work"} <ArrowGlyph />
          </button>
        </footer>
      )}
    </div>
  ) : null;

  return (
    <div className="ce-in">
      {meta}
      <h3 className="ce-in__title" title={work.title}>{work.title}</h3>
      {work.report && <Prose text={work.report} />}
      {note && <p className="ce-in__note">{note}</p>}
      {talkError && <p className="ce-in__err">{talkError}</p>}

      {!threadOpen && composerBox}

      <div className="ce-in__acts">
        {sent && <span className="ce-in__sent">Sent</span>}
        {voice ? (
          <span className="ce-in__voice" role="group" aria-label="Voice chat in ChatGPT">
            <span className="ce-in__sent">{voice.micMuted ? "Voice on, mic muted" : "Listening in ChatGPT"}</span>
            {voice.micMuted !== null && (
              <button type="button" className="ce-in__vbtn" aria-pressed={voice.micMuted} disabled={pressing !== null}
                onClick={() => pressVoice("microphone", !voice.micMuted)} title={voice.micMuted ? "Unmute the microphone" : "Mute the microphone"}>
                {voice.micMuted ? <MicOffGlyph /> : <MicGlyph />}
              </button>
            )}
            {voice.speakersMuted !== null && (
              <button type="button" className="ce-in__vbtn" aria-pressed={voice.speakersMuted} disabled={pressing !== null}
                onClick={() => pressVoice("speakers", !voice.speakersMuted)} title={voice.speakersMuted ? "Unmute the speakers" : "Mute the speakers"}>
                <SpeakerGlyph muted={voice.speakersMuted} />
              </button>
            )}
            <button type="button" className="ce-in__vbtn is-stop" disabled={pressing !== null} onClick={() => pressVoice("stop")} title="Stop the voice chat">
              Stop
            </button>
          </span>
        ) : talk === "listening" && <span className="ce-in__sent">Listening in ChatGPT</span>}
        {!composing && work.conversationId && (
          <button type="button" className="ce-in__reply" onClick={openComposer} title="Reply in the thread. Starts listening when voice is ready; typing always works.">
            <MicGlyph />{sent ? "Reply again" : "Reply"}
          </button>
        )}
        {!composing && codexThread && !voice && talk !== "listening" && (
          <button
            type="button"
            className="ce-in__reply"
            onClick={startTalk}
            disabled={talk === "starting"}
            title="Talk to this thread with Codex's own voice chat, in the ChatGPT app."
          >
            <MicGlyph />{talk === "starting" ? "Starting…" : "Talk"}
          </button>
        )}
        {spring}
        {onThread && (
          work.conversationId ? (
            <button
              ref={threadButton}
              type="button"
              className={`ce-in__q${threadOpen && view === "thread" ? " is-pressed" : ""}`}
              aria-expanded={threadOpen && view === "thread"}
              title={threadOpen && view === "thread" ? "Put the thread away (esc)" : "Show the thread here"}
              onClick={() => press("thread")}
            >
              Thread
            </button>
          ) : (
            <button type="button" className="ce-in__q" onClick={onThread}>Thread</button>
          )
        )}
        <button
          ref={workButton}
          type="button"
          className={`ce-in__q${threadOpen && view === "work" ? " is-pressed" : ""}`}
          aria-expanded={threadOpen && view === "work"}
          title={threadOpen && view === "work" ? "Put the work away (esc)" : "Show the work here"}
          onClick={() => press("work")}
        >
          {work.state === "done" ? "Output" : "Work"}
        </button>
        {onPin && <button type="button" className="ce-in__q" onClick={onPin}>Pin</button>}
        {onDismiss && !offline && (
          <button type="button" className="ce-in__q" onClick={onDismiss} title="Clear the alert. Anything new from this work brings it back.">Dismiss</button>
        )}
        {figureSettings && (
          <button type="button" className="ce-in__gear" aria-label="Figure settings" title="Figure settings" aria-expanded={gear} onClick={() => setGear((value) => !value)}>
            <GearGlyph />
          </button>
        )}
      </div>
      {gear && figureSettings}
    </div>
  );
}
