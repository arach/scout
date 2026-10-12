import { expect, test } from "bun:test";
import { createServer, type ServerResponse } from "node:http";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { scoutBrokerPaths } from "../../packages/protocol/src/broker-routes.js";
import { createRuntimeRegistrySnapshot, queryRuntimeNotificationRouting, queryRuntimeRegistrySnapshot } from "../../packages/runtime/src/registry.js";

const entrypoint = resolve(import.meta.dir, "scout-notifications.ts");
const bun = Bun.which("bun")!;
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 7000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for the notification observer");
    await Bun.sleep(25);
  }
}

test("live observer connects, routes safely, hot-loads switches, and deduplicates after reconnect", async () => {
  const directory = mkdtempSync(join(tmpdir(), "scout-notifications-"));
  const socketPath = join(directory, "broker.sock");
  const configPath = join(directory, "settings.json");
  const logPath = join(directory, "sink.jsonl");
  const bin = join(directory, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "busctl"), `#!/usr/bin/python3\nimport json,os,sys\nwith open(os.environ['SCOUT_NOTIFICATION_TEST_LOG'],'a') as f: f.write(json.dumps(sys.argv[1:])+'\\n')\n`);
  chmodSync(join(bin, "busctl"), 0o755);
  const lines = (): string[][] => existsSync(logPath) ? readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  const streams: ServerResponse[] = [];
  const registry = createRuntimeRegistrySnapshot({ conversations: {
    old: { id: "dm/builder?operator", title: "Builder and operator", kind: "direct", participantIds: ["builder", "operator"],
      authorityNodeId: "archie", visibility: "private", shareMode: "local", metadata: { createdAt: 1000, updatedAt: 1000 } },
  } });
  // The former startup query omits this idle thread despite its operator participant.
  expect(queryRuntimeRegistrySnapshot(registry, { scope: "conversations", since: Date.now() }).conversations).toEqual({});
  let routingReads = 0;
  const server = createServer((req, res) => {
    if (req.url === `${scoutBrokerPaths.v1.snapshot}?scope=identity`) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ actors: { builder: { id: "builder", kind: "agent", displayName: "Builder" } } }));
    } else if (req.url === scoutBrokerPaths.v1.notificationRouting) {
      routingReads++;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(queryRuntimeNotificationRouting(registry)));
    } else if (req.url === scoutBrokerPaths.v1.eventsStream) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('event: hello\ndata: {"nodeId":"archie"}\n\n');
      streams.push(res);
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((accept, reject) => { server.once("error", reject); server.listen(socketPath, accept); });
  const child = Bun.spawn([bun, entrypoint, "run"], {
    env: { ...process.env, OPENSCOUT_BROKER_SOCKET_PATH: socketPath, OPENSCOUT_LINUX_NOTIFICATION_CONFIG: configPath,
      XDG_STATE_HOME: join(directory, "state"), PATH: `${bin}:/usr/bin`, SCOUT_NOTIFICATION_TEST_LOG: logPath },
    stdout: "pipe", stderr: "pipe",
  });
  const emit = (id: string, actorId = "builder") => {
    const message = { id, actorId, conversationId: "dm/builder?operator", originNodeId: "archie", class: "agent",
      body: '<img src="https://invalid.example/image"> $(touch /tmp/should-never-exist)', audience: {}, createdAt: 1000 };
    streams.at(-1)!.write(`event: message.posted\ndata: ${JSON.stringify({ id: `evt.${id}`, kind: "message.posted", payload: { message } })}\n\n`);
  };
  try {
    await until(() => streams.length === 1);
    expect(lines()).toHaveLength(0);
    emit("one");
    await until(() => lines().length === 1);
    expect(lines()[0]).toContain("Scout · Incoming · Builder → You");
    expect(lines()[0]?.join(" ")).toContain("&lt;img");
    expect(JSON.parse(lines()[0]!.at(-2)!)).toEqual(["scout", "server", "open", "--path", "/messages/dm%2Fbuilder%3Foperator"]);

    writeFileSync(configPath, JSON.stringify({ inbound: false, previews: false }));
    emit("muted"); emit("out", "operator");
    await until(() => lines().length === 2);
    expect(lines()[1]).toContain("Open Scout for details.");
    expect(lines()[1]?.join(" ")).not.toContain("touch");

    streams[0]!.end();
    await until(() => streams.length === 2);
    writeFileSync(configPath, JSON.stringify({ inbound: true, scope: "operator" }));
    emit("one"); emit("after-reconnect");
    await until(() => lines().length === 3);
    expect(lines()).toHaveLength(3);
    expect(lines()[2]).toContain("Scout · Incoming · Builder → You");
    expect(routingReads).toBe(2);
    const state = JSON.parse(readFileSync(join(directory, "state/openscout/notifications-status.json"), "utf8"));
    expect(state.connected).toBe(true);
    expect(state.nodeId).toBe("archie");
    expect(JSON.stringify(state)).not.toContain("touch");
  } finally {
    child.kill("SIGTERM");
    const stop = setTimeout(() => child.kill("SIGKILL"), 4500);
    await child.exited; clearTimeout(stop);
    for (const stream of streams) stream.destroy();
    await new Promise<void>(accept => server.close(() => accept()));
    rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);

test("older broker routing API fails closed without opening a stream or reading history", async () => {
  const directory = mkdtempSync(join(tmpdir(), "scout-notification-old-broker-"));
  const socketPath = join(directory, "broker.sock");
  const statusPath = join(directory, "state/openscout/notifications-status.json");
  const paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(req.url!);
    if (req.url === `${scoutBrokerPaths.v1.snapshot}?scope=identity`) {
      res.setHeader("content-type", "application/json"); res.end('{"actors":{}}');
    } else { res.writeHead(404); res.end('{"error":"not found"}'); }
  });
  await new Promise<void>(accept => server.listen(socketPath, accept));
  const child = Bun.spawn([bun, entrypoint, "run"], {
    env: { ...process.env, OPENSCOUT_BROKER_SOCKET_PATH: socketPath,
      OPENSCOUT_LINUX_NOTIFICATION_CONFIG: join(directory, "settings.json"), XDG_STATE_HOME: join(directory, "state") },
    stdout: "pipe", stderr: "pipe",
  });
  try {
    await until(() => existsSync(statusPath) && JSON.parse(readFileSync(statusPath, "utf8")).error.includes("HTTP 404"));
    expect(paths).toEqual([`${scoutBrokerPaths.v1.snapshot}?scope=identity`, scoutBrokerPaths.v1.notificationRouting]);
    expect(JSON.parse(readFileSync(statusPath, "utf8")).connected).toBe(false);
  } finally {
    child.kill("SIGTERM");
    await child.exited;
    await new Promise<void>(accept => server.close(() => accept()));
    rmSync(directory, { recursive: true, force: true });
  }
}, 10_000);

test("installer preserves user configuration and patches the menu once", async () => {
  const directory = mkdtempSync(join(tmpdir(), "scout-notification-install-"));
  const widgetPath = join(directory, ".config/omarchy/plugins/scout.linux/Widget.qml");
  const configPath = join(directory, ".config/openscout/linux-notifications.json");
  const candidatePath = join(directory, "candidate.js");
  const notificationPlugin = join(directory, ".config/omarchy/plugins/test.notifications");
  const cardPath = join(notificationPlugin, "components/NotificationCard.qml");
  mkdirSync(resolve(widgetPath, ".."), { recursive: true });
  mkdirSync(resolve(configPath, ".."), { recursive: true });
  writeFileSync(widgetPath, 'Column {\n                        visible: root.tab === "Tools"\n}\n');
  writeFileSync(configPath, '{"outbound":false}\n');
  writeFileSync(candidatePath, "// tested candidate\n");
  mkdirSync(resolve(cardPath, ".."), { recursive: true });
  writeFileSync(join(notificationPlugin, "manifest.json"), JSON.stringify({ omarchy: { clonedFrom: "omarchy.notifications" } }));
  writeFileSync(cardPath, "// original native card\n");
  try {
    for (let i = 0; i < 2; i++) {
      const child = Bun.spawn([bun, resolve(import.meta.dir, "install-notifications.ts"), "--apply", `--home=${directory}`, `--candidate=${candidatePath}`, `--notification-plugin=${notificationPlugin}`], { stdout: "pipe", stderr: "pipe" });
      const stderr = await new Response(child.stderr).text();
      expect(await child.exited, stderr).toBe(0);
    }
    expect(readFileSync(configPath, "utf8")).toBe('{"outbound":false}\n');
    expect(readFileSync(widgetPath, "utf8").match(/NotificationControls/g)).toHaveLength(1);
    expect(readFileSync(join(directory, ".config/systemd/user/scout-notifications.service"), "utf8")).toContain("PartOf=graphical-session.target");
    expect(readFileSync(join(notificationPlugin, "components/NativeNotificationCard.qml"), "utf8")).toBe("// original native card\n");
    expect(readFileSync(cardPath, "utf8")).toContain("readonly property bool isScout: app === \"Scout\"");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("roundtrip preview shows both native directions and respects notification switches", async () => {
  const directory = mkdtempSync(join(tmpdir(), "scout-notification-preview-"));
  const configPath = join(directory, "settings.json");
  const logPath = join(directory, "sink.jsonl");
  writeFileSync(join(directory, "busctl"), `#!/usr/bin/python3\nimport json,os,sys\nwith open(os.environ['SCOUT_NOTIFICATION_TEST_LOG'],'a') as f: f.write(json.dumps(sys.argv[1:])+'\\n')\n`);
  chmodSync(join(directory, "busctl"), 0o755);
  const lines = (): string[][] => existsSync(logPath) ? readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  const preview = async (mode = "roundtrip") => {
    const child = Bun.spawn([bun, entrypoint, "test", mode], {
      env: { ...process.env, OPENSCOUT_LINUX_NOTIFICATION_CONFIG: configPath, XDG_STATE_HOME: join(directory, "state"),
        PATH: `${directory}:/usr/bin`, SCOUT_NOTIFICATION_TEST_LOG: logPath },
      stdout: "pipe", stderr: "pipe",
    });
    const stdout = await new Response(child.stdout).text();
    const stderr = await new Response(child.stderr).text();
    return { code: await child.exited, stdout, stderr };
  };
  try {
    const both = await preview();
    expect(both.code, both.stderr).toBe(0);
    expect(JSON.parse(both.stdout).demo.delivered).toEqual(["outbound", "inbound"]);
    expect(lines()[0]).toContain("Scout · Demo · Outgoing · You → Peer");
    expect(lines()[1]).toContain("Scout · Demo · Incoming · Peer → You");

    writeFileSync(configPath, JSON.stringify({ inbound: false, previews: false }));
    const outgoing = await preview();
    expect(outgoing.code, outgoing.stderr).toBe(0);
    expect(JSON.parse(outgoing.stdout).demo).toEqual({ delivered: ["outbound"], skipped: ["inbound"] });
    expect(lines()).toHaveLength(3);
    expect(lines()[2]).toContain("Open Scout for details.");

    writeFileSync(configPath, JSON.stringify({ enabled: false }));
    expect(JSON.parse((await preview()).stdout).demo.delivered).toEqual([]);
    expect((await preview("invalid")).code).toBe(1);
    expect(lines()).toHaveLength(3);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
