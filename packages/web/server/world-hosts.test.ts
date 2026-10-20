import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { collectHost, type HostSession, type HostSnapshot } from "./world-hosts.ts";
import { buildTeamWeek } from "./world-team.ts";

const homes: string[] = [];
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});

test("collector walks named files before subfolders, with parents before subagents and stable team snapshots", async () => {
  const home = await mkdtemp(join(tmpdir(), "world-host-order-"));
  homes.push(home);
  const now = Date.now(), timestamp = new Date(now - 60_000).toISOString();
  const cwd = join(home, "dev/project");
  const files: { path: string; session: HostSession }[] = [];
  // Code-unit ordering is intentional: Z precedes a regardless of locale.
  // Multiple parents expose interleaved file/directory walks even on APFS.
  for (const tag of ["Z", "a", "b"]) {
    const project = `.claude/projects/${tag}-project`;
    const parents = [`${tag}1111111`, `${tag}2222222`];
    for (const sid of parents) files.push({ path: `${project}/${sid}.jsonl`, session: { sid, h: "claude" } });
    for (const [index, parent] of parents.entries()) {
      for (const suffix of ["000001", "000002"]) {
        const sid = `${tag}${index + 1}${suffix}`;
        files.push({ path: `${project}/${parent}/subagents/agent-${sid}.jsonl`, session: { sid, h: "claude", sub: 1, parent } });
      }
    }
  }
  for (const folder of ["a", "z"]) {
    for (const n of [1, 2]) {
      const sid = `000000${folder}${n}`;
      files.push({ path: `.codex/sessions/${folder}/rollout-${sid}.jsonl`, session: { sid, h: "codex" } });
    }
  }
  const seed = async (entries: typeof files) => {
    for (const { path, session } of entries) {
      const transcript = session.h === "claude" ? [
        { type: "user", timestamp, message: { content: `Inspect fixture ${session.sid}` } },
        { type: "assistant", timestamp, cwd, message: { content: [{ type: "tool_use", name: "Bash", input: { command: "echo fixture" } }] } },
      ] : [
        { type: "session_meta", payload: { cwd } },
        { timestamp, type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: `Inspect fixture ${session.sid}` }] } },
        { timestamp, payload: { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: "echo fixture", workdir: cwd }) } },
      ];
      await mkdir(dirname(join(home, path)), { recursive: true });
      await writeFile(join(home, path), transcript.map(row => JSON.stringify(row)).join("\n"));
    }
  };
  const collect = () => collectHost({ home, host: "fixture", now });
  const build = (snapshot: HostSnapshot) => buildTeamWeek({
    // Collection timestamps vary, but traversal must not change the payload.
    snapshots: [{ ...snapshot, at: now, ms: 0 }], config: [{ host: "fixture", persona: "Fixture", ssh: null }], now, wall: now,
  });
  const stable = ({ at: _at, ms: _ms, ...snapshot }: HostSnapshot) => snapshot;

  await seed([...files].reverse());
  const first = await collect();
  // Do not sort the result: the collector itself owns the traversal contract.
  expect(first.sessions).toEqual(files.map(file => file.session));
  expect(first.raw.map(row => row[3])).toEqual(files.map(file => file.session.sid));
  const team = build(first);
  expect(team.sessions).toHaveLength(files.length);
  expect(team.asks.filter(ask => ask[7] === "s")).toHaveLength(12);
  for (const root of [".claude", ".codex"]) await rm(join(home, root), { recursive: true, force: true });
  await seed(files);
  const second = await collect();
  expect(stable(second)).toEqual(stable(first));
  expect(build(second)).toEqual(team);
});
