import { setTimeout as pause } from "node:timers/promises";

export type BrokerStorageMaintenanceOptions = {
  page: (signal: AbortSignal) => Promise<number>;
  compact: (signal: AbortSignal) => Promise<void>;
  onError?: (error: unknown) => void;
  idleIntervalMs?: number;
  catchUpDelayMs?: number;
  retryDelayMs?: number;
  pageYieldMs?: number;
  maxPagesPerTurn?: number;
  maxTurnMs?: number;
};

/** A single bounded maintenance turn, with a scalar wakeup instead of an
 * interval-created promise backlog. Accepted commands get a timer turn between
 * pages, and shutdown cancels future pages without waiting for a storage drain. */
export class BrokerStorageMaintenance {
  private enabled = false;
  private running = false;
  private requested = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller = new AbortController();
  private phase: "stopped" | "idle" | "relocating" | "compacting" | "error" = "stopped";
  private lastError: string | null = null;
  private lastStartedAt: number | null = null;
  private lastCompletedAt: number | null = null;
  private pages = 0;
  private relocated = 0;

  constructor(private readonly options: BrokerStorageMaintenanceOptions) {}
  status() { return { phase: this.phase, running: this.running, requested: this.requested,
    lastStartedAt: this.lastStartedAt, lastCompletedAt: this.lastCompletedAt,
    pages: this.pages, relocated: this.relocated, lastError: this.lastError }; }

  start(): void {
    if (this.enabled) return;
    this.enabled = true; this.controller = new AbortController(); this.phase = "idle"; this.request();
  }
  request(): void {
    if (!this.enabled) return;
    this.requested = true;
    if (!this.running) this.schedule(0);
  }
  stop(): void {
    this.enabled = false; this.requested = false; this.phase = "stopped";
    if (this.timer) clearTimeout(this.timer);
    this.timer = null; this.controller.abort();
  }
  private schedule(delay: number): void {
    if (!this.enabled) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.turn(); }, delay);
    this.timer.unref();
  }
  private async turn(): Promise<void> {
    if (!this.enabled || this.running) return;
    this.running = true; this.requested = false; this.lastStartedAt = Date.now();
    const signal = this.controller.signal;
    let progress = false, failed = false;
    try {
      for (let index = 0; index < (this.options.maxPagesPerTurn ?? 4); index++) {
        signal.throwIfAborted(); this.phase = "relocating";
        const count = await this.options.page(signal);
        signal.throwIfAborted(); this.pages++; this.relocated += count;
        if (count <= 0) break;
        progress = true;
        if (Date.now() - this.lastStartedAt >= (this.options.maxTurnMs ?? 250)) break;
        await pause(this.options.pageYieldMs ?? 25, undefined, { signal });
      }
      signal.throwIfAborted(); this.phase = "compacting";
      await this.options.compact(signal);
      signal.throwIfAborted(); this.lastError = null; this.phase = "idle";
    } catch (error) {
      if (!signal.aborted) {
        failed = true; this.lastError = error instanceof Error ? error.message : String(error);
        this.phase = "error"; this.options.onError?.(error);
      }
    } finally {
      this.running = false; this.lastCompletedAt = Date.now();
      if (this.enabled) this.schedule(failed ? (this.options.retryDelayMs ?? 5000)
        : this.requested || progress ? (this.options.catchUpDelayMs ?? 250) : (this.options.idleIntervalMs ?? 60_000));
    }
  }
}
