/**
 * World · Team collector: one machine's last days of real agent work, compacted. Reads that machine's own Claude and
 * Codex transcripts (the same parser as the local week), its broker's asks and messages, and its git — worktrees,
 * branches born in the window, origins — and returns rows small enough to cross ssh. Nothing raw leaves the machine:
 * targets are capped, operator turns are capped and every string passes through redact() first.
 *
 * Portable on purpose: node built-ins plus bun:sqlite (loaded lazily, optional), so world-team.ts can bundle this file
 * and pipe it into a bare `bun run -` on a host that has no checkout of this repo. With WORLD_HOSTS_COLLECT set it
 * prints the snapshot as JSON on stdout and exits.
 */
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { DAY, kind, norm, parseTranscript, redact, resolvePath, tilde, type Inbound, type Raw, type ToolErr, type Usage } from "./world-transcript.ts";
import { readTroubleDeliveries, type BrokerDelivery } from "./world-broker-rows.ts";

export const HOST_SNAPSHOT_VERSION = 1;
// [ms, size bytes, mtime ms]: a file the host's agents touched that still exists there
export type HostFileStat = [number, number];
export type HostSession = { sid: string; h: string; parent?: string; sub?: 1 };
export type HostBrokerAsk = { id: string; created_at: number; completed_at: number | null; state: string | null; requester_id: string; target_agent_id: string; target_node: string | null; task: string; error: string | null };
export type HostBrokerActor = { id: string; kind: string; name: string; node: string | null; harness: string | null; root: string | null };
export type HostBroker = { asks: HostBrokerAsk[]; messages: [string, number, string, string][]; actors: HostBrokerActor[]; deliveries?: BrokerDelivery[] };
export type HostRepo = { origin: string; branches: [number, string][]; worktrees: [string, string][] };
export type HostSnapshot = {
  v: number; host: string; home: string; at: number; from: number; now: number;
  sessions: HostSession[]; raw: Raw[]; inbound: Inbound[]; usage: Usage[];
  /** failed tool calls (absent from older collectors) */
  errs?: ToolErr[];
  files: Record<string, HostFileStat>;
  /** checkout root (tilde, as teamRoot() gives it) → [the repo it is a worktree of, branch]; checkouts that are not worktrees are absent */
  roots: Record<string, [string, string]>;
  repos: Record<string, HostRepo>;
  broker: HostBroker | null;
  ms: number;
};

// secrets: the one redactor lives in world-transcript.ts, where every served string is born; re-exported for callers
export { redact };

/* ---------- helpers ---------- */
const run = (cmd: string, args: string[], cwd?: string, timeout = 4000) => new Promise<string>(resolve => {
  try {
    execFile(cmd, args, { cwd, timeout, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => resolve(error ? "" : String(stdout).trim()));
  } catch { resolve(""); }
});
const exists = (p: string) => stat(p).then(() => true, () => false);
async function* jsonlFiles(dir: string, from: number): AsyncGenerator<[string, string]> {
  const { readdir } = await import("node:fs/promises");
  const walk = async function* (d: string): AsyncGenerator<string> {
    let entries; try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) yield* walk(p);
      else if (e.isFile() && e.name.endsWith(".jsonl")) yield p;
    }
  };
  for await (const f of walk(dir)) {
    try { if ((await stat(f)).mtimeMs >= from) yield [f, relative(dir, f)]; } catch {}
  }
}
/** A session's checkout. Claude Code's worktrees (<repo>/.claude/worktrees/<name>) and folders of worktrees
 *  (~/dev/hudson-worktrees/<name>) are checkouts of their own; the rest as norm() reads them. */
export function teamRoot(cwd: string | null, home: string): string {
  const m = (cwd || "").match(/^(.*?\/(?:\.claude\/worktrees|[^/]+-worktrees)\/[^/]+)/);
  return m ? tilde(m[1], home) : norm(cwd, home) || "~";
}
// the same path-looking args the week reads out of shell commands (sed/cat/rg …)
const CMD_PATH = /(?:^|[\s'"=])((?:~|\.{0,2}\/|[\w@-]+\/)[\w@./-]*\.[A-Za-z0-9]{1,5})(?=$|[\s'":;)])/g;

/* ---------- broker: this machine's asks and messages, ids kept so hosts that mirror one another dedupe ---------- */
async function readBroker(home: string, from: number): Promise<HostBroker | null> {
  const file = join(home, ".openscout/control-plane/control-plane.sqlite");
  if (!await exists(file)) return null;
  let db: any;
  try {
    const { Database } = await import("bun:sqlite");
    db = new Database(file, { readonly: true });
    const nodes = new Map<string, string>();
    try { for (const r of db.query("select id, name from nodes").all() as any[]) nodes.set(r.id, r.name); } catch {}
    const asks = (db.query(`select id, created_at, completed_at, state, requester_id, target_agent_id, target_node_id, task, error
      from invocations where rowid in (select rowid from invocations where created_at > ?) order by created_at`).all(from) as any[])
      .map((r): HostBrokerAsk => ({ id: r.id, created_at: r.created_at, completed_at: r.completed_at ?? null, state: r.state ?? null, requester_id: r.requester_id, target_agent_id: r.target_agent_id,
        target_node: r.target_node_id ? nodes.get(r.target_node_id) || r.target_node_id : null, task: redact(String(r.task || "").replace(/\s+/g, " ")).slice(0, 1600), error: r.error ? redact(String(r.error).replace(/\s+/g, " ")).slice(0, 200) : null }));
    const messages = (db.query("select id, created_at, actor_id, class from messages where created_at > ? order by created_at").all(from) as any[])
      .map((r): [string, number, string, string] => [r.id, r.created_at, r.actor_id, String(r.class || "").slice(0, 1)]);
    const deliveries = readTroubleDeliveries(db, from);
    const ids = new Set([...asks.flatMap(a => [a.requester_id, a.target_agent_id]), ...messages.map(m => m[2]), ...deliveries.map(d => d.from).filter(Boolean)]);
    const qa = db.query("select kind, display_name, metadata_json from actors where id = ?");
    const qg = db.query("select node_qualifier, metadata_json from agents where id = ?");
    const actors: HostBrokerActor[] = [];
    for (const id of ids) {
      const a = qa.get(id) as any, g = qg.get(id) as any;
      let md: Record<string, any> = {}; try { md = JSON.parse(g?.metadata_json || a?.metadata_json || "{}") || {}; } catch {}
      actors.push({ id, kind: a?.kind || "?", name: a?.display_name || id, node: g?.node_qualifier || md.node || null,
        harness: md.harness || md.defaultHarness || md.runtime || null, root: md.projectRoot ? norm(String(md.projectRoot), home) : null });
    }
    return { asks, messages, actors, deliveries };
  } catch { return null; } finally { try { db?.close(); } catch {} }
}

/* ---------- git: which lane roots are worktrees, and each repo's branches and worktrees ---------- */
async function readGit(laneRoots: Set<string>, home: string, from: number, now: number) {
  const roots: Record<string, [string, string]> = {}, repos: Record<string, HostRepo> = {}, repoAbs = new Set<string>();
  const abs = (r: string) => r.startsWith("~/") ? join(home, r.slice(2)) : r;
  await Promise.all([...laneRoots].map(async r => {
    const p = abs(r), codexWt = r.match(/\/\.codex\/worktrees\/[^/]+\/([^/]+)$/);
    const present = await exists(p);
    if (present && await exists(join(p, ".git"))) {
      const common = await run("git", ["-C", p, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
      if (!common) return;
      const repo = dirname(common);
      repoAbs.add(repo);
      if (common !== join(p, ".git")) roots[r] = [tilde(repo, home), await run("git", ["-C", p, "branch", "--show-current"])];
    } else if (codexWt && !present && await exists(join(home, "dev", codexWt[1]))) {
      // the worktree is gone from disk: Codex names it after the repo it came from
      roots[r] = [`~/dev/${codexWt[1]}`, ""]; repoAbs.add(join(home, "dev", codexWt[1]));
    }
  }));
  await Promise.all([...repoAbs].map(async repo => {
    const common = await run("git", ["-C", repo, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
    if (!common) return;
    const origin = await run("git", ["-C", repo, "config", "--get", "remote.origin.url"]);
    const branches: [number, string][] = [];
    const { readFile } = await import("node:fs/promises");
    for (const line of (await run("git", ["-C", repo, "for-each-ref", "--format=%(refname:short)\t%(creatordate:unix)", "refs/heads"])).split("\n").filter(Boolean)) {
      const [name, tip] = line.split("\t");
      // a branch's birth is the first line of its reflog; refs with no log fall back to the tip's commit date
      let born = +tip * 1000;
      try { const log = await readFile(join(common, "logs/refs/heads", name), "utf8"); const m = log.slice(0, log.indexOf("\n")).match(/> (\d{9,}) [+-]\d{4}\t/); if (m) born = +m[1] * 1000; } catch {}
      if (born > from && born <= now) branches.push([born, name.slice(0, 80)]);
    }
    const worktrees: [string, string][] = [];
    let cur: [string, string] | null = null;
    for (const line of (await run("git", ["-C", repo, "worktree", "list", "--porcelain"])).split("\n")) {
      if (line.startsWith("worktree ")) { cur = [tilde(line.slice(9), home), ""]; worktrees.push(cur); }
      else if (line.startsWith("branch ") && cur) cur[1] = line.slice(7).replace(/^refs\/heads\//, "");
    }
    repos[tilde(repo, home)] = { origin: redact(origin), branches: branches.sort((a, b) => a[0] - b[0]), worktrees };
  }));
  return { roots, repos };
}

/* ---------- the snapshot ---------- */
export async function collectHost(opts: { home?: string; host?: string; now?: number; days?: number } = {}): Promise<HostSnapshot> {
  const t0 = Date.now();
  const home = opts.home ?? homedir(), now = opts.now ?? Date.now(), from = now - (opts.days ?? 7) * DAY;
  const host = opts.host ?? hostname().replace(/\.local$/, "");
  const sessions: HostSession[] = [], raw: Raw[] = [], inbound: Inbound[] = [], usage: Usage[] = [], errs: ToolErr[] = [];
  const seenSid = new Set<string>();
  for (const [harness, dir] of [["claude", join(home, ".claude/projects")], ["codex", join(home, ".codex/sessions")]] as const) {
    for await (const [file, rel] of jsonlFiles(dir, from)) {
      let sid: string, meta: HostSession;
      if (harness === "claude") {
        const parts = rel.split("/"), sub = parts.includes("subagents");
        // subagent transcripts all start "agent-"; their tail is the unique part. The parent is the folder they sit in
        sid = sub ? basename(file, ".jsonl").replace(/^agent-/, "").slice(-8) : basename(file, ".jsonl").slice(0, 8);
        meta = sub ? { sid, h: harness, sub: 1, parent: parts[1]?.slice(0, 8) } : { sid, h: harness };
      } else { sid = basename(file, ".jsonl").slice(-8); meta = { sid, h: harness }; }
      if (seenSid.has(sid)) continue;
      let parsed; try { parsed = await parseTranscript(file, harness, home, from, sid); } catch { continue; }
      if (!parsed.raw.length && !parsed.inbound.length && !parsed.usage.length) continue;
      seenSid.add(sid); sessions.push(meta);
      // parseTranscript already redacted targets and turns before capping them
      for (const r of parsed.raw) raw.push(r);
      for (const t of parsed.inbound) inbound.push([t[0], t[1], t[2].slice(0, 3000)]);
      for (const u of parsed.usage) usage.push(u);
      for (const e of parsed.errs) errs.push(e);
    }
  }
  // files: what the agents read, edited or named in a command, stat'd here — only ones that still exist travel
  const files: Record<string, HostFileStat> = {}, cand = new Set<string>();
  for (const [, cwd, , , name, served, , plain] of raw) {
    const k = kind(name), tgt = plain ?? served; // paths resolve on the unredacted target; it never leaves this host
    // a path that itself reads as a secret stays home too
    const keep = (p: string | null) => { if (p && redact(p) === p) cand.add(p); };
    if (k === "e" || k === "r") keep(resolvePath(tgt.split(/\\n|\n/)[0].trim(), cwd, home, true));
    else if (k === "c" && tgt) for (const m of tgt.matchAll(CMD_PATH)) keep(resolvePath(m[1], cwd, home));
    if (cand.size > 40000) break;
  }
  await Promise.all([...cand].map(async p => { try { const st = await stat(p); if (st.isFile()) files[p] = [st.size, Math.round(st.mtimeMs)]; } catch {} }));
  // only the redacted target crosses ssh
  for (const r of raw) if (r.length > 7) r.length = 7;
  const laneRoots = new Set(raw.map(r => teamRoot(r[1], home)));
  const [git, broker] = await Promise.all([readGit(laneRoots, home, from, now), readBroker(home, from)]);
  return { v: HOST_SNAPSHOT_VERSION, host, home, at: Date.now(), from, now, sessions, raw, inbound, usage, errs, files, roots: git.roots, repos: git.repos, broker, ms: Date.now() - t0 };
}

if (process.env.WORLD_HOSTS_COLLECT) {
  const days = Number(process.env.WORLD_HOSTS_DAYS) || 7, now = Number(process.env.WORLD_HOSTS_NOW) || Date.now();
  const snap = await collectHost({ days, now, host: process.env.WORLD_HOSTS_NAME || undefined });
  process.stdout.write(JSON.stringify(snap));
}
