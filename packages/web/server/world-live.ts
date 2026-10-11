/**
 * World · live: the Week, following us as it happens. Two sources, one shape:
 *
 *   live  our machines. This one is tailed in-process (fs.watch on the transcript dirs, a 5 s poll behind it, and the
 *         broker's own event feed as a nudge for asks); the others are tailed over ssh every ~20 s by the same code
 *         (world-tail.ts, bundled and piped into `bun run -`), handing back byte offsets each time so a pass reads only
 *         what was appended. A host that doesn't answer backs off and reads as stale; it never holds up the rest.
 *   otlp  only what outside exporters POST to /api/ops/world-otlp/v1/{traces,logs}.
 *
 * Every row from either source arrives as OTLP and goes through fromOtlp() (world-otlp.ts): redact, then clip.
 * A subscriber gets a seed (buildTeamWeek over the last hours, the engine's existing payload, its axis running a little
 * past the wall clock) and then deltas indexed against that seed: new strings, sessions, calls, turns, asks, and
 * updates to asks already sent. Lanes never change after the seed — a new project lands in "other".
 */
import { watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fromOtlp, otlpShape, toOtlp, type OtlpShape, type AdaptResult, type HostBatch, type LiveActor, type LiveAsk, type LiveSession, type OtlpExport } from "./world-otlp.ts";
import { tailOnce, type RemoteTailOut, type TailState } from "./world-tail.ts";
import { buildTeamWeek, defaultPersona, laneLabel, OTHER_LANE, projectKey, readSnapshots, readTeamConfig, sessionLane, teamDir, type TeamHostConfig, type TeamHostSummary, type TeamPrs, type TeamSnapshot, type TeamWeekPayload } from "./world-team.ts";
import { HOST_SNAPSHOT_VERSION, teamRoot } from "./world-hosts.ts";
import { DAY, kind, NOISE, sq, squash, type Inbound, type Raw, type ToolErr, type Usage } from "./world-transcript.ts";
import { deliveryState, type BrokerDelivery } from "./world-broker-rows.ts";
import type { WorldAsk, WorldWork } from "./world-week.ts";

export type LiveSourceName = "live" | "otlp";
export const LIVE_HOURS = 24;
const HEADROOM = 2 * 36e5;            // the axis runs this far past the wall clock; the page re-seeds before it runs out
const REMOTE_EVERY = 20_000, REMOTE_MAX_BACKOFF = 300_000, LOCAL_EVERY = 5_000, STATUS_EVERY = 5_000;
const EPISODE_GAP = 30 * 60e3, LIVE_MS = 20 * 60e3, TGT_CAP = 72, TASK_CAP = 600;
const SEED_WAIT = 30_000;

/* ---------- per-host accumulators ---------- */
type HostAcc = {
  cfg: TeamHostConfig; home: string;
  sessions: Map<string, LiveSession>; raw: Raw[]; inbound: Inbound[]; usage: Usage[]; asks: Map<string, LiveAsk>; actors: Map<string, LiveActor>;
  errs: ToolErr[]; deliveries: Map<string, BrokerDelivery>;
  /** last pass that answered; ok: the last attempt answered */
  at: number | null; ok: boolean; tried: boolean; error?: string; fails: number; passMs: number; bytes: number; next: number;
  lastCall: number; lag: number[]; prevAt: number | null; lastPassStart: number | null; tail: TailState | null; running: boolean; dirty: boolean; disk: TeamSnapshot | null;
};
export type LiveHostStatus = { host: string; persona: string; self: boolean; at: number | null; stale: boolean; error?: string; passMs: number; bytes: number; lastCall: number | null; next: number | null; calls: number; lagMs: number | null };
const newAcc = (cfg: TeamHostConfig, disk: TeamSnapshot | null = null): HostAcc => ({ cfg, home: disk?.home || "", sessions: new Map(), raw: [], inbound: [], usage: [], asks: new Map(), actors: new Map(), errs: [], deliveries: new Map(),
  at: null, ok: false, tried: false, fails: 0, passMs: 0, bytes: 0, next: 0, lastCall: 0, lag: [], prevAt: null, lastPassStart: null, tail: null, running: false, dirty: false, disk });

type Delta = {
  strBase: number; strs: string[]; actorBase: number; actors: any[]; sessBase: number; sessions: TeamWeekPayload["sessions"]; sessionHost: number[];
  hostBase: number; teamHosts: TeamHostSummary[]; events: TeamWeekPayload["events"]; turns: [number, number, number][];
  askBase: number; asks: WorldAsk[]; work: Record<number, WorldWork>; askUpdates: [number, number | null, string][];
  /** failed tool calls (rows as the seed's errs); undelivered messages: new rows from dlvBase, and ones that finished */
  errs: NonNullable<TeamWeekPayload["errs"]>; dlvBase: number; dlv: NonNullable<TeamWeekPayload["dlv"]>; dlvUpdates: [number, number | null, string][];
};

/* ---------- a subscriber's view: the seed's indices, extended as rows arrive ---------- */
type FSess = { i: number; host: string; sid: string; h: string; sub: boolean; parent?: string; root: string; lane: string; last: number; turnAsk: number | null; subAsk: number | null };
export class LiveFrame {
  readonly from: number; readonly axisEnd: number;
  private lanes: Set<string>; private roots: Record<string, [string, string]>;
  private strs: number; private strIdx = new Map<string, number>();
  private sess = new Map<string, FSess>(); private nSess: number;
  private actorIdx = new Map<string, number>(); private actorKind: string[] = []; private nActors: number;
  private nAsks: number; private askIdx = new Map<string, number>(); private askOpen = new Set<number>();
  private nDlv: number; private dlvIdx = new Map<string, number>(); private dlvOpen = new Set<number>();
  private hostIdx = new Map<string, number>(); private config: TeamHostConfig[];
  private pending = new Map<string, [number, string][]>();
  private d: Delta | null = null;
  constructor(P: TeamWeekPayload, config: TeamHostConfig[], private homeOf: (host: string) => string, private rootsOf: (host: string) => Record<string, [string, string]>) {
    this.from = P.from; this.axisEnd = P.now; this.config = [...config];
    this.config.forEach((c, i) => this.hostIdx.set(c.host, i));
    this.lanes = new Set(P.team.lanes); this.roots = P.roots || {};
    P.strs.forEach((s, i) => this.strIdx.set(s, i)); this.strs = P.strs.length;
    P.actors.forEach((a, i) => { this.actorIdx.set(a.id, i); this.actorKind[i] = a.kind; }); this.nActors = P.actors.length;
    const last = new Map<number, number>();
    for (const e of P.events) last.set(e[3], Math.max(last.get(e[3]) || 0, P.from + e[0] * 1000));
    P.sessions.forEach(([sid, h, root, turns], i) => {
      const host = this.config[P.team.sessionHost[i]]?.host || "?";
      for (const [s] of turns || []) last.set(i, Math.max(last.get(i) || 0, P.from + s * 1000));
      this.sess.set(`${host}|${sid}`, { i, host, sid, h, sub: false, root, lane: this.roots[root]?.[0] ?? root, last: last.get(i) || 0, turnAsk: null, subAsk: null });
    });
    this.nSess = P.sessions.length;
    this.nAsks = P.asks.length;
    this.nDlv = (P.dlv || []).length;
    (P.dlvIds || []).forEach((id, i) => { this.dlvIdx.set(id, i); if (P.dlv?.[i]?.[2] === "o") this.dlvOpen.add(i); });
    (P.askIds || []).forEach((id, i) => {
      if (!id) return;
      const open = P.asks[i][1] == null && P.asks[i][2] === "o";
      if (open) this.askOpen.add(i);
      const m = id.match(/^(turn|sub):(.+)$/);
      if (!m) { this.askIdx.set(id, i); return; }
      const s = this.sess.get(m[2]); if (!s) return;
      if (m[1] === "sub") { s.sub = true; s.subAsk = i; } else if (open) s.turnAsk = i;
    });
  }
  private delta(): Delta {
    return this.d ??= { strBase: this.strs, strs: [], actorBase: this.nActors, actors: [], sessBase: this.nSess, sessions: [], sessionHost: [], hostBase: this.config.length, teamHosts: [], events: [], turns: [], askBase: this.nAsks, asks: [], work: {}, askUpdates: [], errs: [], dlvBase: this.nDlv, dlv: [], dlvUpdates: [] };
  }
  private S(v: string): number {
    v = v || ""; let i = this.strIdx.get(v);
    if (i == null) { i = this.strs++; this.strIdx.set(v, i); this.delta().strs.push(v); }
    return i;
  }
  private secs(t: number) { return Math.round((t - this.from) / 1000); }
  private host(host: string, persona?: string): number {
    let k = this.hostIdx.get(host);
    if (k == null) {
      const cfg: TeamHostConfig = { host, persona: persona || defaultPersona(host), ssh: host, platform: "macos" };
      k = this.config.length; this.config.push(cfg); this.hostIdx.set(host, k);
      this.delta().teamHosts.push({ host, persona: cfg.persona, platform: "macos", self: false, stale: false, at: Date.now(), events: 0, asks: 0, sessions: 0, worktrees: 0, prs: 0 });
    }
    return k;
  }
  private persona(host: string) { return this.config[this.hostIdx.get(host) ?? -1]?.persona || defaultPersona(host); }
  private actor(id: string, make: () => any): number {
    let i = this.actorIdx.get(id); if (i != null) return i;
    i = this.nActors++; this.actorIdx.set(id, i);
    const a = { i, id, ...make() }; this.actorKind[i] = a.kind; this.delta().actors.push(a); return i;
  }
  private personIdx(host: string) { const p = this.persona(host); return this.actor(`person.${host}`, () => ({ name: p, kind: "person", node: p, branch: null, cls: null, project: null, root: null, harness: null, host, persona: p })); }
  private agentIdx(host: string, h: string, lane: string, sub = false) {
    const p = this.persona(host);
    return this.actor(`${host}.${h}${sub ? ".sub" : ""}.${laneLabel(lane)}`, () => ({ name: `${p.toLowerCase()}/${laneLabel(lane)}${sub ? "·sub" : ""}`, kind: "agent", node: p, branch: null, cls: sub ? "subagent" : "worker", project: laneLabel(lane), root: lane, harness: h, host, persona: p }));
  }
  private brokerIdx(host: string, row: LiveActor | undefined, id: string) {
    if (row && /^(person|human|operator|user)$/i.test(row.kind)) return this.personIdx(host);
    const nodeHost = row?.node && this.config.find(c => c.host === row.node || row.node!.startsWith(c.host + "-") || row.node!.startsWith(c.host + "."))?.host || host;
    const p = this.persona(nodeHost);
    return this.actor(`${nodeHost}:${id}`, () => {
      const lane = row?.root ? (this.lanes.has(projectKey(row.root)) ? projectKey(row.root) : OTHER_LANE) : null;
      return { name: row?.name || id, kind: !row || row.kind === "?" ? "agent" : row.kind, node: p, branch: null, cls: null, project: lane ? laneLabel(lane) : null, root: lane, harness: row?.harness || null, host: nodeHost, persona: p };
    });
  }
  private openAsk(ask: WorldAsk, work: WorldWork): number {
    const i = this.nAsks++, d = this.delta();
    d.asks.push(ask); d.work[i] = work; this.askOpen.add(i); return i;
  }
  private close(i: number | null, at: number, st = "c") { if (i == null || !this.askOpen.has(i)) return; this.askOpen.delete(i); this.delta().askUpdates.push([i, at, st]); }
  private turn(s: FSess, ts: number, text: string) {
    const said = (text || "").trim();
    if (!said || NOISE.test(said)) return;
    const t280 = sq(said).slice(0, 280), d = this.delta();
    d.turns.push([s.i, this.secs(ts), this.S(t280)]);
    const work = (): WorldWork => ({ s: s.i, t0: ts, t1: this.axisEnd, n: 0, task: t280.slice(0, TASK_CAP), files: [], urls: [], cmds: [] });
    if (s.sub) {
      if (s.subAsk != null) return;
      const parent = s.parent ? this.sess.get(`${s.host}|${s.parent}`) : undefined;
      const rq = parent ? this.agentIdx(s.host, parent.h, parent.lane) : this.agentIdx(s.host, s.h, s.lane);
      s.subAsk = this.openAsk([ts, null, "o", rq, this.agentIdx(s.host, s.h, s.lane, true), squash(t280, 96), "", "s"], work());
    } else {
      // the operator coming back after a gap starts a new ask; inside an episode a turn is just a turn
      if (s.turnAsk != null && ts - s.last < EPISODE_GAP) { s.last = Math.max(s.last, ts); return; }
      this.close(s.turnAsk, Math.max(s.last, 0) || ts);
      s.turnAsk = this.openAsk([ts, null, "o", this.personIdx(s.host), this.agentIdx(s.host, s.h, s.lane), squash(t280, 96), "", "t"], work());
    }
    s.last = Math.max(s.last, ts);
  }
  /** New rows from one machine → the delta for this subscriber (null when nothing it would draw changed). */
  apply(b: HostBatch): Delta | null {
    this.delta();   // bases first: every index handed out below counts from them
    const k = this.host(b.host, b.persona);
    const home = b.home || this.homeOf(b.host), meta = new Map(b.sessions.map(s => [s.sid, s]));
    const bySid = new Map<string, Raw[]>();
    for (const r of b.raw) if (r[0] >= this.from) { const l = bySid.get(r[3]) || []; l.push(r); bySid.set(r[3], l); }
    const ensure = (sid: string, rows: Raw[]): FSess => {
      const key = `${b.host}|${sid}`; let s = this.sess.get(key);
      if (s) return s;
      const m = meta.get(sid), h = m?.h || rows[0]?.[2] || "claude";
      const roots = this.rootsOf(b.host), placed = sessionLane(rows, home, roots);
      const lane = this.lanes.has(placed.lane) ? placed.lane : OTHER_LANE;
      const wt = roots[placed.root] ? `${b.host}:${placed.root}` : null;
      const root = wt && this.roots[wt] ? wt : lane;
      s = { i: this.nSess++, host: b.host, sid, h, sub: !!m?.sub, parent: m?.parent, root, lane, last: 0, turnAsk: null, subAsk: null };
      this.sess.set(key, s);
      const d = this.delta(); d.sessions.push([sid, h, root, []]); d.sessionHost.push(k);
      return s;
    };
    // calls and turns in time order, so an episode's first turn opens its ask before the calls that answer it
    type Row = { t: number; r?: Raw; turn?: Inbound };
    const rows: Row[] = [...b.raw.filter(r => r[0] >= this.from).map(r => ({ t: r[0], r })), ...b.inbound.filter(x => x[0] >= this.from).map(turn => ({ t: turn[0], turn }))].sort((a, c) => a.t - c.t);
    for (const row of rows) {
      if (row.r) {
        const r = row.r, s = ensure(r[3], bySid.get(r[3]) || [r]);
        const [ts, , , , name, tgt, delta] = r, kd = kind(name);
        for (const p of this.pending.get(`${b.host}|${s.sid}`) || []) this.turn(s, p[0], p[1]);
        this.pending.delete(`${b.host}|${s.sid}`);
        let t = tgt.replace(/\s+/g, " "); if (home) t = t.replaceAll(home + "/", "~/");
        const rootPath = this.roots[s.root] ? s.root.slice(s.root.indexOf(":") + 1) : "";
        if (rootPath && t.startsWith(rootPath + "/")) t = t.slice(rootPath.length + 1);
        t = t.slice(0, TGT_CAP);
        const at = this.secs(ts), d = this.delta();
        d.events.push(kd === "e" && delta ? [at, this.S(s.root), kd, s.i, this.S(name), this.S(t), -1, delta[0], delta[1]] : [at, this.S(s.root), kd, s.i, this.S(name), this.S(t), -1]);
        s.last = Math.max(s.last, ts);
      } else if (row.turn) {
        const [ts, sid, text] = row.turn, s = this.sess.get(`${b.host}|${sid}`);
        // a session is drawn once it makes a call; what was said before that waits for it
        if (s) this.turn(s, ts, text);
        else { const key = `${b.host}|${sid}`, l = this.pending.get(key) || []; if (l.length < 20) l.push([ts, text]); this.pending.set(key, l); }
      }
    }
    // broker asks: new ones, and ones already drawn that have since finished
    const actors = new Map(b.actors.map(a => [a.id, a]));
    for (const a of [...b.asks].sort((x, y) => x.created_at - y.created_at)) {
      const st = a.state === "completed" ? "c" : a.state === "failed" ? "f" : "o";
      const known = this.askIdx.get(a.id);
      if (known != null) { if (a.completed_at != null || st !== "o") this.close(known, a.completed_at ?? a.created_at, st === "o" ? "c" : st); continue; }
      if (a.created_at < this.from) continue;
      const rq = this.brokerIdx(b.host, actors.get(a.requester_id), a.requester_id), tg = this.brokerIdx(b.host, actors.get(a.target_agent_id), a.target_agent_id);
      const i = this.nAsks++, d = this.delta();
      d.asks.push([a.created_at, a.completed_at, st, rq, tg, squash(a.task, 96), squash(a.error || "", 70), "b"]);
      this.askIdx.set(a.id, i); if (a.completed_at == null && st === "o") this.askOpen.add(i);
    }
    // failed tool calls: a mark on the session's lane at the moment the result said so
    for (const [ts, sid, tool, target, err] of b.errs || []) {
      if (ts < this.from) continue;
      const s = this.sess.get(`${b.host}|${sid}`) || ensure(sid, bySid.get(sid) || []);
      let t = String(target || "").replace(/\s+/g, " "); if (home) t = t.replaceAll(home + "/", "~/");
      this.delta().errs.push([this.secs(ts), s.i, this.S(tool), this.S(t.slice(0, TGT_CAP)), this.S(squash(err, 120))]);
    }
    // undelivered messages: new ones, and ones already drawn that have since been delivered or failed
    for (const x of [...(b.deliveries || [])].sort((p, q) => p.created_at - q.created_at)) {
      const st = deliveryState(x.status), known = this.dlvIdx.get(x.id);
      if (known != null) { if (st !== "o" && this.dlvOpen.has(known)) { this.dlvOpen.delete(known); this.delta().dlvUpdates.push([known, x.done_at ?? Date.now(), st]); } continue; }
      if (x.created_at < this.from || st === "c") continue;
      const i = this.nDlv++; this.dlvIdx.set(x.id, i); if (st === "o") this.dlvOpen.add(i);
      this.delta().dlv.push([x.created_at, x.done_at, st, this.brokerIdx(b.host, actors.get(x.from), x.from || "system"), squash(x.to_name || x.to, 60), squash(x.text, 96), squash(x.error || "", 90)]);
    }
    return this.flush();
  }
  /** Open turn asks whose session has gone quiet close where the work stopped, as the week reads them. */
  tick(wall: number): Delta | null {
    this.delta();
    for (const s of this.sess.values()) {
      if (s.turnAsk != null && wall - s.last >= LIVE_MS) { this.close(s.turnAsk, s.last); s.turnAsk = null; }
      if (s.subAsk != null && this.askOpen.has(s.subAsk) && wall - s.last >= LIVE_MS) this.close(s.subAsk, s.last);
    }
    return this.flush();
  }
  private flush(): Delta | null {
    const d = this.d; this.d = null;
    if (!d || (!d.events.length && !d.turns.length && !d.asks.length && !d.askUpdates.length && !d.sessions.length && !d.teamHosts.length && !d.errs.length && !d.dlv.length && !d.dlvUpdates.length)) {
      // nothing drawable: strings and actors made along the way are still owed to the client next time
      if (d && (d.strs.length || d.actors.length)) this.d = d;
      return null;
    }
    return d;
  }
}

/* ---------- a source: accumulators, subscribers ---------- */
type Sub = { frame: LiveFrame; send: (event: string, data: unknown) => void; hours: number };
class Source {
  hosts = new Map<string, HostAcc>(); subs = new Set<Sub>();
  constructor(readonly name: LiveSourceName) {}
  acc(host: string, persona?: string): HostAcc {
    let a = this.hosts.get(host);
    if (!a) { a = newAcc({ host, persona: persona || defaultPersona(host), ssh: host, platform: "macos" }); this.hosts.set(host, a); }
    return a;
  }
  ingest(b: HostBatch) {
    const a = this.acc(b.host, b.persona), now = Date.now();
    if (b.home) a.home = b.home;
    if (b.persona && this.name === "otlp") a.cfg.persona = b.persona;
    for (const s of b.sessions) if (!a.sessions.has(s.sid)) a.sessions.set(s.sid, s);
    for (const r of b.raw) { a.raw.push(r); if (r[0] > a.lastCall) a.lastCall = r[0]; }
    for (const t of b.inbound) a.inbound.push(t);
    for (const x of b.actors) a.actors.set(x.id, x);
    for (const x of b.asks) a.asks.set(x.id, x);
    for (const e of b.errs || []) a.errs.push(e);
    for (const x of b.deliveries || []) a.deliveries.set(x.id, x);
    // lag: from the newest call being made to this server holding it — only for calls made since the last pass
    const newest = b.raw.length ? Math.max(...b.raw.map(r => r[0])) : 0;
    if (newest && a.prevAt && newest >= a.prevAt - 1000) { a.lag.push(now - newest); if (a.lag.length > 50) a.lag.shift(); }
    for (const s of this.subs) { const d = s.frame.apply(b); if (d) s.send("delta", d); }
  }
  trim(from: number) {
    for (const a of this.hosts.values()) {
      if (a.raw.length && a.raw[0][0] < from) a.raw = a.raw.filter(r => r[0] >= from);
      if (a.inbound.length && a.inbound[0][0] < from) a.inbound = a.inbound.filter(r => r[0] >= from);
      if (a.usage.length && a.usage[0][0] < from) a.usage = a.usage.filter(r => r[0] >= from);
      for (const [id, x] of a.asks) if ((x.completed_at ?? x.created_at) < from) a.asks.delete(id);
      if (a.errs.length && a.errs[0][0] < from) a.errs = a.errs.filter(r => r[0] >= from);
      for (const [id, x] of a.deliveries) if ((x.done_at ?? Infinity) < from) a.deliveries.delete(id);
    }
  }
  status(): LiveHostStatus[] {
    const now = Date.now();
    return [...this.hosts.values()].map(a => {
      const lag = [...a.lag].sort((x, y) => x - y);
      return { host: a.cfg.host, persona: a.cfg.persona, self: a.cfg.ssh === null, at: a.at, stale: this.name === "live" ? !a.ok || a.at == null || now - a.at > (a.cfg.ssh === null ? 30_000 : 3 * REMOTE_EVERY) : false,
        error: a.error, passMs: a.passMs, bytes: a.bytes, lastCall: a.lastCall || null, next: a.next || null, calls: a.raw.length, lagMs: lag.length ? lag[Math.floor(lag.length / 2)] : null };
    });
  }
}

/* ---------- the hub ---------- */
export type WorldLiveOptions = {
  dir?: string; home?: string; brokerUrl?: () => string;
  /** test seam: tail passes for remote hosts without ssh */
  remoteTail?: (cfg: TeamHostConfig, state: TailState | null, from: number) => Promise<RemoteTailOut>;
  log?: (line: string) => void;
};
export function createWorldLive(opts: WorldLiveOptions = {}) {
  const dir = opts.dir ?? teamDir(), home = opts.home ?? homedir(), log = opts.log ?? (() => {});
  const live = new Source("live"), otlp = new Source("otlp");
  let config: TeamHostConfig[] = [], prs: TeamPrs | null = null, started = false, stopTimer: ReturnType<typeof setTimeout> | null = null;
  let ready: Promise<void> | null = null;
  const timers: ReturnType<typeof setInterval>[] = [], watchers: FSWatcher[] = [];
  let brokerAbort: AbortController | null = null;
  const seen: OtlpShape[] = [];
  // the team's names, for OTLP from one of our machines before the live tail has started (which reads them too)
  readTeamConfig(dir).then(c => { if (!config.length) config = c; }).catch(() => {});
  const windowFrom = () => Date.now() - LIVE_HOURS * 36e5;

  /* this machine */
  async function localPass(a: HostAcc) {
    if (a.running) { a.dirty = true; return; }
    a.running = true;
    try {
      do {
        a.dirty = false;
        const t0 = Date.now();
        const pass = await tailOnce({ home, host: a.cfg.host, from: windowFrom(), state: a.tail });
        a.prevAt = a.lastPassStart; a.lastPassStart = t0;
        a.tail = pass.state; a.home = home; a.passMs = Date.now() - t0; a.bytes = pass.bytes; a.at = Date.now(); a.ok = true; a.tried = true; a.error = undefined;
        pass.batch.persona = a.cfg.persona; pass.batch.platform = a.cfg.platform;
        ingestOtlp(live, toOtlp(pass.batch), pass.usage, a.cfg.host);
      } while (a.dirty);
    } catch (e) { a.ok = false; a.tried = true; a.error = String((e as Error)?.message || e).slice(0, 200); }
    finally { a.running = false; }
  }
  /* the other machines: the same tail over ssh, offsets handed back each time */
  let script: Promise<string> | null = null;
  const bundle = () => script ??= Bun.build({ entrypoints: [join(import.meta.dir, "world-tail.ts")], target: "bun", minify: true })
    .then(async b => { if (!b.success) throw new Error(b.logs.map(l => l.message).join("; ")); return await b.outputs[0].text(); });
  async function sshTail(cfg: TeamHostConfig, state: TailState | null, from: number, first: boolean): Promise<RemoteTailOut> {
    const name = cfg.host.replace(/[^\w.-]/g, ""), persona = cfg.persona.replace(/[^\w .-]/g, "");
    const remote = `cd /tmp && export PATH="$HOME/.bun/bin:$PATH" && WORLD_TAIL_RUN=1 WORLD_TAIL_NAME=${name} WORLD_TAIL_PERSONA='${persona}' WORLD_TAIL_FROM=${from} bun run -`;
    const body = `globalThis.__WT=${JSON.stringify(state)};\n${await bundle()}`;
    // one multiplexed connection per host: a pass after the first costs a round trip, not a handshake
    const proc = Bun.spawn(["ssh", "-o", "ConnectTimeout=8", "-o", "BatchMode=yes", "-o", "ServerAliveInterval=10", "-o", "ControlMaster=auto", "-o", "ControlPath=/tmp/scout-wl-%C", "-o", "ControlPersist=120", cfg.ssh!, remote],
      { stdin: new Blob([body]), stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill("SIGKILL"), first ? 120_000 : 30_000);
    try {
      const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      if (code !== 0) throw new Error((err.trim().split("\n").pop() || `ssh exited ${code}`).slice(0, 200));
      const res = JSON.parse(out) as RemoteTailOut;
      if (!res || typeof res !== "object" || !res.state) throw new Error("tail returned nothing");
      return res;
    } finally { clearTimeout(timer); }
  }
  async function remotePass(a: HostAcc) {
    if (a.running) return;
    a.running = true;
    const t0 = Date.now(), first = !a.tail;
    a.prevAt = a.lastPassStart; a.lastPassStart = t0;
    try {
      const out = opts.remoteTail ? await opts.remoteTail(a.cfg, a.tail, windowFrom()) : await sshTail(a.cfg, a.tail, windowFrom(), first);
      a.tail = out.state; a.home = out.home || a.home; a.at = Date.now(); a.ok = true; a.fails = 0; a.error = undefined; a.passMs = Date.now() - t0; a.bytes = out.bytes || 0;
      ingestOtlp(live, out.otlp, Array.isArray(out.usage) ? out.usage : [], a.cfg.host);
      a.next = Date.now() + REMOTE_EVERY;
    } catch (e) {
      a.ok = false; a.fails++; a.error = String((e as Error)?.message || e).slice(0, 200); a.passMs = Date.now() - t0;
      a.next = Date.now() + Math.min(REMOTE_MAX_BACKOFF, REMOTE_EVERY * 2 ** a.fails);
      log(`${a.cfg.host}: ${a.error} · retry in ${Math.round((a.next - Date.now()) / 1000)}s`);
    } finally { a.tried = true; a.running = false; }
  }
  /* the broker's own feed: an ask opened or finished nudges this machine's pass (which reads the asks by rowid) */
  async function brokerFeed(nudge: () => void) {
    if (!opts.brokerUrl) return;
    let wait = 2000;
    while (brokerAbort && !brokerAbort.signal.aborted) {
      try {
        const res = await fetch(new URL("/v1/events/stream", opts.brokerUrl()), { headers: { accept: "text/event-stream" }, signal: brokerAbort.signal });
        if (!res.ok || !res.body) throw new Error(`broker feed ${res.status}`);
        wait = 2000;
        const reader = res.body.getReader(), dec = new TextDecoder(); let buf = "";
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          let i; while ((i = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, i); buf = buf.slice(i + 2);
            const ev = block.match(/^event: *(.+)$/m)?.[1]?.trim() || "";
            if (/^(invocation|flight)\./.test(ev)) nudge();
          }
        }
      } catch { if (brokerAbort?.signal.aborted) return; }
      await new Promise(r => setTimeout(r, wait)); wait = Math.min(60_000, wait * 2);
    }
  }
  function ingestOtlp(src: Source, req: OtlpExport, usage: Usage[] = [], expectHost?: string): AdaptResult {
    const res = fromOtlp(req, { maxAgeMs: LIVE_HOURS * 36e5 + HEADROOM });
    // a tail speaks for the host it was run on, whatever name that machine gives itself
    for (const b of res.batches) { if (expectHost) b.host = expectHost; b.persona ||= config.find(c => c.host === b.host)?.persona; src.ingest(b); }
    // token counts ride beside the OTLP (numbers only): they fill the seed's token panels, not the deltas
    const uh = expectHost ?? res.batches[0]?.host;
    if (uh && usage.length) src.acc(uh).usage.push(...usage.filter(u => u[0] >= windowFrom()));
    return res;
  }

  async function start() {
    if (started) return; started = true;
    config = await readTeamConfig(dir);
    const disk = await readSnapshots(dir, config).catch(() => [] as TeamSnapshot[]);
    try { prs = JSON.parse(await Bun.file(join(dir, "prs.json")).text()); } catch { prs = null; }
    for (const c of config) { const a = live.hosts.get(c.host) || newAcc(c, disk.find(s => s.host === c.host) || null); a.cfg = c; live.hosts.set(c.host, a); }
    const self = config.find(c => c.ssh === null);
    const selfAcc = self ? live.hosts.get(self.host)! : null;
    const first: Promise<unknown>[] = [];
    if (selfAcc) {
      first.push(localPass(selfAcc));
      let deb: ReturnType<typeof setTimeout> | null = null;
      const nudge = () => { if (deb) return; deb = setTimeout(() => { deb = null; void localPass(selfAcc); }, 150); };
      for (const d of [join(home, ".claude/projects"), join(home, ".codex/sessions")]) {
        try { const w = watch(d, { recursive: true }, (_e, f) => { if (!f || String(f).endsWith(".jsonl")) nudge(); }); w.on("error", () => {}); watchers.push(w); } catch {}
      }
      timers.push(setInterval(() => void localPass(selfAcc), LOCAL_EVERY));
      brokerAbort = new AbortController(); void brokerFeed(nudge);
    }
    for (const c of config) {
      if (c.ssh === null || !c.ssh) continue;
      const a = live.hosts.get(c.host)!;
      first.push(remotePass(a));
    }
    timers.push(setInterval(() => { const now = Date.now(); for (const a of live.hosts.values()) if (a.cfg.ssh && !a.running && a.tried && now >= a.next) void remotePass(a); }, 1000));
    timers.push(setInterval(() => { live.trim(windowFrom()); otlp.trim(windowFrom()); }, 60_000));
    ready = Promise.race([Promise.allSettled(first).then(() => {}), new Promise<void>(r => setTimeout(r, SEED_WAIT))]);
    log(`live: following ${config.map(c => c.host).join(", ")}`);
  }
  // every subscriber, either source: quiet asks close, and the page hears each host's freshness
  let ticker: ReturnType<typeof setInterval> | null = null;
  const ensureTicker = () => ticker ??= setInterval(() => {
    const now = Date.now();
    for (const src of [live, otlp]) for (const s of src.subs) { const d = s.frame.tick(now); if (d) s.send("delta", d); s.send("status", { at: now, source: src.name, hosts: src.status() }); }
    if (!live.subs.size && !otlp.subs.size && ticker) { clearInterval(ticker); ticker = null; }
  }, STATUS_EVERY);
  function stop() {
    started = false; ready = null;
    timers.splice(0).forEach(t => clearInterval(t));
    watchers.splice(0).forEach(w => { try { w.close(); } catch {} });
    brokerAbort?.abort(); brokerAbort = null;
  }
  const keepAlive = () => { if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; } };
  const maybeStop = () => { if (live.subs.size) return; stopTimer = setTimeout(() => { if (!live.subs.size) stop(); }, 60_000); };

  /* the seed: the engine's own payload, built from what the source holds right now */
  function seed(src: Source, hours: number): { payload: TeamWeekPayload & { live: unknown }; cfg: TeamHostConfig[] } {
    const wall = Date.now(), from = wall - hours * 36e5, now = wall + HEADROOM;
    const cfg = src.name === "live" ? config : [...src.hosts.values()].map(a => a.cfg);
    const snaps: TeamSnapshot[] = [...src.hosts.values()].filter(a => cfg.some(c => c.host === a.cfg.host)).map(a => {
      // lanes fold by project: the collector's repos say which checkouts are projects; a source with none uses its own roots
      let repos = a.disk?.repos || {};
      if (!Object.keys(repos).length) { repos = {}; for (const r of a.raw) repos[teamRoot(r[1], a.home || home)] ||= { origin: "", branches: [], worktrees: [] }; }
      return { v: HOST_SNAPSHOT_VERSION, host: a.cfg.host, home: a.home || a.disk?.home || home, at: a.at ?? wall, from, now: wall, sessions: [...a.sessions.values()], raw: a.raw, inbound: a.inbound, usage: a.usage, errs: a.errs,
        files: {}, roots: a.disk?.roots || {}, repos, broker: { asks: [...a.asks.values()], messages: [], actors: [...a.actors.values()], deliveries: [...a.deliveries.values()] }, ms: 0, stale: src.name === "live" ? !a.ok : false };
    });
    const payload = buildTeamWeek({ snapshots: snaps, config: cfg, prs: src.name === "live" ? prs : null, quota: [], now, days: (now - from) / DAY, wall, withAskIds: true });
    const n = payload.hosts.length;
    payload.label = `${src.name === "live" ? "LIVE" : "OTLP"} · ${n} MACHINE${n === 1 ? "" : "S"}`;
    return { payload: Object.assign(payload, { live: { source: src.name, wall, hours, headroom: HEADROOM, hosts: src.status() } }), cfg };
  }

  return {
    /** Opens a subscriber: sends the seed, then deltas and status until the returned function is called. */
    async subscribe(source: LiveSourceName, hours: number, send: (event: string, data: unknown) => void): Promise<() => void> {
      const src = source === "otlp" ? otlp : live;
      keepAlive();
      if (src === live) { await start(); await ready; }
      // seed and register in one synchronous step: no row can fall between them
      const { payload, cfg } = seed(src, Math.max(1, Math.min(LIVE_HOURS, hours || LIVE_HOURS)));
      const frame = new LiveFrame(payload, cfg, h => src.hosts.get(h)?.home || home, h => src.hosts.get(h)?.disk?.roots || {});
      const sub: Sub = { frame, send, hours };
      src.subs.add(sub); ensureTicker();
      send("seed", payload);
      send("status", { at: Date.now(), source: src.name, hosts: src.status() });
      return () => { src.subs.delete(sub); if (src === live) maybeStop(); };
    },
    /** OTLP from an outside exporter (decoded) → the otlp source. Metrics are noted, not drawn. */
    ingest(req: OtlpExport, signal: "traces" | "logs" | "metrics" = "traces"): AdaptResult {
      seen.push(otlpShape(signal, req)); if (seen.length > 30) seen.shift();
      if (signal === "metrics") return { batches: [], spans: 0, logs: 0, used: 0, skipped: 0, events: {} };
      return ingestOtlp(otlp, req);
    },
    status: () => ({ started, live: live.status(), otlp: otlp.status(), subscribers: live.subs.size + otlp.subs.size, otlpSeen: seen }),
    stop,
    /** test seam */
    _sources: { live, otlp },
  };
}
export type WorldLive = ReturnType<typeof createWorldLive>;
