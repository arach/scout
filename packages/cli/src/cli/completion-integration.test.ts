import { afterAll, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { renderScoutCompletion } from "./completion.ts";

const root = mkdtempSync(join(tmpdir(), "scout-shell-completion-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const home = join(root, "home"), bin = join(root, "bin"), extensions = join(root, "extensions");
mkdirSync(home); mkdirSync(bin); mkdirSync(extensions);
const entry = resolve(import.meta.dir, "../main.ts");
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
writeFileSync(join(bin, "scout"), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(entry)} "$@"\n`, { mode: 0o700 });
const env = { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", HOME: home, SCOUT_HOME: join(home, "scout"), OPENSCOUT_HOME: join(home, "legacy"),
  OPENSCOUT_SUPPORT_DIR: join(home, "support"), OPENSCOUT_CONTROL_HOME: join(home, "control"),
  OPENSCOUT_EXTENSIONS_HOME: extensions, PATH: `${bin}:${process.env.PATH}` };
async function run(command: string, args: string[], overrides = {}) {
  const child = Bun.spawn([command, ...args], { env: { ...env, ...overrides }, cwd: root, detached: process.platform !== "win32", stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => {
    try { if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch {}
  }, 10_000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { code, stdout, stderr };
  } finally { clearTimeout(timer); }
}

test("actual CLI serves completion and structured help without local state or maintenance", async () => {
  const preload = join(root, "no-maintenance.ts");
  writeFileSync(preload, `import { mock } from "bun:test";
    mock.module(${JSON.stringify(resolve(import.meta.dir, "broker-update.ts"))}, () => ({
      brokerUpdateDebugEnabled: () => false,
      ensureBrokerUptodate: () => { throw Error("discovery triggered maintenance"); },
    }));`);
  for (const args of [["completion", "bash"], ["completion", "zsh"], ["completion", "fish"],
    ["completion", "--query", "2", "--", "mesh", "approvals", "w"],
    ["help", "ask", "--json"], ["help", "--json"], ["help", "mesh", "approvals", "--json"],
    ["--json", "app", "restart", "--help"], ["help", "install", "--json"],
  ]) {
    const result = await run(process.execPath, ["--preload", preload, entry, ...args]);
    expect({ args, code: result.code, stderr: result.stderr }).toEqual({ args, code: 0, stderr: "" });
    expect(result.stdout).not.toBe("");
    if (args.includes("--json")) expect(JSON.parse(result.stdout).schemaVersion).toBe(1);
  }
  expect(readdirSync(home)).toEqual([]);
  const bad = await run(process.execPath, [entry, "completion", "powershell"]);
  expect(bad.code).toBe(1); expect(bad.stderr).toContain("zsh|bash|fish");
});

for (const shell of ["bash", "zsh"] as const) test(`${shell} script parses and completes real registry tokens`, async () => {
  const file = join(root, `${shell}-completion`); writeFileSync(file, renderScoutCompletion(shell));
  const executable = `/bin/${shell}`;
  expect((await run(executable, ["-n", file])).code).toBe(0);
  const tests = shell === "bash" ? [
    `source "$1"; COMP_WORDS=(scout extensions in); COMP_CWORD=2; _scout; printf '%s\\n' "\${COMPREPLY[@]}"`,
    `source "$1"; COMP_WORDS=(scout mesh approvals w); COMP_CWORD=3; _scout; printf '%s\\n' "\${COMPREPLY[@]}"`,
    `source "$1"; COMP_WORDS=(scout ask --ha); COMP_CWORD=2; _scout; printf '%s\\n' "\${COMPREPLY[@]}"`,
    `source "$1"; COMP_WORDS=(scout --json search --harness codex q); COMP_CWORD=5; _scout; printf '%s\\n' "\${COMPREPLY[@]}"`,
    `source "$1"; COMP_WORDS=(scout --instance dev ex); COMP_CWORD=3; _scout; printf '%s\\n' "\${COMPREPLY[@]}"`,
  ] : [
    `compdef() { :; }; compadd() { shift; print -rl -- "$@"; }; source "$1"; words=(scout extensions in); CURRENT=3; _scout`,
    `compdef() { :; }; compadd() { shift; print -rl -- "$@"; }; source "$1"; words=(scout mesh approvals w); CURRENT=4; _scout`,
    `compdef() { :; }; compadd() { shift; print -rl -- "$@"; }; source "$1"; words=(scout ask --ha); CURRENT=3; _scout`,
    `compdef() { :; }; compadd() { shift; print -rl -- "$@"; }; source "$1"; words=(scout --json search --harness codex q); CURRENT=6; _scout`,
    `compdef() { :; }; compadd() { shift; print -rl -- "$@"; }; source "$1"; words=(scout --instance dev ex); CURRENT=4; _scout`,
  ];
  for (const [i, script] of tests.entries()) {
    const result = await run(executable, ["-c", script, "fixture", file]);
    expect(result.stderr).toBe(""); expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(["install", "watch", "--harness", "query", "extensions"][i]!);
  }
});

test("query treats shell source and flags after its boundary as argv data", async () => {
  const artifact = join(extensions, "sample"); mkdirSync(artifact);
  writeFileSync(join(artifact, "extension.json"), JSON.stringify({ api: 1, command: "run", complete: "run" }));
  const captured = join(root, "argv.json"), injected = join(root, "should-not-exist");
  writeFileSync(join(artifact, "run"), `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(captured)}\nprintf 'safe\\n'\n`, { mode: 0o700 });
  const source = `$(touch ${injected})`;
  const result = await run(process.execPath, [entry, "completion", "--query", "4", "--", "sample", source, "--json", "--instance", ""]);
  expect(result.stderr).toBe(""); expect(result.stdout.trim()).toBe("safe");
  expect((await Bun.file(captured).text()).replace(/\n$/, "").split("\n")).toEqual([source, "--json", "--instance", ""]);
  expect(existsSync(injected)).toBe(false);
  chmodSync(join(artifact, "run"), 0o600);
  const refused = await run(process.execPath, [entry, "completion", "--query", "0", "--", "sam"]);
  expect(refused.stdout).toBe(""); expect(refused.stderr).toBe("");
});


test("packaged Node launcher reaches data-only help and completion", async () => {
  const packaged = join(root, "package"), dist = join(packaged, "dist", "node");
  mkdirSync(dist, { recursive: true }); mkdirSync(join(packaged, "bin"));
  const fixture = join(root, "packaged-entry.ts");
  writeFileSync(fixture, `import { runScoutDiscovery } from ${JSON.stringify(resolve(import.meta.dir, "discovery.ts"))};
    if (!await runScoutDiscovery(process.argv.slice(2), 'test')) throw Error('not a discovery command');`);
  const built = await Bun.build({ entrypoints: [fixture], target: "node", conditions: ["bun"], format: "esm", outdir: dist, naming: "main.mjs" });
  expect(built.success).toBe(true);
  for (const name of ["scout.mjs", "lifecycle-preflight.mjs"]) copyFileSync(resolve(import.meta.dir, "../../bin", name), join(packaged, "bin", name));
  writeFileSync(join(packaged, "package.json"), JSON.stringify({ version: "test" }));
  const artifact = join(extensions, "packaged"); mkdirSync(artifact);
  writeFileSync(join(artifact, "extension.json"), JSON.stringify({ api: 1, command: "run", docs: "README.md", completion: ["hello"] }));
  writeFileSync(join(artifact, "run"), "#!/bin/sh\nexit 99\n", { mode: 0o700 });
  writeFileSync(join(artifact, "README.md"), "# Packaged help\n");
  const launch = (args: string[]) => run("node", [join(packaged, "bin", "scout.mjs"), ...args], { OPENSCOUT_RUNTIME_HOST: "node" });
  const human = await launch(["help", "packaged"]), agent = await launch(["help", "packaged", "--json"]);
  expect(human.code).toBe(0); expect(agent.code).toBe(0); expect(agent.stderr).toBe("");
  expect(JSON.parse(agent.stdout).markdown).toBe(human.stdout.trimEnd() + "\n");
  const builtin = await launch(["help", "install", "--json"]);
  expect(builtin.code).toBe(0); expect(JSON.parse(builtin.stdout).markdown).toContain("Install & setup:");
  const query = await launch(["completion", "--query", "1", "--", "packaged", "he"]);
  expect(query.code).toBe(0); expect(query.stdout.trim()).toBe("hello"); expect(query.stderr).toBe("");
});
