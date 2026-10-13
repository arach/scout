import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrokerWebControlService } from "./broker-web-control-service.js";

test("the periodic monitor replaces a real child that cannot process HTTP or SIGTERM", async () => {
  const root = mkdtempSync(join(tmpdir(), "scout-web-watchdog-test-"));
  const reservation = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const port = reservation.port!;
  await reservation.stop(true);
  const entry = join(root, "web.ts");
  writeFileSync(entry, `Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.OPENSCOUT_WEB_PORT),
    fetch: req => req.headers.get("authorization") === "Bearer test-token"
      ? Response.json({ ok: true, surface: "openscout-web" }) : new Response("", { status: 401 }) });`);
  const service = new BrokerWebControlService({
    brokerControlUrl: "http://127.0.0.1:1",
    env: { OPENSCOUT_WEB_AUTH_TOKEN: "test-token", OPENSCOUT_WEB_PORT: String(port), OPENSCOUT_WEB_LAN_SCOPE: "pairing" },
    resolveEntry: () => entry,
    resolveBun: () => ({ path: process.execPath }),
    resolveLogPath: () => join(root, "web.log"),
    healthMonitorIntervalMs: 100,
    healthFailureDurationMs: 200,
    healthStartupGraceMs: 0,
    startPollTimeoutMs: 3_000,
    startPollIntervalMs: 10,
    stopTimeoutMs: 30,
    fetch: ((input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(50) })) as typeof fetch,
  });
  try {
    const started = await service.startIfNeeded();
    expect(started.ok).toBe(true);
    const oldPid = started.pid!;
    // Suspension reproduces a live process that cannot serve HTTP or handle
    // TERM, without burning CPU or touching the operator's running suite.
    process.kill(oldPid, "SIGSTOP");
    const deadline = Date.now() + 6_000;
    while (Date.now() < deadline && service.recoveryStatus().lastRecovery?.recoveredAt == null) {
      await Bun.sleep(50);
    }
    const status = await service.status();
    expect(status.running).toBe(true);
    expect(status.pid).not.toBe(oldPid);
    expect(status.recovery).toMatchObject({ state: "healthy", automaticRestarts: 1 });
    expect(status.recovery?.lastRecovery?.previousPid).toBe(oldPid);
    expect(status.recovery?.lastRecovery?.replacementPid).toBe(status.pid);
    expect(() => process.kill(oldPid, 0)).toThrow();
  } finally {
    await service.stop();
    rmSync(root, { recursive: true, force: true });
  }
}, 12_000);
