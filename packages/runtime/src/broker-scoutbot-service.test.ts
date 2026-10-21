import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BrokerScoutbotService } from "./broker-scoutbot-service.js";

class FakeChild extends EventEmitter {
  pid: number;
  exitCode: number | null = null;
  signals: string[] = [];
  constructor(pid: number) {
    super();
    this.pid = pid;
  }
  kill(signal?: string) {
    this.signals.push(String(signal));
    this.exitCode = 0;
    queueMicrotask(() => this.emit("exit", 0, signal ?? null));
    return true;
  }
  unref() {}
}

function service(env: Record<string, string> = { OPENSCOUT_SCOUTBOT_PROCESS: "1" }) {
  const spawned: Array<{ command: string; args: readonly string[]; options: any; child: FakeChild }> = [];
  const logPath = join(mkdtempSync(join(tmpdir(), "scoutbot-service-")), "scoutbot.log");
  const scoutbot = new BrokerScoutbotService({
    brokerSocketPath: "/run/broker.sock",
    brokerUrl: "http://127.0.0.1:43110",
    env,
    resolveEntry: () => "/repo/packages/web/server/scoutbot/process/main.ts",
    resolveBun: () => ({ path: "/bin/bun" }),
    resolveLogPath: () => logPath,
    respawnBaseDelayMs: 1,
    spawnProcess: ((command: string, args: readonly string[] = [], options: any) => {
      const child = new FakeChild(100 + spawned.length);
      spawned.push({ command, args, options, child });
      return child;
    }) as any,
  });
  return { scoutbot, spawned };
}

describe("BrokerScoutbotService", () => {
  test("starts Scoutbot on the broker socket as scout-bot", () => {
    const { scoutbot, spawned } = service();
    expect(scoutbot.enabled()).toBe(true);
    scoutbot.start();
    scoutbot.start();
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.command).toBe("/bin/bun");
    expect(spawned[0]!.args).toEqual(["run", "/repo/packages/web/server/scoutbot/process/main.ts"]);
    expect(spawned[0]!.options.argv0).toBe("scout-bot");
    expect(spawned[0]!.options.env.OPENSCOUT_BROKER_SOCKET_PATH).toBe("/run/broker.sock");
    expect(scoutbot.pid()).toBe(100);
  });

  test("restarts Scoutbot when it exits, and not after stop", async () => {
    const { scoutbot, spawned } = service();
    scoutbot.start();
    spawned[0]!.child.emit("exit", 1, null);
    await Bun.sleep(20);
    expect(spawned).toHaveLength(2);
    await scoutbot.stop();
    expect(spawned[1]!.child.signals).toEqual(["SIGTERM"]);
    await Bun.sleep(20);
    expect(spawned).toHaveLength(2);
  });

  test.each([{}, { OPENSCOUT_SCOUTBOT_PROCESS: "0" }])("requires explicit enablement (%j)", (env) => {
    // Give the unset case an isolated config location too.
    const { scoutbot, spawned } = service({ OPENSCOUT_SUPPORT_DIRECTORY: mkdtempSync(join(tmpdir(), "scoutbot-disabled-")), ...env });
    expect(scoutbot.enabled()).toBe(false);
    scoutbot.start();
    expect(spawned).toHaveLength(0);
  });
});
