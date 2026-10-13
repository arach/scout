import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import type { BrokerServiceConfig } from "./broker-process-manager.ts";
import { renderBrokerSystemdUserUnit, runSystemdUserServiceCommand } from "./broker-process-manager.ts";
import { applyCheckoutOpenScoutInstanceDefault } from "./instance.ts";
import {
  buildSystemdUserUnitSpec,
  readOperatorUnitEnvironment,
  systemdUserLingerWarning,
  renderSystemdUserUnit,
  resolveSystemdUserUnitName,
  writeSystemdUserUnit,
  type SystemctlResult,
} from "./systemd-user-service.ts";

const healthyReader = async () => ({
  health: { ok: true, nodeId: "archie-dev-openscout" } as never,
  trace: { transport: "unix_socket" } as never,
});

/** The hand-written unit on archie (~/.config/systemd/user/scout.service). */
const HAND_WRITTEN_PROD_UNIT = `[Unit]
Description=Scout broker (installed @openscout/scout)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=PATH=%h/.cache/.bun/bin:%h/.local/share/mise/shims:%h/.local/bin:/usr/local/bin:/usr/bin
ExecStart=%h/.cache/.bun/bin/openscout-runtime broker
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;

type Fixture = {
  home: string;
  bunGlobalBin: string;
  installedPackage: string;
  checkoutRuntime: string;
  miseBun: string;
  cleanup: () => void;
};

/** A fake home with a mise Bun, a `bun add -g @openscout/scout` install and a checkout. */
function makeFixture(): Fixture {
  const home = mkdtempSync(join(tmpdir(), "openscout-systemd-unit-"));
  const bunGlobalBin = join(home, ".cache", ".bun", "bin");
  const installedPackage = join(home, ".cache", ".bun", "install", "global", "node_modules", "@openscout", "scout");
  mkdirSync(join(installedPackage, "bin"), { recursive: true });
  writeFileSync(join(installedPackage, "package.json"), "{}");
  const shimTarget = join(installedPackage, "bin", "openscout-runtime.mjs");
  writeFileSync(shimTarget, "#!/usr/bin/env bun\n");
  chmodSync(shimTarget, 0o755);
  mkdirSync(bunGlobalBin, { recursive: true });
  symlinkSync(shimTarget, join(bunGlobalBin, "openscout-runtime"));
  const miseBun = join(home, ".local", "share", "mise", "installs", "bun", "latest", "bin", "bun");
  mkdirSync(join(miseBun, ".."), { recursive: true });
  writeFileSync(miseBun, "#!/bin/sh\n");
  chmodSync(miseBun, 0o755);
  const checkoutRuntime = join(home, "dev", "openscout", "packages", "runtime");
  mkdirSync(join(checkoutRuntime, "bin"), { recursive: true });
  return {
    home,
    bunGlobalBin,
    installedPackage,
    checkoutRuntime,
    miseBun,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

function serviceConfig(fixture: Fixture, runtimePackageDir: string, port = 43110): BrokerServiceConfig {
  const support = join(fixture.home, ".local", "share", "openscout");
  return {
    label: "app.openscout",
    mode: "prod",
    uid: 1000,
    domainTarget: "gui/1000",
    serviceTarget: "gui/1000/app.openscout",
    launchAgentPath: join(fixture.home, "Library", "LaunchAgents", "app.openscout.plist"),
    supportDirectory: support,
    runtimeDirectory: join(support, "runtime"),
    logsDirectory: join(support, "logs", "broker"),
    stdoutLogPath: join(support, "logs", "broker", "stdout.log"),
    stderrLogPath: join(support, "logs", "broker", "stderr.log"),
    controlHome: join(fixture.home, ".openscout", "control-plane"),
    runtimePackageDir,
    bunExecutable: fixture.miseBun,
    brokerHost: "127.0.0.1",
    brokerPort: port,
    brokerUrl: `http://127.0.0.1:${port}`,
    brokerSocketPath: join(support, "runtime", "broker.sock"),
    advertiseScope: "local",
    coreAgents: [],
  };
}

describe("linux-systemd-user unit rendering", () => {
  test("prod renders byte-for-byte the hand-written scout.service, so adopting it is a no-op", () => {
    const fixture = makeFixture();
    try {
      const env = { XDG_CONFIG_HOME: join(fixture.home, ".config") };
      const rendered = renderBrokerSystemdUserUnit(serviceConfig(fixture, fixture.installedPackage), {
        env,
        home: fixture.home,
        bunGlobalBinDirectory: fixture.bunGlobalBin,
      });
      expect(rendered.unitName).toBe("scout.service");
      expect(rendered.unitPath).toBe(join(fixture.home, ".config", "systemd", "user", "scout.service"));
      expect(rendered.contents).toBe(HAND_WRITTEN_PROD_UNIT);

      // Adoption: an identical existing unit is left untouched.
      mkdirSync(join(rendered.unitPath, ".."), { recursive: true });
      writeFileSync(rendered.unitPath, HAND_WRITTEN_PROD_UNIT);
      expect(writeSystemdUserUnit(rendered.unitPath, rendered.contents, env)).toBe("unchanged");
    } finally {
      fixture.cleanup();
    }
  });

  test("re-rendering keeps Environment= lines the operator added, so a hand-tuned unit is adopted as-is", () => {
    const fixture = makeFixture();
    try {
      const env = { XDG_CONFIG_HOME: join(fixture.home, ".config") };
      const tuned = HAND_WRITTEN_PROD_UNIT.replace(
        "ExecStart=",
        "Environment=OPENSCOUT_ADVERTISE_SCOPE=mesh\nExecStart=",
      );
      const unitPath = join(fixture.home, ".config", "systemd", "user", "scout.service");
      mkdirSync(join(unitPath, ".."), { recursive: true });
      writeFileSync(unitPath, tuned);
      const rendered = renderBrokerSystemdUserUnit(serviceConfig(fixture, fixture.installedPackage), {
        env,
        home: fixture.home,
        bunGlobalBinDirectory: fixture.bunGlobalBin,
      });
      expect(rendered.contents).toBe(tuned);
      expect(writeSystemdUserUnit(unitPath, rendered.contents, env)).toBe("unchanged");
    } finally {
      fixture.cleanup();
    }
  });

  test("dev renders scout-dev.service from the checkout with OPENSCOUT_INSTANCE=dev", () => {
    const fixture = makeFixture();
    try {
      const env = { OPENSCOUT_INSTANCE: "dev", XDG_CONFIG_HOME: join(fixture.home, ".config") };
      const rendered = renderBrokerSystemdUserUnit(serviceConfig(fixture, fixture.checkoutRuntime, 24400), {
        env,
        home: fixture.home,
        bunGlobalBinDirectory: fixture.bunGlobalBin,
      });
      expect(rendered.unitName).toBe("scout-dev.service");
      expect(rendered.contents).toBe(`[Unit]
Description=Scout broker (dev instance, ${fixture.home}/.openscout/instances/dev)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=PATH=%h/.cache/.bun/bin:%h/.local/share/mise/shims:%h/.local/bin:/usr/local/bin:/usr/bin
Environment=OPENSCOUT_INSTANCE=dev
ExecStart=%h/.local/share/mise/installs/bun/latest/bin/bun %h/dev/openscout/packages/runtime/bin/openscout-runtime.mjs broker
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`);
    } finally {
      fixture.cleanup();
    }
  });

  test("Bun outside mise adds its own directory, not the mise shims", () => {
    const spec = buildSystemdUserUnitSpec({
      env: {},
      home: "/home/u",
      runtimePackageDir: "/home/u/checkout/packages/runtime",
      bunExecutable: "/home/u/.bun/bin/bun",
      bunGlobalBinDirectory: "/home/u/.bun/bin",
    });
    expect(spec.path).toEqual(["/home/u/.bun/bin", "/home/u/.local/bin", "/usr/local/bin", "/usr/bin"]);
    expect(renderSystemdUserUnit(spec, "/home/u")).toContain("Environment=PATH=%h/.bun/bin:%h/.local/bin:/usr/local/bin:/usr/bin");
  });

  test("unit name follows the instance; OPENSCOUT_SYSTEMD_UNIT overrides", () => {
    expect(resolveSystemdUserUnitName({})).toBe("scout.service");
    expect(resolveSystemdUserUnitName({ OPENSCOUT_INSTANCE: "dev-feature" })).toBe("scout-dev-feature.service");
    expect(resolveSystemdUserUnitName({ OPENSCOUT_SYSTEMD_UNIT: "custom" })).toBe("custom.service");
  });

  test("never silently repoints a unit owned by another runtime", () => {
    const fixture = makeFixture();
    try {
      const unitPath = join(fixture.home, "scout.service");
      writeFileSync(unitPath, HAND_WRITTEN_PROD_UNIT);
      const checkoutUnit = HAND_WRITTEN_PROD_UNIT.replace(
        "ExecStart=%h/.cache/.bun/bin/openscout-runtime broker",
        "ExecStart=/usr/bin/bun /checkout/packages/runtime/bin/openscout-runtime.mjs broker",
      );
      expect(() => writeSystemdUserUnit(unitPath, checkoutUnit, {})).toThrow("Refusing to repoint scout.service");
      expect(readFileSync(unitPath, "utf8")).toBe(HAND_WRITTEN_PROD_UNIT);
      expect(writeSystemdUserUnit(unitPath, checkoutUnit, { OPENSCOUT_ALLOW_SHARED_SERVICE_REPOINT: "1" })).toBe("written");
    } finally {
      fixture.cleanup();
    }
  });
});

describe("linux-systemd-user lifecycle", () => {
  function fakeSystemctl(initiallyActive = false) {
    const calls: string[][] = [];
    let active = initiallyActive;
    const run = (args: string[]): SystemctlResult => {
      calls.push(args);
      if (args[0] === "start" || args[0] === "restart") active = true;
      if (args[0] === "stop") active = false;
      if (args[0] === "show") {
        return {
          status: 0,
          stdout: active
            ? "LoadState=loaded\nActiveState=active\nSubState=running\nUnitFileState=enabled\nMainPID=4242\nExecMainStatus=0\n"
            : "LoadState=loaded\nActiveState=inactive\nSubState=dead\nUnitFileState=enabled\nMainPID=0\nExecMainStatus=1\n",
          stderr: "",
        };
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    return { calls, run };
  }

  const healthy = healthyReader;

  test("start installs, reloads, enables and starts the instance's unit", async () => {
    const fixture = makeFixture();
    try {
      const env = { OPENSCOUT_INSTANCE: "dev", XDG_CONFIG_HOME: join(fixture.home, ".config") };
      const systemctl = fakeSystemctl();
      const config = {
        ...serviceConfig(fixture, fixture.checkoutRuntime, 24400),
        supportDirectory: join(fixture.home, ".openscout", "instances", "dev", "support"),
        controlHome: join(fixture.home, ".openscout", "instances", "dev", "control-plane"),
        brokerSocketPath: join(fixture.home, ".openscout", "instances", "dev", "support", "runtime", "broker.sock"),
      };
      const status = await runSystemdUserServiceCommand("start", config, {
        env,
        home: fixture.home,
        bunGlobalBinDirectory: fixture.bunGlobalBin,
        systemctl: systemctl.run,
        readHealth: healthy,
        lingerWarning: () => null,
      });
      const show = ["show", "scout-dev.service", "--property=LoadState,ActiveState,SubState,UnitFileState,MainPID,ExecMainStatus"];
      expect(systemctl.calls).toEqual([
        ["daemon-reload"],
        ["enable", "scout-dev.service"],
        show,
        ["start", "scout-dev.service"],
        show,
      ]);
      expect(existsSync(join(fixture.home, ".config", "systemd", "user", "scout-dev.service"))).toBe(true);
      expect(status).toMatchObject({
        serviceAdapter: "linux-systemd-user",
        instance: "dev",
        installed: true,
        loaded: true,
        pid: 4242,
        launchdState: "active/running",
        bootoutCommand: "systemctl --user stop scout-dev.service",
        reachable: true,
      });
    } finally {
      fixture.cleanup();
    }
  });

  test("a dev instance refuses to install a unit onto prod's port or directories", async () => {
    const fixture = makeFixture();
    try {
      const env = { OPENSCOUT_INSTANCE: "dev", XDG_CONFIG_HOME: join(fixture.home, ".config"), HOME: fixture.home };
      const systemctl = fakeSystemctl();
      await expect(runSystemdUserServiceCommand("install", serviceConfig(fixture, fixture.checkoutRuntime, 43110), {
        env,
        home: fixture.home,
        bunGlobalBinDirectory: fixture.bunGlobalBin,
        systemctl: systemctl.run,
        readHealth: healthy,
        lingerWarning: () => null,
      })).rejects.toThrow('Refusing to start the scout-dev.service service for OpenScout instance "dev"');
      expect(systemctl.calls).toEqual([]);
      expect(existsSync(join(fixture.home, ".config", "systemd", "user", "scout-dev.service"))).toBe(false);
    } finally {
      fixture.cleanup();
    }
  });
});

function devConfig(fixture: Fixture): BrokerServiceConfig {
  const root = join(fixture.home, ".openscout", "instances", "dev");
  return {
    ...serviceConfig(fixture, fixture.checkoutRuntime, 24400),
    supportDirectory: join(root, "support"),
    controlHome: join(root, "control-plane"),
    brokerSocketPath: join(root, "support", "runtime", "broker.sock"),
  };
}

function lifecycleSystemctl(initiallyActive: boolean) {
  const calls: string[][] = [];
  let active = initiallyActive;
  const run = (args: string[]): SystemctlResult => {
    calls.push(args);
    if (args[0] === "start" || args[0] === "restart") active = true;
    if (args[0] === "stop") active = false;
    if (args[0] === "show") {
      return {
        status: 0,
        stdout: `ActiveState=${active ? "active" : "failed"}\nSubState=${active ? "running" : "failed"}\nExecMainStatus=${active ? 0 : 1}\n`,
        stderr: "",
      };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  return { calls, run };
}

describe("review fixes: systemd lifecycle", () => {
  test("a prod unit that runs checkout code pins OPENSCOUT_INSTANCE=prod, so the broker never takes the checkout default", () => {
    const fixture = makeFixture();
    try {
      // A real-looking checkout: .git + packages/runtime/src/instance.ts.
      const checkout = join(fixture.home, "dev", "openscout-wt");
      const runtime = join(checkout, "packages", "runtime");
      mkdirSync(join(runtime, "src"), { recursive: true });
      mkdirSync(join(runtime, "bin"), { recursive: true });
      writeFileSync(join(runtime, "src", "instance.ts"), "");
      writeFileSync(join(checkout, ".git"), "gitdir: /elsewhere\n");
      const spec = buildSystemdUserUnitSpec({
        env: {},
        home: fixture.home,
        runtimePackageDir: runtime,
        bunExecutable: fixture.miseBun,
        bunGlobalBinDirectory: fixture.bunGlobalBin,
      });
      expect(spec.unitName).toBe("scout.service");
      expect(spec.environment).toContainEqual(["OPENSCOUT_INSTANCE", "prod"]);
      expect(renderSystemdUserUnit(spec, fixture.home)).toContain("Environment=OPENSCOUT_INSTANCE=prod\n");
      // The env systemd hands the broker keeps it prod.
      const unitEnv: Record<string, string | undefined> = Object.fromEntries(spec.environment);
      expect(applyCheckoutOpenScoutInstanceDefault(join(runtime, "src"), unitEnv)).toBeNull();
      expect(unitEnv.OPENSCOUT_INSTANCE).toBe("prod");

      // Even through the global shim, a shim that resolves into a checkout pins prod.
      const linkedBin = join(fixture.home, "linked-bin");
      mkdirSync(linkedBin, { recursive: true });
      writeFileSync(join(runtime, "bin", "openscout-runtime.mjs"), "");
      symlinkSync(join(runtime, "bin", "openscout-runtime.mjs"), join(linkedBin, "openscout-runtime"));
      const linked = buildSystemdUserUnitSpec({
        env: {},
        home: fixture.home,
        runtimePackageDir: runtime,
        bunExecutable: fixture.miseBun,
        bunGlobalBinDirectory: linkedBin,
      });
      expect(linked.environment).toContainEqual(["OPENSCOUT_INSTANCE", "prod"]);
    } finally {
      fixture.cleanup();
    }
  });

  test("start restarts a running unit whose definition changed", async () => {
    const fixture = makeFixture();
    try {
      const env = { OPENSCOUT_INSTANCE: "dev", XDG_CONFIG_HOME: join(fixture.home, ".config") };
      const systemctl = lifecycleSystemctl(true);
      await runSystemdUserServiceCommand("start", devConfig(fixture), {
        env, home: fixture.home, bunGlobalBinDirectory: fixture.bunGlobalBin,
        systemctl: systemctl.run, readHealth: healthyReader, lingerWarning: () => null,
      });
      expect(systemctl.calls.map((call) => call[0])).toEqual(["daemon-reload", "enable", "show", "restart", "show"]);
    } finally {
      fixture.cleanup();
    }
  });

  test("a unit that never becomes healthy fails start instead of reporting success", async () => {
    const fixture = makeFixture();
    try {
      const env = { OPENSCOUT_INSTANCE: "dev", XDG_CONFIG_HOME: join(fixture.home, ".config") };
      const systemctl = lifecycleSystemctl(false);
      const crashLoop = { ...systemctl, run: (args: string[]) => {
        const result = systemctl.run(args);
        if (args[0] === "start") systemctl.run(["stop"]);
        return result;
      } };
      await expect(runSystemdUserServiceCommand("start", devConfig(fixture), {
        env, home: fixture.home, bunGlobalBinDirectory: fixture.bunGlobalBin,
        systemctl: crashLoop.run, readHealth: async () => { throw new Error("connection refused"); },
        healthTimeoutMs: 300, lingerWarning: () => null,
      })).rejects.toThrow("scout-dev.service did not become healthy");
    } finally {
      fixture.cleanup();
    }
  });

  test("stop and uninstall never touch a unit owned by another runtime", async () => {
    const fixture = makeFixture();
    try {
      const env = { XDG_CONFIG_HOME: join(fixture.home, ".config") };
      const unitPath = join(fixture.home, ".config", "systemd", "user", "scout.service");
      mkdirSync(join(unitPath, ".."), { recursive: true });
      writeFileSync(unitPath, HAND_WRITTEN_PROD_UNIT);
      const systemctl = lifecycleSystemctl(true);
      // A checkout acting as prod is not the hand-written unit's owner.
      for (const command of ["stop", "uninstall"] as const) {
        await expect(runSystemdUserServiceCommand(command, serviceConfig(fixture, fixture.checkoutRuntime), {
          env, home: fixture.home, bunGlobalBinDirectory: fixture.bunGlobalBin,
          systemctl: systemctl.run, readHealth: healthyReader, lingerWarning: () => null,
        })).rejects.toThrow(`Refusing to ${command} scout.service`);
      }
      expect(systemctl.calls).toEqual([]);
      expect(readFileSync(unitPath, "utf8")).toBe(HAND_WRITTEN_PROD_UNIT);
    } finally {
      fixture.cleanup();
    }
  });

  test("a dev instance cannot stop prod's unit by naming it", async () => {
    const fixture = makeFixture();
    try {
      const env = {
        OPENSCOUT_INSTANCE: "dev",
        OPENSCOUT_SYSTEMD_UNIT: "scout",
        XDG_CONFIG_HOME: join(fixture.home, ".config"),
      };
      const systemctl = lifecycleSystemctl(true);
      await expect(runSystemdUserServiceCommand("stop", devConfig(fixture), {
        env, home: fixture.home, bunGlobalBinDirectory: fixture.bunGlobalBin,
        systemctl: systemctl.run, readHealth: healthyReader, lingerWarning: () => null,
      })).rejects.toThrow("OPENSCOUT_SYSTEMD_UNIT=scout is prod's service");
      expect(systemctl.calls).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  test("status reports a lingering warning", async () => {
    const fixture = makeFixture();
    try {
      const env = { OPENSCOUT_INSTANCE: "dev", XDG_CONFIG_HOME: join(fixture.home, ".config") };
      const systemctl = lifecycleSystemctl(true);
      await runSystemdUserServiceCommand("install", devConfig(fixture), {
        env, home: fixture.home, bunGlobalBinDirectory: fixture.bunGlobalBin,
        systemctl: systemctl.run, readHealth: healthyReader, lingerWarning: () => "Lingering is off",
      }).then((status) => expect(status.warnings).toEqual(["Lingering is off"]));
    } finally {
      fixture.cleanup();
    }
  });
});

describe("review fixes: unit escaping", () => {
  const spec = {
    unitName: "scout-esc.service",
    instance: "esc",
    description: "Scout broker (100% test)",
    execStart: ["/usr/bin/env", "/home/u/My Projects/scout/bin/openscout-runtime.mjs", "50%", "$HOME", 'say "hi"'],
    path: ["/home/u/.bun/bin", "/opt/a b/bin", "/usr/bin"],
    environment: [
      ["OPENSCOUT_INSTANCE", "esc"],
      ["OPENSCOUT_INSTANCE_ROOT", "/home/u/Scout Data/esc"],
      ["NOTE", 'x%y "q" \\ end'],
    ] as Array<[string, string]>,
  };

  test("quotes and escapes Environment= and ExecStart= per systemd.syntax", () => {
    const text = renderSystemdUserUnit(spec, "/home/u");
    expect(text).toContain('Environment="PATH=%h/.bun/bin:/opt/a b/bin:/usr/bin"');
    expect(text).toContain('Environment="OPENSCOUT_INSTANCE_ROOT=%h/Scout Data/esc"'.replace("%h", "/home/u"));
    expect(text).toContain('Environment="NOTE=x%%y \\"q\\" \\\\ end"');
    expect(text).toContain('ExecStart=/usr/bin/env "%h/My Projects/scout/bin/openscout-runtime.mjs" 50%% $$HOME "say \\"hi\\""');
    expect(text).toContain("Description=Scout broker (100%% test)");
  });

  test("systemd-analyze accepts the rendered unit when available", () => {
    const analyze = spawnSync("systemd-analyze", ["--version"], { encoding: "utf8" });
    if (analyze.status !== 0) return;
    const dir = mkdtempSync(join(tmpdir(), "openscout-unit-verify-"));
    try {
      const unitFile = join(dir, "scout-esc.service");
      writeFileSync(unitFile, renderSystemdUserUnit(spec, "/home/u"));
      const result = spawnSync("systemd-analyze", ["--user", "verify", unitFile], { encoding: "utf8" });
      const complaints = `${result.stderr}${result.stdout}`
        .split("\n")
        .filter((line) => /invalid|ignoring|failed to|unbalanced|bad/i.test(line) && !/is not executable|No such file/i.test(line));
      expect(complaints).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("operator lines written with quotes or several assignments survive re-rendering", () => {
    const fixture = makeFixture();
    try {
      const env = { XDG_CONFIG_HOME: join(fixture.home, ".config") };
      const tuned = HAND_WRITTEN_PROD_UNIT.replace(
        "ExecStart=",
        'Environment="OPENSCOUT_WEB_TRUSTED_HOSTS=a.example b.example" OPENSCOUT_MESH_ID=home\nEnvironment=OPENSCOUT_ADVERTISE_SCOPE=mesh\nExecStart=',
      );
      const unitPath = join(fixture.home, ".config", "systemd", "user", "scout.service");
      mkdirSync(join(unitPath, ".."), { recursive: true });
      writeFileSync(unitPath, tuned);
      const rendered = renderBrokerSystemdUserUnit(serviceConfig(fixture, fixture.installedPackage), {
        env, home: fixture.home, bunGlobalBinDirectory: fixture.bunGlobalBin,
      });
      expect(rendered.contents).toBe(tuned);
      expect(readOperatorUnitEnvironment('Environment="PATH=/x" "KEEP=a b"')).toEqual(['Environment="KEEP=a b"']);
    } finally {
      fixture.cleanup();
    }
  });
});

describe("review round 3: lows", () => {
  test("C escapes in operator Environment= lines are decoded like systemd", () => {
    expect(readOperatorUnitEnvironment('Environment="PATH=/x" "NOTE=a\\nb\\tc\\x41\\101\\u0042"'))
      .toEqual(['Environment="NOTE=a\nb\tcAAB"']);
  });

  test("a runtime reached through a symlink into a checkout still pins its instance", () => {
    const fixture = makeFixture();
    try {
      const checkout = join(fixture.home, "dev", "openscout");
      const runtime = join(checkout, "packages", "runtime");
      mkdirSync(join(runtime, "src"), { recursive: true });
      mkdirSync(join(runtime, "bin"), { recursive: true });
      writeFileSync(join(runtime, "src", "instance.ts"), "");
      writeFileSync(join(runtime, "bin", "openscout-runtime.mjs"), "");
      writeFileSync(join(checkout, ".git"), "gitdir: /elsewhere\n");
      const link = join(fixture.home, "linked-runtime");
      symlinkSync(runtime, link);
      const bin = join(fixture.home, "bin-link");
      mkdirSync(bin);
      symlinkSync(join(link, "bin", "openscout-runtime.mjs"), join(bin, "openscout-runtime"));
      const spec = buildSystemdUserUnitSpec({
        env: {}, home: fixture.home, runtimePackageDir: link, bunExecutable: fixture.miseBun, bunGlobalBinDirectory: bin,
      });
      expect(spec.environment).toContainEqual(["OPENSCOUT_INSTANCE", "prod"]);
    } finally {
      fixture.cleanup();
    }
  });

  test("the linger check reads the passed env; a warning is re-checked, an OK is cached per runner", () => {
    let calls = 0;
    let linger = "no";
    const run = (args: string[]): SystemctlResult => {
      calls += 1;
      expect(args).toEqual(["show-user", "linger-test-user", "--property=Linger"]);
      return { status: 0, stdout: `Linger=${linger}\n`, stderr: "" };
    };
    const env = { USER: "linger-test-user" };
    expect(systemdUserLingerWarning(run, env)).toContain("loginctl enable-linger linger-test-user");
    // Enabling linger clears the warning on the very next status.
    linger = "yes";
    expect(systemdUserLingerWarning(run, env)).toBeNull();
    expect(calls).toBe(2);
    expect(systemdUserLingerWarning(run, env)).toBeNull();
    expect(calls).toBe(2);
    // Another runner (another test) has its own cache.
    const other = (_args: string[]): SystemctlResult => ({ status: 0, stdout: "Linger=no\n", stderr: "" });
    expect(systemdUserLingerWarning(other, env)).toContain("Lingering is off");
  });

});
