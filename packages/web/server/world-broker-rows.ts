/**
 * World · broker deliveries: the messages the broker could not get to their recipient, read the same way by the
 * snapshot collector (world-hosts.ts) and the live tail (world-tail.ts). Portable on purpose (bun:sqlite handle in,
 * plain rows out, world-transcript.ts for the redactor only) — the tail bundles it for ssh.
 *
 * Only deliveries that can be trouble travel: a message (not an ask — an ask's own delivery is the ask, already drawn)
 * to an agent or a session (not the operator's polled inbox, which waits for its reader by design) that FAILED, or is
 * still pending / running. Delivered ones are left at home: the broker records no delivery time for them.
 */
import { redact } from "./world-transcript.ts";

/** [the delivery's id, created, finished (null while open), broker status, message sender id, target id, target name, transport, text, error] */
export type BrokerDelivery = { id: string; created_at: number; done_at: number | null; status: string; from: string; to: string; to_name: string | null; transport: string; text: string; error: string | null };
export const OPEN_DELIVERY = new Set(["pending", "running", "queued", "leased", "retrying"]);
export const deliveryState = (status: string | null | undefined): "o" | "c" | "f" => status === "failed" ? "f" : OPEN_DELIVERY.has(String(status || "")) ? "o" : "c";

const COLS = `d.rowid as rid, d.id, d.created_at, d.status, d.target_id, d.transport, d.metadata_json, m.actor_id, m.body,
  (select x.display_name from actors x where x.id = d.target_id) as to_name,
  (select a.error from delivery_attempts a where a.delivery_id = d.id and a.error is not null order by a.created_at desc limit 1) as attempt_error`;
const TROUBLE = `d.message_id is not null and d.target_id != 'operator' and d.transport != 'mcp_poll'
  and (d.metadata_json is null or json_extract(d.metadata_json, '$.invocationId') is null)`;

function row(r: any): BrokerDelivery {
  let md: Record<string, any> = {}; try { md = JSON.parse(r.metadata_json || "{}") || {}; } catch {}
  const st = deliveryState(r.status), at = Number(md.statusUpdatedAt || md.failedAt || md.completedAt) || null;
  const err = r.attempt_error || md.failureDetail || md.error || null;
  return {
    id: String(r.id), created_at: Number(r.created_at), done_at: st === "o" ? null : Math.max(Number(r.created_at), at || Number(r.created_at)), status: String(r.status || ""),
    from: String(r.actor_id || ""), to: String(r.target_id || ""), to_name: r.to_name ? String(r.to_name).slice(0, 80) : null, transport: String(r.transport || "").slice(0, 32),
    text: redact(String(r.body || "").replace(/\s+/g, " ").slice(0, 400)).slice(0, 200), error: err ? redact(String(err).replace(/\s+/g, " ").slice(0, 400)).slice(0, 200) : null,
  };
}

/** The snapshot: every trouble delivery made since `from` — failed ones and ones still open. */
export function readTroubleDeliveries(db: any, from: number): BrokerDelivery[] {
  try {
    return (db.query(`select ${COLS} from deliveries d left join messages m on m.id = d.message_id
      where d.created_at > ? and ${TROUBLE} and (d.status = 'failed' or d.status in (${[...OPEN_DELIVERY].map(s => `'${s}'`).join(",")})) order by d.created_at`).all(from) as any[]).map(row);
  } catch { return []; }
}

/** The tail: trouble deliveries new since rowid `after`, plus the ones still open last time (re-sent once they finish). */
export function readDeliveriesSince(db: any, from: number, after: number, open: string[]): { rows: BrokerDelivery[]; maxRow: number; open: string[] } {
  try {
    const fresh = db.query(`select ${COLS} from deliveries d left join messages m on m.id = d.message_id where d.rowid > ? and d.created_at > ? and ${TROUBLE} order by d.rowid limit 2000`).all(after, from) as any[];
    const again = open.length ? db.query(`select ${COLS} from deliveries d left join messages m on m.id = d.message_id where d.id in (${open.map(() => "?").join(",")})`).all(...open) as any[] : [];
    let maxRow = after; for (const r of fresh) maxRow = Math.max(maxRow, Number(r.rid) || 0);
    const wasOpen = new Set(open), seen = new Set<string>(), rows: BrokerDelivery[] = [], stillOpen: string[] = [];
    for (const r of [...again, ...fresh]) {
      if (seen.has(r.id)) continue; seen.add(r.id);
      const d = row(r), st = deliveryState(d.status);
      if (st === "o") stillOpen.push(d.id);
      // new: only trouble travels (failed or open); known-open: only once it finished
      if (wasOpen.has(d.id) ? st !== "o" : st !== "c") rows.push(d);
    }
    return { rows, maxRow, open: stillOpen.slice(-400) };
  } catch { return { rows: [], maxRow: after, open }; }
}
