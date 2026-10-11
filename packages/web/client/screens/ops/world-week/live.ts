/**
 * World · live client: one EventSource on the delta stream (GET …/world-live, see packages/web/server/world-live.ts).
 * `seed` is a whole payload in the week's shape (mount it), `delta` rows indexed against that seed (hand to the
 * engine's appendLive), `status` per-host freshness every few seconds. EventSource reconnects by itself after a drop;
 * a reconnect brings a fresh seed, so the page simply remounts. Shared by the Studio study and /ops/week.
 */
export type LiveSource = "live" | "otlp";
export type LiveHandlers = {
  onSeed: (payload: any) => void;
  onDelta: (delta: any) => void;
  onStatus?: (status: any) => void;
  onError?: (message: string) => void;
};

export function connectWorldLive(url: string, h: LiveHandlers): () => void {
  let es = new EventSource(url), closed = false, heard = Date.now();
  const parse = (e: MessageEvent) => { heard = Date.now(); try { return JSON.parse(e.data); } catch { return null; } };
  // the server says something every 5s (status). A dev proxy can hold the browser's side open after the server went
  // away, so EventSource never notices: 20s of silence and we dial again, which brings a fresh seed
  const watchdog = setInterval(() => {
    if (closed || Date.now() - heard < 20_000) return;
    heard = Date.now(); es.close(); h.onError?.("LIVE FEED SILENT · RECONNECTING…"); es = new EventSource(url); wire();
  }, 5_000);
  const wire = () => {
    es.addEventListener("seed", e => { const p = parse(e as MessageEvent); if (p && !closed) h.onSeed(p); });
    es.addEventListener("delta", e => { const d = parse(e as MessageEvent); if (d && !closed) h.onDelta(d); });
    es.addEventListener("status", e => { const s = parse(e as MessageEvent); if (s && !closed) h.onStatus?.(s); });
    // a server-side message (named "error" with data) versus the transport dropping (no data): both are worth saying
    es.addEventListener("error", e => {
      if (closed) return;
      const m = (e as MessageEvent).data;
      if (typeof m === "string" && m) { let msg = m; try { msg = JSON.parse(m).error || m; } catch {} h.onError?.(String(msg)); return; }
      h.onError?.(es.readyState === EventSource.CLOSED ? "LIVE FEED CLOSED" : "LIVE FEED RECONNECTING…");
    });
  };
  wire();
  return () => { closed = true; clearInterval(watchdog); es.close(); };
}

/** ?source=week|live|otlp, with the older ?live meaning live; anything else is the snapshot week */
export function sourceFromSearch(search: string): "week" | LiveSource {
  const q = new URLSearchParams(search), s = q.get("source");
  if (s === "live" || s === "otlp" || s === "week") return s;
  return q.has("live") ? "live" : "week";
}

/** the URL after a switch: ?source= set (week drops it), ?live retired, every other param kept */
export function searchWithSource(search: string, source: string): string {
  const q = new URLSearchParams(search);
  q.delete("live");
  if (source === "week") q.delete("source"); else q.set("source", source);
  const s = q.toString();
  return s ? "?" + s : "";
}
