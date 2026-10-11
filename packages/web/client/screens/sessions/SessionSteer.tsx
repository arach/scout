import { useId } from "react";
import { isComposerSendShortcut, type ComposeShortcutEvent } from "../../lib/compose-shortcuts.ts";
import { SESSION_STEER_MAX_LENGTH, type SessionSteerAuditEntry } from "../../../shared/api/session-steer.ts";

export type PendingSessionSteer = { id: string; text: string; duringTurn: boolean; observedIds: string[] };
export function unobservedSteers(pending: PendingSessionSteer[], prompts: { id: string; text: string }[]) {
  const matched = new Set<string>();
  return pending.filter((entry) => {
    const prompt = prompts.find((p) => !matched.has(p.id) && !entry.observedIds.includes(p.id) && p.text.trim() === entry.text.trim());
    if (prompt) matched.add(prompt.id);
    return !prompt;
  });
}
export function steerShortcut(event: ComposeShortcutEvent & { preventDefault(): void }, send: () => void) {
  if (isComposerSendShortcut(event, true)) { event.preventDefault(); send(); }
}

/** Codex's composer shape; no attachment, model, queue or branch controls
 * until this exact-session surface has a backing operation for them. */
export function SessionSteerComposer({ draft, onChange, submit, interrupt, working, busy, available, reason, error, status, pending = [] }: {
  draft: string; onChange: (value: string) => void; submit: () => void; interrupt?: (() => void) | null;
  working: boolean; busy: boolean; available: boolean; reason: string;
  error?: string | null; status?: string | null; pending?: PendingSessionSteer[];
}) {
  const reasonId = useId();
  const canSend = available && !busy && !!draft.trim() && draft.length <= SESSION_STEER_MAX_LENGTH;
  return <div className="s-session-composer">
    {pending.length > 0 && <div className="s-session-pending" aria-label="Sent steering" aria-live="polite">
      {pending.map((entry) => <div key={entry.id} className="s-session-pending-message"><p>{entry.text}</p>
        <small>{entry.duringTurn ? "Steered" : "Sent"} · awaiting transcript</small></div>)}
    </div>}
    <form className="s-session-composer-box" onSubmit={(event) => { event.preventDefault(); if (canSend) submit(); }} aria-label="Steer session" aria-busy={busy}>
      <textarea aria-label="Message" aria-describedby={!available ? reasonId : undefined}
        placeholder="Ask for follow-up changes" rows={2} maxLength={SESSION_STEER_MAX_LENGTH}
        value={draft} disabled={!available || busy} onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => steerShortcut(event, () => { if (canSend) submit(); })} />
      <div className="s-session-composer-tools">
        {working && <button type="submit" className="s-session-steer-action" disabled={!canSend}>Steer</button>}
        {working ? interrupt && <button type="button" className="s-session-send" aria-label="Stop" title="Stop" disabled={busy} onClick={interrupt}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" /></svg>
        </button> : <button type="submit" className="s-session-send" aria-label="Steer" title="Steer" disabled={!canSend}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-7 7 7-7 7 7" /></svg>
        </button>}
      </div>
    </form>
    {!available && <p className="s-session-steer-reason" id={reasonId} role="status" title={reason}>{reason}</p>}
    {error && <p role="alert">{error} Your draft has been kept.</p>}
    {status && <p role="status">{status}</p>}
  </div>;
}

export function SessionSteeredList({ entries, error }: { entries: SessionSteerAuditEntry[] | null; error?: string | null }) {
  return <section className="s-session-steered" aria-label="Steered"><h3>Steered</h3>
    {error ? <p role="status">{error}</p> : !entries ? <p>Loading…</p> : entries.length === 0 ? <p>No steering recorded.</p> : <ol>
      {entries.map((entry) => <li key={entry.id}><details><summary>
        <time dateTime={entry.at} title={new Date(entry.at).toLocaleString()}>{new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
        <span>{entry.outcome === "accepted" ? "Steered" : entry.outcome === "unconfirmed" ? "Unconfirmed" : "Refused"} · {entry.operator}</span>
      </summary><p>{entry.reason}</p><dl>
        <dt>Machine</dt><dd>{entry.machine ?? "Unverified"} · {entry.serverHost}</dd>
        <dt>Target</dt><dd>{entry.target ? `${entry.target.host} ${entry.target.address} · PID ${entry.target.pid}` : "Unbound"}</dd>
        <dt>Text</dt><dd>{entry.textLength} characters</dd>
        <dt>Text SHA-256</dt><dd><code>{entry.textSha256}</code></dd>
      </dl>{!!entry.duplicateOutcomes && <p role="status">Duplicate outcome flagged; the first outcome is shown.</p>}</details></li>)}
    </ol>}
  </section>;
}
