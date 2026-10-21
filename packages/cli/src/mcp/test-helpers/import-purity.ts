// Isolated probe: guard side-effect APIs before importing the public factory.
import { mock } from "bun:test";
import * as net from "node:net";
import * as http from "node:http";
import * as https from "node:https";
import * as tls from "node:tls";
import dgram from "node:dgram";
import workerThreads from "node:worker_threads";
import * as childProcess from "node:child_process";
import * as timers from "node:timers";
import * as promiseTimers from "node:timers/promises";
const effects: string[] = [];
// Keep guards constructible so `new Worker` records an effect, not a TypeError.
const blocked = (name: string) => function (..._args: any[]): never {
  effects.push(name); throw new Error(`factory import side effect: ${name}`);
};
net.Server.prototype.listen = blocked("listener") as any;
net.Socket.prototype.connect = blocked("socket") as any;
http.Server.prototype.listen = blocked("http-listener") as any;
https.Server.prototype.listen = blocked("https-listener") as any;
const httpGuards = { ...http, request: blocked("http-contact"), get: blocked("http-contact") };
const httpsGuards = { ...https, request: blocked("https-contact"), get: blocked("https-contact") };
const tlsGuards = { ...tls, connect: blocked("tls-contact") };
const dgramGuards = { ...dgram, createSocket: blocked("dgram-socket") };
const workerGuards = { ...workerThreads, Worker: blocked("worker:node") };
// CommonJS built-in requires retain the original default export objects.
dgram.createSocket = dgramGuards.createSocket as any;
workerThreads.Worker = workerGuards.Worker as any;
mock.module("node:http", () => ({ ...httpGuards, default: httpGuards }));
mock.module("node:https", () => ({ ...httpsGuards, default: httpsGuards }));
mock.module("node:tls", () => ({ ...tlsGuards, default: tlsGuards }));
mock.module("node:dgram", () => ({ ...dgramGuards, default: dgramGuards }));
mock.module("node:worker_threads", () => ({ ...workerGuards, default: workerGuards }));
AbortSignal.timeout = blocked("abort-timer") as any;
const childGuards = { ...childProcess, ...Object.fromEntries(
  ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"].map(name => [name, blocked(`child:${name}`)])) };
const timerGuards = { ...timers, setTimeout: blocked("timer"), setInterval: blocked("interval"), setImmediate: blocked("immediate") };
const delayGuards = { ...promiseTimers, setTimeout: blocked("delay"), setInterval: blocked("interval") };
mock.module("node:child_process", () => ({ ...childGuards, default: childGuards }));
mock.module("node:timers", () => ({ ...timerGuards, default: timerGuards }));
mock.module("node:timers/promises", () => ({ ...delayGuards, default: delayGuards }));
globalThis.setTimeout = blocked("timer") as any;
globalThis.setInterval = blocked("interval") as any;
globalThis.setImmediate = blocked("immediate") as any;
globalThis.fetch = blocked("fetch") as any;
globalThis.Worker = blocked("worker:global") as any;
for (const name of ["serve", "listen", "connect", "udpSocket", "spawn", "spawnSync"] as const) (Bun as any)[name] = blocked(`Bun.${name}`);
try {
  const factory = await import("../scout-mcp.ts");
  if (typeof factory.createScoutMcpServer !== "function") throw new Error("missing factory");
  // A swallowed failure still fails the probe.
  if (effects.length) throw new Error("swallowed side effect");
  console.log(JSON.stringify({ imported: true, effects }));
} catch (error) {
  console.error(JSON.stringify({ effects, error: String(error) }));
  process.exitCode = 1;
}
