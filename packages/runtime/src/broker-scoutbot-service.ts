import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { join } from "node:path";

import { resolveBrokerServiceConfig } from "./broker-process-manager.js";
import type { RuntimeChildProcessLike, RuntimeEnv, RuntimeSpawnFunction } from "./portable-types.js";
import { resolveBunExecutable } from "./tool-resolution.js";
import { resolveLegacyScoutbotEntry } from "./legacy-app-services.js";

/**
 * Scoutbot runs as its own process beside the broker, the way scout-web does,
 * and talks to the broker only over the local socket. The broker starts it
 * once startup admits writes, restarts it when it exits, and stops it on
 * shutdown.
 */

export const DEFAULT_SCOUTBOT_PROCESS_NAME = "scout-bot";

/** Set in the broker's environment while it runs Scoutbot, so scout-web leaves answering to it. */
export const SCOUTBOT_PROCESS_ENV = "OPENSCOUT_SCOUTBOT_PROCESS";

export type BrokerScoutbotServiceOptions = {
  brokerSocketPath: string;
  brokerUrl: string;
  env?: RuntimeEnv;
  spawnProcess?: RuntimeSpawnFunction<RuntimeChildProcessLike>;
  moduleDirectory?: string;
  cwd?: () => string;
  resolveEntry?: () => string | null;
  resolveBun?: () => { path: string } | null;
  resolveLogPath?: () => string;
  respawnBaseDelayMs?: number;
  respawnMaxDelayMs?: number;
  respawnMaxFailures?: number;
  respawnFailureWindowMs?: number;
  stopTimeoutMs?: number;
  log?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string, detail?: unknown) => void;
};

export class BrokerScoutbotService {
  private readonly options: BrokerScoutbotServiceOptions;
  private readonly env: RuntimeEnv;
  private readonly spawnImpl: RuntimeSpawnFunction<RuntimeChildProcessLike>;
  private child: RuntimeChildProcessLike | null = null;
  private stopping = false;
  private readonly respawnFailures: number[] = [];

  constructor(options: BrokerScoutbotServiceOptions) {
    this.options = options;
    // The broker later sets an internal web-answering marker in its own env.
    // That marker must not replace this service's explicit startup policy.
    this.env = { ...(options.env ?? process.env) };
    this.spawnImpl = options.spawnProcess
      ?? (spawn as unknown as RuntimeSpawnFunction<RuntimeChildProcessLike>);
  }

  /** Requires explicit enablement and an explicit entry; resolution fails closed. */
  enabled(): boolean {
    try {
      return this.resolveEntry() !== null;
    } catch (error) {
      this.options.error?.("[openscout-runtime] Scoutbot configuration refused:", error);
      return false;
    }
  }

  pid(): number | null {
    return this.child?.pid ?? null;
  }

  start(): void {
    if (this.stopping || this.child || !this.enabled()) return;
    try {
      this.child = this.spawnScoutbot();
    } catch (error) {
      this.options.error?.("[openscout-runtime] Scoutbot failed to start:", error);
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGTERM");
    const timeoutMs = this.options.stopTimeoutMs ?? 5_000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    if (await Promise.race([exited, timedOut]) === "timeout") {
      child.kill("SIGKILL");
    }
    if (timer) clearTimeout(timer);
  }

  private resolveEntry(): string | null {
    return resolveLegacyScoutbotEntry(this.env, this.options.resolveEntry);
  }

  private resolveLogPath(): string {
    if (this.options.resolveLogPath) return this.options.resolveLogPath();
    const logDirectory = join(resolveBrokerServiceConfig().supportDirectory, "logs", "scoutbot");
    mkdirSync(logDirectory, { recursive: true });
    return join(logDirectory, "scoutbot.log");
  }

  private spawnScoutbot(): RuntimeChildProcessLike {
    const entry = this.resolveEntry();
    if (!entry) throw new Error("Could not find the Scoutbot entry.");
    const bun = this.options.resolveBun ? this.options.resolveBun() : resolveBunExecutable(this.env);
    if (!bun) throw new Error("Unable to locate Bun for Scoutbot startup.");
    const logFd = openSync(this.resolveLogPath(), "a");
    this.options.log?.(`[openscout-runtime] starting Scoutbot on ${this.options.brokerSocketPath}`);
    const child = this.spawnImpl(bun.path, ["run", entry], {
      argv0: DEFAULT_SCOUTBOT_PROCESS_NAME,
      env: {
        ...this.env,
        OPENSCOUT_BROKER_SOCKET_PATH: this.options.brokerSocketPath,
        // Only names request URLs; every request goes over the socket.
        OPENSCOUT_BROKER_URL: this.options.brokerUrl,
      },
      stdio: ["ignore", logFd, logFd],
    });
    child.once("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      if (this.stopping) return;
      const now = Date.now();
      const windowMs = this.options.respawnFailureWindowMs ?? 60_000;
      while (this.respawnFailures.length > 0 && now - this.respawnFailures[0]! > windowMs) {
        this.respawnFailures.shift();
      }
      this.respawnFailures.push(now);
      const maxFailures = this.options.respawnMaxFailures ?? 5;
      if (this.respawnFailures.length > maxFailures) {
        this.options.error?.(
          `[openscout-runtime] Scoutbot has exited ${this.respawnFailures.length} times within ${windowMs / 1000}s - pausing restarts until the broker restarts.`,
        );
        this.respawnFailures.length = 0;
        return;
      }
      const delay = Math.min(
        (this.options.respawnBaseDelayMs ?? 1_000) * this.respawnFailures.length,
        this.options.respawnMaxDelayMs ?? 30_000,
      );
      this.options.warn?.(
        `[openscout-runtime] Scoutbot exited (code=${code}, signal=${signal}) - restarting in ${delay}ms (failure ${this.respawnFailures.length}/${maxFailures})`,
      );
      setTimeout(() => this.start(), delay).unref?.();
    });
    child.unref();
    return child;
  }
}
