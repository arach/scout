/**
 * World · point & speak — the op center inside the HUD, the pure half.
 *
 * Point at a session in the world, choose a verb (or hold ⌥ and say it), review, act. Four verbs on two routes that
 * never mix:
 *   THROUGH SCOUT · traced   Ask (broker ask) · Report (Scoutbot) · Dispatch here (a new session on that machine)
 *   DIRECT · untraced        Send (typed into the live session; no broker record)
 * Words are Ask unless they say otherwise, and never Send unless they say so. A traced verb that goes unanswered
 * becomes stuck (trouble.ts); it never falls back to direct, and Send never falls back to Ask.
 *
 * Freeze groups what's on the frame locally and deterministically (no model, nothing leaves the machine); the
 * optional Jev hand-off gets a redacted summary only.
 *
 * Pure on purpose (no DOM, no engine state) so the rules can be tested.
 */

export type Verb = "ask" | "report" | "dispatch" | "send";
export const VERBS: Verb[] = ["ask", "report", "dispatch", "send"];
export const TRACED: Record<Verb, boolean> = { ask: true, report: true, dispatch: true, send: false };
export const VERB_KEY: Record<Verb, string> = { ask: "a", report: "r", dispatch: "d", send: "s" };
export const VERB_LABEL: Record<Verb, string> = { ask: "Ask", report: "Report", dispatch: "Dispatch here", send: "Send" };

export const ROUTE_LABEL = { traced: "through Scout · traced", direct: "direct · untraced" } as const;
export const routeOf = (v: Verb) => (TRACED[v] ? ROUTE_LABEL.traced : ROUTE_LABEL.direct);

/** What the operator pointed at, as the review and the payload need it. */
export type Target = {
  name: string;
  harness: string;
  lane: string;
  root?: string | null;
  host?: string | null;
  hostName?: string | null;
  agentId?: string | null;
  agentName?: string | null;
  sessionId?: string | null;
};

const norm = (s: string) => String(s || "").toLowerCase().replace(/[“”"]/g, "").replace(/\s+/g, " ").trim();

const SEND_RE = /^(send|type)\b|\b(directly|straight in(to)?|type (it|this|that) in(to)?|into (the|its) (session|terminal|pane))\b/;
const DISPATCH_RE = /^(dispatch|start|spin up|kick off|launch)\b|\b(dispatch (one|someone|an agent|a session)|new session (here|on)|start (a|an) (new )?(session|agent))\b/;
const REPORT_RE = /^(report|status report|summari[sz]e|catch me up)\b|\b(report (on|about)|give me a report|status report)\b/;
// the verb word (and its object) the operator led with: dropped from what gets sent
const LEAD_RE = /^(please\s+)?(ask|send|type|tell|dispatch|start|spin up|kick off|launch|report( on| about)?|summari[sz]e)\b(\s+(it|them|him|her|this|that|this one))?(\s+(directly|to))?[\s,:–-]*/i;

/**
 * The verb words carry. Ask unless they say otherwise; Send only when the words say send / type it in / directly.
 * `text` is what gets sent (the leading verb dropped); the original words when nothing would be left.
 */
export function inferVerb(words: string): { verb: Verb; text: string; why: string } {
  const raw = String(words || "").trim().replace(/^["“]|["”]$/g, "");
  const s = norm(raw);
  const verb: Verb = SEND_RE.test(s) ? "send" : DISPATCH_RE.test(s) ? "dispatch" : REPORT_RE.test(s) ? "report" : "ask";
  const why = verb === "ask" ? "default" : `the words say ${verb}`;
  const stripped = verb === "ask" && !/^(please\s+)?ask\b/i.test(raw) ? raw : raw.replace(LEAD_RE, "").trim();
  return { verb, text: stripped || raw, why };
}

/** Where a verb's words land, in one line for the review. */
export function landsOf(v: Verb, t: Target): string {
  const on = t.hostName || t.host || "this machine";
  if (v === "ask") return `${t.agentName || t.name} on ${on} · broker log, an arc, the reply anchors here`;
  if (v === "report") return `Scoutbot reports on ${t.name} · in the Scoutbot thread`;
  if (v === "dispatch") return `a new ${t.harness} session on ${on} in ${t.lane} · broker log + arc`;
  return `typed into ${t.name}'s live session · no broker record, no reply tracking`;
}
/** What happens if nobody answers: traced work goes stuck; nothing ever changes route. */
export function silentRule(v: Verb, stuck: string): string {
  return TRACED[v]
    ? `if silent: ${stuck.toLowerCase()} → stuck. Never falls back to direct.`
    : "if the session isn't live, nothing is sent. Never falls back to Ask.";
}

export type Payload = { verb: Verb; method: "POST"; url: string | null; body: Record<string, unknown>; missing?: string };

/** The server route Send would need: it does not exist yet (see payloadFor). */
export const MISSING_SEND = "POST /api/sessions/send — in-place only (herdr · tmux · lattices), refuses when the session isn't live. "
  + "/api/sessions/reply resumes through the broker when nothing holds the session: a fallback, so Send can't use it.";
export const MISSING_ASK_AGENT = "no Scout agent id for this session (no traced ask has reached it yet); /api/ask needs targetAgentId, the HUD won't guess one from the lane name";
export const MISSING_DISPATCH_REMOTE = "the world payload names machines by hostname; /api/hosts/:machineId/api/sessions wants the mesh machine id";
/** the one-line reason review shows (the full one goes in the log row) */
const MISSING_SHORT: Record<string, string> = { [MISSING_SEND]: "no in-place send route", [MISSING_ASK_AGENT]: "no agent id", [MISSING_DISPATCH_REMOTE]: "no machine id" };
export const missingShort = (p: Payload) => (p.missing ? MISSING_SHORT[p.missing] || "no route" : "");
/** review's MODE line: one short line */
export const modeLine = (p: Payload, live: boolean) =>
  canSend(p, live) ? `LIVE · ${p.method} ${p.url}` : p.missing ? `STUB · ${missingShort(p)} · nothing sent` : `DRY RUN · would ${p.method} ${p.url}`;

/**
 * The exact request a verb makes. `url: null` (with `missing`) when the server has no route for it: the HUD logs the
 * payload and never substitutes another verb's route.
 */
export function payloadFor(v: Verb, t: Target, text: string, o: { selfHost?: string | null; machineId?: string | null } = {}): Payload {
  const words = String(text || "").trim();
  const meta = { source: "world.point-speak", lane: t.lane, ...(t.host ? { host: t.host } : {}), ...(t.sessionId ? { sessionId: t.sessionId } : {}) };
  if (v === "ask") {
    const body = { ...(t.agentId ? { targetAgentId: t.agentId } : {}), targetLabel: t.agentName || t.name, body: words, metadata: meta };
    // a session no traced ask ever reached has no Scout agent id: asking a lane label would guess, so it stays a stub
    return t.agentId ? { verb: v, method: "POST", url: "/api/ask", body } : { verb: v, method: "POST", url: "/api/ask", body, missing: MISSING_ASK_AGENT };
  }
  if (v === "report") {
    return { verb: v, method: "POST", url: "/api/scoutbot/chat", body: {
      body: `Report on ${t.name} (${t.harness} on ${t.hostName || t.host || "this machine"}, ${t.lane})${words ? ": " + words : "."}`,
      usageMode: "chat", uiContext: { surface: "world", usageMode: "chat", target: meta } } };
  }
  if (v === "dispatch") {
    const remote = !!t.host && !!o.selfHost && t.host !== o.selfHost;
    const body = { target: { ...(t.root ? { projectPath: t.root } : {}) }, execution: { harness: t.harness, session: "new" }, seed: { instructions: words } };
    if (!remote) return { verb: v, method: "POST", url: "/api/sessions", body };
    if (o.machineId) return { verb: v, method: "POST", url: `/api/hosts/${encodeURIComponent(o.machineId)}/api/sessions`, body };
    return { verb: v, method: "POST", url: null, body: { ...body, host: t.host }, missing: MISSING_DISPATCH_REMOTE };
  }
  return { verb: v, method: "POST", url: null, body: { sessionId: t.sessionId || null, harness: t.harness, body: words, delivery: "in_place_only" }, missing: MISSING_SEND };
}

/** A real request goes out only when asked for (live) and the route exists; otherwise it is a dry run. */
export const canSend = (p: Payload, live: boolean) => live && !!p.url && !p.missing;

/* ---------------- freeze: local grouping ---------------- */

export type Unit = {
  /** stable key (lane|host) */
  key: string;
  lane: string;
  host: string | null;
  hostName: string;
  /** tool calls in the frame, and the last one's time */
  calls: number;
  last: number | null;
  stuck: number;
  /** the oldest stuck item's open time */
  stuckSince?: number | null;
  failed: number;
  sessions?: number;
  /** what went wrong, in plain words: who (the agent or session), when, and why (short) */
  trouble?: Trouble[];
};
export type Trouble = { cls: "failed" | "stuck"; who: string; what: "ask" | "message" | "tool call"; at: number; why?: string };
export type GroupClass = "stuck" | "failed" | "working" | "quiet";
export type Group = {
  id: string;
  cls: GroupClass;
  host: string | null;
  hostName: string;
  lanes: string[];
  keys: string[];
  calls: number;
  stuck: number;
  failed: number;
  stuckSince: number | null;
  last: number | null;
  trouble: Trouble[];
  label: string;
};

export const WORKING_MS = 10 * 60e3;
const CLS_ORDER: GroupClass[] = ["stuck", "failed", "working", "quiet"];
/** a catch-all lane ("other · 33") names nothing: the answer names who instead */
export const isCatchAll = (lane: string) => /^other\b/i.test(lane);
/** the broker's reason, shortened to plain words */
export function plainWhy(err: string | undefined): string {
  const e = String(err || "").replace(/\s+/g, " ").trim();
  if (!e) return "";
  if (/stale running flight reconciled/i.test(e)) return "it went stale and the broker closed it";
  if (/stale local delivery reconciled/i.test(e)) return "the broker closed it as housekeeping";
  const head = e.split(/[:;.]/)[0]!.trim();
  return head.length > 48 ? head.slice(0, 47) + "…" : head.toLowerCase();
}
const hm = (t: number) => { const d = new Date(t); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
const andList = (xs: string[]) => xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];
const ago = (ms: number) => { const s = Math.max(0, ms) / 1000; return s < 60 ? Math.round(s) + "s" : s < 3600 ? Math.round(s / 60) + "m" : s < 86400 ? (s / 3600).toFixed(1) + "h" : (s / 86400).toFixed(1) + "d"; };

export function classOf(u: Unit, t: number, workingMs = WORKING_MS): GroupClass | null {
  if (u.stuck > 0) return "stuck";
  if (u.failed > 0) return "failed";
  if (u.calls > 0 && u.last != null && t - u.last <= workingMs) return "working";
  if (u.calls > 0) return "quiet";
  return null;
}

/**
 * Group a frozen frame: one group per (class, machine), its lanes listed. Trouble first, then the busiest working
 * machines, then the quiet ones; ties by machine and lane name, so the same frame always groups the same way.
 */
export function groupFrame(units: Unit[], t: number, o: { max?: number; workingMs?: number } = {}): Group[] {
  const max = o.max ?? 6, byKey = new Map<string, Group>();
  const sorted = [...units].sort((a, b) => a.key.localeCompare(b.key));
  for (const u of sorted) {
    const cls = classOf(u, t, o.workingMs);
    if (!cls) continue;
    const k = cls + "|" + (u.host || u.hostName);
    const g: Group = byKey.get(k) || { id: "", cls, host: u.host, hostName: u.hostName, lanes: [], keys: [], calls: 0, stuck: 0, failed: 0, stuckSince: null, last: null, trouble: [], label: "" };
    for (const x of u.trouble || []) g.trouble.push(x);
    if (!g.lanes.includes(u.lane)) g.lanes.push(u.lane);
    g.keys.push(u.key);
    g.calls += u.calls; g.stuck += u.stuck; g.failed += u.failed;
    if (u.stuckSince != null) g.stuckSince = g.stuckSince == null ? u.stuckSince : Math.min(g.stuckSince, u.stuckSince);
    if (u.last != null) g.last = g.last == null ? u.last : Math.max(g.last, u.last);
    byKey.set(k, g);
  }
  const out = [...byKey.values()].sort((a, b) =>
    CLS_ORDER.indexOf(a.cls) - CLS_ORDER.indexOf(b.cls)
    || (a.cls === "working" ? b.calls - a.calls : a.cls === "quiet" ? (b.last ?? 0) - (a.last ?? 0) : b.stuck + b.failed - a.stuck - a.failed)
    || a.hostName.localeCompare(b.hostName) || a.lanes.join().localeCompare(b.lanes.join()));
  return out.slice(0, max).map((g, i) => {
    g.lanes.sort();
    g.trouble.sort((a, b) => b.at - a.at || a.who.localeCompare(b.who));
    // a catch-all lane names nothing: on a trouble hull, say who instead
    const who = [...new Set(g.trouble.filter(x => x.cls === g.cls).map(x => x.who))];
    const shown = (g.cls === "failed" || g.cls === "stuck") && who.length && g.lanes.every(isCatchAll) ? who : g.lanes;
    const id = "C" + (i + 1), lanes = shown.slice(0, 3).join(", ") + (shown.length > 3 ? ` +${shown.length - 3}` : "");
    const what = g.cls === "stuck" ? `stuck ${ago(t - (g.stuckSince ?? t))}` : g.cls === "failed" ? `${g.failed} failed` : g.cls === "working" ? `working · ${g.calls} calls` : `quiet ${ago(t - (g.last ?? t))}`;
    return { ...g, id, label: `${id} · ${what} · ${g.hostName} · ${lanes}` };
  });
}

/**
 * A question about the frozen frame, answered from the grouping alone (a template, no model). `lit` is the group the
 * answer is about, for the hull to light.
 */
export function answerFrozen(question: string, groups: Group[], t: number): { text: string; lit: string | null } {
  const q = norm(question);
  if (!groups.length) return { text: "Nothing moved in this frame.", lit: null };
  const of = (cls: GroupClass) => groups.filter(g => g.cls === cls);
  const say = (g: Group) => {
    const real = g.lanes.filter(l => !isCatchAll(l)), where = `${real.length ? real.join(", ") + " " : ""}on ${g.hostName}`;
    const hits = g.trouble.filter(x => x.cls === g.cls);
    if ((g.cls === "failed" || g.cls === "stuck") && hits.length) {
      const kind = hits.every(x => x.what === hits[0]!.what) ? hits[0]!.what : "item";
      const names = andList([...new Set(hits.map(x => x.who))].slice(0, 3)) + (new Set(hits.map(x => x.who)).size > 3 ? " and others" : "");
      const n = hits.length, lead = hits[0]!, why = lead.why ? `: ${lead.why}` : "";
      if (g.cls === "failed") return n === 1
        ? `The ${kind} to ${names} ${where} failed at ${hm(lead.at)}${why}.`
        : `${n} ${kind}s failed ${where}, to ${names}. The latest at ${hm(lead.at)}${why}.`;
      const old = hits.reduce((a, b) => (b.at < a.at ? b : a));
      return n === 1
        ? `The ${kind} to ${names} ${where} has been open ${ago(t - old.at)}, past the stuck line.`
        : `${n} ${kind}s ${where} are past the stuck line, to ${names}. The oldest has been open ${ago(t - old.at)}.`;
    }
    const lanes = real.length ? real.join(", ") : "work";
    if (g.cls === "stuck") return `${lanes} on ${g.hostName} has ${g.stuck} open past the stuck line, the oldest for ${ago(t - (g.stuckSince ?? t))}.`;
    if (g.cls === "failed") return `${lanes} on ${g.hostName} had ${g.failed} fail in this frame.`;
    if (g.cls === "working") return `${real.length ? real.join(", ") : "Work"} on ${g.hostName} is working, ${g.calls} calls in the frame.`;
    return `${real.length ? real.join(", ") : "Work"} on ${g.hostName} has been quiet for ${ago(t - (g.last ?? t))}.`;
  };
  const named = groups.find(g => q.includes(g.hostName.toLowerCase()) || g.lanes.some(l => l.length > 2 && !isCatchAll(l) && q.includes(l.toLowerCase())) || g.trouble.some(x => x.who.length > 2 && q.includes(x.who.toLowerCase())));
  const ask = (cls: GroupClass, none: string) => {
    const hit = of(cls);
    if (!hit.length) { const moving = of("working"); return { text: none + (moving.length ? ` ${moving.length === 1 ? "One group is" : moving.length + " groups are"} working.` : ""), lit: null }; }
    return { text: (hit.length > 1 ? `${hit.length} groups. ` : "") + say(hit[0]!), lit: hit[0]!.id };
  };
  if (/\b(stuck|waiting|blocked|hung|wedged|hanging)\b/.test(q)) return ask("stuck", "Nothing is stuck in this frame.");
  if (/\b(fail(ed|ing|ure)?s?|errors?|broke(n)?|wrong)\b/.test(q)) return ask("failed", "Nothing failed in this frame.");
  if (named) return { text: say(named), lit: named.id };
  if (/\b(busy|working|moving|active|building|doing)\b/.test(q)) return ask("working", "Nothing is working right now.");
  if (/\b(quiet|idle|asleep|stopped)\b/.test(q)) return ask("quiet", "Nothing has gone quiet.");
  return { text: `${groups.length} group${groups.length === 1 ? "" : "s"}. ` + groups.slice(0, 3).map(g => g.label).join(" · "), lit: null };
}

/**
 * What `:freeze jev` would send to the world-command route: the question and the groups' shape. No prompt text, no
 * file names, no message bodies: lanes, machines, classes and counts only.
 */
export function jevFramePayload(groups: Group[], ctx: { t: number; from: number; to: number; lanes: string[]; view?: string }) {
  const frame = groups.map(g => ({ id: g.id, cls: g.cls, host: g.hostName, lanes: g.lanes, calls: g.calls, stuck: g.stuck, failed: g.failed }));
  return {
    text: "group the frozen frame",
    context: { lanes: ctx.lanes.slice(0, 200), t: ctx.t, from: ctx.from, to: ctx.to, view: ctx.view },
    frame,
    redacted: "prompt text, file names and message bodies are not sent",
  };
}
