/**
 * World · live tail: one machine's transcripts read a few new bytes at a time. Each pass walks ~/.claude/projects and
 * ~/.codex/sessions, and for every transcript touched inside the window reads only what was appended since the last
 * pass — per-file byte offsets, a partial last line left for next time, a truncated or replaced file read again from
 * the top — through the same parser as the week (createTranscriptParser, which carries a Codex session's cwd and token
 * totals across passes). The broker's new and changed asks come from its sqlite, by rowid. Out comes OTLP (world-otlp).
 *
 * Portable on purpose (node built-ins, bun:sqlite loaded lazily): world-live.ts bundles this file and pipes it into a
 * bare `bun run -` on the other machines over ssh, with the last pass's state prefixed as globalThis.__WT. Nothing raw
 * leaves the machine: targets and turns are redacted then clipped by the parser, and only the redacted target travels.
 */
import { open, readdir, stat } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { basename, join, relative } from "node:path";
import { setImmediate as yieldLoop } from "node:timers/promises";
import { createTranscriptParser, norm, redact, type Inbound, type Raw, type TranscriptCarry, type Usage } from "./world-transcript.ts";
import { readDeliveriesSince, type BrokerDelivery } from "./world-broker-rows.ts";
import { emptyBatch, toOtlp, type HostBatch, type LiveActor, type LiveAsk, type LiveSession, type OtlpExport } from "./world-otlp.ts";

export type TailFile = { off: number; ino: number; carry: TranscriptCarry | null; skip?: 1 };
export type TailState = { v: 1; files: Record<string, TailFile>; brokerRow?: number; brokerOpen?: string[]; dlvRow?: number; dlvOpen?: string[] };
export const emptyTailState = (): TailState => ({ v: 1, files: {} });
/** bytes read from one file in one pass; a first pass over a long transcript finishes over the next passes */
export const CHUNK = 48 * 1024 * 1024;

/** Session id and subagent link, exactly as world-hosts.ts names them, so a live row and a snapshot row agree. */
export function sessionOf(harness: string, rel: string, file: string): LiveSession {
  if (harness === "claude") {
    const parts = rel.split("/"), sub = parts.includes("subagents");
    const sid = sub ? basename(file, ".jsonl").replace(/^agent-/, "").slice(-8) : basename(file, ".jsonl").slice(0, 8);
    return sub ? { sid, h: harness, sub: 1, parent: parts[1]?.slice(0, 8) } : { sid, h: harness };
  }
  return { sid: basename(file, ".jsonl").slice(-8), h: harness };
}

async function* walk(d: string): AsyncGenerator<string> {
  let entries; try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(d, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && e.name.endsWith(".jsonl")) yield p;
  }
}

/**
 * Read the complete lines appended to one file since `prev`. Pure about the file (no state kept here): returns the
 * lines and the next offset. A last line with no newline yet is not read; a file now shorter than the offset, or a
 * different inode at the same path, starts over from byte 0.
 */
export async function readAppended(file: string, prev: TailFile | undefined, chunk = CHUNK): Promise<{ lines: string[]; next: TailFile; reset: boolean; bytes: number } | null> {
  let st; try { st = await stat(file); } catch { return null; }
  const reset = !!prev && (st.ino !== prev.ino || st.size < prev.off);
  const base: TailFile = !prev || reset ? { off: 0, ino: st.ino, carry: null } : { ...prev };
  if (st.size === base.off) return { lines: [], next: base, reset, bytes: 0 };
  const len = Math.min(chunk, st.size - base.off), buf = Buffer.allocUnsafe(len);
  const fh = await open(file, "r");
  let got = 0;
  try { while (got < len) { const { bytesRead } = await fh.read(buf, got, len - got, base.off + got); if (!bytesRead) break; got += bytesRead; } } finally { await fh.close(); }
  const view = buf.subarray(0, got), nl = view.lastIndexOf(0x0a);
  if (nl < 0) {
    // no newline in a full chunk: one enormous line (a giant tool result). Skip past it rather than stall on it
    if (got >= chunk) return { lines: [], next: { ...base, off: base.off + got, skip: 1 }, reset, bytes: got };
    return { lines: [], next: base, reset, bytes: 0 };
  }
  const lines = view.subarray(0, nl).toString("utf8").split("\n");
  // the tail end of a line skipped in an earlier pass is not a line
  if (base.skip) lines.shift();
  const next: TailFile = { off: base.off + nl + 1, ino: base.ino, carry: base.carry };
  return { lines, next, reset, bytes: nl + 1 };
}

/* ---------- broker: asks created or changed since the last pass ---------- */
async function readBrokerSince(home: string, from: number, state: TailState): Promise<{ asks: LiveAsk[]; actors: LiveActor[]; deliveries: BrokerDelivery[] }> {
  const file = join(home, ".openscout/control-plane/control-plane.sqlite");
  try { await stat(file); } catch { return { asks: [], actors: [], deliveries: [] }; }
  let db: any;
  try {
    const { Database } = await import("bun:sqlite");
    db = new Database(file, { readonly: true });
    const nodes = new Map<string, string>();
    try { for (const r of db.query("select id, name from nodes").all() as any[]) nodes.set(r.id, r.name); } catch {}
    const cols = "rowid as rid, id, created_at, completed_at, state, requester_id, target_agent_id, target_node_id, task, error";
    const fresh = db.query(`select ${cols} from invocations where rowid > ? and created_at > ? order by rowid limit 2000`).all(state.brokerRow ?? 0, from) as any[];
    const open = (state.brokerOpen || []).length ? db.query(`select ${cols} from invocations where id in (${state.brokerOpen!.map(() => "?").join(",")})`).all(...state.brokerOpen!) as any[] : [];
    const seen = new Set<string>(), rows: any[] = [];
    for (const r of [...open, ...fresh]) { if (!seen.has(r.id)) { seen.add(r.id); rows.push(r); } }
    for (const r of fresh) state.brokerRow = Math.max(state.brokerRow ?? 0, r.rid);
    const wasOpen = new Set(state.brokerOpen || []);
    // an open ask is re-sent only once it finished; a new one always
    const changed = rows.filter(r => !wasOpen.has(r.id) || r.completed_at != null);
    state.brokerOpen = rows.filter(r => r.completed_at == null).map(r => r.id).slice(-400);
    const asks = changed.map((r): LiveAsk => ({ id: r.id, created_at: r.created_at, completed_at: r.completed_at ?? null, state: r.state ?? null, requester_id: r.requester_id, target_agent_id: r.target_agent_id,
      target_node: r.target_node_id ? nodes.get(r.target_node_id) || r.target_node_id : null, task: redact(String(r.task || "").replace(/\s+/g, " ")).slice(0, 1600), error: r.error ? redact(String(r.error).replace(/\s+/g, " ")).slice(0, 200) : null }));
    // messages the broker could not deliver (failed, or still pending): new ones, and open ones once they finish
    const dl = readDeliveriesSince(db, from, state.dlvRow ?? 0, state.dlvOpen || []);
    state.dlvRow = dl.maxRow; state.dlvOpen = dl.open;
    const qa = db.query("select kind, display_name, metadata_json from actors where id = ?");
    const qg = db.query("select node_qualifier, metadata_json from agents where id = ?");
    const actors: LiveActor[] = [];
    for (const id of new Set([...asks.flatMap(a => [a.requester_id, a.target_agent_id]), ...dl.rows.map(d => d.from).filter(Boolean)])) {
      const a = qa.get(id) as any, g = qg.get(id) as any;
      let md: Record<string, any> = {}; try { md = JSON.parse(g?.metadata_json || a?.metadata_json || "{}") || {}; } catch {}
      actors.push({ id, kind: a?.kind || "?", name: a?.display_name || id, node: g?.node_qualifier || md.node || null,
        harness: md.harness || md.defaultHarness || md.runtime || null, root: md.projectRoot ? norm(String(md.projectRoot), home) : null });
    }
    return { asks, actors, deliveries: dl.rows };
  } catch { return { asks: [], actors: [], deliveries: [] }; } finally { try { db?.close(); } catch {} }
}

/* ---------- one pass ---------- */
export type TailPass = { batch: HostBatch; usage: Usage[]; state: TailState; bytes: number; files: number; resets: number; ms: number };
export async function tailOnce(opts: { home?: string; host?: string; from: number; state?: TailState | null; broker?: boolean; chunk?: number }): Promise<TailPass> {
  const t0 = Date.now(), home = opts.home ?? homedir(), host = opts.host ?? hostname().replace(/\.local$/, "");
  const prevState = opts.state?.v === 1 ? opts.state : emptyTailState();
  const state: TailState = { v: 1, files: {}, brokerRow: prevState.brokerRow, brokerOpen: prevState.brokerOpen, dlvRow: prevState.dlvRow, dlvOpen: prevState.dlvOpen };
  const batch = emptyBatch(host); batch.home = home;
  const usage: Usage[] = [], seenSid = new Set<string>();
  let bytes = 0, files = 0, resets = 0, yieldedAt = performance.now();
  for (const [harness, dir] of [["claude", join(home, ".claude/projects")], ["codex", join(home, ".codex/sessions")]] as const) {
    for await (const file of walk(dir)) {
      const rel = relative(dir, file), key = `${harness}:${rel}`, prev = prevState.files[key];
      // only transcripts touched inside the window are followed; the state forgets the rest
      if (!prev) { try { if ((await stat(file)).mtimeMs < opts.from) continue; } catch { continue; } }
      // a pass catches each file up, a chunk at a time: a long transcript never sits in memory whole
      const meta = sessionOf(harness, rel, file);
      let cur = prev, parser: ReturnType<typeof createTranscriptParser> | null = null, touched = false;
      for (let guard = 0; guard < 4096; guard++) {
        const got = await readAppended(file, cur, opts.chunk);
        if (!got) break;
        if (got.reset) { resets++; parser = null; }
        state.files[key] = cur = got.next;
        if (!got.bytes) break;
        bytes += got.bytes; touched = true;
        parser ??= createTranscriptParser({ harness, home, from: opts.from, sid: meta.sid, carry: got.next.carry });
        for (const line of got.lines) {
          if (performance.now() - yieldedAt >= 8) { await yieldLoop(); yieldedAt = performance.now(); }
          if (line) parser.line(line);
        }
        cur.carry = parser.carry();
      }
      if (!touched || !parser) continue;
      files++;
      const p = parser.take();
      if (!p.raw.length && !p.inbound.length && !p.usage.length && !p.errs.length) continue;
      if (!seenSid.has(meta.sid)) { seenSid.add(meta.sid); batch.sessions.push(meta); }
      // only the redacted target crosses: the parser's unredacted copy ([7]) stays here
      for (const r of p.raw) { if (r.length > 7) r.length = 7; batch.raw.push(r as Raw); }
      for (const t of p.inbound) batch.inbound.push([t[0], t[1], t[2].slice(0, 3000)] as Inbound);
      for (const u of p.usage) usage.push(u);
      for (const e of p.errs) batch.errs.push(e);
    }
  }
  if (opts.broker !== false) { const b = await readBrokerSince(home, opts.from, state); batch.asks = b.asks; batch.actors = b.actors; batch.deliveries = b.deliveries; }
  batch.raw.sort((a, b) => a[0] - b[0]); batch.inbound.sort((a, b) => a[0] - b[0]);
  return { batch, usage, state, bytes, files, resets, ms: Date.now() - t0 };
}

/** What the ssh run prints: OTLP plus the state to hand back next time. */
export type RemoteTailOut = { host: string; home: string; at: number; ms: number; bytes: number; files: number; resets: number; otlp: OtlpExport; usage: Usage[]; state: TailState };
if (process.env.WORLD_TAIL_RUN) {
  const g = globalThis as any, from = Number(process.env.WORLD_TAIL_FROM) || Date.now() - 864e5;
  const pass = await tailOnce({ from, state: g.__WT || null, host: process.env.WORLD_TAIL_NAME || undefined });
  pass.batch.persona = process.env.WORLD_TAIL_PERSONA || undefined;
  pass.batch.platform = process.platform === "linux" ? "linux" : "macos";
  const out: RemoteTailOut = { host: pass.batch.host, home: pass.batch.home!, at: Date.now(), ms: pass.ms, bytes: pass.bytes, files: pass.files, resets: pass.resets, otlp: toOtlp(pass.batch), usage: pass.usage, state: pass.state };
  process.stdout.write(JSON.stringify(out));
}
