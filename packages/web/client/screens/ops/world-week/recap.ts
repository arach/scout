/**
 * World · RECAP — highlights and lowlights picked from the week's own rows, kept pure so the HUD, the tour generator
 * (design/studio/scripts/world-recap.ts) and the tests all pick the same things. Nothing is scored by a model: each
 * category is one plain rule over the payload, and every caption says what the rule measured.
 *
 * HIGHLIGHTS
 *   merge    a merged PR, fastest from the ask that started its branch to the merge (the branch named in a session's
 *            git / gh commands, the ask open on that session when the branch first shows up, at least one edit between)
 *   shipped  the completed broker ask with the most lines changed while it was open (then most files edited); an
 *            operator's own turn or a subagent call is not an ask someone handed over
 *   busiest  each machine's busiest hour by tool calls
 *   handoff  a completed ask from one machine to another (the requester's machine is not the target's)
 * LOWLIGHTS
 *   stuck    the oldest item still STUCK at the end of the week (trouble.ts): a broker ask or an undelivered message open
 *            past the threshold and inside the staleness horizon; older than that it is stale debris, not a lowlight
 *   failed   failed asks (one per distinct reason), and really-failed deliveries grouped by their reason; a delivery the
 *            broker closed as housekeeping ("Stale local delivery reconciled") is not a failure
 *   burn     the session that made the most tool calls inside an ask that then failed
 */

import { RECONCILED_RE, STALE_DEFAULT, STUCK_DEFAULT } from "./trouble.ts";

export type RecapSide = "hi" | "lo";
export type RecapCat = "merge" | "shipped" | "busiest" | "handoff" | "stuck" | "failed" | "burn";
export type RecapPick = {
  id: string; side: RecapSide; cat: RecapCat;
  title: string;      // a short line for the card
  caption: string;    // what happened, in plain words, with the measurement
  t: number;          // where the playhead goes (ms)
  host: string | null;
  ask?: number;       // index into D.asks
  dlv?: number;       // index into D.dlv
  sess?: number;      // index into D.sessions
  url?: string;
  score: number;
};
export type Recap = { hi: RecapPick[]; lo: RecapPick[]; cats: Record<RecapCat, RecapPick[]> };

export const CAT_LABEL: Record<RecapCat, string> = {
  merge: "FASTEST MERGE", shipped: "BIGGEST SHIP", busiest: "BUSIEST HOUR", handoff: "HANDOFF",
  stuck: "LONGEST STUCK", failed: "FAILED", burn: "BURNED CALLS",
};
const HI_ORDER: RecapCat[] = ["merge", "shipped", "busiest", "handoff"];
const LO_ORDER: RecapCat[] = ["stuck", "failed", "burn"];

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const p2 = (n: number) => String(n).padStart(2, "0");
export const when = (ms: number) => { const d = new Date(ms); return `${DOW[d.getDay()]} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
export const span = (ms: number) => {
  const s = Math.max(0, ms) / 1e3;
  if (s < 90) return Math.round(s) + "s";
  if (s < 5400) return Math.round(s / 60) + "m";
  if (s < 172800) return (s / 3600).toFixed(1).replace(/\.0$/, "") + "h";
  return (s / 86400).toFixed(1).replace(/\.0$/, "") + "d";
};
// emoji stay out of the card (PR titles carry gitmoji); the words are the title
const clip = (s: unknown, n = 70) => { const t = String(s || "").replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t; };
const num = (n: number) => n >= 1e4 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k" : n.toLocaleString("en-US");

/** the payload fields recap reads (a subset of the HUD's D) */
export type RecapData = {
  now: number; from: number;
  actors: { name?: string; id?: string; kind?: string; node?: string; host?: string | null }[];
  hosts: { name?: string; host?: string }[];
  asks: any[]; events: any[]; strs: string[]; sessions: any[];
  work?: Record<string, { s: number; t0: number; t1: number; n: number; files?: any[] }>;
  dlv?: any[]; errs?: any[];
  vcs?: { prs?: any[] };
  team?: { hosts?: { host: string; persona?: string }[]; sessionHost?: (number | null)[] | Record<string, number> };
};

export function pickRecap(D: RecapData, n = 5, o: { stuckMs?: number; staleMs?: number } = {}): Recap {
  const stuckMs = o.stuckMs || STUCK_DEFAULT, staleMs = o.staleMs || STALE_DEFAULT;
  const T0 = D.from, NOW = D.now, STR = D.strs || [];
  const hostByName = new Map((D.hosts || []).map(h => [h.name, h.host]));
  const persona = new Map((D.team?.hosts || []).map(h => [h.host, h.persona || h.host]));
  (D.hosts || []).forEach(h => { if (h.host && !persona.has(h.host)) persona.set(h.host, h.name || h.host); });
  const actorHost = (i: number) => { const a = D.actors[i]; return a ? a.host || hostByName.get(a.node) || null : null; };
  const who = (i: number) => { const a = D.actors[i]; return a ? String(a.name || a.id || "?").replace(/^openscout-/i, "") : "?"; };
  const sh = D.team?.sessionHost as any;
  const sessHost = (s: number) => { const k = sh ? sh[s] : null; return k != null && D.team?.hosts?.[k] ? D.team.hosts[k].host : null; };
  const machine = (h: string | null) => h ? (persona.get(h) && persona.get(h) !== h ? `${persona.get(h)} (${h})` : h) : "an unknown machine";

  const asks = D.asks.map(([ts, done, st, rq, tg, task, err, src]: any[], i: number) =>
    ({ i, ts, done: done || (st === "f" ? ts : null), st, rq, tg, task, err, src, work: D.work?.[i] }));
  const events = D.events.map(([s, root, k, sess, name, tgt, file, add, rem]: any[]) =>
    ({ t: T0 + s * 1e3, root: STR[root], k, sess, tgt: tgt != null && tgt >= 0 ? STR[tgt] || "" : "", add: add || 0, rem: rem || 0 }));
  const bySess = new Map<number, typeof events>();
  for (const e of events) { let l = bySess.get(e.sess); if (!l) bySess.set(e.sess, l = []); l.push(e); }
  for (const l of bySess.values()) l.sort((a, b) => a.t - b.t);
  const askHost = (a: typeof asks[0]) => (a.work ? sessHost(a.work.s) : null) || actorHost(a.tg);
  const editsIn = (s: number, a: number, b: number) => {
    let lines = 0, edits = 0;
    for (const e of bySess.get(s) || []) if (e.k === "e" && e.t >= a && e.t <= b) { edits++; lines += e.add + e.rem; }
    return { lines, edits };
  };
  const cats = { merge: [], shipped: [], busiest: [], handoff: [], stuck: [], failed: [], burn: [] } as Record<RecapCat, RecapPick[]>;

  /* merge: PR branch → the sessions whose git / gh commands name it → the ask open there when it first shows up */
  const asksBySess = new Map<number, typeof asks>();
  for (const a of asks) if (a.work) { let l = asksBySess.get(a.work.s); if (!l) asksBySess.set(a.work.s, l = []); l.push(a); }
  const vcsCmds = events.filter(e => e.k === "c" && /\b(git|gh)\b/.test(e.tgt));
  for (const [s, m, repo, prn, title, branch, , url] of D.vcs?.prs || []) {
    if (m == null || !branch || branch.length < 4) continue;
    const tm = T0 + m * 1e3;
    const re = new RegExp(`(^|[\\s/:'"=])${branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[\\s'":])`);
    let best: { a: typeof asks[0]; tb: number } | null = null;
    const firstSeen = new Map<number, number>();
    for (const e of vcsCmds) if (e.t <= tm && !firstSeen.has(e.sess) && re.test(e.tgt)) firstSeen.set(e.sess, e.t);
    for (const [sess, tb] of firstSeen) {
      const open = (asksBySess.get(sess) || []).filter(a => a.ts <= tb).sort((x, y) => y.ts - x.ts)[0];
      if (!open || !editsIn(sess, open.ts, tm).edits) continue;
      if (!best || open.ts > best.a.ts) best = { a: open, tb };
    }
    if (!best) continue;
    const a = best.a, d = tm - a.ts, h = askHost(a);
    cats.merge.push({ id: `merge:${repo || ""}#${prn}`, side: "hi", cat: "merge", t: tm, host: h, ask: a.i, url,
      title: `#${prn} ${clip(title, 44)}`,
      caption: `${who(a.rq)} asked ${who(a.tg)} on ${machine(h)} at ${when(a.ts)}; PR #${prn}${repo ? ` (${repo})` : ""} merged ${span(d)} later.`,
      score: -d });
  }
  cats.merge.sort((x, y) => y.score - x.score);

  /* shipped: completed asks (not subagent calls) by lines changed while open */
  for (const a of asks) {
    if (a.st !== "c" || (a.src && a.src !== "b") || !a.work) continue;
    const { lines, edits } = editsIn(a.work.s, a.work.t0, a.work.t1);
    const files = (a.work.files || []).filter(f => f[2] > 0).length;
    if (!files && !edits) continue;
    const h = askHost(a);
    cats.shipped.push({ id: `ask:${a.i}`, side: "hi", cat: "shipped", t: a.done || a.ts, host: h, ask: a.i,
      title: clip(a.task, 48),
      caption: `${who(a.rq)} → ${who(a.tg)} on ${machine(h)}: ${files} files edited${lines ? `, ${num(lines)} lines changed` : ""}, ${a.work.n} calls, done in ${span((a.done || a.ts) - a.ts)}.`,
      score: lines * 1e3 + files });
  }
  cats.shipped.sort((x, y) => y.score - x.score);

  /* busiest: per machine, the hour with the most tool calls */
  const hourly = new Map<string, Map<number, { n: number; sess: Set<number>; roots: Map<string, number> }>>();
  for (const e of events) {
    const h = sessHost(e.sess); if (!h) continue;
    let m = hourly.get(h); if (!m) hourly.set(h, m = new Map());
    const k = Math.floor(e.t / 36e5); let b = m.get(k); if (!b) m.set(k, b = { n: 0, sess: new Set(), roots: new Map() });
    b.n++; b.sess.add(e.sess); b.roots.set(e.root, (b.roots.get(e.root) || 0) + 1);
  }
  for (const [h, m] of hourly) {
    let bk = -1, bb: any = null; for (const [k, b] of m) if (!bb || b.n > bb.n) { bk = k; bb = b; }
    if (!bb) continue;
    const t = bk * 36e5, top = [...bb.roots.entries()].sort((x: any, y: any) => y[1] - x[1])[0];
    const topSess = [...bb.sess].map(s => [s, (bySess.get(s) || []).filter(e => e.t >= t && e.t < t + 36e5).length] as [number, number]).sort((x, y) => y[1] - x[1])[0];
    cats.busiest.push({ id: `hour:${h}:${bk}`, side: "hi", cat: "busiest", t: t + 30 * 6e4, host: h, sess: topSess?.[0],
      title: `${persona.get(h) || h} · ${when(t)}`,
      caption: `${machine(h)}'s busiest hour: ${num(bb.n)} tool calls from ${when(t)} across ${bb.sess.size} sessions, most in ${top ? top[0] : "—"}.`,
      score: bb.n });
  }
  cats.busiest.sort((x, y) => y.score - x.score);

  /* handoff: a completed ask whose requester sits on another machine than the work */
  for (const a of asks) {
    if (a.st !== "c") continue;
    const from = actorHost(a.rq), to = askHost(a);
    if (!from || !to || from === to) continue;
    cats.handoff.push({ id: `ask:${a.i}`, side: "hi", cat: "handoff", t: a.done || a.ts, host: to, ask: a.i,
      title: `${persona.get(from) || from} → ${persona.get(to) || to} · ${clip(a.task, 34)}`,
      caption: `${who(a.rq)} on ${machine(from)} handed "${clip(a.task, 60)}" to ${who(a.tg)} on ${machine(to)}; done in ${span((a.done || a.ts) - a.ts)}${a.work ? `, ${a.work.n} calls` : ""}.`,
      score: (a.work?.n || 0) + 1 });
  }
  cats.handoff.sort((x, y) => y.score - x.score);

  /* stuck: still open at the end of the week — broker asks (an operator turn or subagent call is work, not stuck) and messages */
  const seenTarget = new Set<string>();
  const stuck: RecapPick[] = [];
  const inHorizon = (ts: number) => NOW - ts > stuckMs && NOW - ts <= staleMs;
  for (const a of asks) if (!a.done && inHorizon(a.ts) && (!a.src || a.src === "b")) {
    const h = askHost(a);
    stuck.push({ id: `ask:${a.i}`, side: "lo", cat: "stuck", t: NOW, host: h, ask: a.i, title: `${span(NOW - a.ts)} · ${who(a.rq)} → ${who(a.tg)}`,
      caption: `An ask from ${who(a.rq)} to ${who(a.tg)} on ${machine(h)}, open since ${when(a.ts)} (${span(NOW - a.ts)}) with no answer: "${clip(a.task, 60)}".`,
      score: NOW - a.ts });
  }
  const openDlv = (D.dlv || []).map((r, i) => [r, i] as const).filter(([r]) => r[2] === "o" && r[1] == null && inHorizon(r[0]));
  for (const [[ts, , , rq, toName, text], i] of openDlv) {
    const h = actorHost(rq);
    stuck.push({ id: `dlv:${i}`, side: "lo", cat: "stuck", t: NOW, host: h, dlv: i, title: `${span(NOW - ts)} · message to ${clip(toName, 20)}`,
      caption: `A message from ${who(rq)} to ${toName || "?"}, undelivered since ${when(ts)} (${span(NOW - ts)})${openDlv.length > 1 ? `; ${openDlv.length} deliveries are stuck like it` : ""}: "${clip(text, 50)}".`,
      score: NOW - ts });
  }
  stuck.sort((x, y) => y.score - x.score);
  // one pick per thing and per target: the same message fanned out, or a queue of them to one agent, is one stuck item
  for (const p of stuck) { const r = p.ask != null ? D.asks[p.ask] : D.dlv![p.dlv!]; const ks = [(p.ask != null ? "a" : "d") + r[3] + ":" + clip(r[5], 40), "to:" + r[4]]; if (ks.some(k => seenTarget.has(k))) continue; ks.forEach(k => seenTarget.add(k)); cats.stuck.push(p); }
  // the oldest of the other kind comes second, so a queue of stale messages can't hide a stuck ask (or the reverse)
  if (cats.stuck.length > 2) { const j = cats.stuck.findIndex(p => (p.ask != null) !== (cats.stuck[0].ask != null)); if (j > 1) cats.stuck.splice(1, 0, cats.stuck.splice(j, 1)[0]); }

  /* failed: delivery failures grouped by reason (one pick per reason), then failed asks, one per distinct reason */
  const reason = (s: unknown) => clip(String(s || "no reason recorded").replace(/:\s.*$/, ""), 60);
  const dGroups = new Map<string, { n: number; last: number; i: number; msgs: Set<string> }>();
  (D.dlv || []).forEach((r, i) => {
    if (r[2] !== "f" || RECONCILED_RE.test(String(r[6] || ""))) return;
    const k = reason(r[6]); let g = dGroups.get(k); if (!g) dGroups.set(k, g = { n: 0, last: 0, i, msgs: new Set() });
    g.n++; g.msgs.add(String(r[5] || "")); if ((r[1] || r[0]) >= g.last) { g.last = r[1] || r[0]; g.i = i; }
  });
  for (const [k, g] of dGroups) {
    const r = D.dlv![g.i];
    cats.failed.push({ id: `dlvs:${k}`, side: "lo", cat: "failed", t: g.last, host: actorHost(r[3]), dlv: g.i,
      title: `${num(g.n)} deliver${g.n === 1 ? "y" : "ies"} · ${clip(k, 30)}`,
      caption: `${num(g.n)} deliver${g.n === 1 ? "y" : "ies"} (${num(g.msgs.size)} distinct messages) failed with "${k}"; the last at ${when(g.last)}, to ${r[4] || "?"}.`,
      score: g.n * 10 });
  }
  const aGroups = new Map<string, typeof asks>();
  for (const a of asks) if (a.st === "f") { const k = reason(a.err); const l = aGroups.get(k) || []; l.push(a); aGroups.set(k, l); }
  for (const [k, l] of aGroups) {
    const a = l.sort((x, y) => (y.done! - y.ts) - (x.done! - x.ts))[0], h = askHost(a);
    cats.failed.push({ id: `ask:${a.i}`, side: "lo", cat: "failed", t: a.done || a.ts, host: h, ask: a.i,
      title: `${l.length} ask${l.length > 1 ? "s" : ""} · ${clip(k, 34)}`,
      caption: `${l.length} ask${l.length > 1 ? "s" : ""} failed with "${k}"; the longest, ${who(a.rq)} → ${who(a.tg)} on ${machine(h)}, ran ${span((a.done || a.ts) - a.ts)} first: "${clip(a.task, 50)}".`,
      score: l.length * 10 });
  }
  cats.failed.sort((x, y) => y.score - x.score);

  /* burn: the most tool calls made inside an ask that then failed */
  for (const a of asks) {
    if (a.st !== "f" || !a.work) continue;
    const calls = (bySess.get(a.work.s) || []).filter(e => e.t >= a.ts - 6e4 && e.t <= (a.done || a.ts) + 6e4).length || a.work.n;
    const errs = (D.errs || []).filter(([sec, sess]) => sess === a.work!.s && T0 + sec * 1e3 >= a.ts - 6e4 && T0 + sec * 1e3 <= (a.done || a.ts) + 6e4).length;
    if (!calls) continue;
    const h = askHost(a);
    cats.burn.push({ id: `ask:${a.i}`, side: "lo", cat: "burn", t: a.done || a.ts, host: h, ask: a.i, sess: a.work.s,
      title: `${num(calls)} calls · ${who(a.tg)}`,
      caption: `${who(a.tg)} on ${machine(h)} made ${num(calls)} tool calls${errs ? ` (${errs} errored)` : ""} over ${span((a.done || a.ts) - a.ts)} on "${clip(a.task, 44)}", then the ask failed: ${reason(a.err)}.`,
      score: calls });
  }
  cats.burn.sort((x, y) => y.score - x.score);

  return { hi: interleave(cats, HI_ORDER, n), lo: interleave(cats, LO_ORDER, n), cats };
}

/** round-robin down the categories so the top n shows each kind before a second of any; one pick per ask */
function interleave(cats: Record<RecapCat, RecapPick[]>, order: RecapCat[], n: number): RecapPick[] {
  const out: RecapPick[] = [], used = new Set<string>(), idx = order.map(() => 0);
  while (out.length < n) {
    let moved = false;
    order.forEach((c, j) => {
      while (out.length < n && idx[j] < cats[c].length) {
        const p = cats[c][idx[j]++], key = p.ask != null ? "ask:" + p.ask : p.id; if (used.has(key)) continue;
        used.add(key); out.push(p); moved = true; break;
      }
    });
    if (!moved) break;
  }
  return out;
}

/* the tour: bpm-fit like the-week.tour. A bar to settle on the whole week, then each pick for `hold` bars — :recap <n>
 * flies there and lights its row; lowlights play with :errors on. The engine and the generator both call this. */
export function recapTour(r: Recap, o: { bpm?: number; hold?: number; name?: string } = {}): string {
  const bpm = o.bpm || 138, hold = o.hold || 4;
  const all = [...r.hi, ...r.lo];
  const out = [
    `# Recap (World · Modale): written from the week's data by design/studio/scripts/world-recap.ts (or built in for :recap play). Edit that, not this.`,
    `name ${o.name || "Recap"}`, `bpm ${bpm}`, `beats 4`, `offset 0`, `quiet`, ``,
    `b=0 order fixed`, `b=0 solo off`, `b=0 errors off`, `b=0 pause`, `b=0 recap show`,
    `b=0 fly week iso home over 3s`,
  ];
  let b = 1;
  all.forEach((p, k) => {
    out.push(``, `# ${k < r.hi.length ? "H" + (k + 1) : "L" + (k - r.hi.length + 1)} · ${CAT_LABEL[p.cat]} · ${p.title.replace(/#/g, "no.")}`);
    if (k === r.hi.length) out.push(`b=${b} errors on`);
    // the HUD eases onto the pick by itself; a beat later a slow linear turn keeps the frame alive while the caption reads
    out.push(`b=${b} recap ${k + 1}`, `t=+${(60 / bpm).toFixed(3)} fly turn 6 linear over ${((hold * 4 - 1) * 60 / bpm).toFixed(2)}s`);
    b += hold;
  });
  out.push(``, `b=${b} errors off`, `b=${b} solo off`, `b=${b} fly week iso home over 4s`);
  return out.join("\n") + "\n";
}
