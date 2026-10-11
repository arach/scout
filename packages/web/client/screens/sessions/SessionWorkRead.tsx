import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { timeAgo } from "../../lib/time.ts";
import type { SessionWorkReadResponse } from "../../../shared/api/session-work-read.ts";
import "./session-work-read.css";

/** Poll fast while a read is on its way, slowly while the session is live. */
const PENDING_POLL_MS = 4_000;
const LIVE_POLL_MS = 30_000;

/**
 * Scoutbot's read of the session's work, above the trace: what it is doing
 * now, the operator guidance in force, and the shape of the work. The trace
 * below stays the record; this is the soft half.
 */
export function SessionWorkRead({
  agentId,
  sessionId,
  live,
}: {
  agentId?: string | null;
  sessionId?: string | null;
  live?: boolean;
}) {
  const [result, setResult] = useState<SessionWorkReadResponse | null>(null);

  useEffect(() => {
    if (!agentId && !sessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const params = new URLSearchParams();
    if (agentId) params.set("agentId", agentId);
    if (sessionId) params.set("sessionId", sessionId);
    const load = async () => {
      const next = await api<SessionWorkReadResponse>(`/api/session-work-read?${params}`).catch(() => null);
      if (cancelled) return;
      if (next) setResult(next);
      const waiting = next?.status === "pending" || (next?.status === "ready" && next.stale);
      if (waiting || live) timer = setTimeout(load, waiting ? PENDING_POLL_MS : LIVE_POLL_MS);
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [agentId, sessionId, live]);

  if (!result || result.status === "unavailable") return null;

  if (result.status === "pending") {
    return (
      <section className="s-work-read s-work-read--pending" aria-busy="true">
        <header className="s-work-read-label">
          <span>Read by Scoutbot</span>
          <span className="s-work-read-meta">reading the session…</span>
        </header>
        <div className="s-work-read-ghost" />
        <div className="s-work-read-ghost s-work-read-ghost--short" />
      </section>
    );
  }

  const { read } = result;
  const shapeRows: [string, string][] = [
    ...(read.shape.goal ? [["Goal", read.shape.goal] as [string, string]] : []),
    ...(read.shape.must.length ? [["Must", read.shape.must.join(" · ")] as [string, string]] : []),
    ...(read.shape.mustNot.length ? [["Must not", read.shape.mustNot.join(" · ")] as [string, string]] : []),
    ...(read.shape.deliver ? [["Deliver", read.shape.deliver] as [string, string]] : []),
  ];

  return (
    <section className="s-work-read" aria-label="Scoutbot's read of this session">
      <header className="s-work-read-label">
        <span>Read by Scoutbot</span>
        <span className="s-work-read-meta">
          {result.model}
          {result.turn > 0 && ` · after turn ${result.turn}`}
          {` · ${timeAgo(result.generatedAt)}`}
          {result.stale && " · updating"}
        </span>
      </header>

      <p className="s-work-read-now">{read.now}</p>

      {(read.steering.length > 0 || shapeRows.length > 0) && (
        <div className="s-work-read-grid">
          {read.steering.length > 0 && (
            <div>
              <h3 className="s-work-read-h">Guidance in force</h3>
              <ol className="s-work-read-steer">
                {read.steering.map((item) => (
                  <li key={`${item.askIndex ?? "x"}-${item.text}`}>
                    {item.at && <span className="s-work-read-when">{timeAgo(item.at)} · you</span>}
                    <p>{item.text}</p>
                    {item.supersedes && (
                      <span className="s-work-read-supersedes">replaces: {item.supersedes}</span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {shapeRows.length > 0 && (
            <div>
              <h3 className="s-work-read-h">Shape of the work</h3>
              <dl className="s-work-read-shape">
                {shapeRows.map(([term, value]) => (
                  <div key={term}>
                    <dt>{term}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
