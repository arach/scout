/**
 * World · Team: the operator's own machines as a team. Each machine is one teammate (a persona named in hosts.json),
 * and everything they did comes from that machine's real logs — Claude and Codex transcripts, the broker's asks and
 * messages, git worktrees and branches, and the operator's PRs from gh. Nothing is generated: only the persona names
 * are new, and every row still carries the real host it happened on.
 *
 *   collectTeam()   ssh to each host, run world-hosts.ts there (bundled, piped into `bun run -`), cache one compact
 *                   snapshot per host under ~/.scout/world-team/snapshots; an unreachable host keeps its last one, stale
 *   buildTeamWeek() snapshots → the world-week payload the HUD already reads (?data=team), no HUD change needed
 *   createTeamWeekService()  what /api/ops/world-week?data=team serves: rebuilt when a snapshot, prs.json or hosts.json changes
 *
 * Refresh: bun design/studio/scripts/world-team.ts --hosts
 */
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { collectHost, teamRoot, type HostBrokerActor, type HostSnapshot } from "./world-hosts.ts";
import { deliveryState } from "./world-broker-rows.ts";
import { ART, DAY, kind, NOISE, norm, resolvePath, sq, squash, TEXTY, tilde, COLD_MIN, type Raw } from "./world-transcript.ts";
import type { WorldActor, WorldAsk, WorldFile, WorldHost, WorldWeekPayload, WorldWork } from "./world-week.ts";

/* ---------- config: hosts.json ---------- */
export type TeamHostConfig = { host: string; persona: string; ssh?: string | null; platform?: string };
/** Plain names derived from the host. `ssh: null` means this machine: collected in-process, its files previewable. */
export const DEFAULT_TEAM_HOSTS: TeamHostConfig[] = [
  { host: "arts-mini", persona: "Art", ssh: null, platform: "macos" },
  { host: "mini", persona: "Mini", ssh: "mini", platform: "macos" },
  { host: "air", persona: "Air", ssh: "air", platform: "macos" },
  { host: "archie", persona: "Archie", ssh: "arach@archie", platform: "linux" },
];
export const teamDir = (home = homedir()) => join(home, ".scout/world-team");
/** A host with no persona configured reads as its own name, capitalised: never an invented nickname. */
export const defaultPersona = (host: string) => { const w = host.split(/[-_.]/)[0] || host; return w[0].toUpperCase() + w.slice(1); };
export function mergeTeamConfig(file: { hosts?: Partial<TeamHostConfig>[] } | null): TeamHostConfig[] {
  const listed = (file?.hosts || []).filter((h): h is Partial<TeamHostConfig> & { host: string } => !!h && typeof h.host === "string" && !!h.host);
  if (!listed.length) return DEFAULT_TEAM_HOSTS.map(h => ({ ...h }));
  return listed.map(h => {
    const base = DEFAULT_TEAM_HOSTS.find(d => d.host === h.host);
    return { host: h.host, persona: (h.persona || base?.persona || defaultPersona(h.host)).trim(), ssh: h.ssh !== undefined ? h.ssh : base ? base.ssh : h.host, platform: h.platform || base?.platform || "macos" };
  });
}
export async function readTeamConfig(dir = teamDir()): Promise<TeamHostConfig[]> {
  try { return mergeTeamConfig(JSON.parse(await readFile(join(dir, "hosts.json"), "utf8"))); } catch { return mergeTeamConfig(null); }
}

/* ---------- snapshots on disk ---------- */
export type TeamSnapshot = HostSnapshot & { stale?: boolean; error?: string };
// gh rows per GitHub repo: [number, created ms, merged ms | null, closed ms | null, title, head branch, url]
export type TeamPrs = { at: number; login: string; repos: Record<string, [number, number, number | null, number | null, string, string, string][]> };
async function writeAtomic(file: string, text: string) { const tmp = `${file}.${process.pid}.tmp`; await writeFile(tmp, text); await rename(tmp, file); }
async function readJson<T>(file: string): Promise<T | null> { try { return JSON.parse(await readFile(file, "utf8")) as T; } catch { return null; } }
export async function readSnapshots(dir = teamDir(), config?: TeamHostConfig[]): Promise<TeamSnapshot[]> {
  const hosts = config ?? await readTeamConfig(dir), out: TeamSnapshot[] = [];
  for (const h of hosts) { const s = await readJson<TeamSnapshot>(join(dir, "snapshots", `${h.host}.json`)); if (s && Array.isArray(s.raw)) out.push(s); }
  return out;
}

/* ---------- collect: every host in parallel, each bounded; a host that fails keeps its last snapshot, marked stale ---------- */
export type CollectResult = { host: string; ok: boolean; stale: boolean; error?: string; ms: number; at: number | null };
async function bundleCollector(): Promise<string> {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, "world-hosts.ts")], target: "bun", minify: true });
  if (!built.success) throw new Error("could not bundle world-hosts.ts: " + built.logs.map(l => l.message).join("; "));
  return await built.outputs[0].text();
}
async function sshCollect(h: TeamHostConfig, script: string, now: number, days: number, timeoutMs: number): Promise<HostSnapshot> {
  // the collector runs from /tmp so a stray package.json in $HOME is never read; it writes nothing on the host
  const remote = `cd /tmp && export PATH="$HOME/.bun/bin:$PATH" && WORLD_HOSTS_COLLECT=1 WORLD_HOSTS_NAME=${h.host.replace(/[^\w.-]/g, "")} WORLD_HOSTS_NOW=${now} WORLD_HOSTS_DAYS=${days} bun run -`;
  const proc = Bun.spawn(["ssh", "-o", "ConnectTimeout=8", "-o", "BatchMode=yes", "-o", "ServerAliveInterval=15", h.ssh!, remote], { stdin: new Blob([script]), stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
  try {
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) throw new Error((err.trim().split("\n").pop() || `ssh exited ${code}`).slice(0, 200));
    const snap = JSON.parse(out) as HostSnapshot;
    if (!Array.isArray(snap.raw)) throw new Error("collector returned no rows");
    return { ...snap, host: h.host };
  } finally { clearTimeout(timer); }
}
async function fetchPrs(snapshots: TeamSnapshot[], from: number, previous: TeamPrs | null): Promise<TeamPrs> {
  const gh = async (args: string[]) => {
    const p = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "ignore" });
    const timer = setTimeout(() => p.kill("SIGKILL"), 30_000);
    try { const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]); return code === 0 ? out : null; } finally { clearTimeout(timer); }
  };
  const login = (await gh(["api", "user", "-q", ".login"]))?.trim() || previous?.login || "";
  const repos = new Set<string>();
  for (const s of snapshots) for (const r of Object.values(s.repos || {})) { const slug = githubSlug(r.origin); if (slug) repos.add(slug); }
  const out: TeamPrs = { at: Date.now(), login, repos: {} };
  const since = new Date(from).toISOString().slice(0, 10), list = [...repos];
  for (let i = 0; i < list.length; i += 6) await Promise.all(list.slice(i, i + 6).map(async slug => {
    const text = await gh(["pr", "list", "--repo", slug, "--state", "all", "--limit", "300", "--search", `created:>=${since}${login ? ` author:${login}` : ""}`, "--json", "number,createdAt,mergedAt,closedAt,title,headRefName,url"]);
    if (text == null) { if (previous?.repos[slug]) out.repos[slug] = previous.repos[slug]; return; }
    const t = (x: string | null) => x ? Date.parse(x) : null;
    out.repos[slug] = (JSON.parse(text || "[]") as any[]).map(p => [p.number, Date.parse(p.createdAt), t(p.mergedAt), p.mergedAt ? null : t(p.closedAt), String(p.title || "").slice(0, 120), String(p.headRefName || "").slice(0, 80), String(p.url || "")]);
  }));
  return out;
}
export function githubSlug(origin: string): string | null {
  const m = (origin || "").match(/github\.com[:/]+([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}
export async function collectTeam(opts: { dir?: string; days?: number; now?: number; timeoutMs?: number; only?: string[]; prs?: boolean; log?: (line: string) => void } = {}): Promise<CollectResult[]> {
  const dir = opts.dir ?? teamDir(), days = opts.days ?? 7, now = opts.now ?? Date.now(), log = opts.log ?? (() => {});
  await mkdir(join(dir, "snapshots"), { recursive: true });
  // hosts.json is the operator's to edit: written once with the plain defaults, never overwritten
  if (!await stat(join(dir, "hosts.json")).catch(() => null)) await writeFile(join(dir, "hosts.json"), JSON.stringify({ hosts: DEFAULT_TEAM_HOSTS }, null, 2) + "\n");
  const config = await readTeamConfig(dir), script = await bundleCollector();
  const results = await Promise.all(config.filter(h => !opts.only || opts.only.includes(h.host)).map(async (h): Promise<CollectResult> => {
    const t0 = Date.now(), file = join(dir, "snapshots", `${h.host}.json`);
    try {
      const snap = h.ssh ? await sshCollect(h, script, now, days, opts.timeoutMs ?? 300_000) : { ...await collectHost({ now, days, host: h.host }), host: h.host };
      await writeAtomic(file, JSON.stringify(snap));
      log(`${h.host}: ${snap.sessions.length} sessions · ${snap.raw.length} calls · ${snap.broker?.asks.length ?? 0} broker asks · ${Object.keys(snap.roots).length} worktree roots · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return { host: h.host, ok: true, stale: false, ms: Date.now() - t0, at: snap.at };
    } catch (error) {
      const last = await readJson<TeamSnapshot>(file), msg = (error as Error).message || String(error);
      if (last) { last.stale = true; last.error = msg; await writeAtomic(file, JSON.stringify(last)); }
      log(`${h.host}: unreachable (${msg}) · ${last ? `kept the snapshot from ${new Date(last.at).toISOString()}, stale` : "no snapshot yet"}`);
      return { host: h.host, ok: false, stale: !!last, error: msg, ms: Date.now() - t0, at: last?.at ?? null };
    }
  }));
  if (opts.prs === false) return results;
  const snapshots = await readSnapshots(dir, config);
  const prev = await readJson<TeamPrs>(join(dir, "prs.json"));
  const prs = await fetchPrs(snapshots, now - days * DAY, prev);
  await writeAtomic(join(dir, "prs.json"), JSON.stringify(prs));
  log(`prs: ${Object.values(prs.repos).reduce((n, r) => n + r.length, 0)} by ${prs.login || "?"} across ${Object.keys(prs.repos).length} repos`);
  return results;
}

/* ---------- lanes: the real repo or project behind each session, openscout split by its top-level areas ---------- */
// Lane keys are project names, not paths: one project checked out at different paths on different machines
// (~/dev/fab on mini, ~/dev/projects/fab on archie) is one lane. The real paths stay on every event and worktree.
export const OTHER_LANE = "other";
export const TEAM_LANES = 6;
/** apps/ios, packages/web, design/studio, landing, docs … — null for files at the repo's top level or odd segments */
export function openscoutArea(rel: string): string | null {
  const s = rel.split("/").filter(Boolean);
  if (s.length < 2 || s[0].startsWith(".") || !/^[\w@-][\w.@-]*$/.test(s[0]) || !/^[\w.@-]+$/.test(s[1])) return null;
  if ((s[0] === "apps" || s[0] === "packages" || s[0] === "design") && s.length >= 3) return `${s[0]}/${s[1]}`;
  if (s[0] === "apps" || s[0] === "packages" || s[0] === "design") return null;
  return s[0];
}
/** The project a checkout belongs to, by the folder's name: "~/dev/projects/fab" → "fab"; home itself stays "~" */
export const projectKey = (repo: string) => repo === "~" ? "~" : repo.split("/").filter(Boolean).pop() || repo;
const isOpenscout = (repo: string) => projectKey(repo) === "openscout";
// area names in shell commands that never name a file (rg -n foo packages/web, ls apps/ios)
const AREA_IN_CMD = /(?:^|[\s'"=/])((?:apps|packages|design)\/[\w@-][\w.@-]*|landing|docs)(?=\/|[\s'":;)]|$)/g;
const CMD_PATH = /(?:^|[\s'"=])((?:~|\.{0,2}\/|[\w@-]+\/)[\w@./-]*\.[A-Za-z0-9]{1,5})(?=$|[\s'":;)])/g;
/** The lane a session belongs to, before the small ones fold into "other": its project (worktrees count as the repo
 *  they were cut from); for openscout, the area its edits, reads and commands point at most, else the generic lane. */
export function sessionLane(raw: Raw[], home: string, rootsOf: Record<string, [string, string]>): { root: string; repo: string; lane: string } {
  const cwds = new Map<string, number>();
  for (const r of raw) { const k = teamRoot(r[1], home); cwds.set(k, (cwds.get(k) || 0) + 1); }
  const root = [...cwds.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "~";
  // a Claude Code worktree that is gone from disk still says which repo it was cut from
  const repo = rootsOf[root]?.[0] || root.match(/^(.*)\/\.claude\/worktrees\/[^/]+$/)?.[1] || root;
  if (!isOpenscout(repo)) return { root, repo, lane: projectKey(repo) };
  const rootAbs = root.startsWith("~/") ? join(home, root.slice(2)) : root;
  const votes = new Map<string, number>(), add = (a: string | null, w: number) => { if (a) votes.set(a, (votes.get(a) || 0) + w); };
  const vote = (abs: string | null, w: number) => { if (abs && abs.startsWith(rootAbs + "/")) add(openscoutArea(abs.slice(rootAbs.length + 1)), w); };
  for (const [, cwd, , , name, tgt] of raw) {
    const k = kind(name), cwdAbs = cwd.startsWith("~/") ? join(home, cwd.slice(2)) : cwd;
    if (cwdAbs !== rootAbs) vote(cwdAbs + "/x", 1);
    if (k === "e" || k === "r") vote(resolvePath(tgt.split(/\\n|\n/)[0].trim(), cwd, home, true), k === "e" ? 3 : 1);
    else if (k === "c" && tgt) {
      for (const m of tgt.matchAll(CMD_PATH)) vote(resolvePath(m[1], cwd, home), 1);
      for (const m of tgt.matchAll(AREA_IN_CMD)) add(m[1], 0.5);
    }
  }
  const area = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { root, repo, lane: area ? `openscout/${area}` : "openscout" };
}
/** The engine names a lane by its key's last segment */
export const laneLabel = (k: string) => k.split("/").filter(Boolean).pop() || k;

/* ---------- assemble ---------- */
export type TeamHostSummary = { host: string; persona: string; platform: string; self: boolean; stale: boolean; at: number | null; error?: string; events: number; asks: number; sessions: number; worktrees: number; prs: number };
export type TeamWeekPayload = WorldWeekPayload & {
  label: string;
  vcs: { worktrees: [number, string][]; branches: [number, string, string][]; prs: [number, number | null, string, number, string, string, number | null, string][] };
  /** sessionHost[i]: the machine session i ran on, as an index into team.hosts (the HUD's :solo host) */
  team: { hosts: TeamHostSummary[]; lanes: string[]; sessionHost: number[] };
  /** live seeds only: what each ask is — a broker ask's id, "turn:<host>|<sid>" or "sub:<host>|<sid>" — so deltas can update it */
  askIds?: (string | null)[];
  /** failed tool calls: [secs, session, tool (str), target (str), what it said (str)] */
  errs?: [number, number, number, number, number][];
  /** messages the broker failed to deliver or has not delivered: [created, finished|null, o|c|f, sender (actor), to (name), text, error] */
  dlv?: [number, number | null, string, number, string, string, string][];
  /** live seeds only: each dlv row's delivery id, so deltas can finish it */
  dlvIds?: string[];
};
type TeamActor = WorldActor & { host?: string; persona?: string };
const EPISODE_GAP = 30 * 60e3, LIVE_MS = 20 * 60e3;
// payload budget: four machines are ~2× one machine's calls, so per-row text is tighter than the local week's
const TGT_CAP = 72, TASK_CAP = 600, WORK_CMDS = 8, WORK_FILES = 12, WORK_URLS = 8;

export function buildTeamWeek(input: { snapshots: TeamSnapshot[]; config: TeamHostConfig[]; prs?: TeamPrs | null; quota?: WorldWeekPayload["quota"]; now?: number; days?: number;
  /** the live World: the wall clock, when the axis (now) runs ahead of it; an ask is "still open" against this */
  wall?: number; withAskIds?: boolean }): TeamWeekPayload {
  const config = input.config, snaps = input.snapshots;
  const now = input.now ?? Math.max(0, ...snaps.map(s => s.now)), from = now - (input.days ?? 7) * DAY, wall = input.wall ?? now;
  const cfgOf = (host: string) => config.find(c => c.host === host) || { host, persona: defaultPersona(host), ssh: host, platform: "macos" };
  const selfHost = config.find(c => c.ssh === null)?.host;
  const secs = (t: number) => Math.round((t - from) / 1000);

  /* sessions, per host */
  type Sess = { key: string; host: string; home: string; sid: string; h: string; sub: boolean; parent?: string; raw: Raw[]; inbound: [number, string][]; root: string; repo: string; lane: string; wt: string | null; branch: string; i: number; usage: [number, number, number, number, number][] };
  const sessByKey = new Map<string, Sess>(), all: Sess[] = [];
  for (const s of snaps) {
    const meta = new Map(s.sessions.map(m => [m.sid, m]));
    const bySid = new Map<string, Sess>();
    const get = (sid: string) => {
      let x = bySid.get(sid);
      if (!x) { const m = meta.get(sid); x = { key: `${s.host}|${sid}`, host: s.host, home: s.home, sid, h: m?.h || "claude", sub: !!m?.sub, parent: m?.parent, raw: [], inbound: [], root: "~", repo: "~", lane: OTHER_LANE, wt: null, branch: "", i: -1, usage: [] }; bySid.set(sid, x); }
      return x;
    };
    for (const r of s.raw) if (r[0] >= from && r[0] <= now) get(r[3]).raw.push(r);
    for (const [ts, sid, text] of s.inbound) if (ts >= from && ts <= now) get(sid).inbound.push([ts, text]);
    for (const [ts, sid, f, hit, w, o] of s.usage) if (ts >= from && ts <= now) get(sid).usage.push([ts, f, hit, w, o]);
    for (const x of bySid.values()) {
      x.raw.sort((a, b) => a[0] - b[0]); x.inbound.sort((a, b) => a[0] - b[0]);
      if (x.raw.length) Object.assign(x, sessionLane(x.raw, s.home, s.roots || {}));
      if (s.roots?.[x.root]) { x.wt = `${s.host}:${x.root}`; x.branch = s.roots[x.root][1] || ""; }
      sessByKey.set(x.key, x); all.push(x);
    }
  }

  /* lanes: busiest projects by tool calls, the rest (and anything that isn't a project) folded into "other" */
  const projects = new Set<string>();
  for (const s of snaps) for (const r of Object.keys(s.repos || {})) projects.add(projectKey(r));
  const isProject = (k: string) => projects.has(k.split("/")[0]);
  const score = new Map<string, number>();
  for (const x of all) if (x.raw.length && isProject(x.lane)) score.set(x.lane, (score.get(x.lane) || 0) + x.raw.length);
  const kept = [...score.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TEAM_LANES).map(([k]) => k);
  const laneOf = (k: string | null) => k && kept.includes(k) ? k : OTHER_LANE;
  for (const x of all) x.lane = laneOf(x.lane);

  /* strings, actors */
  const strs: string[] = [], strIdx = new Map<string, number>();
  const S = (v: string) => { v = v || ""; let i = strIdx.get(v); if (i == null) { i = strs.length; strIdx.set(v, i); strs.push(v); } return i; };
  const actors: TeamActor[] = [], actorIdx = new Map<string, number>();
  const addActor = (id: string, make: () => Omit<TeamActor, "i" | "id">) => {
    let i = actorIdx.get(id); if (i != null) return i;
    i = actors.length; actors.push({ i, id, ...make() }); actorIdx.set(id, i); return i;
  };
  const persona = (host: string) => cfgOf(host).persona;
  const personIdx = (host: string) => addActor(`person.${host}`, () => ({ name: persona(host), kind: "person", node: persona(host), branch: null, cls: null, project: null, root: null, harness: null, host, persona: persona(host) }));
  // native agents: one per machine, harness and lane — "art/ios" running claude on arts-mini
  const agentIdx = (host: string, h: string, lane: string, sub = false) => addActor(`${host}.${h}${sub ? ".sub" : ""}.${laneLabel(lane)}`, () => ({
    name: `${persona(host).toLowerCase()}/${laneLabel(lane)}${sub ? "·sub" : ""}`, kind: "agent", node: persona(host), branch: null, cls: sub ? "subagent" : "worker",
    project: laneLabel(lane), root: lane, harness: h, host, persona: persona(host) }));
  // broker actors keep their real names; people are the machine's persona
  const brokerIdx = (host: string, row: HostBrokerActor | undefined, id: string, lane?: string) => {
    if (row && /^(person|human|operator|user)$/i.test(row.kind)) return personIdx(host);
    const nodeHost = row?.node && config.find(c => c.host === row.node || row.node!.startsWith(c.host + "-") || row.node!.startsWith(c.host + "."))?.host || host;
    const i = addActor(`${nodeHost}:${id}`, () => {
      const l = lane || (row?.root ? laneOf(projectKey(row.root)) : null);
      return { name: row?.name || id, kind: !row || row.kind === "?" ? "agent" : row.kind, node: persona(nodeHost), branch: null, cls: null, project: l ? laneLabel(l) : null, root: l, harness: row?.harness || null, host: nodeHost, persona: persona(nodeHost) };
    });
    // first seen without a lane (a message, an unlinked ask): the session that took a later ask places it
    if (lane && lane !== OTHER_LANE && (!actors[i].root || actors[i].root === OTHER_LANE)) { actors[i].root = lane; actors[i].project = laneLabel(lane); }
    return i;
  };

  /* broker asks: deduped by id across machines (this machine first), linked to the session that received each */
  type BAsk = { host: string; id: string; at: number; done: number | null; st: string; rq: string; tg: string; task: string; err: string; rows: Map<string, HostBrokerActor> };
  const bAsks: BAsk[] = [], seenAsk = new Set<string>();
  const order = [...snaps].sort((a, b) => (a.host === selfHost ? -1 : 0) - (b.host === selfHost ? -1 : 0));
  for (const s of order) {
    if (!s.broker) continue;
    const rows = new Map(s.broker.actors.map(a => [a.id, a]));
    for (const a of s.broker.asks) {
      if (seenAsk.has(a.id) || a.created_at < from || a.created_at > now) continue;
      seenAsk.add(a.id);
      bAsks.push({ host: s.host, id: a.id, at: a.created_at, done: a.completed_at, st: a.state === "completed" ? "c" : a.state === "failed" ? "f" : "o", rq: a.requester_id, tg: a.target_agent_id, task: a.task, err: a.error || "", rows });
    }
  }
  const received = new Map<number, { sess: Sess; ts: number }>(), consumed = new Set<string>();
  const keys = bAsks.map((a, i) => ({ i, at: a.at, key: sq(a.task).slice(0, 44) })).filter(k => k.key.length >= 24);
  for (const x of all) for (const [ts, text] of x.inbound) {
    const t = sq(text);
    for (const k of keys) {
      if (ts < k.at - 120e3 || !t.includes(k.key)) continue;
      const prev = received.get(k.i); if (!prev || ts < prev.ts) received.set(k.i, { sess: x, ts });
      consumed.add(`${x.key}|${ts}`); break;
    }
  }

  /* events: one per tool call, rooted at the lane (or the worktree, which the engine folds back into its lane) */
  const selfSnap = snaps.find(s => s.host === selfHost);
  const filesOf = new Map(snaps.map(s => [s.host, s.files || {}]));
  const events: WorldWeekPayload["events"] = [], dotFiles = new Set<string>();
  const timeline = all.filter(x => x.raw.length).flatMap(x => x.raw.map(r => [r, x] as const)).sort((a, b) => a[0][0] - b[0][0]);
  const sessions: Sess[] = [];
  const SS = (x: Sess) => { if (x.i < 0) { x.i = sessions.length; sessions.push(x); } return x.i; };
  const rootOf = (x: Sess) => x.wt || x.lane;
  for (const [[ts, cwd, , , name, tgt, delta], x] of timeline) {
    const k = kind(name);
    // paths inside the session's own checkout read relative to it (the file index still carries the full path)
    let t = tgt.replace(/\s+/g, " ").replaceAll(x.home + "/", "~/");
    if (t.startsWith(x.root + "/")) t = t.slice(x.root.length + 1);
    t = t.slice(0, TGT_CAP);
    let file = -1;
    if (k === "e" || k === "r") {
      const abs = resolvePath(tgt.split(/\\n|\n/)[0].trim(), cwd, x.home, true);
      if (abs && filesOf.get(x.host)?.[abs]) { file = S(abs); if (x.host === selfHost) dotFiles.add(abs); }
    }
    const at = secs(ts);
    events.push(k === "e" && delta ? [at, S(rootOf(x)), k, SS(x), S(name), S(t), file, delta[0], delta[1]] : [at, S(rootOf(x)), k, SS(x), S(name), S(t), file]);
  }

  /* what a session did between two moments: the ask's work card */
  const workFor = (x: Sess, t0: number, t1: number, task: string, askI: number): WorldWork => {
    const calls = x.raw.filter(r => r[0] >= t0 && r[0] <= t1 + 60e3), stats = filesOf.get(x.host) || {};
    const files = new Map<string, { e: number; r: number }>(), urls = new Map<string, number>(), cmds: string[] = [];
    const note = (abs: string, edited: boolean) => { const f = files.get(abs) || { e: 0, r: 0 }; if (edited) f.e++; else f.r++; files.set(abs, f); };
    for (const [, cwd, , , name, tgt] of calls) {
      const k = kind(name);
      if (k === "c" && tgt) {
        if (cmds.length < WORK_CMDS) cmds.push(tgt.replace(/\s+/g, " ").replaceAll(x.home + "/", "~/").slice(0, TGT_CAP));
        for (const m of tgt.matchAll(/(?:^|[\s'"=])((?:~|\.{0,2}\/|[\w@-]+\/)[\w@./-]*\.[A-Za-z0-9]{1,5})(?=$|[\s'":;)])/g)) { const abs = resolvePath(m[1], cwd, x.home); if (abs && stats[abs]) note(abs, false); }
      } else if (/^https?:\/\//.test(tgt)) { const u = tgt.slice(0, 160); urls.set(u, (urls.get(u) || 0) + 1); }
      else if (k === "e" || k === "r" || ART.test(tgt)) { const abs = resolvePath(tgt.split(/\\n|\n/)[0].trim(), cwd, x.home, k === "e" || k === "r"); if (abs) note(abs, k === "e"); }
    }
    const rows: WorldFile[] = [...files.entries()].map(([abs, f]) => {
      const st = stats[abs], disp = x.host === selfHost ? tilde(abs, x.home) : `${x.host}:${tilde(abs, x.home)}`;
      return [disp, abs, f.e, f.r, st ? st[0] : -1, st ? st[1] : 0, ART.test(abs) && !TEXTY.test(abs.replace(/\.(md|json|txt|csv|html?)$/i, "")) ? 1 : 0] as WorldFile;
    }).sort((a, b) => b[2] - a[2] || b[3] - a[3]).slice(0, WORK_FILES);
    void askI;
    return { s: SS(x), t0, t1, n: calls.length, task: sq(task).slice(0, TASK_CAP), files: rows, urls: [...urls.entries()].sort((a, b) => b[1] - a[1]).slice(0, WORK_URLS), cmds };
  };

  /* asks: Scout asks from the brokers, the operator's turns on each machine, and subagents their sessions spawned */
  type AskRow = { ask: WorldAsk; work?: WorldWork; host: string; id?: string };
  const askRows: AskRow[] = [];
  bAsks.forEach((a, i) => {
    const hit = received.get(i);
    const rq = brokerIdx(a.host, a.rows.get(a.rq), a.rq), tg = brokerIdx(hit?.sess.host || a.host, a.rows.get(a.tg), a.tg, hit?.sess.lane);
    const row: AskRow = { ask: [a.at, a.done, a.st, rq, tg, squash(a.task, 96), squash(a.err, 70), "b"], host: hit?.sess.host || a.host, id: a.id };
    if (hit) row.work = workFor(hit.sess, hit.ts, a.done || Math.min(now, hit.ts + 3 * 36e5), a.task, i);
    askRows.push(row);
  });
  const turnsOut = new Map<Sess, [number, number][]>();
  const bySid = new Map(all.map(x => [`${x.host}|${x.sid}`, x]));
  for (const x of all) {
    if (!x.raw.length) continue;
    const turns: [number, string][] = [];
    for (const [ts, text] of x.inbound) {
      if (consumed.has(`${x.key}|${ts}`)) continue;
      const said = text.trim();
      if (!said || NOISE.test(said)) continue;
      const t280 = sq(said).slice(0, 280);
      if (turns.length < 60 && !turns.some(([, v]) => v === t280)) turns.push([ts, t280]);
    }
    turnsOut.set(x, turns.map(([ts, t]) => [secs(ts), S(t)]));
    if (x.sub) {
      // a subagent's first turn is the prompt its parent session wrote: an agent asking an agent
      const first = turns[0]; if (!first) continue;
      const parent = x.parent ? bySid.get(`${x.host}|${x.parent}`) : undefined;
      const rq = parent ? agentIdx(x.host, parent.h, parent.lane) : agentIdx(x.host, x.h, x.lane);
      const last = x.raw[x.raw.length - 1][0], live = wall - last < LIVE_MS;
      const ask: WorldAsk = [first[0], live ? null : Math.max(first[0], last), live ? "o" : "c", rq, agentIdx(x.host, x.h, x.lane, true), squash(first[1], 96), "", "s"];
      askRows.push({ ask, host: x.host, work: workFor(x, first[0], ask[1] ?? now, first[1], -1), id: `sub:${x.key}` });
      continue;
    }
    // the operator's own turns: a new ask when they come back after a gap, the work runs until the next one
    const starts: number[] = [];
    let lastActive = -Infinity, ri = 0;
    turns.forEach(([ts], k) => {
      while (ri < x.raw.length && x.raw[ri][0] < ts) { lastActive = Math.max(lastActive, x.raw[ri][0]); ri++; }
      if (!starts.length || ts - Math.max(lastActive, turns[k - 1][0]) >= EPISODE_GAP) starts.push(k);
      lastActive = Math.max(lastActive, ts);
    });
    starts.forEach((k, j) => {
      const ts = turns[k][0], until = j + 1 < starts.length ? turns[starts[j + 1]][0] : Infinity;
      const inside = x.raw.filter(r => r[0] >= ts && r[0] < until), lastT = inside.length ? inside[inside.length - 1][0] : ts;
      const live = until === Infinity && wall - lastT < LIVE_MS;
      const ask: WorldAsk = [ts, live ? null : lastT, live ? "o" : "c", personIdx(x.host), agentIdx(x.host, x.h, x.lane), squash(turns[k][1], 96), "", "t"];
      askRows.push({ ask, host: x.host, work: workFor(x, ts, live ? now : lastT, turns[k][1], -1), id: `turn:${x.key}` });
    });
  }
  askRows.sort((a, b) => a.ask[0] - b.ask[0]);
  const asks = askRows.map(r => r.ask), work: Record<number, WorldWork> = {};
  askRows.forEach((r, i) => { if (r.work) work[i] = r.work; });

  /* messages: every broker's, deduped by id */
  const msgs: [number, number, string][] = [], seenMsg = new Set<string>();
  for (const s of order) {
    if (!s.broker) continue;
    const rows = new Map(s.broker.actors.map(a => [a.id, a]));
    for (const [id, at, actor, cls] of s.broker.messages) {
      if (seenMsg.has(id) || at < from || at > now) continue;
      seenMsg.add(id); msgs.push([at, brokerIdx(s.host, rows.get(actor), actor), cls]);
    }
  }
  msgs.sort((a, b) => a[0] - b[0]);

  /* trouble: failed tool calls on the sessions drawn, and the brokers' undelivered messages (deduped by id) */
  const errs: NonNullable<TeamWeekPayload["errs"]> = [];
  for (const s of snaps) for (const [ts, sid, tool, target, err] of s.errs || []) {
    const x = sessByKey.get(`${s.host}|${sid}`);
    if (!x || x.i < 0 || ts < from || ts > now) continue;
    let t = String(target || "").replace(/\s+/g, " ").replaceAll(x.home + "/", "~/");
    if (t.startsWith(x.root + "/")) t = t.slice(x.root.length + 1);
    errs.push([secs(ts), x.i, S(tool), S(t.slice(0, TGT_CAP)), S(squash(err, 120))]);
  }
  errs.sort((a, b) => a[0] - b[0]);
  const dlv: NonNullable<TeamWeekPayload["dlv"]> = [], dlvIds: string[] = [], seenDlv = new Set<string>();
  for (const s of order) {
    if (!s.broker?.deliveries) continue;
    const rows = new Map(s.broker.actors.map(a => [a.id, a]));
    for (const d of s.broker.deliveries) {
      if (seenDlv.has(d.id) || d.created_at < from || d.created_at > now) continue;
      seenDlv.add(d.id); dlvIds.push(d.id);
      dlv.push([d.created_at, d.done_at, deliveryState(d.status), brokerIdx(s.host, rows.get(d.from), d.from || "system"), squash(d.to_name || d.to, 60), squash(d.text, 96), squash(d.error || "", 90)]);
    }
  }

  /* vcs: worktrees as first touched, branches as born on each machine, the operator's PRs from gh */
  const roots: WorldWeekPayload["roots"] = {}, firstWt = new Map<string, number>();
  for (const x of sessions) if (x.wt) roots[x.wt] = [x.lane, x.branch];
  for (const e of events) { const r = strs[e[1]]; if (roots[r] && !firstWt.has(r)) firstWt.set(r, e[0]); }
  const vcs: TeamWeekPayload["vcs"] = { worktrees: [...firstWt.entries()].map(([r, s]) => [s, r] as [number, string]).sort((a, b) => a[0] - b[0]), branches: [], prs: [] };
  const repoLanes = new Map<string, Set<string>>();   // github slug → lanes its checkouts landed in
  const branchHosts = new Map<string, Set<string>>();  // "slug branch" → machines that have that branch
  const hasBranch = (slug: string, branch: string, host: string) => { if (!branch) return; const k = `${slug} ${branch}`; const set = branchHosts.get(k) || new Set(); set.add(host); branchHosts.set(k, set); };
  for (const s of snaps) for (const [repo, info] of Object.entries(s.repos || {})) {
    for (const [born, name] of info.branches) if (born > from && born <= now) vcs.branches.push([secs(born), `${s.host}:${repo}`, name]);
    const slug = githubSlug(info.origin); if (!slug) continue;
    for (const [, name] of info.branches) hasBranch(slug, name, s.host);
    for (const [, name] of info.worktrees) hasBranch(slug, name, s.host);
    for (const [root, [parent, name]] of Object.entries(s.roots || {})) if (parent === repo) hasBranch(slug, name, s.host);
    const lanes = repoLanes.get(slug) || new Set(); repoLanes.set(slug, lanes);
    for (const x of all) if (x.host === s.host && x.repo === repo && x.raw.length) lanes.add(x.lane);
  }
  const seenPr = new Set<string>(), prsBy = new Map<string, number>();   // PRs whose head branch lives on a machine
  for (const [slug, list] of Object.entries(input.prs?.repos || {})) {
    if (!repoLanes.has(slug)) continue;
    // a repo whose work spans several lanes (openscout's areas) leaves the PR's repo blank so the engine matches by branch alone
    const lanes = [...repoLanes.get(slug)!], repo = lanes.length === 1 ? lanes[0] : "";
    for (const [num, created, merged, closed, title, head, url] of list) {
      if (created <= from || created > now || seenPr.has(url || `${slug}#${num}`)) continue;
      seenPr.add(url || `${slug}#${num}`);
      const at = (t: number | null) => t != null && t <= now ? secs(t) : null;
      vcs.prs.push([secs(created), at(merged), repo, num, title, head, at(closed), url]);
      for (const h of branchHosts.get(`${slug} ${head}`) || []) prsBy.set(h, (prsBy.get(h) || 0) + 1);
    }
  }
  vcs.branches.sort((a, b) => a[0] - b[0]); vcs.prs.sort((a, b) => a[0] - b[0]);

  /* tokens */
  const usage: WorldWeekPayload["usage"] = {}, usageLoose: WorldWeekPayload["usageLoose"] = {}, colds: [number, number, number][] = [];
  for (const x of all) {
    if (!x.usage.length) continue;
    const m = new Map<number, [number, number, number, number]>();
    for (const [ts, f, hit, w, o] of x.usage) {
      const hr = Math.floor((ts - from) / 36e5), b = m.get(hr) || [0, 0, 0, 0];
      b[0] += f; b[1] += hit; b[2] += w; b[3] += o; m.set(hr, b);
      if (x.i >= 0 && f + w >= COLD_MIN && hit < f + w) colds.push([secs(ts), x.i, f + w]);
    }
    const rows = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([h, b]): [number, number, number, number, number] => [h, ...b]);
    if (x.i >= 0) usage[x.i] = rows; else usageLoose[`${x.host}:${x.sid}`] = rows;
  }
  colds.sort((a, b) => a[0] - b[0]);

  /* the mesh: one node per machine, named for its persona; the real host rides along */
  const lastSeen = new Map<string, number>();
  for (const x of all) for (const r of x.raw) lastSeen.set(x.host, Math.max(lastSeen.get(x.host) || 0, r[0]));
  const hosts: (WorldHost & { host: string; stale: boolean; snapshotAt: number | null })[] = config.filter(c => snaps.some(s => s.host === c.host)).map(c => {
    const s = snaps.find(v => v.host === c.host)!;
    return { name: c.persona, host: c.host, platform: c.platform || "macos", self: c.host === selfHost, seen: lastSeen.get(c.host) ?? s.at, tailnet: true, caps: [], stale: !!s.stale, snapshotAt: s.at };
  });
  const summary: TeamHostSummary[] = config.map(c => {
    const s = snaps.find(v => v.host === c.host), mine = sessions.filter(x => x.host === c.host), ids = new Set(mine.map(x => x.i));
    const wts = new Set(mine.filter(x => x.wt).map(x => x.wt));
    return { host: c.host, persona: c.persona, platform: c.platform || "macos", self: c.host === selfHost, stale: !s || !!s.stale, at: s?.at ?? null, error: s?.error,
      events: events.filter(e => ids.has(e[3])).length, asks: askRows.filter(r => r.host === c.host).length, sessions: mine.length, worktrees: wts.size,
      prs: prsBy.get(c.host) || 0 };
  });
  // the file route checks this machine's own week, not this list; kept for the contract, filled for the study
  const allow = selfSnap ? [...new Set([...Object.values(work).flatMap(w => w.files.filter(f => f[4] >= 0 && !f[0].includes(":")).map(f => f[1])), ...dotFiles])] : [];
  const sessionsOut: WorldWeekPayload["sessions"] = sessions.map(x => [x.sid, x.h, rootOf(x), turnsOut.get(x) || []]);
  return {
    now, from, label: `TEAM · ${hosts.length} MACHINE${hosts.length === 1 ? "" : "S"}`, actors, asks, msgs, hosts, events, strs, sessions: sessionsOut, work, allow, roots, vcs,
    quota: input.quota || [], usage, usageLoose, colds, team: { hosts: summary, lanes: [...kept, OTHER_LANE], sessionHost: sessions.map(x => config.findIndex(c => c.host === x.host)) },
    errs, dlv,
    ...(input.withAskIds ? { askIds: askRows.map(r => r.id ?? null), dlvIds } : {}),
  };
}

/* ---------- serve: rebuilt only when a snapshot, prs.json or hosts.json changes ---------- */
export function createTeamWeekService(opts: { dir?: string; quota?: (from: number) => WorldWeekPayload["quota"] } = {}) {
  const dir = opts.dir ?? teamDir();
  type Built = { sig: string; json: string; gz: Uint8Array } | null;
  let memo: Built = null, flight: Promise<Built> | null = null;
  async function signature(): Promise<string> {
    const files = ["hosts.json", "prs.json", ...((await readdir(join(dir, "snapshots")).catch(() => [] as string[])).map(f => `snapshots/${f}`))];
    const parts = await Promise.all(files.map(async f => { const st = await stat(join(dir, f)).catch(() => null); return st ? `${f}:${st.mtimeMs}:${st.size}` : ""; }));
    return parts.join("|");
  }
  async function build(): Promise<Built> {
    const sig = await signature();
    if (memo && memo.sig === sig) return memo;
    const config = await readTeamConfig(dir), snapshots = await readSnapshots(dir, config);
    if (!snapshots.length) return null;
    const prs = await readJson<TeamPrs>(join(dir, "prs.json"));
    // the week ends at the latest collection, so a build from snapshots reads the same whenever it is served
    const now = Math.max(...snapshots.map(s => s.now));
    const payload = buildTeamWeek({ snapshots, config, prs, quota: opts.quota?.(now - 7 * DAY) ?? [], now });
    // ~9 MB of JSON compresses ~6×; served gzipped to any client that accepts it
    const json = JSON.stringify(payload);
    memo = { sig, json, gz: Bun.gzipSync(json) };
    return memo;
  }
  const get = () => { if (!flight) flight = build().finally(() => { flight = null; }); return flight; };
  return {
    /** null when nothing has been collected yet */
    json: async () => (await get())?.json ?? null,
    gzip: async () => (await get())?.gz ?? null,
  };
}
