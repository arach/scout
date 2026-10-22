import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MachineRecord } from "@openscout/protocol";

import { createScoutCommandContext, type ScoutCommandContext } from "../context.ts";
import { ScoutCliError } from "../errors.ts";
import { emptyReading, readRuntimeIdentityFromDoctorStream, type MachineUpdateReading } from "../machine-update.ts";
import { readSshConfigAliases, resolveMachineSshDestination, runUpdateCommand } from "./update.ts";

const NOW = Date.now();
const previousExitCode = process.exitCode;

// The command sets process.exitCode and never clears it — main.ts owns the
// process. Zero it per test so one failing run cannot leak into the next.
beforeEach(() => {
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = previousExitCode;
});

function machine(overrides: Partial<MachineRecord> & { name: string }): MachineRecord {
  return {
    id: `machine-${overrides.name.toLowerCase().replace(/\s+/g, "-")}`,
    displayName: null,
    platform: "macos",
    identityKeys: [],
    isSelf: false,
    hostNames: [`${overrides.name.toLowerCase()}.local`],
    addresses: [],
    macAddresses: [],
    capabilities: ["ssh"],
    routes: [],
    evidence: [],
    pinned: false,
    firstSeenAt: NOW - 86_400_000,
    lastSeenAt: NOW - 1_000,
    ...overrides,
  } as MachineRecord;
}

function harness() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const context: ScoutCommandContext = createScoutCommandContext({
    cwd: "/tmp/openscout",
    env: {},
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    outputMode: "plain",
    isTty: false,
  });
  return { context, stdout, stderr, text: () => stdout.join("\n") };
}

/** Stands in for the real installer: records calls, answers `--check` in JSON. */
function fakeInstall(installed = "0.2.100", target = "0.2.101") {
  const calls: string[][] = [];
  const install = async (context: ScoutCommandContext, args: string[]) => {
    calls.push(args);
    if (args.includes("--check")) {
      context.output.writeValue(
        { action: "check", status: "update-available", installed, target, bundlePath: "/Applications/Scout.app", message: "" },
        () => "",
      );
    }
  };
  return { install, calls };
}

/** A machine whose app, CLI, and runtime all sit on one version. */
function converged(version: string, overrides: Partial<MachineUpdateReading> = {}) {
  return {
    appVersion: version,
    cliVersion: version,
    runtimeVersion: version,
    runtimeIntentional: false,
    unmanagedScoutProcesses: [],
    suite: healthySuite(),
    ...overrides,
  };
}

/** A suite that is running with every service owned by the installed bundle. */
function healthySuite() {
  return {
    running: true,
    missingLayers: [],
    foreign: [],
    problems: [],
    issues: [],
    state: "healthy" as const,
  };
}

/** A synthetic inventory of `count` claude-held mcp bridges. */
function bridgeList(count: number) {
  return Array.from({ length: count }, (_unused, index) => ({
    pid: 1000 + index,
    ppid: 90001,
    elapsed: "01:00:00",
    command: "bun /Users/o/dev/openscout/packages/cli/bin/scout.mjs mcp",
    bridge: "mcp" as const,
    client: "claude",
    parentCommand: "/Users/o/.local/bin/claude",
    launchdLabel: null,
  }));
}

function probeFor(readings: Record<string, Partial<MachineUpdateReading>>) {
  return async (target: MachineRecord): Promise<MachineUpdateReading> => ({
    ...emptyReading(),
    ...readings[target.name],
  });
}

function fixtureText(name: string): string {
  return readFileSync(new URL(`../test-fixtures/${name}`, import.meta.url), "utf8");
}

const coreDoctorStream = fixtureText("scout-doctor-core.ndjson");
const pinnedServiceStatus = JSON.parse(fixtureText("scout-runtime-service-status-pinned.json"));
const REMOTE_RUNTIME_STATUS_JS = [
  'const env = process.env;',
  'env.OPENSCOUT_INSTANCE = env.OPENSCOUT_INSTANCE?.trim() || env.OPENSCOUT_CLIENT_INSTANCE?.trim() || "prod";',
  'const result = require("node:child_process").spawnSync("openscout-runtime", ["service", "status", "--json"], { env, stdio: "inherit" });',
  'process.exit(result.status ?? 1);',
].join(" ");
const REMOTE_RUNTIME_STATUS_SHELL =
  `js=$(command -v node || command -v bun) || exit 127; exec "$js" -e '${REMOTE_RUNTIME_STATUS_JS}'`;
const remoteRuntimeCommand = ["/bin/sh", "-c", "'" + REMOTE_RUNTIME_STATUS_SHELL.replace(/'/g, "'\\''") + "'"];

/** Exercise the real default probe, not dependencies.probe. Every executable
 * boundary is a fixture; neither a local service nor an SSH host is contacted. */
function defaultProbeFixture(
  service: (remote: boolean, read: number) => { stdout: string; stderr?: string; exitCode?: number },
  version: (remote: boolean) => string = () => "0.2.100",
) {
  const calls: string[][] = [];
  const reads = { local: 0, remote: 0 };
  const exec = async ({ argv }: { argv: string[]; timeoutMs: number }) => {
    calls.push(argv);
    const remote = argv[0] === "ssh";
    const remoteCommand = remote ? argv.slice(2) : argv;
    const command = remoteCommand.join(" ") === remoteRuntimeCommand.join(" ")
      ? ["openscout-runtime", "service", "status", "--json"] : remoteCommand;
    let stdout: string;
    if (command.join(" ") === "openscout-runtime service status --json") {
      const result = service(remote, ++reads[remote ? "remote" : "local"]);
      return { stderr: "", exitCode: 0, ...result };
    } else if (command.join(" ") === "scout doctor --json") {
      stdout = coreDoctorStream;
    } else if (command.join(" ") === "scout install --check --json") {
      stdout = JSON.stringify({ installed: version(remote) });
    } else if (command.join(" ") === "scout --version") {
      stdout = `${version(remote)}\n`;
    } else if (command.join(" ") === "scout app status --json") {
      stdout = fixtureText("scout-app-status-healthy.json");
    } else if (command.join(" ") === "ps -axo pid=,ppid=,etime=,args=") {
      stdout = "";
    } else {
      throw Error(`Unexpected fixture executable: ${JSON.stringify(argv)}`);
    }
    return { stdout, stderr: "", exitCode: 0 };
  };
  return { exec, calls, reads };
}

describe("scout update — runtime service probe", () => {
  for (const isSelf of [true, false]) {
    test(`default ${isSelf ? "local" : "remote"} probe preserves a hold after core-only doctor JSON`, async () => {
      // Captured from #100's real doctor command against an isolated /health
      // fixture. It deliberately carries no artifact freshness or hold verdict.
      expect(readRuntimeIdentityFromDoctorStream(coreDoctorStream)).toEqual({
        runtimeVersion: null, runtimeIntentional: null, runtimeState: null, runtimeCommit: null,
      });
      const target = machine({ name: "FixturePeer", isSelf, hostNames: ["c100-fixture.invalid"], scoutNodeId: "node-fixture" });
      const { context, text } = harness();
      const { install, calls: installs } = fakeInstall();
      const fixture = defaultProbeFixture(() => ({ stdout: JSON.stringify(pinnedServiceStatus) }));
      await runUpdateCommand(context, [target.name, "--json"], {
        loadMachines: async () => ({ machines: [target] }), install, exec: fixture.exec,
      });
      expect(JSON.parse(text()).machines[0]).toMatchObject({
        state: "source-owned", execution: "none", reading: {
          runtimeVersion: "0.2.78", runtimeIntentional: true, runtimeState: "pinned",
          runtimeCommit: "1111111111111111111111111111111111111111",
        },
      });
      expect(installs).toEqual([["--check"]]);
      expect(fixture.calls).toContainEqual(isSelf
        ? ["openscout-runtime", "service", "status", "--json"]
        : ["ssh", "c100-fixture.invalid", ...remoteRuntimeCommand]);
      expect(fixture.calls.some(argv => argv.includes("doctor") || argv.includes("--fix"))).toBe(false);
      expect(process.exitCode).toBe(0);
    });
  }

  const unknownCases = [
    ["missing runtime command", { stdout: "", stderr: "openscout-runtime: command not found", exitCode: 127 }],
    ["refused status even with plausible stdout", { stdout: JSON.stringify(pinnedServiceStatus), exitCode: 69 }],
    ["invalid JSON", { stdout: "not JSON" }],
    ["core-only doctor stream", { stdout: coreDoctorStream }],
    ...[null, [], true, 42, "0.2.100"].map((value, index) =>
      [`non-object status ${index}`, { stdout: JSON.stringify(value) }] as const),
    ["absent freshness despite a health/build version", { stdout: JSON.stringify({
      health: { build: { version: "0.2.100" } }, scoutdState: { runtimeBuild: { version: "0.2.100" } },
    }) }],
    ...[
      null,
      { state: "current", version: "0.2.100" },
      { state: "current", version: "0.2.100", intentional: "false" },
      { state: "current", version: 100, intentional: false },
      { version: "0.2.100", intentional: false },
      { state: "current", intentional: false },
      { state: "", version: "0.2.100", intentional: false },
      { state: "  ", version: "0.2.100", intentional: false },
      { state: "current", version: "", intentional: false },
      { state: "current", version: "  ", intentional: false },
      { state: "current", version: "0.2.100", intentional: null },
      { state: "current", version: "0.2.100", intentional: 0 },
    ].map((runtimeFreshness, index) => [`invalid freshness ${index}`, { stdout: JSON.stringify({ runtimeFreshness }) }] as const),
  ] as const;
  for (const [name, response] of unknownCases) {
    test(`${name} leaves both machines unreadable and installs nothing`, async () => {
      const targets = [true, false].map(isSelf => machine({
        name: isSelf ? "FixtureSelf" : "FixturePeer", isSelf, hostNames: ["c100-fixture.invalid"],
      }));
      const { context, text } = harness();
      const { install, calls: installs } = fakeInstall();
      const fixture = defaultProbeFixture(() => response);
      let remoteInstalls = 0;
      await runUpdateCommand(context, [...targets.map(target => target.name), "--json"], {
        loadMachines: async () => ({ machines: targets }), install, exec: fixture.exec,
        remoteInstall: async () => { remoteInstalls++; throw Error("Unexpected install"); },
      });
      for (const plan of JSON.parse(text()).machines) {
        expect(plan).toMatchObject({ state: "unreadable", execution: "none", reading: {
          runtimeVersion: null, runtimeIntentional: null, runtimeState: null, runtimeCommit: null,
        } });
      }
      expect(installs).toEqual([["--check"]]);
      expect(remoteInstalls).toBe(0);
      expect(fixture.reads).toEqual({ local: 1, remote: 1 });
      expect(fixture.calls.some(argv => argv.includes("doctor") || argv.includes("--fix"))).toBe(false);
      expect(process.exitCode).toBe(1);
    });
  }

  for (const isSelf of [true, false]) for (const intentional of [true, false]) {
    test(`a nullable ${isSelf ? "local" : "remote"} service version retains the explicit hold observation: ${intentional}`, async () => {
      const target = machine({ name: "FixtureSelf", isSelf, hostNames: ["c100-fixture.invalid"] });
      const { context, text } = harness();
      const { install, calls: installs } = fakeInstall();
      const fixture = defaultProbeFixture(() => ({ stdout: JSON.stringify({
        runtimeFreshness: { ...pinnedServiceStatus.runtimeFreshness, version: null,
          intentional, state: intentional ? "pinned" : "unverified" },
        // Only the public runtimeFreshness contract supplies the version.
        scoutdState: { runtimeBuild: { version: "0.2.100" } },
        health: { build: { version: "0.2.100" } },
      }) }));
      await runUpdateCommand(context, [target.name, "--json"], {
        loadMachines: async () => ({ machines: [target] }), install, exec: fixture.exec,
      });
      expect(JSON.parse(text()).machines[0]).toMatchObject({
        state: intentional ? "source-owned" : "unreadable", execution: "none",
        reading: { runtimeVersion: null, runtimeIntentional: intentional,
          runtimeState: intentional ? "pinned" : "unverified" },
      });
      expect(installs).toEqual([["--check"]]);
      expect(process.exitCode).toBe(intentional ? 0 : 1);
    });
  }

  test("local and remote probes keep their own runtime versions and hold observations", async () => {
    const targets = [
      machine({ name: "FixtureSelf", isSelf: true }),
      machine({ name: "FixturePeer", hostNames: ["c100-fixture.invalid"] }),
    ];
    const { context, text } = harness();
    const { install } = fakeInstall();
    const fixture = defaultProbeFixture(remote => ({ stdout: JSON.stringify({ ...pinnedServiceStatus,
      instance: remote ? "remote-selected-instance" : "local-selected-instance",
      runtimeFreshness: { ...pinnedServiceStatus.runtimeFreshness,
        version: remote ? "0.2.99" : "0.2.98", intentional: remote, state: remote ? "pinned" : "current",
      },
    }) }));
    await runUpdateCommand(context, [...targets.map(target => target.name), "--check", "--json"], {
      loadMachines: async () => ({ machines: targets }), install, exec: fixture.exec,
    });
    const plans = JSON.parse(text()).machines;
    expect(plans[0]).toMatchObject({ label: "FixtureSelf", state: "update-available",
      reading: { runtimeVersion: "0.2.98", runtimeIntentional: false } });
    expect(plans[1]).toMatchObject({ label: "FixturePeer", state: "source-owned",
      reading: { runtimeVersion: "0.2.99", runtimeIntentional: true } });
    expect(fixture.calls.filter(argv => argv.some(arg => arg.includes("openscout-runtime")))).toEqual([
      ["openscout-runtime", "service", "status", "--json"],
      ["ssh", "c100-fixture.invalid", ...remoteRuntimeCommand],
    ]);
  });

  for (const runtime of ["node", "bun"] as const) for (const selection of [
    { env: { OPENSCOUT_INSTANCE: "remote-explicit", OPENSCOUT_CLIENT_INSTANCE: "remote-pointer" }, expected: "remote-explicit" },
    { env: { OPENSCOUT_CLIENT_INSTANCE: "remote-pointer" }, expected: "remote-pointer" },
    { env: {}, expected: "prod" },
    { env: { OPENSCOUT_INSTANCE: " \t\n", OPENSCOUT_CLIENT_INSTANCE: "remote-pointer" }, expected: "remote-pointer" },
    { env: { OPENSCOUT_INSTANCE: "\uFEFF\u00a0", OPENSCOUT_CLIENT_INSTANCE: "remote-pointer" }, expected: "remote-pointer" },
    { env: { OPENSCOUT_INSTANCE: "", OPENSCOUT_CLIENT_INSTANCE: " \t\n" }, expected: "prod" },
  ]) {
    test.skipIf(runtime === "node" && !Bun.which("node"))(`remote service probe preserves the target's instance selection via ${runtime}: ${selection.expected}`, async () => {
      const root = mkdtempSync(join(tmpdir(), "update-remote-instance-"));
      try {
        symlinkSync(runtime === "node" ? Bun.which("node")! : process.execPath, join(root, runtime));
        symlinkSync(process.execPath, join(root, "fixture-js"));
        const executable = join(root, "openscout-runtime");
        writeFileSync(executable, `#!/bin/sh\nexec "\${0%/*}/fixture-js" -e 'console.log(JSON.stringify({runtimeFreshness:{version:"0.2.78",intentional:true,state:"pinned"},instance:process.env.OPENSCOUT_INSTANCE}))'\n`);
        chmodSync(executable, 0o755);
        const target = machine({ name: "FixturePeer", hostNames: ["c100-fixture.invalid"] });
        const { context, text } = harness();
        const { install, calls: installs } = fakeInstall();
        const fixture = defaultProbeFixture(() => { throw Error("Must exercise the target-shell fixture"); });
        context.env.OPENSCOUT_INSTANCE = "caller-must-not-leak";
        context.env.OPENSCOUT_CLIENT_INSTANCE = "caller-pointer-must-not-leak";
        const observedInstances: string[] = [];
        await runUpdateCommand(context, [target.name, "--json"], {
          loadMachines: async () => ({ machines: [target] }), install,
          exec: async input => {
            if (!input.argv.some(arg => arg.includes("openscout-runtime"))) return fixture.exec(input);
            expect(input.argv.slice(0, 2)).toEqual(["ssh", "c100-fixture.invalid"]);
            // Model only OpenSSH's target-shell boundary, in an owned local
            // process with a fake runtime executable. No SSH or service runs.
            const child = Bun.spawn(["/bin/sh", "-c", input.argv.slice(2).join(" ")], {
              env: { HOME: root, PATH: root, ...selection.env },
              stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 5_000,
            });
            const [exitCode, stdout, stderr] = await Promise.all([
              child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
            ]);
            expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
            observedInstances.push(JSON.parse(stdout).instance);
            return { exitCode, stdout, stderr };
          },
        });
        expect(observedInstances).toEqual([selection.expected]);
        expect(JSON.parse(text()).machines[0].state).toBe("source-owned");
        expect(installs).toEqual([["--check"]]);
      } finally { rmSync(root, { recursive: true, force: true }); }
    });
  }

  for (const missing of ["interpreter", "runtime"] as const) {
    test(`the target shell refuses a missing ${missing} without a private or doctor fallback`, async () => {
      const root = mkdtempSync(join(tmpdir(), "update-missing-runtime-"));
      try {
        if (missing === "runtime") symlinkSync(process.execPath, join(root, "bun"));
        const target = machine({ name: "FixturePeer", hostNames: ["c100-fixture.invalid"] });
        const { context, text } = harness();
        const { install, calls: installs } = fakeInstall();
        const fixture = defaultProbeFixture(() => { throw Error("Unexpected fake status read"); });
        let statusReads = 0;
        await runUpdateCommand(context, [target.name, "--json"], {
          loadMachines: async () => ({ machines: [target] }), install,
          exec: async input => {
            if (!input.argv.some(arg => arg.includes("openscout-runtime"))) return fixture.exec(input);
            statusReads++;
            const child = Bun.spawn(["/bin/sh", "-c", input.argv.slice(2).join(" ")], {
              env: { HOME: root, PATH: root, OPENSCOUT_CLIENT_INSTANCE: "remote-pointer" },
              stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 5_000,
            });
            const [exitCode, stdout, stderr] = await Promise.all([
              child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
            ]);
            expect(exitCode).not.toBe(0);
            return { exitCode, stdout, stderr };
          },
        });
        expect(statusReads).toBe(1);
        expect(installs).toEqual([["--check"]]);
        expect(JSON.parse(text()).machines[0]).toMatchObject({ state: "unreadable", execution: "none",
          reading: { runtimeVersion: null, runtimeIntentional: null } });
        expect(fixture.calls.some(argv => argv.includes("doctor") || argv.includes("--fix"))).toBe(false);
        expect(process.exitCode).toBe(1);
      } finally { rmSync(root, { recursive: true, force: true }); }
    });
  }

  for (const isSelf of [true, false]) {
    test(`the ${isSelf ? "local" : "remote candidate"} installer is followed by a fresh service-status probe`, async () => {
      const target = machine({ name: "FixturePeer", isSelf, hostNames: ["c100-fixture.invalid"], scoutNodeId: "node-fixture" });
      const { context, text } = harness();
      const { install: lookup, calls: installs } = fakeInstall();
      let installed = false;
      const fixture = defaultProbeFixture(() => ({ stdout: JSON.stringify({ ...pinnedServiceStatus,
        runtimeFreshness: { ...pinnedServiceStatus.runtimeFreshness,
          version: installed && isSelf ? "0.2.101" : "0.2.100", intentional: false, state: "current",
        },
      }) }), () => installed ? "0.2.101" : "0.2.100");
      const artifact = isSelf ? [] : ["--candidate", "/fixture/candidate", "--dmg", "/fixture/Scout.dmg"];
      let remoteInstalls = 0;
      await runUpdateCommand(context, [target.name, "--json", ...artifact], {
        loadMachines: async () => ({ machines: [target] }), exec: fixture.exec,
        install: async (ctx, args) => { await lookup(ctx, args); if (!args.includes("--check")) installed = true; },
        remoteInstall: async options => {
          expect(options.target.destination).toBe("c100-fixture.invalid");
          remoteInstalls++; installed = true; return { schema: "openscout.remote-native-update.v1" };
        },
      });
      expect(installed).toBe(true);
      expect(fixture.reads).toEqual(isSelf ? { local: 2, remote: 0 } : { local: 0, remote: 2 });
      expect(remoteInstalls).toBe(isSelf ? 0 : 1);
      expect(installs).toEqual(isSelf ? [["--check"], []] : [["--check", ...artifact]]);
      expect(JSON.parse(text()).machines[0]).toMatchObject({
        state: isSelf ? "up-to-date" : "update-available",
        reading: { runtimeVersion: isSelf ? "0.2.101" : "0.2.100", runtimeIntentional: false },
      });
      expect(JSON.parse(text()).status).toBe(isSelf ? "components-updated" : "partial");
      expect(process.exitCode).toBe(isSelf ? 0 : 1);
      // Keep the existing result scope; component equality is not bridge proof.
      expect(JSON.parse(text()).unverified.length).toBeGreaterThan(0);
    });
  }

  for (const isSelf of [true, false]) test(`a failed ${isSelf ? "local" : "remote candidate"} post-install service read stays partial instead of reusing the old verdict`, async () => {
    const target = machine({ name: "FixtureSelf", isSelf, hostNames: ["c100-fixture.invalid"], scoutNodeId: "node-fixture" });
    const { context, text } = harness();
    const { install: lookup } = fakeInstall();
    let installed = false;
    const fixture = defaultProbeFixture((_remote, read) => read === 1
      ? { stdout: JSON.stringify({ runtimeFreshness: { version: "0.2.100", intentional: false, state: "current" } }) }
      : { stdout: "", exitCode: 127 }, () => installed ? "0.2.101" : "0.2.100");
    const artifact = isSelf ? [] : ["--candidate", "/fixture/candidate", "--dmg", "/fixture/Scout.dmg"];
    let remoteInstalls = 0;
    await runUpdateCommand(context, [target.name, "--json", ...artifact], {
      loadMachines: async () => ({ machines: [target] }), exec: fixture.exec,
      install: async (ctx, args) => { await lookup(ctx, args); if (!args.includes("--check")) installed = true; },
      remoteInstall: async () => { installed = true; remoteInstalls++; return { schema: "openscout.remote-native-update.v1" }; },
    });
    expect(installed).toBe(true);
    expect(remoteInstalls).toBe(isSelf ? 0 : 1);
    expect(fixture.reads).toEqual(isSelf ? { local: 2, remote: 0 } : { local: 0, remote: 2 });
    expect(JSON.parse(text())).toMatchObject({ status: "partial", machines: [{
      state: "unreadable", reading: { runtimeVersion: null, runtimeIntentional: null },
    }] });
    expect(process.exitCode).toBe(1);
  });
});

describe("scout update — local compatibility", () => {
  test("with no machine name it delegates every argument to the installer", async () => {
    // `update` was an alias for `install`; that behaviour has to survive intact.
    const { context } = harness();
    const { install, calls } = fakeInstall();
    await runUpdateCommand(context, ["--force", "--version", "0.2.101"], { install });
    expect(calls).toEqual([["--force", "--version", "0.2.101"]]);
  });

  test("a bare `scout update --check` is the installer's own check", async () => {
    const { context } = harness();
    const { install, calls } = fakeInstall();
    await runUpdateCommand(context, ["--check"], { install });
    expect(calls).toEqual([["--check"]]);
  });

  test("prints help without touching the installer", async () => {
    const { context, text } = harness();
    const { install, calls } = fakeInstall();
    await runUpdateCommand(context, ["--help"], { install });
    expect(calls).toEqual([]);
    expect(text()).toContain("scout update Air Mini");
  });
});

describe("scout update — named machines", () => {
  const air = machine({
    name: "Air",
    evidence: [{ kind: "scout", nodeId: "node-air", nodeName: "air", observedAt: NOW }],
  });
  const mini = machine({ name: "Mini" });
  const studio = machine({ name: "Studio", isSelf: true });
  const loadMachines = async () => ({ machines: [air, mini, studio] });

  test("reports a remote machine as planned and exits nonzero, never as updated", async () => {
    // The heart of the contract: this command cannot finish a remote update, so
    // it must not be scriptable as though it did.
    const { context, text } = harness();
    const { install, calls } = fakeInstall();
    await runUpdateCommand(context, ["Air"], {
      install,
      loadMachines,
      probe: probeFor({ Air: converged("0.2.100") }),
    });

    expect(process.exitCode).toBe(1);
    expect(text()).toContain("planned");
    expect(text()).not.toContain("components-updated");
    expect(text()).toContain("Not performed remotely.");
    // Only the target lookup ran; no install was attempted for a remote box.
    expect(calls).toEqual([["--check"]]);
  });

  test("--check on a remote machine reports the plan and exits nonzero", async () => {
    const { context, text } = harness();
    const { install } = fakeInstall();
    await runUpdateCommand(context, ["Air", "--check"], {
      install,
      loadMachines,
      probe: probeFor({ Air: converged("0.2.100") }),
    });
    // One rule in both modes: exit 0 means settled. An update is due here, and a
    // script gating on the exit code must not read that as nothing to do.
    expect(process.exitCode).toBe(1);
    expect(text()).toContain("planned");
  });

  test("installs on the local machine, re-reads it, and reports components-updated", async () => {
    const { context, text } = harness();
    const { install, calls } = fakeInstall();
    // The second read is what justifies the word "updated": the machine is
    // asked again after the installer ran, not assumed to have converged.
    let reads = 0;
    await runUpdateCommand(context, ["Studio"], {
      install,
      loadMachines,
      probe: async () => {
        reads += 1;
        return { ...emptyReading(), ...converged(reads === 1 ? "0.2.100" : "0.2.101") };
      },
    });
    expect(reads).toBe(2);
    expect(calls).toEqual([["--check"], []]);
    expect(text()).toContain("components-updated");
    expect(text()).toContain("Ran the installer on: Studio");
    expect(process.exitCode).toBe(0);
  });

  test("an install that leaves the CLI behind is `partial`, not updated", async () => {
    // `scout install` moves the app. The CLI is a separate package, and a
    // machine still on an older CLI has not converged.
    const { context, text } = harness();
    const { install } = fakeInstall();
    let reads = 0;
    await runUpdateCommand(context, ["Studio"], {
      install,
      loadMachines,
      probe: async () => {
        reads += 1;
        return {
          ...emptyReading(),
          ...converged(reads === 1 ? "0.2.100" : "0.2.101", { cliVersion: "0.2.98" }),
        };
      },
    });
    expect(text()).toContain("partial");
    expect(text()).not.toContain("components-updated");
    expect(process.exitCode).toBe(1);
  });

  test("--check never installs, even on the local machine", async () => {
    const { context } = harness();
    const { install, calls } = fakeInstall();
    await runUpdateCommand(context, ["Studio", "--check"], {
      install,
      loadMachines,
      probe: probeFor({ Studio: converged("0.2.100") }),
    });
    expect(calls).toEqual([["--check"]]);
  });

  test("passes a requested version through to the installer", async () => {
    const { context } = harness();
    const { install, calls } = fakeInstall("0.2.99", "0.2.100");
    await runUpdateCommand(context, ["Studio", "--version", "0.2.100"], {
      install,
      loadMachines,
      probe: probeFor({ Studio: converged("0.2.99") }),
    });
    expect(calls).toEqual([["--check", "--version", "0.2.100"], ["--version", "0.2.100"]]);
  });

  test("refuses to downgrade and fails the run", async () => {
    const { context, text } = harness();
    const { install, calls } = fakeInstall("0.2.101", "0.2.101");
    await runUpdateCommand(context, ["Studio", "--version", "0.2.101"], {
      install,
      loadMachines,
      probe: probeFor({ Studio: converged("0.2.102") }),
    });
    expect(text()).toContain("refusing to downgrade");
    expect(calls).toEqual([["--check", "--version", "0.2.101"]]);
    expect(process.exitCode).toBe(1);
  });

  test("holds a source-owned runtime and installs nothing", async () => {
    const { context, text } = harness();
    const { install, calls } = fakeInstall();
    await runUpdateCommand(context, ["Studio"], {
      install,
      loadMachines,
      probe: probeFor({ Studio: converged("0.2.78", { runtimeIntentional: true, runtimeState: "pinned" }) }),
    });
    expect(text()).toContain("source-owned");
    expect(calls).toEqual([["--check"]]);
    expect(process.exitCode).toBe(0);
  });

  test("fails closed on an unknown name before reading or installing anything", async () => {
    const { context } = harness();
    const { install, calls } = fakeInstall();
    let probed = 0;
    await expect(
      runUpdateCommand(context, ["Air", "Nope"], {
        install,
        loadMachines,
        probe: async (target) => {
          probed += 1;
          return probeFor({ Air: converged("0.2.100") })(target);
        },
      }),
    ).rejects.toThrow(ScoutCliError);
    // A run that updates two of three named machines and then stops is worse
    // than one that never starts.
    expect(probed).toBe(0);
    expect(calls).toEqual([]);
  });

  test("names the known machines when a name does not resolve", async () => {
    const { context } = harness();
    const { install } = fakeInstall();
    const error = await runUpdateCommand(context, ["Nope"], { install, loadMachines }).catch((e) => e);
    expect(error.message).toContain("Nope is not a known machine");
    expect(error.message).toContain("Air, Mini, Studio");
  });

  test("says what it counted and what it still cannot prove, on every run", async () => {
    const { context, text } = harness();
    const { install } = fakeInstall();
    await runUpdateCommand(context, ["Air", "--check"], {
      install,
      loadMachines,
      probe: probeFor({ Air: converged("0.2.101", { unmanagedScoutProcesses: [] }) }),
    });
    expect(text()).toContain("components-current");
    expect(text()).toContain("bridges outside the managed suite: none");
    // A count of zero is not proof that every Scout process is on the target.
    expect(text()).toContain("not proof of convergence");
  });

  test("will not call a machine current while harness bridges hold old code", async () => {
    // Air carried app, CLI, and runtime 0.2.101 with 18 bridges still on
    // pre-update code, and a broker restart did not replace them.
    const { context, text } = harness();
    const { install } = fakeInstall();
    await runUpdateCommand(context, ["Air", "--check"], {
      install,
      loadMachines,
      probe: probeFor({ Air: converged("0.2.101", { unmanagedScoutProcesses: bridgeList(18) }) }),
    });
    expect(text()).toContain("bridges-pending");
    expect(text()).not.toContain("components-current");
    expect(text()).toContain("18 Scout processes outside the managed suite");
    // A check that reports work and then withholds what to do about it has told
    // the operator half of the answer.
    expect(text()).toContain("Still outstanding:");
    expect(text()).toContain("Reconnect their Scout connections in the owning harness session");
    // The pids and the harness holding them, not just a number.
    expect(text()).toContain("claude (18:");
    expect(text()).toContain("pid 1000 ppid 90001");
  });

  test("will not call a machine current while a suite service is missing or foreign", async () => {
    const { context, text } = harness();
    const { install } = fakeInstall();
    await runUpdateCommand(context, ["Air", "--check"], {
      install,
      loadMachines,
      probe: probeFor({
        Air: converged("0.2.101", {
          suite: {
            running: true,
            missingLayers: ["app", "menu"],
            foreign: [{ layer: "app", pid: 676, executable: "/Users/o/dev/openscout/dist/Scout.app" }],
            problems: ["no app process is running"],
            issues: [
              "no app process is running",
              "app is held by a foreign build (pid 676): /Users/o/dev/openscout/dist/Scout.app",
              "no menu process is running",
            ],
            state: "service-problems",
          },
        }),
      }),
    });
    expect(text()).toContain("suite-problems");
    expect(text()).not.toContain("components-current");
    // The owner of the foreign service is named; "foreign" alone is not actionable.
    expect(text()).toContain("pid 676");
    expect(text()).toContain("Still outstanding:");
    expect(text()).toContain("settle which build owns it");
    expect(process.exitCode).toBe(1);
  });

  test("reports suite problems on a held machine too", async () => {
    // A source-owned hold is a decision about the runtime; it says nothing about
    // a service the installed bundle no longer owns.
    const { context, text } = harness();
    const { install } = fakeInstall();
    await runUpdateCommand(context, ["Studio", "--check"], {
      install,
      loadMachines,
      probe: probeFor({
        Studio: converged("0.2.78", {
          runtimeIntentional: true,
          runtimeState: "pinned",
          suite: {
            running: true,
            missingLayers: ["app"],
            foreign: [],
            problems: ["no app process is running"],
            issues: ["no app process is running"],
            state: "service-problems",
          },
        }),
      }),
    });
    expect(text()).toContain("Studio — source-owned");
    expect(text()).toContain("Separately, the managed suite reports: no app process is running");
  });

  test("says the managed suite is healthy when it is", async () => {
    const { context, text } = harness();
    const { install } = fakeInstall();
    await runUpdateCommand(context, ["Air", "--check"], {
      install,
      loadMachines,
      probe: probeFor({ Air: converged("0.2.101") }),
    });
    expect(text()).toContain("managed suite: running, all services owned by the installed bundle");
    expect(text()).toContain("managed-suite-services");
  });

  test("requires a matching job PID before suggesting a mesh bridge kickstart", async () => {
    // arts-mini pid 995: ppid 1, in no `scout app status` layer, and neither an
    // install nor `scout app restart` bounces it.
    const { context, text } = harness();
    const { install } = fakeInstall();
    await runUpdateCommand(context, ["Air", "--check"], {
      install,
      loadMachines,
      probe: probeFor({
        Air: converged("0.2.101", {
          unmanagedScoutProcesses: [
            ...bridgeList(2),
            {
              pid: 995,
              ppid: 1,
              elapsed: "02:28:46",
              command: "bun /Users/o/dev/openscout/apps/desktop/bin/scout.ts mesh bridge",
              bridge: "mesh" as const,
              client: "launchd",
              parentCommand: "/sbin/launchd",
              launchdLabel: null,
            },
          ],
        }),
      }),
    });
    expect(text()).toContain("bridges-pending");
    // The two kinds of bridge need two different actions.
    expect(text()).toContain("2 held by a harness session");
    expect(text()).toContain("1 with ppid 1 (launchd or orphan; pid 995)");
    expect(text()).toContain("launchctl list app.openscout.mcp-bridge");
    expect(text()).toContain("hand the bridge to scout-base");
    expect(text()).toContain("scout mesh bridge install");
    expect(text()).toContain("job ownership is unverified");
    expect(text()).toContain("compare its PID. Only if it matches");
    expect(text()).not.toContain("owned by launchd as");
    expect(text()).toContain("mesh — launchd");
    expect(text()).not.toContain("unknown client");
  });

  test("a check exits nonzero while bridges or suite services are outstanding", async () => {
    for (const reading of [
      { unmanagedScoutProcesses: bridgeList(18) },
      {
        suite: {
          running: true,
          missingLayers: ["app"],
          foreign: [],
          problems: ["no app process is running"],
          issues: ["no app process is running"],
          state: "service-problems" as const,
        },
      },
      { unmanagedScoutProcesses: null },
    ]) {
      process.exitCode = 0;
      const { context } = harness();
      const { install } = fakeInstall();
      await runUpdateCommand(context, ["Air", "--check"], {
        install,
        loadMachines,
        probe: probeFor({ Air: converged("0.2.101", reading) }),
      });
      // Scripts gate on the exit code; a settled 0 here would be a false complete.
      expect(process.exitCode).toBe(1);
    }
  });

  test("a requested update fails while bridges are still pending", async () => {
    const { context } = harness();
    const { install } = fakeInstall();
    await runUpdateCommand(context, ["Air"], {
      install,
      loadMachines,
      probe: probeFor({ Air: converged("0.2.101", { unmanagedScoutProcesses: bridgeList(18) }) }),
    });
    expect(process.exitCode).toBe(1);
  });

  test("points at the per-machine candidate path when the target is unpublished", async () => {
    // 0.2.101 publication was blocked; a named update installs published
    // artifacts only, and has to say where the authorized path actually is.
    const { context } = harness();
    const install = async (_c: ScoutCommandContext, args: string[]) => {
      if (args.includes("--check")) {
        _c.output.writeValue({ action: "check", installed: "0.2.100", target: null }, () => "");
      }
    };
    const error = await runUpdateCommand(context, ["Air", "--version", "0.2.101"], {
      install,
      loadMachines,
    }).catch((e) => e);
    expect(error.message).toContain("published artifact only");
    expect(error.message).toContain("scout install --candidate");
  });

  test("serves a signed local candidate to this machine", async () => {
    // 0.2.101 publication was blocked, so the authorized artifact was a signed
    // local build. The installer selects it; this command just names it.
    const { context, text } = harness();
    const { install, calls } = fakeInstall("0.2.100", "0.2.101");
    let reads = 0;
    await runUpdateCommand(
      context,
      ["Studio", "--candidate", "/tmp/candidate", "--dmg", "/tmp/candidate/Scout.dmg"],
      {
        install,
        loadMachines,
        probe: async () => ({
          ...emptyReading(),
          ...converged(reads++ === 0 ? "0.2.100" : "0.2.101", { unmanagedScoutProcesses: [] }),
        }),
      },
    );
    const artifact = ["--candidate", "/tmp/candidate", "--dmg", "/tmp/candidate/Scout.dmg"];
    expect(calls).toEqual([["--check", ...artifact], artifact]);
    expect(text()).toContain("(candidate)");
    expect(text()).toContain("components-updated");
  });

  test("sends a signed candidate to a remote machine through the helper", async () => {
    const { context, text } = harness();
    const { install } = fakeInstall("0.2.100", "0.2.101");
    const calls: unknown[] = [];
    let reads = 0;
    await runUpdateCommand(
      context,
      ["Air", "--candidate", "/tmp/candidate", "--dmg", "/tmp/candidate/Scout.dmg"],
      {
        install,
        loadMachines,
        remoteInstall: async (opts) => {
          calls.push(opts);
          return { schema: "openscout.remote-native-update.v1" };
        },
        probe: async () => ({
          ...emptyReading(),
          // The helper installs the native app only; the CLI and runtime do not move.
          ...converged(reads++ === 0 ? "0.2.100" : "0.2.100", {
            appVersion: reads === 1 ? "0.2.100" : "0.2.101",
            unmanagedScoutProcesses: [],
          }),
        }),
      },
    );
    expect(calls).toHaveLength(1);
    // The node identity the helper verifies before it installs anything.
    expect((calls[0] as { expectedNodeIds: string[] }).expectedNodeIds).toEqual(["node-air"]);
    expect(text()).toContain("partial");
    expect(text()).toContain("Still outstanding:");
    expect(text()).toContain("cli and runtime still behind");
    expect(process.exitCode).toBe(1);
  });

  test("will not send a candidate to a machine with no Scout node identity", async () => {
    // The helper verifies which node it landed on; without an identity to
    // check against, an ssh alias could resolve to the wrong machine.
    const { context, text } = harness();
    const { install } = fakeInstall("0.2.100", "0.2.101");
    let called = false;
    await runUpdateCommand(
      context,
      ["Mini", "--candidate", "/tmp/candidate", "--dmg", "/tmp/candidate/Scout.dmg"],
      {
        install,
        loadMachines,
        remoteInstall: async () => { called = true; return {}; },
        probe: probeFor({ Mini: converged("0.2.100", { unmanagedScoutProcesses: [] }) }),
      },
    );
    expect(called).toBe(false);
    expect(text()).toContain("No Scout node identity to verify remotely");
    expect(process.exitCode).toBe(1);
  });

  test("a remote helper failure is a failure, never an assumed update", async () => {
    const { context } = harness();
    const { install } = fakeInstall("0.2.100", "0.2.101");
    await expect(runUpdateCommand(
      context,
      ["Air", "--candidate", "/tmp/candidate", "--dmg", "/tmp/candidate/Scout.dmg"],
      {
        install,
        loadMachines,
        remoteInstall: async () => {
          throw new Error("Remote installer receipt identity was not confirmed");
        },
        probe: probeFor({ Air: converged("0.2.100", { unmanagedScoutProcesses: [] }) }),
      },
    )).rejects.toThrow(/receipt identity was not confirmed/);
  });

  test("requires --candidate and --dmg together", async () => {
    const { context } = harness();
    const { install } = fakeInstall();
    await expect(
      runUpdateCommand(context, ["Studio", "--candidate", "/tmp/candidate"], { install, loadMachines }),
    ).rejects.toThrow(/must be given together/);
  });

  test("still rejects --force, which bypasses the checks this command exists for", async () => {
    const { context } = harness();
    const { install } = fakeInstall();
    await expect(
      runUpdateCommand(context, ["Air", "--force"], { install, loadMachines }),
    ).rejects.toThrow(ScoutCliError);
  });

  test("reports a probe failure as blocked rather than out of date", async () => {
    const { context, text } = harness();
    const { install, calls } = fakeInstall();
    await runUpdateCommand(context, ["Air"], {
      install,
      loadMachines,
      probe: async () => {
        throw new Error("ssh: connect to host air port 22: Host is down");
      },
    });
    expect(text()).toContain("Host is down");
    expect(text()).toContain("blocked");
    expect(calls).toEqual([["--check"]]);
    expect(process.exitCode).toBe(1);
  });

  test("reports app, CLI, and runtime versions separately", async () => {
    // The CLI can lag its own app: Mini ran app 0.2.100 against CLI 0.2.98.
    const { context, text } = harness();
    const { install } = fakeInstall();
    await runUpdateCommand(context, ["Mini", "--check"], {
      install,
      loadMachines,
      probe: probeFor({
        Mini: converged("0.2.100", { cliVersion: "0.2.98", runtimeVersion: "0.2.78" }),
      }),
    });
    expect(text()).toContain("app 0.2.100 (behind), cli 0.2.98 (behind), runtime 0.2.78 (behind)");
  });
});

describe("resolveMachineSshDestination", () => {
  const aliases = new Set(["air", "mini"]);

  test("an ssh config alias wins outright and is passed through verbatim", () => {
    // The alias carries the username and identity file; a tailnet address does
    // not, and Air/Mini need `arach` rather than the local user.
    const host = resolveMachineSshDestination(
      machine({
        name: "air",
        routes: [{ kind: "tailnet", host: "air.tail1234.ts.net" }],
      }),
      { aliases },
    );
    expect(host).toBe("air");
  });

  test("prefers a tailnet name over a LAN name when no alias matches", () => {
    const host = resolveMachineSshDestination(machine({
      name: "Studio",
      routes: [
        { kind: "lan", host: "studio.local" },
        { kind: "tailnet", host: "studio.tail1234.ts.net" },
      ],
    }), { aliases });
    expect(host).toBe("studio.tail1234.ts.net");
  });

  test("picks the DNS name out of a real tailnet route set", () => {
    // The shape the inventory actually returns: IPv4, IPv6, and a name for the
    // same identity. Refusing all three would make the command useless.
    const host = resolveMachineSshDestination(machine({
      name: "Studio",
      routes: [
        { kind: "tailnet", host: "100.115.12.115" },
        { kind: "tailnet", host: "fd7a:115c:a1e0::383a:c73" },
        { kind: "tailnet", host: "studio.tail1e8e67.ts.net" },
        { kind: "mesh", host: "other.tail1e8e67.ts.net" },
      ],
    }));
    expect(host).toBe("studio.tail1e8e67.ts.net");
  });

  test("applies --ssh-user to a derived address", () => {
    const host = resolveMachineSshDestination(
      machine({ name: "Studio", routes: [{ kind: "lan", host: "studio.local" }] }),
      { sshUser: "arach" },
    );
    expect(host).toBe("arach@studio.local");
  });

  test("falls back to a lone address when the tier has no name", () => {
    expect(resolveMachineSshDestination(machine({
      name: "Studio",
      routes: [{ kind: "lan", host: "192.168.1.20" }],
      hostNames: [],
    }))).toBe("192.168.1.20");
  });

  test("refuses when the winning tier holds two distinct identities", () => {
    // A command that restarts a broker may not guess which box it means.
    expect(() => resolveMachineSshDestination(machine({
      name: "Studio",
      routes: [
        { kind: "tailnet", host: "studio.tail1234.ts.net" },
        { kind: "tailnet", host: "studio-2.tail1234.ts.net" },
      ],
    }))).toThrow(/unambiguous/);
  });

  test("an alias reaches a tailnet-only Mac that advertises no ssh", () => {
    // `ssh` is derived from a Bonjour `_ssh._tcp` advert, which never crosses
    // the LAN. Mini is real, reachable, and named in the ssh config; without
    // this the gate would refuse every Mac that is not on this subnet.
    const host = resolveMachineSshDestination(
      machine({
        name: "mini",
        capabilities: ["scout-broker", "scout-web"],
        routes: [{ kind: "tailnet", host: "mini.tail1234.ts.net" }],
      }),
      { aliases },
    );
    expect(host).toBe("mini");
  });

  test("refuses a machine that does not advertise ssh", () => {
    expect(() => resolveMachineSshDestination(machine({ name: "Studio", capabilities: [] })))
      .toThrow(/does not advertise ssh/);
  });

  test("refuses a machine with no reachable hostname", () => {
    expect(() => resolveMachineSshDestination(machine({ name: "Studio", hostNames: [], routes: [] })))
      .toThrow(/no reachable hostname/);
  });
});

describe("readSshConfigAliases", () => {
  test("collects literal Host tokens and skips wildcard patterns", () => {
    const aliases = readSshConfigAliases(() => [
      "Host air mini",
      "  User arach",
      "Host *.example.com",
      "Host studio",
      "Host *",
    ].join("\n"));
    expect([...aliases].sort()).toEqual(["air", "mini", "studio"]);
  });

  test("returns nothing when there is no ssh config to read", () => {
    expect(readSshConfigAliases(() => { throw new Error("ENOENT"); }).size).toBe(0);
  });
});
