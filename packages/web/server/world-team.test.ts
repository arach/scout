import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectHost, redact, type HostSnapshot } from "./world-hosts.ts";
import { buildTeamWeek, collectTeam, createTeamWeekService, DEFAULT_TEAM_HOSTS, githubSlug, mergeTeamConfig, openscoutArea, readSnapshots, sessionLane, type TeamHostConfig, type TeamPrs } from "./world-team.ts";
import type { Raw } from "./world-transcript.ts";

const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
const temp = async (p: string) => { const d = await mkdtemp(join(tmpdir(), p)); dirs.push(d); return d; };
const NOW = Date.UTC(2026, 9, 9, 20), H = 36e5;

/* a host snapshot by hand: the shape world-hosts.ts returns, with only what each test needs */
function snapshot(host: string, home: string, over: Partial<HostSnapshot> = {}): HostSnapshot {
  return { v: 1, host, home, at: NOW, from: NOW - 7 * 864e5, now: NOW, sessions: [], raw: [], inbound: [], usage: [], files: {}, roots: {}, repos: {}, broker: null, ms: 1, ...over };
}
const call = (ts: number, cwd: string, h: string, sid: string, tool: string, target: string, delta?: [number, number]): Raw => [ts, cwd, h, sid, tool, target, delta];
const config: TeamHostConfig[] = [
  { host: "arts-mini", persona: "Art", ssh: null, platform: "macos" },
  { host: "mini", persona: "Mini", ssh: "mini", platform: "macos" },
  { host: "archie", persona: "Archie", ssh: "arach@archie", platform: "linux" },
];
function team() {
  const art = snapshot("arts-mini", "/Users/art", {
    sessions: [{ sid: "aaaa1111", h: "claude" }, { sid: "sub00001", h: "claude", sub: 1, parent: "aaaa1111" }, { sid: "cccc3333", h: "codex" }],
    raw: [
      call(NOW - 5 * H, "~/dev/openscout", "claude", "aaaa1111", "Read", "/Users/art/dev/openscout/packages/web/server/a.ts"),
      call(NOW - 5 * H + 60e3, "~/dev/openscout", "claude", "aaaa1111", "Edit", "/Users/art/dev/openscout/packages/web/server/a.ts", [4, 1]),
      call(NOW - 5 * H + 120e3, "~/dev/openscout", "claude", "aaaa1111", "Bash", "bun test packages/web"),
      call(NOW - 4 * H, "~/dev/openscout", "claude", "sub00001", "Grep", "packages/web/client"),
      // a Codex worktree cut from openscout, on a branch with a PR
      call(NOW - 3 * H, "~/.codex/worktrees/ab12/openscout", "codex", "cccc3333", "apply_patch", "apps/ios/Scout/Home.swift", [10, 2]),
      call(NOW - 3 * H + 30e3, "~/.codex/worktrees/ab12/openscout", "codex", "cccc3333", "exec_command", "xcodebuild -scheme Scout test"),
    ],
    inbound: [
      [NOW - 5 * H - 10e3, "aaaa1111", "Fix the web server route that drops the cache header"],
      [NOW - 5 * H + 90e3, "aaaa1111", "looks right, now the tests"],
      [NOW - 4 * H - 5e3, "sub00001", "Find where the client reads the cache header"],
      [NOW - 3 * H - 10e3, "cccc3333", "Please inspect the iOS home and tighten the header spacing as requested"],
    ],
    usage: [[NOW - 5 * H, "aaaa1111", 30000, 0, 0, 500]],
    files: { "/Users/art/dev/openscout/packages/web/server/a.ts": [120, NOW - 5 * H] },
    roots: { "~/.codex/worktrees/ab12/openscout": ["~/dev/openscout", "codex/ios-header"] },
    repos: { "~/dev/openscout": { origin: "git@github.com:arach/openscout.git", branches: [[NOW - 3 * H - 60e3, "codex/ios-header"]], worktrees: [["~/dev/openscout", "main"], ["~/.codex/worktrees/ab12/openscout", "codex/ios-header"]] } },
    broker: {
      asks: [{ id: "inv-1", created_at: NOW - 3 * H - 20e3, completed_at: NOW - 3 * H + 40e3, state: "completed", requester_id: "op", target_agent_id: "ag-1", target_node: null, task: "Please inspect the iOS home and tighten the header spacing as requested", error: null }],
      messages: [["m-1", NOW - 3 * H - 20e3, "op", "a"]],
      actors: [{ id: "op", kind: "person", name: "Arach", node: null, harness: null, root: null }, { id: "ag-1", kind: "agent", name: "openscout-ios-1", node: "arts-mini", harness: "codex", root: "~/dev/openscout" }],
    },
  });
  const mini = snapshot("mini", "/Users/arach", {
    sessions: [{ sid: "dddd4444", h: "claude" }],
    raw: [call(NOW - 2 * H, "~/dev/lattices", "claude", "dddd4444", "Edit", "/Users/arach/dev/lattices/src/app.ts", [3, 0])],
    inbound: [[NOW - 2 * H - 10e3, "dddd4444", "Add the layer picker to lattices"]],
    files: { "/Users/arach/dev/lattices/src/app.ts": [99, NOW - 2 * H] },
    repos: { "~/dev/lattices": { origin: "https://github.com/arach/lattices.git", branches: [], worktrees: [["~/dev/lattices", "main"]] } },
    // the same ask mirrored into a second broker: counted once
    broker: { asks: [{ id: "inv-1", created_at: NOW - 3 * H - 20e3, completed_at: NOW - 3 * H + 40e3, state: "completed", requester_id: "op", target_agent_id: "ag-1", target_node: null, task: "Please inspect the iOS home and tighten the header spacing as requested", error: null }], messages: [["m-1", NOW - 3 * H - 20e3, "op", "a"]], actors: [] },
  });
  const archie = snapshot("archie", "/home/arach", {
    sessions: [{ sid: "eeee5555", h: "codex" }],
    // archie keeps lattices under ~/dev/projects: the same project, so the same lane
    raw: [call(NOW - 1 * H, "~/dev/projects/lattices", "codex", "eeee5555", "exec_command", "bun test")],
    inbound: [[NOW - 1 * H - 10e3, "eeee5555", "Run the lattices tests on linux"]],
    repos: { "~/dev/projects/lattices": { origin: "https://github.com/arach/lattices.git", branches: [], worktrees: [] } },
  });
  const prs: TeamPrs = { at: NOW, login: "arach", repos: { "arach/openscout": [[1300, NOW - 2 * H, NOW - H, null, "iOS: tighten the home header", "codex/ios-header", "https://github.com/arach/openscout/pull/1300"]] } };
  return { snaps: [art, mini, archie], prs };
}

describe("World team · personas", () => {
  test("defaults stay plain and derived from the host; hosts.json overrides and adds hosts", () => {
    expect(mergeTeamConfig(null).map(h => [h.host, h.persona])).toEqual([["arts-mini", "Art"], ["mini", "Mini"], ["air", "Air"], ["archie", "Archie"]]);
    expect(mergeTeamConfig(null)).toEqual(DEFAULT_TEAM_HOSTS);
    const custom = mergeTeamConfig({ hosts: [{ host: "mini", persona: "Rosa" }, { host: "studio-lab-3" }] });
    expect(custom).toEqual([{ host: "mini", persona: "Rosa", ssh: "mini", platform: "macos" }, { host: "studio-lab-3", persona: "Studio", ssh: "studio-lab-3", platform: "macos" }]);
  });
  test("one person per machine, named for its persona, with the real host on the person, the agents and the mesh node", () => {
    const { snaps, prs } = team();
    const d = buildTeamWeek({ snapshots: snaps, config, prs, now: NOW });
    const people = d.actors.filter(a => a.kind === "person");
    expect(people.map(p => [p.name, (p as any).host, p.node])).toEqual([["Art", "arts-mini", "Art"], ["Mini", "mini", "Mini"], ["Archie", "archie", "Archie"]]);
    expect(d.hosts.map(h => [h.name, (h as any).host, h.self, h.platform])).toEqual([["Art", "arts-mini", true, "macos"], ["Mini", "mini", false, "macos"], ["Archie", "archie", false, "linux"]]);
    // every agent's node is a mesh node, so the mesh pillars count its asks
    const nodes = new Set(d.hosts.map(h => h.name));
    for (const a of d.actors) expect(nodes.has(a.node!)).toBe(true);
    // the operator's turns are asks from that machine's person; a broker person maps to the machine whose broker holds it
    const art = d.actors.findIndex(a => a.id === "person.arts-mini");
    expect(d.asks.filter(a => a[3] === art).map(a => a[5])).toEqual(["Fix the web server route that drops the cache header", "Please inspect the iOS home and tighten the header spacing as requested"]);
  });
});

describe("World team · lanes", () => {
  test("openscout splits by top-level area; odd or top-level paths don't vote", () => {
    expect(["apps/ios/Scout/Home.swift", "packages/web/x.ts", "design/studio/a/b.tsx", "landing/index.html", "docs/x.md", "package.json", ".claude/worktrees/x/a.ts", "shasum -a 256 '/x", "apps/ios"].map(openscoutArea))
      .toEqual(["apps/ios", "packages/web", "design/studio", "landing", "docs", null, null, null, null]);
  });
  test("a session's lane is its project; openscout sessions go to the area their edits, reads and commands point at", () => {
    const home = "/Users/art";
    expect(sessionLane([call(1, "~/dev/openscout", "claude", "s", "Edit", "/Users/art/dev/openscout/apps/macos/A.swift"), call(2, "~/dev/openscout", "claude", "s", "Read", "/Users/art/dev/openscout/packages/web/a.ts")], home, {}).lane).toBe("openscout/apps/macos");
    expect(sessionLane([call(1, "~/dev/openscout", "codex", "s", "exec_command", "rg -n cache packages/runtime/src")], home, {}).lane).toBe("openscout/packages/runtime");
    expect(sessionLane([call(1, "~/dev/openscout", "codex", "s", "exec_command", "git status")], home, {}).lane).toBe("openscout");
    // worktrees fold into the repo they were cut from, including Claude Code's own and ones gone from disk
    expect(sessionLane([call(1, "~/dev/lattices-main", "claude", "s", "Bash", "ls")], home, { "~/dev/lattices-main": ["~/dev/lattices", "feat/x"] })).toEqual({ root: "~/dev/lattices-main", repo: "~/dev/lattices", lane: "lattices" });
    expect(sessionLane([call(1, "~/dev/openscout/.claude/worktrees/solo/apps/ios", "claude", "s", "Edit", "/Users/art/dev/openscout/.claude/worktrees/solo/apps/ios/A.swift")], home, {}))
      .toEqual({ root: "~/dev/openscout/.claude/worktrees/solo", repo: "~/dev/openscout", lane: "openscout/apps/ios" });
  });
  test("the busiest projects keep a lane, the rest fold into other; a worktree roots its events and folds into its lane", () => {
    const { snaps, prs } = team();
    const d = buildTeamWeek({ snapshots: snaps, config, prs, now: NOW });
    expect(d.team.lanes).toEqual(["openscout/packages/web", "lattices", "openscout/apps/ios", "other"]);
    const wt = "arts-mini:~/.codex/worktrees/ab12/openscout";
    expect(d.roots).toEqual({ [wt]: ["openscout/apps/ios", "codex/ios-header"] });
    const roots = new Set(d.events.map(e => d.strs[e[1]]));
    expect([...roots].sort()).toEqual([wt, "lattices", "openscout/packages/web"].sort());
    // mini and archie keep lattices at different paths: one lane
    expect(d.sessions.filter(s => s[2] === "lattices").map(s => s[0]).sort()).toEqual(["dddd4444", "eeee5555"]);
    // every session says which machine it ran on (team.sessionHost → team.hosts), so the HUD can solo one machine
    expect(d.team.sessionHost).toHaveLength(d.sessions.length);
    const hostOfSid = (sid: string) => d.team.hosts[d.team.sessionHost[d.sessions.findIndex(s => s[0] === sid)]].host;
    expect(["dddd4444", "eeee5555"].map(hostOfSid).sort()).toEqual(["archie", "mini"]);
    expect(hostOfSid("cccc3333")).toBe("arts-mini");
    // the PR rides on its worktree's branch
    expect(d.vcs.prs).toEqual([[Math.round((NOW - 2 * H - d.from) / 1000), Math.round((NOW - H - d.from) / 1000), "", 1300, "iOS: tighten the home header", "codex/ios-header", null, "https://github.com/arach/openscout/pull/1300"]]);
    expect(d.team.hosts.find(h => h.host === "arts-mini")!.prs).toBe(1);
    expect(githubSlug("git@github.com:arach/openscout.git")).toBe("arach/openscout");
  });
});

describe("World team · schema the engine reads", () => {
  test("same contract as the week: tuples, indexes and the vcs block all resolve", () => {
    const { snaps, prs } = team();
    const d = buildTeamWeek({ snapshots: snaps, config, prs, now: NOW, quota: [{ p: "anthropic", l: "7d", pts: [[60, 12.5]] }] });
    expect(Object.keys(d)).toEqual(["now", "from", "label", "actors", "asks", "msgs", "hosts", "events", "strs", "sessions", "work", "allow", "roots", "vcs", "quota", "usage", "usageLoose", "colds", "team", "errs", "dlv"]);
    expect(d.now - d.from).toBe(7 * 864e5);
    expect(d.label).toBe("TEAM · 3 MACHINES");
    d.actors.forEach((a, i) => { expect(a.i).toBe(i); for (const k of ["id", "name", "kind", "node", "root", "harness"]) expect(k in a).toBe(true); });
    for (const a of d.asks) {
      expect(a).toHaveLength(8); expect(["b", "t", "s"]).toContain(a[7]); expect(d.actors[a[3]]).toBeDefined(); expect(d.actors[a[4]]).toBeDefined();
      expect(["c", "f", "o"]).toContain(a[2]); expect(a[1] == null || a[1] >= a[0]).toBe(true);
    }
    // the broker ask mirrored in two brokers is one ask, linked to the codex session that did it
    const inv = d.asks.findIndex(a => a[5].startsWith("Please inspect the iOS home"));
    expect(d.asks.filter(a => a[5].startsWith("Please inspect the iOS home"))).toHaveLength(1);
    expect(d.actors[d.asks[inv][4]].name).toBe("openscout-ios-1");
    expect(d.actors[d.asks[inv][4]].root).toBe("openscout/apps/ios");
    expect(d.sessions[d.work[inv].s][0]).toBe("cccc3333");
    // the subagent's prompt is an agent asking an agent
    const sub = d.asks.find(a => a[5] === "Find where the client reads the cache header")!;
    expect([d.actors[sub[3]].name, d.actors[sub[4]].name]).toEqual(["art/web", "art/web·sub"]);
    for (const e of d.events) {
      expect(e.length === 7 || e.length === 9).toBe(true);
      expect(typeof d.strs[e[1]]).toBe("string"); expect(d.sessions[e[3]]).toBeDefined(); expect("ercbmwo").toContain(e[2]);
      if (e[6] >= 0) expect(typeof d.strs[e[6]]).toBe("string");
    }
    for (const s of d.sessions) { expect(s).toHaveLength(4); for (const [t, k] of s[3]) { expect(t).toBeGreaterThanOrEqual(0); expect(typeof d.strs[k]).toBe("string"); } }
    for (const w of Object.values(d.work)) { expect(d.sessions[w.s]).toBeDefined(); for (const f of w.files) expect(f).toHaveLength(7); }
    // remote files say where they live and are never previewable here; this machine's are
    expect(d.allow).toEqual(["/Users/art/dev/openscout/packages/web/server/a.ts"]);
    const miniWork = Object.values(d.work).find(w => w.files.some(f => f[1].includes("lattices")))!;
    expect(miniWork.files[0][0]).toBe("mini:~/dev/lattices/src/app.ts");
    expect(d.vcs.worktrees).toEqual([[Math.round((NOW - 3 * H - d.from) / 1000), "arts-mini:~/.codex/worktrees/ab12/openscout"]]);
    expect(d.vcs.branches.map(b => b[2])).toEqual(["codex/ios-header"]);
    for (const p of d.vcs.prs) expect(p).toHaveLength(8);
    expect(d.msgs).toHaveLength(1);
    expect(Object.keys(d.usage).map(Number).every(i => d.sessions[i])).toBe(true);
    expect(d.colds.length).toBe(1);
  });
});

describe("World team · collecting", () => {
  test("an unreachable host keeps its last snapshot, marked stale, and the build says so", async () => {
    const dir = await temp("world-team-");
    await mkdir(join(dir, "snapshots"), { recursive: true });
    await writeFile(join(dir, "hosts.json"), JSON.stringify({ hosts: [{ host: "ghost", persona: "Ghost", ssh: "ghost.invalid" }] }));
    const { snaps } = team();
    await writeFile(join(dir, "snapshots/ghost.json"), JSON.stringify({ ...snaps[1], host: "ghost" }));
    const [r] = await collectTeam({ dir, prs: false, timeoutMs: 20_000 });
    expect(r).toMatchObject({ host: "ghost", ok: false, stale: true, at: NOW });
    const kept = JSON.parse(await readFile(join(dir, "snapshots/ghost.json"), "utf8"));
    expect(kept.stale).toBe(true); expect(kept.raw).toHaveLength(1);
    const d = buildTeamWeek({ snapshots: await readSnapshots(dir), config: [{ host: "ghost", persona: "Ghost", ssh: "ghost.invalid" }], now: NOW });
    expect(d.hosts[0]).toMatchObject({ name: "Ghost", host: "ghost", stale: true });
    expect(d.team.hosts[0]).toMatchObject({ persona: "Ghost", stale: true, events: 1 });
    // a host that was never read is reported, not drawn
    const none = await temp("world-team-none-");
    await writeFile(join(none, "hosts.json"), JSON.stringify({ hosts: [{ host: "ghost", ssh: "ghost.invalid" }] }));
    expect((await collectTeam({ dir: none, prs: false, timeoutMs: 20_000 }))[0]).toMatchObject({ ok: false, stale: false, at: null });
  }, 60_000);
  test("the served build is null until something is collected, then rebuilt only when a snapshot changes", async () => {
    const dir = await temp("world-team-serve-");
    const service = createTeamWeekService({ dir });
    expect(await service.json()).toBeNull();
    await mkdir(join(dir, "snapshots"), { recursive: true });
    await writeFile(join(dir, "hosts.json"), JSON.stringify({ hosts: config }));
    const { snaps } = team();
    for (const s of snaps) await writeFile(join(dir, `snapshots/${s.host}.json`), JSON.stringify(s));
    const a = await service.json(), b = await service.json();
    expect(a).toBe(b);
    expect(JSON.parse(a!).hosts.map((h: { name: string }) => h.name)).toEqual(["Art", "Mini", "Archie"]);
    await writeFile(join(dir, "hosts.json"), JSON.stringify({ hosts: [{ ...config[0], persona: "Arach" }, config[1], config[2]] }));
    expect(JSON.parse((await service.json())!).hosts[0].name).toBe("Arach");
  });
  test("the collector reads a home's transcripts and broker-free git, redacts secrets and keys subagents by their own id", async () => {
    const home = await temp("world-hosts-");
    const proj = join(home, ".claude/projects/-dev-x/11112222-aaaa"), cwd = join(home, "dev/x");
    await mkdir(join(proj, "subagents"), { recursive: true }); await mkdir(cwd, { recursive: true });
    const at = Date.now() - 60_000, stamp = (t: number) => new Date(t).toISOString();
    await writeFile(join(home, ".claude/projects/-dev-x/11112222-aaaa.jsonl"), [
      { type: "user", timestamp: stamp(at), message: { content: "deploy with OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwx please" } },
      { type: "assistant", timestamp: stamp(at + 10), cwd, message: { content: [{ type: "tool_use", name: "Bash", input: { command: "curl -H 'Authorization: Bearer abcdef123456789xyz' https://api.example.com" } }] } },
    ].map(x => JSON.stringify(x)).join("\n"));
    await writeFile(join(proj, "subagents/agent-a0123456789abcdef.jsonl"), JSON.stringify({ type: "user", timestamp: stamp(at + 20), message: { content: "look around" } }));
    const s = await collectHost({ home, host: "test" });
    expect(s.sessions).toEqual([{ sid: "11112222", h: "claude" }, { sid: "89abcdef", h: "claude", sub: 1, parent: "11112222" }]);
    expect(s.inbound[0][2]).not.toContain("abcdefghijklmnop");
    expect(s.raw[0][5]).not.toContain("abcdef123456789xyz");
    // nothing that crosses ssh carries the token or the unredacted target
    const wire = JSON.stringify(s);
    for (const secret of ["abcdef123456789xyz", "abcdefghijklmnop"]) expect(wire).not.toContain(secret);
    expect(s.raw.every(r => r.length <= 7)).toBe(true);
    expect(s.broker).toBeNull();
    expect(redact("ghp_0123456789abcdefABCDEF0123 and a sha 0123456789abcdef0123456789abcdef01234567")).toBe("gh_••• and a sha 0123456789abcdef0123456789abcdef01234567");
  });
});
