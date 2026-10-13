import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const brokerEntry = join(import.meta.dir, "broker-daemon.ts");

/**
 * Every port the broker could touch is a scratch value below the Linux
 * ephemeral range and clear of prod's 431xx, so this test can never reach
 * a prod port.
 */
function scratchEnv(root: string, port: number): Record<string, string | undefined> {
  return {
    PATH: process.env.PATH,
    HOME: root,
    OPENSCOUT_BROKER_PORT: String(port),
    OPENSCOUT_LISTENING_PORT: "30381",
    OPENSCOUT_WEB_PORT: "30382",
    OPENSCOUT_WEB_TERMINAL_RELAY_PORT: "30383",
    OPENSCOUT_PAIRING_PORT: "30384",
    OPENSCOUT_JETSTREAM_PORT: "30387",
    OPENSCOUT_JETSTREAM_MONITOR_PORT: "30388",
    OPENSCOUT_BROKER_INTERNAL_URL: `http://127.0.0.1:${port}`,
    OPENSCOUT_HOME: join(root, "home"),
    OPENSCOUT_CONTROL_HOME: join(root, "control"),
    OPENSCOUT_SUPPORT_DIRECTORY: join(root, "support"),
    OPENSCOUT_RELAY_HUB: join(root, "relay"),
    OPENSCOUT_SCOUT_HOME: join(root, "scout"),
    OPENSCOUT_PAIRING_HOME: join(root, "pairing"),
    OPENSCOUT_BROKER_SOCKET_PATH: join(root, "broker.sock"),
    OPENSCOUT_PROBES_SOCKET: join(root, "missing-probes.sock"),
    OPENSCOUT_NODE_QUALIFIER: "busy-port-test",
    OPENSCOUT_NETWORK_DISCOVERY_ENABLED: "0",
    OPENSCOUT_MESH_RENDEZVOUS_URL: "false",
    OPENSCOUT_MESH_SEEDS: "",
    OPENSCOUT_MESH_DISCOVERY_INTERVAL_MS: "0",
    OPENSCOUT_ADVERTISE_SCOPE: "local",
    OPENSCOUT_SKIP_USER_PROJECT_HINTS: "1",
  };
}

/** A listener on a free port in 24400–30379 (never a prod port, never ephemeral). */
function listenInSafeRange(): ReturnType<typeof Bun.serve> {
  for (let port = 30379; port >= 24400; port -= 7) {
    try {
      return Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response("not scout", { status: 404 }) });
    } catch {
      // taken; try another
    }
  }
  throw new Error("no free scratch port in 24400-30379");
}

describe("broker daemon instance selection", () => {
  test("(d) OPENSCOUT_INSTANCE=prod inside a checkout stays prod and is refused on a busy port", async () => {
    // Our own listener on a scratch port stands in for a busy prod port.
    const busy = listenInSafeRange();
    const root = mkdtempSync(join(tmpdir(), "openscout-busy-port-"));
    try {
      const child = Bun.spawn([process.execPath, brokerEntry], {
        env: { ...scratchEnv(root, busy.port!), OPENSCOUT_INSTANCE: "prod" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const timer = setTimeout(() => child.kill(), 30_000);
      const code = await child.exited;
      clearTimeout(timer);
      const output = `${await new Response(child.stdout).text()}${await new Response(child.stderr).text()}`;
      expect(output).toContain("instance prod (default layout)");
      expect(output).toContain(`port ${busy.port} is already in use`);
      expect(code).not.toBe(0);
    } finally {
      busy.stop(true);
      rmSync(root, { recursive: true, force: true });
    }
  }, 40_000);
});
