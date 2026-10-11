/**
 * World · Modale transcript reading: one Claude or Codex JSONL in, its tool calls, inbound turns and token usage out.
 * Shared by the local week (world-week.ts) and the per-host collector (world-hosts.ts), which runs this same code on
 * every machine over ssh. Portable on purpose: node:fs and readline only, so it bundles for a bare `bun run -`.
 */
import { createReadStream } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";
import { setImmediate as yieldLoop } from "node:timers/promises";

// [ts, cwd, harness, sid, tool, target (redacted), edit delta [added, removed] when the call changed a file,
//  the unredacted target — present only when redaction changed it, for path resolution; never served or shipped]
export type Raw = [number, string, string, string, string, string, ([number, number] | undefined)?, string?];
export type Inbound = [number, string, string];
export type Usage = [number, string, number, number, number, number];
/** a tool call that failed, at the moment its result said so: [ts, sid, tool, target (redacted), what it said (redacted)] */
export type ToolErr = [number, string, string, string, string];
export type ParsedTranscript = { raw: Raw[]; inbound: Inbound[]; usage: Usage[]; errs: ToolErr[] };
export const DAY = 864e5;

/* ---------- secrets: never let a key or token ride along in anything served outward ----------
   One redactor for every string that leaves this module's callers: tool targets, commands, URLs, operator and user
   turns, ask and broker task text. Run it BEFORE truncating (see clip()), so a cut can't split a secret into a
   shorter, unmatched tail. */
const SECRET_PATTERNS: [RegExp, string][] = [
  // PEM blocks of any kind; a block cut off by a cap still redacts to the end
  [/-----BEGIN [A-Z0-9 ]+-----[\s\S]*?(?:-----END [A-Z0-9 ]+-----|$)/g, "[pem]"],
  // Authorization / Cookie style headers, raw ("Authorization: Bearer …") or as JSON keys ("authorization": "…")
  [/\b((?:proxy-)?authorization|set-cookie|cookie|x-api-key|x-auth-token|api-key)(["']?\s*:\s*["']?)[^"'\n\\]+/gi, "$1$2•••"],
  // token shapes
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, "sk-ant-•••"],
  [/\b(?:sk|pk|rk)-(?:proj-|live_|test_|svcacct-|admin-)?[A-Za-z0-9_-]{16,}/g, "sk-•••"],
  [/\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g, "sk_•••"],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, "gh_•••"],
  [/\bgithub_pat_[A-Za-z0-9_]{16,}/g, "github_pat_•••"],
  [/\bglpat-[A-Za-z0-9_-]{16,}/g, "glpat-•••"],
  [/\bnpm_[A-Za-z0-9]{30,}/g, "npm_•••"],
  [/\bxox[abprse]-[A-Za-z0-9-]{8,}/g, "xox-•••"],
  [/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g, "hooks.slack.com/services/•••"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "AKIA•••"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "AIza•••"],
  [/\bya29\.[0-9A-Za-z_-]{20,}/g, "ya29.•••"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[jwt]"],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1•••"],
  [/(Basic\s+)[A-Za-z0-9+/=]{8,}/g, "$1•••"],
  // CLI credential arguments: --password hunter2, --token=…, --api-key "…", --client-secret '…'
  [/(--[\w-]*(?:password|passwd|passphrase|token|secret|api[-_]?key|apikey|access[-_]?key|private[-_]?key|credentials?)\b[\w-]*)(=|\s+)(?!-)("[^"]*"|'[^']*'|[^\s"';|&]+)/gi, "$1$2•••"],
  // mysql-likes take the password glued to -p (mysql -uroot -phunter2); sshpass -p takes it as the next word
  [/(\b(?:mysql|mysqldump|mysqladmin|mysqlimport|mysqlsh|mariadb|mariadb-dump)\b[^\n|;&]*?\s-p)([^\s"'|;&]+)/g, "$1•••"],
  [/(\bsshpass\s+-p\s*)("[^"]*"|'[^']*'|\S+)/g, "$1•••"],
  // curl -u user:pass / --user user:pass
  [/(\s(?:-u|--user)\s+["']?[^\s:"']+:)[^\s"']+/g, "$1•••"],
  // KEY=value env assignments for *_KEY, *_TOKEN, *_SECRET, PASSWORD …
  [/\b([A-Z0-9_]*(?:_KEY|_TOKEN|_SECRET|SECRET|PASSWORD|PASSWD|_PASS|_PWD|_CREDENTIALS?)[A-Z0-9_]*)=("[^"]*"|'[^']*'|[^\s"';|&]+)/g, "$1=•••"],
  // key: value / key=value pairs in JSON, YAML, query strings
  [/((?:api[_-]?key|access[_-]?key|secret|token|password|passwd|pwd|auth|authorization)["']?\s*[:=]\s*["']?)[^\s"'&,;]{6,}/gi, "$1•••"],
  // user:pass@ in URLs
  [/(\/\/[^/\s:@]+:)[^/\s@]+@/g, "$1•••@"],
];
// long opaque runs that mix cases and digits read as keys; uuids, shas and paths don't qualify
const OPAQUE = /\b[A-Za-z0-9_-]{36,}\b/g;
export function redact(s: string): string {
  if (!s) return s;
  for (const [re, to] of SECRET_PATTERNS) s = s.replace(re, to);
  return s.replace(OPAQUE, m => /[A-Z]/.test(m) && /[a-z]/.test(m) && /\d/.test(m) && !/^[0-9a-f-]+$/i.test(m) ? "•••" : m);
}
/** Redact, then cap at n. The redactor sees a window well past n (a secret that starts inside the cap is matched
 *  whole), but not megabytes of tool input. */
export function clip(s: string | null | undefined, n: number): string {
  const v = s || "";
  return redact(v.length > n + 8192 ? v.slice(0, n + 8192) : v).slice(0, n);
}
export const COLD_MIN = 20000;
export const NOISE = /^(<|Caveat:|This session is being continued|\[Request interrupted|Base directory for this skill|# AGENTS\.md|<environment_context>)/;
export const EDIT = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "apply_patch"]);
export const READ = new Set(["Read", "Grep", "Glob", "LS", "view_image"]);
export const COMMS = new Set(["send_message", "SendMessage", "followup_task", "wait_agent", "spawn_agent", "list_agents", "Agent", "Task", "SubagentHandback", "request_user_input_async"]);
export const CMD = new Set(["Bash", "exec", "exec_command", "shell", "write_stdin", "BashOutput", "sleep", "wait"]);
export const ART = /\.(html?|png|jpe?g|gif|webp|svg|pdf|mp4|mov|md|json|csv|txt)$/i;
export const TEXTY = /\.(md|txt|json|csv|tsx?|jsx?|mjs|css|html?|swift|py|sh|ya?ml|toml|rs|go|sql)$/i;
export const sq = (s: string) => s.replace(/\s+/g, " ").trim();
export const squash = (s: string | null, n: number) => (s || "").replace(/\s+/g, " ").slice(0, n);
export const ms = (s: string) => { const t = Date.parse(s); return Number.isFinite(t) ? t : null; };
/* edit sizes, read off the tool input (no git): an Edit's old and new text minus their shared leading and trailing
   lines; a Write counts its whole content as added; apply_patch counts each file's +/- hunk lines. Same as the study. */
export const lineList = (x: unknown) => typeof x === "string" && x.length ? x.split("\n") : [];
export function editDelta(oldText: unknown, newText: unknown): [number, number] {
  const a = lineList(oldText), b = lineList(newText); let i = 0, j = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return [b.length - i - j, a.length - i - j];
}
export function claudeDelta(name: string, i: any): [number, number] | undefined {
  if (name === "Edit") return editDelta(i.old_string, i.new_string);
  if (name === "MultiEdit" && Array.isArray(i.edits)) return i.edits.reduce((s: [number, number], e: any) => { const d = editDelta(e?.old_string, e?.new_string); return [s[0] + d[0], s[1] + d[1]]; }, [0, 0] as [number, number]);
  if (name === "Write") return [lineList(i.content).length, 0];
  if (name === "NotebookEdit") return [lineList(i.new_source).length, 0];
  return undefined;
}
export function patchText(as: string): string {
  const i = as.indexOf("apply_patch(");
  if (i >= 0) {
    const q = as.slice(i + 12).trimStart();
    if (q[0] === '"') { let j = 1; while (j < q.length && q[j] !== '"') j += q[j] === "\\" ? 2 : 1; try { return JSON.parse(q.slice(0, j + 1)); } catch {} }
    if (q[0] === "`") { const j = q.indexOf("`", 1); if (j > 0) return q.slice(1, j); }
  }
  if (as.startsWith("{")) { try { const o = JSON.parse(as); return String(o.input ?? o.patch ?? as); } catch {} }
  return as;
}
export function patchDeltas(patch: string): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>(); let cur: [number, number] | null = null;
  for (const l of patch.split("\n")) {
    const m = l.match(/^\*\*\* (?:Update|Add|Delete) File: (.*)$/);
    if (m) { const k = m[1].trim(); cur = out.get(k) || [0, 0]; out.set(k, cur); continue; }
    if (!cur || l.startsWith("***") || l.startsWith("@@")) continue;
    if (l.startsWith("+")) cur[0]++; else if (l.startsWith("-")) cur[1]++;
  }
  return out;
}
export function kind(n: string): string {
  if (EDIT.has(n)) return "e";
  if (READ.has(n)) return "r";
  if (n.startsWith("mcp__lattices__browser") || n.startsWith("mcp__claude-in-chrome") || n === "js") return "b";
  if (COMMS.has(n) || n.startsWith("mcp__scout")) return "m";
  if (n === "WebFetch" || n === "WebSearch") return "w";
  if (CMD.has(n)) return "c";
  return "o";
}
/* ---------- failed tool calls: what the harness itself recorded, nothing guessed ----------
   Claude: a tool_result with is_error true. Codex: a CommandExecution that completed with status "failed" (a non-zero
   exit). Not failures: the operator turning a call down or interrupting it (Claude's rejection text, exit 130 / 143),
   and a search that found nothing (exit 1 from rg / grep / ag as the last command of the line). */
export const INTERRUPT_EXITS = new Set([130, 143]);
const REJECTED = /doesn't want to proceed|tool use was rejected|user rejected|\[Request interrupted/i;
const SEARCH_TAIL = /(?:^|[|;&]\s*|&&\s*)(?:rg|grep|egrep|fgrep|ag|git grep)\b[^|;&]*$/;
export function claudeToolFailed(isError: unknown, text: string): boolean { return isError === true && !REJECTED.test(text || ""); }
export function codexCommandFailed(status: unknown, exit: unknown, command: string): boolean {
  if (status !== "failed") return false;
  const code = typeof exit === "number" ? exit : Number(exit);
  if (Number.isFinite(code) && INTERRUPT_EXITS.has(code)) return false;
  if (code === 1 && SEARCH_TAIL.test((command || "").trim())) return false;
  return true;
}
const errText = (c: unknown): string => typeof c === "string" ? c : Array.isArray(c) ? c.map((x: any) => typeof x === "string" ? x : x?.text || "").join(" ") : "";

export function tilde(p: string, home: string): string { return p.replaceAll(home, "~").replaceAll("/home/arach", "~arach"); }
export function norm(p: string | null, home: string): string | null {
  if (!p) return null;
  p = tilde(p, home).replace(/\/+$/, "");
  const s = p.split("/");
  if (p.includes("/.codex/worktrees/") || p.startsWith("~/Documents/Codex/")) return s.slice(0, 5).join("/");
  if (p.startsWith("~/dev/") || p.startsWith("~arach/dev/")) return s.slice(0, s[2] === "projects" ? 4 : 3).join("/");
  if (p.startsWith("/Users/arach/dev/")) return s.slice(0, 5).join("/");
  return p;
}
export function resolvePath(tgt: string, cwd: string, home: string, fileField = false): string | null {
  if (!tgt || (!fileField && /\s/.test(tgt)) || tgt.includes("://") || tgt.length > 300 || !/[./]/.test(tgt)) return null;
  if (tgt.startsWith("~/")) return join(home, tgt.slice(2));
  if (isAbsolute(tgt)) return tgt;
  return cwd ? join(cwd.startsWith("~/") ? join(home, cwd.slice(2)) : cwd, tgt) : null;
}

/** What a parser carries between chunks of one file: Codex names its cwd once (session_meta / turn_context) and counts
 *  tokens cumulatively, so a tail that reads appended bytes later needs both to read the next lines the same way. */
export type TranscriptCarry = { cwd: string | null; prev: number[]; calls?: [string, string, string][] };
/** sid as the collectors name it: Claude's file uuid head, Codex's rollout tail */
export const transcriptSid = (file: string, harness: string) => harness === "codex" ? basename(file, ".jsonl").slice(-8) : basename(file, ".jsonl").slice(0, 8);

/**
 * One transcript, line by line: the same reading parseTranscript does, for callers that feed it lines themselves (the
 * live tail reads only appended bytes). take() drains what the lines so far produced; carry() is what the next chunk
 * of the same file needs.
 */
export function createTranscriptParser(o: { harness: string; home: string; from: number; sid: string; carry?: TranscriptCarry | null }) {
  const { harness, home, from, sid } = o;
  let raw: Raw[] = [], inbound: Inbound[] = [], usage: Usage[] = [], errs: ToolErr[] = [];
  // Claude's tool_use id → [tool, target]: a result names only the id, often in a later chunk
  const calls = new Map<string, [string, string]>((o.carry?.calls || []).map(([id, n, t]) => [id, [n, t]]));
  const noteCall = (id: unknown, name: string, target: unknown) => {
    if (typeof id !== "string" || !id) return;
    calls.set(id, [name, clip(String(target || ""), 120)]);
    if (calls.size > 400) { let n = 0; for (const k of calls.keys()) { calls.delete(k); if (++n >= 100) break; } }
  };
  const noteErr = (ts: number | null, tool: string, target: string, err: string) => {
    if (ts != null && ts >= from) errs.push([ts, sid, tool || "tool", clip(target, 120), clip(sq(err || ""), 160)]);
  };
  const msgUse = new Map<string, [number | null, any]>();
  let cwd: string | null = o.carry?.cwd ?? null, prev = o.carry?.prev?.length === 4 ? [...o.carry.prev] : [0, 0, 0, 0];
  const add = (ts: number | null, wd: string | null, name: string, target: unknown, delta?: [number, number]) => {
    if (ts == null || ts < from) return;
    const src = String(target || ""), served = clip(src, 400), plain = src.slice(0, 400);
    const row: Raw = [ts, tilde(wd || "", home), harness, sid, name, served, delta];
    if (served !== plain) row[7] = plain;
    raw.push(row);
  };
  const note = (text: string, ts: number | null) => { if (ts != null && ts >= from) inbound.push([ts, sid, clip(text, 8000)]); };
  const noteUsage = (ts: number | null, fresh: number, hit: number, write: number, out: number) => {
    if (ts != null && ts >= from) usage.push([ts, sid, fresh, hit, write, out]);
  };
  function line(line: string): void {
    if (harness === "claude") {
      const toolUse = line.includes('"tool_use"'), hasUsage = line.includes('"usage"') && line.includes('"assistant"');
      // a failed result: the call it answers (by id) gets a failure mark at the result's time
      if (!toolUse && line.includes('"tool_result"') && /"is_error"\s*:\s*true/.test(line)) {
        const ts = ms(line.match(/"timestamp"\s*:\s*"([^"]+)"/)?.[1] || "");
        let items: any[] = [];
        if (line.length < 400000) { try { const o = JSON.parse(line); items = Array.isArray(o.message?.content) ? o.message.content : []; } catch {} }
        else for (const m of line.matchAll(/"tool_use_id"\s*:\s*"([^"]+)"/g)) items.push({ type: "tool_result", is_error: true, tool_use_id: m[1], content: "" });
        for (const c of items) {
          if (c?.type !== "tool_result" || !claudeToolFailed(c.is_error, errText(c.content))) continue;
          const call = calls.get(c.tool_use_id) || ["tool", ""];
          noteErr(ts, call[0], call[1], errText(c.content).slice(0, 2000));
        }
        return;
      }
      // Tool results can contain megabytes of output; they never add dots or
      // native turns or usage. Filter them before JSON.parse, as the study does.
      if (!toolUse && !hasUsage && (line.length >= 400000 || line.includes('"tool_result"') || !line.includes('"user"'))) return;
      let o: any; try { o = JSON.parse(line); } catch { return; }
      if (o.type === "user" && line.length < 400000 && !line.includes('"tool_result"')) {
        const c = o.message?.content;
        const text = typeof c === "string" ? c : Array.isArray(c) ? c.filter((x: any) => x?.type === "text").map((x: any) => x.text).join("\n") : "";
        if (text) note(text, ms(o.timestamp));
        return;
      }
      if (hasUsage && o.message?.id && o.message?.usage) msgUse.set(o.message.id, [ms(o.timestamp), o.message.usage]);
      if (!toolUse) return;
      if (!Array.isArray(o.message?.content)) return;
      for (const c of o.message.content) {
        if (c?.type !== "tool_use") continue;
        const i = c.input || {};
        let t = i.file_path || i.path || i.pattern || i.command || i.url || i.description || i.query || i.selector || i.to || i.target || i.prompt || i.message || "";
        if (Array.isArray(t)) t = t.join(" ");
        noteCall(c.id, c.name || "", t);
        add(ms(o.timestamp), o.cwd, c.name || "", t, claudeDelta(c.name || "", i));
      }
      return;
    }
    const head = line.slice(0, 200);
    if (head.includes('"item_completed"')) {
      if (!line.includes('"CommandExecution"') || !line.includes('"failed"')) return;
      try {
        const o = JSON.parse(line), it = o.payload?.item || {};
        const cmd = Array.isArray(it.command) ? String(it.command[it.command.length - 1] ?? "") : String(it.command || "");
        if (it.type === "CommandExecution" && codexCommandFailed(it.status, it.exit_code, cmd)) {
          const said = String(it.stderr || it.aggregated_output || it.stdout || "").trim().split("\n").slice(-3).join(" ");
          noteErr(ms(o.timestamp), "exec_command", cmd, `exit ${it.exit_code ?? "?"}${said ? " · " + said.slice(0, 1500) : ""}`);
        }
      } catch {}
      return;
    }
    if (head.includes('"token_count"')) {
      try {
        const o = JSON.parse(line), tt = o.payload?.info?.total_token_usage;
        if (tt) {
          const cur = [tt.input_tokens || 0, tt.cached_input_tokens || 0, tt.cache_write_input_tokens || 0, tt.output_tokens || 0];
          if (cur[0] >= prev[0]) {
            const d = cur.map((v, i) => Math.max(0, v - prev[i]));
            if (d[0] || d[3]) noteUsage(ms(o.timestamp), Math.max(0, d[0] - d[1] - d[2]), d[1], d[2], d[3]);
          }
          prev = cur;
        }
      } catch {}
      return;
    }
    if (head.includes("session_meta") || head.includes('"turn_context"')) {
      try { cwd = JSON.parse(line).payload?.cwd || cwd; } catch {}
      return;
    }
    if (/"type"\s*:\s*"(?:function_call_output|custom_tool_call_output|reasoning)"/.test(head)) return;
    if (!line.includes('"user_message"') && !line.includes('"user"') && !line.includes("function_call") && !line.includes("custom_tool_call")) return;
    let o: any; try { o = JSON.parse(line); } catch { return; }
    const p = o.payload || {}, ts = ms(o.timestamp);
    if (p.type === "user_message" && p.message) { note(String(p.message), ts); return; }
    if (p.type === "message" && p.role === "user") {
      const text = (p.content || []).filter((x: any) => x?.type === "input_text").map((x: any) => x.text).join("\n");
      if (text) note(text, ts);
      return;
    }
    if (p.type !== "function_call" && p.type !== "custom_tool_call") return;
    const n: string = p.name || "", a = p.arguments ?? p.input ?? "", as = typeof a === "string" ? a : JSON.stringify(a);
    // Patch paths occupy a whole first line, including spaces. JSON/JS cells may escape newlines.
    if (n === "apply_patch" || as.slice(0, 400).includes("apply_patch")) {
      const files = [...as.matchAll(/\*\*\* (?:Update|Add|Delete) File: (.*?)(?=\\n|\r?\n|$)/g)].map(m => m[1].trim());
      const deltas = patchDeltas(patchText(as));
      files.slice(0, 6).forEach(fp => add(ts, cwd, "apply_patch", fp, deltas.get(fp)));
      if (files.length) return;
    }
    if (n === "exec" && typeof a === "string") {
      const inner = [...a.matchAll(/tools\.(\w+)\(/g)];
      for (const m of inner.slice(0, 12)) {
        const seg = a.slice(m.index! + m[0].length, m.index! + m[0].length + 600);
        const v = seg.match(/\b(?:cmd|url|selector|file_path|path|target|query|text)"?\s*:\s*"((?:[^"\\]|\\.)*)"/);
        let t = ""; if (v) { try { t = JSON.parse(`"${v[1]}"`); } catch { t = v[1]; } }
        const wd = seg.match(/workdir"?\s*:\s*"([^"]+)"/);
        add(ts, wd ? wd[1] : cwd, m[1], t);
      }
      if (!inner.length) add(ts, cwd, "js", a.trim().split("\n")[0]);
      return;
    }
    let t = "";
    try {
      const j = typeof a === "object" ? a : a.startsWith("{") ? JSON.parse(a) : {};
      const c = j.cmd || j.command || j.target || j.url || j.selector || j.path || (Array.isArray(j.targets) ? j.targets.join(",") : "") || "";
      t = Array.isArray(c) ? c.join(" ") : String(c);
    } catch { t = as; }
    add(ts, cwd, n, t);
  }
  return {
    line,
    /** what the lines so far produced; Claude's usage lands here (deduped by message id within what was fed) */
    take(): ParsedTranscript {
      for (const [ts, u] of msgUse.values()) noteUsage(ts, u.input_tokens || 0, u.cache_read_input_tokens || 0, u.cache_creation_input_tokens || 0, u.output_tokens || 0);
      msgUse.clear();
      const out = { raw, inbound, usage, errs }; raw = []; inbound = []; usage = []; errs = [];
      return out;
    },
    carry(): TranscriptCarry { return { cwd, prev: [...prev], calls: [...calls].slice(-64).map(([id, [n, t]]) => [id, n, t] as [string, string, string]) }; },
  };
}

/** Streams JSONL and yields CPU work at least every ~8ms, including huge rollouts. */
export async function parseTranscript(file: string, harness: string, home: string, from: number, sidOverride?: string): Promise<ParsedTranscript> {
  const parser = createTranscriptParser({ harness, home, from, sid: sidOverride ?? transcriptSid(file, harness) });
  let yieldedAt = performance.now();
  const stream = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (performance.now() - yieldedAt >= 8) { await yieldLoop(); yieldedAt = performance.now(); }
      parser.line(line);
    }
  } finally { lines.close(); stream.destroy(); }
  return parser.take();
}
