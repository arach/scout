import { chmodSync, closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { openRuntimeSqliteDatabase, type ControlPlaneSqliteDatabase } from "../sqlite-adapter.js";
import { assertTestIsolatedUserData, resolveOpenScoutSupportPaths } from "../support-paths.js";
import { hash, words } from "./text.js";
import type { RouteChunkMapping, RouteEvidence, RouteTarget, RouteTerm } from "./types.js";
import type { RouteChunkKey } from "./chunks.js";

export const ROUTE_EXTRACTOR_VERSION = "routing-shortlist-v6";
export const ROUTE_SOURCE_TERM_LIMIT = 128;
export function routingPath(): string { return join(resolveOpenScoutSupportPaths().controlHome, "routing", "routing.sqlite"); }

const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS route_targets (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, node_id TEXT NOT NULL, project_root TEXT NOT NULL,
 project_key TEXT, agent_id TEXT, harness TEXT, session_id TEXT, names_json TEXT NOT NULL,
 source_hash TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS route_targets_root ON route_targets(node_id,project_root);
CREATE TABLE IF NOT EXISTS route_sources (key TEXT PRIMARY KEY, target_id TEXT NOT NULL REFERENCES route_targets(id) ON DELETE CASCADE, hash TEXT NOT NULL, terms_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS route_sources_target ON route_sources(target_id);
CREATE TABLE IF NOT EXISTS route_terms (
 target_id TEXT NOT NULL REFERENCES route_targets(id) ON DELETE CASCADE,
 term TEXT NOT NULL, field TEXT NOT NULL, weight REAL NOT NULL, last_used_at INTEGER NOT NULL,
 selected INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(target_id,term,field)
);
CREATE INDEX IF NOT EXISTS route_terms_selected ON route_terms(target_id,term,field,weight,last_used_at) WHERE selected=1;
CREATE TABLE IF NOT EXISTS route_df (term TEXT PRIMARY KEY, documents INTEGER NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS route_docs USING fts5(names,stable,recent,summary, target_id UNINDEXED);
CREATE TABLE IF NOT EXISTS route_cursors (source TEXT PRIMARY KEY, value_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS route_meta (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS route_chunk_collections (collection_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT, agent_id TEXT);
CREATE TABLE IF NOT EXISTS route_chunk_keys (id TEXT PRIMARY KEY,collection_id TEXT NOT NULL,text_hash TEXT NOT NULL,signature TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS route_chunk_keys_collection ON route_chunk_keys(collection_id);
CREATE TABLE IF NOT EXISTS route_feedback (
 id INTEGER PRIMARY KEY, query TEXT NOT NULL, chosen_target TEXT, outcome TEXT NOT NULL CHECK(outcome IN ('used','corrected','rejected')),
 corrected_to TEXT, ts INTEGER NOT NULL,
 CHECK((outcome='corrected' AND corrected_to IS NOT NULL) OR (outcome!='corrected' AND corrected_to IS NULL))
);
CREATE TABLE IF NOT EXISTS route_runs (id INTEGER PRIMARY KEY, mode TEXT NOT NULL, counts_json TEXT NOT NULL, model_calls INTEGER NOT NULL DEFAULT 0, started_at INTEGER NOT NULL, duration_ms INTEGER NOT NULL);
`;

type TargetRow = { id: string; kind: RouteTarget["kind"]; node_id: string; project_root: string; project_key: string | null; agent_id: string | null; harness: string | null; session_id: string | null; names_json: string };

function encodeTerms(terms: RouteTerm[]): string { return JSON.stringify(terms.map((t) => [t.term, t.field === "stable" ? 0 : 1, t.weight, t.lastUsedAt])); }
function decodeTerms(json: string): RouteTerm[] {
  return (JSON.parse(json) as [string, number, number, number][]).map(([term, field, weight, lastUsedAt]) => ({ term, field: field ? "recent" : "stable", weight, lastUsedAt }));
}

export class RoutingStore {
  readonly db: ControlPlaneSqliteDatabase;
  readonly path: string;
  private changed = new Set<string>();

  constructor(path?: string) {
    if (!path) assertTestIsolatedUserData("write routing index", "OPENSCOUT_CONTROL_HOME");
    this.path = path ?? routingPath();
    if (this.path !== ":memory:") {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      // SQLite inherits the DB mode for WAL/SHM: set it before opening WAL.
      closeSync(openSync(this.path, "a", 0o600));
      chmodSync(this.path, 0o600);
    }
    this.db = openRuntimeSqliteDatabase(this.path, { create: true });
    this.db.exec(SCHEMA);
    if (this.path !== ":memory:") chmodSync(this.path, 0o600);
  }

  close(): void { this.db.close?.(); }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const value = fn(); this.db.exec("COMMIT"); return value; }
    catch (error) {
      // SQLITE_FULL/IOERR may already have rolled back. Preserve the original error.
      try { this.db.exec("ROLLBACK"); } catch { /* transaction already aborted */ }
      this.changed.clear(); throw error;
    }
  }

  meta<T>(key: string, fallback: T): T {
    const row = this.db.query<{ value_json: string }>("SELECT value_json FROM route_meta WHERE key=?").get(key);
    return row ? JSON.parse(row.value_json) as T : fallback;
  }
  setMeta(key: string, value: unknown): void {
    this.db.query("INSERT OR REPLACE INTO route_meta VALUES (?,?)").run(key, JSON.stringify(value));
  }
  cursor<T>(source: string, fallback: T): T {
    const row = this.db.query<{ value_json: string }>("SELECT value_json FROM route_cursors WHERE source=?").get(source);
    return row ? JSON.parse(row.value_json) as T : fallback;
  }
  setCursor(source: string, value: unknown): void {
    this.db.query("INSERT OR REPLACE INTO route_cursors VALUES (?,?)").run(source, JSON.stringify(value));
  }
  reset(): void {
    // Feedback is human evidence, not a disposable derived index.
    this.db.exec("DELETE FROM route_targets; DELETE FROM route_docs; DELETE FROM route_df; DELETE FROM route_cursors; DELETE FROM route_meta; DELETE FROM route_chunk_collections; DELETE FROM route_chunk_keys;");
    this.changed.clear();
  }
  targets(): RouteTarget[] {
    return this.db.query<TargetRow>("SELECT * FROM route_targets ORDER BY id").all().map((r) => ({
      id: r.id, kind: r.kind, nodeId: r.node_id, projectRoot: r.project_root, projectKey: r.project_key,
      agentId: r.agent_id, harness: r.harness, sessionId: r.session_id, names: JSON.parse(r.names_json),
    }));
  }
  putTarget(target: RouteTarget, now: number): void {
    const names = JSON.stringify([...new Set(target.names.filter(Boolean))].sort());
    const before = this.db.query<TargetRow>("SELECT * FROM route_targets WHERE id=?").get(target.id);
    if (before?.names_json === names && before.project_root === target.projectRoot && before.agent_id === target.agentId
      && before.harness === target.harness && before.session_id === target.sessionId) return;
    this.db.query(`INSERT INTO route_targets VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      names_json=excluded.names_json, project_root=excluded.project_root, harness=excluded.harness,
      agent_id=excluded.agent_id, session_id=excluded.session_id, updated_at=excluded.updated_at`)
      .run(target.id, target.kind, target.nodeId, target.projectRoot, target.projectKey, target.agentId, target.harness, target.sessionId, names, "", now);
    this.changed.add(target.id);
  }
  putEvidence(evidence: RouteEvidence): boolean {
    const key = `${evidence.key}\0${evidence.targetId}`;
    const old = this.db.query<{ hash: string; terms_json: string }>("SELECT hash,terms_json FROM route_sources WHERE key=?").get(key);
    if (old?.hash === evidence.hash) return false;
    const aggregate = new Map<string, RouteTerm>();
    for (const term of evidence.terms) {
      const k = `${term.field}\0${term.term}`;
      const previous = aggregate.get(k);
      aggregate.set(k, { ...term, weight: term.weight + (previous?.weight ?? 0), lastUsedAt: Math.max(term.lastUsedAt, previous?.lastUsedAt ?? 0) });
    }
    // Bounded cached counts, not a second transcript-sized term index. Rare terms
    // omitted here remain discoverable by the independent S2 retrieval.
    const terms = (["stable", "recent"] as const).flatMap((field) => {
      const ranked = [...aggregate.values()].filter((t) => t.field === field)
        .sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term));
      const unigrams = ranked.filter((t) => !t.term.includes(" "));
      const phrases = ranked.filter((t) => t.term.includes(" ")).slice(0, 32);
      return [...unigrams.slice(0, ROUTE_SOURCE_TERM_LIMIT - phrases.length), ...phrases]
        .map((t) => ({ ...t, weight: Math.min(8, t.weight) }));
    });
    if (old) this.adjustCounts(evidence.targetId, decodeTerms(old.terms_json), -1);
    this.adjustCounts(evidence.targetId, terms, 1);
    this.db.query("INSERT OR REPLACE INTO route_sources VALUES (?,?,?,?)").run(key, evidence.targetId, evidence.hash, encodeTerms(terms));
    this.changed.add(evidence.targetId);
    return true;
  }
  removeSources(prefix: string, keep?: Set<string>): void {
    const rows = this.db.query<{ key: string; target_id: string; terms_json: string }>("SELECT key,target_id,terms_json FROM route_sources WHERE substr(key,1,?)=?").all(prefix.length, prefix);
    for (const row of rows) {
      if (keep?.has(row.key.split("\0")[0]!)) continue;
      this.adjustCounts(row.target_id, decodeTerms(row.terms_json), -1);
      this.db.query("DELETE FROM route_sources WHERE key=?").run(row.key);
      this.db.query("DELETE FROM route_cursors WHERE source=?").run(row.key.split("\0")[0]);
      this.changed.add(row.target_id);
    }
  }
  private adjustCounts(targetId: string, terms: RouteTerm[], sign: 1 | -1): void {
    for (const term of terms) {
      if (sign === 1) this.db.query(`INSERT INTO route_terms VALUES (?,?,?,?,?,0)
        ON CONFLICT(target_id,term,field) DO UPDATE SET weight=weight+excluded.weight,last_used_at=MAX(last_used_at,excluded.last_used_at)`)
        .run(targetId, term.term, term.field, term.weight, term.lastUsedAt);
      else this.db.query("UPDATE route_terms SET weight=weight-? WHERE target_id=? AND term=? AND field=?").run(term.weight, targetId, term.term, term.field);
    }
    if (sign === -1) this.db.query("DELETE FROM route_terms WHERE target_id=? AND weight<=0").run(targetId);
  }
  mappings(): RouteChunkMapping[] {
    return this.db.query<{ collection_id: string; project_id: string; session_id: string | null; agent_id: string | null }>("SELECT * FROM route_chunk_collections").all()
      .map((r) => ({ collectionId: r.collection_id, projectId: r.project_id, sessionId: r.session_id, agentId: r.agent_id }));
  }
  chunkKeys(): RouteChunkKey[] { return this.db.query<RouteChunkKey>("SELECT * FROM route_chunk_keys").all(); }
  putChunkKeys(collectionId: string, keys: RouteChunkKey[]): void {
    this.db.query("DELETE FROM route_chunk_keys WHERE collection_id=?").run(collectionId);
    const insert = this.db.query("INSERT OR REPLACE INTO route_chunk_keys VALUES (?,?,?,?)");
    for (const key of keys) insert.run(key.id, key.collection_id, key.text_hash, key.signature);
  }
  putMapping(mapping: RouteChunkMapping): void {
    this.db.query("INSERT OR REPLACE INTO route_chunk_collections VALUES (?,?,?,?)")
      .run(mapping.collectionId, mapping.projectId, mapping.sessionId, mapping.agentId);
  }
  terms(id: string, selected = true): RouteTerm[] {
    return this.db.query<{ term: string; field: RouteTerm["field"]; weight: number; last_used_at: number }>(
      `SELECT term,field,weight,last_used_at FROM route_terms WHERE target_id=? ${selected ? "AND selected=1" : ""}`,
    ).all(id).map((r) => ({ term: r.term, field: r.field, weight: r.weight, lastUsedAt: r.last_used_at }));
  }

  /** Only changed source counts are recounted; DF and the small documents use cached counts. */
  finish(now: number): number {
    if (!this.changed.size) return 0;
    const changed = this.changed.size;
    // Counts above are deltas. Recompute only last-used maxima from the small
    // cached source contributions, so deleting the newest source also ages a term.
    for (const id of this.changed) {
      const times = new Map<string, number>();
      for (const row of this.db.query<{ terms_json: string }>("SELECT terms_json FROM route_sources WHERE target_id=?").all(id)) {
        for (const term of decodeTerms(row.terms_json)) {
          const key = `${term.field}\0${term.term}`;
          times.set(key, Math.max(times.get(key) ?? 0, term.lastUsedAt));
        }
      }
      for (const [key, time] of times) {
        const [field, term] = key.split("\0");
        this.db.query("UPDATE route_terms SET last_used_at=? WHERE target_id=? AND field=? AND term=?").run(time, id, field, term);
      }
    }
    this.db.exec(`DELETE FROM route_df;
      INSERT INTO route_df SELECT term,COUNT(DISTINCT target_id) FROM route_terms
      WHERE target_id IN (SELECT id FROM route_targets WHERE kind='project') GROUP BY term;`);
    const dfs = new Map(this.db.query<{ term: string; documents: number }>("SELECT * FROM route_df").all().map((r) => [r.term, r.documents]));
    const targets = this.targets();
    const projectCount = targets.filter((t) => t.kind === "project").length;
    for (const target of targets) {
      const terms = this.terms(target.id, false);
      const tfidf = (term: RouteTerm) => (1 + Math.log(term.weight)) * (1 + Math.log((1 + projectCount) / (1 + (dfs.get(term.term) ?? 0))));
      const selected = (["stable", "recent"] as const).flatMap((field) => {
        const ranked = terms.filter((t) => t.field === field)
          .sort((a, b) => tfidf(b) - tfidf(a) || a.term.localeCompare(b.term));
        // A 50-term document collapsed a large monorepo to path bigrams. Keep
        // 192 unigrams + 32 phrases, including 64 newest recent terms. Selection
        // depends only on source times; wall-clock decay still happens at query.
        const unigrams = ranked.filter((t) => !t.term.includes(" "));
        const newest = field === "recent" ? [...unigrams].sort((a, b) => b.lastUsedAt - a.lastUsedAt || tfidf(b) - tfidf(a) || a.term.localeCompare(b.term)).slice(0, 64) : [];
        return [...new Set([...newest, ...unigrams])].slice(0, 192)
          .concat(ranked.filter((t) => t.term.includes(" ")).slice(0, 32));
      });
      const doc = {
        names: [...target.names, ...words(target.names.join(" "))].join(" "), stable: selected.filter((t) => t.field === "stable").map((t) => t.term).join(" "),
        recent: selected.filter((t) => t.field === "recent").map((t) => t.term).join(" "),
      };
      const sources = this.db.query<{ key: string; hash: string }>("SELECT key,hash FROM route_sources WHERE target_id=? ORDER BY key").all(target.id);
      const sourceHash = hash([target, sources, doc]);
      const old = this.db.query<{ source_hash: string }>("SELECT source_hash FROM route_targets WHERE id=?").get(target.id);
      this.db.query("UPDATE route_terms SET selected=0 WHERE target_id=?").run(target.id);
      for (const term of selected) this.db.query("UPDATE route_terms SET selected=1 WHERE target_id=? AND term=? AND field=?").run(target.id, term.term, term.field);
      if (old?.source_hash === sourceHash) continue;
      this.db.query("DELETE FROM route_docs WHERE rowid=(SELECT rowid FROM route_targets WHERE id=?)").run(target.id);
      this.db.query(`INSERT INTO route_docs(rowid,names,stable,recent,summary,target_id)
        VALUES ((SELECT rowid FROM route_targets WHERE id=?),?,?,?,'',?)`).run(target.id, doc.names, doc.stable, doc.recent, target.id);
      this.db.query("UPDATE route_targets SET source_hash=?,updated_at=? WHERE id=?").run(sourceHash, now, target.id);
    }
    this.changed.clear();
    return changed;
  }
  feedback(input: { query: string; chosenTarget?: string; outcome: "used" | "corrected" | "rejected"; correctedTo?: string }, now = Date.now()): void {
    if (!input.query.trim() || !["used", "corrected", "rejected"].includes(input.outcome)) throw new Error("Invalid route feedback");
    if ((input.outcome === "corrected") !== Boolean(input.correctedTo)) throw new Error("corrected feedback requires correctedTo; other outcomes must omit it");
    if (input.outcome !== "rejected" && !input.chosenTarget) throw new Error("Feedback requires chosenTarget");
    for (const id of [input.chosenTarget, input.correctedTo].filter(Boolean)) {
      if (!this.db.query("SELECT 1 FROM route_targets WHERE id=?").get(id)) throw new Error(`Unknown routing target: ${id}`);
    }
    this.db.query("INSERT INTO route_feedback(query,chosen_target,outcome,corrected_to,ts) VALUES (?,?,?,?,?)")
      .run(input.query, input.chosenTarget ?? null, input.outcome, input.correctedTo ?? null, now);
  }
}
