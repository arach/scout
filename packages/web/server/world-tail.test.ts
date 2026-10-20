import { afterEach, expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { collectHost, type HostSession } from "./world-hosts.ts";
import { tailOnce } from "./world-tail.ts";

const homes: string[] = [];
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});

test("live tail uses code-unit file-first order on initial and incremental passes, matching snapshots", async () => {
  const home = await mkdtemp(join(tmpdir(), "world-tail-order-")); homes.push(home);
  const now = Date.now(), timestamp = new Date(now - 1_000).toISOString();
  const files: { path: string; session: HostSession; data: string }[] = [];
  const add = (path: string, session: HostSession) => {
    const cwd = join(home, "dev/project");
    const rows = session.h === "claude" ? [
      { type: "user", timestamp, message: { content: "Inspect fixture" } },
      { type: "assistant", timestamp, cwd, message: { content: [{ type: "tool_use", name: "Bash", input: { command: "echo fixture" } }] } },
    ] : [
      { type: "session_meta", payload: { cwd } },
      { timestamp, payload: { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: "echo fixture", workdir: cwd }) } },
    ];
    files.push({ path: join(home, path), session, data: rows.map(row => JSON.stringify(row)).join("\n") + "\n" });
  };
  // Multiple parents expose APFS's interleaving; Z/a distinguish code-unit
  // sorting from locale order without case-only path collisions on macOS.
  for (const tag of ["Z", "a", "b"]) {
    const project = `.claude/projects/${tag}-project`, parents = [`${tag}1111111`, `${tag}2222222`];
    for (const sid of parents) add(`${project}/${sid}.jsonl`, { sid, h: "claude" });
    for (const [index, parent] of parents.entries()) for (const suffix of ["000001", "000002"]) {
      const sid = `${tag}${index + 1}${suffix}`;
      add(`${project}/${parent}/subagents/agent-${sid}.jsonl`, { sid, h: "claude", sub: 1, parent });
    }
  }
  for (const dir of ["a", "z"]) for (const n of [1, 2]) {
    const sid = `000000${dir}${n}`;
    add(`.codex/sessions/${dir}/rollout-${sid}.jsonl`, { sid, h: "codex" });
  }
  for (const file of [...files].reverse()) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.data);
  }
  const opts = { home, host: "fixture", from: now - 60_000, broker: false };
  const first = await tailOnce(opts);
  const expected = files.map(file => file.session);
  // Assert actual traversal order, never sort the collector's result.
  expect(first.batch.sessions).toEqual(expected);
  expect(first.batch.raw.map(row => row[3])).toEqual(expected.map(session => session.sid));
  expect((await collectHost({ home, host: "fixture", now })).sessions).toEqual(first.batch.sessions);
  const quiet = await tailOnce({ ...opts, state: first.state });
  expect(quiet.bytes).toBe(0); expect(quiet.batch.sessions).toEqual([]);
  for (const file of [...files].reverse()) await appendFile(file.path, file.data);
  const appended = await tailOnce({ ...opts, state: quiet.state });
  expect(appended.batch.sessions).toEqual(expected);
  expect(appended.batch.raw.map(row => row[3])).toEqual(expected.map(session => session.sid));
});
