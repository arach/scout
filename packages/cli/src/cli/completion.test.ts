import { preflightLifecycle } from "../../bin/lifecycle-preflight.mjs";
import { afterAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scoutCompletionCandidates, completeScoutExtension, renderScoutCompletion } from "./completion.ts";
import { scoutCommandHelp, scoutGrammarFlags } from "./command-help.ts";
import { runScoutDiscovery } from "./discovery.ts";
import { findScoutExtension, readScoutExtensionDocs, SCOUT_EXTENSION_API_VERSION } from "./extensions.ts";
import { mutateScoutExtension } from "./extension-install.ts";
import { SCOUT_COMMANDS } from "./registry.ts";

const roots: string[] = [];
afterAll(() => roots.forEach(p => rmSync(p, { recursive: true, force: true })));
function fixture(manifest: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), "scout-completion-")); roots.push(root);
  const home = join(root, "extensions"), source = join(root, "artifact");
  mkdirSync(source); mkdirSync(home);
  writeFileSync(join(source, "run"), "#!/bin/sh\nexit 99\n", { mode: 0o700 });
  const doc = "# Sample extension\n\nUse **sample status**.\n";
  const writeManifest = (extra = manifest) => writeFileSync(join(source, "extension.json"), JSON.stringify({ api: 1, version: "1.0.0", summary: "Sample", command: "run", ...extra }));
  writeManifest();
  const env = { ...process.env, OPENSCOUT_EXTENSIONS_HOME: home, SCOUT_HOME: join(root, "scout") };
  const install = () => mutateScoutExtension("install", "sample", source, env);
  const query = (words: string[]) => scoutCompletionCandidates(words, words.length - 1, env, "test");
  return { root, source, home, env, install, query, doc, writeManifest };
}
function hook(f: ReturnType<typeof fixture>, body: string) {
  writeFileSync(join(f.source, "complete"), `#!/usr/bin/env bun\n${body}\n`, { mode: 0o700 });
}

test("every registered verb has declarative grammar and round-trips flags", () => {
  for (const command of SCOUT_COMMANDS) {
    expect(command.grammar, command.name).toBeDefined();
    const flags = scoutGrammarFlags(command.grammar!.flags);
    expect(new Set(flags.map(f => f.name)).size).toBe(flags.length);
    for (const flag of flags) expect(flag.name).toMatch(/^--?[a-z][a-z-]*$/);
    const help = scoutCommandHelp([command.name], "test", { OPENSCOUT_EXTENSIONS_HOME: "/nonexistent" });
    expect(help.provider).toBe("builtin");
    for (const flag of flags) expect(help.markdown).toContain(flag.name);
  }
});

test("root, nested verbs and aliases come from the registry", async () => {
  const f = fixture();
  const root = await f.query([""]);
  for (const command of SCOUT_COMMANDS.filter(c => !c.hidden && !c.provider && c.status !== "deprecated")) expect(root).toContain(command.name);
  expect(root).not.toContain("route");
  expect(await f.query(["extensions", "in"])).toEqual(["install"]);
  expect(await f.query(["mesh", "approvals", "w"])).toEqual(["watch"]);
  expect(await f.query(["mesh", "approvals", "watch", "o"])).toEqual(["off", "on"]);
  expect(await f.query(["mesh", "access", "admin-key", "c"])).toEqual(["create"]);
  expect(await f.query(["config", "agent-names", "i"])).toEqual(["init"]);
  expect(await f.query(["route", "--ma"])).toEqual(["--machine"]);
  expect(await f.query(["help", "mesh", "ap"])).toEqual(["approvals"]);
  expect(await f.query(["relay", "search", "q"])).toEqual(["query"]);
});

test("flags, arity, inline values, cursor and literal boundary are respected", async () => {
  const f = fixture();
  expect(await f.query(["ask", "--ha"])).toEqual(["--harness"]);
  expect(await f.query(["ask", "--ver"])).toEqual([]);
  expect(await f.query(["install", "--version", ""])).toEqual([]);
  expect(await f.query(["send", "--wait", "--tr"])).toEqual(["--tracked"]);
  expect(await f.query(["--json", "search", "--harness", "codex", "q"])).toEqual(["query"]);
  expect(await f.query(["--instance", "dev", "ex"])).toEqual(["extensions"]);
  expect(await f.query(["--instance=dev", "ex"])).toEqual(["extensions"]);
  expect(await f.query(["search", "--harness", ""])).toEqual([]);
  expect(await f.query(["search", "--harness=co"])).toEqual([]);
  expect(await f.query(["search", "--", ""])).toEqual([]);
  expect(await scoutCompletionCandidates(["search", "q", "ignored"], 1, f.env)).toEqual(["query"]);
  for (const cursor of [-1, 20, 0.5, NaN]) expect(await scoutCompletionCandidates([""], cursor, f.env)).toEqual([]);
  expect(await f.query(["x".repeat(2049)])).toEqual([]);
  expect(await f.query(["bad\nword"])).toEqual([]);
});

test("API-1 without new fields still loads and offers no extension arguments", async () => {
  const f = fixture(); f.install();
  expect(SCOUT_EXTENSION_API_VERSION).toBe(1);
  expect(findScoutExtension("sample", f.env)?.refused).toBeUndefined();
  expect(await f.query(["sam"])).toEqual(["sample"]);
  expect(await f.query(["sample", ""])).toEqual([]);
  expect(scoutCommandHelp(["sample"], "test", f.env).markdown).toContain("ships no Markdown");
});

test("static words and installed Markdown are copied, with matching agent help", async () => {
  const f = fixture({ completion: ["status", "--verbose", "start", "status"], docs: "README.md" });
  writeFileSync(join(f.source, "README.md"), f.doc); f.install();
  rmSync(f.source, { recursive: true });
  expect(await f.query(["sample", "sta"])).toEqual(["start", "status"]);
  expect(await f.query(["help", "sam"])).toEqual(["sample"]);
  const help = scoutCommandHelp(["sample"], "test", f.env);
  expect(help.markdown).toBe(f.doc);
  expect(help.completion).toEqual({ kind: "static", words: ["status", "--verbose", "start"] });
  const output: string[] = [];
  await runScoutDiscovery(["help", "sample"], "test", f.env, text => output.push(text));
  await runScoutDiscovery(["help", "sample", "--json"], "test", f.env, text => output.push(text));
  expect(output[0]).toBe(f.doc);
  expect(JSON.parse(output[1]!).markdown).toBe(output[0]);
});

test("help does not execute completion or main and built-ins cannot be shadowed", async () => {
  const f = fixture({ complete: "complete", docs: "README.md" });
  const marker = join(f.root, "should-not-run");
  hook(f, `await Bun.write(${JSON.stringify(marker)}, 'ran'); throw Error('must not execute')`); writeFileSync(join(f.source, "README.md"), f.doc); f.install();
  expect(scoutCommandHelp(["sample"], "test", f.env).markdown).toBe(f.doc);
  expect(await f.query(["sam"])).toEqual(["sample"]);
  expect(existsSync(marker)).toBe(false);
  mutateScoutExtension("install", "mesh", f.source, f.env);
  expect(scoutCommandHelp(["mesh"], "test", f.env).provider).toBe("builtin");
  expect(await f.query(["mesh", "ap"])).toEqual(["approvals"]);
  expect((await f.query(["m"])).filter(w => w === "mesh")).toHaveLength(1);
});

test("hook gets argv, the filtered environment and a fixed artifact cwd", async () => {
  const f = fixture({ complete: "complete" });
  const result = join(f.root, "hook.json");
  writeFileSync(join(f.source, "complete"), `#!/bin/sh
    { printf '{"argv":["%s","%s","%s"],"env":{' "$1" "$2" "$3"
      if [ "\${SCOUT_SECRET+x}" ]; then printf '"SCOUT_SECRET":"present",'; fi
      if [ "\${OPENSCOUT_NODE_KEY+x}" ]; then printf '"OPENSCOUT_NODE_KEY":"present",'; fi
      printf '"USER_POLICY":"%s","SCOUT_OUTPUT":"%s","SCOUT_EXTENSION_API":"%s","SCOUT_CLI_VERSION":"%s","OPENSCOUT_BROKER_URL":"%s"},"cwd":"%s"}' "$USER_POLICY" "$SCOUT_OUTPUT" "$SCOUT_EXTENSION_API" "$SCOUT_CLI_VERSION" "$OPENSCOUT_BROKER_URL" "$PWD"
    } > ${JSON.stringify(result)}
    printf 'done\\n'
  `, { mode: 0o700 });
  f.install();
  const env = { ...f.env, SCOUT_SECRET: "hidden", OPENSCOUT_NODE_KEY: "hidden", USER_POLICY: "kept", OPENSCOUT_BROKER_URL: "http://127.0.0.1:43110" };
  const extension = findScoutExtension("sample", env)!;
  expect(await completeScoutExtension(extension, ["a b", "--json", ""], env, "test-version")).toEqual(["done"]);
  const record = JSON.parse(readFileSync(result, "utf8"));
  expect(record.argv).toEqual(["a b", "--json", ""]);
  expect(record.env.SCOUT_SECRET).toBeUndefined(); expect(record.env.OPENSCOUT_NODE_KEY).toBeUndefined();
  expect(record.env.USER_POLICY).toBe("kept"); expect(record.env.SCOUT_OUTPUT).toBe("plain");
  expect(record.env.SCOUT_EXTENSION_API).toBe("1"); expect(record.env.SCOUT_CLI_VERSION).toBe("test-version");
  expect(record.env.OPENSCOUT_BROKER_URL).toBe(env.OPENSCOUT_BROKER_URL);
  expect(record.cwd).toContain(".installed/sample/");
});

for (const [label, body] of [
  ["deadline", "sleep 10"],
  ["output cap", `printf '%s\\n' '${"x".repeat(17000)}'`],
  ["word cap", "i=0; while [ $i -lt 257 ]; do printf 'word\\n'; i=$((i+1)); done"],
  ["control chars", "printf 'valid\\n\\033[31mbad\\n'"],
  ["shell source", "printf '%s\\n' '$(touch /tmp/not-a-scout-file)'"],
  ["nonzero exit", "printf 'word\\n'; exit 1"],
] as const) test(`hook failure is silent and bounded: ${label}`, async () => {
  const f = fixture({ complete: "complete" });
  writeFileSync(join(f.source, "complete"), `#!/bin/sh\n${body}\n`, { mode: 0o700 }); f.install();
  const start = Date.now(); expect(await f.query(["sample", ""])).toEqual([]);
  expect(Date.now() - start).toBeLessThan(1500);
});

test("a stored extension object cannot bypass removal", async () => {
  const f = fixture({ completion: ["status"], docs: "README.md" }); writeFileSync(join(f.source, "README.md"), f.doc); f.install();
  const before = findScoutExtension("sample", f.env)!;
  mutateScoutExtension("remove", "sample", undefined, f.env);
  expect(await completeScoutExtension(before, [""], f.env, "test")).toEqual([]);
  expect(() => readScoutExtensionDocs(before, f.env)).toThrow("unavailable or refused");
  expect(await f.query(["sam"])).toEqual([]);
  expect(() => scoutCommandHelp(["sample"], "test", f.env)).toThrow("removed");
});

for (const metadata of [
  { completion: "bad" }, { completion: ["has space"] }, { completion: ["bad\nword"] }, { completion: ["trailing\n"] },
  { completion: Array(257).fill("word") }, { completion: ["x".repeat(129)] },
  { completion: ["static"], complete: "run" }, { complete: "../run" }, { complete: "/bin/sh" },
  { docs: "../README.md" }, { docs: "README.txt" }, { docs: "missing.md" }, { complete: "missing" },
]) test(`invalid optional manifest metadata is rejected before publication: ${JSON.stringify(metadata).slice(0, 70)}`, () => {
  const f = fixture(metadata); expect(() => f.install()).toThrow();
  expect(findScoutExtension("sample", f.env)).toBeUndefined();
});

test("untrusted, escaping and oversized optional files are refused without legacy fallback", () => {
  const f = fixture({ docs: "README.md" });
  writeFileSync(join(f.source, "README.md"), f.doc); f.install();
  const doc = join(f.home, "sample", "README.md");
  chmodSync(doc, 0o666); expect(findScoutExtension("sample", f.env)?.refused).toBeDefined(); chmodSync(doc, 0o600);
  writeFileSync(doc, "x".repeat(65537)); expect(findScoutExtension("sample", f.env)?.refused).toBeDefined();
  rmSync(doc); writeFileSync(join(f.root, "outside.md"), f.doc); symlinkSync(join(f.root, "outside.md"), doc);
  expect(findScoutExtension("sample", f.env)?.refused).toBeDefined();
});

test("builtin help has identical human Markdown and JSON data without handler imports", async () => {
  const f = fixture(); const output: string[] = [];
  for (const argv of [["help", "search"], ["help", "search", "--json"], ["--json", "search", "--help"]]) {
    expect(await runScoutDiscovery(argv, "test", f.env, s => output.push(s))).toBe(true);
  }
  const data = JSON.parse(output[1]!);
  expect(data.markdown).toBe(output[0]); expect(JSON.parse(output[2]!)).toEqual(data);
  expect(data.subcommands.query).toBeDefined(); expect(data.flags).toContainEqual({ name: "--harness", takesValue: true });
  expect(() => scoutCommandHelp(["missing-verb"], "test", f.env)).toThrow("unknown command");
  expect(() => scoutCommandHelp(["search", "missing-verb"], "test", f.env)).toThrow("unknown subcommand");
});

test("shell generators use the same live token query, never eval output", () => {
  for (const shell of ["bash", "zsh", "fish"]) {
    const script = renderScoutCompletion(shell);
    expect(script).toContain("scout completion --query"); expect(script).not.toContain("eval");
  }
  expect(() => renderScoutCompletion("powershell")).toThrow("zsh|bash|fish");
});

test("discovery honors instance homes without claiming or starting the instance", async () => {
  const f = fixture({ completion: ["status"] });
  const instanceRoot = join(f.root, "instance");
  const env = { ...f.env, HOME: f.root, SCOUT_HOME: undefined, OPENSCOUT_HOME: undefined, OPENSCOUT_EXTENSIONS_HOME: undefined,
    OPENSCOUT_INSTANCE_ROOT: instanceRoot, OPENSCOUT_INSTANCE_PORT_BASE: "24400" };
  mutateScoutExtension("install", "sample", f.source, { ...env, OPENSCOUT_HOME: instanceRoot });
  const output: string[] = [];
  await runScoutDiscovery(["help", "sample", "--instance=dev", "--json"], "test", env, s => output.push(s));
  expect(JSON.parse(output[0]!).name).toBe("sample");
  expect(await scoutCompletionCandidates(["--instance", "dev", "sam"], 2, env)).toEqual(["sample"]);
  expect(await scoutCompletionCandidates(["--instance=dev", "sam"], 1, env)).toEqual(["sample"]);
  expect(() => readFileSync(join(f.root, ".openscout", "instance-registry", "claims", "dev.json"))).toThrow();
});


test("agent lifecycle help contains the exact human launcher help", () => {
  for (const name of ["app", "install", "setup", "up"]) {
    const human = preflightLifecycle(["help", name]);
    expect(human).not.toBeNull();
    expect(scoutCommandHelp([name], "test", { OPENSCOUT_EXTENSIONS_HOME: "/nonexistent" }).markdown).toBe(human!);
  }
});

test("updates activate documentation and completion with the same generation", async () => {
  const f = fixture({ docs: "README.md", completion: ["old"] });
  writeFileSync(join(f.source, "README.md"), f.doc); f.install();
  writeFileSync(join(f.source, "README.md"), "# New help\n");
  f.writeManifest({ version: "1.0.1", docs: "README.md", completion: ["new"] });
  mutateScoutExtension("update", "sample", f.source, f.env);
  expect(await f.query(["sample", ""])).toEqual(["new"]);
  expect(scoutCommandHelp(["sample"], "test", f.env).markdown).toBe("# New help\n");
});
