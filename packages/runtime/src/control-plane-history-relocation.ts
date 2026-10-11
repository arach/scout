import { CONTROL_PLANE_HISTORY_ANCHORS_SQLITE_SCHEMA } from "./schema.js";
import type { HistoryRotationPlan } from "./history-rotation.js";
import { emptyHistoryRotationPlan } from "./history-rotation.js";
import { ControlPlaneHistoryStore, HISTORY_PARTITION_LIMITS, historicalRecordDigest, historicalRecordKey, type HistoricalPublication, type HistoricalRecord } from "./control-plane-history-store.js";
import type { ControlPlaneSqliteDatabase } from "./sqlite-adapter.js";

const targets = [
  { kind: "delivery_attempt", table: "delivery_attempts", set: "deliveryAttemptIds" },
  { kind: "delivery", table: "deliveries", set: "deliveryIds" },
  { kind: "flight", table: "flights", set: "flightIds" },
  { kind: "invocation", table: "invocations", set: "invocationIds" },
  { kind: "message", table: "messages", set: "messageIds" },
  { kind: "collaboration_event", table: "collaboration_events", set: "collaborationEventIds" },
] as const;
type Target = typeof targets[number];
type Row = Record<string, unknown>;
type RawRecord = { table: string; row: Row; related: Record<string, Row[]> };
type ForeignKey = { table: string; from: string; to: string };
export type HistoricalRelocationBlocker = { kind: string; id: string; reason: string };
export type HistoricalRelocationPublication = { publication: HistoricalPublication | null; published: HistoryRotationPlan; blocked: HistoricalRelocationBlocker[] };
export type HistoricalRelocationResult = { removed: HistoryRotationPlan; blocked: HistoricalRelocationBlocker[] };
export type HistoricalTypedReader = (kind: Target["kind"], ids: readonly string[]) => Map<string, unknown>;
const ownedChildren: Record<string, Record<string, string>> = {
  messages: { message_mentions: "message_id", message_attachments: "message_id", message_reactions: "message_id", conversation_projection_message_facts: "message_id", activity_items: "message_id" },
  invocations: { activity_items: "invocation_id" }, flights: { activity_items: "flight_id" },
};
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
export function ensureHistoryAnchorSchema(db: ControlPlaneSqliteDatabase): void {
  db.exec(CONTROL_PLANE_HISTORY_ANCHORS_SQLITE_SCHEMA);
}
const rawId = (table: string, id: string) => JSON.stringify([table, id]);

/** Worker-only bounded publication and conditional removal; never disables FKs. */
export class ControlPlaneHistoryRelocation {
  private incoming: Map<string, ForeignKey[]> | null = null;
  constructor(private readonly db: ControlPlaneSqliteDatabase, private readonly readTyped: HistoricalTypedReader) {}

  private capture(table: string, id: string): RawRecord | null {
    const row = this.db.query<Row>(`SELECT * FROM ${quote(table)} WHERE id=?1`).get(id);
    if (!row) return null;
    const related: Record<string, Row[]> = {};
    for (const [child, column] of Object.entries(ownedChildren[table] ?? {})) {
      related[child] = this.db.query<Row>(`SELECT * FROM ${quote(child)} WHERE ${quote(column)}=?1 ORDER BY rowid`).all(id);
    }
    return { table, row, related };
  }

  publish(plan: HistoryRotationPlan, history: ControlPlaneHistoryStore): HistoricalRelocationPublication {
    const records: HistoricalRecord[] = [];
    const published = emptyHistoryRotationPlan();
    const blocked: HistoricalRelocationBlocker[] = [];
    let bytes = 0;
    let oversizedBundle = false;
    for (const target of targets) {
      if (oversizedBundle) break;
      // One RPC/publication remains bounded even if its caller supplied a large plan.
      for (const id of plan[target.set]) {
        if (records.length >= 200) break;
        if (this.db.query("SELECT 1 FROM broker_history_anchors WHERE kind=?1 AND id=?2").get(target.kind, id)) continue;
        const raw = this.capture(target.table, id);
        if (!raw) continue;
        const record = this.readTyped(target.kind, [id]).get(id) as Row | undefined;
        if (!record) { blocked.push({ kind: target.kind, id, reason: "typed record missing" }); continue; }
        const conversationId = typeof record.conversationId === "string" ? record.conversationId : undefined;
        const invocationId = typeof record.invocationId === "string" ? record.invocationId : target.kind === "invocation" ? id : undefined;
        const timestamp = Number(record.createdAt ?? record.completedAt ?? record.startedAt ?? record.at ?? 0);
        const pair: HistoricalRecord[] = [{ kind: target.kind, id, record, conversationId, invocationId, timestamp },
          { kind: "sqlite_record", id: rawId(target.table, id), record: raw, conversationId, invocationId, timestamp }];
        const size = Buffer.byteLength(JSON.stringify(pair));
        if (bytes + size > 512 * 1024) {
          if (records.length || size > HISTORY_PARTITION_LIMITS.overflowPayloadBytes) {
            blocked.push({ kind: target.kind, id, reason: "publication page byte limit" }); continue;
          }
          oversizedBundle = true;
        }
        bytes += size; records.push(...pair); published[target.set].add(id);
        if (oversizedBundle) break;
      }
    }
    const expectedDigests = new Map<string, string>();
    for (const record of records) {
      const current = history.locate(record.kind, record.id);
      if (current) expectedDigests.set(historicalRecordKey(record.kind, record.id), current.digest);
    }
    return { publication: records.length ? history.publishPage(records, { expectedDigests, allowOversizedRecordBundle: oversizedBundle }) : null, published, blocked };
  }

  private foreignKeys(): Map<string, ForeignKey[]> {
    if (this.incoming) return this.incoming;
    const incoming = new Map<string, ForeignKey[]>();
    for (const { name } of this.db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
      for (const fk of this.db.query<{ table: string; from: string; to: string }>(`PRAGMA foreign_key_list(${quote(name)})`).all()) {
        const list = incoming.get(fk.table) ?? []; list.push({ table: name, from: fk.from, to: fk.to }); incoming.set(fk.table, list);
      }
    }
    this.incoming = incoming; return incoming;
  }

  /** After the canonical rotation marker. Any changed row/reference stays hot. */
  remove(publication: HistoricalPublication | readonly HistoricalPublication[], allowed: HistoryRotationPlan, history: ControlPlaneHistoryStore): HistoricalRelocationResult {
    const removed = emptyHistoryRotationPlan();
    const blocked: HistoricalRelocationBlocker[] = [];
    // A marker can contain several bounded publication pages. Validate their
    // entire union before deleting any shared relational child: removing one
    // flight may otherwise change a later page's invocation activity rows.
    const publications = Array.isArray(publication) ? publication : [publication as HistoricalPublication];
    const locations = new Map(publications.flatMap(page => page.records).map(record => [historicalRecordKey(record.kind, record.id), record]));
    const candidates = new Map<string, { target: Target; id: string; raw: RawRecord }>();
    this.db.exec("SAVEPOINT scout_history_relocation");
    try {
      for (const target of targets) for (const id of allowed[target.set]) {
        const recordLocation = locations.get(historicalRecordKey(target.kind, id));
        const rawLocation = locations.get(historicalRecordKey("sqlite_record", rawId(target.table, id)));
        if (!recordLocation || !rawLocation) continue;
        // Reading both payloads proves the catalog receipt still identifies durable bytes.
        history.readLocation(recordLocation);
        const expected = history.readLocation<RawRecord>(rawLocation);
        const current = this.capture(target.table, id);
        if (!current) continue;
        if (historicalRecordDigest(current) !== historicalRecordDigest(expected)) {
          blocked.push({ kind: target.kind, id, reason: "record or related rows changed after publication" }); continue;
        }
        candidates.set(rawId(target.table, id), { target, id, raw: current });
      }
      // Dependency closure may shrink: preserving one changed/live child also
      // preserves all selected parents it still references.
      let changed = true;
      while (changed) {
        changed = false;
        for (const [key, candidate] of candidates) {
          const { target, id } = candidate;
          if (target.kind === "message" || target.kind === "invocation") continue; // FK identity anchors remain.
          let reason: string | undefined;
          for (const fk of this.foreignKeys().get(target.table) ?? []) {
            if (ownedChildren[target.table]?.[fk.table] === fk.from) continue;
            if (fk.to && fk.to !== "id") { reason = `unsupported foreign key ${fk.table}.${fk.from}`; break; }
            const child = targets.find(target => target.table === fk.table);
            if (!child) {
              if (this.db.query(`SELECT 1 FROM ${quote(fk.table)} WHERE ${quote(fk.from)}=?1 LIMIT 1`).get(id)) { reason = `retained reference ${fk.table}.${fk.from}`; break; }
            } else {
              // A bounded selected parent may have arbitrarily many children;
              // query only one child outside this bounded removable set.
              const childIds = [...candidates.values()].filter(value => value.target.table === fk.table).map(value => value.id);
              const outside = childIds.length ? ` AND id NOT IN (${childIds.map(() => "?").join(",")})` : "";
              if (this.db.query(`SELECT 1 FROM ${quote(fk.table)} WHERE ${quote(fk.from)}=?${outside} LIMIT 1`).get(id, ...childIds)) { reason = `retained reference ${fk.table}.${fk.from}`; break; }
            }
          }
          if (reason) { candidates.delete(key); changed = true; blocked.push({ kind: target.kind, id, reason }); }
        }
      }
      for (const target of targets) for (const candidate of candidates.values()) {
        if (candidate.target !== target) continue;
        const anchor = target.kind === "message" || target.kind === "invocation";
        if (anchor) {
          const location = locations.get(historicalRecordKey(target.kind, candidate.id))!;
          this.db.query("INSERT OR REPLACE INTO broker_history_anchors(kind,id,location_json) VALUES (?1,?2,?3)")
            .run(target.kind, candidate.id, JSON.stringify(location));
          if (target.kind === "message") {
            this.db.query("UPDATE messages SET body='',speech_json=NULL,audience_json=NULL,metadata_json=NULL WHERE id=?1").run(candidate.id);
            this.db.query("DELETE FROM message_mentions WHERE message_id=?1").run(candidate.id);
            this.db.query("DELETE FROM message_attachments WHERE message_id=?1").run(candidate.id);
          } else {
            this.db.query("UPDATE invocations SET task='',context_json=NULL,execution_json=NULL,execution_resolution_json=NULL,labels_json=NULL,metadata_json=NULL,summary=NULL,output=NULL,error=NULL,flight_metadata_json=NULL WHERE id=?1").run(candidate.id);
          }
          // Reactions and aggregate facts remain small, mutable relational data.
          this.db.query(`DELETE FROM activity_items WHERE ${target.kind === "message" ? "message_id" : "invocation_id"}=?1`).run(candidate.id);
        } else this.db.query(`DELETE FROM ${quote(target.table)} WHERE id=?1`).run(candidate.id);
        removed[target.set].add(candidate.id);
      }
      this.db.exec("RELEASE scout_history_relocation");
    } catch (error) { this.db.exec("ROLLBACK TO scout_history_relocation"); this.db.exec("RELEASE scout_history_relocation"); throw error; }
    return { removed, blocked };
  }
}
