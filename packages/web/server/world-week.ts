/** World · Modale's packed study contract, assembled from read-only sources. */
import { Database } from "bun:sqlite";
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setImmediate as yieldLoop } from "node:timers/promises";
import { loadMachines } from "./core/machines/service.ts";
import { readWorldBrokerSnapshot, type WorldBrokerSnapshot } from "./db/world.ts";
import { ART, COLD_MIN, DAY, kind, NOISE, norm, parseTranscript, redact, resolvePath, sq, squash, TEXTY, tilde, type Inbound, type ParsedTranscript, type Raw, type ToolErr, type Usage } from "./world-transcript.ts";
import { deliveryState } from "./world-broker-rows.ts";
import { createWorldFilePolicy, type WorldFilePolicy } from "./world-files.ts";

export type WorldActor = {
  i: number; id: string; name: string; kind: string; node: string | null;
  branch: string | null; cls: string | null; project: string | null;
  root: string | null; harness: string | null;
};
export type WorldHost = { name: string; platform: string; self: boolean; seen: number | null; tailnet: boolean; caps: string[] };
// [opened, closed, state o|c|f, requester, target, task, error, what it is — "b" a broker ask, "t" an operator turn,
//  "s" a subagent (absent on older builds)]. Only a broker ask can be STUCK: it is waiting on a reply; a turn is work.
export type WorldAsk = [number, number | null, string, number, number, string, string, ("b" | "t" | "s")?];
export type WorldFile = [string, string, number, number, number, number, number];
export type WorldWork = {
  s: number; t0: number; t1: number; n: number; task: string;
  files: WorldFile[]; urls: [string, number][]; cmds: string[];
};
export type WorldWeekPayload = {
  now: number; from: number; actors: WorldActor[]; asks: WorldAsk[];
  msgs: [number, number, string][]; hosts: WorldHost[];
  // [secs, root, kind, session, tool, target, file] plus [lines added, lines removed] on edits that carry a size
  events: ([number, number, string, number, number, number, number] | [number, number, string, number, number, number, number, number, number])[];
  strs: string[]; sessions: [string, string, string, [number, number][]][];
  work: Record<number, WorldWork>; allow: string[];
  /** FAILED / STUCK: failed tool calls [secs, session, tool, target, error] and undelivered messages (same rows as the team week) */
  errs?: [number, number, number, number, number][]; dlv?: [number, number | null, string, number, string, string, string][];
  roots: Record<string, [string, string]>;
  quota: { p: string; l: string; pts: [number, number][] }[];
  usage: Record<number, [number, number, number, number, number][]>;
  usageLoose: Record<string, [number, number, number, number, number][]>;
  colds: [number, number, number][];
};
type TranscriptEntry = ParsedTranscript & { size: number; mtime: number };
export function worldDays(value: string | number | undefined): number {
  const n = Number(value ?? 7);
  return Number.isFinite(n) && n > 0 ? Math.min(14, Math.max(1, Math.floor(n))) : 7;
}

async function resolveRoot(root: string, home: string): Promise<[string, string] | null> {
  const abs = root.startsWith("~/") ? join(home, root.slice(2)) : root;
  const codexWt = root.match(/\/\.codex\/worktrees\/[^/]+\/([^/]+)$/);
  const exists = (p: string) => stat(p).then(() => true).catch(() => false);
  if (!await exists(join(abs, ".git")) && !codexWt) return null;
  const git = (...args: string[]) => new Promise<string>(resolve => {
    try {
      execFile("git", ["-C", abs, ...args], { timeout: 1500, killSignal: "SIGKILL", maxBuffer: 64 * 1024 }, (error, stdout) => resolve(error ? "" : stdout.trim()));
    } catch { resolve(""); }
  });
  const present = await exists(abs), common = present ? await git("rev-parse", "--path-format=absolute", "--git-common-dir") : "";
  if (common && common !== join(abs, ".git")) return [tilde(dirname(common), home), await git("branch", "--show-current")];
  if (codexWt && !present && await exists(join(home, "dev", codexWt[1]))) return [`~/dev/${codexWt[1]}`, ""];
  return null;
}
export function readQuota(home: string, from: number): WorldWeekPayload["quota"] {
  let db: Database | undefined;
  try {
    db = new Database(join(home, ".openscout/control-plane/web-state.sqlite"), { readonly: true });
    const rows = db.query("select provider, label, captured_at, used_percent from budget_quota_window_snapshots where captured_at > ? and used_percent is not null and provider != 'github' order by captured_at").all(from) as { provider: string; label: string; captured_at: number; used_percent: number }[];
    const by = new Map<string, WorldWeekPayload["quota"][number]>();
    for (const r of rows) {
      const key = r.provider + "|" + r.label;
      let q = by.get(key); if (!q) { q = { p: r.provider, l: r.label, pts: [] }; by.set(key, q); }
      q.pts.push([Math.round((r.captured_at - from) / 1000), Math.round(r.used_percent * 10) / 10]);
    }
    return [...by.values()];
  } catch { return []; } finally { db?.close(); }
}


export type WorldWeekOptions = {
  home?: string; now?: () => number; ttlMs?: number;
  readBroker?: (from: number) => WorldBrokerSnapshot | Promise<WorldBrokerSnapshot>;
  readHosts?: () => Promise<WorldHost[]>;
};
export function createWorldWeekService(options: WorldWeekOptions = {}) {
  const home = options.home ?? homedir(), clock = options.now ?? Date.now, ttl = options.ttlMs ?? 45_000;
  const transcripts = new Map<string, TranscriptEntry>();
  const rootCache = new Map<string, Promise<[string, string] | null>>();
  const readRoot = (root: string) => {
    let result = rootCache.get(root);
    if (!result) { result = resolveRoot(root, home); rootCache.set(root, result); }
    return result;
  };
  const payloads = new Map<number, { at: number; payload: WorldWeekPayload; allow: Set<string>; policy: WorldFilePolicy; json: string }>();
  let flight: Promise<void> | null = null, currentDays = 7, hosts: WorldHost[] = [];
  const metrics = { parsedFiles: 0, reusedFiles: 0, builds: 0 };
  async function scan(now: number, days: number): Promise<ParsedTranscript> {
    const raw: Raw[] = [], inbound: Inbound[] = [], usage: Usage[] = [], errs: ToolErr[] = [], seen = new Set<string>();
    for (const [harness, dir] of [["claude", join(home, ".claude/projects")], ["codex", join(home, ".codex/sessions")]]) {
      try {
        for await (const rel of new Bun.Glob("**/*.jsonl").scan({ cwd: dir, onlyFiles: true })) {
          const file = join(dir, rel);
          let st; try { st = await stat(file); } catch { continue; }
          if (st.mtimeMs < now - days * DAY) continue;
          seen.add(file);
          let parsed = transcripts.get(file);
          if (!parsed || parsed.size !== st.size || parsed.mtime !== st.mtimeMs) {
            let data; try { data = await parseTranscript(file, harness, home, now - 14 * DAY); } catch { continue; }
            parsed = { ...data, size: st.size, mtime: st.mtimeMs };
            transcripts.set(file, parsed); metrics.parsedFiles++;
          } else { metrics.reusedFiles++; }
          // Avoid argument-count limits on large rollouts.
          for (const r of parsed.raw) raw.push(r);
          for (const t of parsed.inbound) inbound.push(t);
          for (const u of parsed.usage) usage.push(u);
          for (const e of parsed.errs || []) errs.push(e);
          await yieldLoop();
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    for (const path of transcripts.keys()) if (!seen.has(path)) transcripts.delete(path);
    return { raw, inbound, usage, errs };
  }
  async function build(days: number): Promise<void> {
    const now = clock(), from = now - days * DAY;
    const readHosts = options.readHosts ?? (async () => {
      const { machines } = await loadMachines();
      return machines.filter(m => m.platform !== "unknown" && m.name !== "arts mini")
        .map(m => ({ name: m.name, platform: m.platform, self: m.name === "arts-mini", seen: m.lastSeenAt, tailnet: !!m.tailnetId, caps: m.capabilities || [] }));
    });
    const [broker, scanned, roster] = await Promise.all([
      (options.readBroker ?? readWorldBrokerSnapshot)(from), scan(now, days), readHosts().catch(() => hosts),
    ]);
    hosts = roster;
    const { payload, policy } = await assembleWorldWeek({ home, now, from, broker, scanned, hosts, readRoot });
    // Serialize once per refresh, rather than blocking the loop on every warm request.
    const json = JSON.stringify(payload);
    payloads.set(days, { at: clock(), payload, allow: new Set(payload.allow), policy, json }); metrics.builds++;
  }
  async function get(days = 7) {
    days = worldDays(days);
    for (;;) {
      const cached = payloads.get(days);
      if (cached && clock() - cached.at < ttl) { currentDays = days; return cached; }
      if (flight) { await flight; continue; }
      const pending = build(days);
      flight = pending;
      try { await pending; } finally { if (flight === pending) flight = null; }
    }
  }
  return {
    get: async (days = 7) => (await get(days)).payload,
    json: async (days = 7) => (await get(days)).json,
    allowed: async () => (await get(currentDays)).allow,
    /** The realpath to preview, or null: in this week's allow list AND, re-checked now on the realpath, inside an
     *  approved root and off the deny list (see world-files.ts). */
    previewable: async (p: unknown): Promise<string | null> => {
      const { allow, policy } = await get(currentDays);
      return typeof p === "string" && allow.has(p) ? policy.check(p) : null;
    },
    metrics: () => ({ ...metrics, cachedFiles: transcripts.size }),
  };
}

async function assembleWorldWeek(input: {
  home: string; now: number; from: number; broker: WorldBrokerSnapshot; scanned: ParsedTranscript; hosts: WorldHost[];
  readRoot: (root: string) => Promise<[string, string] | null>;
}): Promise<{ payload: WorldWeekPayload; policy: WorldFilePolicy }> {
  const { home, now, from, broker, scanned, hosts } = input;
  const actorRows = new Map(broker.actors.map(a => [a.id, a])), agentRows = new Map(broker.agents.map(a => [a.id, a]));
  const actors = new Map<string, WorldActor>(), order: WorldActor[] = [];
  const actor = (id: string): number => {
    const hit = actors.get(id); if (hit) return hit.i;
    const row = actorRows.get(id), ag = agentRows.get(id);
    let md: Record<string, any> = {}; try { md = JSON.parse(ag?.metadata_json || row?.metadata_json || "{}") || {}; } catch {}
    const a: WorldActor = {
      i: order.length, id, name: row?.display_name || id, kind: row?.kind || "?",
      node: ag?.node_qualifier || md.node || null, branch: ag?.workspace_qualifier || null, cls: ag?.agent_class || null,
      project: md.project || null, root: md.projectRoot ? norm(md.projectRoot, home) : null,
      harness: md.harness || md.defaultHarness || md.runtime || null,
    };
    actors.set(id, a); order.push(a); return a.i;
  };
  // every served string is redacted before it is capped; inbound turns and targets arrive redacted from parseTranscript
  const askRows = broker.asks.map(r => ({ ...r, task: redact(r.task || ""), error: r.error ? redact(r.error) : r.error }));
  // every local ask is a broker invocation ("b"): the only kind that can be STUCK
  const asks: WorldAsk[] = askRows.map(r => [r.created_at, r.completed_at, r.state === "completed" ? "c" : r.state === "failed" ? "f" : "o", actor(r.requester_id), actor(r.target_agent_id), squash(r.task, 96), squash(r.error, 70), "b"]);
  const msgs: [number, number, string][] = broker.messages.map(r => [r.created_at, actor(r.actor_id), String(r.class || "").slice(0, 1)]);
  const askKeys = askRows.map((r, i) => ({ i, at: r.created_at, key: sq(r.task || "").slice(0, 44) })).filter(k => k.key.length >= 24);
  const received = new Map<number, { sid: string; ts: number }>(), turns = new Map<string, [number, string][]>();
  let yieldedAt = performance.now();
  const yieldIfNeeded = async () => { if (performance.now() - yieldedAt >= 8) { await yieldLoop(); yieldedAt = performance.now(); } };
  for (const [ts, sid, text] of scanned.inbound) {
    if (ts < from) continue;
    const t = sq(text);
    let delivered = false;
    for (const k of askKeys) {
      if (ts < k.at - 120e3 || !t.includes(k.key)) continue;
      const prev = received.get(k.i); if (!prev || ts < prev.ts) received.set(k.i, { sid, ts });
      delivered = true; break;
    }
    if (!delivered) {
      const said = text.trim();
      if (said && !NOISE.test(said)) {
        const list = turns.get(sid) || []; turns.set(sid, list);
        const t280 = sq(said).slice(0, 280);
        if (list.length < 60 && !list.some(([, x]) => x === t280)) list.push([ts, t280]);
      }
    }
    await yieldIfNeeded();
  }
  const strs: string[] = [], strIdx = new Map<string, number>();
  const S = (x: string): number => { x = x || ""; let i = strIdx.get(x); if (i == null) { i = strs.length; strIdx.set(x, i); strs.push(x); } return i; };
  const sessions: [string, string, string][] = [], sessIdx = new Map<string, number>();
  const SS = (sid: string, h: string, r: string): number => { let i = sessIdx.get(sid); if (i == null) { i = sessions.length; sessIdx.set(sid, i); sessions.push([sid, h, r]); } return i; };
  const raw = scanned.raw.filter(r => r[0] >= from && r[0] <= now).sort((a, b) => a[0] - b[0]);
  const stats = new Map<string, Promise<{ size: number; mtimeMs: number } | null>>(), dotFiles = new Set<string>();
  const fileStat = (p: string) => {
    let result = stats.get(p);
    if (!result) { result = stat(p).then(st => st.isFile() ? st : null).catch(() => null); stats.set(p, result); }
    return result;
  };
  const events: WorldWeekPayload["events"] = [];
  // a path that itself reads as a secret is not named in the payload
  const pathOk = (p: string | null): p is string => !!p && redact(p) === p;
  const cwds = new Set<string>();
  for (const [ts, cwd, h, sid, name, tgt, delta, plain] of raw) {
    const r = norm(cwd, home) || "~", k = kind(name);
    if (cwd) cwds.add(cwd);
    const t = tgt.replace(/\s+/g, " ").replaceAll(home + "/", "~/").slice(0, 110);
    let file = -1;
    if (k === "e" || k === "r") {
      // paths resolve on the unredacted target, which never leaves the server
      const abs = resolvePath((plain ?? tgt).split(/\\n|\n/)[0].trim(), cwd, home, true);
      if (pathOk(abs) && await fileStat(abs)) { file = S(abs); dotFiles.add(abs); }
    }
    const at = Math.round((ts - from) / 1000);
    events.push(k === "e" && delta ? [at, S(r), k, SS(sid, h, r), S(name), S(t), file, delta[0], delta[1]] : [at, S(r), k, SS(sid, h, r), S(name), S(t), file]);
    await yieldIfNeeded();
  }
  const work: Record<number, WorldWork> = {}, bySess = new Map<string, Raw[]>();
  for (const r of raw) { const list = bySess.get(r[3]) || []; list.push(r); bySess.set(r[3], list); }
  for (const [ai, hit] of received) {
    const r = askRows[ai], t1 = r.completed_at || Math.min(now, hit.ts + 3 * 36e5);
    const calls = (bySess.get(hit.sid) || []).filter(e => e[0] >= hit.ts && e[0] <= t1 + 60e3);
    const files = new Map<string, { abs: string; e: number; r: number }>(), urls = new Map<string, number>(), cmds: string[] = [];
    const noteFile = (abs: string, edited: boolean) => { const f = files.get(abs) || { abs, e: 0, r: 0 }; if (edited) f.e++; else f.r++; files.set(abs, f); };
    for (const [, cwd, , , name, tgt, , plain] of calls) {
      const k = kind(name), src = plain ?? tgt;
      if (k === "c" && tgt) {
        if (cmds.length < 40) cmds.push(tgt.replace(/\s+/g, " ").slice(0, 110));
        for (const m of src.matchAll(/(?:^|[\s'"=])((?:~|\.{0,2}\/|[\w@-]+\/)[\w@./-]*\.[A-Za-z0-9]{1,5})(?=$|[\s'":;)])/g)) {
          const abs = resolvePath(m[1], cwd, home); if (pathOk(abs) && await fileStat(abs)) noteFile(abs, false);
        }
      } else if (/^https?:\/\//.test(tgt)) {
        const url = tgt.slice(0, 160); urls.set(url, (urls.get(url) || 0) + 1);
      } else if (k === "e" || k === "r" || ART.test(tgt)) {
        const abs = resolvePath(src.split(/\\n|\n/)[0].trim(), cwd, home, k === "e" || k === "r");
        if (pathOk(abs)) noteFile(abs, k === "e");
      }
      await yieldIfNeeded();
    }
    const fileRows: WorldFile[] = [];
    for (const f of files.values()) {
      const st = await fileStat(f.abs);
      fileRows.push([tilde(f.abs, home), f.abs, f.e, f.r, st?.size ?? -1, st?.mtimeMs ?? 0, ART.test(f.abs) && !TEXTY.test(f.abs.replace(/\.(md|json|txt|csv|html?)$/i, "")) ? 1 : 0]);
    }
    fileRows.sort((a, b) => b[2] - a[2] || b[3] - a[3]);
    work[ai] = { s: SS(hit.sid, "", ""), t0: hit.ts, t1, n: calls.length, task: sq(r.task || "").slice(0, 1600), files: fileRows, urls: [...urls.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20), cmds };
  }
  const roots: WorldWeekPayload["roots"] = {};
  const laneRoots = new Set(events.map(e => strs[e[1]]));
  for (const root of laneRoots) {
    const lane = await input.readRoot(root); if (lane) roots[root] = lane;
  }
  // previews: only files whose realpath sits inside a session cwd or repo root seen this week, off the deny list
  const policy = await createWorldFilePolicy(home, [...cwds, ...laneRoots, ...Object.values(roots).map(v => v[0])]);
  const allow: string[] = [];
  for (const p of new Set([...Object.values(work).flatMap(w => w.files.filter(f => f[4] >= 0).map(f => f[1])), ...dotFiles])) {
    if (await policy.check(p)) allow.push(p);
  }
  const quota = readQuota(home, from);
  // Keep timestamped samples in the transcript cache; hour buckets move with the window.
  const usage = new Map<string, Map<number, [number, number, number, number]>>(), colds: [number, string, number][] = [];
  for (const [ts, sid, fresh, hit, write, out] of scanned.usage) {
    if (ts < from || ts > now) continue;
    const hr = Math.floor((ts - from) / 36e5);
    let m = usage.get(sid); if (!m) usage.set(sid, m = new Map());
    const b = m.get(hr) || [0, 0, 0, 0]; b[0] += fresh; b[1] += hit; b[2] += write; b[3] += out; m.set(hr, b);
    const rebuilt = fresh + write;
    if (rebuilt >= COLD_MIN && hit < rebuilt) colds.push([ts, sid, rebuilt]);
    await yieldIfNeeded();
  }
  const usageOut: WorldWeekPayload["usage"] = {}, usageLoose: WorldWeekPayload["usageLoose"] = {};
  for (const [sid, m] of usage) {
    const rows = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([h, b]): [number, number, number, number, number] => [h, ...b]);
    const i = sessIdx.get(sid);
    if (i != null) usageOut[i] = rows; else usageLoose[sid] = rows;
  }
  const coldsOut: WorldWeekPayload["colds"] = colds.filter(c => sessIdx.has(c[1])).sort((a, b) => a[0] - b[0]).map(([ts, sid, n]) => [Math.round((ts - from) / 1000), sessIdx.get(sid)!, n]);
  const sessionsOut: WorldWeekPayload["sessions"] = sessions.map(([sid, h, r]) => [sid, h, r, (turns.get(sid) || []).sort((a, b) => a[0] - b[0]).map(([ts, t]) => [Math.round((ts - from) / 1000), S(t)])]);
  // trouble, as the team week carries it (world-team.ts): failed tool calls on sessions this week saw, undelivered messages
  const errs: NonNullable<WorldWeekPayload["errs"]> = [];
  for (const [ts, sid, tool, target, err] of scanned.errs || []) {
    const i = sessIdx.get(sid); if (i == null || ts < from || ts > now) continue;
    errs.push([Math.round((ts - from) / 1000), i, S(tool), S(target.replaceAll(home + "/", "~/").slice(0, 72)), S(squash(err, 120))]);
  }
  errs.sort((a, b) => a[0] - b[0]);
  const dlv: NonNullable<WorldWeekPayload["dlv"]> = (broker.deliveries || []).map(d => [d.created_at, d.done_at, deliveryState(d.status), actor(d.from || "system"), squash(d.to_name || d.to, 60), squash(d.text, 96), squash(d.error || "", 90)]);
  return { payload: { now, from, actors: order, asks, msgs, hosts, events, strs, sessions: sessionsOut, work, allow, roots, quota, usage: usageOut, usageLoose, colds: coldsOut, errs, dlv }, policy };
}
