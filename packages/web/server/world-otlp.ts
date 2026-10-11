/**
 * World · OTLP: the live World's one wire format. Every live source is an OTLP producer — this machine's transcript
 * tail, the same tail run on the other machines over ssh, the broker's asks, and any outside exporter (Claude Code's
 * OTEL_EXPORTER_OTLP_ENDPOINT …) posting to /api/ops/world-otlp — and one adapter, fromOtlp(), turns OTLP into the
 * rows the World builds from (world-hosts' snapshot shapes). The engine never sees which source a row came from.
 *
 * Shapes follow OTLP/JSON (resourceSpans / resourceLogs) and the GenAI semantic conventions where they fit:
 *   resource   host.name · service.name (claude-code | codex | scout-broker | whatever an exporter says) · scout.persona
 *   tool call  span, gen_ai.operation.name=execute_tool, gen_ai.tool.name, gen_ai.conversation.id (or session.id)
 *   turn       log record, event.name=gen_ai.user.message, body = the words
 *   ask        span scout.ask with scout.ask.{id,from,to,state,task}
 *   tool error log record, event.name=scout.tool.error (gen_ai.tool.name, scout.target, error.message) — a call that
 *              failed, at the moment its result said so; from an exporter: an execute_tool span with status ERROR, or
 *              Claude Code's tool_result with success=false
 *   delivery   span scout.delivery with scout.delivery.{id,from,to,to.name,state,transport,text}: a message the broker
 *              could not deliver (status ERROR) or has not delivered yet (scout.delivery.open)
 * Our own attributes ride under scout.* (scout.cwd, scout.target, scout.edit.lines_added …).
 *
 * Privacy: fromOtlp() redacts, then clips, every string it lets out (clip() in world-transcript.ts), whoever produced
 * it — an outside exporter is not trusted to have redacted anything. Text is optional: a span with only a tool name
 * and a time still renders as a dot.
 *
 * Portable on purpose (no imports beyond world-transcript.ts): the ssh tail bundles this file to produce OTLP remotely.
 */
import { clip, type Inbound, type Raw, type ToolErr } from "./world-transcript.ts";
import type { BrokerDelivery } from "./world-broker-rows.ts";

/* ---------- the rows both sides speak (world-hosts' snapshot shapes, minus what live doesn't carry) ---------- */
export type LiveSession = { sid: string; h: string; parent?: string; sub?: 1 };
export type LiveAsk = { id: string; created_at: number; completed_at: number | null; state: string | null; requester_id: string; target_agent_id: string; target_node: string | null; task: string; error: string | null };
export type LiveActor = { id: string; kind: string; name: string; node: string | null; harness: string | null; root: string | null };
/** One machine's new rows. raw targets are already redacted (never the unredacted [7]). */
export type HostBatch = {
  host: string; persona?: string; home?: string; platform?: string;
  raw: Raw[]; inbound: Inbound[]; sessions: LiveSession[]; asks: LiveAsk[]; actors: LiveActor[];
  /** failed tool calls, and the broker's undeliverable / undelivered messages */
  errs: ToolErr[]; deliveries: BrokerDelivery[];
};
export const emptyBatch = (host: string): HostBatch => ({ host, raw: [], inbound: [], sessions: [], asks: [], actors: [], errs: [], deliveries: [] });

/* ---------- OTLP/JSON helpers ---------- */
type AnyValue = { stringValue?: string; intValue?: string | number; doubleValue?: number; boolValue?: boolean; arrayValue?: { values?: AnyValue[] }; kvlistValue?: { values?: KeyValue[] }; bytesValue?: string };
type KeyValue = { key: string; value?: AnyValue };
const str = (key: string, v: string | null | undefined): KeyValue[] => v ? [{ key, value: { stringValue: v } }] : [];
const int = (key: string, v: number | null | undefined): KeyValue[] => v != null && Number.isFinite(v) ? [{ key, value: { intValue: String(Math.round(v)) } }] : [];
const bool = (key: string, v: boolean | undefined): KeyValue[] => v ? [{ key, value: { boolValue: true } }] : [];
const nanos = (ms: number) => `${Math.round(ms)}000000`;
// ids: stable hashes (FNV-1a, widened), so the same call re-sent is the same span
function hex(s: string, len: number): string {
  let out = "";
  for (let k = 0; out.length < len; k++) {
    let h = 2166136261 ^ k;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    out += (h >>> 0).toString(16).padStart(8, "0");
  }
  return out.slice(0, len);
}
export const SERVICE_OF: Record<string, string> = { claude: "claude-code", codex: "codex" };
const HARNESS_OF: Record<string, string> = { "claude-code": "claude", claude: "claude", codex: "codex", "codex-cli": "codex" };

/* ---------- producer: rows → OTLP ---------- */
export type OtlpExport = { resourceSpans?: any[]; resourceLogs?: any[] };
export function toOtlp(b: HostBatch): OtlpExport {
  const resource = (service: string) => ({ attributes: [...str("host.name", b.host), ...str("service.name", service), ...str("scout.persona", b.persona), ...str("scout.home", b.home), ...str("os.type", b.platform === "linux" ? "linux" : b.platform ? "darwin" : undefined)] });
  const meta = new Map(b.sessions.map(s => [s.sid, s]));
  const spansBy = new Map<string, any[]>(), logsBy = new Map<string, any[]>();
  const push = (m: Map<string, any[]>, k: string, v: any) => { const l = m.get(k) || []; l.push(v); m.set(k, l); };
  b.raw.forEach(([ts, cwd, harness, sid, tool, target, delta], i) => {
    const m = meta.get(sid);
    push(spansBy, SERVICE_OF[harness] || harness, {
      traceId: hex(`${b.host}|${sid}`, 32), spanId: hex(`${b.host}|${sid}|${ts}|${i}|${tool}`, 16), name: `execute_tool ${tool}`, kind: 1,
      startTimeUnixNano: nanos(ts), endTimeUnixNano: nanos(ts),
      attributes: [...str("gen_ai.operation.name", "execute_tool"), ...str("gen_ai.tool.name", tool), ...str("gen_ai.conversation.id", sid),
        ...str("scout.cwd", cwd), ...str("scout.target", target), ...int("scout.edit.lines_added", delta?.[0]), ...int("scout.edit.lines_removed", delta?.[1]),
        ...bool("scout.subagent", !!m?.sub), ...str("scout.parent.conversation.id", m?.parent)],
    });
  });
  b.inbound.forEach(([ts, sid, text]) => {
    const m = meta.get(sid);
    push(logsBy, SERVICE_OF[m?.h || "claude"] || m?.h || "claude-code", { timeUnixNano: nanos(ts), body: { stringValue: text },
      attributes: [...str("event.name", "gen_ai.user.message"), ...str("gen_ai.conversation.id", sid), ...bool("scout.subagent", !!m?.sub), ...str("scout.parent.conversation.id", m?.parent)] });
  });
  // a session that said nothing yet still exists: the harness is on the resource, sub/parent on a marker log
  const actorBy = new Map(b.actors.map(a => [a.id, a]));
  const who = (prefix: string, id: string) => { const a = actorBy.get(id); return a ? [...str(`${prefix}.name`, a.name), ...str(`${prefix}.kind`, a.kind), ...str(`${prefix}.node`, a.node), ...str(`${prefix}.harness`, a.harness), ...str(`${prefix}.root`, a.root)] : []; };
  b.asks.forEach(a => push(spansBy, "scout-broker", {
    traceId: hex(`ask|${a.id}`, 32), spanId: hex(`ask|${a.id}|span`, 16), name: "scout.ask", kind: 3,
    startTimeUnixNano: nanos(a.created_at), endTimeUnixNano: nanos(a.completed_at ?? a.created_at),
    status: a.state === "failed" ? { code: 2, message: a.error || "" } : a.state === "completed" ? { code: 1 } : {},
    attributes: [...str("scout.ask.id", a.id), ...str("scout.ask.from", a.requester_id), ...str("scout.ask.to", a.target_agent_id), ...str("scout.ask.to.node_name", a.target_node),
      ...str("scout.ask.state", a.state || "open"), ...str("scout.ask.task", a.task), ...str("error.message", a.error), ...bool("scout.ask.open", a.completed_at == null),
      ...who("scout.ask.from", a.requester_id), ...who("scout.ask.to", a.target_agent_id)],
  }));
  (b.errs || []).forEach(([ts, sid, tool, target, err]) => {
    const m = meta.get(sid);
    push(logsBy, SERVICE_OF[m?.h || "claude"] || m?.h || "claude-code", { timeUnixNano: nanos(ts), severityNumber: 17, severityText: "ERROR", body: { stringValue: err },
      attributes: [...str("event.name", "scout.tool.error"), ...str("gen_ai.conversation.id", sid), ...str("gen_ai.tool.name", tool), ...str("scout.target", target), ...str("error.message", err)] });
  });
  (b.deliveries || []).forEach(d => push(spansBy, "scout-broker", {
    traceId: hex(`dlv|${d.id}`, 32), spanId: hex(`dlv|${d.id}|span`, 16), name: "scout.delivery", kind: 3,
    startTimeUnixNano: nanos(d.created_at), endTimeUnixNano: nanos(d.done_at ?? d.created_at),
    status: d.status === "failed" ? { code: 2, message: d.error || "" } : d.done_at != null ? { code: 1 } : {},
    attributes: [...str("scout.delivery.id", d.id), ...str("scout.delivery.from", d.from), ...str("scout.delivery.to", d.to), ...str("scout.delivery.to.name", d.to_name),
      ...str("scout.delivery.state", d.status), ...str("scout.delivery.transport", d.transport), ...str("scout.delivery.text", d.text), ...str("error.message", d.error),
      ...bool("scout.delivery.open", d.done_at == null), ...who("scout.delivery.from", d.from)],
  }));
  const out: OtlpExport = {};
  if (spansBy.size) out.resourceSpans = [...spansBy].map(([svc, spans]) => ({ resource: resource(svc), scopeSpans: [{ scope: { name: "scout.world" }, spans }] }));
  if (logsBy.size) out.resourceLogs = [...logsBy].map(([svc, logRecords]) => ({ resource: resource(svc), scopeLogs: [{ scope: { name: "scout.world" }, logRecords }] }));
  return out;
}

/* ---------- adapter: OTLP → rows ---------- */
function value(v: AnyValue | undefined): string | number | boolean | null {
  if (!v) return null;
  if (v.stringValue != null) return v.stringValue;
  if (v.intValue != null) { const n = Number(v.intValue); return Number.isFinite(n) ? n : null; }
  if (v.doubleValue != null) return v.doubleValue;
  if (v.boolValue != null) return v.boolValue;
  return null;
}
function attrs(list: KeyValue[] | undefined): Map<string, string | number | boolean> {
  const m = new Map<string, string | number | boolean>();
  if (Array.isArray(list)) for (const kv of list) { if (!kv || typeof kv.key !== "string") continue; const v = value(kv.value); if (v != null) m.set(kv.key, v); }
  return m;
}
const S = (m: Map<string, unknown>, ...keys: string[]) => { for (const k of keys) { const v = m.get(k); if (v != null && v !== "") return String(v); } return ""; };
const N = (m: Map<string, unknown>, ...keys: string[]) => { for (const k of keys) { const v = Number(m.get(k)); if (Number.isFinite(v)) return v; } return null; };
/** OTLP nanos (string or number) → ms; 0 / missing → null */
export function ms(n: unknown): number | null {
  if (n == null || n === "" || n === 0 || n === "0") return null;
  try { const v = Number(BigInt(String(n).split(".")[0]) / 1000000n); return v > 0 ? v : null; } catch { return null; }
}
const bodyText = (b: AnyValue | undefined) => { const v = value(b); return typeof v === "string" ? v : ""; };
// a harness from the service name; anything else is named as the exporter names itself (clipped, never guessed)
const harnessOf = (service: string) => HARNESS_OF[service] || clip(service || "otlp", 24).replace(/[^\w.-]/g, "") || "otlp";
// a host that doesn't say is not guessed onto one of ours
export const NO_HOST = "unknown-host";
const hostOf = (m: Map<string, unknown>) => clip(S(m, "host.name", "host.hostname"), 64).replace(/\.local$/, "").replace(/[^\w.-]/g, "") || NO_HOST;
// conversation ids: our tails send 8-char sids; outside exporters send full uuids — the World keys sessions by their head
const sidOf = (m: Map<string, unknown>, fallback: string) => clip(S(m, "gen_ai.conversation.id", "session.id", "conversation.id") || fallback, 64).slice(0, 8) || "-";

// one tool call can arrive twice from one exporter: Claude Code sends a claude_code.tool span (traces) AND a tool_result
// log (logs), in separate requests. Calls that carry an id are drawn once; the memory is bounded
const seenCalls = new Set<string>();
function firstSighting(id: string): boolean {
  if (!id) return true;
  if (seenCalls.has(id)) return false;
  seenCalls.add(id);
  if (seenCalls.size > 20000) { let n = 0; for (const k of seenCalls) { seenCalls.delete(k); if (++n >= 5000) break; } }
  return true;
}
// a failure can also arrive twice (the span's status and the log's success=false): marked once
const seenErrs = new Set<string>();
function firstErr(id: string): boolean {
  if (!id) return true;
  if (seenErrs.has(id)) return false;
  seenErrs.add(id); if (seenErrs.size > 5000) seenErrs.clear();
  return true;
}
/** an exporter's word that a tool call failed: span status ERROR, or success=false (Claude Code) */
export const otlpFailed = (m: Map<string, unknown>, status?: { code?: number | string } | null) =>
  status?.code === 2 || status?.code === "STATUS_CODE_ERROR" || m.get("success") === false || m.get("success") === "false";
const callId = (m: Map<string, unknown>) => clip(S(m, "gen_ai.tool.call.id", "tool_use_id", "tool.call.id"), 96);
// a tool's arguments often come as JSON (Claude Code's tool_input): the World shows the one field that says what it touched
function targetOf(m: Map<string, unknown>): string {
  const v = S(m, "scout.target", "gen_ai.tool.call.arguments", "file_path", "tool_input", "tool_parameters");
  if (v.startsWith("{")) {
    try { const o = JSON.parse(v); for (const k of ["file_path", "path", "command", "pattern", "url", "query", "description"]) if (typeof o?.[k] === "string" && o[k]) return clip(o[k], 400); } catch {}
  }
  return clip(v, 400);
}

/** What an exporter sent that the World could read, and what it couldn't (counted, never kept). */
export type AdaptResult = { batches: HostBatch[]; spans: number; logs: number; used: number; skipped: number; events: Record<string, number> };

/**
 * OTLP/JSON (or the runtime codec's decoded protobuf, same shape) → one batch per host. Every string is redacted
 * and then clipped here; times outside [now - maxAge, now + skew] are dropped.
 */
export function fromOtlp(req: OtlpExport, opts: { now?: number; maxAgeMs?: number } = {}): AdaptResult {
  const now = opts.now ?? Date.now(), floor = now - (opts.maxAgeMs ?? 14 * 864e5), ceil = now + 5 * 60e3;
  const by = new Map<string, HostBatch>(), seenSess = new Map<string, Set<string>>();
  const res: AdaptResult = { batches: [], spans: 0, logs: 0, used: 0, skipped: 0, events: {} };
  const batch = (rm: Map<string, unknown>) => {
    const host = hostOf(rm); let b = by.get(host);
    if (!b) { b = emptyBatch(host); by.set(host, b); seenSess.set(host, new Set()); }
    const persona = clip(S(rm, "scout.persona"), 40), home = clip(S(rm, "scout.home"), 120), os = S(rm, "os.type");
    if (persona) b.persona = persona; if (home && /^\/[\w./-]+$/.test(home)) b.home = home; if (os) b.platform = os === "linux" ? "linux" : "macos";
    return b;
  };
  const session = (b: HostBatch, sid: string, h: string, m: Map<string, unknown>) => {
    const seen = seenSess.get(b.host)!; if (seen.has(sid)) return; seen.add(sid);
    const parent = clip(S(m, "scout.parent.conversation.id"), 64).slice(0, 8);
    b.sessions.push(m.get("scout.subagent") === true ? { sid, h, sub: 1, ...(parent ? { parent } : {}) } : { sid, h });
  };
  const okT = (t: number | null): t is number => t != null && t >= floor && t <= ceil;
  const tally = (k: string) => { res.events[k] = (res.events[k] || 0) + 1; };

  for (const rs of Array.isArray(req?.resourceSpans) ? req.resourceSpans : []) {
    const rm = attrs(rs?.resource?.attributes), service = S(rm, "service.name"), h = harnessOf(service);
    for (const ss of Array.isArray(rs?.scopeSpans) ? rs.scopeSpans : []) for (const sp of Array.isArray(ss?.spans) ? ss.spans : []) {
      res.spans++;
      const m = attrs(sp?.attributes), t = ms(sp?.startTimeUnixNano), name = typeof sp?.name === "string" ? sp.name : "";
      if (!okT(t)) { res.skipped++; continue; }
      if (name === "scout.delivery" || m.has("scout.delivery.id")) {
        const b = batch(rm), id = clip(S(m, "scout.delivery.id"), 160), from = clip(S(m, "scout.delivery.from"), 120), to = clip(S(m, "scout.delivery.to"), 120);
        if (!id || !to) { res.skipped++; continue; }
        const state = clip(S(m, "scout.delivery.state") || (sp?.status?.code === 2 ? "failed" : "pending"), 24);
        b.deliveries.push({ id, created_at: t, done_at: m.get("scout.delivery.open") === true ? null : ms(sp?.endTimeUnixNano) ?? t, status: state, from, to, to_name: clip(S(m, "scout.delivery.to.name"), 80) || null,
          transport: clip(S(m, "scout.delivery.transport"), 32), text: clip(S(m, "scout.delivery.text").replace(/\s+/g, " "), 200), error: clip(S(m, "error.message"), 200) || null });
        if (from && m.has("scout.delivery.from.name") && !b.actors.some(a => a.id === from))
          b.actors.push({ id: from, kind: clip(S(m, "scout.delivery.from.kind"), 24) || "?", name: clip(S(m, "scout.delivery.from.name"), 80), node: clip(S(m, "scout.delivery.from.node"), 64) || null, harness: clip(S(m, "scout.delivery.from.harness"), 24) || null, root: clip(S(m, "scout.delivery.from.root"), 160) || null });
        res.used++; tally("scout.delivery"); continue;
      }
      if (name === "scout.ask" || m.has("scout.ask.from")) {
        const b = batch(rm), id = clip(S(m, "scout.ask.id") || String(sp?.spanId || ""), 96);
        const state = S(m, "scout.ask.state") || (sp?.status?.code === 2 ? "failed" : sp?.status?.code === 1 ? "completed" : "open");
        const end = m.get("scout.ask.open") === true ? null : ms(sp?.endTimeUnixNano);
        const from = clip(S(m, "scout.ask.from"), 120), to = clip(S(m, "scout.ask.to"), 120);
        if (!id || !from || !to) { res.skipped++; continue; }
        b.asks.push({ id, created_at: t, completed_at: end, state: clip(state, 24), requester_id: from, target_agent_id: to, target_node: clip(S(m, "scout.ask.to.node_name"), 64) || null,
          task: clip(S(m, "scout.ask.task").replace(/\s+/g, " "), 1600), error: clip(S(m, "error.message", "scout.ask.error"), 200) || null });
        for (const [p, aid] of [["scout.ask.from", from], ["scout.ask.to", to]] as const) {
          if (!m.has(`${p}.name`) || b.actors.some(a => a.id === aid)) continue;
          b.actors.push({ id: aid, kind: clip(S(m, `${p}.kind`), 24) || "?", name: clip(S(m, `${p}.name`), 80), node: clip(S(m, `${p}.node`), 64) || null, harness: clip(S(m, `${p}.harness`), 24) || null, root: clip(S(m, `${p}.root`), 160) || null });
        }
        res.used++; tally("scout.ask"); continue;
      }
      // a tool call: GenAI execute_tool, or any span that names a tool
      const tool = S(m, "gen_ai.tool.name", "tool_name", "tool.name");
      // Claude Code's claude_code.tool has children (.execution, .blocked_on_user) about the same call: not more dots
      if (/^claude_code\.tool\./.test(name)) { res.skipped++; continue; }
      if (S(m, "gen_ai.operation.name") === "execute_tool" || tool) {
        const sid = sidOf(m, String(sp?.traceId || "").slice(0, 8));
        if (otlpFailed(m, sp?.status) && firstErr(callId(m))) {
          const b = batch(rm); b.errs.push([ms(sp?.endTimeUnixNano) ?? t, sid, clip(tool || name.replace(/^execute_tool\s+/, ""), 64) || "tool", targetOf(m).slice(0, 120), clip(String(sp?.status?.message || S(m, "error.message", "error")), 160)]);
          session(b, sid, h, m); tally("tool error");
        }
        if (!firstSighting(callId(m))) { res.skipped++; tally("duplicate call"); continue; }
        const b = batch(rm);
        const added = N(m, "scout.edit.lines_added"), removed = N(m, "scout.edit.lines_removed");
        const toolName = clip(tool || name.replace(/^execute_tool\s+/, ""), 64) || "tool";
        b.raw.push([t, clip(S(m, "scout.cwd"), 300), h, sid, toolName, targetOf(m), added != null || removed != null ? [added || 0, removed || 0] : undefined]);
        session(b, sid, h, m); res.used++; tally("execute_tool"); continue;
      }
      res.skipped++;
    }
  }
  for (const rl of Array.isArray(req?.resourceLogs) ? req.resourceLogs : []) {
    const rm = attrs(rl?.resource?.attributes), service = S(rm, "service.name"), h = harnessOf(service);
    for (const sl of Array.isArray(rl?.scopeLogs) ? rl.scopeLogs : []) for (const lr of Array.isArray(sl?.logRecords) ? sl.logRecords : []) {
      res.logs++;
      const m = attrs(lr?.attributes), t = ms(lr?.timeUnixNano) ?? ms(lr?.observedTimeUnixNano) ?? (typeof m.get("event.timestamp") === "string" ? Date.parse(String(m.get("event.timestamp"))) || null : null);
      const event = S(m, "event.name") || bodyText(lr?.body);
      if (!okT(t)) { res.skipped++; continue; }
      if (event === "gen_ai.user.message") {
        const b = batch(rm), sid = sidOf(m, "-"), text = clip(bodyText(lr?.body), 8000);
        if (!text) { res.skipped++; continue; }
        b.inbound.push([t, sid, text]); session(b, sid, h, m); res.used++; tally(event); continue;
      }
      // Claude Code's own events (OTEL_LOGS_EXPORTER=otlp): a finished tool is a dot; a prompt is a turn only when it
      // carries the words (OTEL_LOG_USER_PROMPTS=1) — a length alone is not text
      if (event === "scout.tool.error") {
        const b = batch(rm), sid = sidOf(m, "-");
        b.errs.push([t, sid, clip(S(m, "gen_ai.tool.name", "tool_name"), 64) || "tool", clip(S(m, "scout.target"), 120), clip(S(m, "error.message") || bodyText(lr?.body), 160)]);
        session(b, sid, h, m); res.used++; tally(event); continue;
      }
      if (event === "claude_code.tool_result" || event === "tool_result") {
        const sid = sidOf(m, "-"), tool = clip(S(m, "tool_name", "gen_ai.tool.name"), 64) || "tool";
        if (otlpFailed(m) && firstErr(callId(m))) { const b = batch(rm); b.errs.push([t, sid, tool, targetOf(m).slice(0, 120), clip(S(m, "error", "error.message"), 160)]); session(b, sid, h, m); tally("tool error"); }
        if (!firstSighting(callId(m))) { res.skipped++; tally("duplicate call"); continue; }
        const b = batch(rm);
        b.raw.push([t, "", h, sid, tool, targetOf(m), undefined]);
        session(b, sid, h, m); res.used++; tally(event); continue;
      }
      if (event === "claude_code.user_prompt" || event === "user_prompt") {
        const prompt = S(m, "prompt");
        tally(event);
        if (!prompt) { res.skipped++; continue; }
        const b = batch(rm), sid = sidOf(m, "-");
        b.inbound.push([t, sid, clip(prompt, 8000)]); session(b, sid, h, m); res.used++; continue;
      }
      if (event) tally(event);
      res.skipped++;
    }
  }
  res.batches = [...by.values()].filter(b => b.raw.length || b.inbound.length || b.asks.length || b.errs.length || b.deliveries.length);
  return res;
}

/** What an export carried, by name only — attribute keys, span/event/metric names, never a value. For the status page. */
export type OtlpShape = { at: number; signal: string; resource: Record<string, string>; names: Record<string, number>; attrs: string[] };
export function otlpShape(signal: string, req: any): OtlpShape {
  const resource: Record<string, string> = {}, names: Record<string, number> = {}, attrs = new Set<string>();
  const bump = (k: string) => { names[k] = (names[k] || 0) + 1; };
  const keys = (list: any) => { if (Array.isArray(list)) for (const kv of list) if (kv && typeof kv.key === "string") attrs.add(kv.key.slice(0, 80)); };
  const res = (r: any) => { if (Array.isArray(r?.attributes)) for (const kv of r.attributes) {
    // service and host names are what the World shows anyway; every other resource value stays out
    if (kv?.key === "service.name" || kv?.key === "host.name") resource[kv.key] = clip(String(value(kv.value) ?? ""), 64); else if (typeof kv?.key === "string") resource[kv.key.slice(0, 80)] = "…"; } };
  for (const rs of req?.resourceSpans || []) { res(rs.resource); for (const ss of rs.scopeSpans || []) for (const sp of ss.spans || []) { bump(`span ${clip(String(sp?.name || "?"), 60)}`); keys(sp?.attributes); } }
  for (const rl of req?.resourceLogs || []) { res(rl.resource); for (const sl of rl.scopeLogs || []) for (const lr of sl.logRecords || []) {
    const ev = (Array.isArray(lr?.attributes) ? lr.attributes.find((kv: any) => kv?.key === "event.name") : null);
    bump(`log ${clip(String(ev ? value(ev.value) : lr?.eventName || "?"), 60)}`); keys(lr?.attributes); } }
  for (const rm of req?.resourceMetrics || []) { res(rm.resource); for (const sm of rm.scopeMetrics || []) for (const m of sm.metrics || []) {
    bump(`metric ${clip(String(m?.name || "?"), 60)}`);
    for (const k of ["sum", "gauge", "histogram"]) for (const dp of m?.[k]?.dataPoints || []) keys(dp?.attributes); } }
  return { at: Date.now(), signal, resource, names, attrs: [...attrs].sort() };
}
