#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { request } from "node:http";
import { StringDecoder } from "node:string_decoder";
import type { ControlEvent } from "../../packages/protocol/src/events.js";
import { scoutBrokerPaths } from "../../packages/protocol/src/broker-routes.js";
import { resolveOpenScoutSupportPaths } from "../../packages/runtime/src/support-paths.js";
import { defaultSettings, escapeMarkup, NotificationGate, NotificationProjection, parseSettings, SseDecoder, type DesktopNotification, type NotificationSettings } from "./notification-policy.js";

const configPath = process.env.OPENSCOUT_LINUX_NOTIFICATION_CONFIG
  || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "openscout", "linux-notifications.json");
const stateDirectory = join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "openscout");
const seenPath = join(stateDirectory, "notification-seen.json");
const statusPath = join(stateDirectory, "notifications-status.json");
const socketPath = process.env.OPENSCOUT_BROKER_SOCKET_PATH || join(resolveOpenScoutSupportPaths().runtimeDirectory, "broker.sock");

function atomicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(temporary, path);
}

function settings(): NotificationSettings {
  return existsSync(configPath) ? parseSettings(JSON.parse(readFileSync(configPath, "utf8"))) : { ...defaultSettings };
}

async function sendNotification(item: DesktopNotification): Promise<void> {
  // The local Omarchy sink retains this fixed argv in notification history.
  // Message text is never allowed to choose the command or any of its options.
  const process = Bun.spawn([
    "busctl", "--user", "--", "call", "org.freedesktop.Notifications", "/org/freedesktop/Notifications",
    "org.freedesktop.Notifications", "Notify", "susssasa{sv}i",
    "Scout", "0", "scout", item.title, escapeMarkup(item.body), "0", "3",
    "urgency", "y", "1", "desktop-entry", "s", "Scout",
    "omarchy-exec-argv", "s", JSON.stringify(["scout", "server", "open", "--path", item.path]), "8000",
  ], { stdout: "ignore", stderr: "pipe" });
  const timer = setTimeout(() => process.kill(), 5000);
  try {
    const error = await new Response(process.stderr).text();
    if (await process.exited !== 0) throw new Error(error.trim() || "Desktop notification failed");
  } finally { clearTimeout(timer); }
}

function readJson(path: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path, method: "GET" }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => {
        body += chunk;
        if (body.length > 10_000_000) req.destroy(new Error("Broker identity response exceeded its limit"));
      });
      response.on("error", reject);
      response.on("end", () => {
        try {
          if (response.statusCode !== 200) throw new Error(`Broker returned HTTP ${response.statusCode}`);
          resolve(JSON.parse(body));
        } catch (error) { reject(error); }
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error("Broker identity request timed out")));
    req.on("error", reject); req.end();
  });
}

async function run(): Promise<void> {
  const projection = new NotificationProjection();
  let seen: string[] = [];
  try {
    const stored = JSON.parse(readFileSync(seenPath, "utf8"));
    if (Array.isArray(stored)) seen = stored.filter(value => typeof value === "string");
  } catch { /* First run or a damaged local dedupe cache; no history is replayed. */ }
  const gate = new NotificationGate(seen);
  let stopped = false;
  let activeRequest: ReturnType<typeof request> | undefined;
  let queued: Promise<void> = Promise.resolve();
  let pending = 0;
  const state = { pid: process.pid, connected: false, nodeId: "", updatedAt: 0, lastEventAt: 0, delivered: 0, error: "" };
  const persistStatus = () => atomicJson(statusPath, { ...state, updatedAt: Date.now() });
  const heartbeat = setInterval(persistStatus, 15_000);
  const stop = () => { stopped = true; activeRequest?.destroy(); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
  const receive = (name: string, data: string) => {
    try {
      const value = JSON.parse(data);
      if (name === "hello") {
        if (typeof value.nodeId !== "string") throw new Error("Broker hello has no node identity");
        projection.nodeId = value.nodeId; state.nodeId = value.nodeId;
        state.connected = true; state.error = ""; persistStatus();
        return;
      }
      if (!value || value.kind !== name || !value.payload || typeof value.id !== "string") return;
      state.lastEventAt = Date.now();
      const config = settings();
      const notification = projection.project(value as ControlEvent, config);
      if (!notification || !gate.admit(notification, config.maxPerMinute)) return;
      atomicJson(seenPath, gate.keys());
      if (pending >= 24) return; // A bounded sink cannot accumulate an unbounded notification backlog.
      pending++;
      queued = queued.then(async () => {
        // A switch changed while queued also applies to that queued alert.
        const current = settings();
        if (stopped || !current.enabled || !current[notification.category]) return;
        if (!current.previews) notification.body = "Open Scout for details.";
        await sendNotification(notification); state.delivered++; state.error = "";
      }).catch(error => { state.error = String(error); console.error("Scout notifications:", state.error); })
        .finally(() => { pending--; persistStatus(); });
    } catch (error) {
      state.error = String(error); persistStatus();
    }
  };
  try {
    while (!stopped) {
      try {
        // Identity-only warm-up avoids loading or notifying historical messages.
        const identity = await readJson(`${scoutBrokerPaths.v1.snapshot}?scope=identity`);
        projection.hydrate(identity as Parameters<NotificationProjection["hydrate"]>[0]);
        // Dedicated metadata endpoint retains idle conversation participants and
        // active invocation routing without fetching any historical payloads.
        // Older brokers return 404; never fall back to an unscoped snapshot.
        const routing = await readJson(scoutBrokerPaths.v1.notificationRouting);
        projection.hydrate(routing as Parameters<NotificationProjection["hydrate"]>[0]);
        await new Promise<void>((resolve, reject) => {
          const decoder = new StringDecoder("utf8");
          const sse = new SseDecoder(receive);
          const handshake = setTimeout(() => activeRequest?.destroy(new Error("Broker event stream handshake timed out")), 5000);
          activeRequest = request({ socketPath, path: scoutBrokerPaths.v1.eventsStream, method: "GET", headers: { accept: "text/event-stream" } }, response => {
            clearTimeout(handshake);
            if (response.statusCode !== 200 || !response.headers["content-type"]?.includes("text/event-stream")) {
              response.resume(); reject(new Error(`Broker event stream returned HTTP ${response.statusCode}`)); return;
            }
            response.on("data", chunk => {
              try { sse.push(decoder.write(chunk)); } catch (error) { activeRequest?.destroy(error as Error); }
            });
            response.on("error", reject); response.on("end", resolve); response.on("close", resolve);
          });
          activeRequest.on("socket", socket => socket.setTimeout(0));
          activeRequest.on("error", error => { clearTimeout(handshake); reject(error); });
          activeRequest.on("close", () => { clearTimeout(handshake); resolve(); }); activeRequest.end();
        });
      } catch (error) {
        if (!stopped) { state.error = String(error); console.error("Scout notifications:", state.error); }
      }
      state.connected = false; persistStatus();
      if (!stopped) await new Promise(resolve => setTimeout(resolve, 3000));
    }
    await queued;
  } finally { clearInterval(heartbeat); state.connected = false; persistStatus(); }
}

async function main(): Promise<void> {
  const [command = "status", key, value] = process.argv.slice(2);
  let demo: { delivered: string[]; skipped: string[] } | undefined;
  if (command === "run") return run();
  if (command === "set") {
    if (!key || value === undefined) throw new Error("Usage: scout-notifications set <setting> <true|false|all|operator|number>");
    const parsed = value === "true" ? true : value === "false" ? false : key === "maxPerMinute" ? Number(value) : value;
    atomicJson(configPath, parseSettings({ ...settings(), [key]: parsed }));
  } else if (command === "test") {
    const mode = key ?? "ready";
    if (!["ready", "inbound", "outbound", "roundtrip"].includes(mode)) {
      throw new Error("Usage: scout-notifications test [inbound|outbound|roundtrip]");
    }
    const examples: DesktopNotification[] = mode === "ready" ? [{
      key: "test", category: "inbound", title: "Scout · Notifications are ready",
      body: "Inbound and outbound communication alerts are configurable in Scout’s Tools menu.", path: "/messages",
    }] : [
      { key: "demo-outbound", category: "outbound", title: "Scout · Demo · Outgoing · You → Peer", body: "Hello from Scout. Got five fun surprises for us?", path: "/messages" },
      { key: "demo-inbound", category: "inbound", title: "Scout · Demo · Incoming · Peer → You", body: "Your reply will appear here when it arrives.", path: "/messages" },
    ].filter(item => mode === "roundtrip" || item.category === mode) as DesktopNotification[];
    demo = { delivered: [], skipped: [] };
    for (const item of examples) {
      const current = settings();
      if (!current.enabled || !current[item.category]) { demo.skipped.push(item.category); continue; }
      if (demo.delivered.length) await Bun.sleep(1200);
      if (!current.previews) item.body = "Open Scout for details.";
      await sendNotification(item);
      demo.delivered.push(item.category);
    }
  } else if (command !== "status" && command !== "--help") throw new Error(`Unknown command: ${command}`);
  if (command === "--help") {
    console.log("Usage: scout-notifications run|status|test [inbound|outbound|roundtrip]|set <setting> <value>\nSettings: enabled, inbound, outbound, attention, previews, scope (all|operator), maxPerMinute (1–120)");
    return;
  }
  let runtime: unknown = null;
  try { runtime = JSON.parse(readFileSync(statusPath, "utf8")); } catch { /* Not started yet. */ }
  console.log(JSON.stringify({ ok: true, settings: settings(), configPath, runtime, ...(demo && { demo }) }));
}

if (import.meta.main) await main().catch(error => { console.error(String(error)); process.exitCode = 1; });
