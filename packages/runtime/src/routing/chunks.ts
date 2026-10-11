import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { openRuntimeSqliteDatabase, type ControlPlaneSqliteDatabase } from "../sqlite-adapter.js";
import { resolveOpenScoutKnowledgePaths } from "../knowledge/paths.js";
import { ftsRowidForChunk } from "../knowledge/chunk-fts-rowid.js";
import { decay, words } from "./text.js";
import type { RouteChunkMapping } from "./types.js";

export type RouteCollection = { id: string; title: string; content_hash: string; facets_json: string; source_refs_json: string; updated_at: number };
export type RouteChunk = { text: string; facets_json: string; source_refs_json: string };
export type RouteChunkKey = { id: string; collection_id: string; text_hash: string; signature: string };

/** Reads only the already-built index. Never discovers or opens a harness transcript. */
export class RoutingChunks {
  private db: ControlPlaneSqliteDatabase | null;
  private keysReady = false;
  private cachedKeys?: RouteChunkKey[];
  constructor(readonly path = resolveOpenScoutKnowledgePaths().sqlitePath) {
    this.db = existsSync(path) ? openRuntimeSqliteDatabase(path, { readonly: true }) : null;
  }
  close(): void { this.db?.close?.(); }
  collections(): RouteCollection[] {
    return this.db?.query<RouteCollection>("SELECT id,title,content_hash,facets_json,source_refs_json,updated_at FROM collections WHERE kind='sessions' ORDER BY id").all() ?? [];
  }
  chunks(collectionId: string): RouteChunk[] {
    // ordinal restarts for each document, so it is NOT session chronology.
    // Sample overview/files plus early/recent event records. Old indexes and
    // synthetic fixtures without documentKind use recordRange/ordinal fallback.
    return this.db?.query<RouteChunk>(`
      WITH sample AS MATERIALIZED (
        SELECT id,facets_json,source_refs_json,ordinal,
          coalesce(json_extract(facets_json,'$.documentKind'),'events') AS kind,
          coalesce(json_extract(source_refs_json,'$[0].recordRange[0]'),ordinal) AS event_order
        FROM chunks WHERE collection_id=?
      ), selected AS (
        SELECT id FROM (SELECT id FROM sample WHERE kind='overview' ORDER BY ordinal,id LIMIT 3)
        UNION SELECT id FROM (SELECT id FROM sample WHERE kind='files' ORDER BY ordinal,id LIMIT 1)
        UNION SELECT id FROM (SELECT id FROM sample WHERE kind='events' ORDER BY event_order,id LIMIT 4)
        UNION SELECT id FROM (SELECT id FROM sample WHERE kind='events' ORDER BY event_order DESC,id DESC LIMIT 24)
      ) SELECT substr(text,1,8192) AS text,facets_json,source_refs_json FROM chunks WHERE id IN (SELECT id FROM selected)
    `).all(collectionId) ?? [];
  }

  available(): boolean { return this.db !== null; }
  keys(collectionId?: string): RouteChunkKey[] {
    if (!this.db) return [];
    type Row = Omit<RouteChunkKey, "signature"> & { prefix: string };
    const sql = "SELECT id,collection_id,text_hash,substr(text,1,600) AS prefix FROM chunks";
    const rows = collectionId === undefined ? this.db.query<Row>(sql).all() : this.db.query<Row>(`${sql} WHERE collection_id=?`).all(collectionId);
    return rows.map(({ prefix, ...row }) => ({ ...row,
      signature: createHash("sha256").update(prefix.toLowerCase().replace(/\s+/g, " ").slice(0, 400)).digest("hex"),
    }));
  }
  useCachedKeys(keys: RouteChunkKey[]): void { this.cachedKeys = keys; }
  hasCachedKeys(): boolean { return this.cachedKeys !== undefined; }

  private prepareKeys(): void {
    if (!this.db || this.keysReady) return;
    // FTS stores full bodies alongside its UNINDEXED ids. Selecting chunk_id
    // for every hit forces overflow-page reads from those bodies (82s on the
    // real 2GB index). Join on the knowledge store's deterministic FTS rowid
    // instead; cache *metadata only* in this read-only connection's TEMP schema.
    this.db.exec("CREATE TEMP TABLE route_chunk_keys (fts_id INTEGER PRIMARY KEY,chunk_id TEXT,collection_id TEXT,signature TEXT);");
    const insert = this.db.query("INSERT INTO route_chunk_keys VALUES (?,?,?,?)");
    const rows = this.cachedKeys ?? this.keys();
    this.db.exec("BEGIN");
    try {
      for (const row of rows) insert.run(ftsRowidForChunk(row.id), row.id, row.collection_id, row.signature);
      this.db.exec("COMMIT");
    } catch (error) { try { this.db.exec("ROLLBACK"); } catch {} throw error; }
    this.keysReady = true;
  }

  votes(query: string, mappings: RouteChunkMapping[], allowed: Set<string>, now: number, k = 8): Map<string, { score: number; terms: string[] }> {
    const votes = new Map<string, { score: number; terms: string[] }>();
    if (!this.db || !allowed.size) return votes;
    this.prepareKeys();
    // Knowledge FTS keeps path punctuation; include unsplit identifiers as well.
    const tokens = [...new Set([...words(query), ...(query.match(/[\p{L}\p{N}_./-]{2,}/gu) ?? []).filter((token) => /[A-Z_./-]/.test(token) && words(token).length)])].slice(0, 40);
    if (!tokens.length) return votes;
    const match = tokens.map((t) => `"${t.replaceAll('"', '""')}"`).join(" OR ");
    // TEMP tables on a read-only connection do not modify knowledge.sqlite.
    this.db.exec("CREATE TEMP TABLE IF NOT EXISTS route_map (collection_id TEXT, target_id TEXT, PRIMARY KEY(collection_id,target_id)); DELETE FROM route_map;");
    const insert = this.db.query("INSERT OR IGNORE INTO route_map VALUES (?,?)");
    for (const mapping of mappings) for (const id of [mapping.projectId, mapping.sessionId, mapping.agentId]) {
      if (id && allowed.has(id)) insert.run(mapping.collectionId, id);
    }
    // Materialize before window functions: FTS5 auxiliary bm25 cannot execute
    // in an aggregate/window context. Lower (negative) rank is better.
    const rows = this.db.query<{ target_id: string; rank: number; mtime: number | null; fts_id: string }>(`
      WITH hits AS MATERIALIZED (
        SELECT c.collection_id, c.chunk_id, CAST(c.fts_id AS TEXT) AS fts_id, bm25(chunks_fts) AS rank,
          CAST(json_extract(col.source_refs_json,'$[0].anchor.mtimeMs') AS REAL) AS mtime,
          coalesce(json_extract(col.facets_json,'$.sessionId'),c.collection_id) AS session_id,
          c.signature
        FROM chunks_fts JOIN route_chunk_keys c ON c.fts_id=chunks_fts.rowid
        JOIN collections col ON col.id=c.collection_id
        WHERE chunks_fts MATCH ? AND EXISTS (SELECT 1 FROM route_map m WHERE m.collection_id=c.collection_id)
      ), deduped AS (
        SELECT m.target_id,h.*,row_number() OVER (PARTITION BY m.target_id,h.signature ORDER BY h.rank ASC,h.session_id) AS duplicate
        FROM hits h JOIN route_map m ON m.collection_id=h.collection_id
      ), ranked AS (
        SELECT *,row_number() OVER (PARTITION BY target_id ORDER BY rank ASC,session_id) AS position
        FROM deduped WHERE duplicate=1
      ) SELECT target_id,rank,mtime,fts_id FROM ranked WHERE position<=?
    `).all(match, k);
    this.db.exec("CREATE TEMP TABLE IF NOT EXISTS route_selected (fts_id INTEGER PRIMARY KEY); DELETE FROM route_selected;");
    for (const row of rows) this.db.query("INSERT OR IGNORE INTO route_selected VALUES (?)").run(BigInt(row.fts_id));
    const matched = new Map<string, string[]>();
    for (const token of tokens) {
      // Match evidence through postings, without loading even the winning bodies.
      for (const hit of this.db.query<{ id: string }>(`SELECT CAST(chunks_fts.rowid AS TEXT) AS id
        FROM chunks_fts JOIN route_selected s ON s.fts_id=chunks_fts.rowid WHERE chunks_fts MATCH ?`)
        .all(`"${token.replaceAll('"', '""')}"`)) {
        matched.set(hit.id, [...(matched.get(hit.id) ?? []), token]);
      }
    }
    for (const row of rows) {
      const previous = votes.get(row.target_id);
      const score = Math.max(0, -row.rank) * (row.mtime ? 0.25 + 0.75 * decay(row.mtime, now) : 0.25);
      votes.set(row.target_id, {
        score: (previous?.score ?? 0) + score,
        terms: [...new Set([...(previous?.terms ?? []), ...(matched.get(row.fts_id) ?? [])])],
      });
    }
    return votes;
  }
}
